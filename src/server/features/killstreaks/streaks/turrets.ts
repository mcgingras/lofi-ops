/**
 * Sentry Gun and SAM Turret: placed on the ground in front of the caller.
 * - Sentry: turns toward the nearest visible enemy (bots and humans; Ghost Pro hides), spins up,
 *   then fires bullets with tracers. Can be shot / blown up.
 * - SAM: fires homing missiles at enemy aircraft (Spy Planes, helicopters, Chopper Gunner, drop
 *   choppers). Can be shot / blown up.
 * Hacker Pro: an enemy hacker holding USE beside one for `hackSec` takes it over.
 */
import { KILLSTREAK_BY_ID, KS_ENTITY } from '../../../../shared/defs/killstreaks';
import { PERK_TUNING } from '../../../../shared/defs/perks';
import { Buttons } from '../../../../shared/input';
import { viewDir, type Vec3 } from '../../../../shared/math';
import { q3 } from '../../../../shared/protocol';
import type { Entity } from '../../../entities';
import type { PlayerState } from '../../../player';
import { isPro } from '../../perks/common';
import { turnToward, chestOf, type Active, type KsRoom } from '../world';
import type { CallArgs } from './types';

export const SENTRY = { range: 40, turn: 4, spinUp: 0.4, rate: 8, damage: 20, muzzle: 1.0, spread: 0.02 };
export const SAM = { range: 160, reload: 2.5, missileSpeed: 60, missileDamage: 1000, missiles: 8 };

/** Where to put a placed turret: 1.6 m ahead on the ground if there is room, else at the feet. */
export function placeSpot(ctx: KsRoom, p: PlayerState): Vec3 {
  const d = viewDir(p.yaw, 0);
  const x = p.move.x + d.x * 1.6;
  const z = p.move.z + d.z * 1.6;
  const y = ctx.groundAt(x, z);
  if (Math.abs(y - p.move.y) < 1 && ctx.room.world.free(x, y + 0.05, z) && ctx.room.world.lineOfSight({ x: p.move.x, y: p.move.y + 1, z: p.move.z }, { x, y: y + 1, z })) return { x, y, z };
  return { x: p.move.x, y: p.move.y, z: p.move.z };
}

/** Hacker Pro takeover; returns true when it changed hands this tick. */
function hackTick(ctx: KsRoom, ent: Entity, act: Active, state: { hacker: string | null; t: number }, dt: number): boolean {
  let who: PlayerState | null = null;
  for (const q of ctx.room.players.values()) {
    if (!q.alive || ctx.sameSide(q, act.owner) || !(q.buttons & Buttons.USE) || !isPro(q, 'hacker')) continue;
    if (Math.hypot(q.move.x - ent.x, q.move.z - ent.z) <= PERK_TUNING.hackRadius) {
      who = q;
      break;
    }
  }
  if (!who || (state.hacker && state.hacker !== who.id)) {
    state.hacker = null;
    state.t = 0;
    return false;
  }
  state.hacker = who.id;
  state.t += dt;
  if (state.t < PERK_TUNING.hackSec) return false;
  state.hacker = null;
  state.t = 0;
  ctx.room.bus.emit('killstreaks.destroyed', { owner: act.owner, id: act.streak, kind: ent.kind, by: who });
  act.owner = who;
  ent.owner = who.id;
  ent.team = who.team;
  ctx.fx({ kind: 'hacked', x: ent.x, y: ent.y + 1, z: ent.z });
  return true;
}

export function callSentry(ctx: KsRoom, p: PlayerState, _args: CallArgs): string | null {
  const room = ctx.room;
  const def = KILLSTREAK_BY_ID.get('sentry_gun')!;
  const at = placeSpot(ctx, p);
  const ent = room.entities.add({ kind: KS_ENTITY.sentry, ...at, yaw: p.yaw, owner: p.id, team: p.team, s: { f: 0 } });
  const until = room.time + (def.durationSec ?? 90);
  let target: PlayerState | null = null;
  let acquired = 0;
  let nextShot = 0;
  let retarget = 0;
  const hack = { hacker: null as string | null, t: 0 };
  const act: Active = {
    streak: 'sentry_gun',
    owner: p,
    entities: [ent.id],
    update(dt) {
      if (room.time >= until || !room.entities.get(ent.id)) return false;
      hackTick(ctx, ent, act, hack, dt);
      const muzzle = { x: ent.x, y: ent.y + SENTRY.muzzle, z: ent.z };
      if (room.time >= retarget || !target || !target.alive) {
        retarget = room.time + 0.25;
        const next = ctx.targetsFor(act.owner, KS_ENTITY.sentry, muzzle, SENTRY.range)[0] ?? null;
        if (next !== target) {
          target = next;
          acquired = room.time;
        }
      }
      let firing = false;
      if (target) {
        const c = chestOf(target);
        const want = Math.atan2(-(c.x - muzzle.x), -(c.z - muzzle.z));
        ent.yaw = turnToward(ent.yaw, want, SENTRY.turn * dt);
        const aligned = Math.abs(turnToward(ent.yaw, want, 10) - ent.yaw) < 0.12;
        if (aligned && room.time - acquired >= SENTRY.spinUp && room.time >= nextShot) {
          nextShot = room.time + 1 / SENTRY.rate;
          firing = true;
          shoot(ctx, act.owner, muzzle, c, target, 'sentry_gun', SENTRY.damage, SENTRY.spread, `ent:${ent.id}`);
        }
      }
      const f = firing ? 1 : 0;
      if (ent.s?.f !== f) ent.s = { ...ent.s, f };
      return true;
    },
  };
  ctx.add(act);
  ctx.damageable(ent, { hp: def.hp ?? 450, air: false, radius: 0.8, yOff: 0.7, active: act, score: 100 });
  return null;
}

