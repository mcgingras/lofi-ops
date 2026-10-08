/**
 * Pure helpers for the sound engine (no WebAudio, unit-tested in tests/sfx.test.ts): variant
 * selection, per-play pitch/volume variation, the distance mix for gunfire, the per-id voice cap
 * and the decoder-delay trim.
 */

/** Next variant index out of `n`: random, never the same as `last` when there is a choice. */
export function pickVariant(n: number, last: number, rand: () => number = Math.random): number {
  if (n <= 1) return 0;
  if (last < 0 || last >= n) return Math.floor(rand() * n) % n;
  const k = Math.floor(rand() * (n - 1)) % (n - 1);
  return k >= last ? k + 1 : k;
}

/** A playback rate within +-`spread` (fraction) of `base`. */
export const jitterRate = (base: number, spread: number, rand: () => number = Math.random): number => base * (1 + (rand() * 2 - 1) * spread);

/** A gain within +-`db` decibels of `base`. */
export const jitterGain = (base: number, db: number, rand: () => number = Math.random): number => base * Math.pow(10, ((rand() * 2 - 1) * db) / 20);

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Distance (metres) where the distant gunfire layer starts to crossfade in, and where it has fully replaced the near recording. */
export const DISTANT_FROM = 40;
export const DISTANT_FULL = 90;

/**
 * Gunfire by distance (metres): the near recording is gently low-passed as it gets farther (air
 * absorption) and, only at real range, crossfades into the distant recording (equal power, so the
 * distant layer replaces the near one instead of doubling it).
 * - `lowpass`: cutoff for the near layer (null = open).
 * - `near` / `far`: gains of the near and distant layers (before the panner's own roll-off);
 *   near^2 + far^2 = 1.
 */
export function distanceMix(d: number): { lowpass: number | null; near: number; far: number } {
  const x = smoothstep(DISTANT_FROM, DISTANT_FULL, d);
  const lowpass = d <= 20 ? null : Math.max(1500, 16000 * Math.exp(-(d - 20) / 40));
  return { lowpass, near: Math.cos((x * Math.PI) / 2), far: Math.sin((x * Math.PI) / 2) };
}

/** Air absorption for any other positional sound: open up close, darker far away. */
export function airLowpass(d: number): number | null {
  return d <= 18 ? null : Math.max(1500, 18000 * Math.exp(-(d - 18) / 45));
}

/**
 * Voice bookkeeping: at most `maxPerId` voices of one id and `globalMax` overall. `add` returns the
 * voices to stop to make room (the oldest ones), which the caller fades out.
 */
export class VoicePool<V> {
  private byId = new Map<string, { v: V; t: number }[]>();
  private count = 0;

  constructor(readonly globalMax: number) {}

  get size(): number {
    return this.count;
  }

  active(id: string): number {
    return this.byId.get(id)?.length ?? 0;
  }

  add(id: string, v: V, maxPerId: number, t: number): V[] {
    const out: V[] = [];
    const list = this.byId.get(id) ?? [];
    while (list.length >= Math.max(1, maxPerId)) {
      out.push(list.shift()!.v);
      this.count--;
    }
    while (this.count >= this.globalMax) {
      let oldest: { id: string; i: number; t: number } | null = null;
      for (const [k, l] of this.byId) {
        const first = l[0];
        if (first && (!oldest || first.t < oldest.t)) oldest = { id: k, i: 0, t: first.t };
      }
      const first = list[0];
      if (first && (!oldest || first.t < oldest.t)) oldest = { id, i: 0, t: first.t };
      if (!oldest) break;
      const l = oldest.id === id ? list : this.byId.get(oldest.id)!;
      out.push(l.shift()!.v);
      this.count--;
      if (!l.length && oldest.id !== id) this.byId.delete(oldest.id);
    }
    list.push({ v, t });
    this.byId.set(id, list);
    this.count++;
    return out;
  }

  remove(id: string, v: V): void {
    const list = this.byId.get(id);
    if (!list) return;
    const i = list.findIndex((x) => x.v === v);
    if (i < 0) return;
    list.splice(i, 1);
    this.count--;
    if (!list.length) this.byId.delete(id);
  }
}

/**
 * Samples of near-silence at the start of a decoded clip (MP3 encoder/decoder delay when the
 * browser ignores the LAME header). The recipes start every file on its attack, so anything below
 * `threshold` in the first `maxSec` is padding.
 */
export function leadingSilence(data: Float32Array, sampleRate: number, maxSec = 0.08, threshold = 1e-3): number {
  const max = Math.min(data.length, Math.round(maxSec * sampleRate));
  for (let i = 0; i < max; i++) if (Math.abs(data[i]!) > threshold) return i;
  return 0;
}
