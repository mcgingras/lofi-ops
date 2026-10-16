/**
 * Equipment (owner: weapons feature): lethal and tactical grenades for `Loadout.lethal` /
 * `Loadout.tactical`, plus the knife's melee numbers. The server simulates thrown equipment as
 * projectiles in the room entity store (kind `weapons.nade`); the client renders them by kind.
 *
 * Distances in metres, times in seconds.
 */
import { indexById } from './registry';

export type EquipmentKind = 'lethal' | 'tactical';
export type EquipmentEffect = 'frag' | 'semtex' | 'flash' | 'concussion' | 'tomahawk';

export interface EquipmentDef {
  id: string;
  name: string;
  kind: EquipmentKind;
  effect: EquipmentEffect;
  /** Carried per life. */
  count: number;
  /** Fuse from pulling the pin (frag: cookable) or from the throw. */
  fuse: number;
  /**
   * Can be cooked by holding the button (the fuse runs while held). Every piece of equipment is
   * held up while the button is down and thrown on release (BO1); only cookable ones burn their
   * fuse in your hand.
   */
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
  // BO1: a retrievable hatchet, instant death on impact, bounces off walls and floors (bank shots).
  // Hold the button to raise it, release to throw. Lands as a pickup anyone carrying tomahawks can
  // walk over to get back (BO2 `_weaponobjects.gsc` `watchhatchettrigger`). Level 18 matches the
  // progression unlock table.
  { id: 'tomahawk', name: 'Tomahawk', kind: 'lethal', effect: 'tomahawk', count: 1, fuse: 0, cookable: false, sticky: false, speed: 22, loft: 0.12, radius: 0, max: 0, min: 0, unlockLevel: 18, blurb: 'Retrievable hatchet. Instant kill on impact.' },
  { id: 'flashbang', name: 'Flashbang', kind: 'tactical', effect: 'flash', count: 2, fuse: 1.5, cookable: false, sticky: false, speed: 16, loft: 0.25, radius: 16, max: 0, min: 0, duration: 4, unlockLevel: 1, blurb: 'Blinds and deafens enemies who see it.' },
  { id: 'concussion', name: 'Concussion', kind: 'tactical', effect: 'concussion', count: 2, fuse: 1.5, cookable: false, sticky: false, speed: 16, loft: 0.25, radius: 12, max: 0, min: 0, duration: 4.5, unlockLevel: 1, blurb: 'Slows movement and aim of enemies in the blast.' },
];

export const EQUIPMENT_BY_ID = indexById(EQUIPMENT);
export const LETHALS = EQUIPMENT.filter((e) => e.kind === 'lethal');
export const TACTICALS = EQUIPMENT.filter((e) => e.kind === 'tactical');

/** A blast's damage profile: `max` at the centre falling linearly to `min` at `radius`. */
export interface BlastProfile {
  radius: number;
  max: number;
  min: number;
}

/**
 * Damage a blast does at distance `d` from its centre: linear from `max` to `min` at the edge, 0
 * beyond it (the IW/Treyarch engine's `G_RadiusDamage`).
 */
export function blastDamage(b: BlastProfile, d: number): number {
  if (!(d <= b.radius) || b.radius <= 0) return 0;
  return b.max + (b.min - b.max) * (Math.max(0, d) / b.radius);
}

/** How far out a blast still does `health` damage: the kill radius on a full-health player. */
export function killRadius(b: BlastProfile, health = 100): number {
  if (b.radius <= 0 || b.max < health) return 0;
  if (b.min >= health) return b.radius;
  return (b.radius * (b.max - health)) / (b.max - b.min);
}

/**
 * The HUD grenade indicator (client `weapons/danger.ts`): a live lethal that can hurt you shows
 * within its kill radius plus `margin` (m) and no more than `maxHeight` (m) above or below the eye.
 */
