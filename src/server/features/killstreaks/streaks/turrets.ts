/**
 * Sentry Gun and SAM Turret: carried and placed like BO1's (`maps/mp/_turret_killstreak.gsc`; the
 * carrying lives in carry.ts, the placement rule in shared/defs/turret-place.ts).
 *
 * - Sentry (shared/defs/sentry.ts for the numbers): arms 1 s after it is put down, then sweeps its
 *   arc (60 degrees either side of the way it was placed facing). An enemy it can see inside the
 *   arc and range (the bots' sight rules: drawn cover hides you; Ghost Pro hides you) becomes its
 *   target: it turns at a limited rate, and only after an acquisition delay does it fire, in
 *   bursts, one bullet per 0.112 s, with damage and accuracy falling off with distance. Losing sight
 *   of the target for a moment drops it. Bullets do 0.8x to it, explosives 2x, a knife kills it;
 *   flashbangs and concussions stun it for 5 s. Its 60 s only run while it stands on the ground.
 * - SAM: fires homing missiles at enemy aircraft (Spy Planes, helicopters, Chopper Gunner, drop
 *   choppers, Valkyrie rockets). Can be shot / blown up.
 * Hacker Pro: an enemy hacker holding USE beside one for `hackSec` takes it over (it is out for
 * 2.5 s, then works for them, and only its original owner may pick it up again: by hacking it back).
 * The owner can pick a placed turret up again with USE (carry.ts) and put it down elsewhere.
 */
import { KILLSTREAK_BY_ID, KS_ENTITY } from '../../../../shared/defs/killstreaks';
import { PERK_TUNING } from '../../../../shared/defs/perks';
import { angleDiff, inSentryArc, SENTRY, sentryDamage, sentryHitChance, sentryTurn } from '../../../../shared/defs/sentry';
import { turretPlacement, type TurretSpot } from '../../../../shared/defs/turret-place';
import { Buttons } from '../../../../shared/input';
import { yawTo, type Vec3 } from '../../../../shared/math';
import { q3 } from '../../../../shared/protocol';
import type { Entity } from '../../../entities';
import type { PlayerState } from '../../../player';
import { botCanHit, botCanSee, eyePointOf } from '../../bots/sight';
import { isPro } from '../../perks/common';
import type { CarriedTurret } from '../events';
import { markDirty } from '../state';
import { turnToward, chestOf, type Active, type Damageable, type KsRoom } from '../world';
import type { CallArgs } from './types';

export { SENTRY };
export const SAM = { range: 160, reload: 2.5, missileSpeed: 60, missileDamage: 1000, missiles: 8 };

export type TurretKind = 'sentry' | 'sam';

const STREAK_OF: Record<TurretKind, string> = { sentry: 'sentry_gun', sam: 'sam_turret' };
const KIND_OF: Record<TurretKind, string> = { sentry: KS_ENTITY.sentry, sam: KS_ENTITY.sam };
export const turretKindOf = (streak: string): TurretKind | null => (streak === 'sentry_gun' ? 'sentry' : streak === 'sam_turret' ? 'sam' : null);

/** Every turret of a room (placed or carried after a pickup). */
const roomTurrets = new WeakMap<KsRoom, Set<TurretRun>>();
export function turretsOf(ctx: KsRoom): TurretRun[] {
  return [...(roomTurrets.get(ctx) ?? [])];
}

type Pose = { x: number; y: number; z: number; yaw: number };

/** One placed (or picked-up) turret: its entity, hit points, lifetime, hack and targeting. */
export class TurretRun implements CarriedTurret {
  readonly act: Active;
  readonly ent: Entity;
  /** Who called it in: only they may pick it up, and only while it is theirs (not hacked). */
  readonly original: PlayerState;
  /** Carrying it (picked up after being placed), or null while it stands. */
  carrier: PlayerState | null = null;
  private home: Pose;
  private baseYaw: number;
  private life = 0;
  private readonly lifeMax: number;
  /** Its hit points while carried (it can't be hurt in hand). */
  private stored: Damageable | null = null;
  private armAt: number;
  private stunUntil = 0;
  private hack = { hacker: null as string | null, t: 0 };
  // Sentry targeting.
  private target: PlayerState | null = null;
  private part: 'body' | 'head' = 'body';
  private acquiredAt = 0;
  private lastSeen = 0;
  private retargetAt = 0;
  private nextShot = 0;
  private burstEnd = 0;
  private pauseEnd = 0;
  private lastShot = -1;
  private scan = 1;
  // SAM.
  private samNext: number;
  private samLeft = SAM.missiles;
  private missiles: { ent: Entity; target: number; life: number }[] = [];

