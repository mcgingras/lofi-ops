/**
 * Estate (MW2 "Estate", mp_estate): Makarov's safehouse on a forested hillside, rebuilt from the MW2
 * minimap and the Modern Warfare III (2023) remaster's tac maps, which share one outline (see
 * docs/maps/estate-reference.md for the sources, scale and callouts).
 *
 * The ground climbs from the north (the Substation, y 0) to the Lodge on the hill top (south):
 *   - north: the Substation, a fenced transformer yard and equipment yard, the block-built
 *     Substation Building (ladders to its roof), the power pylon in the far corner and the gated
 *     driveway entrance; team 1 (TF141) spawns west of the yard;
 *   - west: the Workshop, a two-storey barn (lofts at both ends, a log pile and lean-to up to its
 *     roof), Domination C;
 *   - middle: the big rock, the Garage tucked against it (Domination B), the Waterfall terraces
 *     climbing to the Lodge with the creek, and the Main Road / Lodge Path up to the front yard;
 *   - east: the north-east field, the Curved Stairs up to the Boathouse plateau (S&D B, the
 *     roof reachable from the rock behind it), the shore of the lake, the outcrop in front of the
 *     Lodge and the Long Stairs down from the front yard;
 *   - south: the Lodge (basement game room, main floor with the double-height great room and its
 *     bay windows, upper floor with the loft, two bedrooms and the wraparound balcony reached by
 *     the log pile; S&D A), the Greenhouse, the gravel courtyard (Domination A), the shed and the
 *     Backwoods, where team 0 (Spetsnaz) spawns.
 *
 * Coordinates: x east, z south, y up, metres (1 m = 8.3 px on the 2048 px MWIII tac map, origin at
 * its pixel (1030, 1000)); yaw 0 looks north (-z). Buildings stand at small angles on the overhead;
 * here they are axis-aligned at the same places and sizes.
 * Search and Destroy: the defenders hold the hill (south, spawn side 0, `objectives.sd[].team = 0`),
 * the attackers come up from the Substation (`modeSpawns.sd`).
 */
import type { RampDir } from '../collision';
import { MapKit, spawnAt, yawTowards, type Hole } from './mw2kit';
import { unitVec, type BoxOpts, type MapData, type MaterialDef, type SpawnPoint } from './types';

const PI = Math.PI;

const MATERIALS: Record<string, MaterialDef> = {
  ground: { texture: 'est_forest', uvMul: [1 / 6, 1 / 6] },
  grass: { texture: 'est_forest', uvMul: [1 / 5, 1 / 5], tint: 0xb4b89c },
  gravel: { texture: 'est_gravel', uvMul: [1 / 4, 1 / 4] },
  stone: { texture: 'est_stone', uvMul: [1 / 2.5, 1 / 2.5] },
  rock: { texture: 'est_rock', uvMul: [1 / 5, 1 / 5] },
  siding: { texture: 'est_siding', uvMul: [1 / 2, 1 / 2] },
  boards: { texture: 'est_boards', uvMul: [1 / 2, 1 / 2] },
  boardsDark: { texture: 'est_boards', uvMul: [1 / 2, 1 / 2], tint: 0x8a8070 },
  deck: { texture: 'bo_planks', uvMul: [1 / 2, 1 / 2], tint: 0xa89880 },
  trim: { texture: 'bo_wood', uvMul: [1, 1], tint: 0x6a5240 },
  floorWood: { texture: 'nt_floor', uvMul: [1 / 2, 1 / 2], tint: 0xa08870 },
  plaster: { texture: 'nt_plaster', uvMul: [1 / 2, 1 / 2], tint: 0xe2dccc },
  plasterB: { texture: 'nt_plaster', uvMul: [1 / 2, 1 / 2], tint: 0xb8b0a0 },
  tile: { texture: 'nt_tile', uvMul: [1 / 2, 1 / 2], tint: 0xc8c4bc },
  carpet: { texture: 'term_carpet', uvMul: [1 / 2, 1 / 2], tint: 0x8a6a58 },
  roof: { texture: 'nt_roof', uvMul: [1 / 3, 1 / 3], tint: 0x5c5c60 },
  roofTin: { texture: 'fr_tin', uvMul: [1 / 3, 1 / 3], tint: 0x9a9a98 },
  glass: { texture: 'term_glass', uvMul: [1 / 1.6, 1 / 2.4], side: 'double' },
  block: { texture: 'bo_concrete', uvMul: [1 / 3, 1 / 3], tint: 0xb8b8b0 },
  concrete: { texture: 'rust_concrete', uvMul: [1 / 3, 1 / 3] },
  water: { texture: 'est_water', uvMul: [1 / 3, 1 / 3], emissive: 0.15 },
  logs: { texture: 'fr_logs', uvMul: [1 / 1.5, 1 / 1.5] },
  bark: { texture: 'fr_bark', uvMul: [1 / 1.5, 1 / 1.5] },
  pine: { texture: 'est_pine', side: 'double' },
  pines: { texture: 'est_pines', side: 'double', fog: false, tint: 0xa8b0b0 },
  mountains: { texture: 'est_mountains', side: 'double', fog: false, tint: 0xa8acb4 },
  counter: { texture: 'term_counter', uvMul: [1 / 2, 1 / 2] },
  fabric: { texture: 'bo_fabric', uvMul: [1, 1], tint: 0x8a7a68 },
  felt: { texture: 'bo_fabric', uvMul: [1, 1], tint: 0x3a7a4a },
  steel: { texture: 'steel' },
  green: { texture: 'steel', tint: 0x6a8a6a },
  fence: { texture: 'fence', side: 'double' },
  railWood: { texture: 'rust_rail', uvMul: [1 / 1.2, 1], side: 'double', tint: 0xb09078 },
  railSteel: { texture: 'rust_rail', uvMul: [1 / 1.2, 1], side: 'double', tint: 0x9aa0a8 },
  carRed: { texture: 'bo_carpaint', tint: 0x8a2a24 },
  carWhite: { texture: 'bo_carpaint', tint: 0xe0e0dc },
  carBlack: { texture: 'bo_carpaint', tint: 0x2a2c30 },
  charred: { texture: 'scrap_junk', uvMul: [1 / 3, 1 / 3], tint: 0x4a4440 },
  rubber: { texture: 'rubber', uvMul: [1 / 0.4, 1 / 0.4] },
  crate: { texture: 'crate', uvMul: [1 / 1.2, 1 / 1.2] },
  barrel: { texture: 'barrel', tint: 0x4a6a8a, uvMul: [2, 1] },
  sandbag: { texture: 'bo_sandbag', uvMul: [1 / 1.2, 1 / 0.6] },
  hazard: { texture: 'hazard', uvMul: [1 / 0.6, 1 / 0.6] },
  lamp: { texture: 'lamp', emissive: 1 },
  winLit: { texture: 'winRow', emissive: 0.8, uvMul: [1 / 3, 1] },
  clip: { texture: 'none' },
};

/** Heights of the walkable levels. */
export const ESTATE_LEVELS = {
  /** The Substation, the north fields, the Workshop and the Garage. */
  field: 0,
  /** Garden, Greenhouse, courtyard, Backwoods and the Lodge basement. */
  garden: 6.4,
  /** Lodge main floor and the front yard. */
  main: 9.6,
  /** Lodge upper floor, loft and balconies. */
  upper: 12.9,
  /** The Boathouse plateau. */
  plateau: 5.0,
  /** Boathouse floor (raised deck). */
  boathouse: 6.2,
  /** Boathouse roof (at the eaves). */
  boathouseRoof: 9.45,
  /** Workshop lofts. */
  loft: 3.6,
  /** Workshop roof. */
  workshopRoof: 7.3,
  /** Substation Building roof. */
  substationRoof: 4.5,
  /** Garage roof. */
  garageRoof: 3.9,
  /** Top of the big rock by the Garage. */
  bigRock: 3.2,
  /** Top of the outcrop in front of the Lodge. */
  outcrop: 9.6,
  /** Pylon platform. */
  pylon: 6.0,
} as const;

const L = ESTATE_LEVELS;
const B = L.garden;
const M = L.main;
const U = L.upper;

/** The playable outline (rectilinear trace of the overhead), clockwise on the overhead. */
export const ESTATE_OUTLINE: [number, number][] = [
  [-38, -80], [-22, -80], [-22, -72], [-10, -72], [-10, -62], [2, -62], [2, -52], [12, -52], [12, -44], [20, -44],
  [20, -14], [36, -14], [36, -16], [48, -16], [48, -6], [56, -6], [56, 4], [64, 4], [64, 14], [72, 14], [72, 22],
  [78, 22], [78, 38], [56, 38], [56, 42], [40, 42], [40, 44], [18, 44], [18, 50], [12, 50], [12, 60], [8, 60],
  [8, 90], [-27, 90], [-27, 86], [-38, 86], [-38, 80], [-44, 80], [-44, 70], [-50, 70], [-50, 56], [-56, 56],
  [-56, 24], [-46, 24], [-46, 12], [-58, 12], [-58, 6], [-66, 6], [-66, 0], [-74, 0], [-74, -6], [-82, -6],
  [-82, -12], [-76, -12], [-76, -20], [-70, -20], [-70, -28], [-64, -28], [-64, -38], [-56, -38], [-56, -44],
  [-48, -44], [-48, -50], [-43, -50], [-43, -70], [-38, -70],
];

// ---------------------------------------------------------------------------------------------
// Terrain: flat patches and ramps (one slope direction each); `groundAt` reads them back.
// ---------------------------------------------------------------------------------------------

interface Patch {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Low and high surface heights (equal for a flat patch). */
  lo: number;
  hi: number;
  dir?: RampDir;
  mat: string;
  /** Material of the exposed side faces (retaining walls, cliffs). */
  side?: string;
}

const flat = (x0: number, z0: number, x1: number, z1: number, y: number, mat = 'ground', side?: string): Patch => ({ x0, z0, x1, z1, lo: y, hi: y, mat, side });
const slope = (x0: number, z0: number, x1: number, z1: number, lo: number, hi: number, dir: RampDir, mat = 'ground', side?: string): Patch => ({ x0, z0, x1, z1, lo, hi, dir, mat, side });

