/**
 * Blackout bot brain: a goal at all times, chosen from a priority stack, followed on the island's
 * navigation grids (nav.ts), with a level of detail by distance to the humans (BLACKOUT.lod).
 *
 * Goals, highest priority first (`decide`):
 *   heal    hurt and carrying heals, nobody shooting at it: heal (standing still inside the zone;
 *           walking on when outside it);
 *   circle  outside the safe zone, or outside the next one with too little time left to walk in:
 *           a spot inside it (a building when there is one), commits until well inside;
 *   loot    under-equipped (no gun, low ammo, no vest, no heals): the nearest worthwhile item it
 *           can reach, inside the zone; anything useful close by on the way;
 *   fight   an enemy it sees (near: perception and the aim controller; far: the game's statistical
 *           far fights hold it in place facing its foe);
 *   hunt    late in the match (phase 3 on), half the time: move up on the nearest player;
 *   cover / hold   otherwise a building or cover spot inside the next circle: walk there, hold it
 *           for a while (crouched, watching), then move to another.
 *
 * Commitment: a goal is only replaced by one of higher priority, when it is done, or when it fails
 * (timeout, target gone, no route, stuck). Failed targets are ignored for a minute, so a bot never
 * dithers between two goals or keeps walking at a wall.
 *
 * Movement: `IslandNav.route` (town grids + the coarse open-ground grid) gives waypoints; the bot
 * string-pulls them with line checks, jumps where the grid says, and when it stops making progress
 * it jumps, sidesteps, re-routes, and finally gives the goal up.
 *
 *   near (within `nearDist` of a human, or of the player a dead human watches): perceives every
 *     50 ms (FOV, line of sight, noticing time) and fights with the aim controller and hitscan.
 *   far: decides every `farThinkSec`, string-pulls only then; fights are resolved by the game.
 *
 * Fairness: a bot only fights whom it sees, humans are not preferred, and at most `MAX_ON_HUMAN`
 * bots engage the same human at once unless shot by them.
 */
import { BLACKOUT, insideCircle, outsideBy, type Circle, type LootItem } from '../../../shared/defs/blackout';
import type { BotSkill } from '../../../shared/defs/bots';
import { PICKUP } from '../../../shared/defs/pickups';
import { Buttons, type InputCmd } from '../../../shared/input';
import { clamp, dist, viewDir, yawTo, type Vec3 } from '../../../shared/math';
import { eyeHeight } from '../../../shared/movement';
import { currentWeapon, type BotBrain, type PlayerState } from '../../player';
import type { Room } from '../../room';
import { addRecoil, angleDiff, engage, feltOffDeg, flinch, lookToward, newAimState, noticeTime, stepAim, toleranceDeg, type AimState } from '../bots/aim';
import { botCanHit, chestOf, headOf, visiblePart } from '../bots/sight';
import { swapBlocker, swapFor, type DropEntity } from '../pickups/index';
import type { BlackoutGame } from './game';
import { lootSpots, wants } from './loot';
import { clearLine, islandNavFor, type Waypoint } from './nav';
import { blackoutGameOf } from './rules';
import { bx } from './state';

const DEG = Math.PI / 180;
/** Most bots fighting one human at once (others ignore them unless shot by them). */
export const MAX_ON_HUMAN = 3;
/** Odds that a bot takes on another bot it sees (re-rolled every few seconds; far fights use the same). */
export const FIGHT_ODDS = 0.28;
/** Near bots see and shoot for real (hitscan, the aim controller), which kills faster: lower odds. */
export const NEAR_FIGHT_ODDS = 0.2;
/**
 * The odds rise as the circle closes (phase 0-1 as above, then up to 0.85 / 0.75): late in the
 * match everyone is close together and holding back would leave a crowd for the final circle to
 * kill.
 */
export function fightOdds(phase: number, near: boolean): number {
  const base = near ? NEAR_FIGHT_ODDS : FIGHT_ODDS;
  return Math.min(near ? 0.75 : 0.85, base + Math.max(0, phase - 1) * 0.15);
}

/** How long a failed target (loot, spot) is ignored (s). */
const IGNORE_SEC = 60;

export type GoalKind = 'heal' | 'circle' | 'loot' | 'fight' | 'hunt' | 'cover' | 'hold';
const PRIORITY: Record<GoalKind, number> = { heal: 5, circle: 4, loot: 3, fight: 2, hunt: 1, cover: 1, hold: 1 };

export interface Goal {
  kind: GoalKind;
  x: number;
  y: number;
  z: number;
  /** Room time it was set and when it times out. */
  since: number;
  until: number;
  /** Loot entity, loot spot index, far foe. */
  ent?: number;
  spot?: number;
  foe?: string;
  /** The safe zone it goes into (circle goals). */
  zone?: Circle;
  /** Holding: arrived, and when to move on. */
  holdUntil?: number;
}

/** How each weapon class is fought: preferred range and ADS beyond (m). */
const STYLE: Record<string, { range: number; ads: number }> = {
  ar: { range: 22, ads: 8 },
  smg: { range: 10, ads: 12 },
  lmg: { range: 25, ads: 9 },
  sniper: { range: 45, ads: 4 },
  shotgun: { range: 5, ads: Infinity },
  pistol: { range: 10, ads: 9 },
  launcher: { range: 18, ads: 6 },
  special: { range: 1.5, ads: Infinity },
};

const eyeOf = (p: PlayerState): Vec3 => ({ x: p.move.x, y: p.move.y + eyeHeight(p.move), z: p.move.z });

