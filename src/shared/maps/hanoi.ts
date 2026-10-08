/**
 * Hanoi (recreation of Black Ops 1's Hanoi, mp_hanoi; owner: maps-bo). The NVA prison in the
 * middle of the city, at night, with the barricaded colonial street running along its west side.
 * Traced from the BO1 minimap and overview (1 minimap px = 0.2 m), the two bird's-eye shots and
 * gameplay footage; see docs/maps/hanoi-reference.md for sources, callouts and measurements.
 *
 * Metres, +x east, +z south (north is up on the minimap), yaw 0 faces north (-z). Origin at the
 * middle of the playable area (minimap px 250, 255).
 *
 *   Street        the barricaded city street (west, x -39 .. -22), shophouses on its far side, the
 *                 bus parked by the gate tower; it turns east into the North Lane. NVA spawn.
 *   Gate          the prison entrance off the street (flag over it) with the watch tower beside it
 *   North Block   cell block between the North Lane and the Gallows courtyard
 *   Gallows       the courtyard inside the gate: raised gallows platform, Domination A
 *   Theatre       the L-shaped re-education block (west wing on the street, the projector room
 *                 on the south side of the Gallows courtyard), S&D A
 *   Cell Block    the long block running north-west to south-east through the middle (turned
 *                 45 degrees), cells along a corridor, a two-storey guard end with inner stairs
 *   Plaza         the open yard north-east of the Cell Block: planters, crate stacks, big tree
 *   Guardhouse    two storeys south of the Theatre, outside stairs up its east face, overlooks B
 *   Yard          the open middle between the Theatre, the Cell Block and the Hall, Domination B
 *   Hall          the T-shaped wash-house block across the south (long hall, west wing, south
 *                 room), S&D B in the hall
 *   Barracks      two storeys east of the Yard, outside stairs on its south face
 *   Well          the east courtyard with the well and the arched gate, Domination C; SOG spawn
 *   East House    two storeys on the east edge, the balcony with the ladder
 *   South Lane    the cobbled lane along the south edge out to the spawn alley (SE)
 */
import type { Vec3 } from '../math';
import { MapKit, yawTo, type Hole } from './bo-kit';
import { unitVec, type Brush, type MapData, type MaterialDef, type ObjectivePoint, type SpawnPoint } from './types';

const PI = Math.PI;
/** Upper floor walking height (two-storey blocks) and their eaves. */
const F2 = 3.2;
const E2 = 6.6;
/** Eave of the single-storey prison blocks. */
const E1 = 3.8;
/** Outer wall thickness. */
const T = 0.4;
/** Gallows platform height. */
const GALLOWS = 1.5;
/** East House balcony height. */
const BALCONY = 3.1;

export const HANOI_BOUNDS = { min: { x: -46, y: -3, z: -45 }, max: { x: 46, y: 30, z: 47 } };

type P2 = [number, number];
type BrushOpts = Partial<Omit<Brush, 'min' | 'max' | 'mat'>>;

/**
 * The playable outline (from the minimap), clockwise on the overhead (x right, z down). The
 * street and North Lane on the west and north, the prison walls east and south, the spawn alley
 * leaving to the south-east.
 */
export const HANOI_OUTLINE: P2[] = [
  [-35, -42.6], [-29.8, -42.6], [-29.8, -40.6], [-20, -40.6], [-20, -36.6], [0, -36.6], [0, -38.4], [27, -38.4],
  [29.8, -35.6], [29.8, -11.6], [33.8, -4.8], [33.8, 29.6], [43.6, 39.4], [37.6, 45.0], [21.6, 29.0], [21.6, 26.4],
  [-2.6, 26.4], [-2.6, 23.6], [-12.2, 23.6], [-12.2, 18.0], [-17.4, 18.0], [-17.4, 4.4], [-28, 4.4], [-28, 0],
  [-37.4, 0], [-37.4, -3.6], [-39.8, -3.6], [-39.8, -13.2], [-44, -13.2], [-44, -19.2], [-39.4, -19.2], [-39.4, -30],
  [-37.4, -30], [-37.4, -35.2], [-35, -35.2],
];

/** What stands outside each outline edge: shophouses on the city side, prison wall elsewhere. */
const EDGE_KIND: ('shop' | 'wall')[] = [
  'shop', 'shop', 'shop', 'shop', 'shop', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall',
  'wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'shop', 'shop', 'shop', 'shop', 'shop', 'shop', 'shop', 'shop',
  'shop', 'shop', 'shop', 'shop', 'shop',
];

/** The Cell Block frame: origin at the middle of its north-west end, u along it (south-east), v across (south-west). */
export const CELL_BLOCK = { ox: -1.6, oz: -26.6, th: PI / 4, length: 30.5, width: 6.0, split: 21.0 };

const MATERIALS: Record<string, MaterialDef> = {
  stone: { texture: 'hn_stone', uvMul: [1 / 2.6, 1 / 2.6] },
  stoneDark: { texture: 'hn_stone', tint: 0x9a9a9c, uvMul: [1 / 2.6, 1 / 2.6] },
  stoneGreen: { texture: 'hn_stone', tint: 0xa8b0a0, uvMul: [1 / 2.6, 1 / 2.6] },
  limewash: { texture: 'hn_plaster', tint: 0xd0d4cc, uvMul: [1 / 3, 1 / 3] },
  plasterOchre: { texture: 'hn_plaster', tint: 0xe8c890, uvMul: [1 / 3, 1 / 3] },
  plasterGrey: { texture: 'hn_plaster', tint: 0xb4b8b4, uvMul: [1 / 3, 1 / 3] },
  plasterGreen: { texture: 'hn_plaster', tint: 0xa8c4ac, uvMul: [1 / 3, 1 / 3] },
  roof: { texture: 'hn_roof', uvMul: [1 / 2.4, 1 / 2.4] },
  roofGrey: { texture: 'hn_roof', tint: 0x9aa098, uvMul: [1 / 2.4, 1 / 2.4] },
  roofMoss: { texture: 'hn_roof', tint: 0x8c9c80, uvMul: [1 / 2.4, 1 / 2.4] },
  cobble: { texture: 'hn_cobble', uvMul: [1 / 2.5, 1 / 2.5] },
  flags: { texture: 'hn_flags', uvMul: [1 / 3, 1 / 3] },
  flagsDark: { texture: 'hn_flags', tint: 0x9c9a94, uvMul: [1 / 3, 1 / 3] },
  asphalt: { texture: 'nt_asphalt', tint: 0x9c9ca4, uvMul: [1 / 5, 1 / 5] },
  dirt: { texture: 'fr_dirt', tint: 0x8c8278, uvMul: [1 / 4, 1 / 4] },
  grass: { texture: 'fr_grass', tint: 0x9cac8c, uvMul: [1 / 4, 1 / 4] },
  floor: { texture: 'nt_floor', tint: 0xb0a090, uvMul: [1 / 2, 1 / 2] },
  ceiling: { texture: 'bo_planks', tint: 0x8a7a6a, uvMul: [1 / 2.4, 1 / 2.4] },
  planks: { texture: 'bo_planks', uvMul: [1 / 2.4, 1 / 2.4] },
  wood: { texture: 'bo_wood', uvMul: [1 / 1.2, 1 / 1.2] },
  woodDark: { texture: 'bo_wood', tint: 0x8a7a6a, uvMul: [1 / 1.2, 1 / 1.2] },
  tin: { texture: 'fr_tin', tint: 0xa8a8a0, uvMul: [1 / 2.6, 1 / 2.6] },
  corr: { texture: 'fr_corr', tint: 0x9aa494, uvMul: [1 / 2.4, 1 / 2.4] },
  sandbag: { texture: 'bo_sandbag', uvMul: [1 / 1.6, 1 / 0.9] },
  crate: { texture: 'crate', uvMul: [1 / 1.2, 1 / 1.2] },
  barrel: { texture: 'barrel', tint: 0x7a8a6a, uvMul: [2, 1] },
  steel: { texture: 'steel' },
  rail: { texture: 'steel', tint: 0x8a8a90 },
  rubber: { texture: 'rubber', uvMul: [1 / 0.4, 1 / 0.4] },
  glass: { texture: 'bo_glass' },
  busBody: { texture: 'bo_carpaint', tint: 0xd8d0b4 },
  busBlue: { texture: 'bo_carpaint', tint: 0x6a86a0 },
  carWhite: { texture: 'bo_carpaint', tint: 0xd8d8d0 },
  carBlack: { texture: 'bo_carpaint', tint: 0x3a3c40 },
  truck: { texture: 'bo_carpaint', tint: 0x5a6448 },
  foliage: { texture: 'fr_foliage', tint: 0x7a8a72, uvMul: [1 / 3, 1 / 3] },
  bark: { texture: 'fr_bark', uvMul: [1, 1 / 2] },
  facade: { texture: 'hn_facade' },
  window: { texture: 'hn_window' },
  bars: { texture: 'hn_bars', side: 'double' },
  door: { texture: 'hn_door' },
  poster: { texture: 'hn_poster', emissive: 0.15 },
  flag: { texture: 'hn_flag', side: 'double', emissive: 0.2 },
  screen: { texture: 'hn_screen', emissive: 0.85 },
  sign: { texture: 'hn_sign', emissive: 0.25 },
  lamp: { texture: 'lamp', emissive: 1 },
  lantern: { texture: 'lamp', tint: 0xff6a40, emissive: 1 },
  water: { texture: 'nt_asphalt', tint: 0x30384a },
  blood: { texture: 'bo_carpaint', tint: 0x501414 },
  rope: { texture: 'bo_fabric', tint: 0x9a8a6a },
  clip: { texture: 'none' },
};

// ---------------------------------------------------------------------------------------------
// Turned (45 degree) geometry: render-only rotated boxes, collision as axis-aligned slices.
// After Firing Range's Frame, extended for turns past 30 degrees (the renderer swaps a box's x/z
// extents when |sin ry| > 0.5, so `vis` hands it the swapped footprint).
// ---------------------------------------------------------------------------------------------

interface Solidity {
  players?: boolean;
  bullets?: boolean;
  sight?: boolean;
}

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

/** Solid wall pieces between holes: [s0, s1, b0, b1]. */
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

/** Horizontal bands of a wall's solid runs between hole edges (collision of turned walls). */
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
      const s0 = r0 === lo ? r0 - t / 2 : r0;
      const s1 = r1 === hi ? r1 + t / 2 : r1;
      const last = key === prev ? out.find((q) => q[0] === s0 && q[1] === s1 && Math.abs(q[3] - ya) < 1e-9) : undefined;
      if (last) last[3] = yb;
      else out.push([s0, s1, ya, yb]);
    }
    prev = key;
  }
  return out;
}

/** A turned frame: local u (along `th`) and v (90 degrees clockwise on the overhead) about (ox, oz). */
class Frame {
  readonly c: number;
  readonly s: number;
  readonly swap: boolean;
  constructor(
    readonly k: MapKit,
    readonly ox: number,
    readonly oz: number,
    readonly th: number,
  ) {
    this.c = Math.cos(th);
    this.s = Math.sin(th);
    this.swap = Math.abs(this.s) > 0.5;
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
    let hw = Math.abs(u1 - u0) / 2;
    let hd = Math.abs(v1 - v0) / 2;
    if (this.swap) [hw, hd] = [hd, hw];
    this.k.aabb(cx - hw, y0, cz - hd, cx + hw, y1, cz + hd, mat, { ...o, ry: -this.th, collide: false });
  }

