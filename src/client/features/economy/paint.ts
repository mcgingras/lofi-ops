/**
 * Canvas painters for economy cosmetics: camo patterns (tileable), reticles and emblem
 * backgrounds. Used by the camo texture recipes (developer pipeline), the store/picker previews
 * and the HUD. Pure canvas 2D, deterministic for a given Rand.
 */
import type { CamoRecipe } from '../../../shared/defs/camos';
import type { EmblemBackgroundDef, ReticleShape } from '../../../shared/defs/store';
import type { Rand } from '../../render/developer';

export const css = (c: number, a = 1) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

/** Draw `fn` at the 9 wrapped offsets so shapes tile seamlessly. */
function wrap(w: number, h: number, fn: (ox: number, oy: number) => void) {
  for (const oy of [-h, 0, h]) for (const ox of [-w, 0, w]) fn(ox, oy);
}

function blob(g: CanvasRenderingContext2D, R: Rand, x: number, y: number, r: number, sx = 1.4, k = 8) {
  const pts: [number, number][] = [];
  for (let i = 0; i < k; i++) {
    const a = (i / k) * Math.PI * 2;
    const rad = r * R.rr(0.55, 1.2);
    pts.push([Math.cos(a) * rad * sx, Math.sin(a) * rad]);
  }
  return (ox: number, oy: number) => {
    g.beginPath();
    pts.forEach(([px, py], i) => (i ? g.lineTo(x + px + ox, y + py + oy) : g.moveTo(x + px + ox, y + py + oy)));
    g.closePath();
    g.fill();
  };
}

/** Fill a closed polygon of local points rotated by `a` around (x, y), at the 9 wrapped offsets. */
function poly(g: CanvasRenderingContext2D, w: number, h: number, x: number, y: number, a: number, pts: readonly (readonly [number, number])[]): void {
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const world = pts.map(([px, py]) => [x + px * c - py * sn, y + px * sn + py * c] as const);
  wrap(w, h, (ox, oy) => {
    g.beginPath();
    world.forEach(([px, py], i) => (i ? g.lineTo(px + ox, py + oy) : g.moveTo(px + ox, py + oy)));
    g.closePath();
    g.fill();
  });
}

/**
 * An ERDL "leaf": an elongated, lobed brush-stroke shape (half length `len`, half width `wid`).
 * The lobes (two harmonics plus jitter) give the interlocking edges of ERDL / woodland patterns.
 */
function erdlLeaf(R: Rand, len: number, wid: number, k = 14): [number, number][] {
  const ph1 = R.rr(0, 6.28);
  const ph2 = R.rr(0, 6.28);
  const pts: [number, number][] = [];
  for (let i = 0; i < k; i++) {
    const u = (i / k) * Math.PI * 2;
    const lobe = 1 + 0.28 * Math.sin(u * 3 + ph1) + 0.16 * Math.sin(u * 5 + ph2) + R.rr(-0.12, 0.12);
    pts.push([Math.cos(u) * len * lobe, Math.sin(u) * wid * lobe]);
  }
  return pts;
}

/** One tigerstripe stroke along +x: a wavy band with brushy, ragged edges, tapered at both ends. */
function tigerStroke(R: Rand, len: number, thick: number, amp: number): [number, number][] {
  const k = 22;
  const ph = R.rr(0, 6.28);
  const freq = R.rr(1.2, 2.6);
  const top: [number, number][] = [];
  const bot: [number, number][] = [];
  for (let i = 0; i <= k; i++) {
    const t = i / k;
    const x = (t - 0.5) * len;
    const cy = Math.sin(t * Math.PI * freq + ph) * amp;
    const taper = Math.pow(Math.sin(Math.PI * t), 0.55);
    // Ragged brush edge: occasional "fingers" poking out, more on the top edge.
    const fUp = R.rnd() < 0.18 ? R.rr(0.6, 1.4) : 0;
    const fDn = R.rnd() < 0.12 ? R.rr(0.5, 1.1) : 0;
    top.push([x + R.rr(-0.3, 0.3) * thick, cy - thick * taper * (R.rr(0.6, 1.05) + fUp)]);
    bot.push([x + R.rr(-0.3, 0.3) * thick, cy + thick * taper * (R.rr(0.6, 1.05) + fDn)]);
  }
  return [...top, ...bot.reverse()];
}