/** What a bot carries, for its decisions. */
export function kitOf(p: PlayerState): { armed: boolean; lowAmmo: boolean; armour: boolean; heals: number; under: boolean } {
  let armed = false;
  let lowAmmo = true;
  for (const w of p.weapons.slice(0, 2)) {
    if (w.def.base.id === 'knife') continue;
    const ammo = w.mag + w.reserve;
    if (ammo > 0) armed = true;
    if (ammo >= w.def.magazine * 2) lowAmmo = false;
  }
  const st = bx(p);
  const heals = st.bandages + st.medkits;
  const armour = st.armorMax > 0;
  return { armed, lowAmmo: armed && lowAmmo, armour, heals, under: !armed || lowAmmo || !armour || heals === 0 };
}

export class BlackoutBrain implements BotBrain {
  readonly aim: AimState = newAimState();
  target: PlayerState | null = null;
  goal: Goal | null = null;
  private notice = new Map<string, number>();
  private lastSeen: { at: Vec3; t: number } | null = null;
  private nextThink = 0;
  private nextPerceive = 0;
  private nextShot = 0;
  private burst = 0;
  private pauseUntil = 0;
  private strafe = 0;
  private strafeUntil = 0;
  private jumpHeld = false;
  private prev = 0;
  private slot = 0;
  private hurtBy: { id: string; t: number } | null = null;
  /** Targets it gave up on (loot entity ids, `s<spot>` spot indices): key -> room time to retry. */
  private ignore = new Map<string, number>();
  /** Bots it decided to leave alone for now (id -> until). */
  private truce = new Map<string, { fight: boolean; until: number }>();
  /** The route to the goal and how far along it is. */
  private path: Waypoint[] | null = null;
  private pathIdx = 0;
  private pathAim = 0;
  private needRoute = false;
  /** No route search before this (walking off a ledge first). */
  private nextRouteAt = 0;
  /** The last search ran out of a tick's budget: the next one gets a tick to itself. */
  private longRoute = false;
  private nextPull = 0;
  /** Progress watch: best distance to the current waypoint, when it last improved, tries so far. */
  private bestD = Infinity;
  private bestT = 0;
  private stuckTries = 0;
  private progIdx = -2;
  private detour = 0;
  private detourUntil = 0;
  /** Phase 3 on (set by decide): shorter holds, moving up on others. */
  private late = false;
  /** A far fight the game put it in (foe id, room time). */
  farFoe: { id: string; t: number } | null = null;
  /** Ticks of near / far thinking, goal changes, routes, give-ups (benchmark, tests). */
  readonly stats = { near: 0, far: 0, shots: 0, goals: 0, routes: 0, noRoute: 0, stuck: 0, timeouts: 0 };

  constructor(
    public skill: BotSkill,
    readonly rnd: () => number = Math.random,
  ) {
    this.nextThink = rnd() * BLACKOUT.lod.farThinkSec;
  }

  onHurt(by: PlayerState | null, now: number, flinchDeg: number): void {
    if (by) this.hurtBy = { id: by.id, t: now };
    flinch(this.aim, flinchDeg, this.rnd);
  }

  think(room: Room, self: PlayerState, dt: number): Omit<InputCmd, 'seq' | 'dt'> | null {
    if (!self.alive) return null;
    const game = blackoutGameOf(room);
    if (!game || room.phase !== 'playing') return { buttons: 0, yaw: self.yaw, pitch: 0, weaponSlot: self.slot };
    const skill = self.ext.bots?.skill ?? this.skill;
    const st = bx(self);
    const now = room.time;
    if (st.stage === 'plane') {
      this.aim.yaw = self.yaw;
      return { buttons: 0, yaw: self.yaw, pitch: 0, weaponSlot: 0 };
    }
    if (st.stage === 'freefall' || st.stage === 'chute') return this.glide(self, st.dropTo);

    const near = game.isNear(self);
    if (near) this.stats.near++;
    else this.stats.far++;

    if (near) {
      if (now >= this.nextPerceive) {
        this.nextPerceive = now + 0.05;
        this.perceive(room, game, self, skill, now);
      }
      if (this.target && (!this.target.alive || !room.players.has(this.target.id))) this.target = null;
    } else this.target = null;

    // Decide: on a timer (far bots less often), at once when the goal is gone or a route is wanted.
    if (now >= this.nextThink || !this.goal) {
      this.nextThink = now + (near ? 0.35 : BLACKOUT.lod.farThinkSec) * (0.8 + this.rnd() * 0.4);
      this.decide(room, game, self, now);
      this.pickUp(room, game, self);
    }
    if (this.goal && (this.needRoute || !this.path) && now >= this.nextRouteAt) this.route(room, game, self);
    this.pickSlot(self);

    let buttons = 0;
    const kit = kitOf(self);
    // Heal (the top goal): never while someone is shooting at it.
    if (this.goal?.kind === 'heal' && st.healUntil === null && !(this.prev & Buttons.STREAK)) buttons |= Buttons.STREAK;

    // A visible enemy: fight it, unless unarmed with loot to run for and the enemy isn't close.
    if (this.target) {
      const d = Math.hypot(this.target.move.x - self.move.x, this.target.move.z - self.move.z);
      const flee = !kit.armed && this.goal?.kind === 'loot' && d > 7;
      if (!flee && this.goal?.kind !== 'circle') return this.out(self, buttons | this.fight(room, self, skill, dt, now));
    }
    const g = this.goal;
    if (!g) return this.out(self, buttons);

    // Holding a spot (or healing, or a far fight): stay put, crouched, looking about.
    const dGoal = Math.hypot(g.x - self.move.x, g.z - self.move.z);
    if (g.kind === 'hold' || g.kind === 'fight' || (g.kind === 'heal' && !g.zone)) {
      const look = g.kind === 'fight' ? this.aim.yaw : this.aim.yaw + Math.sin(now * 0.5 + self.move.x) * 0.5 * dt;
      if (near) lookToward(this.aim, skill, look, 0, dt, 0.35);
      else this.aim.yaw = look;
      if (g.kind === 'fight') {
        if (now >= this.strafeUntil) {
          this.strafe = this.rnd() < 0.5 ? -1 : 1;
          this.strafeUntil = now + 0.6 + this.rnd() * 0.8;
        }
        return this.out(self, buttons | (this.strafe < 0 ? Buttons.LEFT : Buttons.RIGHT));
      }
      return this.out(self, buttons | (g.kind === 'hold' ? Buttons.CROUCH : 0));
    }
    if (dGoal < 0.7 && Math.abs(g.y - self.move.y) < 1.5) {
      if (g.kind === 'cover') this.arrive(g, now);
      return this.out(self, buttons);
    }

    // ---- Move along the route.
    const step = this.follow(room, self, now, near);
    let yaw = step.yaw;
    if (now < this.detourUntil) yaw += this.detour;
    if (step.jump) buttons |= this.jumpPulse();
    buttons |= this.watchProgress(room, game, self, now, step.d);
    if (near) lookToward(this.aim, skill, yaw, 0, dt, 0.7);
    else {
      this.aim.yaw = yaw;
      this.aim.pitch = 0;
    }
    const sprint = dGoal > 8 && self.health > 25 && st.healUntil === null;
    return this.out(self, buttons | Buttons.FORWARD | (sprint ? Buttons.SPRINT : 0), yaw);
  }

