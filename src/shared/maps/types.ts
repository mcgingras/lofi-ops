/**
 * MapData: everything a map is, as plain data. The same object drives server collision, client
 * prediction, bots and the renderer (meshes, materials, baked lighting, sky, fog). No three.js
 * here: materials name a texture recipe id that the client's texture developer resolves.
 *
 * Coordinates: metres, y up, yaw 0 faces -z (see math.ts `viewDir`).
 */
import { CollisionWorld, type RampDir, type Solid } from '../collision';
import type { AABB, Vec3 } from '../math';

export type RGB = [number, number, number];
export type Face = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

/**
 * How a surface looks. `texture` is a texture recipe id (client `render/` resolves it through the
 * developer: photo + filter + overlay, quantised to 16 colours). UVs are world-scaled metres
 * (prototype `worldUV`) times `uvMul`, unless the brush/decal says `uv: 'raw'` (0..1 per face).
 */
export interface MaterialDef {
  texture: string;
  /** Multiplies UVs. A texture tile every 4 m => [0.25, 0.25]. Default [1, 1]. */
  uvMul?: [number, number];
  /** Multiplies the texture colour, 0xRRGGBB. Default white. */
  tint?: number;
  /** 0..1: 1 ignores lighting (signs, lamp heads, lit windows). */
  emissive?: number;
  side?: 'front' | 'back' | 'double';
  /** Bake vertex lighting (default true). */
  bake?: boolean;
  /** Affected by fog (default true). */
  fog?: boolean;
  /** Affine texture warp multiplier for the PS1 look toggle (default 1). */
  affine?: number;
  /** Metres per vertex-lighting subdivision of faces with this material (default ~1.1; big open ground uses more). */
  segment?: number;
  /**
   * Upward faces take their UVs from the world position (x, z) instead of the face, so the texture
   * runs on seamlessly across brushes of any size (big open ground made of many tiles).
   */
  worldUV?: boolean;
  /**
   * A second texture blended in by the map's `blendMask` (per vertex) plus a world-space noise, with
   * a dithered edge: grass that turns to dirt around towns and along tracks (Blackout's terrain).
   */
  blend?: { texture: string; uvMul?: [number, number]; tint?: number };
  /** 0..1: low-frequency brightness/hue variation of the base texture across the world (no tiling look). */
  vary?: number;
}

/**
 * Where a material's `blend` texture shows (0..1), as shapes: inside a rect or near a line it is
 * `k` (default 1), fading to 0 over `feather` metres. The renderer evaluates it per vertex.
 */
export type BlendShape =
  | { kind: 'rect'; x0: number; z0: number; x1: number; z1: number; feather: number; k?: number }
  | { kind: 'line'; ax: number; az: number; bx: number; bz: number; w: number; feather: number; k?: number };

/** The blend mask at a point (max over the shapes). */
export function blendAt(shapes: readonly BlendShape[], x: number, z: number): number {
  let best = 0;
  for (const s of shapes) {
    let d: number;
    if (s.kind === 'rect') {
      const dx = Math.max(s.x0 - x, 0, x - s.x1);
      const dz = Math.max(s.z0 - z, 0, z - s.z1);
      d = Math.hypot(dx, dz);
    } else {
      const vx = s.bx - s.ax;
      const vz = s.bz - s.az;
      const l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * vx + (z - s.az) * vz) / l2));
      d = Math.max(0, Math.hypot(x - s.ax - vx * t, z - s.az - vz * t) - s.w / 2);
    }
    const f = s.feather > 0 ? 1 - Math.min(1, d / s.feather) : d > 0 ? 0 : 1;
    const v = (s.k ?? 1) * f * f * (3 - 2 * f);
    if (v > best) best = v;
  }
  return best;
}

/**
 * A world brush: an axis-aligned box, or a ramp (a wedge under a slope rising towards `ramp`).
 * min/max ARE the collision box. `ry` is a visual yaw only: the renderer builds a box of the
 * unrotated size (x/z extents swapped when |sin ry| > 0.5) and rotates it; collision stays the AABB.
 */
