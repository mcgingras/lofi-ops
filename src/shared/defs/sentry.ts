/**
 * Sentry Gun tuning and targeting maths (owner: perks-streaks). Sources: BO1's
 * `maps/mp/_turret_killstreak.gsc` and `maps/mp/_mgturret.gsc` (T5 script dump,
 * plutoniummod/t5-scripts) and the Call of Duty Wiki "Sentry Gun" page (Black Ops section); see
 * docs/features/perks-streaks.md for what BO1 did and why these numbers.
 *
 * Pure and shared: the server runs the turret with it, the tests check it, and the client reads the
 * arc and the timings for its cues.
 */
import { clamp } from '../math';

export const SENTRY = {
  /** Seconds it runs once placed (BO1 `level.auto_turret_timeout` 90; shorter here: it was too strong). Paused while carried. */
  durationSec: 60,
  /** Hit points. BO1: 1000 with bullets doing 30% (`bulletDamageReduction` 0.3); see the scales. */
  hp: 500,
  /** Bullet damage taken x this (BO1 0.3 on 1000 hp: ~80 rifle bullets; ours ~16). */
  bulletScale: 0.8,
  /** Explosive damage taken x this (grenades, launcher rounds, streak blasts). */
  explosiveScale: 2,
  /** After it is put down it waits this long before it may shoot (BO1 `turretInitDelay` 1.0). */
  armSec: 1,
  /** A newly seen enemy: it turns on and tracks, but holds fire this long (BO1 alert + `convergenceTime`). */
  acquireSec: 0.6,
  /** Lost sight of its target for this long: it lets go (seeing them again starts a new acquisition). */
  loseSec: 0.3,
  /** Head turn rate (rad/s) while tracking. */
  turnRate: 1.75,
  /** Idle sweep across its arc (rad/s). */
  scanRate: 0.6,
  /** Half its firing arc either side of the way it was placed facing (rad). */
  arcHalf: Math.PI / 3,
  /** Aligned enough to fire: within this of the target (rad). */
  fireCone: 0.06,
  /** Targets beyond this aren't engaged (m). */
  range: 35,
  /** Bullets: one per 0.112 s while a burst runs (`_mgturret.gsc` `do_shoot`). */
  fireInterval: 0.112,
  /** Bursts (`burst_fire_unmanned`): fires 0.5 + rand(0..4) s, pauses 0.2 + rand(0..0.5) s. */
  burst: { min: 0.5, range: 4 },
  pause: { min: 0.2, range: 0.5 },
  /** Damage per bullet: `near` up to `nearRange`, falling to `far` at `farRange` (m). */
  damage: { near: 20, far: 12, nearRange: 8, farRange: 30 },
  /** Chance a bullet hits: `near` up to `nearRange`, falling to `far` at `range` (m). */
  hit: { near: 0.85, far: 0.2, nearRange: 6 },
  /** Flashbang / concussion: stunned this long (BO1 `stunDuration` 5). */
  stunSec: 5,
  /** A hacked turret is out this long before it works for its new owner (BO1 `stunTurret(2.5)`). */
  hackStunSec: 2.5,
  /** Muzzle height above its feet (m). */
  muzzle: 1.0,
  /** Hit sphere: radius and centre height (m). */
  radius: 0.6,
  yOff: 0.75,
  /** Knife reach to it (m), from the attacker's feet. */
  knifeReach: 1.9,
} as const;

/** Smallest signed difference a - b, in (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Is a target at bearing `yawTo` inside the arc of a sentry placed facing `baseYaw`? */
export function inSentryArc(baseYaw: number, yawTo: number, arcHalf: number = SENTRY.arcHalf): boolean {
  return Math.abs(angleDiff(yawTo, baseYaw)) <= arcHalf + 1e-9;
}

/**
 * Turn the head from `yaw` toward `want` by at most `rate * dt`, never leaving the arc around
 * `baseYaw` (the head can't point behind it). Returns the new yaw.
 */
export function sentryTurn(yaw: number, want: number, baseYaw: number, dt: number, rate: number = SENTRY.turnRate, arcHalf: number = SENTRY.arcHalf): number {
  const cur = clamp(angleDiff(yaw, baseYaw), -arcHalf, arcHalf);
  const goal = clamp(angleDiff(want, baseYaw), -arcHalf, arcHalf);
  const step = rate * dt;
  const next = cur + clamp(goal - cur, -step, step);
  return baseYaw + next;
}

/** Damage of one sentry bullet at `dist` metres. */
export function sentryDamage(dist: number): number {
  const d = SENTRY.damage;
  if (dist <= d.nearRange) return d.near;
  if (dist >= d.farRange) return d.far;
  return d.near + ((d.far - d.near) * (dist - d.nearRange)) / (d.farRange - d.nearRange);
}

/** Chance one sentry bullet hits a target at `dist` metres (accuracy falls off with distance). */
export function sentryHitChance(dist: number): number {
  const h = SENTRY.hit;
  if (dist <= h.nearRange) return h.near;
  if (dist >= SENTRY.range) return h.far;
  return h.near + ((h.far - h.near) * (dist - h.nearRange)) / (SENTRY.range - h.nearRange);
}
