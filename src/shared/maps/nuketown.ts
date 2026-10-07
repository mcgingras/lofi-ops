/**
 * Nuketown (recreation of Black Ops 1's Nuketown, owner: maps-bo). Layout traced from the BO1
 * overview map and minimap, gameplay screenshots and the BO6/CoD Mobile remakes; see
 * docs/maps/nuketown-reference.md for the sources, callouts and measurements.
 *
 * A model-home cul-de-sac on the Nevada test site. The road comes in from the south and ends in a
 * turning circle; the green house stands on the west end, the yellow house on the east end, each
 * facing the circle across a small front lawn. The school bus is parked in the circle on the green
 * side (hood to the south), the moving truck (cab-over tractor + box trailer) on the yellow side
 * (cab to the south). The "Welcome to Nuketown" sign closes the north end of the circle.
 *
 * The real houses are turned a little to face the circle; here both are axis-aligned and placed
 * where their centres are. The plans are the same house turned half round (MapKit 'rot180'), with
 * the original's differences kept: the green garage is set back from the front and the green
 * balcony stairs run down along the back wall to a patio; the yellow garage is flush and wider and
 * its balcony stairs run straight out onto a big ground-level deck.
 *
 * Each house: front door into the living room (front), stairs along the north/south wall up to
 * the study (rear), which leads to the front bedroom with the two big windows over the circle and
 * out to the rear balcony; the kitchen (rear) has the back door and a door into the attached
 * garage, which is open to the driveway and has a back door. The front bedroom's porch-side window
 * can be reached from outside: planter -> pillar -> porch roof -> window.
 *
 * Metres, +x east, +z south, yaw 0 faces north (-z). Circle centre (0, 0).
 *   green house   main x -23.2 .. -9.6, z -12.4 .. -2.8; garage x -19.8 .. -12.6, z -2.8 .. 4.0
 *   yellow house  main x 13.6 .. 27.2,  z -5.7 .. 3.9;   garage x 13.6 .. 23.6,  z -13.9 .. -5.7
 *   bus           x -3.6 .. -1.0, z -0.5 .. 9.7      truck  x 1.7 .. 4.4, z -10.2 .. 2.6
 *   lots          green backyard x -41 .. -23, yellow backyard x 27 .. 47; side yards north/south
 *   street        exit stub x -5.3 .. 7.9 out to z 17.4 (barrier); Welcome sign at z -17.5
 */
import { MapKit, yawTo, type Hole } from './bo-kit';
import { unitVec, type MapData, type MaterialDef, type ObjectivePoint, type SpawnPoint } from './types';

const PI = Math.PI;

/** Upper floor walking height and slab underside. */
const F2 = 3.0;
const SLAB = 2.78;
/** Wall top (eaves) of the two-storey blocks. */
const EAVE = 5.7;
const T = 0.25;
/** Main block depth (front to back) and width. */
const DEPTH = 13.6;
const WIDTH = 9.6;
/** Ground-level deck behind the yellow house. */
const DECK = 0.25;

export const NUKETOWN_BOUNDS = { min: { x: -42.5, y: -2, z: -22.5 }, max: { x: 48.5, y: 24, z: 19 } };

const MATERIALS: Record<string, MaterialDef> = {
  sand: { texture: 'nt_sand', uvMul: [1 / 6, 1 / 6] },
  grass: { texture: 'nt_grass', tint: 0xb8e090, uvMul: [1 / 4, 1 / 4] },
  hedge: { texture: 'nt_grass', tint: 0x7fae5a, uvMul: [1 / 1.5, 1 / 1.5] },
  asphalt: { texture: 'nt_asphalt', uvMul: [1 / 5, 1 / 5] },
  concrete: { texture: 'bo_concrete', uvMul: [1 / 3, 1 / 3] },
  dirt: { texture: 'fr_dirt', tint: 0xc09070, uvMul: [1 / 3, 1 / 3] },
  line: { texture: 'paint', uvMul: [2, 2] },
  sidingG: { texture: 'nt_siding', tint: 0x8fe0b8, uvMul: [1 / 2.4, 1 / 2.4] },
  sidingY: { texture: 'nt_siding', tint: 0xf4d462, uvMul: [1 / 2.4, 1 / 2.4] },
  sidingW: { texture: 'nt_siding', uvMul: [1 / 2.4, 1 / 2.4] },
  trim: { texture: 'nt_trim', uvMul: [1 / 1.5, 1 / 1.5] },
  roofG: { texture: 'nt_roof', tint: 0x8a9496, uvMul: [1 / 3, 1 / 3] },
  roofY: { texture: 'nt_roof', tint: 0x9a8c7a, uvMul: [1 / 3, 1 / 3] },
  floor: { texture: 'nt_floor', uvMul: [1 / 2, 1 / 2] },
  tile: { texture: 'nt_tile', uvMul: [1 / 1.2, 1 / 1.2] },
  plasterG: { texture: 'nt_plaster', tint: 0xdcefdc, uvMul: [1 / 3, 1 / 3] },
  plasterY: { texture: 'nt_plaster', tint: 0xf6e6b8, uvMul: [1 / 3, 1 / 3] },
  ceiling: { texture: 'nt_plaster', uvMul: [1 / 3, 1 / 3] },
  stone: { texture: 'bo_rock', tint: 0x9a948c, uvMul: [1 / 1.4, 1 / 1.4] },
  brick: { texture: 'nt_brick', uvMul: [1 / 1.2, 1 / 1.2] },
  picket: { texture: 'nt_picket', side: 'double', uvMul: [1, 1 / 0.9] },
  woodfence: { texture: 'nt_woodfence', uvMul: [1 / 2, 1 / 2] },
  lattice: { texture: 'nt_lattice', side: 'double', uvMul: [1 / 1.2, 1 / 1.2] },
  chain: { texture: 'fence', side: 'double' },
  deck: { texture: 'nt_woodfence', tint: 0xffe8c8, uvMul: [1 / 2, 1 / 2] },
  bus: { texture: 'nt_bus', uvMul: [1 / 3, 1 / 2.55] },
  busWin: { texture: 'nt_busWin', uvMul: [1 / 1.2, 1] },
  trailer: { texture: 'nt_trailer' },
  carGreen: { texture: 'bo_carpaint', tint: 0x7fb89a },
  carBlue: { texture: 'bo_carpaint', tint: 0x6f9ec0 },
  carRed: { texture: 'bo_carpaint', tint: 0xb8402f },
  cream: { texture: 'bo_carpaint', tint: 0xf0e8d2 },
  cabinet: { texture: 'bo_carpaint', tint: 0xb83a30 },
  glass: { texture: 'bo_glass' },
  rubber: { texture: 'rubber', uvMul: [1 / 0.4, 1 / 0.4] },
  steel: { texture: 'steel' },
  wood: { texture: 'bo_wood', uvMul: [1 / 1.2, 1 / 1.2] },
  fabric: { texture: 'bo_fabric', tint: 0xb08870, uvMul: [1 / 1.5, 1 / 1.5] },
  fabricB: { texture: 'bo_fabric', tint: 0x7088a8, uvMul: [1 / 1.5, 1 / 1.5] },
  mannequin: { texture: 'bo_mannequin' },
  dress: { texture: 'bo_fabric', tint: 0xc07080 },
  mountains: { texture: 'nt_mountains', side: 'double', fog: false, tint: 0xe8dccc },
  mountainsFar: { texture: 'nt_mountains', side: 'double', fog: false, tint: 0xc4c2d8 },
  sign: { texture: 'nt_sign', emissive: 0.3 },
  lamp: { texture: 'lamp', emissive: 1 },
  hazard: { texture: 'hazard', uvMul: [1 / 0.6, 1 / 0.6] },
  crate: { texture: 'crate', uvMul: [1 / 1.2, 1 / 1.2] },
  barrel: { texture: 'barrel', tint: 0x9aa0a0, uvMul: [2, 1] },
  pink: { texture: 'nt_siding', tint: 0xf0b8c0, uvMul: [1 / 2.4, 1 / 2.4] },
  blue: { texture: 'nt_siding', tint: 0x9cc0e8, uvMul: [1 / 2.4, 1 / 2.4] },
  clip: { texture: 'none' },
};

