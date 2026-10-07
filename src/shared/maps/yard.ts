/**
 * The Yard: the container yard from the approved prototype (reference/yard-lab.html `buildYard`),
 * ported 1:1 to MapData. Warehouse to the north, shed to the west, chain-link fence to the east,
 * a two-high container wall to the south; containers, a guard hut, fuel tanks, a forklift, crates,
 * pallets, barrels and barriers in the middle. Small map, TDM/FFA.
 *
 * Material ids below are also texture recipe ids (same names as the prototype's `TX` keys); the
 * client's texture developer must provide each (see docs/CONTRACTS.md "Texture recipe ids").
 */
import { box, cylinder, flatDecal, light, unitVec, wallDecal, type Brush, type Decal, type MapData, type MaterialDef, type Prop, type SpawnPoint } from './types';

const PI = Math.PI;

const MATERIALS: Record<string, MaterialDef> = {
  ground: { texture: 'ground', uvMul: [1 / 4, 1 / 4] },
  warehouse: { texture: 'warehouse', uvMul: [1 / 4, 1 / 10] },
  roof: { texture: 'steel', uvMul: [1 / 2, 1 / 2] },
  shutter: { texture: 'shutter' },
  hazard: { texture: 'hazard', uvMul: [1 / 0.6, 1 / 0.6] },
  lamp: { texture: 'lamp', emissive: 1 },
  num01: { texture: 'num01' },
  num02: { texture: 'num02' },
  num03: { texture: 'num03' },
  winRow: { texture: 'winRow', emissive: 1 },
  door: { texture: 'door' },
  exit: { texture: 'exit', emissive: 1 },
  shed: { texture: 'shed', uvMul: [1 / 2.6, 1 / 5.5] },
  fence: { texture: 'fence', side: 'double' },
  steel: { texture: 'steel' },
  container0: { texture: 'container0', uvMul: [1 / 6.1, 1 / 2.6] },
  container1: { texture: 'container1', uvMul: [1 / 6.1, 1 / 2.6] },
  container2: { texture: 'container2', uvMul: [1 / 6.1, 1 / 2.6] },
  container3: { texture: 'container3', uvMul: [1 / 6.1, 1 / 2.6] },
  container4: { texture: 'container4', uvMul: [1 / 6.1, 1 / 2.6] },
  container5: { texture: 'container5', uvMul: [1 / 6.1, 1 / 2.6] },
  hut: { texture: 'hut', uvMul: [1 / 1.2, 1 / 1.2] },
  hutWin: { texture: 'hutWin', emissive: 1 },
  tank: { texture: 'tank' },
  yellow: { texture: 'yellow', uvMul: [1 / 0.8, 1 / 0.8] },
  rubber: { texture: 'rubber', uvMul: [1 / 0.4, 1 / 0.4] },
  crate: { texture: 'crate', uvMul: [1 / 1.2, 1 / 1.2] },
  pallet: { texture: 'pallet' },
  barrelRed: { texture: 'barrel', tint: 0xa8382a, uvMul: [2, 1] },
  barrelBlue: { texture: 'barrel', tint: 0x2f5a8a, uvMul: [2, 1] },
  barrelYellow: { texture: 'barrel', tint: 0xc9a02f, uvMul: [2, 1] },
  barrier: { texture: 'barrier' },
  paint: { texture: 'paint', uvMul: [2, 2] },
  crane: { texture: 'yellow', tint: 0xc9772f, uvMul: [1 / 2, 1 / 2] },
  clip: { texture: 'none' },
};

