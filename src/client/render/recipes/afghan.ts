/**
 * Texture recipes for Afghan (maps-mw2): the pale pebbly desert floor, terrace dirt, banded sandstone
 * for the canyon walls and rock masses, mud-brick walls, weathered planks, bunker concrete and its blast
 * door, the C-130's weathered hull and ribbed cargo bay, a camo tarp, a striped mattress, the poppy
 * field, dry grass tufts and the bright desert sky. Lo-fi drawings are the PS1 look / instant fallback;
 * the photo looks develop the CC0 Poly Haven photos already in assets/textures (no new downloads).
 * Ids are prefixed `afg_`.
 */
import { blotch, dirtBottom, drips, grain, streaks, type Rand } from '../developer';
import { registerTexture } from '../textures';

/** Horizontal sandstone strata (shared by the drawing and the photo overlay). */
function strata(g: CanvasRenderingContext2D, R: Rand, w: number, h: number, n: number, a: number) {
  let y = 0;
  for (let i = 0; i < n && y < h; i++) {
    const band = R.rr(h / n * 0.5, (h / n) * 1.5);
    g.fillStyle = i % 2 ? `rgba(120,78,52,${a * R.rr(0.4, 1)})` : `rgba(246,214,170,${a * R.rr(0.3, 0.9)})`;
    g.fillRect(0, y, w, band);
    // Dark crack along the bottom of each bed.
    g.fillStyle = `rgba(60,38,26,${a * 1.4})`;
    for (let x = 0; x < w; x += 4) g.fillRect(x, y + band - 1 + Math.round(Math.sin(x * 0.07 + i) * 1.5), 4, Math.max(1, h / 128));
    y += band;
  }
}

registerTexture('afg_ground', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#cbb497', 0.08);
    blotch(g, R, w, h, 12, '#a68a68', 0.35, 3, 10);
    // Pale pebbles.
    for (let i = 0; i < 90; i++) {
      g.fillStyle = R.rnd() > 0.5 ? '#efe6d6' : '#dccfb8';
      g.fillRect(R.rr(0, w) | 0, R.rr(0, h) | 0, R.rr(1, 3) | 0, R.rr(1, 2) | 0);
    }
  },
  photos: ['dry_ground_rocks'],
  photo: (c) =>
    c.fromPhoto('dry_ground_rocks', {
      filter: 'sepia(.55) saturate(.9) hue-rotate(-6deg) brightness(1.45) contrast(.82)',
      over: (g, w, h) => {
        g.filter = 'blur(12px)';
        for (let i = 0; i < 9; i++) {
          g.fillStyle = i % 2 ? `rgba(140,104,70,${c.rr(0.08, 0.18)})` : `rgba(250,236,210,${c.rr(0.1, 0.22)})`;
          g.beginPath();
          g.ellipse(c.rr(0, w), c.rr(0, h), c.rr(50, 140), c.rr(30, 80), c.rr(0, 3), 0, 7);
          g.fill();
        }
        g.filter = 'none';
      },
    }),
});

registerTexture('afg_earth', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#a88a68', 0.1);
    blotch(g, R, w, h, 8, '#7a6048', 0.4, 2, 6);
  },
  photos: ['dirt'],
  photo: (c) => c.fromPhoto('dirt', { filter: 'sepia(.7) saturate(1.05) brightness(1.15) contrast(.9)', over: (g, w, h) => dirtBottom(g, w, h, 0.55, 0.35) }),
});

registerTexture('afg_rock', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#c49a78', 0.1);
    strata(g, R, w, h, 7, 0.35);
    blotch(g, R, w, h, 14, '#8a6248', 0.35, 2, 7);
    streaks(g, R, w, 0, 10, 40, 0.25, '90,60,40');
  },
  photos: ['aerial_rocks_02'],
  photo: (c) =>
    c.fromPhoto('aerial_rocks_02', {
      filter: 'sepia(.9) saturate(1.25) hue-rotate(-12deg) brightness(1.32) contrast(1.0)',
      over: (g, w, h) => {
        strata(g, c, w, h, 9, 0.28);
        drips(g, c, w, 0, 22, h * 0.5, 0.25);
      },
    }),
});