/** Window and door holes (absolute coordinates along the wall, y above the wall base). */
const door = (a: number, w = 1.2): Hole => ({ a0: a - w / 2, a1: a + w / 2, y0: 0, y1: 2.2 });
const win = (a0: number, a1: number, up = false): Hole => (up ? { a0, a1, y0: F2 + 0.9, y1: F2 + 2.2 } : { a0, a1, y0: 0.95, y1: 2.15 });
const upDoor = (a: number, w = 1.1): Hole => ({ a0: a - w / 2, a1: a + w / 2, y0: F2, y1: F2 + 2.2 });

interface HouseOpts {
  /** Outer face of the front wall (the front faces +x before the lot's transform). */
  fx: number;
  /** Centre of the main block along z; the garage is on the +z side. */
  zc: number;
  siding: string;
  /** Siding of the upper storey (the green house is white upstairs). */
  upper: string;
  plaster: string;
  roof: string;
  /** Garage: front setback from the house front, depth, width. */
  garage: { setback: number; depth: number; width: number };
  /** 'along': balcony at the -z end of the back wall, stairs down along the wall (green).
   *  'out': balcony at the garage end, stairs straight out onto a ground deck (yellow). */
  back: 'along' | 'out';
  team: 0 | 1;
}

/** Positions inside one house plan (shared by the house builder and its lot). */
function plan(o: Pick<HouseOpts, 'fx' | 'zc' | 'garage'>) {
  const fx = o.fx;
  const bx = fx - DEPTH;
  const z0 = o.zc - WIDTH / 2;
  const z1 = o.zc + WIDTH / 2;
  const gx0 = fx - o.garage.setback;
  const gx1 = gx0 - o.garage.depth;
  const gz1 = z1 + o.garage.width;
  return {
    fx, bx, z0, z1, zc: o.zc, gx0, gx1, gz1,
    /** Front door, the porch-side upstairs window, the stair run, the partitions. */
    doorZ: o.zc - 0.8,
    climbWin: [o.zc + 0.9, o.zc + 2.9] as const,
    stairs: { x0: fx - 4.0, x1: fx - 9.0, z0: z0 + T, z1: z0 + T + 1.15 },
    split: fx - 7.0,
    garageDoorX: fx - 8.6,
  };
}

/**
 * One house: two-storey main block + attached garage + porch + rear balcony, in the green frame
 * (front faces +x, garage on +z). The yellow house is the same call under 'rot180'.
 */
