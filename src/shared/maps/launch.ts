/**
 * Launch (recreation of Black Ops 1's Launch, the Baikonur cosmodrome pad; owner: maps-bo).
 * Traced from the original's colour overhead and minimap, with the Black Ops 7 remaster's tac map
 * (same layout) for the outline and objective positions; see docs/maps/launch-reference.md for the
 * sources, the scale, callouts and measurements.
 *
 * Metres, +x east, +z south (north is up on the overhead), yaw 0 faces north (-z). About 127 x 63 m
 * of play space: a long east-west band between the two security checkpoints, with the launch pad
 * pushed out of its north side.
 *
 *   West Checkpoint  team 0 spawn yard at the west end (x -65 .. -48), gate and guard booth
 *   Offices          the block north of the main road behind the west yard, generator shed
 *   Warehouse        the dark-roofed hall south of the main road (west)
 *   Containers       the sandy yard south of the Warehouse, Domination A by the turned container
 *   Stairs Roof      the low building on the south edge whose roof is reached by outside stairs
 *   Centrifuge       the big hall south-west of the track: the centrifuge drum, a catwalk inside
 *   Launch Pad       the rocket on its pad north of the middle: the flame trench under it runs
 *                    west-east (the underground path, Domination B / S&D A), a deck ring round the
 *                    opening, two stair towers with balconies (the "staircase sniper" spots) and the
 *                    walkway behind the rocket; the two gantry towers stand outside the map
 *   Track            the raised rail embankment running south from the pad, its two concrete
 *                    inclines and the tracked missile cars on top (climb the big one)
 *   Main Road        the long east-west road from checkpoint to checkpoint, crossing the track
 *   Control          the two-storey building north-east of the track; outside stairs to the low roofs
 *   Fuel Yard        the tank farm south-east of the track: three vertical tanks, two big ones
 *                    on the south edge (S&D B), Domination C by the turned container
 *   Garage           the open-fronted shed and its neighbour on the north-east edge
 *   East Checkpoint  team 1 spawn yard at the east end (x 46 .. 61)
 *
 * The flame trench, the deck, the towers and the track are the vertical layer the original is known
 * for; everything else stands on the ground (y 0).
 */
import type { Vec3 } from '../math';
import { MapKit, yawTo, type Hole } from './bo-kit';
import { unitVec, type Brush, type MapData, type MaterialDef, type ObjectivePoint, type SpawnPoint } from './types';

const PI = Math.PI;
/** x of the rocket and the track (the overhead's centre line). */
const RX = -0.45;
/** z of the rocket centre. */
const RZ = -22.1;
/** Half width of the pad block (walls at RX -+ PAD_HW). */
const PAD_HW = 10.45;

/** Floor heights. */
export const LAUNCH_LEVELS = {
  ground: 0,
  /** Flame trench floor under the rocket. */
  pit: -1.5,
  /** Deck ring round the rocket opening, and the top of the track embankment. */
  deck: 2.4,
  /** Stair tower landing and balcony. */
  towerLanding: 4.4,
  tower: 6.4,
  /** Top of the big missile car on the track. */
  car: 5.0,
  /** Control building upper floor and the low roofs beside it. */
  control: 3.6,
  /** Centrifuge catwalk. */
  catwalk: 3.4,
  /** The roof reached by the outside stairs on the south-west edge. */
  stairsRoof: 3.2,
} as const;
const L = LAUNCH_LEVELS;

export const LAUNCH_BOUNDS = { min: { x: -67.5, y: -6, z: -34 }, max: { x: 63.5, y: 60, z: 34 } };

/** The playable outline (traced from the overhead), clockwise on the overhead. Everything outside is clipped. */
export const LAUNCH_OUTLINE: [number, number][] = [
  [-10.9, -31.6], [10.0, -31.6], [10.0, -24.4], [25.5, -8.8], [28.3, -11.6], [31.1, -8.8], [43.0, -8.8], [43.0, -1.3],
  [46.1, -1.3], [46.1, -3.8], [61.25, -3.8], [61.25, 5.75], [48.0, 5.75], [48.0, 21.2], [44.6, 21.2], [44.6, 22.75],
  [36.75, 22.75], [24.9, 28.4], [23.0, 28.4], [23.0, 30.6], [8.0, 30.6], [8.0, 28.4], [-9.4, 28.4], [-9.4, 31.8],
  [-22.7, 31.8], [-22.7, 25.9], [-28.0, 25.9], [-35.2, 19.6], [-49.25, 19.6], [-49.25, 11.8], [-55.8, 11.8],
  [-55.8, 7.0], [-65.5, 7.0], [-65.5, -4.0], [-47.9, -4.0], [-47.9, -9.4], [-34.3, -9.4], [-30.5, -13.2],
  [-27.0, -9.75], [-10.9, -24.4],
];

const MATERIALS: Record<string, MaterialDef> = {
  asphalt: { texture: 'lc_asphalt', uvMul: [1 / 5, 1 / 5] },
  sand: { texture: 'lc_sand', uvMul: [1 / 6, 1 / 6] },
  slab: { texture: 'lc_slab', uvMul: [1 / 4, 1 / 4] },
  concrete: { texture: 'bo_concrete', uvMul: [1 / 3, 1 / 3] },
  concreteDark: { texture: 'bo_concrete', tint: 0x8a8680, uvMul: [1 / 3, 1 / 3] },
  wall: { texture: 'lc_wall', uvMul: [1 / 3, 1 / 3] },
  wallWhite: { texture: 'lc_wall', tint: 0xf0ece4, uvMul: [1 / 3, 1 / 3] },
  corr: { texture: 'lc_corr', uvMul: [1 / 2.4, 1 / 2.4] },
  corrRust: { texture: 'lc_corr', tint: 0xb89a7a, uvMul: [1 / 2.4, 1 / 2.4] },
  roof: { texture: 'lc_corr', tint: 0x8a8478, uvMul: [1 / 3, 1 / 3] },
  roofRed: { texture: 'lc_corr', tint: 0xb0584a, uvMul: [1 / 3, 1 / 3] },
  ceiling: { texture: 'bo_concrete', tint: 0x9a968e, uvMul: [1 / 2, 1 / 2] },
  green: { texture: 'lc_green', uvMul: [1 / 2, 1 / 2] },
  greenDark: { texture: 'lc_green', tint: 0x7a8a72, uvMul: [1 / 2, 1 / 2] },
  orange: { texture: 'lc_orange', uvMul: [1 / 2, 1 / 2] },
  lattice: { texture: 'lc_lattice', side: 'double', uvMul: [1 / 3, 1 / 3] },
  rocket: { texture: 'lc_rocket' },
  cccp: { texture: 'lc_cccp', emissive: 0.05 },
  booster: { texture: 'lc_booster' },
  red: { texture: 'lc_red', uvMul: [1 / 2, 1 / 2] },
  pipe: { texture: 'rust_pipe', uvMul: [2, 2] },
  tank: { texture: 'lc_tank', uvMul: [2, 1] },
  tankH: { texture: 'lc_tank', tint: 0xd8d4cc, uvMul: [2, 1] },
  steel: { texture: 'steel' },
  rubber: { texture: 'rubber', uvMul: [1 / 0.4, 1 / 0.4] },
  grate: { texture: 'scrap_grate', uvMul: [1 / 1.2, 1 / 1.2] },
  stairs: { texture: 'rust_stairs', uvMul: [1 / 1.2, 1 / 1.2] },
  rail: { texture: 'rust_rail', side: 'double', uvMul: [1 / 1.6, 1] },
  yellow: { texture: 'yellow', uvMul: [1 / 0.8, 1 / 0.8] },
  hazard: { texture: 'hazard', uvMul: [1 / 0.6, 1 / 0.6] },
  shutter: { texture: 'shutter', tint: 0xb8bcc0 },
  fence: { texture: 'fence', side: 'double' },
  barrier: { texture: 'barrier', uvMul: [1 / 2, 1] },
  crate: { texture: 'crate', uvMul: [1 / 1.2, 1 / 1.2] },
  barrel: { texture: 'barrel', tint: 0x6a7a5a, uvMul: [2, 1] },
  barrelRed: { texture: 'barrel', tint: 0xa8382a, uvMul: [2, 1] },
  container0: { texture: 'container0', uvMul: [1 / 6, 1 / 2.6] },
  container2: { texture: 'container2', uvMul: [1 / 6, 1 / 2.6] },
  container4: { texture: 'container4', uvMul: [1 / 6, 1 / 2.6] },
  glass: { texture: 'bo_glass' },
  star: { texture: 'lc_star', emissive: 0.1 },
  sign: { texture: 'lc_sign', emissive: 0.15 },
  rails: { texture: 'lc_rails', uvMul: [1, 12] },
  hills: { texture: 'nt_mountains', side: 'double', fog: false, tint: 0xc0b8a8 },
  hillsFar: { texture: 'nt_mountains', side: 'double', fog: false, tint: 0xa8a8a8 },
  lamp: { texture: 'lamp', emissive: 1 },
  clip: { texture: 'none' },
};

type BrushOpts = Partial<Omit<Brush, 'min' | 'max' | 'mat'>>;
type P2 = [number, number];

const door = (a: number, w = 1.3, h = 2.3, y = 0): Hole => ({ a0: a - w / 2, a1: a + w / 2, y0: y, y1: y + h });
const win = (a0: number, a1: number, y0 = 1.1, y1 = 2.1): Hole => ({ a0, a1, y0, y1 });

// ---------------------------------------------------------------------------------------------
// Rasterised regions (the outline clip)
// ---------------------------------------------------------------------------------------------

