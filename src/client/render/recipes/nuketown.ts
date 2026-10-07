/**
 * Texture recipes for Nuketown (`nt_*` ids, see src/shared/maps/nuketown.ts) and its two skies.
 * Siding, roof and plaster are near-neutral so the map tints them per house (green / yellow).
 * Photos: Poly Haven CC0 (assets/textures).
 */
import { blotch, grain, stencilText } from '../developer';
import { registerTexture } from '../textures';

registerTexture('nt_sand', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#c4a77c', 0.07);
    blotch(g, R, w, h, 14, '#9a7f58', 0.35, 3, 12);
    blotch(g, R, w, h, 10, '#e0c9a0', 0.3, 2, 8);
  },
  photos: ['dry_ground_rocks'],
  photo: (c) => c.fromPhoto('dry_ground_rocks', { filter: 'brightness(1.18) saturate(.85) contrast(.95)' }),
});

registerTexture('nt_grass', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#6f9a3c', 0.12);
    blotch(g, R, w, h, 10, '#4f7a2a', 0.4, 2, 6);
  },
  photos: ['leafy_grass'],
  photo: (c) => c.fromPhoto('leafy_grass', { filter: 'saturate(1.7) hue-rotate(18deg) brightness(1.05)' }),
});

registerTexture('nt_asphalt', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#4a4a4c', 0.12);
    g.fillStyle = 'rgba(15,15,15,.6)';
    let x = R.rr(4, 28);
    for (let y = 0; y < h; y++) {
      g.fillRect(x | 0, y, 1, 1);
      x += R.rr(-1, 1);
    }
  },
  photos: ['asphalt_02'],
  photo: (c) => c.fromPhoto('asphalt_02', { filter: 'brightness(.9)' }),
});

registerTexture('nt_siding', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#e6e2da', 0.05);
    for (let y = 0; y < h; y += 4) {
      g.fillStyle = 'rgba(60,55,50,.45)';
      g.fillRect(0, y, w, 1);
      g.fillStyle = 'rgba(255,255,255,.3)';
      g.fillRect(0, y + 1, w, 1);
    }
  },
  photos: ['weathered_plank_siding'],
  photo: (c) =>
    c.fromPhoto('weathered_plank_siding', {
      filter: 'grayscale(1) brightness(2.3) contrast(.85)',
      over: (g, w, h) => {
        // Lap siding: a soft shadow under every board edge.
        for (let y = 0; y < h; y += h / 10) {
          const lg = g.createLinearGradient(0, y, 0, y + 10);
          lg.addColorStop(0, 'rgba(40,36,30,.45)');
          lg.addColorStop(1, 'rgba(40,36,30,0)');
          g.fillStyle = lg;
          g.fillRect(0, y, w, 10);
        }
      },
    }),
});

registerTexture('nt_trim', {
  w: 16,
  h: 16,
  draw: (g, w, h, R) => grain(g, R, 0, 0, w, h, '#f2efe8', 0.04),
  photos: ['weathered_plank_siding'],
  photo: (c) => c.fromPhoto('weathered_plank_siding', { w: 256, h: 256, tile: 256, filter: 'grayscale(1) brightness(3) contrast(.6)' }),
});

registerTexture('nt_roof', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#b8b4ae', 0.1);
    g.fillStyle = 'rgba(30,30,30,.5)';
    for (let y = 0; y < h; y += 4) {
      g.fillRect(0, y, w, 1);
      for (let x = (y / 4) % 2 ? 2 : 6; x < w; x += 8) g.fillRect(x, y, 1, 4);
    }
  },
  photos: ['grey_roof_01'],
  photo: (c) => c.fromPhoto('grey_roof_01', { filter: 'grayscale(.6) brightness(1.5) contrast(1.1)' }),
});

registerTexture('nt_floor', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#8a5e3a', 0.08);
    g.fillStyle = 'rgba(40,20,10,.5)';
    for (let x = 0; x < w; x += 5) g.fillRect(x, 0, 1, h);
  },
  photos: ['plank_flooring'],
  photo: (c) => c.fromPhoto('plank_flooring', { filter: 'brightness(1.05)' }),
});

