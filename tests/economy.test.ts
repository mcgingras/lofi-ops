/** Economy rules: CP earning, payouts, store gates/purchases, class enforcement, bot settings. */
import { describe, expect, it } from 'vitest';
import { jitterSkill, sanitizeBots } from '../src/server/features/economy/wager';
import { ATTACHMENT_BY_ID } from '../src/shared/defs/attachments';
import { BOT_SKILL_RANGES, skillFor } from '../src/shared/defs/bots';
import { CAMOS } from '../src/shared/defs/camos';
import { codPointsBreakdown, codPointsForMatch, paidPlaces, wagerPayouts, WAGER_MODES } from '../src/shared/defs/economy';
import { MODE_BY_ID } from '../src/shared/defs/modes';
import { canUse, enforceLoadout, keyOf, lockReason, purchase, storeCatalog, storeItem } from '../src/shared/defs/store';
import { WAGER_ONLY_WEAPONS } from '../src/shared/defs/wager-weapons';
import { WEAPON_BY_ID, WEAPONS, type WeaponDef } from '../src/shared/defs/weapons';
import { DEFAULT_LOADOUTS, cloneLoadout } from '../src/shared/loadout';
import { newProfile } from '../src/shared/profile';

// A priced, level-gated weapon for the store tests (the weapons area ships the real roster).
const testGun: WeaponDef = { ...WEAPON_BY_ID.get('ak47')!, id: 'testgun', name: 'Test Gun', unlockLevel: 5, price: 2000, attachments: ['reddot', 'extmag'] };
if (!WEAPON_BY_ID.has('testgun')) {
  WEAPONS.push(testGun);
  (WEAPON_BY_ID as Map<string, WeaponDef>).set('testgun', testGun);
}

describe('CoD Points earning', () => {
  it('pays for completion, score, victory, podium and streaks', () => {
    const b = codPointsBreakdown({ score: 2500, won: true, place: 1, teams: false, bestStreak: 10, timePlayed: 600, durationSec: 600 });
    expect(b.total).toBe(100 + 250 + 100 + 75 + 100);
    expect(b.lines.map((l) => l.label)).toContain('Victory');
    expect(codPointsForMatch({ score: 1000, won: false, teams: true })).toBe(200);
  });

  it('scales completion by time played, has a floor and a cap', () => {
    expect(codPointsForMatch({ score: 0, won: false, timePlayed: 300, durationSec: 600 })).toBe(50);
    expect(codPointsForMatch({ score: 0, won: false, timePlayed: 10, durationSec: 600 })).toBe(25);
    expect(codPointsForMatch({ score: 1e6, won: true })).toBe(2000);
  });
});

