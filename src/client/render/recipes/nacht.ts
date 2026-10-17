/**
 * Texture recipes for Nacht der Untoten (`nd_*` ids, see src/shared/maps/nacht.ts): the cast
 * concrete of the bunker (board-formed walls, stained ceilings), the dark square floor tiles, the
 * cratered mud of the airfield, rubble, scorched timber, the chalk writing on the walls, a bare
 * dead tree line for the backdrop and the cold night sky with its pale blue moon.
 * Photos: Poly Haven CC0 (assets/textures).
 */
import { blotch, dirtBottom, grain, streaks } from '../developer';
import { registerTexture } from '../textures';

registerTexture('nd_concrete', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#8a8a86', 0.1);
    g.fillStyle = 'rgba(40,40,40,.25)';
    // Board-formed concrete: the shuttering's plank lines.
    for (let y = 0; y < h; y += 5) g.fillRect(0, y, w, 1);
    blotch(g, R, w, h, 6, '#5a5a58', 0.3, 2, 6);
    streaks(g, R, w, 0, 5, 18, 0.25, '40,40,36');
  },
  photos: ['concrete_block_wall_02'],
  photo: (c) => c.fromPhoto('concrete_block_wall_02', { filter: 'grayscale(.75) brightness(1.05) contrast(1.05)', over: (g, w, h) => dirtBottom(g, w, h, 0.6, 0.5) }),
});

registerTexture('nd_ceiling', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#6e6c66', 0.14);
    blotch(g, R, w, h, 10, '#3e3c38', 0.35, 2, 8);
  },
  photos: ['concrete'],
  photo: (c) => c.fromPhoto('concrete', { filter: 'grayscale(.7) brightness(.85) contrast(1.1)' }),
});

registerTexture('nd_floor', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#4c4a46', 0.1);
    g.fillStyle = 'rgba(20,20,18,.7)';
    for (let i = 0; i < w; i += 8) {
      g.fillRect(i, 0, 1, h);
      g.fillRect(0, i, w, 1);
    }
    blotch(g, R, w, h, 5, '#2c2a26', 0.3, 2, 5);
  },
  photos: ['stone_tiles'],
  photo: (c) => c.fromPhoto('stone_tiles', { filter: 'grayscale(.7) brightness(.75) contrast(1.1)' }),
});

registerTexture('nd_mud', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#4a4640', 0.16);
    blotch(g, R, w, h, 12, '#6a665e', 0.3, 2, 6);
    blotch(g, R, w, h, 8, '#2a2824', 0.35, 1, 4);
  },
  photos: ['forest_ground_04'],
  photo: (c) => c.fromPhoto('forest_ground_04', { filter: 'grayscale(.65) brightness(.75) contrast(1.05)' }),
});

registerTexture('nd_rubble', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#6a6862', 0.2);
    for (let i = 0; i < 26; i++) {
      g.fillStyle = R.rnd() < 0.5 ? '#8a8880' : '#3a3834';
      g.fillRect(Math.floor(R.rnd() * w), Math.floor(R.rnd() * h), 2 + Math.floor(R.rnd() * 3), 1 + Math.floor(R.rnd() * 2));
    }
  },
  photos: ['dry_ground_rocks'],
  photo: (c) => c.fromPhoto('dry_ground_rocks', { filter: 'grayscale(.8) brightness(.8) contrast(1.1)' }),
});

registerTexture('nd_timber', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#5a4430', 0.14);
    g.fillStyle = 'rgba(20,12,6,.6)';
    for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 1, h);
  },
  photos: ['weathered_plank_siding'],
  photo: (c) => c.fromPhoto('weathered_plank_siding', { filter: 'saturate(.5) brightness(.75) contrast(1.1)' }),
});

