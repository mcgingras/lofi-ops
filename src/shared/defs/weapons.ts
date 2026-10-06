/**
 * Weapons (owner: weapons feature). Core seeds an AK-47 and an M1911 so everything type-checks
 * and the server can fight. Distances in metres, times in ms, spread in degrees.
 */
import { indexById } from './registry';

export type WeaponClass = 'ar' | 'smg' | 'lmg' | 'sniper' | 'shotgun' | 'pistol' | 'launcher' | 'special';
export type FireMode = 'auto' | 'semi' | 'burst' | 'bolt' | 'pump';

export interface WeaponDef {
  id: string;
  name: string;
  class: WeaponClass;
  /** Which loadout slot it goes in (pistols/launchers/specials: secondary). */
  slot: 'primary' | 'secondary';
  /** Damage per bullet (per pellet for shotguns): `near` up to nearRange, linear to `far` at farRange. */
  damage: { near: number; far: number; nearRange: number; farRange: number };
  multipliers: { head: number; torso: number; limb: number };
  /** Rounds per minute (within a burst for burst weapons). */
  rpm: number;
  mode: FireMode;
  /** Rounds per burst (mode 'burst'). */
  burst?: number;
  /** Pellets per shot (shotguns). */
  pellets?: number;
  magazine: number;
  /** Spare rounds carried at spawn. */
  reserve: number;
  reloadMs: number;
  reloadEmptyMs: number;
  adsMs: number;
  sprintOutMs: number;
  /** Movement speed multiplier while holding it. */
  moveMult: number;
  /** Cone half-angles in degrees: hip, fully aimed, extra while moving. */
  spread: { hip: number; ads: number; move: number };
  /** Client view kick per shot (degrees) and recovery speed (deg/s). Server ignores recoil. */
  recoil: { vertical: number; horizontal: number; recovery: number };
  unlockLevel: number;
  /** Attachment ids this weapon accepts (see attachments.ts). */
  attachments: string[];
  /** Viewmodel/worldmodel id the client builds (render/ models registry). */
  model: string;
  /** Max hitscan range (default 200 m). */
  range?: number;
  /** Weapon raise/lower time when switching (default 500 ms). */
  swapMs?: number;
  /** ADS field-of-view zoom factor (default 1.15; snipers ~4). */
  zoom?: number;
  /** Shows a full-screen scope overlay when aimed (snipers, variable zoom). */
  scope?: boolean;
  /** CoD Points price in the store (economy), if bought rather than only level-unlocked. */
  price?: number;
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 'ak47',
    name: 'AK-47',
    class: 'ar',
    slot: 'primary',
    damage: { near: 40, far: 30, nearRange: 30, farRange: 55 },
    multipliers: { head: 1.4, torso: 1, limb: 1 },
    rpm: 600,
    mode: 'auto',
    magazine: 30,
    reserve: 120,
    reloadMs: 2600,
    reloadEmptyMs: 3300,
    adsMs: 250,
    sprintOutMs: 250,
    moveMult: 0.95,
    spread: { hip: 4, ads: 0.15, move: 1.5 },
    recoil: { vertical: 1.1, horizontal: 0.45, recovery: 12 },
    unlockLevel: 1,
    attachments: ['reddot', 'extmag'],
    model: 'ak47',
  },
  {
    id: 'm1911',
    name: 'M1911',
    class: 'pistol',
    slot: 'secondary',
    damage: { near: 40, far: 25, nearRange: 10, farRange: 25 },
    multipliers: { head: 1.4, torso: 1, limb: 1 },
    rpm: 625,
    mode: 'semi',
    magazine: 8,
    reserve: 32,
    reloadMs: 1650,
    reloadEmptyMs: 2000,
    adsMs: 150,
    sprintOutMs: 150,
    moveMult: 1,
    spread: { hip: 3, ads: 0.4, move: 1 },
    recoil: { vertical: 1.6, horizontal: 0.5, recovery: 14 },
    unlockLevel: 1,
    attachments: ['extmag'],
    model: 'm1911',
    swapMs: 350,
  },
];

export const WEAPON_BY_ID = indexById(WEAPONS);
