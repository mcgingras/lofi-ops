/**
 * Weapons (owner: weapons feature). Black Ops 1 inspired stats scaled to 100 health. Distances in
 * metres (BO1 inches / 39.4, rounded), times in ms, spread in degrees.
 *
 * Slots: `primary` / `secondary` are create-a-class picks. `melee` (the knife) and `attachment`
 * (the underbarrel grenade launcher, given as an extra weapon slot by the GL attachment) live here
 * so killfeed names, sounds and models resolve, but are never valid loadout picks
 * (`sanitizeLoadout` requires the slot to match). Use `LOADOUT_WEAPONS` for create-a-class lists.
 *
 * Unlock levels follow BO1's create-a-class order loosely (exact BO1 levels are approximate);
 * the AK-47 stays at level 1 because core's DEFAULT_LOADOUTS use it.
 */
import { damageAtRange, partMultiplier } from '../ballistics';
import type { HitPart } from '../collision';
import type { PenetrationType } from '../penetration';
import { indexById } from './registry';

export type WeaponClass = 'ar' | 'smg' | 'lmg' | 'sniper' | 'shotgun' | 'pistol' | 'launcher' | 'special';
export type FireMode = 'auto' | 'semi' | 'burst' | 'bolt' | 'pump';
export type WeaponSlot = 'primary' | 'secondary' | 'melee' | 'attachment';

export interface WeaponDef {
  id: string;
  name: string;
  class: WeaponClass;
  /** Which loadout slot it goes in (pistols/launchers/specials: secondary). See file comment. */
  slot: WeaponSlot;
  /** Damage per bullet (per pellet for shotguns): `near` up to nearRange, linear to `far` at farRange. */
  damage: { near: number; far: number; nearRange: number; farRange: number };
  /**
   * Hit-part multipliers. `lowerTorso` (optional) applies to torso hits below the middle of the
   * torso box (BO1's upper/lower chest split, used by snipers); otherwise `torso` applies.
   */
  multipliers: { head: number; torso: number; limb: number; lowerTorso?: number };
  /** Rounds per minute (within a burst for burst weapons; bolt/pump: the cycle rate). */
  rpm: number;
  mode: FireMode;
  /** Rounds per burst (mode 'burst'). */
  burst?: number;
  /** Minimum time between the last round of a burst and the next burst (mode 'burst'). */
  burstDelayMs?: number;
  /** Pellets per shot (shotguns). */
  pellets?: number;
  magazine: number;
  /** Spare rounds carried at spawn. */
  reserve: number;
  reloadMs: number;
  reloadEmptyMs: number;
  /**
   * Shell-by-shell reload (pump/semi shotguns): `startMs` to open, `perShellMs` per shell, `endMs`
   * to close (plus `pumpMs` when the tube was empty). The server inserts shells one at a time and
   * firing (holding the trigger) cancels the reload with the shells loaded so far.
   */
  shellReload?: { startMs: number; perShellMs: number; endMs: number; pumpMs?: number };
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
  /**
   * How far its bullets go through walls (`shared/penetration.ts`). Default by class, as BO1's
   * `penetrateType`: pistols and SMGs small, ARs and LMGs medium, snipers large, shotguns pellet,
   * the rest none.
   */
  penetration?: PenetrationType;
  /** Weapon raise/lower time when switching (default 500 ms). */
  swapMs?: number;
  /** Fires a server-simulated projectile (crossbow bolt, ballistic knife blade): no local hitscan tracer or impact puff. */
  projectile?: boolean;
  /** HUD noun for single-load weapons that count their ammo out loud ('BOLTS', 'BLADES'). */
  ammoNoun?: string;
  /** ADS field-of-view zoom factor (default 1.15; snipers ~4). */
  zoom?: number;
  /** Shows a full-screen scope overlay when aimed (snipers, variable zoom). */
  scope?: boolean;
  /** Scope sway amplitude in degrees while scoped (hold breath on Shift steadies it). */
  sway?: number;
  /** Seconds the breath can be held before the sway gets worse (default 4). */
  breathSec?: number;
  /** CoD Points price in the store (economy), if bought rather than only level-unlocked. */
  price?: number;
  /** One-line description for menus. */
  blurb?: string;
  /**
   * A BO1 Zombies wonder weapon (Ray Gun, Thundergun, Wunderwaffe DG-2, Winter's Howl, Scavenger,
   * 31-79 JGb215, Wave Gun): only from
   * the Mystery Box killstreak (and dropped ones picked up). Never in create-a-class, the store,
   * unlocks or bot classes. Behaviour: `defs/wonder.ts` and the weapons server's `wonder/`.
   */
  wonder?: boolean;
}

