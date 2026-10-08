/**
 * Summit (recreation of Black Ops 1's Summit, the Soviet listening post on a Ural mountaintop;
 * owner: the summit map). Traced from the BO1 overhead (Prima-style A1..E5 grid map) and checked
 * against the BO7 remake's minimap and the BO4 remake's overhead; see docs/maps/summit-reference.md.
 *
 * Metres, +x east, +z south (north is up on the BO1 overhead), yaw 0 faces north (-z). The map is a
 * narrow north-south ridge with drops on every side:
 *
 *   Barracks        the north end: two-part block, team 0 spawns in the plaza in front of it
 *   Fuel Tank       the round tank in the north-east corner, a walkable ring round it
 *   North Plaza     z -40 .. -30, the snowmobile, crates, a guard hut on the west bump
 *   Cable Car       the station north-west of centre (bull wheel, parked car); the cable leaves its
 *                   west wall for the Gondola hanging off the cliff
 *   Alley           between the Cable Car station and Comms, Domination A
 *   Comms           the north-east block with the red/white antenna mast
 *   Bridge          the steel bridge on the west cliff path, over a chasm; the ramp at its north end
 *                   jumps into the Gondola
 *   Tower           grated platform over the chasm, ladder cut off: reached from the control room's
 *                   walkway, out of its window and across the Gallery roof
 *   Control         the central building: the double-height Control Room (Domination B at the
 *                   consoles) with its mezzanine and walkway, the glass Gallery along the west side
 *                   overlooking the valley, rooms along the east
 *   Cliffside       the west path curving out round the Control building past the Ledge
 *   Catwalk         the grated walkway down the east side over the drop, Domination C
 *   Garage          south-west, with an open bay (S&D A)
 *   Courtyard       south of Control, the snowcat
 *   Lab             south-east (S&D B), the generator hut north of it
 *   Radar           the south building with the radar dish beside it
 *   South Yard      the southern tail, team 1 spawn; comms dishes and the helipad beyond the edge
 */
import type { Vec3 } from '../math';
import { MapKit, yawTo, type Hole } from './bo-kit';
import { unitVec, type Brush, type MapData, type MaterialDef, type ObjectivePoint, type SpawnPoint } from './types';

const PI = Math.PI;
type P2 = [number, number];
type BrushOpts = Partial<Omit<Brush, 'min' | 'max' | 'mat'>>;

/** Heights. */
export const SUMMIT_LEVELS = {
  /** Control Room mezzanine and west walkway (also the Gallery roof). */
  walkway: 3.6,
  /** Tower platform. */
  tower: 4.4,
  /** Control Room roof. */
  hallRoof: 8.0,
  /** Catwalk deck (a step above the ground so the faces never share a plane). */
  deck: 0.05,
  /** The gondola's floor. */
  gondola: 0.35,
} as const;
const L = SUMMIT_LEVELS;
const T = 0.3;

export const SUMMIT_BOUNDS = { min: { x: -27, y: -6, z: -54 }, max: { x: 23, y: 32, z: 48 } };

/** The playable outline (BO1 overhead), clockwise on the overhead (north up). Outside it is cliff. */
export const SUMMIT_OUTLINE: P2[] = (() => {
  const arc: P2[] = [];
  for (const a of [-130, -110, -90, -60, -30, 0, 30, 55]) arc.push([14 + 5 * Math.cos((a * PI) / 180), -40 + 5 * Math.sin((a * PI) / 180)]);
  return [
    [-9.5, -49.5], [-4.5, -51.5], [6.3, -51.5], [9, -49.5], [9, -44.2], ...arc,
    [17.2, -34.4], [16.5, -33], [16.5, -29.5], [18, -29], [18, -24.6], [15.2, -24], [15.2, -10], [18.8, -10], [18.8, -4.2], [20.6, -4.2],
    [20.6, 4.4], [18.6, 4.6], [18.4, 8.4], [15.6, 8.8], [15.6, 14], [14.4, 14.6], [14.4, 25.6], [7.2, 26.2], [7.6, 28], [9.6, 32],
    [11.8, 36.4], [13.6, 40.6], [12.2, 45.6], [-3, 45.6], [-5.6, 43.4], [-5.6, 34.6], [-10.2, 34.6], [-10.2, 25.2], [-14.4, 25.2],
    [-14.4, 15.6], [-17, 13.2], [-20.4, 10.8], [-23, 8], [-24.5, 5.5], [-25.2, 3], [-25.2, -3], [-24.5, -7.5], [-18, -18],
    [-18.5, -18.4], [-18.5, -19.7], [-16.6, -20.1], [-16.2, -20], [-16.2, -25], [-17.2, -28], [-17.2, -31.6], [-15, -33.4], [-12.2, -36], [-12.2, -40], [-10, -40.2], [-10, -48],
  ];
})();

/** The chasm under the Bridge and the Tower: no ground, a fall to the death. */
const CHASM: P2[] = [[-15.2, -16.6], [-17.4, -18.6], [-27, -18.6], [-27, -7.6], [-16.3, -7.6], [-16.3, -13.0], [-15.2, -13.0]];
/** Under the Catwalk. */
const CATWALK_GAP: [number, number, number, number] = [14.0, -10.0, 22, 9.0];
/** Impassable rock between the Cliffside path and the Gallery, either side of the Ledge. */
const ROCK_N: P2[] = [[-16.3, -7.6], [-20.5, -7.6], [-21.6, -5.8], [-21.6, -3.2], [-16.3, -3.2]];
const ROCK_S: P2[] = [[-16.3, 3.8], [-21.6, 3.8], [-21.4, 5.2], [-20.2, 7.0], [-18.4, 8.6], [-16.3, 9.2]];
/** The Gondola (hanging off the cliff, outside the outline) and the gap you jump to reach it. */
const GONDOLA = { x0: -24.3, z0: -22.5, x1: -21.9, z1: -20.1 };
const GONDOLA_ZONE: [number, number, number, number] = [-24.4, -23.2, -18.5, -18.4];
/** The Tower platform. */
export const SUMMIT_TOWER = { x0: -20.3, z0: -11.6, x1: -16.7, z1: -8.0 };

/** The Bridge deck: a strip along the cliff edge from the plaza's west corner to the Cliffside path. */
const BRIDGE = (() => {
  const a: P2 = [-18, -18];
  const b: P2 = [-24.5, -7.5];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const d: P2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  // Inward normal (towards the Control building, east-south of the edge).
  const inw: P2 = [d[1], -d[0]];
  const off = (p: P2, s: number, t: number): P2 => [p[0] + inw[0] * s + d[0] * t, p[1] + inw[1] * s + d[1] * t];
  const corners: P2[] = [off(a, 0.3, -1.4), off(b, 0.3, 1.2), off(b, 2.9, 1.2), off(a, 2.9, -1.4)];
  return { a, b, d, inw, len, corners, yaw: Math.atan2(-(b[1] - a[1]), b[0] - a[0]) };
})();