registerTexture('nt_plaster', {
  w: 16,
  h: 16,
  draw: (g, w, h, R) => grain(g, R, 0, 0, w, h, '#ece8e0', 0.04),
  photos: ['painted_plaster_wall'],
  photo: (c) => c.fromPhoto('painted_plaster_wall', { filter: 'grayscale(1) brightness(1.15)' }),
});

registerTexture('nt_brick', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#9a4a36', 0.1);
    g.fillStyle = '#cfc6b6';
    for (let y = 0; y < h; y += 4) {
      g.fillRect(0, y, w, 1);
      for (let x = (y / 4) % 2 ? 0 : 4; x < w; x += 8) g.fillRect(x, y, 1, 4);
    }
  },
});

/** White picket fence with transparent gaps (alpha cut-out decal). */
registerTexture('nt_picket', {
  w: 64,
  h: 32,
  posterize: false,
  draw(g, w, h, R) {
    g.clearRect(0, 0, w, h);
    const paint = (x: number, y: number, ww: number, hh: number) => grain(g, R, x, y, ww, hh, '#f4f1ea', 0.05);
    for (let x = 1; x < w; x += 8) {
      paint(x, 4, 5, h - 4);
      paint(x + 1, 2, 3, 2);
      paint(x + 2, 1, 1, 1);
    }
    paint(0, 9, w, 3);
    paint(0, 23, w, 3);
    g.fillStyle = 'rgba(80,76,70,.6)';
    g.fillRect(0, 12, w, 1);
    g.fillRect(0, 26, w, 1);
  },
  photo: 'none',
});

registerTexture('nt_woodfence', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#8d7258', 0.08);
    g.fillStyle = 'rgba(30,20,12,.6)';
    for (let x = 0; x < w; x += 5) g.fillRect(x, 0, 1, h);
  },
  photos: ['weathered_plank_siding'],
  photo: (c) =>
    c.fromPhoto('weathered_plank_siding', {
      over: (g, w, h) => {
        // Turn the boards upright: redraw the photo rotated a quarter turn.
        const ph = c.photo('weathered_plank_siding');
        if (!ph) return;
        g.save();
        g.translate(w / 2, h / 2);
        g.rotate(Math.PI / 2);
        g.filter = 'brightness(1.3) sepia(.2)';
        g.drawImage(ph, -w / 2, -h / 2, w, h);
        g.restore();
        g.filter = 'none';
      },
    }),
});

registerTexture('nt_bus', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#f0b418', 0.05);
    g.fillStyle = '#1a1a1a';
    g.fillRect(0, 14, w, 2);
    g.fillRect(0, 20, w, 2);
    g.fillStyle = 'rgba(80,60,20,.5)';
    g.fillRect(0, 31, w, 1);
  },
  photos: ['blue_metal_plate'],
  photo: (c) =>
    c.fromPhoto('blue_metal_plate', {
      w: 256,
      h: 256,
      tile: 256,
      filter: 'grayscale(1) sepia(1) saturate(5.5) hue-rotate(-8deg) brightness(1.35)',
      over: (g, w, h) => {
        g.fillStyle = '#161616';
        g.fillRect(0, h * 0.44, w, h * 0.05);
        g.fillRect(0, h * 0.62, w, h * 0.05);
        g.fillStyle = 'rgba(40,30,10,.35)';
        g.fillRect(0, h * 0.9, w, h * 0.1);
      },
    }),
});

registerTexture('nt_busWin', {
  w: 32,
  h: 24,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#f0b418', 0.05);
    g.fillStyle = '#202326';
    g.fillRect(3, 3, w - 6, h - 6);
    grain(g, R, 5, 5, w - 10, h - 10, '#3e4d58', 0.06);
    g.fillStyle = 'rgba(200,215,225,.35)';
    for (let i = 0; i < 10; i++) g.fillRect(6 + i, 16 - i, 2, 1);
    g.fillStyle = '#202326';
    g.fillRect(5, h / 2, w - 10, 1);
  },
});

