/**
 * Texture recipes for Firing Range (`fr_*` ids, see src/shared/maps/firingrange.ts) and its
 * jungle-morning sky. Photos: Poly Haven CC0 (assets/textures).
 */
import { blotch, grain, stencilText } from '../developer';
import { registerTexture } from '../textures';

registerTexture('fr_dirt', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#9a6a44', 0.08);
    blotch(g, R, w, h, 16, '#6e4a2e', 0.4, 3, 12);
    blotch(g, R, w, h, 10, '#b8875a', 0.3, 2, 8);
  },
  photos: ['dirt'],
  photo: (c) => c.fromPhoto('dirt', { filter: 'sepia(.55) saturate(1.5) hue-rotate(-12deg) brightness(1.3)' }),
});

registerTexture('fr_grass', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#5a6e2c', 0.12);
    blotch(g, R, w, h, 10, '#3e5220', 0.45, 2, 6);
  },
  photos: ['sparse_grass'],
  photo: (c) => c.fromPhoto('sparse_grass', { filter: 'saturate(1.2) brightness(1.1)' }),
});

registerTexture('fr_jungle', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#3c4a22', 0.14);
    blotch(g, R, w, h, 12, '#5a5a2a', 0.5, 2, 6);
  },
  photos: ['forest_leaves_02'],
  photo: (c) => c.fromPhoto('forest_leaves_02', { filter: 'hue-rotate(28deg) saturate(1.2) brightness(.72)' }),
});

registerTexture('fr_tin', {
  w: 32,
  h: 32,
  draw(g, _w, _h, R) {
    for (let x = 0; x < 32; x++) {
      const k = 0.75 + 0.25 * Math.sin((x / 32) * Math.PI * 8);
      grain(g, R, x, 0, 1, 32, k > 0.85 ? '#8a7a66' : '#6a5a48', 0.06);
    }
    blotch(g, R, 32, 32, 10, '#7a3e1e', 0.5, 2, 6);
  },
  photos: ['worn_corrugated_iron'],
  photo: (c) => c.fromPhoto('worn_corrugated_iron', { filter: 'sepia(.65) saturate(1.3) brightness(.92)' }),
});

registerTexture('fr_bark', {
  w: 16,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#5a4a3a', 0.12);
    g.fillStyle = 'rgba(20,14,8,.5)';
    for (let x = 1; x < w; x += 3) g.fillRect(x, 0, 1, h);
  },
  photos: ['bark_brown_02'],
  photo: (c) => c.fromPhoto('bark_brown_02', { filter: 'brightness(.9)' }),
});

registerTexture('fr_logs', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    for (let y = 0; y < h; y += 8) {
      grain(g, R, 0, y, w, 7, '#6a5038', 0.1);
      g.fillStyle = 'rgba(20,12,6,.8)';
      g.fillRect(0, y + 7, w, 1);
    }
  },
  photos: ['bark_brown_02'],
  photo: (c) =>
    c.fromPhoto('bark_brown_02', {
      over: (g, w, h) => {
        // Horizontal logs: the bark turned on its side, with a dark gap and a highlight per log.
        const ph = c.photo('bark_brown_02');
        if (ph) {
          g.save();
          g.translate(w / 2, h / 2);
          g.rotate(Math.PI / 2);
          g.drawImage(ph, -w / 2, -h / 2, w, h);
          g.restore();
        }
        for (let y = 0; y < h; y += h / 4) {
          const lg = g.createLinearGradient(0, y, 0, y + h / 4);
          lg.addColorStop(0, 'rgba(255,230,190,.18)');
          lg.addColorStop(0.6, 'rgba(0,0,0,0)');
          lg.addColorStop(1, 'rgba(15,10,5,.75)');
          g.fillStyle = lg;
          g.fillRect(0, y, w, h / 4);
        }
      },
    }),
});

registerTexture('fr_target', {
  w: 32,
  h: 64,
  wrap: false,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#b89a6a', 0.07);
    g.fillStyle = '#1c1c1c';
    g.beginPath();
    g.arc(16, 13, 6, 0, 7);
    g.fill();
    g.fillRect(6, 20, 20, 40);
    g.fillRect(9, 18, 14, 4);
    g.strokeStyle = '#d8d0b8';
    g.lineWidth = 1;
    for (const r of [4, 8, 12]) {
      g.beginPath();
      g.arc(16, 36, r, 0, 7);
      g.stroke();
    }
  },
  photo: 'small',
});

registerTexture('fr_foliage', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#3e5a26', 0.15);
    blotch(g, R, w, h, 18, '#22361a', 0.6, 2, 6);
    blotch(g, R, w, h, 10, '#6a8a3a', 0.5, 1, 4);
  },
  photos: ['forest_leaves_02'],
  photo: (c) =>
    c.fromPhoto('forest_leaves_02', {
      filter: 'hue-rotate(40deg) saturate(1.7) brightness(.78)',
      over: (g, w, h) => {
        g.globalCompositeOperation = 'multiply';
        for (let i = 0; i < 30; i++) {
          g.fillStyle = `rgba(40,70,30,${c.rr(0.2, 0.45)})`;
          g.beginPath();
          g.ellipse(c.rr(0, w), c.rr(0, h), c.rr(10, 40), c.rr(8, 26), c.rr(0, 3), 0, 7);
          g.fill();
        }
        g.globalCompositeOperation = 'source-over';
      },
    }),
});