const MATERIALS: Record<string, MaterialDef> = {
  snow: { texture: 'sm_snow', uvMul: [1 / 4, 1 / 4] },
  snowPath: { texture: 'sm_snowDirty', uvMul: [1 / 4, 1 / 4] },
  tin: { texture: 'fr_tin', tint: 0xa0a4a8, uvMul: [1 / 2.6, 1 / 2.6] },
  pave: { texture: 'sm_pave', tint: 0xf0f2f6, uvMul: [1 / 4, 1 / 4] },
  rock: { texture: 'sm_rock', uvMul: [1 / 5, 1 / 5] },
  cliff: { texture: 'sm_rock', tint: 0x9aa0a8, uvMul: [1 / 7, 1 / 7] },
  roofSnow: { texture: 'sm_snow', tint: 0xe4e8ee, uvMul: [1 / 4, 1 / 4] },
  concrete: { texture: 'bo_concrete', tint: 0xb8bcc0, uvMul: [1 / 3, 1 / 3] },
  concreteDark: { texture: 'bo_concrete', tint: 0x8a9096, uvMul: [1 / 3, 1 / 3] },
  corr: { texture: 'fr_corr', tint: 0xa8b0b8, uvMul: [1 / 2.4, 1 / 2.4] },
  corrDark: { texture: 'fr_corr', tint: 0x7a848c, uvMul: [1 / 2.4, 1 / 2.4] },
  corrRed: { texture: 'fr_corr', tint: 0x9a4a3e, uvMul: [1 / 2.4, 1 / 2.4] },
  corrGreen: { texture: 'fr_corr', tint: 0x8a9a8a, uvMul: [1 / 2.4, 1 / 2.4] },
  plaster: { texture: 'nt_plaster', tint: 0xd4ccb4, uvMul: [1 / 3, 1 / 3] },
  plasterGreen: { texture: 'nt_plaster', tint: 0x9aaa9a, uvMul: [1 / 3, 1 / 3] },
  tile: { texture: 'nt_tile', tint: 0x9a9890, uvMul: [1 / 2, 1 / 2] },
  ceiling: { texture: 'bo_concrete', tint: 0x8a8a86, uvMul: [1 / 3, 1 / 3] },
  planks: { texture: 'bo_planks', tint: 0xa8a098, uvMul: [1 / 2.4, 1 / 2.4] },
  wood: { texture: 'bo_wood', uvMul: [1 / 1.2, 1 / 1.2] },
  steel: { texture: 'steel', uvMul: [1 / 2, 1 / 2] },
  steelLight: { texture: 'steel', tint: 0xd0d4d8, uvMul: [1 / 2, 1 / 2] },
  grate: { texture: 'sm_grate', uvMul: [1 / 1.6, 1 / 1.6] },
  rail: { texture: 'sm_rail', side: 'double', uvMul: [1 / 1.2, 1 / 1.1] },
  stairs: { texture: 'rust_stairs', tint: 0x9aa4ae, uvMul: [1 / 1.2, 1 / 1.2] },
  window: { texture: 'sm_window', side: 'double', uvMul: [1 / 1.4, 1 / 1.4] },
  glass: { texture: 'bo_glass', tint: 0xb8c8d4, emissive: 0.15 },
  console: { texture: 'sm_console', uvMul: [1 / 2, 1 / 1] },
  screens: { texture: 'sm_screens', emissive: 0.55 },
  cabinet: { texture: 'sm_cabinet', uvMul: [1 / 1.2, 1 / 1.2] },
  crate: { texture: 'crate', uvMul: [1 / 1.2, 1 / 1.2] },
  barrel: { texture: 'barrel', tint: 0x6a7a5a, uvMul: [2, 1] },
  barrelRed: { texture: 'barrel', tint: 0xa8382a, uvMul: [2, 1] },
  hazard: { texture: 'hazard', uvMul: [1 / 1.2, 1 / 1.2] },
  tank: { texture: 'steel', tint: 0xc4c8c4, uvMul: [1 / 3, 1 / 3] },
  gondola: { texture: 'bo_carpaint', tint: 0x9a2e26 },
  snowcat: { texture: 'bo_carpaint', tint: 0xd8a830 },
  truck: { texture: 'bo_carpaint', tint: 0x5a6450 },
  hind: { texture: 'bo_carpaint', tint: 0x6a7058 },
  dish: { texture: 'bo_carpaint', tint: 0xe4e4e0 },
  rubber: { texture: 'rubber', uvMul: [1 / 0.4, 1 / 0.4] },
  sandbag: { texture: 'bo_sandbag', tint: 0xd0d0cc, uvMul: [1 / 1.6, 1 / 0.9] },
  lattice: { texture: 'sm_lattice', side: 'double' },
  latticeGrey: { texture: 'sm_latticeGrey', side: 'double' },
  chain: { texture: 'fence', side: 'double' },
  sign: { texture: 'sm_sign', emissive: 0.15 },
  pine: { texture: 'sm_pine', side: 'double' },
  mountains: { texture: 'sm_mountains', side: 'double', fog: false, tint: 0xd8dce4 },
  mountainsFar: { texture: 'sm_mountains', side: 'double', fog: false, tint: 0xb8c0cc },
  lamp: { texture: 'lamp', emissive: 1 },
  beacon: { texture: 'lamp', tint: 0xff5040, emissive: 1 },
  clip: { texture: 'none' },
};

// ---------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------

const door = (a: number, w = 1.4, h = 2.3): Hole => ({ a0: a - w / 2, a1: a + w / 2, y0: 0, y1: h });
const win = (a0: number, a1: number, y0 = 1.1, y1 = 2.3): Hole => ({ a0, a1, y0, y1 });

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

const inRect = (r: [number, number, number, number], x: number, z: number) => x > r[0] && x < r[2] && z > r[1] && z < r[3];

interface Cell {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  level: number;
}

/** Cells (size `cell`) where `want` holds, merged into rectangles of equal `level` (rows, then down the rows). */
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
      next.set(key, o ?? { ...r, j0: j });
      if (o) open.delete(key);
    }
    for (const o of open.values()) out.push({ x0: x0 + o.a * cell, z0: z0 + o.j0 * cell, x1: x0 + o.b * cell, z1: z0 + j * cell, level: o.level });
    open = next;
  }
  return out;
}

const hash = (x: number, z: number) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

interface RoomOpts {
  /** Holes per wall (north = -z side, ...), or null for no wall (open / shared). */
  n?: Hole[] | null;
  s?: Hole[] | null;
  w?: Hole[] | null;
  e?: Hole[] | null;
  /** Inside face material. */
  inner?: string;
  /** Roof material (null: no roof). */
  roof?: string | null;
  /** Roof overhang. */
  eave?: number;
  floor?: string;
  t?: number;
}

/** A rectangular room: walls inside the footprint with door/window holes, a roof slab and a floor decal. */
function room(k: MapKit, x0: number, z0: number, x1: number, z1: number, h: number, mat: string, o: RoomOpts = {}): void {
  const t = o.t ?? T;
  const za = o.n === null ? z0 : z0 + t;
  const zb = o.s === null ? z1 : z1 - t;
  const fm = (f: 'px' | 'nx' | 'pz' | 'nz'): BrushOpts => (o.inner ? { faceMats: { [f]: o.inner } } : {});
  if (o.n !== null) k.wall('x', x0, x1, z0 + t / 2, 0, h, t, mat, o.n ?? [], fm('pz'));
  if (o.s !== null) k.wall('x', x0, x1, z1 - t / 2, 0, h, t, mat, o.s ?? [], fm('nz'));
  if (o.w !== null) k.wall('z', za, zb, x0 + t / 2, 0, h, t, mat, o.w ?? [], fm('px'));
  if (o.e !== null) k.wall('z', za, zb, x1 - t / 2, 0, h, t, mat, o.e ?? [], fm('nx'));
  const e = o.eave ?? 0.15;
  if (o.roof !== null) k.aabb(x0 - e, h, z0 - e, x1 + e, h + 0.25, z1 + e, o.roof ?? 'roofSnow', { faceMats: { ny: 'ceiling' } });
  if (o.floor) k.flatDecal(x1 - x0 - 2 * t, z1 - z0 - 2 * t, o.floor, (x0 + x1) / 2, 0.02, (z0 + z1) / 2);
}

/** Railing along a straight line: rail card (render) and an optional player-only clip. */
function railing(k: MapKit, ax: number, az: number, bx: number, bz: number, y = 0, h = 1.05, clip = false): void {
  const L2 = Math.hypot(bx - ax, bz - az);
  if (L2 < 0.1) return;
  const ry = Math.atan2(-(bz - az), bx - ax);
  k.wallDecal(L2, h, 'rail', (ax + bx) / 2, y, (az + bz) / 2, ry, { seg: Math.max(1, Math.round(L2 / 3)) });
  if (clip) k.aabb(Math.min(ax, bx) - 0.06, y, Math.min(az, bz) - 0.06, Math.max(ax, bx) + 0.06, y + h, Math.max(az, bz) + 0.06, 'clip', { noRender: true, players: true, bullets: false, sight: false, tag: 'rail' });
}

function crate(k: MapKit, x: number, z: number, s = 1.2, y = 0): void {
  k.box(s, s, s, 'crate', x, y, z, { uv: 'raw' });
}

function barrels(k: MapKit, pts: [number, number][], mat = 'barrel'): void {
  for (const [x, z] of pts) k.cyl(0.32, 0.92, 8, mat, x, 0.46, z);
}

function lampPost(k: MapKit, x: number, z: number, h = 4.6): void {
  k.box(0.14, h, 0.14, 'steel', x, 0, z);
  k.trim(0.6, 0.12, 0.3, 'steel', x, h - 0.1, z);
  k.trim(0.4, 0.06, 0.2, 'lamp', x, h - 0.16, z);
  k.light(x, h - 0.4, z, [1.3, 1.15, 0.9], 11, 'lamp');
  k.glow(x, h - 0.25, z, [1, 0.9, 0.7], 1.2, 'lamp');
}

/** Ceiling lamp inside a room. */
function ceilingLamp(k: MapKit, x: number, z: number, y: number, r = 8): void {
  k.trim(1.2, 0.06, 0.2, 'lamp', x, y - 0.08, z);
  k.light(x, y - 0.4, z, [1.15, 1.12, 1.0], r, 'lamp');
}

/** A snow-laden spruce: crossed cards and a trunk (collides when `collide`). */
function pine(k: MapKit, x: number, z: number, h: number, y = 0, collide = false): void {
  const w = h * 0.5;
  const r = hash(x, z) * PI;
  k.wallDecal(w, h, 'pine', x, y, z, r, { uv: 'raw', seg: 1 });
  k.wallDecal(w, h, 'pine', x, y, z, r + PI / 2, { uv: 'raw', seg: 1 });
  if (collide) k.box(0.4, 2.0, 0.4, 'clip', x, y, z, { noRender: true });
}

/** A lattice mast: four alpha-cut faces round a square section. */
function mast(k: MapKit, x: number, z: number, y0: number, h: number, w: number, mat = 'lattice'): void {
  for (const [dx, dz, ry] of [[0, -w / 2, 0], [0, w / 2, PI], [-w / 2, 0, PI / 2], [w / 2, 0, -PI / 2]] as const) k.wallDecal(w, h, mat, x + dx, y0, z + dz, ry, { uv: 'raw', seg: 2 });
}

// ---------------------------------------------------------------------------------------------
// Ground, cliffs, edge
// ---------------------------------------------------------------------------------------------

