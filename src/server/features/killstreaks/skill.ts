/**
 * How good a bot is with killstreaks: `BotSkill.streakUse` (0..1, src/shared/defs/bots.ts). The bots
 * feature sets `player.ext.killstreaks.botStreakUse` (or keeps its skill at `player.ext.bots.skill`,
 * which is read too); without either, the lobby default preset ('regular') is used.
 */
import { DEFAULT_LOBBY_BOTS, skillFor } from '../../../shared/defs/bots';
import type { PlayerState } from '../../player';

const DEFAULT_STREAK_USE = skillFor(DEFAULT_LOBBY_BOTS).streakUse;

export function botStreakSkill(p: PlayerState): number {
  const own = p.ext.killstreaks?.botStreakUse;
  if (typeof own === 'number' && Number.isFinite(own)) return clamp01(own);
  const bots = (p.ext as Record<string, unknown>)['bots'];
  if (bots && typeof bots === 'object') {
    const skill = (bots as { skill?: unknown }).skill;
    const v = skill && typeof skill === 'object' ? (skill as { streakUse?: unknown }).streakUse : undefined;
    if (typeof v === 'number' && Number.isFinite(v)) return clamp01(v);
  }
  return DEFAULT_STREAK_USE;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
