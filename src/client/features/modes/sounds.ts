/**
 * Lo-fi synthesized cues for the modes: objective won/lost stingers, the bomb-planted klaxon,
 * round horn, dog-tag pickup and the planted bomb's beep (positional, faster as the fuse runs).
 */
import { sfx } from '../../game/audio';

type Fn = (t: number, i: number) => number;

function synth(ctx: AudioContext, dur: number, f: Fn): AudioBuffer {
  const len = Math.max(1, (dur * ctx.sampleRate) | 0);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = f(i / ctx.sampleRate, i);
  return b;
}

/** Square-ish tone, quantised to 8 levels for the lo-fi grit. */
const sq = (t: number, hz: number) => (Math.sin(t * 2 * Math.PI * hz) > 0 ? 1 : -1);
const crush = (v: number) => Math.round(v * 8) / 8;
const env = (t: number, a: number, d: number, dur: number) => (t < a ? t / a : Math.max(0, 1 - (t - a) / Math.max(1e-3, dur - a))) * (t < dur - d ? 1 : Math.max(0, (dur - t) / d));

/** Notes: [startSec, durSec, hz]. */
function melody(ctx: AudioContext, notes: [number, number, number][], vol = 0.28): AudioBuffer {
  const total = Math.max(...notes.map(([s, d]) => s + d)) + 0.05;
  return synth(ctx, total, (t) => {
    let v = 0;
    for (const [s, d, hz] of notes) if (t >= s && t < s + d) v += sq(t, hz) * env(t - s, 0.005, 0.03, d);
    return crush(v * vol);
  });
}

sfx.register('modes.good', (ctx) => melody(ctx, [[0, 0.09, 660], [0.1, 0.09, 880], [0.2, 0.18, 1320]]));
sfx.register('modes.bad', (ctx) => melody(ctx, [[0, 0.12, 520], [0.13, 0.12, 390], [0.26, 0.22, 260]]));
sfx.register('modes.horn', (ctx) => melody(ctx, [[0, 0.5, 220], [0, 0.5, 277], [0, 0.5, 330]], 0.16));
sfx.register('modes.alarm', (ctx) =>
  synth(ctx, 1.2, (t) => {
    const hz = 600 + 300 * (Math.floor(t * 6) % 2);
    return crush(sq(t, hz) * 0.22 * Math.min(1, (1.2 - t) * 4));
  }),
);
sfx.register('modes.pickup', (ctx) => melody(ctx, [[0, 0.05, 1600], [0.05, 0.08, 2400]], 0.2));
sfx.register('modes.beep', (ctx) => synth(ctx, 0.07, (t) => crush(sq(t, 1850) * 0.3 * (1 - t / 0.07))));
sfx.register('modes.boom', (ctx) => {
  let hold = 0;
  return synth(ctx, 1.4, (t, i) => {
    if (i % 24 === 0) hold = Math.random() * 2 - 1;
    return (hold * 0.8 + Math.sin(t * 2 * Math.PI * 45) * 0.6) * Math.pow(1 - t / 1.4, 2.2);
  });
});
