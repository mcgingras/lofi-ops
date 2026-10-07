/**
 * The killstreak API (owner: perks-streaks). Used by the STREAK button / RPCs for humans and by the
 * bots feature for bots:
 *
 *   import { callKillstreak, readyKillstreaks, enemyStreakTargets } from '../killstreaks/api';
 *   readyKillstreaks(bot)                         // ['uav', 'napalm']
 *   callKillstreak(room, bot, 'napalm', { target: enemyPos })   // { ok: true } | { ok: false, reason }
 *   suggestTarget(room, bot, 'mortar')            // where a bot of its skill would aim
 *   enemyStreakTargets(room, bot)                 // enemy hardware a bot can shoot at (heli, sentry, dogs...)
 *   isDrivingStreak(bot)                          // true while its RC-XD / gunner / rockets run
 *
 * Bots also use their streaks automatically (skill `streakUse`: how soon and how well), unless the
 * bots feature sets `player.ext.killstreaks.manual = true` to drive the calls itself.
 */
import { KILLSTREAK_BY_ID } from '../../../shared/defs/killstreaks';
import type { Vec3 } from '../../../shared/math';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { botStreakSkill } from './skill';
import { ksOf, markDirty, stateMsg } from './state';
import { callNapalm, callThunder } from './streaks/airstrike';
import { callDogs } from './streaks/dogs';
import { airspaceFull, callGunner, callHeli } from './streaks/heli';
import { callMortar } from './streaks/mortar';
import { callCarePackage } from './streaks/package';
import { callRadar } from './streaks/radar';
import { callSam, callSentry } from './streaks/turrets';
import type { CallArgs } from './streaks/types';
import { callRcxd, callValkyrie } from './streaks/vehicles';
import { chestOf, ksRoom, type KsRoom } from './world';

export type CallResult = { ok: true } | { ok: false; reason: string };

type Impl = (ctx: KsRoom, p: PlayerState, args: CallArgs) => string | null;

export const STREAK_IMPLS: Record<string, Impl> = {
  uav: (c, p, a) => callRadar(c, p, 'uav', a),
  counter_uav: (c, p, a) => callRadar(c, p, 'counter_uav', a),
  blackbird: (c, p, a) => callRadar(c, p, 'blackbird', a),
  care_package: callCarePackage,
  napalm: callNapalm,
  rolling_thunder: callThunder,
  mortar: callMortar,
  sentry_gun: callSentry,
  sam_turret: callSam,
  attack_helicopter: callHeli,
  chopper_gunner: callGunner,
  rcxd: callRcxd,
  valkyrie: callValkyrie,
  attack_dogs: callDogs,
};

export interface CallOptions {
  target?: Vec3 | null;
  targets?: Vec3[];
  /** Run direction for line strikes (default: the caller's yaw). */
  yaw?: number;
}

/** Earned streaks waiting to be called, oldest first. */
export const readyKillstreaks = (p: PlayerState): string[] => [...(p.ext.killstreaks?.ready ?? [])];

/** The full ladder (what the HUD shows). */
export const killstreakState = (room: Room, p: PlayerState) => stateMsg(room, p);

/** True while the player drives / aims a streak (RC-XD, Chopper Gunner, Valkyrie). */
export const isDrivingStreak = (p: PlayerState): boolean => !!p.ext.killstreaks?.control;

/** True while designating targets (holding the marker). */
export const isDesignating = (p: PlayerState): boolean => !!p.ext.killstreaks?.armed;

/**
 * Call a ready streak now. Targets default to where the player aims (point/line), their marks or
 * aim (mortar), or the spot in front of them (placed turrets).
 */
export function callKillstreak(room: Room, p: PlayerState, id: string, opts: CallOptions = {}): CallResult {
  const def = KILLSTREAK_BY_ID.get(id);
  const impl = STREAK_IMPLS[id];
  if (!def || !impl) return { ok: false, reason: 'unknown' };
  if (room.phase !== 'playing') return { ok: false, reason: 'phase' };
  if (!p.alive) return { ok: false, reason: 'dead' };
  const ks = ksOf(p);
  const idx = ks.ready.indexOf(id);
  if (idx < 0) return { ok: false, reason: 'not_ready' };
  if (ks.control) return { ok: false, reason: 'busy' };
  const ctx = ksRoom(room);
  if ((id === 'attack_helicopter' || id === 'chopper_gunner') && airspaceFull(ctx)) return { ok: false, reason: 'airspace_full' };
  const aim = ctx.aimPoint(p);
  const target = opts.target ? ctx.clampToMap(opts.target) : aim;
  const targets = (opts.targets?.length ? opts.targets : target ? [target] : []).map((t) => ctx.clampToMap(t));
  if ((def.targeting === 'point' || def.targeting === 'line' || def.targeting === 'points') && !targets.length) return { ok: false, reason: 'no_target' };
  const reason = impl(ctx, p, { target: target ?? targets[0] ?? null, targets, yaw: opts.yaw ?? p.yaw });
  if (reason) return { ok: false, reason };
  ks.ready.splice(idx, 1);
  ks.selected = Math.max(0, Math.min(ks.selected, ks.ready.length - 1));
  if (ks.armed?.id === id) ks.armed = null;
  markDirty(room, p);
  room.bus.emit('killstreaks.called', { player: p, id });
  room.sendFeature(null, 'killstreaks.called', { id, owner: p.id, team: p.team });
  return { ok: true };
}

