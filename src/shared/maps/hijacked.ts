/**
 * Hijacked (recreation of Black Ops II's Hijacked, maps-bo kit). A luxury superyacht at sea. Layout
 * traced from the BO2 minimap (`Hijacked_minimap_BOII.png`, 1 px = 0.19 m here), the BO2 bird's-eye
 * render and gameplay footage; see docs/maps/hijacked-reference.md for the sources, callouts and
 * measurements.
 *
 * The yacht points north: the bow (raised forepeak with the emblem, two tenders on chocks, team 0)
 * at -z, the stern (pool, hot tub, team 1) at +z. Two two-storey "cabins" split the ship: the Bow
 * Cabin (dining room, galley, the chute down to the engine room; upstairs the bridge and the office
 * with its window over the middle) and the Stern Cabin (lounge bar, two guest bedrooms, the
 * stairwell down; upstairs the master stateroom with its window over the middle and the open aft
 * terrace whose two stair flights come down to the stern deck). Between them the Central Deck: the
 * shower block on the centreline, the hot tub bay on port (closing the port walkway, so the port
 * flank is the emergency catwalk hung outside the hull) and the cabana bar on starboard (the
 * starboard walkway runs behind its counter). Below deck a maintenance passage runs from cabin to
 * cabin: the container bay under the Bow Cabin, the engine room under the middle, the generators
 * under the Stern Cabin. Narrow walkways run down both sides; glass railings (jumpable) are all that
 * stands between you and the sea, and falling in kills (bounds.min.y is above the sea floor of the
 * render, below the engine room floor).
 *
 * Metres, +x starboard (east), +z aft (south), yaw 0 faces the bow. Origin at the shower block.
 *   hull           bow tip z -41.8, transom z 41.2, beam 16.2 (half width 8.1) from z -23.75 to 23.9
 *   forepeak       z < -33.8, deck 0.9 (stairs on the centreline)
 *   Bow Cabin      x -5.4..5.4,  z -20.0..-7.6   (upper floor 3.2, exterior stair on its front)
 *   Stern Cabin    x -5.6..5.6,  z 6.4..17.4     (upper z 6.4..14.4, terrace to z 19.8)
 *   showers        x -2.2..0.9,  z -4.2..2.85;   cabana x 3.6..7.9, z -5.7..4.4
 *   hot tub bay    x -8.1..-4.4, z -7.2..5.1;    port catwalk x -10.4..-8.1, z -10.8..11.2
 *   below deck     x -5.35..2.0, z -16.0..15.2, floor -3.4
 *   pool           x -2.2..1.6,  z 29.9..36.9;   hot tub (stern) centre (-0.3, 28.2)
 */
import { MapKit, yawTo, type Hole } from './bo-kit';
import { unitVec, type MapData, type MaterialDef, type ObjectivePoint, type SpawnPoint } from './types';

const PI = Math.PI;

/** Levels: main deck, raised forepeak, cabin upper floors, engine room floor, the sea surface. */
const DECK = 0;
const FORE = 0.9;
const F2 = 3.2;
const SLAB = 2.95;
const EAVE = 6.0;
const LOW = -3.4;
const SEA = -3.6;
const KEEL = -4.4;
const T = 0.25;
/** Railing height (jumpable: the jump clears 1.1 m). */
const RAIL = 1.0;

export const HIJACKED_LEVELS = { deck: DECK, forepeak: FORE, upper: F2, lower: LOW, sea: SEA } as const;
export const HIJACKED_BOUNDS = { min: { x: -17, y: -4.6, z: -48 }, max: { x: 17, y: 22, z: 47 } };

/** Hull outline (z, half width) from the minimap, bow and stern tapers; 8.1 in between. */
const HULL_BOW: [number, number][] = [[-41.8, 0.3], [-38.95, 2.8], [-37.05, 3.9], [-35.15, 4.8], [-33.25, 5.6], [-31.35, 6.4], [-29.45, 6.9], [-27.55, 7.5], [-25.65, 7.9], [-23.75, 8.1]];
const HULL_STERN: [number, number][] = [[23.9, 8.1], [25.65, 7.6], [27.9, 7.2], [30.4, 6.9], [33.25, 6.4], [35.15, 6.0], [37.05, 5.0], [38.95, 4.1], [41.2, 2.6]];
const BEAM = 8.1;
const BOW_Z = -41.3;
const MID0 = -23.75;
const MID1 = 23.9;
const STERN_Z = 41.2;
/** Forepeak edge (a band edge). */
const FP_Z = -33.8;
/** Pool (a sunken well, band edges at both ends). */
const POOL = { x0: -2.2, x1: 1.6, z0: 29.9, z1: 36.9, floor: -1.2 };
/** Below-deck void. */
const V = { x0: -5.35, x1: 2.0, z0: -16.0, z1: 15.2 };
/** Port catwalk outside the hull. */
const CW = { x0: -10.4, z0: -10.8, z1: 11.2 };

/** Half width of the hull's deck edge at z (0 beyond the ends). */
export function hullHalfWidth(z: number): number {
  if (z >= MID0 && z <= MID1) return BEAM;
  const pts = z < 0 ? HULL_BOW : HULL_STERN;
  if (z < pts[0]![0] || z > pts.at(-1)![0]) return 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [za, wa] = pts[i]!;
    const [zb, wb] = pts[i + 1]!;
    if (z >= za && z <= zb) return wa + ((wb - wa) * (z - za)) / (zb - za);
  }
  return 0;
}

const MATERIALS: Record<string, MaterialDef> = {
  teak: { texture: 'hj_teak', uvMul: [1 / 2.5, 1 / 2.5] },
  teakInt: { texture: 'hj_teak', tint: 0xe0b890, uvMul: [1 / 2.5, 1 / 2.5] },
  paintDeck: { texture: 'hj_paint', tint: 0xd4d2cc, uvMul: [1 / 3, 1 / 3] },
  hull: { texture: 'hj_paint', uvMul: [1 / 3, 1 / 3] },
  navy: { texture: 'hj_paint', tint: 0x2a3a62, uvMul: [1 / 3, 1 / 3] },
  paint: { texture: 'hj_paint', tint: 0xf4efe2, uvMul: [1 / 3, 1 / 3] },
  ceiling: { texture: 'hj_paint', tint: 0xf6f2ea, uvMul: [1 / 3, 1 / 3] },
  panel: { texture: 'nt_plaster', tint: 0xf2e4ca, uvMul: [1 / 3, 1 / 3] },
  carpet: { texture: 'hj_carpet', uvMul: [1 / 2, 1 / 2] },
  carpetBlue: { texture: 'hj_carpet', tint: 0x8aa2cc, uvMul: [1 / 2, 1 / 2] },
  tile: { texture: 'hj_tile', uvMul: [1 / 1.2, 1 / 1.2] },
  poolTile: { texture: 'hj_tile', tint: 0x8ed4e0, uvMul: [1 / 1.2, 1 / 1.2] },
  window: { texture: 'hj_window', uvMul: [1 / 1.6, 1 / 1.3] },
  louvre: { texture: 'hj_louvre', uvMul: [1, 1] },
  machine: { texture: 'hj_machine', uvMul: [1 / 2, 1 / 2] },
  grate: { texture: 'hj_grate', uvMul: [1 / 1.5, 1 / 1.5] },
  bulkhead: { texture: 'hj_bulkhead', uvMul: [1 / 2.5, 1 / 2.5] },
  bottles: { texture: 'hj_bottles' },
  sea: { texture: 'hj_sea', uvMul: [1 / 9, 1 / 9] },
  foam: { texture: 'hj_foam', uvMul: [1 / 4, 1 / 4] },
  pool: { texture: 'hj_pool', emissive: 0.35, uvMul: [1 / 1.5, 1 / 1.5] },
  name: { texture: 'hj_name' },
  emblem: { texture: 'hj_emblem' },
  glass: { texture: 'bo_glass' },
  glassRail: { texture: 'hj_glass', side: 'double', uvMul: [1 / 1.2, 1] },
  steel: { texture: 'steel' },
  chrome: { texture: 'steel', tint: 0xe4e8ec },
  wood: { texture: 'bo_wood', uvMul: [1 / 1.2, 1 / 1.2] },
  fabric: { texture: 'bo_fabric', tint: 0xece4d4, uvMul: [1 / 1.5, 1 / 1.5] },
  fabricBlue: { texture: 'bo_fabric', tint: 0x5a78a8, uvMul: [1 / 1.5, 1 / 1.5] },
  fabricRed: { texture: 'bo_fabric', tint: 0xa84a3a, uvMul: [1 / 1.5, 1 / 1.5] },
  rubber: { texture: 'rubber', uvMul: [1 / 0.4, 1 / 0.4] },
  tender: { texture: 'bo_carpaint', tint: 0xf2f2ee },
  lamp: { texture: 'lamp', emissive: 1 },
  crate: { texture: 'crate', uvMul: [1 / 1.2, 1 / 1.2] },
  hazard: { texture: 'hazard', uvMul: [1 / 0.6, 1 / 0.6] },
  clip: { texture: 'none' },
};

