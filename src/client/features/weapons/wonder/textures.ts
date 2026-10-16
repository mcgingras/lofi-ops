/**
 * Texture recipes for the wonder weapons and their effects (drawn, or developed from the photos
 * the game already ships; no new downloads). `wonder.*` ids; the glowing ones are meant for
 * `emissive: 1` materials and additive sprites.
 */
import { grain } from '../../../render/developer';
import { registerTexture } from '../../../render/textures';

/** Ray Gun body: the brick-red enamel of BO1's Ray Gun. */
registerTexture('wonder.ray', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#8a2a1c', 0.12);
    g.fillStyle = '#a8402a';
    g.fillRect(0, 2, w, 1);
  },
  photos: ['rusty_painted_metal'],
  photo: (c) => c.fromPhoto('rusty_painted_metal', { w: 128, h: 128, tile: 128, filter: 'sepia(1) saturate(2.4) hue-rotate(-28deg) brightness(.62) contrast(1.15)' }),
});

/** Polished chrome (Ray Gun emitter, Winter's Howl body). */
registerTexture('wonder.chrome', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#b8bec6', 0.08);
    g.fillStyle = '#eef2f6';
    g.fillRect(0, 4, w, 2);
  },
  photos: ['blue_metal_plate'],
  photo: (c) => c.fromPhoto('blue_metal_plate', { w: 128, h: 128, tile: 128, filter: 'saturate(.1) brightness(1.5) contrast(1.2)' }),
});

/** Thundergun: dark, oily industrial steel. */
registerTexture('wonder.thunder', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#3a403a', 0.14);
    g.fillStyle = '#4e5650';
    g.fillRect(0, 0, w, 1);
  },
  photos: ['rusty_metal'],
  photo: (c) => c.fromPhoto('rusty_metal', { w: 128, h: 128, tile: 128, filter: 'saturate(.25) hue-rotate(60deg) brightness(.55) contrast(1.2)' }),
});

/** Copper coils and brass fittings (Wunderwaffe, Thundergun rings). */
registerTexture('wonder.copper', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#a8602e', 0.12);
    g.fillStyle = '#d88a4a';
    for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
  },
  photos: ['rusty_metal'],
  photo: (c) => c.fromPhoto('rusty_metal', { w: 128, h: 128, tile: 128, filter: 'sepia(1) saturate(2.2) hue-rotate(-12deg) brightness(.9) contrast(1.1)' }),
});

/** Winter's Howl: frosted pale-blue metal with ice crust speckles. */
registerTexture('wonder.frost', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#9cc4dc', 0.1);
    g.fillStyle = '#f2fbff';
    for (let i = 0; i < 14; i++) g.fillRect(Math.floor(R.rnd() * w), Math.floor(R.rnd() * h), 1 + Math.floor(R.rnd() * 2), 1);
  },
  photos: ['snow_02'],
  photo: (c) => c.fromPhoto('snow_02', { w: 128, h: 128, tile: 128, filter: 'sepia(.3) hue-rotate(170deg) saturate(1.6) brightness(.95) contrast(1.15)' }),
});

/** Glowing colours (emissive materials and sprites). */
for (const [id, base, hi] of [
  ['wonder.green', '#3cff3a', '#d8ffb0'],
  ['wonder.bulb', '#9ae8ff', '#ffffff'],
  ['wonder.ice', '#7ad8ff', '#e8fbff'],
  ['wonder.amber', '#ffb43a', '#fff0b0'],
] as const) {
  registerTexture(id, {
    w: 8,
    h: 8,
    posterize: false,
    draw(g, w, h) {
      g.fillStyle = base;
      g.fillRect(0, 0, w, h);
      g.fillStyle = hi;
      g.fillRect(2, 1, 3, 1);
      g.fillRect(1, 4, 2, 2);
    },
    photo: 'none',
  });
}

/** Clear-ish glass (bulb shells, tube covers). */
registerTexture('wonder.glass', {
  w: 8,
  h: 8,
  posterize: false,
  draw(g, w, h) {
    g.fillStyle = '#2a4a5a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#9cc8dc';
    g.fillRect(1, 1, 1, 4);
  },
  photo: 'none',
});

/** A soft round glow sprite (white, tinted per use): a stepped disc, alpha-tested edge. */
registerTexture('wonder.glow', {
  w: 16,
  h: 16,
  wrap: false,
  posterize: false,
  draw(g, w, h) {
    g.clearRect(0, 0, w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) / (w / 2);
        if (d > 1) continue;
        const v = Math.round(255 * Math.min(1, (1 - d) * 1.6));
        g.fillStyle = `rgba(${v},${v},${v},1)`;
        g.fillRect(x, y, 1, 1);
      }
  },
  photo: 'none',
});

/** A ring sprite (shockwaves, splash rings). */
registerTexture('wonder.ring', {
  w: 32,
  h: 32,
  wrap: false,
  posterize: false,
  draw(g, w, h) {
    g.clearRect(0, 0, w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) / (w / 2);
        if (d > 1 || d < 0.72) continue;
        const v = Math.round(255 * (1 - Math.abs(d - 0.86) / 0.14));
        g.fillStyle = `rgba(${v},${v},${v},1)`;
        g.fillRect(x, y, 1, 1);
      }
  },
  photo: 'none',
});

/** Ice shard sprite (frost particles, the shatter). */
registerTexture('wonder.shard', {
  w: 8,
  h: 8,
  wrap: false,
  posterize: false,
  draw(g) {
    g.clearRect(0, 0, 8, 8);
    g.fillStyle = '#e8fbff';
    g.fillRect(3, 0, 2, 8);
    g.fillRect(2, 2, 4, 4);
    g.fillStyle = '#9ad8f4';
    g.fillRect(3, 3, 1, 3);
  },
  photo: 'none',
});
