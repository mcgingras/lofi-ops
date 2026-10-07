/**
 * The texture "developer" (ported from reference/yard-lab.html): photos and drawn canvases are
 * reduced to a small adaptive palette (median cut in YCoCg) with a 4x4 crosshatch pattern dither
 * baked in. `quantize16`, `photoify` and `fromPhoto` are the prototype's recipes; each recipe gets
 * its own seeded random source so the result is the same every time (and can be cached).
 */

export interface Rand {
  /** 0..1, deterministic per recipe. */
  rnd(): number;
  /** a..b */
  rr(a: number, b: number): number;
}

/** Park-Miller like the prototype (seed must be 1..2^31-2). */
export function makeRand(seed: number): Rand {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return { rnd, rr: (a, b) => a + (b - a) * rnd() };
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function cnv(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('2d canvas unavailable');
  return g;
}

export const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const col = (c: readonly number[], k = 1, a = 1) => `rgba(${clamp(c[0]! * k, 0, 255) | 0},${clamp(c[1]! * k, 0, 255) | 0},${clamp(c[2]! * k, 0, 255) | 0},${a})`;

/** Posterise to 16 levels per channel (the lo-fi base textures). */
export function posterize(c: HTMLCanvasElement): HTMLCanvasElement {
  const g = ctx2d(c);
  const im = g.getImageData(0, 0, c.width, c.height);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) d[i + k] = Math.round(d[i + k]! / 17) * 17;
  g.putImageData(im, 0, 0);
  return c;
}

// ---------------------------------------------------------------------------------------------
// Drawing helpers used by the lo-fi recipes (prototype grain/blotch/streaks/stencil)
// ---------------------------------------------------------------------------------------------

export function grain(g: CanvasRenderingContext2D, R: Rand, x0: number, y0: number, w: number, h: number, c: string, amt = 0.1) {
  const b = hex(c);
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      g.fillStyle = col(b, 1 + (R.rnd() - 0.5) * 2 * amt);
      g.fillRect(x, y, 1, 1);
    }
}
export function blotch(g: CanvasRenderingContext2D, R: Rand, w: number, h: number, n: number, c: string, a: number, r0: number, r1: number) {
  const b = hex(c);
  for (let i = 0; i < n; i++) {
    const r = R.rr(r0, r1);
    g.fillStyle = col(b, 1, a * R.rnd());
    g.fillRect(R.rr(0, w) | 0, R.rr(0, h) | 0, r | 0, (r * R.rr(0.5, 1.3)) | 0);
  }
}
export function streaks(g: CanvasRenderingContext2D, R: Rand, w: number, top: number, n: number, len: number, a: number, rgb = '70,40,22') {
  for (let i = 0; i < n; i++) {
    const x = R.rr(0, w) | 0;
    const L = R.rr(len * 0.3, len) | 0;
    for (let y = 0; y < L; y++) {
      g.fillStyle = `rgba(${rgb},${a * (1 - y / L)})`;
      g.fillRect(x, top + y, R.rnd() > 0.75 ? 2 : 1, 1);
    }
  }
}
export function stencil(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string) {
  g.font = `bold ${size}px "Courier New",monospace`;
  g.fillStyle = color;
  g.fillText(text, x, y);
}

// Photo-recipe helpers (prototype drips/dirtBottom/stencilText)
export function drips(g: CanvasRenderingContext2D, R: Rand, w: number, top: number, n: number, maxL: number, a = 0.6) {
  g.filter = 'blur(2px)';
  for (let i = 0; i < n; i++) {
    const x = R.rr(0, w);
    const L = R.rr(maxL * 0.15, maxL);
    const lg = g.createLinearGradient(0, top, 0, top + L);
    lg.addColorStop(0, `rgba(105,50,20,${a})`);
    lg.addColorStop(1, 'rgba(105,50,20,0)');
    g.fillStyle = lg;
    g.fillRect(x, top, R.rr(2, 6), L);
  }
  g.filter = 'none';
}
export function dirtBottom(g: CanvasRenderingContext2D, w: number, h: number, from = 0.6, a = 0.6) {
  const dg = g.createLinearGradient(0, h * from, 0, h);
  dg.addColorStop(0, 'rgba(30,22,14,0)');
  dg.addColorStop(1, `rgba(30,22,14,${a})`);
  g.fillStyle = dg;
  g.fillRect(0, h * from, w, h * (1 - from));
}
export function stencilText(g: CanvasRenderingContext2D, lines: string[], x: number, y: number, sizes: number[], color = 'rgba(238,234,224,.9)') {
  lines.forEach((l, i) => {
    g.font = `bold ${sizes[i] ?? sizes[sizes.length - 1]}px "Courier New",monospace`;
    g.fillStyle = color;
    g.fillText(l, x, y + i * (sizes[0]! * 0.85));
  });
}

