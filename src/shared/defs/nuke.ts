/**
 * The Tactical Nuke's timeline (owner: perks-streaks), shared so the server's kills and the client's
 * countdown, flash, slow motion and shockwave run off the same numbers. All times are room time.
 *
 *   called ── laptop ──> a (countdown starts, everyone sees 10..1) ── 10 s ──> d (detonation)
 *   d: white flash, mushroom cloud on the horizon, slow motion (movement x0.35)
 *   d + 2 s .. d + 4 s: the shockwave rolls over the map from the blast, killing players nearest first
 *   d + 5.5 s: the match ends ('nuke'), a win for the caller's team (FFA: the caller)
 *
 * MW2 reference (Call of Duty Wiki "Tactical Nuke"): 25 kills (24 with Hardline), a ten-second
 * countdown on every screen with a siren, then the battlefield goes white, time slows, killstreaks
 * explode and every player dies, nearest to the blast first; the bomb lands off the map. Scores
 * freeze once it is called and the match is a win for the caller's side whatever the score.
 */

export const NUKE = {
  id: 'nuke',
  /** The caller works the laptop before the countdown starts (weapon down). */
  laptopSec: 1.5,
  countdownSec: 10,
  /** Detonation to the shockwave reaching the nearest player. */
  shockDelaySec: 2,
  /** Nearest to farthest player. */
  shockSpreadSec: 2,
  /** Detonation to the match end (the summary). */
  endDelaySec: 5.5,
  /** Slow motion after detonation: how long, and the movement speed meanwhile. */
  slowmoSec: 4.5,
  slowmoSpeed: 0.35,
  /** Blast point: this far beyond the map's half extent, from its centre. */
  blastOut: 110,
  /** XP for calling it (the "Tactical Nuke" medal line). */
  xp: 2500,
} as const;

/** Times a nuke carries on its entity (`s`): countdown start, detonation, nearest/farthest player distances for the shockwave. */
export interface NukeTimes {
  /** Countdown start (room time). */
  a: number;
  /** Detonation (room time). */
  d: number;
  /** Shockwave: distance from the blast that is hit first / last (metres). */
  n: number;
  f: number;
}

export type NukePhase = 'arming' | 'countdown' | 'detonated';

export function nukePhase(t: number, n: Pick<NukeTimes, 'a' | 'd'>): NukePhase {
  if (t < n.a) return 'arming';
  if (t < n.d) return 'countdown';
  return 'detonated';
}

/** The big countdown number: 10 at the start, 1 in the last second, 0 once it has gone off. */
export function countdownNumber(t: number, n: Pick<NukeTimes, 'a' | 'd'>): number {
  if (t >= n.d) return 0;
  return Math.min(Math.ceil(n.d - n.a - 1e-9), Math.max(1, Math.ceil(n.d - t - 1e-9)));
}

/** Room time the shockwave reaches something `dist` metres from the blast. */
export function shockAt(dist: number, n: NukeTimes): number {
  const span = Math.max(1e-3, n.f - n.n);
  const k = Math.min(1, Math.max(0, (dist - n.n) / span));
  return n.d + NUKE.shockDelaySec + NUKE.shockSpreadSec * k;
}

/** Room time the match ends. */
export const nukeEndAt = (n: Pick<NukeTimes, 'd'>) => n.d + NUKE.endDelaySec;

/** Blast point on the horizon: `out` metres past the map's half extent from its centre, in direction `yaw` (yaw 0 = -z). */
export function blastPoint(center: { x: number; y: number; z: number }, radius: number, yaw: number, out: number = NUKE.blastOut): { x: number; y: number; z: number } {
  const r = radius + out;
  return { x: center.x - Math.sin(yaw) * r, y: center.y, z: center.z - Math.cos(yaw) * r };
}

/** Movement / animation time scale `since` seconds after detonation (slow motion, then back to normal). */
export function nukeTimeScale(since: number): number {
  if (since < 0 || since >= NUKE.slowmoSec) return 1;
  const ease = 0.4; // ramp in / out
  const k = since < ease ? since / ease : since > NUKE.slowmoSec - ease ? (NUKE.slowmoSec - since) / ease : 1;
  return 1 - (1 - NUKE.slowmoSpeed) * k;
}

/**
 * How white the screen is (0..1): the flash at detonation (full white for a beat, then easing down
 * to a washed-out view of the cloud), then white again as the shockwave reaches you (`hitSince` =
 * seconds since it did, negative before), held to the end.
 */
export function nukeWhite(since: number, hitSince: number | null = null): number {
  if (since < 0) return 0;
  let w: number;
  if (since < 0.08) w = since / 0.08;
  else if (since < 0.45) w = 1;
  else if (since < 1.9) w = 1 - 0.78 * smooth((since - 0.45) / 1.45);
  else w = 0.22 - 0.1 * Math.min(1, (since - 1.9) / 2);
  if (hitSince !== null && hitSince >= 0) w = Math.max(w, Math.min(1, hitSince / 0.5));
  return Math.max(0, Math.min(1, w));
}

/** Mushroom cloud growth 0..1 over the seconds after detonation (fast fireball, slow climb). */
export function cloudGrowth(since: number): number {
  if (since <= 0) return 0;
  return 1 - Math.pow(1 - Math.min(1, since / 6), 2.6);
}

const smooth = (k: number) => {
  const x = Math.min(1, Math.max(0, k));
  return x * x * (3 - 2 * x);
};
