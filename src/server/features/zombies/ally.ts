/**
 * The AI ally ("partner"): a bot survivor that plays like a decent co-op teammate. Solo games get
 * one by default (`zombies.solo { allies, allyDifficulty }`), co-op lobbies with bot fill get them
 * too. Not the bots feature's soldier brain (that one hunts enemies across a map): this brain stays
 * with the player, shoots what threatens them, revives, buys and calls things out. It reuses the
 * bots' aim controller (aim.ts: reaction, springs, error, sway, recoil), noticing time and sight
 * (sight.ts: collision plus drawn cover) and nav grid (nav.ts).
 *
 * Each tick, in order:
 * - Down: it can't move much; it shoots the nearest zombie with its pistol and calls for help.
 * - A teammate is down: revive is urgent. It goes to them and holds USE. If the zombies around it
 *   (or around the downed player) outnumber what it will revive through (`reviveSwarm` by
 *   difficulty), it backs off and fights first, unless the bleed-out is close (`reviveUrgentSec`).
 * - Overwhelmed (3+ zombies within 3.5 m): it backs away from them while shooting.
 * - Buying (only with no zombie within 9 m, at most 28 m away): ammo for a wall gun when low, a
 *   better wall gun when it can afford it, Juggernog then Quick Revive, and now and then the box.
 * - A power-up within 6 m (Max Ammo only when it is low itself, so it doesn't spend yours early).
 * - Otherwise it follows the nearest human: 6-15 m away, to one side and a little behind, out of
 *   their line of fire, and it steps aside when they come at it (no blocking doorways).
 * Fighting runs alongside all of it but USE holds: the target is the visible zombie closest to the
 * player it follows (closer to itself breaks ties, anything within reach of it comes first), the
 * head on `headAim` of engagements (by difficulty).
 */
import { BOT_DIFFICULTY_BY_ID, type BotSkill } from '../../../shared/defs/bots';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import { BOX, perkPrice, PERK_COLA_BY_ID, ZM_ENTITY, ZOMBIES, ZOMBIES_ALLY, type AllyDifficulty, type AllyTuning, type PerkColaId } from '../../../shared/defs/zombies';
import { BOX_PHASE } from '../../../shared/defs/mystery-box';
import { Buttons } from '../../../shared/input';
import { shotInterval } from '../../../shared/ballistics';
import { clamp, viewDir, yawTo, type Vec3 } from '../../../shared/math';
import { eyeOf } from '../../combat';
import { currentWeapon, type BotBrain, type PlayerState } from '../../player';
import type { Room } from '../../room';
import { addRecoil, angleDiff, engage, feltOffDeg, lookToward, newAimState, noticeTime, stepAim, toleranceDeg } from '../bots/aim';
import { navFor, type NavCell, type NavGrid } from '../bots/nav';
import { botCanHit, botCanSee, chestOf, headOf } from '../bots/sight';
import type { ZombiesGame } from './game';
import { survivorOf, undeadOf } from './state';

export type AllyMode = 'follow' | 'fight' | 'revive' | 'retreat' | 'buy' | 'grab' | 'down';

/** The skill an ally aims and notices with: the bots' preset, a little quicker to the head. */
export function allySkill(d: AllyDifficulty): BotSkill {
  const t = ZOMBIES_ALLY.tuning[d];
  const base = BOT_DIFFICULTY_BY_ID.get(t.preset)!.skill;
  return { ...base, headshotBias: t.headAim, fovDeg: Math.max(base.fovDeg, 120) };
}

interface BuyPlan {
  kind: 'wall' | 'ammo' | 'perk' | 'box';
  /** The entity it buys from, and where it stands to do it. */
  ent: number;
  at: Vec3;
  label: string;
  cost: number;
  since: number;
  /** Points before the buy (it knows it bought when they drop). */
  before: number;
  /** Box: the weapon is up; release USE, then take it. */
  taking: boolean;
}

const flat = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
const DEG = Math.PI / 180;
/** Wall guns it rates (higher is better); anything not listed rates by price. */
const GUN_RANK: Record<string, number> = { m1911: 0, asp: 1, olympia: 2, mpl: 3, mp5k: 4, m16: 5, ak74u: 6, commando: 7, stakeout: 6.5 };

export class AllyBrain implements BotBrain {
  readonly aim = newAimState();
  readonly skill: BotSkill;
  readonly tuning: AllyTuning;
  mode: AllyMode = 'follow';
  target: PlayerState | null = null;
  /** Who it follows (the nearest human). */
  leader: PlayerState | null = null;
  buy: BuyPlan | null = null;
  /** Shots fired, revives started (tests and tuning). */
  readonly stats = { shots: 0, revives: 0, buys: 0 };

