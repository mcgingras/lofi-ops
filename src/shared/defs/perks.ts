/** Perks (owner: perks-streaks feature). BO1 three tiers, each with a Pro version. */
import { indexById } from './registry';

export interface PerkDef {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  description: string;
  /** Pro version: what it adds and the challenge that unlocks it. */
  pro: { description: string; challenge: string };
  unlockLevel: number;
  /** HUD/menu icon id. */
  icon?: string;
  price?: number;
}

export const PERKS: PerkDef[] = [
  { id: 'lightweight', name: 'Lightweight', tier: 1, description: 'Move faster.', pro: { description: 'No falling damage.', challenge: 'lightweight_pro' }, unlockLevel: 1 },
  { id: 'hardline', name: 'Hardline', tier: 1, description: 'Killstreaks require 1 less kill.', pro: { description: 'Change the contents of a Care Package by pressing USE.', challenge: 'hardline_pro' }, unlockLevel: 1 },
  { id: 'steady_aim', name: 'Steady Aim', tier: 2, description: 'Increased hip fire accuracy.', pro: { description: 'Faster recovery from sprinting. Faster knifing.', challenge: 'steady_aim_pro' }, unlockLevel: 1 },
];

export const PERK_BY_ID = indexById(PERKS);
