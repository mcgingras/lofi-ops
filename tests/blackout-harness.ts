/**
 * Shared harness for Blackout tests and the benchmark (scripts/blackout-bench.ts): a Lobby with
 * every server feature, a Blackout room filled to 100 (bots plus optional fake humans whose
 * sockets only count bytes), stepped by hand.
 */
import { FEATURES } from '../src/server/features/index';
import { blackoutGameOf, registerBlackout } from '../src/server/features/blackout/index';
import { registerModeRules } from '../src/server/features/modes/index';
import type { BlackoutGame } from '../src/server/features/blackout/game';
import { Lobby } from '../src/server/lobby';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { Session } from '../src/server/session';
import { Store } from '../src/server/store';
import { newProfile } from '../src/shared/profile';

export interface FakeSocket {
  readyState: number;
  bufferedAmount: number;
  bytes: number;
  snaps: number;
  snapBytes: number;
  msgs: string[];
  keep: boolean;
  send(data: string | Buffer): void;
  close(): void;
}

export function fakeSocket(keep = false): FakeSocket {
  return {
    readyState: 1,
    bufferedAmount: 0,
    bytes: 0,
    snaps: 0,
    snapBytes: 0,
    msgs: [],
    keep,
    send(data) {
      const s = typeof data === 'string' ? data : data.toString();
      this.bytes += s.length;
      if (s.startsWith('{"t":"snap"')) {
        this.snaps++;
        this.snapBytes += s.length;
      }
      if (this.keep) this.msgs.push(s);
    },
    close() {
      this.readyState = 3;
    },
  };
}

export interface BlackoutHarness {
  lobby: Lobby;
  store: Store;
  room: Room;
  game: BlackoutGame;
  humans: { player: PlayerState; socket: FakeSocket; session: Session }[];
  close(): void;
}

/** A Blackout room with `humans` fake humans and bots up to `players`, match started (seeded). */
export function blackoutRoom(o: { humans?: number; players?: number; seed?: number; keepMsgs?: boolean; start?: boolean } = {}): BlackoutHarness {
  registerModeRules();
  registerBlackout();
  const store = new Store(':memory:');
  const lobby = new Lobby({ store, features: FEATURES, log: () => {}, autoTick: false });
  const room = lobby.createRoom({ mode: 'blackout', map: 'blackout', autoStart: false, closeWhenEmpty: false, botFill: o.players ?? 100, persist: false, postMatchSec: 5 });
  const game = blackoutGameOf(room)!;
  if (o.seed !== undefined) game.opts.seed = o.seed;
  const humans: BlackoutHarness['humans'] = [];
  for (let i = 0; i < (o.humans ?? 0); i++) {
    const socket = fakeSocket(o.keepMsgs);
    const session = new Session(`h${i}`, socket as never, newProfile(`p${i}`, `Human${i}`), `t${i}`);
    const player = room.addHuman(session);
    humans.push({ player, socket, session });
  }
  room.fillBots();
  if (o.start !== false) room.startMatch();
  return {
    lobby,
    store,
    room,
    game,
    humans,
    close() {
      lobby.shutdown();
      store.close();
    },
  };
}

/** Step `n` ticks; returns per-tick wall times (ms). */
export function stepTimed(room: Room, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    room.step();
    out.push(performance.now() - t0);
  }
  return out;
}

export function stats(ms: number[]): { avg: number; p50: number; p95: number; p99: number; max: number } {
  const s = [...ms].sort((a, b) => a - b);
  const q = (k: number) => s[Math.min(s.length - 1, Math.floor(k * s.length))] ?? 0;
  return { avg: ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[s.length - 1] ?? 0 };
}
