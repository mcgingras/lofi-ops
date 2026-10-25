/**
 * The MW2 additions (Intervention, ACR, M16A4): their numbers against the MW2 data they come from,
 * how they differ from their BO1 cousins (L96A1, M16), burst cadence and the one-shot upper-body
 * kill through a real Room, and their unlock / store / challenge / wager / sound entries.
 */
import { afterEach, describe, expect, it } from 'vitest';
import weaponsFeature from '../src/server/features/weapons/index';
import { gunGameLadder } from '../src/server/features/economy/modes/gungame';
import { chooseBotLoadout } from '../src/server/features/bots/loadout';
import { Lobby } from '../src/server/lobby';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { Store } from '../src/server/store';
import { effectiveWeapon, validAttachments } from '../src/shared/defs/attachments';
import { challengeById } from '../src/shared/defs/challenges';
import { SHARPSHOOTER } from '../src/shared/defs/economy';
import { SFX_BINDINGS, WEAPON_SHOTS } from '../src/shared/defs/sfx-recipes';
import { keyOf, storeItem } from '../src/shared/defs/store';
import { attachmentUnlocks, isUnlocked, unlockTable } from '../src/shared/defs/unlocks';
import { cycleSec, LOADOUT_WEAPONS, shotsToKill, timeForRounds, ttkMs, WEAPON_BY_ID } from '../src/shared/defs/weapons';
import { PLAYER, TICK_DT } from '../src/shared/constants';
import { Buttons } from '../src/shared/input';
import { createMoveState } from '../src/shared/movement';
import type { Loadout } from '../src/shared/loadout';
import { newProfile } from '../src/shared/profile';

const W = (id: string) => WEAPON_BY_ID.get(id)!;
const MW2 = ['intervention', 'acr', 'm16a4'];

describe('MW2 weapon defs', () => {
  it('ships the three guns as create-a-class primaries with their own models', () => {
    for (const id of MW2) {
      const w = W(id);
      expect(w, id).toBeDefined();
      expect(w.slot).toBe('primary');
      expect(w.model).toBe(id);
      expect(LOADOUT_WEAPONS).toContain(w);
    }
    expect(W('intervention').class).toBe('sniper');
    expect(W('acr').class).toBe('ar');
    expect(W('m16a4').class).toBe('ar');
    // The SPAS-12 already existed: no MW2 duplicate.
    expect(LOADOUT_WEAPONS.filter((w) => /spas/i.test(w.id))).toHaveLength(1);
  });

  it('M16A4 is its own gun, not the BO1 M16', () => {
    const a4 = W('m16a4');
    const m16 = W('m16');
    expect(a4.name).toBe('M16A4');
    expect(a4.model).not.toBe(m16.model);
    expect(a4.mode).toBe('burst');
    expect(a4.burst).toBe(3);
    // MW2: 64 ms between rounds, 200 ms cooldown after the burst -> 459 rpm overall (BO1 M16: 549).
    expect(180 / cycleSec(a4)).toBeCloseTo(459, -1);
    expect(180 / cycleSec(m16)).toBeGreaterThan(540);
    expect(a4.damage.nearRange).toBeGreaterThan(m16.damage.nearRange);
    expect(a4.damage.farRange).toBeLessThan(m16.damage.farRange);
    expect(a4.reloadEmptyMs).toBeLessThan(m16.reloadEmptyMs);
    expect(a4.attachments).not.toContain('dualmag');
  });

  it('Intervention keeps the L96A1 kill profile but plays differently', () => {
    const iv = W('intervention');
    const l96 = W('l96a1');
    expect(iv.multipliers).toEqual(l96.multipliers);
    expect(iv.mode).toBe('bolt');
    expect(iv.scope).toBe(true);
    expect(cycleSec(iv)).toBeLessThan(cycleSec(l96)); // quicker bolt (65 vs 41 rpm)
    expect(iv.reloadMs).toBeLessThan(l96.reloadMs);
    expect(iv.adsMs).toBeGreaterThan(l96.adsMs); // MW2's 400 ms scope-in
    expect(iv.sprintOutMs).toBeLessThan(l96.sprintOutMs);
    // Out of a sprint both are on target at the same moment (ADS runs during sprint-out).
    expect(Math.max(iv.adsMs, iv.sprintOutMs)).toBe(Math.max(l96.adsMs, l96.sprintOutMs));
    expect(iv.recoil.vertical).toBeGreaterThan(l96.recoil.vertical);
    expect(iv.sway!).toBeGreaterThan(l96.sway!);
    expect(iv.reserve).toBeLessThan(l96.reserve);
  });

  it('attachments map onto the BO1 set', () => {
    expect(W('intervention').attachments.sort()).toEqual(['acog', 'extmag', 'suppressor', 'varzoom']);
    for (const id of ['acr', 'm16a4']) expect(W(id).attachments.sort(), id).toEqual(['acog', 'extmag', 'gl', 'reddot', 'reflex', 'suppressor']);
    expect(validAttachments(W('acr'), ['grip'])).toEqual([]);
    expect(effectiveWeapon(W('intervention'), ['varzoom']).zoomLevels).toEqual([4.5, 7, 10]);
    expect(effectiveWeapon(W('intervention'), ['acog']).scope).toBe(false);
    expect(effectiveWeapon(W('acr'), ['extmag']).magazine).toBe(45);
  });
});

