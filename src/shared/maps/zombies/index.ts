/** Zombies layers by map id (owner: zombies). A map supports the mode when it has one here and lists 'zombies' in MapDef.modes. */
import { FIRINGRANGE_ZOMBIES } from './firingrange';
import { NACHT_ZOMBIES } from './nacht';
import { NUKETOWN_ZOMBIES } from './nuketown';
import { YARD_ZOMBIES } from './yard';
import type { ZombiesLayer } from './types';

export type { ZombiesLayer, ZombiesWallBuy, ZombiesItemSpot, ZombiesPerkSpot, ZombiesBarrier, ZombiesDoor, ZombiesSpawn } from './types';

const LAYERS: Record<string, ZombiesLayer> = { nuketown: NUKETOWN_ZOMBIES, firingrange: FIRINGRANGE_ZOMBIES, yard: YARD_ZOMBIES, nacht: NACHT_ZOMBIES };

export const ZOMBIES_LAYERS: Readonly<Record<string, ZombiesLayer>> = LAYERS;

export function zombiesLayer(mapId: string): ZombiesLayer | null {
  return LAYERS[mapId] ?? null;
}
