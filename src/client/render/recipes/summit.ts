/**
 * Texture recipes for Summit (Black Ops 1's snowy Ural mountaintop base): `sm_*` ids. Snow and
 * pavement are Poly Haven CC0 photos (snow_02, snow_04, asphalt_snow); the rest reuse the shared
 * photos. Owner: the summit map.
 */
import { blotch, grain, stencilText } from '../developer';
import { registerTexture } from '../textures';

/** Clean, wind-packed snow (open ground, roofs). */
registerTexture('sm_snow', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#e4e8ee', 0.04);
    blotch(g, R, w, h, 10, '#c4ccd8', 0.35, 2, 8);
  },
  photos: ['snow_02'],
  photo: (c) => c.fromPhoto('snow_02', { filter: 'saturate(.6) brightness(1.08)' }),
});

/** Trampled snow with grit (paths, the spawn yards, vehicle tracks). */
registerTexture('sm_snowDirty', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#c8ccd0', 0.06);
    blotch(g, R, w, h, 14, '#8a8a86', 0.35, 1, 5);
  },
  photos: ['snow_04'],
  photo: (c) => c.fromPhoto('snow_04', { filter: 'saturate(.55) brightness(1.04)' }),
});

/** Concrete pavement under a dusting of snow (plazas, the courtyard). */
registerTexture('sm_pave', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#a8aeb4', 0.06);
    blotch(g, R, w, h, 12, '#dfe4ea', 0.5, 2, 7);
  },
  photos: ['asphalt_snow'],
  photo: (c) => c.fromPhoto('asphalt_snow', { filter: 'saturate(.5) brightness(1.1)' }),
});

/** Grey granite with snow caught in the cracks (outcrops, cliff faces). */
registerTexture('sm_rock', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#6e747c', 0.1);
    blotch(g, R, w, h, 16, '#4a4e56', 0.5, 3, 12);
    blotch(g, R, w, h, 14, '#e6eaf0', 0.6, 2, 7);
  },
  photos: ['aerial_rocks_02'],
  photo: (c) =>
    c.fromPhoto('aerial_rocks_02', {
      filter: 'grayscale(.85) brightness(.95) contrast(1.15)',
      over: (g, w, h) => {
        // Snow lodged on ledges: soft white blotches, heavier towards the top of the tile.
        for (let i = 0; i < 90; i++) {
          const y = c.rr(0, h);
          g.fillStyle = `rgba(236,240,246,${(0.25 + 0.5 * (1 - y / h)) * c.rr(0.4, 1)})`;
          g.beginPath();
          g.ellipse(c.rr(0, w), y, c.rr(6, 26), c.rr(3, 9), c.rr(-0.4, 0.4), 0, 7);
          g.fill();
        }
      },
    }),
});

/** Steel floor grating (catwalks, the Bridge, the Tower platform). */
registerTexture('sm_grate', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#2a2e34', 0.08);
    g.fillStyle = '#8a929a';
    for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h);
    for (let y = 0; y < h; y += 8) g.fillRect(0, y, w, 1);
  },
  photos: ['blue_metal_plate'],
  photo: (c) =>
    c.fromPhoto('blue_metal_plate', {
      w: 256,
      h: 256,
      tile: 256,
      filter: 'grayscale(1) brightness(.35)',
      over: (g, w, h) => {
        // Bearing bars one way, cross rods the other, with snow packed in the corners.
        g.fillStyle = 'rgba(176,184,192,.95)';
        for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 4, h);
        g.fillStyle = 'rgba(150,158,166,.9)';
        for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 3);
        for (let i = 0; i < 40; i++) {
          g.fillStyle = 'rgba(232,236,242,.55)';
          g.fillRect((c.rr(0, 16) | 0) * 16 + 4, c.rr(0, h), 12, c.rr(3, 12));
        }
      },
    }),
});

/** Grey steel railing (alpha cut: posts, top rail, mid rail, toe board). */
registerTexture('sm_rail', {
  w: 32,
  h: 32,
  posterize: false,
  draw(g, w, h) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#8c949c';
    g.fillRect(0, 0, 3, h);
    g.fillRect(0, 0, w, 3);
    g.fillRect(0, 15, w, 2);
    g.fillStyle = '#5c646c';
    g.fillRect(0, h - 4, w, 4);
    g.fillStyle = '#c4ccd4';
    g.fillRect(1, 0, 1, h);
    g.fillRect(0, 1, w, 1);
  },
  photo: 'none',
});

