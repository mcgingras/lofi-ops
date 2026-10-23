/**
 * Blackout bot brain, with a level of detail by distance to the humans (BLACKOUT.lod):
 *
 *   near (within `nearDist` of a human, or of the player a dead human watches): every tick, the
 *     bots feature's perception and aim (aim.ts: reaction, spring, sway, recoil; sight.ts: what it
 *     can see and shoot through), hitscan through `room.fire` with the human rules, steering with
 *     probe rays around walls (jumping low ones), looting, healing, moving with the circle.
 *   far: re-plans every `farThinkSec` and steers with one probe ray per plan; no perception or
 *     hitscan. Fights between far bots are resolved by the game (`farFights`, statistical damage
 *     over time with one line-of-sight check per pair).
 *
 * The map is too big for the bots feature's nav grid (and 512 MB of server), so there is none:
 * open ground between towns is steered across, and a bot that gets stuck jumps, sidesteps and
 * finally picks another goal.
 *
 * Fairness: a bot only fights whom it sees (FOV + line of sight + noticing time), humans are not
 * preferred, and at most `MAX_ON_HUMAN` bots engage the same human at once unless shot by them.
 */
import { BLACKOUT, circleState, insideCircle, type Circle } from '../../../shared/defs/blackout';
import type { BotSkill } from '../../../shared/defs/bots';
import { PICKUP } from '../../../shared/defs/pickups';
import { Buttons, type InputCmd } from '../../../shared/input';
import { clamp, dist, viewDir, yawTo, type Vec3 } from '../../../shared/math';
import { eyeHeight } from '../../../shared/movement';
import { currentWeapon, type BotBrain, type PlayerState } from '../../player';
import type { Room } from '../../room';
import { addRecoil, angleDiff, engage, feltOffDeg, flinch, lookToward, newAimState, noticeTime, stepAim, toleranceDeg, type AimState } from '../bots/aim';
import { botCanHit, chestOf, headOf, visiblePart } from '../bots/sight';
import { dropsOf, swapBlocker, swapFor, type DropEntity } from '../pickups/index';
import { wants } from './loot';
import { blackoutGameOf } from './rules';
import { bx } from './state';
import type { LootItem } from '../../../shared/defs/blackout';
import type { BlackoutGame } from './game';

const DEG = Math.PI / 180;
/** Most bots fighting one human at once (others ignore them unless shot by them). */
export const MAX_ON_HUMAN = 3;
/** How far a bot looks for loot (m) and how long it gives a loot goal (s). */
const LOOT_RANGE = 45;