export function insideOutline(x: number, z: number, poly: P2[] = LAUNCH_OUTLINE): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Rows of cells over [x0, x1] x [z0, z1] where `want(x, z)` holds, merged into rectangles. */
function raster(x0: number, z0: number, x1: number, z1: number, cell: number, want: (x: number, z: number) => boolean): { x0: number; z0: number; x1: number; z1: number }[] {
  const nx = Math.round((x1 - x0) / cell);
  const nz = Math.round((z1 - z0) / cell);
  const rows: { a: number; b: number }[][] = [];
  for (let j = 0; j < nz; j++) {
    const z = z0 + (j + 0.5) * cell;
    const runs: { a: number; b: number }[] = [];
    let cur: { a: number; b: number } | null = null;
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * cell;
      if (!want(x, z)) {
        cur = null;
        continue;
      }
      if (cur) cur.b = i + 1;
      else runs.push((cur = { a: i, b: i + 1 }));
    }
    rows.push(runs);
  }
  const out: { x0: number; z0: number; x1: number; z1: number }[] = [];
  let open = new Map<string, { a: number; b: number; j0: number }>();
  for (let j = 0; j <= nz; j++) {
    const next = new Map<string, { a: number; b: number; j0: number }>();
    for (const r of rows[j] ?? []) {
      const key = `${r.a},${r.b}`;
      const o = open.get(key);
      next.set(key, o ?? { ...r, j0: j });
      if (o) open.delete(key);
    }
    for (const o of open.values()) out.push({ x0: x0 + o.a * cell, z0: z0 + o.j0 * cell, x1: x0 + o.b * cell, z1: z0 + j * cell });
    open = next;
  }
  return out;
}

const hash = (x: number, z: number) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

// ---------------------------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------------------------

interface HallOpts {
  t?: number;
  roof?: string;
  /** Holes per wall, in that wall's own coordinate (x for north/south walls, z for east/west). */
  n?: Hole[];
  s?: Hole[];
  e?: Hole[];
  w?: Hole[];
  floor?: string | null;
  /** Floor level the building stands on (default 0). */
  y?: number;
}

/** An enterable rectangular building: four walls with holes, a roof slab (ceiling below), a floor decal. */
function hall(k: MapKit, x0: number, z0: number, x1: number, z1: number, h: number, mat: string, o: HallOpts = {}): void {
  const t = o.t ?? 0.3;
  const y = o.y ?? 0;
  k.wall('x', x0, x1, z0 + t / 2, y, h, t, mat, o.n ?? []);
  k.wall('x', x0, x1, z1 - t / 2, y, h, t, mat, o.s ?? []);
  k.wall('z', z0 + t, z1 - t, x0 + t / 2, y, h, t, mat, o.w ?? []);
  k.wall('z', z0 + t, z1 - t, x1 - t / 2, y, h, t, mat, o.e ?? []);
  k.aabb(x0 - 0.15, y + h, z0 - 0.15, x1 + 0.15, y + h + 0.25, z1 + 0.15, o.roof ?? 'roof', { faceMats: { ny: 'ceiling' } });
  if (o.floor !== null) k.flatDecal(x1 - x0 - 2 * t, z1 - z0 - 2 * t, o.floor ?? 'concrete', (x0 + x1) / 2, y + 0.02, (z0 + z1) / 2);
}

/** A solid block building (you cannot go in): walls all round, roof on top. */
function block(k: MapKit, x0: number, z0: number, x1: number, z1: number, h: number, mat: string, roof = 'roof', o: BrushOpts = {}): void {
  k.aabb(x0, 0, z0, x1, h, z1, mat, { ...o, faceMats: { py: roof, ...(o.faceMats ?? {}) } });
}

/** Low wall round the edge of a roof (top at y + h), open sides listed in `open`. */
function parapet(k: MapKit, x0: number, z0: number, x1: number, z1: number, y: number, h: number, mat: string, open: ('n' | 's' | 'e' | 'w')[] = []): void {
  const t = 0.25;
  if (!open.includes('n')) k.aabb(x0, y, z0, x1, y + h, z0 + t, mat);
  if (!open.includes('s')) k.aabb(x0, y, z1 - t, x1, y + h, z1, mat);
  if (!open.includes('w')) k.aabb(x0, y, z0 + t, x0 + t, y + h, z1 - t, mat);
  if (!open.includes('e')) k.aabb(x1 - t, y, z0 + t, x1, y + h, z1 - t, mat);
}

/** Invisible player-only clip along a stair side (the handrail you can't climb over). */
function sideClip(k: MapKit, x0: number, z0: number, x1: number, z1: number, y1: number): void {
  k.aabb(x0, 0, z0, x1, y1, z1, 'clip', { noRender: true, players: true, bullets: false, sight: false });
}

/** Railing along a segment (render rail + player-only clip, bullets and sight pass). */
function railing(k: MapKit, x0: number, z0: number, x1: number, z1: number, y: number, h = 1.0): void {
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  const lo = alongX ? Math.min(x0, x1) : Math.min(z0, z1);
  const hi = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
  if (alongX) {
    k.aabb(lo, y, z0 - 0.04, hi, y + h, z0 + 0.04, 'rail', { players: true, bullets: false, sight: false });
    k.trim(hi - lo, 0.06, 0.08, 'pipe', (lo + hi) / 2, y + h - 0.06, z0);
  } else {
    k.aabb(x0 - 0.04, y, lo, x0 + 0.04, y + h, hi, 'rail', { players: true, bullets: false, sight: false });
    k.trim(0.08, 0.06, hi - lo, 'pipe', x0, y + h - 0.06, (lo + hi) / 2);
  }
}

function crate(k: MapKit, x: number, z: number, s = 1.2, y = 0): void {
  k.box(s, s, s, 'crate', x, y, z, { uv: 'raw' });
}

function barrels(k: MapKit, pts: [number, number, string?][]): void {
  for (const [x, z, m] of pts) k.cyl(0.32, 0.9, 8, m ?? 'barrel', x, 0.45, z);
}

/** A jersey barrier (waist-high concrete cover). */
function jersey(k: MapKit, x: number, z: number, alongX: boolean, len = 2.4, y = 0): void {
  const [w, d] = alongX ? [len, 0.6] : [0.6, len];
  k.box(w, 0.95, d, 'barrier', x, y, z);
}

/** A shipping container (12.2 m by default) standing along x or z, optionally turned (render) by `ry`. */
function container(k: MapKit, x: number, z: number, alongX: boolean, mat: string, len = 6.1, y = 0): void {
  const [w, d] = alongX ? [len, 2.44] : [2.44, len];
  k.box(w, 2.6, d, mat, x, y, z);
}

/**
 * A container turned 45 degrees: rendered turned, colliding as a stair of small axis-aligned
 * boxes inside its footprint (close enough for cover and for walking round it).
 */
function turnedContainer(k: MapKit, cx: number, cz: number, ang: number, mat: string, len = 6.1, wid = 2.44): void {
  k.box(len, 2.6, wid, mat, cx, 0, cz, { ry: ang, collide: false });
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = -len / 2 + (len * (i + 0.5)) / n;
    // Local (a, 0) -> world, with a box of the slice's half extents.
    const x = cx + a * c;
    const z = cz - a * s;
    const hw = (len / n / 2) * Math.abs(c) + (wid / 2) * Math.abs(s);
    const hd = (len / n / 2) * Math.abs(s) + (wid / 2) * Math.abs(c);
    const sh = 0.72; // pull the slices in so the corners don't stick out
    k.aabb(x - hw * sh, 0, z - hd * sh, x + hw * sh, 2.6, z + hd * sh, mat, { noRender: true });
  }
}

/** A floodlight mast (render only above head height; the foot collides). */
function floodlight(k: MapKit, x: number, z: number, h: number, group = 'flood'): void {
  k.box(0.5, 1.2, 0.5, 'concreteDark', x, 0, z);
  k.trim(0.24, h - 1.2, 0.24, 'steel', x, 1.2, z);
  k.trim(2.6, 1.2, 0.5, 'steel', x, h, z);
  k.trim(2.2, 0.8, 0.12, 'lamp', x, h + 0.2, z + 0.26);
  k.glow(x, h + 0.6, z + 0.4, [1, 0.95, 0.8], 4, group);
  k.light(x, h - 1, z, [1.3, 1.2, 1.0], 22, group);
}

// ---------------------------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------------------------

const X = (u: number) => RX + u;

/** Holes in the apron for the flame trench: the trench under the rocket and the two ramps. */
const PIT_HOLES: [number, number, number, number][] = [
  [X(-6.6), -27.0, X(6.6), -15.5],
  [X(-PAD_HW), -24.75, X(-5.0), -21.0],
  [X(5.0), -24.75, X(PAD_HW), -21.0],
];

/**
 * The launch pad: flame trench (pit) under the rocket running west-east with ramps up to the two
 * corner entrances, the deck ring round the rocket opening, the stairs up from the corners to the
 * walkway behind the rocket, and the two stair towers with their balconies.
 */