const TERRAIN: Patch[] = [
  // North fields (Substation, Workshop, Garage) and the north-east field rising to the plateau.
  flat(-150, -150, 12, 4, 0),
  flat(12, -150, 150, -16, 0),
  slope(12, -16, 150, 4, 0, 2.4, '+z', 'ground', 'stone'),
  flat(12, 4, 48, 10, 2.4),
  slope(48, 4, 60, 10, 2.4, L.plateau, '+z'),
  flat(60, 4, 150, 10, 2.4),
  // Waterfall terraces (a 1.4 m rock step at z 16 where the creek falls).
  slope(-150, 4, -12, 16, 0, 2.0, '+z'),
  slope(-150, 16, -12, 30, 3.4, B, '+z', 'ground', 'rock'),
  // Lodge Path (west) and the Main Road (east) up to the front yard; stone retaining wall west.
  slope(-12, 4, 2, 26, 0, M, '+z', 'grass', 'stone'),
  slope(2, 4, 12, 26, 0, M, '+z', 'gravel', 'stone'),
  // The outcrop in front of the Lodge (walk on from the front yard).
  flat(12, 10, 25, 37, L.outcrop, 'rock', 'rock'),
  // Boathouse plateau and the strip below the Long Stairs; the shore down to the lake.
  flat(25, 10, 60, 44, L.plateau, 'ground', 'rock'),
  flat(12, 37, 25, 44, L.plateau, 'ground', 'rock'),
  flat(12, 44, 150, 150, L.plateau, 'ground', 'rock'),
  slope(60, 10, 80, 44, 1.2, L.plateau, '-x', 'grass'),
  flat(80, 10, 150, 44, 0.4, 'gravel'),
  // Garden, courtyard and Backwoods (Lodge basement level).
  flat(-150, 30, -26, 150, B, 'ground', 'stone'),
  flat(-26, 30, -22, 40, B, 'ground', 'stone'),
  flat(-26, 57, 0, 150, B, 'ground', 'stone'),
  flat(0, 65, 8, 150, B, 'ground', 'stone'),
  flat(8, 57, 12, 150, B, 'ground', 'stone'),
  // Front yard (main floor level) and the drive down to the Backwoods.
  flat(-12, 26, 12, 40, M, 'gravel', 'stone'),
  flat(-3, 40, 12, 57, M, 'gravel', 'stone'),
  slope(0, 57, 8, 65, B, M, '-z', 'gravel', 'stone'),
];

/** Height of the terrain at (x, z) (the first patch containing it), ignoring buildings and rocks. */
export function groundAt(x: number, z: number): number {
  for (const p of TERRAIN) {
    if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) continue;
    if (!p.dir) return p.lo;
    const k = p.dir === '+x' ? (x - p.x0) / (p.x1 - p.x0) : p.dir === '-x' ? (p.x1 - x) / (p.x1 - p.x0) : p.dir === '+z' ? (z - p.z0) / (p.z1 - p.z0) : (p.z1 - z) / (p.z1 - p.z0);
    return p.lo + (p.hi - p.lo) * k;
  }
  return 0;
}

function terrain(k: MapKit): void {
  const base = -3;
  for (const p of TERRAIN) {
    const side = p.side ?? p.mat;
    const faceMats = { px: side, nx: side, pz: side, nz: side };
    k.slab(p.x0, base, p.z0, p.x1, p.lo, p.z1, p.dir ? side : p.mat, { hide: ['ny'], faceMats: p.dir ? faceMats : { ...faceMats, py: p.mat } });
    if (p.dir) k.ramp(p.x0, p.lo, p.z0, p.x1, p.hi, p.z1, p.dir, p.mat, { hide: ['ny'], faceMats });
  }
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const hash = (x: number, z: number) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

function insidePoly(poly: [number, number][], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Player clips along every edge of the outline, on its outside. */
function outlineClips(k: MapKit, poly: [number, number][], y0: number, y1: number, t = 0.6): void {
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i]!;
    const [bx, bz] = poly[(i + 1) % poly.length]!;
    if (az === bz) {
      const lo = Math.min(ax, bx) - t;
      const hi = Math.max(ax, bx) + t;
      const out = insidePoly(poly, (ax + bx) / 2, az - 0.05) ? 1 : -1;
      k.slab(lo, y0, az, hi, y1, az + out * t, 'clip', { noRender: true, bullets: false, sight: false, tag: 'perimeter' });
    } else {
      const lo = Math.min(az, bz) - t;
      const hi = Math.max(az, bz) + t;
      const out = insidePoly(poly, ax - 0.05, (az + bz) / 2) ? 1 : -1;
      k.slab(ax, y0, lo, ax + out * t, y1, hi, 'clip', { noRender: true, bullets: false, sight: false, tag: 'perimeter' });
    }
  }
}

/** A pine: collidable trunk and two crossed alpha cards (render only). */
function pine(k: MapKit, x: number, z: number, h: number, y = groundAt(x, z), collide = true): void {
  k.cyl(0.22 + h * 0.008, h * 0.75, 6, 'bark', x, y + h * 0.375, z, 'y', collide);
  const w = h * 0.42;
  const r = hash(x, z) * PI;
  k.decals.push({ kind: 'wall', w, h: h * 0.85, x, y: y + h * 0.18, z, ry: r, mat: 'pine', uv: 'raw', seg: 1 });
  k.decals.push({ kind: 'wall', w, h: h * 0.85, x, y: y + h * 0.18, z, ry: r + PI / 2, mat: 'pine', uv: 'raw', seg: 1 });
}

/** A boulder: a rock box with a smaller turned cap (the box collides, the cap is trim). */
function boulder(k: MapKit, x: number, z: number, s: number, y = groundAt(x, z)): void {
  k.slab(x - s / 2, y - 0.3, z - s * 0.4, x + s / 2, y + s * 0.55, z + s * 0.4, 'rock');
  k.add({ min: { x: x - s * 0.32, y: y + s * 0.5, z: z - s * 0.3 }, max: { x: x + s * 0.32, y: y + s * 0.8, z: z + s * 0.3 }, mat: 'rock', ry: hash(z, x) * PI, collide: false });
}

/** Glass wall: render-only panes and a players-only clip (bullets and sight pass). */
function glassWall(k: MapKit, axis: 'x' | 'z', from: number, to: number, at: number, y0: number, y1: number, holes: [number, number][] = []): void {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const runs: [number, number][] = [];
  let cur = lo;
  for (const [a, b] of [...holes].sort((p, q) => p[0] - q[0])) {
    if (a > cur) runs.push([cur, a]);
    cur = b;
  }
  if (hi > cur) runs.push([cur, hi]);
  for (const [a, b] of runs) {
    if (axis === 'x') {
      k.decals.push({ kind: 'wall', w: b - a, h: y1 - y0, x: (a + b) / 2, y: y0, z: at, ry: 0, mat: 'glass' });
      k.slab(a, y0, at - 0.05, b, y1, at + 0.05, 'clip', { noRender: true, bullets: false, sight: false, tag: 'glass' });
    } else {
      k.decals.push({ kind: 'wall', w: b - a, h: y1 - y0, x: at, y: y0, z: (a + b) / 2, ry: PI / 2, mat: 'glass' });
      k.slab(at - 0.05, y0, a, at + 0.05, y1, b, 'clip', { noRender: true, bullets: false, sight: false, tag: 'glass' });
    }
  }
}

/** Window panes (render only) in a wall hole. */
function pane(k: MapKit, axis: 'x' | 'z', a: number, b: number, at: number, y0: number, y1: number): void {
  if (axis === 'x') k.decals.push({ kind: 'wall', w: b - a, h: y1 - y0, x: (a + b) / 2, y: y0, z: at, ry: 0, mat: 'glass' });
  else k.decals.push({ kind: 'wall', w: b - a, h: y1 - y0, x: at, y: y0, z: (a + b) / 2, ry: PI / 2, mat: 'glass' });
}

/** A car: body, cabin, wheels (players stop on the wheel skirt; bullets pass under). */
function car(k: MapKit, x: number, z: number, alongX: boolean, mat: string, y = groundAt(x, z), suv = false): void {
  const hl = 2.3;
  const hw = 0.95;
  const [hx, hz] = alongX ? [hl, hw] : [hw, hl];
  k.slab(x - hx, y + 0.35, z - hz, x + hx, y + 1.05, z + hz, mat);
  k.slab(x - hx + 0.15, y, z - hz + 0.15, x + hx - 0.15, y + 0.35, z + hz - 0.15, 'rubber', { bullets: false, sight: false });
  const cl = suv ? 1.6 : 1.15;
  const ch = suv ? 0.85 : 0.6;
  const off = suv ? -0.4 : -0.2;
  const [cx, cz] = alongX ? [x + off, z] : [x, z + off];
  const [chx, chz] = alongX ? [cl, hw * 0.92] : [hw * 0.92, cl];
  k.slab(cx - chx, y + 1.05, cz - chz, cx + chx, y + 1.05 + ch, cz + chz, mat, { faceMats: alongX ? { pz: 'glass', nz: 'glass' } : { px: 'glass', nx: 'glass' } });
  for (const s of [-1, 1]) for (const e of [-1, 1]) k.cyl(0.36, 0.24, 8, 'rubber', alongX ? x + e * 1.45 : x + s * 0.85, y + 0.36, alongX ? z + s * 0.85 : z + e * 1.45, alongX ? 'z' : 'x', false);
}

function crate(k: MapKit, x: number, z: number, s = 1.2, y = groundAt(x, z)): void {
  k.slab(x - s / 2, y, z - s / 2, x + s / 2, y + s, z + s / 2, 'crate', { uv: 'raw' });
}

/** Low stone garden wall (cover), following the terrain along its length in short steps. */
function stoneWall(k: MapKit, axis: 'x' | 'z', from: number, to: number, at: number, h = 1.0, t = 0.5, step = 2): void {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  for (let a = lo; a < hi - 1e-6; a += step) {
    const b = Math.min(hi, a + step);
    const m = (a + b) / 2;
    const g0 = axis === 'x' ? Math.min(groundAt(a, at), groundAt(b, at)) : Math.min(groundAt(at, a), groundAt(at, b));
    const g1 = axis === 'x' ? groundAt(m, at) : groundAt(at, m);
    if (axis === 'x') k.slab(a, g0 - 0.4, at - t / 2, b, g1 + h, at + t / 2, 'stone');
    else k.slab(at - t / 2, g0 - 0.4, a, at + t / 2, g1 + h, b, 'stone');
  }
}

// ---------------------------------------------------------------------------------------------
// The Lodge
// ---------------------------------------------------------------------------------------------

/** Lodge footprint: main body and the north front arm (the great room). */
export const LODGE = { x0: -26, x1: -3, z0: 40, z1: 57, fx0: -22, fx1: -12, fz0: 29 } as const;