type Goal = { x: number; y: number; z: number; kind: 'loot' | 'circle' | 'roam' | 'camp'; until: number; ent?: number };

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
  private detour = 0;
  private detourUntil = 0;
  private stuckAt: Vec3 = { x: 0, y: 0, z: 0 };
  private stuckT = 0;
  private stuckCount = 0;
  private jumpHeld = false;
  private prev = 0;
  private slot = 0;
  private hurtBy: { id: string; t: number } | null = null;
  /** Camping late-game: holds its spot until then. */
  private campUntil = 0;
  readonly camper: boolean;
  /** Ticks of near / far thinking (for the benchmark and tests). */
  readonly stats = { near: 0, far: 0, shots: 0 };

  constructor(
    public skill: BotSkill,
    readonly rnd: () => number = Math.random,
  ) {
    this.camper = rnd() < 0.3;
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

    // Plan: re-think on a timer (far bots rarely), or when the goal is done.
    if (now >= this.nextThink || !this.goal || now > this.goal.until) {
      this.nextThink = now + (near ? 0.35 : BLACKOUT.lod.farThinkSec) * (0.8 + this.rnd() * 0.4);
      this.plan(room, game, self);
      this.loot(room, game, self);
    }
    this.pickSlot(self);

    // Heal when hurt and nobody in sight.
    let buttons = 0;
    if (!this.target && self.health < self.maxHealth * 0.6 && st.healUntil === null && (st.bandages > 0 || st.medkits > 0) && !(this.prev & Buttons.STREAK)) buttons |= Buttons.STREAK;

    if (near) {
      if (now >= this.nextPerceive) {
        this.nextPerceive = now + 0.05;
        this.perceive(room, game, self, skill, now);
      }
      if (this.target && (!this.target.alive || !room.players.has(this.target.id))) this.target = null;
      if (this.target) return this.out(self, buttons | this.fight(room, self, skill, dt, now));
    } else this.target = null;

    // ---- Move toward the goal.
    const g = this.goal;
    if (!g) return this.out(self, buttons);
    const dx = g.x - self.move.x;
    const dz = g.z - self.move.z;
    const d = Math.hypot(dx, dz);
    let yaw = Math.atan2(-dx, -dz);
    if (g.kind === 'camp' && d < 2) {
      lookToward(this.aim, skill, this.aim.yaw + Math.sin(now * 0.4) * 0.3 * dt, 0, dt, 0.3);
      return this.out(self, buttons | Buttons.CROUCH);
    }
    if (d < 0.8) return this.out(self, buttons);
    // Steering: around walls (probe rays), jumping low ones; detours stick for a moment.
    if (now < this.detourUntil) yaw += this.detour;
    else if (near || now >= this.nextThink - 0.01 || this.stuckT > 0.6) {
      const s = this.steer(room, self, yaw);
      if (s.turn) {
        this.detour = s.turn;
        this.detourUntil = now + 0.6;
        yaw += s.turn;
      }
      if (s.jump) buttons |= this.jumpPulse();
    }
    // Stuck: jump, then sidestep, then give up on the goal.
    const moved = Math.hypot(self.move.x - this.stuckAt.x, self.move.z - this.stuckAt.z);
    if (moved > 0.8) {
      this.stuckAt = { ...self.move };
      this.stuckT = 0;
      this.stuckCount = 0;
    } else {
      this.stuckT += dt;
      if (this.stuckT > 1.2) {
        this.stuckT = 0;
        this.stuckAt = { ...self.move };
        this.stuckCount++;
        buttons |= this.jumpPulse();
        this.detour = (this.rnd() < 0.5 ? -1 : 1) * (0.8 + this.rnd() * 1.2);
        this.detourUntil = now + 0.9;
        if (this.stuckCount >= 4) this.goal = null;
      }
    }
    if (near) lookToward(this.aim, skill, yaw, 0, dt, 0.7);
    else {
      this.aim.yaw = yaw;
      this.aim.pitch = 0;
    }
    const sprint = d > 10 && self.health > 30 && st.healUntil === null;
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
  // Planning
  // -------------------------------------------------------------------------------------------

  private plan(room: Room, game: BlackoutGame, self: PlayerState): void {
    const now = room.time;
    const c = game.circle();
    if (!c) return;
    const p = self.move;
    // The circle first: outside it (or the next one when it is about to move), go in.
    const target: Circle | null = c.next && (c.stage === 'shrink' || (c.endsAt !== null && c.endsAt - (now - (game.t0 ?? now)) < 25 + Math.hypot(p.x - c.next.x, p.z - c.next.z) / 5)) ? c.next : c.cur;
    const outside = !insideCircle({ ...target, r: Math.max(0, target.r - 4) }, p.x, p.z);
    if (outside) {
      if (this.goal?.kind !== 'circle' || !insideCircle(target, this.goal.x, this.goal.z)) {
        const a = Math.atan2(p.z - target.z, p.x - target.x) + (this.rnd() - 0.5) * 0.8;
        const r = target.r * (0.2 + this.rnd() * 0.5);
        this.goal = { x: target.x + Math.cos(a) * r, y: 0, z: target.z + Math.sin(a) * r, kind: 'circle', until: now + 30 };
      }
      return;
    }
    // Late game: some bots hold a spot inside the circle for a while.
    if (this.camper && c.phase >= 4 && now >= this.campUntil && this.goal?.kind !== 'camp' && this.rnd() < 0.4) {
      this.goal = { x: p.x, y: p.y, z: p.z, kind: 'camp', until: now + 15 + this.rnd() * 20 };
      this.campUntil = this.goal.until + 20;
      return;
    }
    if (this.goal && this.goal.kind !== 'roam' && now < this.goal.until) return;
    // Loot nearby.
    const loot = this.findLoot(room, game, self);
    if (loot) {
      this.goal = { x: loot.x, y: loot.y, z: loot.z, kind: 'loot', until: now + 12, ent: loot.id };
      game.lootClaims.set(loot.id, self.id);
      return;
    }
    if (this.goal?.kind === 'roam' && now < this.goal.until && Math.hypot(this.goal.x - p.x, this.goal.z - p.z) > 2) return;
    // Roam: somewhere inside the safe zone, towards towns (hotspots) more often than not.
    const spots = (room.map.hotspots ?? []).filter((h) => insideCircle({ ...target, r: target.r * 0.9 }, h.x, h.z) && Math.hypot(h.x - p.x, h.z - p.z) < 160);
    let gx: number;
    let gz: number;
    if (spots.length && this.rnd() < 0.7) {
      const h = spots[Math.floor(this.rnd() * spots.length)]!;
      gx = h.x + (this.rnd() - 0.5) * 8;
      gz = h.z + (this.rnd() - 0.5) * 8;
    } else {
      const a = this.rnd() * Math.PI * 2;
      const r = Math.sqrt(this.rnd()) * target.r * 0.85;
      gx = target.x + Math.cos(a) * r;
      gz = target.z + Math.sin(a) * r;
      // Don't walk off across the whole map: a step towards it.
      const d = Math.hypot(gx - p.x, gz - p.z);
      if (d > 80) {
        gx = p.x + ((gx - p.x) / d) * 80;
        gz = p.z + ((gz - p.z) / d) * 80;
      }
    }
    this.goal = { x: gx, y: 0, z: gz, kind: 'roam', until: now + 25 };
  }

  /** The best loot in range: guns while it has an empty slot (or better ones), items it can use. */
  private findLoot(room: Room, game: BlackoutGame, self: PlayerState): { x: number; y: number; z: number; id: number } | null {
    const p = self.move;
    let best: { x: number; y: number; z: number; id: number } | null = null;
    let bestScore = Infinity;
    const needGun = self.weapons.some((w) => w.def.base.id === 'knife');
    for (const e of game.lootNear(p.x, p.z, LOOT_RANGE)) {
      if (Math.abs(e.y - p.y) > 6) continue;
      const claim = game.lootClaims.get(e.id);
      if (claim && claim !== self.id && room.players.get(claim)?.alive) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      let score = Infinity;
      if (e.kind === 'pickups_weapon') {
        const drop = e as DropEntity;
        if (!drop.data?.landed || self.weapons.some((w) => w.def.base.id === drop.data.weapon)) continue;
        const gain = gunValue(drop.data.weapon, drop.data.attachments.length) - Math.min(...self.weapons.slice(0, 2).map((w) => gunValue(w.def.base.id, w.def.attachmentIds.length, w.mag + w.reserve)));
        if (gain <= 0.5) continue;
        score = d - gain * (needGun ? 12 : 4);
      } else {
        const it = (e.data as { item: LootItem } | undefined)?.item;
        if (!it || !wants(self, it)) continue;
        score = d + (needGun ? 15 : 0) - (it.k === 'armor' ? 6 : 0);
      }
      if (score < bestScore) {
        bestScore = score;
        best = { x: e.x, y: e.y, z: e.z, id: e.id };
      }
    }
    return best;
  }

  /** In reach of a gun worth taking: swap for it (bots "hold USE" instantly). */
  private loot(room: Room, game: BlackoutGame, self: PlayerState): void {
    if (!this.goal || this.goal.kind !== 'loot' || this.goal.ent === undefined) return;
    const e = room.entities.get(this.goal.ent);
    if (!e) {
      this.goal = null;
      return;
    }
    if (e.kind !== 'pickups_weapon') return;
    if (Math.hypot(e.x - self.move.x, e.z - self.move.z) > PICKUP.radius * 0.9) return;
    const drop = dropsOf(room).find((d) => d.id === e.id);
    if (!drop) return;
    const slot = game.pickupSlot(self) === self.slot && self.weapons[self.slot]?.def.base.id !== 'knife' ? worstSlot(self) : game.pickupSlot(self);
    if (swapBlocker(room, self, drop, { slot }) === null) {
      swapFor(room, self, drop, slot);
      this.slot = slot;
      game.lootChanged();
    }
    this.goal = null;
  }

  // -------------------------------------------------------------------------------------------
  // Steering
  // -------------------------------------------------------------------------------------------

  /** Probe ahead along `yaw` at knee and chest height; turn toward the nearest free direction. */
  private steer(room: Room, self: PlayerState, yaw: number): { turn: number; jump: boolean } {
    const free = (a: number, y: number, len: number) => {
      const d = viewDir(yaw + a, 0);
      return room.world.raycast({ x: self.move.x, y: self.move.y + y, z: self.move.z }, d, len, 'players') === null;
    };
    if (free(0, 0.6, 2.2)) return { turn: 0, jump: false };
    // Knee blocked, chest free: something low to jump or climb.
    if (free(0, 1.45, 2.2)) return { turn: 0, jump: true };
    for (const a of [0.6, -0.6, 1.2, -1.2, 1.9, -1.9, 2.6, -2.6]) if (free(a, 0.6, 2.5) && free(a, 1.45, 2.5)) return { turn: a, jump: false };
    return { turn: Math.PI, jump: false };
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

/** Debug/tests: where the circle sends a bot standing at `p` now. */
export function circleGoal(game: BlackoutGame, p: Vec3): Circle | null {
  const c = game.t0 === null ? null : circleState(game.circles, game.room.time - game.t0);
  return c?.next ?? c?.cur ?? null;
}