const door = (a: number, w = 1.3, y0 = 0): Hole => ({ a0: a - w / 2, a1: a + w / 2, y0, y1: y0 + 2.2 });
const win = (a0: number, a1: number, y0 = 0.9, y1 = 2.1): Hole => ({ a0, a1, y0, y1 });

/** Yaw of a box whose local x runs from (x0, z0) to (x1, z1) (renderer convention). */
const segYaw = (x0: number, z0: number, x1: number, z1: number) => Math.atan2(-(z1 - z0), x1 - x0);

// ---------------------------------------------------------------------------------------------
// Hull, decks, railings
// ---------------------------------------------------------------------------------------------

/** Band edges of a taper: `step` apart from a to b (the last band takes the remainder). */
function bands(a: number, b: number, step = 0.5): number[] {
  const out: number[] = [];
  for (let z = a; z < b - step * 0.5 + 1e-9; z += step) out.push(Math.round(z * 100) / 100);
  out.push(b);
  return out;
}

/** A players-only railing clip (bullets and sight pass the glass). */
const railClip = (k: MapKit, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => k.clip(x0, y0, z0, x1, y1, z1, 'fence-low');

/**
 * The hull: stepped deck bands down the bow and stern tapers (collision is axis-aligned), smooth
 * render-only hull skin and glass railings along the real outline, the full-width middle with the
 * below-deck void cut out, the sunken pool well, the raised forepeak.
 */
function hull(k: MapKit) {
  const taper = (edges: number[]) => {
    const ws: number[] = [];
    for (let i = 0; i < edges.length - 1; i++) {
      const z0 = edges[i]!;
      const z1 = edges[i + 1]!;
      const w = Math.floor(Math.min(hullHalfWidth(z0), hullHalfWidth(z1)) * 20) / 20;
      ws.push(w);
      const top = z1 <= FP_Z + 1e-6 ? FORE : DECK;
      const deckMat = top === FORE ? 'paintDeck' : 'teak';
      const inPool = z0 >= POOL.z0 - 1e-6 && z1 <= POOL.z1 + 1e-6;
      if (inPool) {
        k.aabb(-w, KEEL, z0, POOL.x0, top, z1, 'hull', { faceMats: { py: deckMat, px: 'poolTile' }, hide: ['ny'] });
        k.aabb(POOL.x1, KEEL, z0, w, top, z1, 'hull', { faceMats: { py: deckMat, nx: 'poolTile' }, hide: ['ny'] });
        k.aabb(POOL.x0, KEEL, z0, POOL.x1, POOL.floor, z1, 'hull', { faceMats: { py: 'poolTile' }, hide: ['ny', 'nx', 'px'] });
      } else {
        const fm: Record<string, string> = { py: deckMat };
        if (Math.abs(z1 - POOL.z0) < 1e-6) fm.pz = 'poolTile';
        if (Math.abs(z0 - POOL.z1) < 1e-6) fm.nz = 'poolTile';
        k.aabb(-w, KEEL, z0, w, top, z1, 'hull', { faceMats: fm, hide: ['ny'] });
      }
      // Railing clips just inside the band's edge, both sides.
      for (const s of [-1, 1]) railClip(k, s < 0 ? -w : w - 0.1, top, z0, s < 0 ? -w + 0.1 : w, top + RAIL, z1);
    }
    // Cross clips where the band width steps.
    for (let i = 0; i < ws.length - 1; i++) {
      const z = edges[i + 1]!;
      const a = ws[i]!;
      const b = ws[i + 1]!;
      if (Math.abs(a - b) < 1e-6) continue;
      const ya = edges[i + 1]! <= FP_Z + 1e-6 ? FORE : DECK;
      const yb = edges[i + 2]! <= FP_Z + 1e-6 ? FORE : DECK;
      const y0 = Math.min(ya, yb);
      const y1 = Math.max(ya, yb) + RAIL;
      for (const s of [-1, 1]) railClip(k, s < 0 ? -Math.max(a, b) : Math.min(a, b) - 0.1, y0, z - 0.05, s < 0 ? -Math.min(a, b) + 0.1 : Math.max(a, b), y1, z + 0.05);
    }
    return ws;
  };
  const bowEdges = bands(BOW_Z, MID0);
  const bowW = taper(bowEdges);
  railClip(k, -bowW[0]!, FORE, BOW_Z, bowW[0]!, FORE + RAIL, BOW_Z + 0.1);
  const sternEdges = bands(MID1, STERN_Z);
  const sternW = taper(sternEdges);
  railClip(k, -sternW.at(-1)!, DECK, STERN_Z - 0.1, sternW.at(-1)!, DECK + RAIL, STERN_Z);
  // Forepeak stairs (centreline) down to the bow deck.
  k.stairs(-2.1, DECK, FP_Z, 2.1, FORE, FP_Z + 1.8, '-z', 'teak', 4);

  // ---- the middle: deck slab (stairwell openings, the hot tub vent) over the hull body ----
  const holes: [number, number, number, number][] = [
    [-5.15, -14.2, -3.8, -7.85], // Bow Cabin chute
    [-5.35, 6.65, -3.95, 15.0], // Stern Cabin stairwell
    [-4.9, -2.5, -4.4, -1.7], // the vent by the hot tub
  ];
  k.groundWithHoles([-BEAM, MID0, BEAM, MID1], DECK, 0.3, 'hull', holes, { faceMats: { py: 'teak' }, hide: ['ny'] });
  const body = { hide: ['py', 'ny'] as ('py' | 'ny')[] };
  for (const [z0, z1, inner] of [[MID0, V.z0, false], [V.z0, V.z1, true], [V.z1, MID1, false]] as const) {
    k.aabb(-BEAM, KEEL, z0, V.x0, -0.3, z1, 'hull', { ...body, ...(inner ? { faceMats: { px: 'bulkhead' } } : {}) });
    k.aabb(V.x1, KEEL, z0, BEAM, -0.3, z1, 'hull', { ...body, ...(inner ? { faceMats: { nx: 'bulkhead' } } : {}) });
  }
  k.aabb(V.x0, KEEL, MID0, V.x1, -0.3, V.z0, 'hull', { ...body, faceMats: { pz: 'bulkhead' } });
  k.aabb(V.x0, KEEL, V.z1, V.x1, -0.3, MID1, 'hull', { ...body, faceMats: { nz: 'bulkhead' } });
  // Below-deck floor and ceiling (the ceiling is render-only, with the openings left out).
  k.aabb(V.x0, KEEL, V.z0, V.x1, LOW, V.z1, 'grate', { hide: ['ny', 'nx', 'px', 'nz', 'pz'] });
  k.groundWithHoles([V.x0, V.z0, V.x1, V.z1], -0.3, 0.05, 'bulkhead', holes, { collide: false, hide: ['py', 'nx', 'px', 'nz', 'pz'] });
  // The vent grate over its hole: players stand on it, bullets and grenades' rays fall through.
  k.aabb(-4.9, -0.06, -2.5, -4.4, 0, -1.7, 'grate', { players: true, bullets: false, sight: false });

  // Middle railing clips (port has the catwalk openings; the hot tub bay closes the rest).
  railClip(k, BEAM - 0.1, DECK, MID0, BEAM, DECK + RAIL, MID1);
  railClip(k, -BEAM, DECK, MID0, -BEAM + 0.1, DECK + RAIL, CW.z0);
  railClip(k, -BEAM, DECK, CW.z1, -BEAM + 0.1, DECK + RAIL, MID1);

  // ---- render-only hull skin, boot stripe and glass railings along the smooth outline ----
  const outline = (pts: [number, number][], extra: number[]) => {
    const zs = [...new Set([...pts.map((p) => p[0]), ...extra])].sort((a, b) => a - b);
    return zs.map((z) => [z, hullHalfWidth(z)] as [number, number]);
  };
  const bowPts = outline(HULL_BOW, [FP_Z]);
  const sternPts = outline(HULL_STERN, []);
  const deckAt = (z: number) => (z <= FP_Z + 1e-6 ? FORE : DECK);
  const skin = (pts: [number, number][]) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [za, wa] = pts[i]!;
      const [zb, wb] = pts[i + 1]!;
      for (const s of [-1, 1]) {
        const xa = s * wa;
        const xb = s * wb;
        const len = Math.hypot(xb - xa, zb - za);
        const ry = segYaw(xa, za, xb, zb);
        // Inward normal (towards the centreline).
        const nx = -(zb - za) / len;
        const nz = (xb - xa) / len;
        const sg = nx * -s > 0 ? 1 : -1;
        const ix = sg * nx;
        const iz = sg * nz;
        const cx = (xa + xb) / 2;
        const cz = (za + zb) / 2;
        const top = Math.min(deckAt(za), deckAt(zb)) + 0.08;
        k.box(len + 0.05, top - KEEL, 0.5, 'hull', cx + ix * 0.25, KEEL, cz + iz * 0.25, { ry, collide: false, hide: ['ny'] });
        // Decals face +z turned by ry, i.e. along (sin ry, cos ry): flip those that would face inboard.
        const out = ry + (Math.sin(ry) * ix + Math.cos(ry) * iz > 0 ? PI : 0);
        k.wallDecal(len, 0.4, 'navy', cx - ix * 0.005, -2.4, cz - iz * 0.005, out, { seg: 1 });
        if (za <= -30 && zb >= -30) {
          const t = (-30 - za) / (zb - za);
          k.wallDecal(4.2, 0.6, 'name', xa + (xb - xa) * t - ix * 0.006, -1.3, -30 - iz * 0.006, out, { uv: 'raw', seg: 2 });
        }
        // Glass panel, handrail, a post at the segment start.
        const base = Math.max(deckAt(za), deckAt(zb));
        k.wallDecal(len, 0.85, 'glassRail', cx + ix * 0.06, base + 0.08, cz + iz * 0.06, ry, { seg: 1 });
        k.box(len + 0.06, 0.06, 0.06, 'chrome', cx + ix * 0.06, base + RAIL - 0.06, cz + iz * 0.06, { ry, collide: false });
        k.box(0.06, RAIL - 0.08, 0.06, 'chrome', xa + ix * 0.06, deckAt(za), za + iz * 0.06, { collide: false });
      }
    }
  };
  skin(bowPts);
  skin(sternPts);
  // Transom.
  k.box(2 * HULL_STERN.at(-1)![1] + 0.2, -KEEL + 0.08, 0.4, 'navy', 0, KEEL, STERN_Z + 0.2, { collide: false, hide: ['ny'] });
  k.wallDecal(2 * HULL_STERN.at(-1)![1], 0.85, 'glassRail', 0, DECK + 0.08, STERN_Z - 0.06, 0, { seg: 2 });
  k.box(2 * HULL_STERN.at(-1)![1], 0.06, 0.06, 'chrome', 0, DECK + RAIL - 0.06, STERN_Z - 0.06, { collide: false });
  // Straight middle: gunwale lip, boot stripe, railings (posts every ~1.6 m), the hull name.
  for (const s of [-1, 1]) {
    k.aabb(s < 0 ? -BEAM - 0.02 : BEAM - 0.3, DECK, MID0, s < 0 ? -BEAM + 0.3 : BEAM + 0.02, DECK + 0.08, MID1, 'hull', { collide: false, hide: ['ny'] });
    k.wallDecal(MID1 - MID0, 0.4, 'navy', s * (BEAM + 0.01), -2.4, (MID0 + MID1) / 2, s * (PI / 2), { seg: 8 });
    const spans: [number, number][] = s > 0 ? [[MID0, MID1]] : [[MID0, CW.z0], [CW.z1, MID1]];
    for (const [z0, z1] of spans) {
      const x = s * (BEAM - 0.06);
      k.wallDecal(z1 - z0, 0.85, 'glassRail', x, DECK + 0.08, (z0 + z1) / 2, s * (PI / 2), { seg: 4 });
      k.aabb(x - 0.03, DECK + RAIL - 0.06, z0, x + 0.03, DECK + RAIL, z1, 'chrome', { collide: false });
      const n = Math.max(1, Math.round((z1 - z0) / 1.6));
      for (let i = 0; i <= n; i++) k.box(0.06, RAIL - 0.08, 0.06, 'chrome', x, DECK, z0 + ((z1 - z0) * i) / n, { collide: false });
    }
    // "VAHN BOYAGE" at the stern end (the bow pair is on the taper skin).
    k.wallDecal(4.2, 0.6, 'name', s * (BEAM + 0.015), -1.3, 20.5, s * (PI / 2), { uv: 'raw', seg: 2 });
  }

  // ---- the port emergency catwalk, hung outside the hull round the hot tub bay ----
  k.aabb(CW.x0, -0.25, CW.z0, -BEAM, DECK, CW.z1, 'grate', { hide: ['px'] });
  for (let z = CW.z0 + 0.6; z < CW.z1; z += 2.2) k.trim(2.2, 0.12, 0.12, 'steel', (CW.x0 - BEAM) / 2, -0.95, z, { ry: 0.45 });
  railClip(k, CW.x0, DECK, CW.z0, CW.x0 + 0.1, DECK + RAIL, CW.z1);
  railClip(k, CW.x0, DECK, CW.z0 - 0.1, -BEAM, DECK + RAIL, CW.z0);
  railClip(k, CW.x0, DECK, CW.z1, -BEAM, DECK + RAIL, CW.z1 + 0.1);
  k.aabb(CW.x0 + 0.02, DECK + RAIL - 0.06, CW.z0, CW.x0 + 0.08, DECK + RAIL, CW.z1, 'chrome', { collide: false });
  k.aabb(CW.x0, DECK + RAIL - 0.06, CW.z0 - 0.04, -BEAM, DECK + RAIL, CW.z0 + 0.02, 'chrome', { collide: false });
  k.aabb(CW.x0, DECK + RAIL - 0.06, CW.z1 - 0.02, -BEAM, DECK + RAIL, CW.z1 + 0.04, 'chrome', { collide: false });
  for (let z = CW.z0; z <= CW.z1 + 1e-6; z += (CW.z1 - CW.z0) / 12) k.box(0.05, RAIL - 0.08, 0.05, 'chrome', CW.x0 + 0.05, DECK, z, { collide: false });
  for (let y = 0.3; y < RAIL - 0.1; y += 0.3) k.aabb(CW.x0 + 0.03, y, CW.z0, CW.x0 + 0.06, y + 0.03, CW.z1, 'chrome', { collide: false });
}

