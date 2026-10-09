/** Lobby manager rules driven directly (no sockets): matchmaking, wait -> bots, vote, host, codes. */
import { afterEach, describe, expect, it } from 'vitest';
import { createFrontendFeature, LobbyManager } from '../src/server/features/frontend/index';
import { Lobby } from '../src/server/lobby';
import type { Room } from '../src/server/room';
import { RpcRegistry } from '../src/server/rpc';
import { Session } from '../src/server/session';
import { Store } from '../src/server/store';
import { TICK_DT } from '../src/shared/constants';
import { MATCHMAKING_WAIT_SEC } from '../src/shared/defs/bots';
import { newProfile } from '../src/shared/profile';
import { RANDOM_MAP } from '../src/shared/frontend/lobby';

let store: Store | undefined;
let lobby: Lobby | undefined;
let sid = 0;

function setup(timings = {}, rpc?: RpcRegistry) {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: [createFrontendFeature()], log: () => {}, autoTick: false });
  const m = new LobbyManager({ lobby, rpc, rand: () => 0 }, timings);
  return { lobby, m };
}

const session = (name = `P${++sid}`) => new Session(`s${++sid}`, null, newProfile(`prof-${sid}`, name), `tok${sid}`);
const steps = (room: Room, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) room.step();
};

afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = undefined;
  store = undefined;
});

describe('matchmaking', () => {
  it('puts players of a playlist in the same lobby and opens a new one per playlist', () => {
    const { lobby, m } = setup();
    const a = session();
    const b = session();
    const c = session();
    const la = m.matchmake(a, 'tdm');
    lobby.join(a, la.room.id);
    const lb = m.matchmake(b, 'tdm');
    expect(lb).toBe(la);
    const lc = m.matchmake(c, 'ffa');
    expect(lc).not.toBe(la);
    expect(lc.room.mode.id).toBe('ffa');
    expect(la.room.phase).toBe('lobby');
    expect(la.room.options.private).toBe(false);
    expect(() => m.matchmake(a, 'nope')).toThrow(/unknown playlist/);
    // Playlists turn on once their mode is in MODE_BY_ID (DOM is merged now).
    const ld = m.matchmake(a, 'dom');
    expect(ld).not.toBe(la);
    expect(ld.room.mode.id).toBe('dom');
  });

  it('reservations hold slots so a full lobby is not handed out twice', () => {
    const { m } = setup();
    const first = session();
    const l = m.matchmake(first, 'ffa');
    l.room.options.maxPlayers = 2;
    const second = session();
    expect(m.matchmake(second, 'ffa')).toBe(l); // one slot left for `second`
    const third = session();
    expect(m.matchmake(third, 'ffa')).not.toBe(l); // both slots reserved
  });

  it(`waits ${MATCHMAKING_WAIT_SEC} s for humans, then starts with bots up to the target`, () => {
    const { lobby, m } = setup();
    const a = session();
    const l = m.matchmake(a, 'tdm');
    const room = l.room;
    lobby.join(a, room.id);
    steps(room, 1);
    expect(l.waitEndsAt).not.toBeNull();
    expect(m.state(l).botsToFill).toBe(11);
    steps(room, MATCHMAKING_WAIT_SEC - 2);
    expect(room.phase).toBe('lobby');
    expect(room.bots()).toHaveLength(0);
    steps(room, 1.5);
    expect(room.phase).toBe('countdown');
    expect(room.players.size).toBe(12);
    expect(room.bots()).toHaveLength(11);
    // Teams balanced by core.
    const t0 = [...room.players.values()].filter((p) => p.team === 0).length;
    expect(t0).toBe(6);
  });

  it('everyone ready shortens the wait to the ready countdown', () => {
    const { lobby, m } = setup({ readyCountdownSec: 2 });
    const a = session();
    const l = m.matchmake(a, 'ffa');
    lobby.join(a, l.room.id);
    steps(l.room, 0.5);
    m.setReady(l.room, a.player, true);
    steps(l.room, 0.5);
    expect(l.countdownEndsAt).not.toBeNull();
    steps(l.room, 2.1);
    expect(l.room.phase).toBe('countdown');
    expect(l.room.players.size).toBe(8);
  });

  it('a human joining mid-match takes a bot slot; one leaving is replaced by a bot', () => {
    const { lobby, m } = setup({ waitSec: 1 });
    const a = session();
    const l = m.matchmake(a, 'tdm');
    lobby.join(a, l.room.id);
    steps(l.room, 2);
    expect(l.room.players.size).toBe(12);
    const b = session();
    expect(m.matchmake(b, 'tdm')).toBe(l); // in-progress lobby has room
    lobby.join(b, l.room.id);
    expect(l.room.players.size).toBe(12);
    expect(l.room.bots()).toHaveLength(10);
    lobby.leave(a);
    expect(l.room.players.size).toBe(12);
    expect(l.room.bots()).toHaveLength(11);
  });

  it('after the match it returns to the lobby: bots leave, a new vote and wait begin', () => {
    const { lobby, m } = setup({ waitSec: 1, postMatchSec: 1 });
    const a = session();
    const l = m.matchmake(a, 'ffa');
    lobby.join(a, l.room.id);
    steps(l.room, 2);
    expect(l.room.bots().length).toBeGreaterThan(0);
    l.room.endMatch('score');
    steps(l.room, 1.2);
    expect(l.room.phase).toBe('lobby');
    expect(l.room.bots()).toHaveLength(0);
    expect(l.voteOptions).not.toBeNull();
    steps(l.room, 0.5);
    expect(l.waitEndsAt).not.toBeNull();
  });
});

