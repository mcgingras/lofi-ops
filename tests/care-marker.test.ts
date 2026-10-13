/**
 * Care Package marker (BO1's supply drop canister): STREAK raises the canister, FIRE throws it, it
 * flies with the shared marker physics, and the crate comes down where it settles. The client's
 * throw preview runs the same maths (`markerLaunch` -> `simulateMarker` -> `resolveDrop`) on its
 * own collision world from the predicted eye and quantised aim; these tests hold the server's
 * canister and crate to that prediction (flat ground, a wall bounce, a container roof), check the
 * drop rules (out of the map, under a roof, an unreachable roof, inside a wall, lost), the
 * cancels that keep the streak, and that bots still call it with a target.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { botAutoStreaks, callKillstreak, readyKillstreaks, suggestTarget } from '../src/server/features/killstreaks/api';
import { ksOf } from '../src/server/features/killstreaks/state';
import { cratesOf } from '../src/server/features/killstreaks/streaks/package';
import { ksRoom } from '../src/server/features/killstreaks/world';
import { eyeOf } from '../src/server/combat';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { CollisionWorld, type Solid } from '../src/shared/collision';
import { MARKER, markerLaunch, resolveDrop, roofLimit, simulateMarker, type DropMap } from '../src/shared/defs/care-marker';
import { getMapData } from '../src/shared/defs/maps';
import { KS_ENTITY } from '../src/shared/defs/killstreaks';
import { Buttons } from '../src/shared/input';
import { mapSolids } from '../src/shared/maps/types';
import { clamp, quantizeAngle, type Vec3 } from '../src/shared/math';
import { eyeHeight } from '../src/shared/movement';
import { bot, give, input, place, rig, steps, until, type Rig } from './perks-streaks.helpers';

let r: Rig | undefined;
afterEach(() => {
  r?.close();
  r = undefined;
});

/** The client's own collision world (built separately from the same map data). */
const clientWorld = new CollisionWorld(mapSolids(getMapData('yard')));
const yard = getMapData('yard');

/** A human-driven thrower with a Care Package ready, standing at x,z. */
function thrower(x = -1, z = 20) {
  r = rig();
  const room = r.room;
  const p = bot(room, 0, [], ['care_package']);
  p.isBot = false;
  p.brain = null;
  place(p, x, z);
  give(p, 'care_package');
  return { room, p };
}

/** One tick of input. */
const tick = (room: Room, p: PlayerState, buttons: number, yaw: number, pitch: number, slot = p.slot) => {
  input(room, p, buttons, yaw, pitch, slot);
  room.step();
};

/** What the client previews right before FIRE: its predicted state, quantised aim, its world. */
function clientPreview(p: PlayerState, yaw: number, pitch: number) {
  const m = p.move;
  const eye = { x: m.x, y: m.y + eyeHeight(m), z: m.z };
  const l = markerLaunch(clientWorld, eye, quantizeAngle(yaw), clamp(quantizeAngle(pitch), -1.55, 1.55), { x: m.vx, y: m.vy, z: m.vz });
  const f = simulateMarker(clientWorld, l, yard.bounds.min.y - 20);
  return { flight: f, drop: resolveDrop(clientWorld, yard, f.rest, { x: m.x, y: m.y, z: m.z }, f.settled) };
}

/** Raise with STREAK, throw with FIRE (as the buttons come in), return the preview made at FIRE. */
function raiseAndThrow(room: Room, p: PlayerState, yaw: number, pitch: number) {
  for (let i = 0; i < 5; i++) tick(room, p, 0, yaw, pitch);
  tick(room, p, Buttons.STREAK, yaw, pitch);
  expect(ksOf(p).marker?.id).toBe('care_package');
  for (let i = 0; i < 10; i++) tick(room, p, 0, yaw, pitch);
  const preview = clientPreview(p, yaw, pitch);
  tick(room, p, Buttons.FIRE, yaw, pitch);
  return preview;
}

