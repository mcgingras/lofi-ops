/**
 * Wagers against bots: the house covers every bot's ante, the pot is ante x entrants, BO1's top-3
 * split by placement among everyone (a bot's share goes back to the house), solo forfeits, the
 * guard rails, 2-human behaviour with bots, and escrow recovery after a crash. Rooms are stepped by
 * hand (no timers); bot skill jitter is seeded.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { registerWeaponBehavior } from '../src/server/combat';
import economy, { wagersFor } from '../src/server/features/economy/index';
import { sanitizeBots } from '../src/server/features/economy/wager';
import type { Feature, ServerApi } from '../src/server/feature';
import { Lobby } from '../src/server/lobby';
import { registerMode } from '../src/server/modes/index';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { RpcRegistry } from '../src/server/rpc';
import { Session } from '../src/server/session';
import { Store } from '../src/server/store';
import { TICK_DT } from '../src/shared/constants';
import { ANTE_TIERS, EARN_CP_HINT, MIN_STAKE, opponentsLabel, paidPlaces, wagerPayouts, wagerPotPreview } from '../src/shared/defs/economy';
import type { EconomyResultsExt, EconomyState, WagerHud } from '../src/shared/defs/economy-net';
import { decodeServerMsg, type ServerMsg } from '../src/shared/protocol';

/** Deterministic PRNG (mulberry32) for bot skill jitter. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Human extends Session {
  log: ServerMsg[];
}
interface World {
  store: Store;
  lobby: Lobby;
  human: (name: string, cp?: number) => Human;
  call: (s: Session, id: string, data: unknown) => Promise<Record<string, unknown>>;
}

let cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup = [];
});

function world(opts: { dbPath?: string; features?: Feature[]; manage?: boolean } = {}): World {
  const store = new Store(opts.dbPath ?? ':memory:');
  const sessions: Session[] = [];
  const rpc = new RpcRegistry();
  const features = opts.features ?? [economy];
  const lobby = new Lobby({ store, features, log: () => {}, autoTick: false });
  const api: ServerApi = { lobby, store, rpc, registerMode, registerWeaponBehavior, sessions: () => sessions.values(), log: () => {} };
  for (const f of features) f.setup?.(api);
  if (opts.manage !== false)
    cleanup.push(() => {
      lobby.shutdown();
      store.close();
    });
  let n = 0;
  const human = (name: string, cp = 20000): Human => {
    const prof = store.authenticate(null, name).profile;
    prof.codPoints = cp;
    prof.name = name;
    store.save(prof);
    const log: ServerMsg[] = [];
    const ws = { readyState: 1, bufferedAmount: 0, send: (d: string) => { const m = decodeServerMsg(d); if (m && m.t !== 'snap') log.push(m); }, close() {} } as unknown as WebSocket;
    const s = new Session(`h${++n}`, ws, prof, `token-${name}`) as Human;
    s.log = log;
    sessions.push(s);
    return s;
  };
  let rid = 0;
  const call = async (s: Session, id: string, data: unknown) => {
    const r = ++rid;
    await rpc.dispatch({ session: s, room: s.room, player: s.player }, id, data, r);
    const res = (s as Human).log.find((m) => m.t === 'rpcResult' && m.rid === r) as Extract<ServerMsg, { t: 'rpcResult' }>;
    if (!res.ok) throw new Error(res.error);
    return res.data as Record<string, unknown>;
  };
  return { store, lobby, human, call };
}

const steps = (room: Room, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) room.step();
};
const feats = (s: Human, id: string) => s.log.filter((m) => m.t === 'feat' && m.id === id).map((m) => (m as Extract<ServerMsg, { t: 'feat' }>).data as Record<string, unknown>);
const ext = (room: Room) => room.results!.ext.economy as EconomyResultsExt;
const econOf = (s: Session) => s.profile.ext.economy as unknown as EconomyState & { escrow: { amount: number } | null };

/** Queue one or more humans into a staked lobby with bots filling to `players`, start it, reach play. */
async function wagerRoom(w: World, hs: Human[], o: { ante?: number; players?: number; mode?: string; fill?: boolean } = {}) {
  const ante = o.ante ?? 1000;
  let roomId = '';
  for (const h of hs) {
    const r = await w.call(h, 'economy.wagerQueue', { mode: o.mode ?? 'oitc', ante, bots: { fill: o.fill ?? true, targetPlayers: o.players ?? 6, difficulty: 'regular' } });
    roomId ||= r.roomId as string;
    expect(r.roomId).toBe(roomId);
    w.lobby.join(h, roomId);
  }
  const room = w.lobby.get(roomId)!;
  wagersFor(room)!.random = seeded(7);
  expect((await w.call(hs[0]!, 'economy.wagerStart', {})).ok).toBe(true);
  steps(room, 0.5);
  expect(room.phase).toBe('countdown');
  const state = () => wagersFor(room)!.states.get(room.id)!;
  const P = (h: Session) => room.players.get(h.id)!;
  return { room, state, P, play: () => (steps(room, 5.2), expect(room.phase).toBe('playing')) };
}

