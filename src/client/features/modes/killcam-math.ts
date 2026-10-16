/**
 * Pure helpers of the killcam replays (both the final killcam and the per-death one): pose
 * interpolation between the 20 Hz frames, and which recorded projectile a kill should follow.
 *
 * Poses are a Catmull-Rom spline through the frames (positions and view angles; yaw the short way
 * round), so a 20 Hz recording replays without the corners and speed jumps of a straight line,
 * even at BO1's 0.25x slow motion. A jump between two frames (a respawn) is not interpolated.
 */
import type { ProjectileTrack } from '../../../shared/defs/deathcam';
import type { KillcamFrame } from '../../../shared/defs/modestate';

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  f: number;
  /** Health % (frames from before it was recorded read as 100). */
  hp: number;
  /** The weapon in their hands (gearKey), if recorded. */
  gear?: string;
  /** Winter's Howl frost %, 0 when none. */
  frost: number;
}

type Row = KillcamFrame['p'][number];

/** Further than this between two frames (50 ms) is a teleport (respawn), not movement. */
const JUMP_M = 3;

const wrap = (a: number) => {
  let d = a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** Catmull-Rom between p1 and p2 at k (uniform). */
function spline(p0: number, p1: number, p2: number, p3: number, k: number): number {
  const k2 = k * k;
  const k3 = k2 * k;
  return 0.5 * (2 * p1 + (-p0 + p2) * k + (2 * p0 - 5 * p1 + 4 * p2 - p3) * k2 + (-p0 + 3 * p1 - 3 * p2 + p3) * k3);
}

const far = (a: Row, b: Row) => Math.hypot(a[1] - b[1], a[2] - b[2], a[3] - b[3]) > JUMP_M;

function poseOf(r: Row): Pose {
  return { x: r[1], y: r[2], z: r[3], yaw: r[4], pitch: r[5], f: r[6], hp: r[7] ?? 100, gear: r[8], frost: r[9] ?? 0 };
}

/** Index of the frame at or before `t` (0 before the first; the second-last at or after the last). */
function segmentAt(frames: readonly KillcamFrame[], t: number): number {
  let lo = 0;
  let hi = frames.length - 2;
  if (hi <= 0) return 0;
  if (t >= frames[hi]!.t) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid]!.t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Every player's pose at clip time `t`. Past the last frame it holds the last one (the final
 * killcam's frames stop at the match end). `hold`: players to keep at their last recorded pose
 * once they drop out of the frames (a killer or victim who left the match).
 */
export function posesAt(frames: readonly KillcamFrame[], t: number, hold?: ReadonlySet<string>): Map<string, Pose> {
  const out = new Map<string, Pose>();
  if (!frames.length) return out;
  const i = segmentAt(frames, t);
  const a = frames[i]!;
  const b = frames[Math.min(i + 1, frames.length - 1)]!;
  const k = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
  const before = frames[i - 1];
  const after = frames[i + 2];
  const find = (f: KillcamFrame | undefined, id: string) => f?.p.find((p) => p[0] === id);
  for (const p1 of a.p) {
    const id = p1[0];
    const p2 = find(b, id) ?? p1;
    if (far(p1, p2)) {
      out.set(id, poseOf(k < 0.5 ? p1 : p2));
      continue;
    }
    let p0 = find(before, id) ?? p1;
    let p3 = find(after, id) ?? p2;
    if (far(p0, p1)) p0 = p1;
    if (far(p2, p3)) p3 = p2;
    const y1 = p1[4];
    const y0 = y1 + wrap(p0[4] - y1);
    const y2 = y1 + wrap(p2[4] - y1);
    const y3 = y2 + wrap(p3[4] - p2[4]);
    const near = k < 0.5 ? p1 : p2;
    out.set(id, {
      x: spline(p0[1], p1[1], p2[1], p3[1], k),
      y: spline(p0[2], p1[2], p2[2], p3[2], k),
      z: spline(p0[3], p1[3], p2[3], p3[3], k),
      yaw: spline(y0, y1, y2, y3, k),
      pitch: spline(p0[5], p1[5], p2[5], p3[5], k),
      f: near[6],
      hp: p1[7] ?? 100,
      gear: near[8],
      frost: (p1[9] ?? 0) + ((p2[9] ?? 0) - (p1[9] ?? 0)) * k,
    });
  }
  if (hold?.size) {
    for (const id of hold) {
      if (out.has(id)) continue;
      for (let j = Math.min(i, frames.length - 1); j >= 0; j--) {
        const r = find(frames[j], id);
        if (r) {
          out.set(id, poseOf(r));
          break;
        }
      }
    }
  }
  return out;
}

/**
 * The projectile a kill should be watched from (BO1's killcam follows grenades, launcher rounds
 * and thrown weapons): the killer's projectile whose flight ended at the kill (within `slack`),
 * closest to where the victim was. Null when the kill wasn't one (a gun kill).
 */
export function killProjectile(tracks: readonly ProjectileTrack[], killer: string, at: number, victim: { x: number; y: number; z: number } | null, slack = 0.6): ProjectileTrack | null {
  let best: ProjectileTrack | null = null;
  let bd = Infinity;
  for (const tr of tracks) {
    if (tr.owner !== killer || tr.points.length < 2) continue;
    const last = tr.points.at(-1)!;
    const first = tr.points[0]!;
    if (first.t > at + 0.05 || last.t < at - slack || last.t > at + 0.2) continue;
    const d = victim ? Math.hypot(last.x - victim.x, last.y - victim.y, last.z - victim.z) : 0;
    if (d < bd && d < 20) {
      bd = d;
      best = tr;
    }
  }
  return best;
}

/** Where a projectile was at `t` and its heading (unit), or null outside its flight. */
export function projectileAt(tr: ProjectileTrack, t: number): { x: number; y: number; z: number; dx: number; dy: number; dz: number } | null {
  const pts = tr.points;
  if (!pts.length || t < pts[0]!.t || t > pts.at(-1)!.t) return null;
  let i = 0;
  while (i < pts.length - 2 && pts[i + 1]!.t <= t) i++;
  const a = pts[i]!;
  const b = pts[Math.min(i + 1, pts.length - 1)]!;
  const k = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let dz = b.z - a.z;
  const n = Math.hypot(dx, dy, dz);
  if (n > 1e-4) {
    dx /= n;
    dy /= n;
    dz /= n;
  } else {
    dx = 0;
    dy = 0;
    dz = -1;
  }
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, dx, dy, dz };
}