const canister = (room: Room) => room.entities.byKind(KS_ENTITY.marker)[0];
const settle = (room: Room) => until(room, () => canister(room)?.s?.k === 1, 10);
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('throwing the marker', () => {
  it('flat ground: the canister settles where the client predicted, and the crate lands on it', () => {
    const { room, p } = thrower();
    const preview = raiseAndThrow(room, p, 0.79, 0);
    expect(ksOf(p).marker).toBeNull();
    expect(readyKillstreaks(p)).toEqual([]);
    const flying = canister(room)!;
    expect(flying.s?.k).toBe(0);
    expect(settle(room)).toBeLessThan(10);
    const e = canister(room)!;
    expect(preview.flight.settled).toBe(true);
    expect(preview.drop.valid).toBe(true);
    expect(dist(e, preview.flight.rest)).toBeLessThan(0.05);
    expect(e.s?.v).toBe(1);
    // Smoke after the canister's fuse; the drop goes to the rest position.
    expect(e.s?.sm).toBeCloseTo(room.time + MARKER.smokeDelaySec - 1 / 60, 1);
    expect(until(room, () => cratesOf(ksRoom(room)).some((c) => c.landed), 20)).toBeLessThan(20);
    const crate = cratesOf(ksRoom(room))[0]!;
    expect(Math.hypot(crate.ent.x - e.x, crate.ent.z - e.z)).toBeLessThan(1e-6);
    expect(Math.hypot(crate.ent.x - preview.drop.x, crate.ent.z - preview.drop.z)).toBeLessThan(0.05);
  });

  it('a wall bounce: the prediction follows the canister off the wall', () => {
    const { room, p } = thrower(-1, 20);
    const preview = raiseAndThrow(room, p, Math.PI, 0); // at the north wall, 9 m away
    const path = preview.flight.path;
    const turned = path.some((b, i) => i > 1 && (b.z - path[i - 1]!.z) * (path[i - 1]!.z - path[i - 2]!.z) < -1e-9);
    expect(turned).toBe(true); // it really bounced back
    expect(settle(room)).toBeLessThan(10);
    expect(dist(canister(room)!, preview.flight.rest)).toBeLessThan(0.05);
  });

  it('landing on a raised surface (a container top) is predicted too', () => {
    const { room, p } = thrower(-1, 20);
    const preview = raiseAndThrow(room, p, 5.89, 0.3);
    expect(preview.flight.rest.y).toBeGreaterThan(1.5);
    expect(settle(room)).toBeLessThan(10);
    const e = canister(room)!;
    expect(dist(e, preview.flight.rest)).toBeLessThan(0.05);
    expect(e.s?.v).toBe(preview.drop.valid ? 1 : 0);
  });

  it('the gun stays down with the canister up (no shot on the throwing FIRE)', () => {
    const { room, p } = thrower();
    const shots: number[] = [];
    room.bus.on('fire', (e) => e.player === p && shots.push(room.time));
    tick(room, p, Buttons.STREAK, 0, 0);
    tick(room, p, 0, 0, 0);
    expect(p.swapEnd).toBeGreaterThan(room.time);
    expect(room.fire(p, { dir: { x: 0, y: 0, z: -1 } })).toEqual({ ok: false, reason: 'switching' });
    expect(room.modifiers.any('canSprint', p)).toBe(false);
    tick(room, p, Buttons.FIRE, 0, 0);
    expect(shots).toEqual([]);
  });
});

