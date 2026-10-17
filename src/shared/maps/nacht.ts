/**
 * Nacht der Untoten (recreation of World at War's first Zombies map, re-released in Black Ops;
 * owner: zombies). A small, half-wrecked concrete bunker on an abandoned airfield at night: a
 * crashed B-17 burning off its east side, wrecked trucks, shell craters, dead trees and fog. Zombies
 * only (see src/shared/maps/zombies/nacht.ts for the buyables and docs/maps/nacht-reference.md for
 * the sources and the scale estimate).
 *
 * Traced from the community floor plans on the CoD Wiki (downstairs / upstairs, 954 x 763 px) at
 * 28 px per metre, origin at plan px (505, 420). Metres, +x east, +z south, yaw 0 faces north.
 *
 *   Start room     x -4.8 .. 12.3, z -1.0 .. 8.8 (a notch cut out of its south side at x 5.1 .. 8.2).
 *                  Six square pillars, the spiral stairs up in the north-west corner of its middle
 *                  (blocked by a sofa barricade), five windows. Kar98k and M1A1 Carbine chalk.
 *   Help room      x -10.7 .. -4.8, z -8.9 .. 8.8 (the west wing), through the "HELP" door in the
 *                  start room's west wall. Two windows, a boarded hole into a dead-end cave, the
 *                  Mystery Box, the Thompson and the double-barrel, a debris-choked stair tower in
 *                  its south-west corner up to the top floor.
 *   Upstairs       two rooms on the top floor (over the Help room and the west half of the start
 *                  room), joined by a gap in the wall. Rubble, a fallen beam, the sniper cabinet,
 *                  holes in the floor over the spiral stairs. Four windows: two on the west side
 *                  over an earth mound, two over the outside balcony at the top of the exterior stairs.
 *   Outside        the crater field all round (zombies only: windows are player clips).
 *
 * Doors are brushes with `gate: 'door:<id>'` (shut until bought, blockers.ts); window openings are
 * players-only clips (zombies climb through them by script once the boards are down).
 */
import { MapKit, yawTo, type Hole } from './bo-kit';
import { unitVec, type MapData, type MaterialDef, type SpawnPoint } from './types';

const PI = Math.PI;
/** Wall thickness, ground floor ceiling, top floor walking height, top floor ceiling / roof. */
const T = 0.4;
const CEIL = 3.0;
const F2 = 3.3;
const ROOF = 6.0;
const TOP = 6.3;
/** Window sill and head above their floor. */
const SILL = 0.9;
const HEAD = 2.2;

/** Plan lines (wall centres). */
export const NACHT = {
  xTower: -12.3,
  xWest: -10.7,
  xMid: -4.8,
  xUpEast: 5.1,
  xNotch: 8.2,
  xEast: 12.3,
  zNorth: -8.9,
  zStart: -1.0,
  zUpSouth: 6.4,
  zSouth: 8.8,
  F2,
} as const;

export const NACHT_BOUNDS = { min: { x: -46, y: -3, z: -40 }, max: { x: 46, y: 24, z: 40 } };

const MATERIALS: Record<string, MaterialDef> = {
  concrete: { texture: 'nd_concrete', uvMul: [1 / 2.4, 1 / 2.4] },
  concreteDark: { texture: 'nd_concrete', tint: 0x8c8c90, uvMul: [1 / 2.4, 1 / 2.4] },
  ceiling: { texture: 'nd_ceiling', uvMul: [1 / 3, 1 / 3] },
  floor: { texture: 'nd_floor', uvMul: [1 / 2, 1 / 2] },
  mud: { texture: 'nd_mud', uvMul: [1 / 5, 1 / 5] },
  scorch: { texture: 'nd_mud', tint: 0x48443e, uvMul: [1 / 3, 1 / 3] },
  rubble: { texture: 'nd_rubble', uvMul: [1 / 2, 1 / 2] },
  planks: { texture: 'nd_timber', uvMul: [1 / 1.6, 1 / 1.6] },
  planksDark: { texture: 'nd_timber', tint: 0x7a6a5a, uvMul: [1 / 1.6, 1 / 1.6] },
  wood: { texture: 'bo_wood', uvMul: [1 / 1.2, 1 / 1.2] },
  sandbag: { texture: 'bo_sandbag', uvMul: [1 / 1.6, 1 / 0.9] },
  steel: { texture: 'steel' },
  rail: { texture: 'steel', tint: 0x6a6a70 },
  plane: { texture: 'bo_carpaint', tint: 0x4a5040 },
  planeDark: { texture: 'bo_carpaint', tint: 0x2a2c28 },
  truck: { texture: 'bo_carpaint', tint: 0x3c4236 },
  burnt: { texture: 'bo_carpaint', tint: 0x1c1a18 },
  barrel: { texture: 'barrel', tint: 0x8a3a2a, uvMul: [2, 1] },
  crate: { texture: 'crate', uvMul: [1 / 1.2, 1 / 1.2] },
  bark: { texture: 'fr_bark', tint: 0x6a6a6a, uvMul: [1, 1 / 2] },
  fabric: { texture: 'bo_fabric', tint: 0x6a5a48 },
  lamp: { texture: 'lamp', emissive: 1 },
  ember: { texture: 'lamp', tint: 0xff7a30, emissive: 1 },
  ascend: { texture: 'nd_writingAscend', side: 'double', emissive: 0.25 },
  salvation: { texture: 'nd_writingSalvation', side: 'double', emissive: 0.25 },
  treeline: { texture: 'nd_treeline', side: 'double', fog: false },
  clip: { texture: 'none' },
};

