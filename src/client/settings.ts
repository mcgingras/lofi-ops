/**
 * Client settings, persisted in localStorage (`lofi.settings`). Read with `settings`, change with
 * `updateSettings({...})`, react with `onSettings(fn)`. Features may store their own keys under
 * `settings.ext.<area>` (typed by declaration merging on SettingsExt).
 */
import type { Grade, ResSetting } from './render/renderer';
import type { Look } from './render/textures';

export interface SettingsExt {}

export interface Settings {
  look: Look;
  res: ResSetting;
  /** PS1 vertex snap / affine texture warp / screen dither (the PS1 preset turns them on). */
  snap: boolean;
  affine: boolean;
  dither: boolean;
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
  ext: SettingsExt;
}

export const DEFAULT_SETTINGS: Settings = {
  look: 'photo',
  res: '360',
  snap: false,
  affine: false,
  dither: false,
  grade: 'natural',
  fov: 70,
  sensitivity: 2.2,
  adsSensitivity: 0.75,
  invertY: false,
  volume: 0.7,
  time: 'map',
  crouchToggle: false,
  showFps: false,
  ext: {},
};

const KEY = 'lofi.settings';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Settings>;
      return { ...DEFAULT_SETTINGS, ...v, ext: { ...(v.ext ?? {}) } };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS, ext: {} };
}

export const settings: Settings = load();
const fns = new Set<(s: Settings, changed: (keyof Settings)[]) => void>();

export function updateSettings(patch: Partial<Settings>): void {
  const changed = (Object.keys(patch) as (keyof Settings)[]).filter((k) => JSON.stringify(settings[k]) !== JSON.stringify(patch[k]));
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
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

/** The two looks as presets of the individual toggles (prototype `P` key). */
export function lookPreset(look: Look): Partial<Settings> {
  return look === 'ps1' ? { look, snap: true, affine: true, dither: true, res: '240' } : { look, snap: false, affine: false, dither: false, res: '360' };
}
