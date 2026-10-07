/**
 * Texture recipes for Terminal (maps-mw2): concrete facade, polished floor tiles, interior wall
 * panels, bookshelves, shop counters and signs, the parked airliner's livery, the jet bridge, blast
 * fence, fuel truck and a clear sky. Photo looks develop the CC0 Poly Haven photos in
 * assets/textures. Ids are prefixed `term_`; Terminal also reuses some `scrap_` and core ids.
 */
import { blotch, dirtBottom, drips, grain, stencilText, streaks, type Rand } from '../developer';
import { registerTexture } from '../textures';

registerTexture('term_facade', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#b4b0a8', 0.05);
    g.fillStyle = 'rgba(60,58,54,.4)';
    g.fillRect(0, 0, w, 1);
    g.fillRect(0, 0, 1, h);
    streaks(g, R, w, 0, 8, 24, 0.25, '70,66,60');
  },
  photos: ['concrete'],
  photo: (c) =>
    c.fromPhoto('concrete', {
      filter: 'saturate(.3) brightness(1.15)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(70,68,64,.55)';
        g.fillRect(0, 0, w, 3);
        g.fillRect(0, 0, 3, h);
        dirtBottom(g, w, h, 0.8, 0.35);
      },
    }),
});

/** Concrete apron slabs, 5 x 5 m per tile, joints and oil stains. */
registerTexture('term_apron', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#8e8c86', 0.07);
    blotch(g, R, w, h, 6, '#4a4844', 0.35, 2, 8);
    g.fillStyle = 'rgba(40,40,40,.6)';
    g.fillRect(0, 0, w, 1);
    g.fillRect(0, 0, 1, h);
  },
  photos: ['concrete_floor_worn_001'],
  photo: (c) =>
    c.fromPhoto('concrete_floor_worn_001', {
      filter: 'saturate(.15) brightness(.95) contrast(1.05)',
      over: (g, w, h) => {
        g.filter = 'blur(8px)';
        for (let i = 0; i < 5; i++) {
          g.fillStyle = `rgba(20,20,22,${c.rr(0.15, 0.35)})`;
          g.beginPath();
          g.ellipse(c.rr(0, w), c.rr(0, h), c.rr(20, 60), c.rr(14, 40), 0, 0, 7);
          g.fill();
        }
        g.filter = 'none';
        g.fillStyle = 'rgba(30,30,30,.75)';
        g.fillRect(0, 0, w, 4);
        g.fillRect(0, 0, 4, h);
      },
    }),
});

registerTexture('term_floor', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#c8c2b6', 0.04);
    g.fillStyle = '#8a8478';
    g.fillRect(0, 0, w, 1);
    g.fillRect(0, 0, 1, h);
    g.fillRect(16, 0, 1, h);
    g.fillRect(0, 16, w, 1);
  },
  photos: ['concrete_floor_worn_001'],
  photo: (c) =>
    c.fromPhoto('concrete_floor_worn_001', {
      filter: 'saturate(.2) brightness(1.45) contrast(.7)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(90,86,78,.7)';
        for (let i = 0; i < 2; i++) {
          g.fillRect((i * w) / 2, 0, 3, h);
          g.fillRect(0, (i * h) / 2, w, 3);
        }
        g.fillStyle = 'rgba(255,255,250,.12)';
        g.fillRect(w * 0.1, h * 0.1, w * 0.3, h * 0.05);
      },
    }),
});

registerTexture('term_wall', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#d8d4cc', 0.04);
    g.fillStyle = 'rgba(100,96,90,.35)';
    g.fillRect(0, 0, 1, h);
    g.fillRect(0, 24, w, 1);
  },
  photos: ['concrete'],
  photo: (c) =>
    c.fromPhoto('concrete', {
      filter: 'saturate(.1) brightness(1.5) contrast(.6)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(110,106,100,.5)';
        g.fillRect(0, 0, 4, h);
        g.fillRect(0, h * 0.78, w, 4);
        g.fillStyle = 'rgba(120,110,96,.35)';
        g.fillRect(0, h * 0.8, w, h * 0.2);
      },
    }),
});

const BOOK_COLS = ['#8a2a22', '#2a4a7a', '#c9a02f', '#2e5a3a', '#d8d0c0', '#5a2a5a', '#1a1a1a', '#b85a2a'];