function launchPad(k: MapKit): void {
  const P = L.pit;
  const D = L.deck;
  // Pit floor (the ground has holes here, see PIT_HOLES) and the ramps up to the corner entrances.
  for (const [x0, z0, x1, z1] of PIT_HOLES) k.aabb(x0, P - 1, z0, x1, P, z1, 'slab');
  for (const s of [-1, 1] as const) {
    const [u0, u1] = s < 0 ? [-PAD_HW, -5.0] : [5.0, PAD_HW];
    k.ramp(X(u0), P, -24.75, X(u1), 0, -21.0, s < 0 ? '-x' : '+x', 'slab');
    // Hazard edges on the ramp sides.
    k.trim(Math.abs(u1 - u0), 0.05, 0.25, 'hazard', X((u0 + u1) / 2), 0.0, -21.1);
  }
  // Flame deflector: a red ridge running west-east under the nozzles.
  k.ramp(X(-3.2), P, -24.2, X(3.2), P + 1.0, -22.1, '+z', 'red');
  k.ramp(X(-3.2), P, -22.1, X(3.2), P + 1.0, -20.0, '-z', 'red');
  // Trench walls below the deck at the north and south (concrete, sooty), lights in the trench.
  k.flatDecal(2 * PAD_HW - 0.2, 0.6, 'hazard', RX, P + 0.02, -15.9);
  k.light(X(0), P + 2.4, -18.0, [1.4, 0.6, 0.4], 9, 'pit');
  k.light(X(-7), P + 2.2, -22.6, [1.3, 1.0, 0.7], 7, 'pit');
  k.light(X(7), P + 2.2, -22.6, [1.3, 1.0, 0.7], 7, 'pit');

  // Deck ring at D (slabs 0.4 thick) round the opening |u| < 4.6, z -27 .. -17.2.
  const slab = (u0: number, z0: number, u1: number, z1: number) => k.aabb(X(u0), D - 0.4, z0, X(u1), D, z1, 'slab', { faceMats: { ny: 'concreteDark' } });
  // North: the walkway behind the rocket (solid down to the ground), the strip north of the stairs.
  k.aabb(X(-PAD_HW), 0, -31.6, X(PAD_HW), D, -29.1, 'concrete', { faceMats: { py: 'slab' } });
  k.aabb(X(-5.2), 0, -29.1, X(5.2), D, -27.0, 'concrete', { faceMats: { py: 'slab' } });
  // Sides over the ramps; the deck stays open over the corner landings (z -26.6 .. -25.6) so you
  // can climb from the landing onto the stairs, with a rail round the opening.
  slab(-PAD_HW + 0.4, -25.6, -5.2, -21.0);
  slab(5.2, -25.6, PAD_HW - 0.4, -21.0);
  railing(k, X(-PAD_HW + 0.4), -25.6, X(-5.2), -25.6, D, 1.0);
  railing(k, X(5.2), -25.6, X(PAD_HW - 0.4), -25.6, D, 1.0);
  slab(-5.2, -27.0, -4.6, -17.2);
  slab(4.6, -27.0, 5.2, -17.2);
  slab(-6.6, -21.0, -5.2, -17.2);
  slab(5.2, -21.0, 6.6, -17.2);
  // South strip between the towers, meeting the track.
  slab(-6.6, -17.2, 6.6, -15.5);
  // Railing round the opening (you can still jump it and drop into the trench).
  railing(k, X(-4.6), -27.0, X(4.6), -27.0, D, 1.0);
  railing(k, X(-4.6), -17.2, X(-1.2), -17.2, D, 1.0);
  railing(k, X(1.2), -17.2, X(4.6), -17.2, D, 1.0);
  railing(k, X(-4.6), -27.0, X(-4.6), -17.2, D, 1.0);
  railing(k, X(4.6), -27.0, X(4.6), -17.2, D, 1.0);
  // The pad's ring and the yellow edge (decals on the deck).
  k.flatDecal(11.4, 0.3, 'yellow', RX, D + 0.02, -27.4);
  k.flatDecal(11.4, 0.3, 'yellow', RX, D + 0.02, -16.8);

  // Stairs from each corner landing up to the walkway behind the rocket.
  k.stairs(X(-9.2), 0, -29.1, X(-5.2), D, -26.6, '+x', 'stairs', 11);
  k.stairs(X(5.2), 0, -29.1, X(9.2), D, -26.6, '-x', 'stairs', 11);

  // Pad walls: north edge (with the red pipes along it), the sides with the corner entrances.
  k.aabb(X(-PAD_HW), D, -31.6, X(PAD_HW), D + 1.1, -31.3, 'concrete');
  k.cyl(0.25, 2 * PAD_HW, 8, 'red', RX, D + 0.5, -31.0, { axis: 'x', collide: false });
  k.cyl(0.18, 2 * PAD_HW, 8, 'red', RX, D + 0.95, -31.0, { axis: 'x', collide: false });
  for (const s of [-1, 1] as const) {
    const xw = X(s * (PAD_HW - 0.2));
    // North of the entrance: wall from the ground to the deck rail.
    k.aabb(xw - 0.2, 0, -31.6, xw + 0.2, D + 1.1, -24.75, 'concrete');
    // South of the towers: the pad's side wall, on down to the main yard, red pipes along it.
    k.aabb(xw - 0.2, 0, -15.5, xw + 0.2, 4.0, -10.2, 'concrete');
    k.cyl(0.2, 5.3, 8, 'red', xw - s * 0.45, 2.9, -12.85, { axis: 'z', collide: false });
    k.cyl(0.14, 5.3, 8, 'pipe', xw - s * 0.42, 3.4, -12.85, { axis: 'z', collide: false });
    k.wallDecal(1.2, 0.9, 'sign', xw - s * 0.21, 1.4, -12.0, -s * PI / 2, { uv: 'raw' });
    // Lintel over the entrance (the deck edge).
    k.aabb(xw - 0.2, D - 0.4, -24.75, xw + 0.2, D + 1.1, -21.0, 'concrete');
    k.light(xw - s * 1.2, 1.9, -22.6, [1.3, 1.1, 0.8], 7, 'lamp');
    k.trim(0.3, 0.2, 0.3, 'lamp', xw - s * 0.4, 1.95, -22.6);
    // Corner landing hazard paint.
    k.flatDecal(3.6, 1.6, 'hazard', X(s * 8.4), 0.02, -25.6);
  }

  // Stair towers ("winding staircases") on the deck, south-west and south-east of the rocket.
  for (const s of [-1, 1] as const) tower(k, s);

  // Clamp arms from the deck edge up to the rocket (render only).
  for (const [du, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    k.trim(1.8, 0.5, 0.5, 'green', X(du * 3.7), D - 0.2, RZ + dz * 2.5);
    k.trim(0.5, 1.2, 0.5, 'green', X(du * 4.4), D, RZ + dz * 2.5);
  }
  rocket(k);
}

/**
 * One stair tower (s = -1 west, +1 east) standing on the deck: a door from the deck into a bottom
 * landing, flight 1 up the outer lane to the north landing, flight 2 back down the inner lane to
 * the top floor, and out through the south wall onto the balcony (the "staircase sniper" ledge
 * that looks down the main road towards both spawns).
 */
function tower(k: MapKit, s: -1 | 1): void {
  const D = L.deck;
  const T = L.tower;
  const M = L.towerLanding;
  const ui = 6.6; // inner face (on the deck)
  const uo = PAD_HW; // outer face (the pad wall line)
  const z0 = -21.0;
  const z1 = -15.5;
  const t = 0.25;
  const xs = (a: number, b: number): [number, number] => [Math.min(X(s * a), X(s * b)), Math.max(X(s * a), X(s * b))];
  const [xa, xb] = xs(ui, uo);
  // Solid base up to the deck.
  k.aabb(xa, 0, z0, xb, D, z1, 'concrete', { faceMats: { py: 'grate' } });
  // Walls (inside the footprint): inner with the deck door and a window at the landing, outer
  // with a window at the top, north, and south with the opening onto the balcony.
  const H = T + 2.6;
  const fl0 = -16.8; // flights run between fl0 and fl1
  const fl1 = -19.6;
  const [wi0, wi1] = xs(ui, ui + t);
  const [wo0, wo1] = xs(uo - t, uo);
  k.wall('z', z0, z1, (wi0 + wi1) / 2, D, H - D, t, 'corr', [door(-16.28, 1.0, 2.3), { a0: -19.6, a1: -18.0, y0: M - D + 1.0, y1: M - D + 2.0 }]);
  k.wall('z', z0, z1, (wo0 + wo1) / 2, D, H - D, t, 'corr', [{ a0: -19.3, a1: -17.3, y0: T - D + 1.0, y1: T - D + 2.1 }]);
  k.wall('x', xa + t, xb - t, z0 + t / 2, D, H - D, t, 'corr', []);
  k.wall('x', xa + t, xb - t, z1 - t / 2, D, H - D, t, 'corr', [{ a0: xa + t + 0.1, a1: xb - t - 0.1, y0: T - D, y1: T - D + 2.3 }]);
  k.aabb(xa - 0.2, H, z0 - 0.2, xb + 0.2, H + 0.2, z1 + 0.2, 'roof', { faceMats: { ny: 'ceiling' } });
  // Flights: outer lane rising north (D -> M), inner lane rising south (M -> T).
  const uMid = 8.5;
  const [o0, o1] = xs(uMid + 0.06, uo - t);
  const [i0, i1] = xs(ui + t, uMid);
  k.stairs(o0, D, fl1, o1, M, fl0, '-z', 'stairs', 9);
  k.aabb(xa + t, M - 0.2, z0 + t, xb - t, M, fl1, 'grate', { faceMats: { ny: 'steel' } });
  k.stairs(i0, M, fl1, i1, T, fl0, '+z', 'stairs', 9);
  k.aabb(xa + t, T - 0.2, fl0, xb - t, T, z1 - t, 'grate', { faceMats: { ny: 'steel' } });
  // Partition between the lanes (a rail, so you can see across), from the deck to the top.
  const [p0, p1] = xs(uMid, uMid + 0.06);
  k.aabb(p0, D, fl1, p1, T + 1.0, fl0, 'rail', { players: true, bullets: false, sight: false });
  // Balcony south of the tower at T over the pad-side yard: solid parapet south and outside, a
  // rail on the inner (deck) side.
  const [b0, b1] = xs(ui, uo);
  k.aabb(b0, T - 0.25, z1, b1, T, -12.5, 'grate', { faceMats: { ny: 'steel' } });
  k.aabb(b0, T, -12.75, b1, T + 1.0, -12.5, 'corr');
  const [po0, po1] = xs(uo - 0.25, uo);
  k.aabb(po0, T, z1, po1, T + 1.0, -12.75, 'corr');
  const [pi0, pi1] = xs(ui, ui + 0.1);
  k.aabb(pi0, T, z1, pi1, T + 1.0, -12.75, 'rail', { players: true, bullets: false, sight: false });
  // Struts under the balcony.
  for (const u of [ui + 0.2, uo - 0.2]) k.box(0.25, T - 0.25, 0.25, 'steel', X(s * u), 0, -12.9);
  k.light(X(s * 8.5), T + 1.8, -17.8, [1.3, 1.1, 0.8], 7, 'lamp');
  k.light(X(s * 8.5), D + 1.8, -18.2, [1.3, 1.1, 0.8], 6, 'lamp');
}

/** The Soyuz on the pad (props; the core and boosters stop bullets). */
function rocket(k: MapKit): void {
  const x = RX;
  const z = RZ;
  const base = 1.6;
  // Core stage, second stage, payload fairing and escape tower.
  k.cyl(1.45, 28.5, 12, 'rocket', x, base + 14.25, z);
  k.cyl(1.32, 7.0, 12, 'rocket', x, base + 32.0, z);
  k.cyl(1.5, 6.4, 12, 'rocket', x, base + 38.7, z);
  k.cyl(1.0, 2.0, 10, 'rocket', x, base + 42.9, z, { collide: false });
  k.cyl(0.55, 1.6, 8, 'rocket', x, base + 44.7, z, { collide: false });
  k.cyl(0.12, 3.0, 6, 'steel', x, base + 47.0, z, { collide: false });
  // Four boosters round the core, tapering to their tips.
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const bx = x + dx * 1.75;
    const bz = z + dz * 1.75;
    k.cyl(1.05, 17.0, 10, 'booster', bx, base + 8.5, bz);
    k.cyl(0.72, 3.0, 10, 'booster', bx, base + 18.5, bz, { collide: false });
    k.cyl(0.36, 2.0, 8, 'booster', bx, base + 21.0, bz, { collide: false });
    // Nozzle skirts hanging into the trench.
    k.cyl(0.75, 0.9, 8, 'steel', bx, base - 0.45, bz, { collide: false });
  }
  k.cyl(0.9, 0.9, 8, 'steel', x, base - 0.45, z, { collide: false });
  // CCCP down the side facing the track (a flat card just off the core).
  k.wallDecal(1.1, 5.6, 'cccp', x, base + 13, z + 1.5, 0, { uv: 'raw', seg: 1 });
}