  /** Invisible collision for a rotated box: axis-aligned slices inside it. */
  solid(u0: number, v0: number, u1: number, v1: number, y0: number, y1: number, mat: string, o: Solidity & { tag?: string } = {}, step?: number): void {
    const P: P2[] = [this.w(u0, v0), this.w(u1, v0), this.w(u1, v1), this.w(u0, v1)];
    const long: P2 = Math.abs(u1 - u0) >= Math.abs(v1 - v0) ? [this.c, this.s] : [-this.s, this.c];
    const short = Math.min(Math.abs(u1 - u0), Math.abs(v1 - v0));
    step ??= Math.min(this.sliceStep(short, long[0], long[1]), Math.max(0.15, short / 2.5));
    const axis: 0 | 1 = Math.abs(long[0]) >= Math.abs(long[1]) ? 0 : 1;
    const cuts = [...new Set(P.map((q) => q[axis]))].sort((p, q) => p - q);
    const flags: BrushOpts = { noRender: true, players: o.players ?? true, bullets: o.bullets ?? true, sight: o.sight ?? true, ...(o.tag ? { tag: o.tag } : {}) };
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

  /** Bounding box of a small rotated rect (collision only): caps the slanted ends of wall runs. */
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

  private sliceStep(t: number, dx: number, dz: number): number {
    const a = Math.max(Math.abs(dx), Math.abs(dz));
    const b = Math.min(Math.abs(dx), Math.abs(dz));
    if (b < 1e-3) return 1.0;
    const tan = b / a;
    const cos = a / Math.hypot(a, b);
    return Math.max(0.12, Math.min(1.0, (t / cos - 0.12) / (2 * tan)));
  }

  /** Wall along u at v (thickness t), from y0 up h, holes in u. */
  wallU(v: number, u0: number, u1: number, y0: number, h: number, t: number, mat: string, holes: Hole[] = [], o: BrushOpts & Solidity = {}): void {
    for (const [s0, s1, b0, b1] of wallSegments(u0, u1, h, holes)) this.vis(s0 === u0 ? s0 - t / 2 : s0, v - t / 2, s1 === u1 ? s1 + t / 2 : s1, v + t / 2, y0 + b0, y0 + b1, mat, o);
    const step = this.sliceStep(t, this.c, this.s);
    for (const [s0, s1, b0, b1] of wallBands(u0, u1, h, holes, t)) {
      this.solid(s0, v - t / 2, s1, v + t / 2, y0 + b0, y0 + b1, mat, o, step);
      this.caps(s0, s1, u0, u1, t, (a, b) => this.cap(a, v - t / 2, b, v + t / 2, y0 + b0, y0 + b1, mat, o));
    }
  }

  /**
   * Caps for both ends of a run. At a door or window jamb the cap's axis-aligned box would stick
   * out into the opening (by half the wall thickness at 45 degrees), so it is set back by t/2 there;
   * at the wall's own ends it overlaps the crossing wall as usual.
   */
  private caps(s0: number, s1: number, lo: number, hi: number, t: number, put: (a: number, b: number) => void): void {
    const e = Math.min(0.25, (s1 - s0) / 2);
    const k = this.swap || Math.abs(this.s) > 0.3 ? t / 2 : 0;
    const a0 = s0 <= lo - t / 2 + 1e-6 ? s0 : s0 + k;
    const a1 = s1 >= hi + t / 2 - 1e-6 ? s1 : s1 - k;
    if (a1 - a0 < 0.05) return;
    put(a0, Math.min(a1, a0 + e));
    put(Math.max(a0, a1 - e), a1);
  }

  /** Wall along v at u. */
  wallV(u: number, v0: number, v1: number, y0: number, h: number, t: number, mat: string, holes: Hole[] = [], o: BrushOpts & Solidity = {}): void {
    for (const [s0, s1, b0, b1] of wallSegments(v0, v1, h, holes)) this.vis(u - t / 2, s0 === v0 ? s0 - t / 2 : s0, u + t / 2, s1 === v1 ? s1 + t / 2 : s1, y0 + b0, y0 + b1, mat, o);
    const step = this.sliceStep(t, -this.s, this.c);
    for (const [s0, s1, b0, b1] of wallBands(v0, v1, h, holes, t)) {
      this.solid(u - t / 2, s0, u + t / 2, s1, y0 + b0, y0 + b1, mat, o, step);
      this.caps(s0, s1, v0, v1, t, (a, b) => this.cap(u - t / 2, a, u + t / 2, b, y0 + b0, y0 + b1, mat, o));
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
          this.box(us[i]!, start, us[i + 1]!, vs[j]!, top - thick, top, mat, o, 0.25);
          start = null;
        }
      }
    }
  }

  /** Stairs over the rect rising towards `dir`: rotated visual steps, solid sheared blocks to walk on. */
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
      if (alongU) this.vis(a, c0, b, c1, top - Math.min(0.5, top - y0), top, mat, { hide: ['ny'] });
      else this.vis(c0, a, c1, b, top - Math.min(0.5, top - y0), top, mat, { hide: ['ny'] });
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

  floorDecal(u0: number, v0: number, u1: number, v1: number, mat: string, y = 0.02): void {
    const [x, z] = this.w((u0 + u1) / 2, (v0 + v1) / 2);
    this.k.flatDecal(u1 - u0, v1 - v0, mat, x, y, z, { ry: -this.th });
  }

  /** Wall decal on the face of a wall along u (normal towards +v when `side` is 1). */
  wallDecalU(u: number, v: number, y: number, w: number, h: number, mat: string, side: 1 | -1, o: { uv?: 'raw' } = {}): void {
    const [x, z] = this.w(u, v);
    // A wall decal faces local +z rotated by ry; the frame's +v is (-s, c), so ry = atan2(-s, c) * side.
    const ry = side > 0 ? Math.atan2(-this.s, this.c) : Math.atan2(this.s, -this.c);
    this.k.wallDecal(w, h, mat, x, y, z, ry, o);
  }

  /** Wall decal on the face of a wall along v (normal towards +u when `side` is 1). */
  wallDecalV(u: number, v: number, y: number, w: number, h: number, mat: string, side: 1 | -1, o: { uv?: 'raw' } = {}): void {
    const [x, z] = this.w(u, v);
    const ry = side > 0 ? Math.atan2(this.c, this.s) : Math.atan2(-this.c, -this.s);
    this.k.wallDecal(w, h, mat, x, y, z, ry, o);
  }

  post(u: number, v: number, h: number, mat: string, y0 = 0, r = 0.1): void {
    const [x, z] = this.w(u, v);
    this.k.aabb(x - r, y0, z - r, x + r, y0 + h, z + r, mat);
  }

  light(u: number, y: number, v: number, color: [number, number, number], radius: number, group: string): void {
    const [x, z] = this.w(u, v);
    this.k.light(x, y, z, color, radius, group);
  }
}

// ---------------------------------------------------------------------------------------------
// Outline helpers
// ---------------------------------------------------------------------------------------------

export function insideOutline(x: number, z: number, poly: P2[] = HANOI_OUTLINE): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Rows of `cell`-sized cells where `want` holds, merged into rectangles. */
function raster(x0: number, z0: number, x1: number, z1: number, cell: number, want: (x: number, z: number) => boolean): { x0: number; z0: number; x1: number; z1: number }[] {
  const nx = Math.round((x1 - x0) / cell);
  const nz = Math.round((z1 - z0) / cell);
  const rows: { a: number; b: number }[][] = [];
  for (let j = 0; j < nz; j++) {
    const z = z0 + (j + 0.5) * cell;
    const runs: { a: number; b: number }[] = [];
    let cur: { a: number; b: number } | null = null;
    for (let i = 0; i < nx; i++) {
      if (!want(x0 + (i + 0.5) * cell, z)) {
        cur = null;
        continue;
      }
      if (cur) cur.b = i + 1;
      else runs.push((cur = { a: i, b: i + 1 }));
    }
    rows.push(runs);
  }
  const out: { x0: number; z0: number; x1: number; z1: number }[] = [];
  let open = new Map<string, { a: number; b: number; j0: number }>();
  for (let j = 0; j <= nz; j++) {
    const next = new Map<string, { a: number; b: number; j0: number }>();
    for (const r of rows[j] ?? []) {
      const key = `${r.a},${r.b}`;
      const o = open.get(key);
      next.set(key, o ? o : { ...r, j0: j });
      if (o) open.delete(key);
    }
    for (const o of open.values()) out.push({ x0: x0 + o.a * cell, z0: z0 + o.j0 * cell, x1: x0 + o.b * cell, z1: z0 + j * cell });
    open = next;
  }
  return out;
}

const hash = (x: number, z: number) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

// ---------------------------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------------------------

const door = (a: number, w = 1.3, y = 0, h = 2.3): Hole => ({ a0: a - w / 2, a1: a + w / 2, y0: y, y1: y + h });
const slot = (a: number, w = 1.0, y0 = 1.6, y1 = 2.4): Hole => ({ a0: a - w / 2, a1: a + w / 2, y0, y1 });
const upWin = (a: number, w = 1.6): Hole => ({ a0: a - w / 2, a1: a + w / 2, y0: F2 + 0.9, y1: F2 + 2.1 });
const upDoor = (a: number, w = 1.1): Hole => ({ a0: a - w / 2, a1: a + w / 2, y0: F2, y1: F2 + 2.2 });

interface Sides {
  n?: Hole[] | null;
  s?: Hole[] | null;
  w?: Hole[] | null;
  e?: Hole[] | null;
}

/** Four walls round x0..x1, z0..z1 (outer faces), interior faces in `int`; a side set to null is left out. */
function shell(k: MapKit, x0: number, z0: number, x1: number, z1: number, h: number, ext: string, int: string, sides: Sides, y0 = 0): void {
  if (sides.n !== null) k.wall('x', x0, x1, z0 + T / 2, y0, h, T, ext, sides.n ?? [], { faceMats: { pz: int } });
  if (sides.s !== null) k.wall('x', x0, x1, z1 - T / 2, y0, h, T, ext, sides.s ?? [], { faceMats: { nz: int } });
  if (sides.w !== null) k.wall('z', z0 + T, z1 - T, x0 + T / 2, y0, h, T, ext, sides.w ?? [], { faceMats: { px: int } });
  if (sides.e !== null) k.wall('z', z0 + T, z1 - T, x1 - T / 2, y0, h, T, ext, sides.e ?? [], { faceMats: { nx: int } });
}

/** Barred slot decals inside the given wall's window holes (render only). */
function bars(k: MapKit, axis: 'x' | 'z', c: number, holes: Hole[], y0 = 0): void {
  for (const h of holes) {
    if (h.y0 < 0.5) continue;
    const a = (h.a0 + h.a1) / 2;
    if (axis === 'x') k.wallDecal(h.a1 - h.a0, h.y1 - h.y0, 'bars', a, y0 + h.y0, c, 0, { uv: 'raw', seg: 1 });
    else k.wallDecal(h.a1 - h.a0, h.y1 - h.y0, 'bars', c, y0 + h.y0, a, PI / 2, { uv: 'raw', seg: 1 });
  }
}

/** Gable roof over the rect (ridge along `ridge`), with a ceiling slab under it and a player clip over it. */
function gable(k: MapKit, x0: number, z0: number, x1: number, z1: number, y: number, rise: number, mat: string, ridge: 'x' | 'z', ceiling = true, o = 0.35): void {
  if (ridge === 'x') {
    const zc = (z0 + z1) / 2;
    k.ramp(x0 - o, y, z0 - o, x1 + o, y + rise, zc, '+z', mat);
    k.ramp(x0 - o, y, zc, x1 + o, y + rise, z1 + o, '-z', mat);
  } else {
    const xc = (x0 + x1) / 2;
    k.ramp(x0 - o, y, z0 - o, xc, y + rise, z1 + o, '+x', mat);
    k.ramp(xc, y, z0 - o, x1 + o, y + rise, z1 + o, '-x', mat);
  }
  if (ceiling) k.aabb(x0 + T, y - 0.14, z0 + T, x1 - T, y, z1 - T, 'ceiling', { hide: ['py'] });
  k.clip(x0, y, z0, x1, 14, z1, 'roof');
}

function crate(k: MapKit, x: number, z: number, s = 1.2, y = 0): void {
  k.box(s, s, s, 'crate', x, y, z, { uv: 'raw' });
}

