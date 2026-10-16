/**
 * Firing, damage, death and respawn. Hitscan is lag compensated: targets are rewound to the
 * shooter's view time (clamped to MAX_REWIND_MS); the world is hit first, then hitboxes. A shot at
 * the present (bots) uses where everyone is now. `traceShot` traces a shot without firing it.
 * Human shots go through thin walls (`shared/penetration.ts`): less damage and range per wall, at
 * most two walls; bots' shots stop on the first wall, as they fire only with a clear path.
 *
 * Extension points:
 *   - `registerWeaponBehavior(idOrClass, behavior)`: replace hitscan for a weapon id or class
 *     (launchers, knives, crossbows...). The behaviour gets the validated shot and does its thing
 *     (spawn an entity, radiusDamage, ...).
 *   - bus events `beforeDamage` (mutable), `damage`, `death`, `fire`, `reload`, `weaponSwitch`,
 *     `beforeSpawn` (mutable loadout/point), `spawn`.
 *   - modifiers: damageTaken, damageDealt, reloadMultiplier, swapMultiplier, sprintOutMultiplier,
 *     spreadMultiplier, regenDelayMultiplier, maxHealthMultiplier, penetrationMultiplier.
 */
import { damageAtRange, isLowerTorso, partMultiplier, shotInterval, shotSeed, spreadDegrees, spreadDirection, stanceSpread } from '../shared/ballistics';
import { poseHitboxes, poseStance, rayHitboxes, type HitPart, type Solid } from '../shared/collision';
import { HEALTH, PLAYER, RESPAWN_DELAY } from '../shared/constants';
import type { DamageInfo, DamageMeans } from '../shared/events';
import { cloneLoadout, DEFAULT_LOADOUTS, sanitizeLoadout, type Loadout } from '../shared/loadout';
import type { SpawnPoint } from '../shared/maps/types';
import { blastDistance, blastExposure, type BlastBody } from '../shared/blast';
import { dist, normalize, type Vec3 } from '../shared/math';
import { effectiveDistance, keepAt, penetrationMaterial, penetrationType, traceBullet, type WallPass } from '../shared/penetration';
import { bodyHeight, createMoveState, eyeHeight, moveBusy, movePose } from '../shared/movement';
import { q3 } from '../shared/protocol';
import { HitboxHistory, type Pose } from './lagcomp';
import { currentWeapon, makeWeapon, type PlayerState, type WeaponState } from './player';
import type { Room } from './room';

const DEFAULT_RANGE = 200;
/** Client origin is accepted if within this distance of the server eye; otherwise the server eye is used. */
const ORIGIN_TOLERANCE = 0.75;
/** Fire-rate tolerance: shots may arrive this fraction of an interval early (network bunching). */
const RATE_SLACK = 0.25;

export interface ShotRequest {
  /** Room time the shooter was viewing others at. */
  time: number;
  origin: Vec3 | null;
  /** Aim direction before spread. */
  dir: Vec3;
  /** Shot counter for the spread seed. */
  shot: number;
}

export interface WeaponBehavior {
  /** Called instead of hitscan after rate/ammo validation (ammo already consumed). */
  fire(room: Room, player: PlayerState, weapon: WeaponState, shot: ShotRequest & { origin: Vec3 }): void;
}

const behaviors = new Map<string, WeaponBehavior>();
/** Override hitscan for a weapon id ('m72law') or a weapon class ('launcher'). Id wins over class. */
export function registerWeaponBehavior(idOrClass: string, behavior: WeaponBehavior): void {
  behaviors.set(idOrClass, behavior);
}

/** Eye position on the server. */
export const eyeOf = (p: PlayerState): Vec3 => ({ x: p.move.x, y: p.move.y + eyeHeight(p.move), z: p.move.z });

export type FireResult = { ok: true } | { ok: false; reason: string };

