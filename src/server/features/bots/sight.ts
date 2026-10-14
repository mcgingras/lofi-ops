/**
 * What a bot can see and shoot through (pure, cached per map; tests/bots.walls.test.ts).
 *
 * Collision (`room.world`) decides what bullets and sight do for everyone. On top of it a bot
 * treats the map's *rendered* geometry the way a person looking at the screen would: a box that
 * is drawn opaque hides whoever is behind it even when it has no collision (render-only props,
 * trucks and tanks drawn turned over smaller collision, couches that stop bullets but not the
 * `sight` channel, the corners of a turned box poking out of its axis-aligned collision, bushes).
 *
 *   occluder   every rendered brush (and non-colliding cylinder) that collision doesn't already
 *              cover for sight, as the box the renderer draws (turned by `ry`). Skipped: clips
 *              (noRender), see-through materials (glass, fences, lattices, railings, nets, alpha
 *              cut-out cards), ramps, and anything thinner than 1.5 cm or smaller than 25 cm.
 *   stops      the occluder looks like it would stop a bullet: not foliage and at least 20 cm
 *              thick. Thin boards and sheets stay shoot-through, like the maps' own thin plank
 *              walls (`bullets: false`).
 *   inside     a segment that starts inside an occluder isn't blocked by it (the renderer culls
 *              back faces: from inside a bush you see out, from outside you don't see in).
 *
 * The brain sees a point when collision's `sight` mask and the occluders both leave the line
 * clear, and fires only when collision's `bullets` mask and the stopping occluders do.
 */
import { eyeHeight, stanceOf } from '../../../shared/movement';
import type { CollisionWorld } from '../../../shared/collision';
import type { MapData } from '../../../shared/maps/types';
import type { Vec3 } from '../../../shared/math';
import type { PlayerState } from '../../player';

export interface Occluder {
  /** Centre and half extents in the box's own frame (turned by `ry` about y). */
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
  cos: number;
  sin: number;
  /** Looks bullet-proof (not foliage, >= 20 cm thick). */
  stops: boolean;
  /** Brush index (props: brushes.length + prop index), for tests and debugging. */
  source: number;
  mat: string;
}

/** Textures drawn with alpha cut-out holes, glass, fences: you see through them. */
const SEE_THROUGH = /glass|fence|lattice|rail|net|picket|grate|chain|window|bars|mountains|hills|karst|falls|pine|fern|frond|bush|wire|mesh|rope/i;
/** Hide you, don't stop bullets. */
const FOLIAGE = /foliage|hedge|grass|thatch|bamboo|leaf|leaves|paddy|tuft/i;
const MIN_THICK = 0.015;
const MIN_SIZE = 0.25;
const STOP_THICK = 0.2;
/** Occluders are shrunk by this much per side (no grazing hits on the floor they stand on). */
const SHRINK = 0.01;
const CELL = 4;

function classify(map: MapData, mat: string): 'see' | 'foliage' | 'solid' {
  const tex = map.materials[mat]?.texture ?? '';
  if (SEE_THROUGH.test(mat) || SEE_THROUGH.test(tex)) return 'see';
  if (FOLIAGE.test(mat) || FOLIAGE.test(tex)) return 'foliage';
  return 'solid';
}

/** The render-only (or render-larger-than-collision) geometry of a map, with a ray grid. */
export class Occluders {
  readonly list: Occluder[] = [];
  private cells = new Map<number, number[]>();
  private marks: Uint32Array;
  private stamp = 0;

