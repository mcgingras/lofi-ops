/**
 * Texture recipes for Jungle (`jg_*` ids, see src/shared/maps/jungle.ts): the leaf-litter floor,
 * creek mud and water, the waterfall, mossy ruin stone, bamboo walls and fences, thatch, clay
 * tiles, the camo net, ferns, the Viet Cong flag, the karst towers and the two skies (humid day,
 * misty morning). Photos: the existing Poly Haven CC0 set in assets/textures (no new downloads).
 */
import { blotch, grain, streaks, type Rand } from '../developer';
import { registerTexture } from '../textures';

/** Leaf litter: small ovals in browns and olive greens. */
function leaves(g: CanvasRenderingContext2D, R: Rand, w: number, h: number, n: number, s: number, a: number) {
  for (let i = 0; i < n; i++) {
    const k = R.rnd();
    g.fillStyle = k < 0.4 ? `rgba(110,80,44,${a})` : k < 0.75 ? `rgba(84,96,48,${a})` : `rgba(150,120,70,${a})`;
    g.beginPath();
    g.ellipse(R.rr(0, w), R.rr(0, h), R.rr(s * 0.5, s), R.rr(s * 0.25, s * 0.5), R.rr(0, 3.14), 0, 7);
    g.fill();
  }
}

registerTexture('jg_floor', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#5e5236', 0.1);
    blotch(g, R, w, h, 14, '#3e3a24', 0.45, 3, 10);
    blotch(g, R, w, h, 10, '#6a7040', 0.4, 2, 8);
    leaves(g, R, w, h, 60, 2.2, 0.55);
  },
  photos: ['dirt', 'forest_leaves_02'],
  photo: (c) =>
    c.fromPhoto('dirt', {
      filter: 'sepia(.55) saturate(.75) hue-rotate(28deg) brightness(.58) contrast(1.1)',
      over: (g, w, h) => {
        const lv = c.photo('forest_leaves_02');
        if (lv) {
          g.globalAlpha = 0.55;
          g.filter = 'hue-rotate(15deg) saturate(.7) brightness(.62)';
          g.drawImage(lv, 0, 0, w, h);
          g.filter = 'none';
          g.globalAlpha = 1;
        }
        g.filter = 'blur(8px)';
        for (let i = 0; i < 12; i++) {
          g.fillStyle = i % 2 ? `rgba(40,36,20,${c.rr(0.12, 0.25)})` : `rgba(110,120,70,${c.rr(0.1, 0.2)})`;
          g.beginPath();
          g.ellipse(c.rr(0, w), c.rr(0, h), c.rr(30, 90), c.rr(20, 60), c.rr(0, 3), 0, 7);
          g.fill();
        }
        g.filter = 'none';
      },
    }),
});

registerTexture('jg_mud', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#5a4630', 0.1);
    blotch(g, R, w, h, 16, '#3c2e1e', 0.5, 3, 10);
    blotch(g, R, w, h, 8, '#7a6444', 0.35, 2, 7);
  },
  photos: ['dirt'],
  photo: (c) =>
    c.fromPhoto('dirt', {
      filter: 'sepia(.6) saturate(.9) brightness(.62) contrast(1.1)',
      over: (g, w, h) => {
        g.filter = 'blur(6px)';
        for (let i = 0; i < 14; i++) {
          g.fillStyle = `rgba(30,22,12,${c.rr(0.15, 0.35)})`;
          g.beginPath();
          g.ellipse(c.rr(0, w), c.rr(0, h), c.rr(20, 70), c.rr(10, 40), c.rr(0, 3), 0, 7);
          g.fill();
        }
        g.filter = 'none';
      },
    }),
});

/** Muddy creek water: olive-brown with light ripple streaks. */
registerTexture('jg_water', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#6e6a4a', 0.06);
    blotch(g, R, w, h, 10, '#565638', 0.4, 4, 12);
    g.fillStyle = 'rgba(210,214,180,.35)';
    for (let i = 0; i < 26; i++) g.fillRect(R.rr(0, w), R.rr(0, h), R.rr(4, 14), 1);
  },
  photos: ['coast_sand_04'],
  photo: (c) =>
    c.fromPhoto('coast_sand_04', {
      filter: 'sepia(.9) hue-rotate(28deg) saturate(.8) brightness(.72) contrast(.7)',
      over: (g, w, h) => {
        g.filter = 'blur(4px)';
        for (let i = 0; i < 40; i++) {
          g.fillStyle = `rgba(220,226,190,${c.rr(0.12, 0.3)})`;
          g.fillRect(c.rr(0, w), c.rr(0, h), c.rr(30, 120), c.rr(2, 6));
        }
        g.filter = 'none';
      },
    }),
});

