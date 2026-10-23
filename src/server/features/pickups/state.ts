/** Per-player pickup state (`player.ext.pickups`). */
import type { PlayerState } from '../../player';

export interface PickupsExt {
  /** Seconds USE has been held on `target`. */
  hold: number;
  /** Drop entity being held on, or null. */
  target: number | null;
  /** After a swap, USE must be let go before the next one (no swapping straight back). */
  needRelease: boolean;
  /** Bots: the gun it is walking to, and how long it has "held USE" on it. */
  botTarget: number | null;
  botHold: number;
}

declare module '../../player' {
  interface PlayerExt {
    pickups?: PickupsExt;
  }
}

export const pickupsOf = (p: PlayerState): PickupsExt => (p.ext.pickups ??= { hold: 0, target: null, needRelease: false, botTarget: null, botHold: 0 });

/**
 * Per-room overrides for modes that use guns on the floor as loot (Blackout): `keep` = drops never
 * expire and count against `cap` instead of `PICKUP.maxPerRoom`; `slotFor` picks the slot a human's
 * swap replaces (an empty knife slot before the gun in hand); `bots: false` turns off this feature's
 * own bot pickup logic (the mode's bots loot themselves).
 */
export interface PickupRules {
  keep?: boolean;
  cap?: number;
  slotFor?: (p: PlayerState) => number;
  bots?: boolean;
}

const rulesByRoom = new WeakMap<object, PickupRules>();

/** Set (or clear with null) a room's pickup overrides. */
export function setPickupRules(room: object, rules: PickupRules | null): void {
  if (rules) rulesByRoom.set(room, rules);
  else rulesByRoom.delete(room);
}

export const pickupRulesOf = (room: object): PickupRules | undefined => rulesByRoom.get(room);
