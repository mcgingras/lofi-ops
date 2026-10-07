/**
 * Authoring kit for the MW2-inspired maps (owner: maps-mw2): corner-based slabs, ramps that stand
 * in for ladders and stairs, walls with door/window holes, railings, fences, perimeter clips and
 * spawn rows. Everything ends up as plain MapData brushes/decals/props/lights (see types.ts), so
 * collision, bots and the renderer read it like any other map.
 */
import type { RampDir } from '../collision';
import type { Brush, BoxOpts, CylinderProp, Decal, MapLight, Prop, RGB, SpawnPoint } from './types';

/** A hole in a wall: [from, to] along the wall, [bottom, top] in world y. */
export type Hole = [number, number, number, number];

export class MapKit {
  readonly brushes: Brush[] = [];
  readonly decals: Decal[] = [];
  readonly props: Prop[] = [];
  readonly lights: MapLight[] = [];

  add(b: Brush): Brush {
    this.brushes.push(b);
    return b;
  }

  /** Box from two corners (any order). */
  slab(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: string, o: BoxOpts = {}): Brush {
    return this.add({ ...o, mat, min: { x: Math.min(x0, x1), y: Math.min(y0, y1), z: Math.min(z0, z1) }, max: { x: Math.max(x0, x1), y: Math.max(y0, y1), z: Math.max(z0, z1) } });
  }

  /** Render-only box (trim, posts, braces). */
  trim(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: string, o: BoxOpts = {}): Brush {
    return this.slab(x0, y0, z0, x1, y1, z1, mat, { ...o, collide: false });
  }

  /** A wedge whose walkable slope rises towards `dir` (low edge at y0, high edge at y1). */
  ramp(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, dir: RampDir, mat: string, o: BoxOpts = {}): Brush {
    return this.slab(x0, y0, z0, x1, y1, z1, mat, { ...o, ramp: dir });
  }

