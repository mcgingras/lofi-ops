/**
 * Firing Range (recreation of Black Ops 1's Firing Range, the Cuban training range; owner: maps-bo).
 * A jungle clearing of red dirt. The firing lanes run east from the shooting booths to the target
 * berm, with pop-up targets on wooden frames at three distances. North of the lanes stands the
 * two-storey range cabin (stairs inside and out); a catwalk runs from its upper balcony to the
 * north-east guard tower. South-east, a trench line leads into a concrete bunker with firing slits
 * over the lanes. A second guard tower watches the south-west, a tin storage shed the north-west.
 * Tree line and jungle all round.
 *
 * Layout (metres, +x east, +z south, yaw 0 faces north/-z):
 *   x = -46 .. -36   west spawn (team 0, S&D attackers)
 *   x = -10.5 .. -4.5  shooting booths, z = -11 .. 11 (counters at x = -5)
 *   x = -4.5 .. 30    the firing lanes (Domination B at x = 0.5, mid-range), z = -9 .. 9, targets at x = 4, 12, 20
 *   x = 30.5 .. 33.5  target berm, z = -12 .. 12 (log face both sides)
 *   x = 36 .. 46      east spawn (team 1, S&D defenders)
 *   cabin            x = -4 .. 6, z = -30 .. -21, upper floor 3.2 m; balcony + catwalk east to the
 *                    NE tower (x = 22 .. 26, z = -31 .. -27, platform 3.2 m)
 *   trench           floor -1.0, x = 2 .. 26, z = 19.5 .. 22 (ramps west, north and via the bunker east)
 *   bunker           x = 26 .. 34, z = 16.5 .. 25, slits facing north over the lanes
 *   SW tower         x = -32 .. -28, z = 26 .. 30, platform 4.0 m
 *   shed             x = -36 .. -30, z = -20 .. -14
 */
import { MapKit, yawTo } from './bo-kit';
import { unitVec, type MapData, type MaterialDef, type ObjectivePoint, type SpawnPoint } from './types';

const PI = Math.PI;
const F2 = 3.2;
const TR = -1.0;

export const FIRING_RANGE_BOUNDS = { min: { x: -46.5, y: -3, z: -38.5 }, max: { x: 46.5, y: 26, z: 38.5 } };

const MATERIALS: Record<string, MaterialDef> = {
  dirt: { texture: 'fr_dirt', uvMul: [1 / 5, 1 / 5] },
  mud: { texture: 'fr_dirt', tint: 0x9a8a78, uvMul: [1 / 3, 1 / 3] },
  grass: { texture: 'fr_grass', uvMul: [1 / 4, 1 / 4] },
  jungle: { texture: 'fr_jungle', uvMul: [1 / 4, 1 / 4] },
  planks: { texture: 'bo_planks', uvMul: [1 / 2.4, 1 / 2.4] },
  planksDark: { texture: 'bo_planks', tint: 0x9a8a7a, uvMul: [1 / 2.4, 1 / 2.4] },
  wood: { texture: 'bo_wood', uvMul: [1 / 1.2, 1 / 1.2] },
  tin: { texture: 'fr_tin', uvMul: [1 / 2.6, 1 / 2.6] },
  logs: { texture: 'fr_logs', uvMul: [1 / 2, 1 / 1.2] },
  sandbag: { texture: 'bo_sandbag', uvMul: [1 / 1.6, 1 / 0.9] },
  concrete: { texture: 'bo_concrete', uvMul: [1 / 3, 1 / 3] },
  target: { texture: 'fr_target' },
  foliage: { texture: 'fr_foliage', uvMul: [1 / 3, 1 / 3] },
  foliageDark: { texture: 'fr_foliage', tint: 0x7a8a6a, uvMul: [1 / 4, 1 / 4] },
  bush: { texture: 'fr_bush', side: 'double' },
  bark: { texture: 'fr_bark', uvMul: [1, 1 / 2] },
  lane1: { texture: 'fr_lane1' },
  lane2: { texture: 'fr_lane2' },
  lane3: { texture: 'fr_lane3' },
  lane4: { texture: 'fr_lane4' },
  sign: { texture: 'fr_sign', emissive: 0.2 },
  chain: { texture: 'fence', side: 'double' },
  steel: { texture: 'steel' },
  rubber: { texture: 'rubber', uvMul: [1 / 0.4, 1 / 0.4] },
  crate: { texture: 'crate', uvMul: [1 / 1.2, 1 / 1.2] },
  barrelRed: { texture: 'barrel', tint: 0xa8382a, uvMul: [2, 1] },
  barrelGreen: { texture: 'barrel', tint: 0x5a6a3a, uvMul: [2, 1] },
  jeep: { texture: 'bo_carpaint', tint: 0x6a7048 },
  glass: { texture: 'bo_glass' },
  hills: { texture: 'fr_hills', side: 'double', fog: false, tint: 0xb8c4b0 },
  hillsFar: { texture: 'fr_hills', side: 'double', fog: false, tint: 0xa8b8c0 },
  lamp: { texture: 'lamp', emissive: 1 },
  clip: { texture: 'none' },
};

