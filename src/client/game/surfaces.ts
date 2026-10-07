/**
 * Footstep surfaces. MapData has no physical-material field, so the surface comes from the texture
 * recipe id (and material name) of the brush under the feet: `nt_grass` -> grass, `steel` -> metal...
 * Pure (no three.js), unit-tested in tests/sfx.test.ts.
 */
import type { Brush, MapData } from '../../shared/maps/types';

export type Surface = 'concrete' | 'grass' | 'dirt' | 'wood' | 'metal' | 'carpet';

const RULES: [Surface, RegExp][] = [
  ['carpet', /carpet|fabric|seat|rubber|sandbag|mannequin|dress|mattress/],
  ['grass', /grass|hedge|lawn|turf/],
  ['dirt', /sand|dirt|mud|gravel|scrap_ground/],
  ['metal', /steel|metal|container|corr|tin|alu|grate|beam|pipe|tank|rail|stairs|rust_deck|barrel|truck|jet|trailer|fuse|yellow|uld|carpaint|bus|hazard|junk|hangar|cabin|slide|clad|shutter|vent/],
  ['wood', /wood|plank|ply|pallet|crate|nt_floor|lattice|log|target|deck|book|hut|shed/],
];

/** Surface for a texture recipe id (and optionally the MapData material name). Unknown = concrete. */
export function surfaceOfTexture(texture: string, material = ''): Surface {
  for (const [s, re] of RULES) if (re.test(texture)) return s;
  for (const [s, re] of RULES) if (re.test(material)) return s;
  return 'concrete';
}

interface Floor {
  b: Brush;
  surface: Surface;
}

const cache = new WeakMap<MapData, Floor[]>();

function floors(map: MapData): Floor[] {
  let f = cache.get(map);
  if (!f) {
    f = [];
    for (const b of map.brushes) {
      if (b.collide === false || b.players === false) continue;
      const mat = b.faceMats?.py ?? b.mat;
      const tex = map.materials[mat]?.texture ?? 'none';
      if (tex === 'none') continue; // invisible clips: use whatever is drawn under them
      f.push({ b, surface: surfaceOfTexture(tex, mat) });
    }
    cache.set(map, f);
  }
  return f;
}

/** Surface under a player's feet at (x, y, z) (y = feet). Falls back to concrete. */
export function surfaceAt(map: MapData | null | undefined, x: number, y: number, z: number): Surface {
  if (!map) return 'concrete';
  const m = 0.25;
  let best: Floor | null = null;
  let bestTop = -Infinity;
  for (const f of floors(map)) {
    const { min, max } = f.b;
    if (x < min.x - m || x > max.x + m || z < min.z - m || z > max.z + m) continue;
    if (y < min.y - 0.1 || y > max.y + 0.6) continue;
    // Ramps: the feet are somewhere on the slope; boxes: the top is at or just under the feet.
    const top = f.b.ramp ? Math.min(max.y, y) : max.y;
    if (!f.b.ramp && top > y + 0.35) continue;
    if (top > bestTop) {
      bestTop = top;
      best = f;
    }
  }
  return best?.surface ?? 'concrete';
}

/** The footstep sound id for a position. */
export const stepSound = (map: MapData | null | undefined, x: number, y: number, z: number): string => `step.${surfaceAt(map, x, y, z)}`;