/** Soviet control desk: grey-green steel with dials, switches and lamps. */
registerTexture('sm_console', {
  w: 64,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#6e7a72', 0.06);
    for (let i = 0; i < 6; i++) {
      const x = 3 + i * 10;
      g.fillStyle = '#1c2220';
      g.fillRect(x, 4, 8, 8);
      g.fillStyle = '#d8d4c0';
      g.beginPath();
      g.arc(x + 4, 8, 3, 0, 7);
      g.fill();
      g.fillStyle = '#202020';
      g.fillRect(x + 4, 6, 1, 3);
      for (let j = 0; j < 4; j++) {
        g.fillStyle = R.rnd() > 0.6 ? '#d04030' : R.rnd() > 0.5 ? '#e0c040' : '#40a050';
        g.fillRect(x + j * 2, 16, 1, 2);
      }
      g.fillStyle = '#3a423e';
      g.fillRect(x, 21, 8, 6);
    }
    g.fillStyle = 'rgba(20,24,22,.6)';
    g.fillRect(0, h - 3, w, 3);
  },
  photos: ['blue_metal_plate'],
  photo: (c) =>
    c.fromPhoto('blue_metal_plate', {
      w: 512,
      h: 256,
      tile: 256,
      filter: 'hue-rotate(-60deg) saturate(.35) brightness(.85)',
      over: (g, w, h) => {
        g.globalAlpha = 0.9;
        g.imageSmoothingEnabled = false;
        g.drawImage(c.base, 0, 0, w, h);
        g.globalAlpha = 1;
      },
    }),
});

/** The control room's wall screens: green tactical maps of the region. */
registerTexture('sm_screens', {
  w: 64,
  h: 32,
  wrap: false,
  draw(g, w, h, R) {
    g.fillStyle = '#1a1e1c';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      const x = 2 + i * 15.5;
      g.fillStyle = '#0e2a1a';
      g.fillRect(x, 3, 14, 18);
      g.strokeStyle = '#3cc070';
      g.lineWidth = 1;
      g.beginPath();
      for (let k = 0; k < 8; k++) g.lineTo(x + 1 + R.rr(0, 12), 5 + R.rr(0, 14));
      g.stroke();
      g.fillStyle = '#ff5040';
      for (let k = 0; k < 3; k++) g.fillRect(x + 2 + R.rr(0, 10), 6 + R.rr(0, 12), 1, 1);
      g.fillStyle = '#4a5450';
      g.fillRect(x, 23, 14, 6);
    }
  },
  photo: 'small',
});

/** Big steel-framed windows (control room, gallery): dark glass, frames, a few broken panes. */
registerTexture('sm_window', {
  w: 32,
  h: 32,
  posterize: false,
  draw(g, w, h, R) {
    g.fillStyle = 'rgba(60,74,86,.85)';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(190,206,220,.5)';
    for (let i = 0; i < 12; i++) g.fillRect(i * 2, 30 - i * 2, 3, 1);
    if (R.rnd() > 0.3) {
      // A broken pane: transparent hole with jagged edges.
      g.clearRect(4, 4, 11, 12);
      g.fillStyle = 'rgba(200,214,226,.7)';
      g.fillRect(4, 4, 2, 3);
      g.fillRect(12, 13, 3, 3);
    }
    g.fillStyle = '#4a5058';
    g.fillRect(0, 0, w, 2);
    g.fillRect(0, h - 2, w, 2);
    g.fillRect(0, 0, 2, h);
    g.fillRect(w - 2, 0, 2, h);
    g.fillRect(15, 0, 2, h);
  },
  photo: 'none',
});

/** Filing cabinets (under the control room mezzanine). */
registerTexture('sm_cabinet', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#8a8e90', 0.06);
    g.fillStyle = '#4a4e52';
    for (let y = 0; y < h; y += 8) g.fillRect(0, y, w, 1);
    g.fillRect(15, 0, 2, h);
    g.fillStyle = '#c8ccd0';
    for (let y = 3; y < h; y += 8) {
      g.fillRect(6, y, 4, 1);
      g.fillRect(22, y, 4, 1);
    }
  },
  photo: 'small',
});

