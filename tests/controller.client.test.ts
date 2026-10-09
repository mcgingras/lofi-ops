/**
 * Controller support, browser side: HUD prompt labels per device, the shared gamepad module
 * (device switching, USE prompt context), and a fake Gamepad driven through the real `Controls`
 * loop into the real `MatchNet` against a real server: the server applies the right buttons,
 * movement and look, the engage-without-pointer-lock path works, and Start pauses.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { MatchNet, type Net } from '../src/client/net';
import { Controls, KEYMAP } from '../src/client/game/controls';
import { gamepad, inputDevice, setInputDevice, setPadSource, usePromptActive } from '../src/client/game/gamepad';
import { PAD } from '../src/client/game/pad';
import { actionGlyph, promptKey, registerPromptKey } from '../src/client/game/prompts';
import { useKey } from '../src/client/hud/waypoints';
import { Buttons } from '../src/shared/input';
import { createMoveState } from '../src/shared/movement';
import type { ServerMessages, ServerMsgOf } from '../src/shared/protocol';
import { FakeClient, sleep } from './fake-client';

/** A mutable standard-mapping Gamepad. */
function fakePad() {
  const state = { buttons: new Array(17).fill(0) as number[], axes: [0, 0, 0, 0] };
  const pad = {
    id: 'Fake Xbox Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)',
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

let restorePad: (() => void) | null = null;
afterEach(() => {
  restorePad?.();
  restorePad = null;
  setInputDevice('kbm');
});

describe('prompt labels', () => {
  it('one function gives each action its label for the current device', () => {
    setInputDevice('kbm');
    expect(promptKey('use')).toBe('F'); // "HOLD F"
    expect(promptKey('streak', { brackets: true })).toBe('[4]'); // "[4] NAPALM"
    expect(promptKey('skip', { brackets: true })).toBe('[F]'); // "PRESS [F] TO SKIP"
    expect(promptKey('reload')).toBe('R');
    setInputDevice('pad');
    expect(inputDevice()).toBe('pad');
    expect(promptKey('use')).toBe('[X]'); // "HOLD [X]"
    expect(promptKey('streak', { brackets: true })).toBe('[↑]'); // "[↑] NAPALM"
    expect(promptKey('skip', { brackets: true })).toBe('[X]');
    expect(promptKey('streakNext', { brackets: true })).toBe('[→]');
    expect(promptKey('lethal')).toBe('[RB]');
    expect(promptKey('fire')).toBe('[RT]');
    expect(actionGlyph('use', 'kbm')).toBe('F');
  });

  it('keyboard labels follow rebinding and feature-owned keys', () => {
    const saved = { ...KEYMAP };
    try {
      delete KEYMAP.KeyF;
      KEYMAP.KeyE = 'use';
      expect(promptKey('use', { device: 'kbm' })).toBe('E');
      expect(promptKey('use', { device: 'pad' })).toBe('[X]');
    } finally {
      for (const k of Object.keys(KEYMAP)) delete KEYMAP[k];
      Object.assign(KEYMAP, saved);
    }
    registerPromptKey('classMenu', () => 'KeyB');
    expect(promptKey('classMenu', { device: 'kbm' })).toBe('B');
    expect(promptKey('classMenu', { device: 'pad' })).toBe('[Y]');
  });

  it('useKey() also marks a USE prompt as on screen', () => {
    setInputDevice('pad');
    expect(useKey()).toBe('[X]');
    expect(usePromptActive()).toBe(true);
  });
});

describe('gamepad module', () => {
  it('any pad input makes the pad the last-used device', () => {
    const fp = fakePad();
    restorePad = setPadSource(() => [null, fp.pad]);
    setInputDevice('kbm');
    expect(gamepad.snapshot()?.id).toContain('Fake Xbox');
    expect(inputDevice()).toBe('kbm'); // connected but idle (no input yet)
    fp.set({ axes: [0.05, 0.08, 0, 0] }); // drift
    expect(gamepad.snapshot()).not.toBeNull();
    expect(inputDevice()).toBe('kbm');
    fp.set({ buttons: { A: 1 } });
    // Polls are cached for ~2 ms.
    const until = performance.now() + 5;
    while (performance.now() < until) {
      /* wait out the cache */
    }
    gamepad.snapshot();
    expect(inputDevice()).toBe('pad');
  });
});

// -------------------------------------------------------------------------------------------
// Fake pad -> Controls -> MatchNet -> real server
// -------------------------------------------------------------------------------------------

let server: GameServer;
beforeAll(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
  // Just enough DOM for Controls (it only adds listeners here).
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g.window) g.window = new EventTarget();
  if (!g.document) g.document = Object.assign(new EventTarget(), { pointerLockElement: null, exitPointerLock() {} });
});
afterAll(async () => {
  await server.close();
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

/** The match loop's input path: controls.update, look applied, command sent. */
async function drive(c: Controls, mn: MatchNet, ms: number, onFrame?: () => void) {
  let last = performance.now();
  const t0 = last;
  while (performance.now() - t0 < ms) {
    await sleep(14);
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    c.update(dt);
    if (c.padLook) {
      c.yaw += c.padLook.yaw;
      c.pitch = Math.max(-1.5, Math.min(1.5, c.pitch + c.padLook.pitch));
    }
    onFrame?.();
    mn.input(c.locked ? c.buttons() : 0, c.yaw, c.pitch, 0, dt);
    mn.flush();
  }
  mn.flush(true);
}

it('a fake gamepad through the controls loop produces the right input commands on the server', async () => {
  const room = server.lobby.createRoom({ mode: 'ffa', map: 'yard', closeWhenEmpty: true, countdownSec: 0, botFill: 0 });
  const { client, welcome } = await FakeClient.connect(server.url, 'PadPlayer');
  const fp = fakePad();
  restorePad = setPadSource(() => [fp.pad]);
  const controls = new Controls(canvasStub);
  try {
    client.send({ t: 'joinRoom', roomId: room.id });
    const joined = await client.waitFor('joined');
    const mn = new MatchNet(adapterFor(client), joined);
    const sp = await client.waitFor('spawned');
    mn.predictor.reset({ ...createMoveState(sp.x, sp.y, sp.z), onGround: true });
    await client.waitFor('snap', (s) => s.phase === 'playing' && !!s.me?.alive, 5000);
    const p = room.players.get(welcome.sessionId)!;
    controls.yaw = sp.yaw;

    // Engage from the pad: no pointer lock needed, and the A that engaged doesn't jump.
    fp.set({ buttons: { A: 1 } });
    setInputDevice('pad');
    controls.requestLock();
    expect(controls.locked).toBe(true);
    expect(controls.virtualLock).toBe(true);
    controls.update(1 / 60);
    expect(controls.buttons() & Buttons.JUMP).toBe(0);

    // Left stick forward, right stick right, RT pulled, LB held.
    fp.set({ axes: [0, -1, 0.8, 0], buttons: { RT: 1, LB: 1 } });
    const yaw0 = controls.yaw;
    await drive(controls, mn, 1200);
    await client.waitFor('snap', (s) => s.ack >= mn.seq, 3000);
    expect(p.buttons & Buttons.FORWARD).toBe(Buttons.FORWARD);
    expect(p.buttons & Buttons.FIRE).toBe(Buttons.FIRE);
    expect(p.buttons & Buttons.TACTICAL).toBe(Buttons.TACTICAL);
    expect(p.buttons & (Buttons.BACK | Buttons.JUMP | Buttons.ADS)).toBe(0);
    expect(controls.yaw).toBeLessThan(yaw0 - 0.5); // turned right
    expect(Math.abs(p.yaw - controls.yaw)).toBeLessThan(0.01);
    const moved = Math.hypot(p.move.x - sp.x, p.move.z - sp.z);
    expect(moved).toBeGreaterThan(1.5);
    // Prediction (same commands through movement.ts) agrees with the server.
    const pr = mn.predictor.state;
    expect(Math.hypot(pr.x - p.move.x, pr.z - p.move.z)).toBeLessThan(0.5);

    // X: reload press (consumed like the R key) and USE held while down.
    let reloads = 0;
    fp.set({ buttons: { X: 1 } });
    await drive(controls, mn, 250, () => {
      if (controls.consume('reload')) reloads++;
    });
    await client.waitFor('snap', (s) => s.ack >= mn.seq, 3000);
    expect(reloads).toBe(1);
    expect(p.buttons & Buttons.USE).toBe(Buttons.USE);

    // Y switches weapon, D-pad right cycles streaks (queued presses).
    fp.set();
    await drive(controls, mn, 60);
    fp.set({ buttons: { Y: 1, RIGHT: 1 } });
    let next = 0;
    let streak = 0;
    await drive(controls, mn, 100, () => {
      if (controls.consume('weaponNext')) next++;
      if (controls.consume('streakNext')) streak++;
    });
    expect([next, streak]).toEqual([1, 1]);

    // Start pauses: unlocked, nothing goes out.
    fp.set();
    await drive(controls, mn, 60);
    fp.set({ buttons: { START: 1 }, axes: [0, -1, 0, 0] });
    await drive(controls, mn, 200);
    expect(controls.locked).toBe(false);
    await client.waitFor('snap', (s) => s.ack >= mn.seq, 3000);
    expect(p.buttons).toBe(0);
    mn.dispose();
  } finally {
    controls.dispose();
    client.close();
  }
}, 20000);
