/**
 * Spy Plane (UAV), Counter-Spy Plane and Blackbird: a plane entity circling the map and radar
 * modifiers. Spy Plane / Blackbird: `radarVisible` true for the owner's enemies (Ghost's false vote
 * still wins). Counter-Spy Plane: `radarJammed` for the owner's enemies. Spy and Counter-Spy planes
 * can be shot down; the Blackbird flies too high.
 */
import { KILLSTREAK_BY_ID, KS_ENTITY } from '../../../../shared/defs/killstreaks';
import type { PlayerState } from '../../../player';
import type { Room } from '../../../room';
import type { Active, KsRoom } from '../world';
import type { CallArgs } from './types';

const KIND: Record<string, string> = { uav: KS_ENTITY.uav, counter_uav: KS_ENTITY.counterUav, blackbird: KS_ENTITY.blackbird };

export function callRadar(ctx: KsRoom, p: PlayerState, streak: string, _args: CallArgs): string | null {
  const def = KILLSTREAK_BY_ID.get(streak)!;
  const room = ctx.room;
  const c = ctx.center;
  const r = Math.max(15, ctx.radius * (streak === 'blackbird' ? 1.1 : 0.8));
  const y = streak === 'blackbird' ? ctx.planeY() + 25 : ctx.planeY();
  const speed = streak === 'blackbird' ? 0.5 : 0.3; // rad/s around the map
  let a = Math.random() * Math.PI * 2;
  const pos = () => ({ x: c.x + Math.cos(a) * r, y, z: c.z + Math.sin(a) * r });
  const at = pos();
  const ent = room.entities.add({ kind: KIND[streak]!, ...at, yaw: 0, owner: p.id, team: p.team });
  const until = room.time + (def.durationSec ?? 30);
  const act: Active = {
    streak,
    owner: p,
    entities: [ent.id],
    update(dt) {
      if (room.time >= until || !room.entities.get(ent.id)) return false;
      a += speed * dt;
      const q = pos();
      ent.x = q.x;
      ent.z = q.z;
      // Tangent heading (counter-clockwise orbit in x/z): direction (-sin a, cos a); yaw 0 = -z.
      ent.yaw = Math.atan2(Math.sin(a), -Math.cos(a));
      return true;
    },
  };
  ctx.add(act);
  if (def.hp) ctx.damageable(ent, { hp: def.hp, air: true, radius: 3.5, yOff: 0, active: act, score: 100 });
  return null;
}

/** Radar modifiers, registered once per room. */
export function registerRadarModifiers(room: Room, ctx: KsRoom): void {
  const spying = (viewer: PlayerState) => ctx.actives.some((a) => !a.done && (a.streak === 'uav' || a.streak === 'blackbird') && ctx.sameSide(a.owner, viewer));
  room.modifiers.add('radarVisible', (target, viewer) => (target.alive && room.isEnemy(viewer, target) && spying(viewer) ? true : undefined), 'killstreaks.uav');
  room.modifiers.add('radarJammed', (viewer) => (ctx.actives.some((a) => !a.done && a.streak === 'counter_uav' && room.isEnemy(a.owner, viewer)) ? true : undefined), 'killstreaks.counter_uav');
}
