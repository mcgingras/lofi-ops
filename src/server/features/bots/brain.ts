/**
 * A bot's brain (`player.brain`, CONTRACTS section 4). Every tick it returns the same input a
 * person's client would send (buttons, yaw, pitch, weapon slot), so bots move by the shared
 * movement code and fire through `room.fire` with all the human rules (rate, ammo, sprint-out,
 * spread). Everything it does is scaled by its BotSkill.
 *
 *   perceive (20 Hz)  enemies inside its FOV with line of sight (chest or eyes over cover; sight.ts:
 *                     collision plus drawn geometry), noticed after a time that grows with
 *                     distance and peripheral angle; someone right next to it; gunfire and
 *                     footsteps it hears; the direction it was shot from; enemies a UAV puts on its
 *                     radar (the radarVisible modifier). Hearing and radar only turn or steer it.
 *   target            re-checked every tick: out of view it stops firing at once, aims at the last
 *                     point it saw, and lets go after LOST_GRACE. It fires only with a line of fire
 *                     (a bullet from its eye would reach the aim point), each shot traced first.
 *   fight             the aim controller (aim.ts: reaction, spring acquisition, sway, flinch),
 *                     head/chest, bursts and recoil by burstControl, ADS by range, strafing and
 *                     crouch spam by `strafe`, holding its weapon's range, switching to the pistol
 *                     when dry up close, knifing when touching, backing off to cover to reload or
 *                     heal (less aggressive bots), wager rules (one bullet: only steady shots).
 *   after a fight     chase or flank where the target was last seen (aggression) or hold the angle,
 *                     flush them out with a lethal if it carries one, top up the magazine.
 *   roam              objective goals from modes (registerBotGoal, weighted by objectivePlay),
 *                     noises it heard, radar contacts, else spawn-aware roaming: toward recent
 *                     fights and the enemy half, away from its own spawn, never camping theirs.
 *                     Paths come from the nav grid (A*, string pulled), sprinting between cover,
 *                     jumping onto ledges, unsticking itself when blocked.
 *   streaks           presses STREAK (or the registered handler) after earning one, promptly
 *                     in proportion to `streakUse`.
 *
 * Behaviour skeleton adapted from Blockyard's shooter bots (src/platform/kits/shooterbot.ts, MIT,
 * Patrick Blais): react-then-settle aim, bursts, strafe timers, chase heard/seen, stuck handling.
 */
import { PLAYER, type Team } from '../../../shared/constants';
import type { BotSkill } from '../../../shared/defs/bots';
import { KILLSTREAK_BY_ID } from '../../../shared/defs/killstreaks';
import type { WeaponClass } from '../../../shared/defs/weapons';
import { Buttons, type InputCmd } from '../../../shared/input';
import { clamp, dist, viewDir, yawTo, type Vec3 } from '../../../shared/math';
import { eyeHeight } from '../../../shared/movement';
import { traceShot } from '../../combat';
import { currentWeapon, type BotBrain, type PlayerState } from '../../player';
import type { Room } from '../../room';
import { addRecoil, angleDiff, engage, feltOffDeg, flinch, lookToward, newAimState, noticeTime, stepAim, toleranceDeg, type AimState } from './aim';
import { botGoalFor, botStreakHandler, botStyleFor, type BotGoal } from './hooks';
import { navFor, type NavCell, type NavGrid } from './nav';
import { recentSpawns } from '../modes/spawns';
import { hasObjectives } from '../modes/bots';
import { chasersNear, crowdPenalty, depthOf, laneOf, mapAxis, pickLane, rollRole, type BotRole, type GoalClaim, type PathUsage } from './roles';
import { botCanHit, chestOf, eyePointOf, headOf, occludersFor, visiblePart } from './sight';

const DEG = Math.PI / 180;

/** Room-wide knowledge the brains share (kept by the room controller). */
export interface BrainWorld {
  /** Recent gunfire positions (room time), for roaming toward the action. */
  fights: { x: number; y: number; z: number; t: number; by?: string; team?: Team | null }[];
  /** Where each bot is heading (by player id), so teammates spread out. */
  claims?: Map<string, GoalClaim>;
  /** Teammates' paths (A* adds cost on them). */
  usage?: PathUsage | null;
  /** Path searches and cells expanded this tick, across the room's bots (`tick` is room.tick). */
  nav?: { tick: number; used: number; expanded?: number };
}

/**
 * After losing sight of its target the bot holds its aim on the last point it saw (no firing) for
 * this long, then lets the target go. Seen again within it, the fight just carries on.
 */
export const LOST_GRACE = 0.25;

/** Path searches per room tick, and cells they may expand in total; more wait for a later tick. */
export const NAV_SEARCHES_PER_TICK = 3;
export const NAV_EXPAND_PER_TICK = 24000;

/** How each weapon class is fought: preferred range (m), ADS beyond (m; Infinity = never). */
const CLASS_STYLE: Record<WeaponClass, { range: number; ads: number; rush?: boolean }> = {
  ar: { range: 18, ads: 7 },
  smg: { range: 9, ads: 10, rush: true },
  lmg: { range: 22, ads: 8 },
  sniper: { range: 32, ads: 3 },
  shotgun: { range: 4, ads: Infinity, rush: true },
  pistol: { range: 9, ads: 8 },
  launcher: { range: 18, ads: 6 },
  special: { range: 6, ads: Infinity, rush: true },
};

type Goal = { at: Vec3; radius: number; hold: boolean; holdButtons: number; sprint: boolean; kind: 'objective' | 'heard' | 'radar' | 'chase' | 'flank' | 'roam' | 'cover' | 'forced'; until: number; then?: Goal; linger?: number };

export { chestOf, headOf } from './sight';
export const eyeOf = (p: PlayerState): Vec3 => ({ x: p.move.x, y: p.move.y + eyeHeight(p.move), z: p.move.z });

export class Brain implements BotBrain {
  skill: BotSkill;
  readonly aim: AimState = newAimState();
  target: PlayerState | null = null;
  /** What it can see of the target. */
  seen: 'body' | 'head' = 'body';
  /** Where on the body it aims this engagement (metres off the chest: across, up). */
  private aimOff = { side: 0, up: 0 };
  /** Noticing progress per enemy id (0..1; 1 = noticed, it can engage). */
  private notice = new Map<string, number>();
  private noticeAt = -1;
  lastSeen: { at: Vec3; t: number; id: string } | null = null;
  /** The point it last aimed at on the target while it could see it (held while it can't). */
  private lastAim: Vec3 | null = null;
  /** Shots it held back because a pellet would have gone through drawn cover (tests). */
  heldShots = 0;
  heard: { at: Vec3; t: number } | null = null;
  hurt: { at: Vec3; t: number; by: string | null } | null = null;
  radar: { at: Vec3; t: number } | null = null;

  path: NavCell[] | null = null;
  pathIdx = 0;
  goal: Goal | null = null;
  private replanAt = 0;
  /** Forced goal (tests, scripted behaviour): overrides everything when no enemy is in sight. */
  forced: BotGoal | null = null;
  /** Objective intent: re-rolled now and then so weaker bots still drift off to hunt. */
  private objectiveIntent = false;
  private intentAt = -1;

