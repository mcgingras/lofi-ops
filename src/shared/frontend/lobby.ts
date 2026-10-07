/**
 * Per-game lobby rules shared by the server's lobby manager and the client lobby UI (owner:
 * frontend). Pure: lobby codes, map vote options and tally, bot settings validation, score/time
 * limit options and the lobby status line.
 */
import type { Team } from '../constants';
import { BOT_DIFFICULTY_BY_ID, BOT_SKILL_RANGES, DEFAULT_LOBBY_BOTS, DEFAULT_TARGET_PLAYERS, type BotSkill, type LobbyBotSettings } from '../defs/bots';
import type { ModeDef } from '../defs/modes';
import type { MatchPhase } from '../events';

// ---------------------------------------------------------------------------------------------
// State pushed to clients (`frontend.lobby`)
// ---------------------------------------------------------------------------------------------

export type LobbyKind = 'matchmade' | 'private';

export interface LobbyPlayerInfo {
  id: string;
  name: string;
  level: number;
  prestige: number;
  /** Emblem id (progression), e.g. `prestige_3`; null = none. */
  emblem: string | null;
  /** Round trip in ms as reported by the client; null = unknown. */
  ping: number | null;
  ready: boolean;
  host: boolean;
  bot: boolean;
  team: Team | null;
}

export interface LobbyVoteInfo {
  /** Map ids; the last one may be `random`. */
  options: string[];
  counts: number[];
  /** Player id -> option index. */
  votes: Record<string, number>;
}

export type LobbyStatus = 'waiting' | 'countdown' | 'inMatch' | 'results';

export interface LobbyLimits {
  scoreLimit: number;
  timeLimitSec: number;
}

export interface LobbyState {
  roomId: string;
  code: string;
  kind: LobbyKind;
  playlist: string | null;
  mode: string;
  map: string;
  phase: MatchPhase;
  status: LobbyStatus;
  hostId: string | null;
  players: LobbyPlayerInfo[];
  maxPlayers: number;
  limits: LobbyLimits;
  bots: LobbyBotSettings;
  /** Bots that will join when the match starts (or are in it). */
  botsToFill: number;
  vote: LobbyVoteInfo | null;
  /** Room time the wait for humans ends (then it starts with bots), or null. */
  waitEndsAt: number | null;
  /** Room time the match starts, or null. */
  countdownEndsAt: number | null;
  /** Room time this state was sent (for the client's timers). */
  time: number;
}

export const RANDOM_MAP = 'random';

// ---------------------------------------------------------------------------------------------
// Lobby codes
// ---------------------------------------------------------------------------------------------

/** No 0/O/1/I/L so codes read back cleanly. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function makeLobbyCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  return s;
}

/** Clean up a typed or pasted code (or invite URL); null if it can't be a code. */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 512) return null;
  const fromUrl = /[?&#]code=([A-Za-z0-9-]+)/.exec(input);
  const raw = (fromUrl ? fromUrl[1]! : input).toUpperCase().replace(/[\s-]/g, '');
  if (raw.length !== CODE_LENGTH) return null;
  for (const c of raw) if (!CODE_ALPHABET.includes(c)) return null;
  return raw;
}

// ---------------------------------------------------------------------------------------------
// Map vote
// ---------------------------------------------------------------------------------------------

/**
 * Two map choices plus "random". Prefers maps other than `current`; with a single map the options
 * are that map and random.
 */
export function voteOptions(maps: readonly string[], current: string | null, rand: () => number = Math.random): string[] {
  const pool = [...new Set(maps)];
  if (pool.length === 0) return [RANDOM_MAP];
  const fresh = pool.filter((m) => m !== current);
  const candidates = fresh.length >= 2 ? fresh : pool;
  const a = candidates.splice(Math.floor(rand() * candidates.length) % candidates.length, 1)[0]!;
  if (!candidates.length) return [a, RANDOM_MAP];
  const b = candidates[Math.floor(rand() * candidates.length) % candidates.length]!;
  return [a, b, RANDOM_MAP];
}

export function voteCounts(options: readonly string[], votes: Iterable<number>): number[] {
  const counts = options.map(() => 0);
  for (const v of votes) if (Number.isInteger(v) && v >= 0 && v < counts.length) counts[v]! += 1;
  return counts;
}