// Shared attachment lists (BO1 availability per class; specific guns adjust below).
const AR_ATTS = ['extmag', 'dualmag', 'acog', 'reddot', 'reflex', 'suppressor', 'gl'];
const SMG_ATTS = ['extmag', 'dualmag', 'acog', 'reddot', 'reflex', 'suppressor', 'rapidfire'];
const SNIPER_ATTS = ['extmag', 'acog', 'varzoom', 'suppressor'];
// MW2 rifles: Holographic -> reflex, Red Dot, ACOG, Silencer, Extended Mags, M203 (no FMJ, Shotgun,
// Heartbeat or Thermal equivalents here).
const MW2_AR_ATTS = ['extmag', 'acog', 'reddot', 'reflex', 'suppressor', 'gl'];

const ar = (o: Omit<WeaponDef, 'class' | 'slot' | 'multipliers' | 'sprintOutMs'> & Partial<Pick<WeaponDef, 'multipliers' | 'sprintOutMs'>>): WeaponDef => ({ class: 'ar', slot: 'primary', multipliers: { head: 1.4, torso: 1, limb: 1 }, sprintOutMs: 250, ...o });
const smg = (o: Omit<WeaponDef, 'class' | 'slot' | 'multipliers' | 'sprintOutMs'> & Partial<Pick<WeaponDef, 'multipliers' | 'sprintOutMs'>>): WeaponDef => ({ class: 'smg', slot: 'primary', multipliers: { head: 1.4, torso: 1, limb: 1 }, sprintOutMs: 200, ...o });
const pistol = (o: Omit<WeaponDef, 'class' | 'slot' | 'multipliers' | 'sprintOutMs' | 'swapMs'> & Partial<Pick<WeaponDef, 'multipliers' | 'sprintOutMs' | 'swapMs'>>): WeaponDef => ({ class: 'pistol', slot: 'secondary', multipliers: { head: 1.4, torso: 1, limb: 1 }, sprintOutMs: 150, swapMs: 350, ...o });