  private strafeDir = 0;
  private strafeUntil = 0;
  private crouchUntil = 0;
  /** Lying down to hold a long sightline (snipers, while standing still) until then. */
  private proneUntil = 0;
  private burstLeft = 0;
  private pauseUntil = 0;
  private nextShotAt = 0;
  private nextMeleeAt = 0;
  private prevButtons = 0;
  private stuckAt: Vec3 = { x: 0, y: 0, z: 0 };
  private stuckT = 0;
  private jumpHeld = false;
  private grenadeAt = 0;
  private throwing: { at: Vec3; t: number } | null = null;
  /** A lethal lobbed mid-fight (`throwAtRange`): the view is pitched up by `lobPitch` until then. */
  private lobUntil = 0;
  private lobPitch = 0;
  private lobAt = 0;
  private pitchBias = 0;
  private streakPress: { id: string; at: number } | null = null;
  private retreatUntil = 0;
  private holdUntil = 0;
  private slotWanted = 0;
  /** Sprint the long stretches of the current plan (rolled per plan by aggression). */
  private sprintPlan = false;
  private lingerUntil = 0;
  private lastPerceive = -1;
  private stagger: number;
  /** Shots fired / hits (for tests and tuning). */
  readonly stats = { shots: 0, engagements: 0 };
  /** This life's role and lane (roles.ts). */
  role: BotRole = 'lane';
  lane: 0 | 1 | 2 = 1;
  private id = '';
  private team: Team | null = null;
  /** A goal waiting for a path search (the room's search budget for this tick was spent). */
  private pathPending = false;

  constructor(
    skill: BotSkill,
    readonly world: BrainWorld,
    readonly rnd: () => number = Math.random,
  ) {
    this.skill = { ...skill };
    this.stagger = Math.floor(rnd() * 3);
  }

  /** A fresh life: forget the fight, face where it spawned, roll a role and a lane. */
  onSpawn(self: PlayerState, now: number, room?: Room): void {
    this.id = self.id;
    this.team = self.team;
    if (room) this.assignRole(room, self);
    this.pathPending = false;
    this.target = null;
    this.path = null;
    this.goal = null;
    this.lastSeen = null;
    this.lastAim = null;
    this.heard = null;
    this.hurt = null;
    this.radar = null;
    this.replanAt = 0;
    this.aim.yaw = self.yaw;
    this.aim.pitch = 0;
    this.aim.vYaw = 0;
    this.aim.vPitch = 0;
    this.aim.recoil = 0;
    this.aim.recoilYaw = 0;
    this.notice.clear();
    this.burstLeft = 0;
    this.pauseUntil = 0;
    this.slotWanted = 0;
    this.retreatUntil = 0;
    this.throwing = null;
    this.stuckAt = { ...self.move };
    this.stuckT = 0;
    this.intentAt = -1;
    this.lingerUntil = 0;
    this.grenadeAt = now + 4;
    this.lobAt = now + 0.5;
    this.lobUntil = 0;
  }

  /** Roll this life's role; take the lane fewest teammates hold (or pair up with one). */
  assignRole(room: Room, self: PlayerState): void {
    this.role = rollRole(this.skill, hasObjectives(room), this.rnd);
    const counts: [number, number, number] = [0, 0, 0];
    const claims = this.world.claims;
    if (claims) {
      for (const [id, c] of claims) if (id !== self.id && c.team === self.team && self.team !== null && room.players.get(id)?.alive) counts[c.lane]++;
      claims.set(self.id, { team: self.team, at: { ...self.move }, kind: 'spawn', role: this.role, lane: 1, t: room.time });
    }
    this.lane = pickLane(this.role, counts, this.rnd);
    const c = claims?.get(self.id);
    if (c) c.lane = this.lane;
  }

  onHeard(at: Vec3, now: number): void {
    if (!this.heard || now - this.heard.t > 2) this.lingerUntil = 0;
    this.heard = { at: { ...at }, t: now };
  }

  /**
   * Took damage: flinch (`flinchDeg`, from the flinchMultiplier modifier), and know roughly where
   * it came from (the damage indicator): it turns that way, but still has to see the shooter.
   */
  onHurt(by: PlayerState | null, now: number, flinchDeg = 0): void {
    this.lingerUntil = 0;
    this.hurt = { at: by ? { ...by.move } : { x: 0, y: 0, z: 0 }, t: now, by: by?.id ?? null };
    if (by && !this.target) this.heard = { at: { ...by.move }, t: now };
    flinch(this.aim, flinchDeg, this.rnd);
  }

  /** Earned a streak (kills in a row reached `id`'s cost): plan to use it. */
  onStreakEarned(id: string, now: number): void {
    const u = this.skill.streakUse;
    if (this.rnd() > 0.3 + 0.7 * u) return;
    this.streakPress = { id, at: now + (1 - u) * 9 + 1 + this.rnd() * 2 };
  }

  // -------------------------------------------------------------------------------------------

