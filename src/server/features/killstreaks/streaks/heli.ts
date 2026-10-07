/**
 * Attack Helicopter and Chopper Gunner.
 * - Attack Helicopter: flies in from the edge, patrols around the area chosen on the tactical map
 *   (BO1: "hovers near" the designated area; `STRIKE.attack_helicopter.patrolR`), and fires its
 *   minigun in bursts at the nearest visible enemy (Ghost Pro hides). Can be shot down. Leaves when
 *   time is up.
 * - Chopper Gunner: circles the map while the caller works its explosive cannon from the air (their
 *   camera rides it; yaw/pitch aim it, FIRE shoots). The caller's body stays put and can be killed,
 *   which ends it. Bots aim it themselves (skill-dependent error). Can be shot down.
 */
import { KILLSTREAK_BY_ID, KS_ENTITY } from '../../../../shared/defs/killstreaks';
import { STRIKE } from '../../../../shared/defs/tactical-map';
import { Buttons } from '../../../../shared/input';
import { viewDir, type Vec3 } from '../../../../shared/math';
import type { PlayerState } from '../../../player';
import { ksOf, markDirty } from '../state';
import { chestOf, turnToward, type Active, type KsRoom } from '../world';
import { botStreakSkill } from '../skill';
import { shoot } from './turrets';
import type { CallArgs } from './types';

export const HELI = { speed: 14, range: 70, acquire: 0.6, rate: 6, damage: 22, burst: 1.6, rest: 1.0, spread: 0.012 };
export const GUNNER = { rate: 3.5, blast: { r: 3.2, max: 140, min: 30 }, orbit: 0.22 };

/** Max helicopters (attack + gunner) up at once in a room (airspace). */
export const AIRSPACE = 3;

export function airspaceFull(ctx: KsRoom): boolean {
  return ctx.activeKind('attack_helicopter').length + ctx.activeKind('chopper_gunner').length >= AIRSPACE;
}

export function callHeli(ctx: KsRoom, p: PlayerState, args: CallArgs): string | null {
  if (airspaceFull(ctx)) return 'airspace_full';
  const room = ctx.room;
  const def = KILLSTREAK_BY_ID.get('attack_helicopter')!;
  const y = ctx.heliY(ctx.activeKind('attack_helicopter').length * 3);
  const start = ctx.edgePoint(Math.random() * Math.PI * 2, 30, y);
  // Patrol centre: the chosen area (kept far enough inside that the orbit stays over the map).
  const c = args.target ? ctx.clampToMap(args.target) : ctx.center;
  const orbitR = Math.min(STRIKE.attack_helicopter.patrolR, Math.max(6, ctx.radius * 0.6));
  const ent = room.entities.add({ kind: KS_ENTITY.heli, ...start, yaw: 0, owner: p.id, team: p.team, s: { f: 0, px: Math.round(c.x * 10) / 10, pz: Math.round(c.z * 10) / 10, pr: orbitR } });
  const until = room.time + (def.durationSec ?? 60);
  let a = Math.atan2(start.z - c.z, start.x - c.x);
  let target: PlayerState | null = null;
  let acquired = 0;
  let nextShot = 0;
  let retarget = 0;
  let leaving = false;
  const act: Active = {
    streak: 'attack_helicopter',
    owner: p,
    entities: [ent.id],
    update(dt) {
      if (!room.entities.get(ent.id)) return false;
      if (room.time >= until) leaving = true;
      // Fly toward a point on the patrol orbit (or away when leaving).
      a += 0.12 * dt;
      const goal = leaving ? ctx.edgePoint(a, 60, y + 10) : { x: c.x + Math.cos(a) * orbitR, y, z: c.z + Math.sin(a) * orbitR };
      const dx = goal.x - ent.x;
      const dz = goal.z - ent.z;
      const d = Math.hypot(dx, dz);
      const step = Math.min(d, HELI.speed * dt);
      if (d > 0.01) {
        ent.x += (dx / d) * step;
        ent.z += (dz / d) * step;
      }
      ent.y += (goal.y - ent.y) * Math.min(1, dt);
      if (leaving) {
        ent.yaw = turnToward(ent.yaw, Math.atan2(-dx, -dz), 2 * dt);
        return d > 5;
      }
      const gun = { x: ent.x, y: ent.y - 1.2, z: ent.z };
      if (room.time >= retarget || !target || !target.alive) {
        retarget = room.time + 0.4;
        const next = ctx.targetsFor(act.owner, KS_ENTITY.heli, gun, HELI.range)[0] ?? null;
        if (next !== target) {
          target = next;
          acquired = room.time;
        }
      }
      let firing = false;
      if (target) {
        const tc = chestOf(target);
        ent.yaw = turnToward(ent.yaw, Math.atan2(-(tc.x - ent.x), -(tc.z - ent.z)), 2.5 * dt);
        const since = room.time - acquired - HELI.acquire;
        const inBurst = since >= 0 && since % (HELI.burst + HELI.rest) < HELI.burst;
        if (inBurst && room.time >= nextShot) {
          nextShot = room.time + 1 / HELI.rate;
          firing = true;
          shoot(ctx, act.owner, gun, tc, target, 'attack_helicopter', HELI.damage, HELI.spread, `ent:${ent.id}`);
        }
      } else ent.yaw = turnToward(ent.yaw, Math.atan2(-dx, -dz), 1.5 * dt);
      const f = firing ? 1 : 0;
      if (ent.s?.f !== f) ent.s = { ...ent.s, f };
      return true;
    },
  };
  ctx.add(act);
  ctx.damageable(ent, { hp: def.hp ?? 1500, air: true, radius: 3, yOff: 0, active: act, score: 200 });
  return null;
}

