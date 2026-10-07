/**
 * Nuketown (recreation of Black Ops 1's Nuketown, owner: maps-bo). A model-home cul-de-sac on an
 * atomic test range: the green two-storey house on the west, the yellow one on the east, facing
 * each other across one short street. Each house has an attached garage (open, with a door into
 * the living room), a front lawn behind a white picket fence, and a fenced backyard where its team
 * starts. The school bus is parked on the west side of the street at the south end; at the north
 * end a pickup has towed a camper into the turning circle; a station wagon and a sedan sit in the
 * middle. Mannequins everywhere. Beyond the fences: desert, the test-site tower, mountains.
 *
 * The two lots are the same plan turned half round about the middle of the street (MapKit
 * 'rot180'), so neither team has the better of it. Lanes: the street (bus lane down the bus's long
 * side), through the houses (front door, living room, kitchen, back door; upstairs windows over the
 * street and the backyard), and the side yards round both ends of each house.
 *
 * Layout (metres, +x east, +z south, yaw 0 faces north/-z):
 *   x = -37 .. -27   green backyard (team 0 spawns), z = -15 .. 12 inside low picket fences
 *   x = -27 .. -16   green house z = -11 .. 1 (upper floor 3.3 m, stairs along the north wall)
 *   x = -27 .. -18   its garage z = 1 .. 8 (door onto the driveway at x = -18)
 *   x = -16 .. -8.5  front lawn and driveway; sidewalks |x| = 6 .. 8; street |x| < 6
 *   turning circle   centre (0, -19); the camper and pickup at x = 2.3 .. 4.7, z = -18.5 .. -5.6
 *   school bus       x = -5.4 .. -2.8, z = 5.6 .. 18.5
 *   east half        the west half turned round (yellow house, team 1)
 */
import { MapKit, yawTo, type Hole } from './bo-kit';
import { unitVec, type MapData, type MaterialDef, type ObjectivePoint, type SpawnPoint } from './types';

const PI = Math.PI;

/** Upper floor walking height and slab underside. */
const F2 = 3.3;
const SLAB = 3.0;
/** Wall top (eaves). */
const EAVE = 6.3;
const T = 0.25;

export const NUKETOWN_BOUNDS = { min: { x: -37.5, y: -2, z: -25.5 }, max: { x: 37.5, y: 24, z: 25.5 } };

const MATERIALS: Record<string, MaterialDef> = {
  sand: { texture: 'nt_sand', uvMul: [1 / 6, 1 / 6] },
  grass: { texture: 'nt_grass', tint: 0xb8e090, uvMul: [1 / 4, 1 / 4] },
  asphalt: { texture: 'nt_asphalt', uvMul: [1 / 5, 1 / 5] },
  concrete: { texture: 'bo_concrete', uvMul: [1 / 3, 1 / 3] },
  line: { texture: 'paint', uvMul: [2, 2] },
  sidingG: { texture: 'nt_siding', tint: 0x9ccfa4, uvMul: [1 / 2.4, 1 / 2.4] },
  sidingY: { texture: 'nt_siding', tint: 0xf4d462, uvMul: [1 / 2.4, 1 / 2.4] },
  trim: { texture: 'nt_trim', uvMul: [1 / 1.5, 1 / 1.5] },
  roofG: { texture: 'nt_roof', tint: 0x7d8d92, uvMul: [1 / 3, 1 / 3] },
  roofY: { texture: 'nt_roof', tint: 0x9a7458, uvMul: [1 / 3, 1 / 3] },
  floor: { texture: 'nt_floor', uvMul: [1 / 2, 1 / 2] },
  plasterG: { texture: 'nt_plaster', tint: 0xdcefdc, uvMul: [1 / 3, 1 / 3] },
  plasterY: { texture: 'nt_plaster', tint: 0xf6ead0, uvMul: [1 / 3, 1 / 3] },
  ceiling: { texture: 'nt_plaster', uvMul: [1 / 3, 1 / 3] },
  brick: { texture: 'nt_brick', uvMul: [1 / 1.2, 1 / 1.2] },
  picket: { texture: 'nt_picket', side: 'double', uvMul: [1, 1 / 0.9] },
  woodfence: { texture: 'nt_woodfence', uvMul: [1 / 2, 1 / 2] },
  chain: { texture: 'fence', side: 'double' },
  bus: { texture: 'nt_bus', uvMul: [1 / 3, 1 / 2.55] },
  busWin: { texture: 'nt_busWin', uvMul: [1 / 1.2, 1] },
  carBlue: { texture: 'bo_carpaint', tint: 0x6f9ec0 },
  carRed: { texture: 'bo_carpaint', tint: 0xc0563f },
  truck: { texture: 'bo_carpaint', tint: 0x5f9c8c },
  camper: { texture: 'bo_carpaint', tint: 0xf0e8d2 },
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
  sign: { texture: 'nt_sign', emissive: 0.35 },
  lamp: { texture: 'lamp', emissive: 1 },
  hazard: { texture: 'hazard', uvMul: [1 / 0.6, 1 / 0.6] },
  crate: { texture: 'crate', uvMul: [1 / 1.2, 1 / 1.2] },
  barrel: { texture: 'barrel', tint: 0xc9a02f, uvMul: [2, 1] },
  clip: { texture: 'none' },
};