  think(room: Room, self: PlayerState, dt: number): Omit<InputCmd, 'seq' | 'dt'> | null {
    if (!self.alive) {
      this.prevButtons = 0;
      return null;
    }
    const now = room.time;
    const nav = navFor(room.map);
    const sk = this.skill;
    const style = botStyleFor(room, self);
    let buttons = 0;
    let mx = 0;
    let mz = 0;
    let sprint = false;
    let jump = false;
    let crouch = false;
    const pulse = (b: number) => {
      if (!(this.prevButtons & b)) buttons |= b;
    };
    this.pitchBias = now < this.lobUntil ? this.lobPitch : 0;

    if (room.phase !== 'playing') {
      // Countdown: look around a little, frozen.
      lookToward(this.aim, this.skill, self.yaw + Math.sin(now * 0.7 + this.stagger) * 0.4, 0, dt, 0.4);
      return this.out(self, 0);
    }

    // ---- Perceive (20 Hz, staggered across bots).
    if (room.tick % 3 === this.stagger || this.lastPerceive < 0) {
      this.lastPerceive = now;
      this.perceive(room, self, now);
    }
    if (this.target && (!this.target.alive || !room.players.has(this.target.id))) this.target = null;
    const eye = eyeOf(self);

    // Sight of the target, every tick. Seen: aim at it where it is now. Not seen: stop firing at
    // once, hold the aim on the last point it saw, and let the target go after LOST_GRACE.
    let vis: 'body' | 'head' | null = null;
    if (this.target) {
      const t = this.target;
      vis = visiblePart(room.world, room.map, eye, t);
      if (vis) {
        this.seen = vis;
        this.lastSeen = { at: { ...t.move }, t: now, id: t.id };
        this.lastAim = this.aimPoint(eye, t);
      } else if (!this.lastSeen || this.lastSeen.id !== t.id || now - this.lastSeen.t >= LOST_GRACE) this.target = null;
    }

    const w = currentWeapon(self);
    const def = w?.def;
    const cls = CLASS_STYLE[def?.class ?? 'ar'] ?? CLASS_STYLE.ar;
    const primary = self.weapons[0];
    const secondary = self.weapons[1];

    if (this.target) {
      // ================================ FIGHT ================================
      const t = this.target;
      // Where it can't see the target it works from the last sighting, never the live position.
      const aimPt = vis || !this.lastAim ? this.aimPoint(eye, t) : this.lastAim;
      const tpos: Vec3 = vis || !this.lastSeen ? t.move : this.lastSeen.at;
      const d = dist(eye, aimPt);
      const trueYaw = yawTo(eye, aimPt);
      const truePitch = Math.atan2(aimPt.y - eye.y, Math.hypot(aimPt.x - eye.x, aimPt.z - eye.z));
      // Situation: distance, the target's speed across the line of sight, own movement, ADS.
      const lx = eye.x - aimPt.x;
      const lz = eye.z - aimPt.z;
      const ll = Math.hypot(lx, lz) || 1;
      const latSpeed = vis ? Math.abs((t.move.vx * -lz + t.move.vz * lx) / ll) : 0;
      const ctx = { dist: d, latSpeed, moving: Math.hypot(self.move.vx, self.move.vz) > 0.5, ads: self.move.ads };
      const intended = stepAim(this.aim, sk, trueYaw, truePitch, dt, ctx, def?.recoil.recovery ?? 10);

      // Weapon: dry up close -> sidearm (quicker than a reload); empty everything -> sidearm.
      if (w && w.mag === 0 && this.slotWanted === 0 && secondary && secondary.mag > 0 && (d < 12 || (primary?.reserve ?? 0) === 0)) this.slotWanted = 1;
      if (this.slotWanted === 1 && secondary && secondary.mag === 0 && secondary.reserve === 0 && primary && primary.mag + primary.reserve > 0) this.slotWanted = 0;

      const wantAds = !!def && d > cls.ads && !(cls.rush && style.rush && d < 8);
      if (wantAds) buttons |= Buttons.ADS;
      const ready = !!w && w.mag > 0 && self.reloadEnd === 0 && now >= self.swapEnd && !self.move.sprinting && self.slot === this.slotWanted;
      const tight = style.conserveAmmo ? 0.55 : 1;
      const onTarget = this.aim.react <= 0 && feltOffDeg(this.aim, sk, intended.yaw, intended.pitch) < toleranceDeg(d, tight);
      const steadyOk = !style.conserveAmmo || (this.aim.track > 0.25 && (!wantAds || self.move.ads > 0.85));
      // Line of fire: it sees the target now and a bullet from its eye would reach the point it
      // aims at (collision's bullets mask and drawn bullet-stopping geometry). No firing at walls,
      // at a last-known position, or through bullet-proof glass.
      const lineOfFire = !!vis && botCanHit(room.world, room.map, eye, aimPt);

      if (ready && onTarget && steadyOk && lineOfFire && def) {
        const auto = def.mode === 'auto' || def.mode === 'burst';
        if (auto) {
          if (now >= this.pauseUntil) {
            if (this.burstLeft <= 0) {
              const bc = sk.burstControl;
              this.burstLeft = def.mode === 'burst' ? (def.burst ?? 3) : d > 14 ? Math.round(9 - 6 * bc) : d > 7 ? Math.round(14 - 6 * bc) : 30;
            }
            const res = this.shoot(room, self, eye);
            if (res?.ok) {
              this.stats.shots++;
              this.burstLeft--;
              addRecoil(this.aim, def.recoil, self.move.ads, this.rnd);
              if (this.burstLeft <= 0) this.pauseUntil = now + (def.mode === 'burst' ? 0.25 : 0.08 + 0.3 * sk.burstControl * (d > 10 ? 1 : 0.3)) + this.rnd() * 0.1;
            }
            buttons |= Buttons.FIRE;
          }
        } else if (now >= this.nextShotAt) {
          const res = this.shoot(room, self, eye);
          if (res?.ok) {
            this.stats.shots++;
            addRecoil(this.aim, def.recoil, self.move.ads, this.rnd);
            const interval = 60 / Math.max(30, def.rpm);
            const pace = def.mode === 'semi' ? 1.25 + (1 - sk.burstControl) * 0.6 : 1.05;
            this.nextShotAt = now + interval * pace + this.rnd() * 0.08;
            buttons |= Buttons.FIRE;
          }
        }
      } else if (now >= this.pauseUntil && this.burstLeft > 0 && !onTarget) {
        // Lost the line mid-burst: re-aim, a short pause.
        this.burstLeft = 0;
        this.pauseUntil = now + 0.1;
      }

      // Knife when touching (or when a melee-happy wager mode has us close and dry).
      const outOfAmmo = !!w && w.mag === 0 && w.reserve === 0;
      if (vis && (d < 1.7 || (style.meleeHappy && outOfAmmo && d < 2.2)) && now >= this.nextMeleeAt) {
        pulse(Buttons.MELEE);
        this.nextMeleeAt = now + 0.75;
      }

      // A tomahawk left (Infected): lob it at a target in sight at mid range. The throw leaves
      // along the view when the wind-up ends, so the view stays pitched up until then.
      if (style.throwAtRange && vis && d > 6 && d < 18 && now >= this.lobAt && this.aim.react <= 0 && (self.ext.weapons?.lethalN ?? 0) > 0) {
        if (this.rnd() < 0.5) {
          // Judging the arc by eye: off by up to ~half the bot's aim error either way.
          const t = d / 22;
          this.lobPitch = clamp(Math.atan2(7.5 * t * t, d) - 0.1 + (this.rnd() - 0.5) * sk.aimErrorDeg * DEG * 0.8, 0, 0.5);
          this.lobUntil = now + 0.5;
          this.lobAt = now + 5 + this.rnd() * 3;
          pulse(Buttons.LETHAL);
        } else this.lobAt = now + 1.5; // not every chance: half the time it just keeps running in
      }

      // Reload with nothing in the mag and no sidearm worth swapping to.
      if (w && w.mag === 0 && w.reserve > 0 && self.reloadEnd === 0 && this.slotWanted === self.slot) pulse(Buttons.RELOAD);

      // ---- Movement in a fight.
      const tx = tpos.x - self.move.x;
      const tz = tpos.z - self.move.z;
      const td = Math.hypot(tx, tz) || 1;
      const ux = tx / td;
      const uz = tz / td;
      const lowHealth = self.health < self.maxHealth * 0.35;
      const dry = !!w && w.mag === 0 && (this.slotWanted === self.slot || !secondary || secondary.mag === 0);
      // A melee-happy bot with nothing to shoot (knife only) goes in instead of backing off to reload.
      const knifeOnly = style.meleeHappy && outOfAmmo;
      if (((lowHealth && (sk.aggression < 0.75 || td > 10) && !knifeOnly) || (dry && td > 6 && !knifeOnly)) && now >= this.retreatUntil && this.goal?.kind !== 'cover') {
        // Back off to cover (reload / heal behind it); not more often than every few seconds.
        const cover = findCover(room, nav, self, { x: tpos.x, y: tpos.y + PLAYER.eye, z: tpos.z }, this.rnd);
        if (cover) this.setGoal(nav, self, { at: { x: cover.x, y: cover.y, z: cover.z }, radius: 0.6, hold: false, holdButtons: 0, sprint: true, kind: 'cover', until: now + 3.5 });
        this.retreatUntil = now + 6;
      }
      if (this.goal?.kind === 'cover' && now < this.goal.until && this.path) {
        const step = this.follow(nav, self);
        mx = step.x;
        mz = step.z;
        jump = step.jump;
      } else {
        if (this.goal?.kind === 'cover') this.goal = null;
        const meleeRush = style.meleeHappy && outOfAmmo;
        const range = meleeRush ? 0.8 : (style.rush && cls.rush ? cls.range * 0.6 : cls.range) * (1.15 - sk.aggression * 0.3);
        const close = td > range * 1.3 ? 1 : td < range * 0.5 ? -1 : 0;
        if (now >= this.strafeUntil) {
          const s = sk.strafe;
          this.strafeDir = this.rnd() < 0.25 + 0.7 * s ? (this.rnd() < 0.5 ? -1 : 1) : 0;
          this.strafeUntil = now + 0.25 + this.rnd() * (1.3 - s * 0.8);
          if (this.rnd() < s * 0.45 && td > 3) this.crouchUntil = now + 0.25 + this.rnd() * 0.5;
          if (this.rnd() < s * 0.06 && td > 4) jump = true;
        }
        // Low-aggression bots with the upper hand hold still to shoot; others keep closing.
        // Kiting (Infected's Survivors): never close in, back away from anyone inside 4 m.
        const approach = style.kite ? (td < 4 ? -1 : 0) : close > 0 && (sk.aggression > 0.35 || td > range * 2) ? 1 : close < 0 ? -1 : 0;
        mx = ux * approach + -uz * this.strafeDir;
        mz = uz * approach + ux * this.strafeDir;
        if (now < this.crouchUntil) {
          crouch = true;
          mx *= 0.5;
          mz *= 0.5;
        }
        // Don't strafe off a ledge or into a wall: keep strafes on walkable ground.
        if (!walkableDir(nav, self, mx, mz)) {
          this.strafeDir = -this.strafeDir;
          mx = ux * approach;
          mz = uz * approach;
        }
        if (meleeRush && td > 3) sprint = true;
      }
    } else {
      // ================================ NO TARGET ================================
      this.aim.react = 0;
      this.burstLeft = 0;
      // Back to the primary when the sidearm was only a stopgap.
      if (this.slotWanted === 1 && primary && primary.mag + primary.reserve > 0 && (!this.lastSeen || now - this.lastSeen.t > 1.5)) this.slotWanted = 0;
      // Top up between fights.
      if (w && w.mag < w.def.magazine * 0.5 && w.reserve > 0 && self.reloadEnd === 0 && (!this.lastSeen || now - this.lastSeen.t > 1.2)) pulse(Buttons.RELOAD);

      this.considerGrenade(room, self, now);
      this.considerStreak(room, self, now, (b) => pulse(b));

      if (this.throwing) {
        const th = this.throwing;
        const flat = Math.hypot(th.at.x - eye.x, th.at.z - eye.z);
        lookToward(this.aim, sk, yawTo(eye, th.at), clamp(0.22 + flat * 0.011, 0.2, 0.62), dt);
        if (now >= th.t) {
          pulse(Buttons.LETHAL);
          this.throwing = null;
        }
        return this.out(self, buttons);
      }

      const goal = this.chooseGoal(room, nav, self, now);
      let looked = false;
      // Plant / defuse style goals (hold a button inside the radius): stand still and keep holding.
      // Shuffling would release the button and, with the S&D movement freeze, never finish.
      const holdingUse = !!goal && goal.hold && goal.holdButtons !== 0 && Math.hypot(self.move.x - goal.at.x, self.move.z - goal.at.z) <= goal.radius * 0.85 && Math.abs(self.move.y - goal.at.y) < 2;
      if (goal && holdingUse) {
        buttons |= goal.holdButtons;
        this.path = null;
        this.stuckAt = { ...self.move };
      } else if (goal && this.path) {
        const step = this.follow(nav, self);
        const arrived = step.done;
        if (!arrived) {
          mx = step.x;
          mz = step.z;
          jump = step.jump;
          const remaining = this.remaining(self);
          const recentlyHot = (this.lastSeen && now - this.lastSeen.t < 3) || (this.hurt && now - this.hurt.t < 2);
          // Near where enemies were just fighting or heard: slow down (ADS walk), check that way.
          const danger = goal.kind === 'objective' && goal.sprint ? null : this.dangerNear(self, now);
          sprint = (goal.sprint || (remaining > 10 && this.sprintPlan)) && !recentlyHot && remaining > 3.5 && !danger;
          // Look where it's going (a little ahead), glancing about; toward a noise if recent.
          const look = step.look;
          let wantYaw = yawTo(eye, look) + Math.sin(now * 0.9 + this.stagger * 2) * 0.28;
          if (danger) {
            wantYaw = yawTo(eye, danger);
            if (Math.abs(angleDiff(wantYaw, yawTo(eye, look))) < 1.6) buttons |= Buttons.ADS;
            else wantYaw = yawTo(eye, look) + clamp(angleDiff(wantYaw, yawTo(eye, look)), -0.9, 0.9);
          }
          if (this.heard && now - this.heard.t < 1.5 && !sprint) wantYaw = yawTo(eye, this.heard.at);
          lookToward(this.aim, sk, wantYaw, -0.05, dt, 0.7);
          looked = true;
        } else if (goal.hold) {
          // Holding an objective: shuffle inside the radius, crouch now and then, watch.
          buttons |= goal.holdButtons;
          if (now >= this.holdUntil) {
            this.holdUntil = now + 1.5 + this.rnd() * 2.5;
            this.crouchUntil = this.rnd() < 0.35 ? this.holdUntil : 0;
            // A sniper holding a spot sometimes lies down to watch its lane (BO1 campers did).
            const lie = currentWeapon(self)?.def.class === 'sniper' && this.rnd() < 0.3;
            if (lie) this.proneUntil = this.holdUntil + 0.5;
            const a = this.rnd() * Math.PI * 2;
            const r = this.rnd() * goal.radius * 0.7;
            this.strafeDir = 0;
            this.stuckAt = { ...self.move };
            const spot = { x: goal.at.x + Math.cos(a) * r, y: goal.at.y, z: goal.at.z + Math.sin(a) * r };
            const p = lie ? null : nav.path(self.move, spot);
            if (lie) this.path = null;
            if (p) {
              this.path = p;
              this.pathIdx = 0;
            }
          }
          if (now < this.crouchUntil) crouch = true;
        } else {
          this.goal = null;
          this.path = null;
        }
      }
      if (!looked) {
        // Standing: face a noise, or sweep toward where enemies come from.
        let wantYaw = this.aim.yaw + Math.sin(now * 0.6 + this.stagger) * 0.6 * dt * 3;
        if (this.heard && now - this.heard.t < 3) wantYaw = yawTo(eye, this.heard.at);
        else if (this.lastSeen && now - this.lastSeen.t < 4) wantYaw = yawTo(eye, this.lastSeen.at);
        lookToward(this.aim, sk, wantYaw, 0, dt, 0.5);
        if (this.lastSeen && now - this.lastSeen.t < 4) buttons |= Buttons.ADS;
      }
    }

    // ---- Stuck against something: jump; still stuck, plan again somewhere else.
    const moving = Math.hypot(mx, mz) > 0.2;
    if (moving) {
      this.stuckT += dt;
      if (this.stuckT > 0.6) {
        const moved = Math.hypot(self.move.x - this.stuckAt.x, self.move.z - this.stuckAt.z);
        if (moved < 0.3) {
          jump = true;
          if (this.stuckT > 1.6) {
            this.path = null;
            if (this.goal && this.goal.kind !== 'forced' && this.goal.kind !== 'objective') this.goal = null;
            this.replanAt = 0;
            this.strafeDir = -this.strafeDir;
            this.stuckT = 0;
            this.stuckAt = { ...self.move };
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

    // ---- Keys relative to the view.
    const yaw = this.aim.yaw;
    const f = -Math.sin(yaw) * mx - Math.cos(yaw) * mz;
    const r = Math.cos(yaw) * mx - Math.sin(yaw) * mz;
    if (f > 0.38) buttons |= Buttons.FORWARD;
    if (f < -0.38) buttons |= Buttons.BACK;
    if (r > 0.38) buttons |= Buttons.RIGHT;
    if (r < -0.38) buttons |= Buttons.LEFT;
    if (sprint && f > 0.5 && !(buttons & Buttons.ADS) && !crouch) buttons |= Buttons.SPRINT;
    // Prone only while it stays put (it stands to move or to jump): it keeps shooting lying down.
    if (now < this.proneUntil && !moving && !jump) buttons = (buttons & ~(Buttons.SPRINT | Buttons.CROUCH)) | Buttons.PRONE;
    else if (crouch) buttons |= Buttons.CROUCH;
    // Jump needs a fresh press: release for a tick after each one.
    if (jump && !this.jumpHeld && self.move.onGround) {
      buttons |= Buttons.JUMP;
      this.jumpHeld = true;
    } else this.jumpHeld = false;
    return this.out(self, buttons);
  }

  private out(self: PlayerState, buttons: number): Omit<InputCmd, 'seq' | 'dt'> {
    this.prevButtons = buttons;
    const slot = this.slotWanted < self.weapons.length ? this.slotWanted : 0;
    return { buttons, yaw: this.aim.yaw, pitch: clamp(this.aim.pitch + this.pitchBias, -1.4, 1.4), weaponSlot: slot };
  }

  /**
   * Pull the trigger along the current view. The exact shot (its spread seed) is traced first:
   * if any pellet would hit someone through drawn geometry that looks bullet-proof (a render-only
   * truck, a crate drawn bigger than its collision), the shot is held. Null when held.
   */
  private shoot(room: Room, self: PlayerState, eye: Vec3) {
    const dir = viewDir(this.aim.yaw, this.aim.pitch);
    // A fresh spread seed per pull, drawn like room.fire's default.
    const shot = Math.floor(Math.random() * 1e9);
    const occ = occludersFor(room.map);
    for (const pel of traceShot(room, self, eye, dir, shot)) {
      if (!pel.victim) continue;
      const at = { x: eye.x + pel.dir.x * pel.t, y: eye.y + pel.dir.y * pel.t, z: eye.z + pel.dir.z * pel.t };
      if (occ.first(eye, at, true)) {
        this.heldShots++;
        return null;
      }
    }
    return room.fire(self, { dir, shot });
  }

  // -------------------------------------------------------------------------------------------
  // Senses
  // -------------------------------------------------------------------------------------------

  /**
   * Where it aims on the target: the head when it rolled a headshot this engagement or only the
   * head shows over cover, else centre mass with a per-engagement offset across the torso.
   */
  private aimPoint(eye: Vec3, t: PlayerState): Vec3 {
    if (this.seen === 'head') return eyePointOf(t);
    if (this.aim.head) return headOf(t);
    const c = chestOf(t);
    const dx = c.x - eye.x;
    const dz = c.z - eye.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: c.x + (-dz / l) * this.aimOff.side, y: c.y + this.aimOff.up, z: c.z + (dx / l) * this.aimOff.side };
  }

  /**
   * Sight: enemies inside the FOV with line of sight (chest, or eyes over cover; `visiblePart`) are *noticed*
   * after `noticeTime` of continuous sight (longer far away and in the corner of the eye, shorter
   * when they're firing or just hurt it); someone right next to it is noticed in ~0.35 s from any
   * side. Nothing outside the FOV is seen: being shot or hearing someone (gunfire, footsteps)
   * makes it turn that way first. The current target is kept while it stays in view, and for
   * LOST_GRACE after it leaves it.
   */
  private perceive(room: Room, self: PlayerState, now: number) {
    const sk = this.skill;
    const eye = eyeOf(self);
    const halfFov = (sk.fovDeg / 2) * DEG;
    const dtp = this.noticeAt < 0 ? 0.05 : clamp(now - this.noticeAt, 0, 0.25);
    this.noticeAt = now;
    let best: PlayerState | null = null;
    let bestScore = Infinity;
    let bestSeen: 'body' | 'head' = 'body';
    const hearR = sk.hearingRange * room.modifiers.mul('hearingMultiplier', self);
    for (const q of room.players.values()) {
      if (q === self || !q.alive || !room.isEnemy(self, q)) continue;
      const c = chestOf(q);
      const d = dist(eye, c);
      const prev = this.notice.get(q.id) ?? 0;
      if (d > 90) {
        if (prev) this.notice.delete(q.id);
        continue;
      }
      const off = Math.abs(angleDiff(yawTo(eye, c), this.aim.yaw));
      const tracking = q === this.target && off < halfFov * 1.6;
      const near = d < 2.5;
      let seen: 'body' | 'head' | null = null;
      if (off <= halfFov || tracking || near) seen = visiblePart(room.world, room.map, eye, q);
      if (!seen) {
        if (prev > 0) this.notice.set(q.id, Math.max(0, prev - dtp * 1.5));
        // Footsteps: someone moving fast nearby, out of sight (Ninja is silent).
        const speed = Math.hypot(q.move.vx, q.move.vz);
        if (!this.target && speed > 3 && !q.move.crouched && d < hearR * (q.move.sprinting ? 0.4 : 0.25) && room.modifiers.any('silentFootsteps', q) !== true) {
          if (!this.heard || now - this.heard.t > 1) this.onHeard(q.move, now);
        }
        continue;
      }
      let progress = prev;
      if (!tracking) {
        const hurtBy = !!this.hurt && this.hurt.by === q.id && now - this.hurt.t < 1.5;
        const firing = now - q.lastFireTime < 0.3 && !q.lastFireSuppressed;
        const nt = near && off > halfFov ? 0.35 : noticeTime(sk, d, off / DEG, firing) * (hurtBy ? 0.35 : 1);
        progress = Math.min(1, prev + dtp / nt);
        this.notice.set(q.id, progress);
        if (progress < 1) continue;
      }
      const score = d * (q === this.target ? 0.6 : 1) * (off < 0.25 ? 0.8 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = q;
        bestSeen = seen;
      }
    }
    // Just lost sight of the target: keep it (aim held on the last sighting) for LOST_GRACE.
    if (!best && this.target?.alive && this.lastSeen?.id === this.target.id && now - this.lastSeen.t < LOST_GRACE) {
      best = this.target;
      bestSeen = this.seen;
    }
    this.seen = bestSeen;
    if (best !== this.target) {
      const prev = this.target;
      this.target = best;
      if (best) {
        this.stats.engagements++;
        const at = this.seen === 'head' ? headOf(best) : chestOf(best);
        // Switching between targets close together (re-acquire) is quicker than a cold spot.
        const quick = !!prev && dist(prev.move, best.move) < 4;
        engage(this.aim, sk, this.rnd, { yaw: yawTo(eye, at), pitch: Math.atan2(at.y - eye.y, Math.hypot(at.x - eye.x, at.z - eye.z)), quick });
        // Mostly centre mass; the head now and then (rarely for weak bots), never locked on.
        this.aim.head = this.rnd() < sk.headshotBias * 0.6;
        this.aimOff = { side: (this.rnd() - 0.5) * 0.24, up: -0.18 + this.rnd() * 0.3 };
        this.burstLeft = 0;
        this.pauseUntil = 0;
        if (this.goal && this.goal.kind !== 'objective' && this.goal.kind !== 'forced') {
          this.goal = null;
          this.path = null;
        }
      }
    }
    // UAV awareness: enemies the radar modifiers reveal to this bot.
    if (!best && now - (this.radar?.t ?? -9) > 1) {
      let near: PlayerState | null = null;
      let nd = Infinity;
      for (const q of room.players.values()) {
        if (!q.alive || !room.isEnemy(self, q)) continue;
        if (room.modifiers.any('radarVisible', q, self) !== true) continue;
        const d = dist(self.move, q.move);
        if (d < nd) {
          nd = d;
          near = q;
        }
      }
      if (near) this.radar = { at: { ...near.move }, t: now };
    }
  }

  // -------------------------------------------------------------------------------------------
  // Goals and paths
  // -------------------------------------------------------------------------------------------

  private chooseGoal(room: Room, nav: NavGrid, self: PlayerState, now: number): Goal | null {
    const sk = this.skill;
    if (this.pathPending && this.goal) {
      this.setGoal(nav, self, this.goal, room);
      return this.pathPending ? null : this.goal;
    }
    const g = this.goal;
    const pathDone = !this.path || this.pathIdx >= this.path.length;
    const expired = g && (now > g.until || (!!this.forced && g.kind !== 'forced') || (!this.forced && g.kind === 'forced'));
    // Standing a moment (holding an angle after a fight, or at a roam point).
    if (!this.forced && now < this.lingerUntil) return null;
    // Arrived at a roam point: hold there a while (less aggressive bots longer, campers long),
    // but not long anywhere overlooking the enemy's spawn.
    if (g && g.kind === 'roam' && pathDone && !expired && !this.forced) {
      this.goal = null;
      this.path = null;
      // Short stops: playtests found bots parked too long ("they camp, they don't leave positions").
      const camp = this.role === 'camper' ? 4 + this.rnd() * 6 : 0;
      this.lingerUntil = now + Math.min(this.overlooksEnemySpawn(room, self) ? 2 : 99, 0.3 + this.rnd() * (1 - sk.aggression) * 2 + camp);
      return null;
    }
    // Keep going where we were going unless it's time to re-plan.
    if (g && !expired && !pathDone && now < this.replanAt) return g;
    if (g && g.hold && !expired && pathDone && dist(self.move, g.at) < g.radius + 0.5 && now < this.replanAt) return g;
    if (g && pathDone && g.then && !expired) {
      this.setGoal(nav, self, g.then, room);
      return this.goal;
    }
    this.replanAt = now + 2 + this.rnd() * 1.5;

    let next: Goal | null = null;
    if (this.forced) {
      const f = this.forced;
      next = { at: f.at, radius: f.radius ?? 1, hold: !!f.hold, holdButtons: f.holdButtons ?? 0, sprint: !!f.sprint, kind: 'forced', until: now + 999 };
    }
    // Objective (modes register goals): followed with probability ~ objectivePlay x priority.
    if (!next) {
      const og = botGoalFor(room, self, { skill: sk, now });
      if (og) {
        // Mid plant/defuse: keep at it instead of re-rolling the intent and walking off.
        const busy = this.objectiveIntent && !!g && g.kind === 'objective' && g.holdButtons !== 0 && Math.hypot(self.move.x - g.at.x, self.move.z - g.at.z) <= g.radius;
        const pri = og.priority ?? 0.5;
        if (now > this.intentAt && !busy) {
          const roleBoost = this.role === 'objective' ? 0.35 : this.role === 'hunter' ? -0.15 : 0;
          this.objectiveIntent = this.rnd() < clamp(sk.objectivePlay * (0.55 + pri * 0.9) + roleBoost, 0, 1);
          this.intentAt = now + 6 + this.rnd() * 6;
        }
        // Urgent goals anyone would go for: a plant with the bomb, a defuse, a dropped bomb, an
        // enemy's dog tag right there, a flag being taken.
        if (pri >= 0.85) this.objectiveIntent = true;
        if (this.objectiveIntent) next = { at: og.at, radius: og.radius ?? 1.5, hold: !!og.hold, holdButtons: og.holdButtons ?? 0, sprint: !!og.sprint || (og.priority ?? 0) > 0.8, kind: 'objective', until: now + 20 };
      }
    }
    // Chase / flank where the last target was seen.
    if (!next && this.lastSeen && now - this.lastSeen.t < 2.5 + sk.aggression * 5 && (!g || g.kind !== 'chase')) {
      // Two teammates already on it: the rest don't pile in (flank or hold instead).
      const crowded = this.world.claims ? chasersNear(this.world.claims, self.team, this.lastSeen.at, self.id, now) >= 2 : false;
      if (crowded && this.rnd() < 0.6) {
        this.goal = null;
        this.path = null;
        this.lingerUntil = now + 0.5 + this.rnd() * 0.8;
        return null;
      }
      if (this.rnd() < 0.25 + sk.aggression * 0.75 + (this.role === 'hunter' ? 0.2 : 0) - (this.role === 'camper' ? 0.4 : 0)) {
        const ls = this.lastSeen.at;
        const chase: Goal = { at: ls, radius: 1.5, hold: false, holdButtons: 0, sprint: false, kind: 'chase', until: now + 8 };
        if (this.rnd() < sk.aggression * 0.45 + (this.role === 'flanker' ? 0.35 : 0) + (crowded ? 0.4 : 0)) {
          const dx = ls.x - self.move.x;
          const dz = ls.z - self.move.z;
          const dd = Math.hypot(dx, dz) || 1;
          const side = this.rnd() < 0.5 ? -1 : 1;
          const fp = { x: ls.x - (dx / dd) * 4 + (-dz / dd) * side * 8, y: ls.y, z: ls.z - (dz / dd) * 4 + (dx / dd) * side * 8 };
          const cell = nav.cellAt(fp, true);
          if (cell && cell.core) next = { at: { x: cell.x, y: cell.y, z: cell.z }, radius: 1.5, hold: false, holdButtons: 0, sprint: true, kind: 'flank', until: now + 10, then: chase };
        }
        next ??= chase;
      } else {
        // Hold the angle a moment.
        this.goal = null;
        this.path = null;
        this.lingerUntil = now + 0.6 + this.rnd() * 1.2;
        return null;
      }
    }
    const heardBusy = !!this.heard && !!this.world.claims && chasersNear(this.world.claims, self.team, this.heard.at, self.id, now) >= 2;
    if (!next && this.heard && now - this.heard.t < 5 && !heardBusy && this.rnd() < 0.45 + sk.aggression * 0.5 + (this.role === 'hunter' ? 0.3 : 0)) next = { at: this.heard.at, radius: 2, hold: false, holdButtons: 0, sprint: false, kind: 'heard', until: now + 8 };
    if (!next && this.radar && now - this.radar.t < 4 && this.rnd() < 0.3 + sk.aggression * 0.6) next = { at: this.radar.at, radius: 2, hold: false, holdButtons: 0, sprint: false, kind: 'radar', until: now + 8 };
    if (!next) {
      // Keep wandering to the current roam point if it's still on.
      if (g && g.kind === 'roam' && !expired && !pathDone) return g;
      const at = this.roamPoint(room, nav, self, now);
      if (at) next = { at, radius: 2, hold: false, holdButtons: 0, sprint: false, kind: 'roam', until: now + 10 + this.rnd() * 10 };
    }
    if (next) {
      this.sprintPlan = next.sprint || this.rnd() < 0.25 + 0.65 * sk.aggression;
      this.setGoal(nav, self, next, room);
    }
    return this.goal;
  }

  /**
   * Plan a path to `goal`. At most NAV_SEARCHES_PER_TICK searches run per room tick; past that
   * the goal waits (`pathPending`) and is planned on a later tick. Teammates' routes cost more.
   */
  private setGoal(nav: NavGrid, self: PlayerState, goal: Goal, room?: Room) {
    this.goal = goal;
    this.pathIdx = 0;
    const budget = this.world.nav;
    let limit: number | undefined;
    if (room && budget) {
      if (budget.tick !== room.tick) {
        budget.tick = room.tick;
        budget.used = 0;
        budget.expanded = 0;
      }
      const left = NAV_EXPAND_PER_TICK - (budget.expanded ?? 0);
      if (budget.used >= NAV_SEARCHES_PER_TICK || left < 4000) {
        this.path = null;
        this.pathPending = true;
        return;
      }
      budget.used++;
      limit = left;
    }
    this.pathPending = false;
    const usage = this.world.usage;
    const team = self.team;
    const id = self.id;
    const cost = usage && team !== null && goal.kind !== 'objective' && goal.kind !== 'cover' && goal.kind !== 'forced' ? (c: NavCell) => 1 + Math.min(3, usage.usage(team, c.x, c.z, id)) * 0.35 : undefined;
    const before = nav.expanded;
    this.path = nav.path(self.move, goal.at, limit, { cost });
    if (budget) budget.expanded = (budget.expanded ?? 0) + (nav.expanded - before);
    if (!this.path) this.goal = goal.kind === 'forced' ? goal : null;
    usage?.set(id, team, this.path);
    const claims = this.world.claims;
    if (claims && this.goal) claims.set(id, { team, at: { ...goal.at }, kind: goal.kind, role: this.role, lane: this.lane, t: room?.time ?? 0 });
  }

  /** A spot near the path ahead where enemies just were (recent fight, a noise), if any. */
  private dangerNear(self: PlayerState, now: number): Vec3 | null {
    if (this.heard && now - this.heard.t < 4 && dist(self.move, this.heard.at) < 18) return this.heard.at;
    for (let i = this.world.fights.length - 1; i >= 0; i--) {
      const f = this.world.fights[i]!;
      if (now - f.t > 6) break;
      if (f.by === self.id || (f.team !== undefined && f.team !== null && f.team === self.team)) continue;
      const d = Math.hypot(f.x - self.move.x, f.z - self.move.z);
      if (d > 4 && d < 16) return f;
    }
    return null;
  }

  /** Is the bot standing where it can see the enemy's recent spawns (within 35 m)? */
  private overlooksEnemySpawn(room: Room, self: PlayerState): boolean {
    if (!room.mode.teams || self.team === null) return false;
    const eye = eyeOf(self);
    let n = 0;
    for (const sp of recentSpawns(room, (1 - self.team) as Team)) {
      if (n++ > 3) break;
      if (Math.hypot(sp.x - eye.x, sp.z - eye.z) > 35) continue;
      if (room.world.lineOfSight(eye, { x: sp.x, y: sp.y + 1.5, z: sp.z })) return true;
    }
    return false;
  }

  /** Spawn-aware roaming: toward recent fights and the enemy half, not our spawn, not theirs. */
  private roamPoint(room: Room, nav: NavGrid, self: PlayerState, now: number): Vec3 | null {
    const sk = this.skill;
    const cands: Vec3[] = [...(room.map.hotspots ?? [])];
    for (let i = 0; i < 10; i++) {
      const c = nav.random(this.rnd);
      if (c) cands.push({ x: c.x, y: c.y, z: c.z });
    }
    if (!cands.length) return null;
    const team = self.team;
    const sp = room.map.spawns;
    const own = room.mode.teams && team !== null ? centroid(sp.teams[team]) : null;
    const enemy = room.mode.teams && team !== null ? centroid(sp.teams[(1 - team) as Team]) : null;
    const fights = this.world.fights.filter((f) => now - f.t < 12);
    const axis = mapAxis(room.map);
    const enemySpawns = room.mode.teams && team !== null ? recentSpawns(room, (1 - team) as Team).slice(-4) : [];
    const claims = this.world.claims;
    const role = this.role;
    let best: Vec3 | null = null;
    let bs = -Infinity;
    for (const c of cands) {
      const d = dist(self.move, c);
      let s = this.rnd() * 4 - d * 0.04;
      if (d < 5) s -= 6;
      // Lanes: lane holders and flankers stay in theirs.
      if (role === 'lane' || role === 'flanker') s += laneOf(axis, c) === this.lane ? 3 : -2.5;
      // Flankers push deep toward the enemy's side.
      if (role === 'flanker' && team !== null) s += 2.5 * depthOf(axis, c) * (team === 0 ? 1 : -1);
      // Campers want a hotspot and stay put there.
      if (role === 'camper' && !(room.map.hotspots ?? []).includes(c)) s -= 3;
      // Don't head where teammates already are heading.
      if (claims) s -= crowdPenalty(claims, team, c, self.id, now);
      // Never camp the enemy's current spawn.
      for (const sp of enemySpawns) if (Math.hypot(sp.x - c.x, sp.z - c.z) < 18) s -= 8;
      if (own && enemy) {
        const dO = Math.hypot(c.x - own.x, c.z - own.z);
        const dE = Math.hypot(c.x - enemy.x, c.z - enemy.z);
        const t = dO / (dO + dE + 1e-6);
        s += 3 * sk.aggression * t;
        if (t < 0.22) s -= 3;
        if (dE < 14) s -= 8;
        if (t > 0.8) s -= 2;
      }
      let near = 0;
      for (const f of fights) if (Math.hypot(f.x - c.x, f.z - c.z) < 12) near++;
      s += Math.min(2, near) * (0.3 + 1.0 * sk.aggression) * (role === 'hunter' ? 2 : 1);
      if (s > bs) {
        bs = s;
        best = c;
      }
    }
    return best;
  }

  private remaining(self: PlayerState): number {
    const p = this.path;
    if (!p || this.pathIdx >= p.length) return 0;
    let d = Math.hypot(p[this.pathIdx]!.x - self.move.x, p[this.pathIdx]!.z - self.move.z);
    for (let i = this.pathIdx + 1; i < p.length; i++) d += Math.hypot(p[i]!.x - p[i - 1]!.x, p[i]!.z - p[i - 1]!.z);
    return d;
  }

  /** Steer along the path: next waypoint (string pulled), jump at ledges. */
  follow(nav: NavGrid, self: PlayerState): { x: number; z: number; jump: boolean; look: Vec3; done: boolean } {
    const p = this.path;
    const pos = self.move;
    if (!p || this.pathIdx >= p.length) return { x: 0, z: 0, jump: false, look: { x: pos.x, y: pos.y + PLAYER.eye, z: pos.z - 1 }, done: true };
    // Progress: the nearest of the next few cells (same level) is where we are on the path, so
    // cells passed while cutting corners don't pull us back.
    let bestK = this.pathIdx;
    let bestD = Infinity;
    for (let k = this.pathIdx; k < Math.min(p.length, this.pathIdx + 14); k++) {
      const c = p[k]!;
      const dd = Math.hypot(c.x - pos.x, c.z - pos.z) + Math.abs(c.y - pos.y) * 2;
      if (dd < bestD) {
        bestD = dd;
        bestK = k;
      }
    }
    if (bestK !== this.pathIdx && nav.straight(pos, p[bestK]!)) this.pathIdx = bestK;
    // Skip waypoints reached.
    while (this.pathIdx < p.length) {
      const c = p[this.pathIdx]!;
      const last = this.pathIdx === p.length - 1;
      if (Math.hypot(c.x - pos.x, c.z - pos.z) < (last ? 0.35 : 0.45) && Math.abs(c.y - pos.y) < 0.7) this.pathIdx++;
      else break;
    }
    if (this.pathIdx >= p.length) return { x: 0, z: 0, jump: false, look: { x: pos.x, y: pos.y + PLAYER.eye, z: pos.z - 1 }, done: true };
    // String pull: the farthest waypoint (up to 10 ahead) reachable by walking straight.
    let target = this.pathIdx;
    const prevCell = this.pathIdx > 0 ? p[this.pathIdx - 1]! : nav.cellAt(pos);
    for (let j = this.pathIdx + 1; j < Math.min(p.length, this.pathIdx + 10); j++) {
      const a = p[j - 1]!;
      const b = p[j]!;
      if (nav.edgeKind(a, b) !== 'walk') break;
      if (!nav.straight(pos, b)) break;
      target = j;
    }
    const wp = p[target]!;
    const dx = wp.x - pos.x;
    const dz = wp.z - pos.z;
    const d = Math.hypot(dx, dz) || 1;
    // Jump when the next link is a jump and we're at its foot.
    const nextCell = p[this.pathIdx]!;
    const kind = prevCell ? nav.edgeKind(prevCell, nextCell) : null;
    const needJump = (kind === 'jump' || nextCell.y - pos.y > PLAYER.stepHeight + 0.05) && Math.hypot(nextCell.x - pos.x, nextCell.z - pos.z) < 1.0 && nextCell.y > pos.y + 0.3;
    const look = p[Math.min(p.length - 1, target + 2)]!;
    return { x: dx / d, z: dz / d, jump: needJump, look: { x: look.x, y: look.y + PLAYER.eye, z: look.z }, done: false };
  }

  // -------------------------------------------------------------------------------------------
  // Lethals and streaks
  // -------------------------------------------------------------------------------------------

  private considerGrenade(room: Room, self: PlayerState, now: number) {
    if (this.throwing || !self.loadout?.lethal || now < this.grenadeAt || !this.lastSeen) return;
    const age = now - this.lastSeen.t;
    if (age < 0.4 || age > 3) return;
    const d = dist(self.move, this.lastSeen.at);
    if (d < 7 || d > 24) return;
    // Nobody of ours near where it would land.
    for (const q of room.players.values()) if (q !== self && q.alive && !room.isEnemy(self, q) && dist(q.move, this.lastSeen.at) < 5) return;
    if (this.rnd() > 0.12 + this.skill.aggression * 0.25) {
      this.grenadeAt = now + 1.5;
      return;
    }
    this.throwing = { at: { ...this.lastSeen.at }, t: now + 0.25 };
    this.grenadeAt = now + 14 + this.rnd() * 8;
  }

  private considerStreak(room: Room, self: PlayerState, now: number, pulse: (b: number) => void) {
    const sp = this.streakPress;
    if (!sp || now < sp.at) return;
    this.streakPress = null;
    const handler = botStreakHandler();
    if (handler) {
      try {
        if (handler(room, self, sp.id)) return;
      } catch (err) {
        room.log(`bot streak handler failed: ${String(err)}`);
      }
    }
    pulse(Buttons.STREAK);
  }
}

/** Streak ids a bot's loadout earns at exactly `streak` kills (Hardline etc. via streakCostOffset). */
export function streaksEarnedAt(room: Room, p: PlayerState, streak: number): string[] {
  const off = room.modifiers.sum('streakCostOffset', p);
  return (p.loadout?.killstreaks ?? []).filter((id) => {
    const def = KILLSTREAK_BY_ID.get(id);
    return def && Math.max(1, def.kills + off) === streak;
  });
}

function centroid(points: readonly Vec3[]): Vec3 | null {
  if (!points.length) return null;
  let x = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    z += p.z;
  }
  return { x: x / points.length, y: 0, z: z / points.length };
}

/** Is a short move in direction (mx, mz) onto walkable ground at about this height? */
function walkableDir(nav: NavGrid, self: PlayerState, mx: number, mz: number): boolean {
  const l = Math.hypot(mx, mz);
  if (l < 0.1) return true;
  const ahead = { x: self.move.x + (mx / l) * 0.8, y: self.move.y, z: self.move.z + (mz / l) * 0.8 };
  const c = nav.cellAt(ahead);
  return !!c && Math.abs(c.y - self.move.y) <= PLAYER.stepHeight && Math.hypot(c.x - ahead.x, c.z - ahead.z) < 0.6;
}

/** A nearby reachable cell out of the threat's sight (crouched eye height), nearest first. */
export function findCover(room: Room, nav: NavGrid, self: PlayerState, threatEye: Vec3, rnd: () => number = Math.random): NavCell | null {
  let best: NavCell | null = null;
  let bd = Infinity;
  for (let i = 0; i < 28; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 2 + rnd() * 9;
    const c = nav.cellAt({ x: self.move.x + Math.cos(a) * r, y: self.move.y, z: self.move.z + Math.sin(a) * r }, true);
    if (!c || !c.core || Math.abs(c.y - self.move.y) > 1.5) continue;
    if (room.world.lineOfSight(threatEye, { x: c.x, y: c.y + PLAYER.crouchEye + 0.1, z: c.z })) continue;
    const d = Math.hypot(c.x - self.move.x, c.z - self.move.z);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

