/** Tiny vector helpers shared by sim, collision and ballistics. Plain objects, no classes. */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
export const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const dist2D = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
export function normalize(a: Vec3): Vec3 {
  const l = len(a);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: -1 };
}
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * View direction for a yaw/pitch. Convention (matches three.js cameras and the yard prototype):
 * yaw 0 looks down -z, positive yaw turns left (towards -x); pitch positive looks up.
 */
export function viewDir(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** Yaw that looks from `from` towards `to` (ignores height). */
export const yawTo = (from: Vec3, to: Vec3) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

/** Angles go over the wire quantised so both sides integrate exactly the same numbers. */
export const ANGLE_QUANTUM = 1 / 8192;
export const quantizeAngle = (a: number) => Math.round(a / ANGLE_QUANTUM) * ANGLE_QUANTUM;

/** Deterministic PRNG (mulberry32). Same seed => same sequence on client and server. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string (FNV-1a), for seeding. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