// ---------------------------------------------------------------------------------------------
// The bow deck: forepeak emblem, tenders, capstan, bollards
// ---------------------------------------------------------------------------------------------

/** A tender on chocks, long axis along z, bow forward; collides as one box (1.45 m, no climbing). */
function tender(k: MapKit, x: number, z: number) {
  const L = 5.6;
  const W = 2.6;
  k.box(W, 1.45, L, 'tender', x, 0, z, { faceMats: { py: 'teak' } });
  k.trim(W + 0.12, 0.22, L - 0.4, 'navy', x, 0.65, z + 0.2, { hide: ['py', 'ny'] });
  k.trim(1.6, 0.5, 1.0, 'tender', x, 1.45, z - 0.4);
  k.trim(1.5, 0.35, 0.06, 'glass', x, 1.95, z - 0.92);
  k.trim(W - 0.6, 0.45, 1.3, 'fabric', x, 1.45, z + 1.4);
  for (const dz of [-1.6, 1.6]) k.trim(W - 0.4, 0.3, 0.5, 'wood', x, -0.01, z + dz);
}

function bowDeck(k: MapKit) {
  // Forepeak: emblem, anchor wells, windlasses, bollards.
  k.flatDecal(3.4, 3.4, 'emblem', 0, FORE + 0.012, -38.0, { uv: 'raw', seg: 2 });
  for (const s of [-1, 1]) {
    k.flatDecal(1.2, 1.6, 'navy', s * 2.6, FORE + 0.012, -35.0, { ry: s * 0.5, seg: 1 });
    k.box(0.7, 0.55, 0.9, 'steel', s * 1.5, FORE, -35.6);
    k.cyl(0.18, 0.4, 8, 'steel', s * 3.0, FORE + 0.2, -36.6);
    k.cyl(0.18, 0.4, 8, 'steel', s * 6.0, 0.2, -31.0);
    k.cyl(0.18, 0.4, 8, 'steel', s * 7.5, 0.2, -24.0);
  }
  k.box(0.08, 3.2, 0.08, 'chrome', 0, FORE, -40.6, { collide: false });
  // The tenders on chocks either side, the capstan between them.
  tender(k, -5.0, -27.8);
  tender(k, 5.0, -27.8);
  k.box(1.2, 0.9, 1.0, 'steel', 0, 0, -25.9);
  k.trim(0.9, 0.3, 0.7, 'machine', 0, 0.9, -25.9);
  // Deck hatches.
  for (const [x, z] of [[-1.6, -30.4], [1.6, -30.4]] as const) k.flatDecal(1.0, 1.0, 'grate', x, 0.012, z, { seg: 1 });
}