export interface Brush {
  min: Vec3;
  max: Vec3;
  mat: string;
  ramp?: RampDir;
  ry?: number;
  /** Shorthand for players+bullets+sight (default true). `false` = render only (thin trim, posts). */
  collide?: boolean;
  /** Overrides of `collide` per channel. E.g. a fence: players true, bullets false, sight false. */
  players?: boolean;
  bullets?: boolean;
  sight?: boolean;
  /** Invisible (clip brush). */
  noRender?: boolean;
  /** Faces not to render (e.g. the ground box only shows its top). */
  hide?: Face[];
  /** Per-face material overrides. */
  faceMats?: Partial<Record<Face, string>>;
  /** 'world' (default): UVs in metres x uvMul; 'raw': 0..1 per face x uvMul. */
  uv?: 'world' | 'raw';
  /** Free-form tag for features (e.g. 'spawnroom', 'breakable'). */
  tag?: string;
  /** Switchable solid (Zombies doors, `door:<id>`): collides only while the world's `gateOn` says shut (collision.ts). */
  gate?: string;
}

/**
 * Render-only quads stuck on surfaces: shutters, signs, paint lines, windows.
 * 'wall': vertical w x h quad, bottom edge at y, centred on x/z, facing +z rotated by `ry`.
 * 'flat': horizontal w (along x) x h (along z) quad at height y, facing up, rotated by `ry`.
 */
export interface Decal {
  kind: 'wall' | 'flat';
  w: number;
  h: number;
  x: number;
  y: number;
  z: number;
  ry?: number;
  mat: string;
  uv?: 'world' | 'raw';
  /** Subdivisions for vertex lighting (renderer default: ~1 per 1.1 m). */
  seg?: number;
}

export interface CylinderProp {
  kind: 'cylinder';
  r: number;
  len: number;
  sides: number;
  /** Centre. */
  x: number;
  y: number;
  z: number;
  /** Long axis (default 'y', upright). */
  axis?: 'x' | 'y' | 'z';
  mat: string;
  /** Adds its bounding box as a solid (default true). */
  collide?: boolean;
}

/** Additive glow sprite (lamp halos, crane beacons). Scaled by its light group's intensity. */
export interface GlowProp {
  kind: 'glow';
  color: RGB;
  size: number;
  x: number;
  y: number;
  z: number;
  /** Light group that dims it (defaults to always on). */
  group?: string;
  /** Blinks. */
  beacon?: boolean;
}

/** A Blender glTF model (later). Collision via explicit boxes. */
export interface GltfProp {
  kind: 'gltf';
  url: string;
  x: number;
  y: number;
  z: number;
  ry?: number;
  scale?: number;
  collide?: AABB[];
}

export type Prop = CylinderProp | GlowProp | GltfProp;

/** A point light baked into vertex colours. `group` is switched per time-of-day preset. */
export interface MapLight {
  x: number;
  y: number;
  z: number;
  color: RGB;
  radius: number;
  group: string;
}

