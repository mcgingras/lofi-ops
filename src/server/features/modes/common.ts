/**
 * Shared machinery for the modes feature's rules: the per-room controller registry (what the HUD
 * state push, bot hooks and the summary read), scoring/award helpers that keep a per-reason tally
 * for the XP breakdown, announcer events, spawn ranking and objective points (from MapData, or
 * derived from spawns when a map has none for a mode).
 */
import './ext';
import { MODE_TUNING } from '../../../shared/defs/modes';
import type { ModeEventPayload, ModeStatePayload } from '../../../shared/defs/modestate';
import { XP_SOURCES } from '../../../shared/defs/progression';
import type { Team } from '../../../shared/constants';
import { PLAYER } from '../../../shared/constants';
import type { DeathEvent } from '../../../shared/events';
import type { MapData, ObjectivePoint, SpawnPoint } from '../../../shared/maps/types';
import { buildCollisionWorld } from '../../../shared/maps/types';
import type { Vec3 } from '../../../shared/math';
import { eyeOf } from '../../combat';
import type { ModeRules } from '../../modes/types';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import type { ModePlayerExt } from './ext';
import type { BotObjective } from './bots';
import { scoreSpawns, spawnCandidates } from './spawns';

// ---------------------------------------------------------------------------------------------
// Controller registry
// ---------------------------------------------------------------------------------------------

/** What every rules object of this feature also provides. */
export interface ModeController {
  readonly rules: ModeRules;
  /** Team-relative objective state for one viewer (null = nothing to show). */
  state(viewer: PlayerState): ModeStatePayload | null;
  /** Objectives a bot on `p`'s side should care about, best first. */
  objectives(p: PlayerState): BotObjective[];
  /** Objective stat keys shown on the summary for this mode (e.g. ['captures', 'defends']). */
  readonly statKeys: readonly string[];
  /** Set when something changed that clients should see before the next periodic push. */
  dirty: boolean;
}

const controllers = new WeakMap<Room, ModeController>();

export function setController(room: Room, c: ModeController): void {
  controllers.set(room, c);
}

/** The active controller of a room (null when its current rules are not ours, e.g. a wager mode). */
export function controllerOf(room: Room): ModeController | null {
  const c = controllers.get(room);
  return c && c.rules === room.rules ? c : null;
}

// ---------------------------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------------------------

export function modeExt(p: PlayerState): ModePlayerExt {
  return (p.ext.modes ??= { stats: {}, xp: {} });
}

export function resetModeExt(room: Room): void {
  for (const p of room.players.values()) p.ext.modes = { stats: {}, xp: {} };
}

/** Count an objective stat (captures, plants...) without score. */
export function bumpModeStat(p: PlayerState, stat: string, n = 1): void {
  const s = modeExt(p).stats;
  s[stat] = (s[stat] ?? 0) + n;
}

/** Give player score for `reason` (tallied for the XP breakdown), optionally bumping a stat. */
export function award(room: Room, p: PlayerState, reason: string, xp: number, stat?: string): void {
  if (room.phase !== 'playing') return;
  if (stat) bumpModeStat(p, stat);
  if (xp <= 0) return;
  const t = modeExt(p).xp;
  t[reason] = (t[reason] ?? 0) + xp;
  room.addPlayerScore(p, xp, reason);
}

/** True if `e` is a kill by an enemy (not a suicide, world death or teamkill). */
export const isEnemyKill = (room: Room, e: DeathEvent<PlayerState>): e is DeathEvent<PlayerState> & { attacker: PlayerState } =>
  !!e.attacker && e.attacker !== e.victim && room.isEnemy(e.attacker, e.victim);

/** Standard kill scoring: kill +100, headshot +50, assists +50; optionally +1 team score. */
export function scoreKill(room: Room, e: DeathEvent<PlayerState>, teamPoint: boolean): boolean {
  if (!isEnemyKill(room, e)) return false;
  const a = e.attacker;
  award(room, a, 'kill', XP_SOURCES.kill);
  if (e.headshot) award(room, a, 'headshot', XP_SOURCES.headshot);
  for (const s of e.assisters) award(room, s, 'assist', XP_SOURCES.assist);
  if (teamPoint && a.team !== null) room.addTeamScore(a.team, 1, 'kill', a);
  return true;
}

/**
 * Announce to everyone (`modes.event`) and emit the core `objective` event. `onlyTeam` limits the
 * push to one team (S&D bomb pickups/drops are not told to the defenders).
 */
export function announce(room: Room, ev: ModeEventPayload, player: PlayerState | null = null, onlyTeam: Team | null = null): void {
  if (onlyTeam === null) room.sendFeature(null, 'modes.event', ev);
  else for (const p of room.players.values()) if (p.team === onlyTeam) room.sendFeature(p, 'modes.event', ev);
  room.bus.emit('objective', { kind: ev.kind, team: ev.team, player, data: { obj: ev.obj, reason: ev.reason, points: ev.points } });
  const c = controllerOf(room);
  if (c) c.dirty = true;
}

export const otherTeam = (t: Team): Team => (t === 0 ? 1 : 0);

export function teamCounts(room: Room): { total: [number, number]; alive: [number, number] } {
  const total: [number, number] = [0, 0];
  const alive: [number, number] = [0, 0];
  for (const p of room.players.values()) {
    if (p.team === null) continue;
    total[p.team] += 1;
    if (p.alive) alive[p.team] += 1;
  }
  return { total, alive };
}

