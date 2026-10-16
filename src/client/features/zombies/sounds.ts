/**
 * Zombies sounds, all synthesized and original (no Zombies music, jingles or voice recordings;
 * listed in SFX_SYNTH_ONLY):
 * - stingers: `zombies.round_start` (a low tolling bell and a cluster drone), `zombies.round_end`
 *   (the bell answered by a rising fifth), `zombies.dog_round` (thunder under a wolf-like howl),
 *   `zombies.game_over` (a slow falling minor line);
 * - Perk-a-Cola jingles, each an original four-bar tune on a toy organ: `zombies.perk.jugg` (a
 *   heavy oompah in a low register), `zombies.perk.speed` (quick swung eighths), `zombies.perk.doubletap`
 *   (a doubled two-step), `zombies.perk.revive` (a gentle lullaby);
 * - the horde: `zombies.groan` (a breathy formant moan with a random pitch), `zombies.swipe`,
 *   `zombies.spawn` (dirt cracking), `zombies.growl` (a hellhound);
 * - buying and the HUD: `zombies.buy` (a cash register), `zombies.nope`, `zombies.drink` (a cap pop
 *   and a fizz), `zombies.down` (a heartbeat), `zombies.powerup_drop`, `zombies.powerup_grab`,
 *   `zombies.nuke`, `zombies.teddy` (a wobbly toy laugh).
 */
import { sfx } from '../../game/audio';

function tone(ctx: AudioContext, dur: number, f: (t: number, i: number, sr: number) => number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, (dur * sr) | 0);
  const b = ctx.createBuffer(1, len, sr);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = f(i / sr, i, sr);
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]!));
  if (peak > 0.9) for (let i = 0; i < len; i++) d[i] = (d[i]! / peak) * 0.9;
  return b;
}
const noise = () => Math.random() * 2 - 1;
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const sin = (f: number, t: number) => Math.sin(2 * Math.PI * f * t);
const env = (t: number, a: number, d: number) => (t < 0 ? 0 : Math.min(1, t / a) * Math.exp(-t * d));

/** A tolling bell: inharmonic partials, long decay. */
const bell = (t: number, f: number) => (t < 0 ? 0 : (sin(f, t) * 0.6 + sin(f * 2.76, t) * 0.25 * Math.exp(-t * 2) + sin(f * 5.4, t) * 0.12 * Math.exp(-t * 5)) * Math.min(1, t / 0.004) * Math.exp(-t * 0.9));
/** A toy organ note (square-ish, soft). */
const organ = (t: number, f: number, len: number) => (t < 0 || t > len + 0.08 ? 0 : (Math.tanh(sin(f, t) * 3) * 0.5 + sin(f * 2, t) * 0.2) * Math.min(1, t / 0.01) * (t > len ? Math.max(0, 1 - (t - len) / 0.08) : 1) * 0.6);

type Tune = { notes: [number, number, number][]; beat: number; bass?: [number, number][] };
function playTune(tn: Tune, t: number, wob = 0): number {
  let s = 0;
  const w = 1 + Math.sin(t * 2 * Math.PI * 5) * wob;
  for (const [at, n, len] of tn.notes) s += organ(t - at * tn.beat, hz(n) * w, len * tn.beat * 0.9);
  for (const [at, n] of tn.bass ?? []) s += organ(t - at * tn.beat, hz(n) * w, tn.beat * 0.8) * 0.6;
  return s;
}
const tuneLen = (tn: Tune) => Math.max(...tn.notes.map(([a, , l]) => a + l)) * tn.beat + 0.3;

// ---------------------------------------------------------------------------------------------
// Stingers
// ---------------------------------------------------------------------------------------------

sfx.register('zombies.round_start', (ctx) =>
  tone(ctx, 4.5, (t) => {
    const toll = bell(t, hz(40)) + bell(t - 1.4, hz(40)) * 0.8 + bell(t - 2.8, hz(39)) * 0.7;
    const drone = (sin(hz(28), t) + sin(hz(29), t) * 0.7 + sin(hz(35), t) * 0.4) * 0.25 * Math.min(1, t / 1.5) * Math.max(0, 1 - t / 4.5);
    return toll * 0.6 + drone;
  }),
);

sfx.register('zombies.round_end', (ctx) =>
  tone(ctx, 4, (t) => {
    const a = bell(t, hz(52)) * 0.7 + bell(t - 0.6, hz(59)) * 0.6 + bell(t - 1.2, hz(64)) * 0.6;
    const pad = (sin(hz(40), t) + sin(hz(47), t) * 0.6) * 0.18 * Math.min(1, t / 0.8) * Math.max(0, 1 - t / 4);
    return a + pad;
  }),
);

