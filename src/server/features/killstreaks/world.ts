/**
 * Per-room killstreak context: active streak instances, destructible hardware (hit points, bullet
 * hits from `fire` events, blast damage), target selection (bots and humans alike: everything in
 * `room.players`), aim points, flight heights, effects and announcements.
 */
import { damageAtRange } from '../../../shared/ballistics';
import { PLAYER, type Team } from '../../../shared/constants';
import { KILLSTREAK_BY_ID } from '../../../shared/defs/killstreaks';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import { clamp, viewDir, type Vec3 } from '../../../shared/math';
import type { KillstreakFx } from '../../../shared/defs/perks-streaks-protocol';
import { eyeOf } from '../../combat';
import type { Entity } from '../../entities';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import './events';

/** A called-in killstreak while it is running. */
export interface Active {
  streak: string;
  owner: PlayerState;
  /** Called every tick; return false when finished. */
  update(dt: number): boolean;
  /** Tear down (remove entities). `destroyed` when killed by someone. */
  cleanup?(): void;
  /** Entities belonging to this instance. */
  entities: number[];
  done?: boolean;
  /** Set when destroyed by an enemy (for `ended`). */
  destroyedBy?: PlayerState | null;
  destroyed?: boolean;
  /** Keeps running when the owner leaves the room (the Tactical Nuke). */
  keepOnLeave?: boolean;
}

export interface Damageable {
  hp: number;
  max: number;
  air: boolean;
  /** Hit sphere radius and centre height above the entity origin. */
  radius: number;
  yOff: number;
  active: Active;
  /** Points to whoever destroys it. */
  score: number;
  /** What happens when destroyed (default: the whole active ends). */
  onDestroyed?(by: PlayerState | null): void;
}

const contexts = new WeakMap<Room, KsRoom>();
export const ksRoom = (room: Room): KsRoom => {
  let c = contexts.get(room);
  if (!c) contexts.set(room, (c = new KsRoom(room)));
  return c;
};

const DOWN: Vec3 = { x: 0, y: -1, z: 0 };

export class KsRoom {
  readonly actives: Active[] = [];
  readonly hp = new Map<number, Damageable>();
  readonly groundY: number;

  constructor(readonly room: Room) {
    const spawns = [...room.map.spawns.ffa, ...room.map.spawns.teams[0], ...room.map.spawns.teams[1]];
    this.groundY = spawns.length ? spawns.reduce((s, p) => s + p.y, 0) / spawns.length : 0;
  }

  get map() {
    return this.room.map;
  }
  get center(): Vec3 {
    const b = this.room.map.bounds;
    return { x: (b.min.x + b.max.x) / 2, y: this.groundY, z: (b.min.z + b.max.z) / 2 };
  }
  /** Half the larger horizontal extent of the map. */
  get radius(): number {
    const b = this.room.map.bounds;
    return Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
  }
  /** Flight height for helicopters / planes. */
  heliY(extra = 0): number {
    return this.groundY + Math.max(16, Math.min(24, this.radius * 0.6)) + extra;
  }
  planeY(): number {
    return this.groundY + 45;
  }

  /** Ground (or roof) height under x,z. */
  groundAt(x: number, z: number): number {
    const b = this.room.map.bounds;
    const top = b.max.y + 5;
    const hit = this.room.world.raycast({ x, y: top, z }, DOWN, top - b.min.y + 5, 'players');
    return hit ? hit.point.y : this.groundY;
  }

  /** Where `p` is aiming (world hit within 250 m), clamped inside the map, or null for the sky. */
  aimPoint(p: PlayerState): Vec3 | null {
    const eye = eyeOf(p);
    const d = viewDir(p.yaw, p.pitch);
    const hit = this.room.world.raycast(eye, d, 250, 'bullets');
    if (!hit) return null;
    return this.clampToMap(hit.point);
  }

  clampToMap(v: Vec3): Vec3 {
    const b = this.room.map.bounds;
    return { x: clamp(v.x, b.min.x + 1, b.max.x - 1), y: v.y, z: clamp(v.z, b.min.z + 1, b.max.z - 1) };
  }

