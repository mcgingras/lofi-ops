import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { Buttons } from '../src/shared/input';
import { createMoveState } from '../src/shared/movement';
import { PLAYER } from '../src/shared/constants';
import { FakeClient, sleep } from './fake-client';

describe('headless match (real server, real sockets)', () => {
  let server: GameServer;
  const clients: FakeClient[] = [];

  beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
  });
  afterAll(async () => {
    for (const c of clients) c.close();
    await server.close();
  });

  it('serves health over http', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/health`);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('two players join a TDM room on the Yard; one shoots the other dead', async () => {
    const { client: a, welcome: wa } = await FakeClient.connect(server.url, 'Shooter');
    const { client: b, welcome: wb } = await FakeClient.connect(server.url, 'Target');
    clients.push(a, b);
    expect(wa.profile.name).toBe('Shooter');
    expect(wa.token.length).toBeGreaterThan(16);

    a.send({ t: 'quickplay', mode: 'tdm', map: 'yard' });
    const ja = await a.waitFor('joined');
    b.send({ t: 'quickplay', mode: 'tdm', map: 'yard' });
    const jb = await b.waitFor('joined');
    expect(jb.roomId).toBe(ja.roomId);
    expect(ja.map).toBe('yard');
    expect(ja.team).not.toBe(jb.team);
    await a.waitFor('snap', (s) => s.players.length === 2);

    // Put them in the open, 8 m apart along -z (shooter at z=8 facing yaw 0 = -z).
    const room = server.lobby.get(ja.roomId)!;
    const shooter = room.players.get(wa.sessionId)!;
    const target = room.players.get(wb.sessionId)!;
    expect(shooter.alive && target.alive).toBe(true);
    shooter.move = { ...createMoveState(-1, 0, 8), onGround: true };
    target.move = { ...createMoveState(-1, 0, 0), onGround: true };

    // Aim down sights for a moment (spread, sprint-out, history settles past the rewind window).
    const eye = { x: -1, y: PLAYER.eye, z: 8 };
    const chest = { x: -1, y: 1.15, z: 0 };
    const d = { x: chest.x - eye.x, y: chest.y - eye.y, z: chest.z - eye.z };
    const l = Math.hypot(d.x, d.y, d.z);
    const dir: [number, number, number] = [d.x / l, d.y / l, d.z / l];
    const pitch = Math.asin(dir[1]);
    for (let i = 0; i < 12; i++) {
      a.input(Buttons.ADS, 0, pitch);
      await sleep(50);
    }
    const snap = await a.waitFor('snap', (s) => s.ack >= a.seq && (s.me?.move.ads ?? 0) >= 1);
    expect(snap.me!.move.z).toBeCloseTo(8, 3);

    // Fire until the target dies.
    let shot = 0;
    for (let i = 0; i < 12 && target.alive; i++) {
      const seq = a.input(Buttons.ADS | Buttons.FIRE, 0, pitch);
      const viewTime = (a.last('snap')?.time ?? room.time) - 0.1;
      a.send({ t: 'fire', seq, time: viewTime, origin: [eye.x, eye.y, eye.z], dir, shot: ++shot });
      await sleep(150);
    }

    const feed = await b.waitFor('killfeed', (k) => k.victim === wb.sessionId);
    expect(feed).toMatchObject({ attacker: wa.sessionId, victim: wb.sessionId, weapon: 'ak47', means: 'bullet', attackerTeam: ja.team, victimTeam: jb.team });
    await a.waitFor('killfeed', (k) => k.victim === wb.sessionId);
    const hits = a.all('hit').filter((h) => h.victim === wb.sessionId);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.at(-1)!.kill).toBe(true);
    const died = await b.waitFor('died');
    expect(died.attacker).toBe(wa.sessionId);
    expect(died.respawnAt).not.toBeNull();

    const score = await a.waitFor('score', (s) => (s.teams?.[ja.team!] ?? 0) === 1);
    expect(score.teams![jb.team!]).toBe(0);
    const me = score.players.find((p) => p.id === wa.sessionId)!;
    expect(me).toMatchObject({ kills: 1 });
    expect(me.score).toBeGreaterThanOrEqual(100);
    expect(score.players.find((p) => p.id === wb.sessionId)).toMatchObject({ deaths: 1 });
    expect(b.all('hurt').length).toBeGreaterThanOrEqual(2);

    // Snapshots agree, and the target respawns after the delay.
    await a.waitFor('snap', (s) => s.teams?.[ja.team!] === 1);
    const spawned = await b.waitFor('spawned', () => true, 6000);
    expect(spawned.loadout.primary.weapon).toBe('ak47');
  });

  it('rpc: core.profile and core.setName with request ids', async () => {
    const { client } = await FakeClient.connect(server.url, 'Namer');
    clients.push(client);
    client.send({ t: 'rpc', id: 'core.setName', data: { name: 'Renamed' }, rid: 1 });
    const r1 = await client.waitFor('rpcResult', (r) => r.rid === 1);
    expect(r1.ok).toBe(true);
    client.send({ t: 'rpc', id: 'core.profile', data: {}, rid: 2 });
    const r2 = await client.waitFor('rpcResult', (r) => r.rid === 2);
    expect((r2.data as { name: string }).name).toBe('Renamed');
    client.send({ t: 'rpc', id: 'nope.nothing', data: {}, rid: 3 });
    expect((await client.waitFor('rpcResult', (r) => r.rid === 3)).ok).toBe(false);
  });

  it('a returning token gets the same profile', async () => {
    const { client, welcome } = await FakeClient.connect(server.url, 'Returner');
    client.close();
    await sleep(50);
    const again = await FakeClient.connect(server.url, undefined, welcome.token);
    clients.push(again.client);
    expect(again.welcome.profile.id).toBe(welcome.profile.id);
    expect(again.welcome.profile.name).toBe('Returner');
  });
});
