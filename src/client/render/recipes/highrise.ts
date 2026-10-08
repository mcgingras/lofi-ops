/**
 * Texture recipes for Highrise (maps-mw2): the tar-sealed roof slab, plywood formwork (the Pit walls),
 * skyscraper curtain walls for the skyline, the hazy afternoon sky, the Mi-8's olive drab and red
 * star, the helipad H, the crane lattice, the KRIEGLER sign, the green tarp, elevator doors and the
 * WKM graffiti. Photo looks develop the CC0 Poly Haven photos already in assets/textures. Ids are
 * prefixed `hr_`; Highrise also reuses Terminal, Rust, Scrapyard and core ids.
 */
import { blotch, dirtBottom, grain, streaks } from '../developer';
import { registerTexture } from '../textures';

/** Roof slab, 4 x 4 m per tile: worn concrete with tar-sealed joints and puddle stains. */
registerTexture('hr_roof', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#8c8a84', 0.08);
    blotch(g, R, w, h, 7, '#55524c', 0.35, 2, 9);
    g.fillStyle = 'rgba(28,26,24,.75)';
    g.fillRect(0, 0, w, 1);
    g.fillRect(0, 0, 1, h);
    g.fillRect(w / 2, 0, 1, h);
  },
  photos: ['concrete_floor_worn_001'],
  photo: (c) =>
    c.fromPhoto('concrete_floor_worn_001', {
      filter: 'saturate(.25) brightness(.9) contrast(1.08)',
      over: (g, w, h) => {
        g.filter = 'blur(10px)';
        for (let i = 0; i < 6; i++) {
          g.fillStyle = `rgba(30,30,32,${c.rr(0.12, 0.3)})`;
          g.beginPath();
          g.ellipse(c.rr(0, w), c.rr(0, h), c.rr(24, 70), c.rr(16, 46), 0, 0, 7);
          g.fill();
        }
        g.filter = 'none';
        // Tar-sealed joints: a 2 x 2 grid of slabs per tile, with drips of sealant.
        g.fillStyle = 'rgba(20,18,16,.85)';
        g.fillRect(0, 0, w, 5);
        g.fillRect(0, 0, 5, h);
        g.fillRect(w / 2 - 2, 0, 4, h);
        g.fillRect(0, h / 2 - 2, w, 4);
        for (let i = 0; i < 18; i++) g.fillRect(c.rr(0, w), c.rr(0, 6), c.rr(3, 9), c.rr(2, 5));
      },
    }),
});

/** Plywood formwork sheets, 2.4 x 2.4 m per tile: the walls of the Pit (tinted red for the Red Pit). */
registerTexture('hr_plywood', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#b89a6a', 0.08);
    for (let y = 2; y < h; y += 5) {
      g.fillStyle = 'rgba(120,90,50,.25)';
      g.fillRect(0, y, w, 1);
    }
    g.fillStyle = 'rgba(60,44,26,.7)';
    g.fillRect(0, 0, 1, h);
    g.fillRect(w / 2, 0, 1, h);
    g.fillRect(0, 0, w, 1);
    g.fillStyle = 'rgba(40,40,44,.8)';
    for (const x of [3, w / 2 + 3, w - 3]) for (const y of [4, h / 2, h - 4]) g.fillRect(x, y, 1, 1);
  },
  photos: ['plank_flooring'],
  photo: (c) =>
    c.fromPhoto('plank_flooring', {
      filter: 'saturate(.55) brightness(1.15) sepia(.25)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(70,52,30,.75)';
        g.fillRect(0, 0, 6, h);
        g.fillRect(w / 2 - 3, 0, 6, h);
        g.fillRect(0, 0, w, 5);
        g.fillStyle = 'rgba(30,30,34,.85)';
        for (const x of [16, w / 2 + 16, w - 16]) for (const y of [20, h / 2, h - 20]) g.fillRect(x - 3, y - 3, 6, 6);
        dirtBottom(g, w, h, 0.7, 0.45);
      },
    }),
});

/**
 * Office tower facade, 12 x 8 m per tile: two floors of ribbon windows (dark glass with a sky
 * reflection and mullions every 1.5 m) between concrete spandrels; a few windows lit.
 */
