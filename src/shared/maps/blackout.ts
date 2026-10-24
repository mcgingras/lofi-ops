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
import { box, cylinder, flatDecal, mapSolids, unitVec, type BlendShape, type Brush, type Decal, type MapData, type MapLight, type MaterialDef, type Prop, type SpawnPoint } from './types';

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
  /**
   * Openings cut into the source map (its coordinates): brushes wholly inside a box go (wall pieces
   * under a window, a barricade), so a closed building gets a doorway from the open ground.
   */
  open?: { x0: number; z0: number; x1: number; z1: number; y1: number }[];
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
  { name: 'Scrapyard', map: 'scrapyard', cut: { x0: -24, z0: -48.5, x1: 24, z1: 38 }, at: { x: -150, z: 178.75 } },
  { name: 'Launch', map: 'launch', cut: { x0: -64, z0: -31, x1: 60, z1: 31 }, at: { x: 0, z: 10 } },
  { name: 'Yard', map: 'yard', cut: { x0: -26, z0: -24, x1: 26, z1: 28 }, at: { x: -60, z: -85 } },
  {
    name: 'Nacht',
    map: 'nacht',
    cut: { x0: -43, z0: -37, x1: 43, z1: 37 },
    at: { x: 170, z: 190 },
    // Nacht's bunker has no door to the field (zombies climb in through the windows): four
    // ground-floor windows (S1, S3, S4, H1) become doorways (the wall under the sill goes).
    open: [
      { x0: -3.95, z0: 8.5, x1: -2.45, z1: 9.1, y1: 0.95 },
      { x0: 9.25, z0: 8.5, x1: 10.75, z1: 9.1, y1: 0.95 },
      { x0: 12.0, z0: 0.85, x1: 12.6, z1: 2.35, y1: 0.95 },
      { x0: -9.55, z0: -9.2, x1: -8.05, z1: -8.6, y1: 0.95 },
    ],
  },
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
/** Things standing on the floor that poke out of the cut by no more than this are kept whole (stairs, crates). */
const OVERHANG = 1.2;
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
    // Doors and debris that open in Zombies (`gate`) stand open: drawn shut they would be walked
    // through (gates without a switch are open), and taking them out opens the doorway.
    if (b.gate) continue;
    if (t.open?.some((o) => b.min.x >= o.x0 && b.max.x <= o.x1 && b.min.z >= o.z0 && b.max.z <= o.z1 && b.min.y >= -0.05 && b.max.y <= o.y1)) continue;
    // Entirely outside the cut: gone.
    if (b.max.x <= c.x0 + EPS || b.min.x >= c.x1 - EPS || b.max.z <= c.z0 + EPS || b.min.z >= c.z1 - EPS) continue;
    const crosses = b.min.x < c.x0 - EPS || b.max.x > c.x1 + EPS || b.min.z < c.z0 - EPS || b.max.z > c.z1 + EPS;
    const clip = !!b.noRender && (b.players ?? b.collide ?? true) && !(b.bullets ?? b.collide ?? true);
    // Tall invisible clips are the source map's out-of-bounds walls (Terminal's tarmac edge,
    // Scrapyard's corner pocket): on the island they would be invisible walls in the open.
    if (clip && b.max.y - Math.max(0, b.min.y) > WALL_H) continue;
    // Window clips (Nacht's bunker: zombies climb in, players never do): on the island the windows
    // are the way into the bunker from the field, so they open.
    if (clip && b.tag === 'clip' && b.min.y > 0.5) continue;
    const over = Math.max(c.x0 - b.min.x, b.max.x - c.x1, c.z0 - b.min.z, b.max.z - c.z1);
    if (crosses && over <= OVERHANG && b.min.y >= -0.01 && b.max.y > 0.05 && b.max.y - b.min.y <= WALL_H && !clip) {
      // Stairs, crates and props standing on the floor that only just cross the cut: kept whole
      // (cutting stairs drops them, and the floor they lead to can't be reached).
      const out: Brush = { ...b, min: { x: b.min.x + ox, y: b.min.y, z: b.min.z + oz }, max: { x: b.max.x + ox, y: b.max.y, z: b.max.z + oz }, mat: mat(b.mat) };
      if (b.faceMats) out.faceMats = Object.fromEntries(Object.entries(b.faceMats).map(([f, m]) => [f, mat(m)]));
      brushes.push(out);
      continue;
    }
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