// ---------------------------------------------------------------------------------------------
// Cabins
// ---------------------------------------------------------------------------------------------

/** Exterior walls of a two-storey cabin side, split at the slab (each storey its own holes). */
function storeys(k: MapKit, axis: 'x' | 'z', a0: number, a1: number, c: number, holes: Hole[], inner: 'px' | 'nx' | 'pz' | 'nz', top = EAVE) {
  const fm = { faceMats: { [inner]: 'panel' } };
  k.wall(axis, a0, a1, c, 0, SLAB, T, 'paint', holes.filter((h) => h.y1 <= SLAB + 1e-6), fm);
  k.wall(axis, a0, a1, c, SLAB, top - SLAB, T, 'paint', holes.filter((h) => h.y0 >= SLAB - 1e-6).map((h) => ({ ...h, y0: h.y0 - SLAB, y1: h.y1 - SLAB })), fm);
}

/** Window frames + mullions for a hole in a wall face (render-only trim). */
function frame(k: MapKit, axis: 'x' | 'z', c: number, a0: number, a1: number, y0: number, y1: number, out: number) {
  const n = Math.max(1, Math.round((a1 - a0) / 1.3));
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    if (axis === 'x') k.trim(0.06, y1 - y0, 0.08, 'chrome', a, y0, c + out);
    else k.trim(0.08, y1 - y0, 0.06, 'chrome', c + out, y0, a);
  }
  if (axis === 'x') k.trim(a1 - a0, 0.06, 0.1, 'chrome', (a0 + a1) / 2, y0 - 0.06, c + out);
  else k.trim(0.1, 0.06, a1 - a0, 'chrome', c + out, y0 - 0.06, (a0 + a1) / 2);
}

/** A solid stair balustrade on one side of a flight: a low wall + a wedge up to the top. */
function balustrade(k: MapKit, x0: number, z0: number, x1: number, z1: number, dir: '+x' | '-x' | '+z' | '-z', y0: number, rise: number) {
  k.aabb(x0, y0, z0, x1, y0 + RAIL, z1, 'paint');
  k.ramp(x0, y0 + RAIL, z0, x1, y0 + RAIL + rise, z1, dir, 'paint');
}

/**
 * The Bow Cabin: dining room (front door, side doors) | partition | the lane with the chute down
 * (port) and the galley with the stairs up (starboard). Upstairs the bridge (front windows, the
 * exterior stair's door) and the office (the window over the middle). Dome roof with the radar.
 */