// ---------------------------------------------------------------------------------------------
// Quantiser
// ---------------------------------------------------------------------------------------------

/** Smooth tiling value noise as a canvas of black/white overlay blobs. */
export function tileNoise(R: Rand, w: number, h: number, cells: number, amp: number): HTMLCanvasElement {
  const n = cells + 2;
  const s = cnv(n, n);
  const g = ctx2d(s);
  const grid: number[][] = [];
  for (let y = 0; y < cells; y++) {
    const row: number[] = [];
    for (let x = 0; x < cells; x++) row.push((R.rnd() * 2 - 1) * amp);
    grid.push(row);
  }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = grid[(y - 1 + cells) % cells]![(x - 1 + cells) % cells]!;
      g.fillStyle = v < 0 ? `rgba(0,0,0,${-v})` : `rgba(255,255,255,${v})`;
      g.fillRect(x, y, 1, 1);
    }
  const c = cnv(w, h);
  const cg = ctx2d(c);
  cg.imageSmoothingEnabled = true;
  cg.imageSmoothingQuality = 'high';
  cg.drawImage(s, (-w / cells) * 1.5, (-h / cells) * 1.5, (w * n) / cells, (h * n) / cells);
  return c;
}

type P3 = [number, number, number];

export function medianCut(list: P3[], k: number): P3[] {
  let boxes: P3[][] = [list];
  while (boxes.length < k) {
    let bi = -1;
    let best = -1;
    let ch = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      const mn = [1e9, 1e9, 1e9];
      const mx = [-1e9, -1e9, -1e9];
      for (const p of b)
        for (let c = 0; c < 3; c++) {
          if (p[c]! < mn[c]!) mn[c] = p[c]!;
          if (p[c]! > mx[c]!) mx[c] = p[c]!;
        }
      const r = [mx[0]! - mn[0]!, mx[1]! - mn[1]!, mx[2]! - mn[2]!];
      const c = r.indexOf(Math.max(...r));
      const sc = r[c]! * Math.sqrt(b.length);
      if (sc > best) {
        best = sc;
        bi = i;
        ch = c;
      }
    });
    if (bi < 0 || best <= 0) break;
    const b = boxes[bi]!.sort((p, q) => p[ch]! - q[ch]!);
    const mid = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  boxes = boxes.filter((b) => b.length);
  return boxes.map((b) => {
    const s: P3 = [0, 0, 0];
    for (const p of b) {
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
    }
    return [s[0] / b.length, s[1] / b.length, s[2] / b.length];
  });
}

/** 4x4 crosshatch dither pattern (prototype PATTERN). */
const PATTERN = Array.from({ length: 16 }, (_, i) => {
  const x = i & 3;
  const y = i >> 2;
  return ((x + y) & 3) * 4 + ((x - y) & 3);
});

