/**
 * Audit the shipped sound effects without listening: loudness, true peak, clipping, abrupt
 * cut-offs and a tonality scan (is there a strong sustained pitch, like a horn or a beep?), plus
 * optional spectrogram PNGs to look at. Needs ffmpeg (FFMPEG=/path, default /opt/homebrew/bin/ffmpeg).
 *
 *   npx tsx scripts/sfx-audit.ts                       every file in assets/sfx
 *   npx tsx scripts/sfx-audit.ts a.mp3 b.wav@1.2:0.5   any files (optionally a slice: @start:dur seconds)
 *   --spectro=/dir     write <dir>/<name>.png spectrograms (and 3x4 contact sheets <dir>/sheet_NN.png)
 *   --json=/path       write the measurements as JSON
 *
 * Tonality, on 93 ms frames every 11.6 ms (22050 Hz analysis), over frames within 30 dB of the
 * file's loudest:
 * - `flatness`: mean spectral flatness, 150 Hz-6 kHz (~0 = pure tone, ~0.3+ = noisy).
 * - `pitched`: share of frames where a McLeod NSDF pitch detector is confident (clarity >= 0.85,
 *   f0 150-3000 Hz): one clear periodic voice.
 * - `track` / `trackHz`: the longest-lived spectral partial: a peak standing >= 18 dB above its
 *   +-200 Hz neighbourhood (and within 30 dB of the frame's top peak, 150 Hz-6 kHz) that persists
 *   frame to frame within 2.5% (a held note, a chord voice, a slow glide). Horns, beeps, whistles
 *   and ringing show long tracks; gunshots, impacts and foley do not. TONAL = track >= 0.25 s.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const FFMPEG = process.env.FFMPEG ?? '/opt/homebrew/bin/ffmpeg';
const SR = 22050;
const N = 2048;
const HOP = 256;

function ffmpeg(argv: string[], input?: Buffer): { stdout: Buffer; stderr: string } {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostdin', ...argv], { input, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg ${argv.join(' ')}\n${r.stderr.toString()}`);
  return { stdout: r.stdout, stderr: r.stderr.toString() };
}

const f32 = (buf: Buffer) => new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));

function decode(path: string, sr: number, start?: number, dur?: number): Float32Array {
  const trim = start !== undefined ? [`atrim=start=${start}:duration=${dur ?? 999}`, 'asetpts=PTS-STARTPTS'] : [];
  const chain = [...trim, 'aformat=channel_layouts=mono', `aresample=${sr}`].join(',');
  return f32(ffmpeg(['-v', 'error', '-i', path, '-af', chain, '-f', 'f32le', '-']).stdout);
}

/** Radix-2 FFT in place. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const cr = Math.cos(ang * k);
        const ci = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
      }
    }
  }
}

export interface Tonality {
  flatness: number;
  pitched: number;
  track: number;
  trackHz: number;
}

export function tonality(a: Float32Array): Tonality {
  const hann = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const bin = SR / N;
  const lo = Math.floor(150 / bin);
  const hi = Math.ceil(6000 / bin);
  const nb = Math.round(200 / bin);
  const frames: { db: number; flat: number; clarity: number; peaks: number[] }[] = [];
  for (let s = 0; s + N <= a.length; s += HOP) {
    const x = a.subarray(s, s + N);
    let e = 0;
    for (const v of x) e += v * v;
    const db = 10 * Math.log10(e / N + 1e-20);
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[i]! * hann[i]!;
    fft(re, im);
    const p = new Float64Array(N / 2);
    for (let k = 0; k < N / 2; k++) p[k] = re[k]! * re[k]! + im[k]! * im[k]! + 1e-20;
    let lg = 0;
    let ar = 0;
    for (let k = lo; k < hi; k++) {
      lg += Math.log(p[k]!);
      ar += p[k]!;
    }
    const flat = Math.exp(lg / (hi - lo)) / (ar / (hi - lo));
    // Prominent partials.
    let top = 0;
    for (let k = lo; k < hi; k++) top = Math.max(top, p[k]!);
    const peaks: number[] = [];
    for (let k = lo; k < hi; k++) {
      if (!(p[k]! > p[k - 1]! && p[k]! >= p[k + 1]!) || p[k]! < top * 1e-3) continue;
      const hood: number[] = [];
      for (let j = Math.max(1, k - nb); j <= Math.min(N / 2 - 1, k + nb); j++) if (Math.abs(j - k) > 2) hood.push(p[j]!);
      hood.sort((u, v) => u - v);
      const med = hood[hood.length >> 1]!;
      if (10 * Math.log10(p[k]! / med) >= 18) {
        // Parabolic interpolation for a finer frequency.
        const l = Math.log(p[k - 1]!);
        const c = Math.log(p[k]!);
        const r = Math.log(p[k + 1]!);
        const d = (0.5 * (l - r)) / (l - 2 * c + r || 1);
        peaks.push((k + d) * bin);
      }
    }
    // McLeod NSDF pitch clarity (unwindowed autocorrelation via FFT, zero padded).
    const M = N * 2;
    const r2 = new Float64Array(M);
    const i2 = new Float64Array(M);
    for (let i = 0; i < N; i++) r2[i] = x[i]!;
    fft(r2, i2);
    for (let k = 0; k < M; k++) {
      r2[k] = r2[k]! * r2[k]! + i2[k]! * i2[k]!;
      i2[k] = 0;
    }
    fft(r2, i2);
    const sq = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) sq[i + 1] = sq[i]! + x[i]! * x[i]!;
    const tmin = Math.floor(SR / 3000);
    const tmax = Math.ceil(SR / 150);
    let t = 1;
    const ns = (k: number) => {
      const m = sq[N - k]! + (sq[N]! - sq[k]!);
      return m > 0 ? (2 * (r2[k]! / M)) / m : 0;
    };
    while (t < tmax && ns(t) > 0) t++;
    const keys: { t: number; v: number }[] = [];
    while (t < tmax) {
      while (t < tmax && ns(t) <= 0) t++;
      let best = { t, v: -1 };
      while (t < tmax && ns(t) > 0) {
        const v = ns(t);
        if (v > best.v) best = { t, v };
        t++;
      }
      if (best.v > 0 && best.t >= tmin) keys.push(best);
    }
    const kmax = Math.max(0, ...keys.map((k) => k.v));
    const pick = keys.find((k) => k.v >= 0.9 * kmax);
    frames.push({ db, flat, clarity: pick ? pick.v : 0, peaks });
  }
  if (!frames.length) return { flatness: 1, pitched: 0, track: 0, trackHz: 0 };
  const maxDb = Math.max(...frames.map((f) => f.db));
  const loud = frames.map((f) => f.db > maxDb - 30);
  const nLoud = Math.max(1, loud.filter(Boolean).length);
  const flatness = frames.reduce((s, f, i) => s + (loud[i] ? f.flat : 0), 0) / nLoud;
  const pitched = frames.filter((f, i) => loud[i] && f.clarity >= 0.85).length / nLoud;
  // Partial tracking: extend live tracks with the closest peak within 2.5%.
  let best = { len: 0, hz: 0 };
  let live: { hz: number; len: number; sum: number }[] = [];
  frames.forEach((f, i) => {
    const next: typeof live = [];
    const used = new Set<number>();
    if (loud[i]) {
      for (const tr of live) {
        let j = -1;
        let dist = 0.025;
        f.peaks.forEach((hz, k) => {
          const d = Math.abs(Math.log(hz / tr.hz));
          if (!used.has(k) && d < dist) {
            dist = d;
            j = k;
          }
        });
        if (j >= 0) {
          used.add(j);
          next.push({ hz: f.peaks[j]!, len: tr.len + 1, sum: tr.sum + f.peaks[j]! });
        }
      }
      f.peaks.forEach((hz, k) => !used.has(k) && next.push({ hz, len: 1, sum: hz }));
    }
    for (const tr of next) if (tr.len > best.len) best = { len: tr.len, hz: tr.sum / tr.len };
    live = next;
  });
  return { flatness, pitched, track: best.len > 1 ? ((best.len - 1) * HOP) / SR : 0, trackHz: best.hz };
}

export interface Audit extends Tonality {
  name: string;
  dur: number;
  integrated: number;
  mMax: number;
  truePeak: number;
  /** Runs of 3+ samples at or above -0.1 dBFS. */
  clipRuns: number;
  /** Level of the last 10 ms relative to the loudest 10 ms (dB): above about -45 is an abrupt cut. */
  tailDb: number;
  /**
   * Biggest drop between consecutive 5 ms blocks into near-silence (< -60 dB re the loudest block):
   * a sound that stops dead mid-file (an edit in the source) shows 30+ dB; natural decays and fades
   * don't.
   */
  stopDb: number;
}

