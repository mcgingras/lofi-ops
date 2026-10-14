/**
 * The wager weapons' projectiles (Sticks and Stones, the top of the Gun Game ladder):
 *
 * - Crossbow explosive bolt (`economy.bolt`): flies with drop; on a player it does 50, sticks to
 *   them and, after the fuse, explodes killing them for sure plus 200-75 to everyone within 4 m
 *   (the shooter too); on the world it sticks to the surface and explodes the same way.
 *   `s.k` = 1 once stuck, `s.p` = the player it's stuck to.
 * - Ballistic knife blade (`economy.blade`): a slow arc that kills on any body hit (250 flat).
 *   It stays where it lands (stuck in a wall, on the floor, or dropped at the victim's body) for
 *   a minute; anyone holding a ballistic knife who walks over it or presses USE near it takes it
 *   back (into the chamber if empty, else reserve), up to the gun's full load.
 *
 * Bots don't lead for drop on their own, so for a bot shooter the launch direction is lifted to
 * land on whatever its aim ray meets first (the only bot-specific bit, kept here).
 */
import { rayHitboxes, type HitPart } from '../../../shared/collision';
import { moveHitboxes } from '../../../shared/movement';
import { BLADE, BLADE_ENTITY, BOLT, BOLT_ENTITY } from '../../../shared/defs/economy';
import { Buttons } from '../../../shared/input';
import { normalize, type Vec3 } from '../../../shared/math';
import type { WeaponBehavior } from '../../combat';
import type { Entity } from '../../entities';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';

interface Flight {
  vel: Vec3;
  gravity: number;
  owner: string;
  born: number;
}

interface BoltData extends Flight {
  /** Room time it stuck (fuse running). */
  stuckAt: number | null;
  stuckTo: string | null;
  offset: Vec3 | null;
}

interface BladeData extends Flight {
  /** Room time it stopped (retrievable from then on). */
  landedAt: number | null;
}

declare module '../../../shared/events' {
  interface RoomEvents<P> {
    /** A crossbow bolt stuck into a player (`victim`) or the world (`victim` null). */
    'economy.boltStuck': { player: P | null; victim: P | null };
    /** Someone picked up a ballistic knife blade. */
    'economy.bladePickup': { player: P };
  }
}


/**
 * Bot shooters: lift the launch direction so a projectile with `speed` and `gravity` lands where
 * the straight aim ray first meets a player or the world (no-op for humans: they lead themselves).
 */
export function botLaunchDir(room: Room, p: PlayerState, origin: Vec3, dir: Vec3, speed: number, gravity: number): Vec3 {
  if (p.session) return dir;
  let t = room.world.raycast(origin, dir, 80, 'bullets')?.t ?? 80;
  for (const q of room.players.values()) {
    if (q === p || !q.alive || !room.canDamage(p, q)) continue;
    const h = rayHitboxes(origin, dir, moveHitboxes(q.move, q.yaw), t);
    if (h) t = h.t;
  }
  const flight = t / speed;
  return normalize({ x: dir.x, y: dir.y + (0.5 * gravity * flight * flight) / Math.max(1, t), z: dir.z });
}

type Hit = { player: PlayerState; part: HitPart; at: Vec3 } | { world: Vec3; normal: Vec3 } | null;

/** Move a flying projectile one tick: gravity, swept ray against the world and players. */
function fly(room: Room, e: Entity, f: Flight, dt: number): Hit {
  f.vel.y -= f.gravity * dt;
  const from = { x: e.x, y: e.y, z: e.z };
  const step = { x: f.vel.x * dt, y: f.vel.y * dt, z: f.vel.z * dt };
  const L = Math.hypot(step.x, step.y, step.z);
  if (L < 1e-6) return null;
  const dir = { x: step.x / L, y: step.y / L, z: step.z / L };
  const wall = room.world.raycast(from, dir, L, 'bullets');
  let maxT = wall ? wall.t : L;
  let victim: PlayerState | null = null;
  let part: HitPart = 'torso';
  const owner = room.players.get(f.owner);
  for (const q of room.players.values()) {
    if (!q.alive || q.id === f.owner) continue;
    if (owner && !room.canDamage(owner, q)) continue;
    const hit = rayHitboxes(from, dir, moveHitboxes(q.move, q.yaw), maxT);
    if (hit) {
      maxT = hit.t;
      victim = q;
      part = hit.part;
    }
  }
  // Stop a hair short of a wall so whatever is stuck there isn't inside the brush.
  const t = victim ? maxT : Math.max(0, maxT - (wall ? 0.04 : 0));
  const at = { x: from.x + dir.x * t, y: from.y + dir.y * t, z: from.z + dir.z * t };
  e.x = at.x;
  e.y = at.y;
  e.z = at.z;
  e.yaw = Math.atan2(-f.vel.x, -f.vel.z);
  e.s = { ...e.s, pt: Math.round(Math.atan2(f.vel.y, Math.hypot(f.vel.x, f.vel.z)) * 100) / 100 };
  if (victim) return { player: victim, part, at };
  if (wall) return { world: at, normal: wall.normal };
  return null;
}

