/**
 * Authoring kit for the maps-bo maps (Nuketown, Firing Range). Pure data helpers on top of
 * `types.ts`: a builder that collects brushes/decals/props/lights through an optional half-turn
 * transform (so one side of a symmetric map is written once and turned round the middle), walls
 * with door/window holes, stairs (visual steps + an invisible collision ramp), ground with holes
 * (trenches), perimeter clips and simple box "furniture" like mannequins and vehicles.
 *
 * Owner: maps-bo. Other map authors are welcome to import it.
 */
import type { RampDir } from '../collision';
import type { AABB, Vec3 } from '../math';
import { type Brush, type Decal, type Face, type MapLight, type Prop, type RGB, type SpawnPoint } from './types';

/** An opening in a wall, in wall-local coordinates: `a0..a1` along the wall, `y0..y1` above its base. */
export interface Hole {
  a0: number;
  a1: number;
  y0: number;
  y1: number;
}

type BrushOpts = Partial<Omit<Brush, 'min' | 'max' | 'mat'>>;

const FLIP_FACE: Record<Face, Face> = { px: 'nx', nx: 'px', py: 'py', ny: 'ny', pz: 'nz', nz: 'pz' };
const FLIP_RAMP: Record<RampDir, RampDir> = { '+x': '-x', '-x': '+x', '+z': '-z', '-z': '+z' };
const MIRROR_X_FACE: Record<Face, Face> = { px: 'nx', nx: 'px', py: 'py', ny: 'ny', pz: 'pz', nz: 'nz' };
const MIRROR_X_RAMP: Record<RampDir, RampDir> = { '+x': '-x', '-x': '+x', '+z': '+z', '-z': '-z' };

/** How the builder places what it is given: as written, turned half round the origin, or mirrored in x. */
export type Xf = 'id' | 'rot180' | 'mirrorX';

export class MapKit {
  brushes: Brush[] = [];
  decals: Decal[] = [];
  props: Prop[] = [];
  lights: MapLight[] = [];
  xf: Xf = 'id';

  /** Run `fn` with a transform applied to everything it adds. */
  with(xf: Xf, fn: () => void): void {
    const prev = this.xf;
    this.xf = xf;
    try {
      fn();
    } finally {
      this.xf = prev;
    }
  }

  /** Like `with`, returning what `fn` returns. */
  withValue<T>(xf: Xf, fn: () => T): T {
    const prev = this.xf;
    this.xf = xf;
    try {
      return fn();
    } finally {
      this.xf = prev;
    }
  }

  /** Transform a point (x, z) by the current transform. */
  pt(x: number, z: number): [number, number] {
    if (this.xf === 'rot180') return [-x, -z];
    if (this.xf === 'mirrorX') return [-x, z];
    return [x, z];
  }

  /** Transform a yaw (yaw 0 faces -z). */
  yaw(y: number): number {
    if (this.xf === 'rot180') return y + Math.PI;
    if (this.xf === 'mirrorX') return -y;
    return y;
  }

  spawn(x: number, y: number, z: number, yaw: number): SpawnPoint {
    const [tx, tz] = this.pt(x, z);
    return { x: tx, y, z: tz, yaw: norm(this.yaw(yaw)) };
  }

  v(x: number, y: number, z: number): Vec3 {
    const [tx, tz] = this.pt(x, z);
    return { x: tx, y, z: tz };
  }

  /** Add a brush given as min/max corners (before the transform). */
  aabb(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: string, o: BrushOpts = {}): Brush {
    const b: Brush = { ...o, mat, min: { x: Math.min(x0, x1), y: Math.min(y0, y1), z: Math.min(z0, z1) }, max: { x: Math.max(x0, x1), y: Math.max(y0, y1), z: Math.max(z0, z1) } };
    const t = this.xfBrush(b);
    this.brushes.push(t);
    return t;
  }

  /** Prototype-style box: w (x) x h (y) x d (z), bottom at y, centred on x/z. */
  box(w: number, h: number, d: number, mat: string, x: number, y: number, z: number, o: BrushOpts = {}): Brush {
    const swap = Math.abs(Math.sin(o.ry ?? 0)) > 0.5;
    const hw = (swap ? d : w) / 2;
    const hd = (swap ? w : d) / 2;
    return this.aabb(x - hw, y, z - hd, x + hw, y + h, z + hd, mat, o);
  }

