/**
 * MapData -> three.js scene. Brushes, ramps, decals and cylinder props become quads subdivided
 * about every 1.1 m (for vertex lighting), merged into one mesh per material, with world-scaled
 * UVs (prototype `worldUV`) or raw 0..1 UVs. Lighting is baked into vertex colours per time of day
 * (cached in memory and IndexedDB). Glow props become additive sprites; the sky is a dome.
 *
 * Z-fighting: faces that share a plane with another overlapping face (trim flush on a wall, wall
 * ends in a corner, a strip on a floor, decals) are settled by `planDepth` (shared maps/faces.ts):
 * hidden duplicates are not drawn, the rest get a depth level and go into a per-(material, level)
 * mesh drawn with a polygon offset of that many steps, and decals lying flat on surfaces are drawn
 * after the world in stacking order without writing depth. The intended face wins at any
 * distance; geometry, UVs and collision are unchanged.
 *
 * Extension: `registerPropBuilder(kind, fn)` renders custom prop kinds (e.g. 'gltf').
 */
import * as THREE from 'three';
import { boxFace, decalQuad, FACES, faceKey, planDepth, RAMP_ANGLE, xform, type FaceSource } from '../../shared/maps/faces';
import { blendAt, buildCollisionWorld, type Brush, type Decal, type GlowProp, type MapData, type MaterialDef, type Prop, type TimePreset } from '../../shared/maps/types';
import { hashString, type Vec3 } from '../../shared/math';
import { Baker, DynLight } from './bake';
import { cacheGet, cachePut } from './idb';
import { applyGrade } from './grade';
import { G, makeLookMaterial, type LookMaterial } from './shader';
import { bindTexture, getTexture, unbindTexture } from './textures';

// 3: meshes split per depth level (the bake buffer's vertex order changed).
const BAKE_VERSION = 3;
/** Subdivisions of an edge of length `v`: one per `seg` metres (vertex lighting), 1..56. */
const sg = (v: number, seg = 1.1) => Math.min(56, Math.max(1, Math.round(v / seg)));

class Bucket {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  get count() {
    return this.pos.length / 3;
  }
}

type V = [number, number, number];
type Xf = (p: V) => V;

/** A subdivided quad: corner o, full edges u and v (normal = u x v), UV size (uw, vh). No bucket: skipped. */
function quad(b: Bucket | null, o: V, u: V, v: V, su: number, sv: number, uw: number, vh: number, xf: Xf, nxf: Xf) {
  if (!b) return;
  const n = norm(cross(u, v));
  const N = nxf(n);
  const base = b.count;
  for (let j = 0; j <= sv; j++)
    for (let i = 0; i <= su; i++) {
      const a = i / su;
      const c = j / sv;
      const p = xf([o[0] + u[0] * a + v[0] * c, o[1] + u[1] * a + v[1] * c, o[2] + u[2] * a + v[2] * c]);
      b.pos.push(p[0], p[1], p[2]);
      b.nor.push(N[0], N[1], N[2]);
      b.uv.push(a * uw, c * vh);
    }
  const row = su + 1;
  for (let j = 0; j < sv; j++)
    for (let i = 0; i < su; i++) {
      const a = base + j * row + i;
      const bb = a + 1;
      const c = a + row;
      const d = c + 1;
      b.idx.push(a, bb, d, a, d, c);
    }
}

function tri(b: Bucket | null, p: [V, V, V], uv: [number, number][], xf: Xf, nxf: Xf) {
  if (!b) return;
  const n = nxf(norm(cross(sub(p[1], p[0]), sub(p[2], p[0]))));
  const base = b.count;
  for (let k = 0; k < 3; k++) {
    const q = xf(p[k]!);
    b.pos.push(q[0], q[1], q[2]);
    b.nor.push(n[0], n[1], n[2]);
    b.uv.push(uv[k]![0], uv[k]![1]);
  }
  b.idx.push(base, base + 1, base + 2);
}

