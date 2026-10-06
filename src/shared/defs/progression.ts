/**
 * Levels, XP and prestige (owner: progression feature). Pure rules over a profile-shaped object.
 *
 * Levels 1-50. XP to go from level L to L+1 is 800 + 1050 * (L - 1): 800 XP for level 2,
 * 1,274,000 XP total for level 50. Prestige 0-15: at level 50 you may prestige, which resets
 * level/XP and level unlocks, keeps CoD Points and challenge records, and grants an emblem.
 */

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

/** XP per action (BO1-style). Features read these; modes may add objective values. */
export const XP_SOURCES = {
  kill: 100,
  headshot: 50,
  assist: 50,
  /** Generic objective action (capture, plant, defuse); modes may use their own values. */
  objective: 200,
  /** Match bonus: per second played, and for winning. */
  matchPerSecond: 1,
  matchWin: 500,
  /** Challenge XP comes from the ChallengeDef. */
};

export interface ProgressionFields {
  xp: number;
  level: number;
  prestige: number;
  unlocks: string[];
}

export const canPrestige = (p: ProgressionFields) => p.level >= MAX_LEVEL && p.prestige < MAX_PRESTIGE;

/** Emblem id granted when reaching a prestige. */
export const prestigeEmblem = (prestige: number) => `prestige_${prestige}`;

/**
 * Apply prestige in place: level 1, XP 0, level unlocks cleared (prestige emblems kept), prestige+1.
 * CoD Points and challenge progress are untouched (they live elsewhere on the profile).
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
