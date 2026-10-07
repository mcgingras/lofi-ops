/**
 * Baked lighting (port of the prototype's `bakeAt`): ambient with cheap ambient occlusion, sun or
 * moon with a shadow ray, and every map light in range with a shadow ray. Shadow rays use the
 * shared CollisionWorld with the 'sight' mask, so fences and trim don't cast shadows, exactly like
 * the prototype's occluder list. Also samples light for dynamic objects (players, viewmodel).
 */
import type { CollisionWorld, Solid } from '../../shared/collision';
import type { MapData, MapLight, TimePreset } from '../../shared/maps/types';
import type { Vec3 } from '../../shared/math';

const smooth = (x: number, a: number, b: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Baker {
  /** Solids standing on the ground (for ground AO). */
  private standing: Solid[];
  private lights: MapLight[];

  constructor(
    private world: CollisionWorld,
    map: MapData,
  ) {
    this.standing = world.solids.filter((s) => s.sight && s.min.y < 0.1 && s.max.y > 0.1);
    this.lights = map.lights;
  }

  private blocked(o: Vec3, d: Vec3, maxT: number): boolean {
    return maxT > 0 && this.world.raycast(o, d, maxT, 'sight') !== null;
  }

  private groundAO(p: Vec3): number {
    let best = 9;
    for (const b of this.standing) {
      if (b.min.y > p.y + 0.1) continue;
      const dx = Math.max(b.min.x - p.x, 0, p.x - b.max.x);
      const dz = Math.max(b.min.z - p.z, 0, p.z - b.max.z);
      best = Math.min(best, Math.hypot(dx, dz));
    }
    return 0.42 + 0.58 * smooth(best, 0, 1.7);
  }

  /** Light (rgb, roughly 0..2) arriving at point p with normal n under time preset T. */
  at(p: Vec3, n: Vec3, T: TimePreset, out: number[] | Float32Array, offset = 0): void {
    let ao = 1;
    if (n.y > 0.7 && p.y < 0.2) ao = this.groundAO(p);
    else if (Math.abs(n.y) < 0.3) ao = 0.5 + 0.5 * smooth(p.y, 0, 1.9);
    let r = T.amb[0] * ao;
    let g = T.amb[1] * ao;
    let b = T.amb[2] * ao;
    const o = { x: p.x + n.x * 0.05, y: p.y + n.y * 0.05, z: p.z + n.z * 0.05 };
    const sd = n.x * T.sunDir.x + n.y * T.sunDir.y + n.z * T.sunDir.z;
    if (sd > 0 && !this.blocked(o, T.sunDir, 400)) {
      r += T.sun[0] * sd;
      g += T.sun[1] * sd;
      b += T.sun[2] * sd;
    }
    for (const L of this.lights) {
      const k = T.lights[L.group] ?? 0;
      if (!k) continue;
      let dx = L.x - p.x;
      let dy = L.y - p.y;
      let dz = L.z - p.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > L.radius || dist < 1e-6) continue;
      dx /= dist;
      dy /= dist;
      dz /= dist;
      const nd = n.x * dx + n.y * dy + n.z * dz;
      if (nd <= 0) continue;
      if (this.blocked(o, { x: dx, y: dy, z: dz }, dist - 0.3)) continue;
      const att = (1 - dist / L.radius) ** 2 * nd * k;
      r += L.color[0] * att;
      g += L.color[1] * att;
      b += L.color[2] * att;
    }
    out[offset] = r;
    out[offset + 1] = g;
    out[offset + 2] = b;
  }

  /** Bake a whole world-space position/normal buffer into colours. */
  bakeBuffer(pos: ArrayLike<number>, nor: ArrayLike<number>, T: TimePreset, out: Float32Array): void {
    const p = { x: 0, y: 0, z: 0 };
    const n = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < pos.length; i += 3) {
      p.x = pos[i]!;
      p.y = pos[i + 1]!;
      p.z = pos[i + 2]!;
      n.x = nor[i]!;
      n.y = nor[i + 1]!;
      n.z = nor[i + 2]!;
      this.at(p, n, T, out, i);
    }
  }
}

const UP = { x: 0, y: 1, z: 0 };

/** Per-object light for a dynamic object at p (prototype DYN sampling), cached on a coarse grid. */
export class DynLight {
  private cache = new Map<number, [number, number, number]>();
  constructor(
    private baker: Baker,
    private T: TimePreset,
  ) {}

  sample(x: number, y: number, z: number): [number, number, number] {
    const kx = Math.round(x * 2);
    const ky = Math.round(y * 2);
    const kz = Math.round(z * 2);
    const key = ((kx + 4096) * 1024 + (ky + 512)) * 16384 + (kz + 8192);
    let c = this.cache.get(key);
    if (!c) {
      c = [0, 0, 0];
      this.baker.at({ x: kx / 2, y: ky / 2, z: kz / 2 }, UP, this.T, c);
      if (this.cache.size > 20000) this.cache.clear();
      this.cache.set(key, c);
    }
    return c;
  }
}