const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
function norm(a: V): V {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/**
 * Polygon offset for a depth level (0 = none). The constant term separates the levels: two depth
 * steps per level, above the 1-2 steps that differently tessellated coplanar faces disagree by.
 * The slope term covers grazing angles and the PS1 vertex snap moving edges by half a pixel. Maps
 * use up to 4 levels (tests/zfight.test.ts keeps it at 6 or fewer): at most 8 steps, under 5 cm
 * at 100 m, and a slope pull of 2 px at most, so an offset face never visibly bleeds past an edge.
 */
export function depthOffset(level: number): { factor: number; units: number } {
  return level > 0 ? { factor: -1 - 0.25 * Math.min(level, 4), units: -2 * level } : { factor: 0, units: 0 };
}

export type PropBuilder = (prop: Prop, ctx: { map: MapData; root: THREE.Group; material(id: string): LookMaterial | null }) => THREE.Object3D | null;
const propBuilders = new Map<string, PropBuilder>();
/** Render custom prop kinds (MapData props with that `kind`). */
export function registerPropBuilder(kind: string, fn: PropBuilder): void {
  propBuilders.set(kind, fn);
}

interface BakedMesh {
  mesh: THREE.Mesh;
  pos: Float32Array;
  nor: Float32Array;
  color: THREE.BufferAttribute;
}

export class MapScene {
  readonly root = new THREE.Group();
  readonly world;
  readonly baker: Baker;
  dyn: DynLight;
  time: TimePreset;
  private baked: BakedMesh[] = [];
  private materials: LookMaterial[] = [];
  private glows: { sprite: THREE.Sprite; prop: GlowProp }[] = [];
  /** The sky dome (hidden for top-down captures such as the tactical map). */
  readonly sky: THREE.Mesh;
  private skyMat: LookMaterial;
  private bakes = new Map<string, Float32Array>();
  private signature: string;
  /** Chunked maps: each mesh's footprint, for distance culling (`MapData.drawDistance`). */
  private chunks: { mesh: THREE.Mesh; x: number; z: number; r: number }[] = [];
  private cullAt = { x: Infinity, z: Infinity };
  /** Extra draw distance (m) on top of `MapData.drawDistance` (Blackout: high up in the plane). */
  drawBoost = 0;

  constructor(readonly map: MapData) {
    this.world = buildCollisionWorld(map);
    this.baker = new Baker(this.world, map);
    this.time = map.times.find((t) => t.id === map.defaultTime) ?? map.times[0]!;
    this.dyn = new DynLight(this.baker, this.time);
    this.build();
    // The cached bake is one buffer over the baked meshes in order, so their layout is part of the key.
    const layout = this.baked.map((b) => [b.mesh.name, b.pos.length]);
    this.signature = hashString(JSON.stringify([BAKE_VERSION, map.brushes, map.decals, map.props, map.lights, layout])).toString(36);
    this.skyMat = makeLookMaterial({ texture: this.time.sky, emissive: 1, fog: false, side: 'back', affine: 0, bake: false, sky: true });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.root.add(this.sky);
  }

  /** Texture recipe ids this map uses (to develop them first). */
  textureIds(): string[] {
    const ids = new Set<string>(Object.values(this.map.materials).flatMap((m) => (m.blend ? [m.texture, m.blend.texture] : [m.texture])));
    for (const t of this.map.times) ids.add(t.sky);
    return [...ids];
  }

  private build() {
    const map = this.map;
    const { level, drop, flush } = planDepth(map);
    const buckets = new Map<string, Bucket>();
    // Big maps (Blackout): one mesh per material per chunk, so far chunks can be culled.
    const chunk = map.chunk;
    const chunkOf = (x: number, z: number) => (chunk ? `@${Math.floor(x / chunk)},${Math.floor(z / chunk)}` : '');
    /** The mesh for a material at the depth level of a face (and the layer of a flush decal). */
    const bucket = (mat: string, src: FaceSource, at = '') => {
      const k = faceKey(src);
      const layer = flush.get(k);
      const key = `${mat}#${level.get(k) ?? 0}${layer === undefined ? '' : `#${layer}`}${at}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = new Bucket()));
      return b;
    };
    map.brushes.forEach((br, i) => {
      const at = chunkOf((br.min.x + br.max.x) / 2, (br.min.z + br.max.z) / 2);
      if (!br.noRender) this.addBrush(br, i, (mat, src) => (drop.has(faceKey(src)) ? null : bucket(mat, src, at)));
    });
    map.decals.forEach((d, i) => this.addDecal(d, bucket(d.mat, { kind: 'decal', i }, chunkOf(d.x, d.z))));
    map.props.forEach((p, i) => {
      if (p.kind === 'cylinder') {
        const geo = new THREE.CylinderGeometry(p.r, p.r, p.len, p.sides, Math.max(1, Math.round(p.len / 1.2)));
        if (p.axis === 'z') geo.rotateX(Math.PI / 2);
        else if (p.axis === 'x') geo.rotateZ(Math.PI / 2);
        geo.translate(p.x, p.y, p.z);
        appendGeometry(bucket(p.mat, { kind: 'cap', i, end: 0 }, chunkOf(p.x, p.z)), geo);
        geo.dispose();
      } else if (p.kind === 'glow') {
        const m = new THREE.SpriteMaterial({ map: getTexture('glow'), color: new THREE.Color(p.color[0], p.color[1], p.color[2]), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
        const s = new THREE.Sprite(m);
        s.scale.setScalar(p.size);
        s.position.set(p.x, p.y, p.z);
        this.root.add(s);
        this.glows.push({ sprite: s, prop: p });
      } else {
        const fn = propBuilders.get(p.kind);
        const obj = fn?.(p, { map, root: this.root, material: (id) => this.makeMat(id) });
        if (obj) this.root.add(obj);
        else if (!fn) console.info(`[map] prop kind "${p.kind}" has no builder (registerPropBuilder)`);
      }
    });
    for (const [key, b] of buckets) {
      if (!b.count) continue;
      const [matId, lv, layer] = key.split('@')[0]!.split('#') as [string, string, string | undefined];
      const mat = this.makeMat(matId, Number(lv));
      if (!mat) continue;
      // Flush decals: after the world, in stacking order, without writing depth (planDepth `flush`).
      if (layer !== undefined) mat.depthWrite = false;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(b.pos);
      const nor = new Float32Array(b.nor);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b.uv), 2));
      if (map.materials[matId]?.blend) {
        // The blend mask per vertex (MaterialDef.blend, MapData.blendMask).
        const bl = new Float32Array(b.count);
        const shapes = map.blendMask ?? [];
        for (let i = 0; i < b.count; i++) bl[i] = blendAt(shapes, pos[i * 3]!, pos[i * 3 + 2]!);
        geo.setAttribute('blend', new THREE.BufferAttribute(bl, 1));
      }
      geo.setIndex(b.count > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.name = key;
      if (layer !== undefined) mesh.renderOrder = 1 + Number(layer);
      this.root.add(mesh);
      if (chunk && geo.boundingSphere) this.chunks.push({ mesh, x: geo.boundingSphere.center.x, z: geo.boundingSphere.center.z, r: geo.boundingSphere.radius });
      if (mat.vertexColors) {
        const color = new THREE.BufferAttribute(new Float32Array(pos.length), 3);
        color.array.fill(0.6);
        geo.setAttribute('color', color);
        this.baked.push({ mesh, pos, nor, color });
      }
    }
  }

  private makeMat(id: string, level = 0): LookMaterial | null {
    const def: MaterialDef | undefined = this.map.materials[id];
    if (!def) {
      console.warn(`[map] unknown material ${id}`);
      return null;
    }
    if (def.texture === 'none') return null;
    const m = makeLookMaterial({ texture: def.texture, uvMul: def.uvMul, tint: def.tint, emissive: def.emissive, side: def.side, bake: def.bake, fog: def.fog, affine: def.affine, worldUV: def.worldUV, blend: def.blend, vary: def.vary });
    if (level > 0) {
      const o = depthOffset(level);
      m.polygonOffset = true;
      m.polygonOffsetFactor = o.factor;
      m.polygonOffsetUnits = o.units;
    }
    this.materials.push(m);
    return m;
  }

  /** `bucket` returns null for faces the depth plan drops. */
  private addBrush(br: Brush, i: number, bucket: (mat: string, src: FaceSource) => Bucket | null) {
    const { min, max } = br;
    const c: V = [(min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2];
    const raw = br.uv === 'raw';
    let w = max.x - min.x;
    const h = max.y - min.y;
    let d = max.z - min.z;
    if (br.ramp) {
      const along = br.ramp === '+x' || br.ramp === '-x';
      const L = along ? w : d;
      const W = along ? d : w;
      const { xf, nxf } = xform(RAMP_ANGLE[br.ramp], c);
      const b = (part: 'slope' | 'rampHi' | 'rampLo' | 'rampSideA' | 'rampSideB') => bucket(br.mat, { kind: 'brush', i, part });
      const x = L / 2;
      const y = h / 2;
      const z = W / 2;
      const sl = Math.hypot(L, h);
      const uvs = (uw: number, vh: number): [number, number] => (raw ? [1, 1] : [uw, vh]);
      // Slope, high end, bottom, two side triangles.
      const [su, sv] = uvs(sl, W);
      quad(b('slope'), [-x, -y, z], [L, h, 0], [0, 0, -W], sg(sl), sg(W), su, sv, xf, nxf);
      const hi = boxFace('px', L, h, W);
      const hu = uvs(hi.uw, hi.vh);
      quad(b('rampHi'), hi.o, hi.u, hi.v, sg(hi.uw), sg(hi.vh), hu[0], hu[1], xf, nxf);
      const lo = boxFace('ny', L, h, W);
      const lu = uvs(lo.uw, lo.vh);
      quad(b('rampLo'), lo.o, lo.u, lo.v, sg(lo.uw), sg(lo.vh), lu[0], lu[1], xf, nxf);
      const k = raw ? 1 / L : 1;
      const kh = raw ? 1 / h : 1;
      tri(b('rampSideA'), [[-x, -y, z], [x, -y, z], [x, y, z]], [[0, 0], [L * k, 0], [L * k, h * kh]], xf, nxf);
      tri(b('rampSideB'), [[x, -y, -z], [-x, -y, -z], [x, y, -z]], [[0, 0], [L * k, 0], [0, h * kh]], xf, nxf);
      return;
    }
    const ry = br.ry ?? 0;
    if (Math.abs(Math.sin(ry)) > 0.5) [w, d] = [d, w];
    const { xf, nxf } = xform(ry, c);
    const hide = br.hide;
    for (const f of FACES) {
      if (hide?.includes(f)) continue;
      const face = boxFace(f, w, h, d);
      const mat = br.faceMats?.[f] ?? br.mat;
      const seg = this.map.materials[mat]?.segment;
      quad(bucket(mat, { kind: 'brush', i, part: f }), face.o, face.u, face.v, sg(face.uw, seg), sg(face.vh, seg), raw ? 1 : face.uw, raw ? 1 : face.vh, xf, nxf);
    }
  }

  private addDecal(d: Decal, b: Bucket) {
    const raw = d.uv === 'raw';
    const { xf, nxf } = xform(d.ry ?? 0, [d.x, d.y, d.z]);
    const su = d.seg ?? sg(d.w);
    const sv = d.seg ?? sg(d.h);
    const q = decalQuad(d);
    quad(b, q.o, q.u, q.v, su, sv, raw ? 1 : d.w, raw ? 1 : d.h, xf, nxf);
  }

  /** Switch time of day: global uniforms, sky, glows, and the (cached) bake. */
  async setTime(id: string, onProgress?: (k: number) => void): Promise<void> {
    const T = this.map.times.find((t) => t.id === id) ?? this.time;
    this.time = T;
    this.dyn = new DynLight(this.baker, T);
    applyTimeUniforms(T);
    bindTexture(this.skyMat, T.sky);
    this.sky.rotation.y = T.skyRot;
    for (const { sprite, prop } of this.glows) {
      const on = prop.beacon || !prop.group ? 1 : (T.lights[prop.group] ?? 0) > 0 ? T.glow : 0;
      sprite.visible = on > 0;
      (sprite.material as THREE.SpriteMaterial).opacity = on;
    }
    const all = await this.bakeFor(T, onProgress);
    let off = 0;
    for (const b of this.baked) {
      b.color.array.set(all.subarray(off, off + b.pos.length));
      b.color.needsUpdate = true;
      off += b.pos.length;
    }
  }

  private async bakeFor(T: TimePreset, onProgress?: (k: number) => void): Promise<Float32Array> {
    const key = `${this.map.id}:${T.id}:${this.signature}:${hashString(JSON.stringify(T)).toString(36)}`;
    const mem = this.bakes.get(key);
    if (mem) return mem;
    const total = this.baked.reduce((n, b) => n + b.pos.length, 0);
    const cached = await cacheGet<ArrayBuffer>('bakes', key);
    if (cached && cached.byteLength === total * 4) {
      const arr = new Float32Array(cached);
      this.bakes.set(key, arr);
      return arr;
    }
    const out = new Float32Array(total);
    let off = 0;
    let t0 = performance.now();
    for (const b of this.baked) {
      // Bake in slices so the page stays responsive.
      const n = b.pos.length;
      for (let i = 0; i < n; i += 3 * 512) {
        const end = Math.min(n, i + 3 * 512);
        this.baker.bakeBuffer(b.pos.subarray(i, end), b.nor.subarray(i, end), T, out.subarray(off + i, off + end));
        if (performance.now() - t0 > 30) {
          onProgress?.((off + end) / total);
          await new Promise((r) => setTimeout(r, 0));
          t0 = performance.now();
        }
      }
      off += n;
    }
    this.bakes.set(key, out);
    void cachePut('bakes', key, out.buffer.slice(0));
    return out;
  }

  /** Per-frame: blinking beacons, sky follows the camera. */
  update(time: number, cam: Vec3): void {
    const on = Math.floor(time * 1.2) % 2 === 0;
    for (const { sprite, prop } of this.glows) if (prop.beacon) sprite.visible = on;
    this.sky.position.set(cam.x, cam.y, cam.z);
    // Chunked maps: hide chunks beyond the draw distance (the fog has ended before it).
    if (this.chunks.length && Math.hypot(cam.x - this.cullAt.x, cam.z - this.cullAt.z) > 4) {
      this.cullAt = { x: cam.x, z: cam.z };
      const far = (this.map.drawDistance ?? 400) + this.drawBoost;
      for (const c of this.chunks) c.mesh.visible = Math.hypot(c.x - cam.x, c.z - cam.z) - c.r < far;
      for (const g of this.glows) g.sprite.visible = Math.hypot(g.prop.x - cam.x, g.prop.z - cam.z) < far && (!g.prop.beacon || on);
    }
  }

  /** Chunks drawn now (tests, the FPS overlay). */
  visibleChunks(): number {
    return this.chunks.filter((c) => c.mesh.visible).length;
  }

  /** Light for a dynamic object (players, viewmodel) at a point. */
  lightAt(x: number, y: number, z: number): [number, number, number] {
    return this.dyn.sample(x, y, z);
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
      if (o instanceof THREE.Sprite) o.material.dispose();
    });
    for (const m of [...this.materials, this.skyMat]) {
      unbindTexture(m);
      m.dispose();
    }
    this.root.removeFromParent();
  }
}

