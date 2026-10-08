/**
 * Afghan (inspired by MW2's "Afghan", mp_afghan, 2009): a desert canyon around a crashed C-130,
 * about 134 x 139 m of play space, laid out from the MW2 minimap and the MWIII (2023) remaster's
 * official tac maps (see docs/maps/afghan-reference.md for the sources, scale and callouts).
 *
 * The plane lies in the low basin in the middle in three pieces: the tail section (fin standing,
 * west), the middle section with its wing running south up onto the ledge above the Cave mouth,
 * and the cockpit section (nose east, looking at the Canyon and the east Bunker). Rock masses ring
 * the basin: the big central rock to the north, the Rocks (north-west, OpFor spawn) with the rock
 * pair R1/R2, the high west plateau (the Batteries: anti-aircraft guns and crumbled mud-brick walls)
 * whose cliff edge is the overlook above the tail, the big south-west rock, and the cave mountain to
 * the south with the Cave running through it (north, west and south mouths). North-east: the Poppy
 * Fields with the farm buildings, the open shack, and the two Bunkers that face the plane (the
 * centre Bunker on its mound, the long east Bunker over the Canyon). South-east: the Canyon (TF141
 * spawn, Humvees, the sealed cave door, the Stryker blocking the road). South-west: the Cliffs below
 * the plateau, the concrete Walkway along the cliff face, and the south pocket with a third AA gun.
 *
 * Terrain: walkable ground is a height function (flats, gradients and bumps per area) rasterised
 * into stepped 1 m brushes (0.25 m steps, always walkable), with real ramps for the long slopes
 * (the Rocks valley, the north path, the bunker mound, the cave approach, the Walkway). Rock masses
 * and the canyon walls are polygons rasterised into 1.5 m blocks whose tops step in 1.8 m strata,
 * which nobody can jump up, so they need no clips.
 *
 * Coordinates: x east, z south, y up; yaw 0 looks north (-z). Team 0 = OpFor (the Rocks, north-west),
 * team 1 = Task Force 141 (the Canyon, south-east). Search and Destroy: team 1's side defends
 * (`objectives.sd[].team = 1`), attackers start at the Rocks like MWIII (`modeSpawns.sd`).
 */
import { CollisionWorld, type RampDir } from '../collision';
import { MapKit, spawnAt, yawTowards, type Hole } from './mw2kit';
import { mapSolids, unitVec, type MapData, type MaterialDef, type SpawnPoint } from './types';

const PI = Math.PI;
type P2 = [number, number];

const MATERIALS: Record<string, MaterialDef> = {
  ground: { texture: 'afg_ground', uvMul: [1 / 6, 1 / 6] },
  earth: { texture: 'afg_earth', uvMul: [1 / 4, 1 / 4] },
  rock: { texture: 'afg_rock', uvMul: [1 / 7, 1 / 5.4] },
  rockTop: { texture: 'afg_rockTop', uvMul: [1 / 6, 1 / 6] },
  rockDark: { texture: 'afg_rock', uvMul: [1 / 5, 1 / 5], tint: 0x6a5e54 },
  caveRock: { texture: 'afg_rock', uvMul: [1 / 4, 1 / 4], tint: 0x5a5048 },
  duneFar: { texture: 'afg_ground', uvMul: [1 / 12, 1 / 12], tint: 0xe6dccb },
  mountains: { texture: 'nt_mountains', side: 'double', fog: false, tint: 0xd8c8b4 },
  mud: { texture: 'afg_mud', uvMul: [1 / 3, 1 / 3] },
  mudDark: { texture: 'afg_mud', uvMul: [1 / 3, 1 / 3], tint: 0xa89880 },
  mudRoof: { texture: 'afg_earth', uvMul: [1 / 3, 1 / 3], tint: 0xc0a888 },
  plank: { texture: 'afg_plank', uvMul: [1 / 2.4, 1 / 2.4] },
  corr: { texture: 'rust_corr', uvMul: [1 / 2.4, 1 / 2.4], tint: 0xb8a898 },
  bunker: { texture: 'afg_bunker', uvMul: [1 / 3, 1 / 3] },
  bunkerIn: { texture: 'afg_bunker', uvMul: [1 / 3, 1 / 3], tint: 0x9a9088 },
  concrete: { texture: 'rust_concrete', uvMul: [1 / 3, 1 / 3], tint: 0xd8ccb8 },
  door: { texture: 'afg_door' },
  hull: { texture: 'afg_hull', uvMul: [1 / 3, 1 / 3] },
  hullDark: { texture: 'afg_hull', uvMul: [1 / 3, 1 / 3], tint: 0x8a8a84 },
  cargo: { texture: 'afg_cargo', uvMul: [1 / 2, 1 / 2.4] },
  cargoFloor: { texture: 'rust_deck', uvMul: [1 / 2, 1 / 2], tint: 0x9a9a92 },
  cockpit: { texture: 'scrap_cockpit' },
  glassFrame: { texture: 'steel', tint: 0x4a4a48 },
  prop: { texture: 'steel', tint: 0x3a3a38 },
  sandbag: { texture: 'rust_sandbag', uvMul: [1 / 1.2, 1 / 0.6] },
  tarp: { texture: 'afg_tarp', side: 'double' },
  mattress: { texture: 'afg_mattress', uvMul: [1 / 2, 1 / 2] },
  poppy: { texture: 'afg_poppy', uvMul: [1 / 3, 1 / 3] },
  grass: { texture: 'afg_grass', side: 'double' },
  bush: { texture: 'fr_bush', side: 'double', tint: 0xb8b078 },
  bark: { texture: 'fr_bark', uvMul: [1 / 1.5, 1 / 1.5], tint: 0x9a8a78 },
  leaves: { texture: 'fr_bush', side: 'double', tint: 0x9aa070 },
  pipe: { texture: 'rust_pipe', uvMul: [1, 2], tint: 0x9a7a60 },
  humvee: { texture: 'yellow', tint: 0xc4ae7c, uvMul: [1 / 0.8, 1 / 0.8] },
  stryker: { texture: 'afg_hull', uvMul: [1 / 3, 1 / 3], tint: 0xa8a070 },
  gun: { texture: 'steel', tint: 0x5a6048 },
  crate: { texture: 'crate', uvMul: [1 / 1.2, 1 / 1.2] },
  ammo: { texture: 'crate', uvMul: [1 / 1.2, 1 / 1.2], tint: 0x8a9468 },
  barrel: { texture: 'barrel', tint: 0x7a6a4a, uvMul: [2, 1] },
  barrelBlue: { texture: 'barrel', tint: 0x3a5a7a, uvMul: [2, 1] },
  rubber: { texture: 'rubber', uvMul: [1 / 0.4, 1 / 0.4] },
  rail: { texture: 'rust_rail', uvMul: [1 / 1.2, 1], side: 'double', tint: 0x9a9890 },
  steel: { texture: 'steel' },
  hazard: { texture: 'hazard', uvMul: [1 / 0.6, 1 / 0.6] },
  lamp: { texture: 'lamp', emissive: 1 },
  fire: { texture: 'lamp', emissive: 1, tint: 0xff9040 },
  clip: { texture: 'none' },
};

/** Walkable heights (feet), exported for features and tests. */
export const AFGHAN_LEVELS = {
  /** The basin around the plane, the Canyon and the south pocket. */
  basin: 0,
  /** The west plateau (the Batteries) and the overlook at its cliff edge. */
  plateau: 6,
  /** The Rocks (OpFor spawn) and the north path round the north-west rock. */
  rocks: 5,
  /** The Poppy Fields. */
  poppy: 2.5,
  /** Floor of the centre Bunker on its mound. */
  bunker: 4,
  /** Floor of the long east Bunker over the Canyon. */
  eastBunker: 2,
  /** The Cave floor. */
  cave: 2,
  /** The Cliffs below the plateau. */
  cliffs: 2.5,
  /** The concrete Walkway along the cliff face (south leg). */
  walkway: 4,
  /** The rock ledge above the Cave mouth, reached up the plane's wing. */
  ledge: 5.8,
  /** Cargo floor of the three plane sections. */
  plane: 0.35,
  /** Roof of the middle section. */
  planeRoof: 4.3,
} as const;

/** The play-space outline (minimap trace, metres; 1 m = 3.15 px on the 512 px MW2 minimap). */
export const AFGHAN_PLAY: P2[] = [
  [-73.5, -15.5], [-69, -18.5], [-56, -18.5], [-54, -25.5], [-56.5, -32.5], [-55.5, -36], [-51.5, -43], [-51.5, -45.5], [-54, -51.2],
  [-41, -52], [-36, -55.6], [-35.5, -65], [-30.7, -68.5], [-20.4, -69], [-18, -62.7], [-18.8, -53.4], [-18, -51.2], [-8.5, -51.2],
  [-7.7, -55], [-5.3, -59], [-1, -56.5], [0.4, -62.5], [2, -66], [7, -66.4], [7, -71.8], [12.5, -73.5], [18.4, -74.6], [26.3, -72.2],
  [32.7, -68.3], [34.2, -66.6], [38.7, -65], [40.6, -56], [39.8, -46.8], [37.9, -46], [37.9, -36.5], [35.9, -32.5], [38.3, -29.4],
  [38.3, -22.4], [42.2, -22.4], [42.2, -3.6], [40.6, -2.8], [44.6, 4.4], [49.4, 10.7], [51.7, 21.8], [54.9, 33.7], [60.1, 42.5],
  [55, 50.6], [47, 52], [42.2, 42.1], [40.2, 41.7], [31.9, 44], [24.8, 47.6], [17.6, 49.2], [16.4, 50.4], [18, 56], [17.6, 64.7],
  [-0.6, 64.7], [-6.9, 61.5], [-3.7, 56], [-5.3, 53.6], [-6.4, 45.4], [-25.2, 45.4], [-35.1, 45.2], [-43.4, 45.2], [-43.4, 17.9],
  [-45, 14.7], [-50.6, 13.9], [-55.3, 13.1], [-60.1, 5.2], [-62.1, 0.4], [-64.8, -8.7], [-72, -11.1],
];

/** Map bounds (play outline + 2 m). */
export const AFGHAN_BOUNDS = { minX: -75.5, maxX: 62.1, minZ: -76.6, maxZ: 66.7 } as const;

