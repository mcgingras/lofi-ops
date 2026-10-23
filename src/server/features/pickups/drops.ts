/**
 * Dropped guns: spawning (death, swap), the fall to the ground, despawn and the per-room cap, the
 * swap itself and the walk-over ammo take. All server-authoritative; drops are `PICKUP_ENTITY`
 * entities whose server state lives in `entity.data` (so `room.entities.clear()` at match start
 * clears them too).
 */
import { canDropWeapon, dropScore, PICKUP, PICKUP_ENTITY, type DropSnapState } from '../../../shared/defs/pickups';
import { packWeaponState } from '../../../shared/defs/pack-a-punch';
import { isWonderWeapon } from '../../../shared/defs/weapons';
import { WONDER_DROP_LIFE_SEC } from '../../../shared/defs/wonder';
import type { Vec3 } from '../../../shared/math';
import { eyeOf } from '../../combat';
import type { Entity } from '../../entities';
import { makeWeapon, type PlayerState, type WeaponState } from '../../player';
import type { Room } from '../../room';

/** The underbarrel launcher's slot (weapons feature): never dropped, never swapped from. */
export const GL_SLOT = 2;
const GL_ID = 'gl';

export interface DropData {
  weapon: string;
  attachments: string[];
  camo: string;
  mag: number;
  reserve: number;
  /** Underbarrel grenade launcher rounds that go with the gun. */
  gl: { mag: number; reserve: number } | null;
  /** Pack-a-Punched (killstreak): it stays packed on the ground and for whoever takes it. */
  pap?: boolean;
  vx: number;
  vy: number;
  vz: number;
  landed: boolean;
  born: number;
  expires: number;
  /** Who dropped it (the dead player or the swapper), and why. */
  from: string | null;
  reason: 'death' | 'swap';
}

export type DropEntity = Entity & { data: DropData; s: DropSnapState & Record<string, string | number | boolean> };

declare module '../../../shared/events' {
  interface RoomEvents<P> {
    /** A gun hit the floor (`reason` death or swap). */
    'pickups.dropped': { player: P | null; weapon: string; entity: number; reason: 'death' | 'swap' };
    /** `player` swapped the gun in `slot` for a dropped one. */
    'pickups.swapped': { player: P; taken: string; dropped: string | null; slot: number };
    /** `player` walked over a copy of a gun they carry and took `amount` rounds. */
    'pickups.ammo': { player: P; weapon: string; amount: number };
  }
}

export const isDrop = (e: Entity | undefined): e is DropEntity => !!e && e.kind === PICKUP_ENTITY && !!e.data;
export const dropsOf = (room: Room): DropEntity[] => room.entities.byKind(PICKUP_ENTITY).filter(isDrop);

const hasGl = (w: WeaponState | undefined) => !!w && w.def.attachmentIds.includes(GL_ID);
const glSlot = (p: PlayerState): WeaponState | null => {
  const w = p.weapons[GL_SLOT];
  return w && w.def.base.id === GL_ID ? w : null;
};

/** Drops are off in wager matches (CoD wagers have none). */
export const dropsEnabled = (room: Room) => !room.mode.wager;

/**
 * Put a gun on the ground at `at` (feet), tossed with `vel`. Copies its ammo, attachments and camo.
 * Returns the entity, or null for weapons that never drop or are completely empty.
 */
export function spawnDrop(room: Room, w: WeaponState, at: Vec3, vel: Vec3, from: PlayerState | null, gl: WeaponState | null, reason: 'death' | 'swap'): DropEntity | null {
  if (!dropsEnabled(room)) return null;
  const id = w.def.base.id;
  if (!canDropWeapon(id) || w.mag + w.reserve <= 0) return null;
  const existing = dropsOf(room);
  for (let i = 0; existing.length - i >= PICKUP.maxPerRoom; i++) room.entities.remove(existing[i]!.id);
  const data: DropData = {
    weapon: id,
    attachments: [...w.def.attachmentIds],
    camo: w.camo,
    mag: w.mag,
    reserve: w.reserve,
    gl: gl ? { mag: gl.mag, reserve: gl.reserve } : null,
    ...(w.pap ? { pap: true } : {}),
    vx: vel.x,
    vy: vel.y,
    vz: vel.z,
    landed: false,
    born: room.time,
    // A dropped wonder weapon (Mystery Box) is gone sooner.
    expires: room.time + (isWonderWeapon(id) ? WONDER_DROP_LIFE_SEC : PICKUP.lifeSec),
    from: from?.id ?? null,
    reason,
  };
  const s: DropSnapState = { w: id, a: data.attachments.join(','), c: w.camo, l: false, m: w.mag, r: w.reserve, o: from?.id ?? '' };
  const e = room.entities.add({ kind: PICKUP_ENTITY, x: at.x, y: at.y + PICKUP.dropHeight, z: at.z, yaw: (from?.yaw ?? 0) + (Math.random() - 0.5) * 0.6, s: { ...s }, data }) as DropEntity;
  room.bus.emit('pickups.dropped', { player: from, weapon: id, entity: e.id, reason });
  return e;
}

