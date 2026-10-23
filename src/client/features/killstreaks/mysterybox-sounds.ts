/**
 * Mystery Box sounds, all synthesized (no audio downloads; listed in SFX_SYNTH_ONLY):
 *
 * - `ks_mbox_jingle`: a music box playing an ORIGINAL little waltz written for Lo-Fi Ops (it is not
 *   the Zombies box tune): plucked tines (a sine with a bright inharmonic partial and a fast decay),
 *   a lilting melody over a two-note bass, slightly detuned like a cheap music box.
 * - `ks_mbox_tick`: the weapon cycle's tick, a dry click with a tiny chime.
 * - `ks_mbox_thunder`: the lightning strike, a crack and a long rumble.
 * - `ks_mbox_land`: the box crashing in, a wooden thump and a shimmer.
 * - `ks_mbox_beam`: the beam of light shooting up, a rising hum.
 * - `ks_mbox_open`: the lid creaking open with a shimmer.
 * - `ks_mbox_whoosh`: the box flying off up the beam.
 * - `ks_mbox_byebye`: the loaned wonder weapon taken back, a goofy "bye-bye" and a cackle.
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

/** A music-box tine: fundamental, a bright inharmonic partial, quick attack, ringing decay. */
const tine = (t: number, f: number, decay = 1.6) => (t < 0 ? 0 : (Math.sin(2 * Math.PI * f * t) * 0.7 + Math.sin(2 * Math.PI * f * 4.07 * t) * 0.18 * Math.exp(-t * 9) + Math.sin(2 * Math.PI * f * 2 * t) * 0.12) * Math.min(1, t / 0.002) * Math.exp(-t * decay));

/**
 * The tune: an original 3/4 waltz in A minor turning to C major, 4 bars, 0.21 s per eighth.
 * [start in eighths, MIDI note, length in eighths] for the melody; the bass plucks on the beats.
 */
const MELODY: [number, number, number][] = [
  [0, 76, 2], [2, 72, 1], [3, 74, 1], [4, 76, 2],
  [6, 77, 1], [7, 76, 1], [8, 74, 2], [10, 71, 2],
  [12, 72, 2], [14, 74, 1], [15, 72, 1], [16, 69, 2],
  [18, 71, 2], [20, 67, 2], [22, 72, 4],
];
const BASS: [number, number][] = [
  [0, 45], [2, 52], [4, 52], [6, 41], [8, 48], [10, 48], [12, 43], [14, 50], [16, 50], [18, 43], [20, 47], [22, 48],
];
const EIGHTH = 0.21;

sfx.register('ks_mbox_jingle', (ctx) =>
  tone(ctx, 24 * EIGHTH + 1.6, (t) => {
    let s = 0;
    // A slow wobble, like a worn spring.
    const wob = 1 + Math.sin(t * 2 * Math.PI * 0.7) * 0.004;
    for (const [at, n] of MELODY) s += tine(t - at * EIGHTH, hz(n) * wob, 1.4);
    for (const [at, n] of BASS) s += tine(t - at * EIGHTH, hz(n + 12) * wob, 2.4) * 0.45;
    return s * 0.32;
  }),
);

sfx.register('ks_mbox_tick', (ctx) => tone(ctx, 0.08, (t) => (t < 0.004 ? noise() * (1 - t / 0.004) * 0.7 : 0) + Math.sin(2 * Math.PI * 2350 * t) * Math.exp(-t * 60) * 0.35));

sfx.register('ks_mbox_thunder', (ctx) => {
  let y = 0;
  let h = 0;
  const dur = 2.2;
  return tone(ctx, dur, (t, i) => {
    const crack = t < 0.06 ? noise() * (1 - t / 0.06) : 0;
    if (i % 14 === 0) h = noise();
    y += (h - y) * 0.06;
    const rumble = y * 3 * Math.min(1, t / 0.15) * Math.pow(1 - t / dur, 1.6) * (0.7 + 0.3 * Math.sin(t * 9));
    return crack * 0.9 + rumble * 0.8;
  });
});

