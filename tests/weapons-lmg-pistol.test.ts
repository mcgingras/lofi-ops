/**
 * The early-CoD LMGs (M60, Stoner63, HK21, RPD, M249 SAW, MG4) and pistols (Desert Eagle, Makarov,
 * USP .45): sane numbers on the existing TTK curve, each LMG's niche against the ARs and the others,
 * recoil drift, unlocks, store, challenges, Pack-a-Punch names and effects, camos, sounds, loot and
 * box lists, bot classes, and a real bot brain killing with every one of them in a Room.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import botsFeature from '../src/server/features/bots/index';
import { botBrain, configureRoomBots } from '../src/server/features/bots/api';
import { addRecoil, newAimState } from '../src/server/features/bots/aim';
import { chooseBotLoadout } from '../src/server/features/bots/loadout';
import { gunGameLadder } from '../src/server/features/economy/modes/gungame';
import weaponsFeature from '../src/server/features/weapons/index';
import { Lobby } from '../src/server/lobby';
import { makeWeapon, type PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { Store } from '../src/server/store';
import { effectiveWeapon } from '../src/shared/defs/attachments';
import { LOOT_WEAPONS } from '../src/shared/defs/blackout';
import { camoFitsWeapon } from '../src/shared/defs/camo-unlocks';
import { MW2_CAMOS } from '../src/shared/defs/camos';
import { challengeById } from '../src/shared/defs/challenges';
import { SHARPSHOOTER } from '../src/shared/defs/economy';
import { BOX_CYCLE_MODELS } from '../src/shared/defs/mystery-box';
import { isPackable, packDef, papDamageMult, papEffect, papEffectText, papName, PAP_WEAPONS } from '../src/shared/defs/pack-a-punch';
import { SFX_BINDINGS, WEAPON_SHOTS } from '../src/shared/defs/sfx-recipes';
import { keyOf, storeItem } from '../src/shared/defs/store';
import { attachmentUnlocks, isUnlocked, unlockTable } from '../src/shared/defs/unlocks';
import { boxPool } from '../src/shared/defs/zombies';
import { LOADOUT_WEAPONS, shotsToKill, ttkMs, WEAPON_BY_ID, type WeaponDef } from '../src/shared/defs/weapons';
import { penetrationType } from '../src/shared/penetration';
import { TICK_DT } from '../src/shared/constants';
import { createMoveState } from '../src/shared/movement';
import type { Loadout } from '../src/shared/loadout';
import { newProfile } from '../src/shared/profile';

const W = (id: string): WeaponDef => WEAPON_BY_ID.get(id)!;
const LMGS = ['m60', 'stoner63', 'hk21', 'rpd', 'm249', 'mg4'];
const PISTOLS = ['deagle', 'makarov', 'usp'];
const NEW = [...LMGS, ...PISTOLS];
const ARS = LOADOUT_WEAPONS.filter((w) => w.class === 'ar');

describe('defs', () => {
  it('ships the six LMGs as primaries and the three pistols as secondaries, each with its own model', () => {
    for (const id of LMGS) expect({ id, class: W(id).class, slot: W(id).slot }).toEqual({ id, class: 'lmg', slot: 'primary' });
    for (const id of PISTOLS) expect({ id, class: W(id).class, slot: W(id).slot }).toEqual({ id, class: 'pistol', slot: 'secondary' });
    for (const id of NEW) {
      expect(LOADOUT_WEAPONS).toContain(W(id));
      expect(W(id).model).toBe(id);
      expect(W(id).blurb!.length, id).toBeGreaterThan(10);
    }
    expect(W('m249').name).toBe('M249 SAW');
    expect(W('deagle').name).toBe('Desert Eagle');
    expect(W('usp').name).toBe('USP .45');
  });

  it('carry their famous magazines', () => {
    expect(Object.fromEntries(NEW.map((id) => [id, W(id).magazine]))).toEqual({ m60: 100, stoner63: 75, hk21: 125, rpd: 100, m249: 100, mg4: 100, deagle: 7, makarov: 8, usp: 12 });
  });

  it('penetration: LMGs large like the RPK, the Desert Eagle medium like the Python, the others small', () => {
    for (const id of LMGS) expect(penetrationType(W(id)), id).toBe('large');
    expect(penetrationType(W('deagle'))).toBe('medium');
    expect(penetrationType(W('makarov'))).toBe('small');
    expect(penetrationType(W('usp'))).toBe('small');
  });
});

describe('time to kill and niches', () => {
  it('each LMG has its documented kill profile', () => {
    // M60: three shots at every range.
    for (const d of [5, 40, 70, 150]) expect(shotsToKill(W('m60'), d), `m60 ${d}`).toBe(3);
    expect(ttkMs(W('m60'), 100)).toBe(218);
    // Stoner63: four shots to 45 m, then five.
    expect(shotsToKill(W('stoner63'), 45)).toBe(4);
    expect(shotsToKill(W('stoner63'), 60)).toBe(5);
    expect(ttkMs(W('stoner63'), 10)).toBe(210);
    // HK21: three shots (150 ms) up close, four from ~38 m.
    expect(ttkMs(W('hk21'), 10)).toBe(150);
    expect(shotsToKill(W('hk21'), 37)).toBe(3);
    expect(shotsToKill(W('hk21'), 40)).toBe(4);
    // RPD: three shots to ~56 m.
    expect(shotsToKill(W('rpd'), 56)).toBe(3);
    expect(shotsToKill(W('rpd'), 60)).toBe(4);
    expect(ttkMs(W('rpd'), 30)).toBe(171);
    // SAW: four shots at 937 rpm up close, five past ~37 m.
    expect(ttkMs(W('m249'), 10)).toBe(192);
    expect(shotsToKill(W('m249'), 45)).toBe(5);
    // MG4: four shots at every range.
    for (const d of [5, 40, 80]) expect(shotsToKill(W('mg4'), d), `mg4 ${d}`).toBe(4);
    expect(ttkMs(W('mg4'), 80)).toBe(225);
  });

  it('stay on the existing curve: no LMG out-kills the fastest AR up close, every one kills inside 300 ms to 30 m', () => {
    const fastestAr = Math.min(...ARS.map((w) => ttkMs(w, 10)));
    for (const id of LMGS) {
      expect(ttkMs(W(id), 10), id).toBeGreaterThan(fastestAr);
      expect(ttkMs(W(id), 30), id).toBeLessThanOrEqual(300);
    }
  });

  it('LMG niche against the ARs: bigger magazines, slower ADS and movement, longer reloads', () => {
    const maxArMag = Math.max(...ARS.map((w) => w.magazine));
    const maxArAds = Math.max(...ARS.map((w) => w.adsMs));
    const maxArMove = Math.max(...ARS.map((w) => w.moveMult));
    const maxArReload = Math.max(...ARS.map((w) => w.reloadMs));
    for (const id of LMGS) {
      const w = W(id);
      expect(w.magazine, id).toBeGreaterThanOrEqual(2 * maxArMag);
      expect(w.adsMs, id).toBeGreaterThan(maxArAds);
      expect(w.moveMult, id).toBeLessThanOrEqual(maxArMove - 0.05 + 1e-9);
      expect(w.reloadMs, id).toBeGreaterThan(maxArReload);
    }
  });

  it('each LMG plays differently: the extremes belong to the gun they describe', () => {
    const all = [...LMGS, 'rpk'].map(W);
    const by = (f: (w: WeaponDef) => number) => [...all].sort((a, b) => f(a) - f(b));
    expect(by((w) => w.adsMs)[0]!.id).toBe('stoner63'); // quickest to aim
    expect(by((w) => w.adsMs).at(-1)!.id).toBe('m60'); // slowest
    expect(by((w) => w.moveMult).at(-1)!.id).toBe('stoner63');
    expect(by((w) => w.moveMult)[0]!.id).toBe('m60');
    expect(by((w) => w.recoil.vertical)[0]!.id).toBe('stoner63'); // lowest kick
    expect(by((w) => w.recoil.vertical).at(-1)!.id).toBe('m60'); // biggest climb
    expect(by((w) => w.recoil.horizontal).at(-1)!.id).toBe('hk21'); // bucks side to side
    expect(by((w) => w.recoil.horizontal)[0]!.id).toBe('rpd'); // the straight laser
    expect(by((w) => w.spread.hip)[0]!.id).toBe('m249'); // best hipfire
    expect(by((w) => w.spread.ads)[0]!.id).toBe('rpd'); // tightest aimed cone
    expect(by((w) => w.rpm).at(-1)!.id).toBe('m249');
    expect(by((w) => w.rpm)[0]!.id).toBe('m60');
    expect(by((w) => w.magazine).at(-1)!.id).toBe('hk21');
    // No two share the same cadence and ADS pair.
    expect(new Set(all.map((w) => `${w.rpm}/${w.adsMs}`)).size).toBe(all.length);
  });

  it('recoil drift: a steady pull that the grip scales and bot aim follows', () => {
    expect(W('m60').recoil.drift).toBeLessThan(0); // pulls left
    expect(W('rpd').recoil.drift).toBeGreaterThan(0);
    expect(effectiveWeapon(W('m60'), ['grip']).recoil.drift).toBeCloseTo(W('m60').recoil.drift! * 0.6, 6);
    expect(effectiveWeapon(W('ak47'), ['grip']).recoil.drift).toBeUndefined();
    // With the random part at its centre (rnd 0.5) only the drift moves the yaw.
    const s = newAimState();
    const yaw0 = s.yaw;
    addRecoil(s, W('m60').recoil, 0, () => 0.5);
    expect(s.yaw - yaw0).toBeLessThan(0);
    const t = newAimState();
    addRecoil(t, W('ak47').recoil, 0, () => 0.5);
    expect(t.yaw).toBe(yaw0);
  });

  it('pistols: the Desert Eagle two-shots up close, the Makarov is the quick starter, the USP the all-rounder', () => {
    expect(shotsToKill(W('deagle'), 5)).toBe(2);
    expect(shotsToKill(W('deagle'), 15)).toBe(3);
    expect(shotsToKill(W('deagle'), 30)).toBe(4);
    expect(shotsToKill(W('python'), 30)).toBe(3); // the Python holds range
    expect(ttkMs(W('deagle'), 5)).toBeLessThan(ttkMs(W('python'), 5));
    expect(shotsToKill(W('makarov'), 5)).toBe(3);
    expect(shotsToKill(W('makarov'), 10)).toBe(4);
    expect(shotsToKill(W('usp'), 8)).toBe(3);
    expect(ttkMs(W('usp'), 8)).toBe(200);
    const pistols = LOADOUT_WEAPONS.filter((w) => w.class === 'pistol');
    expect([...pistols].sort((a, b) => a.adsMs - b.adsMs)[0]!.id).toBe('makarov');
    expect([...pistols].sort((a, b) => b.recoil.vertical - a.recoil.vertical)[0]!.id).toBe('deagle');
    expect(Math.max(...pistols.map((w) => w.magazine))).toBe(W('usp').magazine);
  });
});

describe('unlocks, store, challenges, wagers', () => {
  it('unlock across the whole level range and are sold at prices in line with their class', () => {
    const levels = Object.fromEntries(unlockTable().filter((u) => u.kind === 'weapon').map((u) => [u.id, u.level]));
    expect(levels).toMatchObject({ stoner63: 20, m249: 23, mg4: 34, hk21: 38, rpd: 42, m60: 45, deagle: 36, usp: 9 });
    expect(W('makarov').unlockLevel).toBe(1);
    expect(W('makarov').price).toBe(0);
    const p = newProfile('t', 'T');
    p.level = 1;
    expect(isUnlocked(p, 'weapon', 'makarov')).toBe(true);
    expect(isUnlocked(p, 'weapon', 'usp')).toBe(false);
    p.level = 44;
    expect(isUnlocked(p, 'weapon', 'rpd')).toBe(true);
    expect(isUnlocked(p, 'weapon', 'm60')).toBe(false);
    for (const id of NEW.filter((x) => x !== 'makarov')) {
      const item = storeItem(keyOf.weapon(id))!;
      expect(item, id).toBeDefined();
      expect(item.price).toBe(W(id).price);
      expect(item.price, id).toBeGreaterThanOrEqual(1000);
      expect(item.price, id).toBeLessThanOrEqual(3500);
    }
    for (const id of NEW) {
      for (const a of W(id).attachments) expect(storeItem(keyOf.attachment(id, a)), `${id}/${a}`).toBeDefined();
      expect(attachmentUnlocks(id).map((a) => a.id).sort()).toEqual([...W(id).attachments].sort());
    }
  });

  it('have weapon challenges and fit Sharpshooter; the Gun Game ladder stays at 20 rungs', () => {
    for (const id of NEW) {
      expect(challengeById(`w_${id}_kills`)?.weapon, id).toBe(id);
      expect(SHARPSHOOTER.classes).toContain(W(id).class);
    }
    const ladder = gunGameLadder();
    expect(ladder.length).toBe(20);
    for (const id of NEW) expect(ladder, id).not.toContain(id);
  });
});

describe('Pack-a-Punch', () => {
  it('every new gun packs with its name and a distinct signature effect', () => {
    const want: Record<string, [string, string]> = {
      m60: ['Mutilator', 'stagger'],
      stoner63: ['Stoner63 Deathbringer', 'mark'],
      hk21: ['H115 Oscillator', 'zap'],
      rpd: ['R.I.P.D.', 'pierce'],
      m249: ['Scorched Earth Weapon', 'burn'],
      mg4: ['Thunderclap', 'shockwave'],
      deagle: ['Desert Hawk', 'knockback'],
      makarov: ['Dvoynik', 'doubletap'],
      usp: ['Peacekeeper .45', 'shatter'],
    };
    for (const [id, [name, kind]] of Object.entries(want)) {
      expect(isPackable(id), id).toBe(true);
      expect(papName(id)).toBe(name);
      expect(papEffect(id)?.kind, id).toBe(kind);
      expect(papEffectText(id).length, id).toBeGreaterThan(3);
      expect(papDamageMult(id), id).toBeGreaterThanOrEqual(1.25);
    }
    // Same kind as an older gun, but not the same numbers.
    expect(PAP_WEAPONS.m60!.effect).not.toEqual(PAP_WEAPONS.acr!.effect);
    expect(PAP_WEAPONS.mg4!.effect).not.toEqual(PAP_WEAPONS.rpk!.effect);
    expect(PAP_WEAPONS.hk21!.effect).not.toEqual(PAP_WEAPONS.mp5k!.effect);
    expect(PAP_WEAPONS.rpd!.effect).not.toEqual(PAP_WEAPONS.m16!.effect);
    expect(PAP_WEAPONS.m249!.effect).not.toEqual(PAP_WEAPONS.ak47!.effect);
  });

  it('packed defs: bigger belts, the Dvoynik fires pairs, a packed Desert Hawk headshot is still not a one-shot', () => {
    expect(packDef(effectiveWeapon(W('hk21'), [])).magazine).toBe(188);
    const dv = packDef(effectiveWeapon(W('makarov'), []));
    expect(dv.mode).toBe('burst');
    expect(dv.burst).toBe(2);
    expect(dv.magazine % 2).toBe(0);
    expect(W('deagle').damage.near * W('deagle').multipliers.head * papDamageMult('deagle')).toBeLessThan(100);
  });
});

describe('everywhere else guns are listed', () => {
  it('camos: MW2 camos fit the LMGs (primaries), not the pistols', () => {
    const woodland = MW2_CAMOS.find((c) => c.id === 'mw2_woodland')!;
    for (const id of LMGS) expect(camoFitsWeapon(woodland, W(id)), id).toBe(true);
    for (const id of PISTOLS) expect(camoFitsWeapon(woodland, W(id)), id).toBe(false);
  });

  it('sounds: class recordings within +-6% pitch, a suppressed voice for each', () => {
    for (const id of ['m60', 'hk21', 'rpd']) expect(WEAPON_SHOTS[id]!.files.every((f) => f.startsWith('gun_ak_')), id).toBe(true);
    for (const id of ['stoner63', 'm249', 'mg4']) expect(WEAPON_SHOTS[id]!.files.every((f) => f.startsWith('gun_ar_')), id).toBe(true);
    for (const id of NEW) {
      expect(Math.abs(WEAPON_SHOTS[id]!.rate - 1), id).toBeLessThanOrEqual(0.06 + 1e-9);
      expect(SFX_BINDINGS[`shot.${id}`], id).toBeDefined();
      expect(SFX_BINDINGS[`shot.${id}.sup`]!.files.every((f) => f.startsWith('sup_')), id).toBe(true);
    }
  });

  it('Blackout loot, the Zombies box and the Mystery Box cycle', () => {
    for (const id of NEW) expect(LOOT_WEAPONS, id).toContain(id);
    const pool = boxPool().map((p) => p.id);
    for (const id of NEW) expect(pool, id).toContain(id);
    expect(BOX_CYCLE_MODELS).toContain('hk21');
    expect(BOX_CYCLE_MODELS).toContain('stoner63');
  });

  it('bot classes pick every one of them (seeded)', () => {
    const seen = new Map<string, number>();
    let s = 7;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 4000; i++) {
      const l = chooseBotLoadout(0.6, rnd);
      for (const id of [l.primary.weapon, l.secondary.weapon]) seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    for (const id of NEW) expect(seen.get(id) ?? 0, id).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------------------------
// A real bot brain using each gun in a Room
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

const steps = (r: Room, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) r.step();
};
const loadoutWith = (id: string): Loadout => ({
  name: 'test',
  primary: { weapon: W(id).slot === 'primary' ? id : 'ak47', attachments: [], camo: 'none' },
  secondary: { weapon: W(id).slot === 'secondary' ? id : 'm1911', attachments: [], camo: 'none' },
  perks: [],
  killstreaks: [],
  lethal: null,
  tactical: null,
});

/** A veteran bot with `id` in hand against a still dummy 14 m away: shots fired with the gun, and whether it killed. */
function botDuel(id: string): { shots: number; killed: boolean; weapon: string | undefined } {
  let mr = 4242;
  vi.spyOn(Math, 'random').mockImplementation(() => (mr = (mr * 48271) % 2147483647) / 2147483647);
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: [weaponsFeature, botsFeature], log: () => {}, autoTick: false });
  const r = lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, private: true });
  configureRoomBots(r, { fill: false, difficulty: 'veteran', variance: 0 }, { waitSec: 0 });
  const shooter = r.addBot({ name: 'Shooter', team: 0, loadout: loadoutWith(id) });
  const dummy = r.addBot({ name: 'Dummy', team: 1 });
  dummy.brain = { think: () => null };
  steps(r, 0.3);
  const put = (p: PlayerState, x: number, z: number) => (p.move = { ...createMoveState(x, 0, z), onGround: true });
  // Pistols: in hand from the start (the primary is put away as if empty).
  if (W(id).slot === 'secondary') {
    shooter.weapons[0] = makeWeapon({ weapon: id, attachments: [], camo: 'none' }, id);
  }
  let shots = 0;
  let killed = false;
  r.bus.on('fire', (e) => e.player === shooter && e.weapon === id && shots++);
  r.bus.on('death', (e) => e.victim === dummy && e.attacker === shooter && e.weapon === id && (killed = true));
  const brain = botBrain(r, shooter)!;
  for (let round = 0; round < 3 && !killed; round++) {
    if (!dummy.alive) r.spawn(dummy);
    put(shooter, -12, -23.5);
    put(dummy, 2, -24);
    brain.target = null;
    brain.aim.yaw = -Math.PI / 2;
    steps(r, 4);
  }
  return { shots, killed, weapon: shooter.weapons[shooter.slot]?.def.base.id };
}

describe('a bot uses each new gun', () => {
  for (const id of NEW) {
    it(`${id}: a veteran bot fires it and gets the kill`, () => {
      const res = botDuel(id);
      expect(res.weapon, id).toBe(id);
      expect(res.shots, id).toBeGreaterThan(0);
      expect(res.killed, id).toBe(true);
    });
  }
});