export function buildYard(): MapData {
  const brushes: Brush[] = [];
  const decals: Decal[] = [];
  const props: Prop[] = [];
  const lights: MapData['lights'] = [];
  const B = (b: Brush) => brushes.push(b);
  const thin = { collide: false } as const;

  // Ground: a slab whose top is y=0 (prototype: 64x64 plane centred on 1.3, 2).
  B({ min: { x: -30.7, y: -1, z: -30 }, max: { x: 33.3, y: 0, z: 34 }, mat: 'ground', hide: ['nx', 'px', 'ny', 'nz', 'pz'] });

  // Warehouse (north) and its roof slab.
  B(box(60, 10, 14, 'warehouse', 0, 0, -33));
  B(box(60.6, 0.6, 14.6, 'roof', 0, 10, -33, thin));
  [-14, 0, 14].forEach((x, i) => {
    decals.push(wallDecal(5.2, 4.6, 'shutter', x, 0, -25.97, 0, { uv: 'raw' }));
    decals.push(wallDecal(5.6, 0.3, 'hazard', x, 4.6, -25.96));
    decals.push(wallDecal(0.3, 4.6, 'hazard', x - 2.75, 0, -25.96));
    decals.push(wallDecal(0.3, 4.6, 'hazard', x + 2.75, 0, -25.96));
    B(box(0.8, 0.2, 0.5, 'lamp', x, 5.6, -25.7, thin));
    lights.push(light(x, 5.2, -25.0, [1.5, 1.08, 0.6], 13));
    decals.push(flatDecal(1.6, 1.6, `num0${i + 1}`, x, 0.025, -21.5, { uv: 'raw', seg: 2 }));
  });
  for (let x = -26; x <= 26; x += 4.5) decals.push(wallDecal(2.2, 0.9, 'winRow', x, 7, -25.97, 0, { uv: 'raw' }));
  decals.push(wallDecal(1.1, 2.2, 'door', 7.5, 0, -25.97, 0, { uv: 'raw' }));
  decals.push(wallDecal(0.9, 0.45, 'exit', 7.5, 2.45, -25.96, 0, { uv: 'raw' }));
  lights.push(light(7.5, 2.6, -25.4, [0.25, 1.1, 0.45], 5, 'exit'));

  // Shed (west).
  B(box(12, 5.5, 60, 'shed', -34, 0, 2));

  // Fence (east): the visible chain-link plus a clip that stops players but not bullets or sight.
  decals.push(wallDecal(58, 2.8, 'fence', 28, 0, 3, PI / 2));
  for (let z = -26; z <= 32; z += 4) B(box(0.1, 3, 0.1, 'steel', 28, 0, z, thin));
  B({ min: { x: 27.95, y: 0, z: -26 }, max: { x: 28.25, y: 8, z: 32 }, mat: 'clip', noRender: true, bullets: false, sight: false });

  // Container wall (south), two high, with a clip behind the gaps between the bottom row.
  const wall: [number, number, number][] = [[-24, 0, 0], [-17, 1, 0], [-10, 2, 0], [-3, 3, 0], [4, 4, 0], [11, 5, 0], [18, 0, 0], [25, 1, 0], [-20.5, 3, 1], [-6.5, 1, 1], [7.5, 2, 1], [21.5, 4, 1]];
  for (const [x, t, lvl] of wall) B(box(6.1, 2.6, 2.44, `container${t}`, x, lvl * 2.6, 31));
  B({ min: { x: -28, y: 0, z: 30.6 }, max: { x: 28.25, y: 8, z: 31 }, mat: 'clip', noRender: true, bullets: false, sight: false });

  // Interior containers: x, z, quarter turns, texture, level.
  const inner: [number, number, number, number, number][] = [[-12, -12, 0, 0, 0], [-12, -12, 0, 1, 1], [8, -10, 1, 2, 0], [16, 6, 0, 3, 0], [-16, 8, 1, 1, 0], [-16, 8, 1, 5, 1], [3, 12, 0, 4, 0]];
  for (const [x, z, r, t, lvl] of inner) B(box(6.1, 2.6, 2.44, `container${t}`, x, lvl * 2.6, z, { ry: (r * PI) / 2 }));

  // Guard hut.
  B(box(3, 2.6, 2.5, 'hut', -4, 0, -2));
  B(box(3.4, 0.18, 2.9, 'steel', -4, 2.6, -2, thin));
  decals.push(wallDecal(1.4, 0.8, 'hutWin', -4.4, 1.2, -0.74, 0, { uv: 'raw' }));
  decals.push(wallDecal(0.8, 1.9, 'door', -3.0, 0, -0.74, 0, { uv: 'raw' }));
  lights.push(light(-4.4, 1.7, -0.2, [0.55, 0.8, 1.15], 7, 'hut'));

  // Fuel tanks on cradles.
  for (const x of [18.6, 22.2]) {
    props.push(cylinder(1.3, 6, 10, 'tank', x, 1.75, -15, { horizontal: true }));
    for (const z of [-17, -13]) B(box(2.2, 0.5, 0.4, 'steel', x, 0, z, thin));
  }

  // Forklift.
  B(box(1.2, 1.1, 2.2, 'yellow', -20, 0.25, -20));
  B(box(1.1, 0.1, 1.1, 'yellow', -20, 2.2, -20.3, thin));
  for (const s of [-1, 1]) {
    B(box(0.08, 2, 0.08, 'rubber', -20 + 0.5 * s, 0.2, -19.2, thin));
    B(box(0.08, 2.2, 0.08, 'rubber', -20 + 0.5 * s, 0, -21.1, thin));
    B(box(0.12, 0.05, 1.1, 'steel', -20 + 0.25 * s, 0.05, -18.2, thin));
    B(box(0.3, 0.5, 0.5, 'rubber', -20 + 0.6 * s, 0, -19.5, thin));
    B(box(0.3, 0.5, 0.5, 'rubber', -20 + 0.6 * s, 0, -20.9, thin));
  }
  B(box(0.2, 2.6, 0.12, 'rubber', -20, 0, -19.05, thin));

  // Crates (x, z, y), pallets, barrels, barriers.
  const crates: [number, number, number][] = [[-6.5, -8, 0], [-5.2, -8.3, 0], [-5.9, -8.1, 1.2], [11, 2, 0], [12.3, 2.2, 0], [-22, 10, 0], [23, 8, 0], [23, 8, 1.2]];
  for (const [x, z, y] of crates) B(box(1.2, 1.2, 1.2, 'crate', x, y, z, { uv: 'raw', ry: y ? 0.2 : 0 }));
  for (const [x, z] of [[-1, -21], [1.5, -21.2]] as const) for (let k = 0; k < 5; k++) B(box(1.2, 0.15, 1, 'pallet', x, k * 0.15, z, { uv: 'raw' }));
  const barrels: [number, number, string][] = [[2, -6, 'barrelRed'], [2.7, -6.4, 'barrelBlue'], [-10, -1, 'barrelRed'], [-10.6, -1.6, 'barrelYellow'], [15, -12, 'barrelBlue'], [9, 4, 'barrelRed'], [-22.5, 9, 'barrelBlue']];
  for (const [x, z, m] of barrels) props.push(cylinder(0.32, 0.9, 8, m, x, 0.45, z));
  const barriers: [number, number, number][] = [[-9, 15, 0.1], [-5.8, 15.2, -0.05], [7, 15, 0.15], [10.2, 15.4, 0], [-22, -8, 1.57]];
  for (const [x, z, r] of barriers) B(box(3, 0.8, 0.6, 'barrier', x, 0, z, { uv: 'raw', ry: r }));

  // Paint on the ground.
  decals.push(flatDecal(56, 0.18, 'paint', 0, 0.02, -23, { seg: 1 }));
  for (const x of [-17, -11, -3, 3, 11, 17]) decals.push(flatDecal(0.18, 3, 'paint', x, 0.02, -24.5, { seg: 1 }));
  decals.push(flatDecal(0.18, 40, 'paint', 24, 0.02, 4, { seg: 1 }));
  decals.push(flatDecal(0.18, 40, 'paint', -24, 0.02, 4, { seg: 1 }));
  decals.push(flatDecal(60, 0.6, 'hazard', 0, 0.02, -25.6, { seg: 1 }));

  // Lamp poles (the pole collides; arm and head are trim).
  for (const [x, z] of [[-20, -4], [20, -2], [-9, 21], [12, 21], [-2, -17]] as const) {
    B(box(0.22, 7.6, 0.22, 'steel', x, 0, z));
    B(box(1.4, 0.12, 0.2, 'steel', x + 0.6, 7.4, z, thin));
    B(box(0.7, 0.16, 0.4, 'lamp', x + 1.1, 7.24, z, thin));
    lights.push(light(x + 1.1, 6.8, z, [1.8, 1.1, 0.45], 18));
    props.push({ kind: 'glow', color: [0.8, 0.55, 0.25], size: 3, x: x + 1.1, y: 7.1, z, group: 'lamp' });
  }

  // Distant cranes past the fence (scenery).
  for (const [x, z] of [[58, -40], [70, 10], [-10, -78]] as const) {
    B(box(1.6, 36, 1.6, 'crane', x - 7, 0, z, thin));
    B(box(1.6, 36, 1.6, 'crane', x + 7, 0, z, thin));
    B(box(28, 2.2, 2.2, 'crane', x, 36, z, thin));
    B(box(3, 2.6, 3, 'crane', x - 3, 33.4, z, thin));
    props.push({ kind: 'glow', color: [1, 0.1, 0.08], size: 3, x, y: 38.6, z, beacon: true });
  }

  // Spawns. Team 0 by the warehouse facing south, team 1 by the container wall facing north.
  const sp = (x: number, z: number, yaw: number): SpawnPoint => ({ x, y: 0, z, yaw });
  const team0 = [sp(-14, -22, PI), sp(-8, -22, PI), sp(5, -22.5, PI), sp(10, -22, PI), sp(-11, -18.5, PI), sp(13, -19.5, PI), sp(-5, -19, PI), sp(3, -18, PI)];
  const team1 = [sp(-9, 25, 0), sp(-3, 25, 0), sp(3, 25, 0), sp(9, 25, 0), sp(-15, 23, 0), sp(15, 23, 0), sp(-20, 26, 0), sp(20, 26, 0)];
  const ffa = [sp(0, 4, 0), sp(-22, 0, -PI / 2), sp(22, 0, PI / 2), sp(10, 8, PI / 2), sp(-8, 10, 0), sp(20, 20, PI / 4), sp(-20, 20, -PI / 4), sp(-14, -22, PI), sp(10, -22, PI), sp(-3, 25, 0), sp(6, -2, 0), sp(-14, -4, PI)];

  return {
    id: 'yard',
    name: 'Yard',
    bounds: { min: { x: -28.5, y: -2, z: -26.5 }, max: { x: 28.5, y: 30, z: 31 } },
    materials: MATERIALS,
    brushes,
    decals,
    props,
    lights,
    spawns: { teams: [team0, team1], ffa },
    objectives: {
      dom: [
        { id: 'A', x: 0, y: 0, z: -18, radius: 3 },
        { id: 'B', x: 0, y: 0, z: 4, radius: 3 },
        { id: 'C', x: 0, y: 0, z: 22, radius: 3 },
      ],
      // Search and Destroy sites on the container-wall side (team 1 spawns defend). Owner: modes.
      sd: [
        { id: 'A', x: -15, y: 0, z: 15, radius: 2.5, team: 1 },
        { id: 'B', x: 15, y: 0, z: 13, radius: 2.5, team: 1 },
      ],
      // Headquarters rotation (random order, never the same twice running). Owner: modes.
      hq: [
        { id: 'HQ1', x: 0, y: 0, z: 4, radius: 3 },
        { id: 'HQ2', x: -14, y: 0, z: -4, radius: 3 },
        { id: 'HQ3', x: 13, y: 0, z: -4, radius: 3 },
        { id: 'HQ4', x: -10, y: 0, z: 11, radius: 3 },
        { id: 'HQ5', x: 12, y: 0, z: 12, radius: 3 },
        { id: 'HQ6', x: 0, y: 0, z: -13, radius: 3 },
      ],
    },
    times: [
      { id: 'night', name: 'Night', clock: '23:40', sky: 'skyNight', unlit: [0.55, 0.6, 0.8], skyRot: PI, sunDir: unitVec(0.15, 0.75, -0.6), sun: [0.13, 0.16, 0.28], amb: [0.13, 0.14, 0.22], fog: [0.08, 0.09, 0.17], fogNear: 8, fogFar: 62, lights: { lamp: 1, exit: 1, hut: 1 }, glow: 1 },
      { id: 'overcast', name: 'Overcast', clock: '14:10', sky: 'skyGrey', unlit: [1, 1, 1], skyRot: 0, sunDir: unitVec(0.4, 0.85, 0.3), sun: [0.42, 0.42, 0.4], amb: [0.5, 0.52, 0.56], fog: [0.66, 0.68, 0.7], fogNear: 16, fogFar: 88, lights: { exit: 0.6, hut: 0.4 }, glow: 0 },
      { id: 'dusk', name: 'Dusk', clock: '19:05', sky: 'skyDusk', unlit: [1, 0.86, 0.76], skyRot: PI / 2, sunDir: unitVec(-0.85, 0.45, 0.1), sun: [1.15, 0.66, 0.4], amb: [0.3, 0.24, 0.36], fog: [0.82, 0.5, 0.4], fogNear: 20, fogFar: 96, lights: { lamp: 0.5, exit: 1, hut: 0.8 }, glow: 0.5 },
    ],
    defaultTime: 'overcast',
    hotspots: [
      { x: 0, y: 0, z: 4 },
      { x: -12, y: 0, z: -6 },
      { x: 12, y: 0, z: -4 },
      { x: -10, y: 0, z: 12 },
      { x: 12, y: 0, z: 12 },
    ],
  };
}
