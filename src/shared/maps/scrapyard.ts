/**
 * Scrapyard (inspired by MW2's "Scrapyard"): an aircraft boneyard. The big hangar to the north
 * has catwalks along both walls joined by a bridge (stairs up each side), the wrecked airliner
 * fuselage to the south-west is walk-through (open front, a back door by the tail and two hull
 * breaches), a broken-off nose section to the south-east doubles as a perch, containers and
 * trailers break up the yard, and a container stack to the east gives a sniper roost.
 * About 88 x 76 m. Overcast by default.
 *
 * Coordinates: x east, z south, y up; yaw 0 looks north (-z). Team 0 spawns west, team 1 east.
 * Search and Destroy: team 1 defends (`objectives.sd[].team = 1`), the bomb is at `sdBomb`.
 */
import { MapKit, spawnAt, yawTowards } from './mw2kit';
import { unitVec, type MapData, type MaterialDef, type SpawnPoint } from './types';

const PI = Math.PI;

const MATERIALS: Record<string, MaterialDef> = {
  ground: { texture: 'scrap_ground', uvMul: [1 / 6, 1 / 6] },
  asphalt: { texture: 'scrap_asphalt', uvMul: [1 / 6, 1 / 6] },
  paint: { texture: 'paint', uvMul: [2, 2] },
  hangar: { texture: 'scrap_hangar', uvMul: [1 / 4, 1 / 4] },
  roof: { texture: 'scrap_hangar', uvMul: [1 / 4, 1 / 4], tint: 0x9a9a9a },
  floor: { texture: 'scrap_concrete', uvMul: [1 / 4, 1 / 4] },
  grate: { texture: 'scrap_grate', uvMul: [1 / 1.5, 1 / 1.5] },
  stairs: { texture: 'rust_stairs', uvMul: [1 / 1.2, 1 / 1.2], tint: 0xa8b0b8 },
  rail: { texture: 'rust_rail', uvMul: [1 / 1.2, 1], side: 'double', tint: 0x9aa4ae },
  beam: { texture: 'steel', uvMul: [1 / 1.5, 1 / 1.5] },
  fuse: { texture: 'scrap_fuse', uvMul: [1 / 4, 1 / 4] },
  alu: { texture: 'scrap_alu', uvMul: [1 / 2, 1 / 2] },
  cabin: { texture: 'scrap_cabin', uvMul: [1 / 2, 1 / 2] },
  carpet: { texture: 'scrap_carpet', uvMul: [1 / 2, 1 / 2] },
  seat: { texture: 'scrap_seat', uvMul: [1 / 0.6, 1 / 0.6] },
  cockpit: { texture: 'scrap_cockpit' },
  junk: { texture: 'scrap_junk', uvMul: [1 / 3, 1 / 3] },
  wall: { texture: 'scrap_wall', uvMul: [1 / 3, 1 / 4] },
  trailer: { texture: 'scrap_trailer', uvMul: [1 / 6, 1 / 3.8] },
  engine: { texture: 'scrap_alu', uvMul: [2, 1], tint: 0x8a8e94 },
  fence: { texture: 'fence', side: 'double' },
  steel: { texture: 'steel' },
  lamp: { texture: 'lamp', emissive: 1 },
  winRow: { texture: 'winRow', emissive: 1 },
  hazard: { texture: 'hazard', uvMul: [1 / 0.6, 1 / 0.6] },
  container0: { texture: 'container0', uvMul: [1 / 6.1, 1 / 2.6] },
  container1: { texture: 'container1', uvMul: [1 / 6.1, 1 / 2.6] },
  container2: { texture: 'container2', uvMul: [1 / 6.1, 1 / 2.6] },
  container3: { texture: 'container3', uvMul: [1 / 6.1, 1 / 2.6] },
  container4: { texture: 'container4', uvMul: [1 / 6.1, 1 / 2.6] },
  container5: { texture: 'container5', uvMul: [1 / 6.1, 1 / 2.6] },
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
export const SCRAPYARD_LEVELS = { catwalk: 3.6, fuselage: 0.8, nose: 3.4, container: 2.6 } as const;

export function buildScrapyard(): MapData {
  const k = new MapKit();
  const { catwalk, fuselage: fl, nose } = SCRAPYARD_LEVELS;

  // ----- ground, perimeter -----
  k.slab(-70, -1, -70, 70, 0, 70, 'ground', { hide: ['nx', 'px', 'ny', 'nz', 'pz'] });
  k.decals.push({ kind: 'flat', w: 88, h: 6, x: 0, y: 0.015, z: 2.5, mat: 'asphalt' });
  for (let x = -40; x <= 40; x += 6) k.decals.push({ kind: 'flat', w: 3, h: 0.2, x, y: 0.025, z: 2.5, mat: 'paint', seg: 1 });
  k.perimeter(-44, 44, -38, 38, -1, 20);
  // Corrugated boundary walls (east side has a fence section looking out over more wrecks).
  k.wall('x', -44.4, 44.4, -38.2, 0, 4, 0.4, 'wall');
  k.wall('x', -44.4, 44.4, 38.2, 0, 4, 0.4, 'wall');
  k.wall('z', -38, 38, -44.2, 0, 4, 0.4, 'wall');
  k.wall('z', -38, -10, 44.2, 0, 4, 0.4, 'wall');
  k.wall('z', 20, 38, 44.2, 0, 4, 0.4, 'wall');
  k.fence('z', -10, 20, 44.1, 0, 3.2, 'fence', 'steel', 20);
  // Junk piles in two corners (walkable slopes of scrap).
  k.ramp(36, 0, -38, 44, 3.2, -30, '+x', 'junk');
  k.ramp(-44, 0, 30, -36, 3.2, 38, '-x', 'junk');
  // Wrecks beyond the fence (scenery).
  k.trim(52, 0.6, -4, 76, 4.4, 0, 'fuse');
  k.trim(66, 4.4, -2.2, 69, 10, -1.8, 'alu');
  k.trim(54, 1.2, 10, 60, 1.6, 22, 'alu');
  k.trim(50, 0, 26, 74, 3.8, 30, 'fuse');

  // ----- hangar (north) -----
  const hy = 9;
  k.wall('x', -14, 14, -8.2, 0, hy, 0.4, 'hangar', [[-6, 6, 0, 6], [9, 10.4, 0, 2.4]]); // south: main door
  k.wall('x', -14, 14, -27.8, 0, hy, 0.4, 'hangar', [[-3, 3, 0, 4.5], [-11, -7, 5.4, 6.6], [7, 11, 5.4, 6.6]]); // north
  k.wall('z', -27.6, -8.4, -13.8, 0, hy, 0.4, 'hangar', [[-14, -12.4, 0, 2.4], [-24, -20, 4.4, 5.6]]); // west
  k.wall('z', -27.6, -8.4, 13.8, 0, hy, 0.4, 'hangar', [[-20, -18.4, 0, 2.4], [-16, -12, 4.4, 5.6]]); // east
  k.slab(-14.4, hy, -28.4, 14.4, hy + 0.4, -7.6, 'roof');
  k.trim(-14.6, hy + 0.4, -18.4, 14.6, hy + 1.2, -17.2, 'roof');
  k.decals.push({ kind: 'flat', w: 27.2, h: 19.2, x: 0, y: 0.02, z: -18, mat: 'floor' });
  k.decals.push({ kind: 'wall', w: 12.4, h: 0.4, x: 0, y: 6, z: -7.98, mat: 'hazard' });
  for (let x = -12; x <= 12; x += 4.8) k.decals.push({ kind: 'wall', w: 2.2, h: 0.9, x, y: 7.2, z: -7.98, mat: 'winRow', uv: 'raw' });
  // Catwalks along the side walls and a bridge across the north end.
  const ct = 0.2;
  k.slab(-13.6, catwalk - ct, -27.6, -11.4, catwalk, -8.4, 'grate');
  k.slab(11.4, catwalk - ct, -27.6, 13.6, catwalk, -8.4, 'grate');
  k.slab(-11.4, catwalk - ct, -27.6, 11.4, catwalk, -25.6, 'grate');
  for (const z of [-24, -19, -14, -9.2]) {
    k.slab(-11.6, 0, z - 0.1, -11.4, catwalk - ct, z + 0.1, 'beam');
    k.slab(11.4, 0, z - 0.1, 11.6, catwalk - ct, z + 0.1, 'beam');
  }
  for (const x of [-6, 0, 6]) k.slab(x - 0.1, 0, -25.8, x + 0.1, catwalk - ct, -25.6, 'beam');
  k.ramp(-11.4, 0, -17, -6.4, catwalk, -15.8, '-x', 'stairs', { tag: 'stairs' });
  k.ramp(6.4, 0, -23, 11.4, catwalk, -21.8, '+x', 'stairs', { tag: 'stairs' });
  k.rail('z', -25.6, -17, -11.4, catwalk, 'rail', 'beam');
  k.rail('z', -15.8, -8.4, -11.4, catwalk, 'rail', 'beam');
  k.rail('z', -25.6, -23, 11.4, catwalk, 'rail', 'beam');
  k.rail('z', -21.8, -8.4, 11.4, catwalk, 'rail', 'beam');
  k.rail('x', -11.4, 11.4, -25.6, catwalk, 'rail', 'beam');
  // Hangar contents: an engine on a stand, wing panel, crate stacks, a tug.
  k.cyl(1.1, 3.2, 12, 'engine', 3, 1.5, -21, 'x');
  k.slab(1.6, 0, -21.8, 4.4, 0.4, -20.2, 'yellow');
  k.slab(-9, 0, -23.4, -3, 0.9, -21.8, 'alu');
  const crates: [number, number, number][] = [[-4.2, -15.6, 0], [-3, -15.8, 0], [-3.6, -15.7, 1.2], [5.5, -12.5, 0], [6.7, -12.4, 0], [-8.5, -10.5, 0], [9, -26.6, 0], [10.2, -26.6, 0]];
  for (const [x, z, y] of crates) k.slab(x - 0.6, y, z - 0.6, x + 0.6, y + 1.2, z + 0.6, 'crate', { uv: 'raw' });
  k.slab(-1.2, 0, -12.8, 1.2, 1.3, -10.6, 'yellow');
  for (const [x, z] of [[-7, -13], [7, -13], [-7, -22], [7, -22], [0, -17.5]] as const) {
    k.trim(x - 0.4, hy - 1.6, z - 0.4, x + 0.4, hy - 1.4, z + 0.4, 'lamp');
    k.trim(x - 0.03, hy - 1.4, z - 0.03, x + 0.03, hy, z + 0.03, 'steel');
    k.light(x, hy - 2, z, [1.7, 1.62, 1.45], 18, 'hangar');
    k.glow(x, hy - 1.7, z, [0.6, 0.58, 0.5], 2.5, 'hangar');
  }

  // ----- the airliner fuselage (south-west), walk-through -----
  const fx0 = -36;
  const fx1 = -12;
  const fz0 = 17.8;
  const fz1 = 22.2;
  const ftop = 4.2;
  k.slab(fx0 - 0.4, 0, fz0, fx1, fl, fz1, 'alu', { faceMats: { py: 'carpet' } });
  k.wall('x', fx0, fx1, fz1 - 0.2, fl, ftop, 0.4, 'fuse', [[-26, -23, fl, 3.0]], { faceMats: { nz: 'cabin' } });
  k.wall('x', fx0, fx1, fz0 + 0.2, fl, ftop, 0.4, 'fuse', [[-20, -17.5, fl, 3.0]], { faceMats: { pz: 'cabin' } });
  k.wall('z', fz0, fz1, fx0 - 0.2, fl, ftop, 0.4, 'alu', [[19.2, 20.8, fl, 3.0]], { faceMats: { px: 'cabin' } });
  k.slab(fx0 - 0.4, ftop, fz0, fx1, ftop + 0.4, fz1, 'alu', { faceMats: { ny: 'cabin' } });
  k.trim(fx0, ftop + 0.4, fz0 + 0.8, fx1 - 0.6, ftop + 0.7, fz1 - 0.8, 'alu');
  // Torn front edge, tail fin and stabilisers.
  k.trim(fx1 - 0.3, ftop - 0.8, fz0 - 0.1, fx1 + 0.4, ftop + 0.3, fz0 + 1.2, 'alu');
  k.trim(fx1 - 0.3, fl, fz1 - 1.0, fx1 + 0.5, 2.0, fz1 + 0.1, 'alu');
  k.trim(fx0 - 0.3, ftop + 0.4, 19.85, fx0 + 3.4, 10, 20.15, 'alu');
  k.trim(fx0 - 0.2, ftop + 0.2, 15.6, fx0 + 2.6, ftop + 0.4, 24.4, 'alu');
  // Entry ramps (debris) at the open front, the tail door and the two breaches.
  k.ramp(fx1, 0, fz0 + 0.4, fx1 + 2, fl, fz1 - 0.4, '-x', 'junk');
  k.ramp(fx0 - 2.4, 0, 19.2, fx0 - 0.4, fl, 20.8, '+x', 'junk');
  k.ramp(-26, 0, fz1, -23, fl, fz1 + 2, '-z', 'junk');
  k.ramp(-20, 0, fz0 - 2, -17.5, fl, fz0, '+z', 'junk');
  // Seat rows either side of the aisle (gaps at the breaches).
  for (let x = fx0 + 1.2; x < fx1 - 1; x += 1.1) {
    if (x + 0.6 < -26.2 || x > -22.8) k.slab(x, fl, fz1 - 1.4, x + 0.6, fl + 0.55, fz1 - 0.4, 'seat');
    if (x + 0.6 < -20.2 || x > -17.3) k.slab(x, fl, fz0 + 0.4, x + 0.6, fl + 0.55, fz0 + 1.4, 'seat');
  }
  for (const x of [-32, -24, -16]) k.light(x, ftop - 0.4, 20, [0.9, 0.85, 0.7], 6, 'cabin');
  // Wing (south, sloping into the dirt) and engines.
  k.ramp(-33, 0, fz1, -28, 1.3, 30, '-z', 'alu', { faceMats: { ny: 'alu' } });
  k.cyl(0.95, 3.2, 10, 'engine', -22, 0.95, 30, 'x');
  k.cyl(0.95, 3.2, 10, 'engine', -38, 0.95, 10, 'z');
  k.slab(-30, 0, 11, -25, 0.35, 13.5, 'alu'); // broken wing panel (north side)

  // ----- nose section (south-east): climb the nose cone onto its roof -----
  k.slab(22, 0, 22, 29, nose, 26, 'fuse');
  k.ramp(29, 0, 22.4, 31.4, nose - 0.3, 25.6, '-x', 'alu');
  k.decals.push({ kind: 'wall', w: 2.6, h: 0.8, x: 28.2, y: 2.2, z: 26.01, mat: 'cockpit', uv: 'raw' });
  k.decals.push({ kind: 'wall', w: 2.6, h: 0.8, x: 28.2, y: 2.2, z: 21.99, ry: PI, mat: 'cockpit', uv: 'raw' });
  k.rail('x', 22, 28.6, 25.96, nose, 'rail', 'beam');
  k.rail('x', 22, 28.6, 22.04, nose, 'rail', 'beam');

  // ----- containers -----
  const cont = (x0: number, z0: number, alongX: boolean, lvl: number, t: number) => {
    const w = alongX ? 6.1 : 2.44;
    const d = alongX ? 2.44 : 6.1;
    k.slab(x0, lvl * 2.6, z0, x0 + w, lvl * 2.6 + 2.6, z0 + d, `container${t}`, { ry: alongX ? 0 : PI / 2 });
  };
  // East roost: ramp of scrap up onto c1, c2 + c3 stacked behind it.
  cont(32, -13, false, 0, 2);
  cont(34.44, -13, false, 0, 4);
  cont(34.44, -13, false, 1, 1);
  k.ramp(27, 0, -11, 32, 2.6, -9.8, '+x', 'junk');
  // North-east stack, west cover, mid-field singles, south-west pair.
  cont(20, -34, true, 0, 0);
  cont(20, -34, true, 1, 3);
  cont(27, -34, true, 0, 5);
  cont(-36.44, -24, false, 0, 3);
  cont(-36.44, -24, false, 1, 0);
  cont(-33, -30, true, 0, 1);
  cont(-6, 6, true, 0, 4);
  cont(8, 10, true, 0, 2);
  cont(-42, 26, true, 0, 5);
  cont(-8, 30, true, 0, 0);

  // ----- trailers -----
  const trailer = (x0: number, z0: number, x1: number, z1: number) => {
    k.slab(x0, 1.1, z0, x1, 3.9, z1, 'trailer');
    k.slab(x0 + 0.2, 0, z0 + 0.1, x1 - 0.2, 1.1, z1 - 0.1, 'rubber');
  };
  trailer(10, 30, 22, 32.5);
  trailer(-28, -34, -16, -31.5);

  // ----- small cover: crates, pallets, barrels -----
  const yard: [number, number, number][] = [[-20, -6, 0], [-21.2, -5.8, 0], [18, 2, 0], [19.2, 2.3, 0], [18.6, 2.1, 1.2], [-10, 20, 0], [2, 18, 0], [26, -20, 0], [-28, 4, 0], [30, 14, 0], [-2, -33, 0]];
  for (const [x, z, y] of yard) k.slab(x - 0.6, y, z - 0.6, x + 0.6, y + 1.2, z + 0.6, 'crate', { uv: 'raw', ry: y ? 0.25 : 0 });
  for (const [x, z] of [[12, -2], [-14, 4]] as const) for (let i = 0; i < 4; i++) k.slab(x - 0.6, i * 0.15, z - 0.5, x + 0.6, (i + 1) * 0.15, z + 0.5, 'pallet', { uv: 'raw' });
  const barrels: [number, number, string][] = [[16, -6, 'barrelRed'], [16.7, -6.5, 'barrelBlue'], [-24, -14, 'barrelYellow'], [24, 18, 'barrelRed'], [-4, 22, 'barrelBlue'], [36, 22, 'barrelYellow'], [-40, -30, 'barrelRed']];
  for (const [x, z, m] of barrels) k.cyl(0.32, 0.9, 8, m, x, 0.45, z);
  // Loose engine and gear on the field.
  k.cyl(0.95, 3, 10, 'engine', 8, 0.95, -2, 'z');
  k.slab(-17, 0, 26, -14, 0.9, 27, 'steel');

  // ----- lamps -----
  for (const [x, z, dx] of [[-26, -10, 0.9], [26, -6, -0.9], [-4, 14, 0.9], [20, 26, -0.9], [-34, 32, 0.9]] as const) k.lampPole(x, z, 7, dx, 0, 'steel', 'lamp', [1.6, 1.2, 0.75], 16);

  // ----- spawns, objectives -----
  const face = (x: number, z: number, tx = 0, tz = 0, y = 0) => spawnAt(x, z, yawTowards(x, z, tx, tz), y);
  const team0: SpawnPoint[] = [face(-40, -16), face(-40, -10), face(-40, -4), face(-40, 2), face(-40, 8), face(-37, -13), face(-37, -1), face(-37, 5), face(-41, 14)];
  const team1: SpawnPoint[] = [face(39, -4), face(39, 2), face(39, 8), face(39, 14), face(36, -1), face(36, 5), face(36, 11), face(41, -8), face(40, 18)];
  const ffa: SpawnPoint[] = [face(-20, -2), face(20, -1), face(0, 1), face(-26, 9), face(26, 12), face(0, 25), face(-31, -34), face(31, -26), face(-8, -32), face(6, -18), face(-8, 14), face(16, 20), face(-24, 20, 0, 20, fl), face(10, -32), face(-40, -26), face(40, 30), face(-26, 33)];

  return {
    id: 'scrapyard',
    name: 'Scrapyard',
    bounds: { min: { x: -45, y: -2, z: -39 }, max: { x: 45, y: 30, z: 39 } },
    materials: MATERIALS,
    brushes: k.brushes,
    decals: k.decals,
    props: k.props,
    lights: k.lights,
    spawns: { teams: [team0, team1], ffa },
    objectives: {
      dom: [
        { id: 'A', x: -30, y: 0, z: -6, radius: 3 },
        { id: 'B', x: 0, y: 0, z: -17, radius: 3 },
        { id: 'C', x: 30, y: 0, z: 4, radius: 3 },
      ],
      sd: [
        { id: 'A', x: 22, y: 0, z: -24, radius: 2.2, team: 1 },
        { id: 'B', x: 15, y: 0, z: 22, radius: 2.2, team: 1 },
      ],
      sdBomb: [{ id: 'bomb', x: -39, y: 0, z: -7, radius: 1, team: 0 }],
      hq: [
        { id: 'hangar', x: -4, y: 0, z: -13, radius: 3 },
        { id: 'fuselage', x: -27.5, y: fl, z: 20, radius: 1.6 },
        { id: 'yard', x: 24, y: 0, z: -2, radius: 3 },
        { id: 'northwest', x: -26, y: 0, z: -26, radius: 3 },
        { id: 'south', x: 6, y: 0, z: 22, radius: 3 },
      ],
    },
    times: [
      { id: 'overcast', name: 'Overcast', clock: '15:20', sky: 'skyGrey', unlit: [1, 1, 1], skyRot: 0, sunDir: unitVec(0.35, 0.85, 0.4), sun: [0.52, 0.52, 0.5], amb: [0.58, 0.6, 0.64], fog: [0.66, 0.68, 0.71], fogNear: 30, fogFar: 140, lights: { hangar: 0.9, cabin: 0.5 }, glow: 0.3 },
      { id: 'dusk', name: 'Dusk', clock: '19:10', sky: 'skyDusk', unlit: [1, 0.86, 0.76], skyRot: PI / 2, sunDir: unitVec(-0.85, 0.42, 0.1), sun: [1.1, 0.64, 0.4], amb: [0.3, 0.25, 0.36], fog: [0.8, 0.5, 0.42], fogNear: 24, fogFar: 110, lights: { lamp: 0.6, hangar: 1, cabin: 0.8 }, glow: 0.6 },
      { id: 'night', name: 'Night', clock: '23:50', sky: 'skyNight', unlit: [0.55, 0.6, 0.8], skyRot: PI, sunDir: unitVec(0.15, 0.75, -0.6), sun: [0.13, 0.16, 0.28], amb: [0.13, 0.14, 0.22], fog: [0.08, 0.09, 0.17], fogNear: 10, fogFar: 70, lights: { lamp: 1, hangar: 1, cabin: 1 }, glow: 1 },
    ],
    defaultTime: 'overcast',
    hotspots: [
      { x: 0, y: 0, z: -17 },
      { x: -12.5, y: catwalk, z: -20 },
      { x: 0, y: catwalk, z: -26.6 },
      { x: 12.5, y: catwalk, z: -14 },
      { x: -28, y: fl, z: 20 },
      { x: 33.2, y: 2.6, z: -10 },
      { x: 25, y: nose, z: 24 },
      { x: -30, y: 0, z: -6 },
      { x: 30, y: 0, z: 4 },
      { x: 0, y: 0, z: 12 },
      { x: -20, y: 0, z: -29 },
      { x: 4, y: 0, z: 34 },
    ],
  };
}
