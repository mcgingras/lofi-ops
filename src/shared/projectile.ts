/**
 * Thrown-object flight against the brush world: gravity, swept ray collision with bounce
 * (restitution + ground friction), sticking (semtex) and resting. Pure apart from the
 * CollisionWorld it reads. Shared so the client can predict a throw with exactly the server's
 * maths (the Care Package marker's arc and landing spot); the server's grenades, launcher rounds
 * and marker canisters all step through `stepBody`.
 */
import type { CollisionWorld } from './collision';
import { NADE_PHYSICS } from './defs/equipment';
import type { Vec3 } from './math';

export interface Body {
  pos: Vec3;
  vel: Vec3;
  /** Stuck to a surface (semtex) or resting on the ground: no more motion. */
  stuck: boolean;
  resting: boolean;
  /** Distance flown so far (launcher arming). */
  traveled: number;
}

export interface StepOpts {
  gravity?: number;
  sticky?: boolean;
  restitution?: number;
}

export interface StepResult {
  /** The body touched world geometry this step. */
  hit: boolean;
  normal: Vec3 | null;
}

const SUB = 1 / 120;

/** Advance a body by `dt` seconds (sub-stepped). */
export function stepBody(world: CollisionWorld, b: Body, dt: number, o: StepOpts = {}): StepResult {
  const res: StepResult = { hit: false, normal: null };
  if (b.stuck || b.resting) return res;
  const g = o.gravity ?? NADE_PHYSICS.gravity;
  const e = o.restitution ?? NADE_PHYSICS.restitution;
  const r = NADE_PHYSICS.radius;
  let left = dt;
  while (left > 1e-6 && !b.stuck && !b.resting) {
    const h = Math.min(SUB, left);
    left -= h;
    b.vel.y -= g * h;
    const mx = b.vel.x * h;
    const my = b.vel.y * h;
    const mz = b.vel.z * h;
    const len = Math.hypot(mx, my, mz);
    if (len < 1e-9) continue;
    const d = { x: mx / len, y: my / len, z: mz / len };
    const hit = world.raycast(b.pos, d, len + r, 'bullets');
    if (!hit) {
      b.pos.x += mx;
      b.pos.y += my;
      b.pos.z += mz;
      b.traveled += len;
      continue;
    }
    res.hit = true;
    res.normal = hit.normal;
    const t = Math.max(0, hit.t - r);
    b.pos.x += d.x * t;
    b.pos.y += d.y * t;
    b.pos.z += d.z * t;
    b.traveled += t;
    if (o.sticky) {
      b.stuck = true;
      b.vel = { x: 0, y: 0, z: 0 };
      break;
    }
    // Reflect the velocity about the surface normal; lose energy, more along the ground.
    const n = hit.normal;
    if (n.x === 0 && n.y === 0 && n.z === 0) {
      // Started inside a solid: give up and stay put.
      b.resting = true;
      b.vel = { x: 0, y: 0, z: 0 };
      break;
    }
    const vn = b.vel.x * n.x + b.vel.y * n.y + b.vel.z * n.z;
    b.vel.x -= (1 + e) * vn * n.x;
    b.vel.y -= (1 + e) * vn * n.y;
    b.vel.z -= (1 + e) * vn * n.z;
    if (n.y > 0.5) {
      b.vel.x *= NADE_PHYSICS.friction;
      b.vel.z *= NADE_PHYSICS.friction;
      if (Math.hypot(b.vel.x, b.vel.y, b.vel.z) < 0.6) {
        b.resting = true;
        b.vel = { x: 0, y: 0, z: 0 };
      }
    }
  }
  return res;
}

/** Initial velocity for a throw: aim direction lifted by `loft`, at `speed`, plus some of the thrower's velocity. */
export function throwVelocity(dir: Vec3, speed: number, loft: number, carry: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const x = dir.x;
  const y = dir.y + loft;
  const z = dir.z;
  const l = Math.hypot(x, y, z) || 1;
  return { x: (x / l) * speed + carry.x * 0.5, y: (y / l) * speed + Math.max(0, carry.y) * 0.5, z: (z / l) * speed + carry.z * 0.5 };
}