function bowCabin(k: MapKit) {
  const X = 5.4;
  const Z0 = -20.0;
  const Z1 = -7.6;
  const ix = X - T;
  const iz0 = Z0 + T;
  const iz1 = Z1 - T;
  // Exterior walls.
  storeys(k, 'x', -X, X, Z0 + T / 2, [door(-2.4), win(-4.7, -3.3), win(-4.6, 3.4, F2 + 1.0, F2 + 2.3), door(4.6, 1.4, F2)], 'pz');
  storeys(k, 'x', -X, X, Z1 - T / 2, [door(-2.4), door(1.6), win(3.0, 4.6), win(-1.6, 4.4, F2 + 0.9, F2 + 2.2)], 'nz');
  storeys(k, 'z', Z0 + T, Z1 - T, -X + T / 2, [door(-17.6), win(-16.6, -15.4), win(-19.0, -16.4, F2 + 0.9, F2 + 2.2), win(-13.0, -9.0, F2 + 0.9, F2 + 2.2)], 'px');
  storeys(k, 'z', Z0 + T, Z1 - T, X - T / 2, [door(-17.6), win(-16.6, -15.6), win(-19.0, -16.4, F2 + 0.9, F2 + 2.2), win(-13.0, -11.0, F2 + 0.9, F2 + 2.2)], 'nx');
  frame(k, 'x', Z0, -4.6, 3.4, F2 + 1.0, F2 + 2.3, -0.04);
  frame(k, 'x', Z1, -1.6, 4.4, F2 + 0.9, F2 + 2.2, 0.04);
  // Band between the storeys, corner pillars of the roof overhang.
  k.trim(2 * X + 0.2, 0.2, Z1 - Z0 + 0.2, 'navy', 0, SLAB, (Z0 + Z1) / 2, { hide: ['py', 'ny'] });
  for (const sx of [-1, 1]) for (const z of [Z0 - 0.45, Z1 + 0.3]) k.box(0.3, EAVE, 0.3, 'paint', sx * 5.95, 0, z);

  // Floors.
  k.flatDecal(2 * ix, -15.3 - iz0, 'carpet', 0, 0.02, (iz0 - 15.3) / 2);
  k.flatDecal(5.15 + 1.0, iz1 + 15.1, 'tile', (5.15 - 1.0) / 2, 0.02, (iz1 - 15.1) / 2);
  k.flatDecal(-1.2 + 3.7, iz1 + 15.1, 'teakInt', (-1.2 - 3.7) / 2, 0.02, (iz1 - 15.1) / 2);
  // Partitions: dining | aft half; lane | galley.
  k.wall('x', -ix, ix, -15.2, 0, SLAB, 0.2, 'panel', [door(-2.4), door(1.6)]);
  k.wall('z', -15.1, iz1, -1.1, 0, SLAB, 0.2, 'panel', [door(-12.0)]);
  // The chute: stairs down along the port wall to the container bay; a half wall on the lane side.
  k.stairs(-ix, LOW, -14.2, -3.8, DECK, -7.85, '-z', 'grate', 15);
  k.aabb(-3.8, 0, -14.2, -3.7, RAIL, iz1, 'paint');
  for (const [x, z] of [[-4.5, -14.3], [-4.5, -8.4]] as const) k.light(x, -1.0, z, [1.2, 1.1, 0.9], 6, 'interior');
  // The stairs up along the starboard wall of the galley (to the office).
  k.stairs(3.85, DECK, -14.6, ix, F2, -8.3, '-z', 'teakInt', 15);
  k.aabb(3.75, 0, -14.6, 3.85, 1.4, -8.3, 'panel', { collide: false });

  // Upper floor: slab with the stair hole, partition bridge | office, ceiling.
  k.groundWithHoles([-ix, iz0, ix, iz1], F2, F2 - SLAB, 'ceiling', [[3.85, -14.6, ix, -9.3]], { faceMats: { py: 'carpet' } });
  k.aabb(3.75, F2, -14.6, 3.85, F2 + RAIL, -9.3, 'chrome', { bullets: false, sight: false });
  k.aabb(3.75, F2, -9.4, ix, F2 + RAIL, -9.3, 'chrome', { bullets: false, sight: false });
  k.flatDecal(2 * ix, -16.1 - iz0, 'carpetBlue', 0, F2 + 0.015, (iz0 - 16.1) / 2);
  k.wall('x', -ix, ix, -16.0, F2, EAVE - F2, 0.2, 'panel', [door(0)]);
  k.aabb(-ix, EAVE - 0.12, iz0, ix, EAVE, iz1, 'ceiling', { hide: ['py'] });
  // Roof (overhang), dome, radome and mast.
  k.aabb(-6.1, EAVE, Z0 - 0.6, 6.1, EAVE + 0.25, Z1 + 0.4, 'paint');
  k.aabb(-4.7, EAVE + 0.25, -18.9, 4.7, EAVE + 0.9, -8.7, 'paint', { collide: false });
  k.aabb(-3.7, EAVE + 0.9, -17.6, 3.7, EAVE + 1.4, -10.0, 'window', { collide: false, faceMats: { py: 'paint' } });
  k.cyl(0.9, 0.9, 10, 'paint', 0, EAVE + 1.85, -14.2, { collide: false });
  k.trim(0.12, 3.0, 0.12, 'steel', 0, EAVE + 2.3, -12.0);
  k.trim(2.2, 0.08, 0.08, 'steel', 0, EAVE + 4.6, -12.0);
  k.glow(0, EAVE + 5.35, -12.0, [1, 0.2, 0.15], 0.8, undefined, true);

  // Exterior stair up the front wall (rising to starboard), its landing and door into the bridge.
  k.stairs(0.4, DECK, Z0 - 1.6, 4.0, F2, Z0, '+x', 'teak', 15);
  balustrade(k, 0.4, Z0 - 1.75, 4.0, Z0 - 1.6, '+x', 0, F2);
  k.aabb(4.0, SLAB - 0.05, Z0 - 1.75, 5.7, F2, Z0, 'paint', { faceMats: { py: 'teak' } });
  k.aabb(4.0, F2, Z0 - 1.75, 5.7, F2 + RAIL, Z0 - 1.65, 'paint', { bullets: false, sight: false });
  k.aabb(5.6, F2, Z0 - 1.75, 5.7, F2 + RAIL, Z0, 'paint', { bullets: false, sight: false });

  // ---- furniture ----
  // Dining: table and chairs, the bar cabinet against the partition (bottles behind glass), sideboard.
  k.box(3.0, 0.76, 1.6, 'wood', 0.2, 0, -17.6, { sight: false });
  for (const dx of [-1.0, 0.2, 1.4]) for (const dz of [-1.15, 1.15]) k.box(0.45, 0.9, 0.45, 'fabric', dx, 0, -17.6 + dz, { sight: false });
  k.box(2.4, 2.0, 0.45, 'wood', -0.25, 0, -15.55);
  k.wallDecal(2.2, 1.6, 'bottles', -0.25, 0.25, -15.78 - 0.005, PI, { uv: 'raw' });
  k.box(0.5, 0.9, 1.8, 'wood', -ix + 0.25, 0, -16.0);
  // Galley: counters (gap at the door), island, stove, fridge, the counter under the starboard window.
  k.box(1.8, 0.95, 0.6, 'chrome', 0.0, 0, -14.75, { faceMats: { py: 'tile' } });
  k.box(1.2, 0.95, 0.6, 'chrome', 3.0, 0, -14.75, { faceMats: { py: 'tile' } });
  k.box(2.0, 0.95, 1.0, 'chrome', 1.6, 0, -11.2, { faceMats: { py: 'tile' } });
  k.box(0.6, 0.95, 1.2, 'steel', -0.65, 0, -13.6);
  k.box(0.7, 2.0, 0.7, 'chrome', -0.6, 0, -8.6);
  // Bridge: helm console under the front windows, captain's chair, chart table.
  k.box(7.0, 1.0, 0.7, 'navy', -0.6, F2, iz0 + 0.35, { faceMats: { py: 'window' } });
  k.box(0.7, 1.1, 0.7, 'fabricBlue', -0.6, F2, -18.2, { sight: false });
  k.box(1.6, 0.9, 1.0, 'wood', -3.4, F2, -17.2);
  // Office: desk with the monitor, bookshelves on the port wall, a sofa.
  k.box(2.4, 0.78, 0.9, 'wood', 0.2, F2, -11.2);
  k.trim(0.8, 0.5, 0.06, 'glass', 0.2, F2 + 0.78, -11.5);
  k.box(0.4, 2.0, 3.0, 'wood', -ix + 0.2, F2, -11.5);
  k.box(2.0, 0.8, 0.8, 'fabric', -2.6, F2, -8.4, { sight: false });

  // Lights.
  k.light(0, 2.6, -17.5, [1.35, 1.15, 0.85], 8, 'interior');
  k.light(2.0, 2.6, -11.0, [1.3, 1.25, 1.1], 7, 'interior');
  k.light(-2.4, 2.6, -11.0, [1.3, 1.15, 0.9], 6, 'interior');
  k.light(0, F2 + 2.5, -18.0, [1.1, 1.15, 1.3], 7, 'interior');
  k.light(0, F2 + 2.5, -11.5, [1.3, 1.15, 0.9], 8, 'interior');
  for (const sx of [-1, 1]) {
    k.trim(0.2, 0.3, 0.12, 'lamp', sx * (X + 0.08), 2.3, -18.05 + 1.0);
    k.light(sx * (X + 0.6), 2.3, -17.0, [1.6, 1.25, 0.8], 7, 'deck');
  }
}

/**
 * The Stern Cabin: lounge bar (fore door, stairs up on starboard), two guest bedrooms, the aft
 * lobby (aft door, side doors) and the stairwell down along the port wall. Upstairs the master
 * stateroom (the window over the middle) and the open aft terrace with its two stair flights.
 * The radar arch with its wings over the walkways.
 */
