/**
 * Blackout bot navigation: a hierarchical grid that fits the 512 m island in memory.
 *
 *   - `TownNav`: each town (plus 8 m of open ground round it) gets the bots feature's 0.5 m walking
 *     grid (stairs, floors, jumps, drops), built once and compacted into typed arrays (~80 bytes a
 *     cell, ~26 MB for the ten towns instead of ~300 MB of cell objects). Built lazily, one town at a
 *     time (`IslandNav.warm`), so no single tick pays for all ten.
 *   - `GroundNav`: the open ground between the towns as a coarse 2 m grid at ground level (hills,
 *     rocks and trees; 65 k cells, a quarter of a megabyte).
 *   - `IslandNav.route`: town grid out to a portal on the town's edge, coarse grid across the open
 *     ground to a portal of the destination town, town grid to the goal. Waypoints only: bots follow
 *     them with the world's own line checks (`clearLine`).
 *
 * Shared per MapData (every Blackout room on the server uses the same grids).
 */
import { CollisionWorld, topAt, type Solid } from '../../../shared/collision';
import { PLAYER } from '../../../shared/constants';
import { BLACKOUT_TOWNS, townRect } from '../../../shared/maps/blackout';
import { buildCollisionWorld, type MapData } from '../../../shared/maps/types';
import type { Vec3 } from '../../../shared/math';
import { freeAt, groundAt, JUMP_UP, MAX_DROP, NAV_CELL } from '../bots/nav';

export interface Waypoint {
  x: number;
  y: number;
  z: number;
  /** The step onto this waypoint is a jump. */
  jump?: boolean;
}

type Rect = { x0: number; z0: number; x1: number; z1: number };

const R = PLAYER.radius + 0.06;
const STEP = PLAYER.stepHeight - 0.02;
const EPS = 0.003;
/** Open ground kept round each town in its grid (m); portals lie 3-7 m out. */
const TOWN_MARGIN = 8;

/** Binary min-heap of indices by priority (typed arrays, reused). */
class Heap {
  private at = new Int32Array(1024);
  private p = new Float32Array(1024);
  size = 0;
  clear(): void {
    this.size = 0;
  }
  push(c: number, pri: number): void {
    if (this.size === this.at.length) {
      const at = new Int32Array(this.size * 2);
      const p = new Float32Array(this.size * 2);
      at.set(this.at);
      p.set(this.p);
      this.at = at;
      this.p = p;
    }
    const { at, p } = this;
    let i = this.size++;
    at[i] = c;
    p[i] = pri;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (p[j]! <= p[i]!) break;
      const tc = at[i]!;
      at[i] = at[j]!;
      at[j] = tc;
      const tp = p[i]!;
      p[i] = p[j]!;
      p[j] = tp;
      i = j;
    }
  }
  pop(): number {
    const { at, p } = this;
    const top = at[0]!;
    const n = --this.size;
    if (n) {
      at[0] = at[n]!;
      p[0] = p[n]!;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < n && p[l]! < p[m]!) m = l;
        if (r < n && p[r]! < p[m]!) m = r;
        if (m === i) break;
        const tc = at[i]!;
        at[i] = at[m]!;
        at[m] = tc;
        const tp = p[i]!;
        p[i] = p[m]!;
        p[m] = tp;
        i = m;
      }
    }
    return top;
  }
}

/** A* scratch over `n` nodes (stamped, so it is never cleared). */
class Scratch {
  g: Float32Array;
  came: Int32Array;
  seen: Uint32Array;
  closed: Uint32Array;
  stamp = 0;
  readonly heap = new Heap();
  constructor(n: number) {
    this.g = new Float32Array(n);
    this.came = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
  }
  next(): number {
    if (++this.stamp >= 0xfffffff0) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.stamp = 1;
    }
    return this.stamp;
  }
}

/** Can a body walk straight from a to b (ground all along within a step, nothing in the way)? */
export function clearLine(world: CollisionWorld, a: Vec3, b: Vec3): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) return true;
  const steps = Math.ceil(d / 0.35);
  let y = a.y;
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const x = a.x + dx * t;
    const z = a.z + dz * t;
    const g = groundAt(world, x, z, y + STEP, STEP * 2, R * 0.9);
    if (g === null) return false;
    if (!freeAt(world, x, g + EPS, z, R * 0.9, PLAYER.height)) return false;
    y = g;
  }
  return Math.abs(y - b.y) <= STEP + 0.1;
}