  constructor(
    private ctx: KsRoom,
    owner: PlayerState,
    readonly kind: TurretKind,
    at: Pose,
  ) {
    const room = ctx.room;
    const def = KILLSTREAK_BY_ID.get(STREAK_OF[kind])!;
    this.original = owner;
    this.home = { ...at };
    this.baseYaw = at.yaw;
    this.lifeMax = kind === 'sentry' ? SENTRY.durationSec : (def.durationSec ?? 60);
    this.armAt = room.time + SENTRY.armSec;
    this.samNext = room.time + 0.5;
    this.ent = room.entities.add({ kind: KIND_OF[kind], x: at.x, y: at.y, z: at.z, yaw: at.yaw, owner: owner.id, team: owner.team, s: { b: q3(at.yaw) } });
    this.act = {
      streak: STREAK_OF[kind],
      owner,
      entities: [this.ent.id],
      update: (dt) => this.update(dt),
      cleanup: () => this.cleanup(),
    };
    ctx.add(this.act);
    if (kind === 'sentry') ctx.damageable(this.ent, { hp: SENTRY.hp, air: false, radius: SENTRY.radius, yOff: SENTRY.yOff, active: this.act, score: 100, scale: { bullet: SENTRY.bulletScale, explosive: SENTRY.explosiveScale } });
    else ctx.damageable(this.ent, { hp: def.hp ?? 450, air: false, radius: 0.9, yOff: 0.8, active: this.act, score: 100 });
    let set = roomTurrets.get(ctx);
    if (!set) roomTurrets.set(ctx, (set = new Set()));
    set.add(this);
  }

  get owner(): PlayerState {
    return this.act.owner;
  }
  /** Hacked away from whoever called it in. */
  get hacked(): boolean {
    return this.act.owner !== this.original;
  }
  get alive(): boolean {
    return !this.act.done && !!this.ctx.room.entities.get(this.ent.id);
  }
  /** Seconds of its life left. */
  get left(): number {
    return this.lifeMax - this.life;
  }
  get armed(): boolean {
    return this.ctx.room.time >= this.armAt && this.ctx.room.time >= this.stunUntil;
  }
  get facing(): number {
    return this.baseYaw;
  }
  get tracking(): PlayerState | null {
    return this.target;
  }

  /** The owner took it back in hand (carry.ts). */
  pickUp(p: PlayerState): void {
    this.carrier = p;
    this.stored = this.ctx.hp.get(this.ent.id) ?? this.stored;
    this.ctx.hp.delete(this.ent.id);
    this.dropTarget();
    this.burstEnd = this.pauseEnd = 0;
    for (const m of this.missiles) this.ctx.removeEntity(m.ent.id);
    this.missiles = [];
    this.follow(p);
  }

  place(spot: { x: number; y: number; z: number; yaw: number }): void {
    const room = this.ctx.room;
    this.carrier = null;
    this.home = { x: spot.x, y: spot.y, z: spot.z, yaw: spot.yaw };
    this.baseYaw = spot.yaw;
    this.ent.x = spot.x;
    this.ent.y = spot.y;
    this.ent.z = spot.z;
    this.ent.yaw = spot.yaw;
    if (this.stored && this.stored.hp > 0) this.ctx.hp.set(this.ent.id, this.stored);
    this.stored = null;
    this.armAt = Math.max(this.armAt, room.time + SENTRY.armSec);
    this.scan = 1;
    this.sync(false);
  }

