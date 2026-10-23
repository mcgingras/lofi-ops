/**
 * Winter's Howl: a short frost blast down a narrow widening tube. Each enemy in it (clear line)
 * gains frost (`frostAdded` by distance) and takes a 20 bite; frost slows movement (the
 * `speedMultiplier` modifier, so prediction follows) and turning (the victim's client scales its
 * look by `frostSlow(frost).turn`), and at 1 they are frozen solid. A blast on someone already
 * frozen shatters them (a kill). Frost thaws after a pause. Each frosted player carries a
 * `weapons.frost` entity (`s.p` their id, `s.f` frost) so everyone sees the ice.
 */
import { papWonder } from '../../../../shared/defs/pack-a-punch';
import { WINTERS_HOWL, WONDER_ENTITY, frostAdded, inTube } from '../../../../shared/defs/wonder';
import type { HitPart } from '../../../../shared/collision';
import type { WeaponBehavior } from '../../../combat';
import type { PlayerState } from '../../../player';
import type { Room } from '../../../room';
import { bodyPoints, chest, emitFire, targetsOf, v3, wonderFx, wonderOf } from './common';

/** Frost on `q` right now (0..1). */
export const frostOf = (q: PlayerState): number => q.ext.wonder?.frost ?? 0;

/**
 * One blast landing on `q` from `by` at distance `d`: frost, or a shatter if they were frozen solid.
 * `full` (Winter's Fury, packed): the blast freezes solid at any distance. Returns damage dealt.
 */
export function frostHit(room: Room, q: PlayerState, by: PlayerState, d: number, from: { x: number; y: number; z: number }, full = false): number {
  const w = wonderOf(q);
  if (w.frost >= 1) {
    const c = chest(q);
    const dealt = room.damage({ victim: q, attacker: by, amount: WINTERS_HOWL.shatterDamage, weapon: 'wintershowl', part: 'torso', means: 'wonder', from, distance: d });
    if (!q.alive) wonderFx(room, { k: 'shatter', p: by.id, v: q.id, x: Math.round(c.x * 100) / 100, y: Math.round(c.y * 100) / 100, z: Math.round(c.z * 100) / 100 });
    return dealt;
  }
  w.frost = Math.min(1, w.frost + (full ? 1 : frostAdded(d)) * room.modifiers.mul('frostMultiplier', q));
  w.frostAt = room.time;
  if (w.frost >= 1) w.frozenUntil = room.time + WINTERS_HOWL.frozenSec;
  syncFrostEntity(room, q);
  return room.damage({ victim: q, attacker: by, amount: WINTERS_HOWL.damage, weapon: 'wintershowl', part: 'torso', means: 'wonder', from, distance: d });
}

export const winterBehavior: WeaponBehavior = {
  fire(room, player, weapon, shot) {
    const o = shot.origin;
    const dir = shot.dir;
    const W = WINTERS_HOWL;
    const full = !!weapon.pap && !!papWonder('wintershowl').freezeAll;
    wonderFx(room, { k: 'frost', p: player.id, o: v3(o), d: v3(dir) });
    const hits: { victim: PlayerState; part: HitPart; damage: number }[] = [];
    for (const q of targetsOf(room, player)) {
      let best: number | null = null;
      for (const pt of bodyPoints(q)) {
        const tube = inTube(o, dir, pt, W.range, W.r0, W.r1);
        if (tube && (best === null || tube.dist < best) && room.world.lineOfSight(o, pt, 'bullets')) best = tube.dist;
      }
      if (best === null) continue;
      hits.push({ victim: q, part: 'torso', damage: frostHit(room, q, player, best, o, full) });
    }
    const wall = room.world.raycast(o, dir, W.range, 'bullets');
    const t = wall ? wall.t : W.range;
    emitFire(room, player, 'wintershowl', o, dir, { x: o.x + dir.x * t, y: o.y + dir.y * t, z: o.z + dir.z * t }, hits);
  },
};

/** Keep `q`'s frost entity in step with their frost (created on the first frost, removed when thawed or dead). */
export function syncFrostEntity(room: Room, q: PlayerState): void {
  const w = q.ext.wonder;
  if (!w) return;
  const live = w.frostEntity !== null ? room.entities.get(w.frostEntity) : undefined;
  if (!q.alive || w.frost <= 0) {
    if (live) room.entities.remove(live.id);
    w.frostEntity = null;
    return;
  }
  const f = Math.round(w.frost * 100) / 100;
  if (live) {
    live.x = q.move.x;
    live.y = q.move.y;
    live.z = q.move.z;
    live.yaw = q.yaw;
    if (live.s?.f !== f) live.s = { ...live.s, f };
    return;
  }
  w.frostEntity = room.entities.add({ kind: WONDER_ENTITY.frost, x: q.move.x, y: q.move.y, z: q.move.z, yaw: q.yaw, s: { p: q.id, f } }).id;
}

/** Thaw everyone a little (per tick) and keep the ice on them. */
export function updateFrost(room: Room, dt: number): void {
  for (const q of room.players.values()) {
    const w = q.ext.wonder;
    if (!w || (w.frost <= 0 && w.frostEntity === null)) continue;
    if (!q.alive) w.frost = 0;
    else if (room.time - w.frostAt >= WINTERS_HOWL.thawDelay && room.time >= w.frozenUntil) w.frost = Math.max(0, w.frost - WINTERS_HOWL.thaw * dt);
    syncFrostEntity(room, q);
  }
}
