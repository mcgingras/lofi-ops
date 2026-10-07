/**
 * Procedural pixel emblems: the 15 prestige emblems (24x24) and rank insignia for levels 1-50
 * (16x16). Each is built on a small material grid, mirrored left/right, then shaded with a bevel
 * (light edge on top, dark edge below) and outlined in ink, so they read like 2010-era HUD icons
 * and match the pixel HUD. Pure canvas, no assets.
 */
import { rankFor } from '../../../shared/defs/progression';

interface Mat {
  base: string;
  light: string;
  dark: string;
}

const INK = '#0a0a0a';

const M = {
  iron: { base: '#8a8f98', light: '#c4c8d0', dark: '#4a4e56' },
  bronze: { base: '#b07a48', light: '#e8b07a', dark: '#6a4022' },
  silver: { base: '#c8ccd4', light: '#ffffff', dark: '#727884' },
  gold: { base: '#e8b830', light: '#fff09a', dark: '#8a6410' },
  leaf: { base: '#4f9a3c', light: '#9ad66a', dark: '#2a5a1e' },
  bone: { base: '#e6dcc4', light: '#ffffff', dark: '#8c8270' },
  red: { base: '#d0342a', light: '#ff7a5a', dark: '#701810' },
  purple: { base: '#8a4ad0', light: '#c89aff', dark: '#3e1a6a' },
  black: { base: '#2a2a34', light: '#5a5a6a', dark: '#101016' },
  cyan: { base: '#40c8e0', light: '#b0f4ff', dark: '#106878' },
  blue: { base: '#3a64c8', light: '#8ab0ff', dark: '#1a2e66' },
  hole: { base: '#101014', light: '#101014', dark: '#101014' },
} satisfies Record<string, Mat>;

/** A square grid of materials (null = empty). Draw calls write the left half and mirror. */
class Grid {
  readonly px: (Mat | null)[];
  constructor(readonly n: number) {
    this.px = new Array<Mat | null>(n * n).fill(null);
  }
  get(x: number, y: number): Mat | null {
    if (x < 0 || y < 0 || x >= this.n || y >= this.n) return null;
    return this.px[y * this.n + x]!;
  }
  set(x: number, y: number, m: Mat | null, mirror = true): void {
    x = Math.round(x);
    y = Math.round(y);
    if (y < 0 || y >= this.n) return;
    if (x >= 0 && x < this.n) this.px[y * this.n + x] = m;
    const mx = this.n - 1 - x;
    if (mirror && mx >= 0 && mx < this.n) this.px[y * this.n + mx] = m;
  }
  /** Fill every pixel whose centre passes `inside` (full width, no mirroring needed). */
  fill(inside: (x: number, y: number) => boolean, m: Mat | null): void {
    for (let y = 0; y < this.n; y++) for (let x = 0; x < this.n; x++) if (inside(x + 0.5, y + 0.5)) this.px[y * this.n + x] = m;
  }
  rect(x0: number, y0: number, w: number, h: number, m: Mat | null, mirror = true): void {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, m, mirror);
  }
}

const cx = (g: Grid) => g.n / 2;

/** Upward chevron (^) with its apex at row `y`. */
function chevron(g: Grid, y: number, m: Mat, span = 9, thick = 2) {
  const c = cx(g);
  for (let d = 0; d < span; d++) for (let t = 0; t < thick; t++) g.set(Math.floor(c) - 1 - d, y + d + t, m);
  for (let t = 0; t < thick + 1; t++) g.set(Math.floor(c) - 1, y + t - 1, m);
}

/** Downward arc ("rocker") under chevrons. */
function rocker(g: Grid, y: number, m: Mat, span = 9, thick = 2) {
  const c = cx(g);
  for (let d = 0; d < span; d++) {
    const dy = Math.round((d * d) / (span * 2.2));
    for (let t = 0; t < thick; t++) g.set(Math.floor(c) - 1 - d, y - dy + t, m);
  }
}

function star(g: Grid, sx: number, sy: number, R: number, m: Mat, rInner = 0.42) {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? R * rInner : R;
    pts.push([sx + Math.cos(a) * r, sy + Math.sin(a) * r]);
  }
  g.fill((x, y) => inPoly(pts, x, y), m);
}