  /** A point on the map edge in direction `yaw` from the centre, pushed out by `extra`. */
  edgePoint(yaw: number, extra = 25, y = this.heliY()): Vec3 {
    const c = this.center;
    const r = this.radius + extra;
    return { x: c.x - Math.sin(yaw) * r, y, z: c.z - Math.cos(yaw) * r };
  }

  add(a: Active): Active {
    this.actives.push(a);
    return a;
  }

  activeOf(owner: PlayerState, streak?: string): Active[] {
    return this.actives.filter((a) => !a.done && a.owner === owner && (!streak || a.streak === streak));
  }

  activeKind(streak: string): Active[] {
    return this.actives.filter((a) => !a.done && a.streak === streak);
  }

  /** Register an entity as destructible. */
  damageable(e: Entity, d: Omit<Damageable, 'max'> & { max?: number }): void {
    this.hp.set(e.id, { ...d, max: d.max ?? d.hp });
    e.s = { ...e.s, hp: 1 };
  }

  /** Same side: teammates, or the same player in FFA. */
  sameSide(a: PlayerState, b: PlayerState): boolean {
    return a === b || !this.room.isEnemy(a, b);
  }

  /** Enemies the hardware of `owner` may target from `from` (bots and humans alike). */
  targetsFor(owner: PlayerState, kind: string, from: Vec3, range: number, los = true): PlayerState[] {
    const out: { p: PlayerState; d: number }[] = [];
    for (const q of this.room.players.values()) {
      if (!q.alive || !this.room.isEnemy(owner, q)) continue;
      if (this.room.modifiers.any('streakTargetable', q, kind) === false) continue;
      const chest = chestOf(q);
      const d = Math.hypot(chest.x - from.x, chest.y - from.y, chest.z - from.z);
      if (d > range) continue;
      if (los && !this.room.world.lineOfSight(from, chest, 'bullets')) continue;
      out.push({ p: q, d });
    }
    return out.sort((a, b) => a.d - b.d).map((x) => x.p);
  }

  /** Damage one entity; destroys it at 0. Returns damage dealt. */
  hurtEntity(id: number, amount: number, by: PlayerState | null): number {
    const d = this.hp.get(id);
    const e = this.room.entities.get(id);
    if (!d || !e || d.hp <= 0 || amount <= 0) return 0;
    if (by && this.sameSide(by, d.active.owner)) return 0;
    const dealt = Math.min(d.hp, amount);
    d.hp -= amount;
    e.s = { ...e.s, hp: Math.max(0, Math.round((d.hp / d.max) * 100) / 100) };
    if (by) by.session?.send({ t: 'hit', victim: `ent:${id}`, part: 'torso', damage: Math.round(dealt), kill: d.hp <= 0 });
    if (d.hp <= 0) {
      this.hp.delete(id);
      this.fx({ kind: 'destroyed', x: e.x, y: e.y + d.yOff, z: e.z, r: d.air ? 6 : 3 });
      if (by && d.score > 0) this.room.addPlayerScore(by, d.score, 'killstreak_destroyed');
      this.room.bus.emit('killstreaks.destroyed', { owner: d.active.owner, id: d.active.streak, kind: e.kind, by });
      if (d.onDestroyed) d.onDestroyed(by);
      else {
        d.active.destroyed = true;
        d.active.destroyedBy = by;
        d.active.done = true;
      }
    }
    return dealt;
  }

  /** Bullets: every `fire` event is tested against enemy hardware between the muzzle and the impact. */
  onFire(shooter: PlayerState, weapon: string, origin: Vec3, dir: Vec3, end: Vec3): void {
    if (!this.hp.size) return;
    const maxT = Math.hypot(end.x - origin.x, end.y - origin.y, end.z - origin.z) + 0.5;
    const def = WEAPON_BY_ID.get(weapon);
    let best: { id: number; t: number } | null = null;
    for (const [id, d] of this.hp) {
      if (this.sameSide(shooter, d.active.owner)) continue;
      const e = this.room.entities.get(id);
      if (!e) continue;
      const t = raySphere(origin, dir, { x: e.x, y: e.y + d.yOff, z: e.z }, d.radius);
      if (t !== null && t <= maxT && (!best || t < best.t)) best = { id, t };
    }
    if (!best) return;
    const e = this.room.entities.get(best.id)!;
    const base = def ? damageAtRange(def, best.t) * Math.max(1, Math.min(4, def.pellets ?? 1)) : 30;
    this.hurtEntity(best.id, base * this.room.modifiers.mul('killstreakDamageDealt', shooter, e.kind), shooter);
  }

