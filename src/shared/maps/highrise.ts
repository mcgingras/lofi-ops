/**
 * Highrise (inspired by MW2's "Highrise", 2009): the top of a skyscraper under construction, laid out
 * from the MW2 minimap at 3.75 px per metre, with the MWIII (2023) remaster's tac maps and map guide
 * for names, levels and routes (see docs/maps/highrise-reference.md for the sources, measurements and
 * callouts). About 46 x 56 m of open rooftop between two office buildings, 125 m spawn to spawn.
 *
 * North: the Phonic offices. The elevator lobby along the west side is team 1's spawn; the long office
 * hall faces the roof through glass, with a back room, restrooms and the stairs down to the north
 * tunnel. A covered walkway runs along its front; its roof is the "upper ledge" you reach from the
 * crane. South: the Actibase offices (team 0 spawns in the reception wing in the south-east), with a
 * front corridor behind glass, the cubicle office, the stairs down to the south tunnel and a roof you
 * climb to from the front ledge (ladder at the east end, walk the ledge, hanging platform at the west
 * end).
 *
 * The rooftop between them: the Pit, a sunken trench along the west side in two sections (the Orange
 * Pit to the north, the Red Pit to the south) joined by an underpass beneath the B lane, with the
 * tunnels running from each end into the buildings; the Helipad, a deck on top of the Mechanical Room
 * with stairs at both ends and a parked Mi-8; the propane tank, the shacks, the substation and the
 * tarp fence. The elevator shaft stands on the open west edge; from its roof a plank leads onto the
 * first crane jib, which crosses under the second one out in the air, and that one runs back to the
 * north building, where a window-cleaning gondola and a ledge lead onto the upper ledge. The bulges of
 * the roof on the west and east sides are open edges: fall off and you die (bounds floor at -6 m).
 *
 * Coordinates: x east, z south, y up; yaw 0 looks north (-z). Roof level is y = 0. Team 0 spawns in
 * the south building, team 1 in the north building. S&D: team 1 defends, attackers start in the south
 * (`modeSpawns.sd`, `objectives.sdBomb`).
 */
import { MapKit, spawnAt, yawTowards } from './mw2kit';
import { unitVec, type BoxOpts, type MapData, type MaterialDef, type SpawnPoint } from './types';

const PI = Math.PI;

const MATERIALS: Record<string, MaterialDef> = {
  roof: { texture: 'hr_roof', uvMul: [1 / 4, 1 / 4] },
  roofDark: { texture: 'hr_roof', uvMul: [1 / 6, 1 / 6], tint: 0x9a968e },
  concrete: { texture: 'term_facade', uvMul: [1 / 3, 1 / 3], tint: 0xc8c4bc },
  parapet: { texture: 'term_facade', uvMul: [1 / 2, 1 / 2], tint: 0xb4b0a8 },
  ply: { texture: 'hr_plywood', uvMul: [1 / 2.4, 1 / 2.4] },
  plyRed: { texture: 'hr_plywood', uvMul: [1 / 2.4, 1 / 2.4], tint: 0xc07060 },
  pitFloor: { texture: 'rust_concrete', uvMul: [1 / 3, 1 / 3], tint: 0xc8a888 },
  pitFloorRed: { texture: 'rust_concrete', uvMul: [1 / 3, 1 / 3], tint: 0xb07868 },
  curbRed: { texture: 'paint', tint: 0xa83a2a },
  tunnel: { texture: 'scrap_wall', uvMul: [1 / 2.4, 1 / 2.4], tint: 0xa8b8a0 },
  tunnelFloor: { texture: 'rust_concrete', uvMul: [1 / 2, 1 / 2], tint: 0x8a9488 },
  stairs: { texture: 'term_stairs', uvMul: [1 / 1.2, 1 / 1.2] },
  ladder: { texture: 'rust_stairs', uvMul: [1 / 1.2, 1 / 1.2] },
  tile: { texture: 'term_floor', uvMul: [1 / 2.4, 1 / 2.4] },
  carpet: { texture: 'term_carpet', uvMul: [1 / 2, 1 / 2] },
  wall: { texture: 'term_wall', uvMul: [1 / 3, 1 / 3] },
  wallWood: { texture: 'term_counter', uvMul: [1 / 2, 1 / 3], tint: 0xb89878 },
  ceiling: { texture: 'term_wall', uvMul: [1 / 2, 1 / 2], tint: 0xb8b8b4 },
  brick: { texture: 'nt_brick', uvMul: [1 / 1.6, 1 / 1.6], tint: 0xc09078 },
  facadeS: { texture: 'term_facade', uvMul: [1 / 4, 1 / 4], tint: 0xd8d4cc },
  glass: { texture: 'term_glass', uvMul: [1 / 2.2, 1 / 1.8], side: 'double' },
  winUp: { texture: 'hr_tower', uvMul: [1 / 6, 1 / 4] },
  elevator: { texture: 'hr_elevator' },
  desk: { texture: 'term_counter', uvMul: [1 / 2, 1 / 1.1] },
  cubicle: { texture: 'term_wall', uvMul: [1 / 1.6, 1 / 1.6], tint: 0xd8d4c8 },
  books: { texture: 'term_books', uvMul: [1 / 1.6, 1 / 1.9] },
  steel: { texture: 'steel' },
  dark: { texture: 'steel', tint: 0x50545a },
  grate: { texture: 'scrap_grate', uvMul: [1 / 1.2, 1 / 1.2] },
  rail: { texture: 'rust_rail', uvMul: [1 / 1.2, 1], side: 'double' },
  fence: { texture: 'fence', side: 'double' },
  tarp: { texture: 'hr_tarp', uvMul: [1 / 3, 1 / 2], side: 'double' },
  tarpPile: { texture: 'hr_tarp', uvMul: [1 / 2, 1 / 2] },
  shack: { texture: 'rust_corr', uvMul: [1 / 2.4, 1 / 2.4], tint: 0xc8c0b0 },
  shackGreen: { texture: 'rust_corr', uvMul: [1 / 2.4, 1 / 2.4], tint: 0x88a878 },
  shackRoof: { texture: 'rust_corr', uvMul: [1 / 2.4, 1 / 2.4], tint: 0x9a9a9a },
  ac: { texture: 'shutter', tint: 0xd0ccc4 },
  tank: { texture: 'tank', uvMul: [2, 1] },
  crate: { texture: 'crate', uvMul: [1 / 1.2, 1 / 1.2] },
  pallet: { texture: 'pallet' },
  barrel: { texture: 'barrel', tint: 0xa8382a, uvMul: [2, 1] },
  barrelBlue: { texture: 'barrel', tint: 0x2f5a8a, uvMul: [2, 1] },
  barrier: { texture: 'barrier' },
  hazard: { texture: 'hazard', uvMul: [1 / 0.6, 1 / 0.6] },
  yellow: { texture: 'yellow', uvMul: [1 / 0.8, 1 / 0.8] },
  lattice: { texture: 'hr_lattice', uvMul: [1 / 1.6, 1 / 1.6], side: 'double' },
  heli: { texture: 'hr_heli', uvMul: [1 / 2, 1 / 2] },
  heliDark: { texture: 'hr_heli', uvMul: [1 / 2, 1 / 2], tint: 0x707060 },
  star: { texture: 'hr_star' },
  hmark: { texture: 'hr_hmark' },
  deck: { texture: 'hr_roof', uvMul: [1 / 3, 1 / 3], tint: 0x8a8a8c },
  rubber: { texture: 'rubber', uvMul: [1 / 0.4, 1 / 0.4] },
  lamp: { texture: 'lamp', emissive: 1 },
  sign: { texture: 'hr_sign', emissive: 0.5, side: 'double' },
  wkm: { texture: 'hr_wkm' },
  bear: { texture: 'bo_fabric', tint: 0x8a5a32 },
  scaffold: { texture: 'rust_rail', uvMul: [1 / 2, 1 / 2], side: 'double', tint: 0x9a9a90 },
  setback: { texture: 'hr_roof', uvMul: [1 / 8, 1 / 8], tint: 0x8a8680, fog: false },
  tower: { texture: 'hr_tower', uvMul: [1 / 12, 1 / 8], fog: false },
  towerB: { texture: 'hr_tower', uvMul: [1 / 9, 1 / 6], tint: 0xc0b8a8, fog: false },
  towerC: { texture: 'hr_tower', uvMul: [1 / 15, 1 / 10], tint: 0x9aa4b0, fog: false },
  street: { texture: 'hr_roof', uvMul: [1 / 30, 1 / 30], tint: 0x5a5a5a, fog: false },
  clip: { texture: 'none' },
};

/** Walkable heights (feet), exported for features and tests. */
export const HIGHRISE_LEVELS = {
  /** The tunnels and the floors of both pits. */
  tunnel: -3.2,
  /** The rooftop, both office floors. */
  roof: 0,
  /** Shack roofs. */
  shack: 2.8,
  /** Front ledge (covered walkway roof) of the south building. */
  ledgeS: 3.9,
  /** Elevator shaft roof (west edge). */
  elevator: 4.0,
  /** Helipad deck, and the upper ledge in front of the north building. */
  deck: 4.2,
  /** First crane jib (from the elevator shaft). */
  jibA: 4.9,
  /** Second crane jib (to the north building). */
  jibC: 5.8,
  /** South building roof. */
  southRoof: 7.6,
} as const;

/** The open rooftop between the buildings (inner edges), with the bulges on the open west/east edges. */
export const HIGHRISE_ROOF = { minX: -22.3, maxX: 22.4, minZ: -28, maxZ: 28, bulgeMinX: -26.3, bulgeMaxX: 26.4, bulgeMinZ: -10.9, bulgeMaxZ: 11.2 } as const;

/** MW2 minimap scale used for the layout: px per metre (x = (px - 258.5) / 3.75, z = (py - 277) / 3.75). */
export const HIGHRISE_MINIMAP = { pxPerM: 3.75, originPx: 258.5, originPy: 277 } as const;

