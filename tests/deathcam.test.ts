/**
 * Per-death killcam (modes.deathcam), server side: the clip goes only to the victim, is cut so it
 * ends by the respawn, carries the killer card, shots and the killer's weapon, keeps only nearby
 * players, and is not sent for suicides, falls or world deaths. Plus the shared clip codec and
 * window maths. Rooms are driven tick by tick with stand-in sessions that record what they get.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { nearbyIds } from '../src/server/features/modes/deathcam';
import modesFeature, { registerModeRules } from '../src/server/features/modes/index';
import { Lobby } from '../src/server/lobby';
import type { PlayerState } from '../src/server/player';
import type { Room, RoomOptions } from '../src/server/room';
import type { Session } from '../src/server/session';
import { Store } from '../src/server/store';
import { RESPAWN_DELAY, TICK_DT } from '../src/shared/constants';
import { DEATHCAM, deathcamWindow, packClip, unpackClip, type DeathcamPayload } from '../src/shared/defs/deathcam';
import type { KillcamFrame } from '../src/shared/defs/modestate';
import { createMoveState } from '../src/shared/movement';

let store: Store | undefined;
let lobby: Lobby | undefined;

beforeAll(() => registerModeRules());

function setup(mode: string, opts: Partial<RoomOptions> = {}): Room {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: [modesFeature], log: () => {}, autoTick: false });
  return lobby.createRoom({ mode, map: 'yard', closeWhenEmpty: false, ...opts });
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
const place = (p: PlayerState, x: number, z: number) => {
  p.move = { ...createMoveState(x, 0, z), onGround: true };
};
const idle = (p: PlayerState) => {
  p.brain = { think: (_r, self) => ({ buttons: 0, yaw: self.yaw, pitch: 0, weaponSlot: 0 }) };
};

/** Give a (bot) player a session that records feature messages, so it counts as a human victim. */
function listen(p: PlayerState): { id: string; data: unknown }[] {
  const got: { id: string; data: unknown }[] = [];
  p.session = { send: () => {}, sendFeature: (id: string, data: unknown) => got.push({ id, data }) } as unknown as Session;
  return got;
}
const deathcams = (got: { id: string; data: unknown }[]) => got.filter((m) => m.id === 'modes.deathcam').map((m) => m.data as DeathcamPayload);

function duel(mode = 'tdm') {
  const room = setup(mode);
  const a = room.addBot({ name: 'Killer', team: 0 });
  const b = room.addBot({ name: 'Victim', team: 1 });
  idle(a);
  idle(b);
  place(a, 0, 6);
  place(b, 0, -6);
  return { room, a, b, toA: listen(a), toB: listen(b) };
}