function inPoly(pts: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const disc = (g: Grid, x0: number, y0: number, r: number, m: Mat | null) => g.fill((x, y) => (x - x0) ** 2 + (y - y0) ** 2 <= r * r, m);
const ring = (g: Grid, x0: number, y0: number, r0: number, r1: number, m: Mat) =>
  g.fill((x, y) => {
    const d = Math.hypot(x - x0, y - y0);
    return d >= r0 && d <= r1;
  }, m);

function shield(g: Grid, m: Mat, inner?: Mat) {
  const c = cx(g);
  const top = 3;
  const bottom = g.n - 2;
  const shape = (pad: number) => (x: number, y: number) => {
    if (y < top + pad || y > bottom - pad) return false;
    const t = (y - top) / (bottom - top);
    const half = (t < 0.55 ? 9 : 9 * (1 - (t - 0.55) / 0.45) ** 0.8) - pad;
    return Math.abs(x - c) <= half;
  };
  g.fill(shape(0), m);
  if (inner) g.fill(shape(2), inner);
}

function laurel(g: Grid, m: Mat) {
  const c = cx(g);
  const r = g.n * 0.42;
  for (let a = 105; a <= 250; a += 13) {
    const rad = (a * Math.PI) / 180;
    const x = c + Math.cos(rad) * r;
    const y = c + 1 + Math.sin(rad) * r * 0.95;
    g.set(x, y, m);
    g.set(x - 1, y - 1, m);
    g.set(x + (a < 180 ? 1 : 0), y - 2, m);
  }
}

function skull(g: Grid, m: Mat, y0 = 0) {
  const c = cx(g);
  disc(g, c, 10 + y0, 6.5, m);
  g.rect(Math.floor(c) - 4, 14 + y0, 4, 4, m);
  // Eyes, nose, teeth.
  g.rect(Math.floor(c) - 4, 10 + y0, 2, 3, M.hole);
  g.set(Math.floor(c) - 1, 14 + y0, M.hole);
  g.set(Math.floor(c) - 3, 17 + y0, M.hole);
  g.set(Math.floor(c) - 1, 17 + y0, M.hole);
}

function wings(g: Grid, m: Mat, y = 11) {
  for (let f = 0; f < 4; f++) {
    const len = 7 - f;
    for (let i = 0; i < len; i++) g.set(i, y + f * 2 - Math.floor(i / 3), m);
  }
}

function crown(g: Grid, m: Mat, gem: Mat, y = 1) {
  const c = Math.floor(cx(g));
  g.rect(c - 6, y + 3, 6, 2, m);
  for (const x of [c - 6, c - 3]) g.rect(x, y, 1, 3, m);
  g.rect(c - 1, y - 1 < 0 ? 0 : y - 1, 1, 4, m);
  g.set(c - 3, y + 3, gem);
  g.set(c - 1, y + 1, gem);
}

/** Shade + outline into a colour grid (null = transparent). */
function resolve(g: Grid): (string | null)[] {
  const n = g.n;
  const out = new Array<string | null>(n * n).fill(null);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const m = g.get(x, y);
      if (m) {
        const up = g.get(x, y - 1);
        const down = g.get(x, y + 1);
        out[y * n + x] = up !== m && up !== M.hole ? m.light : down !== m && down !== M.hole ? m.dark : m.base;
        if (m === M.hole) out[y * n + x] = m.base;
      } else if (g.get(x - 1, y) || g.get(x + 1, y) || g.get(x, y - 1) || g.get(x, y + 1)) out[y * n + x] = INK;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Prestige emblems (1-15)
// ---------------------------------------------------------------------------------------------

const emblemCache = new Map<number, (string | null)[]>();

/** 24x24 colour grid for a prestige tier (1-15; 0 gives an empty grid). */
export function prestigeEmblemPixels(prestige: number): (string | null)[] {
  const p = Math.max(0, Math.min(15, Math.floor(prestige)));
  const hit = emblemCache.get(p);
  if (hit) return hit;
  const g = new Grid(24);
  if (p >= 1 && p <= 3) {
    // Iron chevrons, one per tier, on a dark disc.
    disc(g, 12, 12, 11, M.black);
    for (let i = 0; i < p; i++) chevron(g, 5 + i * 5 + (3 - p) * 2, p === 3 ? M.bronze : M.iron, 8, 2);
  } else if (p >= 4 && p <= 6) {
    const mat = [M.bronze, M.silver, M.gold][p - 4]!;
    shield(g, mat, M.blue);
    star(g, 12, 11, p === 6 ? 6.5 : 5.5, mat);
    if (p >= 5) chevron(g, 16, mat, 5, 1);
  } else if (p >= 7 && p <= 9) {
    const mat = [M.bronze, M.silver, M.gold][p - 7]!;
    laurel(g, M.leaf);
    disc(g, 12, 12, 6.5, mat);
    star(g, 12, 12, 5, M.red);
    if (p >= 8) chevron(g, 19, mat, 4, 1);
    if (p === 9) crown(g, M.gold, M.red, 0);
  } else if (p >= 10 && p <= 12) {
    if (p >= 11) wings(g, p === 12 ? M.gold : M.silver, 9);
    skull(g, M.bone, 1);
    if (p === 10) {
      ring(g, 12, 12, 10, 11.5, M.red);
      skull(g, M.bone, 1);
    }
    if (p === 12) crown(g, M.gold, M.purple, 0);
  } else if (p === 13 || p === 14) {
    ring(g, 12, 12, 9.5, 11.5, p === 13 ? M.red : M.gold);
    star(g, 12, 12.5, 9, p === 13 ? M.black : M.red);
    disc(g, 12, 12.5, 2, p === 13 ? M.red : M.gold);
  } else if (p === 15) {
    laurel(g, M.gold);
    star(g, 12, 13, 8, M.gold);
    disc(g, 12, 13, 2.2, M.cyan);
    crown(g, M.gold, M.cyan, 0);
  }
  const px = resolve(g);
  emblemCache.set(p, px);
  return px;
}

// ---------------------------------------------------------------------------------------------
// Rank insignia (levels 1-50)
// ---------------------------------------------------------------------------------------------

const rankCache = new Map<number, (string | null)[]>();

/** 16x16 colour grid for the rank insignia of a level. */
export function rankPixels(level: number): (string | null)[] {
  const group = rankFor(level).group;
  const hit = rankCache.get(group);
  if (hit) return hit;
  const g = new Grid(16);
  const enlisted: [number, number, 'none' | 'diamond' | 'star' | 'wreath'][] = [
    [1, 0, 'none'], [1, 1, 'none'], [2, 0, 'none'], [2, 1, 'none'], [3, 0, 'none'], [3, 1, 'none'],
    [3, 2, 'none'], [3, 3, 'none'], [3, 3, 'diamond'], [3, 3, 'star'], [3, 3, 'wreath'],
  ];
  if (group <= 10) {
    const [chev, rock, mark] = enlisted[group]!;
    const thin = rock >= 2;
    const top = rock ? 1 : chev === 1 ? 5 : chev === 2 ? 3 : 2;
    const step = thin ? 2 : 3;
    for (let i = 0; i < chev; i++) chevron(g, top + i * step, M.gold, thin ? 6 : 7, thin ? 1 : 2);
    for (let i = 0; i < rock; i++) rocker(g, (thin ? 11 : 12) + i * 2, M.gold, 7, thin ? 1 : 2);
    if (mark === 'diamond') g.fill((x, y) => Math.abs(x - 8) + Math.abs(y - 10.5) <= 2, M.silver);
    if (mark === 'star' || mark === 'wreath') star(g, 8, 10.5, 2.8, M.silver);
    if (mark === 'wreath') ring(g, 8, 10.5, 3.3, 4.1, M.leaf);
  } else if (group <= 13) {
    const mat = group === 11 ? M.gold : M.silver;
    const bars = group === 13 ? 2 : 1;
    for (let b = 0; b < bars; b++) {
      const x0 = bars === 1 ? 6 : 3 + b * 7;
      const w = bars === 1 ? 4 : 3;
      for (let y = 3; y < 13; y++) for (let x = x0; x < x0 + w; x++) g.set(x, y, mat, false);
    }
  } else if (group <= 15) {
    const mat = group === 14 ? M.gold : M.silver;
    g.fill((x, y) => {
      const dx = Math.abs(x - 8);
      return y > 2 && y < 13 && dx < 5.5 - Math.abs(y - 7) * 0.55;
    }, mat);
    g.rect(7, 12, 1, 3, mat);
  } else if (group === 16) {
    wings(g, M.silver, 5);
    disc(g, 8, 7, 2.5, M.silver);
    g.rect(7, 9, 1, 4, M.silver);
  } else if (group <= 19) {
    const n = group - 16;
    const xs = n === 1 ? [8] : n === 2 ? [4.5, 11.5] : [3, 8, 13];
    for (const x of xs) star(g, x, 8, n === 3 ? 2.9 : n === 2 ? 3.8 : 5.5, M.silver);
  } else {
    laurel(g, M.leaf);
    star(g, 8, 8.5, 5, M.gold);
  }
  const px = resolve(g);
  rankCache.set(group, px);
  return px;
}

// ---------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------

/** Draw a colour grid at (x, y), `scale` screen pixels per grid pixel. */
export function drawPixels(g: CanvasRenderingContext2D, px: (string | null)[], x: number, y: number, scale: number): void {
  const n = Math.round(Math.sqrt(px.length));
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const c = px[j * n + i];
      if (!c) continue;
      g.fillStyle = c;
      g.fillRect(Math.round(x + i * scale), Math.round(y + j * scale), Math.ceil(scale), Math.ceil(scale));
    }
  }
}

/** The badge shown next to a name: the prestige emblem once prestiged, else the rank insignia. */
export const badgePixels = (level: number, prestige: number) => (prestige > 0 ? prestigeEmblemPixels(prestige) : rankPixels(level));

/** A crisp canvas element (CSS-scaled with pixelated rendering). */
export function pixelCanvas(px: (string | null)[], cssSize: number, label?: string): HTMLCanvasElement {
  const n = Math.round(Math.sqrt(px.length));
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  c.style.width = `${cssSize}px`;
  c.style.height = `${cssSize}px`;
  c.style.imageRendering = 'pixelated';
  if (label) {
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', label);
  }
  const g = c.getContext('2d');
  if (g) drawPixels(g, px, 0, 0, 1);
  return c;
}
