/**
 * Mystery Box killstreak, rules level (a Yard TDM room stepped tick by tick): the def; the
 * marker canister (STREAK raises it, FIRE throws it, `s.mb` marks the box's); the call-in
 * timeline (a box entity at the drop spot that lands on time and crushes an enemy under it); the
 * owner opening it by holding USE (enemies can't); the cycle always landing on a wonder weapon the
 * owner doesn't carry; taking it with a fresh USE press (it replaces the gun in hand, which drops);
 * the offer timing out and the box sinking/flying away; an unopened box leaving; USE claimed from
 * weapon pickups; and bots calling and using it through the killstreak API.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { callKillstreak, suggestTarget } from '../src/server/features/killstreaks/api';
import killstreaks, { onStreakPressed, throwMarker } from '../src/server/features/killstreaks/index';
import { grant, ksOf } from '../src/server/features/killstreaks/state';
import { boxesOf, type MysteryBox } from '../src/server/features/killstreaks/streaks/mysterybox';
import { ksRoom } from '../src/server/features/killstreaks/world';
import perks from '../src/server/features/perks/index';
import pickups, { dropsOf } from '../src/server/features/pickups/index';
import weapons from '../src/server/features/weapons/index';
import { Lobby } from '../src/server/lobby';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { Store } from '../src/server/store';
import { TICK_DT, type Team } from '../src/shared/constants';
import { KILLSTREAK_BY_ID, KS_ENTITY } from '../src/shared/defs/killstreaks';
import { BOX_CYCLE_SEC, BOX_CYCLE_WAITS, BOX_PHASE, cycleModel, cycleStepAt, cycleTimes, MYSTERY_BOX, MYSTERY_BOX_ENTITY, rollWonder, boxHeight } from '../src/shared/defs/mystery-box';
import { isWonderWeapon } from '../src/shared/defs/weapons';
import { WONDER_WEAPON_IDS } from '../src/shared/defs/wonder';
import { Buttons } from '../src/shared/input';
import { cloneLoadout, DEFAULT_LOADOUTS, type Loadout } from '../src/shared/loadout';
import { createMoveState } from '../src/shared/movement';

let store: Store | undefined;
let lobby: Lobby | undefined;
afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = undefined;
  store = undefined;
});

function setup(): Room {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: [weapons, perks, killstreaks, pickups], log: () => {}, autoTick: false });
  return lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false });
}

const loadout = (): Loadout => ({ ...cloneLoadout(DEFAULT_LOADOUTS[0]!), killstreaks: ['uav', 'mystery_box', 'attack_dogs'] });

/** A bot standing still (manual streaks). */
function botP(room: Room, team: Team): PlayerState {
  const p = room.addBot({ team, loadout: loadout() });
  p.brain = { think: (_r, self) => ({ buttons: 0, yaw: self.yaw, pitch: self.pitch, weaponSlot: self.slot }) };
  ksOf(p).manual = true;
  if (!p.alive) room.spawn(p);
  return p;
}
/** A "human": its commands come from the input queue. */
function human(room: Room, team: Team): PlayerState {
  const p = botP(room, team);
  p.isBot = false;
  p.brain = null;
  return p;
}
const place = (p: PlayerState, x: number, z: number, yaw = 0) => {
  p.move = { ...createMoveState(x, 0, z), onGround: true };
  p.yaw = yaw;
};
let seq = 0;
/** Step `seconds`, feeding human `h` one command per tick holding `buttons`. */
function drive(room: Room, h: PlayerState, buttons: number, seconds: number, yaw = h.yaw, pitch = h.pitch) {
  for (let i = 0; i < Math.max(1, Math.round(seconds / TICK_DT)); i++) {
    room.queueInputs(h, [{ seq: ++seq, dt: TICK_DT, buttons, yaw, pitch, weaponSlot: h.slot }]);
    room.step();
  }
}
const boxOf = (room: Room): MysteryBox | undefined => boxesOf(ksRoom(room))[0];

