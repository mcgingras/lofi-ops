/**
 * Blackout (BO4's battle royale map in spirit): one big island, 512 x 512 m, made of the classic
 * maps' landmark areas placed as towns on open ground, with gentle hills, rocks, trees and roads
 * between them. Each town is cut out of an existing map's MapData (`importTown`): its brushes,
 * decals, props and lights inside a cut rectangle are moved into place, material ids prefixed per
 * town; brushes crossing the cut are clipped (plain boxes) or dropped (ramps, turned boxes,
 * perimeter walls, out-of-bounds clips), so each town keeps its buildings and loses its arena walls.
 * The ground between towns is a partition of the island into flat tiles at y = 0 around the towns'
 * rectangles (`terrainTiles`), so there is never a gap between a town and the open ground.
 *
 * Coordinates: x east, z south, y up, metres. The island spans x, z in [-256, 256]; invisible walls
 * (tag `perimeter`) stand at the shore up to the plane's altitude, and the sea is drawn beyond them.
 *
 * Rendering: `chunk` splits the map's merged meshes into 64 m chunks so the client can cull them by
 * distance and frustum; `drawDistance` sets the camera's far plane (the fog hides the cut).
 */
import { BLACKOUT } from '../defs/blackout';
import type { Vec3 } from '../math';
import { getMapData as mapById } from '../defs/maps';
import { CollisionWorld } from '../collision';
import { box, cylinder, flatDecal, mapSolids, unitVec, type Brush, type Decal, type MapData, type MapLight, type MaterialDef, type Prop, type SpawnPoint } from './types';

export const BLACKOUT_HALF = 256;

/** A town: an area cut from a source map and where it goes on the island. */
export interface TownDef {
  /** Display name (HUD map labels). */
  name: string;
  /** Source map id. */
  map: string;
  /** Cut rectangle in the source map's coordinates. */
  cut: { x0: number; z0: number; x1: number; z1: number };
  /** World position of the cut's centre. */
  at: { x: number; z: number };
}

/**
 * The towns. Cut rectangles keep each source map's buildings and drop its arena walls; positions
 * leave at least ~35 m of open ground between neighbours.
 */
export const BLACKOUT_TOWNS: readonly TownDef[] = [
  { name: 'Nuketown', map: 'nuketown', cut: { x0: -38, z0: -19, x1: 44, z1: 16 }, at: { x: -150, z: -175 } },
  { name: 'Rust', map: 'rust', cut: { x0: -24, z0: -24, x1: 24, z1: 25 }, at: { x: 175, z: -175 } },
  { name: 'Firing Range', map: 'firingrange', cut: { x0: -38, z0: -43, x1: 37, z1: 43 }, at: { x: -175, z: 30 } },
  { name: 'Summit', map: 'summit', cut: { x0: -24, z0: -50, x1: 20, z1: 45 }, at: { x: 15, z: -170 } },
  { name: 'Hanoi', map: 'hanoi', cut: { x0: -42, z0: -41, x1: 42, z1: 43 }, at: { x: 165, z: 45 } },
  { name: 'Terminal', map: 'terminal', cut: { x0: -55, z0: -36, x1: 56, z1: 38 }, at: { x: 30, z: 180 } },
  { name: 'Scrapyard', map: 'scrapyard', cut: { x0: -24, z0: -46, x1: 24, z1: 38 }, at: { x: -150, z: 180 } },
  { name: 'Launch', map: 'launch', cut: { x0: -64, z0: -31, x1: 60, z1: 31 }, at: { x: 0, z: 10 } },
  { name: 'Yard', map: 'yard', cut: { x0: -26, z0: -24, x1: 26, z1: 28 }, at: { x: -60, z: -85 } },
  { name: 'Nacht', map: 'nacht', cut: { x0: -43, z0: -37, x1: 43, z1: 37 }, at: { x: 170, z: 190 } },
];

/** A town's rectangle on the island (world coordinates). */
export function townRect(t: TownDef): { x0: number; z0: number; x1: number; z1: number } {
  const w = t.cut.x1 - t.cut.x0;
  const d = t.cut.z1 - t.cut.z0;
  return { x0: t.at.x - w / 2, z0: t.at.z - d / 2, x1: t.at.x + w / 2, z1: t.at.z + d / 2 };
}