/** Undergrowth card: leaf clusters on transparent (alpha cut-out). */
registerTexture('fr_bush', {
  w: 64,
  h: 40,
  wrap: false,
  posterize: false,
  draw(g, w, h, R) {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const x = R.rr(4, w - 4);
      const y = R.rr(h * 0.15 + Math.abs(x - w / 2) * 0.5, h);
      const s = R.rr(0.4, 1);
      g.fillStyle = `rgb(${(40 + 50 * s) | 0},${(70 + 70 * s) | 0},${(24 + 30 * s) | 0})`;
      g.beginPath();
      g.ellipse(x, y, R.rr(2, 5), R.rr(1.5, 3.5), R.rr(0, 3), 0, 7);
      g.fill();
    }
  },
  photo: 'none',
});

for (let i = 1; i <= 4; i++)
  registerTexture(`fr_lane${i}`, {
    w: 16,
    h: 16,
    wrap: false,
    draw(g, w, h, R) {
      grain(g, R, 0, 0, w, h, '#2e4a2a', 0.06);
      g.fillStyle = '#e8e2cc';
      g.fillRect(0, 0, w, 1);
      g.fillRect(0, h - 1, w, 1);
      stencilText(g, [String(i)], 4, 13, [13], '#f0ead4');
    },
    photo: 'small',
  });

registerTexture('fr_sign', {
  w: 128,
  h: 40,
  wrap: false,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#d8cfb4', 0.05);
    g.fillStyle = '#8a2a1e';
    g.fillRect(0, 0, w, 6);
    g.fillRect(0, h - 4, w, 4);
    stencilText(g, ['CAMPO DE TIRO', 'ZONA MILITAR'], 8, 22, [15, 10], '#2a2420');
  },
  photo: 'small',
});

/** Jungle hills: an alpha-cut silhouette with a bumpy canopy line (backdrop cards). */
registerTexture('fr_hills', {
  w: 256,
  h: 64,
  wrap: false,
  posterize: false,
  draw(g, w, h, R) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#4a6038';
    g.beginPath();
    g.moveTo(0, h);
    let y = h * 0.5;
    for (let x = 0; x <= w; x += 3) {
      const edge = Math.min(1, Math.min(x, w - x) / (w * 0.2));
      y = Math.max(6, Math.min(h - 4, y + R.rr(-3, 3)));
      g.lineTo(x, h - (h - y + R.rr(0, 3)) * edge);
    }
    g.lineTo(w, h);
    g.closePath();
    g.fill();
    g.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 60; i++) {
      g.fillStyle = R.rnd() > 0.5 ? 'rgba(30,44,24,.5)' : 'rgba(100,124,70,.4)';
      g.beginPath();
      g.arc(R.rr(0, w), R.rr(h * 0.3, h), R.rr(2, 6), 0, 7);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  },
  photos: ['forest_leaves_02'],
  photo: (c) =>
    c.fromPhoto('forest_leaves_02', {
      w: 512,
      h: 128,
      tile: 128,
      filter: 'hue-rotate(40deg) saturate(1.3) brightness(.8)',
      over: (g, w, h) => {
        g.globalCompositeOperation = 'multiply';
        g.drawImage(c.base, 0, 0, w, h);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(c.base, 0, 0, w, h);
        g.globalCompositeOperation = 'source-over';
      },
    }),
});

registerTexture('fr_skyMorning', {
  w: 256,
  h: 128,
  draw(g, _w, _h, R) {
    const lg = g.createLinearGradient(0, 0, 0, 128);
    for (const [o, c] of [[0, '#5a86b4'], [0.3, '#8fb2cc'], [0.45, '#d6dcc8'], [0.5, '#f0e2b8'], [0.53, '#b8c09a'], [1, '#6a7a52']] as const) lg.addColorStop(o, c);
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 128);
    // Low sun glow and humid haze streaks.
    const rg = g.createRadialGradient(40, 58, 0, 40, 58, 40);
    rg.addColorStop(0, 'rgba(255,240,190,.9)');
    rg.addColorStop(0.25, 'rgba(255,220,160,.45)');
    rg.addColorStop(1, 'rgba(255,220,160,0)');
    g.fillStyle = rg;
    g.fillRect(0, 18, 120, 80);
    for (let i = 0; i < 30; i++) {
      const x = R.rr(0, 256);
      const y = R.rr(20, 60);
      for (const ox of [0, -256]) {
        g.fillStyle = `rgba(240,236,220,${R.rr(0.15, 0.4)})`;
        g.fillRect(x + ox, y, R.rr(20, 70), R.rr(1, 4));
      }
    }
  },
  photo: 'sky',
});

