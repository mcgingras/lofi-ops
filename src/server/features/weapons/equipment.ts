/**
 * Lethal and tactical equipment on the server: raise (pin) on the LETHAL/TACTICAL press, hold as
 * long as the button stays down (a frag's fuse burns while held), throw on release (BO1),
 * projectiles simulated in the room entity store (`weapons.nade`), explosions through
 * `room.radiusDamage`, flashbang/concussion effects, and the underbarrel grenade launcher round.
 */
import { playerHitboxes, rayHitboxes } from '../../../shared/collision';
import { PLAYER } from '../../../shared/constants';
import { cookLeft, EQUIPMENT_BY_ID, GL_ROUND, NADE_ENTITY, THROW_RECOVERY, THROW_WINDUP, type EquipmentDef } from '../../../shared/defs/equipment';
import { Buttons } from '../../../shared/input';
import { dist, normalize, viewDir, type Vec3 } from '../../../shared/math';
import { eyeHeight } from '../../../shared/movement';
import type { Entity } from '../../entities';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { stepBody, tacticalAmount, throwVelocity, type Body } from './projectile';
import { dropTomahawk, spawnTomahawk } from './tomahawk';
import { wext, type ThrowState } from './state';

/** Server-only state carried in `entity.data`. */
export interface NadeData {
  equip: string;
  owner: string | null;
  body: Body;
  /** Room time it goes off (null = on impact after arming: launcher). */
  explodeAt: number | null;
  /** Stuck to a player (semtex): follow them at this offset. */
  stuckTo: string | null;
  offset: Vec3 | null;
  /** Launcher round: impact behaviour. */
  launcher: boolean;
}

const eyeOf = (p: PlayerState): Vec3 => ({ x: p.move.x, y: p.move.y + eyeHeight(p.move), z: p.move.z });

/** Tell a player what they're carrying. */
export function sendEquip(room: Room, p: PlayerState): void {
  const x = wext(p);
  room.sendFeature(p, 'weapons.equip', { lethal: x.lethal, lethalN: x.lethalN, tactical: x.tactical, tacticalN: x.tacticalN });
}

/** Give a player their loadout equipment at spawn. */
export function equipAtSpawn(room: Room, p: PlayerState): void {
  const x = wext(p);
  const l = p.loadout?.lethal ? EQUIPMENT_BY_ID.get(p.loadout.lethal) : undefined;
  const t = p.loadout?.tactical ? EQUIPMENT_BY_ID.get(p.loadout.tactical) : undefined;
  x.lethal = l && l.kind === 'lethal' ? l.id : null;
  x.tactical = t && t.kind === 'tactical' ? t.id : null;
  x.lethalN = l && l.kind === 'lethal' ? Math.max(0, l.count + room.modifiers.sum('equipmentCountOffset', p, 'lethal')) : 0;
  x.tacticalN = t && t.kind === 'tactical' ? Math.max(0, t.count + room.modifiers.sum('equipmentCountOffset', p, 'tactical')) : 0;
  x.throwing = null;
  x.shells = null;
  x.flashedUntil = x.stunnedUntil = 0;
  sendEquip(room, p);
}

/**
 * Start a throw (pull the pin). Returns false when there is nothing to throw or the player is busy.
 * Bots can call this directly; humans get it from the LETHAL/TACTICAL button edges.
 */
export function startThrow(room: Room, p: PlayerState, kind: 'lethal' | 'tactical'): boolean {
  if (!p.alive || room.phase !== 'playing') return false;
  const x = wext(p);
  if (x.throwing) return false;
  const id = kind === 'lethal' ? x.lethal : x.tactical;
  const n = kind === 'lethal' ? x.lethalN : x.tacticalN;
  const equip = id ? EQUIPMENT_BY_ID.get(id) : undefined;
  if (!equip || n <= 0) return false;
  if (kind === 'lethal') x.lethalN--;
  else x.tacticalN--;
  x.throwing = { equip, kind, pinAt: room.time, releasedAt: null };
  p.reloadEnd = 0;
  x.shells = null;
  // Gun lowered (core refuses to fire while switching) until the throw is done.
  p.swapEnd = Math.max(p.swapEnd, room.time + THROW_WINDUP + THROW_RECOVERY);
  sendEquip(room, p);
  // The fuse starts now, on the command that carried the press: tell the thrower which one so the
  // HUD's cook timer runs from the same input.
  if (equip.cookable) room.sendFeature(p, 'weapons.cook', { e: equip.id, seq: p.lastSeq, fuse: equip.fuse });
  return true;
}