registerTexture('afg_rockTop', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#c8ac88', 0.1);
    blotch(g, R, w, h, 16, '#9a7a5a', 0.35, 3, 9);
    blotch(g, R, w, h, 10, '#e2cfb0', 0.35, 3, 9);
  },
  photos: ['aerial_rocks_02', 'coast_sand_04'],
  photo: (c) =>
    c.fromPhoto('aerial_rocks_02', {
      filter: 'sepia(.85) saturate(1.1) hue-rotate(-8deg) brightness(1.45) contrast(.85)',
      over: (g, w, h) => {
        const sand = c.photo('coast_sand_04');
        if (sand) {
          g.globalAlpha = 0.45;
          g.filter = 'sepia(.8) brightness(1.6)';
          g.drawImage(sand, 0, 0, w, h);
          g.filter = 'none';
          g.globalAlpha = 1;
        }
      },
    }),
});

registerTexture('afg_mud', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#b89a76', 0.08);
    // Mud-brick courses showing through the render.
    g.fillStyle = 'rgba(90,66,44,.35)';
    for (let y = 0; y < h; y += 8) {
      g.fillRect(0, y, w, 1);
      for (let x = (y / 8) % 2 ? 0 : 8; x < w; x += 16) g.fillRect(x, y, 1, 8);
    }
    blotch(g, R, w, h, 10, '#d8c09a', 0.4, 4, 12);
    dirtBottom(g, w, h, 0.7, 0.5);
  },
  photos: ['painted_plaster_wall'],
  photo: (c) =>
    c.fromPhoto('painted_plaster_wall', {
      filter: 'sepia(1) saturate(1.2) hue-rotate(-10deg) brightness(.92) contrast(.95)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(80,56,36,.28)';
        for (let y = 0; y < h; y += 64) {
          g.fillRect(0, y, w, 5);
          for (let x = (y / 64) % 2 ? 0 : 64; x < w; x += 128) g.fillRect(x, y, 5, 64);
        }
        g.filter = 'blur(6px)';
        for (let i = 0; i < 10; i++) {
          g.fillStyle = `rgba(232,208,170,${c.rr(0.15, 0.35)})`;
          g.fillRect(c.rr(0, w), c.rr(0, h), c.rr(60, 200), c.rr(30, 100));
        }
        g.filter = 'none';
        dirtBottom(g, w, h, 0.65, 0.55);
      },
    }),
});

registerTexture('afg_plank', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#8a7458', 0.12);
    g.fillStyle = '#4a3a2a';
    for (let x = 0; x < w; x += 6) g.fillRect(x, 0, 1, h);
    streaks(g, R, w, 0, 10, 28, 0.3, '50,36,24');
  },
  photos: ['weathered_plank_siding'],
  photo: (c) => c.fromPhoto('weathered_plank_siding', { filter: 'sepia(.6) saturate(.8) brightness(.95)', over: (g, w, h) => dirtBottom(g, w, h, 0.6, 0.5) }),
});

registerTexture('afg_bunker', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#a8a090', 0.07);
    blotch(g, R, w, h, 8, '#7a7266', 0.4, 2, 7);
    g.fillStyle = 'rgba(60,54,46,.4)';
    g.fillRect(0, 0, w, 1);
    streaks(g, R, w, 0, 10, 24, 0.35, '70,60,50');
  },
  photos: ['concrete_block_wall_02'],
  photo: (c) =>
    c.fromPhoto('concrete_block_wall_02', {
      filter: 'sepia(.4) saturate(.8) brightness(1.08) contrast(.95)',
      over: (g, w, h) => {
        drips(g, c, w, 0, 26, h * 0.6, 0.45);
        dirtBottom(g, w, h, 0.6, 0.6);
      },
    }),
});

registerTexture('afg_door', {
  w: 32,
  h: 32,
  wrap: false,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#5a6050', 0.08);
    g.fillStyle = '#2e3228';
    g.fillRect(0, 0, w, 2);
    g.fillRect(0, 0, 2, h);
    g.fillRect(w - 2, 0, 2, h);
    g.fillRect(w / 2 - 1, 2, 2, h - 2);
    // Hazard band and a wheel lock.
    for (let x = 0; x < w; x += 4) {
      g.fillStyle = (x / 4) % 2 ? '#d8b02a' : '#20201c';
      g.fillRect(x, h - 5, 4, 3);
    }
    g.strokeStyle = '#2a2a24';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(w / 2, h * 0.45, 5, 0, 7);
    g.stroke();
    streaks(g, R, w, 2, 8, 20, 0.4, '90,56,30');
  },
  photos: ['rusty_metal_shutter'],
  photo: (c) =>
    c.fromPhoto('rusty_metal_shutter', {
      filter: 'sepia(.35) saturate(.6) hue-rotate(40deg) brightness(.8)',
      over: (g, w, h) => {
        g.drawImage(c.base, 0, 0, w, h);
        g.globalCompositeOperation = 'multiply';
        g.globalAlpha = 0.5;
        const r = c.photo('rusty_metal_shutter');
        if (r) g.drawImage(r, 0, 0, w, h);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      },
    }),
});

