/**
 * Camera effects timing (pure): explosion shake and concussion wobble strength at room time `now`.
 * Times are room times, so an effect stamped in another room (whose clock was further along)
 * reads as being in the future; it must count as over, not as an ever-growing shake.
 */
export interface ShakeState {
  at: number;
  amount: number;
}
export interface StunState extends ShakeState {
  dur: number;
}

/** Positional/roll jitter amplitude of an explosion shake (0 when none). */
export function shakeAmplitude(now: number, s: ShakeState): number {
  const t = now - s.at;
  return t >= 0 && t < 0.5 ? s.amount * (1 - t / 0.5) * 0.03 : 0;
}

/** Concussion strength 0..amount, fading over the last 1.2 s (0 when none). */
export function stunStrength(now: number, s: StunState): number {
  const t = now - s.at;
  return t >= 0 && t < s.dur ? s.amount * Math.min(1, (s.dur - t) / 1.2) : 0;
}