/** Window and door holes, wall-local (along, y above the wall base). */
const door = (a: number, w = 1.2): Hole => ({ a0: a - w / 2, a1: a + w / 2, y0: 0, y1: 2.2 });
const win = (a0: number, a1: number, up = false): Hole => (up ? { a0, a1, y0: F2 + 0.9, y1: F2 + 2.3 } : { a0, a1, y0: 0.95, y1: 2.2 });

/**
 * One lot written for the west (green) side; the east (yellow) side is the same call under
 * 'rot180'. `c` picks the colours.
 */
function lot(k: MapKit, c: { siding: string; plaster: string; roof: string; car: string; team: 0 | 1 }) {
  const ext = c.siding;
  const int = c.plaster;
  const thin = { collide: false } as const;

  // ---- ground decals: lawns, sidewalk, driveway, path, house floors ----
  k.flatDecal(29, 50, 'grass', -22.5, 0.012, 0);
  k.flatDecal(2, 50, 'concrete', -7, 0.02, 0);
  k.flatDecal(10, 5.8, 'concrete', -13, 0.022, 4.5);
  k.flatDecal(7.2, 1.4, 'concrete', -12.2, 0.022, -4);
  k.flatDecal(4, 2, 'concrete', -29, 0.022, -7.6);
  k.flatDecal(10.6, 11.6, 'floor', -21.5, 0.03, -5);
  k.flatDecal(8.6, 6.6, 'concrete', -22.5, 0.03, 4.5);

  // ---- the house: x -27..-16, z -11..1 ----
  const H = EAVE;
  // Front (street) wall at x = -16.125, along z.
  k.wall('z', -11, 1, -16.125, 0, H, T, ext, [door(-4), win(-9.6, -6.4), win(-9.4, -6.6, true), win(-3, -0.8, true)], { faceMats: { nx: int } });
  // Back wall at x = -26.875.
  k.wall('z', -11, 1, -26.875, 0, H, T, ext, [door(-7.6), win(-4.2, -1.6), win(-8.6, -6, true), win(-3, -1, true)], { faceMats: { px: int } });
  // North wall at z = -10.875 (behind the stairs), along x.
  k.wall('x', -26.75, -16.25, -10.875, 0, H, T, ext, [win(-26, -24.2), win(-26, -24.2, true), win(-20.5, -18.5, true)], { faceMats: { pz: int } });
  // South wall at z = 0.875 (the garage side): door into the garage, an upstairs window over the driveway.
  k.wall('x', -26.75, -16.25, 0.875, 0, H, T, ext, [door(-19.95, 1.1), win(-17.9, -16.7, true), win(-25.5, -23.5, true)], { faceMats: { nz: int } });
  // Foundation skirt and corner boards.
  k.trim(11.3, 0.35, 12.3, 'brick', -21.5, 0, -5, { hide: ['py', 'ny'] });
  for (const [x, z] of [[-16, -11], [-27, -11], [-16, 1], [-27, 1]] as const) k.trim(0.3, H, 0.3, 'trim', x, 0, z);
  k.trim(11.4, 0.25, 12.4, 'trim', -21.5, SLAB, -5, { hide: ['ny', 'py'] });

  // Ground floor partition (living room | kitchen) at x = -22, with a wide arch.
  k.wall('z', -9.55, 0.75, -22, 0, SLAB, 0.15, int, [{ a0: -5.6, a1: -3.4, y0: 0, y1: 2.3 }]);

  // Stairs along the north wall, low at the front: x -17.6 .. -23 rising to the west.
  k.stairs(-23, 0, -10.75, -17.6, F2, -9.55, '-x', 'wood', 15);
  // Upper floor slab with the stairwell open (A: south of the stairs, B: landing, C: over the foot).
  const slab = { faceMats: { py: 'floor', ny: 'ceiling' } };
  k.aabb(-26.75, SLAB, -9.55, -16.25, F2, 0.75, int, slab);
  k.aabb(-26.75, SLAB, -10.75, -23, F2, -9.55, int, slab);
  k.aabb(-17.6, SLAB, -10.75, -16.25, F2, -9.55, int, slab);
  // Stairwell railing (players can't drop into the stairwell; bullets and sight pass).
  k.aabb(-23, F2, -9.55, -17.6, F2 + 1, -9.47, 'trim', { bullets: false, sight: false });
  k.aabb(-17.68, F2, -10.75, -17.6, F2 + 1, -9.47, 'trim', { bullets: false, sight: false });
  // Upstairs partition (north bedroom | south bedroom), door near the hall.
  k.wall('x', -26.75, -19, -4, F2, H - F2, 0.15, int, [door(-20.2, 1.1)]);
  // Ceiling under the roof.
  k.aabb(-26.75, H - 0.15, -10.75, -16.25, H, 0.75, 'ceiling', { hide: ['py'] });

  // Gable roof, ridge along z.
  k.ramp(-27.6, H, -11.6, -21.5, H + 2.6, 1.6, '+x', c.roof);
  k.ramp(-21.5, H, -11.6, -15.4, H + 2.6, 1.6, '-x', c.roof);
  k.trim(0.9, 3.6, 0.9, 'brick', -24.2, H - 0.4, -10.2);
  // Front porch: step, posts, little roof, lamp.
  k.box(1.6, 0.2, 3.2, 'concrete', -15.2, 0, -4);
  for (const z of [-5.4, -2.6]) k.box(0.14, 2.6, 0.14, 'trim', -14.6, 0.2, z);
  k.trim(1.8, 0.16, 3.6, c.roof, -15.1, 2.8, -4);
  k.trim(0.2, 0.3, 0.2, 'lamp', -15.85, 2.25, -5.1);
  k.light(-15.4, 2.3, -5.1, [1.5, 1.15, 0.7], 7, 'porch');

  // Window frames on the street side (trim only).
  for (const [z0, z1, y0, y1] of [[-9.6, -6.4, 0.95, 2.2], [-9.4, -6.6, F2 + 0.9, F2 + 2.3], [-3, -0.8, F2 + 0.9, F2 + 2.3]] as const) {
    k.trim(0.12, 0.12, z1 - z0 + 0.3, 'trim', -15.96, y0 - 0.12, (z0 + z1) / 2);
    k.trim(0.12, 0.12, z1 - z0 + 0.3, 'trim', -15.96, y1, (z0 + z1) / 2);
  }

  // Ground floor furniture: couch under the front window, coffee table, TV cabinet, kitchen.
  k.box(0.9, 0.85, 2.4, 'fabric', -16.75, 0, -8, { sight: false });
  k.box(0.6, 0.42, 1.1, 'wood', -18.6, 0, -8);
  k.box(0.45, 1.1, 1.6, 'wood', -21.6, 0, -7.8);
  k.box(4.5, 0.95, 0.6, 'wood', -24.5, 0, 0.45);
  k.box(1.9, 0.95, 0.9, 'wood', -24.4, 0, -4.8);
  k.box(0.8, 1.9, 0.7, 'trim', -26.3, 0, -10.35);
  k.box(1.2, 0.76, 0.9, 'wood', -24.4, 0, -1.9, { sight: false });
  // Upstairs: two beds, a dresser, a wardrobe.
  k.box(1.6, 0.6, 2.1, 'fabricB', -20.4, F2, -7.2, { sight: false });
  k.box(2.1, 0.6, 1.6, 'fabric', -25.4, F2, -1.6, { sight: false });
  k.box(1.4, 1.0, 0.5, 'wood', -17.4, F2, 0.45);
  k.box(0.6, 2.0, 1.4, 'wood', -26.4, F2, -6.4);

  // Interior lights.
  k.light(-19, 2.6, -5, [1.3, 1.1, 0.8], 8, 'house');
  k.light(-24.4, 2.6, -5, [1.3, 1.1, 0.8], 8, 'house');
  k.light(-21.5, F2 + 2.6, -7.5, [1.25, 1.05, 0.8], 8, 'house');
  k.light(-21.5, F2 + 2.6, -1.5, [1.25, 1.05, 0.8], 8, 'house');

  // ---- garage: x -27..-18, z 1..8, open onto the driveway ----
  const GH = 3.2;
  k.wall('z', 1, 8, -26.875, 0, GH, T, ext, [{ a0: 3.6, a1: 5.4, y0: 1.2, y1: 2.0 }], { faceMats: { px: 'concrete' } });
  k.wall('x', -27, -18, 7.875, 0, GH, T, ext, [], { faceMats: { nz: 'concrete' } });
  k.wall('z', 1, 8, -18.125, 0, GH, T, ext, [{ a0: 1.5, a1: 7.5, y0: 0, y1: 2.55 }], { faceMats: { nx: 'concrete' } });
  k.aabb(-27.3, GH, 0.9, -17.85, GH + 0.25, 8.3, c.roof, { faceMats: { ny: 'ceiling' } });
  k.trim(0.12, 0.5, 6.2, 'trim', -17.95, 2.5, 4.5);
  // Raised door panel just under the garage ceiling.
  k.trim(0.1, 0.08, 6, 'trim', -18.6, 2.55, 4.5);
  k.aabb(-25.6, 2.6, 1.6, -18.4, 2.66, 7.4, 'trim', { collide: false });
  // Workbench, shelving, boxes.
  k.box(0.8, 0.95, 2.6, 'wood', -26.3, 0, 5.2);
  k.box(0.5, 1.9, 1.6, 'steel', -26.5, 0, 2.2);
  k.box(1.0, 1.0, 1.0, 'crate', -20, 0, 6.9, { uv: 'raw' });
  k.box(0.8, 0.8, 0.8, 'crate', -19.9, 1.0, 6.95, { uv: 'raw', collide: false });
  k.cyl(0.3, 0.9, 8, 'barrel', -23.6, 0.45, 7.3);
  k.light(-22.5, 2.9, 4.5, [1.2, 1.15, 1.0], 7, 'house');

  // ---- car on the driveway ----
  car(k, -13, 4.5, 'z', c.car, false);

  // ---- fences ----
  // Front picket fence along the sidewalk (gaps at the path and the driveway).
  picket(k, 'z', -14.5, -5.2, -8.6);
  picket(k, 'z', -2.8, 0.9, -8.6);
  picket(k, 'x', -16, -8.6, -14.5);
  // Backyard pickets (side yards are the flanks; gaps by the house corners).
  picket(k, 'x', -37, -30.2, -15);
  picket(k, 'x', -37, -31.2, 12);
  picket(k, 'z', 8, 12, -27.4);
  // Wooden privacy fence round the back and the ends of the lot.
  privacy(k, 'z', -25, 25, -37.1);
  privacy(k, 'x', -37.1, -8.8, -25.1);
  privacy(k, 'x', -37.1, -8.8, 25.1);

  // ---- backyard props ----
  k.box(1.8, 0.75, 0.8, 'wood', -31.5, 0, -9.5);
  for (const dz of [-0.75, 0.75]) k.box(1.8, 0.42, 0.3, 'wood', -31.5, 0, -9.5 + dz);
  k.cyl(0.35, 0.95, 8, 'steel', -28.6, 0.48, -3.2);
  // Garden shed in the north-west corner of the side yard.
  k.box(3.4, 2.4, 3.2, 'woodfence', -35.2, 0, -22.9);
  k.trim(3.8, 0.15, 3.6, c.roof, -35.2, 2.4, -22.9);
  // Kiddie pool and a swing frame in the south side yard.
  k.cyl(1.2, 0.35, 12, 'fabricB', -22, 0.18, 16.5, { collide: false });
  for (const x of [-31.5, -28.5]) k.box(0.12, 2.2, 0.12, 'steel', x, 0, 18.5);
  k.trim(3.3, 0.12, 0.12, 'steel', -30, 2.2, 18.5);
  // Hedges along the side yards' street ends.
  k.box(1.2, 1.1, 3.4, 'grass', -11.5, 0, -19.5, { bullets: false, sight: true });
  k.box(1.2, 1.1, 3.4, 'grass', -11.5, 0, 19, { bullets: false, sight: true });

  // ---- mannequins: lawn, porch, living room, kitchen, upstairs window, backyard, driveway ----
  const cloth = c.team === 0 ? 'fabricB' : 'dress';
  k.mannequin(-12, -10.5, -PI / 2, 'mannequin', 0, cloth);
  k.mannequin(-10.4, -0.8, -PI / 2, 'mannequin');
  k.mannequin(-14.3, -6.3, -PI / 2, 'mannequin', 0, 'dress');
  k.mannequin(-18.4, -2.2, 0, 'mannequin', 0, cloth);
  k.mannequin(-25.2, -3.4, PI / 2, 'mannequin', 0, 'dress');
  k.mannequin(-17.0, -8.4, -PI / 2, 'mannequin', F2, cloth);
  k.mannequin(-33.6, 3.4, -PI / 2, 'mannequin');
  k.mannequin(-16.6, 7.2, -PI / 2, 'mannequin', 0, cloth);
}

