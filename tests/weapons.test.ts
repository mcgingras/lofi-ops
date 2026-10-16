/**
 * Weapons feature: pure rules (TTK tables, pellets, attachment rules, projectile physics) and
 * room-level behaviour (burst cadence, sniper chest split, shotgun one-shots, knife, grenades,
 * tacticals, shell reloads, the underbarrel launcher) through a real Room.
 */
import { afterEach, describe, expect, it } from 'vitest';
import weaponsFeature, { melee, startThrow, flashedAmount, stunnedAmount, explode, spawnTomahawk } from '../src/server/features/weapons/index';
import { stepBody, tacticalAmount, throwVelocity } from '../src/server/features/weapons/projectile';
import { shellReloadSec } from '../src/server/features/weapons/reload';
import { wext } from '../src/server/features/weapons/state';
import { Lobby } from '../src/server/lobby';
import type { PlayerState } from '../src/server/player';
import type { Room, RoomOptions } from '../src/server/room';
import { Store } from '../src/server/store';
import { ATTACHMENTS, ATTACHMENT_BY_ID, canAttach, effectiveWeapon, validAttachments } from '../src/shared/defs/attachments';
import { EQUIPMENT_BY_ID, GL_ROUND, MELEE, NADE_ENTITY, TOMAHAWK_ENTITY } from '../src/shared/defs/equipment';
import { LOADOUT_WEAPONS, shotsToKill, timeForRounds, ttkMs, WEAPONS, WEAPON_BY_ID } from '../src/shared/defs/weapons';
import { buildCollisionWorld } from '../src/shared/maps/types';
import { getMapData } from '../src/shared/defs/maps';
import { PLAYER, TICK_DT } from '../src/shared/constants';
import { Buttons } from '../src/shared/input';
import { createMoveState } from '../src/shared/movement';
import { sanitizeLoadout, type Loadout } from '../src/shared/loadout';

const W = (id: string) => WEAPON_BY_ID.get(id)!;

// ---------------------------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------------------------

describe('weapon defs', () => {
  it('has the headline guns and the BO1 starter set', () => {
    for (const id of ['famas', 'l96a1', 'ak47', 'olympia', 'm16', 'commando', 'galil', 'aug', 'mp5k', 'ak74u', 'mpl', 'spas12', 'stakeout', 'rpk', 'dragunov', 'm1911', 'python', 'asp', 'knife', 'gl']) expect(WEAPON_BY_ID.has(id), id).toBe(true);
    expect(LOADOUT_WEAPONS.some((w) => w.id === 'knife' || w.id === 'gl')).toBe(false);
  });

  it('every listed attachment exists and every loadout weapon has sane numbers', () => {
    for (const w of WEAPONS) {
      for (const a of w.attachments) expect(ATTACHMENT_BY_ID.has(a), `${w.id}/${a}`).toBe(true);
      if (w.slot !== 'primary' && w.slot !== 'secondary') continue;
      expect(w.magazine).toBeGreaterThan(0);
      expect(w.damage.near).toBeGreaterThanOrEqual(w.damage.far);
      expect(w.damage.nearRange).toBeLessThanOrEqual(w.damage.farRange);
      expect(w.spread.ads).toBeLessThanOrEqual(w.spread.hip);
      expect(w.adsMs).toBeGreaterThan(0);
      // Every loadout weapon kills a full-health player within 8 torso hits at any range.
      expect(shotsToKill(w, 1000)).toBeLessThanOrEqual(8);
    }
    for (const a of ATTACHMENTS) expect(a.unlockKills, a.id).toBeTypeOf('number');
  });

  it('knife and launcher are not create-a-class picks', () => {
    const l = sanitizeLoadout({ primary: { weapon: 'gl', attachments: [] }, secondary: { weapon: 'knife', attachments: [] } });
    expect(l.primary.weapon).toBe('ak47');
    expect(l.secondary.weapon).toBe('m1911');
  });
});

