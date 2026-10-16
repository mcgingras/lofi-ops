/**
 * Shared bits of the wonder weapon behaviours: per-player state (frost, who launched you), the
 * effect push, the `fire` bus event (killcam shots, stats, hardware hits) and body points.
 */
import { PLAYER } from '../../../../shared/constants';
import type { WonderFx } from '../../../../shared/defs/wonder';
import type { HitPart } from '../../../../shared/collision';
import type { Vec3 } from '../../../../shared/math';
import { bodyHeight } from '../../../../shared/movement';
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
}

declare module '../../../player' {
  interface PlayerExt {
    wonder?: WonderExt;
  }
}

export const wonderOf = (p: PlayerState): WonderExt => (p.ext.wonder ??= { frost: 0, frostAt: -99, frozenUntil: 0, frostEntity: null, knockBy: null, knockAt: -99 });

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
