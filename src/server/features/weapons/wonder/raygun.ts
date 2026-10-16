/**
 * Ray Gun: each trigger pull launches a glowing bolt (`weapons.raybolt` entity, no gravity) that
 * flies at RAYGUN.speed. A body it touches takes the direct hit (a kill); then, or where it meets
 * the world, it splashes (`raygunSplash`, line of sight from the impact), the shooter included at
 * RAYGUN.selfScale. Bots lead a moving target (humans lead it themselves).
 */
import { rayHitboxes, type HitPart } from '../../../../shared/collision';
import { shotSeed, spreadDegrees, spreadDirection, stanceSpread } from '../../../../shared/ballistics';
import { RAYGUN, raygunSplash, WONDER_ENTITY } from '../../../../shared/defs/wonder';
import { normalize, type Vec3 } from '../../../../shared/math';
import { moveHitboxes } from '../../../../shared/movement';
import type { WeaponBehavior } from '../../../combat';
import type { Entity } from '../../../entities';
import type { PlayerState } from '../../../player';
import type { Room } from '../../../room';
import { chest, emitFire, targetsOf, wonderFx } from './common';

interface BoltData {
  vel: Vec3;
  owner: string;
  born: number;
}

/** A bot shooter aims where its target will be when the bolt arrives (the enemy nearest its aim ray). */
export function boltLead(room: Room, p: PlayerState, origin: Vec3, dir: Vec3): Vec3 {
  if (p.session) return dir;
  let best: PlayerState | null = null;
  let bestOff = 0.12; // radians off the aim
  for (const q of targetsOf(room, p)) {
    const c = chest(q);
    const d = normalize({ x: c.x - origin.x, y: c.y - origin.y, z: c.z - origin.z });
    const off = Math.acos(Math.max(-1, Math.min(1, d.x * dir.x + d.y * dir.y + d.z * dir.z)));
    if (off < bestOff) {
      best = q;
      bestOff = off;
    }
  }
  if (!best) return dir;
  const c = chest(best);
  const t = Math.hypot(c.x - origin.x, c.y - origin.y, c.z - origin.z) / RAYGUN.speed;
  const at = { x: c.x + best.move.vx * t, y: c.y - 0.3, z: c.z + best.move.vz * t };
  return normalize({ x: at.x - origin.x, y: at.y - origin.y, z: at.z - origin.z });
}

export const raygunBehavior: WeaponBehavior = {
  fire(room, player, weapon, shot) {
    const moving = Math.hypot(player.move.vx, player.move.vz) > 0.5;
    const spread = spreadDegrees(weapon.def, player.move.ads, moving, room.modifiers.mul('spreadMultiplier', player) * stanceSpread(player.move));
    const aim = boltLead(room, player, shot.origin, shot.dir);
    const dir = spreadDirection(aim, spread, shotSeed(player.seed, shot.shot, 0));
    const data: BoltData = { vel: { x: dir.x * RAYGUN.speed, y: dir.y * RAYGUN.speed, z: dir.z * RAYGUN.speed }, owner: player.id, born: room.time };
    room.entities.add({ kind: WONDER_ENTITY.bolt, x: shot.origin.x, y: shot.origin.y, z: shot.origin.z, yaw: Math.atan2(-dir.x, -dir.z), owner: player.id, team: player.team, s: { b: Math.round(room.time * 1000) / 1000, pt: Math.round(Math.asin(dir.y) * 100) / 100 }, data });
    // The killcam and stats see the pull now, ending where the bolt would land on a straight line.
    const wall = room.world.raycast(shot.origin, dir, RAYGUN.speed * RAYGUN.life, 'bullets');
    let t = wall ? wall.t : RAYGUN.speed * RAYGUN.life;
    for (const q of targetsOf(room, player)) {
      const h = rayHitboxes(shot.origin, dir, moveHitboxes(q.move, q.yaw), t);
      if (h) t = h.t;
    }
    emitFire(room, player, 'raygun', shot.origin, dir, { x: shot.origin.x + dir.x * t, y: shot.origin.y + dir.y * t, z: shot.origin.z + dir.z * t });
  },
};

