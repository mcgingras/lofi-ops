/**
 * The streaks the caller drives: RC-XD and Valkyrie Rockets. While driving, the caller's body
 * stands still (speed 0, no sprint, weapon down) and can be killed, which ends it.
 * - RC-XD: a little car using the shared player movement (`stepMove`, so it collides and climbs
 *   steps like a player) steered by the caller's movement keys and view yaw. FIRE (or STREAK)
 *   detonates; the fuse runs out after 30 s. Bullets destroy it (harmlessly).
 * - Valkyrie Rockets (simplified): two rockets fired one after the other, each steered by the
 *   caller's view; it blows up on impact, near an enemy, on FIRE, or after its fuse.
 * Bots drive both toward the nearest enemy (skill-dependent).
 */
import { KILLSTREAK_BY_ID, KS_ENTITY } from '../../../../shared/defs/killstreaks';
import { Buttons } from '../../../../shared/input';
import { viewDir, type Vec3 } from '../../../../shared/math';
import { createMoveState, DEFAULT_MOVE_PARAMS, stepMove } from '../../../../shared/movement';
import type { Entity } from '../../../entities';
import type { PlayerState } from '../../../player';
import { botStreakSkill } from '../skill';
import { ksOf, markDirty } from '../state';
import { chestOf, type Active, type KsRoom } from '../world';
import type { CallArgs } from './types';

export const RCXD = { speed: 1.6, blast: { r: 6, max: 260, min: 60 }, botDetonate: 2.6 };
export const VALKYRIE = { speed: 22, turn: 2.6, fuse: 12, rockets: 2, gap: 0.8, proximity: 1.6, blast: { r: 7.5, max: 260, min: 60 } };

const MOVE_BITS = Buttons.FORWARD | Buttons.BACK | Buttons.LEFT | Buttons.RIGHT | Buttons.JUMP;

function nearestEnemy(ctx: KsRoom, owner: PlayerState, from: Vec3, kind: string): PlayerState | null {
  return ctx.targetsFor(owner, kind, from, 400, false)[0] ?? null;
}

export function callRcxd(ctx: KsRoom, p: PlayerState, _args: CallArgs): string | null {
  const room = ctx.room;
  const def = KILLSTREAK_BY_ID.get('rcxd')!;
  const d = viewDir(p.yaw, 0);
  let sx = p.move.x + d.x * 1.2;
  let sz = p.move.z + d.z * 1.2;
  if (!room.world.free(sx, p.move.y + 0.05, sz)) {
    sx = p.move.x;
    sz = p.move.z;
  }
  const car = createMoveState(sx, p.move.y, sz);
  car.onGround = true;
  const ent = room.entities.add({ kind: KS_ENTITY.rcxd, x: car.x, y: car.y, z: car.z, yaw: p.yaw, owner: p.id, team: p.team });
  const until = room.time + (def.durationSec ?? 30);
  const ks = ksOf(p);
  ks.control = { id: 'rcxd', entity: ent.id, until };
  markDirty(room, p);
  let prevButtons = p.buttons;
  let boom = false;
  const params = { ...DEFAULT_MOVE_PARAMS, speed: RCXD.speed, canSprint: false, adsTime: 1 };
  const act: Active = {
    streak: 'rcxd',
    owner: p,
    entities: [ent.id],
    update(dt) {
      if (!room.entities.get(ent.id) || !p.alive || room.players.get(p.id) !== p) return false;
      let buttons = 0;
      let yaw = p.yaw;
      let detonate = false;
      if (p.isBot) {
        const t = nearestEnemy(ctx, p, car, KS_ENTITY.rcxd);
        if (t) {
          const skill = botStreakSkill(p);
          yaw = Math.atan2(-(t.move.x - car.x), -(t.move.z - car.z)) + (Math.random() - 0.5) * (1 - skill) * 0.6;
          buttons = Buttons.FORWARD;
          if (Math.hypot(t.move.x - car.x, t.move.z - car.z) < RCXD.botDetonate + (1 - skill)) detonate = true;
        }
      } else {
        buttons = p.buttons & MOVE_BITS;
        const pressed = p.buttons & ~prevButtons;
        if (pressed & (Buttons.FIRE | Buttons.STREAK)) detonate = true;
      }
      prevButtons = p.buttons;
      stepMove(room.world, car, buttons, yaw, dt, params);
      ent.x = car.x;
      ent.y = car.y;
      ent.z = car.z;
      ent.yaw = yaw;
      const b = room.map.bounds;
      if (car.y < b.min.y - 5) return false;
      if (detonate || room.time >= until) {
        boom = true;
        return false;
      }
      return true;
    },
    cleanup() {
      if (boom) ctx.blast({ x: car.x, y: car.y + 0.2, z: car.z }, RCXD.blast.r, RCXD.blast.max, RCXD.blast.min, p, 'rcxd');
      if (ks.control?.entity === ent.id) {
        ks.control = null;
        markDirty(room, p);
      }
    },
  };
  ctx.add(act);
  ctx.damageable(ent, {
    hp: def.hp ?? 40,
    air: false,
    radius: 0.6,
    yOff: 0.25,
    active: act,
    score: 50,
    onDestroyed(by) {
      act.destroyed = true;
      act.destroyedBy = by;
      act.done = true;
    },
  });
  return null;
}

