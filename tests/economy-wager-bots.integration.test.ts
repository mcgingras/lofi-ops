/**
 * A full solo wager against bots through the real server and a real socket: One in the Chamber at
 * Big Spender (1,000 CP) with three bots, the house covering their antes. Checks the balance before
 * the buy-in, while the ante is in escrow, and after the payout (live profile and the database).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import type { EconomyResultsExt, WagerHud } from '../src/shared/defs/economy-net';
import { matchSummaryFor } from '../src/shared/defs/progression';
import { FakeClient } from './fake-client';

let rid = 5000;
async function rpc(c: FakeClient, id: string, data: unknown) {
  const r = ++rid;
  c.send({ t: 'rpc', id, data, rid: r } as never);
  return c.waitFor('rpcResult', (m) => m.rid === r);
}

describe('solo wager against bots over a socket', () => {
  let server: GameServer;
  const clients: FakeClient[] = [];
  beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
  });
  afterAll(async () => {
    for (const c of clients) c.close();
    await server.close();
  });

  it('stakes 1,000 of 1,000 CP against 3 bots, wins 1st and is paid half the 4,000 pot', async () => {
    const { client: a, welcome } = await FakeClient.connect(server.url, 'SoloStaker');
    clients.push(a);
    expect(welcome.profile.codPoints).toBe(1000);
    const q = await rpc(a, 'economy.wagerQueue', { mode: 'oitc', ante: 1000, bots: { fill: true, targetPlayers: 4, difficulty: 'regular' } });
    expect(q).toMatchObject({ ok: true, data: { practice: false } });
    const roomId = (q.data as { roomId: string }).roomId;
    const room = server.lobby.get(roomId)!;
    room.options.countdownSec = 0.3;
    a.send({ t: 'joinRoom', roomId });
    await a.waitFor('joined');
    const lobby = await a.waitFor('feat', (m) => m.id === 'economy.wager' && (m.data as WagerHud).phase === 'lobby');
    expect(lobby.data).toMatchObject({ pot: 4000, entrants: 4, payouts: [2000, 1200, 800], practice: false, bots: { opponents: 'Regular' } });
    expect((await rpc(a, 'economy.wagerStart', {})).data).toEqual({ ok: true });
    const staked = await a.waitFor('profile', (m) => m.profile.codPoints === 0);
    expect((staked.profile.ext.economy as { escrow: { amount: number } }).escrow.amount).toBe(1000);
    await a.waitFor('phase', (m) => m.phase === 'playing');
    expect(room.bots().length).toBe(3);
    // The server decides placement; make the human the clear leader before time runs out.
    const me = room.players.get(welcome.sessionId)!;
    me.ext.wager = { ...me.ext.wager, lives: 99, out: false };
    room.addPlayerScore(me, 10000, 'test');
    room.endMatch('time');
    const end = await a.waitFor('matchEnd');
    const w = (end.results.ext.economy as EconomyResultsExt).wager!;
    expect(w).toMatchObject({ practice: false, ante: 1000, pot: 4000, staked: 1, entrants: 4, payouts: [2000, 1200, 800] });
    expect(w.lines).toEqual([expect.objectContaining({ name: 'SoloStaker', rank: 1, payout: 2000, net: 1000 })]);
    expect(w.house).toBe(2000); // 2nd and 3rd were bots
    const award = await a.waitFor('feat', (m) => m.id === 'economy.award' && (m.data as { reason: string }).reason === 'payout');
    expect(award.data).toMatchObject({ total: 1000 });
    const challengeCp = matchSummaryFor(end.results, welcome.sessionId)?.codPoints ?? 0;
    const after = await a.waitFor('profile', (m) => m.profile.codPoints === 2000 + challengeCp);
    expect((after.profile.ext.economy as { escrow: unknown; wagerWon: number }).escrow).toBeNull();
    expect((after.profile.ext.economy as { wagerWon: number }).wagerWon).toBe(1000);
    expect(server.store.authenticate(welcome.token).profile.codPoints).toBe(2000 + challengeCp);
  });
});