/** Reduce a canvas (in place) to `k` colours in YCoCg with the pattern dither at `strength`. */
export function quantize16(R: Rand, c: HTMLCanvasElement, k = 16, strength = 0.75, grainAmt = 6): HTMLCanvasElement {
  const g = ctx2d(c);
  const W = c.width;
  const H = c.height;
  const im = g.getImageData(0, 0, W, H);
  const d = im.data;
  const n = W * H;
  const Y = new Float32Array(n);
  const Co = new Float32Array(n);
  const Cg = new Float32Array(n);
  for (let j = 0, i = 0; j < n; j++, i += 4) {
    const e = (R.rnd() - 0.5) * 2 * grainAmt;
    const r = d[i]! + e;
    const gg = d[i + 1]! + e;
    const b = d[i + 2]! + e;
    Y[j] = 0.25 * r + 0.5 * gg + 0.25 * b;
    Co[j] = 0.5 * r - 0.5 * b;
    Cg[j] = -0.25 * r + 0.5 * gg - 0.25 * b;
  }
  const step = Math.max(1, Math.floor(n / 9000));
  const list: P3[] = [];
  for (let j = 0; j < n; j += step) if (d[j * 4 + 3]! > 127) list.push([Y[j]!, Co[j]!, Cg[j]!]);
  const pal = medianCut(list.length ? list : [[0, 0, 0]], k);
  const rgb = pal.map(([y, co, cg]) => {
    const t = y - cg;
    return [clamp(t + co, 0, 255), clamp(y + cg, 0, 255), clamp(t - co, 0, 255)];
  });
  const spread = (255 / Math.sqrt(pal.length)) * strength;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const j = y * W + x;
      const i = j * 4;
      if (d[i + 3]! < 128) {
        d[i + 3] = 0;
        continue;
      }
      const t = (PATTERN[(y & 3) * 4 + (x & 3)]! + 0.5) / 16 - 0.5;
      const yy = Y[j]! + t * spread;
      const co = Co[j]! + t * spread * 0.35;
      const cg = Cg[j]! + t * spread * 0.35;
      let bi = 0;
      let bd = 1e12;
      for (let p = 0; p < pal.length; p++) {
        const q = pal[p]!;
        const a = yy - q[0];
        const b2 = co - q[1];
        const c2 = cg - q[2];
        const dd = 3 * a * a + 1.4 * b2 * b2 + 1.4 * c2 * c2;
        if (dd < bd) {
          bd = dd;
          bi = p;
        }
      }
      const o = rgb[bi]!;
      d[i] = o[0]!;
      d[i + 1] = o[1]!;
      d[i + 2] = o[2]!;
      d[i + 3] = 255;
    }
  g.putImageData(im, 0, 0);
  return c;
}

export interface PhotoifyOpts {
  long?: number;
  noise?: number;
  k?: number;
  grain?: number;
  strength?: number;
}

/** Any drawn source -> soft, grimy, palette-reduced "photo" (prototype photoify). */
export function photoify(R: Rand, src: CanvasImageSource & { width: number; height: number }, o: PhotoifyOpts = {}): HTMLCanvasElement {
  const { long = 512, noise = 1, k = 16, grain: gr = 6, strength = 0.75 } = o;
  const sc = long / Math.max(src.width, src.height);
  const w = Math.max(8, Math.round(src.width * sc));
  const h = Math.max(8, Math.round(src.height * sc));
  const c = cnv(w, h);
  const g = ctx2d(c);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  if (noise) {
    g.globalCompositeOperation = 'overlay';
    for (const [cells, a] of [[3, 0.18], [10, 0.14], [36, 0.1]] as const) g.drawImage(tileNoise(R, w, h, cells, a * noise), 0, 0);
    g.globalCompositeOperation = 'source-over';
  }
  return quantize16(R, c, k, strength, gr);
}

export interface FromPhotoOpts {
  w?: number;
  h?: number;
  tile?: number;
  /** CSS canvas filter applied while drawing the photo. */
  filter?: string;
  /** Draw extra grime/labels over it before quantising. */
  over?: (g: CanvasRenderingContext2D, w: number, h: number) => void;
  k?: number;
}

/** A Poly Haven photo tiled onto a canvas, filtered, overdrawn and quantised (prototype fromPhoto). */
export function fromPhoto(R: Rand, im: CanvasImageSource | null, o: FromPhotoOpts = {}): HTMLCanvasElement | null {
  if (!im) return null;
  const { w = 512, h = 512, tile = 512, filter = 'none', over, k = 16 } = o;
  const c = cnv(w, h);
  const g = ctx2d(c);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.filter = filter;
  for (let y = 0; y < h; y += tile) for (let x = 0; x < w; x += tile) g.drawImage(im, x, y, tile, tile);
  g.filter = 'none';
  over?.(g, w, h);
  return quantize16(R, c, k, 0.75, 3);
}
