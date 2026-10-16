/**
 * Simple rules for bots holding a wonder weapon (the bots' brain consults these):
 *
 * - Ray Gun: fight at mid range (16 m), aim down sights past 10 m, fire out to 45 m. The bolt
 *   behaviour leads the target for them (raygun.ts `boltLead`).
 * - Thundergun: rush; fire only inside the blast (11 m); past 16 m switch to the other gun when it
 *   has ammo, else close in.
 * - Wunderwaffe DG-2: fight at 18 m, aim past 12 m, fire out to 42 m.
 * - Winter's Howl: rush like a shotgun; fire inside 11 m; past 16 m switch to the other gun when
 *   it has ammo.
 */
import { WEAPON_BY_ID } from '../../../../shared/defs/weapons';
import type { PlayerState } from '../../../player';

export interface WonderBotStyle {
  /** Preferred range (m), ADS beyond (m), rush in. */
  range: number;
  ads: number;
  rush?: boolean;
  /** Only fire inside this (m). */
  fireWithin: number;
  /** Past this (m) switch to the other gun if it has ammo. */
  switchBeyond?: number;
}

export const WONDER_BOT_STYLE: Record<string, WonderBotStyle> = {
  raygun: { range: 16, ads: 10, fireWithin: 45 },
  thundergun: { range: 6, ads: Infinity, rush: true, fireWithin: 11, switchBeyond: 16 },
  wunderwaffe: { range: 18, ads: 12, fireWithin: 42 },
  wintershowl: { range: 5, ads: Infinity, rush: true, fireWithin: 11, switchBeyond: 16 },
};

/** The fighting style for a wonder weapon id (null for ordinary guns). */
export const wonderBotStyle = (weaponId: string | undefined): WonderBotStyle | null => (weaponId && WEAPON_BY_ID.get(weaponId)?.wonder ? (WONDER_BOT_STYLE[weaponId] ?? null) : null);

/**
 * What a bot holding `weaponId` should do about a target `dist` metres away: 'fire' (when on
 * target), 'hold' (keep closing, don't waste the shot) or 'switch' (to the other slot).
 */
export function wonderBotDecision(bot: PlayerState, weaponId: string, dist: number): 'fire' | 'hold' | 'switch' | null {
  const s = wonderBotStyle(weaponId);
  if (!s) return null;
  if (dist <= s.fireWithin) return 'fire';
  if (s.switchBeyond !== undefined && dist > s.switchBeyond) {
    const other = bot.weapons[bot.slot === 0 ? 1 : 0];
    if (other && other.mag + other.reserve > 0) return 'switch';
  }
  return 'hold';
}
