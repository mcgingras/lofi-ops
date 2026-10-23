/**
 * Synthesized wonder weapon sounds (no audio downloads): the guns' voices (`shot.<id>`, which
 * `sfx.gunshot` plays for the shooter and the effect handler plays for everyone else) and their
 * effects. Listed in SFX_SYNTH_ONLY (src/shared/defs/sfx-recipes.ts).
 *
 * - Ray Gun: a sci-fi zap, a bright square sweep diving down with a warble and a fizz.
 * - Thundergun: a deep air cannon, a low thump under a rushing noise that falls away.
 * - Wunderwaffe DG-2: a crackling electric discharge over a mains buzz.
 * - Winter's Howl: an icy hiss with a falling whistle and glassy tinkles.
 * - Scavenger: a heavy crack with a launcher thunk and a whistle; its blast a big low boom.
 * - 31-79 JGb215: a rising toy-like warble; shrunk players squeak, and a kick squelches.
 * - Wave Gun: the Zap Guns snap; the joined Wave Gun thrums like a microwave; its victims pop.
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

/** Scavenger: a heavy sniper crack with a hollow launcher thunk and the bolt's whistle away. */
sfx.register('shot.scavenger', (ctx) => {
  let y = 0;
  let ph = 0;
  const dur = 0.9;
  return tone(ctx, dur, (t, _i, sr) => {
    const k = t / dur;
    y += (noise() - y) * (0.7 - 0.5 * k);
    const crack = t < 0.015 ? noise() * (1 - t / 0.015) : 0;
    const thunk = Math.sin(t * 2 * Math.PI * (110 - 50 * k)) * Math.pow(Math.max(0, 1 - t / 0.25), 2) * 0.9;
    ph += (1800 * Math.pow(0.5, k)) / sr;
    const whistle = Math.sin(ph * 2 * Math.PI) * 0.12 * Math.min(1, t / 0.05) * Math.pow(1 - k, 2);
    return (crack + y * 0.55 * Math.pow(1 - k, 2.2) + thunk + whistle) * 0.85;
  });
});

/** Baby Gun: a rising toy-like warble ("bwoo-ip") with a sparkle. */
sfx.register('shot.babygun', (ctx) => {
  let ph = 0;
  const dur = 0.45;
  return tone(ctx, dur, (t, _i, sr) => {
    const k = t / dur;
    const f = 300 + 1500 * k * k + Math.sin(t * 2 * Math.PI * 22) * 80;
    ph += f / sr;
    const sparkle = Math.sin(t * 2 * Math.PI * 5200) * (Math.sin(t * 140) > 0.8 ? 0.15 : 0);
    const env = Math.min(1, t / 0.01) * Math.pow(1 - k, 1.2);
    return (Math.sin(ph * 2 * Math.PI) * 0.55 + sq(ph * 0.5) * 0.12 + sparkle) * env;
  });
});

/** Zap Guns: a short electric snap; the Wave Gun shot is `weapons.wonder.wave`. */
sfx.register('shot.wavegun', (ctx) => {
  let ph = 0;
  const dur = 0.16;
  return tone(ctx, dur, (t, _i, sr) => {
    const k = t / dur;
    ph += (2400 * Math.pow(0.3, k)) / sr;
    const snap = t < 0.006 ? noise() * (1 - t / 0.006) : 0;
    return (sq(ph) * 0.35 + noise() * 0.25 * Math.pow(1 - k, 3) + snap) * Math.pow(1 - k, 1.5) * 0.85;
  });
});

/** The Wave Gun firing: a deep microwave thrum that swells and cuts off. */
sfx.register('weapons.wonder.wave', (ctx) => {
  let ph = 0;
  const dur = 0.8;
  return tone(ctx, dur, (t, _i, sr) => {
    const k = t / dur;
    ph += (90 + 40 * Math.sin(t * 2 * Math.PI * 6)) / sr;
    const hum = sq(ph) * 0.4 + Math.sin(ph * 4 * Math.PI) * 0.25;
    return (hum + noise() * 0.08) * Math.min(1, t / 0.05) * Math.pow(1 - k, 1.1);
  });
});

/** A swollen body popping: a wet thump and a burst of fizz. */
sfx.register('weapons.wonder.pop', (ctx) => {
  let y = 0;
  const dur = 0.5;
  return tone(ctx, dur, (t) => {
    const k = t / dur;
    y += (noise() - y) * 0.4;
    const thump = Math.sin(t * 2 * Math.PI * (160 * Math.pow(0.3, k))) * Math.pow(1 - k, 3);
    return (thump * 0.9 + y * 0.6 * Math.pow(1 - k, 2) + (t < 0.01 ? noise() * 0.8 : 0)) * 0.9;
  });
});

/** The Scavenger's blast: a big low boom and a long rumble. */
sfx.register('weapons.wonder.scavboom', (ctx) => {
  let y = 0;
  let h = 0;
  const dur = 1.6;
  return tone(ctx, dur, (t, i) => {
    const k = t / dur;
    if (i % 4 === 0) h = noise();
    y += (h - y) * (0.35 - 0.3 * k);
    const crack = t < 0.03 ? noise() * (1 - t / 0.03) : 0;
    const boom = Math.sin(t * 2 * Math.PI * (55 - 25 * k)) * Math.pow(1 - k, 2.5) * 1.1;
    return (crack + boom + y * 1.2 * Math.pow(1 - k, 1.6)) * 0.85;
  });
});

/** A shrunk player's squeaky little voice (on the shrink, as they run about, when they shoot). */
sfx.register('weapons.wonder.squeak', (ctx) => {
  let ph = 0;
  const dur = 0.22;
  const up = Math.random() < 0.5;
  return tone(ctx, dur, (t, _i, sr) => {
    const k = t / dur;
    const f = (up ? 1300 + 900 * k : 2100 - 800 * k) + Math.sin(t * 2 * Math.PI * 30) * 120;
    ph += f / sr;
    return (Math.sin(ph * 2 * Math.PI) * 0.5 + Math.sin(ph * 4 * Math.PI) * 0.15) * Math.min(1, t / 0.01) * Math.sin(Math.PI * k);
  });
});

/** A shrunk player kicked: a squelchy thud and a last squeak. */
sfx.register('weapons.wonder.kick', (ctx) => {
  let ph = 0;
  const dur = 0.4;
  return tone(ctx, dur, (t, _i, sr) => {
    const k = t / dur;
    const thud = Math.sin(t * 2 * Math.PI * (140 - 80 * k)) * Math.pow(Math.max(0, 1 - t / 0.15), 2);
    ph += (2600 - 1800 * k) / sr;
    const squeak = t > 0.05 ? Math.sin(ph * 2 * Math.PI) * 0.3 * Math.pow(1 - k, 1.5) : 0;
    return (thud + squeak + (t < 0.01 ? noise() * 0.6 : 0)) * 0.9;
  });
});
