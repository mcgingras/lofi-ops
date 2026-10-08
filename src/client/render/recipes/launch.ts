/**
 * Texture recipes for Launch (maps-bo, src/shared/maps/launch.ts): `lc_*` ids. The cosmodrome look:
 * cracked grey apron, steppe dust, pad slabs with hazard paint, Soviet white-washed block walls,
 * blue-grey corrugated sheeting, green transporter steel, the orange erector, the gantry lattice,
 * the Soyuz (white body, CCCP), white fuel tanks and Russian signs.
 * Photos: Poly Haven CC0 (assets/textures); no new photos were added for this map.
 */
import { blotch, dirtBottom, drips, grain, stencil, stencilText, streaks } from '../developer';
import { registerTexture } from '../textures';

registerTexture('lc_asphalt', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#7a7872', 0.08);
    blotch(g, R, w, h, 14, '#5c5a56', 0.4, 3, 12);
    blotch(g, R, w, h, 8, '#9a9488', 0.35, 2, 8);
    g.fillStyle = 'rgba(30,30,28,.55)';
    for (let i = 0; i < 6; i++) {
      let x = R.rr(0, w);
      let y = R.rr(0, h);
      for (let j = 0; j < 14; j++) {
        g.fillRect(x | 0, y | 0, 1, 1);
        x += R.rr(-1.5, 1.5);
        y += R.rr(0.2, 1.4);
      }
    }
  },
  photos: ['asphalt_02'],
  photo: (c) =>
    c.fromPhoto('asphalt_02', {
      filter: 'saturate(.35) sepia(.2) brightness(1.15) contrast(.95)',
      over: (g, w, h) => {
        // Cracks and dust settling in them, a few oil stains.
        g.strokeStyle = 'rgba(28,26,24,.6)';
        g.lineWidth = 2;
        for (let i = 0; i < 7; i++) {
          g.beginPath();
          let x = c.rr(0, w);
          let y = c.rr(0, h);
          g.moveTo(x, y);
          for (let j = 0; j < 9; j++) {
            x += c.rr(-30, 30);
            y += c.rr(-30, 30);
            g.lineTo(x, y);
          }
          g.stroke();
        }
        g.filter = 'blur(14px)';
        for (let i = 0; i < 8; i++) {
          g.fillStyle = i % 3 ? `rgba(196,176,140,${c.rr(0.12, 0.25)})` : `rgba(20,20,20,${c.rr(0.1, 0.2)})`;
          g.beginPath();
          g.ellipse(c.rr(0, w), c.rr(0, h), c.rr(30, 90), c.rr(20, 60), c.rr(0, 3), 0, 7);
          g.fill();
        }
        g.filter = 'none';
      },
    }),
});

registerTexture('lc_sand', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#a8946e', 0.08);
    blotch(g, R, w, h, 14, '#7e6c4e', 0.35, 3, 12);
    blotch(g, R, w, h, 10, '#c4b08a', 0.3, 2, 8);
  },
  photos: ['dry_ground_rocks'],
  photo: (c) => c.fromPhoto('dry_ground_rocks', { filter: 'sepia(.55) saturate(.9) brightness(1.2) contrast(.9)' }),
});

/** Pad concrete: big cast slabs with dark joints, soot. */
registerTexture('lc_slab', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#a29e94', 0.06);
    blotch(g, R, w, h, 8, '#6e6a62', 0.3, 2, 8);
    g.fillStyle = 'rgba(40,38,34,.7)';
    g.fillRect(0, 0, w, 1);
    g.fillRect(0, 0, 1, h);
  },
  photos: ['concrete_floor_worn_001'],
  photo: (c) =>
    c.fromPhoto('concrete_floor_worn_001', {
      filter: 'saturate(.4) brightness(1.08) contrast(1.05)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(34,32,30,.75)';
        g.fillRect(0, 0, w, 5);
        g.fillRect(0, 0, 5, h);
        g.fillStyle = 'rgba(34,32,30,.3)';
        g.fillRect(w / 2, 0, 3, h);
        g.fillRect(0, h / 2, w, 3);
        g.filter = 'blur(18px)';
        for (let i = 0; i < 4; i++) {
          g.fillStyle = `rgba(30,28,26,${c.rr(0.1, 0.25)})`;
          g.beginPath();
          g.ellipse(c.rr(0, w), c.rr(0, h), c.rr(40, 110), c.rr(30, 70), 0, 0, 7);
          g.fill();
        }
        g.filter = 'none';
      },
    }),
});

