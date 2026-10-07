/**
 * Texture registry + developer queue.
 *
 * Every texture is a named recipe (`registerTexture(id, recipe)`): a small drawn canvas (the lo-fi
 * "base", used by the PS1 look and as the instant fallback) and an optional photo recipe run
 * through the developer (quantise to 16 colours + pattern dither). Developed photos are cached in
 * IndexedDB keyed by id + a hash of the recipe source, so a changed recipe re-develops.
 *
 * Map MaterialDef.texture, soldier/viewmodel parts and camos all name recipe ids. Recipes live in
 * `render/recipes/*.ts` (auto-imported, one file per map or area) and in feature folders.
 *
 * Materials bind to an id with `bindTexture(material, id)`; when the look changes or a photo
 * finishes developing, every bound material's `tMap` uniform is swapped.
 */
import * as THREE from 'three';
import { hashString } from '../../shared/math';
import { cnv, ctx2d, developVariant, fromPhoto, makeRand, photoify, posterize, setDevelopVariant, variantKey, type DevelopVariant, type FromPhotoOpts, type PhotoifyOpts, type Rand } from './developer';
import type { TexFilter } from './retro';
import { cacheGet, cachePut } from './idb';

export type Look = 'photo' | 'ps1';

/** What a photo recipe gets: seeded random, loaded photos and the developer functions. */
export interface PhotoCtx extends Rand {
  /** A loaded Poly Haven photo from assets/textures (listed in `recipe.photos`), or null. */
  photo(id: string): HTMLImageElement | null;
  /** The drawn lo-fi canvas of this recipe (posterised). */
  base: HTMLCanvasElement;
  fromPhoto(id: string, o?: FromPhotoOpts): HTMLCanvasElement | null;
  photoify(src: CanvasImageSource & { width: number; height: number }, o?: PhotoifyOpts): HTMLCanvasElement;
}

export type PhotoMode = 'auto' | 'sky' | 'small' | 'none';

export interface TextureRecipe {
  /** Lo-fi canvas size. */
  w: number;
  h: number;
  /** Draw the lo-fi version (PS1 look, instant fallback). */
  draw(g: CanvasRenderingContext2D, w: number, h: number, R: Rand): void;
  /** Posterise the lo-fi canvas to 16 levels per channel (default true). */
  posterize?: boolean;
  /** Repeat wrapping (default true); false for decals/signs/sprites. */
  wrap?: boolean;
  /** Poly Haven photo ids the photo recipe needs. */
  photos?: string[];
  /**
   * The photo look: a function returning a developed canvas (return null when a photo is missing:
   * `fallback` or 'auto' is used), or a preset: 'auto' (photoify the base, the default), 'sky'
   * (soft, 64 colours), 'small' (8 colours, no grime), 'none' (keep the base: sprites, fences).
   */
  photo?: ((c: PhotoCtx) => HTMLCanvasElement | null) | PhotoMode;
  fallback?: ((c: PhotoCtx) => HTMLCanvasElement | null) | PhotoMode;
}

interface Slot {
  id: string;
  recipe: TextureRecipe;
  baseCanvas: HTMLCanvasElement | null;
  base: THREE.Texture | null;
  photo: THREE.Texture | null;
  state: 'none' | 'queued' | 'done';
}

// 4: skies develop at full colour (the texture palette/crosshatch read as bands and a screen door).
const DEV_VERSION = 4;
const slots = new Map<string, Slot>();
const bound = new Map<THREE.ShaderMaterial, string>();
let look: Look = 'photo';
let filter: TexFilter = 'pixel-mip';

export function registerTexture(id: string, recipe: TextureRecipe): void {
  const old = slots.get(id);
  slots.set(id, { id, recipe, baseCanvas: null, base: null, photo: null, state: 'none' });
  if (old) {
    old.base?.dispose();
    old.photo?.dispose();
    refreshBindings(id);
  }
}

export const hasTexture = (id: string) => slots.has(id);
export const textureIds = () => [...slots.keys()];

/** Sampling for the current texture filter (Settings → Retro strength → Texture filter). */
function applyFilter(t: THREE.Texture): void {
  const mip = t.generateMipmaps;
  const smooth = filter === 'smooth';
  t.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
  t.minFilter = !mip || filter === 'pixel' ? (smooth ? THREE.LinearFilter : THREE.NearestFilter) : smooth ? THREE.LinearMipmapLinearFilter : THREE.NearestMipmapNearestFilter;
}

function makeTexture(c: HTMLCanvasElement, wrap: boolean, mip: boolean): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.generateMipmaps = mip;
  applyFilter(t);
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

