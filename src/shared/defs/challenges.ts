/**
 * Challenges (owner: progression feature). Per game mode and per weapon; completing a tier awards
 * XP (and CoD Points). Progress lives in `profile.challengeProgress[id]` (a number for the metric).
 */
import { indexById } from './registry';

/**
 * What a challenge counts. Core-tracked metrics come from match stats; features may add their own
 * metric strings (e.g. 'dom_captures') and increment them themselves.
 */
export type ChallengeMetric = 'kills' | 'headshots' | 'assists' | 'wins' | 'matches' | 'score' | 'killstreak' | 'longshots' | (string & {});

export interface ChallengeDef {
  id: string;
  name: string;
  description?: string;
  /** Only counts in this mode. */
  mode?: string;
  /** Only counts with this weapon. */
  weapon?: string;
  metric: ChallengeMetric;
  /** Goal of the first tier. */
  goal: number;
  /** Goals for successive tiers (includes the first). */
  tiers?: number[];
  xp: number;
  codPoints?: number;
}

export const CHALLENGES: ChallengeDef[] = [
  { id: 'tdm_kills', name: 'Team Player', description: 'Get kills in Team Deathmatch.', mode: 'tdm', metric: 'kills', goal: 50, tiers: [50, 150, 500], xp: 1000, codPoints: 100 },
];

export const CHALLENGE_BY_ID = indexById(CHALLENGES);
