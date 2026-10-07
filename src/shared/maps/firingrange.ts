/**
 * Firing Range (recreation of Black Ops 1's Firing Range, the Cuban training base; owner: maps-bo).
 * Rebuilt from the original's minimap and the Black Ops 6 remaster's tac maps (same layout); see
 * docs/maps/firingrange-reference.md for the reference, callouts and measurements.
 *
 * Metres, +x east, +z south (north is up on the overhead), yaw 0 faces north (-z).
 *
 *   Road            the north spawn: a gated road stub, x -18 .. -9, z -45 .. -30
 *   Showers         NW block (x -37 .. -23, z -33 .. -24) with covered porches either side
 *   Shoot House     L-shaped, turned 24 degrees: a two-storey bar along the Dirt Road and a
 *                   one-storey west room whose roof is a balcony off the upper floor; the covered
 *                   shed on its north side can be climbed (crates) for the view down the Dirt Road
 *   Dirt Road       from the Road mouth round the north edge to the red Storage shed (NE)
 *   Tower           wooden lookout (ladder, platform 4.6 m) at the centre crossroads, Domination B
 *   Office          the long single-storey hall on the west side, turned -20 degrees, porch north
 *   Building 7      corrugated workshop south of the crossroads
 *   rocks           the jungle hill in the middle (impassable) and a smaller outcrop south of it;
 *                   a sandy path runs between them from the crossroads to the Garage
 *   Garage          building 3, the car shop (east centre), S&D site B
 *   Range           the east courtyard (team 1 spawn) with the firing line looking out over the
 *                   target lanes beyond the fence
 *   Containers      the walk-through container north of the Bunker, Domination C
 *   Bunker          concrete range house on the south edge, stairs to its roof
 *
 * Several buildings stand at an angle, as in the original. Brushes are axis-aligned boxes, so a
 * turned building is drawn with `ry` (render only) and its collision is a run of thin axis-aligned
 * slices inside each wall (`Frame` below), close enough that bullets, players and sight all stop.
 */
import type { Vec3 } from '../math';
import { MapKit, yawTo } from './bo-kit';
import { unitVec, type Brush, type MapData, type MaterialDef, type ObjectivePoint, type SpawnPoint } from './types';

const PI = Math.PI;
const DEG = PI / 180;
/** Shoot House upper floor. */
const F2 = 3.2;
/** Tower platform. */
const TP = 4.6;
/** Bunker roof (walkable). */
const BR = 3.25;

export const FIRING_RANGE_BOUNDS = { min: { x: -41.5, y: -3, z: -46.5 }, max: { x: 40.5, y: 26, z: 46.5 } };

/** The playable outline (from the minimap), clockwise on the overhead. Everything outside is clipped. */
export const FIRING_RANGE_OUTLINE: [number, number][] = [
  [-37.1, -33.0], [-22.8, -33.0], [-22.8, -30.4], [-18.2, -30.4], [-18.2, -45.1], [-9.1, -45.1], [-9.1, -30.0],
  [-5.4, -25.2], [-2.5, -22.5], [0, -20.6], [4.5, -18.0], [10.3, -16.3], [14.5, -14.0], [17.5, -11.6], [19.2, -10.6],
  [24.4, -10.6], [24.4, 3.0], [38.5, 3.0], [38.5, 30.4], [4.8, 30.4], [4.6, 36.0], [4.2, 38.2], [1.6, 45.2],
  [-25.2, 35.6], [-26.6, 31.2], [-27.2, 26.1], [-33.0, 22.6], [-36.5, 20.0], [-37.1, 16.8], [-39.8, 16.1],
  [-39.8, -5.0], [-37.1, -5.0],
];

/** Impassable jungle rock: the central hill, and the smaller outcrop south of the Garage path. */
const ROCK_HILL: [number, number][] = [
  [-0.8, -7.7], [3.3, -9.4], [4.9, -10.9], [8.1, -11.1], [10.7, -10.2], [12.2, -9.5], [14.2, -5.7], [15.4, -3.7],
  [16.1, 0], [16.3, 7.3], [16.3, 12.4], [15.8, 12.4], [15.8, 15.0], [12.9, 15.0], [12.9, 12.2], [6.5, 10.0],
  [3.2, 7.9], [4.4, 5.7], [-3.0, 1.6], [-3.0, 0.2], [-2.7, -3.5],
];
const ROCK_SOUTH: [number, number][] = [
  [-1.8, 17.0], [1.7, 17.0], [5.5, 18.4], [9.4, 20.0], [13.0, 20.4], [15.1, 20.6], [15.1, 27.2], [2.8, 27.2], [2.3, 25.4], [-1.8, 25.4],
];

const MATERIALS: Record<string, MaterialDef> = {
  dirt: { texture: 'fr_dirt', uvMul: [1 / 5, 1 / 5] },
  mud: { texture: 'fr_dirt', tint: 0x9a8a78, uvMul: [1 / 3, 1 / 3] },
  road: { texture: 'fr_dirt', tint: 0x8a8070, uvMul: [1 / 4, 1 / 4] },
  grass: { texture: 'fr_grass', uvMul: [1 / 4, 1 / 4] },
  jungle: { texture: 'fr_jungle', uvMul: [1 / 4, 1 / 4] },
  rock: { texture: 'bo_rock', uvMul: [1 / 4, 1 / 4] },
  planks: { texture: 'bo_planks', uvMul: [1 / 2.4, 1 / 2.4] },
  planksDark: { texture: 'bo_planks', tint: 0x9a8a7a, uvMul: [1 / 2.4, 1 / 2.4] },
  ply: { texture: 'fr_ply', uvMul: [1 / 2.4, 1 / 2.4] },
  plyBlue: { texture: 'fr_ply', tint: 0x9aaabb, uvMul: [1 / 2.4, 1 / 2.4] },
  wood: { texture: 'bo_wood', uvMul: [1 / 1.2, 1 / 1.2] },
  tin: { texture: 'fr_tin', uvMul: [1 / 2.6, 1 / 2.6] },
  corr: { texture: 'fr_corr', tint: 0xa8b4c0, uvMul: [1 / 2.4, 1 / 2.4] },
  corrRed: { texture: 'fr_corr', tint: 0xb8584a, uvMul: [1 / 2.4, 1 / 2.4] },
  stripe: { texture: 'paint', tint: 0xd8b040 },
  logs: { texture: 'fr_logs', uvMul: [1 / 2, 1 / 1.2] },
  sandbag: { texture: 'bo_sandbag', uvMul: [1 / 1.6, 1 / 0.9] },
  concrete: { texture: 'bo_concrete', uvMul: [1 / 3, 1 / 3] },
  block: { texture: 'fr_block', uvMul: [1 / 2.4, 1 / 2.4] },
  target: { texture: 'fr_target' },
  foliage: { texture: 'fr_foliage', uvMul: [1 / 3, 1 / 3] },
  foliageDark: { texture: 'fr_foliage', tint: 0x7a8a6a, uvMul: [1 / 4, 1 / 4] },
  bush: { texture: 'fr_bush', side: 'double' },
  frondTop: { texture: 'fr_frondTop', side: 'double' },
  frondSide: { texture: 'fr_frondSide', side: 'double' },
  bark: { texture: 'fr_bark', uvMul: [1, 1 / 2] },
  lane1: { texture: 'fr_lane1' },
  lane2: { texture: 'fr_lane2' },
  lane3: { texture: 'fr_lane3' },
  lane4: { texture: 'fr_lane4' },
  sign: { texture: 'fr_sign', emissive: 0.2 },
  chain: { texture: 'fence', side: 'double' },
  steel: { texture: 'steel' },
  rubber: { texture: 'rubber', uvMul: [1 / 0.4, 1 / 0.4] },
  crate: { texture: 'crate', uvMul: [1 / 1.2, 1 / 1.2] },
  container: { texture: 'container2', uvMul: [1 / 6, 1 / 2.6] },
  barrelRed: { texture: 'barrel', tint: 0xa8382a, uvMul: [2, 1] },
  barrelGreen: { texture: 'barrel', tint: 0x5a6a3a, uvMul: [2, 1] },
  jeep: { texture: 'bo_carpaint', tint: 0x6a7048 },
  truck: { texture: 'bo_carpaint', tint: 0x5a6040 },
  car: { texture: 'bo_carpaint', tint: 0x8a8a84 },
  glass: { texture: 'bo_glass' },
  hills: { texture: 'fr_hills', side: 'double', fog: false, tint: 0xb8c4b0 },
  hillsFar: { texture: 'fr_hills', side: 'double', fog: false, tint: 0xa8b8c0 },
  lamp: { texture: 'lamp', emissive: 1 },
  clip: { texture: 'none' },
};

type BrushOpts = Partial<Omit<Brush, 'min' | 'max' | 'mat'>>;
type P2 = [number, number];
interface Hole {
  a0: number;
  a1: number;
  y0: number;
  y1: number;
}
interface Solidity {
  players?: boolean;
  bullets?: boolean;
  sight?: boolean;
}

const door = (a: number, w = 1.2, y = 0, h = 2.2): Hole => ({ a0: a - w / 2, a1: a + w / 2, y0: y, y1: y + h });
const win = (a0: number, a1: number, y0 = 1.0, y1 = 2.2): Hole => ({ a0, a1, y0, y1 });

/** Cross-section [lo, hi] of a convex polygon along the other axis at coordinate t of `axis`. */
function span(P: P2[], axis: 0 | 1, t: number): P2 | null {
  const o = axis === 0 ? 1 : 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < P.length; i++) {
    const a = P[i]!;
    const b = P[(i + 1) % P.length]!;
    if (t < Math.min(a[axis], b[axis]) || t > Math.max(a[axis], b[axis])) continue;
    if (Math.abs(b[axis] - a[axis]) < 1e-9) {
      lo = Math.min(lo, a[o], b[o]);
      hi = Math.max(hi, a[o], b[o]);
      continue;
    }
    const v = a[o] + ((b[o] - a[o]) * (t - a[axis])) / (b[axis] - a[axis]);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return lo <= hi ? [lo, hi] : null;
}

