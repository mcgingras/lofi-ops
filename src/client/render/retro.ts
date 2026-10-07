/**
 * Retro strength: one setting that drives every "how retro does it look" knob (Settings → Graphics).
 * Presets set the knobs; the Advanced panel edits them one by one, and the preset then reads
 * "Custom" unless the knobs happen to equal a preset again. Pure data and functions (no DOM, no
 * three.js) so the mapping is unit tested. References for each knob: docs/art/retro-references.md.
 */
import type { ResSetting } from './renderer';

export type RetroPreset = 'off' | 'subtle' | 'classic' | 'ps1';
export type RetroId = RetroPreset | 'custom';

/**
 * Colour depth, ordered from most to fewest colours:
 * - 'full'  photos keep every colour (no palette, no texture dither);
 * - '32'    each texture reduced to a 32-colour adaptive palette;
 * - '16'    each texture reduced to 16 colours (the approved Classic look, a PS1 4-bit CLUT);
 * - '15bit' 16-colour textures and the final image quantised to 5 bits per channel with an
 *           ordered dither (the PS1 framebuffer; ULTRAKILL's "colour compression").
 */
export type PaletteDepth = 'full' | '32' | '16' | '15bit';
/** 'pattern' is the 4x4 crosshatch (Color Quantizer "Pattern (PS)"); 'bayer' the classic ordered matrix. */
export type DitherType = 'pattern' | 'bayer' | 'none';
/** 'pixel' nearest without mipmaps (PS1 shimmer), 'pixel-mip' nearest with nearest mips (Classic), 'smooth' trilinear (modern). */
export type TexFilter = 'pixel' | 'pixel-mip' | 'smooth';

export interface RetroKnobs {
  /** Internal render resolution (lines). */
  res: ResSetting;
  palette: PaletteDepth;
  ditherType: DitherType;
  /** 0..1: texture dither spread, and the screen dither amplitude when palette is '15bit'. */
  ditherStrength: number;
  /** Vertex snap grid in internal-resolution pixels (0 off, 1 = whole pixels like the PS1 GTE, up to 3). */
  vertexSnap: number;
  /** 0..1: blend from perspective-correct to affine texture mapping. */
  affineWarp: number;
  /** Multiplier on the map's fog start/end distances (lower = shorter, denser fog). */
  fogScale: number;
  texFilter: TexFilter;
}

export const RETRO_KEYS = ['res', 'palette', 'ditherType', 'ditherStrength', 'vertexSnap', 'affineWarp', 'fogScale', 'texFilter'] as const satisfies readonly (keyof RetroKnobs)[];

export const RETRO_PRESETS: Record<RetroPreset, RetroKnobs> = {
  // Modern lo-fi: the photos and meshes stay, the retro processing goes. 720 lines rather than
  // native so laptop iGPUs keep their frame rate. Fog stays at the map value in every preset
  // except Full PS1 (which only pulls it in), so no preset sees further than another.
  off: { res: '720', palette: 'full', ditherType: 'none', ditherStrength: 0, vertexSnap: 0, affineWarp: 0, fogScale: 1, texFilter: 'smooth' },
  // A softer Classic: more colours and resolution, a lighter crosshatch.
  subtle: { res: '480', palette: '32', ditherType: 'pattern', ditherStrength: 0.5, vertexSnap: 0, affineWarp: 0, fogScale: 1, texFilter: 'pixel-mip' },
  // The approved look (default): 360 lines, 16-colour textures, 4x4 crosshatch at 75%.
  classic: { res: '360', palette: '16', ditherType: 'pattern', ditherStrength: 0.75, vertexSnap: 0, affineWarp: 0, fogScale: 1, texFilter: 'pixel-mip' },
  // The PS1's signature: 240 lines, whole-pixel vertex snap, affine warp, a 15-bit framebuffer
  // with an ordered dither, fog pulled in. Mipmaps stay on: without them 240 lines turns every
  // distant photo into sparkling noise (authentic, but it reads as broken; 'pixel' in Advanced).
  ps1: { res: '240', palette: '15bit', ditherType: 'bayer', ditherStrength: 0.85, vertexSnap: 1, affineWarp: 0.7, fogScale: 0.65, texFilter: 'pixel-mip' },
};

export const DEFAULT_RETRO: RetroPreset = 'classic';

export const RETRO_LABELS: Record<RetroId, string> = { off: 'Off', subtle: 'Subtle', classic: 'Classic', ps1: 'Full PS1', custom: 'Custom' };

export const RETRO_BLURBS: Record<RetroId, string> = {
  off: 'Modern lo-fi: full-colour photos, 720 lines, smooth filtering, no dither.',
  subtle: '32-colour textures, 480 lines, a light crosshatch.',
  classic: 'The house look: 16-colour photos with a 4x4 crosshatch, 360 lines.',
  ps1: '240 lines, wobbling vertices, warping textures, 15-bit colour, short fog.',
  custom: 'Your own mix (Advanced).',
};

