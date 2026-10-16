/** Shared rig for the perks / killstreaks rule tests: a Yard TDM room driven tick by tick. */
import perks from '../src/server/features/perks/index';
import killstreaks from '../src/server/features/killstreaks/index';
import type { Feature } from '../src/server/feature';
import { Lobby } from '../src/server/lobby';
import type { PlayerState } from '../src/server/player';
import type { Room, RoomOptions } from '../src/server/room';
import { Store } from '../src/server/store';
import { PLAYER, TICK_DT, type Team } from '../src/shared/constants';
import { cloneLoadout, DEFAULT_LOADOUTS, type Loadout } from '../src/shared/loadout';
import { createMoveState } from '../src/shared/movement';
import { newProfile } from '../src/shared/profile';
import { ksOf } from '../src/server/features/killstreaks/state';

export interface Rig {
  room: Room;
  lobby: Lobby;
  store: Store;
  close(): void;
}

/** `extra` adds features to perks + killstreaks (e.g. weapons, which reads most perk modifiers). */
export function rig(opts: Partial<RoomOptions> = {}, extra: Feature[] = []): Rig {
  const store = new Store(':memory:');
  const lobby = new Lobby({ store, features: [perks, killstreaks, ...extra], log: () => {}, autoTick: false });
  const room = lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, ...opts });
  return {
    room,
    lobby,
    store,
    close() {
      lobby.shutdown();
      store.close();
    },
  };
}

export function loadout(perksList: string[] = [], streaks: string[] = []): Loadout {
  return { ...cloneLoadout(DEFAULT_LOADOUTS[0]!), perks: perksList, killstreaks: streaks };
}

/** A bot with a loadout, spawned, standing still, never calling streaks on its own. */
export function bot(room: Room, team: Team, perksList: string[] = [], streaks: string[] = [], name?: string): PlayerState {
  const p = room.addBot({ name, team, loadout: loadout(perksList, streaks) });
  ksOf(p).manual = true;
  if (!p.alive) room.spawn(p);
  return p;
}

export const place = (p: PlayerState, x: number, z: number, y = 0) => {
  p.move = { ...createMoveState(x, y, z), onGround: true };
};

export const steps = (room: Room, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) room.step();
};

/** Step until `cond` or the time runs out; returns seconds taken (or Infinity). */
export function until(room: Room, cond: () => boolean, maxSec = 10): number {
  const n = Math.round(maxSec / TICK_DT);
  for (let i = 0; i < n; i++) {
    if (cond()) return i * TICK_DT;
    room.step();
  }
  return cond() ? maxSec : Infinity;
}

/** Make a bot pose as a human with a profile (Pro challenges need one). */
export function withProfile(p: PlayerState): PlayerState {
  p.profile = newProfile(`prof-${p.id}`, p.name);
  p.isBot = false;
  return p;
}

/** Aim direction from a's eye at b's chest. */
export const aim = (a: PlayerState, b: { x: number; y: number; z: number }, y = 1.2) => {
  const d = { x: b.x - a.move.x, y: b.y + y - (a.move.y + PLAYER.eye), z: b.z - a.move.z };
  const l = Math.hypot(d.x, d.y, d.z);
  return { x: d.x / l, y: d.y / l, z: d.z / l };
};

/** Kill `victim` as `attacker` with a gun. */
export function gunKill(room: Room, attacker: PlayerState, victim: PlayerState) {
  room.kill(victim, attacker, { weapon: 'ak47', means: 'bullet', part: 'torso' });
}

/** Give a ready streak. */
export function give(p: PlayerState, id: string) {
  ksOf(p).ready.push(id);
}

const seqs = new WeakMap<PlayerState, number>();
/** Feed one input command to a (human-driven) player, as the network would. */
export function input(room: Room, p: PlayerState, buttons: number, yaw = p.yaw, pitch = p.pitch, weaponSlot = p.slot) {
  const seq = (seqs.get(p) ?? p.lastSeq) + 1;
  seqs.set(p, seq);
  room.queueInputs(p, [{ seq, dt: TICK_DT, buttons, yaw, pitch, weaponSlot }]);
}
