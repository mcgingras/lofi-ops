/**
 * Levels, XP, ranks and prestige (owner: progression feature). Pure rules over a profile-shaped
 * object, shared by the server (awards) and the client (Barracks, HUD).
 *
 * Levels 1-50. XP to go from level L to L+1 is 800 + 1050 * (L - 1): 800 XP for level 2,
 * 1,274,000 XP total for level 50. Prestige 0-15: at level 50 you may prestige, which resets
 * level/XP and level unlocks (and per-weapon attachment progress), keeps CoD Points, challenge
 * records and the combat record, and grants an emblem.
 *
 * Unlock tables and loadout gating live in unlocks.ts, challenges in challenges.ts.
 */
import type { UnlockEntry } from './unlocks';

export const MAX_LEVEL = 50;
export const MAX_PRESTIGE = 15;

/** XP needed to go from `level` to `level + 1` (0 at max). */
export const xpToNext = (level: number) => (level >= MAX_LEVEL ? 0 : 800 + 1050 * (level - 1));

/** XP_TABLE[level] = total XP at which `level` starts (XP_TABLE[1] = 0). Index 0 unused. */
export const XP_TABLE: readonly number[] = (() => {
  const t = [0, 0];
  for (let l = 2; l <= MAX_LEVEL; l++) t.push(t[l - 1]! + xpToNext(l - 1));
  return t;
})();

export const xpForLevel = (level: number) => XP_TABLE[Math.max(1, Math.min(MAX_LEVEL, level))]!;

export function levelForXp(xp: number): number {
  let l = 1;
  while (l < MAX_LEVEL && xp >= XP_TABLE[l + 1]!) l++;
  return l;
}

/** Fraction 0..1 through the current level (1 at max). */
export function levelProgress(xp: number): number {
  const l = levelForXp(xp);
  if (l >= MAX_LEVEL) return 1;
  return (xp - XP_TABLE[l]!) / xpToNext(l);
}

/** XP per action (BO1-style). Modes may give objective values through OBJECTIVE_XP or `data.xp`. */
export const XP_SOURCES = {
  kill: 100,
  headshot: 50,
  assist: 50,
  /** Generic objective action when the kind has no entry in OBJECTIVE_XP. */
  objective: 200,
  /** Match bonus: per second played (capped at MATCH_BONUS_CAP_SEC), and for winning. */
  matchPerSecond: 1,
  matchWin: 500,
  /** Flat bonus for finishing a match you played at least MIN_MATCH_SEC of. */
  matchComplete: 100,
  /** FFA-style placing bonus for 1st / 2nd / 3rd. */
  place: [300, 200, 100] as readonly number[],
  longshot: 50,
  firstBlood: 100,
  revenge: 50,
  /** A kill after COMEBACK_DEATHS or more deaths without one. */
  comeback: 50,
  /** Ending an enemy's streak of BUZZKILL_STREAK or more. */
  buzzkill: 50,
  doubleKill: 50,
  tripleKill: 100,
  /** Four or more within the window. */
  multiKill: 150,
  /** Every 5 kills without dying: this x (streak / 5). */
  streakBonus: 100,
  /** Challenge XP comes from the ChallengeDef. */
};

/** Bots carry no profile and never earn; killing a bot is worth this fraction of the XP for a human. */
export const BOT_KILL_XP_MULT = 1;
/** Bullet kills from at least this far are long shots (metres). */
export const LONGSHOT_M = 35;
/** Bullet kills from this close are point blank (metres). */
export const POINT_BLANK_M = 3;
/** Kills this close together (seconds) chain into a double / triple / multi kill. */
export const MULTI_WINDOW_SEC = 3;
export const COMEBACK_DEATHS = 3;
export const BUZZKILL_STREAK = 3;
/** The time-played bonus stops counting after this many seconds of a match. */
export const MATCH_BONUS_CAP_SEC = 900;
/** Matches shorter than this (for the player) get no completion or placing bonus. */
export const MIN_MATCH_SEC = 30;

// ---------------------------------------------------------------------------------------------
// Objectives (modes emit `objective { kind, team, player, data? }`)
// ---------------------------------------------------------------------------------------------

/**
 * Canonical objective kinds and their XP. Modes emit these kinds (or an alias below); a mode can
 * override the value per event with `data: { xp: number }` (0 for bookkeeping-only events).
 */
export const OBJECTIVE_XP: Record<string, number> = {
  // Domination
  capture: 200,
  /** Killing an enemy on or near a flag you hold. */
  defend: 100,
  /** Taking an enemy flag to neutral. */
  neutralize: 100,
  /** Being on a flag while a teammate captures it. */
  assist_capture: 50,
  // Search and Destroy
  plant: 500,
  defuse: 500,
  /** Killing the bomb carrier / planter / defuser. */
  carrier_kill: 100,
  last_alive: 50,
  round_win: 100,
  // Headquarters
  hq_capture: 300,
  hq_destroy: 300,
  hq_defend: 100,
  // Kill Confirmed
  confirm: 100,
  deny: 50,
  // Wager modes
  promote: 50,
  humiliate: 100,
  bankrupt: 100,
  survive: 50,
};