// ---------------------------------------------------------------------------------------------
// Towns
// ---------------------------------------------------------------------------------------------

/** A town grid's arrays, as the builder produces them. */
interface TownGridData {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  core: Uint8Array;
  eStart: Int32Array;
  eTo: Int32Array;
  eCost: Float32Array;
  eKind: Uint8Array;
  cx0: number;
  cz0: number;
  ncx: number;
  ncz: number;
  colStart: Int32Array;
  colCount: Int32Array;
  ms: number;
}

/**
 * Build one town's walking grid, a slice at a time (a generator: `yield` every few milliseconds of
 * work), straight into typed arrays. The cells and links are the bots feature's NavGrid rules
 * (bots/nav.ts: walk within a step, jump up to JUMP_UP with headroom, drop up to MAX_DROP); core
 * cells are those reachable from the open ground round the town and back.
 */
export function* buildTownGrid(map: MapData, world: CollisionWorld, rect: Rect, sliceMs = 4): Generator<void, TownGridData> {
  let t0 = performance.now();
  let spent = 0;
  const tick = () => {
    const now = performance.now();
    if (now - t0 < sliceMs) return false;
    spent += now - t0;
    return true;
  };
  const m = TOWN_MARGIN;
  const cx0 = Math.ceil((rect.x0 - m) / NAV_CELL);
  const cx1 = Math.floor((rect.x1 + m) / NAV_CELL) - 1;
  const cz0 = Math.ceil((rect.z0 - m) / NAV_CELL);
  const cz1 = Math.floor((rect.z1 + m) / NAV_CELL) - 1;
  const ncx = cx1 - cx0 + 1;
  const ncz = cz1 - cz0 + 1;
  const colStart = new Int32Array(ncx * ncz);
  const colCount = new Int32Array(ncx * ncz);
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const near: Solid[] = [];
  const minY = map.bounds.min.y;
  // ---- Cells: every surface a body can stand on, per 0.5 m column.
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cz = cz0; cz <= cz1; cz++) {
      const x = (cx + 0.5) * NAV_CELL;
      const z = (cz + 0.5) * NAV_CELL;
      const tops: number[] = [];
      for (const sd of world.near(x - R, x + R, z - R, z + R, near)) {
        if (x + R <= sd.min.x || x - R >= sd.max.x || z + R <= sd.min.z || z - R >= sd.max.z) continue;
        const t = topAt(sd, x - R, x + R, z - R, z + R);
        if (t < minY || t > 60) continue;
        tops.push(t);
      }
      tops.sort((a2, b2) => a2 - b2);
      const k = (cx - cx0) * ncz + (cz - cz0);
      colStart[k] = xs.length;
      let last = -Infinity;
      for (const t of tops) {
        if (t - last < 0.05) continue;
        const g = groundAt(world, x, z, t + EPS, 0.02, R);
        if (g === null || Math.abs(g - t) > 0.03) continue;
        if (!freeAt(world, x, t + EPS, z, R, PLAYER.height)) continue;
        last = t;
        xs.push(x);
        ys.push(t);
        zs.push(z);
        colCount[k]!++;
      }
    }
    if (tick()) {
      yield;
      t0 = performance.now();
    }
  }
  const n = xs.length;
  const X = Float32Array.from(xs);
  const Y = Float32Array.from(ys);
  const Z = Float32Array.from(zs);
  const col = (cx: number, cz: number): [number, number] => {
    const i = cx - cx0;
    const j = cz - cz0;
    if (i < 0 || j < 0 || i >= ncx || j >= ncz) return [0, 0];
    const k = i * ncz + j;
    return [colStart[k]!, colCount[k]!];
  };
  const levelIn = (cx: number, cz: number, y: number) => {
    const [st, c] = col(cx, cz);
    for (let i = st; i < st + c; i++) if (Math.abs(Y[i]! - y) <= STEP) return true;
    return false;
  };
  // ---- Links.
  const eStart = new Int32Array(n + 1);
  const eTo: number[] = [];
  const eCost: number[] = [];
  const eKind: number[] = [];
  for (let i = 0; i < n; i++) {
    eStart[i] = eTo.length;
    const x = X[i]!, y = Y[i]!, z = Z[i]!;
    const cx = Math.floor(x / NAV_CELL);
    const cz = Math.floor(z / NAV_CELL);
    const headroomForJump = freeAt(world, x, y + JUMP_UP + EPS, z, R * 0.9, PLAYER.height);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const diag = dx !== 0 && dz !== 0;
        const [st, c] = col(cx + dx, cz + dz);
        if (!c) continue;
        const horiz = NAV_CELL * (diag ? Math.SQRT2 : 1);
        const mx = x + (dx * NAV_CELL) / 2;
        const mz = z + (dz * NAV_CELL) / 2;
        let dropTo = -1;
        for (let j = st; j < st + c; j++) {
          const dh = Y[j]! - y;
          if (Math.abs(dh) <= STEP) {
            if (diag && (!levelIn(cx + dx, cz, y) || !levelIn(cx, cz + dz, y))) continue;
            if (!freeAt(world, mx, Math.max(y, Y[j]!) + EPS, mz, R * 0.95, PLAYER.height)) continue;
            eTo.push(j);
            eCost.push(Math.hypot(horiz, dh));
            eKind.push(0);
          } else if (dh > STEP && dh <= JUMP_UP) {
            if (diag || !headroomForJump) continue;
            if (!freeAt(world, mx, Y[j]! + EPS, mz, R * 0.9, PLAYER.height)) continue;
            eTo.push(j);
            eCost.push(horiz + 1.2 + dh);
            eKind.push(1);
          } else if (dh < -STEP && dh >= -MAX_DROP) {
            if (dropTo < 0 || Y[j]! > Y[dropTo]!) dropTo = j;
          }
        }
        if (dropTo >= 0 && !diag) {
          if (freeAt(world, X[dropTo]!, Y[dropTo]! + EPS, Z[dropTo]!, R * 0.9, y - Y[dropTo]! + PLAYER.height) && freeAt(world, mx, y + EPS, mz, R * 0.9, PLAYER.height)) {
            eTo.push(dropTo);
            eCost.push(horiz + 0.4 + (y - Y[dropTo]!) * 0.3);
            eKind.push(2);
          }
        }
      }
    if ((i & 255) === 0 && tick()) {
      yield;
      t0 = performance.now();
    }
  }
  eStart[n] = eTo.length;
  const ET = Int32Array.from(eTo);
  // ---- Core: reachable from the open ground round the town, and back to it.
  const seeds: number[] = [];
  const cellNear = (px: number, pz: number) => {
    const [st, c] = col(Math.floor(px / NAV_CELL), Math.floor(pz / NAV_CELL));
    for (let i = st; i < st + c; i++) if (Math.abs(Y[i]!) < 0.6) return i;
    return -1;
  };
  for (let px = rect.x0 - 5; px <= rect.x1 + 5; px += 4) for (const pz of [rect.z0 - 5, rect.z1 + 5]) seeds.push(cellNear(px, pz));
  for (let pz = rect.z0 - 5; pz <= rect.z1 + 5; pz += 4) for (const px of [rect.x0 - 5, rect.x1 + 5]) seeds.push(cellNear(px, pz));
  const fwd = new Uint8Array(n);
  const stack: number[] = [];
  for (const sd of seeds) if (sd >= 0 && !fwd[sd]) (fwd[sd] = 1), stack.push(sd);
  while (stack.length) {
    const i = stack.pop()!;
    for (let e = eStart[i]!; e < eStart[i + 1]!; e++) if (!fwd[ET[e]!]) (fwd[ET[e]!] = 1), stack.push(ET[e]!);
  }
  // Reverse links (CSR) for the way back.
  const rStart = new Int32Array(n + 1);
  for (let e = 0; e < ET.length; e++) rStart[ET[e]! + 1]!++;
  for (let i = 0; i < n; i++) rStart[i + 1]! += rStart[i]!;
  const rFrom = new Int32Array(ET.length);
  const fill = rStart.slice(0, n);
  for (let i = 0; i < n; i++) for (let e = eStart[i]!; e < eStart[i + 1]!; e++) rFrom[fill[ET[e]!]!++] = i;
  const back = new Uint8Array(n);
  for (const sd of seeds) if (sd >= 0 && !back[sd]) (back[sd] = 1), stack.push(sd);
  while (stack.length) {
    const i = stack.pop()!;
    for (let e = rStart[i]!; e < rStart[i + 1]!; e++) if (!back[rFrom[e]!]) (back[rFrom[e]!] = 1), stack.push(rFrom[e]!);
  }
  const core = new Uint8Array(n);
  for (let i = 0; i < n; i++) core[i] = fwd[i]! & back[i]!;
  spent += performance.now() - t0;
  return { x: X, y: Y, z: Z, core, eStart, eTo: ET, eCost: Float32Array.from(eCost), eKind: Uint8Array.from(eKind), cx0, cz0, ncx, ncz, colStart, colCount, ms: spent };
}