  private nav: NavGrid;
  private path: NavCell[] | null = null;
  private pathIdx = 0;
  private pathGoal: Vec3 | null = null;
  private replanAt = 0;
  private followSpot: Vec3 | null = null;
  private side: 1 | -1;
  private notice = new Map<string, number>();
  private visible: PlayerState[] = [];
  private seeAt = 0;
  private targetAt = 0;
  private nextShotAt = 0;
  private nextMeleeAt = 0;
  private prevButtons = 0;
  private slotWanted = 0;
  /** A buy needs this slot in hand (the gun it will replace). */
  private holdSlot: number | null = null;
  private planAt = 0;
  private boxRolledRound = -1;
  private stuckAt: Vec3 = { x: 0, y: 0, z: 0 };
  private stuckT = 0;
  private jumpHeld = false;
  private calloutAt = new Map<string, number>();
  private lastDt = 1 / 60;

  constructor(
    readonly game: ZombiesGame,
    readonly self: PlayerState,
    readonly difficulty: AllyDifficulty,
    readonly rnd: () => number = Math.random,
  ) {
    this.skill = allySkill(difficulty);
    this.tuning = ZOMBIES_ALLY.tuning[difficulty];
    this.nav = navFor(game.room.map);
    this.side = rnd() < 0.5 ? 1 : -1;
  }

  /** A fresh life (spawn, or a new round after bleeding out). */
  onSpawn(): void {
    this.target = null;
    this.path = null;
    this.buy = null;
    this.followSpot = null;
    this.notice.clear();
    this.aim.yaw = this.self.yaw;
    this.aim.pitch = 0;
    this.mode = 'follow';
  }

  think(room: Room, self: PlayerState, dt: number): ReturnType<BotBrain['think']> {
    const g = this.game;
    const s = survivorOf(self);
    if (!s || !self.alive) return null;
    this.lastDt = dt;
    const now = room.time;
    const eye = eyeOf(self);
    if (this.nav !== navFor(room.map)) this.nav = navFor(room.map);
    let buttons = 0;
    let move: Vec3 | null = null;
    let sprint = false;

    this.leader = this.pickLeader();
    this.perceive(room, self, eye, now);
    const zombies = g.aliveUndead();
    const swarm = zombies.filter((z) => flat(z.move, self.move) < ZOMBIES_ALLY.swarmRadius && Math.abs(z.move.y - self.move.y) < 2).length;

    // ---- Down: shoot from the floor, ask for help.
    if (g.isDown(self)) {
      this.mode = 'down';
      this.buy = null;
      this.callout('down', `${self.name.toUpperCase()} NEEDS A REVIVE`);
      buttons |= this.fight(room, self, eye, now, dt, true);
      return this.out(self, buttons);
    }

    // ---- Revive a downed teammate (urgent).
    const downed = this.downedTeammate();
    let using = false;
    if (downed) {
      this.buy = null;
      const ls = downed.ext.perks!.lastStand!;
      const left = ls.until - now;
      const nearDowned = zombies.filter((z) => flat(z.move, downed.move) < ZOMBIES_ALLY.swarmRadius).length;
      const pressure = Math.max(swarm, nearDowned);
      const d = flat(self.move, downed.move);
      if (pressure > this.tuning.reviveSwarm && left > this.tuning.reviveUrgentSec) {
        this.mode = 'retreat';
        move = this.retreatFrom(self, zombies, downed.move);
      } else {
        this.mode = 'revive';
        if (d <= 1.0 && Math.abs(downed.move.y - self.move.y) < 1.2) {
          using = true;
          buttons |= Buttons.USE;
          if (ls.reviveBy !== self.id || ls.revive < 0.05) {
            if (!downed.isBot) this.callout('revive', `${self.name.toUpperCase()}: REVIVING YOU`, downed);
          }
        } else {
          move = downed.move;
          sprint = d > 4;
        }
      }
    } else if (swarm >= ZOMBIES_ALLY.overwhelmed) {
      this.mode = 'retreat';
      this.buy = null;
      move = this.retreatFrom(self, zombies, this.leader?.move ?? null);
    } else {
      // ---- Buy, grab, follow.
      const buy = this.planBuy(room, self, zombies, now);
      const grab = buy ? null : this.powerupNear(room, self);
      if (buy) {
        this.mode = 'buy';
        const target = g.buy.targetOf(self);
        const entId = target ? (target.kind === 'wall' ? target.wall.ent.id : target.kind === 'perk' ? target.perk.ent.id : (g.buy.box.ent?.id ?? -1)) : -1;
        if (entId === buy.ent && flat(self.move, buy.at) < 1.2) {
          using = this.useBuy(self, buy, now);
          if (using) buttons |= Buttons.USE;
        } else move = buy.at;
      } else if (grab) {
        this.mode = 'grab';
        move = grab;
      } else {
        this.mode = this.target ? 'fight' : 'follow';
        move = this.followGoal(self, now);
        if (move) sprint = !this.target && flat(self.move, move) > 8;
      }
    }

    // ---- Fight alongside (not while holding USE: reviving or buying lowers the gun).
    if (!using) buttons |= this.fight(room, self, eye, now, dt, false);
    else {
      this.target = null;
      lookToward(this.aim, this.skill, this.aim.yaw, -0.2, dt, 0.6);
    }

    // ---- Walk.
    let mx = 0;
    let mz = 0;
    let jump = false;
    if (move && !using) {
      const step = this.steer(self, move, now);
      if (step) {
        mx = step.x;
        mz = step.z;
        jump = step.jump;
      }
      if (!this.target && Math.hypot(mx, mz) > 0.1) lookToward(this.aim, this.skill, Math.atan2(-mx, -mz), 0, dt, 0.7);
    } else if (!this.target && !using) {
      // Standing: watch where the player looks (the zombies come from there), or the nearest zombie.
      const near = this.nearestZombie(self);
      const yaw = near && flat(near.move, self.move) < 20 ? yawTo(self.move, near.move) : this.leader ? this.leader.yaw : this.aim.yaw;
      lookToward(this.aim, this.skill, yaw, 0, dt, 0.5);
    }
    // Stuck: hop, then plan again.
    const moving = Math.hypot(mx, mz) > 0.2;
    if (moving) {
      this.stuckT += dt;
      if (this.stuckT > 0.6) {
        if (flat(self.move, this.stuckAt) < 0.3) {
          jump = true;
          if (this.stuckT > 1.5) {
            this.path = null;
            this.followSpot = null;
            this.side = this.side === 1 ? -1 : 1;
            this.stuckT = 0;
          }
        } else {
          this.stuckT = 0;
          this.stuckAt = { ...self.move };
        }
      }
    } else {
      this.stuckT = 0;
      this.stuckAt = { ...self.move };
    }
    const yaw = this.aim.yaw;
    const f = -Math.sin(yaw) * mx - Math.cos(yaw) * mz;
    const r = Math.cos(yaw) * mx - Math.sin(yaw) * mz;
    if (f > 0.38) buttons |= Buttons.FORWARD;
    if (f < -0.38) buttons |= Buttons.BACK;
    if (r > 0.38) buttons |= Buttons.RIGHT;
    if (r < -0.38) buttons |= Buttons.LEFT;
    if (sprint && f > 0.5 && !this.target && !(buttons & Buttons.ADS)) buttons |= Buttons.SPRINT;
    if (jump && !this.jumpHeld && self.move.onGround) {
      buttons |= Buttons.JUMP;
      this.jumpHeld = true;
    } else this.jumpHeld = false;
    return this.out(self, buttons);
  }

