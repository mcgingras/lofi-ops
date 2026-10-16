/**
 * Synthesized killstreak sounds: the fallbacks that play until the recordings in assets/sfx have
 * loaded (radio cues come from shared/defs/sfx-cues.ts, the same as the shipped files).
 */
import { sfx } from '../../game/audio';
import { renderCue } from '../../../shared/defs/sfx-cues';

function cueBuffer(ctx: AudioContext, name: string, gain = 0.35): AudioBuffer {
  const a = renderCue(name, ctx.sampleRate);
  const b = ctx.createBuffer(1, a.length, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < a.length; i++) d[i] = a[i]! * gain;
  return b;
}

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

sfx.register('ks_ready', (ctx) => cueBuffer(ctx, 'cue_ready'));
sfx.register('ks_call', (ctx) => noise(ctx, 0.2, 1, (k) => Math.min(1, k * 20) * (1 - k) * 0.25));
sfx.register('ks_alarm', (ctx) => cueBuffer(ctx, 'cue_warn'));
sfx.register('ks_boom', (ctx) => noise(ctx, 1.1, 24, (k) => Math.pow(1 - k, 2.6), 0.45));
sfx.register('ks_bigboom', (ctx) => noise(ctx, 2.0, 40, (k) => Math.pow(1 - k, 2.2), 0.55));
sfx.register('ks_whistle', (ctx) => noise(ctx, 1.2, 2, (k) => Math.min(1, k * 2) * Math.pow(1 - k, 0.5) * 0.25));
sfx.register('ks_jet', (ctx) => noise(ctx, 2.4, 3, (k) => Math.sin(Math.PI * k) * 0.6));
sfx.register('ks_rotor', (ctx) => noise(ctx, 0.12, 30, (k) => Math.pow(1 - k, 3) * 0.9, 0.7));
sfx.register('ks_prop', (ctx) => tone(ctx, 0.5, (t) => (sq(t, 70) * 0.3 + (Math.random() - 0.5) * 0.2) * 0.5));
sfx.register('ks_bark', (ctx) => tone(ctx, 0.18, (t) => (sq(t, 380 - t * 900) * 0.6 + (Math.random() - 0.5) * 0.5) * Math.pow(1 - t / 0.18, 1.5)));
sfx.register('ks_bite', (ctx) => noise(ctx, 0.1, 2, (k) => Math.pow(1 - k, 4)));
sfx.register('ks_buzz', (ctx) => tone(ctx, 0.1, (t) => (((t * 210) % 1) * 2 - 1) * 0.3));
sfx.register('ks_launch', (ctx) => noise(ctx, 0.8, 2, (k) => (k < 0.1 ? k * 10 : Math.pow(1 - k, 1.5)) * 0.7));
sfx.register('ks_sentry', (ctx) => noise(ctx, 0.12, 3, (k) => Math.pow(1 - k, 3)));
sfx.register('ks_fire', (ctx) => noise(ctx, 0.5, 5, () => 0.25));
// Tactical map (radio): static burst when the feed cuts in/out, a short roger-beep tone per mark and on confirm.
sfx.register('ks_static', (ctx) => noise(ctx, 0.35, 1, (k) => (k < 0.1 ? k * 10 : 1 - k) * 0.35));
sfx.register('ks_mark', (ctx) => tone(ctx, 0.08, (t) => Math.sin(t * 2 * Math.PI * 2000) * 0.12 * Math.min(1, t / 0.004, (0.08 - t) / 0.01)));
sfx.register('ks_confirm', (ctx) => tone(ctx, 0.1, (t) => Math.sin(t * 2 * Math.PI * 2000) * 0.15 * Math.min(1, t / 0.004, (0.1 - t) / 0.01)));
// Care Package marker: the canister's smoke pouring out (a soft hiss, re-triggered while it smokes).
sfx.register('ks_smoke', (ctx) => noise(ctx, 0.9, 1, (k) => Math.min(1, k * 8) * Math.min(1, (1 - k) * 4) * 0.16));
// Mystery Box: the music box, cycle tick, lightning, landing, beam, lid and fly-away.
import './mysterybox-sounds';