/** Solid wall segments of a wall from `lo` to `hi` (height h) with holes: [s0, s1, b0, b1]. */
function wallSegments(lo: number, hi: number, h: number, holes: Hole[]): [number, number, number, number][] {
  const hs = holes.map((k) => ({ a0: Math.max(lo, k.a0), a1: Math.min(hi, k.a1), y0: Math.max(0, k.y0), y1: Math.min(h, k.y1) })).filter((k) => k.a1 > k.a0 + 1e-6);
  const cuts = [...new Set([lo, hi, ...hs.flatMap((k) => [k.a0, k.a1])])].sort((p, q) => p - q);
  const out: [number, number, number, number][] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const s0 = cuts[i]!;
    const s1 = cuts[i + 1]!;
    if (s1 - s0 < 1e-6) continue;
    const mid = (s0 + s1) / 2;
    const open = hs.filter((k) => k.a0 <= mid && k.a1 >= mid).sort((p, q) => p.y0 - q.y0);
    let y = 0;
    for (const k of open) {
      if (k.y0 - y > 1e-6) out.push([s0, s1, y, k.y0]);
      y = Math.max(y, k.y1);
    }
    if (h - y > 1e-6) out.push([s0, s1, y, h]);
  }
  return out;
}

/**
 * Collision runs of a turned wall: horizontal bands between hole edges, each band's solid runs
 * merged, so the slices of neighbouring pieces never meet at a slanted joint (which would leave
 * a crack). Wall ends reach `t` past the corner to overlap the crossing wall.
 */
function wallBands(lo: number, hi: number, h: number, holes: Hole[], t: number): [number, number, number, number][] {
  const hs = holes.map((k) => ({ a0: Math.max(lo, k.a0), a1: Math.min(hi, k.a1), y0: Math.max(0, k.y0), y1: Math.min(h, k.y1) })).filter((k) => k.a1 > k.a0 + 1e-6 && k.y1 > k.y0 + 1e-6);
  const ys = [...new Set([0, h, ...hs.flatMap((k) => [k.y0, k.y1])])].filter((y) => y >= 0 && y <= h).sort((a, b) => a - b);
  const out: [number, number, number, number][] = [];
  let prev: string | null = null;
  for (let i = 0; i < ys.length - 1; i++) {
    const ya = ys[i]!;
    const yb = ys[i + 1]!;
    const cut = hs.filter((k) => k.y0 <= ya + 1e-6 && k.y1 >= yb - 1e-6).sort((p, q) => p.a0 - q.a0);
    const runs: [number, number][] = [];
    let a = lo;
    for (const k of cut) {
      if (k.a0 > a + 1e-6) runs.push([a, k.a0]);
      a = Math.max(a, k.a1);
    }
    if (hi > a + 1e-6) runs.push([a, hi]);
    const key = JSON.stringify(runs);
    for (const [r0, r1] of runs) {
      const s0 = r0 === lo ? r0 - t : r0;
      const s1 = r1 === hi ? r1 + t : r1;
      // Merge with the band below when the runs are identical.
      const last = key === prev ? out.find((q) => q[0] === s0 && q[1] === s1 && Math.abs(q[3] - ya) < 1e-9) : undefined;
      if (last) last[3] = yb;
      else out.push([s0, s1, ya, yb]);
    }
    prev = key;
  }
  return out;
}

/**
 * A building turned by `th` (radians, +u towards +z) about its corner (ox, oz). Local u/v
 * coordinates; boxes render rotated (`ry`) and collide as axis-aligned slices kept inside the
 * rotated box, along the world axis closest to the box's long side.
 */
class Frame {
  readonly c: number;
  readonly s: number;
  constructor(
    readonly k: MapKit,
    readonly ox: number,
    readonly oz: number,
    readonly th: number,
  ) {
    this.c = Math.cos(th);
    this.s = Math.sin(th);
  }

  w(u: number, v: number): P2 {
    return [this.ox + u * this.c - v * this.s, this.oz + u * this.s + v * this.c];
  }

  p(u: number, y: number, v: number): Vec3 {
    const [x, z] = this.w(u, v);
    return { x, y, z };
  }

  /** Render-only rotated box. */
  vis(u0: number, v0: number, u1: number, v1: number, y0: number, y1: number, mat: string, o: BrushOpts = {}): void {
    const [cx, cz] = this.w((u0 + u1) / 2, (v0 + v1) / 2);
    const hw = Math.abs(u1 - u0) / 2;
    const hd = Math.abs(v1 - v0) / 2;
    this.k.aabb(cx - hw, y0, cz - hd, cx + hw, y1, cz + hd, mat, { ...o, ry: -this.th, collide: false });
  }

  /** Invisible collision for a rotated box: axis-aligned slices inside it. */
  solid(u0: number, v0: number, u1: number, v1: number, y0: number, y1: number, mat: string, o: Solidity = {}, step?: number): void {
    const P: P2[] = [this.w(u0, v0), this.w(u1, v0), this.w(u1, v1), this.w(u0, v1)];
    const long: P2 = Math.abs(u1 - u0) >= Math.abs(v1 - v0) ? [this.c, this.s] : [-this.s, this.c];
    const short = Math.min(Math.abs(u1 - u0), Math.abs(v1 - v0));
    step ??= Math.min(this.sliceStep(short, long[0], long[1]), Math.max(0.15, short / 2.5));
    const axis: 0 | 1 = Math.abs(long[0]) >= Math.abs(long[1]) ? 0 : 1;
    // Slice boundaries at every corner, so only the slanted end faces are lost (see `cap`).
    const cuts = [...new Set(P.map((q) => q[axis]))].sort((p, q) => p - q);
    const flags: BrushOpts = { noRender: true, players: o.players ?? true, bullets: o.bullets ?? true, sight: o.sight ?? true };
    for (let j = 0; j < cuts.length - 1; j++) {
      const n = Math.max(1, Math.ceil((cuts[j + 1]! - cuts[j]!) / step - 1e-9));
      const ds = (cuts[j + 1]! - cuts[j]!) / n;
      for (let i = 0; i < n; i++) {
        const t0 = cuts[j]! + i * ds;
        const t1 = t0 + ds;
        const s0 = span(P, axis, t0 + 1e-6);
        const s1 = span(P, axis, t1 - 1e-6);
        if (!s0 || !s1) continue;
        const c0 = Math.max(s0[0], s1[0]);
        const c1 = Math.min(s0[1], s1[1]);
        if (c1 - c0 < 0.02) continue;
        if (axis === 0) this.k.aabb(t0, y0, c0, t1, y1, c1, mat, flags);
        else this.k.aabb(c0, y0, t0, c1, y1, t1, mat, flags);
      }
    }
  }

  /**
   * The bounding box of a small rotated rect (collision only): caps the slanted ends of wall runs
   * (beside doors, windows and corners) that the inner slices leave open.
   */
  cap(u0: number, v0: number, u1: number, v1: number, y0: number, y1: number, mat: string, o: Solidity = {}): void {
    const P: P2[] = [this.w(u0, v0), this.w(u1, v0), this.w(u1, v1), this.w(u0, v1)];
    const xs = P.map((q) => q[0]);
    const zs = P.map((q) => q[1]);
    this.k.aabb(Math.min(...xs), y0, Math.min(...zs), Math.max(...xs), y1, Math.max(...zs), mat, { noRender: true, players: o.players ?? true, bullets: o.bullets ?? true, sight: o.sight ?? true });
  }

  /** Rendered and solid. */
  box(u0: number, v0: number, u1: number, v1: number, y0: number, y1: number, mat: string, o: BrushOpts & Solidity = {}, step?: number): void {
    this.vis(u0, v0, u1, v1, y0, y1, mat, o);
    this.solid(u0, v0, u1, v1, y0, y1, mat, o, step);
  }

  /**
   * Slice length for a wall of thickness t running along (dx, dz): as long as possible while
   * neighbouring slices still overlap through the wall by 0.12 m (fewer solids for rays to test).
   */
  private sliceStep(t: number, dx: number, dz: number): number {
    const a = Math.max(Math.abs(dx), Math.abs(dz));
    const b = Math.min(Math.abs(dx), Math.abs(dz));
    if (b < 1e-3) return 1.0;
    const tan = b / a;
    const cos = a / Math.hypot(a, b);
    // Neighbouring slices overlap across the wall by t / cos - 2 * step * tan.
    return Math.max(0.12, Math.min(1.0, (t / cos - 0.12) / (2 * tan)));
  }

  /** Wall along u at v (thickness t), from y0 up h, with holes in u. Ends overlap corners by t/2. */
  wallU(v: number, u0: number, u1: number, y0: number, h: number, t: number, mat: string, holes: Hole[] = [], o: BrushOpts & Solidity = {}): void {
    for (const [s0, s1, b0, b1] of wallSegments(u0, u1, h, holes)) this.vis(s0 === u0 ? s0 - t / 2 : s0, v - t / 2, s1 === u1 ? s1 + t / 2 : s1, v + t / 2, y0 + b0, y0 + b1, mat, o);
    const step = this.sliceStep(t, this.c, this.s);
    for (const [s0, s1, b0, b1] of wallBands(u0, u1, h, holes, t)) {
      this.solid(s0, v - t / 2, s1, v + t / 2, y0 + b0, y0 + b1, mat, o, step);
      const e = Math.min(0.3, (s1 - s0) / 2);
      this.cap(s0, v - t / 2, s0 + e, v + t / 2, y0 + b0, y0 + b1, mat, o);
      this.cap(s1 - e, v - t / 2, s1, v + t / 2, y0 + b0, y0 + b1, mat, o);
    }
  }

  /** Wall along v at u. */
  wallV(u: number, v0: number, v1: number, y0: number, h: number, t: number, mat: string, holes: Hole[] = [], o: BrushOpts & Solidity = {}): void {
    for (const [s0, s1, b0, b1] of wallSegments(v0, v1, h, holes)) this.vis(u - t / 2, s0 === v0 ? s0 - t / 2 : s0, u + t / 2, s1 === v1 ? s1 + t / 2 : s1, y0 + b0, y0 + b1, mat, o);
    const step = this.sliceStep(t, -this.s, this.c);
    for (const [s0, s1, b0, b1] of wallBands(v0, v1, h, holes, t)) {
      this.solid(u - t / 2, s0, u + t / 2, s1, y0 + b0, y0 + b1, mat, o, step);
      const e = Math.min(0.3, (s1 - s0) / 2);
      this.cap(u - t / 2, s0, u + t / 2, s0 + e, y0 + b0, y0 + b1, mat, o);
      this.cap(u - t / 2, s1 - e, u + t / 2, s1, y0 + b0, y0 + b1, mat, o);
    }
  }

