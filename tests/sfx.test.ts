/**
 * Recorded sound effects: recipes -> shipped files, bindings -> recipes, provenance (every source
 * is on the approved manifest), and the pure mix helpers (variants, pitch/volume jitter, distance
 * mix, voice cap, decoder-delay trim, footstep surfaces).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { distanceMix, jitterGain, jitterRate, leadingSilence, pickVariant, VoicePool } from '../src/client/game/sfx-mix';
import { stepSound, surfaceAt, surfaceOfTexture } from '../src/client/game/surfaces';
import { getMapData, MAPS } from '../src/shared/defs/maps';
import { gunWeaponIds, RECIPE_BY_FILE, SFX_BINDINGS, SFX_LEVELS, SFX_RECIPES, WEAPON_SHOTS } from '../src/shared/defs/sfx-recipes';
import { WEAPON_BY_ID } from '../src/shared/defs/weapons';
import { parseManifest } from '../scripts/sfx-sources';

const OUT = resolve(import.meta.dirname, '../assets/sfx');

/** Deterministic PRNG for the variation tests. */
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

describe('sfx recipes -> shipped files', () => {
  it('recipe names are unique and sane', () => {
    expect(RECIPE_BY_FILE.size).toBe(SFX_RECIPES.length);
    for (const r of SFX_RECIPES) {
      expect(r.file, r.file).toMatch(/^[a-z0-9_]+$/);
      expect(r.start, r.file).toBeGreaterThanOrEqual(0);
      expect(r.dur, r.file).toBeGreaterThan(0.01);
      expect(r.dur, r.file).toBeLessThanOrEqual(4.5);
      expect(SFX_LEVELS[r.level], r.file).toBeDefined();
    }
  });

  it('every recipe source is an approved manifest download', () => {
    const files = parseManifest().map((s) => s.file);
    const ok = (src: string) => files.some((f) => f === src || (f.endsWith('.zip') && src.startsWith(f.replace(/\.zip$/, '/'))));
    for (const r of SFX_RECIPES) expect(ok(r.src), `${r.file} <- ${r.src}`).toBe(true);
  });

  it('every recipe has its output in assets/sfx and nothing else ships there', () => {
    const shipped = readdirSync(OUT).sort();
    expect(shipped).toEqual(SFX_RECIPES.map((r) => `${r.file}.mp3`).sort());
    for (const f of shipped) {
      const head = readFileSync(join(OUT, f)).subarray(0, 3);
      // MPEG audio frame sync (no ID3 tag is written).
      expect(head[0] === 0xff && (head[1]! & 0xe0) === 0xe0, f).toBe(true);
    }
  });

  it('the shipped total stays small', () => {
    const total = readdirSync(OUT).reduce((s, f) => s + statSync(join(OUT, f)).size, 0);
    expect(total).toBeLessThan(5 * 1024 * 1024);
  });

  it('every binding plays files that have recipes, and every recipe is played by something', () => {
    const used = new Set<string>();
    for (const [id, b] of Object.entries(SFX_BINDINGS)) {
      expect(b.files.length, id).toBeGreaterThan(0);
      for (const f of b.files) {
        expect(RECIPE_BY_FILE.has(f), `${id} -> ${f}`).toBe(true);
        used.add(f);
      }
      if (b.rate !== undefined) expect(b.rate, id).toBeGreaterThan(0.5);
      if (b.maxVoices !== undefined) expect(b.maxVoices, id).toBeGreaterThanOrEqual(1);
    }
    expect(SFX_RECIPES.filter((r) => !used.has(r.file)).map((r) => r.file)).toEqual([]);
  });

  it('every gun has a recorded voice and a suppressed one; guns sharing a class recording differ', () => {
    for (const id of gunWeaponIds()) {
      expect(SFX_BINDINGS[`shot.${id}`], id).toBeDefined();
      expect(SFX_BINDINGS[`shot.${id}.sup`], id).toBeDefined();
      expect(SFX_BINDINGS[`shot.${id}.sup`]!.files.every((f) => f.startsWith('sup_') || WEAPON_BY_ID.get(id)?.class === 'launcher'), id).toBe(true);
    }
    for (const id of Object.keys(WEAPON_SHOTS)) expect(WEAPON_BY_ID.has(id), id).toBe(true);
    // No two guns play the exact same thing: some of pool, pitch, EQ or gain differs.
    const sig = (id: string) => JSON.stringify({ ...WEAPON_SHOTS[id], sup: undefined, supRate: undefined });
    const seen = new Map<string, string>();
    for (const id of Object.keys(WEAPON_SHOTS)) {
      expect(seen.get(sig(id)), `${id} sounds the same as ${seen.get(sig(id))}`).toBeUndefined();
      seen.set(sig(id), id);
    }
  });
});