  /** Invisible wall that stops players only (bullets and sight pass): map edges, fence lines. */
  playerClip(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Brush {
    return this.slab(x0, y0, z0, x1, y1, z1, 'clip', { noRender: true, bullets: false, sight: false, tag: 'clip' });
  }

  /** Closed box of player clips around the playable rectangle (inner faces at the given edges). */
  perimeter(minX: number, maxX: number, minZ: number, maxZ: number, y0: number, y1: number, t = 0.4): void {
    this.playerClip(minX - t, y0, minZ - t, maxX + t, y1, minZ);
    this.playerClip(minX - t, y0, maxZ, maxX + t, y1, maxZ + t);
    this.playerClip(minX - t, y0, minZ, minX, y1, maxZ);
    this.playerClip(maxX, y0, minZ, maxX + t, y1, maxZ);
  }

  /**
   * A straight wall along x (`axis: 'x'`, at z = `at`) or along z (at x = `at`), thickness `t`
   * centred on `at`, from y0 to y1, with rectangular holes (doors, windows, breaches).
   */
  wall(axis: 'x' | 'z', from: number, to: number, at: number, y0: number, y1: number, t: number, mat: string, holes: Hole[] = [], o: BoxOpts = {}): void {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const seg = (a: number, b: number, ya: number, yb: number) => {
      if (b - a < 1e-3 || yb - ya < 1e-3) return;
      if (axis === 'x') this.slab(a, ya, at - t / 2, b, yb, at + t / 2, mat, o);
      else this.slab(at - t / 2, ya, a, at + t / 2, yb, b, mat, o);
    };
    const hs = [...holes].sort((p, q) => p[0] - q[0]);
    let cur = lo;
    for (const [a, b, hb, ht] of hs) {
      seg(cur, a, y0, y1);
      seg(a, b, y0, hb); // sill
      seg(a, b, ht, y1); // lintel
      cur = b;
    }
    seg(cur, hi, y0, y1);
  }

  /**
   * Railing along x or z on a deck at height `y`: players stop, bullets and sight pass (bars).
   * Drawn as a double-sided bar decal plus a top rail.
   */
  rail(axis: 'x' | 'z', from: number, to: number, at: number, y: number, mat: string, topMat: string, h = 1.0): void {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    if (hi - lo < 1e-3) return;
    const t = 0.08;
    if (axis === 'x') {
      this.slab(lo, y, at - t / 2, hi, y + h, at + t / 2, mat, { noRender: true, bullets: false, sight: false, tag: 'rail' });
      this.decals.push({ kind: 'wall', w: hi - lo, h, x: (lo + hi) / 2, y, z: at, ry: 0, mat });
      this.trim(lo, y + h - 0.06, at - 0.05, hi, y + h, at + 0.05, topMat);
    } else {
      this.slab(at - t / 2, y, lo, at + t / 2, y + h, hi, mat, { noRender: true, bullets: false, sight: false, tag: 'rail' });
      this.decals.push({ kind: 'wall', w: hi - lo, h, x: at, y, z: (lo + hi) / 2, ry: Math.PI / 2, mat });
      this.trim(at - 0.05, y + h - 0.06, lo, at + 0.05, y + h, hi, topMat);
    }
  }

  /** Chain-link fence line: see-through, shoot-through, players stop. Posts every ~3 m. */
  fence(axis: 'x' | 'z', from: number, to: number, at: number, y: number, h: number, mat: string, postMat: string, clipH = 8): void {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const len = hi - lo;
    if (axis === 'x') {
      this.decals.push({ kind: 'wall', w: len, h, x: (lo + hi) / 2, y, z: at, ry: 0, mat });
      this.playerClip(lo, y - 1, at - 0.15, hi, y + clipH, at + 0.15);
    } else {
      this.decals.push({ kind: 'wall', w: len, h, x: at, y, z: (lo + hi) / 2, ry: Math.PI / 2, mat });
      this.playerClip(at - 0.15, y - 1, lo, at + 0.15, y + clipH, hi);
    }
    const n = Math.max(1, Math.round(len / 3));
    for (let i = 0; i <= n; i++) {
      const p = lo + (len * i) / n;
      if (axis === 'x') this.trim(p - 0.05, y, at - 0.05, p + 0.05, y + h + 0.1, at + 0.05, postMat);
      else this.trim(at - 0.05, y, p - 0.05, at + 0.05, y + h + 0.1, p + 0.05, postMat);
    }
  }

  /** Upright or lying cylinder prop (collides as its bounding box unless `collide: false`). */
  cyl(r: number, len: number, sides: number, mat: string, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y', collide = true): CylinderProp {
    const p: CylinderProp = { kind: 'cylinder', r, len, sides, x, y, z, axis, mat, collide };
    this.props.push(p);
    return p;
  }

  light(x: number, y: number, z: number, color: RGB, radius: number, group = 'lamp'): void {
    this.lights.push({ x, y, z, color, radius, group });
  }

  glow(x: number, y: number, z: number, color: RGB, size: number, group?: string, beacon = false): void {
    this.props.push({ kind: 'glow', x, y, z, color, size, group, beacon });
  }

  /** Lamp pole: collidable pole, trim arm + head, baked light and a glow sprite. */
  lampPole(x: number, z: number, h: number, dx: number, dz: number, poleMat: string, lampMat: string, color: RGB, radius: number, group = 'lamp'): void {
    this.slab(x - 0.11, 0, z - 0.11, x + 0.11, h, z + 0.11, poleMat);
    const hx = x + dx;
    const hz = z + dz;
    this.trim(Math.min(x, hx) - 0.06, h - 0.2, Math.min(z, hz) - 0.06, Math.max(x, hx) + 0.06, h - 0.08, Math.max(z, hz) + 0.06, poleMat);
    this.trim(hx - 0.35, h - 0.36, hz - 0.2, hx + 0.35, h - 0.2, hz + 0.2, lampMat);
    this.light(hx, h - 0.8, hz, color, radius, group);
    this.glow(hx, h - 0.5, hz, [color[0] * 0.45, color[1] * 0.45, color[2] * 0.45], 3, group);
  }
}

export const spawnAt = (x: number, z: number, yaw: number, y = 0): SpawnPoint => ({ x, y, z, yaw });

/** Yaw that faces from (x, z) towards (tx, tz) (yaw 0 looks down -z). */
export function yawTowards(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - x), -(tz - z));
}