function lodge(k: MapKit): void {
  const { x0, x1, z0, z1, fx0, fx1, fz0 } = LODGE;
  const t = 0.4;
  const ROOF = 16.0;
  const sid = (inner: 'px' | 'nx' | 'pz' | 'nz', mat = 'plaster'): BoxOpts => ({ faceMats: { [inner]: mat } });

  // --- Plinth of the front arm (stone, solid) and the basement floor ---
  k.slab(fx0, -2, fz0, fx1, M - 0.3, z0, 'stone');
  k.slab(fx0 + 0.2, M - 0.3, fz0 + 0.2, fx1 - 0.2, M, z0, 'floorWood');
  k.slab(x0, -2, z0, x1, B, z1, 'concrete', { hide: ['ny'] });
  k.decals.push({ kind: 'flat', w: x1 - x0 - 0.8, h: z1 - 47 - 0.6, x: (x0 + x1) / 2, y: B + 0.02, z: (47 + z1) / 2, mat: 'carpet' });

  // --- Basement (game room south, storage north) ---
  k.wall('z', z0, z1, x0 + t / 2, B, M - 0.3, t, 'stone', [[43, 44.6, B, B + 2.2], [50, 52, B + 1.2, B + 2.2]], sid('px', 'plasterB'));
  k.wall('z', z0, z1, x1 - t / 2, B, M - 0.3, t, 'stone', [], sid('nx', 'plasterB'));
  k.wall('x', x0, x1, z1 - t / 2, B, M - 0.3, t, 'stone', [[-24.5, -22, B + 1.2, B + 2.2], [-10, -8.4, B, B + 2.2], [-6.6, -4.6, B + 1.2, B + 2.2]], sid('nz', 'plasterB'));
  k.wall('x', x0, x1, z0 + t / 2, B, M - 0.3, t, 'stone', [[-25.2, -23.4, B + 1.2, B + 2.3]], sid('pz', 'plasterB'));
  pane(k, 'z', 50, 52, x0, B + 1.2, B + 2.2);
  pane(k, 'x', -24.5, -22, z1, B + 1.2, B + 2.2);
  pane(k, 'x', -6.6, -4.6, z1, B + 1.2, B + 2.2);
  k.wall('x', x0 + t, x1 - t, 47, B, M - 0.3, 0.2, 'plasterB', [[-18, -15.6, B, B + 2.2], [-9, -7.6, B, B + 2.2]]);
  // Game room: pool table, bar with stools, sofa; storage: crates and wine racks.
  k.slab(-15.2, B, 51.4, -12.8, B + 0.85, 52.7, 'trim');
  k.trim(-15.1, B + 0.85, 51.5, -12.9, B + 0.88, 52.6, 'felt');
  k.slab(-25.6, B, 49, -24.6, B + 1.1, 55.4, 'counter');
  k.trim(-25.8, B + 1.4, 48.6, -25.6, B + 2.4, 55.8, 'trim');
  for (const z of [49.8, 51.4, 53, 54.6]) k.cyl(0.2, 0.75, 6, 'fabric', -23.9, B + 0.375, z, 'y', false);
  k.slab(-20, B, 55.4, -16, B + 0.85, 56.4, 'fabric');
  k.slab(-9, B, 49.6, -7, B + 0.5, 50.6, 'trim');
  crate(k, -24.8, 41.2, 1.2, B);
  crate(k, -24.8, 42.5, 1.2, B);
  crate(k, -23.5, 41.2, 1.2, B);
  for (const x of [-20, -16, -12]) k.slab(x - 1.5, B, z0 + t, x + 1.5, B + 2.0, z0 + t + 0.5, 'trim');
  k.slab(-9.6, B, 44, -8.4, B + 1.2, 45.2, 'crate', { uv: 'raw' });

  // --- Main floor slab (hole for the basement stairs) ---
  const SX0 = -5.4;
  const SZ0 = 49;
  const SZ1 = 54.5;
  k.slab(x0, M - 0.3, z0, SX0, M, z1, 'floorWood', { faceMats: { ny: 'plasterB' } });
  k.slab(SX0, M - 0.3, z0, x1, M, SZ0, 'floorWood', { faceMats: { ny: 'plasterB' } });
  k.slab(SX0, M - 0.3, SZ1, x1, M, z1, 'floorWood', { faceMats: { ny: 'plasterB' } });
  k.ramp(SX0 + 0.2, B, SZ0, x1 - t, M, SZ1, '-z', 'deck', { tag: 'stairs' });
  k.rail('z', SZ0 + 1, SZ1, SX0, M, 'railWood', 'trim');
  k.rail('x', SX0, x1 - t, SZ1, M, 'railWood', 'trim');
  k.decals.push({ kind: 'flat', w: 9, h: 6, x: -13, y: M + 0.02, z: 43.5, mat: 'carpet' });
  k.decals.push({ kind: 'flat', w: 10.6, h: 9.4, x: -20.4, y: M + 0.02, z: 52.2, mat: 'tile' });

  // --- Main floor walls (siding outside, plaster inside) ---
  const W1 = U - 0.3;
  k.wall('z', z0, z1, x0 + t / 2, M, W1, t, 'siding', [[42, 46, M + 0.8, M + 2.4], [49, 50.6, M, M + 2.2], [52.5, 55.5, M + 0.8, M + 2.4]], sid('px'));
  k.wall('x', x0, x1, z1 - t / 2, M, W1, t, 'siding', [[-24, -20, M + 0.9, M + 2.3], [-18.5, -16.5, M + 0.9, M + 2.3], [-12, -9, M + 0.9, M + 2.3], [-7, -5, M + 0.9, M + 2.3]], sid('nz'));
  k.wall('z', z0, z1, x1 - t / 2, M, W1, t, 'siding', [[42, 43.6, M, M + 2.2], [46, 48.5, M + 0.8, M + 2.4], [51, 55, M + 0.8, M + 2.4]], sid('nx'));
  k.wall('x', x0, fx0, z0 + t / 2, M, W1, t, 'siding', [[-25, -23, M + 0.8, M + 2.4]], sid('pz'));
  k.wall('x', fx1, x1, z0 + t / 2, M, W1, t, 'siding', [[-10, -6, M + 0.8, M + 2.4]], sid('pz'));
  for (const [a, b] of [[42, 46], [52.5, 55.5]] as const) pane(k, 'z', a, b, x0, M + 0.8, M + 2.4);
  for (const [a, b] of [[46, 48.5], [51, 55]] as const) pane(k, 'z', a, b, x1, M + 0.8, M + 2.4);
  for (const [a, b] of [[-24, -20], [-18.5, -16.5], [-12, -9], [-7, -5]] as const) pane(k, 'x', a, b, z1, M + 0.9, M + 2.3);
  pane(k, 'x', -25, -23, z0, M + 0.8, M + 2.4);
  pane(k, 'x', -10, -6, z0, M + 0.8, M + 2.4);
  // Front arm (great room, double height): the bay window north, the front door east.
  k.wall('z', fz0, z0, fx0 + t / 2, M, ROOF, t, 'siding', [[30.5, 38.5, M + 1.0, M + 5.6]], sid('px'));
  k.wall('x', fx0, fx1, fz0 + t / 2, M, ROOF, t, 'siding', [[-21, -13, M + 0.5, M + 5.8]], sid('pz'));
  k.wall('z', fz0, z0, fx1 - t / 2, M, ROOF, t, 'siding', [[31, 32.6, M, M + 2.3], [34, 39, M + 0.6, M + 5.6]], sid('nx'));
  pane(k, 'z', 30.5, 38.5, fx0, M + 1.0, M + 5.6);
  pane(k, 'x', -21, -13, fz0, M + 0.5, M + 5.8);
  pane(k, 'z', 34, 39, fx1, M + 0.6, M + 5.6);
  for (const x of [-19, -17, -15]) k.trim(x - 0.06, M + 0.5, fz0, x + 0.06, M + 5.8, fz0 + 0.12, 'trim');
  k.trim(fx0, M + 3.1, fz0, fx1, M + 3.25, fz0 + 0.14, 'trim');
  // Partitions: hall / kitchen + den, kitchen / den.
  k.wall('x', x0 + t, x1 - t, 47, M, W1, 0.2, 'plaster', [[-22.5, -18.5, M, M + 2.3], [-10, -8.6, M, M + 2.2]]);
  k.wall('z', 47, z1 - t, -15, M, W1, 0.2, 'plaster', [[50, 51.4, M, M + 2.2]]);
  // Main stairs along the great room's west wall, opposite the front door, up to the loft.
  k.ramp(fx0 + t, M, 30.5, fx0 + 2.0, U, z0 - 0.4, '+z', 'deck', { tag: 'stairs' });
  k.trim(fx0 + 2.0, M, 30.5, fx0 + 2.1, U + 1.0, z0 - 0.4, 'trim', { collide: false });
  // Great room furniture: sofas round the rug, fireplace on the north wall of the body.
  k.decals.push({ kind: 'flat', w: 5.4, h: 4.4, x: -16.4, y: M + 0.02, z: 34.6, mat: 'carpet' });
  k.slab(-19.2, M, 32.2, -18.4, M + 0.85, 37, 'fabric');
  k.slab(-18.4, M, 37.2, -14.4, M + 0.85, 38, 'fabric');
  k.slab(-17.2, M, 33.8, -15.4, M + 0.45, 35.6, 'trim');
  k.slab(-25.6, M, 40.4, -23.2, M + 1.2, 41.2, 'stone');
  k.slab(-26.8, B, 43.6, x0, 18.6, 45.8, 'stone');
  // Kitchen island and counters; den desk and bookshelf.
  k.slab(-22.4, M, 51.2, -19.2, M + 0.95, 52.4, 'counter');
  k.slab(-25.6, M, 47.2, -16, M + 0.95, 47.9, 'counter');
  k.slab(-25.6, M, 47.9, -24.9, M + 0.95, 51.8, 'counter');
  k.slab(-13.6, M, 53.6, -11, M + 0.78, 54.6, 'trim');
  k.slab(-14.8, M, 47.2, -12, M + 2.0, 47.6, 'trim');
  k.slab(-8.6, M, 44.4, -6.6, M + 0.85, 45.4, 'fabric');

  // --- Upper floor (loft strip z0..47 over the hall; bedrooms south) ---
  k.slab(x0, U - 0.3, z0, x1, U, z1, 'floorWood', { faceMats: { ny: 'plaster' } });
  k.rail('x', fx0 + 2.0, fx1, z0, U, 'railWood', 'trim');
  const W2 = ROOF;
  k.wall('z', z0, z1, x0 + t / 2, U, W2, t, 'siding', [[42, 45, U + 0.9, U + 2.3], [51, 55, U + 0.9, U + 2.3]], sid('px'));
  k.wall('x', x0, x1, z1 - t / 2, U, W2, t, 'siding', [[-24, -20, U + 0.9, U + 2.3], [-9, -7.6, U, U + 2.2], [-6, -4, U + 0.9, U + 2.3]], sid('nz'));
  k.wall('z', z0, z1, x1 - t / 2, U, W2, t, 'siding', [[43, 47, U + 0.9, U + 2.3], [50, 51.6, U, U + 2.2], [53, 56, U + 0.9, U + 2.3]], sid('nx'));
  k.wall('x', x0, fx0, z0 + t / 2, U, W2, t, 'siding', [[-25, -23, U + 0.9, U + 2.3]], sid('pz'));
  k.wall('x', fx1, x1, z0 + t / 2, U, W2, t, 'siding', [[-10, -5, U + 0.9, U + 2.3]], sid('pz'));
  for (const [a, b] of [[42, 45], [51, 55]] as const) pane(k, 'z', a, b, x0, U + 0.9, U + 2.3);
  for (const [a, b] of [[43, 47], [53, 56]] as const) pane(k, 'z', a, b, x1, U + 0.9, U + 2.3);
  for (const [a, b] of [[-24, -20], [-6, -4]] as const) pane(k, 'x', a, b, z1, U + 0.9, U + 2.3);
  pane(k, 'x', -25, -23, z0, U + 0.9, U + 2.3);
  pane(k, 'x', -10, -5, z0, U + 0.9, U + 2.3);
  k.wall('x', x0 + t, x1 - t, 47, U, W2, 0.2, 'plaster', [[-24, -22.6, U, U + 2.2], [-11, -9.6, U, U + 2.2]]);
  k.wall('z', 47, z1 - t, -14.5, U, W2, 0.2, 'plaster');
  // Bedrooms: beds, wardrobes.
  k.slab(-25.4, U, 51, -22.8, U + 0.6, 53.2, 'fabric');
  k.slab(-17, U, 47.4, -15, U + 2.1, 48.1, 'trim');
  k.slab(-13.6, U, 53.4, -11.4, U + 0.6, 55.8, 'fabric');
  k.slab(-6, U, 47.4, -4, U + 2.1, 48.1, 'trim');
  k.slab(-25.4, U, 40.6, -23.4, U + 0.85, 41.4, 'fabric');

  // --- Roof: ceiling slabs (collide) and the visual hip / gable ---
  k.slab(x0 - 0.4, ROOF, z0 - 0.4, x1 + 0.4, ROOF + 0.3, z1 + 0.4, 'roof', { faceMats: { ny: 'plaster' } });
  k.slab(fx0 - 0.4, ROOF, fz0 - 0.8, fx1 + 0.4, ROOF + 0.3, z0 - 0.4, 'roof', { faceMats: { ny: 'plaster' } });
  const R0 = ROOF + 0.3;
  k.ramp(x0 - 0.8, R0, z0 - 0.8, x1 + 0.8, R0 + 3.2, 48.5, '+z', 'roof', { collide: false, hide: ['ny'] });
  k.ramp(x0 - 0.8, R0, 48.5, x1 + 0.8, R0 + 3.2, z1 + 0.8, '-z', 'roof', { collide: false, hide: ['ny'] });
  k.ramp(fx0 - 0.8, R0, fz0 - 1.2, -17, R0 + 2.8, z0 - 0.8, '+x', 'roof', { collide: false, hide: ['ny'] });
  k.ramp(-17, R0, fz0 - 1.2, fx1 + 0.8, R0 + 2.8, z0 - 0.8, '-x', 'roof', { collide: false, hide: ['ny'] });
  k.trim(-26.8, R0 + 1.6, 43.6, -25.8, R0 + 3.6, 45.8, 'stone');

  // --- Balconies: rear (log pile lands here) wrapping round the east side ---
  k.slab(-13, U - 0.25, z1, -0.4, U, 59.6, 'deck');
  k.slab(x1, U - 0.25, 42, -0.4, U, z1, 'deck');
  k.rail('x', -12.2, -0.4, 59.6, U, 'railWood', 'trim');
  k.rail('z', 42, 59.6, -0.4, U, 'railWood', 'trim');
  k.rail('x', x1, -0.4, 42, U, 'railWood', 'trim');
  for (const [px, pz] of [[-12.8, 59.4], [-6.5, 59.4], [-0.6, 59.4], [-0.6, 50], [-0.6, 42.2]] as const) {
    const g = groundAt(px, pz);
    k.slab(px - 0.12, Math.min(g, B), pz - 0.12, px + 0.12, U - 0.25, pz + 0.12, 'trim');
  }
  // Log pile up the south face to the rear balcony.
  k.ramp(-25, B, z1 + 0.4, -13, U, 59.4, '+x', 'logs', { tag: 'stairs' });
  for (let i = 0; i < 8; i++) {
    const x = -24 + i * 1.5;
    const y = B + ((U - B) * (x + 25)) / 12;
    k.cyl(0.18, 2.0, 6, 'bark', x, y - 0.25, 58.4, 'z', false);
  }

  // --- West deck (main floor) with its stairs down to the garden ---
  k.slab(-29.6, M - 0.25, 41, x0, M, 53, 'deck');
  k.rail('z', 41, 52.8, -29.6, M, 'railWood', 'trim');
  k.rail('x', -29.6, x0, 41, M, 'railWood', 'trim');
  k.ramp(-29.6, B, 53, -27.6, M, 58.6, '-z', 'deck', { tag: 'stairs' });
  for (const [px, pz] of [[-29.4, 41.2], [-29.4, 47], [-29.4, 52.8]] as const) k.slab(px - 0.12, B, pz - 0.12, px + 0.12, M - 0.25, pz + 0.12, 'trim');

  // --- Front porch: deck boards and a little roof over the front door ---
  k.decals.push({ kind: 'flat', w: 8.6, h: 10.6, x: -7.6, y: M + 0.02, z: 34.6, mat: 'deck' });
  k.trim(fx1, M + 2.8, 30, -9, M + 3.0, 34, 'roof');
  k.slab(-9.2, M, 30.1, -9.0, M + 2.8, 30.3, 'trim');
  k.slab(-9.2, M, 33.7, -9.0, M + 2.8, 33.9, 'trim');

  // --- Lights ---
  k.light(-16, M + 4, 34, [1.3, 1.1, 0.85], 11, 'house');
  k.light(-13, M + 2.4, 44, [1.2, 1.05, 0.8], 9, 'house');
  k.light(-20, M + 2.4, 52, [1.2, 1.1, 0.9], 8, 'house');
  k.light(-8, M + 2.4, 52, [1.2, 1.05, 0.8], 8, 'house');
  k.light(-14, B + 2.3, 52, [1.3, 1.1, 0.75], 9, 'house');
  k.light(-14, U + 2.3, 44, [1.2, 1.05, 0.8], 8, 'house');
  k.light(-20, U + 2.3, 52, [1.1, 1.0, 0.8], 7, 'house');
  k.light(-8, U + 2.3, 52, [1.1, 1.0, 0.8], 7, 'house');
  k.trim(-14.4, B + 2.6, 51.8, -13.6, B + 2.75, 52.4, 'lamp');
  k.glow(-16, M + 5.2, 34, [0.6, 0.5, 0.35], 2.5, 'house');
}

