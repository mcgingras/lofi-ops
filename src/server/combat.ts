/**
 * Firing, damage, death and respawn. Hitscan is lag compensated: targets are rewound to the
 * shooter's view time (clamped to MAX_REWIND_MS); the world is hit first, then hitboxes.
 *
 * Extension points:
 *   - `registerWeaponBehavior(idOrClass, behavior)`: replace hitscan for a weapon id or class
 *     (launchers, knives, crossbows...). The behaviour gets the validated shot and does its thing
 *     (spawn an entity, radiusDamage, ...).
 *   - bus events `beforeDamage` (mutable), `damage`, `death`, `fire`, `reload`, `weaponSwitch`,
 *     `beforeSpawn` (mutable loadout/point), `spawn`.
 *   - modifiers: damageTaken, damageDealt, reloadMultiplier, swapMultiplier, sprintOutMultiplier,
 *     spreadMultiplier, regenDelayMultiplier, maxHealthMultiplier.
 */
import { damageAtRange, isLowerTorso, partMultiplier, shotInterval, shotSeed, spreadDegrees, spreadDirection } from '../shared/ballistics';
import { playerHitboxes, rayHitboxes, type HitPart } from '../shared/collision';
import { HEALTH, PLAYER, RESPAWN_DELAY } from '../shared/constants';
import type { DamageInfo, DamageMeans } from '../shared/events';
import { cloneLoadout, DEFAULT_LOADOUTS, sanitizeLoadout, type Loadout } from '../shared/loadout';
import type { SpawnPoint } from '../shared/maps/types';
import { dist, normalize, type Vec3 } from '../shared/math';
import { createMoveState, eyeHeight } from '../shared/movement';
import { q3 } from '../shared/protocol';
import { HitboxHistory } from './lagcomp';
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

  // Rate: a token bucket refilling at the weapon's rate, a little slack for network bunching.
  const interval = shotInterval(def);
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

  // Hitscan, lag compensated.
  const viewTime = HitboxHistory.clampTime(req.time, now);
  const poses = room.history.rewind(viewTime);
  const moving = Math.hypot(p.move.vx, p.move.vz) > 0.5;
  const spread = spreadDegrees(def, p.move.ads, moving, room.modifiers.mul('spreadMultiplier', p));
  const range = def.range ?? DEFAULT_RANGE;
  const pellets = Math.max(1, def.pellets ?? 1);
  const perVictim = new Map<PlayerState, { damage: number; part: HitPart; distance: number }>();
  let end: Vec3 = { x: origin.x + dir.x * range, y: origin.y + dir.y * range, z: origin.z + dir.z * range };
  let hitAny = false;
  for (let i = 0; i < pellets; i++) {
    const d = spreadDirection(dir, spread, shotSeed(p.seed, req.shot, i));
    const wall = room.world.raycast(origin, d, range, 'bullets');
    let maxT = wall ? wall.t : range;
    let victim: PlayerState | null = null;
    let part: HitPart = 'torso';
    let lower = false;
    for (const q of room.players.values()) {
      if (q === p || !q.alive || !room.canDamage(p, q)) continue;
      const pose = poses.get(q.id) ?? { x: q.move.x, y: q.move.y, z: q.move.z, crouched: q.move.crouched, alive: true };
      if (!pose.alive) continue;
      const hit = rayHitboxes(origin, d, playerHitboxes(pose, pose.crouched), maxT);
      if (hit) {
        maxT = hit.t;
        victim = q;
        part = hit.part;
        lower = part === 'torso' && isLowerTorso(pose, pose.crouched, origin.y + d.y * hit.t);
      }
    }
    if (i === 0) end = { x: origin.x + d.x * maxT, y: origin.y + d.y * maxT, z: origin.z + d.z * maxT };
    if (victim) {
      hitAny = true;
      const dmg = damageAtRange(def, maxT) * partMultiplier(def, part, lower);
      const acc = perVictim.get(victim);
      if (acc) {
        acc.damage += dmg;
        if (part === 'head') acc.part = 'head';
      } else perVictim.set(victim, { damage: dmg, part, distance: maxT });
    }
  }

  const hits: { victim: PlayerState; part: HitPart; damage: number }[] = [];
  for (const [victim, h] of perVictim) {
    const dealt = damage(room, { victim, attacker: p, amount: h.damage, weapon: def.base.id, part: h.part, means: 'bullet', from: origin, distance: h.distance });
    hits.push({ victim, part: h.part, damage: dealt });
  }
  room.recordShot({ p: p.id, o: [q3(origin.x), q3(origin.y), q3(origin.z)], e: [q3(end.x), q3(end.y), q3(end.z)], w: def.base.id, ...(hitAny ? { h: 1 as const } : {}) });
  room.bus.emit('fire', { player: p, weapon: def.base.id, origin, dir, hits, end });
  if (w.mag <= 0) startReload(room, p);
  return { ok: true };
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
  if (attacker && attacker !== victim) attacker.session?.send({ t: 'hit', victim: victim.id, part: ev.part ?? 'torso', damage: q3(dealt), kill: killed });
  if (killed) kill(room, victim, attacker, { weapon: ev.weapon, part: ev.part, means: ev.means, distance: ev.distance });
  return dealt;
}

/** Kill a player (credit, assists, streaks, killfeed, respawn timer, `death` event). */
export function kill(room: Room, victim: PlayerState, attacker: PlayerState | null, how: { weapon: string; part?: HitPart | null; means: DamageMeans; distance?: number }): void {
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
  });
  room.broadcast({ t: 'killfeed', attacker: attacker?.id ?? null, victim: victim.id, weapon: how.weapon, headshot, means: how.means, attackerTeam: attacker?.team ?? null, victimTeam: victim.team });
  victim.session?.send({ t: 'died', attacker: attacker?.id ?? null, weapon: how.weapon, respawnAt: victim.respawnAt });
  room.broadcastScore();
}

/**
 * Damage everyone within `radius` of `center` with falloff from `max` to `min`, if they are in
 * line of sight of the blast (explosives, killstreaks). Returns victims hit.
 */
export function radiusDamage(room: Room, center: Vec3, radius: number, max: number, min: number, opts: { attacker: PlayerState | null; weapon: string; means?: DamageMeans; hitSelf?: boolean }): PlayerState[] {
  const hit: PlayerState[] = [];
  for (const q of room.players.values()) {
    if (!q.alive) continue;
    if (q === opts.attacker && !opts.hitSelf) continue;
    const chest = { x: q.move.x, y: q.move.y + PLAYER.crouchHeight * 0.6, z: q.move.z };
    const d = dist(center, chest);
    if (d > radius || !room.world.lineOfSight(center, chest, 'bullets')) continue;
    const amount = max + (min - max) * (d / radius);
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
  p.slot = 0;
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
 * Best spawn: far from living enemies, not in their line of sight, not on top of anyone; picks
 * randomly among the best few so spawns don't become predictable.
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
      if (d < 45 && room.world.lineOfSight(eyeOf(e), { x: pt.x, y: pt.y + PLAYER.eye, z: pt.z })) s -= 25;
    }
    s += nearest;
    for (const q of others) if (Math.hypot(q.move.x - pt.x, q.move.z - pt.z) < 1.2) s -= 200;
    return { pt, s };
  });
  scored.sort((a, b) => b.s - a.s);
  const top = scored.slice(0, Math.min(3, scored.length)).filter((x) => x.s > scored[0]!.s - 10);
  return top[Math.floor(Math.random() * top.length)]!.pt;
}