function shelves(g: CanvasRenderingContext2D, R: Rand, w: number, h: number, rows: number) {
  g.fillStyle = '#5a3a22';
  g.fillRect(0, 0, w, h);
  const rh = h / rows;
  for (let r = 0; r < rows; r++) {
    let x = 2;
    while (x < w - 2) {
      const bw = Math.max(1, Math.round(R.rr(w / 48, w / 18)));
      const bh = rh * R.rr(0.6, 0.88);
      g.fillStyle = BOOK_COLS[Math.floor(R.rnd() * BOOK_COLS.length)]!;
      g.fillRect(x, r * rh + rh - bh - rh * 0.08, bw, bh);
      x += bw + (R.rnd() > 0.85 ? bw : 0);
    }
    g.fillStyle = '#3a2414';
    g.fillRect(0, r * rh + rh * 0.92, w, rh * 0.08);
  }
}

registerTexture('term_books', {
  w: 64,
  h: 64,
  draw: (g, w, h, R) => shelves(g, R, w, h, 4),
  photo: (c) => {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 256;
    shelves(cv.getContext('2d')!, c, 256, 256, 4);
    return c.photoify(cv, { noise: 0.8 });
  },
});

registerTexture('term_counter', {
  w: 32,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#6a4a32', 0.08);
    g.fillStyle = '#d8d4cc';
    g.fillRect(0, 0, w, 3);
  },
  photos: ['brown_planks_05'],
  photo: (c) =>
    c.fromPhoto('brown_planks_05', {
      w: 512,
      h: 256,
      tile: 256,
      filter: 'brightness(.8) saturate(.9)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(220,216,206,.95)';
        g.fillRect(0, 0, w, h * 0.16);
        dirtBottom(g, w, h, 0.7, 0.4);
      },
    }),
});

function sign(text: string, bg: string, fg: string) {
  return {
    w: 64,
    h: 16,
    wrap: false,
    draw(g: CanvasRenderingContext2D, w: number, h: number) {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.font = 'bold 11px "Courier New",monospace';
      g.textAlign = 'center' as CanvasTextAlign;
      g.fillStyle = fg;
      g.fillText(text, w / 2, 12);
    },
    photo: 'small' as const,
  };
}
registerTexture('term_signBooks', sign('BOOKS', '#1a2a4a', '#f0e8d0'));
registerTexture('term_signGate', sign('GATE 21', '#20242a', '#f2c230'));
registerTexture('term_signFood', sign('CAFE', '#6a1a14', '#f0e8d0'));

/** Parked airliner side, 4 x 3 m per tile (cabin wall from floor to ceiling): window band mid-height. */
registerTexture('term_jet', {
  w: 64,
  h: 48,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#e4e6e8', 0.04);
    g.fillStyle = '#8a1a1a';
    g.fillRect(0, 30, w, 3);
    g.fillStyle = '#1a2a4a';
    g.fillRect(0, 34, w, 2);
    g.fillStyle = '#16181e';
    for (let x = 2; x < w; x += 8) g.fillRect(x, 18, 3, 5);
  },
  photos: ['blue_metal_plate'],
  photo: (c) =>
    c.fromPhoto('blue_metal_plate', {
      w: 512,
      h: 384,
      tile: 384,
      filter: 'saturate(0) brightness(1.9) contrast(.7)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(150,24,24,.92)';
        g.fillRect(0, h * 0.62, w, h * 0.06);
        g.fillStyle = 'rgba(24,40,80,.92)';
        g.fillRect(0, h * 0.7, w, h * 0.035);
        for (let x = 10; x < w; x += 64) {
          g.fillStyle = 'rgba(16,18,24,.95)';
          g.beginPath();
          g.ellipse(x + 14, h * 0.42, 10, 15, 0, 0, 7);
          g.fill();
        }
        g.fillStyle = 'rgba(80,84,90,.4)';
        for (let x = 0; x < w; x += 128) g.fillRect(x, 0, 2, h);
        dirtBottom(g, w, h, 0.85, 0.3);
      },
    }),
});

registerTexture('term_bridge', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#9a9ea4', 0.06);
    g.fillStyle = 'rgba(40,42,46,.5)';
    for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 1, h);
  },
  photos: ['box_profile_metal_sheet'],
  photo: (c) => c.fromPhoto('box_profile_metal_sheet', { filter: 'saturate(.1) brightness(1.1)', over: (g, w, h) => dirtBottom(g, w, h, 0.7, 0.4) }),
});

registerTexture('term_blast', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#6a6e72', 0.08);
    g.fillStyle = 'rgba(30,30,30,.5)';
    for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
    blotch(g, R, w, h, 6, '#6a3a1a', 0.4, 2, 6);
  },
  photos: ['rusty_metal_shutter'],
  photo: (c) => c.fromPhoto('rusty_metal_shutter', { filter: 'saturate(.4) brightness(.9)', over: (g, w, h) => drips(g, c, w, 0, 20, h * 0.6, 0.4) }),
});

