/**
 * Build the shipped sound effects from the raw recordings (see scripts/sfx-fetch.ts) and the
 * declarative recipes in src/shared/defs/sfx-recipes.ts. Needs ffmpeg (FFMPEG=/path, default
 * /opt/homebrew/bin/ffmpeg) with libmp3lame.
 *
 * Per recipe: ffmpeg trims the source slice, downmixes to mono, resamples to 22050 Hz, applies the
 * recipe's pitch / reverse / filters; this script snaps the start to the attack and fades; ffmpeg
 * measures EBU R128 loudness (momentary max) and true peak; the gain lands the file on its level's
 * loudness target without passing the level's peak ceiling; ffmpeg applies the gain and a light
 * bitcrush and encodes MP3 (MPEG-2 layer III, mono, 22050 Hz). Output: assets/sfx/<file>.mp3.
 *
 *   npx tsx scripts/sfx-build.ts                    build everything, print levels
 *   npx tsx scripts/sfx-build.ts --only=gun_ar_a    one file
 *   npx tsx scripts/sfx-build.ts --manifest         also refresh the "Shipped as" column in docs/audio/sfx-manifest.md
 *   npx tsx scripts/sfx-build.ts --reel=/path.wav   also render a demo reel of key sounds at in-game gains
 *   npx tsx scripts/sfx-build.ts --levels=/path.json  write the per-file measurements as JSON
 *   SFX_RAW=/path                                    raw folder (default: see scripts/sfx-sources.ts)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RECIPE_BY_FILE, SFX_BINDINGS, SFX_LEVELS, SFX_RECIPES, type SfxRecipe } from '../src/shared/defs/sfx-recipes';
import { DEFAULT_RAW, MANIFEST_PATH, parseManifest } from './sfx-sources';

const FFMPEG = process.env.FFMPEG ?? '/opt/homebrew/bin/ffmpeg';
const RAW = process.env.SFX_RAW ?? DEFAULT_RAW;
const OUT = resolve(import.meta.dirname, '../assets/sfx');
const SR = 22050;

const args = process.argv.slice(2);
const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const only = opt('only');
const reelPath = opt('reel');
const levelsPath = opt('levels');

function ffmpeg(argv: string[], input?: Buffer): { stdout: Buffer; stderr: string } {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostdin', ...argv], { input, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg ${argv.join(' ')}\n${r.stderr.toString()}`);
  return { stdout: r.stdout, stderr: r.stderr.toString() };
}

const f32 = (buf: Buffer) => new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
const bytes = (a: Float32Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const PCM_IN = ['-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', 'pipe:0'];

/** Decode a file (any format) to mono f32 at SR, through an optional filter chain. */
function decode(path: string, filters: string[] = []): Float32Array {
  const chain = [...filters, 'aformat=channel_layouts=mono', `aresample=${SR}`].join(',');
  return f32(ffmpeg(['-v', 'error', '-i', path, '-af', chain, '-f', 'f32le', '-']).stdout);
}

export interface Levels {
  /** EBU R128 momentary max (400 ms), integrated (LUFS), true peak (dBTP), sample peak (dBFS). */
  mMax: number;
  integrated: number;
  truePeak: number;
}

/** Measure loudness of mono f32 samples (padded so the 400 ms windows exist). */
function measure(a: Float32Array): Levels {
  const { stderr } = ffmpeg(['-v', 'info', ...PCM_IN, '-af', 'apad=pad_dur=0.5,ebur128=peak=true', '-f', 'null', '-'], bytes(a));
  let mMax = -120;
  for (const m of stderr.matchAll(/ M:\s*(-?[\d.]+)/g)) mMax = Math.max(mMax, Number(m[1]));
  const integrated = Number(/Integrated loudness:\s+I:\s+(-?[\d.]+|-inf)/.exec(stderr)?.[1] ?? -70);
  const truePeak = Number(/True peak:\s+Peak:\s+(-?[\d.]+|-inf)/.exec(stderr)?.[1] ?? -120);
  return { mMax, integrated: Number.isFinite(integrated) ? integrated : -70, truePeak: Number.isFinite(truePeak) ? truePeak : -120 };
}

const peakDb = (a: Float32Array) => {
  let p = 0;
  for (const v of a) p = Math.max(p, Math.abs(v));
  return 20 * Math.log10(p + 1e-12);
};

