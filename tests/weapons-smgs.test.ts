/**
 * The iconic SMGs (MP5, UMP45, Vector, P90, Spectre, Uzi): kill times on the existing SMG curve and
 * the machine pistols' niche (worse than every SMG past 10 m), each gun's own feel (cadence, ADS,
 * recoil drift, range), unlocks, store, challenges, Pack-a-Punch names and effects (the new vampire
 * and adrenaline kinds, the frost chance, venom, flechettes and collateral, in a Room), camos,
 * sounds, loot and box lists, Zombies damage, seeded bot classes and a real bot brain killing with
 * each of them in a Room. Everything random is seeded.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import botsFeature from '../src/server/features/bots/index';
import { botBrain, configureRoomBots } from '../src/server/features/bots/api';
import { addRecoil, newAimState } from '../src/server/features/bots/aim';
import { chooseBotLoadout } from '../src/server/features/bots/loadout';
import { gunGameLadder } from '../src/server/features/economy/modes/gungame';
import { callKillstreak } from '../src/server/features/killstreaks/api';
import killstreaks from '../src/server/features/killstreaks/index';
import { grant, ksOf } from '../src/server/features/killstreaks/state';
import { papRushing, papVenom, setPapRng } from '../src/server/features/killstreaks/streaks/packapunch-effects';
import perks from '../src/server/features/perks/index';
import pickups from '../src/server/features/pickups/index';
import weaponsFeature from '../src/server/features/weapons/index';
import { frostOf } from '../src/server/features/weapons/wonder/index';
import type { Feature } from '../src/server/feature';
import { Lobby } from '../src/server/lobby';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { Store } from '../src/server/store';
import { PLAYER, TICK_DT, type Team } from '../src/shared/constants';
import { effectiveWeapon } from '../src/shared/defs/attachments';
import { LOOT_WEAPONS } from '../src/shared/defs/blackout';
import { camoFitsWeapon } from '../src/shared/defs/camo-unlocks';
import { MW2_CAMOS } from '../src/shared/defs/camos';
import { challengeById } from '../src/shared/defs/challenges';
import { GUN_GAME_LADDER_INTENT, SHARPSHOOTER } from '../src/shared/defs/economy';
import { BOX_CYCLE_MODELS } from '../src/shared/defs/mystery-box';
import { isPackable, PACK_A_PUNCH, packDef, papDamageMult, papEffect, papEffectOf, papEffectText, papName, papToastLine, PAP_ID, PAP_WEAPONS } from '../src/shared/defs/pack-a-punch';
import { pierceOf } from '../src/shared/defs/pap-effects';
import { SFX_BINDINGS, WEAPON_SHOTS } from '../src/shared/defs/sfx-recipes';
import { keyOf, storeItem } from '../src/shared/defs/store';
import { attachmentUnlocks, isUnlocked, unlockTable } from '../src/shared/defs/unlocks';
import { LOADOUT_WEAPONS, shotsToKill, ttkMs, WEAPON_BY_ID, type WeaponDef } from '../src/shared/defs/weapons';
import { boxPool, zombieBulletDamage, zombieDamageMult, zombiePartMult } from '../src/shared/defs/zombies';
import { cloneLoadout, DEFAULT_LOADOUTS, type Loadout } from '../src/shared/loadout';
import { normalize, type Vec3 } from '../src/shared/math';
import { createMoveState } from '../src/shared/movement';
import { penetrationType } from '../src/shared/penetration';
import { newProfile } from '../src/shared/profile';

const W = (id: string): WeaponDef => WEAPON_BY_ID.get(id)!;
const NEW = ['mp5', 'ump45', 'vector', 'p90', 'spectre', 'uzi'];
const OLD = ['mp5k', 'ak74u', 'mpl'];
const SMGS = () => LOADOUT_WEAPONS.filter((w) => w.class === 'smg');
const MPS = () => LOADOUT_WEAPONS.filter((w) => w.class === 'machinepistol');

describe('defs', () => {
  it('six primaries in the SMG class, each with its own model, name, blurb and magazine', () => {
    for (const id of NEW) {
      const w = W(id);
      expect({ id, class: w.class, slot: w.slot, mode: w.mode }).toEqual({ id, class: 'smg', slot: 'primary', mode: 'auto' });
      expect(LOADOUT_WEAPONS).toContain(w);
      expect(w.model).toBe(id);
      expect(w.blurb!.length, id).toBeGreaterThan(10);
      expect(penetrationType(w), id).toBe('small');
      expect(w.attachments, id).not.toContain('akimbo');
    }
    expect(Object.fromEntries(NEW.map((id) => [id, W(id).name]))).toEqual({ mp5: 'MP5', ump45: 'UMP45', vector: 'Vector', p90: 'P90', spectre: 'Spectre', uzi: 'Uzi' });
    expect(Object.fromEntries(NEW.map((id) => [id, W(id).magazine]))).toEqual({ mp5: 30, ump45: 32, vector: 25, p90: 50, spectre: 30, uzi: 32 });
    expect(effectiveWeapon(W('p90'), ['extmag']).magazine).toBe(75);
    // BO1's guns take a grip and dual mags; the MW2 guns rapid fire; the CoD4 MP5 neither.
    for (const id of ['spectre', 'uzi']) expect(W(id).attachments, id).toEqual(expect.arrayContaining(['grip', 'dualmag', 'rapidfire']));
    for (const id of ['ump45', 'vector', 'p90']) {
      expect(W(id).attachments, id).toContain('rapidfire');
      expect(W(id).attachments, id).not.toContain('dualmag');
    }
    expect(W('mp5').attachments).not.toContain('rapidfire');
  });
});

describe('time to kill and niches', () => {
  it('each gun has its documented kill profile (torso)', () => {
    const at = (id: string, ds: number[]) => ds.map((d) => ttkMs(W(id), d));
    expect(at('mp5', [3, 16, 20, 30])).toEqual([154, 154, 231, 308]);
    expect(at('ump45', [3, 18, 19, 80])).toEqual([167, 167, 250, 250]);
    expect(at('vector', [3, 10, 15, 30])).toEqual([150, 200, 250, 300]);
    expect(at('p90', [3, 8, 12, 30])).toEqual([126, 189, 253, 316]);
    expect(at('spectre', [3, 10, 13, 30])).toEqual([120, 180, 240, 300]);
    expect(at('uzi', [3, 12, 30])).toEqual([141, 212, 282]);
    // The UMP45 is four shots at any range; the Vector needs seven far off.
    for (const d of [20, 40, 120]) expect(shotsToKill(W('ump45'), d), `ump45 ${d}`).toBe(4);
    expect(shotsToKill(W('vector'), 3)).toBe(4);
    expect(shotsToKill(W('vector'), 40)).toBe(7);
    expect(shotsToKill(W('p90'), 40)).toBe(6);
  });

  it('stay on the SMG curve: 120-170 ms up close, 250-320 ms far off', () => {
    for (const w of SMGS()) {
      expect(ttkMs(w, 3), w.id).toBeGreaterThanOrEqual(120);
      expect(ttkMs(w, 3), w.id).toBeLessThanOrEqual(170);
      expect(ttkMs(w, 60), w.id).toBeGreaterThanOrEqual(250);
      expect(ttkMs(w, 60), w.id).toBeLessThanOrEqual(320);
    }
  });

  it('the extremes belong to the gun they describe', () => {
    const all = SMGS();
    const min = (f: (w: WeaponDef) => number) => [...all].sort((a, b) => f(a) - f(b))[0]!.id;
    const max = (f: (w: WeaponDef) => number) => [...all].sort((a, b) => f(b) - f(a))[0]!.id;
    expect(min((w) => ttkMs(w, 3))).toBe('spectre'); // strong up close
    expect(min((w) => ttkMs(w, 40))).toBe('ump45'); // holds damage at range
    expect(max((w) => ttkMs(w, 3))).toBe('ump45'); // ...paid for with the slowest kill up close
    expect(max((w) => w.rpm)).toBe('vector');
    expect(max((w) => w.magazine)).toBe('p90');
    expect(min((w) => w.spread.hip)).toBe('spectre'); // best hipfire
    expect(min((w) => w.spread.ads)).toBe('mp5'); // the accurate classic
    expect(min((w) => w.recoil.vertical)).toBe('vector'); // very low recoil
    expect(max((w) => w.recoil.vertical)).toBe('uzi'); // more recoil
    expect(max((w) => w.recoil.drift ?? 0)).toBe('uzi'); // pulls right
    expect(min((w) => w.adsMs)).toBe('uzi');
    expect(max((w) => w.adsMs)).toBe('ump45');
    expect(max((w) => w.reloadMs)).toBe('p90');
    // The P90 falls off first: fewest metres of three-shot kills among the 40-damage-class guns.
    const threeShotRange = (w: WeaponDef) => {
      let d = 0;
      while (shotsToKill(w, d) <= 3 && d < 100) d += 0.1;
      return d;
    };
    expect(threeShotRange(W('p90'))).toBeLessThan(Math.min(...all.filter((w) => w.id !== 'vector' && w.id !== 'p90').map(threeShotRange)));
    // A distinct feel: no two SMGs share cadence and ADS, nor the same damage profile.
    expect(new Set(all.map((w) => `${w.rpm}/${w.adsMs}`)).size).toBe(all.length);
    expect(new Set(all.map((w) => JSON.stringify(w.damage) + w.rpm)).size).toBe(all.length);
  });

  it('the machine pistol niche holds: past 10 m every machine pistol is slower than every SMG', () => {
    for (let d = 10.5; d <= 80; d += 0.5) {
      const smgWorst = Math.max(...SMGS().map((s) => ttkMs(s, d)));
      for (const mp of MPS()) expect(ttkMs(mp, d), `${mp.id} at ${d} m`).toBeGreaterThan(smgWorst);
    }
    // ...and the hipfire / sights split: machine pistols tighter from the hip, looser aimed.
    for (const mp of MPS()) {
      for (const id of NEW) {
        expect(mp.spread.hip, `${mp.id} hip vs ${id}`).toBeLessThan(W(id).spread.hip);
        expect(mp.spread.ads, `${mp.id} ads vs ${id}`).toBeGreaterThan(W(id).spread.ads);
      }
    }
  });

  it('recoil drift: the Uzi and Spectre walk right, the UMP45 and P90 lean left, bot aim follows', () => {
    expect(W('uzi').recoil.drift).toBeGreaterThan(0);
    expect(W('spectre').recoil.drift).toBeGreaterThan(0);
    expect(W('ump45').recoil.drift).toBeLessThan(0);
    expect(W('p90').recoil.drift).toBeLessThan(0);
    expect(W('mp5').recoil.drift).toBeUndefined();
    expect(W('vector').recoil.drift).toBeUndefined();
    expect(effectiveWeapon(W('uzi'), ['grip']).recoil.drift).toBeCloseTo(W('uzi').recoil.drift! * 0.6, 6);
    const s = newAimState();
    const yaw0 = s.yaw;
    addRecoil(s, W('uzi').recoil, 0, () => 0.5);
    expect(s.yaw - yaw0).toBeGreaterThan(0);
  });
});

describe('unlocks, store, challenges, modes', () => {
  it('unlock spread over the levels and sell at SMG prices', () => {
    const levels = Object.fromEntries(unlockTable().filter((u) => u.kind === 'weapon' && NEW.includes(u.id)).map((u) => [u.id, u.level]));
    expect(levels).toEqual({ uzi: 6, mp5: 15, spectre: 18, p90: 28, ump45: 37, vector: 47 });
    expect(unlockTable().find((u) => u.id === 'vector')!.detail).toBe('SMG');
    const p = newProfile('t', 'T');
    p.level = 36;
    expect(isUnlocked(p, 'weapon', 'p90')).toBe(true);
    expect(isUnlocked(p, 'weapon', 'ump45')).toBe(false);
    expect(Object.fromEntries(NEW.map((id) => [id, W(id).price]))).toEqual({ mp5: 2000, ump45: 3000, vector: 3000, p90: 2500, spectre: 2000, uzi: 1500 });
    for (const id of NEW) {
      const item = storeItem(keyOf.weapon(id))!;
      expect(item, id).toBeDefined();
      expect(item.price).toBe(W(id).price);
      for (const a of W(id).attachments) expect(storeItem(keyOf.attachment(id, a)), `${id}/${a}`).toBeDefined();
      expect(attachmentUnlocks(id).map((a) => a.id).sort()).toEqual([...W(id).attachments].sort());
    }
  });

  it('weapon challenges, Sharpshooter, MW2 camos (primaries); the Gun Game ladder stays at 20 rungs', () => {
    const woodland = MW2_CAMOS.find((c) => c.id === 'mw2_woodland')!;
    for (const id of NEW) {
      expect(challengeById(`w_${id}_kills`)?.weapon, id).toBe(id);
      expect(camoFitsWeapon(woodland, W(id)), id).toBe(true);
    }
    expect(SHARPSHOOTER.classes).toContain('smg');
    const ladder = gunGameLadder();
    expect(ladder).toHaveLength(20);
    for (const id of NEW) {
      expect(ladder, id).not.toContain(id);
      expect(GUN_GAME_LADDER_INTENT, id).not.toContain(id);
    }
  });
});

describe('Pack-a-Punch', () => {
  it('names and one signature effect each, no kind shared with another SMG', () => {
    const want: Record<string, [string, string]> = {
      mp5: ['Sub-Zero', 'frost'],
      ump45: ['Black Widow', 'venom'],
      vector: ['Nosferatu', 'vampire'],
      p90: ['Porcupine', 'flechette'],
      spectre: ['Phantom', 'collateral'],
      uzi: ['Uncle Gal', 'adrenaline'],
    };
    for (const [id, [name, kind]] of Object.entries(want)) {
      expect(isPackable(id), id).toBe(true);
      expect(papName(id)).toBe(name);
      expect(papEffect(id)?.kind, id).toBe(kind);
      expect(papEffectText(id).length, id).toBeGreaterThan(3);
      expect(papToastLine(id).startsWith(name), id).toBe(true);
      expect(papDamageMult(id)).toBe(PACK_A_PUNCH.damageMult);
    }
    const smgKinds = [...NEW, ...OLD].map((id) => papEffect(id)!.kind);
    expect(new Set(smgKinds).size).toBe(smgKinds.length);
    // Same kind as an older gun, other numbers.
    expect(PAP_WEAPONS.ump45!.effect).not.toEqual(PAP_WEAPONS.skorpion!.effect);
    expect(PAP_WEAPONS.mp5!.effect).not.toEqual(PAP_WEAPONS.l96a1!.effect);
    expect(pierceOf(papEffect('spectre'))).toEqual(pierceOf(papEffect('intervention')));
  });

  it('the Porcupine: flechettes tighten the spread and push the falloff twice as far', () => {
    const base = effectiveWeapon(W('p90'));
    const p = packDef(base);
    expect(p.damage.nearRange).toBe(base.damage.nearRange * 2);
    expect(p.damage.farRange).toBe(base.damage.farRange * 2);
    expect(p.spread.hip).toBeLessThan(base.spread.hip);
    expect(p.spread.ads).toBeLessThan(base.spread.ads);
    expect(p.magazine).toBe(75);
  });

  it('Nosferatu: every hit heals the shooter a little, never past max health', () => {
    const room = setup([weaponsFeature, perks, killstreaks, pickups]);
    const a = papBot(room, 0, 'vector');
    const v = papBot(room, 1);
    packNow(room, a);
    place(a, -4, 20);
    place(v, 4, 20);
    v.health = 1000;
    a.health = 50;
    const heal = papEffectOf('vector', 'vampire')!.heal;
    shootAt(room, a, chestOf(v), 1);
    expect(v.health).toBeLessThan(1000);
    expect(a.health).toBeCloseTo(50 + heal);
    a.health = a.maxHealth - 1;
    shootAt(room, a, chestOf(v), 2);
    expect(a.health).toBe(a.maxHealth);
    // An unpacked Vector heals nothing.
    const b = papBot(room, 0, 'vector');
    place(b, -4, 24);
    place(v, 4, 24);
    b.health = 50;
    shootAt(room, b, chestOf(v), 3);
    expect(b.health).toBe(50);
  });

  it('Uncle Gal: a kill refills the magazine for free and rushes the killer for a few seconds', () => {
    const room = setup([weaponsFeature, perks, killstreaks, pickups]);
    const a = papBot(room, 0, 'uzi');
    const v = papBot(room, 1);
    packNow(room, a);
    place(a, -4, 20);
    place(v, 4, 20);
    const w = a.weapons[a.slot]!;
    w.mag = 5;
    const reserve = w.reserve;
    v.health = 1000;
    shootAt(room, a, chestOf(v), 1);
    expect(w.mag).toBe(4); // a hit without a kill: nothing
    expect(papRushing(room, a)).toBe(false);
    v.health = 1;
    shootAt(room, a, chestOf(v), 2);
    expect(v.alive).toBe(false);
    expect(w.mag).toBe(w.def.magazine);
    expect(w.reserve).toBe(reserve);
    const spec = papEffectOf('uzi', 'adrenaline')!;
    expect(papRushing(room, a)).toBe(true);
    expect(room.modifiers.mul('speedMultiplier', a)).toBeCloseTo(spec.speed);
    steps(room, spec.sec + 0.1);
    expect(papRushing(room, a)).toBe(false);
    expect(room.modifiers.mul('speedMultiplier', a)).toBeCloseTo(1);
  });

  it('Sub-Zero: a seeded chance of the hits freezes solid (the Iceburg still always does)', () => {
    const room = setup([weaponsFeature, perks, killstreaks, pickups]);
    const a = papBot(room, 0, 'mp5');
    const v = papBot(room, 1);
    packNow(room, a);
    place(a, -4, 20);
    place(v, 4, 20);
    v.health = 1000;
    const chance = papEffectOf('mp5', 'frost')!.chance!;
    expect(chance).toBeGreaterThan(0);
    expect(chance).toBeLessThan(0.5);
    setPapRng(room, () => chance + 0.01);
    shootAt(room, a, chestOf(v), 1);
    expect(v.health).toBeLessThan(1000);
    expect(frostOf(v)).toBe(0);
    setPapRng(room, () => chance - 0.01);
    shootAt(room, a, chestOf(v), 2);
    expect(frostOf(v)).toBe(1);
    expect(papEffectOf('l96a1', 'frost')!.chance).toBeUndefined();
  });

  it('Black Widow: heavy venom capped at three doses; Phantom rounds go through every body', () => {
    const room = setup([weaponsFeature, perks, killstreaks, pickups]);
    const a = papBot(room, 0, 'ump45');
    const v = papBot(room, 1);
    packNow(room, a);
    place(a, -4, 20);
    place(v, 4, 20);
    v.health = 1000;
    for (let i = 0; i < 5; i++) shootAt(room, a, chestOf(v), 1 + i);
    expect(papVenom(room, v)).toBe(papEffectOf('ump45', 'venom')!.maxStacks);
    expect(papVenom(room, v)).toBe(3);
    const s = papBot(room, 0, 'spectre');
    const v1 = papBot(room, 1);
    const v2 = papBot(room, 1);
    packNow(room, s);
    place(a, -8, 20);
    place(s, -4, 20);
    place(v1, 2, 20);
    place(v2, 6, 20);
    v1.health = v2.health = 1000;
    shootAt(room, s, chestOf(v1), 1);
    expect(v1.health).toBeLessThan(1000);
    expect(v2.health).toBeLessThan(1000);
  });
});

describe('everywhere else guns are listed', () => {
  it('sounds: SMG recordings (plus the .45 and 9 mm pools) within +-6% pitch, suppressed voices', () => {
    for (const id of NEW) {
      const s = WEAPON_SHOTS[id]!;
      expect(s, id).toBeDefined();
      expect(s.files.some((f) => f.startsWith('gun_smg_')), id).toBe(true);
      expect(s.files.every((f) => /^gun_(smg|asp|m1911)_/.test(f)), id).toBe(true);
      expect(Math.abs(s.rate - 1), id).toBeLessThanOrEqual(0.06 + 1e-9);
      expect(SFX_BINDINGS[`shot.${id}`], id).toBeDefined();
      expect(SFX_BINDINGS[`shot.${id}.sup`]!.files.every((f) => f.startsWith('sup_pistol_')), id).toBe(true);
    }
  });

  it('Blackout loot, the Zombies box and damage tables, the Mystery Box cycle', () => {
    const pool = boxPool().map((p) => p.id);
    for (const id of NEW) {
      expect(LOOT_WEAPONS, id).toContain(id);
      expect(pool, id).toContain(id);
      expect(zombieDamageMult(id, 'bullet'), id).toBe(2.5);
      expect(zombiePartMult(id, 'head', 'bullet'), id).toBeCloseTo(4 / 1.4);
    }
    expect(zombieBulletDamage('ump45', 'torso')).toBeCloseTo(38 * 2.5);
    expect(zombieBulletDamage('vector', 'head')).toBeCloseTo(25 * 4 * 2.5);
    expect(BOX_CYCLE_MODELS).toContain('spectre');
  });

  it('bot classes pick every one of them (seeded), SMGs a bit under a quarter of primaries', () => {
    const seen = new Map<string, number>();
    let s = 7;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    let smg = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const l = chooseBotLoadout(0.6, rnd);
      seen.set(l.primary.weapon, (seen.get(l.primary.weapon) ?? 0) + 1);
      if (W(l.primary.weapon).class === 'smg') smg++;
    }
    for (const id of NEW) expect(seen.get(id) ?? 0, id).toBeGreaterThan(40);
    expect(smg / N).toBeGreaterThan(0.18);
    expect(smg / N).toBeLessThan(0.32);
  });
});

// ---------------------------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------------------------

let store: Store | undefined;
let lobby: Lobby | undefined;

afterEach(() => {
  vi.restoreAllMocks();
  lobby?.shutdown();
  store?.close();
  lobby = undefined;
  store = undefined;
});

function setup(features: Feature[], opts: { private?: boolean } = {}): Room {
  let mr = 777;
  vi.spyOn(Math, 'random').mockImplementation(() => (mr = (mr * 48271) % 2147483647) / 2147483647);
  store = new Store(':memory:');
  lobby = new Lobby({ store, features, log: () => {}, autoTick: false });
  const room = lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, ...opts });
  room.modifiers.add('regenDelayMultiplier', () => 1000, 'test.noregen');
  return room;
}

const steps = (r: Room, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) r.step();
};
const place = (p: PlayerState, x: number, z: number) => {
  p.move = { ...createMoveState(x, 0, z), onGround: true };
  p.yaw = 0;
  p.pitch = 0;
};
const chestOf = (p: PlayerState): Vec3 => ({ x: p.move.x, y: p.move.y + 1.2, z: p.move.z });

/** A still bot with Pack-a-Punch in its streaks and `primary` in hand. */
function papBot(room: Room, team: Team, primary = 'ak47'): PlayerState {
  const l: Loadout = { ...cloneLoadout(DEFAULT_LOADOUTS[0]!), primary: { weapon: primary, attachments: [], camo: 'none' }, perks: [], killstreaks: ['uav', 'pack_a_punch', 'attack_dogs'] };
  const p = room.addBot({ team, loadout: l });
  p.brain = { think: (_r, self) => ({ buttons: 0, yaw: self.yaw, pitch: self.pitch, weaponSlot: self.slot }) };
  ksOf(p).manual = true;
  if (!p.alive) room.spawn(p);
  return p;
}
function packNow(room: Room, p: PlayerState): void {
  grant(room, p, PAP_ID);
  expect(callKillstreak(room, p, PAP_ID)).toEqual({ ok: true });
  steps(room, PACK_A_PUNCH.durationSec + 0.1);
  expect(p.weapons[p.slot]!.pap).toBe(true);
}
/** Fire the gun in hand at a point, aimed (the seeded spread is tiny), ready to fire. */
function shootAt(room: Room, a: PlayerState, at: Vec3, shot = 1): void {
  a.move.ads = 1;
  a.swapEnd = 0;
  a.reloadEnd = 0;
  const w = a.weapons[a.slot]!;
  w.credit = 2;
  w.burstCount = 0;
  w.lastShot = -99;
  const eye = { x: a.move.x, y: a.move.y + PLAYER.eye, z: a.move.z };
  const r = room.fire(a, { dir: normalize({ x: at.x - eye.x, y: at.y - eye.y, z: at.z - eye.z }), shot });
  expect(r.ok, JSON.stringify(r)).toBe(true);
}

