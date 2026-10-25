/**
 * Every weapon class reaches every place that switches on `WeaponDef.class`. Tables typed
 * `Record<WeaponClass, ...>` are already checked by the compiler (Blackout ammo, distant-shot pitch,
 * bot and Blackout fighting styles, unlock and challenge labels, and on the client the shot tone and
 * the Create-a-Class headings); this walks `WEAPON_CLASSES` over them anyway, plus the string-keyed
 * and fallback sites a new class could silently miss (Zombies damage, penetration, store groups,
 * Sharpshooter, generated challenges, bot loadouts).
 */
import { describe, expect, it } from 'vitest';
import { CLASS_STYLE } from '../src/server/features/bots/brain';
import { chooseBotLoadout } from '../src/server/features/bots/loadout';
import { STYLE } from '../src/server/features/blackout/brain';
import { AMMO_OF_CLASS } from '../src/shared/defs/blackout';
import { challengeById, CLASS_NAMES } from '../src/shared/defs/challenges';
import { SHARPSHOOTER } from '../src/shared/defs/economy';
import { DISTANT_RATE } from '../src/shared/defs/sfx-recipes';
import { CLASS_LABEL } from '../src/shared/defs/unlocks';
import { WAGER_ONLY_WEAPONS } from '../src/shared/defs/wager-weapons';
import { LOADOUT_WEAPONS, WEAPON_CLASSES, WEAPONS, type WeaponClass } from '../src/shared/defs/weapons';
import { ZOMBIE_DAMAGE, ZOMBIE_PARTS } from '../src/shared/defs/zombies';
import { GUN_GROUPS, groupOfClass } from '../src/shared/frontend/store-browse';
import { penetrationType } from '../src/shared/penetration';

/** Classes of real guns (not the launcher slot or specials like the knife and wonder weapons). */
const GUN_CLASSES = WEAPON_CLASSES.filter((c) => c !== 'launcher' && c !== 'special');
/** Classes Create-a-Class actually offers a gun of. */
const CLASSABLE = new Set(LOADOUT_WEAPONS.filter((w) => !WAGER_ONLY_WEAPONS.has(w.id)).map((w) => w.class));

describe('weapon class coverage', () => {
  it('every weapon belongs to a listed class, and machine pistols are one', () => {
    for (const w of WEAPONS) expect(WEAPON_CLASSES, w.id).toContain(w.class);
    expect(WEAPON_CLASSES).toContain('machinepistol');
    expect(CLASSABLE.has('machinepistol')).toBe(true);
  });

  it.each(WEAPON_CLASSES.map((c) => [c]))('%s: every class table has a row', (c: WeaponClass) => {
    expect(CLASS_NAMES[c], 'challenges').toBeTruthy();
    expect(CLASS_LABEL[c], 'unlocks').toBeTruthy();
    expect(CLASS_STYLE[c], 'bot style').toBeDefined();
    expect(STYLE[c], 'blackout style').toBeDefined();
    expect(c in AMMO_OF_CLASS, 'blackout ammo').toBe(true);
    expect(Math.abs(DISTANT_RATE[c] - 1), 'distant shot pitch').toBeLessThanOrEqual(0.06 + 1e-9);
    // Zombies: string-keyed, so a missing class would fall back to x2.5 and the gun's own head.
    expect(ZOMBIE_DAMAGE.byClass[c], 'zombie damage').toBeGreaterThan(0);
    expect(ZOMBIE_PARTS.byClass[c], 'zombie parts').toBeDefined();
  });

  it.each(GUN_CLASSES.map((c) => [c]))('%s: gun classes penetrate, have ammo, a store group and Sharpshooter', (c: WeaponClass) => {
    // Penetration falls back to 'none' for an unknown class: a real gun must not.
    expect(penetrationType({ class: c }), 'penetration').not.toBe('none');
    expect(AMMO_OF_CLASS[c], 'blackout ammo').not.toBeNull();
    // The store's group lookup falls back to Launchers / Specials.
    expect(groupOfClass(c), 'store group').not.toBe('special');
    expect(GUN_GROUPS.filter((g) => g.classes.includes(c)), 'one store group').toHaveLength(1);
    if (CLASSABLE.has(c)) {
      expect(SHARPSHOOTER.classes, 'sharpshooter').toContain(c);
      expect(challengeById(`class_${c}_kills`)?.weaponClass, 'class challenge').toBe(c);
    }
  });

  it('bots carry a gun of every classable class (seeded)', () => {
    let s = 11;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const seen = new Set<string>();
    const byId = new Map(WEAPONS.map((w) => [w.id, w.class]));
    for (let i = 0; i < 4000; i++) {
      const l = chooseBotLoadout(0.8, rnd);
      seen.add(byId.get(l.primary.weapon)!);
      seen.add(byId.get(l.secondary.weapon)!);
    }
    for (const c of CLASSABLE) expect(seen.has(c), c).toBe(true);
  });
});