/** Validate and perform one trigger pull. */
export function fire(room: Room, p: PlayerState, req: ShotRequest): FireResult {
  if (room.phase !== 'playing') return { ok: false, reason: 'phase' };
  if (!p.alive) return { ok: false, reason: 'dead' };
  const w = currentWeapon(p);
  if (!w) return { ok: false, reason: 'no_weapon' };
  const now = room.time;
  const def = w.def;
  if (now < p.swapEnd) return { ok: false, reason: 'switching' };
  if (p.reloadEnd > 0) return { ok: false, reason: 'reloading' };
  if (w.mag <= 0) {
    startReload(room, p);
    return { ok: false, reason: 'empty' };
  }
  const sprintOut = (def.sprintOutMs / 1000) * room.modifiers.mul('sprintOutMultiplier', p);
  if (p.move.sprinting || p.move.sinceSprint + 0.05 < sprintOut) return { ok: false, reason: 'sprinting' };
  // Mantling, diving, or going to / getting up from prone: the weapon is down.
  if (moveBusy(p.move)) return { ok: false, reason: 'stance' };

  // Rate: a token bucket refilling at the weapon's rate, a little slack for network bunching.
  const interval = shotInterval(def) / room.modifiers.mul('fireRateMultiplier', p);
  // Burst weapons: at most `burst` rounds, then `burstDelayMs` before the next burst.
  if (def.mode === 'burst') {
    if (now - w.lastShot >= (def.burstDelayMs ?? 0) / 1000 - interval * RATE_SLACK) w.burstCount = 0;
    else if (w.burstCount >= (def.burst ?? 3)) return { ok: false, reason: 'burst' };
  }
  w.credit = Math.min(1 + RATE_SLACK, w.credit + (now - w.creditTime) / interval);
  w.creditTime = now;
  if (w.credit < 1 - RATE_SLACK) return { ok: false, reason: 'rate' };
  w.credit -= 1;

  w.mag -= 1;
  w.burstCount += 1;
  w.lastShot = now;
  p.lastFireTime = now;
  p.lastFireSuppressed = def.suppressed;

  const eye = eyeOf(p);
  const origin = req.origin && dist(req.origin, eye) <= ORIGIN_TOLERANCE ? req.origin : eye;
  const dir = normalize(req.dir);

  const behavior = behaviors.get(def.id) ?? behaviors.get(def.class);
  if (behavior) {
    behavior.fire(room, p, w, { ...req, origin, dir });
    if (w.mag <= 0) startReload(room, p);
    return { ok: true };
  }

  // Hitscan, lag compensated. A shot at the present (bots: `room.fire` passes room.time) hits
  // where everyone is now: the history's newest frame is the previous tick, a tick behind.
  const viewTime = HitboxHistory.clampTime(req.time, now);
  const poses = viewTime >= now ? null : room.history.rewind(viewTime);
  const traced = traceShot(room, p, origin, dir, req.shot, poses);
  const perVictim = new Map<PlayerState, { damage: number; part: HitPart; distance: number; penetrated: boolean }>();
  const first = traced[0]!;
  const end: Vec3 = { x: origin.x + first.dir.x * first.t, y: origin.y + first.dir.y * first.t, z: origin.z + first.dir.z * first.t };
  let hitAny = false;
  for (const pel of traced) {
    if (!pel.victim) continue;
    hitAny = true;
    // Through walls: each one keeps part of the damage and stretches the falloff distance.
    const dmg = damageAtRange(def, pel.range) * partMultiplier(def, pel.part, pel.lower) * pel.keep;
    const through = pel.walls.length > 0;
    const acc = perVictim.get(pel.victim);
    if (acc) {
      acc.damage += dmg;
      acc.penetrated &&= through;
      if (pel.part === 'head') acc.part = 'head';
    } else perVictim.set(pel.victim, { damage: dmg, part: pel.part, distance: pel.t, penetrated: through });
  }

  const hits: { victim: PlayerState; part: HitPart; damage: number; penetrated: boolean }[] = [];
  for (const [victim, h] of perVictim) {
    const dealt = damage(room, { victim, attacker: p, amount: h.damage, weapon: def.base.id, part: h.part, means: 'bullet', from: origin, distance: h.distance, ...(h.penetrated ? { penetrated: true } : {}) });
    hits.push({ victim, part: h.part, damage: dealt, penetrated: h.penetrated });
  }
  // The first pellet's walls (entry and exit points): impact effects on both sides, replays.
  const walls = first.walls.flatMap((w) => [w.point, w.exit]);
  const wire = walls.flatMap((v) => [q3(v.x), q3(v.y), q3(v.z)]);
  room.recordShot({ p: p.id, o: [q3(origin.x), q3(origin.y), q3(origin.z)], e: [q3(end.x), q3(end.y), q3(end.z)], w: def.base.id, ...(hitAny ? { h: 1 as const } : {}), ...(wire.length ? { x: wire } : {}) });
  room.bus.emit('fire', { player: p, weapon: def.base.id, origin, dir, hits, end, walls });
  if (w.mag <= 0) startReload(room, p);
  return { ok: true };
}