/** Ramps from the open ground up onto raised floors cut open at a town's edge (none yet). */
function townEdgeRamps(_brushes: Brush[], _r: Rect): Brush[] {
  return [];
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
  // Open ground: one material over every tile and hill, textured in world space (seamless across
  // tiles), grass with a slow colour drift, turning to dirt round the towns, along the tracks and
  // at the shore (`blendMask`), with dithered edges. 4 m per texture tile, like the classic maps.
  ground: { texture: 'fr_grass', uvMul: [1 / 4, 1 / 4], tint: 0xb0cc8c, segment: 2, worldUV: true, blend: { texture: 'fr_dirt', uvMul: [1 / 4, 1 / 4], tint: 0xb09a80 }, vary: 0.2 },
  cliff: { texture: 'bo_rock', uvMul: [1 / 4, 1 / 4], tint: 0xa09a8c },
  rock: { texture: 'est_rock', uvMul: [1 / 3, 1 / 3] },
  rockDark: { texture: 'bo_rock', uvMul: [1 / 3, 1 / 3], tint: 0xa8a49c },
  bark: { texture: 'fr_bark', uvMul: [1 / 1.5, 1 / 3] },
  foliage: { texture: 'fr_jungle', uvMul: [1 / 2, 1 / 2], tint: 0x9cb07a },
  sea: { texture: 'hj_sea', uvMul: [1 / 16, 1 / 16], fog: true },
  sand: { texture: 'rust_sand', uvMul: [1 / 5, 1 / 5], segment: 3, worldUV: true },
  clip: { texture: 'none' },
};

/**
 * A hill: a plateau, four ramps (1 : `slope`) and four corner fans (strips of ramps stepping down
 * at most 0.35 m, under the step height), so it reads as a mound from every side and can be walked
 * up anywhere: no vertical cliff faces.
 */