/**
 * Per tick: advance a player's throw. While the button is held the equipment stays raised (the
 * gun stays down): a tomahawk, semtex or flashbang can be held as long as you like, a frag cooks
 * and goes off in your hand past its fuse. Releasing throws it, no sooner than THROW_WINDUP after
 * the press.
 */
export function updateThrow(room: Room, p: PlayerState): void {
  const x = wext(p);
  const t = x.throwing;
  if (!t) return;
  const held = (p.buttons & (t.kind === 'lethal' ? Buttons.LETHAL : Buttons.TACTICAL)) !== 0;
  if (t.releasedAt === null && !held) t.releasedAt = room.time;
  const now = room.time;
  if (t.releasedAt === null) {
    // Held up: keep the gun down; a frag held past its fuse goes off in hand.
    p.swapEnd = Math.max(p.swapEnd, now + THROW_RECOVERY);
    if (t.equip.cookable && cookLeft(t.equip.fuse, now - t.pinAt) <= 0) {
      x.throwing = null;
      const at = eyeOf(p);
      explode(room, at, t.equip, p.id);
    }
    return;
  }
  if (now - t.pinAt < THROW_WINDUP) return;
  x.throwing = null;
  releaseGrenade(room, p, t);
}

function releaseGrenade(room: Room, p: PlayerState, t: ThrowState): Entity {
  const dir = viewDir(p.yaw, p.pitch);
  const eye = eyeOf(p);
  // Leave the hand a little in front, to the right and below the eye (not inside a wall).
  const right = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
  let start = { x: eye.x + dir.x * 0.4 + right.x * 0.15, y: eye.y - 0.1 + dir.y * 0.4, z: eye.z + dir.z * 0.4 + right.z * 0.15 };
  if (!room.world.lineOfSight(eye, start, 'bullets')) start = { ...eye };
  const fuseLeft = t.equip.cookable ? Math.max(0.05, cookLeft(t.equip.fuse, room.time - t.pinAt)) : t.equip.fuse;
  const vel = throwVelocity(dir, t.equip.speed, t.equip.loft, { x: p.move.vx, y: p.move.vy, z: p.move.vz });
  p.swapEnd = Math.max(p.swapEnd, room.time + THROW_RECOVERY);
  room.bus.emit('weapons.thrown', { player: p, equipment: t.equip.id });
  room.sendFeature(null, 'weapons.throw', { p: p.id, e: t.equip.id });
  if (t.equip.effect === 'tomahawk') return spawnTomahawk(room, p, start, vel);
  return spawnNade(room, p, t.equip.id, start, vel, room.time + fuseLeft, false);
}

/** Put a projectile in the world. */
export function spawnNade(room: Room, owner: PlayerState | null, equip: string, pos: Vec3, vel: Vec3, explodeAt: number | null, launcher: boolean): Entity {
  const data: NadeData = { equip, owner: owner?.id ?? null, body: { pos: { ...pos }, vel: { ...vel }, stuck: false, resting: false, traveled: 0 }, explodeAt, stuckTo: null, offset: null, launcher };
  return room.entities.add({ kind: NADE_ENTITY, x: pos.x, y: pos.y, z: pos.z, yaw: Math.atan2(-vel.x, -vel.z), owner: owner?.id, team: owner?.team ?? null, s: { e: equip }, data });
}

/** Fire the underbarrel launcher (weapon behaviour for `gl`). */
export function launchGrenade(room: Room, p: PlayerState, origin: Vec3, dir: Vec3): Entity {
  const d = normalize(dir);
  const vel = { x: d.x * GL_ROUND.speed, y: d.y * GL_ROUND.speed, z: d.z * GL_ROUND.speed };
  room.bus.emit('weapons.thrown', { player: p, equipment: 'gl' });
  return spawnNade(room, p, 'gl', origin, vel, null, true);
}

