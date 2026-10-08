/**
 * Restrained synthesized radio cues for game events that have no fitting recording (objective
 * won/lost, round start, warnings, streak ready). Military-radio style: short sine pips at one pitch
 * (no melodies, no chords), a soft 4 ms attack/release so nothing clicks, and an optional burst of
 * band-limited squelch noise. Rendered by `scripts/sfx-build.ts` into `assets/sfx/<name>.mp3`
 * (recipe src `synth/<name>`) and by the client as the fallback until those files load.
 *
 * Pure (no DOM): shared by the build script, the client and the tests.
 */

interface Pip {
  at: number;
  dur: number;
  hz: number;
}
interface Squelch {
  at: number;
  dur: number;
}
interface Cue {
  pips: Pip[];
  squelch?: Squelch[];
  /** What it is for (the soundboard and docs show it). */
  about: string;
}

const pips = (hz: number, dur: number, starts: number[]): Pip[] => starts.map((at) => ({ at, dur, hz }));

export const SFX_CUES: Record<string, Cue> = {
  cue_good: { pips: pips(1000, 0.07, [0, 0.12]), about: 'two 1 kHz pips: objective taken, round won' },
  cue_bad: { pips: pips(560, 0.09, [0, 0.15]), about: 'two low 560 Hz pips: objective lost, round lost' },
  cue_round: { pips: pips(1000, 0.05, [0.06, 0.15, 0.24]), squelch: [{ at: 0, dur: 0.045 }], about: 'squelch + three pips: round start, halftime, HQ online' },
  cue_warn: { pips: pips(880, 0.045, [0, 0.08, 0.26, 0.34]), about: 'two quick pip pairs: bomb planted, enemy streak inbound' },
  cue_ready: { pips: pips(1300, 0.11, [0.05]), squelch: [{ at: 0, dur: 0.04 }, { at: 0.19, dur: 0.05 }], about: 'squelch, one pip, squelch: killstreak ready' },
};

/** Deterministic PRNG so builds are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
}

/** Render a cue at `sr` Hz, peak about 0.5. */
export function renderCue(name: string, sr: number): Float32Array {
  const cue = SFX_CUES[name];
  if (!cue) throw new Error(`no cue ${name}`);
  const end = Math.max(...cue.pips.map((p) => p.at + p.dur), ...(cue.squelch ?? []).map((q) => q.at + q.dur)) + 0.02;
  const out = new Float32Array(Math.ceil(end * sr));
  const ramp = 0.004;
  const env = (t: number, dur: number) => (t < ramp ? 0.5 - 0.5 * Math.cos((Math.PI * t) / ramp) : t > dur - ramp ? 0.5 - 0.5 * Math.cos((Math.PI * (dur - t)) / ramp) : 1);
  for (const p of cue.pips) {
    const o = Math.round(p.at * sr);
    const n = Math.round(p.dur * sr);
    for (let i = 0; i < n && o + i < out.length; i++) {
      const t = i / sr;
      // A touch of 2nd harmonic so it reads as a radio beep rather than a test tone.
      const v = Math.sin(2 * Math.PI * p.hz * t) + 0.12 * Math.sin(4 * Math.PI * p.hz * t);
      out[o + i]! += 0.45 * v * env(t, p.dur);
    }
  }
  const noise = rng(name.length * 7919);
  for (const q of cue.squelch ?? []) {
    const o = Math.round(q.at * sr);
    const n = Math.round(q.dur * sr);
    // Two one-pole stages: a crude 1-4 kHz band of noise, decaying.
    let lp = 0;
    let lp2 = 0;
    const a = 1 - Math.exp((-2 * Math.PI * 4000) / sr);
    const b = 1 - Math.exp((-2 * Math.PI * 1000) / sr);
    for (let i = 0; i < n && o + i < out.length; i++) {
      const t = i / sr;
      lp += (noise() - lp) * a;
      lp2 += (lp - lp2) * b;
      out[o + i]! += 0.5 * (lp - lp2) * env(t, q.dur) * Math.exp(-t / (q.dur * 0.6));
    }
  }
  return out;
}