/** A run of sandbags (0.9-1.0 m, chest cover) from (x0, z0) to (x1, z1), axis-aligned. */
function sandbags(k: MapKit, x0: number, z0: number, x1: number, z1: number, h = 1.0): void {
  k.aabb(x0, 0, z0, x1, h, z1, 'sandbag');
}

/** Wooden street barricade: crossed beams on trestles over a low plank wall (players stop, bullets pass the gaps). */
function barricade(k: MapKit, x0: number, z0: number, x1: number, z1: number): void {
  k.aabb(x0, 0, z0, x1, 0.9, z1, 'planks');
  const along = x1 - x0 > z1 - z0;
  const len = along ? x1 - x0 : z1 - z0;
  for (let a = 0.2; a < len; a += 1.4) {
    if (along) k.trim(0.14, 1.5, 0.5, 'woodDark', x0 + a, 0.9, (z0 + z1) / 2);
    else k.trim(0.5, 1.5, 0.14, 'woodDark', (x0 + x1) / 2, 0.9, z0 + a);
  }
  if (along) k.trim(len, 0.14, 0.14, 'woodDark', (x0 + x1) / 2, 2.0, (z0 + z1) / 2);
  else k.trim(0.14, 0.14, len, 'woodDark', (x0 + x1) / 2, 2.0, (z0 + z1) / 2);
}

/** A leafy street tree: trunk (collides), two canopy boxes (render only). */
function tree(k: MapKit, x: number, z: number, h: number, r: number, y0 = 0): void {
  k.cyl(r * 0.12, h * 0.6, 6, 'bark', x, y0 + h * 0.3, z);
  k.box(r * 2, h * 0.32, r * 2, 'foliage', x, y0 + h * 0.55, z, { collide: false });
  k.box(r * 1.4, h * 0.22, r * 1.4, 'foliage', x + r * 0.15, y0 + h * 0.85, z - r * 0.1, { collide: false });
}

/** Street lamp: post, arm, head, light and glow. */
function streetLamp(k: MapKit, x: number, z: number, dx: number, dz: number, h = 5.4, group = 'street'): void {
  k.box(0.18, h, 0.18, 'steel', x, 0, z);
  k.trim(Math.abs(dx) > 0 ? 1.2 : 0.1, 0.08, Math.abs(dz) > 0 ? 1.2 : 0.1, 'steel', x + dx * 0.6, h - 0.1, z + dz * 0.6);
  k.trim(0.4, 0.18, 0.4, 'lamp', x + dx * 1.1, h - 0.3, z + dz * 1.1);
  k.light(x + dx * 1.1, h - 0.5, z + dz * 1.1, [1.7, 1.15, 0.6], 15, group);
  k.glow(x + dx * 1.1, h - 0.35, z + dz * 1.1, [0.9, 0.62, 0.3], 2.4, group);
}

/** Caged bulk-head floodlight on a wall (light + glow + fitting). */
function flood(k: MapKit, x: number, y: number, z: number, radius = 13): void {
  k.trim(0.3, 0.22, 0.3, 'lamp', x, y, z);
  k.light(x, y - 0.2, z, [1.15, 1.2, 1.35], radius, 'flood');
  k.glow(x, y + 0.1, z, [0.7, 0.75, 0.9], 1.6, 'flood');
}

/** Hanging paper lantern (red). */
function lantern(k: MapKit, x: number, y: number, z: number): void {
  k.trim(0.32, 0.42, 0.32, 'lantern', x, y, z);
  k.light(x, y + 0.1, z, [1.5, 0.55, 0.3], 6.5, 'lantern');
  k.glow(x, y + 0.2, z, [0.9, 0.3, 0.15], 1.4, 'lantern');
}

/** Bare bulb inside a room. */
function bulb(k: MapKit, x: number, y: number, z: number, radius = 8): void {
  k.trim(0.14, 0.18, 0.14, 'lamp', x, y, z);
  k.light(x, y - 0.1, z, [1.4, 1.12, 0.72], radius, 'interior');
}

/** A car: body, cabin, wheels. `along` is its long axis. */
function car(k: MapKit, x: number, z: number, along: 'x' | 'z', mat: string): void {
  const L = 4.4;
  const W = 1.75;
  const [w, d] = along === 'z' ? [W, L] : [L, W];
  k.box(w, 0.7, d, mat, x, 0.28, z);
  const [cw, cd] = along === 'z' ? [W - 0.2, L * 0.5] : [L * 0.5, W - 0.2];
  k.box(cw, 0.5, cd, 'glass', x, 0.98, z, { faceMats: { py: mat } });
  for (const s of [-1, 1])
    for (const e of [-1, 1]) {
      const wx = along === 'z' ? x + s * (W / 2 - 0.05) : x + e * (L / 2 - 0.75);
      const wz = along === 'z' ? z + e * (L / 2 - 0.75) : z + s * (W / 2 - 0.05);
      k.cyl(0.32, 0.22, 10, 'rubber', wx, 0.32, wz, { axis: along === 'z' ? 'x' : 'z', collide: false });
    }
}

// ---------------------------------------------------------------------------------------------
// Ground and outline
// ---------------------------------------------------------------------------------------------

function ground(k: MapKit): void {
  // Cobbles everywhere (lanes and the street's pavements), out to the horizon.
  k.aabb(-200, -1, -200, 200, 0, 200, 'cobble', { hide: ['nx', 'px', 'ny', 'nz', 'pz'] });
  // The street: asphalt carriageway with the old tram rails down the middle, then round into the North Lane.
  k.flatDecal(11.0, 46.0, 'asphalt', -29.2, 0.012, -19.0);
  k.flatDecal(20.0, 7.2, 'asphalt', -12.0, 0.012, -32.8);
  for (const x of [-29.9, -28.5]) k.flatDecal(0.1, 46, 'rail', x, 0.02, -19.0, { seg: 1 });
  // Gallows courtyard, the Yard, the Well courtyard: flagstones.
  k.flatDecal(16.6, 10.6, 'flags', -8.7, 0.012, -18.2);
  k.flatDecal(15.4, 13.0, 'flagsDark', 8.2, 0.012, 4.4);
  k.flatDecal(12.0, 15.0, 'flags', 27.6, 0.012, 1.0);
  // The Plaza: packed dirt with grass patches.
  k.flatDecal(26.0, 12.0, 'dirt', 15.0, 0.012, -32.0);
  k.flatDecal(12.0, 14.0, 'dirt', 23.0, 0.013, -19.0);
  for (const [x, z, w, d] of [[8, -34, 5, 3], [21, -29, 6, 4], [26, -22, 4, 6], [14, -27, 3, 3]] as const) k.flatDecal(w, d, 'grass', x, 0.02, z);
}

/** Players stop at the outline (invisible clips, bullets and sight pass); walls and shophouses stand outside it. */
function outline(k: MapKit): void {
  const b = HANOI_BOUNDS;
  for (const r of raster(b.min.x, b.min.z, b.max.x, b.max.z, 0.5, (x, z) => !insideOutline(x, z))) k.clip(r.x0, b.min.y, r.z0, r.x1, 14, r.z1, 'perimeter');
  const P = HANOI_OUTLINE;
  for (let i = 0; i < P.length; i++) {
    const [ax, az] = P[i]!;
    const [bx, bz] = P[(i + 1) % P.length]!;
    const kind = EDGE_KIND[i]!;
    edge(k, ax, az, bx, bz, kind, i);
    // Corner post outside the vertex between this edge and the previous one (both axis-aligned).
    const [px, pz] = P[(i + P.length - 1) % P.length]!;
    const n1 = [az - pz, -(ax - px)].map((q) => Math.sign(q) * 0.5);
    const n2 = [bz - az, -(bx - ax)].map((q) => Math.sign(q) * 0.5);
    if ((ax === px || az === pz) && (ax === bx || az === bz)) {
      const cx = [ax, ax + n1[0]! + n2[0]!];
      const cz = [az, az + n1[1]! + n2[1]!];
      const hgt = kind === 'shop' && EDGE_KIND[(i + P.length - 1) % P.length] === 'shop' ? 8.4 : 5.0;
      k.aabb(Math.min(...cx), 0, Math.min(...cz), Math.max(...cx), hgt, Math.max(...cz), kind === 'shop' ? 'plasterGrey' : 'stone');
    }
  }
}

/** The wall or shophouse row standing just outside one outline edge. */
function edge(k: MapKit, ax: number, az: number, bx: number, bz: number, kind: 'shop' | 'wall', i: number): void {
  const dx = bx - ax;
  const dz = bz - az;
  const L = Math.hypot(dx, dz);
  // Outward normal of a clockwise (on screen, z down) outline.
  const nx = dz / L;
  const nz = -dx / L;
  const t = 0.5;
  const h = kind === 'shop' ? 8.4 + (i % 3) * 0.8 : 5.0;
  const mat = kind === 'shop' ? (i % 2 ? 'plasterOchre' : 'plasterGrey') : 'stone';
  if (Math.abs(dx) < 1e-6 || Math.abs(dz) < 1e-6) {
    // Axis-aligned: a wall box, then the shophouse block behind it.
    const x0 = Math.min(ax, bx, ax + nx * t);
    const x1 = Math.max(ax, bx, ax + nx * t);
    const z0 = Math.min(az, bz, az + nz * t);
    const z1 = Math.max(az, bz, az + nz * t);
    // Corners close with a post at each vertex (outside the outline, see `outline`).
    const ex = 0;
    const ez = 0;
    k.aabb(x0, 0, z0, x1, h, z1, mat);
    if (kind === 'shop') {
      const D = 7;
      const bx0 = Math.min(x0, x0 + nx * D);
      const bx1 = Math.max(x1, x1 + nx * D);
      const bz0 = Math.min(z0, z0 + nz * D);
      const bz1 = Math.max(z1, z1 + nz * D);
      const along: 'x' | 'z' = Math.abs(dx) > 0 ? 'x' : 'z';
      // Pitched clay roof over the row, ridge along the street.
      if (along === 'x') {
        const zc = (bz0 + bz1) / 2;
        k.ramp(bx0 - ex, h, bz0, bx1 + ex, h + 2.2, zc, '+z', 'roof', { collide: false });
        k.ramp(bx0 - ex, h, zc, bx1 + ex, h + 2.2, bz1, '-z', 'roof', { collide: false });
      } else {
        const xc = (bx0 + bx1) / 2;
        k.ramp(bx0, h, bz0 - ez, xc, h + 2.2, bz1 + ez, '+x', 'roof', { collide: false });
        k.ramp(xc, h, bz0 - ez, bx1, h + 2.2, bz1 + ez, '-x', 'roof', { collide: false });
      }
      // Shophouse fronts (4 m bays) facing the street, lanterns under some balconies.
      const ry = Math.atan2(-nx, -nz);
      const bays = Math.max(1, Math.round(L / 4));
      const bw = L / bays;
      for (let j = 0; j < bays; j++) {
        const s = (j + 0.5) / bays;
        const px = ax + dx * s - nx * 0.02;
        const pz = az + dz * s - nz * 0.02;
        k.wallDecal(bw - 0.1, Math.min(8, h - 0.2), 'facade', px, 0, pz, ry, { uv: 'raw', seg: 2 });
        if ((j + i) % 3 === 0 && L > 3) lantern(k, px - nx * 0.6, 3.1, pz - nz * 0.6);
      }
    }
    return;
  }
  // Diagonal edge (the Plaza corner, the Well's east corner, the spawn alley): a turned wall.
  const th = Math.atan2(dz, dx);
  const f = new Frame(k, ax, az, th);
  // Local v = (-s, c) is the inward side for this winding, so the wall sits at v -t/2.
  f.wallU(-t / 2, 0, L, 0, h, t, mat, []);
  if (i === 12) {
    // The far end of the spawn alley: a shut double gate.
    f.wallDecalU(L / 2, 0.01, 0, 3.4, 3.0, 'door', 1, { uv: 'raw' });
  }
}

