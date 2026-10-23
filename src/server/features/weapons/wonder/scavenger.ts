/**
 * Scavenger: each pull launches a fast explosive bolt (`weapons.scavbolt`, slight drop) that
 * fizzles after SCAVENGER.life (no kills across the map). It sticks to the first body (impact
 * damage, then it rides them) or surface it meets, and SCAVENGER.fuseSec later it detonates: whoever
 * carries it dies (`stuckDamage`), and core `radiusDamage` (BO1 rules, the shooter included) does
 * the blast. The detonation is a `weapons.detonated` event too (killstreak hardware takes it) and a
 * `boom` effect. Bots lead a moving target and lift their aim for the drop.
 */
import { rayHitboxes, type HitPart } from '../../../../shared/collision';
import { shotSeed, spreadDegrees, spreadDirection, stanceSpread } from '../../../../shared/ballistics';
import { SCAVENGER, WONDER_ENTITY } from '../../../../shared/defs/wonder';
import { normalize, type Vec3 } from '../../../../shared/math';
import { moveHitboxes } from '../../../../shared/movement';
import type { WeaponBehavior } from '../../../combat';
import type { Entity } from '../../../entities';
import type { PlayerState } from '../../../player';
import type { Room } from '../../../room';
import { chest, emitFire, targetsOf, wonderFx } from './common';

