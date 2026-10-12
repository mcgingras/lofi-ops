/**
 * Bot roles and team spreading (pure, unit-tested in tests/bots.roles.test.ts).
 *
 * Each life a bot rolls a role, weighted by its skill:
 *
 *   lane       holds one of three lanes (bands across the spawn-to-spawn axis), works up it.
 *   flanker    takes an outer lane and pushes deep, toward the enemy's side.
 *   hunter     goes where the fighting is: recent fights, noises, radar contacts.
 *   objective  in objective modes, plays the objective first (DOM caps, plants, tags).
 *   camper     rare: holds a hotspot for a long time (never one overlooking the enemy spawn).
 *
 * Lanes are spread across the team: a bot takes the least-used lane, or (sometimes) joins one
 * teammate in a lane to make a pair, never a third. Goals teammates already head for, and paths
 * they already walk (a coarse usage grid that A* adds cost for), score lower, so squads spread
 * out instead of blobbing.
 */
import type { Team } from '../../../shared/constants';
import type { BotSkill } from '../../../shared/defs/bots';
import type { MapData } from '../../../shared/maps/types';
import type { Vec3 } from '../../../shared/math';

export type BotRole = 'lane' | 'flanker' | 'hunter' | 'objective' | 'camper';

/** Role weights for a bot: aggression favours flankers/hunters, objectivePlay the objective. */
export function roleWeights(skill: BotSkill, objectiveMode: boolean): Record<BotRole, number> {
  const a = skill.aggression;
  return {
    lane: 1.0,
    flanker: 0.25 + 0.6 * a,
    hunter: 0.3 + 0.6 * a,
    objective: objectiveMode ? 0.4 + 1.4 * skill.objectivePlay : 0,
    camper: 0.04 + 0.12 * (1 - a),
  };
}

export function rollRole(skill: BotSkill, objectiveMode: boolean, rnd: () => number): BotRole {
  const w = roleWeights(skill, objectiveMode);
  let total = 0;
  for (const k in w) total += w[k as BotRole];
  let r = rnd() * total;
  for (const k in w) {
    r -= w[k as BotRole];
    if (r <= 0) return k as BotRole;
  }
  return 'lane';
}

/**
 * The lane for a role given how many teammates hold each lane: the least used (outer lanes for
 * flankers), or with chance `pairChance` a lane that has exactly one teammate (a pair).
 */
export function pickLane(role: BotRole, counts: readonly [number, number, number], rnd: () => number, pairChance = 0.3): 0 | 1 | 2 {
  const lanes: (0 | 1 | 2)[] = role === 'flanker' ? [0, 2] : [0, 1, 2];
  if (role !== 'flanker' && rnd() < pairChance) {
    const singles = lanes.filter((l) => counts[l] === 1);
    if (singles.length) return singles[Math.floor(rnd() * singles.length)]!;
  }
  let min = Infinity;
  for (const l of lanes) min = Math.min(min, counts[l]);
  const least = lanes.filter((l) => counts[l] === min);
  return least[Math.floor(rnd() * least.length)]!;
}

export interface MapAxis {
  /** Midpoint between the team spawn centres, unit axis from team 0 to team 1, half-width of the lanes. */
  mx: number;
  mz: number;
  ax: number;
  az: number;
  /** Lane boundaries on the perpendicular coordinate (lane 0 below lo, 2 above hi). */
  lo: number;
  hi: number;
  /** Half the spawn-to-spawn distance. */
  half: number;
}

const axes = new WeakMap<MapData, MapAxis>();

/** The spawn-to-spawn axis and lane bands of a map (cached). */
export function mapAxis(map: MapData): MapAxis {
  let a = axes.get(map);
  if (a) return a;
  const c = (pts: readonly Vec3[]) => {
    let x = 0;
    let z = 0;
    for (const p of pts) {
      x += p.x;
      z += p.z;
    }
    return { x: x / Math.max(1, pts.length), z: z / Math.max(1, pts.length) };
  };
  const t0 = c(map.spawns.teams[0].length ? map.spawns.teams[0] : map.spawns.ffa);
  const t1 = c(map.spawns.teams[1].length ? map.spawns.teams[1] : map.spawns.ffa);
  let ax = t1.x - t0.x;
  let az = t1.z - t0.z;
  const len = Math.hypot(ax, az);
  if (len < 1) {
    ax = 1;
    az = 0;
  } else {
    ax /= len;
    az /= len;
  }
  const mx = (t0.x + t1.x) / 2;
  const mz = (t0.z + t1.z) / 2;
  const b = map.bounds;
  const perp = (x: number, z: number) => (x - mx) * -az + (z - mz) * ax;
  const ps = [perp(b.min.x, b.min.z), perp(b.max.x, b.min.z), perp(b.min.x, b.max.z), perp(b.max.x, b.max.z)];
  const pmin = Math.min(...ps) * 0.7;
  const pmax = Math.max(...ps) * 0.7;
  a = { mx, mz, ax, az, lo: pmin + (pmax - pmin) / 3, hi: pmin + ((pmax - pmin) * 2) / 3, half: Math.max(1, len / 2) };
  axes.set(map, a);
  return a;
}

