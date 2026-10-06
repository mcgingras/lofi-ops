/**
 * Mode rules: how a mode scores, spawns, respawns and ends. One instance per room (it may keep
 * per-room state). Register a factory by mode id with `registerMode` (modes/index.ts) from core or
 * from a feature's `setup`. The ModeDef (shared/defs/modes.ts) holds the data (limits, teams).
 */
import type { Team } from '../../shared/constants';
import type { MatchResults } from '../../shared/events';
import type { SpawnPoint } from '../../shared/maps/types';
import type { PlayerState } from '../player';
import type { Room } from '../room';

export interface ModeRules {
  id: string;
  /** Once per room, right after creation: subscribe to room.bus here (death -> score, etc). */
  setup(room: Room): void;
  /** Each match start (reset per-match state, place objectives). Scores/stats are reset by core. */
  reset?(room: Room): void;
  /** Team for a joining player. Default: smaller team (team modes) / null (FFA). */
  assignTeam?(room: Room, p: PlayerState): Team | null;
  /** Candidate spawn points for a player. Default: team spawns or FFA spawns. */
  spawnPoints?(room: Room, p: PlayerState): SpawnPoint[];
  /** Seconds until a dead player respawns, or null for no respawn this round. Default: 3 if mode.respawn. */
  respawnDelay?(room: Room, p: PlayerState): number | null;
  /** Called on every score change and once per second; return a reason to end the match. */
  checkEnd?(room: Room): MatchResults['reason'] | null;
  /** Final results. Default: `standardResults`. */
  results?(room: Room, reason: MatchResults['reason']): MatchResults;
}

export type ModeFactory = () => ModeRules;
