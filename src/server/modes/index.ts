/**
 * Mode rules registry. Core registers tdm and ffa; the modes feature adds dom/sd/hq/kc here (or
 * from its feature setup), the economy feature registers wager modes from its setup:
 *
 *   registerMode('gun', () => gunGameRules());
 */
import { ffa } from './ffa';
import { tdm } from './tdm';
import type { ModeFactory, ModeRules } from './types';

const factories = new Map<string, ModeFactory>();

export function registerMode(id: string, factory: ModeFactory): void {
  factories.set(id, factory);
}

export const hasModeRules = (id: string) => factories.has(id);

/** Rules for a mode id; unknown ids fall back to TDM rules (team modes) or FFA rules. */
export function createRules(id: string, teams: boolean): ModeRules {
  const f = factories.get(id) ?? (teams ? tdm : ffa);
  return f();
}

registerMode('tdm', tdm);
registerMode('ffa', ffa);

export type { ModeRules, ModeFactory } from './types';
export { standardResults, smallerTeam } from './common';
