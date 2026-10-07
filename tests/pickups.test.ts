/**
 * Weapon drops and pickups, rules level (rooms driven tick by tick): drop on death with ammo,
 * attachments and camo; the fall; swap by holding USE (validated: reach, line of sight, alive,
 * phase, same weapon); the walk-over ammo take; despawn and the room cap; USE priority against
 * care packages, S&D plant/defuse and last stand; wagers without drops; bots picking up when dry.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import killstreaks from '../src/server/features/killstreaks/index';
import { callKillstreak } from '../src/server/features/killstreaks/api';
import { grant } from '../src/server/features/killstreaks/state';
import { cratesOf } from '../src/server/features/killstreaks/streaks/package';
import { ksRoom } from '../src/server/features/killstreaks/world';
import modesFeature, { registerModeRules } from '../src/server/features/modes/index';
import { controllerOf } from '../src/server/features/modes/common';
import type { SdRules } from '../src/server/features/modes/sd';
import perks from '../src/server/features/perks/index';
import pickups, { ammoNeed, dropsOf, pickupsOf, spawnDrop, swapBlocker, useTarget, type DropEntity } from '../src/server/features/pickups/index';
import weapons from '../src/server/features/weapons/index';
import { Lobby } from '../src/server/lobby';
import { makeWeapon, type PlayerState } from '../src/server/player';
import type { Room, RoomOptions } from '../src/server/room';
import { Store } from '../src/server/store';
import { TICK_DT, type Team } from '../src/shared/constants';
import { DEFAULT_LOBBY_BOTS, skillFor } from '../src/shared/defs/bots';
import { MODE_TUNING } from '../src/shared/defs/modes';
import { canDropWeapon, dropScore, pickDropTarget, PICKUP, PICKUP_ENTITY } from '../src/shared/defs/pickups';
import { Buttons } from '../src/shared/input';
import { cloneLoadout, DEFAULT_LOADOUTS, type Loadout } from '../src/shared/loadout';
import { createMoveState } from '../src/shared/movement';

let store: Store | undefined;
let lobby: Lobby | undefined;

beforeAll(() => registerModeRules());

function setup(opts: Partial<RoomOptions> = {}): Room {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: [weapons, perks, killstreaks, modesFeature, pickups], log: () => {}, autoTick: false });
  return lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, ...opts });
}

afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = undefined;
  store = undefined;
});

const loadout = (primary = 'ak47', atts: string[] = [], camo = 'none', perksList: string[] = []): Loadout => ({ ...cloneLoadout(DEFAULT_LOADOUTS[0]!), primary: { weapon: primary, attachments: atts, camo }, perks: perksList });

/** A bot that never thinks on its own (we drive it) and never picks up guns by itself. */
function actor(room: Room, team: Team | null, l: Loadout = loadout()): PlayerState {
  const p = room.addBot({ team, loadout: l });
  p.ext.bots = { rolls: { form: 0, knobs: {} as never }, skill: { ...skillFor(DEFAULT_LOBBY_BOTS), weaponPickup: 0 } };
  hold(p, 0);
  if (!p.alive) room.spawn(p);
  return p;
}

/** A "human": inputs come from the queue (USE is handled for humans only). */
function human(room: Room, team: Team | null, l: Loadout = loadout()): PlayerState {
  const p = actor(room, team, l);
  p.isBot = false;
  p.brain = null;
  return p;
}

