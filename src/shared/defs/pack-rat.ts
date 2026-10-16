/**
 * Pack Rat perk (owner: perks-streaks; tier 2): weapon pickups made fast and yours.
 *
 * - Picking up a gun is a tap of USE instead of holding it (`holdMul` on PICKUP.holdSec, also the
 *   bots' hold), the picked-up gun comes up in `pickupRaise` of its normal raise time, and every
 *   weapon switch is quicker (`swapMul`).
 * - A picked-up gun wears the camo you equipped for that slot (a slot with no camo keeps the gun's own).
 * - Pro: the picked-up gun comes with a full magazine and full reserve.
 *
 * Pure data shared by the server, the client prompt and the tests.
 */
export const PACK_RAT = {
  /** Multiplier on the USE hold to swap for a dropped gun (0 = a tap). */
  holdMul: 0,
  /** Multiplier on every weapon switch (stacks with nothing else in tier 2). */
  swapMul: 0.6,
  /** A picked-up gun is raised in this share of its `swapMs`. */
  pickupRaise: 0.3,
} as const;
