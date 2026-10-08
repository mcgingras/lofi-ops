/**
 * Killstreaks (owner: perks-streaks feature). BO1 set: pick three in create-a-class; each is earned
 * at its count of kills in a row (Hardline: one fewer). Kills made by killstreaks do not count
 * toward the next one. Earned streaks are kept until used (even across deaths) and called with the
 * STREAK button (4); selection cycles with 5.
 *
 * `targeting` says how a streak is aimed:
 *   none   - just called (Spy Plane, Counter-Spy Plane, Blackbird, Attack Dogs)
 *   point  - one designated spot where the caller aims (Care Package)
 *   line   - a spot plus the caller's facing as the run direction (unused since the tactical map)
 *   points - several designated spots where the caller aims (unused since the tactical map)
 *   map    - chosen on the overhead tactical map (BO1: the radio). `mapPick` says how:
 *            'line' a spot plus a run direction (Napalm, Rolling Thunder), 'points' `marks` spots
 *            (Mortar Team), 'area' one patrol point (Attack Helicopter). See defs/tactical-map.ts.
 *   place  - placed on the ground in front of the caller (Sentry Gun, SAM Turret)
 *   control- the caller drives/aims it (RC-XD, Chopper Gunner, Valkyrie Rockets)
 *
 * The MW2 Tactical Nuke (25) rides on top of the BO1 set: see `defs/nuke.ts` for its timeline.
 */
import { indexById } from './registry';

export type StreakTargeting = 'none' | 'point' | 'line' | 'points' | 'map' | 'place' | 'control';
/** How a `map`-targeted streak is placed on the tactical map. */
export type MapPick = 'line' | 'points' | 'area';

export interface KillstreakDef {
  id: string;
  name: string;
  /** Kills in a row needed (before Hardline). */
  kills: number;
  description: string;
  unlockLevel: number;
  /** passive: works on its own once earned/used; called: thrown in, then AI; controlled: player drives it. */
  kind: 'passive' | 'called' | 'controlled';
  /** Seconds it lasts once active, if timed. */
  durationSec?: number;
  icon?: string;
  targeting?: StreakTargeting;
  /** For `map` targeting: a run line, several points, or a patrol area. */
  mapPick?: MapPick;
  /** Designations needed for `points` targeting / `mapPick: 'points'`. */
  marks?: number;
  /** It flies (SAM Turrets shoot it, Ghost Pro hides from it). */
  air?: boolean;
  /** Hit points when it can be shot down/destroyed (absent: invulnerable). */
  hp?: number;
  price?: number;
  /**
   * Kills made by killstreaks count toward this one. BO1 rule (the default, false): only gun,
   * knife and equipment kills count. MW2's Tactical Nuke counted every kill, so it sets this.
   */
  countsStreakKills?: boolean;
  /** Not available in wager matches (it can't be earned or called there). */
  noWager?: boolean;
}