// ---------------------------------------------------------------------------------------------
// The street side: shophouse villa, the bus, cars, barricades, lamps
// ---------------------------------------------------------------------------------------------

function street(k: MapKit): void {
  // The villa on the west side (pyramid-roofed in the original; a hipped gable here), solid.
  k.aabb(-39.6, 0, -13.2, -33.8, 7.2, -3.6, 'plasterOchre');
  gable(k, -39.6, -13.2, -33.8, -3.6, 7.2, 2.4, 'roof', 'z', false);
  k.wallDecal(4.4, 6.8, 'facade', -33.78, 0, -10.8, PI / 2, { uv: 'raw', seg: 2 });
  k.wallDecal(4.4, 6.8, 'facade', -33.78, 0, -6.0, PI / 2, { uv: 'raw', seg: 2 });
  // Its balcony (render) and a porch roof over the door.
  k.trim(1.0, 0.14, 8.8, 'woodDark', -33.3, 3.4, -8.4);
  k.trim(0.06, 0.9, 8.8, 'rail', -32.86, 3.54, -8.4);
  lantern(k, -33.2, 2.8, -10.6);
  lantern(k, -33.2, 2.8, -6.2);
  // The shophouse front that steps out north of the alcove (solid), with a shop awning.
  k.aabb(-36.6, 0, -30, -33.8, 6.8, -22, 'plasterGrey');
  k.aabb(-37.4, 6.8, -30, -33.6, 7.0, -22, 'woodDark', { collide: false });
  k.wallDecal(4.0, 6.6, 'facade', -33.78, 0, -28.0, PI / 2, { uv: 'raw', seg: 2 });
  k.wallDecal(4.0, 6.6, 'facade', -33.78, 0, -24.0, PI / 2, { uv: 'raw', seg: 2 });
  k.trim(1.2, 0.08, 7.6, 'tin', -33.2, 2.7, -26.0);
  lantern(k, -33.0, 2.3, -26.0);

  // The bus, parked along the prison side by the gate tower (cream and blue, like the original's).
  const bx0 = -27.7;
  const bx1 = -25.3;
  k.aabb(bx0, 0.45, -12.6, bx1, 2.9, -3.6, 'busBody', { faceMats: { py: 'busBlue' } });
  k.aabb(bx0 + 0.15, 0.45, -3.6, bx1 - 0.15, 1.6, -2.4, 'busBody');
  for (const x of [bx0 - 0.01, bx1 + 0.01]) k.wallDecal(8.0, 0.8, 'glass', x, 1.7, -8.3, x < -26.5 ? -PI / 2 : PI / 2);
  k.wallDecal(2.0, 0.8, 'glass', -26.5, 1.75, -12.61, PI);
  k.trim(2.42, 0.4, 9.0, 'busBlue', -26.5, 0.45, -8.1, { collide: false });
  for (const z of [-11.2, -9.6, -4.0]) for (const x of [bx0 - 0.02, bx1 + 0.02]) k.cyl(0.5, 0.28, 10, 'rubber', x, 0.5, z, { axis: 'x', collide: false });

  // Cars: the white saloon in the street's north-west corner, the black one in the North Lane.
  car(k, -24.0, -34.6, 'x', 'carWhite');
  car(k, -4.8, -33.2, 'x', 'carBlack');
  car(k, -31.0, -6.0, 'z', 'carWhite');

  // Barricades and sandbags across the street (the "barricaded street").
  barricade(k, -31.6, -32.0, -30.4, -29.2);
  sandbags(k, -32.0, -24.2, -30.2, -22.0, 1.0);
  sandbags(k, -26.2, -24.4, -24.8, -22.0, 1.0);
  barricade(k, -31.4, -2.8, -29.8, -0.8);
  barricade(k, -27.6, 3.4, -22.6, 4.2);
  sandbags(k, -43.7, -18.6, -42.5, -14.0, 1.0);
  for (const [x, z] of [[-36.4, -20.4], [-21.0, -39.6], [-26.8, 1.4]] as const) crate(k, x, z, 1.2);
  crate(k, -36.4, -20.4, 0.9, 1.2);
  k.cyl(0.3, 0.9, 8, 'barrel', -23.0, 0.45, -1.8);
  k.cyl(0.3, 0.9, 8, 'barrel', -23.4, 0.45, -1.1);

  // Street lamps down the prison side and the far side; trees on the far pavement.
  streetLamp(k, -22.9, -38.0, -1, 0);
  streetLamp(k, -22.9, -27.0, -1, 0);
  streetLamp(k, -22.9, -18.6, -1, 0);
  streetLamp(k, -22.6, -6.0, -1, 0);
  streetLamp(k, -38.8, -16.0, 1, 0);
  streetLamp(k, -36.8, -33.0, 1, 0);
  streetLamp(k, -12.0, -36.2, 0, 1);
  streetLamp(k, -4.0, -29.4, 0, -1, 5.0, 'street');
  tree(k, -38.4, -21.6, 7, 2.2);
  tree(k, -36.6, -1.4, 6.5, 2.0);
  tree(k, -33.6, -41.0, 7, 2.2);
  // Overhead wires across the street (render only).
  for (const z of [-30, -14, -2]) k.trim(16, 0.03, 0.03, 'steel', -30, 6.2, z);
}

// ---------------------------------------------------------------------------------------------
// The prison
// ---------------------------------------------------------------------------------------------

/** The gate off the street, with the flag over it, and the watch tower beside it. */
function gate(k: MapKit): void {
  // Lintel wall over the 6 m opening between the North Block and the Theatre's west wing.
  k.aabb(-22.6, 3.6, -23.6, -21.8, 5.4, -17.4, 'stone');
  k.aabb(-22.8, 5.4, -23.8, -21.6, 5.7, -17.2, 'stoneDark');
  // The two gate leaves, swung open against the inside walls (render only).
  k.wallDecal(2.8, 3.4, 'door', -20.4, 0, -23.18, 0, { uv: 'raw' });
  k.wallDecal(2.8, 3.4, 'door', -20.4, 0, -17.82, PI, { uv: 'raw' });
  // Flag on a pole over the gate.
  k.box(0.1, 3.2, 0.1, 'steel', -22.2, 5.7, -20.5, { collide: false });
  k.wallDecal(2.4, 1.6, 'flag', -22.2, 7.2, -19.2, PI / 2, { uv: 'raw', seg: 1 });
  k.wallDecal(2.2, 2.0, 'poster', -22.62, 3.6, -20.5, -PI / 2, { uv: 'raw', seg: 1 });
  flood(k, -23.0, 3.4, -21.8, 12);
  flood(k, -21.4, 3.4, -20.5, 12);

  // Watch tower (outside the gate, by the bus): stone base, timber cabin, searchlight.
  const X0 = -24.8;
  const X1 = -22.2;
  const Z0 = -16.4;
  const Z1 = -13.8;
  k.aabb(X0, 0, Z0, X1, 5.8, Z1, 'stone');
  k.aabb(X0 - 0.3, 5.8, Z0 - 0.3, X1 + 0.3, 6.0, Z1 + 0.3, 'woodDark');
  for (const [x, z] of [[X0 - 0.2, Z0 - 0.2], [X1 + 0.2, Z0 - 0.2], [X0 - 0.2, Z1 + 0.2], [X1 + 0.2, Z1 + 0.2]] as const) k.box(0.16, 2.2, 0.16, 'woodDark', x, 6.0, z, { collide: false });
  k.aabb(X0 - 0.3, 6.0, Z0 - 0.3, X1 + 0.3, 7.0, Z0 - 0.2, 'planks', { collide: false });
  k.aabb(X0 - 0.3, 6.0, Z1 + 0.2, X1 + 0.3, 7.0, Z1 + 0.3, 'planks', { collide: false });
  k.aabb(X0 - 0.3, 6.0, Z0 - 0.2, X0 - 0.2, 7.0, Z1 + 0.2, 'planks', { collide: false });
  k.aabb(X1 + 0.2, 6.0, Z0 - 0.2, X1 + 0.3, 7.0, Z1 + 0.2, 'planks', { collide: false });
  k.ramp(X0 - 0.7, 8.2, Z0 - 0.7, (X0 + X1) / 2, 9.4, Z1 + 0.7, '+x', 'roofGrey', { collide: false });
  k.ramp((X0 + X1) / 2, 8.2, Z0 - 0.7, X1 + 0.7, 9.4, Z1 + 0.7, '-x', 'roofGrey', { collide: false });
  k.trim(0.5, 0.4, 0.6, 'steel', X1, 7.2, (Z0 + Z1) / 2);
  k.trim(0.12, 0.42, 0.5, 'lamp', X1 + 0.3, 7.2, (Z0 + Z1) / 2);
  k.glow(X1 + 0.5, 7.4, (Z0 + Z1) / 2, [1, 0.95, 0.8], 3.6, 'flood');
  k.light(X1 + 2.5, 5.0, (Z0 + Z1) / 2 - 1.0, [1.3, 1.3, 1.25], 16, 'flood');
  k.wallDecal(1.6, 2.2, 'poster', X0 - 0.01, 1.4, (Z0 + Z1) / 2, -PI / 2, { uv: 'raw', seg: 1 });
}

/** The North Block: a single-storey cell block, door through from the North Lane (porch) to the courtyard. */
function northBlock(k: MapKit): void {
  const x0 = -22.6;
  const x1 = -8.4;
  const z0 = -29.0;
  const z1 = -23.6;
  const n = [door(-13.7, 1.3), slot(-20.0), slot(-17.0), slot(-10.4)];
  const s = [door(-19.4), door(-11.4), slot(-16.4), slot(-14.2)];
  const w = [slot(-26.3, 1.2)];
  const e = [door(-26.3, 1.2)];
  shell(k, x0, z0, x1, z1, E1, 'stone', 'limewash', { n, s, w, e });
  bars(k, 'x', z0 + T / 2, n);
  bars(k, 'x', z1 - T / 2, s);
  bars(k, 'z', x0 + T / 2, w);
  gable(k, x0, z0, x1, z1, E1, 1.6, 'roofMoss', 'x');
  k.flatDecal(x1 - x0 - 2 * T, z1 - z0 - 2 * T, 'floor', (x0 + x1) / 2, 0.02, (z0 + z1) / 2);
  // Cells along the north wall: half-height partitions with plank bunks.
  for (const x of [-20.6, -18.2, -15.6]) k.aabb(x - 0.1, 0, z0 + T, x + 0.1, 2.4, z0 + 2.2, 'limewash');
  for (const x of [-11.8, -9.6]) k.aabb(x - 0.1, 0, z0 + T, x + 0.1, 2.4, z0 + 2.2, 'limewash');
  for (const x of [-21.6, -19.4, -16.9, -10.7]) k.box(1.0, 0.5, 0.7, 'planks', x, 0, z0 + T + 0.4);
  // The porch on the North Lane: posts and a tin roof.
  for (const x of [-14.7, -12.7]) k.box(0.18, 2.8, 0.18, 'woodDark', x, 0, -32.4);
  k.aabb(-15.0, 2.8, -32.7, -12.4, 2.95, z0, 'tin', { collide: false });
  k.wallDecal(1.8, 2.4, 'poster', -16.2, 1.0, z0 - 0.01, PI, { uv: 'raw', seg: 1 });
  bulb(k, -18.0, 3.4, -26.3);
  bulb(k, -12.0, 3.4, -26.3);
  flood(k, -15.4, 3.4, z1 + 0.25);
  flood(k, -13.7, 2.6, -32.0, 10);
}

