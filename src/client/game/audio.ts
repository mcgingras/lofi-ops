/**
 * Game sound (WebAudio). Two kinds of voice per sound id:
 * - recorded samples (`sfx.registerSample(id, binding)`; the ids and their files are declared in
 *   shared/defs/sfx-recipes.ts and registered below), fetched lazily from /sfx/<file>.mp3 and
 *   decoded once;
 * - synthesized buffers (`sfx.register(id, makeBuffer)`), the lo-fi originals, which play until
 *   an id's samples have loaded and whenever they fail to, so nothing goes silent.
 *
 * `sfx.play(id, opts)` plays one; positional when `opts.at` is given (PannerNode, listener follows
 * the camera, darker with distance). Samples rotate variants and vary pitch/volume per play; each
 * id has a voice cap. Mix: positional sounds -> world bus (ducked under your own gunshots),
 * others -> local bus; both -> master volume -> glue compressor -> limiter -> speakers.
 */
import { DISTANT_RATE, SFX_BINDINGS, type SfxBinding } from '../../shared/defs/sfx-recipes';
import { WEAPON_BY_ID, type WeaponClass } from '../../shared/defs/weapons';
import { airLowpass, distanceMix, jitterGain, jitterRate, leadingSilence, pickVariant, VoicePool } from './sfx-mix';

export interface PlayOpts {
  /** World position (positional); omit for UI/local sounds. */
  at?: { x: number; y: number; z: number };
  volume?: number;
  rate?: number;
  /** Low-pass cutoff (Hz). Positional sounds get a distance low-pass when this is omitted. */
  lowpass?: number;
  /** Panner range for positional sounds: 'far' carries much further (distant gunfire layer). */
  range?: 'near' | 'far';
}

type BufferMaker = (ctx: AudioContext) => AudioBuffer;

const CLASS_TONE: Record<WeaponClass, { rate: number; lowpass: number; vol: number }> = {
  ar: { rate: 1, lowpass: 2200, vol: 0.3 },
  smg: { rate: 1.18, lowpass: 2600, vol: 0.26 },
  lmg: { rate: 0.9, lowpass: 2000, vol: 0.32 },
  sniper: { rate: 0.7, lowpass: 1700, vol: 0.4 },
  shotgun: { rate: 0.62, lowpass: 1500, vol: 0.42 },
  pistol: { rate: 1.3, lowpass: 2800, vol: 0.24 },
  launcher: { rate: 0.5, lowpass: 900, vol: 0.4 },
  special: { rate: 1, lowpass: 2200, vol: 0.3 },
};

/** Recorded gunshot gains: your own gun (head-locked) and remote guns (before the panner's roll-off). */
const OWN_GUN = 0.55;
const REMOTE_GUN = 0.8;
/** World bus level while your own gun fires (CoD-style ducking). */
const DUCK = 0.6;
const GLOBAL_VOICES = 48;
const DEFAULT_VOICES = 6;

