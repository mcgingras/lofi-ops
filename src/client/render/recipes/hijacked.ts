/**
 * Texture recipes for Hijacked (`hj_*` ids, see src/shared/maps/hijacked.ts): the superyacht's teak
 * decks, white painted hull and superstructure, tinted window bands, louvred panels, the engine
 * room's machinery paint and diamond plate, the bar's bottle shelves, the sea, pool water, wake foam,
 * the "VAHN BOYAGE" hull name, the bow emblem and the two skies (sunny day, sunset over the sea).
 * Photos: Poly Haven CC0 (assets/textures), all already in the repo.
 */
import { blotch, cnv, ctx2d, dirtBottom, grain, streaks } from '../developer';
import { registerTexture } from '../textures';

/** Teak deck planks with dark caulking seams, the planks running along the ship (texture v). */
registerTexture('hj_teak', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#a87444', 0.1);
    for (let x = 0; x < w; x += 4) {
      g.fillStyle = 'rgba(30,18,10,.75)';
      g.fillRect(x, 0, 1, h);
    }
    for (let i = 0; i < 6; i++) {
      g.fillStyle = 'rgba(30,18,10,.6)';
      g.fillRect((R.rr(0, 8) | 0) * 4 + 1, R.rr(0, h) | 0, 3, 1);
    }
  },
  photos: ['brown_planks_05'],
  photo: (c) => {
    // The photo's boards run across; develop it honey-brown, then turn it a quarter so they run along v.
    const src = c.fromPhoto('brown_planks_05', { filter: 'sepia(1) saturate(1.7) hue-rotate(-6deg) brightness(.92) contrast(1.15)' });
    if (!src) return null;
    const out = cnv(src.height, src.width);
    const g = ctx2d(out);
    g.translate(out.width, 0);
    g.rotate(Math.PI / 2);
    g.drawImage(src, 0, 0);
    return out;
  },
});

/** Gloss white marine paint (hull, superstructure). Tinted per use (cream, blue stripe). */
registerTexture('hj_paint', {
  w: 16,
  h: 16,
  draw: (g, w, h, R) => grain(g, R, 0, 0, w, h, '#eeece6', 0.03),
  photos: ['painted_plaster_wall'],
  photo: (c) => c.fromPhoto('painted_plaster_wall', { filter: 'grayscale(1) brightness(1.35) contrast(.55)' }),
});

/** Cabin carpet (beige), tinted blue on the bridge. */
registerTexture('hj_carpet', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#b8a88c', 0.08);
    blotch(g, R, w, h, 5, '#9a8a70', 0.25, 2, 6);
  },
  photos: ['cotton_jersey'],
  photo: (c) => c.fromPhoto('cotton_jersey', { filter: 'sepia(.6) saturate(.6) brightness(1.05)' }),
});

/** Tinted window band: dark blue-grey glass with a sky reflection streak and mullions. */
registerTexture('hj_window', {
  w: 32,
  h: 16,
  draw(g, w, h) {
    const lg = g.createLinearGradient(0, 0, 0, h);
    lg.addColorStop(0, '#5a6e80');
    lg.addColorStop(0.5, '#2a3846');
    lg.addColorStop(1, '#1c2630');
    g.fillStyle = lg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(210,225,235,.35)';
    for (let i = 0; i < 10; i++) g.fillRect(6 + i, 12 - i, 3, 1);
    g.fillStyle = 'rgba(230,228,220,.9)';
    g.fillRect(0, 0, 1, h);
  },
  photo: 'small',
});

/** Clear railing / shower glass: pale blue-grey with sky reflections (reads light, not a dark pane). */
registerTexture('hj_glass', {
  w: 16,
  h: 16,
  draw(g, w, h) {
    const lg = g.createLinearGradient(0, 0, 0, h);
    lg.addColorStop(0, '#c8dae0');
    lg.addColorStop(1, '#8eaab4');
    g.fillStyle = lg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(245,250,252,.55)';
    for (let i = 0; i < 12; i++) g.fillRect(2 + i, 13 - i, 2, 1);
  },
  photo: 'small',
});

/** Louvred white panels (the shower block, cabana sides, vents). */
registerTexture('hj_louvre', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#e8e6e0', 0.03);
    for (let y = 1; y < h; y += 3) {
      g.fillStyle = 'rgba(70,72,74,.55)';
      g.fillRect(1, y, w - 2, 1);
      g.fillStyle = 'rgba(255,255,255,.6)';
      g.fillRect(1, y + 1, w - 2, 1);
    }
  },
  photo: 'small',
});

