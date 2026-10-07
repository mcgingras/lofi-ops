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

/** Outlined pixel text; `size` is in units (8 = small, 16 = big). Returns the text width. */
export function txt(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, align: Align = 'left', u = unit(g.canvas.height)): number {
  g.font = `${size * u}px ${FONT}`;
  g.textAlign = align;
  g.textBaseline = 'top';
  g.fillStyle = HUD_COLORS.ink;
  for (const [ox, oy] of [[u, 0], [-u, 0], [0, u], [0, -u], [u, u]] as const) g.fillText(s, Math.round(x + ox), Math.round(y + oy));
  g.fillStyle = color;
  g.fillText(s, Math.round(x), Math.round(y));
  return g.measureText(s).width;
}

export function textWidth(g: CanvasRenderingContext2D, s: string, size: number, u = unit(g.canvas.height)): number {
  g.font = `${size * u}px ${FONT}`;
  return g.measureText(s).width;
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
