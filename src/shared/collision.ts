/**
 * The brush world: axis-aligned boxes and ramps that players walk on and bullets hit, built from a
 * map's `MapData` (see `maps/types.ts`). Used by the server sim, client prediction, bots (line of
 * sight) and the renderer's bake (shadow rays). Also player hitboxes and ray-vs-box helpers.
 */
import { PLAYER } from './constants';
import type { AABB, Vec3 } from './math';

/** Which way a ramp's top surface rises: '+x' means low at min.x, high (max.y) at max.x. */
export type RampDir = '+x' | '-x' | '+z' | '-z';

/** A solid piece of world for collision and raycasts. */
export interface Solid {
  min: Vec3;
  max: Vec3;
  /** Present for ramps (a wedge filling the box under a slope); absent for boxes. */
  ramp?: RampDir;
  /** Players collide with it. */
  players: boolean;
  /** Bullets stop on it (false: chain-link fences, foliage). */
  bullets: boolean;
  /** Blocks line of sight (bots, spawn safety, bake shadows). */
  sight: boolean;
  /** Index into the source list (MapData brushes then collidable props), for debugging/effects. */
  source: number;
  /** Material id (for impact effects / penetration rules). */
  mat: string;
}

export type RayMask = 'bullets' | 'sight' | 'players';

export interface RayHit {
  /** Distance along the (unit) ray. */
  t: number;
  point: Vec3;
  normal: Vec3;
  solid: Solid;
}

const EPS = 1e-4;
const CELL = 4;

/** Height of a solid's top surface for a footprint (highest point of a ramp under it). */
export function topAt(s: Solid, minX: number, maxX: number, minZ: number, maxZ: number): number {
  if (!s.ramp) return s.max.y;
  const h = s.max.y - s.min.y;
  let k: number;
  switch (s.ramp) {
    case '+x':
      k = (Math.min(maxX, s.max.x) - s.min.x) / (s.max.x - s.min.x);
      break;
    case '-x':
      k = (s.max.x - Math.max(minX, s.min.x)) / (s.max.x - s.min.x);
      break;
    case '+z':
      k = (Math.min(maxZ, s.max.z) - s.min.z) / (s.max.z - s.min.z);
      break;
    case '-z':
      k = (s.max.z - Math.max(minZ, s.min.z)) / (s.max.z - s.min.z);
      break;
  }
  return s.min.y + h * Math.max(0, Math.min(1, k));
}

/** Ray vs AABB (slab test). `d` need not be unit. Returns entry t and the entry face normal, or null. */
export function rayAABB(o: Vec3, d: Vec3, min: Vec3, max: Vec3, maxT = Infinity): { t: number; axis: number; sign: number } | null {
  let t0 = 0;
  let t1 = maxT;
  let axis = -1;
  let sign = 0;
  const os = [o.x, o.y, o.z];
  const ds = [d.x, d.y, d.z];
  const lo = [min.x, min.y, min.z];
  const hi = [max.x, max.y, max.z];
  for (let i = 0; i < 3; i++) {
    const di = ds[i]!;
    const oi = os[i]!;
    if (Math.abs(di) < 1e-12) {
      if (oi < lo[i]! || oi > hi[i]!) return null;
      continue;
    }
    let a = (lo[i]! - oi) / di;
    let b = (hi[i]! - oi) / di;
    let s = -1;
    if (a > b) {
      const tmp = a;
      a = b;
      b = tmp;
      s = 1;
    }
    if (a > t0) {
      t0 = a;
      axis = i;
      sign = s;
    }
    if (b < t1) t1 = b;
    if (t0 > t1) return null;
  }
  return { t: t0, axis, sign };
}

