/**
 * The bot aim controller: pure functions over a small state, unit-tested in
 * tests/bots.aim.test.ts. It produces the view a person's mouse could, never a snap:
 *
 *   reaction     after first noticing a target the aim doesn't move for a reaction time drawn
 *                per engagement (reactionMs x 0.7..1.3: 230-430 ms for regular).
 *   acquisition  each axis is a damped spring (natural frequency from turnSpeedDeg, damping
 *                below critical for weaker bots, so they overshoot and correct) with bounded
 *                angular acceleration (ease in) and velocity (turnSpeedDeg, never exceeded).
 *                Pitch settles slower than yaw, so the path is a slight curve. The first swing
 *                aims at a point off the target (start error, bigger for bigger flicks, along
 *                the swing: an over- or undershoot) that decays while it tracks.
 *   tracking     the target's angle is followed through a lagged estimate with partial lead,
 *                so a strafing target is trailed (reversals throw it off) and never led
 *                perfectly. Low-frequency sway (smoothed value noise) never goes away.
 *   situation    the start error and sway grow with distance, the target's lateral speed, the
 *                bot's own movement and hip fire (`AimContext`).
 *   recoil       each shot kicks the view like a player's (WeaponDef.recoil x the client's
 *                RECOIL_SCALE, less when ADS, random horizontal) and recovers at the weapon's
 *                recovery speed; the bot pulls down only `burstControl` of it.
 *   flinch       being hit knocks the view off (and adds re-acquisition error); the spring has
 *                to bring it back.
 *
 * The bot fires when its view reaches the point it *means* to hit (target plus its own error,
 * which it can't see), so accuracy follows skill. Weapon spread is applied by the server on top,
 * exactly as for players.
 */
import type { BotSkill } from '../../../shared/defs/bots';

const DEG = Math.PI / 180;
/** Must match the client's view kick per WeaponDef.recoil degree (src/client/game/match.ts). */
export const RECOIL_SCALE = 0.6;

/** Smoothed 1D value noise in -1..1 (two octaves), deterministic per seed. */
export function smoothNoise(seed: number, t: number): number {
  const oct = (f: number, s: number) => {
    const x = t * f;
    const i = Math.floor(x);
    const u = x - i;
    const k = u * u * (3 - 2 * u);
    return hash(i, s) * (1 - k) + hash(i + 1, s) * k;
  };
  return oct(1, seed) * 0.7 + oct(2.7, seed + 17.3) * 0.3;
}

function hash(i: number, s: number): number {
  const v = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
  return (v - Math.floor(v)) * 2 - 1;
}

/** The numbers the controller runs on, derived from a BotSkill. */
export interface AimParams {
  /** Mean reaction, seconds. */
  reaction: number;
  /** Max angular velocity (rad/s) = turnSpeedDeg. */
  maxVel: number;
  /** Max angular acceleration (rad/s^2). */
  maxAcc: number;
  /** Spring natural frequency (rad/s) and damping ratio, yaw; pitch uses `pitchRatio` x omega. */
  omega: number;
  zeta: number;
  pitchRatio: number;
  /** Start error at engagement (degrees, before the situation multiplier). */
  errDeg: number;
  /** Extra start error per degree of swing. */
  flickErr: number;
  /** Seconds for the start error to shrink by e. */
  settleTau: number;
  /** Residual sway amplitude (degrees, before the situation multiplier). */
  swayDeg: number;
  /** Seconds of lag in the bot's estimate of the target's angle. */
  perceiveTau: number;
  /** 0..1 of the spring's lag it leads by (1 = perfect tracking of a constant strafe). */
  lead: number;
  /** Share of recoil it pulls down. */
  recoilComp: number;
}

export function aimParams(skill: BotSkill): AimParams {
  const e = skill.aimErrorDeg;
  // 0 (worst) .. 1 (best) aim quality from the error knob (0..15 deg slider).
  const q = Math.max(0, Math.min(1, 1 - e / 12));
  const maxVel = Math.max(30, skill.turnSpeedDeg) * DEG;
  return {
    reaction: skill.reactionMs / 1000,
    maxVel,
    maxAcc: maxVel * (8 + 6 * q),
    omega: 7 + skill.turnSpeedDeg / 35,
    zeta: 0.5 + 0.3 * q,
    pitchRatio: 0.7,
    errDeg: e,
    flickErr: 0.04 + 0.08 * (1 - q),
    settleTau: 0.12 + (e / 15) * 0.4,
    swayDeg: e * 0.1 + e * e * 0.025,
    perceiveTau: 0.05 + 0.1 * (1 - q),
    lead: 0.5 + 0.4 * q,
    recoilComp: Math.max(0, Math.min(1, skill.burstControl)) * 0.85,
  };
}

