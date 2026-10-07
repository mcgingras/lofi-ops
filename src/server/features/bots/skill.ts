/**
 * Bot skill helpers: validating LobbyBotSettings from the network, per-bot variance, and the
 * derived numbers the brain uses. Pure (no room state) so the rules are unit-tested directly.
 */
import { BOT_DIFFICULTY_BY_ID, BOT_SKILL_RANGES, DEFAULT_LOBBY_BOTS, DEFAULT_TARGET_PLAYERS, skillFor, type BotSkill, type LobbyBotSettings } from '../../../shared/defs/bots';
import { clamp } from '../../../shared/math';

export const SKILL_KEYS = Object.keys(BOT_SKILL_RANGES) as (keyof BotSkill)[];

/** Knobs where a smaller number is a better bot. */
const LOWER_IS_BETTER: ReadonlySet<keyof BotSkill> = new Set(['reactionMs', 'aimErrorDeg']);

export function clampSkill(s: Partial<Record<keyof BotSkill, unknown>>, base: BotSkill): BotSkill {
  const out = { ...base };
  for (const k of SKILL_KEYS) {
    const v = s[k];
    const [lo, hi] = BOT_SKILL_RANGES[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = clamp(v, lo, hi);
  }
  return out;
}

/** Default lobby settings for a mode (target from DEFAULT_TARGET_PLAYERS, capped at the room size). */
export function defaultSettings(modeId: string, maxPlayers: number): LobbyBotSettings {
  return { ...DEFAULT_LOBBY_BOTS, targetPlayers: Math.min(maxPlayers, DEFAULT_TARGET_PLAYERS[modeId] ?? maxPlayers) };
}

/**
 * Merge an untrusted partial settings object onto `base`. Unknown/invalid fields are ignored,
 * numbers are clamped, a custom skill is always complete (missing knobs from the current skill).
 */
export function sanitizeSettings(input: unknown, base: LobbyBotSettings, maxPlayers: number): LobbyBotSettings {
  const src = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof LobbyBotSettings, unknown>>;
  const out: LobbyBotSettings = { ...base, custom: base.custom ? { ...base.custom } : undefined };
  if (typeof src.fill === 'boolean') out.fill = src.fill;
  if (typeof src.targetPlayers === 'number' && Number.isFinite(src.targetPlayers)) out.targetPlayers = clamp(Math.round(src.targetPlayers), 0, maxPlayers);
  out.targetPlayers = clamp(out.targetPlayers, 0, maxPlayers);
  if (typeof src.variance === 'number' && Number.isFinite(src.variance)) out.variance = clamp(src.variance, 0, 1);
  if (src.difficulty === 'custom' || (typeof src.difficulty === 'string' && BOT_DIFFICULTY_BY_ID.has(src.difficulty))) out.difficulty = src.difficulty as LobbyBotSettings['difficulty'];
  if (src.custom && typeof src.custom === 'object') out.custom = clampSkill(src.custom as Record<string, unknown>, out.custom ?? skillFor({ ...base, difficulty: base.difficulty === 'custom' ? 'regular' : base.difficulty }));
  if (out.difficulty === 'custom' && !out.custom) out.custom = skillFor({ ...base, difficulty: 'regular' });
  if (out.difficulty !== 'custom' && out.custom === undefined) delete out.custom;
  return out;
}

/** Deterministic per-bot rolls (so a bot keeps its personality when the host changes difficulty). */
export interface BotRolls {
  /** -1..1: this bot's overall form (better or worse than the preset in every knob). */
  form: number;
  /** -1..1 per knob: a little independent jitter. */
  knobs: Record<keyof BotSkill, number>;
}

export function rollBot(rnd: () => number = Math.random): BotRolls {
  const knobs = {} as Record<keyof BotSkill, number>;
  for (const k of SKILL_KEYS) knobs[k] = rnd() * 2 - 1;
  return { form: rnd() * 2 - 1, knobs };
}

/**
 * The skill a bot plays with: the lobby's skill jittered by `variance` (0..1). With variance 1 a
 * knob moves up to +-35% of its slider range; 60% of the jitter is the bot's overall form (so a
 * "good day" bot is better at everything), 40% independent per knob. Always inside the ranges.
 */
export function applyVariance(skill: BotSkill, variance: number, rolls: BotRolls): BotSkill {
  const v = clamp(variance, 0, 1);
  if (v <= 0) return { ...skill };
  const out = { ...skill };
  for (const k of SKILL_KEYS) {
    const [lo, hi] = BOT_SKILL_RANGES[k];
    const better = LOWER_IS_BETTER.has(k) ? -1 : 1;
    const j = 0.6 * rolls.form + 0.4 * rolls.knobs[k];
    out[k] = clamp(skill[k] + better * j * v * 0.35 * (hi - lo), lo, hi);
  }
  return out;
}

/** 0..1 overall rating of a skill (for loadout choice, logs): 0 = recruit-ish, 1 = veteran-ish. */
export function skillRating(s: BotSkill): number {
  const r = (k: keyof BotSkill) => {
    const [lo, hi] = BOT_SKILL_RANGES[k];
    const t = (s[k] - lo) / (hi - lo);
    return LOWER_IS_BETTER.has(k) ? 1 - t : t;
  };
  return clamp((r('reactionMs') * 2 + r('aimErrorDeg') * 2 + r('turnSpeedDeg') + r('headshotBias') + r('strafe') + r('burstControl')) / 8, 0, 1);
}
