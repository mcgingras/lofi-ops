/**
 * Playtest coverage over real sockets against an in-process server: respawn, health regen,
 * prediction holding under steady input (no rubber-banding, reconciled on every snapshot, using
 * the browser's MatchNet), lag compensation against a moving target, and match end on the score
 * limit.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import type { Room } from '../src/server/room';
import { allSpawns, initialSpawnWindow } from '../src/server/features/modes/common';
import { MatchNet, type Net } from '../src/client/net';
import { SnapshotBuffer } from '../src/client/netcode/interp';
import { PLAYER, type Team } from '../src/shared/constants';
import { Buttons } from '../src/shared/input';
import { createMoveState } from '../src/shared/movement';
import type { ServerMessages, ServerMsgOf } from '../src/shared/protocol';
import { FakeClient, sleep } from './fake-client';

let server: GameServer;
let open: FakeClient[] = [];

beforeAll(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
});
afterEach(() => {
  for (const c of open) c.close();
  open = [];
});
afterAll(async () => {
  await server.close();
});

async function join(room: Room, name: string) {
  const { client, welcome } = await FakeClient.connect(server.url, name);
  open.push(client);
  client.send({ t: 'joinRoom', roomId: room.id });
  const joined = await client.waitFor('joined');
  return { client, id: welcome.sessionId, joined };
}

/** A fresh TDM room on the Yard with a shooter (A) and a target (B) on opposite teams. */
async function duel(opts: Parameters<GameServer['lobby']['createRoom']>[0] = { mode: 'tdm', map: 'yard' }) {
  const room = server.lobby.createRoom({ closeWhenEmpty: true, ...opts });
  const a = await join(room, 'Shooter');
  const b = await join(room, 'Target');
  expect(a.joined.team).not.toBe(b.joined.team);
  await a.client.waitFor('snap', (s) => s.players.length === 2);
  const pa = room.players.get(a.id)!;
  const pb = room.players.get(b.id)!;
  return { room, a, b, pa, pb };
}

const place = (p: { move: ReturnType<typeof createMoveState> }, x: number, z: number) => {
  p.move = { ...createMoveState(x, 0, z), onGround: true };
};

/** Direction from an eye at (x, eye, z) to a point. */
function dirTo(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): [number, number, number] {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const l = Math.hypot(d.x, d.y, d.z);
  return [d.x / l, d.y / l, d.z / l];
}

/** Hold ADS (still) long enough for the server to see it settle. */
async function settleAds(c: FakeClient, pitch: number) {
  for (let i = 0; i < 12; i++) {
    c.input(Buttons.ADS, 0, pitch);
    await sleep(50);
  }
  await c.waitFor('snap', (s) => s.ack >= c.seq && (s.me?.move.ads ?? 0) >= 1);
}

/** One aimed shot from a stationary shooter at (x, z) towards a fixed point. */
function shoot(c: FakeClient, eye: { x: number; y: number; z: number }, at: { x: number; y: number; z: number }, shot: number, time: number) {
  const dir = dirTo(eye, at);
  const seq = c.input(Buttons.ADS | Buttons.FIRE, 0, Math.asin(dir[1]), 1);
  c.send({ t: 'fire', seq, time, origin: [eye.x, eye.y, eye.z], dir, shot });
}