/** Trim, align and fade one recipe's slice; returns mono f32 at SR. */
function slice(r: SfxRecipe): Float32Array {
  const src = join(RAW, r.src);
  if (!existsSync(src)) throw new Error(`${r.file}: missing raw source ${src} (run scripts/sfx-fetch.ts)`);
  const rate = r.rate ?? 1;
  const extra = r.align === false ? 0 : 0.3;
  const filters = [`atrim=start=${r.start}:duration=${r.dur + extra}`, 'asetpts=PTS-STARTPTS', 'aformat=channel_layouts=mono', `aresample=${SR}`];
  if (r.reverse) filters.push('areverse');
  if (rate !== 1) filters.push(`asetrate=${Math.round(SR * rate)}`, `aresample=${SR}`);
  if (r.highpass) filters.push(`highpass=f=${r.highpass}`);
  if (r.lowpass) filters.push(`lowpass=f=${r.lowpass}`);
  if (r.echo) filters.push(`aecho=1:1:${r.echo.delays.join('|')}:${r.echo.decays.join('|')}`);
  const all = decode(src, filters);
  let from = 0;
  if (r.align !== false) {
    const thr = Math.pow(10, (r.align ?? -30) / 20) * Math.pow(10, peakDb(all.subarray(0, Math.round((r.dur / rate) * SR))) / 20);
    const hit = all.findIndex((v) => Math.abs(v) >= thr);
    from = Math.max(0, hit - Math.round(0.003 * SR));
  }
  const len = Math.min(all.length - from, Math.round((r.dur / rate) * SR));
  const a = all.slice(from, from + len);
  const fi = Math.round((r.fadeIn ?? (r.align === false ? 0.005 : 0.002)) * SR);
  for (let i = 0; i < Math.min(fi, a.length); i++) a[i]! *= i / fi;
  const fo = Math.min(a.length, Math.round((r.fadeOut ?? Math.min(0.3, (r.dur / rate) * 0.4)) * SR));
  for (let i = 0; i < fo; i++) {
    const k = (i + 1) / fo;
    a[a.length - fo + i]! *= (1 - k) * (1 - k);
  }
  return a;
}

interface Built extends Levels {
  file: string;
  level: string;
  dur: number;
  gainDb: number;
  samplePeak: number;
  kb: number;
}

function build(r: SfxRecipe): Built {
  const lv = SFX_LEVELS[r.level];
  const target = r.lufs ?? lv.lufs;
  const a = slice(r);
  const pre = measure(a);
  const ceiling = Math.pow(10, (lv.peak - 0.5) / 20).toFixed(4);
  // Gain towards the loudness target through a fast look-ahead limiter at the ceiling. Limiting
  // pulls the loudness down again on spiky recordings, so iterate; never push the peaks more than
  // `lv.limit` dB into the limiter.
  const maxGain = lv.peak - pre.truePeak + lv.limit;
  const crush = r.crush === false ? null : (r.crush ?? lv.crush ?? null);
  const out = join(OUT, `${r.file}.mp3`);
  let gainDb = Math.min(target - pre.mMax, maxGain);
  let dec = a;
  let m = pre;
  for (let i = 0; i < 6; i++) {
    const chain = [`volume=${gainDb.toFixed(2)}dB`, `alimiter=limit=${ceiling}:attack=1:release=15:level=disabled:latency=1`];
    if (crush) chain.push(`acrusher=bits=${crush.bits}:mix=${crush.mix}:mode=log:aa=1`);
    ffmpeg(['-v', 'error', '-y', ...PCM_IN, '-af', chain.join(','), '-c:a', 'libmp3lame', '-b:a', `${lv.kbps}k`, '-ar', String(SR), '-ac', '1', '-map_metadata', '-1', '-id3v2_version', '0', '-write_id3v1', '0', out], bytes(a));
    dec = decode(out);
    m = measure(dec);
    const miss = target - m.mMax;
    if (Math.abs(miss) < 0.5 || (miss > 0 && gainDb >= maxGain - 0.01)) break;
    gainDb = Math.min(maxGain, gainDb + miss);
  }
  return { file: r.file, level: r.level, dur: a.length / SR, gainDb, ...m, samplePeak: peakDb(dec), kb: statSync(out).size / 1024 };
}

// ---------------------------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
const recipes = only ? SFX_RECIPES.filter((r) => r.file === only) : SFX_RECIPES;
if (only && !recipes.length) throw new Error(`no recipe ${only}`);
const built: Built[] = [];
for (const r of recipes) {
  const b = build(r);
  built.push(b);
  console.log(`${b.file.padEnd(18)} ${b.level.padEnd(8)} ${b.dur.toFixed(2)}s  gain ${b.gainDb >= 0 ? '+' : ''}${b.gainDb.toFixed(1)} dB  M-max ${b.mMax.toFixed(1)} LUFS  I ${b.integrated.toFixed(1)}  TP ${b.truePeak.toFixed(1)} dBTP  peak ${b.samplePeak.toFixed(1)} dBFS  ${b.kb.toFixed(1)} KB`);
}