/** The town at a world point (null on open ground). */
export function townAt(x: number, z: number, margin = 0): TownDef | null {
  for (const t of BLACKOUT_TOWNS) {
    const r = townRect(t);
    if (x >= r.x0 - margin && x <= r.x1 + margin && z >= r.z0 - margin && z <= r.z1 + margin) return t;
  }
  return null;
}

const EPS = 1e-6;
/** Brushes taller than this crossing the cut near its edge are arena walls (dropped). */
const WALL_H = 5;
const CLIP_TAGS = new Set(['perimeter', 'roof']);

interface Imported {
  materials: Record<string, MaterialDef>;
  brushes: Brush[];
  decals: Decal[];
  props: Prop[];
  lights: MapLight[];
  /** Spawn points inside the cut (world coordinates): seeds for floods, bot targets. */
  spawns: SpawnPoint[];
  hotspots: Vec3[];
}

/** Cut a town out of its source map and move it into place (pure). */
export function importTown(t: TownDef, prefix: string): Imported {
  const src = mapById(t.map);
  const c = t.cut;
  const cx = (c.x0 + c.x1) / 2;
  const cz = (c.z0 + c.z1) / 2;
  const ox = t.at.x - cx;
  const oz = t.at.z - cz;
  const mat = (id: string) => `${prefix}.${id}`;
  const materials: Record<string, MaterialDef> = {};
  for (const [id, m] of Object.entries(src.materials)) materials[mat(id)] = { ...m };
  const inside = (x: number, z: number) => x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1;
  const brushes: Brush[] = [];
  for (const b of src.brushes) {
    if (b.tag && CLIP_TAGS.has(b.tag)) continue;
    // Entirely outside the cut: gone.
    if (b.max.x <= c.x0 + EPS || b.min.x >= c.x1 - EPS || b.max.z <= c.z0 + EPS || b.min.z >= c.z1 - EPS) continue;
    const crosses = b.min.x < c.x0 - EPS || b.max.x > c.x1 + EPS || b.min.z < c.z0 - EPS || b.max.z > c.z1 + EPS;
    const clip = !!b.noRender && (b.players ?? b.collide ?? true) && !(b.bullets ?? b.collide ?? true);
    if (crosses) {
      // Invisible clips, ramps and visually turned boxes can't be cut cleanly; tall walls across
      // the cut are the arena's walls.
      if (clip || b.ramp || (b.ry && Math.abs(Math.sin(b.ry)) > 1e-3 && Math.abs(Math.cos(b.ry)) > 1e-3)) continue;
      if (b.max.y - Math.max(0, b.min.y) > WALL_H) continue;
    }
    const min = { x: Math.max(b.min.x, c.x0) + ox, y: b.min.y, z: Math.max(b.min.z, c.z0) + oz };
    const max = { x: Math.min(b.max.x, c.x1) + ox, y: b.max.y, z: Math.min(b.max.z, c.z1) + oz };
    if (max.x - min.x < 0.01 || max.z - min.z < 0.01) continue;
    const out: Brush = { ...b, min, max, mat: mat(b.mat) };
    if (b.faceMats) out.faceMats = Object.fromEntries(Object.entries(b.faceMats).map(([f, m]) => [f, mat(m)]));
    brushes.push(out);
  }
  const decals: Decal[] = src.decals.filter((d) => inside(d.x, d.z)).map((d) => ({ ...d, x: d.x + ox, z: d.z + oz, mat: mat(d.mat) }));
  const props: Prop[] = [];
  for (const p of src.props) {
    if (!inside(p.x, p.z)) continue;
    if (p.kind === 'cylinder') props.push({ ...p, x: p.x + ox, z: p.z + oz, mat: mat(p.mat) });
    else if (p.kind === 'glow') props.push({ ...p, x: p.x + ox, z: p.z + oz });
    else props.push({ ...p, x: p.x + ox, z: p.z + oz, collide: p.collide?.map((a) => ({ min: { x: a.min.x + ox, y: a.min.y, z: a.min.z + oz }, max: { x: a.max.x + ox, y: a.max.y, z: a.max.z + oz } })) });
  }
  const lights = src.lights.filter((l) => inside(l.x, l.z)).map((l) => ({ ...l, x: l.x + ox, z: l.z + oz }));
  const sp = [...src.spawns.ffa, ...src.spawns.teams[0], ...src.spawns.teams[1]].filter((s) => inside(s.x, s.z));
  const spawns = sp.map((s) => ({ ...s, x: s.x + ox, z: s.z + oz }));
  const hotspots = (src.hotspots ?? []).filter((h) => inside(h.x, h.z)).map((h) => ({ x: h.x + ox, y: h.y, z: h.z + oz }));
  return { materials, brushes, decals, props, lights, spawns, hotspots };
}

