/**
 * The tomahawk (BO1 lethal): thrown on release, spins along a gravity arc, kills anyone it touches
 * while still moving fast (bank shots off walls count), bounces, comes to rest and becomes a
 * pickup. Anyone carrying tomahawks who walks over it (or presses USE next to it) gets it back,
 * up to their loadout count, like BO2's `watchhatchettrigger`.
 *
 * Entity kind `weapons.tomahawk`; `s.k` = 1 once it lies still. Kills are `weapon: 'tomahawk'`,
 * `means: 'thrown'` (Sticks and Stones bankrupts on those).
 */
import { EQUIPMENT_BY_ID, TOMAHAWK, TOMAHAWK_ENTITY } from '../../../shared/defs/equipment';
import { Buttons } from '../../../shared/input';
import type { Vec3 } from '../../../shared/math';
import type { Entity } from '../../entities';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { playerOnPath, sendEquip } from './equipment';
import { stepBody, type Body } from './projectile';
import { wext } from './state';

interface TomahawkData {
  owner: string | null;
  body: Body;
  born: number;
  /** Room time it came to rest (retrievable from then on). */
  restAt: number | null;
  /** Players it already hit this flight. */
  hit: Set<string>;
}

/** Throw a tomahawk from `pos` with `vel` (the weapons feature calls this on release). */
export function spawnTomahawk(room: Room, owner: PlayerState | null, pos: Vec3, vel: Vec3): Entity {
  const data: TomahawkData = { owner: owner?.id ?? null, body: { pos: { ...pos }, vel: { ...vel }, stuck: false, resting: false, traveled: 0 }, born: room.time, restAt: null, hit: new Set() };
  return room.entities.add({ kind: TOMAHAWK_ENTITY, x: pos.x, y: pos.y, z: pos.z, yaw: Math.atan2(-vel.x, -vel.z), owner: owner?.id, s: { k: 0 }, data });
}

/** Put a tomahawk on the ground as a pickup (dropped by a player who died holding it up). */
export function dropTomahawk(room: Room, owner: PlayerState | null, at: Vec3): Entity {
  const e = spawnTomahawk(room, owner, at, { x: 0, y: 0, z: 0 });
  const d = e.data as TomahawkData;
  d.body.resting = true;
  d.restAt = room.time;
  e.s = { k: 1 };
  return e;
}

/** How many tomahawks a player may carry (loadout count plus Scavenger-style offsets). */
function carryMax(room: Room, p: PlayerState): number {
  const def = EQUIPMENT_BY_ID.get('tomahawk');
  return Math.max(0, (def?.count ?? 1) + room.modifiers.sum('equipmentCountOffset', p, 'lethal'));
}

/** Can this player take a tomahawk back right now? */
export function canRetrieveTomahawk(room: Room, p: PlayerState): boolean {
  const x = p.ext.weapons;
  return !!x && p.alive && x.lethal === 'tomahawk' && x.lethalN < carryMax(room, p);
}

/** Per tick: fly, hit, bounce, rest, get picked up, expire. */
export function updateTomahawks(room: Room, dt: number): void {
  for (const e of room.entities.byKind(TOMAHAWK_ENTITY)) {
    const t = e.data as TomahawkData | undefined;
    if (!t) {
      room.entities.remove(e.id);
      continue;
    }
    const b = t.body;
    if (t.restAt === null) {
      const prev = { ...b.pos };
      const speed = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
      stepBody(room.world, b, dt, { gravity: TOMAHAWK.gravity, restitution: TOMAHAWK.restitution });
      if (speed >= TOMAHAWK.killSpeed) {
        const hitP = playerOnPath(room, prev, b.pos, t.owner, 0.1, t.hit);
        if (hitP) {
          t.hit.add(hitP.p.id);
          const owner = t.owner ? (room.players.get(t.owner) ?? null) : null;
          room.damage({ victim: hitP.p, attacker: owner, amount: TOMAHAWK.damage, weapon: 'tomahawk', part: hitP.part, means: 'thrown', from: prev, distance: b.traveled });
          // Glance off the body and drop.
          b.pos = { ...hitP.at };
          b.vel = { x: -b.vel.x * 0.15, y: Math.min(0, b.vel.y) * 0.2, z: -b.vel.z * 0.15 };
        }
      }
      if (b.resting || b.stuck || room.time - t.born > TOMAHAWK.lifeSec) {
        b.resting = true;
        t.restAt = room.time;
        e.s = { k: 1 };
      }
      if (b.pos.y < room.map.bounds.min.y - 20) {
        room.entities.remove(e.id);
        continue;
      }
      e.x = b.pos.x;
      e.y = b.pos.y;
      e.z = b.pos.z;
      if (Math.hypot(b.vel.x, b.vel.z) > 0.5) e.yaw = Math.atan2(-b.vel.x, -b.vel.z);
      continue;
    }
    if (room.time - t.restAt > TOMAHAWK.pickupSec) {
      room.entities.remove(e.id);
      continue;
    }
    const taker = tomahawkTaker(room, e);
    if (taker) retrieve(room, e, taker);
  }
}

/** The nearest player who can take this tomahawk: walking over it, or USE within reach. */
function tomahawkTaker(room: Room, e: Entity): PlayerState | null {
  let best: PlayerState | null = null;
  let bestD = Infinity;
  for (const p of room.players.values()) {
    if (!canRetrieveTomahawk(room, p)) continue;
    const dy = e.y - p.move.y;
    if (dy < -0.8 || dy > 2.2) continue;
    const d = Math.hypot(e.x - p.move.x, e.z - p.move.z);
    const reach = p.buttons & Buttons.USE ? TOMAHAWK.useRadius : TOMAHAWK.pickupRadius;
    if (d <= reach && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

function retrieve(room: Room, e: Entity, p: PlayerState) {
  const x = wext(p);
  room.entities.remove(e.id);
  x.lethalN += 1;
  sendEquip(room, p);
  room.sendFeature(p, 'weapons.retrieve', { e: 'tomahawk', n: x.lethalN });
  room.bus.emit('weapons.retrieved', { player: p, equipment: 'tomahawk' });
}