registerTexture('hr_tower', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#a8a49c', 0.05);
    for (let f = 0; f < 2; f++) {
      grain(g, R, 0, f * 16 + 5, w, 11, '#48566a', 0.06);
      g.fillStyle = 'rgba(150,170,190,.35)';
      g.fillRect(0, f * 16 + 5, w, 3);
      g.fillStyle = 'rgba(30,34,40,.8)';
      for (let x = 0; x < w; x += 4) g.fillRect(x, f * 16 + 5, 1, 11);
      if (R.rnd() > 0.6) {
        g.fillStyle = 'rgba(220,200,150,.85)';
        g.fillRect((R.rr(0, 7) | 0) * 4 + 1, f * 16 + 8, 3, 7);
      }
    }
  },
  photos: ['concrete'],
  photo: (c) =>
    c.fromPhoto('concrete', {
      filter: 'saturate(.15) brightness(1.15)',
      over: (g, w, h) => {
        for (let f = 0; f < 2; f++) {
          const y = (f * h) / 2 + h * 0.15;
          const hh = h * 0.33;
          const lg = g.createLinearGradient(0, y, 0, y + hh);
          lg.addColorStop(0, 'rgba(150,168,186,.95)');
          lg.addColorStop(0.35, 'rgba(76,90,108,.96)');
          lg.addColorStop(1, 'rgba(44,52,64,.97)');
          g.fillStyle = lg;
          g.fillRect(0, y, w, hh);
          g.fillStyle = 'rgba(24,26,30,.85)';
          for (let x = 0; x < w; x += w / 8) g.fillRect(x, y, 4, hh);
          for (let i = 0; i < 2; i++)
            if (c.rnd() > 0.5) {
              g.fillStyle = 'rgba(226,206,160,.85)';
              g.fillRect(((c.rr(0, 8) | 0) * w) / 8 + 6, y + hh * 0.2, w / 8 - 10, hh * 0.75);
            }
          g.fillStyle = 'rgba(40,38,34,.5)';
          g.fillRect(0, y + hh, w, 3);
        }
        streaks(g, c, w, 0, 12, h, 0.14, '60,56,50');
      },
    }),
});

/** The hazy afternoon: a warm overcast with the sun low behind brown haze (MW2's Highrise look). */
registerTexture('hr_skyHaze', {
  w: 256,
  h: 128,
  draw(g, _w, _h, R) {
    const lg = g.createLinearGradient(0, 0, 0, 128);
    for (const [o, c] of [[0, '#5e6670'], [0.25, '#8a8a84'], [0.45, '#c8b08a'], [0.53, '#d2b890'], [1, '#7a6a58']] as const) lg.addColorStop(o, c);
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 128);
    const sg = g.createRadialGradient(150, 54, 2, 150, 54, 46);
    sg.addColorStop(0, 'rgba(255,236,190,.95)');
    sg.addColorStop(0.25, 'rgba(250,210,150,.55)');
    sg.addColorStop(1, 'rgba(240,190,130,0)');
    g.fillStyle = sg;
    g.fillRect(0, 0, 256, 128);
    // Broken cloud decks, lit underneath towards the sun.
    for (let i = 0; i < 34; i++) {
      const x = R.rr(0, 256);
      const y = R.rr(8, 58);
      const w = R.rr(24, 76);
      const hh = R.rr(3, 9);
      const near = Math.abs(x + w / 2 - 150) < 50;
      for (const ox of [0, -256]) {
        g.fillStyle = `rgba(${near ? '250,226,186' : '120,112,104'},${R.rr(0.25, 0.55)})`;
        g.fillRect(x + ox, y, w, hh);
        g.fillStyle = 'rgba(70,64,60,.3)';
        g.fillRect(x + ox + 3, y + hh, w - 6, 2);
      }
    }
  },
  photo: 'sky',
});

/** Mi-8 olive drab, 2 x 2 m per tile: panel lines and exhaust soot. */
registerTexture('hr_heli', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#646648', 0.08);
    blotch(g, R, w, h, 5, '#4a4c34', 0.4, 3, 10);
    g.fillStyle = 'rgba(34,36,24,.6)';
    g.fillRect(0, 0, w, 1);
    g.fillRect(0, 0, 1, h);
    g.fillRect(w / 2, 0, 1, h / 2);
  },
  photos: ['rusty_painted_metal'],
  photo: (c) =>
    c.fromPhoto('rusty_painted_metal', {
      filter: 'grayscale(1) brightness(.85) contrast(.9)',
      over: (g, w, h) => {
        g.globalCompositeOperation = 'multiply';
        g.fillStyle = '#8a8c5c';
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = 'rgba(30,32,22,.6)';
        g.fillRect(0, 0, w, 3);
        g.fillRect(0, 0, 3, h);
        g.fillRect(w / 2, 0, 3, h / 2);
      },
    }),
});