  putBack(): void {
    this.place(this.home);
  }

  /** Flashbang / concussion (or a hack): out for `sec`. */
  stun(sec: number): void {
    this.stunUntil = Math.max(this.stunUntil, this.ctx.room.time + sec);
    this.dropTarget();
    this.burstEnd = 0;
  }

  private follow(p: PlayerState): void {
    const spot = turretPlacement(this.ctx.room.world, this.ctx.room.map, p.move, p.yaw);
    this.ent.x = spot.x;
    this.ent.y = spot.y;
    this.ent.z = spot.z;
    this.ent.yaw = spot.yaw;
    this.baseYaw = spot.yaw;
    this.ent.s = { ...this.ent.s, c: 1, v: spot.valid ? 1 : 0, b: q3(spot.yaw), f: 0, t: '', a: 0 };
  }

  private dropTarget(): void {
    this.target = null;
    this.acquiredAt = 0;
  }

  private update(dt: number): boolean {
    const room = this.ctx.room;
    if (!room.entities.get(this.ent.id)) return false;
    if (this.carrier) {
      this.follow(this.carrier);
      return true;
    }
    this.life += dt;
    if (this.life >= this.lifeMax) return this.missiles.length > 0 && this.samTick(dt, false);
    if (this.hackTick(dt)) this.stun(SENTRY.hackStunSec);
    if (this.kind === 'sam') return this.samTick(dt, this.armed);
    if (this.armed) this.sentryTick(dt);
    else this.dropTarget();
    this.sync(room.time - this.lastShot < 0.15);
    return true;
  }

  private sync(firing: boolean): void {
    const s = this.ent.s ?? {};
    const next: Record<string, number | string | boolean> = {
      b: q3(this.baseYaw),
      f: firing ? 1 : 0,
      t: this.target?.id ?? '',
      a: this.target && this.ctx.room.time - this.acquiredAt >= SENTRY.acquireSec ? 1 : 0,
      st: this.ctx.room.time < this.stunUntil ? 1 : 0,
    };
    if (s.hp !== undefined) next.hp = s.hp;
    if (Object.keys(next).length !== Object.keys(s).length || Object.entries(next).some(([k, v]) => s[k] !== v)) this.ent.s = next;
  }

  // -------------------------------------------------------------------------------------------
  // Sentry: sweep, acquire, track, burst
  // -------------------------------------------------------------------------------------------

  private muzzle(): Vec3 {
    return { x: this.ent.x, y: this.ent.y + SENTRY.muzzle, z: this.ent.z };
  }

  /** The part of `q` it can see from the muzzle (drawn cover counts, like bots), or null. */
  private sees(q: PlayerState, from: Vec3): 'body' | 'head' | null {
    const room = this.ctx.room;
    const c = chestOf(q);
    if (Math.hypot(c.x - from.x, c.y - from.y, c.z - from.z) > SENTRY.range) return null;
    if (!inSentryArc(this.baseYaw, yawTo(from, c))) return null;
    if (botCanSee(room.world, room.map, from, c)) return 'body';
    if (botCanSee(room.world, room.map, from, eyePointOf(q))) return 'head';
    return null;
  }

  private aimPoint(q: PlayerState): Vec3 {
    return this.part === 'head' ? eyePointOf(q) : chestOf(q);
  }

