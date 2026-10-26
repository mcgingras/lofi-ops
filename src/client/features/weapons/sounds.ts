/**
 * Per-weapon synthesized sounds (registered as `shot.<id>` / `shot.<id>.sup`, which core's
 * `sfx.gunshot` prefers), plus mechanical and equipment sounds: bolt, pump, shell, magazine,
 * knife swish, pin, bounce, explosion, flashbang ring. All lo-fi: sample-and-hold noise, one-pole
 * filters, a sine body thump.
 */
import { sfx } from '../../game/audio';

interface Voice {
  /** Seconds. */
  dur: number;
  /** Envelope decay power (higher = snappier). */
  decay: number;
  /** Sample-and-hold period in samples (grit; higher = darker, crunchier). */
  hold: number;
  /** One-pole low-pass coefficient 0..1 (1 = open). */
  lp: number;
  /** Body thump frequency (Hz) and amount. */
  body: number;
  bodyAmt: number;
  /** Initial crack (bright click) amount. */
  crack: number;
  /** Echo tail amount (outdoor slap-back). */
  tail: number;
  gain: number;
}

const V = (o: Partial<Voice>): Voice => ({ dur: 0.3, decay: 3.2, hold: 4, lp: 0.6, body: 80, bodyAmt: 0.4, crack: 0.3, tail: 0.15, gain: 0.9, ...o });

