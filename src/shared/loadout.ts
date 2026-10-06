/**
 * Loadouts (create-a-class). Owner of the editor: frontend; unlock rules: progression/economy.
 * Core uses a player's selected loadout at spawn (after `beforeSpawn` handlers may adjust it).
 */
import { WEAPON_BY_ID } from './defs/weapons';
import { PERK_BY_ID } from './defs/perks';
import { KILLSTREAK_BY_ID } from './defs/killstreaks';
import { CAMO_BY_ID } from './defs/camos';

export interface WeaponLoadout {
  weapon: string;
  attachments: string[];
  camo: string;
}

export interface Loadout {
  name: string;
  primary: WeaponLoadout;
  secondary: WeaponLoadout;
  /** Up to one perk id per tier (index 0 = tier 1). */
  perks: string[];
  /** Up to three killstreak ids. */
  killstreaks: string[];
  lethal: string | null;
  tactical: string | null;
}

const w = (weapon: string, attachments: string[] = []): WeaponLoadout => ({ weapon, attachments, camo: 'none' });

/** Default classes every profile starts with. */
export const DEFAULT_LOADOUTS: Loadout[] = [
  { name: 'Assault', primary: w('ak47'), secondary: w('m1911'), perks: ['lightweight', 'steady_aim'], killstreaks: ['uav'], lethal: null, tactical: null },
  { name: 'Rifleman', primary: w('ak47', ['reddot']), secondary: w('m1911'), perks: ['hardline', 'steady_aim'], killstreaks: ['uav'], lethal: null, tactical: null },
  { name: 'Run and Gun', primary: w('ak47', ['extmag']), secondary: w('m1911'), perks: ['lightweight'], killstreaks: ['uav'], lethal: null, tactical: null },
];

export const cloneLoadout = (l: Loadout): Loadout => JSON.parse(JSON.stringify(l)) as Loadout;

/**
 * Structural clean-up of an untrusted loadout: unknown ids dropped or replaced with defaults,
 * attachments limited to the weapon's list. Unlock/ownership checks are NOT done here (features
 * do that in a `beforeSpawn` handler or their RPCs).
 */
export function sanitizeLoadout(input: unknown, fallback: Loadout = DEFAULT_LOADOUTS[0]!): Loadout {
  const src = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof Loadout, unknown>>;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const weapon = (v: unknown, fb: WeaponLoadout, slot: 'primary' | 'secondary'): WeaponLoadout => {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    const id = str(o.weapon);
    const def = id ? WEAPON_BY_ID.get(id) : undefined;
    if (!def || def.slot !== slot) return { ...fb, attachments: [...fb.attachments] };
    const atts = Array.isArray(o.attachments) ? o.attachments.filter((a): a is string => typeof a === 'string' && def.attachments.includes(a)).slice(0, 2) : [];
    const camo = str(o.camo);
    return { weapon: def.id, attachments: [...new Set(atts)], camo: camo && CAMO_BY_ID.has(camo) ? camo : 'none' };
  };
  const ids = (v: unknown, ok: (id: string) => boolean, max: number) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && ok(x)))].slice(0, max) : []);
  return {
    name: (str(src.name) ?? fallback.name).slice(0, 24),
    primary: weapon(src.primary, fallback.primary, 'primary'),
    secondary: weapon(src.secondary, fallback.secondary, 'secondary'),
    perks: ids(src.perks, (id) => PERK_BY_ID.has(id), 3),
    killstreaks: ids(src.killstreaks, (id) => KILLSTREAK_BY_ID.has(id), 3),
    lethal: str(src.lethal),
    tactical: str(src.tactical),
  };
}
