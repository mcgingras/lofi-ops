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
}

export interface WagerStanding {
  id: string;
  name: string;
  bot: boolean;
  /** Overall placement in the mode's ranking (bots included). */
  place: number;
  /** Rank among staked humans (0 = not staked: bots, practice, late joiners). */
  rank: number;
  /** Projected payout at this rank. */
  payout: number;
  score: number;
}

export interface WagerHud {
  roomId: string;
  mode: string;
  ante: number;
  pot: number;
  practice: boolean;
  /** Humans who paid the ante this match. */
  staked: number;
  /** Payout per human rank (index 0 = 1st). */
  payouts: number[];
  standings: WagerStanding[];
  phase: 'lobby' | 'countdown' | 'playing' | 'ended';
  /** Lobby: seconds until the match starts (null = waiting for players). */
  startsIn: number | null;
  humans: number;
  target: number;
  /** Bot difficulty the lobby backfills with. */
  bots: { fill: boolean; difficulty: string };
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
  /** Sticks and Stones: tomahawks left this life. */
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

/** `results.ext.economy` */
export interface EconomyResultsExt {
  /** Per player id: CP awarded for this match (normal modes). */
  awards: Record<string, { total: number; lines: CpLine[] }>;
  wager: { ante: number; pot: number; practice: boolean; staked: number; lines: WagerPayoutLine[]; forfeits: string[] } | null;
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
  }
}