/** Cyrillic warning sign ("No entry for unauthorised persons"; danger, cliff). */
registerTexture('sm_sign', {
  w: 64,
  h: 40,
  wrap: false,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#e8e2d4', 0.05);
    g.strokeStyle = '#b02a20';
    g.lineWidth = 2;
    g.strokeRect(2, 2, w - 4, h - 4);
    stencilText(g, ['ОПАСНО', 'ОБРЫВ'], 8, 17, [11, 11], '#b02a20');
    g.fillStyle = '#b02a20';
    g.fillRect(6, h - 10, w - 12, 5);
  },
  photo: 'small',
});

/** Red/white lattice mast panel (alpha cut), for the antenna mast and cable car pylons. */
registerTexture('sm_lattice', {
  w: 32,
  h: 64,
  posterize: false,
  draw(g, w, h) {
    g.clearRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      g.fillStyle = Math.floor(y / 16) % 2 ? '#d8d4cc' : '#a83a2c';
      g.fillRect(0, y, 3, 16);
      g.fillRect(w - 3, y, 3, 16);
      g.fillRect(0, y, w, 2);
      g.save();
      g.beginPath();
      g.rect(0, y, w, 16);
      g.clip();
      g.lineWidth = 2;
      g.strokeStyle = g.fillStyle;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y + 16);
      g.moveTo(w, y);
      g.lineTo(0, y + 16);
      g.stroke();
      g.restore();
    }
  },
  photo: 'none',
});

/** Grey steel lattice (alpha cut) for the cable car and power pylons. */
registerTexture('sm_latticeGrey', {
  w: 32,
  h: 64,
  posterize: false,
  draw(g, w, h) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#5a6068';
    g.strokeStyle = '#5a6068';
    g.lineWidth = 2;
    g.fillRect(0, 0, 3, h);
    g.fillRect(w - 3, 0, 3, h);
    for (let y = 0; y < h; y += 16) {
      g.fillRect(0, y, w, 2);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y + 16);
      g.moveTo(w, y);
      g.lineTo(0, y + 16);
      g.stroke();
    }
  },
  photo: 'none',
});

/** Snow-laden spruce (alpha card, crossed in pairs). */
registerTexture('sm_pine', {
  w: 64,
  h: 128,
  wrap: false,
  posterize: false,
  draw(g, w, h, R) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#3a2a1e';
    g.fillRect(w / 2 - 2, h - 16, 4, 16);
    // Tiers of drooping branches, each with snow on its upper edge.
    for (let i = 0; i < 9; i++) {
      const y = 8 + i * 12.5;
      const half = 4 + i * 3.4;
      g.fillStyle = i % 2 ? '#24382c' : '#2c4234';
      g.beginPath();
      g.moveTo(w / 2, y - 6);
      g.lineTo(w / 2 + half, y + 10);
      g.lineTo(w / 2 - half, y + 10);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(232,238,244,.95)';
      for (let k = 0; k < half; k += 2) {
        const s = R.rr(-1, 1);
        g.fillRect(w / 2 - half + k * 2 + s, y + 6 - (k < half / 2 ? k : half - k) * 0.4, 3, 2);
      }
    }
  },
  photo: 'none',
});