describe('playtest over real sockets', () => {
  it('respawn: the dead player comes back at a team spawn with full health and can move', async () => {
    const { room, a, b, pa, pb } = await duel();
    place(pa, -1, 8);
    place(pb, -1, 0);
    const eye = { x: -1, y: PLAYER.eye, z: 8 };
    await settleAds(a.client, 0);
    let shot = 0;
    for (let i = 0; i < 10 && pb.alive; i++) {
      shoot(a.client, eye, { x: -1, y: 1.15, z: 0 }, ++shot, room.time - 0.1);
      await sleep(150);
    }
    const died = await b.client.waitFor('died');
    expect(died.respawnAt).not.toBeNull();
    const dead = await b.client.waitFor('snap', (s) => s.me?.alive === false);
    expect(dead.me!.respawnAt).toBeCloseTo(died.respawnAt!, 3);

    const firstSpawns = b.client.all('spawned').length;
    const spawned = await b.client.waitFor('spawned', (m) => b.client.all('spawned').indexOf(m) >= firstSpawns, 6000);
    // The modes feature's TDM uses the team's own spawns only in the opening seconds, then dynamic
    // spawns from every spawn point of the map (away from enemies); either way it is a map spawn.
    const spawns = initialSpawnWindow(room) ? room.map.spawns.teams[b.joined.team as Team] : allSpawns(room.map);
    expect(spawns.some((s) => Math.hypot(s.x - spawned.x, s.z - spawned.z) < 0.01)).toBe(true);
    const back = await b.client.waitFor('snap', (s) => s.me?.alive === true && s.time >= died.respawnAt! - 0.05);
    expect(back.me!.health).toBe(100);
    // Inputs after respawn move the body.
    for (let i = 0; i < 20; i++) {
      b.client.input(Buttons.FORWARD, spawned.yaw, 0, 2);
      await sleep(33);
    }
    const moved = await b.client.waitFor('snap', (s) => s.ack >= b.client.seq);
    expect(Math.hypot(moved.me!.move.x - spawned.x, moved.me!.move.z - spawned.z)).toBeGreaterThan(1.5);
  });

  it('health regenerates to full after 5 s without damage (seen in snapshots)', async () => {
    const { room, a, b, pa, pb } = await duel();
    place(pa, -1, 8);
    place(pb, -1, 0);
    await settleAds(a.client, 0);
    shoot(a.client, { x: -1, y: PLAYER.eye, z: 8 }, { x: -1, y: 1.15, z: 0 }, 1, room.time - 0.1);
    const hurt = await b.client.waitFor('hurt');
    const hitAt = performance.now();
    const low = await b.client.waitFor('snap', (s) => (s.me?.health ?? 100) < 100);
    expect(low.me!.health).toBe(60);
    expect(hurt.health).toBe(60);
    await sleep(4300);
    const before = b.client.last('snap')!;
    expect(before.me!.health).toBe(60);
    const full = await b.client.waitFor('snap', (s) => s.time > before.time && s.me?.health === 100, 4000);
    expect(full.time - low.time).toBeGreaterThan(5.5);
    const took = (performance.now() - hitAt) / 1000;
    expect(took).toBeGreaterThan(4.9);
    expect(took).toBeLessThan(7.5);
    expect(full.me!.alive).toBe(true);
  }, 15000);

  it('prediction holds under steady input: every snapshot reconciles with ~0 correction', async () => {
    const room = server.lobby.createRoom({ mode: 'ffa', map: 'yard', closeWhenEmpty: true });
    const { client, joined } = await join(room, 'Runner');
    // Drive the browser's MatchNet through an adapter over the test socket.
    const adapter = {
      on: <K extends keyof ServerMessages>(t: K, fn: (m: ServerMsgOf<K>) => void) => {
        const h = (data: Buffer) => {
          const m = JSON.parse(data.toString()) as { t: string };
          if (m.t === t) fn(m as unknown as ServerMsgOf<K>);
        };
        client.ws.on('message', h);
        return () => client.ws.off('message', h);
      },
      send: (m: Parameters<FakeClient['send']>[0]) => client.send(m),
    } as unknown as Net;
    const mn = new MatchNet(adapter, joined);
    const spawned = await client.waitFor('spawned');
    mn.predictor.reset({ ...createMoveState(spawned.x, spawned.y, spawned.z), onGround: true });
    await client.waitFor('snap', (s) => !!s.me?.alive);
    await sleep(120);

    const corrections: number[] = [];
    let counting = false;
    const off = adapter.on('snap', () => {
      if (counting) corrections.push(mn.predictor.lastCorrection);
    });
    counting = true;
    const snapsBefore = mn.predictor.snaps;
    // ~3 s of steady play at a jittery ~60 fps: run, strafe, sprint, crouch-walk, turn; into walls too.
    let yaw = spawned.yaw;
    let last = performance.now();
    const t0 = last;
    while (performance.now() - t0 < 3000) {
      await sleep(10 + Math.random() * 12);
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const t = (now - t0) / 1000;
      let b = Buttons.FORWARD;
      if (t > 0.8 && t < 1.6) b |= Buttons.SPRINT;
      if (t > 1.6 && t < 2.2) b = Buttons.LEFT | Buttons.BACK;
      if (t > 2.2) b = Buttons.FORWARD | Buttons.CROUCH;
      yaw += dt * 0.6;
      mn.input(b, yaw, 0, 0, dt);
      mn.flush();
    }
    mn.flush(true);
    await client.waitFor('snap', (s) => s.ack >= mn.seq, 3000);
    await sleep(60);
    off();
    mn.dispose();
    expect(corrections.length).toBeGreaterThan(40);
    expect(mn.predictor.snaps - snapsBefore).toBe(0);
    expect(Math.max(...corrections)).toBeLessThan(0.02);
    const final = client.last('snap')!;
    expect(Math.hypot(final.me!.move.x - spawned.x, final.me!.move.z - spawned.z)).toBeGreaterThan(5);
  }, 10000);

  it('lag compensation: aiming at the interpolated (100 ms old) position of a sprinting target hits', async () => {
    const { a, b, pa, pb } = await duel();
    place(pa, -1, 8);
    place(pb, -4, 0);
    const eye = { x: -1, y: PLAYER.eye, z: 8 };
    await settleAds(a.client, 0);
    // A interpolates B like the browser does.
    const buf = new SnapshotBuffer();
    a.client.ws.on('message', (data) => {
      const m = JSON.parse(data.toString()) as ServerMsgOf<'snap'>;
      if (m.t === 'snap') buf.push(m.time, m.players, performance.now() / 1000);
    });
    // B sprints back and forth across A's view (+x then -x), sending inputs at real time.
    let running = true;
    const run = (async () => {
      const t0 = performance.now();
      while (running) {
        const t = (performance.now() - t0) / 1000;
        b.client.input(Buttons.FORWARD | Buttons.SPRINT, Math.floor(t / 0.8) % 2 === 0 ? -Math.PI / 2 : Math.PI / 2, 0, 1);
        // A keeps holding ADS at frame rate like a real client: after 250 ms without input the
        // server idles the player (buttons 0), ADS decays and hip spread makes hits random.
        a.client.input(Buttons.ADS, 0, 0, 1);
        await sleep(1000 / 60);
      }
    })();
    await sleep(300);

    /** Wait until B is seen moving fast, then fire at the seen position. Returns whether it hit. */
    const shotAtSeen = async (shot: number, rewind: boolean) => {
      for (let tries = 0; tries < 40; tries++) {
        await sleep(20);
        const rt = buf.renderTime(performance.now() / 1000);
        const seen = buf.sample(b.id, rt);
        if (!seen || Math.abs(seen.vx) < 6 || Math.abs(pb.move.vx) < 6 || Math.sign(seen.vx) !== Math.sign(pb.move.vx)) continue;
        const lead = Math.abs(pb.move.x - seen.x);
        // Only shoot once the seen position is well clear of the real hitbox (under load the
        // render time can lag less than usual for a frame).
        if (lead <= 0.5) continue;
        const before = a.client.all('hit').length;
        // Without rewind: claim a view time in the future (clamped to now by the server).
        shoot(a.client, eye, { x: seen.x, y: seen.y + 1.15, z: seen.z }, shot, rewind ? rt : rt + 10);
        await sleep(150);
        return { lead, hit: a.client.all('hit').length > before };
      }
      throw new Error('target never seen sprinting');
    };

    const control = await shotAtSeen(1, false);
    const r1 = await shotAtSeen(2, true);
    const r2 = await shotAtSeen(3, true);
    running = false;
    await run;
    // The target was well past its hitbox (0.3 m half width) when each shot was sent...
    for (const r of [control, r1, r2]) expect(r.lead).toBeGreaterThan(0.45);
    // ...so without rewinding the shot misses, and with it, it lands.
    expect(control.hit).toBe(false);
    expect(r1.hit).toBe(true);
    expect(r2.hit).toBe(true);
    expect(pb.health < 60 || !pb.alive).toBe(true);
  }, 10000);

  it('match ends on the score limit: matchEnd and phase reach both clients', async () => {
    const { room, a, b, pa, pb } = await duel({ mode: 'tdm', map: 'yard', postMatchSec: 2, onEnd: 'rotate' });
    const team = a.joined.team as Team;
    room.teamScores[team] = room.mode.scoreLimit - 1;
    place(pa, -1, 8);
    place(pb, -1, 0);
    await settleAds(a.client, 0);
    let shot = 0;
    for (let i = 0; i < 10 && pb.alive && room.phase === 'playing'; i++) {
      shoot(a.client, { x: -1, y: PLAYER.eye, z: 8 }, { x: -1, y: 1.15, z: 0 }, ++shot, room.time - 0.1);
      await sleep(150);
    }
    for (const c of [a.client, b.client]) {
      const end = await c.waitFor('matchEnd');
      expect(end.results.reason).toBe('score');
      expect(end.results.winnerTeam).toBe(team);
      expect(end.results.players.find((p) => p.id === a.id)).toMatchObject({ kills: 1, won: true });
      await c.waitFor('phase', (p) => p.phase === 'ended');
      expect((await c.waitFor('profile')).profile.stats.matches).toBe(1);
    }
    // No more damage after the end; then the room rotates into a fresh match.
    expect(room.phase).toBe('ended');
    const endedAt = room.time;
    const next = await a.client.waitFor('phase', (p) => p.phase === 'playing' && p.time > endedAt, 5000);
    expect(next.time - endedAt).toBeGreaterThan(1.5);
    expect(room.teamScores).toEqual([0, 0]);
    expect(a.client.all('spawned').length).toBeGreaterThanOrEqual(2);
  }, 15000);
});
