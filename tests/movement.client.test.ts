/**
 * Prone controls and remote poses, browser side (docs/features/movement.md): the keyboard stance
 * toggles (Z, C, Space, the dive), the controller's B tap / hold and dive through the real
 * `Controls` loop into a real `MatchNet` against a real server, and other players seeing someone
 * lie down (the PRONE flag through snapshots into the remote soldier's pose).
 */
import * as THREE from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { Controls, STANCE_SYNC_SEC } from '../src/client/game/controls';
import { setInputDevice, setPadSource } from '../src/client/game/gamepad';
import { PAD } from '../src/client/game/pad';
import { Remotes } from '../src/client/game/remotes';
import { MatchNet, type Net } from '../src/client/net';
import { PRONE } from '../src/shared/constants';
import { Buttons } from '../src/shared/input';
import { createMoveState } from '../src/shared/movement';
import { PlayerFlags, type ServerMessages, type ServerMsgOf } from '../src/shared/protocol';
import { FakeClient, sleep } from './fake-client';

function fakePad() {
  const state = { buttons: new Array(17).fill(0) as number[], axes: [0, 0, 0, 0] };
  const pad = {
    id: 'Fake Xbox Controller (STANDARD GAMEPAD)',
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    get buttons() {
      return state.buttons.map((v) => ({ pressed: v >= 0.5, touched: v > 0, value: v }));
    },
    get axes() {
      return state.axes.slice();
    },
    vibrationActuator: null,
  };
  return {
    pad: pad as unknown as Gamepad,
    set(over: { buttons?: Partial<Record<keyof typeof PAD, number>>; axes?: number[] } = {}) {
      state.buttons = new Array(17).fill(0);
      for (const [k, v] of Object.entries(over.buttons ?? {})) state.buttons[PAD[k as keyof typeof PAD]] = v;
      state.axes = over.axes ?? [0, 0, 0, 0];
    },
  };
}

let server: GameServer;
let restorePad: (() => void) | null = null;
beforeAll(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g.window) g.window = new EventTarget();
  if (!g.document) g.document = Object.assign(new EventTarget(), { pointerLockElement: null, exitPointerLock() {} });
  // A do-nothing 2D canvas, enough for the soldier's placeholder textures (nothing is drawn here).
  const doc = g.document as Record<string, unknown>;
  if (typeof doc.createElement !== 'function') {
    const ctx: unknown = new Proxy({}, { get: (_t, k) => (k === 'getImageData' || k === 'createImageData' ? () => ({ data: new Uint8ClampedArray(4 * 64 * 64), width: 64, height: 64 }) : () => ctx), set: () => true });
    doc.createElement = () => ({ width: 1, height: 1, style: {}, getContext: () => ctx, toDataURL: () => '' });
  }
});
afterAll(async () => {
  await server.close();
});
afterEach(() => {
  restorePad?.();
  restorePad = null;
  setInputDevice('kbm');
});

