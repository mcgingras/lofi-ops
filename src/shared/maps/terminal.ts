/**
 * Terminal (inspired by a compact section of MW2's "Terminal"): the gate level of an airport
 * terminal (raised 3 m over the apron) with the bookstore, a food counter and gate seating, big
 * windows over the tarmac, a jet bridge out to an airliner parked on the apron (walk-through cabin,
 * rear airstair down to the tarmac), service ramps at both ends, ground vehicles and luggage.
 * About 72 x 50 m. Clear afternoon by default.
 *
 * Coordinates: x east, z south, y up; yaw 0 looks north (-z). Team 0 spawns in the terminal
 * (west), team 1 on the apron (south). S&D: team 1 defends the apron (`objectives.sd[].team = 1`).
 */
import { MapKit, spawnAt, yawTowards } from './mw2kit';
import { unitVec, type MapData, type MaterialDef, type SpawnPoint } from './types';

const PI = Math.PI;

const MATERIALS: Record<string, MaterialDef> = {
  tarmac: { texture: 'term_apron', uvMul: [1 / 5, 1 / 5] },
  paint: { texture: 'paint', uvMul: [2, 2] },
  facade: { texture: 'term_facade', uvMul: [1 / 4, 1 / 4] },
  floor: { texture: 'term_floor', uvMul: [1 / 2.4, 1 / 2.4] },
  wall: { texture: 'term_wall', uvMul: [1 / 3, 1 / 3] },
  ceiling: { texture: 'term_wall', uvMul: [1 / 2, 1 / 2], tint: 0xc8c8c4 },
  pillar: { texture: 'term_facade', uvMul: [1 / 2, 1 / 2], tint: 0xe0dcd4 },
  carpet: { texture: 'scrap_carpet', uvMul: [1 / 2, 1 / 2] },
  seat: { texture: 'scrap_seat', uvMul: [1 / 0.6, 1 / 0.6] },
  books: { texture: 'term_books', uvMul: [1 / 1.6, 1 / 1.9] },
  counter: { texture: 'term_counter', uvMul: [1 / 2, 1 / 1.1] },
  signBooks: { texture: 'term_signBooks', emissive: 0.8 },
  signGate: { texture: 'term_signGate', emissive: 0.8 },
  signFood: { texture: 'term_signFood', emissive: 0.8 },
  jet: { texture: 'term_jet', uvMul: [1 / 4, 1 / 3] },
  alu: { texture: 'scrap_alu', uvMul: [1 / 2, 1 / 2], tint: 0xe4e6ea },
  cabin: { texture: 'scrap_cabin', uvMul: [1 / 2, 1 / 2] },
  cockpit: { texture: 'scrap_cockpit' },
  engine: { texture: 'scrap_alu', uvMul: [2, 1], tint: 0x9a9ea6 },
  bridge: { texture: 'term_bridge', uvMul: [1 / 3, 1 / 2.4] },
  blast: { texture: 'term_blast', uvMul: [1 / 3, 1 / 3] },
  truck: { texture: 'term_truck', uvMul: [1 / 4, 1 / 2.6] },
  uld: { texture: 'scrap_alu', uvMul: [1 / 1.6, 1 / 1.6], tint: 0xc8ccd2 },
  stairs: { texture: 'rust_stairs', uvMul: [1 / 1.2, 1 / 1.2], tint: 0xb0b4b8 },
  rail: { texture: 'rust_rail', uvMul: [1 / 1.2, 1], side: 'double', tint: 0xa0a8b0 },
  steel: { texture: 'steel' },
  rubber: { texture: 'rubber', uvMul: [1 / 0.4, 1 / 0.4] },
  yellow: { texture: 'yellow', uvMul: [1 / 0.8, 1 / 0.8] },
  hazard: { texture: 'hazard', uvMul: [1 / 0.6, 1 / 0.6] },
  lamp: { texture: 'lamp', emissive: 1 },
  fence: { texture: 'fence', side: 'double' },
  crate: { texture: 'crate', uvMul: [1 / 1.2, 1 / 1.2] },
  clip: { texture: 'none' },
};

/** Floor heights. */
export const TERMINAL_LEVELS = { gate: 3.0 } as const;