/** Splash at `at` (players with a clear line from it): the shooter takes RAYGUN.selfScale of theirs; `skip` already took the direct hit. */
export function raygunSplashAt(room: Room, at: Vec3, owner: PlayerState | null, skip: PlayerState | null = null): PlayerState[] {
  const hit: PlayerState[] = [];
  for (const q of room.players.values()) {
    if (!q.alive || q === skip) continue;
    const c = chest(q);
    const d = Math.min(Math.hypot(c.x - at.x, c.y - at.y, c.z - at.z), Math.hypot(q.move.x - at.x, q.move.y + 0.2 - at.y, q.move.z - at.z));
    const amount = raygunSplash(d) * (q === owner ? RAYGUN.selfScale : 1);
    if (amount <= 0 || !room.world.lineOfSight(at, c, 'bullets')) continue;
    if (room.damage({ victim: q, attacker: owner, amount, weapon: 'raygun', part: 'torso', means: 'explosive', from: at, distance: d }) > 0) hit.push(q);
  }
  return hit;
}

function impact(room: Room, e: Entity, b: BoltData, at: Vec3, victim: { q: PlayerState; part: HitPart } | null) {
  room.entities.remove(e.id);
  const owner = room.players.get(b.owner) ?? null;
  wonderFx(room, { k: 'splash', p: b.owner, x: Math.round(at.x * 100) / 100, y: Math.round(at.y * 100) / 100, z: Math.round(at.z * 100) / 100 });
  if (victim) {
    const dist = owner ? Math.hypot(owner.move.x - at.x, owner.move.z - at.z) : 0;
    room.damage({ victim: victim.q, attacker: owner, amount: RAYGUN.direct, weapon: 'raygun', part: victim.part, means: 'bullet', from: owner ? { x: owner.move.x, y: at.y, z: owner.move.z } : at, distance: dist });
  }
  raygunSplashAt(room, at, owner, victim?.q ?? null);
}

/** One tick of every bolt: a swept ray against the world and bodies (the owner's own bolt never hits them directly). */
export function updateBolts(room: Room, dt: number): void {
  if (room.phase !== 'playing') return;
  for (const e of room.entities.byKind(WONDER_ENTITY.bolt)) {
    const b = e.data as BoltData;
    const from = { x: e.x, y: e.y, z: e.z };
    const L = RAYGUN.speed * dt;
    const dir = { x: b.vel.x / RAYGUN.speed, y: b.vel.y / RAYGUN.speed, z: b.vel.z / RAYGUN.speed };
    const wall = room.world.raycast(from, dir, L, 'bullets');
    let maxT = wall ? wall.t : L;
    let victim: { q: PlayerState; part: HitPart } | null = null;
    const owner = room.players.get(b.owner);
    for (const q of room.players.values()) {
      if (!q.alive || q.id === b.owner || (owner && !room.canDamage(owner, q))) continue;
      const h = rayHitboxes(from, dir, moveHitboxes(q.move, q.yaw), maxT + RAYGUN.radius);
      if (h && h.t <= maxT + RAYGUN.radius) {
        maxT = Math.min(maxT, h.t);
        victim = { q, part: h.part };
      }
    }
    const t = victim ? maxT : wall ? Math.max(0, wall.t - 0.08) : L;
    e.x = from.x + dir.x * t;
    e.y = from.y + dir.y * t;
    e.z = from.z + dir.z * t;
    if (victim || wall) impact(room, e, b, { x: e.x, y: e.y, z: e.z }, victim);
    else if (room.time - b.born >= RAYGUN.life || e.y < room.map.bounds.min.y - 5) room.entities.remove(e.id);
  }
}
