/**
 * Rust (inspired by MW2's "Rust", 2009): a tiny desert oil yard, about 48.6 x 49.6 m of play space,
 * laid out from the MW2 minimap and the MWIII (2023) remaster's tac map (see docs/maps/rust-reference.md
 * for the sources, callouts and measurements).
 *
 * The rusted tower stands just north-east of the centre. Its ground floor is a dark maze (a passage on
 * the west side, a tunnel under the north deck, the ladder well on the east), the middle deck sits at
 * 4.4 m and the small top deck at 8.4 m. The ladders are steep ship-ladder ramps: one from the raised
 * platform on the south side up the ladder well to the middle deck, and one from the middle deck to the
 * top. The exhaust chute rises from the sand east of the tower straight to the top deck. The big round
 * pipeline runs down the west side: it rises out of the sand in the north-west, branches east at 4.4 m
 * into the tower's middle deck, and runs south to the derrick platform in the south-west corner, then
 * dips back into the sand in the corner. A small fuel-tank skid west of the tower is joined to the middle
 * deck by a short pipe. Around the edges: two blue containers (north-west), the guard shack at the north
 * fence, a horizontal tank, the tank house (north-east), the Barn Oil building with its covered passage
 * (east), the generator (south of the tower), the trucks (south-east) and a container on the south edge.
 *
 * Coordinates: x east, z south, y up; yaw 0 looks north (-z). Team 0 spawns at the trucks (south-east),
 * team 1 at the pipe and front gate (north / north-west). Search and Destroy: team 1's side defends
 * (`objectives.sd[].team = 1`), attackers start at the trucks (`modeSpawns.sd`, `objectives.sdBomb`).
 */
import { MapKit, spawnAt, yawTowards } from './mw2kit';
import { unitVec, type MapData, type MaterialDef, type SpawnPoint } from './types';

const PI = Math.PI;

const MATERIALS: Record<string, MaterialDef> = {
  sand: { texture: 'rust_sand', uvMul: [1 / 6, 1 / 6] },
  dune: { texture: 'rust_sand', uvMul: [1 / 8, 1 / 8], tint: 0xf2e2c8 },
  duneFar: { texture: 'rust_sand', uvMul: [1 / 10, 1 / 10], tint: 0xe8d4b4 },
  rock: { texture: 'rust_rock', uvMul: [1 / 6, 1 / 6] },
  deck: { texture: 'rust_deck', uvMul: [1 / 2, 1 / 2] },
  beam: { texture: 'rust_beam', uvMul: [1 / 1.5, 1 / 1.5] },
  corr: { texture: 'rust_corr', uvMul: [1 / 2.4, 1 / 2.4] },
  stairs: { texture: 'rust_stairs', uvMul: [1 / 1.2, 1 / 1.2] },
  rail: { texture: 'rust_rail', uvMul: [1 / 1.2, 1], side: 'double' },
  chute: { texture: 'rust_corr', uvMul: [1 / 2.4, 1 / 2.4], tint: 0xb8a690 },
  tank: { texture: 'rust_tank', uvMul: [2, 1] },
  tankWhite: { texture: 'tank', uvMul: [2, 1], tint: 0xf0ece4 },
  pipe: { texture: 'rust_pipe', uvMul: [1, 2] },
  pipeBig: { texture: 'rust_tank', uvMul: [1 / 3, 1 / 2.2], tint: 0xd6cbbb },
  bldg: { texture: 'rust_bldg', uvMul: [1 / 3, 1 / 3] },
  bldgTrim: { texture: 'rust_bldg', uvMul: [1 / 3, 1 / 3], tint: 0xb8aa96 },
  shed: { texture: 'rust_trailer', uvMul: [1 / 6, 1 / 3] },
  pad: { texture: 'rust_concrete', uvMul: [1 / 3, 1 / 3] },
  stripe: { texture: 'hazard', uvMul: [1 / 0.6, 1 / 0.6] },
  container1: { texture: 'container1', uvMul: [1 / 6.1, 1 / 2.6] },
  container0: { texture: 'container0', uvMul: [1 / 6.1, 1 / 2.6] },
  container3: { texture: 'container3', uvMul: [1 / 6.1, 1 / 2.6] },
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
  truck: { texture: 'yellow', tint: 0xc89a48, uvMul: [1 / 0.8, 1 / 0.8] },
  pickup: { texture: 'rust_trailer', uvMul: [1 / 4, 1 / 1.5], tint: 0x9aa2a8 },
  pump: { texture: 'yellow', tint: 0xb07a3a, uvMul: [1 / 0.8, 1 / 0.8] },
  sandbag: { texture: 'rust_sandbag', uvMul: [1 / 1.2, 1 / 0.6] },
  clip: { texture: 'none' },
};

/** Walkable heights (feet), exported for features and tests. */
export const RUST_DECKS = {
  /** Raised platform at the foot of the ladder (south face of the tower). */
  raised: 1.8,
  /** Tower middle deck, also the pipe branch and the short fuel-tank pipe where they meet it. */
  mid: 4.4,
  /** Tower top deck. */
  top: 8.4,
  /** Derrick platform (south-west corner) and the south run of the pipeline. */
  derrick: 2.85,
  /** Fuel-tank skid west of the tower. */
  tank: 3.0,
  /** Roofs of the two blue containers (north-west). */
  containers: 2.6,
} as const;

/** Play area (inner faces of the perimeter clips). */
export const RUST_PLAY = { minX: -24.2, maxX: 24.4, minZ: -24.4, maxZ: 25.2 } as const;

