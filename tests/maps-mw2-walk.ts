/**
 * Walk-based reachability for map tests (maps-mw2): flood-fills a map by actually running the
 * shared `stepMove` from a start point in 8 directions (walking, plus a running jump wherever a
 * walk is blocked), so stairs, ramps, ledges, holes and clips are judged by the real movement code.
 */
import type { CollisionWorld } from '../src/shared/collision';
import { MOVE, TICK_DT } from '../src/shared/constants';
import { Buttons } from '../src/shared/input';
import type { MapData } from '../src/shared/maps/types';
import { buildCollisionWorld } from '../src/shared/maps/types';
import type { Vec3 } from '../src/shared/math';
import { createMoveState, stepMove, type MoveState } from '../src/shared/movement';

export interface WalkResult {
  nodes: Vec3[];
  /** Positions a move ended outside the map bounds (should be empty: bounds are closed). */
  escapes: Vec3[];
  /** Positions where the player fell below the bounds' floor. */
  falls: Vec3[];
}

const DIRS: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function settle(world: CollisionWorld, s: MoveState, maxSec = 3): boolean {
  for (let t = 0; t < maxSec && !s.onGround; t += TICK_DT) {
    stepMove(world, s, 0, 0, TICK_DT);
    if (s.y < MOVE.killY) return false;
  }
  return s.onGround;
}

/** Flood the walkable space from `start` (feet position; snapped to the ground below it). */
export function floodWalk(map: MapData, start: Vec3, cell = 0.8, maxNodes = 40000): WalkResult {
  const world = buildCollisionWorld(map);
  const b = map.bounds;
  const key = (p: Vec3) => `${Math.round(p.x / cell)},${Math.round(p.z / cell)},${Math.round(p.y / 0.6)}`;
  const g = world.groundBelow(start.x, start.z, start.y + 1, 3);
  if (g === null) throw new Error(`no ground under start ${JSON.stringify(start)}`);
  const first = { x: start.x, y: g, z: start.z };
  const seen = new Set<string>([key(first)]);
  const nodes: Vec3[] = [first];
  const escapes: Vec3[] = [];
  const falls: Vec3[] = [];
  const outside = (p: Vec3) => p.x < b.min.x || p.x > b.max.x || p.z < b.min.z || p.z > b.max.z;

  const visit = (s: MoveState) => {
    const p = { x: s.x, y: s.y, z: s.z };
    if (outside(p)) {
      escapes.push(p);
      return;
    }
    const k = key(p);
    if (seen.has(k)) return;
    seen.add(k);
    nodes.push(p);
  };

  for (let i = 0; i < nodes.length && nodes.length < maxNodes; i++) {
    const n = nodes[i]!;
    // Walk towards the centre of each neighbouring cell (keeps the flood on the grid).
    const cx = Math.round(n.x / cell);
    const cz = Math.round(n.z / cell);
    for (const [dx, dz] of DIRS) {
      const tx = (cx + dx) * cell;
      const tz = (cz + dz) * cell;
      const dist = Math.hypot(tx - n.x, tz - n.z);
      const yaw = Math.atan2(-(tx - n.x), -(tz - n.z));
      const s = { ...createMoveState(n.x, n.y, n.z), onGround: true };
      for (let t = 0; t < dist / MOVE.walk; t += TICK_DT) stepMove(world, s, Buttons.FORWARD, yaw, TICK_DT);
      const moved = Math.hypot(s.x - n.x, s.z - n.z);
      if (!settle(world, s)) {
        falls.push({ x: s.x, y: s.y, z: s.z });
        continue;
      }
      visit(s);
      if (moved > dist * 0.6) continue;
      // Blocked: try a running jump (back up a little first so there is a run-up).
      const j = { ...createMoveState(n.x, n.y, n.z), onGround: true };
      for (let t = 0; t < 0.1; t += TICK_DT) stepMove(world, j, Buttons.BACK, yaw, TICK_DT);
      settle(world, j);
      for (let t = 0; t < 0.12; t += TICK_DT) stepMove(world, j, Buttons.FORWARD, yaw, TICK_DT);
      stepMove(world, j, Buttons.FORWARD | Buttons.JUMP, yaw, TICK_DT);
      for (let t = 0; t < 0.5; t += TICK_DT) stepMove(world, j, Buttons.FORWARD, yaw, TICK_DT);
      if (!settle(world, j)) {
        falls.push({ x: j.x, y: j.y, z: j.z });
        continue;
      }
      visit(j);
    }
  }
  return { nodes, escapes, falls };
}

/** Is there a walk node within `r` (xz) and `dy` (height) of the point? */
export function reaches(res: WalkResult, p: Vec3, r = 1.2, dy = 0.7): boolean {
  return res.nodes.some((n) => Math.abs(n.y - p.y) <= dy && Math.hypot(n.x - p.x, n.z - p.z) <= r);
}
