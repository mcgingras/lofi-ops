/**
 * Knockback (`MoveState.knock`, `applyKnock`; the Thundergun's launch): the shared movement keeps
 * the impulse (no input control, no jump, sprint or mantle, a slide once grounded) and gives control
 * back; the local player's prediction (`Predictor`) replays a knocked flight exactly as the server
 * steps it, and over real sockets a launched player's client reconciles onto the server's flight
 * without fighting it (only the first snapshot that carries the launch corrects it).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { configureRoomBots } from '../src/server/features/bots/api';
import { launch } from '../src/server/features/weapons/wonder/index';
import { Predictor } from '../src/client/netcode/predict';
import { TICK_DT } from '../src/shared/constants';
import { getMapData } from '../src/shared/defs/maps';
import { thunderLaunch, THUNDERGUN } from '../src/shared/defs/wonder';
import { Buttons, type InputCmd } from '../src/shared/input';
import { buildCollisionWorld } from '../src/shared/maps/types';
import { applyKnock, copyMoveState, createMoveState, DEFAULT_MOVE_PARAMS, stepMove, type MoveState } from '../src/shared/movement';
import { FakeClient, sleep } from './fake-client';

const yard = () => buildCollisionWorld(getMapData('yard'));
const grounded = (x: number, z: number): MoveState => ({ ...createMoveState(x, 0, z), onGround: true });

describe('knockback in the shared movement', () => {
  it('carries the impulse with no control, then slides to a stop and hands control back', () => {
    const world = yard();
    const s = grounded(0, 20);
    applyKnock(s, { x: 14, y: 6, z: 0 }, THUNDERGUN.knockSec);
    expect(s.onGround).toBe(false);
    expect(s.knock).toBe(THUNDERGUN.knockSec);
    // Holding back and jumping does nothing while knocked.
    const ref = copyMoveState(s);
    for (let i = 0; i < 20; i++) stepMove(world, s, Buttons.BACK | Buttons.JUMP | Buttons.SPRINT, 0, TICK_DT);
    for (let i = 0; i < 20; i++) stepMove(world, ref, 0, 0, TICK_DT);
    expect(s.x).toBeCloseTo(ref.x, 6);
    expect(s.y).toBeCloseTo(ref.y, 6);
    expect(s.sprinting).toBe(false);
    // Flies on, lands, slides; control comes back and walking works again.
    let t = 0;
    while ((s.knock > 0 || !s.onGround) && t < 4) {
      stepMove(world, s, Buttons.BACK, 0, TICK_DT);
      t += TICK_DT;
    }
    expect(s.knock).toBe(0);
    expect(s.onGround).toBe(true);
    expect(s.x).toBeGreaterThan(6);
    const x = s.x;
    for (let i = 0; i < 30; i++) stepMove(world, s, Buttons.FORWARD, -Math.PI / 2, TICK_DT); // yaw -PI/2 walks +x
    expect(s.x).toBeGreaterThan(x + 1);
  });

  it('a knock cancels a mantle or dive and adds to the current velocity', () => {
    const s = grounded(0, 0);
    s.dive = 0.3;
    s.mantle = { t: 0, dur: 0.5, from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 1, z: -1 }, over: false };
    s.vx = 2;
    applyKnock(s, { x: 3, y: 0, z: 0 }, 0.4);
    expect(s.mantle).toBeNull();
    expect(s.dive).toBe(0);
    expect(s.vx).toBe(5);
    expect(s.onGround).toBe(true); // a flat shove slides along the ground
  });

  it('the Predictor replays a knocked flight exactly like the server steps it', () => {
    const world = yard();
    const server = grounded(-10, 20);
    const pred = new Predictor(world);
    pred.reset(server);
    // The player holds forward (into the blast) the whole time.
    const cmds: InputCmd[] = [];
    let seq = 0;
    const cmd = (): InputCmd => ({ seq: ++seq, dt: TICK_DT, buttons: Buttons.FORWARD | Buttons.SPRINT, yaw: Math.PI / 2, pitch: 0, weaponSlot: 0 });
    for (let i = 0; i < 6; i++) {
      const c = cmd();
      cmds.push(c);
      pred.apply(c);
      stepMove(world, server, c.buttons, c.yaw, c.dt, DEFAULT_MOVE_PARAMS);
    }
    // The server launches the body between commands 6 and 7 (the client doesn't know yet).
    applyKnock(server, thunderLaunch({ x: -16, y: 1.5, z: 20 }, { x: 1, y: 0, z: 0 }, { x: server.x, y: 1, z: server.z }, 6), THUNDERGUN.knockSec);
    const acked = copyMoveState(server);
    // The client keeps predicting (unknocked) for a round trip...
    for (let i = 0; i < 8; i++) {
      const c = cmd();
      cmds.push(c);
      pred.apply(c);
    }
    // ...then the snapshot that acked command 6 arrives carrying the launch: the replay of 7..14 is
    // exactly the server's flight.
    const first = pred.reconcile(6, acked, DEFAULT_MOVE_PARAMS);
    expect(first).toBeGreaterThan(0.5); // the launch itself is a correction (the client couldn't know)
    const truth = copyMoveState(acked);
    for (const c of cmds.slice(6)) stepMove(world, truth, c.buttons, c.yaw, c.dt, DEFAULT_MOVE_PARAMS);
    expect(pred.state.x).toBeCloseTo(truth.x, 6);
    expect(pred.state.y).toBeCloseTo(truth.y, 6);
    expect(pred.state.knock).toBeCloseTo(truth.knock, 6);
    // Later snapshots during the flight agree with the prediction (no rubber-banding).
    for (const c of cmds.slice(6)) stepMove(world, server, c.buttons, c.yaw, c.dt, DEFAULT_MOVE_PARAMS);
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i < 3; i++) {
        const c = cmd();
        pred.apply(c);
        stepMove(world, server, c.buttons, c.yaw, c.dt, DEFAULT_MOVE_PARAMS);
      }
      expect(pred.reconcile(seq, copyMoveState(server), DEFAULT_MOVE_PARAMS)).toBeLessThan(1e-6);
    }
  });
});

describe('knockback over the wire', () => {
  let server: GameServer;
  beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
  });
  afterAll(async () => {
    await server.close();
  });

  it("a launched player's prediction follows the server's flight once the snapshot arrives", async () => {
    const room = server.lobby.createRoom({ mode: 'ffa', map: 'yard', closeWhenEmpty: false, private: true, countdownSec: 0, botFill: 0 });
    configureRoomBots(room, { fill: false });
    const { client, welcome } = await FakeClient.connect(server.url, 'Flyer');
    try {
      client.send({ t: 'joinRoom', roomId: room.id });
      const joined = await client.waitFor('joined');
      await client.waitFor('snap', (s) => s.phase === 'playing' && !!s.me?.alive, 6000);
      const me = room.players.get(welcome.sessionId)!;
      me.move = grounded(-10, 20);
      me.yaw = Math.PI / 2;
      const world = buildCollisionWorld(getMapData(joined.map));
      const pred = new Predictor(world);
      // Settle on the server's state first.
      for (let i = 0; i < 6; i++) {
        const c: InputCmd = { seq: ++client.seq, dt: 1 / 60, buttons: 0, yaw: Math.round((Math.PI / 2) * 8192) / 8192, pitch: 0, weaponSlot: 0 };
        pred.apply(c);
        client.send({ t: 'input', cmds: [c] });
        await sleep(17);
      }
      const s0 = await client.waitFor('snap', (s) => s.ack >= client.seq, 4000);
      pred.reset(s0.me!.move);
      pred.reconcile(s0.ack, s0.me!.move, s0.me!.params);
      // Launched by a blast (the server does it, as the Thundergun would).
      launch(room, me, null, { x: 12, y: 6, z: 0 }, THUNDERGUN.knockSec);
      const corrections: number[] = [];
      for (let i = 0; i < 40; i++) {
        const c: InputCmd = { seq: ++client.seq, dt: 1 / 60, buttons: Buttons.BACK, yaw: Math.round((Math.PI / 2) * 8192) / 8192, pitch: 0, weaponSlot: 0 };
        pred.apply(c);
        client.send({ t: 'input', cmds: [c] });
        await sleep(17);
        const snap = client.last('snap');
        if (snap?.me && snap.ack > 0 && (snap.me.move.knock > 0 || corrections.length)) corrections.push(pred.reconcile(snap.ack, snap.me.move, snap.me.params));
      }
      const last = client.seq;
      const end = await client.waitFor('snap', (s) => s.ack >= last, 4000);
      const final = pred.reconcile(end.ack, end.me!.move, end.me!.params);
      expect(corrections.length).toBeGreaterThan(3);
      // The first reconcile carries the launch; the rest of the flight is predicted.
      expect(corrections.slice(1).every((c) => c < 0.05)).toBe(true);
      expect(final).toBeLessThan(0.05);
      expect(end.me!.move.x).toBeGreaterThan(-10 + 4);
    } finally {
      client.close();
      room.close();
    }
  }, 20000);
});
