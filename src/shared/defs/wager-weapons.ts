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
    // BO1: explosive-tip bolts, a projectile with travel time and drop. A direct hit does 50, sticks
    // and the explosion kills whoever it's stuck to; otherwise 200-75 in 4 m (STICKS.bolt). 1 loaded
    // + 5 spare = 6 bolts (the user's Sticks and Stones rule; BO1 MP spawns 1 + 2). Reload 2.75 s.
    id: 'crossbow',
    name: 'Crossbow',
    class: 'special',
    slot: 'primary',
    // Not hitscan: the numbers are only the direct-impact damage for stat bars (the server's
    // weapon behaviour does the bolt).
    damage: { near: 50, far: 50, nearRange: 100, farRange: 100 },
    multipliers: { head: 1, torso: 1, limb: 1 },
    rpm: 70,
    mode: 'semi',
    magazine: 1,
    reserve: 5,
    reloadMs: 2750,
    reloadEmptyMs: 2750,
    adsMs: 250,
    sprintOutMs: 300,
    moveMult: 1,
    spread: { hip: 1.5, ads: 0.1, move: 1 },
    recoil: { vertical: 2.2, horizontal: 0.3, recovery: 10 },
    unlockLevel: 1,
    attachments: [],
    model: 'crossbow',
    zoom: 2,
    projectile: true,
    ammoNoun: 'BOLTS',
  },
  {
    // BO1: fires its blade on a slow parabolic arc, a flat 250 (one hit anywhere on the body).
    // 1 loaded + 1 spare. Fired blades stay in the world and can be picked back up (economy
    // projectiles.ts). Reload 1.5 s. The knife (melee button) still stabs with it in hand.
    id: 'ballistic_knife',
    name: 'Ballistic Knife',
    class: 'special',
    slot: 'secondary',
    damage: { near: 250, far: 250, nearRange: 100, farRange: 100 },
    multipliers: { head: 1, torso: 1, limb: 1 },
    rpm: 60,
    mode: 'semi',
    magazine: 1,
    reserve: 1,
    reloadMs: 1500,
    reloadEmptyMs: 1500,
    adsMs: 150,
    sprintOutMs: 120,
    moveMult: 1.05,
    spread: { hip: 1, ads: 0.3, move: 0.8 },
    recoil: { vertical: 1, horizontal: 0.2, recovery: 14 },
    unlockLevel: 1,
    attachments: [],
    model: 'ballistic_knife',
    swapMs: 300,
    projectile: true,
    ammoNoun: 'BLADES',
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
