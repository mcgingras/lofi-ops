/**
 * Texture recipes for Rust (maps-mw2): sand, rusted deck plate and beams, corrugated sheet, stair
 * treads, bar railings, crude tanks, pipeline paint, block walls, the site trailer, sandbags and
 * two desert skies. Lo-fi drawings are the PS1 look / instant fallback; photo looks develop the
 * CC0 Poly Haven photos already in assets/textures. Ids are prefixed `rust_` (other maps reuse some).
 */
import { blotch, col, dirtBottom, drips, grain, hex, stencil, stencilText, streaks, type Rand } from '../developer';
import { registerTexture } from '../textures';

/** Wind ripples across sand (shared by the drawn and the photo version). */
function ripples(g: CanvasRenderingContext2D, R: Rand, w: number, h: number, n: number, lw: number, a: number) {
  g.lineWidth = lw;
  for (let i = 0; i < n; i++) {
    const y0 = R.rr(0, h);
    const amp = R.rr(h * 0.01, h * 0.03);
    const ph = R.rr(0, 6.28);
    for (const [dy, c] of [[0, `rgba(255,236,200,${a})`], [lw * 1.5, `rgba(90,60,30,${a * 0.8})`]] as const) {
      g.strokeStyle = c;
      g.beginPath();
      for (let x = -4; x <= w + 4; x += 4) g.lineTo(x, y0 + dy + Math.sin((x / w) * 6.283 * 2 + ph) * amp);
      g.stroke();
    }
  }
}

registerTexture('rust_sand', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#c4a072', 0.07);
    blotch(g, R, w, h, 14, '#9a7650', 0.3, 4, 14);
    blotch(g, R, w, h, 10, '#e0c294', 0.3, 3, 10);
    ripples(g, R, w, h, 6, 1, 0.25);
  },
  photos: ['concrete_floor_worn_001'],
  photo: (c) =>
    c.fromPhoto('concrete_floor_worn_001', {
      filter: 'sepia(1) saturate(1.5) hue-rotate(-6deg) brightness(1.22) contrast(.8)',
      over: (g, w, h) => {
        g.filter = 'blur(10px)';
        for (let i = 0; i < 10; i++) {
          g.fillStyle = i % 2 ? `rgba(120,84,44,${c.rr(0.1, 0.22)})` : `rgba(250,226,180,${c.rr(0.1, 0.25)})`;
          g.beginPath();
          g.ellipse(c.rr(0, w), c.rr(0, h), c.rr(40, 120), c.rr(20, 60), c.rr(0, 3), 0, 7);
          g.fill();
        }
        g.filter = 'blur(1.5px)';
        ripples(g, c, w, h, 14, 3, 0.18);
        g.filter = 'none';
      },
    }),
});

registerTexture('rust_deck', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#5e4434', 0.12);
    blotch(g, R, w, h, 8, '#8a4a20', 0.5, 2, 6);
    g.fillStyle = '#2a1e18';
    g.fillRect(0, 0, w, 1);
    g.fillRect(0, 0, 1, h);
    for (let y = 3; y < h; y += 4) for (let x = (y >> 2) % 2 ? 2 : 0; x < w; x += 4) g.fillRect(x, y, 2, 1);
  },
  photos: ['blue_metal_plate', 'rusty_metal'],
  photo: (c) =>
    c.fromPhoto('blue_metal_plate', {
      filter: 'sepia(.9) saturate(1.5) hue-rotate(-12deg) brightness(.62) contrast(1.2)',
      over: (g, w, h) => {
        const rust = c.photo('rusty_metal');
        if (rust) {
          g.globalAlpha = 0.45;
          g.globalCompositeOperation = 'multiply';
          g.drawImage(rust, 0, 0, w, h);
          g.globalCompositeOperation = 'source-over';
          g.globalAlpha = 1;
        }
        // Tread pattern and plate seams.
        g.fillStyle = 'rgba(30,20,14,.35)';
        for (let y = 12; y < h; y += 24) for (let x = (y / 24) % 2 ? 12 : 0; x < w; x += 24) g.fillRect(x, y, 12, 3);
        g.fillStyle = 'rgba(20,14,10,.8)';
        g.fillRect(0, 0, w, 4);
        g.fillRect(0, 0, 4, h);
        g.fillStyle = 'rgba(200,150,110,.25)';
        g.fillRect(0, 4, w, 2);
      },
    }),
});

