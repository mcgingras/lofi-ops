/**
 * Map registry (owners: maps-bo, maps-mw2). `build()` returns MapData; use `getMapData(id)`, which
 * builds once and caches. `inspiredBy` keeps the original for any future rename.
 */
import { buildFiringRange } from '../maps/firingrange';
import { buildNuketown } from '../maps/nuketown';
import { buildYard } from '../maps/yard';
import type { MapData } from '../maps/types';
import { MODES } from './modes';
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

/**
 * The maps-bo maps support every registered mode: they carry TDM/FFA spawns (also Kill Confirmed and
 * the wagers), `objectives.dom` A/B/C, `objectives.sd` A/B with `modeSpawns.sd`, and `objectives.hq`.
 * Taken from MODES so objective modes join the list as soon as the modes area registers them.
 */
const BO_MODES = MODES.map((m) => m.id);

export const MAPS: MapDef[] = [
  { id: 'yard', name: 'Yard', inspiredBy: 'Original (approved look prototype)', build: buildYard, modes: ['tdm', 'ffa'], size: 'small' },
  // maps-bo: Black Ops 1 recreations. Objective data: dom A/B/C, sd A/B (+ modeSpawns.sd), hq points.
  { id: 'nuketown', name: 'Nuketown', inspiredBy: 'Call of Duty: Black Ops (2010), Nuketown', build: buildNuketown, modes: BO_MODES, size: 'small' },
  { id: 'firingrange', name: 'Firing Range', inspiredBy: 'Call of Duty: Black Ops (2010), Firing Range', build: buildFiringRange, modes: BO_MODES, size: 'medium' },
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