/** Holes in absolute coordinates along the wall and in height. */
const hole = (a0: number, a1: number, y0: number, y1: number): Hole => ({ a0, a1, y0, y1 });

/** A wall along x at z = c from x0..x1, base y0, height h; holes with absolute y. */
function wallX(k: MapKit, x0: number, x1: number, c: number, y0: number, h: number, mat: string, holes: Hole[] = []): void {
  k.wall('x', x0, x1, c, y0, h, T, mat, holes.map((o) => ({ ...o, y0: o.y0 - y0, y1: o.y1 - y0 })));
}
function wallZ(k: MapKit, z0: number, z1: number, c: number, y0: number, h: number, mat: string, holes: Hole[] = []): void {
  k.wall('z', z0, z1, c, y0, h, T, mat, holes.map((o) => ({ ...o, y0: o.y0 - y0, y1: o.y1 - y0 })));
}

/** A window opening's players-only clip (nobody walks through; bullets and sight pass). */
function windowClipX(k: MapKit, a0: number, a1: number, c: number, y0: number, y1: number): void {
  k.clip(a0, y0, c - T / 2 - 0.02, a1, y1, c + T / 2 + 0.02, 'clip');
}
function windowClipZ(k: MapKit, a0: number, a1: number, c: number, y0: number, y1: number): void {
  k.clip(c - T / 2 - 0.02, y0, a0, c + T / 2 + 0.02, y1, a1, 'clip');
}

/** A window: the hole, a clip in it, a concrete sill and a timber frame around it. */
interface Win {
  axis: 'x' | 'z';
  c: number;
  at: number;
  w: number;
  y: number;
  sill?: number;
  head?: number;
}
function winHole(o: Win): Hole {
  const s = o.y + (o.sill ?? SILL);
  return hole(o.at - o.w / 2, o.at + o.w / 2, s, o.y + (o.head ?? HEAD));
}
function winTrim(k: MapKit, o: Win): void {
  const s = o.y + (o.sill ?? SILL);
  const top = o.y + (o.head ?? HEAD);
  const a0 = o.at - o.w / 2;
  const a1 = o.at + o.w / 2;
  if (o.axis === 'x') {
    windowClipX(k, a0, a1, o.c, s, top);
    // Frame posts and lintel (trim, inside the reveal).
    k.aabb(a0, s, o.c - T / 2 + 0.04, a0 + 0.08, top, o.c + T / 2 - 0.04, 'planksDark', { collide: false });
    k.aabb(a1 - 0.08, s, o.c - T / 2 + 0.04, a1, top, o.c + T / 2 - 0.04, 'planksDark', { collide: false });
    k.aabb(a0 + 0.08, top - 0.08, o.c - T / 2 + 0.04, a1 - 0.08, top, o.c + T / 2 - 0.04, 'planksDark', { collide: false });
  } else {
    windowClipZ(k, a0, a1, o.c, s, top);
    k.aabb(o.c - T / 2 + 0.04, s, a0, o.c + T / 2 - 0.04, top, a0 + 0.08, 'planksDark', { collide: false });
    k.aabb(o.c - T / 2 + 0.04, s, a1 - 0.08, o.c + T / 2 - 0.04, top, a1, 'planksDark', { collide: false });
    k.aabb(o.c - T / 2 + 0.04, top - 0.08, a0 + 0.08, o.c + T / 2 - 0.04, top, a1 - 0.08, 'planksDark', { collide: false });
  }
}

