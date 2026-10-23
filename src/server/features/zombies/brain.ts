/**
 * The zombie (and hellhound) brain: a `BotBrain` for the undead bodies the director spawns. Not
 * the bots feature's soldier brain (no guns, no perception model): every zombie knows where the
 * survivors are (BO1's `find_flesh`), walks to the nearest one that is up, and swipes when in reach.
 *
 * Cost (24 zombies at 60 Hz, `tests/zombies.perf.test.ts`):
 * - paths come from the bots' nav grid (`navFor`) with a per-room budget: at most
 *   `PATH_SEARCHES_PER_TICK` A* searches and `PATH_EXPAND_PER_TICK` expanded cells per tick, the
 *   rest wait a tick or two (they keep walking their old path, or straight at the target);
 * - each zombie re-plans every 1.5-2.5 s (staggered), or when its target moved far from the end;
 * - close up with a clear line it walks straight at the target (no search);
 * - string pulling (walk straight to the farthest waypoint in reach) is re-checked every 0.3 s;
 * - target choice every 0.4 s, line of sight every 0.2 s, separation from the 24 others per tick.
 */
import { BARRIER, ZOMBIE_POSE, ZOMBIES } from '../../../shared/defs/zombies';
import { Buttons } from '../../../shared/input';
import { hashString, type Vec3 } from '../../../shared/math';
import { PLAYER } from '../../../shared/constants';
import type { BotBrain, PlayerState } from '../../player';
import type { Room } from '../../room';
import { navFor, type NavGrid } from '../bots/nav';
import type { NavCell } from '../bots/nav';
import { undeadOf } from './state';

export const PATH_SEARCHES_PER_TICK = 2;
export const PATH_EXPAND_PER_TICK = 16000;
const SEARCH_LIMIT = 14000;

/** Shared per-room state for every undead brain. */
export interface Horde {
  readonly room: Room;
  nav: NavGrid;
  budget: { tick: number; used: number; expanded: number };
  /** Survivors that can be hunted (alive, not down). */
  targets: PlayerState[];
  /** Alive undead bodies (for separation). */
  bodies: PlayerState[];
  /** Game over / between phases: stand still. */
  frozen: boolean;
  /** Totals for tests / the perf budget. */
  stats: { searches: number; expanded: number; deferred: number };
  /** Called when a swipe lands (the rules apply damage through the room so last stand can catch it). */
  hit(attacker: PlayerState, victim: PlayerState, amount: number, weapon: string): void;
  /** Barriers (blockers.ts): a zombie still outside goes to its window first; null = hunt as usual. */
  entry?: (self: PlayerState, now: number) => HordeEntry | null;
  /** Path cost multiplier per nav cell (shut doors). */
  pathCost?: (c: NavCell) => number;
  /** Zombie swipe damage and gap (s): the game's difficulty (`ZOMBIES_DIFFICULTY`); BO1's when unset. */
  swipe?: { damage: number; every: number };
}

/**
 * Orders for a zombie outside a barrier: walk to `goal`; with `hold`, stand there facing `face`
 * (tearing boards) and swipe `hit` if set; `script`: something else moves the body (the climb in).
 */
export interface HordeEntry {
  goal: Vec3;
  hold?: boolean;
  face?: Vec3;
  hit?: PlayerState | null;
  script?: boolean;
}

export function createHorde(room: Room, hit: Horde['hit']): Horde {
  return { room, nav: navFor(room.map), budget: { tick: -1, used: 0, expanded: 0 }, targets: [], bodies: [], frozen: false, stats: { searches: 0, expanded: 0, deferred: 0 }, hit };
}

const flat = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

export class ZombieBrain implements BotBrain {
  target: PlayerState | null = null;
  path: NavCell[] | null = null;
  pathIdx = 0;
  /** Waypoint picked by the last string pull (index into path). */
  private pull = 0;
  private pullAt = 0;
  private replanAt = 0;
  private wantPlan = true;
  private pathGoal: Vec3 | null = null;
  private targetAt = 0;
  private losAt = 0;
  private los = false;
  private swingEnd: number | null = null;
  private nextSwing = 0;
  private stuckAt: Vec3 = { x: 0, y: 0, z: 0 };
  private stuckCheck = 0;
  private stuckT = 0;
  private sidestepUntil = 0;
  private sidestep = 1;
  private yaw = 0;
  private readonly phase: number;

