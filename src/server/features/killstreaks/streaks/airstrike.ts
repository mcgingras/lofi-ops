/**
 * Napalm Strike and Rolling Thunder: a plane flies a line through the point chosen on the tactical
 * map along the chosen run direction and drops on it. Napalm: three canisters, then burning ground
 * (`fire` damage, Flak Jacket Pro is immune), released about 4 s after the call. Rolling Thunder:
 * a B-52 carpet-bombs a long line, about 7 s out (BO1 timings). Footprints: `STRIKE` in
 * shared/defs/tactical-map.ts (the client draws the same ones to scale).
 */
import { KS_ENTITY } from '../../../../shared/defs/killstreaks';
import { STRIKE, dirOfYaw } from '../../../../shared/defs/tactical-map';
import type { Vec3 } from '../../../../shared/math';
import type { PlayerState } from '../../../player';
import type { Active, KsRoom } from '../world';
import type { CallArgs } from './types';

const N = STRIKE.napalm;
const T = STRIKE.rolling_thunder;
export const NAPALM = { speed: N.speed, drops: [...N.drops], releaseSec: N.releaseSec, blast: { r: N.blastR, max: 180, min: 50 }, fire: { sec: 8, r: N.fireR, dps: 30, tick: 0.5 } };
export const THUNDER = { speed: T.speed, bombs: T.bombs, spacing: T.spacing, releaseSec: T.releaseSec, blast: { r: T.blastR, max: 200, min: 40 } };

interface Drop {
  /** Distance along the run where it falls. */
  s: number;
  at: Vec3;
  done: boolean;
}

function runLine(ctx: KsRoom, p: PlayerState, streak: 'napalm' | 'rolling_thunder', target: Vec3, yaw: number): string | null {
  const room = ctx.room;
  const d = dirOfYaw(yaw);
  const speed = streak === 'napalm' ? NAPALM.speed : THUNDER.speed;
  const y = streak === 'napalm' ? ctx.groundY + 32 : ctx.planeY();
  // Starts far enough out that the middle of the drop comes `releaseSec` after the call.
  const lead = Math.max(ctx.radius + 20, speed * (streak === 'napalm' ? NAPALM.releaseSec : THUNDER.releaseSec));
  const start = { x: target.x - d.x * lead, z: target.z - d.z * lead };
  const ent = room.entities.add({ kind: streak === 'napalm' ? KS_ENTITY.jet : KS_ENTITY.bomber, x: start.x, y, z: start.z, yaw, owner: p.id, team: p.team });
  const offsets = streak === 'napalm' ? NAPALM.drops : Array.from({ length: THUNDER.bombs }, (_, i) => (i - (THUNDER.bombs - 1) / 2) * THUNDER.spacing);
  const drops: Drop[] = offsets.map((o) => {
    const x = target.x + d.x * o;
    const z = target.z + d.z * o;
    return { s: lead + o, at: { x, y: ctx.groundAt(x, z), z }, done: false };
  });
  let s = 0;
  const end = lead * 2;
  const fires: { id: number; until: number; next: number; at: Vec3 }[] = [];
  const act: Active = {
    streak,
    owner: p,
    entities: [ent.id],
    update(dt) {
      if (room.entities.get(ent.id)) {
        s += speed * dt;
        ent.x = start.x + d.x * s;
        ent.z = start.z + d.z * s;
        // Bombs fall for about half a second: drop a little before overhead.
        for (const b of drops) {
          if (b.done || s < b.s - speed * 0.25) continue;
          b.done = true;
          if (streak === 'napalm') {
            ctx.blast(b.at, NAPALM.blast.r, NAPALM.blast.max, NAPALM.blast.min, p, 'napalm', { fx: 'napalm' });
            const f = room.entities.add({ kind: KS_ENTITY.fire, x: b.at.x, y: b.at.y, z: b.at.z, yaw: 0, owner: p.id, team: p.team, s: { r: NAPALM.fire.r } });
            act.entities.push(f.id);
            fires.push({ id: f.id, until: room.time + NAPALM.fire.sec, next: room.time + NAPALM.fire.tick, at: b.at });
          } else {
            ctx.blast(b.at, THUNDER.blast.r, THUNDER.blast.max, THUNDER.blast.min, p, 'rolling_thunder');
          }
        }
        if (s >= end) ctx.removeEntity(ent.id);
      }
      for (const f of fires) {
        if (room.time >= f.until) {
          ctx.removeEntity(f.id);
          continue;
        }
        if (room.time >= f.next) {
          f.next += NAPALM.fire.tick;
          room.radiusDamage({ x: f.at.x, y: f.at.y + 0.5, z: f.at.z }, NAPALM.fire.r, NAPALM.fire.dps * NAPALM.fire.tick, NAPALM.fire.dps * NAPALM.fire.tick, { attacker: p, weapon: 'napalm', means: 'fire' });
        }
      }
      for (let i = fires.length - 1; i >= 0; i--) if (room.time >= fires[i]!.until) fires.splice(i, 1);
      return !!room.entities.get(ent.id) || fires.length > 0 || drops.some((b) => !b.done);
    },
  };
  ctx.add(act);
  return null;
}

export function callNapalm(ctx: KsRoom, p: PlayerState, args: CallArgs): string | null {
  if (!args.target) return 'no_target';
  return runLine(ctx, p, 'napalm', args.target, args.yaw);
}

export function callThunder(ctx: KsRoom, p: PlayerState, args: CallArgs): string | null {
  if (!args.target) return 'no_target';
  return runLine(ctx, p, 'rolling_thunder', args.target, args.yaw);
}