/** A human owner calls the box at (x, z) through the RPC path (a target, no canister flight) and waits for it to land. */
function landedBox(room: Room, owner: PlayerState, x = 0, z = 20): MysteryBox {
  grant(room, owner, 'mystery_box');
  expect(callKillstreak(room, owner, 'mystery_box', { target: { x, y: 0, z } }).ok).toBe(true);
  drive(room, owner, 0, 0.4);
  const b = boxOf(room)!;
  expect(b).toBeDefined();
  drive(room, owner, 0, b.tl - room.time + 0.05);
  expect(b.phase).toBe(BOX_PHASE.idle);
  return b;
}

describe('Mystery Box defs and maths', () => {
  it('is a 7-kill marker streak, separate from the Care Package', () => {
    const d = KILLSTREAK_BY_ID.get('mystery_box')!;
    expect(d).toMatchObject({ kills: 7, targeting: 'marker', name: 'Mystery Box' });
    expect(d.unlockLevel).toBeGreaterThan(1);
    expect(d.id).not.toBe('care_package');
  });

  it('the cycle follows BO1 (a fifth quicker): 38 slowing changes in ~3.1 s, always ending on the result', () => {
    expect(BOX_CYCLE_WAITS).toHaveLength(38);
    expect(BOX_CYCLE_SEC).toBeGreaterThan(2.9);
    expect(BOX_CYCLE_SEC).toBeLessThan(3.5);
    for (let i = 1; i < BOX_CYCLE_WAITS.length; i++) expect(BOX_CYCLE_WAITS[i]!).toBeGreaterThanOrEqual(BOX_CYCLE_WAITS[i - 1]!);
    expect(cycleStepAt(0)).toBe(0);
    expect(cycleStepAt(BOX_CYCLE_SEC + 0.01)).toBe(38);
    expect(cycleTimes(10)).toHaveLength(38);
    expect(cycleTimes(10).at(-1)!).toBeCloseTo(10 + BOX_CYCLE_SEC, 6);
    expect(cycleModel(1234, 38, 'raygun')).toBe('raygun');
    // The same seed shows the same sequence to everyone.
    expect(Array.from({ length: 38 }, (_, i) => cycleModel(77, i, 'x'))).toEqual(Array.from({ length: 38 }, (_, i) => cycleModel(77, i, 'x')));
  });

  it('always rolls a wonder weapon the taker does not carry (never a teddy bear)', () => {
    for (let i = 0; i < 400; i++) {
      const carried = i % 3 === 0 ? ['raygun', 'thundergun'] : i % 3 === 1 ? ['ak47', 'wunderwaffe'] : ['ak47', 'm1911'];
      const w = rollWonder(carried, Math.random);
      expect(WONDER_WEAPON_IDS).toContain(w);
      expect(carried).not.toContain(w);
    }
    expect(new Set(Array.from({ length: 200 }, () => rollWonder([])))).toEqual(new Set(WONDER_WEAPON_IDS));
  });

  it('descends on the beam, crashes in, and flies away', () => {
    const s = { t0: 10, tl: 10 + MYSTERY_BOX.descendAt + MYSTERY_BOX.descendSec };
    expect(boxHeight(s, 10)).toBe(MYSTERY_BOX.dropHeight);
    expect(boxHeight(s, 10 + MYSTERY_BOX.descendAt + 0.5)).toBeLessThan(MYSTERY_BOX.dropHeight);
    expect(boxHeight(s, s.tl)).toBe(0);
    expect(boxHeight({ ...s, tx: 20 }, 20 + MYSTERY_BOX.closeSec + 1)).toBeGreaterThan(1);
  });
});