/** Enemy killstreak hardware `p` could shoot at (for bot brains). */
export function enemyStreakTargets(room: Room, p: PlayerState): { entity: number; kind: string; streak: string; x: number; y: number; z: number; air: boolean; hp: number }[] {
  const ctx = ksRoom(room);
  const out = [];
  for (const [id, d] of ctx.hp) {
    if (ctx.sameSide(p, d.active.owner)) continue;
    const e = room.entities.get(id);
    if (!e) continue;
    out.push({ entity: id, kind: e.kind, streak: d.active.streak, x: e.x, y: e.y + d.yOff, z: e.z, air: d.air, hp: d.hp });
  }
  return out;
}

/**
 * Where a bot of this skill would aim a targeted streak: at the densest group of enemies it knows
 * of (with an error that shrinks with skill), else a map hotspot.
 */
export function suggestTarget(room: Room, p: PlayerState, id: string, skill = botStreakSkill(p)): { target: Vec3 | null; targets: Vec3[]; yaw: number } {
  const ctx = ksRoom(room);
  const enemies = [...room.players.values()].filter((q) => q.alive && room.isEnemy(p, q));
  const err = (1 - skill) * 10 + 1;
  const jitter = (v: Vec3): Vec3 => ctx.clampToMap({ x: v.x + (Math.random() - 0.5) * err, y: v.y, z: v.z + (Math.random() - 0.5) * err });
  const spots = room.map.hotspots?.length ? room.map.hotspots : [ctx.center];
  // Score each enemy by how many others are near it (low-skill bots just pick anyone).
  const scored = enemies
    .map((e) => ({ e, n: skill < 0.3 ? Math.random() : enemies.filter((o) => Math.hypot(o.move.x - e.move.x, o.move.z - e.move.z) < 8).length + Math.random() * 0.5 }))
    .sort((a, b) => b.n - a.n);
  const pick = (i: number): Vec3 => (scored.length ? jitter(scored[i % scored.length]!.e.move) : jitter(spots[Math.floor(Math.random() * spots.length)]!));
  const def = KILLSTREAK_BY_ID.get(id);
  const marks = def?.marks ?? 1;
  const targets = Array.from({ length: marks }, (_, i) => pick(i));
  const target = targets[0] ?? null;
  // Line strikes run along the enemies' spread if there are two, else from the bot toward the target.
  let yaw = p.yaw;
  if (target) {
    const second = scored[1]?.e.move;
    yaw = second && skill > 0.5 ? Math.atan2(-(second.x - target.x), -(second.z - target.z)) : Math.atan2(-(target.x - p.move.x), -(target.z - p.move.z));
  }
  return { target, targets, yaw };
}

/** Seconds a bot waits after earning a streak before calling it (lower skill = slower, less sure). */
export const botCallDelay = (skill: number) => 1.5 + (1 - skill) * 14 * (0.6 + Math.random() * 0.8);

/**
 * Whether calling `id` is sensible now for a bot of this skill. Skilled bots hold a SAM until enemy
 * air is up and a Counter-Spy Plane until the enemy has radar; unskilled ones fire them off anyway.
 */
export function botWants(room: Room, p: PlayerState, id: string, skill: number): boolean {
  const ctx = ksRoom(room);
  if (skill < 0.5) return true;
  if (id === 'sam_turret') return enemyStreakTargets(room, p).some((t) => t.air);
  if (id === 'counter_uav') return ctx.actives.some((a) => !a.done && (a.streak === 'uav' || a.streak === 'blackbird') && room.isEnemy(a.owner, p)) || Math.random() < 0.02;
  if (id === 'rcxd' || id === 'chopper_gunner' || id === 'valkyrie') {
    // Not with an enemy right in its face.
    const eye = { x: p.move.x, y: p.move.y + 1.5, z: p.move.z };
    return !ctx.targetsFor(p, 'bot', eye, 15).length;
  }
  return true;
}

/** Automatic streak use for bots (every few ticks from the feature). */
export function botAutoStreaks(room: Room, p: PlayerState): void {
  const ks = p.ext.killstreaks;
  if (!ks || ks.manual || !p.alive || !ks.ready.length || ks.control || ks.armed) return;
  const skill = botStreakSkill(p);
  ks.botNextCall ??= room.time + botCallDelay(skill);
  if (room.time < ks.botNextCall) return;
  // Highest-value streak first for skilled bots; oldest first otherwise.
  const order = skill >= 0.5 ? [...ks.ready].sort((a, b) => (KILLSTREAK_BY_ID.get(b)?.kills ?? 0) - (KILLSTREAK_BY_ID.get(a)?.kills ?? 0)) : [...ks.ready];
  for (const id of order) {
    if (!botWants(room, p, id, skill)) continue;
    const res = callKillstreak(room, p, id, suggestTarget(room, p, id, skill));
    if (res.ok) {
      ks.botNextCall = room.time + 2 + (1 - skill) * 6;
      return;
    }
  }
  ks.botNextCall = room.time + 3;
}

/** Nearest enemy chest for bot aim helpers. */
export const chestPoint = chestOf;