const groundAt = (x: number, z: number) =>
  inside(SUMMIT_OUTLINE, x, z) && !inside(CHASM, x, z) && !inRect(CATWALK_GAP, x, z);

function ground(k: MapKit): void {
  const b = SUMMIT_BOUNDS;
  for (const r of raster(b.min.x, b.min.z, b.max.x, b.max.z, 0.5, groundAt)) k.aabb(r.x0, -2.5, r.z0, r.x1, 0, r.z1, 'snow', { hide: ['ny'], faceMats: { px: 'cliff', nx: 'cliff', pz: 'cliff', nz: 'cliff' } });
  // Surface patches: trampled paths and pavement (decals just above the snow).
  const pave = (x0: number, z0: number, x1: number, z1: number) => k.flatDecal(x1 - x0, z1 - z0, 'pave', (x0 + x1) / 2, 0.012, (z0 + z1) / 2, { seg: Math.max(2, Math.round((x1 - x0) / 3)) });
  const path = (x0: number, z0: number, x1: number, z1: number) => k.flatDecal(x1 - x0, z1 - z0, 'snowPath', (x0 + x1) / 2, 0.01, (z0 + z1) / 2, { seg: Math.max(2, Math.round((x1 - x0) / 3)) });
  pave(-11.5, -39.6, 9, -30.4);
  pave(-16, -13, 14, -9.6);
  pave(-0.8, -30, 1.8, -20.6);
  pave(-3.2, -20.4, 1.8, -13.2);
  pave(-4.4, 9.6, 7, 25.2);
  path(-14.2, 9.6, -4.6, 12.4);
  path(-10, 25.4, 7, 27.4);
  path(-5.4, 34.8, 11, 45.4);
  path(-16, -29.8, -10.2, -20.2);
  path(-21.4, -3.0, -16.4, 3.6);
  // The Cliffside path south of the Ledge, and the vehicle tracks in the South Yard.
  k.flatDecal(3.2, 7.5, 'snowPath', -21.2, 0.011, 7.4, { ry: 0.75, seg: 3 });
  k.flatDecal(3.0, 9, 'snowPath', -23.2, 0.011, 0.5, { seg: 3 });
  k.flatDecal(1.2, 14, 'snowPath', 6.5, 0.013, 38.5, { ry: 0.38, seg: 4 });
  k.flatDecal(1.2, 14, 'snowPath', 8.6, 0.013, 38.8, { ry: 0.38, seg: 4 });
}

/** The mountain falling away below the edge: stepped, snow-topped rock (render only), pines on the ledges. */
function cliffs(k: MapKit): void {
  const b = SUMMIT_BOUNDS;
  const band = (x: number, z: number) => !inside(SUMMIT_OUTLINE, x, z) && edgeDist(SUMMIT_OUTLINE, x, z) < 20;
  const lv = (x: number, z: number) => {
    const d = edgeDist(SUMMIT_OUTLINE, x, z);
    const h = -3 - d * 1.5 - hash(Math.round(x / 6), Math.round(z / 6)) * 3;
    return Math.round(h / 2.5) * 2.5;
  };
  const cells = raster(b.min.x - 18, b.min.z - 18, b.max.x + 18, b.max.z + 18, 2, band, lv);
  for (const r of cells) k.aabb(r.x0, -60, r.z0, r.x1, r.level, r.z1, 'cliff', { collide: false, hide: ['ny'], faceMats: { py: 'snow' } });
  // The chasms: rock walls dropping away under the Bridge and the Catwalk.
  k.aabb(-27, -60, -18.6, -16.3, -14, -7.6, 'cliff', { collide: false, hide: ['ny'], faceMats: { py: 'snow' } });
  k.aabb(14.0, -60, -10, 23, -12, 9, 'cliff', { collide: false, hide: ['ny'], faceMats: { py: 'snow' } });
  // Spruces on the ledges below.
  for (const r of cells) {
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    if (r.level > -6 || hash(cx, cz) > 0.18) continue;
    pine(k, cx, cz, 7 + hash(cz, cx) * 6, r.level);
  }
}

/** Clips everything outside the outline (players only), the chasm walls, railings on the edge. */
function edge(k: MapKit): void {
  const b = SUMMIT_BOUNDS;
  const out = (x: number, z: number) => !inside(SUMMIT_OUTLINE, x, z) && !inRect(GONDOLA_ZONE, x, z);
  for (const r of raster(b.min.x, b.min.z, b.max.x, b.max.z, 0.5, out)) k.clip(r.x0, b.min.y, r.z0, r.x1, 18, r.z1, 'perimeter');
  k.perimeter(b, 18);
  // Railings along the cliff edge (the clip is the real stop); none along the Ledge (the danger sign).
  const P = SUMMIT_OUTLINE;
  for (let i = 0; i < P.length; i++) {
    const [ax, az] = P[i]!;
    const [bx, bz] = P[(i + 1) % P.length]!;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    if (mx < -21 && mz > -4 && mz < 4) continue;
    if (mx > 14 && mx < 21 && mz > -10 && mz < 9) continue;
    if (mx < -18 && mz < -18 && mz > -20) continue; // the jump to the Gondola
    railing(k, ax, az, bx, bz);
  }
}

// ---------------------------------------------------------------------------------------------
// North: Barracks, Fuel Tank, North Plaza
// ---------------------------------------------------------------------------------------------

function barracks(k: MapKit): void {
  // West block (two storeys tall, upper floor shut) and the lower east block.
  room(k, -7, -47.5, 0, -40.2, 6.5, 'corrGreen', {
    n: [win(-6, -4.4), win(-2.8, -1.2), win(-6, -4.4, 4, 5.2), win(-2.8, -1.2, 4, 5.2)],
    s: [door(-4, 1.6), win(-6.4, -5.2), win(-2.6, -1.2), win(-6.4, -5.2, 4, 5.2), win(-3, -1, 4, 5.2)],
    w: [door(-44, 1.4), win(-46.6, -45.6)],
    e: [door(-42.5, 1.2), door(-45.6, 1.2)],
    inner: 'plaster',
    floor: 'planks',
  });
  room(k, 0, -47.5, 6.3, -40.2, 4.4, 'corrGreen', {
    n: [win(1.4, 2.8), win(3.8, 5.2)],
    s: [door(3, 1.6), win(1, 2), win(4.2, 5.6)],
    w: null,
    e: [door(-44, 1.4)],
    inner: 'plaster',
    floor: 'planks',
  });
  // Bunks, lockers, a table.
  for (const x of [-6.1, -2.2]) k.box(0.9, 1.3, 2.0, 'steel', x, 0, -46.2);
  k.box(0.6, 1.9, 2.4, 'cabinet', -6.55, 0, -42.4);
  k.box(1.8, 0.8, 0.9, 'wood', 3.2, 0, -45.8);
  for (const x of [1.0, 5.4]) k.box(0.9, 1.3, 2.0, 'steel', x, 0, -45.9);
  ceilingLamp(k, -3.5, -43.8, 3.4);
  ceilingLamp(k, 3.1, -43.8, 4.3);
  // Upper floor slab of the west block (shut; makes the windows read as a storey).
  k.aabb(-6.7, 3.2, -47.2, -0.15, 3.4, -40.5, 'concrete', { faceMats: { ny: 'ceiling' } });
  // The radome on the west roof and a vent stack on the east roof.
  k.cyl(1.1, 1.6, 10, 'dish', -3.5, 6.75 + 0.8, -44.2, { collide: false });
  k.cyl(1.0, 0.8, 10, 'dish', -3.5, 7.55 + 0.4, -44.2, { collide: false });
  k.trim(0.6, 1.2, 0.6, 'steel', 3.5, 4.65, -45);
  // Rubbish round it: drums and a crate by the east door.
  barrels(k, [[7.5, -45.6], [7.9, -44.8]]);
  crate(k, -8.6, -42.4, 1.0);
  lampPost(k, -1.2, -39.6, 4.2);
}

function fuelTank(k: MapKit): void {
  const cx = 14;
  const cz = -40;
  k.cyl(2.7, 9, 14, 'tank', cx, 4.5, cz);
  k.cyl(2.5, 0.5, 14, 'steel', cx, 9.25, cz, { collide: false });
  k.trim(0.5, 9.2, 0.15, 'steel', cx - 2.8, 0, cz);
  // Footing, a pipe run south along the ring to Comms, gas bottles.
  k.cyl(2.95, 0.3, 14, 'concreteDark', cx, 0.15, cz, { collide: false });
  k.cyl(0.18, 6, 6, 'steel', 17.6, 2.6, -33.6, { axis: 'z', collide: false });
  for (const [x, z] of [[10.3, -36.6], [10.9, -36.3], [11.5, -36.0]] as const) k.cyl(0.18, 1.5, 6, 'barrelRed', x, 0.75, z);
  k.light(cx, 6, cz + 4, [1.2, 1.1, 0.9], 9, 'lamp');
}

