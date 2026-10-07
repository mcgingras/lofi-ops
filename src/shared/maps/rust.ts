/**
 * Rust (inspired by MW2's "Rust"): a tiny desert oil yard. The rusted derrick tower in the middle
 * has three decks (stairs stand in for the original ladders), there is a two-storey block building
 * with the sniper windows to the north-east, big crude tanks to the south-west, a pumpjack and a
 * shed to the west, pipelines across the sand, a trailer and a chain-link fence to the east, and
 * sand berms on every edge. About 60 x 60 m of play space. Hazy desert dusk by default.
 *
 * Coordinates: x east, z south, y up; yaw 0 looks north (-z). Team 0 spawns north, team 1 south.
 * Search and Destroy: team 1's side holds the sites (`objectives.sd[].team = 1`), attackers start
 * on team 0's spawns, the bomb spawns at `objectives.sdBomb`.
 */
import { MapKit, spawnAt, yawTowards } from './mw2kit';
import { unitVec, type MapData, type MaterialDef, type SpawnPoint } from './types';

const PI = Math.PI;

const MATERIALS: Record<string, MaterialDef> = {
  sand: { texture: 'rust_sand', uvMul: [1 / 6, 1 / 6] },
  dune: { texture: 'rust_sand', uvMul: [1 / 8, 1 / 8], tint: 0xf2e2c8 },
  duneFar: { texture: 'rust_sand', uvMul: [1 / 10, 1 / 10], tint: 0xe8d4b4 },
  deck: { texture: 'rust_deck', uvMul: [1 / 2, 1 / 2] },
  beam: { texture: 'rust_beam', uvMul: [1 / 1.5, 1 / 1.5] },
  corr: { texture: 'rust_corr', uvMul: [1 / 2.4, 1 / 2.4] },
  stairs: { texture: 'rust_stairs', uvMul: [1 / 1.2, 1 / 1.2] },
  rail: { texture: 'rust_rail', uvMul: [1 / 1.2, 1], side: 'double' },
  tank: { texture: 'rust_tank', uvMul: [2, 1] },
  tankSmall: { texture: 'rust_tank', uvMul: [1, 1], tint: 0xd8c8b0 },
  pipe: { texture: 'rust_pipe', uvMul: [1, 2] },
  pipeLong: { texture: 'rust_pipe', uvMul: [1, 10] },
  bldg: { texture: 'rust_bldg', uvMul: [1 / 3, 1 / 3] },
  bldgTrim: { texture: 'rust_bldg', uvMul: [1 / 3, 1 / 3], tint: 0xb8aa96 },
  pad: { texture: 'rust_concrete', uvMul: [1 / 3, 1 / 3] },
  trailer: { texture: 'rust_trailer', uvMul: [1 / 8, 1 / 2.6] },
  fence: { texture: 'fence', side: 'double' },
  steel: { texture: 'steel' },
  lamp: { texture: 'lamp', emissive: 1 },
  crate: { texture: 'crate', uvMul: [1 / 1.2, 1 / 1.2] },
  pallet: { texture: 'pallet' },
  barrelRed: { texture: 'barrel', tint: 0xa8382a, uvMul: [2, 1] },
  barrelBlue: { texture: 'barrel', tint: 0x2f5a8a, uvMul: [2, 1] },
  barrelRust: { texture: 'barrel', tint: 0x8a5a3a, uvMul: [2, 1] },
  barrier: { texture: 'barrier' },
  rubber: { texture: 'rubber', uvMul: [1 / 0.4, 1 / 0.4] },
  pump: { texture: 'yellow', tint: 0xb07a3a, uvMul: [1 / 0.8, 1 / 0.8] },
  hazard: { texture: 'hazard', uvMul: [1 / 0.6, 1 / 0.6] },
  sandbag: { texture: 'rust_sandbag', uvMul: [1 / 1.2, 1 / 0.6] },
  clip: { texture: 'none' },
};