/** Which lane (0, 1, 2) a point is in. */
export function laneOf(axis: MapAxis, p: { x: number; z: number }): 0 | 1 | 2 {
  const v = (p.x - axis.mx) * -axis.az + (p.z - axis.mz) * axis.ax;
  return v < axis.lo ? 0 : v > axis.hi ? 2 : 1;
}

/** -1 (team 0's spawn) .. 1 (team 1's spawn): how far along the axis a point is. */
export function depthOf(axis: MapAxis, p: { x: number; z: number }): number {
  return ((p.x - axis.mx) * axis.ax + (p.z - axis.mz) * axis.az) / axis.half;
}

/** A goal a bot has claimed (where it's heading and why), shared by its team's brains. */
export interface GoalClaim {
  team: Team | null;
  at: Vec3;
  kind: string;
  role: BotRole;
  lane: 0 | 1 | 2;
  t: number;
}

/**
 * Score penalty for heading to `at` given teammates' claims (`exclude` is the bot itself):
 * each teammate goal within `r` m costs `per`, scaled by closeness.
 */
export function crowdPenalty(claims: ReadonlyMap<string, GoalClaim>, team: Team | null, at: Vec3, exclude: string, now: number, r = 10, per = 3): number {
  let pen = 0;
  for (const [id, c] of claims) {
    if (id === exclude || c.team !== team || team === null || now - c.t > 20) continue;
    const d = Math.hypot(c.at.x - at.x, c.at.z - at.z);
    if (d < r) pen += per * (1 - d / r) + per * 0.5;
  }
  return pen;
}

/** Teammates already chasing/investigating near `at` (so the rest don't all rush it). */
export function chasersNear(claims: ReadonlyMap<string, GoalClaim>, team: Team | null, at: Vec3, exclude: string, now: number, r = 8): number {
  let n = 0;
  for (const [id, c] of claims) {
    if (id === exclude || team === null || c.team !== team || now - c.t > 10) continue;
    if ((c.kind === 'chase' || c.kind === 'heard' || c.kind === 'flank') && Math.hypot(c.at.x - at.x, c.at.z - at.z) < r) n++;
  }
  return n;
}

/**
 * Coarse per-team path usage (4 m tiles): paths teammates walk add weight, which A* turns into
 * extra cost, so the next bot takes another route.
 */
export class PathUsage {
  static readonly TILE = 4;
  private grids: [Float32Array, Float32Array] | null = null;
  private w = 0;
  private h = 0;
  private x0 = 0;
  private z0 = 0;
  private mine = new Map<string, { team: Team; tiles: number[] }>();

  constructor(map: MapData) {
    const b = map.bounds;
    this.x0 = b.min.x;
    this.z0 = b.min.z;
    this.w = Math.max(1, Math.ceil((b.max.x - b.min.x) / PathUsage.TILE));
    this.h = Math.max(1, Math.ceil((b.max.z - b.min.z) / PathUsage.TILE));
    this.grids = [new Float32Array(this.w * this.h), new Float32Array(this.w * this.h)];
  }

  tile(x: number, z: number): number {
    const tx = Math.min(this.w - 1, Math.max(0, Math.floor((x - this.x0) / PathUsage.TILE)));
    const tz = Math.min(this.h - 1, Math.max(0, Math.floor((z - this.z0) / PathUsage.TILE)));
    return tz * this.w + tx;
  }

  /** Replace bot `id`'s path (cells) in its team's usage. */
  set(id: string, team: Team | null, cells: readonly { x: number; z: number }[] | null): void {
    this.clear(id);
    if (team === null || !cells || !this.grids) return;
    const g = this.grids[team];
    const tiles: number[] = [];
    let last = -1;
    for (const c of cells) {
      const t = this.tile(c.x, c.z);
      if (t === last || tiles.includes(t)) continue;
      last = t;
      tiles.push(t);
      g[t]! += 1;
    }
    this.mine.set(id, { team, tiles });
  }

  clear(id: string): void {
    const m = this.mine.get(id);
    if (!m || !this.grids) return;
    const g = this.grids[m.team];
    for (const t of m.tiles) g[t] = Math.max(0, g[t]! - 1);
    this.mine.delete(id);
  }

  /** Teammate path weight on the tile under (x, z), not counting bot `id`'s own path. */
  usage(team: Team | null, x: number, z: number, id?: string): number {
    if (team === null || !this.grids) return 0;
    const t = this.tile(x, z);
    let u = this.grids[team][t]!;
    const m = id ? this.mine.get(id) : undefined;
    if (m && m.team === team && m.tiles.includes(t)) u -= 1;
    return u;
  }
}