/** One pellet of a traced shot: its direction, where it stopped (t), and whom it hit there. */
export interface Pellet {
  dir: Vec3;
  /** Distance to the hit (the victim's hitbox, else the wall that stopped it, else the weapon's range). */
  t: number;
  victim: PlayerState | null;
  part: HitPart;
  /** Lower torso (for weapons with a lower-torso multiplier). */
  lower: boolean;
  /** Walls it went through before `t` (human shots only). */
  walls: WallPass[];
  /** Damage kept through those walls (1 with none). */
  keep: number;
  /** Distance for damage falloff (`t`, stretched past each wall). */
  range: number;
}

/**
 * The pellets of one trigger pull of `p`'s current weapon: spread around `dir` by the shot seed
 * (`shot`), through the walls a human's bullet can pass and stopped by the next ('bullets' mask,
 * `traceBullet`; a bot's stop on the first), then the nearest hitbox at `poses` (a rewound frame,
 * or null for where everyone is now). `fire` uses it; bots call it to check a shot before taking
 * it. Pure: no ammo, no damage.
 */
export function traceShot(room: Room, p: PlayerState, origin: Vec3, dir: Vec3, shot: number, poses: Map<string, Pose> | null = null): Pellet[] {
  const def = currentWeapon(p)?.def;
  if (!def) return [];
  const moving = Math.hypot(p.move.vx, p.move.vz) > 0.5;
  const spread = spreadDegrees(def, p.move.ads, moving, room.modifiers.mul('spreadMultiplier', p) * stanceSpread(p.move));
  const range = def.range ?? DEFAULT_RANGE;
  const type = p.isBot ? 'none' : penetrationType(def);
  const depthMultiplier = type === 'none' ? 1 : room.modifiers.mul('penetrationMultiplier', p);
  const materialOf = (s: Solid) => penetrationMaterial(room.map, s.mat);
  const out: Pellet[] = [];
  for (let i = 0; i < Math.max(1, def.pellets ?? 1); i++) {
    const d = spreadDirection(dir, spread, shotSeed(p.seed, shot, i));
    const path = traceBullet(room.world, materialOf, origin, d, { range, type, depthMultiplier });
    let maxT = path.t;
    let victim: PlayerState | null = null;
    let part: HitPart = 'torso';
    let lower = false;
    for (const q of room.players.values()) {
      if (q === p || !q.alive || !room.canDamage(p, q)) continue;
      const pose = poses?.get(q.id) ?? { ...movePose(q.move, q.yaw), alive: true };
      if (!pose.alive) continue;
      const hit = rayHitboxes(origin, d, poseHitboxes(pose), maxT);
      if (hit) {
        maxT = hit.t;
        victim = q;
        part = hit.part;
        lower = part === 'torso' && isLowerTorso(pose, poseStance(pose), origin.y + d.y * hit.t);
      }
    }
    const walls = path.walls.filter((w) => w.tIn < maxT);
    out.push({ dir: d, t: maxT, victim, part, lower, walls, keep: keepAt(walls, maxT), range: effectiveDistance(walls, maxT) });
  }
  return out;
}

/**
 * Apply damage through modifiers and `beforeDamage`. Returns the damage actually dealt. Kills
 * when health reaches 0. Friendly fire is off (room.canDamage).
 */