/** Engine room machinery paint (grey-green), scuffed. */
registerTexture('hj_machine', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#6c7a74', 0.08);
    blotch(g, R, w, h, 6, '#3c4440', 0.3, 1, 4);
  },
  photos: ['blue_metal_plate'],
  photo: (c) => c.fromPhoto('blue_metal_plate', { filter: 'hue-rotate(-40deg) saturate(.45) brightness(1.05)', over: (g, w, h) => dirtBottom(g, w, h, 0.65, 0.4) }),
});

/** Diamond plate / grating (engine room floor, the port emergency catwalk). */
registerTexture('hj_grate', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#8a8c8e', 0.06);
    g.fillStyle = 'rgba(40,42,44,.6)';
    for (let y = 0; y < h; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < w; x += 4) g.fillRect(x, y, 2, 1);
  },
  photos: ['box_profile_metal_sheet'],
  photo: (c) =>
    c.fromPhoto('box_profile_metal_sheet', {
      filter: 'grayscale(1) brightness(.95) contrast(1.1)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(30,30,32,.45)';
        for (let y = 0; y < h; y += 24) for (let x = (y / 24) % 2 ? 12 : 0; x < w; x += 24) g.fillRect(x, y, 12, 4);
      },
    }),
});

/** Bulkheads below deck: painted steel with weld seams and rust streaks. */
registerTexture('hj_bulkhead', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#b6b8b0', 0.06);
    g.fillStyle = 'rgba(60,60,58,.5)';
    g.fillRect(0, 0, w, 1);
    g.fillRect(0, 0, 1, h);
    streaks(g, R, w, 2, 5, 18, 0.2, '110,70,40');
  },
  photos: ['rusty_painted_metal'],
  photo: (c) => c.fromPhoto('rusty_painted_metal', { filter: 'saturate(.25) brightness(1.4) contrast(.7)' }),
});

/** Galley floor: small white tiles. */
registerTexture('hj_tile', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#e4e2dc', 0.03);
    g.fillStyle = 'rgba(120,120,116,.6)';
    for (let i = 0; i < w; i += 4) {
      g.fillRect(i, 0, 1, h);
      g.fillRect(0, i, w, 1);
    }
  },
  photo: 'small',
});

/** Bar shelves: rows of bottles in front of a mirror (raw UVs, one per shelf unit). */
registerTexture('hj_bottles', {
  w: 32,
  h: 32,
  wrap: false,
  draw(g, w, h, R) {
    g.fillStyle = '#4a3a2c';
    g.fillRect(0, 0, w, h);
    for (let shelf = 0; shelf < 3; shelf++) {
      const y = 3 + shelf * 10;
      g.fillStyle = '#8a7a6a';
      g.fillRect(0, y + 8, w, 1);
      for (let x = 1; x < w - 1; x += 3) {
        const c = ['#3e6a3a', '#7a4a24', '#c8b070', '#5a2a2a', '#d8d8d0', '#2a3a5a'][(R.rr(0, 6) | 0) % 6]!;
        const bh = R.rr(4, 8) | 0;
        g.fillStyle = c;
        g.fillRect(x, y + 8 - bh, 2, bh);
        g.fillRect(x, y + 8 - bh - 1, 1, 1);
      }
    }
  },
  photo: 'none',
});

/** The open sea: deep blue with wave crests and glints. */
registerTexture('hj_sea', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#1e4a66', 0.06);
    blotch(g, R, w, h, 14, '#163a54', 0.4, 3, 10);
    blotch(g, R, w, h, 10, '#2c6482', 0.35, 2, 8);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(200,225,235,${R.rr(0.12, 0.4)})`;
      g.fillRect(R.rr(0, w) | 0, R.rr(0, h) | 0, R.rr(2, 6) | 0, 1);
    }
  },
  photo: 'small',
});

/** Pool / hot tub water: bright turquoise with caustic lines. */
registerTexture('hj_pool', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#3ab8c8', 0.06);
    g.fillStyle = 'rgba(220,250,255,.45)';
    for (let i = 0; i < 9; i++) g.fillRect(R.rr(0, w) | 0, R.rr(0, h) | 0, R.rr(2, 5) | 0, 1);
  },
  photo: 'small',
});

/** Wake foam behind the stern (alpha-free: white streaks on sea blue). */
registerTexture('hj_foam', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#4a7a92', 0.06);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(240,248,250,${R.rr(0.3, 0.8)})`;
      g.fillRect(R.rr(0, w) | 0, R.rr(0, h) | 0, 1, R.rr(2, 7) | 0);
    }
  },
  photo: 'small',
});

