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
 * Valkyrie Rockets are two calls: `callKillstreak(room, bot, 'valkyrie')` sends the drop (for a bot
 * it comes down where it stands and the bot takes the crate on landing), which puts the launcher
 * (`VALKYRIE_LAUNCHER`) in its ready list; `callKillstreak(room, bot, VALKYRIE_LAUNCHER)` raises
 * it, and the feature aims, fires and steers both rockets for the bot.
 *
 * The Tactical Nuke goes through the same calls (`callKillstreak(room, bot, 'nuke')`, no target);
 * skilled bots call their highest streak first, so a bot that earns one uses it.
 *
 * Bots also use their streaks automatically (skill `streakUse`: how soon and how well), unless the
 * bots feature sets `player.ext.killstreaks.manual = true` to drive the calls itself.
 */
import type { MarkerLaunch } from '../../../shared/defs/care-marker';
import type { TurretSpot } from '../../../shared/defs/turret-place';
import { KILLSTREAK_BY_ID, streakAllowedIn } from '../../../shared/defs/killstreaks';
import type { Vec3 } from '../../../shared/math';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { botStreakSkill } from './skill';
import { ksOf, markDirty, stateMsg } from './state';
import { callNapalm, callThunder } from './streaks/airstrike';
import { callDogs } from './streaks/dogs';
import { airspaceFull, callGunner, callHeli } from './streaks/heli';
import { callMortar } from './streaks/mortar';
import { callNuke } from './streaks/nuke';
import { callCarePackage } from './streaks/package';
import { callRadar } from './streaks/radar';
import { callSam, callSentry } from './streaks/turrets';
import type { CallArgs } from './streaks/types';
import { callRcxd } from './streaks/vehicles';
import { callValkyrieDrop, raiseLauncher } from './streaks/valkyrie';
export { rocketTrack, type RocketTrack } from './streaks/valkyrie';
import { VALKYRIE_LAUNCHER } from '../../../shared/defs/valkyrie';
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
  valkyrie: callValkyrieDrop,
  attack_dogs: callDogs,
  nuke: callNuke,
};

export interface CallOptions {
  target?: Vec3 | null;
  targets?: Vec3[];
  /** Run direction for line strikes (default: the caller's yaw). */
  yaw?: number;
  /** A thrown marker leaving the hand (Care Package canister): the drop goes where it settles. */
  launch?: { throw: MarkerLaunch; from: Vec3 };
  /** Where a carried Sentry Gun / SAM Turret goes down (a valid `turretPlacement`); without it the turret picks its own spot (`autoTurretSpot`). */
  place?: TurretSpot;
}

/** Earned streaks waiting to be called, oldest first. */
export const readyKillstreaks = (p: PlayerState): string[] => [...(p.ext.killstreaks?.ready ?? [])];

/** The full ladder (what the HUD shows). */
export const killstreakState = (room: Room, p: PlayerState) => stateMsg(room, p);

/** True while the player drives / aims a streak (RC-XD, Chopper Gunner, Valkyrie). */
export const isDrivingStreak = (p: PlayerState): boolean => !!p.ext.killstreaks?.control;

/** True while holding the Valkyrie launcher (before, between and during its rockets). */
export const isHoldingLauncher = (p: PlayerState): boolean => !!p.ext.killstreaks?.launcher;

/** True while carrying a Sentry Gun / SAM Turret to place it (humans only: bots' turrets go straight down). */
export const isCarryingTurret = (p: PlayerState): boolean => !!p.ext.killstreaks?.carry;

/** True while designating targets (holding the marker canister, the radio with the tactical map up, or the old designator). */
export const isDesignating = (p: PlayerState): boolean => !!(p.ext.killstreaks?.armed || p.ext.killstreaks?.map || p.ext.killstreaks?.marker);

/**
 * Call a ready streak now. Targets default to where the player aims (point/line/marker), their
 * marks or aim (mortar). Placed turrets go to `place` (a carried turret's validated spot) or, for
 * bots and the RPC, a spot they pick in front of the caller facing likely enemies. The Care Package (`marker`)
 * takes either a `target` (bots: the crate comes there, a smoking canister marks it) or the
 * `launch` of a thrown canister (humans: STREAK raises it, FIRE throws it, index.ts).
 */
