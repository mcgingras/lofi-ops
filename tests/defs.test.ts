import { describe, expect, it } from 'vitest';
import { effectiveWeapon } from '../src/shared/defs/attachments';
import { CHALLENGES } from '../src/shared/defs/challenges';
import { KILLSTREAKS } from '../src/shared/defs/killstreaks';
import { MAPS } from '../src/shared/defs/maps';
import { MODES } from '../src/shared/defs/modes';
import { PERKS } from '../src/shared/defs/perks';
import { addXp, applyPrestige, levelForXp, MAX_LEVEL, XP_TABLE, xpForLevel } from '../src/shared/defs/progression';
import { WEAPON_BY_ID, WEAPONS } from '../src/shared/defs/weapons';
import { DEFAULT_LOADOUTS, sanitizeLoadout } from '../src/shared/loadout';
import { damageAtRange, spreadDirection } from '../src/shared/ballistics';
import { newProfile } from '../src/shared/profile';

describe('defs', () => {
  it('registries are seeded and cross-reference', () => {
    expect(WEAPONS.length).toBeGreaterThan(0);
    expect(PERKS.length).toBeGreaterThan(0);
    expect(KILLSTREAKS.length).toBeGreaterThan(0);
    for (const m of MAPS) for (const mode of m.modes) expect(MODES.some((x) => x.id === mode), `${m.id}/${mode}`).toBe(true);
    for (const c of CHALLENGES) if (c.mode) expect(MODES.some((x) => x.id === c.mode)).toBe(true);
    for (const l of DEFAULT_LOADOUTS) expect(sanitizeLoadout(l)).toEqual(l);
  });

  it('attachments fold into effective stats', () => {
    const ak = WEAPON_BY_ID.get('ak47')!;
    expect(effectiveWeapon(ak, ['extmag']).magazine).toBe(45);
    expect(effectiveWeapon(ak, ['nonsense']).magazine).toBe(30);
  });

  it('damage falls off linearly', () => {
    const ak = WEAPON_BY_ID.get('ak47')!;
    expect(damageAtRange(ak, 5)).toBe(40);
    expect(damageAtRange(ak, 100)).toBe(30);
    expect(damageAtRange(ak, (ak.damage.nearRange + ak.damage.farRange) / 2)).toBeCloseTo(35);
  });

  it('spread is deterministic and inside the cone', () => {
    const d = { x: 0, y: 0, z: -1 };
    const a = spreadDirection(d, 4, 1234);
    expect(spreadDirection(d, 4, 1234)).toEqual(a);
    expect(Math.acos(-a.z) * (180 / Math.PI)).toBeLessThanOrEqual(4.0001);
  });

  it('sanitizes untrusted loadouts', () => {
    const l = sanitizeLoadout({ name: 'x'.repeat(50), primary: { weapon: 'm1911', attachments: [] }, secondary: { weapon: 'm1911', attachments: ['extmag', 'extmag', 5] }, perks: ['lightweight', 'bogus'], killstreaks: 'uav' });
    expect(l.primary.weapon).toBe('ak47'); // pistol not allowed as primary
    expect(l.secondary.attachments).toEqual(['extmag']);
    expect(l.perks).toEqual(['lightweight']);
    expect(l.killstreaks).toEqual([]);
    expect(l.name.length).toBe(24);
  });
});

describe('progression', () => {
  it('has a 1-50 XP table', () => {
    expect(XP_TABLE[1]).toBe(0);
    expect(XP_TABLE[2]).toBe(800);
    expect(xpForLevel(MAX_LEVEL)).toBe(1274000);
    for (let l = 2; l <= MAX_LEVEL; l++) expect(XP_TABLE[l]!).toBeGreaterThan(XP_TABLE[l - 1]!);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(799)).toBe(1);
    expect(levelForXp(800)).toBe(2);
    expect(levelForXp(1e9)).toBe(MAX_LEVEL);
  });

  it('levels up and prestiges', () => {
    const p = newProfile('id', 'Tester');
    p.unlocks = ['ak47'];
    expect(addXp(p, 2000)).toEqual([2]);
    expect(applyPrestige(p).prestige).toBe(0); // not level 50 yet
    addXp(p, 2e6);
    expect(p.level).toBe(MAX_LEVEL);
    const cp = p.codPoints;
    applyPrestige(p);
    expect(p).toMatchObject({ prestige: 1, level: 1, xp: 0, codPoints: cp });
    expect(p.unlocks).toEqual(['prestige_1']);
  });
});
