/**
 * Zombies mode rules (ModeRules): teams by role (survivors team 0, the undead team 1), no respawn
 * (bled-out survivors come back between rounds), survivor spawns from the map's Zombies layer,
 * the match ends a few seconds after game over. The game itself: game.ts.
 */
import type { Team } from '../../../shared/constants';
import type { MatchResults } from '../../../shared/events';
import type { SpawnPoint } from '../../../shared/maps/types';
import type { ModeRules } from '../../modes/types';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { ZombiesGame } from './game';
import { undeadOf } from './state';

const games = new WeakMap<Room, ZombiesGame>();

/** The Zombies game running in a room (null when the room plays another mode). */
export function zombiesGameOf(room: Room): ZombiesGame | null {
  const g = games.get(room);
  return g && room.rules instanceof ZombiesRules && room.rules.game === g ? g : null;
}

export class ZombiesRules implements ModeRules {
  readonly id = 'zombies';
  game!: ZombiesGame;

  setup(room: Room): void {
    this.game = new ZombiesGame(room);
    games.set(room, this.game);
    this.game.setup();
  }

  reset(_room: Room): void {
    this.game.reset();
  }

  assignTeam(_room: Room, p: PlayerState): Team {
    return undeadOf(p) ? 1 : 0;
  }

  spawnPoints(room: Room, p: PlayerState): SpawnPoint[] {
    const layer = this.game.layer;
    if (layer?.playerSpawns?.length) return layer.playerSpawns;
    // Default: the map's FFA spawns nearest the box's first spot.
    const all = room.map.spawns.ffa.length ? room.map.spawns.ffa : [...room.map.spawns.teams[0], ...room.map.spawns.teams[1]];
    const box = layer?.boxSpots[0];
    if (!box) return all;
    void p;
    return [...all].sort((a, b) => Math.hypot(a.x - box.x, a.z - box.z) - Math.hypot(b.x - box.x, b.z - box.z)).slice(0, 4);
  }

  respawnDelay(): number | null {
    return null;
  }

  checkEnd(room: Room): MatchResults['reason'] | null {
    const g = this.game;
    return g.phase === 'over' && g.gameOverAt !== null && room.time >= g.gameOverAt ? 'score' : null;
  }

  results(_room: Room, reason: MatchResults['reason']): MatchResults {
    return this.game.results(reason);
  }
}
