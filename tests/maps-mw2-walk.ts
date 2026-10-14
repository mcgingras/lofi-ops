/**
 * Walk-based reachability for map tests (maps-mw2): flood-fills a map by actually running the
 * shared `stepMove` from a start point in 8 directions (walking, plus a running jump wherever a
 * walk is blocked, which mantles onto or over whatever it can, and a standing mantle against the
 * obstacle), so stairs, ramps, ledges, holes, windows and clips are judged by the real movement code.
 * `{ mantle: false }` floods as before mantling existed (for comparisons).
 */
import type { CollisionWorld } from '../src/shared/collision';
import { MOVE, TICK_DT } from '../src/shared/constants';
import { Buttons } from '../src/shared/input';
import type { MapData } from '../src/shared/maps/types';
import { buildCollisionWorld } from '../src/shared/maps/types';
import type { Vec3 } from '../src/shared/math';
import { createMoveState, DEFAULT_MOVE_PARAMS, stepMove, type MoveParams, type MoveState } from '../src/shared/movement';

export interface WalkResult {
  nodes: Vec3[];
  /** Positions a move ended outside the map bounds (should be empty: bounds are closed). */
  escapes: Vec3[];
  /** Positions where the player fell below the bounds' floor. */
  falls: Vec3[];
  /** Nodes first reached by a mantle (with the node it started from). */
  mantles: { from: Vec3; to: Vec3 }[];
}

export interface FloodOptions {
  /** Let the flood mantle (default true). */
  mantle?: boolean;
}

const DIRS: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function settle(world: CollisionWorld, s: MoveState, maxSec = 3, params: MoveParams = DEFAULT_MOVE_PARAMS): boolean {
  for (let t = 0; t < maxSec && (!s.onGround || s.mantle); t += TICK_DT) {
    stepMove(world, s, 0, 0, TICK_DT, params);
    if (s.y < MOVE.killY) return false;
  }
  return s.onGround;
}

/** Flood the walkable space from `start` (feet position; snapped to the ground below it). */
export function floodWalk(map: MapData, start: Vec3, cell = 0.8, maxNodes = 40000, opts: FloodOptions = {}): WalkResult {
  const world = buildCollisionWorld(map);
  const P: MoveParams = { ...DEFAULT_MOVE_PARAMS, canMantle: opts.mantle !== false };
  const b = map.bounds;
  const key = (p: Vec3) => `${Math.round(p.x / cell)},${Math.round(p.z / cell)},${Math.round(p.y / 0.6)}`;
  const g = world.groundBelow(start.x, start.z, start.y + 1, 3);
  if (g === null) throw new Error(`no ground under start ${JSON.stringify(start)}`);
  const first = { x: start.x, y: g, z: start.z };
  const seen = new Set<string>([key(first)]);
  const nodes: Vec3[] = [first];
  const escapes: Vec3[] = [];
  const falls: Vec3[] = [];
  const mantles: { from: Vec3; to: Vec3 }[] = [];
  const outside = (p: Vec3) => p.x < b.min.x || p.x > b.max.x || p.z < b.min.z || p.z > b.max.z;

  const visit = (s: MoveState, from?: Vec3) => {
    const p = { x: s.x, y: s.y, z: s.z };
    if (outside(p)) {
      escapes.push(p);
      return;
    }
    const k = key(p);
    if (seen.has(k)) return;
    seen.add(k);
    nodes.push(p);
    if (from) mantles.push({ from, to: p });
  };
  const step = (s: MoveState, b: number, yaw: number) => {
    const before = !!s.mantle;
    stepMove(world, s, b, yaw, TICK_DT, P);
    return !before && !!s.mantle;
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
      for (let t = 0; t < dist / MOVE.walk; t += TICK_DT) stepMove(world, s, Buttons.FORWARD, yaw, TICK_DT, P);
      const moved = Math.hypot(s.x - n.x, s.z - n.z);
      if (!settle(world, s, 3, P)) {
        falls.push({ x: s.x, y: s.y, z: s.z });
        continue;
      }
      visit(s);
      if (moved > dist * 0.6) continue;
      // Blocked: try a running jump (back up a little first so there is a run-up).
      const j = { ...createMoveState(n.x, n.y, n.z), onGround: true };
      for (let t = 0; t < 0.1; t += TICK_DT) stepMove(world, j, Buttons.BACK, yaw, TICK_DT, P);
      settle(world, j, 3, P);
      for (let t = 0; t < 0.12; t += TICK_DT) stepMove(world, j, Buttons.FORWARD, yaw, TICK_DT, P);
      let mantled = step(j, Buttons.FORWARD | Buttons.JUMP, yaw);
      // Jump held while airborne catches a ledge in reach (as a player holding jump would).
      for (let t = 0; t < 0.5; t += TICK_DT) mantled = step(j, Buttons.FORWARD | (j.onGround ? 0 : Buttons.JUMP), yaw) || mantled;
      if (!settle(world, j, 3, P)) {
        falls.push({ x: j.x, y: j.y, z: j.z });
        continue;
      }
      visit(j, mantled ? n : undefined);
      if (!P.canMantle) continue;
      // A standing mantle right against the obstacle (walk up to it, then jump).
      const m = { ...createMoveState(n.x, n.y, n.z), onGround: true };
      for (let t = 0; t < dist / MOVE.walk + 0.1; t += TICK_DT) stepMove(world, m, Buttons.FORWARD, yaw, TICK_DT, P);
      if (!step(m, Buttons.FORWARD | Buttons.JUMP, yaw)) continue;
      if (!settle(world, m, 3, P)) {
        falls.push({ x: m.x, y: m.y, z: m.z });
        continue;
      }
      visit(m, n);
    }
  }
  return { nodes, escapes, falls, mantles };
}

/** Is there a walk node within `r` (xz) and `dy` (height) of the point? */
export function reaches(res: WalkResult, p: Vec3, r = 1.2, dy = 0.7): boolean {
  return res.nodes.some((n) => Math.abs(n.y - p.y) <= dy && Math.hypot(n.x - p.x, n.z - p.z) <= r);
}