/** A pointed leaf outline (two curved sides) from (0,0) to (len,0), `wid` across. */
function leafPath(g: CanvasRenderingContext2D, x: number, y: number, a: number, len: number, wid: number): void {
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const P = (px: number, py: number): [number, number] => [x + px * c - py * sn, y + px * sn + py * c];
  const [x0, y0] = P(0, 0);
  const [x1, y1] = P(len, 0);
  const [ux, uy] = P(len * 0.45, -wid);
  const [dx, dy] = P(len * 0.45, wid);
  g.beginPath();
  g.moveTo(x0, y0);
  g.quadraticCurveTo(ux, uy, x1, y1);
  g.quadraticCurveTo(dx, dy, x0, y0);
  g.closePath();
  g.fill();
}

/** Paint a camo pattern over the whole canvas (opaque). */
export function paintCamo(g: CanvasRenderingContext2D, w: number, h: number, recipe: CamoRecipe, R: Rand): void {
  const cols = recipe.colors?.length ? recipe.colors : [0x5a6b3a, 0x3d4a28, 0x7a6a45, 0x2e2b22];
  const s = (recipe.scale ?? 1) * (w / 64);
  g.save();
  g.fillStyle = css(cols[0]!);
  g.fillRect(0, 0, w, h);
  const layers = cols.slice(1);
  switch (recipe.pattern) {
    case 'tiger': {
      g.fillStyle = css(layers[0] ?? 0x111111);
      const n = Math.max(5, Math.round(9 / (recipe.scale ?? 1)));
      for (let i = 0; i < n; i++) {
        const x0 = (i / n) * w + R.rr(-3, 3) * s;
        const amp = R.rr(2, 5) * s;
        const thick = R.rr(1.2, 3.2) * s;
        const ph = R.rr(0, 6.28);
        const y0 = R.rr(0, h);
        const len = R.rr(0.35, 0.8) * h;
        wrap(w, h, (ox, oy) => {
          g.beginPath();
          for (let k = 0; k <= 16; k++) {
            const y = y0 + (k / 16) * len;
            const t = Math.sin((k / 16) * Math.PI);
            g.lineTo(x0 + Math.sin(y * 0.15 / s + ph) * amp + ox - thick * t, y + oy);
          }
          for (let k = 16; k >= 0; k--) {
            const y = y0 + (k / 16) * len;
            const t = Math.sin((k / 16) * Math.PI);
            g.lineTo(x0 + Math.sin(y * 0.15 / s + ph) * amp + ox + thick * t, y + oy);
          }
          g.fill();
        });
      }
      if (layers[1] !== undefined) {
        g.fillStyle = css(layers[1], 0.6);
        for (let i = 0; i < 6; i++) wrap(w, h, blob(g, R, R.rr(0, w), R.rr(0, h), R.rr(2, 5) * s, 0.6));
      }
      break;
    }
    case 'digital': {
      const cell = Math.max(1, Math.round(2.5 * s));
      for (const [li, c] of layers.entries()) {
        g.fillStyle = css(c);
        const n = Math.round(((w * h) / (cell * cell)) * (0.05 - li * 0.008));
        for (let i = 0; i < n; i++) {
          const x = Math.floor(R.rr(0, w / cell)) * cell;
          const y = Math.floor(R.rr(0, h / cell)) * cell;
          const cw = cell * Math.ceil(R.rr(1, 4));
          const ch = cell * Math.ceil(R.rr(1, 3));
          wrap(w, h, (ox, oy) => g.fillRect(x + ox, y + oy, cw, ch));
        }
      }
      break;
    }
    case 'urban': {
      for (const [li, c] of layers.entries()) {
        g.fillStyle = css(c);
        for (let i = 0; i < 10 - li * 2; i++) {
          const x = R.rr(0, w);
          const y = R.rr(0, h);
          const rw = R.rr(4, 14) * s;
          const rh = R.rr(3, 9) * s;
          wrap(w, h, (ox, oy) => {
            g.fillRect(x + ox, y + oy, rw, rh);
            g.fillRect(x + ox + rw * 0.3, y + oy + rh, rw * 0.5, rh * 0.6);
          });
        }
      }
      break;
    }
    case 'snow': {
      for (const [li, c] of layers.entries()) {
        g.fillStyle = css(c);
        for (let i = 0; i < 16 - li * 5; i++) wrap(w, h, blob(g, R, R.rr(0, w), R.rr(0, h), R.rr(1.2, 4) * s * (li ? 0.7 : 1), 1.8, 6));
      }
      break;
    }
    case 'flora': {
      for (const [li, c] of layers.entries()) {
        g.fillStyle = css(c);
        for (let i = 0; i < 18 - li * 3; i++) {
          const x = R.rr(0, w);
          const y = R.rr(0, h);
          const a = R.rr(0, 3.14);
          const r = R.rr(2.5, 6) * s;
          wrap(w, h, (ox, oy) => {
            g.beginPath();
            g.ellipse(x + ox, y + oy, r, r * 0.35, a, 0, Math.PI * 2);
            g.fill();
          });
        }
      }
      break;
    }
    case 'blossom': {
      g.fillStyle = css(layers[2] ?? layers[0] ?? 0x804060, 0.35);
      for (let i = 0; i < 8; i++) wrap(w, h, blob(g, R, R.rr(0, w), R.rr(0, h), R.rr(4, 8) * s, 1.2));
      for (let i = 0; i < 9; i++) {
        const x = R.rr(0, w);
        const y = R.rr(0, h);
        const r = R.rr(1.6, 3) * s;
        const rot = R.rr(0, 1.2);
        wrap(w, h, (ox, oy) => {
          g.fillStyle = css(layers[0] ?? 0xe8a8c0);
          for (let k = 0; k < 5; k++) {
            const a = rot + (k / 5) * Math.PI * 2;
            g.beginPath();
            g.arc(x + ox + Math.cos(a) * r, y + oy + Math.sin(a) * r, r * 0.8, 0, Math.PI * 2);
            g.fill();
          }
          g.fillStyle = css(layers[1] ?? 0xffffff);
          g.beginPath();
          g.arc(x + ox, y + oy, r * 0.55, 0, Math.PI * 2);
          g.fill();
        });
      }
      break;
    }
    case 'metal': {
      const gr = g.createLinearGradient(0, 0, w, h);
      gr.addColorStop(0, css(cols[0]!));
      gr.addColorStop(0.35, css(layers[0] ?? 0xffffff));
      gr.addColorStop(0.5, css(cols[0]!));
      gr.addColorStop(0.8, css(layers[1] ?? 0x444444));
      gr.addColorStop(1, css(cols[0]!));
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      g.fillStyle = css(layers[0] ?? 0xffffff, 0.35);
      for (let i = 0; i < 5; i++) {
        const y = R.rr(0, h);
        g.fillRect(0, y, w, Math.max(1, s * 0.8));
      }
      break;
    }
    case 'ice': {
      g.fillStyle = css(layers[0] ?? 0xffffff, 0.5);
      for (let i = 0; i < 10; i++) wrap(w, h, blob(g, R, R.rr(0, w), R.rr(0, h), R.rr(3, 8) * s, 1.3, 5));
      g.lineWidth = Math.max(1, s * 0.6);
      for (const [li, c] of [layers[1] ?? 0x3070a0, layers[0] ?? 0xffffff].entries()) {
        g.strokeStyle = css(c, li ? 0.9 : 0.7);
        for (let i = 0; i < 7; i++) {
          let x = R.rr(0, w);
          let y = R.rr(0, h);
          const pts: [number, number][] = [[x, y]];
          for (let k = 0; k < 6; k++) {
            x += R.rr(-8, 8) * s;
            y += R.rr(-8, 8) * s;
            pts.push([x, y]);
          }
          wrap(w, h, (ox, oy) => {
            g.beginPath();
            pts.forEach(([px, py], j) => (j ? g.lineTo(px + ox, py + oy) : g.moveTo(px + ox, py + oy)));
            g.stroke();
          });
        }
      }
      break;
    }
    case 'dragon': {
      const r = 4 * s;
      const rows = Math.max(2, Math.round(h / (r * 1.4)));
      const colsN = Math.max(2, Math.round(w / (r * 2)));
      const cw = w / colsN;
      const rh = h / rows;
      for (let j = 0; j <= rows; j++)
        for (let i = 0; i <= colsN; i++) {
          const x = i * cw + (j % 2 ? cw / 2 : 0);
          const y = j * rh;
          const hi = R.rnd();
          g.fillStyle = css(hi > 0.8 ? (layers[1] ?? 0xffa030) : (layers[0] ?? 0xc83a1c));
          g.beginPath();
          g.arc(x, y, cw * 0.55, 0, Math.PI);
          g.fill();
          g.strokeStyle = css(layers[2] ?? 0x000000, 0.9);
          g.lineWidth = Math.max(1, s * 0.5);
          g.stroke();
        }
      break;
    }
    case 'erdl': {
      // MW2 Woodland / Urban / Desert: ERDL leaf pattern. Big interlocking leaves of the first
      // layer colour, smaller ones of the second, then thin dark "branch" strokes (third).
      const plan = [
        { n: 16, len: [6, 11], wid: [3, 5.2] },
        { n: 15, len: [4, 8], wid: [2, 3.6] },
        { n: 11, len: [4, 8.5], wid: [0.8, 1.4] },
      ];
      for (const [li, c] of layers.entries()) {
        const pl = plan[Math.min(li, plan.length - 1)]!;
        g.fillStyle = css(c);
        for (let i = 0; i < pl.n; i++) {
          const a = R.rr(-0.55, 0.55) + (R.rnd() < 0.25 ? Math.PI / 2 : 0);
          const pts = erdlLeaf(R, R.rr(pl.len[0]!, pl.len[1]!) * s, R.rr(pl.wid[0]!, pl.wid[1]!) * s, li === 2 ? 8 : 14);
          poly(g, w, h, R.rr(0, w), R.rr(0, h), a, pts);
        }
      }
      break;
    }
    case 'splinter': {
      // MW2 Arctic: angular shards with a shared slant (splinter camo), big pale ones first, then
      // smaller darker ones, then a few dark flecks.
      const slant = R.rr(-0.5, -0.3);
      const plan = [
        { n: 22, len: [10, 20], wid: [3, 6.5] },
        { n: 17, len: [6, 13], wid: [2, 4.5] },
        { n: 12, len: [2, 5], wid: [0.9, 1.8] },
      ];
      for (const [li, c] of layers.entries()) {
        const pl = plan[Math.min(li, plan.length - 1)]!;
        g.fillStyle = css(c);
        for (let i = 0; i < pl.n; i++) {
          const L = R.rr(pl.len[0]!, pl.len[1]!) * s;
          const W = R.rr(pl.wid[0]!, pl.wid[1]!) * s;
          const pts: [number, number][] = [
            [-L / 2, R.rr(-0.4, 0.4) * W],
            [R.rr(-0.3, 0.1) * L, -W],
            [L / 2, R.rr(-0.3, 0.3) * W],
            [R.rr(-0.1, 0.3) * L, W * R.rr(0.4, 1)],
          ];
          poly(g, w, h, R.rr(0, w), R.rr(0, h), slant + R.rr(-0.25, 0.25), pts);
        }
      }
      break;
    }
    case 'marpat': {
      // MW2 Digital: MARPAT-style pixel clusters on a grid that wraps (so it tiles exactly).
      const cell = Math.max(1, Math.round(2 * s));
      const nx = Math.max(1, Math.round(w / cell));
      const ny = Math.max(1, Math.round(h / cell));
      for (const [li, c] of layers.entries()) {
        g.fillStyle = css(c);
        const clusters = [10, 9, 6][li] ?? 5;
        for (let i = 0; i < clusters; i++) {
          const cx = Math.floor(R.rr(0, nx));
          const cy = Math.floor(R.rr(0, ny));
          const r = R.rr(2, li === 2 ? 3.5 : 5.5);
          const stretch = R.rr(1, 1.8);
          const R0 = Math.ceil(r * stretch) + 1;
          for (let dy = -R0; dy <= R0; dy++)
            for (let dx = -R0; dx <= R0; dx++) {
              const d = Math.hypot(dx / stretch, dy);
              if (d > r * R.rr(0.55, 1.15)) continue;
              const gx = (((cx + dx) % nx) + nx) % nx;
              const gy = (((cy + dy) % ny) + ny) % ny;
              g.fillRect(gx * cell, gy * cell, cell, cell);
            }
        }
      }
      break;
    }
    case 'tigerstripe': {
      // MW2 Red / Blue Tiger: Vietnam tigerstripe. A few broad strokes of the accent tone (third
      // colour) under bold, ragged dark stripes running across (second colour), in rows.
      const dark = layers[0] ?? 0x111111;
      const accent = layers[1];
      if (accent !== undefined) {
        g.fillStyle = css(accent);
        for (let i = 0; i < 7; i++) poly(g, w, h, R.rr(0, w), R.rr(0, h), R.rr(-0.25, 0.25), tigerStroke(R, R.rr(16, 30) * s, R.rr(2.5, 4.5) * s, R.rr(1, 2.5) * s));
      }
      g.fillStyle = css(dark);
      const rows = Math.max(4, Math.round(7 / (recipe.scale ?? 1)));
      for (let r = 0; r < rows; r++) {
        const y = ((r + R.rr(-0.25, 0.25)) / rows) * h;
        let x = R.rr(0, w);
        const segs = 2 + Math.floor(R.rr(0, 2));
        for (let k = 0; k < segs; k++) {
          const len = R.rr(14, 30) * s;
          poly(g, w, h, x + len / 2, y + R.rr(-1.5, 1.5) * s, R.rr(-0.22, 0.22), tigerStroke(R, len, R.rr(1.6, 3.4) * s, R.rr(0.8, 2.2) * s));
          x += len + R.rr(1, 8) * s;
        }
      }
      break;
    }
    case 'fall': {
      // MW2 Fall: autumn foliage (hunting camo). Red-brown patches on brown, black twigs, then
      // pointed leaves: orange (most), yellow, red-brown, and a few black leaf shadows.
      const [orange = 0xd4661c, yellow = 0xe0a82a, rust = 0x8a3416, black = 0x120e0a] = layers;
      g.fillStyle = css(rust);
      for (let i = 0; i < 7; i++) poly(g, w, h, R.rr(0, w), R.rr(0, h), R.rr(0, 3.14), erdlLeaf(R, R.rr(5, 9) * s, R.rr(3, 5) * s));
      g.strokeStyle = css(black);
      g.lineWidth = Math.max(1, 0.9 * s);
      g.lineCap = 'round';
      for (let i = 0; i < 7; i++) {
        const pts: [number, number][] = [[R.rr(0, w), R.rr(0, h)]];
        let a = R.rr(0, 6.28);
        for (let k = 0; k < 4; k++) {
          a += R.rr(-0.6, 0.6);
          const [px, py] = pts[pts.length - 1]!;
          const step = R.rr(3, 6) * s;
          pts.push([px + Math.cos(a) * step, py + Math.sin(a) * step]);
        }
        wrap(w, h, (ox, oy) => {
          g.beginPath();
          pts.forEach(([px, py], j) => (j ? g.lineTo(px + ox, py + oy) : g.moveTo(px + ox, py + oy)));
          g.stroke();
        });
      }
      const leaves: [number, number][] = [[black, 14], [orange, 30], [rust, 12], [yellow, 14], [orange, 12], [black, 5]];
      for (const [c, n] of leaves) {
        g.fillStyle = css(c);
        for (let i = 0; i < n; i++) {
          const x = R.rr(0, w);
          const y = R.rr(0, h);
          const a = R.rr(0, 6.28);
          const len = R.rr(3.5, 7.5) * s;
          const wid = len * R.rr(0.3, 0.45);
          wrap(w, h, (ox, oy) => leafPath(g, x + ox, y + oy, a, len, wid));
        }
      }
      break;
    }
    case 'blotch':
    default: {
      for (const [li, c] of layers.entries()) {
        g.fillStyle = css(c);
        const n = 12 - li * 3;
        for (let i = 0; i < n; i++) wrap(w, h, blob(g, R, R.rr(0, w), R.rr(0, h), R.rr(3, 7) * s * (1 - li * 0.15)));
      }
    }
  }
  g.restore();
}