  private out(self: PlayerState, buttons: number): ReturnType<BotBrain['think']> {
    this.prevButtons = buttons;
    const slot = this.slotWanted < self.weapons.length ? this.slotWanted : 0;
    return { buttons, yaw: this.aim.yaw, pitch: clamp(this.aim.pitch, -1.4, 1.4), weaponSlot: slot };
  }

  // -------------------------------------------------------------------------------------------
  // Who and what
  // -------------------------------------------------------------------------------------------

  /** The human it sticks with: the nearest one up, else the nearest alive. */
  private pickLeader(): PlayerState | null {
    const g = this.game;
    let best: PlayerState | null = null;
    let bd = Infinity;
    for (const h of g.room.humans()) {
      if (!survivorOf(h) || !h.alive) continue;
      const d = flat(h.move, this.self.move) + (g.isDown(h) ? 1000 : 0);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  }

  /** A teammate down and revivable (humans first, then the nearest). */
  private downedTeammate(): PlayerState | null {
    const g = this.game;
    let best: PlayerState | null = null;
    let bd = Infinity;
    for (const q of g.survivors()) {
      if (q === this.self || !q.alive || !g.isDown(q)) continue;
      const ls = q.ext.perks?.lastStand;
      if (!ls || ls.revivable === false || survivorOf(q)?.selfReviveAt != null) continue;
      if (ls.reviveBy && ls.reviveBy !== this.self.id) continue;
      const d = flat(q.move, this.self.move) + (q.isBot ? 30 : 0);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return best;
  }

  private nearestZombie(self: PlayerState): PlayerState | null {
    let best: PlayerState | null = null;
    let bd = Infinity;
    for (const z of this.game.aliveUndead()) {
      const d = flat(z.move, self.move);
      if (d < bd) {
        bd = d;
        best = z;
      }
    }
    return best;
  }

  /**
   * Sight (every 0.1 s): zombies within 35 m it can see (sight.ts: collision and drawn cover), each
   * noticed after the bots' noticing time (zombies walking at you are noticed fast: off-FOV
   * ones within 4 m in 0.3 s).
   */
  private perceive(room: Room, self: PlayerState, eye: Vec3, now: number): void {
    if (now < this.seeAt) return;
    const dtp = Math.min(0.25, now - this.seeAt + 0.1);
    this.seeAt = now + 0.1;
    const out: PlayerState[] = [];
    const halfFov = (this.skill.fovDeg / 2) * DEG;
    for (const z of this.game.aliveUndead()) {
      const c = chestOf(z);
      const d = Math.hypot(c.x - eye.x, c.y - eye.y, c.z - eye.z);
      if (d > 35) {
        this.notice.delete(z.id);
        continue;
      }
      const off = Math.abs(angleDiff(yawTo(eye, c), this.aim.yaw));
      const near = d < 4;
      if ((off > halfFov && !near) || !botCanSee(room.world, room.map, eye, c)) {
        const p = this.notice.get(z.id) ?? 0;
        if (p > 0) this.notice.set(z.id, Math.max(0, p - dtp * 1.5));
        continue;
      }
      const nt = near && off > halfFov ? 0.3 : noticeTime(this.skill, d, off / DEG);
      const p = Math.min(1, (this.notice.get(z.id) ?? 0) + dtp / Math.max(0.01, nt));
      this.notice.set(z.id, p);
      if (p >= 1) out.push(z);
    }
    this.visible = out;
  }

  // -------------------------------------------------------------------------------------------
  // Fighting
  // -------------------------------------------------------------------------------------------

  /** Pick (every 0.25 s), aim, fire, reload, swap, knife. Returns buttons to hold. */
  private fight(room: Room, self: PlayerState, eye: Vec3, now: number, dt: number, down: boolean): number {
    let buttons = 0;
    // The best gun with ammo (it drops the pistol for a wall gun).
    if (!down) this.slotWanted = this.bestSlot(self);
    if (now >= this.targetAt || !this.target || !this.target.alive || !this.visible.includes(this.target)) {
      this.targetAt = now + 0.25;
      const prev = this.target;
      const lead = this.leader;
      let best: PlayerState | null = null;
      let bs = Infinity;
      for (const z of this.visible) {
        if (!z.alive || !undeadOf(z)) continue;
        const dSelf = flat(z.move, self.move);
        const dLead = lead && !down ? flat(z.move, lead.move) : dSelf;
        // Closest to the player first; anything on top of us first of all.
        const score = (dSelf < 2.5 ? -100 : 0) + dLead + dSelf * 0.35 + (z === prev ? -1.5 : 0);
        if (score < bs) {
          bs = score;
          best = z;
        }
      }
      if (best !== prev) {
        this.target = best;
        if (best) {
          const at = headOf(best);
          engage(this.aim, this.skill, this.rnd, { yaw: yawTo(eye, at), pitch: Math.atan2(at.y - eye.y, flat(at, eye)), quick: !!prev });
          this.aim.head = this.rnd() < this.tuning.headAim;
        }
      }
    }
    const t = this.target;
    const w = currentWeapon(self);
    if (!t || !w) {
      // Quiet: top the magazine up.
      if (w && !down && w.mag < w.def.magazine * 0.5 && w.reserve > 0 && self.reloadEnd === 0 && !(this.prevButtons & Buttons.RELOAD)) buttons |= Buttons.RELOAD;
      return buttons;
    }
    const pt = this.aim.head ? headOf(t) : chestOf(t);
    const d = Math.hypot(pt.x - eye.x, pt.y - eye.y, pt.z - eye.z);
    const lat = Math.abs(Math.sin(angleDiff(Math.atan2(-t.move.vx, -t.move.vz), yawTo(eye, pt)))) * Math.hypot(t.move.vx, t.move.vz);
    const ads = d > 7 && !down ? 1 : 0;
    if (ads) buttons |= Buttons.ADS;
    stepAim(this.aim, this.skill, yawTo(eye, pt), Math.atan2(pt.y - eye.y, flat(pt, eye)), dt, { dist: d, latSpeed: lat, moving: Math.hypot(self.move.vx, self.move.vz) > 0.5, ads: self.move.ads ?? ads }, w.def.recoil.recovery);
    // Knife what is on top of us when the gun is dry or reloading.
    const close = flat(t.move, self.move) < 1.3;
    if (close && (w.mag === 0 || self.reloadEnd > 0) && now >= this.nextMeleeAt && !down) {
      this.nextMeleeAt = now + 0.7;
      if (!(this.prevButtons & Buttons.MELEE)) buttons |= Buttons.MELEE;
      return buttons;
    }
    if (w.mag === 0 && w.reserve > 0 && self.reloadEnd === 0 && !(this.prevButtons & Buttons.RELOAD)) return buttons | Buttons.RELOAD;
    const tol = toleranceDeg(d, this.aim.head ? 0.5 : 1);
    if (now >= this.nextShotAt && this.aim.react <= 0 && feltOffDeg(this.aim, this.skill, yawTo(eye, pt), Math.atan2(pt.y - eye.y, flat(pt, eye))) <= tol && botCanHit(room.world, room.map, eye, pt)) {
      const res = room.fire(self, { dir: viewDir(this.aim.yaw, this.aim.pitch) });
      if (res.ok) {
        this.stats.shots++;
        addRecoil(this.aim, w.def.recoil, self.move.ads ?? ads, this.rnd);
        const iv = shotInterval(w.def) / room.modifiers.mul('fireRateMultiplier', self);
        // Semi-autos and pumps: a human's click rate on top of the gun's.
        const auto = w.def.mode === 'auto' || w.def.mode === 'burst';
        this.nextShotAt = now + iv * (auto ? 1 : 1.15) + (auto ? 0 : 0.06 + this.rnd() * 0.08);
      } else this.nextShotAt = now + 0.05;
      buttons |= Buttons.FIRE;
    }
    return buttons;
  }

  /** The slot with the best gun that still has ammo. */
  private bestSlot(self: PlayerState): number {
    if (this.holdSlot !== null && this.buy && this.holdSlot < self.weapons.length) return this.holdSlot;
    const far = this.target ? flat(this.target.move, self.move) > 12 : false;
    let best = this.slotWanted < self.weapons.length ? this.slotWanted : 0;
    let bs = -Infinity;
    self.weapons.forEach((w, i) => {
      if (w.mag + w.reserve <= 0) return;
      const id = w.def.base.id;
      // Shotguns do nothing at range: the other gun out there.
      const score = (GUN_RANK[id] ?? (w.def.class === 'pistol' ? 0.5 : w.def.class === 'special' ? 9 : 5)) + (i === self.slot ? 0.2 : 0) - (far && w.def.class === 'shotgun' ? 10 : 0);
      if (score > bs) {
        bs = score;
        best = i;
      }
    });
    return best;
  }

  // -------------------------------------------------------------------------------------------
  // Where to stand
  // -------------------------------------------------------------------------------------------

  /**
   * Next to the player it follows: 6-15 m, to its side and a little behind, out of the cone it
   * faces (its line of fire). It holds still while it is in that band and out of the lane; it
   * steps aside when the player comes at it.
   */
  private followGoal(self: PlayerState, now: number): Vec3 | null {
    const lead = this.leader;
    if (!lead) return null;
    const A = ZOMBIES_ALLY;
    const d = flat(self.move, lead.move);
    const inLane = this.inFireLane(lead, self.move);
    const closing = d < 3.5 && Math.hypot(lead.move.vx, lead.move.vz) > 1 && (lead.move.vx * (self.move.x - lead.move.x) + lead.move.vz * (self.move.z - lead.move.z)) > 0;
    const spot = this.followSpot;
    const spotOk = spot && flat(spot, lead.move) >= A.followMin - 1 && flat(spot, lead.move) <= A.followMax - 2 && !this.inFireLane(lead, spot);
    if (!inLane && !closing && d >= A.followMin - 1.5 && d <= A.followMax && (!spot || flat(self.move, spot) < 1.5 || !spotOk)) {
      this.followSpot = null;
      return null;
    }
    if (!spotOk || now >= this.replanAt + 2 || closing) this.followSpot = this.pickFollowSpot(lead);
    return this.followSpot;
  }

  private inFireLane(lead: PlayerState, p: Vec3): boolean {
    const d = flat(p, lead.move);
    if (d > ZOMBIES_ALLY.fireLaneRange || d < 0.5) return false;
    return Math.abs(angleDiff(yawTo(lead.move, p), lead.yaw)) < ZOMBIES_ALLY.fireLaneHalf;
  }

  /** A reachable cell at about `followIdeal` m, off to our side of the player and a bit behind. */
  private pickFollowSpot(lead: PlayerState): Vec3 | null {
    const fx = -Math.sin(lead.yaw);
    const fz = -Math.cos(lead.yaw);
    const rx = Math.cos(lead.yaw);
    const rz = -Math.sin(lead.yaw);
    const ideal = ZOMBIES_ALLY.followIdeal;
    for (const [side, back] of [[this.side, 0.45], [this.side, 0.1], [-this.side, 0.45], [this.side, 0.8], [-this.side, 0.1]] as const) {
      for (const k of [1, 0.75, 0.6]) {
        const r = ideal * k;
        const n = Math.hypot(side, back) || 1;
        const x = lead.move.x + ((rx * side - fx * back) / n) * r;
        const z = lead.move.z + ((rz * side - fz * back) / n) * r;
        const cell = this.nav.cellAt({ x, y: lead.move.y, z }, true);
        if (!cell || Math.abs(cell.y - lead.move.y) > 2.5 || flat(cell, { x, y: 0, z }) > 1.2) continue;
        if (this.inFireLane(lead, cell)) continue;
        this.side = side as 1 | -1;
        return { x: cell.x, y: cell.y, z: cell.z };
      }
    }
    return { ...lead.move };
  }

  /** Back away from the zombies near us (toward `toward` when given), on reachable floor. */
  private retreatFrom(self: PlayerState, zombies: PlayerState[], toward: Vec3 | null): Vec3 | null {
    let cx = 0;
    let cz = 0;
    let n = 0;
    for (const z of zombies) {
      if (flat(z.move, self.move) > 7) continue;
      cx += z.move.x;
      cz += z.move.z;
      n++;
    }
    if (!n) return toward;
    cx /= n;
    cz /= n;
    let ax = self.move.x - cx;
    let az = self.move.z - cz;
    const l = Math.hypot(ax, az) || 1;
    ax /= l;
    az /= l;
    if (toward) {
      // Lean toward the player (or the downed) unless that is into the zombies.
      const tx = toward.x - self.move.x;
      const tz = toward.z - self.move.z;
      const tl = Math.hypot(tx, tz) || 1;
      if ((tx / tl) * ax + (tz / tl) * az > -0.2) {
        ax = ax * 0.6 + (tx / tl) * 0.4;
        az = az * 0.6 + (tz / tl) * 0.4;
      }
    }
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2]) {
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      const dx = ax * c - az * s;
      const dz = ax * s + az * c;
      const cell = this.nav.cellAt({ x: self.move.x + dx * 5, y: self.move.y, z: self.move.z + dz * 5 }, true);
      if (cell && Math.abs(cell.y - self.move.y) < 1.5) return { x: cell.x, y: cell.y, z: cell.z };
    }
    return toward;
  }