/** Put the room's players in this final order (OITC ranks survivors by lives, then score). */
function order(room: Room, players: PlayerState[]) {
  players.forEach((p, i) => room.addPlayerScore(p, (players.length - i) * 100, 'test'));
}

describe('pot maths and the payout table', () => {
  it('1 human + 5 bots at 1,000: pot 6,000, paid 3,000 / 1,800 / 1,200, 4th-6th lose the ante', () => {
    expect(wagerPotPreview(1000, 6)).toEqual({ pot: 6000, payouts: [3000, 1800, 1200] });
    expect(paidPlaces(6)).toBe(3);
    // Smaller tables pay fewer places; one entrant can't wager.
    expect(wagerPotPreview(1000, 3)).toEqual({ pot: 3000, payouts: [1950, 1050] });
    expect(wagerPotPreview(10, 2)).toEqual({ pot: 20, payouts: [20] });
    expect(wagerPotPreview(1000, 1)).toEqual({ pot: 0, payouts: [] });
    expect(wagerPotPreview(0, 6)).toEqual({ pot: 0, payouts: [] });
    // Rounding goes to 1st; leavers can't place (shares renormalised over who's left).
    expect(wagerPayouts(80, 8, 8)).toEqual([40, 24, 16]);
    expect(wagerPayouts(6000, 6, 2)).toEqual([3750, 2250]);
  });

  it('the lobby shows the bots at their real (unscaled) skill on every tier', () => {
    expect(opponentsLabel('hardened')).toBe('Hardened');
    expect(opponentsLabel('custom')).toBe('Custom');
    // No scaling by the ante: a staked lobby keeps the difficulty and variance it asked for.
    expect(sanitizeBots('oitc', { difficulty: 'recruit', variance: 0.4 })).toMatchObject({ difficulty: 'recruit', variance: 0.4 });
    expect(ANTE_TIERS.map((t) => t.id)).toEqual(['practice', 'low', 'mid', 'high']);
    expect(MIN_STAKE).toBe(10);
  });
});

