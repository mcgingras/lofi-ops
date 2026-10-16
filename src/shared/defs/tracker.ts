/**
 * Tracker perk (owner: perks-streaks; tier 3): see enemy footprints for a few seconds.
 *
 * The server samples enemies within `radius` of each Tracker player every `sampleSec` (no line of
 * sight needed: that's the point) and sends a footprint for each one that moved at least `stepM`
 * since its last print, to the Tracker player only (`perks.tracks`). Positions are quantised to
 * `quantM` and the yaw to 256 steps; at most `maxPerMsg` prints go out per sample (nearest first),
 * so the stream stays under ~1 KB/s. The client draws glowing boot prints that fade over `fadeSec`.
 *
 * Pro: also the footprints of enemies within `radius` of your teammates.
 * Counter: Ninja Pro leaves no footprints (base Ninja does). Other features can hide a target with
 * the `trackerVisible` modifier (false wins).
 *
 * Pure data and maths, shared by the server, the client and the tests.
 */

export const TRACKER = {
  /** Enemies within this of the Tracker player (Pro: or of a teammate) leave prints for them (m). */
  radius: 25,
  /** Seconds between samples. */
  sampleSec: 0.4,
  /** A new print only after the enemy moved this far since their last one (m). */
  stepM: 0.5,
  /** Position quantisation (m). */
  quantM: 0.1,
  /** Max prints per message (nearest first). */
  maxPerMsg: 12,
  /** Seconds a print stays visible (fading out over the last part). */
  fadeSec: 3.5,
  /** Kills of an enemy whose prints you were shown this recently count toward Tracker Pro (s). */
  proKillWindow: 4,
} as const;

/** One footprint: feet position (m) and walking direction (rad, yaw 0 = -z). */
export interface Footprint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** `perks.tracks`: flat quantised prints, 4 ints each: x, y, z (in `quantM`), yaw (0..255). */
export interface TracksMsg {
  f: number[];
}

declare module '../protocol' {
  interface FeatureMessages {
    /** To a Tracker player only: fresh enemy footprints. */
    'perks.tracks': TracksMsg;
  }
}

const TAU = Math.PI * 2;

/** Quantise prints for the wire. */
export function packTracks(prints: readonly Footprint[]): TracksMsg {
  const f: number[] = [];
  const q = (v: number) => Math.round(v / TRACKER.quantM);
  for (const p of prints) f.push(q(p.x), q(p.y), q(p.z), ((Math.round((p.yaw / TAU) * 256) % 256) + 256) % 256);
  return { f };
}

/** Back to metres and radians (malformed tails are dropped). */
export function unpackTracks(msg: TracksMsg): Footprint[] {
  const out: Footprint[] = [];
  const f = Array.isArray(msg?.f) ? msg.f : [];
  for (let i = 0; i + 3 < f.length; i += 4) {
    const [x, y, z, a] = [f[i]!, f[i + 1]!, f[i + 2]!, f[i + 3]!];
    if (![x, y, z, a].every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
    out.push({ x: x * TRACKER.quantM, y: y * TRACKER.quantM, z: z * TRACKER.quantM, yaw: (a / 256) * TAU });
  }
  return out;
}

/** Opacity 0..1 of a print `age` seconds old (full, then fading over the last 60%). */
export function printAlpha(age: number): number {
  if (age < 0 || age >= TRACKER.fadeSec) return 0;
  const fadeFrom = TRACKER.fadeSec * 0.4;
  return age <= fadeFrom ? 1 : 1 - (age - fadeFrom) / (TRACKER.fadeSec - fadeFrom);
}