  /** Freefall / chute: face the landing spot and glide there. */
  private glide(self: PlayerState, to: { x: number; z: number } | null): Omit<InputCmd, 'seq' | 'dt'> {
    if (!to) return { buttons: 0, yaw: self.yaw, pitch: 0, weaponSlot: 0 };
    const dx = to.x - self.move.x;
    const dz = to.z - self.move.z;
    const yaw = Math.atan2(-dx, -dz);
    this.aim.yaw = yaw;
    this.aim.pitch = 0;
    return { buttons: Math.hypot(dx, dz) > 4 ? Buttons.FORWARD : 0, yaw, pitch: 0, weaponSlot: 0 };
  }

  private jumpPulse(): number {
    if (this.jumpHeld) return 0;
    this.jumpHeld = true;
    return Buttons.JUMP | Buttons.FORWARD;
  }

  private out(self: PlayerState, buttons: number, moveYaw?: number): Omit<InputCmd, 'seq' | 'dt'> {
    if (!(buttons & Buttons.JUMP)) this.jumpHeld = false;
    this.prev = buttons;
    // Moving while looking elsewhere: turn the keys so the body still goes along `moveYaw`.
    if (moveYaw !== undefined && Math.abs(angleDiff(moveYaw, this.aim.yaw)) > 0.3 && buttons & Buttons.FORWARD) {
      const a = angleDiff(moveYaw, this.aim.yaw);
      buttons &= ~(Buttons.FORWARD | Buttons.SPRINT);
      if (Math.cos(a) > 0.38) buttons |= Buttons.FORWARD;
      else if (Math.cos(a) < -0.38) buttons |= Buttons.BACK;
      if (Math.sin(a) < -0.38) buttons |= Buttons.RIGHT;
      else if (Math.sin(a) > 0.38) buttons |= Buttons.LEFT;
    }
    const slot = this.slot < self.weapons.length ? this.slot : 0;
    return { buttons, yaw: this.aim.yaw, pitch: clamp(this.aim.pitch, -1.4, 1.4), weaponSlot: slot };
  }

  /** The gun to hold: a loaded gun over an empty one over the knife. */
  private pickSlot(self: PlayerState): void {
    const score = (i: number) => {
      const w = self.weapons[i];
      if (!w || w.def.base.id === 'knife') return 0;
      return w.mag + w.reserve > 0 ? 2 + (w.def.class === 'pistol' ? 0 : 1) : 1;
    };
    const cur = score(this.slot);
    const other = this.slot === 0 ? 1 : 0;
    if (score(other) > cur) this.slot = other;
  }

  // -------------------------------------------------------------------------------------------
  // Deciding
  // -------------------------------------------------------------------------------------------

  private ignored(key: string, now: number): boolean {
    const t = this.ignore.get(key);
    return t !== undefined && now < t;
  }

  private giveUp(now: number): void {
    const g = this.goal;
    if (g) {
      if (g.ent !== undefined) this.ignore.set(`e${g.ent}`, now + IGNORE_SEC);
      if (g.spot !== undefined) this.ignore.set(`s${g.spot}`, now + IGNORE_SEC);
      if (g.kind === 'circle') this.ignore.set(`c${Math.round(g.x)},${Math.round(g.z)}`, now + IGNORE_SEC);
    }
    if (this.ignore.size > 96) for (const [k, t] of this.ignore) if (t < now) this.ignore.delete(k);
    this.setGoal(null, now);
  }

  private setGoal(g: Goal | null, now: number): void {
    this.goal = g;
    this.path = null;
    this.pathIdx = 0;
    this.needRoute = !!g && g.kind !== 'hold' && g.kind !== 'fight' && !(g.kind === 'heal' && !g.zone);
    this.bestD = Infinity;
    this.bestT = now;
    this.stuckTries = 0;
    if (g) this.stats.goals++;
  }