/** Per tick: move every projectile, stick, detonate. */
export function updateNades(room: Room, dt: number): void {
  for (const e of room.entities.byKind(NADE_ENTITY)) {
    const n = e.data as NadeData | undefined;
    if (!n) {
      room.entities.remove(e.id);
      continue;
    }
    const equip = EQUIPMENT_BY_ID.get(n.equip);
    const b = n.body;
    if (n.stuckTo) {
      const host = room.players.get(n.stuckTo);
      if (host && n.offset) {
        b.pos = { x: host.move.x + n.offset.x, y: host.move.y + n.offset.y, z: host.move.z + n.offset.z };
      }
    } else if (!b.stuck && !b.resting) {
      const prev = { ...b.pos };
      const r = stepBody(room.world, b, dt, { gravity: n.launcher ? GL_ROUND.gravity : undefined, sticky: equip?.sticky });
      // Players in the path: launcher rounds impact, semtex sticks, others pass by.
      if (n.launcher || equip?.sticky) {
        const hitP = playerOnPath(room, prev, b.pos, n.owner, n.launcher ? 0 : 0.15);
        if (hitP) {
          if (n.launcher) {
            if (b.traveled >= GL_ROUND.armDistance) {
              explodeAt(room, e, n, hitP.at);
            } else {
              const owner = n.owner ? (room.players.get(n.owner) ?? null) : null;
              room.damage({ victim: hitP.p, attacker: owner, amount: GL_ROUND.impactDamage, weapon: 'gl', part: 'torso', means: 'impact', from: prev, distance: b.traveled });
              room.entities.remove(e.id);
            }
            continue;
          }
          n.stuckTo = hitP.p.id;
          n.offset = { x: hitP.at.x - hitP.p.move.x, y: Math.min(PLAYER.height * 0.75, Math.max(0.3, hitP.at.y - hitP.p.move.y)), z: hitP.at.z - hitP.p.move.z };
          b.stuck = true;
          e.s = { ...e.s, k: 1 };
        }
      }
      if (n.launcher && r.hit) {
        if (b.traveled >= GL_ROUND.armDistance) {
          explodeAt(room, e, n, b.pos);
          continue;
        }
        // Not armed yet: a dud that drops and fizzles.
        n.launcher = false;
        n.explodeAt = null;
        b.resting = true;
        room.schedule(1.2, () => room.entities.remove(e.id));
      }
      if (equip?.sticky && b.stuck) e.s = { ...e.s, k: 1 };
    }
    e.x = b.pos.x;
    e.y = b.pos.y;
    e.z = b.pos.z;
    if (Math.hypot(b.vel.x, b.vel.z) > 0.5) e.yaw = Math.atan2(-b.vel.x, -b.vel.z);
    if (n.explodeAt !== null && room.time >= n.explodeAt) explodeAt(room, e, n, b.pos);
    else if (b.pos.y < room.map.bounds.min.y - 20) room.entities.remove(e.id);
  }
}

function explodeAt(room: Room, e: Entity, n: NadeData, at: Vec3) {
  room.entities.remove(e.id);
  const equip = n.equip === 'gl' ? null : (EQUIPMENT_BY_ID.get(n.equip) ?? null);
  if (equip) explode(room, at, equip, n.owner);
  else {
    const owner = n.owner ? (room.players.get(n.owner) ?? null) : null;
    const c = { x: at.x, y: at.y + 0.1, z: at.z };
    room.radiusDamage(c, GL_ROUND.radius, GL_ROUND.max, GL_ROUND.min, { attacker: owner, weapon: 'gl', means: 'explosive', hitSelf: true });
    room.sendFeature(null, 'weapons.boom', { x: c.x, y: c.y, z: c.z, e: 'gl', owner: n.owner });
  }
}

