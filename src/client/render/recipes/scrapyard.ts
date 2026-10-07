/**
 * Texture recipes for Scrapyard (maps-mw2): dirt and asphalt, the hangar's ribbed cladding and
 * floor, catwalk grating, the airliner (livery side with window band, bare aluminium, cabin
 * panels, carpet, seats, cockpit glazing), scrap piles, the yard wall and a white trailer. Photo
 * looks develop the CC0 Poly Haven photos in assets/textures. Ids are prefixed `scrap_`.
 */
import { blotch, col, dirtBottom, drips, grain, hex, stencilText, streaks } from '../developer';
import { registerTexture } from '../textures';

registerTexture('scrap_ground', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#7a7062', 0.1);
    blotch(g, R, w, h, 18, '#4a4236', 0.4, 3, 12);
    blotch(g, R, w, h, 14, '#a09684', 0.3, 1, 4);
  },
  photos: ['concrete_floor_worn_001'],
  photo: (c) =>
    c.fromPhoto('concrete_floor_worn_001', {
      filter: 'sepia(.45) saturate(.9) brightness(.82) contrast(1.15)',
      over: (g, w, h) => {
        g.filter = 'blur(8px)';
        for (let i = 0; i < 12; i++) {
          g.fillStyle = i % 3 ? `rgba(50,42,32,${c.rr(0.15, 0.35)})` : `rgba(30,30,32,${c.rr(0.2, 0.4)})`;
          g.beginPath();
          g.ellipse(c.rr(0, w), c.rr(0, h), c.rr(30, 100), c.rr(16, 50), c.rr(0, 3), 0, 7);
          g.fill();
        }
        g.filter = 'none';
        // Gravel specks.
        for (let i = 0; i < 900; i++) {
          g.fillStyle = c.rnd() > 0.5 ? 'rgba(200,192,176,.5)' : 'rgba(30,26,22,.5)';
          g.fillRect(c.rr(0, w), c.rr(0, h), 2, 2);
        }
      },
    }),
});

registerTexture('scrap_asphalt', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#45464a', 0.12);
    blotch(g, R, w, h, 8, '#2a2a2c', 0.5, 4, 12);
  },
  photos: ['concrete_floor_worn_001'],
  photo: (c) =>
    c.fromPhoto('concrete_floor_worn_001', {
      filter: 'saturate(.2) brightness(.5) contrast(1.3)',
      over: (g, w, h) => {
        g.strokeStyle = 'rgba(14,14,16,.7)';
        g.lineWidth = 3;
        for (let k = 0; k < 5; k++) {
          g.beginPath();
          let x = c.rr(0, w);
          let y = c.rr(0, h);
          g.moveTo(x, y);
          for (let i = 0; i < 30; i++) {
            x += c.rr(-10, 12);
            y += c.rr(-10, 12);
            g.lineTo(x, y);
          }
          g.stroke();
        }
      },
    }),
});

registerTexture('scrap_hangar', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    const b = hex('#6e7a84');
    for (let x = 0; x < w; x++)
      for (let y = 0; y < h; y++) {
        const ph = (x / 16) % 1;
        g.fillStyle = col(b, (ph < 0.2 ? 1.18 : ph < 0.3 ? 0.7 : 0.95) * R.rr(0.94, 1.05));
        g.fillRect(x, y, 1, 1);
      }
    streaks(g, R, w, 0, 14, 40, 0.35, '60,40,30');
  },
  photos: ['box_profile_metal_sheet'],
  photo: (c) =>
    c.fromPhoto('box_profile_metal_sheet', {
      filter: 'saturate(0) brightness(1.05) contrast(1.1)',
      over: (g, w, h) => {
        g.globalCompositeOperation = 'multiply';
        g.fillStyle = '#9aa8b6';
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'source-over';
        drips(g, c, w, 0, 26, h * 0.5, 0.45);
        dirtBottom(g, w, h, 0.7, 0.55);
      },
    }),
});

registerTexture('scrap_concrete', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#8a8884', 0.07);
    blotch(g, R, w, h, 8, '#4a4846', 0.4, 2, 8);
    g.fillStyle = 'rgba(30,30,30,.5)';
    g.fillRect(0, 0, w, 1);
    g.fillRect(0, 0, 1, h);
  },
  photos: ['concrete'],
  photo: (c) =>
    c.fromPhoto('concrete', {
      filter: 'saturate(.3) brightness(.85)',
      over: (g, w, h) => {
        g.filter = 'blur(6px)';
        for (let i = 0; i < 6; i++) {
          g.fillStyle = `rgba(20,18,16,${c.rr(0.2, 0.4)})`;
          g.beginPath();
          g.ellipse(c.rr(0, w), c.rr(0, h), c.rr(20, 70), c.rr(10, 40), 0, 0, 7);
          g.fill();
        }
        g.filter = 'none';
        g.fillStyle = 'rgba(24,24,24,.7)';
        g.fillRect(0, 0, w, 3);
        g.fillRect(0, 0, 3, h);
      },
    }),
});

