/**
 * Lo-fi synthesized sound (WebAudio). The gunshot is the prototype's: sample-and-hold noise with a
 * cubic decay through a low-pass, pitched per weapon class. Remote sounds are positional
 * (PannerNode, listener follows the camera). `sfx.register(id, makeBuffer)` lets features add
 * sounds; `sfx.play(id, opts)` plays one.
 */
import { WEAPON_BY_ID, type WeaponClass } from '../../shared/defs/weapons';

export interface PlayOpts {
  /** World position (positional); omit for UI/local sounds. */
  at?: { x: number; y: number; z: number };
  volume?: number;
  rate?: number;
  /** Low-pass cutoff (Hz). */
  lowpass?: number;
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

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private makers = new Map<string, BufferMaker>();
  private volume = 0.7;

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
  }

  /** Lazily create the AudioContext (needs a user gesture first; call from input handlers). */
  unlock(): void {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
        const l = this.ctx.listener;
        if (l.positionX === undefined) l.setPosition(0, 0, 0);
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

  register(id: string, make: BufferMaker): void {
    this.makers.set(id, make);
    this.buffers.delete(id);
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

  /** Camera pose for positional sound. `fx,fz` forward on the ground plane. */
  listener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
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

  play(id: string, o: PlayOpts = {}): void {
    const ctx = this.ctx;
    const master = this.master;
    const b = this.buffer(id);
    if (!ctx || !master || !b || ctx.state !== 'running') return;
    try {
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.playbackRate.value = o.rate ?? 1;
      let node: AudioNode = s;
      if (o.lowpass) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = o.lowpass;
        node = node.connect(f);
      }
      const g = ctx.createGain();
      g.gain.value = o.volume ?? 1;
      node = node.connect(g);
      if (o.at) {
        const p = ctx.createPanner();
        p.panningModel = 'equalpower';
        p.distanceModel = 'inverse';
        p.refDistance = 4;
        p.rolloffFactor = 1.2;
        p.maxDistance = 200;
        if (p.positionX) {
          p.positionX.value = o.at.x;
          p.positionY.value = o.at.y;
          p.positionZ.value = o.at.z;
        } else p.setPosition(o.at.x, o.at.y, o.at.z);
        node = node.connect(p);
      }
      node.connect(master);
      s.start();
    } catch {
      /* ignore */
    }
  }

  /**
   * A gunshot for a weapon id (tone by class; suppressed = quiet and dull). A feature may register
   * a per-weapon voice as `shot.<weaponId>` (and `shot.<weaponId>.sup`); it plays instead.
   */
  gunshot(weaponId: string, at?: PlayOpts['at'], suppressed = false): void {
    const own = suppressed && this.makers.has(`shot.${weaponId}.sup`) ? `shot.${weaponId}.sup` : this.makers.has(`shot.${weaponId}`) ? `shot.${weaponId}` : null;
    if (own) {
      this.play(own, { at, rate: 0.96 + Math.random() * 0.08, lowpass: suppressed && !own.endsWith('.sup') ? 900 : undefined, volume: (suppressed ? 0.45 : 1) * (at ? 2.2 : 1) * 0.5 });
      return;
    }
    const cls = WEAPON_BY_ID.get(weaponId)?.class ?? 'ar';
    const t = CLASS_TONE[cls];
    this.play('shot', { at, rate: t.rate * (0.92 + Math.random() * 0.12), lowpass: suppressed ? 700 : t.lowpass, volume: (suppressed ? 0.35 : 1) * t.vol * (at ? 2.2 : 1) });
  }
}

function tone(ctx: AudioContext, dur: number, f: (t: number, i: number) => number): AudioBuffer {
  const len = Math.max(1, (dur * ctx.sampleRate) | 0);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = f(i / ctx.sampleRate, i);
  return b;
}

export const sfx = new Sfx();