function house(k: MapKit, o: HouseOpts) {
  const p = plan(o);
  const { fx, bx, z0, z1, zc, gx0, gx1, gz1 } = p;
  const ext = o.siding;
  const int = o.plaster;

  // ---- floors ----
  k.flatDecal(6.85, WIDTH - 0.3, 'floor', fx - 3.5, 0.03, zc);
  k.flatDecal(DEPTH - 7 - 0.15, WIDTH - 0.3, 'tile', (p.split + bx) / 2, 0.03, zc);
  k.flatDecal(gx0 - gx1 - 0.3, gz1 - z1 - 0.3, 'concrete', (gx0 + gx1) / 2, 0.03, (z1 + gz1) / 2);

  // ---- walls (one wall per side, each storey its own siding, with door/window holes) ----
  const H = EAVE;
  const storeys = (axis: 'x' | 'z', a0: number, a1: number, c: number, holes: Hole[], wo: Parameters<MapKit['wall']>[9]) => {
    k.wall(axis, a0, a1, c, 0, SLAB, T, ext, holes.filter((h) => h.y1 <= SLAB), wo);
    k.wall(axis, a0, a1, c, SLAB, H - SLAB, T, o.upper, holes.filter((h) => h.y0 >= SLAB).map((h) => ({ ...h, y0: h.y0 - SLAB, y1: h.y1 - SLAB })), wo);
  };
  // Front wall: door, two ground windows, two big upstairs windows (the porch-side one is climbable).
  storeys('z', z0, z1, fx - T / 2, [door(p.doorZ), win(z0 + 1.0, z0 + 2.8), win(zc + 0.9, zc + 3.3), win(z0 + 1.2, z0 + 3.4, true), { a0: p.climbWin[0], a1: p.climbWin[1], y0: F2 + 0.4, y1: F2 + 2.45 }], { faceMats: { nx: int } });
  // Back wall: back door (kitchen), kitchen window, balcony door, study window.
  const balconyDoorZ = o.back === 'along' ? z0 + 2.4 : z1 - 1.7;
  const backDoorZ = zc - 1.5;
  const kitchenWin: [number, number] = o.back === 'along' ? [zc + 0.6, zc + 2.4] : [zc + 0.4, zc + 2.0];
  const studyWin: [number, number] = o.back === 'along' ? [zc + 1.0, zc + 3.0] : [z0 + 1.2, z0 + 3.0];
  storeys('z', z0, z1, bx + T / 2, [door(backDoorZ, 1.1), win(kitchenWin[0], kitchenWin[1]), upDoor(balconyDoorZ), win(studyWin[0], studyWin[1], true)], { faceMats: { px: int } });
  // North (-z) wall: living room and kitchen windows, two upstairs windows (bedroom side, study side).
  storeys('x', bx + T, fx - T, z0 + T / 2, [win(fx - 2.8, fx - 1.0), win(bx + 1.2, bx + 3.0), win(fx - 3.4, fx - 1.4, true), win(bx + 1.4, bx + 3.2, true)], { faceMats: { pz: int } });
  // South (+z) wall: door into the garage, windows where the garage doesn't cover it.
  const southHoles: Hole[] = [door(p.garageDoorX, 1.1), win(fx - 3.2, fx - 1.2, true), win(bx + 1.4, bx + 3.2, true)];
  if (gx0 < fx - 2.2) southHoles.push(win(fx - 2.1, fx - 0.7));
  if (gx1 > bx + 2.6) southHoles.push(win(bx + 0.8, bx + 2.4));
  storeys('x', bx + T, fx - T, z1 - T / 2, southHoles, { faceMats: { nz: int } });
  // Stone veneer skirt along the front, corner boards, the band between the storeys.
  k.trim(0.08, 0.75, WIDTH, 'stone', fx + 0.04, 0, zc);
  for (const [x, z] of [[fx, z0], [bx, z0], [fx, z1], [bx, z1]] as const) k.trim(0.3, H, 0.3, 'trim', x - Math.sign(x - (fx + bx) / 2) * 0.1, 0, z - Math.sign(z - zc) * 0.1);
  k.trim(DEPTH + 0.2, 0.22, WIDTH + 0.2, 'trim', (fx + bx) / 2, SLAB, zc, { hide: ['ny', 'py'] });

  // ---- ground floor rooms ----
  const st = p.stairs;
  // Living room | kitchen partition, with a wide opening; the stairs pass it on the -z side.
  k.wall('z', st.z1 + 0.05, z1 - T, p.split, 0, SLAB, 0.15, int, [{ a0: zc - 0.6, a1: zc + 1.8, y0: 0, y1: 2.3 }]);
  // Stairs along the -z wall, rising towards the back, from the living room to the study.
  k.stairs(st.x1, 0, st.z0, st.x0, F2, st.z1, '-x', 'wood', 14);
  // Stringer wall under the stairs (the closet under them), kitchen side.
  k.aabb(st.x1, 0, st.z1, p.split, 1.4, st.z1 + 0.1, int);

  // Upper floor slab, the stairwell left open.
  const slab = { faceMats: { py: 'floor', ny: 'ceiling' } };
  k.aabb(bx + T, SLAB, st.z1, fx - T, F2, z1 - T, int, slab);
  k.aabb(bx + T, SLAB, z0 + T, st.x1, F2, st.z1, int, slab);
  k.aabb(st.x0, SLAB, z0 + T, fx - T, F2, st.z1, int, slab);
  // Stairwell railing (players can't drop into the stairwell; bullets and sight pass).
  k.aabb(st.x1, F2, st.z1, st.x0 + 0.08, F2 + 1, st.z1 + 0.08, 'trim', { bullets: false, sight: false });
  k.aabb(st.x0, F2, z0 + T, st.x0 + 0.08, F2 + 1, st.z1 + 0.08, 'trim', { bullets: false, sight: false });
  // Upstairs partition: front bedroom | study, door near the stairs.
  k.wall('z', st.z1 + 0.08, z1 - T, p.split, F2, H - F2, 0.15, int, [door(st.z1 + 1.2, 1.1)]);
  // Ceiling under the roof.
  k.aabb(bx + T, H - 0.12, z0 + T, fx - T, H, z1 - T, 'ceiling', { hide: ['py'] });

  // Gable roof, the gable end facing the street (ridge along x).
  k.ramp(bx - 0.45, H, z0 - 0.45, fx + 0.45, H + 2.4, zc, '+z', o.roof);
  k.ramp(bx - 0.45, H, zc, fx + 0.45, H + 2.4, z1 + 0.45, '-z', o.roof);
  k.wallDecal(0.9, 0.5, 'trim', fx + 0.02, H + 0.9, zc, PI / 2);
  k.wallDecal(0.9, 0.5, 'trim', bx - 0.02, H + 0.9, zc, -PI / 2);

  // ---- front porch: step, canopy (walkable roof under the climbable window), post, lamp ----
  const pz0 = p.doorZ - 1.0;
  const pz1 = zc + 3.6;
  k.box(1.6, 0.18, pz1 - pz0, 'concrete', fx + 0.8, 0, (pz0 + pz1) / 2);
  k.aabb(fx, 2.4, pz0, fx + 1.7, 2.55, pz1, 'trim', { faceMats: { py: o.roof } });
  k.box(0.16, 2.4, 0.16, 'trim', fx + 1.55, 0.18, pz0 + 0.1);
  // The porch's south support: a stone pillar (1.7 m), and a planter in front of it (0.85 m).
  k.box(0.6, 1.7, 0.6, 'stone', fx + 1.25, 0, pz1 + 0.3);
  k.box(0.16, 0.7, 0.16, 'trim', fx + 1.25, 1.7, pz1 - 0.08, { collide: false });
  k.box(1.2, 0.85, 0.8, 'stone', fx + 1.0, 0, pz1 + 1.0, { faceMats: { py: 'hedge' } });
  k.trim(0.2, 0.3, 0.2, 'lamp', fx + 0.12, 2.0, p.doorZ - 0.9);
  k.light(fx + 0.5, 2.1, p.doorZ, [1.5, 1.15, 0.7], 7, 'porch');
  // Window frames (front, trim only).
  for (const [a0, a1, y0, y1] of [[z0 + 1.0, z0 + 2.8, 0.95, 2.15], [zc + 0.9, zc + 3.3, 0.95, 2.15], [z0 + 1.2, z0 + 3.4, F2 + 0.9, F2 + 2.2], [p.climbWin[0], p.climbWin[1], F2 + 0.4, F2 + 2.45]] as const) {
    k.trim(0.1, 0.1, a1 - a0 + 0.24, 'trim', fx + 0.05, y0 - 0.1, (a0 + a1) / 2);
    k.trim(0.1, 0.1, a1 - a0 + 0.24, 'trim', fx + 0.05, y1, (a0 + a1) / 2);
    k.trim(0.06, y1 - y0, 0.5, 'trim', fx + 0.05, y0, a0 - 0.3);
    k.trim(0.06, y1 - y0, 0.5, 'trim', fx + 0.05, y0, a1 + 0.3);
  }

  // ---- furniture ----
  // Living room: couch under the north window facing in, coffee table, TV, armchair.
  k.box(0.9, 0.85, 2.2, 'fabric', fx - T - 0.5, 0, z0 + 1.9, { sight: false });
  k.box(1.1, 0.42, 0.6, 'wood', fx - 2.0, 0, zc - 0.4);
  k.box(1.5, 1.0, 0.45, 'wood', fx - 4.5, 0, z1 - T - 0.25);
  k.box(0.9, 0.9, 0.9, 'fabricB', fx - 1.2, 0, z1 - 1.0, { sight: false });
  // Kitchen: red counters along the back and the +z wall, table in the middle, fridge.
  k.box(0.65, 0.95, 3.2, 'cabinet', bx + T + 0.33, 0, o.back === 'along' ? zc + 2.6 : zc + 2.2, { faceMats: { py: 'trim' } });
  k.box(2.6, 0.95, 0.65, 'cabinet', bx + 2.0, 0, z1 - T - 0.33, { faceMats: { py: 'trim' } });
  k.box(0.75, 1.9, 0.75, 'trim', bx + T + 0.4, 0, z0 + T + 0.4);
  k.box(1.3, 0.76, 0.9, 'wood', (p.split + bx) / 2 + 0.3, 0, zc - 0.6, { sight: false });
  // Upstairs: bed and dresser in the front bedroom, desk and bookshelves in the study.
  k.box(2.1, 0.6, 1.6, 'fabricB', fx - 2.6, F2, z1 - T - 0.85, { sight: false });
  k.box(0.5, 1.0, 1.4, 'wood', fx - 6.6, F2, zc + 1.4);
  k.box(1.6, 0.78, 0.8, 'wood', bx + 3.6, F2, zc + 0.4);
  k.box(2.4, 2.0, 0.4, 'wood', bx + 3.0, F2, z1 - T - 0.2);
  k.box(0.4, 2.0, 1.8, 'wood', p.split - 0.3, F2, z1 - 1.6);

  // Interior lights.
  k.light(fx - 3.5, 2.5, zc, [1.3, 1.1, 0.8], 8, 'house');
  k.light(bx + 3.5, 2.5, zc, [1.3, 1.1, 0.8], 8, 'house');
  k.light(fx - 3.5, F2 + 2.4, zc + 1, [1.25, 1.05, 0.8], 8, 'house');
  k.light(bx + 3.5, F2 + 2.4, zc, [1.25, 1.05, 0.8], 8, 'house');

  // ---- garage: open to the driveway, a door into the kitchen, a back door ----
  const GH = 3.0;
  const gw = gz1 - z1;
  k.wall('x', gx1, gx0, gz1 - T / 2, 0, GH, T, 'sidingW', [win(gx1 + 2.0, gx1 + 3.4)], { faceMats: { nz: 'concrete' } });
  k.wall('z', z1, gz1 - T, gx1 + T / 2, 0, GH, T, 'sidingW', [door(gz1 - 1.4, 1.1)], { faceMats: { px: 'concrete' } });
  // Front: piers each side, the header with the door panel rolled up under the ceiling.
  k.aabb(gx0 - T, 0, z1, gx0, GH, z1 + 0.5, 'sidingW');
  k.aabb(gx0 - T, 0, gz1 - 0.5, gx0, GH, gz1, 'sidingW');
  k.aabb(gx0 - T, 2.5, z1 + 0.5, gx0, GH, gz1 - 0.5, 'sidingW');
  k.aabb(gx0 - 2.6, 2.45, z1 + 0.6, gx0 - 0.3, 2.52, gz1 - 0.6, 'trim', { collide: false });
  k.aabb(gx1, GH, z1, gx0 + 0.3, GH + 0.15, gz1 + 0.3, 'ceiling', { faceMats: { py: o.roof } });
  k.ramp(gx1 - 0.3, GH + 0.15, z1, gx0 + 0.3, GH + 1.4, z1 + gw / 2, '+z', o.roof);
  k.ramp(gx1 - 0.3, GH + 0.15, z1 + gw / 2, gx0 + 0.3, GH + 1.4, gz1 + 0.3, '-z', o.roof);
  // Workbench, shelving, boxes, a drum.
  k.box(2.6, 0.95, 0.8, 'wood', gx1 + 2.2, 0, gz1 - T - 0.45);
  k.box(0.5, 1.9, 1.6, 'steel', gx1 + T + 0.3, 0, z1 + 1.4);
  k.box(1.0, 1.0, 1.0, 'crate', gx0 - 1.4, 0, gz1 - T - 0.6, { uv: 'raw' });
  k.box(0.8, 0.8, 0.8, 'crate', gx0 - 1.4, 1.0, gz1 - T - 0.6, { uv: 'raw', collide: false });
  k.cyl(0.3, 0.9, 8, 'barrel', gx1 + 1.0, 0.45, gz1 - 2.6);
  k.light((gx0 + gx1) / 2, 2.8, (z1 + gz1) / 2, [1.2, 1.15, 1.0], 7, 'house');

  // ---- back: balcony, its stairs, pergola ----
  const rail = { bullets: false, sight: false } as const;
  if (o.back === 'along') {
    // Balcony along the -z end of the back wall; stairs down along the wall to the patio.
    const bz0 = z0 + 0.1;
    const bz1 = z0 + 5.0;
    k.aabb(bx - 2.0, F2 - 0.2, bz0, bx, F2, bz1, 'deck');
    for (const z of [bz0 + 0.1, bz1 - 0.1]) k.box(0.18, F2 - 0.2, 0.18, 'deck', bx - 1.9, 0, z);
    k.aabb(bx - 2.0, F2, bz0, bx - 1.92, F2 + 1.0, bz1, 'deck', rail);
    k.aabb(bx - 2.0, F2, bz0, bx, F2 + 1.0, bz0 + 0.08, 'deck', rail);
    k.aabb(bx - 2.0, F2, bz1 - 0.08, bx - 1.25, F2 + 1.0, bz1, 'deck', rail);
    k.stairs(bx - 1.25, 0, bz1, bx - 0.05, F2, bz1 + 5.0, '-z', 'deck', 14);
    // Balusters up the outer edge of the stairs (the handrail is drawn by the posts' tops).
    for (let i = 0; i <= 5; i++) k.trim(0.07, 0.95, 0.07, 'deck', bx - 1.29, F2 * (1 - i / 5), bz1 + i * 0.98 + 0.05);
    // Pergola: posts and slats.
    for (const z of [bz0 + 0.1, bz1 - 0.1]) k.box(0.14, 2.4, 0.14, 'deck', bx - 1.9, F2, z, { collide: false });
    for (let z = bz0 + 0.3; z < bz1; z += 0.6) k.trim(2.3, 0.12, 0.08, 'deck', bx - 1.0, F2 + 2.4, z);
  } else {
    // Balcony at the garage end of the back wall; stairs straight out onto the ground deck.
    const bz0 = z1 - 3.4;
    const bz1 = z1 - 0.1;
    const sx = bx - 3.0;
    k.aabb(sx, F2 - 0.2, bz0, bx, F2, bz1, 'deck');
    for (const z of [bz0 + 0.1, bz1 - 0.1]) k.box(0.18, F2 - 0.2 - DECK, 0.18, 'deck', sx + 0.1, DECK, z);
    k.aabb(sx, F2, bz0, bx, F2 + 1.0, bz0 + 0.08, 'deck', rail);
    k.aabb(sx, F2, bz0, sx + 0.08, F2 + 1.0, bz1 - 1.4, 'deck', rail);
    k.stairs(sx - 4.6, DECK, bz1 - 1.3, sx, F2, bz1, '+x', 'deck', 13);
    for (const z of [bz0 + 0.1, bz1 - 0.1]) k.box(0.14, 2.4, 0.14, 'deck', sx + 0.1, F2, z, { collide: false });
    for (let x = sx + 0.3; x < bx; x += 0.6) k.trim(0.08, 0.12, bz1 - bz0 + 0.3, 'deck', x, F2 + 2.4, (bz0 + bz1) / 2);
    // Ground deck behind the main block and the garage.
    k.aabb(fx - 22.9, 0, zc - 3.9, bx, DECK, zc + 11.6, 'deck');
    k.aabb(bx, 0, z1, gx1, DECK, zc + 11.6, 'deck');
  }

  // ---- mannequins: living room, kitchen, upstairs window, garage, porch ----
  const cloth = o.team === 0 ? 'fabricB' : 'dress';
  k.mannequin(fx - 3.6, zc + 1.2, -PI / 2, 'mannequin', 0, cloth);
  k.mannequin(bx + 2.4, zc - 2.6, PI / 2, 'mannequin', 0, 'dress');
  k.mannequin(fx - 0.9, z0 + 2.3, -PI / 2, 'mannequin', F2, cloth);
  k.mannequin(gx0 - 2.4, z1 + 1.6, -PI / 2, 'mannequin', 0, 'fabricB');
  k.mannequin(fx + 0.9, p.doorZ + 1.4, -PI / 2, 'mannequin', 0.18, 'dress');
}

