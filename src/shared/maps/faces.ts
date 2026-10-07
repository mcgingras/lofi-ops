/**
 * Render faces of a map as plain data (no three.js), shared by the client mesh builder and the
 * z-fighting checks (tests/zfight.test.ts, scripts/zfight.ts).
 *
 * - `brushFaces` / `decalFace` / `capFaces`: the exact world-space polygons the renderer draws
 *   (box faces, ramp slope/end/bottom/sides, decal quads, cylinder caps).
 * - `findDepthFights`: pairs of faces that share a plane (or nearly do) and overlap, i.e. z-fight.
 * - `planDepth`: how the renderer settles them: faces wholly hidden under a same-looking coplanar
 *   face are dropped; the rest get a depth "level" (drawn with a polygon offset of that many steps
 *   towards the camera); decals lying flat on surfaces are drawn after the world in stacking
 *   order. Every fight gets a stable winner at any distance. Geometry, UVs and collision are
 *   untouched.
 */
import type { Brush, Decal, Face, MapData, Prop } from './types';

export type V3 = [number, number, number];
type Xf = (p: V3) => V3;

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function norm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Rotation about y by `ry` (three.js convention) then translation. */
export function xform(ry: number, c: V3): { xf: Xf; nxf: Xf } {
  const cs = Math.cos(ry);
  const sn = Math.sin(ry);
  const rot = (p: V3): V3 => [p[0] * cs + p[2] * sn, p[1], -p[0] * sn + p[2] * cs];
  return {
    xf: (p) => {
      const r = rot(p);
      return [r[0] + c[0], r[1] + c[1], r[2] + c[2]];
    },
    nxf: rot,
  };
}

