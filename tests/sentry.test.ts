/**
 * Sentry Gun and SAM Turret: the BO1-based nerf (duration, acquisition delay, turn rate, arc, line of
 * sight through drawn cover, accuracy falloff, perks, destroying it) and carry-to-place (the shared
 * placement rule, carrying, cancelling keeps the streak, placing where the preview says, picking it
 * back up, bots' own spots).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { callKillstreak, readyKillstreaks } from '../src/server/features/killstreaks/api';
import { ksOf } from '../src/server/features/killstreaks/state';
import { carrySpot } from '../src/server/features/killstreaks/streaks/carry';
import { turretsOf } from '../src/server/features/killstreaks/streaks/turrets';
import { ksRoom } from '../src/server/features/killstreaks/world';
import { perksOf } from '../src/server/features/perks/common';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { CollisionWorld, type Solid } from '../src/shared/collision';
import { KILLSTREAK_BY_ID, KS_ENTITY } from '../src/shared/defs/killstreaks';
import { PERK_TUNING } from '../src/shared/defs/perks';
import { angleDiff, inSentryArc, SENTRY, sentryDamage, sentryHitChance, sentryTurn } from '../src/shared/defs/sentry';
import { TURRET_PLACE, turretPlacement } from '../src/shared/defs/turret-place';
import { Buttons } from '../src/shared/input';
import { buildCollisionWorld } from '../src/shared/maps/types';
import { quantizeAngle, yawTo } from '../src/shared/math';
import { coverMap } from './bots-walls';
import { aim, bot, give, input, place, rig, steps, until, withProfile, type Rig } from './perks-streaks.helpers';

let r: Rig | undefined;
afterEach(() => {
  r?.close();
  r = undefined;
});
const setup = () => (r = rig()).room;

/** A sentry of `owner`'s at x,z facing `yaw`, placed through the API like a carried one. */
function sentryAt(room: Room, owner: PlayerState, x: number, z: number, yaw: number) {
  give(owner, 'sentry_gun');
  expect(callKillstreak(room, owner, 'sentry_gun', { place: { x, y: 0, z, yaw, valid: true, reason: 'ok' } }).ok).toBe(true);
  const t = turretsOf(ksRoom(room)).at(-1)!;
  return t;
}

/** An enemy standing still with plenty of health (so we can watch the damage come in). */
function dummy(room: Room, team: 0 | 1, x: number, z: number, perks: string[] = []): PlayerState {
  const v = bot(room, team, perks);
  place(v, x, z);
  v.health = v.maxHealth = 100000;
  return v;
}

const hurt = (v: PlayerState) => v.maxHealth - v.health;

describe('Sentry Gun numbers', () => {
  it('lasts 60 s (BO1 90 s, shortened), 500 hp, the def follows SENTRY', () => {
    const def = KILLSTREAK_BY_ID.get('sentry_gun')!;
    expect(SENTRY.durationSec).toBe(60);
    expect(def.durationSec).toBe(60);
    expect(def.hp).toBe(SENTRY.hp);
    expect(def.targeting).toBe('place');
    expect(KILLSTREAK_BY_ID.get('sam_turret')!.targeting).toBe('place');
  });

  it('arc, turn, damage and accuracy maths', () => {
    expect(inSentryArc(0, 0.5)).toBe(true);
    expect(inSentryArc(0, SENTRY.arcHalf + 0.05)).toBe(false);
    expect(inSentryArc(0, Math.PI)).toBe(false);
    expect(inSentryArc(Math.PI - 0.1, -Math.PI + 0.2)).toBe(true); // across the wrap
    // Turns at most turnRate * dt, never out of the arc.
    expect(sentryTurn(0, 1, 0, 0.1)).toBeCloseTo(SENTRY.turnRate * 0.1);
    expect(sentryTurn(0, Math.PI, 0, 10)).toBeCloseTo(SENTRY.arcHalf);
    expect(Math.abs(angleDiff(sentryTurn(0.2, 0.25, 0, 1), 0.25))).toBeLessThan(1e-9);
    expect(sentryDamage(2)).toBe(SENTRY.damage.near);
    expect(sentryDamage(100)).toBe(SENTRY.damage.far);
    expect(sentryHitChance(3)).toBeGreaterThan(sentryHitChance(20));
    expect(sentryHitChance(20)).toBeGreaterThan(sentryHitChance(SENTRY.range));
  });
});

