/**
 * Texture recipes used by core models and effects (soldier, viewmodel, sprites), plus `rubber`
 * which the Yard also uses. Ported from reference/yard-lab.html (`TX` + `RECIPES`).
 */
import { blotch, grain } from '../developer';
import { registerTexture } from '../textures';

registerTexture('glow', {
  w: 32,
  h: 32,
  wrap: false,
  posterize: false,
  draw(g) {
    const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.3, 'rgba(255,255,255,.5)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 32, 32);
  },
  photo: 'none',
});

registerTexture('flash', {
  w: 16,
  h: 16,
  wrap: false,
  draw(g) {
    g.fillStyle = '#ffcf40';
    for (let i = 1; i < 15; i++) {
      g.fillRect(i, 7, 1, 2);
      g.fillRect(7, i, 2, 1);
    }
    for (let i = 3; i < 13; i++) {
      g.fillRect(i, i, 1, 1);
      g.fillRect(15 - i, i, 1, 1);
    }
    g.fillStyle = '#fff6d0';
    g.fillRect(5, 5, 6, 6);
    g.fillRect(6, 3, 4, 10);
    g.fillRect(3, 6, 10, 4);
  },
  photo: 'none',
});

/** A chunky 8x8 puff for blood/sparks/dust (tinted per use). */
registerTexture('puff', {
  w: 8,
  h: 8,
  wrap: false,
  posterize: false,
  draw(g) {
    g.fillStyle = '#ffffff';
    g.fillRect(2, 1, 4, 6);
    g.fillRect(1, 2, 6, 4);
    g.fillStyle = 'rgba(255,255,255,0)';
    g.clearRect(3, 3, 1, 1);
  },
  photo: 'none',
});

registerTexture('face', {
  w: 16,
  h: 16,
  draw(g, _w, _h, R) {
    grain(g, R, 0, 0, 16, 16, '#c99a78', 0.05);
    grain(g, R, 0, 0, 16, 5, '#3c4a2c', 0.1);
    g.fillStyle = '#1a1414';
    g.fillRect(4, 8, 2, 2);
    g.fillRect(10, 8, 2, 2);
    g.fillStyle = '#8a4a40';
    g.fillRect(6, 12, 4, 1);
  },
});

registerTexture('camo', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#5a6b3a', 0.06);
    blotch(g, R, w, h, 12, '#3d4a28', 1, 4, 9);
    blotch(g, R, w, h, 8, '#7a6a45', 1, 3, 7);
    blotch(g, R, w, h, 6, '#2e2b22', 1, 2, 5);
  },
  photos: ['rough_linen'],
  photo: (c) =>
    c.fromPhoto('rough_linen', {
      w: 256,
      h: 256,
      tile: 256,
      filter: 'hue-rotate(-140deg) saturate(.45) brightness(.75)',
      over: (g, w, h) => {
        g.filter = 'blur(2px)';
        g.globalCompositeOperation = 'multiply';
        for (const [col, n, r] of [['#8a9a6a', 14, 30], ['#9a8a64', 10, 24], ['#5a564a', 9, 16]] as const)
          for (let i = 0; i < n; i++) {
            const cx = c.rr(0, w);
            const cy = c.rr(0, h);
            g.fillStyle = col;
            g.beginPath();
            for (let k = 0; k < 7; k++) {
              const a = (k / 7) * 6.283;
              const rad = r * c.rr(0.5, 1.2);
              g.lineTo(cx + Math.cos(a) * rad * 1.4, cy + Math.sin(a) * rad);
            }
            g.fill();
          }
        g.globalCompositeOperation = 'source-over';
        g.filter = 'none';
      },
    }),
});