// ---------------------------------------------------------------------------------------------
// Rock masses inside the play space (impassable).
// ---------------------------------------------------------------------------------------------
/** North-west rock (the Rocks): the path rings it. */
const R1: P2[] = [[-49, -45.2], [-45, -47.2], [-40.2, -46.4], [-34.7, -46.8], [-33.1, -44.4], [-33.9, -38.1], [-35.5, -36.1], [-41.8, -35.7], [-43.4, -37.3], [-48.2, -37.7], [-49, -41.3]];
/** West rock between the Rocks valley and the plateau. */
const R2: P2[] = [[-47, -30.2], [-45, -31.3], [-42.6, -31], [-38.7, -33.7], [-35.5, -31], [-34.7, -29.4], [-30.7, -25.4], [-28.3, -19.8], [-26.7, -15.1], [-30.7, -15.5], [-37, -18.3], [-40.2, -17.9], [-47.4, -19.8], [-47.8, -23], [-45.8, -26.2], [-47.4, -28.6]];
/** The big central rock north of the plane. */
const R3: P2[] = [[-21.2, -40.5], [-20.4, -43.5], [-14.8, -47.2], [-10, -47.6], [-6.1, -46], [-2, -41.5], [1.5, -36.5], [2.8, -34], [2.2, -30.5], [-0.6, -27.6], [-6.1, -29], [-11.7, -30.2], [-16.4, -31], [-20.4, -35.7]];
/** North-east rock behind the centre Bunker. */
const R7: P2[] = [[17, -34], [17.2, -37.3], [18.4, -37.7], [27.9, -38.1], [29.5, -36.5], [29.9, -29.4], [30.5, -24.5], [28.5, -23.2], [25.6, -26.2], [20.8, -27.8], [17, -29.2]];
/** The big south-west rock (the plateau's cliff runs along its west side). */
const R4: P2[] = [[-27.5, -10.5], [-20.4, -5.2], [-14.8, -2.4], [-11.7, 2], [-10, 6.7], [-6.1, 10.3], [-4.5, 10.9], [-6.5, 13.6], [-10.5, 17.5], [-13.3, 16.3], [-20.4, 18.3], [-30.7, 15.5], [-39, 12.3], [-39.4, 10.3], [-35.5, 5.2], [-31.9, 0.4], [-30.7, -5.2]];
/** The cave mountain (the Cave runs through it, see CAVE). */
const MTN: P2[] = [
  [-10.5, 17.5], [-6.5, 13.6], [4.1, 11.8], [14.8, 10.5], [16, 7.1], [16.4, 3.2], [20.8, 3.2], [26.3, 6], [29.5, 9.9], [30.3, 13.9], [31.1, 29.8],
  [30.6, 37.7], [24.8, 42.5], [19.2, 43.3], [15.2, 41.7], [12.9, 39.3], [5, 39.3], [2.5, 37.4], [-5.5, 37.4], [-10.5, 36],
];
/** The Cave: floor and roof footprint; it pokes out of MTN at the north, west and south mouths. */
const CAVE: P2[] = [[-11.6, 19.5], [-7.2, 12.4], [4.6, 10.6], [8.8, 19.5], [9.2, 26], [8, 30.5], [5, 35], [2.8, 38.2], [-5.8, 38.2], [-11.6, 34.5]];
const ROCKS = [R1, R2, R3, R7, R4, MTN];

// ---------------------------------------------------------------------------------------------
// Terrain areas (walkable ground heights).
// ---------------------------------------------------------------------------------------------
const PLAT: P2[] = [[-82, -18.6], [-26, -18.6], [-26, -9.6], [-29.4, -5], [-31, 0.5], [-34.6, 5], [-38.2, 10.4], [-37.6, 13.6], [-39, 16.4], [-82, 16.4]];
const WEST: P2[] = [[-62, -58], [-33, -58], [-33, -18.6], [-62, -18.6]];
const LOBE: P2[] = [[-38, -74], [-16, -74], [-16, -44], [-38, -44]];
const GAP: P2[] = [[-46.5, -38.5], [-34.6, -38.5], [-34.6, -29.5], [-46.5, -29.5]];
const VFADE: P2[] = [[-19.6, -36], [-6.6, -36], [-6.6, -18.6], [-19.6, -18.6]];
const LANDING: P2[] = [[-35, -38], [-19.6, -38], [-19.6, -30], [-35, -30]];
const POP: P2[] = [[-9.5, -82], [48, -82], [48, -34.2], [30.6, -34.2], [29.6, -37.2], [18.4, -38.6], [17.4, -35.2], [6.2, -35.2], [3.2, -35.6], [1.8, -36.2], [-2, -41.5], [-6, -46.6], [-9.5, -46.6]];
const MOUND: P2[] = [[6.2, -35.2], [17.4, -35.2], [17.4, -29], [6.2, -29]];
const NELANE: P2[] = [[28.6, -48], [40, -48], [40, -22.2], [28.6, -22.2]];
const PLINTH: P2[] = [[30, -22.2], [44, -22.2], [44, -3], [30, -3]];
const CLIFFS: P2[] = [[-40.2, 16], [-38.4, 13.6], [-31, 15.2], [-20.5, 17.8], [-13, 16], [-10, 17.2], [-10, 36.2], [-7.4, 41.6], [-40.2, 41.6]];

/** Long slopes built as real ramps (excluded from the stepped raster). */
interface RampZone { x0: number; z0: number; x1: number; z1: number; dir: RampDir; lo: number; hi: number }
const RAMPS: RampZone[] = [
  // The Rocks valley: down from the OpFor lobe (5) to a landing (3.25) where the path from the
  // north-west rock pair joins, then down to the basin behind the tail (0).
  { x0: -35, z0: -45, x1: -19.6, z1: -38, dir: '-z', lo: 3.25, hi: 5 },
  { x0: -35, z0: -30, x1: -19.6, z1: -19, dir: '-z', lo: 0, hi: 3.25 },
  // North path above the central rock: the Rocks (5) down to the Poppy Fields (2.5).
  { x0: -19, z0: -52.6, x1: -3, z1: -46.4, dir: '-x', lo: 2.5, hi: 5 },
  // The passage between the central rock and the centre Bunker's mound.
  { x0: 2.8, z0: -35.2, x1: 6.2, z1: -26.8, dir: '-z', lo: 0.3, hi: 2.5 },
  // The sand mound in front of the centre Bunker.
  { x0: 6.2, z0: -29, x1: 17.4, z1: -21.4, dir: '-z', lo: 0, hi: 4 },
  // East Bunker plinth: down west to the basin and south into the Canyon.
  { x0: 21.6, z0: -22.2, x1: 30, z1: -3, dir: '+x', lo: 0, hi: 2 },
  { x0: 24, z0: -3, x1: 56, z1: 12, dir: '-z', lo: 0, hi: 2 },
  // The Cave: up from the basin into the north mouth, down from the south mouth to the pocket.
  { x0: -7.2, z0: 4, x1: 4.6, z1: 12.6, dir: '+z', lo: 0, hi: 2 },
  { x0: -5.8, z0: 38.2, x1: 2.8, z1: 43, dir: '-z', lo: 0, hi: 2 },
];

/** Footprints the stepped terrain raster leaves alone (walkway decks, bunker floors). */
const EXCLUDE: [number, number, number, number][] = [
  [-43.4, 16, -40, 45.2], // walkway west leg
  [-43.4, 32, -35, 45.2], // walkway corner
  [-35, 41.6, -2, 45.2], // walkway south leg and its stairs
];

/** Gentle sand bumps in the basin, the Canyon and the pocket: [x, z, radius, height]. */
const BUMPS: [number, number, number, number][] = [
  [-6, -23.5, 4, 0.9], [14.5, 0.5, 5, 1.2], [23.5, -13, 4, 0.8], [26.5, -7.2, 3.2, 1.0], [43, 19.5, 6, 1.6], [-20, -14, 3.6, 0.8],
  [12, 58, 4, 1.0], [34, 32, 4, 0.9], [8, -24.5, 3, 0.6], [-16, 2.5, 3, 0.6],
];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Height of the Rocks valley at z (two ramps and the landing between them). */
const valleyH = (z: number) => (z < -38 ? 3.25 + 1.75 * clamp01((-38 - z) / 7) : z < -30 ? 3.25 : 3.25 * clamp01((-19 - z) / 11));
const westH = (z: number) => 5 + clamp01((z + 44) / 25);