/** One town's walking grid in typed arrays (~80 bytes a cell; see `buildTownGrid`). */
export class TownNav {
  readonly n: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** Reachable from the open ground round the town and back. */
  readonly core: Uint8Array;
  private eStart: Int32Array;
  private eTo: Int32Array;
  private eCost: Float32Array;
  /** 0 walk, 1 jump, 2 drop. */
  private eKind: Uint8Array;
  private cx0: number;
  private cz0: number;
  private ncx: number;
  private ncz: number;
  private colStart: Int32Array;
  private colCount: Int32Array;
  /** Core cells on the open ground 3-7 m outside the town, about 4 m apart: where routes leave and enter. */
  readonly portals: number[] = [];
  private scratch: Scratch | null = null;
  /** CPU time the build took (ms, summed over its slices). */
  readonly buildMs: number;
  /** Cells expanded by searches (budgeting, tests). */
  expanded = 0;

  constructor(
    d: TownGridData,
    readonly world: CollisionWorld,
    readonly rect: Rect,
  ) {
    this.n = d.x.length;
    this.x = d.x;
    this.y = d.y;
    this.z = d.z;
    this.core = d.core;
    this.eStart = d.eStart;
    this.eTo = d.eTo;
    this.eCost = d.eCost;
    this.eKind = d.eKind;
    this.cx0 = d.cx0;
    this.cz0 = d.cz0;
    this.ncx = d.ncx;
    this.ncz = d.ncz;
    this.colStart = d.colStart;
    this.colCount = d.colCount;
    this.buildMs = d.ms;
    // Portals: core cells at ground level in the band outside the town.
    const taken = new Set<string>();
    for (let i = 0; i < this.n; i++) {
      if (!this.core[i] || Math.abs(this.y[i]!) > 0.3) continue;
      const px = this.x[i]!;
      const pz = this.z[i]!;
      const out = Math.max(rect.x0 - px, px - rect.x1, rect.z0 - pz, pz - rect.z1);
      if (out < 3 || out > 7) continue;
      const k = `${Math.floor(px / 4)},${Math.floor(pz / 4)}`;
      if (taken.has(k)) continue;
      taken.add(k);
      this.portals.push(i);
    }
  }

