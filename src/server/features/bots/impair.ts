/**
 * Skill modifiers: how other features make a bot better or worse for a while without touching the
 * brain (the Glitch killstreak degrades the glitched side's bots through these).
 *
 *   room.modifiers.add('botSkillMultiplier', (bot, knob) => (glitched(bot) && knob === 'reactionMs' ? 1.8 : undefined), 'killstreaks.glitch');
 *   room.modifiers.add('botSkillOffset', (bot, knob) => (glitched(bot) && knob === 'aimErrorDeg' ? 5 : undefined), 'killstreaks.glitch');
 *   room.modifiers.add('botFrozen', (bot) => (stuttering(bot) ? true : undefined), 'killstreaks.glitch');
 *
 * The brain reads `effectiveSkill` once per tick (knob x product of multipliers + sum of offsets,
 * clamped to the slider ranges) and uses it for perception, noticing, aim and hearing; while
 * `botFrozen` votes true it stands still with its aim held and doesn't fire.
 */
import { BOT_SKILL_RANGES, type BotSkill } from '../../../shared/defs/bots';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { SKILL_KEYS } from './skill';

declare module '../../modifiers' {
  interface ModifierMap {
    /** Multiplies a bot's skill knob (product). Lower `reactionMs` / `aimErrorDeg` is better. */
    botSkillMultiplier: (bot: PlayerState, knob: keyof BotSkill) => number | undefined;
    /** Adds to a bot's skill knob after the multipliers (sum). */
    botSkillOffset: (bot: PlayerState, knob: keyof BotSkill) => number | undefined;
    /** true = the bot is frozen this tick: no movement, no fire, aim held (any). */
    botFrozen: (bot: PlayerState) => boolean | undefined;
  }
}

/** The skill a bot plays with this tick: its own skill through the skill modifiers, clamped to the ranges. */
export function effectiveSkill(room: Room, bot: PlayerState, base: BotSkill): BotSkill {
  let out: BotSkill | null = null;
  for (const k of SKILL_KEYS) {
    const mul = room.modifiers.mul('botSkillMultiplier', bot, k);
    const add = room.modifiers.sum('botSkillOffset', bot, k);
    if (mul === 1 && add === 0) continue;
    const [lo, hi] = BOT_SKILL_RANGES[k];
    out ??= { ...base };
    out[k] = Math.min(hi, Math.max(lo, base[k] * mul + add));
  }
  return out ?? base;
}

/** Is the bot frozen by a skill modifier this tick? */
export const botFrozen = (room: Room, bot: PlayerState): boolean => room.modifiers.any('botFrozen', bot) === true;
