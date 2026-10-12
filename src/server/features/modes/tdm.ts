/**
 * Team Deathmatch and Free-for-All, polished: the same scoring as core (kill +1 team score /
 * kill limit, 100 per kill, 50 per headshot and assist) with per-reason tallies for the summary,
 * dynamic spawns (own spawns at the start, then anywhere safe, near teammates and out of enemy
 * sight) and no overtime: a tie at the time limit is a draw.
 */
import { RESPAWN_DELAY, type Team } from '../../../shared/constants';
import type { ModeStatePayload } from '../../../shared/defs/modestate';
import type { MatchResults } from '../../../shared/events';
import type { SpawnPoint } from '../../../shared/maps/types';
import type { ModeRules } from '../../modes/types';
import { smallerTeam } from '../../modes/common';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { allSpawns, initialSpawnWindow, rankSpawns, resetModeExt, scoreKill, setController, type ModeController } from './common';
import type { BotObjective } from './bots';
import { recentSpawns } from './spawns';

/**
 * TDM spawn sides: prefer points near where the team has been spawning (its side), and away from
 * the living enemies' centre. When the enemy pushes into that side its points fail the sight and
 * distance checks, the enemy centre sits on top of the side, and the team spawns across the map:
 * the spawn flips, and the side follows it.
 */
export function tdmSide(room: Room, team: Team): (pt: SpawnPoint) => number {
  const recent = recentSpawns(room, team);
  const base = recent.length >= 3 ? recent : room.map.spawns.teams[team];
  const side = centre(base);
  const enemies = [...room.players.values()].filter((q) => q.alive && q.team !== null && q.team !== team);
  const foe = enemies.length ? centre(enemies.map((q) => q.move)) : null;
  return (pt) => {
    let s = side ? -Math.hypot(pt.x - side.x, pt.z - side.z) * 0.3 : 0;
    if (foe) s += Math.min(60, Math.hypot(pt.x - foe.x, pt.z - foe.z)) * 0.3;
    return s;
  };
}

function centre(pts: readonly { x: number; z: number }[]): { x: number; z: number } | null {
  if (!pts.length) return null;
  let x = 0;
  let z = 0;
  for (const p of pts) {
    x += p.x;
    z += p.z;
  }
  return { x: x / pts.length, z: z / pts.length };
}

export class TdmRules implements ModeRules, ModeController {
  readonly id: string = 'tdm';
  readonly statKeys: readonly string[] = [];
  dirty = false;
  protected room!: Room;
  get rules(): ModeRules {
    return this;
  }

  setup(room: Room): void {
    this.setupController(room);
    room.bus.on('death', (e) => scoreKill(room, e, true));
  }

  /** Remember the room and register as its controller (subclasses call this from setup). */
  protected setupController(room: Room): void {
    this.room = room;
    setController(room, this);
  }

  reset(room: Room): void {
    resetModeExt(room);
  }

  assignTeam(room: Room, p: PlayerState): Team | null {
    return smallerTeam(room, p);
  }

  spawnPoints(room: Room, p: PlayerState): SpawnPoint[] {
    const map = room.map;
    if (p.team === null) return rankSpawns(room, p, map.spawns.ffa);
    const own = map.spawns.teams[p.team];
    if (initialSpawnWindow(room) && own.length) return own;
    return rankSpawns(room, p, allSpawns(map), tdmSide(room, p.team));
  }

  respawnDelay(room: Room, _p: PlayerState): number | null {
    return room.mode.respawn ? RESPAWN_DELAY : null;
  }

  checkEnd(room: Room): MatchResults['reason'] | null {
    const limit = room.mode.scoreLimit;
    return limit > 0 && (room.teamScores[0] >= limit || room.teamScores[1] >= limit) ? 'score' : null;
  }

  state(_viewer: PlayerState): ModeStatePayload | null {
    return null;
  }

  objectives(_p: PlayerState): BotObjective[] {
    return [];
  }
}

export class FfaRules implements ModeRules, ModeController {
  readonly id = 'ffa';
  readonly statKeys: readonly string[] = [];
  dirty = false;
  get rules(): ModeRules {
    return this;
  }

  setup(room: Room): void {
    setController(room, this);
    room.bus.on('death', (e) => scoreKill(room, e, false));
  }

  reset(room: Room): void {
    resetModeExt(room);
  }

  assignTeam(): Team | null {
    return null;
  }

  spawnPoints(room: Room, p: PlayerState): SpawnPoint[] {
    const pool = room.map.spawns.ffa.length ? room.map.spawns.ffa : allSpawns(room.map);
    return rankSpawns(room, p, pool);
  }

  checkEnd(room: Room) {
    const limit = room.mode.scoreLimit;
    if (limit <= 0) return null;
    for (const p of room.players.values()) if (p.stats.kills >= limit) return 'score';
    return null;
  }

  state(): null {
    return null;
  }

  objectives(): BotObjective[] {
    return [];
  }
}