  /** Walk toward `goal` along a nav path (string pulled); straight when close and clear. */
  private steer(self: PlayerState, goal: Vec3, now: number): { x: number; z: number; jump: boolean } | null {
    const pos = self.move;
    const d = flat(pos, goal);
    if (d < 0.35) return null;
    const cell = this.nav.cellAt(goal);
    if (d < 4 && Math.abs(goal.y - pos.y) < 0.6 && cell && this.nav.straight(pos, cell)) return { x: (goal.x - pos.x) / d, z: (goal.z - pos.z) / d, jump: false };
    if (!this.path || !this.pathGoal || flat(this.pathGoal, goal) > 1.5 || now >= this.replanAt) {
      this.replanAt = now + 1 + this.rnd() * 0.4;
      this.pathGoal = { ...goal };
      this.path = this.nav.path(pos, goal, 30000);
      this.pathIdx = 0;
    }
    const p = this.path;
    if (!p || !p.length) return { x: (goal.x - pos.x) / d, z: (goal.z - pos.z) / d, jump: false };
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
    while (this.pathIdx < p.length - 1 && Math.hypot(p[this.pathIdx]!.x - pos.x, p[this.pathIdx]!.z - pos.z) < 0.45) this.pathIdx++;
    let target = this.pathIdx;
    for (let j = this.pathIdx + 1; j < Math.min(p.length, this.pathIdx + 8); j++) {
      if (this.nav.edgeKind(p[j - 1]!, p[j]!) !== 'walk' || !this.nav.straight(pos, p[j]!)) break;
      target = j;
    }
    const wp = p[target]!;
    const dx = wp.x - pos.x;
    const dz = wp.z - pos.z;
    const l = Math.hypot(dx, dz) || 1;
    const next = p[this.pathIdx]!;
    const jump = next.y > pos.y + 0.3 && Math.hypot(next.x - pos.x, next.z - pos.z) < 1;
    return { x: dx / l, z: dz / l, jump };
  }