registerTexture('vest', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#3a3f30', 0.1);
    g.fillStyle = '#26291f';
    g.fillRect(2, 4, 5, 4);
    g.fillRect(9, 4, 5, 4);
    g.fillRect(0, 12, 16, 2);
  },
  photos: ['caban'],
  photo: (c) =>
    c.fromPhoto('caban', {
      w: 256,
      h: 256,
      tile: 256,
      filter: 'hue-rotate(38deg) saturate(.35) brightness(.48)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(20,20,14,.55)';
        g.fillRect(w * 0.1, 0, w * 0.06, h);
        g.fillRect(w * 0.84, 0, w * 0.06, h);
        g.fillRect(0, h * 0.55, w, h * 0.04);
      },
    }),
});

registerTexture('gunmetal', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#34363b', 0.12);
    g.fillStyle = '#6a6f78';
    g.fillRect(0, 0, 32, 1);
    g.fillRect(0, 16, 32, 1);
    g.fillStyle = '#141518';
    for (let x = 4; x < 32; x += 6) g.fillRect(x, 6, 3, 1);
    g.fillRect(8, 22, 2, 2);
    g.fillRect(22, 24, 2, 2);
  },
  photos: ['blue_metal_plate'],
  photo: (c) => c.fromPhoto('blue_metal_plate', { w: 256, h: 256, tile: 256, filter: 'saturate(.12) brightness(.85) contrast(1.15)' }),
});

registerTexture('gunwood', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#6b4127', 0.08);
    g.fillStyle = 'rgba(30,15,6,.5)';
    for (let i = 0; i < 10; i++) g.fillRect(0, R.rr(0, 32) | 0, R.rr(8, 32) | 0, 1);
  },
  photos: ['brown_planks_05'],
  photo: (c) => c.fromPhoto('brown_planks_05', { w: 256, h: 256, tile: 256, filter: 'sepia(1) saturate(1.5) brightness(.42)' }),
});

registerTexture('glove', {
  w: 8,
  h: 8,
  draw: (g, w, h, R) => grain(g, R, 0, 0, w, h, '#3a3226', 0.14),
  photos: ['brown_leather'],
  photo: (c) => c.fromPhoto('brown_leather', { w: 128, h: 128, tile: 128, filter: 'brightness(.45) saturate(.6)' }),
});

registerTexture('rubber', {
  w: 8,
  h: 8,
  draw: (g, w, h, R) => grain(g, R, 0, 0, w, h, '#26241f', 0.15),
  photos: ['brown_leather'],
  photo: (c) => c.fromPhoto('brown_leather', { w: 128, h: 128, tile: 128, filter: 'brightness(.3) saturate(.3)' }),
});

registerTexture('knit', {
  w: 16,
  h: 16,
  draw: (g, w, h, R) => grain(g, R, 0, 0, w, h, '#2c2c2a', 0.12),
  photos: ['cotton_jersey'],
  photo: (c) => c.fromPhoto('cotton_jersey', { w: 128, h: 128, tile: 128, filter: 'brightness(.26) saturate(.3)' }),
});

registerTexture('mask', {
  w: 16,
  h: 16,
  draw(g, _w, _h, R) {
    grain(g, R, 0, 0, 16, 16, '#2c2c2a', 0.12);
    grain(g, R, 2, 6, 12, 3, '#c99a78', 0.05);
    g.fillStyle = '#141010';
    g.fillRect(4, 7, 2, 1);
    g.fillRect(10, 7, 2, 1);
  },
  photos: ['cotton_jersey'],
  photo: (c) =>
    c.fromPhoto('cotton_jersey', {
      w: 128,
      h: 128,
      tile: 128,
      filter: 'brightness(.26) saturate(.3)',
      over: (g, w, h) => {
        const ph = c.photo('cotton_jersey');
        if (ph) g.drawImage(ph, 0, 0, 512, 160, w * 0.1, h * 0.36, w * 0.8, h * 0.2);
        g.fillStyle = 'rgba(160,110,80,.35)';
        g.fillRect(w * 0.1, h * 0.36, w * 0.8, h * 0.2);
        g.fillStyle = '#1a1210';
        g.fillRect(w * 0.24, h * 0.42, w * 0.14, h * 0.07);
        g.fillRect(w * 0.62, h * 0.42, w * 0.14, h * 0.07);
      },
    }),
});
