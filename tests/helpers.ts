import { CollisionWorld, type Solid } from '../src/shared/collision';
import type { Vec3 } from '../src/shared/math';

export function solid(min: Vec3, max: Vec3, extra: Partial<Solid> = {}): Solid {
  return { min, max, players: true, bullets: true, sight: true, source: 0, mat: 'test', ...extra };
}

/** A 200x200 floor with its top at y=0, plus extra solids. */
export function flatWorld(extra: Solid[] = []): CollisionWorld {
  return new CollisionWorld([solid({ x: -100, y: -1, z: -100 }, { x: 100, y: 0, z: 100 }), ...extra]);
}
