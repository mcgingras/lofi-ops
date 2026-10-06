/**
 * Shot maths shared by server (authoritative) and client (tracers, predicted hitmarkers):
 * damage falloff, hit-part multipliers, and deterministic spread so both sides agree on where a
 * pellet went given the shot's seed.
 */
import type { HitPart } from './collision';
import type { WeaponDef } from './defs/weapons';
import { normalize, rng, type Vec3 } from './math';

/** Damage at a distance, before part multipliers: `near` until nearRange, linear to `far` at farRange. */
export function damageAtRange(w: Pick<WeaponDef, 'damage'>, dist: number): number {
  const { near, far, nearRange, farRange } = w.damage;
  if (dist <= nearRange) return near;
  if (dist >= farRange) return far;
  return near + ((far - near) * (dist - nearRange)) / Math.max(1e-6, farRange - nearRange);
}

export function partMultiplier(w: Pick<WeaponDef, 'multipliers'>, part: HitPart): number {
  return part === 'head' ? w.multipliers.head : part === 'torso' ? w.multipliers.torso : w.multipliers.limb;
}

/** Spread cone half-angle (degrees) for an ads fraction and whether moving. */
export function spreadDegrees(w: Pick<WeaponDef, 'spread'>, ads: number, moving: boolean, mult = 1): number {
  const base = w.spread.hip + (w.spread.ads - w.spread.hip) * ads;
  return (base + (moving ? w.spread.move * (1 - ads * 0.7) : 0)) * mult;
}

/** Seed for a shot's spread: per player + shot seq + pellet index. */
export const shotSeed = (playerSeed: number, seq: number, pellet = 0) => (Math.imul(playerSeed ^ 0x9e3779b9, 31) + seq * 64 + pellet) >>> 0;

/** Direction within a cone of `deg` half-angle around unit `dir`, uniformly over the disc. */
export function spreadDirection(dir: Vec3, deg: number, seed: number): Vec3 {
  if (deg <= 0) return dir;
  const r = rng(seed);
  const a = r() * Math.PI * 2;
  const m = Math.tan((deg * Math.PI) / 180) * Math.sqrt(r());
  // Orthonormal basis around dir.
  const up = Math.abs(dir.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const rx = { x: up.y * dir.z - up.z * dir.y, y: up.z * dir.x - up.x * dir.z, z: up.x * dir.y - up.y * dir.x };
  const rl = Math.hypot(rx.x, rx.y, rx.z);
  rx.x /= rl;
  rx.y /= rl;
  rx.z /= rl;
  const ux = { x: dir.y * rx.z - dir.z * rx.y, y: dir.z * rx.x - dir.x * rx.z, z: dir.x * rx.y - dir.y * rx.x };
  const cx = Math.cos(a) * m;
  const cy = Math.sin(a) * m;
  return normalize({ x: dir.x + rx.x * cx + ux.x * cy, y: dir.y + rx.y * cx + ux.y * cy, z: dir.z + rx.z * cx + ux.z * cy });
}

/** Minimum seconds between shots for a weapon (within a burst for burst weapons). */
export const shotInterval = (w: Pick<WeaponDef, 'rpm'>) => 60 / Math.max(1, w.rpm);
