/**
 * CoD-style spawn selection (owner: modes), unit-tested in tests/spawns.test.ts.
 *
 * Every candidate point is scored for the spawning player:
 *
 *   - hard: an enemy within `enemyNear` m (-150), or an enemy who can see the point (eye to eye,
 *     within `sightRange`: -100). A clean point always beats one that fails these.
 *   - danger: enemies within `facingRange` looking toward the point (even through a wall: they
 *     are about to come round the corner), scaled by how squarely and how close; enemies who
 *     would see the first steps out of the spawn (`exposeStep` m the way it faces).
 *   - distance: the nearest living enemy, capped (`farCap` m) so it doesn't always pick the far
 *     corner; FFA weighs it more (spawn far from everyone).
 *   - recent deaths near the point (the last `deathMemory` s): someone is camping there.
 *   - team modes: a small bonus for a living teammate 4-20 m away; never on top of anyone.
 *   - the mode's `prefer` (TDM: the team's spawn side, which flips when the enemy pushes in;
 *     DOM: near owned flags; HQ: a sensible distance from the HQ).
 *
 * No spawn protection: Black Ops had none, and a no-damage window lets people spawn, shoot and
 * walk away from a fight they lost. Good selection is the fix (DESIGN.md: BO1/MW2 feel).
 *
 * `recentSpawns(room, team)` (the last few places a team spawned) lets bots stay away from the
 * enemy's current spawn area (src/server/features/bots/brain.ts).
 */
import { PLAYER, type Team } from '../../../shared/constants';
import type { SpawnPoint } from '../../../shared/maps/types';
import type { Vec3 } from '../../../shared/math';
import { eyeOf } from '../../combat';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';

export const SPAWN_TUNING = {
  /** An enemy closer than this (m) rules a point out. */
  enemyNear: 12,
  /** Seconds ahead an enemy's movement is projected for the distance checks. */
  lookAhead: 1.5,
  /** Enemies further than this can't rule a point out by sight. */
  sightRange: 60,
  /** Enemies within this range looking toward a point make it dangerous. */
  facingRange: 40,
  /** Enemies within this range who would see the spawner's first `exposeStep` m out of the spawn. */
  exposeRange: 40,
  exposeStep: 3.5,
  /** cos of the half angle of "looking toward". */
  facingCos: Math.cos((40 * Math.PI) / 180),
  /** Deaths within `deathRadius` m in the last `deathMemory` s count against a point. */
  deathRadius: 10,
  deathMemory: 8,
  /** Nearest-enemy distance stops adding score past this. */
  farCap: 45,
  /** Points within this many score of the best are candidates (random pick among them). */
  margin: 8,
  maxCandidates: 3,
};

interface Track {
  deaths: { x: number; z: number; t: number }[];
  spawns: [{ x: number; y: number; z: number; t: number }[], { x: number; y: number; z: number; t: number }[]];
}

const tracks = new WeakMap<Room, Track>();

/** Start remembering deaths and spawns for a room (the modes feature calls this per room). */
export function trackSpawns(room: Room): Track {
  let t = tracks.get(room);
  if (t) return t;
  const track: Track = { deaths: [], spawns: [[], []] };
  tracks.set(room, track);
  room.bus.on('death', ({ victim }) => {
    track.deaths.push({ x: victim.move.x, z: victim.move.z, t: room.time });
    if (track.deaths.length > 40) track.deaths.splice(0, track.deaths.length - 40);
  });
  room.bus.on('spawn', ({ player }) => {
    if (player.team === null) return;
    const list = track.spawns[player.team];
    list.push({ x: player.move.x, y: player.move.y, z: player.move.z, t: room.time });
    if (list.length > 8) list.splice(0, list.length - 8);
  });
  room.bus.on('matchStart', () => {
    track.deaths.length = 0;
    track.spawns[0].length = 0;
    track.spawns[1].length = 0;
  });
  return track;
}

/** Where `team` has spawned lately (the last 8 spawns within 40 s), for bots avoiding spawn camps. */
export function recentSpawns(room: Room, team: Team): readonly Vec3[] {
  const t = tracks.get(room);
  if (!t) return [];
  return t.spawns[team].filter((s) => room.time - s.t < 40);
}