/** Raw walkable ground height of the terrain areas (before quantising). */
export function afghanGround(x: number, z: number): number {
  let h = 0;
  for (const [bx, bz, r, bh] of BUMPS) h += bh * Math.exp(-((x - bx) ** 2 + (z - bz) ** 2) / (r * r));
  if (inside(PLAT, x, z)) h = 6;
  if (inside(WEST, x, z)) h = westH(z);
  if (inside(LOBE, x, z)) h = 5;
  if (inside(LANDING, x, z)) h = 3.25;
  if (inside(GAP, x, z)) h = lerp(westH(z), 3.25, clamp01((x + 46.5) / 11.9));
  if (inside(VFADE, x, z)) h = valleyH(z) * clamp01(1 - (x + 19.6) / 13);
  if (inside(POP, x, z)) h = 2.5;
  if (inside(MOUND, x, z)) h = 4;
  if (inside(NELANE, x, z)) h = 2.5 - 0.5 * clamp01((z + 30) / 7.8);
  if (inside(PLINTH, x, z)) h = 2;
  if (inside(CAVE, x, z)) h = 2 + 0.5 * clamp01((-x - 2) / 8);
  if (inside(CLIFFS, x, z)) h = 2.5;
  return h;
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------
function inside(poly: P2[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function edgeDist(poly: P2[], x: number, z: number): number {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j]!;
    const [bx, bz] = poly[i]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    d = Math.min(d, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return d;
}

interface Run { x0: number; z0: number; x1: number; z1: number; level: number }

/** Grid cells (centre test) merged into boxes of equal level: runs along x, then identical runs down z. */
function raster(x0: number, z0: number, x1: number, z1: number, cell: number, level: (x: number, z: number) => number | null): Run[] {
  const nx = Math.round((x1 - x0) / cell);
  const nz = Math.round((z1 - z0) / cell);
  const rows: { a: number; b: number; level: number }[][] = [];
  for (let j = 0; j < nz; j++) {
    const z = z0 + (j + 0.5) * cell;
    const runs: { a: number; b: number; level: number }[] = [];
    let cur: { a: number; b: number; level: number } | null = null;
    for (let i = 0; i < nx; i++) {
      const lv = level(x0 + (i + 0.5) * cell, z);
      if (lv === null) {
        cur = null;
        continue;
      }
      if (cur && cur.level === lv) cur.b = i + 1;
      else runs.push((cur = { a: i, b: i + 1, level: lv }));
    }
    rows.push(runs);
  }
  const out: Run[] = [];
  let open = new Map<string, { a: number; b: number; level: number; j0: number }>();
  for (let j = 0; j <= nz; j++) {
    const next = new Map<string, { a: number; b: number; level: number; j0: number }>();
    for (const r of rows[j] ?? []) {
      const key = `${r.a},${r.b},${r.level}`;
      const o = open.get(key);
      next.set(key, o ?? { ...r, j0: j });
      if (o) open.delete(key);
    }
    for (const o of open.values()) out.push({ x0: x0 + o.a * cell, z0: z0 + o.j0 * cell, x1: x0 + o.b * cell, z1: z0 + j * cell, level: o.level });
    open = next;
  }
  return out;
}

const hash = (x: number, z: number) => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const inRect = (r: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;

// ---------------------------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------------------------
export function buildAfghan(): MapData {
  const k = new MapKit();
  const L = AFGHAN_LEVELS;
  const B = AFGHAN_BOUNDS;
  const Q = 0.25; // terrain step
  const STRATUM = 1.8; // rock step (more than a jump can climb)

  /** Box rotated about y (render only) plus `n` axis-aligned collision boxes along its long axis (dx, dz). */
  const rotBox = (cx: number, cz: number, len: number, wid: number, y0: number, y1: number, dx: number, dz: number, mat: string, n = 0, colTop = y1) => {
    const ry = Math.atan2(dx, dz);
    const swap = Math.abs(Math.sin(ry)) > 0.5;
    const hx = (swap ? len : wid) / 2;
    const hz = (swap ? wid : len) / 2;
    k.trim(cx - hx, y0, cz - hz, cx + hx, y1, cz + hz, mat, { ry });
    const l = Math.hypot(dx, dz);
    const ux = dx / l;
    const uz = dz / l;
    for (let i = 0; i < n; i++) {
      const s = -len / 2 + (len * (i + 0.5)) / n;
      const seg = len / n / 2;
      const ex = Math.abs(ux) * seg + Math.abs(uz) * (wid / 2) * 0.85;
      const ez = Math.abs(uz) * seg + Math.abs(ux) * (wid / 2) * 0.85;
      k.slab(cx + ux * s - ex, y0, cz + uz * s - ez, cx + ux * s + ex, colTop, cz + uz * s + ez, 'clip', { noRender: true });
    }
  };
  /** A rotated wall from (ax, az) to (bx, bz), `n` collision boxes (shoot-through when `thin`). */
  const lineWall = (ax: number, az: number, bx: number, bz: number, y0: number, h: number, t: number, mat: string, crumble = false) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 0.9));
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    for (let i = 0; i < n; i++) {
      const s0 = (len * i) / n;
      const s1 = (len * (i + 1)) / n;
      const hh = crumble ? h * (0.55 + 0.45 * hash(ax + i, az - i)) : h;
      const cx = ax + dx * (s0 + s1) / 2;
      const cz = az + dz * (s0 + s1) / 2;
      rotBox(cx, cz, s1 - s0 + 0.02, t, y0, y0 + hh, dx, dz, mat, 1);
    }
  };
  const crate = (x: number, z: number, y: number, s = 1.2, mat = 'crate') => k.slab(x - s / 2, y, z - s / 2, x + s / 2, y + s, z + s / 2, mat, { uv: 'raw' });
  const barrel = (x: number, z: number, y: number, m = 'barrel') => k.cyl(0.32, 0.9, 8, m, x, y + 0.45, z);
  /** Tuft of dry grass (two crossed cards, render only). */
  const tuft = (x: number, z: number, y: number, s = 1) => {
    const a = hash(x, z) * PI;
    k.decals.push({ kind: 'wall', w: 1.3 * s, h: 0.8 * s, x, y, z, ry: a, mat: 'grass', uv: 'raw', seg: 1 });
    k.decals.push({ kind: 'wall', w: 1.3 * s, h: 0.8 * s, x, y, z, ry: a + PI / 2, mat: 'grass', uv: 'raw', seg: 1 });
  };
  /** A sparse desert tree (render only, trunk collides). */
  const tree = (x: number, z: number, y: number, h: number) => {
    k.cyl(0.16, h, 6, 'bark', x, y + h / 2, z, 'y', true);
    for (const [dy, w] of [[h - 1.4, 3.6], [h - 0.4, 2.6]] as const) {
      const a = hash(x + dy, z) * PI;
      k.decals.push({ kind: 'wall', w, h: 1.8, x, y: y + dy, z, ry: a, mat: 'leaves', uv: 'raw', seg: 1 });
      k.decals.push({ kind: 'wall', w, h: 1.8, x, y: y + dy, z, ry: a + PI / 2, mat: 'leaves', uv: 'raw', seg: 1 });
    }
  };
  /** Ring of sandbags (r = outer radius) with a gap facing `gapYaw` (yaw convention, 0 = north). */
  const sandbagRing = (cx: number, cz: number, y: number, r: number, h: number, gapYaw: number | null, from = 0, to = 2 * PI) => {
    const n = Math.max(6, Math.round(((to - from) * r) / 0.9));
    for (let i = 0; i < n; i++) {
      const a = from + ((to - from) * (i + 0.5)) / n;
      const px = cx + Math.cos(a) * (r - 0.3);
      const pz = cz + Math.sin(a) * (r - 0.3);
      if (gapYaw !== null) {
        const gx = -Math.sin(gapYaw);
        const gz = -Math.cos(gapYaw);
        if (Math.cos(a) * gx + Math.sin(a) * gz > 0.88) continue;
      }
      const seg = ((to - from) * r) / n + 0.08;
      k.trim(px - seg / 2, y, pz - 0.3, px + seg / 2, y + h, pz + 0.3, 'sandbag', { ry: -a + PI / 2 });
      k.slab(px - 0.36, y, pz - 0.36, px + 0.36, y + h, pz + 0.36, 'clip', { noRender: true });
    }
  };
  /** ZU-23 style twin AA gun in a sandbag ring. `yaw` = where the barrels point. */
  const aaGun = (cx: number, cz: number, y: number, yaw: number) => {
    sandbagRing(cx, cz, y, 2.3, 0.9, yaw + PI);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    k.slab(cx - 0.7, y, cz - 0.7, cx + 0.7, y + 0.55, cz + 0.7, 'gun');
    k.slab(cx - 0.35, y + 0.55, cz - 0.35, cx + 0.35, y + 1.25, cz + 0.35, 'gun');
    for (const side of [-0.18, 0.18]) {
      const ox = -fz * side;
      const oz = fx * side;
      for (let i = 0; i < 5; i++) {
        const s = 0.3 + i * 0.42;
        const yy = y + 1.15 + i * 0.3;
        k.trim(cx + ox + fx * s - 0.07, yy, cz + oz + fz * s - 0.07, cx + ox + fx * s + 0.07, yy + 0.34, cz + oz + fz * s + 0.07, 'gun');
      }
    }
    k.trim(cx - 0.45 - fz * 0.5, y + 0.6, cz - 0.45 + fx * 0.5, cx + 0.45 - fz * 0.5, y + 1.0, cz + 0.45 + fx * 0.5, 'gun');
    k.cyl(0.32, 0.18, 8, 'rubber', cx - fz * 0.8, y + 0.32, cz + fx * 0.8, Math.abs(fx) > Math.abs(fz) ? 'z' : 'x', false);
    k.cyl(0.32, 0.18, 8, 'rubber', cx + fz * 0.8, y + 0.32, cz - fx * 0.8, Math.abs(fx) > Math.abs(fz) ? 'z' : 'x', false);
  };

  // =============================================================================================
  // Ground: base slab, stepped terrain, slope ramps
  // =============================================================================================
  k.slab(-140, -1, -140, 140, 0, 140, 'ground', { hide: ['nx', 'px', 'ny', 'nz', 'pz'] });
  const inRamp = (x: number, z: number) => RAMPS.some((r) => inRect(r, x, z)) || EXCLUDE.some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
  const rockCore = (x: number, z: number) => ROCKS.some((p) => inside(p, x, z) && edgeDist(p, x, z) > 1.6) && !inside(CAVE, x, z);
  const nearPlay = (x: number, z: number) => inside(AFGHAN_PLAY, x, z) || edgeDist(AFGHAN_PLAY, x, z) < 2.2;
  const qLevel = (x: number, z: number) => Math.round(afghanGround(x, z) / Q) * Q;
  for (const r of raster(-76, -77, 63, 67, 1, (x, z) => {
    if (!nearPlay(x, z) || inRamp(x, z) || rockCore(x, z)) return null;
    const lv = qLevel(x, z);
    return lv > 0.05 ? Math.round(lv * 100) / 100 : null;
  }))
    k.slab(r.x0, 0, r.z0, r.x1, r.level, r.z1, 'ground', { hide: ['ny'], faceMats: { nx: 'earth', px: 'earth', nz: 'earth', pz: 'earth' } });
  for (const r of RAMPS) {
    if (r.lo > 0) k.slab(r.x0, 0, r.z0, r.x1, r.lo, r.z1, 'earth', { hide: ['ny', 'py'] });
    k.ramp(r.x0, r.lo, r.z0, r.x1, r.hi, r.z1, r.dir, 'ground', { tag: 'terrain' });
  }

  // =============================================================================================
  // Rock: the masses inside the play space, the canyon walls round it, the Cave roof
  // =============================================================================================
  const LEDGE = { x0: -4.2, z0: 7, x1: 7.2, z1: 12.4 };
  const DOOR_RECESS = { x0: 27.2, z0: 22, x1: 32, z1: 25.4 };
  const baseAt = (x: number, z: number) => Math.max(afghanGround(x, z), afghanGround(x + 1.6, z), afghanGround(x - 1.6, z), afghanGround(x, z + 1.6), afghanGround(x, z - 1.6));
  /** Walkway outer side: the canyon wall drops away below the deck there. */
  const lowWall = (x: number, z: number) => (x < -43.4 && z > 18 && z < 46) || (z > 45.2 && x > -44 && x < -7);
  for (const r of raster(-90, -92, 78, 82, 1.5, (x, z) => {
    if (inRect(LEDGE, x, z) || inRect(DOOR_RECESS, x, z) || inside(CAVE, x, z)) return null;
    const inner = ROCKS.find((p) => inside(p, x, z));
    let d: number;
    let peak: number;
    if (inner) {
      d = edgeDist(inner, x, z);
      peak = inner === MTN ? 18 : inner === R3 ? 16.2 : inner === R4 ? 14.4 : 12.6;
    } else if (!inside(AFGHAN_PLAY, x, z)) {
      d = edgeDist(AFGHAN_PLAY, x, z);
      if (d > 16) return null;
      if (lowWall(x, z)) return d < 4 ? 1.8 : null;
      peak = 23.4;
    } else return null;
    const rise = 3.6 + Math.min(d, 9) * 0.9 + (hash(Math.round(x / 3), Math.round(z / 3)) - 0.5) * 2.4;
    const base = baseAt(x, z);
    const lv = Math.ceil((base + rise) / STRATUM) * STRATUM;
    return Math.max(Math.min(peak, lv), Math.ceil((base + 3.6) / STRATUM) * STRATUM);
  }))
    k.slab(r.x0, 0, r.z0, r.x1, r.level, r.z1, 'rock', { hide: ['ny'], faceMats: { py: 'rockTop' } });
  // The Cave roof (its underside is the cave ceiling; it overhangs the three mouths).
  for (const r of raster(-12, 10, 10, 39, 1.5, (x, z) => (inside(CAVE, x, z) && !inRect(LEDGE, x, z) ? Math.ceil((6.6 + 2.2 + hash(x, z) * 1.6) / STRATUM) * STRATUM : null)))
    k.slab(r.x0, 6.6, r.z0, r.x1, r.level, r.z1, 'rock', { faceMats: { ny: 'caveRock', py: 'rockTop' } });
  // The ledge above the north mouth (walkable, reached up the wing).
  k.slab(LEDGE.x0, L.ledge - 0.9, LEDGE.z0, LEDGE.x1, L.ledge, LEDGE.z1, 'rock', { faceMats: { py: 'rockTop', ny: 'caveRock' } });
  k.slab(LEDGE.x0 - 0.1, L.ledge, LEDGE.z0 - 0.1, LEDGE.x0 + 1.2, L.ledge + 0.5, LEDGE.z0 + 1.6, 'rock', { faceMats: { py: 'rockTop' } });
  k.slab(LEDGE.x1 - 1.5, L.ledge, LEDGE.z0 - 0.1, LEDGE.x1 + 0.1, L.ledge + 0.6, LEDGE.z0 + 1.2, 'rock', { faceMats: { py: 'rockTop' } });
  // Rock pillars and crates inside the Cave, timber props.
  k.slab(-5.2, L.cave, 19.6, -3.0, 6.6, 21.6, 'rockDark');
  k.slab(-4.0, L.cave, 24.0, -2.0, 6.6, 25.8, 'rockDark');
  for (const [x, z] of [[-6.4, 15.2], [2.6, 15.0], [-8.6, 22.0], [6.4, 23.0], [-8.4, 31.0], [3.8, 32.4]] as const) {
    k.slab(x - 0.14, L.cave, z - 0.14, x + 0.14, 6.6, z + 0.14, 'plank');
    k.trim(x - 1.2, 6.3, z - 0.14, x + 1.2, 6.6, z + 0.14, 'plank');
  }
  for (const [x, z, y] of [[5.6, 17.2, 0], [6.8, 17.2, 0], [6.2, 17.2, 1.2], [-8.0, 27.4, 0], [1.8, 30.6, 0], [3.0, 30.6, 0]] as const) crate(x, z, L.cave + y, 1.2, 'ammo');
  barrel(-6.8, 33.6, L.cave + 0.25);
  barrel(-6.0, 34.2, L.cave + 0.25, 'barrelBlue');
  for (const [x, z] of [[-2, 16.5], [4, 27.5], [-6.5, 29.5]] as const) {
    k.trim(x - 0.2, 6.25, z - 0.2, x + 0.2, 6.6, z + 0.2, 'lamp');
    k.light(x, 5.6, z, [1.3, 1.0, 0.7], 9, 'cave');
    k.glow(x, 6.1, z, [0.5, 0.4, 0.25], 1.6, 'cave');
  }
  // The sealed cave door in the Canyon (east face of the mountain).
  k.slab(DOOR_RECESS.x0, 0, DOOR_RECESS.z0, DOOR_RECESS.x0 + 0.4, 6, DOOR_RECESS.z1, 'concrete');
  k.decals.push({ kind: 'wall', w: 2.8, h: 3.0, x: DOOR_RECESS.x0 + 0.42, y: 0, z: (DOOR_RECESS.z0 + DOOR_RECESS.z1) / 2, ry: PI / 2, mat: 'door', uv: 'raw' });
  k.slab(DOOR_RECESS.x0 + 0.4, 3.4, DOOR_RECESS.z0, DOOR_RECESS.x1, 4.2, DOOR_RECESS.z1, 'concrete');
  for (const [x, z] of [[30.2, 21.4], [30.6, 26.2]] as const) k.slab(x - 0.7, 0, z - 0.5, x + 0.7, 0.9, z + 0.5, 'sandbag');

  // =============================================================================================
  // Perimeter, the Walkway's outer edge, scenery beyond
  // =============================================================================================
  k.perimeter(B.minX, B.maxX, B.minZ, B.maxZ, -1, 40);
  // Distant dunes and mountains.
  k.ramp(-140, 0, -140, 140, 18, -95, '-z', 'duneFar', { collide: false });
  k.ramp(-140, 0, 85, 140, 16, 140, '+z', 'duneFar', { collide: false });
  k.ramp(-140, 0, -95, -92, 14, 85, '-x', 'duneFar', { collide: false });
  k.ramp(80, 0, -95, 140, 16, 85, '+x', 'duneFar', { collide: false });
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * PI * 2 + 0.2;
    const r = 175 * (1 + 0.08 * Math.sin(i * 2.7));
    k.decals.push({ kind: 'wall', w: 140, h: 46 * (0.85 + 0.3 * Math.abs(Math.sin(i * 1.9))), x: Math.cos(t) * r, y: -2, z: Math.sin(t) * r, ry: Math.atan2(-Math.cos(t), -Math.sin(t)), mat: 'mountains', uv: 'raw', seg: 3 });
  }
  // The village behind the OpFor spawn (scenery): a few mud houses and a domed mosque.
  for (const [x, z, w, d, h] of [[-44, -96, 7, 6, 4], [-34, -100, 8, 7, 4.5], [-24, -97, 6, 6, 3.6], [-52, -104, 6, 8, 4.2]] as const) k.trim(x - w / 2, 10, z - d / 2, x + w / 2, 10 + h, z + d / 2, 'mud');
  k.trim(-39, 10, -112, -31, 17, -104, 'mud');
  k.cyl(3.4, 3.4, 10, 'mudRoof', -35, 18.7, -108, 'y', false);
  k.trim(-29.6, 10, -111, -28.4, 25, -109.8, 'mud');

  // =============================================================================================
  // The Walkway (concrete, along the cliff face) and the Cliffs below it
  // =============================================================================================
  const W = L.walkway;
  // West leg: down from the plateau (6) to the corner (4).
  k.ramp(-43.4, 0, 16, -40, L.plateau, 32, '-z', 'concrete', { tag: 'stairs' });
  k.slab(-43.4, 0, 32, -35, W, 45.2, 'concrete');
  k.slab(-35, 0, 41.6, -14, W, 45.2, 'concrete');
  // East end: down to the cave's south mouth level, then stairs into the pocket.
  k.ramp(-14, 0, 41.6, -6, W, 45.2, '-x', 'concrete', { tag: 'stairs' });
  k.slab(-6, 0, 41.6, -4.8, 1.0, 45.2, 'concrete');
  k.ramp(-4.8, 0, 41.6, -2.6, 1.0, 45.2, '-x', 'concrete', { tag: 'stairs' });
  // Parapets on the inner side, railing and clip on the outer side.
  k.slab(-40, 4.4, 17, -39.6, 6.9, 22, 'concrete');
  k.rail('z', 22.5, 31.5, -39.8, 5.0, 'rail', 'steel', 1.0);
  k.slab(-35, W, 41.6, -28.2, W + 0.9, 42.0, 'concrete');
  k.slab(-23.6, W, 41.6, -21.4, W + 0.9, 42.0, 'concrete');
  k.slab(-17.8, W, 41.6, -14, W + 0.9, 42.0, 'concrete');
  k.rail('z', 16.4, 32.0, -43.25, 6.0, 'rail', 'steel', 1.0);
  k.rail('z', 32.0, 45.0, -43.25, W, 'rail', 'steel', 1.0);
  k.rail('x', -43.4, -14, 45.05, W, 'rail', 'steel', 1.0);
  k.playerClip(-43.9, -1, 14, -43.4, 40, 45.8);
  k.playerClip(-43.9, -1, 45.2, -6.4, 40, 45.8);
  // Stairs down from the Walkway to the Cliffs: at the corner and by the alcove.
  k.ramp(-39.6, 0, 27.6, -36.4, W, 32, '+z', 'concrete', { tag: 'stairs' });
  k.ramp(-21.4, 0, 37.2, -17.8, W, 41.6, '+z', 'concrete', { tag: 'stairs' });
  // The alcove (bomb-shelter door) on the inner side.
  k.slab(-28.2, 0, 37.6, -23.6, W, 41.6, 'concrete');
  k.slab(-28.2, W, 37.6, -27.8, W + 2.6, 41.6, 'concrete');
  k.slab(-24.0, W, 37.6, -23.6, W + 2.6, 41.6, 'concrete');
  k.slab(-28.2, W, 37.6, -23.6, W + 2.6, 38.0, 'concrete');
  k.slab(-28.4, W + 2.6, 37.4, -23.4, W + 3.0, 41.8, 'concrete');
  k.decals.push({ kind: 'wall', w: 2.0, h: 2.2, x: -25.9, y: W, z: 38.02, ry: 0, mat: 'door', uv: 'raw' });
  k.light(-25.9, W + 2.2, 39.8, [1.1, 0.9, 0.6], 5, 'bunker');
  // Cliffs: the climbable outcrop in the middle, boulders, the drop from R4.
  for (const [x0, z0, x1, z1, y1] of [[-24.6, 23.8, -15.6, 29.8, 3.2], [-23.4, 24.6, -16.8, 29.0, 3.9], [-22.2, 25.4, -18.0, 28.2, 4.6], [-21.0, 26.0, -19.4, 27.6, 5.2]] as const)
    k.slab(x0, L.cliffs, z0, x1, y1, z1, 'rock', { faceMats: { py: 'rockTop' } });
  for (const [x, z, s, h] of [[-33, 22, 2.2, 1.4], [-30.5, 34.5, 1.8, 1.2], [-14, 31, 2.0, 1.3], [-36.5, 19.2, 1.6, 1.0]] as const) k.slab(x - s / 2, L.cliffs, z - s / 2, x + s / 2, L.cliffs + h, z + s / 2, 'rock', { faceMats: { py: 'rockTop' } });
  for (const [x, z] of [[-34, 27], [-27, 20.5], [-13, 22], [-31, 38.6], [-12, 38]] as const) tuft(x, z, L.cliffs);
  tree(-36.6, 25.0, L.cliffs, 7.5);

  // =============================================================================================
  // The Batteries (west plateau): AA guns, crumbled mud-brick walls, the overlook
  // =============================================================================================
  const P = L.plateau;
  aaGun(-69.2, -12.6, P, yawTowards(-69.2, -12.6, -40, -40));
  aaGun(-51.4, 7.2, P, yawTowards(-51.4, 7.2, -20, -10));
  // Crumbled walls (minimap ruins).
  lineWall(-55.3, -15.2, -55.3, -10.2, P, 1.9, 0.5, 'mud', true);
  lineWall(-57.2, -10.0, -53.4, -10.0, P, 1.5, 0.5, 'mud', true);
  lineWall(-44.2, -15.1, -47.8, -13.1, P, 1.7, 0.5, 'mud', true);
  lineWall(-47.8, -13.1, -45.4, -8.7, P, 1.4, 0.5, 'mud', true);
  lineWall(-38.7, -12.7, -36.7, -9.5, P, 1.3, 0.5, 'mud', true);
  lineWall(-41.4, -0.2, -41.4, 3.2, P, 1.7, 0.5, 'mud', true);
  lineWall(-42.8, 3.2, -37.5, 3.2, P, 1.5, 0.5, 'mud', true);
  lineWall(-45.4, 8.2, -41.4, 8.2, P, 1.2, 0.5, 'mud', true);
  lineWall(-62.4, -4.0, -58.6, -2.2, P, 1.3, 0.5, 'mud', true);
  // The roofless hut by the north gun and its doorway.
  k.wall('x', -50.2, -47.4, -3.4, P, P + 2.4, 0.4, 'mud', [[-49.4, -48.4, P, P + 2]]);
  k.wall('x', -50.2, -47.4, 1.0, P, P + 2.0, 0.4, 'mud');
  k.wall('z', -3.2, 0.8, -50.0, P, P + 2.2, 0.4, 'mud');
  k.wall('z', -3.2, 0.8, -47.6, P, P + 1.6, 0.4, 'mud', [[-1.6, -0.2, P + 0.9, P + 1.6]]);
  for (const [x, z, y] of [[-66.2, -16.2, 0], [-65.0, -16.2, 0], [-65.6, -16.2, 1.2], [-54.2, 10.4, 0], [-48.4, 10.8, 0], [-36.0, -2.2, 0]] as const) crate(x, z, P + y, 1.2, 'ammo');
  barrel(-58.2, -15.6, P);
  barrel(-57.4, -16.2, P, 'barrelBlue');
  for (const [x, z] of [[-60, -14], [-52, 2], [-44, -4], [-35, 8], [-58, 9], [-67, -6], [-33, -15]] as const) tuft(x, z, P);
  tree(-62.6, 3.4, P, 8);
  tree(-46.8, -16.6, P, 7);
  // The overlook: tarp shelter at the cliff edge above the tail, a low rock lip, mattresses below.
  for (const [x, z] of [[-31.2, -14.2], [-27.6, -14.2], [-31.2, -10.8], [-27.6, -10.8]] as const) k.slab(x - 0.07, P, z - 0.07, x + 0.07, P + 2.6, z + 0.07, 'plank', { collide: false });
  k.decals.push({ kind: 'flat', w: 4.4, h: 4.2, x: -29.4, y: P + 2.6, z: -12.5, mat: 'tarp', uv: 'raw', seg: 1 });
  k.slab(-26.6, P, -15.4, -26.0, P + 0.5, -13.6, 'rock', { faceMats: { py: 'rockTop' } });
  k.slab(-26.6, P, -11.4, -26.0, P + 0.4, -9.8, 'rock', { faceMats: { py: 'rockTop' } });
  k.slab(-25.8, 0, -13.8, -23.6, 0.28, -11.0, 'mattress');
  k.slab(-25.6, 0.28, -13.4, -23.8, 0.52, -11.4, 'mattress');
  k.cyl(0.38, 0.28, 10, 'rubber', -29.0, P + 0.14, -9.6, 'y', false);

  // =============================================================================================
  // The Rocks (OpFor spawn, north-west): the pipeline overhead, the low wall, boulders
  // =============================================================================================
  const R = L.rocks;
  lineWall(-31.6, -57.2, -31.6, -46.2, R, 1.0, 0.6, 'rockDark', true);
  // Pipeline on lattice legs from the north, over the north path and R1 (scenery; one leg collides).
  const pipeY = 12.4;
  k.cyl(0.75, 34, 12, 'pipe', -48.6, pipeY, -71, 'z', false);
  const pdx = -40.6 - -48.6;
  const pdz = -37 - -54;
  rotBox((-48.6 + -40.6) / 2, (-54 + -37) / 2, Math.hypot(pdx, pdz), 1.4, pipeY - 0.7, pipeY + 0.7, pdx, pdz, 'pipe');
  for (const [x, z, y0] of [[-48.6, -60, R], [-47.4, -50.6, R], [-48.6, -80, 6]] as const) {
    k.slab(x - 0.35, y0, z - 0.35, x + 0.35, pipeY - 0.7, z + 0.35, 'steel');
    k.trim(x - 1.0, pipeY - 1.0, z - 0.25, x + 1.0, pipeY - 0.7, z + 0.25, 'steel');
  }
  for (const [x, z, s, h] of [[-28.4, -67.4, 2.0, 1.4], [-20.4, -60.6, 1.8, 1.1], [-34.2, -62.4, 2.0, 1.6], [-23.2, -51.6, 1.6, 0.9], [-52.4, -27.5, 1.8, 1.2]] as const)
    k.slab(x - s / 2, afghanGround(x, z) - 0.1, z - s / 2, x + s / 2, afghanGround(x, z) + h, z + s / 2, 'rock', { faceMats: { py: 'rockTop' } });
  crate(-19.4, -58.8, R, 1.2, 'ammo');
  crate(-19.4, -57.6, R, 1.2, 'ammo');
  for (const [x, z] of [[-29, -58], [-22, -66], [-36, -50], [-50, -40], [-53, -22], [-25, -36], [-28, -27], [-23, -48]] as const) tuft(x, z, afghanGround(x, z));
  tree(-19.6, -66.0, R, 8.5);
  tree(-52.8, -48.6, R, 7.5);
  tree(-24.2, -40.0, valleyH(-40), 7);

  // =============================================================================================
  // The plane (C-130): tail section, middle section with the wing, cockpit section
  // =============================================================================================
  /**
   * A fuselage section along x: cargo floor, side walls with holes, stepped shoulders and a
   * walkable roof. `endLo`/`endHi` close the ends (with holes) or leave them open (the breaks).
   */
  const fuselage = (x0: number, x1: number, zc: number, w: number, top: number, o: { holesN?: Hole[]; holesS?: Hole[]; endLo?: Hole[] | null; endHi?: Hole[] | null } = {}) => {
    const t = 0.25;
    const z0 = zc - w / 2;
    const z1 = zc + w / 2;
    const fl = L.plane;
    const wallTop = top - 0.9;
    const sh = 0.35;
    k.slab(x0, 0, z0, x1, fl, z1, 'hull', { faceMats: { py: 'cargoFloor' } });
    k.wall('x', x0, x1, z0 + t / 2, fl, wallTop, t, 'hull', o.holesN ?? [], { faceMats: { pz: 'cargo' } });
    k.wall('x', x0, x1, z1 - t / 2, fl, wallTop, t, 'hull', o.holesS ?? [], { faceMats: { nz: 'cargo' } });
    if (o.endLo) k.wall('z', z0 + t, z1 - t, x0 + t / 2, fl, top - 0.3, t, 'hull', o.endLo, { faceMats: { px: 'cargo' } });
    if (o.endHi) k.wall('z', z0 + t, z1 - t, x1 - t / 2, fl, top - 0.3, t, 'hull', o.endHi, { faceMats: { nx: 'cargo' } });
    k.slab(x0, wallTop, z0 + sh, x1, top - 0.3, z0 + sh + 0.35, 'hull', { faceMats: { pz: 'cargo', ny: 'cargo' } });
    k.slab(x0, wallTop, z1 - sh - 0.35, x1, top - 0.3, z1 - sh, 'hull', { faceMats: { nz: 'cargo', ny: 'cargo' } });
    k.slab(x0, top - 0.3, z0 + sh, x1, top, z1 - sh, 'hull', { faceMats: { ny: 'cargo' } });
    k.trim(x0, wallTop, z0, x1, wallTop + 0.08, z0 + sh, 'hull');
    k.trim(x0, wallTop, z1 - sh, x1, wallTop + 0.08, z1, 'hull');
    k.trim(x0 + 0.1, 0.3, z0 - 0.12, x1 - 0.1, wallTop - 0.3, z0, 'hullDark');
    k.trim(x0 + 0.1, 0.3, z1, x1 - 0.1, wallTop - 0.3, z1 + 0.12, 'hullDark');
    // Rib frames inside.
    for (let x = x0 + 1.2; x < x1 - 0.6; x += 1.6) {
      k.trim(x - 0.06, fl, z0 + t, x + 0.06, wallTop, z0 + t + 0.08, 'cargo');
      k.trim(x - 0.06, fl, z1 - t - 0.08, x + 0.06, wallTop, z1 - t, 'cargo');
    }
  };
  const win = (from: number, n: number, step: number, y0 = 1.9, y1 = 2.4): Hole[] => Array.from({ length: n }, (_, i) => [from + i * step, from + i * step + 0.5, y0, y1] as Hole);

  // --- tail section (fin standing, break facing east) ---
  const tz = -14.5;
  fuselage(-16, -7.4, tz, 4.2, 4.1, { holesN: [...win(-14.6, 2, 3.2), [-10.6, -9.4, L.plane, L.plane + 1.9]], holesS: [...win(-14.2, 3, 2.4)], endLo: [] });
  // Tail cone and the upswept aft belly.
  k.slab(-18, 1.0, tz - 1.7, -16, 4.1, tz + 1.7, 'hull');
  k.slab(-19.6, 2.0, tz - 1.1, -18, 4.0, tz + 1.1, 'hull');
  k.ramp(-18, 0, tz - 1.7, -16, 1.0, tz + 1.7, '+x', 'hullDark');
  // Vertical fin and the tailplane.
  k.slab(-19.4, 4.1, tz - 0.25, -14.6, 7.6, tz + 0.25, 'hull');
  k.slab(-19.0, 7.6, tz - 0.22, -16.2, 10.4, tz + 0.22, 'hull');
  k.trim(-19.2, 10.4, tz - 0.2, -17.0, 10.7, tz + 0.2, 'hull');
  k.slab(-19.2, 4.1, tz - 7.2, -16.2, 4.4, tz + 7.2, 'hull', { hide: ['ny'] });
  // Jagged break (render only) and debris round it.
  for (const [z, y0, y1] of [[tz - 1.6, 0.4, 2.6], [tz + 1.2, 0.4, 3.4], [tz - 0.4, 3.0, 4.1]] as const) k.trim(-7.4, y0, z - 0.4, -6.9, y1, z + 0.4, 'hullDark');

  // --- middle section (both ends broken open) and its wing up to the ledge ---
  const mz = -16;
  const mx0 = -1.6;
  const mx1 = 8.6;
  fuselage(mx0, mx1, mz, 4.4, L.planeRoof, { holesN: [...win(-0.6, 4, 2.4)], holesS: [[6.2, 7.4, L.plane, L.plane + 1.9], ...win(-0.8, 1, 2)] });
  for (const [x, z, y0, y1] of [[mx0 - 0.2, mz - 1.6, 0.4, 3.0], [mx0 - 0.2, mz + 1.4, 0.4, 2.2], [mx1 + 0.2, mz + 1.6, 0.4, 3.2], [mx1 + 0.2, mz - 0.8, 3.0, 4.3]] as const) k.trim(x - 0.25, y0, z - 0.4, x + 0.25, y1, z + 0.4, 'hullDark');
  // Cargo inside: a pallet of crates.
  crate(3.0, mz - 1.0, L.plane, 1.2, 'ammo');
  crate(4.2, mz - 1.0, L.plane, 1.2, 'ammo');
  crate(3.6, mz - 1.0, L.plane + 1.2, 1.2, 'ammo');
  // The wing: thin wedges rising south from the fuselage side (0.15) to the ledge (5.8).
  const wx0 = 1.0;
  const wx1 = 5.0;
  const wz0 = mz + 2.2;
  const wz1 = LEDGE.z0 + 0.2;
  const nW = 10;
  for (let i = 0; i < nW; i++) {
    const za = wz0 + ((wz1 - wz0) * i) / nW;
    const zb = wz0 + ((wz1 - wz0) * (i + 1)) / nW;
    const ya = 0.15 + ((L.ledge - 0.15) * i) / nW;
    const yb = 0.15 + ((L.ledge - 0.15) * (i + 1)) / nW;
    k.ramp(wx0, ya, za, wx1, yb, zb, '+z', 'hull', { tag: 'stairs' });
    // No crawling under the low end of the wing.
    if (ya < 1.9) k.slab(wx0, 0, za, wx1, ya, zb, 'clip', { noRender: true, bullets: false, sight: false });
  }
  // Flap track fairings, the two engines and their props.
  for (const z of [wz0 + 6.2, wz0 + 12.4]) {
    const y = 0.15 + ((L.ledge - 0.15) * (z - wz0)) / (wz1 - wz0);
    k.cyl(0.62, 4.2, 10, 'hull', wx1 - 1.6, y - 0.75, z, 'x');
    k.trim(wx1 + 0.5, y - 0.85, z - 2.0, wx1 + 0.6, y - 0.65, z + 2.0, 'prop');
    k.trim(wx1 + 0.5, y - 2.6, z - 0.1, wx1 + 0.6, y + 1.1, z + 0.1, 'prop');
  }
  // The other wing: a short broken stub on the north side.
  k.slab(wx0, 3.4, mz - 6.4, wx1, 3.7, mz - 2.2, 'hull');
  k.trim(wx0 + 0.6, 3.1, mz - 6.6, wx1 - 1.2, 3.4, mz - 6.0, 'hullDark');
  // The detached outboard engine and wing panels lying in the sand.
  k.cyl(0.62, 4.0, 10, 'hullDark', 20, 0.62, -20.6, 'x');
  rotBox(14.6, -19.8, 3.8, 1.6, 0, 0.3, 0.9, 0.4, 'hull', 2);
  rotBox(-3.8, -6.6, 2.6, 1.4, 0, 0.25, -0.5, 0.8, 'hullDark', 1);

  // --- cockpit section (nose east, broken open at the west end) ---
  const cz = -7.4;
  const cx0 = 12.2;
  const cx1 = 21;
  fuselage(cx0, cx1, cz, 4.4, 4.3, { holesN: [[17.6, 19.2, 2.2, 3.1], ...win(13.2, 2, 2.0)], holesS: [[17.6, 19.2, 2.2, 3.1], ...win(13.4, 2, 2.0)], endHi: [[cz - 1.75, cz + 1.75, 1.45, 3.3]] });
  // Nose (below the windscreen) and the frame round the windows.
  k.slab(cx1, 0, cz - 1.9, cx1 + 1.6, 1.4, cz + 1.9, 'hull');
  k.slab(cx1 + 1.6, 0.2, cz - 1.3, cx1 + 2.6, 1.1, cz + 1.3, 'hull');
  k.slab(cx1, 3.3, cz - 1.9, cx1 + 0.9, 3.9, cz + 1.9, 'hull');
  for (const z of [cz - 0.5, cz + 0.5]) k.trim(cx1 - 0.25, 1.45, z - 0.05, cx1 - 0.15, 3.3, z + 0.05, 'glassFrame');
  // Flight deck: instrument panel, two seats.
  k.slab(cx1 - 1.1, L.plane, cz - 1.6, cx1 - 0.25, 1.1, cz + 1.6, 'hullDark');
  k.decals.push({ kind: 'wall', w: 3.0, h: 0.7, x: cx1 - 1.12, y: 0.4, z: cz, ry: -PI / 2, mat: 'cockpit', uv: 'raw' });
  for (const z of [cz - 0.9, cz + 0.9]) k.slab(cx1 - 2.4, L.plane, z - 0.35, cx1 - 1.8, 1.0, z + 0.35, 'hullDark');
  k.trim(cx0 - 0.35, 0.4, cz - 1.8, cx0 + 0.1, 2.8, cz - 1.0, 'hullDark');
  k.trim(cx0 - 0.35, 2.6, cz + 0.4, cx0 + 0.1, 4.3, cz + 1.6, 'hullDark');
  // Fires smouldering at the breaks.
  k.light(-6.6, 1.6, tz, [1.6, 0.8, 0.35], 7, 'fire');
  k.glow(-6.8, 1.2, tz, [0.9, 0.45, 0.15], 2.4, 'fire');
  k.light(cx0 - 0.6, 1.4, cz, [1.6, 0.8, 0.35], 6, 'fire');
  k.glow(cx0 - 0.8, 1.0, cz, [0.9, 0.45, 0.15], 2.0, 'fire');
  k.light(3.6, 3.0, mz, [1.0, 0.8, 0.55], 6, 'bunker');

  // --- the scattered supplies round the crash site ---
  for (const [x, z, y] of [[11.6, -18.6, 0], [12.8, -18.6, 0], [12.2, -18.6, 1.2], [-6.2, 1.2, 0], [9.8, 2.6, 0], [11.0, 2.6, 0], [22.4, 3.4, 0], [12.6, -12.4, 0], [20.6, -14.8, 0], [-9.0, -20.6, 0]] as const)
    crate(x, z, afghanGround(x, z) + y, 1.2, 'ammo');
  barrel(-4.6, 2.4, 0);
  barrel(9.0, 3.6, 0, 'barrelBlue');
  for (const [x, z] of [[-12, -24], [6, -1], [18, 4], [26, -18], [-18, -6], [10, -26], [2, 4], [24, 0]] as const) tuft(x, z, Math.round(afghanGround(x, z) / Q) * Q);

  // =============================================================================================
  // North-east: the centre Bunker on its mound, the Poppy Fields, the farm, the east Bunker
  // =============================================================================================
  // --- centre Bunker (faces the plane; rear door and stairs down to the fields) ---
  {
    const y = L.bunker;
    const x0 = 6.8;
    const x1 = 16.8;
    const z0 = -34.6;
    const z1 = -29.4;
    const h = 2.7;
    const t = 0.45;
    k.wall('x', x0, x1, z1 - t / 2, y, y + h, t, 'bunker', [[7.6, 8.8, y, y + 2.1], [9.6, 15.8, y + 1.0, y + 1.6]], { faceMats: { nz: 'bunkerIn' } });
    k.wall('x', x0, x1, z0 + t / 2, y, y + h, t, 'bunker', [[13.0, 14.2, y, y + 2.1], [9.0, 10.6, y + 1.0, y + 1.6]], { faceMats: { pz: 'bunkerIn' } });
    k.wall('z', z0 + t, z1 - t, x0 + t / 2, y, y + h, t, 'bunker', [[-32.8, -31.2, y + 1.0, y + 1.6]], { faceMats: { px: 'bunkerIn' } });
    k.wall('z', z0 + t, z1 - t, x1 - t / 2, y, y + h, t, 'bunker', [], { faceMats: { nx: 'bunkerIn' } });
    k.slab(x0 - 0.3, y + h, z0 - 0.3, x1 + 0.3, y + h + 0.5, z1 + 0.3, 'bunker', { faceMats: { ny: 'bunkerIn' } });
    k.decals.push({ kind: 'flat', w: x1 - x0 - 0.9, h: z1 - z0 - 0.9, x: (x0 + x1) / 2, y: y + 0.02, z: (z0 + z1) / 2, mat: 'concrete' });
    // Sandbags on the roof and along the front.
    for (let x = x0; x < x1 - 0.2; x += 1.25) k.trim(x, y + h + 0.5, z1 - 0.2, x + 1.2, y + h + 0.95, z1 + 0.35, 'sandbag');
    k.slab(x0 + 0.5, y, z0 + 0.5, x0 + 1.6, y + 0.9, z0 + 1.4, 'barrel');
    barrel(15.6, -33.6, y);
    barrel(15.0, -34.0, y, 'barrelBlue');
    k.slab(10.8, y, -33.9, 12.6, y + 0.8, -33.1, 'plank');
    k.trim(11.0, y + 2.3, -32.2, 11.4, y + 2.6, -31.8, 'lamp');
    k.light(11.7, y + 2.1, -32, [1.3, 1.1, 0.8], 7, 'bunker');
    k.glow(11.2, y + 2.3, -32, [0.5, 0.42, 0.3], 1.4, 'bunker');
    // Rear stairs down to the Poppy Fields.
    k.ramp(12.8, L.poppy, -37, 14.4, y, -34.6, '+z', 'concrete', { tag: 'stairs' });
    k.slab(12.6, L.poppy, -37, 12.8, y + 0.9, -34.6, 'concrete', { collide: false });
    k.slab(14.4, L.poppy, -37, 14.6, y + 0.9, -34.6, 'concrete', { collide: false });
  }

  // --- the Poppy Fields: farm buildings, low mud walls, the field, the open shack ---
  const pp = L.poppy;
  const house = (x0: number, z0: number, x1: number, z1: number, h: number, mat = 'mud') => {
    k.slab(x0, pp - 0.5, z0, x1, pp + h, z1, mat, { faceMats: { py: 'mudRoof' } });
    k.trim(x0 - 0.15, pp + h, z0 - 0.15, x1 + 0.15, pp + h + 0.3, z1 + 0.15, 'mudDark');
  };
  house(7.3, -71.6, 12.1, -66.2, 3.4);
  house(2.1, -65.6, 10.1, -61.6, 3.0);
  k.decals.push({ kind: 'wall', w: 1.1, h: 2.0, x: 6.0, y: pp, z: -61.58, ry: 0, mat: 'plank', uv: 'raw' });
  k.decals.push({ kind: 'wall', w: 1.1, h: 2.0, x: 9.6, y: pp, z: -66.18, ry: 0, mat: 'plank', uv: 'raw' });
  rotBox(1.6, -58.0, 7.6, 4.2, pp - 0.5, pp + 3.2, 0.34, 0.94, 'mud', 5);
  rotBox(1.6, -58.0, 8.0, 4.6, pp + 3.2, pp + 3.5, 0.34, 0.94, 'mudDark');
  k.slab(1.4, pp, -54.0, 2.0, pp + 1.6, -50.4, 'mud');
  k.slab(13.8, pp, -65.9, 14.3, pp + 2.0, -61.9, 'mud');
  k.slab(8.9, pp, -58.0, 9.4, pp + 1.2, -54.8, 'mud');
  k.slab(9.4, pp, -55.3, 12.9, pp + 1.2, -54.8, 'mud');
  // Field walls and the poppy field between them.
  k.slab(9.7, pp, -51.6, 12.0, pp + 1.0, -51.1, 'mud');
  k.slab(12.0, pp, -51.6, 17.0, pp + 1.4, -51.1, 'mud');
  k.slab(17.0, pp, -51.6, 22.0, pp + 1.0, -51.1, 'mud');
  k.slab(12.5, pp, -42.7, 22.0, pp + 1.0, -42.2, 'mud');
  k.decals.push({ kind: 'flat', w: 11.6, h: 8.0, x: 16.0, y: pp + 0.02, z: -47.0, mat: 'poppy' });
  k.decals.push({ kind: 'flat', w: 8.0, h: 4.6, x: 20.0, y: pp + 0.02, z: -39.6, mat: 'poppy' });
  for (let x = 11; x < 21.5; x += 2.1) for (let z = -50; z < -43.6; z += 2.2) tuft(x + hash(x, z) * 0.6, z, pp, 0.7);
  // The open shack (thin plank walls: they stop you and hide you, not bullets).
  {
    const x0 = 26;
    const x1 = 29.6;
    const z0 = -48.8;
    const z1 = -42.1;
    const o = { bullets: false };
    k.wall('x', x0, x1, z0 + 0.06, pp, pp + 2.6, 0.12, 'plank', [[27.0, 28.0, pp + 1.1, pp + 1.9]], o);
    k.wall('x', x0, x1, z1 - 0.06, pp, pp + 2.6, 0.12, 'plank', [[26.6, 27.8, pp, pp + 2.0]], o);
    k.wall('z', z0, z1, x0 + 0.06, pp, pp + 2.6, 0.12, 'plank', [[-46.6, -44.6, pp + 1.1, pp + 1.9]], o);
    k.wall('z', z0, z1, x1 - 0.06, pp, pp + 2.6, 0.12, 'plank', [[-47.4, -43.4, pp, pp + 2.2]], o);
    k.slab(x0 - 0.3, pp + 2.6, z0 - 0.3, x1 + 0.6, pp + 2.75, z1 + 0.3, 'corr', { bullets: false });
    k.wall('x', x1, 32.7, -48.6, pp, pp + 1.2, 0.12, 'plank', [], o);
    k.wall('x', x1, 32.7, -44.2, pp, pp + 1.2, 0.12, 'plank', [], o);
    k.light(27.8, pp + 2.2, -45.4, [1.2, 0.95, 0.6], 6, 'lamp');
    crate(27.0, -47.8, pp, 1.0, 'ammo');
  }
  // The farmhouse in the far north-east corner (two storeys) and its yard wall.
  house(27.5, -65.1, 33.9, -58.0, 5.6);
  house(28.0, -58.0, 33.4, -53.2, 3.2);
  for (const [x, z] of [[29.4, -58.04], [31.8, -65.14]] as const) k.decals.push({ kind: 'wall', w: 1.0, h: 1.0, x, y: pp + 3.6, z, ry: PI, mat: 'plank', uv: 'raw' });
  k.slab(22.6, pp, -59.6, 23.1, pp + 1.4, -54.0, 'mud');
  // Water tank on its stand, crates and a cart.
  for (const [x, z] of [[19.0, -62.0], [21.0, -62.0], [19.0, -60.0], [21.0, -60.0]] as const) k.slab(x - 0.1, pp, z - 0.1, x + 0.1, pp + 3.0, z + 0.1, 'steel');
  k.slab(18.8, pp + 3.0, -62.2, 21.2, pp + 3.2, -59.8, 'steel');
  k.cyl(1.05, 2.2, 10, 'barrel', 20.0, pp + 4.3, -61.0, 'y', false);
  for (const [x, z, y] of [[3.4, -48.2, 0], [4.6, -48.2, 0], [24.2, -39.4, 0], [16.2, -57.6, 0], [17.4, -57.6, 0], [16.8, -57.6, 1.2], [36.0, -41.0, 0]] as const) crate(x, z, pp + y, 1.2, 'ammo');
  for (const [x, z] of [[0, -44], [6, -40], [24, -50], [33, -50], [4, -68], [20, -70], [36, -60], [27, -36]] as const) tuft(x, z, pp);
  tree(5.2, -52.8, pp, 9);
  tree(24.4, -67.8, pp, 8);
  tree(35.6, -50.2, pp, 7.5);

  // --- the east Bunker (four rooms, over the Canyon) ---
  {
    const y = L.eastBunker;
    const x0 = 31.6;
    const x1 = 42.2;
    const z0 = -21.8;
    const z1 = -4.0;
    const h = 2.7;
    const t = 0.45;
    const wi = (a: number, b: number): Hole => [a, b, y + 1.0, y + 1.65];
    k.wall('x', x0, x1, z0 + t / 2, y, y + h, t, 'bunker', [[33.2, 34.6, y, y + 2.1]], { faceMats: { pz: 'bunkerIn' } });
    k.wall('x', x0, x1, z1 - t / 2, y, y + h, t, 'bunker', [wi(32.8, 35.8), [36.9, 38.3, y, y + 2.1], wi(39.0, 41.2)], { faceMats: { nz: 'bunkerIn' } });
    k.wall('z', z0 + t, z1 - t, x0 + t / 2, y, y + h, t, 'bunker', [wi(-19.6, -16.4), [-13.6, -12.2, y, y + 2.1], wi(-9.6, -6.2)], { faceMats: { px: 'bunkerIn' } });
    k.wall('z', z0 + t, z1 - t, x1 - t / 2, y, y + h, t, 'bunker', [], { faceMats: { nx: 'bunkerIn' } });
    // Cross walls into four rooms.
    k.wall('z', z0 + t, z1 - t, 36.8, y, y + h, 0.3, 'bunkerIn', [[-19.4, -18.0, y, y + 2.1], [-8.4, -7.0, y, y + 2.1]]);
    k.wall('x', x0 + t, x1 - t, -12.9, y, y + h, 0.3, 'bunkerIn', [[33.4, 34.8, y, y + 2.1], [39.0, 40.4, y, y + 2.1]]);
    k.slab(x0 - 0.3, y + h, z0 - 0.3, x1, y + h + 0.5, z1 + 0.3, 'bunker', { faceMats: { ny: 'bunkerIn' } });
    k.decals.push({ kind: 'flat', w: x1 - x0 - 0.9, h: z1 - z0 - 0.9, x: (x0 + x1) / 2, y: y + 0.02, z: (z0 + z1) / 2, mat: 'concrete' });
    for (const [lx, lz] of [[34.2, -17.4], [39.4, -17.4], [34.2, -8.4], [39.4, -8.4]] as const) {
      k.trim(lx - 0.2, y + 2.4, lz - 0.2, lx + 0.2, y + h, lz + 0.2, 'lamp');
      k.light(lx, y + 2.1, lz, [1.3, 1.1, 0.8], 6.5, 'bunker');
    }
    for (const [bx, bz] of [[41.0, -20.6], [41.0, -19.8], [40.2, -20.6]] as const) barrel(bx, bz, y);
    k.slab(38.0, y, -11.8, 40.2, y + 0.8, -10.8, 'plank');
    crate(33.0, -10.6, y, 1.0, 'ammo');
    crate(40.8, -5.4, y, 1.0, 'ammo');
    // Earth bank over the roof, against the canyon wall.
    k.ramp(x0 - 0.3, y + h + 0.5, z0 - 0.3, x1, y + h + 2.3, z1 + 0.3, '+x', 'earth', { collide: false });
    for (let x = x0; x < 36.4; x += 1.25) k.trim(x, y + h + 0.5, z1 - 0.1, x + 1.2, y + h + 0.95, z1 + 0.4, 'sandbag');
  }

  // =============================================================================================
  // The Canyon (south-east, TF141 spawn): Humvees, the hill, the Stryker across the road
  // =============================================================================================
  const humvee = (cx: number, cz: number, dx: number, dz: number) => {
    rotBox(cx, cz, 4.7, 2.2, 0.45, 1.5, dx, dz, 'humvee', 4);
    rotBox(cx - dx * 0.4, cz - dz * 0.4, 2.4, 2.0, 1.5, 1.95, dx, dz, 'humvee', 2);
    for (const s of [-1.5, 1.5]) rotBox(cx + dx * s, cz + dz * s, 0.8, 2.3, 0, 0.85, dx, dz, 'rubber');
    rotBox(cx - dx * 0.4, cz - dz * 0.4, 0.8, 0.8, 1.95, 2.35, dx, dz, 'gun');
  };
  humvee(38.8, 10.3, 0, 1);
  humvee(37.8, 27.9, 0.94, 0.34);
  // Stryker blocking the road out (south-east corner).
  {
    const dx = 0.62;
    const dz = -0.78;
    rotBox(57.0, 46.6, 7.0, 2.8, 0.6, 2.4, dx, dz, 'stryker', 5);
    rotBox(57.0, 46.6, 7.2, 3.0, 0, 0.9, dx, dz, 'rubber');
    rotBox(57.0 + dx * 1.0, 46.6 + dz * 1.0, 1.4, 1.2, 2.4, 3.0, dx, dz, 'stryker', 1);
  }
  for (const [x, z, y] of [[46.2, 13.4, 0], [47.4, 13.4, 0], [33.4, 16.2, 0], [50.8, 26.2, 0], [44.2, 49.0, 0], [45.4, 49.0, 0], [44.8, 49.0, 1.2]] as const) crate(x, z, afghanGround(x, z) + y, 1.2, 'ammo');
  barrel(33.4, 18.0, 0);
  barrel(50.2, 30.8, 0, 'barrelBlue');
  for (const [x, z] of [[36, 4], [46, 8], [32, 36], [48, 30], [42, 44], [53, 40], [40, 20], [47, 22]] as const) tuft(x, z, Math.round(afghanGround(x, z) / Q) * Q);
  tree(49.6, 15.8, 0, 9);
  tree(33.2, 40.8, 0, 7.5);

  // =============================================================================================
  // The south pocket: the third AA gun and its sandbag arc
  // =============================================================================================
  aaGun(6.2, 49.4, 0, yawTowards(6.2, 49.4, 6, 20));
  sandbagRing(6.0, 50.2, 0, 4.6, 1.0, null, 0.35, PI - 0.35);
  for (const [x, z, y] of [[-2.2, 50.4, 0], [-2.2, 51.6, 0], [13.4, 46.2, 0], [14.6, 46.2, 0], [12.2, 61.0, 0]] as const) crate(x, z, y, 1.2, 'ammo');
  barrel(0.4, 58.6, 0);
  for (const [x, z] of [[2, 44], [10, 56], [-3, 60], [15, 52], [5, 62]] as const) tuft(x, z, Math.round(afghanGround(x, z) / Q) * Q);
  tree(-2.4, 46.6, 0, 8);

  // =============================================================================================
  // Spawns and objectives (heights from the built collision world)
  // =============================================================================================
  const world = new CollisionWorld(mapSolids({ brushes: k.brushes, props: k.props } as MapData));
  const gy = (x: number, z: number, from = 12) => {
    const g = world.groundBelow(x, z, from, 30);
    if (g === null) throw new Error(`afghan: no ground at ${x},${z}`);
    return Math.round(g * 1000) / 1000;
  };
  const face = (x: number, z: number, tx: number, tz: number, from?: number) => spawnAt(x, z, yawTowards(x, z, tx, tz), gy(x, z, from));
  const pt = (id: string, x: number, z: number, radius: number, from?: number, team?: 0 | 1) => ({ id, x, y: gy(x, z, from), z, radius, ...(team === undefined ? {} : { team }) });

  // Team 0 (OpFor): the Rocks, north-west.
  const team0: SpawnPoint[] = [
    face(-31, -63, 0, -10), face(-26, -65.2, 0, -10), face(-21.6, -63.4, 0, -10), face(-33.2, -58.4, 0, -10), face(-28, -59.6, 0, -10),
    face(-23.4, -57.8, 0, -10), face(-20.6, -54.6, 0, -20), face(-25.6, -53.6, 0, -20), face(-29.6, -53.4, -10, -20), face(-35, -52.6, -40, -20),
  ];
  // Team 1 (TF141): the Canyon, south-east.
  const team1: SpawnPoint[] = [
    face(47, 44.6, 20, 0), face(50.6, 45.2, 20, 0), face(48, 40, 20, 0), face(52.6, 38.8, 20, 0), face(44.6, 39.4, 20, 0),
    face(41, 37.4, 20, 0), face(50.2, 34.4, 20, 0), face(45.6, 34.2, 20, 0), face(53.2, 32.8, 20, 0), face(41.6, 32.2, 20, 0),
  ];
  const ffa: SpawnPoint[] = [
    face(-62, -10, -40, -10), face(-47, 9.6, -30, -10), face(-37, -6, -20, -10), face(-51.6, -32, -40, -50), face(-43, -50, -20, -55),
    face(-24, -61, -10, -40), face(-9, -49.4, 10, -50), face(5, -59.6, 20, -50), face(21, -55, 10, -45), face(33.6, -40, 20, -30),
    face(26.6, -9, 0, -10), face(-13.6, -22.6, 0, -10), face(1.2, -23.4, 10, -10), face(14.4, 6.4, 0, -10), face(45, 12.4, 30, 30),
    face(12, 57, 16, 48), face(-26, 33, -10, 25), face(-38.6, 39.6, -20, 43), face(-16.8, -2.6, 0, -15), face(33, -51, 20, -45),
  ];

  // Search and Destroy (MWIII): attackers from the Rocks, defenders hold the east side.
  const sdAttack = team0.slice();
  const sdDefend: SpawnPoint[] = [
    face(34.2, -15.6, 10, -10, 4), face(33.6, -19.8, 10, -10, 4), face(39.6, -10.0, 10, 10, 4), face(34.0, -6.6, 34.1, -20, 4), face(39.4, -15.2, 10, -10, 4),
    face(28.8, 0.6, 10, 20), face(44.0, 4.8, 30, 30), face(36.0, 4.4, 10, 20), face(44.4, 9.4, 30, 30), face(42.4, 16.0, 30, 30),
  ];

  return {
    id: 'afghan',
    name: 'Afghan',
    bounds: { min: { x: B.minX, y: -2, z: B.minZ }, max: { x: B.maxX, y: 40, z: B.maxZ } },
    materials: MATERIALS,
    brushes: k.brushes,
    decals: k.decals,
    props: k.props,
    lights: k.lights,
    spawns: { teams: [team0, team1], ffa },
    objectives: {
      // A by the Batteries (team 0's side), B at the plane like MW2, C in the Canyon (team 1's side).
      // MWIII letters them C (Batteries), A (Canyon) and moves B north to the Poppy Fields.
      dom: [pt('A', -46.4, 3.6, 3.5), pt('B', 10.4, -9.4, 3.5), pt('C', 43.2, 21.8, 3.5)],
      // MWIII sites: A at the plane (south of the middle section), B in the south pocket by the AA gun.
      sd: [pt('A', 9.4, -5.2, 2.4, 12, 1), pt('B', 1.8, 47.4, 2.4, 12, 1)],
      sdBomb: [pt('bomb', -27, -62, 1, 12, 0)],
      // MWIII's five hardpoints: the Batteries, the plane, the east Bunker, the Poppy Fields, the Cave.
      hq: [pt('batteries', -42.4, -7.6, 3), pt('plane', -3.4, -9.4, 3), pt('eastBunker', 34.2, -17.2, 2.2, 4), pt('poppy', 17.6, -54.4, 3), pt('cave', 2.4, 25.6, 3, 5)],
    },
    modeSpawns: { sd: { attackers: sdAttack, defenders: sdDefend } },
    times: [
      { id: 'day', name: 'Desert day', clock: '14:02', sky: 'afg_skyDay', unlit: [1, 0.98, 0.92], skyRot: 0, sunDir: unitVec(0.45, 0.82, 0.35), sun: [1.08, 0.98, 0.82], amb: [0.56, 0.53, 0.49], fog: [0.8, 0.78, 0.72], fogNear: 45, fogFar: 230, lights: { cave: 0.9, bunker: 0.8, fire: 0.35 }, glow: 0.3 },
      { id: 'dusk', name: 'Dusty sunset', clock: '18:35', sky: 'rust_skyDusk', unlit: [1, 0.86, 0.74], skyRot: PI * 0.75, sunDir: unitVec(-0.85, 0.28, 0.3), sun: [1.32, 0.76, 0.44], amb: [0.42, 0.33, 0.3], fog: [0.84, 0.6, 0.44], fogNear: 30, fogFar: 175, lights: { cave: 1, bunker: 1, fire: 1, lamp: 0.9 }, glow: 0.8 },
    ],
    defaultTime: 'day',
    hotspots: [
      [3, 9.4, 7], [-29.4, -12.5, 8], [11.6, -31.8, 6], [39.4, -8.4, 4], [34.2, -17.2, 4], [0.6, -16, 3], [18.6, -7.4, 3], [-11.6, -14.5, 3],
      [-1.0, 29.0, 5], [-9.0, 26.0, 5], [-51.4, 4.2, 8], [-66.6, -12.6, 8], [-30.0, 43.4, 6], [-41.8, 24.0, 8], [27.8, -45.6, 4.5], [16.0, -47.0, 5],
      [-26.0, -48.4, 7], [6.2, 46.0, 3], [43.0, 24.0, 5], [-20.0, 32.0, 5],
    ].map(([x, z, from]) => ({ x: x!, y: gy(x!, z!, from), z: z! })),
  };
}