/** A tree: trunk (collides inside the playable area) and a canopy of stacked foliage boxes. */
function tree(k: MapKit, x: number, z: number, h: number, r: number, collide = true) {
  k.cyl(r * 0.18, h, 7, 'bark', x, h / 2, z, { collide });
  k.box(r * 2, h * 0.28, r * 2, 'foliage', x, h * 0.62, z, { collide: false });
  k.box(r * 1.4, h * 0.22, r * 1.4, 'foliage', x + r * 0.2, h * 0.86, z - r * 0.15, { collide: false });
}

/** Undergrowth: two crossed alpha cards (render only). */
function bush(k: MapKit, x: number, z: number, s: number) {
  k.wallDecal(s * 1.6, s, 'bush', x, 0, z, 0.4, { uv: 'raw' });
  k.wallDecal(s * 1.6, s, 'bush', x, 0, z, 0.4 + PI / 2, { uv: 'raw' });
}

/** A run of sandbags (solid cover). */
function sandbags(k: MapKit, x0: number, z0: number, x1: number, z1: number, h = 1.0) {
  k.aabb(x0, 0, z0, x1, h, z1, 'sandbag');
}

function lanes(k: MapKit) {
  // Lane ground: packed dirt strips with grass between, range markers.
  k.flatDecal(34, 18, 'mud', 13, 0.015, 0);
  for (const z of [-4.5, 0, 4.5]) k.flatDecal(34, 0.25, 'grass', 13, 0.02, z, { seg: 1 });

  // Shooting booths: roof on posts, partitions, counters (crouch cover), a back rail.
  k.aabb(-10.6, 2.6, -11.4, -4.4, 2.8, 11.4, 'tin', { faceMats: { ny: 'planksDark' } });
  for (const z of [-11, -4.5, 0, 4.5, 11]) {
    k.box(0.2, 2.6, 0.2, 'wood', -10.2, 0, z);
    k.box(0.2, 2.6, 0.2, 'wood', -5.7, 0, z);
  }
  for (const z of [-11, -4.5, 0, 4.5, 11]) k.aabb(-10, 0, z - 0.05, -5.6, 2.6, z + 0.05, 'planks');
  for (let i = 0; i < 4; i++) {
    const zc = -6.75 + i * 4.5;
    k.aabb(-5.6, 0, zc - 1.6, -5.0, 1.05, zc + 1.6, 'planks', { faceMats: { py: 'wood' } });
    k.wallDecal(0.9, 0.9, `lane${i + 1}`, -4.99, 1.4, zc, PI / 2, { uv: 'raw' });
    k.trim(0.4, 0.06, 0.6, 'wood', -5.3, 1.05, zc + 1.2);
  }
  k.light(-7.5, 2.4, -4.5, [1.3, 1.1, 0.75], 8, 'lamp');
  k.light(-7.5, 2.4, 4.5, [1.3, 1.1, 0.75], 8, 'lamp');

  // Pop-up targets: plywood silhouettes on frames behind low sandbag/concrete pits (cover).
  const rows: [number, number[]][] = [
    [4, [-6.75, 2.25]],
    [12, [-2.25, 6.75]],
    [20, [-6.75, 2.25]],
    [26, [-2.25, 6.75]],
  ];
  for (const [x, zs] of rows) {
    for (const z of zs) {
      k.aabb(x - 0.5, 0, z - 1.0, x + 0.3, 0.55, z + 1.0, 'concrete');
      k.box(0.06, 1.7, 0.7, 'target', x + 0.5, 0.25, z, { players: false, bullets: true, sight: true, uv: 'raw' });
      k.trim(0.08, 0.3, 0.08, 'wood', x + 0.5, 0, z);
    }
  }
  // Fallen targets lying flat between.
  for (const [x, z] of [[8, 4.5], [16, -4.5], [23, 0]] as const) k.box(1.7, 0.06, 0.7, 'target', x, 0, z, { players: false, uv: 'raw' });

  // Target berm with log faces; scenery slope behind.
  k.aabb(30.5, 0, -12, 33.5, 3.2, 12, 'dirt', { faceMats: { nx: 'logs', px: 'logs' } });
  k.ramp(30.5, 3.2, -12, 32, 3.8, 12, '+x', 'dirt', { collide: false });
  k.ramp(32, 3.2, -12, 33.5, 3.8, 12, '-x', 'dirt', { collide: false });
  for (let z = -10; z <= 10; z += 4) k.box(0.06, 1.6, 0.7, 'target', 30.4, 1.2, z, { collide: false, uv: 'raw' });

  // Lane-side sandbag walls and crates (cover along the flanks).
  sandbags(k, 2, -10.6, 6, -9.8);
  sandbags(k, 16, 9.8, 20, 10.6);
  sandbags(k, 22, -10.6, 25, -9.8, 0.9);
  sandbags(k, 8, 9.8, 10.5, 10.6, 0.9);
  k.box(1.2, 1.2, 1.2, 'crate', 13, 0, -10.8, { uv: 'raw' });
  k.box(1.2, 1.2, 1.2, 'crate', 14.3, 0, -11, { uv: 'raw' });
  k.box(1.2, 1.2, 1.2, 'crate', 0, 0, 10.8, { uv: 'raw' });
  // Range flag pole and the range sign.
  k.box(0.14, 7, 0.14, 'steel', -4, 0, -12.2);
  k.trim(1.4, 0.8, 0.04, 'barrelRed', -3.2, 6, -12.2);
  for (const x of [-12.5, -9.5]) k.box(0.18, 2.6, 0.18, 'wood', x, 0, -13.2);
  k.trim(3.4, 1.2, 0.1, 'planks', -11, 1.4, -13.2);
  k.wallDecal(3.2, 1.0, 'sign', -11, 1.5, -13.14, 0, { uv: 'raw' });
}

