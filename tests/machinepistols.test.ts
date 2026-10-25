/**
 * Machine pistols (MP9, Skorpion, TMP, CZ75 Auto, G18): full-auto secondaries. Their numbers and
 * the niche (SMG-fast up close, worse than every SMG past ~10 m, hipfire over sights), Akimbo
 * (double mag, no ADS, more spread, no optic; Warlord still only widens the primary), the
 * Pack-a-Punch rows (names, one distinct effect each, the new stacking venom and the others in a
 * Room), unlocks / store / challenges, bots carrying one and swapping to it with a dry primary up
 * close, and Zombies damage. Everything random is seeded.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import botsFeature from '../src/server/features/bots/index';
import { botBrain, configureRoomBots } from '../src/server/features/bots/api';
import { MP_BACK_TO_PRIMARY } from '../src/server/features/bots/brain';
import { chooseBotLoadout } from '../src/server/features/bots/loadout';
import { gunGameLadder } from '../src/server/features/economy/modes/gungame';
import { callKillstreak } from '../src/server/features/killstreaks/api';
import killstreaks from '../src/server/features/killstreaks/index';
import { grant, ksOf } from '../src/server/features/killstreaks/state';
import { papVenom } from '../src/server/features/killstreaks/streaks/packapunch-effects';
import perks from '../src/server/features/perks/index';
import pickups from '../src/server/features/pickups/index';
import weapons from '../src/server/features/weapons/index';
import { switchWeapon } from '../src/server/combat';
import type { Feature } from '../src/server/feature';
import { Lobby } from '../src/server/lobby';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { Store } from '../src/server/store';
import { PLAYER, TICK_DT, type Team } from '../src/shared/constants';
import { ATTACHMENT_BY_ID, canAttach, effectiveWeapon, validAttachments } from '../src/shared/defs/attachments';
import { challengeById } from '../src/shared/defs/challenges';
import { SHARPSHOOTER } from '../src/shared/defs/economy';
import { PACK_A_PUNCH, packDef, papEffect, papEffectOf, papName, papToastLine, PAP_ID } from '../src/shared/defs/pack-a-punch';
import { PAP_FX, venomPerTick } from '../src/shared/defs/pap-effects';
import { SFX_BINDINGS, WEAPON_SHOTS } from '../src/shared/defs/sfx-recipes';
import { keyOf, storeItem } from '../src/shared/defs/store';
import { attachmentUnlocks, isUnlocked, unlockTable } from '../src/shared/defs/unlocks';
import { ADS_RECOIL, LOADOUT_WEAPONS, recoilAdsK, shotsToKill, ttkMs, WEAPON_BY_ID, type WeaponDef } from '../src/shared/defs/weapons';
import { boxPool, zombieBulletDamage, zombieDamageMult, zombiePartMult } from '../src/shared/defs/zombies';
import { GUN_GROUPS, groupOfClass } from '../src/shared/frontend/store-browse';
import { toggleAttachment } from '../src/shared/frontend/loadout-rules';
import { cloneLoadout, DEFAULT_LOADOUTS, type Loadout } from '../src/shared/loadout';
import { normalize, type Vec3 } from '../src/shared/math';
import { createMoveState } from '../src/shared/movement';
import { newProfile } from '../src/shared/profile';
import { Buttons } from '../src/shared/input';

const W = (id: string) => WEAPON_BY_ID.get(id)!;
const MPS = ['mp9', 'skorpion', 'tmp', 'cz75auto', 'g18'];
const SMGS = () => LOADOUT_WEAPONS.filter((w) => w.class === 'smg');
// The pistols that shipped before machine pistols (other branches add more; these are the yardstick).
const PISTOLS = ['m1911', 'python', 'asp'];

describe('machine pistol defs', () => {
  it('five full-auto secondaries in their own class, with pistol handling and their own models', () => {
    const mps = LOADOUT_WEAPONS.filter((w) => w.class === 'machinepistol');
    expect(mps.map((w) => w.id).sort()).toEqual([...MPS].sort());
    for (const w of mps) {
      expect(w.slot, w.id).toBe('secondary');
      expect(w.mode, w.id).toBe('auto');
      expect(w.model, w.id).toBe(w.id);
      expect(w.swapMs, w.id).toBe(W('m1911').swapMs);
      expect(w.sprintOutMs, w.id).toBe(W('m1911').sprintOutMs);
      expect(w.attachments.sort(), w.id).toEqual(['akimbo', 'extmag', 'reddot', 'suppressor']);
      expect(w.price, w.id).toBeGreaterThan(0);
    }
    expect(Object.fromEntries(MPS.map((id) => [id, W(id).magazine]))).toEqual({ mp9: 15, skorpion: 20, tmp: 15, cz75auto: 12, g18: 20 });
    // Extended mags: MW2's G18 goes 20 -> 33.
    expect(effectiveWeapon(W('g18'), ['extmag']).magazine).toBe(33);
    expect(effectiveWeapon(W('cz75auto'), ['extmag']).magazine).toBe(20);
    // Other classes keep x1.5.
    expect(effectiveWeapon(W('mp5k'), ['extmag']).magazine).toBe(45);
    // Their characters: the G18 fastest, the CZ75 Auto hardest-hitting with the smallest mag, the
    // Skorpion lightest-hitting, the TMP the steadiest.
    const by = (f: (w: WeaponDef) => number) => [...MPS].sort((a, b) => f(W(b)) - f(W(a)))[0];
    expect(by((w) => w.rpm)).toBe('g18');
    expect(by((w) => w.damage.near)).toBe('cz75auto');
    expect(by((w) => -w.damage.near)).toBe('skorpion');
    expect(by((w) => -w.recoil.vertical)).toBe('tmp');
    expect(by((w) => -w.magazine)).toBe('cz75auto');
  });

  it('hipfire guns: tighter hip spread than any SMG, looser sights, and more kick aimed than other guns', () => {
    for (const id of MPS) {
      const w = W(id);
      for (const s of SMGS()) {
        expect(w.spread.hip, `${id} hip vs ${s.id}`).toBeLessThan(s.spread.hip);
        expect(w.spread.ads, `${id} ads vs ${s.id}`).toBeGreaterThan(s.spread.ads);
      }
      expect(w.recoil.ads!, id).toBeGreaterThan(ADS_RECOIL);
      expect(recoilAdsK(w.recoil, 1), id).toBeGreaterThan(recoilAdsK(W('mp5k').recoil, 1));
    }
    // Everything else keeps the old 35% reduction when aimed.
    expect(recoilAdsK(W('ak47').recoil, 1)).toBeCloseTo(0.65);
    expect(recoilAdsK(W('ak47').recoil, 0)).toBe(1);
    // All but the steady TMP kick harder aimed than from the hip.
    for (const id of MPS.filter((x) => x !== 'tmp')) expect(W(id).recoil.ads!, id).toBeGreaterThan(1);
  });

  it('time to kill: SMG-fast and faster than any pistol up close', () => {
    for (const id of MPS) {
      const w = W(id);
      for (const d of [1, 3, 5]) {
        for (const p of PISTOLS) expect(ttkMs(w, d), `${id} vs ${p} at ${d} m`).toBeLessThan(ttkMs(W(p), d));
        // On a par with the SMGs (within 10% of the slowest).
        const slowest = Math.max(...SMGS().map((s) => ttkMs(s, d)));
        expect(ttkMs(w, d), `${id} at ${d} m`).toBeLessThan(slowest * 1.1);
      }
    }
    expect(shotsToKill(W('cz75auto'), 3)).toBe(3);
    expect(shotsToKill(W('tmp'), 3)).toBe(3);
    expect(shotsToKill(W('g18'), 3)).toBe(4);
    expect(shotsToKill(W('skorpion'), 3)).toBe(4);
    expect(ttkMs(W('g18'), 3)).toBe(144);
  });

  it('the falloff niche: past 10 m every machine pistol is slower than every SMG', () => {
    for (let d = 10.5; d <= 80; d += 0.5) {
      const smgWorst = Math.max(...SMGS().map((s) => ttkMs(s, d)));
      for (const id of MPS) expect(ttkMs(W(id), d), `${id} at ${d} m`).toBeGreaterThan(smgWorst);
    }
    // Damage is mostly gone by 13 m, but even at long range eight body shots still kill.
    for (const id of MPS) {
      expect(W(id).damage.nearRange, id).toBeLessThanOrEqual(5);
      expect(W(id).damage.farRange, id).toBeLessThanOrEqual(13);
      expect(shotsToKill(W(id), 500), id).toBeLessThanOrEqual(8);
    }
  });

  it('use the 9 mm and SMG recordings (no new files) within the pitch rules, plus suppressed voices', () => {
    for (const id of MPS) {
      const s = WEAPON_SHOTS[id]!;
      expect(s, id).toBeDefined();
      expect(s.files.every((f) => /^gun_(smg|asp|m1911)_/.test(f)), id).toBe(true);
      expect(Math.abs(s.rate - 1), id).toBeLessThanOrEqual(0.06);
      expect(SFX_BINDINGS[`shot.${id}`], id).toBeDefined();
      expect(SFX_BINDINGS[`shot.${id}.sup`]!.files.every((f) => f.startsWith('sup_pistol_')), id).toBe(true);
    }
  });
});

describe('Akimbo', () => {
  it('only machine pistols take it; a pair doubles the magazine, drops the sights, spreads a little more', () => {
    for (const w of LOADOUT_WEAPONS) expect(w.attachments.includes('akimbo'), w.id).toBe(w.class === 'machinepistol');
    const a = ATTACHMENT_BY_ID.get('akimbo')!;
    expect(a.slot).toBe('other');
    expect(a.price).toBeGreaterThan(0);
    for (const id of MPS) {
      const base = W(id);
      const e = effectiveWeapon(base, ['akimbo']);
      expect(e.noAds, id).toBe(true);
      expect(e.magazine, id).toBe(base.magazine * 2);
      expect(e.reserve, id).toBe(base.reserve * 2);
      expect(e.rpm, id).toBe(base.rpm); // no faster fire (Dual Wield on pistols has +60%)
      expect(e.spread.hip, id).toBeCloseTo(base.spread.hip * 1.2);
      expect(e.spread.hip / base.spread.hip, id).toBeLessThan(1.25);
      expect(e.spread.ads, id).toBe(e.spread.hip);
      expect(e.zoom, id).toBe(1);
      expect(e.reloadMs, id).toBeGreaterThan(base.reloadMs);
    }
    expect(effectiveWeapon(W('g18'), ['akimbo']).magazine).toBe(40);
  });

  it('rules: no optic with Akimbo (either order), anything else is a slot clash as usual', () => {
    const g18 = W('g18');
    expect(validAttachments(g18, ['akimbo', 'reddot'], 2)).toEqual(['akimbo']);
    expect(validAttachments(g18, ['reddot', 'akimbo'], 2)).toEqual(['reddot']);
    expect(validAttachments(g18, ['akimbo', 'extmag'], 2)).toEqual(['akimbo', 'extmag']);
    expect(canAttach(g18, 'reddot', ['akimbo'], 2)).toBe(false);
    expect(canAttach(g18, 'akimbo', ['reddot'], 2)).toBe(false);
    expect(canAttach(g18, 'suppressor', ['akimbo'], 2)).toBe(true);
    // One slot (every secondary): Akimbo or one other.
    expect(validAttachments(g18, ['akimbo', 'extmag'], 1)).toEqual(['akimbo']);
    expect(canAttach(g18, 'extmag', ['akimbo'], 1)).toBe(false);
    // Create-a-class: picking Akimbo takes an optic off (and the other way round).
    expect(toggleAttachment(['reddot'], 'akimbo', 2)).toEqual(['akimbo']);
    expect(toggleAttachment(['akimbo', 'extmag'], 'reddot', 2)).toEqual(['extmag', 'reddot']);
    expect(toggleAttachment(['suppressor'], 'akimbo', 2)).toEqual(['suppressor', 'akimbo']);
    // Non-akimbo guns are untouched by the rule.
    expect(validAttachments(W('ak47'), ['reddot', 'extmag'], 2)).toEqual(['reddot', 'extmag']);
  });

  it('Warlord still only widens the primary: a machine pistol spawns with one attachment', () => {
    const room = setup([weapons, perks]);
    const l: Loadout = {
      ...cloneLoadout(DEFAULT_LOADOUTS[0]!),
      perks: ['warlord'],
      primary: { weapon: 'ak47', attachments: ['extmag', 'reddot'], camo: 'none' },
      secondary: { weapon: 'g18', attachments: ['akimbo', 'extmag'], camo: 'none' },
    };
    const p = room.addBot({ team: 0, loadout: l });
    p.brain = { think: () => null };
    if (!p.alive) room.spawn(p);
    expect(p.weapons[0]!.def.attachmentIds).toEqual(['extmag', 'reddot']);
    expect(p.weapons[1]!.def.attachmentIds).toEqual(['akimbo']);
    expect(p.weapons[1]!.def.magazine).toBe(40);
    expect(p.weapons[1]!.mag).toBe(40);
  });

  it('no ADS in hand: the server refuses the sights (canAds), so holding ADS keeps the hip pose', () => {
    const room = setup([weapons]);
    const l: Loadout = { ...cloneLoadout(DEFAULT_LOADOUTS[0]!), secondary: { weapon: 'skorpion', attachments: ['akimbo'], camo: 'none' } };
    const p = room.addBot({ team: 0, loadout: l });
    let slot = 0;
    p.brain = { think: (_r, self) => ({ buttons: Buttons.ADS, yaw: self.yaw, pitch: self.pitch, weaponSlot: slot }) };
    if (!p.alive) room.spawn(p);
    steps(room, 0.6);
    expect(room.modifiers.any('canAds', p)).not.toBe(false);
    expect(p.move.ads).toBeGreaterThan(0.9);
    slot = 1;
    steps(room, 1);
    expect(p.slot).toBe(1);
    expect(room.modifiers.any('canAds', p)).toBe(false);
    expect(p.move.ads).toBe(0);
  });

  it('packs like any gun (the packed magazine grows from the doubled one)', () => {
    const e = packDef(effectiveWeapon(W('g18'), ['akimbo']));
    expect(e.name).toBe('G115 Generator');
    expect(e.magazine).toBe(80); // the G115's own dual wield doubles it again
    expect(e.noAds).toBe(true);
  });
});

describe('machine pistols: Pack-a-Punch', () => {
  it('names and one distinct effect each', () => {
    expect(Object.fromEntries(MPS.map((id) => [id, papName(id)]))).toEqual({ g18: 'G115 Generator', skorpion: 'Scorpion Venom', cz75auto: 'Calamity Jane', tmp: 'Tempest', mp9: 'Nightstalker' });
    const kinds = MPS.map((id) => papEffect(id)!.kind);
    expect(new Set(kinds).size).toBe(MPS.length);
    expect(papEffect('skorpion')!.kind).toBe('venom');
    expect(papEffect('cz75auto')!.kind).toBe('ricochet');
    expect(papEffect('g18')!.kind).toBe('akimbo');
    expect(papEffect('tmp')!.kind).toBe('laser');
    expect(papEffect('mp9')!.kind).toBe('headblast');
    expect(papToastLine('skorpion')).toBe('Scorpion Venom: venom: every hit adds poison');
    for (const id of MPS) expect(papToastLine(id).startsWith(papName(id)), id).toBe(true);
  });

  it('venom maths: perHit per dose over the clock, capped at maxStacks', () => {
    const v = papEffectOf('skorpion', 'venom')!;
    const ticks = v.sec / PAP_FX.burnTick;
    expect(venomPerTick(v, 1) * ticks).toBeCloseTo(v.perHit);
    expect(venomPerTick(v, 3) * ticks).toBeCloseTo(v.perHit * 3);
    expect(venomPerTick(v, 99)).toBeCloseTo(venomPerTick(v, v.maxStacks));
  });

  it('Scorpion Venom in a room: every hit adds a dose and restarts the clock; a poison kill is the shooter\'s', () => {
    const room = setup([weapons, perks, killstreaks, pickups]);
    const a = papBot(room, 0, 'skorpion');
    const v = papBot(room, 1);
    packNow(room, a);
    switchWeapon(room, a, 1);
    place(a, -4, 20);
    place(v, 4, 20);
    v.health = 1000;
    const spec = papEffectOf('skorpion', 'venom')!;
    shootAt(room, a, chestOf(v), 1);
    expect(papVenom(room, v)).toBe(1);
    const after1 = v.health;
    steps(room, spec.sec + 0.1);
    expect(after1 - v.health).toBeCloseTo(spec.perHit, 3);
    expect(papVenom(room, v)).toBe(0);
    // Stacking: seven quick hits cap at maxStacks doses; the poison then ticks maxStacks x perHit.
    for (let i = 0; i < 7; i++) shootAt(room, a, chestOf(v), 10 + i);
    expect(papVenom(room, v)).toBe(spec.maxStacks);
    const h = v.health;
    steps(room, spec.sec + 0.1);
    // The doses before the cap ticked a little too, inside the same window: at least the capped dose.
    expect(h - v.health).toBeGreaterThanOrEqual(spec.perHit * spec.maxStacks - 1e-6);
    expect(h - v.health).toBeLessThan(spec.perHit * spec.maxStacks + spec.perHit);
    // The kill: credited to the shooter, weapon skorpion, means poison.
    const deaths: { attacker: string | null; weapon: string; means: string }[] = [];
    room.bus.on('death', (e) => deaths.push({ attacker: e.attacker?.id ?? null, weapon: e.weapon, means: e.means }));
    v.health = 1000;
    shootAt(room, a, chestOf(v), 40);
    v.health = 1;
    steps(room, 1);
    expect(v.alive).toBe(false);
    expect(deaths).toEqual([{ attacker: a.id, weapon: 'skorpion', means: 'poison' }]);
  });

  it('the others: Tempest is a laser, the G115 Generator goes akimbo (no sights), a Nightstalker head kill bursts', () => {
    const tmp = packDef(effectiveWeapon(W('tmp')));
    expect(tmp.spread.hip).toBe(W('tmp').spread.ads);
    expect(tmp.recoil.vertical).toBe(0);
    const g18 = packDef(effectiveWeapon(W('g18')));
    expect(g18.magazine).toBe(40);
    expect(g18.rpm).toBe(W('g18').rpm);
    const room = setup([weapons, perks, killstreaks, pickups]);
    const a = papBot(room, 0, 'mp9');
    const b = papBot(room, 0, 'g18');
    const v = papBot(room, 1);
    const near = papBot(room, 1);
    for (const p of [a, b]) {
      packNow(room, p);
      switchWeapon(room, p, 1);
    }
    steps(room, 0.5);
    expect(room.modifiers.any('canAds', b)).toBe(false);
    expect(room.modifiers.any('canAds', a)).not.toBe(false);
    place(a, -4, 20);
    place(b, -4, 30);
    place(v, 4, 20);
    place(near, 4, 21.5);
    v.health = 1;
    near.health = 100;
    shootAt(room, a, { x: v.move.x, y: v.move.y + 1.68, z: v.move.z });
    expect(v.alive).toBe(false);
    expect(near.health).toBeLessThan(100);
  });
});

describe('machine pistols: unlocks, store, challenges, modes', () => {
  it('unlock spread over the levels and are bought with CoD Points', () => {
    const levels = Object.fromEntries(unlockTable().filter((u) => u.kind === 'weapon' && MPS.includes(u.id)).map((u) => [u.id, u.level]));
    expect(levels).toEqual({ mp9: 8, skorpion: 13, tmp: 22, cz75auto: 32, g18: 44 });
    expect(unlockTable().find((u) => u.id === 'g18')!.detail).toBe('Machine Pistol');
    const p = newProfile('t', 'T');
    p.level = 43;
    expect(isUnlocked(p, 'weapon', 'g18')).toBe(false);
    expect(isUnlocked(p, 'weapon', 'cz75auto')).toBe(true);
    for (const id of MPS) {
      const item = storeItem(keyOf.weapon(id))!;
      expect(item, id).toBeDefined();
      expect(item.price).toBe(W(id).price);
      for (const a of W(id).attachments) expect(storeItem(keyOf.attachment(id, a)), `${id}/${a}`).toBeDefined();
      expect(attachmentUnlocks(id).map((a) => a.id)).toContain('akimbo');
    }
    expect(attachmentUnlocks('g18').find((a) => a.id === 'akimbo')!.kills).toBe(30);
  });

  it('the store groups them as Machine Pistols right after Pistols', () => {
    const ids = GUN_GROUPS.map((g) => g.id);
    expect(ids.indexOf('machinepistol')).toBe(ids.indexOf('pistol') + 1);
    expect(groupOfClass('machinepistol')).toBe('machinepistol');
    expect(GUN_GROUPS.find((g) => g.id === 'machinepistol')!.label).toBe('Machine Pistols');
  });

  it('weapon, attachment and class challenges', () => {
    for (const id of MPS) {
      expect(challengeById(`w_${id}_kills`)?.weapon, id).toBe(id);
      expect(challengeById(`w_${id}_akimbo`)?.attachment, id).toBe('akimbo');
    }
    const c = challengeById('class_machinepistol_kills')!;
    expect(c.name).toBe('Machine Pistol Expert');
    expect(c.weaponClass).toBe('machinepistol');
  });

  it('Sharpshooter rotates them; the Gun Game ladder stays at 20 rungs without them', () => {
    expect(SHARPSHOOTER.classes).toContain('machinepistol');
    const ladder = gunGameLadder();
    expect(ladder).toHaveLength(20);
    for (const id of MPS) expect(ladder, id).not.toContain(id);
  });
});

describe('machine pistols: bots', () => {
  it('a bot sometimes carries one (now and then with its one attachment, Akimbo included)', () => {
    let s = 7;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    let mp = 0;
    let withAtt = 0;
    let akimbo = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) {
      const l = chooseBotLoadout(0.7, rnd);
      const def = W(l.secondary.weapon);
      expect(l.secondary.attachments.length).toBeLessThanOrEqual(1);
      if (def.class !== 'machinepistol') {
        expect(l.secondary.attachments).toEqual([]);
        continue;
      }
      mp++;
      if (l.secondary.attachments.length) withAtt++;
      if (l.secondary.attachments.includes('akimbo')) akimbo++;
      for (const a of l.secondary.attachments) expect(def.attachments).toContain(a);
    }
    expect(mp / N).toBeGreaterThan(0.1);
    expect(mp / N).toBeLessThan(0.4);
    expect(withAtt).toBeGreaterThan(mp * 0.3);
    expect(akimbo).toBeGreaterThan(0);
    // Same seed, same class.
    expect(chooseBotLoadout(0.5, (() => { let t = 3; return () => ((t = (t * 16807) % 2147483647) / 2147483647); })())).toEqual(chooseBotLoadout(0.5, (() => { let t = 3; return () => ((t = (t * 16807) % 2147483647) / 2147483647); })()));
  });

  it('a dry primary up close: the bot swaps to its machine pistol and fires it; far off it goes back', () => {
    let mr = 4242;
    vi.spyOn(Math, 'random').mockImplementation(() => (mr = (mr * 48271) % 2147483647) / 2147483647);
    const room = setup([weapons, botsFeature], { private: true });
    configureRoomBots(room, { fill: false, difficulty: 'veteran', variance: 0 }, { waitSec: 0 });
    const l: Loadout = { ...cloneLoadout(DEFAULT_LOADOUTS[0]!), primary: { weapon: 'ak47', attachments: [], camo: 'none' }, secondary: { weapon: 'g18', attachments: [], camo: 'none' }, perks: [], killstreaks: [] };
    const bot = room.addBot({ name: 'Shooter', team: 0, loadout: l });
    const dummy = room.addBot({ name: 'Dummy', team: 1 });
    steps(room, 0.2);
    if (!bot.alive) room.spawn(bot);
    if (!dummy.alive) room.spawn(dummy);
    dummy.brain = { think: () => null };
    room.bus.on('beforeDamage', (e) => {
      if (e.victim === dummy) e.cancel = true;
    });
    const fired: string[] = [];
    room.bus.on('fire', (e) => e.player === bot && fired.push(e.weapon));
    // Open ground on the Yard (as the bots' accuracy test uses), the dummy 6 m ahead.
    bot.move = { ...createMoveState(-12, 0, -23.5), onGround: true };
    dummy.move = { ...createMoveState(-6, 0, -23.5), onGround: true };
    const brain = botBrain(room, bot)!;
    brain.aim.yaw = -Math.PI / 2;
    expect(bot.weapons[1]!.def.base.id).toBe('g18');
    bot.weapons[0]!.mag = 0;
    bot.weapons[0]!.reserve = 30;
    for (let i = 0; i < Math.round(3 / TICK_DT) && !fired.includes('g18'); i++) {
      bot.move.x = -12;
      bot.move.z = -23.5;
      room.step();
    }
    expect(bot.slot).toBe(1);
    expect(fired).toContain('g18');
    expect(fired).not.toContain('ak47');
    // The target backs off past the machine pistol's range: back to the primary to reload it.
    dummy.move = { ...createMoveState(-12 + MP_BACK_TO_PRIMARY + 6, 0, -23.5), onGround: true };
    for (let i = 0; i < Math.round(3 / TICK_DT) && bot.slot !== 0; i++) room.step();
    expect(bot.slot).toBe(0);
  });
});

describe('machine pistols: Zombies', () => {
  it('class damage x2.4 and BO1 CZ75 head x3.5 against zombies; in the Mystery Box', () => {
    for (const id of MPS) {
      expect(zombieDamageMult(id, 'bullet'), id).toBe(2.4);
      expect(zombiePartMult(id, 'head', 'bullet'), id).toBeCloseTo(3.5 / 1.4);
      expect(zombiePartMult(id, 'torso', 'bullet'), id).toBe(1);
    }
    expect(zombieBulletDamage('cz75auto', 'head')).toBeCloseTo(40 * 3.5 * 2.4);
    expect(zombieBulletDamage('g18', 'torso')).toBeCloseTo(26 * 2.4);
    // Weaker per bullet than the SMGs it's sold against, stronger than the starting M1911.
    expect(zombieBulletDamage('g18', 'torso')).toBeLessThan(zombieBulletDamage('mp5k', 'torso'));
    expect(zombieBulletDamage('g18', 'torso')).toBeGreaterThan(zombieBulletDamage('m1911', 'torso'));
    const pool = boxPool().map((p) => p.id);
    for (const id of MPS) expect(pool, id).toContain(id);
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
  store = new Store(':memory:');
  lobby = new Lobby({ store, features, log: () => {}, autoTick: false });
  const room = lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, ...opts });
  room.modifiers.add('regenDelayMultiplier', () => 1000, 'test.noregen');
  return room;
}

const steps = (room: Room, sec: number) => {
  for (let i = 0; i < Math.round(sec / TICK_DT); i++) room.step();
};
const place = (p: PlayerState, x: number, z: number) => {
  p.move = { ...createMoveState(x, 0, z), onGround: true };
  p.yaw = 0;
  p.pitch = 0;
};
const chestOf = (p: PlayerState): Vec3 => ({ x: p.move.x, y: p.move.y + 1.2, z: p.move.z });

/** A still bot with Pack-a-Punch in its streaks and `secondary` as its sidearm. */
function papBot(room: Room, team: Team, secondary = 'm1911'): PlayerState {
  const l: Loadout = { ...cloneLoadout(DEFAULT_LOADOUTS[0]!), secondary: { weapon: secondary, attachments: [], camo: 'none' }, perks: [], killstreaks: ['uav', 'pack_a_punch', 'attack_dogs'] };
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
  expect(p.weapons.every((w) => w.pap)).toBe(true);
}
/** Fire the gun in hand at a point, hip (machine pistols' sights are loose), ready to fire. */
function shootAt(room: Room, a: PlayerState, at: Vec3, shot = 1): void {
  a.move.ads = 1;
  a.swapEnd = 0;
  a.reloadEnd = 0;
  const w = a.weapons[a.slot]!;
  w.credit = 2;
  w.burstCount = 0;
  w.lastShot = -99;
  w.mag = Math.max(w.mag, 1);
  const eye = { x: a.move.x, y: a.move.y + PLAYER.eye, z: a.move.z };
  const r = room.fire(a, { dir: normalize({ x: at.x - eye.x, y: at.y - eye.y, z: at.z - eye.z }), shot });
  expect(r.ok, JSON.stringify(r)).toBe(true);
}