/** The Gallows courtyard: the raised platform, the gallows frame, the semicircular steps to the theatre. */
function gallows(k: MapKit): void {
  const x0 = -12.6;
  const x1 = -3.4;
  const z0 = -18.0;
  const z1 = -13.2;
  k.aabb(x0, 0, z0, x1, GALLOWS, z1, 'planks', { faceMats: { py: 'woodDark' } });
  k.stairs(-14.6, 0, -16.2, x0, GALLOWS, -14.6, '+x', 'wood', 7);
  // Rails round the platform (players stop at hip height; bullets and sight pass).
  const rail = { bullets: false, sight: false } as const;
  k.aabb(x0, GALLOWS, z0, x1, GALLOWS + 0.95, z0 + 0.08, 'woodDark', rail);
  k.aabb(x0, GALLOWS, z1 - 0.08, x1, GALLOWS + 0.95, z1, 'woodDark', rail);
  k.aabb(x1 - 0.08, GALLOWS, z0, x1, GALLOWS + 0.95, z1, 'woodDark', rail);
  k.aabb(x0, GALLOWS, z0, x0 + 0.08, GALLOWS + 0.95, -16.2, 'woodDark', rail);
  k.aabb(x0, GALLOWS, -14.6, x0 + 0.08, GALLOWS + 0.95, z1, 'woodDark', rail);
  // The gallows: two posts and a beam with three nooses over trapdoors.
  for (const x of [-10.2, -5.4]) k.box(0.26, 3.2, 0.26, 'woodDark', x, GALLOWS, -15.6);
  k.trim(5.2, 0.26, 0.26, 'woodDark', -7.8, GALLOWS + 3.2, -15.6);
  for (const x of [-9.0, -7.8, -6.6]) {
    k.trim(0.04, 1.1, 0.04, 'rope', x, GALLOWS + 2.1, -15.6);
    k.flatDecal(0.9, 0.9, 'woodDark', x, GALLOWS + 0.01, -15.6, { seg: 1 });
  }
  // The blood pool under the platform's edge.
  k.flatDecal(1.4, 0.9, 'blood', -7.6, 0.03, -12.7, { seg: 1 });
  // Semicircular steps up to the theatre door (two boxes).
  k.aabb(-8.6, 0, -11.2, -5.4, 0.36, -8.8, 'stone');
  k.aabb(-9.4, 0, -10.4, -4.6, 0.36, -8.8, 'stone');
  // Sandbag nest by the North Block and crates against the Cell Block.
  sandbags(k, -16.6, -22.6, -15.2, -20.2, 1.0);
  sandbags(k, -16.6, -22.6, -13.6, -21.6, 1.0);
  crate(k, -2.0, -17.4, 1.2);
  crate(k, -2.4, -15.9, 1.0);
  k.cyl(0.3, 0.9, 8, 'barrel', -15.8, 0.45, -10.0);
  k.light(-7.8, GALLOWS + 3.0, -15.6, [1.2, 1.1, 0.95], 9, 'flood');
}

/** The Theatre: the L-shaped re-education block (west wing along the street, projector room on the south). */
function theatre(k: MapKit): void {
  const wx0 = -22.2;
  const wx1 = -17.0;
  const wz0 = -17.6;
  const wz1 = 4.2;
  const sz0 = -8.8;
  const sz1 = -0.4;
  const sx1 = 0.2;
  // West wing: street wall (high barred slots), north door into the gate passage, east door to the courtyard.
  const wWest = [slot(-11.0, 1.0, 2.2, 3.0), slot(-3.0, 1.0, 2.2, 3.0)];
  k.wall('z', wz0, wz1, wx0 + T / 2, 0, E1, T, 'stone', wWest, { faceMats: { px: 'limewash' } });
  bars(k, 'z', wx0 + T / 2, wWest);
  k.wall('x', wx0 + T, wx1, wz0 + T / 2, 0, E1, T, 'stone', [door(-19.6, 1.4)], { faceMats: { pz: 'limewash' } });
  k.wall('x', wx0 + T, wx1, wz1 - T / 2, 0, E1, T, 'stone', [], { faceMats: { nz: 'limewash' } });
  k.wall('z', wz0 + T, sz0, wx1 - T / 2, 0, E1, T, 'stone', [door(-13.0, 1.4)], { faceMats: { nx: 'limewash' } });
  k.wall('z', sz1, wz1 - T, wx1 - T / 2, 0, E1, T, 'stone', [], { faceMats: { nx: 'limewash' } });
  gable(k, wx0, wz0, wx1, wz1, E1, 1.6, 'roofMoss', 'z');
  // Projector room (south wing): door from the courtyard steps, east door to the Yard, south door to the nook.
  const sN = [door(-7.0, 1.6), slot(-13.0), slot(-2.4)];
  k.wall('x', wx1 - T, sx1, sz0 + T / 2, 0, E1, T, 'stone', sN, { faceMats: { pz: 'limewash' } });
  bars(k, 'x', sz0 + T / 2, sN.slice(1));
  k.wall('x', wx1 - T, sx1, sz1 - T / 2, 0, E1, T, 'stone', [door(-12.0, 1.4)], { faceMats: { nz: 'limewash' } });
  k.wall('z', sz0 + T, sz1 - T, sx1 - T / 2, 0, E1, T, 'stone', [door(-4.6, 1.4)], { faceMats: { nx: 'limewash' } });
  gable(k, wx1, sz0, sx1, sz1, E1, 1.6, 'roofMoss', 'x');
  k.flatDecal(wx1 - wx0 - 2 * T, wz1 - wz0 - 2 * T, 'floor', (wx0 + wx1) / 2, 0.02, (wz0 + wz1) / 2);
  k.flatDecal(sx1 - T - (wx1 - T), sz1 - sz0 - 2 * T, 'floor', (wx1 - T + sx1 - T) / 2, 0.021, (sz0 + sz1) / 2);
  // The projector screen on the south wall, the projector on its table, benches facing the screen.
  k.wallDecal(3.6, 2.2, 'screen', -7.0, 0.9, sz1 - T - 0.02, PI, { uv: 'raw', seg: 2 });
  k.box(0.9, 0.8, 0.7, 'woodDark', -8.8, 0, -7.0);
  k.trim(0.4, 0.35, 0.5, 'steel', -8.8, 0.8, -7.0);
  k.light(-7.0, 2.0, -2.0, [0.9, 0.95, 1.1], 7, 'interior');
  for (const z of [-4.2, -5.8]) for (const x of [-10.4, -3.8]) k.box(3.0, 0.45, 0.4, 'wood', x, 0, z, { sight: false });
  // The clock next to the screen.
  k.cyl(0.25, 0.06, 12, 'limewash', -4.4, 2.6, sz1 - T - 0.03, { collide: false });
  // RE-EDUCATION over the north door, posters on the courtyard face.
  k.wallDecal(2.2, 0.55, 'sign', -7.0, 2.5, sz0 - 0.02, PI, { uv: 'raw', seg: 1 });
  k.wallDecal(1.4, 2.0, 'poster', -11.0, 0.9, sz0 - 0.02, PI, { uv: 'raw', seg: 1 });
  k.wallDecal(1.4, 2.0, 'poster', -17.02, 0.9, -15.2, -PI / 2, { uv: 'raw', seg: 1 });
  // West wing: bunks and a desk.
  for (const z of [-15.6, -12.0, -8.0]) k.box(0.8, 0.5, 1.9, 'planks', wx0 + T + 0.45, 0, z);
  k.box(1.6, 0.78, 0.8, 'woodDark', -18.4, 0, 1.6);
  bulb(k, -19.6, 3.5, -12.0);
  bulb(k, -19.6, 3.5, -2.0);
  bulb(k, -12.5, 3.5, -4.6);
  flood(k, -7.0, 3.5, sz0 - 0.25);
  flood(k, -17.3, 3.5, -12.0);
  lantern(k, -5.2, 2.6, -9.3);
}

/** The Guardhouse: two storeys south of the theatre, stairs up its east face to a landing. */
function guardhouse(k: MapKit): void {
  const x0 = -5.4;
  const x1 = 0.2;
  const z0 = -0.4;
  const z1 = 6.8;
  // The north wall is the theatre's south wall below the floor; above it the guardhouse has its own.
  const s = [door(-2.6, 1.3), upWin(-2.6, 2.2)];
  const w = [door(3.2, 1.2), upWin(2.0, 1.6)];
  const e = [slot(4.6, 1.0, 1.0, 2.2), upDoor(0.9, 1.1), upWin(4.2, 1.4)];
  // Above the theatre's roof line the guardhouse has its own north wall.
  k.wall('x', x0 + T, x1 - T, z0 + T / 2, E1, E2 - E1, T, 'plasterGrey', [{ a0: -4.0, a1: -2.8, y0: 0.2, y1: 1.4 }], { faceMats: { pz: 'limewash' } });
  k.wall('x', x0, x1, z1 - T / 2, 0, E2, T, 'plasterGrey', s, { faceMats: { nz: 'limewash' } });
  k.wall('z', z0, z1 - T, x0 + T / 2, 0, E2, T, 'plasterGrey', w, { faceMats: { px: 'limewash' } });
  k.wall('z', z0, z1 - T, x1 - T / 2, 0, E2, T, 'plasterGrey', e, { faceMats: { nx: 'limewash' } });
  bars(k, 'z', x1 - T / 2, e.slice(0, 1));
  k.aabb(x0 + T, F2 - 0.2, z0, x1 - T, F2, z1 - T, 'limewash', { faceMats: { py: 'floor', ny: 'ceiling' } });
  gable(k, x0, z0, x1, z1, E2, 1.5, 'roof', 'z');
  k.flatDecal(x1 - x0 - 2 * T, z1 - z0 - 2 * T, 'floor', (x0 + x1) / 2, 0.02, (z0 + z1) / 2);
  // Outside stairs up the east face (rising north) to the landing at the upper door.
  k.stairs(x1, 0, 1.9, 1.6, F2, z1, '-z', 'wood', 15);
  k.aabb(x1, F2 - 0.2, -0.1, 1.6, F2, 1.9, 'planks', { faceMats: { ny: 'woodDark' } });
  for (const z of [0.0, 1.8]) k.box(0.14, F2 - 0.2, 0.14, 'woodDark', 1.5, 0, z);
  const rail = { bullets: false, sight: false } as const;
  k.aabb(1.52, F2, -0.1, 1.6, F2 + 0.95, 1.9, 'woodDark', rail);
  k.aabb(x1, F2, -0.1, 1.6, F2 + 0.95, -0.02, 'woodDark', rail);
  for (let i = 0; i <= 5; i++) k.trim(0.06, 0.95, 0.06, 'woodDark', 1.56, F2 * (1 - i / 5), 1.95 + i * 0.96);
  // Inside: a desk and lockers below, cots above.
  k.box(1.4, 0.78, 0.7, 'woodDark', -3.6, 0, 1.0);
  k.box(0.5, 1.9, 1.6, 'steel', x0 + T + 0.3, 0, 5.0);
  k.box(1.9, 0.5, 0.8, 'planks', -3.4, F2, 5.8);
  k.box(0.8, 0.5, 1.9, 'planks', x0 + T + 0.45, F2, 1.4);
  bulb(k, -2.6, 2.8, 3.2);
  bulb(k, -2.6, F2 + 2.9, 3.2);
  flood(k, 0.45, 2.6, 4.6);
  lantern(k, -2.6, 2.7, 7.3);
}

