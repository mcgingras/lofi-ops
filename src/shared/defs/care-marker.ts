/**
 * Care Package marker (owner: perks-streaks). BO1 delivers the Care Package to a thrown smoke
 * canister (`supplydrop_mp`, `maps/mp/gametypes/_supplydrop.gsc`): calling the streak puts the
 * canister in your hand, FIRE throws it, it bounces and settles (`waitTillNotMoving`), the Chinook
 * is sent to where it stopped, and after the canister's fuse the smoke pours out
 * (`fx_smoke_supply_drop_blue_mp`: BO1's smoke is blue, MW2's was red). A canister that never
 * settles is dropped after `GRENADE_LIFETIME` (10 s).
 *
 * Everything here is pure and shared so the client's throw preview (the arc and the landing ring)
 * runs exactly the server's maths: the same launch point and velocity (`markerLaunch`), the same
 * per-tick flight (`stepBody` at TICK_DT, `simulateMarker`) and the same rules for where the crate
 * can actually come down (`resolveDrop`).
 */
import type { CollisionWorld } from '../collision';
import { TICK_DT } from '../constants';
import { clamp, viewDir, type AABB, type Vec3 } from '../math';
import { stepBody, throwVelocity, type Body, type StepOpts } from '../projectile';

export const MARKER = {
  /** Throw speed (m/s) and upward bias, like a grenade lob. */
  speed: 15,
  loft: 0.22,
  /** Flight: gravity, bounce. */
  step: { gravity: 18, restitution: 0.3 } satisfies StepOpts,
  /** Longest flight before it counts as settled where it is (BO1 GRENADE_LIFETIME 10 s). */
  maxFlightSec: 8,
  /** Smoke starts this long after it settles (the canister's fuse). */
  smokeDelaySec: 1,
  /** The canister and its smoke stay this long after the crate lands (and at most `smokeMaxSec`). */
  smokeAfterLandSec: 6,
  smokeMaxSec: 40,
  /** BO1 blue (`fx_smoke_supply_drop_blue_mp`). Change here for MW2's red (0xd04030). */
  smokeColor: 0x8da3cc,
  /** A surface this far above the canister means it is under cover: the crate would land on the roof. */
  coverClear: 0.75,
  /** Tops higher than the highest spawn + this are roofs nobody can reach. */
  roofAbove: 4.5,
  /** Keep drops this far inside the map bounds (the old designator's clamp). */
  edge: 1,
  /** Fallback search step (m) from the canister back toward the thrower. */
  searchStep: 0.5,
  /** The crate's footprint must be free of walls (radius, height) where it lands. */
  crateRadius: 0.45,
  crateHeight: 0.9,
} as const;

/**
 * The canister entity is `KS_ENTITY.marker` (`ks_marker`): `s.k` 1 once settled, `s.sm` room time
 * the smoke starts, `s.v` 0 when the crate had to come down somewhere else (`resolveDrop`).
 */

export interface MarkerLaunch {
  pos: Vec3;
  vel: Vec3;
}

/**
 * Where and how fast the canister leaves the hand: a little in front of, right of and below the
 * eye (pulled back to the eye when that point is inside a wall), along the aim lifted by `loft`,
 * plus half the thrower's velocity. Same shape as a grenade release.
 */
export function markerLaunch(world: CollisionWorld, eye: Vec3, yaw: number, pitch: number, carry: Vec3 = { x: 0, y: 0, z: 0 }): MarkerLaunch {
  const dir = viewDir(yaw, pitch);
  const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  let pos = { x: eye.x + dir.x * 0.4 + right.x * 0.15, y: eye.y - 0.1 + dir.y * 0.4, z: eye.z + dir.z * 0.4 + right.z * 0.15 };
  if (!world.lineOfSight(eye, pos, 'bullets')) pos = { ...eye };
  return { pos, vel: throwVelocity(dir, MARKER.speed, MARKER.loft, carry) };
}

export function markerBody(l: MarkerLaunch): Body {
  return { pos: { ...l.pos }, vel: { ...l.vel }, stuck: false, resting: false, traveled: 0 };
}

/** One server tick of canister flight (the client's preview calls exactly this). */
export function markerStep(world: CollisionWorld, b: Body, dt = TICK_DT): void {
  stepBody(world, b, dt, MARKER.step);
}

export interface MarkerFlight {
  /** Position after each tick (the first entry is the launch point). */
  path: Vec3[];
  /** Where it ended up. */
  rest: Vec3;
  /** It came to rest (false: still moving after `maxFlightSec`, or fell out of the world). */
  settled: boolean;
  /** Ticks flown. */
  ticks: number;
}

/** Fly a throw to the end, tick by tick, the way the server will (`floorY`: below this it is lost). */
export function simulateMarker(world: CollisionWorld, l: MarkerLaunch, floorY: number, maxSec: number = MARKER.maxFlightSec): MarkerFlight {
  const b = markerBody(l);
  const path: Vec3[] = [{ ...b.pos }];
  const n = Math.round(maxSec / TICK_DT);
  let i = 0;
  for (; i < n && !b.resting && b.pos.y >= floorY; i++) {
    markerStep(world, b);
    path.push({ ...b.pos });
  }
  return { path, rest: { ...b.pos }, settled: b.resting, ticks: i };
}

