/**
 * Final killcam (owner: modes), shared by server and client: BO1's timing, the slow-motion
 * timeline and the wire payload (`modes.killcam`, sent to everyone at match end).
 *
 * BO1 (T5 scripts, maps/mp/gametypes/_killcam.gsc):
 * - `finalKillcam()` replays `calcKillcamTime(..., respawn = false)` = 5 s before the death and
 *   `calcPostDelay()` = 2 s after it.
 * - `waitFinalKillcamSlowdown()`: `SetTimeScale(0.25, deathTime - 500)` and back to 1.0 half a
 *   second after a 3 s wait that started 2 s before the death: 0.25x from 0.5 s before the kill to
 *   1.5 s after it.
 * - It is not skippable (no `waitSkipKillcamButton` thread, unlike the per-death killcam).
 * - Which kill (`_globallogic_player.gsc`): a death checks `game["state"]` after the 0.25 s + 1.75 s
 *   death delay, so the kill that ended the match, or one within 2 s of the end, becomes the final
 *   killcam (`startFinalKillcam`); a match that ends later than that on time or an objective has
 *   none, except S&D eliminations (`sd_endGameWithKillcam`), which are kills anyway.
 * MW3 (Kill Confirmed and Infected come from it) shows the last kill by the winning team
 * (Call of Duty Wiki, "KillCam").
 *
 * The clip uses the per-death killcam's compact encoding (PackedClip); frames stop at the match
 * end (everyone is frozen and dead after it), and the replay holds the last frame up to `to`.
 */
import type { CamTrack, KillerCard, PackedClip } from './deathcam';

export const FINAL_KILLCAM = {
  /** Replay before the kill (BO1 calcKillcamTime without respawn). */
  beforeSec: 5,
  /** Replay after the kill (BO1 calcPostDelay). */
  afterSec: 2,
  /** Slow motion from this long before the kill... */
  slowBeforeSec: 0.5,
  /** ...to this long after it... */
  slowAfterSec: 1.5,
  /** ...at this speed (BO1 SetTimeScale 0.25). */
  slowRate: 0.25,
  /** Seconds (real) to ease into and out of the slow motion. */
  rampSec: 0.2,
  /** BO1 rule: a kill at most this long before the end is the final killcam (0.25 + 1.75 s death delay). */
  recentSec: 2,
  /** Shorter clips than this aren't shown. */
  minSec: 1,
  /** Fade from black at the start, to black at the end, and the black held before the summary (real seconds). */
  fadeInSec: 0.35,
  fadeOutSec: 0.5,
  holdSec: 0.4,
  /** Rooms with a post-match shorter than this don't wait for the killcam (tests, quick rotations). */
  minPostMatchSec: 5,
  /** Players further than this from both the killer and the victim at the kill are left out. */
  nearM: 50,
  maxPlayers: 12,
} as const;
export type FinalKillcamTuning = { [K in keyof typeof FINAL_KILLCAM]: number };

/** Modes whose final killcam is MW3's: the last kill by the winning team, however long ago. */
export const WINNING_TEAM_KILLCAM_MODES: ReadonlySet<string> = new Set(['kc', 'infected']);

export interface FinalKillcamPayload {
  killer: string;
  victim: string;
  weapon: string;
  means: string;
  headshot: boolean;
  /** Room time of the kill. */
  at: number;
  /** Clip time the replay ends (at + afterSec); frames stop at the match end and hold from there. */
  to: number;
  card: KillerCard;
  /** Victim's name (they may have left by the time it plays). */
  vname: string;
  /** 'eyes' = the killer's view with their gun; 'streak' = from the killstreak (`cam`). */
  view: 'eyes' | 'streak';
  cam?: { x: number; y: number; z: number; top: boolean; track?: CamTrack };
  /** The gun in the killer's hands at the kill. */
  vm?: { weapon: string; attachments: string[]; camo: string; suppressed: boolean };
  clip: PackedClip;
  /**
   * Room time the post-match (or, for a round killcam, the post-round) now ends: the server waits
   * for the killcam. Null if unchanged.
   */
  endsAt: number | null;
  /** Set for S&D's end-of-round killcam (BO1 `round_end_killcam`): the round it ended. */
  round?: number;
}

/** One stretch of the timeline: speed `a` -> `b` (linear in real time) over `d` real seconds, clip `c0` -> `c1`. */
interface Seg {
  a: number;
  b: number;
  d: number;
  c0: number;
  c1: number;
}