export function callGunner(ctx: KsRoom, p: PlayerState, _args: CallArgs): string | null {
  if (airspaceFull(ctx)) return 'airspace_full';
  const room = ctx.room;
  const def = KILLSTREAK_BY_ID.get('chopper_gunner')!;
  const c = ctx.center;
  const r = Math.max(8, ctx.radius * 0.45);
  const y = ctx.heliY(6);
  let a = Math.random() * Math.PI * 2;
  const pos = () => ({ x: c.x + Math.cos(a) * r, y, z: c.z + Math.sin(a) * r });
  const ent = room.entities.add({ kind: KS_ENTITY.gunner, ...pos(), yaw: 0, owner: p.id, team: p.team, s: { f: 0 } });
  const until = room.time + (def.durationSec ?? 40);
  const ks = ksOf(p);
  ks.control = { id: 'chopper_gunner', entity: ent.id, until };
  markDirty(room, p);
  let nextShot = 0;
  let botAimErr: Vec3 = { x: 0, y: 0, z: 0 };
  let botRetarget = 0;
  const act: Active = {
    streak: 'chopper_gunner',
    owner: p,
    entities: [ent.id],
    update(dt) {
      if (room.time >= until || !room.entities.get(ent.id) || !p.alive || room.players.get(p.id) !== p) return false;
      a += GUNNER.orbit * dt;
      const q = pos();
      ent.x = q.x;
      ent.z = q.z;
      ent.yaw = Math.atan2(Math.sin(a), -Math.cos(a));
      const gun = { x: ent.x, y: ent.y - 1.5, z: ent.z };
      let dir: Vec3 | null = null;
      if (p.isBot) {
        const skill = botStreakSkill(p);
        const tgt = ctx.targetsFor(p, KS_ENTITY.gunner, gun, 200)[0];
        if (tgt) {
          if (room.time >= botRetarget) {
            botRetarget = room.time + 0.8;
            const e = (1 - skill) * 5 + 0.5;
            botAimErr = { x: (Math.random() - 0.5) * e, y: 0, z: (Math.random() - 0.5) * e };
          }
          const tc = chestOf(tgt);
          const aim = { x: tc.x + botAimErr.x - gun.x, y: tc.y - gun.y, z: tc.z + botAimErr.z - gun.z };
          const l = Math.hypot(aim.x, aim.y, aim.z) || 1;
          dir = { x: aim.x / l, y: aim.y / l, z: aim.z / l };
        }
      } else if (p.buttons & Buttons.FIRE) dir = viewDir(p.yaw, p.pitch);
      let firing = false;
      if (dir && room.time >= nextShot) {
        nextShot = room.time + 1 / GUNNER.rate;
        firing = true;
        const hit = room.world.raycast(gun, dir, 250, 'bullets');
        const at = hit ? hit.point : { x: gun.x + dir.x * 250, y: gun.y + dir.y * 250, z: gun.z + dir.z * 250 };
        ctx.blast(at, GUNNER.blast.r, GUNNER.blast.max, GUNNER.blast.min, p, 'chopper_gunner');
      }
      const f = firing ? 1 : 0;
      if (ent.s?.f !== f) ent.s = { ...ent.s, f };
      return true;
    },
    cleanup() {
      if (ks.control?.entity === ent.id) {
        ks.control = null;
        markDirty(room, p);
      }
    },
  };
  ctx.add(act);
  ctx.damageable(ent, { hp: def.hp ?? 2000, air: true, radius: 3.2, yOff: 0, active: act, score: 300 });
  return null;
}