function adapterFor(client: FakeClient): Net {
  return {
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
}

const canvasStub = { requestPointerLock() {} } as unknown as HTMLElement;
const key = (type: 'keydown' | 'keyup', code: string) => window.dispatchEvent(Object.assign(new Event(type), { code, repeat: false, ctrlKey: false }));
const tap = (code: string) => {
  key('keydown', code);
  key('keyup', code);
};

/** The match loop's input path: stance hint from prediction, controls.update, command sent. */
async function drive(c: Controls, mn: MatchNet, ms: number, onFrame?: () => void) {
  let last = performance.now();
  const t0 = last;
  while (performance.now() - t0 < ms) {
    await sleep(14);
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    const st = mn.predictor.state;
    c.stanceHint = { sprinting: st.sprinting, onGround: st.onGround, prone: st.prone, crouched: st.crouched };
    c.update(dt);
    onFrame?.();
    mn.input(c.locked ? c.buttons() : 0, c.yaw, c.pitch, 0, dt);
    mn.flush();
  }
  mn.flush(true);
}

async function joinPlayer(name: string, roomId: string) {
  const { client, welcome } = await FakeClient.connect(server.url, name);
  client.send({ t: 'joinRoom', roomId });
  const joined = await client.waitFor('joined');
  const mn = new MatchNet(adapterFor(client), joined);
  const sp = await client.waitFor('spawned');
  mn.predictor.reset({ ...createMoveState(sp.x, sp.y, sp.z), onGround: true });
  await client.waitFor('snap', (s) => s.phase === 'playing' && !!s.me?.alive, 5000);
  return { client, id: welcome.sessionId, mn, sp };
}

describe('keyboard stance toggles (pure Controls)', () => {
  it('Z toggles prone, C from prone crouches, Space from prone stands without jumping, crouch/prone while sprinting dives', () => {
    const c = new Controls(canvasStub);
    try {
      c.stanceHint = { sprinting: false, onGround: true, prone: false, crouched: false };
      tap('KeyZ');
      expect(c.buttons() & Buttons.PRONE).toBe(Buttons.PRONE);
      tap('KeyZ');
      expect(c.buttons() & Buttons.PRONE).toBe(0);
      tap('KeyZ');
      key('keydown', 'KeyC'); // C held (hold-to-crouch): from prone, crouch
      expect(c.buttons() & (Buttons.PRONE | Buttons.CROUCH)).toBe(Buttons.CROUCH);
      key('keyup', 'KeyC');
      tap('KeyZ');
      key('keydown', 'Space'); // from prone: stand up, no jump while Space stays down
      expect(c.buttons() & (Buttons.PRONE | Buttons.JUMP)).toBe(0);
      key('keyup', 'Space');
      key('keydown', 'Space'); // a fresh press jumps again
      expect(c.buttons() & Buttons.JUMP).toBe(Buttons.JUMP);
      key('keyup', 'Space');
      // Sprinting: C or Z dives (prone latched).
      c.stanceHint = { sprinting: true, onGround: true, prone: false, crouched: false };
      key('keydown', 'KeyC');
      expect(c.buttons() & (Buttons.PRONE | Buttons.CROUCH)).toBe(Buttons.PRONE);
      key('keyup', 'KeyC');
      expect(c.buttons() & Buttons.PRONE).toBe(Buttons.PRONE);
    } finally {
      c.dispose();
    }
  });

  it('a prone toggle the body refused (no room) gives way after a moment', () => {
    const c = new Controls(canvasStub);
    try {
      c.stanceHint = { sprinting: false, onGround: true, prone: false, crouched: false };
      tap('KeyZ');
      c.update(STANCE_SYNC_SEC * 0.5);
      expect(c.buttons() & Buttons.PRONE).toBe(Buttons.PRONE);
      c.update(STANCE_SYNC_SEC * 0.6);
      expect(c.buttons() & Buttons.PRONE).toBe(0);
      // Z again tries again.
      tap('KeyZ');
      expect(c.buttons() & Buttons.PRONE).toBe(Buttons.PRONE);
    } finally {
      c.dispose();
    }
  });
});

describe('stance controls against a real server', () => {
  it('keyboard Z: the server player lies down, crawls slowly, and Z again stands', async () => {
    const room = server.lobby.createRoom({ mode: 'ffa', map: 'yard', closeWhenEmpty: true, countdownSec: 0, botFill: 0 });
    const { client, id, mn, sp } = await joinPlayer('KeyPlayer', room.id);
    const c = new Controls(canvasStub);
    try {
      const p = room.players.get(id)!;
      c.yaw = sp.yaw;
      setInputDevice('pad');
      c.requestLock(); // engaged without pointer lock
      setInputDevice('kbm');
      expect(c.locked).toBe(true);
      tap('KeyZ');
      await drive(c, mn, 1100);
      await client.waitFor('snap', (s) => s.ack >= mn.seq, 3000);
      expect(p.move.prone).toBe(true);
      expect(p.move.proneT).toBe(1);
      expect(mn.predictor.state.prone).toBe(true);
      tap('KeyZ');
      await drive(c, mn, 300);
      await client.waitFor('snap', (s) => s.ack >= mn.seq, 3000);
      expect(p.move.prone).toBe(false);
      mn.dispose();
    } finally {
      c.dispose();
      client.close();
    }
  }, 20000);

  it('controller: B held goes prone, B tap from prone crouches, A stands, B while sprinting dives', async () => {
    const room = server.lobby.createRoom({ mode: 'ffa', map: 'yard', closeWhenEmpty: true, countdownSec: 0, botFill: 0 });
    const { client, id, mn, sp } = await joinPlayer('PadProne', room.id);
    const fp = fakePad();
    restorePad = setPadSource(() => [fp.pad]);
    const c = new Controls(canvasStub);
    const acked = () => client.waitFor('snap', (s) => s.ack >= mn.seq, 3000);
    try {
      const p = room.players.get(id)!;
      c.yaw = sp.yaw;
      setInputDevice('pad');
      c.requestLock();
      fp.set();
      await drive(c, mn, 60);
      // Hold B: crouch at once, prone after 0.35 s.
      fp.set({ buttons: { B: 1 } });
      await drive(c, mn, 500);
      fp.set();
      await drive(c, mn, 900);
      await acked();
      expect(p.move.prone).toBe(true);
      // Tap B: prone -> crouch.
      fp.set({ buttons: { B: 1 } });
      await drive(c, mn, 60);
      fp.set();
      await drive(c, mn, 900);
      await acked();
      expect({ server: p.move.prone, predicted: mn.predictor.state.prone, buttons: p.buttons }).toEqual({ server: false, predicted: false, buttons: Buttons.CROUCH });
      expect(p.move.crouched).toBe(true);
      // Down again, then A stands up (no jump).
      fp.set({ buttons: { B: 1 } });
      await drive(c, mn, 500);
      fp.set();
      await drive(c, mn, 900);
      fp.set({ buttons: { A: 1 } });
      await drive(c, mn, 100);
      fp.set();
      await drive(c, mn, 1100);
      await acked();
      expect(p.move.prone).toBe(false);
      expect(p.move.crouched).toBe(false);
      // Sprint (L3 + forward), then tap B: a dive forward that lands prone.
      fp.set({ buttons: { L3: 1 }, axes: [0, -1, 0, 0] });
      await drive(c, mn, 80);
      fp.set({ axes: [0, -1, 0, 0] });
      let dove = false;
      await drive(c, mn, 700);
      expect(p.move.sprinting).toBe(true);
      fp.set({ buttons: { B: 1 }, axes: [0, -1, 0, 0] });
      await drive(c, mn, 80, () => {
        if (mn.predictor.state.dive > 0) dove = true;
      });
      fp.set();
      await drive(c, mn, 1200, () => {
        if (mn.predictor.state.dive > 0) dove = true;
      });
      await acked();
      expect(dove).toBe(true);
      expect(p.move.prone).toBe(true);
      // Prediction agrees with the server through all of it.
      expect(Math.hypot(mn.predictor.state.x - p.move.x, mn.predictor.state.z - p.move.z)).toBeLessThan(0.3);
      mn.dispose();
    } finally {
      c.dispose();
      client.close();
    }
  }, 30000);

  it("other players see someone lie down: the PRONE flag reaches them and the soldier's pose follows", async () => {
    const room = server.lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: true, countdownSec: 0, botFill: 0 });
    const a = await joinPlayer('Lier', room.id);
    const b = await joinPlayer('Watcher', room.id);
    const scene = new THREE.Scene();
    const remotes = new Remotes(scene);
    try {
      let seq = 0;
      const t0 = performance.now();
      let lastFrame = t0;
      let flagged = false;
      while (performance.now() - t0 < 1600) {
        await sleep(16);
        a.client.send({ t: 'input', cmds: [{ seq: ++seq, dt: 1 / 60, buttons: Buttons.PRONE, yaw: 0, pitch: 0, weaponSlot: 0 }] });
        const now = performance.now();
        const dt = (now - lastFrame) / 1000;
        lastFrame = now;
        const rt = b.mn.renderTime();
        remotes.update(dt, rt, b.mn.interp, new Map(), b.id, null, now / 1000);
        const s = b.mn.interp.sample(a.id, rt);
        if (s && s.f & PlayerFlags.PRONE) flagged = true;
      }
      expect(flagged).toBe(true);
      const v = remotes.views.get(a.id)!;
      expect(v).toBeDefined();
      expect(v.prone).toBeGreaterThan(0.95);
      expect(v.soldier.lie.rotation.x).toBeCloseTo(Math.PI / 2, 1);
      // The lying soldier's head is near the player's position, the body trails behind it.
      expect(Math.abs(v.soldier.lie.position.z)).toBeGreaterThan(1.4);
      // Server side: the lag compensation history recorded the lying pose with its facing.
      const pose = room.history.poseAt(a.id, room.time - 0.05)!;
      expect(pose.prone).toBe(true);
      expect(pose.yaw).toBeCloseTo(0, 3);
      expect(PRONE.downSec).toBeGreaterThan(0);
    } finally {
      remotes.dispose();
      a.mn.dispose();
      b.mn.dispose();
      a.client.close();
      b.client.close();
    }
  }, 20000);
});