if (!only) {
  // Drop outputs that no recipe produces any more.
  const want = new Set(SFX_RECIPES.map((r) => `${r.file}.mp3`));
  for (const f of readdirSync(OUT)) if (!want.has(f)) {
    unlinkSync(join(OUT, f));
    console.log(`removed stale ${f}`);
  }
  const total = readdirSync(OUT).reduce((s, f) => s + statSync(join(OUT, f)).size, 0);
  console.log(`\n${SFX_RECIPES.length} files, ${(total / 1024).toFixed(0)} KB total in assets/sfx`);
}

if (levelsPath) writeFileSync(levelsPath, JSON.stringify(built, null, 2));

// ---------------------------------------------------------------------------------------------
// Manifest: refresh the "Shipped as" column (which output files came from each source).

/** `step_concrete_0, step_concrete_1...` -> `step_concrete_0-4`. */
function compact(files: string[]): string {
  const groups = new Map<string, number[]>();
  const out: string[] = [];
  for (const f of files) {
    const m = /^(.*_)(\d)$/.exec(f);
    if (m) groups.set(m[1]!, [...(groups.get(m[1]!) ?? []), Number(m[2])]);
    else out.push(`\`${f}\``);
  }
  for (const [p, ns] of groups) out.push(ns.length > 1 ? `\`${p}${Math.min(...ns)}\`-\`${Math.max(...ns)}\`` : `\`${p}${ns[0]}\``);
  return out.join(', ');
}

if (args.includes('--manifest')) {
  const text = readFileSync(MANIFEST_PATH, 'utf8');
  const sources = parseManifest(text);
  const byUrl = new Map(sources.map((s) => [s.url, s]));
  const prefix = /`FFSL = (https:[^`]+)`/.exec(text)![1]!;
  const lines = text.split('\n').map((line) => {
    if (!line.startsWith('|')) return line;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const has = cells.length === 5;
    const base = has ? cells.slice(0, 4) : cells;
    if (line.startsWith('|---')) return `|${['---', '---', '---', '---', '---'].join('|')}|`;
    if (base[0] === 'Sound') return `| ${[...base, 'Shipped as'].join(' | ')} |`;
    const ff = /^`FFSL` \+ `([^`]+)`/.exec(base[2] ?? '');
    const url = ff ? prefix + ff[1] : /(https:\/\/\S+)/.exec(base[2] ?? '')?.[1];
    const src = url ? byUrl.get(url) : undefined;
    if (!src) return line;
    const dir = src.file.replace(/\.zip$/, '/');
    const files = SFX_RECIPES.filter((r) => r.src === src.file || r.src.startsWith(dir)).map((r) => r.file);
    return `| ${[...base, files.length ? compact(files) : 'not shipped'].join(' | ')} |`;
  });
  writeFileSync(MANIFEST_PATH, lines.join('\n'));
  console.log('manifest: Shipped as column refreshed');
}

// ---------------------------------------------------------------------------------------------
// Demo reel: key sounds in sequence at roughly their in-game gain (caller volume x binding gain x
// weapon gain), with in-game levels measured per item.

/** `gap`: silence after the item; `every`: start the next item this long after this one starts instead. */
interface ReelItem { label: string; id: string; volume: number; gap: number; variant?: number; every?: number }

