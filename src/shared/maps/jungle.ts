/**
 * Jungle (recreation of Black Ops 1's Jungle, `mp_havoc`: a river valley village in the Laos /
 * Vietnam border jungle; owner: maps-bo). Traced from the BO1 overhead with its A1..E5 grid
 * (512 px, Map_Jungle_BO.png on the Call of Duty Wiki), cross-checked against the Black Ops Cold
 * War remaster's minimap, the 2010 PC Games mode maps and gameplay footage; see
 * docs/maps/jungle-reference.md.
 *
 * Coordinates are written in overhead pixels and converted with `px`/`pz` (0.27 m per pixel, origin
 * at overhead pixel (250, 234)). Metres, +x east, +z south (north is up on the overhead), yaw 0
 * faces north (-z).
 *
 *   Ruins        west end (C1/D1): the stone temple platform, a roofless ruin by the creek with an
 *                arch, sandbagged walls; team 0 spawn
 *   creek        the river: from the waterfall pool in the north-west bay (C1) east along the
 *                Ruins, under the Bridge, south of the Lookout and out through the east edge (C5)
 *   Bridge       the elevated walkway from the stilt house in the north (B2) high over the river
 *                valley, then a ledge path down the central cliff to the red stilt house (D4)
 *   central rock the big limestone cliff in the middle (C3); impassable, the Village sits under it
 *   Lookout      the flat-topped rock east of centre (C4), one narrow ledge path up its north-west
 *                face; 6 m drop on every other side
 *   Base         the north-east military post (A4/B4): sandbag compound under a camo net
 *   east spawn   the foxholes and trenches by the east edge (C5), team 1 spawn; the thatched stilt
 *                hut from the loading screen stands just west of it
 *   Village      the south (D3): the L-shaped longhouse, a small hut, the white stilt hut on the
 *                south edge (Viet Cong flag inside) and the red stilt house at the foot of the cliff
 *
 * Turned buildings render as rotated boxes (`ry`) and collide as axis-aligned slices kept inside
 * them (`Frame`, the same technique as firingrange.ts). Foliage is cut-out cards and box canopies:
 * like BO1's, it never stops bullets; rock outcrops (the overhead's holes) are solid.
 */
import { CollisionWorld } from '../collision';
import type { Vec3 } from '../math';
import { MapKit, yawTo } from './bo-kit';
import { mapSolids, unitVec, type Brush, type MapData, type MaterialDef, type ObjectivePoint, type SpawnPoint } from './types';

const PI = Math.PI;
const DEG = PI / 180;

type P2 = [number, number];
type BrushOpts = Partial<Omit<Brush, 'min' | 'max' | 'mat'>>;

/** Metres per pixel of the 512 px BO1 overhead the layout is traced from. */
export const JUNGLE_SCALE = 0.27;
/** Overhead pixel x -> world x (metres). */
export const px = (x: number): number => Math.round((x - 250) * JUNGLE_SCALE * 1000) / 1000;
/** Overhead pixel y -> world z (metres). */
export const pz = (y: number): number => Math.round((y - 234) * JUNGLE_SCALE * 1000) / 1000;
const pt = (p: P2): P2 => [px(p[0]), pz(p[1])];
const poly = (ps: P2[]): P2[] => ps.map(pt);

/** Key heights (metres). */
export const JUNGLE_LEVELS = {
  /** Creek bed (the deepest terrace). */
  bed: -1.2,
  /** Water surface (render only). */
  water: -0.7,
  /** The Bridge: stilt house floor, walkway and deck. */
  bridge: 3.6,
  /** Red stilt house floor and deck (bottom of the cliff path). */
  redHut: 2.2,
  /** Lookout rock top. */
  lookout: 6.0,
  /** Ruins temple platform. */
  temple: 0.9,
} as const;
const L = JUNGLE_LEVELS;

export const JUNGLE_BOUNDS = { min: { x: -61, y: -6, z: -51 }, max: { x: 60, y: 30, z: 51 } };

/** The playable outline in overhead pixels, clockwise on the overhead (traced from the white line). */
export const JUNGLE_OUTLINE_PX: P2[] = [
  [38, 312], [52, 297], [61, 280], [70, 265], [82, 255], [88, 243], [88, 217], [99, 216], [109, 217.6], [118.6, 227], [129.6, 227], [136, 215],
  [138.5, 194], [147, 177], [159.5, 165], [176, 152], [185, 135], [197, 127], [218.5, 122.6], [237.5, 127], [248, 135], [254, 140], [300, 138],
  [305, 91.6], [326.6, 82.8], [339, 80], [345.5, 60], [352, 61.4], [370.8, 69], [386, 77.7], [401, 93], [411, 103], [408.6, 120.6], [397, 130.7],
  [394.7, 145.9], [416, 161], [433.8, 173.6], [446.5, 178.7], [454, 187.5], [459, 201], [460.8, 214], [458, 241], [450, 252], [458, 256.8],
  [460.4, 269.4], [452, 285], [431.4, 288], [423.5, 299.4], [415.6, 310.4], [407.8, 318.3], [390.4, 320], [377.8, 315], [370, 318.3], [365, 323],
  [363.6, 338.8], [360.4, 354.6], [343, 362.5], [318, 372], [318, 404.8], [303, 409], [292.7, 396.4], [259, 398.5], [238, 400.6], [212.7, 402.7],
  [191, 391], [188, 369], [189.6, 343.8], [183, 337.5], [177, 345.4], [164, 356.4], [158, 367.5], [155, 385], [123, 386.4], [112, 381.7],
  [112, 351.7], [104.4, 351.7], [102.8, 361], [47.6, 361], [43, 348.5], [36.6, 345],
];
/** The outline in metres. */
export const JUNGLE_OUTLINE: P2[] = poly(JUNGLE_OUTLINE_PX);

/**
 * The creek: centreline in overhead pixels with a half width in metres. Shallow (knee deep), with
 * stepped mud banks, walkable along its whole length: the "River" lane.
 */
const CREEK: [number, number, number][] = [
  [94, 223, 3.0], [104, 236, 2.4], [113, 249, 1.9], [125, 259, 1.7], [150, 261, 1.7], [175, 260, 1.7], [194, 256, 1.8], [206, 247, 1.9],
  [222, 238, 2.2], [238, 228, 2.6], [258, 238, 3.0], [272, 250, 3.0], [284, 266, 2.4], [298, 275, 1.8], [316, 273, 1.8], [334, 268, 1.8],
  [355, 269, 1.7], [378, 266, 1.8], [396, 257, 1.7], [413, 243, 1.8], [435, 246, 1.8], [454, 252, 1.9], [472, 254, 2.2],
];
const CREEK_M: [number, number, number][] = CREEK.map(([x, y, w]) => [px(x), pz(y), w]);

/** Foxholes at the east spawn (overhead pixels, radius metres). */
const PITS: [number, number, number][] = [[442.5, 224.6, 1.7], [442.5, 272, 1.9]];

/** Lookout ledge path (overhead pixels, height at each point). */
const LEDGE: [number, number, number][] = [[301, 249, 0.15], [304, 232, 1.5], [309, 217, 2.9], [321, 206.5, 4.3], [334, 200.5, 5.4], [347, 198, L.lookout]];

/** The Bridge in overhead pixels: stilt house (frame), walkway, deck and the cliff path down to the red hut. */
const BRIDGE = {
  house: { o: [204, 180] as P2, th: -25 * DEG, w: 7.0, d: 4.0 },
  walk: [[230.6, 175.7], [238.5, 214.2]] as P2[],
  deck: [[240.4, 220.5], [285.8, 283.6]] as P2[],
  path: [[285.8, 283.6], [301, 294], [322, 304.5]] as P2[],
};

const RED_HUT = { o: [324, 308.8] as P2, th: 14.1 * DEG, w: 5.76, d: 7.0 };

/** Rock outcrops: the overhead's holes. Polygons in overhead pixels. */
interface RockDef {
  name: string;
  poly: P2[];
  peak: number;
  edge?: number;
  /** Flat walkable top at this height (the Lookout) instead of terraces and a clip. */
  flat?: number;
  palms?: [number, number, number][];
}
const ROCKS: RockDef[] = [
  { name: 'B2', poly: [[178.5, 160.5], [193, 157], [199.5, 167], [201, 184], [207, 198.5], [195, 211], [185, 220], [168, 224.6], [155, 220], [149, 207], [151, 192], [163, 186.7], [175.5, 181.6], [176, 169]], peak: 7.5, palms: [[172, 205, 8], [188, 196, 9], [161, 211, 7], [187, 168, 8]] },
  { name: 'B3', poly: [[254, 158], [267, 156], [269, 173], [267, 192], [258.5, 199], [250, 194], [248, 173]], peak: 6.5, palms: [[259, 175, 8]] },
  { name: 'B3n', poly: [[288, 152], [300.6, 151], [303, 163], [294, 167], [288, 163]], peak: 4.2 },
  { name: 'B3C3', poly: [[289, 185], [301.6, 174], [318.5, 170], [335, 172], [343, 185], [341.6, 196.5], [331, 199.8], [318.5, 205], [305.8, 211], [297, 208], [289, 197.4]], peak: 7.5, palms: [[312, 186, 9], [328, 182, 8], [300, 195, 7]] },
  { name: 'B4', poly: [[358, 162], [375.8, 153.4], [388.4, 156], [403.6, 168.6], [408.6, 173.6], [396, 186], [378.3, 191], [363, 183.7], [356.9, 172.4]], peak: 6.5, palms: [[380, 172, 9], [395, 176, 7]] },
  { name: 'C2a', poly: [[121, 241], [147, 241], [148, 251.5], [122, 253]], peak: 2.6, edge: 2.4 },
  { name: 'C2b', poly: [[167.5, 238], [189.6, 230], [199, 233], [197.5, 248], [189.6, 253], [178.5, 249.6]], peak: 4.5, palms: [[187, 241, 7]] },
  { name: 'C2c', poly: [[131, 268], [183, 266.5], [183, 287], [173.8, 309], [164, 314], [151.7, 309], [148.6, 288.6], [132.8, 287]], peak: 6.5, palms: [[160, 285, 8], [172, 297, 9], [145, 278, 7]] },
  {
    name: 'C3',
    poly: [[200, 272], [203, 262], [215, 252], [228, 246], [243, 237], [250, 243], [270, 275], [286, 289], [306, 300.5], [302, 308], [292.7, 316], [276, 322.7], [250.6, 320.6], [217, 318.5], [206.4, 314], [202, 289]],
    peak: 12,
    edge: 4.5,
    palms: [[230, 280, 9], [255, 300, 10], [215, 300, 8], [240, 262, 8], [270, 305, 9]],
  },
  { name: 'Lookout', poly: [[312, 231], [314, 244], [324, 256], [343.7, 260.5], [369, 258.5], [388, 248], [392, 227], [383.7, 208], [369, 199.5], [349, 195], [327, 199.5], [318, 211]], peak: L.lookout, flat: L.lookout },
  { name: 'C3s', poly: [[296, 260], [310, 260], [310.5, 269], [296, 269.5]], peak: 2.8, edge: 2.4 },
  { name: 'C4s', poly: [[340, 278.5], [358, 278.5], [359, 292], [341, 293]], peak: 3.2, edge: 2.4 },
  { name: 'C4e', poly: [[401.5, 207], [413, 206], [414, 227.5], [402.5, 228.4]], peak: 3.6, palms: [[408, 216, 7]] },
  { name: 'C5w', poly: [[414, 252], [423.5, 255], [422, 264.7], [412.5, 271], [406.5, 266], [409, 258]], peak: 3.4, edge: 2.4 },
];

/** The traced plan (overhead pixels), for tests and tools. */
export const JUNGLE_PLAN = { creek: CREEK, ledge: LEDGE, bridge: BRIDGE, redHut: RED_HUT, pits: PITS, rocks: ROCKS } as const;