describe('time to kill', () => {
  it('assault rifles at range', () => {
    expect(shotsToKill(W('ak47'), 10)).toBe(3);
    expect(shotsToKill(W('ak47'), 60)).toBe(4);
    expect(ttkMs(W('ak47'), 10)).toBe(200);
    expect(shotsToKill(W('famas'), 10)).toBe(4);
    expect(shotsToKill(W('famas'), 60)).toBe(5);
    expect(ttkMs(W('famas'), 10)).toBe(225);
    expect(shotsToKill(W('commando'), 10)).toBe(3);
    expect(ttkMs(W('commando'), 10)).toBe(160);
    expect(shotsToKill(W('galil'), 50)).toBe(4);
    // Headshots shave a round off up close (40 x 1.4 = 56).
    expect(shotsToKill(W('ak47'), 10, 'head')).toBe(2);
  });

  it('M16: one burst kills up close; the next burst waits the burst delay', () => {
    const m16 = W('m16');
    expect(shotsToKill(m16, 10)).toBe(3);
    expect(ttkMs(m16, 10)).toBe(128); // 2 x 64 ms inside a burst
    expect(shotsToKill(m16, 60)).toBe(4);
    expect(ttkMs(m16, 60)).toBe(328); // + 200 ms burst delay
    expect(timeForRounds(m16, 6)).toBeCloseTo(0.064 * 4 + 0.2, 2);
  });

  it('SMGs win up close and fall off', () => {
    expect(shotsToKill(W('mp5k'), 5)).toBe(3);
    expect(shotsToKill(W('mp5k'), 30)).toBe(5);
    expect(shotsToKill(W('ak74u'), 12)).toBe(3);
    expect(ttkMs(W('mpl'), 5)).toBe(128);
    expect(ttkMs(W('mp5k'), 5)).toBeLessThan(ttkMs(W('ak47'), 5));
  });

  it('L96A1: one shot to the head or upper chest at any range, two to the lower chest or legs', () => {
    const l96 = W('l96a1');
    for (const d of [5, 50, 150]) {
      expect(shotsToKill(l96, d, 'head')).toBe(1);
      expect(shotsToKill(l96, d, 'torso')).toBe(1);
      expect(shotsToKill(l96, d, 'torso', 100, true)).toBe(2);
      expect(shotsToKill(l96, d, 'legs')).toBe(2);
    }
    // Quickscope-able: aims faster than the Dragunov.
    expect(l96.adsMs).toBeLessThan(W('dragunov').adsMs);
    expect(l96.mode).toBe('bolt');
    expect(shotsToKill(W('dragunov'), 80, 'head')).toBe(1);
    expect(shotsToKill(W('dragunov'), 80, 'torso')).toBe(2);
  });

  it('shotguns one-shot up close with every pellet, not at range', () => {
    for (const id of ['olympia', 'stakeout', 'spas12']) {
      expect(shotsToKill(W(id), 2), id).toBe(1);
      expect(shotsToKill(W(id), 20), id).toBeGreaterThan(1);
    }
    expect(W('olympia').magazine).toBe(2);
    expect(W('olympia').pellets).toBe(8);
  });

  it('pistols', () => {
    expect(shotsToKill(W('python'), 5)).toBe(2);
    expect(shotsToKill(W('m1911'), 5)).toBe(3);
    expect(shotsToKill(W('asp'), 20)).toBe(5);
  });
});

