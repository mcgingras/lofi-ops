/**
 * Map navigation checks for the maps-bo tests: a walkable-graph flood fill driven by the real
 * `stepMove` (so steps, ramps, clips and doorways behave exactly as in a match) and a scripted
 * walker that follows waypoints.
 */
import type { CollisionWorld } from '../src/shared/collision';
import { Buttons } from '../src/shared/input';
import type { Vec3 } from '../src/shared/math';
import { createMoveState, stepMove, type MoveState } from '../src/shared/movement';

const DT = 1 / 60;
const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

const yawTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));

/** Let a state fall/settle with no input until it is on the ground (or give up). */
function settle(world: CollisionWorld, s: MoveState, maxSteps = 240): MoveState {
  for (let i = 0; i < maxSteps && !s.onGround; i++) stepMove(world, s, 0, 0, DT);
  if (s.onGround) for (let i = 0; i < 3; i++) stepMove(world, s, 0, 0, DT);
  return s;
}

/** Try to walk from `from` to the horizontal point (tx, tz). Returns where it ended up, or null if blocked. */
export function tryWalk(world: CollisionWorld, from: Vec3, tx: number, tz: number, tol = 0.2): MoveState | null {
  const s = { ...createMoveState(from.x, from.y, from.z), onGround: true };
  const d0 = Math.hypot(tx - s.x, tz - s.z);
  const maxSteps = Math.ceil((d0 / 5) * 60) + 30;
  for (let i = 0; i < maxSteps; i++) {
    const d = Math.hypot(tx - s.x, tz - s.z);
    if (d < 0.08) break;
    stepMove(world, s, Buttons.FORWARD, yawTo(s.x, s.z, tx, tz), DT);
  }
  settle(world, s);
  if (!s.onGround) return null;
  return Math.hypot(tx - s.x, tz - s.z) <= tol ? s : null;
}

export interface Reach {
  nodes: Vec3[];
  /** Is some reachable node within `r` horizontally (and 1.2 m vertically) of p? */
  near(p: Vec3, r: number): boolean;
}

/**
 * Flood fill the walkable space from `starts` on a grid of `step` metres (8-connected), walking
 * each edge with `stepMove`. Nodes are keyed by grid cell and height band, so floors stack.
 */
export function floodFill(world: CollisionWorld, starts: Vec3[], step = 0.8, limit = 60000): Reach {
  const key = (x: number, y: number, z: number) => `${Math.round(x / step)},${Math.round(z / step)},${Math.round(y / 0.5)}`;
  const seen = new Map<string, Vec3>();
  const queue: Vec3[] = [];
  for (const s0 of starts) {
    const s = settle(world, { ...createMoveState(s0.x, s0.y + 0.05, s0.z), onGround: false });
    const p = { x: s.x, y: s.y, z: s.z };
    const k = key(p.x, p.y, p.z);
    if (!seen.has(k)) {
      seen.set(k, p);
      queue.push(p);
    }
  }
  while (queue.length && seen.size < limit) {
    const p = queue.shift()!;
    for (const [dx, dz] of DIRS) {
      // Snap targets onto the grid so keys stay stable.
      const tx = (Math.round(p.x / step) + dx) * step;
      const tz = (Math.round(p.z / step) + dz) * step;
      const end = tryWalk(world, p, tx, tz);
      if (!end) continue;
      const k = key(end.x, end.y, end.z);
      if (seen.has(k)) continue;
      const q = { x: end.x, y: end.y, z: end.z };
      seen.set(k, q);
      queue.push(q);
    }
  }
  const nodes = [...seen.values()];
  return {
    nodes,
    near: (p, r) => nodes.some((n) => Math.hypot(n.x - p.x, n.z - p.z) <= r && Math.abs(n.y - p.y) <= 1.2),
  };
}

/**
 * Walk a waypoint route with forward input (sprinting optional), steering at each waypoint.
 * Returns the final state and how long it took; throws with the stuck position if a leg times out.
 */
export function walkRoute(world: CollisionWorld, start: Vec3, route: Vec3[], sprint = false): { state: MoveState; seconds: number; maxY: number } {
  const s = settle(world, { ...createMoveState(start.x, start.y + 0.05, start.z), onGround: false });
  let t = 0;
  let maxY = s.y;
  route.forEach((wp, i) => {
    const legStart = t;
    while (Math.hypot(wp.x - s.x, wp.z - s.z) > 0.35) {
      stepMove(world, s, Buttons.FORWARD | (sprint ? Buttons.SPRINT : 0), yawTo(s.x, s.z, wp.x, wp.z), DT);
      t += DT;
      maxY = Math.max(maxY, s.y);
      if (t - legStart > 20) throw new Error(`stuck on leg ${i} to ${JSON.stringify(wp)} at ${s.x.toFixed(2)},${s.y.toFixed(2)},${s.z.toFixed(2)}`);
    }
    if (Math.abs(s.y - wp.y) > 0.6) throw new Error(`leg ${i}: reached ${JSON.stringify(wp)} at height ${s.y.toFixed(2)}`);
  });
  return { state: s, seconds: t, maxY };
}