/** A car: lower body and cabin, wheels. `along` is its long axis. */
function car(k: MapKit, x: number, z: number, along: 'x' | 'z', mat: string, wagon: boolean) {
  const L = wagon ? 4.8 : 4.4;
  const W = 1.9;
  const [w, d] = along === 'z' ? [W, L] : [L, W];
  k.box(w, 0.7, d, mat, x, 0.3, z);
  const cl = wagon ? L * 0.7 : L * 0.5;
  const off = wagon ? 0.5 : 0;
  const [cw, cd] = along === 'z' ? [W - 0.2, cl] : [cl, W - 0.2];
  const [ox, oz] = along === 'z' ? [0, off] : [off, 0];
  k.box(cw, 0.5, cd, 'glass', x + ox, 1.0, z + oz, { faceMats: { py: mat } });
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

/** A 2 m wooden privacy fence (solid). */
function privacy(k: MapKit, axis: 'x' | 'z', a0: number, a1: number, c: number) {
  if (axis === 'x') k.aabb(a0, 0, c - 0.05, a1, 2.0, c + 0.05, 'woodfence');
  else k.aabb(c - 0.05, 0, a0, c + 0.05, 2.0, a1, 'woodfence');
}

/** The street: asphalt, turning circle, lines, lamps, the bus, the camper rig, the cars. */
function street(k: MapKit) {
  k.flatDecal(12, 50, 'asphalt', 0, 0.02, 0);
  for (const r of [0, PI / 6, PI / 3]) k.flatDecal(12.5, 12.5, 'asphalt', 0, 0.021 + r * 0.001, -18, { ry: r });
  for (let z = -10; z <= 24; z += 4) k.flatDecal(0.16, 2, 'line', 0, 0.035, z, { seg: 1 });
  // The road keeps going south past the gate into the desert (backdrop).
  k.flatDecal(10, 120, 'asphalt', 0, 0.02, 86);
  // Kerbs.
  for (const s of [-1, 1]) k.trim(0.2, 0.12, 50, 'concrete', s * 6.05, 0, 0);

  // Street lamps.
  for (const [x, z, dir] of [[-7.3, -12, 1], [7.3, 12, -1]] as const) {
    k.box(0.2, 6.4, 0.2, 'steel', x, 0, z);
    k.trim(1.6 * 1, 0.1, 0.16, 'steel', x + dir * 0.7, 6.3, z);
    k.trim(0.6, 0.15, 0.35, 'lamp', x + dir * 1.3, 6.15, z);
    k.light(x + dir * 1.3, 5.8, z, [1.7, 1.2, 0.6], 16, 'street');
    k.glow(x + dir * 1.3, 6.05, z, [0.85, 0.6, 0.3], 2.6, 'street');
  }

  // School bus (west side, south end): hood + body, windows, wheels, stop arm.
  const BX0 = -5.4;
  const BX1 = -2.8;
  k.aabb(BX0 + 0.2, 0.45, 5.6, BX1 - 0.2, 1.9, 7, 'bus');
  k.aabb(BX0, 0.45, 7, BX1, 3.0, 18.5, 'bus');
  k.trim(2.5, 0.1, 11.4, 'bus', (BX0 + BX1) / 2, 3.0, 12.75);
  for (const [x, ry] of [[BX0 - 0.01, -PI / 2], [BX1 + 0.01, PI / 2]] as const) k.wallDecal(10.4, 0.8, 'busWin', x, 1.85, 13.0, ry);
  k.wallDecal(2.2, 0.85, 'glass', (BX0 + BX1) / 2, 1.95, 6.99, PI);
  k.wallDecal(2.2, 0.8, 'busWin', (BX0 + BX1) / 2, 1.85, 18.51, 0);
  for (const z of [6.4, 9.0, 16.8])
    for (const x of [BX0 - 0.02, BX1 + 0.02]) k.cyl(0.5, 0.3, 10, 'rubber', x, 0.5, z, { axis: 'x', collide: false });
  k.trim(0.05, 0.45, 0.45, 'carRed', BX0 - 0.1, 1.5, 8.2);

  // Pickup + camper (east side, north end, in the turning circle).
  k.aabb(2.5, 0.35, -18.5, 4.5, 1.15, -13.0, 'truck');
  k.aabb(2.6, 1.15, -17.4, 4.4, 2.0, -15.6, 'glass', { faceMats: { py: 'truck' } });
  k.aabb(2.5, 1.15, -15.6, 4.5, 1.6, -13.0, 'truck', { hide: ['py'] });
  for (const z of [-17.6, -13.9]) for (const x of [2.45, 4.55]) k.cyl(0.4, 0.26, 10, 'rubber', x, 0.4, z, { axis: 'x', collide: false });
  k.trim(0.12, 0.12, 0.8, 'steel', 3.5, 0.55, -12.6);
  k.aabb(2.3, 0.4, -12.2, 4.7, 2.9, -5.6, 'camper');
  k.trim(2.5, 0.12, 6.7, 'trim', 3.5, 2.9, -8.9);
  k.wallDecal(1.4, 0.7, 'glass', 4.71, 1.5, -9.8, PI / 2);
  k.wallDecal(1.4, 0.7, 'glass', 2.29, 1.5, -7.6, -PI / 2);
  k.wallDecal(0.7, 1.8, 'wood', 2.29, 0.5, -10.6, -PI / 2);
  for (const x of [2.25, 4.75]) k.cyl(0.4, 0.26, 10, 'rubber', x, 0.4, -9.0, { axis: 'x', collide: false });

  // Station wagon (west, middle) and sedan (east, middle): rotationally placed.
  car(k, -3.2, -4.1, 'z', 'carBlue', true);
  car(k, 3.2, 4.1, 'z', 'carRed', false);

  // Mannequins in the street.
  k.mannequin(-1.6, 19.6, PI, 'mannequin', 0, 'dress');
  k.mannequin(6.0, -8.2, PI / 2, 'mannequin', 0, 'fabricB');
  k.mannequin(-0.8, -15.5, 0, 'mannequin');

  // Chain-link across the street ends, with the boundary sign posts.
  for (const z of [-25.1, 25.1]) {
    k.wallDecal(17.6, 2.6, 'chain', 0, 0, z, 0);
    for (let x = -8.8; x <= 8.8; x += 2.2) k.box(0.1, 2.7, 0.1, 'steel', x, 0, z, { collide: false });
    k.clip(-8.8, 0, z - 0.06, 8.8, 2.6, z + 0.06);
  }
  // Road barrier at the south gate.
  for (const x of [-4, 0, 4]) k.box(1.8, 0.9, 0.4, 'hazard', x, 0, 24.5, { uv: 'raw' });
}

/** Everything outside the fences: desert, the town sign, the test-site tower, poles, mountains. */
function backdrop(k: MapKit) {
  // NUKETOWN sign south of the gate.
  for (const x of [10.5, 17.5]) k.box(0.3, 4.4, 0.3, 'wood', x, 0, 29);
  k.trim(8.2, 2.4, 0.2, 'wood', 14, 2.6, 29);
  k.wallDecal(8, 2.2, 'sign', 14, 2.7, 28.89, PI, { uv: 'raw' });
  // Power poles along the road.
  for (let z = 32; z < 150; z += 16) {
    k.cyl(0.18, 9, 6, 'wood', -7.5, 4.5, z, { collide: false });
    k.trim(2.6, 0.16, 0.16, 'wood', -7.5, 8.2, z);
  }
  // Test-site tower (north-east) and a bunker mound with a periscope (north-west).
  const tx = 62;
  const tz = -78;
  for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]] as const) k.trim(0.5, 34, 0.5, 'steel', tx + dx, 0, tz + dz);
  for (let y = 6; y < 34; y += 7) {
    k.trim(6.5, 0.3, 0.3, 'steel', tx, y, tz - 3);
    k.trim(6.5, 0.3, 0.3, 'steel', tx, y, tz + 3);
    k.trim(0.3, 0.3, 6.5, 'steel', tx - 3, y, tz);
    k.trim(0.3, 0.3, 6.5, 'steel', tx + 3, y, tz);
  }
  k.trim(7.5, 3.5, 7.5, 'camper', tx, 34, tz);
  k.glow(tx, 38.2, tz, [1, 0.12, 0.08], 4, undefined, true);
  k.ramp(-70, 0, -64, -58, 4, -52, '+x', 'sand', { collide: false });
  k.ramp(-58, 0, -64, -46, 4, -52, '-x', 'sand', { collide: false });
  k.trim(0.4, 2.5, 0.4, 'steel', -58, 4, -58);
  // Mountains: two rings of silhouette cards, the far range taller and hazier.
  k.backdropRing('mountainsFar', 185, 9, 150, 60, -3, 0.3);
  k.backdropRing('mountains', 135, 11, 95, 34, -2);
}