export function callValkyrie(ctx: KsRoom, p: PlayerState, _args: CallArgs): string | null {
  const room = ctx.room;
  const ks = ksOf(p);
  let left = VALKYRIE.rockets;
  let rocket: { ent: Entity; dir: Vec3; fuse: number } | null = null;
  let nextLaunch = room.time;
  let prevButtons = p.buttons;
  let lastEnt = 0;
  const launch = () => {
    left--;
    const eye = { x: p.move.x, y: p.move.y + 2.2, z: p.move.z };
    const dir = viewDir(p.yaw, Math.max(0.15, p.pitch));
    const ent = room.entities.add({ kind: KS_ENTITY.rocket, x: eye.x + dir.x, y: eye.y + dir.y, z: eye.z + dir.z, yaw: p.yaw, owner: p.id, team: p.team, s: { p: Math.round(Math.asin(dir.y) * 100) / 100 } });
    act.entities.push(ent.id);
    lastEnt = ent.id;
    rocket = { ent, dir, fuse: VALKYRIE.fuse };
    ks.control = { id: 'valkyrie', entity: ent.id, until: room.time + VALKYRIE.fuse };
    markDirty(room, p);
  };
  const explode = (at: Vec3) => {
    if (!rocket) return;
    ctx.removeEntity(rocket.ent.id);
    rocket = null;
    ctx.blast(at, VALKYRIE.blast.r, VALKYRIE.blast.max, VALKYRIE.blast.min, p, 'valkyrie');
    nextLaunch = room.time + VALKYRIE.gap;
  };
  const act: Active = {
    streak: 'valkyrie',
    owner: p,
    entities: [],
    update(dt) {
      if (!p.alive || room.players.get(p.id) !== p) {
        if (rocket) explode({ x: rocket.ent.x, y: rocket.ent.y, z: rocket.ent.z });
        return false;
      }
      const pressed = p.buttons & ~prevButtons;
      prevButtons = p.buttons;
      if (!rocket) {
        if (left <= 0) return false;
        if (room.time >= nextLaunch) launch();
        return true;
      }
      const r = rocket as { ent: Entity; dir: Vec3; fuse: number };
      // Steer toward where the caller looks (bots: toward the nearest enemy).
      let want = viewDir(p.yaw, p.pitch);
      if (p.isBot) {
        const t = nearestEnemy(ctx, p, r.ent, KS_ENTITY.rocket);
        if (t) {
          const c = chestOf(t);
          const v = { x: c.x - r.ent.x, y: c.y - r.ent.y, z: c.z - r.ent.z };
          const l = Math.hypot(v.x, v.y, v.z) || 1;
          const err = (1 - botStreakSkill(p)) * 0.25;
          want = { x: v.x / l + (Math.random() - 0.5) * err, y: v.y / l, z: v.z / l + (Math.random() - 0.5) * err };
        }
      }
      r.dir = steer(r.dir, want, VALKYRIE.turn * dt);
      const step = VALKYRIE.speed * dt;
      const hit = room.world.raycast(r.ent, r.dir, step, 'bullets');
      if (hit) {
        explode(hit.point);
        return true;
      }
      r.ent.x += r.dir.x * step;
      r.ent.y += r.dir.y * step;
      r.ent.z += r.dir.z * step;
      r.ent.yaw = Math.atan2(-r.dir.x, -r.dir.z);
      r.ent.s = { p: Math.round(Math.asin(Math.max(-1, Math.min(1, r.dir.y))) * 100) / 100 };
      r.fuse -= dt;
      const near = ctx.targetsFor(p, KS_ENTITY.rocket, r.ent, VALKYRIE.proximity, false).length > 0;
      const b = room.map.bounds;
      const out = r.ent.y < b.min.y - 2 || r.ent.x < b.min.x - 30 || r.ent.x > b.max.x + 30 || r.ent.z < b.min.z - 30 || r.ent.z > b.max.z + 30;
      if (near || r.fuse <= 0 || out || (!p.isBot && pressed & Buttons.FIRE)) explode({ x: r.ent.x, y: r.ent.y, z: r.ent.z });
      return true;
    },
    cleanup() {
      if (ks.control && ks.control.entity === lastEnt) {
        ks.control = null;
        markDirty(room, p);
      }
    },
  };
  ctx.add(act);
  launch();
  return null;
}

function steer(cur: Vec3, want: Vec3, maxAngle: number): Vec3 {
  const wl = Math.hypot(want.x, want.y, want.z) || 1;
  const w = { x: want.x / wl, y: want.y / wl, z: want.z / wl };
  const dot = Math.max(-1, Math.min(1, cur.x * w.x + cur.y * w.y + cur.z * w.z));
  const ang = Math.acos(dot);
  if (ang <= maxAngle || ang < 1e-5) return w;
  const t = maxAngle / ang;
  const v = { x: cur.x + (w.x - cur.x) * t, y: cur.y + (w.y - cur.y) * t, z: cur.z + (w.z - cur.z) * t };
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
