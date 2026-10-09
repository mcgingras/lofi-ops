/**
 * Client settings, persisted in localStorage (`lofi.settings`). Read with `settings`, change with
 * `updateSettings({...})`, react with `onSettings(fn)`. Features may store their own keys under
 * `settings.ext.<area>` (typed by declaration merging on SettingsExt).
 */
import type { Grade } from './render/renderer';
import { DEFAULT_RETRO, migrateRetro, presetSettings, type RetroId, type RetroKnobs } from './render/retro';
import type { Look } from './render/textures';

export interface SettingsExt {}

/**
 * The retro knobs (`res`, `palette`, `ditherType`, `ditherStrength`, `vertexSnap`, `affineWarp`,
 * `fogScale`, `texFilter`) live flat on Settings; `retro` names the preset they equal ('custom'
 * otherwise). See render/retro.ts.
 */
export interface Settings extends RetroKnobs {
  /** Texture source: developed photos, or the drawn lo-fi canvases. */
  look: Look;
  retro: RetroId;
  grade: Grade;
  /** Vertical field of view (degrees). */
  fov: number;
  /** Mouse sensitivity (radians per pixel x 1000). */
  sensitivity: number;
  /** ADS sensitivity multiplier. */
  adsSensitivity: number;
  invertY: boolean;
  /** Master volume 0..1. */
  volume: number;
  /** Time of day: 'map' = map default, or a preset id (night, overcast, dusk...). Cosmetic, local. */
  time: string;
  crouchToggle: boolean;
  showFps: boolean;
  /** Controller look sensitivity 1..10 (5 = 180 deg/s at full deflection). */
  padSensitivity: number;
  padInvertY: boolean;
  /** Right stick radial deadzone (0.05..0.3). */
  padDeadzone: number;
  padVibration: boolean;
  /** Controller aim assist (never applies to mouse/keyboard). */
  aimAssist: 'off' | 'light' | 'standard';
  ext: SettingsExt;
}

export const DEFAULT_SETTINGS: Settings = {
  look: 'photo',
  ...presetSettings(DEFAULT_RETRO),
  grade: 'map',
  fov: 70,
  sensitivity: 2.2,
  adsSensitivity: 0.75,
  invertY: false,
  volume: 0.7,
  time: 'map',
  crouchToggle: false,
  showFps: false,
  padSensitivity: 5,
  padInvertY: false,
  padDeadzone: 0.13,
  padVibration: true,
  aimAssist: 'light',
  ext: {},
};

export const SETTINGS_KEY = 'lofi.settings';

/** Stored JSON (any version, or null) → complete, valid settings. */
export function parseSettings(raw: string | null): Settings {
  try {
    if (raw) {
      const v = JSON.parse(raw) as Partial<Settings> & Record<string, unknown>;
      // Drop keys from older versions (the snap/affine/dither booleans became retro knobs).
      const { snap: _s, affine: _a, dither: _d, ...rest } = v;
      // Settings from before the per-map grade existed: 'natural' was simply the default then.
      if (!('retro' in v) && v.grade === 'natural') rest.grade = 'map';
      return { ...DEFAULT_SETTINGS, ...rest, ...migrateRetro(v), ext: { ...(v.ext ?? {}) } };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS, ext: {} };
}

function load(): Settings {
  try {
    return parseSettings(localStorage.getItem(SETTINGS_KEY));
  } catch {
    return parseSettings(null);
  }
}

export const settings: Settings = load();
const fns = new Set<(s: Settings, changed: (keyof Settings)[]) => void>();

export function updateSettings(patch: Partial<Settings>): void {
  const changed = (Object.keys(patch) as (keyof Settings)[]).filter((k) => JSON.stringify(settings[k]) !== JSON.stringify(patch[k]));
  Object.assign(settings, patch);
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
  if (changed.length) for (const fn of fns) fn(settings, changed);
}

/** Called on every change (and once now with all keys). Returns an unsubscribe. */
export function onSettings(fn: (s: Settings, changed: (keyof Settings)[]) => void): () => void {
  fns.add(fn);
  fn(settings, Object.keys(settings) as (keyof Settings)[]);
  return () => fns.delete(fn);
}