registerTexture('rust_beam', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#7a4528', 0.12);
    blotch(g, R, w, h, 5, '#3a2014', 0.5, 1, 4);
    g.fillStyle = '#3a2216';
    g.fillRect(0, 0, w, 1);
  },
  photos: ['rusty_painted_metal'],
  photo: (c) =>
    c.fromPhoto('rusty_painted_metal', {
      filter: 'sepia(1) saturate(2.1) hue-rotate(-18deg) brightness(.72) contrast(1.15)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(30,16,8,.55)';
        g.fillRect(0, 0, w, h * 0.06);
        g.fillRect(0, h * 0.94, w, h * 0.06);
      },
    }),
});

registerTexture('rust_corr', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    const b = hex('#8a5a3a');
    for (let x = 0; x < w; x++)
      for (let y = 0; y < h; y++) {
        g.fillStyle = col(b, (0.7 + 0.3 * Math.sin((x / w) * Math.PI * 14)) * R.rr(0.9, 1.08));
        g.fillRect(x, y, 1, 1);
      }
    streaks(g, R, w, 0, 18, 50, 0.45, '60,28,12');
    blotch(g, R, w, h, 6, '#4a3020', 0.5, 3, 8);
  },
  photos: ['worn_corrugated_iron'],
  photo: (c) =>
    c.fromPhoto('worn_corrugated_iron', {
      filter: 'sepia(.85) saturate(1.9) hue-rotate(-14deg) brightness(.78) contrast(1.1)',
      over: (g, w, h) => {
        drips(g, c, w, 0, 30, h * 0.6, 0.55);
        dirtBottom(g, w, h, 0.65, 0.55);
      },
    }),
});

registerTexture('rust_stairs', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#5a4232', 0.12);
    for (let x = 0; x < w; x += 8) {
      g.fillStyle = '#24180f';
      g.fillRect(x, 0, 1, h);
      g.fillStyle = '#a07a5a';
      g.fillRect(x + 1, 0, 1, h);
    }
    g.fillStyle = '#2a1e16';
    g.fillRect(0, 0, w, 2);
    g.fillRect(0, h - 2, w, 2);
  },
  photos: ['rusty_metal'],
  photo: (c) =>
    c.fromPhoto('rusty_metal', {
      filter: 'saturate(.75) brightness(.7) contrast(1.2)',
      over: (g, w, h) => {
        // Four treads per tile along the slope (u), stringers along the edges (v).
        for (let i = 0; i < 4; i++) {
          const x = (i * w) / 4;
          g.fillStyle = 'rgba(16,10,6,.85)';
          g.fillRect(x, 0, 10, h);
          g.fillStyle = 'rgba(210,170,120,.4)';
          g.fillRect(x + 10, 0, 6, h);
          g.fillStyle = 'rgba(30,20,12,.3)';
          for (let y = 8; y < h; y += 16) g.fillRect(x + 22, y, w / 4 - 30, 4);
        }
        g.fillStyle = 'rgba(40,24,14,.8)';
        g.fillRect(0, 0, w, 18);
        g.fillRect(0, h - 18, w, 18);
      },
    }),
});

registerTexture('rust_rail', {
  w: 32,
  h: 32,
  posterize: false,
  draw(g, w, h) {
    // Transparent except bars (alpha < 0.5 is discarded by the look shader).
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#7a4a2c';
    g.fillRect(0, 0, 3, h); // post
    g.fillRect(0, 0, w, 3); // top rail
    g.fillRect(0, 15, w, 2); // mid rail
    g.fillStyle = '#5a3420';
    g.fillRect(0, h - 4, w, 4); // kick plate
    g.fillStyle = '#9a6a44';
    g.fillRect(1, 0, 1, h);
    g.fillRect(0, 1, w, 1);
  },
  photo: 'none',
});

