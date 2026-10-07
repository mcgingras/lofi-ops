/**
 * Perks and killstreaks through the real server and sockets: a human earns a Spy Plane by killing
 * bots, calls it with the STREAK button, and the snapshot radar shows the bots; a bot-only lobby
 * (backfill) uses its own streaks; RPCs answer.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { ksOf } from '../src/server/features/killstreaks/state';
import { KS_ENTITY } from '../src/shared/defs/killstreaks';
import { MAX_LEVEL, XP_TABLE } from '../src/shared/defs/progression';
import type { KillstreakStateMsg } from '../src/shared/defs/perks-streaks-protocol';
import { Buttons } from '../src/shared/input';
import { cloneLoadout, DEFAULT_LOADOUTS } from '../src/shared/loadout';
import { FakeClient, sleep } from './fake-client';

describe('perks and killstreaks over the wire', () => {
  let server: GameServer;
  const clients: FakeClient[] = [];

  beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
  });
  afterAll(async () => {
    for (const c of clients) c.close();
    await server.close();
  });

  it('earn a Spy Plane on bots, call it with STREAK, see them on radar', async () => {
    const { client: a, welcome } = await FakeClient.connect(server.url, 'Streaker');
    clients.push(a);
    a.send({ t: 'quickplay', mode: 'tdm', map: 'yard' });
    const joined = await a.waitFor('joined');
    const room = server.lobby.get(joined.roomId)!;
    const me = room.players.get(welcome.sessionId)!;
    // Max level so progression's unlock gating (Create-a-Class, Ninja at 15) keeps the custom class.
    me.profile!.xp = XP_TABLE[MAX_LEVEL]!;
    me.profile!.level = MAX_LEVEL;
    // Ninja + Hardline + the Spy Plane, set as the next life's loadout and respawned.
    me.profile!.loadouts[0] = { ...cloneLoadout(DEFAULT_LOADOUTS[0]!), perks: ['hardline', 'steady_aim', 'ninja'], killstreaks: ['uav', 'counter_uav', 'care_package'] };
    me.profile!.selectedLoadout = 0;
    room.spawn(me);
    const enemyTeam = me.team === 0 ? 1 : 0;
    const bots = [room.addBot({ name: 'Bot A', team: enemyTeam }), room.addBot({ name: 'Bot B', team: enemyTeam }), room.addBot({ name: 'Bot C', team: enemyTeam })];
    for (const b of bots) ksOf(b).manual = true;

    // Ninja goes out in the public perks list.
    const pub = await a.waitFor('feat', (m) => m.id === 'perks.public' && (m.data as { ninja: string[] }).ninja.includes(me.id));
    expect(pub).toBeTruthy();

    // Two kills with Hardline earn the Spy Plane (3 - 1).
    room.kill(bots[0]!, me, { weapon: 'ak47', means: 'bullet', part: 'torso' });
    room.kill(bots[1]!, me, { weapon: 'ak47', means: 'bullet', part: 'torso' });
    const earned = await a.waitFor('feat', (m) => m.id === 'killstreaks.earned');
    expect(earned.data).toEqual({ id: 'uav' });
    const state = await a.waitFor('feat', (m) => m.id === 'killstreaks.state' && (m.data as KillstreakStateMsg).ready.includes('uav'));
    const st = state.data as KillstreakStateMsg;
    expect(st.chosen).toEqual([
      { id: 'uav', cost: 2 },
      { id: 'counter_uav', cost: 3 },
      { id: 'care_package', cost: 4 },
    ]);

    // Nobody on radar yet (bots aren't firing).
    const before = await a.waitFor('snap', (s) => s.tick > room.tick - 1);
    expect(before.radar).toEqual([]);

    // Press STREAK (button edge through the input stream).
    a.input(Buttons.STREAK, 0, 0, 2);
    await sleep(60);
    a.input(0, 0, 0, 2);
    const called = await a.waitFor('feat', (m) => m.id === 'killstreaks.called');
    expect(called.data).toMatchObject({ id: 'uav', owner: me.id, team: me.team });
    const snap = await a.waitFor('snap', (s) => s.ents.some((e) => e.kind === KS_ENTITY.uav) && s.radar.length > 0);
    const alive = bots.filter((b) => b.alive).map((b) => b.id);
    expect(snap.radar.sort()).toEqual(alive.sort());
    expect(snap.ents.find((e) => e.kind === KS_ENTITY.uav)!.owner).toBe(me.id);

    // RPCs.
    const rid = 77;
    a.send({ t: 'rpc', id: 'killstreaks.state', data: {}, rid });
    const res = await a.waitFor('rpcResult', (m) => m.rid === rid);
    expect(res.ok).toBe(true);
    expect((res.data as KillstreakStateMsg).ready).toEqual([]);
    a.send({ t: 'rpc', id: 'killstreaks.call', data: { id: 'napalm' }, rid: 78 });
    const bad = await a.waitFor('rpcResult', (m) => m.rid === 78);
    expect(bad.data).toEqual({ ok: false, reason: 'not_ready' });
    a.send({ t: 'rpc', id: 'perks.pro', data: {}, rid: 79 });
    const pro = await a.waitFor('rpcResult', (m) => m.rid === 79);
    expect(pro.ok).toBe(true);
    expect((pro.data as { pro: string[] }).pro).toEqual([]);
  });

  it('a lobby of bots runs its own streaks against each other', async () => {
    const room = server.lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, private: true });
    const streaky = { ...cloneLoadout(DEFAULT_LOADOUTS[0]!), killstreaks: ['uav', 'counter_uav', 'attack_helicopter'] };
    const a = room.addBot({ name: 'Ace', team: 0, loadout: streaky });
    const foes = [room.addBot({ name: 'F1', team: 1 }), room.addBot({ name: 'F2', team: 1 }), room.addBot({ name: 'F3', team: 1 })];
    ksOf(a).botStreakUse = 1;
    for (const f of foes) room.kill(f, a, { weapon: 'ak47', means: 'bullet', part: 'torso' });
    expect(ksOf(a).ready).toEqual(['uav']);
    // The room ticks on its own timer; the bot should call it within a few seconds.
    const t0 = Date.now();
    while (Date.now() - t0 < 6000 && room.entities.byKind(KS_ENTITY.uav).length === 0) await sleep(50);
    expect(room.entities.byKind(KS_ENTITY.uav).length).toBe(1);
    // Once the foes respawn they show on Ace's radar.
    const t1 = Date.now();
    while (Date.now() - t1 < 5000 && room.radarFor(a).length === 0) await sleep(50);
    expect(room.radarFor(a).length).toBeGreaterThan(0);
    room.close();
  });
});