/** The chalk writing in the start room ("you must ascend from darkness") and the Help room. */
for (const [id, lines] of [
  ['nd_writingAscend', ['YOU MUST', 'ASCEND', 'FROM', 'DARKNESS']],
  ['nd_writingSalvation', ['SALVATION', 'IS HERE']],
] as const) {
  registerTexture(id, {
    w: 128,
    h: 64,
    wrap: false,
    posterize: false,
    photo: 'none',
    draw(g, w, h, R) {
      g.clearRect(0, 0, w, h);
      g.font = 'bold 13px serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      lines.forEach((line, i) => {
        const y = (h / (lines.length + 1)) * (i + 1);
        for (let k = 0; k < 3; k++) {
          g.fillStyle = `rgba(236,232,222,${0.35 + R.rnd() * 0.3})`;
          g.fillText(line, w / 2 + (R.rnd() - 0.5) * 1.5 + (i % 2 ? 6 : -4), y + (R.rnd() - 0.5) * 1.2);
        }
      });
    },
  });
}

/** Bare winter trees on the horizon (alpha cut), for the backdrop ring. */
registerTexture('nd_treeline', {
  w: 256,
  h: 64,
  wrap: false,
  posterize: false,
  photo: 'none',
  draw(g, w, h, R) {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgb(18,22,30)';
    g.fillStyle = 'rgb(18,22,30)';
    g.fillRect(0, h - 6, w, 6);
    const branch = (x: number, y: number, a: number, len: number, wd: number, depth: number) => {
      const x1 = x + Math.sin(a) * len;
      const y1 = y - Math.cos(a) * len;
      g.lineWidth = wd;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x1, y1);
      g.stroke();
      if (depth <= 0) return;
      branch(x1, y1, a - R.rr(0.3, 0.7), len * R.rr(0.55, 0.75), Math.max(0.5, wd * 0.6), depth - 1);
      branch(x1, y1, a + R.rr(0.3, 0.7), len * R.rr(0.55, 0.75), Math.max(0.5, wd * 0.6), depth - 1);
    };
    for (let x = 4; x < w - 4; x += R.rr(10, 26)) branch(x, h - 4, R.rr(-0.15, 0.15), R.rr(14, 28), R.rr(1.5, 3), 3);
  },
});

registerTexture('nd_skyNight', {
  w: 256,
  h: 128,
  draw(g, _w, _h, R) {
    const lg = g.createLinearGradient(0, 0, 0, 128);
    for (const [o, c] of [[0, '#05080f'], [0.28, '#0e1626'], [0.44, '#1e2c44'], [0.5, '#34405a'], [0.54, '#20283a'], [1, '#0c0e14']] as const) lg.addColorStop(o, c);
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 128);
    // The cold, pale blue moon behind thin cloud.
    const rg = g.createRadialGradient(176, 30, 2, 176, 30, 40);
    rg.addColorStop(0, 'rgba(226,236,255,.95)');
    rg.addColorStop(0.12, 'rgba(176,200,240,.6)');
    rg.addColorStop(0.4, 'rgba(90,112,160,.25)');
    rg.addColorStop(1, 'rgba(40,52,80,0)');
    g.fillStyle = rg;
    g.fillRect(100, 0, 156, 90);
    for (let i = 0; i < 46; i++) {
      g.fillStyle = `rgba(${R.rr(24, 50) | 0},${R.rr(32, 60) | 0},${R.rr(56, 90) | 0},${R.rr(0.4, 0.8)})`;
      const x = R.rr(0, 256);
      const y = R.rr(6, 62);
      const ww = R.rr(30, 100);
      g.fillRect(x, y, ww, R.rr(2, 6) | 0);
      g.fillRect(x - 256, y, ww, 3);
    }
    for (let i = 0; i < 50; i++) {
      g.fillStyle = `rgba(220,228,255,${R.rr(0.2, 0.6)})`;
      g.fillRect(R.rr(0, 256) | 0, R.rr(0, 40) | 0, 1, 1);
    }
  },
  photo: 'sky',
});