const outOfMap = (room: Room, e: Entity) => e.y < room.map.bounds.min.y - 10;

// ---------------------------------------------------------------------------------------------
// Crossbow
// ---------------------------------------------------------------------------------------------

export const crossbowBehavior: WeaponBehavior = {
  fire(room, player, _weapon, shot) {
    const d = botLaunchDir(room, player, shot.origin, shot.dir, BOLT.speed, BOLT.gravity);
    const data: BoltData = { vel: { x: d.x * BOLT.speed, y: d.y * BOLT.speed, z: d.z * BOLT.speed }, gravity: BOLT.gravity, owner: player.id, born: room.time, stuckAt: null, stuckTo: null, offset: null };
    room.entities.add({ kind: BOLT_ENTITY, x: shot.origin.x, y: shot.origin.y, z: shot.origin.z, yaw: player.yaw, owner: player.id, s: { k: 0 }, data });
  },
};

function stepBolt(room: Room, e: Entity, dt: number) {
  const b = e.data as BoltData;
  const owner = room.players.get(b.owner) ?? null;
  if (b.stuckAt !== null) {
    const host = b.stuckTo ? room.players.get(b.stuckTo) : undefined;
    if (host && host.alive && b.offset) {
      e.x = host.move.x + b.offset.x;
      e.y = host.move.y + b.offset.y;
      e.z = host.move.z + b.offset.z;
    }
    if (room.time - b.stuckAt >= BOLT.fuseSec) explodeBolt(room, e, b, owner, host ?? null);
    return;
  }
  const hit = fly(room, e, b, dt);
  if (!hit) {
    if (outOfMap(room, e) || room.time - b.born > BOLT.lifeSec) room.entities.remove(e.id);
    return;
  }
  b.stuckAt = room.time;
  b.vel = { x: 0, y: 0, z: 0 };
  if ('player' in hit) {
    const v = hit.player;
    b.stuckTo = v.id;
    b.offset = { x: hit.at.x - v.move.x, y: hit.at.y - v.move.y, z: hit.at.z - v.move.z };
    e.s = { ...e.s, k: 1, p: v.id };
    room.sendFeature(v, 'economy.stuck', { by: owner?.id ?? null, fuse: BOLT.fuseSec });
    room.bus.emit('economy.boltStuck', { player: owner, victim: v });
    room.damage({ victim: v, attacker: owner, amount: BOLT.impact, weapon: 'crossbow', part: hit.part, means: 'impact', from: hit.at, distance: owner ? Math.hypot(owner.move.x - hit.at.x, owner.move.z - hit.at.z) : 0 });
    return;
  }
  e.s = { ...e.s, k: 1 };
  room.bus.emit('economy.boltStuck', { player: owner, victim: null });
}

function explodeBolt(room: Room, e: Entity, b: BoltData, owner: PlayerState | null, host: PlayerState | null) {
  room.entities.remove(e.id);
  const at = { x: e.x, y: e.y, z: e.z };
  room.sendFeature(null, 'weapons.boom', { x: at.x, y: at.y, z: at.z, e: 'crossbow', owner: b.owner });
  // Whoever it's stuck to always dies (even through Flak Jacket), then the splash.
  if (host?.alive) room.damage({ victim: host, attacker: owner, amount: 1000, weapon: 'crossbow', part: 'torso', means: 'explosive', from: at, distance: 0 });
  room.radiusDamage(at, BOLT.radius, BOLT.max, BOLT.min, { attacker: owner, weapon: 'crossbow', means: 'explosive', hitSelf: true });
}

// ---------------------------------------------------------------------------------------------
// Ballistic knife
// ---------------------------------------------------------------------------------------------