const REEL: ReelItem[] = [
  ...['m16', 'ak47', 'famas', 'mp5k', 'mpl', 'rpk', 'l96a1', 'dragunov', 'olympia', 'stakeout', 'spas12', 'm1911', 'python', 'asp', 'gl'].map((w) => ({ label: `shot.${w}`, id: `shot.${w}`, volume: 0.55, gap: 0.25 })),
  // An AK burst: five rounds at 600 rpm, rotating variants.
  ...[0, 1, 2, 3, 4].map((i) => ({ label: `ak47 auto ${i}`, id: 'shot.ak47', volume: 0.55, gap: 0.4, every: i < 4 ? 0.1 : undefined, variant: i })),
  { label: 'shot.m16 suppressed', id: 'shot.m16.sup', volume: 0.55, gap: 0.3 },
  { label: 'shot.m1911 suppressed', id: 'shot.m1911.sup', volume: 0.55, gap: 0.3 },
  { label: 'distant layer', id: 'shot.distant', volume: 0.5, gap: 0.3 },
  { label: 'reload: magout', id: 'weapons.magout', volume: 0.6, gap: 0.5 },
  { label: 'reload: magin', id: 'weapons.magin', volume: 0.7, gap: 0.3 },
  { label: 'reload: charge', id: 'weapons.charge', volume: 0.6, gap: 0.4 },
  { label: 'bolt', id: 'weapons.bolt', volume: 0.7, gap: 0.3 },
  { label: 'pump', id: 'weapons.pump', volume: 0.7, gap: 0.3 },
  { label: 'dry fire', id: 'click', volume: 0.5, gap: 0.3 },
  { label: 'hitmarker', id: 'tick', volume: 0.35, gap: 0.3 },
  { label: 'hurt', id: 'thud', volume: 0.6, gap: 0.3 },
  ...['concrete', 'grass', 'wood', 'metal', 'carpet'].map((s) => ({ label: `step.${s}`, id: `step.${s}`, volume: 0.5, gap: 0.25 })),
  { label: 'knife', id: 'weapons.knife', volume: 0.7, gap: 0.3 },
  { label: 'grenade pin', id: 'weapons.pin', volume: 0.5, gap: 0.3 },
  { label: 'frag', id: 'weapons.boom', volume: 1, gap: 0.3 },
  { label: 'flashbang', id: 'weapons.flashbang', volume: 0.8, gap: 0.3 },
  { label: 'streak ready', id: 'ks_ready', volume: 0.6, gap: 0.3 },
  { label: 'airstrike boom', id: 'ks_bigboom', volume: 1, gap: 0.3 },
  { label: 'objective good', id: 'modes.good', volume: 0.55, gap: 0.3 },
  { label: 'objective bad', id: 'modes.bad', volume: 0.55, gap: 0.3 },
  { label: 'round horn', id: 'modes.horn', volume: 0.55, gap: 0.3 },
];

if (reelPath) {
  const cache = new Map<string, Float32Array>();
  const load = (file: string) => {
    let a = cache.get(file);
    if (!a) cache.set(file, (a = decode(join(OUT, `${file}.mp3`))));
    return a;
  };
  const resample = (a: Float32Array, rate: number) => {
    if (rate === 1) return a;
    const out = new Float32Array(Math.floor(a.length / rate));
    for (let i = 0; i < out.length; i++) {
      const x = i * rate;
      const j = Math.floor(x);
      out[i] = (a[j] ?? 0) * (1 - (x - j)) + (a[j + 1] ?? 0) * (x - j);
    }
    return out;
  };
  const parts: { at: number; a: Float32Array; label: string }[] = [];
  let t = 0.3;
  const rows: string[] = [];
  for (const item of REEL) {
    const b = SFX_BINDINGS[item.id];
    if (!b) throw new Error(`reel: no binding ${item.id}`);
    const file = b.files[(item.variant ?? 0) % b.files.length]!;
    if (!RECIPE_BY_FILE.has(file)) throw new Error(`reel: no recipe ${file}`);
    const g = item.volume * (b.gain ?? 1);
    const a = resample(load(file), b.rate ?? 1).map((v) => v * g);
    parts.push({ at: t, a, label: item.label });
    const m = measure(a);
    rows.push(`${item.label.padEnd(22)} ${file.padEnd(16)} gain ${(20 * Math.log10(g)).toFixed(1).padStart(5)} dB  M-max ${m.mMax.toFixed(1).padStart(6)} LUFS  TP ${m.truePeak.toFixed(1).padStart(6)} dBTP`);
    t += item.every ?? a.length / SR + item.gap;
  }
  const mix = new Float32Array(Math.ceil((t + 0.5) * SR));
  for (const p of parts) {
    const o = Math.round(p.at * SR);
    for (let i = 0; i < p.a.length; i++) mix[o + i]! += p.a[i]!;
  }
  ffmpeg(['-v', 'error', '-y', ...PCM_IN, '-c:a', 'pcm_s16le', reelPath], bytes(mix));
  console.log(`\nDemo reel (${t.toFixed(1)} s) -> ${reelPath}\nIn-game levels (caller volume x binding gain, before panning/distance and the master bus):`);
  for (const r of rows) console.log('  ' + r);
  const whole = measure(mix);
  console.log(`  reel overall: I ${whole.integrated.toFixed(1)} LUFS, TP ${whole.truePeak.toFixed(1)} dBTP, peak ${peakDb(mix).toFixed(1)} dBFS`);
}
