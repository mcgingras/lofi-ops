/**
 * Scrapyard (MW2 "Scrapyard", mp_boneyard): a small aircraft boneyard, rebuilt from the MW2 overhead
 * minimap (see docs/maps/scrapyard-reference.md for the reference, scale and callouts).
 *
 * The yard is a 51 x 80 m rectangle running north-south with a building on each side and scrapped
 * airliner fuselages in the middle:
 *   - north: the Red Warehouse, a two-storey L-shaped office (stairs inside, upstairs offices whose
 *     windows look down the yard; the corner office overlooks Domination A) with a walled front yard;
 *   - south: the Blue Warehouse, a tall open hall with a grated catwalk along its north wall (stairs at
 *     both ends) and windows that duel with the Red Warehouse across the whole map;
 *   - west: Storage, a single-storey white and blue building with four entries (B, S&D A), a low
 *     wall along its front, the Griffin box truck and a white container at its south end;
 *   - east: the Forklift building (big opening onto the centre), the shed and the burning truck,
 *     the engine bay and the gas tanks (S&D B).
 * Centre: an L of long fuselages (blue roof), two more pairs of open-ended tubes and a tail section
 * under a fallen lattice tower, with the helipad and its Sea Knight in the north-west.
 * Three lanes: west (truck, low wall), centre (through the fuselages) and east (shed, burning truck,
 * gas tanks). Team spawns are in the diagonal corners like MW2: team 0 north-west (outside the Red
 * Warehouse), team 1 south (Loading Zone south-east, plus the south-west yard).
 *
 * Coordinates: x east, z south, y up, metres (1 m = 9.5 minimap px); yaw 0 looks north (-z).
 * Search and Destroy: team 1 defends both sites (`objectives.sd[].team = 1`); attackers start by the
 * shed in the north-east (`modeSpawns.sd`).
 */
import { MapKit, spawnAt, yawTowards, type Hole } from './mw2kit';
import { unitVec, type MapData, type MaterialDef, type SpawnPoint } from './types';

const PI = Math.PI;

const MATERIALS: Record<string, MaterialDef> = {
  ground: { texture: 'scrap_ground', uvMul: [1 / 6, 1 / 6] },
  asphalt: { texture: 'scrap_asphalt', uvMul: [1 / 6, 1 / 6] },
  paint: { texture: 'paint', uvMul: [2, 2] },
  floor: { texture: 'scrap_concrete', uvMul: [1 / 4, 1 / 4] },
  wood: { texture: 'nt_floor', uvMul: [1 / 2, 1 / 2], tint: 0xb8a890 },
  office: { texture: 'nt_plaster', uvMul: [1 / 2, 1 / 2], tint: 0xe6e2d8 },
  officeIn: { texture: 'nt_plaster', uvMul: [1 / 2, 1 / 2], tint: 0xc8c4b4 },
  blue: { texture: 'scrap_blueclad', uvMul: [1 / 3, 1 / 3] },
  roof: { texture: 'scrap_hangar', uvMul: [1 / 4, 1 / 4], tint: 0x9a9a9a },
  hangar: { texture: 'scrap_hangar', uvMul: [1 / 4, 1 / 4] },
  concrete: { texture: 'rust_concrete', uvMul: [1 / 3, 1 / 3] },
  grate: { texture: 'scrap_grate', uvMul: [1 / 1.5, 1 / 1.5] },
  stairs: { texture: 'rust_stairs', uvMul: [1 / 1.2, 1 / 1.2], tint: 0xa8b0b8 },
  rail: { texture: 'rust_rail', uvMul: [1 / 1.2, 1], side: 'double', tint: 0x9aa4ae },
  beam: { texture: 'steel', uvMul: [1 / 1.5, 1 / 1.5] },
  fuse: { texture: 'scrap_fuse', uvMul: [1 / 4, 1 / 4] },
  alu: { texture: 'scrap_alu', uvMul: [1 / 2, 1 / 2] },
  blueRoof: { texture: 'scrap_alu', uvMul: [1 / 2, 1 / 2], tint: 0x5a78a8 },
  cabin: { texture: 'scrap_cabin', uvMul: [1 / 2, 1 / 2] },
  carpet: { texture: 'scrap_carpet', uvMul: [1 / 2, 1 / 2] },
  cockpit: { texture: 'scrap_cockpit' },
  junk: { texture: 'scrap_junk', uvMul: [1 / 3, 1 / 3] },
  charred: { texture: 'scrap_junk', uvMul: [1 / 3, 1 / 3], tint: 0x4a4440 },
  wall: { texture: 'scrap_wall', uvMul: [1 / 3, 1 / 4] },
  trailer: { texture: 'scrap_trailer', uvMul: [1 / 6, 1 / 3.8] },
  white: { texture: 'scrap_alu', uvMul: [1 / 2, 1 / 2], tint: 0xe4e2da },
  heli: { texture: 'scrap_alu', uvMul: [1 / 2, 1 / 2], tint: 0x6a7048 },
  engine: { texture: 'scrap_alu', uvMul: [2, 1], tint: 0x8a8e94 },
  tank: { texture: 'scrap_alu', uvMul: [1, 1], tint: 0xe8e6de },
  counter: { texture: 'term_counter', uvMul: [1 / 2, 1 / 2] },
  tower: { texture: 'steel', uvMul: [1, 1], tint: 0xc0503c },
  crane: { texture: 'yellow', uvMul: [1 / 0.8, 1 / 0.8] },
  foliage: { texture: 'fr_foliage', uvMul: [1 / 2, 1 / 2], tint: 0x8a8a6a },
  bark: { texture: 'fr_bark', uvMul: [1 / 1.5, 1 / 1.5] },
  fence: { texture: 'fence', side: 'double' },
  steel: { texture: 'steel' },
  lamp: { texture: 'lamp', emissive: 1 },
  fire: { texture: 'lamp', emissive: 1, tint: 0xff9040 },
  winRow: { texture: 'winRow', emissive: 1 },
  hazard: { texture: 'hazard', uvMul: [1 / 0.6, 1 / 0.6] },
  barrier: { texture: 'barrier', uvMul: [1 / 2, 1 / 1] },
  container0: { texture: 'container0', uvMul: [1 / 6.1, 1 / 2.6] },
  container3: { texture: 'container3', uvMul: [1 / 6.1, 1 / 2.6] },
  crate: { texture: 'crate', uvMul: [1 / 1.2, 1 / 1.2] },
  pallet: { texture: 'pallet' },
  barrelRed: { texture: 'barrel', tint: 0xa8382a, uvMul: [2, 1] },
  barrelBlue: { texture: 'barrel', tint: 0x2f5a8a, uvMul: [2, 1] },
  barrelYellow: { texture: 'barrel', tint: 0xc9a02f, uvMul: [2, 1] },
  rubber: { texture: 'rubber', uvMul: [1 / 0.4, 1 / 0.4] },
  yellow: { texture: 'yellow', uvMul: [1 / 0.8, 1 / 0.8] },
  clip: { texture: 'none' },
};

/** Heights of the walkable upper levels. */
export const SCRAPYARD_LEVELS = {
  /** Red Warehouse upstairs offices. */
  office: 3.4,
  /** Blue Warehouse catwalk. */
  catwalk: 3.6,
  /** Fuselage cabin floors (one step up from the dirt). */
  fuselage: 0.4,
  /** Fuselage roofs (reached by a crate stack and a fallen wing). */
  fuselageRoof: 3.6,
  /** Helipad deck. */
  helipad: 0.35,
} as const;

/** Play-space edges (the yard rectangle; the Red Warehouse reaches further north). */
const W = -25.5;
const E_N = 23.7; // east edge north of the Forklift building's south-east corner
const E_S = 25.5; // east edge south of it
const N = -39.8;
const S = 39.8;