const MATERIALS: Record<string, MaterialDef> = {
  floor: { texture: 'jg_floor', uvMul: [1 / 5, 1 / 5] },
  path: { texture: 'fr_dirt', tint: 0xa89070, uvMul: [1 / 4, 1 / 4] },
  grass: { texture: 'fr_grass', uvMul: [1 / 4, 1 / 4] },
  jungle: { texture: 'fr_jungle', uvMul: [1 / 4, 1 / 4] },
  mud: { texture: 'jg_mud', uvMul: [1 / 3, 1 / 3] },
  bed: { texture: 'jg_mud', tint: 0x8a8070, uvMul: [1 / 3, 1 / 3] },
  water: { texture: 'jg_water', uvMul: [1 / 6, 1 / 6], emissive: 0.15 },
  falls: { texture: 'jg_falls', side: 'double', emissive: 0.35 },
  rock: { texture: 'bo_rock', tint: 0xb4b8a8, uvMul: [1 / 4, 1 / 4] },
  cliff: { texture: 'bo_rock', tint: 0x9ea292, uvMul: [1 / 5, 1 / 5] },
  rockPath: { texture: 'bo_rock', tint: 0xa89c88, uvMul: [1 / 2, 1 / 2] },
  stone: { texture: 'jg_stone', uvMul: [1 / 2.4, 1 / 2.4] },
  stoneDark: { texture: 'jg_stone', tint: 0x9a9a8c, uvMul: [1 / 2.4, 1 / 2.4] },
  paving: { texture: 'jg_stone', tint: 0xb8b2a0, uvMul: [1 / 1.6, 1 / 1.6] },
  planks: { texture: 'bo_planks', uvMul: [1 / 2.4, 1 / 2.4] },
  planksDark: { texture: 'bo_planks', tint: 0x8a7a6a, uvMul: [1 / 2.4, 1 / 2.4] },
  planksPale: { texture: 'bo_planks', tint: 0xd8d4c8, uvMul: [1 / 2.4, 1 / 2.4] },
  redPlank: { texture: 'bo_planks', tint: 0xc0584a, uvMul: [1 / 2.4, 1 / 2.4] },
  wood: { texture: 'bo_wood', uvMul: [1 / 1.2, 1 / 1.2] },
  bamboo: { texture: 'jg_bamboo', uvMul: [1 / 1.6, 1 / 2.0] },
  bambooFence: { texture: 'jg_bambooFence', side: 'double' },
  thatch: { texture: 'jg_thatch', uvMul: [1 / 2, 1 / 2] },
  tiles: { texture: 'jg_tiles', uvMul: [1 / 2, 1 / 2] },
  tin: { texture: 'fr_tin', uvMul: [1 / 2.6, 1 / 2.6] },
  tinPale: { texture: 'fr_tin', tint: 0xd0ccc0, uvMul: [1 / 2.6, 1 / 2.6] },
  sandbag: { texture: 'bo_sandbag', uvMul: [1 / 1.6, 1 / 0.9] },
  net: { texture: 'jg_net', side: 'double' },
  crate: { texture: 'crate', uvMul: [1 / 1.2, 1 / 1.2] },
  ammo: { texture: 'bo_carpaint', tint: 0x5a6040 },
  barrel: { texture: 'barrel', tint: 0x5a6a3a, uvMul: [2, 1] },
  barrelRust: { texture: 'barrel', tint: 0x9a5a3a, uvMul: [2, 1] },
  jar: { texture: 'jg_mud', tint: 0xb07a50 },
  tarp: { texture: 'bo_fabric', tint: 0x7a8060 },
  logs: { texture: 'fr_logs', uvMul: [1 / 2, 1 / 1.2] },
  bark: { texture: 'fr_bark', uvMul: [1, 1 / 2] },
  foliage: { texture: 'fr_foliage', uvMul: [1 / 3, 1 / 3] },
  foliageDark: { texture: 'fr_foliage', tint: 0x7a8a6a, uvMul: [1 / 4, 1 / 4] },
  bush: { texture: 'fr_bush', side: 'double' },
  fern: { texture: 'jg_fern', side: 'double' },
  frondTop: { texture: 'fr_frondTop', side: 'double' },
  frondSide: { texture: 'fr_frondSide', side: 'double' },
  huey: { texture: 'bo_carpaint', tint: 0x5c6444 },
  hueyDark: { texture: 'bo_carpaint', tint: 0x3e4430 },
  glass: { texture: 'bo_glass' },
  flag: { texture: 'jg_flag', side: 'double' },
  paddy: { texture: 'fr_grass', tint: 0x9ab070, uvMul: [1 / 3, 1 / 3] },
  paddyWater: { texture: 'jg_water', tint: 0xa8b890, uvMul: [1 / 5, 1 / 5], emissive: 0.15 },
  hills: { texture: 'fr_hills', side: 'double', fog: false, tint: 0xb0bca8 },
  karst: { texture: 'jg_karst', side: 'double', fog: false },
  lamp: { texture: 'lamp', emissive: 1 },
  clip: { texture: 'none' },
};

// ---------------------------------------------------------------------------------------------
// Geometry helpers (polygons, rasters) and turned frames
// ---------------------------------------------------------------------------------------------

interface Hole {
  a0: number;
  a1: number;
  y0: number;
  y1: number;
}
interface Solidity {
  players?: boolean;
  bullets?: boolean;
  sight?: boolean;
}

const door = (a: number, w = 1.1, y = 0, h = 2.1): Hole => ({ a0: a - w / 2, a1: a + w / 2, y0: y, y1: y + h });
const win = (a0: number, a1: number, y0 = 0.95, y1 = 1.75): Hole => ({ a0, a1, y0, y1 });

function inside(P: P2[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, zi] = P[i]!;
    const [xj, zj] = P[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): { d: number; t: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
  return { d: Math.hypot(x - ax - t * dx, z - az - t * dz), t };
}

function edgeDist(P: P2[], x: number, z: number): number {
  let d = Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) d = Math.min(d, segDist(x, z, P[j]![0], P[j]![1], P[i]![0], P[i]![1]).d);
  return d;
}

function lineDist(pts: P2[], x: number, z: number): number {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(x, z, pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1]).d);
  return d;
}

interface Cell {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  level: number;
}

/** Cells (size `cell`) over [x0, x1] x [z0, z1] where `want` holds, merged into rectangles of equal `level`. */
function raster(x0: number, z0: number, x1: number, z1: number, cell: number, want: (x: number, z: number) => boolean, level: (x: number, z: number) => number = () => 0): Cell[] {
  const nx = Math.round((x1 - x0) / cell);
  const nz = Math.round((z1 - z0) / cell);
  const rows: { a: number; b: number; level: number }[][] = [];
  for (let j = 0; j < nz; j++) {
    const z = z0 + (j + 0.5) * cell;
    const runs: { a: number; b: number; level: number }[] = [];
    let cur: { a: number; b: number; level: number } | null = null;
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * cell;
      if (!want(x, z)) {
        cur = null;
        continue;
      }
      const lv = level(x, z);
      if (cur && cur.level === lv) cur.b = i + 1;
      else runs.push((cur = { a: i, b: i + 1, level: lv }));
    }
    rows.push(runs);
  }
  const out: Cell[] = [];
  let open = new Map<string, { a: number; b: number; level: number; j0: number }>();
  for (let j = 0; j <= nz; j++) {
    const next = new Map<string, { a: number; b: number; level: number; j0: number }>();
    for (const r of rows[j] ?? []) {
      const key = `${r.a},${r.b},${r.level}`;
      const o = open.get(key);
      next.set(key, o ? o : { ...r, j0: j });
      if (o) open.delete(key);
    }
    for (const o of open.values()) out.push({ x0: x0 + o.a * cell, z0: z0 + o.j0 * cell, x1: x0 + o.b * cell, z1: z0 + j * cell, level: o.level });
    open = next;
  }
  return out;
}

const hash = (x: number, z: number): number => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** Cross-section [lo, hi] of a convex polygon along the other axis at coordinate t of `axis`. */
function span(P: P2[], axis: 0 | 1, t: number): P2 | null {
  const o = axis === 0 ? 1 : 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < P.length; i++) {
    const a = P[i]!;
    const b = P[(i + 1) % P.length]!;
    if (t < Math.min(a[axis], b[axis]) || t > Math.max(a[axis], b[axis])) continue;
    if (Math.abs(b[axis] - a[axis]) < 1e-9) {
      lo = Math.min(lo, a[o], b[o]);
      hi = Math.max(hi, a[o], b[o]);
      continue;
    }
    const v = a[o] + ((b[o] - a[o]) * (t - a[axis])) / (b[axis] - a[axis]);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return lo <= hi ? [lo, hi] : null;
}

/** Solid wall segments of a wall from `lo` to `hi` (height h) with holes: [s0, s1, b0, b1]. */
function wallSegments(lo: number, hi: number, h: number, holes: Hole[]): [number, number, number, number][] {
  const hs = holes.map((k) => ({ a0: Math.max(lo, k.a0), a1: Math.min(hi, k.a1), y0: Math.max(0, k.y0), y1: Math.min(h, k.y1) })).filter((k) => k.a1 > k.a0 + 1e-6);
  const cuts = [...new Set([lo, hi, ...hs.flatMap((k) => [k.a0, k.a1])])].sort((p, q) => p - q);
  const out: [number, number, number, number][] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const s0 = cuts[i]!;
    const s1 = cuts[i + 1]!;
    if (s1 - s0 < 1e-6) continue;
    const mid = (s0 + s1) / 2;
    const open = hs.filter((k) => k.a0 <= mid && k.a1 >= mid).sort((p, q) => p.y0 - q.y0);
    let y = 0;
    for (const k of open) {
      if (k.y0 - y > 1e-6) out.push([s0, s1, y, k.y0]);
      y = Math.max(y, k.y1);
    }
    if (h - y > 1e-6) out.push([s0, s1, y, h]);
  }
  return out;
}

/** Collision runs of a turned wall: horizontal bands between hole edges, solid runs merged. */
function wallBands(lo: number, hi: number, h: number, holes: Hole[], t: number): [number, number, number, number][] {
  const hs = holes.map((k) => ({ a0: Math.max(lo, k.a0), a1: Math.min(hi, k.a1), y0: Math.max(0, k.y0), y1: Math.min(h, k.y1) })).filter((k) => k.a1 > k.a0 + 1e-6 && k.y1 > k.y0 + 1e-6);
  const ys = [...new Set([0, h, ...hs.flatMap((k) => [k.y0, k.y1])])].filter((y) => y >= 0 && y <= h).sort((a, b) => a - b);
  const out: [number, number, number, number][] = [];
  let prev: string | null = null;
  for (let i = 0; i < ys.length - 1; i++) {
    const ya = ys[i]!;
    const yb = ys[i + 1]!;
    const cut = hs.filter((k) => k.y0 <= ya + 1e-6 && k.y1 >= yb - 1e-6).sort((p, q) => p.a0 - q.a0);
    const runs: [number, number][] = [];
    let a = lo;
    for (const k of cut) {
      if (k.a0 > a + 1e-6) runs.push([a, k.a0]);
      a = Math.max(a, k.a1);
    }
    if (hi > a + 1e-6) runs.push([a, hi]);
    const key = JSON.stringify(runs);
    for (const [r0, r1] of runs) {
      const s0 = r0 === lo ? r0 - t : r0;
      const s1 = r1 === hi ? r1 + t : r1;
      const last = key === prev ? out.find((q) => q[0] === s0 && q[1] === s1 && Math.abs(q[3] - ya) < 1e-9) : undefined;
      if (last) last[3] = yb;
      else out.push([s0, s1, ya, yb]);
    }
    prev = key;
  }
  return out;
}

/**
 * A building turned by `th` (radians, +u towards +z) about its corner (ox, oz), in local u/v
 * metres. Boxes render rotated (`ry`) and collide as axis-aligned slices kept inside them.
 */
class Frame {
  readonly c: number;
  readonly s: number;
  constructor(
    readonly k: MapKit,
    readonly ox: number,
    readonly oz: number,
    readonly th: number,
  ) {
    this.c = Math.cos(th);
    this.s = Math.sin(th);
  }

  w(u: number, v: number): P2 {
    return [this.ox + u * this.c - v * this.s, this.oz + u * this.s + v * this.c];
  }