/** Plane list (normal, offset: inside when n.p <= d) of a ramp wedge. */
function rampPlanes(s: Solid): [number, number, number, number][] {
  const { min, max } = s;
  const planes: [number, number, number, number][] = [
    [1, 0, 0, max.x],
    [-1, 0, 0, -min.x],
    [0, 1, 0, max.y],
    [0, -1, 0, -min.y],
    [0, 0, 1, max.z],
    [0, 0, -1, -min.z],
  ];
  const h = max.y - min.y;
  // Slope plane through the low edge (y = min.y) and the high edge (y = max.y).
  let n: [number, number, number];
  let p: Vec3;
  switch (s.ramp) {
    case '+x':
      n = [-h, max.x - min.x, 0];
      p = { x: min.x, y: min.y, z: 0 };
      break;
    case '-x':
      n = [h, max.x - min.x, 0];
      p = { x: max.x, y: min.y, z: 0 };
      break;
    case '+z':
      n = [0, max.z - min.z, -h];
      p = { x: 0, y: min.y, z: min.z };
      break;
    default:
      n = [0, max.z - min.z, h];
      p = { x: 0, y: min.y, z: max.z };
      break;
  }
  const l = Math.hypot(n[0], n[1], n[2]);
  const nx = n[0] / l;
  const ny = n[1] / l;
  const nz = n[2] / l;
  planes.push([nx, ny, nz, nx * p.x + ny * p.y + nz * p.z]);
  return planes;
}

/** Ray vs convex wedge (Cyrus-Beck). */
function rayRamp(o: Vec3, d: Vec3, s: Solid, maxT: number): { t: number; n: Vec3 } | null {
  let t0 = 0;
  let t1 = maxT;
  let best: Vec3 | null = null;
  for (const [nx, ny, nz, off] of rampPlanes(s)) {
    const denom = nx * d.x + ny * d.y + nz * d.z;
    const dist = off - (nx * o.x + ny * o.y + nz * o.z);
    if (Math.abs(denom) < 1e-12) {
      if (dist < 0) return null;
      continue;
    }
    const t = dist / denom;
    if (denom < 0) {
      if (t > t0) {
        t0 = t;
        best = { x: nx, y: ny, z: nz };
      }
    } else if (t < t1) t1 = t;
    if (t0 > t1) return null;
  }
  return { t: t0, n: best ?? { x: -d.x, y: -d.y, z: -d.z } };
}

/**
 * The collision world. Build once per map (`buildCollisionWorld(mapData)` in maps/types.ts) and
 * share it; it is immutable after construction.
 */
export class CollisionWorld {
  readonly solids: readonly Solid[];
  private grid = new Map<number, number[]>();
  private stamp = 0;
  private marks: Uint32Array;

  constructor(solids: Solid[]) {
    this.solids = solids;
    this.marks = new Uint32Array(solids.length);
    solids.forEach((s, i) => {
      if (!s.players) return;
      for (let cx = Math.floor(s.min.x / CELL); cx <= Math.floor(s.max.x / CELL); cx++)
        for (let cz = Math.floor(s.min.z / CELL); cz <= Math.floor(s.max.z / CELL); cz++) {
          const k = key(cx, cz);
          let list = this.grid.get(k);
          if (!list) this.grid.set(k, (list = []));
          list.push(i);
        }
    });
  }