registerTexture('term_truck', {
  w: 64,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#e0dcd0', 0.05);
    g.fillStyle = '#c9a02f';
    g.fillRect(0, 20, w, 4);
  },
  photos: ['rusty_painted_metal'],
  photo: (c) =>
    c.fromPhoto('rusty_painted_metal', {
      filter: 'saturate(.1) brightness(1.7) contrast(.8)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(200,160,40,.9)';
        g.fillRect(0, h * 0.62, w, h * 0.1);
        stencilText(g, ['JET A-1', 'NO SMOKING'], w * 0.1, h * 0.4, [56, 24], 'rgba(170,30,24,.85)');
        dirtBottom(g, w, h, 0.7, 0.55);
      },
    }),
});

registerTexture('term_skyDay', {
  w: 256,
  h: 128,
  draw(g, _w, _h, R) {
    const lg = g.createLinearGradient(0, 0, 0, 128);
    for (const [o, c] of [[0, '#3a6a9e'], [0.3, '#6a96c0'], [0.48, '#b4cadc'], [0.53, '#c4ccd0'], [1, '#8a8e90']] as const) lg.addColorStop(o, c);
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 24; i++) {
      const x = R.rr(0, 256);
      const y = R.rr(14, 56);
      const w = R.rr(16, 50);
      const hh = R.rr(3, 7);
      for (const ox of [0, -256]) {
        g.fillStyle = `rgba(250,252,255,${R.rr(0.35, 0.7)})`;
        g.fillRect(x + ox, y, w, hh);
        g.fillStyle = 'rgba(160,176,196,.35)';
        g.fillRect(x + ox + 2, y + hh, w - 4, 2);
      }
    }
  },
  photo: 'sky',
});

// ---------------------------------------------------------------------------------------------
// Full-map rebuild (docs/maps/terminal-reference.md): Terminal-owned copies of the cabin/stairs
// looks it used to borrow from Scrapyard and Rust, plus the food-court checker floor, shop signs,
// window frames and the evacuation slide. All drawn, or developed from photos already in assets.
// ---------------------------------------------------------------------------------------------

registerTexture('term_carpet', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#3e4660', 0.12);
    blotch(g, R, w, h, 6, '#22242e', 0.45, 2, 8);
  },
  photos: ['cotton_jersey'],
  photo: (c) => c.fromPhoto('cotton_jersey', { filter: 'hue-rotate(205deg) saturate(.7) brightness(.5)', over: (g, w, h) => dirtBottom(g, w, h, 0.3, 0.35) }),
});

registerTexture('term_seat', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#5e6a8a', 0.1);
    g.fillStyle = '#2a3042';
    g.fillRect(0, 0, w, 2);
    g.fillStyle = '#8a92a8';
    g.fillRect(3, 3, 10, 2);
  },
  photos: ['rough_linen'],
  photo: (c) =>
    c.fromPhoto('rough_linen', {
      w: 256,
      h: 256,
      tile: 256,
      filter: 'saturate(0) brightness(1.1)',
      over: (g, w, h) => {
        g.globalCompositeOperation = 'multiply';
        g.fillStyle = '#7a88aa';
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = 'rgba(20,24,36,.6)';
        g.fillRect(0, 0, w, h * 0.08);
      },
    }),
});

/** Aircraft skin: white painted aluminium with panel lines and rivets. */
registerTexture('term_alu', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#d8dadc', 0.05);
    g.fillStyle = 'rgba(70,74,80,.45)';
    g.fillRect(0, 0, w, 1);
    g.fillRect(0, 0, 1, h);
  },
  photos: ['blue_metal_plate'],
  photo: (c) =>
    c.fromPhoto('blue_metal_plate', {
      filter: 'saturate(0) brightness(1.8) contrast(.7)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(60,64,70,.5)';
        g.fillRect(0, 0, w, 3);
        g.fillRect(0, 0, 3, h);
        g.fillStyle = 'rgba(50,52,58,.4)';
        for (let x = 12; x < w; x += 24) g.fillRect(x, 6, 2, 2);
        dirtBottom(g, w, h, 0.8, 0.3);
      },
    }),
});