  p(u: number, y: number, v: number): Vec3 {
    const [x, z] = this.w(u, v);
    return { x, y, z };
  }

  /** Render-only rotated box (the renderer swaps a footprint turned past 45 degrees back, see Brush.ry). */
  vis(u0: number, v0: number, u1: number, v1: number, y0: number, y1: number, mat: string, o: BrushOpts = {}): void {
    const [cx, cz] = this.w((u0 + u1) / 2, (v0 + v1) / 2);
    let hw = Math.abs(u1 - u0) / 2;
    let hd = Math.abs(v1 - v0) / 2;
    if (Math.abs(Math.sin(this.th)) > 0.5) [hw, hd] = [hd, hw];
    this.k.aabb(cx - hw, y0, cz - hd, cx + hw, y1, cz + hd, mat, { ...o, ry: -this.th, collide: false });
  }

  /** Invisible collision for a rotated box: axis-aligned slices inside it. */
  solid(u0: number, v0: number, u1: number, v1: number, y0: number, y1: number, mat: string, o: Solidity & { tag?: string } = {}, step?: number): void {
    const P: P2[] = [this.w(u0, v0), this.w(u1, v0), this.w(u1, v1), this.w(u0, v1)];
    const long: P2 = Math.abs(u1 - u0) >= Math.abs(v1 - v0) ? [this.c, this.s] : [-this.s, this.c];
    const short = Math.min(Math.abs(u1 - u0), Math.abs(v1 - v0));
    step ??= Math.min(this.sliceStep(short, long[0], long[1]), Math.max(0.15, short / 2.5));
    const axis: 0 | 1 = Math.abs(long[0]) >= Math.abs(long[1]) ? 0 : 1;
    const cuts = [...new Set(P.map((q) => q[axis]))].sort((p, q) => p - q);
    const flags: BrushOpts = { noRender: true, players: o.players ?? true, bullets: o.bullets ?? true, sight: o.sight ?? true, ...(o.tag ? { tag: o.tag } : {}) };
    for (let j = 0; j < cuts.length - 1; j++) {
      const n = Math.max(1, Math.ceil((cuts[j + 1]! - cuts[j]!) / step - 1e-9));
      const ds = (cuts[j + 1]! - cuts[j]!) / n;
      for (let i = 0; i < n; i++) {
        const t0 = cuts[j]! + i * ds;
        const t1 = t0 + ds;
        const s0 = span(P, axis, t0 + 1e-6);
        const s1 = span(P, axis, t1 - 1e-6);
        if (!s0 || !s1) continue;
        const c0 = Math.max(s0[0], s1[0]);
        const c1 = Math.min(s0[1], s1[1]);
        if (c1 - c0 < 0.02) continue;
        if (axis === 0) this.k.aabb(t0, y0, c0, t1, y1, c1, mat, flags);
        else this.k.aabb(c0, y0, t0, c1, y1, t1, mat, flags);
      }
    }
  }

  /** Bounding box of a small rotated rect (collision only): caps slanted wall ends. */
  cap(u0: number, v0: number, u1: number, v1: number, y0: number, y1: number, mat: string, o: Solidity = {}): void {
    const P: P2[] = [this.w(u0, v0), this.w(u1, v0), this.w(u1, v1), this.w(u0, v1)];
    const xs = P.map((q) => q[0]);
    const zs = P.map((q) => q[1]);
    this.k.aabb(Math.min(...xs), y0, Math.min(...zs), Math.max(...xs), y1, Math.max(...zs), mat, { noRender: true, players: o.players ?? true, bullets: o.bullets ?? true, sight: o.sight ?? true });
  }

  /** Rendered and solid. */
  box(u0: number, v0: number, u1: number, v1: number, y0: number, y1: number, mat: string, o: BrushOpts & Solidity = {}, step?: number): void {
    this.vis(u0, v0, u1, v1, y0, y1, mat, o);
    this.solid(u0, v0, u1, v1, y0, y1, mat, o, step);
  }

  private sliceStep(t: number, dx: number, dz: number): number {
    const a = Math.max(Math.abs(dx), Math.abs(dz));
    const b = Math.min(Math.abs(dx), Math.abs(dz));
    if (b < 1e-3) return 1.0;
    const tan = b / a;
    const cos = a / Math.hypot(a, b);
    return Math.max(0.12, Math.min(1.0, (t / cos - 0.12) / (2 * tan)));
  }

  /** Wall along u at v (thickness t), from y0 up h, with holes in u. Ends overlap corners by t/2. */
  wallU(v: number, u0: number, u1: number, y0: number, h: number, t: number, mat: string, holes: Hole[] = [], o: BrushOpts & Solidity = {}): void {
    for (const [s0, s1, b0, b1] of wallSegments(u0, u1, h, holes)) this.vis(s0 === u0 ? s0 - t / 2 : s0, v - t / 2, s1 === u1 ? s1 + t / 2 : s1, v + t / 2, y0 + b0, y0 + b1, mat, o);
    const step = this.sliceStep(t, this.c, this.s);
    for (const [s0, s1, b0, b1] of wallBands(u0, u1, h, holes, t)) {
      this.solid(s0, v - t / 2, s1, v + t / 2, y0 + b0, y0 + b1, mat, o, step);
      const e = Math.min(0.3, (s1 - s0) / 2);
      this.cap(s0, v - t / 2, s0 + e, v + t / 2, y0 + b0, y0 + b1, mat, o);
      this.cap(s1 - e, v - t / 2, s1, v + t / 2, y0 + b0, y0 + b1, mat, o);
    }
  }

  /** Wall along v at u. */
  wallV(u: number, v0: number, v1: number, y0: number, h: number, t: number, mat: string, holes: Hole[] = [], o: BrushOpts & Solidity = {}): void {
    for (const [s0, s1, b0, b1] of wallSegments(v0, v1, h, holes)) this.vis(u - t / 2, s0 === v0 ? s0 - t / 2 : s0, u + t / 2, s1 === v1 ? s1 + t / 2 : s1, y0 + b0, y0 + b1, mat, o);
    const step = this.sliceStep(t, -this.s, this.c);
    for (const [s0, s1, b0, b1] of wallBands(v0, v1, h, holes, t)) {
      this.solid(u - t / 2, s0, u + t / 2, s1, y0 + b0, y0 + b1, mat, o, step);
      const e = Math.min(0.3, (s1 - s0) / 2);
      this.cap(u - t / 2, s0, u + t / 2, s0 + e, y0 + b0, y0 + b1, mat, o);
      this.cap(u - t / 2, s1 - e, u + t / 2, s1, y0 + b0, y0 + b1, mat, o);
    }
  }

  /**
   * Stairs over the rect rising towards `dir`: rotated visual steps, and collision as solid
   * axis-aligned blocks sheared along the run (each step a box from y0 to its tread).
   */
  stairs(u0: number, v0: number, u1: number, v1: number, y0: number, y1: number, dir: '+u' | '-u' | '+v' | '-v', mat: string, n?: number): void {
    const alongU = dir === '+u' || dir === '-u';
    const steps = n ?? Math.max(2, Math.ceil((y1 - y0) / 0.2));
    const r0 = alongU ? u0 : v0;
    const r1 = alongU ? u1 : v1;
    const c0 = alongU ? v0 : u0;
    const c1 = alongU ? v1 : u1;
    const sign = dir[0] === '+' ? 1 : -1;
    const runDir: P2 = alongU ? [this.c, this.s] : [-this.s, this.c];
    const ax: 0 | 1 = Math.abs(runDir[0]) >= Math.abs(runDir[1]) ? 0 : 1;
    const halfW = (c1 - c0) / 2 / Math.abs(runDir[ax]);
    const cc = (c0 + c1) / 2;
    const at = (r: number): P2 => (alongU ? this.w(r, cc) : this.w(cc, r));
    for (let i = 0; i < steps; i++) {
      const a = sign > 0 ? r0 + ((r1 - r0) * i) / steps : r1 - ((r1 - r0) * (i + 1)) / steps;
      const b = sign > 0 ? r0 + ((r1 - r0) * (i + 1)) / steps : r1 - ((r1 - r0) * i) / steps;
      const top = y0 + ((y1 - y0) * (i + 1)) / steps;
      if (alongU) this.vis(a, c0, b, c1, top - Math.min(0.6, top - y0), top, mat, { hide: ['ny'] });
      else this.vis(c0, a, c1, b, top - Math.min(0.6, top - y0), top, mat, { hide: ['ny'] });
      const A = at(a);
      const B = at(b);
      const m = (A[1 - ax]! + B[1 - ax]!) / 2;
      const lo = Math.min(A[ax], B[ax]);
      const hi = Math.max(A[ax], B[ax]);
      const flags: BrushOpts = { noRender: true, players: true, bullets: true, sight: true, tag: 'stairs' };
      if (ax === 0) this.k.aabb(lo, y0, m - halfW, hi, top, m + halfW, mat, flags);
      else this.k.aabb(m - halfW, y0, lo, m + halfW, top, hi, mat, flags);
    }
  }

  /** Upright post (render + collide as a small box). */
  post(u: number, v: number, h: number, mat: string, y0 = 0, r = 0.1): void {
    const [x, z] = this.w(u, v);
    this.k.aabb(x - r, y0, z - r, x + r, y0 + h, z + r, mat);
  }
}

// ---------------------------------------------------------------------------------------------
// Terrain: ground with the creek and foxholes, rock outcrops
// ---------------------------------------------------------------------------------------------

/** How far (m) inside the creek a point is (negative = outside). */
function creekInside(x: number, z: number): number {
  let best = -Infinity;
  for (let i = 0; i < CREEK_M.length - 1; i++) {
    const [ax, az, aw] = CREEK_M[i]!;
    const [bx, bz, bw] = CREEK_M[i + 1]!;
    const { d, t } = segDist(x, z, ax, az, bx, bz);
    best = Math.max(best, aw + (bw - aw) * t - d);
  }
  return best;
}

/** Ground height at (x, z): 0, or the stepped creek / foxhole terraces (0.4 m steps). */
export function jungleGroundLevel(x: number, z: number): number {
  let lv = 0;
  const c = creekInside(x, z);
  if (c > 0) lv = c < 0.6 ? -0.4 : c < 1.2 ? -0.8 : L.bed;
  for (const [ppx, ppy, r] of PITS) {
    const d = Math.hypot(x - px(ppx), z - pz(ppy));
    if (d < r) lv = Math.min(lv, d > r - 0.55 ? -0.4 : -0.8);
  }
  return lv;
}

function ground(k: MapKit): void {
  const b = JUNGLE_BOUNDS;
  const x0 = b.min.x - 4;
  const x1 = b.max.x + 4;
  const z0 = b.min.z - 4;
  const z1 = b.max.z + 4;
  // Beyond the rasterised area: four plain slabs.
  k.aabb(-260, -3, -260, 260, 0, z0, 'floor', { hide: ['ny'] });
  k.aabb(-260, -3, z1, 260, 0, 260, 'floor', { hide: ['ny'] });
  k.aabb(-260, -3, z0, x0, 0, z1, 'floor', { hide: ['ny'] });
  k.aabb(x1, -3, z0, 260, 0, z1, 'floor', { hide: ['ny'] });
  const cells = raster(x0, z0, x1, z1, 0.5, () => true, jungleGroundLevel);
  for (const r of cells) k.aabb(r.x0, -3, r.z0, r.x1, r.level, r.z1, r.level === 0 ? 'floor' : r.level > -0.5 ? 'mud' : 'bed', { hide: ['ny'] });
  // Water over the two lower terraces (render only, top face only).
  const wet = raster(x0, z0, x1, z1, 0.5, (x, z) => creekInside(x, z) >= 0.6);
  for (const r of wet) k.aabb(r.x0, L.water - 0.01, r.z0, r.x1, L.water, r.z1, 'water', { collide: false, hide: ['ny', 'px', 'nx', 'pz', 'nz'] });
}