function cabin(k: MapKit) {
  const X0 = -4;
  const X1 = 6;
  const Z0 = -30;
  const Z1 = -21;
  const T = 0.25;
  const H = 6.2;
  const win = (a0: number, a1: number, up = false) => (up ? { a0, a1, y0: F2 + 0.9, y1: F2 + 2.1 } : { a0, a1, y0: 0.95, y1: 2.1 });
  const door = (a: number, w = 1.2, y = 0) => ({ a0: a - w / 2, a1: a + w / 2, y0: y, y1: y + 2.2 });
  // Stilted floor: the cabin stands on a low plinth (0.3 step).
  k.aabb(X0 - 0.2, 0, Z0 - 0.2, X1 + 0.2, 0.3, Z1 + 0.2, 'planksDark', { faceMats: { py: 'wood' } });
  const g = 0.3;
  k.wall('x', X0, X1, Z1 - T / 2, g, H - g, T, 'planks', [door(1.5), win(-3, -0.5), win(3, 5), win(-3, -0.5, true), win(0.5, 2.5, true), win(3.5, 5.5, true)].map((h) => ({ ...h, y0: h.y0 === 0 ? 0 : h.y0 - g, y1: h.y1 - g })));
  k.wall('x', X0, X1, Z0 + T / 2, g, H - g, T, 'planks', [win(-2.5, -0.5), win(2, 4), win(-2.5, 0, true), win(2, 4.5, true)].map((h) => ({ ...h, y0: h.y0 - g, y1: h.y1 - g })));
  k.wall('z', Z0 + T, Z1 - T, X0 + T / 2, g, H - g, T, 'planks', [door(-28.8), win(-27, -25, true)].map((h) => ({ ...h, y0: h.y0 === 0 ? 0 : h.y0 - g, y1: h.y1 - g })));
  k.wall('z', Z0 + T, Z1 - T, X1 - T / 2, g, H - g, T, 'planks', [win(-24.5, -22.5), door(-28.8, 1.2, F2), win(-24.5, -22.5, true)].map((h) => ({ ...h, y0: h.y0 === 0 ? 0 : h.y0 - g, y1: h.y1 - g })));
  // Interior stairs along the west wall, low at the south (rising north), and the upper slab.
  k.stairs(X0 + T, g, -27.6, X0 + 1.45, F2, -22.2, '-z', 'wood', 13);
  k.aabb(X0 + 1.45, F2 - 0.25, Z0 + T, X1 - T, F2, Z1 - T, 'wood', { faceMats: { ny: 'planksDark' } });
  k.aabb(X0 + T, F2 - 0.25, Z0 + T, X0 + 1.45, F2, -27.6, 'wood', { faceMats: { ny: 'planksDark' } });
  k.aabb(X0 + 1.45, F2, -27.6, X0 + 1.53, F2 + 1, Z1 - T, 'wood', { bullets: false, sight: false });
  // Roof: low tin gable, ridge along x.
  k.ramp(X0 - 0.6, H, Z0 - 0.6, X1 + 0.6, H + 1.6, (Z0 + Z1) / 2, '+z', 'tin');
  k.ramp(X0 - 0.6, H, (Z0 + Z1) / 2, X1 + 0.6, H + 1.6, Z1 + 0.6, '-z', 'tin');
  k.aabb(X0 + T, H - 0.1, Z0 + T, X1 - T, H, Z1 - T, 'planksDark', { hide: ['py'] });
  // Furniture: map table, radio desk, lockers, cots upstairs.
  k.box(2.2, 0.85, 1.2, 'wood', 1.5, g, -26.5);
  k.box(0.6, 0.95, 2.4, 'wood', 5.4, g, -26.5);
  k.box(1.8, 2.0, 0.5, 'steel', 1.6, g, -29.45);
  k.box(0.9, 0.5, 2.0, 'planksDark', 1, F2, -28.6, { sight: false });
  k.box(0.9, 0.5, 2.0, 'planksDark', 3.6, F2, -28.6, { sight: false });
  k.box(1.6, 0.9, 0.7, 'crate', 4.8, F2, -22, { uv: 'raw' });
  k.light(1, 2.6, -25.5, [1.3, 1.05, 0.7], 8, 'lamp');
  k.light(1.5, F2 + 2.4, -25.5, [1.3, 1.05, 0.7], 8, 'lamp');
  // South porch with steps (the door faces the lanes).
  k.trim(3.2, 0.12, 1.6, 'tin', 1.5, 2.7, -20.2);

  // Outside stairs up the east side to the balcony, the balcony, and the catwalk to the NE tower.
  k.stairs(6.2, 0, -27.6, 7.6, F2, -21.2, '-z', 'wood', 14);
  k.aabb(6, F2 - 0.25, -30.6, 8.4, F2, -27.6, 'wood');
  k.aabb(7.6, F2, -27.6, 7.68, F2 + 1, -21.2, 'wood', { bullets: false, sight: false });
  for (const [x, z] of [[8.3, -30.5], [8.3, -27.7]] as const) k.box(0.2, F2, 0.2, 'wood', x, 0, z);
  // Catwalk: 1.6 m wide at 3.2 m, railings both sides, posts every 3 m.
  k.aabb(8.4, F2 - 0.2, -29.9, 22, F2, -28.3, 'wood');
  k.aabb(8.4, F2, -29.98, 22, F2 + 1, -29.9, 'wood', { bullets: false, sight: false });
  k.aabb(8.4, F2, -28.3, 22, F2 + 1, -28.22, 'wood', { bullets: false, sight: false });
  for (let x = 10; x <= 21; x += 3) {
    k.box(0.18, F2 - 0.2, 0.18, 'wood', x, 0, -29.8);
    k.box(0.18, F2 - 0.2, 0.18, 'wood', x, 0, -28.4);
  }
  k.aabb(6, F2, -30.68, 8.4, F2 + 1, -30.6, 'wood', { bullets: false, sight: false });
  // NE guard tower: platform at F2 joined to the catwalk, half walls, roof, stairs on the east.
  k.aabb(22, F2 - 0.25, -31, 26, F2, -27, 'wood');
  for (const [x, z] of [[22.1, -30.9], [25.9, -30.9], [22.1, -27.1], [25.9, -27.1]] as const) k.box(0.2, F2 + 2.6, 0.2, 'wood', x, 0, z);
  k.aabb(22, F2, -31, 26, F2 + 1.0, -30.85, 'planks');
  k.aabb(22, F2, -27.15, 24.4, F2 + 1.0, -27, 'planks');
  k.aabb(25.85, F2, -31, 26, F2 + 1.0, -29.4, 'planks');
  k.aabb(21.6, F2 + 2.6, -31.4, 26.4, F2 + 2.8, -26.6, 'tin');
  k.stairs(26, 0, -29.4, 27.4, F2, -23.4, '-z', 'wood', 14);
  k.aabb(27.4, F2, -29.4, 27.48, F2 + 1, -23.4, 'wood', { bullets: false, sight: false });
  k.light(24, F2 + 2.3, -29, [1.4, 1.2, 0.8], 10, 'lamp');
  k.trim(0.5, 0.3, 0.4, 'lamp', 24, F2 + 2.45, -26.9);
}