/** Voices by weapon id. */
export const VOICES: Record<string, Voice> = {
  m16: V({ dur: 0.26, decay: 3.6, hold: 3, lp: 0.7, body: 95, bodyAmt: 0.35, crack: 0.45 }),
  famas: V({ dur: 0.22, decay: 4, hold: 3, lp: 0.75, body: 110, bodyAmt: 0.3, crack: 0.5, gain: 0.8 }),
  ak47: V({ dur: 0.34, decay: 3, hold: 5, lp: 0.55, body: 70, bodyAmt: 0.55, crack: 0.3, tail: 0.2 }),
  commando: V({ dur: 0.26, decay: 3.4, hold: 4, lp: 0.62, body: 90, bodyAmt: 0.4, crack: 0.4 }),
  galil: V({ dur: 0.32, decay: 3.1, hold: 5, lp: 0.58, body: 75, bodyAmt: 0.5, crack: 0.3 }),
  aug: V({ dur: 0.28, decay: 3.4, hold: 3, lp: 0.66, body: 88, bodyAmt: 0.38, crack: 0.42 }),
  acr: V({ dur: 0.25, decay: 3.7, hold: 3, lp: 0.72, body: 100, bodyAmt: 0.32, crack: 0.44, gain: 0.82 }),
  m16a4: V({ dur: 0.28, decay: 3.5, hold: 3, lp: 0.66, body: 90, bodyAmt: 0.38, crack: 0.45 }),
  mp5k: V({ dur: 0.18, decay: 4.2, hold: 3, lp: 0.62, body: 130, bodyAmt: 0.3, crack: 0.35, tail: 0.08, gain: 0.75 }),
  ak74u: V({ dur: 0.22, decay: 3.8, hold: 4, lp: 0.6, body: 105, bodyAmt: 0.4, crack: 0.4, gain: 0.8 }),
  mpl: V({ dur: 0.15, decay: 4.6, hold: 3, lp: 0.66, body: 140, bodyAmt: 0.25, crack: 0.35, tail: 0.06, gain: 0.7 }),
  mp5: V({ dur: 0.18, decay: 4.2, hold: 3, lp: 0.63, body: 125, bodyAmt: 0.3, crack: 0.36, tail: 0.08, gain: 0.74 }),
  ump45: V({ dur: 0.23, decay: 3.7, hold: 4, lp: 0.58, body: 100, bodyAmt: 0.42, crack: 0.38, tail: 0.1, gain: 0.8 }),
  vector: V({ dur: 0.14, decay: 4.8, hold: 3, lp: 0.62, body: 110, bodyAmt: 0.35, crack: 0.33, tail: 0.05, gain: 0.7 }),
  p90: V({ dur: 0.14, decay: 4.8, hold: 3, lp: 0.7, body: 150, bodyAmt: 0.22, crack: 0.4, tail: 0.05, gain: 0.68 }),
  spectre: V({ dur: 0.15, decay: 4.6, hold: 3, lp: 0.65, body: 135, bodyAmt: 0.27, crack: 0.37, tail: 0.06, gain: 0.7 }),
  uzi: V({ dur: 0.19, decay: 4, hold: 3, lp: 0.6, body: 115, bodyAmt: 0.36, crack: 0.38, tail: 0.08, gain: 0.76 }),
  rpk: V({ dur: 0.38, decay: 2.8, hold: 5, lp: 0.52, body: 65, bodyAmt: 0.55, crack: 0.3, tail: 0.25 }),
  m60: V({ dur: 0.44, decay: 2.6, hold: 6, lp: 0.46, body: 55, bodyAmt: 0.65, crack: 0.32, tail: 0.3, gain: 0.95 }),
  stoner63: V({ dur: 0.26, decay: 3.6, hold: 3, lp: 0.68, body: 95, bodyAmt: 0.35, crack: 0.42, tail: 0.15, gain: 0.82 }),
  hk21: V({ dur: 0.36, decay: 2.9, hold: 5, lp: 0.55, body: 68, bodyAmt: 0.5, crack: 0.34, tail: 0.22 }),
  rpd: V({ dur: 0.36, decay: 2.9, hold: 5, lp: 0.54, body: 62, bodyAmt: 0.55, crack: 0.3, tail: 0.25 }),
  m249: V({ dur: 0.28, decay: 3.4, hold: 4, lp: 0.64, body: 85, bodyAmt: 0.42, crack: 0.4, tail: 0.18, gain: 0.85 }),
  mg4: V({ dur: 0.3, decay: 3.3, hold: 4, lp: 0.62, body: 80, bodyAmt: 0.42, crack: 0.38, tail: 0.2, gain: 0.85 }),
  l96a1: V({ dur: 0.75, decay: 2.4, hold: 6, lp: 0.5, body: 52, bodyAmt: 0.75, crack: 0.6, tail: 0.45, gain: 1 }),
  dragunov: V({ dur: 0.6, decay: 2.6, hold: 5, lp: 0.55, body: 60, bodyAmt: 0.6, crack: 0.55, tail: 0.35, gain: 0.95 }),
  intervention: V({ dur: 0.8, decay: 2.3, hold: 6, lp: 0.48, body: 48, bodyAmt: 0.8, crack: 0.62, tail: 0.5, gain: 1 }),
  olympia: V({ dur: 0.6, decay: 2.3, hold: 8, lp: 0.42, body: 48, bodyAmt: 0.8, crack: 0.25, tail: 0.35, gain: 1 }),
  stakeout: V({ dur: 0.55, decay: 2.4, hold: 8, lp: 0.45, body: 52, bodyAmt: 0.75, crack: 0.25, tail: 0.3, gain: 1 }),
  spas12: V({ dur: 0.45, decay: 2.6, hold: 7, lp: 0.48, body: 58, bodyAmt: 0.65, crack: 0.25, tail: 0.25, gain: 0.95 }),
  m1911: V({ dur: 0.22, decay: 3.6, hold: 4, lp: 0.6, body: 100, bodyAmt: 0.4, crack: 0.4, tail: 0.1, gain: 0.75 }),
  python: V({ dur: 0.45, decay: 2.8, hold: 5, lp: 0.55, body: 70, bodyAmt: 0.6, crack: 0.6, tail: 0.3, gain: 0.95 }),
  asp: V({ dur: 0.16, decay: 4.4, hold: 3, lp: 0.68, body: 140, bodyAmt: 0.25, crack: 0.4, tail: 0.06, gain: 0.65 }),
  deagle: V({ dur: 0.5, decay: 2.6, hold: 6, lp: 0.5, body: 60, bodyAmt: 0.7, crack: 0.65, tail: 0.32, gain: 1 }),
  makarov: V({ dur: 0.17, decay: 4.3, hold: 3, lp: 0.66, body: 135, bodyAmt: 0.27, crack: 0.38, tail: 0.06, gain: 0.66 }),
  usp: V({ dur: 0.23, decay: 3.5, hold: 4, lp: 0.6, body: 95, bodyAmt: 0.42, crack: 0.42, tail: 0.1, gain: 0.76 }),
  // Machine pistols (synth fallbacks): short, bright pops between the ASP and the MPL.
  mp9: V({ dur: 0.15, decay: 4.6, hold: 3, lp: 0.67, body: 135, bodyAmt: 0.26, crack: 0.38, tail: 0.06, gain: 0.66 }),
  skorpion: V({ dur: 0.14, decay: 4.8, hold: 3, lp: 0.64, body: 145, bodyAmt: 0.24, crack: 0.34, tail: 0.05, gain: 0.64 }),
  tmp: V({ dur: 0.15, decay: 4.6, hold: 3, lp: 0.66, body: 138, bodyAmt: 0.26, crack: 0.36, tail: 0.06, gain: 0.64 }),
  cz75auto: V({ dur: 0.18, decay: 4.1, hold: 3, lp: 0.63, body: 115, bodyAmt: 0.34, crack: 0.4, tail: 0.08, gain: 0.7 }),
  g18: V({ dur: 0.13, decay: 5, hold: 3, lp: 0.7, body: 150, bodyAmt: 0.22, crack: 0.4, tail: 0.05, gain: 0.62 }),
  gl: V({ dur: 0.3, decay: 3, hold: 10, lp: 0.25, body: 60, bodyAmt: 1, crack: 0.05, tail: 0.1, gain: 0.9 }),
};