/**
 * The gantry towers either side of the rocket and the erector arm, outside the play space
 * (scenery: the lattice and the service levels you see from everywhere).
 */
function gantry(k: MapKit): void {
  for (const s of [-1, 1] as const) {
    const cx = X(s * 7.5);
    const cz = -38.5;
    const h = 46;
    // Lattice skin round a dark core, service platforms every 6 m.
    k.box(6.0, h, 6.0, 'greenDark', cx, 0, cz, { collide: false, hide: ['ny'] });
    k.box(7.0, h - 2, 7.0, 'lattice', cx, 0, cz, { collide: false, hide: ['ny', 'py'] });
    for (let y = 6; y < h; y += 6) {
      k.trim(9.0, 0.3, 8.0, 'grate', cx + s * 0.8, y, cz + 0.6);
      k.trim(9.0, 1.0, 0.06, 'rail', cx + s * 0.8, y + 0.3, cz + 4.6);
    }
    // Arms reaching over the rocket.
    for (const y of [14, 26, 36]) k.trim(4.6, 1.2, 2.4, 'green', X(s * 3.2), y, -31.5);
    // Diagonal braces (turned boxes) at the foot.
    k.trim(0.6, 14, 0.6, 'green', cx + s * 4.5, 0, cz + 2, { ry: 0.0 });
    k.glow(cx, h + 0.8, cz, [1, 0.25, 0.2], 1.6, 'beacon', true);
  }
  // The orange erector arm lying back from the pad over the north wall (lowered).
  k.box(3.0, 2.4, 30, 'orange', RX, 8, -48, { collide: false, ry: 0 });
  k.trim(2.4, 6.0, 2.0, 'orange', RX, 2, -35);
  // Service building behind the pad.
  k.aabb(X(-20), 0, -48, X(-12), 7, -36, 'wall', { collide: false, faceMats: { py: 'roof' } });
  k.aabb(X(12), 0, -48, X(22), 9, -38, 'wall', { collide: false, faceMats: { py: 'roof' } });
}

/** The raised rail embankment south of the pad with its concrete inclines and the missile cars. */
function track(k: MapKit): void {
  const D = L.deck;
  const top = 2.6;
  const foot = 5.6;
  const z0 = -15.5;
  const z1 = 21.0;
  // Top and the two inclines (wedges rising towards the middle).
  k.aabb(X(-top), 0, z0, X(top), D, z1, 'concrete', { faceMats: { py: 'slab' } });
  k.ramp(X(-foot), 0, z0, X(-top), D, z1, '+x', 'slab');
  k.ramp(X(top), 0, z0, X(foot), D, z1, '-x', 'slab');
  // South end: the top runs down to the road; the buffer stop at the south edge.
  k.ramp(X(-top), 0, z1, X(top), D, 26.0, '-z', 'slab');
  k.aabb(X(-2.6), 0, 26.1, X(2.4), 1.4, 28.4, 'concreteDark', { faceMats: { py: 'hazard' } });
  // Rails and sleepers, yellow lines down the inclines, drain grates at the foot.
  k.flatDecal(2.2, z1 - z0, 'rails', X(-0.1), D + 0.02, (z0 + z1) / 2, { seg: 8, uv: 'raw' });
  for (const s of [-1, 1] as const) {
    k.flatDecal(0.6, z1 - z0, 'grate', X(s * 6.0), 0.02, (z0 + z1) / 2, { seg: 8 });
    // Lamp posts on the top edge (render only: they stand on the incline's shoulder).
    for (const z of [-11.5, 19.8]) {
      k.trim(0.2, 4.2, 0.2, 'steel', X(s * 2.75), D, z);
      k.trim(0.6, 0.2, 0.3, 'lamp', X(s * 2.5), D + 4.0, z);
    }
    k.box(0.2, 4.2, 0.2, 'steel', X(s * 3.0), 0, 24.0);
  }
  k.light(X(0), D + 4, -11.5, [1.3, 1.15, 0.85], 10, 'lamp');
  k.light(X(0), D + 4, 19.8, [1.3, 1.15, 0.85], 10, 'lamp');
  // Concrete blocks on the top (cover crossing the track).
  jersey(k, X(-1.2), -11.0, true, 2.0, D);
  jersey(k, X(1.0), -8.4, true, 2.0, D);
  jersey(k, X(0.6), 8.6, true, 2.4, D);
  jersey(k, X(-1.0), 19.5, true, 2.0, D);

  // The big missile car at the middle (on the Main Road crossing): a green tracked transporter,
  // its orange erector cradle on top; a ladder at its north end (you can climb on it).
  const cz0 = -5.2;
  const cz1 = 3.8;
  k.aabb(X(-2.5), D + 0.9, cz0, X(2.4), L.car, cz1, 'green', { faceMats: { py: 'grate' } });
  for (const s of [-1, 1] as const) {
    k.aabb(s < 0 ? X(-2.5) : X(1.7), D, cz0 + 0.3, s < 0 ? X(-1.8) : X(2.4), D + 0.9, cz1 - 0.3, 'rubber', { faceMats: { py: 'greenDark' } });
    for (let z = cz0 + 1; z < cz1; z += 1.6) k.cyl(0.42, 0.6, 8, 'steel', s < 0 ? X(-2.2) : X(2.1), D + 0.45, z, { axis: 'x', collide: false });
  }
  k.aabb(X(-1.8), D, cz0 + 0.3, X(1.7), D + 0.9, cz1 - 0.3, 'greenDark');
  // The erector cradle: two orange beams along the car's top edges (waist-high cover up there).
  for (const s of [-1, 1] as const) k.box(0.5, 0.7, 8.4, 'orange', X(s * 1.95 - 0.05), L.car, (cz0 + cz1) / 2 + 0.2);
  k.box(4.4, 0.3, 0.5, 'orange', X(-0.05), L.car + 0.7, cz1 - 0.6, { collide: false });
  // Ladder (a steep clip ramp) up the north end.
  k.ramp(X(-0.5), D, cz0 - 1.3, X(0.4), L.car, cz0, '+z', 'clip', { noRender: true, players: true, bullets: false, sight: false, tag: 'stairs' });
  for (let y = D + 0.35; y < L.car; y += 0.35) k.trim(0.9, 0.05, 0.06, 'steel', X(-0.05), y, cz0 - 0.05);
  k.trim(0.06, L.car - D + 1.0, 0.06, 'steel', X(-0.5), D, cz0 - 0.06);
  k.trim(0.06, L.car - D + 1.0, 0.06, 'steel', X(0.4), D, cz0 - 0.06);
  railing(k, X(-2.5), cz1 - 0.1, X(2.4), cz1 - 0.1, L.car, 0.9);
  k.light(X(0), L.car + 3, -0.6, [1.2, 1.1, 0.8], 8, 'lamp');
  // The second car further south (three tank compartments, lower).
  const dz0 = 13.0;
  const dz1 = 17.5;
  k.aabb(X(-2.5), D, dz0, X(2.4), D + 0.6, dz1, 'greenDark');
  for (let i = 0; i < 3; i++) k.cyl(0.78, 1.4, 10, 'tankH', X(-1.7 + i * 1.65), D + 1.4, (dz0 + dz1) / 2, { axis: 'z' });
  k.trim(5.0, 0.15, 0.15, 'steel', X(-0.05), D + 2.3, dz0 + 0.2);
}

