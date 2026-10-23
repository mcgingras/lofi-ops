/**
 * 31-79 JGb215 (the Baby Gun): an instant shrink beam (`lineStrike`: the first body on the line,
 * aim forgiveness, or whoever stands where it lands), plus anyone within BABY_GUN.splashR of where
 * it ends. A hit shrinks the victim for BABY_GUN.shrinkSec (a `weapons.shrunk` entity rides them:
 * `s.p` id, `s.u` when they grow back); a hit on someone already shrunk kills them.
 *
 * While shrunk (`wireShrink`): faster legs, a tenth of the damage dealt, any hit taken kills (a
 * bullet has to hit the tiny body, the legs box: higher shots pass over), and an enemy who walks
 * into them kicks them to death (`kick` effect, credited to the kicker as a Baby Gun kill).
 */
import { shotSeed, spreadDegrees, spreadDirection, stanceSpread } from '../../../../shared/ballistics';
import { BABY_GUN, WONDER_ENTITY } from '../../../../shared/defs/wonder';
import type { Vec3 } from '../../../../shared/math';
import type { WeaponBehavior } from '../../../combat';
import type { PlayerState } from '../../../player';
import type { Room } from '../../../room';
import { chest, emitFire, isShrunk, lineStrike, targetsOf, v3, wonderFx, wonderOf } from './common';

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Shrink `q` (by `by`), or kill them if they already are. Returns damage dealt (0 for a shrink). */
export function shrinkHit(room: Room, q: PlayerState, by: PlayerState | null, from: Vec3): number {
  if (isShrunk(room, q)) {
    return room.damage({ victim: q, attacker: by, amount: BABY_GUN.killDamage, weapon: 'babygun', part: 'torso', means: 'wonder', from, distance: by ? Math.hypot(by.move.x - q.move.x, by.move.z - q.move.z) : 0 });
  }
  const w = wonderOf(q);
  w.shrunkUntil = room.time + BABY_GUN.shrinkSec;
  w.shrunkBy = by?.id ?? null;
  syncShrunkEntity(room, q);
  return 0;
}

export const babygunBehavior: WeaponBehavior = {
  fire(room, player, weapon, shot) {
    const moving = Math.hypot(player.move.vx, player.move.vz) > 0.5;
    const spread = spreadDegrees(weapon.def, player.move.ads, moving, room.modifiers.mul('spreadMultiplier', player) * stanceSpread(player.move));
    const dir = spreadDirection(shot.dir, spread, shotSeed(player.seed, shot.shot, 0));
    const o = shot.origin;
    const B = BABY_GUN;
    const strike = lineStrike(room, player, o, dir, B);
    const caught = new Set<PlayerState>();
    if (strike.victim) caught.add(strike.victim);
    // The pulse spreads where it lands: anyone right there (clear line from the impact) shrinks too.
    for (const q of targetsOf(room, player)) {
      if (caught.has(q)) continue;
      const c = chest(q);
      const d = Math.min(Math.hypot(c.x - strike.end.x, c.y - strike.end.y, c.z - strike.end.z), Math.hypot(q.move.x - strike.end.x, q.move.y + 0.3 - strike.end.y, q.move.z - strike.end.z));
      if (d <= B.splashR && room.world.lineOfSight(strike.end, c, 'bullets')) caught.add(q);
    }
    wonderFx(room, { k: 'shrink', p: player.id, o: v3(o), e: v3(strike.end), hit: caught.size > 0 });
    const hits = [...caught].map((q) => ({ victim: q, part: 'torso' as const, damage: shrinkHit(room, q, player, o) }));
    emitFire(room, player, 'babygun', o, dir, strike.end, hits);
  },
};

/** Keep `q`'s shrunk entity in step (created on a shrink, removed when they grow back or die). */
export function syncShrunkEntity(room: Room, q: PlayerState): void {
  const w = q.ext.wonder;
  if (!w) return;
  const live = w.shrunkEntity !== null ? room.entities.get(w.shrunkEntity) : undefined;
  if (!isShrunk(room, q)) {
    if (live) room.entities.remove(live.id);
    w.shrunkEntity = null;
    if (!q.alive || w.shrunkUntil <= room.time) w.shrunkUntil = 0;
    return;
  }
  const u = Math.round(w.shrunkUntil * 1000) / 1000;
  if (live) {
    live.x = q.move.x;
    live.y = q.move.y;
    live.z = q.move.z;
    live.yaw = q.yaw;
    if (live.s?.u !== u) live.s = { ...live.s, u };
    return;
  }
  w.shrunkEntity = room.entities.add({ kind: WONDER_ENTITY.shrunk, x: q.move.x, y: q.move.y, z: q.move.z, yaw: q.yaw, s: { p: q.id, u } }).id;
}

/** Per tick: kicks (an enemy walking into a shrunk player), growing back, the entity following. */
export function updateShrunk(room: Room): void {
  const B = BABY_GUN;
  for (const q of room.players.values()) {
    const w = q.ext.wonder;
    if (!w || (w.shrunkUntil <= 0 && w.shrunkEntity === null)) continue;
    if (isShrunk(room, q)) {
      for (const k of room.players.values()) {
        if (k === q || !k.alive || isShrunk(room, k) || !room.canDamage(k, q)) continue;
        if (Math.hypot(k.move.x - q.move.x, k.move.z - q.move.z) > B.kickR || Math.abs(k.move.y - q.move.y) > B.kickDy) continue;
        wonderFx(room, { k: 'kick', p: k.id, v: q.id, x: r2(q.move.x), y: r2(q.move.y), z: r2(q.move.z) });
        room.kill(q, k, { weapon: 'babygun', means: 'kick', distance: 0 });
        break;
      }
    }
    syncShrunkEntity(room, q);
  }
}

/** The shrunk rules for a room: legs, damage dealt, any hit kills (tiny body), and resets. */
export function wireShrink(room: Room): void {
  room.modifiers.add('speedMultiplier', (p) => (isShrunk(room, p) ? BABY_GUN.speed : undefined), 'weapons.shrunk');
  room.modifiers.add('damageDealt', (p) => (isShrunk(room, p) ? BABY_GUN.damageDealt : undefined), 'weapons.shrunk');
  // Last word on damage to a shrunk player: any hit kills, but a bullet must hit the tiny body.
  room.bus.on(
    'beforeDamage',
    (ev) => {
      if (ev.cancel || !isShrunk(room, ev.victim) || ev.means === 'fall' || ev.means === 'world' || ev.means === 'suicide') return;
      if (ev.means === 'bullet' && ev.part !== 'legs') {
        ev.cancel = true;
        return;
      }
      ev.amount = Math.max(ev.amount, BABY_GUN.killDamage);
    },
    { priority: -50 },
  );
}