registerTexture('afg_hull', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#9e9884', 0.07);
    g.fillStyle = 'rgba(40,40,34,.45)';
    for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 1);
    for (let x = 0; x < w; x += 21) g.fillRect(x, 0, 1, h);
    g.fillStyle = 'rgba(30,30,26,.5)';
    for (let y = 2; y < h; y += 16) for (let x = 2; x < w; x += 4) g.fillRect(x, y, 1, 1);
    streaks(g, R, w, 0, 14, 40, 0.35, '90,64,40');
    blotch(g, R, w, h, 8, '#6a5a46', 0.35, 2, 7);
  },
  photos: ['blue_metal_plate', 'rusty_painted_metal'],
  photo: (c) =>
    c.fromPhoto('blue_metal_plate', {
      filter: 'grayscale(.8) sepia(.45) brightness(1.55) contrast(.95)',
      over: (g, w, h) => {
        const rust = c.photo('rusty_painted_metal');
        if (rust) {
          g.globalAlpha = 0.35;
          g.globalCompositeOperation = 'multiply';
          g.drawImage(rust, 0, 0, w, h);
          g.globalCompositeOperation = 'source-over';
          g.globalAlpha = 1;
        }
        // Panel seams and rivet rows.
        g.fillStyle = 'rgba(30,30,26,.55)';
        for (let y = 0; y < h; y += 128) g.fillRect(0, y, w, 4);
        for (let x = 0; x < w; x += 170) g.fillRect(x, 0, 4, h);
        g.fillStyle = 'rgba(24,24,20,.45)';
        for (let y = 10; y < h; y += 128) for (let x = 6; x < w; x += 14) g.fillRect(x, y, 3, 3);
        drips(g, c, w, 0, 30, h * 0.5, 0.35);
      },
    }),
});

registerTexture('afg_cargo', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#5e6258', 0.08);
    g.fillStyle = 'rgba(20,22,18,.6)';
    for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 2, h);
    g.fillStyle = 'rgba(160,160,140,.25)';
    for (let x = 2; x < w; x += 8) g.fillRect(x, 0, 1, h);
    g.fillStyle = 'rgba(20,22,18,.4)';
    g.fillRect(0, h / 2, w, 1);
  },
  photos: ['box_profile_metal_sheet'],
  photo: (c) =>
    c.fromPhoto('box_profile_metal_sheet', {
      filter: 'grayscale(.6) sepia(.25) brightness(.55) contrast(1.15)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(14,16,12,.5)';
        g.fillRect(0, h * 0.48, w, 8);
        // Quilted insulation panels between the frames.
        g.fillStyle = 'rgba(120,124,100,.18)';
        for (let x = 20; x < w; x += 128) g.fillRect(x, 20, 88, h * 0.4);
      },
    }),
});

registerTexture('afg_tarp', {
  w: 32,
  h: 32,
  posterize: false,
  draw(g, w, h, R) {
    g.fillStyle = '#5e6440';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = ['#3e4428', '#7a7a50', '#4a4a30'][i % 3]!;
      g.beginPath();
      g.ellipse(R.rr(0, w), R.rr(0, h), R.rr(2, 6), R.rr(1, 4), R.rr(0, 3), 0, 7);
      g.fill();
    }
    // Net holes (cut out by the alpha test).
    for (let y = 1; y < h; y += 4) for (let x = (y % 8 === 1 ? 1 : 3); x < w; x += 4) g.clearRect(x, y, 1, 1);
  },
  photo: 'none',
});

