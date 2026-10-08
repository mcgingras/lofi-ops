/**
 * Texture recipes for Estate (maps-mw2, `est_*` ids, see src/shared/maps/estate.ts): the pine
 * forest floor, the gravel driveway, the slate stone of the Lodge's plinth and the garden walls,
 * grey granite outcrops, the Lodge's dark-stained siding, weathered grey boards (boathouse,
 * workshop, garage, shed), creek water, alpha-cut pine cards and the snowy Caucasus backdrop.
 * Photos: Poly Haven CC0 (assets/textures).
 */
import { blotch, grain } from '../developer';
import { registerTexture } from '../textures';

registerTexture('est_forest', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#5e5a3e', 0.12);
    blotch(g, R, w, h, 16, '#3e3a26', 0.45, 3, 10);
    blotch(g, R, w, h, 12, '#8a6a3a', 0.35, 1, 4);
  },
  photos: ['sparse_grass', 'forest_leaves_02'],
  photo: (c) =>
    c.fromPhoto('sparse_grass', {
      filter: 'sepia(.35) saturate(.75) brightness(.86) hue-rotate(-8deg)',
      over: (g, w, h) => {
        // Pine needles and autumn leaf litter, a few snow patches.
        const leaves = c.photo('forest_leaves_02');
        if (leaves) {
          g.globalAlpha = 0.35;
          g.filter = 'sepia(.6) saturate(.8) brightness(.8)';
          g.drawImage(leaves, 0, 0, w, h);
          g.filter = 'none';
          g.globalAlpha = 1;
        }
        g.filter = 'blur(6px)';
        for (let i = 0; i < 4; i++) {
          g.fillStyle = `rgba(226,228,232,${c.rr(0.25, 0.45)})`;
          g.beginPath();
          g.ellipse(c.rr(0, w), c.rr(0, h), c.rr(20, 50), c.rr(10, 24), c.rr(0, 3), 0, 7);
          g.fill();
        }
        g.filter = 'none';
      },
    }),
});

registerTexture('est_gravel', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#7a6c58', 0.14);
    blotch(g, R, w, h, 30, '#9a9488', 0.4, 1, 3);
  },
  photos: ['forest_ground_04'],
  photo: (c) => c.fromPhoto('forest_ground_04', { filter: 'saturate(.7) brightness(1.02)' }),
});

registerTexture('est_stone', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#8a8478', 0.1);
    g.fillStyle = 'rgba(40,38,34,.55)';
    for (let y = 0; y < h; y += 6) {
      g.fillRect(0, y, w, 1);
      for (let x = (y / 6) % 2 ? 3 : 9; x < w; x += 12) g.fillRect(x, y, 1, 6);
    }
  },
  photos: ['castle_wall_slates'],
  photo: (c) => c.fromPhoto('castle_wall_slates', { filter: 'saturate(.8) brightness(.95)' }),
});

registerTexture('est_rock', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#7c7a74', 0.12);
    blotch(g, R, w, h, 16, '#5a5852', 0.5, 3, 12);
    blotch(g, R, w, h, 10, '#a8a49a', 0.35, 2, 7);
  },
  photos: ['aerial_rocks_02'],
  photo: (c) => c.fromPhoto('aerial_rocks_02', { filter: 'saturate(.25) brightness(.92) contrast(1.1)' }),
});

registerTexture('est_siding', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#4a3a2c', 0.1);
    g.fillStyle = 'rgba(16,10,6,.6)';
    for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
  },
  photos: ['weathered_plank_siding'],
  photo: (c) => c.fromPhoto('weathered_plank_siding', { filter: 'sepia(.7) saturate(1.1) brightness(.55) contrast(1.15)' }),
});

registerTexture('est_boards', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#7a766c', 0.12);
    g.fillStyle = 'rgba(30,28,24,.5)';
    for (let x = 0; x < w; x += 5) g.fillRect(x, 0, 1, h);
  },
  photos: ['weathered_plank_siding'],
  photo: (c) => c.fromPhoto('weathered_plank_siding', { filter: 'saturate(.25) brightness(.92)' }),
});