export function damage(room: Room, info: DamageInfo<PlayerState>): number {
  const { victim, attacker } = info;
  if (!victim.alive || room.phase !== 'playing') return 0;
  if (attacker && attacker !== victim && !room.canDamage(attacker, victim)) return 0;
  let amount = info.amount * room.modifiers.mul('damageTaken', victim, info);
  if (attacker) amount *= room.modifiers.mul('damageDealt', attacker, info);
  const ev = { ...info, amount, cancel: false };
  room.bus.emit('beforeDamage', ev);
  if (ev.cancel || !(ev.amount > 0)) return 0;
  const dealt = Math.min(victim.health, ev.amount);
  victim.health = Math.max(0, victim.health - ev.amount);
  victim.lastDamageTime = room.time;
  if (attacker && attacker !== victim) victim.damageLog.push({ attacker, amount: dealt, time: room.time });
  room.bus.emit('damage', { ...ev, health: victim.health });
  const killed = victim.health <= 0;
  victim.session?.send({ t: 'hurt', attacker: attacker?.id ?? null, amount: q3(ev.amount), from: ev.from ? [q3(ev.from.x), q3(ev.from.y), q3(ev.from.z)] : null, health: Math.ceil(victim.health) });
  if (attacker && attacker !== victim) attacker.session?.send({ t: 'hit', victim: victim.id, part: ev.part ?? 'torso', damage: q3(dealt), kill: killed, ...(ev.penetrated ? { pen: true } : {}) });
  if (killed) kill(room, victim, attacker, { weapon: ev.weapon, part: ev.part, means: ev.means, distance: ev.distance, penetrated: ev.penetrated });
  return dealt;
}

/** Kill a player (credit, assists, streaks, killfeed, respawn timer, `death` event). */
export function kill(room: Room, victim: PlayerState, attacker: PlayerState | null, how: { weapon: string; part?: HitPart | null; means: DamageMeans; distance?: number; penetrated?: boolean }): void {
  if (!victim.alive) return;
  victim.alive = false;
  victim.health = 0;
  victim.diedAt = room.time;
  victim.reloadEnd = 0;
  const victimStreak = victim.stats.streak;
  victim.stats.deaths += 1;
  victim.stats.streak = 0;

  const credited = !!attacker && attacker !== victim && room.isEnemy(attacker, victim);
  const headshot = how.part === 'head' && how.means === 'bullet';
  const penetrated = !!how.penetrated && how.means === 'bullet';
  if (credited) {
    attacker.stats.kills += 1;
    attacker.stats.streak += 1;
    attacker.stats.bestStreak = Math.max(attacker.stats.bestStreak, attacker.stats.streak);
    if (headshot) attacker.stats.headshots += 1;
  }
  const since = room.time - HEALTH.assistWindow;
  const assisters: PlayerState[] = [];
  for (const r of victim.damageLog) {
    if (r.time < since || r.attacker === attacker || r.attacker === victim || assisters.includes(r.attacker) || !room.isEnemy(r.attacker, victim)) continue;
    assisters.push(r.attacker);
    r.attacker.stats.assists += 1;
  }
  victim.damageLog = [];

  const delay = room.rules.respawnDelay ? room.rules.respawnDelay(room, victim) : room.mode.respawn ? RESPAWN_DELAY : null;
  victim.respawnAt = delay === null ? null : room.time + delay;

  room.bus.emit('death', {
    victim,
    attacker,
    weapon: how.weapon,
    headshot,
    distance: how.distance ?? (attacker ? dist(attacker.move, victim.move) : 0),
    assisters,
    part: how.part ?? null,
    means: how.means,
    victimStreak,
    attackerStreak: credited ? attacker.stats.streak : 0,
    penetrated,
  });
  room.broadcast({ t: 'killfeed', attacker: attacker?.id ?? null, victim: victim.id, weapon: how.weapon, headshot, means: how.means, attackerTeam: attacker?.team ?? null, victimTeam: victim.team, ...(penetrated ? { pen: true } : {}) });
  victim.session?.send({ t: 'died', attacker: attacker?.id ?? null, weapon: how.weapon, respawnAt: victim.respawnAt });
  room.broadcastScore();
}

/**
 * Damage everyone within `radius` of `center` with linear falloff from `max` to `min` (explosives,
 * killstreaks), BO1's engine rules (shared/blast.ts): distance to the player's origin (feet), the
 * damage scaled by how much of the body the blast reaches (five traces, hits / 3: walls stop it,
 * thin props take part of it). `ensureKill` takes that player to 0 whatever the falloff, cover or
 * perks (a semtex stuck to them). Returns victims hit.
 */
