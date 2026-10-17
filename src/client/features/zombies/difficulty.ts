/**
 * Zombies difficulty on the client: the choice remembered per browser (`lofi.zombies.difficulty`),
 * the RPC requests that carry it, and the labels the HUD scoreboard, the game-over card and the
 * results show. Pure (storage passed in) so tests run without a DOM.
 */
import { ZOMBIES, ZOMBIES_DIFFICULTY, zombiesDifficulty, type AllyDifficulty, type ZombiesDifficulty } from '../../../shared/defs/zombies';
import type { RpcMap } from '../../../shared/protocol';

export const DIFFICULTY_KEY = 'lofi.zombies.difficulty';

type KV = Pick<Storage, 'getItem' | 'setItem'>;

const browserStorage = (): KV | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** The remembered difficulty (Casual when none or unreadable). */
export function savedDifficulty(store: KV | null = browserStorage()): ZombiesDifficulty {
  try {
    return zombiesDifficulty(store?.getItem(DIFFICULTY_KEY));
  } catch {
    return zombiesDifficulty(undefined);
  }
}

export function saveDifficulty(d: ZombiesDifficulty, store: KV | null = browserStorage()): void {
  try {
    store?.setItem(DIFFICULTY_KEY, d);
  } catch {
    /* private mode */
  }
}

/** What the Solo and Co-op lobby buttons send. */
export function soloRequest(map: string, allies: { count: number; difficulty: AllyDifficulty }, difficulty: ZombiesDifficulty): RpcMap['zombies.solo']['req'] {
  return { map, allies: allies.count, allyDifficulty: allies.difficulty, difficulty };
}

export function coopRequest(map: string, difficulty: ZombiesDifficulty): RpcMap['zombies.coop']['req'] {
  return { map, difficulty };
}

/** "CASUAL" / "CLASSIC": under the round on the scoreboard, on the game-over card and the results. */
export const difficultyLabel = (d: ZombiesDifficulty | undefined | null): string => (d ? ZOMBIES_DIFFICULTY[d].label : '');

/** The results' sub line: "Nuketown · Zombies · CASUAL". */
export const resultsSubtitle = (mapName: string, d: ZombiesDifficulty | undefined | null): string => [mapName, 'Zombies', difficultyLabel(d)].filter(Boolean).join(' · ');

/** Co-op bleed-out length for the HUD bars. */
export const bleedOutSecFor = (d: ZombiesDifficulty | undefined | null): number => (d ? ZOMBIES_DIFFICULTY[d].bleedOutSec : ZOMBIES.bleedOutSec);