/** The Cell Block: 30 m long, turned 45 degrees; cells off a corridor, the two-storey guard end to the south-east. */
function cellBlock(k: MapKit): Frame {
  const { ox, oz, th, length: L, split: S } = CELL_BLOCK;
  const f = new Frame(k, ox, oz, th);
  const tw = 0.6;
  const V = 2.7;
  // Long walls: NE (v -2.7) and SW (v +2.7).
  const ne: Hole[] = [door(8.0, 1.7), slot(3.6), slot(12.6), slot(17.4), upWin(24.4, 1.4), upWin(27.6, 1.4)];
  const sw: Hole[] = [door(6.0, 1.7), door(16.0, 1.7), slot(10.6), slot(19.6, 1.0), upWin(25.6, 1.6)];
  const e = tw / 2;
  f.wallU(-V, e, L - e, 0, E1, tw, 'stone', ne.filter((h) => h.a1 < S));
  f.wallU(V, e, L - e, 0, E1, tw, 'stone', sw.filter((h) => h.a1 < S));
  // The guard end rises a storey: its long walls carry on up to E2.
  f.wallU(-V, S - e, L - e, E1, E2 - E1, tw, 'stone', ne.filter((h) => h.a0 > S).map((h) => ({ ...h, y0: h.y0 - E1, y1: h.y1 - E1 })));
  f.wallU(V, S - e, L - e, E1, E2 - E1, tw, 'stone', sw.filter((h) => h.a0 > S).map((h) => ({ ...h, y0: h.y0 - E1, y1: h.y1 - E1 })));
  // Ends: NW door to the North Lane passage; SE door and the big upstairs window over the Well.
  const iv = V - tw / 2;
  f.wallV(tw / 2, -iv, iv, 0, E1, tw, 'stone', [door(1.0, 1.7)]);
  f.wallV(L - tw / 2, -iv, iv, 0, E2, tw, 'stone', [door(-0.4, 1.7), { a0: -1.4, a1: 1.4, y0: F2 + 0.8, y1: F2 + 2.2 }]);
  // Partition at the guard end (door from the corridor), full height: above the low roof it is the guard end's gable.
  f.wallV(S, -iv, iv, 0, E2, tw, 'stone', [door(0.2, 1.5)]);
  // Cells along the NE side: partitions off the corridor (v -2.4 .. -0.4); the passage cell at u 7.2-8.8 has the outside door.
  for (const u of [3.0, 5.5, 7.2, 8.8, 11.3, 13.8, 16.3, 18.8]) f.wallV(u, -V + tw / 2, -0.4, 0, 2.6, 0.3, 'limewash');
  for (const u of [1.8, 4.2, 12.5, 15.0, 17.5]) f.box(u - 0.5, -2.3, u + 0.5, -1.5, 0, 0.5, 'planks');
  f.floorDecal(0.6, -2.4, S, 2.4, 'flagsDark', 0.021);
  f.floorDecal(S + 0.3, -2.4, L - 0.6, 2.4, 'floor', 0.021);
  // Ceiling of the single-storey run, ceiling and floor of the guard end.
  f.vis(0.6, -2.4, S - 0.3, 2.4, E1 - 0.14, E1, 'ceiling', { hide: ['py'] });
  f.solid(0.6, -2.4, S - 0.3, 2.4, E1 - 0.14, E1, 'ceiling');
  // Upstairs floor with the stairwell along the SW wall (inner stairs rising south-east).
  f.floor(S + 0.3, -2.4, L - 0.6, 2.4, F2, 0.2, 'planks', [[22.0, 1.0, 28.4, 2.4]]);
  f.stairs(22.0, 1.05, 28.4, 2.4, 0, F2, '+u', 'wood', 15);
  f.box(22.0, 0.7, 28.4, 1.0, F2, F2 + 0.95, 'woodDark', { bullets: false, sight: false });
  f.vis(S + 0.3, -2.4, L - 0.6, 2.4, E2 - 0.14, E2, 'ceiling', { hide: ['py'] });
  f.solid(S + 0.3, -2.4, L - 0.6, 2.4, E2 - 0.14, E2, 'ceiling');
  // Stepped clay roofs (tiers along the length), a player clip over each.
  const roof = (u0: number, u1: number, y: number) => {
    for (let i = 0; i < 5; i++) {
      const hw = 3.4 - i * 0.62;
      f.vis(u0 - 0.3 + i * 0.05, -hw, u1 + 0.3 - i * 0.05, hw, y + i * 0.32, y + (i + 1) * 0.32, i < 4 ? 'roofMoss' : 'roofGrey');
    }
    f.solid(u0, -V - 0.3, u1, V + 0.3, y, 14, 'clip', { bullets: false, sight: false, tag: 'roof' }, 1.0);
  };
  roof(0, S, E1);
  roof(S, L, E2);
  // Covered walkway along the SW face (Yard side): posts and a tin roof.
  for (let u = 4.0; u <= 20.0; u += 4.0) f.post(u, 5.0, 2.8, 'woodDark');
  f.vis(3.6, V + 0.3, 20.4, 5.3, 2.8, 2.92, 'tin');
  // Lights: corridor bulbs, the guard room, the walkway, the NE plaza face.
  for (const u of [4.0, 10.0, 16.0]) f.light(u, 3.3, 1.0, [1.35, 1.1, 0.72], 8, 'interior');
  f.light(25.0, 2.8, -1.0, [1.35, 1.1, 0.72], 8, 'interior');
  f.light(26.0, F2 + 2.6, 0, [1.35, 1.1, 0.72], 8, 'interior');
  for (const u of [8.0, 16.0]) f.light(u, 2.6, 4.2, [1.4, 0.6, 0.32], 7, 'lantern');
  for (const u of [6.0, 14.0, 24.0]) f.light(u, 3.5, -3.6, [1.15, 1.2, 1.35], 12, 'flood');
  f.light(L + 0.6, F2 + 0.4, -0.3, [1.15, 1.2, 1.35], 12, 'flood');
  // Posters on the Yard face.
  f.wallDecalU(11.5, V + 0.31, 0.9, 1.4, 2.0, 'poster', 1, { uv: 'raw' });
  return f;
}

/** The two huts in the Yard (corrugated, tin roofs), solid cover. */
function huts(k: MapKit): void {
  for (const [z0, z1] of [[-2.0, 2.0], [2.4, 6.4]] as const) {
    k.aabb(5.4, 0, z0, 10.2, 2.6, z1, 'corr');
    k.aabb(5.2, 2.6, z0 - 0.2, 10.4, 2.75, z1 + 0.2, 'tin');
    k.wallDecal(1.0, 2.0, 'door', 5.38, 0, (z0 + z1) / 2, -PI / 2, { uv: 'raw', seg: 1 });
  }
  // Yard clutter: crates, barrels and sandbags between the huts and the Cell Block.
  crate(k, 11.4, -1.2, 1.2);
  crate(k, 11.6, 0.1, 1.0);
  crate(k, 3.2, 9.6, 1.2);
  sandbags(k, 12.2, 7.0, 14.6, 8.0, 1.0);
  k.cyl(0.3, 0.9, 8, 'barrel', 4.4, 0.45, -5.0);
  k.cyl(0.3, 0.9, 8, 'barrel', 4.0, 0.45, -4.3);
  // A cart in the B yard.
  k.box(1.4, 0.7, 2.4, 'planks', -8.6, 0.35, 4.0);
  for (const s of [-1, 1]) k.cyl(0.4, 0.12, 10, 'woodDark', -8.6 + s * 0.76, 0.4, 4.0, { axis: 'x', collide: false });
  sandbags(k, -11.6, 9.0, -9.4, 10.0, 1.0);
  flood(k, 7.8, 3.4, -2.25);
  k.light(-8.0, 3.6, 8.6, [1.15, 1.2, 1.35], 12, 'flood');
}

/** The Hall: the T-shaped wash-house block along the south (long hall, west wing, south room). */
function hall(k: MapKit): void {
  const bx0 = -17.0;
  const bx1 = 13.0;
  const bz0 = 11.6;
  const bz1 = 17.6;
  const vz0 = 1.6;
  const sx0 = -2.4;
  const sx1 = 4.6;
  const sz1 = 26.2;
  // West wall (wing + hall), wing north and east walls.
  k.wall('z', vz0, bz1, bx0 + T / 2, 0, E1, T, 'stone', [slot(6.0), slot(14.6)], { faceMats: { px: 'limewash' } });
  k.wall('x', bx0 + T, -12.2, vz0 + T / 2, 0, E1, T, 'stone', [door(-14.6, 1.3)], { faceMats: { pz: 'limewash' } });
  k.wall('z', vz0 + T, bz0, -12.2 - T / 2, 0, E1, T, 'stone', [door(7.0, 1.4)], { faceMats: { nx: 'limewash' } });
  // Hall north wall (Yard side): two doors, windows.
  const n = [door(-6.0, 1.4), door(7.0, 1.4), slot(-9.0), slot(1.0), slot(10.4)];
  k.wall('x', -12.2 - T, bx1, bz0 + T / 2, 0, E1, T, 'stone', n, { faceMats: { pz: 'limewash' } });
  bars(k, 'x', bz0 + T / 2, n);
  // South wall: door to the south courtyard, the opening into the south room, door to the South Lane.
  k.wall('x', bx0 + T, bx1, bz1 - T / 2, 0, E1, T, 'stone', [door(-9.0, 1.3), { a0: sx0 + T + 0.3, a1: sx1 - T - 0.3, y0: 0, y1: 2.6 }, door(9.0, 1.3)], { faceMats: { nz: 'limewash' } });
  // East end: door to the alley.
  k.wall('z', bz0 + T, bz1 - T, bx1 - T / 2, 0, E1, T, 'stone', [door(14.6, 1.4)], { faceMats: { nx: 'limewash' } });
  // South room.
  k.wall('z', bz1, sz1, sx0 + T / 2, 0, E1, T, 'stone', [door(21.0, 1.2)], { faceMats: { px: 'limewash' } });
  k.wall('z', bz1, sz1, sx1 - T / 2, 0, E1, T, 'stone', [door(22.0, 1.4)], { faceMats: { nx: 'limewash' } });
  k.wall('x', sx0 + T, sx1 - T, sz1 - T / 2, 0, E1, T, 'stone', [], { faceMats: { nz: 'limewash' } });
  // Roofs: hall ridge along x, wing and south room ridges along z.
  gable(k, bx0, bz0, bx1, bz1, E1, 1.7, 'roofGrey', 'x');
  gable(k, bx0, vz0, -12.2, bz0, E1, 1.4, 'roofGrey', 'z');
  gable(k, sx0, bz1, sx1, sz1, E1, 1.5, 'roofGrey', 'z');
  k.flatDecal(bx1 - bx0 - 2 * T, bz1 - bz0 - 2 * T, 'flagsDark', (bx0 + bx1) / 2, 0.02, (bz0 + bz1) / 2);
  k.flatDecal(4.8 - 2 * T, bz0 - vz0 - T, 'flagsDark', (bx0 - 12.2) / 2, 0.021, (vz0 + bz0) / 2 + T / 2);
  k.flatDecal(sx1 - sx0 - 2 * T, sz1 - bz1 - T, 'floor', (sx0 + sx1) / 2, 0.021, (bz1 + sz1) / 2);
  // The wash-house: basins along the north wall, pillars down the middle (cover), a tub row.
  for (const x of [-10.6, -8.0, -3.8, -1.6, 3.4, 5.6, 9.4, 11.4]) k.box(0.9, 0.85, 0.5, 'limewash', x, 0, bz0 + T + 0.25, { sight: false });
  for (const x of [-11.0, -4.0, 3.0, 10.0]) k.box(0.45, E1, 0.45, 'stone', x, 0, 14.6);
  for (const x of [-14.8, -13.6]) k.box(0.8, 0.6, 1.6, 'steel', x, 0, 15.8, { sight: false });
  // South room: crates and a table.
  crate(k, 3.4, 25.0, 1.2);
  crate(k, 3.4, 25.0, 0.9, 1.2);
  k.box(1.4, 0.78, 0.8, 'woodDark', -0.6, 0, 22.0);
  // South courtyard (dead end off the hall): crates and a water butt.
  crate(k, -11.0, 22.4, 1.2);
  crate(k, -9.8, 22.6, 1.0);
  k.cyl(0.45, 1.1, 10, 'barrel', -3.8, 0.55, 22.6);
  for (const x of [-12.0, -4.0, 4.0, 10.6]) bulb(k, x, 3.5, 14.6);
  bulb(k, -14.6, 3.5, 6.0);
  bulb(k, 1.1, 3.5, 22.0);
  flood(k, -7.4, 3.3, 18.0, 10);
  flood(k, 1.0, 3.5, bz0 - 0.25);
  lantern(k, -6.0, 2.8, bz0 - 0.5);
}

