/**
 * Blackout mode rules (ModeRules): free for all, no respawns, everyone spawns aboard the plane,
 * the match ends when one player is left (game.ts decides it), results ranked by place.
 */
import type { MatchResults } from '../../../shared/events';
import type { SpawnPoint } from '../../../shared/maps/types';
import type { ModeRules } from '../../modes/types';
import type { Room } from '../../room';
import { BlackoutGame } from './game';

const games = new WeakMap<Room, BlackoutGame>();

/** The Blackout game of a room (null when the room plays another mode). */
export function blackoutGameOf(room: Room): BlackoutGame | null {
  const g = games.get(room);
  return g && room.rules instanceof BlackoutRules && room.rules.game === g ? g : null;
}

export class BlackoutRules implements ModeRules {
  readonly id = 'blackout';
  game!: BlackoutGame;

  setup(room: Room): void {
    this.game = new BlackoutGame(room);
    games.set(room, this.game);
    this.game.setup();
  }

  reset(): void {
    this.game.reset();
  }

  assignTeam(): null {
    return null;
  }

  spawnPoints(): SpawnPoint[] {
    return [this.game.planeSpawn()];
  }

  respawnDelay(): number | null {
    return null;
  }

  checkEnd(): MatchResults['reason'] | null {
    return this.game.checkEnd();
  }

  results(_room: Room, reason: MatchResults['reason']): MatchResults {
    return this.game.results(reason);
  }
}