/** White-washed Soviet block wall, weathered, dark skirt. */
registerTexture('lc_wall', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#c8c2b4', 0.05);
    g.fillStyle = 'rgba(80,74,64,.3)';
    for (let y = 0; y < h; y += 8) g.fillRect(0, y, w, 1);
    streaks(g, R, w, 0, 10, 26, 0.3, '90,80,64');
    g.fillStyle = 'rgba(70,64,56,.45)';
    g.fillRect(0, h - 4, w, 4);
  },
  photos: ['painted_plaster_wall'],
  photo: (c) =>
    c.fromPhoto('painted_plaster_wall', {
      filter: 'saturate(.35) sepia(.2) brightness(1.15)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(70,64,56,.18)';
        for (let y = 0; y < h; y += h / 4) g.fillRect(0, y, w, 3);
        drips(g, c, w, 0, 26, h * 0.6, 0.35);
        dirtBottom(g, w, h, 0.72, 0.6);
      },
    }),
});

/** Blue-grey corrugated sheeting (sheds, garages, the tower skins). */
registerTexture('lc_corr', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    for (let x = 0; x < w; x++) {
      const k = 0.8 + 0.2 * Math.sin((x / w) * Math.PI * 8);
      grain(g, R, x, 0, 1, h, k > 0.9 ? '#9aa2a8' : '#7a8288', 0.05);
    }
    streaks(g, R, w, 0, 8, 24, 0.35, '90,60,40');
  },
  photos: ['worn_corrugated_iron'],
  photo: (c) =>
    c.fromPhoto('worn_corrugated_iron', {
      filter: 'saturate(.25) hue-rotate(160deg) brightness(1.1) contrast(1.05)',
      over: (g, w, h) => {
        drips(g, c, w, 0, 20, h * 0.5, 0.35);
        dirtBottom(g, w, h, 0.7, 0.5);
      },
    }),
});

/** Military green painted steel (missile cars, gantry members). */
registerTexture('lc_green', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#5e6a4a', 0.07);
    blotch(g, R, w, h, 6, '#3e4630', 0.4, 2, 6);
    g.fillStyle = 'rgba(20,24,16,.5)';
    g.fillRect(0, 0, w, 1);
    g.fillRect(0, 0, 1, h);
  },
  photos: ['blue_metal_plate'],
  photo: (c) =>
    c.fromPhoto('blue_metal_plate', {
      filter: 'hue-rotate(-110deg) saturate(.55) brightness(.85)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(20,24,16,.55)';
        g.fillRect(0, 0, w, 4);
        g.fillRect(0, 0, 4, h);
        drips(g, c, w, 0, 18, h * 0.5, 0.4);
      },
    }),
});

/** The erector arm's orange paint. */
registerTexture('lc_orange', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#c06a2c', 0.07);
    blotch(g, R, w, h, 6, '#7a3a18', 0.4, 2, 6);
  },
  photos: ['rusty_painted_metal'],
  photo: (c) => c.fromPhoto('rusty_painted_metal', { filter: 'sepia(.6) saturate(2.2) hue-rotate(-12deg) brightness(.95)' }),
});

/** Red-painted metal: the flame deflector, pipes along the pad wall. */
registerTexture('lc_red', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#8a2a20', 0.08);
    blotch(g, R, w, h, 8, '#3a1610', 0.5, 2, 6);
  },
  photos: ['rusty_painted_metal'],
  photo: (c) => c.fromPhoto('rusty_painted_metal', { filter: 'sepia(.7) saturate(2.6) hue-rotate(-28deg) brightness(.7)' }),
});