/** Falling water (alpha cut-out): broken vertical streaks. */
registerTexture('jg_falls', {
  w: 32,
  h: 64,
  wrap: false,
  posterize: false,
  draw(g, w, h, R) {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const x = R.rr(2, w - 2);
      const y = R.rr(-8, h);
      const l = R.rr(6, 22);
      const k = R.rr(0.75, 1);
      g.fillStyle = `rgb(${(200 * k) | 0},${(214 * k) | 0},${(206 * k) | 0})`;
      g.fillRect(x, y, R.rr(1, 2.5), l);
    }
  },
  photo: 'none',
});

/** Mossy temple stone: big blocks, dark joints, moss in the cracks. */
registerTexture('jg_stone', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#8e8a78', 0.08);
    g.fillStyle = 'rgba(40,40,30,.6)';
    for (let y = 0; y < h; y += 8) {
      g.fillRect(0, y, w, 1);
      for (let x = (y / 8) % 2 ? 4 : 12; x < w; x += 16) g.fillRect(x, y, 1, 8);
    }
    blotch(g, R, w, h, 8, '#5a6a3a', 0.45, 1, 4);
  },
  photos: ['concrete_block_wall_02'],
  photo: (c) =>
    c.fromPhoto('concrete_block_wall_02', {
      filter: 'sepia(.45) saturate(.75) hue-rotate(15deg) brightness(.9) contrast(1.15)',
      over: (g, w, h) => {
        g.globalCompositeOperation = 'multiply';
        g.filter = 'blur(5px)';
        for (let i = 0; i < 26; i++) {
          g.fillStyle = `rgba(${c.rr(70, 110) | 0},${c.rr(110, 140) | 0},${c.rr(50, 80) | 0},${c.rr(0.35, 0.6)})`;
          g.beginPath();
          g.ellipse(c.rr(0, w), c.rr(0, h), c.rr(10, 50), c.rr(6, 24), c.rr(0, 3), 0, 7);
          g.fill();
        }
        g.filter = 'none';
        g.globalCompositeOperation = 'source-over';
        streaks(g, c, w, 0, 18, h * 0.5, 0.25, '30,32,20');
      },
    }),
});

/** Upright bamboo canes with nodes (hut walls). */
function canes(g: CanvasRenderingContext2D, R: Rand, w: number, h: number, n: number, gap: number) {
  const cw = w / n;
  for (let i = 0; i < n; i++) {
    const x = i * cw;
    const k = R.rr(0.8, 1.1);
    const lg = g.createLinearGradient(x, 0, x + cw - gap, 0);
    lg.addColorStop(0, `rgb(${(110 * k) | 0},${(92 * k) | 0},${(52 * k) | 0})`);
    lg.addColorStop(0.4, `rgb(${(190 * k) | 0},${(164 * k) | 0},${(98 * k) | 0})`);
    lg.addColorStop(1, `rgb(${(96 * k) | 0},${(78 * k) | 0},${(44 * k) | 0})`);
    g.fillStyle = lg;
    g.fillRect(x, 0, cw - gap, h);
    g.fillStyle = 'rgba(60,44,20,.8)';
    for (let y = R.rr(0, h / 3); y < h; y += h / 3) g.fillRect(x, y, cw - gap, Math.max(1, h / 64));
  }
}

registerTexture('jg_bamboo', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    g.fillStyle = '#3a2c18';
    g.fillRect(0, 0, w, h);
    canes(g, R, w, h, 8, 0.5);
  },
  photos: ['brown_planks_05'],
  photo: (c) =>
    c.fromPhoto('brown_planks_05', {
      filter: 'sepia(.7) saturate(.9) brightness(.7)',
      over: (g, w, h) => {
        g.globalAlpha = 0.85;
        canes(g, c, w, h, 14, 3);
        g.globalAlpha = 1;
        streaks(g, c, w, 0, 14, h * 0.6, 0.18, '50,36,16');
      },
    }),
});