  /** A floor slab (top at `top`) over the rect minus rectangular holes [u0, v0, u1, v1]. */
  floor(u0: number, v0: number, u1: number, v1: number, top: number, thick: number, mat: string, holes: [number, number, number, number][] = [], o: BrushOpts = {}): void {
    const us = [...new Set([u0, u1, ...holes.flatMap((h) => [h[0], h[2]])])].filter((x) => x >= u0 && x <= u1).sort((a, b) => a - b);
    const vs = [...new Set([v0, v1, ...holes.flatMap((h) => [h[1], h[3]])])].filter((x) => x >= v0 && x <= v1).sort((a, b) => a - b);
    const inHole = (u: number, v: number) => holes.some((h) => u > h[0] && u < h[2] && v > h[1] && v < h[3]);
    for (let i = 0; i < us.length - 1; i++) {
      let start: number | null = null;
      for (let j = 0; j < vs.length; j++) {
        const solid = j < vs.length - 1 && !inHole((us[i]! + us[i + 1]!) / 2, (vs[j]! + vs[j + 1]!) / 2);
        if (solid && start === null) start = vs[j]!;
        if (!solid && start !== null) {
          this.box(us[i]!, start, us[i + 1]!, vs[j]!, top - thick, top, mat, o);
          start = null;
        }
      }
    }
  }

  /**
   * Stairs over the rect rising towards `dir`: rotated visual steps, and collision as solid
   * axis-aligned blocks sheared along the run (each step a box from y0 to its tread).
   */
  stairs(u0: number, v0: number, u1: number, v1: number, y0: number, y1: number, dir: '+u' | '-u' | '+v' | '-v', mat: string, n?: number): void {
    const alongU = dir === '+u' || dir === '-u';
    const steps = n ?? Math.max(2, Math.ceil((y1 - y0) / 0.2));
    const r0 = alongU ? u0 : v0;
    const r1 = alongU ? u1 : v1;
    const c0 = alongU ? v0 : u0;
    const c1 = alongU ? v1 : u1;
    const sign = dir[0] === '+' ? 1 : -1;
    const runDir: P2 = alongU ? [this.c, this.s] : [-this.s, this.c];
    const ax: 0 | 1 = Math.abs(runDir[0]) >= Math.abs(runDir[1]) ? 0 : 1;
    const halfW = (c1 - c0) / 2 / Math.abs(runDir[ax]);
    const cc = (c0 + c1) / 2;
    const at = (r: number): P2 => (alongU ? this.w(r, cc) : this.w(cc, r));
    for (let i = 0; i < steps; i++) {
      const a = sign > 0 ? r0 + ((r1 - r0) * i) / steps : r1 - ((r1 - r0) * (i + 1)) / steps;
      const b = sign > 0 ? r0 + ((r1 - r0) * (i + 1)) / steps : r1 - ((r1 - r0) * i) / steps;
      const top = y0 + ((y1 - y0) * (i + 1)) / steps;
      if (alongU) this.vis(a, c0, b, c1, top - Math.min(0.6, top - y0), top, mat, { hide: ['ny'] });
      else this.vis(c0, a, c1, b, top - Math.min(0.6, top - y0), top, mat, { hide: ['ny'] });
      const A = at(a);
      const B = at(b);
      const m = (A[1 - ax]! + B[1 - ax]!) / 2;
      const lo = Math.min(A[ax], B[ax]);
      const hi = Math.max(A[ax], B[ax]);
      const flags: BrushOpts = { noRender: true, players: true, bullets: true, sight: true, tag: 'stairs' };
      if (ax === 0) this.k.aabb(lo, y0, m - halfW, hi, top, m + halfW, mat, flags);
      else this.k.aabb(m - halfW, y0, lo, m + halfW, top, hi, mat, flags);
    }
  }

  /** A floor surface decal over the rect (render only), just above the ground. */
  floorDecal(u0: number, v0: number, u1: number, v1: number, mat: string, y = 0.02): void {
    const [x, z] = this.w((u0 + u1) / 2, (v0 + v1) / 2);
    this.k.flatDecal(u1 - u0, v1 - v0, mat, x, y, z, { ry: -this.th });
  }

  /** Upright post (render + collide as a small box). */
  post(u: number, v: number, h: number, mat: string, y0 = 0, r = 0.1): void {
    const [x, z] = this.w(u, v);
    this.k.aabb(x - r, y0, z - r, x + r, y0 + h, z + r, mat);
  }
}

// ---------------------------------------------------------------------------------------------
// Rasterised regions (outline clips, rock masses)
// ---------------------------------------------------------------------------------------------

function inside(poly: P2[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function edgeDist(poly: P2[], x: number, z: number): number {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j]!;
    const [bx, bz] = poly[i]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    d = Math.min(d, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return d;
}

/** Rows of cells (size `cell`) over [x0, x1] x [z0, z1] where `want(x, z)` holds, merged into rectangles of equal `level`. */
function raster(x0: number, z0: number, x1: number, z1: number, cell: number, want: (x: number, z: number) => boolean, level: (x: number, z: number) => number = () => 0): { x0: number; z0: number; x1: number; z1: number; level: number }[] {
  const nx = Math.round((x1 - x0) / cell);
  const nz = Math.round((z1 - z0) / cell);
  const rows: { a: number; b: number; level: number }[][] = [];
  for (let j = 0; j < nz; j++) {
    const z = z0 + (j + 0.5) * cell;
    const runs: { a: number; b: number; level: number }[] = [];
    let cur: { a: number; b: number; level: number } | null = null;
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * cell;
      if (!want(x, z)) {
        cur = null;
        continue;
      }
      const lv = level(x, z);
      if (cur && cur.level === lv) cur.b = i + 1;
      else runs.push((cur = { a: i, b: i + 1, level: lv }));
    }
    rows.push(runs);
  }
  // Merge identical runs down the rows.
  const out: { x0: number; z0: number; x1: number; z1: number; level: number }[] = [];
  let open = new Map<string, { a: number; b: number; level: number; j0: number }>();
  for (let j = 0; j <= nz; j++) {
    const next = new Map<string, { a: number; b: number; level: number; j0: number }>();
    for (const r of rows[j] ?? []) {
      const key = `${r.a},${r.b},${r.level}`;
      const o = open.get(key);
      next.set(key, o ? o : { ...r, j0: j });
      if (o) open.delete(key);
    }
    for (const o of open.values()) out.push({ x0: x0 + o.a * cell, z0: z0 + o.j0 * cell, x1: x0 + o.b * cell, z1: z0 + j * cell, level: o.level });
    open = next;
  }
  return out;
}

const hash = (x: number, z: number) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** Rock mass: terraced boxes (higher towards the middle) with an invisible clip above, palms on top. */
function rockMass(k: MapKit, poly: P2[], peak: number, palms: [number, number, number][]): void {
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs) * 2) / 2;
  const x1 = Math.ceil(Math.max(...xs) * 2) / 2;
  const z0 = Math.floor(Math.min(...zs) * 2) / 2;
  const z1 = Math.ceil(Math.max(...zs) * 2) / 2;
  const isIn = (x: number, z: number) => inside(poly, x, z);
  const lv = (x: number, z: number) => {
    const d = edgeDist(poly, x, z);
    const h = 1.8 + Math.min(d, 6) * 0.65 + (hash(Math.round(x / 3), Math.round(z / 3)) - 0.5) * 0.6;
    return Math.min(peak, Math.max(1.8, Math.round(h / 0.9) * 0.9));
  };
  for (const r of raster(x0, z0, x1, z1, 0.75, isIn, lv)) k.aabb(r.x0, 0, r.z0, r.x1, r.level, r.z1, 'rock', { hide: ['ny'] });
  for (const r of raster(x0, z0, x1, z1, 0.75, isIn)) k.clip(r.x0, 1.5, r.z0, r.x1, 12, r.z1, 'perimeter');
  for (const [x, z, h] of palms) palm(k, x, z, h, lv(x, z) - 0.2);
  for (let i = 0; i < poly.length; i += 2) {
    const [ax, az] = poly[i]!;
    const [bx, bz] = poly[(i + 1) % poly.length]!;
    bush(k, (ax * 2 + bx) / 3, (az * 2 + bz) / 3, 1.3 + hash(ax, az) * 0.8, 0.9);
  }
}

// ---------------------------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------------------------

/** A palm: trunk (collides when `collide`) and crossed frond cards. */
function palm(k: MapKit, x: number, z: number, h: number, y0 = 0, collide = false): void {
  k.cyl(0.17, h, 6, 'bark', x, y0 + h / 2, z, { collide });
  const top = y0 + h;
  k.flatDecal(5.2, 5.2, 'frondTop', x, top, z, { uv: 'raw', ry: hash(x, z) * PI, seg: 1 });
  k.flatDecal(4.2, 4.2, 'frondTop', x, top - 0.45, z, { uv: 'raw', ry: hash(z, x) * PI + 0.6, seg: 1 });
  k.wallDecal(4.8, 2.0, 'frondSide', x, top - 1.6, z, hash(x, z) * PI, { uv: 'raw', seg: 1 });
  k.wallDecal(4.8, 2.0, 'frondSide', x, top - 1.6, z, hash(x, z) * PI + PI / 2, { uv: 'raw', seg: 1 });
}

/** Broadleaf tree for the far tree line (render only). */
function tree(k: MapKit, x: number, z: number, h: number, r: number): void {
  k.cyl(r * 0.18, h, 6, 'bark', x, h / 2, z, { collide: false });
  k.box(r * 2, h * 0.3, r * 2, 'foliage', x, h * 0.6, z, { collide: false });
  k.box(r * 1.4, h * 0.22, r * 1.4, 'foliage', x + r * 0.2, h * 0.86, z - r * 0.15, { collide: false });
}

function bush(k: MapKit, x: number, z: number, s: number, y = 0): void {
  k.wallDecal(s * 1.6, s, 'bush', x, y, z, 0.4, { uv: 'raw', seg: 1 });
  k.wallDecal(s * 1.6, s, 'bush', x, y, z, 0.4 + PI / 2, { uv: 'raw', seg: 1 });
}

function crate(k: MapKit, x: number, z: number, s = 1.2, y = 0, collide = true): void {
  k.box(s, s, s, 'crate', x, y, z, { uv: 'raw', ...(collide ? {} : { collide: false }) });
}