/** Footprints used by the tests: pits, tunnels, the helipad, the buildings. */
export const HIGHRISE_AREAS = {
  northPit: { minX: -17.2, maxX: -5.5, minZ: -22.7, maxZ: -8.5 },
  southPit: { minX: -17.2, maxX: -5.5, minZ: -1.3, maxZ: 23.2 },
  crossing: { minX: -17.2, maxX: -5.5, minZ: -8.5, maxZ: -1.3 },
  northTunnel: { minX: -12.4, maxX: -9.9, minZ: -45, maxZ: -22.7 },
  southTunnel: { minX: -12.0, maxX: -9.6, minZ: 23.2, maxZ: 46 },
  helipad: { minX: 1.5, maxX: 22.0, minZ: -2.8, maxZ: 4.4 },
  mechRoom: { minX: 2.0, maxX: 21.5, minZ: -2.1, maxZ: 3.7 },
  elevatorShaft: { minX: -26.3, maxX: -22.0, minZ: -5.3, maxZ: 5.9 },
  northBuilding: { minX: -28.4, maxX: 26.4, minZ: -65.6, maxZ: -31.7 },
  southBuilding: { minX: -19.6, maxX: 27.6, minZ: 32.8, maxZ: 59.7 },
} as const;

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}
const R = (x0: number, z0: number, x1: number, z1: number): Rect => ({ x0, z0, x1, z1 });