/** A car: lower body and cabin, wheels. `along` is its long axis. */
function car(k: MapKit, x: number, z: number, along: 'x' | 'z', mat: string, wagon = false) {
  const L = wagon ? 4.9 : 4.6;
  const W = 1.95;
  const [w, d] = along === 'z' ? [W, L] : [L, W];
  k.box(w, 0.72, d, mat, x, 0.3, z);
  const cl = wagon ? L * 0.68 : L * 0.48;
  const off = wagon ? 0.5 : 0;
  const [cw, cd] = along === 'z' ? [W - 0.2, cl] : [cl, W - 0.2];
  const [ox, oz] = along === 'z' ? [0, off] : [off, 0];
  k.box(cw, 0.5, cd, 'glass', x + ox, 1.02, z + oz, { faceMats: { py: mat } });
  for (const s of [-1, 1])
    for (const e of [-1, 1]) {
      const wx = along === 'z' ? x + s * (W / 2 - 0.05) : x + e * (L / 2 - 0.8);
      const wz = along === 'z' ? z + e * (L / 2 - 0.8) : z + s * (W / 2 - 0.05);
      k.cyl(0.34, 0.24, 10, 'rubber', wx, 0.34, wz, { axis: along === 'z' ? 'x' : 'z', collide: false });
    }
}