function northPlaza(k: MapKit): void {
  // The snowmobile (the "T" on the overhead), turned 30 degrees: rendered turned, collision boxed.
  k.box(2.4, 0.7, 1.0, 'snowcat', -8.4, 0.25, -32.2, { ry: 0.52, collide: false });
  k.box(0.9, 0.45, 0.8, 'rubber', -8.0, 0.95, -32.4, { ry: 0.52, collide: false });
  k.trim(0.2, 0.15, 1.4, 'steel', -9.6, 0.05, -31.6, { ry: 0.52 });
  k.aabb(-9.6, 0, -33.0, -7.2, 1.0, -31.4, 'clip', { noRender: true, players: true, bullets: true, sight: false });
  // Crates and drums, a jersey barrier along the Comms side.
  crate(k, 4.8, -37.4);
  crate(k, 4.8, -36.2, 1.0);
  crate(k, 4.8, -37.3, 1.0, 1.2);
  crate(k, 1.9, -32.5, 1.1);
  barrels(k, [[9.0, -34.8], [9.6, -34.2], [8.9, -34.0]]);
  k.aabb(8.0, 0, -31.4, 11.2, 0.95, -30.7, 'concrete');
  k.aabb(-3.9, 0, -38.3, -2.8, 2.0, -36.6, 'steel');
  k.trim(1.1, 0.06, 1.7, 'roofSnow', -3.35, 2.0, -37.45);
  // The guard hut on the west bump.
  room(k, -17.2, -31.6, -15.0, -28.2, 2.6, 'planks', { e: [door(-29.9, 1.0)], n: [win(-16.6, -15.6)], inner: 'planks' });
  k.box(1.0, 0.8, 0.6, 'wood', -16.4, 0, -31.0);
  lampPost(k, -11.4, -36.8);
  lampPost(k, 8.4, -39.2);
  lampPost(k, 16.0, -31.6);
  // Snow banks against the barracks' corners.
}

// ---------------------------------------------------------------------------------------------
// Cable Car station, Alley, Comms
// ---------------------------------------------------------------------------------------------

function cableCar(k: MapKit): void {
  // Main hall (the gondola bay, cable out through the west wall) and the south wing.
  room(k, -10, -30, -1, -20.4, 5.0, 'corrRed', {
    n: [door(-5, 2.0, 2.6), win(-8.8, -7.2), win(-3.4, -2.2)],
    w: [{ a0: -25.0, a1: -20.9, y0: 1.0, y1: 4.4 }, door(-28, 1.3)],
    e: [door(-27, 1.4), door(-22.5, 1.6)],
    s: [{ a0: -8.4, a1: -4.0, y0: 0, y1: 3.2 }, win(-2.8, -1.8)],
    inner: 'corr',
    floor: 'concreteDark',
  });
  room(k, -9, -20.4, -3.4, -13, 3.6, 'corrRed', {
    n: null,
    w: [door(-16, 1.4), win(-19.2, -17.6)],
    e: [door(-15, 1.4), win(-19.2, -17.8)],
    s: [door(-6.2, 1.6), win(-8.4, -7.4), win(-5.0, -4.0)],
    inner: 'corr',
    floor: 'concreteDark',
  });
  // Bull wheel (overhead), its drive housing, the rail loop and a parked car (cover).
  k.cyl(2.4, 0.35, 16, 'steel', -5.4, 4.0, -23.4, { collide: false });
  k.box(1.4, 2.2, 1.6, 'steelLight', -2.6, 0, -28.4);
  k.box(1.6, 1.4, 1.2, 'hazard', -2.6, 0, -25.6);
  k.trim(7.6, 0.16, 0.16, 'steel', -5.6, 4.4, -21.3);
  k.trim(7.6, 0.16, 0.16, 'steel', -5.6, 4.4, -24.3);
  gondolaCar(k, -7.4, -24.3, true);
  // Cables: out of the west opening, over the cliff to a pylon below, and on into the valley.
  for (const z of [-21.3, -24.3]) k.trim(85, 0.07, 0.07, 'steel', -52.5, 4.32, z);
  mast(k, -47, -22.8, -30, 35.2, 2.2, 'latticeGrey');
  k.trim(3.4, 0.4, 5.0, 'steel', -47, 4.6, -22.8);
  ceilingLamp(k, -5, -27.5, 5.0, 9);
  ceilingLamp(k, -6.2, -16.6, 3.6);
  crate(k, -8.2, -17.6, 1.1);
}

/** A gondola cabin: floor, walls with windows (and a door facing east when `door`), roof, hanger. */
function gondolaCar(k: MapKit, cx: number, cz: number, parked: boolean): void {
  const x0 = cx - 1.2;
  const x1 = cx + 1.2;
  const z0 = cz - 1.2;
  const z1 = cz + 1.2;
  const y0 = parked ? 0.6 : L.gondola - 0.15;
  const fy = y0 + 0.15;
  const h = parked ? 2.05 : 2.7;
  k.aabb(x0, y0, z0, x1, fy, z1, 'gondola');
  const w = (axis: 'x' | 'z', a0: number, a1: number, c: number, holes: Hole[]) => k.wall(axis, a0, a1, c, fy, h, 0.1, 'gondola', holes);
  const sill = 0.95;
  w('x', x0, x1, z0 + 0.05, [win(x0 + 0.3, x1 - 0.3, sill, 1.8)]);
  w('x', x0, x1, z1 - 0.05, [win(x0 + 0.3, x1 - 0.3, sill, 1.8)]);
  w('z', z0 + 0.1, z1 - 0.1, x0 + 0.05, [win(z0 + 0.3, z1 - 0.3, sill, 1.8)]);
  w('z', z0 + 0.1, z1 - 0.1, x1 - 0.05, parked ? [win(z0 + 0.3, z1 - 0.3, sill, 1.8)] : [door(cz, 2.0, h)]);
  k.aabb(x0 - 0.05, fy + h, z0 - 0.05, x1 + 0.05, fy + h + 0.15, z1 + 0.05, 'gondola');
  k.trim(0.12, 4.4 - (fy + h + 0.15), 0.12, 'steel', cx + 0.4, fy + h + 0.15, cz);
  k.trim(1.2, 0.2, 0.3, 'steel', cx + 0.4, 4.2, cz);
}

function alley(k: MapKit): void {
  // Cover in the Alley (Domination A): a pipe stack, crates, a generator.
  for (const [y, x] of [[0.3, 1.0], [0.3, 1.6], [0.82, 1.3]] as const) k.cyl(0.3, 4.2, 8, 'steel', x, y, -23.4, { axis: 'z' });
  k.aabb(0.6, 0, -25.6, 1.9, 0.6, -21.2, 'clip', { noRender: true, players: true, bullets: false, sight: false });
  crate(k, 1.4, -28.4, 1.0);
  crate(k, -2.4, -17.8, 1.2);
  crate(k, 1.2, -15.2, 1.0);
  k.box(1.6, 1.3, 1.0, 'hazard', 0.6, 0, -11.4);
  lampPost(k, 1.7, -29.6, 4.2);
}

function comms(k: MapKit): void {
  // Tall radio room (north), the low equipment hall, the east strip; the mast on the tall roof.
  room(k, 2, -30, 15.2, -25.5, 6.0, 'concrete', {
    n: [door(8.5, 2.2, 2.6), win(3.2, 5.6), win(11, 13.6), win(3.2, 5.6, 3.6, 4.8), win(11, 13.6, 3.6, 4.8)],
    w: [door(-27.8, 1.3)],
    e: [win(-29, -27.4)],
    s: [door(6.5, 1.6), door(13.1, 1.4)],
    inner: 'plasterGreen',
    floor: 'tile',
    roof: null,
  });
  k.aabb(1.85, 6.0, -30.15, 15.35, 6.25, -25.5, 'roofSnow', { faceMats: { ny: 'ceiling' } });
  room(k, 2, -25.5, 11, -13, 3.8, 'corrDark', {
    n: null,
    w: [door(-16.5, 1.4), win(-22, -19.6)],
    s: [door(5.5, 1.6), win(7.5, 9.6)],
    e: [door(-19, 1.4)],
    inner: 'plasterGreen',
    floor: 'tile',
    roof: null,
  });
  k.aabb(1.85, 3.8, -25.5, 10.85, 4.05, -12.85, 'roofSnow', { faceMats: { ny: 'ceiling' } });
  room(k, 10.7, -25.5, 15.2, -13, 4.6, 'concrete', {
    n: null,
    w: null,
    e: [win(-22, -20), win(-17, -15)],
    s: [door(13.1, 1.4)],
    inner: 'plasterGreen',
    floor: 'tile',
    roof: null,
  });
  k.aabb(10.85, 4.6, -25.5, 15.35, 4.85, -12.85, 'roofSnow', { faceMats: { ny: 'ceiling' } });
  // Radio racks, desks, a map table.
  for (const x of [3.0, 4.4, 5.8]) k.box(1.0, 2.1, 0.7, 'console', x, 0, -29.25);
  k.box(2.6, 0.9, 1.0, 'wood', 10.6, 0, -27.8);
  k.box(0.7, 1.9, 3.0, 'cabinet', 2.65, 0, -22.4);
  k.box(2.4, 1.0, 1.2, 'console', 6.8, 0, -19.6);
  k.box(1.0, 1.8, 1.0, 'steelLight', 9.8, 0, -14.2);
  k.box(0.8, 2.1, 2.4, 'console', 14.35, 0, -21.0);
  crate(k, 12.2, -14.4, 1.1);
  ceilingLamp(k, 8.5, -27.8, 6.0, 9);
  ceilingLamp(k, 6.5, -19.2, 3.8);
  ceilingLamp(k, 13, -19.2, 4.6);
  // The antenna mast: red/white lattice, guy-wired, a beacon on top.
  mast(k, 12.6, -27.8, 6.25, 18, 1.4);
  k.trim(2.4, 0.5, 0.2, 'dish', 12.6, 16, -28.6);
  k.trim(0.2, 0.5, 2.4, 'dish', 13.4, 20, -27.8);
  k.glow(12.6, 24.5, -27.8, [1, 0.2, 0.15], 1.6, 'beacon', true);
  k.light(12.6, 24, -27.8, [1.2, 0.2, 0.15], 6, 'beacon');
  // North-yard side: a porch over the south door and drums.
  barrels(k, [[12.6, -11.4], [13.2, -12.0]], 'barrelRed');
}

