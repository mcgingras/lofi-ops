/**
 * The knife (melee on V/E): BO1 lunge. Picks the nearest enemy inside a cone in front of the
 * player within lunge range and line of sight, nudges the attacker towards them and kills in one
 * hit. Lowers the gun for the recovery time (core refuses to fire while "switching").
 */
import { PLAYER } from '../../../shared/constants';
import { MELEE } from '../../../shared/defs/equipment';
import { viewDir, type Vec3 } from '../../../shared/math';
import { eyeHeight } from '../../../shared/movement';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { wext } from './state';

export interface MeleeTarget {
  victim: PlayerState;
  distance: number;
}

/** The enemy a knife from `p` would hit right now, if any. */
export function meleeTarget(room: Room, p: PlayerState): MeleeTarget | null {
  const eye: Vec3 = { x: p.move.x, y: p.move.y + eyeHeight(p.move), z: p.move.z };
  const look = viewDir(p.yaw, p.pitch);
  const cosCone = Math.cos((MELEE.cone * Math.PI) / 180);
  let best: MeleeTarget | null = null;
  for (const q of room.players.values()) {
    if (q === p || !q.alive || !room.canDamage(p, q)) continue;
    const h = q.move.crouched ? PLAYER.crouchHeight : PLAYER.height;
    // Closest point on the target's vertical axis to the eye (so looking at head or legs both count).
    const cy = Math.max(q.move.y + 0.3, Math.min(q.move.y + h - 0.1, eye.y));
    const to = { x: q.move.x - eye.x, y: cy - eye.y, z: q.move.z - eye.z };
    const d = Math.hypot(to.x, to.y, to.z);
    if (d > MELEE.lungeRange + PLAYER.radius) continue;
    const flat = Math.hypot(to.x, to.z);
    // Cone test on the ground plane (pitch matters little at knife range), plus a loose vertical check.
    const f = flat > 1e-3 ? (look.x * to.x + look.z * to.z) / (flat * Math.max(1e-3, Math.hypot(look.x, look.z))) : 1;
    if (f < cosCone && d > PLAYER.radius * 2) continue;
    if (Math.abs(to.y) > 1.4) continue;
    if (!room.world.lineOfSight(eye, { x: q.move.x, y: cy, z: q.move.z }, 'bullets')) continue;
    if (!best || d < best.distance) best = { victim: q, distance: d };
  }
  return best;
}

/** Swing the knife. Returns the victim (or null on a miss / when not allowed). */
export function melee(room: Room, p: PlayerState): PlayerState | null {
  if (!p.alive || room.phase !== 'playing') return null;
  const x = wext(p);
  if (room.time < x.meleeReady || x.throwing) return null;
  x.meleeReady = room.time + MELEE.cooldownSec;
  p.reloadEnd = 0;
  x.shells = null;
  p.swapEnd = Math.max(p.swapEnd, room.time + MELEE.recoverySec);
  const t = meleeTarget(room, p);
  if (t && t.distance > MELEE.range) {
    // Lunge: a short velocity impulse towards the victim (the server owns movement; the client corrects).
    const dx = t.victim.move.x - p.move.x;
    const dz = t.victim.move.z - p.move.z;
    const l = Math.hypot(dx, dz) || 1;
    const sp = Math.min(MELEE.lungeSpeed, (l - 0.7) * 6);
    if (sp > 0) {
      p.move.vx = (dx / l) * sp;
      p.move.vz = (dz / l) * sp;
    }
  }
  room.bus.emit('weapons.melee', { player: p, victim: t?.victim ?? null });
  room.sendFeature(null, 'weapons.melee', { p: p.id, hit: !!t });
  if (!t) return null;
  room.damage({ victim: t.victim, attacker: p, amount: MELEE.damage, weapon: 'knife', part: 'torso', means: 'melee', from: { x: p.move.x, y: p.move.y + 1.2, z: p.move.z }, distance: t.distance });
  return t.victim;
}