describe('Sentry Gun targeting', () => {
  it('arms, then holds fire for the acquisition delay before the first bullet', () => {
    const room = setup();
    const a = bot(room, 0);
    place(a, 20, 20);
    const s = sentryAt(room, a, -1, 10, 0);
    steps(room, SENTRY.armSec + 0.1);
    const v = dummy(room, 1, -1, 2); // straight ahead, 8 m
    const seenAt = room.time;
    expect(until(room, () => s.tracking === v, 0.5)).toBeLessThan(0.2);
    steps(room, SENTRY.acquireSec - 0.15);
    expect(hurt(v)).toBe(0);
    const t = until(room, () => hurt(v) > 0, 3);
    expect(room.time - seenAt).toBeGreaterThanOrEqual(SENTRY.acquireSec - 0.02);
    expect(t).toBeLessThan(3);
    // Fires in bursts at about one bullet per 0.112 s.
    const shots: number[] = [];
    room.bus.on('damage', (e) => e.victim === v && shots.push(room.time));
    steps(room, 2);
    expect(shots.length).toBeGreaterThan(5);
    expect(shots.length).toBeLessThan(2 / SENTRY.fireInterval + 2);
  });

  it('nothing for its first second after it is put down', () => {
    const room = setup();
    const a = bot(room, 0);
    place(a, 20, 20);
    const v = dummy(room, 1, -1, 2);
    sentryAt(room, a, -1, 10, 0);
    steps(room, SENTRY.armSec - 0.05);
    expect(hurt(v)).toBe(0);
  });

  it('turns at a limited rate: a target 50 degrees off takes its time', () => {
    const room = setup();
    const a = bot(room, 0);
    place(a, 20, 20);
    const s = sentryAt(room, a, 0, 10, 0);
    steps(room, SENTRY.armSec + 0.1);
    // Make it look straight down its middle, then show it someone 50 degrees to the side.
    s.ent.yaw = 0;
    const off = (50 * Math.PI) / 180;
    const v = dummy(room, 1, -Math.sin(off) * 8, 10 - Math.cos(off) * 8);
    s.ent.yaw = 0;
    const want = yawTo({ x: 0, y: 1, z: 10 }, v.move);
    const t = until(room, () => Math.abs(angleDiff(s.ent.yaw, want)) < 0.05, 3);
    expect(t).toBeGreaterThan((off - 0.1) / SENTRY.turnRate);
    expect(t).toBeLessThan(off / SENTRY.turnRate + 0.3);
  });

  it('ignores enemies outside its arc (behind it), who can shoot it to pieces', () => {
    const room = setup();
    const a = bot(room, 0);
    place(a, 20, 20);
    const s = sentryAt(room, a, -1, 0, 0); // faces -z
    const e = dummy(room, 1, -1, 6); // 6 m behind it
    steps(room, 3);
    expect(s.tracking).toBeNull();
    expect(hurt(e)).toBe(0);
    let shots = 0;
    while (s.alive && shots < 80) {
      e.move.ads = 1;
      e.weapons[0]!.mag = 30;
      room.fire(e, { dir: aim(e, s.ent, 0.7) });
      steps(room, 0.11);
      shots++;
    }
    expect(s.alive).toBe(false);
    // 500 hp at 0.8x: about 16 rifle bullets (BO1's 1000 hp at 0.3x would take ~80).
    expect(shots).toBeLessThan(30);
    expect(shots).toBeGreaterThan(8);
  });

  it('accuracy falls off with distance', () => {
    const near = { hits: 0, shots: 0 };
    const far = { hits: 0, shots: 0 };
    for (const [z, acc] of [[6, near], [-22, far]] as const) {
      const room = setup();
      const a = bot(room, 0);
      place(a, 25, 25);
      sentryAt(room, a, -1, 10, 0);
      const v = dummy(room, 1, -1, z);
      room.bus.on('damage', (e) => e.victim === v && acc.hits++);
      const orig = room.recordShot.bind(room);
      room.recordShot = (s) => {
        if (s.w === 'sentry_gun') acc.shots++;
        orig(s);
      };
      steps(room, 12);
      r!.close();
      r = undefined;
    }
    expect(near.shots).toBeGreaterThan(20);
    expect(far.shots).toBeGreaterThan(20);
    expect(near.hits / near.shots).toBeGreaterThan(0.7);
    expect(far.hits / far.shots).toBeLessThan(0.45);
  });

  it('sees like a bot: someone behind a drawn-only wall is not seen, a step out they are', () => {
    const room = setup();
    room.map = coverMap();
    room.world = buildCollisionWorld(room.map);
    const a = bot(room, 0);
    place(a, 0, 15);
    const s = sentryAt(room, a, -9, 10, 0);
    const hidden = dummy(room, 1, -9, -6.2); // behind the render-only wall (no collision)
    expect(room.world.lineOfSight({ x: -9, y: 1, z: 10 }, { x: -9, y: 1.1, z: -6.2 }, 'sight')).toBe(true);
    steps(room, 3);
    expect(s.tracking).toBeNull();
    expect(hurt(hidden)).toBe(0);
    place(hidden, -6.8, -6.2); // peeks out
    expect(until(room, () => hurt(hidden) > 0, 4)).toBeLessThan(4);
  });

  it('drops a target that ducks out of sight; a new peek means a new acquisition delay', () => {
    const room = setup();
    room.map = coverMap();
    room.world = buildCollisionWorld(room.map);
    const a = bot(room, 0);
    place(a, 0, 15);
    const s = sentryAt(room, a, -15, 10, 0);
    const v = dummy(room, 1, -12.8, -6.2); // peeking past the concrete wall
    expect(until(room, () => hurt(v) > 0, 4)).toBeLessThan(4);
    place(v, -15, -6.2); // behind it
    steps(room, SENTRY.loseSec + 0.2);
    expect(s.tracking).toBeNull();
    const before = hurt(v);
    place(v, -12.8, -6.2);
    steps(room, SENTRY.acquireSec - 0.1);
    expect(hurt(v)).toBe(before);
  });
});