  private sentryTick(dt: number): void {
    const room = this.ctx.room;
    const now = room.time;
    const from = this.muzzle();
    const t = this.target;
    if (t) {
      const ok = t.alive && room.isEnemy(this.owner, t) && room.modifiers.any('streakTargetable', t, KS_ENTITY.sentry) !== false;
      const part = ok ? this.sees(t, from) : null;
      if (!ok) this.dropTarget();
      else if (part) {
        this.part = part;
        this.lastSeen = now;
      } else if (now - this.lastSeen > SENTRY.loseSec) this.dropTarget();
    }
    if (!this.target && now >= this.retargetAt) {
      this.retargetAt = now + 0.1;
      for (const q of this.ctx.targetsFor(this.owner, KS_ENTITY.sentry, from, SENTRY.range, false)) {
        const part = this.sees(q, from);
        if (!part) continue;
        this.target = q;
        this.part = part;
        this.acquiredAt = now;
        this.lastSeen = now;
        break;
      }
    }
    const target = this.target;
    if (!target) {
      // Nothing to shoot: end the burst and sweep the arc.
      if (this.burstEnd > now) this.burstEnd = now;
      const edge = this.baseYaw + this.scan * SENTRY.arcHalf * 0.9;
      this.ent.yaw = sentryTurn(this.ent.yaw, edge, this.baseYaw, dt, SENTRY.scanRate);
      if (Math.abs(angleDiff(this.ent.yaw, edge)) < 0.01) this.scan = -this.scan;
      this.endBurst(now);
      return;
    }
    const aim = this.aimPoint(target);
    const want = yawTo(from, aim);
    this.ent.yaw = sentryTurn(this.ent.yaw, want, this.baseYaw, dt);
    const aligned = Math.abs(angleDiff(want, this.ent.yaw)) <= SENTRY.fireCone;
    const ready = now - this.acquiredAt >= SENTRY.acquireSec;
    const clear = now - this.lastSeen < 1e-6 && botCanHit(room.world, room.map, from, aim);
    if (aligned && ready && clear) {
      if (now >= this.burstEnd && now >= this.pauseEnd) this.burstEnd = now + SENTRY.burst.min + Math.random() * SENTRY.burst.range;
      if (now < this.burstEnd && now >= this.nextShot) {
        this.nextShot = now + SENTRY.fireInterval;
        this.lastShot = now;
        const dist = Math.hypot(aim.x - from.x, aim.y - from.y, aim.z - from.z);
        fireBullet(this.ctx, this.owner, from, aim, target, 'sentry_gun', sentryDamage(dist), sentryHitChance(dist), `ent:${this.ent.id}`);
      }
    } else if (this.burstEnd > now) this.burstEnd = now;
    this.endBurst(now);
  }

  /** A burst that ran out starts its pause. */
  private endBurst(now: number): void {
    if (this.burstEnd > 0 && now >= this.burstEnd && this.pauseEnd < this.burstEnd) this.pauseEnd = this.burstEnd + SENTRY.pause.min + Math.random() * SENTRY.pause.range;
  }

  // -------------------------------------------------------------------------------------------
  // SAM
  // -------------------------------------------------------------------------------------------

