/**
 * The sound engine against a fake AudioContext: every registered id has a recording or an
 * intentional synth fallback, every literal id the game plays exists, samples replace the synth
 * once decoded (and the synth stays when loading fails), variants rotate with pitch variation, the
 * per-id voice cap holds, gunshots crossfade to the distant layer only at range, and the Settings
 * sound test lists every id.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sfx, Sfx } from '../src/client/game/audio';
import '../src/client/features/weapons/sounds';
import '../src/client/features/killstreaks/sounds';
import '../src/client/features/modes/sounds';
import '../src/client/features/zombies/sounds';
import '../src/client/features/economy/sounds';
import { gunOf, inGameVolume, soundLabel, soundTestGroups } from '../src/client/features/frontend/sound-test-data';
import { SFX_CREDITS } from '../src/shared/defs/sfx-credits';
import { SFX_BINDINGS, SFX_SAMPLE_ONLY, SFX_SYNTH_ONLY } from '../src/shared/defs/sfx-recipes';

// ---- A minimal fake WebAudio graph ----

class Param {
  value = 0;
  setValueAtTime(v: number) {
    this.value = v;
  }
  setTargetAtTime(v: number) {
    this.value = v;
  }
  cancelScheduledValues() {}
}
class Node {
  connect<T>(n: T): T {
    return n;
  }
  disconnect() {}
}
interface FakeBuffer {
  file?: string;
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  data: Float32Array;
  getChannelData(): Float32Array;
  copyToChannel(): void;
}
const fakeBuffer = (len: number, file?: string): FakeBuffer => {
  const data = new Float32Array(len).fill(0.25);
  return { file, numberOfChannels: 1, length: len, sampleRate: 48000, data, getChannelData: () => data, copyToChannel() {} };
};
class Source extends Node {
  buffer: FakeBuffer | null = null;
  playbackRate = new Param();
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}
const pannerParams = () => ({ positionX: new Param(), positionY: new Param(), positionZ: new Param() });
let sources: Source[] = [];
let gains: { gain: Param }[] = [];
let panners: { refDistance: number }[] = [];
class FakeCtx {
  sampleRate = 48000;
  currentTime = 0;
  state = 'running';
  destination = new Node();
  listener = { ...pannerParams(), forwardX: new Param(), forwardY: new Param(), forwardZ: new Param(), upX: new Param(), upY: new Param(), upZ: new Param() };
  createBuffer = (_c: number, len: number) => fakeBuffer(len);
  createBufferSource = () => {
    const s = new Source();
    sources.push(s);
    return s;
  };
  createGain = () => {
    const g = Object.assign(new Node(), { gain: new Param() });
    gains.push(g);
    return g;
  };
  createBiquadFilter = () => Object.assign(new Node(), { type: '', frequency: new Param() });
  createPanner = () => {
    const p = Object.assign(new Node(), { panningModel: '', distanceModel: '', refDistance: 1, rolloffFactor: 1, maxDistance: 1, ...pannerParams() });
    panners.push(p);
    return p;
  };
  createDynamicsCompressor = () => Object.assign(new Node(), { threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param() });
  decodeAudioData = async (ab: ArrayBuffer) => fakeBuffer(2400, (ab as ArrayBuffer & { file?: string }).file);
  resume = async () => {};
}

let fetchMode: 'ok' | 'fail' = 'ok';
const realFetch = globalThis.fetch;
beforeEach(() => {
  sources = [];
  gains = [];
  panners = [];
  fetchMode = 'ok';
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
  globalThis.fetch = (async (url: string) => {
    if (fetchMode === 'fail') return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    const ab = Object.assign(new ArrayBuffer(4), { file: /\/sfx\/(.+)\.mp3$/.exec(url)?.[1] });
    return { ok: true, status: 200, arrayBuffer: async () => ab };
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A fresh engine with the game's synth voices copied in (the singleton holds the features' registrations). */
function engine(): Sfx {
  const e = new Sfx();
  const makers = (sfx as unknown as { makers: Map<string, unknown> }).makers;
  for (const [id, m] of makers) e.register(id, m as Parameters<Sfx['register']>[1]);
  return e;
}
const lastBuffer = () => sources[sources.length - 1]!.buffer;