/** The windows (barriers), in the order of the Zombies layer's `barriers`. */
export const NACHT_WINDOWS: (Win & { id: string })[] = [
  // Start room: two on the south wall west of the notch, one east of it, one in the east wall, one in the north wall.
  { id: 'S1', axis: 'x', c: 8.8, at: -3.2, w: 1.4, y: 0 },
  { id: 'S2', axis: 'x', c: 8.8, at: 3.6, w: 1.4, y: 0 },
  { id: 'S3', axis: 'x', c: 8.8, at: 10.0, w: 1.4, y: 0 },
  { id: 'S4', axis: 'z', c: 12.3, at: 1.6, w: 1.4, y: 0 },
  { id: 'S5', axis: 'x', c: -1.0, at: 7.6, w: 1.4, y: 0 },
  // Help room: north wall, east wall (outside, north of the balcony), the cave hole in the west wall.
  { id: 'H1', axis: 'x', c: -8.9, at: -8.8, w: 1.4, y: 0 },
  { id: 'H2', axis: 'z', c: -4.8, at: -4.6, w: 1.4, y: 0 },
  { id: 'C', axis: 'z', c: -10.7, at: 2.6, w: 1.4, y: 0, sill: 0.35, head: 2.15 },
  // Upstairs: two over the west mound, one onto the balcony from each room.
  { id: 'U1', axis: 'z', c: -10.7, at: -7.5, w: 1.3, y: F2 },
  { id: 'U2', axis: 'z', c: -10.7, at: -0.2, w: 1.3, y: F2 },
  { id: 'U3', axis: 'z', c: -4.8, at: -2.05, w: 1.2, y: F2 },
  { id: 'U4', axis: 'x', c: -1.0, at: -2.4, w: 1.2, y: F2 },
];
const W_ = (id: string) => NACHT_WINDOWS.find((w) => w.id === id)!;

/** The doors (debris / barricade / door) and their gate brushes, in the layer's `doors` order. */
export const NACHT_DOORS = {
  /** Start room -> Help room: the "HELP" door in the west wall. */
  help: { x: -4.8, z: 1.55, w: 2.3, h: 2.4, min: { x: -5.0, y: 0, z: 0.4 }, max: { x: -4.6, y: 2.4, z: 2.7 } },
  /** Start room -> upstairs: the sofa barricade at the foot of the spiral stairs. */
  stairs: { x: -0.6, z: -0.1, w: 1.5, h: 2.4, min: { x: -1.35, y: 0, z: -0.8 }, max: { x: 0.15, y: 2.4, z: 0.6 } },
  /** Help room -> upstairs: the debris at the foot of the tower stairs. */
  tower: { x: -10.7, z: 7.9, w: 1.4, h: 2.4, min: { x: -10.9, y: 0, z: 7.2 }, max: { x: -10.5, y: 2.4, z: 8.6 } },
} as const;

