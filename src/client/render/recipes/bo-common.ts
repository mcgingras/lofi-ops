/**
 * Texture recipes shared by the maps-bo maps (Nuketown, Firing Range): `bo_*` ids. Neutral bases
 * (car paint, fabric) are meant to be tinted per material (MaterialDef.tint).
 * Photos: Poly Haven CC0 (assets/textures).
 */
import { blotch, grain, streaks } from '../developer';
import { registerTexture } from '../textures';

registerTexture('bo_concrete', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#a9a49a', 0.06);
    blotch(g, R, w, h, 10, '#7a756c', 0.3, 2, 8);
  },
  photos: ['concrete'],
  photo: (c) => c.fromPhoto('concrete', { filter: 'brightness(1.08) saturate(.7)' }),
});

registerTexture('bo_planks', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#7d6650', 0.08);
    g.fillStyle = 'rgba(30,20,12,.6)';
    for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 1);
    streaks(g, R, w, 0, 6, 20, 0.25, '40,30,20');
  },
  photos: ['weathered_plank_siding'],
  photo: (c) => c.fromPhoto('weathered_plank_siding', { filter: 'brightness(1.25) saturate(.9)' }),
});

registerTexture('bo_wood', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#7a5234', 0.08);
    g.fillStyle = 'rgba(30,15,6,.45)';
    for (let i = 0; i < 10; i++) g.fillRect(0, R.rr(0, 32) | 0, R.rr(8, 32) | 0, 1);
  },
  photos: ['brown_planks_05'],
  photo: (c) => c.fromPhoto('brown_planks_05', { filter: 'sepia(.4) saturate(1.2) brightness(.85)' }),
});

registerTexture('bo_carpaint', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#d8d8d4', 0.04);
    g.fillStyle = 'rgba(40,40,40,.5)';
    g.fillRect(0, 12, w, 1);
    g.fillRect(16, 0, 1, h);
  },
  photos: ['blue_metal_plate'],
  photo: (c) =>
    c.fromPhoto('blue_metal_plate', {
      w: 256,
      h: 256,
      tile: 256,
      filter: 'grayscale(1) brightness(1.75) contrast(.8)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(30,30,30,.45)';
        g.fillRect(0, h * 0.4, w, 2);
        g.fillRect(w * 0.5, 0, 2, h);
        g.fillStyle = 'rgba(255,255,255,.25)';
        g.fillRect(0, h * 0.1, w, h * 0.05);
      },
    }),
});

registerTexture('bo_glass', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#2c3842', 0.05);
    g.fillStyle = 'rgba(190,210,225,.35)';
    for (let i = 0; i < 16; i++) g.fillRect(i, 15 - i, 3, 1);
  },
  photo: 'small',
});

registerTexture('bo_mannequin', {
  w: 16,
  h: 16,
  draw: (g, w, h, R) => grain(g, R, 0, 0, w, h, '#e3cfb3', 0.03),
  photo: 'small',
});

registerTexture('bo_fabric', {
  w: 16,
  h: 16,
  draw: (g, w, h, R) => grain(g, R, 0, 0, w, h, '#d0ccc4', 0.08),
  photos: ['rough_linen'],
  photo: (c) => c.fromPhoto('rough_linen', { w: 256, h: 256, tile: 256, filter: 'grayscale(1) brightness(1.5)' }),
});

registerTexture('bo_rock', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#8a7f70', 0.1);
    blotch(g, R, w, h, 18, '#5a5248', 0.5, 3, 12);
    blotch(g, R, w, h, 10, '#b0a490', 0.4, 2, 8);
  },
  photos: ['aerial_rocks_02'],
  photo: (c) => c.fromPhoto('aerial_rocks_02', { filter: 'saturate(.45) sepia(.35) brightness(1.05)' }),
});

registerTexture('bo_sandbag', {
  w: 32,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#a8936a', 0.08);
    g.fillStyle = 'rgba(50,40,24,.7)';
    for (let row = 0; row < 2; row++) {
      g.fillRect(0, row * 8, w, 1);
      for (let x = (row * 8) % 16; x < w; x += 16) g.fillRect(x, row * 8, 1, 8);
    }
  },
  photos: ['rough_linen'],
  photo: (c) =>
    c.fromPhoto('rough_linen', {
      w: 512,
      h: 256,
      tile: 256,
      filter: 'sepia(.85) saturate(.9) brightness(1.05)',
      over: (g, w, h) => {
        // Two rows of bags, staggered, with rounded shading and dark seams.
        for (let row = 0; row < 2; row++) {
          const y0 = (row * h) / 2;
          const off = row ? w / 8 : 0;
          for (let x = -w / 4 + off; x < w; x += w / 4) {
            const lg = g.createLinearGradient(0, y0, 0, y0 + h / 2);
            lg.addColorStop(0, 'rgba(255,240,210,.18)');
            lg.addColorStop(0.5, 'rgba(0,0,0,0)');
            lg.addColorStop(1, 'rgba(30,22,10,.45)');
            g.fillStyle = lg;
            g.beginPath();
            g.roundRect(x + 3, y0 + 3, w / 4 - 6, h / 2 - 6, 26);
            g.fill();
            g.strokeStyle = 'rgba(40,30,16,.75)';
            g.lineWidth = 4;
            g.stroke();
          }
        }
      },
    }),
});