/** Other spellings modes might use, mapped to the canonical kind. */
export const OBJECTIVE_ALIASES: Record<string, string> = {
  dom_capture: 'capture',
  flag_capture: 'capture',
  dom_defend: 'defend',
  flag_defend: 'defend',
  dom_neutralize: 'neutralize',
  bomb_plant: 'plant',
  sd_plant: 'plant',
  bomb_defuse: 'defuse',
  sd_defuse: 'defuse',
  hq_captured: 'hq_capture',
  hq_destroyed: 'hq_destroy',
  kc_confirm: 'confirm',
  tag_confirm: 'confirm',
  kc_deny: 'deny',
  tag_deny: 'deny',
  gungame_promote: 'promote',
  gungame_humiliate: 'humiliate',
  sticks_bankrupt: 'bankrupt',
  oitc_survive: 'survive',
};

export const OBJECTIVE_LABELS: Record<string, string> = {
  capture: 'CAPTURE',
  defend: 'DEFEND',
  neutralize: 'NEUTRALIZE',
  assist_capture: 'CAPTURE ASSIST',
  plant: 'BOMB PLANTED',
  defuse: 'BOMB DEFUSED',
  carrier_kill: 'CARRIER KILL',
  last_alive: 'LAST ALIVE',
  round_win: 'ROUND WIN',
  hq_capture: 'HQ CAPTURED',
  hq_destroy: 'HQ DESTROYED',
  hq_defend: 'HQ DEFEND',
  confirm: 'KILL CONFIRMED',
  deny: 'KILL DENIED',
  promote: 'PROMOTED',
  humiliate: 'HUMILIATION',
  bankrupt: 'BANKRUPTED',
  survive: 'SURVIVOR',
};

export const canonicalObjective = (kind: string) => OBJECTIVE_ALIASES[kind] ?? kind;

/** XP for one objective event: `data.xp` if the mode set it, else the table, else the generic value. */
export function objectiveXp(kind: string, data?: unknown): number {
  const x = data && typeof data === 'object' ? (data as { xp?: unknown }).xp : undefined;
  if (typeof x === 'number' && Number.isFinite(x)) return Math.max(0, Math.round(x));
  return OBJECTIVE_XP[canonicalObjective(kind)] ?? XP_SOURCES.objective;
}

export const objectiveLabel = (kind: string) => OBJECTIVE_LABELS[canonicalObjective(kind)] ?? kind.replace(/[_.]/g, ' ').toUpperCase();

// ---------------------------------------------------------------------------------------------
// Ranks (titles for levels 1-50, BO1 style)
// ---------------------------------------------------------------------------------------------

export interface RankDef {
  /** Index into RANKS (insignia group). */
  group: number;
  title: string;
  short: string;
  /** First level of this rank. */
  from: number;
}

export const RANKS: readonly RankDef[] = [
  { group: 0, title: 'Private', short: 'PVT', from: 1 },
  { group: 1, title: 'Private First Class', short: 'PFC', from: 4 },
  { group: 2, title: 'Specialist', short: 'SPC', from: 7 },
  { group: 3, title: 'Corporal', short: 'CPL', from: 10 },
  { group: 4, title: 'Sergeant', short: 'SGT', from: 13 },
  { group: 5, title: 'Staff Sergeant', short: 'SSGT', from: 16 },
  { group: 6, title: 'Sergeant First Class', short: 'SFC', from: 19 },
  { group: 7, title: 'Master Sergeant', short: 'MSGT', from: 22 },
  { group: 8, title: 'First Sergeant', short: '1SG', from: 25 },
  { group: 9, title: 'Sergeant Major', short: 'SGM', from: 28 },
  { group: 10, title: 'Command Sergeant Major', short: 'CSM', from: 31 },
  { group: 11, title: 'Second Lieutenant', short: '2LT', from: 34 },
  { group: 12, title: 'First Lieutenant', short: '1LT', from: 36 },
  { group: 13, title: 'Captain', short: 'CPT', from: 38 },
  { group: 14, title: 'Major', short: 'MAJ', from: 40 },
  { group: 15, title: 'Lieutenant Colonel', short: 'LTC', from: 42 },
  { group: 16, title: 'Colonel', short: 'COL', from: 44 },
  { group: 17, title: 'Brigadier General', short: 'BG', from: 46 },
  { group: 18, title: 'Major General', short: 'MG', from: 48 },
  { group: 19, title: 'Lieutenant General', short: 'LTG', from: 49 },
  { group: 20, title: 'Commander', short: 'CDR', from: 50 },
];

/** Rank for a level, with the step within it (I, II, III). */
export function rankFor(level: number): RankDef & { step: number } {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  let r = RANKS[0]!;
  for (const x of RANKS) if (x.from <= l) r = x;
  return { ...r, step: l - r.from + 1 };
}

// ---------------------------------------------------------------------------------------------
// Prestige
// ---------------------------------------------------------------------------------------------

export interface ProgressionFields {
  xp: number;
  level: number;
  prestige: number;
  unlocks: string[];
}

export const canPrestige = (p: ProgressionFields) => p.level >= MAX_LEVEL && p.prestige < MAX_PRESTIGE;

