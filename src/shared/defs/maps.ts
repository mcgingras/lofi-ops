/**
 * Map registry (owners: maps-bo, maps-mw2). `build()` returns MapData; use `getMapData(id)`, which
 * builds once and caches. `inspiredBy` keeps the original for any future rename.
 */
import { buildFiringRange } from '../maps/firingrange';
import { buildNuketown } from '../maps/nuketown';
import { buildRust } from '../maps/rust';
import { buildScrapyard } from '../maps/scrapyard';
import { buildSummit } from '../maps/summit';
import { buildTerminal } from '../maps/terminal';
import { buildYard } from '../maps/yard';
import type { MapData } from '../maps/types';
import { MODE_BY_ID, MODES } from './modes';
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
 * Mode ids a map is built for, kept to the modes that exist right now (maps-mw2 maps carry
 * Domination / S&D / HQ data before the modes area registers those modes; they light up then).
 */
const supported = (...ids: string[]) => ids.filter((id) => MODE_BY_ID.has(id));
/** Team/FFA/objective modes the maps-mw2 maps carry data for, plus every wager mode (spawns only). */
const mw2Modes = () => [...supported('tdm', 'ffa', 'dom', 'sd', 'hq', 'kc'), ...MODES.filter((m) => m.playlist === 'wager').map((m) => m.id)];

/**
 * The maps-bo maps support every registered mode: they carry TDM/FFA spawns (also Kill Confirmed and
 * the wagers), `objectives.dom` A/B/C, `objectives.sd` A/B with `modeSpawns.sd`, and `objectives.hq`.
 * Taken from MODES so objective modes join the list as soon as the modes area registers them.
 */
const BO_MODES = MODES.map((m) => m.id);

export const MAPS: MapDef[] = [
  { id: 'yard', name: 'Yard', inspiredBy: 'Original (approved look prototype)', build: buildYard, modes: ['tdm', 'ffa', 'dom', 'sd', 'hq', 'kc'], size: 'small' },
  // maps-mw2
  { id: 'rust', name: 'Rust', inspiredBy: 'Rust (Call of Duty: Modern Warfare 2, 2009)', build: buildRust, modes: mw2Modes(), size: 'small' },
  { id: 'scrapyard', name: 'Scrapyard', inspiredBy: 'Scrapyard (Call of Duty: Modern Warfare 2, 2009)', build: buildScrapyard, modes: mw2Modes(), size: 'medium' },
  { id: 'terminal', name: 'Terminal', inspiredBy: 'Terminal (Call of Duty: Modern Warfare 2, 2009), full map: Security, Shopping, Bookstore, Burger Town, the Lounges, Maintenance, the apron and the walk-through plane', build: buildTerminal, modes: mw2Modes(), size: 'large' },
  // maps-bo: Black Ops 1 recreations. Objective data: dom A/B/C, sd A/B (+ modeSpawns.sd), hq points.
  { id: 'nuketown', name: 'Nuketown', inspiredBy: 'Call of Duty: Black Ops (2010), Nuketown', build: buildNuketown, modes: BO_MODES, size: 'small' },
  { id: 'firingrange', name: 'Firing Range', inspiredBy: 'Call of Duty: Black Ops (2010), Firing Range', build: buildFiringRange, modes: BO_MODES, size: 'medium' },
  { id: 'summit', name: 'Summit', inspiredBy: 'Call of Duty: Black Ops (2010), Summit: the Soviet listening post on a Ural mountaintop (Control room, Gallery, Tower, Cable Car and Gondola, Catwalk)', build: buildSummit, modes: BO_MODES, size: 'medium' },
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