export const ballisticKnifeBehavior: WeaponBehavior = {
  fire(room, player, _weapon, shot) {
    const d = botLaunchDir(room, player, shot.origin, shot.dir, BLADE.speed, BLADE.gravity);
    const data: BladeData = { vel: { x: d.x * BLADE.speed, y: d.y * BLADE.speed, z: d.z * BLADE.speed }, gravity: BLADE.gravity, owner: player.id, born: room.time, landedAt: null };
    room.entities.add({ kind: BLADE_ENTITY, x: shot.origin.x, y: shot.origin.y, z: shot.origin.z, yaw: player.yaw, owner: player.id, s: { k: 0 }, data });
  },
};

/** Put a blade in the world as a pickup (tests, and the drop at a victim's body). */
export function dropBlade(room: Room, at: Vec3, owner: string, yaw = 0): Entity {
  const data: BladeData = { vel: { x: 0, y: 0, z: 0 }, gravity: 0, owner, born: room.time, landedAt: room.time };
  return room.entities.add({ kind: BLADE_ENTITY, x: at.x, y: at.y, z: at.z, yaw, owner, s: { k: 2, pt: 0 }, data });
}

function stepBlade(room: Room, e: Entity, dt: number) {
  const b = e.data as BladeData;
  if (b.landedAt !== null) {
    if (room.time - b.landedAt > BLADE.pickupSec) {
      room.entities.remove(e.id);
      return;
    }
    const taker = bladeTaker(room, e);
    if (taker) takeBlade(room, e, taker);
    return;
  }
  const hit = fly(room, e, b, dt);
  if (!hit) {
    if (outOfMap(room, e)) room.entities.remove(e.id);
    else if (room.time - b.born > BLADE.lifeSec) land(room, e, b, 2);
    return;
  }
  if ('player' in hit) {
    const owner = room.players.get(b.owner) ?? null;
    const v = hit.player;
    room.damage({ victim: v, attacker: owner, amount: BLADE.damage, weapon: 'ballistic_knife', part: hit.part, means: 'bullet', from: hit.at, distance: owner ? Math.hypot(owner.move.x - hit.at.x, owner.move.z - hit.at.z) : 0 });
    // The blade ends up on the floor at the body.
    e.x = v.move.x;
    e.y = v.move.y + 0.05;
    e.z = v.move.z;
    land(room, e, b, 2);
    return;
  }
  land(room, e, b, 1);
}

/** `k`: 1 = stuck in a surface (keeps its flight angle), 2 = lying flat on the floor. */
function land(room: Room, e: Entity, b: BladeData, k: 1 | 2) {
  b.landedAt = room.time;
  b.vel = { x: 0, y: 0, z: 0 };
  e.s = k === 2 ? { k, pt: 0 } : { ...e.s, k };
}

/** Loaded + spare ballistic knife blades a player can still take (0 = full or no knife). */
export function bladeRoom(p: PlayerState): number {
  const w = p.weapons.find((x) => x.def.base.id === 'ballistic_knife');
  if (!w) return 0;
  return Math.max(0, w.def.magazine + w.def.base.reserve - (w.mag + w.reserve));
}

function bladeTaker(room: Room, e: Entity): PlayerState | null {
  let best: PlayerState | null = null;
  let bestD = Infinity;
  for (const p of room.players.values()) {
    if (!p.alive || bladeRoom(p) <= 0) continue;
    const dy = e.y - p.move.y;
    if (dy < -0.8 || dy > 2.4) continue;
    const flat = Math.hypot(e.x - p.move.x, e.z - p.move.z);
    const using = (p.buttons & Buttons.USE) !== 0;
    const ok = flat <= (using ? BLADE.useRadius : BLADE.walkRadius);
    if (ok && flat < bestD) {
      best = p;
      bestD = flat;
    }
  }
  return best;
}

function takeBlade(room: Room, e: Entity, p: PlayerState) {
  const w = p.weapons.find((x) => x.def.base.id === 'ballistic_knife');
  if (!w) return;
  room.entities.remove(e.id);
  // BO1: an empty knife is reloaded on the spot; otherwise it goes to reserve.
  if (w.mag === 0) {
    w.mag = 1;
    if (p.weapons[p.slot] === w) p.reloadEnd = 0;
  } else w.reserve += 1;
  room.sendFeature(p, 'economy.blade', { total: w.mag + w.reserve });
  room.bus.emit('economy.bladePickup', { player: p });
}

/** Per tick (economy feature room hook): every bolt and blade in the room. */
export function updateWagerProjectiles(room: Room, dt: number): void {
  if (room.phase !== 'playing') return;
  for (const e of room.entities.byKind(BOLT_ENTITY)) stepBolt(room, e, dt);
  for (const e of room.entities.byKind(BLADE_ENTITY)) stepBlade(room, e, dt);
}