export function buildTerminal(): MapData {
  const k = new MapKit();
  const G = TERMINAL_LEVELS.gate;
  const ceil = 7.5;

  // ----- apron and edges -----
  k.slab(-70, -1, -70, 70, 0, 70, 'tarmac', { hide: ['nx', 'px', 'ny', 'nz', 'pz'] });
  for (let x = -30; x <= 30; x += 4) k.decals.push({ kind: 'flat', w: 2.2, h: 0.2, x, y: 0.02, z: 12.2, mat: 'paint', seg: 1 });
  k.decals.push({ kind: 'flat', w: 0.25, h: 20, x: -24, y: 0.02, z: 16, mat: 'paint', seg: 1 });
  k.decals.push({ kind: 'flat', w: 40, h: 0.25, x: -6, y: 0.02, z: 20.2, mat: 'paint', seg: 1 });
  k.perimeter(-36, 36, -24.2, 26, -1, 20);
  k.wall('x', -36.4, 36.4, 26.2, 0, 3.2, 0.4, 'blast');
  k.fence('z', 4.2, 26, -36.1, 0, 3, 'fence', 'steel', 20);
  k.fence('z', 4.2, 26, 36.1, 0, 3, 'fence', 'steel', 20);
  // Dead strips behind the terminal's end walls.
  k.playerClip(-36, -1, -24.2, -34.2, 20, 4.2);
  k.playerClip(34.2, -1, -24.2, 36, 20, 4.2);
  // Scenery: control tower, a second terminal pier, runway lights.
  k.trim(52, 0, -18, 56, 26, -14, 'facade');
  k.trim(50.5, 26, -19.5, 57.5, 30, -12.5, 'bridge');
  k.trim(-80, 0, -30, -40, 9, -20, 'facade');
  for (let x = -60; x <= 60; x += 8) k.glow(x, 0.3, 46, [1, 0.8, 0.4], 1.2, 'runway');

  // ----- terminal building: solid plinth, gate level at 3 m -----
  const tx0 = -34;
  const tx1 = 34;
  const tz0 = -24;
  const tz1 = 4;
  const wt = 0.4;
  k.slab(tx0, 0, tz0, tx1, G, tz1 + 0.2, 'facade', { faceMats: { py: 'floor' } });
  k.decals.push({ kind: 'flat', w: 20, h: 5, x: -14, y: G + 0.01, z: -1.6, mat: 'carpet' });
  k.decals.push({ kind: 'flat', w: 16, h: 5, x: 16, y: G + 0.01, z: -1.6, mat: 'carpet' });
  // South wall: windows over the apron, a door to the west landing, the jet bridge door, the east service opening.
  k.wall('x', tx0, tx1, tz1, 0, ceil + 0.4, wt, 'facade', [
    [-32, -30, G, 5.3],
    [-27, -21, G + 0.9, 6.6],
    [-19, -13, G + 0.9, 6.6],
    [-11, -5, G + 0.9, 6.6],
    [-3, 1.2, G + 0.9, 6.6],
    [1.8, 3.6, G, 5.3],
    [5, 11, G + 0.9, 6.6],
    [13, 19, G + 0.9, 6.6],
    [21, 26, G + 0.9, 6.6],
    [28, 31, G, 5.6],
  ], { faceMats: { nz: 'wall' } });
  k.wall('x', tx0 - wt / 2, tx1 + wt / 2, tz0, 0, ceil + 0.4, wt, 'facade', [], { faceMats: { pz: 'wall' } });
  k.wall('z', tz0, tz1, tx0, 0, ceil + 0.4, wt, 'facade', [], { faceMats: { px: 'wall' } });
  k.wall('z', tz0, tz1, tx1, 0, ceil + 0.4, wt, 'facade', [], { faceMats: { nx: 'wall' } });
  k.slab(tx0 - 0.4, ceil, tz0 - 0.4, tx1 + 0.4, ceil + 0.4, tz1 + 0.6, 'facade', { faceMats: { ny: 'ceiling' } });
  for (const x of [-28, -20, -4, 4, 12, 20, 28]) k.slab(x - 0.3, G, -8.3, x + 0.3, ceil, -7.7, 'pillar');
  for (let x = -28; x <= 28; x += 8)
    for (const z of [-18, -4]) {
      k.trim(x - 0.6, ceil - 0.08, z - 0.3, x + 0.6, ceil, z + 0.3, 'lamp');
      k.light(x, ceil - 0.6, z, [1.25, 1.2, 1.05], 11, 'terminal');
    }
  // Bookstore (north-west): its own walls and ceiling, shelves, a till.
  const bx0 = -16;
  const bx1 = -6;
  const bz0 = -20;
  const bz1 = -12;
  const bh = G + 3;
  k.wall('x', bx0, bx1, bz1, G, bh, 0.2, 'wall', [[-15.4, -12.6, G + 0.8, G + 2.4], [-12, -10, G, G + 2.2], [-9.4, -6.6, G + 0.8, G + 2.4]]);
  k.wall('x', bx0, bx1, bz0, G, bh, 0.2, 'wall');
  k.wall('z', bz0 + 0.1, bz1 - 0.1, bx0, G, bh, 0.2, 'wall', [[-17.5, -14.5, G + 0.8, G + 2.4]]);
  k.wall('z', bz0 + 0.1, bz1 - 0.1, bx1, G, bh, 0.2, 'wall', [[-17, -15.4, G, G + 2.2]]);
  k.slab(bx0 - 0.1, bh, bz0 - 0.1, bx1 + 0.1, bh + 0.2, bz1 + 0.1, 'ceiling');
  k.decals.push({ kind: 'wall', w: 3, h: 0.6, x: -11, y: bh - 0.7, z: bz1 + 0.11, mat: 'signBooks', uv: 'raw' });
  k.slab(-15.6, G, -19.8, -8.6, G + 1.9, -19.3, 'books');
  k.slab(-15, G, -17.8, -10.4, G + 1.6, -17.2, 'books');
  k.slab(-15, G, -15.6, -12.6, G + 1.4, -15, 'books');
  k.slab(-8.6, G, -14.6, -6.3, G + 1.1, -13.6, 'counter');
  k.light(-11, bh - 0.4, -16, [1.3, 1.15, 0.9], 7, 'terminal');
  // Food counter (north-east) and the gate desk by the jet bridge.
  k.slab(8, G, -19.2, 16, G + 1.1, -18.2, 'counter');
  k.slab(7.6, G, -23.6, 16.4, G + 2.6, -23.2, 'counter');
  k.decals.push({ kind: 'wall', w: 4, h: 0.8, x: 12, y: G + 3, z: -23.58, mat: 'signFood', uv: 'raw' });
  k.slab(-0.6, G, 0.2, 4.4, G + 1.1, 1.2, 'counter');
  k.decals.push({ kind: 'wall', w: 3.2, h: 0.8, x: 2.7, y: G + 3.2, z: 3.79, ry: PI, mat: 'signGate', uv: 'raw' });
  // Gate seating rows (knee-high: hop over or go round).
  for (const [x0, x1] of [[-25, -19], [-17, -11], [-9, -5], [8, 14], [16, 22]] as const)
    for (const z of [-3.4, -0.8]) k.slab(x0, G, z, x1, G + 0.5, z + 0.6, 'seat');

  // West landing + stair ramp down to the apron; east service ramp.
  k.slab(-33, 0, tz1 + 0.2, -28, G, 6.4, 'facade', { faceMats: { py: 'floor' } });
  k.ramp(-28, 0, tz1 + 0.2, -20, G, 5.6, '-x', 'stairs', { tag: 'stairs' });
  k.rail('x', -33, -28, 6.36, G, 'rail', 'steel');
  k.ramp(28, 0, tz1 + 0.2, 31, G, 12.2, '-z', 'stairs', { tag: 'stairs' });

  // ----- jet bridge -----
  k.slab(1.6, G - 0.2, tz1 + 0.2, 3.8, G, 14, 'bridge', { faceMats: { py: 'carpet' } });
  k.wall('z', tz1 + 0.2, 14, 1.6, G, 5.4, 0.2, 'bridge', [[6, 8.5, G + 1, G + 2], [9.5, 12, G + 1, G + 2]]);
  k.wall('z', tz1 + 0.2, 14, 3.8, G, 5.4, 0.2, 'bridge', [[6, 8.5, G + 1, G + 2], [9.5, 12, G + 1, G + 2]]);
  k.slab(1.5, 5.4, tz1 + 0.2, 3.9, 5.6, 14, 'bridge');
  k.slab(2.45, 0, 8.75, 2.95, G - 0.2, 9.25, 'steel');
  k.trim(1.9, 0, 8.4, 3.5, 0.6, 9.6, 'yellow');

  // ----- the airliner (walk-through cabin at gate height) -----
  const px0 = -22;
  const px1 = 6;
  const pz0 = 14;
  const pz1 = 18.4;
  const ptop = 6;
  k.slab(px0 - 0.3, 1.6, pz0, px1 + 0.3, G, pz1, 'alu', { faceMats: { py: 'carpet' } });
  k.wall('x', px0 - 0.3, px1 + 0.3, pz0 + 0.15, G, ptop, 0.3, 'jet', [[1.8, 3.6, G, 5.3]], { faceMats: { pz: 'cabin' } });
  k.wall('x', px0 - 0.3, px1 + 0.3, pz1 - 0.15, G, ptop, 0.3, 'jet', [[-19, -17.4, G, 5.3]], { faceMats: { nz: 'cabin' } });
  k.wall('z', pz0 + 0.3, pz1 - 0.3, px0 - 0.15, G, ptop, 0.3, 'alu', [], { faceMats: { px: 'cabin' } });
  k.wall('z', pz0 + 0.3, pz1 - 0.3, px1 + 0.15, G, ptop, 0.3, 'alu', [], { faceMats: { nx: 'cabin' } });
  k.slab(px0 - 0.3, ptop, pz0, px1 + 0.3, ptop + 0.4, pz1, 'alu', { faceMats: { ny: 'cabin' } });
  k.trim(px0, ptop + 0.4, pz0 + 0.8, px1, ptop + 0.7, pz1 - 0.8, 'alu');
  // Nose, cockpit glazing, tail.
  k.slab(px1 + 0.3, 2.0, pz0 + 0.6, px1 + 3, 5.6, pz1 - 0.6, 'alu');
  k.trim(px1 + 3, 2.6, pz0 + 1.2, px1 + 4.2, 4.8, pz1 - 1.2, 'alu');
  k.decals.push({ kind: 'wall', w: 2.2, h: 0.7, x: px1 + 1.7, y: 4.6, z: pz1 - 0.59, mat: 'cockpit', uv: 'raw' });
  k.decals.push({ kind: 'wall', w: 2.2, h: 0.7, x: px1 + 1.7, y: 4.6, z: pz0 + 0.59, ry: PI, mat: 'cockpit', uv: 'raw' });
  k.trim(px0 - 0.3, ptop + 0.4, 16.05, px0 + 4, 13, 16.35, 'jet');
  k.trim(px0 - 0.3, ptop + 0.2, 11, px0 + 2.6, ptop + 0.4, 21.4, 'alu');
  // Wings (overhead: walk under them), engines, landing gear.
  k.slab(-13, 2.0, pz1, -3, 2.25, 25.5, 'alu');
  k.slab(-13, 2.0, 7, -3, 2.25, pz0, 'alu');
  k.cyl(0.95, 3.4, 12, 'engine', -8, 1.1, 21.6, 'x');
  k.cyl(0.95, 3.4, 12, 'engine', -8, 1.1, 10.8, 'x');
  for (const [x, z] of [[2, 16.2], [-10, 15.2], [-10, 17.2]] as const) {
    k.slab(x - 0.2, 0, z - 0.2, x + 0.2, 1.6, z + 0.2, 'steel');
    k.cyl(0.45, 0.4, 8, 'rubber', x, 0.45, z - 0.45, 'z', false);
    k.cyl(0.45, 0.4, 8, 'rubber', x, 0.45, z + 0.45, 'z', false);
  }
  // Cabin seats (aisle down the middle, gaps at both doors).
  for (let x = px0 + 0.9; x < px1 - 0.8; x += 1.1) {
    if (x + 0.6 < -19.4 || x > -17) k.slab(x, G, pz1 - 1.4, x + 0.6, G + 0.55, pz1 - 0.4, 'seat');
    if (x + 0.6 < 1.4 || x > 4) k.slab(x, G, pz0 + 0.4, x + 0.6, G + 0.55, pz0 + 1.4, 'seat');
  }
  for (const x of [-16, -6, 2]) k.light(x, ptop - 0.4, 16.2, [1.0, 0.95, 0.85], 6, 'terminal');
  // Rear airstair down to the apron.
  k.ramp(-19, 0, pz1, -17.4, G, 24.4, '-z', 'stairs', { tag: 'stairs' });

  // ----- apron clutter -----
  k.slab(16, 0, 8, 24, 2.6, 10.4, 'truck');
  k.cyl(1.1, 5, 10, 'truck', 19.2, 2.4, 9.2, 'x', false);
  k.slab(-30, 0, 8, -27, 1.4, 9.6, 'yellow');
  k.slab(10, 0, 20, 13, 1.4, 21.4, 'yellow');
  k.slab(20, 0, 18, 22, 1.3, 19.6, 'yellow');
  const ulds: [number, number][] = [[-2, 20], [-0.2, 20.6], [26, 14], [27.8, 14.2], [-30, 12]];
  for (const [x, z] of ulds) k.slab(x - 0.8, 0, z - 0.8, x + 0.8, 1.6, z + 0.8, 'uld');
  for (const [x, z] of [[6, 10], [6, 12], [-24, 12], [14, 16]] as const) k.cyl(0.18, 0.7, 6, 'hazard', x, 0.35, z, 'y', false);
  k.slab(-34, 0, 22, -31, 1.2, 23.2, 'crate', { uv: 'raw' });
  for (const [x, z] of [[-14, 24.5], [14, 24.5]] as const) k.lampPole(x, z, 8, 0, -1, 'steel', 'lamp', [1.6, 1.3, 0.9], 18);

  // ----- spawns, objectives -----
  const face = (x: number, z: number, y = 0, tx = 0, tz = 8) => spawnAt(x, z, yawTowards(x, z, tx, tz), y);
  const team0: SpawnPoint[] = [face(-30, -20, G), face(-26, -20, G), face(-22, -20, G), face(-30, -14, G), face(-24, -14, G), face(-30, -8, G), face(-24, -10, G), face(-20, -12, G)];
  const team1: SpawnPoint[] = [face(-28, 23), face(-24, 24), face(-2, 24), face(4, 24), face(10, 24), face(16, 24), face(22, 24), face(28, 22), face(31, 16)];
  const ffa: SpawnPoint[] = [face(-12, -6, G), face(0, -12, G), face(10, -8, G), face(20, -14, G), face(28, -20, G), face(-4, -20, G), face(24, -1.5, G), face(-30, 15), face(-14, 10), face(12, 14), face(25, 6), face(0, 24), face(8, 12), face(-8, 16.2, G, 0, 16.2), face(-11, -16, G)];

  return {
    id: 'terminal',
    name: 'Terminal',
    bounds: { min: { x: -37, y: -2, z: -25 }, max: { x: 37, y: 30, z: 27 } },
    materials: MATERIALS,
    brushes: k.brushes,
    decals: k.decals,
    props: k.props,
    lights: k.lights,
    spawns: { teams: [team0, team1], ffa },
    objectives: {
      dom: [
        { id: 'A', x: -22, y: G, z: -6, radius: 3 },
        { id: 'B', x: -1, y: 0, z: 9.5, radius: 3 },
        { id: 'C', x: 16, y: 0, z: 20.5, radius: 3 },
      ],
      sd: [
        { id: 'A', x: -27, y: 0, z: 19, radius: 2.2, team: 1 },
        { id: 'B', x: 22, y: 0, z: 12.5, radius: 2.2, team: 1 },
      ],
      sdBomb: [{ id: 'bomb', x: -27, y: G, z: -17, radius: 1, team: 0 }],
      hq: [
        { id: 'bookstore', x: -11, y: G, z: -16, radius: 2.2 },
        { id: 'gate', x: 8, y: G, z: -5, radius: 3 },
        { id: 'cabin', x: -6, y: G, z: 16.2, radius: 1.6 },
        { id: 'apronEast', x: 26, y: 0, z: 8, radius: 3 },
        { id: 'apronWest', x: -26, y: 0, z: 12, radius: 3 },
      ],
    },
    times: [
      { id: 'day', name: 'Afternoon', clock: '15:45', sky: 'term_skyDay', unlit: [1, 1, 1], skyRot: 0, sunDir: unitVec(0.45, 0.75, 0.5), sun: [1.05, 1.0, 0.92], amb: [0.5, 0.54, 0.6], fog: [0.72, 0.78, 0.86], fogNear: 30, fogFar: 140, lights: { terminal: 0.8 }, glow: 0 },
      { id: 'overcast', name: 'Overcast', clock: '11:30', sky: 'skyGrey', unlit: [1, 1, 1], skyRot: 0, sunDir: unitVec(0.35, 0.85, 0.4), sun: [0.5, 0.5, 0.48], amb: [0.58, 0.6, 0.64], fog: [0.66, 0.68, 0.71], fogNear: 26, fogFar: 120, lights: { terminal: 1 }, glow: 0.3 },
      { id: 'dusk', name: 'Dusk', clock: '19:20', sky: 'skyDusk', unlit: [1, 0.86, 0.76], skyRot: PI / 2, sunDir: unitVec(-0.85, 0.42, 0.1), sun: [1.1, 0.64, 0.4], amb: [0.3, 0.25, 0.36], fog: [0.8, 0.5, 0.42], fogNear: 24, fogFar: 110, lights: { lamp: 0.8, terminal: 1, runway: 1 }, glow: 0.8 },
    ],
    defaultTime: 'day',
    hotspots: [
      { x: 2, y: G, z: -3 },
      { x: -11, y: G, z: -16 },
      { x: 12, y: G, z: -14 },
      { x: -30.5, y: G, z: 5.3 },
      { x: -6, y: G, z: 16.2 },
      { x: 2.7, y: G, z: 9 },
      { x: 24, y: 0, z: 16 },
      { x: -28, y: 0, z: 16 },
      { x: -8, y: 0, z: 13 },
      { x: 29.5, y: 0, z: 14 },
    ],
  };
}
