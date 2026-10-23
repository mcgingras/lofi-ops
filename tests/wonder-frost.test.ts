/**
 * Winter's Howl after the playtest ("nobody gets frosted, they still shoot me, needs more range"):
 * its reach (19 m, a wide cone), blasts to freeze up close and far off, frost on the trigger
 * (slower, wilder; frozen solid: no fire, no ADS, no knife or throw), and bots obeying it (a frozen
 * bot never fires, a thawed one does).
 */
import { afterEach, describe, expect, it } from 'vitest';
import bots from '../src/server/features/bots/index';
import { botBrain, configureRoomBots } from '../src/server/features/bots/api';
import perks from '../src/server/features/perks/index';
import weapons from '../src/server/features/weapons/index';
import { frostOf, wonderOf } from '../src/server/features/weapons/wonder/index';
import { Lobby } from '../src/server/lobby';
import { makeWeapon, type PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { moveParamsFor } from '../src/server/sim';
import { Store } from '../src/server/store';
import { PLAYER, TICK_DT, type Team } from '../src/shared/constants';
import { blastsToFreeze, frostAdded, frostSlow, frostSuppress, inTube, WINTERS_HOWL } from '../src/shared/defs/wonder';
import { Buttons } from '../src/shared/input';
import { cloneLoadout, DEFAULT_LOADOUTS } from '../src/shared/loadout';
import type { Vec3 } from '../src/shared/math';
import { createMoveState } from '../src/shared/movement';
import { withSeed } from './bots-sim';

let store: Store | undefined;
let lobby: Lobby | undefined;

function setup(withBots = false): Room {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: withBots ? [bots, weapons, perks] : [weapons, perks], log: () => {}, autoTick: false });
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
const EAST = { x: 1, y: 0, z: 0 };

/** Shooter at x = -10 on the open lane at z = 20 in the Yard, a victim `d` metres east of them. */
function lane(d: number) {
  const room = setup();
  const a = actor(room, 0);
  const v = actor(room, 1);
  place(a, -10, 20, -Math.PI / 2);
  place(v, -10 + d, 20);
  arm(a, 'wintershowl');
  const blast = () => {
    a.weapons[0]!.credit = 1;
    a.weapons[0]!.mag = 6;
    const r = room.fire(a, { dir: EAST, origin: eye(a) });
    v.move.x = -10 + d;
    v.move.z = 20;
    return r;
  };
  return { room, a, v, blast };
}

describe("Winter's Howl: reach", () => {
  it('reaches 19 m down a cone ~6 m across at the end', () => {
    expect(WINTERS_HOWL.range).toBeGreaterThanOrEqual(18);
    expect(WINTERS_HOWL.range).toBeLessThanOrEqual(20);
    const o = { x: 0, y: 1.6, z: 0 };
    const fwd = { x: 0, y: 0, z: -1 };
    expect(inTube(o, fwd, { x: 2.5, y: 1.6, z: -18 }, WINTERS_HOWL.range, WINTERS_HOWL.r0, WINTERS_HOWL.r1)).not.toBeNull();
    expect(inTube(o, fwd, { x: 0, y: 1.6, z: -20 }, WINTERS_HOWL.range, WINTERS_HOWL.r0, WINTERS_HOWL.r1)).toBeNull();
    expect(frostAdded(WINTERS_HOWL.range + 0.1)).toBe(0);
  });

  it('frosts a target 18.5 m away, not one 20.5 m away', () => {
    const near = lane(18.5);
    expect(near.room.world.lineOfSight(eye(near.a), chest(near.v), 'bullets')).toBe(true);
    expect(near.blast().ok).toBe(true);
    expect(frostOf(near.v)).toBeGreaterThan(0.45);
    expect(near.v.maxHealth - near.v.health).toBeCloseTo(WINTERS_HOWL.damage, 5);
    lobby!.shutdown();
    store!.close();

    const far = lane(20.5);
    expect(far.room.world.lineOfSight(eye(far.a), chest(far.v), 'bullets')).toBe(true);
    far.blast();
    expect(frostOf(far.v)).toBe(0);
    expect(far.v.health).toBe(far.v.maxHealth);
  });
});

describe("Winter's Howl: blasts to freeze", () => {
  it('pure: one blast inside 7 m, never more than two out to the full range', () => {
    for (let d = 0.5; d <= 7; d += 0.5) expect(blastsToFreeze(d), `${d} m`).toBe(1);
    for (let d = 7.5; d <= WINTERS_HOWL.range; d += 0.5) expect(blastsToFreeze(d), `${d} m`).toBe(2);
    // Shockproof (Flak Jacket Pro) halves frost: two up close.
    expect(blastsToFreeze(3, 0.5)).toBe(2);
  });

  it('near (5 m): one blast freezes solid, the next shatters', () => {
    const { v, blast } = lane(5);
    blast();
    expect(frostOf(v)).toBe(1);
    expect(v.alive).toBe(true);
    blast();
    expect(v.alive).toBe(false);
  });

  it('far (17 m): two blasts freeze solid, the third shatters', () => {
    const { room, v, blast } = lane(17);
    blast();
    expect(frostOf(v)).toBeGreaterThanOrEqual(0.5);
    expect(frostOf(v)).toBeLessThan(1);
    steps(room, 0.5);
    blast();
    expect(frostOf(v)).toBe(1);
    steps(room, 0.5);
    blast();
    expect(v.alive).toBe(false);
  });
});