/** A white picket fence (0.9 m, jumpable): alpha decal + a player clip; bullets and sight pass. */
function picket(k: MapKit, axis: 'x' | 'z', a0: number, a1: number, c: number) {
  const len = a1 - a0;
  const mid = (a0 + a1) / 2;
  if (axis === 'x') {
    k.wallDecal(len, 0.9, 'picket', mid, 0, c, 0);
    k.clip(a0, 0, c - 0.06, a1, 0.9, c + 0.06, 'fence-low');
  } else {
    k.wallDecal(len, 0.9, 'picket', c, 0, mid, PI / 2);
    k.clip(c - 0.06, 0, a0, c + 0.06, 0.9, a1, 'fence-low');
  }
}

/** A 2 m wooden privacy fence on the lot line (solid), with a tall player clip above it. */
function privacy(k: MapKit, axis: 'x' | 'z', a0: number, a1: number, c: number, mat = 'woodfence') {
  if (axis === 'x') {
    k.aabb(a0, 0, c - 0.06, a1, 2.0, c + 0.06, mat);
    k.clip(a0, 2.0, c - 0.06, a1, 7, c + 0.06, 'perimeter');
  } else {
    k.aabb(c - 0.06, 0, a0, c + 0.06, 2.0, a1, mat);
    k.clip(c - 0.06, 2.0, a0, c + 0.06, 7, a1, 'perimeter');
  }
}

/** Chain-link on the lot line: players stop, bullets and sight pass. */
function chain(k: MapKit, axis: 'x' | 'z', a0: number, a1: number, c: number) {
  const len = a1 - a0;
  const mid = (a0 + a1) / 2;
  k.wallDecal(len, 2.6, 'chain', axis === 'x' ? mid : c, 0, axis === 'x' ? c : mid, axis === 'x' ? 0 : PI / 2);
  for (let a = a0; a <= a1 + 1e-6; a += len / Math.max(1, Math.round(len / 2.4))) k.box(0.1, 2.7, 0.1, 'steel', axis === 'x' ? a : c, 0, axis === 'x' ? c : a, { collide: false });
  if (axis === 'x') k.clip(a0, 0, c - 0.06, a1, 7, c + 0.06, 'perimeter');
  else k.clip(c - 0.06, 0, a0, c + 0.06, 7, a1, 'perimeter');
}

/** Garden bed: dirt with a low wooden border (0.25 m, stepped over) and flower clumps. */
function garden(k: MapKit, x0: number, z0: number, x1: number, z1: number) {
  k.flatDecal(x1 - x0, z1 - z0, 'dirt', (x0 + x1) / 2, 0.025, (z0 + z1) / 2);
  for (const [ax, az, bx, bz] of [[x0, z0, x1, z0 + 0.12], [x0, z1 - 0.12, x1, z1], [x0, z0, x0 + 0.12, z1], [x1 - 0.12, z0, x1, z1]] as const) k.aabb(ax, 0, az, bx, 0.25, bz, 'wood', { collide: false });
  for (let x = x0 + 0.8; x < x1 - 0.4; x += 1.4) for (let z = z0 + 0.8; z < z1 - 0.4; z += 1.6) k.trim(0.5, 0.45, 0.5, (Math.round(x * 7 + z * 3) & 1) ? 'dress' : 'hedge', x, 0, z);
}

/** The west lot: green house, garage, driveway, patio, screened porch, side yards, backyard. */
function greenLot(k: MapKit) {
  const o: HouseOpts = { fx: -9.6, zc: -7.6, siding: 'sidingG', upper: 'sidingW', plaster: 'plasterG', roof: 'roofG', garage: { setback: 3.0, depth: 7.2, width: 6.8 }, back: 'along', team: 0 };
  house(k, o);
  const p = plan(o);
  // Lawn, driveway, front walk, patio, the stepping-stone bed along the south side yard.
  k.flatDecal(38.5, 26, 'grass', -22.25, 0.012, -4);
  k.flatDecal(6.4, 6.0, 'concrete', -9.4, 0.02, (p.z1 + p.gz1) / 2);
  k.flatDecal(4.4, 1.3, 'concrete', -7.4, 0.022, p.doorZ);
  k.flatDecal(6.4, 10.4, 'concrete', -23.0, 0.02, -0.3);
  k.flatDecal(12.4, 3.6, 'dirt', -16.6, 0.022, 6.6);
  for (let i = 0; i < 9; i++) {
    const t = (i / 8) * PI;
    k.flatDecal(0.5, 0.5, 'concrete', -16.6 + Math.cos(t) * 5.2, 0.03, 6.8 - Math.sin(t) * 1.0, { seg: 1 });
  }
  // Car in the driveway, nose to the garage.
  car(k, -9.2, (p.z1 + p.gz1) / 2, 'x', 'carGreen');
  // Picket fence along the front lawn (north part, the south part is the driveway).
  picket(k, 'z', -15.0, -10.8, -6.2);
  // Firewood stack and a hedge by the front lawn.
  k.box(2.4, 0.9, 0.7, 'wood', -12.5, 0, -15.9);
  k.box(0.9, 1.1, 2.0, 'hedge', -24.6, 0, -15.6, { bullets: false });
  // Screened porch (green lattice) by the south fence, a shed on the north fence.
  const sx0 = -30.4;
  const sx1 = -27.2;
  const sz0 = 5.4;
  const sz1 = 8.7;
  for (const [ax, az, bx, bz] of [[sx0, sz0, sx1, sz0 + 0.1], [sx0, sz0, sx0 + 0.1, sz1], [sx1 - 0.1, sz0, sx1, sz1]] as const) {
    k.aabb(ax, 0, az, bx, 0.9, bz, 'lattice');
    k.aabb(ax, 0.9, az, bx, 2.3, bz, 'lattice', { bullets: false, sight: false });
  }
  for (const [x, z] of [[sx0, sz0], [sx1, sz0], [sx0, sz1], [sx1, sz1]] as const) k.box(0.12, 2.4, 0.12, 'trim', x + (x === sx0 ? 0.06 : -0.06), 0, z + (z === sz0 ? 0.06 : -0.06), { collide: false });
  k.aabb(sx0 - 0.2, 2.4, sz0 - 0.2, sx1 + 0.2, 2.55, sz1, 'sidingW');
  k.box(2.2, 2.3, 2.4, 'woodfence', -31.6, 0, -15.4);
  k.trim(2.6, 0.12, 2.8, 'roofG', -31.6, 2.3, -15.4);
  // Back garden: dirt bed with flowers inside a white fence with an arbor gate.
  garden(k, -41.1, -6.8, -38.9, 8.6);
  k.aabb(-38.6, 0, -6.9, -38.5, 1.7, -0.6, 'trim');
  k.aabb(-38.6, 0, 0.8, -38.5, 1.7, 8.7, 'trim');
  for (const z of [-0.6, 0.8]) k.box(0.18, 2.4, 0.18, 'trim', -38.55, 0, z, { collide: false });
  k.trim(0.5, 0.12, 1.8, 'trim', -38.55, 2.4, 0.1);
  // Trash cans by the patio, a picnic table, a barbecue drum.
  for (const z of [3.2, 3.9]) k.cyl(0.3, 0.9, 8, 'barrel', -21.2, 0.45, z);
  k.box(1.8, 0.75, 0.8, 'wood', -33.5, 0, -8.5);
  for (const dz of [-0.75, 0.75]) k.box(1.8, 0.42, 0.3, 'wood', -33.5, 0, -8.5 + dz);
  k.cyl(0.35, 0.95, 8, 'steel', -27.5, 0.48, -11.6);
  // Mannequins on the lawn, the patio, the backyard.
  k.mannequin(-7.4, -11.4, -PI / 2, 'mannequin', 0, 'fabricB');
  k.mannequin(-24.6, 1.6, PI, 'mannequin', 0, 'dress');
  k.mannequin(-35.2, -3.0, -PI / 2, 'mannequin');
}

