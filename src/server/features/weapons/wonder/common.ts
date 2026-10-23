/**
 * Shared bits of the wonder weapon behaviours: per-player state (frost, who launched you), the
 * effect push, the `fire` bus event (killcam shots, stats, hardware hits) and body points.
 */
import { PLAYER } from '../../../../shared/constants';
import type { WonderFx } from '../../../../shared/defs/wonder';
import { rayHitboxes, type HitPart } from '../../../../shared/collision';
import type { Vec3 } from '../../../../shared/math';
import { bodyHeight, moveHitboxes } from '../../../../shared/movement';
import type { PlayerState } from '../../../player';
import type { Room } from '../../../room';

export interface WonderExt {
  /** Winter's Howl frost 0..1 (1 = frozen solid), when it was last added, frozen-solid hold. */
  frost: number;
  frostAt: number;
  frozenUntil: number;
  /** Frost on this player as an entity (others see the ice). */
  frostEntity: number | null;
  /** Thundergun: who launched this player and when (falls off the map within THUNDERGUN.creditSec are theirs). */
  knockBy: string | null;
  knockAt: number;
  /** Baby Gun: shrunk until this room time (0 = full size), by whom, and the entity that says so. */
  shrunkUntil: number;
  shrunkBy: string | null;
  shrunkEntity: number | null;
  /** Wave Gun: swelling, pops at this room time (0 = not), by whom, and its entity. */
  popAt: number;
  popBy: string | null;
  swellEntity: number | null;
  /** Zap Guns: which pistol fires next (0 right, 1 left). */
  zapSide: number;
}

declare module '../../../player' {
  interface PlayerExt {
    wonder?: WonderExt;
  }
}

export const wonderOf = (p: PlayerState): WonderExt =>
  (p.ext.wonder ??= { frost: 0, frostAt: -99, frozenUntil: 0, frostEntity: null, knockBy: null, knockAt: -99, shrunkUntil: 0, shrunkBy: null, shrunkEntity: null, popAt: 0, popBy: null, swellEntity: null, zapSide: 0 });

/** Is `p` shrunk by the Baby Gun right now? */
export const isShrunk = (room: Room, p: PlayerState): boolean => p.alive && (p.ext.wonder?.shrunkUntil ?? 0) > room.time;
/** Is `p` swelling under the Wave Gun right now? */
export const isSwelling = (p: PlayerState): boolean => p.alive && (p.ext.wonder?.popAt ?? 0) > 0;

/** Chest point of a living body (the aim / blast test point; lower when crouched or prone). */
export const chest = (q: PlayerState): Vec3 => ({ x: q.move.x, y: q.move.y + Math.min(PLAYER.height, bodyHeight(q.move)) * 0.62, z: q.move.z });

/** Points on a body a blast or a bolt may touch (feet, chest, head). */
export const bodyPoints = (q: PlayerState): Vec3[] => {
  const h = bodyHeight(q.move);
  return [
    { x: q.move.x, y: q.move.y + 0.25, z: q.move.z },
    { x: q.move.x, y: q.move.y + h * 0.62, z: q.move.z },
    { x: q.move.x, y: q.move.y + h * 0.92, z: q.move.z },
  ];
};

const r2 = (v: number) => Math.round(v * 100) / 100;
export const v3 = (v: Vec3): [number, number, number] => [r2(v.x), r2(v.y), r2(v.z)];

/** Push an effect everyone draws. */
export function wonderFx(room: Room, fx: WonderFx): void {
  room.sendFeature(null, 'weapons.wonderFx', fx);
}

/**
 * The `fire` bus event a hitscan shot would emit: the killcam records the shot (its end and
 * whether it hit), progression counts shots and hits, and killstreak hardware on the line is hit.
 */
export function emitFire(room: Room, p: PlayerState, weapon: string, origin: Vec3, dir: Vec3, end: Vec3, hits: { victim: PlayerState; part: HitPart; damage: number }[] = []): void {
  room.bus.emit('fire', { player: p, weapon, origin, dir, hits, end });
}

/** Enemies `p` can hurt that are alive (bots and humans alike). */
export const targetsOf = (room: Room, p: PlayerState): PlayerState[] => [...room.players.values()].filter((q) => q !== p && q.alive && room.canDamage(p, q));

/** Distance from point `p` to the segment origin + dir * [0, len]. */
export function offRay(o: Vec3, dir: Vec3, len: number, p: Vec3): { along: number; off: number } {
  const dx = p.x - o.x;
  const dy = p.y - o.y;
  const dz = p.z - o.z;
  const along = Math.max(0, Math.min(len, dx * dir.x + dy * dir.y + dz * dir.z));
  return { along, off: Math.hypot(dx - dir.x * along, dy - dir.y * along, dz - dir.z * along) };
}

/**
 * An instant beam from `o` along `dir` (Wunderwaffe, Baby Gun, Zap Guns, Wave Gun): the first enemy
 * hitbox on the line, else the nearest body whose chest is within `aimRadius` of it (in sight);
 * failing both, where it meets the world (`wall`) and, with `splashR`, an enemy standing within
 * that of the impact. Returns the victim (or null), the part hit, and where the beam ends.
 */
export function lineStrike(room: Room, p: PlayerState, o: Vec3, dir: Vec3, opt: { range: number; aimRadius: number; splashR?: number }): { victim: PlayerState | null; part: HitPart; end: Vec3; wall: boolean } {
  const wall = room.world.raycast(o, dir, opt.range, 'bullets');
  let maxT = wall ? wall.t : opt.range;
  let victim: PlayerState | null = null;
  let part: HitPart = 'torso';
  const enemies = targetsOf(room, p);
  for (const q of enemies) {
    const h = rayHitboxes(o, dir, moveHitboxes(q.move, q.yaw), maxT);
    if (h) {
      maxT = h.t;
      victim = q;
      part = h.part;
    }
  }
  if (victim) return { victim, part, end: { x: o.x + dir.x * maxT, y: o.y + dir.y * maxT, z: o.z + dir.z * maxT }, wall: false };
  // Forgiving aim: the nearest body whose chest is right beside the line, in sight.
  let best = Infinity;
  for (const q of enemies) {
    const c = chest(q);
    const r = offRay(o, dir, maxT, c);
    if (r.off <= opt.aimRadius && r.along < best && room.world.lineOfSight(o, c, 'bullets')) {
      best = r.along;
      victim = q;
    }
  }
  if (victim) return { victim, part: 'torso', end: chest(victim), wall: false };
  const end = { x: o.x + dir.x * maxT, y: o.y + dir.y * maxT, z: o.z + dir.z * maxT };
  if (wall && opt.splashR) {
    // It struck the ground or a wall: whoever stands right there.
    const back = { x: end.x - dir.x * 0.1, y: end.y - dir.y * 0.1, z: end.z - dir.z * 0.1 };
    let bd = opt.splashR;
    for (const q of enemies) {
      const c = chest(q);
      const d = Math.min(Math.hypot(c.x - back.x, c.y - back.y, c.z - back.z), Math.hypot(q.move.x - back.x, q.move.y + 0.3 - back.y, q.move.z - back.z));
      if (d <= bd && room.world.lineOfSight(back, c, 'bullets')) {
        bd = d;
        victim = q;
      }
    }
  }
  return { victim, part: 'torso', end, wall: !!wall };
}