/** The union of `rects` minus `holes`, as few axis-aligned rectangles as a greedy grid merge gives. */
export function rectsMinus(rects: Rect[], holes: Rect[] = []): Rect[] {
  const xs = [...new Set([...rects, ...holes].flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
  const zs = [...new Set([...rects, ...holes].flatMap((r) => [r.z0, r.z1]))].sort((a, b) => a - b);
  const inR = (r: Rect, x: number, z: number) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
  const cell = (i: number, j: number) => {
    const x = (xs[i]! + xs[i + 1]!) / 2;
    const z = (zs[j]! + zs[j + 1]!) / 2;
    return rects.some((r) => inR(r, x, z)) && !holes.some((r) => inR(r, x, z));
  };
  const out: Rect[] = [];
  let open = new Map<string, Rect>();
  for (let j = 0; j < zs.length - 1; j++) {
    const spans: [number, number][] = [];
    for (let i = 0; i < xs.length - 1; i++) {
      if (!cell(i, j)) continue;
      const last = spans.at(-1);
      if (last && last[1] === i) last[1] = i + 1;
      else spans.push([i, i + 1]);
    }
    const next = new Map<string, Rect>();
    for (const [a, b] of spans) {
      const key = `${a},${b}`;
      const r = open.get(key);
      if (r) {
        r.z1 = zs[j + 1]!;
        next.set(key, r);
        open.delete(key);
      } else next.set(key, R(xs[a]!, zs[j]!, xs[b]!, zs[j + 1]!));
    }
    for (const r of open.values()) out.push(r);
    open = next;
  }
  for (const r of open.values()) out.push(r);
  return out;
}

export function buildHighrise(): MapData {
  const k = new MapKit();
  const L = HIGHRISE_LEVELS;
  const A = HIGHRISE_AREAS;
  const T = L.tunnel;

  const slab = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: string, o: BoxOpts = {}) => k.slab(x0, y0, z0, x1, y1, z1, mat, o);
  const trim = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: string, o: BoxOpts = {}) => k.trim(x0, y0, z0, x1, y1, z1, mat, o);
  const floors = (rects: Rect[], holes: Rect[], y0: number, y1: number, mat: string, o: BoxOpts = {}) => {
    for (const r of rectsMinus(rects, holes)) slab(r.x0, y0, r.z0, r.x1, y1, r.z1, mat, o);
  };
  const crate = (x: number, z: number, y = 0, s = 1.2) => slab(x - s / 2, y, z - s / 2, x + s / 2, y + s, z + s / 2, 'crate', { uv: 'raw' });
  const barrel = (x: number, z: number, m = 'barrel', y = 0) => k.cyl(0.32, 0.9, 8, m, x, y + 0.45, z);
  const post = (x: number, z: number, y0: number, y1: number, r = 0.12, mat = 'steel') => slab(x - r, y0, z - r, x + r, y1, z + r, mat);
  const clip = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => k.playerClip(x0, y0, z0, x1, y1, z1);
  const RAW = new Set(['elevator', 'star', 'sign', 'wkm', 'hmark']);
  const wallDecal = (w: number, h: number, mat: string, x: number, y: number, z: number, ry: number, seg?: number) => k.decals.push({ kind: 'wall', w, h, x, y, z, ry, mat, seg, uv: RAW.has(mat) ? 'raw' : undefined });
  const flatDecal = (w: number, h: number, mat: string, x: number, y: number, z: number, ry = 0, seg?: number) => k.decals.push({ kind: 'flat', w, h, x, y, z, ry, mat, seg, uv: RAW.has(mat) ? 'raw' : undefined });

  /**
   * A box rotated about y (render only) from (ax, az) to (bx, bz), `wid` wide, from y0 to y1, plus
   * (when `walk`) axis-aligned collision pieces about every metre along it, whose tops are at y1.
   */
  const beamLine = (ax: number, az: number, bx: number, bz: number, wid: number, y0: number, y1: number, mat: string, walk = false, colY0?: number) => {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const ry = Math.atan2(ux, uz);
    const swap = Math.abs(Math.sin(ry)) > 0.5;
    const hx = (swap ? len : wid) / 2;
    const hz = (swap ? wid : len) / 2;
    const cx = (ax + bx) / 2;
    const cz = (az + bz) / 2;
    trim(cx - hx, y0, cz - hz, cx + hx, y1, cz + hz, mat, { ry });
    if (!walk) return;
    const n = Math.max(1, Math.round(len / 0.8));
    for (let i = 0; i < n; i++) {
      const s = (len * (i + 0.5)) / n;
      const px = ax + ux * s;
      const pz = az + uz * s;
      const seg = len / n / 2 + 0.15;
      const ex = Math.abs(ux) * seg + Math.abs(uz) * (wid / 2) * 0.8;
      const ez = Math.abs(uz) * seg + Math.abs(ux) * (wid / 2) * 0.8;
      slab(px - ex, colY0 ?? y1 - 0.3, pz - ez, px + ex, y1, pz + ez, 'clip', { noRender: true, tag: 'crane' });
    }
  };
  /** A diagonal wall (render rotated, collision as stepped boxes). */
  const diagWall = (ax: number, az: number, bx: number, bz: number, y0: number, y1: number, t: number, mat: string) => {
    beamLine(ax, az, bx, bz, t, y0, y1, mat);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const x = ax + ((bx - ax) * (i + 0.5)) / n;
      const z = az + ((bz - az) * (i + 0.5)) / n;
      const e = Math.max(Math.abs(bx - ax), Math.abs(bz - az)) / n / 2 + t / 2;
      slab(x - e, y0, z - e, x + e, y1, z + e, 'clip', { noRender: true });
    }
  };

  // =============================================================================================
  // Floors
  // =============================================================================================
  const nPit = R(A.northPit.minX, A.northPit.minZ, A.northPit.maxX, A.northPit.maxZ);
  const sPit = R(A.southPit.minX, A.southPit.minZ, A.southPit.maxX, A.southPit.maxZ);
  const nStair = R(-12.4, -51, -9.9, -45);
  const sStair = R(-12.0, 46, -9.6, 52);
  // The open roof, its bulges and both covered walkways.
  floors([R(-22.3, -28, 22.4, 28), R(-26.3, -10.9, -22.3, 11.2), R(22.4, -10.9, 26.4, 11.2), R(-19.9, -31.7, 19.1, -28), R(-19.9, 28, 19.6, 32.8)], [nPit, sPit], -0.3, 0, 'roof', { hide: ['ny'] });
  // North building: tiled lobby, carpeted offices.
  const nbLobby = R(-28.4, -65.6, -20, -31.7);
  const nbWc = R(-20, -54.1, -15.2, -39.5);
  const nbRest = [R(-20, -58.7, -4.4, -31.7), R(-4.4, -45.1, 11.1, -31.7), R(11.1, -37.6, 26.4, -31.7)];
  floors([nbLobby, nbWc], [], -0.3, 0, 'tile', { hide: ['ny'] });
  floors(nbRest, [nStair, nbWc], -0.3, 0, 'carpet', { hide: ['ny'] });
  // South building: tiled front corridor and reception wing, carpeted offices.
  const sbTile = [R(-19.6, 32.8, 27.6, 36.3), R(10.6, 36.3, 27.6, 39), R(10.6, 39, 22.3, 49.6), R(18.3, 49.6, 27.6, 59.7)];
  const sbCarpet = [R(-7.6, 36.3, 10.6, 52), R(-12.2, 44.5, -7.6, 52), R(-19.6, 52, 10.6, 55.2)];
  floors(sbTile, [], -0.3, 0, 'tile', { hide: ['ny'] });
  floors(sbCarpet, [sStair], -0.3, 0, 'carpet', { hide: ['ny'] });

  // =============================================================================================
  // Roof edges: parapets (with player clips above them), open edges on the bulges
  // =============================================================================================
  const parapet = (x0: number, z0: number, x1: number, z1: number) => {
    slab(x0, -0.3, z0, x1, 1.0, z1, 'parapet');
    clip(x0, 1.0, z0, x1, 7, z1);
  };
  parapet(-22.6, -28.3, -22.3, -10.9);
  parapet(-22.6, 11.2, -22.3, 28.3);
  parapet(-22.6, -28.3, -19.9, -28);
  parapet(-22.6, 28, -19.9, 28.3);
  parapet(-26.3, -11.2, -22.6, -10.9);
  parapet(-26.3, 11.2, -22.6, 11.5);
  parapet(22.4, -28.3, 22.7, -10.9);
  parapet(22.4, 11.2, 22.7, 28.3);
  parapet(19.1, -28.3, 22.4, -28);
  parapet(19.6, 28, 22.4, 28.3);
  parapet(22.7, -11.2, 26.4, -10.9);
  parapet(22.7, 11.2, 26.4, 11.5);
  // The open construction edges on the bulges: a kerb, a few rebar stubs, nothing to stop you.
  for (const x of [-26.3, 26.4]) {
    trim(x - 0.15, 0, -10.9, x + 0.15, 0.2, 11.2, 'parapet', { hide: ['ny'] });
    for (let z = -9.5; z < 11; z += 2.6) trim(x - 0.03, 0.2, z - 0.03, x + 0.03, 1.1, z + 0.03, 'steel');
  }

  // =============================================================================================
  // The Pit: two sunken sections, the underpass between them, tunnels to both buildings
  // =============================================================================================
  const pitTop = 1.2; // the plywood walls stand 1.2 m above the roof
  const pitWall = (axis: 'x' | 'z', from: number, to: number, at: number, mat: string, holes: [number, number, number, number][] = []) => k.wall(axis, from, to, at, T - 0.3, pitTop, 0.3, mat, holes);
  // Floors.
  slab(nPit.x0, T - 0.3, nPit.z0, nPit.x1, T, nPit.z1, 'pitFloor', { hide: ['ny'] });
  slab(sPit.x0, T - 0.3, sPit.z0, sPit.x1, T, sPit.z1, 'pitFloorRed', { hide: ['ny'] });
  slab(-14, T - 0.3, -8.5, -9, T, -1.3, 'tunnelFloor', { hide: ['ny'] });
  // North pit walls (inside the hole): the tunnel portal in the north wall, the underpass and the
  // stair down from the B lane in the south wall, the ladder exit in the east wall.
  pitWall('x', -14.5, -8.2, -22.55, 'ply', [[-12.4, -9.9, T - 0.3, -0.3]]);
  pitWall('z', -20.0, -8.5, -17.05, 'ply');
  pitWall('z', -20.0, -8.5, -5.65, 'ply', [[-20.0, -19.0, 0, pitTop]]);
  pitWall('x', -17.2, -5.5, -8.65, 'ply', [[-14, -9, T - 0.3, -0.3], [-8.6, -5.8, T - 0.3, pitTop]]);
  // South pit walls.
  pitWall('x', -17.2, -5.5, -1.15, 'plyRed', [[-14, -9, T - 0.3, -0.3]]);
  pitWall('z', -1.3, 20.5, -17.05, 'plyRed');
  pitWall('z', -1.3, 20.5, -5.65, 'plyRed', [[18, 20.5, 0, pitTop]]);
  pitWall('x', -14.5, -8.2, 23.05, 'plyRed', [[-12.0, -9.6, T - 0.3, -0.3]]);
  // Chamfered outer corners (octagon ends): diagonal walls with the corner filled up to roof level.
  const chamfer = (cx: number, cz: number, sx: number, sz: number, mat: string) => {
    const c = 2.7;
    diagWall(cx, cz + sz * c, cx + sx * c, cz, T - 0.3, pitTop, 0.3, mat);
    for (let i = 0; i < 3; i++) {
      const a = (c * (3 - i)) / 3;
      const x0 = cx + sx * ((c * i) / 3);
      const x1 = cx + sx * ((c * (i + 1)) / 3);
      const z1 = cz + sz * (a - c / 6);
      slab(Math.min(x0, x1), T - 0.3, Math.min(cz, z1), Math.max(x0, x1), 0, Math.max(cz, z1), 'roof');
    }
  };
  chamfer(nPit.x0, nPit.z0, 1, 1, 'ply');
  chamfer(nPit.x1, nPit.z0, -1, 1, 'ply');
  chamfer(sPit.x0, sPit.z1, 1, -1, 'plyRed');
  chamfer(sPit.x1, sPit.z1, -1, -1, 'plyRed');
  // Underpass walls (below the B lane).
  slab(-14.3, T - 0.3, -8.5, -14, -0.3, -1.3, 'tunnel');
  slab(-9, T - 0.3, -8.5, -8.7, -0.3, -1.3, 'tunnel');
  // North pit: stair from the B lane down (east side), ship ladder up to the roof (north-east).
  k.ramp(-8.6, T, -14.5, -5.8, 0, -8.5, '+z', 'stairs', { tag: 'stairs' });
  k.ramp(-7.0, T, -19.0, -5.8, 0, -15.0, '-z', 'ladder', { tag: 'stairs' });
  slab(-7.0, T - 0.3, -20.0, -5.8, 0, -19.0, 'concrete');
  k.rail('z', -14.5, -8.7, -8.65, T, 'rail', 'steel', 1.0);
  // Machinery skid in the middle of the Orange Pit and a few crates.
  slab(-12.0, T, -16.4, -9.8, T + 1.8, -11.2, 'steel', { faceMats: { py: 'dark' } });
  crate(-15.6, -13.0, T);
  crate(-15.9, -17.6, T, 1.0);
  barrel(-16.3, -10.0, 'barrel', T);
  // South pit (Red Pit): entry stair in the south-east corner, the tank, crates, the red kerb.
  slab(-8.6, T - 0.3, 18, -5.8, 0, 20.5, 'concrete');
  k.ramp(-8.6, T, 12, -5.8, 0, 18, '+z', 'stairs', { tag: 'stairs' });
  k.rail('z', 12, 18, -8.65, T, 'rail', 'steel', 1.0);
  k.cyl(1.4, 3.6, 12, 'tank', -11.3, T + 1.8, 13.7);
  trim(-12.4, T + 3.6, 12.6, -10.2, T + 3.8, 14.8, 'steel');
  for (const [x0, z0, x1, z1] of [[-14.2, 2.2, -14.0, 17.4], [-8.9, 2.2, -8.7, 11.5], [-14.2, 2.2, -8.7, 2.4], [-14.2, 17.2, -9.6, 17.4]] as const) trim(x0, T, z0, x1, T + 0.02, z1, 'curbRed');
  slab(-16.8, T, 3.6, -15.2, T + 1.5, 6.4, 'ac');
  crate(-13.6, 5.2, T);
  crate(-15.8, 19.0, T, 1.0);
  slab(-16.8, T, 9.5, -15.6, T + 1.0, 11.3, 'pallet', { uv: 'raw' });
  barrel(-7.4, 4.0, 'barrelBlue', T);
  barrel(-7.0, 21.5, 'barrel', T);
  // Tunnels: concrete corridors under the roof slab, ceiling = the slab.
  const tunnel = (x0: number, x1: number, z0: number, z1: number) => {
    slab(x0, T - 0.3, z0, x1, T, z1, 'tunnelFloor', { hide: ['ny'] });
    slab(x0 - 0.3, T - 0.3, z0, x0, -0.3, z1, 'tunnel');
    slab(x1, T - 0.3, z0, x1 + 0.3, -0.3, z1, 'tunnel');
  };
  tunnel(-12.4, -9.9, -51, -22.7);
  slab(-12.7, T - 0.3, -51.3, -9.6, -0.3, -51, 'tunnel');
  tunnel(-12.0, -9.6, 23.2, 52);
  slab(-12.3, T - 0.3, 52, -9.3, -0.3, 52.3, 'tunnel');
  k.ramp(-12.4, T, -51, -9.9, 0, -45, '-z', 'stairs', { tag: 'stairs' });
  k.ramp(-12.0, T, 46, -9.6, 0, 52, '+z', 'stairs', { tag: 'stairs' });
  for (const z of [-40, -31, -25]) trim(-11.5, -0.6, z - 0.4, -10.8, -0.3, z + 0.4, 'lamp');
  for (const z of [27, 35, 42]) trim(-11.1, -0.6, z - 0.4, -10.4, -0.3, z + 0.4, 'lamp');
  for (const z of [-40, -31, -25]) k.light(-11.15, -1.0, z, [1.0, 1.05, 0.9], 7, 'tunnel');
  for (const z of [27, 35, 42]) k.light(-10.8, -1.0, z, [1.0, 1.05, 0.9], 7, 'tunnel');
  k.light(-11.5, -1.0, -5.0, [1.0, 1.0, 0.9], 6, 'tunnel');
  k.light(-11.0, 0.2, -15.5, [1.2, 0.95, 0.7], 9, 'work');
  k.light(-11.0, 0.2, 9.0, [1.2, 0.85, 0.7], 10, 'work');
  // Two concrete blocks on the B lane against the Orange Pit's south wall (the bays on the minimap).
  slab(-16.6, 0, -8.2, -15.4, 1.0, -6.6, 'concrete');
  slab(-10.4, 0, -8.2, -9.2, 1.0, -6.6, 'concrete');
  // Hood over the north tunnel's portal (on the roof) and a vent block.
  slab(-14.0, 0, -25.0, -11.9, 2.4, -22.7, 'concrete', { faceMats: { py: 'roofDark' } });
  slab(-4.6, 0, -17.6, -4.2, 1.6, -13.3, 'concrete');

  // =============================================================================================
  // Helipad: the Mechanical Room, its deck, both stairs, the Mi-8, the propane tank
  // =============================================================================================
  const mr = A.mechRoom;
  const hp = A.helipad;
  const dk = L.deck;
  const mrH = dk - 0.3;
  k.wall('x', mr.minX, mr.maxX, mr.minZ + 0.15, 0, mrH, 0.3, 'concrete', [[9.5, 12.0, 1.0, 2.4]]);
  k.wall('x', mr.minX, mr.maxX, mr.maxZ - 0.15, 0, mrH, 0.3, 'concrete', [[18.5, 20.0, 0, 2.4]]);
  k.wall('z', mr.minZ + 0.3, mr.maxZ - 0.3, mr.maxX - 0.15, 0, mrH, 0.3, 'concrete', [[0.0, 1.4, 0, 2.4]]);
  // West end: open (the underpass towards the B lane), with stub walls.
  slab(mr.minX, 0, mr.minZ + 0.3, mr.minX + 0.3, mrH, -1.4, 'concrete');
  slab(mr.minX, 0, 3.0, mr.minX + 0.3, mrH, mr.maxZ - 0.3, 'concrete');
  slab(mr.minX, 2.6, -1.4, mr.minX + 0.3, mrH, 3.0, 'concrete');
  // Deck (with the hatch over the ladder inside).
  const hatch = R(15.0, -1.8, 18.4, -0.6);
  floors([R(hp.minX, hp.minZ, hp.maxX, hp.maxZ)], [hatch], dk - 0.3, dk, 'deck');
  flatDecal(5.6, 5.6, 'hmark', 11.5, dk + 0.01, 0.8, 0, 4);
  for (const [x0, z0, x1, z1] of [[hp.minX, hp.minZ, hp.maxX, hp.minZ + 0.1], [hp.minX, hp.maxZ - 0.1, hp.maxX, hp.maxZ]] as const) trim(x0, dk, z0, x1, dk + 0.12, z1, 'hazard', { hide: ['ny'] });
  for (const [x, z] of [[hp.minX + 0.2, hp.minZ + 0.2], [hp.maxX - 0.2, hp.minZ + 0.2], [hp.minX + 0.2, hp.maxZ - 0.2], [hp.maxX - 0.2, hp.maxZ - 0.2]] as const) {
    trim(x - 0.1, dk, z - 0.1, x + 0.1, dk + 0.25, z + 0.1, 'lamp');
    k.glow(x, dk + 0.35, z, [0.2, 0.4, 1.0], 1.6, undefined, true);
  }
  // Inside the Mechanical Room: ship ladder up through the hatch, air handlers, pumps.
  k.ramp(13.0, 0, -1.8, 18.4, dk, -0.6, '+x', 'ladder', { tag: 'stairs' });
  k.rail('x', 13.0, 18.4, -0.55, 0, 'rail', 'steel', 1.0);
  slab(4.0, 0, -1.8, 7.2, 1.7, -0.2, 'ac');
  slab(9.0, 0, 1.8, 11.2, 1.3, 3.4, 'steel', { faceMats: { py: 'dark' } });
  k.cyl(0.25, 8, 8, 'steel', 12, 3.2, 3.1, 'x', false);
  slab(19.2, 0, 1.6, 21.2, 2.0, 3.4, 'ac');
  k.light(7.0, 3.0, 0.8, [1.0, 1.0, 0.9], 7, 'office');
  k.light(16.0, 3.0, 0.8, [1.0, 1.0, 0.9], 7, 'office');
  for (const x of [7.0, 16.0]) trim(x - 0.6, mrH - 0.06, 0.65, x + 0.6, mrH, 0.95, 'lamp');
  k.light(11.0, dk + 3.5, 0.8, [1.2, 1.1, 0.9], 12, 'work');
  // North stair (rising east along the north face) and its landing; south stair (rising west).
  k.ramp(0.2, 0, -4.6, 7.2, dk, -2.8, '+x', 'stairs', { tag: 'stairs' });
  slab(7.2, dk - 0.3, -4.6, 9.0, dk, -2.8, 'grate');
  k.rail('x', 0.2, 9.0, -4.55, 0, 'rail', 'steel', 1.0);
  post(9.0, -4.6, 0, dk - 0.3);
  k.ramp(10.4, 0, 4.4, 17.4, dk, 6.2, '-x', 'stairs', { tag: 'stairs' });
  slab(8.6, dk - 0.3, 4.4, 10.4, dk, 6.2, 'grate');
  k.rail('x', 8.6, 17.4, 6.15, 0, 'rail', 'steel', 1.0);
  post(8.6, 6.2, 0, dk - 0.3);
  // Deck posts along the overhangs.
  for (const x of [2.0, 7.0, 13.0, 21.6]) {
    post(x, hp.minZ + 0.15, 0, dk - 0.3, 0.13);
    post(x, hp.maxZ - 0.15, 0, dk - 0.3, 0.13);
  }
  // The Mi-8 (nose to the west, towards the crane): cabin, nose, engines, tail boom, rotors.
  {
    const y = dk;
    const zc = 1.4;
    k.cyl(1.2, 9.6, 10, 'heli', 10.0, y + 1.95, zc, 'x');
    slab(3.6, y + 0.9, zc - 1.0, 5.2, y + 2.8, zc + 1.0, 'heli');
    trim(3.4, y + 1.9, zc - 0.85, 3.6, y + 2.7, zc + 0.85, 'glass');
    slab(7.0, y + 3.15, zc - 0.7, 12.4, y + 3.95, zc + 0.7, 'heliDark');
    k.cyl(0.42, 7.2, 8, 'heli', 18.4, y + 2.4, zc, 'x');
    trim(21.4, y + 2.2, zc - 0.08, 22.3, y + 4.6, zc + 0.08, 'heli');
    trim(21.8, y + 3.4, zc + 0.1, 21.9, y + 5.4, zc + 0.16, 'dark');
    trim(9.8, y + 3.95, zc - 0.25, 10.4, y + 4.4, zc + 0.25, 'dark');
    for (let i = 0; i < 5; i++) {
      const a = (i * 2 * PI) / 5 + 0.3;
      beamLine(10.1, zc, 10.1 + Math.cos(a) * 10.4, zc + Math.sin(a) * 10.4, 0.45, y + 4.35, y + 4.45, 'dark');
    }
    for (const [x, z] of [[5.0, zc], [11.5, zc - 1.6], [11.5, zc + 1.6]] as const) {
      trim(x - 0.06, y, z - 0.06, x + 0.06, y + 0.9, z + 0.06, 'steel');
      k.cyl(0.32, 0.25, 8, 'rubber', x, y + 0.32, z, 'z', false);
    }
    wallDecal(1.4, 1.4, 'star', 13.2, y + 1.3, zc + 1.21, 0, 1);
    wallDecal(1.4, 1.4, 'star', 13.2, y + 1.3, zc - 1.21, PI, 1);
    barrel(19.6, -1.9, 'barrel', y);
    barrel(20.4, -2.0, 'barrel', y);
    crate(3.0, -2.0, y, 0.9);
  }
  // The propane tank on its cradles at the east end (east bulge).
  k.cyl(1.3, 7.0, 12, 'tank', 23.9, 1.8, 0.8, 'z');
  for (const z of [-1.6, 3.2]) slab(22.8, 0, z - 0.3, 25.0, 0.7, z + 0.3, 'concrete');
  trim(23.6, 3.1, 0.4, 24.2, 3.4, 1.2, 'steel');

  // =============================================================================================
  // The rest of the roof: shacks, the substation, the skip, the tarp fence, cover
  // =============================================================================================
  const shackRoof = L.shack;
  const shed = (x0: number, z0: number, x1: number, z1: number, mat: string, doors: { side: 'n' | 's' | 'e' | 'w'; a: number; b: number }[]) => {
    const h = shackRoof - 0.2;
    const holes = (side: 'n' | 's' | 'e' | 'w') => doors.filter((d) => d.side === side).map((d) => [d.a, d.b, 0, 2.1] as [number, number, number, number]);
    k.wall('x', x0, x1, z0 + 0.075, 0, h, 0.15, mat, holes('n'));
    k.wall('x', x0, x1, z1 - 0.075, 0, h, 0.15, mat, holes('s'));
    k.wall('z', z0 + 0.15, z1 - 0.15, x0 + 0.075, 0, h, 0.15, mat, holes('w'));
    k.wall('z', z0 + 0.15, z1 - 0.15, x1 - 0.075, 0, h, 0.15, mat, holes('e'));
    slab(x0 - 0.1, h, z0 - 0.1, x1 + 0.1, shackRoof, z1 + 0.1, 'shackRoof');
  };
  // Propane shack (north-east), with crates to climb onto its roof.
  shed(12.7, -25.1, 19.1, -21.3, 'shack', [{ side: 's', a: 16.6, b: 18.0 }, { side: 'w', a: -24.0, b: -22.4 }]);
  crate(19.95, -21.9, 0, 0.95);
  slab(19.4, 0, -23.7, 20.5, 1.9, -22.4, 'crate', { uv: 'raw' });
  barrel(13.6, -24.2);
  barrel(14.4, -24.4, 'barrelBlue');
  slab(17.6, 0, -24.8, 18.8, 1.8, -24.0, 'books');
  // Substation (on the centre line) and its fence.
  slab(-0.1, 0, -20.8, 2.5, 2.4, -15.5, 'steel', { faceMats: { py: 'dark' } });
  trim(-0.12, 0.2, -18.4, 2.52, 0.5, -17.9, 'hazard');
  k.fence('z', -15.5, -11.7, 1.0, 0, 2.2, 'fence', 'steel', 3);
  // The skip (rotated), north-east of the helipad.
  {
    const cx = 11.9;
    const cz = -11.5;
    const ux = 0.725;
    const uz = 0.689;
    beamLine(cx - ux * 3.7, cz - uz * 3.7, cx + ux * 3.7, cz + uz * 3.7, 2.5, 0, 1.9, 'yellow');
    for (let i = 0; i < 4; i++) {
      const s = -3.7 + 7.4 * ((i + 0.5) / 4);
      const px = cx + ux * s;
      const pz = cz + uz * s;
      slab(px - 1.2, 0, pz - 1.2, px + 1.2, 1.9, pz + 1.2, 'clip', { noRender: true });
    }
  }
  // Tarp-covered pallet stack and the tarp fence (south-east).
  slab(0.9, 0, 10.1, 6.3, 1.4, 12.3, 'tarpPile');
  const tarpFence = (axis: 'x' | 'z', from: number, to: number, at: number) => {
    k.fence(axis, from, to, at, 0, 2.2, 'fence', 'steel', 3);
    const len = to - from;
    if (axis === 'x') {
      wallDecal(len, 1.8, 'tarp', (from + to) / 2, 0.15, at + 0.04, 0, 3);
      slab(from, 0, at - 0.05, to, 2.0, at + 0.05, 'clip', { noRender: true, players: false, bullets: false, sight: true });
    } else {
      wallDecal(len, 1.8, 'tarp', at + 0.04, 0.15, (from + to) / 2, PI / 2, 3);
      slab(at - 0.05, 0, from, at + 0.05, 2.0, to, 'clip', { noRender: true, players: false, bullets: false, sight: true });
    }
  };
  tarpFence('x', 7.3, 16.2, 12.6);
  tarpFence('z', 12.6, 17.6, 16.2);
  // Green shack (south-east), with crates on its east side to climb its roof.
  shed(4.1, 17.6, 8.4, 24.5, 'shackGreen', [{ side: 'n', a: 5.4, b: 6.8 }, { side: 'e', a: 18.6, b: 20.0 }]);
  crate(8.9, 21.5, 0, 0.95);
  slab(8.4, 0, 22.0, 9.5, 1.9, 23.2, 'crate', { uv: 'raw' });
  slab(4.5, 0, 22.8, 5.7, 1.0, 24.1, 'books');
  // Plywood wall in the B lane east of the Red Pit.
  slab(-2.9, 0, 1.6, -2.6, 2.2, 9.1, 'ply');
  slab(-2.9, 0, 1.1, -1.8, 1.2, 1.6, 'crate', { uv: 'raw' });
  // AC units along the fronts of both buildings and at the edges.
  for (const [x0, z0, x1, z1] of [[-16.0, -27.4, -13.5, -25.8], [3.0, -27.4, 5.5, -25.8], [-21.6, -19.0, -19.6, -17.4], [-21.6, 15.8, -19.6, 17.4], [12.0, 25.4, 14.6, 27.0]] as const) {
    slab(x0, 0, z0, x1, 1.4, z1, 'ac');
    trim(x0 + 0.3, 1.4, z0 + 0.3, x1 - 0.3, 1.5, z1 - 0.3, 'dark');
  }
  // Pallets of bricks, crates, barrels and jersey barriers about the roof.
  for (const [x, z] of [[6.5, -23.8], [-4.2, -25.4], [-20.4, -6.6], [-19.2, 6.9], [17.6, 16.3], [-1.0, 19.4], [9.5, -6.2], [20.6, -14.6]] as const) {
    slab(x - 0.6, 0, z - 0.5, x + 0.6, 0.15, z + 0.5, 'pallet', { uv: 'raw' });
    slab(x - 0.55, 0.15, z - 0.45, x + 0.55, 0.95, z + 0.45, 'crate', { uv: 'raw' });
  }
  crate(-20.4, 7.8, 0, 1.0);
  crate(-21.1, -13.0, 0, 1.1);
  crate(18.6, 22.6);
  crate(-3.5, 24.2);
  barrel(20.6, -16.0);
  barrel(21.4, -15.5, 'barrelBlue');
  barrel(13.2, 24.8);
  barrel(-20.8, 21.0, 'barrelBlue');
  slab(-1.6, 0, -9.6, 0.8, 1.0, -9.1, 'barrier', { uv: 'raw' });
  slab(14.6, 0, -7.4, 17.0, 1.0, -6.9, 'barrier', { uv: 'raw' });
  slab(1.2, 0, 15.6, 1.7, 1.0, 18.0, 'barrier', { uv: 'raw' });
  slab(-4.0, 0, 13.4, -3.5, 1.0, 15.8, 'barrier', { uv: 'raw' });
  slab(17.6, 0, 7.6, 20.0, 1.0, 8.1, 'barrier', { uv: 'raw' });
  // Work lights on poles.
  k.lampPole(-19.8, -24.5, 5.0, 0.8, 0, 'steel', 'lamp', [1.5, 1.2, 0.8], 13, 'work');
  k.lampPole(20.0, 18.5, 5.0, -0.8, 0, 'steel', 'lamp', [1.5, 1.2, 0.8], 13, 'work');

  // =============================================================================================
  // Elevator shaft on the west bulge (ladder on its south face), a plank to the first crane
  // =============================================================================================
  {
    const s = A.elevatorShaft;
    const top = L.elevator;
    slab(s.minX, 0, s.minZ, s.maxX, top, s.maxZ, 'concrete', { faceMats: { py: 'roofDark' } });
    wallDecal(2.4, 2.6, 'elevator', s.maxX + 0.02, 0, -1.6, PI / 2, 2);
    wallDecal(2.4, 2.6, 'elevator', s.maxX + 0.02, 0, 2.4, PI / 2, 2);
    trim(s.maxX, 2.8, -3.2, s.maxX + 0.1, 3.3, 4.0, 'hazard');
    // Parapet lip on top and the water tank (cover up there).
    trim(s.minX, top, s.minZ, s.minX + 0.2, top + 0.4, s.maxZ, 'parapet', { hide: ['ny'] });
    k.cyl(1.0, 2.2, 10, 'tank', -25.0, top + 1.1, 3.4);
    slab(-23.6, top, 0.6, -22.6, top + 1.0, 2.0, 'ac');
    k.ramp(-24.8, 0, s.maxZ, -23.6, top, 10.6, '-z', 'ladder', { tag: 'stairs' });
    // Plank from the shaft's roof up onto the end of the first jib.
    k.ramp(-25.6, top - 0.1, -6.7, -24.4, L.jibA, s.minZ, '-z', 'grate', { tag: 'stairs' });
  }

  // =============================================================================================
  // Cranes: jib A (from the shaft, out to the west-north-west), jib C (crossing above A, back to
  // the north building), both walkable along their length; towers and counter-jibs in the air
  // =============================================================================================
  const jibA0 = { x: -25.0, z: -7.2 };
  const dirA = { x: -0.841, z: -0.541 };
  const cross = { x: jibA0.x + dirA.x * 16, z: jibA0.z + dirA.z * 16 };
  const dirC = { x: -0.424, z: 0.906 };
  const jibC0 = { x: cross.x - dirC.x * 17, z: cross.z - dirC.z * 17 };
  const crane = (tip: { x: number; z: number }, dir: { x: number; z: number }, walkLen: number, towerAt: number, deck: number) => {
    const at = (s: number) => ({ x: tip.x + dir.x * s, z: tip.z + dir.z * s });
    const end = at(towerAt + 12);
    const w = at(walkLen);
    // You walk on top of the jib (a grating on its top chords); collision only along the walkable
    // stretch. The lattice sides and the bottom chord hang below it (render only).
    beamLine(tip.x, tip.z, w.x, w.z, 1.4, deck - 0.2, deck, 'grate', true);
    beamLine(w.x, w.z, end.x, end.z, 1.4, deck - 0.2, deck, 'grate');
    const nx = -dir.z * 0.7;
    const nz = dir.x * 0.7;
    for (const sgn of [1, -1]) {
      beamLine(tip.x + nx * sgn, tip.z + nz * sgn, end.x + nx * sgn, end.z + nz * sgn, 0.06, deck - 1.7, deck - 0.2, 'lattice');
      beamLine(tip.x + nx * sgn, tip.z + nz * sgn, end.x + nx * sgn, end.z + nz * sgn, 0.14, deck - 0.2, deck + 0.05, 'yellow');
    }
    beamLine(tip.x, tip.z, end.x, end.z, 0.3, deck - 1.9, deck - 1.7, 'yellow');
    // Tower (mast) from far below up to the jib, the cab, the counterweights.
    const t = at(towerAt);
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) trim(t.x + ox - 0.12, -120, t.z + oz - 0.12, t.x + ox + 0.12, deck - 1.9, t.z + oz + 0.12, 'yellow');
    wallDecal(2.0, 118 + deck, 'lattice', t.x, -120, t.z + 1.0, 0, 2);
    wallDecal(2.0, 118 + deck, 'lattice', t.x, -120, t.z - 1.0, PI, 2);
    wallDecal(2.0, 118 + deck, 'lattice', t.x + 1.0, -120, t.z, PI / 2, 2);
    wallDecal(2.0, 118 + deck, 'lattice', t.x - 1.0, -120, t.z, -PI / 2, 2);
    trim(t.x - 1.3, deck - 3.2, t.z - 1.3, t.x + 1.3, deck - 1.9, t.z + 1.3, 'yellow');
    const cab = at(towerAt - 2.2);
    trim(cab.x - 0.8, deck - 3.6, cab.z - 0.8, cab.x + 0.8, deck - 1.95, cab.z + 0.8, 'steel');
    const cw = at(towerAt + 10);
    trim(cw.x - 1.3, deck - 2.4, cw.z - 1.3, cw.x + 1.3, deck + 0.4, cw.z + 1.3, 'concrete', { ry: Math.atan2(dir.x, dir.z) });
    // Trolley and hook over the roof side.
    const hk = at(Math.min(6, walkLen - 2));
    trim(hk.x - 0.6, deck - 2.3, hk.z - 0.6, hk.x + 0.6, deck - 1.9, hk.z + 0.6, 'dark');
    k.glow(end.x, deck + 2.2, end.z, [1, 0.25, 0.15], 2.5, undefined, true);
  };
  crane(jibA0, dirA, 17.5, 30, L.jibA);
  crane(jibC0, dirC, 17.5, 31, L.jibC);
  // Window-cleaning gondola at the end of jib C, and the ledge along the north building's front to
  // the upper ledge (the covered walkway's roof).
  slab(-30.8, L.jibA - 0.3, -31.6, -26.6, L.jibA, -30.2, 'grate', { tag: 'gondola' });
  k.rail('x', -30.8, -26.6, -30.25, L.jibA, 'rail', 'steel', 1.0);
  for (const x of [-30.5, -26.9]) trim(x - 0.02, L.jibA, -30.92, x + 0.02, 14, -30.88, 'steel');
  slab(-26.6, L.deck - 0.3, -31.65, -19.9, L.deck, -30.65, 'concrete', { tag: 'ledge' });
  // Decorative cranes (the two other MW2 jibs) and a hanging load of beams.
  beamLine(-23.4, -11.6, -47.6, -26.7, 1.4, 9.0, 10.6, 'lattice');
  beamLine(-23.4, -11.6, -47.6, -26.7, 0.3, 10.6, 10.8, 'yellow');
  beamLine(-24.9, 11.5, -52.0, 32.6, 1.4, 11.5, 13.1, 'lattice');
  beamLine(-24.9, 11.5, -52.0, 32.6, 0.3, 13.1, 13.3, 'yellow');
  for (const [x, z, h] of [[-47.6, -26.7, 9.0], [-52.0, 32.6, 11.5]] as const) for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) trim(x + ox - 0.12, -120, z + oz - 0.12, x + ox + 0.12, h, z + oz + 0.12, 'yellow');
  trim(-6.5, 10.0, 0.4, -1.5, 10.5, 2.0, 'yellow');
  trim(-6.3, 10.5, 0.6, -1.7, 10.9, 1.8, 'yellow');
  for (const x of [-6.2, -1.8]) trim(x - 0.02, 10.9, 1.18, x + 0.02, 22, 1.22, 'steel');

  // =============================================================================================
  // North building (Phonic): elevator lobby (spawn), office hall, back room, restrooms, stairs
  // =============================================================================================
  {
    const H = 8.4;
    const ceil = 3.8;
    const t = 0.3;
    const outer = (axis: 'x' | 'z', a: number, b: number, at: number, holes: [number, number, number, number][] = [], mat = 'brick') => k.wall(axis, a, b, at, 0, H, t, mat, holes);
    outer('x', -28.4, -19.9, -65.45);
    outer('z', -65.6, -58.7, -20.05);
    outer('x', -19.9, -4.4, -58.55);
    outer('z', -58.7, -45.1, -4.55);
    outer('x', -4.4, 11.1, -44.95);
    outer('z', -45.1, -37.6, 10.95);
    outer('x', 11.1, 26.4, -37.45);
    outer('z', -37.6, -31.7, 26.25);
    outer('z', -65.6, -31.7, -28.25);
    // The front (facing the roof): doors and big windows into the hall.
    const door = (a: number, b: number): [number, number, number, number] => [a, b, 0, 2.4];
    const win = (a: number, b: number): [number, number, number, number] => [a, b, 1.0, 2.9];
    outer('x', -28.4, 26.4, -31.85, [win(-11.2, -9.9), door(-9.6, -7.8), win(-7.5, -2.0), door(-1.6, 0.4), win(0.7, 5.3), door(5.6, 7.4), win(7.7, 10.2), door(15.0, 16.6)], 'facadeS');
    for (const [a, b] of [[-11.2, -9.9], [-7.5, -2.0], [0.7, 5.3], [7.7, 10.2]] as const) wallDecal(b - a, 1.9, 'glass', (a + b) / 2, 1.0, -31.85, 0, 2);
    // Upper storey windows above the walkway roof.
    wallDecal(53, 3.4, 'winUp', -1.0, 4.6, -31.68, 0, 8);
    // Interior walls (offices are one storey; the floor above is out of bounds).
    const iw = (axis: 'x' | 'z', a: number, b: number, at: number, holes: [number, number, number, number][] = [], mat = 'wall') => k.wall(axis, a, b, at, 0, ceil, 0.15, mat, holes);
    iw('z', -58.7, -39.5, -20.0, [[-57.4, -55.6, 0, 2.4]]); // lobby | corridor, service core, restroom
    iw('x', -20.0, -4.4, -54.1, [[-13.8, -11.4, 0, 2.4]]); // corridor | core, stair hall, restroom 2
    iw('x', -20.0, -15.2, -47.0, []); // restrooms (tiled, by the stairs)
    iw('z', -54.1, -47.0, -15.2, [[-52.0, -50.6, 0, 2.4]]);
    for (const z of [-53.4, -51.6]) slab(-19.8, 0, z - 0.4, -18.4, 0.9, z + 0.5, 'cubicle');
    iw('z', -47.0, -39.5, -15.2, []); // restroom | stair hall
    iw('x', -20.0, -15.2, -39.5, [[-18.4, -17.0, 0, 2.4]]); // restroom door to the hall
    iw('x', -15.2, -8.8, -39.5, [[-14.6, -12.8, 0, 2.4]]); // stair hall door to the hall
    iw('z', -54.1, -39.5, -8.8, [[-50.0, -48.6, 0, 2.4]]); // stair hall | restroom 2, back room
    iw('x', -8.8, -4.4, -45.1, []); // restroom 2 | back room
    iw('x', -8.8, 11.1, -39.5, [[-2.3, 2.0, 0, 2.4], [7.3, 10.6, 0, 2.4]], 'wallWood'); // back room | hall
    iw('z', -45.1, -43.0, 2.5, []); // reception counter in the back room
    slab(-2.8, 0, -43.2, 2.5, 1.1, -42.8, 'desk');
    iw('z', -37.6, -31.7, 11.1, [[-36.5, -34.5, 0, 2.4]]); // hall | storage
    // Stair well: rails around the opening.
    k.rail('z', -51, -45, -12.45, 0, 'rail', 'steel', 1.0);
    k.rail('z', -51, -45, -9.85, 0, 'rail', 'steel', 1.0);
    k.rail('x', -12.4, -9.9, -44.95, 0, 'rail', 'steel', 1.0);
    // Columns, desks, cubicles, shelves, copiers.
    for (const x of [-4.1, 3.3, -15.5]) slab(x - 0.35, 0, -35.85, x + 0.35, ceil, -35.15, 'concrete');
    for (const [x0, z0, x1, z1] of [[-25.2, -38.6, -23.0, -37.6], [-10.8, -38.8, -7.6, -37.8], [6.0, -38.8, 9.6, -37.8], [14.0, -36.6, 17.4, -35.6], [19.6, -36.6, 23.0, -35.6], [-12.0, -34.0, -9.0, -33.2]] as const) {
      slab(x0, 0, z0, x1, 0.75, z1, 'desk');
      slab(x0, 0.75, z1 - 0.05, x1, 1.35, z1, 'cubicle');
    }
    slab(-27.9, 0, -38.0, -27.3, 1.9, -34.0, 'books');
    slab(4.0, 0, -44.6, 7.6, 1.9, -44.0, 'books');
    slab(-6.0, 0, -44.7, -4.9, 1.3, -43.6, 'steel');
    slab(23.6, 0, -33.0, 25.8, 1.2, -32.2, 'crate', { uv: 'raw' });
    slab(21.0, 0, -37.0, 25.6, 1.8, -36.4, 'books');
    slab(-19.6, 0, -46.6, -18.6, 0.9, -44.6, 'cubicle'); // restroom stalls
    slab(-17.6, 0, -46.6, -16.6, 0.9, -44.6, 'cubicle');
    // Lobby: elevators on the west wall, a reception desk, benches.
    for (const z of [-61.5, -57.0, -50.5, -46.0]) wallDecal(2.2, 2.6, 'elevator', -28.08, 0, z, PI / 2, 2);
    slab(-24.6, 0, -53.6, -22.2, 1.1, -52.6, 'desk');
    slab(-21.4, 0, -63.0, -20.6, 0.5, -60.0, 'cubicle');
    slab(-27.6, 0, -43.0, -26.8, 0.5, -40.0, 'cubicle');
    // Ceiling and roof slabs.
    floors([nbLobby, ...nbRest], [], ceil, ceil + 0.3, 'ceiling', { hide: ['py'] });
    floors([nbLobby, ...nbRest], [], H - 0.3, H, 'roofDark', { hide: ['ny'] });
    // Covered walkway along the front: piers, end walls; its roof is the upper ledge.
    floors([R(-19.9, -31.7, 19.1, -28)], [], L.deck - 0.3, L.deck, 'concrete');
    slab(-19.9, 0, -31.7, -19.6, L.deck - 0.3, -28, 'concrete');
    slab(18.8, 0, -31.7, 19.1, L.deck - 0.3, -28, 'concrete');
    for (const x of [-12.0, -4.0, 4.0, 12.0]) slab(x - 0.3, 0, -28.6, x + 0.3, L.deck - 0.3, -28.0, 'concrete');
    trim(-19.9, L.deck, -28.15, 19.1, L.deck + 0.3, -28.0, 'parapet', { hide: ['ny'] });
    clip(19.1, L.deck, -31.7, 19.4, 9, -28);
    // Gondolas hanging on the facade above (decoration).
    for (const x of [-8, 10]) {
      trim(x - 1.6, 6.4, -31.6, x + 1.6, 6.5, -30.9, 'grate');
      trim(x - 1.6, 6.5, -30.95, x + 1.6, 7.4, -30.9, 'rail', { collide: false });
      for (const ox of [-1.5, 1.5]) trim(x + ox - 0.02, 6.5, -31.27, x + ox + 0.02, H + 2, -31.23, 'steel');
    }
    // The big KRIEGLER letters on the roof of the west wing, facing the cranes.
    trim(-27.0, H, -58.0, -26.8, H + 0.6, -38.0, 'steel');
    for (const z of [-57, -48, -39]) trim(-27.1, H, z - 0.1, -26.9, H + 3.4, z + 0.1, 'steel');
    wallDecal(20, 3.6, 'sign', -27.2, H + 0.4, -48.0, -PI / 2, 4);
    // Lights.
    for (const z of [-60, -48, -36]) k.light(-24.2, 3.2, z, [1.2, 1.1, 0.95], 9, 'office');
    for (const [x, z] of [[-12, -35.5], [0, -35.5], [12, -35.0], [20, -34.6], [0, -42], [-12, -48], [-12, -56.4], [-17.6, -43]] as const) k.light(x, 3.2, z, [1.1, 1.05, 0.95], 8, 'office');
    for (const [x, z] of [[-24.2, -60], [-24.2, -48], [-24.2, -36], [-12, -35.5], [0, -35.5], [12, -35.0], [20, -34.6], [0, -42]] as const) trim(x - 0.6, ceil - 0.06, z - 0.15, x + 0.6, ceil, z + 0.15, 'lamp');
  }

  // =============================================================================================
  // South building (Actibase): front corridor, offices, stairs, reception wing (spawn), roof
  // =============================================================================================
  {
    const H = L.southRoof;
    const ceil = 3.6;
    const t = 0.3;
    const outer = (axis: 'x' | 'z', a: number, b: number, at: number, holes: [number, number, number, number][] = [], mat = 'facadeS') => k.wall(axis, a, b, at, 0, H, t, mat, holes);
    const door = (a: number, b: number): [number, number, number, number] => [a, b, 0, 2.4];
    const win = (a: number, b: number): [number, number, number, number] => [a, b, 1.0, 2.8];
    outer('x', -19.6, 27.6, 32.95, [win(-17.5, -6.0), door(-5.4, -3.8), win(-3.0, 1.6), door(2.4, 4.0), win(4.8, 10.0), win(11.0, 16.6), door(17.0, 18.6), win(22.0, 27.0)]);
    for (const [a, b] of [[-17.5, -6.0], [-3.0, 1.6], [4.8, 10.0], [11.0, 16.6], [22.0, 27.0]] as const) wallDecal(b - a, 1.8, 'glass', (a + b) / 2, 1.0, 32.95, PI, 2);
    wallDecal(46, 3.0, 'winUp', 4.0, 4.2, 32.78, PI, 8);
    outer('z', 32.8, 39.0, 27.45);
    outer('x', 22.3, 27.6, 38.85);
    outer('z', 39.0, 49.6, 22.45);
    outer('x', 22.3, 27.6, 49.75);
    outer('z', 49.6, 59.7, 27.45);
    outer('x', 18.3, 27.6, 59.55);
    outer('z', 49.6, 59.7, 18.45);
    outer('x', 10.6, 18.3, 49.45);
    outer('z', 49.6, 55.2, 10.45);
    outer('x', -19.6, 10.6, 55.05);
    outer('z', 52.0, 55.2, -19.45);
    outer('x', -19.6, -12.2, 52.15);
    outer('z', 44.5, 52.0, -12.05);
    outer('x', -12.2, -7.6, 44.65);
    outer('z', 36.3, 44.5, -7.45);
    outer('x', -19.6, -7.6, 36.15);
    outer('z', 32.8, 36.3, -19.45);
    const iw = (axis: 'x' | 'z', a: number, b: number, at: number, holes: [number, number, number, number][] = [], mat = 'wall') => k.wall(axis, a, b, at, 0, ceil, 0.15, mat, holes);
    iw('x', -7.6, 10.6, 36.3, [[-3.3, -1.7, 0, 2.4], [6.0, 7.4, 0, 2.4]]); // front corridor | offices
    iw('x', -7.6, 10.6, 52.0, [[3.0, 4.2, 0, 2.4]]); // offices | back corridor
    iw('z', 44.5, 52.0, -7.6, []); // stairwell | offices
    // Glass-fronted offices along the north side.
    for (const [x0, x1, d] of [[-7.6, -3.6, -5.6], [1.0, 5.6, 3.3], [8.2, 10.6, 9.4]] as const) {
      iw('x', x0, x1, 39.5, [[d - 0.6, d + 0.6, 0, 2.3], [x0 + 0.2, d - 0.7, 1.0, 2.6], [d + 0.7, x1 - 0.2, 1.0, 2.6]], 'cubicle');
      if (x0 > -7) iw('z', 36.3, 39.5, x0, []);
      if (x1 < 10) iw('z', 36.3, 39.5, x1, []);
      slab(x0 + 0.4, 0, 36.5, x0 + 2.2, 0.75, 37.3, 'desk');
    }
    // Meeting room, cubicles, shelves (the ACTIBASE office floor).
    iw('x', -5.5, -1.7, 44.8, []);
    iw('x', -5.5, -1.7, 50.1, []);
    iw('z', 44.8, 50.1, -5.5, []);
    iw('z', 44.8, 50.1, -1.7, [[46.5, 47.7, 0, 2.3]]);
    slab(-4.6, 0, 46.4, -2.6, 0.75, 48.6, 'desk');
    for (const [x, z] of [[1.5, 42.5], [6.5, 42.5], [1.5, 47.5], [6.5, 47.5]] as const) {
      slab(x - 1.6, 0, z - 0.05, x + 1.6, 1.3, z + 0.05, 'cubicle');
      slab(x - 0.05, 0, z - 1.4, x + 0.05, 1.3, z + 1.4, 'cubicle');
      slab(x - 1.5, 0, z - 1.3, x - 0.1, 0.75, z - 0.1, 'desk');
      slab(x + 0.1, 0, z + 0.1, x + 1.5, 0.75, z + 1.3, 'desk');
    }
    slab(-7.3, 0, 40.0, -6.7, 1.9, 43.6, 'books');
    slab(9.8, 0, 49.0, 10.3, 1.9, 51.6, 'books');
    // Stairwell rails.
    k.rail('z', 46, 52, -12.05, 0, 'rail', 'steel', 1.0);
    k.rail('z', 46, 52, -9.55, 0, 'rail', 'steel', 1.0);
    k.rail('x', -12.0, -9.6, 45.95, 0, 'rail', 'steel', 1.0);
    // Back corridor: copier, boxes.
    slab(-18.8, 0, 52.4, -17.6, 1.1, 53.4, 'steel');
    crate(7.8, 54.3, 0, 0.9);
    // Front corridor: reception counter, planters; east wing partition.
    slab(-14.0, 0, 34.8, -10.0, 1.1, 35.6, 'desk');
    slab(23.6, 0, 37.4, 26.6, 0.75, 38.4, 'desk');
    // East wing: the reception room (door from the front corridor and from the offices), the corridor
    // down to the elevator lobby (team 0 spawn), elevators on its south wall.
    iw('z', 36.3, 49.6, 10.6, [[44.0, 45.4, 0, 2.3]]);
    iw('x', 10.6, 22.3, 39.0, [[13.0, 14.6, 0, 2.4], [18.6, 21.8, 0, 2.6]]);
    iw('z', 39.0, 49.6, 18.3, [[46.6, 48.4, 0, 2.4]]);
    iw('x', 18.3, 22.3, 49.6, [[18.8, 21.8, 0, 2.6]]);
    slab(12.2, 0, 41.6, 15.6, 1.1, 42.4, 'desk');
    slab(16.4, 0, 47.2, 17.8, 1.9, 48.8, 'books');
    slab(11.0, 0, 46.8, 12.0, 0.5, 49.0, 'cubicle');
    for (const x of [20.6, 25.4]) wallDecal(2.2, 2.6, 'elevator', x, 0, 59.38, PI, 2);
    slab(26.4, 0, 51.0, 27.2, 0.5, 54.0, 'cubicle');
    // Ceiling and roof.
    floors([...sbTile, ...sbCarpet], [], ceil, ceil + 0.3, 'ceiling', { hide: ['py'] });
    floors([...sbTile, ...sbCarpet], [], H - 0.3, H, 'roof', { hide: ['ny'] });
    // Parapet around the roof, open towards the front ledge (with a gap for the hanging platform).
    const rp = (x0: number, z0: number, x1: number, z1: number, clipIt = true) => {
      slab(x0, H, z0, x1, H + 1.0, z1, 'parapet');
      if (clipIt) clip(x0, H + 1.0, z0, x1, H + 5, z1);
    };
    rp(-18.0, 32.8, 17.0, 33.1, false);
    rp(17.0, 32.8, 27.6, 33.1);
    rp(27.3, 33.1, 27.6, 38.7);
    rp(22.3, 38.7, 27.6, 39.0);
    rp(22.3, 39.0, 22.6, 49.6);
    rp(22.3, 49.6, 27.6, 49.9);
    rp(27.3, 49.9, 27.6, 59.7);
    rp(18.3, 59.4, 27.3, 59.7);
    rp(18.3, 49.6, 18.6, 59.4);
    rp(10.6, 49.6, 18.3, 49.9);
    rp(10.3, 49.6, 10.6, 55.2);
    rp(-19.6, 54.9, 10.3, 55.2);
    rp(-19.6, 52.0, -19.3, 54.9);
    rp(-19.6, 52.0, -12.2, 52.3);
    rp(-12.2, 44.5, -11.9, 52.0);
    rp(-12.2, 44.5, -7.6, 44.8);
    rp(-7.9, 36.3, -7.6, 44.5);
    rp(-19.6, 36.0, -7.9, 36.3);
    rp(-19.6, 33.1, -19.3, 36.0);
    clip(-19.9, H, 32.8, -19.6, H + 5, 36.0);
    // The roof: teddy bears, the WKM block, AC units, a propane tank, a skylight.
    slab(-4.0, H, 45.0, -2.0, H + 1.4, 46.2, 'concrete');
    wallDecal(2.0, 1.4, 'wkm', -3.0, H, 44.98, PI, 1);
    for (const [x, z] of [[-1.3, 45.4], [-0.8, 45.9], [-1.5, 46.3]] as const) {
      slab(x - 0.15, H, z - 0.12, x + 0.15, H + 0.35, z + 0.12, 'bear');
      slab(x - 0.1, H + 0.35, z - 0.09, x + 0.1, H + 0.55, z + 0.09, 'bear');
    }
    for (const [x0, z0, x1, z1] of [[2.0, 40.0, 4.6, 41.6], [6.0, 47.0, 8.6, 48.6], [-6.8, 40.4, -4.2, 41.8], [19.0, 44.0, 21.6, 45.6]] as const) slab(x0, H, z0, x1, H + 1.4, z1, 'ac');
    k.cyl(0.9, 4.2, 10, 'tank', 1.0, H + 1.0, 52.2, 'x');
    slab(-1.2, H, 51.6, -0.8, H + 0.4, 52.8, 'concrete');
    slab(2.8, H, 51.6, 3.2, H + 0.4, 52.8, 'concrete');
    // Lights.
    for (const [x, z] of [[-12, 34.5], [2, 34.5], [16, 35.5], [24, 36.5], [-2, 42], [6, 46], [0, 49.5], [-8, 53.6], [4, 53.6], [21, 44], [25, 44], [23, 55], [-10, 48.5]] as const) k.light(x, 3.0, z, [1.1, 1.05, 0.95], 8, 'office');
    for (const [x, z] of [[-12, 34.5], [2, 34.5], [16, 35.5], [-2, 42], [6, 46], [21, 44], [25, 44], [23, 55]] as const) trim(x - 0.6, ceil - 0.06, z - 0.15, x + 0.6, ceil, z + 0.15, 'lamp');
  }
  // Covered walkway in front of the south building; its roof is the front ledge. Ladder at its east
  // end, the hanging platform (a tilted beam) at its west end up to the roof.
  {
    const y = L.ledgeS;
    floors([R(-19.9, 28, 19.6, 32.8)], [], y - 0.3, y, 'concrete');
    slab(-19.9, 0, 28, -19.6, y - 0.3, 32.8, 'concrete');
    slab(19.3, 0, 28, 19.6, y - 0.3, 32.8, 'concrete');
    for (const x of [-12.0, -4.0, 4.0, 12.0]) slab(x - 0.3, 0, 28.0, x + 0.3, y - 0.3, 28.6, 'concrete');
    trim(-19.9, y, 28.0, 19.6, y + 0.3, 28.15, 'parapet', { hide: ['ny'] });
    clip(-20.2, y, 28, -19.9, y + 5, 32.8);
    clip(19.6, y, 28, 19.9, y + 5, 32.8);
    k.ramp(17.6, 0, 23.0, 18.8, y, 28.0, '+z', 'ladder', { tag: 'stairs' });
    k.ramp(-18.6, y - 0.2, 31.2, -11.6, L.southRoof, 32.7, '-x', 'grate', { tag: 'stairs' });
    slab(-19.9, L.southRoof - 0.3, 31.2, -18.6, L.southRoof, 32.8, 'grate');
    for (const x of [-18.4, -12.0]) trim(x - 0.02, L.southRoof, 31.93, x + 0.02, 16, 31.97, 'steel');
    slab(6.0, y, 30.6, 8.4, y + 1.3, 32.0, 'ac');
  }

  // =============================================================================================
  // Scenery: the tower below the roof, its setback deck, the city far below
  // =============================================================================================
  {
    const bx0 = -29.2;
    const bx1 = 28.8;
    const bz0 = -67.4;
    const bz1 = 61.6;
    const setY = -8;
    flatDecal(bx1 - bx0, bz1 - bz0, 'setback', (bx0 + bx1) / 2, setY, (bz0 + bz1) / 2, 0, 8);
    // Fascia under the roof edges, down to the setback.
    const fascia = (x0: number, z0: number, x1: number, z1: number, ry: number) => wallDecal(Math.hypot(x1 - x0, z1 - z0), -setY, 'concrete', (x0 + x1) / 2, setY, (z0 + z1) / 2, ry, 2);
    fascia(-26.3, -10.9, -26.3, 11.2, -PI / 2);
    fascia(26.4, -10.9, 26.4, 11.2, PI / 2);
    fascia(-22.6, -28, -22.6, -10.9, -PI / 2);
    fascia(-22.6, 11.2, -22.6, 28, -PI / 2);
    fascia(22.7, -28, 22.7, -10.9, PI / 2);
    fascia(22.7, 11.2, 22.7, 28, PI / 2);
    fascia(-28.4, -65.6, -28.4, -31.7, -PI / 2);
    fascia(27.6, 32.8, 27.6, 59.7, PI / 2);
    // Scaffolding on the setback along both long sides.
    for (const x of [-27.8, 27.4]) {
      for (let z = bz0 + 3; z < bz1 - 2; z += 6) trim(x - 0.05, setY, z - 0.05, x + 0.05, -0.6, z + 0.05, 'steel');
      wallDecal(bz1 - bz0 - 6, -setY - 0.8, 'scaffold', x, setY, (bz0 + bz1) / 2, x < 0 ? -PI / 2 : PI / 2, 4);
    }
    // The tower's own facade, from the setback down into the haze.
    wallDecal(bz1 - bz0, 160, 'tower', bx0, setY - 160, (bz0 + bz1) / 2, -PI / 2, 4);
    wallDecal(bz1 - bz0, 160, 'tower', bx1, setY - 160, (bz0 + bz1) / 2, PI / 2, 4);
    wallDecal(bx1 - bx0, 160, 'tower', (bx0 + bx1) / 2, setY - 160, bz0, PI, 4);
    wallDecal(bx1 - bx0, 160, 'tower', (bx0 + bx1) / 2, setY - 160, bz1, 0, 4);
    // The city: towers in a ring around (deterministic), their faces towards the map, a street grid.
    flatDecal(1400, 1400, 'street', 0, -170, 0, 0, 6);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const mats = ['tower', 'towerB', 'towerC'];
    for (let i = 0; i < 46; i++) {
      const ang = (i / 46) * 2 * PI + rnd() * 0.12;
      // Near ones stand well below the roof (you look down on them); the far ring rises into the haze.
      const dist = 110 + rnd() * 300 + (i % 3) * 25;
      const cx = Math.sin(ang) * dist;
      const cz = Math.cos(ang) * dist;
      const hx = 9 + rnd() * 16;
      const hz = 9 + rnd() * 16;
      const top = dist < 230 ? -115 + rnd() * 95 : -70 + rnd() * 150;
      const base = -170;
      const m = mats[i % 3]!;
      const h = top - base;
      if (cz > 0) wallDecal(hx * 2, h, m, cx, base, cz - hz, PI, 3);
      else wallDecal(hx * 2, h, m, cx, base, cz + hz, 0, 3);
      if (cx > 0) wallDecal(hz * 2, h, m, cx - hx, base, cz, -PI / 2, 3);
      else wallDecal(hz * 2, h, m, cx + hx, base, cz, PI / 2, 3);
      flatDecal(hx * 2, hz * 2, 'setback', cx, top, cz, 0, 2);
      if (rnd() > 0.6) k.glow(cx, top + 4, cz, [1, 0.2, 0.15], 4, undefined, true);
    }
  }

  // =============================================================================================
  // Spawns and objectives
  // =============================================================================================
  const S = (x: number, z: number, yaw: number, y = 0) => spawnAt(x, z, yaw, y);
  const face = (x: number, z: number, tx: number, tz: number, y = 0) => spawnAt(x, z, yawTowards(x, z, tx, tz), y);
  // Team 1: the north building (elevator lobby, the hall, the back room, storage).
  const team1: SpawnPoint[] = [
    S(-26.4, -62.5, PI), S(-22.0, -62.5, PI), S(-24.2, -57.5, PI), S(-26.4, -52.0, PI), S(-22.0, -51.0, PI), S(-24.2, -46.0, PI),
    S(-26.4, -41.0, PI), S(-21.6, -41.5, PI), S(-14.0, -34.2, PI / 2 + 0.4), face(-6.0, -38.2, -0.6, -31.7), S(8.8, -42.5, PI), S(18.0, -34.5, PI / 2),
  ];
  // Team 0: the south building (reception wing, front corridor, offices, back corridor).
  const team0: SpawnPoint[] = [
    S(20.5, 57.6, 0), S(25.5, 57.6, 0), S(23.0, 54.5, 0), S(20.5, 51.5, 0), S(25.5, 51.5, PI / 2), S(14.5, 46.0, 0),
    S(14.0, 35.4, PI / 2), S(21.5, 36.6, PI / 2), S(8.5, 44.0, 0), S(3.0, 44.8, -PI / 2), S(-16.2, 53.9, -PI / 2),
  ];
  const ffa: SpawnPoint[] = [
    face(-19.5, -25.5, 0, 0), face(-2.5, -24.5, 0, 0), face(8.5, -20.0, 0, 0), face(20.5, -19.0, 0, 0), face(20.5, -8.5, 0, 0),
    face(-24.2, -8.5, 0, 0), face(-20.0, 9.5, 0, 0), S(-14.5, -19.5, PI, T), S(-15.0, 8.0, PI, T), face(-1.0, -6.0, 0, 20),
    face(12.0, 8.5, 0, 20), face(20.0, 22.0, 0, 0), face(-1.5, 24.0, 0, 0), face(-19.5, 24.0, 0, 0), S(-24.2, -50.0, PI),
    S(-0.8, 44.6, 0), S(24.0, 56.4, 0), S(16.0, -34.5, PI / 2), S(-13.5, 53.8, -PI / 2),
  ];

  return {
    id: 'highrise',
    name: 'Highrise',
    // The floor of the bounds is 6 m below the roof: fall off an edge and you die before you hit
    // anything (the setback deck drawn at -8 m does not collide).
    bounds: { min: { x: -44, y: -6, z: -68 }, max: { x: 31, y: 40, z: 62 } },
    materials: MATERIALS,
    brushes: k.brushes,
    decals: k.decals,
    props: k.props,
    lights: k.lights,
    spawns: { teams: [team0, team1], ffa },
    objectives: {
      // MWIII letters them A Phonic (north), B centre, C Actibase (south); re-lettered so A is on
      // team 0's side: A in the Actibase office, B in the lane between the Pit and the Helipad, C in
      // the Phonic office hall.
      dom: [
        { id: 'A', x: 3.5, y: 0, z: 45.0, radius: 3 },
        { id: 'B', x: -1.0, y: 0, z: -0.5, radius: 3 },
        { id: 'C', x: -0.4, y: 0, z: -37.2, radius: 3 },
      ],
      // Both bomb sites on the rooftop (MWIII positions): A beside the skip north-east of the helipad,
      // B on the B lane over the underpass, between the two pits.
      sd: [
        { id: 'A', x: 13.8, y: 0, z: -13.6, radius: 2.2, team: 1 },
        { id: 'B', x: -9.8, y: 0, z: -4.6, radius: 2.2, team: 1 },
      ],
      sdBomb: [{ id: 'bomb', x: 23.0, y: 0, z: 56.4, radius: 1, team: 0 }],
      // The remaster's five hardpoints: Substation, Mechanical Room, Propane Tank, Red Pit, Green Shack.
      hq: [
        { id: 'substation', x: 3.2, y: 0, z: -13.0, radius: 3 },
        { id: 'mechanical', x: 8.4, y: 0, z: 0.8, radius: 2.4 },
        { id: 'propane', x: 22.8, y: 0, z: 7.4, radius: 2.6 },
        { id: 'redpit', x: -14.5, y: T, z: 8.5, radius: 2.6 },
        { id: 'greenshack', x: 12.8, y: 0, z: 20.5, radius: 3 },
      ],
    },
    modeSpawns: { sd: { attackers: team0.slice(), defenders: team1.slice() } },
    times: [
      { id: 'haze', name: 'Hazy afternoon', clock: '16:40', sky: 'hr_skyHaze', unlit: [1, 0.95, 0.86], skyRot: PI * 0.3, sunDir: unitVec(-0.62, 0.42, 0.4), sun: [1.15, 0.92, 0.66], amb: [0.5, 0.46, 0.42], fog: [0.76, 0.69, 0.58], fogNear: 45, fogFar: 260, lights: { office: 0.9, tunnel: 1, work: 0.55 }, glow: 0.6 },
      { id: 'day', name: 'Clear day', clock: '12:30', sky: 'term_skyDay', unlit: [1, 1, 1], skyRot: 0, sunDir: unitVec(0.35, 0.85, 0.3), sun: [1.05, 1.0, 0.94], amb: [0.52, 0.56, 0.62], fog: [0.72, 0.79, 0.88], fogNear: 70, fogFar: 380, lights: { office: 0.7, tunnel: 1, work: 0.3 }, glow: 0.3 },
    ],
    defaultTime: 'haze',
    hotspots: [
      { x: 8.0, y: L.deck, z: -1.6 },
      { x: -6.0, y: L.deck, z: -29.9 },
      { x: 6.0, y: L.ledgeS, z: 30.0 },
      { x: 0.0, y: L.southRoof, z: 42.0 },
      { x: -24.5, y: L.elevator, z: -1.0 },
      { x: (jibC0.x + cross.x) / 2, y: L.jibC, z: (jibC0.z + cross.z) / 2 },
      { x: jibA0.x + dirA.x * 8, y: L.jibA, z: jibA0.z + dirA.z * 8 },
      { x: -14.5, y: T, z: -14.0 },
      { x: -14.5, y: T, z: 17.0 },
      { x: -11.5, y: T, z: -5.0 },
      { x: -11.15, y: T, z: -35.0 },
      { x: -10.8, y: T, z: 35.0 },
      { x: 16.0, y: L.shack, z: -23.2 },
      { x: 6.2, y: L.shack, z: 21.0 },
      { x: 20.0, y: 0, z: -34.5 },
      { x: 23.0, y: 0, z: 56.0 },
      { x: 16.0, y: 0, z: 2.0 },
      { x: -24.2, y: 0, z: -55.0 },
    ],
  };
}