  // -------------------------------------------------------------------------------------------
  // Buying and power-ups
  // -------------------------------------------------------------------------------------------

  /**
   * The buy it is on, or a new one (checked every second): only with no zombie within `buySafe`
   * m and the stand spot within `buyReach` m. Priorities: ammo when low, Juggernog, Quick Revive, a
   * better wall gun, then (rolled once a round) the Mystery Box.
   */
  private planBuy(room: Room, self: PlayerState, zombies: PlayerState[], now: number): BuyPlan | null {
    const g = this.game;
    const s = survivorOf(self)!;
    // Dry (no gun with a round left): getting a gun or ammo is urgent, it goes through a little danger.
    const dry = !self.weapons.some((w) => w.mag + w.reserve > 0);
    const safe = dry ? 3 : ZOMBIES_ALLY.buySafe;
    const danger = zombies.some((z) => {
      const d = flat(z.move, self.move);
      return d < 3.5 || (d < safe && this.visible.includes(z));
    });
    if (this.buy) {
      const b = this.buy;
      const stale = now - b.since > 20 || (danger && !b.taking) || (s.points < b.cost && !b.taking);
      if (!stale) return b;
      this.buy = null;
    }
    if (danger || now < this.planAt || s.drinkingUntil > now) return null;
    this.planAt = now + 1;
    const reserve = dry ? 0 : this.tuning.buyReserve;
    const pts = s.points;
    const far = dry ? 2 : 1;
    const reach = (at: Vec3) => flat(at, self.move) <= ZOMBIES_ALLY.buyReach * far && (dry || !this.leader || flat(at, this.leader.move) <= ZOMBIES_ALLY.buyReach + 6);
    const plan = (kind: BuyPlan['kind'], ent: number, at: Vec3 | null, label: string, cost: number): BuyPlan | null => {
      if (!at || !reach(at)) return null;
      this.buy = { kind, ent, at, label, cost, since: now, before: pts, taking: false };
      if (kind === 'perk' || kind === 'wall' || kind === 'box') this.callout(`buy-${label}`, `${self.name.toUpperCase()}: GETTING ${label.toUpperCase()}`);
      return this.buy;
    };
    // Ammo for a wall gun it carries, when it is running dry.
    for (const w of g.buy.walls) {
      const own = self.weapons.find((x) => x.def.base.id === w.spot.weapon);
      if (!own) continue;
      const left = (own.mag + own.reserve) / (own.def.magazine + own.def.reserve);
      if (left < 0.35 && pts >= w.ammo) {
        const p = plan('ammo', w.ent.id, this.wallSpot(w.spot), `${WEAPON_BY_ID.get(w.spot.weapon)?.name ?? w.spot.weapon} ammo`, w.ammo);
        if (p) return p;
      }
    }
    // No real gun yet (pistols only): the best wall gun it can afford comes before anything else.
    const rankOf = (id: string) => GUN_RANK[id] ?? (WEAPON_BY_ID.get(id)?.class === 'pistol' ? 0.5 : 5);
    const primaries = self.weapons.filter((w) => rankOf(w.def.base.id) >= 2 && w.mag + w.reserve > 0);
    const bestAffordable = (minRank: number, spare: number) => {
      let best: (typeof g.buy.walls)[number] | null = null;
      for (const w of g.buy.walls) {
        const id = w.spot.weapon;
        if (self.weapons.some((x) => x.def.base.id === id)) continue;
        const rank = rankOf(id);
        if (rank < minRank || pts < w.price + spare || !this.wallSpot(w.spot) || !reach(this.wallSpot(w.spot)!)) continue;
        if (!best || rank > rankOf(best.spot.weapon)) best = w;
      }
      return best;
    };
    if (!primaries.length) {
      // Dry: anything; else save the starting points for an SMG or better.
      const w = bestAffordable(dry ? 1 : 3, 0);
      if (w) {
        const p = plan('wall', w.ent.id, this.wallSpot(w.spot), WEAPON_BY_ID.get(w.spot.weapon)?.name ?? w.spot.weapon, w.price);
        if (p) return p;
      }
    }
    // Perks: Juggernog, then Quick Revive.
    for (const id of ['jugg', 'revive'] as PerkColaId[]) {
      if (s.perks.includes(id)) continue;
      const m = g.buy.perks.find((k) => k.id === id);
      if (!m || (m.ent.s as { off?: number } | undefined)?.off === 1) continue;
      const cost = perkPrice(id, g.solo);
      if (pts < cost + (id === 'jugg' ? 0 : reserve)) break;
      const p = plan('perk', m.ent.id, this.besideSpot(m.ent, self), PERK_COLA_BY_ID.get(id)!.name, cost);
      if (p) return p;
    }
    // A clearly better wall gun (saving for Juggernog first: only with points to spare).
    const hasJug = s.perks.includes('jugg') || !g.buy.perks.some((k) => k.id === 'jugg');
    const best = Math.max(0, ...primaries.map((w) => rankOf(w.def.base.id)));
    const spare = hasJug ? reserve : perkPrice('jugg', g.solo);
    const bestWall = self.weapons.length < 2 ? bestAffordable(best + 0.5, spare) : bestAffordable(best + 1.5, spare);
    if (bestWall) {
      const p = plan('wall', bestWall.ent.id, this.wallSpot(bestWall.spot), WEAPON_BY_ID.get(bestWall.spot.weapon)?.name ?? bestWall.spot.weapon, bestWall.price);
      if (p) return p;
    }
    // The box, now and then (rolled once a round), with points to spare.
    const box = g.buy.box.ent;
    if (box && this.boxRolledRound !== g.round && pts >= BOX.cost + reserve * 2) {
      this.boxRolledRound = g.round;
      const ph = Number((box.s as { ph?: number } | undefined)?.ph ?? -1);
      if (ph === BOX_PHASE.idle && this.rnd() < this.tuning.boxChance) {
        const p = plan('box', box.id, this.besideSpot(box, self), 'the Mystery Box', BOX.cost);
        if (p) return p;
      }
    }
    void room;
    return null;
  }