/** The east lot (yellow house): the green plan turned half round, plus the yellow backyard. */
function yellowLot(k: MapKit) {
  const o: HouseOpts = { fx: -13.6, zc: 0.9, siding: 'sidingY', upper: 'sidingY', plaster: 'plasterY', roof: 'roofY', garage: { setback: 0, depth: 10.0, width: 8.2 }, back: 'out', team: 1 };
  k.with('rot180', () => house(k, o));
  // World coordinates from here on.
  k.flatDecal(40.5, 26, 'grass', 28.75, 0.012, -5.5);
  k.flatDecal(30, 5, 'grass', 0, 0.011, -19);
  k.flatDecal(6.2, 7.6, 'concrete', 10.6, 0.02, -9.8);
  k.flatDecal(4.6, 1.3, 'concrete', 11.4, 0.022, 0.1);
  // Picket fence along the south front lawn, a hedge row on the north side yard.
  picket(k, 'z', 0.9, 6.8, 9.2);
  k.box(0.9, 1.1, 2.0, 'hedge', 25.0, 0, -16.4, { bullets: false });
  // The yellow shed (north-east corner), sandbox, swing set, garden bed with a bench, AC unit.
  k.box(4.0, 2.4, 3.0, 'sidingY', 31.6, 0, -15.6);
  k.trim(4.4, 0.15, 3.4, 'roofY', 31.6, 2.4, -15.6);
  k.wallDecal(1.0, 1.9, 'wood', 31.6, 0, -14.09, 0);
  k.flatDecal(5.4, 4.4, 'sand', 37.4, 0.03, -14.4);
  for (const [ax, az, bx, bz] of [[34.7, -16.6, 40.1, -16.4], [34.7, -12.4, 40.1, -12.2], [34.7, -16.6, 34.9, -12.2], [39.9, -16.6, 40.1, -12.2]] as const) k.aabb(ax, 0, az, bx, 0.3, bz, 'wood');
  for (const x of [37.0, 40.2]) {
    k.box(0.12, 2.3, 0.12, 'steel', x, 0, -5.6, { collide: false });
    k.box(0.12, 2.3, 0.12, 'steel', x, 0, -4.2, { collide: false });
    k.box(0.14, 0.14, 1.6, 'steel', x, 0, -4.9);
  }
  k.trim(3.4, 0.12, 0.12, 'steel', 38.6, 2.3, -4.9);
  for (const x of [37.9, 39.3]) k.trim(0.5, 0.06, 0.25, 'wood', x, 0.6, -4.9);
  garden(k, 41.6, -5.6, 46.8, 6.4);
  k.box(2.6, 0.5, 0.6, 'wood', 44.2, 0, -4.4);
  k.box(1.0, 0.95, 1.0, 'steel', 32.4, 0, 5.8);
  for (const z of [5.4, 6.1]) k.cyl(0.3, 0.9, 8, 'barrel', 30.8, 0.45, z);
  // Mannequins on the lawn, the deck, the backyard.
  k.mannequin(10.4, -2.6, PI / 2, 'mannequin', 0, 'dress');
  k.mannequin(32.0, -8.0, PI / 2, 'mannequin', DECK, 'fabricB');
  k.mannequin(38.6, 2.4, PI / 2, 'mannequin');
}

/** The lot lines and the playable edge: privacy fences round the lots, chain-link across the street. */
function boundary(k: MapKit) {
  // Green lot.
  privacy(k, 'x', -38.6, -15.5, -16.7);
  privacy(k, 'z', -16.7, -6.9, -38.6);
  privacy(k, 'x', -41.3, -38.6, -6.9);
  privacy(k, 'z', -6.9, 8.8, -41.3);
  privacy(k, 'x', -41.3, -5.3, 8.8);
  privacy(k, 'z', -21.0, -16.7, -15.5);
  // Yellow lot.
  privacy(k, 'x', 14.0, 41.0, -17.5);
  privacy(k, 'z', -17.5, -6.0, 41.0);
  privacy(k, 'x', 41.0, 47.0, -6.0);
  privacy(k, 'z', -6.0, 6.8, 47.0);
  privacy(k, 'x', 12.0, 47.0, 6.8);
  privacy(k, 'z', -21.0, -17.5, 14.0);
  privacy(k, 'z', 6.8, 8.8, 12.0);
  privacy(k, 'x', 7.9, 12.0, 8.8);
  // North of the circle (behind the Welcome sign) and the end of the street stub.
  chain(k, 'x', -15.5, 14.0, -21.0);
  chain(k, 'z', 8.8, 17.4, -5.3);
  chain(k, 'z', 8.8, 17.4, 7.9);
  chain(k, 'x', -5.3, 7.9, 17.4);
}

