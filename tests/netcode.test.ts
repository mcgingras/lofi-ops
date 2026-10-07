/**
 * Client netcode (src/client/netcode/*, DOM-free): interpolation, clock sync, and prediction
 * reconciling against the real server over real sockets.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { ClockSync } from '../src/client/netcode/clock';
import { SnapshotBuffer } from '../src/client/netcode/interp';
import { Predictor } from '../src/client/netcode/predict';
import { getMapData } from '../src/shared/defs/maps';
import { Buttons } from '../src/shared/input';
import type { InputCmd } from '../src/shared/input';
import { buildCollisionWorld } from '../src/shared/maps/types';
import { createMoveState } from '../src/shared/movement';
import type { PlayerSnap } from '../src/shared/protocol';
import { FakeClient, sleep } from './fake-client';

const ps = (id: string, x: number, z: number, f = 1): PlayerSnap => ({ id, x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, f, w: 'ak47', c: 'none' });

describe('SnapshotBuffer', () => {
  it('draws remotes 100 ms behind, blending between snapshots', () => {
    const b = new SnapshotBuffer(0.1);
    b.push(10.0, [ps('a', 0, 0)], 100.0);
    b.push(10.05, [ps('a', 1, 0)], 100.05);
    b.push(10.1, [ps('a', 2, 0)], 100.1);
    const t = b.renderTime(100.125);
    expect(t).toBeCloseTo(10.025, 5);
    expect(b.sample('a', t)!.x).toBeCloseTo(0.5, 5);
  });

  it('never runs backwards and ignores late/duplicate snapshots', () => {
    const b = new SnapshotBuffer(0.1);
    b.push(5, [ps('a', 0, 0)], 50);
    b.push(5.05, [ps('a', 1, 0)], 50.2); // arrived late: offset keeps the quickest delivery
    const t1 = b.renderTime(50.2);
    b.push(5.0, [ps('a', 9, 0)], 50.21);
    const t2 = b.renderTime(50.2);
    expect(t2).toBeGreaterThanOrEqual(t1);
    expect(b.sample('a', 5.025)!.x).toBeCloseTo(0.5, 5);
  });

  it('snaps across teleports and extrapolates a little past the newest snapshot', () => {
    const b = new SnapshotBuffer(0.1, 0.1);
    b.push(1, [ps('a', 0, 0)], 1);
    b.push(1.05, [ps('a', 20, 0)], 1.05);
    expect(b.sample('a', 1.04)!.x).toBe(20);
    const moving = { ...ps('a', 20, 0), vx: 5 };
    b.push(1.1, [moving], 1.1);
    expect(b.sample('a', 1.15)!.x).toBeCloseTo(20.25, 5);
    expect(b.sample('a', 2)!.x).toBeCloseTo(20.5, 5);
  });

  it('resets when room time restarts (new room)', () => {
    const b = new SnapshotBuffer();
    b.push(500, [ps('a', 0, 0)], 10);
    b.push(1, [ps('b', 0, 0)], 11);
    expect(b.ids(1)).toEqual(['b']);
  });
});

describe('ClockSync', () => {
  it('estimates room time from the quickest pongs', () => {
    const c = new ClockSync();
    c.onPong(0, 100.05, 0.1); // rtt 100 ms: room time 100.1 at local 0.1
    c.onPong(1, 101.02, 1.04); // rtt 40 ms: 101.04 at 1.04
    c.onPong(2, 102.2, 2.4); // rtt 400 ms, distorted
    expect(c.now(3)).toBeGreaterThan(102.9);
    expect(c.now(3)).toBeLessThan(103.1);
  });
});

describe('prediction against the real server', () => {
  let server: GameServer;
  beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
  });
  afterAll(async () => {
    await server.close();
  });

  it('replays unacked inputs and lands where the server does', async () => {
    const { client } = await FakeClient.connect(server.url, 'Runner');
    client.send({ t: 'quickplay', mode: 'ffa', map: 'yard' });
    const joined = await client.waitFor('joined');
    const spawned = await client.waitFor('spawned');
    const world = buildCollisionWorld(getMapData(joined.map));
    const pred = new Predictor(world);
    pred.reset({ ...createMoveState(spawned.x, spawned.y, spawned.z), onGround: true });
    const snap0 = await client.waitFor('snap', (s) => !!s.me?.alive && s.phase === 'playing');
    pred.reconcile(snap0.ack, snap0.me!.move, snap0.me!.params);

    // Run around: forward + strafe + a jump + sprint, at uneven frame times, batched.
    const dts = [1 / 60, 1 / 144, 1 / 30, 0.05, 1 / 75];
    let yaw = spawned.yaw;
    // Inputs go at real time (as a browser sends them); faster would trip the server's speed guard.
    for (let i = 0; i < 70; i++) {
      yaw += 0.01;
      let b = Buttons.FORWARD;
      if (i % 40 < 20) b |= Buttons.LEFT;
      if (i % 50 === 10) b |= Buttons.JUMP;
      if (i > 35) b |= Buttons.SPRINT;
      const dt = dts[i % dts.length]!;
      const cmd: InputCmd = { seq: ++client.seq, dt, buttons: b, yaw: Math.round(yaw * 8192) / 8192, pitch: 0, weaponSlot: 0 };
      pred.apply(cmd);
      client.send({ t: 'input', cmds: [cmd] });
      await sleep(dt * 1000);
    }
    // Let the server catch up, then reconcile with a snapshot that acked everything.
    const last = client.seq;
    const snap = await client.waitFor('snap', (s) => s.ack >= last, 8000);
    const before = { ...pred.state };
    const correction = pred.reconcile(snap.ack, snap.me!.move, snap.me!.params);
    expect(pred.pendingCount).toBe(0);
    expect(correction).toBeLessThan(0.01);
    expect(Math.hypot(before.x - snap.me!.move.x, before.z - snap.me!.move.z)).toBeLessThan(0.01);
    expect(Math.hypot(before.x - spawned.x, before.z - spawned.z)).toBeGreaterThan(3);
    client.close();
  });

  it('eases small corrections and snaps big ones', () => {
    const world = buildCollisionWorld(getMapData('yard'));
    const pred = new Predictor(world);
    pred.reset({ ...createMoveState(0, 0, 4), onGround: true });
    pred.reconcile(0, { ...createMoveState(0.2, 0, 4), onGround: true }, pred.params);
    expect(pred.error.x).toBeCloseTo(-0.2, 5);
    pred.decay(0.5);
    expect(Math.abs(pred.error.x)).toBeLessThan(0.01);
    pred.reconcile(0, { ...createMoveState(5, 0, 4), onGround: true }, pred.params);
    expect(pred.error.x).toBe(0);
    expect(pred.shown().x).toBe(5);
  });
});