function jeep(k: MapKit, x: number, z: number, alongX: boolean): void {
  const [w, d] = alongX ? [3.6, 1.7] : [1.7, 3.6];
  k.box(w, 0.75, d, 'jeep', x, 0.4, z);
  k.aabb(x - w / 2 + 0.1, 0, z - d / 2 + 0.1, x + w / 2 - 0.1, 0.4, z + d / 2 - 0.1, 'rubber', { players: true, bullets: false, sight: false });
  k.trim(alongX ? 0.08 : 1.6, 0.4, alongX ? 1.6 : 0.08, 'glass', alongX ? x - 0.5 : x, 1.15, alongX ? z : z - 0.5);
  for (const s of [-1, 1]) for (const e of [-1, 1]) k.cyl(0.38, 0.26, 8, 'rubber', alongX ? x + e * 1.2 : x + s * 0.9, 0.38, alongX ? z + s * 0.9 : z + e * 1.2, { axis: alongX ? 'z' : 'x', collide: false });
}

function sandbags(k: MapKit, x0: number, z0: number, x1: number, z1: number, h = 1.0, y = 0): void {
  k.aabb(x0, y, z0, x1, y + h, z1, 'sandbag');
}

/** A render-only fence of panels along a polyline (chain-link by default) with posts. */
function fenceLine(k: MapKit, pts: P2[], h: number, mat = 'chain', post = 'steel'): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i]!;
    const [bx, bz] = pts[i + 1]!;
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.2) continue;
    const ry = Math.atan2(-(bz - az), bx - ax);
    k.wallDecal(L, h, mat, (ax + bx) / 2, 0, (az + bz) / 2, ry);
    const n = Math.max(1, Math.round(L / 3));
    for (let j = 0; j <= n; j++) k.trim(0.08, h + 0.1, 0.08, post, ax + ((bx - ax) * j) / n, 0, az + ((bz - az) * j) / n);
  }
}

// ---------------------------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------------------------

function road(k: MapKit): void {
  // The gated road stub (north spawn) and the road beyond the gate.
  k.flatDecal(4.2, 60, 'road', -14.6, 0.015, -46, { seg: 4 });
  k.flatDecal(9, 4, 'road', -12.5, 0.016, -29, { seg: 2 });
  fenceLine(k, [[-18.2, -45.3], [-15.6, -45.3]], 2.4);
  fenceLine(k, [[-11.7, -45.3], [-9.1, -45.3]], 2.4);
  k.trim(3.9, 0.12, 0.1, 'stripe', -13.65, 1.0, -45.3);
  for (const x of [-15.6, -11.7]) k.box(0.2, 2.6, 0.2, 'steel', x, 0, -45.3, { collide: false });
  // Truck parked outside the gate, sandbag pits and crates along the stub walls.
  k.box(2.4, 1.6, 6.8, 'truck', -13.2, 0.9, -52, { collide: false });
  k.box(2.3, 1.2, 2.0, 'truck', -13.2, 2.5, -49.6, { collide: false });
  k.box(2.4, 1.5, 4.4, 'tin', -13.2, 2.5, -53.2, { collide: false });
  sandbags(k, -18.0, -41.2, -17.0, -38.6, 1.0);
  sandbags(k, -10.3, -36.0, -9.3, -33.4, 1.0);
  crate(k, -17.3, -31.8, 1.1);
  crate(k, -9.9, -41.2, 1.1);
  // The stub walls: corrugated sheds either side (out of bounds, visual).
  k.aabb(-24, 0, -45, -18.4, 3.6, -33.4, 'corr', { collide: false, faceMats: { py: 'tin' } });
  k.aabb(-8.9, 0, -45, -2, 3.2, -31, 'corr', { collide: false, faceMats: { py: 'tin' } });
  k.light(-13.6, 3.2, -40, [1.3, 1.1, 0.75], 10, 'lamp');
  k.trim(0.3, 0.2, 0.3, 'lamp', -9.3, 3.4, -40);
}

function showers(k: MapKit): void {
  // T-shaped block: south wing (enclosed), north centre stall block, covered porches either side.
  const H = 3.0;
  const t = 0.25;
  k.wall('x', -36.6, -22.8, -24.4 - t / 2, 0, H, t, 'plyBlue', [door(-33.4), win(-31.4, -29.4), door(-26.4), win(-25.2, -23.6)]);
  k.wall('x', -36.6, -22.8, -28.5 + t / 2, 0, H, t, 'plyBlue', [door(-34.4), door(-29.65), door(-24.8)]);
  k.wall('z', -28.5, -24.4, -36.6 + t / 2, 0, H, t, 'plyBlue', [door(-26.45)]);
  k.wall('z', -28.5, -24.4, -22.8 - t / 2, 0, H, t, 'plyBlue', [win(-27.4, -25.6)]);
  k.aabb(-36.8, H, -28.7, -22.6, H + 0.2, -24.2, 'tin', { faceMats: { ny: 'planksDark' } });
  k.flatDecal(13.8, 4.1, 'concrete', -29.7, 0.02, -26.45);
  k.flatDecal(4.7, 4.1, 'concrete', -29.65, 0.02, -30.55);
  // Stall block: shower stalls along the north wall.
  k.wall('z', -32.6, -28.5, -32 + t / 2, 0, H, t, 'plyBlue', []);
  k.wall('z', -32.6, -28.5, -27.3 - t / 2, 0, H, t, 'plyBlue', []);
  k.wall('x', -32, -27.3, -32.6 + t / 2, 0, H, t, 'plyBlue', [win(-30.4, -28.9, 1.6, 2.3)]);
  for (const x of [-30.8, -29.6, -28.4]) k.aabb(x - 0.03, 0, -32.35, x + 0.03, 2.0, -31.2, 'ply', { players: true, bullets: false, sight: false });
  k.aabb(-32.2, H, -32.8, -27.1, H + 0.2, -28.5, 'tin', { faceMats: { ny: 'planksDark' } });
  // Porches.
  for (const [x0, x1] of [[-36.6, -32], [-27.3, -22.8]] as const) {
    k.aabb(x0, 2.8, -32.8, x1, 2.95, -28.5, 'tin', { faceMats: { ny: 'planksDark' } });
    for (const x of [x0 + 0.15, x1 - 0.15]) k.box(0.18, 2.8, 0.18, 'wood', x, 0, -32.55);
    k.box(1.6, 0.8, 0.6, 'wood', (x0 + x1) / 2, 0, -31.9);
  }
  k.light(-29.6, 2.6, -26.5, [1.2, 1.05, 0.8], 7, 'lamp');
  // Inside: benches and lockers.
  k.box(2.4, 0.45, 0.5, 'wood', -34.2, 0, -25.0);
  k.box(0.5, 1.9, 2.4, 'steel', -23.35, 0, -26.5);
  // The yard south of the block: pallets, a concrete barrier, a fence stub.
  k.box(4.0, 0.9, 2.0, 'planksDark', -23.6, 0, -23.15);
  const bar = new Frame(k, -32.2, -19.3, -20 * DEG);
  bar.box(0, 0, 4.4, 0.9, 0, 1.0, 'concrete');
  k.aabb(-35.1, 0, -15.8, -34.9, 1.3, -10.8, 'plyBlue');
  k.aabb(-36.6, 0, -15.9, -34.9, 1.3, -15.7, 'plyBlue');
  // Generator hut north of the Shoot House (turned 30 degrees, sandbags on top).
  const gen = new Frame(k, -11.2, -21.9, 30 * DEG);
  gen.box(0, 0, 3.6, 3.6, 0, 2.5, 'planks');
  gen.vis(-0.1, -0.1, 3.7, 3.7, 2.5, 2.65, 'tin');
  gen.vis(0.2, 0.2, 3.4, 0.8, 2.65, 3.1, 'sandbag');
  // Crates by the Shoot House west end.
  crate(k, -18.6, -12.0, 1.2);
  crate(k, -18.3, -10.6, 1.0);
}

function shootHouse(k: MapKit): void {
  const f = new Frame(k, -17.2, -15.0, 24 * DEG);
  const t = 0.4;
  const top = 6.3;
  const up = (a0: number, a1: number) => win(a0, a1, F2 + 0.6, F2 + 2.1);
  // The bar: two storeys along the Dirt Road.
  f.wallU(0, 0, 18, 0, top, t, 'ply', [door(7.8), win(9.4, 10.8), door(13.2), up(3, 4.6), up(8.6, 10.4), up(11.6, 13.2), up(14.4, 16)]);
  f.wallU(4.6, 6.4, 18, 0, top, t, 'ply', [door(10.6), win(13.5, 15.5), door(16.8, 1.2), up(8, 10), up(13, 15.5)]);
  f.wallU(4.6, 0, 6.4, 0, top, t, 'ply', [door(2.6), door(1.6, 1.2, F2), up(3.6, 5.4)]);
  f.wallV(0, 0, 4.6, 0, top, t, 'ply', [door(2.3), up(1.5, 3.1)]);
  f.wallV(18, 0, 4.6, 0, top, t, 'ply', []);
  // Upper floor with the stairwell along the north wall; the flat roof.
  f.floor(0, 0, 18, 4.6, F2, 0.25, 'wood', [[2.0, 0.15, 7.2, 1.35]], { faceMats: { ny: 'planksDark' } });
  f.floorDecal(0, 0, 18, 4.6, 'planksDark');
  f.floorDecal(0, 4.6, 6.4, 10.5, 'concrete');
  f.stairs(2.0, 0.15, 7.2, 1.35, 0, F2, '+u', 'wood', 16);
  f.box(2.0, 1.35, 7.2, 1.45, F2, F2 + 0.95, 'wood', { bullets: false, sight: false });
  f.box(-0.3, -0.3, 18.3, 4.9, top, top + 0.2, 'tin', { faceMats: { ny: 'planksDark' } });
  f.vis(0, 4.75, 18, 4.95, 2.6, 2.95, 'stripe');
  // The west room: one storey; its roof is a balcony off the upper floor (sandbag parapet).
  f.wallV(0, 4.6, 10.5, 0, F2 + 0.7, t, 'ply', [win(7, 8.6)]);
  f.wallU(10.5, 0, 6.4, 0, F2 + 0.7, t, 'ply', [door(3.2), win(4.4, 5.8)]);
  f.wallV(6.4, 4.6, 10.5, 0, F2 + 0.7, t, 'ply', [door(8.8), win(5.6, 7)]);
  f.floor(0, 4.6, 6.4, 10.5, F2, 0.25, 'concrete', [], { faceMats: { ny: 'planksDark' } });
  f.vis(0.3, 10.0, 6.1, 10.35, F2 + 0.7, F2 + 1.0, 'sandbag');
  // The covered shed on the Dirt Road side: tin roof on posts (you can stand on it), crates to climb.
  for (const [u, v] of [[10.7, -5.3], [15.8, -5.3], [10.7, -0.3], [15.8, -0.3]] as const) f.post(u, v, 2.6, 'wood');
  f.box(10.4, -5.6, 16.1, -0.15, 2.6, 2.75, 'tin', { faceMats: { ny: 'planksDark' } });
  f.box(11.2, -4.6, 13.4, -3.4, 0, 0.9, 'crate', { uv: 'raw' });
  f.box(16.2, -3.6, 17.2, -2.4, 0, 2.0, 'crate', { uv: 'raw' });
  f.box(17.2, -3.6, 18.4, -2.4, 0, 1.0, 'crate', { uv: 'raw' });
  // Inside: plywood partitions, a table, a target stand; cots upstairs.
  f.box(9, 2.4, 9.1, 4.45, 0, 1.3, 'ply', { bullets: false });
  f.box(13.6, 0.15, 13.7, 2.2, 0, 1.3, 'ply', { bullets: false });
  f.box(3.5, 6.8, 5.3, 7.8, 0, 0.8, 'wood');
  f.box(11.5, 2.6, 12.5, 4.3, F2, F2 + 0.5, 'planksDark', { sight: false });
  f.box(15.5, 2.6, 16.5, 4.3, F2, F2 + 0.5, 'planksDark', { sight: false });
  const L = f.p(9, 2.6, 2.3);
  k.light(L.x, L.y, L.z, [1.3, 1.05, 0.7], 8, 'lamp');
  const L2 = f.p(12, F2 + 2.4, 2.3);
  k.light(L2.x, L2.y, L2.z, [1.3, 1.05, 0.7], 8, 'lamp');
  // The big painted "2".
  const [nx, nz] = f.w(4.5, -0.17);
  k.wallDecal(1.0, 1.4, 'lane2', nx, 3.8, nz, PI - 24 * DEG, { uv: 'raw' });
}

