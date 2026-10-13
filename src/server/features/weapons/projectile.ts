/**
 * Grenade / launcher round flight (the maths lives in `shared/projectile.ts` so the client can
 * predict throws) and the tactical effect strength.
 */
import type { Vec3 } from '../../../shared/math';

export { stepBody, throwVelocity, type Body, type StepOpts, type StepResult } from '../../../shared/projectile';

/** Effect strength of a tactical on a viewer: distance falloff times how directly they face it. */
export function tacticalAmount(eye: Vec3, look: Vec3, at: Vec3, radius: number, facingMatters: boolean): number {
  const dx = at.x - eye.x;
  const dy = at.y - eye.y;
  const dz = at.z - eye.z;
  const d = Math.hypot(dx, dy, dz);
  if (d > radius) return 0;
  const dist = Math.sqrt(1 - d / radius);
  if (!facingMatters || d < 1.5) return Math.min(1, dist);
  const facing = (look.x * dx + look.y * dy + look.z * dz) / d; // -1..1
  const f = facing > 0.5 ? 1 : facing > 0 ? 0.6 : 0.3;
  return Math.min(1, dist * f);
}