export function buildNuketown(): MapData {
  const k = new MapKit();
  // Desert ground: one slab, top at y = 0, out to the horizon.
  k.aabb(-200, -1, -200, 200, 0, 200, 'sand', { hide: ['nx', 'px', 'ny', 'nz', 'pz'] });
  k.perimeter(NUKETOWN_BOUNDS, 14);

  lot(k, { siding: 'sidingG', plaster: 'plasterG', roof: 'roofG', car: 'carRed', team: 0 });
  k.with('rot180', () => lot(k, { siding: 'sidingY', plaster: 'plasterY', roof: 'roofY', car: 'carBlue', team: 1 }));
  street(k);
  backdrop(k);

  // ---- spawns ----
  const E = -PI / 2;
  const back: [number, number][] = [[-34.8, -12], [-34.8, -6.5], [-34.8, -1], [-34.8, 4.5], [-34.8, 9.5], [-30.5, -12.5], [-29.6, 1.5], [-30.2, 9.6]];
  const team0 = back.map(([x, z]) => k.spawn(x, 0, z, E));
  const team1 = k.withValue('rot180', () => back.map(([x, z]) => k.spawn(x, 0, z, E)));
  const ffaLocal: SpawnPoint[] = [
    k.spawn(-33, 0, -20, yawTo(-33, -20, 0, 0)),
    k.spawn(-22, 0, 20, yawTo(-22, 20, 0, 0)),
    k.spawn(-22.5, 0, 3.4, E),
    k.spawn(-24.5, F2, -8.2, E),
    k.spawn(-34.8, 0, 6, E),
    k.spawn(-13.4, 0, -22.4, PI),
    k.spawn(-1, 0, 22.5, 0),
  ];
  const ffa = [...ffaLocal, ...k.withValue('rot180', () => ffaLocal.map((s) => k.spawn(s.x, s.y, s.z, s.yaw)))];

  // ---- objectives ----
  const P = (id: string, x: number, y: number, z: number, radius: number, team?: 0 | 1): ObjectivePoint => (team === undefined ? { id, x, y, z, radius } : { id, x, y, z, radius, team });
  const dom = [P('A', -12, 0, -7.4, 3), P('B', 0, 0, 0, 3), P('C', 12, 0, 7.4, 3)];
  // S&D: attackers start in the green backyard, defenders hold the yellow side.
  const sd = [P('A', 22.5, 0, -4.5, 1.6, 1), P('B', 6.8, 0, -21, 1.6, 1)];
  const hq = [P('hq1', 0, 0, 0, 3.5), P('hq2', -19.4, 0, -5.6, 3), P('hq3', 19.4, 0, 5.6, 3), P('hq4', -22.5, 0, 4.5, 3), P('hq5', 22.5, 0, -4.5, 3), P('hq6', -20, 0, -18, 3.5), P('hq7', 20, 0, 18, 3.5), P('hq8', 0, 0, -19, 3.5), P('hq9', 0, 0, 21.5, 3.5)];
  const attackers = team0;
  const defenders = [...team1.slice(0, 5), { x: 20, y: 0, z: 18, yaw: 0 }, { x: 13, y: 0, z: 13, yaw: PI / 2 }, { x: 24, y: 0, z: 14, yaw: 0 }];

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
      { x: 0, y: 0, z: 0 },
      { x: -22.5, y: 0, z: 4.5 },
      { x: 22.5, y: 0, z: -4.5 },
      { x: -20.5, y: F2, z: -6 },
      { x: 20.5, y: F2, z: 6 },
      { x: -20, y: 0, z: -18 },
      { x: 20, y: 0, z: 18 },
      { x: -18, y: 0, z: 18 },
      { x: 18, y: 0, z: -18 },
      { x: 0, y: 0, z: 21.5 },
      { x: 0, y: 0, z: -19 },
      { x: -1.4, y: 0, z: 12 },
      { x: 6.4, y: 0, z: -11 },
    ],
  };
}
