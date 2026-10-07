/** Pure helpers of the final killcam playback (timeline and pose interpolation). */
import type { KillcamFrame } from '../../../shared/defs/modestate';

/** Seconds of the clip played in slow motion, its speed, and the hold after the kill. */
export const SLOW_SEC = 0.6;
export const SLOW_RATE = 0.35;
export const HOLD_SEC = 1.2;

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  f: number;
  /** Health % (frames from before it was recorded read as 100). */
  hp: number;
}

/** Clip time for real seconds since the start (1x, then slow motion near the kill). */
export function clipTime(elapsed: number, span: number): number {
  const a = Math.max(0, span - SLOW_SEC);
  return elapsed < a ? elapsed : Math.min(span, a + (elapsed - a) * SLOW_RATE);
}

/** Total real seconds a clip of `span` plays (including the hold). */
export const playSeconds = (span: number) => Math.max(0, span - SLOW_SEC) + Math.min(span, SLOW_SEC) / SLOW_RATE + HOLD_SEC;

/** Every player's pose at clip time `t` (linear between frames; flags from the earlier one). */
export function posesAt(frames: KillcamFrame[], t: number): Map<string, Pose> {
  const out = new Map<string, Pose>();
  if (!frames.length) return out;
  let i = 0;
  while (i < frames.length - 2 && frames[i + 1]!.t <= t) i++;
  const a = frames[i]!;
  const b = frames[Math.min(i + 1, frames.length - 1)]!;
  const k = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
  const bm = new Map(b.p.map((p) => [p[0], p] as const));
  for (const p of a.p) {
    const q = bm.get(p[0]) ?? p;
    let dy = q[4] - p[4];
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    out.set(p[0], { x: p[1] + (q[1] - p[1]) * k, y: p[2] + (q[2] - p[2]) * k, z: p[3] + (q[3] - p[3]) * k, yaw: p[4] + dy * k, pitch: p[5] + (q[5] - p[5]) * k, f: k < 0.5 ? p[6] : q[6], hp: p[7] ?? 100 });
  }
  return out;
}
