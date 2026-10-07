/** Synthesized killstreak sounds in the same lo-fi style as core audio (sample-and-hold noise, square tones). */
import { sfx } from '../../game/audio';

function tone(ctx: AudioContext, dur: number, f: (t: number, i: number) => number): AudioBuffer {
  const len = Math.max(1, (dur * ctx.sampleRate) | 0);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = f(i / ctx.sampleRate, i);
  return b;
}

const sq = (t: number, hz: number) => (Math.sin(t * 2 * Math.PI * hz) > 0 ? 1 : -1);

function noise(ctx: AudioContext, dur: number, hold: number, env: (k: number) => number, low = 0): AudioBuffer {
  let h = 0;
  return tone(ctx, dur, (t, i) => {
    if (i % hold === 0) h = Math.random() * 2 - 1;
    const k = t / dur;
    return (h * (1 - low) + Math.sin(t * 2 * Math.PI * 45) * low) * env(k);
  });
}

sfx.register('ks_ready', (ctx) => tone(ctx, 0.42, (t) => {
  const n = t < 0.12 ? 660 : t < 0.24 ? 880 : 1320;
  return sq(t, n) * 0.35 * (1 - ((t % 0.14) / 0.14) * 0.6);
}));
sfx.register('ks_call', (ctx) => tone(ctx, 0.3, (t) => sq(t, t < 0.1 ? 1200 : t < 0.2 ? 0 : 1500) * 0.25 * (t > 0.1 && t < 0.2 ? 0 : 1)));
sfx.register('ks_alarm', (ctx) => tone(ctx, 0.6, (t) => sq(t, Math.floor(t / 0.15) % 2 ? 520 : 780) * 0.25 * (1 - t / 0.6)));
sfx.register('ks_boom', (ctx) => noise(ctx, 1.1, 24, (k) => Math.pow(1 - k, 2.6), 0.45));
sfx.register('ks_bigboom', (ctx) => noise(ctx, 2.0, 40, (k) => Math.pow(1 - k, 2.2), 0.55));
sfx.register('ks_whistle', (ctx) => tone(ctx, 1.2, (t) => Math.sin(2 * Math.PI * (1800 * t - 500 * t * t)) * 0.18 * Math.min(1, t * 4)));
sfx.register('ks_jet', (ctx) => noise(ctx, 2.4, 3, (k) => Math.sin(Math.PI * k) * 0.6));
sfx.register('ks_rotor', (ctx) => noise(ctx, 0.12, 30, (k) => Math.pow(1 - k, 3) * 0.9, 0.7));
sfx.register('ks_prop', (ctx) => tone(ctx, 0.5, (t) => (sq(t, 70) * 0.3 + (Math.random() - 0.5) * 0.2) * 0.5));
sfx.register('ks_bark', (ctx) => tone(ctx, 0.18, (t) => (sq(t, 380 - t * 900) * 0.6 + (Math.random() - 0.5) * 0.5) * Math.pow(1 - t / 0.18, 1.5)));
sfx.register('ks_bite', (ctx) => noise(ctx, 0.1, 2, (k) => Math.pow(1 - k, 4)));
sfx.register('ks_buzz', (ctx) => tone(ctx, 0.1, (t) => (((t * 210) % 1) * 2 - 1) * 0.3));
sfx.register('ks_launch', (ctx) => noise(ctx, 0.8, 2, (k) => (k < 0.1 ? k * 10 : Math.pow(1 - k, 1.5)) * 0.7));
sfx.register('ks_sentry', (ctx) => noise(ctx, 0.12, 3, (k) => Math.pow(1 - k, 3)));
sfx.register('ks_fire', (ctx) => noise(ctx, 0.5, 5, () => 0.25));
