/**
 * Progression's typed extensions to the room bus and player state. Other areas report into
 * progression with the two input events; progression emits the two output events.
 */
import type { MetricContext } from '../../../shared/defs/challenges';
import type { ChallengeProgressLine, XpLine } from '../../../shared/defs/progression';
import type { UnlockEntry } from '../../../shared/defs/unlocks';
// RPC / push types (a side-effect import so every program that reaches this feature sees them).
import '../../../shared/defs/progression-messages';

declare module '../../../shared/events' {
  interface RoomEvents<P> {
    /**
     * Input: count a challenge metric for a player ('streak_called', 'obj.capture', ...). `amount`
     * defaults to 1. Filters (weapon, killstreak, means) are matched against challenge defs; mode,
     * perks and attachments are filled in by progression.
     */
    'progression.metric': { player: P; metric: string; amount?: number } & Pick<MetricContext, 'weapon' | 'killstreak' | 'means'>;
    /** Input: award XP for something progression does not hear on its own. */
    'progression.xp': { player: P; amount: number; label: string; key?: string };
    /** Output: a player reached a new level. */
    'progression.levelUp': { player: P; level: number; prestige: number };
    /** Output: a player completed a challenge tier (1-based). */
    'progression.challengeComplete': { player: P; id: string; tier: number };
  }
}

/** Per-player, per-match progression state (`player.ext.progression`). */
export interface PlayerProgress {
  xpStart: number;
  levelStart: number;
  /** XP earned this match (before the level-50 clamp). */
  earned: number;
  lines: Map<string, XpLine>;
  challenges: Map<string, ChallengeProgressLine>;
  unlocked: UnlockEntry[];
  codPoints: number;
  /** Gains not yet pushed to the client (flushed each tick). */
  pending: [string, number][];
  killTimes: number[];
  deathsSinceKill: number;
  lastKiller: string | null;
}

declare module '../../player' {
  interface PlayerExt {
    progression?: PlayerProgress;
  }
}

export {};