/** The west checkpoint (team 0 spawn): gate, guard booth, fences and barriers. */
function westCheckpoint(k: MapKit): void {
  // Gate on the west edge, the barrier arm, booth.
  k.aabb(-65.6, 0, -4.0, -65.3, 3.2, -1.2, 'concrete');
  k.aabb(-65.6, 0, 4.2, -65.3, 3.2, 7.0, 'concrete');
  k.wallDecal(5.4, 3.0, 'fence', -65.45, 0, 1.5, PI / 2);
  k.trim(0.12, 0.12, 5.2, 'hazard', -64.6, 1.0, 1.5);
  k.box(0.4, 1.1, 0.4, 'concreteDark', -64.6, 0, -1.4);
  hall(k, -55.2, -3.6, -51.8, -1.4, 2.6, 'wallWhite', { s: [door(-52.6, 0.9)], e: [win(-3.2, -1.8)], w: [win(-3.2, -1.8)], roof: 'roofRed' });
  k.light(-53.5, 2.3, -2.5, [1.2, 1.1, 0.8], 6, 'lamp');
  // Barriers and crates in the yard.
  jersey(k, -60.5, 4.8, true, 2.4);
  jersey(k, -57.0, -0.8, false, 2.4);
  crate(k, -63.8, 5.6, 1.2);
  crate(k, -62.6, 5.8, 1.0);
  k.box(4.85, 1.4, 2.35, 'green', -51.7, 0, 9.4); // parked tracked trailer (W5)
  k.box(4.4, 0.4, 2.0, 'steel', -51.7, 1.4, 9.4, { collide: false });
  barrels(k, [[-49.0, 6.2], [-48.4, 6.6, 'barrelRed']]);
  floodlight(k, -64.6, -3.2, 9);
  floodlight(k, -56.4, 6.4, 9);
  // Guard hut (the L-shaped hut west of the Warehouse).
  block(k, -47.4, 3.0, -45.2, 7.75, 2.6, 'wall');
  block(k, -45.2, 5.6, -43.3, 7.75, 2.6, 'wall');
  k.wallDecal(1.4, 1.0, 'sign', -46.3, 1.2, 2.98, PI, { uv: 'raw' });
}

/** Offices: the block north of the main road beside the west yard, and its sheds. */
function offices(k: MapKit): void {
  hall(k, -47.9, -9.4, -40.5, -1.3, 3.5, 'wall', { s: [door(-44.2), win(-46.8, -45.6)], e: [door(-5.4), win(-8.4, -7.0)], n: [win(-46.0, -44.6, 1.5, 2.3)], roof: 'roof' });
  k.wall('z', -9.1, -1.6, -44.2, 0, 3.5, 0.2, 'wall', [door(-6.4, 1.2)]);
  k.box(2.0, 0.85, 0.9, 'steel', -46.4, 0, -8.4);
  k.box(1.6, 0.8, 0.8, 'concreteDark', -41.6, 0, -3.0);
  k.light(-46, 3.0, -5.4, [1.2, 1.1, 0.8], 6, 'lamp');
  k.light(-42.3, 3.0, -5.4, [1.2, 1.1, 0.8], 6, 'lamp');
  // Covered passage east of the offices (roof on posts) and the corrugated shed beyond.
  k.aabb(-40.5, 3.0, -9.4, -38.0, 3.2, -1.3, 'roof', { faceMats: { ny: 'ceiling' } });
  for (const z of [-9.1, -1.6]) k.box(0.2, 3.0, 0.2, 'steel', -38.1, 0, z);
  block(k, -38.0, -5.0, -33.8, -1.3, 3.2, 'corr');
  block(k, -37.4, -9.4, -34.3, -7.8, 1.6, 'steel'); // generator
  // Turned shed in the boundary notch.
  k.box(5.0, 3.0, 3.0, 'corrRust', -30.5, 0, -10.0, { ry: PI / 4, collide: false });
  k.aabb(-31.8, 0, -11.2, -29.2, 3.0, -8.8, 'corrRust', { noRender: true });
  barrels(k, [[-33.0, -6.4], [-32.4, -7.0, 'barrelRed']]);
  crate(k, -31.2, -3.4, 1.1);
}

/** The Warehouse south of the main road (west), and the Containers yard south of it. */
function warehouse(k: MapKit): void {
  hall(k, -39.6, 1.2, -28.6, 10.9, 5.5, 'corr', {
    n: [door(-35.6, 1.6, 2.6), win(-32.4, -30.2, 2.6, 3.6)],
    s: [door(-33.4, 1.6, 2.6)],
    e: [{ a0: 4.4, a1: 7.6, y0: 0, y1: 3.4 }],
    w: [win(4.0, 6.0, 2.6, 3.6)],
    roof: 'roof',
  });
  k.wallDecal(3.2, 3.4, 'shutter', -28.42, 3.4, 6.0, PI / 2, { uv: 'raw' });
  k.box(2.4, 1.6, 1.2, 'crate', -37.4, 0, 3.0, { uv: 'raw' });
  k.box(1.2, 2.4, 3.6, 'steel', -38.8, 0, 8.0);
  crate(k, -31.0, 9.6, 1.2);
  crate(k, -31.0, 9.6, 1.0, 1.2);
  k.box(3.0, 0.9, 1.2, 'steel', -32.6, 0, 4.2);
  k.light(-34, 4.8, 4.0, [1.2, 1.1, 0.8], 8, 'lamp');
  k.light(-34, 4.8, 8.4, [1.2, 1.1, 0.8], 8, 'lamp');
  // Containers yard (Domination A): containers making lanes, the turned one by the Centrifuge.
  container(k, -34.0, 14.6, false, 'container2');
  container(k, -30.2, 12.6, true, 'container0', 6.1);
  turnedContainer(k, -27.8, 21.35, -PI / 4, 'container4', 7.4, 2.5);
  crate(k, -31.4, 17.6, 1.2);
  crate(k, -30.3, 17.9, 1.0);
  barrels(k, [[-36.8, 18.4], [-36.2, 18.9]]);
  jersey(k, -25.0, 24.4, true, 2.4);
}

/** The Stairs Roof building on the south-west edge, reached by outside stairs from the north. */
function stairsRoof(k: MapKit): void {
  const R = L.stairsRoof;
  block(k, -44.0, 14.3, -35.2, 19.6, R, 'wallWhite', 'slab');
  parapet(k, -44.0, 14.3, -35.2, 19.6, R, 0.9, 'wallWhite', ['w']);
  k.stairs(-48.9, 0, 12.0, -46.4, R, 17.4, '+z', 'stairs', 14);
  k.aabb(-49.25, 0, 17.4, -44.0, R, 19.6, 'concrete', { faceMats: { py: 'grate' } });
  sideClip(k, -46.4, 12.0, -46.2, 17.4, R + 1.0);
  k.trim(0.08, 0.08, 6.6, 'pipe', -46.3, R * 0.55 + 1.0, 15.2);
  k.aabb(-49.25, R, 19.3, -44.0, R + 0.9, 19.6, 'wallWhite');
  // AC units on the roof (cover).
  k.box(1.6, 1.0, 1.2, 'steel', -40.6, R, 16.2);
  k.box(1.2, 0.8, 1.2, 'steel', -37.4, R, 17.6);
  k.wallDecal(2.0, 2.0, 'star', -39.6, 0.6, 14.28, PI, { uv: 'raw' });
  crate(k, -45.0, 10.4, 1.1);
}

/** The west-centre buildings north of the Centrifuge, between the Warehouse and the track. */
function westCentre(k: MapKit): void {
  // CW1: the long block north of the main road against the pad's west wall.
  block(k, -15.0, -9.3, -6.0, -2.9, 4.5, 'wall', 'roof');
  block(k, -12.1, -10.2, -10.6, -9.3, 2.2, 'steel');
  k.wallDecal(1.6, 1.0, 'sign', -10.6, 1.4, -2.88, 0, { uv: 'raw' });
  // CW3a: the two-door shed south of the main road, CW3b the red-roofed store beside it,
  // and the lean-to roof south of them (HQ).
  hall(k, -24.9, -1.3, -16.1, 5.5, 4.5, 'wall', { n: [door(-21.0)], e: [door(2.0)], w: [door(2.4), win(-0.4, 0.8)], s: [{ a0: -23.6, a1: -20.4, y0: 0, y1: 2.6 }], roof: 'roof' });
  block(k, -16.1, -1.6, -12.1, 8.2, 3.6, 'corr', 'roofRed');
  k.aabb(-24.4, 3.0, 5.5, -16.1, 3.2, 10.0, 'roof', { faceMats: { ny: 'ceiling' } });
  for (const x of [-24.2, -20.2, -16.3]) k.box(0.2, 3.0, 0.2, 'steel', x, 0, 9.8);
  k.box(2.4, 0.9, 1.0, 'crate', -21.6, 0, 7.4, { uv: 'raw' });
  barrels(k, [[-17.4, 9.0], [-17.0, 8.3, 'barrelRed']]);
  k.light(-20.5, 2.6, 7.8, [1.2, 1.05, 0.8], 7, 'lamp');
  k.light(-20.5, 3.8, 2.0, [1.2, 1.05, 0.8], 6, 'lamp');
  // CW2: the narrow red-roofed shed beside the track's west incline.
  block(k, -10.0, -1.2, -7.5, 6.9, 3.5, 'corrRust', 'roofRed');
  // Jersey barriers along the main road.
  jersey(k, -27.0, -0.2, false, 2.4);
  jersey(k, -11.2, 8.6, true, 2.4);
}