const place = (p: PlayerState, x: number, z: number, y = 0) => {
  p.move = { ...createMoveState(x, y, z), onGround: true };
};
const hold = (p: PlayerState, buttons: number, yaw?: number, pitch?: number) => {
  p.brain = { think: (_r, self) => ({ buttons, yaw: yaw ?? self.yaw, pitch: pitch ?? self.pitch, weaponSlot: self.slot }) };
};
let seq = 0;
/** Step `seconds`, feeding human `h` one command per tick. */
function drive(room: Room, h: PlayerState, buttons: number, seconds: number, yaw = h.yaw, pitch = h.pitch, slot = h.slot) {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) {
    room.queueInputs(h, [{ seq: ++seq, dt: TICK_DT, buttons, yaw, pitch, weaponSlot: slot }]);
    room.step();
  }
}
const steps = (room: Room, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) room.step();
};
const killBy = (room: Room, attacker: PlayerState | null, victim: PlayerState) => room.kill(victim, attacker, { weapon: 'ak47', means: 'bullet', part: 'torso' });
const landed = (room: Room) => dropsOf(room).filter((d) => d.data.landed);
/** Put a landed gun on the floor at x,z. */
function floorGun(room: Room, x: number, z: number, weapon = 'famas', mag = 20, reserve = 60, atts: string[] = []): DropEntity {
  const w = makeWeapon({ weapon, attachments: atts, camo: 'none' }, weapon);
  w.mag = mag;
  w.reserve = reserve;
  const e = spawnDrop(room, w, { x, y: 0, z }, { x: 0, y: 0, z: 0 }, null, null, 'death')!;
  steps(room, 0.5);
  expect(e.data.landed).toBe(true);
  return e;
}
/** Yaw that looks from p toward (x, z). */
const yawTo = (p: PlayerState, x: number, z: number) => Math.atan2(-(x - p.move.x), -(z - p.move.z));

describe('shared rules', () => {
  it('only primaries and secondaries drop', () => {
    expect(canDropWeapon('ak47')).toBe(true);
    expect(canDropWeapon('m1911')).toBe(true);
    expect(canDropWeapon('knife')).toBe(false);
    expect(canDropWeapon('gl')).toBe(false);
    expect(canDropWeapon('nope')).toBe(false);
  });

  it('reach, and what you look at beats what you stand on', () => {
    const feet = { x: 0, y: 0, z: 0 };
    expect(dropScore(feet, 1.6, 0, -0.5, { x: 0, y: 0, z: -(PICKUP.radius + 0.1) })).toBeNull();
    expect(dropScore(feet, 1.6, 0, -0.5, { x: 0, y: 2, z: -1 })).toBeNull();
    // yaw 0 looks down -z: the gun ahead wins over the closer one behind.
    const ahead = { id: 1, x: 0, y: 0, z: -1.4 };
    const behind = { id: 2, x: 0, y: 0, z: 0.5 };
    expect(pickDropTarget(feet, 1.6, 0, -0.7, [ahead, behind])?.id).toBe(1);
    expect(pickDropTarget(feet, 1.6, Math.PI, -0.7, [ahead, behind])?.id).toBe(2);
    expect(pickDropTarget(feet, 1.6, 0, -0.7, [ahead, behind], (d) => d.id !== 1)?.id).toBe(2);
  });
});