/** Draw a reticle centred at (cx, cy), `size` px across. */
export function drawReticle(g: CanvasRenderingContext2D, cx: number, cy: number, size: number, shape: ReticleShape, color: number): void {
  const r = size / 2;
  const u = Math.max(1, Math.round(size / 12));
  g.save();
  g.fillStyle = css(color);
  g.strokeStyle = css(color);
  g.lineWidth = u;
  const dot = (d = u * 2) => g.fillRect(Math.round(cx - d / 2), Math.round(cy - d / 2), d, d);
  switch (shape) {
    case 'circle':
      g.beginPath();
      g.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
      g.stroke();
      dot();
      break;
    case 'cross':
      g.fillRect(Math.round(cx - r), Math.round(cy - u / 2), Math.round(r * 0.7), u);
      g.fillRect(Math.round(cx + r * 0.3), Math.round(cy - u / 2), Math.round(r * 0.7), u);
      g.fillRect(Math.round(cx - u / 2), Math.round(cy - r), u, Math.round(r * 0.7));
      g.fillRect(Math.round(cx - u / 2), Math.round(cy + r * 0.3), u, Math.round(r * 0.7));
      dot(u);
      break;
    case 'chevron':
      g.beginPath();
      g.moveTo(cx - r * 0.7, cy + r * 0.5);
      g.lineTo(cx, cy - r * 0.2);
      g.lineTo(cx + r * 0.7, cy + r * 0.5);
      g.stroke();
      break;
    case 'tri':
      g.beginPath();
      g.moveTo(cx, cy - r * 0.6);
      g.lineTo(cx + r * 0.6, cy + r * 0.45);
      g.lineTo(cx - r * 0.6, cy + r * 0.45);
      g.closePath();
      g.stroke();
      dot(u);
      break;
    case 'diamond':
      g.beginPath();
      g.moveTo(cx, cy - r * 0.7);
      g.lineTo(cx + r * 0.7, cy);
      g.lineTo(cx, cy + r * 0.7);
      g.lineTo(cx - r * 0.7, cy);
      g.closePath();
      g.stroke();
      dot();
      break;
    case 'smiley':
      g.beginPath();
      g.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
      g.stroke();
      g.fillRect(Math.round(cx - r * 0.35), Math.round(cy - r * 0.3), u * 2, u * 2);
      g.fillRect(Math.round(cx + r * 0.2), Math.round(cy - r * 0.3), u * 2, u * 2);
      g.beginPath();
      g.arc(cx, cy + r * 0.05, r * 0.4, 0.2, Math.PI - 0.2);
      g.stroke();
      break;
    case 'skull':
      g.beginPath();
      g.arc(cx, cy - r * 0.15, r * 0.55, Math.PI, 0);
      g.lineTo(cx + r * 0.55, cy + r * 0.2);
      g.lineTo(cx + r * 0.3, cy + r * 0.35);
      g.lineTo(cx + r * 0.3, cy + r * 0.6);
      g.lineTo(cx - r * 0.3, cy + r * 0.6);
      g.lineTo(cx - r * 0.3, cy + r * 0.35);
      g.lineTo(cx - r * 0.55, cy + r * 0.2);
      g.closePath();
      g.fill();
      g.fillStyle = '#000';
      g.fillRect(Math.round(cx - r * 0.35), Math.round(cy - r * 0.15), Math.round(r * 0.25), Math.round(r * 0.25));
      g.fillRect(Math.round(cx + r * 0.1), Math.round(cy - r * 0.15), Math.round(r * 0.25), Math.round(r * 0.25));
      break;
    case 'dot':
    default:
      dot(Math.max(2, Math.round(size / 5)));
  }
  g.restore();
}

