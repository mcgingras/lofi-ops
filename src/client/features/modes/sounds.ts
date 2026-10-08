/**
 * Synthesized fallbacks for the modes' sounds (they play until the recordings / rendered cues in
 * assets/sfx have loaded): restrained radio pips for objective won/lost, round start and the
 * bomb-planted warning (the same cues as the shipped files, from shared/defs/sfx-cues.ts), a small
 * metallic tick for the dog-tag pickup, and the planted bomb's beep (positional, faster as the
 * fuse runs).
 */
import { sfx } from '../../game/audio';
import { renderCue } from '../../../shared/defs/sfx-cues';

type Fn = (t: number, i: number) => number;

function synth(ctx: AudioContext, dur: number, f: Fn): AudioBuffer {
  const len = Math.max(1, (dur * ctx.sampleRate) | 0);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = f(i / ctx.sampleRate, i);
  return b;
}

/** A radio cue as an AudioBuffer (quieter than full scale, like the shipped files). */
function cueBuffer(ctx: AudioContext, name: string, gain = 0.35): AudioBuffer {
  const a = renderCue(name, ctx.sampleRate);
  const b = ctx.createBuffer(1, a.length, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < a.length; i++) d[i] = a[i]! * gain;
  return b;
}

const sine = (t: number, hz: number) => Math.sin(t * 2 * Math.PI * hz);

sfx.register('modes.good', (ctx) => cueBuffer(ctx, 'cue_good'));
sfx.register('modes.bad', (ctx) => cueBuffer(ctx, 'cue_bad'));
sfx.register('modes.horn', (ctx) => cueBuffer(ctx, 'cue_round'));
sfx.register('modes.alarm', (ctx) => cueBuffer(ctx, 'cue_warn'));
sfx.register('modes.pickup', (ctx) => synth(ctx, 0.08, (t) => (sine(t, 3900) * 0.5 + sine(t, 6100) * 0.3) * Math.pow(1 - t / 0.08, 4) * 0.25));
sfx.register('modes.beep', (ctx) => synth(ctx, 0.1, (t) => sine(t, 4000) * 0.2 * Math.min(1, t / 0.004, (0.1 - t) / 0.01)));
sfx.register('modes.boom', (ctx) => {
  let hold = 0;
  return synth(ctx, 1.4, (t, i) => {
    if (i % 24 === 0) hold = Math.random() * 2 - 1;
    return (hold * 0.8 + Math.sin(t * 2 * Math.PI * 45) * 0.6) * Math.pow(1 - t / 1.4, 2.2);
  });
});
