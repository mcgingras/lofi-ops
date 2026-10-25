/**
 * Lock-on for the Strela-3 and the Stinger (defs/launchers.ts `lock`). Every tick, for every live
 * player holding one aimed down the sights (ADS >= `lock.ads`, a round in, not reloading or
 * switching): the enemy AIR killstreak hardware (the killstreaks feature's damageable entities with
 * `air`: Spy Plane, Counter-Spy Plane, Attack Helicopter, Chopper Gunner, Valkyrie rockets, the
 * Care Package chopper) inside the lock cone, in range and in sight is the target. Holding it for
 * `lock.sec` (a packed Strela: x `swarm.lockMult`) locks; it may slip out for `lock.grace` before
 * the lock resets. Ground hardware and players are never locked. Bots get locks by the same rules
 * (they hold ADS on the aircraft).
 *
 * The player's client hears `weapons.lock` on every change (box and tones); `takeLock` hands the
 * locked target to the next shot and starts over.
 */
import { inLockCone, LAUNCHERS, lockSecOf } from '../../../../shared/defs/launchers';
import { papEffectOf } from '../../../../shared/defs/pack-a-punch';
import { viewDir, type Vec3 } from '../../../../shared/math';
import { eyeOf } from '../../../combat';
import { currentWeapon, type PlayerState, type WeaponState } from '../../../player';
import type { Room } from '../../../room';
import { ksRoom } from '../../killstreaks/world';

export interface LockState {
  /** The entity being locked (null: none). */
  e: number | null;
  /** Room time the lock on `e` started. */
  since: number;
  /** Room time `e` slipped out of the cone / sight (null: in it). */
  lostAt: number | null;
  locked: boolean;
  /** Seconds this lock takes. */
  sec: number;
  /** What the client was last told (to send changes only). */
  sent: string;
}

const locks = new WeakMap<PlayerState, LockState>();

/** The lock state of a player (bots read it to know when to fire). */
export function lockOf(p: PlayerState): LockState {
  let l = locks.get(p);
  if (!l) locks.set(p, (l = { e: null, since: 0, lostAt: null, locked: false, sec: 0, sent: '' }));
  return l;
}

/** Seconds a lock takes with this weapon instance (a packed Strela's swarm halves it). */
export function lockSecFor(w: WeaponState): number {
  const id = w.def.base.id;
  const swarm = w.pap ? papEffectOf(id, 'swarm') : null;
  return lockSecOf(id, swarm?.lockMult ?? 1);
}

/** An enemy air killstreak entity `p` could lock right now: centre, radius (null when it can't). */
export function lockable(room: Room, p: PlayerState, id: number, coneDeg: number, range: number): Vec3 | null {
  const ctx = ksRoom(room);
  const d = ctx.hp.get(id);
  const e = room.entities.get(id);
  if (!d || !e || !d.air || d.hp <= 0 || ctx.sameSide(p, d.active.owner)) return null;
  const c = { x: e.x, y: e.y + d.yOff, z: e.z };
  const eye = eyeOf(p);
  if (!inLockCone(eye, viewDir(p.yaw, p.pitch), c, coneDeg, range)) return null;
  const dist = Math.hypot(c.x - eye.x, c.y - eye.y, c.z - eye.z);
  const dir = { x: (c.x - eye.x) / dist, y: (c.y - eye.y) / dist, z: (c.z - eye.z) / dist };
  const hit = room.world.raycast(eye, dir, dist, 'bullets');
  if (hit && hit.t < dist - d.radius) return null;
  return c;
}

/** Enemy air killstreak entity ids (every one, lockable or not). */
export function enemyAircraft(room: Room, p: PlayerState): number[] {
  const ctx = ksRoom(room);
  const out: number[] = [];
  for (const [id, d] of ctx.hp) if (d.air && d.hp > 0 && !ctx.sameSide(p, d.active.owner) && room.entities.get(id)) out.push(id);
  return out;
}

function send(room: Room, p: PlayerState, l: LockState): void {
  const key = `${l.e}|${l.since}|${l.locked}`;
  if (key === l.sent) return;
  l.sent = key;
  if (p.isBot) return;
  room.sendFeature(p, 'weapons.lock', { e: l.e, t: Math.round(l.since * 1000) / 1000, sec: l.sec, locked: l.locked });
}

function clear(room: Room, p: PlayerState, l: LockState): void {
  l.e = null;
  l.locked = false;
  l.lostAt = null;
  send(room, p, l);
}

/** Per tick: every player's lock. */
export function updateLocks(room: Room): void {
  const now = room.time;
  for (const p of room.players.values()) {
    const l = locks.get(p);
    const w = p.alive ? currentWeapon(p) : undefined;
    const tune = w ? LAUNCHERS[w.def.base.id]?.lock : undefined;
    if (!w || !tune) {
      if (l?.e != null) clear(room, p, l);
      continue;
    }
    const st = lockOf(p);
    const ready = p.move.ads >= tune.ads && w.mag > 0 && p.reloadEnd === 0 && now >= p.swapEnd && !p.move.sprinting;
    if (!ready) {
      if (st.e != null) clear(room, p, st);
      continue;
    }
    st.sec = lockSecFor(w);
    // Keep the current target while it stays lockable (a little wider cone to hold it).
    if (st.e != null) {
      if (lockable(room, p, st.e, tune.coneDeg * 1.4, tune.range * 1.1)) st.lostAt = null;
      else if (!room.entities.get(st.e) || !ksRoom(room).hp.has(st.e)) st.lostAt = now - tune.grace - 1;
      else st.lostAt ??= now;
      if (st.lostAt !== null && now - st.lostAt > tune.grace) {
        st.e = null;
        st.locked = false;
        st.lostAt = null;
      }
    }
    if (st.e == null) {
      // The aircraft nearest the middle of the view.
      const eye = eyeOf(p);
      const look = viewDir(p.yaw, p.pitch);
      let best: { id: number; cos: number } | null = null;
      for (const id of enemyAircraft(room, p)) {
        const c = lockable(room, p, id, tune.coneDeg, tune.range);
        if (!c) continue;
        const d = Math.hypot(c.x - eye.x, c.y - eye.y, c.z - eye.z) || 1;
        const cos = ((c.x - eye.x) * look.x + (c.y - eye.y) * look.y + (c.z - eye.z) * look.z) / d;
        if (!best || cos > best.cos) best = { id, cos };
      }
      if (best) {
        st.e = best.id;
        st.since = now;
        st.locked = false;
        st.lostAt = null;
      }
    }
    if (st.e != null && !st.locked && st.lostAt === null && now - st.since >= st.sec - 1e-9) st.locked = true;
    send(room, p, st);
  }
}

/** The shot leaves: the locked target (or null for a dumb shot); the lock starts over. */
export function takeLock(room: Room, p: PlayerState): number | null {
  const l = locks.get(p);
  if (!l) return null;
  const e = l.locked && l.e != null && ksRoom(room).hp.has(l.e) ? l.e : null;
  l.e = null;
  l.locked = false;
  l.lostAt = null;
  send(room, p, l);
  return e;
}

/** Forget a player's lock (death, spawn). */
export function resetLock(room: Room, p: PlayerState): void {
  const l = locks.get(p);
  if (l && l.e != null) clear(room, p, l);
}