  /** Done with the current goal? (Reached, target gone, timed out.) */
  private finished(room: Room, game: BlackoutGame, self: PlayerState, now: number): boolean {
    const g = this.goal;
    if (!g) return true;
    const st = bx(self);
    switch (g.kind) {
      case 'heal':
        return self.health >= self.maxHealth * 0.95 || (st.bandages + st.medkits === 0 && st.healUntil === null) || (now - g.since > 1 && st.healUntil === null && now - g.since > 8);
      case 'circle':
        return !!g.zone && outsideBy(g.zone, self.move.x, self.move.z) < -Math.min(8, g.zone.r * 0.3) && Math.hypot(g.x - self.move.x, g.z - self.move.z) < Math.max(6, g.zone.r * 0.25);
      case 'loot': {
        const e = g.ent !== undefined ? room.entities.get(g.ent) : null;
        if (!e) return true;
        if (e.kind !== 'pickups_weapon') {
          const it = (e.data as { item: LootItem } | undefined)?.item;
          if (!it || !wants(self, it)) return true;
        }
        const claim = game.lootClaims.get(g.ent!);
        return !!claim && claim !== self.id && !!room.players.get(claim)?.alive;
      }
      case 'fight':
        return !this.farFoe || now - this.farFoe.t > 1.2 || !room.players.get(this.farFoe.id)?.alive;
      case 'cover':
        return false;
      case 'hunt': {
        const q = g.foe ? room.players.get(g.foe) : null;
        return !q?.alive || Math.hypot(q.move.x - self.move.x, q.move.z - self.move.z) < 9;
      }
      case 'hold':
        return now >= (g.holdUntil ?? 0);
    }
  }

  /**
   * The goal stack. Keeps the current goal unless something of higher priority applies, it is
   * done, or it timed out (a timeout counts as a failure: the target is ignored for a while).
   */
  private decide(room: Room, game: BlackoutGame, self: PlayerState, now: number): void {
    const c = game.circle();
    if (!c) return;
    const g = this.goal;
    if (g && now > g.until) {
      this.stats.timeouts++;
      this.giveUp(now);
    } else if (g && this.finished(room, game, self, now)) {
      if (g.kind === 'loot' && g.ent !== undefined) game.lootClaims.delete(g.ent);
      this.setGoal(null, now);
    }
    this.late = c.phase >= 3;
    const cur = this.goal;
    const curP = cur ? PRIORITY[cur.kind] : 0;
    const st = bx(self);
    const p = self.move;
    const kit = kitOf(self);
    const underFire = !!this.hurtBy && now - this.hurtBy.t < 2.5;

    // 1. Heal.
    const outsideNow = outsideBy(c.cur, p.x, p.z) > 0;
    const hurt = self.health < self.maxHealth * (this.target || underFire ? 0.4 : outsideNow ? 0.45 : 0.75);
    if (curP < PRIORITY.heal && hurt && kit.heals > 0 && st.healUntil === null && !underFire && !this.target && this.farFoeFresh(now) === null) {
      this.setGoal({ kind: 'heal', x: p.x, y: p.y, z: p.z, since: now, until: now + 9, ...(outsideNow ? { zone: c.cur } : {}) }, now);
      // Healing outside the zone: keep walking in (the goal point is set by the circle logic below).
      if (!outsideNow) return;
    }

    // 2. The safe zone: outside it, or outside the next one with too little time to walk in.
    const zone = this.zoneTarget(game, self, c, now);
    if (zone && curP < PRIORITY.circle) {
      const spot = this.spotInside(room, game, self, zone, now);
      if (this.goal?.kind === 'heal') {
        // Heal on the move: walk to the spot while the bandage runs.
        this.goal.x = spot.x;
        this.goal.y = spot.y;
        this.goal.z = spot.z;
        this.goal.zone = zone;
        this.needRoute = true;
        return;
      }
      this.setGoal({ kind: 'circle', ...spot, since: now, until: now + 25 + Math.hypot(spot.x - p.x, spot.z - p.z) / 3.5, zone }, now);
      return;
    }
    if (this.goal) {
      // Committed. Only a far fight may interrupt holding or walking to cover.
      if (curP <= PRIORITY.cover && this.farFoeFresh(now)) this.startFarFight(self, now);
      return;
    }

    // 3. Loot when under-equipped (and anything useful close by in any case).
    const loot = this.findLoot(room, game, self, c, kit, now);
    if (loot) {
      this.setGoal({ kind: 'loot', x: loot.x, y: loot.y, z: loot.z, since: now, until: now + 10 + Math.hypot(loot.x - p.x, loot.z - p.z) / 3, ent: loot.id }, now);
      game.lootClaims.set(loot.id, self.id);
      return;
    }

    // 4. A far fight the game put it in.
    if (this.farFoeFresh(now)) {
      this.startFarFight(self, now);
      return;
    }

    // 5. Late in the match, half the time: move up on the nearest player (fights happen before
    // the last circle does it for them).
    if (this.late && this.rnd() < 0.5) {
      let foe: PlayerState | null = null;
      let fd = 70;
      for (const q of game.playersNear(p.x, p.z, 70)) {
        if (q === self || !q.alive || bx(q).stage !== 'ground') continue;
        const d = Math.hypot(q.move.x - p.x, q.move.z - p.z);
        if (d < fd) {
          fd = d;
          foe = q;
        }
      }
      if (foe && fd > 9) {
        this.setGoal({ kind: 'hunt', x: foe.move.x, y: foe.move.y, z: foe.move.z, since: now, until: now + 12, foe: foe.id }, now);
        return;
      }
    }

    // 6. Cover inside the next circle: go there, hold, then move on.
    const into = c.next ?? c.cur;
    const spot = this.coverSpot(room, game, self, into, now);
    this.setGoal({ kind: 'cover', ...spot.at, since: now, until: now + 20 + Math.hypot(spot.at.x - p.x, spot.at.z - p.z) / 3, ...(spot.i >= 0 ? { spot: spot.i } : {}) }, now);
  }