  private xfBrush(b: Brush): Brush {
    if (this.xf === 'id') return b;
    const out: Brush = { ...b, min: { ...b.min }, max: { ...b.max } };
    if (this.xf === 'rot180') {
      out.min = { x: -b.max.x, y: b.min.y, z: -b.max.z };
      out.max = { x: -b.min.x, y: b.max.y, z: -b.min.z };
      if (b.ramp) out.ramp = FLIP_RAMP[b.ramp];
      if (b.ry !== undefined) out.ry = b.ry + Math.PI;
      if (b.hide) out.hide = b.hide.map((f) => FLIP_FACE[f]);
      if (b.faceMats) out.faceMats = Object.fromEntries(Object.entries(b.faceMats).map(([f, m]) => [FLIP_FACE[f as Face], m]));
    } else {
      out.min = { x: -b.max.x, y: b.min.y, z: b.min.z };
      out.max = { x: -b.min.x, y: b.max.y, z: b.max.z };
      if (b.ramp) out.ramp = MIRROR_X_RAMP[b.ramp];
      if (b.ry !== undefined) out.ry = -b.ry;
      if (b.hide) out.hide = b.hide.map((f) => MIRROR_X_FACE[f]);
      if (b.faceMats) out.faceMats = Object.fromEntries(Object.entries(b.faceMats).map(([f, m]) => [MIRROR_X_FACE[f as Face], m]));
    }
    return out;
  }

  /** A ramp whose top rises towards `dir`, filling the box below the slope. */
  ramp(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, dir: RampDir, mat: string, o: BrushOpts = {}): Brush {
    return this.aabb(x0, y0, z0, x1, y1, z1, mat, { ...o, ramp: dir });
  }

  /**
   * A wall running along `axis` from `a0` to `a1` at cross position `c` (thickness `t`), from `y0`
   * up `h`, with rectangular holes (doors/windows) in wall-local coordinates.
   */
  wall(axis: 'x' | 'z', a0: number, a1: number, c: number, y0: number, h: number, t: number, mat: string, holes: Hole[] = [], o: BrushOpts = {}): void {
    const lo = Math.min(a0, a1);
    const hi = Math.max(a0, a1);
    const hs = holes.map((k) => ({ a0: Math.max(lo, Math.min(k.a0, k.a1)), a1: Math.min(hi, Math.max(k.a0, k.a1)), y0: Math.max(0, k.y0), y1: Math.min(h, k.y1) })).filter((k) => k.a1 > k.a0 + 1e-6).sort((p, q) => p.a0 - q.a0);
    const seg = (s0: number, s1: number, b0: number, b1: number) => {
      if (s1 - s0 < 1e-6 || b1 - b0 < 1e-6) return;
      if (axis === 'x') this.aabb(s0, y0 + b0, c - t / 2, s1, y0 + b1, c + t / 2, mat, o);
      else this.aabb(c - t / 2, y0 + b0, s0, c + t / 2, y0 + b1, s1, mat, o);
    };
    // Split the span at every hole edge; each column is solid except where holes cut it.
    const cuts = [lo, hi, ...hs.flatMap((k) => [k.a0, k.a1])].sort((p, q) => p - q);
    for (let i = 0; i < cuts.length - 1; i++) {
      const s0 = cuts[i]!;
      const s1 = cuts[i + 1]!;
      if (s1 - s0 < 1e-6) continue;
      const mid = (s0 + s1) / 2;
      const open = hs.filter((k) => k.a0 <= mid && k.a1 >= mid).sort((p, q) => p.y0 - q.y0);
      let y = 0;
      for (const k of open) {
        seg(s0, s1, y, k.y0);
        y = Math.max(y, k.y1);
      }
      seg(s0, s1, y, h);
    }
  }