/** Emblem id granted when reaching a prestige. */
export const prestigeEmblem = (prestige: number) => `prestige_${prestige}`;

/** Display names of the 15 prestige tiers (the emblems are drawn procedurally by the client). */
export const PRESTIGE_NAMES: readonly string[] = [
  'Recruit', // prestige 0 (no emblem)
  'Iron Chevron',
  'Twin Chevron',
  'Triple Chevron',
  'Bronze Shield',
  'Silver Shield',
  'Gold Shield',
  'Laurel',
  'Silver Laurel',
  'Gold Laurel',
  'Death’s Head',
  'Winged Skull',
  'Crowned Skull',
  'Black Star',
  'Red Star',
  'Master Prestige',
];

/**
 * Apply prestige in place: level 1, XP 0, level unlocks cleared (prestige emblems kept), prestige+1.
 * CoD Points and challenge progress are untouched (they live elsewhere on the profile). The server
 * feature also clears per-weapon attachment progress (`ext.progression.weaponKills`).
 */
export function applyPrestige<T extends ProgressionFields>(p: T): T {
  if (!canPrestige(p)) return p;
  p.prestige += 1;
  p.level = 1;
  p.xp = 0;
  p.unlocks = p.unlocks.filter((u) => u.startsWith('prestige_'));
  p.unlocks.push(prestigeEmblem(p.prestige));
  return p;
}

/** Add XP in place and return the levels gained (empty if none). Clamps at max level XP. */
export function addXp<T extends ProgressionFields>(p: T, amount: number): number[] {
  const before = p.level;
  p.xp = Math.min(XP_TABLE[MAX_LEVEL]!, p.xp + Math.max(0, Math.round(amount)));
  p.level = levelForXp(p.xp);
  const gained: number[] = [];
  for (let l = before + 1; l <= p.level; l++) gained.push(l);
  return gained;
}

// ---------------------------------------------------------------------------------------------
// Feature-private profile data (`profile.ext.progression`)
// ---------------------------------------------------------------------------------------------

export interface ProgressionExt {
  /** Kills per weapon id since the last prestige (attachment unlocks; reset on prestige). */
  weaponKills: Record<string, number>;
  /** Selected prestige emblem id to display (`prestige_N`), if any. */
  emblem?: string;
  /** The last match's XP summary (Barracks / end-of-match screens). */
  lastMatch?: MatchXpSummary;
}

/** Read (creating if needed) the progression block on a profile-like object. */
export function progressionExt(p: { ext: Record<string, unknown> }): ProgressionExt {
  let e = p.ext.progression as ProgressionExt | undefined;
  if (!e || typeof e !== 'object') p.ext.progression = e = { weaponKills: {} };
  if (!e.weaponKills || typeof e.weaponKills !== 'object') e.weaponKills = {};
  return e;
}

/** Same as `progressionExt` without mutating (client side, read only). */
export function readProgressionExt(p: { ext: Record<string, unknown> } | null | undefined): ProgressionExt {
  const e = p?.ext?.progression as Partial<ProgressionExt> | undefined;
  return { weaponKills: e?.weaponKills ?? {}, emblem: e?.emblem, lastMatch: e?.lastMatch };
}

// ---------------------------------------------------------------------------------------------
// Match summary (results.ext.progression[playerId], `progression.summary` push)
// ---------------------------------------------------------------------------------------------

/** One line of the end-of-match XP breakdown. */
export interface XpLine {
  /** Stable key ('kill', 'headshot', 'obj.capture', 'challenge', 'match', 'win'...). */
  key: string;
  label: string;
  count: number;
  xp: number;
}

/** A challenge that moved this match. */
export interface ChallengeProgressLine {
  id: string;
  name: string;
  /** Progress at match start and now. */
  before: number;
  after: number;
  /** Goal of the tier being worked on now (the last goal once all are done). */
  goal: number;
  /** Tiers complete now, and in total. */
  tiersDone: number;
  tiers: number;
  /** Tiers completed during this match (1-based tier numbers). */
  completedTiers: number[];
  xp: number;
  codPoints: number;
}

export interface MatchXpSummary {
  playerId: string;
  profileId: string;
  mode: string;
  /** Total XP earned this match (before the level-50 clamp). */
  total: number;
  xpBefore: number;
  xpAfter: number;
  levelBefore: number;
  levelAfter: number;
  prestige: number;
  /** Breakdown, biggest first. */
  lines: XpLine[];
  /** Challenges progressed (completed ones first). */
  challenges: ChallengeProgressLine[];
  /** Everything unlocked during the match (level-ups, attachments, pro perks). */
  unlocked: UnlockEntry[];
  /** CoD Points earned from challenges this match. */
  codPoints: number;
}

/** The progression summary for a player in a match's results (null if they earned nothing / bot). */
export function matchSummaryFor(results: { ext: Record<string, unknown> } | null | undefined, playerId: string): MatchXpSummary | null {
  const all = results?.ext?.progression as Record<string, MatchXpSummary> | undefined;
  return (all && typeof all === 'object' && all[playerId]) || null;
}
