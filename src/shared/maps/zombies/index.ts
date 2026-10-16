/** Zombies layers by map id (owner: zombies). A map supports the mode when it has one here and lists 'zombies' in MapDef.modes. */
import { NUKETOWN_ZOMBIES } from './nuketown';
import type { ZombiesLayer } from './types';

export type { ZombiesLayer, ZombiesWallBuy, ZombiesItemSpot, ZombiesPerkSpot, ZombiesBarrier } from './types';

const LAYERS: Record<string, ZombiesLayer> = { nuketown: NUKETOWN_ZOMBIES };

export const ZOMBIES_LAYERS: Readonly<Record<string, ZombiesLayer>> = LAYERS;

export function zombiesLayer(mapId: string): ZombiesLayer | null {
  return LAYERS[mapId] ?? null;
}