/** The Centrifuge: the big hall south-west of the track, with the drum, the arm and a catwalk. */
function centrifuge(k: MapKit): void {
  const x0 = -23.0;
  const x1 = -9.0;
  const z0 = 10.25;
  const z1 = 19.6;
  const H = 7.0;
  const C = L.catwalk;
  hall(k, x0, z0, x1, z1, H, 'wall', {
    t: 0.35,
    n: [door(-19.6, 1.6, 2.6), door(-12.6, 1.6, 2.6), win(-22.2, -20.8, 3.7, 5.4), win(-17.6, -15.2, 3.7, 5.4), win(-11.0, -9.8, 3.7, 5.4)],
    s: [door(-20.4, 1.6, 2.6), door(-13.4, 1.6, 2.6), win(-17.6, -15.6, 1.2, 2.2)],
    e: [door(11.25, 1.1, 2.4)],
    w: [door(13.65, 1.4, 2.4)],
    roof: 'roof',
  });
  // West entry porch.
  k.aabb(-27.7, 2.8, 12.4, x0, 3.0, 14.9, 'roof', { faceMats: { ny: 'ceiling' } });
  k.box(0.2, 2.8, 0.2, 'steel', -27.5, 0, 12.6);
  k.box(0.2, 2.8, 0.2, 'steel', -27.5, 0, 14.7);
  // The drum and the arm with its capsule (the arm is overhead; the drum and capsule stop you).
  const cx = -14.6;
  const cz = 15.6;
  k.flatDecal(8.4, 8.4, 'hazard', cx, 0.03, cz, { seg: 2 });
  k.cyl(1.3, 3.2, 12, 'steel', cx, 1.6, cz);
  k.cyl(0.9, 0.8, 10, 'red', cx, 3.6, cz, { collide: false });
  k.trim(8.6, 0.6, 0.7, 'steel', cx - 0.6, 3.0, cz);
  k.box(1.8, 2.0, 1.8, 'wallWhite', cx - 4.6, 1.2, cz);
  k.box(1.2, 1.2, 1.2, 'steel', cx + 3.8, 2.4, cz, { collide: false });
  // Catwalk along the north wall, stairs up the east side.
  k.aabb(x0 + 0.35, C - 0.2, z0 + 0.35, x1 - 0.35, C, 12.2, 'grate', { faceMats: { ny: 'steel' } });
  railing(k, x0 + 0.35, 12.2, -11.0, 12.2, C, 1.0);
  k.stairs(-10.9, 0, 12.2, -9.35, C, 17.8, '-z', 'stairs', 14);
  sideClip(k, -11.05, 12.2, -10.9, 17.8, C + 1.0);
  for (const x of [-21.0, -16.6, -12.2]) k.box(0.2, C - 0.2, 0.2, 'steel', x, 0, 12.1);
  // Control desks and cabinets.
  k.box(3.0, 0.9, 0.8, 'steel', -20.0, 0, 18.6);
  k.box(0.8, 2.0, 2.4, 'steel', -22.3, 0, 16.6);
  k.box(1.4, 1.0, 0.8, 'crate', -11.4, 0, 14.0, { uv: 'raw' });
  k.light(-19, 6.2, 15.0, [1.25, 1.1, 0.85], 10, 'lamp');
  k.light(-12, 6.2, 15.0, [1.25, 1.1, 0.85], 10, 'lamp');
  k.light(-16, C + 2.0, 11.2, [1.2, 1.0, 0.75], 6, 'lamp');
  // The guard house on the south edge, the small store by the track.
  block(k, -15.0, 25.25, -9.4, 31.8, 3.5, 'wallWhite', 'roof');
  block(k, -12.5, 19.9, -9.6, 22.3, 2.5, 'corr', 'roof');
  k.cyl(0.25, 3.0, 8, 'pipe', -16.6, 0.6, 28.8, { axis: 'x' });
  barrels(k, [[-17.6, 24.0], [-18.2, 23.4, 'barrelRed']]);
  jersey(k, -7.2, 24.2, false, 2.4);
}

/** Control: the two-storey building north-east of the track, the low roofs south of it. */
function control(k: MapKit): void {
  const U = L.control;
  const x0 = 10.0;
  const x1 = 21.7;
  const z0 = -9.2;
  const z1 = -1.9;
  const H = 7.0;
  const t = 0.3;
  const up = (a0: number, a1: number) => win(a0, a1, U + 1.0, U + 2.2);
  // Walls: ground doors west (pad yard), east (C4) and north (NE corridor); upper doors south onto
  // the low roofs; upper windows all round (the long views over the track and C4).
  k.wall('x', x0, x1, z0 + t / 2, 0, H, t, 'wallWhite', [door(12.0), win(17.4, 19.6), up(11.0, 13.4), up(16.6, 20.4)]);
  k.wall('x', x0, x1, z1 - t / 2, 0, H, t, 'wallWhite', [door(12.4, 1.4, 2.3, U), door(17.5, 1.6, 2.3, U), win(19.2, 20.8)]);
  k.wall('z', z0 + t, z1 - t, x0 + t / 2, 0, H, t, 'wallWhite', [door(-5.2), up(-8.4, -7.0), up(-4.6, -2.6)]);
  k.wall('z', z0 + t, z1 - t, x1 - t / 2, 0, H, t, 'wallWhite', [door(-4.4), up(-7.8, -6.2), up(-4.4, -2.8)]);
  k.aabb(x0 - 0.15, H, z0 - 0.15, x1 + 0.15, H + 0.3, z1 + 0.15, 'roof', { faceMats: { ny: 'ceiling' } });
  k.flatDecal(x1 - x0 - 2 * t, z1 - z0 - 2 * t, 'concrete', (x0 + x1) / 2, 0.02, (z0 + z1) / 2);
  // Upper floor round the stairwell along the north wall; the stairs rise west.
  const sw0 = 13.8;
  const swz = -7.4;
  k.aabb(x0 + t, U - 0.25, swz, x1 - t, U, z1 - t, 'slab', { faceMats: { ny: 'ceiling' } });
  k.aabb(x0 + t, U - 0.25, z0 + t, sw0, U, swz, 'slab', { faceMats: { ny: 'ceiling' } });
  k.stairs(sw0, 0, z0 + t, x1 - t, U, swz, '-x', 'stairs', 16);
  railing(k, sw0, swz, x1 - t, swz, U, 1.0);
  // Inside: desks and consoles (the launch control room), lockers.
  k.box(4.0, 0.9, 0.9, 'steel', 13.6, 0, -3.0);
  k.box(0.8, 1.8, 2.2, 'steel', 20.9, 0, -4.0);
  k.box(3.2, 1.0, 0.8, 'steel', 15.6, U, -2.8);
  k.box(0.8, 1.0, 2.2, 'steel', 11.0, U, -5.0);
  k.light(15.8, U - 0.6, -5.5, [1.2, 1.1, 0.85], 7, 'lamp');
  k.light(15.8, H - 0.6, -4.5, [1.2, 1.1, 0.85], 7, 'lamp');
  k.wallDecal(2.4, 2.4, 'star', x1 + 0.02, 4.2, -5.5, PI / 2, { uv: 'raw' });
  // The low blocks south of it; their roofs (at U) join the upper floor's south doors.
  block(k, 10.0, -1.9, 16.5, 7.75, U, 'corr', 'slab');
  block(k, 16.5, -1.9, 23.6, 5.25, U, 'corr', 'slab');
  k.aabb(10.0, U, -1.9, 10.25, U + 0.6, 7.75, 'corr');
  k.aabb(10.25, U, 7.5, 16.5, U + 0.6, 7.75, 'corr');
  k.aabb(23.35, U, -1.9, 23.6, U + 0.6, 5.0, 'corr');
  k.aabb(18.4, U, 5.0, 23.6, U + 0.6, 5.25, 'corr');
  k.box(1.6, 1.0, 1.2, 'steel', 13.2, U, 3.0);
  // Outside stairs (the scaffold) from the yard up to the roofs, landing at x 16.6 .. 18.4.
  k.stairs(16.6, 0, 5.25, 18.4, U, 11.0, '-z', 'stairs', 16);
  sideClip(k, 16.45, 7.75, 16.6, 11.0, U + 1.0);
  sideClip(k, 18.4, 5.25, 18.55, 11.0, U + 1.0);
  for (const z of [7.0, 9.6]) for (const x of [16.5, 18.5]) k.trim(0.12, U * (1 - (z - 5.25) / 5.75) + 1.0, 0.12, 'steel', x, 0, z);
  // E10: the block west of the control building by the track, the two pillars and the canopy.
  block(k, 5.5, -6.6, 9.9, -1.0, 4.0, 'wall', 'roof');
  block(k, 5.0, 0.0, 7.1, 2.1, 4.0, 'concrete', 'concrete');
  block(k, 5.0, 5.25, 7.1, 7.3, 4.0, 'concrete', 'concrete');
  k.aabb(5.0, 4.0, -1.0, 9.9, 4.2, 7.3, 'roof', { faceMats: { ny: 'ceiling' } });
}

