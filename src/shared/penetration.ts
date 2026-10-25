/**
 * Bullet penetration: a small, BO1-flavoured model (docs/CONTRACTS.md "Penetration").
 *
 *   type      each weapon penetrates as `small` (pistols, SMGs), `medium` (ARs; the Python), `large`
 *             (snipers, LMGs), `pellet` (shotgun pellets: barely) or `none` (launchers, the knife).
 *             BO1 sets `penetrateType` per weapon the same way. The type gives a depth: the most
 *             wood a bullet passes through in one wall.
 *   material  a wall's thickness is the ray's entry-to-exit distance through it (brushes that touch
 *             or overlap count as one wall), weighted by how hard its material is: drywall and
 *             fabric and sheet metal are easy, wood is the reference, concrete and brick are hard,
 *             heavy steel, rock, earth, bullet-stopping glass and clips never let a bullet through.
 *             Materials are classified by texture name, then material id (like bots/sight.ts).
 *   rules     at most `maxWalls` walls per bullet. Each wall multiplies the damage by 0.75 (paper
 *             thin) down to 0.5 (at the depth limit), and every metre after it counts double for
 *             damage falloff and range. Hardened (`penetrationMultiplier`, BO1
 *             `perk_bulletPenetrationMultiplier`) doubles the depth, which also halves the loss.
 *
 * Pure and shared: the server traces shots with it (human shots only; bots fire only with a clear
 * path) and the client predicts its own impact puffs with it.
 */
import { raySpan, type CollisionWorld, type RayHit, type Solid } from './collision';
import type { WeaponDef } from './defs/weapons';
import type { MapData } from './maps/types';
import type { Vec3 } from './math';

export type PenetrationType = 'none' | 'pellet' | 'small' | 'medium' | 'large';

/** How hard a material is to shoot through. */
export type PenetrationMaterial = 'soft' | 'sheet' | 'wood' | 'masonry' | 'solid';

export const PENETRATION = {
  /** Metres of wood one wall may be, per type (before Hardened). */
  depth: { none: 0, pellet: 0.04, small: 0.15, medium: 0.3, large: 0.45 } as Record<PenetrationType, number>,
  /** Wood-equivalent metres per metre of each material. */
  resistance: { soft: 0.5, sheet: 0.5, wood: 1, masonry: 10, solid: Infinity } as Record<PenetrationMaterial, number>,
  /** Walls one bullet may pass. */
  maxWalls: 2,
  /** Damage kept through a wall: `maxKeep` for a paper-thin one, down to `minKeep` at the depth limit. */
  maxKeep: 0.75,
  minKeep: 0.5,
  /** After each wall a metre counts this much for damage falloff and the weapon's range. */
  rangeStretch: 2,
  /** Hardened: depth multiplier (BO1 `perk_bulletPenetrationMultiplier`). */
  hardened: 2,
  /** Solids closer than this along the ray are the same wall. */
  joinGap: 0.02,
} as const;

/** The penetration type of a weapon: its own `penetration`, else BO1's by class. */
export function penetrationType(w: Pick<WeaponDef, 'class' | 'penetration' | 'pellets'>): PenetrationType {
  if (w.penetration) return w.penetration;
  switch (w.class) {
    case 'pistol':
    case 'machinepistol':
    case 'smg':
      return 'small';
    case 'ar':
      return 'medium';
    // BO1 weapon files: LMGs (HK21, RPK, M60) and snipers penetrate as `large`.
    case 'lmg':
    case 'sniper':
      return 'large';
    case 'shotgun':
      return 'pellet';
    default:
      return 'none';
  }
}

// Texture / material id patterns, checked in this order (first match wins).
const SOLID = /rock|stone|cobble|cliff|mud|dirt|ground|earth|sand|gravel|grass|forest|glass|^none$|^clip$|^gltf$/i;
const HEAVY = /steel|iron|beam|girder|pipe|tank|machine|engine|bulkhead|stairs|ladder|rocket|booster|rubber|_deck|bridge|(^|_)rail/i;
const MASONRY = /concrete|brick|block|cinder|sandbag|barrier|asphalt|apron|slab|facade|parapet|bunker|blast|tile|bldg|hr_roof|hn_roof|scrap_wall|lc_wall/i;
const SHEET = /corr|tin|alu|sheet|container|trailer|shed|clad|carpaint|bus|truck|fuse|hull|hj_paint|grate|shutter|hangar|heli|jet|cabinet|console|barrel|locker|vent|warehouse|junk|hazard/i;
const SOFT = /plaster|limewash|drywall|term_wall|cubicle|fabric|cloth|mattress|cushion|carpet|seat|tarp|paper|books|mannequin|snow|cabin/i;
const WOOD = /wood|plank|ply|board|bamboo|crate|pallet|siding|fence|lattice|louvre|door|teak|log|bark|thatch|hut|trim|nt_floor|jg_floor|counter|desk|sign|target|nt_roof/i;

/** Classify a material by name (a texture id or a material id); null when nothing matches. */
export function materialByName(name: string): PenetrationMaterial | null {
  if (SOLID.test(name)) return 'solid';
  if (HEAVY.test(name)) return 'solid';
  if (MASONRY.test(name)) return 'masonry';
  if (SHEET.test(name)) return 'sheet';
  if (SOFT.test(name)) return 'soft';
  if (WOOD.test(name)) return 'wood';
  return null;
}