// ---------------------------------------------------------------------------------------------
// Greenhouse, courtyard, shed (garden level)
// ---------------------------------------------------------------------------------------------

function greenhouse(k: MapKit): void {
  const sill = B + 0.9;
  const top = B + 3.2;
  // North wing x -52..-38, z 32..40; long wing x -50..-42, z 40..62.
  const sillWall = (axis: 'x' | 'z', from: number, to: number, at: number, holes: [number, number][]) => {
    k.wall(axis, from, to, at, B, sill, 0.4, 'stone', holes.map(([a, b]) => [a, b, B, sill] as Hole));
    glassWall(k, axis, from, to, at, sill, top, holes);
    for (let p = Math.min(from, to); p <= Math.max(from, to) + 1e-6; p += 2) {
      if (axis === 'x') k.trim(p - 0.05, sill, at - 0.05, p + 0.05, top, at + 0.05, 'steel');
      else k.trim(at - 0.05, sill, p - 0.05, at + 0.05, top, p + 0.05, 'steel');
    }
  };
  sillWall('x', -52, -38, 32.2, [[-45.4, -43.6]]);
  sillWall('z', 32, 40, -51.8, [[35, 37]]);
  sillWall('z', 32, 40, -38.2, [[35, 37]]);
  sillWall('x', -52, -50, 39.8, []);
  sillWall('x', -42, -38, 39.8, []);
  sillWall('z', 40, 62, -49.8, []);
  sillWall('z', 40, 62, -42.2, [[50, 51.8]]);
  sillWall('x', -50, -42, 61.8, [[-46.9, -45.1]]);
  // Arched glass roofs (render only): ridge frames and panes.
  const roofs: [number, number, number, number, 'x' | 'z'][] = [[-52, 32, -38, 40, 'x'], [-50, 40, -42, 62, 'z']];
  for (const [ax, az, bx, bz, along] of roofs) {
    if (along === 'x') {
      k.ramp(ax, top, az, bx, top + 1.6, (az + bz) / 2, '+z', 'glass', { collide: false });
      k.ramp(ax, top, (az + bz) / 2, bx, top + 1.6, bz, '-z', 'glass', { collide: false });
      for (let x = ax; x <= bx; x += 2) k.trim(x - 0.05, top, az, x + 0.05, top + 1.65, bz, 'steel');
    } else {
      k.ramp(ax, top, az, (ax + bx) / 2, top + 1.6, bz, '+x', 'glass', { collide: false });
      k.ramp((ax + bx) / 2, top, az, bx, top + 1.6, bz, '-x', 'glass', { collide: false });
      for (let z = az; z <= bz; z += 2) k.trim(ax, top, z - 0.05, bx, top + 1.65, z + 0.05, 'steel');
    }
  }
  k.decals.push({ kind: 'flat', w: 13.4, h: 7.4, x: -45, y: B + 0.02, z: 36, mat: 'tile' });
  k.decals.push({ kind: 'flat', w: 7.4, h: 21.6, x: -46, y: B + 0.02, z: 51, mat: 'tile' });
  // Planter tables (cover) and potted trees.
  for (const z of [43, 47, 54, 58]) k.slab(-48.4, B, z - 0.6, -45.4, B + 0.9, z + 0.6, 'trim');
  for (const x of [-49, -41]) k.slab(x - 1.2, B, 34.6, x + 1.2, B + 0.9, 35.4, 'trim');
  k.slab(-46.6, B, 36.8, -43.4, B + 0.6, 38.4, 'stone');
  k.light(-45, top, 36, [1.0, 1.1, 0.9], 8, 'house');
  k.light(-46, top, 52, [1.0, 1.1, 0.9], 8, 'house');
}

function shed(k: MapKit): void {
  const [x0, z0, x1, z1] = [-26, 72, -18.5, 78];
  const h = B + 2.8;
  k.wall('x', x0, x1, z0 + 0.15, B, h, 0.3, 'boards', [[-23.2, -21.2, B, B + 2.2]]);
  k.wall('x', x0, x1, z1 - 0.15, B, h, 0.3, 'boards');
  k.wall('z', z0, z1, x0 + 0.15, B, h, 0.3, 'boards');
  k.wall('z', z0, z1, x1 - 0.15, B, h, 0.3, 'boards', [[74.2, 75.6, B + 1.1, B + 1.9]]);
  pane(k, 'z', 74.2, 75.6, x1, B + 1.1, B + 1.9);
  k.slab(x0 - 0.3, h, z0 - 0.3, x1 + 0.3, h + 0.2, z1 + 0.3, 'roof');
  k.ramp(x0 - 0.3, h + 0.2, z0 - 0.3, x1 + 0.3, h + 1.2, (z0 + z1) / 2, '+z', 'roof', { collide: false });
  k.ramp(x0 - 0.3, h + 0.2, (z0 + z1) / 2, x1 + 0.3, h + 1.2, z1 + 0.3, '-z', 'roof', { collide: false });
  k.trim(-23.2, B, z0 - 0.02, -21.2, B + 2.2, z0 + 0.02, 'plaster', { collide: false });
  crate(k, -25, 77, 1.0, B);
  k.slab(-21, B, 76.8, -19, B + 0.9, 77.6, 'trim');
}

// ---------------------------------------------------------------------------------------------
// North: Workshop, Substation, Garage, pylon, gate
// ---------------------------------------------------------------------------------------------