describe("Winter's Howl: frost takes the fight out of you", () => {
  it('partial frost: slower trigger and wider spread, sent to the client', () => {
    const { room, v, blast } = lane(17);
    // Other spread modifiers (Steady Aim in the default class) stay on top of the frost's.
    const spread0 = room.modifiers.mul('spreadMultiplier', v);
    const rate0 = room.modifiers.mul('fireRateMultiplier', v);
    blast();
    const f = frostOf(v);
    const s = frostSuppress(f);
    expect(s.hands).toBe(true);
    expect(s.fireRate).toBeLessThan(0.75);
    expect(s.spread).toBeGreaterThan(1.8);
    expect(room.modifiers.mul('fireRateMultiplier', v) / rate0).toBeCloseTo(s.fireRate, 5);
    expect(room.modifiers.mul('spreadMultiplier', v) / spread0).toBeCloseTo(s.spread, 5);
    expect(moveParamsFor(room, v).fireRate).toBeCloseTo(rate0 * s.fireRate, 5);
    expect(moveParamsFor(room, v).canFire).toBeUndefined();
  });

  it('frozen solid: cannot fire, aim down sights, knife or throw, and cannot move or turn', () => {
    const { room, a, v, blast } = lane(4);
    blast();
    expect(frostOf(v)).toBe(1);
    v.swapEnd = 0;
    v.reloadEnd = 0;
    v.weapons[0]!.credit = 1;
    expect(room.fire(v, { dir: { x: -1, y: 0, z: 0 }, origin: eye(v) })).toEqual({ ok: false, reason: 'hands' });
    const params = moveParamsFor(room, v);
    expect(params.canFire).toBe(false);
    expect(params.canAds).toBe(false);
    expect(params.speed).toBe(0);
    expect(frostSlow(1).turn).toBe(0);
    // ADS held: the sights never come up.
    v.brain = { think: (_r, self) => ({ buttons: Buttons.ADS, yaw: self.yaw, pitch: self.pitch, weaponSlot: self.slot }) };
    steps(room, 0.5);
    expect(v.move.ads).toBe(0);
    // Knife and grenade presses do nothing.
    let melee = 0;
    let thrown = 0;
    room.bus.on('weapons.melee', () => melee++);
    room.bus.on('weapons.thrown', () => thrown++);
    place(v, a.move.x + 1, a.move.z, Math.PI / 2);
    v.brain = { think: (_r, self) => ({ buttons: room.tick % 2 ? Buttons.MELEE | Buttons.LETHAL : 0, yaw: self.yaw, pitch: self.pitch, weaponSlot: self.slot }) };
    steps(room, 0.5);
    expect(melee).toBe(0);
    expect(thrown).toBe(0);
    expect(a.alive).toBe(true);
    // Once it thaws below solid, the trigger works again (slowly).
    steps(room, WINTERS_HOWL.frozenSec + 0.5);
    expect(frostOf(v)).toBeLessThan(1);
    expect(room.modifiers.any('canFire', v)).not.toBe(false);
  });

  it('a frozen bot does not fire; the same bot thawed does', () => withSeed(7, () => {
    const room = setup(true);
    configureRoomBots(room, { fill: false, difficulty: 'veteran', variance: 0 }, { waitSec: 0 });
    const shooter = room.addBot({ name: 'Shooter', team: 0 });
    const dummy = room.addBot({ name: 'Dummy', team: 1 });
    dummy.brain = { think: () => null };
    if (!shooter.alive) room.spawn(shooter);
    if (!dummy.alive) room.spawn(dummy);
    room.bus.on('beforeDamage', (e) => {
      if (e.victim === dummy) e.cancel = true;
    });
    let shots = 0;
    room.bus.on('fire', (e) => {
      if (e.player === shooter) shots++;
    });
    const reset = () => {
      shooter.move = { ...createMoveState(-10, 0, 20), onGround: true };
      dummy.move = { ...createMoveState(2, 0, 20), onGround: true };
      shooter.yaw = -Math.PI / 2;
      for (const w of shooter.weapons) {
        w.mag = w.def.magazine;
        w.reserve = w.def.reserve;
      }
      const brain = botBrain(room, shooter)!;
      brain.target = null;
      brain.aim.yaw = -Math.PI / 2;
    };
    const freeze = () => {
      const w = wonderOf(shooter);
      w.frost = 1;
      w.frostAt = room.time;
      w.frozenUntil = room.time + 60;
    };
    reset();
    freeze();
    for (let i = 0; i < 4 * 60; i++) {
      room.step();
      dummy.move.x = 2;
      dummy.move.z = 20;
      shooter.move.x = -10;
      shooter.move.z = 20;
    }
    expect(frostOf(shooter)).toBe(1);
    expect(shots).toBe(0);
    // Thawed: it notices the target and opens up.
    wonderOf(shooter).frost = 0;
    wonderOf(shooter).frozenUntil = 0;
    reset();
    steps(room, 4);
    expect(shots).toBeGreaterThan(0);
  }));
});