/** Snow-capped peaks for the backdrop ring (alpha cut silhouettes). */
registerTexture('sm_mountains', {
  w: 256,
  h: 64,
  wrap: false,
  posterize: false,
  draw(g, w, h, R) {
    g.clearRect(0, 0, w, h);
    // A few broad peaks (triangles with jagged flanks), tapering to the card edges.
    const peaks = Array.from({ length: 4 }, () => ({ x: R.rr(w * 0.15, w * 0.85), top: R.rr(h * 0.08, h * 0.45), slope: R.rr(0.35, 0.7) }));
    const ridge: number[] = [];
    let jag = 0;
    for (let x = 0; x <= w; x += 4) {
      const edge = Math.min(1, Math.min(x, w - x) / (w * 0.2));
      jag = Math.max(-4, Math.min(4, jag + R.rr(-1.6, 1.6)));
      const y = Math.min(h * 0.8, ...peaks.map((p) => p.top + Math.abs(x - p.x) * p.slope)) + jag;
      ridge.push(h - (h - y) * edge);
    }
    const lg = g.createLinearGradient(0, 0, 0, h);
    lg.addColorStop(0, '#f2f4f8');
    lg.addColorStop(0.45, '#c6ccd6');
    lg.addColorStop(1, '#6e7682');
    g.fillStyle = lg;
    g.beginPath();
    g.moveTo(0, h);
    ridge.forEach((ry, i) => g.lineTo(i * 4, ry));
    g.lineTo(w, h);
    g.closePath();
    g.fill();
    // Dark rock streaks down the faces below the snowline.
    g.fillStyle = 'rgba(60,66,76,.45)';
    for (let i = 0; i < 70; i++) {
      const x = R.rr(0, w);
      const top = ridge[Math.min(ridge.length - 1, Math.round(x / 4))]! + R.rr(6, 18);
      g.fillRect(x | 0, top | 0, R.rr(1, 3) | 0, R.rr(4, 20) | 0);
    }
  },
  photos: ['snow_02'],
  photo: (c) =>
    c.fromPhoto('snow_02', {
      w: 512,
      h: 128,
      tile: 128,
      filter: 'saturate(.4) brightness(1.1)',
      over: (g, w, h) => {
        g.globalCompositeOperation = 'multiply';
        g.drawImage(c.base, 0, 0, w, h);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(c.base, 0, 0, w, h);
        g.globalCompositeOperation = 'source-over';
      },
    }),
});

// ----- skies (dome textures; the horizon sits at the middle) -----

/** Clear, cold high-altitude day: deep blue overhead, a pale sea of cloud at the horizon. */
registerTexture('sm_skyDay', {
  w: 256,
  h: 128,
  draw(g, _w, _h, R) {
    const lg = g.createLinearGradient(0, 0, 0, 128);
    for (const [o, c] of [[0, '#3c6894'], [0.3, '#7ea2c4'], [0.46, '#cdd9e4'], [0.5, '#e8eef4'], [0.54, '#d6dee6'], [1, '#aab6c2']] as const) lg.addColorStop(o, c);
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 128);
    // The cloud sea below the summit, and thin high cirrus.
    for (let i = 0; i < 46; i++) {
      const x = R.rr(0, 256);
      const y = R.rr(60, 76);
      for (const ox of [0, -256]) {
        g.fillStyle = `rgba(244,246,250,${R.rr(0.3, 0.7)})`;
        g.fillRect(x + ox, y, R.rr(20, 70), R.rr(2, 6));
      }
    }
    for (let i = 0; i < 18; i++) {
      const x = R.rr(0, 256);
      const y = R.rr(14, 46);
      for (const ox of [0, -256]) {
        g.fillStyle = `rgba(236,242,248,${R.rr(0.12, 0.3)})`;
        g.fillRect(x + ox, y, R.rr(30, 80), 1);
      }
    }
  },
  photo: 'sky',
});

/** Snow-overcast dusk: low slate cloud, a faint violet glow where the sun went down. */
registerTexture('sm_skyDusk', {
  w: 256,
  h: 128,
  draw(g, _w, _h, R) {
    const lg = g.createLinearGradient(0, 0, 0, 128);
    for (const [o, c] of [[0, '#2a2e3c'], [0.3, '#4a5062'], [0.45, '#7a7c8c'], [0.5, '#9a96a2'], [0.54, '#86889a'], [1, '#5a5e6e']] as const) lg.addColorStop(o, c);
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 128);
    const rg = g.createRadialGradient(70, 62, 0, 70, 62, 46);
    rg.addColorStop(0, 'rgba(214,170,170,.55)');
    rg.addColorStop(1, 'rgba(214,170,170,0)');
    g.fillStyle = rg;
    g.fillRect(0, 16, 160, 90);
    for (let i = 0; i < 50; i++) {
      const x = R.rr(0, 256);
      const y = R.rr(8, 62);
      for (const ox of [0, -256]) {
        g.fillStyle = `rgba(${R.rnd() > 0.5 ? '150,152,166' : '44,48,60'},${R.rr(0.2, 0.45)})`;
        g.fillRect(x + ox, y, R.rr(30, 90), R.rr(2, 7));
      }
    }
  },
  photo: 'sky',
});
