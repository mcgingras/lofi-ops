/**
 * Weapon drops and pickups (owner: pickups feature), shared by server and client.
 *
 * BO1 / MW2 rules: a player who dies drops the gun in their hands (with its magazine, reserve,
 * attachments and camo); it falls to the ground with a little spin and lies there for `lifeSec`.
 * Standing near it and looking at it shows "HOLD F TO SWAP FOR <NAME>"; holding USE for `holdSec`
 * swaps it for the gun in your hands, which drops where you stand. You never carry two of the same
 * weapon: walking over a copy of one you carry takes its ammo instead (up to the max) and removes it.
 * Wager matches have no drops. Scavenger packs are a separate thing (perks feature).
 *
 * The target choice (`pickDropTarget`) is the same maths on both sides, so the prompt the client
 * shows names the gun the server will hand over.
 */
import type { Vec3 } from '../math';
import { viewDir } from '../math';
import { WEAPON_BY_ID } from './weapons';
import { WAGER_ONLY_WEAPONS } from './wager-weapons';

export const PICKUP = {
  /** Reach from your feet to the gun, horizontally (m). */
  radius: 1.6,
  /** Height difference allowed between your feet and the gun (m). */
  dy: 1.4,
  /** Walking over a copy of a weapon you carry takes its ammo within this (m). */
  ammoRadius: 1.1,
  /** Hold USE this long to swap (s). */
  holdSec: 0.25,
  /** Dropped guns despawn after this (s). */
  lifeSec: 45,
  /** At most this many dropped guns per room; the oldest goes first. */
  maxPerRoom: 16,
  /** Score = distance (m) + `lookWeight` x angle off the crosshair (rad): what you look at wins. */
  lookWeight: 2,
  /** Fall: gravity (m/s^2), spin while falling (rad/s), height it leaves the hands at (m above feet). */
  gravity: 18,
  spin: 7,
  dropHeight: 1.0,
  /** Height of the gun's centre above the ground once it lies flat (m). */
  restHeight: 0.04,
  /** Bots: seconds a bot "holds USE" once in reach. */
  botHoldSec: 0.35,
} as const;

/** Entity kind of a dropped gun. */
export const PICKUP_ENTITY = 'pickups_weapon';

/**
 * Entity `s` of a dropped gun: weapon id, attachments (comma separated), camo, landed, magazine and
 * reserve (shown in the prompt).
 */
export interface DropSnapState {
  w: string;
  a: string;
  c: string;
  l: boolean;
  m: number;
  r: number;
}

/** May this weapon id lie on the ground? (primaries and secondaries; no knife, launcher slot or wager-only guns). */
export function canDropWeapon(id: string): boolean {
  const def = WEAPON_BY_ID.get(id);
  return !!def && (def.slot === 'primary' || def.slot === 'secondary') && !WAGER_ONLY_WEAPONS.has(id);
}

export interface DropCandidate {
  id: number;
  x: number;
  y: number;
  z: number;
}

/** How good a target a dropped gun is for someone at `feet` looking along yaw/pitch (lower is better), or null if out of reach. */
export function dropScore(feet: Vec3, eyeY: number, yaw: number, pitch: number, d: Pick<DropCandidate, 'x' | 'y' | 'z'>): number | null {
  const dx = d.x - feet.x;
  const dz = d.z - feet.z;
  const flat = Math.hypot(dx, dz);
  if (flat > PICKUP.radius || Math.abs(d.y - feet.y) > PICKUP.dy) return null;
  const v = viewDir(yaw, pitch);
  const ex = dx;
  const ey = d.y - eyeY;
  const ez = dz;
  const len = Math.hypot(ex, ey, ez) || 1;
  const cos = Math.max(-1, Math.min(1, (v.x * ex + v.y * ey + v.z * ez) / len));
  return flat + PICKUP.lookWeight * Math.acos(cos);
}

/** The best dropped gun in reach (what you look at, then what you stand on), or null. */
export function pickDropTarget<T extends DropCandidate>(feet: Vec3, eyeY: number, yaw: number, pitch: number, drops: Iterable<T>, accept: (d: T) => boolean = () => true): T | null {
  let best: T | null = null;
  let bestScore = Infinity;
  for (const d of drops) {
    const s = dropScore(feet, eyeY, yaw, pitch, d);
    if (s === null || s >= bestScore || !accept(d)) continue;
    best = d;
    bestScore = s;
  }
  return best;
}

/** Parse a drop entity's attachment list. */
export const dropAttachments = (s: Pick<DropSnapState, 'a'>): string[] => (s.a ? s.a.split(',').filter(Boolean) : []);

/** Wire types (CONTRACTS section 5). */
export interface PickupSwapMsg {
  /** Weapon you now hold, and the one you dropped (null if it was empty and vanished). */
  taken: string;
  dropped: string | null;
  slot: number;
}

export interface PickupAmmoMsg {
  weapon: string;
  amount: number;
}

declare module '../protocol' {
  interface FeatureMessages {
    /** To the picker: a swap went through. */
    'pickups.swapped': PickupSwapMsg;
    /** To the picker: ammo taken from a copy of a carried weapon. */
    'pickups.ammo': PickupAmmoMsg;
  }
}