const byMap = new WeakMap<MapData, Map<string, PenetrationMaterial>>();

/** How a map's material shoots through: by its texture, then its id; anything unknown is masonry. */
export function penetrationMaterial(map: Pick<MapData, 'materials'>, mat: string): PenetrationMaterial {
  let cache = byMap.get(map as MapData);
  if (!cache) byMap.set(map as MapData, (cache = new Map()));
  let m = cache.get(mat);
  if (!m) {
    const tex = map.materials[mat]?.texture;
    m = (tex !== undefined ? materialByName(tex) : null) ?? materialByName(mat) ?? 'masonry';
    cache.set(mat, m);
  }
  return m;
}

/** A wall a bullet went through: where it entered and left, and what it kept. */
export interface WallPass {
  tIn: number;
  tOut: number;
  /** Entry point and the entry face's normal (impact effects). */
  point: Vec3;
  normal: Vec3;
  /** Exit point. */
  exit: Vec3;
  /** Thickness along the ray, and in metres of wood. */
  thickness: number;
  wood: number;
  /** Damage kept through this wall (0.5..0.75 before Hardened). */
  keep: number;
  mat: string;
}

/** Where a bullet went: the walls it passed and where it stopped. */
export interface BulletPath {
  /** Distance along the ray where it stopped (the wall that stopped it, else its range). */
  t: number;
  /** The wall that stopped it, if any. */
  hit: RayHit | null;
  walls: WallPass[];
}

export interface PenetrationOptions {
  /** Weapon range in metres (before stretching). */
  range: number;
  type: PenetrationType;
  /** Hardened and friends (`penetrationMultiplier`). */
  depthMultiplier?: number;
}

/** Damage kept through a wall of `wood` wood-equivalent metres for a bullet that can pass `depth`. */
export function wallKeep(wood: number, depth: number): number {
  const k = depth > 0 ? Math.min(1, Math.max(0, wood / depth)) : 1;
  return PENETRATION.maxKeep - (PENETRATION.maxKeep - PENETRATION.minKeep) * k;
}

/**
 * The distance that counts for damage falloff at `t` along a path (each metre past a wall counts
 * `rangeStretch` times; a path with no walls gives `t`).
 */
export function effectiveDistance(walls: readonly WallPass[], t: number): number {
  let d = t;
  let k = 1;
  for (const w of walls) {
    if (w.tIn >= t) break;
    d += (t - w.tOut) * k * (PENETRATION.rangeStretch - 1);
    k *= PENETRATION.rangeStretch;
  }
  return Math.max(t, d);
}

/** Damage multiplier for a hit at `t`: the product of the walls passed before it. */
export function keepAt(walls: readonly WallPass[], t: number): number {
  let k = 1;
  for (const w of walls) if (w.tIn < t) k *= w.keep;
  return k;
}

const at = (o: Vec3, d: Vec3, t: number): Vec3 => ({ x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t });

/**
 * Trace a bullet from `o` along unit `d` through the world's `bullets` solids, passing the walls it
 * can. `materialOf` classifies a solid (`penetrationMaterial(map, solid.mat)` for a map). With
 * `type: 'none'` it is a plain raycast.
 */
export function traceBullet(world: CollisionWorld, materialOf: (s: Solid) => PenetrationMaterial, o: Vec3, d: Vec3, opts: PenetrationOptions): BulletPath {
  const depth = PENETRATION.depth[opts.type] * (opts.depthMultiplier ?? 1);
  const walls: WallPass[] = [];
  let limit = opts.range;
  let from = 0;
  for (;;) {
    const hit = world.raycast(at(o, d, from), d, limit - from, 'bullets');
    if (!hit) return { t: limit, hit: null, walls };
    const tIn = from + hit.t;
    if (depth <= 0 || walls.length >= PENETRATION.maxWalls) return { t: tIn, hit: { ...hit, t: tIn }, walls };
    // The wall: this solid and any touching or overlapping it along the ray.
    let tOut = tIn;
    let wood = 0;
    let s: Solid | null = hit.solid;
    let guard = 0;
    while (s && guard++ < 16) {
      const span = raySpan(o, d, s);
      const out = span ? span.t1 : tOut;
      if (out > tOut) {
        wood += (out - tOut) * PENETRATION.resistance[materialOf(s)];
        tOut = out;
      }
      if (wood > depth) break;
      const next = world.raycast(at(o, d, tOut + 1e-4), d, PENETRATION.joinGap, 'bullets');
      s = next ? next.solid : null;
    }
    if (wood > depth || tOut >= limit) return { t: tIn, hit: { ...hit, t: tIn }, walls };
    walls.push({ tIn, tOut, point: at(o, d, tIn), normal: hit.normal, exit: at(o, d, tOut), thickness: tOut - tIn, wood, keep: wallKeep(wood, depth), mat: hit.solid.mat });
    // Range left after the wall shrinks by the stretch.
    limit = tOut + (limit - tOut) / PENETRATION.rangeStretch;
    from = tOut + 1e-4;
  }
}
