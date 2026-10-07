/**
 * Retro strength (Settings → Graphics): preset → knob mapping, Custom detection, what the knobs
 * mean for the texture developer and the post pass, migration from the old PS1 toggles, and
 * persistence through settings.ts (localStorage).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { developOptions, knobPatch, knobsOf, matchPreset, migrateRetro, presetSettings, RETRO_KEYS, RETRO_PRESETS, RETRO_RANGES, screenOptions, type RetroKnobs, type RetroPreset } from '../src/client/render/retro';

const PRESETS = Object.keys(RETRO_PRESETS) as RetroPreset[];

describe('retro presets', () => {
  it('Classic is the approved look and the default', async () => {
    expect(RETRO_PRESETS.classic).toEqual({ res: '360', palette: '16', ditherType: 'pattern', ditherStrength: 0.75, vertexSnap: 0, affineWarp: 0, fogScale: 1, texFilter: 'pixel-mip' });
    const { DEFAULT_SETTINGS } = await import('../src/client/settings');
    expect(DEFAULT_SETTINGS.retro).toBe('classic');
    expect(knobsOf(DEFAULT_SETTINGS)).toEqual(RETRO_PRESETS.classic);
  });

  it('each preset sets every knob, within range', () => {
    for (const id of PRESETS) {
      const p = presetSettings(id);
      expect(p.retro).toBe(id);
      expect(Object.keys(knobsOf(p)).sort()).toEqual([...RETRO_KEYS].sort());
      expect(RETRO_RANGES.res).toContain(p.res);
      expect(RETRO_RANGES.palette).toContain(p.palette);
      expect(RETRO_RANGES.ditherType).toContain(p.ditherType);
      expect(RETRO_RANGES.texFilter).toContain(p.texFilter);
      for (const k of ['ditherStrength', 'vertexSnap', 'affineWarp', 'fogScale'] as const) {
        expect(p[k]).toBeGreaterThanOrEqual(RETRO_RANGES[k].min);
        expect(p[k]).toBeLessThanOrEqual(RETRO_RANGES[k].max);
      }
    }
  });

  it('presets get more retro from Off to Full PS1', () => {
    const lines = (r: string) => (r === 'full' ? 9999 : Number(r));
    const order: RetroPreset[] = ['off', 'subtle', 'classic', 'ps1'];
    const colours = { full: 4, '32': 3, '16': 2, '15bit': 1 } as const;
    for (let i = 1; i < order.length; i++) {
      const a = RETRO_PRESETS[order[i - 1]!];
      const b = RETRO_PRESETS[order[i]!];
      expect(lines(b.res)).toBeLessThan(lines(a.res));
      expect(colours[b.palette]).toBeLessThan(colours[a.palette]);
      expect(b.ditherStrength).toBeGreaterThan(a.ditherStrength);
      expect(b.vertexSnap).toBeGreaterThanOrEqual(a.vertexSnap);
      expect(b.affineWarp).toBeGreaterThanOrEqual(a.affineWarp);
      expect(b.fogScale).toBeLessThanOrEqual(a.fogScale);
    }
    expect(RETRO_PRESETS.off).toMatchObject({ palette: 'full', ditherType: 'none', vertexSnap: 0, affineWarp: 0 });
    expect(RETRO_PRESETS.ps1).toMatchObject({ res: '240', palette: '15bit' });
    for (const id of PRESETS) expect(RETRO_PRESETS[id].fogScale).toBeLessThanOrEqual(1);
    expect(RETRO_PRESETS.ps1.vertexSnap).toBeGreaterThan(0);
    expect(RETRO_PRESETS.ps1.affineWarp).toBeGreaterThan(0);
    expect(RETRO_PRESETS.ps1.fogScale).toBeLessThan(1);
  });

  it('knobs are recognised as their preset, a tweak makes them Custom, undoing it restores the preset', () => {
    for (const id of PRESETS) expect(matchPreset(RETRO_PRESETS[id])).toBe(id);
    const classic = RETRO_PRESETS.classic;
    const tweak = knobPatch(classic, { vertexSnap: 1 });
    expect(tweak).toEqual({ vertexSnap: 1, retro: 'custom' });
    const tweaked: RetroKnobs = { ...classic, vertexSnap: 1 };
    expect(knobPatch(tweaked, { vertexSnap: 0 }).retro).toBe('classic');
    // Floating point from sliders still matches.
    expect(matchPreset({ ...RETRO_PRESETS.subtle, ditherStrength: 0.1 + 0.4 })).toBe('subtle');
  });
});

describe('what the knobs drive', () => {
  it('palette depth and dither → texture developer variant', () => {
    expect(developOptions(RETRO_PRESETS.classic)).toEqual({ k: 16, strength: 0.75, type: 'pattern' });
    expect(developOptions(RETRO_PRESETS.subtle)).toEqual({ k: 32, strength: 0.5, type: 'pattern' });
    expect(developOptions(RETRO_PRESETS.off)).toEqual({ k: 0, strength: 0, type: 'none' });
    // 15-bit keeps 16-colour textures (a PS1 4-bit CLUT) and adds the framebuffer.
    expect(developOptions(RETRO_PRESETS.ps1)).toEqual({ k: 16, strength: 0.85, type: 'bayer' });
    expect(developOptions({ palette: '16', ditherType: 'none', ditherStrength: 0.8 })).toEqual({ k: 16, strength: 0, type: 'none' });
  });

  it('only 15-bit quantises the final image', () => {
    for (const id of ['off', 'subtle', 'classic'] as const) expect(screenOptions(RETRO_PRESETS[id])).toEqual({ levels: 256, dither: 0, type: 'none' });
    expect(screenOptions(RETRO_PRESETS.ps1)).toEqual({ levels: 32, dither: 0.85, type: 'bayer' });
    expect(screenOptions({ palette: '15bit', ditherType: 'none', ditherStrength: 1 })).toEqual({ levels: 32, dither: 0, type: 'none' });
  });
});

describe('migration', () => {
  it('old settings with the PS1 toggles off become Classic', () => {
    expect(migrateRetro({ look: 'photo', res: '360', snap: false, affine: false, dither: false })).toEqual(presetSettings('classic'));
  });

  it('old PS1 toggles map onto the knobs (Custom)', () => {
    const m = migrateRetro({ look: 'ps1', res: '240', snap: true, affine: true, dither: true });
    expect(m).toMatchObject({ res: '240', vertexSnap: 1, affineWarp: 1, palette: '15bit', ditherType: 'bayer', retro: 'custom' });
  });

  it('a stored preset follows the current preset definition', () => {
    expect(migrateRetro({ retro: 'ps1', res: '360', vertexSnap: 2 })).toEqual(presetSettings('ps1'));
  });

  it('custom knobs are validated and clamped', () => {
    const m = migrateRetro({ retro: 'custom', res: '1080', palette: 'rainbow', ditherType: 'bayer', ditherStrength: 7, vertexSnap: -1, affineWarp: 0.5, fogScale: 'far', texFilter: 'smooth' });
    expect(m).toEqual({ res: '360', palette: '16', ditherType: 'bayer', ditherStrength: 1, vertexSnap: 0, affineWarp: 0.5, fogScale: 1, texFilter: 'smooth', retro: 'custom' });
  });
});

describe('persistence', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('a chosen preset and Advanced tweaks survive a reload', async () => {
    let S = await import('../src/client/settings');
    expect(S.settings.retro).toBe('classic');
    S.updateSettings(presetSettings('ps1'));
    expect(JSON.parse(store.get(S.SETTINGS_KEY)!)).toMatchObject({ retro: 'ps1', res: '240', palette: '15bit', vertexSnap: RETRO_PRESETS.ps1.vertexSnap });

    vi.resetModules();
    S = await import('../src/client/settings');
    expect(S.settings).toMatchObject(presetSettings('ps1'));

    S.updateSettings(knobPatch(S.settings, { fogScale: 1.4, texFilter: 'smooth' }));
    vi.resetModules();
    S = await import('../src/client/settings');
    expect(S.settings).toMatchObject({ ...RETRO_PRESETS.ps1, fogScale: 1.4, texFilter: 'smooth', retro: 'custom' });
  });

  it('notifies listeners with the changed knob keys (live apply)', async () => {
    const S = await import('../src/client/settings');
    const seen: string[][] = [];
    S.onSettings((_s, changed) => seen.push(changed as string[]));
    S.updateSettings(presetSettings('subtle'));
    expect(seen.at(-1)!.sort()).toEqual(['ditherStrength', 'palette', 'res', 'retro'].sort());
  });

  it('settings saved before Retro strength load migrated, with the map grade', async () => {
    store.set('lofi.settings', JSON.stringify({ look: 'photo', res: '480', snap: true, affine: false, dither: false, grade: 'natural', fov: 80, ext: {} }));
    const S = await import('../src/client/settings');
    expect(S.settings).toMatchObject({ res: '480', vertexSnap: 1, affineWarp: 0, palette: '16', retro: 'custom', grade: 'map', fov: 80 });
    expect('snap' in S.settings).toBe(false);
    // A grade picked after the migration sticks.
    S.updateSettings({ grade: 'natural' });
    expect(S.parseSettings(store.get('lofi.settings')!).grade).toBe('natural');
  });

  it('missing or broken storage falls back to defaults', async () => {
    const S = await import('../src/client/settings');
    expect(S.parseSettings(null)).toMatchObject({ retro: 'classic', grade: 'map', ...RETRO_PRESETS.classic });
    expect(S.parseSettings('{not json')).toMatchObject({ retro: 'classic' });
  });
});