/** The Barracks: two storeys east of the Yard, outside stairs along its south face; its one-storey wing. */
function barracks(k: MapKit): void {
  const x0 = 16.0;
  const x1 = 21.4;
  const z0 = 0.6;
  const z1 = 17.6;
  const w = [door(4.0, 1.3), door(13.0, 1.3), upWin(6.0), upWin(12.0)];
  const e = [door(14.0, 1.3), upWin(12.0, 1.4), upWin(15.2, 1.2)];
  const n = [door(18.7, 1.3), upWin(18.6, 2.2)];
  const s = [door(20.2, 1.2), upDoor(20.2, 1.2)];
  shell(k, x0, z0, x1, z1, E2, 'plasterOchre', 'limewash', { n, s, w, e });
  k.aabb(x0 + T, F2 - 0.2, z0 + T, x1 - T, F2, z1 - T, 'limewash', { faceMats: { py: 'floor', ny: 'ceiling' } });
  gable(k, x0, z0, x1, z1, E2, 1.8, 'roof', 'z');
  k.flatDecal(x1 - x0 - 2 * T, z1 - z0 - 2 * T, 'floor', (x0 + x1) / 2, 0.02, (z0 + z1) / 2);
  for (const z of [3.0, 8.0, 11.0, 16.0]) k.wallDecal(1.2, 1.5, 'window', x0 - 0.02, 0.9, z, -PI / 2, { uv: 'raw', seg: 1 });
  // Outside stairs up the south face (rising east) to the landing at the upper door.
  k.stairs(15.0, 0, z1, 19.8, F2, 19.0, '+x', 'wood', 15);
  k.aabb(19.8, F2 - 0.2, z1, x1, F2, 19.4, 'planks', { faceMats: { ny: 'woodDark' } });
  k.box(0.14, F2 - 0.2, 0.14, 'woodDark', x1 - 0.1, 0, 19.3);
  const rail = { bullets: false, sight: false } as const;
  k.aabb(19.8, F2, 19.32, x1, F2 + 0.95, 19.4, 'woodDark', rail);
  k.aabb(x1 - 0.08, F2, z1, x1, F2 + 0.95, 19.4, 'woodDark', rail);
  // Inside: bunks along the walls, both floors.
  for (const z of [2.6, 6.2, 9.8]) {
    k.box(0.9, 0.5, 1.9, 'planks', x1 - T - 0.5, 0, z);
    k.box(0.9, 0.5, 1.9, 'planks', x1 - T - 0.5, F2, z + 1.2);
  }
  k.box(1.4, 0.8, 0.7, 'woodDark', 18.6, F2, 15.6);
  // The wing (solid, flat roof with a parapet).
  k.aabb(x1, 0, 5.4, 25.4, 3.2, 9.0, 'plasterGrey');
  k.aabb(x1, 3.2, 5.4, 25.6, 3.6, 9.2, 'stoneDark');
  k.wallDecal(1.0, 2.1, 'door', 25.42, 0, 7.2, PI / 2, { uv: 'raw', seg: 1 });
  bulb(k, 18.7, 2.9, 5.0);
  bulb(k, 18.7, 2.9, 13.0);
  bulb(k, 18.7, F2 + 2.9, 8.6);
  flood(k, 15.75, 3.4, 9.0, 13);
  flood(k, 18.7, 3.0, z0 - 0.25, 12);
  lantern(k, 21.9, 2.6, 13.2);
}

/** The Well courtyard: the well, the arched gate to the Plaza (wall top walkable from the stairs), lanterns. */
function well(k: MapKit): void {
  k.cyl(1.25, 0.9, 12, 'stone', 27.8, 0.45, 0.8);
  k.flatDecal(1.7, 1.7, 'water', 27.8, 0.91, 0.8, { seg: 1, ry: PI / 4 });
  for (const x of [26.7, 28.9]) k.box(0.14, 2.4, 0.14, 'woodDark', x, 0.9, 0.8, { collide: false });
  k.trim(2.5, 0.14, 0.14, 'woodDark', 27.8, 3.3, 0.8);
  k.cyl(0.12, 0.6, 8, 'woodDark', 27.8, 2.9, 0.8, { collide: false });
  // The wall between the Well and the Plaza with its arched gate.
  k.wall('x', 25.0, 32.6, -7.2, 0, F2, 0.6, 'stone', [{ a0: 26.2, a1: 28.8, y0: 0, y1: 2.6 }]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 5) * PI;
    k.trim(0.5, 0.35, 0.62, 'stoneDark', 27.5 - Math.cos(a) * 1.2, 2.2 + Math.sin(a) * 0.5, -7.2);
  }
  // Outside stairs from the courtyard up to the landing that steps onto the wall top.
  k.stairs(23.0, 0, -6.9, 24.6, F2, -1.2, '-z', 'stone', 15);
  k.aabb(22.6, F2 - 0.25, -9.2, 25.0, F2, -6.9, 'stone');
  k.aabb(22.6, 0, -9.2, 23.0, F2 - 0.25, -8.8, 'stone');
  k.aabb(24.6, 0, -9.2, 25.0, F2 - 0.25, -8.8, 'stone');
  const rail = { bullets: false, sight: false } as const;
  k.aabb(22.6, F2, -9.2, 25.0, F2 + 0.95, -9.12, 'rail', rail);
  k.aabb(22.6, F2, -9.2, 22.68, F2 + 0.95, -6.9, 'rail', rail);
  // Cover in the courtyard: crates, a handcart, sandbags by the east wall.
  crate(k, 31.6, -3.8, 1.2);
  crate(k, 31.8, -2.5, 1.0);
  crate(k, 23.4, 3.6, 1.2);
  sandbags(k, 30.8, 3.0, 32.8, 4.0, 1.0);
  k.cyl(0.3, 0.9, 8, 'barrel', 25.0, 0.45, 6.6);
  lantern(k, 22.2, 2.7, 1.8);
  lantern(k, 33.2, 2.7, 0.4);
  flood(k, 27.5, 3.1, -6.85, 14);
  flood(k, 30.5, 3.6, 8.3, 13);
}

/** The East House: two storeys on the east edge, the balcony with the ladder off the Well courtyard. */
function eastHouse(k: MapKit): void {
  const x0 = 29.2;
  const x1 = 33.6;
  const z0 = 8.6;
  const z1 = 24.0;
  const w = [door(11.0, 1.3), door(21.0, 1.3), upDoor(15.6, 1.1), upWin(10.4, 1.4), upWin(20.6, 1.4)];
  const n = [upWin(31.4, 2.0), slot(31.4, 1.2, 1.0, 2.2)];
  const s = [door(30.4, 1.2)];
  shell(k, x0, z0, x1, z1, E2, 'plasterGreen', 'limewash', { n, s, w, e: [] });
  bars(k, 'x', z0 + T / 2, n.slice(1));
  // Upper floor with the stairwell along the east wall (inside stairs rising north).
  k.aabb(x0 + T, F2 - 0.2, z0 + T, x1 - T, F2, 18.4, 'limewash', { faceMats: { py: 'floor', ny: 'ceiling' } });
  k.aabb(x0 + T, F2 - 0.2, 18.4, 31.8, F2, z1 - T, 'limewash', { faceMats: { py: 'floor', ny: 'ceiling' } });
  k.stairs(31.8, 0, 18.4, x1 - T, F2, z1 - T - 0.1, '-z', 'wood', 15);
  k.aabb(31.7, F2, 18.9, 31.8, F2 + 0.95, z1 - T, 'woodDark', { bullets: false, sight: false });
  gable(k, x0, z0, x1, z1, E2, 1.6, 'roof', 'z');
  k.flatDecal(x1 - x0 - 2 * T, z1 - z0 - 2 * T, 'floor', (x0 + x1) / 2, 0.02, (z0 + z1) / 2);
  // The balcony (the banister stops bullets too, as in the original) and its ladder.
  k.aabb(27.8, BALCONY - 0.2, 13.4, x0, BALCONY, 17.8, 'planks', { faceMats: { ny: 'woodDark' } });
  for (const z of [13.5, 17.7]) k.box(0.14, BALCONY - 0.2, 0.14, 'woodDark', 27.9, 0, z);
  k.aabb(27.8, BALCONY, 13.4, 27.9, BALCONY + 1.0, 16.4, 'woodDark');
  k.aabb(27.8, BALCONY, 17.3, 27.9, BALCONY + 1.0, 17.8, 'woodDark');
  k.aabb(27.8, BALCONY, 13.4, x0, BALCONY + 1.0, 13.5, 'woodDark');
  k.aabb(27.8, BALCONY, 17.7, x0, BALCONY + 1.0, 17.8, 'woodDark');
  k.ramp(26.4, 0, 16.4, 27.8, BALCONY, 17.3, '+x', 'clip', { noRender: true, players: true, bullets: false, sight: false, tag: 'stairs' });
  for (const z of [16.45, 17.25]) k.trim(0.07, BALCONY + 1.0, 0.07, 'woodDark', 27.55, 0, z);
  for (let y = 0.35; y < BALCONY + 0.9; y += 0.35) k.trim(0.05, 0.05, 0.8, 'woodDark', 27.55, y, 16.85);
  k.trim(1.6, 0.1, 4.6, 'tin', 28.5, BALCONY + 2.3, 15.6);
  // Inside: shelves, a table, a radio set upstairs.
  k.box(0.5, 1.9, 2.4, 'woodDark', x1 - T - 0.3, 0, 16.0);
  k.box(1.2, 0.78, 0.8, 'woodDark', 30.6, 0, 12.6);
  k.box(1.2, 0.78, 0.7, 'woodDark', 31.6, F2, 12.0);
  k.box(0.6, 0.4, 0.4, 'steel', 31.6, F2 + 0.78, 12.0, { collide: false });
  bulb(k, 31.4, 2.9, 12.0);
  bulb(k, 31.4, 2.9, 20.0);
  bulb(k, 31.4, F2 + 2.9, 16.0);
  lantern(k, 28.4, BALCONY + 2.0, 15.6);
  flood(k, 28.9, 3.2, 21.0, 11);
}

/** The South Lane and the spawn alley: cobbles, a cart, a car, stalls, lamps. */
function southLane(k: MapKit): void {
  k.flatDecal(29, 8.4, 'flagsDark', 18.0, 0.013, 22.2);
  // The alley out to the south-east (turned 45 degrees).
  const a = new Frame(k, 27.7, 27.3, PI / 4);
  a.floorDecal(0, -3.6, 16, 3.6, 'asphalt', 0.014);
  // A cart and its load, a market stall, a car against the east side.
  k.box(1.6, 0.8, 2.8, 'planks', 13.2, 0.4, 23.4);
  for (const s of [-1, 1]) k.cyl(0.45, 0.12, 10, 'woodDark', 13.2 + s * 0.86, 0.45, 23.4, { axis: 'x', collide: false });
  crate(k, 13.2, 23.0, 0.8, 1.2);
  k.aabb(6.2, 0, 24.4, 10.2, 0.9, 25.6, 'planks');
  for (const x of [6.3, 10.1]) k.box(0.1, 2.4, 0.1, 'woodDark', x, 0.9, 25.5, { collide: false });
  k.trim(4.4, 0.08, 1.6, 'tin', 8.2, 3.3, 25.2);
  car(k, 25.6, 24.4, 'x', 'truck');
  crate(k, 17.6, 25.2, 1.2);
  crate(k, 18.8, 25.4, 1.0);
  sandbags(k, 10.6, 19.4, 12.4, 20.4, 1.0);
  // In the alley: sandbag nests and crates (the SOG spawn).
  const ab = new Frame(k, 27.7, 27.3, PI / 4);
  ab.box(6.0, -3.2, 8.0, -2.2, 0, 1.0, 'sandbag');
  ab.box(10.0, 1.8, 11.4, 3.2, 0, 1.2, 'crate');
  streetLamp(k, 12.0, 26.0, 0, -1);
  streetLamp(k, 27.4, 18.0, 1, 0);
  streetLamp(k, 36.8, 41.6, -1, -1);
  lantern(k, 4.9, 2.7, 21.0);
  lantern(k, 8.2, 2.8, 24.9);
  flood(k, 24.0, 3.4, 17.85, 12);
}

