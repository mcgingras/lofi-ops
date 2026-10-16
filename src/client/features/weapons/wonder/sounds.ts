/**
 * Synthesized wonder weapon sounds (no audio downloads): the guns' voices (`shot.<id>`, which
 * `sfx.gunshot` plays for the shooter and the effect handler plays for everyone else) and their
 * effects. Listed in SFX_SYNTH_ONLY (src/shared/defs/sfx-recipes.ts).
 *
 * - Ray Gun: a sci-fi zap, a bright square sweep diving down with a warble and a fizz.
 * - Thundergun: a deep air cannon, a low thump under a rushing noise that falls away.
 * - Wunderwaffe DG-2: a crackling electric discharge over a mains buzz.
 * - Winter's Howl: an icy hiss with a falling whistle and glassy tinkles.
 */
import { sfx } from '../../../game/audio';

function tone(ctx: AudioContext, dur: number, f: (t: number, i: number, sr: number) => number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, (dur * sr) | 0);
  const b = ctx.createBuffer(1, len, sr);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = f(i / sr, i, sr);
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]!));
  if (peak > 0.98) for (let i = 0; i < len; i++) d[i] = (d[i]! / peak) * 0.98;
  return b;
}

const sq = (ph: number) => (ph % 1 < 0.5 ? 1 : -1);
const noise = () => Math.random() * 2 - 1;

sfx.register('shot.raygun', (ctx) => {
  let ph = 0;
  let ph2 = 0;
  let y = 0;
  const dur = 0.34;
  return tone(ctx, dur, (t, _i, sr) => {
    const k = t / dur;
    const f = 1900 * Math.pow(0.12, k) + 140 + Math.sin(t * 2 * Math.PI * 38) * 60;
    ph += f / sr;
    ph2 += (f * 1.5) / sr;
    y += (noise() - y) * 0.5;
    const env = Math.min(1, t / 0.004) * Math.pow(1 - k, 1.8);
    return (sq(ph) * 0.42 + Math.sin(ph2 * 2 * Math.PI) * 0.3 + y * 0.25 * Math.pow(1 - k, 4)) * env * 0.8;
  });
});

sfx.register('shot.thundergun', (ctx) => {
  let y = 0;
  let h = 0;
  const dur = 1.1;
  return tone(ctx, dur, (t, i) => {
    const k = t / dur;
    if (i % 6 === 0) h = noise();
    y += (h - y) * (0.5 - 0.4 * k);
    const thump = Math.sin(t * 2 * Math.PI * (70 - 40 * k)) * Math.pow(1 - k, 3) * 1.1;
    const rush = y * Math.min(1, t / 0.03) * Math.pow(1 - k, 1.4);
    return (thump + rush * 0.9) * 0.85;
  });
});

sfx.register('shot.wunderwaffe', (ctx) => {
  let ph = 0;
  let amp = 0;
  const dur = 0.75;
  return tone(ctx, dur, (t, i, sr) => {
    const k = t / dur;
    // Crackle: random bursts of noise, denser at the start.
    if (i % 90 === 0) amp = Math.random() < 0.65 - 0.4 * k ? 0.4 + Math.random() * 0.6 : 0.05;
    ph += 118 / sr;
    const buzz = sq(ph) * 0.22 + sq(ph * 2.01) * 0.1;
    const crack = t < 0.012 ? noise() * (1 - t / 0.012) : 0;
    return (noise() * amp * 0.75 + buzz + crack) * Math.pow(1 - k, 1.6) * 0.9;
  });
});

sfx.register('shot.wintershowl', (ctx) => {
  let y = 0;
  let prev = 0;
  let ph = 0;
  const dur = 0.7;
  return tone(ctx, dur, (t, _i, sr) => {
    const k = t / dur;
    const n = noise();
    y = n - prev * 0.85; // a cheap high-pass: hiss
    prev = n;
    ph += (2600 * Math.pow(0.4, k)) / sr;
    const whistle = Math.sin(ph * 2 * Math.PI) * 0.25 * Math.pow(1 - k, 1.5);
    const tinkle = Math.sin(t * 2 * Math.PI * 4200) * (Math.sin(t * 61) > 0.93 ? 0.3 : 0) * (1 - k);
    return (y * 0.4 * Math.min(1, t / 0.02) * Math.pow(1 - k, 1.2) + whistle + tinkle) * 0.85;
  });
});

/** The Ray Gun bolt bursting: a green pop and fizz. */
sfx.register('weapons.wonder.splash', (ctx) => {
  let y = 0;
  const dur = 0.45;
  return tone(ctx, dur, (t) => {
    const k = t / dur;
    y += (noise() - y) * 0.6;
    return (Math.sin(t * 2 * Math.PI * (900 * Math.pow(0.2, k))) * Math.pow(1 - k, 2) * 0.7 + y * 0.4 * Math.pow(1 - k, 3)) * 0.9;
  });
});

/** An arc jumping to the next victim. */
sfx.register('weapons.wonder.zap', (ctx) => {
  let amp = 0;
  const dur = 0.3;
  return tone(ctx, dur, (t, i) => {
    if (i % 60 === 0) amp = Math.random() < 0.7 ? Math.random() : 0;
    const k = t / dur;
    return (noise() * amp + Math.sin(t * 2 * Math.PI * 240) * 0.2) * Math.pow(1 - k, 2) * 0.85;
  });
});

/** A frozen body shattering: glassy cracks and a spray of tinkles. */
sfx.register('weapons.wonder.shatter', (ctx) => {
  const hits = Array.from({ length: 9 }, () => ({ at: Math.random() * 0.35, f: 2500 + Math.random() * 3500 }));
  const dur = 0.7;
  return tone(ctx, dur, (t) => {
    let s = t < 0.02 ? noise() * (1 - t / 0.02) * 0.9 : 0;
    for (const hit of hits) if (t >= hit.at && t < hit.at + 0.12) s += Math.sin((t - hit.at) * 2 * Math.PI * hit.f) * Math.pow(1 - (t - hit.at) / 0.12, 3) * 0.35;
    return s * Math.pow(1 - t / dur, 1.2);
  });
});

/** Frost biting into you (the victim hears it). */
sfx.register('weapons.wonder.chill', (ctx) => {
  let prev = 0;
  const dur = 0.5;
  return tone(ctx, dur, (t) => {
    const n = noise();
    const y = n - prev * 0.9;
    prev = n;
    return (y * 0.35 + Math.sin(t * 2 * Math.PI * 3300) * 0.12 * (Math.sin(t * 90) > 0.6 ? 1 : 0)) * Math.pow(1 - t / dur, 1.5);
  });
});
