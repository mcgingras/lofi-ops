/**
 * What players' equipment does to killstreak hardware (BO1 `watchDamage` / `checkForStunDamage` in
 * `maps/mp/_turret_killstreak.gsc`):
 * - frags, semtex and launcher rounds hurt ground hardware in their radius (with a clear line),
 *   times each piece's explosive scale (the Sentry Gun takes 2x);
 * - a flashbang or concussion that goes off near a turret stuns it for 5 s (BO1 `stunDuration`);
 * - a knife swing at an enemy turret in reach destroys it (BO1: `MOD_MELEE` does its full health).
 */
import { SENTRY } from '../../../../shared/defs/sentry';
import { viewDir } from '../../../../shared/math';
import type { PlayerState } from '../../../player';
import type { KsRoom } from '../world';
import { turretsOf } from './turrets';

export interface Detonation {
  player: PlayerState | null;
  effect: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  max: number;
  min: number;
}

export function onWeaponDetonated(ctx: KsRoom, e: Detonation): void {
  const at = { x: e.x, y: e.y, z: e.z };
  if (e.effect === 'flash' || e.effect === 'concussion') {
    for (const t of turretsOf(ctx)) {
      if (!t.alive || t.carrier) continue;
      if (e.player && ctx.sameSide(e.player, t.owner)) continue;
      const c = { x: t.ent.x, y: t.ent.y + SENTRY.yOff, z: t.ent.z };
      if (Math.hypot(c.x - at.x, c.y - at.y, c.z - at.z) > e.radius) continue;
      if (!ctx.room.world.lineOfSight({ x: at.x, y: at.y + 0.2, z: at.z }, c, 'sight')) continue;
      t.stun(SENTRY.stunSec);
    }
    return;
  }
  if (e.max > 0) ctx.explosion(at, e.radius, e.max, e.min, e.player, true);
}

/** A knife swing that hit nobody: an enemy turret in front of the attacker within reach is destroyed. */
export function onTurretMelee(ctx: KsRoom, p: PlayerState, victim: PlayerState | null): void {
  if (victim || !p.alive) return;
  const look = viewDir(p.yaw, 0);
  for (const t of turretsOf(ctx)) {
    if (!t.alive || t.carrier || ctx.sameSide(p, t.owner)) continue;
    const dx = t.ent.x - p.move.x;
    const dz = t.ent.z - p.move.z;
    const d = Math.hypot(dx, dz);
    if (d > SENTRY.knifeReach || Math.abs(t.ent.y - p.move.y) > 1.2) continue;
    if (d > 0.4 && (dx * look.x + dz * look.z) / d < Math.cos(0.9)) continue;
    const eye = { x: p.move.x, y: p.move.y + 1.2, z: p.move.z };
    if (!ctx.room.world.lineOfSight(eye, { x: t.ent.x, y: t.ent.y + 0.7, z: t.ent.z }, 'bullets')) continue;
    const hp = ctx.hp.get(t.ent.id);
    if (hp) ctx.hurtEntity(t.ent.id, hp.hp + 1, p);
    return;
  }
}
