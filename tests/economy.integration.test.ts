/** Economy through the real server and real sockets: store purchase, wager escrow/payout/refund. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import type { EconomyResultsExt } from '../src/shared/defs/economy-net';
import { matchSummaryFor } from '../src/shared/defs/progression';
import { FakeClient } from './fake-client';

let rid = 1000;
async function rpc(c: FakeClient, id: string, data: unknown) {
  const r = ++rid;
  c.send({ t: 'rpc', id, data, rid: r } as never);
  return c.waitFor('rpcResult', (m) => m.rid === r);
}

describe('economy over sockets', () => {
  let server: GameServer;
  const clients: FakeClient[] = [];
  beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
  });
  afterAll(async () => {
    for (const c of clients) c.close();
    await server.close();
  });

  it('buys a camo (server-validated) and persists it', async () => {
    const { client: a, welcome } = await FakeClient.connect(server.url, 'Shopper');
    clients.push(a);
    expect(welcome.profile.codPoints).toBe(1000);
    const locked = await rpc(a, 'economy.buy', { item: 'camo.woodland' });
    expect(locked.ok).toBe(false);
    expect(locked.error).toMatch(/level/);
    server.sessions.get(welcome.sessionId)!.profile.level = 5;
    const ok = await rpc(a, 'economy.buy', { item: 'camo.woodland' });
    expect(ok).toMatchObject({ ok: true, data: { codPoints: 500, item: 'camo.woodland' } });
    const prof = await a.waitFor('profile', (m) => m.profile.owned.includes('camo.woodland'));
    expect(prof.profile.codPoints).toBe(500);
    const again = server.store.authenticate(welcome.token).profile;
    expect(again.owned).toContain('camo.woodland');
    expect(again.codPoints).toBe(500);
  });

  it('two players stake a wager; one disconnects mid-match and the void wager refunds both', async () => {
    const { client: a, welcome: wa } = await FakeClient.connect(server.url, 'Stayer');
    const { client: b, welcome: wb } = await FakeClient.connect(server.url, 'Quitter');
    clients.push(a, b);
    const qa = await rpc(a, 'economy.wagerQueue', { mode: 'oitc', ante: 10, bots: { fill: false } });
    const qb = await rpc(b, 'economy.wagerQueue', { mode: 'oitc', ante: 10, bots: { fill: false } });
    expect(qa.ok && qb.ok).toBe(true);
    const roomId = (qa.data as { roomId: string }).roomId;
    expect((qb.data as { roomId: string }).roomId).toBe(roomId);
    const room = server.lobby.get(roomId)!;
    room.options.countdownSec = 0.5;
    a.send({ t: 'joinRoom', roomId });
    b.send({ t: 'joinRoom', roomId });
    await a.waitFor('joined');
    await b.waitFor('joined');
    await a.waitFor('feat', (m) => m.id === 'economy.wager' && (m.data as { humans: number }).humans === 2);
    expect((await rpc(a, 'economy.wagerStart', {})).data).toEqual({ ok: true });
    const staked = await a.waitFor('profile', (m) => m.profile.codPoints === 990);
    expect((staked.profile.ext.economy as { escrow: { amount: number } }).escrow.amount).toBe(10);
    await a.waitFor('phase', (m) => m.phase === 'playing');
    b.close();
    const refund = await a.waitFor('feat', (m) => m.id === 'economy.award' && (m.data as { reason: string }).reason === 'refund');
    expect(refund.data).toMatchObject({ total: 10, codPoints: 1000 });
    await new Promise((r) => setTimeout(r, 100));
    expect(server.store.authenticate(wb.token).profile.codPoints).toBe(1000);
    expect(server.sessions.get(wa.sessionId)!.profile.codPoints).toBe(1000);
  });

  it('pays the pot to the top player at match end', async () => {
    const { client: c, welcome: wc } = await FakeClient.connect(server.url, 'Winner');
    const { client: d, welcome: wd } = await FakeClient.connect(server.url, 'Loser');
    clients.push(c, d);
    const q = await rpc(c, 'economy.wagerQueue', { mode: 'oitc', ante: 1000, bots: { fill: false } });
    await rpc(d, 'economy.wagerQueue', { mode: 'oitc', ante: 1000, bots: { fill: false } });
    const roomId = (q.data as { roomId: string }).roomId;
    const room = server.lobby.get(roomId)!;
    room.options.countdownSec = 0.3;
    c.send({ t: 'joinRoom', roomId });
    d.send({ t: 'joinRoom', roomId });
    await c.waitFor('joined');
    await d.waitFor('joined');
    await c.waitFor('feat', (m) => m.id === 'economy.wager' && (m.data as { humans: number }).humans === 2);
    await rpc(d, 'economy.wagerStart', {});
    await c.waitFor('phase', (m) => m.phase === 'playing');
    room.kill(room.players.get(wd.sessionId)!, room.players.get(wc.sessionId)!, { weapon: 'm1911', means: 'bullet' });
    room.endMatch('time');
    const end = await c.waitFor('matchEnd');
    const w = (end.results.ext.economy as EconomyResultsExt).wager!;
    expect(w.lines.map((l) => [l.name, l.payout])).toEqual([['Winner', 2000], ['Loser', 0]]);
    // Progression pays challenge CoD Points on top (the kill is first blood: career_firstblood).
    const challengeCp = matchSummaryFor(end.results, wc.sessionId)?.codPoints ?? 0;
    expect(challengeCp).toBeGreaterThan(0);
    const prof = await c.waitFor('profile', (m) => m.profile.codPoints === 2000 + challengeCp);
    expect((prof.profile.ext.economy as { wagerWon: number }).wagerWon).toBe(1000);
    // The loser's settled profile: ante gone, no escrow left.
    const dp = await d.waitFor('profile', (m) => (m.profile.ext.economy as { escrow: unknown }).escrow === null && m.profile.codPoints === 0);
    expect((dp.profile.ext.economy as { wagerLost: number }).wagerLost).toBe(1000);
  });
});
