/**
 * A player's persistent profile (server store: src/server/store.ts). The owning client receives
 * it in `welcome` and via `profile` messages; features mutate it on the server and core saves it
 * at match end and on disconnect.
 */
import { STARTING_COD_POINTS } from './defs/economy';
import { cloneLoadout, DEFAULT_LOADOUTS, type Loadout } from './loadout';

export interface Profile {
  id: string;
  name: string;
  xp: number;
  level: number;
  prestige: number;
  codPoints: number;
  /** Unlocked item ids (weapons, attachments as `weapon:attachment`, perks, emblems...). */
  unlocks: string[];
  loadouts: Loadout[];
  /** Index into `loadouts` used for the next spawn. */
  selectedLoadout: number;
  /** Challenge id -> progress value of its metric. */
  challengeProgress: Record<string, number>;
  /**
   * Career stats. Core maintains: kills, deaths, assists, headshots, matches, wins, losses, score,
   * timePlayed (seconds), `mode.<id>.<stat>` and `weapon.<id>.kills|headshots`. Features may add keys.
   */
  stats: Record<string, number>;
  /** Owned purchasable items (camos, emblems, store weapons...). */
  owned: string[];
  /** Feature-private data, namespaced by feature id: ext.progression, ext.economy, ... */
  ext: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export function newProfile(id: string, name: string, now = Date.now()): Profile {
  return {
    id,
    name,
    xp: 0,
    level: 1,
    prestige: 0,
    codPoints: STARTING_COD_POINTS,
    unlocks: [],
    loadouts: DEFAULT_LOADOUTS.map(cloneLoadout),
    selectedLoadout: 0,
    challengeProgress: {},
    stats: {},
    owned: ['none'],
    ext: {},
    createdAt: now,
    updatedAt: now,
  };
}

/** Increment a numeric stat key. */
export function bumpStat(p: Pick<Profile, 'stats'>, key: string, by = 1) {
  p.stats[key] = (p.stats[key] ?? 0) + by;
}