sfx.register('zombies.dog_round', (ctx) => {
  let y = 0;
  let h = 0;
  return tone(ctx, 4.2, (t, i) => {
    if (i % 12 === 0) h = noise();
    y += (h - y) * 0.05;
    const thunder = (t < 0.08 ? noise() * (1 - t / 0.08) : 0) + y * 2.5 * Math.min(1, t / 0.2) * Math.pow(Math.max(0, 1 - t / 3), 1.5);
    // A howl: a gliding formant voice.
    const ht = t - 0.9;
    const f = ht < 0 ? 0 : 420 + 260 * Math.sin(Math.min(1, ht / 2.4) * Math.PI) - 80 * ht;
    const howl = ht < 0 || ht > 2.8 ? 0 : (sin(f, ht) * 0.5 + sin(f * 2.02, ht) * 0.25 + sin(f * 3.1, ht) * 0.1) * Math.min(1, ht / 0.3) * Math.max(0, 1 - ht / 2.8);
    return thunder * 0.8 + howl * 0.7;
  });
});

sfx.register('zombies.game_over', (ctx) =>
  tone(ctx, 6, (t) => {
    const line: [number, number][] = [[0, 57], [0.9, 55], [1.8, 53], [2.7, 52], [3.9, 45]];
    let s = 0;
    for (const [at, n] of line) s += bell(t - at, hz(n)) * 0.6 + organ(t - at, hz(n - 12), 0.8) * 0.25;
    const drone = sin(hz(33), t) * 0.25 * Math.min(1, t / 2) * Math.max(0, 1 - t / 6);
    return s + drone;
  }),
);

// ---------------------------------------------------------------------------------------------
// Perk-a-Cola jingles (original tunes)
// ---------------------------------------------------------------------------------------------

const JUGG: Tune = { beat: 0.22, notes: [[0, 50, 1], [2, 57, 1], [3, 55, 1], [4, 53, 2], [6, 50, 2], [8, 52, 1], [10, 55, 1], [11, 53, 1], [12, 50, 4]], bass: [[0, 38], [2, 45], [4, 38], [6, 45], [8, 40], [10, 45], [12, 38], [14, 45]] };
const SPEED: Tune = { beat: 0.14, notes: [[0, 72, 1], [1, 74, 1], [2, 76, 1], [3, 79, 1], [4, 76, 1], [5, 74, 1], [6, 72, 2], [8, 74, 1], [9, 76, 1], [10, 77, 1], [11, 81, 1], [12, 79, 4]], bass: [[0, 48], [4, 55], [8, 50], [12, 48]] };
const DOUBLE: Tune = { beat: 0.17, notes: [[0, 67, 1], [1, 67, 1], [2, 71, 1], [3, 71, 1], [4, 74, 2], [6, 72, 1], [7, 72, 1], [8, 69, 1], [9, 69, 1], [10, 71, 2], [12, 67, 4]], bass: [[0, 43], [2, 50], [4, 43], [6, 50], [8, 45], [10, 50], [12, 43]] };
const REVIVE: Tune = { beat: 0.26, notes: [[0, 64, 2], [2, 67, 1], [3, 69, 1], [4, 71, 3], [7, 69, 1], [8, 67, 2], [10, 64, 2], [12, 62, 1], [13, 64, 1], [14, 60, 4]], bass: [[0, 48], [4, 43], [8, 45], [12, 41]] };

sfx.register('zombies.perk.jugg', (ctx) => tone(ctx, tuneLen(JUGG), (t) => playTune(JUGG, t, 0.003) * 0.45));
sfx.register('zombies.perk.speed', (ctx) => tone(ctx, tuneLen(SPEED), (t) => playTune(SPEED, t, 0.002) * 0.4));
sfx.register('zombies.perk.doubletap', (ctx) => tone(ctx, tuneLen(DOUBLE), (t) => playTune(DOUBLE, t, 0.002) * 0.42));
sfx.register('zombies.perk.revive', (ctx) => tone(ctx, tuneLen(REVIVE), (t) => playTune(REVIVE, t, 0.004) * 0.42));

// ---------------------------------------------------------------------------------------------
// The horde
// ---------------------------------------------------------------------------------------------

sfx.register('zombies.groan', (ctx) => {
  const base = 70 + Math.random() * 40;
  const dur = 1.2 + Math.random() * 0.6;
  let y = 0;
  return tone(ctx, dur, (t) => {
    const f = base * (1 + 0.15 * Math.sin(t * 3.1) - 0.2 * (t / dur));
    // Buzzy glottal source through a rough "aah"/"ooh" formant filter.
    const src = ((t * f) % 1) * 2 - 1;
    y += (src - y) * 0.18;
    const breath = noise() * 0.25;
    const form = sin(650 + 150 * Math.sin(t * 2), t) * 0.3 + sin(1100, t) * 0.15;
    return (y * 0.8 + breath * 0.5) * (0.7 + form) * Math.min(1, t / 0.15) * Math.max(0, 1 - t / dur) * 0.7;
  });
});