export const KILLSTREAKS: KillstreakDef[] = [
  { id: 'uav', name: 'Spy Plane', kills: 3, description: 'Shows enemies on the minimap.', unlockLevel: 1, kind: 'called', durationSec: 30, targeting: 'none', air: true, hp: 700, icon: 'ks_uav' },
  { id: 'rcxd', name: 'RC-XD', kills: 3, description: 'Remote-control car packed with explosives. Fire to detonate.', unlockLevel: 1, kind: 'controlled', durationSec: 30, targeting: 'control', hp: 40, icon: 'ks_rcxd' },
  { id: 'counter_uav', name: 'Counter-Spy Plane', kills: 4, description: "Jams the enemy's minimap.", unlockLevel: 1, kind: 'called', durationSec: 30, targeting: 'none', air: true, hp: 700, icon: 'ks_cuav' },
  { id: 'sam_turret', name: 'SAM Turret', kills: 4, description: 'Placeable turret that shoots down enemy aircraft.', unlockLevel: 8, kind: 'called', durationSec: 60, targeting: 'place', hp: 450, icon: 'ks_sam' },
  { id: 'care_package', name: 'Care Package', kills: 5, description: 'Airdrop a random killstreak where you aim.', unlockLevel: 1, kind: 'called', targeting: 'point', icon: 'ks_package' },
  { id: 'napalm', name: 'Napalm Strike', kills: 5, description: 'Pick a spot and a direction on the map: a jet burns a line through it.', unlockLevel: 1, kind: 'called', targeting: 'map', mapPick: 'line', icon: 'ks_napalm' },
  { id: 'sentry_gun', name: 'Sentry Gun', kills: 6, description: 'Placeable automated gun.', unlockLevel: 14, kind: 'called', durationSec: 90, targeting: 'place', hp: 450, icon: 'ks_sentry' },
  { id: 'mortar', name: 'Mortar Team', kills: 6, description: 'Mark three spots on the map for a mortar barrage.', unlockLevel: 1, kind: 'called', targeting: 'map', mapPick: 'points', marks: 3, icon: 'ks_mortar' },
  { id: 'attack_helicopter', name: 'Attack Helicopter', kills: 7, description: 'Pick an area on the map: a helicopter patrols it and attacks enemies.', unlockLevel: 1, kind: 'called', durationSec: 60, targeting: 'map', mapPick: 'area', air: true, hp: 1500, icon: 'ks_heli' },
  { id: 'valkyrie', name: 'Valkyrie Rockets', kills: 7, description: 'Two guided rockets. Steer with your view, fire to detonate.', unlockLevel: 26, kind: 'controlled', targeting: 'control', icon: 'ks_valkyrie' },
  { id: 'blackbird', name: 'Blackbird', kills: 8, description: 'Shows enemy positions and facing. Cannot be shot down.', unlockLevel: 32, kind: 'called', durationSec: 30, targeting: 'none', air: true, icon: 'ks_blackbird' },
  { id: 'rolling_thunder', name: 'Rolling Thunder', kills: 8, description: 'Pick a spot and a direction on the map: a B-52 carpet-bombs along it.', unlockLevel: 36, kind: 'called', targeting: 'map', mapPick: 'line', icon: 'ks_thunder' },
  { id: 'chopper_gunner', name: 'Chopper Gunner', kills: 9, description: 'Man the explosive gun of a circling helicopter.', unlockLevel: 40, kind: 'controlled', durationSec: 40, targeting: 'control', air: true, hp: 2000, icon: 'ks_gunner' },
  { id: 'attack_dogs', name: 'Attack Dogs', kills: 11, description: 'A pack of dogs hunts down the enemy.', unlockLevel: 44, kind: 'called', durationSec: 60, targeting: 'none', icon: 'ks_dogs' },
  // MW2's Tactical Nuke. Killstreak kills count toward it as they did in MW2 (25 gun kills in a
  // row against bots is a very long ask); set `countsStreakKills: false` for the strict BO1 rule.
  { id: 'nuke', name: 'Tactical Nuke', kills: 25, description: 'Ten seconds after you call it, a nuclear blast kills everyone and ends the match in your favour. Killstreak kills count toward it.', unlockLevel: 25, kind: 'called', targeting: 'none', icon: 'ks_nuke', countsStreakKills: true, noWager: true },
];

export const KILLSTREAK_BY_ID = indexById(KILLSTREAKS);

/** What a Care Package can hold (weights). `ammo` refills the capturer's weapons. Never the Tactical Nuke (MW2 neither). */
export const CARE_PACKAGE_WEIGHTS: Record<string, number> = {
  ammo: 14,
  uav: 18,
  counter_uav: 14,
  rcxd: 12,
  sam_turret: 9,
  napalm: 8,
  sentry_gun: 7,
  mortar: 7,
  attack_helicopter: 5,
  valkyrie: 4,
  blackbird: 3,
  rolling_thunder: 3,
  chopper_gunner: 2,
  attack_dogs: 1,
};

/** How close you must be to a landed crate to take it: horizontal reach and height difference (m). */
export const CRATE_REACH = { r: 1.8, dy: 2 };

/** Entity kinds the killstreaks feature puts in snapshots (client renderers key on these). */
export const KS_ENTITY = {
  uav: 'ks_uav',
  counterUav: 'ks_cuav',
  blackbird: 'ks_blackbird',
  dropHeli: 'ks_dropheli',
  crate: 'ks_crate',
  jet: 'ks_jet',
  bomber: 'ks_bomber',
  fire: 'ks_fire',
  mortarMark: 'ks_mark',
  /** A player holding the radio for the tactical map (others see the pose). */
  radio: 'ks_radio',
  sentry: 'ks_sentry',
  sam: 'ks_sam',
  missile: 'ks_missile',
  heli: 'ks_heli',
  gunner: 'ks_gunner',
  rocket: 'ks_rocket',
  dog: 'ks_dog',
  rcxd: 'ks_rcxd',
  scavenger: 'perks_pack',
  /** The Tactical Nuke: sits at the blast point off the map edge; `s.a` countdown start, `s.d` detonation (room time). */
  nuke: 'ks_nuke',
} as const;

/** Weapon ids streaks deal damage with (killfeed shows the streak); kills with these never count toward streaks. */
export const isStreakWeapon = (weapon: string) => KILLSTREAK_BY_ID.has(weapon) || weapon.startsWith('ks_');

/** Kills needed with a cost offset (Hardline: -1), never below 1. */
export const streakCost = (def: KillstreakDef, offset: number) => Math.max(1, def.kills + Math.round(offset));

/** Can `def` be earned and called in a mode? (The Tactical Nuke is off in wager matches.) */
export const streakAllowedIn = (def: KillstreakDef, mode: { playlist?: string; wager?: unknown }) => !(def.noWager && (mode.playlist === 'wager' || !!mode.wager));