describe('drop on death', () => {
  it('drops the gun in hand with its mag, reserve, attachments and camo; it falls and lands', () => {
    const room = setup();
    const v = actor(room, 1, loadout('famas', ['reddot'], 'woodland'));
    place(v, -1, 5);
    const famas = v.weapons[0]!;
    famas.mag = 7;
    famas.reserve = 33;
    killBy(room, null, v);
    const [d] = dropsOf(room);
    expect(d).toBeDefined();
    expect(d!.data).toMatchObject({ weapon: 'famas', attachments: ['reddot'], camo: 'woodland', mag: 7, reserve: 33, landed: false, from: v.id });
    expect(d!.s).toMatchObject({ w: 'famas', a: 'reddot', c: 'woodland', l: false, m: 7, r: 33 });
    expect(d!.y).toBeGreaterThan(0.5);
    const yaw0 = d!.yaw;
    steps(room, 1.5);
    expect(d!.data.landed).toBe(true);
    expect(d!.s.l).toBe(true);
    expect(d!.y).toBeCloseTo(PICKUP.restHeight, 2);
    expect(d!.yaw).not.toBe(yaw0); // spun on the way down
    expect(Math.hypot(d!.x - -1, d!.z - 5)).toBeLessThan(1.5);
  });

  it('drops the sidearm when that is in hand, nothing when empty, nothing in wagers', () => {
    const room = setup();
    const v = actor(room, 1);
    place(v, -1, 5);
    v.slot = 1;
    killBy(room, null, v);
    expect(dropsOf(room).map((d) => d.data.weapon)).toEqual(['m1911']);
    room.spawn(v);
    v.weapons[0]!.mag = v.weapons[0]!.reserve = 0;
    killBy(room, null, v);
    expect(dropsOf(room)).toHaveLength(1);
    lobby!.shutdown();
    const w = setup({ mode: 'gungame' });
    const g = actor(w, null);
    killBy(w, null, g);
    expect(w.entities.byKind(PICKUP_ENTITY)).toHaveLength(0);
  });

  it('despawns after lifeSec; the room keeps at most maxPerRoom (oldest go first)', () => {
    const room = setup();
    const v = actor(room, 1);
    place(v, -1, 5);
    killBy(room, null, v);
    const first = dropsOf(room)[0]!;
    steps(room, PICKUP.lifeSec - 1);
    expect(room.entities.get(first.id)).toBeDefined();
    steps(room, 1.2);
    expect(room.entities.get(first.id)).toBeUndefined();
    const made: number[] = [];
    for (let i = 0; i < PICKUP.maxPerRoom + 3; i++) made.push(floorGun(room, -1 + (i % 4), 2 + Math.floor(i / 4)).id);
    const ids = dropsOf(room).map((d) => d.id);
    expect(ids).toHaveLength(PICKUP.maxPerRoom);
    expect(ids).toEqual(made.slice(3));
  });

  it('S&D: a new round clears last round’s guns', () => {
    const room = setup({ mode: 'sd', onEnd: 'close' });
    const a = actor(room, 0);
    const b = actor(room, 1);
    room.endMatch('aborted');
    room.startMatch();
    steps(room, MODE_TUNING.sd.prepSec + 0.1);
    killBy(room, a, b);
    expect(dropsOf(room)).toHaveLength(1);
    steps(room, MODE_TUNING.sd.postSec + 1);
    expect(dropsOf(room)).toHaveLength(0);
  });
});