/** What the bot knows about the shot it's lining up, for situational accuracy. */
export interface AimContext {
  /** Distance to the aim point, m. */
  dist: number;
  /** Target speed across the line of sight, m/s. */
  latSpeed: number;
  /** The bot itself is moving (> 0.5 m/s). */
  moving: boolean;
  /** ADS fraction 0..1. */
  ads: number;
}

export const DEFAULT_CTX: AimContext = { dist: 15, latSpeed: 0, moving: false, ads: 1 };

/** Error multiplier for the situation: distance, target motion, own motion, hip fire. */
export function situation(c: AimContext): number {
  const hip = 1 - c.ads;
  return (1 + c.dist / 150) * (1 + Math.min(0.8, c.latSpeed * 0.05)) * (1 + (c.moving ? 0.8 * (1 - 0.6 * c.ads) : 0)) * (1 + 0.6 * hip);
}

export interface AimState {
  /** Current view, radians (what the bot sends as yaw/pitch). */
  yaw: number;
  pitch: number;
  /** Angular velocity of the hand, rad/s. */
  vYaw: number;
  vPitch: number;
  /** Seconds left before the aim starts moving. */
  react: number;
  /** Decaying engagement (start) error, degrees. */
  errYaw: number;
  errPitch: number;
  /** Seconds tracking this target (after reacting). */
  track: number;
  /** Aim for the head this engagement. */
  head: boolean;
  /** Outstanding recoil in the view, degrees (pitch up, yaw). */
  recoil: number;
  recoilYaw: number;
  /** Lagged estimate of the target's angle and its rate (rad, rad/s); NaN = not yet seen. */
  estYaw: number;
  estPitch: number;
  estVYaw: number;
  estVPitch: number;
  /** Noise seeds and the noise clock. */
  seed: number;
  clock: number;
  /** Room-time-free bookkeeping: seconds since the last shot (recoil recovers slower while spraying). */
  sinceShot: number;
}

export function newAimState(yaw = 0, pitch = 0): AimState {
  return { yaw, pitch, vYaw: 0, vPitch: 0, react: 0, errYaw: 0, errPitch: 0, track: 0, head: false, recoil: 0, recoilYaw: 0, estYaw: NaN, estPitch: NaN, estVYaw: 0, estVPitch: 0, seed: 1, clock: 0, sinceShot: 9 };
}

export interface EngageOpts {
  /** Where the target is now (radians), to size the swing-dependent start error. */
  yaw?: number;
  pitch?: number;
  /** Re-acquiring a target close to the last one: quicker reaction, smaller error. */
  quick?: boolean;
}

/** Start an engagement with a new target. */
export function engage(s: AimState, skill: BotSkill, rnd: () => number = Math.random, o: EngageOpts = {}): void {
  const P = aimParams(skill);
  s.react = P.reaction * (0.7 + rnd() * 0.6) * (o.quick ? 0.5 : 1);
  // Start error: base, plus a share of the swing, mostly along the swing (over or undershoot).
  const dy = o.yaw !== undefined ? angleDiff(o.yaw, s.yaw) / DEG : 0;
  const dp = o.pitch !== undefined ? (o.pitch - s.pitch) / DEG : 0;
  const swing = Math.hypot(dy, dp);
  const base = P.errDeg * (0.3 + rnd() * 0.35) * (o.quick ? 0.6 : 1);
  const along = swing * P.flickErr * (rnd() < 0.55 ? 1 : -1);
  const a = rnd() * Math.PI * 2;
  const ux = swing > 0.5 ? dy / swing : 1;
  const uy = swing > 0.5 ? dp / swing : 0;
  s.errYaw = Math.cos(a) * base + ux * along;
  // Humans track horizontally better than vertically: misses are a bit more often high/low.
  s.errPitch = Math.sin(a) * base * 0.8 + uy * along;
  s.track = 0;
  s.head = false;
  s.estYaw = NaN;
  s.estPitch = NaN;
  s.estVYaw = 0;
  s.estVPitch = 0;
  s.seed = Math.floor(rnd() * 10000);
}