  /**
   * Stairs from (x0, y0, z0) .. (x1, y1, z1) rising towards `dir`: `n` visual steps (bullets and
   * sight, no player collision) plus one invisible collision ramp players walk on.
   */
  stairs(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, dir: RampDir, mat: string, n?: number): void {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minZ = Math.min(z0, z1);
    const maxZ = Math.max(z0, z1);
    const along = dir === '+x' || dir === '-x';
    const len = along ? maxX - minX : maxZ - minZ;
    const rise = y1 - y0;
    const steps = n ?? Math.max(2, Math.round(rise / 0.22));
    for (let i = 0; i < steps; i++) {
      const k0 = i / steps;
      const k1 = (i + 1) / steps;
      const top = y0 + rise * k1;
      // Step i spans the (i)th slice of the run, measured from the low end.
      let sx0 = minX;
      let sx1 = maxX;
      let sz0 = minZ;
      let sz1 = maxZ;
      if (dir === '+x') [sx0, sx1] = [minX + len * k0, maxX];
      else if (dir === '-x') [sx0, sx1] = [minX, maxX - len * k0];
      else if (dir === '+z') [sz0, sz1] = [minZ + len * k0, maxZ];
      else [sz0, sz1] = [minZ, maxZ - len * k0];
      this.aabb(sx0, top - rise / steps, sz0, sx1, top, sz1, mat, { players: false, bullets: true, sight: true, hide: ['ny'] });
    }
    this.aabb(minX, y0, minZ, maxX, y1, maxZ, 'clip', { ramp: dir, noRender: true, players: true, bullets: false, sight: false, tag: 'stairs' });
  }

  /** Invisible player clip (bullets and sight pass). */
  clip(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tag?: string): Brush {
    return this.aabb(x0, y0, z0, x1, y1, z1, 'clip', { noRender: true, players: true, bullets: false, sight: false, ...(tag ? { tag } : {}) });
  }

  /** Trim: rendered, no collision at all. */
  trim(w: number, h: number, d: number, mat: string, x: number, y: number, z: number, o: BrushOpts = {}): Brush {
    return this.box(w, h, d, mat, x, y, z, { ...o, collide: false });
  }

  wallDecal(w: number, h: number, mat: string, x: number, y: number, z: number, ry = 0, o: Partial<Decal> = {}): void {
    const [tx, tz] = this.pt(x, z);
    this.decals.push({ kind: 'wall', w, h, x: tx, y, z: tz, ry: this.yaw(ry), mat, ...o });
  }

  flatDecal(w: number, h: number, mat: string, x: number, y: number, z: number, o: Partial<Decal> = {}): void {
    const [tx, tz] = this.pt(x, z);
    const ry = o.ry ?? 0;
    this.decals.push({ kind: 'flat', w, h, x: tx, y, z: tz, mat, ...o, ry: this.xf === 'id' ? ry : this.yaw(ry) });
  }

  cyl(r: number, len: number, sides: number, mat: string, x: number, y: number, z: number, o: { axis?: 'x' | 'y' | 'z'; collide?: boolean } = {}): void {
    const [tx, tz] = this.pt(x, z);
    this.props.push({ kind: 'cylinder', r, len, sides, x: tx, y, z: tz, axis: o.axis ?? 'y', mat, collide: o.collide });
  }

  light(x: number, y: number, z: number, color: RGB, radius: number, group: string): void {
    const [tx, tz] = this.pt(x, z);
    this.lights.push({ x: tx, y, z: tz, color, radius, group });
  }

  glow(x: number, y: number, z: number, color: RGB, size: number, group?: string, beacon?: boolean): void {
    const [tx, tz] = this.pt(x, z);
    this.props.push({ kind: 'glow', color, size, x: tx, y, z: tz, group, beacon });
  }

