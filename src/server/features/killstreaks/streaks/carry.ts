/**
 * Carrying a Sentry Gun or SAM Turret to place it (BO1 `startCarryTurret` / `watchTurretPlacement`
 * / `watchTurretUse` in `maps/mp/_turret_killstreak.gsc`; rule in shared/defs/turret-place.ts).
 *
 * - STREAK with either selected puts the turret in your hands (`ks.carry`): weapon down, x0.75
 *   speed, no sprint. Others see it on the floor in front of you (its entity, `s.c` 1, `s.v` 1 when
 *   it can go down there), moved every tick with `turretPlacement`.
 * - FIRE or USE puts it down there, facing your way, if the spot is good (the same rule the
 *   client's green / red preview runs); the streak is used then. A bad spot says why.
 * - STREAK again, a weapon switch, a grenade, the knife, selecting another streak or death put a
 *   fresh one away: the streak stays ready (BO1 `giveKillstreak(... )` on cancel and death).
 * - USE beside your own placed turret picks it up (not while it is hacked: BO1 claims the pickup
 *   trigger for the owner and a hacked turret has none for its new owner). Its lifetime pauses in
 *   hand. STREAK, a weapon switch, a grenade or the knife put it back where it was; dying puts it
 *   down at the preview if that is a good spot, else back where it was (BO1 destroyed it then).
 * Bots never carry: `callKillstreak` places theirs with `autoTurretSpot`.
 */
import { KILLSTREAK_BY_ID, KS_ENTITY } from '../../../../shared/defs/killstreaks';
import { TURRET_PLACE, turretPlacement, PLACE_REASON_TEXT, type TurretSpot } from '../../../../shared/defs/turret-place';
import { q3 } from '../../../../shared/protocol';
import type { PlayerState } from '../../../player';
import type { Room } from '../../../room';
import { callKillstreak } from '../api';
import { ksOf, markDirty } from '../state';
import { ksRoom } from '../world';
import { turretKindOf, turretsOf, type TurretRun } from './turrets';

/** The gun comes back up this long after the turret leaves your hands. */
const PUT_DOWN_SEC = 0.5;

const notice = (room: Room, p: PlayerState, text: string) => room.sendFeature(p, 'perks.notice', { text });

/** Busy with another streak in hand (or driving one)? */
function busy(p: PlayerState): boolean {
  const ks = ksOf(p);
  return !!(ks.control || ks.launcher || ks.marker || ks.map || ks.armed || ks.carry);
}

/** The spot a carrier's turret would go down on right now (their feet and facing). */
export const carrySpot = (room: Room, p: PlayerState): TurretSpot => turretPlacement(room.world, room.map, p.move, p.yaw);

/** STREAK with a Sentry Gun / SAM Turret selected: it comes up in your hands. Returns a reason when it can't. */
export function startCarry(room: Room, p: PlayerState, id: string): string | null {
  const kind = turretKindOf(id);
  if (!kind) return 'unknown';
  if (!p.alive) return 'dead';
  if (room.phase !== 'playing') return 'phase';
  const ks = ksOf(p);
  if (!ks.ready.includes(id)) return 'not_ready';
  if (busy(p)) return 'busy';
  const spot = carrySpot(room, p);
  const ent = room.entities.add({ kind: kind === 'sentry' ? KS_ENTITY.sentry : KS_ENTITY.sam, x: spot.x, y: spot.y, z: spot.z, yaw: spot.yaw, owner: p.id, team: p.team, s: { c: 1, v: spot.valid ? 1 : 0, b: q3(spot.yaw) } });
  ks.carry = { id, since: room.time, entity: ent.id, turret: null };
  p.reloadEnd = 0;
  markDirty(room, p);
  return null;
}

/** Every tick: the turret in your hands follows you (the entity others see). */
export function tickCarry(room: Room, p: PlayerState): void {
  const c = p.ext.killstreaks?.carry;
  if (!c || c.turret) return; // a picked-up turret moves itself
  const e = room.entities.get(c.entity);
  if (!e) return;
  const spot = carrySpot(room, p);
  e.x = spot.x;
  e.y = spot.y;
  e.z = spot.z;
  e.yaw = spot.yaw;
  const v = spot.valid ? 1 : 0;
  if (e.s?.v !== v || e.s?.b !== q3(spot.yaw)) e.s = { c: 1, v, b: q3(spot.yaw) };
}

/** FIRE / USE while carrying: put it down at the preview spot if it can go there. */
export function placeCarried(room: Room, p: PlayerState): boolean {
  const ks = ksOf(p);
  const c = ks.carry;
  if (!c || !p.alive || room.phase !== 'playing') return false;
  const spot = carrySpot(room, p);
  if (!spot.valid) {
    notice(room, p, `Can't place here: ${PLACE_REASON_TEXT[spot.reason].toLowerCase()}`);
    return false;
  }
  ks.carry = null;
  markDirty(room, p);
  p.swapEnd = Math.max(p.swapEnd, room.time + PUT_DOWN_SEC);
  if (c.turret) {
    c.turret.place(spot);
    return true;
  }
  room.entities.remove(c.entity);
  const res = callKillstreak(room, p, c.id, { place: spot });
  if (!res.ok) {
    notice(room, p, res.reason.replace(/_/g, ' '));
    return false;
  }
  return true;
}

/**
 * Put the turret away. A fresh one: the streak stays ready. A picked-up one goes back where it was,
 * or (on death) down at the preview spot when that is good.
 */
export function cancelCarry(room: Room, p: PlayerState, how: 'cancel' | 'death' = 'cancel'): void {
  const ks = p.ext.killstreaks;
  const c = ks?.carry;
  if (!ks || !c) return;
  ks.carry = null;
  markDirty(room, p);
  if (c.turret) {
    const spot = how === 'death' ? carrySpot(room, p) : null;
    if (spot?.valid) c.turret.place(spot);
    else c.turret.putBack();
  } else room.entities.remove(c.entity);
  if (p.alive) p.swapEnd = Math.max(p.swapEnd, room.time + PUT_DOWN_SEC);
}

/** Your own placed turret within pickup reach (not hacked, not about to expire), or null. */
export function ownTurretInReach(room: Room, p: PlayerState): TurretRun | null {
  if (!p.alive) return null;
  let best: { t: TurretRun; d: number } | null = null;
  for (const t of turretsOf(ksRoom(room))) {
    if (!t.alive || t.carrier || t.original !== p || t.hacked || t.left < 2) continue;
    const d = Math.hypot(p.move.x - t.ent.x, p.move.z - t.ent.z);
    if (d > TURRET_PLACE.pickupReach || Math.abs(p.move.y - t.ent.y) > TURRET_PLACE.pickupDy) continue;
    if (!best || d < best.d) best = { t, d };
  }
  return best?.t ?? null;
}

/** USE beside your own placed turret: it comes back into your hands. */
export function tryPickUp(room: Room, p: PlayerState): boolean {
  if (!p.alive || room.phase !== 'playing' || busy(p) || !p.move.onGround) return false;
  const t = ownTurretInReach(room, p);
  if (!t) return false;
  const id = t.act.streak;
  if (!KILLSTREAK_BY_ID.has(id)) return false;
  t.pickUp(p);
  ksOf(p).carry = { id, since: room.time, entity: t.ent.id, turret: t };
  p.reloadEnd = 0;
  markDirty(room, p);
  return true;
}
