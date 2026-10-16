/**
 * Tracker and Pack Rat perks, rules level, plus the "every modifier key we register is read"
 * check for the keys these perks and the Glitch killstreak add.
 *
 * Tracker: footprints only for the Tracker player, only enemies within the radius (Pro: also near
 * teammates), a print per `stepM` moved, sent every `sampleSec`, at most `maxPerMsg`, quantised;
 * Ninja Pro leaves none (base Ninja does); the Pro challenge counts kills of tracked enemies.
 * Pack Rat: a tap of USE swaps, the gun comes up fast and wears your camo, every switch is
 * quicker; Pro: full magazine and reserve; the Pro challenge counts kills with picked-up guns.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import killstreaks from '../src/server/features/killstreaks/index';
import { registerModeRules } from '../src/server/features/modes/index';
import modesFeature from '../src/server/features/modes/index';
import { perksOf } from '../src/server/features/perks/common';
import perks from '../src/server/features/perks/index';
import { sampleTracks } from '../src/server/features/perks/tracker';
import pickups, { dropsOf, spawnDrop, type DropEntity } from '../src/server/features/pickups/index';
import weapons from '../src/server/features/weapons/index';
import { Lobby } from '../src/server/lobby';
import { makeWeapon, type PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { Store } from '../src/server/store';
import { TICK_DT, type Team } from '../src/shared/constants';
import { DEFAULT_LOBBY_BOTS, skillFor } from '../src/shared/defs/bots';
import { PACK_RAT } from '../src/shared/defs/pack-rat';
import { PERK_BY_ID } from '../src/shared/defs/perks';
import { PICKUP } from '../src/shared/defs/pickups';
import { packTracks, printAlpha, TRACKER, unpackTracks } from '../src/shared/defs/tracker';
import { Buttons } from '../src/shared/input';
import { cloneLoadout, DEFAULT_LOADOUTS, type Loadout } from '../src/shared/loadout';
import { createMoveState } from '../src/shared/movement';
import { newProfile } from '../src/shared/profile';

let store: Store | undefined;
let lobby: Lobby | undefined;
beforeAll(() => registerModeRules());
afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = undefined;
  store = undefined;
});

function setup(mode = 'tdm'): Room {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: [weapons, perks, killstreaks, modesFeature, pickups], log: () => {}, autoTick: false });
  return lobby.createRoom({ mode, map: 'yard', closeWhenEmpty: false });
}

const loadout = (perksList: string[] = [], camo = 'none', secondaryCamo = 'none'): Loadout => {
  const l = cloneLoadout(DEFAULT_LOADOUTS[0]!);
  return { ...l, primary: { ...l.primary, camo }, secondary: { ...l.secondary, camo: secondaryCamo }, perks: perksList };
};

/** A bot that stands still (we drive it) and never picks guns up by itself. */
function actor(room: Room, team: Team | null, l: Loadout = loadout()): PlayerState {
  const p = room.addBot({ team, loadout: l });
  p.ext.bots = { rolls: { form: 0, knobs: {} as never }, skill: { ...skillFor(DEFAULT_LOBBY_BOTS), weaponPickup: 0 } };
  p.brain = { think: (_r, self) => ({ buttons: 0, yaw: self.yaw, pitch: self.pitch, weaponSlot: self.slot }) };
  if (!p.alive) room.spawn(p);
  return p;
}
function human(room: Room, team: Team | null, l: Loadout = loadout()): PlayerState {
  const p = actor(room, team, l);
  p.isBot = false;
  p.brain = null;
  return p;
}
const place = (p: PlayerState, x: number, z: number, y = 0) => {
  p.move = { ...createMoveState(x, y, z), onGround: true };
};
const steps = (room: Room, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) room.step();
};
let seq = 0;
function drive(room: Room, h: PlayerState, buttons: number, seconds: number, yaw = h.yaw, pitch = h.pitch) {
  for (let i = 0; i < Math.max(1, Math.round(seconds / TICK_DT)); i++) {
    room.queueInputs(h, [{ seq: ++seq, dt: TICK_DT, buttons, yaw, pitch, weaponSlot: h.slot }]);
    room.step();
  }
}
const yawTo = (p: PlayerState, x: number, z: number) => Math.atan2(-(x - p.move.x), -(z - p.move.z));
function floorGun(room: Room, x: number, z: number, weapon = 'famas', mag = 20, reserve = 60, camo = 'none'): DropEntity {
  const w = makeWeapon({ weapon, attachments: [], camo }, weapon);
  w.mag = mag;
  w.reserve = reserve;
  const e = spawnDrop(room, w, { x, y: 0, z }, { x: 0, y: 0, z: 0 }, null, null, 'death')!;
  steps(room, 0.5);
  return e;
}
const fakeSession = () => ({ id: 'fake', send() {}, sendFeature() {} });
/** Capture `perks.tracks` pushes (the tracker needs a session to be sent anything). */
function tracksTo(room: Room, p: PlayerState) {
  const got: { to: string; f: number[]; t: number }[] = [];
  p.session = fakeSession() as never;
  const orig = room.sendFeature.bind(room);
  room.sendFeature = ((to: PlayerState | null, id: string, data: unknown) => {
    if (id === 'perks.tracks') {
      got.push({ to: to?.id ?? '*', f: (data as { f: number[] }).f, t: room.time });
      return;
    }
    return orig(to as PlayerState, id as never, data as never);
  }) as typeof room.sendFeature;
  return got;
}
const asHuman = (p: PlayerState) => {
  p.profile = newProfile(`prof-${p.id}`, p.name);
  p.isBot = false;
  return p;
};