registerTexture('rust_tank', {
  w: 64,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#c8b89a', 0.06);
    g.fillStyle = '#6a4a30';
    g.fillRect(0, 4, w, 2);
    streaks(g, R, w, 0, 30, 26, 0.55, '110,56,24');
    stencil(g, 'CRUDE', 20, 18, 8, '#3a2a20');
  },
  photos: ['rusty_painted_metal'],
  photo: (c) =>
    c.fromPhoto('rusty_painted_metal', {
      w: 1024,
      h: 512,
      filter: 'saturate(.3) sepia(.4) brightness(1.4)',
      over: (g, w, h) => {
        // Weld seams (horizontal rings, vertical plate joints), rust run-off, stencils.
        g.fillStyle = 'rgba(70,46,30,.55)';
        for (let y = h / 4; y < h; y += h / 4) g.fillRect(0, y, w, 4);
        for (let x = 0; x < w; x += w / 6) g.fillRect(x, 0, 4, h);
        drips(g, c, w, 0, 70, h * 0.9, 0.6);
        drips(g, c, w, h / 4, 30, h * 0.4, 0.45);
        stencilText(g, ['CRUDE OIL', 'TANK 2  FLAMMABLE'], w * 0.18, h * 0.46, [64, 26], 'rgba(40,30,24,.8)');
        dirtBottom(g, w, h, 0.75, 0.6);
      },
    }),
});

registerTexture('rust_pipe', {
  w: 16,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#a8843a', 0.1);
    blotch(g, R, w, h, 6, '#6a3a18', 0.6, 1, 4);
    g.fillStyle = '#4a3418';
    g.fillRect(0, 0, w, 1);
  },
  photos: ['rusty_painted_metal'],
  photo: (c) =>
    c.fromPhoto('rusty_painted_metal', {
      filter: 'sepia(.75) saturate(1.5) hue-rotate(-6deg) brightness(.95)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(50,30,14,.6)';
        g.fillRect(0, 0, w, 10);
        g.fillStyle = 'rgba(230,200,140,.25)';
        g.fillRect(w * 0.3, 0, w * 0.08, h);
      },
    }),
});

registerTexture('rust_bldg', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#b7a284', 0.06);
    g.fillStyle = 'rgba(70,54,40,.35)';
    for (let y = 0; y < h; y += 8) {
      g.fillRect(0, y, w, 1);
      for (let x = ((y / 8) % 2) * 8; x < w; x += 16) g.fillRect(x, y, 1, 8);
    }
    streaks(g, R, w, 0, 10, 24, 0.3, '80,60,40');
  },
  photos: ['concrete_block_wall_02'],
  photo: (c) =>
    c.fromPhoto('concrete_block_wall_02', {
      filter: 'sepia(.45) saturate(1.05) brightness(1.3) contrast(.9)',
      over: (g, w, h) => {
        g.filter = 'blur(3px)';
        for (let i = 0; i < 12; i++) {
          const x = c.rr(0, w);
          const L = c.rr(60, 300);
          const lg = g.createLinearGradient(0, 0, 0, L);
          lg.addColorStop(0, 'rgba(70,52,34,.35)');
          lg.addColorStop(1, 'rgba(70,52,34,0)');
          g.fillStyle = lg;
          g.fillRect(x, 0, c.rr(4, 12), L);
        }
        g.filter = 'none';
        dirtBottom(g, w, h, 0.7, 0.45);
      },
    }),
});

registerTexture('rust_concrete', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#a49884', 0.07);
    blotch(g, R, w, h, 6, '#6a5e4c', 0.35, 2, 7);
    g.fillStyle = 'rgba(50,44,36,.5)';
    g.fillRect(0, 0, w, 1);
    g.fillRect(0, 0, 1, h);
  },
  photos: ['concrete'],
  photo: (c) => c.fromPhoto('concrete', { filter: 'sepia(.35) brightness(.98) contrast(1.05)', over: (g, w, h) => {
    g.fillStyle = 'rgba(40,34,28,.6)';
    g.fillRect(0, 0, w, 3);
    g.fillRect(0, 0, 3, h);
  } }),
});

registerTexture('rust_trailer', {
  w: 64,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#d6d2c6', 0.05);
    g.fillStyle = 'rgba(80,80,76,.4)';
    for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h);
    g.fillStyle = '#2f5a8a';
    g.fillRect(0, 22, w, 3);
    streaks(g, R, w, 0, 14, 20, 0.35, '110,70,40');
  },
  photos: ['box_profile_metal_sheet'],
  photo: (c) =>
    c.fromPhoto('box_profile_metal_sheet', {
      w: 1024,
      h: 512,
      tile: 512,
      filter: 'saturate(.15) brightness(1.3)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(40,80,130,.85)';
        g.fillRect(0, h * 0.68, w, h * 0.07);
        stencilText(g, ['SITE OFFICE'], w * 0.08, h * 0.3, [40], 'rgba(40,40,40,.75)');
        drips(g, c, w, 0, 40, h * 0.5, 0.4);
        dirtBottom(g, w, h, 0.6, 0.6);
      },
    }),
});