/** The gun a player holds right now (the launcher slot counts as the gun it hangs under). */
export function heldSlot(p: PlayerState): number {
  return p.slot >= GL_SLOT ? 0 : p.slot;
}

/** On death: the gun in their hands falls at the body. */
export function dropOnDeath(room: Room, victim: PlayerState): DropEntity | null {
  const slot = heldSlot(victim);
  const w = victim.weapons[slot];
  if (!w) return null;
  const m = victim.move;
  const a = Math.random() * Math.PI * 2;
  const vel = { x: m.vx * 0.4 + Math.cos(a) * 0.6, y: 1.2 + Math.random() * 0.8, z: m.vz * 0.4 + Math.sin(a) * 0.6 };
  return spawnDrop(room, w, m, vel, victim, hasGl(w) ? glSlot(victim) : null, 'death');
}

/** Fall, spin, land; despawn when old. Called every tick. */
export function updateDrops(room: Room, dt: number): void {
  const minY = room.map.bounds.min.y - 5;
  for (const e of dropsOf(room)) {
    const d = e.data;
    if (room.time >= d.expires) {
      room.entities.remove(e.id);
      continue;
    }
    if (d.landed) continue;
    d.vy -= PICKUP.gravity * dt;
    let nx = e.x + d.vx * dt;
    let nz = e.z + d.vz * dt;
    if ((d.vx || d.vz) && !room.world.lineOfSight({ x: e.x, y: e.y, z: e.z }, { x: nx, y: e.y, z: nz }, 'players')) {
      d.vx = d.vz = 0;
      nx = e.x;
      nz = e.z;
    }
    const ny = e.y + d.vy * dt;
    const bottom = e.y - PICKUP.restHeight;
    const ground = d.vy <= 0 ? room.world.groundBelow(nx, nz, bottom + 0.05, e.y - ny + 0.1) : null;
    e.x = nx;
    e.z = nz;
    if (ground !== null && ny - PICKUP.restHeight <= ground) {
      e.y = ground + PICKUP.restHeight;
      land(e);
    } else {
      e.y = ny;
      e.yaw += PICKUP.spin * dt;
      if (e.y < minY) room.entities.remove(e.id);
      else if (room.time - d.born > 4) land(e); // wedged somewhere: just lie there
    }
  }
}

function land(e: DropEntity) {
  e.data.landed = true;
  e.data.vx = e.data.vy = e.data.vz = 0;
  e.s = { ...e.s, l: true };
}

/** Why `p` can't swap for `drop` now (null = they can). Server validation for humans and bots. */
export function swapBlocker(room: Room, p: PlayerState, drop: Entity | undefined, opts: { slot?: number; ignoreLook?: boolean } = {}): string | null {
  if (room.phase !== 'playing') return 'phase';
  if (!p.alive) return 'dead';
  if (!isDrop(drop)) return 'gone';
  if (!drop.data.landed) return 'falling';
  const slot = opts.slot ?? p.slot;
  if (slot < 0 || slot >= GL_SLOT || !p.weapons[slot]) return 'slot';
  if (carriesWeapon(p, drop.data.weapon)) return 'same_weapon';
  if (justDropped(room, p, drop)) return 'just_dropped';
  if (room.modifiers.any('useClaimed', p) === true) return 'claimed';
  const eye = eyeOf(p);
  if (dropScore(p.move, eye.y, p.yaw, p.pitch, drop) === null) return 'far';
  if (!room.world.lineOfSight(eye, { x: drop.x, y: drop.y + 0.1, z: drop.z }, 'players')) return 'blocked';
  return null;
}