describe('Sentry Gun perks and counters', () => {
  it('Ghost Pro: never picked as a target (BO1 specialty_nottargetedbyai)', () => {
    const room = setup();
    const a = bot(room, 0);
    place(a, 20, 20);
    const ghost = dummy(room, 1, -1, 4, ['ghost']);
    perksOf(ghost).allPro = true;
    const s = sentryAt(room, a, -1, 10, 0);
    steps(room, 4);
    expect(s.tracking).toBeNull();
    expect(hurt(ghost)).toBe(0);
  });

  it('Hacker Pro takes it over; out 2.5 s, then it works for the hacker; nobody can pick it up', () => {
    const room = setup();
    const owner = withProfile(bot(room, 0));
    const hacker = bot(room, 1, ['hacker']);
    perksOf(hacker).allPro = true;
    place(owner, 20, 20);
    const s = sentryAt(room, owner, 10, -20, Math.PI);
    place(hacker, 10, -21.2);
    hacker.health = hacker.maxHealth = 10000;
    hacker.brain = { think: () => ({ buttons: Buttons.USE, yaw: 0, pitch: 0, weaponSlot: 0 }) };
    expect(until(room, () => s.owner === hacker, PERK_TUNING.hackSec + 1)).toBeLessThan(PERK_TUNING.hackSec + 0.5);
    expect(s.hacked).toBe(true);
    expect(s.armed).toBe(false);
    steps(room, SENTRY.hackStunSec + 0.1);
    expect(s.armed).toBe(true);
    // Its old owner walks up (in front of it is in the arc now? keep out of it) and presses USE: nothing.
    place(owner, 10, -18.8);
    input(room, owner, Buttons.USE);
    room.step();
    expect(ksOf(owner).carry ?? null).toBeNull();
  });

  it('a knife kills it (BO1 MOD_MELEE)', () => {
    const room = setup();
    const a = bot(room, 0);
    place(a, 20, 20);
    const s = sentryAt(room, a, -1, 0, 0);
    const e = bot(room, 1);
    place(e, -1, 1.2);
    e.yaw = 0; // facing -z, at it
    room.bus.emit('weapons.melee', { player: e, victim: null });
    expect(s.alive).toBe(false);
  });

  it('explosives do double; a flashbang stuns it for 5 s', () => {
    const room = setup();
    const a = bot(room, 0);
    place(a, 20, 20);
    const s = sentryAt(room, a, -1, 0, 0);
    const e = bot(room, 1);
    place(e, -1, 8);
    const hp = () => ksRoom(room).hp.get(s.ent.id)?.hp ?? 0;
    room.bus.emit('weapons.detonated', { player: e, equipment: 'frag', effect: 'frag', x: -1, y: 0.1, z: 0.5, radius: 6.5, max: 150, min: 25 });
    expect(SENTRY.hp - hp()).toBeGreaterThan(250);
    steps(room, 2);
    room.bus.emit('weapons.detonated', { player: e, equipment: 'flashbang', effect: 'flash', x: -1, y: 0.1, z: -2, radius: 16, max: 0, min: 0 });
    expect(s.armed).toBe(false);
    const v = dummy(room, 1, -1, -6);
    steps(room, SENTRY.stunSec - 0.3);
    expect(hurt(v)).toBe(0);
    expect(until(room, () => hurt(v) > 0, 3)).toBeLessThan(3);
    room.bus.emit('weapons.detonated', { player: e, equipment: 'frag', effect: 'frag', x: -1, y: 0.1, z: 0.5, radius: 6.5, max: 150, min: 25 });
    expect(s.alive).toBe(false);
  });

  it('expires after 60 s on the ground', () => {
    const room = setup();
    const a = bot(room, 0);
    place(a, 20, 20);
    const s = sentryAt(room, a, -1, 10, 0);
    steps(room, SENTRY.durationSec - 0.5);
    expect(s.alive).toBe(true);
    steps(room, 1);
    expect(s.alive).toBe(false);
    expect(room.entities.byKind(KS_ENTITY.sentry)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Placement rule (shared)
// ---------------------------------------------------------------------------------------------

const solid = (min: [number, number, number], max: [number, number, number], ramp?: Solid['ramp']): Solid => ({ min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] }, players: true, bullets: true, sight: true, source: 0, mat: 'x', ...(ramp ? { ramp } : {}) });
const testMap = { bounds: { min: { x: -20, y: -5, z: -20 }, max: { x: 20, y: 20, z: 20 } }, spawns: { teams: [[{ x: 0, y: 0, z: 0 }], [{ x: 0, y: 0, z: 0 }]] as [{ x: number; y: number; z: number }[], { x: number; y: number; z: number }[]], ffa: [] } };
const world = new CollisionWorld([
  solid([-20, -1, -20], [20, 0, 20]), // floor
  solid([4, 0, -3], [6, 3, 3]), // a wall at x 4..6
  solid([-8, 0, -3], [-4, 2, 3], '-x'), // a steep ramp rising toward -x (2 m over 4 m)
  solid([10, 0, 8], [14, 6, 12]), // a tall block (a roof at 6 m)
  solid([-15, 0, 10], [-11, 0.5, 14]), // a low platform (0.5 m)
]);

describe('turret placement rule', () => {
  it('flat ground in front: good, 1.1 m ahead, facing the carrier', () => {
    const s = turretPlacement(world, testMap, { x: 0, y: 0, z: 0 }, 0);
    expect(s).toMatchObject({ valid: true, reason: 'ok', y: 0, yaw: 0 });
    expect(s.z).toBeCloseTo(-TURRET_PLACE.ahead);
    const side = turretPlacement(world, testMap, { x: 0, y: 0, z: 0 }, -Math.PI / 2);
    expect(side.x).toBeCloseTo(TURRET_PLACE.ahead);
  });

  it('into a wall: blocked or no room', () => {
    const s = turretPlacement(world, testMap, { x: 3.2, y: 0, z: 0 }, -Math.PI / 2); // facing +x into the wall
    expect(s.valid).toBe(false);
    expect(['blocked', 'solid']).toContain(s.reason);
    // Right up against it, the footprint overlaps the wall: no room.
    const close = turretPlacement(world, testMap, { x: 2.7, y: 0, z: 0 }, -Math.PI / 2);
    expect(close).toMatchObject({ valid: false });
  });

  it('on a steep ramp: too steep', () => {
    const s = turretPlacement(world, testMap, { x: -3, y: 0, z: 0 }, Math.PI / 2); // facing -x onto the ramp foot
    expect(s.valid).toBe(false);
    expect(s.reason).toBe('steep');
  });

  it('out of the map, off a ledge and on an unreachable roof are bad; a low platform is fine', () => {
    expect(turretPlacement(world, testMap, { x: 18.5, y: 0, z: 0 }, -Math.PI / 2).reason).toBe('bounds');
    expect(turretPlacement(world, testMap, { x: 12, y: 6, z: 7.5 }, Math.PI).reason).toBe('roof');
    // Standing on the roof's edge facing out over a 6 m drop: no floor within reach.
    expect(turretPlacement(world, testMap, { x: 12, y: 6, z: 11.6 }, Math.PI).reason).toBe('nofloor');
    const up = turretPlacement(world, testMap, { x: -13, y: 0, z: 14.6 }, 0); // just off the platform, facing onto it
    expect(up).toMatchObject({ valid: true, y: 0.5 });
  });
});

// ---------------------------------------------------------------------------------------------
// Carry-to-place (server)
// ---------------------------------------------------------------------------------------------

/** A "human" (no bot rules) with a ready Sentry Gun, standing at x,z facing yaw. */
function carrier(room: Room, x = -1, z = 10, yaw = 0, id = 'sentry_gun'): PlayerState {
  const p = withProfile(bot(room, 0, [], [id]));
  place(p, x, z);
  p.yaw = yaw;
  give(p, id);
  return p;
}
const press = (room: Room, p: PlayerState, bits: number, yaw = p.yaw) => {
  input(room, p, bits, yaw, 0);
  room.step();
  input(room, p, 0, yaw, 0);
  room.step();
};

describe('carrying a turret', () => {
  it('STREAK brings it up (slower, no sprint, weapon down); others see it in front; STREAK again keeps the streak', () => {
    const room = setup();
    const p = carrier(room);
    press(room, p, Buttons.STREAK);
    const c = ksOf(p).carry!;
    expect(c).toMatchObject({ id: 'sentry_gun', turret: null });
    const e = room.entities.get(c.entity)!;
    expect(e.kind).toBe(KS_ENTITY.sentry);
    expect(e.s).toMatchObject({ c: 1, v: 1 });
    expect(Math.hypot(e.x - -1, e.z - (10 - TURRET_PLACE.ahead))).toBeLessThan(0.05);
    expect(room.modifiers.mul('speedMultiplier', p)).toBeCloseTo(TURRET_PLACE.moveScale);
    expect(room.modifiers.any('canSprint', p)).toBe(false);
    expect(p.swapEnd).toBeGreaterThan(room.time);
    expect(ksRoom(room).hp.has(e.id)).toBe(false); // can't be shot in hand
    press(room, p, Buttons.STREAK);
    expect(ksOf(p).carry).toBeNull();
    expect(room.entities.get(c.entity)).toBeUndefined();
    expect(readyKillstreaks(p)).toEqual(['sentry_gun']);
  });

  it('a weapon switch, a grenade, or death put it away and keep the streak', () => {
    const room = setup();
    const p = carrier(room);
    press(room, p, Buttons.STREAK);
    input(room, p, 0, 0, 0, 1);
    room.step();
    expect(ksOf(p).carry).toBeNull();
    expect(readyKillstreaks(p)).toEqual(['sentry_gun']);
    input(room, p, 0, 0, 0, 0);
    steps(room, 1);
    press(room, p, Buttons.STREAK);
    press(room, p, Buttons.LETHAL);
    expect(ksOf(p).carry).toBeNull();
    press(room, p, Buttons.STREAK);
    expect(ksOf(p).carry).toBeTruthy();
    room.kill(p, null, { weapon: 'world', means: 'world' });
    expect(ksOf(p).carry).toBeNull();
    expect(readyKillstreaks(p)).toEqual(['sentry_gun']);
    expect(room.entities.byKind(KS_ENTITY.sentry)).toHaveLength(0);
  });

  it('walks with it: the turret follows; FIRE puts it down exactly where the preview said, facing the same way', () => {
    const room = setup();
    const p = carrier(room, -1, 10, 0);
    press(room, p, Buttons.STREAK);
    const yaw = 0.4;
    for (let i = 0; i < 30; i++) {
      input(room, p, Buttons.FORWARD, yaw, 0);
      room.step();
    }
    input(room, p, 0, yaw, 0);
    room.step();
    expect(p.move.z).toBeLessThan(9.5);
    // The client's preview: the same function from the same feet and quantised aim.
    const preview = turretPlacement(room.world, room.map, { x: p.move.x, y: p.move.y, z: p.move.z }, quantizeAngle(yaw));
    expect(preview.valid).toBe(true);
    const held = room.entities.get(ksOf(p).carry!.entity)!;
    expect(held.x).toBeCloseTo(preview.x, 5);
    press(room, p, Buttons.FIRE, yaw);
    expect(ksOf(p).carry).toBeNull();
    expect(readyKillstreaks(p)).toEqual([]);
    const t = turretsOf(ksRoom(room))[0]!;
    expect(t.ent.x).toBeCloseTo(preview.x, 1);
    expect(t.ent.z).toBeCloseTo(preview.z, 1);
    expect(t.facing).toBeCloseTo(preview.yaw, 3);
    expect(ksRoom(room).hp.has(t.ent.id)).toBe(true);
  });

  it('USE places it too; a bad spot refuses (the turret stays in hand)', () => {
    const room = setup();
    // Facing straight into a container (yard: container0 at x -15..-9, z -13.2..-10.8).
    const p = carrier(room, -12, -9.9, 0);
    press(room, p, Buttons.STREAK);
    expect(carrySpot(room, p).valid).toBe(false);
    press(room, p, Buttons.FIRE);
    expect(ksOf(p).carry).toBeTruthy();
    expect(readyKillstreaks(p)).toEqual(['sentry_gun']);
    p.yaw = Math.PI;
    press(room, p, Buttons.USE, Math.PI);
    expect(ksOf(p).carry).toBeNull();
    expect(turretsOf(ksRoom(room))).toHaveLength(1);
  });

  it('pick it back up with USE: lifetime pauses in hand; STREAK puts it back where it was', () => {
    const room = setup();
    const p = carrier(room, -1, 10, 0);
    press(room, p, Buttons.STREAK);
    press(room, p, Buttons.FIRE);
    const t = turretsOf(ksRoom(room))[0]!;
    const home = { x: t.ent.x, z: t.ent.z };
    steps(room, 5);
    const left = t.left;
    press(room, p, Buttons.USE);
    expect(ksOf(p).carry?.turret).toBe(t);
    expect(t.carrier).toBe(p);
    steps(room, 3);
    expect(t.left).toBeCloseTo(left - 2 * (1 / 60), 1);
    // Walk off with it, then STREAK: back home.
    for (let i = 0; i < 20; i++) {
      input(room, p, Buttons.RIGHT, 0, 0);
      room.step();
    }
    expect(Math.abs(t.ent.x - home.x)).toBeGreaterThan(0.5);
    press(room, p, Buttons.STREAK);
    expect(t.carrier).toBeNull();
    expect(t.ent.x).toBeCloseTo(home.x, 3);
    expect(t.ent.z).toBeCloseTo(home.z, 3);
    // Pick up again and put it down somewhere new with FIRE.
    place(p, home.x, home.z + 1);
    press(room, p, Buttons.USE);
    p.yaw = -Math.PI / 2;
    press(room, p, Buttons.FIRE, -Math.PI / 2);
    expect(t.carrier).toBeNull();
    expect(t.facing).toBeCloseTo(quantizeAngle(-Math.PI / 2), 3);
    expect(t.ent.x).toBeGreaterThan(home.x + 0.5);
  });

  it('the SAM Turret is carried and placed the same way', () => {
    const room = setup();
    const p = carrier(room, -1, 10, 0, 'sam_turret');
    press(room, p, Buttons.STREAK);
    expect(ksOf(p).carry?.id).toBe('sam_turret');
    press(room, p, Buttons.FIRE);
    expect(room.entities.byKind(KS_ENTITY.sam)).toHaveLength(1);
    expect(readyKillstreaks(p)).toEqual([]);
  });
});

describe('bots and turrets', () => {
  it('bots place theirs straight away on a good spot near them, facing the enemy side', () => {
    const room = setup();
    const b = bot(room, 0);
    place(b, 0, 20);
    b.yaw = Math.PI; // looking away from the enemy side
    give(b, 'sentry_gun');
    expect(callKillstreak(room, b, 'sentry_gun').ok).toBe(true);
    const t = turretsOf(ksRoom(room))[0]!;
    expect(Math.hypot(t.ent.x - 0, t.ent.z - 20)).toBeLessThan(TURRET_PLACE.ahead + 0.1);
    const enemySide = room.map.spawns.teams[1];
    const cz = enemySide.reduce((s, q) => s + q.z, 0) / enemySide.length;
    const cx = enemySide.reduce((s, q) => s + q.x, 0) / enemySide.length;
    expect(Math.abs(angleDiff(t.facing, yawTo({ x: 0, y: 0, z: 20 }, { x: cx, y: 0, z: cz })))).toBeLessThan(0.6);
    expect(ksOf(b).carry ?? null).toBeNull();
  });

  it('a bot facing an enemy it can see turns its sentry toward them', () => {
    const room = setup();
    const b = bot(room, 0);
    place(b, 0, 20);
    const e = dummy(room, 1, 12, 20);
    give(b, 'sentry_gun');
    expect(callKillstreak(room, b, 'sentry_gun').ok).toBe(true);
    const t = turretsOf(ksRoom(room))[0]!;
    expect(Math.abs(angleDiff(t.facing, yawTo(b.move, e.move)))).toBeLessThan(0.3);
  });
});
