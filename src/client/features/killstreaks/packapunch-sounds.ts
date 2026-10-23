/**
 * Pack-a-Punch sounds, synthesized (no downloads; listed in SFX_SYNTH_ONLY):
 *
 * - `ks_pap_jingle`: the machine taking the gun. An ORIGINAL little phrase written for Lo-Fi Ops
 *   (not the Zombies machine tune): two heavy mechanical clunks, a hum spinning up, then a bright
 *   rising toy-organ arpeggio over a low drone, ~1.3 s, so it ends as the gun comes back up.
 * - `ks_pap_ding`: the gun coming out: a bell strike with a glassy shimmer.
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

/** A toy organ note: square-ish (odd harmonics), quick attack, short release. */
const organ = (t: number, f: number, len: number) => {
  if (t < 0 || t > len + 0.12) return 0;
  const env = Math.min(1, t / 0.008) * (t > len ? Math.max(0, 1 - (t - len) / 0.12) : 1) * (0.75 + 0.25 * Math.exp(-t * 8));
  const w = 2 * Math.PI * f * t;
  return (Math.sin(w) + Math.sin(3 * w) / 3 + Math.sin(5 * w) / 6) * env;
};

/** [start (s), MIDI note, length (s)]: an original rising phrase in E major, ending on a held high note. */
const PHRASE: [number, number, number][] = [
  [0.46, 64, 0.09], [0.56, 68, 0.09], [0.66, 71, 0.09], [0.76, 76, 0.09],
  [0.86, 73, 0.09], [0.96, 76, 0.09], [1.06, 80, 0.26],
];

sfx.register('ks_pap_jingle', (ctx) => {
  let lp = 0;
  return tone(ctx, 1.45, (t) => {
    // Two clunks: a low thump with a metallic rattle.
    let s = 0;
    for (const at of [0, 0.2]) {
      const k = t - at;
      if (k >= 0 && k < 0.25) {
        lp += (noise() - lp) * 0.3;
        s += Math.sin(2 * Math.PI * (90 - 120 * k) * k) * Math.exp(-k * 18) * 0.9 + lp * Math.exp(-k * 30) * 0.5;
      }
    }
    // The machine spinning up: a hum rising under everything.
    const hum = t > 0.25 ? Math.sin(2 * Math.PI * (55 + 50 * Math.min(1, (t - 0.25) / 0.8)) * t) * 0.18 * Math.min(1, (t - 0.25) / 0.2) * (t > 1.2 ? Math.max(0, 1 - (t - 1.2) / 0.25) : 1) : 0;
    let mel = 0;
    for (const [at, n, len] of PHRASE) mel += organ(t - at, hz(n), len);
    return s + hum + mel * 0.16;
  });
});

sfx.register('ks_pap_ding', (ctx) =>
  tone(ctx, 1.4, (t) => {
    const f = hz(88);
    const bell = (Math.sin(2 * Math.PI * f * t) * 0.6 + Math.sin(2 * Math.PI * f * 2.76 * t) * 0.25 * Math.exp(-t * 5) + Math.sin(2 * Math.PI * f * 5.4 * t) * 0.12 * Math.exp(-t * 9)) * Math.exp(-t * 2.6);
    const strike = t < 0.006 ? noise() * (1 - t / 0.006) * 0.5 : 0;
    const shimmer = (Math.sin(2 * Math.PI * 2637 * t + Math.sin(t * 40)) + Math.sin(2 * Math.PI * 3520 * t)) * 0.06 * Math.exp(-t * 3) * Math.min(1, t / 0.04);
    return bell + strike + shimmer;
  }),
);