function bunker(k: MapKit): void {
  const N = NACHT;
  // ---- floors (tiles inside; the cave and the notch are mud) -------------------------------
  k.aabb(-10.9, -0.5, -9.1, -4.6, 0, 9.0, 'floor');
  k.aabb(-4.6, -0.5, -1.2, 4.9, 0, 9.0, 'floor');
  k.aabb(4.9, -0.5, -1.2, 12.5, 0, 6.2, 'floor');
  k.aabb(8.4, -0.5, 6.2, 12.5, 0, 9.0, 'floor');
  k.aabb(4.9, -0.5, 6.2, 5.3, 0, 9.0, 'floor');
  k.aabb(-12.5, -0.5, 3.8, -10.9, 0, 9.0, 'floor');

  // ---- exterior walls ----------------------------------------------------------------------
  // North wall of the Help wing (two storeys).
  wallX(k, -10.9, -4.6, N.zNorth, 0, TOP, 'concrete', [winHole(W_('H1'))]);
  // West wall (Help room + upstairs left room + the tower's east side): windows, the cave hole, the
  // upstairs landing doorway and the debris-choked tower stair opening.
  wallZ(k, -8.7, 8.6, N.xWest, 0, TOP, 'concrete', [winHole(W_('U1')), winHole(W_('U2')), winHole(W_('C')), hole(2.0, 4.2, F2, F2 + 2.3), hole(7.2, 8.6, 0, 2.4)]);
  // Stair tower: west wall (full height south of the cave, above the cave north of it), north walls.
  wallZ(k, 3.8, 9.0, N.xTower, 0, TOP, 'concrete');
  wallZ(k, 2.0, 3.8, N.xTower, F2, TOP - F2, 'concrete');
  wallX(k, -12.5, -10.9, 1.8, F2, TOP - F2, 'concrete');
  wallX(k, -12.1, -10.9, 4.0, 0, CEIL - 0.4, 'concrete');
  // South wall: tower (two storeys), the Help room and the start room west of the notch (one storey).
  wallX(k, -12.1, -10.5, N.zSouth, 0, TOP, 'concrete');
  wallX(k, -10.5, 5.3, N.zSouth, 0, F2, 'concrete', [winHole(W_('S1')), winHole(W_('S2'))]);
  // The notch (cut out of the start room's south side), then the south wall east of it.
  wallZ(k, 6.6, 8.6, N.xUpEast, 0, F2, 'concrete');
  wallX(k, 4.9, 8.4, N.zUpSouth, 0, F2, 'concrete');
  wallZ(k, 6.6, 9.0, N.xNotch, 0, F2, 'concrete');
  wallX(k, 8.4, 12.5, N.zSouth, 0, F2, 'concrete', [winHole(W_('S3'))]);
  // East wall (one storey).
  wallZ(k, -1.2, 8.6, N.xEast, 0, F2, 'concrete', [winHole(W_('S4'))]);
  // North wall of the start room: two storeys under the upstairs right room, one storey east of it.
  wallX(k, -4.6, 5.3, N.zStart, 0, TOP, 'concrete', [winHole(W_('U4'))]);
  wallX(k, 5.3, 12.1, N.zStart, 0, F2, 'concrete', [winHole(W_('S5'))]);
  // East wall of the upstairs right room (stands on the spiral stair enclosure below).
  wallZ(k, -0.8, 6.2, N.xUpEast, CEIL, TOP - CEIL, 'concrete');
  wallZ(k, -0.8, 2.6, N.xUpEast, 0, CEIL, 'concreteDark');
  // The Help wing's east side: outside wall north of the start room (two storeys, H2 and U3), then
  // the wall between the Help room and the start room (the HELP door; upstairs, the gap between
  // the two rooms), then one storey to the south wall.
  wallZ(k, -8.7, -1.2, N.xMid, 0, TOP, 'concrete', [winHole(W_('H2')), winHole(W_('U3'))]);
  wallZ(k, -1.2, 6.6, N.xMid, 0, TOP, 'concrete', [hole(0.4, 2.7, 0, 2.4), hole(0.4, 1.8, F2, F2 + 2.3)]);
  wallZ(k, 6.6, 8.6, N.xMid, 0, F2, 'concrete');
  // Upstairs south wall (the rooms end at z 6.4; one storey roof beyond), standing on the slab.
  wallX(k, -10.5, -5.0, N.zUpSouth, F2, TOP - F2, 'concrete');
  wallX(k, -4.6, 5.3, N.zUpSouth, F2, TOP - F2, 'concrete');
  for (const w of NACHT_WINDOWS) winTrim(k, w);
  // The doors: invisible solids that shut each gap until it is bought (the entity draws the debris).
  for (const [id, d] of Object.entries(NACHT_DOORS)) k.aabb(d.min.x, d.min.y, d.min.z, d.max.x, d.max.y, d.max.z, 'clip', { noRender: true, gate: `door:${id}` });

  // ---- top floor slab (ceiling of the ground floor), with the holes over the spiral stairs -------
  const slab = (x0: number, z0: number, x1: number, z1: number) => k.aabb(x0, CEIL, z0, x1, F2, z1, 'planks', { faceMats: { ny: 'ceiling' } });
  slab(-10.5, -8.7, -5.0, 6.6);
  slab(-4.6, -0.8, 0.8, 6.6);
  slab(0.8, 0.6, 1.2, 6.6);
  slab(1.2, 3.6, 3.6, 6.6);
  slab(3.6, 2.6, 4.9, 6.6);
  // Stair landing over the cave (the top of the tower stairs).
  k.aabb(-12.1, 2.6, 2.0, -10.9, F2, 4.2, 'planks', { faceMats: { ny: 'rubble' } });
  // One-storey roofs (start room east, the strip along the south, the Help room's south end).
  const roof1 = (x0: number, z0: number, x1: number, z1: number) => k.aabb(x0, CEIL, z0, x1, F2, z1, 'concreteDark', { faceMats: { ny: 'ceiling' } });
  roof1(5.3, -0.8, 8.6, 6.2);
  roof1(10.2, -0.8, 12.1, 6.2);
  roof1(8.6, -0.8, 10.2, 1.2);
  roof1(8.6, 2.8, 10.2, 6.2);
  roof1(8.4, 6.2, 12.1, 8.6);
  roof1(-4.6, 6.6, 4.9, 8.6);
  roof1(-10.5, 6.6, -5.0, 8.6);
  // Top roofs (with holes where it has fallen in).
  const roof2 = (x0: number, z0: number, x1: number, z1: number) => k.aabb(x0, ROOF, z0, x1, TOP, z1, 'concreteDark', { faceMats: { ny: 'ceiling' } });
  roof2(-10.5, -8.7, -5.0, -5.6);
  roof2(-10.5, -5.6, -9.2, -3.6);
  roof2(-6.6, -5.6, -5.0, -3.6);
  roof2(-10.5, -3.6, -5.0, 6.2);
  roof2(-4.6, -0.8, 4.9, 1.6);
  roof2(-4.6, 1.6, -3.2, 3.4);
  roof2(-1.4, 1.6, 4.9, 3.4);
  roof2(-4.6, 3.4, 4.9, 6.2);
  roof2(-12.1, 2.0, -10.9, 8.6);
  // Broken roof edges: slabs hanging into the holes, rebar.
  k.aabb(-9.2, ROOF - 0.5, -5.6, -8.4, ROOF - 0.1, -4.4, 'concreteDark', { collide: false, ry: 0.3 });
  k.aabb(-3.2, ROOF - 0.6, 1.8, -2.4, ROOF - 0.2, 3.0, 'concreteDark', { collide: false, ry: -0.4 });
  k.aabb(8.6, CEIL - 0.45, 1.3, 9.4, CEIL - 0.1, 2.6, 'concreteDark', { collide: false, ry: 0.25 });

  // ---- pillars ------------------------------------------------------------------------------
  const pillar = (x: number, z: number, y0: number, y1: number, s = 0.6) => k.aabb(x - s / 2, y0, z - s / 2, x + s / 2, y1, z + s / 2, 'concrete');
  // Start room: two rows of three, the outer row carried up through the top floor.
  for (const z of [1.55, 4.2]) pillar(-1.7, z, 0, CEIL);
  pillar(-1.7, 6.7, 0, CEIL);
  for (const z of [1.55, 4.2, 6.7]) pillar(1.85, z, 0, CEIL);
  pillar(6.9, 2.15, 0, CEIL);
  // Help room: a line of four down the middle; upstairs the same line, and the fallen beam.
  for (const z of [-5.4, -2.1, 1.3, 4.6]) {
    pillar(-8.0, z, 0, CEIL);
    if (z < 6) pillar(-8.0, z, F2, ROOF);
  }
  pillar(-1.75, 4.5, F2, ROOF);
  pillar(0.2, 0.0, F2, ROOF, 0.5);

  // ---- the spiral stairs (start room -> top floor), as two flights round the corner -------
  // Flight 1 east along the north wall, a landing in the corner, flight 2 south to the top floor.
  k.stairs(-0.75, 0, -0.8, 3.4, 2.1, 0.5, '+x', 'concrete', 10);
  k.aabb(3.4, 0, -0.8, 4.9, 2.1, 0.6, 'concrete');
  k.stairs(3.6, 2.1, 0.6, 4.9, F2, 2.6, '+z', 'concrete', 6);
  k.aabb(3.6, 0, 0.6, 4.9, 2.1, 2.6, 'concreteDark', { players: false });
  // Balustrade on flight 1's open side, the rail beside flight 2, and clips so nobody hops on or off.
  k.aabb(0.15, 0, 0.5, 3.4, 1.0, 0.62, 'concreteDark');
  k.clip(-0.75, 1.0, 0.5, 3.4, CEIL, 0.62, 'clip');
  k.aabb(3.56, 2.1, 0.6, 3.6, 3.1, 2.6, 'rail', { players: false, sight: false, bullets: false });
  k.clip(3.5, 2.1, 0.6, 3.6, ROOF, 2.6, 'clip');
  // Rails round the holes upstairs (and clips: nobody drops through).
  const rail = (x0: number, z0: number, x1: number, z1: number) => {
    k.aabb(x0, F2, z0, x1, F2 + 1.0, z1, 'rail', { bullets: false, sight: false });
    k.clip(x0, F2 + 1.0, z0, x1, ROOF, z1, 'clip');
  };
  rail(0.72, -0.8, 0.8, 0.6);
  rail(0.8, 0.6, 1.2, 0.68);
  rail(1.12, 0.68, 1.2, 3.6);
  rail(1.2, 3.52, 3.6, 3.6);
  rail(3.6, 2.6, 3.68, 3.52);

  // ---- the tower stairs (Help room -> top floor), rising north to the landing -------------
  k.stairs(-12.1, 0, 4.2, -10.9, F2, 8.6, '-z', 'concrete', 15);

  // ---- the cave behind the Help room (a dead end in the mound) ---------------------------
  k.aabb(-13.9, -0.5, -0.8, -10.9, 0, 3.8, 'mud');
  k.aabb(-13.7, 0, -0.8, -10.9, 2.6, -0.5, 'rubble');
  k.aabb(-13.7, 0, 3.5, -12.5, 2.6, 3.8, 'rubble');
  k.aabb(-13.7, 0, -0.5, -13.1, 1.2, 1.0, 'rubble', { ry: 0.4 });
  k.aabb(-13.7, 0, 2.4, -13.2, 0.8, 3.5, 'rubble', { ry: -0.3 });
  // The cave roof under the mound (the landing slab covers the tower's part of it).
  k.aabb(-13.7, 2.6, -0.5, -10.9, F2, 2.0, 'rubble');
  k.aabb(-13.7, 2.6, 2.0, -12.1, F2, 3.8, 'rubble');

  // ---- outside: the west mound (up to the top-floor windows), the balcony and its stairs -----
  // A collapsed earth bank against the west wall: a ramp up from the field, a ledge at the windows.
  k.aabb(-14.3, 0, -8.9, -10.9, F2, -0.8, 'mud');
  k.aabb(-15.1, 0, -0.8, -13.7, F2 - 0.3, 3.8, 'mud');
  k.ramp(-22.5, 0, -8.6, -14.3, F2, -3.2, '+x', 'mud');
  k.ramp(-14.3, 0, -10.4, -10.9, F2, -8.9, '+z', 'mud');
  // Exterior stairs along the north wall, up to the balcony over the Help wing's corner.
  k.stairs(-0.7, 0, -2.9, 4.6, F2, -1.2, '-x', 'concrete', 15);
  k.aabb(-4.6, CEIL, -2.9, -0.7, F2, -1.2, 'planks', { faceMats: { ny: 'planksDark' } });
  for (const [x, z] of [[-4.45, -2.75], [-0.85, -2.75]] as const) k.aabb(x - 0.15, 0, z - 0.15, x + 0.15, CEIL, z + 0.15, 'wood');
  k.aabb(-4.6, F2, -2.98, -0.7, F2 + 1.0, -2.9, 'rail', { bullets: false, sight: false });
  // Sandbags under the windows outside.
  for (const id of ['S1', 'S3', 'H1']) {
    const w = W_(id);
    k.box(1.4, 0.6, 0.6, 'sandbag', w.at + 1.7, 0, w.c + (w.c > 0 ? 0.6 : -0.6));
  }

  // ---- inside: debris, furniture, sandbags, lamps -----------------------------------------
  const crate = (x: number, z: number, s: number, y = 0, ry = 0) => k.box(s, s, s, 'crate', x, y, z, { ry });
  // Start room: rubble under the spiral, crates and a table by the north wall, sandbags at the windows.
  k.box(1.4, 0.5, 0.9, 'rubble', 8.6, 0, 5.4, { ry: 0.3 });
  crate(9.6, 0.1, 0.8);
  crate(10.3, 0.2, 0.6, 0, 0.3);
  crate(9.7, 0.1, 0.5, 0.8, 0.5);
  k.box(1.6, 0.8, 0.8, 'wood', 10.6, 0, 4.0);
  k.box(0.8, 0.5, 0.6, 'crate', 11.6, 0, 6.0, { ry: 0.6 });
  k.box(1.0, 0.35, 0.7, 'rubble', -3.0, 0, 5.2, { ry: 0.7 });
  // Help room: metal shelves of boxes along the walls, a table with the radio, rubble.
  for (const z of [-5.4]) {
    k.aabb(-10.5, 0, z - 0.9, -9.9, 2.0, z + 0.9, 'rail', { bullets: false, sight: false });
    crate(-10.2, z - 0.4, 0.45, 0.9);
    crate(-10.2, z + 0.4, 0.5, 0.9);
  }
  k.aabb(-5.6, 0, -6.6, -5.0, 2.0, -5.0, 'rail', { bullets: false, sight: false });
  k.box(1.2, 0.8, 0.7, 'wood', -7.9, 0, 7.95);
  k.box(0.35, 0.25, 0.25, 'steel', -7.7, 0.8, 7.95);
  k.box(1.3, 0.5, 1.0, 'rubble', -9.6, 0, 5.6, { ry: 0.4 });
  k.box(0.9, 0.4, 0.8, 'rubble', -6.2, 0, 3.8, { ry: -0.5 });
  // Upstairs: the fallen beam across the left room, rubble heaps, the sniper cabinet.
  k.aabb(-6.85, F2, -7.1, -6.35, F2 + 0.9, -3.9, 'concreteDark');
  k.box(1.6, 0.5, 1.2, 'rubble', -9.4, F2, 2.4, { ry: 0.5 });
  k.box(1.2, 0.4, 1.0, 'rubble', -6.2, F2, 4.6, { ry: -0.3 });
  k.box(1.4, 0.45, 0.9, 'rubble', -2.4, F2, 2.8, { ry: 0.8 });
  k.box(0.9, 0.35, 0.9, 'rubble', 4.2, F2, 4.0, { ry: 0.2 });
  k.aabb(-8.45, F2, -3.55, -7.75, F2 + 2.2, -2.45, 'wood');
  // Lamps: bare bulbs on flex (cold) and a lantern on a pillar.
  for (const [x, y, z] of [[1.0, CEIL, 3.0], [8.0, CEIL, 4.5], [-8.0, CEIL, -3.6], [-8.0, CEIL, 3.0], [-7.6, ROOF, -0.5], [-2.0, ROOF, 4.0]] as const) {
    k.box(0.02, 0.5, 0.02, 'rail', x, y - 0.5, z, { collide: false });
    k.box(0.3, 0.12, 0.3, 'steel', x, y - 0.62, z, { collide: false });
    k.box(0.12, 0.1, 0.12, 'lamp', x, y - 0.72, z, { collide: false });
    k.light(x, y - 0.9, z, [0.95, 0.92, 0.85], 7.5, 'lamp');
    k.glow(x, y - 0.75, z, [1, 0.95, 0.85], 0.5, 'lamp');
  }
  k.box(0.18, 0.28, 0.18, 'ember', 1.85, 1.7, 4.55, { collide: false });
  k.light(1.85, 1.8, 4.75, [1, 0.62, 0.3], 5.5, 'fire');

  // ---- chalk writing ------------------------------------------------------------------------
  k.wallDecal(2.4, 1.2, 'ascend', -3.0, 1.0, -0.78, 0);
  k.wallDecal(2.0, 1.0, 'salvation', -10.48, 1.2, -1.5, PI / 2);
}