let missing: THREE.Texture | null = null;
const warned = new Set<string>();
function missingTexture(id: string): THREE.Texture {
  if (!warned.has(id)) {
    warned.add(id);
    if (id !== 'none') console.warn(`[textures] no recipe for "${id}"`);
  }
  if (!missing) {
    const c = cnv(8, 8);
    const g = ctx2d(c);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) & 1 ? '#ff00ff' : '#200020';
      g.fillRect(x, y, 1, 1);
    }
    missing = makeTexture(c, true, false);
  }
  return missing;
}

function baseCanvasOf(s: Slot): HTMLCanvasElement {
  if (!s.baseCanvas) {
    const { w, h } = s.recipe;
    const c = cnv(w, h);
    s.recipe.draw(ctx2d(c), w, h, makeRand(hashString(s.id)));
    s.baseCanvas = s.recipe.posterize === false ? c : posterize(c);
  }
  return s.baseCanvas;
}

function baseOf(s: Slot): THREE.Texture {
  if (!s.base) s.base = makeTexture(baseCanvasOf(s), s.recipe.wrap !== false, false);
  return s.base;
}

/** The texture to use for an id under the current look. */
export function getTexture(id: string): THREE.Texture {
  const s = slots.get(id);
  if (!s) return missingTexture(id);
  if (look === 'photo' && s.photo) return s.photo;
  return baseOf(s);
}

/** Keep `material.uniforms.tMap` pointed at the right texture for `id` (look changes, photos landing). */
export function bindTexture(m: THREE.ShaderMaterial, id: string): void {
  bound.set(m, id);
  const u = m.uniforms.tMap;
  if (u) u.value = getTexture(id);
}

export function unbindTexture(m: THREE.ShaderMaterial): void {
  bound.delete(m);
}

function refreshBindings(id?: string) {
  for (const [m, tid] of bound) if (!id || tid === id) {
    const u = m.uniforms.tMap;
    if (u) u.value = getTexture(tid);
  }
}

export function setLook(l: Look): void {
  if (l === look) return;
  look = l;
  refreshBindings();
}
export const getLook = () => look;

/** Change texture sampling for every texture, live (re-uploads; no re-developing). */
export function setTextureFilter(f: TexFilter): void {
  if (f === filter) return;
  filter = f;
  for (const s of slots.values())
    for (const t of [s.base, s.photo]) {
      if (!t) continue;
      applyFilter(t);
      t.needsUpdate = true;
    }
}

/**
 * Change the developer variant (palette size / dither). Photos already developed stay bound until
 * their re-developed version lands, textures on screen first; each variant caches separately in
 * IndexedDB, so switching back is a cache read.
 */
export function setDevelopOptions(v: DevelopVariant): void {
  if (variantKey(v) === variantKey()) return;
  setDevelopVariant(v);
  const redo: string[] = [];
  for (const s of slots.values())
    if (s.state === 'done') {
      s.state = 'none';
      redo.push(s.id);
    }
  const onScreen = [...new Set(bound.values())];
  void develop(redo);
  prioritize(onScreen);
}

// ---------------------------------------------------------------------------------------------
// Developing
// ---------------------------------------------------------------------------------------------

const photoImgs = new Map<string, Promise<HTMLImageElement | null>>();
const photoLoaded = new Map<string, HTMLImageElement>();

function loadPhoto(id: string): Promise<HTMLImageElement | null> {
  let p = photoImgs.get(id);
  if (!p) {
    p = new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        photoLoaded.set(id, im);
        resolve(im);
      };
      im.onerror = () => resolve(null);
      im.src = `${import.meta.env.BASE_URL}textures/${id}.jpg`;
    });
    photoImgs.set(id, p);
  }
  return p;
}

function recipeKey(s: Slot): string {
  const r = s.recipe;
  const src = [r.w, r.h, r.posterize, r.wrap, r.draw.toString(), typeof r.photo === 'function' ? r.photo.toString() : r.photo, typeof r.fallback === 'function' ? r.fallback.toString() : r.fallback, (r.photos ?? []).join(',')].join('|');
  return `${s.id}@${DEV_VERSION}.${variantKey()}.${hashString(src).toString(36)}`;
}