/** The north-east edge: the Garage (open front) and the store north of it. */
function garage(k: MapKit): void {
  block(k, 33.6, -8.5, 43.0, -5.4, 3.6, 'corr', 'roof');
  k.wallDecal(3.0, 2.8, 'shutter', 36.5, 0, -5.38, 0, { uv: 'raw' });
  k.wallDecal(3.0, 2.8, 'shutter', 40.4, 0, -5.38, 0, { uv: 'raw' });
  // Open-fronted garage: back wall, side walls, roof; the shutter half up.
  const H = 3.6;
  k.aabb(32.0, 0, -4.75, 40.5, H, -4.45, 'corr');
  k.aabb(32.0, 0, -4.45, 32.3, H, -1.0, 'corr');
  k.aabb(40.2, 0, -4.45, 40.5, H, -1.0, 'corr');
  k.aabb(31.85, H, -4.9, 40.65, H + 0.2, -0.85, 'roof', { faceMats: { ny: 'ceiling' } });
  for (const x of [34.8, 37.6]) k.box(0.25, H, 0.25, 'steel', x, 0, -1.15);
  k.wallDecal(8.0, 1.2, 'shutter', 36.25, H - 1.2, -0.86, 0, { uv: 'raw' });
  k.box(1.8, 1.4, 3.6, 'green', 35.6, 0, -2.8);
  k.box(0.7, 0.9, 2.6, 'steel', 39.7, 0, -2.8);
  k.light(36.2, H - 0.4, -2.8, [1.25, 1.1, 0.8], 7, 'lamp');
  barrels(k, [[30.6, -2.4], [30.9, -3.2, 'barrelRed'], [30.2, -6.6]]);
  // The east warehouse (L): an enterable hall and the shed in its notch.
  hall(k, 33.3, 2.75, 38.0, 10.0, 4.5, 'corr', { w: [door(8.2)], n: [door(35.6, 1.6, 2.6)], s: [door(36.0, 1.6, 2.6)], e: [win(5.0, 7.0)], roof: 'roof' });
  block(k, 29.6, 6.4, 33.3, 10.0, 3.5, 'wall', 'roof');
  k.box(1.4, 1.0, 1.0, 'crate', 36.6, 0, 4.0, { uv: 'raw' });
  k.box(1.0, 2.0, 2.0, 'steel', 37.3, 0, 8.4);
  k.light(35.6, 3.8, 6.4, [1.2, 1.1, 0.8], 7, 'lamp');
  crate(k, 42.35, 4.0, 1.2);
  crate(k, 29.9, 13.2, 1.2);
  // Horizontal fuel tanks on saddles beside the main road (C4).
  for (const x of [25.4, 27.8]) {
    k.cyl(1.05, 5.0, 12, 'tankH', x, 1.45, 9.8, { axis: 'z' });
    for (const z of [8.2, 11.4]) k.box(1.6, 0.6, 0.4, 'concreteDark', x, 0, z);
  }
  jersey(k, 26.6, -2.6, false, 2.4);
}

/** The Fuel Yard south-east of the track: the tank farm, the pump house, the big tanks. */
function fuelYard(k: MapKit): void {
  // Low walled base round the three vertical tanks.
  k.aabb(11.75, 0, 11.8, 19.6, 0.5, 20.0, 'concrete', { faceMats: { py: 'slab' } });
  k.aabb(11.75, 0.5, 11.8, 19.6, 1.2, 12.05, 'concrete');
  k.aabb(19.35, 0.5, 12.05, 19.6, 1.2, 20.0, 'concrete');
  k.aabb(11.75, 0.5, 19.75, 16.0, 1.2, 20.0, 'concrete');
  for (const [x, z] of [[13.4, 14.0], [17.4, 14.0], [17.4, 17.7]] as const) {
    k.cyl(1.75, 5.0, 14, 'tank', x, 3.0, z);
    k.cyl(1.2, 0.5, 12, 'steel', x, 5.75, z, { collide: false });
  }
  k.stairs(12.0, 0.5, 15.9, 13.0, 1.2, 19.75, '-z', 'stairs', 3);
  // Pump house and the pipe rack running east to the turned container.
  block(k, 4.9, 12.1, 11.75, 16.2, 3.5, 'wall', 'roof');
  k.wallDecal(1.4, 1.0, 'sign', 8.0, 1.4, 16.22, 0, { uv: 'raw' });
  block(k, 7.4, 16.6, 11.4, 20.6, 3.0, 'corr', 'roof');
  k.aabb(19.6, 0, 13.4, 26.75, 0.6, 15.0, 'concreteDark');
  for (const z of [13.8, 14.6]) k.cyl(0.25, 7.1, 8, 'pipe', 23.2, 0.9, z, { axis: 'x' });
  for (const x of [20.4, 23.2, 26.0]) k.box(0.2, 1.2, 1.6, 'steel', x, 0, 14.2, { collide: false });
  turnedContainer(k, 27.7, 21.5, PI / 4, 'container2', 6.1, 2.44);
  // The two big tanks on the south edge (S&D B between them and the farm) with their bund wall.
  k.aabb(10.0, 0, 23.5, 22.0, 0.4, 30.6, 'concrete', { faceMats: { py: 'slab' } });
  k.aabb(10.0, 0.4, 23.5, 12.0, 1.1, 23.75, 'concrete');
  k.aabb(20.0, 0.4, 23.5, 22.0, 1.1, 23.75, 'concrete');
  for (const x of [12.9, 18.6]) {
    k.cyl(2.75, 6.5, 16, 'tank', x, 0.4 + 3.25, 27.2);
    k.cyl(1.6, 0.6, 12, 'steel', x, 7.2, 27.2, { collide: false });
  }
  barrels(k, [[9.0, 22.4], [9.6, 21.8, 'barrelRed'], [21.2, 21.6]]);
  crate(k, 6.0, 21.8, 1.2);
  jersey(k, 6.0, 25.2, true, 2.4);
  k.light(15.8, 3.0, 22.0, [1.3, 1.1, 0.8], 9, 'lamp');
  floodlight(k, 21.2, 29.6, 10);
  floodlight(k, -21.6, 30.8, 10);
}

/** The east checkpoint (team 1 spawn) and the loading dock south of it. */
function eastCheckpoint(k: MapKit): void {
  k.aabb(61.15, 0, -3.8, 61.45, 3.2, -1.0, 'concrete');
  k.aabb(61.15, 0, 3.0, 61.45, 3.2, 5.75, 'concrete');
  k.wallDecal(4.0, 3.0, 'fence', 61.3, 0, 1.0, -PI / 2);
  k.trim(0.12, 0.12, 4.0, 'hazard', 60.4, 1.0, 1.0);
  hall(k, 48.0, -2.4, 51.4, 0.0, 2.6, 'wallWhite', { n: [door(49.2, 0.9)], e: [win(-1.8, -0.6)], w: [win(-1.8, -0.6)], roof: 'roofRed' });
  k.light(49.7, 2.3, -1.2, [1.2, 1.1, 0.8], 6, 'lamp');
  jersey(k, 55.6, -3.35, true, 2.4);
  jersey(k, 57.8, 4.6, false, 2.4);
  crate(k, 59.6, -2.8, 1.2);
  floodlight(k, 60.4, 5.0, 9);
  // Loading dock: a raised platform with steps, the shed on it.
  const Dk = 1.3;
  k.aabb(37.5, 0, 13.0, 48.0, Dk, 21.2, 'concrete', { faceMats: { py: 'slab' } });
  k.stairs(39.0, 0, 10.6, 42.0, Dk, 13.0, '+z', 'stairs', 6);
  k.stairs(34.8, 0, 15.0, 37.5, Dk, 18.0, '+x', 'stairs', 6);
  hall(k, 41.8, 15.6, 47.6, 20.8, 3.0, 'corr', { y: Dk, w: [door(18.2, 1.4, 2.2)], n: [win(43.0, 45.0)], roof: 'roof', floor: null });
  k.box(2.4, 1.0, 1.0, 'crate', 39.6, Dk, 19.8, { uv: 'raw' });
  k.box(1.2, 1.2, 1.2, 'crate', 38.6, Dk, 14.2, { uv: 'raw' });
  k.flatDecal(4.0, 0.3, 'hazard', 42.0, Dk + 0.02, 13.3);
  // Overhead the east strip: pipe gantry across from the garage to the dock.
  k.cyl(0.3, 12, 8, 'pipe', 45.2, 4.6, 6.0, { axis: 'z', collide: false });
  for (const z of [0.6, 11.4]) k.trim(0.25, 4.8, 0.25, 'steel', 45.2, 0, z);
  barrels(k, [[44.6, 9.6], [45.2, 10.2, 'barrelRed']]);
}

/** Boundary dressing: perimeter walls and fences you see at the edges, the outline clip. */
function outline(k: MapKit): void {
  const b = LAUNCH_BOUNDS;
  for (const r of raster(b.min.x, b.min.z, b.max.x, b.max.z, 0.5, (x, z) => !insideOutline(x, z))) k.clip(r.x0, b.min.y, r.z0, r.x1, 14, r.z1, 'perimeter');
  k.perimeter(b, 14);
  // A boundary wall (fence above a concrete footing) along every edge that has no building on it.
  const P = LAUNCH_OUTLINE;
  for (let i = 0; i < P.length; i++) {
    const [ax, az] = P[i]!;
    const [bx, bz] = P[(i + 1) % P.length]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1.5) continue;
    // Outward normal (clockwise on screen, z down): (dz, -dx) / len.
    const nx = (bz - az) / len;
    const nz = -(bx - ax) / len;
    const mx = (ax + bx) / 2 + nx * 0.3;
    const mz = (az + bz) / 2 + nz * 0.3;
    const ry = Math.atan2(-(bz - az), bx - ax);
    k.wallDecal(len, 2.8, 'fence', mx, 0.9, mz, ry);
    k.box(len, 0.9, 0.3, 'concreteDark', mx + nx * 0.15, 0, mz + nz * 0.15, { ry, collide: false });
  }
}