function sternCabin(k: MapKit) {
  const X = 5.6;
  const Z0 = 6.4;
  const Z1 = 17.4;
  const ZU = 14.4;
  const ZT = 19.8;
  const ix = X - T;
  const iz0 = Z0 + T;
  // Ground floor walls.
  k.wall('x', -X, X, Z0 + T / 2, 0, SLAB, T, 'paint', [door(-1.6), win(0.4, 3.2)], { faceMats: { pz: 'panel' } });
  k.wall('x', -X, X, Z1 - T / 2, 0, SLAB, T, 'paint', [door(0, 1.4), win(-3.4, -1.6), win(1.6, 3.4)], { faceMats: { nz: 'panel' } });
  k.wall('z', Z0 + T, Z1 - T, -X + T / 2, 0, SLAB, T, 'paint', [door(16.0), win(7.6, 9.0, 1.2, 2.1)], { faceMats: { px: 'panel' } });
  k.wall('z', Z0 + T, Z1 - T, X - T / 2, 0, SLAB, T, 'paint', [door(16.0), win(12.2, 14.2)], { faceMats: { nx: 'panel' } });
  // Upper walls (the stateroom).
  k.wall('x', -X, X, Z0 + T / 2, SLAB, EAVE - SLAB, T, 'paint', [win(-3.6, 3.2, F2 + 0.9 - SLAB, F2 + 2.2 - SLAB)], { faceMats: { pz: 'panel' } });
  k.wall('x', -X, X, ZU - T / 2, SLAB, EAVE - SLAB, T, 'paint', [door(-2.4, 1.3, F2 - SLAB), door(2.4, 1.3, F2 - SLAB)], { faceMats: { nz: 'panel' } });
  k.wall('z', Z0 + T, ZU - T, -X + T / 2, SLAB, EAVE - SLAB, T, 'paint', [win(8.0, 12.6, F2 + 0.9 - SLAB, F2 + 2.2 - SLAB)], { faceMats: { px: 'panel' } });
  k.wall('z', Z0 + T, ZU - T, X - T / 2, SLAB, EAVE - SLAB, T, 'paint', [win(11.6, 13.6, F2 + 0.9 - SLAB, F2 + 2.2 - SLAB)], { faceMats: { nx: 'panel' } });
  frame(k, 'x', Z0, -3.6, 3.2, F2 + 0.9, F2 + 2.2, -0.04);
  k.trim(2 * X + 0.2, 0.2, Z1 - Z0 + 0.2, 'navy', 0, SLAB, (Z0 + Z1) / 2, { hide: ['py', 'ny'] });

  // Floors.
  k.flatDecal(5.35 + 3.75, 11.2 - iz0, 'carpet', (5.35 - 3.75) / 2, 0.02, (iz0 + 11.2) / 2);
  k.flatDecal(5.35 + 3.75, 15.0 - 11.4, 'carpet', (5.35 - 3.75) / 2, 0.02, (11.4 + 15.0) / 2);
  k.flatDecal(2 * ix, Z1 - T - 15.2, 'teakInt', 0, 0.02, (15.2 + Z1 - T) / 2);
  // Partitions: the stairwell wall, lounge | bedrooms, bedrooms | lobby, the bedroom divider.
  k.aabb(-3.95, 0, iz0, -3.75, SLAB, 15.0, 'panel');
  k.wall('x', -3.75, ix, 11.3, 0, SLAB, 0.2, 'panel', [door(-2.4), door(2.4)]);
  k.wall('x', -3.75, ix, 15.1, 0, SLAB, 0.2, 'panel', [door(-1.6), door(3.2)]);
  k.aabb(0.65, 0, 11.4, 0.85, SLAB, 15.0, 'panel');
  // The stairwell down (rising aft, the top at the lobby) and its landing below.
  k.stairs(-ix, LOW, 9.2, -3.95, DECK, 15.0, '+z', 'grate', 15);
  k.light(-4.6, -1.0, 8.0, [1.2, 1.1, 0.9], 6, 'interior');
  // Stairs up along the starboard wall of the lounge.
  k.stairs(4.05, DECK, iz0 + 0.25, ix, F2, 11.1, '+z', 'teakInt', 15);
  k.aabb(3.95, 0, iz0 + 0.25, 4.05, 1.4, 11.1, 'panel', { collide: false });

  // Upper floor slab (stateroom + terrace), stair hole and its rails.
  k.groundWithHoles([-ix, iz0, ix, ZU - T], F2, F2 - SLAB, 'ceiling', [[4.05, 6.9, ix, 11.1]], { faceMats: { py: 'carpet' } });
  k.aabb(-X, SLAB, ZU - T, X, F2, ZT, 'ceiling', { faceMats: { py: 'teak' } });
  k.aabb(3.95, F2, 6.9, 4.05, F2 + RAIL, 11.1, 'chrome', { bullets: false, sight: false });
  k.aabb(-ix, EAVE - 0.12, iz0, ix, EAVE, ZU - T, 'ceiling', { hide: ['py'] });
  k.aabb(-5.8, EAVE, Z0 - 0.2, 5.8, EAVE + 0.25, ZU + 0.2, 'paint');
  // Terrace: side and aft railings (glass), the two flights down to the stern deck, posts.
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -X : X - 0.1;
    railClip(k, x0, F2, ZU, x0 + 0.1, F2 + RAIL, ZT);
    k.wallDecal(ZT - ZU, 0.85, 'glassRail', sx * (X - 0.05), F2 + 0.08, (ZU + ZT) / 2, sx * (PI / 2), { seg: 3 });
    k.aabb(sx * (X - 0.05) - 0.03, F2 + RAIL - 0.06, ZU, sx * (X - 0.05) + 0.03, F2 + RAIL, ZT, 'chrome', { collide: false });
    const sx0 = sx < 0 ? -5.4 : 3.6;
    const sx1 = sx < 0 ? -3.6 : 5.4;
    k.stairs(sx0, DECK, ZT, sx1, F2, ZT + 4.4, '-z', 'teak', 15);
    balustrade(k, sx0 - 0.15, ZT, sx0, ZT + 4.4, '-z', 0, F2);
    balustrade(k, sx1, ZT, sx1 + 0.15, ZT + 4.4, '-z', 0, F2);
    k.box(0.25, SLAB, 0.25, 'paint', sx * 3.2, 0, ZT - 0.3);
    // Loungers on the terrace.
    k.box(0.8, 0.42, 1.9, 'fabric', sx * 2.0, F2, 17.0, { sight: false });
  }
  railClip(k, -3.45, F2, ZT - 0.1, 3.45, F2 + RAIL, ZT);
  k.wallDecal(6.9, 0.85, 'glassRail', 0, F2 + 0.08, ZT - 0.05, 0, { seg: 3 });
  k.aabb(-3.45, F2 + RAIL - 0.06, ZT - 0.08, 3.45, F2 + RAIL, ZT - 0.02, 'chrome', { collide: false });

  // Radar arch: posts on the roof, arms out over the walkways to the wings past the hull.
  for (const sx of [-1, 1]) {
    k.box(0.5, 1.6, 0.9, 'paint', sx * 4.8, EAVE + 0.25, 12.6, { collide: false });
    k.box(7.6, 0.45, 0.9, 'paint', sx * 9.0, EAVE + 1.4, 12.6, { collide: false, ry: sx * 0.0 });
    k.box(1.6, 0.25, 10.4, 'paint', sx * 12.6, EAVE + 1.2, 11.9, { collide: false });
    k.box(0.5, 0.6, 3.0, 'paint', sx * 12.6, EAVE + 1.45, 12.6, { collide: false });
  }
  k.box(9.6, 0.45, 0.9, 'paint', 0, EAVE + 1.85, 12.6, { collide: false });
  k.cyl(0.4, 0.3, 10, 'paint', 0, EAVE + 2.45, 12.6, { collide: false });

  // ---- furniture ----
  // Lounge: the bar (counter, bottle shelves on the stairwell wall), sofas, coffee table.
  k.box(0.5, 1.1, 3.2, 'wood', -2.75, 0, 9.0, { faceMats: { py: 'chrome' } });
  k.wallDecal(2.8, 1.5, 'bottles', -3.75 + 0.005, 0.9, 9.0, PI / 2, { uv: 'raw' });
  k.box(2.8, 0.8, 0.8, 'fabric', 2.0, 0, 10.6 - 0.4, { sight: false });
  k.box(0.8, 0.8, 1.8, 'fabric', 0.2, 0, 9.3, { sight: false });
  k.box(1.0, 0.42, 0.7, 'wood', 1.9, 0, 8.9);
  // Bedrooms: beds and nightstands.
  k.box(1.7, 0.6, 2.1, 'fabricBlue', -2.0, 0, 13.9 - 0.05, { sight: false });
  k.box(2.0, 0.6, 1.7, 'fabricRed', 4.2, 0, 13.1, { sight: false });
  k.box(0.5, 0.55, 0.5, 'wood', -3.4, 0, 14.6);
  // Lobby: a planter.
  k.box(0.6, 0.9, 0.6, 'wood', 4.6, 0, 16.4);
  // Stateroom: bed against the aft wall, dresser, a closet block, armchairs by the window.
  k.box(2.0, 0.6, 2.2, 'fabric', 0, F2, ZU - T - 1.1, { sight: false });
  k.box(0.5, 1.0, 1.6, 'wood', -ix + 0.25, F2, 13.0);
  k.box(1.4, 2.4, 0.8, 'panel', -4.6, F2, 7.3);
  k.box(0.8, 0.8, 0.8, 'fabricBlue', 2.6, F2, 8.4, { sight: false });

  // Lights.
  k.light(0, 2.6, 8.8, [1.4, 1.15, 0.85], 8, 'interior');
  k.light(-1.6, 2.6, 13.2, [1.3, 1.1, 0.85], 6, 'interior');
  k.light(3.0, 2.6, 13.2, [1.3, 1.1, 0.85], 6, 'interior');
  k.light(0, 2.6, 16.2, [1.3, 1.2, 0.95], 6, 'interior');
  k.light(0, F2 + 2.5, 10.4, [1.3, 1.1, 0.85], 9, 'interior');
  k.light(0, 2.7, 18.6, [1.6, 1.25, 0.8], 8, 'deck');
  for (const sx of [-1, 1]) {
    k.trim(0.12, 0.3, 0.2, 'lamp', sx * (X + 0.07), 2.3, 9.5);
    k.light(sx * (X + 0.6), 2.3, 9.5, [1.6, 1.25, 0.8], 7, 'deck');
    k.trim(0.12, 0.3, 0.2, 'lamp', sx * (X + 0.07), F2 + 2.1, 16.0);
  }
}

// ---------------------------------------------------------------------------------------------
// Central deck, stern deck, below deck, sea
// ---------------------------------------------------------------------------------------------