export function audit(path: string, start?: number, dur?: number): Audit {
  const full = decode(path, 44100, start, dur);
  const { stderr } = ffmpeg(['-v', 'info', '-f', 'f32le', '-ar', '44100', '-ac', '1', '-i', 'pipe:0', '-af', 'apad=pad_dur=0.5,ebur128=peak=true', '-f', 'null', '-'], Buffer.from(full.buffer));
  let mMax = -120;
  for (const m of stderr.matchAll(/ M:\s*(-?[\d.]+)/g)) mMax = Math.max(mMax, Number(m[1]));
  const num = (re: RegExp, d: number) => {
    const v = Number(re.exec(stderr)?.[1]);
    return Number.isFinite(v) ? v : d;
  };
  const integrated = num(/Integrated loudness:\s+I:\s+(-?[\d.]+)/, -70);
  const truePeak = num(/True peak:\s+Peak:\s+(-?[\d.]+)/, -120);
  let clipRuns = 0;
  for (let i = 0, n = 0; i <= full.length; i++) {
    if (i < full.length && Math.abs(full[i]!) >= 0.9886) n++;
    else {
      if (n >= 3) clipRuns++;
      n = 0;
    }
  }
  const blk = 441;
  let maxE = 1e-20;
  for (let s = 0; s + blk <= full.length; s += blk) {
    let e = 0;
    for (let i = s; i < s + blk; i++) e += full[i]! * full[i]!;
    maxE = Math.max(maxE, e / blk);
  }
  let te = 0;
  const tail = full.subarray(Math.max(0, full.length - blk));
  for (const v of tail) te += v * v;
  const tailDb = 10 * Math.log10((te / Math.max(1, tail.length) + 1e-20) / maxE);
  const b5 = 220;
  const lv: number[] = [];
  for (let s = 0; s + b5 <= full.length; s += b5) {
    let e = 0;
    for (let i = s; i < s + b5; i++) e += full[i]! * full[i]!;
    lv.push(10 * Math.log10(e / b5 + 1e-20));
  }
  const top = Math.max(...lv, -200);
  let stopDb = 0;
  for (let i = 1; i < lv.length; i++) if (lv[i]! < top - 60) stopDb = Math.max(stopDb, lv[i - 1]! - lv[i]!);
  const t = tonality(decode(path, SR, start, dur));
  return { name: basename(path).replace(/\.\w+$/, '') + (start !== undefined ? `@${start}` : ''), dur: full.length / 44100, integrated, mMax, truePeak, clipRuns, tailDb, stopDb, ...t };
}