// ---------------------------------------------------------------------------------------------
// The west cliff: Bridge, Gondola, Tower, rocks, the Ledge
// ---------------------------------------------------------------------------------------------

function westCliff(k: MapKit): void {
  const B = BRIDGE;
  // Bridge deck: one turned grating slab (render) with its collision as small axis-aligned cells.
  const [c0, c1, c2, c3] = B.corners;
  const cx = (c0![0] + c2![0]) / 2;
  const cz = (c0![1] + c2![1]) / 2;
  const deckLen = B.len + 2.6;
  const yaw = B.yaw;
  k.aabb(cx - deckLen / 2, -0.25, cz - 1.3, cx + deckLen / 2, L.deck, cz + 1.3, 'grate', { collide: false, ry: yaw });
  const deckPoly: P2[] = [c0!, c1!, c2!, c3!];
  for (const r of raster(-27, -21, -13, -4, 0.4, (x, z) => inside(deckPoly, x, z) && !groundAt(x, z))) k.aabb(r.x0, -0.25, r.z0, r.x1, L.deck, r.z1, 'clip', { noRender: true });
  // Its railings (render) along both sides, steel girders under it.
  const along = (s: number, t: number): P2 => [B.a[0] + B.inw[0] * s + B.d[0] * t, B.a[1] + B.inw[1] * s + B.d[1] * t];
  for (const s of [0.35, 2.85]) {
    const p = along(s, -0.6);
    const q = along(s, B.len + 0.6);
    railing(k, p[0], p[1], q[0], q[1], L.deck);
  }
  k.aabb(cx - deckLen / 2, -1.6, cz - 1.2, cx + deckLen / 2, -0.25, cz - 0.9, 'steel', { collide: false, ry: yaw });
  k.aabb(cx - deckLen / 2, -1.6, cz + 0.9, cx + deckLen / 2, -0.25, cz + 1.2, 'steel', { collide: false, ry: yaw });
  for (const t of [3.5, 7.5]) {
    const [px, pz] = along(1.6, t);
    k.box(0.4, 14, 0.4, 'steel', px, -15.6, pz, { collide: false });
  }
  // The small ramp at the Bridge's north end that jumps into the Gondola.
  k.ramp(-18.3, 0, -19.6, -17.3, 0.7, -18.4, '-x', 'planks');
  // The Gondola, hanging off the cliff on the cable from the station.
  gondolaCar(k, (GONDOLA.x0 + GONDOLA.x1) / 2, (GONDOLA.z0 + GONDOLA.z1) / 2, false);

  // The Tower: grated platform on four legs out of the chasm, ladder cut off well above the path.
  const tw = SUMMIT_TOWER;
  k.aabb(tw.x0, L.tower - 0.25, tw.z0, tw.x1, L.tower, tw.z1, 'grate', { faceMats: { ny: 'steel' } });
  for (const [x, z] of [[tw.x0 + 0.2, tw.z0 + 0.2], [tw.x1 - 0.2, tw.z0 + 0.2], [tw.x0 + 0.2, tw.z1 - 0.2], [tw.x1 - 0.2, tw.z1 - 0.2]] as const) k.box(0.3, L.tower - 0.25 + 16, 0.3, 'steel', x, -16, z);
  railing(k, tw.x0, tw.z0, tw.x1, tw.z0, L.tower, 1.05, true);
  railing(k, tw.x0, tw.z0, tw.x0, tw.z1, L.tower, 1.05, true);
  railing(k, tw.x0, tw.z1, tw.x1 - 1.6, tw.z1, L.tower, 1.05, true);
  for (const y of [-6, -1, 2.2]) {
    k.trim(tw.x1 - tw.x0, 0.12, 0.12, 'steel', (tw.x0 + tw.x1) / 2, y, tw.z0 + 0.2);
    k.trim(0.12, 0.12, tw.z1 - tw.z0, 'steel', tw.x0 + 0.2, y, (tw.z0 + tw.z1) / 2);
  }
  k.trim(0.5, 2.4, 0.08, 'steel', tw.x0 - 0.1, 2.0, (tw.z0 + tw.z1) / 2);
  // The radar on the Tower: a red mast with a grid antenna (the loading screen's landmark).
  k.box(0.4, 2.6, 0.4, 'corrRed', tw.x0 + 0.3, L.tower, tw.z1 - 0.3, { collide: false });
  k.wallDecal(3.0, 1.6, 'chain', tw.x0 + 0.3, L.tower + 2.6, tw.z1 - 0.3, 0.6, { seg: 1 });
  k.light((tw.x0 + tw.x1) / 2, L.tower + 2, (tw.z0 + tw.z1) / 2, [1.1, 1.05, 0.95], 7, 'lamp');

  // Rock either side of the Ledge: terraced boxes, an invisible clip above (nobody stands on them).
  for (const poly of [ROCK_N, ROCK_S]) {
    const xs = poly.map((p) => p[0]);
    const zs = poly.map((p) => p[1]);
    const lv = (x: number, z: number) => Math.min(4.2, Math.round((1.6 + edgeDist(poly, x, z) * 0.9 + hash(Math.round(x), Math.round(z)) * 0.8) / 0.6) * 0.6);
    const isIn = (x: number, z: number) => inside(poly, x, z);
    for (const r of raster(Math.floor(Math.min(...xs)), Math.floor(Math.min(...zs)), Math.ceil(Math.max(...xs)), Math.ceil(Math.max(...zs)), 0.5, isIn, lv)) k.aabb(r.x0, 0, r.z0, r.x1, r.level, r.z1, 'rock', { hide: ['ny'], faceMats: { py: 'snow' } });
    for (const r of raster(Math.floor(Math.min(...xs)), Math.floor(Math.min(...zs)), Math.ceil(Math.max(...xs)), Math.ceil(Math.max(...zs)), 0.5, isIn)) k.clip(r.x0, 1.2, r.z0, r.x1, 14, r.z1, 'rock');
  }
  // The Ledge: a danger sign on the open edge, a bench, a lamp, drums.
  k.box(0.1, 1.2, 0.1, 'steel', -24.4, 0, -2.2);
  k.wallDecal(1.2, 0.75, 'sign', -24.3, 1.15, -2.2, -PI / 2, { uv: 'raw', seg: 1 });
  k.box(0.5, 0.5, 1.8, 'wood', -19.4, 0, 2.4);
  barrels(k, [[-17.2, -2.5], [-17.0, 3.1]]);
  lampPost(k, -21.2, 3.4, 4.0);
  // The Cliffside path south of the Ledge: a sandbag nest and a pine.
  pine(k, -17.6, 11.6, 6.5, 0, true);
}

// ---------------------------------------------------------------------------------------------
// The Control building
// ---------------------------------------------------------------------------------------------