function runPreset(mode: PhotoMode, ctx: PhotoCtx, base: HTMLCanvasElement, s: Slot): HTMLCanvasElement | null {
  const big = Math.max(base.width, base.height);
  switch (mode) {
    case 'none':
      return null;
    case 'sky': {
      // Skies stay full colour (Crow Country, BRC: smooth painted gradients). Sky texels are
      // larger than screen pixels, so a texture palette shows as stair-stepped bands and a texture
      // dither as a magnified screen door. The 15-bit preset dithers the sky in screen space.
      // Redrawn without the base's 16-level posterise for the same reason.
      const { w, h } = s.recipe;
      const src = cnv(w, h);
      s.recipe.draw(ctx2d(src), w, h, makeRand(hashString(s.id)));
      const c = cnv(1024, Math.round((1024 * h) / w));
      const g = ctx2d(c);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, c.width, c.height);
      return c;
    }
    case 'small':
      return ctx.photoify(base, { long: 128, noise: 0, k: 8 });
    default:
      return ctx.photoify(base, { long: big <= 8 ? 64 : big <= 16 ? 128 : big <= 32 ? 256 : 512, noise: 1 });
  }
}

function developNow(s: Slot): HTMLCanvasElement | null {
  const base = baseCanvasOf(s);
  const R = makeRand(hashString(`${s.id}:photo`));
  const ctx: PhotoCtx = {
    ...R,
    base,
    photo: (id) => photoLoaded.get(id) ?? null,
    fromPhoto: (id, o) => fromPhoto(R, photoLoaded.get(id) ?? null, o),
    photoify: (src, o) => photoify(R, src, o),
  };
  const run = (p: TextureRecipe['photo']) => (typeof p === 'function' ? p(ctx) : runPreset(p ?? 'auto', ctx, base, s));
  const mode = s.recipe.photo ?? 'auto';
  if (mode === 'none') return null;
  return run(mode) ?? run(s.recipe.fallback ?? 'auto');
}

async function canvasFromBlob(b: Blob): Promise<HTMLCanvasElement | null> {
  try {
    const bmp = await createImageBitmap(b);
    const c = cnv(bmp.width, bmp.height);
    ctx2d(c).drawImage(bmp, 0, 0);
    bmp.close();
    return c;
  } catch {
    return null;
  }
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob | null>((res) => c.toBlob((b) => res(b), 'image/png'));

let queue: Slot[] = [];
let running = false;
let total = 0;
let done = 0;
const progressFns = new Set<(done: number, total: number) => void>();
const waiters: (() => void)[] = [];

/** Developing progress (menu "Developing photos 12 / 40"). Returns an unsubscribe. */
export function onDevelopProgress(fn: (done: number, total: number) => void): () => void {
  progressFns.add(fn);
  fn(done, total);
  return () => progressFns.delete(fn);
}

const emit = () => {
  for (const fn of progressFns) fn(done, total);
};

/** Queue photo development for ids (default: every registered recipe). Resolves when the queue drains. */
export function develop(ids: string[] = textureIds()): Promise<void> {
  for (const id of ids) {
    const s = slots.get(id);
    if (!s || s.state !== 'none') continue;
    s.state = 'queued';
    queue.push(s);
    total++;
  }
  emit();
  const p = new Promise<void>((res) => waiters.push(res));
  if (!running) void pump();
  else if (!queue.length) flushWaiters();
  return p;
}

function flushWaiters() {
  while (waiters.length) waiters.shift()!();
}

const yieldFrame = () => new Promise<void>((res) => setTimeout(res, 0));

async function pump() {
  running = true;
  while (queue.length) {
    // Maps' textures first: a queue entry asked for again by develop(ids) jumps ahead naturally.
    const s = queue.shift()!;
    const v = developVariant();
    try {
      const key = recipeKey(s);
      const hit = await cacheGet<Blob>('textures', key);
      let c = hit ? await canvasFromBlob(hit) : null;
      if (!c) {
        if (s.recipe.photos?.length) await Promise.all(s.recipe.photos.map(loadPhoto));
        await yieldFrame();
        c = developNow(s);
        if (c) {
          const blob = await toBlob(c);
          if (blob) void cachePut('textures', key, blob);
        }
      }
      if (c) {
        const old = s.photo;
        s.photo = makeTexture(c, s.recipe.wrap !== false, true);
        refreshBindings(s.id);
        old?.dispose();
      }
    } catch (err) {
      console.warn(`[textures] developing ${s.id} failed`, err);
    }
    s.state = 'done';
    done++;
    // The variant changed while this one was developing: develop it again.
    if (v !== developVariant()) {
      s.state = 'queued';
      queue.unshift(s);
      total++;
    }
    emit();
    await yieldFrame();
  }
  running = false;
  flushWaiters();
}

/** Re-prioritise: these ids develop before everything else still queued. */
export function prioritize(ids: string[]): void {
  const set = new Set(ids);
  queue = [...queue.filter((s) => set.has(s.id)), ...queue.filter((s) => !set.has(s.id))];
}
