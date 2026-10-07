/**
 * Bot navigation: a 2.5D walking grid generated from a map's brushes (through its CollisionWorld),
 * plus A* over it. Every 0.5 m column of the map gets one cell per surface a body can stand on
 * (ground, a ramp, each stair tread, a container top...), linked to its 8 neighbours by
 *
 *   - walk: up or down no more than the step height (stairs, ramps, kerbs),
 *   - jump: up to ~1 m (barriers, pallets, crates) with headroom for the jump,
 *   - drop: off a ledge, up to MAX_DROP (one way).
 *
 * Doorways and gaps are simply cells (anything a body fits through). Built once per MapData and
 * cached, so every room on the same map shares it. Cells are only kept useful when they can be
 * reached from (and get back to) the map's spawns: `random()` picks from those.
 *
 * Pattern adapted from Blockyard's navgrid kit (src/platform/kits/navgrid.ts, MIT, Patrick Blais):
 * cells with walk/jump/drop links, A* with typed-array scratch and a binary heap.
 */
import { CollisionWorld, topAt, type Solid } from '../../../shared/collision';
import { MOVE, PLAYER } from '../../../shared/constants';
import { buildCollisionWorld, type MapData } from '../../../shared/maps/types';
import type { Vec3 } from '../../../shared/math';

/** Grid spacing, metres. */
export const NAV_CELL = 0.5;
/** Clearance radius used for cells (a little more than the body's half width, so bots don't scrape walls). */
const R = PLAYER.radius + 0.06;
const STEP = PLAYER.stepHeight - 0.02;
/** Highest ledge a standing jump gets the feet onto (jump apex 1.1 m, minus margin). */
export const JUMP_UP = MOVE.jumpHeight - 0.12;
export const MAX_DROP = 4.5;
const EPS = 0.003;

export type NavEdgeKind = 'walk' | 'jump' | 'drop';

export interface NavEdge {
  to: number;
  cost: number;
  kind: NavEdgeKind;
}

export interface NavCell {
  /** Index into `NavGrid.cells`. */
  i: number;
  cx: number;
  cz: number;
  /** Cell centre (x, z) and the standing height (feet). */
  x: number;
  y: number;
  z: number;
  edges: NavEdge[];
  /** Reachable from a spawn and able to get back to one. */
  core: boolean;
}

const colKey = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

const nearScratch: Solid[] = [];

/** Is a body box (feet at x,y,z, half width r, height h) free of player-colliding solids? */
export function freeAt(w: CollisionWorld, x: number, y: number, z: number, r: number, h: number): boolean {
  for (const s of w.near(x - r, x + r, z - r, z + r, nearScratch)) if (CollisionWorld.overlaps(s, x, y, z, r, h)) return false;
  return true;
}

/** Highest walkable top under a footprint between fromY - drop and fromY (like CollisionWorld.groundBelow, any radius). */
export function groundAt(w: CollisionWorld, x: number, z: number, fromY: number, drop: number, r: number): number | null {
  let best: number | null = null;
  for (const s of w.near(x - r, x + r, z - r, z + r, nearScratch)) {
    if (x + r <= s.min.x + 1e-4 || x - r >= s.max.x - 1e-4 || z + r <= s.min.z + 1e-4 || z - r >= s.max.z - 1e-4) continue;
    const top = topAt(s, x - r, x + r, z - r, z + r);
    if (top <= fromY + 1e-4 && top >= fromY - drop && (best === null || top > best)) best = top;
  }
  return best;
}

export class NavGrid {
  readonly cells: NavCell[] = [];
  /** Cells by column, sorted by height (lowest first). */
  private columns = new Map<number, NavCell[]>();
  private coreList: NavCell[] = [];
  private scratch: { g: Float64Array; came: Int32Array; seen: Uint32Array; closed: Uint32Array; kind: Uint8Array; stamp: number } | null = null;
  private heap = new Heap();
  readonly buildMs: number;

