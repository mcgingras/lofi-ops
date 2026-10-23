/**
 * Wonder weapons (Mystery Box only), rules level through a real Room stepped tick by tick:
 * the Ray Gun's bolt (travel time, direct hit, splash, self splash), the Thundergun's blast (tube,
 * walls, launch through MoveState, the shove, an edge kill credited on Highrise), the Wunderwaffe's
 * chain (count, range, line of sight, teammates, a world hit arcing), Winter's Howl (slow, stacks,
 * frozen solid, shatter, thaw), pickups (they drop and despawn sooner), bot rules, and that none of
 * them can be had from create-a-class, the store, unlocks or bot classes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import killstreaks from '../src/server/features/killstreaks/index';
import perks from '../src/server/features/perks/index';
import pickups, { dropsOf } from '../src/server/features/pickups/index';
import { chooseWonderDrop } from '../src/server/features/pickups/bots';
import weapons from '../src/server/features/weapons/index';
import { frostOf, wonderBotDecision, wonderBotStyle } from '../src/server/features/weapons/wonder/index';
import { withSeed } from './bots-sim';
import { chooseBotLoadout } from '../src/server/features/bots/loadout';
import { Lobby } from '../src/server/lobby';
import { makeWeapon, type PlayerState } from '../src/server/player';
import type { Room, RoomOptions } from '../src/server/room';
import { moveParamsFor } from '../src/server/sim';
import { Store } from '../src/server/store';
import { PLAYER, TICK_DT, type Team } from '../src/shared/constants';
import { PICKUP } from '../src/shared/defs/pickups';
import { enforceLoadout, keyOf, storeCatalog } from '../src/shared/defs/store';
import { isUnlocked, unlockTable } from '../src/shared/defs/unlocks';
import { isWonderWeapon, LOADOUT_WEAPONS, WEAPON_BY_ID, WEAPONS } from '../src/shared/defs/weapons';
import { chainTargets, frostAdded, frostSlow, inTube, RAYGUN, raygunSplash, THUNDERGUN, thunderDamage, WINTERS_HOWL, WONDER_DROP_LIFE_SEC, WONDER_ENTITY, WONDER_WEAPON_IDS, WUNDERWAFFE } from '../src/shared/defs/wonder';
import { cloneLoadout, DEFAULT_LOADOUTS, sanitizeLoadout, type Loadout } from '../src/shared/loadout';
import { createMoveState } from '../src/shared/movement';
import { newProfile } from '../src/shared/profile';
import type { Vec3 } from '../src/shared/math';

let store: Store | undefined;
let lobby: Lobby | undefined;

function setup(opts: Partial<RoomOptions> = {}): Room {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: [weapons, perks, killstreaks, pickups], log: () => {}, autoTick: false });
  return lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, ...opts });
}

afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = undefined;
  store = undefined;
});

const loadout = (): Loadout => cloneLoadout(DEFAULT_LOADOUTS[0]!);

/** A bot that does nothing on its own (we fire for it). */
function actor(room: Room, team: Team | null): PlayerState {
  const p = room.addBot({ team, loadout: loadout() });
  p.brain = { think: (_r, self) => ({ buttons: 0, yaw: self.yaw, pitch: self.pitch, weaponSlot: self.slot }) };
  if (!p.alive) room.spawn(p);
  return p;
}
const place = (p: PlayerState, x: number, z: number, y = 0, yaw = 0) => {
  p.move = { ...createMoveState(x, y, z), onGround: true };
  p.yaw = yaw;
};
/** Put a wonder weapon in slot 0, ready to fire. */
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
const dirTo = (from: Vec3, to: Vec3): Vec3 => {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const l = Math.hypot(d.x, d.y, d.z);
  return { x: d.x / l, y: d.y / l, z: d.z / l };
};
const chestOf = (p: PlayerState): Vec3 => ({ x: p.move.x, y: p.move.y + 1.1, z: p.move.z });
const deaths = (room: Room) => {
  const out: { victim: PlayerState; attacker: PlayerState | null; weapon: string; means: string }[] = [];
  room.bus.on('death', (e) => out.push({ victim: e.victim, attacker: e.attacker, weapon: e.weapon, means: e.means }));
  return out;
};
/** Shooter on team 0, `n` enemies on team 1; regen off so damage stays readable. */
function scene(n: number, mates = 0) {
  const room = setup();
  room.modifiers.add('regenDelayMultiplier', () => 1000, 'test.noregen');
  const a = actor(room, 0);
  const foes = Array.from({ length: n }, () => actor(room, 1));
  const friends = Array.from({ length: mates }, () => actor(room, 0));
  return { room, a, foes, friends, dead: deaths(room) };
}