describe('wager payouts', () => {
  it('splits the pot 50/30/20 with 4+ staked and pays at most humans - 1 places', () => {
    expect(wagerPayouts(6000, 6, 6)).toEqual([3000, 1800, 1200]);
    expect(wagerPayouts(30, 3, 3)).toEqual([20, 10]);
    expect(wagerPayouts(2000, 2, 2)).toEqual([2000]);
    expect(paidPlaces(1)).toBe(0);
    expect(wagerPayouts(1000, 1, 1)).toEqual([]);
  });

  it('keeps the whole pot when leavers shrink the paid places, rounding to 1st', () => {
    const pay = wagerPayouts(40, 4, 2);
    expect(pay.length).toBe(2);
    expect(pay.reduce((a, b) => a + b, 0)).toBe(40);
    expect(pay[0]).toBeGreaterThan(pay[1]!);
    const odd = wagerPayouts(10, 6, 6);
    expect(odd.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('registers four wager modes in MODES with the wager playlist', () => {
    expect(WAGER_MODES.map((m) => m.id)).toEqual(['oitc', 'gungame', 'sharpshooter', 'sticks']);
    for (const m of WAGER_MODES) expect(MODE_BY_ID.get(m.id)?.playlist).toBe('wager');
  });
});

describe('store', () => {
  it('lists weapons, attachments, camos, reticles and emblems, but no wager-only weapons', () => {
    const items = storeCatalog();
    for (const kind of ['weapon', 'attachment', 'camo', 'reticle', 'emblem']) expect(items.some((i) => i.kind === kind), kind).toBe(true);
    for (const id of WAGER_ONLY_WEAPONS) expect(storeItem(keyOf.weapon(id))).toBeUndefined();
    expect(storeItem(keyOf.weapon('ak47'))?.free).toBe(true);
    expect(storeItem(keyOf.attachment('ak47', 'reddot'))?.free).toBe(true);
    expect(CAMOS.length).toBeGreaterThanOrEqual(16);
  });

  it('level-gates weapons, then sells them once', () => {
    const p = newProfile('p', 'Buyer');
    p.codPoints = 5000;
    const key = keyOf.weapon('testgun');
    expect(lockReason(p, key)).toBe('level');
    expect(purchase(p, key)).toEqual({ ok: false, reason: 'level' });
    p.level = 5;
    expect(lockReason(p, key)).toBeNull();
    const r = purchase(p, key);
    expect(r.ok).toBe(true);
    expect(p.codPoints).toBe(3000);
    expect(p.owned).toContain(key);
    expect(purchase(p, key)).toEqual({ ok: false, reason: 'owned' });
    expect(canUse(p, key)).toBe(true);
  });

  it('needs the weapon before its attachments, and checks funds at the moment of spending', () => {
    const p = newProfile('p', 'Buyer');
    p.level = 10;
    p.codPoints = 2500;
    const att = keyOf.attachment('testgun', 'extmag');
    expect(lockReason(p, att)).toBe('weapon');
    expect(purchase(p, keyOf.weapon('testgun')).ok).toBe(true);
    // Extended Mag needs weapon kills (weapons area's AttachmentDef.unlockKills).
    const need = ATTACHMENT_BY_ID.get('extmag')?.unlockKills ?? 0;
    if (need > 0) {
      expect(lockReason(p, att)).toBe('kills');
      p.stats['weapon.testgun.kills'] = need;
    }
    expect(lockReason(p, att)).toBe('funds');
    const price = storeItem(att)!.price;
    p.codPoints = price - 1;
    expect(lockReason(p, att)).toBe('funds');
    p.codPoints = price;
    expect(purchase(p, att).ok).toBe(true);
    expect(p.codPoints).toBe(0);
  });

  it('gates camos by level/prestige and prices Gold high', () => {
    const p = newProfile('p', 'Buyer');
    p.codPoints = 1e6;
    expect(lockReason(p, keyOf.camo('woodland'))).toBe('level');
    p.level = 2;
    expect(purchase(p, keyOf.camo('woodland')).ok).toBe(true);
    expect(lockReason(p, keyOf.camo('gold'))).toBe('level');
    p.level = 44;
    expect(storeItem(keyOf.camo('gold'))!.price).toBe(50000);
    expect(purchase(p, keyOf.camo('gold')).ok).toBe(true);
    expect(lockReason(p, keyOf.camo('ice'))).toBe('prestige');
    p.prestige = 1;
    p.level = 1;
    expect(lockReason(p, keyOf.camo('ice'))).toBeNull();
    expect(lockReason(p, 'nope.nothing')).toBe('unknown');
  });

  it('strips unowned weapons, attachments, camos and wager-only weapons from a class', () => {
    const p = newProfile('p', 'Player');
    p.level = 50;
    const l = cloneLoadout(DEFAULT_LOADOUTS[0]!);
    l.primary = { weapon: 'testgun', attachments: ['extmag'], camo: 'tiger' };
    let r = enforceLoadout(p, l);
    expect(r.loadout.primary.weapon).toBe('ak47');
    expect(r.loadout.primary.camo).toBe('none');
    expect(r.changed).toContain('weapon.testgun');
    p.owned.push('weapon.testgun', 'camo.tiger');
    r = enforceLoadout(p, l);
    expect(r.loadout.primary).toEqual({ weapon: 'testgun', attachments: [], camo: 'tiger' });
    expect(r.changed).toEqual(['att.testgun.extmag']);
    l.primary = { weapon: 'crossbow', attachments: [], camo: 'none' };
    expect(enforceLoadout(p, l).loadout.primary.weapon).toBe('ak47');
    // Starter classes always pass untouched.
    for (const d of DEFAULT_LOADOUTS) expect(enforceLoadout(newProfile('x', 'y'), d).changed).toEqual([]);
    // ...even when a starter attachment has a kill gate a fresh profile hasn't met.
    for (const d of DEFAULT_LOADOUTS)
      for (const a of d.primary.attachments) expect(canUse(newProfile('x', 'y'), keyOf.attachment(d.primary.weapon, a))).toBe(true);
  });
});

describe('wager lobby bot settings', () => {
  it('clamps untrusted requests to mode limits and slider ranges', () => {
    const s = sanitizeBots('oitc', { fill: true, difficulty: 'custom', custom: { reactionMs: 5, aimErrorDeg: 99, headshotBias: 0.5 }, variance: 3, targetPlayers: 50 });
    expect(s.targetPlayers).toBe(6);
    expect(s.variance).toBe(1);
    expect(s.custom!.reactionMs).toBe(BOT_SKILL_RANGES.reactionMs[0]);
    expect(s.custom!.aimErrorDeg).toBe(BOT_SKILL_RANGES.aimErrorDeg[1]);
    expect(s.custom!.headshotBias).toBe(0.5);
    expect(sanitizeBots('gungame', { difficulty: 'bogus' })).toMatchObject({ fill: true, difficulty: 'regular', targetPlayers: 8 });
    expect(sanitizeBots('sticks', { fill: false }).fill).toBe(false);
  });

  it('jitters each bot within the ranges, and not at all with variance 0', () => {
    const base = skillFor({ fill: true, targetPlayers: 8, difficulty: 'veteran', variance: 0 });
    expect(jitterSkill(base, 0)).toEqual(base);
    let n = 0;
    const rnd = () => (n++ % 2 ? 0 : 1);
    const j = jitterSkill(base, 1, rnd);
    expect(j).not.toEqual(base);
    for (const k of Object.keys(BOT_SKILL_RANGES) as (keyof typeof base)[]) {
      expect(j[k]).toBeGreaterThanOrEqual(BOT_SKILL_RANGES[k][0]);
      expect(j[k]).toBeLessThanOrEqual(BOT_SKILL_RANGES[k][1]);
    }
  });
});