  /**
   * At the buy spot: hold USE until the points drop (bought), let go. The box: after paying, wait
   * for the weapon, let go, then press again to take it (not a teddy bear, not a worse gun).
   */
  private useBuy(self: PlayerState, b: BuyPlan, now: number): boolean {
    const g = this.game;
    const s = survivorOf(self)!;
    if (b.kind === 'box') {
      const box = g.buy.box;
      if (box.user === self) {
        b.taking = true;
        const ph = Number((box.ent?.s as { ph?: number } | undefined)?.ph ?? -1);
        // The teddy bear, or the lid closing (taken, or left): done.
        if (box.teddy || box.closingAt !== null) {
          if (box.closingAt !== null && box.weapon && self.weapons.some((w) => w.def.base.id === box.weapon)) this.stats.buys++;
          this.buy = null;
          return false;
        }
        // Cycling: let go of USE (taking needs a fresh press), then hold it on the offer.
        if (ph !== BOX_PHASE.offer || !box.weapon || !box.released) return false;
        if (!this.wantsBoxGun(self, box.weapon)) {
          this.buy = null;
          return false;
        }
        return this.readySlot(self, now);
      }
      if (b.taking) {
        // Taken (or gone): done.
        this.buy = null;
        return false;
      }
    }
    if (b.kind === 'wall' && !this.readySlot(self, now)) return false;
    if (s.points < b.before) {
      // Bought.
      if (b.kind !== 'box') {
        this.stats.buys++;
        this.buy = null;
      } else b.taking = true;
      return false;
    }
    if (s.useLatched) {
      // A press that didn't buy (full ammo, not enough points...): give up on it.
      this.buy = null;
      return false;
    }
    void now;
    return true;
  }