/** Paths that run along rock faces: polylines (metres) with a height at each point and a keep-out radius. */
const ROCK_PATHS: { pts: [number, number, number][]; r: number }[] = [
  { pts: LEDGE.map(([a, b, h]) => [px(a), pz(b), h]), r: 1.45 },
  {
    pts: [
      [px(BRIDGE.deck[0]![0]), pz(BRIDGE.deck[0]![1]), L.bridge],
      [px(BRIDGE.deck[1]![0]), pz(BRIDGE.deck[1]![1]), L.bridge],
      [px(BRIDGE.path[1]![0]), pz(BRIDGE.path[1]![1]), (L.bridge + L.redHut) / 2 + 0.3],
      [px(BRIDGE.path[2]![0]), pz(BRIDGE.path[2]![1]), L.redHut],
    ],
    r: 1.7,
  },
];

/** Height of a path running past (x, z) within its keep-out radius, or null. */
function pathShelf(x: number, z: number): number | null {
  let best: { d: number; h: number } | null = null;
  for (const { pts, r } of ROCK_PATHS)
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az, ah] = pts[i]!;
      const [bx, bz, bh] = pts[i + 1]!;
      const { d, t } = segDist(x, z, ax, az, bx, bz);
      if (d < r && (!best || d < best.d)) best = { d, h: ah + (bh - ah) * t };
    }
  return best ? best.h : null;
}

const nearPaths = (x: number, z: number): boolean => pathShelf(x, z) !== null;

/** A rock outcrop: terraced boxes (higher towards the middle), an invisible clip above, palms on top. */
function rockMass(k: MapKit, def: RockDef): void {
  const P = poly(def.poly);
  const xs = P.map((p) => p[0]);
  const zs = P.map((p) => p[1]);
  const cell = 0.75;
  const x0 = Math.floor(Math.min(...xs) / cell) * cell;
  const x1 = Math.ceil(Math.max(...xs) / cell) * cell;
  const z0 = Math.floor(Math.min(...zs) / cell) * cell;
  const z1 = Math.ceil(Math.max(...zs) / cell) * cell;
  const edge = def.edge ?? 3.0;
  const isIn = (x: number, z: number) => inside(P, x, z);
  // Beside a path the rock steps down to a shelf just under it (no clip there), so the path never
  // has a crevice on its rock side and the rock never closes over it.
  const lv = (x: number, z: number) => {
    const shelf = pathShelf(x, z);
    if (shelf !== null) return Math.min(def.flat ?? def.peak, Math.max(-0.3, Math.floor((shelf - 0.05) / 0.15) * 0.15));
    if (def.flat !== undefined) return def.flat;
    const d = edgeDist(P, x, z);
    const h = edge + Math.min(d, 6) * (def.peak > 9 ? 1.5 : 0.8) + (hash(Math.round(x / 3), Math.round(z / 3)) - 0.5) * 0.8;
    return Math.min(def.peak, Math.max(edge, Math.round(h / 0.6) * 0.6));
  };
  const mat = def.name === 'C3' ? 'cliff' : 'rock';
  for (const r of raster(x0, z0, x1, z1, cell, isIn, lv)) k.aabb(r.x0, L.bed - 0.1, r.z0, r.x1, r.level, r.z1, mat, { hide: ['ny'] });
  if (def.flat === undefined) for (const r of raster(x0, z0, x1, z1, cell, (x, z) => isIn(x, z) && !nearPaths(x, z))) k.clip(r.x0, 1.5, r.z0, r.x1, 16, r.z1, 'perimeter');
  for (const [a, b, h] of def.palms ?? []) {
    const [x, z] = pt([a, b]);
    palm(k, x, z, h, lv(x, z) - 0.2);
  }
  // Undergrowth round the foot.
  for (let i = 0; i < P.length; i += 2) {
    const [ax, az] = P[i]!;
    const [bx, bz] = P[(i + 1) % P.length]!;
    const x = (ax * 2 + bx) / 3;
    const z = (az * 2 + bz) / 3;
    if (nearPaths(x, z)) continue;
    const gy = jungleGroundLevel(x, z);
    if (i % 4 === 0) fern(k, x, z, 1.1 + hash(ax, az) * 0.6, gy);
    else bush(k, x, z, 1.2 + hash(ax, az) * 0.8, gy);
  }
}

/** The Lookout's ledge: stepped rock blocks up the north-west face (each tread at most 0.25 m above the last). */
function ledge(k: MapKit): void {
  const W = 2.1;
  for (let i = 0; i < LEDGE.length - 1; i++) {
    const [ax, ay, ah] = LEDGE[i]!;
    const [bx, by, bh] = LEDGE[i + 1]!;
    const [x0, z0] = pt([ax, ay]);
    const [x1, z1] = pt([bx, by]);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const f = new Frame(k, x0, z0, Math.atan2(z1 - z0, x1 - x0));
    const n = Math.max(2, Math.ceil(len / 0.6));
    for (let j = 0; j < n; j++) {
      const top = ah + ((bh - ah) * (j + 0.5)) / n;
      f.vis((len * j) / n, -W / 2, (len * (j + 1)) / n, W / 2, -0.3, top, 'rockPath', { hide: ['ny'] });
    }
    slopeSolid(f, len, W, ah, bh, -0.3, 0, 'rockPath', 'stairs');
    // A joint block at the bend so turns leave no gap.
    if (i < LEDGE.length - 2) k.aabb(x1 - 0.6, -0.3, z1 - 0.6, x1 + 0.6, bh - 0.08, z1 + 0.6, 'rockPath', { hide: ['ny'], tag: 'stairs' });
  }
  // Boulders and a lone palm along the outer edge.
  const [ex, ez] = pt([306, 238]);
  k.aabb(ex - 0.5, 0, ez - 0.5, ex + 0.5, 1.0, ez + 0.5, 'rock');
}

// ---------------------------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------------------------

/** A palm: trunk and crossed frond cards (trunk collides when `collide`). */
function palm(k: MapKit, x: number, z: number, h: number, y0 = 0, collide = false): void {
  k.cyl(0.17, h, 6, 'bark', x, y0 + h / 2, z, { collide });
  const top = y0 + h;
  k.flatDecal(5.2, 5.2, 'frondTop', x, top, z, { uv: 'raw', ry: hash(x, z) * PI, seg: 1 });
  k.flatDecal(4.2, 4.2, 'frondTop', x, top - 0.45, z, { uv: 'raw', ry: hash(z, x) * PI + 0.6, seg: 1 });
  k.wallDecal(4.8, 2.0, 'frondSide', x, top - 1.6, z, hash(x, z) * PI, { uv: 'raw', seg: 1 });
  k.wallDecal(4.8, 2.0, 'frondSide', x, top - 1.6, z, hash(x, z) * PI + PI / 2, { uv: 'raw', seg: 1 });
}

/** A broadleaf jungle tree: trunk and stacked box canopies (render only unless `collide`). */
function tree(k: MapKit, x: number, z: number, h: number, r: number, collide = false, y0 = 0): void {
  k.cyl(r * 0.16, h, 7, 'bark', x, y0 + h / 2, z, { collide });
  k.box(r * 2, h * 0.28, r * 2, 'foliage', x, y0 + h * 0.62, z, { collide: false });
  k.box(r * 1.4, h * 0.22, r * 1.4, 'foliage', x + r * 0.2, y0 + h * 0.86, z - r * 0.15, { collide: false });
}

function bush(k: MapKit, x: number, z: number, s: number, y = 0): void {
  k.wallDecal(s * 1.6, s, 'bush', x, y, z, 0.4 + hash(x, z), { uv: 'raw', seg: 1 });
  k.wallDecal(s * 1.6, s, 'bush', x, y, z, 0.4 + hash(x, z) + PI / 2, { uv: 'raw', seg: 1 });
}

function fern(k: MapKit, x: number, z: number, s: number, y = 0): void {
  for (let i = 0; i < 3; i++) k.wallDecal(s * 1.8, s, 'fern', x, y, z, hash(z, x) * PI + (i * PI) / 3, { uv: 'raw', seg: 1 });
}

function crate(k: MapKit, x: number, z: number, s = 1.1, y = 0): void {
  k.box(s, s, s, 'crate', x, y, z, { uv: 'raw' });
}

/** A render-only cut-out fence along a polyline with posts; `solid` adds a player clip (bullets pass). */
function fenceLine(k: MapKit, pts: P2[], h: number, mat = 'bambooFence', solid = false): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i]!;
    const [bx, bz] = pts[i + 1]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.2) continue;
    const ry = Math.atan2(-(bz - az), bx - ax);
    k.wallDecal(len, h, mat, (ax + bx) / 2, jungleGroundLevel((ax + bx) / 2, (az + bz) / 2), (az + bz) / 2, ry, { uv: 'raw' });
    const n = Math.max(1, Math.round(len / 2.2));
    for (let j = 0; j <= n; j++) {
      const x = ax + ((bx - ax) * j) / n;
      const z = az + ((bz - az) * j) / n;
      k.trim(0.1, h + 0.15, 0.1, 'wood', x, jungleGroundLevel(x, z), z);
    }
    if (solid) {
      const f = new Frame(k, ax, az, Math.atan2(bz - az, bx - ax));
      f.solid(0, -0.06, len, 0.06, 0, h, 'clip', { bullets: false, sight: false });
    }
  }
}

/** A ring of sandbags round (x, z) (octagon of boxes), leaving a gap facing `gapYaw`. */
function sandbagRing(k: MapKit, x: number, z: number, r: number, h: number, gapAt: number): void {
  for (let i = 0; i < 8; i++) {
    if (i === gapAt) continue;
    const a = (i / 8) * PI * 2;
    const f = new Frame(k, x + Math.cos(a) * r, z + Math.sin(a) * r, a + PI / 2);
    const len = 2 * r * Math.tan(PI / 8) + 0.1;
    f.box(-len / 2, -0.3, len / 2, 0.3, 0, h, 'sandbag');
  }
}

/** Stepped roof tiers over a frame rect (render), the lowest tier solid (stops jumpers and bullets). */
function roof(f: Frame, u0: number, v0: number, u1: number, v1: number, y: number, mat: string, tiers = 3, over = 0.5): void {
  const W = u1 - u0;
  const D = v1 - v0;
  const inset = Math.min(W, D) / 2 / (tiers + 0.6);
  for (let i = 0; i < tiers; i++) {
    const e = i === 0 ? -over : inset * i;
    const yb = y + i * 0.32;
    if (i === 0) f.box(u0 + e, v0 + e, u1 - e, v1 - e, yb, yb + 0.32, mat);
    else f.vis(u0 + e, v0 + e, u1 - e, v1 - e, yb, yb + 0.32, mat, { hide: ['ny'] });
  }
  f.vis(u0 + inset * tiers, (v0 + v1) / 2 - 0.12, u1 - inset * tiers, (v0 + v1) / 2 + 0.12, y + tiers * 0.32, y + tiers * 0.32 + 0.18, 'wood', { hide: ['ny'] });
}

/**
 * Collision for a straight sloped strip in a frame (u 0..len, v -w/2..w/2, top ya -> yb): axis-aligned
 * slices along the dominant world axis, each topped at the strip's height at its middle. `base`
 * null makes a plank `thick` deep, otherwise the slices reach down to `base`.
 */
function slopeSolid(f: Frame, len: number, w: number, ya: number, yb: number, base: number | null, thick: number, mat: string, tag?: string): void {
  const P: P2[] = [f.w(0, -w / 2), f.w(len, -w / 2), f.w(len, w / 2), f.w(0, w / 2)];
  const axis: 0 | 1 = Math.abs(f.c) >= Math.abs(f.s) ? 0 : 1;
  const lo = Math.min(...P.map((q) => q[axis]));
  const hi = Math.max(...P.map((q) => q[axis]));
  const n = Math.max(1, Math.ceil((hi - lo) / 0.3));
  const flags: BrushOpts = { noRender: true, players: true, bullets: true, sight: true, ...(tag ? { tag } : {}) };
  for (let i = 0; i < n; i++) {
    const t0 = lo + ((hi - lo) * i) / n;
    const t1 = lo + ((hi - lo) * (i + 1)) / n;
    const s0 = span(P, axis, t0 + 1e-6);
    const s1 = span(P, axis, t1 - 1e-6);
    if (!s0 || !s1) continue;
    // The union of both ends' cross-sections, so neighbouring slices overlap and nothing falls between.
    const c0 = Math.min(s0[0], s1[0]);
    const c1 = Math.max(s0[1], s1[1]);
    const mx = axis === 0 ? (t0 + t1) / 2 : (c0 + c1) / 2;
    const mz = axis === 0 ? (c0 + c1) / 2 : (t0 + t1) / 2;
    const u = Math.max(0, Math.min(len, (mx - f.ox) * f.c + (mz - f.oz) * f.s));
    const top = ya + ((yb - ya) * u) / len;
    const y0 = base ?? top - thick;
    if (axis === 0) f.k.aabb(t0, y0, c0, t1, top, c1, mat, flags);
    else f.k.aabb(c0, y0, t0, c1, top, t1, mat, flags);
  }
}