/** Bamboo pole fence: canes with gaps and two lashed rails (alpha cut-out). */
registerTexture('jg_bambooFence', {
  w: 64,
  h: 32,
  wrap: false,
  posterize: false,
  draw(g, w, h, R) {
    g.clearRect(0, 0, w, h);
    for (let x = 1; x < w; x += R.rr(3, 5)) {
      const k = R.rr(0.8, 1.1);
      const top = R.rr(0, 3);
      g.fillStyle = `rgb(${(150 * k) | 0},${(126 * k) | 0},${(72 * k) | 0})`;
      g.fillRect(x, top, 2, h - top);
      g.fillStyle = 'rgba(70,52,24,.9)';
      g.fillRect(x, top + R.rr(6, 10), 2, 1);
    }
    g.fillStyle = '#6a5228';
    g.fillRect(0, h * 0.3, w, 2);
    g.fillRect(0, h * 0.75, w, 2);
  },
  photo: 'none',
});

/** Thatch: layered straw courses with dark gaps. */
function straw(g: CanvasRenderingContext2D, R: Rand, w: number, h: number, rows: number, a: number) {
  for (let r = 0; r < rows; r++) {
    const y0 = (r * h) / rows;
    // Shadow under each course, then the straw strands hanging over it.
    const sh = g.createLinearGradient(0, y0, 0, y0 + h / rows);
    sh.addColorStop(0, 'rgba(30,20,8,.55)');
    sh.addColorStop(0.35, 'rgba(30,20,8,0)');
    g.fillStyle = sh;
    g.fillRect(0, y0, w, h / rows);
    for (let i = 0; i < w * 3; i++) {
      const x = R.rr(0, w);
      const k = R.rr(0.55, 1.1);
      g.strokeStyle = `rgba(${(160 * k) | 0},${(126 * k) | 0},${(68 * k) | 0},${a})`;
      g.lineWidth = Math.max(1, w / 128);
      g.beginPath();
      g.moveTo(x, y0);
      g.lineTo(x + R.rr(-2, 2) * (w / 64), y0 + (h / rows) * R.rr(0.8, 1.2));
      g.stroke();
    }
    g.fillStyle = 'rgba(40,28,12,.55)';
    g.fillRect(0, y0 + (h / rows) * 0.92, w, Math.max(1, h / 64));
  }
}

registerTexture('jg_thatch', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    g.fillStyle = '#6a5430';
    g.fillRect(0, 0, w, h);
    straw(g, R, w, h, 4, 0.9);
  },
  photos: ['rough_linen'],
  photo: (c) =>
    c.fromPhoto('rough_linen', {
      filter: 'sepia(1) saturate(1.1) brightness(.45) contrast(1.2)',
      over: (g, w, h) => {
        straw(g, c, w, h, 5, 0.85);
        g.filter = 'blur(6px)';
        for (let i = 0; i < 10; i++) {
          g.fillStyle = `rgba(50,40,20,${c.rr(0.15, 0.3)})`;
          g.beginPath();
          g.ellipse(c.rr(0, w), c.rr(0, h), c.rr(30, 80), c.rr(20, 50), 0, 0, 7);
          g.fill();
        }
        g.filter = 'none';
      },
    }),
});

/** Clay roof tiles: rows of half-round tiles. */
function tileRows(g: CanvasRenderingContext2D, R: Rand, w: number, h: number, rows: number, cols: number) {
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < cols; i++) {
      const x = (i + (r % 2) * 0.5) * (w / cols);
      const y = r * (h / rows);
      const k = R.rr(0.8, 1.1);
      const lg = g.createLinearGradient(x, 0, x + w / cols, 0);
      lg.addColorStop(0, `rgb(${(110 * k) | 0},${(44 * k) | 0},${(28 * k) | 0})`);
      lg.addColorStop(0.5, `rgb(${(178 * k) | 0},${(84 * k) | 0},${(54 * k) | 0})`);
      lg.addColorStop(1, `rgb(${(96 * k) | 0},${(38 * k) | 0},${(24 * k) | 0})`);
      g.fillStyle = lg;
      g.fillRect(x, y, w / cols - Math.max(1, w / 128), h / rows);
    }
    g.fillStyle = 'rgba(30,14,8,.6)';
    g.fillRect(0, (r + 1) * (h / rows) - Math.max(1, h / 64), w, Math.max(1, h / 64));
  }
}