  private farFoeFresh(now: number): string | null {
    return this.farFoe && now - this.farFoe.t < 1.2 ? this.farFoe.id : null;
  }

  private startFarFight(self: PlayerState, now: number): void {
    const foe = this.farFoeFresh(now);
    // With only a knife it keeps looting (or walking to cover) rather than standing in a gunfight.
    if (!foe || !kitOf(self).armed) return;
    this.setGoal({ kind: 'fight', x: self.move.x, y: self.move.y, z: self.move.z, since: now, until: now + 20, foe }, now);
  }

  /** Arrived at a cover spot: hold it for a while. */
  private arrive(g: Goal, now: number): void {
    g.kind = 'hold';
    g.holdUntil = now + (this.late ? 6 + this.rnd() * 6 : 10 + this.rnd() * 15);
    g.until = g.holdUntil + 1;
    this.path = null;
    this.needRoute = false;
  }

  /** The circle to be inside now: the current one, or the next when it is time to move. */
  private zoneTarget(game: BlackoutGame, self: PlayerState, c: NonNullable<ReturnType<BlackoutGame['circle']>>, now: number): Circle | null {
    const p = self.move;
    const t = now - (game.t0 ?? now);
    const g = this.goal;
    // Hysteresis: going in, it keeps going until well inside (finished()); a bot just inside the
    // edge counts as outside so it doesn't hover on the line.
    if (outsideBy(c.cur, p.x, p.z) > -2) return c.cur;
    if (c.next) {
      const out = outsideBy(c.next, p.x, p.z);
      if (out > -2) {
        // Walking time at ~5.5 m/s along a route ~1.3x the straight line, plus a margin to spare.
        const walk = ((out + 10) * 1.3) / 5.5;
        const left = c.stage === 'shrink' ? 0 : (c.endsAt ?? t) - t;
        if (left < walk + 25 || g?.kind === 'circle') return c.next;
      }
    }
    return null;
  }

  /** Somewhere to go inside a circle: an indoor loot spot near the bot's side of it, else a point. */
  private spotInside(room: Room, game: BlackoutGame, self: PlayerState, zone: Circle, now: number): Vec3 {
    const p = self.move;
    const nav = islandNavFor(room.map);
    const r = zone.r * 0.65;
    let best: Vec3 | null = null;
    let bs = Infinity;
    if (zone.r > 12) {
      const spots = lootSpots(room.map, room.world);
      for (let i = 0; i < spots.length; i++) {
        const s = spots[i]!;
        if (Math.hypot(s.x - zone.x, s.z - zone.z) > r || this.ignored(`s${i}`, now) || this.ignored(`c${Math.round(s.x)},${Math.round(s.z)}`, now)) continue;
        const score = Math.hypot(s.x - p.x, s.z - p.z) - (s.indoor ? 15 : 0) + this.rnd() * 25;
        if (score < bs) {
          bs = score;
          best = s;
        }
      }
    }
    if (best) return { x: best.x, y: best.y, z: best.z };
    // A point on the line to the centre, well inside, nudged to walkable ground.
    for (let k = 0; k < 6; k++) {
      const a = Math.atan2(p.z - zone.z, p.x - zone.x) + (this.rnd() - 0.5) * (0.8 + k * 0.5);
      const rr = zone.r * (0.15 + this.rnd() * 0.45);
      const x = zone.x + Math.cos(a) * rr;
      const z = zone.z + Math.sin(a) * rr;
      const gk = nav.ground.cellNear(x, z);
      if (gk >= 0) return nav.ground.centre(gk);
      const ti = nav.townAt(x, z, 0);
      if (ti >= 0) {
        const tn = nav.town(ti);
        const cell = tn.cellAt({ x, y: 0, z }, true);
        if (cell >= 0 && tn.core[cell]) return { x: tn.x[cell]!, y: tn.y[cell]!, z: tn.z[cell]! };
      }
    }
    return { x: zone.x, y: 0, z: zone.z };
  }