function render(ctx: AudioContext, v: Voice, suppressed: boolean): AudioBuffer {
  const sr = ctx.sampleRate;
  const dur = suppressed ? Math.min(0.2, v.dur * 0.5) : v.dur;
  const len = Math.max(1, (dur * sr) | 0);
  const b = ctx.createBuffer(1, len, sr);
  const d = b.getChannelData(0);
  const lp = suppressed ? v.lp * 0.35 : v.lp;
  const hold = suppressed ? v.hold + 2 : v.hold;
  let h = 0;
  let y = 0;
  const echo = (0.09 * sr) | 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = Math.pow(1 - i / len, v.decay);
    if (i % hold === 0) h = Math.random() * 2 - 1;
    y += (h - y) * lp;
    let s = y * env;
    s += Math.sin(t * Math.PI * 2 * v.body * (1 - t * 0.8)) * Math.pow(1 - i / len, v.decay * 1.5) * v.bodyAmt * (suppressed ? 0.6 : 1);
    if (!suppressed && t < 0.006) s += (Math.random() * 2 - 1) * v.crack * (1 - t / 0.006);
    d[i] = s * v.gain;
  }
  if (!suppressed && v.tail > 0) for (let i = len - 1; i >= echo; i--) d[i] = d[i]! + d[i - echo]! * v.tail;
  // Normalise to avoid clipping.
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]!));
  if (peak > 0.98) for (let i = 0; i < len; i++) d[i] = (d[i]! / peak) * 0.98;
  return b;
}

for (const [id, v] of Object.entries(VOICES)) {
  sfx.register(`shot.${id}`, (ctx) => render(ctx, v, false));
  sfx.register(`shot.${id}.sup`, (ctx) => render(ctx, v, true));
}

function tone(ctx: AudioContext, dur: number, f: (t: number, i: number) => number): AudioBuffer {
  const len = Math.max(1, (dur * ctx.sampleRate) | 0);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = f(i / ctx.sampleRate, i);
  return b;
}

/** A metallic clack at time `at` inside a buffer. */
const clack = (t: number, at: number, len = 0.03, amt = 0.7) => (t >= at && t < at + len ? (Math.random() * 2 - 1) * Math.pow(1 - (t - at) / len, 3) * amt + Math.sin((t - at) * 2 * Math.PI * 2400) * Math.pow(1 - (t - at) / len, 4) * amt * 0.4 : 0);