/** The steppe beyond the fences: distant service buildings, floodlight masts, power lines, hills. */
function backdrop(k: MapKit): void {
  // Distant blocks round the site.
  const blocks: [number, number, number, number, number][] = [
    [-90, -60, 14, 10, 8], [-60, -70, 20, 12, 6], [70, -55, 16, 14, 9], [95, 10, 12, 20, 7], [80, 55, 22, 12, 6],
    [-85, 45, 18, 14, 7], [-110, 0, 14, 24, 10], [10, 70, 30, 10, 6], [-30, 65, 16, 10, 5], [40, -75, 18, 10, 12],
  ];
  for (const [x, z, w, d, h] of blocks) k.aabb(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2, 'wall', { collide: false, faceMats: { py: 'roof' } });
  // The site buildings just beyond the fences (the overhead's dark roofs round the play space):
  // the big hangars west and east, sheds along the diagonals and the south edge.
  const near: [number, number, number, number, number, string][] = [
    [-68, 13, -51, 32, 9, 'corr'], [-68, -24, -51, -9.5, 4.5, 'corr'], [-40, -28, -28, -17, 7, 'corr'], [22, -30, 40, -15, 8, 'wall'],
    [49.5, 7, 64, 26, 11, 'corr'], [47, -22, 63, -9.5, 4.5, 'corr'], [-22, 33.2, -12, 40, 5, 'wall'], [26, 29.5, 40, 37, 5, 'corr'], [-8, 32, 7, 38, 4, 'corrRust'],
  ];
  for (const [x0, z0, x1, z1, h, m] of near) k.aabb(x0, 0, z0, x1, h, z1, m, { collide: false, faceMats: { py: 'roof' } });
  // Masts and a second, distant pad (gantry silhouette).
  for (const [x, z] of [[-75, -20], [75, -25], [-70, 30], [70, 32], [0, 55]] as const) {
    k.trim(0.5, 22, 0.5, 'steel', x, 0, z);
    k.trim(3.2, 1.6, 0.6, 'steel', x, 22, z);
    k.glow(x, 23, z, [1, 0.95, 0.8], 6, 'flood');
  }
  k.box(8, 40, 8, 'lattice', 150, 0, -170, { collide: false, hide: ['ny'] });
  k.cyl(2.2, 36, 10, 'rocket', 160, 18, -170, { collide: false });
  k.backdropRing('hillsFar', 230, 9, 180, 26, -3, 0.3);
  k.backdropRing('hills', 160, 11, 110, 14, -2);
}

// ---------------------------------------------------------------------------------------------

export function buildLaunch(): MapData {
  const k = new MapKit();
  // The asphalt apron (with the flame trench cut out), the steppe round it.
  k.groundWithHoles([-75, -40, 72, 40], 0, 3, 'asphalt', PIT_HOLES, { faceMats: { px: 'concreteDark', nx: 'concreteDark', pz: 'concreteDark', nz: 'concreteDark' } });
  for (const [x0, z0, x1, z1] of [[-260, -260, 260, -40], [-260, 40, 260, 260], [-260, -40, -75, 40], [72, -40, 260, 40]] as const) k.aabb(x0, -1, z0, x1, 0, z1, 'sand', { hide: ['ny'] });
  // Sand drifts and painted lines on the apron.
  for (const [x, z, w, d] of [[-58, 2, 10, 6], [-40, 15, 8, 6], [-30, -6, 6, 4], [30, 16, 8, 6], [52, 1, 8, 5], [-4, 26, 6, 4], [14, -14, 8, 6], [-20, -16, 6, 5]] as const) k.flatDecal(w, d, 'sand', x, 0.01, z, { ry: hash(x, z) * PI });
  for (const [x0, x1] of [[-64, -48], [-46, -40], [24, 29], [43, 60]] as const) k.flatDecal(x1 - x0, 0.25, 'yellow', (x0 + x1) / 2, 0.012, 1.4, { seg: 4 });
  outline(k);
  launchPad(k);
  gantry(k);
  track(k);
  westCheckpoint(k);
  offices(k);
  warehouse(k);
  stairsRoof(k);
  westCentre(k);
  centrifuge(k);
  control(k);
  garage(k);
  fuelYard(k);
  eastCheckpoint(k);
  backdrop(k);
  floodlight(k, -26.0, -11.4, 10);
  floodlight(k, 24.2, -10.6, 10);
  floodlight(k, 44.0, -7.6, 10);

  // ---- spawns ----
  const sp = (x: number, y: number, z: number, yaw: number): SpawnPoint => ({ x, y, z, yaw });
  const E = -PI / 2; // facing east (+x)
  const W = PI / 2; // facing west
  const team0 = [[-63.2, -2.4], [-63.2, 0.6], [-63.2, 3.6], [-60.6, -2.8], [-60.6, 0.2], [-60.6, 2.8], [-58.0, -2.4], [-58.0, 1.4], [-58.0, 5.0], [-55.4, 0.4], [-55.4, 3.6], [-52.8, 1.2]].map(([x, z]) => sp(x!, 0, z!, E));
  const team1 = [[59.6, -1.8], [59.6, 1.2], [59.6, 3.8], [57.0, -2.6], [57.0, 0.4], [57.0, 3.0], [54.4, -2.6], [54.4, 0.6], [54.4, 3.8], [51.8, 1.6], [51.8, 4.4], [49.2, 2.6]].map(([x, z]) => sp(x!, 0, z!, W));
  const ffaAt: [number, number, number][] = [
    [-61, 0, 0], [-47.6, 0, 9.8], [-46.0, 0, -6.0], [-35.6, 0, 6.0], [-31.5, 0, 16.0], [-36.4, L.stairsRoof, 16.8], [-20.6, 0, 2.2], [-17.2, 0, 15.6],
    [-18.6, 0, -14.6], [-12.8, L.catwalk, 11.2], [X(0), L.pit, -18.0], [X(-8.4), L.tower, -14.0], [X(8.4), L.tower, -14.0], [X(0), L.deck, -29.8],
    [X(0), L.deck, 10.4], [13.0, 0, -12.6], [15.6, 0, -5.6], [19.6, L.control, 2.0], [27.2, 0, 2.2], [37.4, 0, -2.0], [35.6, 0, 6.4], [39.8, 1.3, 16.4],
    [15.6, 0, 21.8], [7.6, 0, 23.0], [56.0, 0, 0.6], [-6.8, 0, -2.1], [8.4, 0, 9.6],
  ];
  const ffa = ffaAt.map(([x, y, z]) => sp(x, y, z, yawTo(x, z, X(0), 0)));

  // ---- objectives ----
  const P = (id: string, x: number, y: number, z: number, radius: number, team?: 0 | 1): ObjectivePoint => (team === undefined ? { id, x, y, z, radius } : { id, x, y, z, radius, team });
  // Domination (BO1 and the BO7 remaster's tac map): A by the turned container south of the
  // Centrifuge, B under the rocket in the flame trench, C by the turned container at the Fuel Yard.
  const dom = [P('A', -24.8, 0, 21.0, 3), P('B', X(0), L.pit, -17.9, 3), P('C', 24.0, 0, 20.6, 3)];
  // S&D: A under the rocket (the wiki), B between the tank farm and the big tanks (Fuel Yard).
  const sd = [P('A', X(-3.4), L.pit, -18.4, 1.6, 1), P('B', 16.0, 0, 22.0, 1.6, 1)];
  // Headquarters: the BO7 hardpoint rotation (track south, lean-to west, pad, Control's south side)
  // plus the Warehouse, Control, the Centrifuge, Offices and the east warehouse.
  const hq = [
    P('hq1', X(0), L.deck, 10.2, 3), P('hq2', -20.2, 0, 7.8, 2.6), P('hq3', X(0), L.pit, -18.0, 3), P('hq4', 20.4, 0, 9.4, 3),
    P('hq5', -34.0, 0, 6.0, 3), P('hq6', 15.8, 0, -5.4, 2.6), P('hq7', -17.6, 0, 13.6, 3), P('hq8', -45.8, 0, -4.4, 2.2), P('hq9', 35.6, 0, 6.4, 2.2),
  ];
  const attackers = team0;
  const defenders = [[29.0, -6.4], [31.4, -7.2], [33.4, -2.4], [38.4, -2.4], [29.2, -0.6], [27.6, -4.8], [24.8, -6.2], [38.8, 1.2]].map(([x, z]) => sp(x!, 0, z!, yawTo(x!, z!, X(0), 0)));

  const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
  return {
    id: 'launch',
    name: 'Launch',
    bounds: LAUNCH_BOUNDS,
    materials: MATERIALS,
    brushes: k.brushes,
    decals: k.decals,
    props: k.props,
    lights: k.lights,
    spawns: { teams: [team0, team1], ffa },
    objectives: { dom, sd, hq },
    modeSpawns: { sd: { attackers, defenders } },
    times: [
      { id: 'day', name: 'Hazy Day', clock: '11:40', sky: 'rust_skyHaze', unlit: [1, 0.98, 0.92], skyRot: 0, sunDir: unitVec(0.35, 0.78, 0.5), sun: [1.12, 1.02, 0.86], amb: [0.5, 0.5, 0.5], fog: [0.84, 0.78, 0.66], fogNear: 40, fogFar: 190, lights: { lamp: 0.3, pit: 0.6, flood: 0, beacon: 0.6 }, glow: 0.2 },
      { id: 'evening', name: 'Evening Countdown', clock: '19:05', sky: 'rust_skyDusk', unlit: [1, 0.86, 0.76], skyRot: PI * 0.6, sunDir: unitVec(-0.86, 0.3, 0.3), sun: [1.2, 0.66, 0.4], amb: [0.3, 0.26, 0.32], fog: [0.72, 0.5, 0.4], fogNear: 30, fogFar: 160, lights: { lamp: 1, pit: 1, flood: 1, beacon: 1 }, glow: 0.9 },
    ],
    defaultTime: 'day',
    hotspots: [
      v(X(0), L.pit, -18.0),
      v(X(-8.4), L.tower, -14.0),
      v(X(8.4), L.tower, -14.0),
      v(X(0), L.deck, -29.6),
      v(X(-1.0), L.deck, -9.6),
      v(X(0), L.car, -1.0),
      v(-24.8, 0, 21.0),
      v(24.0, 0, 20.6),
      v(-20.2, 0, 7.8),
      v(-34.0, 0, 6.0),
      v(-38.6, L.stairsRoof, 16.6),
      v(-15.4, L.catwalk, 11.2),
      v(-17.0, 0, 13.4),
      v(15.8, 0, -5.4),
      v(15.6, L.control, -4.6),
      v(20.0, L.control, 2.0),
      v(35.6, 0, 6.4),
      v(36.2, 0, -2.6),
      v(16.0, 0, 22.0),
      v(-45.8, 0, -4.4),
      v(-18.6, 0, -15.0),
      v(15.4, 0, -14.6),
      v(43.6, 1.3, 14.6),
    ],
  };
}