function control(k: MapKit): void {
  const H = L.hallRoof - 0.2;
  const W = L.walkway;
  // Gallery: the glass corridor along the west side, windows over the valley.
  const gw: Hole[] = [win(-9.1, -6.7, 0.9, 2.9), win(-6.1, -3.7, 0.9, 2.9), door(0, 2.2, 2.5), win(2.2, 3.4, 0.9, 2.9), win(3.9, 6.3, 0.9, 2.9), win(6.8, 9.0, 0.9, 2.9)];
  k.wall('z', -9.5, 9.5, -16.3 + T / 2, 0, 3.3, T, 'concrete', gw, { faceMats: { px: 'plaster' } });
  k.wall('x', -16.3, -13.15, -9.5 + T / 2, 0, 3.3, T, 'concrete', [door(-14.6, 1.6, 2.4)], { faceMats: { pz: 'plaster' } });
  k.wall('x', -16.3, -13.15, 9.5 - T / 2, 0, 3.3, T, 'concrete', [door(-14.6, 1.6, 2.4)], { faceMats: { nz: 'plaster' } });
  k.aabb(-16.45, 3.3, -9.65, -13.15, W, 9.65, 'roofSnow', { faceMats: { ny: 'ceiling' } });
  k.flatDecal(2.85, 18.4, 'tile', -14.72, 0.02, 0, { seg: 6 });
  for (const z of [-7.95, -4.85, 2.8, 5.1, 7.9]) k.wallDecal(1.0, 2.0, 'window', -16.3, 0.9, z, -PI / 2, { seg: 1 });
  for (const [z0, z1] of [[-6.5, -3.4], [3.0, 6.2]] as const) k.aabb(-13.75, 0, z0, -13.15, 2.0, z1, 'cabinet');

  // The hall walls: west (shared with the Gallery), north, south, and east to the east block.
  k.wall('z', -9.5, 9.5, -13, 0, H, T, 'concrete', [door(-7.6, 1.4), door(0, 2.0), door(6.5, 1.4), { a0: -9.0, a1: -5.0, y0: W + 0.35, y1: 6.2 }, win(-2, 2, 4.6, 6.6), win(4, 8, 4.6, 6.6)], { faceMats: { px: 'plaster' } });
  k.wall('x', -13.15, 7.15, -9.5 + T / 2, 0, H, T, 'concrete', [door(-6, 1.6, 2.4), door(4, 1.4), win(-11, -8, 4.6, 6.6), win(-3, 1, 4.6, 6.6), win(2.5, 6, 4.6, 6.6)], { faceMats: { pz: 'plaster' } });
  k.wall('x', -13.15, 7.15, 9.5 - T / 2, 0, H, T, 'concrete', [door(-6, 2.0, 2.6), door(2, 2.0, 2.6), win(-11.5, -8.5), win(-3.5, -0.5), win(4, 6), win(-11.5, -8.5, 4.6, 6.6), win(-3.5, 1, 4.6, 6.6), win(3, 6, 4.6, 6.6)], { faceMats: { nz: 'plaster' } });
  k.wall('z', -9.35, 9.35, 7.0, 0, H, T, 'concrete', [door(-8, 1.2), door(1, 1.6), door(6.5, 1.4)], { faceMats: { nx: 'plaster' } });
  // Roof with the skylight over the control room.
  const roofHoles: [number, number, number, number] = [-6, -4, 4, 4];
  k.aabb(-13.15, H, -9.65, 7.15, H + 0.3, roofHoles[1], 'roofSnow', { faceMats: { ny: 'ceiling' } });
  k.aabb(-13.15, H, roofHoles[3], 7.15, H + 0.3, 9.65, 'roofSnow', { faceMats: { ny: 'ceiling' } });
  k.aabb(-13.15, H, roofHoles[1], roofHoles[0], H + 0.3, roofHoles[3], 'roofSnow', { faceMats: { ny: 'ceiling' } });
  k.aabb(roofHoles[2], H, roofHoles[1], 7.15, H + 0.3, roofHoles[3], 'roofSnow', { faceMats: { ny: 'ceiling' } });
  k.aabb(-6, H + 0.1, -4, 4, H + 0.2, 4, 'glass', { collide: false, hide: [] });
  k.aabb(-5, H + 0.3, -3, 3, H + 1.2, 3, 'glass', { collide: false });
  for (const x of [-3.5, -1, 1.5]) k.trim(0.12, 0.2, 8, 'steel', x, H + 0.05, 0);
  k.flatDecal(19.7, 18.7, 'tile', -3, 0.02, 0, { seg: 8 });

  // Mezzanine along the north wall (over the offices) and the walkway along the west wall.
  k.aabb(-12.85, W - 0.3, -9.35, 6.85, W, -6.5, 'grate', { faceMats: { ny: 'steel' } });
  k.aabb(-12.85, W - 0.3, -6.5, -10.85, W, 9.35, 'grate', { faceMats: { ny: 'steel' } });
  k.aabb(-1.2, W - 0.3, -6.5, 0.2, W, -5.1, 'grate', { faceMats: { ny: 'steel' } });
  k.aabb(-10.85, W - 0.3, 0.3, -9.45, W, 1.7, 'grate', { faceMats: { ny: 'steel' } });
  for (const x of [-8, -3, 2.4, 6.5]) k.box(0.25, W - 0.3, 0.25, 'steel', x, 0, -6.62);
  for (const z of [-2.5, 4.4, 9.0]) k.box(0.25, W - 0.3, 0.25, 'steel', -10.98, 0, z);
  // Stairs: up to the mezzanine (rising west) and up to the walkway (rising north).
  k.stairs(0.2, 0, -6.5, 6.0, W, -5.1, '-x', 'stairs', 16);
  k.stairs(-10.85, 0, 1.7, -9.45, W, 7.5, '-z', 'stairs', 16);
  // Railings (rendered, waist-high clip) with gaps at the stair heads.
  railing(k, -10.85, -6.5, -1.2, -6.5, W, 1.0, true);
  railing(k, 0.2, -6.5, 6.85, -6.5, W, 1.0, false);
  railing(k, -1.2, -5.1, 0.2, -5.1, W, 1.0, true);
  railing(k, -10.85, -6.5, -10.85, 0.3, W, 1.0, true);
  railing(k, -10.85, 1.7, -10.85, 9.35, W, 1.0, true);
  railing(k, -9.45, 0.3, -9.45, 1.7, W, 1.0, true);
  railing(k, 0.2, -5.1, 6.0, -5.1, 0, 1.0, false);
  // Filing cabinets under the walkway and along the north wall; desks in the offices.
  for (const [z0, z1] of [[-5.8, -3.0], [2.6, 5.2]] as const) k.aabb(-12.85, 0, z0, -12.15, 1.6, z1, 'cabinet');
  k.aabb(-12.4, 0, -9.35, -9.0, 1.8, -8.75, 'cabinet');
  k.box(1.8, 0.8, 0.8, 'wood', -4.2, 0, -8.75);
  k.box(1.8, 0.8, 0.8, 'wood', 1.2, 0, -8.75);
  // The control room: the consoles (Domination B) in front of the wall of screens.
  k.aabb(-4.5, 0, 2.2, 4.5, 3.0, 2.6, 'steel', { faceMats: { nz: 'screens' } });
  k.aabb(-4, 0, 0.6, 4, 1.0, 1.5, 'console', { faceMats: { py: 'steel' } });
  k.aabb(-3, 0, -3.4, 3, 0.95, -2.6, 'console', { faceMats: { py: 'steel' } });
  k.aabb(5.6, 0, -4.6, 6.6, 1.0, -1.0, 'console', { faceMats: { py: 'steel' } });
  k.aabb(5.6, 0, 3.2, 6.6, 1.0, 5.6, 'console', { faceMats: { py: 'steel' } });
  k.aabb(-9.4, 0, 6.6, -6.6, 1.0, 7.4, 'console', { faceMats: { py: 'steel' } });
  for (const x of [-2.8, -0.8, 1.2, 3.2]) k.cyl(0.22, 0.5, 6, 'rubber', x, 0.25, -0.2, { collide: false });
  for (const [x, z] of [[-6, -2], [-6, 4], [2, -2], [2, 6], [-10, -6]] as const) ceilingLamp(k, x, z, H, 10);
  ceilingLamp(k, -14.7, -5, 3.3, 7);
  ceilingLamp(k, -14.7, 5, 3.3, 7);
  ceilingLamp(k, -4, -8, W - 0.3, 6);

  // East block: single storey rooms behind the hall, doors out to the Catwalk.
  const EH = 4.2;
  k.wall('x', 7.15, 14, -9.5 + T / 2, 0, EH, T, 'concrete', [door(10.5, 1.4), win(12, 13.4)], { faceMats: { pz: 'plasterGreen' } });
  k.wall('x', 7.15, 14, 9.5 - T / 2, 0, EH, T, 'concrete', [door(10.5, 1.4), win(12, 13.4)], { faceMats: { nz: 'plasterGreen' } });
  k.wall('z', -9.2, 9.2, 14 - T / 2, 0, EH, T, 'concrete', [door(-5, 1.4), door(5, 1.4), win(-8.5, -6.5), win(-2, 1), win(7, 8.5)], { faceMats: { nx: 'plasterGreen' } });
  k.wall('x', 7.15, 13.7, 0, 0, EH, 0.25, 'plasterGreen', [door(10.5, 1.4)]);
  k.aabb(7.15, EH, -9.65, 14.15, EH + 0.25, 9.65, 'roofSnow', { faceMats: { ny: 'ceiling' } });
  k.flatDecal(6.5, 18.6, 'tile', 10.45, 0.02, 0, { seg: 4 });
  k.box(0.8, 2.0, 2.6, 'console', 7.6, 0, -4.5);
  k.box(1.6, 1.6, 1.6, 'steelLight', 12.6, 0, 2.6);
  k.box(2.0, 0.85, 0.9, 'wood', 9.6, 0, 7.6);
  crate(k, 12.8, -8.4, 1.1);
  ceilingLamp(k, 10.5, -4.5, EH);
  ceilingLamp(k, 10.5, 4.5, EH);
  // Porches on the north face (the vestibules on the overhead).
  for (const [x0, x1, z0] of [[-9, -3.5, -12.4], [8.4, 12.6, -12.0]] as const) {
    k.aabb(x0, 3.0, z0, x1, 3.2, -9.65, 'concrete', { faceMats: { py: 'roofSnow' } });
    for (const x of [x0 + 0.2, x1 - 0.2]) k.box(0.24, 3.0, 0.24, 'steel', x, 0, z0 + 0.2);
  }
  lampPost(k, -12, -12.2, 4.2);
}