/** Plywood sheathing: 1.2 x 2.4 m sheets with dark seams and nail lines. */
registerTexture('fr_ply', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#b8996e', 0.08);
    blotch(g, R, w, h, 8, '#8a6e4c', 0.3, 2, 8);
    g.fillStyle = 'rgba(40,26,14,.7)';
    g.fillRect(0, 0, w, 1);
    g.fillRect(0, 0, 1, h);
    g.fillRect(w / 2, 0, 1, h);
  },
  photos: ['brown_planks_05'],
  photo: (c) =>
    c.fromPhoto('brown_planks_05', {
      filter: 'sepia(.5) saturate(.8) brightness(1.55) contrast(.75)',
      over: (g, w, h) => {
        // Boards stood upright, then the sheet seams and nail lines.
        const ph = c.photo('brown_planks_05');
        if (ph) {
          g.save();
          g.filter = 'sepia(.5) saturate(.8) brightness(1.55) contrast(.75)';
          g.translate(w / 2, h / 2);
          g.rotate(Math.PI / 2);
          g.drawImage(ph, -w / 2, -h / 2, w, h);
          g.restore();
        }
        g.fillStyle = 'rgba(40,26,14,.55)';
        g.fillRect(0, 0, w, 2);
        g.fillRect(0, 0, 2, h);
        g.fillRect(w / 2, 0, 2, h);
        g.fillStyle = 'rgba(30,20,10,.35)';
        for (let y = 8; y < h; y += 16) for (const x of [4, w / 2 - 4, w / 2 + 4, w - 4]) g.fillRect(x, y, 1, 1);
      },
    }),
});

/** Corrugated metal siding, a neutral blue-grey meant to be tinted per material. */
registerTexture('fr_corr', {
  w: 32,
  h: 32,
  draw(g, _w, _h, R) {
    for (let x = 0; x < 32; x++) grain(g, R, x, 0, 1, 32, Math.sin((x / 32) * Math.PI * 10) > 0 ? '#9aa4aa' : '#6e7880', 0.05);
    blotch(g, R, 32, 32, 6, '#7a5a40', 0.35, 1, 5);
  },
  photos: ['box_profile_metal_sheet'],
  photo: (c) => c.fromPhoto('box_profile_metal_sheet', { filter: 'grayscale(1) brightness(2.5) contrast(1.15)' }),
});

/** Painted concrete block (the Bunker). */
registerTexture('fr_block', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#a8a296', 0.06);
    g.fillStyle = 'rgba(60,56,50,.5)';
    for (let y = 0; y < h; y += 8) {
      g.fillRect(0, y, w, 1);
      for (let x = (y / 8) % 2 ? 0 : 8; x < w; x += 16) g.fillRect(x, y, 1, 8);
    }
  },
  photos: ['concrete_block_wall_02'],
  photo: (c) => c.fromPhoto('concrete_block_wall_02', { filter: 'saturate(.55) sepia(.2) brightness(1.08)' }),
});

/** Palm crown seen from below or above: fronds radiating from the middle (alpha cut-out). */
registerTexture('fr_frondTop', {
  w: 64,
  h: 64,
  wrap: false,
  posterize: false,
  draw(g, w, h, R) {
    g.clearRect(0, 0, w, h);
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + R.rr(-0.2, 0.2);
      const L = R.rr(24, 31);
      for (let s = 3; s < L; s += 1.5) {
        const x = w / 2 + Math.cos(a) * s;
        const y = h / 2 + Math.sin(a) * s;
        const lw = Math.sin((s / L) * Math.PI) * 4.5 + 0.5;
        const k = R.rr(0.75, 1.1);
        g.fillStyle = `rgb(${(58 * k) | 0},${(96 * k) | 0},${(34 * k) | 0})`;
        g.beginPath();
        g.ellipse(x, y, 1.2, lw, a, 0, 7);
        g.fill();
      }
    }
    g.fillStyle = '#4a3a24';
    g.beginPath();
    g.arc(w / 2, h / 2, 3, 0, 7);
    g.fill();
  },
  photo: 'none',
});

/** Palm crown from the side: drooping fronds (alpha cut-out). */
registerTexture('fr_frondSide', {
  w: 64,
  h: 32,
  wrap: false,
  posterize: false,
  draw(g, w, h, R) {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      const dir = i % 2 ? 1 : -1;
      const L = R.rr(18, 30);
      const lift = R.rr(4, 12);
      for (let s = 0; s < L; s += 1.2) {
        const t = s / L;
        const x = w / 2 + dir * s;
        const y = h * 0.35 - lift * Math.sin(t * Math.PI * 0.6) + t * t * 14;
        const k = R.rr(0.75, 1.1);
        g.fillStyle = `rgb(${(56 * k) | 0},${(92 * k) | 0},${(32 * k) | 0})`;
        g.fillRect(x - 0.6, y - 1, 1.4, 2 + Math.sin(t * Math.PI) * 4);
      }
    }
  },
  photo: 'none',
});