// ---------------------------------------------------------------------------------------------
// Open ground
// ---------------------------------------------------------------------------------------------

type Rect = { x0: number; z0: number; x1: number; z1: number };

/**
 * Tiles covering the island minus the town rectangles: the breakpoints of every town edge plus a
 * 64 m grid cut the island into cells, the cells outside every town become tiles, and runs of
 * tiles along x are merged (up to 64 m, under the collision ray grid's "big solid" size).
 */
export function terrainTiles(towns: Rect[], half = BLACKOUT_HALF, maxTile = 64): Rect[] {
  const xs = new Set<number>([-half, half]);
  const zs = new Set<number>([-half, half]);
  for (let v = -half; v <= half; v += maxTile) {
    xs.add(v);
    zs.add(v);
  }
  for (const t of towns) {
    xs.add(t.x0);
    xs.add(t.x1);
    zs.add(t.z0);
    zs.add(t.z1);
  }
  const X = [...xs].filter((v) => v >= -half && v <= half).sort((a, b) => a - b);
  const Z = [...zs].filter((v) => v >= -half && v <= half).sort((a, b) => a - b);
  const inTown = (x: number, z: number) => towns.some((t) => x > t.x0 && x < t.x1 && z > t.z0 && z < t.z1);
  const out: Rect[] = [];
  for (let j = 0; j < Z.length - 1; j++) {
    let run: Rect | null = null;
    for (let i = 0; i < X.length - 1; i++) {
      const cell = { x0: X[i]!, z0: Z[j]!, x1: X[i + 1]!, z1: Z[j + 1]! };
      if (cell.x1 - cell.x0 < 1e-6 || cell.z1 - cell.z0 < 1e-6) continue;
      const free = !inTown((cell.x0 + cell.x1) / 2, (cell.z0 + cell.z1) / 2);
      if (free && run && run.x1 === cell.x0 && cell.x1 - run.x0 <= maxTile) run.x1 = cell.x1;
      else {
        if (run) out.push(run);
        run = free ? cell : null;
      }
    }
    if (run) out.push(run);
  }
  return out;
}

/**
 * Rectangles of a town's area with no floor under them at all (0.5 m cells, merged along x then
 * stacked along z where they line up), to be filled with open ground at y = 0. Cells are point
 * sampled, so what remains uncovered is narrower than a body.
 */
function holes(brushes: Brush[], props: Prop[], r: Rect): Rect[] {
  const w = new CollisionWorld(mapSolids({ brushes, props } as unknown as MapData));
  const S = 0.5;
  const nx = Math.round((r.x1 - r.x0) / S);
  const nz = Math.round((r.z1 - r.z0) / S);
  const rows: Rect[][] = [];
  for (let j = 0; j < nz; j++) {
    const row: Rect[] = [];
    let run: Rect | null = null;
    for (let i = 0; i < nx; i++) {
      const x = r.x0 + (i + 0.5) * S;
      const z = r.z0 + (j + 0.5) * S;
      const hole = w.groundBelow(x, z, 80, 120, 0.01) === null;
      if (hole && run) run.x1 = r.x0 + (i + 1) * S;
      else if (hole) run = { x0: r.x0 + i * S, z0: r.z0 + j * S, x1: r.x0 + (i + 1) * S, z1: r.z0 + (j + 1) * S };
      else if (run) {
        row.push(run);
        run = null;
      }
    }
    if (run) row.push(run);
    rows.push(row);
  }
  // Stack identical runs of consecutive rows.
  const out: Rect[] = [];
  let open: Rect[] = [];
  for (const row of rows) {
    const next: Rect[] = [];
    for (const run of row) {
      const o = open.find((q) => Math.abs(q.x0 - run.x0) < 1e-6 && Math.abs(q.x1 - run.x1) < 1e-6 && Math.abs(q.z1 - run.z0) < 1e-6 && q.z1 - q.z0 < 60);
      if (o) {
        o.z1 = run.z1;
        next.push(o);
        open = open.filter((q) => q !== o);
      } else next.push({ ...run });
    }
    out.push(...open);
    open = next;
  }
  out.push(...open);
  return out;
}