  constructor(
    readonly horde: Horde,
    readonly self: PlayerState,
  ) {
    this.phase = (hashString(self.id) % 1000) / 1000;
  }

  /** A fresh body (spawned or reused). */
  reset(now: number): void {
    this.target = null;
    this.path = null;
    this.pathIdx = 0;
    this.pull = 0;
    this.pathGoal = null;
    this.wantPlan = true;
    this.replanAt = now + this.phase * 0.5;
    this.targetAt = 0;
    this.swingEnd = null;
    this.nextSwing = now + 0.6;
    this.stuckT = 0;
    this.stuckCheck = now + 0.5;
    this.stuckAt = { ...this.self.move };
    this.yaw = this.self.yaw;
  }

  think(room: Room, self: PlayerState, dt: number): ReturnType<BotBrain['think']> {
    const z = undeadOf(self);
    if (!z || !self.alive) return null;
    const now = room.time;
    const dog = z.kind === 'dog';
    const idle = { buttons: dog ? Buttons.CROUCH : 0, yaw: this.yaw, pitch: 0, weaponSlot: 0 };
    if (this.horde.frozen) return idle;
    const pos = self.move;
    // Climbing out of the ground: stand still, crouched for the first part (the client draws the
    // climb; the crouched hitbox keeps the head where it is drawn).
    const since = now - z.spawnedAt;
    if (!dog && since < ZOMBIE_POSE.riseSec) return { buttons: since < ZOMBIE_POSE.riseCrouchSec ? Buttons.CROUCH : 0, yaw: this.yaw, pitch: 0, weaponSlot: 0 };
    // Still outside a barrier: its window first (blockers.ts); climbing in is scripted.
    const entry = this.horde.entry?.(self, now) ?? null;
    if (entry?.script) return null;

    // ---- Target: the nearest survivor who is up (BO1 zombies leave downed players alone).
    if (!this.target || now >= this.targetAt || !this.horde.targets.includes(this.target)) {
      this.targetAt = now + 0.4;
      let best: PlayerState | null = null;
      let bd = Infinity;
      for (const t of this.horde.targets) {
        const d = flat(t.move, pos) + Math.abs(t.move.y - pos.y) * 2;
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
      if (best !== this.target) this.wantPlan = true;
      this.target = best;
    }
    const t = entry ? (entry.hit ?? null) : this.target;
    const tp = entry ? entry.goal : t?.move;
    if (!tp) return idle;
    const dx = tp.x - pos.x;
    const dz = tp.z - pos.z;
    const d = Math.hypot(dx, dz);
    const dy = tp.y - pos.y;
    if (!entry && d + Math.abs(dy) < z.bestDist - 0.5) {
      z.bestDist = d + Math.abs(dy);
      z.progressAt = now;
    }

    // ---- Line of sight to the target (chest to chest), refreshed every 0.2 s.
    if (now >= this.losAt) {
      this.losAt = now + 0.2;
      this.los = d < 14 && room.world.lineOfSight({ x: pos.x, y: pos.y + 1.1, z: pos.z }, { x: tp.x, y: tp.y + 1.1, z: tp.z }, 'players');
    }

    // ---- Attack: wind up when in reach, land it if still in reach.
    // At a window the victim is whoever stands on the other side (swiped through the boards).
    const vd = entry ? (t ? flat(t.move, pos) : Infinity) : d;
    const vdy = entry ? (t ? t.move.y - pos.y : Infinity) : dy;
    const sees = entry ? true : this.los;
    const reach = entry ? BARRIER.swipeReach : dog ? ZOMBIES.dogReach : ZOMBIES.swipeReach;
    const inReach = !!t && vd <= reach && Math.abs(vdy) < ZOMBIES.swipeDy && sees;
    if (this.swingEnd !== null) {
      if (now >= this.swingEnd) {
        this.swingEnd = null;
        const swipe = this.horde.swipe;
        this.nextSwing = now + (dog ? ZOMBIES.dogBiteEvery : (swipe?.every ?? ZOMBIES.swipeEvery)) - ZOMBIES.swipeWindup;
        if (t && vd <= reach * 1.3 && Math.abs(vdy) < ZOMBIES.swipeDy && sees) this.horde.hit(self, t, dog ? ZOMBIES.dogBite : (swipe?.damage ?? ZOMBIES.swipeDamage), dog ? 'hellhound' : 'zombie');
      }
    } else if (inReach && now >= this.nextSwing) {
      this.swingEnd = now + (dog ? ZOMBIES.swipeWindup * 0.6 : ZOMBIES.swipeWindup);
      // Shows as FIRING in snapshots: the client plays the swipe / bite.
      self.lastFireTime = now;
      self.lastFireSuppressed = true;
    }

    // ---- Where to walk.
    let wx = 0;
    let wz = 0;
    let jump = false;
    const direct = this.los && d < 7 && Math.abs(dy) < 0.9;
    if (entry?.hold) {
      // At the window: stay put (a nudge back onto the spot), tearing.
      if (d > 0.25) {
        wx = (dx / d) * 0.6;
        wz = (dz / d) * 0.6;
      }
    } else if (direct) {
      if (d > 0.01) {
        wx = dx / d;
        wz = dz / d;
      }
    } else {
      // Re-plan on a timer, when the target wandered off the path's end, or when asked to.
      if (!this.path || now >= this.replanAt || (this.pathGoal && flat(this.pathGoal, tp) > 3.5)) this.wantPlan = true;
      if (this.wantPlan) this.plan(room, pos, tp, now);
      const step = this.follow(pos, now);
      if (step) {
        wx = step.x;
        wz = step.z;
        jump = step.jump;
      } else if (d > 0.01) {
        wx = dx / d;
        wz = dz / d;
      }
    }

    // ---- Keep a little space from the rest of the horde (bodies don't collide in our movement).
    let sx = 0;
    let sz = 0;
    for (const o of this.horde.bodies) {
      if (o === self) continue;
      const ox = pos.x - o.move.x;
      const oz = pos.z - o.move.z;
      const dd = ox * ox + oz * oz;
      if (dd > 0.64 || dd < 1e-6 || Math.abs(o.move.y - pos.y) > 1) continue;
      const k = (0.8 - Math.sqrt(dd)) / 0.8;
      sx += (ox / Math.sqrt(dd)) * k;
      sz += (oz / Math.sqrt(dd)) * k;
    }
    wx += sx * 0.9;
    wz += sz * 0.9;

    // ---- Stuck: hop, then side-step and re-plan.
    if (now >= this.stuckCheck) {
      const moved = flat(pos, this.stuckAt);
      const wanted = Math.hypot(wx, wz) > 0.3 && d > reach && !entry?.hold;
      this.stuckT = wanted && moved < 0.2 ? this.stuckT + 0.5 : 0;
      this.stuckAt = { ...pos };
      this.stuckCheck = now + 0.5;
      if (this.stuckT >= 1.5) {
        this.path = null;
        this.wantPlan = true;
        this.sidestep = Math.random() < 0.5 ? -1 : 1;
        this.sidestepUntil = now + 0.7;
        this.stuckT = 0;
      }
    }
    if (this.stuckT >= 0.5) jump = true;
    if (now < this.sidestepUntil) {
      const px = -wz * this.sidestep;
      const pz = wx * this.sidestep;
      wx = wx * 0.3 + px;
      wz = wz * 0.3 + pz;
    }

    const len = Math.hypot(wx, wz);
    let buttons = dog ? Buttons.CROUCH : 0;
    if (entry?.hold) {
      // Face the window (or whoever it is swiping), shuffle back onto the spot without turning.
      const fp = t && (inReach || this.swingEnd !== null) ? t.move : (entry.face ?? tp);
      this.yaw = turn(this.yaw, Math.atan2(-(fp.x - pos.x), -(fp.z - pos.z)), 5.5 * dt);
      if (len > 0.05) {
        const off = angleDiff(Math.atan2(-wx / len, -wz / len), this.yaw);
        if (Math.abs(off) < 1.2) buttons |= Buttons.FORWARD;
        else if (Math.abs(off) > 1.9) buttons |= Buttons.BACK;
        if (off > 0.4 && off < 2.7) buttons |= Buttons.LEFT;
        else if (off < -0.4 && off > -2.7) buttons |= Buttons.RIGHT;
      }
    } else if (len > 0.05) {
      // Face where we walk; turn to the target when swiping.
      const want = inReach || this.swingEnd !== null ? Math.atan2(-dx, -dz) : Math.atan2(-wx / len, -wz / len);
      this.yaw = turn(this.yaw, want, (dog ? 9 : 5.5) * dt);
      // Close enough to swipe: shuffle in, don't walk through them.
      if (!(inReach && d < reach * 0.7)) buttons |= Buttons.FORWARD;
      // Walking toward a direction a little off the facing: strafe the difference.
      const off = angleDiff(Math.atan2(-wx / len, -wz / len), this.yaw);
      if (off > 0.5) buttons |= Buttons.LEFT;
      else if (off < -0.5) buttons |= Buttons.RIGHT;
    }
    if (jump && self.move.onGround) buttons |= Buttons.JUMP;
    void dt;
    return { buttons, yaw: this.yaw, pitch: 0, weaponSlot: 0 };
  }

  /** A* to the target within the room's per-tick budget (or wait a tick). */
  private plan(room: Room, from: Vec3, to: Vec3, now: number): void {
    const b = this.horde.budget;
    if (b.tick !== room.tick) {
      b.tick = room.tick;
      b.used = 0;
      b.expanded = 0;
    }
    const left = PATH_EXPAND_PER_TICK - b.expanded;
    if (b.used >= PATH_SEARCHES_PER_TICK || left < 3000) {
      this.horde.stats.deferred++;
      return;
    }
    b.used++;
    const nav = this.horde.nav;
    const before = nav.expanded;
    const path = nav.path(from, { x: to.x, y: to.y, z: to.z }, Math.min(SEARCH_LIMIT, left), this.horde.pathCost ? { cost: this.horde.pathCost } : {});
    const used = nav.expanded - before;
    b.expanded += used;
    this.horde.stats.searches++;
    this.horde.stats.expanded += used;
    this.wantPlan = false;
    this.replanAt = now + 1.5 + this.phase + Math.random() * 0.4;
    this.pathGoal = { x: to.x, y: to.y, z: to.z };
    this.path = path;
    this.pathIdx = 0;
    this.pull = 0;
    this.pullAt = 0;
  }

  /** Steer along the path (string pulled every 0.3 s); null when there is none. */
  private follow(pos: Vec3, now: number): { x: number; z: number; jump: boolean } | null {
    const p = this.path;
    if (!p || !p.length) return null;
    const nav = this.horde.nav;
    // Progress: the nearest of the next few cells.
    let bestK = this.pathIdx;
    let bestD = Infinity;
    for (let k = this.pathIdx; k < Math.min(p.length, this.pathIdx + 8); k++) {
      const c = p[k]!;
      const dd = Math.hypot(c.x - pos.x, c.z - pos.z) + Math.abs(c.y - pos.y) * 2;
      if (dd < bestD) {
        bestD = dd;
        bestK = k;
      }
    }
    this.pathIdx = bestK;
    while (this.pathIdx < p.length) {
      const c = p[this.pathIdx]!;
      if (Math.hypot(c.x - pos.x, c.z - pos.z) < 0.45 && Math.abs(c.y - pos.y) < 0.7) this.pathIdx++;
      else break;
    }
    if (this.pathIdx >= p.length) {
      this.path = null;
      return null;
    }
    if (now >= this.pullAt || this.pull < this.pathIdx) {
      this.pullAt = now + 0.3;
      let target = this.pathIdx;
      for (let j = this.pathIdx + 1; j < Math.min(p.length, this.pathIdx + 8); j++) {
        if (nav.edgeKind(p[j - 1]!, p[j]!) !== 'walk') break;
        if (!nav.straight(pos, p[j]!)) break;
        target = j;
      }
      this.pull = target;
    }
    const wp = p[Math.max(this.pull, this.pathIdx)]!;
    const dx = wp.x - pos.x;
    const dz = wp.z - pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const next = p[this.pathIdx]!;
    const prev = this.pathIdx > 0 ? p[this.pathIdx - 1]! : null;
    const kind = prev ? nav.edgeKind(prev, next) : null;
    const jump = (kind === 'jump' || next.y - pos.y > PLAYER.stepHeight + 0.05) && Math.hypot(next.x - pos.x, next.z - pos.z) < 1.0 && next.y > pos.y + 0.3;
    return { x: dx / d, z: dz / d, jump };
  }
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function turn(from: number, to: number, max: number): number {
  const d = angleDiff(to, from);
  return from + Math.max(-max, Math.min(max, d));
}
