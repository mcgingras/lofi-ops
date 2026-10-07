/**
 * Profile-level progression rules used by the server feature (and the tests): entering prestige.
 */
import { applyPrestige, canPrestige, MAX_LEVEL, MAX_PRESTIGE, prestigeEmblem, progressionExt } from '../../../shared/defs/progression';
import { syncUnlocks, usableClassCount } from '../../../shared/defs/unlocks';
import type { Profile } from '../../../shared/profile';

export type PrestigeResult = { ok: true; prestige: number; emblem: string } | { ok: false; reason: 'max_prestige' | 'level' };

/**
 * Enter the next prestige in place. Resets: level, XP, level unlocks, per-weapon attachment
 * progress (kills since prestige). Keeps: CoD Points, challenge progress, combat record (stats),
 * purchases (`owned`), classes (they are re-gated at spawn). Grants the `prestige_N` emblem
 * (in `unlocks` and `owned`) and selects it for display.
 */
export function enterPrestige(profile: Profile): PrestigeResult {
  if (!canPrestige(profile)) return { ok: false, reason: profile.prestige >= MAX_PRESTIGE ? 'max_prestige' : 'level' };
  applyPrestige(profile);
  const ext = progressionExt(profile);
  ext.weaponKills = {};
  const emblem = prestigeEmblem(profile.prestige);
  ext.emblem = emblem;
  if (!profile.owned.includes(emblem)) profile.owned.push(emblem);
  if (profile.selectedLoadout >= usableClassCount(profile)) profile.selectedLoadout = 0;
  syncUnlocks(profile);
  return { ok: true, prestige: profile.prestige, emblem };
}

export const prestigeBlockedReason = (profile: Profile): string | null =>
  profile.prestige >= MAX_PRESTIGE ? 'Already at Master Prestige' : profile.level < MAX_LEVEL ? `Reach level ${MAX_LEVEL} first` : null;
