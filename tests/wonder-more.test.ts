/**
 * The three later BO1 wonder weapons through a real Room: the Scavenger (a bolt that sticks, a
 * fuse, a big blast, a stick always kills, no kills across the map), the 31-79 JGb215 (shrink,
 * fast and harmless while small, any hit on the tiny body kills, kicks, growing back) and the
 * Wave Gun (zap bolts with a small arc; aimed, a slow shot that swells the target until it pops),
 * plus their bot rules.
 */
import { afterEach, describe, expect, it } from 'vitest';
import perks from '../src/server/features/perks/index';
import weapons from '../src/server/features/weapons/index';
import { isShrunk, isSwelling, wonderBotDecision } from '../src/server/features/weapons/wonder/index';
import { Lobby } from '../src/server/lobby';
import { makeWeapon, type PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { moveParamsFor } from '../src/server/sim';
import { Store } from '../src/server/store';
import { PLAYER, TICK_DT, type Team } from '../src/shared/constants';
import { BABY_GUN, SCAVENGER, scavengerBlast, WAVE_GUN, WONDER_ENTITY } from '../src/shared/defs/wonder';
import { cloneLoadout, DEFAULT_LOADOUTS } from '../src/shared/loadout';
import type { Vec3 } from '../src/shared/math';
import { createMoveState } from '../src/shared/movement';
import { withSeed } from './bots-sim';

let store: Store | undefined;
let lobby: Lobby | undefined;

function setup(): Room {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: [weapons, perks], log: () => {}, autoTick: false });
  const room = lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, private: true });
  room.modifiers.add('regenDelayMultiplier', () => 1000, 'test.noregen');
  return room;
}

afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = undefined;
  store = undefined;
});

function actor(room: Room, team: Team): PlayerState {
  const p = room.addBot({ team, loadout: cloneLoadout(DEFAULT_LOADOUTS[0]!) });
  p.brain = { think: (_r, self) => ({ buttons: 0, yaw: self.yaw, pitch: self.pitch, weaponSlot: self.slot }) };
  if (!p.alive) room.spawn(p);
  return p;
}
const place = (p: PlayerState, x: number, z: number, yaw = 0) => {
  p.move = { ...createMoveState(x, 0, z), onGround: true };
  p.yaw = yaw;
};
function arm(p: PlayerState, id: string): void {
  const w = makeWeapon({ weapon: id, attachments: [], camo: 'none' }, id);
  w.credit = 1;
  p.weapons[0] = w;
  p.slot = 0;
  p.swapEnd = 0;
  p.reloadEnd = 0;
}
const steps = (room: Room, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) room.step();
};
const eye = (p: PlayerState): Vec3 => ({ x: p.move.x, y: p.move.y + PLAYER.eye, z: p.move.z });
const chest = (p: PlayerState): Vec3 => ({ x: p.move.x, y: p.move.y + 1.1, z: p.move.z });
const dirTo = (from: Vec3, to: Vec3): Vec3 => {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const l = Math.hypot(d.x, d.y, d.z);
  return { x: d.x / l, y: d.y / l, z: d.z / l };
};
/** A 45 m open lane across the Yard at z = -22, from x = -24 to x = 21. */
const LANE_Z = -22;
const shoot = (room: Room, a: PlayerState, dir: Vec3) => {
  a.weapons[0]!.credit = 1;
  a.weapons[0]!.mag = Math.max(1, a.weapons[0]!.mag);
  a.reloadEnd = 0;
  return room.fire(a, { dir, origin: eye(a) });
};
const deaths = (room: Room) => {
  const out: { victim: PlayerState; attacker: PlayerState | null; weapon: string; means: string }[] = [];
  room.bus.on('death', (e) => out.push({ victim: e.victim, attacker: e.attacker, weapon: e.weapon, means: e.means }));
  return out;
};

// ---------------------------------------------------------------------------------------------
// Scavenger
// ---------------------------------------------------------------------------------------------