function tower(k: MapKit): void {
  // Wooden lookout at the crossroads: an enclosed base, the platform at TP, a ladder on the west face.
  const X0 = -6.4;
  const X1 = -3.0;
  const Z0 = 1.0;
  const Z1 = 4.4;
  const t = 0.2;
  k.wall('z', Z0, Z1, X0 + t / 2, 0, 2.6, t, 'planks', []);
  k.wall('z', Z0, Z1, X1 - t / 2, 0, 2.6, t, 'planks', []);
  k.wall('x', X0 + t, X1 - t, Z0 + t / 2, 0, 2.6, t, 'planks', []);
  k.wall('x', X0 + t, X1 - t, Z1 - t / 2, 0, 2.6, t, 'planks', [door(-4.7, 1.1)]);
  for (const [x, z] of [[X0 + 0.1, Z0 + 0.1], [X1 - 0.1, Z0 + 0.1], [X0 + 0.1, Z1 - 0.1], [X1 - 0.1, Z1 - 0.1]] as const) k.box(0.22, TP + 2.4, 0.22, 'wood', x, 0, z);
  k.aabb(X0, 2.6, Z0, X1, 2.75, Z1, 'planksDark');
  k.aabb(X0, 2.75, Z0, X0 + 0.1, TP, Z1, 'planks');
  k.aabb(X1 - 0.1, 2.75, Z0, X1, TP, Z1, 'planks');
  k.aabb(X0 + 0.1, 2.75, Z0, X1 - 0.1, TP, Z0 + 0.1, 'planks');
  k.aabb(X0 + 0.1, 2.75, Z1 - 0.1, X1 - 0.1, TP, Z1, 'planks');
  // Platform, half walls (gap at the ladder), roof with a camo net.
  k.aabb(X0, TP - 0.2, Z0 - 0.2, X1 + 0.2, TP, Z1 + 0.2, 'wood', { faceMats: { ny: 'planksDark' } });
  k.aabb(X0 - 0.2, TP, Z0 - 0.2, X1 + 0.2, TP + 1.0, Z0 - 0.05, 'planks');
  k.aabb(X0 - 0.2, TP, Z1 + 0.05, X1 + 0.2, TP + 1.0, Z1 + 0.2, 'planks');
  k.aabb(X1 + 0.05, TP, Z0 - 0.05, X1 + 0.2, TP + 1.0, Z1 + 0.05, 'planks');
  k.aabb(X0, TP, Z0 - 0.05, X0 + 0.15, TP + 1.0, 2.1, 'planks');
  k.aabb(X0, TP, 3.3, X0 + 0.15, TP + 1.0, Z1 + 0.05, 'planks');
  k.aabb(X0 - 0.5, TP + 2.3, Z0 - 0.5, X1 + 0.5, TP + 2.45, Z1 + 0.5, 'tin', { faceMats: { ny: 'planksDark' } });
  k.trim(3.8, 0.5, 3.8, 'foliageDark', (X0 + X1) / 2, TP + 2.45, (Z0 + Z1) / 2);
  // Ladder: a steep invisible ramp up the west face, rails and rungs to look at.
  k.ramp(X0 - 1.5, 0, 2.15, X0, TP, 3.25, '+x', 'clip', { noRender: true, players: true, bullets: false, sight: false, tag: 'stairs' });
  for (const z of [2.2, 3.2]) k.trim(0.08, TP + 1.0, 0.08, 'wood', X0 - 0.3, 0, z);
  for (let y = 0.35; y < TP + 0.9; y += 0.35) k.trim(0.06, 0.05, 1.0, 'wood', X0 - 0.3, y, 2.7);
  k.light(-4.7, TP + 2.1, 2.7, [1.4, 1.2, 0.8], 10, 'lamp');
  k.trim(0.4, 0.25, 0.4, 'lamp', -4.7, TP + 2.2, 2.7);
  // The sandbagged shed behind it, along the foot of the hill (turned 29 degrees).
  const a = new Frame(k, -3.0, 1.6, 29 * DEG);
  a.box(0, 0, 8.5, 2.5, 0, 2.6, 'corr');
  a.vis(-0.1, -0.1, 8.6, 2.6, 2.6, 2.75, 'tin');
  a.vis(0.3, 2.0, 8.2, 2.5, 2.75, 3.25, 'sandbag');
  // Crossroads cover: the jeep with its sandbags, an L of sandbags west of the flag.
  jeep(k, -7.4, 6.0, true);
  sandbags(k, -9.6, 7.0, -5.4, 7.7, 0.9);
  sandbags(k, -17.2, 0.0, -13.4, 0.8, 1.0);
  sandbags(k, -17.2, 0.8, -16.4, 4.0, 1.0);
  k.box(1.0, 1.6, 0.06, 'target', -10.6, 0, 6.4, { players: false, uv: 'raw' });
}

function office(k: MapKit): void {
  // The long single-storey hall (west side), turned -20 degrees, doors at both ends and the sides.
  const f = new Frame(k, -32.3, 3.0, -20 * DEG);
  const W = 6.3;
  const L = 19.8;
  const H = 3.6;
  const t = 0.4;
  f.wallV(0, 0, L, 0, H, t, 'ply', [win(3, 5), win(8.6, 10.6), door(12.4), win(15, 17)]);
  f.wallV(W, 0, L, 0, H, t, 'ply', [win(2, 4), door(5.6), win(8, 10.5), door(13.6), win(16, 18)]);
  f.wallU(0, 0, W, 0, H, t, 'ply', [door(3.15)]);
  f.wallU(L, 0, W, 0, H, t, 'ply', [door(3.15)]);
  f.floorDecal(0, 0, W, L, 'planksDark');
  f.vis(-0.17, 0, -0.16, L, 1.0, 1.25, 'stripe');
  f.vis(W + 0.16, 0, W + 0.17, L, 1.0, 1.25, 'stripe');
  // Ceiling (stops jumpers) and a low gable over it.
  f.floor(-0.2, -0.2, W + 0.2, L + 0.2, H + 0.15, 0.15, 'tin', [], { faceMats: { ny: 'planksDark' } });
  f.vis(-0.4, -0.4, W / 2, L + 0.4, H + 0.15, H + 0.85, 'tin', { hide: ['ny'] });
  f.vis(W / 2, -0.4, W + 0.4, L + 0.4, H + 0.15, H + 0.85, 'tin', { hide: ['ny'] });
  // Inside: plywood barriers, tables, a TV bench, target silhouettes.
  f.box(1.0, 6.8, 3.6, 7.0, 0, 1.2, 'ply');
  f.box(2.7, 11.2, 5.3, 11.4, 0, 1.2, 'ply');
  f.box(4.6, 15.4, 5.8, 17.8, 0, 0.85, 'wood');
  f.box(0.5, 2.0, 1.3, 4.4, 0, 0.85, 'wood');
  for (const v of [9.0, 14.0]) {
    const [x, z] = f.w(0.25, v);
    k.wallDecal(0.7, 1.6, 'target', x, 0.6, z, PI / 2 + 20 * DEG, { uv: 'raw' });
  }
  const c1 = f.p(3.15, 3.2, 5);
  const c2 = f.p(3.15, 3.2, 14.5);
  k.light(c1.x, c1.y, c1.z, [1.3, 1.05, 0.75], 8, 'lamp');
  k.light(c2.x, c2.y, c2.z, [1.3, 1.05, 0.75], 8, 'lamp');
  // The porch north of it: tin roof on posts, a low plywood wall on the west side.
  k.aabb(-32.5, 3.0, -9.6, -26.1, 3.15, 1.0, 'tin', { faceMats: { ny: 'planksDark' } });
  for (const [x, z] of [[-32.2, -9.4], [-26.4, -9.4], [-32.2, -4], [-26.4, -4], [-32.2, 0.8], [-26.4, 0.8]] as const) k.box(0.18, 3.0, 0.18, 'wood', x, 0, z);
  k.aabb(-32.35, 0, -9.0, -32.1, 1.1, -1.0, 'ply');
  k.box(2.2, 0.85, 0.9, 'wood', -29.3, 0, -7.0);
  crate(k, -27.4, -1.2, 1.1);
  k.aabb(-27.3, 0, -14.0, -27.1, 2.4, -10.0, 'ply');
  // Outside: log pile west of the south end, a short fence to the north-west.
  const logs = new Frame(k, -29.4, 14.6, -20 * DEG);
  logs.box(0, 0, 1.2, 4.6, 0, 1.0, 'logs');
  k.aabb(-34.4, 0, 2.9, -31.9, 1.2, 3.1, 'plyBlue');
  k.aabb(-39.6, 0, 9.3, -35.3, 1.0, 9.5, 'plyBlue');
  for (const [x, z, m] of [[-36.6, -2.4, 'barrelRed'], [-36.2, -1.6, 'barrelGreen'], [-23.4, 21.8, 'barrelGreen']] as const) k.cyl(0.32, 0.9, 8, m, x, 0.45, z);
}