/** Gantry lattice: cut-out cross bracing (alpha < 0.5 is discarded). */
registerTexture('lc_lattice', {
  w: 32,
  h: 32,
  posterize: false,
  wrap: true,
  draw(g, w, h) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#56624a';
    g.fillRect(0, 0, 3, h);
    g.fillRect(w - 3, 0, 3, h);
    g.fillRect(0, 0, w, 3);
    for (let i = 0; i < w; i++) {
      g.fillRect(i, i, 2, 2);
      g.fillRect(w - 1 - i, i, 2, 2);
    }
    g.fillStyle = '#3a4430';
    g.fillRect(0, h - 2, w, 2);
  },
  photo: 'none',
});

/** The Soyuz body: off-white panels, grey seams, a darker band. Cylinder UVs (once round, once along). */
registerTexture('lc_rocket', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#dcdad2', 0.04);
    g.fillStyle = 'rgba(80,84,88,.5)';
    for (let y = 8; y < h; y += 16) g.fillRect(0, y, w, 1);
    for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 1, h);
    g.fillStyle = 'rgba(70,74,78,.65)';
    g.fillRect(0, h * 0.3, w, 4);
    streaks(g, R, w, 0, 10, 40, 0.15, '60,60,60');
  },
  photos: ['blue_metal_plate'],
  photo: (c) =>
    c.fromPhoto('blue_metal_plate', {
      w: 512,
      h: 1024,
      tile: 512,
      filter: 'grayscale(1) brightness(1.9) contrast(.6)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(70,74,80,.45)';
        for (let y = h / 8; y < h; y += h / 8) g.fillRect(0, y, w, 4);
        for (let x = 0; x < w; x += w / 8) g.fillRect(x, 0, 3, h);
        g.fillStyle = 'rgba(60,64,70,.7)';
        g.fillRect(0, h * 0.28, w, 14);
        g.fillStyle = 'rgba(150,40,30,.85)';
        g.fillRect(0, h * 0.06, w, 10);
      },
    }),
});

/** Boosters: white with the scorched ochre skirt at the bottom of the canvas (bottom of the cylinder). */
registerTexture('lc_booster', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#d8d6ce', 0.04);
    grain(g, R, 0, h - 14, w, 14, '#c49a40', 0.08);
    g.fillStyle = 'rgba(80,84,88,.5)';
    for (let y = 10; y < h; y += 14) g.fillRect(0, y, w, 1);
    streaks(g, R, w, h - 14, 14, 12, 0.4, '60,40,20');
  },
  photos: ['blue_metal_plate'],
  photo: (c) =>
    c.fromPhoto('blue_metal_plate', {
      w: 512,
      h: 1024,
      tile: 512,
      filter: 'grayscale(1) brightness(1.85) contrast(.6)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(70,74,80,.45)';
        for (let y = h / 6; y < h; y += h / 6) g.fillRect(0, y, w, 4);
        const lg = g.createLinearGradient(0, h * 0.78, 0, h);
        lg.addColorStop(0, 'rgba(178,142,82,.72)');
        lg.addColorStop(1, 'rgba(110,82,44,.88)');
        g.fillStyle = lg;
        g.fillRect(0, h * 0.78, w, h * 0.22);
        g.fillStyle = 'rgba(40,30,20,.5)';
        g.fillRect(0, h * 0.78, w, 6);
        stencilText(g, ['391 391'], w * 0.2, h * 0.6, [44], 'rgba(60,60,64,.7)');
      },
    }),
});

/** CCCP down the side of the rocket (a card). */
registerTexture('lc_cccp', {
  w: 16,
  h: 64,
  wrap: false,
  posterize: false,
  draw(g, w, h) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#a8241c';
    g.font = 'bold 15px "Courier New",monospace';
    g.textAlign = 'center';
    for (let i = 0; i < 4; i++) g.fillText('CCCP'[i]!, w / 2, 14 + i * 15);
  },
  photo: 'none',
});

