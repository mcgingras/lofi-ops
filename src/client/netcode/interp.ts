/**
 * Remote players drawn INTERP_DELAY_MS behind, blended between the two snapshots around that
 * moment (pattern from Blockyard's FrameBuffer, MIT). Playback time follows the snapshots' own
 * room-time stamps against the quickest delivery seen, so network jitter doesn't show, and it
 * never runs backwards. Pure (no DOM): pass local time in seconds.
 */
import { INTERP_DELAY_MS } from '../../shared/constants';
import type { PlayerSnap } from '../../shared/protocol';

export interface InterpPlayer extends PlayerSnap {
  /** True when this sample is extrapolated past the newest snapshot. */
  extrapolated: boolean;
}

interface Timed {
  time: number;
  players: Map<string, PlayerSnap>;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export class SnapshotBuffer {
  private snaps: Timed[] = [];
  /** Local seconds minus room seconds for the quickest delivery seen (drifts up slowly). */
  private offset: number | null = null;
  private shown = -Infinity;

  constructor(
    private delay = INTERP_DELAY_MS / 1000,
    /** Furthest past the newest snapshot we extrapolate (seconds). */
    private maxExtrapolate = 0.1,
  ) {}

  reset(): void {
    this.snaps = [];
    this.offset = null;
    this.shown = -Infinity;
  }

  push(time: number, players: PlayerSnap[], now: number): void {
    const last = this.snaps[this.snaps.length - 1];
    if (last && time <= last.time) {
      if (time < last.time - 1) this.reset(); // room time restarted (new room)
      else return;
    }
    const off = now - time;
    this.offset = this.offset === null ? off : Math.min(off, this.offset + 0.0005);
    this.snaps.push({ time, players: new Map(players.map((p) => [p.id, p])) });
    if (this.snaps.length > 40) this.snaps.shift();
  }

  /** Room time remote players are drawn at now (monotonic). Send it as `fire.time`. */
  renderTime(now: number): number {
    if (this.offset === null) return 0;
    this.shown = Math.max(this.shown, now - this.offset - this.delay);
    return this.shown;
  }

  get newestTime(): number {
    return this.snaps[this.snaps.length - 1]?.time ?? 0;
  }

  /** All player ids present around time t. */
  ids(t: number): string[] {
    const [a, b] = this.bracket(t);
    const ids = new Set<string>();
    if (b) for (const id of b.players.keys()) ids.add(id);
    else if (a) for (const id of a.players.keys()) ids.add(id);
    return [...ids];
  }

  private bracket(t: number): [Timed | undefined, Timed | undefined] {
    const s = this.snaps;
    // Drop snapshots entirely in the past (keep the one just before t).
    while (s.length > 2 && s[1]!.time <= t) s.shift();
    if (!s.length) return [undefined, undefined];
    const last = s[s.length - 1]!;
    if (t >= last.time) return [last, undefined];
    if (t <= s[0]!.time || s.length === 1) return [s[0], undefined];
    return [s[0], s[1]];
  }

  /** A player's interpolated state at room time t, or null if not present. */
  sample(id: string, t: number): InterpPlayer | null {
    const [a, b] = this.bracket(t);
    if (!a) return null;
    const pa = a.players.get(id);
    if (!b) {
      if (!pa) return null;
      const ex = Math.max(0, Math.min(this.maxExtrapolate, t - a.time));
      return ex > 0 && pa.f & 1 ? { ...pa, x: pa.x + pa.vx * ex, z: pa.z + pa.vz * ex, extrapolated: true } : { ...pa, extrapolated: false };
    }
    const pb = b.players.get(id);
    if (!pb) return null;
    if (!pa) return { ...pb, extrapolated: false };
    const k = Math.max(0, Math.min(1, (t - a.time) / Math.max(1e-6, b.time - a.time)));
    // A teleport (respawn) should not slide across the map.
    const jump = Math.hypot(pb.x - pa.x, pb.z - pa.z) > 4;
    if (jump) return { ...(k < 0.5 ? pa : pb), extrapolated: false };
    return {
      ...pb,
      x: lerp(pa.x, pb.x, k),
      y: lerp(pa.y, pb.y, k),
      z: lerp(pa.z, pb.z, k),
      vx: lerp(pa.vx, pb.vx, k),
      vy: lerp(pa.vy, pb.vy, k),
      vz: lerp(pa.vz, pb.vz, k),
      yaw: lerpAngle(pa.yaw, pb.yaw, k),
      pitch: lerp(pa.pitch, pb.pitch, k),
      f: k < 0.5 ? pa.f : pb.f,
      extrapolated: false,
    };
  }
}
