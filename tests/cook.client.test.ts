/**
 * The frag cook timer: the shared fuse maths, and the HUD's timer (anchored on the server's
 * `weapons.cook` ack through the client's frame history, `client/features/weapons/cook.ts`)
 * reaching zero on the same tick the server blows the grenade up in the hand, with the keyboard
 * press arriving at once or in bursts. Driven through a Room tick by tick with input commands, the
 * way the network feeds them.
 */
import { afterEach, describe, expect, it } from 'vitest';
import weaponsFeature from '../src/server/features/weapons/index';
import { wext } from '../src/server/features/weapons/state';
import { Lobby } from '../src/server/lobby';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { Store } from '../src/server/store';
import { TICK_DT } from '../src/shared/constants';
import { COOK, cookLeft, cookTickTimes, cookTicksBetween, cookWarning, EQUIPMENT_BY_ID, NADE_ENTITY } from '../src/shared/defs/equipment';
import { Buttons, type InputCmd } from '../src/shared/input';
import { cloneLoadout, DEFAULT_LOADOUTS } from '../src/shared/loadout';
import { createMoveState } from '../src/shared/movement';
import { frameTimeOfSeq, pushFrame, type FrameSeq } from '../src/client/features/weapons/cook';

const FRAG = EQUIPMENT_BY_ID.get('frag')!;

describe('cook maths (shared by the server fuse and the HUD)', () => {
  it('counts the fuse down from the press and never below zero', () => {
    expect(FRAG.cookable).toBe(true);
    expect(cookLeft(3, 0)).toBe(3);
    expect(cookLeft(3, 1.25)).toBeCloseTo(1.75, 9);
    expect(cookLeft(3, 3)).toBe(0);
    expect(cookLeft(3, 9)).toBe(0);
    expect(cookLeft(3, -1)).toBe(3);
  });

  it('flashes the last second only', () => {
    expect(COOK.warnSec).toBe(1);
    expect(cookWarning(3, 1.9)).toBe(false);
    expect(cookWarning(3, 2)).toBe(true);
    expect(cookWarning(3, 2.99)).toBe(true);
    expect(cookWarning(3, 3)).toBe(false); // gone off
  });

  it('ticks once a second, then four times a second in the last second', () => {
    expect(cookTickTimes(3)).toEqual([1, 2, 2.25, 2.5, 2.75]);
    expect(cookTickTimes(4)).toEqual([1, 2, 3, 3.25, 3.5, 3.75]);
    expect(cookTicksBetween(3, 0, 0.99)).toBe(0);
    expect(cookTicksBetween(3, 0.99, 1.01)).toBe(1);
    expect(cookTicksBetween(3, 1.9, 2.6)).toBe(3);
  });

  it('maps an acked seq back to the frame that sent it (frames can carry several commands)', () => {
    const frames: FrameSeq[] = [];
    pushFrame(frames, 10, 1.0);
    pushFrame(frames, 13, 1.1); // a long frame split into 3 commands (11..13)
    pushFrame(frames, 13, 1.12); // no new input: not recorded
    pushFrame(frames, 14, 1.13);
    expect(frames).toHaveLength(3);
    expect(frameTimeOfSeq(frames, 12)).toBe(1.1);
    expect(frameTimeOfSeq(frames, 14)).toBe(1.13);
    expect(frameTimeOfSeq(frames, 15)).toBeNull();
    expect(frameTimeOfSeq(frames, 2)).toBeNull(); // older than the history
  });
});

let lobby: Lobby | undefined;
let store: Store | undefined;
afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = store = undefined;
});