  /**
   * A new gun replaces the one in hand when it carries two (BO1): put the worst one in hand first.
   * True when it is there.
   */
  private readySlot(self: PlayerState, now: number): boolean {
    if (self.weapons.length < 2) return true;
    let worst = 0;
    let ws = Infinity;
    self.weapons.forEach((w, i) => {
      const score = (w.mag + w.reserve > 0 ? 0 : -10) + (GUN_RANK[w.def.base.id] ?? (w.def.class === 'pistol' ? 0.5 : w.def.class === 'special' ? 9 : 5));
      if (score < ws) {
        ws = score;
        worst = i;
      }
    });
    this.holdSlot = worst;
    return self.slot === worst && now >= self.swapEnd;
  }

  private wantsBoxGun(self: PlayerState, id: string): boolean {
    const def = WEAPON_BY_ID.get(id);
    if (!def) return false;
    if (def.class === 'special') return true;
    if (self.weapons.length < 2) return true;
    const rank = GUN_RANK[id] ?? (def.class === 'pistol' ? 0.5 : 5.5);
    const inHand = currentWeapon(self);
    return rank > (inHand ? (GUN_RANK[inHand.def.base.id] ?? 5) : 0);
  }

  /** Where to stand for a wall-buy: 1 m in front of the chalk, on reachable floor. */
  private wallSpot(w: { x: number; y: number; z: number; yaw: number }): Vec3 | null {
    const fx = -Math.sin(w.yaw);
    const fz = -Math.cos(w.yaw);
    for (const k of [1.0, 0.8, 1.3]) {
      const cell = this.nav.cellAt({ x: w.x + fx * k, y: w.y, z: w.z + fz * k });
      if (!cell || Math.abs(cell.y - w.y) > 1.1) continue;
      const dx = cell.x - w.x;
      const dz = cell.z - w.z;
      if (Math.hypot(dx, dz) <= 1.5 && dx * fx + dz * fz > 0.25) return { x: cell.x, y: cell.y, z: cell.z };
    }
    return null;
  }