/** Red star with a white rim (decal, transparent around it). */
registerTexture('hr_star', {
  w: 32,
  h: 32,
  wrap: false,
  posterize: false,
  draw(g, w, h) {
    g.clearRect(0, 0, w, h);
    const star = (r: number, fill: string) => {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.42 : r;
        g.lineTo(w / 2 + Math.cos(a) * rr, h / 2 + 1 + Math.sin(a) * rr);
      }
      g.closePath();
      g.fillStyle = fill;
      g.fill();
    };
    star(15, '#e8e4dc');
    star(12, '#b0241c');
  },
  photo: 'none',
});

/** Helipad marking: a yellow ring around a white H (decal, transparent around it). */
registerTexture('hr_hmark', {
  w: 64,
  h: 64,
  wrap: false,
  posterize: false,
  draw(g, w, h) {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#d8b030';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#e8e4d8';
    g.fillRect(20, 16, 6, 32);
    g.fillRect(38, 16, 6, 32);
    g.fillRect(20, 29, 24, 6);
  },
  photo: 'none',
});

/** Tower-crane lattice: yellow chords and diagonals, open between them (alpha cut-out). */
registerTexture('hr_lattice', {
  w: 32,
  h: 32,
  posterize: false,
  draw(g, w, h) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#c89a2a';
    g.fillRect(0, 0, w, 3);
    g.fillRect(0, h - 3, w, 3);
    g.fillRect(0, 0, 3, h);
    g.strokeStyle = '#b4881e';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(1, h - 1);
    g.lineTo(w - 1, 1);
    g.stroke();
    g.fillStyle = '#7a5c14';
    g.fillRect(0, h - 1, w, 1);
  },
  photo: 'none',
});

/** The giant KRIEGLER letters (the shipping company from CoD4 and MW2), on an open frame. */
registerTexture('hr_sign', {
  w: 128,
  h: 24,
  wrap: false,
  posterize: false,
  draw(g, w, h) {
    g.clearRect(0, 0, w, h);
    g.font = 'bold 22px "Arial Black", Arial, sans-serif';
    g.textAlign = 'center';
    g.fillStyle = '#5a1810';
    g.fillText('KRIEGLER', w / 2 + 1, h - 2);
    g.fillStyle = '#d8402a';
    g.fillText('KRIEGLER', w / 2, h - 3);
  },
  photo: 'none',
});

/** Green construction tarp on the fence, 3 x 2 m per tile: creases and grommets. */
registerTexture('hr_tarp', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#3e6a44', 0.1);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = 'rgba(20,40,24,.35)';
      g.fillRect(R.rr(0, w) | 0, 0, 1, h);
    }
    g.fillStyle = '#c8c8b8';
    for (let x = 2; x < w; x += 8) g.fillRect(x, 1, 1, 1);
  },
  photos: ['rough_linen'],
  photo: (c) =>
    c.fromPhoto('rough_linen', {
      filter: 'grayscale(1) contrast(1.2) brightness(.9)',
      over: (g, w, h) => {
        g.globalCompositeOperation = 'multiply';
        g.fillStyle = '#4e8a56';
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 9; i++) {
          const x = c.rr(0, w);
          const lg = g.createLinearGradient(x - 14, 0, x + 14, 0);
          lg.addColorStop(0, 'rgba(10,30,14,0)');
          lg.addColorStop(0.5, 'rgba(10,30,14,.35)');
          lg.addColorStop(1, 'rgba(10,30,14,0)');
          g.fillStyle = lg;
          g.fillRect(x - 14, 0, 28, h);
        }
        g.fillStyle = 'rgba(220,220,200,.9)';
        for (let x = 16; x < w; x += 64) g.fillRect(x, 6, 6, 6);
      },
    }),
});

/** Elevator doors in a steel frame (one decal per elevator). */
registerTexture('hr_elevator', {
  w: 32,
  h: 32,
  wrap: false,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#5a5e64', 0.04);
    grain(g, R, 3, 4, w - 6, h - 4, '#a8acb0', 0.05);
    g.fillStyle = '#4a4e54';
    g.fillRect(w / 2 - 1, 4, 1, h - 4);
    g.fillStyle = '#e8b040';
    g.fillRect(w / 2 - 3, 1, 6, 2);
  },
  photo: 'small',
});

/** "WKM" spray-paint tag (decal, transparent around it). */
registerTexture('hr_wkm', {
  w: 64,
  h: 32,
  wrap: false,
  posterize: false,
  draw(g, w, h) {
    g.clearRect(0, 0, w, h);
    g.font = 'italic bold 22px Arial, sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(30,30,40,.9)';
    g.strokeText('WKM', w / 2, h - 8);
    g.fillStyle = 'rgba(150,150,210,.95)';
    g.fillText('WKM', w / 2, h - 8);
  },
  photo: 'none',
});