describe('perk defs', () => {
  it('Tracker is tier 3, Pack Rat tier 2, each with a Pro challenge', () => {
    expect(PERK_BY_ID.get('tracker')).toMatchObject({ tier: 3, unlockLevel: 24, price: 2000, pro: { challenge: 'tracker_pro' } });
    expect(PERK_BY_ID.get('pack_rat')).toMatchObject({ tier: 2, unlockLevel: 10, price: 2000, pro: { challenge: 'pack_rat_pro' } });
  });
});

describe('Tracker', () => {
  it('quantises prints to 0.1 m and 256 yaw steps, and fades them over 3.5 s', () => {
    const p = { x: 12.345, y: 0.04, z: -7.77, yaw: -2.5 };
    const msg = packTracks([p]);
    expect(msg.f.every((n) => Number.isInteger(n))).toBe(true);
    const [q] = unpackTracks(msg);
    expect(Math.abs(q!.x - p.x)).toBeLessThanOrEqual(TRACKER.quantM / 2 + 1e-9);
    expect(Math.abs(q!.z - p.z)).toBeLessThanOrEqual(TRACKER.quantM / 2 + 1e-9);
    const dyaw = Math.abs(((q!.yaw - p.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    expect(dyaw).toBeLessThan((Math.PI * 2) / 256);
    expect(unpackTracks({ f: [1, 2, 3] })).toEqual([]);
    expect(printAlpha(0.5)).toBe(1);
    expect(printAlpha(TRACKER.fadeSec - 0.01)).toBeGreaterThan(0);
    expect(printAlpha(TRACKER.fadeSec)).toBe(0);
  });

  it('streams prints of enemies within 25 m to the Tracker player only, every 0.4 s, only as they move', () => {
    const room = setup();
    const t = actor(room, 0, loadout(['tracker']));
    const mate = actor(room, 0);
    const near = actor(room, 1);
    const far = actor(room, 1);
    place(t, 0, 0);
    place(mate, 1, 0);
    place(near, 0, -15);
    place(far, 0, -40);
    const got = tracksTo(room, t);
    mate.session = fakeSession() as never; // a teammate without Tracker gets nothing
    let x = 0;
    for (let i = 0; i < 4 / TICK_DT; i++) {
      x += 0.05;
      near.move.x = x;
      far.move.x = x;
      room.step();
    }
    expect(got.length).toBeGreaterThanOrEqual(9);
    expect(got.length).toBeLessThanOrEqual(11);
    expect(got.every((g) => g.to === t.id)).toBe(true);
    // Cadence: 0.4 s apart.
    for (let i = 1; i < got.length; i++) expect(got[i]!.t - got[i - 1]!.t).toBeCloseTo(TRACKER.sampleSec, 1);
    // Only the near enemy, where it was.
    for (const g of got) {
      const prints = unpackTracks({ f: g.f });
      expect(prints).toHaveLength(1);
      expect(prints[0]!.z).toBeCloseTo(-15, 1);
    }
    // Standing still: no new prints (after the one for the last stretch walked).
    steps(room, 0.5);
    const n = got.length;
    steps(room, 2);
    expect(got.length).toBe(n);
  });

  it('caps a sample at maxPerMsg, nearest first; needs no line of sight', () => {
    const room = setup();
    const t = actor(room, 0, loadout(['tracker']));
    place(t, 0, 0);
    const enemies = Array.from({ length: 30 }, (_, i) => {
      const e = actor(room, 1);
      place(e, -12 + (i % 6) * 4, -6 - Math.floor(i / 6) * 3);
      return e;
    });
    const prints = sampleTracks(room, t);
    expect(prints).toHaveLength(TRACKER.maxPerMsg);
    const d = (p: { x: number; z: number }) => Math.hypot(p.x, p.z);
    for (let i = 1; i < prints.length; i++) expect(d(prints[i]!)).toBeGreaterThanOrEqual(d(prints[i - 1]!) - 1e-9);
    expect(enemies.length).toBe(30);
  });

  it('lays a trail every strideM back along the way an enemy walked (at most maxPerEnemy)', () => {
    const room = setup();
    const t = actor(room, 0, loadout(['tracker']));
    const e = actor(room, 1);
    place(t, 0, 0);
    place(e, 0, -10);
    expect(sampleTracks(room, t)).toHaveLength(1);
    e.move.x = 2.2;
    const trail = sampleTracks(room, t);
    expect(trail).toHaveLength(Math.floor(2.2 / TRACKER.strideM));
    for (let i = 1; i < trail.length; i++) expect(trail[i]!.x - trail[i - 1]!.x).toBeCloseTo(TRACKER.strideM, 5);
    expect(trail.at(-1)!.x).toBeCloseTo(2.2);
    for (const p of trail) expect(p.yaw).toBeCloseTo(-Math.PI / 2); // walking +x
    e.move.x = 12;
    expect(sampleTracks(room, t)).toHaveLength(TRACKER.maxPerEnemy);
  });

  it('Ninja Pro leaves no footprints (base Ninja does)', () => {
    const room = setup();
    const t = actor(room, 0, loadout(['tracker']));
    const ninja = actor(room, 1, loadout(['ninja']));
    place(t, 0, 0);
    place(ninja, 0, -10);
    expect(sampleTracks(room, t)).toHaveLength(1);
    ninja.move.x += 1;
    perksOf(ninja).allPro = true;
    expect(sampleTracks(room, t)).toHaveLength(0);
  });

  it('Pro: also the footprints of enemies near your teammates', () => {
    const room = setup();
    const t = actor(room, 0, loadout(['tracker']));
    const mate = actor(room, 0);
    const e = actor(room, 1);
    place(t, 0, 20);
    place(mate, 0, -20);
    place(e, 5, -25);
    expect(sampleTracks(room, t)).toHaveLength(0);
    perksOf(t).allPro = true;
    expect(sampleTracks(room, t)).toHaveLength(1);
  });

  it('Pro challenge: killing an enemy you were tracking', () => {
    const room = setup();
    const t = asHuman(actor(room, 0, loadout(['tracker'])));
    const e = actor(room, 1);
    const other = actor(room, 1);
    place(t, 0, 0);
    place(e, 0, -10);
    place(other, 0, -60);
    tracksTo(room, t);
    steps(room, 0.5);
    room.kill(e, t, { weapon: 'ak47', means: 'bullet', part: 'torso' });
    room.kill(other, t, { weapon: 'ak47', means: 'bullet', part: 'torso' });
    expect(t.profile!.challengeProgress.tracker_pro).toBe(1);
  });
});

describe('Pack Rat', () => {
  it('a tap swaps; the gun comes up in 30% of its raise; it wears your slot camo; switches are quicker', () => {
    const room = setup();
    const h = human(room, 0, loadout(['pack_rat'], 'tiger'));
    place(h, -1, 5);
    const gun = floorGun(room, -1, 4, 'famas', 20, 60, 'woodland');
    drive(room, h, Buttons.USE, TICK_DT, yawTo(h, -1, 4), -0.9);
    const w = h.weapons[0]!;
    expect(w.def.base.id).toBe('famas');
    expect(room.entities.get(gun.id)).toBeUndefined();
    expect(w.camo).toBe('tiger');
    expect(h.swapEnd - room.time).toBeLessThanOrEqual(((w.def.swapMs ?? 500) / 1000) * PACK_RAT.pickupRaise + 1e-6);
    expect(h.swapEnd).toBeGreaterThan(room.time - TICK_DT);
    expect([w.mag, w.reserve]).toEqual([20, 60]); // not Pro: the gun's own ammo
    expect(room.modifiers.mul('swapMultiplier', h)).toBeCloseTo(PACK_RAT.swapMul);
    expect(room.modifiers.mul('pickupHoldMultiplier', h)).toBe(0);
  });

  it('without Pack Rat a tap does nothing and the gun keeps its own camo', () => {
    const room = setup();
    const h = human(room, 0, loadout([], 'tiger'));
    place(h, -1, 5);
    floorGun(room, -1, 4, 'famas', 20, 60, 'woodland');
    drive(room, h, Buttons.USE, TICK_DT, yawTo(h, -1, 4), -0.9);
    expect(h.weapons[0]!.def.base.id).toBe('ak47');
    drive(room, h, Buttons.USE, PICKUP.holdSec + 0.05, yawTo(h, -1, 4), -0.9);
    expect(h.weapons[0]!.def.base.id).toBe('famas');
    expect(h.weapons[0]!.camo).toBe('woodland');
  });

  it('a slot with no camo keeps the picked-up gun’s own', () => {
    const room = setup();
    const h = human(room, 0, loadout(['pack_rat']));
    place(h, -1, 5);
    floorGun(room, -1, 4, 'famas', 20, 60, 'woodland');
    drive(room, h, Buttons.USE, TICK_DT, yawTo(h, -1, 4), -0.9);
    expect(h.weapons[0]!.camo).toBe('woodland');
  });

  it('Pro: the picked-up gun comes with a full magazine and full reserve', () => {
    const room = setup();
    const h = human(room, 0, loadout(['pack_rat'], 'tiger'));
    perksOf(h).allPro = true;
    place(h, -1, 5);
    floorGun(room, -1, 4, 'famas', 3, 5);
    drive(room, h, Buttons.USE, TICK_DT, yawTo(h, -1, 4), -0.9);
    const w = h.weapons[0]!;
    expect(w.def.base.id).toBe('famas');
    expect(w.mag).toBe(w.def.magazine);
    expect(w.reserve).toBe(w.def.reserve);
  });

  it('Pro challenge: kills with a picked-up gun', () => {
    const room = setup();
    const h = asHuman(human(room, 0, loadout(['pack_rat'])));
    const e = actor(room, 1);
    place(h, -1, 5);
    floorGun(room, -1, 4, 'famas');
    room.kill(e, h, { weapon: 'ak47', means: 'bullet', part: 'torso' });
    expect(h.profile!.challengeProgress.pack_rat_pro ?? 0).toBe(0);
    drive(room, h, Buttons.USE, TICK_DT, yawTo(h, -1, 4), -0.9);
    room.spawn(e);
    room.kill(e, h, { weapon: 'famas', means: 'bullet', part: 'torso' });
    expect(h.profile!.challengeProgress.pack_rat_pro).toBe(1);
    expect(dropsOf(room).length).toBeGreaterThan(0);
  });
});

describe('modifier keys these features register are read', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
    });
  const src = files('src/server').map((f) => readFileSync(f, 'utf8'));
  const all = src.join('\n');
  const mine = ['src/server/features/killstreaks/streaks/glitch.ts', 'src/server/features/perks/tracker.ts', 'src/server/features/perks/packrat.ts'].map((f) => readFileSync(f, 'utf8')).join('\n');
  const keys = [...new Set([...mine.matchAll(/modifiers\.add\('([A-Za-z]+)'/g)].map((m) => m[1]!))];
  it('registers the keys we expect', () => {
    expect(keys.sort()).toEqual(['botFrozen', 'botSkillMultiplier', 'botSkillOffset', 'pickupHoldMultiplier', 'radarJammed', 'radarVisible', 'swapMultiplier', 'trackerVisible']);
  });
  for (const k of keys) {
    it(`${k} is read with mul / sum / any`, () => {
      expect(new RegExp(`modifiers\\.(mul|sum|any)\\(\\s*'${k}'`).test(all), k).toBe(true);
    });
  }
});