  /** A building or cover spot inside the circle to hold, not far, not one it gave up on. */
  private coverSpot(room: Room, game: BlackoutGame, self: PlayerState, zone: Circle, now: number): { at: Vec3; i: number } {
    const p = self.move;
    const spots = lootSpots(room.map, room.world);
    const rr = Math.max(4, zone.r * 0.8);
    const hunt = (game.circle()?.phase ?? 0) >= 3;
    let best = -1;
    let bs = Infinity;
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i]!;
      if (Math.hypot(s.x - zone.x, s.z - zone.z) > rr || this.ignored(`s${i}`, now)) continue;
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < 4 || d > 110) continue;
      let score = d * 0.6 - (s.indoor ? 18 : 0) + this.rnd() * 30;
      // Late in the match it moves up on whoever is around (the circle won't wait).
      if (hunt) for (const q of game.playersNear(s.x, s.z, 22)) if (q !== self && q.alive) {
        score -= 30;
        break;
      }
      if (score < bs) {
        bs = score;
        best = i;
      }
    }
    if (best >= 0) return { at: { x: spots[best]!.x, y: spots[best]!.y, z: spots[best]!.z }, i: best };
    return { at: this.spotInside(room, game, self, zone, now), i: -1 };
  }

  /**
   * Loot worth going for: guns while unarmed or for a clear upgrade, ammo when low, a vest, heals.
   * Under-equipped it looks further (90 m, 140 m without a gun); otherwise only close by (14 m).
   * Inside the zone it's heading for, on its floor or a stair away, not claimed, not given up on.
   */
  private findLoot(room: Room, game: BlackoutGame, self: PlayerState, c: NonNullable<ReturnType<BlackoutGame['circle']>>, kit: ReturnType<typeof kitOf>, now: number): { x: number; y: number; z: number; id: number } | null {
    const p = self.move;
    const range = !kit.armed ? 140 : kit.under ? 90 : 14;
    const zone = c.next && (c.endsAt ?? 0) - (now - (game.t0 ?? now)) < 40 ? c.next : c.cur;
    let best: { x: number; y: number; z: number; id: number } | null = null;
    let bestScore = Infinity;
    const needGun = !kit.armed;
    for (const e of game.lootNear(p.x, p.z, range)) {
      if (this.ignored(`e${e.id}`, now) || !insideCircle({ ...zone, r: Math.max(0, zone.r - 3) }, e.x, e.z)) continue;
      const claim = game.lootClaims.get(e.id);
      if (claim && claim !== self.id && room.players.get(claim)?.alive) continue;
      // Another floor costs a detour (stairs somewhere): weigh the height.
      const d = Math.hypot(e.x - p.x, e.z - p.z) + Math.max(0, Math.abs(e.y - p.y) - 0.6) * 4;
      let score = Infinity;
      if (e.kind === 'pickups_weapon') {
        const drop = e as DropEntity;
        if (!drop.data?.landed || self.weapons.some((w) => w.def.base.id === drop.data.weapon)) continue;
        const gain = gunValue(drop.data.weapon, drop.data.attachments.length) - Math.min(...self.weapons.slice(0, 2).map((w) => gunValue(w.def.base.id, w.def.attachmentIds.length, w.mag + w.reserve)));
        if (gain <= 0.5) continue;
        score = d - gain * (needGun ? 30 : 6);
      } else {
        const it = (e.data as { item: LootItem } | undefined)?.item;
        if (!it || !wants(self, it)) continue;
        if (needGun && d > 25 && it.k !== 'armor') continue;
        const w = it.k === 'armor' && !kit.armour ? 12 : it.k === 'ammo' && kit.lowAmmo ? 12 : (it.k === 'bandage' || it.k === 'medkit') && kit.heals === 0 ? 10 : 0;
        if (!kit.under && d > 8) continue;
        score = d - w;
      }
      if (score < bestScore) {
        bestScore = score;
        best = { x: e.x, y: e.y, z: e.z, id: e.id };
      }
    }
    return best;
  }

  /** In reach of a gun worth taking: swap for it (bots "hold USE" instantly). */
  private pickUp(room: Room, game: BlackoutGame, self: PlayerState): void {
    const g = this.goal;
    if (!g || g.kind !== 'loot' || g.ent === undefined) return;
    const e = room.entities.get(g.ent);
    if (!e || e.kind !== 'pickups_weapon') return;
    if (Math.hypot(e.x - self.move.x, e.z - self.move.z) > PICKUP.radius * 0.9 || Math.abs(e.y - self.move.y) > 1.5) return;
    const drop = e as DropEntity;
    if (!drop.data) return;
    const slot = game.pickupSlot(self) === self.slot && self.weapons[self.slot]?.def.base.id !== 'knife' ? worstSlot(self) : game.pickupSlot(self);
    if (swapBlocker(room, self, drop, { slot }) === null) {
      swapFor(room, self, drop, slot);
      this.slot = slot;
      game.lootChanged();
      game.lootClaims.delete(e.id);
      this.setGoal(null, room.time);
    } else this.giveUp(room.time);
    this.nextThink = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Moving
  // -------------------------------------------------------------------------------------------

  /** Route to the goal (rationed per tick by the game); no route: the goal is unreachable. */
  private route(room: Room, game: BlackoutGame, self: PlayerState): void {
    const g = this.goal;
    const budget = game.routeBudget(this.longRoute);
    if (!g || budget <= 0) return;
    this.stats.routes++;
    const nav = islandNavFor(room.map);
    const path = nav.route(self.move, g, budget);
    game.spendRoute(nav.lastExpanded);
    // Out of search budget this tick: try again next tick (not a failure), with a long search if
    // it had most of a tick's budget already.
    if (!path && nav.lastHitLimit) {
      if (this.longRoute) this.giveUp(room.time);
      else if (budget >= 8000) this.longRoute = true;
      return;
    }
    this.longRoute = false;
    this.needRoute = false;
    if (!path) {
      // Stranded on top of something (it landed there): walk off the edge first.
      const down = nav.wayDown(self.move);
      if (down) {
        this.path = [down];
        this.pathIdx = 0;
        this.pathAim = 0;
        this.needRoute = true;
        this.nextRouteAt = room.time + 2.5;
        return;
      }
    }
    if (!path || !path.length) {
      this.stats.noRoute++;
      this.giveUp(room.time);
      this.nextThink = 0;
      return;
    }
    this.path = path;
    this.pathIdx = 0;
    this.pathAim = 0;
    this.nextPull = 0;
    this.bestD = Infinity;
    this.bestT = room.time;
  }

  /** Steer along the route: the farthest waypoint in a straight walkable line, jumps where needed. */
  private follow(room: Room, self: PlayerState, now: number, near: boolean): { yaw: number; jump: boolean; d: number } {
    const pos = self.move;
    const g = this.goal!;
    const p = this.path;
    if (!p || this.pathIdx >= p.length) {
      const dx = g.x - pos.x;
      const dz = g.z - pos.z;
      return { yaw: Math.atan2(-dx, -dz), jump: false, d: Math.hypot(dx, dz) };
    }
    // Skip waypoints reached (or passed: the nearest of the next few on this level).
    let k = this.pathIdx;
    let bd = Infinity;
    for (let j = this.pathIdx; j < Math.min(p.length, this.pathIdx + 8); j++) {
      const w = p[j]!;
      const d = Math.hypot(w.x - pos.x, w.z - pos.z) + Math.abs(w.y - pos.y) * 2;
      if (d < bd) {
        bd = d;
        k = j;
      }
    }
    if (bd < 0.8) k++;
    if (k > this.pathIdx) {
      this.pathIdx = Math.min(k, p.length);
      this.pathAim = Math.max(this.pathAim, this.pathIdx);
    }
    if (this.pathIdx >= p.length) {
      const dx = g.x - pos.x;
      const dz = g.z - pos.z;
      return { yaw: Math.atan2(-dx, -dz), jump: false, d: Math.hypot(dx, dz) };
    }
    // String pull now and then (near bots only: far ones walk waypoint to waypoint, which nobody
    // sees and costs no line checks): the farthest of a few waypoints ahead in a clear line.
    if (near && now >= this.nextPull) {
      this.nextPull = now + 0.25;
      let aim = this.pathIdx;
      for (const ahead of [6, 4, 2]) {
        const j = Math.min(p.length - 1, this.pathIdx + ahead);
        if (j <= this.pathIdx) continue;
        let jumpBetween = false;
        for (let q = this.pathIdx; q <= j; q++) if (p[q]!.jump) jumpBetween = true;
        if (jumpBetween || Math.hypot(p[j]!.x - pos.x, p[j]!.z - pos.z) > 14) continue;
        if (clearLine(room.world, pos, p[j]!)) {
          aim = j;
          break;
        }
      }
      this.pathAim = aim;
    } else if (!near) this.pathAim = this.pathIdx;
    const w = p[Math.max(this.pathAim, this.pathIdx)]!;
    const next = p[this.pathIdx]!;
    const dx = w.x - pos.x;
    const dz = w.z - pos.z;
    const dn = Math.hypot(next.x - pos.x, next.z - pos.z);
    const jump = (!!next.jump || next.y - pos.y > 0.4) && dn < 1.3 && next.y > pos.y + 0.25;
    return { yaw: Math.atan2(-dx, -dz), jump, d: dn };
  }

  /**
   * Stuck detection: the distance to the next waypoint must keep shrinking. After 1.5 s without
   * progress: jump and sidestep; then re-route; after four tries the goal is given up.
   */
  private watchProgress(room: Room, game: BlackoutGame, self: PlayerState, now: number, d: number): number {
    // A new waypoint (or a new route): measure progress toward it from here.
    const key = this.path ? this.pathIdx : -1;
    if (key !== this.progIdx) {
      // Reaching a waypoint is progress: the tries start over.
      if (key > this.progIdx) this.stuckTries = 0;
      this.progIdx = key;
      this.bestD = d;
      this.bestT = now;
      return 0;
    }
    if (d < this.bestD - 0.25) {
      this.bestD = d;
      this.bestT = now;
      return 0;
    }
    if (now - this.bestT < 1.5) return 0;
    this.bestT = now;
    this.bestD = d;
    this.stuckTries++;
    this.detour = (this.rnd() < 0.5 ? -1 : 1) * (0.7 + this.rnd() * 0.9);
    this.detourUntil = now + 0.7;
    if (this.stuckTries >= 2) this.needRoute = true;
    if (this.stuckTries >= 4) {
      this.stats.stuck++;
      this.giveUp(now);
      this.nextThink = 0;
    }
    void room;
    void game;
    return this.jumpPulse();
  }

  // -------------------------------------------------------------------------------------------
  // Fighting (near bots only)
  // -------------------------------------------------------------------------------------------

  private perceive(room: Room, game: BlackoutGame, self: PlayerState, sk: BotSkill, now: number): void {
    const eye = eyeOf(self);
    const halfFov = (sk.fovDeg / 2) * DEG;
    let best: PlayerState | null = null;
    let bestScore = Infinity;
    for (const q of game.playersNear(self.move.x, self.move.z, 90)) {
      if (q === self || !q.alive || bx(q).stage === 'plane') continue;
      const c = chestOf(q);
      const d = dist(eye, c);
      if (d > 90) continue;
      const hurtByQ = !!this.hurtBy && this.hurtBy.id === q.id && now - this.hurtBy.t < 3;
      // Fair play: humans already busy with MAX_ON_HUMAN bots are left alone (unless they shot us).
      if (!q.isBot && q !== this.target && !hurtByQ && game.engagedOn(q) >= MAX_ON_HUMAN) continue;
      // Bots don't take on every other bot they see (they loot and rotate too; the same odds as
      // far fights): the choice holds for a few seconds. Humans and whoever shot it: always.
      if (q.isBot && !hurtByQ && d > 55) continue;
      if (q.isBot && q !== this.target && !hurtByQ) {
        let truce = this.truce.get(q.id);
        if (!truce || now > truce.until) this.truce.set(q.id, (truce = { fight: this.rnd() < fightOdds(game.circle()?.phase ?? 0, true), until: now + 4 + this.rnd() * 3 }));
        if (!truce.fight) continue;
      }
      const off = Math.abs(angleDiff(yawTo(eye, c), this.aim.yaw));
      const prev = this.notice.get(q.id) ?? 0;
      const tracking = q === this.target;
      if (!(off <= halfFov || tracking || d < 2.5 || hurtByQ) || !visiblePart(room.world, room.map, eye, q)) {
        if (prev > 0) this.notice.set(q.id, Math.max(0, prev - 0.075));
        continue;
      }
      let progress = 1;
      if (!tracking) {
        const firing = now - q.lastFireTime < 0.3 && !q.lastFireSuppressed;
        const nt = (d < 2.5 && off > halfFov) || hurtByQ ? 0.4 : noticeTime(sk, d, off / DEG, firing);
        progress = Math.min(1, prev + 0.05 / nt);
        this.notice.set(q.id, progress);
      }
      if (progress < 1) continue;
      const score = d * (tracking ? 0.6 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = q;
      }
    }
    if (!best && this.target?.alive && this.lastSeen && now - this.lastSeen.t < 0.25) best = this.target;
    if (best !== this.target) {
      if (this.target) game.disengage(this.target, self);
      this.target = best;
      if (best) {
        game.engage(best, self);
        const at = chestOf(best);
        engage(this.aim, sk, this.rnd, { yaw: yawTo(eye, at), pitch: Math.atan2(at.y - eye.y, Math.hypot(at.x - eye.x, at.z - eye.z)) });
        this.aim.head = this.rnd() < sk.headshotBias * 0.6;
      }
    }
  }

  private fight(room: Room, self: PlayerState, sk: BotSkill, dt: number, now: number): number {
    const t = this.target!;
    const eye = eyeOf(self);
    const vis = visiblePart(room.world, room.map, eye, t);
    if (vis) this.lastSeen = { at: { ...t.move }, t: now };
    else if (!this.lastSeen || now - this.lastSeen.t > 0.25) {
      this.target = null;
      return 0;
    }
    const aimPt = vis === 'head' || this.aim.head ? headOf(t) : chestOf(t);
    const d = dist(eye, aimPt);
    const trueYaw = yawTo(eye, aimPt);
    const truePitch = Math.atan2(aimPt.y - eye.y, Math.hypot(aimPt.x - eye.x, aimPt.z - eye.z));
    const w = currentWeapon(self);
    const def = w?.def;
    const ctx = { dist: d, latSpeed: Math.hypot(t.move.vx, t.move.vz) * 0.6, moving: Math.hypot(self.move.vx, self.move.vz) > 0.5, ads: self.move.ads };
    const intended = stepAim(this.aim, sk, trueYaw, truePitch, dt, ctx, def?.recoil.recovery ?? 10);
    const style = STYLE[def?.class ?? 'ar'] ?? STYLE.ar!;
    let buttons = 0;
    const knife = !def || def.base.id === 'knife';
    if (!knife && d > style.ads) buttons |= Buttons.ADS;
    if (knife) {
      // Knife only: rush in and lunge.
      if (vis && d < 1.9 && !(this.prev & Buttons.MELEE)) buttons |= Buttons.MELEE;
    } else if (w && w.mag === 0) {
      if (w.reserve > 0 && self.reloadEnd === 0 && !(this.prev & Buttons.RELOAD)) buttons |= Buttons.RELOAD;
    } else if (w && vis && self.reloadEnd === 0 && now >= self.swapEnd && !self.move.sprinting) {
      const onTarget = this.aim.react <= 0 && feltOffDeg(this.aim, sk, intended.yaw, intended.pitch) < toleranceDeg(d);
      if (onTarget && now >= this.pauseUntil && now >= this.nextShot && botCanHit(room.world, room.map, eye, aimPt)) {
        const res = room.fire(self, { dir: viewDir(this.aim.yaw, this.aim.pitch) });
        if (res.ok) {
          this.stats.shots++;
          addRecoil(this.aim, w.def.recoil, self.move.ads, this.rnd);
          buttons |= Buttons.FIRE;
          if (w.def.mode === 'auto' || w.def.mode === 'burst') {
            if (--this.burst <= 0) {
              this.burst = d > 15 ? Math.round(8 - 5 * sk.burstControl) : 14;
              this.pauseUntil = now + 0.1 + 0.3 * sk.burstControl * (d > 10 ? 1 : 0.3) + this.rnd() * 0.1;
            }
          } else this.nextShot = now + (60 / Math.max(30, w.def.rpm)) * (1.2 + (1 - sk.burstControl) * 0.6);
        }
      }
    }
    // Movement: hold the weapon's range, strafe.
    if (now >= this.strafeUntil) {
      this.strafe = this.rnd() < sk.strafe ? (this.rnd() < 0.5 ? -1 : 1) : 0;
      this.strafeUntil = now + 0.4 + this.rnd() * 0.9;
    }
    if (this.strafe < 0) buttons |= Buttons.LEFT;
    else if (this.strafe > 0) buttons |= Buttons.RIGHT;
    const want = knife ? 0.8 : style.range;
    if (d > want * 1.3) buttons |= Buttons.FORWARD | (knife && d > 6 ? Buttons.SPRINT : 0);
    else if (d < want * 0.5 && !knife) buttons |= Buttons.BACK;
    return buttons;
  }
}

/** How much a gun is worth to a bot (rarity, class; an empty one is worth little). */
export function gunValue(id: string, attachments: number, ammo = 1): number {
  if (id === 'knife') return 0;
  const base = id === 'raygun' ? 6 : ['m1911', 'python', 'asp'].includes(id) ? 1.5 : ['olympia', 'stakeout'].includes(id) ? 2.2 : 3;
  return ammo > 0 ? base + attachments * 0.6 : 0.4;
}

/** The slot holding the weaker gun. */
export function worstSlot(p: PlayerState): number {
  const v = (i: number) => {
    const w = p.weapons[i];
    return w ? gunValue(w.def.base.id, w.def.attachmentIds.length, w.mag + w.reserve) : -1;
  };
  return v(0) <= v(1) ? 0 : 1;
}

/** The bots feature calls this for every bot in a Blackout room. */
export function createBlackoutBrain(_room: Room, _bot: PlayerState, skill: BotSkill): BlackoutBrain {
  return new BlackoutBrain(skill);
}