describe('Mystery Box in a room', () => {
  it('STREAK raises the box canister, FIRE throws it; where it settles the box comes down on time', () => {
    const room = setup();
    const a = human(room, 0);
    place(a, 0, 26, 0);
    grant(room, a, 'mystery_box');
    onStreakPressed(room, a);
    expect(ksOf(a).marker?.id).toBe('mystery_box');
    a.pitch = 0.35;
    throwMarker(room, a);
    expect(ksOf(a).ready).not.toContain('mystery_box');
    const can = room.entities.byKind(KS_ENTITY.marker)[0]!;
    expect(can.s?.mb).toBe(1);
    // It flies, settles, then the call-in starts.
    drive(room, a, 0, 3);
    const b = boxOf(room)!;
    expect(b).toBeDefined();
    expect(can.s?.k).toBe(1);
    const e = room.entities.get(b.ent.id)!;
    expect(e.kind).toBe(MYSTERY_BOX_ENTITY);
    expect(Math.hypot(e.x - can.x, e.z - can.z)).toBeLessThan(0.01);
    expect(e.s?.ph).toBe(BOX_PHASE.call);
    expect(b.tl - b.t0).toBeCloseTo(MYSTERY_BOX.descendAt + MYSTERY_BOX.descendSec, 6);
    drive(room, a, 0, b.tl - room.time - 0.1);
    expect(b.phase).toBe(BOX_PHASE.call);
    drive(room, a, 0, 0.2);
    expect(b.phase).toBe(BOX_PHASE.idle);
    expect(room.entities.get(b.ent.id)!.s?.ph).toBe(BOX_PHASE.idle);
  });

  it('crashing in crushes an enemy standing under it (never the owner)', () => {
    const room = setup();
    const a = human(room, 0);
    const v = botP(room, 1);
    place(a, -3, 20);
    grant(room, a, 'mystery_box');
    callKillstreak(room, a, 'mystery_box', { target: { x: 4, y: 0, z: 20 } });
    drive(room, a, 0, 0.3);
    const b = boxOf(room)!;
    place(v, b.ent.x + 0.3, b.ent.z);
    const deaths: string[] = [];
    room.bus.on('death', (ev) => deaths.push(`${ev.victim.id}:${ev.weapon}`));
    drive(room, a, 0, b.tl - room.time + 0.05);
    expect(v.alive).toBe(false);
    expect(deaths).toContain(`${v.id}:mystery_box`);
    expect(a.alive).toBe(true);
  });

  it('the owner holds USE to open it (enemies cannot); it cycles, then a fresh USE takes the weapon', () => {
    const room = setup();
    const a = human(room, 0);
    const enemy = human(room, 1);
    place(a, -6, 20);
    place(enemy, 6, 26);
    const b = landedBox(room, a, 0, 20);
    // An enemy at the box holding USE: nothing.
    place(enemy, b.ent.x + 1, b.ent.z);
    for (let i = 0; i < 60; i++) {
      room.queueInputs(enemy, [{ seq: ++seq, dt: TICK_DT, buttons: Buttons.USE, yaw: 0, pitch: 0, weaponSlot: 0 }]);
      drive(room, a, 0, TICK_DT);
    }
    expect(b.phase).toBe(BOX_PHASE.idle);
    place(enemy, 10, 26);
    // Out of reach: holding USE does nothing either.
    drive(room, a, Buttons.USE, 0.6);
    expect(b.phase).toBe(BOX_PHASE.idle);
    drive(room, a, 0, 0.05);
    // In reach: a short hold opens it.
    place(a, b.ent.x - 1.2, b.ent.z);
    expect(room.modifiers.any('useClaimed', a)).toBe(true);
    drive(room, a, Buttons.USE, MYSTERY_BOX.openHoldSec + 0.05);
    expect(b.phase).toBe(BOX_PHASE.open);
    expect(isWonderWeapon(b.weapon)).toBe(true);
    expect(room.entities.get(b.ent.id)!.s?.w).toBe(b.weapon);
    // Holding on through the cycle never takes it (a fresh press is needed).
    drive(room, a, Buttons.USE, BOX_CYCLE_SEC + 0.1);
    expect(b.phase).toBe(BOX_PHASE.offer);
    drive(room, a, Buttons.USE, 0.3);
    expect(b.phase).toBe(BOX_PHASE.offer);
    const held = a.weapons[a.slot]!.def.base.id;
    drive(room, a, 0, 0.05);
    drive(room, a, Buttons.USE, 0.05);
    expect(b.taken).toBe(true);
    expect(a.weapons[a.slot]!.def.base.id).toBe(b.weapon);
    expect(a.weapons[a.slot]!.mag).toBeGreaterThan(0);
    // The old gun dropped at their feet, like a weapon pickup swap.
    expect(dropsOf(room).some((d) => d.data.weapon === held && d.data.from === a.id)).toBe(true);
    expect(b.phase).toBe(BOX_PHASE.leave);
    // It flies away up the beam and is gone; the streak ends.
    drive(room, a, 0, MYSTERY_BOX.closeSec + MYSTERY_BOX.leaveSec + 0.2);
    expect(room.entities.get(b.ent.id)).toBeUndefined();
    expect(ksRoom(room).activeKind('mystery_box')).toHaveLength(0);
    expect(boxesOf(ksRoom(room))).toHaveLength(0);
  });

  it('untaken, the weapon sinks back after the offer and the box leaves', () => {
    const room = setup();
    const a = human(room, 0);
    place(a, -6, 20);
    const b = landedBox(room, a);
    place(a, b.ent.x - 1, b.ent.z);
    drive(room, a, Buttons.USE, MYSTERY_BOX.openHoldSec + 0.05);
    drive(room, a, 0, BOX_CYCLE_SEC + 0.1);
    expect(b.phase).toBe(BOX_PHASE.offer);
    const held = a.weapons[a.slot]!.def.base.id;
    place(a, b.ent.x - 8, b.ent.z); // walked away
    drive(room, a, 0, MYSTERY_BOX.offerSec - 0.3);
    expect(b.phase).toBe(BOX_PHASE.offer);
    drive(room, a, 0, 0.5);
    expect(b.phase).toBe(BOX_PHASE.leave);
    expect(b.taken).toBe(false);
    expect(a.weapons[a.slot]!.def.base.id).toBe(held);
    drive(room, a, 0, MYSTERY_BOX.closeSec + MYSTERY_BOX.leaveSec + 0.2);
    expect(room.entities.get(b.ent.id)).toBeUndefined();
  });

  it('an unopened box leaves after a minute', () => {
    const room = setup();
    const a = human(room, 0);
    place(a, -8, 20);
    const b = landedBox(room, a);
    drive(room, a, 0, MYSTERY_BOX.idleSec + 0.1);
    expect(b.phase).toBe(BOX_PHASE.leave);
    drive(room, a, 0, MYSTERY_BOX.closeSec + MYSTERY_BOX.leaveSec + 0.2);
    expect(room.entities.get(b.ent.id)).toBeUndefined();
  });

  it('bots call it through the API: it lands in front of them, opens, and they take the weapon', () => {
    const room = setup();
    const bot = botP(room, 0);
    place(bot, 0, 20, 0);
    grant(room, bot, 'mystery_box');
    const res = callKillstreak(room, bot, 'mystery_box', suggestTarget(room, bot, 'mystery_box', 1));
    expect(res.ok).toBe(true);
    for (let i = 0; i < Math.round(8 / TICK_DT) && !boxOf(room)?.taken; i++) room.step();
    const b = boxOf(room)!;
    expect(b.taken).toBe(true);
    expect(Math.hypot(b.ent.x - bot.move.x, b.ent.z - bot.move.z)).toBeLessThan(3);
    expect(isWonderWeapon(bot.weapons[bot.slot]!.def.base.id)).toBe(true);
  });

  it('bots also use it automatically when it is earned', () => {
    const room = setup();
    const bot = botP(room, 0);
    ksOf(bot).manual = false;
    bot.ext.killstreaks!.botStreakUse = 1;
    place(bot, 0, 20, 0);
    grant(room, bot, 'mystery_box');
    let took = false;
    room.bus.on('killstreaks.boxTaken', (e) => {
      if (e.player === bot) took = true;
    });
    for (let i = 0; i < Math.round(20 / TICK_DT) && !took; i++) room.step();
    expect(took).toBe(true);
    expect(isWonderWeapon(bot.weapons[bot.slot]!.def.base.id)).toBe(true);
  });
});
