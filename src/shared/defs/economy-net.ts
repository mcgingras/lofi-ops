/**
 * Economy wire types (owner: economy): RPCs, feature pushes and the `results.ext.economy` shape.
 * Shared so both the server feature and the client screens get the types (declaration merging).
 */
import type { Loadout } from '../loadout';
import type { BotDifficultyId, BotSkill } from './bots';
import type { CpLine } from './economy';

export interface EconomyTxn {
  /** Unix ms. */
  at: number;
  /** Positive = earned/refunded, negative = spent/staked. */
  cp: number;
  kind: 'match' | 'challenge' | 'purchase' | 'ante' | 'payout' | 'refund' | 'grant';
  label: string;
}

export interface EscrowInfo {
  roomId: string;
  /** Wager match number within the room (rooms run several matches). */
  match: number;
  amount: number;
  mode: string;
  at: number;
}

/** One settled wager on the profile (`profile.ext.economy.wagerHistory`, newest first). */
export interface WagerRecord {
  /** Unix ms. */
  at: number;
  mode: string;
  ante: number;
  /** 1-based placement among the entrants (0 = forfeited by leaving). */
  place: number;
  entrants: number;
  /** Humans who staked (1 = solo against bots). */
  humans: number;
  payout: number;
  /** payout - ante */
  net: number;
  forfeit?: boolean;
}

export interface EconomyState {
  codPoints: number;
  owned: string[];
  equipped: { reticle: string; emblem: string };
  earned: number;
  spent: number;
  wagerWon: number;
  wagerLost: number;
  escrow: EscrowInfo | null;
  history: EconomyTxn[];
  lastMatch: { mode: string; lines: CpLine[]; total: number } | null;
  wagerHistory: WagerRecord[];
}

/** Bot settings a wager lobby asks for (subset of LobbyBotSettings; the server clamps it). */
export interface WagerBotRequest {
  fill?: boolean;
  difficulty?: BotDifficultyId | 'custom';
  custom?: Partial<BotSkill>;
  variance?: number;
  targetPlayers?: number;
}

export interface WagerRoomSummary {
  roomId: string;
  mode: string;
  ante: number;
  practice: boolean;
  humans: number;
  players: number;
  target: number;
  phase: string;
  /** Room-relative seconds until the lobby starts (null when not counting down). */
  startsIn: number | null;
  /** The bots it backfills with ("Hardened / Veteran"). */
  opponents: string;
}

export interface WagerStanding {
  id: string;
  name: string;
  bot: boolean;
  /** Overall placement in the mode's ranking (everyone in the room). */
  place: number;
  /**
   * Placement among the wager's entrants (staked humans and house-covered bots), which decides the
   * money. 0 = not an entrant (practice, late joiners).
   */
  rank: number;
  /** Projected payout at this rank (a bot's share goes back to the house). */
  payout: number;
  score: number;
  /** A human whose real CP is in escrow. */
  staked: boolean;
  /** Bots: the preset this bot plays at (staked tiers mix two). */
  difficulty?: string;
}

export interface WagerHud {
  roomId: string;
  mode: string;
  ante: number;
  /** ante x entrants: the humans' escrowed antes plus the house's cover for every bot. */
  pot: number;
  practice: boolean;
  /** Humans who paid the ante this match. */
  staked: number;
  /** Everyone in the money race: staked humans + bots (the house covers each bot's ante). */
  entrants: number;
  /** Payout per entrant rank (index 0 = 1st). */
  payouts: number[];
  standings: WagerStanding[];
  phase: 'lobby' | 'countdown' | 'playing' | 'ended';
  /** Lobby: seconds until the match starts (null = waiting for players). */
  startsIn: number | null;
  humans: number;
  target: number;
  /** Bot difficulty the lobby backfills with; `opponents` names it ("Hardened / Veteran" for High Roller). */
  bots: { fill: boolean; difficulty: string; opponents: string };
}

/** Per-player wager-mode state for the HUD. */
export interface WagerModeHud {
  mode: string;
  lives?: number;
  livesMax?: number;
  /** Gun Game: 0-based rung, ladder size and the current/next gun names. */
  gunLevel?: number;
  gunCount?: number;
  gun?: string;
  nextGun?: string | null;
  /** Sharpshooter: current gun and room time of the next swap. */
  weapon?: string;
  rotateAt?: number;
  bonus?: string | null;
  multiplier?: number;
  /** Sticks and Stones: tomahawks carried right now (thrown ones can be picked back up). */
  tomahawks?: number;
  /** Eliminated (OITC) and spectating. */
  out?: boolean;
}

export interface WagerPayoutLine {
  id: string;
  profileId: string | null;
  name: string;
  rank: number;
  ante: number;
  payout: number;
  /** payout - ante */
  net: number;
}

/** One entrant's final placing in a staked wager (bots too; their share went to the house). */
export interface WagerPlacing {
  id: string;
  name: string;
  bot: boolean;
  rank: number;
  payout: number;
}

/** `results.ext.economy` */
export interface EconomyResultsExt {
  /** Per player id: CP awarded for this match (normal modes). */
  awards: Record<string, { total: number; lines: CpLine[] }>;
  wager: {
    ante: number;
    pot: number;
    practice: boolean;
    /** Humans who staked real CP. */
    staked: number;
    /** Staked humans + house-covered bots at the start (decides the places paid). */
    entrants: number;
    /** Payout per entrant rank. */
    payouts: number[];
    /** Per staked human still in at the end. */
    lines: WagerPayoutLine[];
    /** Every entrant still in at the end, by rank. */
    placings: WagerPlacing[];
    /** CP that bots placed in the money for (back to the house). */
    house: number;
    forfeits: string[];
  } | null;
}

declare module '../protocol' {
  interface RpcMap {
    'economy.state': { req: Record<string, never>; res: EconomyState };
    'economy.buy': { req: { item: string }; res: { codPoints: number; owned: string[]; item: string } };
    'economy.equip': { req: { kind: 'reticle' | 'emblem'; id: string }; res: { equipped: { reticle: string; emblem: string } } };
    'economy.setCamo': { req: { loadout: number; slot: 'primary' | 'secondary'; camo: string }; res: { loadouts: Loadout[] } };
    'economy.wagerQueue': { req: { mode: string; ante: number; bots?: WagerBotRequest }; res: { roomId: string; practice: boolean } };
    'economy.wagerList': { req: Record<string, never>; res: { rooms: WagerRoomSummary[] } };
    'economy.wagerStart': { req: Record<string, never>; res: { ok: boolean } };
  }
  interface FeatureMessages {
    'economy.wager': WagerHud;
    'economy.mode': WagerModeHud;
    'economy.award': { reason: EconomyTxn['kind']; lines: CpLine[]; total: number; codPoints: number };
    /**
     * Sticks and Stones: someone was bankrupted (everyone gets it). `attacker` null = they did it
     * to themselves (suicide). `lost` = the score they lost.
     */
    'economy.bankrupt': { victim: string; attacker: string | null; lost: number };
    /** You have a crossbow bolt stuck in you (BO1 "stuck" warning); `fuse` seconds to go. */
    'economy.stuck': { by: string | null; fuse: number };
    /** You picked a ballistic knife blade back up: `total` = loaded + spare now. */
    'economy.blade': { total: number };
  }
}
