/**
 * Shared set-up for the Zombies room tests (tests/zombies.headshots.test.ts,
 * tests/zombies.ally.test.ts): a Lobby with the features Zombies leans on, rooms stepped tick by
 * tick (no sockets), and helpers to place, drive and arm players.
 */
import botsFeature from '../src/server/features/bots/index';
import perksFeature from '../src/server/features/perks/index';
import progressionFeature from '../src/server/features/progression/index';
import weaponsFeature from '../src/server/features/weapons/index';
import type { ZombiesGame } from '../src/server/features/zombies/game';
import { zombiesGameOf, ZombiesRules } from '../src/server/features/zombies/index';
import { registerMode } from '../src/server/modes/index';
import { Lobby } from '../src/server/lobby';
import { makeWeapon, type PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { Session } from '../src/server/session';
import { Store } from '../src/server/store';
import { TICK_DT } from '../src/shared/constants';
import { createMoveState } from '../src/shared/movement';
import { newProfile } from '../src/shared/profile';

export interface ZmWorld {
  store: Store;
  lobby: Lobby;
  room: Room;
  g: ZombiesGame;
}

let seq = 0;

export function zmRoom(map = 'nuketown'): ZmWorld {
  registerMode('zombies', () => new ZombiesRules());
  const store = new Store(':memory:');
  const lobby = new Lobby({ store, features: [weaponsFeature, perksFeature, progressionFeature, botsFeature], log: () => {}, autoTick: false });
  const room = lobby.createRoom({ mode: 'zombies', map, closeWhenEmpty: false });
  return {
    store,
    lobby,
    room,
    get g() {
      return zombiesGameOf(room)!;
    },
  };
}

export function zmClose(w: ZmWorld | undefined): void {
  w?.lobby.shutdown();
  w?.store.close();
}

export const steps = (room: Room, seconds: number, each?: () => void): void => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) {
    each?.();
    room.step();
  }
};

/** Step until `cond` holds (or `max` seconds pass); returns the seconds it took, or null. */
export function stepUntil(room: Room, max: number, cond: () => boolean, each?: () => void): number | null {
  const n = Math.round(max / TICK_DT);
  for (let i = 0; i < n; i++) {
    if (cond()) return i * TICK_DT;
    each?.();
    room.step();
  }
  return cond() ? n * TICK_DT : null;
}

export function human(room: Room, name = `H${++seq}`): PlayerState {
  const s = new Session(`s${++seq}-${name}`, null, newProfile(`p-${name}-${seq}`, name), 'tok');
  return room.addHuman(s);
}

export function place(room: Room, p: PlayerState, x: number, z: number, yaw = p.yaw): void {
  const y = room.world.groundBelow(x, z, 3, 6) ?? 0;
  p.move = { ...createMoveState(x, y, z), onGround: true };
  p.yaw = yaw;
}

/** Keep a human's input flowing (core idles a human with no commands), holding `buttons`. */
const cmdSeq = new WeakMap<PlayerState, number>();
export function hold(room: Room, p: PlayerState, buttons: number, yaw = p.yaw, pitch = 0): void {
  const n = (cmdSeq.get(p) ?? p.lastSeq) + 1;
  cmdSeq.set(p, n);
  room.queueInputs(p, [{ seq: n, dt: TICK_DT, buttons, yaw, pitch, weaponSlot: p.slot }]);
}

/** Hand `p` a gun (full mag and reserve) in slot 0. */
export function arm(room: Room, p: PlayerState, id: string): void {
  const w = makeWeapon({ weapon: id, attachments: [], camo: 'none' }, id);
  p.weapons = [w];
  p.slot = 0;
  p.reloadEnd = 0;
  p.swapEnd = room.time;
}

/** Start the game with the survivors in (round 1 under way). */
export function startRound(w: ZmWorld): void {
  steps(w.room, 0.2);
  w.g.phaseEndsAt = w.room.time;
  steps(w.room, 0.1);
}