  /** An explosion by `owner`'s streak: players (core radiusDamage) plus enemy ground hardware. */
  blast(center: Vec3, radius: number, max: number, min: number, owner: PlayerState | null, weapon: string, opts: { means?: string; fx?: KillstreakFx['kind'] | null } = {}): PlayerState[] {
    const fxKind = opts.fx === undefined ? (radius >= 6 ? 'bigboom' : 'boom') : opts.fx;
    if (fxKind) this.fx({ kind: fxKind, x: center.x, y: center.y, z: center.z, r: radius });
    // Lifted a little so a blast on the floor isn't blocked by the floor's own surface.
    const hit = this.room.radiusDamage({ x: center.x, y: center.y + 0.3, z: center.z }, radius, max, min, { attacker: owner, weapon, means: opts.means ?? 'killstreak' });
    for (const [id, d] of [...this.hp]) {
      if (d.air) continue;
      const e = this.room.entities.get(id);
      if (!e) continue;
      const dist = Math.hypot(e.x - center.x, e.y + d.yOff - center.y, e.z - center.z);
      if (dist <= radius) this.hurtEntity(id, max + (min - max) * (dist / radius), owner);
    }
    return hit;
  }

  fx(f: KillstreakFx): void {
    this.room.sendFeature(null, 'killstreaks.fx', { ...f, x: round(f.x), y: round(f.y), z: round(f.z) });
  }

  /** Remove an entity and its hit points. */
  removeEntity(id: number): void {
    this.hp.delete(id);
    this.room.entities.remove(id);
  }

  /** Step every active; finished ones end (and announce). */
  update(dt: number): void {
    for (const a of [...this.actives]) {
      if (!a.done) {
        let keep = false;
        try {
          keep = a.update(dt);
        } catch (err) {
          this.room.log(`killstreak ${a.streak} failed: ${String(err)}`);
        }
        if (!keep) a.done = true;
      }
      if (a.done) this.finish(a);
    }
  }

  finish(a: Active, announce = true): void {
    const i = this.actives.indexOf(a);
    if (i < 0) return;
    this.actives.splice(i, 1);
    a.done = true;
    try {
      a.cleanup?.();
    } catch (err) {
      this.room.log(`killstreak ${a.streak} cleanup failed: ${String(err)}`);
    }
    for (const id of a.entities) this.removeEntity(id);
    if (!announce) return;
    const by = a.destroyedBy ?? null;
    this.room.bus.emit('killstreaks.ended', { player: a.owner, id: a.streak, destroyed: !!a.destroyed, by });
    this.room.sendFeature(null, 'killstreaks.ended', { id: a.streak, owner: a.owner.id, team: a.owner.team, destroyed: !!a.destroyed, by: by?.id ?? null });
  }

  /** End everything (match end, room reset). */
  clear(): void {
    for (const a of [...this.actives]) this.finish(a, false);
    this.hp.clear();
  }

  /** End every streak owned by a player (they left), except those that outlive their owner. */
  clearOwner(p: PlayerState): void {
    for (const a of [...this.actives]) if (a.owner === p && !a.keepOnLeave) this.finish(a, false);
  }

  /** Team (or FFA player id) key. */
  side(p: PlayerState): Team | string {
    return p.team === null ? p.id : p.team;
  }

  isAir(streak: string): boolean {
    return !!KILLSTREAK_BY_ID.get(streak)?.air;
  }
}

export const chestOf = (q: PlayerState): Vec3 => ({ x: q.move.x, y: q.move.y + (q.move.crouched ? PLAYER.crouchHeight : PLAYER.height) * 0.62, z: q.move.z });

const round = (v: number) => Math.round(v * 100) / 100;

/** Ray (unit dir) vs sphere: distance to the first hit or null. */
export function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number | null {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t = -b - s;
  if (t >= 0) return t;
  const t2 = -b + s;
  return t2 >= 0 ? 0 : null;
}

/** Turn `from` toward `to` (radians) by at most `max`. */
export function turnToward(from: number, to: number, max: number): number {
  let d = to - from;
  d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return from + Math.max(-max, Math.min(max, d));
}