function catwalk(k: MapKit): void {
  // The grated walkway down the east side, over the drop; a canopy along the wall.
  k.aabb(14.0, -0.25, -10.2, 19.2, L.deck, 9.2, 'grate', { faceMats: { ny: 'steel' } });
  railing(k, 19.2, -10.2, 19.2, 9.2, L.deck, 1.05, true);
  k.aabb(14.15, 3.4, -9.6, 16.6, 3.55, 8.8, 'corr', { faceMats: { py: 'roofSnow' } });
  for (const z of [-9.2, -5, -1, 3, 7, 8.6]) k.box(0.2, 3.4, 0.2, 'steel', 16.4, L.deck, z);
  for (const z of [-6, 0, 6]) k.box(0.4, 13, 0.4, 'steel', 18.8, -13, z, { collide: false });
  for (const z of [-9, 0.5, 8]) k.trim(4.6, 0.3, 0.2, 'steel', 16.6, -0.55, z);
  // Cover on the deck: crates and a cable drum; C sits mid-way along.
  crate(k, 18.4, -7.6, 0.9);
  crate(k, 15.0, 5.8, 1.0);
  k.cyl(0.7, 0.8, 10, 'wood', 18.2, L.deck + 0.7, 6.4, { axis: 'x' });
  k.light(15.5, 3.0, -3, [1.2, 1.1, 0.9], 8, 'lamp');
  k.light(15.5, 3.0, 5, [1.2, 1.1, 0.9], 8, 'lamp');
}

// ---------------------------------------------------------------------------------------------
// South: Garage, Courtyard, Lab, Radar, South Yard
// ---------------------------------------------------------------------------------------------

function garage(k: MapKit): void {
  room(k, -14.4, 12.6, -7.6, 25.2, 4.0, 'corrDark', {
    n: [door(-11, 1.8, 2.6), win(-13.6, -12.6)],
    s: [door(-11, 1.6)],
    w: [win(15, 17), win(20, 22)],
    e: [{ a0: 14.4, a1: 16.6, y0: 0, y1: 2.8 }, { a0: 19.8, a1: 22.4, y0: 0, y1: 2.8 }],
    inner: 'corr',
    floor: 'concreteDark',
  });
  // The open bay east of it, its roof running north as a covered passage to the Control building.
  k.aabb(-7.6, 3.6, 10.2, -4.4, 3.8, 23.6, 'tin', { faceMats: { py: 'roofSnow', ny: 'corr' } });
  for (const z of [10.4, 16.8, 23.3]) k.box(0.24, 3.6, 0.24, 'steel', -4.6, 0, z);
  k.box(0.24, 3.6, 0.24, 'steel', -7.45, 0, 10.4);
  k.flatDecal(3.0, 13, 'concreteDark', -6.0, 0.015, 17.0, { seg: 3 });
  // A truck in the bay, workbenches and tyres inside.
  k.box(2.0, 1.5, 4.6, 'truck', -5.9, 0.5, 18.6);
  k.box(1.9, 1.0, 1.6, 'truck', -5.9, 2.0, 17.0);
  k.aabb(-6.8, 0, 16.4, -5.0, 0.5, 20.9, 'rubber', { players: true, bullets: false, sight: false });
  k.box(2.4, 0.9, 0.8, 'wood', -12.6, 0, 13.4);
  k.box(0.7, 1.9, 2.6, 'cabinet', -13.7, 0, 18.6);
  for (const [x, z] of [[-9.0, 23.6], [-9.6, 24.1]] as const) k.cyl(0.42, 0.3, 10, 'rubber', x, 0.15, z, { collide: false });
  crate(k, -9.0, 14.0, 1.1);
  barrels(k, [[-13.4, 24.2], [-12.8, 24.4]], 'barrelRed');
  ceilingLamp(k, -11, 16, 4.0);
  ceilingLamp(k, -11, 22, 4.0);
  k.light(-6, 3.3, 14, [1.2, 1.1, 0.9], 8, 'lamp');
}

function courtyard(k: MapKit): void {
  // The snowcat, turned -25 degrees: rendered turned; collision as three axis-aligned boxes.
  const ry = -0.44;
  const cx = 0.3;
  const cz = 17.4;
  k.box(2.2, 1.0, 4.4, 'rubber', cx, 0, cz, { ry, collide: false });
  k.box(2.0, 1.2, 4.2, 'snowcat', cx, 0.9, cz, { ry, collide: false });
  k.box(1.8, 1.1, 1.9, 'snowcat', cx - 0.4, 2.1, cz - 0.9, { ry, collide: false });
  k.box(1.7, 0.5, 0.4, 'glass', cx - 0.95, 2.4, cz - 1.95, { ry, collide: false });
  k.box(2.8, 0.7, 0.3, 'steel', cx - 1.05, 0.2, cz - 2.55, { ry, collide: false });
  for (const [ox, oz] of [[-0.9, -1.4], [0, 0], [0.9, 1.4]] as const) k.box(1.9, 2.0, 1.9, 'clip', cx + ox, 0, cz + oz, { noRender: true, players: true, bullets: true, sight: true });
  // Crates, the fuel tank on skids, a sandbag wall, lamps.
  crate(k, 3.8, 12.2);
  crate(k, 4.9, 12.4, 1.0);
  crate(k, 5.4, 22.8, 1.2);
  k.cyl(0.8, 3.6, 10, 'tank', -2.4, 1.1, 23.6, { axis: 'x' });
  k.aabb(-4.2, 0, 23.1, -0.6, 0.3, 24.1, 'steel', { collide: false });
  k.aabb(-3.6, 0, 13.0, -2.2, 0.95, 14.8, 'sandbag');
  lampPost(k, 6.4, 10.4, 4.6);
  lampPost(k, -3.8, 25.0, 4.2);
}

function lab(k: MapKit): void {
  // Generator hut north of the passage, the Lab south of it (S&D B).
  room(k, 5, 10.2, 9, 15.6, 3.0, 'corrGreen', { w: [door(12.9, 1.3)], s: [door(7, 1.3)], e: [win(11.4, 12.8)], inner: 'corr', floor: 'concreteDark' });
  k.box(1.6, 1.5, 2.4, 'steelLight', 7.4, 0, 12.4);
  k.cyl(0.1, 2.0, 6, 'steel', 8.2, 4.0, 11.2, { collide: false });
  ceilingLamp(k, 7, 13, 3.0, 6);
  room(k, 6.8, 18.6, 14.4, 25.2, 4.0, 'concrete', {
    n: [door(9, 1.6), win(11, 13)],
    w: [door(22, 1.4), win(19.4, 20.6)],
    e: [win(19.6, 21.4), win(22.6, 24.2)],
    s: [win(8.4, 10.4), win(11.6, 13.4)],
    inner: 'plaster',
    floor: 'tile',
  });
  k.box(3.0, 0.95, 0.9, 'steelLight', 11.2, 0, 23.9);
  k.box(0.8, 2.0, 2.6, 'console', 13.65, 0, 21.4);
  k.box(1.6, 0.95, 1.0, 'console', 8.6, 0, 21.6);
  k.box(0.7, 1.9, 1.4, 'cabinet', 7.45, 0, 24.0);
  ceilingLamp(k, 10.6, 21.8, 4.0, 8);
  // The passage east to the Catwalk: drums and a crate.
  barrels(k, [[12.8, 16.2], [13.4, 16.6]]);
  crate(k, 14.2, 11.0, 1.0);
  lampPost(k, 10.2, 17.0, 4.2);
}

function radar(k: MapKit): void {
  room(k, -10.2, 27.6, 0.6, 34.2, 4.2, 'concrete', {
    n: [door(-6.6, 1.6), door(-1.6, 1.6), win(-9.4, -8.2), win(-4.8, -3.4)],
    s: [door(-3.4, 1.6), win(-9, -7.2), win(-1.2, 0)],
    w: [win(29.4, 30.8), win(31.6, 33)],
    e: [door(31, 1.4)],
    inner: 'plaster',
    floor: 'tile',
  });
  k.trim(10.8, 0.5, 0.06, 'corrRed', -4.8, 3.55, 27.57);
  k.box(2.8, 1.0, 1.0, 'console', -5.6, 0, 33.2);
  k.box(1.0, 1.0, 2.4, 'console', -9.6, 0, 30.6);
  k.box(1.8, 0.8, 1.0, 'wood', -2.8, 0, 30.4);
  k.box(0.7, 1.9, 1.6, 'cabinet', 0.05, 0, 29.0);
  ceilingLamp(k, -5, 30.8, 4.2, 9);
  // The radar dish on its plinth beside it (a step on the south side to climb up).
  k.aabb(1.4, 0, 28.2, 4.8, 1.0, 33.8, 'concreteDark', { faceMats: { py: 'roofSnow' } });
  k.aabb(2.4, 0, 33.8, 3.8, 0.5, 34.4, 'concreteDark');
  k.cyl(0.5, 2.0, 8, 'steel', 3.1, 2.0, 30.6);
  k.cyl(2.1, 0.4, 14, 'dish', 3.1, 3.7, 30.8, { axis: 'z', collide: false });
  k.cyl(0.3, 1.0, 6, 'steel', 3.1, 3.7, 30.0, { axis: 'z', collide: false });
}