describe('per-death killcam (server)', () => {
  it('goes only to the victim, after the kill, cut to end by the respawn', () => {
    const { room, a, b, toA, toB } = duel();
    steps(room, 5);
    a.yaw = 0; // facing -z, at b
    expect(room.fire(a, { dir: { x: 0, y: 0, z: -1 } }).ok).toBe(true);
    steps(room, 0.2);
    const at = room.time;
    room.kill(b, a, { weapon: a.weapons[0]!.def.base.id, means: 'bullet', part: 'head' });
    expect(b.respawnAt).toBeCloseTo(at + RESPAWN_DELAY, 5);
    expect(deathcams(toB)).toHaveLength(0); // waits for the moment after the kill
    steps(room, DEATHCAM.postSec + 0.1);
    const got = deathcams(toB);
    expect(got).toHaveLength(1);
    expect(deathcams(toA)).toHaveLength(0);
    const d = got[0]!;
    expect(d).toMatchObject({ killer: a.id, victim: b.id, view: 'eyes', headshot: true, means: 'bullet' });
    expect(d.playAt).toBeCloseTo(at + DEATHCAM.beatSec, 1);
    expect(d.card).toMatchObject({ name: 'Killer', weapon: a.weapons[0]!.def.base.id, health: 100, maxHealth: 100, streak: 1 });
    expect(d.vm?.weapon).toBe(a.weapons[0]!.def.base.id);
    const { frames, shots } = unpackClip(d.clip!);
    const first = frames[0]!.t;
    const last = frames.at(-1)!.t;
    // Replay ends by the respawn: death view + clip after the kill fit in the respawn delay.
    expect(d.playAt + (last - first)).toBeLessThanOrEqual(b.respawnAt! + 1e-3);
    expect(last).toBeGreaterThan(at + 0.3); // runs on a moment past the kill
    expect(first).toBeGreaterThanOrEqual(at - (RESPAWN_DELAY - DEATHCAM.beatSec) - 0.06);
    expect(frames.every((f) => f.p.some((p) => p[0] === a.id))).toBe(true);
    const shot = shots.find((s) => s.id === a.id);
    expect(shot).toBeDefined();
    expect(shot!.t).toBeLessThan(at);
    // Health rides along for the killer's damage overlay.
    expect(frames[0]!.p.find((p) => p[0] === a.id)![7]).toBe(100);
  });

  it('respawn timing is unchanged by the killcam', () => {
    const { room, a, b } = duel();
    steps(room, 5);
    const at = room.time;
    room.kill(b, a, { weapon: 'ak47', means: 'bullet' });
    steps(room, RESPAWN_DELAY - 0.05);
    expect(b.alive).toBe(false);
    steps(room, 0.1);
    expect(b.alive).toBe(true);
    expect(b.spawnTime - at).toBeLessThanOrEqual(RESPAWN_DELAY + 0.02);
  });

  it('no killcam for suicides, falls, out of bounds or bot victims', () => {
    const { room, a, b, toB, toA } = duel();
    steps(room, 5);
    room.kill(b, b, { weapon: 'frag', means: 'suicide' });
    steps(room, RESPAWN_DELAY + 0.2);
    room.kill(b, null, { weapon: 'fall', means: 'fall' });
    steps(room, RESPAWN_DELAY + 0.2);
    room.kill(b, null, { weapon: 'world', means: 'world' });
    steps(room, RESPAWN_DELAY + 0.2);
    // Even a frag of your own counts as a suicide when you are the attacker.
    room.kill(b, b, { weapon: 'frag', means: 'explosive' });
    steps(room, RESPAWN_DELAY + 0.2);
    expect(deathcams(toB)).toHaveLength(0);
    // A bot victim (no session) gets nothing either, and nothing leaks to the killer.
    b.session = null;
    room.kill(b, a, { weapon: 'ak47', means: 'bullet' });
    steps(room, 1);
    expect(deathcams(toA)).toHaveLength(0);
  });

  it('S&D (no respawn) gets the full clip; nothing once the victim already respawned', () => {
    const { room, a, b, toB } = duel('sd');
    steps(room, 6);
    const at = room.time;
    room.kill(b, a, { weapon: 'ak47', means: 'bullet' });
    expect(b.respawnAt).toBeNull();
    steps(room, DEATHCAM.postSec + 0.1);
    const d = deathcams(toB)[0]!;
    expect(d.respawnAt).toBeNull();
    const { frames } = unpackClip(d.clip!);
    expect(frames.at(-1)!.t - frames[0]!.t).toBeGreaterThan(DEATHCAM.maxSec - 0.1);
    expect(frames[0]!.t).toBeCloseTo(at - (DEATHCAM.maxSec - DEATHCAM.postSec), 1);
  });

  it('streak kills are watched from the streak (top-down for strikes), without a viewmodel', () => {
    const { room, a, b, toB } = duel();
    steps(room, 5);
    room.kill(b, a, { weapon: 'napalm', means: 'killstreak' });
    steps(room, DEATHCAM.postSec + 0.1);
    const d = deathcams(toB)[0]!;
    expect(d.view).toBe('streak');
    expect(d.cam?.top).toBe(true);
    expect(d.cam!.y).toBeGreaterThan(b.move.y + 10);
    expect(d.vm).toBeUndefined();
    expect(d.card.weapon).toBe('napalm');
  });

  it('keeps only players near the killer or the victim', () => {
    const { room, a, b, toB } = duel();
    const far = room.addBot({ name: 'Far', team: 1 });
    const near = room.addBot({ name: 'Near', team: 0 });
    idle(far);
    idle(near);
    steps(room, 0.5);
    // Opposite corners of the Yard: ~70 m apart.
    place(a, -24, -22);
    place(b, -24, -16);
    place(near, -21, -16);
    place(far, 25, 28);
    steps(room, 4);
    room.kill(b, a, { weapon: 'ak47', means: 'bullet' });
    steps(room, DEATHCAM.postSec + 0.1);
    const ids = deathcams(toB)[0]!.clip!.ids;
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id, near.id]));
    expect(ids).not.toContain(far.id);
  });
});