/** Alive players standing in a cylinder zone, split by team. */
export function playersIn(room: Room, at: Vec3, r: number, height: number): [PlayerState[], PlayerState[]] {
  const out: [PlayerState[], PlayerState[]] = [[], []];
  for (const p of room.players.values()) {
    if (!p.alive || p.team === null) continue;
    if (Math.hypot(p.move.x - at.x, p.move.z - at.z) > r) continue;
    if (Math.abs(p.move.y - at.y) > height) continue;
    out[p.team].push(p);
  }
  return out;
}

export const near2D = (a: Vec3, b: Vec3, r: number) => Math.hypot(a.x - b.x, a.z - b.z) <= r;

// ---------------------------------------------------------------------------------------------
// Spawns
// ---------------------------------------------------------------------------------------------

/** True while a match is in its first seconds (players use their team's own spawns). */
export function initialSpawnWindow(room: Room): boolean {
  return room.phase === 'countdown' || room.time - room.matchStartTime < MODE_TUNING.spawn.initialSec;
}

/**
 * Rank a spawn pool for `p` (spawns.ts: enemy sight and distance, enemies facing it, recent
 * deaths, teammates) plus a mode preference (`prefer`, higher is better). Returns the few best
 * (never one in enemy view or next to an enemy when a clean one exists); core's pickSpawn then
 * picks among them.
 */
export function rankSpawns(room: Room, p: PlayerState, pool: readonly SpawnPoint[], prefer: (pt: SpawnPoint) => number = () => 0): SpawnPoint[] {
  if (pool.length <= 1) return [...pool];
  return spawnCandidates(scoreSpawns(room, p, pool, prefer));
}

/** Every spawn point of a map (team + FFA), for dynamic spawning. */
export function allSpawns(map: MapData): SpawnPoint[] {
  return [...map.spawns.teams[0], ...map.spawns.teams[1], ...map.spawns.ffa];
}

// ---------------------------------------------------------------------------------------------
// Objective points
// ---------------------------------------------------------------------------------------------

const derivedCache = new WeakMap<MapData, Map<string, ObjectivePoint[]>>();

const centroid = (pts: readonly { x: number; y: number; z: number }[]): Vec3 => {
  if (!pts.length) return { x: 0, y: 0, z: 0 };
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  return { x: x / pts.length, y: y / pts.length, z: z / pts.length };
};

/** Nearest free standing spot to (x, z): spiral search on the ground. */
export function findStandSpot(map: MapData, x: number, z: number, y = 0): Vec3 {
  const world = buildCollisionWorld(map);
  for (let ring = 0; ring <= 12; ring++) {
    const steps = ring === 0 ? 1 : ring * 8;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const px = x + Math.cos(a) * ring * 0.75;
      const pz = z + Math.sin(a) * ring * 0.75;
      const g = world.groundBelow(px, pz, y + 6, 12);
      if (g === null) continue;
      if (world.free(px, g + 0.05, pz)) return { x: px, y: g, z: pz };
    }
  }
  return { x, y, z };
}

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

function derive(map: MapData, kind: string): ObjectivePoint[] {
  const c0 = centroid(map.spawns.teams[0]);
  const c1 = centroid(map.spawns.teams[1]);
  const mid = map.hotspots?.[0] ?? lerp3(c0, c1, 0.5);
  const pt = (id: string, p: Vec3, radius: number, team?: 0 | 1): ObjectivePoint => {
    const s = findStandSpot(map, p.x, p.z, p.y);
    return { id, x: s.x, y: s.y, z: s.z, radius, ...(team !== undefined ? { team } : {}) };
  };
  if (kind === 'dom') return [pt('A', lerp3(c0, mid, 0.3), 3), pt('B', mid, 3), pt('C', lerp3(c1, mid, 0.3), 3)];
  if (kind === 'sd') {
    // Two sites on the defenders' (team 1) half, either side of the centre line.
    const dx = c1.x - c0.x;
    const dz = c1.z - c0.z;
    const l = Math.hypot(dx, dz) || 1;
    const px = -dz / l;
    const pz = dx / l;
    const base = lerp3(c1, mid, 0.4);
    const off = Math.max(6, l * 0.3);
    return [pt('A', { x: base.x + px * off, y: base.y, z: base.z + pz * off }, 2.5, 1), pt('B', { x: base.x - px * off, y: base.y, z: base.z - pz * off }, 2.5, 1)];
  }
  if (kind === 'hq') {
    const src: Vec3[] = map.hotspots && map.hotspots.length >= 3 ? map.hotspots : [...derive(map, 'dom'), ...map.spawns.ffa.filter((_, i) => i % 3 === 0)];
    return src.slice(0, 8).map((p, i) => pt(`HQ${i + 1}`, p, 3));
  }
  return [];
}

/** Objective points of a kind for the room's map (MapData first, else derived and cached). */
export function objectivePoints(map: MapData, kind: string): ObjectivePoint[] {
  const own = map.objectives[kind];
  if (own && own.length) return own;
  let m = derivedCache.get(map);
  if (!m) derivedCache.set(map, (m = new Map()));
  let pts = m.get(kind);
  if (!pts) m.set(kind, (pts = derive(map, kind)));
  return pts;
}

/** Ground height under an objective point (points are authored at y = 0 on flat maps). */
export function groundAt(room: Room, x: number, z: number, y: number): number {
  return room.world.groundBelow(x, z, y + 2, 6) ?? y;
}

/** Room-time rounded for the wire. */
export const qt = (t: number) => Math.round(t * 1000) / 1000;
export const q2 = (v: number) => Math.round(v * 100) / 100;