sfx.register('ks_mbox_land', (ctx) => {
  const dur = 1.2;
  return tone(ctx, dur, (t) => {
    const thump = Math.sin(2 * Math.PI * (75 - 30 * t) * t) * Math.exp(-t * 6) * 1.1;
    const wood = t < 0.05 ? noise() * (1 - t / 0.05) * 0.7 : 0;
    const shimmer = (Math.sin(2 * Math.PI * 1760 * t) + Math.sin(2 * Math.PI * 2217 * t) + Math.sin(2 * Math.PI * 2637 * t)) * 0.08 * Math.exp(-t * 2.5) * Math.min(1, t / 0.05);
    return thump + wood + shimmer;
  });
});

sfx.register('ks_mbox_beam', (ctx) => {
  let ph = 0;
  const dur = 1.1;
  return tone(ctx, dur, (t, _i, sr) => {
    ph += (180 + 520 * (t / dur) ** 1.5) / sr;
    return (Math.sin(2 * Math.PI * ph) * 0.5 + Math.sin(4 * Math.PI * ph) * 0.2) * Math.min(1, t / 0.1) * Math.pow(1 - t / dur, 0.8) * 0.8;
  });
});

sfx.register('ks_mbox_open', (ctx) => {
  let y = 0;
  const dur = 0.9;
  return tone(ctx, dur, (t) => {
    // Creak: a slow pulse train through a resonance.
    const creak = t < 0.45 ? (Math.sin(2 * Math.PI * (300 + 120 * Math.sin(t * 20)) * t) > 0.6 ? 0.4 : -0.1) * Math.sin((t / 0.45) * Math.PI) : 0;
    y += (creak - y) * 0.2;
    const shimmer = (Math.sin(2 * Math.PI * 1318 * t) + Math.sin(2 * Math.PI * 1975 * t)) * 0.12 * Math.max(0, Math.min(1, (t - 0.2) / 0.1)) * Math.exp(-(t - 0.2) * 3);
    return y * 0.8 + shimmer;
  });
});

sfx.register('ks_mbox_whoosh', (ctx) => {
  let y = 0;
  let ph = 0;
  const dur = 1.8;
  return tone(ctx, dur, (t, _i, sr) => {
    const k = t / dur;
    y += (noise() - y) * (0.05 + 0.3 * k);
    ph += (300 + 900 * k) / sr;
    return (y * 1.6 + Math.sin(2 * Math.PI * ph) * 0.15) * Math.sin(k * Math.PI) * 0.8;
  });
});

/**
 * The box taking its weapon back: a goofy, original synthesized "bye-bye" (two falling vowel-ish
 * syllables from a buzzy voice through two formants) and a little cackle after.
 */
sfx.register('ks_mbox_byebye', (ctx) => {
  let ph = 0;
  let y1 = 0;
  let y2 = 0;
  // [start, length, pitch from, pitch to]: "bah-", "-bye", then three "ha"s.
  const syl: [number, number, number, number][] = [[0, 0.22, 260, 230], [0.26, 0.4, 300, 150], [0.75, 0.09, 330, 320], [0.88, 0.09, 310, 300], [1.01, 0.12, 290, 250]];
  return tone(ctx, 1.25, (t, _i, sr) => {
    const s = syl.find(([a, l]) => t >= a && t < a + l);
    if (!s) return 0;
    const k = (t - s[0]) / s[1];
    const f = s[2] + (s[3] - s[2]) * k;
    ph += f / sr;
    const buzz = (ph % 1) * 2 - 1;
    // Two one-pole resonators (the "a" to "i" of bye) shape the buzz into a voice.
    const f1 = 700 - 300 * k;
    const f2 = 1200 + 900 * k;
    y1 += (buzz - y1) * Math.min(1, (f1 / sr) * 6);
    y2 += (buzz - y2) * Math.min(1, (f2 / sr) * 6);
    const env = Math.min(1, k / 0.08) * Math.min(1, (1 - k) / 0.2);
    return (y1 * 0.6 + (buzz - y2) * 0.25 + noise() * 0.02) * env;
  });
});