describe('attachments', () => {
  const ak = W('ak47');

  it('enforces the weapon list, one per slot and the count', () => {
    expect(validAttachments(ak, ['acog', 'reddot'])).toEqual(['acog']); // both optics
    expect(validAttachments(ak, ['varzoom', 'grip'])).toEqual([]); // sniper / LMG parts
    expect(validAttachments(ak, ['suppressor', 'extmag'], 1)).toEqual(['suppressor']);
    expect(validAttachments(ak, ['suppressor', 'extmag'], 2)).toEqual(['suppressor', 'extmag']);
    expect(validAttachments(W('olympia'), ['grip', 'extmag'])).toEqual([]);
    expect(validAttachments(W('l96a1'), ['varzoom'])).toEqual(['varzoom']);
    expect(validAttachments(W('l96a1'), ['reddot'])).toEqual([]);
    expect(validAttachments(W('m1911'), ['dual'])).toEqual(['dual']);
    expect(canAttach(ak, 'suppressor', [])).toBe(true);
    expect(canAttach(ak, 'suppressor', ['extmag'])).toBe(false); // only one without Warlord
    expect(canAttach(ak, 'suppressor', ['extmag'], 2)).toBe(true);
    expect(canAttach(ak, 'reddot', ['acog'], 2)).toBe(false); // optic clash
    expect(canAttach(ak, 'grip')).toBe(false);
  });

  it('folds modifiers into effective stats', () => {
    const sup = effectiveWeapon(ak, ['suppressor']);
    expect(sup.suppressed).toBe(true);
    expect(sup.damage.farRange).toBeCloseTo(ak.damage.farRange * 0.7);
    expect(sup.range).toBeLessThan(200);
    expect(effectiveWeapon(ak, ['extmag']).magazine).toBe(45);
    expect(effectiveWeapon(ak, ['dualmag']).reloadMs).toBeLessThan(ak.reloadMs);
    expect(effectiveWeapon(ak, ['acog']).zoom).toBeGreaterThan(effectiveWeapon(ak, ['reddot']).zoom!);
    const dual = effectiveWeapon(W('m1911'), ['dual']);
    expect(dual.noAds).toBe(true);
    expect(dual.spread.ads).toBe(dual.spread.hip);
    expect(dual.magazine).toBe(16);
    const acogSniper = effectiveWeapon(W('l96a1'), ['acog']);
    expect(acogSniper.scope).toBe(false);
    expect(effectiveWeapon(W('l96a1'), ['varzoom']).zoomLevels).toEqual([4.5, 7, 10]);
    expect(effectiveWeapon(W('mp5k'), ['rapidfire']).rpm).toBeCloseTo(750 * 1.3);
    expect(effectiveWeapon(W('rpk'), ['grip']).recoil.vertical).toBeLessThan(W('rpk').recoil.vertical);
    expect(effectiveWeapon(W('stakeout'), []).shellReload?.perShellMs).toBe(450);
  });
});

describe('projectile physics', () => {
  const world = buildCollisionWorld(getMapData('yard'));
  it('falls, bounces and comes to rest on the ground', () => {
    const ground = world.groundBelow(0, 0, 10, 20) ?? 0;
    const b = { pos: { x: 0, y: ground + 2, z: 0 }, vel: { x: 3, y: 0, z: 0 }, stuck: false, resting: false, traveled: 0 };
    let bounced = false;
    for (let i = 0; i < 300 && !b.resting; i++) if (stepBody(world, b, 1 / 60).hit) bounced = true;
    expect(bounced).toBe(true);
    expect(b.resting).toBe(true);
    expect(b.pos.y).toBeGreaterThan(ground);
    expect(b.pos.y).toBeLessThan(ground + 0.3);
  });

  it('sticky bodies stop on first contact', () => {
    const ground = world.groundBelow(0, 0, 10, 20) ?? 0;
    const b = { pos: { x: 0, y: ground + 1, z: 0 }, vel: { x: 0, y: -5, z: 0 }, stuck: false, resting: false, traveled: 0 };
    for (let i = 0; i < 60 && !b.stuck; i++) stepBody(world, b, 1 / 60, { sticky: true });
    expect(b.stuck).toBe(true);
  });

  it('throws arc upward and tacticals depend on distance and facing', () => {
    const v = throwVelocity({ x: 0, y: 0, z: -1 }, 17, 0.25);
    expect(v.y).toBeGreaterThan(0);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(17);
    const eye = { x: 0, y: 1.6, z: 0 };
    const facing = tacticalAmount(eye, { x: 0, y: 0, z: -1 }, { x: 0, y: 1.6, z: -5 }, 16, true);
    const away = tacticalAmount(eye, { x: 0, y: 0, z: 1 }, { x: 0, y: 1.6, z: -5 }, 16, true);
    const far = tacticalAmount(eye, { x: 0, y: 0, z: -1 }, { x: 0, y: 1.6, z: -14 }, 16, true);
    expect(facing).toBeGreaterThan(away);
    expect(facing).toBeGreaterThan(far);
    expect(tacticalAmount(eye, { x: 0, y: 0, z: -1 }, { x: 0, y: 1.6, z: -20 }, 16, true)).toBe(0);
  });

  it('shell reload timing', () => {
    const sr = W('stakeout').shellReload!;
    expect(shellReloadSec(sr, 3, false)).toBeCloseTo((450 + 3 * 450 + 400) / 1000);
    expect(shellReloadSec(sr, 4, true)).toBeCloseTo((450 + 4 * 450 + 400 + 600) / 1000);
  });
});