/** Burning debris round the field (the Zombies layer hands them to the client for flames and smoke). */
export const NACHT_FIRES: { x: number; y: number; z: number; size: number }[] = [
  { x: 24, y: 1.6, z: -10, size: 1.1 },
  { x: 24.5, y: 0.6, z: -15.4, size: 0.9 },
  { x: 19.6, y: 0, z: -4.4, size: 1.2 },
  { x: 30, y: 0, z: -3.4, size: 0.8 },
  { x: -8, y: 1.8, z: -15.4, size: 1 },
  { x: 14.6, y: 1.8, z: -14, size: 1 },
  { x: -17, y: 0.5, z: 10, size: 0.8 },
  { x: 16, y: 0.4, z: 18, size: 0.8 },
  { x: -28, y: 0, z: -16, size: 0.7 },
];

/** Wrecks, craters, fences, trees and fires in the field round the bunker. */
function field(k: MapKit): void {
  for (const f of NACHT_FIRES) {
    k.light(f.x, f.y + 1.2, f.z, [1.0, 0.48, 0.16], 11 * f.size, 'fire');
    k.glow(f.x, f.y + 0.8, f.z, [1, 0.55, 0.2], 2.2 * f.size, 'fire');
    k.box(0.5 * f.size, 0.25, 0.5 * f.size, 'ember', f.x, f.y, f.z, { collide: false, ry: 0.4 });
  }
  // The ground (mud) round the bunker's footprint.
  k.groundWithHoles([NACHT_BOUNDS.min.x, NACHT_BOUNDS.min.z, NACHT_BOUNDS.max.x, NACHT_BOUNDS.max.z], 0, 1, 'mud', [
    [-10.9, -9.1, -4.6, 9.0],
    [-4.6, -1.2, 12.5, 6.2],
    [-4.6, 6.2, 5.3, 9.0],
    [8.4, 6.2, 12.5, 9.0],
    [-12.5, 3.8, -10.9, 9.0],
    [-13.9, -0.8, -10.9, 3.8],
  ]);
  // Shell craters: scorched bowls with low rims of thrown-up earth (stepping height, so walkable).
  const craters: [number, number, number][] = [[-22, 14, 3.4], [-28, -4, 2.8], [-18, -20, 3.2], [2, -14, 3.0], [16, -22, 3.6], [22, 14, 3.0], [8, 20, 2.6], [-6, 22, 3.2], [32, 22, 2.8], [-34, 20, 3.0], [-34, -24, 3.4], [34, -26, 3.0], [26, 4, 2.2]];
  for (const [x, z, r] of craters) {
    k.flatDecal(r * 2, r * 2, 'scorch', x, 0.02, z, { ry: x * 0.7 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2 + x;
      k.box(r * 0.9, 0.3, 0.9, 'mud', x + Math.cos(a) * r, 0, z + Math.sin(a) * r, { ry: -a, collide: false });
    }
  }
  // The crashed B-17 off the east side: fuselage nose-down in the mud, a broken wing, burning engines.
  k.cyl(1.5, 15, 10, 'plane', 27, 1.3, -6, { axis: 'x' });
  k.cyl(1.1, 3, 10, 'planeDark', 35.6, 1.6, -6, { axis: 'x' });
  k.box(0.5, 3.4, 2.6, 'plane', 36.6, 1.6, -6);
  k.box(4.6, 0.4, 13, 'plane', 26, 1.1, -13.2, { ry: 0.12 });
  k.box(4.0, 0.4, 7, 'plane', 25, 0.4, 1.8, { ry: -0.25 });
  for (const z of [-10, -15]) k.cyl(0.7, 2.4, 8, 'planeDark', 24, 1.3, z, { axis: 'x' });
  k.box(3, 1.2, 2.6, 'burnt', 19, 0, -6, { ry: 0.5 });
  // Wrecked trucks (north and south-west), burnt out.
  const truck = (x: number, z: number, ry: number) => {
    const sw = Math.abs(Math.sin(ry)) > 0.5;
    k.box(2.2, 2.2, 2.0, sw ? 'burnt' : 'truck', x, 0.4, z, { ry });
    const dx = sw ? 0 : 2.6;
    const dz = sw ? 2.6 : 0;
    k.box(2.4, 1.6, 4.2, 'burnt', x + (sw ? 0 : dx * 0.9), 0.5, z + (sw ? dz * 0.9 : 0), { ry: sw ? 0 : PI / 2 });
  };
  truck(-8, -18, PI / 2);
  truck(-26, 8, 0);
  truck(12, -14, 0.1);
  // Barbed-wire fence lines and sandbag walls.
  for (let x = -38; x <= 38; x += 3.2) {
    if (Math.abs(x) < 4) continue;
    k.box(0.12, 1.4, 0.12, 'wood', x, 0, -30, { collide: false });
    k.box(0.12, 1.4, 0.12, 'wood', x * 0.9, 0, 30, { collide: false });
  }
  for (const [x, z, ry] of [[-6, 13, 0], [6, 12.5, 0.2], [16, 4, PI / 2], [-16, -6, PI / 2], [3, -6.5, 0], [-12, -12, 0.3]] as const) k.box(2.4, 0.9, 0.7, 'sandbag', x, 0, z, { ry });
  // Telegraph poles and dead trees.
  for (const [x, z] of [[-20, -14], [-14, -26], [-2, -28], [14, -30], [20, 24], [-24, 26]] as const) {
    k.cyl(0.14, 7, 6, 'wood', x, 3.5, z);
    k.box(1.8, 0.12, 0.12, 'wood', x, 6.4, z, { collide: false });
  }
  for (const [x, z, h] of [[-30, -12, 7], [-36, 4, 8], [-22, 28, 6], [28, 30, 7], [38, 10, 8], [36, -18, 6.5], [-6, -34, 7], [10, 34, 6], [-38, -32, 7.5], [40, 34, 8]] as const) {
    k.cyl(0.28, h, 6, 'bark', x, h / 2, z);
    k.box(2.4, 0.18, 0.18, 'bark', x + 0.8, h * 0.62, z, { collide: false, ry: 0.6 });
    k.box(1.8, 0.14, 0.14, 'bark', x - 0.6, h * 0.8, z + 0.3, { collide: false, ry: -0.9 });
  }
  // Debris and barrels round the field; some of it burning.
  for (const [x, z] of [[-18, 4], [14, 12], [-4, -12], [20, -16], [-14, 18]] as const) {
    k.cyl(0.32, 0.9, 8, 'barrel', x, 0.45, z);
    k.cyl(0.32, 0.9, 8, 'barrel', x + 0.7, 0.45, z + 0.3);
  }
  k.box(1.6, 0.6, 1.2, 'planksDark', -17, 0, 10, { ry: 0.7 });
  k.box(1.2, 0.5, 1.4, 'planksDark', 16, 0, 18, { ry: -0.4 });
  // The horizon: bare trees in the fog, the perimeter.
  k.backdropRing('treeline', 70, 14, 60, 14, -1);
  k.perimeter(NACHT_BOUNDS, 12);
}

export function buildNacht(): MapData {
  const k = new MapKit();
  bunker(k);
  field(k);

  // ---- spawns: the start room (survivors); outside and in the cave (nav seeds only, Zombies-only map) ----
  const team0: SpawnPoint[] = [
    { x: 2.2, y: 0, z: 2.9, yaw: PI },
    { x: 4.6, y: 0, z: 4.4, yaw: PI },
    { x: 0.0, y: 0, z: 5.6, yaw: PI / 2 },
    { x: 3.6, y: 0, z: 6.0, yaw: 0 },
  ];
  const team1: SpawnPoint[] = [
    { x: -3.2, y: 0, z: 16.0, yaw: 0 },
    { x: 20.0, y: 0, z: 2.0, yaw: PI / 2 },
    { x: 6.0, y: 0, z: -9.0, yaw: PI },
    { x: -20.0, y: 0, z: -2.0, yaw: -PI / 2 },
  ];
  const ffa: SpawnPoint[] = [...team0, ...team1, { x: -12.6, y: 0, z: 1.6, yaw: -PI / 2 }, { x: -9.0, y: 0, z: 0.0, yaw: 0 }];
  const hot = (x: number, y: number, z: number) => ({ x, y, z });

  return {
    id: 'nacht',
    name: 'Nacht der Untoten',
    bounds: NACHT_BOUNDS,
    materials: MATERIALS,
    brushes: k.brushes,
    decals: k.decals,
    props: k.props,
    lights: k.lights,
    spawns: { teams: [team0, team1], ffa },
    objectives: {},
    // Night: a cold blue moon through thin cloud, fog over the field, orange firelight.
    times: [
      { id: 'night', name: 'Night', clock: '23:45', sky: 'nd_skyNight', unlit: [0.62, 0.68, 0.9], skyRot: 0, sunDir: unitVec(0.55, 0.62, -0.56), sun: [0.3, 0.38, 0.6], amb: [0.2, 0.22, 0.32], fog: [0.1, 0.12, 0.18], fogNear: 6, fogFar: 62, lights: { lamp: 1, fire: 1 }, glow: 1 },
    ],
    defaultTime: 'night',
    hotspots: [hot(3, 0, 4), hot(-7.6, 0, 1.5), hot(-7.6, F2, -2), hot(-1.5, F2, 4.5), hot(9, 0, 5)],
  };
}

/** Yaw from a point to another (for the layer and tests). */
export const nachtYaw = yawTo;