/** The red "Welcome to Nuketown" board by the green house (population counter, hazard badges). */
registerTexture('nt_sign', {
  w: 256,
  h: 128,
  wrap: false,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#a8402e', 0.06);
    g.fillStyle = '#efe6cc';
    g.fillRect(4, 4, w - 8, 3);
    g.fillRect(4, h - 7, w - 8, 3);
    stencilText(g, ['Welcome to'], 30, 34, [18], '#efe6cc');
    stencilText(g, ['NUKETOWN'], 22, 72, [40], '#efe6cc');
    stencilText(g, ['Population'], 64, 102, [14], '#efe6cc');
    g.fillStyle = '#e8e4da';
    g.fillRect(168, 86, 16, 22);
    g.fillRect(188, 86, 16, 22);
    stencilText(g, ['0'], 171, 104, [16], '#222');
    stencilText(g, ['1'], 191, 104, [16], '#222');
    g.fillStyle = '#f2c230';
    g.beginPath();
    g.arc(222, 112, 8, 0, 7);
    g.fill();
    g.fillStyle = '#222';
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(222, 112);
      g.arc(222, 112, 7, (i * 2 * Math.PI) / 3 - 0.5, (i * 2 * Math.PI) / 3 + 0.5);
      g.fill();
    }
  },
  photo: 'small',
});

/** Black-and-white checkerboard kitchen linoleum. */
registerTexture('nt_tile', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    for (let y = 0; y < h; y += 8)
      for (let x = 0; x < w; x += 8) grain(g, R, x, y, 8, 8, (x + y) % 16 ? '#2e2a26' : '#e8e2d2', 0.05);
  },
  photos: ['concrete_floor_worn_001'],
  photo: (c) =>
    c.fromPhoto('concrete_floor_worn_001', {
      filter: 'grayscale(1) brightness(1.5) contrast(.6)',
      over: (g, w, h) => {
        // Multiply the checker over the worn-floor photo so the squares pick up its grime.
        g.globalCompositeOperation = 'multiply';
        g.drawImage(c.base, 0, 0, w, h);
        g.globalCompositeOperation = 'source-over';
      },
    }),
});

/** Green garden lattice (alpha cut-out) for the screened porch. */
registerTexture('nt_lattice', {
  w: 32,
  h: 32,
  posterize: false,
  draw(g, w, h, R) {
    g.clearRect(0, 0, w, h);
    for (let i = -h; i < w; i += 8) {
      for (let t = 0; t < h; t++) {
        grain(g, R, i + t, t, 2, 1, '#4fb27e', 0.06);
        grain(g, R, i + h - t, t, 2, 1, '#4fb27e', 0.06);
      }
    }
    grain(g, R, 0, 0, w, 2, '#f2efe8', 0.04);
    grain(g, R, 0, h - 2, w, 2, '#f2efe8', 0.04);
  },
  photo: 'none',
});

/** "Westward Moving & Delivery" box trailer side: brushed aluminium, red band, lettering. */
registerTexture('nt_trailer', {
  w: 128,
  h: 64,
  wrap: false,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#c9ccc8', 0.06);
    g.fillStyle = 'rgba(90,92,90,.5)';
    for (let x = 0; x < w; x += 6) g.fillRect(x, 0, 1, h);
    g.fillStyle = '#b3352a';
    g.fillRect(0, 34, w, 10);
    g.fillRect(0, h - 6, w, 6);
    stencilText(g, ['WESTWARD'], 10, 26, [18], '#b3352a');
    stencilText(g, ['MOVING & DELIVERY'], 12, 42, [8], '#f4efe2');
  },
  photos: ['blue_metal_plate'],
  photo: (c) =>
    c.fromPhoto('blue_metal_plate', {
      w: 256,
      h: 128,
      tile: 128,
      filter: 'grayscale(1) brightness(1.5) contrast(.8)',
      over: (g, w, h) => {
        g.globalCompositeOperation = 'multiply';
        g.drawImage(c.base, 0, 0, w, h);
        g.globalCompositeOperation = 'source-over';
      },
    }),
});