export const WEAPONS: WeaponDef[] = [
  // ------------------------------------------------------------------ assault rifles
  ar({
    id: 'm16',
    name: 'M16',
    blurb: 'Three-round burst. One burst kills up close.',
    damage: { near: 40, far: 30, nearRange: 30, farRange: 55 },
    rpm: 937,
    mode: 'burst',
    burst: 3,
    burstDelayMs: 200,
    magazine: 30,
    reserve: 120,
    reloadMs: 2030,
    reloadEmptyMs: 2630,
    adsMs: 250,
    moveMult: 0.95,
    spread: { hip: 3.5, ads: 0.12, move: 1.5 },
    recoil: { vertical: 0.75, horizontal: 0.25, recovery: 14 },
    unlockLevel: 1,
    attachments: AR_ATTS,
    model: 'm16',
    price: 0,
  }),
  ar({
    id: 'famas',
    name: 'FAMAS',
    blurb: 'Fully automatic with a blistering rate of fire and light kick.',
    damage: { near: 30, far: 20, nearRange: 28, farRange: 50 },
    rpm: 800,
    mode: 'auto',
    magazine: 30,
    reserve: 120,
    reloadMs: 2500,
    reloadEmptyMs: 3100,
    adsMs: 250,
    moveMult: 0.95,
    spread: { hip: 3.5, ads: 0.12, move: 1.5 },
    recoil: { vertical: 0.55, horizontal: 0.3, recovery: 15 },
    unlockLevel: 1,
    attachments: AR_ATTS,
    model: 'famas',
    price: 0,
  }),
  ar({
    id: 'ak47',
    name: 'AK-47',
    blurb: 'Hard-hitting automatic rifle with heavy recoil.',
    damage: { near: 40, far: 30, nearRange: 30, farRange: 55 },
    rpm: 600,
    mode: 'auto',
    magazine: 30,
    reserve: 120,
    reloadMs: 2600,
    reloadEmptyMs: 3300,
    adsMs: 250,
    moveMult: 0.95,
    spread: { hip: 4, ads: 0.15, move: 1.5 },
    recoil: { vertical: 1.1, horizontal: 0.45, recovery: 12 },
    unlockLevel: 1,
    attachments: AR_ATTS,
    model: 'ak47',
    price: 2000,
  }),
  ar({
    id: 'commando',
    name: 'Commando',
    blurb: 'Short-barrel carbine: fast fire, tame recoil, shorter range.',
    damage: { near: 40, far: 30, nearRange: 24, farRange: 45 },
    rpm: 750,
    mode: 'auto',
    magazine: 30,
    reserve: 120,
    reloadMs: 2200,
    reloadEmptyMs: 2800,
    adsMs: 230,
    moveMult: 0.95,
    spread: { hip: 3.5, ads: 0.15, move: 1.5 },
    recoil: { vertical: 0.8, horizontal: 0.4, recovery: 14 },
    unlockLevel: 14,
    attachments: AR_ATTS,
    model: 'commando',
    price: 2500,
  }),
  ar({
    id: 'galil',
    name: 'Galil',
    blurb: 'Heavy, accurate rifle with a 35-round magazine.',
    damage: { near: 40, far: 30, nearRange: 32, farRange: 58 },
    rpm: 750,
    mode: 'auto',
    magazine: 35,
    reserve: 140,
    reloadMs: 2900,
    reloadEmptyMs: 3500,
    adsMs: 300,
    moveMult: 0.9,
    spread: { hip: 4.2, ads: 0.12, move: 1.8 },
    recoil: { vertical: 0.7, horizontal: 0.25, recovery: 13 },
    unlockLevel: 17,
    attachments: AR_ATTS,
    model: 'galil',
    price: 3000,
  }),
  ar({
    id: 'aug',
    name: 'AUG',
    blurb: 'Bullpup rifle with very low recoil.',
    damage: { near: 40, far: 30, nearRange: 30, farRange: 55 },
    rpm: 680,
    mode: 'auto',
    magazine: 30,
    reserve: 120,
    reloadMs: 2700,
    reloadEmptyMs: 3300,
    adsMs: 270,
    moveMult: 0.95,
    spread: { hip: 3.8, ads: 0.12, move: 1.5 },
    recoil: { vertical: 0.6, horizontal: 0.2, recovery: 15 },
    unlockLevel: 26,
    attachments: AR_ATTS,
    model: 'aug',
    price: 3000,
  }),

  // MW2 additions (multiplayer weapon files and the CoD Wiki; see docs/features/weapons.md). Ranges
  // are MW2 inches / 39.4 like the BO1 guns; reserve is MW2's starting ammo; no Dual Mag or Grip
  // (MW2 had neither on these rifles).
  ar({
    id: 'acr',
    name: 'ACR',
    blurb: 'Full auto with almost no recoil. Lower damage, but it holds it at long range.',
    damage: { near: 30, far: 20, nearRange: 46, farRange: 58 },
    rpm: 789,
    mode: 'auto',
    magazine: 30,
    reserve: 60,
    reloadMs: 2030,
    reloadEmptyMs: 2360,
    adsMs: 250,
    sprintOutMs: 300,
    moveMult: 0.9,
    spread: { hip: 3.2, ads: 0.1, move: 1.5 },
    recoil: { vertical: 0.42, horizontal: 0.14, recovery: 17 },
    unlockLevel: 48,
    attachments: MW2_AR_ATTS,
    model: 'acr',
    price: 3000,
  }),
  ar({
    id: 'm16a4',
    name: 'M16A4',
    blurb: 'Modern Warfare 2 flat-top M16: three-round bursts, one burst kills out to mid range.',
    damage: { near: 40, far: 30, nearRange: 38, farRange: 51 },
    rpm: 937,
    mode: 'burst',
    burst: 3,
    // MW2: 64 ms fireTime + 200 ms burst cooldown after the last round (459 rpm overall).
    burstDelayMs: 264,
    magazine: 30,
    reserve: 60,
    reloadMs: 2030,
    reloadEmptyMs: 2360,
    adsMs: 250,
    sprintOutMs: 300,
    moveMult: 0.9,
    spread: { hip: 3.6, ads: 0.12, move: 1.5 },
    recoil: { vertical: 0.68, horizontal: 0.3, recovery: 14 },
    unlockLevel: 40,
    attachments: MW2_AR_ATTS,
    model: 'm16a4',
    price: 3000,
  }),

  // ------------------------------------------------------------------ submachine guns
  smg({
    id: 'mp5k',
    name: 'MP5K',
    blurb: 'Compact SMG with a solid rate of fire.',
    damage: { near: 40, far: 20, nearRange: 10, farRange: 22 },
    rpm: 750,
    mode: 'auto',
    magazine: 30,
    reserve: 120,
    reloadMs: 2300,
    reloadEmptyMs: 2900,
    adsMs: 200,
    moveMult: 1,
    spread: { hip: 2.8, ads: 0.5, move: 1 },
    recoil: { vertical: 0.7, horizontal: 0.45, recovery: 16 },
    unlockLevel: 1,
    attachments: SMG_ATTS,
    model: 'mp5k',
    price: 0,
  }),
  smg({
    id: 'ak74u',
    name: 'AK74u',
    blurb: 'Fast-firing carbine SMG that holds its damage further out.',
    damage: { near: 40, far: 20, nearRange: 12, farRange: 25 },
    rpm: 800,
    mode: 'auto',
    magazine: 20,
    reserve: 120,
    reloadMs: 2200,
    reloadEmptyMs: 2800,
    adsMs: 200,
    moveMult: 1,
    spread: { hip: 3, ads: 0.45, move: 1 },
    recoil: { vertical: 0.8, horizontal: 0.4, recovery: 15 },
    unlockLevel: 4,
    attachments: [...SMG_ATTS, 'grip'],
    model: 'ak74u',
    price: 1500,
  }),
  smg({
    id: 'mpl',
    name: 'MPL',
    blurb: 'Very high rate of fire, low damage per round.',
    damage: { near: 35, far: 20, nearRange: 9, farRange: 20 },
    rpm: 937,
    mode: 'auto',
    magazine: 24,
    reserve: 120,
    reloadMs: 2100,
    reloadEmptyMs: 2700,
    adsMs: 190,
    moveMult: 1,
    spread: { hip: 2.8, ads: 0.55, move: 1 },
    recoil: { vertical: 0.55, horizontal: 0.4, recovery: 17 },
    unlockLevel: 26,
    attachments: SMG_ATTS,
    model: 'mpl',
    price: 2000,
  }),

  // ------------------------------------------------------------------ light machine gun
  {
    id: 'rpk',
    name: 'RPK',
    class: 'lmg',
    slot: 'primary',
    blurb: 'Light machine gun: big magazine, slow to aim and reload.',
    damage: { near: 40, far: 30, nearRange: 35, farRange: 60 },
    multipliers: { head: 1.4, torso: 1, limb: 1 },
    rpm: 750,
    mode: 'auto',
    magazine: 45,
    reserve: 135,
    reloadMs: 4400,
    reloadEmptyMs: 5200,
    adsMs: 400,
    sprintOutMs: 350,
    moveMult: 0.875,
    spread: { hip: 5, ads: 0.25, move: 2 },
    recoil: { vertical: 0.85, horizontal: 0.45, recovery: 12 },
    unlockLevel: 30,
    attachments: ['extmag', 'dualmag', 'acog', 'reddot', 'reflex', 'grip', 'suppressor'],
    model: 'rpk',
    price: 3000,
  },

  // ------------------------------------------------------------------ sniper rifles
  {
    id: 'l96a1',
    name: 'L96A1',
    class: 'sniper',
    slot: 'primary',
    blurb: 'Bolt-action. One shot to the head or upper chest at any range.',
    damage: { near: 70, far: 70, nearRange: 100, farRange: 200 },
    multipliers: { head: 1.5, torso: 1.5, lowerTorso: 1.1, limb: 1 },
    rpm: 41,
    mode: 'bolt',
    magazine: 5,
    reserve: 20,
    reloadMs: 3000,
    reloadEmptyMs: 3900,
    adsMs: 350,
    sprintOutMs: 400,
    moveMult: 0.9,
    spread: { hip: 10, ads: 0, move: 3 },
    recoil: { vertical: 4, horizontal: 1, recovery: 8 },
    unlockLevel: 1,
    attachments: SNIPER_ATTS,
    model: 'l96a1',
    range: 300,
    zoom: 4.5,
    scope: true,
    sway: 0.9,
    breathSec: 5,
    swapMs: 650,
    price: 0,
  },
  {
    id: 'dragunov',
    name: 'Dragunov',
    class: 'sniper',
    slot: 'primary',
    blurb: 'Semi-automatic sniper. Two to the body, one to the head.',
    damage: { near: 50, far: 50, nearRange: 100, farRange: 200 },
    multipliers: { head: 2, torso: 1.2, lowerTorso: 1, limb: 1 },
    rpm: 240,
    mode: 'semi',
    magazine: 10,
    reserve: 30,
    reloadMs: 2900,
    reloadEmptyMs: 3500,
    adsMs: 400,
    sprintOutMs: 400,
    moveMult: 0.9,
    spread: { hip: 10, ads: 0, move: 3 },
    recoil: { vertical: 2.6, horizontal: 0.8, recovery: 9 },
    unlockLevel: 14,
    attachments: SNIPER_ATTS,
    model: 'dragunov',
    range: 300,
    zoom: 4,
    scope: true,
    sway: 1.1,
    breathSec: 4,
    swapMs: 650,
    price: 2500,
  },
  {
    // MW2's CheyTac M200. Same kill profile as the L96A1 (70 x1.5 head / upper chest, x1.1 stomach),
    // but a quicker bolt and partial reload, quicker out of a sprint; slower to scope from a
    // standstill, heavier kick, more sway, less ammo.
    id: 'intervention',
    name: 'Intervention',
    class: 'sniper',
    slot: 'primary',
    blurb: 'Bolt-action .408. One shot to the head or upper chest, quick bolt, heavy kick.',
    damage: { near: 70, far: 70, nearRange: 102, farRange: 200 },
    multipliers: { head: 1.5, torso: 1.5, lowerTorso: 1.1, limb: 1 },
    rpm: 65,
    mode: 'bolt',
    magazine: 5,
    reserve: 15,
    reloadMs: 2270,
    reloadEmptyMs: 3870,
    adsMs: 400,
    sprintOutMs: 300,
    moveMult: 0.9,
    spread: { hip: 11, ads: 0, move: 3 },
    recoil: { vertical: 5, horizontal: 1.4, recovery: 6 },
    unlockLevel: 4,
    attachments: SNIPER_ATTS,
    model: 'intervention',
    range: 300,
    zoom: 4.5,
    scope: true,
    sway: 1.15,
    breathSec: 4,
    swapMs: 700,
    price: 2000,
  },

  // ------------------------------------------------------------------ shotguns
  {
    id: 'olympia',
    name: 'Olympia',
    class: 'shotgun',
    slot: 'primary',
    blurb: 'Double barrel. Two shells, one-shot kills up close.',
    damage: { near: 25, far: 8, nearRange: 6, farRange: 15 },
    multipliers: { head: 1, torso: 1, limb: 1 },
    rpm: 400,
    mode: 'semi',
    pellets: 8,
    magazine: 2,
    reserve: 20,
    reloadMs: 2400,
    reloadEmptyMs: 2400,
    adsMs: 300,
    sprintOutMs: 250,
    moveMult: 0.95,
    spread: { hip: 6.5, ads: 4.5, move: 1 },
    recoil: { vertical: 4.5, horizontal: 1.2, recovery: 9 },
    unlockLevel: 1,
    attachments: [],
    model: 'olympia',
    range: 40,
    price: 0,
  },
  {
    id: 'stakeout',
    name: 'Stakeout',
    class: 'shotgun',
    slot: 'primary',
    blurb: 'Pump action, four shells, loaded one at a time.',
    damage: { near: 22, far: 7, nearRange: 5.5, farRange: 14 },
    multipliers: { head: 1, torso: 1, limb: 1 },
    rpm: 70,
    mode: 'pump',
    pellets: 8,
    magazine: 4,
    reserve: 24,
    reloadMs: 2300,
    reloadEmptyMs: 2900,
    shellReload: { startMs: 450, perShellMs: 450, endMs: 400, pumpMs: 600 },
    adsMs: 300,
    sprintOutMs: 250,
    moveMult: 0.95,
    spread: { hip: 6, ads: 4.2, move: 1 },
    recoil: { vertical: 4, horizontal: 1, recovery: 9 },
    unlockLevel: 4,
    attachments: ['grip'],
    model: 'stakeout',
    range: 40,
    price: 1500,
  },
  {
    id: 'spas12',
    name: 'SPAS-12',
    class: 'shotgun',
    slot: 'primary',
    blurb: 'Semi-automatic shotgun with an eight-shell tube.',
    damage: { near: 16, far: 6, nearRange: 4.5, farRange: 11 },
    multipliers: { head: 1, torso: 1, limb: 1 },
    rpm: 200,
    mode: 'semi',
    pellets: 8,
    magazine: 8,
    reserve: 24,
    reloadMs: 3600,
    reloadEmptyMs: 4200,
    shellReload: { startMs: 400, perShellMs: 380, endMs: 350, pumpMs: 450 },
    adsMs: 320,
    sprintOutMs: 250,
    moveMult: 0.95,
    spread: { hip: 6, ads: 4.5, move: 1 },
    recoil: { vertical: 3, horizontal: 0.9, recovery: 10 },
    unlockLevel: 26,
    attachments: ['suppressor'],
    model: 'spas12',
    range: 35,
    price: 2500,
  },

  // ------------------------------------------------------------------ pistols
  pistol({
    id: 'm1911',
    name: 'M1911',
    blurb: 'Reliable .45 sidearm.',
    damage: { near: 40, far: 25, nearRange: 10, farRange: 25 },
    rpm: 625,
    mode: 'semi',
    magazine: 8,
    reserve: 32,
    reloadMs: 1650,
    reloadEmptyMs: 2000,
    adsMs: 150,
    moveMult: 1,
    spread: { hip: 3, ads: 0.4, move: 1 },
    recoil: { vertical: 1.6, horizontal: 0.5, recovery: 14 },
    unlockLevel: 1,
    attachments: ['extmag', 'suppressor', 'dual'],
    model: 'm1911',
    price: 0,
  }),
  pistol({
    id: 'python',
    name: 'Python',
    blurb: '.357 revolver: big damage, six rounds, slow reload.',
    // BO1's weapon file gives the Python `medium` penetration (other pistols are `small`).
    penetration: 'medium',
    damage: { near: 50, far: 35, nearRange: 12, farRange: 30 },
    multipliers: { head: 1.5, torso: 1, limb: 1 },
    rpm: 160,
    mode: 'semi',
    magazine: 6,
    reserve: 24,
    reloadMs: 3000,
    reloadEmptyMs: 3000,
    adsMs: 180,
    moveMult: 1,
    spread: { hip: 3.2, ads: 0.35, move: 1.1 },
    recoil: { vertical: 3.2, horizontal: 0.8, recovery: 10 },
    unlockLevel: 12,
    attachments: ['acog', 'speedreloader', 'dual'],
    model: 'python',
    swapMs: 400,
    price: 1500,
  }),
  pistol({
    id: 'asp',
    name: 'ASP',
    blurb: 'Tiny 9 mm pistol, fast to fire, short range.',
    damage: { near: 40, far: 20, nearRange: 6, farRange: 15 },
    rpm: 700,
    mode: 'semi',
    magazine: 7,
    reserve: 28,
    reloadMs: 1500,
    reloadEmptyMs: 1900,
    adsMs: 140,
    moveMult: 1,
    spread: { hip: 3, ads: 0.6, move: 1 },
    recoil: { vertical: 1.3, horizontal: 0.6, recovery: 15 },
    unlockLevel: 1,
    attachments: ['dual'],
    model: 'asp',
    price: 0,
  }),

  // ------------------------------------------------------------------ not selectable: knife, underbarrel GL
  {
    id: 'knife',
    name: 'Knife',
    class: 'special',
    slot: 'melee',
    blurb: 'Melee (V): a lunge that kills in one hit.',
    damage: { near: 150, far: 150, nearRange: 2, farRange: 2 },
    multipliers: { head: 1, torso: 1, limb: 1 },
    rpm: 60,
    mode: 'semi',
    magazine: 0,
    reserve: 0,
    reloadMs: 0,
    reloadEmptyMs: 0,
    adsMs: 0,
    sprintOutMs: 0,
    moveMult: 1,
    spread: { hip: 0, ads: 0, move: 0 },
    recoil: { vertical: 0, horizontal: 0, recovery: 0 },
    unlockLevel: 1,
    attachments: [],
    model: 'knife',
  },
  {
    id: 'gl',
    name: 'Grenade Launcher',
    class: 'launcher',
    slot: 'attachment',
    blurb: 'Underbarrel M203-style launcher. Arms after a short flight.',
    damage: { near: 150, far: 40, nearRange: 0, farRange: 5 },
    multipliers: { head: 1, torso: 1, limb: 1 },
    rpm: 40,
    mode: 'semi',
    magazine: 1,
    reserve: 1,
    reloadMs: 2700,
    reloadEmptyMs: 2700,
    adsMs: 300,
    sprintOutMs: 300,
    moveMult: 0.95,
    spread: { hip: 1, ads: 0.5, move: 1 },
    recoil: { vertical: 3, horizontal: 0.5, recovery: 8 },
    unlockLevel: 1,
    attachments: [],
    model: 'gl',
    zoom: 1.2,
    swapMs: 400,
  },

  // ------------------------------------------------------------------ wonder weapons (Mystery Box only)
  // BO1 Zombies numbers (Call of Duty Wiki, T5 `_zombiemode_weap_*.gsc`) tuned for 100-health MP;
  // the behaviour (projectile, cone, chain, frost) is in defs/wonder.ts and server weapons/wonder/.
  // `damage` is what stat bars and bots read (the direct hit / the close blast).
  {
    // BO1: 20 + 160, 181 rpm, 3 s reload, 1000 direct / 1500-300 splash, hurts its user.
    id: 'raygun',
    name: 'Ray Gun',
    class: 'special',
    slot: 'primary',
    wonder: true,
    blurb: 'Wonder weapon: a slow green energy bolt. A direct hit kills; the splash kills near the impact and stings you too.',
    damage: { near: 150, far: 150, nearRange: 120, farRange: 120 },
    multipliers: { head: 1, torso: 1, limb: 1 },
    rpm: 150,
    mode: 'auto',
    magazine: 20,
    reserve: 60,
    reloadMs: 3000,
    reloadEmptyMs: 3000,
    adsMs: 200,
    sprintOutMs: 180,
    moveMult: 1,
    spread: { hip: 1.2, ads: 0.15, move: 0.8 },
    recoil: { vertical: 0.9, horizontal: 0.2, recovery: 12 },
    unlockLevel: 1,
    attachments: [],
    model: 'raygun',
    range: 120,
    swapMs: 400,
    zoom: 1.2,
    projectile: true,
  },
  {
    // BO1: 2 + 12, 2 s reload; flings everything within 12 m of a 4.6 m wide cylinder, kills up close.
    id: 'thundergun',
    name: 'Thundergun',
    class: 'special',
    slot: 'primary',
    wonder: true,
    blurb: 'Wonder weapon: a blast of air that kills up close and hurls everyone in front of you (off roofs, too).',
    damage: { near: 150, far: 60, nearRange: 6.5, farRange: 12 },
    multipliers: { head: 1, torso: 1, limb: 1 },
    rpm: 75,
    mode: 'semi',
    magazine: 2,
    reserve: 12,
    reloadMs: 2500,
    reloadEmptyMs: 2500,
    adsMs: 300,
    sprintOutMs: 300,
    moveMult: 0.9,
    spread: { hip: 0, ads: 0, move: 0 },
    recoil: { vertical: 4, horizontal: 0.6, recovery: 6 },
    unlockLevel: 1,
    attachments: [],
    model: 'thundergun',
    range: 12,
    swapMs: 700,
    zoom: 1,
    projectile: true,
  },
  {
    // BO1: 3 + 15 (WaW / BO1 Rezurrection), 6 s reload, one-hit kills that arc to nearby zombies.
    id: 'wunderwaffe',
    name: 'Wunderwaffe DG-2',
    class: 'special',
    slot: 'primary',
    wonder: true,
    blurb: 'Wonder weapon: a lightning bolt that kills its target and arcs to two more enemies close by.',
    damage: { near: 200, far: 200, nearRange: 45, farRange: 45 },
    multipliers: { head: 1, torso: 1, limb: 1 },
    rpm: 60,
    mode: 'semi',
    magazine: 3,
    reserve: 9,
    reloadMs: 5000,
    reloadEmptyMs: 5000,
    adsMs: 300,
    sprintOutMs: 300,
    moveMult: 0.92,
    spread: { hip: 0.8, ads: 0.2, move: 0.6 },
    recoil: { vertical: 2.5, horizontal: 0.4, recovery: 8 },
    unlockLevel: 1,
    attachments: [],
    model: 'wunderwaffe',
    range: 45,
    swapMs: 700,
    zoom: 1.15,
    projectile: true,
  },
  {
    // BO1 "Five": 6 + 24, 3.8 s reload; slows, then freezes and shatters.
    id: 'wintershowl',
    name: "Winter's Howl",
    class: 'special',
    slot: 'primary',
    wonder: true,
    blurb: 'Wonder weapon: a wide blizzard. Up close one blast freezes an enemy solid (no shooting, no moving); blast them again to shatter them.',
    damage: { near: 25, far: 25, nearRange: 19, farRange: 19 },
    multipliers: { head: 1, torso: 1, limb: 1 },
    rpm: 130,
    mode: 'semi',
    magazine: 6,
    reserve: 24,
    reloadMs: 3000,
    reloadEmptyMs: 3000,
    adsMs: 220,
    sprintOutMs: 200,
    moveMult: 1,
    spread: { hip: 0, ads: 0, move: 0 },
    recoil: { vertical: 1.4, horizontal: 0.3, recovery: 10 },
    unlockLevel: 1,
    attachments: [],
    model: 'wintershowl',
    range: 19,
    swapMs: 400,
    zoom: 1.1,
    projectile: true,
  },
  {
    // BO1 Scavenger (Call of the Dead): bolt action, 2-round magazine, explosive bolts that stick.
    id: 'scavenger',
    name: 'Scavenger',
    class: 'special',
    slot: 'primary',
    wonder: true,
    blurb: 'Wonder weapon: an explosive sniper. The bolt sticks to whatever it hits and blows up a second later. Stick someone and they are dead.',
    damage: { near: 40, far: 40, nearRange: 70, farRange: 70 },
    multipliers: { head: 1, torso: 1, limb: 1 },
    rpm: 50,
    mode: 'bolt',
    magazine: 2,
    reserve: 12,
    reloadMs: 3400,
    reloadEmptyMs: 3400,
    adsMs: 380,
    sprintOutMs: 380,
    moveMult: 0.9,
    spread: { hip: 6, ads: 0, move: 2.5 },
    recoil: { vertical: 4.5, horizontal: 1, recovery: 7 },
    unlockLevel: 1,
    attachments: [],
    model: 'scavenger',
    range: 70,
    zoom: 4,
    scope: true,
    sway: 0.6,
    breathSec: 5,
    swapMs: 650,
    projectile: true,
  },
  {
    // BO1 31-79 JGb215 (Shangri-La): shrinks zombies; kick them while they're small.
    id: 'babygun',
    name: '31-79 JGb215',
    class: 'special',
    slot: 'primary',
    wonder: true,
    blurb: 'Wonder weapon: the Baby Gun. Shrinks whoever it hits for a few seconds: tiny, squeaky and harmless. Step on them or hit them with anything to finish them.',
    // A shrink, then any hit kills: stat bars and bots read it as a two-shot kill.
    damage: { near: 50, far: 50, nearRange: 30, farRange: 30 },
    multipliers: { head: 1, torso: 1, limb: 1 },
    rpm: 80,
    mode: 'semi',
    magazine: 4,
    reserve: 16,
    reloadMs: 3000,
    reloadEmptyMs: 3000,
    adsMs: 250,
    sprintOutMs: 220,
    moveMult: 1,
    spread: { hip: 0.9, ads: 0.15, move: 0.6 },
    recoil: { vertical: 2, horizontal: 0.4, recovery: 9 },
    unlockLevel: 1,
    attachments: [],
    model: 'babygun',
    range: 30,
    zoom: 1.15,
    swapMs: 450,
    projectile: true,
  },
  {
    // BO1 Wave Gun / Zap Guns (Moon): dual zap pistols; aimed they join into the Wave Gun.
    id: 'wavegun',
    name: 'Wave Gun',
    class: 'special',
    slot: 'primary',
    wonder: true,
    blurb: 'Wonder weapon: dual Zap Guns spit rapid electric bolts from the hip. Aim to snap them into the Wave Gun: a slow microwave shot that makes the target swell and pop.',
    damage: { near: 50, far: 50, nearRange: 40, farRange: 40 },
    multipliers: { head: 1, torso: 1, limb: 1 },
    rpm: 450,
    mode: 'auto',
    magazine: 24,
    reserve: 144,
    reloadMs: 2800,
    reloadEmptyMs: 2800,
    adsMs: 180,
    sprintOutMs: 180,
    moveMult: 1,
    spread: { hip: 0.9, ads: 0.1, move: 0.5 },
    recoil: { vertical: 0.9, horizontal: 0.4, recovery: 12 },
    unlockLevel: 1,
    attachments: [],
    model: 'wavegun',
    range: 60,
    zoom: 1.25,
    swapMs: 450,
    projectile: true,
  },
];