sfx.register('zombies.swipe', (ctx) => {
  let y = 0;
  return tone(ctx, 0.35, (t) => {
    y += (noise() - y) * (0.1 + 0.6 * Math.min(1, t / 0.15));
    return y * Math.sin(Math.min(1, t / 0.35) * Math.PI) * 0.8;
  });
});

sfx.register('zombies.spawn', (ctx) => {
  let y = 0;
  return tone(ctx, 1.1, (t, i) => {
    if (i % 7 === 0) y = noise();
    const crack = Math.random() < 0.004 ? noise() * 0.8 : 0;
    return (y * 0.5 * Math.exp(-t * 2.5) + crack) * Math.min(1, t / 0.05);
  });
});

sfx.register('zombies.growl', (ctx) => {
  let y = 0;
  return tone(ctx, 0.9, (t) => {
    const f = 55 + 20 * Math.sin(t * 7);
    const src = ((t * f) % 1) * 2 - 1;
    y += (src + noise() * 0.6 - y) * 0.2;
    return y * Math.min(1, t / 0.05) * Math.max(0, 1 - t / 0.9);
  });
});

// ---------------------------------------------------------------------------------------------
// Buying, the HUD, power-ups
// ---------------------------------------------------------------------------------------------

sfx.register('zombies.buy', (ctx) =>
  tone(ctx, 0.7, (t) => {
    const clunk = t < 0.03 ? noise() * (1 - t / 0.03) * 0.6 : 0;
    const ding = (sin(1568, t - 0.08) + sin(2093, t - 0.08) * 0.6) * env(t - 0.08, 0.002, 4) * 0.5;
    return clunk + ding;
  }),
);

sfx.register('zombies.nope', (ctx) => tone(ctx, 0.3, (t) => Math.tanh(sin(110, t) * 4) * 0.4 * Math.max(0, 1 - t / 0.3)));

sfx.register('zombies.drink', (ctx) =>
  tone(ctx, 1.6, (t) => {
    const pop = t < 0.02 ? noise() * (1 - t / 0.02) : 0;
    const fizz = t > 0.05 && t < 1.2 ? noise() * 0.18 * Math.exp(-(t - 0.05) * 2) : 0;
    const glug = t > 0.4 && t < 1.4 ? sin(180 + 60 * Math.sin(t * 22), t) * 0.3 * (0.5 + 0.5 * Math.sin(t * 22)) : 0;
    return pop * 0.7 + fizz + glug;
  }),
);

sfx.register('zombies.down', (ctx) => tone(ctx, 1.4, (t) => (Math.sin(2 * Math.PI * 50 * t) * (env(t, 0.005, 14) + env(t - 0.25, 0.005, 14) * 0.8 + env(t - 0.9, 0.005, 14) + env(t - 1.15, 0.005, 14) * 0.8)) * 0.9));

sfx.register('zombies.powerup_drop', (ctx) => tone(ctx, 0.9, (t) => (sin(880 + 900 * t, t) + sin(1320 + 1300 * t, t) * 0.5) * env(t, 0.01, 4) * 0.3));

sfx.register('zombies.powerup_grab', (ctx) =>
  tone(ctx, 1.2, (t) => {
    let s = 0;
    [76, 79, 83, 88].forEach((n, k) => (s += bell(t - k * 0.08, hz(n)) * 0.3));
    return s;
  }),
);

sfx.register('zombies.nuke', (ctx) => {
  let y = 0;
  let h = 0;
  return tone(ctx, 3, (t, i) => {
    if (i % 10 === 0) h = noise();
    y += (h - y) * 0.08;
    const boom = Math.sin(2 * Math.PI * (60 - 25 * t) * t) * Math.exp(-t * 1.5);
    return (t < 0.1 ? noise() * (1 - t / 0.1) : 0) * 0.8 + boom * 0.9 + y * 2 * Math.exp(-t * 1.2);
  });
});

sfx.register('zombies.teddy', (ctx) =>
  tone(ctx, 1.6, (t) => {
    // A wobbly toy-box laugh: "ha ha ha" pulses gliding down.
    const k = Math.floor(t / 0.22);
    const lt = t - k * 0.22;
    const f = 520 - k * 45;
    return k > 5 ? 0 : (sin(f * (1 + 0.04 * Math.sin(lt * 40)), lt) * 0.5 + sin(f * 2, lt) * 0.2) * env(lt, 0.01, 12) * 0.8;
  }),
);