describe('putting it away keeps the streak', () => {
  it('STREAK again', () => {
    const { room, p } = thrower();
    tick(room, p, Buttons.STREAK, 0, 0);
    tick(room, p, 0, 0, 0);
    expect(ksOf(p).marker).not.toBeNull();
    tick(room, p, Buttons.STREAK, 0, 0);
    expect(ksOf(p).marker).toBeNull();
    expect(readyKillstreaks(p)).toEqual(['care_package']);
    expect(canister(room)).toBeUndefined();
  });

  it('a weapon switch', () => {
    const { room, p } = thrower();
    tick(room, p, Buttons.STREAK, 0, 0);
    tick(room, p, 0, 0, 0, 1);
    expect(ksOf(p).marker).toBeNull();
    expect(readyKillstreaks(p)).toEqual(['care_package']);
  });

  it('a grenade or the knife', () => {
    const { room, p } = thrower();
    tick(room, p, Buttons.STREAK, 0, 0);
    tick(room, p, Buttons.LETHAL, 0, 0);
    expect(ksOf(p).marker).toBeNull();
    tick(room, p, 0, 0, 0);
    tick(room, p, Buttons.STREAK, 0, 0);
    tick(room, p, Buttons.MELEE, 0, 0);
    expect(ksOf(p).marker).toBeNull();
    expect(readyKillstreaks(p)).toEqual(['care_package']);
  });

  it('death (and the streak is still there after the respawn)', () => {
    const { room, p } = thrower();
    tick(room, p, Buttons.STREAK, 0, 0);
    expect(ksOf(p).marker).not.toBeNull();
    room.kill(p, null, { weapon: 'world', means: 'world' });
    expect(ksOf(p).marker).toBeNull();
    expect(until(room, () => p.alive, 8)).toBeLessThan(8);
    expect(readyKillstreaks(p)).toEqual(['care_package']);
    expect(canister(room)).toBeUndefined();
  });
});

describe('where the crate can come down (resolveDrop)', () => {
  // A 40 x 40 m test map: floor, a covered shelter (roof 3 m up at x 5..9), a tall tower
  // (12 m, x -10..-6) nobody can climb, and a pillar.
  const box = (min: Vec3, max: Vec3, i: number): Solid => ({ min, max, players: true, bullets: true, sight: true, source: i, mat: 'concrete' });
  const solids = [
    box({ x: -20, y: -1, z: -20 }, { x: 20, y: 0, z: 20 }, 0),
    box({ x: 5, y: 3, z: -2 }, { x: 9, y: 3.3, z: 2 }, 1),
    box({ x: -10, y: 0, z: -2 }, { x: -6, y: 12, z: 2 }, 2),
    box({ x: 0, y: 0, z: 10 }, { x: 1, y: 3, z: 11 }, 3),
  ];
  const world = new CollisionWorld(solids);
  const map: DropMap = { bounds: { min: { x: -20, y: -2, z: -20 }, max: { x: 20, y: 30, z: 20 } }, spawns: { teams: [[{ x: 0, y: 0, z: -15 }], [{ x: 0, y: 0, z: 15 }]], ffa: [] } };
  const from = { x: 0, y: 0, z: 0 };

  it('open ground: on the canister', () => {
    expect(resolveDrop(world, map, { x: 3, y: 0.01, z: 3 }, from)).toEqual({ x: 3, y: 0, z: 3, valid: true, reason: 'ok' });
  });

  it('out of the map: clamped inside, the old designator clamp', () => {
    const d = resolveDrop(world, map, { x: 25, y: 0.01, z: 3 }, from);
    expect(d).toMatchObject({ valid: false, reason: 'bounds' });
    expect(d.x).toBeCloseTo(20 - MARKER.edge, 6);
    expect(d.z).toBeCloseTo(3, 6);
  });

  it('under a roof: walked back out from under it toward the thrower', () => {
    const d = resolveDrop(world, map, { x: 7, y: 0.01, z: 0 }, from);
    expect(d).toMatchObject({ valid: false, reason: 'covered' });
    expect(d.x).toBeLessThan(5 - MARKER.crateRadius + 1e-6);
    expect(d.y).toBe(0);
  });

  it('a roof nobody can reach: brought down to the ground beside it', () => {
    expect(roofLimit(map)).toBe(MARKER.roofAbove);
    const d = resolveDrop(world, map, { x: -8, y: 12.01, z: 0 }, from);
    expect(d).toMatchObject({ valid: false, reason: 'roof' });
    expect(d.y).toBe(0);
    expect(d.x).toBeGreaterThan(-6);
  });

  it('a low roof (under the limit) is fine', () => {
    const d = resolveDrop(world, map, { x: 7, y: 3.31, z: 0 }, from);
    expect(d).toMatchObject({ valid: true, reason: 'ok' });
    expect(d.y).toBeCloseTo(3.3, 6);
  });

  it('inside a wall, or lost: the fallback', () => {
    expect(resolveDrop(world, map, { x: 0.5, y: 1, z: 10.5 }, from)).toMatchObject({ valid: false, reason: 'solid' });
    const lost = resolveDrop(world, map, { x: 3, y: -30, z: 3 }, from, false);
    expect(lost).toMatchObject({ valid: false, reason: 'lost', y: 0 });
  });

  it('on the server: a canister lost off the map comes down at the clamped spot', () => {
    const { room, p } = thrower(-1, 20);
    const events: { valid: boolean; reason: string; x: number; z: number }[] = [];
    room.bus.on('killstreaks.marker', (e) => events.push(e));
    const b = room.map.bounds;
    const res = callKillstreak(room, p, 'care_package', { launch: { throw: { pos: { x: b.max.x + 6, y: 2, z: 20 }, vel: { x: 4, y: 0, z: 0 } }, from: { x: -1, y: 0, z: 20 } } });
    expect(res.ok).toBe(true);
    expect(until(room, () => events.length > 0, 9)).toBeLessThan(9);
    expect(events[0]).toMatchObject({ valid: false, reason: 'lost' });
    expect(events[0]!.x).toBeLessThanOrEqual(b.max.x - MARKER.edge);
    expect(until(room, () => cratesOf(ksRoom(room)).some((c) => c.landed), 20)).toBeLessThan(20);
    const crate = cratesOf(ksRoom(room))[0]!;
    expect(crate.ent.x).toBeGreaterThan(b.min.x);
    expect(crate.ent.x).toBeLessThan(b.max.x);
  });
});