registerTexture('scrap_grate', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#3c4046', 0.1);
    g.fillStyle = '#1a1c20';
    for (let i = 0; i < w; i += 4) {
      g.fillRect(i, 0, 1, h);
      g.fillRect(0, i, w, 1);
    }
  },
  photos: ['blue_metal_plate'],
  photo: (c) =>
    c.fromPhoto('blue_metal_plate', {
      filter: 'saturate(.15) brightness(.6) contrast(1.2)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(10,10,12,.75)';
        for (let i = 0; i < w; i += 32) {
          g.fillRect(i, 0, 8, h);
          g.fillRect(0, i, w, 8);
        }
      },
    }),
});

/**
 * Airliner side, 4 x 4 m per tile, top of the canvas = top of the hull wall. White crown, window
 * band, blue cheat line, grey belly.
 */
registerTexture('scrap_fuse', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#d4d6d8', 0.05);
    grain(g, R, 0, 40, w, 24, '#9a9ea4', 0.06);
    g.fillStyle = '#244a7a';
    g.fillRect(0, 30, w, 5);
    g.fillStyle = '#1a1c22';
    for (let x = 2; x < w; x += 8) g.fillRect(x, 20, 3, 4);
    streaks(g, R, w, 24, 16, 30, 0.4, '70,50,40');
  },
  photos: ['blue_metal_plate'],
  photo: (c) =>
    c.fromPhoto('blue_metal_plate', {
      filter: 'saturate(.05) brightness(1.75) contrast(.85)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(120,124,132,.6)';
        g.fillRect(0, h * 0.62, w, h * 0.38);
        g.fillStyle = 'rgba(30,66,120,.92)';
        g.fillRect(0, h * 0.46, w, h * 0.07);
        g.fillStyle = 'rgba(200,60,40,.85)';
        g.fillRect(0, h * 0.535, w, h * 0.015);
        // Window band: rounded dark windows, a few missing (holes punched dark).
        for (let x = 12; x < w; x += 64) {
          g.fillStyle = 'rgba(16,18,24,.95)';
          g.beginPath();
          g.ellipse(x + 14, h * 0.34, 11, 16, 0, 0, 7);
          g.fill();
          g.fillStyle = 'rgba(140,160,180,.35)';
          g.fillRect(x + 8, h * 0.31, 4, 8);
        }
        // Panel seams and rivets.
        g.fillStyle = 'rgba(60,60,64,.5)';
        for (let x = 0; x < w; x += 128) g.fillRect(x, 0, 2, h);
        g.fillRect(0, h * 0.2, w, 2);
        drips(g, c, w, h * 0.38, 30, h * 0.4, 0.35);
        dirtBottom(g, w, h, 0.6, 0.65);
      },
    }),
});

registerTexture('scrap_alu', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#a8acb2', 0.07);
    g.fillStyle = 'rgba(60,62,66,.5)';
    g.fillRect(0, 0, w, 1);
    g.fillRect(0, 0, 1, h);
    blotch(g, R, w, h, 6, '#6a6458', 0.35, 2, 6);
  },
  photos: ['blue_metal_plate'],
  photo: (c) =>
    c.fromPhoto('blue_metal_plate', {
      filter: 'saturate(.1) brightness(1.25)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(50,52,58,.55)';
        g.fillRect(0, 0, w, 3);
        g.fillRect(0, 0, 3, h);
        g.fillStyle = 'rgba(40,40,44,.6)';
        for (let x = 12; x < w; x += 24) g.fillRect(x, 6, 3, 3);
        for (let y = 12; y < h; y += 24) g.fillRect(6, y, 3, 3);
        drips(g, c, w, 0, 16, h * 0.6, 0.3);
      },
    }),
});

registerTexture('scrap_cabin', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#bdb4a2', 0.06);
    g.fillStyle = 'rgba(80,72,60,.4)';
    g.fillRect(0, 0, 1, h);
    g.fillRect(0, 12, w, 1);
    blotch(g, R, w, h, 6, '#5a5040', 0.4, 2, 6);
  },
  photos: ['rough_linen'],
  photo: (c) =>
    c.fromPhoto('rough_linen', {
      filter: 'sepia(.4) brightness(.78) contrast(.95)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(70,64,52,.5)';
        g.fillRect(0, 0, 4, h);
        g.fillRect(0, h * 0.4, w, 3);
        g.filter = 'blur(6px)';
        for (let i = 0; i < 8; i++) {
          g.fillStyle = `rgba(40,32,24,${c.rr(0.15, 0.35)})`;
          g.fillRect(c.rr(0, w), c.rr(0, h), c.rr(20, 90), c.rr(20, 120));
        }
        g.filter = 'none';
      },
    }),
});