function workshop(k: MapKit): void {
  const [x0, z0, x1, z1] = [-61, -19, -49, 3];
  const H = 7.0;
  const lf = L.loft;
  const t = 0.3;
  k.decals.push({ kind: 'flat', w: x1 - x0 - 0.6, h: z1 - z0 - 0.6, x: (x0 + x1) / 2, y: 0.02, z: (z0 + z1) / 2, mat: 'concrete' });
  const inner = (face: 'px' | 'nx' | 'pz' | 'nz'): BoxOpts => ({ faceMats: { [face]: 'boardsDark' } });
  k.wall('z', z0, z1, x1 - t / 2, 0, H, t, 'boards', [[-11, -6, 0, 3.3], [-17, -14, 4.6, 5.8], [-3, 0, 4.6, 5.8]], inner('nx'));
  k.wall('z', z0, z1, x0 + t / 2, 0, H, t, 'boards', [[-12, -9.5, 4.6, 5.8]], inner('px'));
  k.wall('x', x0, x1, z0 + t / 2, 0, H, t, 'boards', [[-56, -54.4, 0, 2.2], [-60, -57, 1.2, 2.2], [-55, -51.5, 4.6, 5.8]], inner('pz'));
  k.wall('x', x0, x1, z1 - t / 2, 0, H, t, 'boards', [[-53, -51.4, 0, 2.2], [-59, -55, 4.6, 5.8]], inner('nz'));
  // Lofts at both ends joined by a catwalk along the east wall; stairs up at each end.
  k.slab(x0 + t, lf - 0.25, z0 + t, x1 - t, lf, -13, 'deck');
  k.slab(x0 + t, lf - 0.25, -3, x1 - t, lf, z1 - t, 'deck');
  k.slab(-51, lf - 0.25, -13, x1 - t, lf, -3, 'deck');
  k.ramp(x0 + t, 0, -12.9, -59.2, lf, -8, '-z', 'deck', { tag: 'stairs' });
  k.ramp(x0 + t, 0, -7.6, -59.2, lf, -3.1, '+z', 'deck', { tag: 'stairs' });
  k.rail('x', -59.2, -51, -13, lf, 'railWood', 'trim');
  k.rail('x', -59.2, -51, -3, lf, 'railWood', 'trim');
  k.rail('z', -13, -3, -51, lf, 'railWood', 'trim');
  // Roof (walkable, reached by the log pile, the lean-to and a ladder on the west wall).
  const RF = L.workshopRoof;
  k.slab(x0, H, z0 - 0.3, x1 + 0.3, RF, z1 + 0.3, 'roofTin', { faceMats: { ny: 'boardsDark' } });
  k.trim(x0, RF, z0 - 0.3, x1 + 0.3, RF + 0.25, z0 - 0.1, 'trim');
  k.trim(x0, RF, z1 + 0.1, x1 + 0.3, RF + 0.25, z1 + 0.3, 'trim');
  // Lean-to woodshed on the west side, its roof at the loft height; log pile up to it.
  k.slab(-64.5, lf - 0.2, -16, x0, lf, -1, 'roofTin');
  for (const z of [-15.8, -8.5, -1.2]) k.slab(-64.4, 0, z - 0.1, -64.2, lf - 0.2, z + 0.1, 'trim');
  k.ramp(-64.5, 0, -1, x0 - 0.05, lf, 4.5, '-z', 'logs', { tag: 'stairs' });
  for (let i = 0; i < 4; i++) k.cyl(0.18, 3.2, 6, 'bark', -62.8, 0.4 + i * 0.85, 3.8 - i * 1.3, 'x', false);
  k.ramp(-62.3, lf, -13, x0, RF, -12, '+x', 'steel', { tag: 'stairs', bullets: false, sight: false });
  for (const z of [-13, -12]) k.trim(-62.3, lf, z - 0.04, x0, RF + 0.8, z + 0.04, 'steel');
  for (let i = 0; i < 3; i++) k.slab(-64.2, 0, -14.5 + i * 3.6, -61.2, 1.2, -12.5 + i * 3.6, 'logs');
  // Inside: the jeep, workbench, crates, barrels.
  car(k, -54.5, -9, false, 'carBlack', 0, true);
  k.slab(-60.6, 0, -17, -59.6, 0.95, -14, 'trim');
  crate(k, -50.3, -17.6, 1.2, 0);
  crate(k, -50.3, -16.3, 1.2, 0);
  crate(k, -51.6, -17.6, 1.2, 0);
  crate(k, -51, 1.4, 1.2, 0);
  for (const [x, z] of [[-60.3, 1.6], [-59.5, 2.2]] as const) k.cyl(0.32, 0.9, 8, 'barrel', x, 0.45, z);
  k.light(-55, H - 0.6, -15, [1.2, 1.1, 0.9], 9, 'house');
  k.light(-55, H - 0.6, -2, [1.2, 1.1, 0.9], 9, 'house');
}

function substation(k: MapKit): void {
  // Transformer yard (fenced).
  const [yx0, yz0, yx1, yz1] = [-44, -50, -26, -34];
  k.decals.push({ kind: 'flat', w: yx1 - yx0, h: yz1 - yz0, x: (yx0 + yx1) / 2, y: 0.02, z: (yz0 + yz1) / 2, mat: 'gravel' });
  k.fence('x', yx0, -37, yz1, 0, 3, 'fence', 'steel', 6);
  k.fence('x', -33, yx1, yz1, 0, 3, 'fence', 'steel', 6);
  k.fence('x', yx0, yx1, yz0, 0, 3, 'fence', 'steel', 6);
  k.fence('z', yz0, -44, yx0, 0, 3, 'fence', 'steel', 6);
  k.fence('z', -40, yz1, yx0, 0, 3, 'fence', 'steel', 6);
  k.fence('z', yz0, -41, yx1, 0, 3, 'fence', 'steel', 6);
  k.fence('z', -37.5, yz1, yx1, 0, 3, 'fence', 'steel', 6);
  for (const [x, z] of [[-40, -47], [-34.5, -47], [-29.5, -47], [-40.5, -37.5], [-29.5, -37.5]] as const) {
    k.slab(x - 1.6, 0, z - 1.4, x + 1.6, 0.25, z + 1.4, 'concrete');
    k.slab(x - 1.1, 0.25, z - 1.0, x + 1.1, 2.6, z + 1.0, 'green');
    for (const s of [-0.5, 0, 0.5]) k.cyl(0.12, 1.0, 6, 'block', x + s, 3.1, z, 'y', false);
    k.trim(x - 1.25, 0.6, z - 1.05, x + 1.25, 2.3, z + 1.05, 'steel', { collide: false });
  }
  // Gantry (render only).
  for (const x of [-42, -36, -30]) for (const z of [-49, -35]) k.trim(x - 0.15, 0, z - 0.15, x + 0.15, 7, z + 0.15, 'steel');
  for (const x of [-42, -36, -30]) k.trim(x - 0.1, 6.6, -49, x + 0.1, 6.9, -35, 'steel');
  k.light(-35, 6, -42, [1.3, 1.25, 1.0], 14, 'sub');
  k.glow(-35, 6.2, -42, [0.6, 0.6, 0.45], 2.5, 'sub');
  // Equipment yard (north).
  const [ex0, ez0, ex1, ez1] = [-32, -66, -16, -52];
  k.fence('x', ex0, -26, ez1, 0, 2.6, 'fence', 'steel', 6);
  k.fence('x', -22, ex1, ez1, 0, 2.6, 'fence', 'steel', 6);
  k.fence('x', ex0, ex1, ez0, 0, 2.6, 'fence', 'steel', 6);
  k.fence('z', ez0, ez1, ex0, 0, 2.6, 'fence', 'steel', 6);
  k.fence('z', ez0, ez1, ex1, 0, 2.6, 'fence', 'steel', 6);
  for (const [x, z, s] of [[-29, -62, 2], [-25, -58.5, 1.6], [-20, -62.5, 2.2], [-19, -56, 1.4], [-28.5, -55.5, 1.4]] as const) k.slab(x - s / 2, 0, z - s / 2, x + s / 2, s * 1.1, z + s / 2, 'green');
  // The Substation Building (block walls, roof reached by ladders north and east).
  const [bx0, bz0, bx1, bz1] = [-16, -47, -3, -39];
  const H = 4.2;
  const RF = L.substationRoof;
  k.decals.push({ kind: 'flat', w: bx1 - bx0 - 0.6, h: bz1 - bz0 - 0.6, x: (bx0 + bx1) / 2, y: 0.02, z: (bz0 + bz1) / 2, mat: 'concrete' });
  k.wall('z', bz0, bz1, bx0 + 0.15, 0, H, 0.3, 'block', [[-44, -42.6, 0, 2.2]]);
  k.wall('z', bz0, bz1, bx1 - 0.15, 0, H, 0.3, 'block', [[-43, -41.6, 0, 2.2]]);
  k.wall('x', bx0, bx1, bz1 - 0.15, 0, H, 0.3, 'block', [[-14, -11, 1.2, 2.2], [-8, -5, 1.2, 2.2]]);
  k.wall('x', bx0, bx1, bz0 + 0.15, 0, H, 0.3, 'block', [[-8, -5.5, 1.2, 2.2]]);
  for (const [a, b] of [[-14, -11], [-8, -5]] as const) pane(k, 'x', a, b, bz1, 1.2, 2.2);
  k.slab(bx0, H, bz0, bx1, RF, bz1, 'concrete', { faceMats: { ny: 'block' } });
  k.trim(bx0, RF, bz1 - 0.2, bx1, RF + 0.4, bz1, 'block');
  k.trim(bx0, RF, bz0, bx0 + 0.2, RF + 0.4, bz1, 'block');
  k.ramp(-12.5, 0, bz0 - 1.2, -11.5, RF, bz0, '+z', 'steel', { tag: 'stairs', bullets: false, sight: false });
  k.ramp(bx1, 0, -46, bx1 + 1.2, RF, -45, '-x', 'steel', { tag: 'stairs', bullets: false, sight: false });
  for (const x of [-12.5, -11.5]) k.trim(x - 0.04, 0, bz0 - 0.1, x + 0.04, RF + 0.9, bz0 - 0.02, 'steel');
  for (const z of [-46, -45]) k.trim(bx1 + 0.02, 0, z - 0.04, bx1 + 0.1, RF + 0.9, z + 0.04, 'steel');
  for (const x of [-15.2, -13.4, -11.6]) k.slab(x - 0.6, 0, bz0 + 0.3, x + 0.6, 2.0, bz0 + 0.9, 'green');
  k.slab(-8, 0, -42.8, -6, 0.9, -41.2, 'trim');
  k.light(-9.5, H - 0.4, -43, [1.1, 1.15, 1.0], 8, 'sub');
  k.lampPole(-1.5, -38, 6.5, -0.8, 0, 'steel', 'lamp', [1.5, 1.3, 0.9], 15, 'lamp');
  // The pylon in the far corner (lattice legs, platform at 6 m with a ladder).
  const [px, pz] = [-30, -75];
  const PY = L.pylon;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    k.slab(px + sx * 2.4 - 0.2, 0, pz + sz * 2.4 - 0.2, px + sx * 2.4 + 0.2, 1.2, pz + sz * 2.4 + 0.2, 'concrete');
    for (let i = 0; i < 6; i++) {
      const y0 = i * 3.4;
      const r = 2.4 - i * 0.36;
      k.trim(px + sx * r - 0.09, y0, pz + sz * r - 0.09, px + sx * r + 0.09, y0 + 3.5, pz + sz * r + 0.09, 'steel');
    }
  }
  for (let i = 1; i < 6; i++) {
    const y = i * 3.4;
    const r = 2.4 - i * 0.36;
    k.trim(px - r, y, pz - r - 0.05, px + r, y + 0.1, pz - r + 0.05, 'steel');
    k.trim(px - r, y, pz + r - 0.05, px + r, y + 0.1, pz + r + 0.05, 'steel');
    k.trim(px - r - 0.05, y, pz - r, px - r + 0.05, y + 0.1, pz + r, 'steel');
    k.trim(px + r - 0.05, y, pz - r, px + r + 0.05, y + 0.1, pz + r, 'steel');
  }
  k.trim(px - 4.5, 20, pz - 0.15, px + 4.5, 20.3, pz + 0.15, 'steel');
  k.slab(px - 2, PY - 0.25, pz - 2, px + 2, PY, pz + 2, 'steel', { bullets: false, sight: false });
  k.ramp(px + 2, 0, pz - 0.5, px + 3.3, PY, pz + 0.5, '-x', 'steel', { tag: 'stairs', bullets: false, sight: false });
  k.rail('x', px - 2, px + 2, pz - 2, PY, 'railSteel', 'steel');
  k.rail('x', px - 2, px + 2, pz + 2, PY, 'railSteel', 'steel');
  k.rail('z', pz - 2, pz + 2, px - 2, PY, 'railSteel', 'steel');
  k.rail('z', pz - 2, pz - 0.6, px + 2, PY, 'railSteel', 'steel');
  k.rail('z', pz + 0.6, pz + 2, px + 2, PY, 'railSteel', 'steel');
  // Power lines from the pylon arm down to two tall gantry posts at the yard's north fence.
  for (const x of [px - 4, px + 4]) {
    k.trim(x - 0.03, 19.9, pz, x + 0.03, 19.96, yz0, 'steel', { collide: false });
    k.trim(x - 0.15, 0, yz0 - 0.15, x + 0.15, 20, yz0 + 0.15, 'steel');
  }
  k.glow(px, 20.6, pz, [1, 0.25, 0.2], 1.2, undefined, true);
}

