/**
 * CoD Points economy (owner: economy feature): earning rules, prices, wager modes.
 * Kept free of imports from modes.ts (modes.ts imports WAGER_MODES from here).
 */
import type { ModeDef } from './modes';

/** CoD Points awarded at match end. */
export const CP_REWARDS = {
  /** Flat amount for finishing a match. */
  matchComplete: 100,
  /** Extra for being on the winning side / winning FFA. */
  win: 100,
  /** Per point of match score (score 2500 => 250 CP at 0.1). */
  perScore: 0.1,
};

/** CoD Points a player starts with. */
export const STARTING_COD_POINTS = 1000;

/** Default prices by item kind if a def has no explicit price. */
export const DEFAULT_PRICES = { weapon: 1500, attachment: 1000, camo: 500, perk: 1500, killstreak: 1500, emblem: 250 };

/** Wager modes (One in the Chamber, Gun Game, Sharpshooter, Sticks and Stones). Filled in by economy. */
export const WAGER_MODES: ModeDef[] = [];

/** CoD Points for one finished match (non-wager). */
export function codPointsForMatch(r: { score: number; won: boolean }): number {
  return Math.round(CP_REWARDS.matchComplete + (r.won ? CP_REWARDS.win : 0) + r.score * CP_REWARDS.perScore);
}