function trench(k: MapKit) {
  // Trench floor, ramps, revetments, parapet; bunker walls, slits, roof.
  k.aabb(2, TR - 1, 19.5, 26, TR, 22, 'mud');
  k.aabb(26, TR - 1, 16.5, 34, TR, 25, 'concrete');
  k.ramp(2, TR, 19.5, 6, 0, 22, '-x', 'mud');
  k.ramp(14, TR, 16, 16.4, 0, 19.5, '-z', 'mud');
  k.ramp(34, TR, 20, 38, 0, 21.5, '+x', 'mud');
  for (const z of [19.52, 21.98]) k.aabb(6, TR, z - 0.02, 26, 0, z + 0.02, 'logs', { collide: false });
  sandbags(k, 6, 18.9, 14, 19.5, 0.4);
  sandbags(k, 16.4, 18.9, 26, 19.5, 0.4);
  sandbags(k, 6, 22, 26, 22.6, 0.4);
  // Bunker: walls from the trench floor to 1.4.
  const BH = 2.4;
  k.wall('z', 16.5, 25, 26.15, TR, BH, 0.3, 'concrete', [{ a0: 19.5, a1: 22, y0: 0, y1: 2.1 }]);
  k.wall('z', 16.5, 25, 33.85, TR, BH, 0.3, 'concrete', [{ a0: 20, a1: 21.5, y0: 0, y1: 2.1 }]);
  k.wall('x', 26.3, 33.7, 16.65, TR, BH, 0.3, 'concrete', [{ a0: 27, a1: 29.6, y0: 1.25, y1: 1.85 }, { a0: 30.4, a1: 33, y0: 1.25, y1: 1.85 }]);
  k.wall('x', 26.3, 33.7, 24.85, TR, BH, 0.3, 'concrete', []);
  k.aabb(25.8, TR + BH, 16.2, 34.2, TR + BH + 0.4, 25.3, 'concrete');
  for (const [x, z] of [[27.5, 18], [30, 23.5], [32.6, 19]] as const) k.trim(1.6, 0.4, 0.9, 'sandbag', x, TR + BH + 0.4, z);
  // Inside: ammo crates, a table, a lamp.
  k.box(1.2, 0.8, 1.2, 'crate', 32.8, TR, 23.8, { uv: 'raw' });
  k.box(1.6, 0.85, 0.8, 'wood', 28.5, TR, 24.2);
  k.light(30, TR + 2.1, 20.8, [1.3, 1.0, 0.65], 7, 'lamp');
}