const clipIn = (s: Seg, tau: number) => s.c0 + s.a * tau + ((s.b - s.a) * tau * tau) / (2 * Math.max(1e-9, s.d));
/** Real seconds into `s` at which it reaches clip time `c`. */
function realIn(s: Seg, c: number): number {
  const dc = c - s.c0;
  if (Math.abs(s.b - s.a) < 1e-9) return dc / s.a;
  const k = (s.b - s.a) / (2 * s.d);
  const disc = Math.max(0, s.a * s.a + 4 * k * dc);
  return (-s.a + Math.sqrt(disc)) / (2 * k);
}
/** The part of `s` between clip times x and y. */
function cut(s: Seg, x: number, y: number): Seg {
  const tx = realIn(s, x);
  const ty = realIn(s, y);
  const speed = (tau: number) => s.a + ((s.b - s.a) * tau) / Math.max(1e-9, s.d);
  return { a: speed(tx), b: speed(ty), d: Math.max(0, ty - tx), c0: x, c1: y };
}

export interface FinalTimeline {
  /** Real seconds the replay takes (without the black hold). */
  realSec: number;
  /** Clip (room) time at `real` seconds into the replay. */
  clipAt(real: number): number;
  /** Playback speed at `real` seconds (1 = real time, 0.25 = BO1 slow motion). */
  rateAt(real: number): number;
}

/**
 * The final killcam's clock: 1x, easing into `slowRate` around the kill (half-way down at
 * `at - slowBeforeSec`, half-way back up at `at + slowAfterSec`), 1x to the end. A clip that starts
 * or ends inside the slow stretch keeps just its part of it.
 */
export function finalTimeline(from: number, to: number, at: number, k: FinalKillcamTuning = FINAL_KILLCAM): FinalTimeline {
  const s = k.slowRate;
  const R = k.rampSec;
  const span = (R * (1 + s)) / 2; // clip covered by one ramp
  const d1 = at - k.slowBeforeSec - span / 2;
  const d2 = d1 + span;
  const u1 = Math.max(d2, at + k.slowAfterSec - span / 2);
  const u2 = u1 + span;
  const full: Seg[] = [
    { a: 1, b: 1, d: Math.max(0, d1 - Math.min(from, d1)), c0: Math.min(from, d1), c1: d1 },
    { a: 1, b: s, d: R, c0: d1, c1: d2 },
    { a: s, b: s, d: (u1 - d2) / s, c0: d2, c1: u1 },
    { a: s, b: 1, d: R, c0: u1, c1: u2 },
    { a: 1, b: 1, d: Math.max(0, Math.max(to, u2) - u2), c0: u2, c1: Math.max(to, u2) },
  ];
  const segs: Seg[] = [];
  for (const g of full) {
    const x = Math.max(g.c0, from);
    const y = Math.min(g.c1, to);
    if (y - x > 1e-9) segs.push(cut(g, x, y));
  }
  const realSec = segs.reduce((n, g) => n + g.d, 0);
  const find = (real: number): { g: Seg; tau: number } | null => {
    let r = Math.max(0, real);
    for (const g of segs) {
      if (r <= g.d) return { g, tau: r };
      r -= g.d;
    }
    return null;
  };
  return {
    realSec,
    clipAt(real) {
      const f = find(real);
      return f ? clipIn(f.g, f.tau) : to;
    },
    rateAt(real) {
      const f = find(real);
      if (!f) return 1;
      return f.g.a + ((f.g.b - f.g.a) * f.tau) / Math.max(1e-9, f.g.d);
    },
  };
}

/** Real seconds the whole final killcam takes on screen (replay + the black hold before the summary). */
export const finalKillcamSeconds = (from: number, to: number, at: number, k: FinalKillcamTuning = FINAL_KILLCAM) => finalTimeline(from, to, at, k).realSec + k.holdSec;

/** Where the final killcam is, `elapsed` real seconds in: clip time, speed, fade (0 clear .. 1 black), done. */
export function finalClock(tl: FinalTimeline, elapsed: number, k: FinalKillcamTuning = FINAL_KILLCAM): { t: number; rate: number; fade: number; done: boolean } {
  const real = tl.realSec;
  const t = tl.clipAt(Math.min(elapsed, real));
  const rate = elapsed < real ? tl.rateAt(elapsed) : 1;
  let fade = 0;
  if (elapsed < k.fadeInSec) fade = 1 - elapsed / k.fadeInSec;
  else if (elapsed >= real) fade = 1;
  else if (elapsed > real - k.fadeOutSec) fade = (elapsed - (real - k.fadeOutSec)) / k.fadeOutSec;
  return { t, rate, fade: Math.max(0, Math.min(1, fade)), done: elapsed >= real + k.holdSec };
}
