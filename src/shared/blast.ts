/**
 * Explosion reach (pure apart from the CollisionWorld it reads): BO1's engine rules, from the
 * KisakBlack decompile of `game_mp/g_combat_mp.cpp` (`G_RadiusDamage`, `G_GetRadiusDamageDistanceSquared`,
 * `CanDamage`):
 *
 *   - Distance is from the blast to the player's origin (their feet): a grenade at your feet is
 *     distance 0. (Only brush models measure to their bounds.)
 *   - Damage falls off linearly from the inner damage at the centre to the outer damage at the
 *     radius (`blastDamage` in defs/equipment.ts), and is then scaled by how much of you the blast
 *     reaches.
 *   - Reach: five traces from the blast, to the middle of the body (halfway between the feet and
 *     the eye) and to four points 15 units (0.38 m) to either side of it, square to the blast,
 *     half that height up and down (eye level and the feet). Damage x hits / 3, capped at 1: three
 *     or more clear traces take the full blast, two take 2/3, one 1/3, none nothing. So a wall
 *     stops it, a post or a crate that hides part of you takes some of it off, and a fence or
 *     foliage (solids bullets pass) stops nothing.
 *   - A grenade stuck to you always reaches you (`CanDamage` returns 1 for its tag parent).
 *
 * One addition: a side point only counts when the middle of the body can see it, so a thin wall
 * you stand against never lets a blast in round it (BO1's walls are thick enough not to need it).
 */
import type { CollisionWorld } from './collision';
import type { Vec3 } from './math';

export const BLAST = {
  /** Side offsets of the corner traces (m): BO1's 15 units. */
  spread: 0.38,
  /** Clear traces that take the full blast (BO1: hits / 3, capped at 1). */
  fullHits: 3,
} as const;

/** What a blast tests against: the feet position and the eye height above them. */
export interface BlastBody {
  x: number;
  y: number;
  z: number;
  /** Eye height above the feet (stance dependent). */
  eye: number;
}

/** Distance from `c` to the body's origin (feet), as BO1 measures players. */
export function blastDistance(c: Vec3, b: BlastBody): number {
  return Math.hypot(c.x - b.x, c.y - b.y, c.z - b.z);
}

/** The five points a blast at `c` traces to: the middle, then the four corners (eye and feet level, either side). */
export function blastPoints(c: Vec3, b: BlastBody): Vec3[] {
  const half = b.eye * 0.5;
  const mid = { x: b.x, y: b.y + half, z: b.z };
  // The feet-level corners sit a hair above the floor so the floor itself never blocks them.
  const low = half - 0.05;
  let fx = c.x - b.x;
  let fz = c.z - b.z;
  const l = Math.hypot(fx, fz);
  if (l < 1e-6) {
    fx = 1;
    fz = 0;
  } else {
    fx /= l;
    fz /= l;
  }
  // Right of the line to the blast, in the ground plane.
  const rx = -fz * BLAST.spread;
  const rz = fx * BLAST.spread;
  return [mid, { x: mid.x + rx, y: mid.y + half, z: mid.z + rz }, { x: mid.x + rx, y: mid.y - low, z: mid.z + rz }, { x: mid.x - rx, y: mid.y + half, z: mid.z - rz }, { x: mid.x - rx, y: mid.y - low, z: mid.z - rz }];
}

/** How much of a blast at `c` reaches the body: 0, 1/3, 2/3 or 1. */
export function blastExposure(world: Pick<CollisionWorld, 'lineOfSight'>, c: Vec3, b: BlastBody): number {
  const pts = blastPoints(c, b);
  const mid = pts[0]!;
  let hits = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (!world.lineOfSight(c, p, 'bullets')) continue;
    if (i > 0 && !world.lineOfSight(mid, p, 'bullets')) continue;
    hits++;
  }
  return Math.min(1, hits / BLAST.fullHits);
}