/** The gun `p` swapped away a moment ago (no taking it straight back). */
export const justDropped = (room: Room, p: PlayerState, d: DropEntity) => d.data.reason === 'swap' && d.data.from === p.id && room.time - d.data.born < PICKUP.reswapSec;

export const carriesWeapon = (p: PlayerState, id: string) => p.weapons.slice(0, GL_SLOT).some((w) => w.def.base.id === id);

/**
 * Swap the gun in `slot` for a dropped one: you take it with its ammo, yours falls where you stand
 * with its ammo. Assumes `swapBlocker` said yes.
 */
export function swapFor(room: Room, p: PlayerState, drop: DropEntity, slot = p.slot): void {
  const d = drop.data;
  const old = p.weapons[slot]!;
  const hadGlSlot = glSlot(p);
  const nw = makeWeapon({ weapon: d.weapon, attachments: d.attachments, camo: d.camo }, d.weapon);
  // A packed gun stays packed (its ammo is what was left in it, set below).
  if (d.pap) packWeaponState(nw);
  nw.mag = Math.max(0, Math.min(d.mag, nw.def.magazine));
  nw.reserve = Math.max(0, d.reserve);
  nw.creditTime = room.time;
  room.entities.remove(drop.id);
  p.weapons[slot] = nw;
  if (slot === p.slot) {
    // The new gun comes up like a weapon switch.
    p.reloadEnd = 0;
    p.swapEnd = room.time + ((nw.def.swapMs ?? 500) / 1000) * room.modifiers.mul('swapMultiplier', p);
  }

  // The underbarrel launcher slot follows the guns that carry one.
  const glGoesWithOld = hasGl(old) && !!hadGlSlot;
  const anyGl = hasGl(p.weapons[0]) || hasGl(p.weapons[1]);
  if (hadGlSlot && !anyGl) p.weapons.splice(GL_SLOT, 1);
  else if (anyGl && (!hadGlSlot || (glGoesWithOld && hasGl(nw)))) {
    const gl = makeWeapon({ weapon: GL_ID, attachments: [], camo: nw.camo }, GL_ID);
    if (d.gl) {
      gl.mag = Math.min(gl.def.magazine, d.gl.mag);
      gl.reserve = d.gl.reserve;
    }
    p.weapons[GL_SLOT] = gl;
  }

  const fwd = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
  // Its launcher rounds go with the dropped gun unless another carried gun keeps the launcher slot.
  const glDropped = glGoesWithOld && (!anyGl || hasGl(nw)) ? hadGlSlot : null;
  const dropped = spawnDrop(room, old, p.move, { x: fwd.x * 1.2 + p.move.vx * 0.3, y: 1.5, z: fwd.z * 1.2 + p.move.vz * 0.3 }, p, glDropped, 'swap');
  if (slot === p.slot) room.bus.emit('weaponSwitch', { player: p, slot, weapon: nw.def.base.id });
  room.bus.emit('pickups.swapped', { player: p, taken: d.weapon, dropped: dropped ? old.def.base.id : null, slot });
  room.sendFeature(p, 'pickups.swapped', { taken: d.weapon, dropped: dropped ? old.def.base.id : null, slot });
}

/**
 * Walking over a copy of a gun you carry: take its rounds into that gun's reserve (up to the max)
 * and remove it. Nothing happens when you're already full. Returns rounds taken.
 */
export function takeAmmo(room: Room, p: PlayerState, drop: DropEntity): number {
  const d = drop.data;
  const w = p.weapons.slice(0, GL_SLOT).find((x) => x.def.base.id === d.weapon);
  if (!w) return 0;
  const cap = Math.max(w.reserve, w.def.reserve);
  const take = Math.min(d.mag + d.reserve, cap - w.reserve);
  if (take <= 0) return 0;
  w.reserve += take;
  room.entities.remove(drop.id);
  room.bus.emit('pickups.ammo', { player: p, weapon: d.weapon, amount: take });
  room.sendFeature(p, 'pickups.ammo', { weapon: d.weapon, amount: take });
  return take;
}

/** Is `p` standing on `drop` closely enough to take ammo from it? */
export const onTopOf = (p: PlayerState, drop: Entity) => Math.hypot(p.move.x - drop.x, p.move.z - drop.z) <= PICKUP.ammoRadius && Math.abs(p.move.y - drop.y) <= PICKUP.dy;