// ---------------------------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------------------------

const MATERIALS: Record<string, MaterialDef> = {
  grass: { texture: 'fr_grass', uvMul: [1 / 8, 1 / 8], tint: 0xc8d0a8, segment: 8 },
  meadow: { texture: 'afg_grass', uvMul: [1 / 8, 1 / 8], segment: 6 },
  dirt: { texture: 'fr_dirt', uvMul: [1 / 6, 1 / 6], segment: 4 },
  road: { texture: 'lc_asphalt', uvMul: [1 / 6, 1 / 6] },
  rock: { texture: 'est_rock', uvMul: [1 / 5, 1 / 5] },
  rockDark: { texture: 'bo_rock', uvMul: [1 / 4, 1 / 4], tint: 0xa8a49c },
  bark: { texture: 'fr_bark', uvMul: [1 / 1.5, 1 / 3] },
  leaves: { texture: 'est_pine', side: 'double' },
  bush: { texture: 'fr_bush', side: 'double' },
  sea: { texture: 'hj_sea', uvMul: [1 / 16, 1 / 16], fog: true },
  sand: { texture: 'rust_sand', uvMul: [1 / 8, 1 / 8], segment: 6 },
  clip: { texture: 'none' },
};

/** Hills: a plateau and four ramps (gentle, ~1:4), corners left open. */
function hill(out: Brush[], x: number, z: number, w: number, d: number, h: number, mat: string, slope = 4) {
  const run = h * slope;
  out.push(box(w, h, d, mat, x, 0, z, { hide: ['ny'] }));
  out.push({ min: { x: x - w / 2 - run, y: 0, z: z - d / 2 }, max: { x: x - w / 2, y: h, z: z + d / 2 }, ramp: '+x', mat });
  out.push({ min: { x: x + w / 2, y: 0, z: z - d / 2 }, max: { x: x + w / 2 + run, y: h, z: z + d / 2 }, ramp: '-x', mat });
  out.push({ min: { x: x - w / 2, y: 0, z: z - d / 2 - run }, max: { x: x + w / 2, y: h, z: z - d / 2 }, ramp: '+z', mat });
  out.push({ min: { x: x - w / 2, y: 0, z: z + d / 2 }, max: { x: x + w / 2, y: h, z: z + d / 2 + run }, ramp: '-z', mat });
}

/** Footprint (with ramps) of a hill, to keep it off towns and roads. */
const hillRect = (x: number, z: number, w: number, d: number, h: number, slope = 4): Rect => ({ x0: x - w / 2 - h * slope, z0: z - d / 2 - h * slope, x1: x + w / 2 + h * slope, z1: z + d / 2 + h * slope });

const overlaps = (a: Rect, b: Rect, m = 0) => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m;