registerTexture('afg_mattress', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#c8bca0', 0.06);
    g.fillStyle = 'rgba(70,96,120,.55)';
    for (let x = 0; x < w; x += 6) g.fillRect(x, 0, 2, h);
    blotch(g, R, w, h, 6, '#8a7458', 0.35, 2, 6);
  },
  photos: ['rough_linen'],
  photo: (c) =>
    c.fromPhoto('rough_linen', {
      filter: 'sepia(.5) brightness(1.05)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(60,90,120,.45)';
        for (let x = 0; x < w; x += 48) g.fillRect(x, 0, 16, h);
        g.filter = 'blur(10px)';
        for (let i = 0; i < 6; i++) {
          g.fillStyle = `rgba(110,84,50,${c.rr(0.15, 0.35)})`;
          g.beginPath();
          g.ellipse(c.rr(0, w), c.rr(0, h), c.rr(30, 80), c.rr(20, 50), 0, 0, 7);
          g.fill();
        }
        g.filter = 'none';
      },
    }),
});

registerTexture('afg_poppy', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#6a7a44', 0.12);
    blotch(g, R, w, h, 16, '#3e4e26', 0.5, 2, 5);
    blotch(g, R, w, h, 10, '#8a9a5a', 0.4, 2, 5);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = R.rnd() > 0.3 ? '#c8382c' : '#e8d8e0';
      g.fillRect(R.rr(0, w) | 0, R.rr(0, h) | 0, 2, 2);
    }
  },
  photos: ['leafy_grass'],
  photo: (c) =>
    c.fromPhoto('leafy_grass', {
      filter: 'saturate(.75) hue-rotate(-12deg) brightness(.95)',
      over: (g, w, h) => {
        for (let i = 0; i < 260; i++) {
          const x = c.rr(0, w);
          const y = c.rr(0, h);
          const r = c.rr(3, 7);
          g.fillStyle = c.rnd() > 0.25 ? `rgba(${(190 + c.rr(0, 50)) | 0},40,36,.9)` : 'rgba(236,222,230,.9)';
          g.beginPath();
          g.arc(x, y, r, 0, 7);
          g.fill();
          g.fillStyle = 'rgba(30,24,20,.8)';
          g.fillRect(x - 1, y - 1, 2, 2);
        }
      },
    }),
});

registerTexture('afg_grass', {
  w: 32,
  h: 20,
  wrap: false,
  posterize: false,
  draw(g, w, h, R) {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 36; i++) {
      const x0 = R.rr(4, w - 4);
      const lean = R.rr(-6, 6);
      const top = R.rr(1, h * 0.6);
      const k = R.rr(0.75, 1.15);
      g.strokeStyle = `rgb(${(176 * k) | 0},${(150 * k) | 0},${(96 * k) | 0})`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x0, h);
      g.quadraticCurveTo(x0 + lean * 0.3, (h + top) / 2, x0 + lean, top);
      g.stroke();
    }
  },
  photo: 'none',
});

registerTexture('afg_skyDay', {
  w: 256,
  h: 128,
  draw(g, _w, _h, R) {
    const lg = g.createLinearGradient(0, 0, 0, 128);
    // Deep blue overhead, fading to the dusty haze (fog colour) at the horizon.
    for (const [o, c] of [[0, '#4a78a8'], [0.22, '#6e98c0'], [0.4, '#a8bccc'], [0.49, '#ccc7b8'], [0.53, '#cdc6b6'], [1, '#a89a82']] as const) lg.addColorStop(o, c);
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 128);
    // Fair-weather cumulus.
    for (let i = 0; i < 18; i++) {
      const x = R.rr(0, 256);
      const y = R.rr(16, 50);
      const n = 3 + (R.rr(0, 4) | 0);
      for (const ox of [0, -256]) {
        for (let j = 0; j < n; j++) {
          g.fillStyle = `rgba(250,250,246,${R.rr(0.35, 0.7)})`;
          g.beginPath();
          g.ellipse(x + ox + j * R.rr(4, 9), y + R.rr(-2, 2), R.rr(5, 12), R.rr(2.5, 5), 0, 0, 7);
          g.fill();
        }
        g.fillStyle = 'rgba(150,160,176,.3)';
        g.fillRect(x + ox, y + 3, n * 7, 2);
      }
    }
    // Hazy mountain line on the horizon.
    g.fillStyle = 'rgba(150,140,124,.55)';
    for (let x = 0; x < 256; x++) g.fillRect(x, 60 + Math.sin(x / 9) * 1.6 + Math.sin(x / 3.3) * 0.7, 1, 5);
  },
  photo: 'sky',
});
