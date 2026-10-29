/**
 * Economy declaration merging: per-player wager state, the economy room events and the profile
 * extension shape. Imported for its types by every economy server module.
 */
import type { BotSkill } from '../../../shared/defs/bots';
import type { CpLine } from '../../../shared/defs/economy';
import type { EconomyTxn, EscrowInfo, WagerRecord } from '../../../shared/defs/economy-net';
import '../../../shared/defs/economy-net';

/** Per-player wager-mode state (bots may read it: lives, gun rung, tomahawks, skill). */
export interface WagerPlayerExt {
  /** OITC lives left and elimination. */
  lives?: number;
  out?: boolean;
  outAt?: number;
  /** Gun Game rung (0-based) and when it was reached. */
  gunLevel?: number;
  gunAt?: number;
  /** Sticks and Stones tomahawks left this life. */
  tomahawks?: number;
  lastMelee?: number;
  /** Skill the wager lobby asked for (bots only; the bots feature may read it). */
  skill?: BotSkill;
}

declare module '../../player' {
  interface PlayerExt {
    wager?: WagerPlayerExt;
  }
}

declare module '../../../shared/events' {
  interface RoomEvents<P> {
    /**
     * Credit CoD Points to a human (challenges, contracts...). Emit this instead of touching
     * `profile.codPoints` so the ledger and the HUD toast stay right. Bots are ignored.
     */
    'economy.grant': { player: P; amount: number; reason: string; kind?: 'challenge' | 'grant' };
    /** A staked wager was paid out (after matchEnd). */
    'economy.payout': { player: P | null; profileId: string; amount: number; rank: number };
  }
}

/** profile.ext.economy */
export interface EconomyExt {
  earned: number;
  spent: number;
  wagerWon: number;
  wagerLost: number;
  escrow: EscrowInfo | null;
  history: EconomyTxn[];
  equipped: { reticle: string; emblem: string };
  lastMatch: { mode: string; lines: CpLine[]; total: number } | null;
  /** Settled wagers, newest first (WAGER_HISTORY kept). */
  wagerHistory: WagerRecord[];
}