describe('MW2 time to kill', () => {
  it('Intervention: one shot to the head or upper chest at any range, two to the stomach or legs', () => {
    const iv = W('intervention');
    for (const d of [3, 40, 120, 250]) {
      expect(shotsToKill(iv, d, 'head'), `${d}`).toBe(1);
      expect(shotsToKill(iv, d, 'torso'), `${d}`).toBe(1);
      expect(shotsToKill(iv, d, 'torso', 100, true), `${d}`).toBe(2);
      expect(shotsToKill(iv, d, 'legs'), `${d}`).toBe(2);
    }
  });

  it('M16A4: one burst kills out to 38 m; past 51 m it takes a second burst after the cooldown', () => {
    const a4 = W('m16a4');
    expect(shotsToKill(a4, 10)).toBe(3);
    expect(shotsToKill(a4, 38)).toBe(3);
    expect(ttkMs(a4, 38)).toBe(128);
    expect(shotsToKill(a4, 60)).toBe(4);
    expect(ttkMs(a4, 60)).toBe(392); // 2 x 64 + 264
    expect(timeForRounds(a4, 6)).toBeCloseTo(0.064 * 4 + 0.264, 2);
    expect(shotsToKill(a4, 10, 'head')).toBe(2);
  });

  it('ACR: four shots up close, holds that to 46 m, five at long range; slower than the AK up close', () => {
    const acr = W('acr');
    expect(shotsToKill(acr, 10)).toBe(4);
    expect(shotsToKill(acr, 45)).toBe(4);
    expect(shotsToKill(acr, 70)).toBe(5);
    expect(ttkMs(acr, 10)).toBe(228);
    expect(ttkMs(acr, 10)).toBeGreaterThan(ttkMs(W('ak47'), 10));
    expect(ttkMs(acr, 50)).toBeLessThan(ttkMs(W('ak47'), 50));
    // Lowest kick of the assault rifles.
    for (const w of LOADOUT_WEAPONS.filter((x) => x.class === 'ar' && x.id !== 'acr')) expect(acr.recoil.vertical, w.id).toBeLessThan(w.recoil.vertical);
  });
});

describe('MW2 unlocks, store, challenges, wagers, sounds, bots', () => {
  it('unlock at their MW2 levels and are bought with CoD Points', () => {
    const levels = Object.fromEntries(unlockTable().filter((u) => u.kind === 'weapon').map((u) => [u.id, u.level]));
    expect(levels).toMatchObject({ intervention: 4, m16a4: 40, acr: 48 });
    for (const id of MW2) {
      const item = storeItem(keyOf.weapon(id))!;
      expect(item, id).toBeDefined();
      expect(item.price).toBe(W(id).price);
      expect(item.price).toBeGreaterThan(0);
      for (const a of W(id).attachments) expect(storeItem(keyOf.attachment(id, a)), `${id}/${a}`).toBeDefined();
      expect(attachmentUnlocks(id).map((a) => a.id).sort()).toEqual([...W(id).attachments].sort());
    }
    const p = newProfile('t', 'T');
    p.level = 39;
    expect(isUnlocked(p, 'weapon', 'm16a4')).toBe(false);
    expect(isUnlocked(p, 'weapon', 'intervention')).toBe(true);
    p.level = 48;
    expect(isUnlocked(p, 'weapon', 'acr')).toBe(true);
  });

  it('have weapon challenges like every other gun', () => {
    for (const id of MW2) {
      expect(challengeById(`w_${id}_kills`)?.weapon, id).toBe(id);
      expect(challengeById(`w_${id}_headshots`), id).toBeTruthy();
      for (const a of W(id).attachments) expect(challengeById(`w_${id}_${a}`)?.attachment, `${id}/${a}`).toBe(a);
    }
  });

  it('join the Gun Game ladder next to their BO1 cousins and the Sharpshooter rotation', () => {
    const ladder = gunGameLadder();
    expect(ladder.indexOf('m16a4')).toBe(ladder.indexOf('m16') + 1);
    expect(ladder.indexOf('intervention')).toBe(ladder.indexOf('l96a1') - 1);
    expect(ladder).toContain('acr');
    // BO1's 20 shipped rungs, plus intent rungs other weapon classes ship later (the Skorpion).
    expect(ladder.length).toBeGreaterThanOrEqual(20);
    for (const id of MW2) expect(SHARPSHOOTER.classes).toContain(W(id).class);
  });

  it('have recorded voices from the class pools within +-6% pitch, plus suppressed ones', () => {
    expect(WEAPON_SHOTS.intervention!.files.every((f) => f.startsWith('gun_sniper_'))).toBe(true);
    for (const id of ['acr', 'm16a4']) expect(WEAPON_SHOTS[id]!.files.every((f) => f.startsWith('gun_ar_')), id).toBe(true);
    for (const id of MW2) {
      expect(Math.abs(WEAPON_SHOTS[id]!.rate - 1), id).toBeLessThanOrEqual(0.06);
      expect(SFX_BINDINGS[`shot.${id}`], id).toBeDefined();
      expect(SFX_BINDINGS[`shot.${id}.sup`]!.files.every((f) => f.startsWith('sup_')), id).toBe(true);
    }
  });

  it('bots pick them', () => {
    const seen = new Set<string>();
    let s = 1;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 3000; i++) seen.add(chooseBotLoadout(0.8, rnd).primary.weapon);
    for (const id of MW2) expect(seen.has(id), id).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Through a Room
// ---------------------------------------------------------------------------------------------

let store: Store | undefined;
let lobby: Lobby | undefined;

function setup(): Room {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: [weaponsFeature], log: () => {}, autoTick: false });
  return lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false });
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
const loadout = (primary: string): Loadout => ({
  name: 'test',
  primary: { weapon: primary, attachments: [], camo: 'none' },
  secondary: { weapon: 'm1911', attachments: [], camo: 'none' },
  perks: [],
  killstreaks: [],
  lethal: 'frag',
  tactical: 'flashbang',
});

