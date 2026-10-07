/**
 * Modes through the real server and real sockets: objective state pushes, announcer events,
 * a Domination capture, an S&D plant by holding USE over the network, Kill Confirmed tags, and
 * the end-of-match summary in `matchEnd`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { controllerOf } from '../src/server/features/modes/common';
import type { DomRules } from '../src/server/features/modes/dom';
import type { SdRules } from '../src/server/features/modes/sd';
import type { PlayerState } from '../src/server/player';
import { MODE_TUNING } from '../src/shared/defs/modes';
import { MODE_ENTITY, type MatchSummaryExt, type ModeEventPayload, type ModeStatePayload } from '../src/shared/defs/modestate';
import { Buttons } from '../src/shared/input';
import { createMoveState } from '../src/shared/movement';
import { FakeClient, sleep } from './fake-client';

const place = (p: PlayerState, x: number, z: number) => {
  p.move = { ...createMoveState(x, 0, z), onGround: true };
};
const feat = <T>(c: FakeClient, id: string, pred: (d: T) => boolean = () => true, timeoutMs = 8000) =>
  c.waitFor('feat', (m) => m.id === id && pred(m.data as T), timeoutMs).then((m) => m.data as T);

describe('modes over real sockets', () => {
  let server: GameServer;
  const clients: FakeClient[] = [];

  // These tests script exact human-vs-human rounds; keep the bots feature from backfilling them.
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

  it('Domination: state push, capture by standing on B, announcer event', async () => {
    const { client, welcome } = await FakeClient.connect(server.url, 'Capper');
    clients.push(client);
    client.send({ t: 'quickplay', mode: 'dom', map: 'yard' });
    const joined = await client.waitFor('joined');
    expect(joined.mode).toBe('dom');
    const st = await feat<ModeStatePayload>(client, 'modes.state');
    expect(st.flags?.map((f) => f.id)).toEqual(['A', 'B', 'C']);
    await client.waitFor('snap', (s) => s.ents.filter((e) => e.kind === MODE_ENTITY.flag).length === 3);

    const room = server.lobby.get(joined.roomId)!;
    const me = room.players.get(welcome.sessionId)!;
    const B = (controllerOf(room) as DomRules).flags.find((f) => f.zone.id === 'B')!.zone;
    // Speed up the test: start the capture almost complete.
    place(me, B.x, B.z);
    B.capTeam = me.team;
    B.cap = 0.85;
    const ev = await feat<ModeEventPayload>(client, 'modes.event', (e) => e.kind === 'dom.capture');
    expect(ev).toMatchObject({ team: me.team, player: me.id, obj: 'B' });
    const after = await feat<ModeStatePayload>(client, 'modes.state', (s) => s.flags?.find((f) => f.id === 'B')?.owner === me.team);
    expect(after.mode).toBe('dom');
    const score = await client.waitFor('score', (s) => (s.players.find((p) => p.id === me.id)?.score ?? 0) >= 200);
    expect(score).toBeDefined();
    client.send({ t: 'leaveRoom' });
    await client.waitFor('left');
  });

  it('Search and Destroy: hold USE over the wire to plant, then the match summary', async () => {
    const { client: a, welcome: wa } = await FakeClient.connect(server.url, 'Planter');
    const { client: b, welcome: wb } = await FakeClient.connect(server.url, 'Defender');
    clients.push(a, b);
    const room = server.lobby.createRoom({ mode: 'sd', map: 'yard', autoStart: false, onEnd: 'close', postMatchSec: 2 });
    a.send({ t: 'joinRoom', roomId: room.id });
    await a.waitFor('joined');
    b.send({ t: 'joinRoom', roomId: room.id });
    await b.waitFor('joined');
    const pa = room.players.get(wa.sessionId)!;
    const pb = room.players.get(wb.sessionId)!;
    expect(pa.team).not.toBe(pb.team);
    room.startMatch();
    const rules = controllerOf(room) as SdRules;
    const attacker = pa.team === rules.attackers ? pa : pb;
    const atkClient = attacker === pa ? a : b;
    const defClient = attacker === pa ? b : a;

    const st = await feat<ModeStatePayload>(atkClient, 'modes.state', (s) => s.sd?.round === 1);
    expect(st.sd?.bomb.carrier).toBe(attacker.id);
    const dst = await feat<ModeStatePayload>(defClient, 'modes.state', (s) => s.sd?.round === 1);
    expect(dst.sd?.bomb.carrier).toBeNull();

    // Skip the prep freeze, put the carrier on site A and hold USE (inputs every 50 ms).
    rules.endsAt = room.time;
    await feat<ModeStatePayload>(atkClient, 'modes.state', (s) => s.sd?.phase === 'live');
    const A = rules.sites.find((s) => s.id === 'A')!;
    place(attacker, A.x, A.z);
    const plantDone = feat<ModeEventPayload>(defClient, 'modes.event', (e) => e.kind === 'sd.plant', 15000);
    let planted = false;
    void plantDone.then(() => (planted = true));
    const t0 = Date.now();
    let sawProgress = false;
    while (!planted && Date.now() - t0 < 9000) {
      atkClient.input(Buttons.USE, 0, 0, 3);
      // Once the server sees USE held on the site, skip most of the 5 s plant (keeps the test short).
      const act = rules.acting.get(attacker);
      if (act && act.t < MODE_TUNING.sd.plantSec - 1) act.t = MODE_TUNING.sd.plantSec - 1;
      const me = atkClient.last('feat');
      if (me?.id === 'modes.state' && (me.data as ModeStatePayload).me?.kind === 'plant') sawProgress = true;
      await sleep(50);
    }
    const ev = await plantDone;
    expect(ev).toMatchObject({ obj: 'A', player: attacker.id });
    expect(sawProgress).toBe(true);
    expect(room.entities.byKind(MODE_ENTITY.bomb)).toHaveLength(1);

    // Finish the match: three more rounds to the attackers.
    room.teamScores[rules.attackers] = MODE_TUNING.sd.roundsToWin - 1;
    rules.endsAt = room.time; // detonate now
    const end = await atkClient.waitFor('matchEnd', () => true, 8000);
    expect(end.results.reason).toBe('rounds');
    const ext = end.results.ext.modes as MatchSummaryExt;
    expect(ext.players[attacker.id]?.stats.plants).toBe(1);
    expect(ext.players[attacker.id]?.xp.some((l) => l.label === 'Bomb plants')).toBe(true);
    expect(ext.mvp).toBe(attacker.id);
  });

  it('Kill Confirmed: a kill drops a tag entity clients can see; confirming scores', async () => {
    const { client, welcome } = await FakeClient.connect(server.url, 'Tagger');
    clients.push(client);
    const room = server.lobby.createRoom({ mode: 'kc', map: 'yard' });
    client.send({ t: 'joinRoom', roomId: room.id });
    await client.waitFor('joined');
    const me = room.players.get(welcome.sessionId)!;
    const bot = room.addBot({ name: 'Target', team: me.team === 0 ? 1 : 0 });
    place(bot, 5, 0);
    place(me, -5, 0);
    room.kill(bot, me, { weapon: 'ak47', means: 'bullet', part: 'torso' });
    const snap = await client.waitFor('snap', (s) => s.ents.some((e) => e.kind === MODE_ENTITY.tag));
    const tag = snap.ents.find((e) => e.kind === MODE_ENTITY.tag)!;
    expect(tag.team).toBe(bot.team);
    place(me, tag.x, tag.z);
    const ev = await feat<ModeEventPayload>(client, 'modes.event', (e) => e.kind === 'kc.confirm');
    expect(ev.player).toBe(me.id);
    const sc = await client.waitFor('score', (s) => (s.teams?.[me.team!] ?? 0) === 1);
    expect(sc.teams![me.team!]).toBe(1);
  });
});