describe('swap', () => {
  it('holding USE briefly swaps: you take its ammo, yours drops with its ammo', () => {
    const room = setup();
    const h = human(room, 0);
    place(h, -1, 5);
    h.weapons[0]!.mag = 3;
    h.weapons[0]!.reserve = 12;
    const gun = floorGun(room, -1, 4, 'famas', 20, 60, ['acog']);
    const yaw = yawTo(h, -1, 4);
    expect(useTarget(room, Object.assign(h, { yaw, pitch: -0.9 }))?.id).toBe(gun.id);
    drive(room, h, Buttons.USE, PICKUP.holdSec - 0.1, yaw, -0.9);
    expect(h.weapons[0]!.def.base.id).toBe('ak47');
    drive(room, h, Buttons.USE, 0.15, yaw, -0.9);
    const w = h.weapons[0]!;
    expect(w.def.base.id).toBe('famas');
    expect(w.def.attachmentIds).toEqual(['acog']);
    expect([w.mag, w.reserve]).toEqual([20, 60]);
    expect(h.swapEnd).toBeGreaterThan(room.time); // raising the new gun
    expect(room.entities.get(gun.id)).toBeUndefined();
    const mine = dropsOf(room);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.data).toMatchObject({ weapon: 'ak47', mag: 3, reserve: 12, from: h.id });
    // Still holding USE: no swapping straight back. Let go and hold again: back to the AK.
    drive(room, h, Buttons.USE, 1, yawTo(h, mine[0]!.x, mine[0]!.z), -1.2);
    expect(h.weapons[0]!.def.base.id).toBe('famas');
    drive(room, h, 0, 0.1);
    drive(room, h, Buttons.USE, 0.4, yawTo(h, mine[0]!.x, mine[0]!.z), -1.2);
    expect(h.weapons[0]!.def.base.id).toBe('ak47');
    expect([h.weapons[0]!.mag, h.weapons[0]!.reserve]).toEqual([3, 12]);
  });

  it('a stutter on the key (or a lag gap) does not swap straight back to the gun you just dropped', () => {
    const room = setup();
    const h = human(room, 0);
    place(h, -1, 5);
    floorGun(room, -1, 4.2, 'famas');
    const yaw = yawTo(h, -1, 4.2);
    drive(room, h, Buttons.USE, 0.3, yaw, -1);
    expect(h.weapons[0]!.def.base.id).toBe('famas');
    steps(room, 0.4); // no input: the server idles (USE up)
    const ak = dropsOf(room)[0]!;
    expect(swapBlocker(room, Object.assign(h, { yaw: yawTo(h, ak.x, ak.z), pitch: -1.2 }), ak)).toBe('just_dropped');
    drive(room, h, Buttons.USE, 0.4, yawTo(h, ak.x, ak.z), -1.2);
    expect(h.weapons[0]!.def.base.id).toBe('famas');
  });

  it('swaps the gun in hand: holding the sidearm, the sidearm goes', () => {
    const room = setup();
    const h = human(room, 0);
    place(h, -1, 5);
    drive(room, h, 0, 0.8, h.yaw, 0, 1);
    expect(h.slot).toBe(1);
    floorGun(room, -1, 4.2, 'famas');
    drive(room, h, Buttons.USE, 0.4, yawTo(h, -1, 4.2), -1, 1);
    expect(h.weapons.map((w) => w.def.base.id)).toEqual(['ak47', 'famas']);
    expect(dropsOf(room).map((d) => d.data.weapon)).toEqual(['m1911']);
  });

  it('validation: reach, line of sight, alive, playing, same weapon, GL slot', () => {
    const room = setup();
    const h = human(room, 0);
    place(h, -1, 5);
    const gun = floorGun(room, -1, 5 - PICKUP.radius - 0.3);
    h.yaw = yawTo(h, gun.x, gun.z);
    h.pitch = -0.8;
    expect(swapBlocker(room, h, gun)).toBe('far');
    drive(room, h, Buttons.USE, 0.5, h.yaw, -0.8);
    expect(h.weapons[0]!.def.base.id).toBe('ak47');
    place(h, -1, gun.z + 1);
    expect(swapBlocker(room, h, gun)).toBeNull();
    expect(swapBlocker(room, h, gun, { slot: 2 })).toBe('slot');
    drive(room, h, 0, 0.1);
    const ak = floorGun(room, -1.5, gun.z + 1, 'ak47');
    expect(swapBlocker(room, h, ak)).toBe('same_weapon');
    h.alive = false;
    expect(swapBlocker(room, h, gun)).toBe('dead');
    h.alive = true;
    room.endMatch('aborted');
    expect(swapBlocker(room, h, gun)).toBe('phase');
  });

  it('line of sight: no grabbing through a wall', () => {
    const room = setup();
    const h = human(room, 0);
    // Find a wall on the map: a gun on the far side of a thin solid within reach.
    const wall = room.map.brushes.find((b) => b.collide !== false && b.max.y - b.min.y > 2 && b.max.x - b.min.x < 0.6 && b.max.z - b.min.z > 3 && b.min.y <= 0.1);
    expect(wall).toBeDefined();
    const z = (wall!.min.z + wall!.max.z) / 2;
    const y = wall!.min.y;
    place(h, wall!.min.x - 0.45, z, y);
    const w = makeWeapon({ weapon: 'famas', attachments: [], camo: 'none' }, 'famas');
    const gun = spawnDrop(room, w, { x: wall!.max.x + 0.4, y, z }, { x: 0, y: 0, z: 0 }, null, null, 'death')!;
    steps(room, 0.5);
    h.yaw = yawTo(h, gun.x, gun.z);
    h.pitch = -0.6;
    expect(swapBlocker(room, h, gun)).toBe('blocked');
  });

  it('carries the underbarrel launcher (and its rounds) with the gun', () => {
    const room = setup();
    const h = human(room, 0, loadout('ak47', ['gl']));
    place(h, -1, 5);
    expect(h.weapons.map((w) => w.def.base.id)).toEqual(['ak47', 'm1911', 'gl']);
    h.weapons[2]!.mag = 0;
    h.weapons[2]!.reserve = 1;
    floorGun(room, -1, 4.2, 'famas');
    drive(room, h, Buttons.USE, 0.4, yawTo(h, -1, 4.2), -1);
    expect(h.weapons.map((w) => w.def.base.id)).toEqual(['famas', 'm1911']);
    const ak = dropsOf(room)[0]!;
    expect(ak.data.gl).toEqual({ mag: 0, reserve: 1 });
    steps(room, 0.6);
    drive(room, h, 0, 0.1);
    drive(room, h, Buttons.USE, 0.4, yawTo(h, ak.x, ak.z), -1.2);
    expect(h.weapons.map((w) => w.def.base.id)).toEqual(['ak47', 'm1911', 'gl']);
    expect([h.weapons[2]!.mag, h.weapons[2]!.reserve]).toEqual([0, 1]);
  });
});