export interface ScoredSpawn {
  pt: SpawnPoint;
  score: number;
  /** An enemy is near or can see it. */
  unsafe: boolean;
}

/** Score every point of `pool` for `p` (best first). */
export function scoreSpawns(room: Room, p: PlayerState, pool: readonly SpawnPoint[], prefer: (pt: SpawnPoint) => number = () => 0): ScoredSpawn[] {
  const T = SPAWN_TUNING;
  const others = [...room.players.values()].filter((q) => q !== p && q.alive);
  const enemies = others.filter((q) => room.isEnemy(p, q));
  const mates = room.mode.teams ? others.filter((q) => !room.isEnemy(p, q)) : [];
  const deaths = (tracks.get(room)?.deaths ?? []).filter((d) => room.time - d.t < T.deathMemory);
  const ffa = !room.mode.teams;
  const eyes = enemies.map((e) => ({ e, eye: eyeOf(e), fx: -Math.sin(e.yaw), fz: -Math.cos(e.yaw) }));
  const out = pool.map((pt) => {
    let s = prefer(pt);
    let unsafe = false;
    let nearest = 80;
    const eye = { x: pt.x, y: pt.y + PLAYER.eye, z: pt.z };
    for (const { e, eye: ee, fx, fz } of eyes) {
      const dx = pt.x - e.move.x;
      const dz = pt.z - e.move.z;
      const d = Math.hypot(dx, dz);
      // Where they will be in a moment (running toward the point counts as near).
      const dAhead = Math.hypot(pt.x - (e.move.x + e.move.vx * T.lookAhead), pt.z - (e.move.z + e.move.vz * T.lookAhead));
      nearest = Math.min(nearest, d, dAhead);
      if (Math.min(d, dAhead) < T.enemyNear) {
        s -= 150;
        unsafe = true;
      } else if (d < T.sightRange && room.world.lineOfSight(ee, eye)) {
        s -= 100;
        unsafe = true;
      } else {
        if (d < T.facingRange) {
          const facing = (dx * fx + dz * fz) / (d || 1);
          if (facing > T.facingCos) s -= 18 * (1 - d / T.facingRange) * (0.5 + facing * 0.5);
        }
        // The first steps out of the spawn (a few metres the way it faces) in their view.
        if (d < T.exposeRange) {
          const ahead = { x: pt.x - Math.sin(pt.yaw) * T.exposeStep, y: eye.y, z: pt.z - Math.cos(pt.yaw) * T.exposeStep };
          if (room.world.lineOfSight(ee, ahead)) s -= 30;
        }
      }
    }
    s += Math.min(nearest, T.farCap) * (ffa ? 1.2 : 0.8);
    for (const d of deaths) {
      const dd = Math.hypot(d.x - pt.x, d.z - pt.z);
      if (dd < T.deathRadius) s -= 20 * (1 - (room.time - d.t) / T.deathMemory) * (1 - dd / (T.deathRadius * 1.5));
    }
    if (mates.length) {
      let m = 80;
      for (const q of mates) m = Math.min(m, Math.hypot(q.move.x - pt.x, q.move.z - pt.z));
      if (m > 4 && m < 20) s += 6;
    }
    for (const q of others) if (Math.hypot(q.move.x - pt.x, q.move.z - pt.z) < 1.2) s -= 1000;
    return { pt, score: s, unsafe };
  });
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** Process-wide tally of dynamic spawn picks, and how many had no safe point at all (tuning, tests). */
export const spawnStats = { picks: 0, unsafe: 0 };

/** The candidates to pick from: the best, plus any within `margin` of it (never an unsafe point when a safe one exists). */
export function spawnCandidates(scored: readonly ScoredSpawn[]): SpawnPoint[] {
  if (!scored.length) return [];
  const best = scored[0]!;
  spawnStats.picks++;
  if (best.unsafe) spawnStats.unsafe++;
  const out: SpawnPoint[] = [];
  for (const c of scored) {
    if (out.length >= SPAWN_TUNING.maxCandidates) break;
    if (c.score < best.score - SPAWN_TUNING.margin) break;
    if (c.unsafe && !best.unsafe) continue;
    out.push(c.pt);
  }
  return out;
}