  /** Player-colliding solids whose footprint touches the given xz rectangle. */
  near(minX: number, maxX: number, minZ: number, maxZ: number, out: Solid[] = []): Solid[] {
    out.length = 0;
    const st = ++this.stamp;
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const list = this.grid.get(key(cx, cz));
        if (!list) continue;
        for (const i of list) {
          if (this.marks[i] === st) continue;
          this.marks[i] = st;
          out.push(this.solids[i]!);
        }
      }
    return out;
  }

  /** Does a player box (feet at x,y,z) overlap the solid? */
  static overlaps(s: Solid, x: number, y: number, z: number, r: number, h: number): boolean {
    const minX = x - r;
    const maxX = x + r;
    const minZ = z - r;
    const maxZ = z + r;
    if (maxX <= s.min.x + EPS || minX >= s.max.x - EPS || maxZ <= s.min.z + EPS || minZ >= s.max.z - EPS) return false;
    if (y + h <= s.min.y + EPS) return false;
    return y < topAt(s, minX, maxX, minZ, maxZ) - EPS;
  }

  /** All player-colliding solids a player box overlaps. */
  overlapping(x: number, y: number, z: number, r: number, h: number, out: Solid[] = []): Solid[] {
    const cand = this.near(x - r, x + r, z - r, z + r, [] as Solid[]);
    out.length = 0;
    for (const s of cand) if (CollisionWorld.overlaps(s, x, y, z, r, h)) out.push(s);
    return out;
  }

  /** Is a player box free of the world? */
  free(x: number, y: number, z: number, r = PLAYER.radius, h = PLAYER.height): boolean {
    const cand = this.near(x - r, x + r, z - r, z + r, [] as Solid[]);
    for (const s of cand) if (CollisionWorld.overlaps(s, x, y, z, r, h)) return false;
    return true;
  }

  /**
   * Highest walkable surface under a footprint between `fromY - drop` and `fromY + EPS`, or null.
   * Used for ground snapping and spawn placement.
   */
  groundBelow(x: number, z: number, fromY: number, drop: number, r = PLAYER.radius): number | null {
    let best: number | null = null;
    for (const s of this.near(x - r, x + r, z - r, z + r, [] as Solid[])) {
      if (x + r <= s.min.x + EPS || x - r >= s.max.x - EPS || z + r <= s.min.z + EPS || z - r >= s.max.z - EPS) continue;
      const top = topAt(s, x - r, x + r, z - r, z + r);
      if (top <= fromY + EPS && top >= fromY - drop && (best === null || top > best)) best = top;
    }
    return best;
  }

  /**
   * First solid hit by a ray from `o` along unit `d` within `maxT`. `mask` picks which solids
   * count: 'bullets' (default) skips bullet-transparent ones, 'sight' skips see-through ones,
   * 'players' only player-colliding ones.
   */
  raycast(o: Vec3, d: Vec3, maxT: number, mask: RayMask = 'bullets'): RayHit | null {
    let best: RayHit | null = null;
    let bestT = maxT;
    for (const s of this.solids) {
      if (!s[mask]) continue;
      const box = rayAABB(o, d, s.min, s.max, bestT);
      if (!box) continue;
      if (s.ramp) {
        const r = rayRamp(o, d, s, bestT);
        if (!r || r.t > bestT) continue;
        bestT = r.t;
        best = { t: r.t, point: at(o, d, r.t), normal: r.n, solid: s };
      } else {
        bestT = box.t;
        const n = { x: 0, y: 0, z: 0 };
        if (box.axis === 0) n.x = box.sign;
        else if (box.axis === 1) n.y = box.sign;
        else if (box.axis === 2) n.z = box.sign;
        best = { t: box.t, point: at(o, d, box.t), normal: n, solid: s };
      }
    }
    return best;
  }

  /** Clear line between two points (sight mask by default)? */
  lineOfSight(a: Vec3, b: Vec3, mask: RayMask = 'sight'): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-6) return true;
    return this.raycast(a, { x: dx / l, y: dy / l, z: dz / l }, l - 1e-3, mask) === null;
  }
}

const key = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);
const at = (o: Vec3, d: Vec3, t: number): Vec3 => ({ x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t });

// ---------------------------------------------------------------------------------------------
// Player hitboxes
// ---------------------------------------------------------------------------------------------

export type HitPart = 'head' | 'torso' | 'legs';

export interface Hitboxes {
  head: AABB;
  torso: AABB;
  legs: AABB;
}

/** Fractions of body height where torso and head start, and half widths. */
const HB = { legsTop: 0.47, torsoTop: 0.8, legsHalf: 0.24, torsoHalf: 0.3, headHalf: 0.15 };

/** Hitboxes of a player standing (or crouched) with feet at p. Axis aligned; yaw is ignored. */
export function playerHitboxes(p: Vec3, crouched: boolean): Hitboxes {
  const h = crouched ? PLAYER.crouchHeight : PLAYER.height;
  const box = (half: number, y0: number, y1: number): AABB => ({
    min: { x: p.x - half, y: p.y + y0, z: p.z - half },
    max: { x: p.x + half, y: p.y + y1, z: p.z + half },
  });
  return {
    legs: box(HB.legsHalf, 0, h * HB.legsTop),
    torso: box(HB.torsoHalf, h * HB.legsTop, h * HB.torsoTop),
    head: box(HB.headHalf, h * HB.torsoTop, h),
  };
}

/** Nearest hitbox part a ray enters (within maxT), or null. */
export function rayHitboxes(o: Vec3, d: Vec3, hb: Hitboxes, maxT = Infinity): { t: number; part: HitPart } | null {
  let best: { t: number; part: HitPart } | null = null;
  for (const part of ['head', 'torso', 'legs'] as const) {
    const b = hb[part];
    const r = rayAABB(o, d, b.min, b.max, best ? best.t : maxT);
    if (r && (!best || r.t < best.t)) best = { t: r.t, part };
  }
  return best;
}