function building7(k: MapKit): void {
  // Corrugated workshop south of the crossroads (the "7" with the yellow stripe).
  const f = new Frame(k, -12.9, 10.6, 14.5 * DEG);
  const W = 13.2;
  const D = 6.0;
  const H = 3.4;
  const t = 0.3;
  f.wallU(0, 0, W, 0, H, t, 'corr', [door(3.6, 1.3), win(6, 7.8), door(9.6, 1.3)]);
  f.wallU(D, 0, W, 0, H, t, 'corr', [win(2, 4), door(6.6, 1.3), win(9.5, 11.5)]);
  f.wallV(0, 0, D, 0, H, t, 'corr', [door(3.0)]);
  f.wallV(W, 0, D, 0, H, t, 'corr', []);
  f.floorDecal(0, 0, W, D, 'concrete');
  f.vis(0, -0.17, W, -0.16, 1.2, 1.6, 'stripe');
  f.vis(0, D + 0.16, W, D + 0.17, 1.2, 1.6, 'stripe');
  f.floor(-0.2, -0.2, W + 0.2, D + 0.2, H + 0.15, 0.15, 'tin', [], { faceMats: { ny: 'planksDark' } });
  f.vis(-0.4, -0.5, W + 0.4, D / 2, H + 0.15, H + 1.3, 'tin', { hide: ['ny'] });
  f.vis(-0.4, D / 2, W + 0.4, D + 0.5, H + 0.15, H + 1.3, 'tin', { hide: ['ny'] });
  const [sx, sz] = f.w(12.2, -0.17);
  k.wallDecal(1.0, 1.3, 'lane4', sx, 1.9, sz, PI - 14.5 * DEG, { uv: 'raw' });
  // Inside: workbench, tyre stacks, shelving.
  f.box(0.4, 0.3, 4.4, 1.0, 0, 0.9, 'wood');
  f.box(11.0, 4.6, 12.8, 5.6, 0, 1.9, 'steel');
  for (const u of [7.6, 8.4]) {
    const [x, z] = f.w(u, 4.9);
    k.cyl(0.4, 0.9, 10, 'rubber', x, 0.45, z);
  }
  const c = f.p(6.6, 3.0, 3);
  k.light(c.x, c.y, c.z, [1.3, 1.05, 0.75], 8, 'lamp');
  // The fence stub between it and the hill.
  k.aabb(-1.75, 0, 10.6, -1.55, 1.1, 13.2, 'plyBlue');
}

function bunker(k: MapKit): void {
  // Concrete range house on the south edge: shooting benches along the south slits, roof you can
  // stand on (sandbag parapet), stairs up its north side.
  const f = new Frame(k, -22.2, 27.6, 19.8 * DEG);
  const W = 17.1;
  const D = 8.5;
  const H = BR;
  const t = 0.45;
  f.wallU(0, 0, W, 0, H, t, 'block', [door(3.6), win(10.4, 11.6, 1.2, 1.6), door(13.2)]);
  f.wallU(D, 0, W, 0, H, t, 'block', [win(2, 4, 1.2, 1.6), win(6, 8, 1.2, 1.6), win(10, 12, 1.2, 1.6), win(14, 16, 1.2, 1.6)]);
  f.wallV(0, 0, D, 0, H, t, 'block', [win(3.5, 5, 1.2, 1.6)]);
  f.wallV(W, 0, D, 0, H, t, 'block', [door(4.2)]);
  f.floorDecal(0, 0, W, D, 'concrete');
  f.floor(-0.25, -0.25, W + 0.25, D + 0.25, H, 0.3, 'concrete', [], { faceMats: { ny: 'concrete' } });
  // Parapet: sandbags round the roof, a gap where the stairs land.
  f.box(-0.25, -0.25, 7.2, 0.3, H, H + 0.6, 'sandbag');
  f.box(9.7, -0.25, W + 0.25, 0.3, H, H + 0.6, 'sandbag');
  f.box(-0.25, D - 0.3, W + 0.25, D + 0.25, H, H + 0.6, 'sandbag');
  f.box(-0.25, 0.3, 0.3, D - 0.3, H, H + 0.6, 'sandbag');
  f.box(W - 0.3, 0.3, W + 0.25, D - 0.3, H, H + 0.6, 'sandbag');
  f.vis(3.5, 3.0, 5.5, 5.0, H, H + 0.25, 'tin');
  // Benches along the south wall, a target board on the west wall.
  for (const u of [3, 7, 11, 15]) f.box(u - 1.2, D - 1.4, u + 1.2, D - 0.7, 0, 0.85, 'wood');
  f.box(4.0, 2.0, 5.0, 3.6, 0, 1.0, 'crate', { uv: 'raw' });
  const L1 = f.p(5, 2.8, 4.2);
  const L2 = f.p(12, 2.8, 4.2);
  k.light(L1.x, L1.y, L1.z, [1.3, 1.0, 0.65], 8, 'lamp');
  k.light(L2.x, L2.y, L2.z, [1.3, 1.0, 0.65], 8, 'lamp');
  // Stairs to the roof up the north side (axis-aligned, rising south) and a landing on the wall top.
  k.stairs(-15.4, 0, 25.6, -13.2, H, 30.0, '+z', 'wood', 15);
  k.aabb(-15.4, H - 0.2, 30.0, -13.2, H, 31.2, 'wood');
  k.aabb(-13.2, H, 25.6, -13.12, H + 0.9, 30.0, 'wood', { bullets: false, sight: false });
  // Generator by the east end.
  k.box(1.8, 1.4, 1.2, 'steel', -7.6, 0, 39.6);
}

function containers(k: MapKit): void {
  // The walk-through shipping container north of the Bunker (Domination C beside it).
  const f = new Frame(k, -17.45, 20.4, 20 * DEG);
  f.wallU(0, 0, 6.1, 0, 2.6, 0.2, 'container');
  f.wallU(2.45, 0, 6.1, 0, 2.6, 0.2, 'container', [{ a0: 3.4, a1: 4.4, y0: 0, y1: 1.7 }]);
  f.box(-0.06, -0.06, 6.16, 2.51, 2.6, 2.72, 'container');
  // Pallets and crates round the yard.
  crate(k, -4.5, 25.0, 1.2);
  crate(k, -3.4, 25.3, 1.0);
  k.box(1.4, 0.9, 1.2, 'planksDark', -11.0, 0, 21.2);
  // The south yard east of the Bunker: a crate stack and a cable drum.
  const c = new Frame(k, 0.6, 30.9, 10 * DEG);
  c.box(0, 0, 2.2, 3.1, 0, 1.3, 'crate', { uv: 'raw' });
  k.cyl(0.7, 1.0, 10, 'planksDark', -2.6, 0.5, 40.2);
  for (const [x, z, m] of [[-6.4, 26.6, 'barrelRed'], [3.8, 41.5, 'barrelGreen']] as const) k.cyl(0.32, 0.9, 8, m, x, 0.45, z);
}

function storage(k: MapKit): void {
  // The red Storage shed on the Dirt Road ("NEXT TIME BRING BEER").
  const X0 = 19.4;
  const X1 = 24.2;
  const Z0 = -10.4;
  const Z1 = -4.6;
  const t = 0.2;
  k.wall('z', Z0, Z1, X0 + t / 2, 0, 2.8, t, 'corrRed', [door(-7.4, 1.2), win(-5.8, -5.0)]);
  k.wall('z', Z0, Z1, X1 - t / 2, 0, 2.8, t, 'corrRed', []);
  k.wall('x', X0 + t, X1 - t, Z0 + t / 2, 0, 2.8, t, 'corrRed', []);
  k.wall('x', X0 + t, X1 - t, Z1 - t / 2, 0, 2.8, t, 'corrRed', [door(21.4, 1.2), win(22.6, 23.6)]);
  k.ramp(X0 - 0.3, 2.8, Z0 - 0.3, (X0 + X1) / 2, 3.5, Z1 + 0.3, '+x', 'tin', { collide: false });
  k.ramp((X0 + X1) / 2, 2.8, Z0 - 0.3, X1 + 0.3, 3.5, Z1 + 0.3, '-x', 'tin', { collide: false });
  k.aabb(X0, 2.8, Z0, X1, 2.9, Z1, 'planksDark', { hide: ['py'] });
  crate(k, 23.4, -9.6, 1.1);
  crate(k, 23.4, -8.4, 1.1);
  k.box(2.0, 0.9, 0.7, 'wood', 21.8, 0, -10.0);
  k.light(21.8, 2.5, -7.5, [1.2, 1.0, 0.7], 6, 'lamp');
  k.wallDecal(3.0, 0.7, 'sign', 21.8, 1.9, -4.48, 0, { uv: 'raw' });
  // Path cover between the shed and the Garage: drums and a sandbag wall.
  for (const [x, z, m] of [[18.4, -2.0, 'barrelRed'], [19.0, -1.3, 'barrelGreen'], [23.4, 0.8, 'barrelGreen']] as const) k.cyl(0.32, 0.9, 8, m, x, 0.45, z);
  sandbags(k, 20.2, 1.0, 22.8, 1.7, 1.0);
}