describe('walk-over ammo', () => {
  it('a copy of a gun you carry gives its ammo (up to the max) and goes away', () => {
    const room = setup();
    const h = human(room, 0);
    place(h, -1, 8);
    const ak = h.weapons[0]!;
    ak.reserve = ak.def.reserve - 10;
    const gun = floorGun(room, -1, 5, 'ak47', 25, 40);
    expect(swapBlocker(room, h, gun)).toBe('same_weapon');
    place(h, -1, 5.3);
    steps(room, 0.2);
    expect(ak.reserve).toBe(ak.def.reserve);
    expect(room.entities.get(gun.id)).toBeUndefined();
  });

  it('a full player leaves it on the floor', () => {
    const room = setup();
    const h = human(room, 0);
    place(h, -1, 8);
    const gun = floorGun(room, -1, 5, 'ak47');
    place(h, -1, 5.3);
    steps(room, 0.3);
    expect(room.entities.get(gun.id)).toBeDefined();
    expect(h.weapons[0]!.reserve).toBe(h.weapons[0]!.def.reserve);
  });
});

describe('USE priority', () => {
  it('a care package in reach wins: holding USE takes the crate, not the gun', () => {
    const room = setup();
    const h = human(room, 0);
    place(h, -1, 12);
    grant(room, h, 'care_package');
    expect(callKillstreak(room, h, 'care_package', { target: { x: -1, y: 0, z: 2 } }).ok).toBe(true);
    for (let i = 0; i < 15 / TICK_DT && !cratesOf(ksRoom(room)).some((c) => c.landed); i++) room.step();
    const crate = cratesOf(ksRoom(room))[0]!;
    crate.contents = 'uav';
    const gun = floorGun(room, crate.ent.x + 1.2, crate.ent.z);
    place(h, crate.ent.x + 1.5, crate.ent.z);
    const yaw = yawTo(h, gun.x, gun.z);
    h.yaw = yaw;
    h.pitch = -1;
    expect(swapBlocker(room, h, gun)).toBe('claimed');
    drive(room, h, Buttons.USE, 1, yaw, -1);
    expect(h.weapons[0]!.def.base.id).toBe('ak47');
    expect(room.entities.get(gun.id)).toBeDefined();
    expect(cratesOf(ksRoom(room))).toHaveLength(0); // the crate was taken (owner: 0.5 s)
    // Crate gone: now the same hold swaps.
    drive(room, h, 0, 0.1);
    drive(room, h, Buttons.USE, 0.4, yaw, -1);
    expect(h.weapons[0]!.def.base.id).toBe('famas');
  });

  it('S&D: planting at a site wins over a gun on the floor there', () => {
    const room = setup({ mode: 'sd', onEnd: 'close' });
    const atk = human(room, 0);
    actor(room, 1);
    room.endMatch('aborted');
    room.startMatch();
    const rules = controllerOf(room) as SdRules;
    steps(room, MODE_TUNING.sd.prepSec + 0.1);
    rules.bomb = { ...rules.bomb, state: 'carried', carrier: atk };
    const A = rules.sites.find((s) => s.id === 'A')!;
    place(atk, A.x, A.z, A.y);
    const gun = floorGun(room, A.x, A.z - 1, 'famas');
    const yaw = yawTo(atk, gun.x, gun.z);
    drive(room, atk, Buttons.USE, 1, yaw, -1);
    expect(rules.acting.get(atk)?.kind).toBe('plant');
    expect(atk.weapons[0]!.def.base.id).toBe('ak47');
    expect(room.entities.get(gun.id)).toBeDefined();
    // Not the carrier: the same spot swaps.
    rules.acting.delete(atk);
    rules.bomb = { ...rules.bomb, carrier: null, state: 'dropped', pos: { x: A.x + 30, y: A.y, z: A.z } };
    drive(room, atk, 0, 0.1, yaw, -1);
    drive(room, atk, Buttons.USE, 0.4, yaw, -1);
    expect(atk.weapons[0]!.def.base.id).toBe('famas');
  });

  it('no pickups while down in last stand', () => {
    const room = setup();
    const h = human(room, 0, loadout('ak47', [], 'none', ['second_chance']));
    const e = actor(room, 1);
    place(h, -1, 5);
    room.damage({ victim: h, attacker: e, amount: 500, weapon: 'ak47', part: 'torso', means: 'bullet', from: null, distance: 5 });
    expect(h.alive).toBe(true);
    expect(h.ext.perks?.lastStand).toBeTruthy();
    const gun = floorGun(room, -1, 4.2);
    h.yaw = yawTo(h, gun.x, gun.z);
    expect(swapBlocker(room, h, gun, { slot: 1 })).toBe('claimed');
  });
});

