/** Texture recipes for killstreak hardware (photo looks developed from the Poly Haven set). */
import { grain, stencil } from '../../render/developer';
import { registerTexture } from '../../render/textures';

registerTexture('ks_olive', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#4c5236', 0.08);
    g.fillStyle = '#3a3e28';
    g.fillRect(0, 15, w, 1);
    g.fillRect(15, 0, 1, h);
  },
  photos: ['blue_metal_plate'],
  photo: (c) => c.fromPhoto('blue_metal_plate', { w: 256, h: 256, tile: 256, filter: 'hue-rotate(-120deg) saturate(.45) brightness(.62)' }),
});

registerTexture('ks_grey', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#7a7e82', 0.08);
    g.fillStyle = '#5c6064';
    g.fillRect(0, 10, w, 1);
    g.fillRect(0, 22, w, 1);
  },
  photos: ['rusty_painted_metal'],
  photo: (c) => c.fromPhoto('rusty_painted_metal', { w: 256, h: 256, tile: 256, filter: 'saturate(.15) brightness(.9)' }),
});

registerTexture('ks_dark', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#2a2c2e', 0.12);
  },
  photos: ['rusty_metal'],
  photo: (c) => c.fromPhoto('rusty_metal', { w: 128, h: 128, tile: 128, filter: 'saturate(.2) brightness(.35)' }),
});

registerTexture('ks_crate', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#6a7040', 0.1);
    g.fillStyle = '#3e4224';
    g.fillRect(0, 0, w, 2);
    g.fillRect(0, h - 2, w, 2);
    g.fillRect(0, 0, 2, h);
    g.fillRect(w - 2, 0, 2, h);
    g.fillStyle = '#e8e0c8';
    g.fillRect(10, 13, 12, 6);
    g.fillRect(13, 10, 6, 12);
  },
  photos: ['brown_planks_05'],
  photo: (c) =>
    c.fromPhoto('brown_planks_05', {
      w: 256,
      h: 256,
      tile: 256,
      filter: 'hue-rotate(40deg) saturate(.5) brightness(.7)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(30,32,18,.8)';
        g.fillRect(0, 0, w, 14);
        g.fillRect(0, h - 14, w, 14);
        g.fillRect(0, 0, 14, h);
        g.fillRect(w - 14, 0, 14, h);
        stencil(g, 'USMC', w / 2, h * 0.78, 30, 'rgba(232,224,200,.85)');
        g.fillStyle = 'rgba(232,224,200,.9)';
        g.fillRect(w * 0.42, h * 0.25, w * 0.16, h * 0.4);
        g.fillRect(w * 0.3, h * 0.37, w * 0.4, h * 0.16);
      },
    }),
});

registerTexture('ks_fur', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#4a3a2a', 0.18);
    g.fillStyle = '#2a2018';
    g.fillRect(0, 0, w, 4);
  },
  photos: ['brown_leather'],
  photo: (c) => c.fromPhoto('brown_leather', { w: 128, h: 128, tile: 128, filter: 'brightness(.55) saturate(.6)' }),
});

registerTexture('ks_glass', {
  w: 8,
  h: 8,
  draw(g, w, h) {
    g.fillStyle = '#1c2a36';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#5a7a94';
    g.fillRect(1, 1, 3, 1);
  },
  photo: 'none',
});

registerTexture('ks_fire', {
  w: 16,
  h: 16,
  wrap: false,
  posterize: false,
  draw(g) {
    g.fillStyle = '#ff9a2a';
    g.fillRect(4, 4, 8, 11);
    g.fillRect(2, 8, 12, 7);
    g.fillStyle = '#ffe07a';
    g.fillRect(6, 7, 4, 8);
    g.fillStyle = '#fff6d0';
    g.fillRect(7, 10, 2, 4);
  },
  photo: 'none',
});

registerTexture('ks_ring', {
  w: 32,
  h: 32,
  wrap: false,
  posterize: false,
  draw(g) {
    g.strokeStyle = '#ff3a2a';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(16, 16, 13, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#ff3a2a';
    g.fillRect(15, 6, 2, 20);
    g.fillRect(6, 15, 20, 2);
  },
  photo: 'none',
});

registerTexture('ks_pack', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#5a5030', 0.12);
    g.fillStyle = '#d8c070';
    g.fillRect(3, 6, 10, 4);
  },
  photo: 'small',
});

// Tactical Nuke: billowing smoke for the mushroom cloud (an aerial rock photo, blurred and greyed
// into lumpy cloud; the parts tint it hot or ashen), and the laptop's screen.
registerTexture('ks_cloud', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#b8b0a4', 0.12);
    for (let i = 0; i < 14; i++) {
      const x = R.rnd() * w;
      const y = R.rnd() * h;
      const r = 2 + R.rnd() * 5;
      g.fillStyle = R.rnd() < 0.5 ? '#d8d0c4' : '#8a8278';
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  },
  photos: ['aerial_rocks_02'],
  photo: (c) => c.fromPhoto('aerial_rocks_02', { w: 256, h: 256, tile: 256, filter: 'grayscale(1) blur(2px) contrast(1.5) brightness(1.35)' }),
});

registerTexture('ks_laptop', {
  w: 32,
  h: 24,
  wrap: false,
  posterize: false,
  draw(g, w, h) {
    g.fillStyle = '#0c1410';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#5cff8a';
    g.fillRect(2, 2, 12, 1);
    g.fillRect(2, 4, 8, 1);
    g.fillRect(2, 19, 28, 1);
    g.fillRect(2, 21, 18, 1);
    // A red trefoil-ish warning mark in the middle.
    g.fillStyle = '#ff3a2a';
    g.beginPath();
    g.arc(16, 11, 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0c1410';
    for (const a of [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 + (4 * Math.PI) / 3]) {
      g.beginPath();
      g.moveTo(16, 11);
      g.arc(16, 11, 6.5, a - 0.5, a + 0.5);
      g.fill();
    }
    g.fillStyle = '#ff3a2a';
    g.fillRect(15, 10, 2, 2);
  },
  photo: 'none',
});