function outbuildings(k: MapKit) {
  // North-west tin shed: door east, window north.
  const SX0 = -36;
  const SX1 = -30;
  const SZ0 = -20;
  const SZ1 = -14;
  k.wall('z', SZ0, SZ1, SX1 - 0.1, 0, 2.8, 0.2, 'tin', [{ a0: -17.8, a1: -16.4, y0: 0, y1: 2.2 }]);
  k.wall('z', SZ0, SZ1, SX0 + 0.1, 0, 2.8, 0.2, 'tin', []);
  k.wall('x', SX0 + 0.2, SX1 - 0.2, SZ0 + 0.1, 0, 2.8, 0.2, 'tin', [{ a0: -34, a1: -32.4, y0: 1.1, y1: 1.9 }]);
  k.wall('x', SX0 + 0.2, SX1 - 0.2, SZ1 - 0.1, 0, 2.8, 0.2, 'tin', []);
  k.ramp(SX0 - 0.4, 2.8, SZ0 - 0.4, SX1 + 0.4, 3.5, SZ1 + 0.4, '-x', 'tin');
  k.box(1.2, 1.2, 1.2, 'crate', -34.8, 0, -15.2, { uv: 'raw' });
  k.box(2.4, 0.9, 0.8, 'wood', -33.4, 0, -19.3);
  k.light(-33, 2.4, -17, [1.2, 1.0, 0.7], 6, 'lamp');

  // South-west guard tower: legs, platform at 4.0, half walls, roof, stairs from the east.
  const P = 4.0;
  k.aabb(-32, P - 0.25, 26, -28, P, 30, 'wood');
  for (const [x, z] of [[-31.9, 26.1], [-28.1, 26.1], [-31.9, 29.9], [-28.1, 29.9]] as const) k.box(0.22, P + 2.6, 0.22, 'wood', x, 0, z);
  k.aabb(-32, P, 26, -31.85, P + 1, 30, 'planks');
  k.aabb(-32, P, 29.85, -28, P + 1, 30, 'planks');
  k.aabb(-32, P, 26, -28, P + 1, 26.15, 'planks');
  k.aabb(-28.15, P, 27.6, -28, P + 1, 30, 'planks');
  k.aabb(-32.4, P + 2.6, 25.6, -27.6, P + 2.8, 30.4, 'tin');
  k.stairs(-28, 0, 26.2, -22, P, 27.5, '-x', 'wood', 18);
  k.aabb(-28, P, 27.5, -22, P + 1, 27.58, 'wood', { bullets: false, sight: false });
  k.light(-30, P + 2.3, 28, [1.4, 1.2, 0.8], 10, 'lamp');

  // East side: jeep, fuel drums, crates, a sandbag nest (team 1 cover by the berm).
  const JX = 38.5;
  const JZ = -18;
  k.box(1.8, 0.8, 3.6, 'jeep', JX, 0.4, JZ);
  k.trim(1.7, 0.4, 0.08, 'glass', JX, 1.2, JZ - 0.5);
  k.trim(1.8, 0.1, 1.6, 'jeep', JX, 1.6, JZ + 0.8);
  for (const s of [-1, 1]) for (const e of [-1, 1]) k.cyl(0.4, 0.26, 10, 'rubber', JX + s * 0.95, 0.4, JZ + e * 1.15, { axis: 'x', collide: false });
  for (const [x, z, m] of [[35.2, 14, 'barrelRed'], [35.8, 14.6, 'barrelGreen'], [-14, 14, 'barrelGreen'], [-14.6, 13.4, 'barrelRed'], [10, -15, 'barrelGreen']] as const) k.cyl(0.32, 0.9, 8, m, x, 0.45, z);
  sandbags(k, 36.5, 9, 37.3, 13);
  sandbags(k, 36.5, -13, 37.3, -9);
  k.box(1.2, 1.2, 1.2, 'crate', 41, 0, 15, { uv: 'raw' });
  k.box(1.2, 1.2, 1.2, 'crate', 41.4, 1.2, 15.1, { uv: 'raw', collide: false });
  // West side cover between the spawn and the booths.
  sandbags(k, -22, -6, -21.2, -2);
  sandbags(k, -22, 2, -21.2, 6);
  k.box(1.2, 1.2, 1.2, 'crate', -18, 0, 9.5, { uv: 'raw' });
  k.box(1.2, 1.2, 1.2, 'crate', -18.5, 0, -10, { uv: 'raw' });
  // Target racks south of the lanes.
  for (const x of [-1, 2]) k.box(2.4, 1.8, 0.4, 'planksDark', x, 0, 14.5);
  // Chain-link along the north edge by the cabin (bullets and sight pass).
  k.wallDecal(30, 2.6, 'chain', -20, 0, -37.9, 0);
  for (let x = -35; x <= -5; x += 3) k.trim(0.1, 2.7, 0.1, 'steel', x, 0, -37.9);
}