describe('a solo wager against bots', () => {
  it('stakes only the human: escrow 1,000, the house covers 5 bots, pot 6,000', async () => {
    const w = world();
    const a = w.human('A');
    const { room, state, play } = await wagerRoom(w, [a]);
    expect(room.players.size).toBe(6);
    expect(a.profile.codPoints).toBe(19000);
    expect(econOf(a).escrow?.amount).toBe(1000);
    expect(w.store.load(a.profile.id)!.codPoints).toBe(19000); // saved with the escrow
    expect(state()).toMatchObject({ practice: false, pot: 6000, stakedAtStart: 1, entrantsAtStart: 6 });
    expect(state().house.size).toBe(5);
    play();
    const hud = feats(a, 'economy.wager').at(-1) as unknown as WagerHud;
    expect(hud).toMatchObject({ pot: 6000, staked: 1, entrants: 6, payouts: [3000, 1800, 1200], practice: false });
    expect(hud.standings.filter((s) => s.rank > 0).length).toBe(6);
  });

  it('1st takes half the pot', async () => {
    const w = world();
    const a = w.human('A');
    const { room, P, play } = await wagerRoom(w, [a]);
    play();
    order(room, [P(a), ...room.bots()]);
    room.endMatch('time');
    const wg = ext(room).wager!;
    expect(wg).toMatchObject({ pot: 6000, entrants: 6, staked: 1, payouts: [3000, 1800, 1200], house: 3000 });
    expect(wg.lines).toEqual([expect.objectContaining({ name: 'A', rank: 1, ante: 1000, payout: 3000, net: 2000 })]);
    expect(a.profile.codPoints).toBe(22000);
    expect(econOf(a).escrow).toBeNull();
    expect(econOf(a).wagerHistory[0]).toMatchObject({ place: 1, entrants: 6, humans: 1, payout: 3000, net: 2000 });
    expect(a.profile.stats['wager.wins']).toBe(1);
    expect(feats(a, 'economy.award').at(-1)).toMatchObject({ reason: 'payout', total: 2000, codPoints: 22000 });
    expect(w.store.load(a.profile.id)!.codPoints).toBe(22000);
  });

  it('a bot in the money keeps nothing: its share goes back to the house', async () => {
    const w = world();
    const a = w.human('A');
    const { room, P, play } = await wagerRoom(w, [a]);
    play();
    const [b1, b2, ...rest] = room.bots();
    order(room, [b1!, P(a), b2!, ...rest]);
    room.endMatch('time');
    const wg = ext(room).wager!;
    expect(wg.placings.slice(0, 3).map((p) => [p.bot, p.rank, p.payout])).toEqual([[true, 1, 3000], [false, 2, 1800], [true, 3, 1200]]);
    expect(wg.house).toBe(4200);
    expect(a.profile.codPoints).toBe(19000 + 1800);
    expect(econOf(a).wagerHistory[0]).toMatchObject({ place: 2, net: 800 });
    expect(a.profile.stats['wager.inMoney']).toBe(1);
  });

  it('4th of 6 is out of the money and loses the ante', async () => {
    const w = world();
    const a = w.human('A');
    const { room, P, play } = await wagerRoom(w, [a]);
    play();
    const bs = room.bots();
    order(room, [bs[0]!, bs[1]!, bs[2]!, P(a), bs[3]!, bs[4]!]);
    room.endMatch('time');
    expect(ext(room).wager!.lines[0]).toMatchObject({ rank: 4, payout: 0, net: -1000 });
    expect(ext(room).wager!.house).toBe(6000);
    expect(a.profile.codPoints).toBe(19000);
    expect(econOf(a).wagerLost).toBe(1000);
    expect(feats(a, 'economy.award').at(-1)).toMatchObject({ reason: 'payout', total: -1000 });
  });

  it('leaving mid-match forfeits the ante for good: no refund, not even when the room closes', async () => {
    const w = world();
    const a = w.human('A');
    const { room, play } = await wagerRoom(w, [a]);
    play();
    w.lobby.leave(a, 'disconnect');
    expect(a.profile.codPoints).toBe(19000);
    expect(econOf(a).escrow).toBeNull();
    expect(econOf(a).wagerHistory[0]).toMatchObject({ forfeit: true, place: 0, net: -1000 });
    expect(a.profile.stats['wager.forfeits']).toBe(1);
    // Saved at once, escrow cleared: a crash now can't hand it back.
    const saved = w.store.load(a.profile.id)!;
    expect(saved.codPoints).toBe(19000);
    expect((saved.ext.economy as { escrow: unknown }).escrow).toBeNull();
    steps(room, 6); // an empty room closes after 5 s
    expect(room.closed).toBe(true); // the last human left
    expect(a.profile.codPoints).toBe(19000);
    wagersFor(room)!.sweep();
    expect(a.profile.codPoints).toBe(19000);
  });

  it('leaving during the countdown is refunded (nothing seen yet)', async () => {
    const w = world();
    const a = w.human('A');
    await wagerRoom(w, [a]);
    w.lobby.leave(a, 'left');
    expect(a.profile.codPoints).toBe(20000);
    expect(econOf(a).escrow).toBeNull();
  });

  it('a server shutdown mid-match refunds the solo stake', async () => {
    const w = world();
    const a = w.human('A');
    const { room, play } = await wagerRoom(w, [a]);
    play();
    w.lobby.shutdown();
    expect(room.closed).toBe(true);
    expect(a.profile.codPoints).toBe(20000);
  });

  it('the client cannot pick its placement: payouts follow the server ranking only', async () => {
    const w = world();
    const a = w.human('A');
    const { room, P, play } = await wagerRoom(w, [a]);
    play();
    order(room, [...room.bots(), P(a)]);
    await expect(w.call(a, 'economy.wagerQueue', { mode: 'oitc', ante: 1000 })).rejects.toThrow(/busy/);
    room.endMatch('time');
    expect(a.profile.codPoints).toBe(19000);
  });
});