export const WEAPON_BY_ID = indexById(WEAPONS);

/** The weapons create-a-class may pick (primary and secondary slots; never the Mystery Box's wonder weapons). */
export const LOADOUT_WEAPONS: WeaponDef[] = WEAPONS.filter((w) => (w.slot === 'primary' || w.slot === 'secondary') && !w.wonder);

/** A Mystery Box wonder weapon (never classable, sold or unlocked). */
export const isWonderWeapon = (id: string | null | undefined): boolean => !!id && !!WEAPON_BY_ID.get(id)?.wonder;

/** Seconds between trigger pulls for a weapon at its cycle rate (burst weapons: between bursts). */
export function cycleSec(w: Pick<WeaponDef, 'rpm' | 'mode' | 'burst' | 'burstDelayMs'>): number {
  const shot = 60 / Math.max(1, w.rpm);
  if (w.mode === 'burst') return shot * ((w.burst ?? 3) - 1) + Math.max(shot, (w.burstDelayMs ?? 0) / 1000);
  return shot;
}

/**
 * Hits to kill at a distance on a part (every pellet landing for shotguns). `lower` = lower torso.
 * Rules-level maths for menus (stat bars), bots and tests; the server applies the same numbers.
 */
export function shotsToKill(w: Pick<WeaponDef, 'damage' | 'multipliers' | 'pellets'>, distance: number, part: HitPart = 'torso', health = 100, lower = false): number {
  const per = damageAtRange(w, distance) * partMultiplier(w, part, lower) * Math.max(1, w.pellets ?? 1);
  return per > 0 ? Math.ceil(health / per - 1e-9) : Infinity;
}

/** Seconds from the first round to the `n`th at the weapon's cadence (bursts include their delay). */
export function timeForRounds(w: Pick<WeaponDef, 'rpm' | 'mode' | 'burst' | 'burstDelayMs'>, n: number): number {
  const shot = 60 / Math.max(1, w.rpm);
  let t = 0;
  for (let i = 1; i < n; i++) {
    const burstGap = w.mode === 'burst' && i % (w.burst ?? 3) === 0;
    t += burstGap ? Math.max(shot, (w.burstDelayMs ?? 0) / 1000) : shot;
  }
  return t;
}

/** Time to kill in ms (first shot at t=0) at a distance on a part. */
export function ttkMs(w: WeaponDef, distance: number, part: HitPart = 'torso', health = 100): number {
  const n = shotsToKill(w, distance, part, health);
  return Number.isFinite(n) ? Math.round(timeForRounds(w, n) * 1000) : Infinity;
}
