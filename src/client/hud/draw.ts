/**
 * Pixel HUD drawing helpers (prototype `drawHud`): everything is drawn at render resolution in
 * whole "units" (`unit(h)` = floor(h / 240): 1 px at 240/360 lines, 2 at 480, 3 at 720), Silkscreen
 * text with a 1-unit dark outline, hard-edged rects. Feature HUD widgets should use these so the
 * HUD reads as one thing.
 */

export const HUD_COLORS = {
  ink: '#0a0a0a',
  paper: '#ece2ce',
  hi: '#ffd84a',
  warn: '#ff6a4a',
  dim: '#9a9488',
  health: '#e03a2a',
  blue: '#7ab0ff',
  friend: '#7ab0ff',
  enemy: '#ff6a4a',
  ammo: '#e8c060',
  empty: '#4a4640',
} as const;

export const FONT = 'Silkscreen, "Courier New", monospace';

/** Size of one HUD unit in pixels for a render height. */
export const unit = (h: number) => Math.max(1, Math.floor(h / 240));

export type Align = 'left' | 'center' | 'right';

const OUTLINE = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1]] as const;

/**
 * D-pad arrows (controller prompts like "[↑] NAPALM"): Silkscreen has no arrows, so they are drawn
 * as 5x5 pixel glyphs in the font's cap height.
 */
const ARROWS: Record<string, string[]> = {
  '↑': ['..#..', '.###.', '#.#.#', '..#..', '..#..'],
  '↓': ['..#..', '..#..', '#.#.#', '.###.', '..#..'],
  '←': ['..#..', '.#...', '#####', '.#...', '..#..'],
  '→': ['..#..', '...#.', '#####', '...#.', '..#..'],
};
const ARROW_RE = /([↑↓←→])/;

/** Cap box of the current font (top offset from a 'top' baseline, and height). */
function capBox(g: CanvasRenderingContext2D): { top: number; h: number } {
  const m = g.measureText('A');
  const asc = m.actualBoundingBoxAscent;
  const desc = m.actualBoundingBoxDescent;
  return Number.isFinite(asc) && Number.isFinite(desc) && asc + desc > 0 ? { top: -asc, h: asc + desc } : { top: 0, h: g.measureText('M').width };
}

function arrowWidth(g: CanvasRenderingContext2D): number {
  return Math.round(capBox(g).h * 1.4);
}

function drawArrow(g: CanvasRenderingContext2D, ch: string, x: number, y: number, color: string, u: number): void {
  const rows = ARROWS[ch]!;
  const cb = capBox(g);
  const px = Math.max(1, Math.round(cb.h / 5));
  const top = Math.round(y + cb.top + (cb.h - px * 5) / 2);
  const left = Math.round(x + (arrowWidth(g) - px * 5) / 2);
  const paint = (ox: number, oy: number, c: string) => {
    g.fillStyle = c;
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < 5; rx++) if (row[rx] === '#') g.fillRect(left + rx * px + ox, top + ry * px + oy, px, px);
    });
  };
  for (const [ox, oy] of OUTLINE) paint(ox * u, oy * u, HUD_COLORS.ink);
  paint(0, 0, color);
}

/** Width of `s` in the current font, counting pixel arrows. */
function measure(g: CanvasRenderingContext2D, s: string): number {
  if (!ARROW_RE.test(s)) return g.measureText(s).width;
  let w = 0;
  for (const part of s.split(ARROW_RE)) if (part) w += ARROWS[part] ? arrowWidth(g) : g.measureText(part).width;
  return w;
}

/** Outlined pixel text; `size` is in units (8 = small, 16 = big). Returns the text width. */
export function txt(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, align: Align = 'left', u = unit(g.canvas.height)): number {
  g.font = `${size * u}px ${FONT}`;
  g.textBaseline = 'top';
  if (ARROW_RE.test(s)) {
    // Mixed text and pixel arrows: lay the pieces out left to right.
    const w = measure(g, s);
    let cx = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x);
    g.textAlign = 'left';
    for (const part of s.split(ARROW_RE)) {
      if (!part) continue;
      if (ARROWS[part]) {
        drawArrow(g, part, cx, y, color, u);
        cx += arrowWidth(g);
        continue;
      }
      g.fillStyle = HUD_COLORS.ink;
      for (const [ox, oy] of OUTLINE) g.fillText(part, Math.round(cx + ox * u), Math.round(y + oy * u));
      g.fillStyle = color;
      g.fillText(part, Math.round(cx), Math.round(y));
      cx += g.measureText(part).width;
    }
    return w;
  }
  g.textAlign = align;
  g.fillStyle = HUD_COLORS.ink;
  for (const [ox, oy] of OUTLINE) g.fillText(s, Math.round(x + ox * u), Math.round(y + oy * u));
  g.fillStyle = color;
  g.fillText(s, Math.round(x), Math.round(y));
  return g.measureText(s).width;
}

export function textWidth(g: CanvasRenderingContext2D, s: string, size: number, u = unit(g.canvas.height)): number {
  g.font = `${size * u}px ${FONT}`;
  return measure(g, s);
}

export function rect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string): void {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** A rect with a 1-unit ink border. */
export function box(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string, u = unit(g.canvas.height)): void {
  rect(g, x - u, y - u, w + 2 * u, h + 2 * u, HUD_COLORS.ink);
  rect(g, x, y, w, h, c);
}

/** Blink helper: true for `on` seconds out of each `period`. */
export const blink = (t: number, period = 0.5, on = 0.3) => t % period < on;

/** mm:ss */
export function clock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
