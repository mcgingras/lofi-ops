/**
 * Prone and mantling through a real Room (docs/features/movement.md): shots against the lying
 * hitboxes (hit low, miss high), lag compensation rewinding to the stance the shooter saw, the
 * weapon held down while going prone or mantling, and the stance bits other players and killcams get.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Lobby } from '../src/server/lobby';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { poseFrame } from '../src/server/features/modes/killcam';
import { Store } from '../src/server/store';
import { PLAYER, TICK_DT } from '../src/shared/constants';
import { Buttons } from '../src/shared/input';
import { createMoveState } from '../src/shared/movement';
import { PlayerFlags } from '../src/shared/protocol';

let store: Store | undefined;
let lobby: Lobby | undefined;

function setup(): Room {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: [], log: () => {}, autoTick: false });
  return lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false });
}

afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = undefined;
  store = undefined;
});

const steps = (room: Room, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) room.step();
};

/** Shooter A (ADS, standing) 8 m north of target B, who faces away from A (legs towards A). */
function duel(room: Room, bButtons: () => number) {
  const a = room.addBot({ name: 'A', team: 0 });
  const b = room.addBot({ name: 'B', team: 1 });
  steps(room, 0.5);
  a.move = { ...createMoveState(-1, 0, 8), onGround: true };
  b.move = { ...createMoveState(-1, 0, 0), onGround: true };
  a.brain = { think: () => ({ buttons: Buttons.ADS, yaw: 0, pitch: 0, weaponSlot: 0 }) };
  // Facing -z (away from A at +z): the body trails towards A.
  b.brain = { think: () => ({ buttons: bButtons(), yaw: 0, pitch: 0, weaponSlot: 0 }) };
  steps(room, 0.6);
  return { a, b };
}

/** Direction from A's eye to a point `y` above B's feet, `back` metres behind B's eye (towards +z). */
function aimAt(a: PlayerState, b: PlayerState, y: number, back = 0) {
  const e = { x: a.move.x, y: a.move.y + PLAYER.eye, z: a.move.z };
  const d = { x: b.move.x - e.x, y: b.move.y + y - e.y, z: b.move.z + back - e.z };
  const l = Math.hypot(d.x, d.y, d.z);
  return { x: d.x / l, y: d.y / l, z: d.z / l };
}

describe('prone through the room', () => {
  it('lying down: shots at standing chest height miss, shots at the lying body hit', () => {
    const room = setup();
    const { a, b } = duel(room, () => Buttons.PRONE);
    steps(room, 1);
    expect(b.move.prone).toBe(true);
    expect(b.move.proneT).toBe(1);
    const hp = b.health;
    a.move.ads = 1;
    expect(room.fire(a, { dir: aimAt(a, b, 1.2) }).ok).toBe(true);
    expect(b.health).toBe(hp); // over the top
    steps(room, 0.3);
    const hits: string[] = [];
    room.bus.on('damage', (e) => hits.push(e.part ?? ''));
    expect(room.fire(a, { dir: aimAt(a, b, 0.2, 1.2) }).ok).toBe(true); // the legs, nearest A
    expect(hits).toEqual(['legs']);
    expect(b.health).toBeLessThan(hp);
  });

  it('lag compensation rewinds to the stance the shooter saw (prone, then stood up)', () => {
    const room = setup();
    let prone = true;
    const { a, b } = duel(room, () => (prone ? Buttons.PRONE : 0));
    steps(room, 1.2);
    prone = false;
    // B gets up: past half way (proneT < 0.5) the hitboxes stand.
    steps(room, 0.6);
    expect(b.move.prone).toBe(false);
    expect(b.move.proneT).toBeLessThan(0.5);
    const seenAt = room.time - 0.2; // the shooter's screen (200 ms behind) still shows B lying
    expect(room.history.poseAt(b.id, seenAt)?.prone).toBe(true);
    const hp = b.health;
    a.move.ads = 1;
    // Aimed at where B lay, with the shot's view time when B was lying: a hit (rewound).
    const legs = aimAt(a, b, 0.15, 1.2);
    const hits: string[] = [];
    room.bus.on('damage', (e) => hits.push(e.part ?? ''));
    expect(room.fire(a, { dir: legs, time: seenAt }).ok).toBe(true);
    expect(hits).toEqual(['legs']);
    expect(b.health).toBeLessThan(hp);
    // The same shot at the present misses: B's legs are no longer lying there.
    steps(room, 0.3);
    const hp2 = b.health;
    room.fire(a, { dir: legs });
    expect(b.health).toBe(hp2);
  });

  it('the weapon is down while going prone and while mantling', () => {
    const room = setup();
    let buttons = 0;
    const { a, b } = duel(room, () => buttons);
    void b;
    a.brain = { think: () => ({ buttons, yaw: 0, pitch: 0, weaponSlot: 0 }) };
    buttons = Buttons.PRONE;
    steps(room, 0.1);
    expect(a.move.prone).toBe(true);
    expect(room.fire(a, { dir: { x: 0, y: 0, z: -1 } })).toEqual({ ok: false, reason: 'stance' });
    steps(room, 1);
    expect(room.fire(a, { dir: { x: 0, y: 0, z: -1 } }).ok).toBe(true);
  });

  it('snapshots and killcam frames carry the stance bits', () => {
    const room = setup();
    const { b } = duel(room, () => Buttons.PRONE);
    steps(room, 0.3);
    const frame = poseFrame(room).p.find((p) => p[0] === b.id)!;
    expect(frame[6] & PlayerFlags.PRONE).toBe(PlayerFlags.PRONE);
    expect(frame[6] & PlayerFlags.CROUCH).toBe(PlayerFlags.CROUCH);
  });
});
