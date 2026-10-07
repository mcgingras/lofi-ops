import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { matchSummaryFor, MAX_LEVEL, XP_TABLE } from '../src/shared/defs/progression';
import { UNLOCK_LEVEL_OVERRIDES } from '../src/shared/defs/unlocks';
import { DEFAULT_LOADOUTS } from '../src/shared/loadout';
import type { Profile } from '../src/shared/profile';
import { FakeClient } from './fake-client';

describe('progression through the real server', () => {
  let server: GameServer;
  const clients: FakeClient[] = [];

  beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
  });
  afterAll(async () => {
    for (const c of clients) c.close();
    await server.close();
  });

  it('a kill pushes XP, the match end carries the summary, and the profile is saved', async () => {
    const { client: a, welcome: wa } = await FakeClient.connect(server.url, 'Earner');
    const { client: b, welcome: wb } = await FakeClient.connect(server.url, 'Victim');
    clients.push(a, b);
    a.send({ t: 'quickplay', mode: 'tdm', map: 'yard' });
    const ja = await a.waitFor('joined');
    b.send({ t: 'quickplay', mode: 'tdm', map: 'yard' });
    await b.waitFor('joined');
    const room = server.lobby.get(ja.roomId)!;
    const shooter = room.players.get(wa.sessionId)!;
    const target = room.players.get(wb.sessionId)!;
    await a.waitFor('snap', (s) => s.players.length === 2);
    expect(shooter.alive && target.alive).toBe(true);

    room.damage({ victim: target, attacker: shooter, amount: 500, weapon: 'ak47', part: 'head', means: 'bullet', from: null, distance: 12 });

    const xp = await a.waitFor('feat', (m) => m.id === 'progression.xp');
    const data = xp.data as { gains: [string, number][]; xp: number; level: number };
    expect(data.gains).toEqual(expect.arrayContaining([['KILL', 100], ['HEADSHOT', 50], ['FIRST BLOOD', 100]]));
    expect(data.xp).toBeGreaterThanOrEqual(250);
    const ch = await a.waitFor('feat', (m) => m.id === 'progression.challenge');
    expect((ch.data as { id: string }).id).toBeTruthy();

    room.endMatch('score');
    const end = await a.waitFor('matchEnd');
    const summary = matchSummaryFor(end.results, wa.sessionId)!;
    expect(summary.lines.find((l) => l.key === 'kill')).toMatchObject({ count: 1, xp: 100 });
    expect(summary.lines.find((l) => l.key === 'headshot')).toMatchObject({ count: 1, xp: 50 });
    expect(summary.challenges.find((c) => c.id === 'career_kills')).toMatchObject({ before: 0, after: 1 });
    // The victim gets a summary too (it can be all zeros) but no kill line.
    expect(matchSummaryFor(end.results, wb.sessionId)?.lines.find((l) => l.key === 'kill')).toBeUndefined();

    const pushed = await a.waitFor('feat', (m) => m.id === 'progression.summary');
    expect((pushed.data as { total: number }).total).toBe(summary.total);
    const prof = await a.waitFor('profile');
    expect(prof.profile.xp).toBe(summary.xpAfter);
    expect(prof.profile.stats['weapon.ak47.kills']).toBe(1);
    expect(server.store.load(wa.profile.id)?.xp).toBe(summary.xpAfter);

    a.send({ t: 'rpc', id: 'progression.lastMatch', data: {}, rid: 7 });
    const last = await a.waitFor('rpcResult', (r) => r.rid === 7);
    expect((last.data as { total: number }).total).toBe(summary.total);
  });

  it('progression.prestige: refused below 50, applied at 50 from the menu', async () => {
    const { client, welcome } = await FakeClient.connect(server.url, 'Prestiger');
    clients.push(client);
    client.send({ t: 'rpc', id: 'progression.prestige', data: {}, rid: 1 });
    const r1 = await client.waitFor('rpcResult', (r) => r.rid === 1);
    expect(r1.ok).toBe(false);
    expect(r1.error).toMatch(/not_eligible/);

    const session = server.sessions.get(welcome.sessionId)!;
    session.profile.xp = XP_TABLE[MAX_LEVEL]!;
    session.profile.level = MAX_LEVEL;
    const cp = session.profile.codPoints;
    client.send({ t: 'rpc', id: 'progression.prestige', data: {}, rid: 2 });
    const r2 = await client.waitFor('rpcResult', (r) => r.rid === 2);
    expect(r2.ok).toBe(true);
    expect(r2.data as Profile).toMatchObject({ prestige: 1, level: 1, xp: 0, codPoints: cp });
    const pushed = await client.waitFor('profile', (m) => m.profile.prestige === 1);
    expect(pushed.profile.unlocks).toContain('prestige_1');
    expect(server.store.load(welcome.profile.id)?.prestige).toBe(1);

    client.send({ t: 'rpc', id: 'progression.setEmblem', data: { emblem: 'prestige_2' }, rid: 3 });
    expect((await client.waitFor('rpcResult', (r) => r.rid === 3)).ok).toBe(false);
    client.send({ t: 'rpc', id: 'progression.setEmblem', data: { emblem: 'prestige_1' }, rid: 4 });
    expect((await client.waitFor('rpcResult', (r) => r.rid === 4)).data).toEqual({ emblem: 'prestige_1' });
  });

  it('progression.checkLoadout and spawn gating agree', async () => {
    UNLOCK_LEVEL_OVERRIDES.hardline = 8;
    try {
      const { client, welcome } = await FakeClient.connect(server.url, 'Gated');
      clients.push(client);
      client.send({ t: 'rpc', id: 'progression.checkLoadout', data: { loadout: DEFAULT_LOADOUTS[1] }, rid: 1 });
      const r = await client.waitFor('rpcResult', (m) => m.rid === 1);
      const res = r.data as { loadout: { perks: string[] }; violations: { id: string; reason: string }[] };
      expect(res.loadout.perks).toEqual(['steady_aim']);
      expect(res.violations).toEqual([{ kind: 'perk', id: 'hardline', reason: 'Requires level 8' }]);

      client.send({ t: 'selectLoadout', index: 1 });
      client.send({ t: 'quickplay', mode: 'ffa', map: 'yard' });
      const spawned = await client.waitFor('spawned');
      expect(spawned.loadout.perks).toEqual(['steady_aim']);
      const locked = await client.waitFor('feat', (m) => m.id === 'progression.locked');
      expect((locked.data as { violations: unknown[] }).violations.length).toBe(1);
      expect(server.sessions.get(welcome.sessionId)!.player?.loadout?.perks).toEqual(['steady_aim']);
    } finally {
      delete UNLOCK_LEVEL_OVERRIDES.hardline;
    }
  });
});