describe('sound ids', () => {
  it('every registered id has a recording or an intentional synth-only reason', () => {
    for (const id of sfx.registeredIds()) {
      const ok = id in SFX_BINDINGS || id in SFX_SYNTH_ONLY;
      expect(ok, `${id}: add a binding in sfx-recipes.ts or list it in SFX_SYNTH_ONLY`).toBe(true);
    }
    for (const id of Object.keys(SFX_SYNTH_ONLY)) expect(sfx.hasSynth(id), id).toBe(true);
  });

  it('every recorded id has a synth fallback (its own or `fallback`) unless it is an optional layer', () => {
    for (const [id, b] of Object.entries(SFX_BINDINGS)) {
      if (id in SFX_SAMPLE_ONLY) continue;
      expect(sfx.hasSynth(id) || (!!b.fallback && sfx.hasSynth(b.fallback)), id).toBe(true);
    }
  });

  it('every literal id the client plays is registered', () => {
    const root = resolve(import.meta.dirname, '../src/client');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(root);
    const ids = new Set(sfx.registeredIds());
    const played = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/(?:sfx\.play|looper)\(([^,)]+)[,)]/g)) for (const q of m[1]!.replace(/[=!]==\s*'[^']*'/g, '').matchAll(/'([^']+)'/g)) played.add(q[1]!);
      for (const m of src.matchAll(/sound: '([^']+)'/g)) played.add(m[1]!);
    }
    expect(played.size).toBeGreaterThan(30);
    for (const id of played) expect(ids.has(id), id).toBe(true);
  });
});

describe('sample loading and fallback', () => {
  it('plays the synth until the recording decodes, then the recording', async () => {
    const e = engine();
    e.unlock();
    e.play('tick');
    expect(lastBuffer()?.file).toBeUndefined(); // synth
    await e.preload();
    e.play('tick');
    expect(['ui_tick_a', 'ui_tick_b']).toContain(lastBuffer()?.file);
    expect(e.sampleReady('shot.ak47')).toBe(true);
  });

  it('ensureLoaded loads one id on demand (the sound test plays the real recording first time)', async () => {
    const e = engine();
    e.unlock();
    expect(await e.ensureLoaded('modes.horn')).toBe(true);
    e.play('modes.horn');
    expect(lastBuffer()?.file).toBe('cue_round');
    expect(await e.ensureLoaded('ks_buzz')).toBe(false);
  });

  it('keeps the synth when the files fail to load', async () => {
    fetchMode = 'fail';
    const e = engine();
    e.unlock();
    await e.preload();
    e.play('tick');
    expect(sources.length).toBe(1);
    expect(lastBuffer()?.file).toBeUndefined();
    // An id with only a recording falls back to its named synth voice.
    e.play('step.metal');
    expect(sources.length).toBe(2);
    e.gunshot('ak47');
    expect(sources.length).toBe(3);
  });
});