registerTexture('est_water', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#3a5058', 0.08);
    g.fillStyle = 'rgba(170,196,204,.35)';
    for (let i = 0; i < 14; i++) g.fillRect(R.rr(0, w) | 0, R.rr(0, h) | 0, R.rr(3, 9) | 0, 1);
  },
  photo: 'small',
});

/** One pine silhouette (alpha cut) for the crossed tree cards. */
registerTexture('est_pine', {
  w: 32,
  h: 64,
  wrap: false,
  posterize: false,
  draw(g, w, h, R) {
    g.clearRect(0, 0, w, h);
    const tiers = 9;
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const y = 3 + t * (h * 0.78);
      const half = 2 + t * (w * 0.46);
      for (let s = -half; s <= half; s += 1) {
        const droop = Math.abs(s) / half;
        const k = R.rr(0.7, 1.1) * (1 - droop * 0.25);
        g.fillStyle = `rgb(${(38 * k) | 0},${(56 * k) | 0},${(34 * k) | 0})`;
        g.fillRect(w / 2 + s, y + droop * 5, 1, R.rr(3, 7));
      }
    }
    // Snow on the upper boughs.
    g.fillStyle = 'rgba(232,236,240,.85)';
    for (let i = 0; i < 26; i++) {
      const t = R.rr(0, 0.8);
      g.fillRect((w / 2 + R.rr(-1, 1) * (2 + t * w * 0.4)) | 0, (3 + t * h * 0.78) | 0, 2, 1);
    }
  },
  photo: 'none',
});

/** A distant pine tree line (alpha cut) for the backdrop ring. */
registerTexture('est_pines', {
  w: 256,
  h: 64,
  wrap: false,
  posterize: false,
  draw(g, w, h, R) {
    g.clearRect(0, 0, w, h);
    for (let x = -6; x < w + 6; x += R.rr(3, 6)) {
      const top = R.rr(4, 22);
      const edge = Math.min(1, Math.min(x, w - x) / (w * 0.12));
      const t0 = h - (h - top) * Math.max(0.2, edge);
      const k = R.rr(0.75, 1.1);
      g.fillStyle = `rgb(${(34 * k) | 0},${(46 * k) | 0},${(34 * k) | 0})`;
      g.beginPath();
      g.moveTo(x, t0);
      g.lineTo(x + 5, h);
      g.lineTo(x - 5, h);
      g.closePath();
      g.fill();
    }
  },
  photo: 'none',
});

/** Snow-capped peaks (alpha cut) for the far backdrop ring. */
registerTexture('est_mountains', {
  w: 256,
  h: 64,
  wrap: false,
  posterize: false,
  draw(g, w, h, R) {
    g.clearRect(0, 0, w, h);
    const pts: [number, number][] = [];
    let y = h * 0.55;
    for (let x = 0; x <= w; x += 4) {
      const edge = Math.min(1, Math.min(x, w - x) / (w * 0.18));
      y = Math.max(3, Math.min(h - 6, y + R.rr(-6, 6)));
      pts.push([x, h - (h - y) * edge]);
    }
    const body = g.createLinearGradient(0, 0, 0, h);
    body.addColorStop(0, '#7a7a80');
    body.addColorStop(1, '#5a5e60');
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(0, h);
    for (const [x, py] of pts) g.lineTo(x, py);
    g.lineTo(w, h);
    g.closePath();
    g.fill();
    // Snow caps: the top band of each ridge.
    g.fillStyle = 'rgba(236,238,242,.92)';
    for (const [x, py] of pts) if (py < h * 0.5) g.fillRect(x - 2, py, 5, (h * 0.5 - py) * R.rr(0.4, 0.8) + 2);
    g.fillStyle = 'rgba(60,62,66,.35)';
    for (let i = 0; i < 50; i++) g.fillRect(R.rr(0, w) | 0, R.rr(h * 0.3, h) | 0, 1, R.rr(3, 10) | 0);
  },
  photo: 'none',
});
