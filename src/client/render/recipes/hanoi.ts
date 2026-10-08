/**
 * Texture recipes for Hanoi (`hn_*` ids, see src/shared/maps/hanoi.ts): the rubble-stone prison
 * walls, clay barrel-tile roofs, cobbles and courtyard flagstones, the colonial plaster of the
 * street, shophouse fronts for the backdrop, the propaganda poster, the gate flag, the projector
 * screen and the night sky. Plaster and roof are near-neutral so the map tints them per building.
 * Photos: Poly Haven CC0 (assets/textures).
 */
import { blotch, dirtBottom, grain, stencilText, streaks } from '../developer';
import { registerTexture } from '../textures';

registerTexture('hn_stone', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#8c877c', 0.1);
    g.strokeStyle = 'rgba(40,36,30,.7)';
    for (let y = 0; y < h; y += 6) for (let x = (y / 6) % 2 ? -4 : 0; x < w; x += 8) g.strokeRect(x + 0.5, y + 0.5, 8, 6);
  },
  photos: ['stone_wall'],
  photo: (c) => c.fromPhoto('stone_wall', { filter: 'saturate(.45) brightness(.92) contrast(1.05)', over: (g, w, h) => dirtBottom(g, w, h, 0.7, 0.35) }),
});

registerTexture('hn_plaster', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#d8cfb8', 0.06);
    blotch(g, R, w, h, 8, '#a89c80', 0.3, 2, 7);
    streaks(g, R, w, 0, 6, 20, 0.2, '80,70,50');
  },
  photos: ['painted_plaster_wall'],
  photo: (c) =>
    c.fromPhoto('painted_plaster_wall', {
      filter: 'grayscale(.6) brightness(1.15) contrast(.9)',
      over: (g, w, h) => {
        dirtBottom(g, w, h, 0.65, 0.45);
        g.fillStyle = 'rgba(60,50,36,.18)';
        for (let i = 0; i < 6; i++) g.fillRect((i * 97) % w, 0, 6, h * 0.5);
      },
    }),
});

registerTexture('hn_roof', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#8a5a40', 0.1);
    g.fillStyle = 'rgba(40,20,12,.6)';
    for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h);
    for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 1);
  },
  photos: ['clay_roof_tiles'],
  photo: (c) => c.fromPhoto('clay_roof_tiles', { filter: 'saturate(.55) brightness(1.05)' }),
});

registerTexture('hn_cobble', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#6e6a64', 0.12);
    g.fillStyle = 'rgba(30,28,26,.6)';
    for (let y = 0; y < h; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < w; x += 4) g.fillRect(x, y, 1, 1);
  },
  photos: ['cobblestone_floor_04'],
  photo: (c) => c.fromPhoto('cobblestone_floor_04', { filter: 'saturate(.35) brightness(.9)' }),
});

registerTexture('hn_flags', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#9a968c', 0.08);
    g.fillStyle = 'rgba(40,38,34,.6)';
    for (let i = 0; i < w; i += 8) {
      g.fillRect(i, 0, 1, h);
      g.fillRect(0, i, w, 1);
    }
  },
  photos: ['stone_tiles'],
  photo: (c) => c.fromPhoto('stone_tiles', { filter: 'saturate(.3) brightness(.95)' }),
});

/** A shophouse bay, 4 m wide x 8 m tall (uv raw): shop front with shutters, two floors of French windows, balcony rails. */
registerTexture('hn_facade', {
  w: 64,
  h: 128,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#c8b890', 0.06);
    dirtBottom(g, w, h, 0.75, 0.5);
    // Cornice and floor bands.
    g.fillStyle = 'rgba(70,58,40,.65)';
    for (const y of [4, 46, 86]) g.fillRect(0, y, w, 3);
    // Shop front: rolled shutter with slats, a lit gap under it.
    g.fillStyle = '#4a4e4a';
    g.fillRect(8, 92, 48, 34);
    g.fillStyle = 'rgba(20,20,18,.7)';
    for (let y = 94; y < 120; y += 3) g.fillRect(8, y, 48, 1);
    g.fillStyle = '#e0a050';
    g.fillRect(8, 122, 48, 3);
    // Upper floors: tall shuttered windows (green shutters), the middle one open and lit.
    for (const y of [12, 52]) {
      for (const [x, lit] of [[6, false], [26, true], [46, false]] as const) {
        g.fillStyle = lit ? '#d89848' : '#2c2a26';
        g.fillRect(x, y, 12, 26);
        g.fillStyle = '#3e6a52';
        g.fillRect(x - 4, y, 4, 26);
        g.fillRect(x + 12, y, 4, 26);
        g.fillStyle = 'rgba(15,20,15,.6)';
        for (let yy = y + 2; yy < y + 26; yy += 3) {
          g.fillRect(x - 4, yy, 4, 1);
          g.fillRect(x + 12, yy, 4, 1);
        }
      }
      // Balcony rail.
      g.fillStyle = '#1e1c1a';
      g.fillRect(2, y + 26, w - 4, 2);
      for (let x = 3; x < w - 2; x += 3) g.fillRect(x, y + 28, 1, 6);
      g.fillRect(2, y + 34, w - 4, 1);
    }
  },
  photo: 'auto',
});