// ---------------------------------------------------------------------------------------------
// Defs and exclusions
// ---------------------------------------------------------------------------------------------

describe('wonder weapon defs', () => {
  it('seven wonder weapons with BO1-ish loads, all flagged', () => {
    expect([...WONDER_WEAPON_IDS]).toEqual(['raygun', 'thundergun', 'wunderwaffe', 'wintershowl', 'scavenger', 'babygun', 'wavegun']);
    for (const id of WONDER_WEAPON_IDS) {
      const w = WEAPON_BY_ID.get(id)!;
      expect(w.wonder, id).toBe(true);
      expect(isWonderWeapon(id)).toBe(true);
      expect(w.projectile, id).toBe(true);
      expect(w.model, id).toBe(id);
    }
    expect(WEAPON_BY_ID.get('raygun')).toMatchObject({ magazine: 20, reserve: 60 });
    expect(WEAPON_BY_ID.get('thundergun')).toMatchObject({ magazine: 2, reserve: 12 });
    expect(WEAPON_BY_ID.get('wunderwaffe')).toMatchObject({ magazine: 3, reserve: 9 });
    expect(WEAPON_BY_ID.get('wintershowl')).toMatchObject({ magazine: 6, reserve: 24 });
    expect(WEAPON_BY_ID.get('scavenger')).toMatchObject({ magazine: 2, reserve: 12, mode: 'bolt', scope: true });
    expect(WEAPON_BY_ID.get('babygun')).toMatchObject({ magazine: 4, reserve: 16 });
    expect(WEAPON_BY_ID.get('wavegun')).toMatchObject({ magazine: 24, reserve: 144, mode: 'auto' });
    expect(isWonderWeapon('ak47')).toBe(false);
  });

  it('are never in create-a-class, the store, unlocks or bot classes', () => {
    for (const id of WONDER_WEAPON_IDS) {
      expect(LOADOUT_WEAPONS.some((w) => w.id === id), id).toBe(false);
      expect(storeCatalog().some((i) => i.id === id || i.key === keyOf.weapon(id)), id).toBe(false);
      expect(unlockTable().some((e) => e.kind === 'weapon' && e.id === id), id).toBe(false);
      const prof = newProfile('p', 'P');
      prof.level = 50;
      expect(isUnlocked(prof, 'weapon', id)).toBe(false);
      // A hand-edited class falls back to the starter guns.
      const l = sanitizeLoadout({ ...loadout(), primary: { weapon: id, attachments: [], camo: 'none' }, secondary: { weapon: id, attachments: [], camo: 'none' } });
      expect(l.primary.weapon).toBe('ak47');
      expect(l.secondary.weapon).toBe('m1911');
      const forced = { ...loadout(), primary: { weapon: id, attachments: [], camo: 'none' } };
      expect(enforceLoadout(prof, forced).loadout.primary.weapon).not.toBe(id);
    }
    for (let i = 0; i < 300; i++) {
      const l = chooseBotLoadout(i / 300);
      expect(isWonderWeapon(l.primary.weapon) || isWonderWeapon(l.secondary.weapon)).toBe(false);
    }
    expect(WEAPONS.filter((w) => w.wonder).map((w) => w.id).sort()).toEqual([...WONDER_WEAPON_IDS].sort());
  });

  it('pure maths: splash, blast tube and damage, chain picking, frost', () => {
    expect(raygunSplash(0)).toBeGreaterThanOrEqual(100);
    expect(raygunSplash(1.25)).toBeGreaterThanOrEqual(100);
    expect(raygunSplash(2.5)).toBeLessThan(100);
    expect(raygunSplash(RAYGUN.splash.r + 0.01)).toBe(0);
    expect(RAYGUN.splash.max * RAYGUN.selfScale).toBeLessThanOrEqual(32);
    const o = { x: 0, y: 1.5, z: 0 };
    const fwd = { x: 0, y: 0, z: -1 };
    expect(inTube(o, fwd, { x: 0, y: 1.5, z: -8 }, 12, 1.2, 2.6)).not.toBeNull();
    expect(inTube(o, fwd, { x: 0, y: 1.5, z: 8 }, 12, 1.2, 2.6)).toBeNull(); // behind
    expect(inTube(o, fwd, { x: 3, y: 1.5, z: -3 }, 12, 1.2, 2.6)).toBeNull(); // off to the side
    expect(inTube(o, fwd, { x: 0, y: 1.5, z: -13 }, 12, 1.2, 2.6)).toBeNull(); // too far
    expect(thunderDamage(3)).toBeGreaterThanOrEqual(100);
    expect(thunderDamage(THUNDERGUN.range)).toBeLessThan(100);
    const at = (x: number, z: number) => ({ at: { x, y: 1, z } });
    const a = at(0, 0);
    const cands = [a, at(4, 0), at(8, 0), at(12, 0), at(0, 30)];
    expect(chainTargets(a, cands, 2, 6, () => true).map((c) => c.at.x)).toEqual([4, 8]);
    expect(chainTargets(a, cands, 5, 6, () => true).map((c) => c.at.x)).toEqual([4, 8, 12]);
    expect(chainTargets(a, cands, 2, 6, (_p, q) => q.x !== 4)).toEqual([]);
    expect(frostAdded(2)).toBe(1);
    expect(frostAdded(WINTERS_HOWL.range)).toBe(0.5);
    expect(frostSlow(0)).toEqual({ speed: 1, turn: 1 });
    expect(frostSlow(1).speed).toBeLessThan(frostSlow(0.5).speed);
    expect(frostSlow(0.5).turn).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Ray Gun
// ---------------------------------------------------------------------------------------------

describe('Ray Gun', () => {
  it('fires a bolt that takes time to arrive; a direct hit kills', () => {
    const { room, a, foes, dead } = scene(1);
    const v = foes[0]!;
    place(a, -10, 20, 0, -Math.PI / 2);
    place(v, 10, 20);
    arm(a, 'raygun');
    expect(room.world.lineOfSight(eye(a), chestOf(v), 'bullets')).toBe(true);
    expect(room.fire(a, { dir: dirTo(eye(a), chestOf(v)), origin: eye(a) }).ok).toBe(true);
    expect(a.weapons[0]!.mag).toBe(19);
    room.step();
    const bolts = room.entities.byKind(WONDER_ENTITY.bolt);
    expect(bolts).toHaveLength(1);
    expect(bolts[0]!.x).toBeGreaterThan(-10 + RAYGUN.speed * TICK_DT * 0.5);
    // 20 m at 50 m/s: nothing after 0.2 s, dead by 0.5 s.
    steps(room, 0.2);
    expect(v.alive).toBe(true);
    expect(v.health).toBe(v.maxHealth);
    steps(room, 0.3);
    expect(v.alive).toBe(false);
    expect(dead[0]).toMatchObject({ victim: v, attacker: a, weapon: 'raygun' });
    expect(room.entities.byKind(WONDER_ENTITY.bolt)).toHaveLength(0);
  });

  // Seeded: hip spread can land the bolt over a metre off, which (correctly) spares `near`.
  it('splash kills near the impact, scratches further out, and stings the shooter a little', () => withSeed(1, () => {
    const { room, a, foes, dead } = scene(2);
    const [near, far] = foes as [PlayerState, PlayerState];
    place(a, -6, 20, 0, -Math.PI / 2);
    place(near, 4.9, 20);
    place(far, 4.5, 22.6);
    arm(a, 'raygun');
    // At the floor 0.9 m short of `near` (about 3 m from `far`).
    const target = { x: 4, y: 0.02, z: 20 };
    room.fire(a, { dir: dirTo(eye(a), target), origin: eye(a) });
    steps(room, 0.5);
    expect(near.alive).toBe(false);
    expect(dead.find((d) => d.victim === near)).toMatchObject({ weapon: 'raygun', means: 'explosive' });
    expect(far.alive).toBe(true);
    expect(far.health).toBeLessThan(far.maxHealth);
    // Self splash: a bolt into the floor a metre ahead.
    a.weapons[0]!.credit = 1;
    const before = a.health;
    room.fire(a, { dir: dirTo(eye(a), { x: a.move.x - 1, y: 0.02, z: 20 }), origin: eye(a) });
    steps(room, 0.3);
    expect(a.alive).toBe(true);
    expect(before - a.health).toBeGreaterThan(5);
    expect(before - a.health).toBeLessThanOrEqual(RAYGUN.splash.max * RAYGUN.selfScale + 1e-6);
  }));

  it('a wall eats the bolt (no splash through it)', () => {
    const { room, a, foes } = scene(1);
    const v = foes[0]!;
    // Find a wall on the Yard between two open spots.
    const world = room.world;
    let pair: [Vec3, Vec3] | null = null;
    for (let x = -24; x <= 24 && !pair; x += 1) {
      for (let z = -20; z <= 26 && !pair; z += 1) {
        const p = { x, y: 1.5, z };
        const q = { x: x + 8, y: 1.5, z };
        const g1 = world.groundBelow(x, z, 1, 2);
        const g2 = world.groundBelow(x + 8, z, 1, 2);
        if (g1 === 0 && g2 === 0 && world.free(x, 0.01, z) && world.free(x + 8, 0.01, z) && !world.lineOfSight(p, q, 'bullets')) pair = [p, q];
      }
    }
    expect(pair).not.toBeNull();
    const [p, q] = pair!;
    place(a, p.x, p.z, 0, -Math.PI / 2);
    place(v, q.x, q.z);
    arm(a, 'raygun');
    room.fire(a, { dir: { x: 1, y: 0, z: 0 }, origin: eye(a) });
    steps(room, 0.6);
    expect(v.health).toBe(v.maxHealth);
  });
});

// ---------------------------------------------------------------------------------------------
// Thundergun
// ---------------------------------------------------------------------------------------------

describe('Thundergun', () => {
  it('kills inside the blast up close; nothing behind or beside the shooter', () => {
    const { room, a, foes, dead } = scene(3);
    const [front, behind, side] = foes as [PlayerState, PlayerState, PlayerState];
    place(a, 0, 20, 0, -Math.PI / 2); // facing +x
    place(front, 5, 20);
    place(behind, -5, 20);
    place(side, 1, 24);
    arm(a, 'thundergun');
    expect(room.fire(a, { dir: { x: 1, y: 0, z: 0 }, origin: eye(a) }).ok).toBe(true);
    expect(front.alive).toBe(false);
    expect(dead[0]).toMatchObject({ victim: front, attacker: a, weapon: 'thundergun', means: 'wonder' });
    expect(behind.health).toBe(behind.maxHealth);
    expect(side.health).toBe(side.maxHealth);
  });

  it('launches survivors through their MoveState (knock), and shoves further out', () => {
    const { room, a, foes } = scene(2);
    const [mid, far] = foes as [PlayerState, PlayerState];
    place(a, -12, 20, 0, -Math.PI / 2);
    place(mid, -1.5, 20); // 10.5 m: hurt, not killed
    place(far, 4, 20.5); // 16 m: the shove
    arm(a, 'thundergun');
    room.fire(a, { dir: { x: 1, y: 0, z: 0 }, origin: eye(a) });
    expect(mid.alive).toBe(true);
    expect(mid.health).toBeLessThan(50);
    expect(mid.move.knock).toBeGreaterThan(0.5);
    expect(mid.move.vx).toBeGreaterThan(8);
    expect(mid.move.vy).toBeGreaterThan(3);
    expect(mid.move.onGround).toBe(false);
    expect(far.alive).toBe(true);
    expect(far.maxHealth - far.health).toBeCloseTo(THUNDERGUN.knockDamage, 5);
    expect(far.move.vx).toBeGreaterThan(2);
    expect(far.move.vx).toBeLessThan(mid.move.vx);
    const x0 = mid.move.x;
    steps(room, 1);
    expect(mid.move.x - x0).toBeGreaterThan(5);
    expect(mid.move.onGround).toBe(true);
  });

  it('a wall stops it', () => {
    const { room, a, foes } = scene(1);
    const v = foes[0]!;
    const world = room.world;
    let pair: [number, number, number] | null = null;
    for (let x = -24; x <= 20 && !pair; x += 1)
      for (let z = -20; z <= 26 && !pair; z += 1)
        if (world.groundBelow(x, z, 1, 2) === 0 && world.groundBelow(x + 5, z, 1, 2) === 0 && world.free(x, 0.01, z) && world.free(x + 5, 0.01, z) && !world.lineOfSight({ x, y: 1.5, z }, { x: x + 5, y: 0.3, z }, 'bullets') && !world.lineOfSight({ x, y: 1.5, z }, { x: x + 5, y: 1.6, z }, 'bullets') && !world.lineOfSight({ x, y: 1.5, z }, { x: x + 5, y: 1.9, z }, 'bullets')) pair = [x, x + 5, z];
    expect(pair).not.toBeNull();
    place(a, pair![0], pair![2], 0, -Math.PI / 2);
    place(v, pair![1], pair![2]);
    arm(a, 'thundergun');
    room.fire(a, { dir: { x: 1, y: 0, z: 0 }, origin: eye(a) });
    expect(v.health).toBe(v.maxHealth);
    expect(v.move.knock).toBe(0);
  });

  it('Highrise: blown off the open edge, the fall is the shooter\'s kill', () => {
    const { room, a, foes, dead } = (() => {
      const room = setup({ map: 'highrise' });
      room.modifiers.add('regenDelayMultiplier', () => 1000, 'test.noregen');
      const a = actor(room, 0);
      const v = actor(room, 1);
      return { room, a, foes: [v], dead: deaths(room) };
    })();
    const v = foes[0]!;
    // The west bulge's open construction edge is at x = -26.3 (kerb, no parapet) for -10.9 < z < 11.2.
    place(a, -15.5, -8, 0, Math.PI / 2); // facing -x
    place(v, -25.4, -8);
    arm(a, 'thundergun');
    room.fire(a, { dir: { x: -1, y: 0, z: 0 }, origin: eye(a) });
    expect(v.alive).toBe(true);
    expect(v.move.knock).toBeGreaterThan(0);
    steps(room, 3);
    expect(v.alive).toBe(false);
    expect(dead.find((d) => d.victim === v)).toMatchObject({ attacker: a, weapon: 'thundergun', means: 'wonder' });
    expect(a.stats.kills).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Wunderwaffe DG-2
// ---------------------------------------------------------------------------------------------

describe('Wunderwaffe DG-2', () => {
  it('kills the target and arcs to two more within range, one hop at a time; the fourth is spared', () => {
    const { room, a, foes, dead } = scene(4);
    const [t0, t1, t2, t3] = foes as [PlayerState, PlayerState, PlayerState, PlayerState];
    place(a, -15, 20, 0, -Math.PI / 2);
    place(t0, 0, 20);
    place(t1, 4, 20);
    place(t2, 8, 21);
    place(t3, 12, 21);
    arm(a, 'wunderwaffe');
    room.fire(a, { dir: dirTo(eye(a), chestOf(t0)), origin: eye(a) });
    expect(t0.alive).toBe(false);
    expect(t1.alive).toBe(true); // the arc takes a moment
    steps(room, WUNDERWAFFE.hopDelay * 2 + 0.1);
    expect(t1.alive).toBe(false);
    expect(t2.alive).toBe(false);
    expect(t3.alive).toBe(true);
    expect(dead.map((d) => d.victim)).toEqual([t0, t1, t2]);
    for (const d of dead) expect(d).toMatchObject({ attacker: a, weapon: 'wunderwaffe' });
  });

  it('needs range and line of sight between hops; never arcs to teammates', () => {
    const { room, a, foes, friends } = scene(3, 1);
    const [t0, farAway, hidden] = foes as [PlayerState, PlayerState, PlayerState];
    const mate = friends[0]!;
    place(a, -15, 20, 0, -Math.PI / 2);
    place(t0, 0, 20);
    place(mate, 2, 20); // closer than anyone: still never hit
    place(farAway, 0, 27); // 7 m: past the hop range
    place(hidden, 20, -20);
    arm(a, 'wunderwaffe');
    room.fire(a, { dir: dirTo(eye(a), chestOf(t0)), origin: eye(a) });
    steps(room, 0.5);
    expect(t0.alive).toBe(false);
    expect(mate.health).toBe(mate.maxHealth);
    expect(farAway.alive).toBe(true);

    // Line of sight: a spot on the Yard with a wall between two enemies 4 m apart.
    const w = room.world;
    const open = (x: number, z: number) => w.free(x, 0.01, z) && w.groundBelow(x, z, 1, 2) === 0;
    const blind = (p: Vec3, q: Vec3) => [0.9, 1.1, 1.3].every((ya) => [0.9, 1.1, 1.3].every((yb) => !w.lineOfSight({ x: p.x, y: ya, z: p.z }, { x: q.x, y: yb, z: q.z }, 'bullets')));
    let found: { s: Vec3; t: Vec3; h: Vec3 } | null = null;
    for (let x = -24; x <= 24 && !found; x += 1)
      for (let z = -22; z <= 28 && !found; z += 1) {
        const t = { x, y: 0, z };
        const h = { x: x + 4, y: 0, z };
        const sh = { x: x - 10, y: 0, z };
        if (!open(t.x, t.z) || !open(h.x, h.z) || !open(sh.x, sh.z) || !blind(t, h)) continue;
        if (!w.lineOfSight({ x: sh.x, y: 1.6, z: sh.z }, { x: t.x, y: 1.1, z: t.z }, 'bullets')) continue;
        // Someone with a line to `t` but further than the hop range must not exist next to `h` either.
        found = { s: sh, t, h };
      }
    expect(found).not.toBeNull();
    const t1 = actor(room, 1);
    room.spawn(t0);
    place(a, found!.s.x, found!.s.z, 0, -Math.PI / 2);
    place(t0, found!.t.x, found!.t.z);
    place(t1, found!.h.x, found!.h.z);
    place(farAway, 20, -20);
    a.weapons[0]!.credit = 1;
    a.weapons[0]!.mag = 3;
    a.reloadEnd = 0;
    room.fire(a, { dir: dirTo(eye(a), chestOf(t0)), origin: eye(a) });
    steps(room, 0.5);
    expect(t0.alive).toBe(false);
    expect(t1.alive).toBe(true);
    expect(hidden.alive).toBe(true);
  });

  it('a bolt into the ground beside an enemy arcs into them', () => {
    const { room, a, foes } = scene(1);
    const v = foes[0]!;
    place(a, -10, 20, 0, -Math.PI / 2);
    place(v, 5, 20);
    arm(a, 'wunderwaffe');
    room.fire(a, { dir: dirTo(eye(a), { x: 3.6, y: 0.01, z: 20 }), origin: eye(a) });
    expect(v.alive).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Winter's Howl
// ---------------------------------------------------------------------------------------------

describe("Winter's Howl", () => {
  it('up close: one blast freezes solid (slow legs, frost entity), the second shatters', () => {
    const { room, a, foes, dead } = scene(1);
    const v = foes[0]!;
    place(a, 0, 20, 0, -Math.PI / 2);
    place(v, 3, 20);
    arm(a, 'wintershowl');
    const base = moveParamsFor(room, v).speed;
    room.fire(a, { dir: { x: 1, y: 0, z: 0 }, origin: eye(a) });
    expect(v.alive).toBe(true);
    expect(v.maxHealth - v.health).toBeCloseTo(WINTERS_HOWL.damage, 5);
    expect(frostOf(v)).toBe(1);
    expect(moveParamsFor(room, v).speed / base).toBeCloseTo(WINTERS_HOWL.frozen.speed, 3);
    expect(moveParamsFor(room, v).canSprint).toBe(false);
    room.step();
    const ice = room.entities.byKind(WONDER_ENTITY.frost);
    expect(ice).toHaveLength(1);
    expect(ice[0]!.s?.p).toBe(v.id);
    steps(room, 0.5);
    a.weapons[0]!.credit = 1;
    room.fire(a, { dir: { x: 1, y: 0, z: 0 }, origin: eye(a) });
    expect(v.alive).toBe(false);
    expect(dead[0]).toMatchObject({ victim: v, attacker: a, weapon: 'wintershowl', means: 'wonder' });
    room.step();
    expect(room.entities.byKind(WONDER_ENTITY.frost)).toHaveLength(0);
  });

  it('frost stacks from range: slowed, then frozen, then shattered; it thaws if left alone', () => {
    const { room, a, foes } = scene(1);
    const v = foes[0]!;
    place(a, -10, 20, 0, -Math.PI / 2);
    place(v, 0, 20);
    arm(a, 'wintershowl');
    const shoot = () => {
      a.weapons[0]!.credit = 1;
      room.fire(a, { dir: { x: 1, y: 0, z: 0 }, origin: eye(a) });
      // Keep them where they stand (they'd walk off slowly otherwise).
      v.move.x = 0;
      v.move.z = 20;
    };
    shoot();
    const f1 = frostOf(v);
    expect(f1).toBeGreaterThan(0.5);
    expect(f1).toBeLessThan(1);
    const slowed = frostSlow(frostOf(v)).speed;
    expect(slowed).toBeLessThan(1);
    expect(slowed).toBeGreaterThan(WINTERS_HOWL.frozen.speed);
    steps(room, 0.5);
    shoot();
    expect(frostOf(v)).toBe(1);
    steps(room, 0.5);
    shoot();
    expect(v.alive).toBe(false);

    // A fresh victim, hit once from range and left alone, thaws out.
    const w = actor(room, 1);
    place(w, 0, 20);
    const base = moveParamsFor(room, w).speed;
    a.weapons[0]!.reserve = 24;
    a.weapons[0]!.mag = 6;
    a.reloadEnd = 0;
    steps(room, 0.1);
    a.weapons[0]!.credit = 1;
    room.fire(a, { dir: { x: 1, y: 0, z: 0 }, origin: eye(a) });
    const f = frostOf(w);
    expect(f).toBeGreaterThan(0);
    steps(room, WINTERS_HOWL.thawDelay + f / WINTERS_HOWL.thaw + 0.3);
    expect(frostOf(w)).toBe(0);
    expect(moveParamsFor(room, w).speed).toBe(base);
  });
});

// ---------------------------------------------------------------------------------------------
// Pickups and bots
// ---------------------------------------------------------------------------------------------

describe('wonder weapons as pickups', () => {
  it('drop on death like any gun, and despawn sooner', () => {
    const { room, a, foes } = scene(1);
    const v = foes[0]!;
    place(v, 0, 20);
    arm(v, 'raygun');
    v.weapons[0]!.mag = 12;
    room.kill(v, a, { weapon: 'ak47', means: 'bullet', part: 'torso' });
    const drop = dropsOf(room).find((d) => d.data.weapon === 'raygun');
    expect(drop).toBeDefined();
    expect(drop!.data.mag).toBe(12);
    expect(drop!.data.expires - drop!.data.born).toBe(WONDER_DROP_LIFE_SEC);
    expect(WONDER_DROP_LIFE_SEC).toBeLessThan(PICKUP.lifeSec);
    steps(room, WONDER_DROP_LIFE_SEC + 0.2);
    expect(dropsOf(room).some((d) => d.data.weapon === 'raygun')).toBe(false);
  });

  it('a bot with full guns still detours for a dropped wonder weapon nearby', () => {
    const { room, a, foes } = scene(1);
    const v = foes[0]!;
    place(v, 2, 20);
    arm(v, 'thundergun');
    room.kill(v, null, { weapon: 'world', means: 'world' });
    steps(room, 0.5);
    place(a, 0, 20);
    expect(chooseWonderDrop(room, a, 10)?.data.weapon).toBe('thundergun');
    arm(a, 'thundergun');
    expect(chooseWonderDrop(room, a, 10)).toBeNull(); // already carries one
  });
});

describe('bots and wonder weapons', () => {
  it('simple rules: short-range ones hold fire outside the blast and swap far off', () => {
    const room = setup();
    const b = actor(room, 0);
    arm(b, 'thundergun');
    expect(wonderBotStyle('thundergun')?.rush).toBe(true);
    expect(wonderBotStyle('ak47')).toBeNull();
    expect(wonderBotDecision(b, 'thundergun', 8)).toBe('fire');
    expect(wonderBotDecision(b, 'thundergun', 13)).toBe('hold');
    expect(wonderBotDecision(b, 'thundergun', 25)).toBe('switch');
    b.weapons[1]!.mag = 0;
    b.weapons[1]!.reserve = 0;
    expect(wonderBotDecision(b, 'thundergun', 25)).toBe('hold');
    expect(wonderBotDecision(b, 'raygun', 30)).toBe('fire');
    expect(wonderBotDecision(b, 'wunderwaffe', 60)).toBe('hold');
    expect(wonderBotDecision(b, 'wintershowl', 9)).toBe('fire');
  });

  it("a bot's Ray Gun bolt leads a moving target", () => {
    const { room, a, foes } = scene(1);
    const v = foes[0]!;
    place(a, -15, 20, 0, -Math.PI / 2);
    place(v, 10, 20);
    arm(a, 'raygun');
    // The target strafes along +z at 5 m/s: the bolt should head for where it will be.
    v.move.vz = 5;
    room.fire(a, { dir: dirTo(eye(a), chestOf(v)), origin: eye(a) });
    room.step();
    const bolt = room.entities.byKind(WONDER_ENTITY.bolt)[0]!;
    expect(bolt.z).toBeGreaterThan(20.05);
  });
});