export function spectrogram(path: string, png: string): void {
  ffmpeg(['-v', 'error', '-y', '-i', path, '-lavfi', 'aformat=channel_layouts=mono,apad=pad_dur=0.05,showspectrumpic=s=640x240:legend=1:scale=log:fscale=lin:color=intensity:drange=100:win_func=hann', png]);
}

export const fmtAudit = (a: Audit): string => {
  const flag = [a.track >= 0.25 ? 'TONAL' : '', a.clipRuns ? 'CLIP' : '', a.tailDb > -45 ? 'CUT' : '', a.stopDb >= 30 ? 'STOP' : '', a.truePeak > -0.5 ? 'HOT' : ''].filter(Boolean).join(' ');
  return `${a.name.padEnd(22)} ${a.dur.toFixed(2)}s  I ${a.integrated.toFixed(1).padStart(6)}  Mmax ${a.mMax.toFixed(1).padStart(6)}  TP ${a.truePeak.toFixed(1).padStart(5)}  flat ${a.flatness.toFixed(2)}  pitched ${(a.pitched * 100).toFixed(0).padStart(3)}%  track ${a.track.toFixed(2)}s @ ${a.trackHz.toFixed(0).padStart(4)} Hz  tail ${a.tailDb.toFixed(0).padStart(4)} dB  stop ${a.stopDb.toFixed(0).padStart(3)} dB  ${flag}`;
};

// ---------------------------------------------------------------------------------------------

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const spectro = opt('spectro');
  const json = opt('json');
  let targets = args.filter((a) => !a.startsWith('--'));
  if (!targets.length) {
    const dir = resolve(import.meta.dirname, '../assets/sfx');
    targets = readdirSync(dir).filter((f) => f.endsWith('.mp3')).sort().map((f) => join(dir, f));
  }
  if (spectro) mkdirSync(spectro, { recursive: true });
  const rows: Audit[] = [];
  const pngs: string[] = [];
  for (const t of targets) {
    const m = /^(.*)@([\d.]+):([\d.]+)$/.exec(t);
    const path = m ? m[1]! : t;
    const a = audit(path, m ? Number(m[2]) : undefined, m ? Number(m[3]) : undefined);
    rows.push(a);
    console.log(fmtAudit(a));
    if (spectro && !m) {
      const png = join(spectro, `${a.name}.png`);
      spectrogram(path, png);
      pngs.push(png);
    }
  }
  if (spectro && pngs.length) {
    // Contact sheets, 3 columns x 4 rows, in file order (listed in sheets.txt).
    const lines: string[] = [];
    for (let s = 0; s * 12 < pngs.length; s++) {
      const group = pngs.slice(s * 12, s * 12 + 12);
      const n = group.length;
      const cols = Math.min(3, n);
      const layout = group.map((_, i) => `${['0', 'w0', 'w0+w0'][i % 3]}_${Math.floor(i / 3) ? Array.from({ length: Math.floor(i / 3) }, () => 'h0').join('+') : '0'}`).join('|');
      const out = join(spectro, `sheet_${String(s).padStart(2, '0')}.png`);
      if (n === 1) ffmpeg(['-v', 'error', '-y', '-i', group[0]!, out]);
      else ffmpeg(['-v', 'error', '-y', ...group.flatMap((p) => ['-i', p]), '-filter_complex', `xstack=inputs=${n}:layout=${layout}:fill=black`, out]);
      lines.push(`${basename(out)} (${cols} per row): ${group.map((p) => basename(p, '.png')).join(', ')}`);
    }
    writeFileSync(join(spectro, 'sheets.txt'), lines.join('\n') + '\n');
  }
  if (json) writeFileSync(json, JSON.stringify(rows, null, 2));
}
