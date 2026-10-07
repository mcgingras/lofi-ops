/**
 * The tactical map (owner: perks-streaks). BO1 map-targeted killstreaks are chosen on an overhead
 * map pulled up with a radio: Napalm Strike and Rolling Thunder take a spot and a run direction
 * (PC: hold the attack button and swing the mouse), Mortar Team takes three spots one after
 * another, the Attack Helicopter takes an area it patrols near. This file holds what both sides
 * need: the footprints to scale (the client draws them, the server drops on them), the run
 * direction maths and the validation of a chosen target.
 *
 * Conventions: world x/z, yaw 0 runs towards -z ("north", the top of the map), positive yaw turns
 * towards -x (same as `viewDir`).
 */
import type { AABB } from '../math';
import type { KillstreakDef } from './killstreaks';

/** Footprints and timings (BO1: napalm releases ~4 s after the call, Rolling Thunder ~7 s; mortar rounds ~7 m across). */
export const STRIKE = {
  napalm: { drops: [-6, 0, 6] as const, blastR: 7, fireR: 4.5, speed: 70, releaseSec: 4 },
  rolling_thunder: { bombs: 14, spacing: 4, blastR: 6.5, speed: 32, releaseSec: 7 },
  mortar: { blastR: 3.5, spread: 2 },
  attack_helicopter: { patrolR: 14 },
} as const;

/** Map mode limits. */
export const MAP_MODE = {
  /** Seconds the radio stays up before it times out (the streak is kept). */
  maxSec: 30,
  /** Rate limit for map RPCs per player: burst and refill per second. */
  rpcBurst: 4,
  rpcPerSec: 2,
  /** A chosen point may sit this far outside the bounds (cursor rounding); it is clamped in. */
  slack: 0.5,
  /** Clamped this far inside the bounds (like the server's `clampToMap`). */
  inset: 1,
} as const;

export interface XZ {
  x: number;
  z: number;
}

/** Unit run direction for a yaw. */
export const dirOfYaw = (yaw: number): XZ => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

/** Yaw of the run from `a` towards `b` (a drag on the map). */
export const yawFromDrag = (a: XZ, b: XZ): number => Math.atan2(-(b.x - a.x), -(b.z - a.z));

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  const t = Math.PI * 2;
  let r = ((a % t) + t) % t;
  if (r > Math.PI) r -= t;
  return r;
}

/**
 * What a map-targeted strike covers: one circle per drop / round / patrol area, in metres. Napalm:
 * three canisters along the run; Rolling Thunder: a carpet of bombs centred on the spot; Mortar:
 * one blast circle per mark; Attack Helicopter: its patrol radius.
 */
export function strikeFootprint(id: string, points: readonly XZ[], yaw = 0): { x: number; z: number; r: number }[] {
  const d = dirOfYaw(yaw);
  const along = (p: XZ, o: number, r: number) => ({ x: p.x + d.x * o, z: p.z + d.z * o, r });
  const p0 = points[0];
  if (id === 'napalm') return p0 ? STRIKE.napalm.drops.map((o) => along(p0, o, STRIKE.napalm.blastR)) : [];
  if (id === 'rolling_thunder') {
    const t = STRIKE.rolling_thunder;
    return p0 ? Array.from({ length: t.bombs }, (_, i) => along(p0, (i - (t.bombs - 1) / 2) * t.spacing, t.blastR)) : [];
  }
  if (id === 'mortar') return points.map((p) => ({ x: p.x, z: p.z, r: STRIKE.mortar.blastR }));
  if (id === 'attack_helicopter') return p0 ? [{ x: p0.x, z: p0.z, r: STRIKE.attack_helicopter.patrolR }] : [];
  return [];
}

/** Length of the run line a directional strike burns/bombs (for drawing), metres. */
export function strikeLength(id: string): number {
  if (id === 'napalm') return STRIKE.napalm.drops[2] - STRIKE.napalm.drops[0] + STRIKE.napalm.blastR * 2;
  if (id === 'rolling_thunder') return (STRIKE.rolling_thunder.bombs - 1) * STRIKE.rolling_thunder.spacing + STRIKE.rolling_thunder.blastR * 2;
  return 0;
}

/** Points a streak needs on the map (0 = not map-targeted). */
export const mapPointsNeeded = (def: KillstreakDef | undefined): number => (def?.targeting === 'map' ? (def.mapPick === 'points' ? (def.marks ?? 1) : 1) : 0);

export interface MapTargetRequest {
  id: string;
  points: [number, number][];
  yaw?: number;
}

export type MapTargetCheck = { ok: true; points: XZ[]; yaw: number | null } | { ok: false; reason: 'bad_request' | 'not_map_streak' | 'count' | 'out_of_bounds' | 'bad_yaw' };

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Check an (untrusted) tactical map target against a streak and the map bounds: the right number
 * of points, each inside the bounds (with a little slack, then clamped inside), and a finite run
 * direction for line strikes (wrapped to (-PI, PI]).
 */
export function validateMapTarget(def: KillstreakDef | undefined, bounds: AABB, req: unknown): MapTargetCheck {
  const need = mapPointsNeeded(def);
  if (!def || !need) return { ok: false, reason: 'not_map_streak' };
  const r = req as { points?: unknown; yaw?: unknown } | null;
  if (!r || !Array.isArray(r.points)) return { ok: false, reason: 'bad_request' };
  if (r.points.length !== need) return { ok: false, reason: 'count' };
  const s = MAP_MODE.slack;
  const out: XZ[] = [];
  for (const p of r.points) {
    if (!Array.isArray(p) || p.length !== 2 || !finite(p[0]) || !finite(p[1])) return { ok: false, reason: 'bad_request' };
    const [x, z] = p;
    if (x < bounds.min.x - s || x > bounds.max.x + s || z < bounds.min.z - s || z > bounds.max.z + s) return { ok: false, reason: 'out_of_bounds' };
    out.push(clampInside(bounds, { x, z }));
  }
  if (def.mapPick === 'line') {
    if (!finite(r.yaw)) return { ok: false, reason: 'bad_yaw' };
    return { ok: true, points: out, yaw: wrapAngle(r.yaw) };
  }
  return { ok: true, points: out, yaw: null };
}

/** Clamp a point `MAP_MODE.inset` inside the bounds (centre when the map is tiny). */
export function clampInside(b: AABB, p: XZ): XZ {
  const k = MAP_MODE.inset;
  const cl = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  return { x: cl(p.x, b.min.x + k, b.max.x - k), z: cl(p.z, b.min.z + k, b.max.z - k) };
}

/** A token bucket for rate limiting (pure; the server keeps one per player). */
export interface Bucket {
  tokens: number;
  at: number;
}

/** Take one token at time `now` (seconds); false when empty. */
export function takeToken(b: Bucket, now: number, burst: number = MAP_MODE.rpcBurst, perSec: number = MAP_MODE.rpcPerSec): boolean {
  b.tokens = Math.min(burst, b.tokens + Math.max(0, now - b.at) * perSec);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}
