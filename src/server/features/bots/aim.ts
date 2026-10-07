/**
 * The bot aim model, as pure functions over a small state (unit-tested in tests/bots.unit.test.ts):
 *
 *   - reaction: after first seeing a target the aim doesn't move for `reactionMs` (+0..25%);
 *   - error: the first swing is off by up to `aimErrorDeg`, decaying while it tracks, down to a
 *     residual wobble (~30% of aimErrorDeg) that never goes away, so worse bots keep missing;
 *   - turn speed: yaw/pitch move toward the intended point at most `turnSpeedDeg` per second;
 *   - head or chest per engagement (`headshotBias`);
 *   - recoil: each shot of a burst climbs the aim by the weapon's vertical recoil times
 *     (1 - burstControl), recovering between bursts.
 *
 * The bot "thinks" it's on target when its crosshair reaches the point it intends to hit (target
 * plus its own error), which it can't see, so its accuracy really follows its skill.
 */
import type { BotSkill } from '../../../shared/defs/bots';

const DEG = Math.PI / 180;

export interface AimState {
  /** Current view, radians (what the bot sends as yaw/pitch). */
  yaw: number;
  pitch: number;
  /** Seconds left before the aim starts moving. */
  react: number;
  /** Decaying engagement error, degrees. */
  errYaw: number;
  errPitch: number;
  /** Seconds tracking this target (after reacting). */
  track: number;
  /** Aim for the head this engagement. */
  head: boolean;
  /** Accumulated recoil climb, degrees (pitch up). */
  recoil: number;
  /** Wobble phases (random per engagement). */
  phase: [number, number, number, number];
}

export function newAimState(yaw = 0, pitch = 0): AimState {
  return { yaw, pitch, react: 0, errYaw: 0, errPitch: 0, track: 0, head: false, recoil: 0, phase: [0, 1, 2, 3] };
}

/** Start an engagement with a new target. */
export function engage(s: AimState, skill: BotSkill, rnd: () => number = Math.random): void {
  s.react = (skill.reactionMs / 1000) * (0.9 + rnd() * 0.35);
  const mag = skill.aimErrorDeg * (0.6 + rnd() * 0.4);
  const a = rnd() * Math.PI * 2;
  s.errYaw = Math.cos(a) * mag;
  // Misses are more often low/high than wide: humans track horizontally better.
  s.errPitch = Math.sin(a) * mag * 0.8;
  s.track = 0;
  s.head = rnd() < skill.headshotBias;
  s.phase = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
}

/** Residual wobble (degrees) at tracking time `t`. Smooth, never zero for an imperfect aimer. */
export function wobble(s: AimState, skill: BotSkill): [number, number] {
  const amp = skill.aimErrorDeg * 0.3;
  const t = s.track;
  const [a, b, c, d] = s.phase;
  return [amp * (0.65 * Math.sin(t * 2.3 + a) + 0.35 * Math.sin(t * 5.9 + b)), amp * 0.8 * (0.65 * Math.sin(t * 1.9 + c) + 0.35 * Math.sin(t * 6.7 + d))];
}

/** Seconds for the engagement error to shrink by e: worse aimers settle slower. */
export const settleTau = (skill: BotSkill) => 0.25 + (skill.aimErrorDeg / 15) * 0.9;

/**
 * Advance the aim one step toward a target seen at (`trueYaw`, `truePitch`) (radians). Returns
 * the point the bot intends to hit (radians), which includes its error, wobble and recoil.
 */
export function stepAim(s: AimState, skill: BotSkill, trueYaw: number, truePitch: number, dt: number, recoilRecovery = 10, burstControl = skill.burstControl): { yaw: number; pitch: number } {
  if (s.react > 0) {
    s.react -= dt;
  } else {
    s.track += dt;
    const k = Math.exp(-dt / settleTau(skill));
    s.errYaw *= k;
    s.errPitch *= k;
  }
  s.recoil = Math.max(0, s.recoil - recoilRecovery * (0.3 + 0.7 * burstControl) * dt);
  const [wy, wp] = s.react > 0 ? [0, 0] : wobble(s, skill);
  const intendYaw = trueYaw + (s.errYaw + wy) * DEG;
  const intendPitch = truePitch + (s.errPitch + wp + s.recoil) * DEG;
  if (s.react <= 0) {
    const rate = skill.turnSpeedDeg * DEG * dt;
    s.yaw += clampAbs(angleDiff(intendYaw, s.yaw), rate);
    s.pitch += clampAbs(intendPitch - s.pitch, rate);
  }
  return { yaw: intendYaw, pitch: intendPitch };
}

/** A shot was fired: the climb it adds (degrees). */
export function addRecoil(s: AimState, verticalDeg: number, burstControl: number): void {
  s.recoil += verticalDeg * (1 - burstControl) * 0.8;
}

/** Angle (degrees) between the current view and a direction. */
export function offDeg(s: AimState, yaw: number, pitch: number): number {
  return Math.hypot(angleDiff(yaw, s.yaw), pitch - s.pitch) / DEG;
}

/** Firing tolerance (degrees) at distance `d`: about half a body's width plus a little. */
export const toleranceDeg = (d: number, tight = 1) => (Math.atan2(0.3 * tight, Math.max(0.5, d)) / DEG) + 0.35 * tight;

export function angleDiff(a: number, b: number): number {
  let d = a - b;
  d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
  return d;
}

export const clampAbs = (v: number, max: number) => (v > max ? max : v < -max ? -max : v);

/** Turn `from` toward `to` (radians) by at most `rate`. */
export const turnToward = (from: number, to: number, rate: number) => from + clampAbs(angleDiff(to, from), rate);