describe('map vote', () => {
  it('the winning option becomes the map at start', () => {
    const { lobby, m } = setup({ waitSec: 3 });
    const a = session();
    const b = session();
    const l = m.matchmake(a, 'tdm');
    lobby.join(a, l.room.id);
    lobby.join(b, l.room.id);
    const opts = l.voteOptions!;
    expect(opts).toHaveLength(3); // two TDM maps + random
    expect(opts[2]).toBe(RANDOM_MAP);
    expect(opts[0]).not.toBe(opts[1]);
    m.vote(l.room, a.player, 1);
    m.vote(l.room, b.player, 1);
    m.vote(l.room, b.player, 0); // changed mind: tie 1-1 -> first option
    expect(m.state(l).vote!.counts).toEqual([1, 1, 0]);
    expect(() => m.vote(l.room, a.player, 7)).toThrow(/bad option/);
    steps(l.room, 4);
    expect(l.room.phase).toBe('countdown');
    expect(l.room.mapId).toBe(opts[0]);
    expect(l.voteOptions).toBeNull();
  });
});

describe('private lobbies', () => {
  it('codes resolve, the creator hosts, host migrates on leave', () => {
    const { lobby, m } = setup();
    const host = session('Host');
    const guest = session('Guest');
    const l = m.createPrivate(host, { mode: 'ffa' });
    expect(m.byCode(l.code.toLowerCase())).toBe(l);
    expect(m.byCode(`https://x/#/lobby?code=${l.code}`)).toBe(l);
    expect(m.byCode('ZZZZZZ')).toBeUndefined();
    lobby.join(guest, l.room.id); // guest first: temporary host
    expect(l.hostId).toBe(guest.player!.id);
    lobby.join(host, l.room.id); // the creator takes host
    expect(l.hostId).toBe(host.player!.id);
    expect(() => m.start(l.room, guest.player)).toThrow(/host/);
    const hostId = host.player!.id;
    lobby.leave(host);
    expect(l.hostId).toBe(guest.player!.id);
    expect(l.hostId).not.toBe(hostId);
    expect(l.room.options.private).toBe(true);
    expect(lobby.list().find((r) => r.id === l.room.id)).toBeUndefined();
  });

  it('host edits mode, limits and bot settings; start backfills with the tuned bots', () => {
    const calls: unknown[] = [];
    const rpc = new RpcRegistry();
    rpc.handle('bots.setSettings' as never, (_ctx, data) => {
      calls.push(data);
      return {} as never;
    });
    const { lobby, m } = setup({ soloCountdownSec: 1 }, rpc);
    const host = session('Host');
    const l = m.createPrivate(host, { mode: 'tdm', bots: true });
    lobby.join(host, l.room.id);
    const events: unknown[] = [];
    l.room.bus.on('frontend.botSettings', (e) => events.push(e));
    const st = m.configure(l.room, host.player, {
      mode: 'ffa',
      limits: { scoreLimit: 10, timeLimitSec: 120 },
      bots: { difficulty: 'custom', targetPlayers: 5, variance: 0.3, custom: { reactionMs: 200, aimErrorDeg: 1 } },
    });
    expect(st.mode).toBe('ffa');
    expect(st.maxPlayers).toBe(8);
    expect(st.limits).toEqual({ scoreLimit: 10, timeLimitSec: 120 });
    expect(st.bots).toMatchObject({ difficulty: 'custom', targetPlayers: 5, variance: 0.3 });
    expect(st.bots.custom!.reactionMs).toBe(200);
    expect(st.botsToFill).toBe(4);
    expect(() => m.configure(l.room, host.player, { map: 'nowhere' })).toThrow(/map/);
    expect(() => m.configure(l.room, host.player, { mode: 'nope' })).toThrow(/mode/);
    m.start(l.room, host.player);
    steps(l.room, 1.2);
    expect(l.room.phase).toBe('countdown');
    expect(l.room.mode.scoreLimit).toBe(10);
    expect(l.room.mode.timeLimitSec).toBe(120);
    expect(l.room.bots()).toHaveLength(4);
    expect(l.room.options.botFill).toBe(5);
    // Handed over to the bots feature both ways.
    expect(calls.at(-1)).toMatchObject({ roomId: l.room.id, settings: { difficulty: 'custom', targetPlayers: 5 } });
    expect(events.at(-1)).toMatchObject({ starting: true, skill: { reactionMs: 200, aimErrorDeg: 1 } });
    expect(() => m.configure(l.room, host.player, { bots: { fill: false } })).toThrow(/started/);
  });

  it('host rule: aim assist allowed (on by default, host toggles it, validated)', () => {
    const { lobby, m } = setup({});
    const host = session('Host');
    const l = m.createPrivate(host, {});
    lobby.join(host, l.room.id);
    expect(m.state(l).aimAssist).toBe(true);
    expect(m.configure(l.room, host.player, { aimAssist: false }).aimAssist).toBe(false);
    expect(() => m.configure(l.room, host.player, { aimAssist: 'no' as unknown as boolean })).toThrow(/boolean/);
    expect(m.configure(l.room, host.player, { aimAssist: true }).aimAssist).toBe(true);
    const guest = session('Guest');
    lobby.join(guest, l.room.id);
    expect(() => m.configure(l.room, guest.player, { aimAssist: false })).toThrow(/host/);
  });

  it('fill off: the match starts with humans only', () => {
    const { lobby, m } = setup({ soloCountdownSec: 0.5 });
    const host = session();
    const l = m.createPrivate(host, {});
    lobby.join(host, l.room.id);
    m.configure(l.room, host.player, { bots: { fill: false } });
    m.start(l.room, host.player);
    steps(l.room, 1);
    expect(l.room.phase).toBe('countdown');
    expect(l.room.bots()).toHaveLength(0);
  });

  it('codes are forgotten when the room closes', () => {
    const { lobby, m } = setup();
    const host = session();
    const l = m.createPrivate(host, {});
    lobby.join(host, l.room.id);
    lobby.leave(host);
    steps(l.room, 6);
    expect(l.room.closed).toBe(true);
    expect(m.byCode(l.code)).toBeUndefined();
    expect(m.get(l.room.id)).toBeUndefined();
  });
});