function garage(k: MapKit): void {
  const H = 3.6;
  const RF = L.garageRoof;
  k.decals.push({ kind: 'flat', w: 13.6, h: 9.6, x: -3, y: 0.02, z: -6, mat: 'concrete' });
  k.decals.push({ kind: 'flat', w: 7.6, h: 4.6, x: -2, y: 0.02, z: -13.5, mat: 'concrete' });
  // Main garage x -10..0 (closed), carport x 0..4 (open east and south).
  k.wall('x', -10, 0, -1.15, 0, H, 0.3, 'boards', [[-8.5, -5.5, 0, 2.6], [-3.5, -0.5, 0, 2.6]]);
  k.wall('z', -11, -1, -9.85, 0, H, 0.3, 'boards', [[-7, -5.6, 0, 2.2]]);
  k.wall('x', -10, 4, -10.85, 0, H, 0.3, 'boards', [[-4, -2.6, 0, 2.2], [0.6, 3, 1.1, 2.1]]);
  k.wall('z', -11, -1, 0, 0, H, 0.2, 'boardsDark', [[-9, -3, 0, 2.6]]);
  for (const z of [-10.7, -1.3]) k.slab(3.75, 0, z - 0.15, 4.05, H, z + 0.15, 'trim');
  pane(k, 'x', 0.6, 3, -10.85, 1.1, 2.1);
  // Annex (store room) against the big rock.
  k.wall('z', -16, -11, -5.85, 0, H, 0.3, 'boards');
  k.wall('x', -6, 2, -15.85, 0, H, 0.3, 'boards', [[-3, -1, 1.2, 2.0]]);
  k.wall('z', -16, -11, 1.85, 0, H, 0.3, 'boards', [[-14, -12.6, 0, 2.2]]);
  pane(k, 'x', -3, -1, -15.85, 1.2, 2.0);
  // Roof (walkable from the big rock).
  k.slab(-10.3, H, -11.2, 4.3, RF, -0.8, 'roof', { faceMats: { ny: 'boardsDark' } });
  k.slab(-6, H, -16.2, 2.2, RF, -11.2, 'roof', { faceMats: { ny: 'boardsDark' } });
  // Inside: a car, workbench, shelves, tyres; crates in the store room.
  car(k, -7.6, -6.2, false, 'carRed', 0);
  k.slab(-9.7, 0, -10.6, -8.2, 0.95, -7.6, 'trim');
  k.slab(-9.7, 0, -4.4, -9.2, 2.0, -1.6, 'trim');
  for (const z of [-3.2, -2.4]) k.cyl(0.36, 0.25, 8, 'rubber', 2.8, 0.36, z, 'x');
  crate(k, -5, -15, 1.2, 0);
  crate(k, -3.8, -15, 1.2, 0);
  crate(k, 1, -15, 1.0, 0);
  k.light(-4, H - 0.4, -6, [1.2, 1.1, 0.85], 8, 'house');
  k.lampPole(5.4, -0.2, 5, -0.7, 0, 'steel', 'lamp', [1.5, 1.3, 0.9], 13, 'lamp');
}

/** The big rock by the Garage (walkable top, a rock ramp up its west side). */
function bigRock(k: MapKit): void {
  const top = L.bigRock;
  for (const [x0, z0, x1, z1] of [[-27, -28, -8, -15], [-30, -29, -27, -19], [-22, -15, -12, -12.5], [-24, -30, -16, -28], [-8, -24, -6.2, -15]] as const) k.slab(x0, -0.5, z0, x1, top, z1, 'rock');
  k.ramp(-35, 0, -27, -30, top, -21, '+x', 'rock');
  for (const [x, z, s] of [[-26, -13.5, 2.2], [-14, -30.6, 2.6], [-9.5, -27.4, 1.8], [-31, -17.5, 2.0], [-28.6, -30.4, 1.6]] as const) boulder(k, x, z, s);
  for (const [x, z, h] of [[-20, -22, 12], [-12, -19, 10], [-25, -26, 11]] as const) pine(k, x, z, h, top);
}

/** The outcrop in front of the Lodge: boulders along its edges, pines on top. */
function outcrop(k: MapKit): void {
  const top = L.outcrop;
  for (const [x, z, s] of [[13.5, 11, 3], [18, 10.6, 3.4], [23, 11.4, 2.8], [24.6, 16, 3], [24.8, 24, 2.6], [24.4, 31, 3.2], [20, 36.6, 2.6], [15, 36.4, 2.2]] as const) {
    k.add({ min: { x: x - s / 2, y: top - 1.2, z: z - s / 2 }, max: { x: x + s / 2, y: top + s * 0.25, z: z + s / 2 }, mat: 'rock', ry: hash(x, z) * PI, collide: false });
  }
  for (const [x, z, s] of [[16, 8.6, 2.4], [22, 8.8, 2.0], [26.4, 20, 2.2], [26.6, 33, 2.4]] as const) boulder(k, x, z, s);
  for (const [x, z, h] of [[16, 16, 13], [21, 21, 12], [17, 29, 14], [22, 33, 11]] as const) pine(k, x, z, h, top);
  for (const [x, z, s] of [[14, 22, 1.4], [19, 26, 1.2]] as const) k.slab(x - s, top, z - s * 0.6, x + s, top + 0.9, z + s * 0.6, 'rock');
}

// ---------------------------------------------------------------------------------------------
// East: Boathouse, stairs, shore
// ---------------------------------------------------------------------------------------------

function boathouse(k: MapKit): void {
  const P = L.plateau;
  const F = L.boathouse;
  const [x0, z0, x1, z1] = [34, 22, 47, 31];
  const H = F + 3.0;
  // Raised floor and the east deck, steps west and east.
  k.slab(x0, P - 0.5, z0, x1, F, z1, 'deck', { faceMats: { px: 'boardsDark', nx: 'boardsDark', pz: 'boardsDark', nz: 'boardsDark' } });
  k.slab(x1, P - 0.5, 23, 52, F, 30, 'deck', { faceMats: { px: 'boardsDark', nx: 'boardsDark', pz: 'boardsDark', nz: 'boardsDark' } });
  k.ramp(31.4, P, 25, x0, F, 27.6, '+x', 'deck', { tag: 'stairs' });
  k.ramp(52, P, 25.4, 54.6, F, 27.6, '-x', 'deck', { tag: 'stairs' });
  k.rail('z', 23, 25.4, 52, F, 'railWood', 'trim');
  k.rail('z', 27.6, 30, 52, F, 'railWood', 'trim');
  k.rail('x', x1, 52, 23, F, 'railWood', 'trim');
  k.rail('x', x1, 52, 30, F, 'railWood', 'trim');
  // Walls (thin boards: bullets go through), wide opening onto the deck.
  const thin: BoxOpts = { bullets: false };
  k.wall('x', x0, x1, z0 + 0.12, F, H, 0.24, 'boards', [[36, 39, F + 0.9, F + 2.1], [42, 45, F + 0.9, F + 2.1]], thin);
  k.wall('x', x0, x1, z1 - 0.12, F, H, 0.24, 'boards', [[36.5, 39.5, F + 0.9, F + 2.1], [41, 44, F + 0.9, F + 2.1]], thin);
  k.wall('z', z0, z1, x0 + 0.12, F, H, 0.24, 'boards', [[25, 27.6, F, F + 2.3]], thin);
  k.wall('z', z0, z1, x1 - 0.12, F, H, 0.24, 'boards', [[23.5, 29.5, F, F + 2.5]], thin);
  // Roof: low pitch, walkable (from the rock behind it).
  const RE = L.boathouseRoof;
  k.slab(x0 - 0.5, H, z0 - 0.6, x1 + 0.5, RE, z1 + 0.6, 'roof', { faceMats: { ny: 'boardsDark' } });
  k.ramp(x0 - 0.5, RE, z0 - 0.6, x1 + 0.5, RE + 0.8, 26.5, '+z', 'roof');
  k.ramp(x0 - 0.5, RE, 26.5, x1 + 0.5, RE + 0.8, z1 + 0.6, '-z', 'roof');
  // The rock behind it (graffiti rock): a slope up to just under the eaves.
  k.ramp(36, P, z1 + 0.65, 44, RE - 0.65, 36, '-z', 'rock', { faceMats: { px: 'rock', nx: 'rock' } });
  k.decals.push({ kind: 'wall', w: 5, h: 1.6, x: 44.02, y: P + 0.4, z: 34.4, ry: PI / 2, mat: 'hazard' });
  // Inside: the boat on its trailer, crates; sandbags on the deck.
  k.slab(37, F, 25.4, 44, F + 0.9, 27.6, 'boardsDark');
  k.slab(37.6, F + 0.9, 25.6, 43.4, F + 1.2, 27.4, 'carWhite', { collide: false });
  crate(k, 35, 23, 1.0, F);
  crate(k, 35, 30, 1.0, F);
  crate(k, 46, 30, 1.0, F);
  for (const z of [23.6, 24.6]) k.slab(49.4, F, z - 0.45, 51.6, F + 0.6, z + 0.45, 'sandbag');
  k.slab(49.4, F + 0.6, 23.3, 51.6, F + 1.0, 25, 'sandbag');
  k.light(40.5, H - 0.4, 26.5, [1.2, 1.1, 0.85], 9, 'house');
  // Curved Stairs from the north-east field up to the plateau (with rails).
  k.ramp(28, 2.4, 5.4, 32, P, 10, '+z', 'deck', { tag: 'stairs' });
  k.trim(27.8, 2.4, 5.4, 28, P + 1, 10, 'trim', { collide: false });
  k.trim(32, 2.4, 5.4, 32.2, P + 1, 10, 'trim', { collide: false });
  // Long Stairs from the front yard down to the plateau.
  k.ramp(12, P, 38.4, 25, M, 41.6, '-x', 'deck', { tag: 'stairs' });
  k.rail('x', 12, 25, 38.3, P, 'railWood', 'trim', 1.0);
  for (const x of [15, 19, 23]) k.slab(x - 0.12, P, 41.5, x + 0.12, M - ((x - 12) / 13) * (M - P) + 0.9, 41.74, 'trim');
  // Dock on the lake (out of bounds) and a rowboat.
  k.slab(76, 0.6, 29.6, 86, 1.25, 31.4, 'deck', { collide: false });
  for (const x of [77, 81, 85]) for (const z of [29.7, 31.3]) k.trim(x - 0.1, 0, z - 0.1, x + 0.1, 1.6, z + 0.1, 'trim');
  k.slab(83, 0.7, 33, 87, 1.1, 34.4, 'carWhite', { collide: false });
  k.decals.push({ kind: 'flat', w: 70, h: 34, x: 115, y: 1.0, z: 27, mat: 'water' });
  k.slab(72.6, 0, 29.4, 77.4, 3.6, 34.2, 'boards');
  k.slab(72.4, 3.6, 29.2, 77.6, 3.9, 34.4, 'roofTin');
}

