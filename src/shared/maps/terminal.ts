/**
 * Terminal (inspired by MW2's "Terminal", Zakhaev International Airport): the full multiplayer map,
 * laid out from the official overhead (see docs/maps/terminal-reference.md for the callouts,
 * distances and sources). About 115 x 79 m. Clear afternoon by default.
 *
 * Two levels. The concourse (4 m up) holds, west to east: Security with its scanner lanes (team 0
 * spawns behind it), the main departure hall and Shopping atrium (check-in, the airline office and
 * the customer service desk, the Makeup Store), the Bookstore passage between two closed shop
 * blocks, Dining with Burger Town in the north-west corner, the Upper Lounge at the top of the
 * escalators, and the Hallway along the east wall whose windows look over the apron and the
 * Maintenance roof. The ground level holds the Lower Lounge (team 1 spawns, baggage claim, the
 * escalators up), the Maintenance shed (walk through it, or take the outside stairs to its roof)
 * and the apron: air-freight crates, a fuel truck, and the parked trijet you can walk through,
 * reached by the jet bridge from the Hallway (front door), the evacuation slide (side) and the aft
 * airstair under the tail (rear). Outside stairs beside the jet bridge climb from the apron back
 * into the concourse.
 *
 * Coordinates: x east, z south, y up; yaw 0 looks north (-z). The metre grid matches the reference
 * overhead (x = (px - 600) / 10, z = (py - 400) / 10 on the cropped tac map). S&D: team 1 (Lower
 * Lounge) defends; attackers start in Security.
 */
import { MapKit, spawnAt, yawTowards } from './mw2kit';
import { unitVec, type BoxOpts, type MapData, type MaterialDef, type SpawnPoint } from './types';

const PI = Math.PI;

const MATERIALS: Record<string, MaterialDef> = {
  tarmac: { texture: 'term_apron', uvMul: [1 / 5, 1 / 5] },
  paint: { texture: 'paint', uvMul: [2, 2] },
  taxi: { texture: 'yellow', uvMul: [1 / 0.8, 1 / 0.8] },
  facade: { texture: 'term_facade', uvMul: [1 / 4, 1 / 4] },
  floor: { texture: 'term_floor', uvMul: [1 / 2.4, 1 / 2.4] },
  checker: { texture: 'term_checker', uvMul: [1 / 1.2, 1 / 1.2] },
  wall: { texture: 'term_wall', uvMul: [1 / 3, 1 / 3] },
  shop: { texture: 'term_wall', uvMul: [1 / 3, 1 / 3], tint: 0xd6d0c4 },
  shutter: { texture: 'shutter', tint: 0xc0c4c8 },
  ceiling: { texture: 'term_wall', uvMul: [1 / 2, 1 / 2], tint: 0xc8c8c4 },
  roof: { texture: 'term_facade', uvMul: [1 / 6, 1 / 6], tint: 0x9a9894 },
  pillar: { texture: 'term_facade', uvMul: [1 / 2, 1 / 2], tint: 0xe0dcd4 },
  dark: { texture: 'steel', tint: 0x50545a },
  carpet: { texture: 'term_carpet', uvMul: [1 / 2, 1 / 2] },
  seat: { texture: 'term_seat', uvMul: [1 / 0.6, 1 / 0.6] },
  books: { texture: 'term_books', uvMul: [1 / 1.6, 1 / 1.9] },
  counter: { texture: 'term_counter', uvMul: [1 / 2, 1 / 1.1] },
  planter: { texture: 'term_facade', uvMul: [1 / 1.5, 1 / 1.5], tint: 0x7a8a6a },
  glass: { texture: 'term_glass', uvMul: [1 / 2.4, 1 / 3.2], side: 'double' },
  rail: { texture: 'term_rail', uvMul: [1 / 1.6, 1], side: 'double' },
  signBooks: { texture: 'term_signBooks', emissive: 0.8 },
  signGate: { texture: 'term_signGate', emissive: 0.8 },
  signFood: { texture: 'term_signFood', emissive: 0.8 },
  signBurger: { texture: 'term_signBurger', emissive: 0.85 },
  signSecurity: { texture: 'term_signSecurity', emissive: 0.8 },
  signMakeup: { texture: 'term_signMakeup', emissive: 0.8 },
  signBaggage: { texture: 'term_signBaggage', emissive: 0.8 },
  signLounge: { texture: 'term_signLounge', emissive: 0.8 },
  jet: { texture: 'term_jet', uvMul: [1 / 4, 1 / 3] },
  alu: { texture: 'term_alu', uvMul: [1 / 2, 1 / 2] },
  cabin: { texture: 'term_cabin', uvMul: [1 / 1.2, 1 / 2.4] },
  cockpit: { texture: 'term_cockpit' },
  engine: { texture: 'term_alu', uvMul: [2, 1], tint: 0x9a9ea6 },
  slide: { texture: 'term_slide', uvMul: [1 / 1.6, 1 / 1.6] },
  bridge: { texture: 'term_bridge', uvMul: [1 / 3, 1 / 2.4] },
  blast: { texture: 'term_blast', uvMul: [1 / 3, 1 / 3] },
  truck: { texture: 'term_truck', uvMul: [1 / 4, 1 / 2.6] },
  police: { texture: 'term_alu', uvMul: [1 / 2, 1 / 2], tint: 0xf4f4f6 },
  uld: { texture: 'term_alu', uvMul: [1 / 1.6, 1 / 1.6], tint: 0xc8ccd2 },
  stairs: { texture: 'term_stairs', uvMul: [1 / 1.2, 1 / 1.2] },
  steel: { texture: 'steel' },
  rubber: { texture: 'rubber', uvMul: [1 / 0.4, 1 / 0.4] },
  yellow: { texture: 'yellow', uvMul: [1 / 0.8, 1 / 0.8] },
  hazard: { texture: 'hazard', uvMul: [1 / 0.6, 1 / 0.6] },
  lamp: { texture: 'lamp', emissive: 1 },
  fence: { texture: 'fence', side: 'double' },
  barrier: { texture: 'barrier', uvMul: [1 / 2, 1 / 1] },
  crate: { texture: 'crate', uvMul: [1 / 1.2, 1 / 1.2] },
  clip: { texture: 'none' },
};

/** Floor heights: concourse, cabin floor and the Maintenance roof. */
export const TERMINAL_LEVELS = { ground: 0, upper: 4.0, cabin: 3.2, maintenanceRoof: 4.0 } as const;