  /** Build one at once (tests, a route that needs it before its turn). */
  static build(map: MapData, world: CollisionWorld, rect: Rect): TownNav {
    const g = buildTownGrid(map, world, rect, Infinity);
    for (;;) {
      const r = g.next();
      if (r.done) return new TownNav(r.value, world, rect);
    }
  }

  /** Typed-array bytes held (memory budget tests). */
  get bytes(): number {
    return this.n * (12 + 1 + 4) + this.eTo.length * 9 + this.colStart.length * 8;
  }

  private column(cx: number, cz: number): [number, number] {
    const i = cx - this.cx0;
    const j = cz - this.cz0;
    if (i < 0 || j < 0 || i >= this.ncx || j >= this.ncz) return [0, 0];
    const k = i * this.ncz + j;
    const c = this.colCount[k]!;
    return c ? [this.colStart[k]!, c] : [0, 0];
  }

  /** The cell someone standing at `p` is on, or the nearest one around (core cells preferred when asked). */
  cellAt(p: Vec3, preferCore = false): number {
    const cx = Math.floor(p.x / NAV_CELL);
    const cz = Math.floor(p.z / NAV_CELL);
    let best = -1;
    const [s, c] = this.column(cx, cz);
    for (let i = s; i < s + c; i++) if (this.y[i]! <= p.y + 0.6 && (best < 0 || this.y[i]! > this.y[best]!) && (!preferCore || this.core[i])) best = i;
    if (best >= 0 && p.y - this.y[best]! < 2.5) return best;
    let bd = Infinity;
    best = -1;
    for (let r = 1; r <= 4; r++) {
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const [s2, c2] = this.column(cx + dx, cz + dz);
          for (let i = s2; i < s2 + c2; i++) {
            if (preferCore && !this.core[i]) continue;
            const d = Math.hypot(this.x[i]! - p.x, this.z[i]! - p.z) + Math.abs(this.y[i]! - p.y) * 1.5;
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
        }
      if (best >= 0 && r >= 2) break;
    }
    return best;
  }