/** A walkway between two points (metres) at heights ya -> yb: planks, rails, posts down to the ground. */
function walkway(k: MapKit, a: P2, b: P2, w: number, ya: number, yb: number, o: { rails?: boolean; posts?: boolean } = {}): Frame {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const f = new Frame(k, a[0], a[1], Math.atan2(b[1] - a[1], b[0] - a[0]));
  const flat = Math.abs(yb - ya) < 1e-3;
  const n = flat ? 1 : Math.max(2, Math.ceil(len / 0.6));
  for (let i = 0; i < n; i++) {
    const top = flat ? ya : ya + ((yb - ya) * (i + 0.5)) / n;
    f.vis((len * i) / n, -w / 2, (len * (i + 1)) / n, w / 2, top - 0.22, top, 'planks', { faceMats: { ny: 'planksDark' } });
  }
  if (flat) f.solid(0, -w / 2, len, w / 2, ya - 0.22, ya, 'planks');
  else slopeSolid(f, len, w, ya, yb, null, 0.3, 'planks');
  if (o.rails !== false) {
    for (const s of [-1, 1]) {
      const v = (s * w) / 2;
      if (flat) f.vis(0, v - 0.05, len, v + 0.05, ya + 0.95, ya + 1.05, 'wood');
      else for (let i = 0; i < 4; i++) f.vis((len * i) / 4, v - 0.05, (len * (i + 1)) / 4, v + 0.05, ya + ((yb - ya) * (i + 0.5)) / 4 + 0.95, ya + ((yb - ya) * (i + 0.5)) / 4 + 1.05, 'wood');
    }
  }
  if (o.posts !== false) {
    const m = Math.max(1, Math.round(len / 2.6));
    for (let j = 0; j <= m; j++) {
      const u = (len * j) / m;
      const top = ya + ((yb - ya) * j) / m;
      for (const s of [-1, 1]) {
        const [x, z] = f.w(u, (s * w) / 2);
        const g = jungleGroundLevel(x, z);
        f.post(u, (s * w) / 2, top - 0.22 - g, 'wood', g, 0.09);
        if (o.rails !== false) k.trim(0.08, 1.05, 0.08, 'wood', x, top, z);
      }
    }
  }
  return f;
}

// ---------------------------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------------------------

/** The Bridge: the stilt house in the north, the walkway and deck over the river, the cliff path. */
function bridge(k: MapKit): void {
  const B = L.bridge;
  const H = BRIDGE.house;
  const f = new Frame(k, px(H.o[0]), pz(H.o[1]), H.th);
  const W = H.w;
  const D = H.d;
  // Stilts, floor, the space under it stays open (bullets pass between the stilts).
  for (const u of [0.1, W / 2, W - 0.1]) for (const v of [0.1, D - 0.1]) f.post(u, v, B - 0.25, 'wood', 0, 0.13);
  f.box(-0.1, -0.1, W + 0.1, D + 0.1, B - 0.25, B, 'planksDark');
  f.wallU(0, 0, W, B, 2.3, 0.24, 'bamboo', [win(1.2, 2.6), win(4.2, 5.6)]);
  f.wallU(D, 0, W, B, 2.3, 0.24, 'bamboo', [door(1.1, 1.0), win(3.6, 5.2)]);
  f.wallV(0, 0, D, B, 2.3, 0.24, 'bamboo', [win(1.2, 2.8)]);
  f.wallV(W, 0, D, B, 2.3, 0.24, 'bamboo', [door(2.0, 1.4, 0, 2.2)]);
  roof(f, 0, 0, W, D, B + 2.3, 'thatch', 3, 0.6);
  f.box(0.3, 0.3, 1.6, 0.9, B, B + 0.8, 'crate', { uv: 'raw' });
  f.box(5.0, 3.2, 6.6, 3.8, B, B + 0.75, 'wood');
  const lamp = f.p(3.5, B + 2.0, 2);
  k.light(lamp.x, lamp.y, lamp.z, [1.3, 1.05, 0.7], 7, 'lamp');
  // Stairs down from the south door (rising north-north-west to the floor) with a landing.
  f.box(0.45, D, 1.75, D + 1.1, B - 0.25, B, 'planks');
  f.stairs(0.45, D + 1.1, 1.75, D + 7.4, 0, B - 0.05, '-v', 'wood', 18);
  // Walkway from the east door, the joint platform, the deck over the river, the cliff path.
  const w0 = pt(BRIDGE.walk[0]!);
  const w1 = pt(BRIDGE.walk[1]!);
  f.box(W + 0.1, D / 2 - 1.2, W + 1.2, D / 2 + 1.2, B - 0.22, B, 'planks', { faceMats: { ny: 'planksDark' } });
  walkway(k, w0, w1, 2.2, B, B);
  const d0 = pt(BRIDGE.deck[0]!);
  const d1 = pt(BRIDGE.deck[1]!);
  const jx = (w1[0] + d0[0]) / 2;
  const jz = (w1[1] + d0[1]) / 2;
  k.aabb(jx - 1.4, B - 0.22, jz - 1.4, jx + 1.4, B, jz + 1.4, 'planks', { faceMats: { ny: 'planksDark' } });
  for (const [sx, sz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]] as const) {
    const g = jungleGroundLevel(jx + sx, jz + sz);
    k.box(0.2, B - 0.22 - g, 0.2, 'wood', jx + sx, g, jz + sz);
  }
  walkway(k, d0, d1, 1.7, B, B);
  const p = poly(BRIDGE.path);
  // The cliff path: a plank ledge down the central rock's face, then onto the red hut's deck.
  walkway(k, p[0]!, p[1]!, 2.2, B, (B + L.redHut) / 2 + 0.3, { posts: false });
  k.aabb(p[1]![0] - 1.1, (B + L.redHut) / 2 + 0.08, p[1]![1] - 1.1, p[1]![0] + 1.1, (B + L.redHut) / 2 + 0.3, p[1]![1] + 1.1, 'planks', { faceMats: { ny: 'planksDark' } });
  walkway(k, p[1]!, p[2]!, 2.2, (B + L.redHut) / 2 + 0.3, L.redHut, { posts: false });
  // Rope lashings and a lantern at the middle of the deck.
  const mid: P2 = [(d0[0] + d1[0]) / 2, (d0[1] + d1[1]) / 2];
  k.light(mid[0], B + 2.2, mid[1], [1.3, 1.1, 0.75], 9, 'lamp');
  k.trim(0.25, 0.3, 0.25, 'lamp', mid[0] + 0.9, B + 1.1, mid[1]);
}

/** The red stilt house at the foot of the cliff path (D4): deck round two sides, stairs down south. */
function redHut(k: MapKit): void {
  const R = RED_HUT;
  const f = new Frame(k, px(R.o[0]), pz(R.o[1]), R.th);
  const W = R.w;
  const D = R.d;
  const FY = L.redHut;
  for (const u of [0.1, W / 2, W - 0.1]) for (const v of [0.1, D / 2, D - 0.1]) f.post(u, v, FY - 0.25, 'wood', 0, 0.12);
  f.box(0, 0, W, D, FY - 0.25, FY, 'planksDark');
  // Deck: north-north-west side and the west-north-west side (where the cliff path lands).
  f.box(-1.6, -2.0, W + 0.2, 0, FY - 0.25, FY, 'planks', { faceMats: { ny: 'planksDark' } });
  f.box(-1.6, 0, 0, D, FY - 0.25, FY, 'planks', { faceMats: { ny: 'planksDark' } });
  for (const [u, v] of [[-1.5, -1.9], [W + 0.1, -1.9], [-1.5, D - 0.1], [-1.5, D / 2]] as const) f.post(u, v, FY - 0.25, 'wood', 0, 0.1);
  f.vis(0.6, -2.05, W + 0.2, -1.95, FY + 0.95, FY + 1.05, 'wood');
  f.vis(W + 0.15, -2.0, W + 0.25, 0, FY + 0.95, FY + 1.05, 'wood');
  f.vis(-1.65, 1.4, -1.55, D, FY + 0.95, FY + 1.05, 'wood');
  f.wallU(0, 0, W, FY, 2.4, 0.24, 'redPlank', [door(1.4), win(3.2, 4.8)]);
  f.wallU(D, 0, W, FY, 2.4, 0.24, 'redPlank', [win(1.6, 3.6)]);
  f.wallV(0, 0, D, FY, 2.4, 0.24, 'redPlank', [win(1.6, 3.0), door(5.4)]);
  f.wallV(W, 0, D, FY, 2.4, 0.24, 'redPlank', [win(2.4, 4.6)]);
  roof(f, 0, 0, W, D, FY + 2.4, 'tiles', 3, 0.55);
  f.box(3.6, 4.8, 5.4, 6.7, FY, FY + 0.8, 'wood');
  f.box(4.3, 0.4, 5.4, 1.4, FY, FY + 1.0, 'crate', { uv: 'raw' });
  const lamp = f.p(2.9, FY + 2.0, 3.5);
  k.light(lamp.x, lamp.y, lamp.z, [1.35, 1.0, 0.65], 8, 'lamp');
  // Stairs down from the deck's south end, along the hut's west side.
  f.stairs(-1.6, D, 0, D + 5.0, 0, FY - 0.05, '-v', 'wood', 11);
}

/** The thatched stilt hut by the east spawn (the loading screen hut), C4/D4. */
function spawnHut(k: MapKit): void {
  const f = new Frame(k, px(384), pz(290), -26.2 * DEG);
  const W = 5.3;
  const D = 4.0;
  const FY = 0.9;
  for (const u of [0.1, W / 2, W - 0.1]) for (const v of [0.1, D - 0.1]) f.post(u, v, FY - 0.2, 'wood', 0, 0.12);
  f.box(0, 0, W, D, FY - 0.2, FY, 'planksDark');
  f.solid(0.2, 0.2, W - 0.2, D - 0.2, 0, FY - 0.2, 'clip', { bullets: false, sight: false });
  f.wallU(0, 0, W, FY, 2.1, 0.24, 'bamboo', [win(1.4, 2.6)]);
  f.wallU(D, 0, W, FY, 2.1, 0.24, 'bamboo', [door(2.6), win(4.0, 4.9)]);
  f.wallV(0, 0, D, FY, 2.1, 0.24, 'bamboo', [door(2.0)]);
  f.wallV(W, 0, D, FY, 2.1, 0.24, 'bamboo', [win(1.2, 2.8)]);
  roof(f, 0, 0, W, D, FY + 2.1, 'thatch', 3, 0.7);
  // Porch and steps on the south side, steps at the west door.
  f.box(1.5, D, 3.7, D + 1.2, FY - 0.2, FY, 'planks');
  f.solid(1.6, D, 3.6, D + 1.1, 0, FY - 0.2, 'clip', { bullets: false, sight: false });
  f.stairs(1.9, D + 1.2, 3.3, D + 2.4, 0, FY - 0.02, '-v', 'wood', 3);
  f.stairs(-1.2, 1.4, 0, 2.6, 0, FY - 0.02, '+u', 'wood', 3);
  // Hanging straw bundles and a water jar by the porch.
  for (const u of [1.6, 3.6]) {
    const [x, z] = f.w(u, D + 1.15);
    k.trim(0.35, 0.6, 0.35, 'thatch', x, FY + 1.3, z);
  }
  const [jx, jz] = f.w(4.4, D + 0.9);
  k.cyl(0.32, 0.8, 8, 'jar', jx, 0.4, jz);
  const lamp = f.p(2.6, FY + 1.9, 2);
  k.light(lamp.x, lamp.y, lamp.z, [1.3, 1.0, 0.65], 6, 'lamp');
}