describe('guard rails', () => {
  it("can't ante more than the balance; below Low Roller only practice is open, with a hint", async () => {
    const w = world();
    const a = w.human('A', 999);
    await expect(w.call(a, 'economy.wagerQueue', { mode: 'oitc', ante: 1000 })).rejects.toThrow(/funds.*999 of 1,000/);
    const poor = w.human('Poor', MIN_STAKE - 1);
    await expect(w.call(poor, 'economy.wagerQueue', { mode: 'gungame', ante: MIN_STAKE })).rejects.toThrow(EARN_CP_HINT);
    expect((await w.call(poor, 'economy.wagerQueue', { mode: 'gungame', ante: 0 })).practice).toBe(true);
  });

  it('a player who spends their CP before the start is kicked, never driven negative', async () => {
    const w = world();
    const a = w.human('A');
    const r = await w.call(a, 'economy.wagerQueue', { mode: 'oitc', ante: 10000, bots: { targetPlayers: 4 } });
    w.lobby.join(a, r.roomId as string);
    a.profile.codPoints = 50;
    await w.call(a, 'economy.wagerStart', {});
    const room = w.lobby.get(r.roomId as string);
    if (room && !room.closed) steps(room, 0.5);
    expect(a.profile.codPoints).toBe(50);
    expect(econOf(a).escrow).toBeNull();
  });

  it('practice stays free with bots and pays nothing', async () => {
    const w = world();
    const a = w.human('A', 0);
    const r = await w.call(a, 'economy.wagerQueue', { mode: 'oitc', ante: 0, bots: { targetPlayers: 4 } });
    w.lobby.join(a, r.roomId as string);
    const room = w.lobby.get(r.roomId as string)!;
    steps(room, 9);
    expect(room.phase).toBe('playing');
    room.addPlayerScore(room.players.get(a.id)!, 500, 'test');
    room.endMatch('time');
    expect(ext(room).wager).toMatchObject({ practice: true, pot: 0, lines: [] });
    expect(a.profile.codPoints).toBe(0);
  });

  it('a lone human with bot fill off still plays practice (one entrant cannot wager)', async () => {
    const w = world();
    const a = w.human('A');
    const r = await w.call(a, 'economy.wagerQueue', { mode: 'oitc', ante: 1000, bots: { fill: false } });
    w.lobby.join(a, r.roomId as string);
    const room = w.lobby.get(r.roomId as string)!;
    room.startMatch();
    expect(wagersFor(room)!.states.get(room.id)!.practice).toBe(true);
    expect(a.profile.codPoints).toBe(20000);
  });
});