sfx.register('weapons.bolt', (ctx) => tone(ctx, 0.55, (t) => clack(t, 0, 0.03, 0.6) + clack(t, 0.14, 0.05, 0.7) + clack(t, 0.32, 0.04, 0.7) + clack(t, 0.46, 0.03, 0.6)));
sfx.register('weapons.pump', (ctx) => tone(ctx, 0.4, (t) => clack(t, 0, 0.07, 0.8) + clack(t, 0.2, 0.06, 0.9)));
sfx.register('weapons.shell', (ctx) => tone(ctx, 0.12, (t) => clack(t, 0, 0.02, 0.5) + clack(t, 0.06, 0.03, 0.4)));
sfx.register('weapons.magout', (ctx) => tone(ctx, 0.15, (t) => clack(t, 0, 0.04, 0.6) + clack(t, 0.07, 0.03, 0.3)));
sfx.register('weapons.magin', (ctx) => tone(ctx, 0.2, (t) => clack(t, 0, 0.05, 0.8) + clack(t, 0.1, 0.04, 0.5)));
sfx.register('weapons.break', (ctx) => tone(ctx, 0.2, (t) => clack(t, 0, 0.06, 0.8) + clack(t, 0.08, 0.04, 0.4)));
sfx.register('weapons.knife', (ctx) => {
  let y = 0;
  return tone(ctx, 0.25, (t) => {
    const k = Math.min(1, t / 0.08) * Math.pow(1 - t / 0.25, 2);
    y += ((Math.random() * 2 - 1) - y) * (0.1 + 0.5 * (t / 0.25));
    return y * k * 0.8;
  });
});
sfx.register('weapons.stab', (ctx) => {
  let h = 0;
  return tone(ctx, 0.18, (t, i) => {
    if (i % 12 === 0) h = Math.random() * 2 - 1;
    return (h * 0.6 + Math.sin(t * 2 * Math.PI * 90)) * Math.pow(1 - t / 0.18, 3) * 0.8;
  });
});
sfx.register('weapons.pin', (ctx) => tone(ctx, 0.25, (t) => Math.sin(t * 2 * Math.PI * 3100) * Math.pow(1 - t / 0.25, 5) * 0.3 + clack(t, 0, 0.02, 0.4)));
sfx.register('weapons.bounce', (ctx) => tone(ctx, 0.08, (t) => Math.sin(t * 2 * Math.PI * 1500) * Math.pow(1 - t / 0.08, 4) * 0.4 + clack(t, 0, 0.015, 0.3)));
sfx.register('weapons.boom', (ctx) => {
  let h = 0;
  let y = 0;
  const dur = 1.3;
  return tone(ctx, dur, (t, i) => {
    if (i % 10 === 0) h = Math.random() * 2 - 1;
    y += (h - y) * (0.35 - 0.25 * (t / dur));
    const env = t < 0.01 ? t / 0.01 : Math.pow(1 - t / dur, 2.6);
    return (y * 1.3 + Math.sin(t * 2 * Math.PI * (55 - 25 * t)) * 0.8) * env * 0.9;
  });
});
sfx.register('weapons.flashbang', (ctx) => {
  let h = 0;
  return tone(ctx, 0.5, (t, i) => {
    if (i % 3 === 0) h = Math.random() * 2 - 1;
    return h * Math.pow(1 - t / 0.5, 4) * 0.9;
  });
});
sfx.register('weapons.ring', (ctx) => tone(ctx, 3, (t) => Math.sin(t * 2 * Math.PI * 3400) * Math.pow(1 - t / 3, 1.5) * 0.12));
sfx.register('weapons.beep', (ctx) => tone(ctx, 0.07, (t) => (Math.sin(t * 2 * Math.PI * 2600) > 0 ? 0.22 : -0.22) * Math.pow(1 - t / 0.07, 2)));
sfx.register('weapons.thump', (ctx) => tone(ctx, 0.25, (t) => Math.sin(t * 2 * Math.PI * (90 - 120 * t)) * Math.pow(1 - t / 0.25, 3) * 0.9));
// Cooking a frag: a dry mechanical tick (the spoon spring / fuse) once a second, faster at the end.
sfx.register('weapons.cook', (ctx) => tone(ctx, 0.05, (t) => clack(t, 0, 0.012, 0.35) + Math.sin(t * 2 * Math.PI * 1800) * Math.pow(1 - t / 0.05, 6) * 0.12));
import './wonder/sounds';