/** White fuel tank shell with weld rings and a Russian stencil (fuel / flammable). */
registerTexture('lc_tank', {
  w: 64,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#d6d4cc', 0.05);
    g.fillStyle = 'rgba(80,80,76,.4)';
    g.fillRect(0, 8, w, 1);
    g.fillRect(0, 22, w, 1);
    streaks(g, R, w, 0, 14, 22, 0.35, '110,70,40');
    stencil(g, 'ГОРЮЧЕЕ', 12, 18, 8, '#2a2a2a');
  },
  photos: ['rusty_painted_metal'],
  photo: (c) =>
    c.fromPhoto('rusty_painted_metal', {
      w: 1024,
      h: 512,
      filter: 'saturate(.08) brightness(1.75) contrast(.85)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(70,70,66,.4)';
        for (let y = h / 4; y < h; y += h / 4) g.fillRect(0, y, w, 4);
        for (let x = 0; x < w; x += w / 8) g.fillRect(x, 0, 3, h);
        stencilText(g, ['ГОРЮЧЕЕ', 'ОГНЕОПАСНО'], w * 0.08, h * 0.45, [60, 30], 'rgba(30,30,30,.8)');
        stencilText(g, ['ГОРЮЧЕЕ'], w * 0.58, h * 0.45, [60], 'rgba(30,30,30,.8)');
        drips(g, c, w, 0, 40, h * 0.6, 0.4);
        dirtBottom(g, w, h, 0.75, 0.5);
      },
    }),
});

/** The red star in a white roundel (building emblems). */
registerTexture('lc_star', {
  w: 32,
  h: 32,
  wrap: false,
  posterize: false,
  draw(g, w, h) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#e6e2d8';
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2 - 1, 0, 7);
    g.fill();
    g.fillStyle = '#b02a1e';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 5 : 13;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      g.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
    }
    g.fill();
  },
  photo: 'none',
});

/** "No unauthorised entry" sign (white board, red letters). */
registerTexture('lc_sign', {
  w: 64,
  h: 48,
  wrap: false,
  draw(g, w, h) {
    g.fillStyle = '#e8e2d2';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#a8241c';
    g.lineWidth = 2;
    g.strokeRect(2, 2, w - 4, h - 4);
    g.fillStyle = '#a8241c';
    g.font = 'bold 8px "Courier New",monospace';
    g.textAlign = 'center';
    g.fillText('ПОСТОРОННИМ', w / 2, 16);
    g.fillText('ВХОД', w / 2, 27);
    g.fillText('ВОСПРЕЩЕН!', w / 2, 38);
  },
  photo: 'small',
});

/** Rails and sleepers on the track top (u across, v along). */
registerTexture('lc_rails', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#6e675c', 0.1);
    for (let y = 0; y < h; y += 6) {
      g.fillStyle = '#4a3a2a';
      g.fillRect(2, y, w - 4, 3);
    }
    g.fillStyle = '#8a8c90';
    g.fillRect(7, 0, 2, h);
    g.fillRect(w - 9, 0, 2, h);
  },
  photos: ['dry_ground_rocks'],
  photo: (c) =>
    c.fromPhoto('dry_ground_rocks', {
      filter: 'saturate(.3) brightness(.85)',
      over: (g, w, h) => {
        for (let y = 0; y < h; y += h / 6) {
          g.fillStyle = 'rgba(70,52,34,.95)';
          g.fillRect(w * 0.06, y, w * 0.88, h / 14);
        }
        for (const x of [0.25, 0.75]) {
          g.fillStyle = 'rgba(150,152,156,.95)';
          g.fillRect(w * x - 6, 0, 12, h);
          g.fillStyle = 'rgba(60,60,64,.9)';
          g.fillRect(w * x + 6, 0, 4, h);
        }
      },
    }),
});