/** A "human" with a frag, fed commands like the network does; `frame()` = one client frame. */
function cookRig(opts: { burst?: number } = {}) {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: [weaponsFeature], log: () => {}, autoTick: false });
  const room: Room = lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false });
  const a: PlayerState = room.addBot({ name: 'Cook', team: 0, loadout: { ...cloneLoadout(DEFAULT_LOADOUTS[0]!), lethal: 'frag' } });
  a.isBot = false;
  for (let i = 0; i < 6; i++) room.step();
  if (!a.alive) room.spawn(a);
  a.move = { ...createMoveState(-1, 0, 20), onGround: true };
  const acks: { seq: number; fuse: number; at: number }[] = [];
  const send = room.sendFeature.bind(room);
  room.sendFeature = ((p, id, data) => {
    if (id === 'weapons.cook') acks.push({ ...(data as { seq: number; fuse: number }), at: room.time });
    return send(p, id, data);
  }) as Room['sendFeature'];
  let booms = 0;
  room.bus.on('death', ({ victim }) => {
    if (victim === a) booms++;
  });
  const frames: FrameSeq[] = [];
  let seq = a.lastSeq;
  let t = 0;
  let pending: InputCmd[] = [];
  const burst = opts.burst ?? 1;
  let n = 0;
  return {
    room,
    a,
    acks,
    frames,
    booms: () => booms,
    now: () => t,
    /** One client frame: send the buttons; the server gets them `burst` frames at a time. */
    frame(buttons: number) {
      seq++;
      t += TICK_DT;
      pending.push({ seq, dt: TICK_DT, buttons, yaw: 0, pitch: 0, weaponSlot: 0 });
      pushFrame(frames, seq, t);
      if (++n % burst === 0) {
        room.queueInputs(a, pending);
        pending = [];
      }
      room.step();
    },
  };
}

/** The HUD's view after the ack: fuse left at local time `now`. */
const hudLeft = (r: ReturnType<typeof cookRig>, now: number) => {
  const ack = r.acks[0]!;
  const since = frameTimeOfSeq(r.frames, ack.seq)!;
  return cookLeft(ack.fuse, now - since);
};

describe('cook timer against the server fuse', () => {
  it('the ack names the press command, and the HUD hits zero on the tick the frag goes off in the hand', () => {
    const r = cookRig();
    for (let i = 0; i < 5; i++) r.frame(0);
    r.frame(Buttons.LETHAL);
    expect(r.acks).toHaveLength(1);
    expect(r.acks[0]!.seq).toBe(r.frames[r.frames.length - 1]!.seq);
    expect(r.acks[0]!.fuse).toBe(FRAG.fuse);
    expect(frameTimeOfSeq(r.frames, r.acks[0]!.seq)).toBeCloseTo(r.now(), 9);
    let hudZero = -1;
    let boom = -1;
    for (let i = 1; i < 400 && boom < 0; i++) {
      r.frame(Buttons.LETHAL);
      if (hudZero < 0 && hudLeft(r, r.now()) <= 0) hudZero = i;
      if (r.booms() > 0) boom = i;
    }
    expect(boom).toBeGreaterThan(0);
    expect(Math.abs(hudZero - boom)).toBeLessThanOrEqual(1);
    expect(Math.abs(boom * TICK_DT - FRAG.fuse)).toBeLessThanOrEqual(TICK_DT * 1.01);
  });

  it('letting go while the HUD still shows time throws it; the server never cooks it off in the hand', () => {
    const r = cookRig();
    r.frame(0);
    r.frame(Buttons.LETHAL);
    while (hudLeft(r, r.now() + TICK_DT) > 0) r.frame(Buttons.LETHAL);
    expect(hudLeft(r, r.now())).toBeGreaterThan(0);
    r.frame(0); // release on the last frame with time left
    expect(r.booms()).toBe(0);
    expect(wext(r.a).throwing).toBeNull();
    const nade = r.room.entities.byKind(NADE_ENTITY);
    expect(nade).toHaveLength(1);
    // Thrown nearly cooked: it pops almost at once (what cooking is for).
    const data = nade[0]!.data as { explodeAt: number };
    expect(data.explodeAt - r.room.time).toBeLessThan(0.1);
  });

  it('commands arriving in bursts (a laggy link) only make the HUD early, never late', () => {
    const r = cookRig({ burst: 3 });
    for (let i = 0; i < 4; i++) r.frame(0);
    r.frame(Buttons.LETHAL);
    let hudZero = -1;
    let boom = -1;
    for (let i = 1; i < 400 && boom < 0; i++) {
      r.frame(Buttons.LETHAL);
      if (r.acks.length && hudZero < 0 && hudLeft(r, r.now()) <= 0) hudZero = i;
      if (r.booms() > 0) boom = i;
    }
    expect(hudZero).toBeGreaterThan(0);
    expect(hudZero).toBeLessThanOrEqual(boom);
    expect(boom - hudZero).toBeLessThanOrEqual(3);
  });
});