describe('bots', () => {
  it('call it with a target through the API: a smoking canister there and the crate on it', () => {
    r = rig();
    const room = r.room;
    const b = bot(room, 1, [], ['care_package']);
    bot(room, 0);
    place(b, 2, -10);
    give(b, 'care_package');
    const s = suggestTarget(room, b, 'care_package', 1);
    expect(callKillstreak(room, b, 'care_package', s).ok).toBe(true);
    const e = canister(room)!;
    expect(e.s).toMatchObject({ k: 1, v: 1 });
    expect(e.s!.sm as number).toBeLessThanOrEqual(room.time);
    expect(room.entities.byKind(KS_ENTITY.dropHeli)).toHaveLength(1);
    expect(until(room, () => cratesOf(ksRoom(room)).some((c) => c.landed), 20)).toBeLessThan(20);
    const crate = cratesOf(ksRoom(room))[0]!;
    expect(Math.hypot(crate.ent.x - e.x, crate.ent.z - e.z)).toBeLessThan(1e-6);
  });

  it('use it on their own (automatic streaks), never holding a canister', () => {
    r = rig();
    const room = r.room;
    const b = bot(room, 1, [], ['care_package']);
    bot(room, 0);
    const ks = ksOf(b);
    ks.manual = false;
    ks.botStreakUse = 1;
    give(b, 'care_package');
    ks.botNextCall = 0;
    botAutoStreaks(room, b);
    expect(readyKillstreaks(b)).toEqual([]);
    expect(ks.marker).toBeNull();
    expect(canister(room)).toBeDefined();
    expect(room.entities.byKind(KS_ENTITY.dropHeli)).toHaveLength(1);
    steps(room, 0.1);
  });

  it('the thrower position also works for eyeOf (server launch matches the shared helper)', () => {
    const { room, p } = thrower();
    const l1 = markerLaunch(room.world, eyeOf(p), p.yaw, p.pitch);
    const l2 = markerLaunch(clientWorld, { x: p.move.x, y: p.move.y + eyeHeight(p.move), z: p.move.z }, p.yaw, p.pitch);
    expect(l1).toEqual(l2);
  });
});