registerTexture('rust_sandbag', {
  w: 32,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#a89272', 0.08);
    g.fillStyle = '#5a4a36';
    g.fillRect(0, 7, w, 1);
    g.fillRect(15, 0, 1, 8);
    g.fillRect(7, 8, 1, 8);
    g.fillRect(23, 8, 1, 8);
  },
  photos: ['rough_linen'],
  photo: (c) =>
    c.fromPhoto('rough_linen', {
      w: 512,
      h: 256,
      tile: 256,
      filter: 'sepia(.8) saturate(1.1) brightness(.92)',
      over: (g, w, h) => {
        g.strokeStyle = 'rgba(50,38,24,.75)';
        g.lineWidth = 6;
        const bag = (x: number, y: number, bw: number, bh: number) => {
          g.beginPath();
          g.ellipse(x + bw / 2, y + bh / 2, bw / 2 - 4, bh / 2 - 4, 0, 0, 7);
          g.stroke();
        };
        for (let i = 0; i < 2; i++) bag(i * (w / 2), 0, w / 2, h / 2);
        for (let i = -1; i < 2; i++) bag(i * (w / 2) + w / 4, h / 2, w / 2, h / 2);
      },
    }),
});

// ----- skies -----
registerTexture('rust_skyDusk', {
  w: 256,
  h: 128,
  draw(g, _w, _h, R) {
    const lg = g.createLinearGradient(0, 0, 0, 128);
    for (const [o, c] of [[0, '#3a3456'], [0.24, '#6a4a62'], [0.4, '#b06a58'], [0.49, '#eaa46a'], [0.53, '#d8946a'], [1, '#6a4a3e']] as const) lg.addColorStop(o, c);
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 128);
    // Big hazy sun low on the horizon.
    const sg = g.createRadialGradient(60, 58, 2, 60, 58, 40);
    sg.addColorStop(0, 'rgba(255,230,170,.95)');
    sg.addColorStop(0.2, 'rgba(255,190,120,.6)');
    sg.addColorStop(1, 'rgba(255,160,100,0)');
    g.fillStyle = sg;
    g.fillRect(0, 0, 256, 128);
    // Dust bands.
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(${R.rnd() > 0.5 ? '230,160,110' : '120,70,80'},${R.rr(0.15, 0.4)})`;
      const x = R.rr(0, 256);
      const y = R.rr(30, 62);
      const w = R.rr(30, 90);
      g.fillRect(x, y, w, R.rr(1, 3) | 0);
      g.fillRect(x - 256, y, w, 2);
    }
    // Distant dune line.
    g.fillStyle = 'rgba(120,80,60,.55)';
    for (let x = 0; x < 256; x++) g.fillRect(x, 62 + Math.sin(x / 14) * 1.5 + Math.sin(x / 5) * 0.6, 1, 4);
  },
  photo: 'sky',
});

registerTexture('rust_skyHaze', {
  w: 256,
  h: 128,
  draw(g, _w, _h, R) {
    const lg = g.createLinearGradient(0, 0, 0, 128);
    for (const [o, c] of [[0, '#7c90a4'], [0.3, '#a8b0b4'], [0.48, '#e0d2b4'], [0.53, '#d6c4a2'], [1, '#9a8468']] as const) lg.addColorStop(o, c);
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(240,226,200,${R.rr(0.12, 0.3)})`;
      const x = R.rr(0, 256);
      const y = R.rr(10, 60);
      const w = R.rr(30, 80);
      g.fillRect(x, y, w, R.rr(2, 6));
      g.fillRect(x - 256, y, w, 3);
    }
    g.fillStyle = 'rgba(160,130,100,.5)';
    for (let x = 0; x < 256; x++) g.fillRect(x, 62 + Math.sin(x / 11) * 1.5, 1, 4);
  },
  photo: 'sky',
});