export function buildRust(): MapData {
  const k = new MapKit();
  const { raised, mid, top, derrick, tank, containers } = RUST_DECKS;
  const P = RUST_PLAY;
  const slabT = 0.3; // deck thickness

  /**
   * A box rotated about y (render only) plus `n` axis-aligned collision boxes along its long axis.
   * `dx, dz` is the direction of the long axis.
   */
  const rotBox = (cx: number, cz: number, len: number, wid: number, y0: number, y1: number, dx: number, dz: number, mat: string, n = 0) => {
    const ry = Math.atan2(dx, dz);
    const swap = Math.abs(Math.sin(ry)) > 0.5;
    const hx = (swap ? len : wid) / 2;
    const hz = (swap ? wid : len) / 2;
    k.trim(cx - hx, y0, cz - hz, cx + hx, y1, cz + hz, mat, { ry });
    const l = Math.hypot(dx, dz);
    const ux = dx / l;
    const uz = dz / l;
    for (let i = 0; i < n; i++) {
      const s = -len / 2 + (len * (i + 0.5)) / n;
      const px = cx + ux * s;
      const pz = cz + uz * s;
      const seg = len / n / 2;
      const ex = Math.abs(ux) * seg + Math.abs(uz) * (wid / 2) * 0.85;
      const ez = Math.abs(uz) * seg + Math.abs(ux) * (wid / 2) * 0.85;
      k.slab(px - ex, y0, pz - ez, px + ex, Math.min(y1, 2.6), pz + ez, 'clip', { noRender: true });
    }
  };
  const post = (x: number, z: number, y0: number, y1: number, r = 0.15, mat = 'beam') => k.slab(x - r, y0, z - r, x + r, y1, z + r, mat);
  const crate = (x: number, z: number, y = 0, s = 1.2) => k.slab(x - s / 2, y, z - s / 2, x + s / 2, y + s, z + s / 2, 'crate', { uv: 'raw' });
  const barrel = (x: number, z: number, m: string) => k.cyl(0.32, 0.9, 8, m, x, 0.45, z);

  // =============================================================================================
  // Ground, perimeter, scenery
  // =============================================================================================
  k.slab(-60, -1, -60, 60, 0, 60, 'sand', { hide: ['nx', 'px', 'ny', 'nz', 'pz'] });
  k.perimeter(P.minX, P.maxX, P.minZ, P.maxZ, -1, 24);
  // North fence with the (closed) front gate, west fence down to the pipeline, east fence.
  k.fence('x', P.minX, -13.5, P.minZ, 0, 2.8, 'fence', 'steel');
  k.fence('x', -6.5, P.maxX, P.minZ, 0, 2.8, 'fence', 'steel');
  k.decals.push({ kind: 'wall', w: 7, h: 2.6, x: -10, y: 0, z: P.minZ - 0.05, ry: 0, mat: 'fence' });
  for (const x of [-13.5, -6.5]) k.trim(x - 0.18, 0, P.minZ - 0.4, x + 0.18, 3.6, P.minZ + 0.0, 'steel');
  k.trim(-13.5, 3.3, P.minZ - 0.3, -6.5, 3.55, P.minZ - 0.1, 'steel');
  k.fence('z', P.minZ, 8.6, P.minX, 0, 2.8, 'fence', 'steel');
  k.fence('z', P.minZ, P.maxZ, P.maxX, 0, 2.8, 'fence', 'steel');
  // South edge: sand and rock rising out of the yard (scenery past the clip).
  k.ramp(-60, 0, P.maxZ + 0.2, 60, 6, 38, '+z', 'dune', { collide: false });
  k.ramp(-14, 0, P.maxZ + 0.6, 12, 3.4, 30, '+z', 'rock', { collide: false });
  k.ramp(-60, 0, 38, 60, 16, 60, '+z', 'duneFar', { collide: false });
  // Desert past the other edges.
  k.ramp(-60, 0, -60, 60, 12, -34, '-z', 'duneFar', { collide: false });
  k.ramp(-60, 0, -34, -30, 8, 38, '-x', 'duneFar', { collide: false });
  k.ramp(34, 0, -34, 60, 9, 38, '+x', 'duneFar', { collide: false });
  // Site trailers outside the east fence, a power pylon to the north-east and one to the south-west.
  for (const [z0, z1] of [[2.5, 7.5], [8.5, 13.5]] as const) {
    k.trim(26.2, 0.6, z0, 29.0, 3.4, z1, 'shed');
    k.trim(26.4, 0, z0 + 0.4, 28.8, 0.6, z1 - 0.4, 'rubber');
  }
  const pylon = (x: number, z: number, h: number) => {
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      for (let i = 0; i < 5; i++) {
        const s0 = 1.8 * (1 - i / 6);
        k.trim(x + ox * s0 - 0.08, (h * i) / 5, z + oz * s0 - 0.08, x + ox * s0 + 0.08, (h * (i + 1)) / 5, z + oz * s0 + 0.08, 'steel');
      }
    }
    k.trim(x - 4, h * 0.8, z - 0.1, x + 4, h * 0.8 + 0.25, z + 0.1, 'steel');
    k.trim(x - 3, h * 0.95, z - 0.1, x + 3, h * 0.95 + 0.25, z + 0.1, 'steel');
  };
  pylon(34, -30, 22);
  pylon(-34, 30, 22);
  pylon(10, -40, 22);

  // =============================================================================================
  // The pipeline (west side): a ~2 m pipe you can walk along.
  // =============================================================================================
  const pipeX = -19.8; // north run centre line
  const pipeR = 1.1;
  // North end: it rises out of a sand mound (walk up from the north-west corner) to 4.4 m at the junction.
  k.ramp(pipeX - pipeR, 0, -21.2, pipeX + pipeR, 2.6, -14, '+z', 'pipeBig', { tag: 'stairs' });
  k.ramp(pipeX - pipeR - 0.6, 0, -22.4, pipeX + pipeR + 0.6, 0.5, -20.6, '+z', 'dune', { collide: false });
  k.ramp(pipeX - pipeR, 2.6, -14, pipeX + pipeR, mid, -10, '+z', 'pipeBig', { tag: 'stairs' });
  k.trim(pipeX - pipeR, 0.8, -14, pipeX + pipeR, 2.6, -13.6, 'pipeBig');
  // Junction (flat, 4.4) where the branch leaves for the tower.
  k.cyl(pipeR, 2.4, 12, 'pipeBig', pipeX, mid - pipeR, -8.9, 'z');
  // South run: down to the derrick platform level (2.85) by z 3, flat, an S-bend west, then flat.
  k.slab(pipeX - pipeR, 1.2, -7.7, pipeX + pipeR, derrick, 3, 'pipeBig');
  k.ramp(pipeX - pipeR, derrick, -7.7, pipeX + pipeR, mid, 3, '-z', 'pipeBig', { tag: 'stairs' });
  const pipeCy = derrick - 1.0;
  k.cyl(1.0, 2.2, 12, 'pipeBig', pipeX, pipeCy, 4, 'z');
  k.cyl(1.0, 2.2, 12, 'pipeBig', -20.8, pipeCy, 6, 'z');
  k.cyl(1.0, 2.2, 12, 'pipeBig', -21.9, pipeCy, 7.9, 'z');
  const sx = -23.0; // south run centre line
  k.cyl(1.0, 9.8, 12, 'pipeBig', sx, pipeCy, 13.8, 'z');
  // ...and back down into the sand in the south-west corner (walk up from the corner).
  k.ramp(sx - 1.0, 0, 18.7, sx + 1.0, derrick, 25.0, '-z', 'pipeBig', { tag: 'stairs' });
  // Flange rings along the sloped runs (render only), so the wedges read as pipe.
  const flangesZ = (x0: number, x1: number, za: number, zb: number, ya: number, yb: number, under: number, step = 2.4) => {
    for (let z = Math.min(za, zb) + step / 2; z < Math.max(za, zb); z += step) {
      const y = ya + ((yb - ya) * (z - za)) / (zb - za);
      k.trim(x0 - 0.08, Math.max(0, y - under), z - 0.12, x1 + 0.08, y + 0.08, z + 0.12, 'pipe');
    }
  };
  flangesZ(pipeX - pipeR, pipeX + pipeR, -21.2, -14, 0, 2.6, 2.0);
  flangesZ(pipeX - pipeR, pipeX + pipeR, -14, -10, 2.6, mid, 2.0);
  flangesZ(pipeX - pipeR, pipeX + pipeR, -7.7, 3, mid, derrick, 1.8);
  flangesZ(sx - 1.0, sx + 1.0, 18.7, 25, derrick, 0, 2.0);
  // Concrete saddles under the pipe.
  for (const z of [-17, -12, -4, 1]) k.slab(pipeX - 1.2, 0, z - 0.3, pipeX + 1.2, 1.0, z + 0.3, 'pad');
  for (const z of [11, 16]) k.slab(sx - 1.1, 0, z - 0.3, sx + 1.1, 1.0, z + 0.3, 'pad');
  // Off-map runs (scenery): north past the fence, south past the dunes.
  k.cyl(pipeR, 18, 12, 'pipeBig', pipeX, 0.4, -34, 'z', false);
  k.cyl(1.0, 16, 12, 'pipeBig', sx, 0.3, 34, 'z', false);

  // Branch east into the tower's middle deck at 4.4 (walk under it: 2.6 m clearance).
  const brZ = -8.9;
  const brR = 0.9;
  k.cyl(brR, 16.1, 12, 'pipeBig', (-18.7 + -2.6) / 2, mid - brR, brZ, 'x');
  for (const x of [-16, -12, -8]) {
    post(x, brZ - brR - 0.12, 0, mid - brR);
    post(x, brZ + brR + 0.12, 0, mid - brR);
    k.trim(x - 0.15, mid - brR - 0.25, brZ - brR - 0.2, x + 0.15, mid - brR, brZ + brR + 0.2, 'beam');
  }
  // The valve stack where the branch meets the tower.
  k.cyl(0.8, 5.6, 12, 'pipe', -2.2, 2.8, -8.8);
  k.trim(-2.8, 5.6, -9.4, -1.6, 5.9, -8.2, 'steel');

  // =============================================================================================
  // The tower
  // =============================================================================================
  const deckSlab = (x0: number, z0: number, x1: number, z1: number, y: number) =>
    k.slab(x0, y - slabT, z0, x1, y, z1, 'deck', { faceMats: { nx: 'beam', px: 'beam', nz: 'beam', pz: 'beam' } });

  // --- ground floor: machinery blocks and the maze between them ---
  // West machinery (between the west passage and the deck edge).
  k.slab(-7.7, 0, -5.3, -4.6, mid - slabT, -1.0, 'corr', { faceMats: { py: 'beam' } });
  // Core (the heater box under the top deck), full height.
  k.slab(-3.0, 0, -3.5, 1.3, top - slabT, 1.9, 'corr', { faceMats: { py: 'beam' } });
  // East machinery block (its roof is part of the middle deck).
  k.slab(3.7, 0, -4.7, 8.5, mid, 1.2, 'corr', { faceMats: { py: 'deck' } });
  // North-east room under the deck (S&D B): walls north and east, open to the tunnel in the west.
  k.slab(3.7, 0, -8.15, 6.4, mid - slabT, -7.85, 'corr');
  k.slab(8.3, 0, -8.15, 8.6, mid - slabT, -4.7, 'corr');
  // Pump skid and pipes in the north tunnel, a low pipe and a short wall on the west side.
  k.slab(-1.6, 0, -6.9, 0.6, 1.1, -5.9, 'pump');
  k.cyl(0.25, 3.2, 8, 'pipe', -0.5, 1.6, -6.4, 'x', false);
  k.slab(-7.9, 0, -7.3, -5.6, 0.9, -6.8, 'pipe');
  k.slab(-7.7, 0, -1.8, -7.3, 1.2, 1.9, 'corr');
  k.slab(7.0, 0, -7.7, 8.2, 1.2, -6.5, 'crate', { uv: 'raw' });
  // Deck supports.
  for (const [x, z] of [[-7.55, -7.85], [-7.55, 1.75], [-3.15, 1.75], [-3.15, -7.85], [8.35, 1.05], [3.85, 1.05]] as const) post(x, z, 0, mid - slabT, 0.15);

  // --- the ladder from the raised platform up the ladder well to the middle deck ---
  // Raised platform (south face) and the stair down to the sand.
  k.slab(-2.3, 0, 1.9, 2.5, raised, 6.0, 'pad', { faceMats: { py: 'deck' } });
  k.ramp(-2.3, 0, 6.0, 1.2, raised, 11.4, '-z', 'stairs', { tag: 'stairs' });
  k.slab(-2.45, raised, 6.0, -2.3, raised + 0.9, 11.4, 'beam', { collide: false });
  k.slab(1.2, raised, 6.0, 1.35, raised + 0.9, 11.4, 'beam', { collide: false });
  // The ladder (steep ship ladder) in the well between the core and the east block.
  k.slab(1.3, 0, -1.4, 2.5, raised, 1.9, 'beam');
  k.ramp(1.3, raised, -1.4, 2.5, mid, 1.9, '-z', 'stairs', { tag: 'stairs' });
  // Landing at the top of the ladder (joins the north and east parts of the middle deck).
  deckSlab(1.3, -3.5, 3.7, -1.4, mid);
  k.rail('x', 2.5, 3.7, -1.4, mid, 'rail', 'beam');

  // --- middle deck (4.4) ---
  deckSlab(-7.7, -8.0, -3.0, 1.9, mid); // west wing
  deckSlab(-3.0, -8.0, 8.5, -3.5, mid); // north strip
  // Railings and corrugated cover on the middle deck.
  const half = (axis: 'x' | 'z', a: number, b: number, at: number, y: number) => k.wall(axis, a, b, at, y, y + 1.1, 0.12, 'corr');
  half('z', -8.0, -3.6, -7.64, mid);
  half('z', -2.3, 1.9, -7.64, mid);
  k.rail('x', -7.7, -3.0, 1.86, mid, 'rail', 'beam');
  k.rail('x', 2.7, 8.5, -7.96, mid, 'rail', 'beam');
  k.rail('z', -8.0, 1.2, 8.46, mid, 'rail', 'beam');

  // --- mid -> top ladder on the west face of the core ---
  k.ramp(-4.3, mid, -6.5, -3.1, top, -1.5, '+z', 'stairs', { tag: 'stairs' });

  // --- top deck (8.4): open all round, the stack and its frame rise from its north-east corner ---
  deckSlab(-4.3, -1.5, 1.3, 4.4, top);
  deckSlab(-3.0, -3.5, 1.3, -1.5, top);
  post(-4.15, 4.25, 0, top - slabT, 0.14);
  post(1.15, 4.25, raised, top - slabT, 0.14);
  post(-4.15, 1.0, mid, top - slabT, 0.14);
  k.rail('z', -1.5, 4.4, -4.26, top, 'rail', 'beam');
  k.rail('z', -3.5, -1.5, -3.04, top, 'rail', 'beam');
  k.rail('x', -3.0, 1.3, -3.46, top, 'rail', 'beam');
  k.rail('x', -4.3, 1.3, 4.36, top, 'rail', 'beam');
  k.rail('z', -3.5, 1.2, 1.26, top, 'rail', 'beam');
  k.rail('z', 2.6, 4.4, 1.26, top, 'rail', 'beam');
  // The stack (solid, a little cover up top) and its lattice frame (scenery).
  k.cyl(0.75, 14, 12, 'tank', -0.4, top + 7, -2.4, 'y');
  for (const [x, z] of [[-1.9, -3.3], [1.1, -3.3], [-1.9, -1.0], [1.1, -1.0]] as const) {
    post(x, z, top, top + 2.2, 0.1);
    k.trim(x - 0.1, top + 2.2, z - 0.1, x + 0.1, top + 13, z + 0.1, 'beam');
  }
  for (let y = top + 2.4; y < top + 13; y += 2.2) {
    k.trim(-1.9, y, -3.4, 1.1, y + 0.14, -3.2, 'beam');
    k.trim(-1.9, y, -1.1, 1.1, y + 0.14, -0.9, 'beam');
    k.trim(-2.0, y + 1.1, -3.3, -1.8, y + 1.24, -1.0, 'beam');
    k.trim(1.0, y + 1.1, -3.3, 1.2, y + 1.24, -1.0, 'beam');
  }
  k.glow(-0.4, top + 14.4, -2.4, [1, 0.5, 0.15], 3.0, undefined, true);
  // Work lights: top deck, under the decks (kept dim: the maze is meant to be dark), raised platform.
  k.trim(0.7, top + 1.6, 3.9, 1.1, top + 1.85, 4.3, 'lamp');
  k.light(0.8, top + 1.2, 3.4, [1.6, 1.15, 0.7], 12);
  k.light(-5.5, mid - 1.0, -3.0, [0.7, 0.5, 0.32], 5);
  k.light(1.0, mid - 1.0, -5.8, [0.7, 0.5, 0.32], 5);
  k.light(6.0, mid - 1.0, -6.2, [0.8, 0.58, 0.36], 5);
  k.light(0.0, 3.4, 5.0, [1.2, 0.9, 0.55], 7);

  // --- the exhaust chute: from the sand east of the tower straight up to the top deck ---
  // Built from wedges that float over the sand, so you can walk under its upper half.
  const chX0 = 1.3;
  const chX1 = 14.7;
  const chZ0 = 1.2;
  const chZ1 = 2.6;
  const n = 12;
  for (let i = 0; i < n; i++) {
    const xa = chX1 - ((chX1 - chX0) * i) / n;
    const xb = chX1 - ((chX1 - chX0) * (i + 1)) / n;
    const ya = (top * i) / n;
    const yb = (top * (i + 1)) / n;
    k.ramp(xb, ya, chZ0, xa, yb, chZ1, '-x', 'chute', { tag: 'stairs' });
    if (i > 0) k.trim(xb, ya - 0.6, chZ0 - 0.04, xa, ya, chZ1 + 0.04, 'chute');
  }
  for (const [x, y] of [[9.2, 3.45], [5.6, 5.7]] as const) {
    post(x, chZ0 - 0.15, 0, y - 0.9, 0.12);
    post(x, chZ1 + 0.15, 0, y - 0.9, 0.12);
  }
  k.trim(chX1 - 1.2, 0, chZ0 - 0.05, chX1, 0.25, chZ1 + 0.05, 'stripe');

  // --- north annex (pump house) against the north side of the deck ---
  k.slab(-0.9, 0, -14.0, 2.7, 3.4, -8.0, 'bldg', { faceMats: { py: 'bldgTrim' } });
  k.trim(-1.0, 3.4, -14.1, 2.8, 3.6, -7.9, 'bldgTrim');
  k.trim(0.2, 0, -14.08, 1.6, 2.1, -14.0, 'shed');

  // --- fuel-tank skid west of the tower, and the short pipe to the middle deck ---
  k.slab(-14.8, 0, -4.5, -11.6, tank, -1.4, 'shed', { faceMats: { py: 'deck' } });
  k.cyl(0.85, 3.4, 12, 'tankWhite', -13.2, tank + 0.85, -4.0, 'x');
  for (const x of [-14.2, -12.2]) k.trim(x - 0.15, tank, -4.6, x + 0.15, tank + 0.35, -3.4, 'beam');
  k.ramp(-11.6, tank, -3.5, -7.7, mid, -2.4, '+x', 'pipeBig', { tag: 'stairs' });
  k.trim(-11.6, tank - 0.8, -3.5, -10.6, tank, -2.4, 'pipeBig');
  post(-9.6, -3.65, 0, 3.4, 0.12);
  post(-9.6, -2.25, 0, 3.4, 0.12);

  // =============================================================================================
  // South-west: the derrick platform
  // =============================================================================================
  // Main platform (solid concrete, yellow-striped base) and the south wing over the tunnel.
  k.slab(-20.9, 0, 11.5, -13.1, derrick, 18.2, 'pad', { faceMats: { py: 'deck' } });
  k.trim(-20.95, 0.9, 11.45, -13.05, 1.3, 18.25, 'stripe');
  deckSlab(-20.9, 18.2, -17.3, 22.5, derrick);
  k.slab(-20.9, 0, 18.2, -17.3, derrick - slabT, 18.6, 'pad');
  k.slab(-20.9, 0, 22.1, -17.3, derrick - slabT, 22.5, 'pad');
  // Bridge from the pipe onto the platform.
  deckSlab(-22.0, 11.6, -20.9, 14.8, derrick);
  // Steps up the east side of the wing: crate, crate stack, then the platform.
  k.slab(-15.8, 0, 18.2, -14.4, 0.95, 19.5, 'crate', { uv: 'raw' });
  k.slab(-17.3, 0, 18.2, -15.8, 1.9, 19.6, 'crate', { uv: 'raw' });
  // The rig: four legs, the drill floor and the lattice mast.
  const dcx = -17;
  const dcz = 14.85;
  // Yellow feet, then a mast that steps in three times (straight sections joined by braces).
  const sections: [number, number, number][] = [[2.2, 0.6, 8.6], [1.4, 8.6, 15.6], [0.7, 15.6, 20.6]];
  for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    k.slab(dcx + ox * 2.2 - 0.3, derrick, dcz + oz * 2.2 - 0.3, dcx + ox * 2.2 + 0.3, derrick + 0.6, dcz + oz * 2.2 + 0.3, 'pump');
    post(dcx + ox * 2.2, dcz + oz * 2.2, derrick + 0.6, derrick + 2.6, 0.13, 'beam');
    for (const [h, y0, y1] of sections) k.trim(dcx + ox * h - 0.12, derrick + y0, dcz + oz * h - 0.12, dcx + ox * h + 0.12, derrick + y1, dcz + oz * h + 0.12, 'beam');
  }
  for (const [h, y0, y1] of sections) {
    for (const y of [y0 + 0.14, y0 + 2.2, (y0 + y1) / 2 + 1, y1]) {
      if (y > y1 || (y0 < 1 && y < 1)) continue;
      k.trim(dcx - h, derrick + y - 0.14, dcz - h - 0.06, dcx + h, derrick + y, dcz - h + 0.06, 'beam');
      k.trim(dcx - h, derrick + y - 0.14, dcz + h - 0.06, dcx + h, derrick + y, dcz + h + 0.06, 'beam');
      k.trim(dcx - h - 0.06, derrick + y - 0.14, dcz - h, dcx - h + 0.06, derrick + y, dcz + h, 'beam');
      k.trim(dcx + h - 0.06, derrick + y - 0.14, dcz - h, dcx + h + 0.06, derrick + y, dcz + h, 'beam');
    }
  }
  k.trim(dcx - 1.0, derrick + 20.6, dcz - 1.0, dcx + 1.0, derrick + 21.0, dcz + 1.0, 'beam');
  k.cyl(0.08, 18, 6, 'steel', dcx, derrick + 11.6, dcz, 'y', false);
  k.cyl(0.45, 1.0, 10, 'pipe', dcx, derrick + 0.5, dcz);
  k.slab(-20.6, derrick, 11.8, -19.4, derrick + 1.0, 13.0, 'crate', { uv: 'raw' });
  k.slab(-14.6, derrick, 16.6, -13.4, derrick + 1.0, 17.8, 'crate', { uv: 'raw' });
  k.light(dcx, derrick + 3.5, dcz, [1.3, 0.95, 0.6], 9);
  k.light(-19.1, 1.8, 20.4, [0.6, 0.45, 0.3], 4);

  // =============================================================================================
  // North-west: the two blue containers (climb them from the crates at the south-west corner)
  // =============================================================================================
  k.slab(-15.1, 0, -18.6, -12.5, containers, -12.6, 'container1', { faceMats: { py: 'deck' } });
  k.slab(-12.4, 0, -18.5, -9.8, containers, -12.5, 'container1', { faceMats: { py: 'deck' } });
  k.slab(-16.7, 0, -14.7, -15.9, 0.95, -13.6, 'crate', { uv: 'raw' });
  k.slab(-15.9, 0, -14.7, -15.1, 1.9, -13.6, 'crate', { uv: 'raw' });
  // An AC unit and a satellite dish on the roofs.
  k.slab(-11.9, containers, -17.8, -10.4, containers + 1.0, -16.6, 'steel');
  k.cyl(0.08, 1.2, 6, 'steel', -13.8, containers + 0.6, -14.0, 'y', false);
  k.trim(-14.4, containers + 1.1, -14.6, -13.2, containers + 1.2, -13.4, 'steel');

  // =============================================================================================
  // North: the guard shack at the front gate, the horizontal tank, barriers
  // =============================================================================================
  {
    const x0 = -5.8;
    const x1 = 0.2;
    const z0 = P.minZ;
    const z1 = -20.5;
    const h = 3.0;
    k.wall('x', x0, x1, z1 - 0.075, 0, h, 0.15, 'shed', [[-3.75, -2.35, 0, 2.15], [-1.4, -0.2, 1.1, 2.0]]);
    k.wall('x', x0, x1, z0 + 0.075, 0, h, 0.15, 'shed');
    k.wall('z', z0 + 0.15, z1 - 0.15, x0 + 0.075, 0, h, 0.15, 'shed');
    k.wall('z', z0 + 0.15, z1 - 0.15, x1 - 0.075, 0, h, 0.15, 'shed', [[-23.2, -22.0, 1.1, 2.0]]);
    k.slab(x0 - 0.2, h, z0, x1 + 0.2, h + 0.2, z1 + 0.25, 'corr');
    k.slab(-5.6, 0, -24.3, -4.4, 0.9, -23.1, 'crate', { uv: 'raw' });
    k.slab(-1.4, 0, -24.2, 0.0, 0.8, -23.4, 'steel');
    k.light(-2.8, 2.6, -22.4, [1.1, 0.85, 0.55], 5, 'bldg');
    k.slab(-5.3, 0, -20.5, -3.9, 1.0, -19.2, 'steel');
    k.slab(0.2, 0, -20.6, 1.4, 0.9, -20.2, 'barrier', { uv: 'raw' });
  }
  // Horizontal tank on cradles and its pump box.
  k.cyl(0.9, 5.9, 12, 'tankWhite', 7.15, 1.25, -22.5, 'x');
  for (const x of [5.0, 9.3]) k.slab(x - 0.2, 0, -23.3, x + 0.2, 0.6, -21.7, 'beam');
  k.slab(8.6, 0, -21.6, 10.1, 1.2, -20.0, 'pump');
  // Jersey barriers (north-east of the tower) and a loose one north of the tower.
  k.slab(4.5, 0, -14.3, 6.9, 1.0, -13.8, 'barrier', { uv: 'raw' });
  k.slab(7.7, 0, -14.3, 8.2, 1.0, -12.5, 'barrier', { uv: 'raw' });
  rotBox(-5.7, -15.2, 1.7, 0.5, 0, 1.0, 0.45, 1, 'barrier', 1);

  // =============================================================================================
  // North-east: the tank house (H plan), lanes around it
  // =============================================================================================
  {
    const h = 3.0;
    k.slab(13.7, 0, -21.1, 21.3, h, -18.4, 'bldg', { faceMats: { py: 'pad' } });
    k.slab(15.3, 0, -18.4, 19.8, h, -16.5, 'bldg', { faceMats: { py: 'pad' } });
    k.slab(13.7, 0, -16.5, 21.3, h, -12.9, 'bldg', { faceMats: { py: 'pad' } });
    k.trim(15.4, 0, -12.88, 16.6, 2.1, -12.8, 'shed');
    k.cyl(1.05, 6.6, 12, 'tankWhite', 15.6, h + 1.25, -17.0, 'z');
    k.cyl(1.05, 6.6, 12, 'tankWhite', 19.3, h + 1.25, -17.0, 'z');
    k.cyl(0.7, 6, 10, 'tank', 20.6, h + 3, -20.4, 'y');
    for (const z of [-19.8, -14.2]) k.trim(14.4, h, z - 0.2, 20.4, h + 0.3, z + 0.2, 'beam');
    k.rail('x', 13.7, 21.3, -21.06, h, 'rail', 'beam');
    k.rail('x', 13.7, 21.3, -12.94, h, 'rail', 'beam');
    k.light(17.5, 2.6, -11.6, [1.2, 0.9, 0.55], 6, 'bldg');
  }
  barrel(22.6, -23.2, 'barrelRust');
  barrel(23.3, -22.6, 'barrelBlue');

  // =============================================================================================
  // East: the Barn Oil building, its covered passage, the AC box and a loose pipe
  // =============================================================================================
  {
    const h = 3.4;
    k.slab(21.2, 0, -9.1, P.maxX, h, -4.4, 'bldg', { faceMats: { py: 'pad' } });
    k.slab(20.4, 0, -4.4, P.maxX, h, 1.7, 'bldg', { faceMats: { py: 'pad' } });
    k.cyl(1.2, 9.4, 12, 'tankWhite', 22.6, h + 1.45, -3.7, 'z');
    for (const z of [-7.6, 0.2]) k.trim(21.4, h, z - 0.25, 23.8, h + 0.3, z + 0.25, 'beam');
    k.cyl(0.8, 6, 10, 'tank', 23.4, h + 3, 0.6, 'y');
    // Covered passage (roof on posts) along its west side.
    k.slab(17.5, 2.9, -4.5, 20.4, 3.1, 1.8, 'corr');
    for (const [x, z] of [[17.65, -4.35], [17.65, 1.65], [17.65, -1.35]] as const) post(x, z, 0, 2.9, 0.12, 'steel');
    k.trim(20.38, 0.4, -3.4, 20.42, 2.4, -1.0, 'shed');
    k.light(19.0, 2.5, -1.4, [1.2, 0.9, 0.55], 5, 'bldg');
  }
  k.slab(18.9, 0, 2.7, 21.7, 1.3, 4.6, 'steel');
  rotBox(17.05, 8.1, 3.4, 0.6, 0, 0.6, 2.9, -1.8, 'pipe', 2);

  // =============================================================================================
  // Middle south: the generator and its L of concrete wall
  // =============================================================================================
  k.slab(3.9, 0, 5.2, 6.3, 2.3, 7.9, 'pump');
  k.trim(4.2, 2.3, 5.6, 6.0, 2.6, 7.5, 'steel');
  k.slab(8.3, 0, 5.2, 8.6, 1.2, 10.0, 'barrier');
  k.slab(3.7, 0, 9.7, 8.3, 1.2, 10.0, 'barrier');
  // Planks and junk south-west of the tower.
  k.slab(-5.1, 0, 4.6, -3.7, 0.25, 4.9, 'pallet', { uv: 'raw' });
  k.slab(-3.6, 0, 4.7, -2.4, 0.25, 5.1, 'pallet', { uv: 'raw' });

  // =============================================================================================
  // South: the container on the south edge, crates and a short wall to the south-west
  // =============================================================================================
  k.slab(-5.9, 0, 20.4, 0.1, 2.6, 22.85, 'container0');
  k.slab(-5.9, 0, 22.95, -2.5, 1.2, 24.6, 'crate', { uv: 'raw' });
  k.slab(-1.6, 0, 23.2, 0.0, 0.8, 24.4, 'pallet', { uv: 'raw' });
  k.slab(-11.4, 0, 19.2, -11.0, 1.6, 23.1, 'corr');
  k.slab(-11.4, 0, 22.8, -10.2, 1.6, 23.1, 'corr');
  crate(-9.4, 18.8, 0, 1.0);
  crate(-10.1, 20.0, 0, 1.0);
  crate(-8.4, 19.6, 0, 0.9);

  // =============================================================================================
  // South-east: the trucks
  // =============================================================================================
  // Fuel truck (cab to the north), tank on the back.
  {
    const cx = 19.1;
    const cz = 17.4;
    const dx = -0.5;
    const dz = 0.87;
    rotBox(cx, cz, 8.0, 2.0, 0.55, 1.25, dx, dz, 'rubber', 4);
    for (const s of [-2.9, 0.4, 2.8]) rotBox(cx + dx * s, cz + dz * s, 1.0, 2.4, 0, 1.0, dx, dz, 'rubber');
    rotBox(cx - dx * 2.9, cz - dz * 2.9, 2.2, 2.4, 0.9, 2.9, dx, dz, 'truck');
    rotBox(cx + dx * 1.0, cz + dz * 1.0, 5.6, 2.3, 1.55, 2.75, dx, dz, 'tankWhite');
    rotBox(cx + dx * 1.0, cz + dz * 1.0, 5.6, 1.5, 1.25, 3.05, dx, dz, 'tankWhite');
  }
  // Abandoned pickup.
  {
    const cx = 6.8;
    const cz = 20.5;
    const dx = 0.69;
    const dz = -0.72;
    rotBox(cx, cz, 5.0, 2.0, 0.45, 1.1, dx, dz, 'pickup', 3);
    for (const s of [-1.6, 1.5]) rotBox(cx + dx * s, cz + dz * s, 0.8, 2.1, 0, 0.75, dx, dz, 'rubber');
    rotBox(cx + dx * 0.9, cz + dz * 0.9, 1.6, 1.9, 1.1, 1.8, dx, dz, 'pickup');
  }
  barrel(16.2, 21.4, 'barrelRed');
  barrel(16.9, 22.0, 'barrelRust');
  k.slab(12.4, 0, 23.8, 15.4, 0.9, 24.4, 'barrier', { uv: 'raw' });
  k.slab(22.8, 0, 9.0, 23.9, 1.2, 10.2, 'crate', { uv: 'raw' });
  k.slab(11.0, 0, 9.2, 12.2, 0.6, 10.4, 'pallet', { uv: 'raw' });
  // A loose barrel or two elsewhere.
  barrel(-23.4, -2.5, 'barrelBlue');
  barrel(-17.0, -4.4, 'barrelRust');
  barrel(11.4, -3.8, 'barrelRed');
  k.slab(-24.1, 0, -3.2, -22.9, 1.2, -1.8, 'crate', { uv: 'raw' });

  // ----- lamps -----
  k.lampPole(-16.4, -11.6, 6.5, 0.9, 0, 'steel', 'lamp', [1.7, 1.15, 0.6], 15);
  k.lampPole(15.6, -6.4, 6.5, -0.9, 0, 'steel', 'lamp', [1.7, 1.15, 0.6], 15);
  k.lampPole(-9.2, 12.4, 6.5, 0.9, 0, 'steel', 'lamp', [1.7, 1.15, 0.6], 15);
  k.lampPole(13.2, 11.0, 6.5, -0.9, 0, 'steel', 'lamp', [1.7, 1.15, 0.6], 15);

  // =============================================================================================
  // Spawns and objectives
  // =============================================================================================
  const face = (x: number, z: number, tx = 0, tz = 0, y = 0) => spawnAt(x, z, yawTowards(x, z, tx, tz), y);
  // Team 0: the trucks (south-east).
  const team0: SpawnPoint[] = [face(12.2, 22.6), face(15.6, 23.2, -2, 0), face(22.6, 22.8), face(23.0, 13.4, 0, 6), face(14.5, 13.6), face(10.2, 17.6, -2, 4), face(17.2, 11.6, 0, 4), face(22.9, 7.4, 0, 4), face(3.0, 23.6, -2, 8), face(20.2, 10.4, 6, 0)];
  // Team 1: the pipe and the front gate (north / north-west).
  const team1: SpawnPoint[] = [face(-17.4, -22.8, -8, 0), face(-14.0, -22.6), face(-10.6, -22.8), face(-7.8, -22.8), face(-22.8, -22.6, 0, -8), face(-22.6, -16.0, -10, 0), face(-8.0, -18.4), face(2.6, -18.6), face(-22.6, -11.2, -8, 0), face(-17.2, -16.6, -8, -4)];
  const ffa: SpawnPoint[] = [
    face(-22.6, -22.6), face(-8.2, -21.6), face(3.0, -17.4), face(12.0, -23.0), face(22.9, -11.2),
    face(12.5, -9.5), face(22.8, 5.4), face(23.0, 23.2), face(12.0, 22.8), face(1.8, 15.5),
    face(-8.6, 22.8), face(-15.0, 9.4), face(-22.0, -5.0, -22.0, 8), face(-16.8, -7.2), face(-10.6, 4.6), face(9.6, -1.6, 14, 4),
  ];
  const sdDefend = team1.slice();
  const sdAttack = team0.slice();

  return {
    id: 'rust',
    name: 'Rust',
    bounds: { min: { x: P.minX - 1.8, y: -2, z: P.minZ - 1.8 }, max: { x: P.maxX + 1.8, y: 30, z: P.maxZ + 1.8 } },
    materials: MATERIALS,
    brushes: k.brushes,
    decals: k.decals,
    props: k.props,
    lights: k.lights,
    spawns: { teams: [team0, team1], ffa },
    objectives: {
      // A on team 0's side (south, between the derrick and the south container), B east of the tower,
      // C on team 1's side (by the fuel-tank skid west of the tower). MWIII letters these NE=A, W=B, S=C.
      dom: [
        { id: 'A', x: -7.6, y: 0, z: 16.8, radius: 3 },
        { id: 'B', x: 10.6, y: 0, z: -8.6, radius: 3 },
        { id: 'C', x: -12.8, y: 0, z: -6.4, radius: 3 },
      ],
      // A: open ground by the pipe bend, north of the derrick. B: the cramped room under the tower's
      // north-east deck. Attackers come from the trucks and are a little closer to B.
      sd: [
        { id: 'A', x: -16.4, y: 0, z: 9.4, radius: 2.2, team: 1 },
        { id: 'B', x: 5.6, y: 0, z: -6.3, radius: 2.2, team: 1 },
      ],
      sdBomb: [{ id: 'bomb', x: 16.4, y: 0, z: 22.8, radius: 1, team: 0 }],
      // MWIII's five hardpoints: north-west by the containers, north-east of the tower, south-west of
      // the tower, by the generator, and up on the derrick platform (the only raised one).
      hq: [
        { id: 'containers', x: -12.4, y: 0, z: -21.0, radius: 3 },
        { id: 'annex', x: 5.4, y: 0, z: -10.8, radius: 3 },
        { id: 'stairs', x: -5.8, y: 0, z: 7.6, radius: 3 },
        { id: 'generator', x: 5.6, y: 0, z: 3.9, radius: 2.6 },
        { id: 'derrick', x: -17.0, y: derrick, z: 12.4, radius: 2.6 },
      ],
    },
    modeSpawns: { sd: { attackers: sdAttack, defenders: sdDefend } },
    times: [
      { id: 'day', name: 'Sandstorm', clock: '13:20', sky: 'rust_skyHaze', unlit: [1, 0.97, 0.9], skyRot: 0, sunDir: unitVec(0.3, 0.8, 0.4), sun: [1.0, 0.86, 0.66], amb: [0.55, 0.48, 0.4], fog: [0.8, 0.68, 0.52], fogNear: 12, fogFar: 74, lights: { bldg: 0.4 }, glow: 0.3 },
      { id: 'dusk', name: 'Hazy dusk', clock: '18:40', sky: 'rust_skyDusk', unlit: [1, 0.88, 0.76], skyRot: PI * 0.75, sunDir: unitVec(-0.8, 0.32, 0.25), sun: [1.25, 0.78, 0.46], amb: [0.42, 0.33, 0.3], fog: [0.8, 0.58, 0.42], fogNear: 16, fogFar: 82, lights: { lamp: 0.75, bldg: 0.9 }, glow: 0.6 },
      { id: 'night', name: 'Night', clock: '01:15', sky: 'skyNight', unlit: [0.6, 0.62, 0.8], skyRot: PI, sunDir: unitVec(0.2, 0.7, -0.6), sun: [0.14, 0.15, 0.25], amb: [0.14, 0.14, 0.2], fog: [0.08, 0.08, 0.14], fogNear: 8, fogFar: 58, lights: { lamp: 1, bldg: 1 }, glow: 1 },
    ],
    defaultTime: 'day',
    hotspots: [
      { x: -1.5, y: top, z: 2.6 },
      { x: -5.6, y: mid, z: -1.2 },
      { x: 5.6, y: mid, z: -6.0 },
      { x: 0.2, y: raised, z: 4.0 },
      { x: -17.0, y: derrick, z: 12.4 },
      { x: -12.0, y: mid, z: brZ },
      { x: -13.2, y: tank, z: -2.3 },
      { x: -12.6, y: containers, z: -15.4 },
      { x: 5.6, y: 0, z: -6.3 },
      { x: -3.8, y: 0, z: -1.0 },
      { x: 3.1, y: 0, z: 0.0 },
      { x: 14.0, y: 0, z: 15.0 },
      { x: 19.0, y: 0, z: -1.4 },
      { x: 22.8, y: 0, z: -17.0 },
      { x: -2.8, y: 0, z: -22.4 },
      { x: -19.1, y: 0, z: 20.4 },
    ],
  };
}