/** What a map needs to judge drops. */
export interface DropMap {
  bounds: AABB;
  spawns: { teams: [Vec3[], Vec3[]]; ffa: Vec3[] };
}

const DOWN: Vec3 = { x: 0, y: -1, z: 0 };

function allSpawns(map: DropMap): Vec3[] {
  return [...map.spawns.ffa, ...map.spawns.teams[0], ...map.spawns.teams[1]];
}

/** Mean spawn height: the map's ground level when nothing is under a point. */
export function spawnGround(map: DropMap): number {
  const s = allSpawns(map);
  return s.length ? s.reduce((a, p) => a + p.y, 0) / s.length : 0;
}

/** Highest surface a crate may land on: the highest spawn + `roofAbove`. */
export function roofLimit(map: DropMap): number {
  const s = allSpawns(map);
  return (s.length ? Math.max(...s.map((p) => p.y)) : 0) + MARKER.roofAbove;
}

/** The top surface under x,z (what a crate falling from the sky lands on), or `fallbackY` over nothing. */
export function groundTop(world: CollisionWorld, bounds: AABB, x: number, z: number, fallbackY: number): number {
  const top = bounds.max.y + 5;
  const hit = world.raycast({ x, y: top, z }, DOWN, top - bounds.min.y + 5, 'players');
  return hit ? hit.point.y : fallbackY;
}

export type DropReason = 'ok' | 'bounds' | 'covered' | 'roof' | 'solid' | 'lost';

export interface DropSpot {
  x: number;
  y: number;
  z: number;
  /** The crate comes down on the canister itself. */
  valid: boolean;
  /** Why it doesn't (the canister spot's problem), 'ok' when it does. */
  reason: DropReason;
}

const inBounds = (b: AABB, x: number, z: number) => x >= b.min.x + MARKER.edge && x <= b.max.x - MARKER.edge && z >= b.min.z + MARKER.edge && z <= b.max.z - MARKER.edge;

/**
 * Where the crate comes down for a canister that ended up at `rest` (thrown from `from`, the
 * thrower's feet). On the canister when it lies inside the map, under open sky, inside no wall and
 * not on a roof higher than anyone can climb. Otherwise the same clamp the old designator used,
 * plus a walk back: clamp into the map, then step from there toward the thrower to the first open
 * spot a crate fits on, at the canister's own level first (out from under a roof) and then at any
 * height under the roof limit (down off a roof); the thrower's own spot when nothing nearer works.
 */
export function resolveDrop(world: CollisionWorld, map: DropMap, rest: Vec3, from: Vec3, settled = true): DropSpot {
  const b = map.bounds;
  const fallbackY = spawnGround(map);
  const limit = roofLimit(map);
  let reason: DropReason = 'ok';
  if (!settled || rest.y < b.min.y - 1) reason = 'lost';
  else if (!inBounds(b, rest.x, rest.z)) reason = 'bounds';
  // Inside a wall: its centre is in a solid (resting against one, it can sit a few cm from it).
  else if (world.overlapping(rest.x, rest.y + 0.03, rest.z, 0.01, 0.02).length) reason = 'solid';
  else if (groundTop(world, b, rest.x, rest.z, fallbackY) > rest.y + MARKER.coverClear) reason = 'covered';
  else if (rest.y > limit) reason = 'roof';
  if (reason === 'ok') return { x: rest.x, y: groundTop(world, b, rest.x, rest.z, rest.y), z: rest.z, valid: true, reason };
  // Prefer spots at the canister's own level (out from under a roof onto the same floor), then any
  // surface low enough (off an unreachable roof down to the ground).
  const level = reason === 'lost' ? from.y : Math.min(rest.y, limit);
  const fits = (x: number, z: number, near: boolean): number | null => {
    if (!inBounds(b, x, z)) return null;
    const y = groundTop(world, b, x, z, fallbackY);
    if (y > limit || (near && Math.abs(y - level) > MARKER.coverClear)) return null;
    return world.overlapping(x, y + 0.05, z, MARKER.crateRadius, MARKER.crateHeight).length ? null : y;
  };
  const sx = clamp(rest.x, b.min.x + MARKER.edge, b.max.x - MARKER.edge);
  const sz = clamp(rest.z, b.min.z + MARKER.edge, b.max.z - MARKER.edge);
  const ex = clamp(from.x, b.min.x + MARKER.edge, b.max.x - MARKER.edge);
  const ez = clamp(from.z, b.min.z + MARKER.edge, b.max.z - MARKER.edge);
  const len = Math.hypot(ex - sx, ez - sz);
  const n = Math.max(1, Math.ceil(len / MARKER.searchStep));
  for (const near of [true, false]) {
    for (let i = 0; i <= n; i++) {
      const x = sx + ((ex - sx) * i) / n;
      const z = sz + ((ez - sz) * i) / n;
      const y = fits(x, z, near);
      if (y !== null) return { x, y, z, valid: false, reason };
    }
  }
  return { x: ex, y: groundTop(world, b, ex, ez, fallbackY), z: ez, valid: false, reason };
}