  constructor(
    readonly map: MapData,
    readonly world: CollisionWorld = buildCollisionWorld(map),
  ) {
    const t0 = performance.now();
    this.buildCells();
    for (const c of this.cells) c.edges = this.link(c);
    this.markCore();
    this.buildMs = performance.now() - t0;
  }

  get size(): number {
    return this.cells.length;
  }

  /** Cells reachable from (and back to) the spawns. */
  get coreCells(): readonly NavCell[] {
    return this.coreList;
  }

  // -------------------------------------------------------------------------------------------
  // Build
  // -------------------------------------------------------------------------------------------

  private buildCells() {
    const b = this.map.bounds;
    const cx0 = Math.ceil(b.min.x / NAV_CELL);
    const cx1 = Math.floor(b.max.x / NAV_CELL) - 1;
    const cz0 = Math.ceil(b.min.z / NAV_CELL);
    const cz1 = Math.floor(b.max.z / NAV_CELL) - 1;
    const near: Solid[] = [];
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++) {
        const x = (cx + 0.5) * NAV_CELL;
        const z = (cz + 0.5) * NAV_CELL;
        const tops: number[] = [];
        for (const s of this.world.near(x - R, x + R, z - R, z + R, near)) {
          if (x + R <= s.min.x || x - R >= s.max.x || z + R <= s.min.z || z - R >= s.max.z) continue;
          const t = topAt(s, x - R, x + R, z - R, z + R);
          if (t < b.min.y || t > b.max.y) continue;
          tops.push(t);
        }
        tops.sort((a, c) => a - c);
        let last = -Infinity;
        for (const t of tops) {
          if (t - last < 0.05) continue;
          // Standing here: the highest surface under the footprint at this height, with room for a body.
          const g = groundAt(this.world, x, z, t + EPS, 0.02, R);
          if (g === null || Math.abs(g - t) > 0.03) continue;
          if (!freeAt(this.world, x, t + EPS, z, R, PLAYER.height)) continue;
          last = t;
          this.add(cx, cz, x, t, z);
        }
      }
  }

  private add(cx: number, cz: number, x: number, y: number, z: number) {
    const c: NavCell = { i: this.cells.length, cx, cz, x, y, z, edges: [], core: false };
    this.cells.push(c);
    const k = colKey(cx, cz);
    const col = this.columns.get(k);
    if (col) col.push(c);
    else this.columns.set(k, [c]);
  }

  column(cx: number, cz: number): readonly NavCell[] {
    return this.columns.get(colKey(cx, cz)) ?? [];
  }

  /** A cell in the neighbouring column within a step of height `y` (for diagonal corner checks). */
  private levelIn(cx: number, cz: number, y: number): NavCell | null {
    for (const n of this.column(cx, cz)) if (Math.abs(n.y - y) <= STEP) return n;
    return null;
  }

  private link(c: NavCell): NavEdge[] {
    const edges: NavEdge[] = [];
    const w = this.world;
    const headroomForJump = freeAt(w, c.x, c.y + JUMP_UP + EPS, c.z, R * 0.9, PLAYER.height);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const diag = dx !== 0 && dz !== 0;
        const col = this.column(c.cx + dx, c.cz + dz);
        if (!col.length) continue;
        const horiz = NAV_CELL * (diag ? Math.SQRT2 : 1);
        const mx = c.x + (dx * NAV_CELL) / 2;
        const mz = c.z + (dz * NAV_CELL) / 2;
        let dropTo: NavCell | null = null;
        for (const n of col) {
          const dh = n.y - c.y;
          if (Math.abs(dh) <= STEP) {
            // No cutting corners: both orthogonal neighbours are walkable at about this height.
            if (diag && (!this.levelIn(c.cx + dx, c.cz, c.y) || !this.levelIn(c.cx, c.cz + dz, c.y))) continue;
            if (!freeAt(w, mx, Math.max(c.y, n.y) + EPS, mz, R * 0.95, PLAYER.height)) continue;
            edges.push({ to: n.i, cost: Math.hypot(horiz, dh), kind: 'walk' });
          } else if (dh > STEP && dh <= JUMP_UP) {
            if (diag || !headroomForJump) continue;
            if (!freeAt(w, mx, n.y + EPS, mz, R * 0.9, PLAYER.height)) continue;
            edges.push({ to: n.i, cost: horiz + 1.2 + dh, kind: 'jump' });
          } else if (dh < -STEP && dh >= -MAX_DROP) {
            // The landing is the highest surface below this one in that column.
            if (!dropTo || n.y > dropTo.y) dropTo = n;
          }
        }
        if (dropTo && !diag) {
          // Walk off the edge: room over the lower column at this cell's height.
          if (freeAt(w, dropTo.x, c.y + EPS, dropTo.z, R * 0.9, PLAYER.height) && freeAt(w, mx, c.y + EPS, mz, R * 0.9, PLAYER.height)) {
            edges.push({ to: dropTo.i, cost: horiz + 0.4 + (c.y - dropTo.y) * 0.3, kind: 'drop' });
          }
        }
      }
    return edges;
  }

  /** Forward reachability from the spawns intersected with backward reachability to them. */
  private markCore() {
    const n = this.cells.length;
    const seeds = new Set<number>();
    const sp = this.map.spawns;
    for (const p of [...sp.teams[0], ...sp.teams[1], ...sp.ffa]) {
      const c = this.cellAt(p);
      if (c) seeds.add(c.i);
    }
    if (!seeds.size) {
      for (const c of this.cells) c.core = true;
      this.coreList = [...this.cells];
      return;
    }
    const fwd = new Uint8Array(n);
    const stack = [...seeds];
    for (const s of stack) fwd[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      for (const e of this.cells[i]!.edges)
        if (!fwd[e.to]) {
          fwd[e.to] = 1;
          stack.push(e.to);
        }
    }
    const rev: number[][] = Array.from({ length: n }, () => []);
    for (const c of this.cells) for (const e of c.edges) rev[e.to]!.push(c.i);
    const back = new Uint8Array(n);
    const st2 = [...seeds];
    for (const s of st2) back[s] = 1;
    while (st2.length) {
      const i = st2.pop()!;
      for (const j of rev[i]!)
        if (!back[j]) {
          back[j] = 1;
          st2.push(j);
        }
    }
    this.coreList = [];
    for (const c of this.cells) {
      c.core = !!fwd[c.i] && !!back[c.i];
      if (c.core) this.coreList.push(c);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------------------------

  /**
   * The cell someone standing at `p` is on: its column, the highest cell not far above the feet;
   * failing that the nearest cell around (prefers core cells).
   */
  cellAt(p: Vec3, preferCore = false): NavCell | null {
    const cx = Math.floor(p.x / NAV_CELL);
    const cz = Math.floor(p.z / NAV_CELL);
    let best: NavCell | null = null;
    for (const c of this.column(cx, cz)) if (c.y <= p.y + 0.6 && (!best || c.y > best.y) && (!preferCore || c.core)) best = c;
    if (best && p.y - best.y < 2.5) return best;
    let bd = Infinity;
    for (let r = 1; r <= 4; r++) {
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          for (const c of this.column(cx + dx, cz + dz)) {
            if (preferCore && !c.core) continue;
            const d = Math.hypot(c.x - p.x, c.z - p.z) + Math.abs(c.y - p.y) * 1.5;
            if (d < bd) {
              bd = d;
              best = c;
            }
          }
        }
      if (best && bd < Infinity && r >= 2) break;
    }
    return best;
  }

  /** A random reachable cell. */
  random(rnd: () => number = Math.random): NavCell | null {
    const l = this.coreList.length ? this.coreList : this.cells;
    return l.length ? l[Math.floor(rnd() * l.length)]! : null;
  }

  /** The kind of the edge a -> b, or null. */
  edgeKind(a: NavCell, b: NavCell): NavEdgeKind | null {
    for (const e of a.edges) if (e.to === b.i) return e.kind;
    return null;
  }

  /** A* from one point to another: the cells to walk through (ending at the goal's cell), or null. */
  path(from: Vec3, to: Vec3, limit = 30000): NavCell[] | null {
    const a = this.cellAt(from);
    const b = this.cellAt(to, true) ?? this.cellAt(to);
    if (!a || !b) return null;
    if (a === b) return [b];
    const n = this.cells.length;
    const s = this.scratchFor(n);
    const stamp = s.stamp;
    const cells = this.cells;
    const h = (c: NavCell) => Math.hypot(c.x - b.x, c.z - b.z) + Math.abs(c.y - b.y) * 0.5;
    s.seen[a.i] = stamp;
    s.g[a.i] = 0;
    s.came[a.i] = -1;
    const open = this.heap;
    open.clear();
    open.push(a.i, h(a));
    let count = 0;
    while (open.size && count++ < limit) {
      const ci = open.pop();
      if (ci === b.i) {
        const out: NavCell[] = [];
        for (let k = ci; k !== a.i && k >= 0; k = s.came[k]!) out.push(cells[k]!);
        return out.reverse();
      }
      if (s.closed[ci] === stamp) continue;
      s.closed[ci] = stamp;
      const gc = s.g[ci]!;
      for (const e of cells[ci]!.edges) {
        const t = gc + e.cost;
        if (s.seen[e.to] !== stamp || t < s.g[e.to]!) {
          s.seen[e.to] = stamp;
          s.g[e.to] = t;
          s.came[e.to] = ci;
          open.push(e.to, t + h(cells[e.to]!));
        }
      }
    }
    return null;
  }

  private scratchFor(n: number) {
    let s = this.scratch;
    if (!s || s.g.length < n) {
      s = this.scratch = { g: new Float64Array(n), came: new Int32Array(n), seen: new Uint32Array(n), closed: new Uint32Array(n), kind: new Uint8Array(n), stamp: 0 };
    }
    if (++s.stamp >= 0xfffffff0) {
      s.seen.fill(0);
      s.closed.fill(0);
      s.stamp = 1;
    }
    return s;
  }

  /**
   * Can a body walk straight from `a` to cell `b` (same level-ish, nothing in the way, ground all
   * along)? Used to skip waypoints (string pulling) so bots don't zig-zag cell to cell.
   */
  straight(a: Vec3, b: NavCell): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.01) return true;
    const steps = Math.ceil(d / 0.3);
    let y = a.y;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      const g = groundAt(this.world, x, z, y + STEP, STEP * 2, R * 0.9);
      if (g === null) return false;
      if (!freeAt(this.world, x, g + EPS, z, R * 0.9, PLAYER.height)) return false;
      y = g;
    }
    return Math.abs(y - b.y) <= STEP;
  }
}

const grids = new WeakMap<MapData, NavGrid>();

/** The (cached) nav grid of a map. */
export function navFor(map: MapData): NavGrid {
  let g = grids.get(map);
  if (!g) grids.set(map, (g = new NavGrid(map)));
  return g;
}

/** Binary min-heap of cell indices by priority. */
class Heap {
  private at = new Int32Array(1024);
  private p = new Float64Array(1024);
  size = 0;
  clear() {
    this.size = 0;
  }
  push(c: number, pri: number) {
    if (this.size === this.at.length) {
      const at = new Int32Array(this.size * 2);
      const p = new Float64Array(this.size * 2);
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
      swap(at, p, i, j);
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
        swap(at, p, i, m);
        i = m;
      }
    }
    return top;
  }
}

function swap(at: Int32Array, p: Float64Array, i: number, j: number) {
  const c = at[i]!;
  at[i] = at[j]!;
  at[j] = c;
  const q = p[i]!;
  p[i] = p[j]!;
  p[j] = q;
}