function jungle(k: MapKit) {
  // Trees inside the playable area (trunks collide).
  const inside: [number, number, number, number][] = [
    [-26, -30, 9, 2.6], [-14, -33, 10, 3], [14, -34, 9, 2.6], [34, -33, 10, 3], [42, -26, 9, 2.4],
    [-42, -26, 10, 3], [-40, 20, 9, 2.6], [-38, 33, 10, 3], [-16, 32, 9, 2.4], [-6, 26, 10, 2.8],
    [40, 30, 9, 2.6], [43, 22, 10, 2.6], [-20, 18, 8, 2.4], [24, 30, 9, 2.6], [8, 32, 10, 3],
    [-28, 8, 8, 2.2], [26, -16, 8, 2.2], [-12, -22, 8, 2.2],
  ];
  for (const [x, z, h, r] of inside) tree(k, x, z, h, r);
  const bushes: [number, number, number][] = [
    [-24, -26, 1.2], [-8, -34, 1.4], [10, -24, 1.0], [30, -24, 1.2], [44, -10, 1.3], [44, 6, 1.2], [-44, -8, 1.2], [-44, 8, 1.3],
    [-34, 24, 1.2], [-10, 30, 1.4], [6, 26, 1.2], [20, 34, 1.4], [36, 26, 1.1], [-24, 14, 1.0], [-30, -6, 1.0], [18, -18, 1.0],
  ];
  for (const [x, z, s] of bushes) bush(k, x, z, s);
  // Grass patches.
  for (const [x, z, w, d] of [[-30, -28, 14, 12], [30, 30, 16, 12], [-28, 28, 14, 12], [36, -30, 14, 10], [-40, 0, 10, 20], [42, 0, 9, 18], [0, 30, 20, 10], [-14, -28, 12, 10]] as const)
    k.flatDecal(w, d, 'grass', x, 0.012, z);
  // The tree line beyond the clip: walls of canopy over trunks, jungle floor, distant hills.
  for (let a = 0; a < 40; a++) {
    const t = (a / 40) * PI * 2;
    const rx = 58 + 6 * Math.sin(a * 2.3);
    const rz = 50 + 6 * Math.cos(a * 1.7);
    const x = Math.cos(t) * rx;
    const z = Math.sin(t) * rz;
    tree(k, x, z, 14 + 6 * Math.abs(Math.sin(a * 1.31)), 4 + 1.5 * Math.abs(Math.cos(a * 0.7)), false);
  }
  for (const [x0, z0, x1, z1] of [[-56, -46, 56, -41], [-56, 41, 56, 46], [-56, -41, -50, 41], [50, -41, 56, 41]] as const) k.aabb(x0, 0, z0, x1, 7, z1, 'foliageDark', { collide: false });
  k.backdropRing('hillsFar', 170, 9, 140, 50, -3, 0.2);
  k.backdropRing('hills', 120, 11, 80, 26, -2);
}

