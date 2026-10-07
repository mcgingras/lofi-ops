/**
 * Equipment (owner: weapons feature): lethal and tactical grenades for `Loadout.lethal` /
 * `Loadout.tactical`, plus the knife's melee numbers. The server simulates thrown equipment as
 * projectiles in the room entity store (kind `weapons.nade`); the client renders them by kind.
 *
 * Distances in metres, times in seconds.
 */
import { indexById } from './registry';

export type EquipmentKind = 'lethal' | 'tactical';
export type EquipmentEffect = 'frag' | 'semtex' | 'flash' | 'concussion';

export interface EquipmentDef {
  id: string;
  name: string;
  kind: EquipmentKind;
  effect: EquipmentEffect;
  /** Carried per life. */
  count: number;
  /** Fuse from pulling the pin (frag: cookable) or from the throw. */
  fuse: number;
  /** Can be cooked by holding the button (the fuse runs while held). */
  cookable: boolean;
  /** Sticks to the first surface or player it touches. */
  sticky: boolean;
  /** Throw speed (m/s) and upward bias added to the aim direction. */
  speed: number;
  loft: number;
  /** Effect radius. Explosives: damage `max` at the centre to `min` at the edge. */
  radius: number;
  max: number;
  min: number;
  /** Tacticals: longest effect duration (scaled by distance and facing). */
  duration?: number;
  unlockLevel: number;
  price?: number;
  blurb?: string;
}

export const EQUIPMENT: EquipmentDef[] = [
  { id: 'frag', name: 'Frag', kind: 'lethal', effect: 'frag', count: 1, fuse: 3, cookable: true, sticky: false, speed: 17, loft: 0.25, radius: 6.5, max: 150, min: 25, unlockLevel: 1, blurb: 'Cook it by holding G. Bounces.' },
  { id: 'semtex', name: 'Semtex', kind: 'lethal', effect: 'semtex', count: 1, fuse: 2, cookable: false, sticky: true, speed: 16, loft: 0.2, radius: 6, max: 150, min: 25, unlockLevel: 1, price: 1000, blurb: 'Sticks to whatever it hits.' },
  { id: 'flashbang', name: 'Flashbang', kind: 'tactical', effect: 'flash', count: 2, fuse: 1.5, cookable: false, sticky: false, speed: 16, loft: 0.25, radius: 16, max: 0, min: 0, duration: 4, unlockLevel: 1, blurb: 'Blinds and deafens enemies who see it.' },
  { id: 'concussion', name: 'Concussion', kind: 'tactical', effect: 'concussion', count: 2, fuse: 1.5, cookable: false, sticky: false, speed: 16, loft: 0.25, radius: 12, max: 0, min: 0, duration: 4.5, unlockLevel: 1, blurb: 'Slows movement and aim of enemies in the blast.' },
];

export const EQUIPMENT_BY_ID = indexById(EQUIPMENT);
export const LETHALS = EQUIPMENT.filter((e) => e.kind === 'lethal');
export const TACTICALS = EQUIPMENT.filter((e) => e.kind === 'tactical');

/** The underbarrel grenade launcher's round (weapon id `gl`). */
export const GL_ROUND = { speed: 45, gravity: 9, armDistance: 8, radius: 5, max: 150, min: 40, impactDamage: 60 } as const;

/** Knife: BO1 lunge. */
export const MELEE = {
  /** Reach without a lunge (from the eye, along the aim). */
  range: 1.6,
  /** Lunge reach when an enemy is in front within this distance. */
  lungeRange: 3.2,
  /** Cone half-angle (degrees) for picking the target. */
  cone: 32,
  damage: 150,
  /** Gun lowered / can't fire for this long after a knife. */
  recoverySec: 0.75,
  /** Seconds between knives. */
  cooldownSec: 0.9,
  /** Lunge speed (m/s) towards the victim, applied as a short velocity impulse. */
  lungeSpeed: 9,
} as const;

/** Time from pressing the button to the grenade leaving the hand. */
export const THROW_WINDUP = 0.35;
/** Gun lowered after a throw. */
export const THROW_RECOVERY = 0.65;
/** Grenade bounce restitution and ground friction. */
export const NADE_PHYSICS = { gravity: 18, restitution: 0.35, friction: 0.55, radius: 0.08 } as const;

// ---------------------------------------------------------------------------------------------
// Weapons feature channels (shared so both client and server see the types).
// ---------------------------------------------------------------------------------------------

/** Entity kind for thrown/launched equipment; `s.e` = equipment id or 'gl', `s.k` = 1 when stuck. */
export const NADE_ENTITY = 'weapons.nade';

declare module '../protocol' {
  interface FeatureMessages {
    /** Your equipment for this life (on spawn and after each throw). */
    'weapons.equip': { lethal: string | null; lethalN: number; tactical: string | null; tacticalN: number };
    /** You were flashed (amount 0..1, seconds). */
    'weapons.flash': { amount: number; dur: number };
    /** You were concussed (amount 0..1, seconds). */
    'weapons.stun': { amount: number; dur: number };
    /** Something exploded (everyone). `e`: frag | semtex | gl | flashbang | concussion. */
    'weapons.boom': { x: number; y: number; z: number; e: string; owner: string | null };
    /** A player knifed (everyone): for the swing animation/sound on remotes. */
    'weapons.melee': { p: string; hit: boolean };
    /** A player threw something (everyone): `e` equipment id. */
    'weapons.throw': { p: string; e: string };
  }
}