describe('Scavenger', () => {
  it('tuning: a big blast, a short reach (never across the map)', () => {
    expect(SCAVENGER.speed * SCAVENGER.life).toBeLessThanOrEqual(75);
    expect(scavengerBlast(4)).toBeGreaterThanOrEqual(100);
    expect(scavengerBlast(SCAVENGER.blast.r + 0.1)).toBe(0);
    expect(SCAVENGER.fuseSec).toBeCloseTo(1, 5);
  });

  it('a direct hit sticks (impact damage), then kills after the fuse along with anyone close by', () => {
    const room = setup();
    const dead = deaths(room);
    const a = actor(room, 0);
    const v = actor(room, 1);
    const near = actor(room, 1);
    const far = actor(room, 1);
    place(a, -24, LANE_Z, -Math.PI / 2);
    place(v, 1, LANE_Z);
    place(near, 1, LANE_Z + 2.5);
    place(far, 1, LANE_Z + 9);
    arm(a, 'scavenger');
    a.move.ads = 1;
    expect(shoot(room, a, dirTo(eye(a), chest(v))).ok).toBe(true);
    steps(room, 0.3);
    const bolt = room.entities.byKind(WONDER_ENTITY.scav)[0]!;
    expect(bolt.s?.k).toBe(1);
    expect(bolt.s?.p).toBe(v.id);
    expect(v.alive).toBe(true);
    expect(v.maxHealth - v.health).toBeCloseTo(SCAVENGER.impact, 5);
    // It rides them.
    v.move.x += 1;
    room.step();
    expect(room.entities.byKind(WONDER_ENTITY.scav)[0]!.x).toBeGreaterThan(1.4);
    steps(room, SCAVENGER.fuseSec);
    expect(v.alive).toBe(false);
    expect(near.alive).toBe(false);
    expect(far.alive).toBe(true);
    expect(far.health).toBe(far.maxHealth);
    expect(dead.find((d) => d.victim === v)).toMatchObject({ attacker: a, weapon: 'scavenger' });
    expect(room.entities.byKind(WONDER_ENTITY.scav)).toHaveLength(0);
  });

  it('a bolt in the ground beside an enemy blows them up a second later', () => {
    const room = setup();
    const a = actor(room, 0);
    const v = actor(room, 1);
    place(a, -24, LANE_Z, -Math.PI / 2);
    place(v, -6, LANE_Z);
    arm(a, 'scavenger');
    a.move.ads = 1;
    shoot(room, a, dirTo(eye(a), { x: -7.5, y: 0, z: LANE_Z + 1 }));
    steps(room, 0.4);
    const bolt = room.entities.byKind(WONDER_ENTITY.scav)[0]!;
    expect(bolt.s?.k).toBe(1);
    expect(bolt.s?.p).toBeUndefined();
    expect(v.alive).toBe(true);
    steps(room, SCAVENGER.fuseSec);
    expect(v.alive).toBe(false);
  });

  it('a bolt fired at nothing fizzles out without a blast', () => {
    const room = setup();
    const a = actor(room, 0);
    place(a, -24, LANE_Z, -Math.PI / 2);
    arm(a, 'scavenger');
    a.move.ads = 1;
    let blasts = 0;
    room.bus.on('weapons.detonated', () => blasts++);
    shoot(room, a, dirTo(eye(a), { x: 0, y: 40, z: LANE_Z }));
    steps(room, SCAVENGER.life + 0.2);
    expect(room.entities.byKind(WONDER_ENTITY.scav)).toHaveLength(0);
    steps(room, SCAVENGER.fuseSec + 0.5);
    expect(blasts).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 31-79 JGb215
// ---------------------------------------------------------------------------------------------

describe('31-79 JGb215 (Baby Gun)', () => {
  function shrunkScene() {
    const room = setup();
    const dead = deaths(room);
    const a = actor(room, 0);
    const v = actor(room, 1);
    place(a, -24, LANE_Z, -Math.PI / 2);
    place(v, -4, LANE_Z);
    arm(a, 'babygun');
    const base = moveParamsFor(room, v).speed;
    expect(shoot(room, a, dirTo(eye(a), chest(v))).ok).toBe(true);
    return { room, dead, a, v, base };
  }

  it('shrinks the target (no damage): faster, harmless, an entity rides them; they grow back', () => {
    const { room, a, v, base } = shrunkScene();
    expect(isShrunk(room, v)).toBe(true);
    expect(v.health).toBe(v.maxHealth);
    expect(moveParamsFor(room, v).speed / base).toBeCloseTo(BABY_GUN.speed, 5);
    room.step();
    expect(room.entities.byKind(WONDER_ENTITY.shrunk)[0]?.s?.p).toBe(v.id);
    // Their guns do almost nothing.
    const dealt = room.damage({ victim: a, attacker: v, amount: 40, weapon: 'ak47', part: 'torso', means: 'bullet', from: eye(v), distance: 20 });
    expect(dealt).toBeLessThanOrEqual(40 * BABY_GUN.damageDealt + 1e-6);
    steps(room, BABY_GUN.shrinkSec + 0.1);
    expect(isShrunk(room, v)).toBe(false);
    expect(room.entities.byKind(WONDER_ENTITY.shrunk)).toHaveLength(0);
    expect(moveParamsFor(room, v).speed).toBeCloseTo(base, 5);
  });

  it('any hit on the tiny body kills; shots over it miss', () => {
    const { room, a, v } = shrunkScene();
    room.damage({ victim: v, attacker: a, amount: 5, weapon: 'ak47', part: 'torso', means: 'bullet', from: eye(a), distance: 20 });
    expect(v.alive).toBe(true);
    expect(v.health).toBe(v.maxHealth);
    room.damage({ victim: v, attacker: a, amount: 5, weapon: 'ak47', part: 'legs', means: 'bullet', from: eye(a), distance: 20 });
    expect(v.alive).toBe(false);
  });

  it('a second Baby Gun shot kills a shrunk player', () => {
    const { room, dead, a, v } = shrunkScene();
    steps(room, 0.3);
    shoot(room, a, dirTo(eye(a), chest(v)));
    expect(v.alive).toBe(false);
    expect(dead[0]).toMatchObject({ victim: v, attacker: a, weapon: 'babygun' });
  });

  it('an enemy walking into a shrunk player kicks them to death', () => {
    const { room, dead, v } = shrunkScene();
    const kicker = actor(room, 0);
    place(kicker, -6, LANE_Z);
    room.step();
    expect(v.alive).toBe(true);
    place(kicker, v.move.x + 0.5, v.move.z);
    room.step();
    expect(v.alive).toBe(false);
    expect(dead[0]).toMatchObject({ victim: v, attacker: kicker, weapon: 'babygun', means: 'kick' });
  });
});

// ---------------------------------------------------------------------------------------------
// Wave Gun
// ---------------------------------------------------------------------------------------------

describe('Wave Gun (Zap Guns)', () => {
  it('from the hip: zap bolts, three kill, with a small arc to a neighbour; nothing past 35 m', () => withSeed(3, () => {
    const room = setup();
    const a = actor(room, 0);
    const v = actor(room, 1);
    const n = actor(room, 1);
    const far = actor(room, 1);
    place(a, -24, LANE_Z, -Math.PI / 2);
    place(v, -9, LANE_Z);
    place(n, -9, LANE_Z + 1.5);
    place(far, 15, LANE_Z + 3);
    arm(a, 'wavegun');
    a.move.ads = 0;
    const at = dirTo(eye(a), chest(v));
    shoot(room, a, at);
    expect(v.maxHealth - v.health).toBeCloseTo(WAVE_GUN.zap.damage, 5);
    expect(n.maxHealth - n.health).toBeCloseTo(WAVE_GUN.zap.arcDamage, 5);
    steps(room, 0.25);
    shoot(room, a, dirTo(eye(a), chest(v)));
    steps(room, 0.25);
    shoot(room, a, dirTo(eye(a), chest(v)));
    expect(v.alive).toBe(false);
    // 39 m off: the zap fizzles before it.
    steps(room, 0.25);
    shoot(room, a, dirTo(eye(a), chest(far)));
    expect(far.health).toBe(far.maxHealth);
  }));

  it('aimed: the Wave Gun fires slower, swells the target (no hands) and pops them', () => {
    const room = setup();
    const dead = deaths(room);
    const a = actor(room, 0);
    const v = actor(room, 1);
    place(a, -24, LANE_Z, -Math.PI / 2);
    place(v, 15, LANE_Z);
    arm(a, 'wavegun');
    a.move.ads = 1;
    expect(room.modifiers.mul('fireRateMultiplier', a)).toBeCloseTo(WAVE_GUN.wave.fireRate, 5);
    a.move.ads = 0;
    expect(room.modifiers.mul('fireRateMultiplier', a)).toBe(1);
    a.move.ads = 1;
    shoot(room, a, dirTo(eye(a), chest(v)));
    expect(isSwelling(v)).toBe(true);
    expect(v.alive).toBe(true);
    expect(room.modifiers.any('canFire', v)).toBe(false);
    expect(room.modifiers.any('botFrozen', v)).toBe(true);
    room.step();
    expect(room.entities.byKind(WONDER_ENTITY.swell)[0]?.s?.p).toBe(v.id);
    steps(room, WAVE_GUN.wave.swellSec + 0.05);
    expect(v.alive).toBe(false);
    expect(dead[0]).toMatchObject({ victim: v, attacker: a, weapon: 'wavegun', means: 'wonder' });
    expect(room.entities.byKind(WONDER_ENTITY.swell)).toHaveLength(0);
  });
});

describe('bots and the later wonder weapons', () => {
  it('Scavenger: swap away up close, fire at range, hold past its reach; Baby Gun and Wave Gun ranges', () => {
    const room = setup();
    const b = actor(room, 0);
    arm(b, 'scavenger');
    expect(wonderBotDecision(b, 'scavenger', 4)).toBe('switch');
    expect(wonderBotDecision(b, 'scavenger', 30)).toBe('fire');
    expect(wonderBotDecision(b, 'scavenger', 72)).toBe('hold');
    b.weapons[1]!.mag = 0;
    b.weapons[1]!.reserve = 0;
    expect(wonderBotDecision(b, 'scavenger', 4)).toBe('fire');
    expect(wonderBotDecision(b, 'babygun', 20)).toBe('fire');
    expect(wonderBotDecision(b, 'babygun', 30)).toBe('hold');
    expect(wonderBotDecision(b, 'wavegun', 40)).toBe('fire');
  });
});