export function buildFiringRange(): MapData {
  const k = new MapKit();
  // Ground: dirt inside, with holes for the trench, its ramps and the bunker; jungle floor beyond.
  const holes: [number, number, number, number][] = [
    [2, 19.5, 26, 22],
    [14, 16, 16.4, 19.5],
    [26, 16.5, 34, 25],
    [34, 20, 38, 21.5],
  ];
  k.groundWithHoles([-220, -220, 220, 220], 0, 1, 'dirt', holes, { hide: ['ny'] });
  for (const [x0, z0, x1, z1] of [[-220, -220, 220, -44], [-220, 44, 220, 220], [-220, -44, -52, 44], [52, -44, 220, 44]] as const) k.flatDecal(x1 - x0, z1 - z0, 'jungle', (x0 + x1) / 2, 0.008, (z0 + z1) / 2);
  k.perimeter(FIRING_RANGE_BOUNDS, 14);

  lanes(k);
  cabin(k);
  trench(k);
  outbuildings(k);
  jungle(k);

  // ---- spawns ----
  const E = -PI / 2;
  const W = PI / 2;
  const sp = (x: number, y: number, z: number, yaw = 0): SpawnPoint => ({ x, y, z, yaw });
  const team0 = [sp(-42, 0, -10), sp(-42, 0, -5), sp(-42, 0, 0), sp(-42, 0, 5), sp(-42, 0, 10), sp(-38.5, 0, -7.5), sp(-38.5, 0, 2.5), sp(-38.5, 0, 12)];
  const team1 = [sp(42, 0, -10), sp(42, 0, -5), sp(42, 0, 0), sp(42, 0, 5), sp(42, 0, 10), sp(39.5, 0, -7.5), sp(39.5, 0, 2.5), sp(39.5, 0, 7)];
  const ffaAt: [number, number, number][] = [
    [-42, 0, -2], [42, 0, 2], [-33, 0, -24], [-16, 0, 24], [-26, 0, 32], [1, 0.3, -24], [2, F2, -26],
    [18, 0, -22], [38, 0, -30], [10, 0, 28], [40, 0, 26], [30, TR, 21], [-7.5, 0, -9], [-16, 0, -14],
  ];
  const ffa = ffaAt.map(([x, y, z]) => sp(x, y, z, yawTo(x, z, 0, 0)));

  // ---- objectives ----
  const P = (id: string, x: number, y: number, z: number, radius: number, team?: 0 | 1): ObjectivePoint => (team === undefined ? { id, x, y, z, radius } : { id, x, y, z, radius, team });
  const dom = [P('A', -20, 0, 0, 3), P('B', 0.5, 0, 0, 3), P('C', 37, 0, -16, 3)];
  const sd = [P('A', 30, TR, 20.8, 1.6, 1), P('B', 1, 0.3, -24, 1.6, 1)];
  const hq = [P('hq1', 12, 0, 0, 3.5), P('hq2', 1, 0.3, -25.5, 3), P('hq3', 2.5, F2, -25.5, 3), P('hq4', -7.5, 0, 0, 3), P('hq5', 30, TR, 20.8, 3), P('hq6', 24, 0, -22, 3.5), P('hq7', -33, 0, -17, 2.5), P('hq8', -25, 0, 24, 3.5), P('hq9', 39, 0, -24, 3.5)];
  const attackers = team0;
  const defenders = [sp(42, 0, -6, W), sp(42, 0, 0, W), sp(42, 0, 6, W), sp(39.5, 0, 24, yawTo(39.5, 24, 30, 20)), sp(42, 0, 18, W), sp(40, 0, -28, yawTo(40, -28, 24, -28)), sp(36, 0, -24, W), sp(43, 0, 12, W)];

  return {
    id: 'firingrange',
    name: 'Firing Range',
    bounds: FIRING_RANGE_BOUNDS,
    materials: MATERIALS,
    brushes: k.brushes,
    decals: k.decals,
    props: k.props,
    lights: k.lights,
    spawns: { teams: [team0.map((s) => ({ ...s, yaw: E })), team1.map((s) => ({ ...s, yaw: W }))], ffa },
    objectives: { dom, sd, hq },
    modeSpawns: { sd: { attackers: attackers.map((s) => ({ ...s, yaw: E })), defenders } },
    times: [
      { id: 'morning', name: 'Jungle Morning', clock: '07:10', sky: 'fr_skyMorning', unlit: [1, 0.98, 0.9], skyRot: 0, sunDir: unitVec(0.82, 0.38, -0.3), sun: [1.2, 1.0, 0.74], amb: [0.42, 0.48, 0.42], fog: [0.72, 0.76, 0.66], fogNear: 24, fogFar: 135, lights: { lamp: 0.3 }, glow: 0 },
      { id: 'evening', name: 'Evening', clock: '18:50', sky: 'skyDusk', unlit: [1, 0.86, 0.76], skyRot: PI, sunDir: unitVec(-0.85, 0.35, 0.2), sun: [1.1, 0.6, 0.38], amb: [0.28, 0.25, 0.32], fog: [0.6, 0.42, 0.38], fogNear: 20, fogFar: 120, lights: { lamp: 1 }, glow: 0.8 },
    ],
    defaultTime: 'morning',
    hotspots: [
      { x: 12, y: 0, z: 0 },
      { x: -7.5, y: 0, z: 0 },
      { x: 1, y: 0.3, z: -25.5 },
      { x: 2.5, y: F2, z: -25.5 },
      { x: 15, y: F2, z: -29.1 },
      { x: 24, y: F2, z: -29 },
      { x: 30, y: TR, z: 20.8 },
      { x: 12, y: TR, z: 20.8 },
      { x: -30, y: 4.0, z: 28 },
      { x: -33, y: 0, z: -17 },
      { x: 24, y: 0, z: -14 },
      { x: -14, y: 0, z: 14 },
      { x: 37, y: 0, z: -16 },
    ],
  };
}