/**
 * The winning map: most votes; a tie goes to the earliest tied option (no votes: the first
 * option). "random" resolves to any of `maps` (rule after Blockyard's next-match vote).
 */
export function tallyVote(options: readonly string[], votes: Iterable<number>, maps: readonly string[], rand: () => number = Math.random): string {
  const counts = voteCounts(options, votes);
  let best = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i]! > counts[best]!) best = i;
  const pick = options[best] ?? RANDOM_MAP;
  if (pick !== RANDOM_MAP) return pick;
  const pool = maps.length ? maps : options.filter((o) => o !== RANDOM_MAP);
  return pool[Math.floor(rand() * pool.length) % pool.length] ?? 'yard';
}

// ---------------------------------------------------------------------------------------------
// Bot settings
// ---------------------------------------------------------------------------------------------

export const SKILL_KEYS = Object.keys(BOT_SKILL_RANGES) as (keyof BotSkill)[];

export const SKILL_LABELS: Record<keyof BotSkill, string> = {
  reactionMs: 'Reaction time',
  aimErrorDeg: 'Aim error',
  turnSpeedDeg: 'Turn speed',
  headshotBias: 'Headshots',
  fovDeg: 'Field of view',
  hearingRange: 'Hearing',
  strafe: 'Strafing',
  burstControl: 'Burst control',
  objectivePlay: 'Objective play',
  streakUse: 'Streak use',
  aggression: 'Aggression',
  weaponPickup: 'Weapon pickups',
};

/** Format a skill value for a slider label. */
export function formatSkill(key: keyof BotSkill, v: number): string {
  if (key === 'reactionMs') return `${Math.round(v)} ms`;
  if (key === 'aimErrorDeg') return `${v.toFixed(1)}°`;
  if (key === 'turnSpeedDeg') return `${Math.round(v)}°/s`;
  if (key === 'fovDeg') return `${Math.round(v)}°`;
  if (key === 'hearingRange') return `${Math.round(v)} m`;
  return `${Math.round(v * 100)}%`;
}

/** Lower is better for these knobs (the UI flips the "skill" direction). */
export const SKILL_LOWER_IS_BETTER: ReadonlySet<keyof BotSkill> = new Set(['reactionMs', 'aimErrorDeg']);

/** Clamp + snap one skill value to its slider range. */
export function clampSkill(key: keyof BotSkill, v: unknown, fallback: number): number {
  const [min, max, step] = BOT_SKILL_RANGES[key];
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const snapped = Math.round((Math.min(max, Math.max(min, n)) - min) / step) * step + min;
  return Number(Math.min(max, snapped).toFixed(4));
}

export function presetSkill(id: string): BotSkill {
  const d = BOT_DIFFICULTY_BY_ID.get(id) ?? BOT_DIFFICULTY_BY_ID.get('regular')!;
  return { ...d.skill };
}

/** Default bot settings for a mode (playlist default: regular, per-mode target, capped at max). */
export function defaultBotSettings(mode: Pick<ModeDef, 'id' | 'maxPlayers'>): LobbyBotSettings {
  return { ...DEFAULT_LOBBY_BOTS, targetPlayers: Math.min(mode.maxPlayers, DEFAULT_TARGET_PLAYERS[mode.id] ?? mode.maxPlayers) };
}

/**
 * Validate an untrusted (partial) bot settings patch on top of `prev`. Unknown fields are
 * ignored; numbers are clamped; `custom` is always filled in when difficulty is custom.
 */
export function sanitizeBotSettings(input: unknown, prev: LobbyBotSettings, maxPlayers: number): LobbyBotSettings {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: LobbyBotSettings = { ...prev, custom: prev.custom ? { ...prev.custom } : undefined };
  if (typeof src.fill === 'boolean') out.fill = src.fill;
  if (typeof src.targetPlayers === 'number' && Number.isFinite(src.targetPlayers)) out.targetPlayers = Math.round(src.targetPlayers);
  out.targetPlayers = Math.max(1, Math.min(Math.max(1, maxPlayers), out.targetPlayers));
  if (typeof src.difficulty === 'string' && (src.difficulty === 'custom' || BOT_DIFFICULTY_BY_ID.has(src.difficulty))) out.difficulty = src.difficulty as LobbyBotSettings['difficulty'];
  if (typeof src.variance === 'number' && Number.isFinite(src.variance)) out.variance = Math.round(Math.min(1, Math.max(0, src.variance)) * 100) / 100;
  if (out.difficulty === 'custom') {
    const base = out.custom ?? presetSkill(prev.difficulty === 'custom' ? 'regular' : prev.difficulty);
    const patch = (src.custom && typeof src.custom === 'object' ? src.custom : {}) as Record<string, unknown>;
    const custom = {} as BotSkill;
    for (const k of SKILL_KEYS) custom[k] = clampSkill(k, patch[k] ?? base[k], base[k]);
    out.custom = custom;
  }
  return out;
}

