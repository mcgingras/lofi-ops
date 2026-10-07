/**
 * Map registry (owners: maps-bo, maps-mw2). `build()` returns MapData; use `getMapData(id)`, which
 * builds once and caches. `inspiredBy` keeps the original for any future rename.
 */
import { buildYard } from '../maps/yard';
import type { MapData } from '../maps/types';
import { indexById } from './registry';

export interface MapDef {
  id: string;
  name: string;
  inspiredBy: string;
  build(): MapData;
  /** Mode ids this map supports. */
  modes: string[];
  size: 'small' | 'medium' | 'large';
  /** Menu preview image (optional). */
  preview?: string;
}

export const MAPS: MapDef[] = [
  { id: 'yard', name: 'Yard', inspiredBy: 'Original (approved look prototype)', build: buildYard, modes: ['tdm', 'ffa', 'dom', 'sd', 'hq', 'kc'], size: 'small' },
];

export const MAP_BY_ID = indexById(MAPS);

const cache = new Map<string, MapData>();

/** Built MapData for an id (cached). Throws for unknown ids. */
export function getMapData(id: string): MapData {
  let m = cache.get(id);
  if (!m) {
    const def = MAP_BY_ID.get(id);
    if (!def) throw new Error(`unknown map: ${id}`);
    cache.set(id, (m = def.build()));
  }
  return m;
}

/** Maps that support a mode. */
export const mapsForMode = (mode: string) => MAPS.filter((m) => m.modes.includes(mode));