function garage(k: MapKit): void {
  // Building 3, the car shop: a tall workshop hall (roll-up door to the Range courtyard), the
  // office block north of it, an awning and a covered porch south.
  const t = 0.3;
  const H = 4.2;
  k.wall('z', 12.4, 22.4, 15.8 + t / 2, 0, H, t, 'corr', [door(17.5, 2.0), win(13.4, 14.8)]);
  k.wall('z', 12.4, 22.4, 28.2 - t / 2, 0, H, t, 'corr', [{ a0: 14.0, a1: 18.0, y0: 0, y1: 3.0 }, door(20.6)]);
  k.wall('x', 15.8 + t, 28.2 - t, 22.4 - t / 2, 0, H, t, 'corr', [door(17.6), door(23.7, 1.4), win(25.4, 27.2)]);
  k.wall('x', 15.8 + t, 28.2 - t, 12.4 + t / 2, 0, H, t, 'corr', [door(20.6), door(26.6)]);
  k.aabb(15.8, H, 12.2, 28.2, H + 0.2, 22.6, 'tin', { faceMats: { ny: 'planksDark' } });
  k.flatDecal(12.4, 10, 'concrete', 22, 0.02, 17.4);
  k.flatDecal(8.6, 5.1, 'planksDark', 20.6, 0.02, 9.85);
  for (let x = 17; x < 28; x += 2.2) k.trim(0.15, 0.2, 10, 'wood', x, H - 0.4, 17.4);
  k.trim(12.4, 0.3, 0.3, 'stripe', 22, 1.6, 22.58);
  // Inside: the car on blocks, workbenches, tyres, shelving.
  k.box(1.8, 0.8, 4.2, 'car', 18.5, 0.5, 17.6);
  k.box(1.6, 0.5, 2.2, 'car', 18.5, 1.3, 17.9);
  for (const z of [16.2, 19.0]) k.box(1.9, 0.5, 0.5, 'steel', 18.5, 0, z);
  k.box(0.7, 0.9, 3.0, 'wood', 27.5, 0, 21.0);
  k.box(3.0, 0.9, 0.7, 'wood', 25.6, 0, 13.0);
  k.box(0.5, 2.0, 2.4, 'steel', 16.25, 0, 20.6);
  for (const [x, z] of [[24.6, 20.8], [25.4, 21.2]] as const) k.cyl(0.4, 0.9, 10, 'rubber', x, 0.45, z);
  k.light(20, 3.8, 15.5, [1.3, 1.05, 0.75], 10, 'lamp');
  k.light(25, 3.8, 19.5, [1.3, 1.05, 0.75], 10, 'lamp');
  // Office block.
  const H2 = 3.2;
  k.wall('x', 16.3, 24.9, 7.3 + t / 2, 0, H2, t, 'plyBlue', [door(20.1), win(17.4, 18.8), win(22.2, 23.8)]);
  k.wall('z', 7.3 + t, 12.4, 16.3 + t / 2, 0, H2, t, 'plyBlue', []);
  k.wall('z', 7.3 + t, 12.4, 24.9 - t / 2, 0, H2, t, 'plyBlue', [door(10.1)]);
  k.aabb(16.1, H2, 7.1, 25.1, H2 + 0.2, 12.4, 'tin', { faceMats: { ny: 'planksDark' } });
  k.box(2.4, 0.85, 1.1, 'wood', 18.2, 0, 9.4);
  k.box(0.6, 1.9, 2.0, 'steel', 16.75, 0, 10.6);
  k.light(20.6, 2.8, 9.8, [1.2, 1.0, 0.7], 6, 'lamp');
  // Awning east of the office, the fence beside it.
  k.aabb(24.9, 2.8, 8.6, 27.3, 2.95, 12.4, 'tin', { faceMats: { ny: 'planksDark' } });
  for (const z of [8.8, 12.2]) k.box(0.18, 2.8, 0.18, 'wood', 27.1, 0, z);
  k.aabb(27.3, 0, 8.9, 29.2, 1.6, 9.1, 'plyBlue');
  // Covered porch south.
  k.aabb(20.8, 3.0, 22.4, 27.9, 3.15, 27.4, 'tin', { faceMats: { ny: 'planksDark' } });
  for (const [x, z] of [[21.2, 27.0], [27.5, 27.0], [21.2, 24.6], [27.5, 24.6]] as const) k.box(0.18, 3.0, 0.18, 'wood', x, 0, z);
  k.box(2.0, 0.85, 0.8, 'wood', 24.4, 0, 26.6);
  crate(k, 26.8, 25.9, 1.1);
  // The south corridor ("Depot"): concrete walk under a lean-to along the south edge.
  k.flatDecal(12.4, 3.0, 'concrete', 9.0, 0.02, 28.85, { seg: 4 });
  k.aabb(5.7, 2.6, 27.5, 15.1, 2.75, 30.4, 'tin', { faceMats: { ny: 'planksDark' } });
  for (const x of [5.9, 10.4, 14.9]) k.box(0.18, 2.6, 0.18, 'wood', x, 0, 27.7);
  k.aabb(4.8, 0, 30.2, 15.1, 2.6, 30.6, 'block');
  crate(k, 12.6, 29.5, 1.0);
}

function range(k: MapKit): void {
  // The Range courtyard (team 1 spawn): the firing line along the east fence, an awning on the north
  // wall, and the target lanes beyond the fence (scenery).
  k.aabb(34.6, 2.8, 7.6, 38.6, 2.95, 30.0, 'tin', { faceMats: { ny: 'planksDark' } });
  for (let z = 8; z <= 29.6; z += 3.6) {
    k.box(0.18, 2.8, 0.18, 'wood', 34.8, 0, z);
    k.box(0.18, 2.8, 0.18, 'wood', 38.3, 0, z);
  }
  // Benches (crouch cover) with lane numbers, plywood partitions between the booths.
  let lane = 0;
  for (let z = 8; z < 29; z += 3.6) {
    k.aabb(35.6, 0, z + 0.6, 36.3, 0.95, z + 3.0, 'planks', { faceMats: { py: 'wood' } });
    k.wallDecal(0.8, 0.8, `lane${(lane++ % 4) + 1}`, 35.58, 1.2, z + 1.8, -PI / 2, { uv: 'raw' });
    k.aabb(35.2, 0, z - 0.04, 38.2, 1.6, z + 0.04, 'ply', { bullets: false });
  }
  k.wallDecal(29.6, 2.6, 'chain', 38.45, 0, 19.0, PI / 2);
  k.light(36.5, 2.6, 12, [1.3, 1.1, 0.75], 8, 'lamp');
  k.light(36.5, 2.6, 24, [1.3, 1.1, 0.75], 8, 'lamp');
  // North awning (armory): back wall on the boundary, tin roof on posts, crates under it.
  k.aabb(30.8, 0, 3.0, 38.5, 3.2, 3.3, 'plyBlue');
  k.aabb(30.8, 3.0, 3.0, 38.5, 3.15, 6.6, 'tin', { faceMats: { ny: 'planksDark' } });
  for (const x of [31.0, 34.7, 38.3]) k.box(0.18, 3.0, 0.18, 'wood', x, 0, 6.4);
  crate(k, 31.9, 4.1, 1.1);
  crate(k, 37.3, 4.2, 1.2);
  crate(k, 37.4, 4.2, 1.0, 1.2, false);
  // Courtyard cover: ammo crates, the jeep, jersey barriers by the south fence.
  k.box(2.0, 1.2, 1.9, 'crate', 33.0, 0, 12.25, { uv: 'raw' });
  jeep(k, 32.3, 17.5, false);
  k.aabb(30.2, 0, 25.4, 31.0, 1.0, 29.4, 'concrete');
  k.aabb(24.5, 0, 9.9, 25.7, 1.0, 11.1, 'crate', { uv: 'raw' });
  // Target lanes beyond the fence (out of bounds): lane strips, frames with targets, the berm.
  k.flatDecal(40, 22, 'mud', 60, 0.012, 19);
  for (const z of [11, 15, 19, 23, 27]) k.flatDecal(40, 0.3, 'grass', 60, 0.014, z, { seg: 1 });
  for (const x of [48, 58, 68]) {
    for (let z = 9.8; z <= 28.4; z += 3.6) {
      k.box(0.1, 1.7, 0.8, 'target', x, 0.4, z, { collide: false, uv: 'raw' });
      k.trim(0.08, 0.4, 0.08, 'wood', x, 0, z);
      k.trim(1.0, 0.5, 1.6, 'concrete', x - 0.7, 0, z);
    }
  }
  k.aabb(76, 0, 6, 80, 4, 32, 'dirt', { collide: false, faceMats: { nx: 'logs' } });
}

function outline(k: MapKit): void {
  // Clips everything outside the playable outline (players only; bullets and sight pass).
  const b = FIRING_RANGE_BOUNDS;
  for (const r of raster(b.min.x, b.min.z, b.max.x, b.max.z, 0.5, (x, z) => !inside(FIRING_RANGE_OUTLINE, x, z))) k.clip(r.x0, b.min.y, r.z0, r.x1, 14, r.z1, 'perimeter');
  k.perimeter(b, 14);
  // What you see at the edges: fences, the jungle wall behind them, palms.
  fenceLine(k, [[-9.1, -30.0], [-5.4, -25.2], [-2.5, -22.5], [0, -20.6], [4.5, -18.0], [10.3, -16.3], [14.5, -14.0], [17.5, -11.6], [19.2, -10.6]], 2.4);
  fenceLine(k, [[-37.1, -24.2], [-37.1, -5.0], [-39.8, -5.0], [-39.8, 16.1], [-37.1, 16.8], [-36.5, 20.0], [-33.0, 22.6], [-27.2, 26.1], [-26.6, 31.2], [-25.2, 35.6]], 2.4, 'plyBlue', 'wood');
  fenceLine(k, [[38.5, 3.0], [38.5, 7.6]], 2.4);
  fenceLine(k, [[38.5, 30.4], [15.1, 30.4]], 2.4);
  fenceLine(k, [[4.8, 30.4], [4.6, 36.0], [4.2, 38.2], [1.6, 45.2], [-7.6, 41.9]], 2.4);
  fenceLine(k, [[24.4, -10.6], [24.4, 3.0]], 2.4);
  // Jungle walls just outside each edge.
  const P = FIRING_RANGE_OUTLINE;
  for (let i = 0; i < P.length; i++) {
    const [ax, az] = P[i]!;
    const [bx, bz] = P[(i + 1) % P.length]!;
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1 || (ax === 38.5 && bx === 38.5)) continue; // keep the view over the target lanes open
    // Outward normal of a clockwise (on screen, z down) outline is (dz, -dx) / L.
    const nx = (bz - az) / L;
    const nz = -(bx - ax) / L;
    const th = Math.atan2(bz - az, bx - ax);
    const h = 3.5 + hash(ax, bz) * 2.5;
    // Shorten the wall until none of it reaches back into the playable area (concave corners).
    const ux = (bx - ax) / L;
    const uz = (bz - az) / L;
    const clear = (half: number) =>
      [-1, 0, 1].every((a) => [3.5, 6.5].every((o) => !inside(FIRING_RANGE_OUTLINE, (ax + bx) / 2 + ux * half * a + nx * o, (az + bz) / 2 + uz * half * a + nz * o)));
    let half = L / 2 + 0.5;
    while (half > 1 && !clear(half)) half -= 1;
    if (half > 1) {
      const cx = (ax + bx) / 2 + nx * 5;
      const cz = (az + bz) / 2 + nz * 5;
      // A quarter-turned box gives its footprint already turned (see Brush.ry).
      const [hx, hz] = Math.abs(Math.sin(th)) > 0.5 ? [1.5, half] : [half, 1.5];
      k.aabb(cx - hx, 0, cz - hz, cx + hx, h, cz + hz, 'foliageDark', { collide: false, ry: -th });
    }
    for (let s = 0.2; s < 1; s += 0.3) {
      const px = ax + (bx - ax) * s + nx * 7;
      const pz = az + (bz - az) * s + nz * 7;
      if (edgeDist(FIRING_RANGE_OUTLINE, px, pz) > 3 && !inside(FIRING_RANGE_OUTLINE, px, pz)) palm(k, px, pz, 7 + hash(ax * s, az) * 4);
    }
  }
}