registerTexture('jg_tiles', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    tileRows(g, R, w, h, 4, 4);
  },
  photos: ['grey_roof_01'],
  photo: (c) =>
    c.fromPhoto('grey_roof_01', {
      filter: 'sepia(1) saturate(2.4) hue-rotate(-18deg) brightness(.72)',
      over: (g, w, h) => {
        g.globalAlpha = 0.6;
        tileRows(g, c, w, h, 6, 8);
        g.globalAlpha = 1;
        g.filter = 'blur(6px)';
        for (let i = 0; i < 10; i++) {
          g.fillStyle = `rgba(40,50,30,${c.rr(0.15, 0.3)})`;
          g.beginPath();
          g.ellipse(c.rr(0, w), c.rr(0, h), c.rr(20, 60), c.rr(12, 40), 0, 0, 7);
          g.fill();
        }
        g.filter = 'none';
      },
    }),
});

/** Camo net (alpha cut-out): a mesh with leafy scraps. */
registerTexture('jg_net', {
  w: 64,
  h: 64,
  wrap: false,
  posterize: false,
  draw(g, w, h, R) {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(52,56,34,1)';
    g.lineWidth = 1;
    for (let i = -w; i < w * 2; i += 6) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + h, h);
      g.moveTo(i, h);
      g.lineTo(i + h, 0);
      g.stroke();
    }
    for (let i = 0; i < 90; i++) {
      const k = R.rnd();
      g.fillStyle = k < 0.4 ? '#4a5a2c' : k < 0.7 ? '#6a6438' : '#3a3a22';
      g.beginPath();
      g.ellipse(R.rr(0, w), R.rr(0, h), R.rr(1.5, 4), R.rr(1, 2.5), R.rr(0, 3), 0, 7);
      g.fill();
    }
  },
  photo: 'none',
});

/** Fern (alpha cut-out): arching fronds from a central clump. */
registerTexture('jg_fern', {
  w: 64,
  h: 40,
  wrap: false,
  posterize: false,
  draw(g, w, h, R) {
    g.clearRect(0, 0, w, h);
    for (let f = 0; f < 9; f++) {
      const dir = R.rr(-1, 1);
      const L = R.rr(16, 30);
      const lift = R.rr(20, 34);
      for (let s = 0; s < L; s += 1) {
        const t = s / L;
        const x = w / 2 + dir * s;
        const y = h - lift * Math.sin(t * Math.PI * 0.75) - t * 4;
        const k = R.rr(0.75, 1.1);
        g.fillStyle = `rgb(${(54 * k) | 0},${(98 * k) | 0},${(34 * k) | 0})`;
        const lw = (1 - t) * 3.5 + 0.6;
        g.fillRect(x - lw / 2, y - lw / 2, lw, Math.max(1, lw * 0.6));
      }
    }
  },
  photo: 'none',
});

/** National Liberation Front flag: red over blue with a yellow star. */
registerTexture('jg_flag', {
  w: 48,
  h: 32,
  wrap: false,
  draw(g, w, h, R) {
    g.fillStyle = '#b8242a';
    g.fillRect(0, 0, w, h / 2);
    g.fillStyle = '#2a4aa8';
    g.fillRect(0, h / 2, w, h / 2);
    g.fillStyle = '#f4d23a';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 4 : 10;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      g.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    // Cloth folds.
    for (let x = 0; x < w; x += 7) {
      g.fillStyle = `rgba(0,0,0,${R.rr(0.1, 0.22)})`;
      g.fillRect(x, 0, 2, h);
    }
  },
  photo: 'small',
});

