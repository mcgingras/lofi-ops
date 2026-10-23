/**
 * Barrier and door sounds (synthesized, original; SFX_SYNTH_ONLY): `zombies.board_tear` (a board wrenched
 * off), `zombies.board_slam` (a board slammed back and nailed), `zombies.door_clear` (debris cleared).
 * Imported by sounds.ts so every Zombies sound registers together.
 */
import { sfx } from '../../game/audio';

function tone(ctx: AudioContext, dur: number, f: (t: number) => number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, (dur * sr) | 0);
  const b = ctx.createBuffer(1, len, sr);
  const d = b.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < len; i++) {
    d[i] = f(i / sr);
    peak = Math.max(peak, Math.abs(d[i]!));
  }
  if (peak > 0.9) for (let i = 0; i < len; i++) d[i] = (d[i]! / peak) * 0.9;
  return b;
}
const noise = () => Math.random() * 2 - 1;

// A board wrenched off: a wooden crack, a splintering rattle, the nails squealing.
sfx.register('zombies.board_tear', (ctx) => {
  let lp = 0;
  return tone(ctx, 0.7, (t) => {
    const n = noise();
    lp += (n - lp) * 0.25;
    const crack = t < 0.03 ? n * (1 - t / 0.03) : 0;
    const splinter = lp * 1.8 * Math.exp(-t * 7) * (0.6 + 0.4 * Math.sin(t * 380));
    const squeal = Math.sin(2 * Math.PI * (1400 - 700 * t) * t) * 0.18 * Math.max(0, 1 - Math.abs(t - 0.15) / 0.12);
    return crack * 0.9 + splinter + squeal;
  });
});

// A board slammed back and nailed: a thud and two hammer taps.
sfx.register('zombies.board_slam', (ctx) =>
  tone(ctx, 0.6, (t) => {
    const thud = (Math.sin(2 * Math.PI * 95 * t) * 0.8 + noise() * 0.4) * Math.exp(-t * 22);
    const tap = (at: number) => (t < at ? 0 : (Math.sin(2 * Math.PI * 1800 * (t - at)) * 0.3 + noise() * 0.25) * Math.exp(-(t - at) * 60));
    return thud + tap(0.22) + tap(0.38);
  }),
);

// Debris cleared: rubble sliding and dropping away.
sfx.register('zombies.door_clear', (ctx) => {
  let lp = 0;
  return tone(ctx, 1.6, (t) => {
    lp += (noise() - lp) * 0.08;
    const slide = lp * 2.2 * Math.min(1, t / 0.15) * Math.exp(-t * 1.6);
    const thump = (at: number) => (t < at ? 0 : Math.sin(2 * Math.PI * 70 * (t - at)) * 0.6 * Math.exp(-(t - at) * 14));
    return slide + thump(0.1) + thump(0.55) * 0.7 + thump(0.9) * 0.5;
  });
});