describe('variation', () => {
  it('pickVariant never repeats back to back and uses every variant', () => {
    const r = rng(7);
    for (const n of [2, 3, 5]) {
      let last = -1;
      const hits = new Array(n).fill(0);
      for (let i = 0; i < 600; i++) {
        const v = pickVariant(n, last, r);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(n);
        expect(v).not.toBe(last);
        hits[v]++;
        last = v;
      }
      for (const h of hits) expect(h).toBeGreaterThan(600 / n / 2);
    }
    expect(pickVariant(1, 0, r)).toBe(0);
    expect(pickVariant(1, -1, r)).toBe(0);
  });

  it('pitch and volume jitter stay inside their spread and actually vary', () => {
    const r = rng(3);
    const rates = Array.from({ length: 200 }, () => jitterRate(1.1, 0.035, r));
    for (const x of rates) {
      expect(x).toBeGreaterThanOrEqual(1.1 * 0.965 - 1e-9);
      expect(x).toBeLessThanOrEqual(1.1 * 1.035 + 1e-9);
    }
    expect(Math.max(...rates) - Math.min(...rates)).toBeGreaterThan(0.05);
    const gains = Array.from({ length: 200 }, () => jitterGain(0.5, 1.5, r));
    for (const g of gains) {
      expect(20 * Math.log10(g / 0.5)).toBeGreaterThanOrEqual(-1.5 - 1e-9);
      expect(20 * Math.log10(g / 0.5)).toBeLessThanOrEqual(1.5 + 1e-9);
    }
    expect(jitterRate(1, 0, r)).toBe(1);
    expect(jitterGain(0.7, 0, r)).toBe(0.7);
  });

  it('gun bindings vary per shot and cap their voices', () => {
    for (const id of gunWeaponIds()) {
      const b = SFX_BINDINGS[`shot.${id}`]!;
      expect(b.files.length, id).toBeGreaterThanOrEqual(2);
      expect(b.pitchJitter ?? 0, id).toBeGreaterThan(0);
      expect(b.volJitter ?? 0, id).toBeGreaterThan(0);
      expect(b.maxVoices ?? 99, id).toBeLessThanOrEqual(8);
    }
  });
});

describe('distance mix', () => {
  it('darkens and hands over to the distant layer with distance', () => {
    expect(distanceMix(3)).toEqual({ lowpass: null, near: 1, far: 0 });
    let lastCut = Infinity;
    let lastFar = -1;
    for (let d = 13; d <= 150; d += 5) {
      const m = distanceMix(d);
      expect(m.lowpass!).toBeLessThanOrEqual(lastCut);
      expect(m.far).toBeGreaterThanOrEqual(lastFar);
      expect(m.near).toBeGreaterThanOrEqual(0.45 - 1e-9);
      lastCut = m.lowpass!;
      lastFar = m.far;
    }
    expect(distanceMix(100).far).toBe(1);
    expect(distanceMix(100).lowpass).toBeLessThan(2000);
  });
});

describe('voice pool', () => {
  it('caps voices per id, oldest first', () => {
    const p = new VoicePool<string>(100);
    expect(p.add('tick', 'a', 2, 0)).toEqual([]);
    expect(p.add('tick', 'b', 2, 1)).toEqual([]);
    expect(p.add('tick', 'c', 2, 2)).toEqual(['a']);
    expect(p.active('tick')).toBe(2);
    p.remove('tick', 'b');
    expect(p.add('tick', 'd', 2, 3)).toEqual([]);
    expect(p.size).toBe(2);
  });

  it('caps voices overall, stealing the oldest of any id', () => {
    const p = new VoicePool<string>(3);
    p.add('x', 'x1', 8, 0);
    p.add('y', 'y1', 8, 1);
    p.add('x', 'x2', 8, 2);
    expect(p.add('z', 'z1', 8, 3)).toEqual(['x1']);
    expect(p.add('z', 'z2', 8, 4)).toEqual(['y1']);
    expect(p.size).toBe(3);
    // A burst of 50 shots of one id never holds more than its cap.
    const q = new VoicePool<number>(48);
    let stopped = 0;
    for (let i = 0; i < 50; i++) stopped += q.add('shot.ak47', i, 6, i * 0.1).length;
    expect(q.active('shot.ak47')).toBe(6);
    expect(stopped).toBe(44);
  });
});

describe('decoder delay trim', () => {
  it('skips leading near-silence only', () => {
    const a = new Float32Array(4800);
    a.fill(0, 0, 1105);
    a[1105] = 0.5;
    expect(leadingSilence(a, 48000)).toBe(1105);
    const b = new Float32Array(4800).fill(0.2);
    expect(leadingSilence(b, 48000)).toBe(0);
    // All quiet for the whole window (a slow swell): keep it.
    expect(leadingSilence(new Float32Array(48000), 48000)).toBe(0);
  });
});

describe('footstep surfaces', () => {
  it('classifies texture recipe ids', () => {
    expect(surfaceOfTexture('nt_grass')).toBe('grass');
    expect(surfaceOfTexture('steel')).toBe('metal');
    expect(surfaceOfTexture('container3')).toBe('metal');
    expect(surfaceOfTexture('rust_deck')).toBe('metal');
    expect(surfaceOfTexture('nt_floor')).toBe('wood');
    expect(surfaceOfTexture('pallet')).toBe('wood');
    expect(surfaceOfTexture('term_carpet')).toBe('carpet');
    expect(surfaceOfTexture('fr_dirt')).toBe('dirt');
    expect(surfaceOfTexture('rust_sand')).toBe('dirt');
    expect(surfaceOfTexture('bo_sandbag')).toBe('carpet');
    expect(surfaceOfTexture('term_floor')).toBe('concrete');
    expect(surfaceOfTexture('bo_concrete')).toBe('concrete');
    expect(surfaceOfTexture('ground')).toBe('concrete');
  });

  it('finds the floor under spawns on every map, with a footstep sound for each surface', () => {
    const seen = new Set<string>();
    for (const def of MAPS) {
      const map = getMapData(def.id);
      for (const s of [...map.spawns.ffa, ...map.spawns.teams[0], ...map.spawns.teams[1]]) {
        const id = stepSound(map, s.x, s.y, s.z);
        expect(SFX_BINDINGS[id], `${def.id} ${id}`).toBeDefined();
        seen.add(surfaceAt(map, s.x, s.y, s.z));
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect(surfaceAt(null, 0, 0, 0)).toBe('concrete');
    expect(surfaceAt(getMapData('yard'), 0, 0, 0)).toBe('concrete');
  });
});