/** Distant desert range: an alpha-cut ridgeline (backdrop cards, `MapKit.backdropRing`). */
registerTexture('nt_mountains', {
  w: 256,
  h: 64,
  wrap: false,
  posterize: false,
  draw(g, w, h, R) {
    g.clearRect(0, 0, w, h);
    const lg = g.createLinearGradient(0, 0, 0, h);
    lg.addColorStop(0, '#a08a78');
    lg.addColorStop(1, '#c8b49a');
    g.fillStyle = lg;
    g.beginPath();
    g.moveTo(0, h);
    let y = h * 0.6;
    for (let x = 0; x <= w; x += 4) {
      // Peaks taper to the card edges so neighbouring cards overlap cleanly.
      const edge = Math.min(1, Math.min(x, w - x) / (w * 0.18));
      y = Math.max(4, Math.min(h - 2, y + R.rr(-5, 5)));
      g.lineTo(x, h - (h - y) * edge);
    }
    g.lineTo(w, h);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(70,56,48,.35)';
    for (let i = 0; i < 40; i++) g.fillRect(R.rr(0, w) | 0, R.rr(h * 0.3, h) | 0, R.rr(1, 3) | 0, R.rr(4, 14) | 0);
  },
  photos: ['dry_ground_rocks'],
  photo: (c) =>
    c.fromPhoto('dry_ground_rocks', {
      w: 512,
      h: 128,
      tile: 128,
      filter: 'saturate(.6) brightness(1.05)',
      over: (g, w, h) => {
        // Shade with the drawn ridge, then cut the photo to its silhouette.
        g.globalCompositeOperation = 'multiply';
        g.drawImage(c.base, 0, 0, w, h);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(c.base, 0, 0, w, h);
        g.globalCompositeOperation = 'source-over';
      },
    }),
});

// ----- skies (dome textures; the horizon sits at the middle) -----
registerTexture('nt_skyNoon', {
  w: 256,
  h: 128,
  draw(g, _w, _h, R) {
    const lg = g.createLinearGradient(0, 0, 0, 128);
    for (const [o, c] of [[0, '#2f6fb8'], [0.3, '#5f9ad4'], [0.46, '#a9cbe6'], [0.5, '#e6dcc4'], [0.53, '#d8c4a0'], [1, '#b89a70']] as const) lg.addColorStop(o, c);
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 128);
    // A few soft fair-weather clouds.
    for (let i = 0; i < 26; i++) {
      const x = R.rr(0, 256);
      const y = R.rr(14, 54);
      const w = R.rr(12, 40);
      for (const ox of [0, -256]) {
        g.fillStyle = `rgba(255,255,255,${R.rr(0.25, 0.55)})`;
        g.fillRect(x + ox, y, w, R.rr(2, 5));
        g.fillRect(x + ox + w * 0.2, y - 2, w * 0.5, 2);
      }
    }
    g.fillStyle = 'rgba(255,250,225,.5)';
    g.beginPath();
    g.arc(64, 18, 9, 0, 7);
    g.fill();
    g.fillStyle = '#fffbe8';
    g.beginPath();
    g.arc(64, 18, 4, 0, 7);
    g.fill();
  },
  photo: 'sky',
});

registerTexture('nt_skyDusk', {
  w: 256,
  h: 128,
  draw(g, _w, _h, R) {
    const lg = g.createLinearGradient(0, 0, 0, 128);
    for (const [o, c] of [[0, '#22184a'], [0.25, '#5a3270'], [0.4, '#c25a5a'], [0.49, '#ffae5a'], [0.53, '#d28050'], [1, '#6a4038']] as const) lg.addColorStop(o, c);
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = 'rgba(255,200,120,.4)';
    g.beginPath();
    g.arc(200, 60, 16, 0, 7);
    g.fill();
    g.fillStyle = '#ffd890';
    g.beginPath();
    g.arc(200, 60, 7, 0, 7);
    g.fill();
    for (let i = 0; i < 20; i++) {
      g.fillStyle = `rgba(120,50,80,${R.rr(0.45, 0.8)})`;
      const x = R.rr(0, 256);
      const y = R.rr(30, 58);
      g.fillRect(x, y, R.rr(20, 70), R.rr(1, 3) | 0);
      g.fillRect(x - 256, y, 60, 2);
    }
  },
  photo: 'sky',
});