export function buildTerminal(): MapData {
  const k = new MapKit();
  const U: number = TERMINAL_LEVELS.upper;
  const C: number = TERMINAL_LEVELS.cabin;
  /** Concourse ceiling and the Lower Lounge ceiling. */
  const RF = 8.6;
  const LR = 10.6;
  const OW = 0.4;

  // ----- helpers -------------------------------------------------------------------------------
  /** Concourse floor: a solid plinth up to U with the tiled top. Tiles never overlap. */
  const plinth = (x0: number, z0: number, x1: number, z1: number) => k.slab(x0, 0, z0, x1, U, z1, 'facade', { faceMats: { py: 'floor' }, hide: ['ny'] });
  /** Roof slab over a region (ceiling face inside). */
  const roof = (x0: number, z0: number, x1: number, z1: number, y = RF) => k.slab(x0, y, z0, x1, y + 0.4, z1, 'roof', { faceMats: { ny: 'ceiling' } });
  /** Knee-to-chest high furniture box. */
  const prop = (x0: number, z0: number, x1: number, z1: number, h: number, mat: string, y = U, o: BoxOpts = {}) => k.slab(x0, y, z0, x1, y + h, z1, mat, o);
  /** Square pillar to the ceiling. */
  const pillar = (x: number, z: number, y0 = U, y1 = RF, s = 0.8) => k.slab(x - s / 2, y0, z - s / 2, x + s / 2, y1, z + s / 2, 'pillar');
  /** Render-only thin panel along a diagonal line (x/z extents swap for steep yaws, see types.ts). */
  const panel = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, t: number, mat: string) => {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const ry = Math.atan2(-(z1 - z0), x1 - x0);
    const swap = Math.abs(Math.sin(ry)) > 0.5;
    const hx = (swap ? t : L) / 2;
    const hz = (swap ? L : t) / 2;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    k.add({ min: { x: cx - hx, y: y0, z: cz - hz }, max: { x: cx + hx, y: y1, z: cz + hz }, mat, ry, collide: false });
  };
  /** Collision for a diagonal: a staircase of boxes along the line (corner to corner, no gaps). */
  const diagSolid = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, n: number, o: BoxOpts = {}) => {
    for (let i = 0; i < n; i++) {
      const ax = x0 + ((x1 - x0) * i) / n;
      const az = z0 + ((z1 - z0) * i) / n;
      const bx = x0 + ((x1 - x0) * (i + 1)) / n;
      const bz = z0 + ((z1 - z0) * (i + 1)) / n;
      k.slab(Math.min(ax, bx) - 0.15, y0, Math.min(az, bz) - 0.15, Math.max(ax, bx) + 0.15, y1, Math.max(az, bz) + 0.15, 'clip', { noRender: true, ...o });
    }
  };
  /** A balustrade along a ramp: a thin wedge whose top runs ~1 m above the slope. */
  const rampRail = (x0: number, x1: number, z: number, yLo: number, yHi: number, dir: '+x' | '-x') => {
    const run = Math.abs(x1 - x0);
    const ext = run * (1 / Math.max(0.5, yHi - yLo));
    const lo = dir === '-x' ? Math.max(x0, x1) + ext : Math.min(x0, x1) - ext;
    const hi = dir === '-x' ? Math.min(x0, x1) : Math.max(x0, x1);
    k.ramp(Math.min(lo, hi), yLo, z - 0.06, Math.max(lo, hi), yHi + 1, z + 0.06, dir, 'steel', { bullets: false, sight: false });
  };
  /** A sign quad on a wall. */
  const sign = (mat: string, w: number, h: number, x: number, y: number, z: number, ry = 0) => k.decals.push({ kind: 'wall', w, h, x, y, z, ry, mat, uv: 'raw' });
  /** Window frame decal (mullions) over a wall hole; ry 0 faces +z. */
  const frame = (w: number, h: number, x: number, y: number, z: number, ry = 0) => k.decals.push({ kind: 'wall', w, h, x, y, z, ry, mat: 'glass' });
  /** An air-freight container (ULD), with a small visual twist. */
  const uld = (x: number, z: number, h = 1.6, ry = 0, y = 0) => k.slab(x - 0.8, y, z - 0.8, x + 0.8, y + h, z + 0.8, 'uld', { ry });

  // =============================================================================================
  // Ground, apron markings, scenery
  // =============================================================================================
  k.slab(-90, -1, -80, 100, 0, 90, 'tarmac', { hide: ['nx', 'px', 'ny', 'nz', 'pz'] });
  // Lead-in line under the parked jet, stop bar, stand edge lines, the no-parking strip under the Hallway.
  k.decals.push({ kind: 'flat', w: 46, h: 0.25, x: 33, y: 0.02, z: 14.05, mat: 'taxi', seg: 1 });
  k.decals.push({ kind: 'flat', w: 0.25, h: 4, x: 16.5, y: 0.02, z: 14.05, mat: 'taxi', seg: 1 });
  for (const z of [3.5, 25]) k.decals.push({ kind: 'flat', w: 44, h: 0.2, x: 32, y: 0.02, z, mat: 'paint', seg: 1 });
  for (let z = -2; z <= 14; z += 2) k.decals.push({ kind: 'flat', w: 6, h: 0.18, x: 9, y: 0.02, z, ry: 0.6, mat: 'paint', seg: 1 });
  for (let x = 10; x <= 54; x += 11) k.decals.push({ kind: 'flat', w: 0.2, h: 12, x, y: 0.02, z: -7, mat: 'paint', seg: 1 });

  // Apron boundary: player clips with a blast fence along the south and fences to the east.
  k.playerClip(4.8, -1, 28.4, 45.4, 20, 28.8);
  k.wall('x', 5.2, 45, 29.4, 0, 3.0, 0.3, 'blast');
  diagSolid(45, 28.4, 57.7, 18.1, -1, 20, 14, { bullets: false, sight: false, tag: 'clip' });
  panel(45, 29.2, 58.5, 18.2, 0, 3, 0.3, 'blast');
  k.playerClip(57.7, -1, -21.4, 58.1, 20, 18.4);
  k.fence('z', -21, 18.1, 58.0, 0, 3, 'fence', 'steel', 20);
  k.playerClip(54.9, -1, -37, 55.3, 20, -21);
  k.playerClip(54.9, -1, -21.4, 58.1, 20, -21);
  k.fence('z', -36.6, -21.2, 55.2, 0, 3, 'fence', 'steel', 20);
  k.playerClip(42, -1, -37, 55.3, 20, -36.6);
  k.fence('x', 42.4, 55, -36.8, 0, 3, 'fence', 'steel', 20);
  // Scenery: control tower, a second pier, a parked jet beyond the fence, runway lights.
  k.trim(68, 0, -30, 73, 28, -25, 'facade');
  k.trim(66.5, 28, -31.5, 74.5, 32, -23.5, 'bridge');
  k.trim(62, 0, -60, 110, 10, -44, 'facade');
  k.trim(70, 1.6, 2, 100, 5.6, 6, 'alu');
  k.trim(80, 2.2, -8, 88, 2.5, 16, 'alu');
  k.trim(96, 5.6, 3.8, 101, 12, 4.2, 'jet');
  k.trim(-70, 0, 46, 20, 12, 60, 'facade');
  for (let z = -40; z <= 50; z += 9) k.glow(78, 0.3, z, [1, 0.8, 0.4], 1.2, 'runway');

  // =============================================================================================
  // Concourse floor (plinth tiles, non-overlapping)
  // =============================================================================================
  plinth(-57, -0.6, -51, 9.1); // west vestibule (team 0 spawn)
  plinth(-51, -8, -15, 16.6); // Security + departure hall
  plinth(-30, -20.3, -15, -8); // west corridor / gift shop
  plinth(-30, -37.8, 13, -20.3); // Burger Town, Dining, Upper Lounge (north)
  plinth(13, -23.6, 17, -20.3); // upper landing beside the escalators
  plinth(-1, -20.3, 17, -13.75); // Upper Lounge south / top of the Hallway
  plinth(-15, -20.3, -1, 17.8); // under the shop blocks + Bookstore
  plinth(-1, -13.75, 5.2, 28.4); // Hallway
  plinth(5.2, 15.6, 8, 24.4); // jet bridge root
  plinth(-15, 17.8, -1, 36.6); // Shopping south / Makeup Store
  plinth(-1, 28.4, 5.2, 36.6);
  plinth(-30.6, 16.6, -15, 40); // Shopping atrium (SW lobe)
  plinth(-42.2, 16.6, -30.6, 28.4); // airline office + customer service
  plinth(-15, 36.6, -12, 40);
  // Food court checker floor.
  k.decals.push({ kind: 'flat', w: 20.5, h: 13.7, x: -12.25, y: U + 0.01, z: -27.15, mat: 'checker' });
  k.decals.push({ kind: 'flat', w: 8, h: 8.5, x: -26, y: U + 0.01, z: -23.8, mat: 'checker' });
  // Carpet in the gate seating and the Upper Lounge.
  k.decals.push({ kind: 'flat', w: 12, h: 7, x: -21, y: U + 0.01, z: 33, mat: 'carpet' });
  k.decals.push({ kind: 'flat', w: 9, h: 9, x: 6, y: U + 0.01, z: -33, mat: 'carpet' });

  // ----- outer walls of the concourse (y 0 .. roof) -----
  const TOP = RF + 0.4;
  const wx = (x0: number, x1: number, z: number, holes: [number, number, number, number][] = [], mat = 'facade', inner = 'wall', y1 = TOP) =>
    k.wall('x', x0, x1, z, 0, y1, OW, mat, holes, { faceMats: z > 0 ? { nz: inner } : { pz: inner } });
  const wz = (z0: number, z1: number, x: number, holes: [number, number, number, number][] = [], mat = 'facade', inner = 'wall', y1 = TOP) =>
    k.wall('z', z0, z1, x, 0, y1, OW, mat, holes, { faceMats: x > 0 ? { nx: inner } : { px: inner } });
  wx(-30.2, -24.2, -28); // Burger Town north
  wz(-33.95, -28, -24.4);
  wx(-24.6, -16.7, -33.75);
  wz(-35.2, -33.55, -16.9);
  wx(-17.1, -1.4, -35); // Dining north
  wz(-38, -34.8, -1.6);
  wx(-1.8, 13.2, -37.8); // Upper Lounge north
  // Upper Lounge south wall over the Maintenance roof (plinth below), one window out onto the roof.
  k.wall('x', 5.0, 17.2, -13.75, U, TOP, OW, 'facade', [[7, 11, U + 0.3, U + 2.6]], { faceMats: { nz: 'facade', pz: 'wall' } });
  k.slab(12.8, TOP, -13.95, 17.2, LR + 0.4, -13.55, 'facade');
  frame(4, 2.3, 9, U + 0.3, -13.5);
  // Hallway east facade: windows onto the Maintenance roof, then the long run over the apron.
  const hallHoles: [number, number, number, number][] = [];
  for (let z = -13.2; z < -4; z += 3) hallHoles.push([z, z + 2.6, U + 0.35, U + 3.0]);
  for (let z = -2.8; z < 14; z += 2.5) hallHoles.push([z, z + 2.2, U + 0.6, U + 3.4]);
  wz(-13.95, 15.8, 5.2, hallHoles, 'facade', 'wall');
  for (const [a, b, lo, hi] of hallHoles) frame(b - a, hi - lo, 5.2, lo, (a + b) / 2, PI / 2);
  // Jet bridge root (the plane entrance): north and south walls, east wall with the bridge and stair doors.
  k.wall('x', 5.0, 8.2, 15.6, 0, 7.8, OW, 'facade', [], { faceMats: { pz: 'wall' } });
  k.wall('x', 5.0, 8.2, 24.4, 0, 7.8, OW, 'facade', [], { faceMats: { nz: 'wall' } });
  k.slab(5.0, 7.4, 15.8, 5.4, TOP, 24.2, 'facade'); // lintel over the root opening
  k.wall('z', 15.6, 24.4, 8, 0, 7.8, OW, 'facade', [[18.75, 21.6, U, U + 2.4], [21.85, 23.35, U, U + 2.3]], { faceMats: { nx: 'wall' } });
  roof(5.2, 15.6, 8.2, 24.4, 7.4);
  sign('signGate', 2.6, 0.6, 7.78, U + 2.6, 20.2, -PI / 2);
  // Hallway south end and the Makeup Store's outer walls.
  wz(24.2, 36.8, 5.2, [[25, 27.8, U + 0.6, U + 3.4]]);
  frame(2.8, 2.8, 5.2, U + 0.6, 26.4, PI / 2);
  wx(-12.1, 5.4, 36.6);
  k.wall('z', 36.4, 40.2, -11.9, 0, TOP, OW, 'facade', [], { faceMats: { nx: 'wall' } });
  wx(-20.2, -11.7, 40);
  // South-west diagonal of the Shopping atrium.
  panel(-20, 40, -30.6, 30, 0, TOP, OW, 'facade');
  diagSolid(-20, 40, -30.6, 30, 0, TOP, 14);
  wz(28.2, 30.2, -30.6);
  wx(-34.6, -30.4, 28.4);
  wz(25.8, 28.6, -34.4);
  wx(-42.4, -34.2, 26);
  wz(16.4, 26.2, -42.2);
  wx(-51.1, -42, 16.6);
  wz(8.9, 16.8, -50.9);
  wx(-57.1, -50.7, 9.1);
  wz(-0.8, 9.3, -56.9);
  wx(-57.1, -50.7, -0.6);
  wz(-8, -0.4, -50.9);
  wx(-51.1, -29.8, -7.8);
  wz(-28.2, -7.6, -30);

  // ----- concourse roof (tiles mirror the plinth, the Lower Lounge has its own higher roof) -----
  roof(-57, -0.6, -51, 9.1);
  roof(-51, -8, -15, 16.6);
  roof(-30, -20.3, -15, -8);
  roof(-30, -37.8, 13, -20.3);
  roof(-1, -20.3, 13, -13.75);
  roof(-1, -13.75, 5.2, 36.6);
  roof(-15, 17.8, -1, 36.6);
  roof(-30.6, 16.6, -15, 40);
  roof(-42.2, 16.6, -30.6, 28.4);
  roof(-15, 36.6, -12, 40);
  // Skylight frames (render only) over Security, the atrium and Dining.
  for (const [x, z, w, d] of [[-40, 4, 12, 8], [-22, 28, 10, 8], [-12, -27, 10, 8]] as const) k.decals.push({ kind: 'flat', w, h: d, x, y: RF - 0.02, z, mat: 'glass' });

  // ----- the two closed shop blocks (solid, shutters on their fronts) -----
  k.slab(-16.9, 0, -20.3, -1, RF, -6, 'shop');
  k.slab(-13, 0, -6, -1, RF, -2.2, 'shop');
  k.slab(-15, 0, 6.25, -1, RF, 17.8, 'shop');
  for (const [w, x, z, ry] of [[6, -9, -20.32, PI], [5, -16.92, -13, -PI / 2], [6, -0.98, -12, PI / 2], [6, -0.98, 12, PI / 2], [6, -8, 17.82, 0], [4, -15.02, 11, -PI / 2]] as const) {
    k.decals.push({ kind: 'wall', w, h: 3, x, y: U, z, ry, mat: 'shutter' });
  }

  // =============================================================================================
  // Security (west): scanner lanes, metal detectors, the round info desk
  // =============================================================================================
  const lane = (x0: number, x1: number, z: number) => prop(x0, z - 0.15, x1, z + 0.15, 1.0, 'barrier');
  lane(-45, -33, -4.2);
  lane(-47, -36, -0.4);
  lane(-45, -34.7, 2.2);
  lane(-45, -33, 6.25);
  lane(-45, -35, 12.2);
  // Metal detector arches (posts collide, header is trim) with an x-ray belt beside each.
  const arch = (x: number, z0: number, z1: number) => {
    prop(x - 0.3, z0 - 0.25, x + 0.3, z0, 2.3, 'dark');
    prop(x - 0.3, z1, x + 0.3, z1 + 0.25, 2.3, 'dark');
    k.trim(x - 0.3, U + 2.1, z0 - 0.25, x + 0.3, U + 2.3, z1 + 0.25, 'dark');
  };
  arch(-40.5, -3.4, -2.0);
  arch(-40.5, 0.6, 1.9);
  arch(-40.5, 7.6, 9.0);
  arch(-40.5, 13.4, 14.9);
  prop(-39, -1.6, -33.4, -0.8, 1.0, 'steel');
  prop(-39, 4.3, -34, 5.2, 1.0, 'steel');
  prop(-39, 9.6, -33.6, 10.5, 1.0, 'steel');
  for (const [x, z] of [[-42.5, 4], [-34, 4], [-44, -6.9], [-34, -6.9], [-42.5, 15.8]] as const) pillar(x, z);
  sign('signSecurity', 4, 0.7, -40, U + 3.2, -7.58);
  // Round info desk with a pillar in the middle (gap on the east side to get in).
  prop(-24.7, 1.9, -20.6, 2.5, 1.1, 'counter');
  prop(-24.7, 5.3, -20.6, 5.9, 1.1, 'counter');
  prop(-24.7, 2.5, -24.1, 5.3, 1.1, 'counter');
  pillar(-22.7, 3.9, U, RF, 0.6);
  k.slab(-28, U, 0.2, -25.6, U + 0.5, 2.2, 'seat', { ry: 0.6 });

  // =============================================================================================
  // Shopping: atrium, check-in island, airline office, customer service desk, Makeup Store
  // =============================================================================================
  // Check-in island (U shape, open to the south).
  prop(-24.7, 12.8, -24.1, 17.4, 1.1, 'counter');
  prop(-21.2, 12.8, -20.6, 17.4, 1.1, 'counter');
  prop(-24.1, 12.8, -21.2, 13.4, 1.1, 'counter');
  k.trim(-24.7, U + 1.1, 12.9, -20.6, U + 2.6, 13.2, 'dark');
  // Kastovia Airlines office south of the scanners (doors north and east) and the east-facing desk.
  k.wall('x', -42.2, -34.4, 16.6, U, RF, 0.2, 'wall', [[-40.2, -38.6, U, U + 2.3]]);
  k.wall('z', 16.7, 26, -34.4, U, RF, 0.2, 'wall', [[21.8, 23.6, U, U + 2.3], [17.6, 20.8, U + 1, U + 2.4]]);
  prop(-41.3, 18, -40.6, 24.4, 1.0, 'counter');
  prop(-38.5, 23, -36, 24, 0.8, 'counter');
  prop(-30.6, 15.6, -29.8, 19.4, 1.1, 'counter');
  prop(-34.2, 15.3, -30.6, 15.9, 1.1, 'counter');
  k.slab(-31.6, U, 19.6, -30.6, RF, 25.6, 'wall');
  sign('signGate', 2.4, 0.5, -30.08, U + 2.6, 17.5, PI / 2);
  // Gate seating, planters, a pillar.
  for (const [x0, x1, z] of [[-26, -18, 31.6], [-24, -16, 34.4], [-27, -22, 22.2]] as const) prop(x0, z, x1, z + 0.6, 0.5, 'seat');
  prop(-23.4, 26.6, -21.6, 28.2, 0.9, 'planter');
  prop(-21.4, 27.4, -20.2, 29.4, 0.9, 'planter');
  pillar(-16.9, 16.2);
  pillar(-27, 36);
  // Shopping south: benches, a planter, a pillar by the hallway end.
  prop(-8.5, 20.6, -2, 21.4, 0.5, 'seat');
  prop(-13.4, 24, -11.6, 26.8, 0.9, 'planter');
  pillar(-3, 25.5);
  // Makeup Store (south): north wall with two doors and display windows, a west door, displays.
  k.wall('x', -11.9, 5.2, 27.5, U, RF, 0.2, 'shop', [
    [-11.4, -8.6, U + 0.9, U + 2.4],
    [-8, -5.5, U, U + 2.4],
    [-5, -0.2, U + 0.9, U + 2.4],
    [0.4, 2.6, U, U + 2.4],
    [3.0, 4.8, U + 0.9, U + 2.4],
  ]);
  k.wall('z', 27.6, 36.4, -11.9, U, RF, 0.2, 'shop', [[32.6, 35, U, U + 2.4]]);
  sign('signMakeup', 4, 0.6, -6.8, U + 2.7, 27.38, PI);
  prop(-4, 31.6, -1, 32.8, 1.0, 'counter');
  prop(-9.2, 29.8, -7.2, 31, 1.0, 'counter');
  prop(-11.6, 35.8, 4.8, 36.4, 2.0, 'books');
  prop(4.4, 29, 5.0, 35, 1.1, 'counter');
  k.slab(-11.9, U + 3.2, 27.5, 5.2, U + 3.4, 36.6, 'ceiling');

  // =============================================================================================
  // Bookstore passage (between the shop blocks: Shopping <-> Hallway)
  // =============================================================================================
  k.wall('z', -2.2, 6.25, -15, U, RF, 0.2, 'shop', [[-1.6, -0.2, U + 0.9, U + 2.4], [0.4, 3.6, U, U + 2.5], [4.2, 5.8, U + 0.9, U + 2.4]]);
  k.wall('z', -2.2, 6.25, -1, U, RF, 0.2, 'shop', [[-1.6, 0.6, U + 0.9, U + 2.4], [1.0, 4.0, U, U + 2.5]]);
  k.slab(-15, U + 3.2, -2.2, -1, U + 3.4, 6.25, 'ceiling');
  sign('signBooks', 3, 0.6, -15.12, U + 2.7, 2, -PI / 2);
  sign('signBooks', 3, 0.6, -0.88, U + 2.7, 2.5, PI / 2);
  prop(-12.6, -1.6, -12, 1.4, 1.9, 'books');
  prop(-9.5, 2.0, -8.9, 5.6, 1.9, 'books');
  prop(-6.2, -1.6, -5.6, 1.6, 1.9, 'books');
  prop(-14.6, -2.2, -7, -1.7, 2.2, 'books');
  prop(-13.8, 5.75, -10.2, 6.25, 2.2, 'books');
  prop(-4.2, 4.4, -2, 5.4, 1.1, 'counter');
  k.light(-8, U + 2.9, 2, [1.3, 1.15, 0.9], 8, 'terminal');

  // =============================================================================================
  // West corridor + gift shop, Dining with Burger Town (north-west corner)
  // =============================================================================================
  prop(-29.7, -19.4, -28.9, -12.2, 2.0, 'books');
  prop(-23, -16.6, -22.2, -13.4, 1.2, 'counter');
  prop(-24, -11, -21, -9.6, 1.1, 'counter');
  // Burger Town: wraparound counter (south and east, way in at the north end of the east side),
  // kitchen shelves with a slit you can see and shoot through, the grill along the back wall.
  prop(-26, -20, -21.9, -19.4, 1.05, 'counter');
  prop(-22.5, -26.2, -21.9, -20, 1.05, 'counter');
  prop(-29.8, -27.7, -28.8, -21, 1.0, 'steel');
  prop(-28, -26.4, -27.4, -21.4, 1.35, 'steel');
  prop(-28, -26.4, -27.4, -21.4, 0.5, 'steel', U + 1.6);
  k.wall('x', -30, -21.6, -19.4, U + 3.0, RF, 0.3, 'wall');
  k.wall('z', -28, -19.4, -21.9, U + 3.0, RF, 0.3, 'wall');
  sign('signBurger', 5, 0.8, -26, U + 3.3, -19.23);
  sign('signBurger', 4, 0.7, -21.73, U + 3.3, -24, PI / 2);
  k.light(-26, U + 2.8, -24, [1.4, 1.1, 0.8], 7, 'terminal');
  // Dining: pillars, tables around the cross planter, benches.
  for (const [x, z] of [[-18.9, -32], [-15.9, -26.6], [-3.8, -32], [-3.9, -26.4], [-18.9, -21.3]] as const) pillar(x, z);
  prop(-12.2, -27.4, -8.1, -26, 0.9, 'planter');
  prop(-10.8, -28.75, -9.5, -24.7, 0.9, 'planter');
  for (const [x, z] of [[-13.6, -30.2], [-6.8, -30.2], [-13.6, -23.2], [-6.8, -23.2], [-14.2, -26.7], [-6, -26.7]] as const) prop(x - 0.6, z - 0.4, x + 0.6, z + 0.4, 0.75, 'counter');
  prop(-13, -19.7, -7.8, -19.1, 0.5, 'seat');
  k.slab(-4.4, U, -22.5, -1.8, U + 0.5, -21.4, 'seat', { ry: 0.3 });

  // =============================================================================================
  // Upper Lounge (top of the escalators), Hallway
  // =============================================================================================
  prop(6.8, -31, 8.3, -22.2, 1.1, 'counter');
  prop(4.2, -27.8, 6.8, -25.4, 1.1, 'counter');
  pillar(5.2, -26.6, U, RF, 0.6);
  sign('signFood', 2.4, 0.6, 7.55, U + 2.4, -26.6, -PI / 2);
  for (const [x0, x1] of [[-0.8, 1.6], [2.4, 4.6]] as const) prop(x0, -37.5, x1, -36.9, 0.5, 'seat');
  pillar(7.8, -35.6);
  pillar(4.6, -14.6);
  sign('signLounge', 4, 0.6, 2.2, U + 3, -37.58);
  // Railings over the Lower Lounge (gap = escalator mouth) and the east landing.
  k.rail('z', -37.8, -29.7, 13, U, 'rail', 'steel');
  k.rail('z', -24.8, -23.6, 13, U, 'rail', 'steel');
  k.rail('x', 13, 17, -23.6, U, 'rail', 'steel');
  k.rail('z', -23.6, -14.4, 17, U, 'rail', 'steel');
  // Fascia between the concourse roof and the higher lounge roof.
  k.slab(12.8, RF, -37.8, 13.2, LR, -13.75, 'facade', { faceMats: { px: 'wall' } });
  // Hallway: almost no cover (a bench, a bin, mullions); the Bookstore and Shopping open off its west side.
  prop(-0.6, -6.2, 0.4, -3.6, 0.5, 'seat');
  prop(1.0, -5.4, 2.0, -4.4, 1.0, 'steel');
  prop(-0.6, 10, 0.4, 12.6, 0.5, 'seat');
  pillar(-0.6, 16.4, U, RF, 0.7);

  // =============================================================================================
  // Escalators: Upper Lounge (x 13) down to the Lower Lounge (x 19.5); escalator, stairs, escalator
  // =============================================================================================
  k.ramp(13, 0, -29.6, 19.5, U, -28.15, '-x', 'stairs', { tag: 'stairs' });
  k.ramp(13, 0, -28.05, 19.5, U, -26.5, '-x', 'stairs', { tag: 'stairs' });
  k.ramp(13, 0, -26.4, 19.5, U, -24.9, '-x', 'stairs', { tag: 'stairs' });
  for (const z of [-29.66, -28.1, -26.45, -24.84]) rampRail(13, 19.5, z, 0, U, '-x');

  // =============================================================================================
  // Lower Lounge (ground, team 1 spawn): baggage claim, snack bar, benches, glass facades
  // =============================================================================================
  const LW = 'facade';
  k.wall('x', 13, 35.1, -37.8, 0, LR + 0.4, OW, LW, [], { faceMats: { pz: 'wall' } });
  k.slab(34.9, 0, -37.8, 42.6, LR + 0.4, -32.2, 'facade'); // closed staff block (NE notch)
  k.wall('z', -32.2, -21.8, 42.4, 0, LR + 0.4, OW, LW, [[-26, -23.5, 0, 2.6], [-31, -26.6, 0.9, 4.4]], { faceMats: { nx: 'wall' } });
  frame(4.4, 3.5, 42.4, 0.9, -28.8, PI / 2);
  // Diagonal glass corner (south-east): sill, mullions, header.
  panel(42.4, -22, 34.6, -14.4, 0, 0.9, 0.3, LW);
  panel(42.4, -22, 34.6, -14.4, 4.4, LR + 0.4, 0.3, LW);
  panel(42.4, -22, 34.6, -14.4, 0.9, 4.4, 0.05, 'glass');
  diagSolid(42.4, -22, 34.6, -14.4, 0, 0.9, 10);
  diagSolid(42.4, -22, 34.6, -14.4, 4.4, LR + 0.4, 10);
  for (let i = 1; i < 5; i++) {
    const x = 42.4 + (34.6 - 42.4) * (i / 5);
    const z = -22 + (-14.4 + 22) * (i / 5);
    k.slab(x - 0.15, 0.9, z - 0.15, x + 0.15, 4.4, z + 0.15, 'dark');
  }
  // South facade: door to the apron, big windows, the door through to Maintenance.
  k.wall('x', 16.8, 34.8, -14.4, 0, LR + 0.4, OW, LW, [
    [19.5, 21.5, 0, 2.4],
    [23.4, 27.0, 0.9, 4.4],
    [27.4, 29.3, 0, 2.6],
    [29.7, 34.2, 0.9, 4.4],
  ], { faceMats: { nz: 'wall' } });
  frame(3.6, 3.5, 25.2, 0.9, -14.18);
  frame(4.5, 3.5, 31.95, 0.9, -14.18);
  roof(13, -37.8, 42.6, -14.4, LR);
  roof(13, -14.4, 17.2, -13.55, LR);
  sign('signBaggage', 5, 0.7, 23, 3.4, -37.58);
  // Baggage claim carousels against the north wall.
  for (const x0 of [19, 23.4]) {
    k.slab(x0, 0, -37.8, x0 + 3.6, 2.4, -37.1, 'steel');
    k.slab(x0 + 0.3, 0, -37.1, x0 + 3.3, 0.55, -34.6, 'rubber', { faceMats: { py: 'rubber' } });
  }
  k.slab(17.3, 0, -37.8, 18.5, 2.2, -33.4, 'steel');
  // Snack bar facing the escalators, benches, pillars.
  k.slab(24.6, 0, -30, 27.4, 1.1, -27.5, 'counter');
  sign('signFood', 2.2, 0.5, 24.58, 1.6, -28.75, -PI / 2);
  for (const [x0, z0, x1, z1] of [[19.2, -32, 23.8, -31.4], [28.6, -32, 33, -31.4], [35.6, -29.4, 37, -25.4], [25.8, -21, 27, -16.8], [29.9, -21, 31.1, -16.8]] as const) {
    k.slab(x0, 0, z0, x1, 0.5, z1, 'seat');
  }
  pillar(25.2, -23.4, 0, LR);
  pillar(33, -23.4, 0, LR);
  pillar(21, -18, 0, LR);
  for (const [x, z] of [[18, -33], [28, -33], [38, -29], [16, -20], [25, -20], [33, -19], [39, -24]] as const) k.light(x, LR - 1.6, z, [1.3, 1.25, 1.1], 15, 'terminal');

  // =============================================================================================
  // Maintenance shed (ground; outside stairs to its roof, which meets the Hallway windows)
  // =============================================================================================
  const MH = 3.6;
  k.wall('x', 17, 23.2, -14.075, 0, MH, 0.65, 'facade', [[19.5, 21.5, 0, 2.4]]); // shared with the lounge
  k.wall('z', -13.75, -3.4, 23, 0, MH, 0.4, 'facade', [], { faceMats: { nx: 'wall' } });
  k.wall('x', 5.2, 23.2, -3.4, 0, MH, 0.4, 'facade', [[6.5, 11.5, 0, 3.0], [13.8, 15.8, 0, 2.4]], { faceMats: { nz: 'wall' } });
  k.wall('z', -13.75, -3.6, 13, 0, MH, 0.3, 'wall', [[-7.2, -5.2, 0, 2.4]]);
  k.slab(5.2, MH, -13.95, 23.2, TERMINAL_LEVELS.maintenanceRoof, -3.2, 'roof', { faceMats: { ny: 'ceiling' } });
  k.decals.push({ kind: 'wall', w: 5, h: 0.6, x: 9, y: 3.0, z: -3.19, mat: 'shutter' });
  // Roof parapets (gap where the outside stairs arrive).
  const MR: number = TERMINAL_LEVELS.maintenanceRoof;
  k.slab(5.2, MR, -3.5, 15.8, MR + 0.6, -3.2, 'facade');
  k.slab(17.6, MR, -3.5, 23.2, MR + 0.6, -3.2, 'facade');
  k.slab(22.9, MR, -13.75, 23.2, MR + 0.6, -3.5, 'facade');
  k.slab(9.5, MR, -9.5, 11.5, MR + 1.2, -7.5, 'steel'); // roof AC unit
  // Inside: the truck in the east bay, shelving and barrels in the west room.
  k.slab(16.4, 0, -12.2, 19, 2.0, -5.6, 'truck');
  k.slab(16.5, 0, -5.6, 18.9, 2.4, -4.4, 'truck');
  k.slab(5.4, 0, -13.5, 6.2, 2.2, -8, 'crate');
  k.cyl(0.35, 0.9, 8, 'yellow', 11.8, 0.45, -12.6);
  k.cyl(0.35, 0.9, 8, 'yellow', 12.4, 0.45, -11.6);
  k.light(9, 3.0, -8.5, [1.2, 1.1, 0.9], 7, 'terminal');
  k.light(20, 3.0, -9, [1.2, 1.1, 0.9], 7, 'terminal');
  // Outside stairs along the south face, rising west to the roof.
  k.ramp(16, 0, -3.2, 23, MR, -1.6, '-x', 'stairs', { tag: 'stairs' });
  rampRail(16, 23, -1.6, 0, MR, '-x');

  // =============================================================================================
  // Jet bridge, outside stairs, the parked trijet (walk-through cabin)
  // =============================================================================================
  // Bridge tube from the root (U) sloping down to the cab at cabin height, then the cab north to the door.
  k.ramp(8, C, 18.75, 18.6, U, 21.6, '-x', 'carpet', { faceMats: { py: 'carpet' } });
  k.slab(8, C - 0.3, 18.75, 18.6, C, 21.6, 'bridge');
  k.wall('x', 8, 18.6, 18.85, C - 0.3, 6.6, 0.2, 'bridge', [[10, 12.5, U + 0.9, U + 1.9], [14, 16.5, C + 1.2, C + 2.1]], { faceMats: { pz: 'wall' } });
  k.wall('x', 8, 18.6, 21.5, C - 0.3, 6.6, 0.2, 'bridge', [[10, 12.5, U + 0.9, U + 1.9], [14, 16.5, C + 1.2, C + 2.1]], { faceMats: { nz: 'wall' } });
  k.slab(8, 6.6, 18.75, 18.6, 6.8, 21.6, 'bridge', { faceMats: { ny: 'ceiling' } });
  k.slab(18.6, C - 0.3, 16.1, 21.4, C, 21.6, 'bridge', { faceMats: { py: 'carpet' } });
  k.wall('z', 16.1, 18.85, 18.7, C - 0.3, 6.6, 0.2, 'bridge', [], { faceMats: { px: 'wall' } });
  k.wall('z', 16.1, 21.6, 21.3, C - 0.3, 6.6, 0.2, 'bridge', [], { faceMats: { nx: 'wall' } });
  k.wall('x', 18.6, 21.4, 21.5, C - 0.3, 6.6, 0.2, 'bridge', [], { faceMats: { nz: 'wall' } });
  k.slab(18.6, 6.6, 16.1, 21.4, 6.8, 21.6, 'bridge', { faceMats: { ny: 'ceiling' } });
  k.slab(18.6, C + 2.0, 16.1, 21.4, 6.6, 16.3, 'bridge'); // header over the plane door
  k.slab(16.8, 0, 19.9, 17.4, C - 0.3, 20.5, 'steel');
  k.trim(16.2, 0, 19.4, 18, 0.7, 21, 'yellow');
  for (const [x, y, z] of [[6.6, U + 2.8, 20], [12, 6.1, 20.2], [17, 5.8, 20.2], [20, 5.6, 18.6]] as const) k.light(x, y, z, [1.3, 1.25, 1.1], 9, 'terminal');
  // Outside stairs from the apron up into the jet bridge root.
  k.ramp(8, 0, 21.85, 16.4, U, 23.35, '-x', 'stairs', { tag: 'stairs' });
  rampRail(8, 16.4, 23.35, 0, U, '-x');

  // Fuselage: cabin x 17.7..50.8 (inner z 12.3..15.8), floor at C. Nose west by the bridge, tail east.
  const fx0 = 17.7;
  const fx1 = 50.8;
  const fz0 = 12;
  const fz1 = 16.1;
  const ceil = 5.6;
  k.slab(fx0, 1.5, fz0, 46, C, fz1, 'alu', { faceMats: { py: 'carpet' } });
  k.slab(46, 1.5, fz0, fx1, C, 13.1, 'alu', { faceMats: { py: 'carpet' } });
  k.slab(46, 1.5, 15, fx1, C, fz1, 'alu', { faceMats: { py: 'carpet' } });
  // Side walls: front door (south, at the bridge cab), evacuation exit (north, to the slide).
  k.wall('x', fx0, fx1, fz0 + 0.15, C, ceil, 0.3, 'jet', [[27.1, 28.7, C, C + 1.9]], { faceMats: { pz: 'cabin' } });
  k.wall('x', fx0, fx1, fz1 - 0.15, C, ceil, 0.3, 'jet', [[19.2, 21.2, C, C + 2.0]], { faceMats: { nz: 'cabin' } });
  k.wall('z', fz0 + 0.3, fz1 - 0.3, fx0 + 0.15, C, ceil, 0.3, 'alu', [], { faceMats: { px: 'cabin' } });
  // Rear bulkhead: opening down to the aft airstair.
  k.slab(fx1 - 0.3, 1.5, fz0, fx1, ceil, 13.1, 'alu', { faceMats: { nx: 'cabin' } });
  k.slab(fx1 - 0.3, 1.5, 15, fx1, ceil, fz1, 'alu', { faceMats: { nx: 'cabin' } });
  k.slab(fx1 - 0.3, 5.3, 13.1, fx1, ceil, 15, 'alu');
  k.slab(fx0, ceil, fz0, fx1, ceil + 0.5, fz1, 'alu', { faceMats: { ny: 'ceiling' } });
  k.trim(fx0 + 0.5, ceil + 0.5, fz0 + 0.6, fx1, ceil + 0.8, fz1 - 0.6, 'alu');
  // Cockpit partition (door in the middle) and the forward galley.
  k.wall('z', fz0 + 0.3, fz1 - 0.3, 19.4, C, ceil, 0.15, 'cabin', [[13.4, 14.7, C, C + 2.0]]);
  k.slab(19.6, C, 12.3, 21.6, C + 2.2, 13.4, 'steel');
  // Nose and cockpit glazing, tail cone, T-tail, three tail engines.
  k.trim(16.6, 1.8, 12.4, fx0, 5.4, 15.7, 'alu');
  k.trim(15.6, 2.3, 12.9, 16.6, 4.9, 15.2, 'alu');
  k.trim(14.9, 2.8, 13.4, 15.6, 4.3, 14.7, 'alu');
  k.decals.push({ kind: 'wall', w: 1.8, h: 0.6, x: 16.9, y: 4.5, z: 15.72, mat: 'cockpit', uv: 'raw' });
  k.decals.push({ kind: 'wall', w: 1.8, h: 0.6, x: 16.9, y: 4.5, z: 12.38, ry: PI, mat: 'cockpit', uv: 'raw' });
  k.trim(fx1, 3.5, 12.4, 54, 6.0, 15.7, 'alu');
  k.trim(54, 4.0, 12.9, 57, 5.6, 15.2, 'alu');
  k.trim(48, 6.0, 13.85, 55.5, 12, 14.25, 'jet');
  k.trim(52.5, 11.6, 9.4, 56.5, 12, 18.7, 'alu');
  k.cyl(0.65, 4.4, 10, 'engine', 47.6, 4.9, 11.2, 'x', false);
  k.cyl(0.65, 4.4, 10, 'engine', 47.6, 4.9, 16.9, 'x', false);
  k.cyl(0.65, 3.0, 10, 'engine', 46.8, 6.6, 14.05, 'x', false);
  // Wings (swept back, walk underneath; climb the crates by the north root to stand on one).
  const wing = (zA: number, zB: number, xA: number, xB: number, y: number) => k.slab(xA, y, Math.min(zA, zB), xB, y + 0.3, Math.max(zA, zB), 'alu');
  const bands: [number, number, number, number][] = [[9.4, 12, 32.45, 42.6], [6.8, 9.4, 35.35, 43.8], [4.2, 6.8, 38.25, 45], [1.6, 4.2, 41.15, 46.2], [-1, 1.6, 44.05, 47.4]];
  bands.forEach(([z0, z1, x0, x1], i) => {
    wing(z0, z1, x0, x1, 2.2 + i * 0.1);
    wing(28.1 - z1, Math.min(28.1 - z0, 28.3), x0, x1, 2.2 + i * 0.1);
  });
  // Landing gear.
  for (const [x, z] of [[21, 14.05], [37.5, 12.8], [37.5, 15.3]] as const) {
    k.slab(x - 0.18, 0, z - 0.18, x + 0.18, 1.5, z + 0.18, 'steel');
    k.cyl(0.42, 0.35, 8, 'rubber', x, 0.42, z - 0.4, 'z', false);
    k.cyl(0.42, 0.35, 8, 'rubber', x, 0.42, z + 0.4, 'z', false);
  }
  // Cabin seats: rows both sides of a 1.3 m aisle; gaps at the doors, the north side cleared aft of
  // the evacuation exit (the S&D site), loose cargo at the very back.
  for (let x = 22; x < 43.6; x += 0.95) {
    const north = x + 0.6 < 27.0 || (x > 28.8 && x + 0.6 < 29.6) || x > 34;
    if (north) k.slab(x, C, 12.3, x + 0.6, C + 0.6, 13.4, 'seat');
    k.slab(x, C, 14.7, x + 0.6, C + 0.6, 15.8, 'seat');
  }
  k.slab(44.2, C, 12.3, 45.8, C + 1.0, 13.0, 'crate');
  k.slab(44.6, C, 15.2, 45.8, C + 0.8, 15.8, 'crate');
  for (const x of [24, 34, 43]) k.light(x, ceil - 0.4, 14.05, [1.0, 0.95, 0.85], 6, 'terminal');
  // Evacuation slide (north side) and the aft airstair under the tail.
  k.ramp(27.1, 0, 6.2, 28.7, C, 12.0, '+z', 'slide', { tag: 'stairs' });
  k.ramp(46, 0, 13.1, 54, C, 15, '-x', 'stairs', { tag: 'stairs' });

  // =============================================================================================
  // Apron clutter (positions from the reference overhead)
  // =============================================================================================
  // Air-freight cross north of the nose.
  for (const [x, z, h] of [[17.4, 7.1, 3.2], [19, 7.1, 1.6], [17.4, 8.7, 1.6], [19, 8.7, 3.2], [17.4, 10.3, 1.6], [19, 10.3, 1.6], [17.4, 11.9, 3.2], [15.0, 9.4, 1.6], [21.4, 9.4, 1.6]] as const) uld(x, z, h, (x * 7 + z) % 0.2);
  // Tug and baggage carts by the jet bridge root.
  k.slab(8.4, 0, 11.9, 9.7, 1.3, 14.3, 'yellow');
  k.slab(8.4, 0, 14.6, 12.6, 1.0, 16.0, 'crate');
  // Baggage cart train under the south wing.
  for (let i = 0; i < 4; i++) k.slab(26.9 + i * 1.25, 0, 21.2 - i * 1.4, 28.1 + i * 1.25, 1.0, 22.4 - i * 1.4, 'crate', { ry: -0.85 });
  // Climb to the north wing: a low crate, then a container, then the wing root.
  k.slab(31.6, 0, 8.6, 32.8, 0.9, 10.2, 'crate');
  uld(34.2, 9.4, 1.6);
  k.slab(35.4, 0, 10.9, 40.4, 1.0, 11.9, 'yellow'); // belt loader
  uld(43, 8.6, 1.6, 0.1);
  uld(46.6, 7.6, 1.6, -0.1);
  uld(46.6, 9.2, 1.6, 0.05);
  // Containers south-east of the tail and along the south fence.
  uld(51, 17.95);
  uld(52.6, 17.95);
  uld(52.6, 16.35);
  uld(34.3, 27.5);
  uld(35.9, 27.5);
  k.slab(17.6, 0, 25.8, 18.3, 1.0, 28.2, 'barrier');
  // North apron: police car, baggage tug and cart, the NE container cross, the fuel truck.
  k.slab(28.6, 0, -7.4, 33.6, 1.0, -5.5, 'police');
  k.slab(29.8, 1.0, -7.2, 32.2, 1.45, -5.7, 'police');
  k.trim(30.6, 1.45, -6.9, 31.4, 1.6, -5.9, 'hazard');
  k.slab(30.4, 0, -5.3, 32, 1.3, -2.6, 'yellow');
  k.slab(30.4, 0, -2.5, 35.5, 1.0, -0.6, 'crate');
  for (const [x, z, h] of [[44.6, -10.2, 1.6], [44.6, -8.6, 3.2], [46.2, -8.6, 1.6], [43, -7, 1.6], [44.6, -7, 1.6], [46.2, -7, 3.2], [47.4, -5.4, 1.6], [44.6, -3.4, 1.6]] as const) uld(x, z, h, (z * 3) % 0.15);
  k.slab(52.9, 0, -3.25, 55, 2.4, -1.0, 'truck');
  k.slab(53.0, 0, -1.0, 54.9, 0.9, 7.5, 'steel');
  k.cyl(1.05, 8.2, 12, 'truck', 53.95, 1.95, 3.3, 'z');
  // NE strip: rooftop-sized AC units, barriers.
  k.slab(51, 0, -28.75, 54.6, 2.4, -23.1, 'steel');
  k.cyl(0.7, 0.3, 10, 'dark', 52.8, 2.55, -27.2, 'y', false);
  k.cyl(0.7, 0.3, 10, 'dark', 52.8, 2.55, -24.6, 'y', false);
  k.slab(51.4, 0, -30.3, 53.3, 1.2, -29.4, 'steel');
  k.slab(49.6, 0, -36.4, 52, 2.0, -32.5, 'steel');
  k.slab(48.6, 0, -21.9, 54.9, 0.9, -21.25, 'barrier');
  k.slab(54.3, 0, -17.8, 57, 1.0, -16.6, 'steel');
  k.slab(54.3, 0, -15.3, 57.4, 1.0, -14, 'steel');
  k.slab(46.8, 0, -17.4, 49.6, 0.9, -16.4, 'barrier', { ry: 0.4 });
  // Cones and lamp poles.
  for (const [x, z] of [[24, 4], [24.8, 4.6], [12, 24], [40, -12], [9, -1]] as const) k.cyl(0.18, 0.7, 6, 'hazard', x, 0.35, z, 'y', false);
  k.lampPole(30.7, 2.8, 9, 0, 1, 'steel', 'lamp', [1.6, 1.3, 0.9], 20);
  k.lampPole(13, 26.8, 9, 0, -1, 'steel', 'lamp', [1.6, 1.3, 0.9], 20);
  k.lampPole(48, -20.6, 9, 0, 1, 'steel', 'lamp', [1.6, 1.3, 0.9], 20);

  // ----- concourse lights -----
  for (const [x, z] of [[-48, 4], [-38, -3], [-38, 10], [-26, 8], [-23, -14], [-22, 22], [-20, 34], [-38, 21], [-8, 22], [-4, 32], [2, -8], [2, 5], [2, 20], [-12, -27], [-3, -22], [5, -31], [8, -18], [15, -18]] as const) {
    k.trim(x - 0.6, RF - 0.08, z - 0.3, x + 0.6, RF, z + 0.3, 'lamp');
    k.light(x, RF - 0.7, z, [1.25, 1.2, 1.05], 11, 'terminal');
  }

  // =============================================================================================
  // Spawns, objectives, hotspots
  // =============================================================================================
  const at = (x: number, z: number, y: number, tx: number, tz: number) => spawnAt(x, z, yawTowards(x, z, tx, tz), y);
  // Team 0: behind Security (the west vestibule), facing east down the lanes.
  const team0: SpawnPoint[] = [
    at(-55.5, 1, U, -40, 1),
    at(-55.5, 4.3, U, -40, 4.3),
    at(-55.5, 7.6, U, -40, 7.6),
    at(-53, 2.6, U, -40, 2.6),
    at(-53, 6, U, -40, 6),
    at(-49, -6.2, U, -30, -6.2),
    at(-49, -2.4, U, -30, -2.4),
    at(-48.5, 5.0, U, -30, 5.0),
    at(-49, 10, U, -30, 10),
    at(-48.5, 14.1, U, -30, 14.1),
  ];
  // Team 1: the Lower Lounge, facing the escalators.
  const team1: SpawnPoint[] = [
    at(30.5, -35.2, 0, 16, -27),
    at(33.2, -35.2, 0, 16, -27),
    at(37.5, -30.6, 0, 16, -27),
    at(40.8, -30.6, 0, 16, -27),
    at(40.8, -27.2, 0, 16, -27),
    at(40.8, -23.8, 0, 16, -27),
    at(34.5, -27.2, 0, 16, -27),
    at(35.5, -20.5, 0, 16, -27),
    at(29, -24.5, 0, 16, -27),
  ];
  const ffa: SpawnPoint[] = [
    at(-38, -6, U, -20, -6),
    at(-26, 10, U, -10, 20),
    at(-38, 21.5, U, -30, 21.5),
    at(-18, 37, U, -10, 30),
    at(-6, 34.5, U, -6, 28),
    at(2.4, 14, U, 2.4, 0),
    at(-24, -15, U, -24, -30),
    at(-10, -31.5, U, -1, -31.5),
    at(9.5, -34, U, 9.5, -20),
    at(21, -22, 0, 30, -22),
    at(9, -8, 0, 9, 0),
    at(14, -8, MR, 14, 0),
    at(12, 2, 0, 30, 2),
    at(24, 25, 0, 40, 25),
    at(48, 8, 0, 48, 20),
    at(46, -29, 0, 46, -15),
    at(38, -10, 0, 38, 2),
    at(35, 14.05, C, 22, 14.05),
    at(-44, 8.3, U, -30, 8.3),
  ];

  const sdAtt = team0.slice(0, 8);
  const sdDef = [team1[0]!, team1[2]!, team1[4]!, team1[5]!, team1[6]!, team1[7]!, team1[8]!, team1[1]!];

  return {
    id: 'terminal',
    name: 'Terminal',
    bounds: { min: { x: -58.5, y: -2, z: -39 }, max: { x: 59, y: 30, z: 41.5 } },
    materials: MATERIALS,
    brushes: k.brushes,
    decals: k.decals,
    props: k.props,
    lights: k.lights,
    spawns: { teams: [team0, team1], ffa },
    objectives: {
      // MW2: A in Shopping, B in the Hallway ("the middle hallway"), C in Dining by Burger Town.
      dom: [
        { id: 'A', x: -8, y: U, z: 24.5, radius: 3 },
        { id: 'B', x: 2.6, y: U, z: 6, radius: 2.6 },
        { id: 'C', x: -10, y: U, z: -31.5, radius: 3 },
      ],
      // Sites: A in the plane (aft of the evacuation exit), B in the Upper Lounge by the Hallway.
      sd: [
        { id: 'A', x: 31.5, y: C, z: 14.05, radius: 1.5, team: 1 },
        { id: 'B', x: 9.5, y: U, z: -19, radius: 2.2, team: 1 },
      ],
      sdBomb: [{ id: 'bomb', x: -50.5, y: U, z: 4.7, radius: 1, team: 0 }],
      hq: [
        { id: 'burgerTown', x: -25.5, y: U, z: -16.5, radius: 2.5 },
        { id: 'makeupStore', x: -6, y: U, z: 33.6, radius: 2.4 },
        { id: 'plane', x: 37, y: C, z: 14.05, radius: 1.6 },
        { id: 'lowerLounge', x: 31, y: 0, z: -25, radius: 3 },
        { id: 'bookstore', x: -7.4, y: U, z: 2.4, radius: 2.2 },
      ],
    },
    modeSpawns: { sd: { attackers: sdAtt, defenders: sdDef } },
    times: [
      { id: 'day', name: 'Afternoon', clock: '15:45', sky: 'term_skyDay', unlit: [1, 1, 1], skyRot: 0, sunDir: unitVec(0.45, 0.75, 0.5), sun: [1.05, 1.0, 0.92], amb: [0.5, 0.54, 0.6], fog: [0.72, 0.78, 0.86], fogNear: 40, fogFar: 170, lights: { terminal: 0.8 }, glow: 0 },
      { id: 'overcast', name: 'Overcast', clock: '11:30', sky: 'skyGrey', unlit: [1, 1, 1], skyRot: 0, sunDir: unitVec(0.35, 0.85, 0.4), sun: [0.5, 0.5, 0.48], amb: [0.58, 0.6, 0.64], fog: [0.66, 0.68, 0.71], fogNear: 34, fogFar: 150, lights: { terminal: 1 }, glow: 0.3 },
      { id: 'dusk', name: 'Dusk', clock: '19:20', sky: 'skyDusk', unlit: [1, 0.86, 0.76], skyRot: PI / 2, sunDir: unitVec(-0.85, 0.42, 0.1), sun: [1.1, 0.64, 0.4], amb: [0.3, 0.25, 0.36], fog: [0.8, 0.5, 0.42], fogNear: 30, fogFar: 140, lights: { lamp: 0.8, terminal: 1, runway: 1 }, glow: 0.8 },
    ],
    defaultTime: 'day',
    hotspots: [
      { x: -40, y: U, z: -2 }, // Security lanes
      { x: -22, y: U, z: 9 }, // departure hall
      { x: -22, y: U, z: 25 }, // Shopping atrium
      { x: -38, y: U, z: 21.5 }, // airline office
      { x: -6, y: U, z: 23 }, // Shopping south
      { x: -7, y: U, z: 34 }, // Makeup Store
      { x: -7.4, y: U, z: 2.4 }, // Bookstore
      { x: 2.4, y: U, z: 6 }, // Hallway
      { x: -25, y: U, z: -16 }, // Burger Town / gift shop
      { x: -10, y: U, z: -31.5 }, // Dining
      { x: 9.5, y: U, z: -19 }, // Upper Lounge
      { x: 29, y: 0, z: -24.5 }, // Lower Lounge
      { x: 14, y: MR, z: -8 }, // Maintenance roof
      { x: 9, y: 0, z: -8 }, // Maintenance
      { x: 13, y: 3.6, z: 20.2 }, // jet bridge
      { x: 37, y: C, z: 14.05 }, // plane cabin
      { x: 12, y: 0, z: 3 }, // apron under the Hallway
      { x: 26, y: 0, z: 24 }, // apron south
      { x: 40, y: 0, z: -4 }, // apron north
      { x: 47, y: 0, z: -28 }, // NE strip
    ],
  };
}