/** "VAHN BOYAGE" in navy on white (raw UVs, the name on the hull at bow and stern). */
registerTexture('hj_name', {
  w: 128,
  h: 16,
  wrap: false,
  draw(g, w, h) {
    g.fillStyle = '#eeece6';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1c2a50';
    g.font = 'bold 12px serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('VAHN BOYAGE', w / 2, h / 2 + 1);
  },
  photo: 'none',
});

/** The emblem painted on the raised bow: a navy ring with a compass star (raw UVs). */
registerTexture('hj_emblem', {
  w: 32,
  h: 32,
  wrap: false,
  draw(g, w, h) {
    g.fillStyle = '#d8d6d0';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1c2a50';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(w / 2, h / 2, 13, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#b03028';
    g.beginPath();
    g.moveTo(16, 5);
    g.lineTo(19, 16);
    g.lineTo(16, 27);
    g.lineTo(13, 16);
    g.closePath();
    g.fill();
    g.fillStyle = '#1c2a50';
    g.beginPath();
    g.moveTo(5, 16);
    g.lineTo(16, 13);
    g.lineTo(27, 16);
    g.lineTo(16, 19);
    g.closePath();
    g.fill();
  },
  photo: 'none',
});

/** Sunny day over open water: deep blue zenith, pale hazy horizon, a few fair-weather clouds. */
registerTexture('hj_skyDay', {
  w: 256,
  h: 128,
  draw(g, _w, _h, R) {
    const lg = g.createLinearGradient(0, 0, 0, 128);
    for (const [o, c] of [[0, '#2c5e98'], [0.28, '#5a8cc0'], [0.46, '#a8c8e0'], [0.5, '#c4d8e6'], [0.53, '#9ab8cc'], [1, '#2a5470']] as const) lg.addColorStop(o, c);
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 22; i++) {
      const x = R.rr(0, 256);
      const y = R.rr(16, 56);
      const w = R.rr(14, 46);
      const hh = R.rr(3, 6);
      for (const ox of [0, -256]) {
        g.fillStyle = `rgba(252,253,255,${R.rr(0.4, 0.75)})`;
        g.fillRect(x + ox, y, w, hh);
        g.fillStyle = 'rgba(170,190,210,.35)';
        g.fillRect(x + ox + 2, y + hh, w - 4, 2);
      }
    }
  },
  photo: 'sky',
});

/** Sunset at sea: violet zenith, orange band and a low sun on the horizon. */
registerTexture('hj_skySunset', {
  w: 256,
  h: 128,
  draw(g, _w, _h, R) {
    const lg = g.createLinearGradient(0, 0, 0, 128);
    for (const [o, c] of [[0, '#2e3058'], [0.22, '#5e4a78'], [0.38, '#b0687a'], [0.47, '#f0a068'], [0.5, '#f6c488'], [0.53, '#a86a5a'], [1, '#2a2a40']] as const) lg.addColorStop(o, c);
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 128);
    const sg = g.createRadialGradient(128, 62, 2, 128, 62, 34);
    sg.addColorStop(0, 'rgba(255,240,190,1)');
    sg.addColorStop(0.18, 'rgba(255,200,130,.7)');
    sg.addColorStop(1, 'rgba(255,160,110,0)');
    g.fillStyle = sg;
    g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(${R.rnd() > 0.5 ? '250,170,120' : '120,70,110'},${R.rr(0.2, 0.45)})`;
      const x = R.rr(0, 256);
      const y = R.rr(24, 60);
      const w = R.rr(24, 80);
      g.fillRect(x, y, w, R.rr(1, 3) | 0);
      g.fillRect(x - 256, y, w, 2);
    }
    // Sun glitter on the water below the horizon.
    for (let y = 66; y < 90; y += 2) {
      g.fillStyle = `rgba(255,200,140,${0.5 - (y - 66) / 60})`;
      g.fillRect(128 - (y - 60) * 0.8, y, (y - 60) * 1.6 * R.rr(0.4, 1), 1);
    }
  },
  photo: 'sky',
});
