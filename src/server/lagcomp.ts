/**
 * Lag compensation: a ring buffer of every player's hitbox pose per tick. A shot is checked
 * against where targets were on the shooter's screen (they draw others INTERP_DELAY_MS in the
 * past), rewound no further than MAX_REWIND_MS.
 */
import { HISTORY_SEC, MAX_REWIND_MS, TICK_RATE } from '../shared/constants';

export interface Pose {
  x: number;
  y: number;
  z: number;
  crouched: boolean;
  alive: boolean;
  /** Lying down (prone hitboxes along `yaw`). */
  prone?: boolean;
  /** Facing (prone hitboxes lie along it). */
  yaw?: number;
}

interface Frame {
  time: number;
  poses: Map<string, Pose>;
}

const lerpAngle = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export class HitboxHistory {
  private frames: (Frame | undefined)[];
  private head = 0;
  private count = 0;

  constructor(seconds = HISTORY_SEC, rate = TICK_RATE) {
    this.frames = new Array(Math.ceil(seconds * rate) + 2);
  }

  record(time: number, poses: Iterable<[string, Pose]>): void {
    const frame: Frame = { time, poses: new Map() };
    for (const [id, p] of poses) frame.poses.set(id, { x: p.x, y: p.y, z: p.z, crouched: p.crouched, alive: p.alive, prone: !!p.prone, yaw: p.yaw ?? 0 });
    this.frames[this.head] = frame;
    this.head = (this.head + 1) % this.frames.length;
    this.count = Math.min(this.count + 1, this.frames.length);
  }

  clear(): void {
    this.frames.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  /** i-th most recent frame (0 = newest). */
  private frame(i: number): Frame | undefined {
    if (i >= this.count) return undefined;
    return this.frames[(this.head - 1 - i + this.frames.length * 2) % this.frames.length];
  }

  get newestTime(): number | null {
    return this.frame(0)?.time ?? null;
  }

  /** Clamp a requested view time into [now - maxRewind, now]. */
  static clampTime(time: number, now: number, maxRewindSec = MAX_REWIND_MS / 1000): number {
    if (!Number.isFinite(time)) return now;
    return Math.max(now - maxRewindSec, Math.min(now, time));
  }

  /** One player's pose at `time`, interpolated between the ticks around it (null if unknown). */
  poseAt(id: string, time: number): Pose | null {
    let newer: Frame | undefined;
    for (let i = 0; i < this.count; i++) {
      const f = this.frame(i)!;
      if (f.time <= time) {
        const a = f.poses.get(id);
        const b = newer?.poses.get(id);
        if (!a) return b ?? null;
        if (!b || !newer || f.time === time) return a;
        const k = (time - f.time) / (newer.time - f.time);
        return {
          x: a.x + (b.x - a.x) * k,
          y: a.y + (b.y - a.y) * k,
          z: a.z + (b.z - a.z) * k,
          crouched: k < 0.5 ? a.crouched : b.crouched,
          alive: a.alive && b.alive,
          prone: k < 0.5 ? a.prone : b.prone,
          yaw: lerpAngle(a.yaw ?? 0, b.yaw ?? 0, k),
        };
      }
      newer = f;
    }
    // Older than everything kept: the oldest pose we have.
    return newer?.poses.get(id) ?? null;
  }

  /** Every player's pose at `time` (already clamped by the caller). */
  rewind(time: number): Map<string, Pose> {
    const out = new Map<string, Pose>();
    const ids = new Set<string>();
    const newest = this.frame(0);
    if (!newest) return out;
    for (const id of newest.poses.keys()) ids.add(id);
    for (const id of ids) {
      const p = this.poseAt(id, time);
      if (p) out.set(id, p);
    }
    return out;
  }
}