  constructor(map: MapData) {
    map.brushes.forEach((b, i) => {
      if (b.noRender || b.ramp || (b.hide?.length ?? 0) >= 4) return;
      const c = b.collide ?? true;
      const sight = b.sight ?? c;
      const ry = b.ry ?? 0;
      const turned = Math.abs(Math.sin(2 * ry)) > 0.02;
      if (sight && !turned) return;
      const kind = classify(map, b.mat);
      if (kind === 'see') return;
      let w = b.max.x - b.min.x;
      const h = b.max.y - b.min.y;
      let d = b.max.z - b.min.z;
      if (Math.abs(Math.sin(ry)) > 0.5) [w, d] = [d, w];
      if (Math.min(w, h, d) < MIN_THICK || Math.max(w, h, d) < MIN_SIZE) return;
      const bullets = b.bullets ?? c;
      const stops = kind === 'solid' && (Math.min(w, d) >= STOP_THICK || (bullets && sight));
      this.add({ cx: (b.min.x + b.max.x) / 2, cy: (b.min.y + b.max.y) / 2, cz: (b.min.z + b.max.z) / 2, hx: w / 2, hy: h / 2, hz: d / 2, cos: Math.cos(ry), sin: Math.sin(ry), stops, source: i, mat: b.mat });
    });
    map.props.forEach((p, j) => {
      if (p.kind !== 'cylinder' || (p.collide ?? true)) return;
      const kind = classify(map, p.mat);
      if (kind === 'see') return;
      // The square inscribed in the circle (never wider than what's drawn).
      const r = p.r * 0.75;
      const axis = p.axis ?? 'y';
      const hx = axis === 'x' ? p.len / 2 : r;
      const hy = axis === 'y' ? p.len / 2 : r;
      const hz = axis === 'z' ? p.len / 2 : r;
      if (Math.min(hx, hy, hz) * 2 < MIN_THICK || Math.max(hx, hy, hz) * 2 < MIN_SIZE) return;
      this.add({ cx: p.x, cy: p.y, cz: p.z, hx, hy, hz, cos: 1, sin: 0, stops: kind === 'solid' && r * 2 >= STOP_THICK, source: map.brushes.length + j, mat: p.mat });
    });
    this.marks = new Uint32Array(this.list.length);
  }

  private add(o: Occluder) {
    o.hx = Math.max(0, o.hx - SHRINK);
    o.hy = Math.max(0, o.hy - SHRINK);
    o.hz = Math.max(0, o.hz - SHRINK);
    const i = this.list.push(o) - 1;
    // Footprint of the turned box.
    const ex = Math.abs(o.cos) * o.hx + Math.abs(o.sin) * o.hz;
    const ez = Math.abs(o.sin) * o.hx + Math.abs(o.cos) * o.hz;
    for (let cx = Math.floor((o.cx - ex) / CELL); cx <= Math.floor((o.cx + ex) / CELL); cx++)
      for (let cz = Math.floor((o.cz - ez) / CELL); cz <= Math.floor((o.cz + ez) / CELL); cz++) {
        const k = key(cx, cz);
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push(i);
      }
  }

  /**
   * The first occluder on the segment a -> b (only those that `stop` bullets when `stopsOnly`),
   * or null. A segment starting inside an occluder isn't blocked by that one.
   */
  first(a: Vec3, b: Vec3, stopsOnly = false): Occluder | null {
    if (!this.list.length) return null;
    const st = ++this.stamp;
    let best: Occluder | null = null;
    let bestT = 1;
    const test = (i: number) => {
      if (this.marks[i] === st) return;
      this.marks[i] = st;
      const o = this.list[i]!;
      if (stopsOnly && !o.stops) return;
      const t = segmentEnters(o, a, b);
      if (t !== null && t < bestT) {
        bestT = t;
        best = o;
      }
    };
    // Walk the 2D grid cells the segment crosses (DDA).
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    let cx = Math.floor(a.x / CELL);
    let cz = Math.floor(a.z / CELL);
    const ex = Math.floor(b.x / CELL);
    const ez = Math.floor(b.z / CELL);
    const sx = dx > 0 ? 1 : -1;
    const sz = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-12 ? CELL / Math.abs(dx) : Infinity;
    const tdz = Math.abs(dz) > 1e-12 ? CELL / Math.abs(dz) : Infinity;
    let tx = Math.abs(dx) > 1e-12 ? ((cx + (sx > 0 ? 1 : 0)) * CELL - a.x) / dx : Infinity;
    let tz = Math.abs(dz) > 1e-12 ? ((cz + (sz > 0 ? 1 : 0)) * CELL - a.z) / dz : Infinity;
    for (let n = 0; n < 4096; n++) {
      const l = this.cells.get(key(cx, cz));
      if (l) for (const i of l) test(i);
      if (cx === ex && cz === ez) break;
      if (Math.min(tx, tz) > bestT) break;
      if (tx < tz) {
        cx += sx;
        tx += tdx;
      } else {
        cz += sz;
        tz += tdz;
      }
    }
    return best;
  }
}

