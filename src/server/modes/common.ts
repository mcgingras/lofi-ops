/** Shared helpers for mode rules: standard results, placement, team balancing. */
import type { Team } from '../../shared/constants';
import type { MatchResults, PlayerResult } from '../../shared/events';
import type { PlayerState } from '../player';
import type { Room } from '../room';

const byScore = (a: PlayerState, b: PlayerState) => b.stats.score - a.stats.score || b.stats.kills - a.stats.kills || a.stats.deaths - b.stats.deaths;

/** Results by team score (team modes) or player score (FFA). Ties: no winner. */
export function standardResults(room: Room, reason: MatchResults['reason']): MatchResults {
  const players = [...room.players.values()];
  const sorted = [...players].sort(byScore);
  let winnerTeam: Team | null = null;
  let winners: string[] = [];
  if (room.mode.teams) {
    const [a, b] = room.teamScores;
    winnerTeam = a > b ? 0 : b > a ? 1 : null;
    winners = winnerTeam === null ? [] : players.filter((p) => p.team === winnerTeam).map((p) => p.id);
  } else if (sorted.length) {
    const top = sorted[0]!;
    const second = sorted[1];
    if (!second || byScore(top, second) < 0) winners = [top.id];
  }
  const results: PlayerResult[] = sorted.map((p, i) => ({
    id: p.id,
    profileId: p.profile?.id ?? null,
    name: p.name,
    team: p.team,
    bot: p.isBot,
    kills: p.stats.kills,
    deaths: p.stats.deaths,
    assists: p.stats.assists,
    headshots: p.stats.headshots,
    score: p.stats.score,
    bestStreak: p.stats.bestStreak,
    place: i + 1,
    won: winners.includes(p.id),
    timePlayed: Math.max(0, room.time - Math.max(p.joinTime, room.matchStartTime)),
  }));
  return {
    roomId: room.id,
    mode: room.mode.id,
    map: room.mapId,
    reason,
    winnerTeam,
    winners,
    teamScores: room.mode.teams ? [room.teamScores[0], room.teamScores[1]] : null,
    players: results,
    durationSec: Math.max(0, room.time - room.matchStartTime),
    ext: {},
  };
}

/** The team with fewer players (ties: lower score, then team 0). */
export function smallerTeam(room: Room, except?: PlayerState): Team {
  const n = [0, 0];
  for (const p of room.players.values()) if (p !== except && p.team !== null) n[p.team]! += 1;
  if (n[0] !== n[1]) return n[0]! < n[1]! ? 0 : 1;
  return room.teamScores[0] <= room.teamScores[1] ? 0 : 1;
}
