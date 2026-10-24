/**
 * How bots use the secondary launchers (consulted by the bots brain):
 *
 * - **Never point blank.** Holding a launcher in a fight, a bot fires only with its target at
 *   least `LAUNCHER_BOT[id].min` away and nothing in the way closer than that (its own blast and
 *   the arming distance); inside it switches back to the primary (or holds if that is dry).
 * - **Worth a rocket.** It brings the launcher out against a target at range that is clustered
 *   (another enemy within 4 m) or camping (hasn't moved 1.5 m for 3 s), and otherwise puts it
 *   away for the primary. Rockets are aimed at the feet (the blast is measured to the feet); the
 *   China Lake is lobbed (`lobPitch`).
 * - **Air killstreaks.** With no one to fight, a bot carrying a lock-on launcher (Strela-3,
 *   Stinger) hunts enemy aircraft in sight: switches to it, aims down the sights at it until the
 *   lock holds, then fires. An RPG-7 or M72 LAW goes after helicopters (Attack Helicopter, Chopper
 *   Gunner, the Care Package chopper) inside 70 m, leading them; planes are out of their reach.
 */
import { KS_ENTITY } from '../../../../shared/defs/killstreaks';
import { isLockOn, LAUNCHER_BOT, LAUNCHERS, leadPoint, lobPitch } from '../../../../shared/defs/launchers';
import type { Vec3 } from '../../../../shared/math';
import type { PlayerState } from '../../../player';
import type { Room } from '../../../room';
import { ksRoom } from '../../killstreaks/world';
import { enemyAircraft } from './lock';

export type LauncherBotPlan = 'fire' | 'hold' | 'switch';

const HELIS = new Set<string>([KS_ENTITY.heli, KS_ENTITY.gunner, KS_ENTITY.dropHeli]);
/** Dumb rockets reach helicopters this far (m). */
const ROCKET_AIR_RANGE = 70;

// Where each enemy has been standing (camping check).
const anchors = new WeakMap<PlayerState, { x: number; z: number; since: number }>();

/** Seconds `p` has stayed within 1.5 m of one spot (updated when asked). */
export function stillFor(p: PlayerState, now: number): number {
  const a = anchors.get(p);
  if (!a || Math.hypot(p.move.x - a.x, p.move.z - a.z) > 1.5 || now < a.since) {
    anchors.set(p, { x: p.move.x, z: p.move.z, since: now });
    return 0;
  }
  return now - a.since;
}

/** Other enemies of `self` within 4 m of `target`. */
export function clusteredWith(room: Room, self: PlayerState, target: PlayerState): number {
  let n = 0;
  for (const q of room.players.values()) {
    if (q === target || !q.alive || !room.isEnemy(self, q)) continue;
    if (Math.hypot(q.move.x - target.move.x, q.move.y - target.move.y, q.move.z - target.move.z) <= 4) n++;
  }
  return n;
}

/** Is `target` worth a rocket from `d` metres: in the launcher's band and clustered or camping? */
export function worthRocket(room: Room, self: PlayerState, id: string, target: PlayerState, d: number): boolean {
  const band = LAUNCHER_BOT[id];
  if (!band || d < band.min + 2 || d > band.max) return false;
  return clusteredWith(room, self, target) > 0 || stillFor(target, room.time) >= 3;
}

/**
 * Holding launcher `id` in a fight, target `d` m away, aiming from `eye` at `aim`: fire, hold, or
 * switch back to the primary. Never under the launcher's minimum range or with a wall closer.
 */
export function launcherBotPlan(room: Room, self: PlayerState, id: string, target: PlayerState, d: number, eye: Vec3, aim: Vec3): LauncherBotPlan {
  const band = LAUNCHER_BOT[id];
  if (!band) return 'fire';
  const primary = self.weapons[0];
  const primaryOk = !!primary && primary.mag + primary.reserve > 0;
  if (d < band.min) return primaryOk ? 'switch' : 'hold';
  const dir = { x: aim.x - eye.x, y: aim.y - eye.y, z: aim.z - eye.z };
  const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const wall = room.world.raycast(eye, { x: dir.x / l, y: dir.y / l, z: dir.z / l }, Math.min(l, band.min), 'bullets');
  if (wall && wall.t < band.min) return 'hold';
  // A lone target on the move isn't worth it: back to the rifle (unless the rifle is dry).
  if (primaryOk && !worthRocket(room, self, id, target, d) && d < band.max * 0.6) return 'switch';
  return 'fire';
}

/**
 * Where a bot aims launcher `id` at a target standing at `feet` (moving at `vel`) from `eye`: rockets
 * at the feet (a little ahead of a mover), the China Lake on the lob that lands there.
 */
export function launcherAim(id: string, eye: Vec3, feet: Vec3, vel: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const t = LAUNCHERS[id];
  if (!t) return feet;
  const lead = leadPoint(eye, t.speed, { x: feet.x, y: feet.y + 0.25, z: feet.z }, { x: vel.x, y: 0, z: vel.z });
  if (t.kind !== 'grenade') return lead;
  const flat = Math.hypot(lead.x - eye.x, lead.z - eye.z);
  const pitch = lobPitch(t.speed, t.gravity, flat, lead.y - eye.y) ?? Math.PI / 4;
  return { x: lead.x, y: eye.y + Math.tan(pitch) * flat, z: lead.z };
}

/**
 * The enemy aircraft a bot with launcher `id` would go after now (nearest in sight and reach), with
 * the point to aim at; null if none. Lock-on launchers take any air killstreak in lock range; dumb
 * rockets only helicopters inside 70 m; the China Lake never.
 */
export function airTargetFor(room: Room, self: PlayerState, id: string, eye: Vec3): { id: number; at: Vec3; dist: number } | null {
  const t = LAUNCHERS[id];
  if (!t || t.kind === 'grenade') return null;
  const ctx = ksRoom(room);
  const lockOn = isLockOn(id);
  const range = lockOn ? (t.lock?.range ?? 150) * 0.95 : ROCKET_AIR_RANGE;
  let best: { id: number; at: Vec3; dist: number } | null = null;
  for (const eid of enemyAircraft(room, self)) {
    const e = room.entities.get(eid)!;
    const d = ctx.hp.get(eid)!;
    if (!lockOn && !HELIS.has(e.kind)) continue;
    const c = { x: e.x, y: e.y + d.yOff, z: e.z };
    const dist = Math.hypot(c.x - eye.x, c.y - eye.y, c.z - eye.z);
    if (dist > range) continue;
    const dir = { x: (c.x - eye.x) / dist, y: (c.y - eye.y) / dist, z: (c.z - eye.z) / dist };
    const hit = room.world.raycast(eye, dir, dist, 'bullets');
    if (hit && hit.t < dist - d.radius) continue;
    if (!best || dist < best.dist) best = { id: eid, at: c, dist };
  }
  return best;
}