function hill(out: Brush[], x: number, z: number, w: number, d: number, h: number, slope = 4) {
  const run = h * slope;
  const px0 = x - w / 2, px1 = x + w / 2, pz0 = z - d / 2, pz1 = z + d / 2;
  const mat = 'ground';
  out.push({ min: { x: px0, y: 0, z: pz0 }, max: { x: px1, y: h, z: pz1 }, mat, hide: ['ny', 'px', 'nx', 'pz', 'nz'] });
  out.push({ min: { x: px0 - run, y: 0, z: pz0 }, max: { x: px0, y: h, z: pz1 }, ramp: '+x', mat, hide: ['ny'] });
  out.push({ min: { x: px1, y: 0, z: pz0 }, max: { x: px1 + run, y: h, z: pz1 }, ramp: '-x', mat, hide: ['ny'] });
  out.push({ min: { x: px0, y: 0, z: pz0 - run }, max: { x: px1, y: h, z: pz0 }, ramp: '+z', mat, hide: ['ny'] });
  out.push({ min: { x: px0, y: 0, z: pz1 }, max: { x: px1, y: h, z: pz1 + run }, ramp: '-z', mat, hide: ['ny'] });
  const n = Math.max(3, Math.ceil(h / 0.35));
  const sw = run / n;
  for (let k = 0; k < n; k++) {
    const hk = h * (1 - (k + 0.5) / n);
    const len = run * (hk / h);
    for (const sz of [-1, 1]) {
      const za = sz > 0 ? pz1 + k * sw : pz0 - (k + 1) * sw;
      out.push({ min: { x: px1, y: 0, z: za }, max: { x: px1 + len, y: hk, z: za + sw }, ramp: '-x', mat, hide: ['ny'] });
      out.push({ min: { x: px0 - len, y: 0, z: za }, max: { x: px0, y: hk, z: za + sw }, ramp: '+x', mat, hide: ['ny'] });
    }
  }
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
    for (const r of holes(im.brushes, im.props, townRect(t))) brushes.push({ min: { x: r.x0, y: -2, z: r.z0 }, max: { x: r.x1, y: 0, z: r.z1 }, mat: 'ground', hide: ['ny', 'px', 'nx', 'pz', 'nz'] });
    brushes.push(...townEdgeRamps(im.brushes, townRect(t)));
    decals.push(...im.decals);
    props.push(...im.props);
    lights.push(...im.lights);
    for (const s of im.spawns.slice(0, 6)) ffa.push(s);
    hotspots.push(...im.hotspots, ...im.spawns.slice(0, 3).map((s) => ({ x: s.x, y: s.y, z: s.z })));
  });

  // Open ground: tiles around the towns (top at y = 0; only the top face is drawn), out to the
  // beach. Every tile is the same `ground` material: the look comes from the blend mask below.
  const SHORE = 10;
  for (const r of terrainTiles(rects, H - SHORE)) brushes.push({ min: { x: r.x0, y: -2, z: r.z0 }, max: { x: r.x1, y: 0, z: r.z1 }, mat: 'ground', hide: ['ny', 'px', 'nx', 'pz', 'nz'] });
  // The beach: a sand ring at y = 0 inside the shore walls, then a sand slope (drawn only) into the sea.
  for (const r of terrainTiles([{ x0: -H + SHORE, z0: -H + SHORE, x1: H - SHORE, z1: H - SHORE }], H)) brushes.push({ min: { x: r.x0, y: -2, z: r.z0 }, max: { x: r.x1, y: 0, z: r.z1 }, mat: 'sand', hide: ['ny', 'px', 'nx', 'pz', 'nz'] });
  const B = 14;
  for (let k = -H - B; k < H + B; k += 64) {
    const k1 = Math.min(H + B, k + 64);
    brushes.push({ min: { x: H, y: -1.6, z: k }, max: { x: H + B, y: 0, z: k1 }, ramp: '-x', mat: 'sand', collide: false });
    brushes.push({ min: { x: -H - B, y: -1.6, z: k }, max: { x: -H, y: 0, z: k1 }, ramp: '+x', mat: 'sand', collide: false });
  }
  for (let k = -H; k < H; k += 64) {
    const k1 = Math.min(H, k + 64);
    brushes.push({ min: { x: k, y: -1.6, z: H }, max: { x: k1, y: 0, z: H + B }, ramp: '-z', mat: 'sand', collide: false });
    brushes.push({ min: { x: k, y: -1.6, z: -H - B }, max: { x: k1, y: 0, z: -H }, ramp: '+z', mat: 'sand', collide: false });
  }

  // Dirt: pads round the towns, tracks from every town to the centre, a fringe before the beach.
  const blendMask: BlendShape[] = [];
  for (const r of rects) blendMask.push({ kind: 'rect', ...r, feather: 10 });
  blendMask.push(
    { kind: 'line', ax: -H, az: -H + SHORE, bx: H, bz: -H + SHORE, w: 2, feather: 7, k: 0.85 },
    { kind: 'line', ax: -H, az: H - SHORE, bx: H, bz: H - SHORE, w: 2, feather: 7, k: 0.85 },
    { kind: 'line', ax: -H + SHORE, az: -H, bx: -H + SHORE, bz: H, w: 2, feather: 7, k: 0.85 },
    { kind: 'line', ax: H - SHORE, az: -H, bx: H - SHORE, bz: H, w: 2, feather: 7, k: 0.85 },
  );
  const centre = rects[BLACKOUT_TOWNS.findIndex((t) => t.map === 'launch')]!;
  const cxm = (centre.x0 + centre.x1) / 2;
  const czm = (centre.z0 + centre.z1) / 2;
  /** Track footprints, so hills, rocks and trees keep off them. */
  const tracks: Rect[] = [];
  for (const r of rects) {
    const tx = (r.x0 + r.x1) / 2;
    const tz = (r.z0 + r.z1) / 2;
    const len = Math.hypot(tx - cxm, tz - czm);
    if (len < 1) continue;
    blendMask.push({ kind: 'line', ax: tx, az: tz, bx: cxm, bz: czm, w: 5, feather: 3.5 });
    for (let u = 0; u <= len; u += 6) {
      const px = tx + ((cxm - tx) * u) / len;
      const pz = tz + ((czm - tz) * u) / len;
      tracks.push({ x0: px - 5, z0: pz - 5, x1: px + 5, z1: pz + 5 });
    }
  }

  // Hills, rocks and trees on the open ground (seeded, kept off towns, tracks, each other and the shore).
  const rnd = prng(0xb1ac0);
  const placed: Rect[] = [...rects.map((r) => ({ x0: r.x0 - 8, z0: r.z0 - 8, x1: r.x1 + 8, z1: r.z1 + 8 })), ...tracks];
  const freeSpot = (r: Rect, m: number) => r.x0 > -H + SHORE + 4 && r.x1 < H - SHORE - 4 && r.z0 > -H + SHORE + 4 && r.z1 < H - SHORE - 4 && !placed.some((p) => overlaps(p, r, m));
  for (let n = 0, tries = 0; n < 22 && tries < 4000; tries++) {
    const w = 10 + rnd() * 16;
    const d = 10 + rnd() * 16;
    const h = 1.5 + rnd() * 2.5;
    const x = (rnd() * 2 - 1) * (H - 40);
    const z = (rnd() * 2 - 1) * (H - 40);
    const r = hillRect(x, z, w, d, h);
    if (!freeSpot(r, 6)) continue;
    hill(brushes, x, z, w, d, h);
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
    // A rock: a block sunk a little into the ground and a smaller one on top (cover), never a pit.
    brushes.push(box(s * 2, h + 0.3, s * 1.6, rnd() < 0.5 ? 'rock' : 'rockDark', x, -0.3, z, { hide: ['ny'] }));
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
    // Canopy: two chunky leaf blocks, drawn only (no collision); foliage hides you from bots.
    const cw = 3.4 + rnd() * 1.6;
    const ch = 2.2 + rnd() * 1.2;
    const ry = rnd() * Math.PI;
    brushes.push(box(cw, ch, cw, 'foliage', x, trunk - 0.8, z, { collide: false, ry }));
    brushes.push(box(cw * 0.62, ch * 0.7, cw * 0.62, 'foliage', x, trunk - 0.8 + ch, z, { collide: false, ry: ry + 0.6 }));
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
  // One material per distinct look: towns share many (same texture, tint and scale), and every
  // material is a draw call per chunk on the client.
  const canon = new Map<string, string>();
  const rename = new Map<string, string>();
  const merged: Record<string, MaterialDef> = {};
  for (const [id, def] of Object.entries(materials)) {
    const key = JSON.stringify(def, Object.keys(def).sort());
    const to = canon.get(key);
    if (to) rename.set(id, to);
    else {
      canon.set(key, id);
      merged[id] = def;
    }
  }
  const re = (id: string) => rename.get(id) ?? id;
  for (const b of brushes) {
    b.mat = re(b.mat);
    if (b.faceMats) for (const f of Object.keys(b.faceMats) as (keyof typeof b.faceMats)[]) b.faceMats[f] = re(b.faceMats[f]!);
  }
  for (const d of decals) d.mat = re(d.mat);
  for (const p of props) if (p.kind === 'cylinder') p.mat = re(p.mat);
  const groups = new Set(lights.map((l) => l.group));
  const lightOn = (k: number) => Object.fromEntries([...groups].map((g) => [g, k]));

  return {
    id: 'blackout',
    name: 'Blackout',
    bounds: { min: { x: -H - 1, y: -8, z: -H - 1 }, max: { x: H + 1, y: wallTop, z: H + 1 } },
    materials: merged,
    brushes,
    decals,
    props,
    lights,
    spawns: { teams: [ffa.slice(0, Math.ceil(ffa.length / 2)), ffa.slice(Math.ceil(ffa.length / 2))], ffa },
    objectives: {},
    times: [
      { id: 'day', name: 'Overcast Day', clock: '13:20', sky: 'skyGrey', unlit: [1, 1, 1], skyRot: 0, sunDir: unitVec(0.45, 0.8, 0.35), sun: [1.05, 1.0, 0.9], amb: [0.5, 0.52, 0.55], fog: [0.66, 0.7, 0.72], fogNear: 55, fogFar: 185, lights: lightOn(0.25), glow: 0.2 },
      { id: 'dusk', name: 'Dusk', clock: '19:05', sky: 'skyDusk', unlit: [1, 0.86, 0.76], skyRot: Math.PI, sunDir: unitVec(-0.8, 0.32, 0.3), sun: [1.1, 0.62, 0.4], amb: [0.3, 0.27, 0.34], fog: [0.58, 0.44, 0.42], fogNear: 50, fogFar: 175, lights: lightOn(1), glow: 0.8 },
    ],
    defaultTime: 'day',
    hotspots,
    chunk: 96,
    drawDistance: 200,
    blendMask,
  };
}
