/**
 * Synthesized economy sounds (no fitting recordings; listed in SFX_SYNTH_ONLY): the wager payout
 * stings, played by wager-results.ts when the `economy.award` payout push arrives.
 */
import { sfx } from '../../game/audio';

function synth(ctx: AudioContext, dur: number, f: (t: number) => number): AudioBuffer {
  const len = Math.max(1, (dur * ctx.sampleRate) | 0);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = f(i / ctx.sampleRate);
  return b;
}
const sine = (t: number, hz: number) => Math.sin(t * 2 * Math.PI * hz);

/** In the money: three bright rising coin chimes. */
sfx.register('economy.cash', (ctx) =>
  synth(ctx, 0.62, (t) => {
    let v = 0;
    [0, 0.12, 0.24].forEach((at, i) => {
      const u = t - at;
      if (u >= 0) v += (sine(u, 1320 * 1.26 ** i) * 0.6 + sine(u, 2640 * 1.26 ** i) * 0.25) * Math.exp(-u * 9) * Math.min(1, u / 0.003);
    });
    return v * 0.22;
  }),
);
/** Out of the money: a low falling buzz. */
sfx.register('economy.bust', (ctx) =>
  synth(ctx, 0.55, (t) => {
    const hz = 220 - 110 * (t / 0.55);
    return (sine(t, hz) > 0 ? 1 : -1) * 0.12 * Math.min(1, t / 0.005) * (1 - t / 0.55);
  }),
);