/** A time-of-day / weather preset (sky, sun or moon, ambient, fog, which lights are on). */
export interface TimePreset {
  id: string;
  name: string;
  /** HUD clock text. */
  clock: string;
  /** Sky dome texture recipe id. */
  sky: string;
  skyRot: number;
  /** Unit vector towards the sun/moon. */
  sunDir: Vec3;
  sun: RGB;
  amb: RGB;
  fog: RGB;
  fogNear: number;
  fogFar: number;
  /** Light colour used by the 'unlit' debug mode. */
  unlit: RGB;
  /** Intensity per light group (missing = off). */
  lights: Record<string, number>;
  /** Glow sprite intensity. */
  glow: number;
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Objective points per mode kind: 'dom' (A/B/C flags), 'sd' (bomb sites), 'hq', 'koth', 'ctf'... */
export interface ObjectivePoint {
  id: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  /** Owning/attacking team where it matters (S&D sites belong to defenders). */
  team?: 0 | 1;
}

export interface MapData {
  id: string;
  name: string;
  /** Playable volume. Leaving it (or falling below MOVE.killY) kills. */
  bounds: AABB;
  materials: Record<string, MaterialDef>;
  brushes: Brush[];
  decals: Decal[];
  props: Prop[];
  lights: MapLight[];
  spawns: {
    /** Team 0 and team 1 spawn points (team modes). */
    teams: [SpawnPoint[], SpawnPoint[]];
    /** Spread-out points for FFA and fallback. */
    ffa: SpawnPoint[];
  };
  objectives: Record<string, ObjectivePoint[]>;
  /**
   * Extra spawn sets per mode, keyed by mode id then role (optional). Search and Destroy uses
   * `modeSpawns.sd.attackers` / `.defenders` (by role, since teams swap sides between halves).
   * Modes fall back to `spawns` when a map has none.
   */
  modeSpawns?: Record<string, Record<string, SpawnPoint[]>>;
  times: TimePreset[];
  defaultTime: string;
  /** Places bots like to roam to (optional). */
  hotspots?: Vec3[];
  /**
   * Big maps (Blackout): split the renderer's merged meshes into square chunks of this size (m),
   * so they are culled by distance and frustum. Absent: one mesh per material (the default).
   */
  chunk?: number;
  /** Camera far plane for this map (m); the fog should end before it. Default: the renderer's. */
  drawDistance?: number;
  /** Where materials with a `blend` texture show it (Blackout: dirt pads round towns, tracks, the shore). */
  blendMask?: BlendShape[];
}

// ---------------------------------------------------------------------------------------------
// Building collision
// ---------------------------------------------------------------------------------------------

/** All solids of a map: brushes (that collide in any channel) then collidable props. */
export function mapSolids(map: MapData): Solid[] {
  const out: Solid[] = [];
  map.brushes.forEach((b, i) => {
    const c = b.collide ?? true;
    const players = b.players ?? c;
    const bullets = b.bullets ?? c;
    const sight = b.sight ?? c;
    if (!players && !bullets && !sight) return;
    const clip = !!b.noRender && players && !bullets && !sight;
    out.push({ min: { ...b.min }, max: { ...b.max }, ramp: b.ramp, players, bullets, sight, source: i, mat: b.mat, ...(clip ? { clip } : {}), ...(b.tag ? { tag: b.tag } : {}), ...(b.gate ? { gate: b.gate } : {}) });
  });
  map.props.forEach((p, j) => {
    const source = map.brushes.length + j;
    if (p.kind === 'cylinder' && (p.collide ?? true)) {
      const axis = p.axis ?? 'y';
      const hx = axis === 'x' ? p.len / 2 : p.r;
      const hy = axis === 'y' ? p.len / 2 : p.r;
      const hz = axis === 'z' ? p.len / 2 : p.r;
      out.push({ min: { x: p.x - hx, y: p.y - hy, z: p.z - hz }, max: { x: p.x + hx, y: p.y + hy, z: p.z + hz }, players: true, bullets: true, sight: true, source, mat: p.mat });
    } else if (p.kind === 'gltf' && p.collide) {
      for (const b of p.collide) out.push({ min: { ...b.min }, max: { ...b.max }, players: true, bullets: true, sight: true, source, mat: 'gltf' });
    }
  });
  return out;
}

const worlds = new WeakMap<MapData, CollisionWorld>();

/** The (cached) collision world of a map. */
export function buildCollisionWorld(map: MapData): CollisionWorld {
  let w = worlds.get(map);
  if (!w) worlds.set(map, (w = new CollisionWorld(mapSolids(map))));
  return w;
}

// ---------------------------------------------------------------------------------------------
// Authoring helpers (used by map files; mirror the yard prototype's box/flat/wall/cyl helpers)
// ---------------------------------------------------------------------------------------------

export interface BoxOpts extends Partial<Omit<Brush, 'min' | 'max' | 'mat'>> {}

/**
 * Prototype-style box: w (x) x h (y) x d (z), bottom at y, centred on x/z. A quarter-turn `ry`
 * swaps the collision footprint like the prototype did.
 */
export function box(w: number, h: number, d: number, mat: string, x: number, y: number, z: number, o: BoxOpts = {}): Brush {
  const swap = Math.abs(Math.sin(o.ry ?? 0)) > 0.5;
  const hw = (swap ? d : w) / 2;
  const hd = (swap ? w : d) / 2;
  return { ...o, mat, min: { x: x - hw, y, z: z - hd }, max: { x: x + hw, y: y + h, z: z + hd } };
}

export function wallDecal(w: number, h: number, mat: string, x: number, y: number, z: number, ry = 0, o: Partial<Decal> = {}): Decal {
  return { kind: 'wall', w, h, x, y, z, ry, mat, ...o };
}

export function flatDecal(w: number, h: number, mat: string, x: number, y: number, z: number, o: Partial<Decal> = {}): Decal {
  return { kind: 'flat', w, h, x, y, z, mat, ...o };
}

/** Prototype `cyl`: `horizontal` lies along z. */
export function cylinder(r: number, len: number, sides: number, mat: string, x: number, y: number, z: number, o: { horizontal?: boolean; collide?: boolean } = {}): CylinderProp {
  return { kind: 'cylinder', r, len, sides, x, y, z, axis: o.horizontal ? 'z' : 'y', mat, collide: o.collide };
}

export const light = (x: number, y: number, z: number, color: RGB, radius: number, group = 'lamp'): MapLight => ({ x, y, z, color, radius, group });

export function unitVec(x: number, y: number, z: number): Vec3 {
  const l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
}