/** The cul-de-sac: asphalt circle, the street stub, kerbs, the bus, the truck, cars, sign, lamps. */
function street(k: MapKit) {
  // Asphalt circle (overlapping turned squares), the sidewalk ring, the street to the south.
  for (const r of [0, PI / 8, PI / 4, (3 * PI) / 8]) k.flatDecal(17.6, 17.6, 'concrete', 0, 0.016 + r * 0.0005, 0, { ry: r });
  for (const r of [0, PI / 8, PI / 4, (3 * PI) / 8]) k.flatDecal(14.8, 14.8, 'asphalt', 0, 0.02 + r * 0.0005, 0, { ry: r });
  k.flatDecal(8.1, 40, 'asphalt', 1.35, 0.021, 26);
  k.flatDecal(2.1, 10, 'concrete', -3.75, 0.02, 13);
  k.flatDecal(2.1, 10, 'concrete', 6.45, 0.02, 13);
  for (let z = 9; z <= 40; z += 3.5) k.flatDecal(0.16, 1.8, 'line', 1.35, 0.035, z, { seg: 1 });
  // The road keeps going south past the barrier, between the neighbours' houses.
  k.flatDecal(8.1, 120, 'asphalt', 1.35, 0.02, 100);

  // School bus (green side of the circle, hood to the south): body, hood, roof, windows, wheels.
  const BX0 = -3.6;
  const BX1 = -1.0;
  k.aabb(BX0, 0.45, -0.5, BX1, 3.0, 8.2, 'bus');
  k.aabb(BX0 + 0.2, 0.45, 8.2, BX1 - 0.2, 1.9, 9.7, 'bus');
  k.trim(2.5, 0.1, 8.5, 'bus', (BX0 + BX1) / 2, 3.0, 3.85);
  for (const [x, ry] of [[BX0 - 0.01, -PI / 2], [BX1 + 0.01, PI / 2]] as const) k.wallDecal(7.6, 0.8, 'busWin', x, 1.85, 3.6, ry);
  k.wallDecal(2.2, 0.85, 'glass', (BX0 + BX1) / 2, 1.95, 8.21, PI);
  k.wallDecal(2.2, 0.8, 'busWin', (BX0 + BX1) / 2, 1.85, -0.51, 0);
  for (const z of [0.6, 2.4, 8.6])
    for (const x of [BX0 - 0.02, BX1 + 0.02]) k.cyl(0.5, 0.3, 10, 'rubber', x, 0.5, z, { axis: 'x', collide: false });
  k.trim(0.05, 0.45, 0.45, 'carRed', BX0 - 0.1, 1.5, 7.4);

  // Moving truck (yellow side): cab-over tractor to the south, box trailer (side door open) north.
  k.aabb(1.8, 0.5, -1.8, 4.3, 1.4, 2.6, 'carRed');
  k.aabb(1.85, 1.4, 0.4, 4.25, 2.9, 2.6, 'carRed', { faceMats: { pz: 'glass' } });
  k.wallDecal(2.0, 0.8, 'glass', 3.05, 1.9, 2.61, 0);
  k.aabb(2.2, 1.4, -1.8, 3.9, 2.4, 0.4, 'steel');
  for (const z of [-1.2, 1.6]) for (const x of [1.75, 4.35]) k.cyl(0.48, 0.3, 10, 'rubber', x, 0.48, z, { axis: 'x', collide: false });
  k.aabb(1.7, 1.1, -10.2, 4.4, 3.8, -2.2, 'trailer', { uv: 'raw', faceMats: { py: 'steel', nz: 'steel', pz: 'steel' } });
  k.aabb(1.9, 0.6, -10.0, 4.2, 1.1, -2.4, 'steel', { collide: false });
  k.wallDecal(1.4, 2.2, 'wood', 1.69, 1.2, -6.6, -PI / 2);
  for (const z of [-9.2, -7.9]) for (const x of [1.65, 4.45]) k.cyl(0.48, 0.3, 10, 'rubber', x, 0.48, z, { axis: 'x', collide: false });
  // Crates by the trailer's side door, a hand truck.
  k.box(1.0, 1.0, 1.0, 'crate', 0.6, 0, -8.9, { uv: 'raw' });
  k.box(0.8, 0.8, 0.8, 'crate', 0.6, 0, -7.7, { uv: 'raw' });

  // Cars: one in the neighbour's driveway north of the circle, one across the street stub.
  car(k, -0.2, -14.0, 'z', 'carBlue', true);
  car(k, 1.0, 13.9, 'x', 'carRed');

  // "Welcome to Nuketown" sign at the circle's edge just north of the green front walk, facing
  // the circle: brick base, board, posts with balls.
  const SZ = -11.0;
  k.box(0.5, 0.6, 4.2, 'brick', -4.6, 0, SZ);
  k.box(0.25, 1.9, 3.6, 'sign', -4.6, 0.6, SZ, { faceMats: { nx: 'cream', pz: 'cream', nz: 'cream', py: 'cream' } });
  k.wallDecal(3.5, 1.8, 'sign', -4.46, 0.65, SZ, PI / 2, { uv: 'raw' });
  for (const z of [SZ - 2.1, SZ + 2.1]) {
    k.box(0.4, 2.6, 0.4, 'cream', -4.6, 0, z);
    k.trim(0.45, 0.45, 0.45, 'cream', -4.6, 2.6, z);
  }
  // Road barrier and a sawhorse at the end of the stub.
  for (const x of [-2.8, 1.35, 5.5]) k.box(1.8, 0.9, 0.4, 'hazard', x, 0, 16.6, { uv: 'raw' });

  // Street lamps and mailboxes.
  for (const [x, z, dir] of [[-8.8, -13.8, 1], [7.2, 9.6, -1]] as const) {
    k.box(0.2, 6.2, 0.2, 'steel', x, 0, z);
    k.trim(1.6, 0.1, 0.16, 'steel', x + dir * 0.7, 6.1, z);
    k.trim(0.6, 0.15, 0.35, 'lamp', x + dir * 1.3, 5.95, z);
    k.light(x + dir * 1.3, 5.6, z, [1.7, 1.2, 0.6], 16, 'street');
    k.glow(x + dir * 1.3, 5.85, z, [0.85, 0.6, 0.3], 2.6, 'street');
  }
  for (const [x, z] of [[-6.6, -5.0], [9.6, 2.2]] as const) {
    k.box(0.1, 1.1, 0.1, 'wood', x, 0, z, { collide: false });
    k.trim(0.5, 0.3, 0.25, 'steel', x, 1.1, z);
  }

  // Mannequins round the circle.
  k.mannequin(-0.4, 11.6, PI, 'mannequin', 0, 'dress');
  k.mannequin(5.6, -4.8, PI / 2, 'mannequin', 0, 'fabricB');
  k.mannequin(-5.6, 6.2, 0, 'mannequin');
  k.mannequin(-1.6, -15.6, 0, 'mannequin', 0, 'dress');
}

/** Everything outside the fences: the neighbours' houses, desert, test tower, poles, mountains. */
function backdrop(k: MapKit) {
  // Neighbours (render only): the pink house north-west, the red-garage house behind the sign,
  // the blue and brown houses along the road south.
  const shell = (x0: number, z0: number, x1: number, z1: number, mat: string, roof: string, h = 3.2) => {
    k.aabb(x0, 0, z0, x1, h, z1, mat, { collide: false });
    const along = x1 - x0 > z1 - z0;
    if (along) {
      k.ramp(x0 - 0.4, h, z0 - 0.4, x1 + 0.4, h + 2.0, (z0 + z1) / 2, '+z', roof, { collide: false });
      k.ramp(x0 - 0.4, h, (z0 + z1) / 2, x1 + 0.4, h + 2.0, z1 + 0.4, '-z', roof, { collide: false });
    } else {
      k.ramp(x0 - 0.4, h, z0 - 0.4, (x0 + x1) / 2, h + 2.0, z1 + 0.4, '+x', roof, { collide: false });
      k.ramp((x0 + x1) / 2, h, z0 - 0.4, x1 + 0.4, h + 2.0, z1 + 0.4, '-x', roof, { collide: false });
    }
  };
  shell(-36, -36, -18, -24, 'pink', 'roofG');
  shell(-10, -34, 10, -22, 'sidingW', 'roofY');
  k.wallDecal(3.0, 2.3, 'carRed', 4, 0, -21.98, 0);
  shell(12, 10.5, 27, 23, 'blue', 'roofG');
  shell(-25, 11, -11, 24, 'sidingW', 'roofY');
  // Power poles along the road.
  for (let z = 26; z < 150; z += 16) {
    k.cyl(0.18, 9, 6, 'wood', -6.5, 4.5, z, { collide: false });
    k.trim(2.6, 0.16, 0.16, 'wood', -6.5, 8.2, z);
  }
  // Test-site tower (north-east) and a bunker mound with a periscope (north-west).
  const tx = 62;
  const tz = -64;
  for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]] as const) k.trim(0.5, 34, 0.5, 'steel', tx + dx, 0, tz + dz);
  for (let y = 6; y < 34; y += 7) {
    k.trim(6.5, 0.3, 0.3, 'steel', tx, y, tz - 3);
    k.trim(6.5, 0.3, 0.3, 'steel', tx, y, tz + 3);
    k.trim(0.3, 0.3, 6.5, 'steel', tx - 3, y, tz);
    k.trim(0.3, 0.3, 6.5, 'steel', tx + 3, y, tz);
  }
  k.trim(7.5, 3.5, 7.5, 'cream', tx, 34, tz);
  k.glow(tx, 38.2, tz, [1, 0.12, 0.08], 4, undefined, true);
  k.ramp(-80, 0, -60, -68, 4, -48, '+x', 'sand', { collide: false });
  k.ramp(-68, 0, -60, -56, 4, -48, '-x', 'sand', { collide: false });
  k.trim(0.4, 2.5, 0.4, 'steel', -68, 4, -54);
  // Mountains: two rings of silhouette cards, the far range taller and hazier.
  k.backdropRing('mountainsFar', 185, 9, 150, 60, -3, 0.3);
  k.backdropRing('mountains', 135, 11, 95, 34, -2);
}