  private samTick(dt: number, active: boolean): boolean {
    const room = this.ctx.room;
    const ent = this.ent;
    const ctx = this.ctx;
    if (active) {
      // Nearest enemy aircraft in range.
      let best: { id: number; d: number; e: Entity } | null = null;
      for (const [id, d] of ctx.hp) {
        if (!d.air || ctx.sameSide(d.active.owner, this.owner)) continue;
        const e = room.entities.get(id);
        if (!e) continue;
        const dist = Math.hypot(e.x - ent.x, e.y - ent.y, e.z - ent.z);
        if (dist <= SAM.range && (!best || dist < best.d)) best = { id, d: dist, e };
      }
      if (best) ent.yaw = turnToward(ent.yaw, Math.atan2(-(best.e.x - ent.x), -(best.e.z - ent.z)), 3 * dt);
      if (best && this.samLeft > 0 && room.time >= this.samNext) {
        this.samNext = room.time + SAM.reload;
        this.samLeft--;
        const m = room.entities.add({ kind: KS_ENTITY.missile, x: ent.x, y: ent.y + 1.4, z: ent.z, yaw: ent.yaw, owner: this.owner.id, team: this.owner.team });
        this.act.entities.push(m.id);
        this.missiles.push({ ent: m, target: best.id, life: 6 });
        ctx.fx({ kind: 'sam_launch', x: ent.x, y: ent.y + 1.4, z: ent.z });
      }
    }
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i]!;
      const t = room.entities.get(m.target);
      m.life -= dt;
      if (!t || m.life <= 0 || !ctx.hp.has(m.target)) {
        ctx.removeEntity(m.ent.id);
        this.missiles.splice(i, 1);
        continue;
      }
      const dx = t.x - m.ent.x;
      const dy = t.y - m.ent.y;
      const dz = t.z - m.ent.z;
      const d = Math.hypot(dx, dy, dz);
      const step = SAM.missileSpeed * dt;
      if (d <= step + 2) {
        ctx.fx({ kind: 'boom', x: t.x, y: t.y, z: t.z, r: 4 });
        ctx.hurtEntity(m.target, SAM.missileDamage, this.owner);
        ctx.removeEntity(m.ent.id);
        this.missiles.splice(i, 1);
        continue;
      }
      m.ent.x += (dx / d) * step;
      m.ent.y += (dy / d) * step;
      m.ent.z += (dz / d) * step;
      m.ent.yaw = Math.atan2(-dx, -dz);
    }
    const s = ent.s ?? {};
    const st = room.time < this.stunUntil ? 1 : 0;
    if (s.st !== st || s.c !== undefined) ent.s = { b: q3(this.baseYaw), st, ...(s.hp !== undefined ? { hp: s.hp } : {}) };
    return active || this.missiles.length > 0 || this.life < this.lifeMax;
  }

  // -------------------------------------------------------------------------------------------
  // Hacker Pro
  // -------------------------------------------------------------------------------------------

  /** Hacker Pro takeover; returns true when it changed hands this tick. */
  private hackTick(dt: number): boolean {
    const ctx = this.ctx;
    const ent = this.ent;
    const state = this.hack;
    let who: PlayerState | null = null;
    for (const q of ctx.room.players.values()) {
      if (!q.alive || ctx.sameSide(q, this.owner) || !(q.buttons & Buttons.USE) || !isPro(q, 'hacker')) continue;
      if (Math.hypot(q.move.x - ent.x, q.move.z - ent.z) <= PERK_TUNING.hackRadius) {
        who = q;
        break;
      }
    }
    if (!who || (state.hacker && state.hacker !== who.id)) {
      state.hacker = null;
      state.t = 0;
      return false;
    }
    state.hacker = who.id;
    state.t += dt;
    if (state.t < PERK_TUNING.hackSec) return false;
    state.hacker = null;
    state.t = 0;
    ctx.room.bus.emit('killstreaks.destroyed', { owner: this.owner, id: this.act.streak, kind: ent.kind, by: who });
    this.act.owner = who;
    ent.owner = who.id;
    ent.team = who.team;
    const d = ctx.hp.get(ent.id);
    if (d) d.active = this.act;
    this.dropTarget();
    ctx.fx({ kind: 'hacked', x: ent.x, y: ent.y + 1, z: ent.z });
    return true;
  }

  private cleanup(): void {
    roomTurrets.get(this.ctx)?.delete(this);
    for (const m of this.missiles) this.ctx.removeEntity(m.ent.id);
    this.missiles = [];
    const ks = this.carrier?.ext.killstreaks;
    if (this.carrier && ks?.carry?.turret === this) {
      ks.carry = null;
      markDirty(this.ctx.room, this.carrier);
    }
    this.carrier = null;
  }
}

/**
 * Where a turret goes when nobody carries it (bots, the `killstreaks.call` RPC): in front of the
 * caller facing where enemies are likely to come from (enemies it knows of, else the enemy side's
 * spawns, else the middle of the map), trying a few directions round it; at its feet if nowhere fits.
 */
export function autoTurretSpot(ctx: KsRoom, p: PlayerState): TurretSpot {
  const room = ctx.room;
  const face = threatYaw(ctx, p);
  for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.3, -2.3, Math.PI]) {
    const spot = turretPlacement(room.world, room.map, p.move, face + off);
    if (spot.valid) return { ...spot, yaw: face };
  }
  return { x: p.move.x, y: p.move.y, z: p.move.z, yaw: face, valid: false, reason: 'blocked' };
}