function backdrop(k: MapKit): void {
  // Garage sheds and parked trucks outside the NE corner, sheds north of the Showers.
  k.aabb(18, 0, -26, 31, 4.2, -12, 'corr', { collide: false, faceMats: { py: 'tin' } });
  k.box(2.4, 2.4, 6.6, 'truck', 32, 0, -12, { collide: false });
  k.box(2.2, 2.2, 6.4, 'truck', 30, 0, 0, { collide: false, ry: 0.3 });
  k.aabb(-37, 0, -40, -31, 3.0, -34.5, 'corr', { collide: false, faceMats: { py: 'tin' } });
  k.aabb(-29, 0, -40, -23, 3.0, -34.5, 'corr', { collide: false, faceMats: { py: 'tin' } });
  // Tree ring, jungle floor and the hills.
  for (let a = 0; a < 44; a++) {
    const t = (a / 44) * PI * 2;
    const rx = 64 + 6 * Math.sin(a * 2.3);
    const rz = 62 + 6 * Math.cos(a * 1.7);
    const x = Math.cos(t) * rx;
    const z = Math.sin(t) * rz;
    if (x > 40 && Math.abs(z - 19) < 16) continue; // keep the target lanes open
    if (a % 4 === 0) tree(k, x, z, 9 + 4 * Math.abs(Math.sin(a * 1.31)), 3 + Math.abs(Math.cos(a * 0.7)));
    palm(k, x * 0.9, z * 0.9, 10 + 4 * Math.abs(Math.sin(a * 0.9)));
  }
  k.backdropRing('hillsFar', 180, 9, 150, 55, -3, 0.2);
  k.backdropRing('hills', 125, 11, 85, 28, -2);
}

export function buildFiringRange(): MapData {
  const k = new MapKit();
  k.aabb(-260, -1, -260, 260, 0, 260, 'dirt', { hide: ['ny'] });
  outline(k);
  road(k);
  showers(k);
  shootHouse(k);
  tower(k);
  office(k);
  building7(k);
  bunker(k);
  containers(k);
  storage(k);
  garage(k);
  range(k);
  rockMass(k, ROCK_HILL, 5.4, [[6, -6, 9], [10, -4, 10], [8, 2, 8], [12, 6, 9], [3, -3, 8], [13, -1, 9]]);
  rockMass(k, ROCK_SOUTH, 3.6, [[4, 22, 8], [9, 24, 9], [12.5, 23, 7]]);
  backdrop(k);
  // Ground detail: the dirt road, grass at the edges, palms inside the playable area (trunks collide).
  k.flatDecal(6, 22, 'road', -6.5, 0.012, -22, { ry: -0.75, seg: 3 });
  k.flatDecal(6, 16, 'road', 8, 0.012, -14.2, { ry: -1.25, seg: 3 });
  for (const [x, z, w, d] of [[-34, -12, 4, 10], [-36, 12, 5, 8], [-6, 36, 8, 8], [29, 28, 4, 4], [-20, -27, 4, 4]] as const) k.flatDecal(w, d, 'grass', x, 0.01, z);
  for (const [x, z, h] of [[-35.5, -20, 8], [-38.5, 3, 9], [-21, 23.5, 8], [-1, 43, 9], [20.5, 4.4, 8], [37, 28.6, 8], [-24.5, -16.5, 7]] as const) palm(k, x, z, h, 0, true);
  for (const [x, z, s] of [[-36, -26, 1.1], [-30.5, -9, 1.0], [-38.5, 13, 1.2], [-25, 25, 1.0], [-3, 29.8, 1.1], [2.5, 43.5, 1.2], [37.5, 27, 1.0], [18, 2.5, 1.0], [-8.5, -26.5, 1.2]] as const) bush(k, x, z, s);

  // ---- spawns ----
  const S = PI;
  const W = PI / 2;
  const sp = (x: number, y: number, z: number, yaw = 0): SpawnPoint => ({ x, y, z, yaw });
  const team0 = [[-16.6, -43.4], [-13.6, -43.4], [-10.7, -43.4], [-15.1, -40.4], [-12.1, -40.4], [-16.6, -36.6], [-13.6, -37.4], [-10.7, -37.4], [-15.1, -33.6], [-12.1, -33.6]].map(([x, z]) => sp(x!, 0, z!, S));
  const team1 = [[30.0, 9.0], [33.2, 9.6], [29.6, 12.6], [33.4, 14.5], [29.3, 17.6], [30.4, 21.6], [33.4, 22.6], [33.6, 27.4], [29.4, 24.0]].map(([x, z]) => sp(x!, 0, z!, W));
  const shU = new Frame(k, -17.2, -15.0, 24 * DEG);
  const ofU = new Frame(k, -32.3, 3.0, -20 * DEG);
  const b7U = new Frame(k, -12.9, 10.6, 14.5 * DEG);
  const bkU = new Frame(k, -22.2, 27.6, 19.8 * DEG);
  const at = (f: Frame, u: number, v: number): P2 => f.w(u, v);
  const ffaAt: [number, number, number][] = [
    [-13.6, 0, -39], [-29.5, 0, -21.5], [-25, 0, -26.5], [-35, 0, -8], [-36.5, 0, 10], [at(ofU, 3.1, 9.9)[0], 0, at(ofU, 3.1, 9.9)[1]],
    [-20, 0, 7], [at(shU, 14, 1.4)[0], F2, at(shU, 14, 1.4)[1]], [6, 0, -14.5], [21.8, 0, -7.5], [20, 0, 4.6], [18.6, 0, 14.4],
    [30, 0, 20], [9, 0, 28.8], [-1, 0, 37], [at(b7U, 6.6, 3)[0], 0, at(b7U, 6.6, 3)[1]], [at(bkU, 8.5, 4.25)[0], 0, at(bkU, 8.5, 4.25)[1]], [-9, 0, 22],
  ];
  const ffa = ffaAt.map(([x, y, z]) => sp(x, y, z, yawTo(x, z, -4, 6)));

  // ---- objectives ----
  const P = (id: string, x: number, y: number, z: number, radius: number, team?: 0 | 1): ObjectivePoint => (team === undefined ? { id, x, y, z, radius } : { id, x, y, z, radius, team });
  const dom = [P('A', 3.0, 0, -13.2, 3), P('B', -12.0, 0, 5.0, 3), P('C', -8.0, 0, 28.0, 3)];
  const sd = [P('A', -33.0, 0, 15.5, 1.6, 1), P('B', 21.8, 0, 17.1, 1.6, 1)];
  const [shx, shz] = at(shU, 9.5, 2.3);
  const [ofx, ofz] = at(ofU, 3.15, 9.9);
  const [b7x, b7z] = at(b7U, 6.6, 3.2);
  const [bkx, bkz] = at(bkU, 8.5, 4.25);
  const hq = [P('hq1', -11.5, 0, 6.0, 3.5), P('hq2', bkx, 0, bkz, 3), P('hq3', shx, 0, shz, 2.5), P('hq4', ofx, 0, ofz, 3), P('hq5', 22.4, 0, 16.0, 3.5), P('hq6', -29.6, 0, -26.5, 3), P('hq7', b7x, 0, b7z, 3), P('hq8', 21.8, 0, -7.5, 2.5), P('hq9', 3.0, 0, -14.0, 3.5)];
  const attackers = team0;
  const defenders = [[-3, 33], [0.5, 37], [-3, 38.5], [-1, 42], [-6.5, 30.5], [-12, 29.2], [-9, 26.5], [-6, 36]].map(([x, z]) => sp(x!, 0, z!, yawTo(x!, z!, -4, 6)));
  const [hux, huz] = at(shU, 10.5, 2.5);
  const tw = { x: -4.7, y: TP, z: 2.7 };
  const [brx, brz] = at(bkU, 10, 4.25);

  return {
    id: 'firingrange',
    name: 'Firing Range',
    bounds: FIRING_RANGE_BOUNDS,
    materials: MATERIALS,
    brushes: k.brushes,
    decals: k.decals,
    props: k.props,
    lights: k.lights,
    spawns: { teams: [team0, team1], ffa },
    objectives: { dom, sd, hq },
    modeSpawns: { sd: { attackers, defenders } },
    times: [
      { id: 'morning', name: 'Jungle Morning', clock: '07:10', sky: 'fr_skyMorning', unlit: [1, 0.98, 0.9], skyRot: 0, sunDir: unitVec(0.5, 0.72, 0.38), sun: [1.15, 1.0, 0.78], amb: [0.46, 0.5, 0.46], fog: [0.72, 0.74, 0.66], fogNear: 30, fogFar: 150, lights: { lamp: 0.3 }, glow: 0 },
      { id: 'evening', name: 'Evening', clock: '18:50', sky: 'skyDusk', unlit: [1, 0.86, 0.76], skyRot: PI, sunDir: unitVec(-0.85, 0.35, 0.2), sun: [1.1, 0.6, 0.38], amb: [0.28, 0.25, 0.32], fog: [0.6, 0.42, 0.38], fogNear: 24, fogFar: 130, lights: { lamp: 1 }, glow: 0.8 },
    ],
    defaultTime: 'morning',
    hotspots: [
      { x: -12, y: 0, z: 5 },
      { x: 3, y: 0, z: -13.2 },
      { x: -8, y: 0, z: 28 },
      { x: shx, y: 0, z: shz },
      { x: hux, y: F2, z: huz },
      tw,
      { x: brx, y: BR, z: brz },
      { x: ofx, y: 0, z: ofz },
      { x: 21, y: 0, z: 15 },
      { x: 21.8, y: 0, z: -7.5 },
      { x: -29.6, y: 0, z: -26.5 },
      { x: -13.6, y: 0, z: -36 },
      { x: 31, y: 0, z: 20 },
      { x: 9, y: 0, z: 28.8 },
      { x: b7x, y: 0, z: b7z },
      { x: 6, y: 0, z: 12.5 },
    ],
  };
}