/** Allowed values / ranges, for validation and the Advanced sliders. */
export const RETRO_RANGES = {
  res: ['240', '360', '480', '720', 'full'] as const satisfies readonly ResSetting[],
  palette: ['full', '32', '16', '15bit'] as const satisfies readonly PaletteDepth[],
  ditherType: ['pattern', 'bayer', 'none'] as const satisfies readonly DitherType[],
  texFilter: ['pixel', 'pixel-mip', 'smooth'] as const satisfies readonly TexFilter[],
  ditherStrength: { min: 0, max: 1, step: 0.05 },
  vertexSnap: { min: 0, max: 3, step: 0.25 },
  affineWarp: { min: 0, max: 1, step: 0.05 },
  fogScale: { min: 0.4, max: 2, step: 0.05 },
};

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** The knobs of a preset as a settings patch (`retro` included). */
export function presetSettings(id: RetroPreset): RetroKnobs & { retro: RetroPreset } {
  return { retro: id, ...RETRO_PRESETS[id] };
}

/** Which preset these knobs equal, or 'custom'. */
export function matchPreset(k: RetroKnobs): RetroId {
  for (const id of Object.keys(RETRO_PRESETS) as RetroPreset[]) {
    const p = RETRO_PRESETS[id];
    if (RETRO_KEYS.every((key) => (typeof p[key] === 'number' ? near(p[key] as number, k[key] as number) : p[key] === k[key]))) return id;
  }
  return 'custom';
}

/** Pick the knob fields out of a settings-like object. */
export function knobsOf(s: RetroKnobs): RetroKnobs {
  return { res: s.res, palette: s.palette, ditherType: s.ditherType, ditherStrength: s.ditherStrength, vertexSnap: s.vertexSnap, affineWarp: s.affineWarp, fogScale: s.fogScale, texFilter: s.texFilter };
}

/** A patch that changes one or more knobs and re-labels the preset (Classic → Custom, or back). */
export function knobPatch(current: RetroKnobs, patch: Partial<RetroKnobs>): Partial<RetroKnobs> & { retro: RetroId } {
  const next = { ...knobsOf(current), ...patch };
  return { ...patch, retro: matchPreset(next) };
}

const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T => (allowed.includes(v as T) ? (v as T) : dflt);
const num = (v: unknown, r: { min: number; max: number }, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(r.max, Math.max(r.min, v)) : dflt);

/**
 * Stored settings (any version) → valid retro fields. Settings saved before Retro strength existed
 * had `snap` / `affine` / `dither` booleans (the old PS1 toggles): they map onto the knobs so a
 * player who had them on keeps their look (as Custom).
 */
export function migrateRetro(raw: Record<string, unknown>): RetroKnobs & { retro: RetroId } {
  const base = RETRO_PRESETS[DEFAULT_RETRO];
  if (!('retro' in raw) && ('snap' in raw || 'affine' in raw || 'dither' in raw)) {
    const k: RetroKnobs = { ...base, res: pick(raw.res, RETRO_RANGES.res, base.res) };
    if (raw.snap === true) k.vertexSnap = 1;
    if (raw.affine === true) k.affineWarp = 1;
    if (raw.dither === true) {
      k.palette = '15bit';
      k.ditherType = 'bayer';
    }
    return { ...k, retro: matchPreset(k) };
  }
  // A chosen preset follows the preset's current definition (presets can be retuned between versions).
  if (typeof raw.retro === 'string' && raw.retro in RETRO_PRESETS) return presetSettings(raw.retro as RetroPreset);
  const k: RetroKnobs = {
    res: pick(raw.res, RETRO_RANGES.res, base.res),
    palette: pick(raw.palette, RETRO_RANGES.palette, base.palette),
    ditherType: pick(raw.ditherType, RETRO_RANGES.ditherType, base.ditherType),
    ditherStrength: num(raw.ditherStrength, RETRO_RANGES.ditherStrength, base.ditherStrength),
    vertexSnap: num(raw.vertexSnap, RETRO_RANGES.vertexSnap, base.vertexSnap),
    affineWarp: num(raw.affineWarp, RETRO_RANGES.affineWarp, base.affineWarp),
    fogScale: num(raw.fogScale, RETRO_RANGES.fogScale, base.fogScale),
    texFilter: pick(raw.texFilter, RETRO_RANGES.texFilter, base.texFilter),
  };
  return { ...k, retro: matchPreset(k) };
}

/** What the texture developer needs from the knobs (palette size, dither). `k: 0` = keep full colour. */
export interface DevelopOptions {
  k: number;
  strength: number;
  type: DitherType;
}

export function developOptions(k: Pick<RetroKnobs, 'palette' | 'ditherType' | 'ditherStrength'>): DevelopOptions {
  const colours = k.palette === 'full' ? 0 : k.palette === '32' ? 32 : 16;
  const type = k.ditherType;
  return { k: colours, strength: type === 'none' || colours === 0 ? 0 : k.ditherStrength, type: colours === 0 ? 'none' : type };
}

/** What the post pass needs: quantisation levels per channel and screen dither amplitude/type. */
export function screenOptions(k: Pick<RetroKnobs, 'palette' | 'ditherType' | 'ditherStrength'>): { levels: number; dither: number; type: DitherType } {
  if (k.palette !== '15bit') return { levels: 256, dither: 0, type: 'none' };
  return { levels: 32, dither: k.ditherType === 'none' ? 0 : k.ditherStrength, type: k.ditherType };
}
