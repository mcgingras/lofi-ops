/**
 * Texture recipes for weapon furniture and equipment (developed from the Poly Haven photos the
 * core already ships; no new downloads).
 */
import { grain } from '../../render/developer';
import { registerTexture } from '../../render/textures';

registerTexture('weapons.poly', {
  w: 16,
  h: 16,
  draw: (g, w, h, R) => {
    grain(g, R, 0, 0, w, h, '#1d1e20', 0.1);
    g.fillStyle = '#2c2e31';
    g.fillRect(0, 0, 16, 1);
  },
  photos: ['brown_leather'],
  photo: (c) => c.fromPhoto('brown_leather', { w: 128, h: 128, tile: 128, filter: 'grayscale(1) brightness(.32) contrast(1.2)' }),
});

registerTexture('weapons.olive', {
  w: 16,
  h: 16,
  draw: (g, w, h, R) => grain(g, R, 0, 0, w, h, '#4a5136', 0.1),
  photos: ['rough_linen'],
  photo: (c) => c.fromPhoto('rough_linen', { w: 128, h: 128, tile: 128, filter: 'sepia(1) hue-rotate(40deg) saturate(.9) brightness(.42)' }),
});

registerTexture('weapons.tan', {
  w: 16,
  h: 16,
  draw: (g, w, h, R) => grain(g, R, 0, 0, w, h, '#8a7a5a', 0.1),
  photos: ['rough_linen'],
  photo: (c) => c.fromPhoto('rough_linen', { w: 128, h: 128, tile: 128, filter: 'sepia(.8) saturate(.8) brightness(.62)' }),
});

registerTexture('weapons.steel', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#8e939a', 0.08);
    g.fillStyle = '#c8ccd2';
    g.fillRect(0, 3, 16, 1);
  },
  photos: ['blue_metal_plate'],
  photo: (c) => c.fromPhoto('blue_metal_plate', { w: 128, h: 128, tile: 128, filter: 'saturate(.05) brightness(1.25) contrast(1.1)' }),
});

registerTexture('weapons.lens', {
  w: 8,
  h: 8,
  posterize: false,
  draw(g) {
    g.fillStyle = '#16304a';
    g.fillRect(0, 0, 8, 8);
    g.fillStyle = '#5a86b0';
    g.fillRect(1, 1, 2, 2);
  },
  photo: 'none',
});

/** Emissive reticle red (red dot, reflex ring, ACOG chevron). */
registerTexture('weapons.red', {
  w: 4,
  h: 4,
  posterize: false,
  draw(g) {
    g.fillStyle = '#ff3020';
    g.fillRect(0, 0, 4, 4);
  },
  photo: 'none',
});

registerTexture('weapons.brass', {
  w: 8,
  h: 8,
  draw: (g, w, h, R) => grain(g, R, 0, 0, w, h, '#b08a3a', 0.1),
  photo: 'auto',
});

registerTexture('weapons.shell', {
  w: 8,
  h: 8,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#a82018', 0.1);
    g.fillStyle = '#c8a040';
    g.fillRect(0, 6, 8, 2);
  },
  photo: 'auto',
});

registerTexture('weapons.nadegreen', {
  w: 8,
  h: 8,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#3c4628', 0.14);
    g.fillStyle = '#20261a';
    g.fillRect(0, 3, 8, 1);
    g.fillRect(3, 0, 1, 8);
  },
  photos: ['rusty_painted_metal'],
  photo: (c) => c.fromPhoto('rusty_painted_metal', { w: 64, h: 64, tile: 64, filter: 'sepia(1) hue-rotate(45deg) saturate(.8) brightness(.38)' }),
});