function centralDeck(k: MapKit) {
  // Shower block on the centreline: louvred core with a glass stall at each end.
  k.aabb(-2.2, 0, -2.45, 0.9, 2.5, 1.1, 'louvre', { faceMats: { py: 'paint' } });
  for (const [z0, z1] of [[-4.2, -2.45], [1.1, 2.85]] as const) {
    k.aabb(-2.2, 0, z0, 0.9, 0.12, z1, 'tile');
    k.aabb(-2.2, 2.3, z0, 0.9, 2.5, z1, 'paint');
    const zo = z0 < 0 ? z0 : z1;
    k.aabb(-2.2, 0.12, Math.min(zo, zo + (z0 < 0 ? 0.08 : -0.08)), 0.9, 2.3, Math.max(zo, zo + (z0 < 0 ? 0.08 : -0.08)), 'glassRail', { bullets: false, sight: false });
    for (const x of [-2.2, 0.82]) k.aabb(x, 0.12, z0, x + 0.08, 2.3, z1, 'louvre');
    k.trim(0.1, 0.1, 0.4, 'chrome', -0.65, 2.05, (z0 + z1) / 2);
    k.light(-0.65, 2.1, (z0 + z1) / 2, [1.3, 1.25, 1.1], 4, 'deck');
  }
  // Hot tub bay (port): two curved wings from the hull, the back wall, the tub, the canopy.
  const H = 3.0;
  for (const [x0, z0, x1, z1] of [
    [-BEAM, -7.2, -6.8, -4.2], [-6.8, -6.5, -5.5, -4.2], [-5.5, -5.4, -4.4, -4.2],
    [-BEAM, 0, -6.8, 5.1], [-6.8, 0, -5.5, 4.2], [-5.5, 0, -4.4, 1.2],
    [-BEAM, -4.2, -7.6, 0],
  ] as const) k.aabb(x0, 0, z0, x1, H, z1, 'paint');
  k.trim(3.8, 0.25, 4.6, 'paint', -6.2, H - 0.25, -2.1, { hide: ['py'] });
  k.cyl(1.25, 0.6, 14, 'paint', -6.2, 0.3, -2.1);
  k.cyl(1.1, 0.04, 14, 'pool', -6.2, 0.6, -2.1, { collide: false });
  k.light(-6.2, 0.9, -2.1, [0.4, 1.0, 1.2], 4, 'pool');
  k.glow(-6.2, 0.75, -2.1, [0.2, 0.6, 0.7], 2.2, 'pool');
  // Cabana bar (starboard): back wall at the hull, end walls with walk-through doors, roof, the
  // counter facing the middle and the bottle shelves behind it.
  k.aabb(7.6, 0, -5.7, 7.9, 2.7, 4.4, 'paint');
  for (const [z0, z1] of [[-5.7, -5.4], [4.1, 4.4]] as const) k.wall('x', 3.6, 7.6, (z0 + z1) / 2, 0, 2.7, 0.3, 'paint', [{ a0: 5.6, a1: 7.2, y0: 0, y1: 2.2 }]);
  k.aabb(3.4, 2.7, -5.9, 8.0, 2.95, 4.6, 'paint', { faceMats: { ny: 'teakInt' } });
  k.box(0.6, 1.1, 6.4, 'wood', 4.9, 0, -0.6, { faceMats: { py: 'chrome' } });
  k.box(0.45, 2.0, 4.8, 'wood', 7.37, 0, -0.6);
  k.wallDecal(4.6, 1.5, 'bottles', 7.14, 0.3, -0.6, -PI / 2, { uv: 'raw' });
  for (const z of [-3.0, -1.5, 0.0, 1.5]) k.cyl(0.22, 0.75, 8, 'chrome', 4.25, 0.375, z, { collide: false });
  k.flatDecal(3.6, 9.4, 'teakInt', 5.6, 0.015, -0.65);
  k.light(5.8, 2.4, -0.6, [1.5, 1.2, 0.8], 7, 'deck');
  // Deck lamps on the railings (the "umbrella" lamps), skylight hatches.
  for (const [x, z] of [[-BEAM + 0.3, -15.0], [BEAM - 0.3, -12.6], [BEAM - 0.3, 12.0], [-BEAM + 0.3, 15.0]] as const) {
    k.box(0.12, 2.0, 0.12, 'chrome', x, 0, z, { collide: false });
    k.trim(0.7, 0.15, 0.7, 'paint', x, 2.0, z);
    k.glow(x, 1.95, z, [0.9, 0.7, 0.4], 1.2, 'deck');
    k.light(x, 1.9, z, [1.5, 1.2, 0.75], 7, 'deck');
  }
  for (const z of [-6.1, 4.6]) k.flatDecal(1.0, 1.0, 'glass', -1.2, 0.012, z, { seg: 1 });
}

function sternDeck(k: MapKit) {
  // Hot tub, sunken pool (steps at the fore end, water surface, glow), curved sofas, a life ring.
  k.cyl(1.0, 0.5, 14, 'paint', -0.3, 0.25, 28.2);
  k.cyl(0.88, 0.04, 14, 'pool', -0.3, 0.5, 28.2, { collide: false });
  k.light(-0.3, 0.8, 28.2, [0.4, 1.0, 1.2], 4, 'pool');
  k.stairs(POOL.x0, POOL.floor, POOL.z0, POOL.x1, DECK, POOL.z0 + 1.3, '-z', 'poolTile', 5);
  k.flatDecal(POOL.x1 - POOL.x0, POOL.z1 - POOL.z0, 'pool', (POOL.x0 + POOL.x1) / 2, -0.22, (POOL.z0 + POOL.z1) / 2, { seg: 3 });
  k.light((POOL.x0 + POOL.x1) / 2, -0.6, 33.4, [0.4, 1.0, 1.2], 6, 'pool');
  k.glow((POOL.x0 + POOL.x1) / 2, -0.15, 33.4, [0.25, 0.65, 0.75], 4, 'pool');
  for (const sx of [-1, 1]) {
    k.aabb(sx < 0 ? -6.0 : 4.6, 0, 26.6, sx < 0 ? -4.6 : 6.0, 0.75, 29.4, 'fabric', { sight: false });
    k.aabb(sx < 0 ? -6.0 : 4.0, 0, 29.4, sx < 0 ? -4.0 : 6.0, 0.75, 30.0, 'fabric', { sight: false });
    k.box(1.0, 0.42, 1.0, 'wood', sx * 3.6, 0, 27.6);
    k.wallDecal(0.6, 0.6, 'fabricRed', sx * 5.62, 1.2, 21.0, sx * (PI / 2), { seg: 1 });
  }
  // Deck lights round the stern.
  for (const [x, z] of [[-4.0, 38.0], [4.0, 38.0], [0, 40.6]] as const) k.light(x, 0.6, z, [1.4, 1.15, 0.8], 6, 'deck');
}

function belowDeck(k: MapKit) {
  const Y = LOW;
  const TOP = -0.3;
  // Bulkheads with doorways (one into the stern stair landing).
  k.wall('x', V.x0, V.x1, -6.2, Y, TOP - Y, 0.2, 'bulkhead', [{ a0: -5.0, a1: -3.6, y0: 0, y1: 2.2 }, { a0: 0.3, a1: 1.7, y0: 0, y1: 2.2 }]);
  k.wall('x', V.x0, V.x1, 6.1, Y, TOP - Y, 0.2, 'bulkhead', [{ a0: -5.1, a1: -3.6, y0: 0, y1: 2.2 }, { a0: 0.3, a1: 1.7, y0: 0, y1: 2.2 }]);
  // Container bay (under the Bow Cabin): a container, crates.
  k.aabb(-0.9, Y, -15.8, 1.8, Y + 2.5, -12.6, 'crate', { faceMats: { py: 'steel' } });
  k.box(1.6, 1.2, 1.6, 'crate', -2.5, Y, -10.6, { uv: 'raw' });
  k.box(1.0, 1.0, 1.0, 'crate', 1.2, Y, -9.2, { uv: 'raw' });
  k.box(1.2, 0.9, 1.0, 'crate', -2.4, Y + 1.2, -10.6, { uv: 'raw', collide: false });
  k.flatDecal(1.0, 6.0, 'hazard', -4.5, Y + 0.012, -3.0, { seg: 2 });
  // Engine room: two engines (lanes either side, a cross passage between), exhausts, panels.
  for (const [z0, z1] of [[-4.8, -0.8], [0.8, 4.6]] as const) {
    k.aabb(-3.0, Y, z0, 0.4, Y + 1.9, z1, 'machine');
    k.trim(2.6, 0.4, z1 - z0 - 0.6, 'steel', -1.3, Y + 1.9, (z0 + z1) / 2);
    k.cyl(0.25, z1 - z0, 8, 'steel', -2.2, Y + 2.6, (z0 + z1) / 2, { axis: 'z', collide: false });
  }
  for (const z of [-3.5, 2.5]) k.box(0.3, 1.8, 1.4, 'machine', V.x1 - 0.15, Y, z);
  k.cyl(0.18, V.z1 - V.z0, 8, 'steel', V.x0 + 0.3, TOP - 0.3, (V.z0 + V.z1) / 2, { axis: 'z', collide: false });
  k.cyl(0.12, V.z1 - V.z0, 8, 'hazard', V.x1 - 0.3, TOP - 0.25, (V.z0 + V.z1) / 2, { axis: 'z', collide: false });
  // Generators and tanks under the Stern Cabin.
  k.aabb(-1.4, Y, 8.0, 1.2, Y + 1.6, 12.4, 'machine');
  k.cyl(0.6, 1.8, 10, 'steel', 1.3, Y + 0.9, 14.2);
  // Lights.
  for (const z of [-11.0, -3.0, 3.0, 10.5]) {
    k.light(-1.5, TOP - 0.4, z, [1.35, 1.4, 1.2], 9, 'engine');
    k.trim(1.2, 0.08, 0.2, 'lamp', -1.5, TOP - 0.1, z);
  }
}