  /**
   * A crude store mannequin (BO1 Nuketown's): legs, hips, torso, arms, neck and head out of boxes,
   * facing `yaw`. The torso and legs collide (bullets thud into them), the rest is trim.
   */
  mannequin(x: number, z: number, yaw: number, mat: string, y = 0, cloth?: string): void {
    const side = Math.abs(Math.sin(yaw)) > 0.5;
    const ax = side ? 0 : 1;
    const az = side ? 1 : 0;
    const body = cloth ?? mat;
    this.box(0.34, 0.86, 0.22, mat, x, y, z, { ry: yaw, bullets: true, players: true, sight: false });
    this.box(0.42, 0.62, 0.24, body, x, y + 0.86, z, { ry: yaw, bullets: true, players: true, sight: false });
    for (const s of [-1, 1]) this.trim(0.1, 0.6, 0.1, mat, x + s * 0.27 * ax, y + 0.86, z + s * 0.27 * az, { ry: yaw });
    this.trim(0.08, 0.1, 0.08, mat, x, y + 1.48, z);
    this.trim(0.22, 0.26, 0.24, mat, x, y + 1.56, z, { ry: yaw });
  }

  /**
   * A ring of distant backdrop cards (alpha-cut silhouettes: mountains, hills, tree lines) facing
   * the centre. Wall decals with few segments, so the bake stays cheap whatever their size.
   */
  backdropRing(mat: string, radius: number, count: number, w: number, h: number, y = -2, phase = 0): void {
    for (let i = 0; i < count; i++) {
      const t = phase + (i / count) * Math.PI * 2;
      const r = radius * (1 + 0.08 * Math.sin(i * 2.7));
      const x = Math.cos(t) * r;
      const z = Math.sin(t) * r;
      this.decals.push({ kind: 'wall', w, h: h * (0.85 + 0.3 * Math.abs(Math.sin(i * 1.9))), x, y, z, ry: Math.atan2(-Math.cos(t), -Math.sin(t)), mat, uv: 'raw', seg: 3 });
    }
  }

  /** Perimeter clip walls just inside `bounds` (players only, tall), so nobody walks out. */
  perimeter(b: AABB, height: number, inset = 0.25, t = 0.6): void {
    const { min, max } = b;
    const x0 = min.x + inset;
    const x1 = max.x - inset;
    const z0 = min.z + inset;
    const z1 = max.z - inset;
    this.clip(x0 - t, min.y, z0 - t, x1 + t, height, z0, 'perimeter');
    this.clip(x0 - t, min.y, z1, x1 + t, height, z1 + t, 'perimeter');
    this.clip(x0 - t, min.y, z0, x0, height, z1, 'perimeter');
    this.clip(x1, min.y, z0, x1 + t, height, z1, 'perimeter');
  }

  /**
   * Ground slab(s) with top at `top` over `outer` (x0, z0, x1, z1), leaving rectangular `holes`
   * (trenches, pits). Cells are merged along z so the brush count stays small.
   */
  groundWithHoles(outer: [number, number, number, number], top: number, depth: number, mat: string, holes: [number, number, number, number][], o: BrushOpts = {}): void {
    const [ox0, oz0, ox1, oz1] = outer;
    const xs = [...new Set([ox0, ox1, ...holes.flatMap((h) => [h[0], h[2]])])].filter((v) => v >= ox0 && v <= ox1).sort((a, b) => a - b);
    const zs = [...new Set([oz0, oz1, ...holes.flatMap((h) => [h[1], h[3]])])].filter((v) => v >= oz0 && v <= oz1).sort((a, b) => a - b);
    const inHole = (x: number, z: number) => holes.some((h) => x > h[0] && x < h[2] && z > h[1] && z < h[3]);
    for (let i = 0; i < xs.length - 1; i++) {
      const xa = xs[i]!;
      const xb = xs[i + 1]!;
      let start: number | null = null;
      for (let j = 0; j < zs.length; j++) {
        const solid = j < zs.length - 1 && !inHole((xa + xb) / 2, (zs[j]! + zs[j + 1]!) / 2);
        if (solid && start === null) start = zs[j]!;
        if (!solid && start !== null) {
          this.aabb(xa, top - depth, start, xb, top, zs[j]!, mat, o);
          start = null;
        }
      }
    }
  }
}

export const norm = (a: number) => {
  let y = a % (Math.PI * 2);
  if (y > Math.PI) y -= Math.PI * 2;
  if (y <= -Math.PI) y += Math.PI * 2;
  return y;
};

/** Yaw that faces from (x, z) towards (tx, tz) (yaw 0 faces -z). */
export const yawTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));