/** Window with green shutters and iron bars (uv raw), for wall decals. */
registerTexture('hn_window', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#24221e', 0.05);
    g.fillStyle = '#d0904a';
    g.fillRect(8, 4, 16, 24);
    g.fillStyle = 'rgba(40,20,8,.5)';
    g.fillRect(8, 16, 16, 12);
    g.fillStyle = '#3e6a52';
    g.fillRect(0, 2, 8, 28);
    g.fillRect(24, 2, 8, 28);
    g.fillStyle = 'rgba(15,22,15,.65)';
    for (let y = 4; y < 30; y += 3) {
      g.fillRect(0, y, 8, 1);
      g.fillRect(24, y, 8, 1);
    }
    g.fillStyle = '#141210';
    for (let x = 10; x < 24; x += 4) g.fillRect(x, 4, 1, 24);
  },
  photo: 'auto',
});

/** Barred cell-window slot in the stone (uv raw). */
registerTexture('hn_bars', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#0c0c0e', 0.03);
    g.fillStyle = '#5a5650';
    for (let x = 2; x < w; x += 4) g.fillRect(x, 0, 1, h);
    g.fillRect(0, 7, w, 1);
  },
  photo: 'small',
});

/** Heavy plank door with iron straps (uv raw). */
registerTexture('hn_door', {
  w: 16,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#5a4028', 0.1);
    g.fillStyle = 'rgba(25,15,8,.7)';
    for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h);
    g.fillStyle = '#26221e';
    for (const y of [5, 16, 27]) g.fillRect(0, y, w, 2);
  },
  photos: ['brown_planks_05'],
  photo: (c) =>
    c.fromPhoto('brown_planks_05', {
      w: 128,
      h: 256,
      tile: 256,
      filter: 'sepia(.4) brightness(.7)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(30,26,22,.9)';
        for (const y of [0.16, 0.5, 0.84]) g.fillRect(0, h * y, w, h * 0.05);
      },
    }),
});

/** Propaganda poster: red field, yellow star, a worker and a slogan block (uv raw). */
registerTexture('hn_poster', {
  w: 32,
  h: 48,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#b02a20', 0.06);
    g.fillStyle = '#f0c840';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 4 : 9;
      g.lineTo(16 + Math.cos(a) * r, 13 + Math.sin(a) * r);
    }
    g.fill();
    g.fillStyle = '#2a1a14';
    g.fillRect(9, 26, 14, 3);
    g.fillRect(13, 22, 6, 12);
    g.fillStyle = '#f0e2c0';
    g.fillRect(4, 38, 24, 6);
    g.fillStyle = 'rgba(60,20,10,.8)';
    for (let x = 6; x < 26; x += 3) g.fillRect(x, 40, 2, 2);
  },
  photo: 'auto',
});

/** The gate flag: red over blue with the yellow star (uv raw). */
registerTexture('hn_flag', {
  w: 48,
  h: 32,
  draw(g, w, h) {
    g.fillStyle = '#c42a22';
    g.fillRect(0, 0, w, h / 2);
    g.fillStyle = '#2a50a0';
    g.fillRect(0, h / 2, w, h / 2);
    g.fillStyle = '#f2d040';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 4 : 10;
      g.lineTo(24 + Math.cos(a) * r, 16 + Math.sin(a) * r);
    }
    g.fill();
  },
  photo: 'none',
});

/** The re-education room's projector screen: a film countdown leader (uv raw). */
registerTexture('hn_screen', {
  w: 64,
  h: 48,
  draw(g, w, h) {
    g.fillStyle = '#d8d4c4';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3a3830';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(32, 24, 17, 0, 7);
    g.stroke();
    g.beginPath();
    g.arc(32, 24, 13, 0, 7);
    g.stroke();
    g.fillStyle = '#3a3830';
    g.fillRect(0, 23, w, 2);
    g.fillRect(31, 0, 2, h);
    g.font = 'bold 20px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('3', 32, 25);
  },
  photo: 'none',
});

/** Stencilled sign over the theatre door ("RE-EDUCATION"), uv raw. */
registerTexture('hn_sign', {
  w: 64,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#d8ccb0', 0.05);
    stencilText(g, ['RE-EDUCATION'], w / 2, h / 2 + 1, [9], 'rgba(150,30,20,.95)');
  },
  photo: 'none',
});

/** Overcast night: dark blue-grey cloud deck, a moon glow behind it, a sodium haze on the horizon. */
registerTexture('hn_skyNight', {
  w: 256,
  h: 128,
  draw(g, _w, _h, R) {
    const lg = g.createLinearGradient(0, 0, 0, 128);
    for (const [o, c] of [[0, '#070a14'], [0.3, '#121a2c'], [0.44, '#24304a'], [0.5, '#3a3c4c'], [0.53, '#2a2c38'], [1, '#14161e']] as const) lg.addColorStop(o, c);
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 128);
    const rg = g.createRadialGradient(70, 26, 2, 70, 26, 34);
    rg.addColorStop(0, 'rgba(220,228,255,.9)');
    rg.addColorStop(0.18, 'rgba(160,180,220,.45)');
    rg.addColorStop(1, 'rgba(60,70,100,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 256, 80);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${R.rr(30, 60) | 0},${R.rr(38, 70) | 0},${R.rr(60, 96) | 0},${R.rr(0.4, 0.8)})`;
      const x = R.rr(0, 256);
      const y = R.rr(8, 60);
      const ww = R.rr(30, 90);
      g.fillRect(x, y, ww, R.rr(2, 5) | 0);
      g.fillRect(x - 256, y, ww, 3);
    }
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(220,225,255,${R.rr(0.2, 0.6)})`;
      g.fillRect(R.rr(0, 256) | 0, R.rr(0, 40) | 0, 1, 1);
    }
  },
  photo: 'sky',
});