// ---------------------------------------------------------------------------------------------
// Room-level behaviour
// ---------------------------------------------------------------------------------------------

let store: Store | undefined;
let lobby: Lobby | undefined;

function setup(opts: Partial<RoomOptions> = {}): Room {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: [weaponsFeature], log: () => {}, autoTick: false });
  return lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, ...opts });
}

afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = undefined;
  store = undefined;
});

const place = (p: PlayerState, x: number, z: number) => {
  p.move = { ...createMoveState(x, 0, z), onGround: true };
};
const steps = (room: Room, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) room.step();
};
const aimAt = (a: PlayerState, b: PlayerState, y: number) => {
  const d = { x: b.move.x - a.move.x, y: b.move.y + y - (a.move.y + PLAYER.eye), z: b.move.z - a.move.z };
  const l = Math.hypot(d.x, d.y, d.z);
  return { x: d.x / l, y: d.y / l, z: d.z / l };
};
const loadout = (primary: string, attachments: string[] = [], extra: Partial<Loadout> = {}): Loadout => ({
  name: 'test',
  primary: { weapon: primary, attachments, camo: 'none' },
  secondary: { weapon: 'm1911', attachments: [], camo: 'none' },
  perks: [],
  killstreaks: [],
  lethal: 'frag',
  tactical: 'flashbang',
  ...extra,
});

/** Shooter A (team 0) at z, target B (team 1) at the origin, in the open; A holds ADS. */
function duel(room: Room, primary: string, dist = 8, attachments: string[] = [], extra: Partial<Loadout> = {}) {
  const a = room.addBot({ name: 'A', team: 0, loadout: loadout(primary, attachments, extra) });
  const b = room.addBot({ name: 'B', team: 1 });
  steps(room, 0.1);
  room.spawn(a);
  place(a, -1, dist);
  place(b, -1, 0);
  let buttons = Buttons.ADS;
  a.brain = { think: () => ({ buttons, yaw: 0, pitch: 0, weaponSlot: a.slot }) };
  b.brain = { think: () => ({ buttons: 0, yaw: 0, pitch: 0, weaponSlot: 0 }) };
  steps(room, 0.6);
  return { a, b, setButtons: (x: number) => (buttons = x) };
}