function southYard(k: MapKit): void {
  // Clutter on the west side of the yard (the dots on the overhead): crates, drums, hedgehogs.
  crate(k, -3.4, 38.6);
  crate(k, -3.6, 39.8, 1.0);
  crate(k, -1.0, 42.4, 1.1);
  barrels(k, [[1.6, 40.0], [2.2, 40.4], [1.8, 40.9]]);
  for (const [x, z] of [[-3.0, 44.2], [0.4, 37.2]] as const) {
    k.box(1.6, 0.18, 0.18, 'steel', x, 0.4, z, { ry: 0.8, collide: false });
    k.box(1.6, 0.18, 0.18, 'steel', x, 0.4, z, { ry: -0.8, collide: false });
    k.box(0.18, 1.2, 0.18, 'steel', x, 0, z, { collide: false });
    k.box(1.0, 1.0, 1.0, 'clip', x, 0, z, { noRender: true, players: true, bullets: false, sight: false });
  }
  k.aabb(-5.2, 0, 35.0, -4.9, 2.2, 43.0, 'chain', { players: true, bullets: false, sight: false });
  k.aabb(4.6, 0, 43.4, 7.4, 0.9, 44.2, 'sandbag');
  lampPost(k, 10.6, 41.8, 4.6);
  lampPost(k, -4.2, 35.6, 4.2);
  // Beyond the edge (render only): comms dishes on pads, the helipad with the Hind.
  for (const [x, z, r] of [[16.5, 32.5, 2.6], [19.0, 38.0, 2.2], [15.6, 45.5, 1.8]] as const) {
    k.aabb(x - 2, -2.4, z - 2, x + 2, -1.6, z + 2, 'concreteDark', { collide: false });
    k.cyl(0.4, 2.4, 8, 'steel', x, -0.4, z, { collide: false });
    k.cyl(r, 0.35, 14, 'dish', x, 0.8 + r * 0.6, z - 0.2, { axis: 'z', collide: false });
  }
  const hx = 24;
  const hz = 44;
  k.aabb(hx - 6, -3.4, hz - 6, hx + 6, -2.6, hz + 6, 'concrete', { collide: false });
  k.flatDecal(6, 6, 'hazard', hx, -2.58, hz, { seg: 2 });
  k.box(2.4, 2.4, 8.0, 'hind', hx, -2.0, hz, { collide: false, ry: 0.4 });
  k.box(1.0, 1.0, 6.0, 'hind', hx + 2.6, -0.4, hz + 5.8, { collide: false, ry: 0.4 });
  k.box(1.8, 1.0, 1.8, 'glass', hx - 1.4, -0.6, hz - 3.6, { collide: false, ry: 0.4 });
  k.trim(16, 0.08, 0.5, 'steel', hx, 0.5, hz, { ry: 0.9 });
  k.trim(16, 0.08, 0.5, 'steel', hx, 0.52, hz, { ry: 0.9 + PI / 2 });
}

function backdrop(k: MapKit): void {
  k.backdropRing('mountainsFar', 240, 9, 260, 75, -50, 0.3);
  k.backdropRing('mountains', 170, 11, 190, 52, -44);
  // A power line on the slope north-west (the birdseye's pylons) and spruces on the far slopes.
  mast(k, -40, -42, -28, 34, 2.6, 'latticeGrey');
  mast(k, -58, -8, -36, 40, 2.6, 'latticeGrey');
  k.trim(0.06, 0.06, 40, 'steel', -49, 5.8, -25, { ry: 0.45 });
  for (let a = 0; a < 40; a++) {
    const t = (a / 40) * PI * 2;
    const r = 52 + 12 * Math.sin(a * 2.3);
    pine(k, Math.cos(t) * r * 0.75, Math.sin(t) * r * 1.1, 10 + 4 * hash(a, 3), -16 - 6 * hash(a, 7));
  }
}

export function buildSummit(): MapData {
  const k = new MapKit();
  ground(k);
  cliffs(k);
  edge(k);
  barracks(k);
  fuelTank(k);
  northPlaza(k);
  cableCar(k);
  alley(k);
  comms(k);
  westCliff(k);
  control(k);
  catwalk(k);
  garage(k);
  courtyard(k);
  lab(k);
  radar(k);
  southYard(k);
  backdrop(k);

  // ---- spawns ----
  const S = PI;
  const sp = (x: number, y: number, z: number, yaw = 0): SpawnPoint => ({ x, y, z, yaw });
  const team0 = [[-10.4, -37.6], [-6.5, -37.8], [-1.6, -38.8], [2.4, -38.6], [7.4, -37.2], [-5.0, -33.8], [-0.4, -34.6], [4.4, -33.2], [12.2, -34.2], [-11.2, -33.2]].map(([x, z]) => sp(x!, 0, z!, S));
  const team1 = [[3.6, 37.2], [6.6, 37.6], [9.6, 39.4], [3.0, 41.2], [6.4, 41.6], [9.8, 44.0], [0.0, 44.6], [-1.4, 36.0], [3.4, 44.6], [-0.8, 39.6]].map(([x, z]) => sp(x!, 0, z!, 0));
  const ffaAt: [number, number, number][] = [
    [-2, 0, -49.2], [14, 0, -44.3], [-14, 0, -24], [-5, 0, -25.6], [6.5, 0, -22], [13, 0, -27.8], [-0.6, 0, -16], [-14.6, 0, -6],
    [-19.4, 0, -0.4], [-4, 0, -4.6], [2, L.walkway, -8], [10.5, 0, -6.6], [17, L.deck, -3], [-11, 0, 19.6], [1.8, 0, 22.2], [10.6, 0, 21],
    [-6.2, 0, 31.4], [6.0, 0, 41.8],
  ];
  const ffa = ffaAt.map(([x, y, z]) => sp(x, y, z, yawTo(x, z, 0, 0)));

  // ---- objectives ----
  const P = (id: string, x: number, y: number, z: number, radius: number, team?: 0 | 1): ObjectivePoint => (team === undefined ? { id, x, y, z, radius } : { id, x, y, z, radius, team });
  const dom = [P('A', 0.3, 0, -19.6, 3), P('B', 0, 0, -0.9, 3), P('C', 17.4, L.deck, 4.0, 2.5)];
  const sd = [P('A', -11, 0, 18.8, 1.6, 1), P('B', 10.6, 0, 21.4, 1.6, 1)];
  const hq = [
    P('hq1', -2, 0, 4.6, 3.5), P('hq2', -11, 0, 18.8, 3), P('hq3', -5.4, 0, -25.4, 3), P('hq4', 17.4, L.deck, -4.6, 2.5),
    P('hq5', 6.5, 0, -21, 3), P('hq6', -4.6, 0, 30.8, 3), P('hq7', 10.6, 0, 21.4, 2.5), P('hq8', -3.6, 0, -43.8, 2.5), P('hq9', -14.7, 0, 0, 1.6),
  ];
  const attackers = team0;
  const defenders = [[-7.6, 26.4], [-4.0, 26.2], [0.2, 26.4], [4.2, 26.6], [6.0, 30.2], [-1.6, 35.6], [2.4, 36.2], [6.4, 33.6]].map(([x, z]) => sp(x!, 0, z!, yawTo(x!, z!, 0, 10)));

  const tw = SUMMIT_TOWER;
  const hot = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
  return {
    id: 'summit',
    name: 'Summit',
    bounds: SUMMIT_BOUNDS,
    materials: MATERIALS,
    brushes: k.brushes,
    decals: k.decals,
    props: k.props,
    lights: k.lights,
    spawns: { teams: [team0, team1], ffa },
    objectives: { dom, sd, hq },
    modeSpawns: { sd: { attackers, defenders } },
    times: [
      { id: 'day', name: 'Day', clock: '13:20', sky: 'sm_skyDay', unlit: [1, 1, 1], skyRot: 0, sunDir: unitVec(-0.45, 0.62, 0.55), sun: [1.12, 1.08, 1.0], amb: [0.5, 0.54, 0.62], fog: [0.84, 0.87, 0.91], fogNear: 45, fogFar: 190, lights: { lamp: 0.35, beacon: 1 }, glow: 0.35 },
      { id: 'dusk', name: 'Snowfall Dusk', clock: '17:45', sky: 'sm_skyDusk', unlit: [0.9, 0.9, 0.96], skyRot: PI * 0.6, sunDir: unitVec(0.7, 0.22, -0.4), sun: [0.62, 0.56, 0.62], amb: [0.36, 0.38, 0.46], fog: [0.56, 0.57, 0.64], fogNear: 16, fogFar: 100, lights: { lamp: 1, beacon: 1 }, glow: 1 },
    ],
    defaultTime: 'day',
    hotspots: [
      hot(0.3, 0, -19.6),
      hot(0, 0, -0.9),
      hot(17.4, L.deck, 4.0),
      hot(-5.4, 0, -25.4),
      hot(6.5, 0, -21),
      hot(-11, 0, 18.8),
      hot(10.6, 0, 21.4),
      hot(-4.6, 0, 30.8),
      hot(-3.6, 0, -43.8),
      hot(-14.7, 0, 0),
      hot(-19.2, 0, 0.4),
      hot(-4, L.walkway, -8),
      hot(-11.9, L.walkway, 4),
      hot(-14.7, L.walkway, -6),
      hot((tw.x0 + tw.x1) / 2, L.tower, (tw.z0 + tw.z1) / 2),
      hot(-20.4, L.deck, -13.2),
      hot(1, 0, 17),
      hot(2, 0, -35),
      hot(4, 0, 40),
    ],
  };
}