/** The Village (D3): the L-shaped longhouse, the small hut, the white stilt hut on the south edge. */
function village(k: MapKit): void {
  // Longhouse: L-shaped, raised 0.4 m, thatch; doors on every side.
  const f = new Frame(k, px(225), pz(333), 27 * DEG);
  const FY = 0.4;
  const H = 2.6;
  const t = 0.24;
  f.box(-0.1, -0.1, 6.6, 9.95, 0, FY, 'planksDark');
  f.box(6.6, 3.4, 10.1, 9.95, 0, FY, 'planksDark');
  f.wallU(0, 0, 6.5, FY, H, t, 'planks', [door(2.0), win(3.8, 5.4)]);
  f.wallV(6.5, 0, 3.5, FY, H, t, 'planks', [door(1.8)]);
  f.wallU(3.5, 6.5, 10, FY, H, t, 'planks', [win(7.4, 9.0)]);
  f.wallV(10, 3.5, 9.85, FY, H, t, 'planks', [win(4.4, 5.6), door(7.2)]);
  f.wallU(9.85, 0, 10, FY, H, t, 'planks', [door(2.4), win(4.4, 6.0), door(8.4)]);
  f.wallV(0, 0, 9.85, FY, H, t, 'planks', [win(1.8, 3.4), door(5.8), win(7.6, 9.0)]);
  f.wallV(5.0, 4.6, 9.85, FY, H, t, 'planksDark', [door(7.4)]);
  roof(f, 0, 0, 6.5, 9.85, FY + H, 'thatch', 3, 0.6);
  roof(f, 6.5, 3.5, 10, 9.85, FY + H - 0.16, 'thatch', 2, 0.6);
  f.box(1.0, 6.6, 3.2, 7.6, FY, FY + 0.75, 'wood');
  f.box(7.6, 8.4, 9.2, 9.3, FY, FY + 1.1, 'crate', { uv: 'raw' });
  f.box(0.6, 0.6, 1.6, 1.6, FY, FY + 0.9, 'crate', { uv: 'raw' });
  for (const [u, v] of [[2.0, -0.6], [6.7, 1.8], [-0.6, 5.8], [10.6, 7.2], [2.4, 10.4], [8.4, 10.4]] as const) {
    const [x, z] = f.w(u, v);
    k.aabb(x - 0.45, 0, z - 0.45, x + 0.45, 0.2, z + 0.45, 'wood');
  }
  const l1 = f.p(3.0, FY + 2.2, 3.0);
  const l2 = f.p(8.0, FY + 2.2, 6.5);
  k.light(l1.x, l1.y, l1.z, [1.3, 1.0, 0.65], 8, 'lamp');
  k.light(l2.x, l2.y, l2.z, [1.3, 1.0, 0.65], 7, 'lamp');

  // Small hut: planks, tin roof, doors north-north-east and east-south-east.
  const s = new Frame(k, px(269.6), pz(331), 24 * DEG);
  s.box(-0.05, -0.05, 4.31, 5.5, 0, 0.3, 'planksDark');
  s.wallU(0, 0, 4.26, 0.3, 2.4, t, 'planksDark', [door(2.1)]);
  s.wallU(5.45, 0, 4.26, 0.3, 2.4, t, 'planksDark', [win(1.2, 2.6)]);
  s.wallV(0, 0, 5.45, 0.3, 2.4, t, 'planksDark', [win(2.0, 3.4)]);
  s.wallV(4.26, 0, 5.45, 0.3, 2.4, t, 'planksDark', [door(3.6)]);
  roof(s, 0, 0, 4.26, 5.45, 2.7, 'tin', 2, 0.45);
  s.box(0.4, 3.8, 1.4, 5.0, 0.3, 1.1, 'crate', { uv: 'raw' });

  // White stilt hut on the south edge (Viet Cong flag inside): doors north and west.
  const X0 = px(293);
  const X1 = px(318);
  const Z0 = pz(370);
  const Z1 = pz(406);
  const FW = 0.6;
  k.aabb(X0, 0, Z0, X1, FW, Z1, 'planksPale');
  k.wall('x', X0, X1, Z0 + 0.08, FW, 2.6, 0.16, 'planksPale', [door(X0 + 2.2, 1.2), win(X0 + 3.8, X0 + 5.6)]);
  k.wall('x', X0, X1, Z1 - 0.08, FW, 2.6, 0.16, 'planksPale', [win(X0 + 2.0, X0 + 4.6)]);
  k.wall('z', Z0 + 0.16, Z1 - 0.16, X0 + 0.08, FW, 2.6, 0.16, 'planksPale', [win(Z0 + 1.6, Z0 + 3.0), door(Z0 + 6.4, 1.2)]);
  k.wall('z', Z0 + 0.16, Z1 - 0.16, X1 - 0.08, FW, 2.6, 0.16, 'planksPale', [win(Z0 + 4.0, Z0 + 6.4)]);
  k.wall('x', X0 + 0.16, X1 - 3.0, Z0 + 5.2, FW, 2.6, 0.12, 'planksPale', [door(X0 + 2.0, 1.1)]);
  k.aabb(X0 - 0.5, FW + 2.6, Z0 - 0.5, X1 + 0.5, FW + 2.9, Z1 + 0.5, 'tinPale', { faceMats: { ny: 'planksDark' } });
  k.aabb(X0 + 1.0, FW + 2.9, Z0 + 0.6, X1 - 1.0, FW + 3.5, Z1 - 0.6, 'tinPale', { collide: false, hide: ['ny'] });
  k.wallDecal(1.8, 1.2, 'flag', X1 - 0.17, FW + 1.0, Z0 + 8.2, -PI / 2, { uv: 'raw' });
  k.box(1.8, 0.75, 0.9, 'wood', X0 + 3.6, FW, Z0 + 8.4);
  crate(k, X0 + 0.9, Z1 - 1.0, 1.0, FW);
  k.stairs(X0 + 1.6, 0, Z0 - 1.4, X0 + 2.8, FW - 0.02, Z0, '+z', 'wood', 3);
  k.stairs(X0 - 1.3, 0, Z0 + 5.8, X0, FW - 0.02, Z0 + 7.0, '+x', 'wood', 3);
  k.light((X0 + X1) / 2, FW + 2.2, Z0 + 8, [1.3, 1.0, 0.65], 7, 'lamp');

  // Village cover: bamboo fences, crates, barrels, jars, a log pile.
  fenceLine(k, poly([[200, 330], [205, 345], [208, 368]]), 1.6, 'bambooFence', true);
  fenceLine(k, poly([[262, 368], [282, 372], [290, 368]]), 1.5, 'bambooFence', true);
  fenceLine(k, poly([[252, 324], [262, 328]]), 1.4, 'bambooFence', true);
  for (const [a, b] of [[255, 360], [289, 352], [218, 388], [275, 392]] as const) crate(k, px(a), pz(b), 1.1);
  crate(k, px(256), pz(363), 0.8, 1.1);
  for (const [a, b, m] of [[284, 362, 'barrel'], [285.5, 365, 'barrelRust'], [246, 391, 'barrel'], [214, 330, 'barrelRust']] as const) k.cyl(0.32, 0.9, 8, m, px(a), 0.45, pz(b));
  for (const [a, b] of [[262, 358], [264, 359.5], [237, 392]] as const) k.cyl(0.3, 0.7, 8, 'jar', px(a), 0.35, pz(b));
  const lg = new Frame(k, px(294), pz(352), -20 * DEG);
  lg.box(0, 0, 3.4, 1.1, 0, 0.9, 'logs');
  // The south yard's lean-to with sandbags (between the longhouse and the white hut).
  const lt = new Frame(k, px(262), pz(381), 0);
  for (const [u, v] of [[0, 0], [4, 0], [0, 2.6], [4, 2.6]] as const) lt.post(u, v, 2.3, 'wood');
  lt.box(-0.2, -0.2, 4.2, 2.8, 2.3, 2.42, 'tin', { faceMats: { ny: 'planksDark' } });
  lt.box(0.3, 2.2, 3.7, 2.8, 0, 1.0, 'sandbag');
}

/** The Ruins (west): the temple platform, the roofless ruin by the creek with its arch, walls and sandbags. */
function ruins(k: MapKit): void {
  const T = L.temple;
  // Temple platform with stairs on the north (creek side) and east, a stone dais and broken walls on it.
  const X0 = px(104);
  const X1 = px(142);
  const Z0 = pz(317);
  const Z1 = pz(355);
  k.aabb(X0, -0.5, Z0, X1, T, Z1, 'stone', { faceMats: { py: 'paving' } });
  k.stairs(px(118), 0, Z0 - 1.6, px(128), T, Z0, '+z', 'stone', 4);
  k.stairs(X1, 0, pz(330), X1 + 1.6, T, pz(340), '-x', 'stone', 4);
  const cx = px(124);
  const cz = pz(337);
  // Cross-shaped dais (+0.5) with a shrine block in the middle.
  k.aabb(cx - 1.4, T, cz - 4.2, cx + 1.4, T + 0.4, cz + 4.2, 'paving');
  k.aabb(cx - 4.2, T, cz - 1.4, cx - 1.4, T + 0.4, cz + 1.4, 'paving');
  k.aabb(cx + 1.4, T, cz - 1.4, cx + 4.2, T + 0.4, cz + 1.4, 'paving');
  k.aabb(cx - 0.8, T + 0.4, cz - 0.8, cx + 0.8, T + 1.7, cz + 0.8, 'stoneDark');
  // Broken walls and pillars round the platform rim.
  k.wall('x', X0 + 0.4, X0 + 4.4, Z1 - 0.4, T, 2.6, 0.6, 'stone');
  k.wall('x', X1 - 3.6, X1 - 0.4, Z1 - 0.4, T, 1.6, 0.6, 'stone');
  k.wall('z', Z0 + 0.4, Z0 + 3.4, X0 + 0.4, T, 2.2, 0.6, 'stone');
  k.wall('z', Z1 - 4.6, Z1 - 0.7, X0 + 0.4, T, 3.0, 0.6, 'stone', [win(Z1 - 3.4, Z1 - 2.2, 1.1, 1.9)]);
  for (const [x, z, h] of [[X0 + 3.2, Z0 + 0.6, 3.2], [X1 - 0.6, Z0 + 0.6, 2.4], [X1 - 0.6, Z1 - 4.4, 1.4], [cx - 3.4, cz - 3.4, 2.8], [cx + 3.4, cz + 3.4, 2.0]] as const) k.aabb(x - 0.45, T, z - 0.45, x + 0.45, T + h, z + 0.45, 'stone');
  // The arch over the north stairs.
  k.aabb(px(116.5), 0, Z0 - 2.0, px(118), 3.4, Z0 - 0.9, 'stone');
  k.aabb(px(128), 0, Z0 - 2.0, px(129.5), 3.4, Z0 - 0.9, 'stone');
  k.aabb(px(116.5), 3.4, Z0 - 2.0, px(129.5), 4.2, Z0 - 0.9, 'stoneDark');
  // The roofless ruin by the creek (R1): stone walls, an arched opening north, door east, window west.
  const R0x = px(104.4);
  const R1x = px(117.6);
  const R0z = pz(266.5);
  const R1z = pz(288.6);
  k.wall('x', R0x, R1x, R0z + 0.3, 0, 3.2, 0.6, 'stone', [{ a0: px(108), a1: px(114), y0: 0, y1: 2.6 }]);
  k.wall('x', R0x, R1x, R1z - 0.3, 0, 2.4, 0.6, 'stone', [door(px(111), 1.2)]);
  k.wall('z', R0z + 0.6, R1z - 0.6, R0x + 0.3, 0, 2.8, 0.6, 'stone', [win(pz(276), pz(279), 1.0, 1.8)]);
  k.wall('z', R0z + 0.6, R1z - 0.6, R1x - 0.3, 0, 2.0, 0.6, 'stone', [door(pz(281), 1.4)]);
  k.aabb(px(108), 2.6, R0z, px(114), 3.2, R0z + 0.6, 'stoneDark');
  // Curved low stone wall (R2) between the spawn yard and the platform.
  for (const [a, b] of [[[98, 349], [98.5, 324]], [[98.5, 324], [101, 302]], [[101, 302], [116, 295]]] as [P2, P2][]) {
    const A = pt(a);
    const B = pt(b);
    const f = new Frame(k, A[0], A[1], Math.atan2(B[1] - A[1], B[0] - A[0]));
    f.box(0, -0.35, Math.hypot(B[0] - A[0], B[1] - A[1]), 0.35, 0, 1.0, 'stone');
  }
  // A fallen stone block (the notch by the outline), round paved yards.
  k.aabb(px(178.5), 0, pz(334), px(189.6), 2.2, pz(345), 'stoneDark');
  k.flatDecal(4.8, 4.8, 'paving', px(142), 0.02, pz(367.5), { ry: 0.3 });
  k.flatDecal(4.8, 4.8, 'paving', px(142), 0.025, pz(367.5), { ry: 0.3 + PI / 4 });
  k.flatDecal(3.6, 3.6, 'paving', px(52), 0.02, pz(331), { ry: 0.2 });
  k.flatDecal(3.6, 3.6, 'paving', px(52), 0.025, pz(331), { ry: 0.2 + PI / 4 });
  // Sandbags on the walls (the spawn's cover) and along the creek bank.
  k.aabb(px(84), 0, pz(306), px(95), 1.0, pz(309), 'sandbag');
  k.aabb(px(118.5), 0, pz(268), px(121.5), 1.0, pz(276), 'sandbag');
  k.aabb(px(60), 0, pz(286), px(71), 1.0, pz(289), 'sandbag');
  k.aabb(px(150), 0, pz(330), px(153), 1.0, pz(348), 'sandbag');
  crate(k, px(78), pz(352), 1.1);
  crate(k, px(82.5), pz(352), 1.0);
  k.cyl(0.32, 0.9, 8, 'barrel', px(60), 0.45, pz(312));
  k.light(px(124), 3.4, pz(330), [1.3, 1.05, 0.7], 9, 'lamp');
  k.trim(0.3, 0.3, 0.3, 'lamp', px(124), 3.5, pz(318.5));
  // Stone stairs and walls up to the B2 lane north of the ruin (overgrown).
  for (const [x, z] of [[px(124), pz(296)], [px(138), pz(259)]] as const) fern(k, x, z, 1.3);
}