describe('two humans with bots', () => {
  it('bots fill the pot and place: 2 humans + 4 bots at 1,000 pay the top 3 of 6', async () => {
    const w = world();
    const a = w.human('A');
    const b = w.human('B');
    const { room, state, P, play } = await wagerRoom(w, [a, b]);
    expect(state()).toMatchObject({ pot: 6000, stakedAtStart: 2, entrantsAtStart: 6 });
    expect(a.profile.codPoints).toBe(19000);
    expect(b.profile.codPoints).toBe(19000);
    play();
    const bs = room.bots();
    order(room, [P(a), bs[0]!, P(b), bs[1]!, bs[2]!, bs[3]!]);
    room.endMatch('time');
    const wg = ext(room).wager!;
    expect(wg.lines.map((l) => [l.name, l.rank, l.payout])).toEqual([['A', 1, 3000], ['B', 3, 1200]]);
    expect(wg.house).toBe(1800);
    expect(a.profile.codPoints).toBe(22000);
    expect(b.profile.codPoints).toBe(20200);
  });

  it('keeps the old void rule: one of two humans quitting voids the wager and refunds both', async () => {
    const w = world();
    const a = w.human('A');
    const b = w.human('B');
    const { state, play } = await wagerRoom(w, [a, b]);
    play();
    w.lobby.leave(b, 'disconnect');
    expect(state().practice).toBe(true);
    expect(a.profile.codPoints).toBe(20000);
    expect(b.profile.codPoints).toBe(20000);
    expect(econOf(b).wagerHistory.length).toBe(0); // the forfeit record went with the refund
    expect(econOf(b).wagerLost).toBe(0);
  });

  it('three humans: a quitter forfeits to a pot that still counts the bots', async () => {
    const w = world();
    const [a, b, c] = [w.human('A'), w.human('B'), w.human('C')];
    const { room, P, play } = await wagerRoom(w, [a, b, c], { players: 5 });
    play();
    w.lobby.leave(c, 'left');
    expect(c.profile.codPoints).toBe(19000);
    const bs = room.bots();
    order(room, [P(b), P(a), bs[0]!, bs[1]!]);
    room.endMatch('time');
    const wg = ext(room).wager!;
    expect(wg).toMatchObject({ pot: 5000, entrants: 5, forfeits: ['C'] });
    expect(wg.lines.map((l) => [l.name, l.payout])).toEqual([['B', 2500], ['A', 1500]]);
    expect(wg.house).toBe(1000);
  });
});

describe('escrow across a crash', () => {
  it('an ante left in escrow by a crash is refunded at the next boot; a forfeit stays lost', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lofi-wager-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const dbPath = join(dir, 'lofi.db');
    // Process 1: two solo wagers in flight; one player has already quit (forfeit). Then it dies:
    // no shutdown, no settle, no more saves.
    const w1 = world({ dbPath, manage: false });
    const a = w1.human('Crashed');
    const q = w1.human('Quitter');
    const { play } = await wagerRoom(w1, [a]);
    play();
    const r2 = await wagerRoom(w1, [q]);
    r2.play();
    w1.lobby.leave(q, 'left');
    expect(w1.store.load(a.profile.id)!.codPoints).toBe(19000);
    // Process 2 boots on the same database.
    const w2 = world({ dbPath });
    const back = w2.store.load(a.profile.id)!;
    expect(back.codPoints).toBe(20000);
    expect((back.ext.economy as { escrow: unknown }).escrow).toBeNull();
    expect((back.ext.economy as EconomyState).history[0]).toMatchObject({ kind: 'refund', cp: 1000 });
    expect(w2.store.load(q.profile.id)!.codPoints).toBe(19000);
    expect(w2.store.idsWithExt('$.economy.escrow')).toEqual([]);
    // A third boot changes nothing (idempotent).
    const w3 = world({ dbPath });
    expect(w3.store.load(a.profile.id)!.codPoints).toBe(20000);
    w1.store.close();
  });
});
