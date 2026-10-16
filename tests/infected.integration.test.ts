/**
 * Infected through the real server and real sockets: quick play, the state push (role, counts,
 * countdown), the First Infected announcement and their team in the roster, an infection over the
 * wire ("YOU ARE INFECTED", the knife at respawn), the last Survivor's bonus and the end of the
 * match with the summary.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { controllerOf } from '../src/server/features/modes/common';
import type { InfectedRules } from '../src/server/features/modes/infected';
import type { MatchSummaryExt, ModeEventPayload, ModeStatePayload } from '../src/shared/defs/modestate';
import { FakeClient } from './fake-client';

const feat = <T>(c: FakeClient, id: string, pred: (d: T) => boolean = () => true, timeoutMs = 8000) =>
  c.waitFor('feat', (m) => m.id === id && pred(m.data as T), timeoutMs).then((m) => m.data as T);

describe('Infected over real sockets', () => {
  let server: GameServer;
  const clients: FakeClient[] = [];
  const botsEnv = process.env.LOFI_BOTS;
  beforeAll(async () => {
    process.env.LOFI_BOTS = 'off';
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
  });
  afterAll(async () => {
    for (const c of clients) c.close();
    await server.close();
    if (botsEnv === undefined) delete process.env.LOFI_BOTS;
    else process.env.LOFI_BOTS = botsEnv;
  });

  it('first infected, an infection, the last survivor and the Infected winning', async () => {
    const { client: a, welcome: wa } = await FakeClient.connect(server.url, 'Alpha');
    const { client: b, welcome: wb } = await FakeClient.connect(server.url, 'Bravo');
    const { client: c, welcome: wc } = await FakeClient.connect(server.url, 'Charlie');
    clients.push(a, b, c);
    a.send({ t: 'quickplay', mode: 'infected', map: 'yard' });
    const joined = await a.waitFor('joined');
    expect(joined.mode).toBe('infected');
    for (const cl of [b, c]) {
      cl.send({ t: 'joinRoom', roomId: joined.roomId });
      await cl.waitFor('joined');
    }
    const room = server.lobby.get(joined.roomId)!;
    const rules = controllerOf(room) as unknown as InfectedRules;
    const st = await feat<ModeStatePayload>(a, 'modes.state', (s) => s.infected?.survivors === 3);
    expect(st.infected).toMatchObject({ role: 'survivor', infected: 0 });
    expect(st.infected!.pickAt).not.toBeNull();

    // Skip the countdown; Charlie is picked.
    const pc = room.players.get(wc.sessionId)!;
    rules.rng = () => 0.99;
    const order = [...room.players.values()];
    expect(order.at(-1)).toBe(pc);
    rules.pickAt = room.time;
    const first = await feat<ModeEventPayload>(a, 'modes.event', (e) => e.kind === 'infected.first');
    expect(first.player).toBe(wc.sessionId);
    const roster = await a.waitFor('roster', (r) => r.players.find((p) => p.id === wc.sessionId)?.team === 1);
    expect(roster.players.filter((p) => p.team === 0)).toHaveLength(2);
    const cst = await feat<ModeStatePayload>(c, 'modes.state', (s) => s.infected?.role === 'infected');
    expect(cst.infected).toMatchObject({ first: wc.sessionId, survivors: 2, infected: 1 });

    // Charlie knifes Bravo: Bravo is infected, Alpha is the last one standing.
    const pb = room.players.get(wb.sessionId)!;
    room.kill(pb, pc, { weapon: 'knife', means: 'melee', part: 'torso' });
    const you = await feat<ModeEventPayload>(b, 'modes.event', (e) => e.kind === 'infected.infect');
    expect(you).toMatchObject({ reason: wb.sessionId, player: wc.sessionId });
    const last = await feat<ModeEventPayload>(a, 'modes.event', (e) => e.kind === 'infected.last_alive');
    expect(last.player).toBe(wa.sessionId);
    const sp = await b.waitFor('spawned', (m) => m.loadout.lethal === 'tomahawk', 6000);
    expect(sp.loadout.lethal).toBe('tomahawk');
    const snap = await b.waitFor('snap', (s) => s.me.alive && s.me.weapons.length === 1);
    expect(snap.me.weapons[0]!.id).toBe('knife');
    const asnap = await a.waitFor('snap', (s) => s.me.weapons[1]?.id === 'rpk');
    expect(asnap.me.weapons.map((w) => w.id)).toEqual(['spas12', 'rpk']);

    // Charlie gets Alpha: the Infected win.
    room.kill(room.players.get(wa.sessionId)!, pc, { weapon: 'knife', means: 'melee', part: 'torso' });
    const end = await a.waitFor('matchEnd', () => true, 8000);
    expect(end.results.mode).toBe('infected');
    expect(end.results.winnerTeam).toBe(1);
    expect(end.results.teamScores).toEqual([0, 3]);
    const ext = end.results.ext.modes as MatchSummaryExt;
    expect(ext.players[wc.sessionId]?.stats.infections).toBe(2);
  });
});