/** Paint an emblem background into the whole canvas. */
export function drawEmblemBackground(g: CanvasRenderingContext2D, w: number, h: number, def: EmblemBackgroundDef, R: Rand): void {
  const [a = 0x333333, b = 0x777777, c = 0xaaaaaa] = def.colors;
  g.save();
  g.fillStyle = css(a);
  g.fillRect(0, 0, w, h);
  switch (def.pattern) {
    case 'stripes': {
      g.fillStyle = css(b);
      const n = 6;
      for (let i = -n; i < n * 2; i++) {
        g.beginPath();
        const x = (i / n) * w;
        g.moveTo(x, 0);
        g.lineTo(x + w / (n * 2), 0);
        g.lineTo(x + w / (n * 2) + h, h);
        g.lineTo(x + h, h);
        g.fill();
      }
      break;
    }
    case 'checker': {
      const n = 6;
      g.fillStyle = css(b);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if ((x + y) % 2) g.fillRect((x * w) / n, (y * h) / n, Math.ceil(w / n), Math.ceil(h / n));
      break;
    }
    case 'hazard': {
      g.fillStyle = css(b);
      for (let i = -8; i < 16; i += 2) {
        g.beginPath();
        const x = (i / 8) * w;
        g.moveTo(x, h);
        g.lineTo(x + w / 8, h);
        g.lineTo(x + w / 8 + h, 0);
        g.lineTo(x + h, 0);
        g.fill();
      }
      break;
    }
    case 'burst': {
      g.fillStyle = css(b);
      const n = 12;
      for (let i = 0; i < n; i += 1) {
        if (i % 2) continue;
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        g.beginPath();
        g.moveTo(w / 2, h / 2);
        g.lineTo(w / 2 + Math.cos(a0) * w, h / 2 + Math.sin(a0) * w);
        g.lineTo(w / 2 + Math.cos(a1) * w, h / 2 + Math.sin(a1) * w);
        g.fill();
      }
      break;
    }
    case 'camo':
      paintCamo(g, w, h, { pattern: 'blotch', colors: def.colors, scale: 1 }, R);
      break;
    case 'flag':
      g.fillStyle = css(b);
      g.fillRect(w / 3, 0, w / 3, h);
      g.fillStyle = css(c);
      g.fillRect((2 * w) / 3, 0, Math.ceil(w / 3), h);
      break;
    case 'gold':
      paintCamo(g, w, h, { pattern: 'metal', colors: [a, b, a] }, R);
      break;
    case 'solid':
    default:
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(0, 0, w, h / 2);
  }
  g.restore();
}