function seaAndSky(k: MapKit) {
  k.flatDecal(900, 900, 'sea', 0, SEA, 0, { seg: 10 });
  // Wake: two foam trails spreading behind the stern (patches laid end to end, no overlaps).
  for (let i = 0; i < 7; i++) {
    const z = 50 + i * 14;
    for (const s of [-1, 1]) k.flatDecal(2.6 + i * 0.8, 12.5, 'foam', s * (2.5 + i * 2.6), SEA + 0.03, z, { ry: s * 0.18, seg: 2 });
  }
  k.flatDecal(4.8, 4.0, 'foam', 0, SEA + 0.03, 43.6, { seg: 2 });
  // Bow wave along both sides.
  for (const s of [-1, 1]) k.flatDecal(1.4, 18, 'foam', s * 6.8, SEA + 0.03, -30, { ry: s * 0.35, seg: 2 });
}

const P = (id: string, x: number, y: number, z: number, radius: number, team?: 0 | 1): ObjectivePoint => (team === undefined ? { id, x, y, z, radius } : { id, x, y, z, radius, team });
const S = (x: number, y: number, z: number, yaw: number): SpawnPoint => ({ x, y, z, yaw });

export function buildHijacked(): MapData {
  const k = new MapKit();
  hull(k);
  bowDeck(k);
  bowCabin(k);
  centralDeck(k);
  sternCabin(k);
  sternDeck(k);
  belowDeck(k);
  seaAndSky(k);

  // ---- spawns: team 0 at the bow (facing aft), team 1 at the stern (facing the bow) ----
  const AFT = PI;
  const FWD = 0;
  const team0 = [S(-1.6, FORE, -36.6, AFT), S(1.6, FORE, -36.6, AFT), S(0, FORE, -39.0, AFT), S(-4.2, 0, -32.6, AFT), S(4.2, 0, -32.6, AFT), S(-1.8, 0, -29.0, AFT), S(1.8, 0, -29.0, AFT), S(-2.4, 0, -23.6, AFT), S(2.6, 0, -23.6, AFT)];
  const team1 = [S(-2.4, 0, 25.6, FWD), S(2.4, 0, 25.6, FWD), S(-3.6, 0, 30.5, FWD), S(3.0, 0, 30.5, FWD), S(-3.9, 0, 34.5, FWD), S(3.3, 0, 34.5, FWD), S(-1.5, 0, 38.4, FWD), S(1.5, 0, 38.4, FWD)];
  const ffa = [
    S(0, FORE, -37.5, AFT),
    S(-6.8, 0, -24.5, yawTo(-6.8, -24.5, 0, 0)),
    S(6.9, 0, -15.0, AFT),
    S(-6.8, 0, -12.0, AFT),
    S(-9.25, 0, 1.0, AFT),
    S(6.2, 0, -0.5, FWD),
    S(-2.4, 0, -10.5, AFT),
    S(1.0, F2, -12.5, AFT),
    S(-1.5, F2, -17.8, AFT),
    S(-2.5, LOW, -8.5, AFT),
    S(-4.2, LOW, 2.0, FWD),
    S(1.8, 0, 13.2, FWD),
    S(-1.0, F2, 9.0, FWD),
    S(0, F2, 17.0, FWD),
    S(6.9, 0, 21.5, FWD),
    S(-4.6, 0, 34.0, FWD),
    S(0, 0, 39.5, FWD),
  ];

  // ---- objectives ----
  // Domination: A on the bow deck before the Bow Cabin, B on the Central Deck, C on the stern deck.
  const dom = [P('A', -1.0, 0, -24.4, 3), P('B', 2.2, 0, -1.0, 3), P('C', 0, 0, 25.0, 3)];
  // S&D (BO2): A on the Central Deck's starboard side by the cabana, B in the Stern Cabin; defenders
  // hold the stern.
  const sd = [P('A', 2.6, 0, 3.4, 1.6, 1), P('B', 1.4, 0, 7.6, 1.6, 1)];
  const hq = [
    P('hq1', -0.6, 0, -6.0, 3),
    P('hq2', 3.0, 0, -17.6, 2.2),
    P('hq3', 1.5, 0, 9.0, 2.5),
    P('hq4', -1.3, LOW, 0.0, 1.6),
    P('hq5', 0, 0, -28.0, 3),
    P('hq6', 3.6, 0, 33.0, 2.5),
    P('hq7', 0, F2, -18.4, 2.5),
    P('hq8', 0, F2, 9.6, 2.5),
    P('hq9', 0, F2, 17.2, 2.5),
  ];
  const attackers = team0;
  const defenders = [S(-2.4, 0, 25.6, FWD), S(2.4, 0, 25.6, FWD), S(-3.6, 0, 30.5, FWD), S(3.0, 0, 30.5, FWD), S(0, F2, 17.0, FWD), S(-2.4, F2, 18.8, FWD), S(2.4, F2, 18.8, FWD), S(-6.8, 0, 20.0, FWD)];

  return {
    id: 'hijacked',
    name: 'Hijacked',
    bounds: HIJACKED_BOUNDS,
    materials: MATERIALS,
    brushes: k.brushes,
    decals: k.decals,
    props: k.props,
    lights: k.lights,
    spawns: { teams: [team0, team1], ffa },
    objectives: { dom, sd, hq },
    modeSpawns: { sd: { attackers, defenders } },
    times: [
      { id: 'day', name: 'Open Water', clock: '13:10', sky: 'hj_skyDay', unlit: [1, 1, 0.98], skyRot: 0, sunDir: unitVec(0.45, 0.82, -0.35), sun: [1.3, 1.2, 1.04], amb: [0.55, 0.6, 0.68], fog: [0.76, 0.85, 0.9], fogNear: 60, fogFar: 260, lights: { interior: 0.6, engine: 1, deck: 0, pool: 0.5 }, glow: 0.2 },
      { id: 'sunset', name: 'Sunset', clock: '19:25', sky: 'hj_skySunset', unlit: [1, 0.86, 0.78], skyRot: 0, sunDir: unitVec(0.15, 0.2, 0.97), sun: [1.35, 0.72, 0.42], amb: [0.34, 0.28, 0.36], fog: [0.92, 0.66, 0.5], fogNear: 40, fogFar: 220, lights: { interior: 1, engine: 1, deck: 1, pool: 1 }, glow: 1 },
    ],
    defaultTime: 'day',
    hotspots: [
      { x: -1.0, y: 0, z: -24.4 },
      { x: 2.2, y: 0, z: -1.0 },
      { x: 0, y: 0, z: 25.0 },
      { x: -0.6, y: 0, z: -6.0 },
      { x: 3.0, y: 0, z: -17.6 },
      { x: 1.6, y: 0, z: -9.0 },
      { x: 1.5, y: 0, z: 9.0 },
      { x: -1.3, y: LOW, z: 0.0 },
      { x: -2.5, y: LOW, z: -8.5 },
      { x: 0, y: F2, z: -18.4 },
      { x: 1.0, y: F2, z: -12.5 },
      { x: 0, y: F2, z: 9.6 },
      { x: 0, y: F2, z: 17.2 },
      { x: -9.25, y: 0, z: 0.0 },
      { x: 6.2, y: 0, z: -0.5 },
      { x: 6.8, y: 0, z: -14.0 },
      { x: -6.8, y: 0, z: 14.0 },
      { x: 0, y: FORE, z: -37.0 },
    ],
  };
}
