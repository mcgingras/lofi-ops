/**
 * Explosion reach (pure apart from the CollisionWorld it reads), the rules of the engine BO1 runs
 * on (`G_RadiusDamage` / `G_CanRadiusDamage`, inherited from Quake III's `CanDamage`):
 *
 *   - Distance is measured from the blast to the nearest point of the body's box, not to its chest:
 *     a grenade at your feet is distance 0.
 *   - Damage falls off linearly from the inner damage at the centre to the outer damage at the
 *     radius (`blastDamage` in defs/equipment.ts).
 *   - The blast reaches a body if a trace from the centre gets to the middle of its box, or failing
 *     that to one of four points `BLAST.spread` out to the sides at that height, or to its head
 *     (a side point counts only when the middle of the body sees it, so a thin wall you stand
 *     against never lets a blast round it).
 *     A wall between you and the blast stops it (explosions never go through walls); a post, a
 *     barrel or a thin pillar that hides the middle of you doesn't. Fences and foliage (solids
 *     bullets pass) don't stop it either.
 */
import type { CollisionWorld } from './collision';
import type { Vec3 } from './math';

export const BLAST = {
  /** Side offsets of the extra traces (m): BO1's 15 units, a body's half-width. */
  spread: 0.38,
  /** Head point: this far below the top of the box (m). */
  headDrop: 0.15,
} as const;

/** The box a blast tests against: feet position, half-width and height. */
export interface BlastBody {
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
}

/** Distance from `c` to the nearest point of the body's box (0 inside it). */
export function blastDistance(c: Vec3, b: BlastBody): number {
  const dx = Math.max(b.x - b.radius - c.x, 0, c.x - (b.x + b.radius));
  const dy = Math.max(b.y - c.y, 0, c.y - (b.y + b.height));
  const dz = Math.max(b.z - b.radius - c.z, 0, c.z - (b.z + b.radius));
  return Math.hypot(dx, dy, dz);
}

/** The points a blast traces to, in order: the middle, four around it, the head. */
export function blastPoints(b: BlastBody): Vec3[] {
  const mid = b.y + b.height * 0.5;
  const s = BLAST.spread;
  return [
    { x: b.x, y: mid, z: b.z },
    { x: b.x + s, y: mid, z: b.z + s },
    { x: b.x - s, y: mid, z: b.z + s },
    { x: b.x + s, y: mid, z: b.z - s },
    { x: b.x - s, y: mid, z: b.z - s },
    { x: b.x, y: b.y + Math.max(b.height * 0.5, b.height - BLAST.headDrop), z: b.z },
  ];
}

/** Does a blast at `c` reach the body (any trace point clear through bullet-stopping solids)? */
export function blastReaches(world: Pick<CollisionWorld, 'lineOfSight'>, c: Vec3, b: BlastBody): boolean {
  const pts = blastPoints(b);
  const mid = pts[0]!;
  if (world.lineOfSight(c, mid, 'bullets')) return true;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    // A side point beyond a thin wall the body stands against is on the blast's side of it: it
    // only counts when the body itself could see it.
    if (world.lineOfSight(c, p, 'bullets') && world.lineOfSight(mid, p, 'bullets')) return true;
  }
  return false;
}