/** Entry parameter (0..1) of segment a -> b into a turned box, or null (misses, or starts inside). */
export function segmentEnters(o: Occluder, a: Vec3, b: Vec3): number | null {
  // Into the box's frame: undo the renderer's rotation (x' = x cos - z sin, z' = x sin + z cos).
  const ax = a.x - o.cx;
  const az = a.z - o.cz;
  const bx = b.x - o.cx;
  const bz = b.z - o.cz;
  const p0 = [ax * o.cos - az * o.sin, a.y - o.cy, ax * o.sin + az * o.cos];
  const p1 = [bx * o.cos - bz * o.sin, b.y - o.cy, bx * o.sin + bz * o.cos];
  const h = [o.hx, o.hy, o.hz];
  let t0 = 0;
  let t1 = 1;
  let inside = true;
  for (let k = 0; k < 3; k++) {
    const s = p0[k]!;
    const d = p1[k]! - s;
    const hk = h[k]!;
    if (s < -hk || s > hk) inside = false;
    if (Math.abs(d) < 1e-12) {
      if (s < -hk || s > hk) return null;
      continue;
    }
    let ta = (-hk - s) / d;
    let tb = (hk - s) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  if (inside) return null;
  return t0;
}

const key = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

const cache = new WeakMap<MapData, Occluders>();

/** The (cached) occluders of a map. */
export function occludersFor(map: MapData): Occluders {
  let o = cache.get(map);
  if (!o) cache.set(map, (o = new Occluders(map)));
  return o;
}

/** Can a bot whose eye is at `a` see point `b`? Collision's sight mask and the drawn geometry. */
export function botCanSee(world: CollisionWorld, map: MapData, a: Vec3, b: Vec3): boolean {
  return world.lineOfSight(a, b, 'sight') && !occludersFor(map).first(a, b);
}

/** Would a bullet from `a` reach `b`? Collision's bullets mask and the drawn bullet-stopping geometry. */
export function botCanHit(world: CollisionWorld, map: MapData, a: Vec3, b: Vec3): boolean {
  return world.lineOfSight(a, b, 'bullets') && !occludersFor(map).first(a, b, true);
}

/** Points on a body to aim at / check sight to. */
export function chestOf(p: PlayerState): Vec3 {
  // Lying down: the back, behind the head (the eye is at the movement position, the body trails it).
  if (stanceOf(p.move) === 'prone') return { x: p.move.x + Math.sin(p.yaw) * 0.45, y: p.move.y + 0.22, z: p.move.z + Math.cos(p.yaw) * 0.45 };
  return { x: p.move.x, y: p.move.y + (p.move.crouched ? 0.78 : 1.15), z: p.move.z };
}
export function headOf(p: PlayerState): Vec3 {
  if (stanceOf(p.move) === 'prone') return { x: p.move.x, y: p.move.y + 0.32, z: p.move.z };
  return { x: p.move.x, y: p.move.y + (p.move.crouched ? 1.08 : 1.62), z: p.move.z };
}
/**
 * The target's own eye: the "head over cover" sight check uses it rather than the head's centre
 * (which sits above the eye), so a bot sees someone over a wall exactly when they could see it.
 */
export function eyePointOf(p: PlayerState): Vec3 {
  return { x: p.move.x, y: p.move.y + eyeHeight(p.move), z: p.move.z };
}

/** What a bot at `eye` can see of `q`: its body (chest), only its eyes over cover, or nothing. */
export function visiblePart(world: CollisionWorld, map: MapData, eye: Vec3, q: PlayerState): 'body' | 'head' | null {
  if (botCanSee(world, map, eye, chestOf(q))) return 'body';
  if (botCanSee(world, map, eye, eyePointOf(q))) return 'head';
  return null;
}