/** Limestone karst towers: tall rounded silhouettes with jungle on their flanks (alpha cut-out). */
registerTexture('jg_karst', {
  w: 256,
  h: 96,
  wrap: false,
  posterize: false,
  draw(g, w, h, R) {
    g.clearRect(0, 0, w, h);
    const towers: [number, number, number][] = [];
    for (let x = 6; x < w - 6; x += R.rr(14, 30)) towers.push([x, R.rr(10, 26), R.rr(h * 0.15, h * 0.7)]);
    for (const [x, r, top] of towers) {
      const edge = Math.min(1, Math.min(x, w - x) / (w * 0.15));
      const t = h - (h - top) * edge;
      const lg = g.createLinearGradient(0, t, 0, h);
      lg.addColorStop(0, '#9aa496');
      lg.addColorStop(0.5, '#6e7c62');
      lg.addColorStop(1, '#4a5a3e');
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(x - r, h);
      g.lineTo(x - r * 0.85, t + r * 0.6);
      g.quadraticCurveTo(x - r * 0.6, t, x, t);
      g.quadraticCurveTo(x + r * 0.6, t, x + r * 0.85, t + r * 0.6);
      g.lineTo(x + r, h);
      g.closePath();
      g.fill();
    }
    g.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 120; i++) {
      g.fillStyle = R.rnd() > 0.5 ? 'rgba(52,70,40,.55)' : 'rgba(170,176,160,.3)';
      g.beginPath();
      g.arc(R.rr(0, w), R.rr(h * 0.2, h), R.rr(1.5, 5), 0, 7);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  },
  photo: 'none',
});

registerTexture('jg_skyHumid', {
  w: 256,
  h: 128,
  draw(g, _w, _h, R) {
    const lg = g.createLinearGradient(0, 0, 0, 128);
    for (const [o, c] of [[0, '#6f8fa8'], [0.28, '#9cb2bc'], [0.44, '#c2cabc'], [0.5, '#bac2ae'], [0.56, '#97a080'], [1, '#5e6a46']] as const) lg.addColorStop(o, c);
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 128);
    // Heavy, humid cumulus and a washed-out sun.
    for (let i = 0; i < 40; i++) {
      const x = R.rr(0, 256);
      const y = R.rr(10, 58);
      const w = R.rr(16, 54);
      for (const ox of [0, -256]) {
        g.fillStyle = `rgba(236,238,228,${R.rr(0.2, 0.5)})`;
        g.fillRect(x + ox, y, w, R.rr(2, 6));
        g.fillStyle = `rgba(150,160,160,${R.rr(0.1, 0.25)})`;
        g.fillRect(x + ox + w * 0.1, y + 4, w * 0.8, 2);
      }
    }
    const rg = g.createRadialGradient(150, 20, 0, 150, 20, 36);
    rg.addColorStop(0, 'rgba(255,252,230,.85)');
    rg.addColorStop(0.3, 'rgba(255,246,210,.35)');
    rg.addColorStop(1, 'rgba(255,246,210,0)');
    g.fillStyle = rg;
    g.fillRect(100, 0, 100, 60);
  },
  photo: 'sky',
});

registerTexture('jg_skyMist', {
  w: 256,
  h: 128,
  draw(g, _w, _h, R) {
    const lg = g.createLinearGradient(0, 0, 0, 128);
    for (const [o, c] of [[0, '#8a9cac'], [0.3, '#a8b6bc'], [0.45, '#bcc6c2'], [0.5, '#b2bcba'], [0.56, '#98a49c'], [1, '#6e7a70']] as const) lg.addColorStop(o, c);
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 128);
    // Low sun behind the mist, layered fog banks.
    const rg = g.createRadialGradient(56, 54, 0, 56, 54, 44);
    rg.addColorStop(0, 'rgba(255,236,196,.8)');
    rg.addColorStop(0.3, 'rgba(250,226,190,.35)');
    rg.addColorStop(1, 'rgba(250,226,190,0)');
    g.fillStyle = rg;
    g.fillRect(0, 10, 120, 90);
    for (let i = 0; i < 36; i++) {
      const x = R.rr(0, 256);
      const y = R.rr(34, 64);
      for (const ox of [0, -256]) {
        g.fillStyle = `rgba(226,230,228,${R.rr(0.15, 0.35)})`;
        g.fillRect(x + ox, y, R.rr(30, 90), R.rr(2, 5));
      }
    }
  },
  photo: 'sky',
});