// ---------------------------------------------------------------------------------------------
// Grounds: terraces, waterfall, creek, road, gate, cover, trees, boundary dressing
// ---------------------------------------------------------------------------------------------

function grounds(k: MapKit): void {
  // --- Waterfall terraces: rock step at z 16 (creek falls there), stone walls, steps ---
  k.ramp(-38.2, 1.4, 13, -36, 3.4, 16, '+z', 'deck', { tag: 'stairs' });
  k.ramp(-24, 1.4, 13, -21, 3.4, 16, '+z', 'stone', { tag: 'stairs' });
  stoneWall(k, 'x', -45, -30, 22, 1.0);
  stoneWall(k, 'x', -27, -14, 22, 1.0);
  stoneWall(k, 'x', -44, -36, 27, 1.1);
  stoneWall(k, 'x', -32, -23, 27.5, 1.1);
  stoneWall(k, 'x', -36, -26, 9.5, 1.0);
  stoneWall(k, 'x', -22, -14, 10, 1.0);
  stoneWall(k, 'z', 6, 14, -30, 1.0);
  // Curved garden walls round the front lawn (stepped arcs).
  for (const [x0, x1, z] of [[-24, -21, 24.5], [-21, -16, 23.6], [-16, -13, 24.5]] as const) stoneWall(k, 'x', x0, x1, z, 0.9);
  // The creek: from the garden past the Greenhouse, over the step, north to the Substation culvert.
  const W = 'water';
  k.decals.push({ kind: 'wall', w: 3, h: 1.45, x: -40, y: 1.98, z: 15.98, ry: 0, mat: W });
  const creek: [number, number, number, number][] = [[-41.5, 16, -38.5, 30.5], [-41.5, -31, -38.5, 16], [-41.5, -33, 2, -30.2], [12, -33, 30, -30.2]];
  for (const [x0, z0, x1, z1] of creek) {
    const n = Math.max(1, Math.round(Math.max(x1 - x0, z1 - z0) / 2));
    const alongX = x1 - x0 > z1 - z0;
    for (let i = 0; i < n; i++) {
      const a = alongX ? x0 + ((x1 - x0) * i) / n : z0 + ((z1 - z0) * i) / n;
      const b = alongX ? x0 + ((x1 - x0) * (i + 1)) / n : z0 + ((z1 - z0) * (i + 1)) / n;
      const cx = alongX ? (a + b) / 2 : (x0 + x1) / 2;
      const cz = alongX ? (z0 + z1) / 2 : (a + b) / 2;
      const y = groundAt(cx, cz) + 0.03;
      k.decals.push({ kind: 'flat', w: alongX ? b - a : x1 - x0, h: alongX ? z1 - z0 : b - a, x: cx, y, z: cz, mat: W, seg: 1 });
    }
  }
  for (const [x, z, s] of [[-42.6, 14.6, 1.8], [-37.2, 14.4, 1.6], [-42.8, 20, 1.4], [-37, 24, 1.2], [-42.4, 4, 1.4], [-37.4, -6, 1.2], [-43, -18, 1.6]] as const) boulder(k, x, z, s);
  // Culvert walls along the Substation stretch and the slab bridge under the road.
  k.slab(-41.5, 0, -33.4, 2, 0.3, -33, 'concrete');
  k.slab(-38.5, 0, -30.2, 2, 0.3, -29.8, 'concrete');
  k.decals.push({ kind: 'flat', w: 10, h: 3.6, x: 7, y: 0.05, z: -31.6, mat: 'concrete' });
  // A burnt-out car on the culvert slab.
  k.slab(-20, 0, -33.6, -16, 0.15, -29.6, 'concrete');
  car(k, -18, -31.6, true, 'charred', 0.15);

  // --- Driveway: gravel from the gate to the Main Road, cars at the front yard ---
  k.decals.push({ kind: 'flat', w: 8, h: 56, x: 7, y: 0.02, z: -24, mat: 'gravel' });
  k.decals.push({ kind: 'flat', w: 6, h: 14, x: -5, y: 0.02, z: -3, mat: 'gravel' });
  car(k, 5.6, 33, false, 'carBlack', M, true);
  car(k, 8.8, 46, false, 'carWhite', M, true);
  car(k, 6.6, 15, false, 'carWhite', undefined, true);
  // The gate at the top of the driveway (north-east): stone pillars, iron gate.
  for (const x of [2, 12]) k.slab(x - 0.6, 0, -52.6, x + 0.6, 2.8, -51.4, 'stone');
  k.decals.push({ kind: 'wall', w: 8.8, h: 2.2, x: 7, y: 0, z: -52, ry: 0, mat: 'fence' });
  k.trim(2.6, 2.1, -52.06, 11.4, 2.2, -51.94, 'steel');
  k.trim(2.6, 0.2, -52.06, 11.4, 0.3, -51.94, 'steel');
  // Driveway lamps.
  for (const [x, z, dx] of [[1.4, -20, 0.8], [12.6, 6, -0.8], [-1.6, 28.6, 0.8], [11.4, 52, -0.8]] as const) {
    const g = groundAt(x, z);
    k.slab(x - 0.11, g, z - 0.11, x + 0.11, g + 5, z + 0.11, 'steel');
    k.trim(Math.min(x, x + dx) - 0.06, g + 4.8, z - 0.06, Math.max(x, x + dx) + 0.06, g + 4.92, z + 0.06, 'steel');
    k.trim(x + dx - 0.3, g + 4.6, z - 0.2, x + dx + 0.3, g + 4.8, z + 0.2, 'lamp');
    k.light(x + dx, g + 4.2, z, [1.5, 1.3, 0.9], 14, 'lamp');
    k.glow(x + dx, g + 4.5, z, [0.65, 0.55, 0.38], 3, 'lamp');
  }
  // Retaining wall caps along the Lodge Path (stone kerb on the high side).
  stoneWall(k, 'z', 12, 26, -11.6, 0.8, 0.5, 2);

  // --- Cover across the map: logs, rocks, crates, pallets of firewood ---
  const logs: [number, number, 'x' | 'z'][] = [[-70, -10, 'z'], [-66, -22, 'x'], [-44, -26, 'z'], [-6, -40, 'x'], [28, -6, 'x'], [40, 0, 'z'], [-30, 67, 'x'], [-6, 80, 'x'], [-20, 86, 'z'], [62, 26, 'z'], [52, 16, 'x'], [-50, 4, 'x']];
  for (const [x, z, ax] of logs) k.cyl(0.4, 4.2, 7, 'bark', x, groundAt(x, z) + 0.35, z, ax);
  const rocks: [number, number, number][] = [[-74, -16, 2.4], [-66, -24, 1.8], [-52, -24, 2.0], [-46, -12, 1.6], [-30, -40, 1.6], [16, -24, 2.2], [30, -12, 1.8], [44, -10, 2.0], [40, 8, 1.6], [52, 34, 2.0], [66, 18, 1.8], [70, 34, 1.6], [-34, 12, 2.0], [-18, 18, 1.6], [-10, 64, 1.8], [2, 86, 2.2], [-34, 84, 2.0], [-40, 66, 1.6], [-4, -26, 1.6], [-52, 8, 1.8]];
  for (const [x, z, s] of rocks) boulder(k, x, z, s);
  for (const [x, z] of [[-30, 64], [-37, 56], [-14, 62]] as const) crate(k, x, z, 1.2, B);
  k.slab(-38.6, B, 63, -36.4, B + 1.0, 64, 'logs');
  k.slab(-17, B, 61, -15, B + 1.0, 62, 'logs');
  // Gravel courtyard between the Greenhouse and the Lodge (Domination A), the Lodge's back terrace.
  k.decals.push({ kind: 'flat', w: 14, h: 12, x: -34, y: B + 0.02, z: 60, mat: 'gravel' });
  k.decals.push({ kind: 'flat', w: 22, h: 6, x: -14.5, y: B + 0.02, z: 63, mat: 'gravel' });
  stoneWall(k, 'x', -41, -36, 68, 0.8);
  stoneWall(k, 'z', 64, 68, -41, 0.8);
  // NE field: a picnic shelter frame and stacked pallets.
  for (let i = 0; i < 4; i++) k.slab(34, i * 0.15 + groundAt(35, -4), -5, 36.2, (i + 1) * 0.15 + groundAt(35, -4), -3.6, 'trim');
  crate(k, 22, -10);
  crate(k, 23.2, -10);
  // Backwoods: a firewood stack and a tarp.
  k.slab(-40, B, 72, -37, B + 1.2, 73, 'logs');
  k.slab(-30, B, 76, -28.6, B + 1.2, 80, 'logs');

  // --- Trees: the pine forest (trunks collide), denser towards the edges ---
  const keepOut: [number, number, number, number][] = [
    [-63, -21, -47, 6], [-46, -52, -24, -32], [-34, -68, -14, -50], [-18, -49, 0, -37], [-12, -18, 6, 1], [-31, -31, -5, -11],
    [-42.5, 3, -36.5, 31], [-43, -34, 3, -29], [1, -60, 13, 4], [-13, 3, 13, 27], [-28, 26, -1, 59], [-54, 30, -36, 64],
    [-27, 70, -17, 80], [-20, 64, 9, 90], [30, 18, 56, 38], [27, 3, 34, 12], [-37, 53, -27, 66], [10, 36, 27, 44],
    [-62, -44, -40, -24], [-4, -50, 13, -34], [-3, 39, 13, 66], [-65, -17, -60, 6], [24, -40, 38, -30], [-36, 74, -32, 80],
    [-1, -48, 3, -36], [-67, -42, -45, -24],
  ];
  const blocked = (x: number, z: number) => keepOut.some(([a, b, c, d]) => x > a - 1 && x < c + 1 && z > b - 1 && z < d + 1);
  for (let gx = -86; gx <= 82; gx += 6.5) {
    for (let gz = -84; gz <= 92; gz += 6.5) {
      const x = gx + (hash(gx, gz) - 0.5) * 4;
      const z = gz + (hash(gz, gx) - 0.5) * 4;
      const inside = insidePoly(ESTATE_OUTLINE, x, z);
      if (!inside) continue;
      if (blocked(x, z)) continue;
      // Rock tops and the plateau keep their own trees; keep the open lanes thinner.
      if (x > 12 && x < 25 && z > 10 && z < 37) continue;
      const keep = hash(x * 0.7, z * 1.3);
      if (keep > 0.55) continue;
      pine(k, x, z, 11 + hash(z, x) * 7);
    }
  }
  // Outside the outline: a dense ring of pines (render only) so the edge reads as forest.
  for (let i = 0; i < ESTATE_OUTLINE.length; i++) {
    const [ax, az] = ESTATE_OUTLINE[i]!;
    const [bx, bz] = ESTATE_OUTLINE[(i + 1) % ESTATE_OUTLINE.length]!;
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 5));
    for (let j = 0; j < n; j++) {
      const t = (j + 0.5) / n;
      const px = ax + (bx - ax) * t;
      const pz = az + (bz - az) * t;
      for (const d of [3, 8, 14]) {
        const nx = az === bz ? 0 : 1;
        const nz = az === bz ? 1 : 0;
        for (const s of [-1, 1]) {
          const x = px + nx * s * d + (hash(px, d) - 0.5) * 3;
          const z = pz + nz * s * d + (hash(d, pz) - 0.5) * 3;
          if (insidePoly(ESTATE_OUTLINE, x, z)) continue;
          if (x > 78 && z > 10 && z < 44) continue; // the lake
          if (hash(x, z) > 0.7) continue;
          pine(k, x, z, 13 + hash(z, x) * 8, groundAt(x, z), false);
        }
      }
    }
  }
  // Distant tree line and the snowy Caucasus peaks.
  const ring = (mat: string, radius: number, count: number, w: number, h: number, y: number, phase: number) => {
    for (let i = 0; i < count; i++) {
      const t = phase + (i / count) * PI * 2;
      const r = radius * (1 + 0.08 * Math.sin(i * 2.7));
      const x = -5 + Math.cos(t) * r;
      const z = 5 + Math.sin(t) * r;
      k.decals.push({ kind: 'wall', w, h: h * (0.85 + 0.3 * Math.abs(Math.sin(i * 1.9))), x, y, z, ry: Math.atan2(-Math.cos(t), -Math.sin(t)), mat, uv: 'raw', seg: 3 });
    }
  };
  ring('pines', 135, 14, 75, 20, 2, 0.1);
  ring('mountains', 200, 10, 160, 80, -6, 0.35);
}