interface Sample {
  binding: SfxBinding;
  last: number;
}

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private world: GainNode | null = null;
  private local: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private makers = new Map<string, BufferMaker>();
  private samples = new Map<string, Sample>();
  /** Decoded sample files, and files being fetched / failed. */
  private decoded = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<void>>();
  private failed = new Set<string>();
  private voices = new VoicePool<Voice>(GLOBAL_VOICES);
  private pos = { x: 0, y: 0, z: 0 };
  private volume = 0.7;
  /** Base URL of the sample files. */
  baseUrl = `${import.meta.env?.BASE_URL ?? '/'}sfx/`;

  constructor() {
    this.register('shot', (ctx) => {
      const len = (0.28 * ctx.sampleRate) | 0;
      const b = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = b.getChannelData(0);
      let hold = 0;
      for (let i = 0; i < len; i++) {
        if (i % 4 === 0) hold = Math.random() * 2 - 1;
        d[i] = hold * Math.pow(1 - i / len, 3.2);
      }
      return b;
    });
    this.register('tick', (ctx) => tone(ctx, 0.05, (t) => (Math.sin(t * 2 * Math.PI * 1900) > 0 ? 1 : -1) * Math.pow(1 - t / 0.05, 2) * 0.5));
    this.register('thud', (ctx) => {
      let hold = 0;
      return tone(ctx, 0.22, (t, i) => {
        if (i % 16 === 0) hold = Math.random() * 2 - 1;
        return (hold * 0.6 + Math.sin(t * 2 * Math.PI * 70)) * Math.pow(1 - t / 0.22, 2.5) * 0.7;
      });
    });
    this.register('step', (ctx) => {
      let hold = 0;
      return tone(ctx, 0.07, (t, i) => {
        if (i % 6 === 0) hold = Math.random() * 2 - 1;
        return hold * Math.pow(1 - t / 0.07, 4) * 0.5;
      });
    });
    this.register('click', (ctx) => tone(ctx, 0.03, (t) => (Math.random() * 2 - 1) * Math.pow(1 - t / 0.03, 3)));
    this.register('reload', (ctx) => {
      // two mechanical clacks
      return tone(ctx, 0.3, (t) => {
        const a = t < 0.04 ? Math.pow(1 - t / 0.04, 3) : 0;
        const b = t > 0.2 && t < 0.25 ? Math.pow(1 - (t - 0.2) / 0.05, 3) : 0;
        return (Math.random() * 2 - 1) * (a + b) * 0.6;
      });
    });
    for (const [id, b] of Object.entries(SFX_BINDINGS)) this.registerSample(id, b);
  }

  /** Lazily create the AudioContext (needs a user gesture first; call from input handlers). */
  unlock(): void {
    try {
      if (!this.ctx) {
        const ctx = new AudioContext();
        this.ctx = ctx;
        // Glue compressor then a fast limiter, so a pile of explosions can't clip.
        const glue = ctx.createDynamicsCompressor();
        glue.threshold.value = -18;
        glue.knee.value = 12;
        glue.ratio.value = 3;
        glue.attack.value = 0.004;
        glue.release.value = 0.2;
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -3;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.001;
        limiter.release.value = 0.08;
        this.master = ctx.createGain();
        this.master.gain.value = this.volume;
        this.world = ctx.createGain();
        this.local = ctx.createGain();
        this.world.connect(this.master);
        this.local.connect(this.master);
        this.master.connect(glue).connect(limiter).connect(ctx.destination);
        const l = ctx.listener;
        if (l.positionX === undefined) l.setPosition(0, 0, 0);
        this.preload();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      /* no audio */
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** A synthesized voice (also the fallback for a recorded id until its samples load). */
  register(id: string, make: BufferMaker): void {
    this.makers.set(id, make);
    this.buffers.delete(id);
  }

  /** Recorded variants for an id (files in /sfx/<file>.mp3), loaded lazily. */
  registerSample(id: string, binding: SfxBinding): void {
    this.samples.set(id, { binding, last: -1 });
  }

  /** Every id with a synthesized or recorded voice. */
  registeredIds(): string[] {
    return [...new Set([...this.makers.keys(), ...this.samples.keys()])];
  }

  hasSynth(id: string): boolean {
    return this.makers.has(id);
  }

  /** True once at least one of the id's sample files has decoded. */
  sampleReady(id: string): boolean {
    const s = this.samples.get(id);
    return !!s && s.binding.files.some((f) => this.decoded.has(f));
  }

  private has(id: string): boolean {
    return this.makers.has(id) || this.samples.has(id);
  }

  private buffer(id: string): AudioBuffer | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    let b = this.buffers.get(id);
    if (!b) {
      const make = this.makers.get(id);
      if (!make) return null;
      b = make(ctx);
      this.buffers.set(id, b);
    }
    return b;
  }

  /** Fetch and decode one sample file (once). Failures leave the synth voice in place. */
  private load(file: string): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || this.decoded.has(file) || this.failed.has(file)) return Promise.resolve();
    let p = this.loading.get(file);
    if (!p) {
      p = (async () => {
        try {
          const res = await fetch(`${this.baseUrl}${file}.mp3`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          this.decoded.set(file, trimLead(ctx, buf));
        } catch {
          this.failed.add(file);
        } finally {
          this.loading.delete(file);
        }
      })();
      this.loading.set(file, p);
    }
    return p;
  }

  /** Load every registered sample in the background, a few at a time. */
  preload(): Promise<void> {
    const files = [...new Set([...this.samples.values()].flatMap((s) => s.binding.files))];
    let next = 0;
    const worker = async () => {
      while (next < files.length) await this.load(files[next++]!);
    };
    return Promise.all([worker(), worker(), worker(), worker()]).then(() => undefined);
  }

  /** Camera pose for positional sound. `fx,fz` forward on the ground plane. */
  listener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    this.pos = { x, y, z };
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setValueAtTime(x, t);
      l.positionY.setValueAtTime(y, t);
      l.positionZ.setValueAtTime(z, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(fy, t);
      l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(x, y, z);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  private distanceTo(at: { x: number; y: number; z: number }): number {
    return Math.hypot(at.x - this.pos.x, at.y - this.pos.y, at.z - this.pos.z);
  }

  play(id: string, o: PlayOpts = {}): void {
    const ctx = this.ctx;
    const world = this.world;
    const local = this.local;
    if (!ctx || !world || !local || ctx.state !== 'running') return;
    let buf: AudioBuffer | null = null;
    let rate = o.rate ?? 1;
    let volume = o.volume ?? 1;
    let lowpass = o.lowpass;
    let highpass: number | undefined;
    const s = this.samples.get(id);
    if (s) {
      const b = s.binding;
      const ready = b.files.filter((f) => this.decoded.has(f));
      if (ready.length < b.files.length) for (const f of b.files) void this.load(f);
      if (ready.length) {
        s.last = pickVariant(ready.length, s.last);
        buf = this.decoded.get(ready[s.last]!)!;
        rate = jitterRate(rate * (b.rate ?? 1), b.pitchJitter ?? 0);
        volume = jitterGain(volume * (b.gain ?? 1), b.volJitter ?? 0);
        if (b.lowpass) lowpass = Math.min(lowpass ?? Infinity, b.lowpass);
        highpass = b.highpass;
      } else buf = this.buffer(id) ?? (b.fallback ? this.buffer(b.fallback) : null);
    } else buf = this.buffer(id);
    if (!buf) return;
    if (o.at && lowpass === undefined) lowpass = airLowpass(this.distanceTo(o.at)) ?? undefined;
    try {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      let node: AudioNode = src;
      if (lowpass && lowpass < ctx.sampleRate / 2) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = lowpass;
        node = node.connect(f);
      }
      if (highpass) {
        const f = ctx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = highpass;
        node = node.connect(f);
      }
      const g = ctx.createGain();
      g.gain.value = volume;
      node = node.connect(g);
      if (o.at) {
        const p = ctx.createPanner();
        p.panningModel = 'equalpower';
        p.distanceModel = 'inverse';
        const far = o.range === 'far';
        p.refDistance = far ? 20 : 4;
        p.rolloffFactor = far ? 0.6 : 1.2;
        p.maxDistance = far ? 400 : 200;
        if (p.positionX) {
          p.positionX.value = o.at.x;
          p.positionY.value = o.at.y;
          p.positionZ.value = o.at.z;
        } else p.setPosition(o.at.x, o.at.y, o.at.z);
        node = node.connect(p);
      }
      node.connect(o.at ? world : local);
      const voice: Voice = { src, gain: g };
      for (const old of this.voices.add(id, voice, s?.binding.maxVoices ?? DEFAULT_VOICES, ctx.currentTime)) {
        const t = ctx.currentTime;
        old.gain.gain.setTargetAtTime(0, t, 0.012);
        try {
          old.src.stop(t + 0.06);
        } catch {
          /* already stopped */
        }
      }
      src.onended = () => {
        this.voices.remove(id, voice);
        node.disconnect();
      };
      src.start();
    } catch {
      /* ignore */
    }
  }

  /** Briefly pull the world down under your own gunshot. */
  private duck(): void {
    const w = this.world;
    const ctx = this.ctx;
    if (!w || !ctx) return;
    const t = ctx.currentTime;
    w.gain.cancelScheduledValues(t);
    w.gain.setTargetAtTime(DUCK, t, 0.006);
    w.gain.setTargetAtTime(1, t + 0.07, 0.12);
  }

  /**
   * A gunshot for a weapon id. Recorded voices are `shot.<weaponId>` / `shot.<weaponId>.sup`
   * (shared/defs/sfx-recipes.ts); remote shots blend in the distant recording and darken with
   * distance; your own shot ducks the world. Until the samples load (or if they fail): the
   * synthesized per-weapon voice, else the class-toned core `shot`.
   */
  gunshot(weaponId: string, at?: PlayOpts['at'], suppressed = false): void {
    const sup = `shot.${weaponId}.sup`;
    const base = `shot.${weaponId}`;
    const own = suppressed && this.has(sup) ? sup : this.has(base) ? base : null;
    const cls = WEAPON_BY_ID.get(weaponId)?.class ?? 'ar';
    if (!at) this.duck();
    const mix = at ? distanceMix(this.distanceTo(at)) : { lowpass: null, near: 1, far: 0 };
    if (own && this.sampleReady(own)) {
      const muffled = suppressed && own !== sup;
      this.play(own, { at, volume: (at ? REMOTE_GUN : OWN_GUN) * mix.near * (muffled ? 0.45 : 1), lowpass: muffled ? 900 : (mix.lowpass ?? undefined) });
      if (at && !suppressed && cls !== 'special' && mix.far > 0.02) this.play('shot.distant', { at, volume: REMOTE_GUN * mix.far, rate: DISTANT_RATE[cls], range: 'far' });
      return;
    }
    if (own) {
      this.play(own, { at, rate: 0.96 + Math.random() * 0.08, lowpass: suppressed && !own.endsWith('.sup') ? 900 : (mix.lowpass ?? undefined), volume: (suppressed ? 0.45 : 1) * (at ? 2.2 : 1) * 0.5 });
      return;
    }
    const t = CLASS_TONE[cls];
    this.play('shot', { at, rate: t.rate * (0.92 + Math.random() * 0.12), lowpass: suppressed ? 700 : t.lowpass, volume: (suppressed ? 0.35 : 1) * t.vol * (at ? 2.2 : 1) });
  }
}

/** Drop the MP3 decoder delay some browsers leave at the start of a decoded clip. */
function trimLead(ctx: AudioContext, b: AudioBuffer): AudioBuffer {
  const d = b.getChannelData(0);
  const skip = leadingSilence(d, b.sampleRate);
  if (!skip) return b;
  const out = ctx.createBuffer(b.numberOfChannels, b.length - skip, b.sampleRate);
  for (let c = 0; c < b.numberOfChannels; c++) out.copyToChannel(b.getChannelData(c).subarray(skip), c);
  return out;
}

function tone(ctx: AudioContext, dur: number, f: (t: number, i: number) => number): AudioBuffer {
  const len = Math.max(1, (dur * ctx.sampleRate) | 0);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = f(i / ctx.sampleRate, i);
  return b;
}

export const sfx = new Sfx();