describe('weapons in a room', () => {
  it('M16 fires three-round bursts with the burst delay enforced by the server', () => {
    const room = setup();
    const { a, b } = duel(room, 'm16', 12);
    b.maxHealth = b.health = 1e6;
    const times: number[] = [];
    room.bus.on('fire', (e) => e.player === a && times.push(room.time));
    const t0 = room.time;
    while (room.time - t0 < 1.2) {
      a.move.ads = 1;
      room.fire(a, { dir: aimAt(a, b, 1.2) });
      a.weapons[0]!.mag = 30;
      room.step();
    }
    expect(times.length).toBeGreaterThanOrEqual(9);
    // Group into bursts by gaps.
    const gaps = times.slice(1).map((t, i) => t - times[i]!);
    const big = gaps.filter((g) => g > 0.15);
    const small = gaps.filter((g) => g <= 0.15);
    expect(small.length).toBe(times.length - 1 - big.length);
    expect(big.length).toBeGreaterThanOrEqual(2);
    for (const g of big) expect(g).toBeGreaterThanOrEqual(0.2 - 0.064 * 0.25 - 1e-6);
    // Exactly three rounds between burst gaps.
    let run = 1;
    for (const g of gaps) {
      if (g > 0.15) {
        expect(run).toBe(3);
        run = 1;
      } else run++;
    }
  });

  it('L96A1: upper chest one-shot, lower chest does not', () => {
    const room = setup();
    const { a, b } = duel(room, 'l96a1', 20);
    a.move.ads = 1;
    room.fire(a, { dir: aimAt(a, b, 1.33) });
    expect(b.alive).toBe(false);
    steps(room, 4);
    room.spawn(b);
    place(b, -1, 0);
    steps(room, 2);
    a.move.ads = 1;
    room.fire(a, { dir: aimAt(a, b, 0.95) });
    expect(b.alive).toBe(true);
    expect(b.health).toBeCloseTo(100 - 77, 0);
  });

  it('Olympia one-shots at close range with pellets and holds two shells', () => {
    const room = setup();
    const { a, b } = duel(room, 'olympia', 2.5);
    const hits: number[] = [];
    room.bus.on('fire', (e) => e.player === a && hits.push(e.hits.reduce((s, h) => s + h.damage, 0)));
    a.move.ads = 1;
    room.fire(a, { dir: aimAt(a, b, 1.2) });
    expect(b.alive).toBe(false);
    expect(a.weapons[0]!.mag).toBe(1);
    expect(hits[0]).toBeGreaterThanOrEqual(99);
  });

  it('knife: lunge kill within range, miss out of range or behind, cooldown', () => {
    const room = setup();
    const { a, b } = duel(room, 'ak47', 2.6);
    expect(melee(room, a)).toBe(b);
    expect(b.alive).toBe(false);
    const deaths: string[] = [];
    room.bus.on('death', (e) => deaths.push(e.weapon));
    // Out of range.
    steps(room, 4);
    room.spawn(b);
    place(b, -1, 0);
    place(a, -1, 6);
    steps(room, 1);
    expect(melee(room, a)).toBe(null);
    // Behind (a faces -z, b is at +z).
    place(a, -1, -1.5);
    steps(room, 1);
    expect(melee(room, a)).toBe(null);
    // In front, but cooldown blocks an instant second swing.
    place(a, -1, 1.2);
    wext(a).meleeReady = 0;
    expect(melee(room, a)).toBe(b);
    expect(deaths).toEqual(['knife']);
    expect(melee(room, a)).toBe(null);
    expect(room.time < wext(a).meleeReady).toBe(true);
  });

  it('knife on the MELEE button through bot input, and it blocks firing during recovery', () => {
    const room = setup();
    const { a, b, setButtons } = duel(room, 'ak47', 1.4);
    setButtons(Buttons.MELEE);
    room.step();
    room.step();
    setButtons(0);
    expect(b.alive).toBe(false);
    expect(room.fire(a, { dir: { x: 0, y: 0, z: -1 } })).toEqual({ ok: false, reason: 'switching' });
    steps(room, MELEE.recoverySec + 0.1);
    expect(room.fire(a, { dir: { x: 0, y: 0, z: -1 } }).ok).toBe(true);
  });

  it('frag: thrown on the button, flies, explodes on its fuse with linear falloff from the feet and no damage through walls', () => {
    const room = setup();
    const { a, b, setButtons } = duel(room, 'ak47', 8);
    const frag = EQUIPMENT_BY_ID.get('frag')!;
    expect(wext(a).lethalN).toBe(1);
    setButtons(Buttons.LETHAL);
    room.step();
    setButtons(0);
    steps(room, 0.5);
    expect(room.entities.byKind(NADE_ENTITY).length).toBe(1);
    expect(wext(a).lethalN).toBe(0);
    steps(room, frag.fuse + 0.2);
    expect(room.entities.byKind(NADE_ENTITY).length).toBe(0);

    // Falloff: explode at known distances from B's feet (BO1 measures players to their origin).
    for (const d of [1, 3, 5]) {
      b.health = b.maxHealth = 1000;
      explode(room, { x: b.move.x + d, y: b.move.y, z: b.move.z }, frag, a.id);
      const expected = frag.max + (frag.min - frag.max) * (d / frag.radius);
      expect(1000 - b.health).toBeCloseTo(expected, 0);
    }
    b.health = 1000;
    explode(room, { x: b.move.x + frag.radius + 1, y: 0.8, z: b.move.z }, frag, a.id);
    expect(b.health).toBe(1000);
  });

  it('cooking a frag past its fuse kills the thrower', () => {
    const room = setup();
    const { a, setButtons } = duel(room, 'ak47', 8);
    setButtons(Buttons.LETHAL);
    steps(room, EQUIPMENT_BY_ID.get('frag')!.fuse + 0.2);
    expect(a.alive).toBe(false);
  });

  it('semtex sticks to a player and goes off with them', () => {
    const room = setup();
    const { a, b } = duel(room, 'ak47', 4, [], { lethal: 'semtex' });
    a.pitch = Math.atan2(1.0 - PLAYER.eye, 4);
    a.yaw = 0;
    a.brain = { think: () => ({ buttons: 0, yaw: 0, pitch: Math.atan2(-0.5, 4), weaponSlot: 0 }) };
    room.step();
    expect(startThrow(room, a, 'lethal')).toBe(true);
    steps(room, 0.6);
    const e = room.entities.byKind(NADE_ENTITY)[0];
    expect(e).toBeDefined();
    expect(e!.s?.k).toBe(1);
    steps(room, 2.2);
    expect(b.alive).toBe(false);
  });

  it('semtex and flashbangs are held up as long as the button is down and thrown on release', () => {
    const room = setup();
    const { a, setButtons } = duel(room, 'ak47', 8, [], { lethal: 'semtex' });
    setButtons(Buttons.LETHAL);
    steps(room, 3); // longer than the semtex fuse: nothing happens while held
    expect(a.alive).toBe(true);
    expect(wext(a).throwing).not.toBeNull();
    expect(room.entities.byKind(NADE_ENTITY).length).toBe(0);
    setButtons(0);
    steps(room, 0.1);
    expect(room.entities.byKind(NADE_ENTITY).length).toBe(1);
  });

  it('tomahawk (a create-a-class lethal too): hold to raise, release to throw, one-hit kill, bounces, retrievable', () => {
    const room = setup();
    const { a, b, setButtons } = duel(room, 'ak47', 7, [], { lethal: 'tomahawk' });
    expect(wext(a)).toMatchObject({ lethal: 'tomahawk', lethalN: 1 });
    let held = true;
    a.brain = { think: () => ({ buttons: held ? Buttons.LETHAL : 0, yaw: 0, pitch: Math.atan2(1.1 - PLAYER.eye, 7), weaponSlot: 0 }) };
    room.step();
    expect(wext(a).throwing?.equip.id).toBe('tomahawk');
    steps(room, 1.5);
    expect(room.entities.byKind(TOMAHAWK_ENTITY).length).toBe(0); // still raised
    expect(room.fire(a, { dir: { x: 0, y: 0, z: -1 } })).toEqual({ ok: false, reason: 'switching' }); // gun down
    held = false;
    room.step();
    room.step();
    expect(room.entities.byKind(TOMAHAWK_ENTITY).length).toBe(1);
    const kills: string[] = [];
    room.bus.on('death', (e) => kills.push(`${e.weapon}/${e.means}`));
    steps(room, 0.6);
    expect(b.alive).toBe(false);
    expect(kills).toEqual(['tomahawk/thrown']);
    expect(b.stats.score).toBeGreaterThanOrEqual(0); // no bankrupt outside Sticks and Stones
    steps(room, 2);
    const hawk = room.entities.byKind(TOMAHAWK_ENTITY)[0]!;
    expect(hawk.s?.k).toBe(1);
    setButtons(0);
    place(a, hawk.x, hawk.z);
    a.move.y = Math.max(0, hawk.y - 0.1);
    steps(room, 0.1);
    expect(room.entities.byKind(TOMAHAWK_ENTITY).length).toBe(0);
    expect(wext(a).lethalN).toBe(1);
  });

  it('a tomahawk bounces off a wall instead of sticking', () => {
    const room = setup();
    const { a } = duel(room, 'ak47', 8);
    expect(room.phase).toBe('playing');
    // The first wall along -z from the spawn-free middle; throw at it from 3 m away.
    const o = { x: 0, y: 1.5, z: 0 };
    const hit = room.world.raycast(o, { x: 0, y: 0, z: -1 }, 80, 'bullets');
    expect(hit).not.toBeNull();
    const start = { x: 0, y: 1.5, z: -(hit!.t - 3) };
    const t = spawnTomahawk(room, a, start, { x: 0, y: 0, z: -20 });
    let bounced = false;
    for (let i = 0; i < 400 && !t.s?.k; i++) {
      const z0 = t.z;
      room.step();
      if (t.z > z0 + 1e-4) bounced = true;
    }
    expect(bounced).toBe(true);
    expect(t.s?.k).toBe(1);
  });

  it('flashbang blinds an enemy facing it; teammates are spared; concussion slows', () => {
    const room = setup();
    const { a, b } = duel(room, 'ak47', 8);
    const mate = room.addBot({ name: 'C', team: 0 });
    steps(room, 0.1);
    place(mate, 3, 4);
    // B faces +z (towards the blast at z=4): yaw PI.
    b.brain = { think: () => ({ buttons: 0, yaw: Math.PI, pitch: 0, weaponSlot: 0 }) };
    mate.brain = { think: () => ({ buttons: 0, yaw: 0, pitch: 0, weaponSlot: 0 }) };
    steps(room, 0.1);
    explode(room, { x: -1, y: 1.5, z: 3 }, EQUIPMENT_BY_ID.get('flashbang')!, a.id);
    expect(flashedAmount(room, b)).toBeGreaterThan(0.5);
    expect(flashedAmount(room, mate)).toBe(0);
    explode(room, { x: -1, y: 1.5, z: 3 }, EQUIPMENT_BY_ID.get('concussion')!, a.id);
    expect(stunnedAmount(room, b)).toBeGreaterThan(0.3);
    expect(room.modifiers.mul('speedMultiplier', b)).toBeLessThan(1);
    steps(room, 5);
    expect(flashedAmount(room, b)).toBe(0);
    expect(room.modifiers.mul('speedMultiplier', b)).toBe(1);
  });

  it('Stakeout reloads shell by shell and the trigger cancels the reload', () => {
    const room = setup();
    const { a, setButtons } = duel(room, 'stakeout', 8);
    const w = a.weapons[0]!;
    w.mag = 1;
    setButtons(Buttons.RELOAD | Buttons.ADS);
    room.step();
    setButtons(Buttons.ADS);
    expect(a.reloadEnd).toBeGreaterThan(room.time);
    steps(room, (450 + 450) / 1000 + 0.02);
    expect(w.mag).toBe(2);
    steps(room, 0.45);
    expect(w.mag).toBe(3);
    setButtons(Buttons.ADS | Buttons.FIRE);
    room.step();
    expect(a.reloadEnd).toBe(0);
    expect(w.mag).toBe(3);
    steps(room, 1);
    expect(room.fire(a, { dir: { x: 0, y: 0, z: -1 } }).ok).toBe(true);
  });

  it('one attachment per weapon unless a perk adds a slot', () => {
    const room = setup();
    const a = room.addBot({ name: 'A', team: 0, loadout: loadout('ak47', ['suppressor', 'extmag']) });
    steps(room, 0.1);
    room.spawn(a);
    expect(a.weapons[0]!.def.attachmentIds).toEqual(['suppressor']);
    room.modifiers.add('attachmentSlotsOffset', () => 1, 'test.warlord');
    room.spawn(a);
    expect(a.weapons[0]!.def.attachmentIds).toEqual(['suppressor', 'extmag']);
  });

  it('underbarrel grenade launcher: extra slot, arms in flight, explodes on impact', () => {
    const room = setup();
    const { a, b } = duel(room, 'ak47', 20, ['gl']);
    expect(a.weapons.length).toBe(3);
    expect(a.weapons[2]!.def.id).toBe('gl');
    a.brain = { think: () => ({ buttons: 0, yaw: 0, pitch: 0, weaponSlot: 2 }) };
    steps(room, 0.8);
    expect(a.slot).toBe(2);
    b.health = b.maxHealth = 1000;
    expect(room.fire(a, { dir: aimAt(a, b, 1.0) }).ok).toBe(true);
    expect(room.entities.byKind(NADE_ENTITY).length).toBe(1);
    steps(room, 1);
    expect(room.entities.byKind(NADE_ENTITY).length).toBe(0);
    expect(1000 - b.health).toBeGreaterThan(GL_ROUND.min);
  });

  it('a player who joins sees equipment counts from the loadout', () => {
    const room = setup();
    const a = room.addBot({ name: 'A', team: 0, loadout: loadout('ak47', [], { lethal: 'semtex', tactical: 'concussion' }) });
    steps(room, 0.1);
    room.spawn(a);
    expect(wext(a)).toMatchObject({ lethal: 'semtex', lethalN: 1, tactical: 'concussion', tacticalN: 2 });
    const bogus = room.addBot({ name: 'B', team: 1, loadout: loadout('ak47', [], { lethal: 'flashbang', tactical: 'nope' }) });
    steps(room, 0.1);
    room.spawn(bogus);
    expect(wext(bogus)).toMatchObject({ lethal: null, lethalN: 0, tactical: null, tacticalN: 0 });
  });
});