// ---------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------

export function buildEstate(): MapData {
  const k = new MapKit();
  terrain(k);
  outlineClips(k, ESTATE_OUTLINE, -4, 40);
  lodge(k);
  greenhouse(k);
  shed(k);
  workshop(k);
  substation(k);
  garage(k);
  bigRock(k);
  outcrop(k);
  boathouse(k);
  grounds(k);

  const face = (x: number, z: number, tx: number, tz: number, y = groundAt(x, z)) => spawnAt(x, z, yawTowards(x, z, tx, tz), y);
  // Team 0 (Spetsnaz): the Backwoods behind the Lodge.
  const team0: SpawnPoint[] = [
    face(-16, 68, -14, 40), face(-11, 69, -14, 40), face(-6, 68, -6, 40), face(-1, 70, 4, 50), face(4, 71, 4, 50),
    face(-14, 74, -30, 50), face(-9, 75, -14, 40), face(-4, 74, -6, 40), face(1, 76, 4, 50), face(5, 78, 4, 50),
    face(-14, 82, -14, 40), face(-8, 83, -14, 40), face(-2, 84, -6, 40), face(4, 85, 4, 50), face(-34, 76, -34, 50),
  ];
  // Team 1 (TF141): west of the Substation yard, and along the driveway by the Substation Building.
  const team1: SpawnPoint[] = [
    face(-60, -36, -50, 0), face(-56, -34, -50, 0), face(-52, -35, -45, 0), face(-48, -33, -40, 0), face(-60, -31, -55, 0),
    face(-55, -29, -50, 0), face(-50, -29, -40, 0), face(-53, -41, -45, 0), face(0.5, -48, 0, 0), face(6, -46, 6, 0),
    face(10, -46, 10, 0), face(6, -41, 6, 0), face(10, -40, 10, 0), face(0.5, -43, 0, 0),
  ];
  const ffa: SpawnPoint[] = [
    face(-72, -15, -50, 0), face(-62, -24, -40, 0), face(-36, -56, -30, -40), face(-8, -55, 0, -40), face(15, -30, 20, 0),
    face(30, -9, 40, 10), face(42, -5, 40, 10), face(40, 5, 30, 20), face(54, 20, 40, 26), face(66, 30, 50, 26),
    face(-30, 24, -20, 40), face(-24, 8, -10, 20), face(-4, 14, -4, 30), face(6, 50, -6, 44), face(-32, 48, -40, 40),
    face(-40, 75, -30, 60), face(-10, 88, -10, 60), face(-34, 34, -20, 30), face(-45, -20, -55, -8), face(-22, -36, -10, -20),
    face(-20, 52, -20, 44, U), face(-55, -16.5, -55, -8, L.loft),
  ];
  const sdAttack: SpawnPoint[] = [face(-58, -36, -40, 0), face(-54, -34, -40, 0), face(-50, -34, -40, 0), face(-46, -31, -30, 0), face(-58, -31, -40, 0), face(-53, -29, -40, 0), face(-49, -28, -30, 0), face(-53, -41, -40, 0)];
  const sdDefend: SpawnPoint[] = [face(-15, 70, -14, 40), face(-10, 70, -14, 40), face(-5, 70, -6, 40), face(0, 71, 4, 50), face(-14, 76, -14, 40), face(-9, 77, -14, 40), face(-4, 77, -6, 40), face(1, 79, 4, 50)];

  // The pocket in the outline's notch by the gravel plateau sat 3.2 m below it: easy to drop into,
  // impossible to climb out. Raised flush with the plateau.
  k.slab(8.0, 0, 57.0, 12.0, 9.6, 60.0, 'gravel');

  return {
    id: 'estate',
    name: 'Estate',
    bounds: { min: { x: -86, y: -4, z: -84 }, max: { x: 82, y: 40, z: 94 } },
    materials: MATERIALS,
    brushes: k.brushes,
    decals: k.decals,
    props: k.props,
    lights: k.lights,
    spawns: { teams: [team0, team1], ffa },
    modeSpawns: { sd: { attackers: sdAttack, defenders: sdDefend } },
    objectives: {
      dom: [
        { id: 'A', x: -34, y: B, z: 60, radius: 3 },
        { id: 'B', x: -2.5, y: 0, z: -5, radius: 2.6 },
        { id: 'C', x: -55, y: 0, z: -5, radius: 3 },
      ],
      sd: [
        { id: 'A', x: -8, y: M, z: 44, radius: 2.2, team: 0 },
        { id: 'B', x: 30, y: L.plateau, z: 19, radius: 2.2, team: 0 },
      ],
      sdBomb: [{ id: 'bomb', x: -52, y: 0, z: -37, radius: 1, team: 1 }],
      hq: [
        { id: 'substation', x: -35, y: 0, z: -42, radius: 3 },
        { id: 'workshop', x: -55, y: 0, z: -12, radius: 3 },
        { id: 'garage', x: -5, y: 0, z: -6, radius: 2.6 },
        { id: 'boathouse', x: 40.5, y: L.boathouse, z: 24, radius: 2.4 },
        { id: 'lodge', x: -11, y: M, z: 51, radius: 2.4 },
        { id: 'greenhouse', x: -46, y: B, z: 48, radius: 2.4 },
      ],
    },
    times: [
      { id: 'overcast', name: 'Overcast', clock: '14:40', sky: 'skyGrey', unlit: [1, 1, 1], skyRot: 0, sunDir: unitVec(0.3, 0.8, 0.5), sun: [0.55, 0.56, 0.58], amb: [0.56, 0.6, 0.66], fog: [0.66, 0.69, 0.73], fogNear: 40, fogFar: 190, lights: { house: 0.6, sub: 0.4 }, glow: 0.3 },
      { id: 'dusk', name: 'Dusk', clock: '18:50', sky: 'skyDusk', unlit: [1, 0.86, 0.76], skyRot: PI / 2, sunDir: unitVec(-0.8, 0.35, 0.3), sun: [1.15, 0.62, 0.38], amb: [0.3, 0.26, 0.36], fog: [0.78, 0.5, 0.42], fogNear: 30, fogFar: 150, lights: { house: 1, lamp: 0.85, sub: 0.8 }, glow: 0.7 },
    ],
    defaultTime: 'overcast',
    hotspots: [
      { x: -16, y: M, z: 35 }, // great room
      { x: -18, y: U, z: 43.5 }, // loft
      { x: -14, y: B, z: 54 }, // game room
      { x: -6, y: U, z: 58.3 }, // rear balcony
      { x: -46, y: B, z: 50 }, // greenhouse
      { x: -34, y: B, z: 60 }, // courtyard
      { x: -55, y: 0, z: -9 }, // workshop
      { x: -55, y: L.loft, z: -16 }, // workshop loft
      { x: -55, y: L.workshopRoof, z: -8 }, // workshop roof
      { x: -9.5, y: L.substationRoof, z: -43 }, // substation roof
      { x: -35, y: 0, z: -42 }, // transformer yard
      { x: -4, y: 0, z: -6 }, // garage
      { x: -18, y: L.bigRock, z: -24 }, // big rock
      { x: 40.5, y: L.boathouse, z: 23.6 }, // boathouse
      { x: 40.5, y: L.boathouseRoof + 0.3, z: 29.5 }, // boathouse roof
      { x: 17, y: L.outcrop, z: 24 }, // outcrop
      { x: 66, y: groundAt(66, 30), z: 30 }, // shore
      { x: -30, y: L.pylon, z: -75 }, // pylon platform
      { x: -22, y: B, z: 75 }, // shed
      { x: -30, y: groundAt(-30, 20), z: 20 }, // waterfall terraces
    ],
  };
}
