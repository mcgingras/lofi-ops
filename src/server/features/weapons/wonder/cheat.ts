/**
 * Dev only (LOFI_CHEATS=1, browser checks): `weapons.wonderCheat` puts a wonder weapon in your
 * hands, stands a still enemy dummy in front of you, and frosts / freezes / shrinks / swells you
 * or the dummy, so the effects can be looked at without a match's worth of setup.
 */
import { isWonderWeapon } from '../../../../shared/defs/weapons';
import { RpcError } from '../../../rpc';
import type { ServerApi } from '../../../feature';
import { makeWeapon, type PlayerState } from '../../../player';
import type { Room } from '../../../room';
import { shrinkHit } from './babygun';
import { wonderOf } from './common';
import { swell } from './wavegun';
import { syncFrostEntity } from './wintershowl';

interface CheatReq {
  give?: string;
  /** Metres ahead to stand a still enemy dummy. */
  dummy?: number;
  effect?: 'frost' | 'frozen' | 'thaw' | 'shrink' | 'swell';
  on?: 'me' | 'dummy';
}

declare module '../../../../shared/protocol' {
  interface RpcMap {
    'weapons.wonderCheat': { req: CheatReq; res: { ok: boolean } };
  }
}

const dummies = new WeakMap<Room, PlayerState>();

function affect(room: Room, q: PlayerState, by: PlayerState, effect: CheatReq['effect']): void {
  const w = wonderOf(q);
  if (effect === 'frost' || effect === 'frozen' || effect === 'thaw') {
    w.frost = effect === 'frozen' ? 1 : effect === 'thaw' ? 0 : 0.6;
    w.frostAt = room.time + 30;
    w.frozenUntil = effect === 'frozen' ? room.time + 30 : 0;
    syncFrostEntity(room, q);
  } else if (effect === 'shrink') shrinkHit(room, q, by, q.move);
  else if (effect === 'swell') swell(room, q, by);
}

export function registerWonderCheat(api: ServerApi): void {
  if (process.env.LOFI_CHEATS !== '1') return;
  api.rpc.handle('weapons.wonderCheat', (ctx, data) => {
    const p = ctx.player;
    const room = ctx.room;
    if (!p || !room) throw new RpcError('not_in_match');
    const d = (data ?? {}) as CheatReq;
    if (typeof d.give === 'string' && isWonderWeapon(d.give)) {
      const w = makeWeapon({ weapon: d.give, attachments: [], camo: 'none' }, d.give);
      w.creditTime = room.time;
      p.weapons[0] = w;
      p.slot = 0;
      p.swapEnd = room.time + 0.3;
      p.reloadEnd = 0;
      room.sendFeature(p, 'killstreaks.wonderLoan', { w: d.give, until: room.time + 60 });
    }
    if (typeof d.dummy === 'number') {
      let q = dummies.get(room);
      if (!q || !room.players.has(q.id)) {
        q = room.addBot({ name: 'Dummy', team: room.mode.teams ? (p.team === 0 ? 1 : 0) : null });
        q.brain = { think: (_r, self) => ({ buttons: 0, yaw: self.yaw, pitch: 0, weaponSlot: 0 }) };
        dummies.set(room, q);
      }
      if (!q.alive) room.spawn(q);
      const fx = -Math.sin(p.yaw);
      const fz = -Math.cos(p.yaw);
      q.move = { ...q.move, x: p.move.x + fx * d.dummy, y: p.move.y, z: p.move.z + fz * d.dummy, vx: 0, vy: 0, vz: 0 };
      q.yaw = p.yaw + Math.PI;
    }
    if (d.effect) {
      const target = d.on === 'dummy' ? dummies.get(room) : p;
      if (target?.alive) affect(room, target, p, d.effect);
    }
    return { ok: true };
  });
}
