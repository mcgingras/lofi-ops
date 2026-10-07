/**
 * Mortar Team: three spots chosen on the tactical map, two rounds on each a moment apart (BO1:
 * explosions about seven metres across, `STRIKE.mortar`). Each spot shows a ring to
 * everyone (`ks_mark` entity with the landing time) so whoever is under it can move. Shells land on
 * the first thing above the spot (a roof takes it). Pattern after Blockyard's Mortar Team (MIT).
 */
import { KS_ENTITY } from '../../../../shared/defs/killstreaks';
import { STRIKE } from '../../../../shared/defs/tactical-map';
import type { Vec3 } from '../../../../shared/math';
import type { PlayerState } from '../../../player';
import type { Active, KsRoom } from '../world';
import type { CallArgs } from './types';

export const MORTAR = { first: 3, apart: 0.7, perMark: 2, second: 0.45, spread: STRIKE.mortar.spread, blast: { r: STRIKE.mortar.blastR, max: 220, min: 60 } };

export function callMortar(ctx: KsRoom, p: PlayerState, args: CallArgs): string | null {
  const room = ctx.room;
  const marks = args.targets.length ? args.targets : args.target ? [args.target] : [];
  if (!marks.length) return 'no_target';
  const shells: { at: Vec3; lands: number; mark: number; last: boolean }[] = [];
  const act: Active = { streak: 'mortar', owner: p, entities: [], update: () => false };
  marks.slice(0, 3).forEach((m, i) => {
    const lands = room.time + MORTAR.first + i * MORTAR.apart;
    const y = ctx.groundAt(m.x, m.z);
    const mark = room.entities.add({ kind: KS_ENTITY.mortarMark, x: m.x, y, z: m.z, yaw: 0, owner: p.id, team: p.team, s: { t: Math.round(lands * 100) / 100 } });
    act.entities.push(mark.id);
    for (let k = 0; k < MORTAR.perMark; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = k === 0 ? Math.random() * 0.8 : MORTAR.spread * (0.5 + Math.random() * 0.5);
      const x = m.x + Math.cos(a) * r;
      const z = m.z + Math.sin(a) * r;
      shells.push({ at: { x, y: ctx.groundAt(x, z), z }, lands: lands + k * MORTAR.second, mark: mark.id, last: k === MORTAR.perMark - 1 });
    }
  });
  act.update = () => {
    for (let i = shells.length - 1; i >= 0; i--) {
      const s = shells[i]!;
      if (room.time < s.lands) continue;
      shells.splice(i, 1);
      ctx.blast(s.at, MORTAR.blast.r, MORTAR.blast.max, MORTAR.blast.min, p, 'mortar');
      if (s.last) ctx.removeEntity(s.mark);
    }
    return shells.length > 0;
  };
  ctx.add(act);
  return null;
}