/** One bullet from killstreak hardware at `target` (hits unless the world blocks it or the spread misses). */
export function shoot(ctx: KsRoom, owner: PlayerState, from: Vec3, aimAt: Vec3, target: PlayerState, weapon: string, damage: number, spread: number, shooterId: string): void {
  const room = ctx.room;
  const dx = aimAt.x - from.x;
  const dy = aimAt.y - from.y;
  const dz = aimAt.z - from.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  const miss = Math.random() < Math.min(0.6, spread * len * 0.5);
  const jitter = miss ? 0.6 + Math.random() * 0.6 : 0;
  const a = Math.random() * Math.PI * 2;
  const end = { x: aimAt.x + Math.cos(a) * jitter, y: aimAt.y + Math.sin(a) * jitter * 0.5, z: aimAt.z + Math.sin(a) * jitter };
  const dir = { x: (end.x - from.x) / len, y: (end.y - from.y) / len, z: (end.z - from.z) / len };
  const wall = room.world.raycast(from, dir, len, 'bullets');
  const hitEnd = wall ? wall.point : end;
  room.recordShot({ p: shooterId, o: [q3(from.x), q3(from.y), q3(from.z)], e: [q3(hitEnd.x), q3(hitEnd.y), q3(hitEnd.z)], w: weapon, ...(wall || miss ? {} : { h: 1 as const }) });
  if (wall || miss) return;
  room.damage({ victim: target, attacker: owner, amount: damage, weapon, part: 'torso', means: 'killstreak', from, distance: len });
}

export function callSam(ctx: KsRoom, p: PlayerState, _args: CallArgs): string | null {
  const room = ctx.room;
  const def = KILLSTREAK_BY_ID.get('sam_turret')!;
  const at = placeSpot(ctx, p);
  const ent = room.entities.add({ kind: KS_ENTITY.sam, ...at, yaw: p.yaw, owner: p.id, team: p.team });
  const until = room.time + (def.durationSec ?? 60);
  let nextShot = room.time + 0.5;
  let left = SAM.missiles;
  const missiles: { ent: Entity; target: number; life: number }[] = [];
  const hack = { hacker: null as string | null, t: 0 };
  const act: Active = {
    streak: 'sam_turret',
    owner: p,
    entities: [ent.id],
    update(dt) {
      const alive = room.time < until && !!room.entities.get(ent.id);
      if (alive) {
        hackTick(ctx, ent, act, hack, dt);
        // Nearest enemy aircraft in range.
        let best: { id: number; d: number; e: Entity } | null = null;
        for (const [id, d] of ctx.hp) {
          if (!d.air || ctx.sameSide(d.active.owner, act.owner)) continue;
          const e = room.entities.get(id);
          if (!e) continue;
          const dist = Math.hypot(e.x - ent.x, e.y - ent.y, e.z - ent.z);
          if (dist <= SAM.range && (!best || dist < best.d)) best = { id, d: dist, e };
        }
        if (best) ent.yaw = turnToward(ent.yaw, Math.atan2(-(best.e.x - ent.x), -(best.e.z - ent.z)), 3 * dt);
        if (best && left > 0 && room.time >= nextShot) {
          nextShot = room.time + SAM.reload;
          left--;
          const m = room.entities.add({ kind: KS_ENTITY.missile, x: ent.x, y: ent.y + 1.4, z: ent.z, yaw: ent.yaw, owner: act.owner.id, team: act.owner.team });
          act.entities.push(m.id);
          missiles.push({ ent: m, target: best.id, life: 6 });
          ctx.fx({ kind: 'sam_launch', x: ent.x, y: ent.y + 1.4, z: ent.z });
        }
      }
      for (let i = missiles.length - 1; i >= 0; i--) {
        const m = missiles[i]!;
        const t = room.entities.get(m.target);
        m.life -= dt;
        if (!t || m.life <= 0 || !ctx.hp.has(m.target)) {
          ctx.removeEntity(m.ent.id);
          missiles.splice(i, 1);
          continue;
        }
        const dx = t.x - m.ent.x;
        const dy = t.y - m.ent.y;
        const dz = t.z - m.ent.z;
        const d = Math.hypot(dx, dy, dz);
        const step = SAM.missileSpeed * dt;
        if (d <= step + 2) {
          ctx.fx({ kind: 'boom', x: t.x, y: t.y, z: t.z, r: 4 });
          ctx.hurtEntity(m.target, SAM.missileDamage, act.owner);
          ctx.removeEntity(m.ent.id);
          missiles.splice(i, 1);
          continue;
        }
        m.ent.x += (dx / d) * step;
        m.ent.y += (dy / d) * step;
        m.ent.z += (dz / d) * step;
        m.ent.yaw = Math.atan2(-dx, -dz);
      }
      return alive || missiles.length > 0;
    },
  };
  ctx.add(act);
  ctx.damageable(ent, { hp: def.hp ?? 450, air: false, radius: 0.9, yOff: 0.8, active: act, score: 100 });
  return null;
}