/** Bots needed to reach the target with `humans` humans in the room. */
export function botsToFill(s: LobbyBotSettings, humans: number, maxPlayers: number): number {
  if (!s.fill) return 0;
  return Math.max(0, Math.min(s.targetPlayers, maxPlayers) - humans);
}

/** 0..1 overall "how good" a skill is (for the preset summary bar). */
export function skillRating(s: BotSkill): number {
  let sum = 0;
  for (const k of SKILL_KEYS) {
    const [min, max] = BOT_SKILL_RANGES[k];
    const t = (s[k] - min) / (max - min);
    sum += SKILL_LOWER_IS_BETTER.has(k) ? 1 - t : t;
  }
  return sum / SKILL_KEYS.length;
}

// ---------------------------------------------------------------------------------------------
// Score / time limits (private lobbies)
// ---------------------------------------------------------------------------------------------

export const MAX_SCORE_LIMIT = 10000;
export const MAX_TIME_LIMIT_SEC = 3600;

export function clampLimits(mode: Pick<ModeDef, 'scoreLimit' | 'timeLimitSec'>, input: unknown, prev?: LobbyLimits): LobbyLimits {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const base = prev ?? { scoreLimit: mode.scoreLimit, timeLimitSec: mode.timeLimitSec };
  const num = (v: unknown, fb: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(0, v))) : fb);
  return { scoreLimit: num(src.scoreLimit, base.scoreLimit, MAX_SCORE_LIMIT), timeLimitSec: num(src.timeLimitSec, base.timeLimitSec, MAX_TIME_LIMIT_SEC) };
}

/** Score limit choices for the host (0 = unlimited). */
export function scoreLimitOptions(mode: Pick<ModeDef, 'scoreLimit'>): number[] {
  const d = mode.scoreLimit;
  if (d <= 0) return [0, 10, 25, 50, 100];
  // Halves and one-and-a-halves round to a multiple of 5 for big limits (TDM 75 -> 40/115, not 38/113).
  const nice = (v: number) => Math.max(1, d >= 20 ? Math.round(v / 5) * 5 : Math.round(v));
  return [...new Set([nice(d * 0.5), d, nice(d * 1.5), d * 2, 0])];
}

export function timeLimitOptions(mode: Pick<ModeDef, 'timeLimitSec'>): number[] {
  return [...new Set([300, 600, 900, 1200, 1800, mode.timeLimitSec, 0])].sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b));
}

// ---------------------------------------------------------------------------------------------
// Status line
// ---------------------------------------------------------------------------------------------

/** The lobby's headline ("Waiting for players... starting with bots in 12s"). `now` is room time. */
export function lobbyStatusText(s: Pick<LobbyState, 'status' | 'kind' | 'waitEndsAt' | 'countdownEndsAt' | 'botsToFill' | 'hostId' | 'bots'>, now: number): string {
  const secs = (t: number) => Math.max(0, Math.ceil(t - now));
  if (s.status === 'inMatch') return 'Match in progress';
  if (s.status === 'results') return 'Match over';
  if (s.countdownEndsAt !== null) return `Match starting in ${secs(s.countdownEndsAt)}s`;
  if (s.kind === 'matchmade' && s.waitEndsAt !== null) {
    return s.botsToFill > 0 && s.bots.fill ? `Waiting for players... starting with bots in ${secs(s.waitEndsAt)}s` : `Waiting for players... starting in ${secs(s.waitEndsAt)}s`;
  }
  if (s.kind === 'private') return s.hostId ? 'Waiting for the host to start' : 'Waiting for players';
  return 'Waiting for players...';
}