  /**
   * Stranded somewhere the grid can't leave (a roof or a gantry it landed on, a slot between two
   * blocks; there is no fall damage): the nearest reachable cell at or below its feet within `r`
   * metres, to walk (or drop) toward.
   */
  wayDown(p: Vec3, r = 12): Waypoint | null {
    const cx = Math.floor(p.x / NAV_CELL);
    const cz = Math.floor(p.z / NAV_CELL);
    const n = Math.ceil(r / NAV_CELL);
    let best = -1;
    let bd = Infinity;
    for (let dx = -n; dx <= n; dx += 2)
      for (let dz = -n; dz <= n; dz += 2) {
        const [st, c] = this.column(cx + dx, cz + dz);
        for (let i = st; i < st + c; i++) {
          if (!this.core[i] || this.y[i]! > p.y + 0.4) continue;
          const d = Math.hypot(this.x[i]! - p.x, this.z[i]! - p.z);
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
      }
    return best < 0 ? null : { x: this.x[best]!, y: this.y[best]!, z: this.z[best]! };
  }

  /** Is this point on a reachable cell (or next to one)? */
  reachable(p: Vec3): boolean {
    const c = this.cellAt(p, true);
    return c >= 0 && Math.hypot(this.x[c]! - p.x, this.z[c]! - p.z) < 1.5 && Math.abs(this.y[c]! - p.y) < 1.2;
  }

  /** The last search ran out of `limit` (rather than finding there is no way). */
  hitLimit = false;

  /** A* between two points: waypoints (cell centres, the last at the goal's cell), or null. */
  path(from: Vec3, to: Vec3, limit = 30000): Waypoint[] | null {
    this.hitLimit = false;
    const a = this.cellAt(from);
    let b = this.cellAt(to, true);
    if (b < 0) b = this.cellAt(to);
    if (a < 0 || b < 0) return null;
    if (a === b) return [{ x: this.x[b]!, y: this.y[b]!, z: this.z[b]! }];
    const s = (this.scratch ??= new Scratch(this.n));
    const st = s.next();
    const bx = this.x[b]!, by = this.y[b]!, bz = this.z[b]!;
    const h = (i: number) => (Math.hypot(this.x[i]! - bx, this.z[i]! - bz) + Math.abs(this.y[i]! - by) * 0.5) * 1.3;
    s.seen[a] = st;
    s.g[a] = 0;
    s.came[a] = -1;
    const open = s.heap;
    open.clear();
    open.push(a, h(a));
    let count = 0;
    while (open.size && count++ < limit) {
      this.expanded++;
      const ci = open.pop();
      if (ci === b) {
        const out: Waypoint[] = [];
        for (let k = ci; k !== a && k >= 0; k = s.came[k]!) {
          const prev = s.came[k]!;
          let jump = false;
          if (prev >= 0) for (let e = this.eStart[prev]!; e < this.eStart[prev + 1]!; e++) if (this.eTo[e] === k) jump = this.eKind[e] === 1;
          out.push({ x: this.x[k]!, y: this.y[k]!, z: this.z[k]!, ...(jump ? { jump } : {}) });
        }
        return out.reverse();
      }
      if (count === limit) this.hitLimit = true;
      if (s.closed[ci] === st) continue;
      s.closed[ci] = st;
      const gc = s.g[ci]!;
      for (let e = this.eStart[ci]!; e < this.eStart[ci + 1]!; e++) {
        const to2 = this.eTo[e]!;
        const t = gc + this.eCost[e]!;
        if (s.seen[to2] !== st || t < s.g[to2]!) {
          s.seen[to2] = st;
          s.g[to2] = t;
          s.came[to2] = ci;
          open.push(to2, t + h(to2));
        }
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Open ground
// ---------------------------------------------------------------------------------------------

/** The island's open ground as a coarse grid at ground level (towns excluded). */
export class GroundNav {
  readonly S = 2;
  readonly N: number;
  /** Standing height per cell; NaN = not walkable (rock, tree, town, sea). */
  readonly h: Float32Array;
  private scratch: Scratch;
  expanded = 0;

  constructor(
    readonly world: CollisionWorld,
    readonly half: number,
    towns: Rect[],
  ) {
    this.N = Math.ceil((half * 2) / this.S);
    const N = this.N;
    this.h = new Float32Array(N * N).fill(NaN);
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        const x = -half + (i + 0.5) * this.S;
        const z = -half + (j + 0.5) * this.S;
        if (Math.abs(x) > half - 2.5 || Math.abs(z) > half - 2.5) continue;
        if (towns.some((r) => x > r.x0 - 1 && x < r.x1 + 1 && z > r.z0 - 1 && z < r.z1 + 1)) continue;
        // The highest top under a wide footprint (on a ramp, its upper edge), then room for a body
        // a bit wider than a player there (clearance from rocks and trunks).
        const g = groundAt(world, x, z, 12, 14, 0.75);
        if (g === null || !freeAt(world, x, g + EPS, z, 0.75, PLAYER.height)) continue;
        this.h[i * N + j] = g;
      }
    this.scratch = new Scratch(N * N);
    this.keepConnected();
  }

  /** Cells walkable but cut off from the open ground (rock tops, a hollow) are dropped. */
  private keepConnected(): void {
    const N = this.N;
    let seed = -1;
    for (const [x, z] of [[-100, -130], [100, -100], [-110, 110], [100, 120], [-90, 0]] as const) {
      seed = this.idx(x, z);
      if (this.walkable(seed)) break;
    }
    if (!this.walkable(seed)) return;
    const reach = (dir: 1 | -1) => {
      const seen = new Uint8Array(N * N);
      const stack = [seed];
      seen[seed] = 1;
      while (stack.length) {
        const k = stack.pop()!;
        const i = Math.floor(k / N);
        const j = k % N;
        for (let di = -1; di <= 1; di++)
          for (let dj = -1; dj <= 1; dj++) {
            if (!di && !dj) continue;
            const ni = i + di;
            const nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
            const nk = ni * N + nj;
            if (seen[nk] || !this.walkable(nk)) continue;
            if (di && dj && (!this.walkable(ni * N + j) || !this.walkable(i * N + nj))) continue;
            if ((dir > 0 ? this.link(k, nk) : this.link(nk, k)) < 0) continue;
            seen[nk] = 1;
            stack.push(nk);
          }
      }
      return seen;
    };
    const f = reach(1);
    const b = reach(-1);
    for (let k = 0; k < N * N; k++) if (!f[k] || !b[k]) this.h[k] = NaN;
  }

  idx(x: number, z: number): number {
    const i = Math.floor((x + this.half) / this.S);
    const j = Math.floor((z + this.half) / this.S);
    if (i < 0 || j < 0 || i >= this.N || j >= this.N) return -1;
    return i * this.N + j;
  }

  walkable(k: number): boolean {
    return k >= 0 && !Number.isNaN(this.h[k]!);
  }

  /** The walkable cell at or nearest a point (within 3 cells). */
  cellNear(x: number, z: number): number {
    const k = this.idx(x, z);
    if (this.walkable(k)) return k;
    let best = -1;
    let bd = Infinity;
    const i0 = Math.floor((x + this.half) / this.S);
    const j0 = Math.floor((z + this.half) / this.S);
    for (let r = 1; r <= 3 && best < 0; r++)
      for (let di = -r; di <= r; di++)
        for (let dj = -r; dj <= r; dj++) {
          const i = i0 + di;
          const j = j0 + dj;
          if (i < 0 || j < 0 || i >= this.N || j >= this.N) continue;
          const kk = i * this.N + j;
          if (!this.walkable(kk)) continue;
          const d = di * di + dj * dj;
          if (d < bd) {
            bd = d;
            best = kk;
          }
        }
    return best;
  }

  centre(k: number): Waypoint {
    const i = Math.floor(k / this.N);
    const j = k % this.N;
    return { x: -this.half + (i + 0.5) * this.S, y: this.h[k]!, z: -this.half + (j + 0.5) * this.S };
  }

  private link(a: number, b: number): number {
    // Cost of stepping a -> b, or -1. Up at most 0.7 m a cell (1 : 3), down any sensible drop.
    const dh = this.h[b]! - this.h[a]!;
    if (dh > 0.7 || dh < -3) return -1;
    return Math.abs(dh);
  }

  hitLimit = false;

  /** A* across the open ground: waypoints from near `from` to `to` (the last is `to` itself), or null. */
  path(from: Vec3, to: Vec3, limit = 40000): Waypoint[] | null {
    this.hitLimit = false;
    const a = this.cellNear(from.x, from.z);
    const b = this.cellNear(to.x, to.z);
    if (a < 0 || b < 0) return null;
    const N = this.N;
    const s = this.scratch;
    const st = s.next();
    const bi = Math.floor(b / N);
    const bj = b % N;
    const h = (k: number) => Math.hypot(Math.floor(k / N) - bi, (k % N) - bj) * this.S * 1.25;
    s.seen[a] = st;
    s.g[a] = 0;
    s.came[a] = -1;
    const open = s.heap;
    open.clear();
    open.push(a, h(a));
    let count = 0;
    while (open.size && count++ < limit) {
      this.expanded++;
      const ci = open.pop();
      if (ci === b) {
        const out: Waypoint[] = [];
        for (let k = ci; k !== a && k >= 0; k = s.came[k]!) out.push(this.centre(k));
        out.reverse();
        out.push({ x: to.x, y: to.y, z: to.z });
        return out;
      }
      if (count === limit) this.hitLimit = true;
      if (s.closed[ci] === st) continue;
      s.closed[ci] = st;
      const i = Math.floor(ci / N);
      const j = ci % N;
      const gc = s.g[ci]!;
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++) {
          if (!di && !dj) continue;
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const nk = ni * N + nj;
          if (!this.walkable(nk)) continue;
          if (di && dj && (!this.walkable(ni * N + j) || !this.walkable(i * N + nj))) continue;
          const lc = this.link(ci, nk);
          if (lc < 0) continue;
          const t = gc + this.S * (di && dj ? Math.SQRT2 : 1) + lc;
          if (s.seen[nk] !== st || t < s.g[nk]!) {
            s.seen[nk] = st;
            s.g[nk] = t;
            s.came[nk] = ci;
            open.push(nk, t + h(nk));
          }
        }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// The island
// ---------------------------------------------------------------------------------------------

export class IslandNav {
  readonly world: CollisionWorld;
  readonly rects: Rect[];
  readonly ground: GroundNav;
  private towns: (TownNav | null)[];
  /** The town grid being built a slice at a time (`warm`). */
  private building: { i: number; gen: Generator<void, TownGridData> } | null = null;
  /** Searches so far (benchmarks, tests). */
  searches = 0;

  constructor(readonly map: MapData) {
    this.world = buildCollisionWorld(map);
    this.rects = BLACKOUT_TOWNS.map(townRect);
    const b = map.bounds;
    this.ground = new GroundNav(this.world, Math.min(-b.min.x, b.max.x, -b.min.z, b.max.z) - 1, this.rects);
    this.towns = this.rects.map(() => null);
  }

  /** The town whose grid covers a point (its rectangle plus `margin`), or -1. */
  townAt(x: number, z: number, margin = 2): number {
    for (let i = 0; i < this.rects.length; i++) {
      const r = this.rects[i]!;
      if (x > r.x0 - margin && x < r.x1 + margin && z > r.z0 - margin && z < r.z1 + margin) return i;
    }
    return -1;
  }

  /** A town's grid, built now if needed (finishing a slow build in progress). */
  town(i: number): TownNav {
    let t = this.towns[i];
    if (t) return t;
    const gen = this.building?.i === i ? this.building.gen : buildTownGrid(this.map, this.world, this.rects[i]!, Infinity);
    if (this.building?.i === i) this.building = null;
    for (;;) {
      const r = gen.next();
      if (r.done) {
        t = this.towns[i] = new TownNav(r.value, this.world, this.rects[i]!);
        return t;
      }
    }
  }

  /**
   * Build the missing town grids a slice at a time: about `sliceMs` of work per call, so the ten
   * towns (~3.5 s of CPU) spread over the plane ride without a long tick. False when all are built.
   */
  warm(sliceMs = 3): boolean {
    if (!this.building) {
      const i = this.towns.findIndex((t) => !t);
      if (i < 0) return false;
      this.building = { i, gen: buildTownGrid(this.map, this.world, this.rects[i]!, sliceMs) };
    }
    const b = this.building;
    const r = b.gen.next();
    if (r.done) {
      this.towns[b.i] = new TownNav(r.value, this.world, this.rects[b.i]!);
      this.building = null;
    }
    return true;
  }

  get built(): number {
    return this.towns.filter((t) => !!t).length;
  }

  /** Can a body stand and get about at `p` (a town cell that is reachable, or walkable open ground)? */
  reachable(p: Vec3): boolean {
    const t = this.townAt(p.x, p.z, 0);
    if (t >= 0) return this.town(t).reachable(p);
    const k = this.ground.cellNear(p.x, p.z);
    return k >= 0 && Math.abs(this.ground.h[k]! - p.y) < 1.5;
  }

  /** Portals of town `i` ordered by detour from a to b. */
  private portalsBy(i: number, a: Vec3, b: Vec3): Waypoint[] {
    const t = this.town(i);
    return t.portals
      .map((k) => ({ x: t.x[k]!, y: t.y[k]!, z: t.z[k]! }))
      .filter((p) => this.ground.walkable(this.ground.idx(p.x, p.z)))
      .sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) + Math.hypot(p.x - b.x, p.z - b.z) - (Math.hypot(q.x - a.x, q.z - a.z) + Math.hypot(q.x - b.x, q.z - b.z)));
  }

  /** The last `route` ran out of its search budget (try again later), and the cells it expanded. */
  lastHitLimit = false;
  lastExpanded = 0;

  /**
   * Waypoints from `from` to `to`, or null when there is no way (the goal is unreachable) or the
   * search ran out of `limit` expanded cells (`lastHitLimit`).
   */
  route(from: Vec3, to: Vec3, limit = 60000): Waypoint[] | null {
    this.searches++;
    this.lastHitLimit = false;
    const e0 = this.expandedAll();
    const out = this.routeIn(from, to, limit);
    this.lastExpanded = this.expandedAll() - e0;
    return out;
  }

  private expandedAll(): number {
    return this.ground.expanded + this.towns.reduce((n, t) => n + (t?.expanded ?? 0), 0);
  }

  private left(limit: number, e0: number): number {
    return Math.max(1, limit - (this.expandedAll() - e0));
  }

  private routeIn(from: Vec3, to: Vec3, limit: number): Waypoint[] | null {
    const e0 = this.expandedAll();
    const ta = this.townAt(from.x, from.z);
    const tb = this.townAt(to.x, to.z);
    const townLeg = (i: number, a: Vec3, b: Vec3) => {
      const t = this.town(i);
      const p = t.path(a, b, this.left(limit, e0));
      if (!p && t.hitLimit) this.lastHitLimit = true;
      return p;
    };
    if (ta >= 0 && ta === tb) return townLeg(ta, from, to);
    const out: Waypoint[] = [];
    let start: Vec3 = from;
    if (ta >= 0) {
      let ok = false;
      for (const p of this.portalsBy(ta, from, to).slice(0, 3)) {
        const leg = townLeg(ta, from, p);
        if (this.lastHitLimit) return null;
        if (!leg) continue;
        out.push(...leg);
        start = p;
        ok = true;
        break;
      }
      if (!ok) return null;
    }
    let tail: Waypoint[] = [];
    let end: Vec3 = to;
    if (tb >= 0) {
      let ok = false;
      for (const q of this.portalsBy(tb, start, to).slice(0, 3)) {
        const leg = townLeg(tb, q, to);
        if (this.lastHitLimit) return null;
        if (!leg) continue;
        tail = [{ x: q.x, y: q.y, z: q.z }, ...leg];
        end = q;
        ok = true;
        break;
      }
      if (!ok) return null;
    }
    const mid = this.ground.path(start, end, this.left(limit, e0));
    if (!mid) {
      if (this.ground.hitLimit) this.lastHitLimit = true;
      return null;
    }
    return [...out, ...mid, ...tail];
  }

  /** Off somewhere no route leaves from: a reachable spot below to walk off toward (towns only). */
  wayDown(p: Vec3): Waypoint | null {
    const t = this.townAt(p.x, p.z);
    if (t < 0) return null;
    const tn = this.town(t);
    const c = tn.cellAt(p);
    if (c >= 0 && tn.core[c]) return null;
    return tn.wayDown(p);
  }

  /** Typed-array bytes held by the grids built so far. */
  get bytes(): number {
    return this.ground.h.byteLength * 4 + this.towns.reduce((n, t) => n + (t?.bytes ?? 0), 0);
  }
}

const navs = new WeakMap<MapData, IslandNav>();

/** The (cached) island navigation for a map. */
export function islandNavFor(map: MapData): IslandNav {
  let n = navs.get(map);
  if (!n) navs.set(map, (n = new IslandNav(map)));
  return n;
}
