/**
 * Ping-based room clock: estimates the server's room time now from `ping`/`pong` round trips
 * (room time at the server + half the round trip), using the quickest recent samples, which are
 * the least distorted by queuing. Pure (no DOM): pass the local time in seconds.
 */
export class ClockSync {
  private samples: { rtt: number; offset: number }[] = [];
  /** Smoothed round trip, seconds. */
  rtt = 0;
  /** roomTime = local + offset (null until the first sample). */
  offset: number | null = null;

  reset(): void {
    this.samples = [];
    this.offset = null;
    this.rtt = 0;
  }

  /** A pong for a ping sent at local time `t0`, carrying the server's room time. */
  onPong(t0: number, serverTime: number, now: number): void {
    const rtt = Math.max(0, now - t0);
    this.samples.push({ rtt, offset: serverTime + rtt / 2 - now });
    if (this.samples.length > 12) this.samples.shift();
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(1, Math.ceil(this.samples.length / 3)));
    const offset = best.reduce((s, x) => s + x.offset, 0) / best.length;
    // Small corrections glide, big ones (first sample, server hiccup) jump.
    this.offset = this.offset === null || Math.abs(offset - this.offset) > 0.25 ? offset : this.offset + (offset - this.offset) * 0.3;
    this.rtt = this.rtt === 0 ? rtt : this.rtt * 0.8 + rtt * 0.2;
  }

  /** Before any pong: a snapshot is at least this recent (it was sent at `serverTime`). */
  onSnapshot(serverTime: number, now: number): void {
    const lower = serverTime - now;
    if (this.offset === null || this.offset < lower) this.offset = lower;
  }

  /** Estimated room time now. */
  now(local: number): number {
    return local + (this.offset ?? 0);
  }
}