/** Deterministic PRNG for the layout (mulberry32). */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildBlackout(): MapData {
  const H = BLACKOUT_HALF;
  const materials: Record<string, MaterialDef> = { ...MATERIALS };
  const brushes: Brush[] = [];
  const decals: Decal[] = [];
  const props: Prop[] = [];
  const lights: MapLight[] = [];
  const ffa: SpawnPoint[] = [];
  const hotspots: Vec3[] = [];
  const rects = BLACKOUT_TOWNS.map(townRect);

  // Towns.
  BLACKOUT_TOWNS.forEach((t, i) => {
    const im = importTown(t, `t${i}`);
    Object.assign(materials, im.materials);
    brushes.push(...im.brushes);
    // Where the cut has no floor at all (Summit's mountaintop stands in the void), open ground.
    for (const r of holes(im.brushes, im.props, townRect(t))) brushes.push({ min: { x: r.x0, y: -2, z: r.z0 }, max: { x: r.x1, y: 0, z: r.z1 }, mat: 'dirt', hide: ['ny', 'px', 'nx', 'pz', 'nz'] });
    decals.push(...im.decals);
    props.push(...im.props);
    lights.push(...im.lights);
    for (const s of im.spawns.slice(0, 6)) ffa.push(s);
    hotspots.push(...im.hotspots, ...im.spawns.slice(0, 3).map((s) => ({ x: s.x, y: s.y, z: s.z })));
  });

  // Open ground: grass tiles around the towns (top at y = 0; only the top face is drawn).
  for (const r of terrainTiles(rects)) {
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const near = rects.some((t) => overlaps(t, r, 6));
    brushes.push({ min: { x: r.x0, y: -2, z: r.z0 }, max: { x: r.x1, y: 0, z: r.z1 }, mat: near ? 'dirt' : (Math.floor(cx / 64) + Math.floor(cz / 64)) & 1 ? 'grass' : 'meadow', hide: ['ny', 'px', 'nx', 'pz', 'nz'] });
  }

  // Roads: flat strips joining the towns to the centre (render only).
  const centre = rects[BLACKOUT_TOWNS.findIndex((t) => t.map === 'launch')]!;
  const cxm = (centre.x0 + centre.x1) / 2;
  const czm = (centre.z0 + centre.z1) / 2;
  for (const r of rects) {
    const tx = (r.x0 + r.x1) / 2;
    const tz = (r.z0 + r.z1) / 2;
    if (Math.hypot(tx - cxm, tz - czm) < 1) continue;
    const len = Math.hypot(tx - cxm, tz - czm);
    const ry = Math.atan2(tx - cxm, tz - czm);
    decals.push(flatDecal(6, len, 'road', (tx + cxm) / 2, 0.02, (tz + czm) / 2, { ry, seg: 1 }));
  }

  // Hills, rocks and trees on the open ground (seeded, kept off towns, each other and the shore).
  const rnd = prng(0xb1ac0);
  const placed: Rect[] = rects.map((r) => ({ x0: r.x0 - 8, z0: r.z0 - 8, x1: r.x1 + 8, z1: r.z1 + 8 }));
  const freeSpot = (r: Rect, m: number) => r.x0 > -H + 14 && r.x1 < H - 14 && r.z0 > -H + 14 && r.z1 < H - 14 && !placed.some((p) => overlaps(p, r, m));
  for (let n = 0, tries = 0; n < 22 && tries < 600; tries++) {
    const w = 10 + rnd() * 18;
    const d = 10 + rnd() * 18;
    const h = 1.5 + rnd() * 3.5;
    const x = (rnd() * 2 - 1) * (H - 40);
    const z = (rnd() * 2 - 1) * (H - 40);
    const r = hillRect(x, z, w, d, h);
    if (!freeSpot(r, 6)) continue;
    hill(brushes, x, z, w, d, h, rnd() < 0.5 ? 'grass' : 'meadow');
    placed.push(r);
    hotspots.push({ x, y: h, z });
    n++;
  }
  for (let n = 0, tries = 0; n < 70 && tries < 1500; tries++) {
    const x = (rnd() * 2 - 1) * (H - 20);
    const z = (rnd() * 2 - 1) * (H - 20);
    const s = 1.2 + rnd() * 3.2;
    const r = { x0: x - s, z0: z - s, x1: x + s, z1: z + s };
    if (!freeSpot(r, 2)) continue;
    const h = 0.8 + rnd() * 2.6;
    // A rock: a low block and a smaller one on top (cover), never a pit.
    brushes.push(box(s * 2, h, s * 1.6, rnd() < 0.5 ? 'rock' : 'rockDark', x, 0, z, { hide: ['ny'] }));
    if (h > 1.4 && rnd() < 0.5) brushes.push(box(s * 1.1, 0.8 + rnd() * 1.2, s * 0.9, 'rock', x + (rnd() - 0.5) * s * 0.4, h, z + (rnd() - 0.5) * s * 0.3, { hide: ['ny'] }));
    placed.push(r);
    n++;
  }
  for (let n = 0, tries = 0; n < 160 && tries < 3000; tries++) {
    const x = (rnd() * 2 - 1) * (H - 16);
    const z = (rnd() * 2 - 1) * (H - 16);
    const r = { x0: x - 1.2, z0: z - 1.2, x1: x + 1.2, z1: z + 1.2 };
    if (!freeSpot(r, 1.5)) continue;
    const trunk = 3 + rnd() * 3;
    props.push(cylinder(0.32, trunk, 6, 'bark', x, trunk / 2, z));
    // Canopy: drawn only (no collision), hides you from bots like a bush.
    brushes.push(box(3.6 + rnd() * 1.6, 2.6 + rnd() * 1.6, 3.6 + rnd() * 1.6, 'leaves', x, trunk - 0.6, z, { collide: false, ry: rnd() * Math.PI }));
    placed.push(r);
    n++;
  }

  // Shore: invisible walls up past the plane (players only; tag `perimeter`: never climbed).
  const wallTop = BLACKOUT.plane.altitude + 60;
  for (const [x0, z0, x1, z1] of [[-H - 2, -H - 2, H + 2, -H], [-H - 2, H, H + 2, H + 2], [-H - 2, -H, -H, H], [H, -H, H + 2, H]] as const) {
    for (let k = x0; k < x1; k += 64)
      for (let m = z0; m < z1; m += 64) brushes.push({ min: { x: k, y: -2, z: m }, max: { x: Math.min(x1, k + 64), y: wallTop, z: Math.min(z1, m + 64) }, mat: 'clip', noRender: true, players: true, bullets: false, sight: false, tag: 'perimeter' });
  }
  // The sea all round (render only, below the ground line).
  for (const [x, z, w, d] of [[0, -H - 160, 2 * H + 640, 320], [0, H + 160, 2 * H + 640, 320], [-H - 160, 0, 320, 2 * H], [H + 160, 0, 320, 2 * H]] as const) decals.push(flatDecal(w, d, 'sea', x, -0.6, z, { seg: 4 }));

  // FFA spawns on open ground too (tests and fallbacks; Blackout drops everyone from the plane).
  // Every spawn must stand on free ground: check against the finished world.
  const world = new CollisionWorld(mapSolids({ brushes, props } as unknown as MapData));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    for (let k = 0; k < 12; k++) {
      const x = Math.round(Math.cos(a) * (225 - k * 3));
      const z = Math.round(Math.sin(a) * (225 - k * 3));
      if (townAt(x, z, 4) || world.groundBelow(x, z, 1, 3) !== 0 || !world.free(x, 0.001, z)) continue;
      ffa.push({ x, y: 0, z, yaw: a });
      break;
    }
  }
  const ok = (sp: SpawnPoint) => {
    const g = world.groundBelow(sp.x, sp.z, sp.y + 1, 3);
    return g !== null && world.free(sp.x, g, sp.z);
  };
  for (let i = ffa.length - 1; i >= 0; i--) if (!ok(ffa[i]!)) ffa.splice(i, 1);
  const groups = new Set(lights.map((l) => l.group));
  const lightOn = (k: number) => Object.fromEntries([...groups].map((g) => [g, k]));

  return {
    id: 'blackout',
    name: 'Blackout',
    bounds: { min: { x: -H - 1, y: -8, z: -H - 1 }, max: { x: H + 1, y: wallTop, z: H + 1 } },
    materials,
    brushes,
    decals,
    props,
    lights,
    spawns: { teams: [ffa.slice(0, Math.ceil(ffa.length / 2)), ffa.slice(Math.ceil(ffa.length / 2))], ffa },
    objectives: {},
    times: [
      { id: 'day', name: 'Overcast Day', clock: '13:20', sky: 'skyGrey', unlit: [1, 1, 1], skyRot: 0, sunDir: unitVec(0.45, 0.8, 0.35), sun: [1.05, 1.0, 0.9], amb: [0.5, 0.52, 0.55], fog: [0.66, 0.7, 0.72], fogNear: 70, fogFar: 230, lights: lightOn(0.25), glow: 0.2 },
      { id: 'dusk', name: 'Dusk', clock: '19:05', sky: 'skyDusk', unlit: [1, 0.86, 0.76], skyRot: Math.PI, sunDir: unitVec(-0.8, 0.32, 0.3), sun: [1.1, 0.62, 0.4], amb: [0.3, 0.27, 0.34], fog: [0.58, 0.44, 0.42], fogNear: 60, fogFar: 210, lights: lightOn(1), glow: 0.8 },
    ],
    defaultTime: 'day',
    hotspots,
    chunk: 64,
    drawDistance: 260,
  };
}