export const FACES: Face[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

/** A quad in local space: corner o, full edges u and v (normal = u x v), UV size (uw, vh). */
export interface LocalQuad {
  o: V3;
  u: V3;
  v: V3;
  uw: number;
  vh: number;
}

/** Box faces in local space (centred), sized w x h x d. */
export function boxFace(f: Face, w: number, h: number, d: number): LocalQuad {
  const x = w / 2;
  const y = h / 2;
  const z = d / 2;
  switch (f) {
    case 'px':
      return { o: [x, -y, z], u: [0, 0, -d], v: [0, h, 0], uw: d, vh: h };
    case 'nx':
      return { o: [-x, -y, -z], u: [0, 0, d], v: [0, h, 0], uw: d, vh: h };
    case 'py':
      return { o: [-x, y, z], u: [w, 0, 0], v: [0, 0, -d], uw: w, vh: d };
    case 'ny':
      return { o: [-x, -y, -z], u: [w, 0, 0], v: [0, 0, d], uw: w, vh: d };
    case 'pz':
      return { o: [-x, -y, z], u: [w, 0, 0], v: [0, h, 0], uw: w, vh: h };
    case 'nz':
      return { o: [x, -y, -z], u: [-w, 0, 0], v: [0, h, 0], uw: w, vh: h };
  }
}

export const RAMP_ANGLE = { '+x': 0, '-z': Math.PI / 2, '-x': Math.PI, '+z': -Math.PI / 2 } as const;

/** Where a face came from (for reports). */
export type FaceSource =
  | { kind: 'brush'; i: number; part: Face | 'slope' | 'rampHi' | 'rampLo' | 'rampSideA' | 'rampSideB' }
  | { kind: 'decal'; i: number }
  | { kind: 'cap'; i: number; end: 0 | 1 };

/** One drawn polygon (convex, counter-clockwise seen from the front). */
export interface RenderFace {
  src: FaceSource;
  mat: string;
  pts: V3[];
  /** Unit normal (front side). */
  n: V3;
  /** Plane offset: n . p = d. */
  d: number;
  /** Seen from both sides (material side 'double'); all the alpha cut-outs (fences, lattice, foliage) are. */
  double: boolean;
}

function polyFace(src: FaceSource, mat: string, pts: V3[], double: boolean): RenderFace {
  const n = norm(cross(sub(pts[1]!, pts[0]!), sub(pts[pts.length - 1]!, pts[0]!)));
  return { src, mat, pts, n, d: dot(n, pts[0]!), double };
}

function quadFace(src: FaceSource, mat: string, q: LocalQuad, xf: Xf, double: boolean): RenderFace {
  const { o, u, v } = q;
  const local: V3[] = [o, [o[0] + u[0], o[1] + u[1], o[2] + u[2]], [o[0] + u[0] + v[0], o[1] + u[1] + v[1], o[2] + u[2] + v[2]], [o[0] + v[0], o[1] + v[1], o[2] + v[2]]];
  return polyFace(src, mat, local.map(xf), double);
}

const isDouble = (map: MapData, mat: string) => map.materials[mat]?.side === 'double';
const drawn = (map: MapData, mat: string) => {
  const m = map.materials[mat];
  return !!m && m.texture !== 'none';
};

/** The faces the renderer draws for brush `i` (none for noRender brushes). */
export function brushFaces(map: MapData, i: number): RenderFace[] {
  const br: Brush = map.brushes[i]!;
  if (br.noRender) return [];
  const { min, max } = br;
  const c: V3 = [(min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2];
  let w = max.x - min.x;
  const h = max.y - min.y;
  let d = max.z - min.z;
  const out: RenderFace[] = [];
  const dbl = isDouble(map, br.mat);
  if (br.ramp) {
    if (!drawn(map, br.mat)) return [];
    const along = br.ramp === '+x' || br.ramp === '-x';
    const L = along ? w : d;
    const W = along ? d : w;
    const { xf } = xform(RAMP_ANGLE[br.ramp], c);
    const x = L / 2;
    const y = h / 2;
    const z = W / 2;
    const sl = Math.hypot(L, h);
    out.push(quadFace({ kind: 'brush', i, part: 'slope' }, br.mat, { o: [-x, -y, z], u: [L, h, 0], v: [0, 0, -W], uw: sl, vh: W }, xf, dbl));
    out.push(quadFace({ kind: 'brush', i, part: 'rampHi' }, br.mat, boxFace('px', L, h, W), xf, dbl));
    out.push(quadFace({ kind: 'brush', i, part: 'rampLo' }, br.mat, boxFace('ny', L, h, W), xf, dbl));
    out.push(polyFace({ kind: 'brush', i, part: 'rampSideA' }, br.mat, [xf([-x, -y, z]), xf([x, -y, z]), xf([x, y, z])], dbl));
    out.push(polyFace({ kind: 'brush', i, part: 'rampSideB' }, br.mat, [xf([x, -y, -z]), xf([-x, -y, -z]), xf([x, y, -z])], dbl));
    return out;
  }
  const ry = br.ry ?? 0;
  if (Math.abs(Math.sin(ry)) > 0.5) [w, d] = [d, w];
  const { xf } = xform(ry, c);
  for (const f of FACES) {
    if (br.hide?.includes(f)) continue;
    const mat = br.faceMats?.[f] ?? br.mat;
    if (!drawn(map, mat)) continue;
    out.push(quadFace({ kind: 'brush', i, part: f }, mat, boxFace(f, w, h, d), xf, isDouble(map, mat)));
  }
  return out;
}

/** The local quad of a decal (see `Decal`). */
export function decalQuad(d: Decal): LocalQuad {
  if (d.kind === 'wall') return { o: [-d.w / 2, 0, 0], u: [d.w, 0, 0], v: [0, d.h, 0], uw: d.w, vh: d.h };
  return { o: [-d.w / 2, 0, d.h / 2], u: [d.w, 0, 0], v: [0, 0, -d.h], uw: d.w, vh: d.h };
}

export function decalFace(map: MapData, i: number): RenderFace | null {
  const dc = map.decals[i]!;
  if (!drawn(map, dc.mat)) return null;
  const { xf } = xform(dc.ry ?? 0, [dc.x, dc.y, dc.z]);
  return quadFace({ kind: 'decal', i }, dc.mat, decalQuad(dc), xf, isDouble(map, dc.mat));
}

/** End caps of cylinder props (as the renderer's polygon, `sides` corners). */
export function capFaces(map: MapData, i: number): RenderFace[] {
  const p: Prop = map.props[i]!;
  if (p.kind !== 'cylinder' || !drawn(map, p.mat)) return [];
  const out: RenderFace[] = [];
  const axis = p.axis ?? 'y';
  for (const end of [0, 1] as const) {
    const s = end ? 1 : -1;
    const pts: V3[] = [];
    for (let k = 0; k < p.sides; k++) {
      // three.js CylinderGeometry: theta from +z towards +x; the caps' winding faces outward.
      const t = ((end ? k : p.sides - 1 - k) / p.sides) * Math.PI * 2;
      const a = Math.sin(t) * p.r;
      const b = Math.cos(t) * p.r;
      const l = (s * p.len) / 2;
      let q: V3 = [a, l, b];
      if (axis === 'z') q = [a, -b, l]; // rotateX(+90deg): (x, y, z) -> (x, -z, y)
      else if (axis === 'x') q = [-l, a, b]; // rotateZ(+90deg): (x, y, z) -> (-y, x, z)
      pts.push([q[0] + p.x, q[1] + p.y, q[2] + p.z]);
    }
    out.push(polyFace({ kind: 'cap', i, end }, p.mat, pts, isDouble(map, p.mat)));
  }
  return out;
}

/** Every face the renderer draws for a map's brushes, decals and cylinder caps. */
export function mapFaces(map: MapData): RenderFace[] {
  const out: RenderFace[] = [];
  map.brushes.forEach((_, i) => out.push(...brushFaces(map, i)));
  map.decals.forEach((_, i) => {
    const f = decalFace(map, i);
    if (f) out.push(f);
  });
  map.props.forEach((_, i) => out.push(...capFaces(map, i)));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Overlap of two faces in (nearly) the same plane
// ---------------------------------------------------------------------------------------------

type P2 = [number, number];

interface Proj {
  ax: number;
  i: number;
  j: number;
  flip: boolean;
}

/** Projection onto the plane of normal n: drops its dominant axis, keeps orientation. */
function projector(n: V3): Proj {
  const ax = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2;
  const [i, j] = ax === 0 ? [1, 2] : ax === 1 ? [2, 0] : [0, 1];
  return { ax, i, j, flip: n[ax]! < 0 };
}

function project(pr: Proj, pts: V3[]): P2[] {
  return pts.map((p) => (pr.flip ? [p[pr.j]!, p[pr.i]!] : [p[pr.i]!, p[pr.j]!]));
}

/** Back onto the plane n . p = d. */
function unproject(pr: Proj, n: V3, d: number, pts: P2[]): V3[] {
  return pts.map((q) => {
    const p: V3 = [0, 0, 0];
    p[pr.i] = pr.flip ? q[1] : q[0];
    p[pr.j] = pr.flip ? q[0] : q[1];
    p[pr.ax] = (d - n[pr.i]! * p[pr.i]! - n[pr.j]! * p[pr.j]!) / n[pr.ax]!;
    return p;
  });
}

function area2(poly: P2[]): number {
  let a = 0;
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k]!;
    const q = poly[(k + 1) % poly.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Sutherland-Hodgman: subject clipped by a convex counter-clockwise clip polygon. */
function clip(subject: P2[], clipPoly: P2[]): P2[] {
  let out = subject;
  for (let k = 0; k < clipPoly.length && out.length; k++) {
    const a = clipPoly[k]!;
    const b = clipPoly[(k + 1) % clipPoly.length]!;
    const inside = (p: P2) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-9;
    const input = out;
    out = [];
    for (let m = 0; m < input.length; m++) {
      const p = input[m]!;
      const q = input[(m + 1) % input.length]!;
      const pin = inside(p);
      const qin = inside(q);
      if (pin) out.push(p);
      if (pin !== qin) {
        const ex = q[0] - p[0];
        const ey = q[1] - p[1];
        const den = (b[0] - a[0]) * ey - (b[1] - a[1]) * ex;
        if (Math.abs(den) > 1e-12) {
          const t = ((b[1] - a[1]) * (p[0] - a[0]) - (b[0] - a[0]) * (p[1] - a[1])) / den;
          out.push([p[0] + ex * t, p[1] + ey * t]);
        }
      }
    }
  }
  return out;
}

/** Overlap of two faces with parallel planes, projected along the first's normal onto its plane. */
export function overlap(a: RenderFace, b: RenderFace): { area: number; poly: V3[] } {
  const pr = projector(a.n);
  let pa = project(pr, a.pts);
  let pb = project(pr, b.pts);
  if (area2(pa) < 0) pa = pa.reverse();
  if (area2(pb) < 0) pb = pb.reverse();
  const r = clip(pa, pb);
  if (r.length < 3) return { area: 0, poly: [] };
  return { area: Math.abs(area2(r)), poly: unproject(pr, a.n, a.d, r) };
}

// ---------------------------------------------------------------------------------------------
// The detector
// ---------------------------------------------------------------------------------------------

/** Planes closer than this are the same plane (float noise in map arithmetic). */
export const COPLANAR_EPS = 1e-4;
/** Overlaps smaller than this (m^2) are edges touching, not a fight. */
export const MIN_OVERLAP = 1e-4;
/**
 * Same-facing faces closer than this are "near": they fight once the depth buffer's resolution at
 * the viewing distance exceeds the gap. With the 24-bit buffer and the main camera's 0.1 m near
 * plane, the resolvable step is about d^2 / (0.1 * 2^24): 6 mm at 100 m, 2.2 cm at 190 m (the
 * farthest fog limit, Nuketown noon). 3 cm keeps a margin over that.
 */
export const NEAR_GAP = 0.03;

export type FightKind =
  /** Same plane, same facing: flickers at any distance. */
  | 'coplanar'
  /** Same plane, opposite facing, at least one double-sided: the back side fights the front. */
  | 'opposed'
  /** Parallel, same facing, under NEAR_GAP apart: flickers at range. */
  | 'near';

export interface DepthFight {
  kind: FightKind;
  a: RenderFace;
  b: RenderFace;
  /** Plane gap (m), b's plane minus a's along a's normal. */
  gap: number;
  area: number;
  /** The overlap, in world space (on a's plane). */
  overlap: V3[];
  /** Nothing can see it: the overlap's front side is inside a solid brush (e.g. two bottoms on the ground). */
  buried: boolean;
}

function bbox(f: RenderFace): [V3, V3] {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of f.pts)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, p[k]!);
      hi[k] = Math.max(hi[k]!, p[k]!);
    }
  return [lo, hi];
}

/**
 * Axis-aligned opaque box brushes as solids, for "can anything see this?" checks. A point inside
 * one (by more than 1 mm) is hidden: the brush's own faces cover it from every side.
 */
export function opaqueSolids(map: MapData): { min: V3; max: V3 }[] {
  const out: { min: V3; max: V3 }[] = [];
  for (const b of map.brushes) {
    if (b.noRender || b.ramp) continue;
    const ry = b.ry ?? 0;
    if (Math.abs(Math.sin(ry) * Math.cos(ry)) > 1e-6) continue;
    const mats = [b.mat, ...Object.values(b.faceMats ?? {})];
    if (mats.some((m) => !drawn(map, m!) || isDouble(map, m!))) continue;
    out.push({ min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });
  }
  return out;
}

function insideSolid(solids: { min: V3; max: V3 }[], p: V3): boolean {
  const e = 1e-3;
  return solids.some((s) => p[0] > s.min[0] + e && p[0] < s.max[0] - e && p[1] > s.min[1] + e && p[1] < s.max[1] - e && p[2] > s.min[2] + e && p[2] < s.max[2] - e);
}

/** Whether the front side of a polygon (normal n) is buried in solids: samples the corners pulled 1 cm in, and the centroid. */
export function isBuried(solids: { min: V3; max: V3 }[], poly: V3[], n: V3, lift = 0): boolean {
  if (!poly.length) return true;
  const c: V3 = [0, 0, 0];
  for (const p of poly) for (let k = 0; k < 3; k++) c[k]! += p[k]! / poly.length;
  const off = lift + 0.01;
  const samples = [c, ...poly.map((p): V3 => {
    const t = sub(c, p);
    const l = Math.hypot(t[0], t[1], t[2]) || 1;
    const k = Math.min(1, 0.01 / l);
    return [p[0] + t[0] * k, p[1] + t[1] * k, p[2] + t[2] * k];
  })];
  return samples.every((p) => insideSolid(solids, [p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off]));
}

/** Pairs of faces in `faces` that z-fight (see FightKind). Decal-vs-brush pairs are included. */
export function findDepthFights(map: MapData, faces: RenderFace[], o: { nearGap?: number } = {}): DepthFight[] {
  const nearGap = o.nearGap ?? NEAR_GAP;
  const tol = nearGap + COPLANAR_EPS;
  const solids = opaqueSolids(map);
  const boxes = faces.map(bbox);
  // Bucket by quantised normal so only parallel faces are compared.
  const groups = new Map<string, number[]>();
  faces.forEach((f, i) => {
    const key = f.n.map((x) => Math.round(Math.abs(x) * 1000)).join(',');
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(i);
  });
  const out: DepthFight[] = [];
  for (const idx of groups.values()) {
    // Sort by plane offset along the group's shared axis so the gap check prunes the inner loop.
    const n0 = faces[idx[0]!]!.n;
    const s = (i: number) => dot(n0, faces[i]!.pts[0]!);
    idx.sort((p, q) => s(p) - s(q));
    for (let x = 0; x < idx.length; x++) {
      const ia = idx[x]!;
      const a = faces[ia]!;
      const [alo, ahi] = boxes[ia]!;
      for (let y = x + 1; y < idx.length; y++) {
        const ib = idx[y]!;
        if (s(ib) - s(ia) > nearGap + COPLANAR_EPS) break;
        const b = faces[ib]!;
        if (a.src.kind === b.src.kind && a.src.i === b.src.i) continue;
        const [blo, bhi] = boxes[ib]!;
        // Boxes grown by the gap tolerance (parallel faces a few mm apart don't touch otherwise).
        if (alo[0] > bhi[0] + tol || blo[0] > ahi[0] + tol || alo[1] > bhi[1] + tol || blo[1] > ahi[1] + tol || alo[2] > bhi[2] + tol || blo[2] > ahi[2] + tol) continue;
        const same = dot(a.n, b.n) > 0.9999;
        const opposite = dot(a.n, b.n) < -0.9999;
        if (!same && !opposite) continue;
        const gap = dot(a.n, b.pts[0]!) - a.d;
        let kind: FightKind | null = null;
        if (Math.abs(gap) <= COPLANAR_EPS) kind = same ? 'coplanar' : a.double || b.double ? 'opposed' : null;
        else if (same && Math.abs(gap) < nearGap) kind = 'near';
        if (!kind) continue;
        const ov = overlap(a, b);
        if (ov.area < MIN_OVERLAP) continue;
        // Seen from the front of the front-most face (same facing); an opposed pair from either side.
        const buried = kind === 'opposed' ? false : isBuried(solids, ov.poly, a.n, Math.max(0, gap));
        out.push({ kind, a, b, gap, area: ov.area, overlap: ov.poly, buried });
      }
    }
  }
  return out;
}

export function describeFace(map: MapData, f: RenderFace): string {
  const s = f.src;
  if (s.kind === 'brush') {
    const b = map.brushes[s.i]!;
    const r = (v: number) => Math.round(v * 1000) / 1000;
    return `brush#${s.i}.${s.part} ${f.mat}${b.tag ? ` [${b.tag}]` : ''} (${r(b.min.x)},${r(b.min.y)},${r(b.min.z)})..(${r(b.max.x)},${r(b.max.y)},${r(b.max.z)})`;
  }
  if (s.kind === 'decal') {
    const d = map.decals[s.i]!;
    return `decal#${s.i} ${d.kind} ${f.mat} @(${d.x},${d.y},${d.z})`;
  }
  return `cyl#${s.i}.cap${s.end} ${f.mat}`;
}

// ---------------------------------------------------------------------------------------------
// Who wins: depth levels
// ---------------------------------------------------------------------------------------------

/**
 * Render unit a level applies to: one brush face, a whole cylinder (its caps fight, the mesh moves
 * as one) or a decal.
 */
export function faceKey(src: FaceSource): string {
  if (src.kind === 'brush') return `b${src.i}.${src.part}`;
  if (src.kind === 'cap') return `c${src.i}`;
  return `d${src.i}`;
}

/** The face that should be seen where a and b overlap. */
export function winner(f: DepthFight): RenderFace {
  const { a, b } = f;
  // Parallel with a gap: the one in front (b's plane is `gap` in front of a's), as authored.
  if (f.kind === 'near') return f.gap > 0 ? b : a;
  // Same plane. Decals are stuck onto surfaces: over anything, later decals over earlier ones.
  const ad = a.src.kind === 'decal';
  const bd = b.src.kind === 'decal';
  if (ad !== bd) return ad ? a : b;
  if (ad && bd) return a.src.i > b.src.i ? a : b;
  // Then an opaque surface over a cut-out (its holes would show what is behind), then
  // the smaller face (the detail: trim on a wall, a strip on a floor, a post end in a rail), then
  // the later brush.
  if (a.double !== b.double) return a.double ? b : a;
  if (f.kind === 'opposed') return a.src.i > b.src.i ? a : b;
  const aa = faceArea(a);
  const ba = faceArea(b);
  if (Math.abs(aa - ba) > 1e-6) return aa < ba ? a : b;
  return a.src.i > b.src.i ? a : b;
}

function faceArea(f: RenderFace): number {
  const pr = projector(f.n);
  return Math.abs(area2(project(pr, f.pts))) / Math.abs(f.n[pr.ax]!);
}

export interface DepthPlan {
  /** Depth level per face key (missing = 0). */
  level: Map<string, number>;
  /**
   * Brush faces not to draw: wholly covered by a coplanar face that looks the same (a wall's end
   * inside the next wall's side, a duplicate brush), or a cut-out face lying on an opaque one (a
   * lattice panel's bottom on the ground). Dropping them is the exact fix and needs no offset.
   */
  drop: Set<string>;
  /**
   * Flush decals (key -> stacking order): decals lying on surfaces over their whole area. The
   * renderer draws them after the world without writing depth, in this order, so a stack of them
   * (Nuketown's road: grass, concrete, asphalt, kerbs, lines, a few tenths of a mm apart) needs
   * one offset level over its surface instead of one level per layer. Hiding nothing is lost: the
   * surface under a flush decal is within NEAR_GAP and writes the depth.
   */
  flush: Map<string, number>;
  /** Every fight found (buried ones included). */
  fights: DepthFight[];
  /** Visible fights left with both faces drawn on the same level (should be none). */
  unresolved: DepthFight[];
  maxLevel: number;
}

const sameLook = (map: MapData, a: string, b: string) => a === b || JSON.stringify(map.materials[a]) === JSON.stringify(map.materials[b]);

/**
 * The plan: first drop faces whose fight can be settled by not drawing them (see `drop`), then
 * level the rest so that every visible fight's winner sits above its loser: a face's level is one
 * more than the highest level among the faces it beats (longest path in the "beats" graph). Decals
 * get at least level 1, so a decal hovering a little over a surface never shimmers at range. Flush
 * decals (see `flush`) are ordered among themselves by draw order instead of levels.
 */
export function planDepth(map: MapData, faces: RenderFace[] = mapFaces(map)): DepthPlan {
  const fights = findDepthFights(map, faces);
  const drop = new Set<string>();
  const covered = (f: DepthFight, x: RenderFace) => f.area >= faceArea(x) * 0.999;
  for (const f of fights) {
    if (f.buried || f.kind === 'near') continue;
    const ka = faceKey(f.a.src);
    const kb = faceKey(f.b.src);
    if (drop.has(ka) || drop.has(kb)) continue;
    // x can go when y covers it: y opaque, and x a brush face that is a cut-out or looks like y.
    const can = (x: RenderFace, y: RenderFace) => x.src.kind === 'brush' && !y.double && y.src.kind !== 'decal' && covered(f, x) && (x.double || (f.kind === 'coplanar' && sameLook(map, x.mat, y.mat)));
    const ca = can(f.a, f.b);
    const cb = can(f.b, f.a);
    // Both (a duplicate): keep the later brush, as the draw order did.
    if (ca && cb) drop.add(f.a.src.i < f.b.src.i ? ka : kb);
    else if (ca) drop.add(ka);
    else if (cb) drop.add(kb);
  }
  const live = (f: DepthFight) => !f.buried && !drop.has(faceKey(f.a.src)) && !drop.has(faceKey(f.b.src)) && faceKey(f.a.src) !== faceKey(f.b.src);
  const beats = new Map<string, Set<string>>();
  // How much of each decal lies on (or a hair in front of) an opaque surface.
  const onSurface = new Map<string, number>();
  for (const f of fights) {
    if (!live(f)) continue;
    const w = winner(f);
    const l = w === f.a ? f.b : f.a;
    const wk = faceKey(w.src);
    let set = beats.get(wk);
    if (!set) beats.set(wk, (set = new Set()));
    set.add(faceKey(l.src));
    if (w.src.kind === 'decal' && l.src.kind !== 'decal' && !l.double && f.kind !== 'opposed') onSurface.set(wk, (onSurface.get(wk) ?? 0) + f.area);
  }
  const flushSet = new Set<string>();
  map.decals.forEach((_, i) => {
    const f = decalFace(map, i);
    if (f && !f.double && (onSurface.get(`d${i}`) ?? 0) >= faceArea(f) * 0.98) flushSet.add(`d${i}`);
  });
  const longest = (beaten: (k: string) => Iterable<string>, base: (k: string) => number) => {
    const memo = new Map<string, number>();
    const visiting = new Set<string>();
    const visit = (k: string): number => {
      const done = memo.get(k);
      if (done !== undefined) return done;
      // A cycle (only possible through mixed near/coplanar rules) is cut here; the test reports it.
      if (visiting.has(k)) return 0;
      visiting.add(k);
      let lv = base(k);
      for (const l of beaten(k)) lv = Math.max(lv, visit(l) + 1);
      visiting.delete(k);
      memo.set(k, lv);
      return lv;
    };
    return { memo, visit };
  };
  // Levels: flush decals don't stack levels on each other (their draw order does that).
  const lev = longest(
    (k) => [...(beats.get(k) ?? [])].filter((l) => !(flushSet.has(k) && flushSet.has(l))),
    (k) => (k.startsWith('d') ? 1 : 0),
  );
  for (const k of beats.keys()) lev.visit(k);
  map.decals.forEach((_, i) => lev.visit(`d${i}`));
  const level = new Map<string, number>();
  for (const [k, v] of lev.memo) if (v) level.set(k, v);
  const ord = longest((k) => [...(beats.get(k) ?? [])].filter((l) => flushSet.has(l)), () => 0);
  const flush = new Map<string, number>();
  for (const k of flushSet) flush.set(k, ord.visit(k));
  const lv = (f: RenderFace) => level.get(faceKey(f.src)) ?? 0;
  const unresolved = fights.filter((f) => {
    if (!live(f)) return false;
    const w = winner(f);
    const l = w === f.a ? f.b : f.a;
    const fw = flush.get(faceKey(w.src));
    const fl = flush.get(faceKey(l.src));
    if (fw !== undefined && fl !== undefined) return fw <= fl;
    return lv(w) <= lv(l);
  });
  let maxLevel = 0;
  for (const v of level.values()) maxLevel = Math.max(maxLevel, v);
  return { level, drop, flush, fights, unresolved, maxLevel };
}
