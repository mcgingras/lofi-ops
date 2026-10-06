/**
 * Game modes (owner: modes feature; wager modes come from economy.ts, owner: economy).
 * Rules live on the server in src/server/modes/<id>.ts, registered by id.
 */
import { WAGER_MODES } from './economy';
import { indexById } from './registry';

export interface ModeDef {
  id: string;
  name: string;
  /** Short HUD label. */
  short: string;
  description: string;
  teams: boolean;
  /** Team score (team modes) or player score (FFA-style) that ends the match. 0 = none. */
  scoreLimit: number;
  /** 0 = no time limit. */
  timeLimitSec: number;
  respawn: boolean;
  /** Wager matches: ante in CoD Points and payouts for 1st/2nd/3rd (economy feature). */
  wager?: { ante: number; payouts: number[] };
  /** Which playlist menu it shows under. */
  playlist: 'core' | 'objective' | 'wager' | 'hardcore' | 'party';
  /** Max players per match (bots included). */
  maxPlayers: number;
  /** Rounds-based modes (S&D): rounds to win. */
  rounds?: number;
}

export const CORE_MODES: ModeDef[] = [
  { id: 'tdm', name: 'Team Deathmatch', short: 'TDM', description: 'Two teams. First to the kill limit wins.', teams: true, scoreLimit: 75, timeLimitSec: 600, respawn: true, playlist: 'core', maxPlayers: 12 },
  { id: 'ffa', name: 'Free-for-All', short: 'FFA', description: 'Everyone for themselves. First to 30 kills.', teams: false, scoreLimit: 30, timeLimitSec: 600, respawn: true, playlist: 'core', maxPlayers: 8 },
];

export const MODES: ModeDef[] = [...CORE_MODES, ...WAGER_MODES];

export const MODE_BY_ID = indexById(MODES);