describe('deathcam window and clip codec', () => {
  it('fits the clip between the death view and the respawn', () => {
    expect(deathcamWindow(10, 13)).toEqual({ from: 8.5, to: 10.5 }); // TDM: 3 s respawn, 1 s death view
    expect(deathcamWindow(10, null)).toEqual({ from: 6.5, to: 10.5 }); // no respawn: the full 4 s
    expect(deathcamWindow(10, 30)).toEqual({ from: 6.5, to: 10.5 });
    expect(deathcamWindow(10, 11.5)).toBeNull(); // too short for a replay
    const w = deathcamWindow(10, 12.2)!;
    expect(w.to - w.from).toBeCloseTo(1.2, 5);
    expect(w.to - 10).toBeCloseTo(0.3, 5); // less room: less after the kill
  });

  it('packs to cm / mrad, delta coded, and unpacks', () => {
    const frames: KillcamFrame[] = [
      { t: 20, p: [['a', 1.234, 0, -5.678, 3.1, -0.2, 3, 100], ['b', 10, 1, 10, 0, 0, 1, 40]] },
      { t: 20.05, p: [['a', 1.3, 0, -5.6, -3.1, -0.15, 1, 100], ['b', 10.01, 1, 10, 0.01, 0, 1, 35]] },
    ];
    const packed = packClip(frames, [{ t: 20.04, id: 'b', end: [1, 2, 3], hit: true }]);
    expect(packed.ids).toEqual(['a', 'b']);
    expect(packed.f[1]!.slice(0, 9)).toEqual([50, 0, 7, 0, 8, -6200, 50, 1, 0]);
    const { frames: out, shots } = unpackClip(packed);
    expect(out[1]!.t).toBeCloseTo(20.05, 5);
    expect(out[1]!.p[0]).toEqual(['a', 1.3, 0, -5.6, -3.1, -0.15, 1, 100]);
    expect(out[0]!.p[0]![1]).toBeCloseTo(1.23, 5);
    expect(out[1]!.p[1]![7]).toBe(35);
    expect(shots).toEqual([{ t: 20.04, id: 'b', end: [1, 2, 3], hit: true }]);
    // A realistic 4 s clip of six moving players is a few KB, far smaller than the plain frames.
    const long: KillcamFrame[] = [];
    for (let i = 0; i < 81; i++) long.push({ t: 30 + i * 0.05, p: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id, j) => [id, j * 3 + i * 0.25, 0.01, -j * 2 + i * 0.1, 0.5 + i * 0.02, -0.1, 17, 100] as KillcamFrame['p'][number]) });
    const big = JSON.stringify(packClip(long)).length;
    expect(big).toBeLessThan(12_000); // ~0.25 s worth of 20 Hz snapshots, to one player per death
    expect(big).toBeLessThan(JSON.stringify(long).length * 0.5);
  });

  it('nearby players: closest first, capped', () => {
    const p = (id: string, x: number): KillcamFrame['p'][number] => [id, x, 0, 0, 0, 0, 1];
    const frames: KillcamFrame[] = [{ t: 0, p: [p('k', 0), p('v', 10), p('n1', 12), p('n2', 45), p('far', 90), p('n3', -5)] }];
    expect([...nearbyIds(frames, 'k', 'v', 0)].sort()).toEqual(['k', 'n1', 'n2', 'n3', 'v']);
    expect([...nearbyIds(frames, 'k', 'v', 0, { ...DEATHCAM, maxPlayers: 3 })].sort()).toEqual(['k', 'n1', 'v']);
  });
});