/** The bearing enemies are likeliest to come from, for `p`. */
export function threatYaw(ctx: KsRoom, p: PlayerState): number {
  const room = ctx.room;
  const at = p.move;
  const radar = new Set(room.radarFor(p));
  const eye = { x: at.x, y: at.y + 1.5, z: at.z };
  const known = [...room.players.values()]
    .filter((q) => q.alive && room.isEnemy(p, q) && (radar.has(q.id) || (Math.hypot(q.move.x - at.x, q.move.z - at.z) < 90 && room.world.lineOfSight(eye, chestOf(q), 'sight'))))
    .sort((a, b) => Math.hypot(a.move.x - at.x, a.move.z - at.z) - Math.hypot(b.move.x - at.x, b.move.z - at.z))
    .slice(0, 3);
  let pts: Vec3[] = known.map((q) => q.move);
  if (!pts.length && p.team !== null && room.mode.teams) pts = room.map.spawns.teams[p.team === 0 ? 1 : 0] ?? [];
  if (!pts.length) pts = room.map.hotspots?.length ? room.map.hotspots : [ctx.center];
  let sx = 0;
  let sz = 0;
  for (const q of pts) {
    const d = Math.hypot(q.x - at.x, q.z - at.z);
    if (d < 0.5) continue;
    sx += (q.x - at.x) / d;
    sz += (q.z - at.z) / d;
  }
  return Math.hypot(sx, sz) < 1e-3 ? p.yaw : Math.atan2(-sx, -sz);
}

function spotFor(ctx: KsRoom, p: PlayerState, args: CallArgs): Pose {
  const s = args.place ?? autoTurretSpot(ctx, p);
  return { x: s.x, y: s.y, z: s.z, yaw: s.yaw };
}

export function callSentry(ctx: KsRoom, p: PlayerState, args: CallArgs): string | null {
  new TurretRun(ctx, p, 'sentry', spotFor(ctx, p, args));
  return null;
}

export function callSam(ctx: KsRoom, p: PlayerState, args: CallArgs): string | null {
  new TurretRun(ctx, p, 'sam', spotFor(ctx, p, args));
  return null;
}

/** One bullet from killstreak hardware at `target` (hits unless the world blocks it or the spread misses). */
export function shoot(ctx: KsRoom, owner: PlayerState, from: Vec3, aimAt: Vec3, target: PlayerState, weapon: string, damage: number, spread: number, shooterId: string): void {
  const len = Math.hypot(aimAt.x - from.x, aimAt.y - from.y, aimAt.z - from.z) || 1;
  fireBullet(ctx, owner, from, aimAt, target, weapon, damage, 1 - Math.min(0.6, spread * len * 0.5), shooterId);
}

/** One bullet at `target` that hits with chance `hitChance` (a miss goes past them), unless the world stops it. */
export function fireBullet(ctx: KsRoom, owner: PlayerState, from: Vec3, aimAt: Vec3, target: PlayerState, weapon: string, damage: number, hitChance: number, shooterId: string): void {
  const room = ctx.room;
  const len = Math.hypot(aimAt.x - from.x, aimAt.y - from.y, aimAt.z - from.z) || 1;
  const miss = Math.random() >= hitChance;
  const jitter = miss ? 0.6 + Math.random() * 0.6 : 0;
  const a = Math.random() * Math.PI * 2;
  const end = { x: aimAt.x + Math.cos(a) * jitter, y: aimAt.y + Math.sin(a) * jitter * 0.5, z: aimAt.z + Math.sin(a) * jitter };
  const dir = { x: (end.x - from.x) / len, y: (end.y - from.y) / len, z: (end.z - from.z) / len };
  const wall = room.world.raycast(from, dir, len, 'bullets');
  const hitEnd = wall ? wall.point : end;
  room.recordShot({ p: shooterId, o: [q3(from.x), q3(from.y), q3(from.z)], e: [q3(hitEnd.x), q3(hitEnd.y), q3(hitEnd.z)], w: weapon, ...(wall || miss ? {} : { h: 1 as const }) });
  if (wall || miss) return;
  room.damage({ victim: target, attacker: owner, amount: damage, weapon, part: 'torso', means: 'killstreak', from, distance: len });
}