export function radiusDamage(room: Room, center: Vec3, radius: number, max: number, min: number, opts: { attacker: PlayerState | null; weapon: string; means?: DamageMeans; hitSelf?: boolean; ensureKill?: PlayerState | null }): PlayerState[] {
  const hit: PlayerState[] = [];
  for (const q of room.players.values()) {
    if (!q.alive) continue;
    if (q === opts.attacker && !opts.hitSelf) continue;
    const body: BlastBody = { x: q.move.x, y: q.move.y, z: q.move.z, eye: eyeHeight(q.move) };
    const d = blastDistance(center, body);
    const stuck = opts.ensureKill === q;
    if (!stuck && d > radius) continue;
    const reach = stuck ? 1 : blastExposure(room.world, center, body);
    if (reach <= 0) continue;
    // Stuck to them: more than any multiplier can take back to survivable (BO1: the stuck semtex
    // is at the centre of the blast and skips Flak Jacket).
    const amount = stuck ? Math.max(max, q.maxHealth) * 10 : (max + (min - max) * (d / radius)) * reach;
    if (damage(room, { victim: q, attacker: opts.attacker, amount, weapon: opts.weapon, part: 'torso', means: opts.means ?? 'explosive', from: center, distance: d }) > 0) hit.push(q);
  }
  return hit;
}

export function startReload(room: Room, p: PlayerState): boolean {
  const w = currentWeapon(p);
  if (!w || !p.alive || p.reloadEnd > 0 || w.mag >= w.def.magazine || w.reserve <= 0 || room.time < p.swapEnd) return false;
  const empty = w.mag === 0;
  const ms = empty ? w.def.reloadEmptyMs : w.def.reloadMs;
  p.reloadEnd = room.time + (ms / 1000) * room.modifiers.mul('reloadMultiplier', p);
  room.bus.emit('reload', { player: p, weapon: w.def.base.id, empty });
  return true;
}

export function switchWeapon(room: Room, p: PlayerState, slot: number): boolean {
  if (slot === p.slot || slot < 0 || slot >= p.weapons.length) return false;
  p.slot = slot;
  p.reloadEnd = 0;
  const w = p.weapons[slot]!;
  w.credit = Math.max(w.credit, 1);
  w.creditTime = room.time;
  p.swapEnd = room.time + ((w.def.swapMs ?? 500) / 1000) * room.modifiers.mul('swapMultiplier', p);
  room.bus.emit('weaponSwitch', { player: p, slot, weapon: w.def.base.id });
  return true;
}

/** How long a server-chosen slot ignores commands that still ask for the old one (see `slotLock`). */
export const SLOT_LOCK_SEC = 1.5;

/**
 * Put `slot` in the player's hands from the server side (last stand, revive) and hold it there
 * until the client's commands catch up (`PlayerState.slotLock`). Returns false for a bad slot.
 */
export function forceSlot(room: Room, p: PlayerState, slot: number): boolean {
  if (slot < 0 || slot >= p.weapons.length) return false;
  switchWeapon(room, p, slot);
  p.slotLock = { slot, until: room.time + SLOT_LOCK_SEC };
  return true;
}

/** Per tick: finish reloads, regenerate health, respawn the dead, kill the out-of-bounds. */
export function updateCombat(room: Room, p: PlayerState, dt: number): void {
  const now = room.time;
  if (p.alive) {
    if (p.reloadEnd > 0 && now >= p.reloadEnd) {
      const w = currentWeapon(p);
      if (w) {
        const take = Math.min(w.def.magazine - w.mag, w.reserve);
        w.mag += take;
        w.reserve -= take;
      }
      p.reloadEnd = 0;
    }
    if (p.health < p.maxHealth && now - p.lastDamageTime >= HEALTH.regenDelay * room.modifiers.mul('regenDelayMultiplier', p)) {
      p.health = Math.min(p.maxHealth, p.health + HEALTH.regenRate * dt);
      if (p.health >= p.maxHealth) p.damageLog = [];
    }
    const b = room.map.bounds;
    const m = p.move;
    if (m.y < Math.max(b.min.y, -40) || m.x < b.min.x - 2 || m.x > b.max.x + 2 || m.z < b.min.z - 2 || m.z > b.max.z + 2) kill(room, p, null, { weapon: 'world', means: 'world' });
  } else if (p.respawnAt !== null && now >= p.respawnAt && room.phase === 'playing') {
    spawn(room, p);
  }
}