export const GRENADE_INDICATOR = { margin: 1.5, maxHeight: 2.6 } as const;

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
/**
 * Tomahawk flight: it kills anyone it touches while still moving faster than `killSpeed` (so a
 * bank shot off a wall still counts), bounces, comes to rest and waits `pickupSec` to be picked up
 * by walking within `pickupRadius` (or pressing USE within `useRadius`).
 */
export const TOMAHAWK = { gravity: 15, restitution: 0.45, friction: 0.5, killSpeed: 5, damage: 1000, pickupSec: 60, pickupRadius: 1.0, useRadius: 2.0, lifeSec: 8 } as const;
/** Entity kind for a thrown tomahawk; `s.k` = 1 once it lies still (retrievable). */
export const TOMAHAWK_ENTITY = 'weapons.tomahawk';

/**
 * Cooking a grenade (the pin is out while LETHAL is held; only `cookable` equipment, the frag).
 * The server owns the fuse: it pulls the pin when it applies the press and blows the grenade up in
 * the hand once `cookLeft` reaches 0. The HUD runs the same maths from the local time of the
 * input frame that carried the press (anchored by the server's `weapons.cook` ack), which is the
 * deadline your release has to beat on the same input timeline.
 *
 * `warnSec`: the last stretch the HUD flashes ("throw now"); `tickSec`: one tick sound per whole
 * second held; `warnTickSec`: faster ticks inside the warning.
 */
export const COOK = { warnSec: 1, tickSec: 1, warnTickSec: 0.25 } as const;

/** Fuse left (s) on a cookable grenade held for `heldSec`: 0 means it has gone off in the hand. */
export function cookLeft(fuse: number, heldSec: number): number {
  return Math.max(0, fuse - Math.max(0, heldSec));
}

/** In the flashing "throw now" window (the last `COOK.warnSec` of the fuse)? */
export function cookWarning(fuse: number, heldSec: number): boolean {
  const left = cookLeft(fuse, heldSec);
  return left > 0 && left <= COOK.warnSec + 1e-9;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Held times (s) at which the cook ticks: every whole second before the warning, then every
 * `warnTickSec` inside it, never at or past the fuse. Frag (3 s): 1, 2, 2.25, 2.5, 2.75.
 */
export function cookTickTimes(fuse: number): number[] {
  const out: number[] = [];
  const warnFrom = Math.max(0, fuse - COOK.warnSec);
  for (let t = COOK.tickSec; t < warnFrom - 1e-9; t += COOK.tickSec) out.push(round3(t));
  for (let t = warnFrom; t < fuse - 1e-9; t += COOK.warnTickSec) if (t > 1e-9) out.push(round3(t));
  return [...new Set(out)];
}

/** Ticks due between two held times (prev, now]: how many tick sounds to play this frame. */
export function cookTicksBetween(fuse: number, prevHeld: number, held: number): number {
  return cookTickTimes(fuse).filter((t) => t > prevHeld + 1e-9 && t <= held + 1e-9).length;
}

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
    'weapons.equip': {
      lethal: string | null;
      lethalN: number;
      tactical: string | null;
      tacticalN: number;
      /** Hold-breath time multiplier (Scout: 2), from the `holdBreathMultiplier` modifier. */
      breath?: number;
      /** Knife cooldown/recovery multiplier (Steady Aim Pro: 0.7), from `meleeSpeedMultiplier`. */
      melee?: number;
      /** Explosion shake / ringing multiplier (Flak Jacket Pro "Shockproof": 0), from `blastShakeMultiplier`. */
      shock?: number;
    };
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
    /** You picked equipment back up (tomahawk): `n` is how many you carry now. */
    'weapons.retrieve': { e: string; n: number };
    /**
     * The server pulled the pin on your cookable grenade `e` while applying input `seq`: its fuse
     * (`fuse` s, see `cookLeft`) runs from that command. The HUD anchors its cook timer there.
     */
    'weapons.cook': { e: string; seq: number; fuse: number };
  }
}