describe('variation and voice caps', () => {
  it('rotates variants without back-to-back repeats and varies pitch', async () => {
    const e = engine();
    e.unlock();
    await e.preload();
    const files: string[] = [];
    const rates: number[] = [];
    for (let i = 0; i < 40; i++) {
      e.gunshot('ak47');
      files.push(lastBuffer()!.file!);
      rates.push(sources[sources.length - 1]!.playbackRate.value);
    }
    for (let i = 1; i < files.length; i++) expect(files[i]).not.toBe(files[i - 1]);
    expect(new Set(files)).toEqual(new Set(SFX_BINDINGS['shot.ak47']!.files));
    expect(Math.max(...rates) - Math.min(...rates)).toBeGreaterThan(0.02);
    // Per-shot variation stays small (+-2.5%) around the gun's own rate.
    for (const r of rates) expect(Math.abs(r - 1)).toBeLessThanOrEqual(0.03 + 1e-9);
    // Guns sharing a recording are only nudged apart (within +-6%, plus the per-shot jitter).
    for (let i = 0; i < 20; i++) {
      e.gunshot('mpl');
      const r = sources[sources.length - 1]!.playbackRate.value;
      expect(r).toBeGreaterThan(1.0);
      expect(r).toBeLessThanOrEqual(1.06 * 1.025 + 1e-9);
    }
  });

  it('caps simultaneous voices per id', async () => {
    const e = engine();
    e.unlock();
    await e.preload();
    for (let i = 0; i < 20; i++) e.play('tick');
    const max = SFX_BINDINGS.tick!.maxVoices!;
    expect(sources.filter((s) => !s.stopped).length).toBe(max);
  });

  it('suppressed guns use the suppressed recordings', async () => {
    const e = engine();
    e.unlock();
    await e.preload();
    e.gunshot('m16', undefined, true);
    expect(lastBuffer()!.file).toMatch(/^sup_/);
  });

  it('the distant layer only comes in at real range, on a long-range panner, replacing the near shot', async () => {
    const e = engine();
    e.unlock();
    await e.preload();
    e.listener(0, 1.6, 0, 0, 0, -1);
    e.gunshot('ak47', { x: 3, y: 1.5, z: 0 });
    expect(sources.length).toBe(1);
    // 30 m: still just the near recording (no doubling with the distant layer).
    e.gunshot('ak47', { x: 30, y: 1.5, z: 0 });
    expect(sources.length).toBe(2);
    expect(lastBuffer()!.file).toMatch(/^gun_ak_/);
    // 60 m: both, crossfading.
    e.gunshot('ak47', { x: 60, y: 1.5, z: 0 });
    expect(sources.length).toBe(4);
    expect(lastBuffer()!.file).toMatch(/^gun_distant_/);
    expect(panners[panners.length - 1]!.refDistance).toBeGreaterThan(10);
    // 120 m: only the distant recording.
    e.gunshot('ak47', { x: 120, y: 1.5, z: 0 });
    expect(sources.length).toBe(5);
    expect(lastBuffer()!.file).toMatch(/^gun_distant_/);
    // Suppressed shots never get the distant layer.
    e.gunshot('ak47', { x: 120, y: 1.5, z: 0 }, true);
    expect(lastBuffer()!.file).toMatch(/^sup_/);
  });

  it('your own gunshot does not duck the world', async () => {
    const e = engine();
    e.unlock();
    await e.preload();
    const world = (e as unknown as { world: { gain: Param } }).world;
    world.gain.value = 1;
    for (let i = 0; i < 10; i++) e.gunshot('ak47');
    expect(world.gain.value).toBe(1);
  });
});

describe('settings sound test', () => {
  it('lists every registered id exactly once, grouped, labelled with its files and authors', () => {
    const ids = sfx.registeredIds();
    const groups = soundTestGroups(ids);
    const listed = groups.flatMap((g) => g.rows.map((r) => r.id));
    expect(listed.sort()).toEqual([...ids].sort());
    expect(new Set(listed).size).toBe(listed.length);
    expect(groups.map((g) => g.title)).toEqual(expect.arrayContaining(['Guns', 'Footsteps', 'Killstreaks', 'Modes']));
    expect(groups.find((g) => g.title === 'Other')).toBeUndefined();
    for (const g of groups) for (const r of g.rows) expect(r.label.startsWith(`${r.id}: `), r.label).toBe(true);
    // Recorded ids name every file with its author.
    for (const [id, b] of Object.entries(SFX_BINDINGS)) {
      const label = soundLabel(id);
      for (const f of b.files) expect(label, id).toContain(f);
      for (const f of b.files) expect(label, id).toContain(`(${SFX_CREDITS[f]!.author})`);
    }
    expect(soundLabel('ks_buzz')).toBe('ks_buzz: synthesized (Lo-Fi Ops)');
    expect(soundLabel('shot.ak47')).toBe('shot.ak47: gun_ak_a, gun_ak_b, gun_ak_c, gun_ak_d (FFSL)');
  });

  it('plays guns as your own gunshot and everything else at its in-game volume', () => {
    expect(gunOf('shot.ak47')).toEqual({ weapon: 'ak47', suppressed: false });
    expect(gunOf('shot.m1911.sup')).toEqual({ weapon: 'm1911', suppressed: true });
    expect(gunOf('shot.ballistic_knife')).toEqual({ weapon: 'ballistic_knife', suppressed: false });
    expect(gunOf('shot.distant')).toBeNull();
    expect(gunOf('shot')).toBeNull();
    expect(gunOf('step.wood')).toBeNull();
    for (const id of sfx.registeredIds()) if (!gunOf(id)) expect(inGameVolume(id), id).toBeDefined();
  });
});