  /** Beside a machine or the box: a free cell within reach, on our side of it. */
  private besideSpot(e: { x: number; y: number; z: number; yaw: number }, self: PlayerState): Vec3 | null {
    const base = Math.atan2(self.move.x - e.x, self.move.z - e.z);
    for (const turn of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.4, -2.4, Math.PI]) {
      for (const r of [1.2, 1.0, 1.45]) {
        const a = base + turn;
        const cell = this.nav.cellAt({ x: e.x + Math.sin(a) * r, y: e.y, z: e.z + Math.cos(a) * r });
        if (!cell || Math.abs(cell.y - e.y) > 1.1) continue;
        if (Math.hypot(cell.x - e.x, cell.z - e.z) <= Math.min(ZOMBIES_ALLY.buyReach, 1.6)) return { x: cell.x, y: cell.y, z: cell.z };
      }
    }
    return null;
  }

  /** A power-up close enough to go for (Max Ammo only when it is low itself). */
  private powerupNear(room: Room, self: PlayerState): Vec3 | null {
    if (this.game.aliveUndead().some((z) => flat(z.move, self.move) < 3)) return null;
    let best: Vec3 | null = null;
    let bd: number = ZOMBIES_ALLY.powerupReach;
    for (const e of room.entities.byKind(ZM_ENTITY.powerup)) {
      const d = flat(e, self.move);
      if (d > bd || Math.abs(e.y - self.move.y) > 1.5) continue;
      if (e.s?.k === 'full_ammo') {
        const low = self.weapons.some((w) => w.def.class !== 'pistol' && (w.mag + w.reserve) / (w.def.magazine + w.def.reserve) < 0.4);
        if (!low) continue;
      }
      bd = d;
      best = { x: e.x, y: e.y, z: e.z };
    }
    return best;
  }

  // -------------------------------------------------------------------------------------------
  // Callouts
  // -------------------------------------------------------------------------------------------

  /** A text banner for the humans (or one of them), at most one per kind every few seconds. */
  callout(kind: string, text: string, to: PlayerState | null = null): void {
    const now = this.game.room.time;
    if (now - (this.calloutAt.get(kind) ?? -99) < ZOMBIES_ALLY.calloutEvery) return;
    this.calloutAt.set(kind, now);
    if (kind === 'revive') this.stats.revives++;
    this.game.event({ kind: 'callout', player: this.self.id, text }, to);
  }

  /** Revive radius (tests). */
  static readonly REVIVE_STAND = 1.0;
  static readonly REVIVE_RADIUS = ZOMBIES.reviveRadius;
}