/** Residual sway (degrees) right now. */
export function sway(s: AimState, skill: BotSkill, ctx: AimContext = DEFAULT_CTX): [number, number] {
  const amp = aimParams(skill).swayDeg * situation(ctx);
  return [amp * smoothNoise(s.seed, s.clock * 1.5), amp * 0.8 * smoothNoise(s.seed + 91, s.clock * 1.2)];
}

/** One spring step on an axis toward `err` (goal - current, rad). Returns the new velocity. */
function springStep(v: number, err: number, omega: number, zeta: number, maxAcc: number, maxVel: number, dt: number): number {
  const acc = clampAbs(omega * omega * err - 2 * zeta * omega * v, maxAcc);
  return clampAbs(v + acc * dt, maxVel);
}

/**
 * Advance the aim one step toward a target seen at (`trueYaw`, `truePitch`) (radians). Returns
 * the point the bot intends to hit (radians), which includes its error, sway and lag.
 */
export function stepAim(s: AimState, skill: BotSkill, trueYaw: number, truePitch: number, dt: number, ctx: AimContext = DEFAULT_CTX, recoilRecovery = 10): { yaw: number; pitch: number } {
  const P = aimParams(skill);
  s.clock += dt;
  s.sinceShot += dt;
  recoverRecoil(s, recoilRecovery, dt);
  // Lagged estimate of where the target is and how fast it moves across the view.
  if (Number.isNaN(s.estYaw)) {
    s.estYaw = trueYaw;
    s.estPitch = truePitch;
  } else {
    const k = 1 - Math.exp(-dt / P.perceiveTau);
    const ny = s.estYaw + angleDiff(trueYaw, s.estYaw) * k;
    const np = s.estPitch + (truePitch - s.estPitch) * k;
    const kv = 1 - Math.exp(-dt / 0.15);
    s.estVYaw += (angleDiff(ny, s.estYaw) / dt - s.estVYaw) * kv;
    s.estVPitch += ((np - s.estPitch) / dt - s.estVPitch) * kv;
    s.estYaw = ny;
    s.estPitch = np;
  }
  if (s.react > 0) {
    s.react -= dt;
    // Frozen hand: whatever motion it had dies out.
    s.vYaw *= Math.exp(-dt * 12);
    s.vPitch *= Math.exp(-dt * 12);
    s.yaw += s.vYaw * dt;
    s.pitch += s.vPitch * dt;
    return { yaw: s.estYaw + s.errYaw * DEG, pitch: s.estPitch + s.errPitch * DEG };
  }
  s.track += dt;
  const ke = Math.exp(-dt / P.settleTau);
  s.errYaw *= ke;
  s.errPitch *= ke;
  const sit = situation(ctx);
  const [wy, wp] = sway(s, skill, ctx);
  const intendYaw = s.estYaw + (s.errYaw * sit + wy) * DEG;
  const intendPitch = s.estPitch + (s.errPitch * sit + wp) * DEG;
  // Partial lead of its own lag (the spring's 2 zeta / omega plus the perception lag) x rate.
  const lagT = (2 * P.zeta) / P.omega + P.perceiveTau;
  const goalYaw = intendYaw + s.estVYaw * lagT * P.lead;
  const goalPitch = intendPitch + s.estVPitch * lagT * P.lead;
  // The hand sees only the recoil share it compensates.
  const ignoredP = s.recoil * (1 - P.recoilComp) * DEG;
  const ignoredY = s.recoilYaw * (1 - P.recoilComp) * DEG;
  s.vYaw = springStep(s.vYaw, angleDiff(goalYaw, s.yaw - ignoredY), P.omega, P.zeta, P.maxAcc, P.maxVel, dt);
  s.vPitch = springStep(s.vPitch, goalPitch - (s.pitch - ignoredP), P.omega * P.pitchRatio, Math.min(1, P.zeta + 0.1), P.maxAcc, P.maxVel, dt);
  s.yaw += s.vYaw * dt;
  s.pitch += s.vPitch * dt;
  return { yaw: intendYaw, pitch: intendPitch };
}

/**
 * Turn the view toward a direction without a target (walking, checking a noise, throwing): the
 * same spring and limits, no error. `speed` scales the limits (relaxed looking is slower).
 */