/** The Plaza: planters with trees, crate stacks, sandbags; the big tree in the round corner. */
function plaza(k: MapKit): void {
  const turned = (x: number, z: number, s: number, h: number, mat: string) => {
    const f = new Frame(k, x, z, PI / 4);
    f.box(-s / 2, -s / 2, s / 2, s / 2, 0, h, mat);
    return f;
  };
  // Planters (stone, 0.8 m) with trees, the rest crate stacks.
  turned(6.6, -30.8, 3.0, 0.8, 'stone');
  tree(k, 6.6, -30.8, 8, 2.6, 0.8);
  turned(16.6, -31.6, 3.0, 2.4, 'crate');
  turned(16.2, -24.8, 2.6, 1.2, 'crate');
  turned(24.2, -24.8, 3.0, 0.8, 'stone');
  tree(k, 24.2, -24.8, 7.5, 2.4, 0.8);
  turned(12.6, -20.8, 2.6, 1.6, 'crate');
  turned(22.2, -15.6, 3.0, 2.0, 'crate');
  // The big tree in the round north-east corner.
  tree(k, 25.0, -33.6, 10, 3.6);
  // Sandbags by the Cell Block door, barrels.
  sandbags(k, 16.6, -14.2, 18.4, -13.2, 1.0);
  k.cyl(0.3, 0.9, 8, 'barrel', 9.6, 0.45, -36.0);
  k.cyl(0.3, 0.9, 8, 'barrel', 10.3, 0.45, -36.4);
  crate(k, 27.8, -14.2, 1.2);
  flood(k, 14.0, 4.4, -38.1, 15);
  flood(k, 29.5, 4.4, -24.0, 14);
  k.light(5.0, 4.0, -22.0, [1.15, 1.2, 1.35], 13, 'flood');
  lantern(k, 2.6, 2.8, -36.0);
}

/** Beyond the walls: rooftops of the city, a searchlight tower, trees (render only). */
function backdrop(k: MapKit): void {
  const roofs: [number, number, number, number, number, string][] = [
    [-8, -60, 20, -44, 9, 'plasterGrey'], [22, -60, 46, -44, 10, 'plasterOchre'], [36, -30, 56, 0, 8, 'plasterGrey'], [40, 6, 60, 28, 9, 'plasterOchre'],
    [-30, 30, -4, 50, 8, 'plasterOchre'], [0, 32, 20, 52, 9, 'plasterGrey'], [-62, -50, -48, -20, 10, 'plasterGrey'], [-62, -10, -48, 20, 9, 'plasterOchre'],
    [-46, 8, -30, 26, 8, 'plasterGrey'],
  ];
  for (const [x0, z0, x1, z1, h, mat] of roofs) {
    k.aabb(x0, 0, z0, x1, h, z1, mat, { collide: false });
    const zc = (z0 + z1) / 2;
    k.ramp(x0 - 0.4, h, z0 - 0.4, x1 + 0.4, h + 2.6, zc, '+z', 'roof', { collide: false });
    k.ramp(x0 - 0.4, h, zc, x1 + 0.4, h + 2.6, z1 + 0.4, '-z', 'roof', { collide: false });
  }
  // The searchlight tower beyond the north-east corner.
  const tx = 33.0;
  const tz = -41.0;
  for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]] as const) k.trim(0.25, 9, 0.25, 'woodDark', tx + dx, 0, tz + dz);
  k.trim(3.4, 0.2, 3.4, 'planks', tx, 9, tz);
  k.trim(3.4, 1.0, 3.4, 'planks', tx, 9.2, tz, { hide: ['py', 'ny'] });
  k.trim(3.8, 0.15, 3.8, 'tin', tx, 11.4, tz);
  k.glow(tx - 1.6, 10.2, tz + 1.4, [1, 0.96, 0.82], 4, 'flood');
  for (const [x, z, h, r] of [[-48, -40, 9, 3], [42, -40, 10, 3.5], [40, 44, 9, 3], [-24, 34, 8, 3], [52, 12, 9, 3]] as const) tree(k, x, z, h, r);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * PI * 2;
    k.trim(3, 0.04, 0.04, 'steel', Math.cos(a) * 52, 7.5, Math.sin(a) * 50);
  }
}

// ---------------------------------------------------------------------------------------------

const P = (id: string, x: number, y: number, z: number, radius: number, team?: 0 | 1): ObjectivePoint => (team === undefined ? { id, x, y, z, radius } : { id, x, y, z, radius, team });

export function buildHanoi(): MapData {
  const k = new MapKit();
  ground(k);
  outline(k);
  street(k);
  gate(k);
  northBlock(k);
  gallows(k);
  theatre(k);
  guardhouse(k);
  cellBlock(k);
  huts(k);
  hall(k);
  barracks(k);
  well(k);
  eastHouse(k);
  southLane(k);
  plaza(k);
  backdrop(k);

  // ---- spawns: NVA (team 0) in the street and North Lane, SOG (team 1) at the Well and the alley ----
  const E = -PI / 2;
  const team0: SpawnPoint[] = [[-31, -39], [-26.5, -38.4], [-34, -33], [-28.4, -33.4], [-27, -27.4], [-32.6, -26.6], [-29, -19.6], [-41.0, -16.2], [-17.6, -33], [-11, -31]].map(([x, z]) => ({ x: x!, y: 0, z: z!, yaw: yawTo(x!, z!, 0, -10) }));
  const team1: SpawnPoint[] = [[27, -4], [31, -1.4], [31.2, 6.6], [26.4, 4.6], [34, 32.4], [38.4, 36.4], [35.6, 39.6], [30, 29], [26.6, 21.6], [31.8, 27.0]].map(([x, z]) => ({ x: x!, y: 0, z: z!, yaw: yawTo(x!, z!, 0, 0) }));
  const ffa: SpawnPoint[] = [
    { x: -30.0, y: 0, z: -36.0, yaw: E },
    { x: -34.6, y: 0, z: -17.0, yaw: E },
    { x: -24.6, y: 0, z: 1.6, yaw: 0 },
    { x: -16.0, y: 0, z: -33.6, yaw: PI / 2 },
    { x: -19.6, y: 0, z: -6.0, yaw: PI },
    { x: -14.6, y: 0, z: -26.2, yaw: E },
    { x: -9.6, y: 0, z: -20.6, yaw: PI },
    { x: 8.0, y: 0, z: -34.0, yaw: PI },
    { x: 20.0, y: 0, z: -28.0, yaw: yawTo(20, -28, 0, 0) },
    { x: 26.0, y: 0, z: -18.0, yaw: PI },
    { x: 8.0, y: 0, z: -7.0, yaw: PI / 4 },
    { x: -9.0, y: 0, z: 7.0, yaw: -PI / 2 },
    { x: -6.0, y: 0, z: 14.6, yaw: -PI / 2 },
    { x: -2.6, y: F2, z: 3.4, yaw: 0 },
    { x: 18.7, y: F2, z: 9.0, yaw: PI },
    { x: 28.0, y: 0, z: -3.0, yaw: PI / 2 },
    { x: 31.4, y: F2, z: 16.0, yaw: PI / 2 },
    { x: 10.0, y: 0, z: 22.0, yaw: -PI / 2 },
    { x: 36.0, y: 0, z: 37.0, yaw: yawTo(36, 37, 0, 0) },
  ];

  // ---- objectives ----
  // Domination: A in the Gallows courtyard, B in the yard between the Guardhouse and the Hall, C at the Well.
  const dom = [P('A', -7.6, 0, -20.8, 3), P('B', -4.6, 0, 9.2, 3), P('C', 25.2, 0, -1.8, 3)];
  // S&D: A in the re-education (projector) room, B in the Hall; SOG defend from the Well side.
  const sd = [P('A', -10.4, 0, -2.6, 1.6, 1), P('B', 6.6, 0, 14.6, 1.6, 1)];
  const hq = [
    P('hq1', 8.6, 0, -7.4, 3.5),
    P('hq2', 12.0, 0, -29.0, 3.5),
    P('hq3', -30.0, 0, -12.0, 3),
    P('hq4', 0.0, 0, 14.6, 2.4),
    P('hq5', 28.0, 0, -4.6, 3),
    P('hq6', -12.0, 0, -21.0, 3),
    P('hq7', 16.0, 0, 22.4, 3),
    P('hq8', -15.6, 0, -26.3, 2.2),
    P('hq9', -8.4, 0, 7.8, 3),
  ];
  const attackers: SpawnPoint[] = [[-31, -39], [-26.5, -38.4], [-34, -33], [-28.4, -33.4], [-23.4, -40.0], [-17.6, -33], [-11, -31], [-32.4, -40.4]].map(([x, z]) => ({ x: x!, y: 0, z: z!, yaw: yawTo(x!, z!, 0, -10) }));
  const defenders: SpawnPoint[] = [[27, -4], [31, -1.4], [31.2, 6.6], [26.4, 4.6], [30, 29], [26.6, 21.6], [34, 32.4], [31.8, 27.0]].map(([x, z]) => ({ x: x!, y: 0, z: z!, yaw: yawTo(x!, z!, 0, 0) }));

  return {
    id: 'hanoi',
    name: 'Hanoi',
    bounds: HANOI_BOUNDS,
    materials: MATERIALS,
    brushes: k.brushes,
    decals: k.decals,
    props: k.props,
    lights: k.lights,
    spawns: { teams: [team0, team1], ffa },
    objectives: { dom, sd, hq },
    modeSpawns: { sd: { attackers, defenders } },
    // Night only (the original is a night map): moonlight through cloud, sodium street lamps, the
    // prison's floodlights and lanterns. Bright enough ambient that players stay readable.
    times: [
      { id: 'night', name: 'Night', clock: '23:30', sky: 'hn_skyNight', unlit: [0.7, 0.74, 0.9], skyRot: 0, sunDir: unitVec(-0.45, 0.72, -0.5), sun: [0.34, 0.38, 0.55], amb: [0.26, 0.28, 0.38], fog: [0.16, 0.17, 0.24], fogNear: 22, fogFar: 105, lights: { street: 1, flood: 1, lantern: 1, interior: 1 }, glow: 1 },
    ],
    defaultTime: 'night',
    hotspots: [
      { x: -7.6, y: 0, z: -20.8 },
      { x: -4.6, y: 0, z: 9.2 },
      { x: 25.2, y: 0, z: -1.8 },
      { x: -30, y: 0, z: -14 },
      { x: -12, y: 0, z: -33 },
      { x: 12, y: 0, z: -28 },
      { x: 8.6, y: 0, z: -7.4 },
      { x: -7.6, y: GALLOWS, z: -16.8 },
      { x: -10.4, y: 0, z: -4.0 },
      { x: -19.6, y: 0, z: -8.0 },
      { x: -2.6, y: F2, z: 3.4 },
      { x: 18.7, y: F2, z: 9.0 },
      { x: 31.4, y: F2, z: 16.0 },
      { x: 0, y: 0, z: 14.6 },
      { x: 16, y: 0, z: 22.4 },
      { x: 23.4, y: F2, z: -8.0 },
    ],
  };
}

/** Where the Cell Block's guard end upper floor and corridor are, for tests (world coordinates). */
export function cellBlockPoint(u: number, y: number, v: number): Vec3 {
  const c = Math.cos(CELL_BLOCK.th);
  const s = Math.sin(CELL_BLOCK.th);
  return { x: CELL_BLOCK.ox + u * c - v * s, y, z: CELL_BLOCK.oz + u * s + v * c };
}