interface ScavData {
  vel: Vec3;
  owner: string;
  born: number;
  /** Room time it stuck (fuse running), the body it is in and where on them. */
  stuckAt: number | null;
  stuckTo: string | null;
  offset: Vec3 | null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * A bot shooter's aim: lead the enemy nearest its aim ray by the bolt's flight time and lift for
 * the drop (humans lead and lift themselves).
 */
export function scavengerAim(room: Room, p: PlayerState, origin: Vec3, dir: Vec3): Vec3 {
  if (p.session) return dir;
  let best: PlayerState | null = null;
  let bestOff = 0.1;
  let bestD = 0;
  for (const q of targetsOf(room, p)) {
    const c = chest(q);
    const D = Math.hypot(c.x - origin.x, c.y - origin.y, c.z - origin.z);
    const d = normalize({ x: c.x - origin.x, y: c.y - origin.y, z: c.z - origin.z });
    const off = Math.acos(Math.max(-1, Math.min(1, d.x * dir.x + d.y * dir.y + d.z * dir.z)));
    if (off < bestOff) {
      best = q;
      bestOff = off;
      bestD = D;
    }
  }
  if (!best) return dir;
  const t = bestD / SCAVENGER.speed;
  const at = { x: origin.x + dir.x * bestD + best.move.vx * t, y: origin.y + dir.y * bestD + 0.5 * SCAVENGER.gravity * t * t, z: origin.z + dir.z * bestD + best.move.vz * t };
  return normalize({ x: at.x - origin.x, y: at.y - origin.y, z: at.z - origin.z });
}

export const scavengerBehavior: WeaponBehavior = {
  fire(room, player, weapon, shot) {
    const moving = Math.hypot(player.move.vx, player.move.vz) > 0.5;
    const spread = spreadDegrees(weapon.def, player.move.ads, moving, room.modifiers.mul('spreadMultiplier', player) * stanceSpread(player.move));
    const dir = spreadDirection(scavengerAim(room, player, shot.origin, shot.dir), spread, shotSeed(player.seed, shot.shot, 0));
    const S = SCAVENGER;
    const data: ScavData = { vel: { x: dir.x * S.speed, y: dir.y * S.speed, z: dir.z * S.speed }, owner: player.id, born: room.time, stuckAt: null, stuckTo: null, offset: null };
    room.entities.add({ kind: WONDER_ENTITY.scav, x: shot.origin.x, y: shot.origin.y, z: shot.origin.z, yaw: Math.atan2(-dir.x, -dir.z), owner: player.id, team: player.team, s: { k: 0, pt: r2(Math.asin(dir.y)) }, data });
    // The killcam and stats see the pull now, ending where the bolt would stop on a straight line.
    const reach = S.speed * S.life;
    const wall = room.world.raycast(shot.origin, dir, reach, 'bullets');
    let t = wall ? wall.t : reach;
    for (const q of targetsOf(room, player)) {
      const h = rayHitboxes(shot.origin, dir, moveHitboxes(q.move, q.yaw), t);
      if (h) t = h.t;
    }
    emitFire(room, player, 'scavenger', shot.origin, dir, { x: shot.origin.x + dir.x * t, y: shot.origin.y + dir.y * t, z: shot.origin.z + dir.z * t });
  },
};

/** Blow a bolt up where it is: the carrier dies, then the blast. */
export function detonate(room: Room, e: Entity): void {
  const b = e.data as ScavData;
  room.entities.remove(e.id);
  const owner = room.players.get(b.owner) ?? null;
  const host = b.stuckTo ? room.players.get(b.stuckTo) : undefined;
  const at = { x: e.x, y: e.y, z: e.z };
  wonderFx(room, { k: 'boom', p: b.owner, x: r2(at.x), y: r2(at.y), z: r2(at.z) });
  if (host?.alive) room.damage({ victim: host, attacker: owner, amount: SCAVENGER.stuckDamage, weapon: 'scavenger', part: 'torso', means: 'explosive', from: at, distance: 0 });
  const B = SCAVENGER.blast;
  room.radiusDamage(at, B.r, B.max, B.min, { attacker: owner, weapon: 'scavenger', means: 'explosive', hitSelf: true });
  room.bus.emit('weapons.detonated', { player: owner, equipment: 'scavenger', effect: 'frag', x: at.x, y: at.y, z: at.z, radius: B.r, max: B.max, min: B.min });
}

function stick(room: Room, e: Entity, b: ScavData, hit: { q: PlayerState; part: HitPart } | null): void {
  b.stuckAt = room.time;
  b.vel = { x: 0, y: 0, z: 0 };
  const fuse = Math.round((room.time + SCAVENGER.fuseSec) * 1000) / 1000;
  if (!hit) {
    e.s = { ...e.s, k: 1, f: fuse };
    return;
  }
  const owner = room.players.get(b.owner) ?? null;
  const v = hit.q;
  b.stuckTo = v.id;
  b.offset = { x: e.x - v.move.x, y: e.y - v.move.y, z: e.z - v.move.z };
  e.s = { ...e.s, k: 1, p: v.id, f: fuse };
  room.damage({ victim: v, attacker: owner, amount: SCAVENGER.impact, weapon: 'scavenger', part: hit.part, means: 'impact', from: { x: e.x, y: e.y, z: e.z }, distance: owner ? Math.hypot(owner.move.x - e.x, owner.move.z - e.z) : 0 });
}

/** One tick of every Scavenger bolt: fly (swept against the world and bodies), ride, or go off. */
export function updateScavBolts(room: Room, dt: number): void {
  if (room.phase !== 'playing') return;
  const S = SCAVENGER;
  for (const e of room.entities.byKind(WONDER_ENTITY.scav)) {
    const b = e.data as ScavData;
    if (b.stuckAt !== null) {
      const host = b.stuckTo ? room.players.get(b.stuckTo) : undefined;
      if (host && host.alive && b.offset) {
        e.x = host.move.x + b.offset.x;
        e.y = host.move.y + b.offset.y;
        e.z = host.move.z + b.offset.z;
      }
      if (room.time - b.stuckAt >= S.fuseSec) detonate(room, e);
      continue;
    }
    b.vel.y -= S.gravity * dt;
    const from = { x: e.x, y: e.y, z: e.z };
    const L = Math.hypot(b.vel.x, b.vel.y, b.vel.z) * dt;
    const dir = normalize(b.vel);
    const wall = room.world.raycast(from, dir, L, 'bullets');
    let maxT = wall ? wall.t : L;
    let victim: { q: PlayerState; part: HitPart } | null = null;
    const owner = room.players.get(b.owner);
    for (const q of room.players.values()) {
      if (!q.alive || q.id === b.owner || (owner && !room.canDamage(owner, q))) continue;
      const h = rayHitboxes(from, dir, moveHitboxes(q.move, q.yaw), maxT + S.radius);
      if (h && h.t <= maxT + S.radius) {
        maxT = Math.min(maxT, h.t);
        victim = { q, part: h.part };
      }
    }
    const t = victim ? maxT : wall ? wall.t : L;
    e.x = from.x + dir.x * t;
    e.y = from.y + dir.y * t;
    e.z = from.z + dir.z * t;
    if (!victim && wall) {
      // Stand it off the surface along its normal, so the blast's traces start in the open.
      e.x += wall.normal.x * 0.08;
      e.y += wall.normal.y * 0.08;
      e.z += wall.normal.z * 0.08;
    }
    e.yaw = Math.atan2(-dir.x, -dir.z);
    e.s = { ...e.s, pt: r2(Math.asin(Math.max(-1, Math.min(1, dir.y)))) };
    if (victim || wall) stick(room, e, b, victim);
    else if (room.time - b.born >= S.life || e.y < room.map.bounds.min.y - 5) room.entities.remove(e.id);
  }
}