export function callKillstreak(room: Room, p: PlayerState, id: string, opts: CallOptions = {}): CallResult {
  // The Valkyrie launcher from a crate: it comes up in hand (FIRE launches; the first shot uses it).
  if (id === VALKYRIE_LAUNCHER) {
    if (room.phase !== 'playing') return { ok: false, reason: 'phase' };
    const why = raiseLauncher(room, p);
    return why ? { ok: false, reason: why } : { ok: true };
  }
  const def = KILLSTREAK_BY_ID.get(id);
  const impl = STREAK_IMPLS[id];
  if (!def || !impl) return { ok: false, reason: 'unknown' };
  if (!streakAllowedIn(def, room.mode)) return { ok: false, reason: 'disabled' };
  if (room.phase !== 'playing') return { ok: false, reason: 'phase' };
  if (!p.alive) return { ok: false, reason: 'dead' };
  const ks = ksOf(p);
  const idx = ks.ready.indexOf(id);
  if (idx < 0) return { ok: false, reason: 'not_ready' };
  if (ks.control || ks.launcher || ks.carry) return { ok: false, reason: 'busy' };
  const ctx = ksRoom(room);
  if ((id === 'attack_helicopter' || id === 'chopper_gunner') && airspaceFull(ctx)) return { ok: false, reason: 'airspace_full' };
  // Map-targeted streaks never fall back to the crosshair (humans choose on the tactical map, bots
  // pass `suggestTarget`); a patrol area defaults to the middle of the map.
  const fallback = def.targeting === 'map' ? (def.mapPick === 'area' ? ctx.center : null) : ctx.aimPoint(p);
  const target = opts.target ? ctx.clampToMap(opts.target) : opts.targets?.[0] ? ctx.clampToMap(opts.targets[0]) : fallback;
  const targets = (opts.targets?.length ? opts.targets : target ? [target] : []).map((t) => ctx.clampToMap(t));
  const aimed = def.targeting === 'point' || def.targeting === 'line' || def.targeting === 'points' || def.targeting === 'map' || def.targeting === 'marker';
  if (aimed && !targets.length && !(def.targeting === 'marker' && opts.launch)) return { ok: false, reason: 'no_target' };
  const reason = impl(ctx, p, { target: target ?? targets[0] ?? null, targets, yaw: opts.yaw ?? p.yaw, launch: def.targeting === 'marker' ? opts.launch : undefined, place: def.targeting === 'place' ? opts.place : undefined });
  if (reason) return { ok: false, reason };
  ks.ready.splice(idx, 1);
  ks.selected = Math.max(0, Math.min(ks.selected, ks.ready.length - 1));
  if (ks.armed?.id === id) ks.armed = null;
  if (ks.marker?.id === id) ks.marker = null;
  if (ks.map?.id === id) {
    room.entities.remove(ks.map.entity);
    ks.map = null;
  }
  markDirty(room, p);
  room.bus.emit('killstreaks.called', { player: p, id });
  room.bus.emit('progression.metric', { player: p, metric: 'streak_called', killstreak: id });
  // BO1 doesn't say a Valkyrie drop is one: it is announced as a Care Package (the rockets are announced at the first shot).
  room.sendFeature(null, 'killstreaks.called', { id: id === 'valkyrie' ? 'care_package' : id, owner: p.id, team: p.team });
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
  // Aim at what the bot knows: enemies on its radar or in sight. Knowing nobody, it guesses from
  // where everyone is with twice the error (players expect enemies near the action too).
  const all = [...room.players.values()].filter((q) => q.alive && room.isEnemy(p, q));
  const known = knownEnemies(room, p, all);
  const enemies = known.length ? known : all;
  const err = ((1 - skill) * 10 + 1) * (known.length ? 1 : 2);
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

/** Enemies `p` knows about: on its radar (Spy Plane, gunfire) or in line of sight within 90 m. */
export function knownEnemies(room: Room, p: PlayerState, enemies = [...room.players.values()].filter((q) => q.alive && room.isEnemy(p, q))): PlayerState[] {
  const radar = new Set(room.radarFor(p));
  const eye = { x: p.move.x, y: p.move.y + 1.5, z: p.move.z };
  return enemies.filter((q) => {
    if (radar.has(q.id)) return true;
    const c = chestOf(q);
    return Math.hypot(c.x - eye.x, c.z - eye.z) < 90 && room.world.lineOfSight(eye, c, 'sight');
  });
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
  if (id === 'rcxd' || id === 'chopper_gunner' || id === VALKYRIE_LAUNCHER) {
    // Not with an enemy right in its face.
    const eye = { x: p.move.x, y: p.move.y + 1.5, z: p.move.z };
    return !ctx.targetsFor(p, 'bot', eye, 15).length;
  }
  return true;
}

/** Automatic streak use for bots (every few ticks from the feature). */
export function botAutoStreaks(room: Room, p: PlayerState): void {
  const ks = p.ext.killstreaks;
  if (!ks || ks.manual || !p.alive || !ks.ready.length || ks.control || ks.armed || ks.map || ks.marker || ks.launcher || ks.carry) return;
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