/** Global uniforms for a time preset (sun, ambient, fog, unlit colour). */
export function applyTimeUniforms(T: TimePreset): void {
  G.uSunDir.value.set(T.sunDir.x, T.sunDir.y, T.sunDir.z);
  G.uSun.value.setRGB(T.sun[0], T.sun[1], T.sun[2]);
  G.uAmb.value.setRGB(T.amb[0], T.amb[1], T.amb[2]);
  G.uFogColor.value.setRGB(T.fog[0], T.fog[1], T.fog[2]);
  G.uFogNear.value = T.fogNear;
  G.uFogFar.value = T.fogFar;
  G.uUnlitColor.value.setRGB(T.unlit[0], T.unlit[1], T.unlit[2]);
  applyGrade(T);
}

function appendGeometry(b: Bucket, geo: THREE.BufferGeometry) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  const base = b.count;
  for (let i = 0; i < pos.count; i++) {
    b.pos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    b.nor.push(nor.getX(i), nor.getY(i), nor.getZ(i));
    b.uv.push(uv.getX(i), uv.getY(i));
  }
  const index = geo.getIndex();
  if (index) for (let i = 0; i < index.count; i++) b.idx.push(base + index.getX(i));
  else for (let i = 0; i < pos.count; i++) b.idx.push(base + i);
}