/** Cabin interior side wall: cream panels with a row of windows at seat height. */
registerTexture('term_cabin', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#d2ccc0', 0.05);
    g.fillStyle = 'rgba(90,84,74,.35)';
    g.fillRect(0, 0, 1, h);
    g.fillStyle = '#1a1c22';
    g.fillRect(12, 10, 6, 8);
  },
  photos: ['painted_plaster_wall'],
  photo: (c) =>
    c.fromPhoto('painted_plaster_wall', {
      filter: 'saturate(.2) brightness(1.2)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(80,76,68,.45)';
        g.fillRect(0, 0, 4, h);
        g.fillStyle = 'rgba(20,22,28,.85)';
        g.beginPath();
        g.ellipse(w * 0.5, h * 0.45, w * 0.09, h * 0.1, 0, 0, 7);
        g.fill();
      },
    }),
});

registerTexture('term_cockpit', {
  w: 32,
  h: 16,
  wrap: false,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#d8dadc', 0.05);
    g.fillStyle = '#14161c';
    g.fillRect(2, 3, 8, 8);
    g.fillRect(12, 3, 8, 8);
    g.fillRect(22, 4, 8, 6);
    g.fillStyle = 'rgba(150,170,190,.5)';
    g.fillRect(3, 4, 2, 4);
    g.fillRect(13, 4, 2, 4);
  },
  photo: 'small',
});

/** Escalator and stair treads: ribbed steel, four treads per tile along the slope. */
registerTexture('term_stairs', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#6a6e74', 0.1);
    for (let x = 0; x < w; x += 8) {
      g.fillStyle = '#26282c';
      g.fillRect(x, 0, 1, h);
      g.fillStyle = '#a8acb2';
      g.fillRect(x + 1, 0, 1, h);
    }
  },
  photos: ['box_profile_metal_sheet'],
  photo: (c) =>
    c.fromPhoto('box_profile_metal_sheet', {
      filter: 'saturate(0) brightness(.9) contrast(1.2)',
      over: (g, w, h) => {
        for (let i = 0; i < 4; i++) {
          g.fillStyle = 'rgba(14,14,16,.8)';
          g.fillRect((i * w) / 4, 0, 10, h);
        }
      },
    }),
});

/** Glass balustrade frame: transparent except posts and rails (alpha < 0.5 is discarded). */
registerTexture('term_rail', {
  w: 32,
  h: 32,
  posterize: false,
  draw(g, w, h) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#8a9098';
    g.fillRect(0, 0, 3, h);
    g.fillRect(0, 0, w, 3);
    g.fillStyle = '#5a6068';
    g.fillRect(0, h - 3, w, 3);
  },
  photo: 'none',
});

/** Window frames: mullions and transoms only, so you see (and shoot) through the opening. */
registerTexture('term_glass', {
  w: 32,
  h: 32,
  posterize: false,
  draw(g, w, h) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#3a4048';
    g.fillRect(0, 0, 2, h);
    g.fillRect(0, 0, w, 2);
    g.fillRect(0, h - 2, w, 2);
    g.fillStyle = '#6a7480';
    g.fillRect(2, 0, 1, h);
  },
  photo: 'none',
});

/** Food court floor: black and white checker tiles (one tile = a quarter of the texture). */
registerTexture('term_checker', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++) grain(g, R, (x * w) / 2, (y * h) / 2, w / 2, h / 2, (x + y) % 2 ? '#24262a' : '#d8d4cc', 0.05);
  },
  photos: ['concrete_floor_worn_001'],
  photo: (c) =>
    c.fromPhoto('concrete_floor_worn_001', {
      filter: 'saturate(0) brightness(1.3) contrast(.7)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(16,16,18,.82)';
        g.fillRect(w / 2, 0, w / 2, h / 2);
        g.fillRect(0, h / 2, w / 2, h / 2);
      },
    }),
});

registerTexture('term_slide', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#e8782a', 0.08);
    g.fillStyle = '#b8501a';
    g.fillRect(0, 0, 2, h);
    g.fillRect(w - 2, 0, 2, h);
  },
  photo: 'small',
});

/** A wider sign for longer names (128 x 16). */
function wideSign(text: string, bg: string, fg: string) {
  return { ...sign(text, bg, fg), w: 128 };
}
registerTexture('term_signBurger', wideSign('BURGER TOWN', '#b01e18', '#f6d23a'));
registerTexture('term_signSecurity', wideSign('SECURITY', '#1a2026', '#f2c230'));
registerTexture('term_signMakeup', wideSign('COSMETICS', '#2a1a2a', '#f0d0e0'));
registerTexture('term_signBaggage', wideSign('BAGGAGE CLAIM', '#20242a', '#f2c230'));
registerTexture('term_signLounge', wideSign('GATES 1-2-3', '#20242a', '#f2c230'));
