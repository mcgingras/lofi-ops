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