export function buildScrapyard(): MapData {
  const k = new MapKit();
  const { office: up, catwalk, fuselage: fl, fuselageRoof: froof, helipad: pad } = SCRAPYARD_LEVELS;

  // =============================================================================================
  // Ground, perimeter
  // =============================================================================================
  k.slab(-70, -1, -80, 70, 0, 70, 'ground', { hide: ['nx', 'px', 'ny', 'nz', 'pz'] });
  // Asphalt: the east service lane, the helipad apron, the Loading Zone and the north yard.
  k.decals.push({ kind: 'flat', w: 5.2, h: 62, x: 12.6, y: 0.015, z: -6, mat: 'asphalt' });
  k.decals.push({ kind: 'flat', w: 10.9, h: 10.9, x: -16.65, y: 0.015, z: -28.15, mat: 'asphalt' });
  k.decals.push({ kind: 'flat', w: 11.9, h: 11.3, x: 19.55, y: 0.015, z: 34.1, mat: 'asphalt' });
  k.decals.push({ kind: 'flat', w: 30, h: 6.4, x: 4, y: 0.015, z: -36.6, mat: 'asphalt' });
  for (let z = -34; z <= 22; z += 5) k.decals.push({ kind: 'flat', w: 0.2, h: 2.6, x: 12.6, y: 0.025, z, mat: 'paint', seg: 1 });

  // Player clips around the play space (closed; the buildings' walls fill the gaps they straddle).
  const CH = 22;
  k.playerClip(W - 0.4, -1, N - 0.4, W, CH, S + 0.4); // west
  k.playerClip(W - 0.4, -1, S, E_S + 0.4, CH, S + 0.4); // south
  k.playerClip(W - 0.4, -1, N - 0.4, -6.8, CH, N); // north, west of the Red Warehouse
  k.playerClip(16, -1, N - 0.4, E_N + 0.4, CH, N); // north, east of the back alley
  k.playerClip(11.5, -1, -45.5, 16.4, CH, -45.1); // back alley end
  k.playerClip(16, -1, -45.5, 16.4, CH, N); // back alley east side
  k.playerClip(-7.2, -1, -48.3, 12.2, CH, -47.9); // behind the Red Warehouse
  k.playerClip(E_N, -1, N - 0.4, E_N + 0.4, CH, -1.3); // east, north part
  k.playerClip(E_N, -1, -1.3, E_S + 0.4, CH, -0.9); // east step
  k.playerClip(E_S, -1, -1.3, E_S + 0.4, CH, S + 0.4); // east, south part

  // Visible boundary: corrugated walls and chain-link with junk berms beyond.
  k.wall('z', N, -17.3, W - 0.2, 0, 3.2, 0.3, 'wall');
  k.wall('z', 5.7, S, W - 0.2, 0, 3.2, 0.3, 'wall');
  k.fence('x', W, -6.8, N - 0.15, 0, 3, 'fence', 'steel', CH);
  k.fence('x', 16, E_N, N - 0.15, 0, 3, 'fence', 'steel', CH);
  k.fence('x', 11.8, 16, -45.25, 0, 3, 'fence', 'steel', CH);
  k.wall('z', -45.1, N, 16.2, 0, 3.2, 0.3, 'wall');
  k.wall('z', N, -15.2, E_N + 0.2, 0, 3.2, 0.3, 'wall');
  k.wall('z', -0.9, S, E_S + 0.2, 0, 3.2, 0.3, 'wall');
  k.wall('x', W, -8.8, S + 0.2, 0, 3.2, 0.3, 'wall');
  k.wall('x', 13.6, E_S, S + 0.2, 0, 3.2, 0.3, 'wall');
  // Berms and wrecks beyond the boundary (scenery).
  k.ramp(-44, 0, -66, -27, 4.5, 58, '-x', 'ground', { collide: false });
  k.ramp(27, 0, -66, 44, 4.5, 58, '+x', 'ground', { collide: false });
  k.ramp(-27, 0, -66, 27, 4, -50, '-z', 'ground', { collide: false });
  k.ramp(-27, 0, 42, 27, 3.5, 58, '+z', 'ground', { collide: false });
  for (const [x0, z0, x1, z1, h] of [[-34, -40, -29, -31, 2.6], [-36, 8, -30, 16, 2.2], [30, -30, 35, -24, 2.4], [31, 22, 37, 30, 2], [-14, -60, -6, -54, 3.4], [6, 46, 14, 52, 2.6]] as const) k.trim(x0, 0, z0, x1, h, z1, 'junk');
  k.trim(30, 0.6, 2, 52, 4.4, 6.4, 'fuse');
  k.trim(-48, 0.6, -12, -30, 4.4, -7.6, 'fuse');
  k.trim(-46, 4.4, -10.0, -43, 10, -9.6, 'alu');

  // =============================================================================================
  // North: the Red Warehouse (two-storey L-shaped office) and its walled front yard
  // =============================================================================================
  const bx0 = -6.8;
  const bx1 = 11.8;
  const bz0 = -47.9; // back wall
  const bz1 = -39.4; // front wall (main block)
  const wx1 = -2.4; // wing east wall
  const wz1 = -32.7; // wing south wall
  const ft = 0.3; // wall thickness
  const roofY = 6.6;
  // Back room behind the boundary (scenery).
  k.trim(-10.2, 0, bz0, bx0, 3.2, -43.7, 'office');
  k.trim(-10.4, 3.2, bz0 - 0.2, bx0, 3.5, -43.5, 'roof');
  // Ground floor.
  k.decals.push({ kind: 'flat', w: bx1 - bx0 - 0.6, h: bz1 - bz0 - 0.6, x: (bx0 + bx1) / 2, y: 0.02, z: (bz0 + bz1) / 2, mat: 'floor' });
  k.decals.push({ kind: 'flat', w: wx1 - bx0 - 0.6, h: wz1 - bz1, x: (bx0 + wx1) / 2, y: 0.02, z: (bz1 + wz1) / 2, mat: 'floor' });
  const officeWall = (axis: 'x' | 'z', from: number, to: number, at: number, y0: number, y1: number, holes: Hole[], inner: 'px' | 'nx' | 'pz' | 'nz') => {
    const skirt = Math.min(y1, y0 + 1.2);
    if (y0 < 1) k.wall(axis, from, to, at, y0, skirt, ft, 'blue', holes, { faceMats: { [inner]: 'officeIn' } });
    k.wall(axis, from, to, at, y0 < 1 ? skirt : y0, y1, ft, 'office', holes, { faceMats: { [inner]: 'officeIn' } });
  };
  // Back wall, west wall, east wall (door to the back alley), front wall (doors + windows to the yard).
  officeWall('x', bx0, bx1, bz0 + ft / 2, 0, roofY, [[-1, 1, 4.3, 5.4], [5, 7, 4.3, 5.4]], 'pz');
  officeWall('z', bz0, wz1, bx0 + ft / 2, 0, up - 0.2, [[-37, -35.6, 0, 2.2]], 'px');
  officeWall('z', bz0, wz1, bx0 + ft / 2, up - 0.2, roofY, [[-34.8, -33.4, up + 0.9, up + 2.1]], 'px');
  officeWall('z', bz0, bz1, bx1 - ft / 2, 0, up - 0.2, [[-42.6, -41.2, 0, 2.2]], 'nx');
  officeWall('z', bz0, bz1, bx1 - ft / 2, up - 0.2, roofY, [[-40.9, -39.8, up + 0.9, up + 2.1]], 'nx');
  officeWall('x', wx1 - ft, bx1, bz1 + ft / 2, 0, up - 0.2, [[0.5, 2.1, 0, 2.2], [4.4, 6.4, 1.0, 2.1], [8.8, 10.4, 0, 2.2]], 'nz');
  officeWall('x', wx1 - ft, bx1, bz1 + ft / 2, up - 0.2, roofY, [[-1.4, 0.4, up + 0.9, up + 2.1], [1.6, 3.6, up + 0.9, up + 2.1], [4.8, 6.4, up + 0.9, up + 2.1], [7.8, 11.2, up + 0.9, up + 2.1]], 'nz');
  // The wing (stairwell side room): south wall (door + window down the west lane), east wall (door + window onto the yard).
  officeWall('x', bx0, wx1, wz1 - ft / 2, 0, up - 0.2, [[-5.4, -4.0, 0, 2.2]], 'nz');
  officeWall('x', bx0, wx1, wz1 - ft / 2, up - 0.2, roofY, [[-6.0, -3.2, up + 0.9, up + 2.1]], 'nz');
  officeWall('z', bz1, wz1, wx1 - ft / 2, 0, up - 0.2, [[-35, -33.6, 0, 2.2]], 'nx');
  officeWall('z', bz1, wz1, wx1 - ft / 2, up - 0.2, roofY, [[-37.4, -34.2, up + 0.9, up + 2.1]], 'nx');
  // Upper floor slab (stair hole along the back wall, x 3.6..8.6).
  k.slab(bx0, up - 0.2, bz0, 3.6, up, bz1, 'wood', { faceMats: { ny: 'officeIn' } });
  k.slab(3.6, up - 0.2, -46.2, 8.6, up, bz1, 'wood', { faceMats: { ny: 'officeIn' } });
  k.slab(8.6, up - 0.2, bz0, bx1, up, bz1, 'wood', { faceMats: { ny: 'officeIn' } });
  k.slab(bx0, up - 0.2, bz1, wx1, up, wz1, 'wood', { faceMats: { ny: 'officeIn' } });
  // Stairs up along the back wall (rising east), railing round the hole.
  k.ramp(3.6, 0, bz0 + ft, 8.6, up, -46.2, '+x', 'stairs', { tag: 'stairs' });
  k.rail('x', 3.6, 8.2, -46.2, up, 'rail', 'beam');
  // Ground floor: kitchen partition (west room) with a counter, a store-room partition.
  k.wall('z', bz0 + ft, bz1, 0.2, 0, up - 0.2, 0.2, 'officeIn', [[-45.4, -43.8, 0, 2.2], [-41.6, -40.2, 0, 2.2]]);
  k.slab(-6.5, 0, bz0 + ft, -1.4, 0.95, -46.9, 'counter');
  k.slab(-6.5, 0, -46.9, -5.5, 0.95, -44.2, 'counter');
  k.slab(9.6, 0, -45.4, 11.5, 1.8, -44.4, 'crate', { uv: 'raw' });
  // Upstairs: offices. Partition between the open office and the corner office (overlooks A).
  k.wall('z', bz0 + ft, bz1, 0.2, up, roofY, 0.2, 'officeIn', [[-45.4, -43.6, up, up + 2.2]]);
  k.wall('z', -44.4, bz1, 8.0, up, roofY, 0.2, 'officeIn', [[-42.6, -41.0, up, up + 2.2]]);
  k.wall('x', 8.0, bx1 - ft, -44.4, up, roofY, 0.2, 'officeIn', [[9.0, 10.6, up, up + 2.2]]);
  for (const [x0, z0, x1, z1] of [[-5.8, -42.0, -3.4, -41.0], [-1.6, -46.8, 0.0, -44.6], [1.2, -41.4, 3.0, -40.4], [9.0, -41.8, 10.8, -40.8], [-5.8, -36.4, -4.0, -35.2]] as const) k.slab(x0, up, z0, x1, up + 0.78, z1, 'counter');
  // Roof and gable.
  k.slab(bx0 - 0.2, roofY, bz0 - 0.2, bx1 + 0.2, roofY + 0.3, bz1 + 0.2, 'roof');
  k.slab(bx0 - 0.2, roofY, bz1, wx1 + 0.2, roofY + 0.3, wz1 + 0.2, 'roof');
  k.trim(bx0 - 0.4, roofY + 0.3, -45.4, bx1 + 0.4, roofY + 1.2, -41.9, 'roof');
  k.trim(bx0 - 0.4, roofY + 1.2, -44.6, bx1 + 0.4, roofY + 1.7, -42.7, 'roof');
  k.decals.push({ kind: 'wall', w: 5.2, h: 0.8, x: 4.5, y: roofY + 0.4, z: bz1 + 0.21, mat: 'hazard' });
  for (const [x, z] of [[-4, -44], [6, -44], [-4.4, -36], [3, -42]] as const) {
    k.light(x, 2.8, z, [1.4, 1.36, 1.2], 9, 'office');
    k.light(x, up + 2.8, z, [1.4, 1.36, 1.2], 9, 'office');
  }
  // Front yard partitions (concrete walls and barriers) and the alley wall stubs.
  k.slab(wx1, 0, -35.6, 4.5, 1.1, -35.2, 'concrete'); // W1 low wall
  k.slab(4.3, 0, -37.6, 4.7, 1.1, -35.2, 'concrete'); // W2
  k.slab(6.6, 0, bz1, 7.0, 2.4, -36.9, 'concrete'); // W3
  k.slab(11.1, 0, bz1, 11.5, 2.4, -37.6, 'concrete'); // W4
  k.slab(11.0, 0, -35.6, 11.4, 2.4, -33.7, 'concrete'); // W5
  k.slab(7.1, 0, -33.6, 8.8, 0.9, -33.2, 'barrier', { uv: 'raw' });
  k.slab(9.1, 0, -33.4, 11.3, 0.9, -33.0, 'barrier', { uv: 'raw' });
  k.slab(16.2, 0, -37.6, 16.6, 2.0, -35.4, 'concrete');
  k.slab(16.3, 0, -29.3, 16.7, 2.0, -27.4, 'concrete');
  k.slab(13.0, 0, -44.6, 15.6, 1.2, -43.2, 'barrelBlue');

  // =============================================================================================
  // South: the Blue Warehouse (open hall, catwalk along the north wall, stairs at both ends)
  // =============================================================================================
  const sx0 = -8.8;
  const sx1 = 13.6;
  const sz0 = 28.5;
  const sz1 = S;
  const sh = 7.6;
  const st = 0.4;
  k.decals.push({ kind: 'flat', w: sx1 - sx0 - 0.8, h: sz1 - sz0 - 0.8, x: (sx0 + sx1) / 2, y: 0.02, z: (sz0 + sz1) / 2, mat: 'floor' });
  // North wall: the main roll-up door, a man door, catwalk windows facing the Red Warehouse.
  k.wall('x', sx0, sx1, sz0 + st / 2, 0, sh, st, 'blue', [[0, 4.4, 0, 4.2], [9.5, 10.9, 0, 2.2], [-7.4, -4.6, 4.5, 5.7], [-3.2, -1.0, 4.5, 5.7], [5.8, 8.2, 4.5, 5.7], [11.0, 12.8, 4.5, 5.7]], { faceMats: { pz: 'hangar' } });
  k.wall('x', sx0, sx1, sz1 - st / 2, 0, sh, st, 'blue', [], { faceMats: { nz: 'hangar' } });
  // Side doors (under the catwalk ends) onto the south-west yard and the Loading Zone.
  k.wall('z', sz0, sz1, sx0 + st / 2, 0, sh, st, 'blue', [[29.0, 30.4, 0, 2.2], [32, 34, 4.6, 5.6]], { faceMats: { px: 'hangar' } });
  k.wall('z', sz0, sz1, sx1 - st / 2, 0, sh, st, 'blue', [[29.0, 30.4, 0, 2.2], [32, 34, 4.6, 5.6]], { faceMats: { nx: 'hangar' } });
  k.slab(sx0 - 0.3, sh, sz0 - 0.3, sx1 + 0.3, sh + 0.3, sz1 + 0.2, 'roof');
  k.trim(sx0 - 0.4, sh + 0.3, 33.2, sx1 + 0.4, sh + 1.1, 35.2, 'roof');
  k.decals.push({ kind: 'wall', w: 4.4, h: 0.4, x: 2.2, y: 4.3, z: sz0 - 0.01, ry: PI, mat: 'hazard' });
  // Catwalks: along the north wall and down both side walls to the stair tops.
  const cw0 = sz0 + st; // 28.9
  const cw1 = 30.5;
  k.slab(sx0 + st, catwalk - 0.2, cw0, sx1 - st, catwalk, cw1, 'grate');
  k.slab(sx0 + st, catwalk - 0.2, cw1, -7.0, catwalk, 32.6, 'grate');
  k.slab(11.8, catwalk - 0.2, cw1, sx1 - st, catwalk, 32.6, 'grate');
  k.ramp(sx0 + st, 0, 32.6, -7.0, catwalk, sz1 - st - 1.0, '-z', 'stairs', { tag: 'stairs' });
  k.ramp(11.8, 0, 32.6, sx1 - st, catwalk, sz1 - st - 1.0, '-z', 'stairs', { tag: 'stairs' });
  k.rail('x', -7.0, 11.8, cw1, catwalk, 'rail', 'beam');
  k.rail('z', cw1, 32.6, -7.0, catwalk, 'rail', 'beam');
  k.rail('z', cw1, 32.6, 11.8, catwalk, 'rail', 'beam');
  for (const x of [-5, -1, 5, 9]) k.slab(x - 0.12, 0, cw1 - 0.24, x + 0.12, catwalk - 0.2, cw1, 'beam');
  // Hall contents: crate stacks, pallets, a parts rack.
  const hallCrates: [number, number, number][] = [[-4.8, 38.6, 0], [-3.6, 38.6, 0], [-4.2, 38.6, 1.2], [6.2, 38.6, 0], [7.4, 38.6, 0], [2.6, 35.8, 0], [9.6, 35.4, 0]];
  for (const [x, z, y] of hallCrates) k.slab(x - 0.6, y, z - 0.6, x + 0.6, y + 1.2, z + 0.6, 'crate', { uv: 'raw' });
  for (let i = 0; i < 3; i++) k.slab(-1.6, i * 0.15, 37.8, -0.4, (i + 1) * 0.15, 38.8, 'pallet', { uv: 'raw' });
  k.slab(-6.2, 0, 34.6, -5.2, 2.2, 37.4, 'beam');
  for (const [x, z] of [[-3, 34], [4, 34], [10, 34], [2, 30.5]] as const) {
    k.trim(x - 0.4, sh - 1.4, z - 0.4, x + 0.4, sh - 1.2, z + 0.4, 'lamp');
    k.light(x, sh - 1.8, z, [1.7, 1.62, 1.45], 14, 'hangar');
    k.glow(x, sh - 1.5, z, [0.6, 0.58, 0.5], 2.2, 'hangar');
  }
  // Outside: the post by the main door, the south-east annex, porta-johns, Loading Zone clutter.
  k.slab(1.0, 0, 27.4, 2.2, 1.0, 28.4, 'concrete');
  k.slab(13.6, 0, 35.6, 14.7, 2.2, 37.6, 'steel');
  k.slab(18.5, 0, 31.3, 19.8, 2.3, 33.0, 'white');
  k.slab(18.5, 0, 33.2, 19.8, 2.3, 34.9, 'white');
  for (const [x, z, y] of [[23.4, 37.0, 0], [24.6, 37.0, 0], [24.0, 37.0, 1.2], [24.8, 34.0, 0], [24.8, 38.8, 0]] as const) k.slab(x - 0.6, y, z - 0.6, x + 0.6, y + 1.2, z + 0.6, 'crate', { uv: 'raw' });
  for (const [x, z, m] of [[23.2, 39.0, 'barrelRed'], [22.4, 38.9, 'barrelBlue']] as const) k.cyl(0.32, 0.9, 8, m, x, 0.45, z);

  // =============================================================================================
  // West: Storage (single storey, four entries), the low wall, the box truck, the white container
  // =============================================================================================
  const gx0 = W;
  const gx1 = -14.9;
  const gz0 = -17.3;
  const gz1 = 5.7;
  const gh = 4.2;
  const ridge = -20.2;
  k.decals.push({ kind: 'flat', w: gx1 - gx0 - 0.7, h: gz1 - gz0 - 0.7, x: (gx0 + gx1) / 2, y: 0.02, z: (gz0 + gz1) / 2, mat: 'floor' });
  const storeWall = (axis: 'x' | 'z', from: number, to: number, at: number, holes: Hole[], inner: 'px' | 'nx' | 'pz' | 'nz') => {
    k.wall(axis, from, to, at, 0, 1.2, 0.35, 'blue', holes, { faceMats: { [inner]: 'officeIn' } });
    k.wall(axis, from, to, at, 1.2, gh, 0.35, 'office', holes, { faceMats: { [inner]: 'officeIn' } });
  };
  storeWall('z', gz0, gz1, gx0 + 0.175, [], 'px');
  storeWall('z', gz0, gz1, gx1 - 0.175, [[-12.6, -10.8, 0, 2.3], [-6.2, -4.4, 1.0, 2.1], [-2.4, -0.6, 1.0, 2.1], [1.0, 2.6, 0, 2.2]], 'nx');
  storeWall('x', gx0, gx1, gz0 + 0.175, [[-21.0, -19.4, 0, 2.2], [-24.2, -22.6, 1.0, 2.1]], 'pz');
  storeWall('x', gx0, gx1, gz1 - 0.175, [[-19.6, -18.0, 0, 2.2]], 'nz');
  k.slab(gx0 - 0.2, gh, gz0 - 0.2, gx1 + 0.2, gh + 0.3, gz1 + 0.2, 'roof', { faceMats: { ny: 'officeIn' } });
  // Gable roof (scenery) with the upper-floor windows of the loadscreen building.
  k.trim(gx0 - 0.3, gh + 0.3, gz0 - 0.3, gx1 + 0.3, gh + 1.0, gz1 + 0.3, 'office');
  k.trim(gx0 + 1.0, gh + 1.0, gz0 - 0.3, gx1 - 1.0, gh + 1.6, gz1 + 0.3, 'roof');
  k.trim(ridge - 2.0, gh + 1.6, gz0 - 0.3, ridge + 2.0, gh + 2.1, gz1 + 0.3, 'roof');
  for (const z of [-14, -9, -4, 1]) k.decals.push({ kind: 'wall', w: 1.6, h: 0.6, x: gx1 + 0.31, y: gh + 0.35, z, ry: PI / 2, mat: 'winRow', uv: 'raw' });
  // Inside: a partial wall, crate stacks (climbable), shelving.
  k.slab(ridge - 0.15, 0, -10.0, ridge + 0.15, 2.4, -2.0, 'officeIn');
  for (const [x, z, y] of [[-24.2, -15.4, 0], [-23.0, -15.4, 0], [-24.2, -15.4, 0.9], [-17.0, 3.4, 0], [-17.0, 2.2, 0], [-23.6, 3.2, 0]] as const) k.slab(x - 0.6, y, z - 0.6, x + 0.6, y + 0.9, z + 0.6, 'crate', { uv: 'raw' });
  k.slab(-25.1, 0, -9.0, -24.2, 2.0, -3.0, 'beam');
  k.slab(-17.6, 0, -15.6, -16.4, 1.2, -14.4, 'pallet', { uv: 'raw' });
  for (const z of [-11, -1]) k.light(-20.2, gh - 0.5, z, [1.3, 1.25, 1.1], 9, 'office');
  // Outside: the porch, the electrical box, the wall stubs, the low wall along the front.
  k.slab(gx1, 0, -13.1, -13.7, 0.4, -9.4, 'concrete');
  k.slab(gx1, 0, -15.4, -14.0, 1.8, -13.6, 'steel');
  k.slab(gx1, 0, -9.5, -9.4, 2.2, -9.1, 'concrete');
  k.slab(-18.0, 0, -21.3, -17.4, 2.4, -17.3, 'concrete');
  k.slab(-13.3, 0, -6.1, -12.9, 0.9, 17.9, 'concrete');
  k.slab(-12.9, 0, -6.3, -10.9, 0.9, -5.9, 'concrete');
  k.slab(-14.0, 0, 17.9, -12.0, 1.2, 19.0, 'concrete');
  k.slab(-23.4, 0, gz1, -22.2, 1.0, 6.6, 'steel');
  // The white container (and a dumpster) at Storage's south end.
  k.slab(-17.2, 0, 6.2, -15.4, 2.5, 10.8, 'white');
  k.slab(-17.0, 0, 11.0, -15.4, 1.2, 12.8, 'heli');
  // The Griffin box truck (cab north).
  k.slab(-10.5, 0, -0.6, -8.2, 3.6, 4.3, 'trailer');
  k.slab(-10.4, 0, -2.4, -8.3, 2.5, -0.6, 'white');
  k.decals.push({ kind: 'wall', w: 1.9, h: 0.9, x: -9.35, y: 1.3, z: -2.41, ry: PI, mat: 'cockpit', uv: 'raw' });

  // =============================================================================================
  // North-west: the helipad and its Sea Knight (walk-through cabin)
  // =============================================================================================
  k.slab(-21.1, 0, -32.6, -12.4, pad, -23.8, 'concrete');
  k.decals.push({ kind: 'flat', w: 0.6, h: 4, x: -18.2, y: pad + 0.01, z: -26.0, mat: 'paint', seg: 1 });
  k.decals.push({ kind: 'flat', w: 0.6, h: 4, x: -15.4, y: pad + 0.01, z: -26.0, mat: 'paint', seg: 1 });
  k.decals.push({ kind: 'flat', w: 2.8, h: 0.6, x: -16.8, y: pad + 0.01, z: -26.0, mat: 'paint', seg: 1 });
  const hz0 = -30.6;
  const hz1 = -28.2;
  const hx0 = -20.2;
  const hx1 = -13.4;
  const hf = pad + 0.4;
  const hTop = hf + 1.95;
  k.slab(hx0, pad, hz0, hx1, hf, hz1, 'heli');
  k.wall('x', hx0, hx1, hz0 + 0.1, hf, hTop, 0.2, 'heli', [[-17.6, -16.4, hf, hf + 1.8]], { faceMats: { pz: 'cabin' } });
  k.wall('x', hx0, hx1, hz1 - 0.1, hf, hTop, 0.2, 'heli', [[-18.6, -17.4, hf + 0.8, hf + 1.3]], { faceMats: { nz: 'cabin' } });
  k.wall('z', hz0, hz1, hx0 + 0.1, hf, hTop, 0.2, 'heli');
  k.slab(hx0, hTop, hz0, hx1, hTop + 0.25, hz1, 'heli', { faceMats: { ny: 'cabin' } });
  k.decals.push({ kind: 'wall', w: 2.0, h: 0.8, x: hx0 - 0.01, y: hf + 1.0, z: (hz0 + hz1) / 2, ry: -PI / 2, mat: 'cockpit', uv: 'raw' });
  k.ramp(hx1, pad, hz0 + 0.2, hx1 + 1.4, hf, hz1 - 0.2, '-x', 'heli'); // rear ramp
  k.trim(hx0 - 1.2, hTop + 0.25, -29.5, hx0 + 1.4, hTop + 0.9, -29.3, 'heli'); // front pylon
  k.trim(hx1 - 1.6, hTop + 0.25, -29.5, hx1 + 0.4, hTop + 1.4, -29.3, 'heli'); // rear pylon
  for (const [cx, y] of [[hx0 + 0.6, hTop + 0.95], [hx1 - 0.6, hTop + 1.45]] as const) {
    k.trim(cx - 4.5, y, -29.48, cx + 4.5, y + 0.06, -29.32, 'steel');
    k.trim(cx - 0.08, y, -33.9, cx + 0.08, y + 0.06, -24.9, 'steel');
  }

  // =============================================================================================
  // Centre: the fuselages
  // =============================================================================================
  /**
   * A scrapped airliner fuselage section as boxes: cabin floor one step up, side walls with doors
   * and windows, a walkable roof. `axis` is the long axis; `lo`/`hi` close that end (with holes).
   */
  const tube = (x0: number, z0: number, x1: number, z1: number, axis: 'x' | 'z', o: { holesA?: Hole[]; holesB?: Hole[]; lo?: Hole[] | null; hi?: Hole[] | null; roof?: string } = {}) => {
    const t = 0.3;
    const top = froof - 0.9; // side walls; a stepped shoulder and the roof above round the profile off
    const sh = 0.25; // shoulder inset
    const rm = o.roof ?? 'alu';
    k.slab(x0, 0, z0, x1, fl, z1, 'alu', { faceMats: { py: 'carpet' } });
    if (axis === 'z') {
      k.wall('z', z0, z1, x0 + t / 2, fl, top, t, 'fuse', o.holesA ?? [], { faceMats: { px: 'cabin' } });
      k.wall('z', z0, z1, x1 - t / 2, fl, top, t, 'fuse', o.holesB ?? [], { faceMats: { nx: 'cabin' } });
      if (o.lo) k.wall('x', x0 + t, x1 - t, z0 + t / 2, fl, froof - 0.3, t, 'alu', o.lo, { faceMats: { pz: 'cabin' } });
      if (o.hi) k.wall('x', x0 + t, x1 - t, z1 - t / 2, fl, froof - 0.3, t, 'alu', o.hi, { faceMats: { nz: 'cabin' } });
      k.slab(x0 + sh, top, z0, x0 + sh + 0.35, froof - 0.3, z1, rm, { faceMats: { px: 'cabin', ny: 'cabin' } });
      k.slab(x1 - sh - 0.35, top, z0, x1 - sh, froof - 0.3, z1, rm, { faceMats: { nx: 'cabin', ny: 'cabin' } });
      k.slab(x0 + sh, froof - 0.3, z0, x1 - sh, froof, z1, rm, { faceMats: { ny: 'cabin' } });
      k.trim(x0 + 0.8, froof, z0 + 0.2, x1 - 0.8, froof + 0.2, z1 - 0.2, rm);
      k.trim(x0 - 0.12, 0.25, z0 + 0.1, x0, top - 0.3, z1 - 0.1, 'alu');
      k.trim(x1, 0.25, z0 + 0.1, x1 + 0.12, top - 0.3, z1 - 0.1, 'alu');
    } else {
      k.wall('x', x0, x1, z0 + t / 2, fl, top, t, 'fuse', o.holesA ?? [], { faceMats: { pz: 'cabin' } });
      k.wall('x', x0, x1, z1 - t / 2, fl, top, t, 'fuse', o.holesB ?? [], { faceMats: { nz: 'cabin' } });
      if (o.lo) k.wall('z', z0 + t, z1 - t, x0 + t / 2, fl, froof - 0.3, t, 'alu', o.lo, { faceMats: { px: 'cabin' } });
      if (o.hi) k.wall('z', z0 + t, z1 - t, x1 - t / 2, fl, froof - 0.3, t, 'alu', o.hi, { faceMats: { nx: 'cabin' } });
      k.slab(x0, top, z0 + sh, x1, froof - 0.3, z0 + sh + 0.35, rm, { faceMats: { pz: 'cabin', ny: 'cabin' } });
      k.slab(x0, top, z1 - sh - 0.35, x1, froof - 0.3, z1 - sh, rm, { faceMats: { nz: 'cabin', ny: 'cabin' } });
      k.slab(x0, froof - 0.3, z0 + sh, x1, froof, z1 - sh, rm, { faceMats: { ny: 'cabin' } });
      k.trim(x0 + 0.2, froof, z0 + 0.8, x1 - 0.2, froof + 0.2, z1 - 0.8, rm);
      k.trim(x0 + 0.1, 0.25, z0 - 0.12, x1 - 0.1, top - 0.3, z0, 'alu');
      k.trim(x0 + 0.1, 0.25, z1, x1 - 0.1, top - 0.3, z1 + 0.12, 'alu');
    }
    // Shoulder tops (the step between wall and roof), so the walls do not end in a bare ledge.
    if (axis === 'z') {
      k.trim(x0, top, z0, x0 + sh, top + 0.08, z1, 'alu');
      k.trim(x1 - sh, top, z0, x1, top + 0.08, z1, 'alu');
    } else {
      k.trim(x0, top, z0, x1, top + 0.08, z0 + sh, 'alu');
      k.trim(x0, top, z1 - sh, x1, top + 0.08, z1, 'alu');
    }
  };
  const win = (from: number, n: number, step: number): Hole[] => Array.from({ length: n }, (_, i) => [from + i * step, from + i * step + 0.45, 1.5, 1.95] as Hole);
  const door: (a: number) => Hole = (a) => [a, a + 1.3, fl, fl + 2.1];
  // The long blue-roofed fuselage (north-south) and its cross piece (east-west) forming an L.
  tube(-6.2, -4.6, -1.7, 17.7, 'z', { holesA: [door(2.0), ...win(5, 3, 2.4), door(13.2)], holesB: [...win(-3, 2, 2.4), [9.6, 12.0, fl, fl + 2.3], ...win(14, 2, 1.6)], roof: 'blueRoof' });
  tube(-6.2, -8.7, 4.8, -4.6, 'x', { holesA: [...win(-4.5, 2, 2.4), door(0.6)], holesB: [[-5.9, -2.0, fl, froof - 0.9], ...win(0.5, 3, 1.4)], lo: null, hi: null });
  // North-centre: the tube under the fallen tower (open both ends), and the closed tail section.
  tube(5.5, -27.2, 9.6, -15.4, 'z', { holesA: win(-25, 3, 2.6), holesB: [...win(-26, 2, 2.4), door(-21.0), ...win(-18.2, 1, 1)] });
  tube(-4.4, -26.7, 0.0, -17.7, 'z', { holesA: [door(-21.4), ...win(-25.2, 2, 2.2)], holesB: win(-24.8, 3, 2.2), lo: [] });
  k.trim(-2.35, froof, -26.7, -2.05, froof + 4.2, -23.6, 'alu'); // tail fin
  k.trim(-4.9, froof - 0.2, -26.4, 0.5, froof, -25.4, 'alu'); // stabiliser
  // East-centre: the "818" pair (open ends, doors), the wing ramp up onto the roofs.
  tube(5.2, -3.3, 9.4, 7.7, 'z', { holesA: [[1.0, 3.0, fl, fl + 2.3], ...win(4.2, 2, 1.6)], holesB: win(-2, 3, 2.4) });
  tube(5.8, 7.9, 9.9, 19.3, 'z', { holesA: win(9.2, 4, 2.4), holesB: [...win(9, 1, 1), door(12.0), ...win(15, 2, 2)] });
  k.ramp(9.4, 0, 2.0, 11.2, froof, 7.6, '-z', 'alu', { faceMats: { ny: 'alu' } }); // fallen wing onto the 818 roof
  // Crate stack up onto the long fuselage roof (west side, south end).
  k.slab(-7.4, 0, 12.0, -6.2, 0.9, 13.2, 'crate', { uv: 'raw' });
  k.slab(-7.4, 0, 13.2, -6.2, 1.8, 14.4, 'crate', { uv: 'raw' });
  k.slab(-7.4, 0, 14.4, -6.2, 2.7, 15.6, 'crate', { uv: 'raw' });
  // Broken wing panel lying beside the long fuselage, debris, the baggage tug.
  k.ramp(-0.8, 0, -3.0, 2.1, 1.0, 5.1, '-x', 'alu');
  k.slab(3.3, 0, -19.2, 4.8, 0.5, -18.8, 'steel');
  k.slab(9.6, 0, -10.5, 11.2, 1.3, -6.9, 'yellow');
  k.slab(-3.2, 0, 21.7, 1.0, 1.5, 23.9, 'heli');
  for (const [x, z] of [[-4, 0], [-4, 10], [7.4, 2], [7.6, 13], [7.6, -21], [-2.2, -22]] as const) k.light(x, froof - 0.6, z, [0.9, 0.85, 0.7], 6, 'cabin');
  // The fallen lattice tower (red and white) from the helipad over the tail section onto the north tube.
  const lattice = (ax: number, az: number, bx: number, bz: number, y0: number, y1: number, segs: number, mat: string, w: number) => {
    const ry = Math.atan2(bx - ax, bz - az);
    const len = Math.hypot(bx - ax, bz - az) / segs;
    for (let i = 0; i < segs; i++) {
      const f = (i + 0.5) / segs;
      const cx = ax + (bx - ax) * f;
      const cz = az + (bz - az) * f;
      const y = y0 + (y1 - y0) * f;
      // Four chords (thin beams along the boom) and a rung, as visually rotated trims. The renderer
      // swaps x/z extents for |sin ry| > 0.5 (box() convention), so hand it the swapped box.
      const swap = Math.abs(Math.sin(ry)) > 0.5;
      const beam = (bx: number, by: number, bz: number, along: number, across: number, h: number, yaw: number) => {
        const [ex, ez] = swap ? [along / 2, across / 2] : [across / 2, along / 2];
        k.add({ min: { x: bx - ex, y: by - h / 2, z: bz - ez }, max: { x: bx + ex, y: by + h / 2, z: bz + ez }, mat, ry: yaw, collide: false });
      };
      const px = Math.cos(ry) * (w / 2);
      const pz = -Math.sin(ry) * (w / 2);
      for (const sd of [-1, 1]) for (const up of [-1, 1]) beam(cx + sd * px, y + up * (w / 2), cz + sd * pz, len, 0.12, 0.12, ry);
      for (const up of [-1, 1]) beam(cx, y + up * (w / 2), cz, 0.1, w, 0.1, ry);
      for (const sd of [-1, 1]) beam(cx + sd * px, y, cz + sd * pz, 0.1, 0.1, w, ry);
    }
  };
  lattice(-12.0, -26.6, -3.2, -24.4, 0.6, froof + 0.6, 6, 'tower', 0.9);
  lattice(-3.2, -24.4, 9.5, -21.5, froof + 0.6, froof + 0.7, 8, 'tower', 0.9);
  // The crane outside the south wall, its boom reaching over the Blue Warehouse to the fuselages.
  k.trim(-3, 0, 47, -1.6, 22, 48.4, 'crane');
  lattice(-2.3, 47.7, 7.6, 15.4, 22, 17, 14, 'crane', 1.2);
  k.trim(7.5, 9, 15.3, 7.7, 17, 15.5, 'steel');
  // The tree in the middle (no collision, like MW2's).
  k.trim(-1.2, 0, -13.7, -0.8, 3.2, -13.3, 'bark');
  k.trim(-3.0, 2.6, -15.5, 1.0, 5.4, -11.5, 'foliage');
  k.trim(-2.2, 5.4, -14.7, 0.2, 6.6, -12.3, 'foliage');

  // =============================================================================================
  // East: the shed, the Forklift building, the burning truck, the engine bay, the gas tanks
  // =============================================================================================
  // Shed (north-east): doors west and south, barrels inside.
  const shx0 = 16.5;
  const shx1 = 22.3;
  const shz0 = -27.2;
  const shz1 = -20.2;
  k.wall('z', shz0, shz1, shx0 + 0.15, 0, 3.0, 0.3, 'wall', [[-24.6, -23.0, 0, 2.2]]);
  k.wall('z', shz0, shz1, shx1 - 0.15, 0, 3.0, 0.3, 'wall');
  k.wall('x', shx0, shx1, shz0 + 0.15, 0, 3.0, 0.3, 'wall', [[19.4, 20.6, 1.1, 1.8]]);
  k.wall('x', shx0, shx1, shz1 - 0.15, 0, 3.0, 0.3, 'wall', [[18.8, 20.4, 0, 2.2]]);
  k.slab(shx0 - 0.2, 3.0, shz0 - 0.2, shx1 + 0.2, 3.2, shz1 + 0.2, 'roof');
  for (const [x, z, m] of [[21.4, -26.3, 'barrelRed'], [21.4, -25.5, 'barrelBlue'], [21.4, -22.2, 'barrelYellow'], [20.6, -21.2, 'barrelRed']] as const) k.cyl(0.32, 0.9, 8, m, x, 0.45, z);
  k.light(19.4, 2.6, -23.7, [1.2, 1.1, 0.9], 6, 'office');
  k.slab(22.3, 0, -16.9, 23.5, 1.2, -16.1, 'steel'); // AC unit
  // Forklift building: big roll-up opening onto the centre, doors north and south.
  const ex0 = 15.1;
  const ex1 = E_N;
  const ez0 = -15.2;
  const ez1 = -0.9;
  const eh = 4.6;
  k.decals.push({ kind: 'flat', w: ex1 - ex0 - 0.7, h: ez1 - ez0 - 0.7, x: (ex0 + ex1) / 2, y: 0.02, z: (ez0 + ez1) / 2, mat: 'floor' });
  const forkWall = (axis: 'x' | 'z', from: number, to: number, at: number, holes: Hole[], inner: 'px' | 'nx' | 'pz' | 'nz') => {
    k.wall(axis, from, to, at, 0, 1.2, 0.35, 'blue', holes, { faceMats: { [inner]: 'blue' } });
    k.wall(axis, from, to, at, 1.2, eh, 0.35, 'office', holes, { faceMats: { [inner]: 'blue' } });
  };
  forkWall('z', ez0, ez1, ex0 + 0.175, [[-11.2, -5.2, 0, 3.8]], 'px');
  forkWall('z', ez0, ez1, ex1 - 0.175, [], 'nx');
  forkWall('x', ex0, ex1, ez0 + 0.175, [[17.4, 19.0, 0, 2.2]], 'pz');
  forkWall('x', ex0, ex1, ez1 - 0.175, [[20.0, 21.6, 0, 2.2], [16.6, 18.4, 1.0, 2.1]], 'nz');
  k.slab(ex0 - 0.2, eh, ez0 - 0.2, ex1 + 0.2, eh + 0.3, ez1 + 0.2, 'roof');
  k.decals.push({ kind: 'wall', w: 6.0, h: 0.4, x: ex0 - 0.01, y: 3.85, z: -8.2, ry: -PI / 2, mat: 'hazard' });
  k.slab(17.1, 0, -15.9, 19.3, 0.3, ez0, 'concrete'); // north door step
  // Forklift (body, mast, forks) and climbable crate stacks.
  k.slab(18.4, 0, -9.0, 19.8, 1.3, -6.6, 'yellow');
  k.trim(18.5, 1.3, -8.4, 19.7, 2.1, -7.2, 'steel');
  k.slab(18.45, 0, -9.7, 19.75, 2.6, -9.5, 'steel');
  k.slab(18.6, 0.1, -11.0, 19.6, 0.2, -9.7, 'steel');
  for (const [x, z, y] of [[22.4, -13.8, 0], [22.4, -12.6, 0], [22.4, -13.2, 1.2], [21.0, -3.0, 0], [22.2, -3.0, 0], [22.2, -4.2, 0], [21.6, -3.6, 1.2]] as const) k.slab(x - 0.6, y, z - 0.6, x + 0.6, y + 1.2, z + 0.6, 'crate', { uv: 'raw' });
  k.slab(23.0, 0, -11.0, ex1 - 0.35, 2.4, -5.0, 'beam');
  for (const z of [-11, -5]) k.light(19.4, eh - 0.5, z, [1.4, 1.3, 1.1], 9, 'office');
  // The burning truck (cab north) by Domination C.
  k.slab(14.6, 0, 6.8, 17.0, 2.6, 8.5, 'charred');
  k.slab(14.5, 0, 8.6, 17.1, 3.0, 13.8, 'charred');
  k.glow(15.8, 3.4, 10.8, [1.0, 0.55, 0.2], 4.5, undefined);
  k.glow(15.6, 2.4, 7.6, [1.0, 0.5, 0.15], 3, undefined);
  k.light(15.8, 3.6, 10.8, [1.8, 0.9, 0.35], 10, 'fire');
  k.trim(15.2, 3.0, 9.4, 16.4, 3.5, 12.4, 'fire');
  // Engine bay: low walls round two big turbofans, open to the west.
  k.slab(19.4, 0, 6.5, E_S, 1.2, 6.8, 'concrete');
  k.slab(19.4, 0, 13.6, E_S, 1.2, 13.9, 'concrete');
  k.cyl(1.2, 5.4, 12, 'engine', 21.4, 1.3, 10.2, 'z');
  k.cyl(1.2, 5.4, 12, 'engine', 23.9, 1.3, 10.2, 'z');
  // Gas tanks (S&D B) on their pad behind hazard barriers.
  k.slab(15.9, 0, 22.5, 23.1, 0.2, 26.6, 'concrete');
  k.cyl(1.45, 3.2, 12, 'tank', 18.2, 1.8, 24.5);
  k.cyl(1.45, 3.2, 12, 'tank', 20.9, 1.8, 24.5);
  k.slab(15.9, 0.2, 22.0, 17.6, 1.1, 22.3, 'barrier', { uv: 'raw' });
  k.slab(19.0, 0.2, 22.0, 23.1, 1.1, 22.3, 'barrier', { uv: 'raw' });
  k.trim(15.9, 1.1, 22.0, 23.1, 1.18, 22.3, 'hazard');

  // =============================================================================================
  // South-west yard
  // =============================================================================================
  k.slab(-21.9, 0, 23.9, -15.5, 2.6, 26.1, 'container0', { ry: 0 });
  k.slab(-13.1, 0, 38.6, -11.1, 1.0, 39.7, 'crate', { uv: 'raw' });
  for (let i = 0; i < 4; i++) k.slab(-10.9, i * 0.15, 37.4, -8.9, (i + 1) * 0.15, 39.4, 'pallet', { uv: 'raw' });
  for (const [x, z, m] of [[-24.4, 21.0, 'barrelYellow'], [-24.4, 21.8, 'barrelRed'], [-12.0, -14.4, 'barrelBlue']] as const) k.cyl(0.32, 0.9, 8, m, x, 0.45, z);

  // ----- lamps -----
  for (const [x, z, dx, dz] of [[-11.0, -31.5, 0.9, 0], [12.0, -19.0, -0.9, 0], [-11.5, 21.0, 0.9, 0], [12.0, 21.0, -0.9, 0], [-24.6, -20.0, 0.9, 0], [24.8, 18.0, -0.9, 0]] as const) k.lampPole(x, z, 7, dx, dz, 'steel', 'lamp', [1.6, 1.2, 0.75], 16);

  // =============================================================================================
  // Spawns, objectives
  // =============================================================================================
  const face = (x: number, z: number, tx = 0, tz = 0, y = 0) => spawnAt(x, z, yawTowards(x, z, tx, tz), y);
  // Team 0 (OpFor in MW2): outside the Red Warehouse in the north-west.
  const team0: SpawnPoint[] = [face(-23.5, -38, 0, -10), face(-20, -38, 0, -10), face(-16.5, -38, 0, -10), face(-13, -38, 0, -10), face(-9.5, -38, 0, -10), face(-23.5, -35, 0, -10), face(-20, -35.2, 0, -10), face(-16.5, -35.2, 0, -10), face(-13, -35.2, 0, -10), face(-9.5, -35, 0, -10), face(-24, -28, -10, 0), face(-9.5, -29, 0, -10)];
  // Team 1 (Task Force 141): the Loading Zone (south-east) and the south-west yard.
  const team1: SpawnPoint[] = [face(16.5, 29.5, 8, 0), face(20, 29.5, 8, 0), face(23.5, 29.5, 8, 0), face(16.5, 33, 8, 0), face(22, 33, 8, 0), face(17, 37.5, 12, 20), face(21, 36.5, 12, 20), face(-23.5, 30, -8, 0), face(-19.5, 30, -8, 0), face(-15.5, 30, -8, 0), face(-11.5, 30, -8, 0), face(-23.5, 35, -14, 20), face(-19.5, 35, -14, 20), face(-15.5, 35, -14, 20)];
  const ffa: SpawnPoint[] = [face(-22, -20), face(-8, -20), face(2.5, -31), face(13.5, -24), face(21, -31), face(12.5, -12), face(-11, -12), face(3.6, 0), face(12.5, 4), face(-10.5, 10), face(2.5, 12), face(12, 20), face(-6, 25.5), face(6, 25), face(-20, 15), face(24, 18, 0, 10), face(-18, -10), face(19.5, -12, 0, -5), face(1.0, 34.0, 2.5, 20), face(5, -42.5, 5, -30, up)];
  const sdAttack: SpawnPoint[] = [face(13.5, -38.2, 0, 0), face(18.5, -38.2, 0, 0), face(22, -38.2, 0, 0), face(13.5, -35, 0, 0), face(19, -35, 0, 0), face(22.5, -33, 0, 0), face(14, -31, 0, 0), face(19, -31, 0, 0)];
  const sdDefend: SpawnPoint[] = [face(-5.5, 33, 2, 20), face(-2, 33, 2, 20), face(1.5, 33, 2, 20), face(5, 33, 2, 20), face(8.5, 33, 2, 20), face(-3.5, 36.5, 2, 20), face(0, 36.5, 2, 20), face(5, 36.5, 2, 20), face(9.5, 37.5, 2, 20)];

  return {
    id: 'scrapyard',
    name: 'Scrapyard',
    bounds: { min: { x: -27, y: -2, z: -49.5 }, max: { x: 27, y: 30, z: 41.5 } },
    materials: MATERIALS,
    brushes: k.brushes,
    decals: k.decals,
    props: k.props,
    lights: k.lights,
    spawns: { teams: [team0, team1], ffa },
    modeSpawns: { sd: { attackers: sdAttack, defenders: sdDefend } },
    objectives: {
      dom: [
        { id: 'A', x: 13.5, y: 0, z: -32.5, radius: 3 },
        { id: 'B', x: -18.5, y: 0, z: -5, radius: 2.6 },
        { id: 'C', x: 18.5, y: 0, z: 3, radius: 3 },
      ],
      sd: [
        { id: 'A', x: -19.5, y: 0, z: 1.5, radius: 2.2, team: 1 },
        { id: 'B', x: 19.5, y: 0, z: 19.5, radius: 2.2, team: 1 },
      ],
      sdBomb: [{ id: 'bomb', x: 18.5, y: 0, z: -36.5, radius: 1, team: 0 }],
      hq: [
        { id: 'storage', x: -22.5, y: 0, z: -11, radius: 2.6 },
        { id: 'fuselages', x: 2.0, y: 0, z: -12.5, radius: 3 },
        { id: 'redwarehouse', x: 5.5, y: 0, z: -42, radius: 2.6 },
        { id: 'bluewarehouse', x: 2.4, y: 0, z: 34, radius: 3 },
        { id: 'forklift', x: 18.5, y: 0, z: -12.5, radius: 2.6 },
      ],
    },
    times: [
      { id: 'overcast', name: 'Overcast', clock: '15:20', sky: 'skyGrey', unlit: [1, 1, 1], skyRot: 0, sunDir: unitVec(0.35, 0.85, 0.4), sun: [0.52, 0.52, 0.5], amb: [0.58, 0.6, 0.64], fog: [0.66, 0.68, 0.71], fogNear: 30, fogFar: 140, lights: { hangar: 0.9, cabin: 0.5, office: 0.7, fire: 1 }, glow: 0.3 },
      { id: 'dusk', name: 'Dusk', clock: '19:10', sky: 'skyDusk', unlit: [1, 0.86, 0.76], skyRot: PI / 2, sunDir: unitVec(-0.85, 0.42, 0.1), sun: [1.1, 0.64, 0.4], amb: [0.3, 0.25, 0.36], fog: [0.8, 0.5, 0.42], fogNear: 24, fogFar: 110, lights: { lamp: 0.6, hangar: 1, cabin: 0.8, office: 0.9, fire: 1 }, glow: 0.6 },
      { id: 'night', name: 'Night', clock: '23:50', sky: 'skyNight', unlit: [0.55, 0.6, 0.8], skyRot: PI, sunDir: unitVec(0.15, 0.75, -0.6), sun: [0.13, 0.16, 0.28], amb: [0.13, 0.14, 0.22], fog: [0.08, 0.09, 0.17], fogNear: 10, fogFar: 70, lights: { lamp: 1, hangar: 1, cabin: 1, office: 1, fire: 1 }, glow: 1 },
    ],
    defaultTime: 'overcast',
    hotspots: [
      { x: 2.0, y: up, z: -43.0 }, // Red Warehouse upstairs
      { x: 10.2, y: up, z: -43.2 }, // corner office
      { x: 2.0, y: catwalk, z: 29.7 }, // Blue Warehouse catwalk
      { x: -4.0, y: fl, z: 6.0 }, // long fuselage cabin
      { x: 7.6, y: fl, z: -21.0 }, // north tube
      { x: 7.3, y: froof, z: 1.0 }, // fuselage roofs
      { x: -16.8, y: hf, z: -29.4 }, // Sea Knight cabin
      { x: -17.5, y: 0, z: -8.0 }, // Storage
      { x: 19.0, y: 0, z: -12.5 }, // Forklift
      { x: 19.5, y: 0, z: -24.0 }, // shed
      { x: 18.5, y: 0, z: 3.0 }, // burning truck
      { x: 19.5, y: 0, z: 19.0 }, // gas tanks
      { x: 3.0, y: 0, z: -37.5 }, // front yard
      { x: -18.0, y: 0, z: 18.0 }, // south-west yard
    ],
  };
}