/** The waterfall pool in the north-west bay (C1): a cliff with the falls, boulders round the pool. */
function waterfall(k: MapKit): void {
  const x = px(97);
  const zTop = pz(214);
  k.aabb(px(80), -1.3, zTop - 6, px(122), 9.5, zTop, 'cliff', { collide: false });
  k.aabb(px(84), 9.5, zTop - 5, px(116), 11.5, zTop - 1, 'cliff', { collide: false });
  k.wallDecal(3.2, 10.2, 'falls', x, L.water, zTop + 0.06, 0, { uv: 'raw', seg: 2 });
  k.wallDecal(2.2, 9.4, 'falls', x + 0.5, L.water, zTop + 0.1, 0, { uv: 'raw', seg: 2 });
  k.flatDecal(4.6, 2.4, 'falls', x, L.water + 0.03, zTop + 1.3, { uv: 'raw', ry: 0, seg: 1 });
  for (const [a, b, s] of [[90, 219, 1.2], [104, 220, 1.0], [86, 229, 0.9]] as const) {
    const [bx, bz] = pt([a, b]);
    k.aabb(bx - s / 2, L.bed, bz - s / 2, bx + s / 2, -0.2 + s * 0.4, bz + s / 2, 'rock');
  }
  palm(k, px(84), pz(208), 9);
  palm(k, px(112), pz(209), 8);
  k.light(x, 1.5, zTop + 2, [0.7, 0.85, 0.9], 8, 'mist');
}

/** The north-east Base (A4/B4): the sandbag compound under a camo net, the small bunker, cover. */
function base(k: MapKit): void {
  const th = 19 * DEG;
  const S = 9.4;
  const [cx, cz] = pt([352, 118]);
  const f = new Frame(k, cx - (S / 2) * Math.cos(th) + (S / 2) * Math.sin(th), cz - (S / 2) * Math.sin(th) - (S / 2) * Math.cos(th), th);
  const h = 1.3;
  const t = 0.8;
  f.wallU(t / 2, 0, S, 0, h, t, 'sandbag', [door(3.2, 2.0, 0, h)]);
  f.wallU(S - t / 2, 0, S, 0, h, t, 'sandbag', [door(6.4, 2.4, 0, h)]);
  f.wallV(t / 2, t, S - t, 0, h, t, 'sandbag', [door(4.6, 2.2, 0, h)]);
  f.wallV(S - t / 2, t, S - t, 0, h, t, 'sandbag');
  for (const u of [0.4, S / 2, S - 0.4]) for (const v of [0.4, S / 2, S - 0.4]) if (!(u === S / 2 && v === S / 2)) f.post(u, v, 2.8, 'wood', 0, 0.09);
  f.vis(-0.6, -0.6, S + 0.6, S + 0.6, 2.8, 2.82, 'net');
  f.vis(1.2, 1.2, S - 1.2, S - 1.2, 3.05, 3.07, 'net');
  f.box(1.4, 1.4, 3.2, 2.4, 0, 0.75, 'wood');
  f.box(1.6, 1.5, 2.2, 2.2, 0.75, 1.05, 'ammo');
  f.box(6.2, 1.4, 7.8, 2.6, 0, 1.0, 'ammo');
  f.box(6.3, 1.5, 7.7, 2.5, 1.0, 1.5, 'ammo');
  f.box(1.4, 6.6, 2.6, 7.8, 0, 1.2, 'crate', { uv: 'raw' });
  f.box(4.0, 4.2, 5.4, 5.4, 0, 0.9, 'crate', { uv: 'raw' });
  const lamp = f.p(S / 2, 2.4, S / 2);
  k.light(lamp.x, lamp.y, lamp.z, [1.3, 1.05, 0.7], 9, 'lamp');
  // Small sandbag bunker east of the compound.
  const bx0 = px(371);
  const bx1 = px(381);
  const bz0 = pz(109);
  const bz1 = pz(123);
  k.aabb(bx0, 0, bz0, bx1, 1.2, bz0 + 0.8, 'sandbag');
  k.aabb(bx1 - 0.8, 0, bz0 + 0.8, bx1, 1.2, bz1, 'sandbag');
  k.aabb(bx0, 0, bz1 - 0.8, bx1 - 0.8, 1.2, bz1, 'sandbag');
  // Cover round the post: a log line along the north-east edge, sandbags, crates, a radio mast.
  const lg = new Frame(k, px(400), pz(150), 35 * DEG);
  lg.box(0, -0.5, 6.5, 0.5, 0, 0.8, 'logs');
  k.aabb(px(322), 0, pz(100), px(325), 1.0, pz(112), 'sandbag');
  k.aabb(px(355), 0, pz(141), px(368), 1.0, pz(144), 'sandbag');
  crate(k, px(330), pz(140), 1.2);
  crate(k, px(334.5), pz(141), 1.0);
  k.cyl(0.06, 8, 4, 'wood', px(388), 4, pz(92), { collide: false });
  k.cyl(0.32, 0.9, 8, 'barrel', px(316), 0.45, pz(96));
  k.cyl(0.32, 0.9, 8, 'barrelRust', px(318), 0.45, pz(99));
  // The diamond hut on the north lane (B2/B3): planks, tin roof, door south.
  const dh = new Frame(k, px(227), pz(149) - 2.3, 45 * DEG);
  dh.wallU(0, 0, 3.25, 0, 2.4, 0.24, 'planks');
  dh.wallU(3.25, 0, 3.25, 0, 2.4, 0.24, 'planks', [door(1.6, 1.0)]);
  dh.wallV(0, 0, 3.25, 0, 2.4, 0.24, 'planks', [win(1.0, 2.2)]);
  dh.wallV(3.25, 0, 3.25, 0, 2.4, 0.24, 'planks');
  roof(dh, 0, 0, 3.25, 3.25, 2.4, 'tin', 2, 0.35);
  // North lane cover: a cart, crates, a log by the stilt house.
  const cart = new Frame(k, px(240), pz(130), 10 * DEG);
  cart.box(0, 0, 2.6, 1.4, 0.5, 1.0, 'planksDark');
  for (const u of [0.6, 2.0]) {
    const [x, z] = cart.w(u, -0.05);
    k.cyl(0.5, 0.1, 10, 'wood', x, 0.5, z, { axis: 'z', collide: false });
  }
  crate(k, px(212), pz(134), 1.1);
  crate(k, px(190), pz(146), 1.0);
  const lg2 = new Frame(k, px(160), pz(163), -40 * DEG);
  lg2.box(0, -0.45, 4.2, 0.45, 0, 0.8, 'logs');
}

/** The east spawn (C5): foxholes ringed with sandbags, a trench wall, supplies under a tarp, the bamboo fence. */
function eastSpawn(k: MapKit): void {
  for (const [a, b, r] of PITS) sandbagRing(k, px(a), pz(b), r + 0.5, 0.75, 4);
  // Supplies under a tarp.
  k.aabb(px(421), 0, pz(261), px(430), 1.3, pz(267), 'crate', { uv: 'raw' });
  k.aabb(px(421), 0, pz(267), px(426), 0.9, pz(276), 'crate', { uv: 'raw' });
  k.aabb(px(419.5), 1.9, pz(259.5), px(431.5), 2.0, pz(277.5), 'tarp', { collide: false });
  for (const [a, b] of [[420, 260], [431, 260], [420, 277], [431, 277]] as const) k.box(0.1, 1.9, 0.1, 'wood', px(a), 0, pz(b), { collide: false });
  // Trench wall (sandbags) facing west, crates.
  k.aabb(px(427), 0, pz(205), px(430), 1.0, pz(216), 'sandbag');
  k.aabb(px(424), 0, pz(282), px(437), 1.0, pz(285), 'sandbag');
  crate(k, px(452), pz(236), 1.1);
  crate(k, px(447), pz(206), 1.0);
  // The bamboo fence along the east edge (render), the rice paddies beyond it.
  fenceLine(k, poly([[455, 190], [460, 205], [461, 240], [458, 252]]), 1.8);
  fenceLine(k, poly([[459, 258], [461, 270], [453, 286], [432, 290]]), 1.8);
  k.light(px(436), 2.4, pz(248), [1.3, 1.05, 0.7], 9, 'lamp');
}

/** Out of bounds to the east: rice paddy terraces, a crashed Huey, a track. */
function paddies(k: MapKit): void {
  const x0 = px(470);
  for (let i = 0; i < 6; i++) {
    const zc = pz(150 + i * 32);
    const xx = x0 + i * 1.4;
    k.aabb(xx, -0.2 - i * 0.25, zc - 7.5, xx + 40, -0.1 - i * 0.25, zc + 7.5, 'paddy', { collide: false, hide: ['ny'] });
    k.flatDecal(36, 13, 'paddyWater', xx + 20, -0.08 - i * 0.25, zc, { seg: 2 });
    k.aabb(xx - 0.5, -0.5 - i * 0.25, zc - 7.5, xx, 0.3 - i * 0.25, zc + 7.5, 'mud', { collide: false, hide: ['ny'] });
  }
  // The crashed UH-1: fuselage on its side, tail boom, a bent rotor blade.
  const f = new Frame(k, px(492), pz(208), -30 * DEG);
  f.vis(0, -1.2, 5.6, 1.2, -0.3, 2.0, 'huey');
  f.vis(5.6, -0.4, 13.0, 0.4, 0.5, 1.3, 'huey');
  f.vis(12.2, -0.15, 13.4, 0.15, 1.0, 3.0, 'hueyDark');
  f.vis(0.4, -1.25, 1.8, 1.25, 0.6, 1.7, 'glass');
  f.vis(1.0, -0.3, 2.4, 0.3, 2.0, 2.5, 'hueyDark');
  const r = new Frame(k, px(485), pz(196), 20 * DEG);
  r.vis(0, -0.2, 7.0, 0.2, 0.05, 0.15, 'hueyDark');
  // The second wreck further out (the overhead shows two).
  const g = new Frame(k, px(520), pz(150), 70 * DEG);
  g.vis(0, -1.1, 5.0, 1.1, -0.2, 1.8, 'hueyDark');
  g.vis(5.0, -0.35, 11, 0.35, 0.3, 1.0, 'huey');
}