registerTexture('scrap_carpet', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#4a4a5e', 0.12);
    blotch(g, R, w, h, 6, '#2a2620', 0.5, 2, 8);
  },
  photos: ['cotton_jersey'],
  photo: (c) => c.fromPhoto('cotton_jersey', { filter: 'hue-rotate(200deg) saturate(.6) brightness(.5)', over: (g, w, h) => dirtBottom(g, w, h, 0.3, 0.4) }),
});

registerTexture('scrap_seat', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#2e4a7a', 0.1);
    g.fillStyle = '#1a2840';
    g.fillRect(0, 0, w, 2);
    g.fillStyle = '#c8c8c0';
    g.fillRect(3, 3, 10, 3);
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
        g.fillStyle = '#34548e';
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = 'rgba(210,210,200,.8)';
        g.fillRect(w * 0.2, h * 0.15, w * 0.6, h * 0.18);
        g.fillStyle = 'rgba(14,18,30,.6)';
        g.fillRect(0, 0, w, h * 0.08);
      },
    }),
});

registerTexture('scrap_cockpit', {
  w: 32,
  h: 16,
  wrap: false,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#d4d6d8', 0.05);
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

registerTexture('scrap_junk', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#5a4c40', 0.14);
    for (let i = 0; i < 40; i++) {
      const c = ['#8a8e94', '#6a3a1e', '#2a2a2e', '#a8946a', '#3a4a5a'][i % 5]!;
      g.fillStyle = c;
      g.fillRect(R.rr(0, w) | 0, R.rr(0, h) | 0, R.rr(3, 14) | 0, R.rr(2, 8) | 0);
    }
  },
  photos: ['rusty_metal', 'blue_metal_plate'],
  photo: (c) =>
    c.fromPhoto('rusty_metal', {
      filter: 'saturate(.8) brightness(.75)',
      over: (g, w, h) => {
        const plate = c.photo('blue_metal_plate');
        for (let i = 0; i < 26; i++) {
          g.save();
          g.translate(c.rr(0, w), c.rr(0, h));
          g.rotate(c.rr(0, 3.14));
          const pw = c.rr(40, 160);
          const ph = c.rr(20, 70);
          if (plate && i % 2) {
            g.filter = 'saturate(.1) brightness(1.1)';
            g.drawImage(plate, 0, 0, 256, 128, -pw / 2, -ph / 2, pw, ph);
            g.filter = 'none';
          } else {
            g.fillStyle = ['rgba(40,38,40,.9)', 'rgba(120,70,40,.85)', 'rgba(180,170,150,.8)'][i % 3]!;
            g.fillRect(-pw / 2, -ph / 2, pw, ph);
          }
          g.fillStyle = 'rgba(0,0,0,.35)';
          g.fillRect(-pw / 2, ph / 2 - 6, pw, 6);
          g.restore();
        }
      },
    }),
});

registerTexture('scrap_wall', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    const b = hex('#7a7268');
    for (let x = 0; x < w; x++)
      for (let y = 0; y < h; y++) {
        g.fillStyle = col(b, (0.72 + 0.28 * Math.sin((x / w) * Math.PI * 16)) * R.rr(0.92, 1.06));
        g.fillRect(x, y, 1, 1);
      }
    streaks(g, R, w, 0, 20, 50, 0.45);
  },
  photos: ['worn_corrugated_iron'],
  photo: (c) =>
    c.fromPhoto('worn_corrugated_iron', {
      filter: 'saturate(.55) brightness(.8)',
      over: (g, w, h) => {
        drips(g, c, w, 0, 24, h * 0.7, 0.5);
        dirtBottom(g, w, h, 0.6, 0.6);
      },
    }),
});

registerTexture('scrap_trailer', {
  w: 64,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#d8d8d2', 0.05);
    g.fillStyle = 'rgba(90,90,86,.4)';
    for (let x = 0; x < w; x += 3) g.fillRect(x, 0, 1, h);
    streaks(g, R, w, 0, 18, 24, 0.4, '100,70,50');
  },
  photos: ['box_profile_metal_sheet'],
  photo: (c) =>
    c.fromPhoto('box_profile_metal_sheet', {
      w: 1024,
      h: 512,
      tile: 512,
      filter: 'saturate(.1) brightness(1.35)',
      over: (g, w, h) => {
        stencilText(g, ['AERO SALVAGE CO.'], w * 0.08, h * 0.4, [56], 'rgba(170,40,30,.8)');
        drips(g, c, w, 0, 50, h * 0.6, 0.45);
        dirtBottom(g, w, h, 0.55, 0.65);
      },
    }),
});