const loadoutWith = (id: string): Loadout => ({
  name: 'test',
  primary: { weapon: id, attachments: [], camo: 'none' },
  secondary: { weapon: 'm1911', attachments: [], camo: 'none' },
  perks: [],
  killstreaks: [],
  lethal: null,
  tactical: null,
});

/** A veteran bot with `id` in hand against a still dummy 14 m away: shots fired with the gun, and whether it killed. */
function botDuel(id: string): { shots: number; killed: boolean; weapon: string | undefined } {
  const r = setup([weaponsFeature, botsFeature], { private: true });
  configureRoomBots(r, { fill: false, difficulty: 'veteran', variance: 0 }, { waitSec: 0 });
  const shooter = r.addBot({ name: 'Shooter', team: 0, loadout: loadoutWith(id) });
  const dummy = r.addBot({ name: 'Dummy', team: 1 });
  dummy.brain = { think: () => null };
  steps(r, 0.3);
  const put = (p: PlayerState, x: number, z: number) => (p.move = { ...createMoveState(x, 0, z), onGround: true });
  let shots = 0;
  let killed = false;
  r.bus.on('fire', (e) => e.player === shooter && e.weapon === id && shots++);
  r.bus.on('death', (e) => e.victim === dummy && e.attacker === shooter && e.weapon === id && (killed = true));
  const brain = botBrain(r, shooter)!;
  for (let round = 0; round < 3 && !killed; round++) {
    if (!dummy.alive) r.spawn(dummy);
    if (!shooter.alive) r.spawn(shooter);
    put(shooter, -12, -23.5);
    put(dummy, 2, -24);
    brain.target = null;
    brain.aim.yaw = -Math.PI / 2;
    steps(r, 4);
  }
  return { shots, killed, weapon: shooter.weapons[shooter.slot]?.def.base.id };
}

describe('a bot uses each new SMG', () => {
  for (const id of NEW) {
    it(`${id}: a veteran bot fires it and gets the kill`, () => {
      const res = botDuel(id);
      expect(res.weapon, id).toBe(id);
      expect(res.shots, id).toBeGreaterThan(0);
      expect(res.killed, id).toBe(true);
    });
  }
});