/** Clips everything outside the playable outline; the jungle wall and palms beyond it. */
function outline(k: MapKit): void {
  const b = JUNGLE_BOUNDS;
  const O = JUNGLE_OUTLINE;
  for (const r of raster(b.min.x, b.min.z, b.max.x, b.max.z, 0.5, (x, z) => !inside(O, x, z))) k.clip(r.x0, b.min.y, r.z0, r.x1, 16, r.z1, 'perimeter');
  k.perimeter(b, 16);
  for (let i = 0; i < O.length; i++) {
    const [ax, az] = O[i]!;
    const [bx, bz] = O[(i + 1) % O.length]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1.5) continue;
    // The east edge over the rice paddies stays open (low fence and the view).
    const east = (ax + bx) / 2 > px(452);
    const nx = (bz - az) / len;
    const nz = -(bx - ax) / len;
    const th = Math.atan2(bz - az, bx - ax);
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const clear = (half: number, off: number) => [-1, 0, 1].every((a) => [off - 1.5, off + 1.5].every((o) => !inside(O, (ax + bx) / 2 + ux * half * a + nx * o, (az + bz) / 2 + uz * half * a + nz * o)));
    if (!east) {
      let half = len / 2 + 0.6;
      while (half > 1 && !clear(half, 3.2)) half -= 0.5;
      if (half > 1) {
        const cx = (ax + bx) / 2 + nx * 3.2;
        const cz = (az + bz) / 2 + nz * 3.2;
        const h = 4.5 + hash(ax, bz) * 3.5;
        const [hx, hz] = Math.abs(Math.sin(th)) > 0.5 ? [1.4, half] : [half, 1.4];
        k.aabb(cx - hx, 0, cz - hz, cx + hx, h, cz + hz, 'foliageDark', { collide: false, ry: -th });
      }
    }
    for (let s = 0.25; s < 1; s += 0.5) {
      const ox = ax + (bx - ax) * s + nx * 6.5;
      const oz = az + (bz - az) * s + nz * 6.5;
      if (edgeDist(O, ox, oz) > 3 && !inside(O, ox, oz)) {
        if (east) palm(k, ox + 6, oz, 8 + hash(ox, oz) * 4);
        else if (hash(ox, oz) > 0.45) tree(k, ox, oz, 10 + hash(oz, ox) * 6, 3 + hash(ox, oz) * 1.5);
        else palm(k, ox, oz, 9 + hash(ox * s, oz) * 5);
      }
    }
    // Ferns along the inside of the edge.
    const fx = ax + (bx - ax) * 0.5 - nx * 0.9;
    const fz = az + (bz - az) * 0.5 - nz * 0.9;
    if (!east && inside(O, fx, fz)) fern(k, fx, fz, 1.0 + hash(fx, fz) * 0.6, jungleGroundLevel(fx, fz));
  }
}

function backdrop(k: MapKit): void {
  // Tree ring, the jungle hills and the karst towers in the haze.
  for (let a = 0; a < 48; a++) {
    const t = (a / 48) * PI * 2;
    const rx = 82 + 8 * Math.sin(a * 2.3);
    const rz = 74 + 8 * Math.cos(a * 1.7);
    const x = Math.cos(t) * rx;
    const z = Math.sin(t) * rz;
    if (x > 62 && Math.abs(z) < 30) continue; // the rice paddies stay open
    if (a % 3 === 0) tree(k, x, z, 12 + 5 * Math.abs(Math.sin(a * 1.31)), 4 + Math.abs(Math.cos(a * 0.7)));
    else palm(k, x, z, 11 + 4 * Math.abs(Math.sin(a * 0.9)));
  }
  k.backdropRing('karst', 210, 9, 120, 90, -4, 0.35);
  k.backdropRing('hills', 140, 12, 90, 30, -3);
}

export function buildJungle(): MapData {
  const k = new MapKit();
  ground(k);
  outline(k);
  for (const r of ROCKS) rockMass(k, r);
  ledge(k);
  bridge(k);
  redHut(k);
  spawnHut(k);
  village(k);
  ruins(k);
  waterfall(k);
  base(k);
  eastSpawn(k);
  paddies(k);
  backdrop(k);
  // The banyan in the river valley under the Lookout (trunk collides), more trees and jungle in the play space.
  const [bx, bz] = pt([295, 238]);
  k.cyl(0.75, 9, 9, 'bark', bx, 4.5, bz);
  k.box(7.5, 2.4, 7.5, 'foliage', bx, 8.4, bz, { collide: false });
  k.box(5.0, 2.0, 5.0, 'foliage', bx + 0.8, 10.6, bz - 0.6, { collide: false });
  for (const [a, b, h, r] of [[215, 205, 9, 3], [365, 140, 10, 3.5], [433, 197, 9, 3], [157, 322, 8, 2.6], [70, 330, 8, 2.8], [205, 392, 9, 3]] as const) {
    const [x, z] = pt([a, b]);
    tree(k, x, z, h, r, true);
  }
  for (const [a, b, h] of [[96, 290, 8], [160, 330, 9], [292, 140, 8], [330, 120, 7], [450, 280, 8], [352, 355, 8], [260, 395, 7]] as const) {
    const [x, z] = pt([a, b]);
    palm(k, x, z, h, 0, true);
  }
  for (const [a, b, s] of [[140, 230, 1.0], [212, 225, 1.2], [262, 214, 1.0], [330, 210, 1.1], [376, 268, 1.0], [400, 300, 1.2], [182, 360, 1.1], [235, 340, 0.9], [62, 300, 1.0], [300, 150, 1.0], [420, 180, 1.2], [372, 300, 1.0]] as const) {
    const [x, z] = pt([a, b]);
    bush(k, x, z, s, jungleGroundLevel(x, z));
  }
  // Dirt paths worn into the floor.
  for (const [a, b, w, d, ry] of [[392, 274, 3.2, 16, 1.2], [300, 322, 3, 12, 0.5], [232, 304, 3, 10, -0.4], [330, 128, 3, 14, 0.3], [205, 150, 3, 10, -0.9], [80, 330, 4, 12, 0.1]] as const) k.flatDecal(w, d, 'path', px(a), 0.012, pz(b), { ry, seg: 2 });

  // ---- spawns, objectives (heights read off the finished geometry) ----
  const world = new CollisionWorld(mapSolids({ brushes: k.brushes, props: k.props } as MapData));
  const gy = (x: number, z: number, from = 9) => world.groundBelow(x, z, from, 20) ?? 0;
  const sp = (a: number, b: number, yaw: number, from = 9): SpawnPoint => {
    const x = px(a);
    const z = pz(b);
    return { x, y: gy(x, z, from), z, yaw };
  };
  const center = pt([270, 250]);
  const face = (a: number, b: number) => yawTo(px(a), pz(b), center[0], center[1]);
  const team0 = ([[52, 342], [58, 326], [66, 312], [75, 300], [72, 346], [82, 330], [90, 318], [88, 352], [62, 355], [100, 342]] as P2[]).map(([a, b]) => sp(a, b, face(a, b)));
  const team1 = ([[424, 212], [418, 232], [400, 236], [456, 225], [452, 212], [438, 200], [448, 258], [395, 243], [432, 212], [410, 198]] as P2[]).map(([a, b]) => sp(a, b, face(a, b)));
  const ffaAt: [number, number, number?][] = [
    [72, 322], [126, 300], [111, 278], [118, 336, 3], [140, 228], [212, 214], [246, 145], [300, 145], [346, 112], [395, 112],
    [430, 230], [396, 315], [335, 300], [298, 340], [205, 380], [140, 375], [219, 181, 6], [365, 235, 9], [285, 238], [372, 285],
  ];
  const ffa = ffaAt.map(([a, b, from]) => sp(a, b, face(a, b), from ?? 9));
  const P = (id: string, a: number, b: number, radius: number, team?: 0 | 1, from = 9): ObjectivePoint => {
    const x = px(a);
    const z = pz(b);
    const o: ObjectivePoint = { id, x, y: gy(x, z, from), z, radius };
    if (team !== undefined) o.team = team;
    return o;
  };
  // Domination (2010 mode map): A by the Ruins and the creek, B under the Bridge, C at the Base.
  const dom = [P('A', 124, 302, 3), P('B', 244, 218, 3, undefined, 2), P('C', 322, 150, 3)];
  // S&D (2010 mode map): A in the Village at the foot of the red hut's stairs, B by the Base compound.
  const sd = [P('A', 301, 336, 1.6, 1), P('B', 343, 140, 1.6, 1)];
  const hq = [P('hq1', 346, 114, 3.5), P('hq2', 300, 338, 3), P('hq3', 118, 300, 3), P('hq4', 246, 146, 3), P('hq5', 390, 312, 3), P('hq6', 205, 142, 3), P('hq7', 268, 222, 3.5), P('hq8', 236, 352, 3, undefined, 2)];
  const attackers = team0;
  const defenders = ([[426, 220], [420, 238], [404, 240], [455, 232], [446, 200], [450, 262], [398, 228], [414, 200]] as P2[]).map(([a, b]) => sp(a, b, face(a, b)));
  const H = BRIDGE.house;
  const hf = new Frame(new MapKit(), px(H.o[0]), pz(H.o[1]), H.th);
  const houseIn = hf.p(3.5, L.bridge, 2.0);
  const dm = pt([(BRIDGE.deck[0]![0] + BRIDGE.deck[1]![0]) / 2, (BRIDGE.deck[0]![1] + BRIDGE.deck[1]![1]) / 2]);
  const rf = new Frame(new MapKit(), px(RED_HUT.o[0]), pz(RED_HUT.o[1]), RED_HUT.th);
  const redIn = rf.p(2.0, L.redHut, 3.5);
  const v = (a: number, b: number, from = 9): Vec3 => ({ x: px(a), y: gy(px(a), pz(b), from), z: pz(b) });

  return {
    id: 'jungle',
    name: 'Jungle',
    bounds: JUNGLE_BOUNDS,
    materials: MATERIALS,
    brushes: k.brushes,
    decals: k.decals,
    props: k.props,
    lights: k.lights,
    spawns: { teams: [team0, team1], ffa },
    objectives: { dom, sd, hq },
    modeSpawns: { sd: { attackers, defenders } },
    times: [
      { id: 'day', name: 'Humid Day', clock: '13:20', sky: 'jg_skyHumid', unlit: [1, 0.98, 0.92], skyRot: 0.6, sunDir: unitVec(0.35, 0.86, 0.25), sun: [1.12, 1.04, 0.86], amb: [0.5, 0.54, 0.46], fog: [0.73, 0.76, 0.68], fogNear: 26, fogFar: 165, lights: { lamp: 0.25, mist: 0.2 }, glow: 0 },
      { id: 'morning', name: 'Misty Morning', clock: '06:35', sky: 'jg_skyMist', unlit: [0.96, 0.98, 1], skyRot: 2.2, sunDir: unitVec(0.82, 0.32, -0.3), sun: [0.95, 0.86, 0.7], amb: [0.46, 0.5, 0.5], fog: [0.7, 0.74, 0.73], fogNear: 6, fogFar: 82, lights: { lamp: 0.85, mist: 0.6 }, glow: 0.6 },
    ],
    defaultTime: 'day',
    hotspots: [
      v(124, 302),
      v(244, 218, 2),
      v(322, 150),
      houseIn,
      { x: dm[0], y: L.bridge, z: dm[1] },
      redIn,
      v(365, 228, 9),
      v(352, 118),
      v(300, 338),
      v(236, 352, 2),
      v(118, 336, 3),
      v(430, 250),
      v(175, 260),
      v(330, 268),
      v(392, 312),
      v(205, 142),
    ],
  };
}