export function lookToward(s: AimState, skill: BotSkill, yaw: number, pitch: number, dt: number, speed = 1): void {
  const P = aimParams(skill);
  s.clock += dt;
  s.sinceShot += dt;
  recoverRecoil(s, 12, dt);
  const om = P.omega * Math.min(1, speed) * 0.8;
  s.vYaw = springStep(s.vYaw, angleDiff(yaw, s.yaw), om, 0.9, P.maxAcc * speed, P.maxVel * speed, dt);
  s.vPitch = springStep(s.vPitch, pitch - s.pitch, om * P.pitchRatio, 1, P.maxAcc * speed, P.maxVel * speed, dt);
  s.yaw += s.vYaw * dt;
  s.pitch += s.vPitch * dt;
}

function recoverRecoil(s: AimState, recovery: number, dt: number) {
  // Like the client: full speed once the trigger rests, 35% while spraying.
  const r = recovery * dt * (s.sinceShot > 0.12 ? 1 : 0.35);
  const dp = Math.min(Math.abs(s.recoil), r) * Math.sign(s.recoil);
  const dy = Math.min(Math.abs(s.recoilYaw), r * 0.5) * Math.sign(s.recoilYaw);
  s.recoil -= dp;
  s.recoilYaw -= dy;
  s.pitch -= dp * DEG;
  s.yaw -= dy * DEG;
}

/** A shot was fired: the player's view kick (WeaponDef.recoil degrees), less when ADS. */
export function addRecoil(s: AimState, recoil: { vertical: number; horizontal: number }, ads: number, rnd: () => number = Math.random): void {
  const k = (1 - ads * 0.35) * RECOIL_SCALE;
  const p = recoil.vertical * k;
  const y = (rnd() - 0.5) * 2 * recoil.horizontal * k;
  s.recoil += p;
  s.recoilYaw += y;
  s.pitch += p * DEG;
  s.yaw += y * DEG;
  s.sinceShot = 0;
}

/**
 * Hit: the view is knocked off by about `deg` (up and to a side) and the hand has to bring it
 * back; the re-acquisition adds some error too.
 */
export function flinch(s: AimState, deg: number, rnd: () => number = Math.random): void {
  if (deg <= 0) return;
  const side = (rnd() - 0.5) * 2;
  s.pitch += deg * (0.6 + rnd() * 0.4) * DEG;
  s.yaw += deg * side * 0.8 * DEG;
  s.vYaw *= 0.3;
  s.vPitch *= 0.3;
  s.errYaw += deg * side * 0.5;
  s.errPitch += deg * 0.3;
}

/** Angle (degrees) between the current view and a direction. */
export function offDeg(s: AimState, yaw: number, pitch: number): number {
  return Math.hypot(angleDiff(yaw, s.yaw), pitch - s.pitch) / DEG;
}

/** Firing tolerance (degrees) at distance `d`: about half a body's width plus a little. */
export const toleranceDeg = (d: number, tight = 1) => Math.atan2(0.3 * tight, Math.max(0.5, d)) / DEG + 0.35 * tight;

export function angleDiff(a: number, b: number): number {
  let d = a - b;
  d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
  return d;
}

export const clampAbs = (v: number, max: number) => (v > max ? max : v < -max ? -max : v);

/** Turn `from` toward `to` (radians) by at most `rate`. */
export const turnToward = (from: number, to: number, rate: number) => from + clampAbs(angleDiff(to, from), rate);

// ---------------------------------------------------------------------------------------------
// Perception: how long it takes to notice someone (pure, unit-tested)
// ---------------------------------------------------------------------------------------------

/**
 * Seconds of continuous sight needed to notice an enemy at distance `d` (m), `offDeg` from the
 * centre of view, inside a field of view of `fovDeg`. Grows with distance and peripheral angle;
 * someone firing is noticed faster (muzzle flash). Infinity outside the FOV.
 */
export function noticeTime(skill: BotSkill, d: number, offDegrees: number, firing = false): number {
  const half = skill.fovDeg / 2;
  if (offDegrees > half) return Infinity;
  // Tuned up after playtests: bots holding an angle noticed and shot too fast.
  const base = 0.04 + (skill.reactionMs / 1000) * 0.22;
  const per = offDegrees / half;
  return base * (1 + d / 40) * (1 + 1.5 * per * per) * (firing ? 0.5 : 1);
}

/** How far (degrees) the view is from `yaw`/`pitch` as the bot feels it: it doesn't notice the recoil it isn't fighting. */
export function feltOffDeg(s: AimState, skill: BotSkill, yaw: number, pitch: number): number {
  const keep = 1 - aimParams(skill).recoilComp;
  return Math.hypot(angleDiff(yaw, s.yaw - s.recoilYaw * keep * DEG), pitch - (s.pitch - s.recoil * keep * DEG)) / DEG;
}