function duel(room: Room, primary: string, dist: number) {
  const a = room.addBot({ name: 'A', team: 0, loadout: loadout(primary) });
  const b = room.addBot({ name: 'B', team: 1 });
  steps(room, 0.1);
  room.spawn(a);
  place(a, -1, dist);
  place(b, -1, 0);
  a.brain = { think: () => ({ buttons: Buttons.ADS, yaw: 0, pitch: 0, weaponSlot: a.slot }) };
  b.brain = { think: () => ({ buttons: 0, yaw: 0, pitch: 0, weaponSlot: 0 }) };
  steps(room, 0.6);
  return { a, b };
}

describe('MW2 weapons in a room', () => {
  it('M16A4 fires three-round bursts with its longer cooldown enforced by the server', () => {
    const room = setup();
    const { a, b } = duel(room, 'm16a4', 12);
    expect(a.weapons[0]!.def.base.id).toBe('m16a4');
    b.maxHealth = b.health = 1e6;
    const times: number[] = [];
    room.bus.on('fire', (e) => e.player === a && times.push(room.time));
    const t0 = room.time;
    while (room.time - t0 < 1.5) {
      a.move.ads = 1;
      room.fire(a, { dir: aimAt(a, b, 1.2) });
      a.weapons[0]!.mag = 30;
      room.step();
    }
    const gaps = times.slice(1).map((t, i) => t - times[i]!);
    const big = gaps.filter((g) => g > 0.15);
    expect(big.length).toBeGreaterThanOrEqual(2);
    // 264 ms from the last round to the next burst (one tick of slack for the 60 Hz loop).
    for (const g of big) {
      expect(g).toBeGreaterThanOrEqual(0.264 - 0.064 * 0.25 - 1e-6);
      expect(g).toBeLessThan(0.264 + TICK_DT * 1.5);
    }
    let run = 1;
    for (const g of gaps) {
      if (g > 0.15) {
        expect(run).toBe(3);
        run = 1;
      } else run++;
    }
    // About 459 rpm overall: four or five bursts in 1.5 s.
    expect(times.length).toBeGreaterThanOrEqual(12);
    expect(times.length).toBeLessThanOrEqual(15);
  });

  it('M16A4: one burst kills', () => {
    const room = setup();
    const { a, b } = duel(room, 'm16a4', 20);
    const t0 = room.time;
    while (b.alive && room.time - t0 < 0.3) {
      a.move.ads = 1;
      room.fire(a, { dir: aimAt(a, b, 1.2) });
      room.step();
    }
    expect(b.alive).toBe(false);
    expect(a.weapons[0]!.mag).toBe(27);
  });

  it('Intervention: upper chest one-shot, stomach does not, bolt gates the next shot', () => {
    const room = setup();
    const { a, b } = duel(room, 'intervention', 20);
    a.move.ads = 1;
    room.fire(a, { dir: aimAt(a, b, 1.33) });
    expect(b.alive).toBe(false);
    steps(room, 4);
    room.spawn(b);
    place(b, -1, 0);
    steps(room, 2);
    a.move.ads = 1;
    const shots: number[] = [];
    room.bus.on('fire', (e) => e.player === a && shots.push(room.time));
    room.fire(a, { dir: aimAt(a, b, 0.95) });
    expect(b.alive).toBe(true);
    expect(b.health).toBeCloseTo(100 - 77, 0);
    // The bolt: a second pull right away is refused; after the 0.92 s cycle it fires.
    room.step();
    a.move.ads = 1;
    room.fire(a, { dir: aimAt(a, b, 0.95) });
    expect(shots).toHaveLength(1);
    steps(room, 0.95);
    a.move.ads = 1;
    room.fire(a, { dir: aimAt(a, b, 1.33) });
    expect(shots).toHaveLength(2);
  });
});