/** Domination, S&D and HQ points (callouts in docs/maps/nuketown-reference.md). */
const P = (id: string, x: number, y: number, z: number, radius: number, team?: 0 | 1): ObjectivePoint => (team === undefined ? { id, x, y, z, radius } : { id, x, y, z, radius, team });

export function buildNuketown(): MapData {
  const k = new MapKit();
  // Desert ground: one slab, top at y = 0, out to the horizon.
  k.aabb(-200, -1, -200, 200, 0, 200, 'sand', { hide: ['nx', 'px', 'ny', 'nz', 'pz'] });
  k.perimeter(NUKETOWN_BOUNDS, 14);

  greenLot(k);
  yellowLot(k);
  boundary(k);
  street(k);
  backdrop(k);

  // ---- spawns: team 0 in the green garden/backyard, team 1 in the yellow one ----
  const E = -PI / 2;
  const W = PI / 2;
  const team0: SpawnPoint[] = [[-40.0, -3.0], [-37.0, -1.0], [-37.0, 3.0], [-40.0, 5.0], [-34.0, -13.5], [-34.5, 5.8], [-30.5, -12.0], [-33.0, 1.5]].map(([x, z]) => ({ x: x!, y: 0, z: z!, yaw: E }));
  const team1: SpawnPoint[] = [[44.0, -1.0], [44.0, 3.4], [37.4, -14.4], [38.6, -10.0], [40.0, -1.0], [40.0, 4.0], [43.0, -3.6], [38.0, -7.0]].map(([x, z]) => ({ x: x!, y: 0, z: z!, yaw: W }));
  const ffa: SpawnPoint[] = [
    { x: -35.5, y: 0, z: -12.5, yaw: yawTo(-35.5, -12.5, 0, 0) },
    { x: -26.5, y: 0, z: 6.8, yaw: E },
    { x: -18.5, y: F2, z: -9.0, yaw: E },
    { x: -16.0, y: 0, z: 1.0, yaw: E },
    { x: -12.0, y: 0, z: -14.6, yaw: yawTo(-12, -14.6, 0, 0) },
    { x: -8.0, y: 0, z: 7.6, yaw: 0 },
    { x: -9.0, y: 0, z: -19.4, yaw: PI },
    { x: 9.0, y: 0, z: -19.0, yaw: PI },
    { x: 4.6, y: 0, z: 15.8, yaw: 0 },
    { x: 18.6, y: 0, z: -12.0, yaw: W },
    { x: 16.8, y: F2, z: 0.4, yaw: W },
    { x: 24.0, y: 0, z: 5.4, yaw: W },
    { x: 34.0, y: DECK, z: -2.0, yaw: W },
    { x: 37.0, y: 0, z: -15.6, yaw: yawTo(37, -15.6, 0, 0) },
  ];

  // ---- objectives ----
  // Domination: A by the green patio, B in the circle between the bus and the trailer, C off the yellow deck.
  const dom = [P('A', -28.0, 0, -1.5, 3), P('B', -0.3, 0, -4.0, 3), P('C', 38.0, 0, -0.5, 3)];
  // S&D (BO1 sites): A in the yellow garage, B at the front of the bus; defenders hold the yellow side.
  const sd = [P('A', 18.2, 0, -9.6, 1.6, 1), P('B', -1.6, 0, 11.4, 1.6, 1)];
  const hq = [
    P('hq1', 0.0, 0, -6.0, 3.5),
    P('hq2', -16.0, 0, 0.6, 3),
    P('hq3', 18.6, 0, -9.8, 3),
    P('hq4', -20.4, F2, -9.6, 2.5),
    P('hq5', 21.0, F2, -2.0, 2.5),
    P('hq6', -26.0, 0, -14.4, 3),
    P('hq7', 28.0, 0, 5.0, 2.2),
    P('hq8', -2.5, 0, -19.0, 3),
    P('hq9', 1.4, 0, 11.0, 3),
  ];
  const attackers = team0;
  const defenders: SpawnPoint[] = [[38.6, -10.0], [40.0, -1.0], [40.0, 4.0], [44.0, -1.0], [44.0, 3.4], [37.4, -14.4], [21.0, -15.6], [24.6, 5.4]].map(([x, z]) => ({ x: x!, y: 0, z: z!, yaw: W }));

  return {
    id: 'nuketown',
    name: 'Nuketown',
    bounds: NUKETOWN_BOUNDS,
    materials: MATERIALS,
    brushes: k.brushes,
    decals: k.decals,
    props: k.props,
    lights: k.lights,
    spawns: { teams: [team0, team1], ffa },
    objectives: { dom, sd, hq },
    modeSpawns: { sd: { attackers, defenders } },
    times: [
      { id: 'noon', name: 'Desert Noon', clock: '12:20', sky: 'nt_skyNoon', unlit: [1, 1, 0.96], skyRot: 0, sunDir: unitVec(0.35, 0.88, 0.3), sun: [1.25, 1.14, 0.95], amb: [0.56, 0.56, 0.6], fog: [0.86, 0.8, 0.7], fogNear: 45, fogFar: 190, lights: { house: 0.35, porch: 0, street: 0 }, glow: 0 },
      { id: 'dusk', name: 'Dusk', clock: '19:40', sky: 'nt_skyDusk', unlit: [1, 0.86, 0.76], skyRot: 0, sunDir: unitVec(-0.88, 0.32, 0.25), sun: [1.2, 0.62, 0.36], amb: [0.3, 0.25, 0.34], fog: [0.78, 0.48, 0.38], fogNear: 30, fogFar: 160, lights: { house: 1, porch: 1, street: 1 }, glow: 0.9 },
    ],
    defaultTime: 'noon',
    hotspots: [
      { x: -0.3, y: 0, z: -4.0 },
      { x: -16.0, y: 0, z: 0.6 },
      { x: 18.6, y: 0, z: -9.8 },
      { x: -18.0, y: F2, z: -5.0 },
      { x: 18.0, y: F2, z: 0.0 },
      { x: -20.0, y: F2, z: -10.0 },
      { x: 23.5, y: F2, z: -2.0 },
      { x: -24.0, y: 0, z: -14.6 },
      { x: 24.0, y: 0, z: 5.4 },
      { x: -16.0, y: 0, z: 6.6 },
      { x: 20.0, y: 0, z: -15.6 },
      { x: -2.5, y: 0, z: -19.0 },
      { x: 1.4, y: 0, z: 11.0 },
      { x: -28.0, y: 0, z: -1.5 },
      { x: 34.0, y: DECK, z: -2.0 },
    ],
  };
}