/** Tower deck heights (walkable tops). */
export const RUST_DECKS = { l1: 3.2, l2: 6.4, top: 9.6 } as const;

export function buildRust(): MapData {
  const k = new MapKit();
  const { l1, l2, top } = RUST_DECKS;
  const t = 0.25; // deck thickness

  // ----- ground and berms -----
  k.slab(-48, -1, -48, 48, 0, 48, 'sand', { hide: ['nx', 'px', 'ny', 'nz', 'pz'] });
  // Berms inside the play space (walkable sand slopes up to the edges).
  k.ramp(-30, 0, -30, 30, 2.2, -24, '-z', 'dune'); // north
  k.ramp(-30, 0, 24, 30, 2.0, 30, '+z', 'dune'); // south
  k.ramp(-30, 0, -24, -25, 1.8, 24, '-x', 'dune'); // west
  // Corner fills so the berms meet without steps.
  k.ramp(-30, 0, -30, -25, 2.2, -24, '-z', 'dune');
  k.ramp(-30, 0, 24, -25, 2.0, 30, '+z', 'dune');
  // Scenery dunes past the edges (render only, the play space is clipped).
  k.ramp(-48, 0, -48, 48, 9, -30, '-z', 'duneFar', { collide: false });
  k.ramp(-48, 0, 30, 48, 7, 48, '+z', 'duneFar', { collide: false });
  k.ramp(-48, 0, -30, -30, 6, 30, '-x', 'duneFar', { collide: false });
  k.ramp(34, 0, -30, 48, 5, 30, '+x', 'duneFar', { collide: false });
  k.perimeter(-30, 30, -30, 30, -1, 24);

  // ----- the derrick tower (centre) -----
  // L1: 12 x 12 deck at 3.2. L2: west half at 6.4. Top: 4 x 4 crow's nest at 9.6.
  k.slab(-6, l1 - t, -6, 6, l1, 6, 'deck', { faceMats: { nx: 'beam', px: 'beam', nz: 'beam', pz: 'beam' } });
  k.slab(-6, l2 - t, -6, 0, l2, 6, 'deck', { faceMats: { nx: 'beam', px: 'beam', nz: 'beam', pz: 'beam' } });
  k.slab(-6, top - t, -6, -2, top, -2, 'deck', { faceMats: { nx: 'beam', px: 'beam', nz: 'beam', pz: 'beam' } });
  const col = (x: number, z: number, y0: number, y1: number) => k.slab(x - 0.2, y0, z - 0.2, x + 0.2, y1, z + 0.2, 'beam');
  for (const [x, z] of [[-5.8, -5.8], [5.8, -5.8], [-5.8, 5.8], [5.8, 5.8], [0, -5.8], [0, 5.8], [-5.8, 0], [5.8, 0]] as const) col(x, z, 0, l1 - t);
  for (const [x, z] of [[-5.8, -5.8], [-0.2, -5.8], [-5.8, 5.8], [-0.2, 5.8]] as const) col(x, z, l1, l2 - t);
  for (const [x, z] of [[-5.8, -5.8], [-2.2, -5.8], [-5.8, -2.2], [-2.2, -2.2]] as const) col(x, z, l2, top - t);
  // Cross braces under L1 (render only).
  for (const z of [-5.8, 5.8]) {
    k.trim(-5.6, 0.6, z - 0.06, 5.6, 0.75, z + 0.06, 'beam');
    k.trim(-5.6, 1.9, z - 0.06, 5.6, 2.05, z + 0.06, 'beam');
  }
  // Stairs: ground -> L1 from the east and from the west, L1 -> L2, L2 -> top.
  k.ramp(6, 0, -6, 12, l1, -4.8, '-x', 'stairs', { tag: 'stairs' });
  k.ramp(-12, 0, 4.8, -6, l1, 6, '+x', 'stairs', { tag: 'stairs' });
  k.ramp(0, l1, 2, 4.5, l2, 3.2, '-x', 'stairs', { tag: 'stairs' });
  k.ramp(-4.4, l2, -2, -3.2, top, 3, '-z', 'stairs', { tag: 'stairs' });
  // L1: corrugated half walls (solid cover) around the edge, gaps where the stairs land.
  const half = (axis: 'x' | 'z', a: number, b: number, at: number) => k.wall(axis, a, b, at, l1, l1 + 1.1, 0.12, 'corr');
  half('x', -6, 6, -5.94);
  half('x', -6, 6, 5.94);
  half('z', -4.8, 5.88, 5.94);
  half('z', -5.88, 4.8, -5.94);
  // L2 and the crow's nest: bar railings (shoot-through).
  k.rail('x', -6, 0, -5.96, l2, 'rail', 'beam');
  k.rail('x', -6, 0, 5.96, l2, 'rail', 'beam');
  k.rail('z', -6, 6, -5.96, l2, 'rail', 'beam');
  k.rail('z', -6, 2, -0.04, l2, 'rail', 'beam');
  k.rail('z', 3.2, 6, -0.04, l2, 'rail', 'beam');
  k.rail('x', -6, -2, -5.96, top, 'rail', 'beam');
  k.rail('z', -6, -2, -5.96, top, 'rail', 'beam');
  k.rail('z', -6, -2, -2.04, top, 'rail', 'beam');
  k.rail('x', -6, -4.4, -2.04, top, 'rail', 'beam');
  k.rail('x', -3.2, -2, -2.04, top, 'rail', 'beam');
  // Derrick mast over the crow's nest (scenery).
  for (const [x, z] of [[-5.9, -5.9], [-2.1, -5.9], [-5.9, -2.1], [-2.1, -2.1]] as const) {
    const cx = -4;
    const cz = -4;
    for (let i = 0; i < 6; i++) {
      const y0 = top + 1.2 + i * 2;
      const s = 1 - (i + 0.5) / 7;
      const px = cx + (x - cx) * s;
      const pz = cz + (z - cz) * s;
      k.trim(px - 0.12, y0, pz - 0.12, px + 0.12, y0 + 2, pz + 0.12, 'beam');
    }
    k.trim(x - 0.12, top, z - 0.12, x + 0.12, top + 1.2, z + 0.12, 'beam');
  }
  k.trim(-4.6, top + 13.2, -4.6, -3.4, top + 14, -3.4, 'beam');
  k.glow(-4, top + 14.4, -4, [1, 0.12, 0.08], 2.4, undefined, true);
  // Work light on the crow's nest and under L1.
  k.trim(-2.6, top + 1.0, -2.6, -2.2, top + 1.25, -2.2, 'lamp');
  k.light(-2.6, top + 0.8, -2.6, [1.6, 1.15, 0.7], 12);
  k.light(0, l1 - 0.6, 0, [1.4, 1.0, 0.6], 10);
  k.trim(-0.3, l1 - t - 0.15, -0.3, 0.3, l1 - t, 0.3, 'lamp');
  // Under the tower: wellhead, pump skid, pipes.
  k.slab(-1.2, 0, -1.2, 1.2, 0.35, 1.2, 'pad');
  k.cyl(0.45, 1.6, 8, 'pipe', 0, 1.15, 0);
  k.trim(-0.7, 1.6, -0.15, 0.7, 1.8, 0.15, 'pump');
  k.slab(2.4, 0, -4.4, 4.6, 1.1, -2.4, 'pump');
  k.cyl(0.32, 0.9, 8, 'barrelRust', -3.6, 0.45, 3.4);
  k.cyl(0.32, 0.9, 8, 'barrelRed', -2.9, 0.45, 3.9);

  // ----- the sniper building (north-east) -----
  // 8 x 7 m, two storeys; stairs inside along the north wall; windows look at the tower.
  const bx0 = 12;
  const bx1 = 20;
  const bz0 = -20;
  const bz1 = -13;
  const floor2 = 3.4;
  const roof = 6.0;
  const wt = 0.3;
  k.wall('x', bx0, bx1, bz1 - wt / 2, 0, roof, wt, 'bldg', [[15, 16.4, 0, 2.3], [13.4, 15.2, 4.2, 5.4], [16.6, 18.6, 4.2, 5.4]]); // south
  k.wall('x', bx0, bx1, bz0 + wt / 2, 0, roof, wt, 'bldg', [[16, 18, 4.3, 5.3]]); // north
  k.wall('z', bz0 + wt, bz1 - wt, bx0 + wt / 2, 0, roof, wt, 'bldg', [[-16.6, -15.2, 0, 2.3], [-18.4, -16.9, 4.2, 5.4], [-14.9, -13.6, 4.2, 5.4]]); // west
  k.wall('z', bz0 + wt, bz1 - wt, bx1 - wt / 2, 0, roof, wt, 'bldg', [[-17.5, -15.5, 1.2, 2.2], [-17, -15, 4.2, 5.4]]); // east
  k.slab(bx0 - 0.1, roof, bz0 - 0.1, bx1 + 0.1, roof + 0.3, bz1 + 0.1, 'bldgTrim');
  k.slab(bx0 - 0.1, roof + 0.3, bz0 - 0.1, bx1 + 0.1, roof + 0.7, bz0 + 0.15, 'bldgTrim'); // parapet (north)
  // Second floor with a stairwell over the stairs.
  k.slab(bx0 + wt, floor2 - 0.2, bz0 + 1.5, bx1 - wt, floor2, bz1 - wt, 'pad');
  k.slab(18, floor2 - 0.2, bz0 + wt, bx1 - wt, floor2, bz0 + 1.5, 'pad');
  k.ramp(13, 0, bz0 + wt, 18, floor2, bz0 + 1.5, '+x', 'stairs', { tag: 'stairs' });
  k.rail('x', bx0 + wt, 17.4, bz0 + 1.54, floor2, 'rail', 'beam');
  // Floor inside and a doorstep.
  k.decals.push({ kind: 'flat', w: bx1 - bx0 - 2 * wt, h: bz1 - bz0 - 2 * wt, x: (bx0 + bx1) / 2, y: 0.02, z: (bz0 + bz1) / 2, mat: 'pad' });
  k.light(16, 2.6, -16.5, [1.3, 1.0, 0.65], 7, 'bldg');
  k.light(15.5, 5.4, -16.5, [1.2, 0.95, 0.6], 7, 'bldg');
  k.trim(15.7, 3.0, -16.8, 16.3, 3.2, -16.2, 'lamp');
  // Furniture: a table and crates upstairs, crates downstairs.
  k.slab(14.2, floor2, -15.6, 15.6, floor2 + 0.8, -14.2, 'crate', { uv: 'raw' });
  k.slab(18.2, 0, -15.2, 19.4, 1.2, -14, 'crate', { uv: 'raw' });
  k.slab(12.6, 0, -14.6, 13.8, 1.2, -13.4, 'crate', { uv: 'raw' });
  // Sandbags in front of the door.
  k.slab(14.2, 0, -11.6, 17.4, 0.8, -11, 'sandbag');

  // ----- crude tanks (south-west) -----
  k.slab(-24.2, 0, 9.8, -15.8, 0.3, 18.2, 'pad');
  k.cyl(3.6, 7, 14, 'tank', -20, 3.8, 14);
  k.cyl(3.75, 0.3, 14, 'beam', -20, 7.2, 14, 'y', false);
  k.cyl(2.95, 0.3, 12, 'beam', -13, 5.8, 21, 'y', false);
  k.slab(-16.3, 0, 17.8, -9.7, 0.3, 24, 'pad');
  k.cyl(2.8, 5.6, 12, 'tank', -13, 3.1, 21);
  // Horizontal tank on cradles (west).
  k.cyl(1.3, 6.4, 10, 'tankSmall', -21.5, 1.8, 2, 'z');
  for (const z of [-0.4, 4.4]) k.slab(-22.8, 0, z - 0.25, -20.2, 0.6, z + 0.25, 'beam');
  // Pipe manifold between the tanks.
  k.cyl(0.3, 6, 8, 'pipe', -16, 0.9, 6.5, 'x');
  for (const x of [-18.6, -13.4]) k.slab(x - 0.15, 0, 6.35, x + 0.15, 0.6, 6.65, 'beam');

  // ----- pipelines -----
  // Ground pipe east-west across the south (knee high: hop over or crouch behind).
  k.cyl(0.36, 30, 10, 'pipeLong', 7, 0.46, 10, 'x');
  for (let x = -7; x <= 21; x += 4) k.slab(x - 0.15, 0, 9.7, x + 0.15, 0.22, 10.3, 'beam');
  // Raised pipe rack north-south on the west side (walk under it).
  k.cyl(0.3, 22, 10, 'pipeLong', -9, 2.7, -9, 'z', false);
  k.cyl(0.22, 22, 8, 'pipeLong', -9.7, 2.6, -9, 'z', false);
  for (let z = -19; z <= 1; z += 4) {
    k.slab(-9.1, 0, z - 0.1, -8.9, 2.4, z + 0.1, 'beam');
    k.slab(-10.1, 0, z - 0.1, -9.9, 2.4, z + 0.1, 'beam');
    k.trim(-10.2, 2.3, z - 0.1, -8.8, 2.42, z + 0.1, 'beam');
  }
  // East pipe along the fence.
  k.cyl(0.4, 30, 10, 'pipeLong', 24.5, 0.5, 5, 'z');

  // ----- pumpjack and shed (west / north-west) -----
  k.slab(-19.5, 0, -5, -14.5, 0.3, -1.4, 'pad');
  k.slab(-18.6, 0.3, -4, -17.4, 2.0, -2.4, 'pump');
  k.slab(-15.8, 0.3, -3.6, -15.2, 3.4, -2.8, 'pump');
  k.trim(-19.4, 3.4, -3.4, -14.2, 3.9, -3.0, 'pump');
  k.trim(-14.4, 2.4, -3.6, -13.6, 4.0, -2.8, 'pump');
  k.light(-17, 2.4, -1.0, [0.9, 0.7, 0.4], 6, 'lamp');
  // Shed: hollow corrugated hut with a door to the south and a window east.
  const sx0 = -21;
  const sx1 = -15.5;
  const sz0 = -18;
  const sz1 = -13.5;
  k.wall('x', sx0, sx1, sz1 - 0.06, 0, 2.8, 0.12, 'corr', [[-19, -17.6, 0, 2.1]]);
  k.wall('x', sx0, sx1, sz0 + 0.06, 0, 2.8, 0.12, 'corr');
  k.wall('z', sz0 + 0.12, sz1 - 0.12, sx0 + 0.06, 0, 2.8, 0.12, 'corr');
  k.wall('z', sz0 + 0.12, sz1 - 0.12, sx1 - 0.06, 0, 2.8, 0.12, 'corr', [[-16.6, -15, 1.1, 1.9]]);
  k.slab(sx0 - 0.2, 2.8, sz0 - 0.2, sx1 + 0.2, 2.95, sz1 + 0.2, 'corr');
  k.slab(-20.6, 0, -17.6, -19.4, 1.2, -16.4, 'crate', { uv: 'raw' });
  k.light(-18.2, 2.3, -15.8, [1.1, 0.85, 0.55], 5, 'bldg');

  // ----- east: trailer, shed, fence -----
  k.slab(20.6, 0.8, -4, 23.2, 3.6, 5, 'trailer');
  k.slab(20.8, 0, -3.6, 23.0, 0.8, 4.6, 'rubber');
  k.trim(21.2, 0.2, 5, 22.6, 0.5, 6.6, 'beam');
  k.fence('z', -24, 24, 27.6, 0, 2.8, 'fence', 'steel');
  // Shed B (south-east) with an open front.
  k.wall('x', 13, 19, 15.06, 0, 2.9, 0.12, 'corr');
  k.wall('z', 15.12, 19, 13.06, 0, 2.9, 0.12, 'corr');
  k.wall('z', 15.12, 19, 18.94, 0, 2.9, 0.12, 'corr', [[16.2, 17.6, 0, 2.1]]);
  k.wall('x', 13, 19, 18.94, 0, 2.9, 0.12, 'corr', [[14, 17.5, 0, 2.3]]);
  k.slab(12.8, 2.9, 14.8, 19.2, 3.05, 19.2, 'corr');
  k.slab(17.4, 0, 15.4, 18.6, 1.2, 16.6, 'crate', { uv: 'raw' });
  k.light(16, 2.4, 17, [1.1, 0.85, 0.55], 5, 'bldg');

  // ----- cover: crates, barrels, barriers, sandbags -----
  const crates: [number, number, number][] = [[6, -12, 0], [7.2, -12.2, 0], [6.6, -12.1, 1.2], [-4, 14, 0], [-5.2, 14.3, 0], [10, 4, 0], [-12, -10, 0], [3, 20.5, 0], [20, -22, 0]];
  for (const [x, z, y] of crates) k.slab(x - 0.6, y, z - 0.6, x + 0.6, y + 1.2, z + 0.6, 'crate', { uv: 'raw' });
  const pallets: [number, number][] = [[-2, -16], [9, 15]];
  for (const [x, z] of pallets) for (let i = 0; i < 4; i++) k.slab(x - 0.6, i * 0.15, z - 0.5, x + 0.6, (i + 1) * 0.15, z + 0.5, 'pallet', { uv: 'raw' });
  const barrels: [number, number, string][] = [[9.4, -5, 'barrelRust'], [10, -5.6, 'barrelRed'], [-6.5, 9, 'barrelBlue'], [19, 9, 'barrelRust'], [-15, -21, 'barrelRed'], [24, -14, 'barrelBlue'], [-24, -6, 'barrelRust']];
  for (const [x, z, m] of barrels) k.cyl(0.32, 0.9, 8, m, x, 0.45, z);
  k.slab(-2.5, 0, -19.6, 0.5, 0.8, -19, 'barrier', { uv: 'raw' });
  k.slab(4, 0, 18.4, 7, 0.8, 19, 'barrier', { uv: 'raw' });
  k.slab(-24.6, 0, -12.5, -24, 0.8, -9.5, 'sandbag');
  k.slab(10.5, 0, -20.6, 11.1, 0.9, -17.6, 'sandbag');

  // ----- lamps -----
  k.lampPole(-8, -12, 6.5, 0.9, 0, 'steel', 'lamp', [1.7, 1.15, 0.6], 15);
  k.lampPole(9, 12, 6.5, -0.9, 0, 'steel', 'lamp', [1.7, 1.15, 0.6], 15);
  k.lampPole(22, -9, 6.5, -0.9, 0, 'steel', 'lamp', [1.7, 1.15, 0.6], 15);

  // ----- spawns, objectives -----
  const face = (x: number, z: number, tx = 0, tz = 0) => spawnAt(x, z, yawTowards(x, z, tx, tz));
  const team0: SpawnPoint[] = [face(-10, -21), face(-6, -21.5), face(-2, -21.5), face(2, -21.5), face(6, -21), face(-13, -20), face(8, -19), face(0, -18.5)];
  const team1: SpawnPoint[] = [face(-6, 21), face(-2, 21.5), face(2, 21.5), face(6, 21.5), face(10, 21), face(-4, 19), face(4, 17), face(8, 19)];
  const ffa: SpawnPoint[] = [face(0, -10), face(10, -8), face(-13, -7), face(-14, 9), face(13, 6), face(5, 14), face(-4, -14), face(19, -6), face(-22, -21), face(22, 21), face(-2, 8), face(-23, -9), face(16, -22.5), face(-21, 22), face(24, -20), face(3, -22)];

  return {
    id: 'rust',
    name: 'Rust',
    bounds: { min: { x: -31, y: -2, z: -31 }, max: { x: 31, y: 30, z: 31 } },
    materials: MATERIALS,
    brushes: k.brushes,
    decals: k.decals,
    props: k.props,
    lights: k.lights,
    spawns: { teams: [team0, team1], ffa },
    objectives: {
      dom: [
        { id: 'A', x: 4, y: 0, z: -17, radius: 3 },
        { id: 'B', x: 0, y: 0, z: 1.8, radius: 3 },
        { id: 'C', x: -1, y: 0, z: 16, radius: 3 },
      ],
      sd: [
        { id: 'A', x: -16, y: 0, z: 4.5, radius: 2.2, team: 1 },
        { id: 'B', x: 16, y: 0, z: 12, radius: 2.2, team: 1 },
      ],
      sdBomb: [{ id: 'bomb', x: 0, y: 0, z: -21, radius: 1, team: 0 }],
      hq: [
        { id: 'tower', x: -3, y: l1, z: -3, radius: 3 },
        { id: 'building', x: 16.5, y: 0, z: -16, radius: 2.5 },
        { id: 'pumpjack', x: -17, y: 0, z: -7.5, radius: 3 },
        { id: 'trailer', x: 18.5, y: 0, z: 1, radius: 3 },
        { id: 'tanks', x: -8, y: 0, z: 14, radius: 3 },
      ],
    },
    times: [
      { id: 'dusk', name: 'Hazy dusk', clock: '18:40', sky: 'rust_skyDusk', unlit: [1, 0.88, 0.76], skyRot: PI * 0.75, sunDir: unitVec(-0.8, 0.32, 0.25), sun: [1.25, 0.78, 0.46], amb: [0.42, 0.33, 0.3], fog: [0.8, 0.58, 0.42], fogNear: 16, fogFar: 82, lights: { lamp: 0.75, bldg: 0.9 }, glow: 0.6 },
      { id: 'day', name: 'Dust haze', clock: '13:20', sky: 'rust_skyHaze', unlit: [1, 1, 1], skyRot: 0, sunDir: unitVec(0.3, 0.85, 0.35), sun: [1.0, 0.92, 0.78], amb: [0.52, 0.48, 0.42], fog: [0.82, 0.74, 0.6], fogNear: 18, fogFar: 92, lights: { bldg: 0.4 }, glow: 0 },
      { id: 'night', name: 'Night', clock: '01:15', sky: 'skyNight', unlit: [0.6, 0.62, 0.8], skyRot: PI, sunDir: unitVec(0.2, 0.7, -0.6), sun: [0.14, 0.15, 0.25], amb: [0.14, 0.14, 0.2], fog: [0.08, 0.08, 0.14], fogNear: 8, fogFar: 58, lights: { lamp: 1, bldg: 1 }, glow: 1 },
    ],
    defaultTime: 'dusk',
    hotspots: [
      { x: 1.5, y: 0, z: 2 },
      { x: 3, y: l1, z: -3 },
      { x: -3, y: l2, z: 4.5 },
      { x: -4, y: top, z: -4 },
      { x: 15, y: floor2, z: -15 },
      { x: 16, y: 0, z: -11 },
      { x: -16, y: 0, z: 8 },
      { x: 16, y: 0, z: 13 },
      { x: 22, y: 0, z: -8 },
      { x: -18, y: 0, z: -10 },
      { x: -2, y: 0, z: 14 },
    ],
  };
}