describe('bots', () => {
  it('a dry bot walks over to a gun and swaps its empty one for it', () => {
    const room = setup();
    const b = actor(room, 0);
    b.ext.bots!.skill!.weaponPickup = 1;
    place(b, -1, 5);
    for (const w of b.weapons) w.mag = w.reserve = 0;
    expect(ammoNeed(b)).toBe(2);
    const gun = floorGun(room, -1, 3.5, 'famas', 30, 90);
    // We move it ourselves (no bots feature here): stand in reach and it takes the gun.
    place(b, -1, 4.4);
    steps(room, 1.2);
    expect(b.weapons[0]!.def.base.id).toBe('famas');
    expect(b.weapons[0]!.mag).toBe(30);
    expect(room.entities.get(gun.id)).toBeUndefined();
    expect(pickupsOf(b).botTarget).toBeNull();
  });

  it('weaponPickup 0 never picks up; a full bot ignores guns', () => {
    const room = setup();
    const b = actor(room, 0);
    place(b, -1, 4.4);
    floorGun(room, -1, 3.5, 'famas');
    steps(room, 1.2);
    expect(b.weapons[0]!.def.base.id).toBe('ak47');
    for (const w of b.weapons) w.mag = w.reserve = 0;
    steps(room, 1.2);
    expect(b.weapons[0]!.def.base.id).toBe('ak47');
    expect(landed(room)).toHaveLength(1);
  });
});
