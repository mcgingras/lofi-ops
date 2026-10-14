/**
 * The RC-XD, driven by its caller. While driving, the caller's body stands still (speed 0, no
 * sprint, weapon down) and can be killed, which ends it. A little car using the shared player
 * movement (`stepMove`, so it collides and climbs steps like a player) steered by the caller's
 * movement keys and view yaw. FIRE (or STREAK) detonates; the fuse runs out after 30 s. Bullets
 * destroy it (harmlessly). Bots drive it toward the nearest enemy (skill-dependent).
 * Valkyrie Rockets live in valkyrie.ts.
 */
import { KILLSTREAK_BY_ID, KS_ENTITY } from '../../../../shared/defs/killstreaks';
import { Buttons } from '../../../../shared/input';
import { viewDir, type Vec3 } from '../../../../shared/math';
import { createMoveState, DEFAULT_MOVE_PARAMS, stepMove } from '../../../../shared/movement';
import type { PlayerState } from '../../../player';
import { botStreakSkill } from '../skill';
import { ksOf, markDirty } from '../state';
import type { Active, KsRoom } from '../world';
import type { CallArgs } from './types';

export const RCXD = { speed: 1.6, blast: { r: 6, max: 260, min: 60 }, botDetonate: 2.6 };

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
  const params = { ...DEFAULT_MOVE_PARAMS, speed: RCXD.speed, canSprint: false, adsTime: 1, canMantle: false, canProne: false };
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
