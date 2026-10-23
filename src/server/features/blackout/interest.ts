/**
 * Interest management for 100 players: a viewer's snapshot carries only the players within
 * `BLACKOUT.interest.playerRadius` and the entities within `entityRadius` of where they look from
 * (their body, or the player they spectate after death), plus themselves and the plane. The alive
 * count and the circle go out in `blackout.state`, not in snapshots.
 */
import { BLACKOUT } from '../../../shared/defs/blackout';
import type { EntitySnap, PlayerSnap } from '../../../shared/protocol';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import type { BlackoutGame } from './game';

/** Where `viewer` sees the world from: themselves, or the player they watch. */
export function focusOf(room: Room, viewer: PlayerState): { x: number; z: number } {
  const w = !viewer.alive ? viewer.ext.blackout?.watching : null;
  const q = w ? room.players.get(w) : null;
  const m = (q ?? viewer).move;
  return { x: m.x, z: m.z };
}

export function interestFor(game: BlackoutGame): NonNullable<Room['interest']> {
  const I = BLACKOUT.interest;
  const always = new Set(I.alwaysKinds);
  const never = new Set(I.neverKinds);
  return {
    players(viewer, all) {
      const room = game.room;
      if (room.mode.id !== 'blackout') return all;
      const f = focusOf(room, viewer);
      const r2 = I.playerRadius * I.playerRadius;
      const out: PlayerSnap[] = [];
      const near: [number, PlayerSnap][] = [];
      for (const s of all) {
        if (s.id === viewer.id) {
          out.push(s);
          continue;
        }
        const dx = s.x - f.x;
        const dz = s.z - f.z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= r2) near.push([d2, s]);
      }
      if (near.length > I.maxPlayers) near.sort((a, b) => a[0] - b[0]).length = I.maxPlayers;
      for (const [, s] of near) out.push(s);
      return out;
    },
    ents(viewer, all) {
      const room = game.room;
      if (room.mode.id !== 'blackout') return all;
      const f = focusOf(room, viewer);
      const r2 = I.entityRadius * I.entityRadius;
      const out: EntitySnap[] = [];
      for (const e of all) {
        if (never.has(e.kind)) continue;
        if (always.has(e.kind) || e.owner === viewer.id) {
          out.push(e);
          continue;
        }
        const dx = e.x - f.x;
        const dz = e.z - f.z;
        if (dx * dx + dz * dz <= r2) out.push(e);
      }
      return out;
    },
    shots(viewer, all) {
      const room = game.room;
      if (room.mode.id !== 'blackout') return all;
      const f = focusOf(room, viewer);
      const r2 = I.playerRadius * I.playerRadius;
      return all.filter((s) => (s.o[0] - f.x) ** 2 + (s.o[2] - f.z) ** 2 <= r2);
    },
  };
}
