/**
 * Wager-only weapons (owner: economy). Sticks and Stones needs a crossbow (explosive bolts) and a
 * ballistic knife, and both cap the Gun Game ladder. They are appended to WEAPONS / WEAPON_BY_ID
 * when this module loads (imported by economy.ts, which every side loads through profile.ts and
 * modes.ts). If the weapons area ships its own def with the same id, theirs wins and this one is
 * skipped. They never show in the store (see WAGER_ONLY_WEAPONS).
 */
import { WEAPON_BY_ID, WEAPONS, type WeaponDef } from './weapons';

export const WAGER_WEAPONS: WeaponDef[] = [
  {
    id: 'crossbow',
    name: 'Crossbow',
    class: 'special',
    slot: 'primary',
    // Damage applies only to a direct bolt hit (the server's weapon behaviour handles the explosion).
    damage: { near: 200, far: 200, nearRange: 100, farRange: 100 },
    multipliers: { head: 1, torso: 1, limb: 1 },
    rpm: 70,
    mode: 'semi',
    magazine: 1,
    reserve: 6,
    reloadMs: 1600,
    reloadEmptyMs: 1600,
    adsMs: 300,
    sprintOutMs: 300,
    moveMult: 0.95,
    spread: { hip: 3, ads: 0.1, move: 1.5 },
    recoil: { vertical: 2.2, horizontal: 0.3, recovery: 10 },
    unlockLevel: 1,
    attachments: [],
    model: 'crossbow',
    zoom: 2,
  },
  {
    id: 'ballistic_knife',
    name: 'Ballistic Knife',
    class: 'special',
    slot: 'secondary',
    damage: { near: 200, far: 200, nearRange: 22, farRange: 25 },
    multipliers: { head: 1, torso: 1, limb: 1 },
    rpm: 60,
    mode: 'semi',
    magazine: 1,
    reserve: 2,
    reloadMs: 1400,
    reloadEmptyMs: 1400,
    adsMs: 150,
    sprintOutMs: 120,
    moveMult: 1.05,
    spread: { hip: 2, ads: 0.4, move: 1 },
    recoil: { vertical: 1, horizontal: 0.2, recovery: 14 },
    unlockLevel: 1,
    attachments: [],
    model: 'ballistic_knife',
    range: 25,
    swapMs: 300,
  },
];

/** Ids registered here (wager modes only): never sold, never allowed in custom classes. */
export const WAGER_ONLY_WEAPONS = new Set<string>();

for (const w of WAGER_WEAPONS) {
  if (WEAPON_BY_ID.has(w.id)) continue;
  WEAPONS.push(w);
  (WEAPON_BY_ID as Map<string, WeaponDef>).set(w.id, w);
  WAGER_ONLY_WEAPONS.add(w.id);
}