/** The loadout a player will spawn with (profile selection for humans, nextLoadout for bots). */
export function chosenLoadout(p: PlayerState): Loadout {
  if (p.nextLoadout) return cloneLoadout(p.nextLoadout);
  const prof = p.profile;
  if (prof) return cloneLoadout(prof.loadouts[prof.selectedLoadout] ?? prof.loadouts[0] ?? DEFAULT_LOADOUTS[0]!);
  return cloneLoadout(DEFAULT_LOADOUTS[0]!);
}

/** (Re)spawn a player now, at `point` or the best spawn for them. */
export function spawn(room: Room, p: PlayerState, point?: SpawnPoint): void {
  const ev = { player: p, loadout: chosenLoadout(p), point: point ?? null };
  room.bus.emit('beforeSpawn', ev);
  const loadout = sanitizeLoadout(ev.loadout);
  const at = ev.point ?? pickSpawn(room, p);
  p.loadout = loadout;
  p.weapons = [makeWeapon(loadout.primary, 'ak47'), makeWeapon(loadout.secondary, 'm1911')];
  // CoD: every life starts on the primary, whatever was in hand at death. (The client asks for
  // slot 0 while dead, so the commands in flight across the respawn agree; see Match.)
  p.slot = 0;
  p.slotLock = null;
  p.swapEnd = room.time + 0.3;
  p.reloadEnd = 0;
  const m = createMoveState(at.x, at.y, at.z);
  const ground = room.world.groundBelow(at.x, at.z, at.y + 1, 3);
  if (ground !== null) m.y = ground;
  m.onGround = true;
  p.move = m;
  p.yaw = at.yaw;
  p.pitch = 0;
  p.maxHealth = HEALTH.max * room.modifiers.mul('maxHealthMultiplier', p);
  p.health = p.maxHealth;
  p.lastDamageTime = -999;
  p.damageLog = [];
  p.alive = true;
  p.respawnAt = null;
  p.spawnTime = room.time;
  room.bus.emit('spawn', { player: p, point: at });
  p.session?.send({ t: 'spawned', x: m.x, y: m.y, z: m.z, yaw: at.yaw, loadout });
}

/**
 * Best spawn: far from living enemies, never next to one or in their line of sight when there is
 * a choice, not on top of anyone; picks randomly among the best few so spawns don't become
 * predictable. Mode rules (features/modes/spawns.ts) usually hand it a short ranked list.
 */
export function pickSpawn(room: Room, p: PlayerState): SpawnPoint {
  const map = room.map;
  let points = room.rules.spawnPoints?.(room, p) ?? (room.mode.teams && p.team !== null ? map.spawns.teams[p.team] : map.spawns.ffa);
  if (!points || points.length === 0) points = map.spawns.ffa.length ? map.spawns.ffa : [...map.spawns.teams[0], ...map.spawns.teams[1]];
  if (points.length === 0) return { x: 0, y: 1, z: 0, yaw: 0 };
  const others = [...room.players.values()].filter((q) => q !== p && q.alive);
  const enemies = others.filter((q) => room.isEnemy(p, q));
  const scored = points.map((pt) => {
    let s = Math.random() * 2;
    let nearest = 60;
    for (const e of enemies) {
      const d = Math.hypot(e.move.x - pt.x, e.move.z - pt.z);
      nearest = Math.min(nearest, d);
      if (d < 12) s -= 150;
      else if (d < 60 && room.world.lineOfSight(eyeOf(e), { x: pt.x, y: pt.y + PLAYER.eye, z: pt.z })) s -= 100;
    }
    s += nearest;
    for (const q of others) if (Math.hypot(q.move.x - pt.x, q.move.z - pt.z) < 1.2) s -= 200;
    return { pt, s };
  });
  scored.sort((a, b) => b.s - a.s);
  const top = scored.slice(0, Math.min(3, scored.length)).filter((x) => x.s > scored[0]!.s - 10);
  return top[Math.floor(Math.random() * top.length)]!.pt;
}