/** Detonate a piece of equipment at a point. */
export function explode(room: Room, at: Vec3, equip: EquipmentDef, ownerId: string | null): void {
  const owner = ownerId ? (room.players.get(ownerId) ?? null) : null;
  const c = { x: at.x, y: at.y + 0.1, z: at.z };
  room.sendFeature(null, 'weapons.boom', { x: c.x, y: c.y, z: c.z, e: equip.id, owner: ownerId });
  if (equip.effect === 'frag' || equip.effect === 'semtex') {
    room.radiusDamage(c, equip.radius, equip.max, equip.min, { attacker: owner, weapon: equip.id, means: 'explosive', hitSelf: true });
    return;
  }
  // Tacticals: everyone who can see it (enemies and the thrower; teammates are spared).
  for (const q of room.players.values()) {
    if (!q.alive) continue;
    if (owner && q !== owner && !room.isEnemy(owner, q)) continue;
    const eye = eyeOf(q);
    if (!room.world.lineOfSight(c, eye, 'sight')) continue;
    const base = tacticalAmount(eye, viewDir(q.yaw, q.pitch), c, equip.radius, equip.effect === 'flash');
    const amount = Math.min(1, base * room.modifiers.mul('tacticalMultiplier', q));
    if (amount <= 0.02) continue;
    const dur = (equip.duration ?? 3) * amount;
    const x = wext(q);
    if (equip.effect === 'flash') {
      const active = room.time < x.flashedUntil;
      x.flashedUntil = Math.max(x.flashedUntil, room.time + dur);
      x.flashAmount = Math.max(amount, active ? x.flashAmount : 0);
      room.sendFeature(q, 'weapons.flash', { amount, dur });
    } else {
      x.stunnedUntil = Math.max(x.stunnedUntil, room.time + dur);
      x.stunAmount = amount;
      room.sendFeature(q, 'weapons.stun', { amount, dur });
    }
    room.bus.emit('weapons.tactical', { player: owner, victim: q, equipment: equip.id, amount });
  }
}

/** First living player (not the owner) whose hitboxes the segment a->b passes within `pad` of. */
export function playerOnPath(room: Room, a: Vec3, b: Vec3, ownerId: string | null, pad: number, skip?: ReadonlySet<string>): { p: PlayerState; at: Vec3; part: 'head' | 'torso' | 'legs' } | null {
  const len = dist(a, b);
  if (len < 1e-6) return null;
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len, z: (b.z - a.z) / len };
  let best: { p: PlayerState; at: Vec3; t: number; part: 'head' | 'torso' | 'legs' } | null = null;
  for (const q of room.players.values()) {
    if (!q.alive || q.id === ownerId || skip?.has(q.id)) continue;
    const hb = playerHitboxes(q.move, q.move.crouched);
    if (pad > 0) for (const k of ['head', 'torso', 'legs'] as const) {
      hb[k] = { min: { x: hb[k].min.x - pad, y: hb[k].min.y - pad, z: hb[k].min.z - pad }, max: { x: hb[k].max.x + pad, y: hb[k].max.y + pad, z: hb[k].max.z + pad } };
    }
    const hit = rayHitboxes(a, d, hb, len);
    if (hit && (!best || hit.t < best.t)) best = { p: q, at: { x: a.x + d.x * hit.t, y: a.y + d.y * hit.t, z: a.z + d.z * hit.t }, t: hit.t, part: hit.part };
  }
  return best ? { p: best.p, at: best.at, part: best.part } : null;
}

/**
 * A player died holding a lethal up: a grenade drops at their feet with what's left of the fuse,
 * a tomahawk drops as a pickup.
 */
export function dropCooked(room: Room, p: PlayerState): void {
  const x = wext(p);
  const t = x.throwing;
  x.throwing = null;
  if (!t || t.kind !== 'lethal') return;
  if (t.equip.effect === 'tomahawk') {
    dropTomahawk(room, p, { x: p.move.x, y: p.move.y + 0.1, z: p.move.z });
    return;
  }
  const left = t.equip.cookable ? t.equip.fuse - (room.time - t.pinAt) : t.equip.fuse;
  spawnNade(room, p, t.equip.id, { x: p.move.x, y: p.move.y + 0.6, z: p.move.z }, { x: 0, y: 1, z: 0 }, room.time + Math.max(0.1, left), false);
}

/** Is this player flashed / stunned right now (bots read this)? Returns 0..1. */
export function flashedAmount(room: Room, p: PlayerState): number {
  const x = p.ext.weapons;
  return x && room.time < x.flashedUntil ? x.flashAmount : 0;
}
export function stunnedAmount(room: Room, p: PlayerState): number {
  const x = p.ext.weapons;
  return x && room.time < x.stunnedUntil ? x.stunAmount : 0;
}
