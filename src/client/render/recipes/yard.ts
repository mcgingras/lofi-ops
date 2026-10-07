/**
 * Texture recipes for the Yard (ids = MapData material textures, the prototype's `TX` keys) and its
 * three skies. Lo-fi bases are the prototype's `makeTex` drawings; photo looks are its `RECIPES`.
 * Other maps: add a file next to this one (auto-imported) that calls registerTexture for each id.
 */
import { blotch, col, dirtBottom, drips, grain, hex, stencil, stencilText, streaks, type Rand } from '../developer';
import { registerTexture, type PhotoCtx } from '../textures';

const PH = ['container_side', 'box_profile_metal_sheet', 'concrete_floor_worn_001', 'concrete', 'worn_corrugated_iron', 'rusty_metal_shutter', 'brown_planks_05', 'rusty_painted_metal', 'rusty_metal', 'blue_metal_plate'];

// ----- ground -----
registerTexture('ground', {
  w: 64,
  h: 64,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#77726b', 0.08);
    blotch(g, R, w, h, 16, '#3e3830', 0.35, 4, 16);
    blotch(g, R, w, h, 10, '#9a948a', 0.25, 3, 8);
    g.fillStyle = 'rgba(30,28,26,.7)';
    g.fillRect(0, 0, 64, 1);
    g.fillRect(0, 0, 1, 64);
    g.strokeStyle = 'rgba(20,18,16,.3)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(70, 70, 40, 3.3, 4.6);
    g.stroke();
    g.beginPath();
    g.arc(74, 66, 40, 3.3, 4.6);
    g.stroke();
    let x = R.rr(10, 50);
    let y = R.rr(10, 50);
    g.fillStyle = 'rgba(25,22,20,.6)';
    for (let i = 0; i < 30; i++) {
      g.fillRect(x | 0, y | 0, 1, 1);
      x += R.rr(-1, 1.6);
      y += R.rr(-1, 1.6);
    }
  },
  photos: ['concrete_floor_worn_001'],
  photo: (c) =>
    c.fromPhoto('concrete_floor_worn_001', {
      filter: 'contrast(1.15)',
      over: (g, w, h) => {
        g.filter = 'blur(7px)';
        for (let i = 0; i < 9; i++) {
          g.fillStyle = `rgba(36,30,24,${c.rr(0.12, 0.32)})`;
          g.beginPath();
          g.ellipse(c.rr(60, 452), c.rr(60, 452), c.rr(20, 70), c.rr(10, 40), c.rr(0, 3), 0, 7);
          g.fill();
        }
        g.filter = 'none';
        g.fillStyle = 'rgba(28,26,24,.7)';
        g.fillRect(0, 0, w, 3);
        g.fillRect(0, 0, 3, h);
        g.strokeStyle = 'rgba(24,22,20,.5)';
        g.lineWidth = 1.5;
        for (let k = 0; k < 3; k++) {
          g.beginPath();
          let x = c.rr(60, 450);
          let y = c.rr(60, 450);
          g.moveTo(x, y);
          for (let i = 0; i < 26; i++) {
            x += c.rr(-6, 9);
            y += c.rr(-6, 9);
            g.lineTo(x, y);
          }
          g.stroke();
        }
        g.filter = 'blur(3px)';
        g.strokeStyle = 'rgba(20,18,16,.2)';
        g.lineWidth = 16;
        g.beginPath();
        g.arc(560, 560, 330, 3.3, 4.6);
        g.stroke();
        g.beginPath();
        g.arc(592, 532, 330, 3.3, 4.6);
        g.stroke();
        g.filter = 'none';
      },
    }),
});

// ----- buildings -----
registerTexture('warehouse', {
  w: 64,
  h: 128,
  draw(g, _w, _h, R) {
    grain(g, R, 0, 0, 64, 128, '#c4b89e', 0.05);
    g.fillStyle = 'rgba(60,50,40,.3)';
    for (let y = 0; y < 128; y += 8) {
      g.fillRect(0, y, 64, 1);
      for (let x = ((y / 8) % 2) * 8; x < 64; x += 16) g.fillRect(x, y, 1, 8);
    }
    streaks(g, R, 64, 0, 18, 70, 0.3, '50,44,38');
    grain(g, R, 0, 109, 64, 19, '#3d5a47', 0.07);
    g.fillStyle = '#26362c';
    g.fillRect(0, 108, 64, 2);
    for (let y = 118; y < 128; y++) {
      g.fillStyle = `rgba(20,18,14,${((y - 118) / 10) * 0.5})`;
      g.fillRect(0, y, 64, 1);
    }
  },
  photos: ['concrete'],
  photo: (c) =>
    c.fromPhoto('concrete', {
      w: 512,
      h: 1280,
      filter: 'brightness(1.05)',
      over: (g, w, h) => {
        g.globalCompositeOperation = 'multiply';
        g.fillStyle = '#6f9278';
        g.fillRect(0, h * 0.885, w, h * 0.115);
        g.fillStyle = '#4a5a50';
        g.fillRect(0, h * 0.875, w, h * 0.012);
        g.globalCompositeOperation = 'source-over';
        g.filter = 'blur(3px)';
        for (let i = 0; i < 18; i++) {
          const x = c.rr(0, w);
          const L = c.rr(80, 600);
          const lg = g.createLinearGradient(0, 0, 0, L);
          lg.addColorStop(0, 'rgba(40,36,30,.35)');
          lg.addColorStop(1, 'rgba(40,36,30,0)');
          g.fillStyle = lg;
          g.fillRect(x, 0, c.rr(4, 14), L);
        }
        g.filter = 'none';
        dirtBottom(g, w, h, 0.92, 0.5);
      },
    }),
});

registerTexture('shed', {
  w: 64,
  h: 64,
  draw(g, _w, _h, R) {
    for (let x = 0; x < 64; x++)
      for (let y = 0; y < 64; y++) {
        g.fillStyle = col(hex('#6f7f8c'), (0.72 + 0.28 * Math.sin((x / 64) * Math.PI * 16)) * R.rr(0.94, 1.05));
        g.fillRect(x, y, 1, 1);
      }
    streaks(g, R, 64, 0, 16, 40, 0.4);
    for (let y = 50; y < 64; y++) {
      g.fillStyle = `rgba(30,26,22,${((y - 50) / 14) * 0.5})`;
      g.fillRect(0, y, 64, 1);
    }
  },
  photos: ['worn_corrugated_iron'],
  photo: (c) => c.fromPhoto('worn_corrugated_iron', { filter: 'saturate(.8)', over: (g, w, h) => dirtBottom(g, w, h, 0.7, 0.5) }),
});

registerTexture('shutter', {
  w: 64,
  h: 64,
  wrap: false,
  draw(g, _w, _h, R) {
    for (let y = 0; y < 64; y++) {
      const k = 0.78 + 0.22 * Math.sin((y / 64) * Math.PI * 32);
      grain(g, R, 0, y, 64, 1, '#959ba1', 0.04);
      g.fillStyle = `rgba(0,0,0,${(1 - k) * 0.9})`;
      g.fillRect(0, y, 64, 1);
    }
    streaks(g, R, 64, 0, 10, 50, 0.35);
    g.fillStyle = '#2a2a2a';
    g.fillRect(0, 0, 3, 64);
    g.fillRect(61, 0, 3, 64);
    g.fillRect(28, 56, 8, 3);
  },
  photos: ['rusty_metal_shutter'],
  photo: (c) =>
    c.fromPhoto('rusty_metal_shutter', {
      over: (g, w, h) => {
        g.fillStyle = 'rgba(22,22,22,.9)';
        g.fillRect(0, 0, w * 0.04, h);
        g.fillRect(w * 0.96, 0, w * 0.04, h);
        g.fillRect(w * 0.44, h * 0.88, w * 0.12, h * 0.04);
        dirtBottom(g, w, h, 0.75, 0.45);
      },
    }),
});

registerTexture('hazard', {
  w: 32,
  h: 32,
  draw(g, _w, _h, R) {
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        g.fillStyle = col(hex(((x + y) >> 3) & 1 ? '#e9b82c' : '#1d1a17'), R.rr(0.85, 1.1));
        g.fillRect(x, y, 1, 1);
      }
    blotch(g, R, 32, 32, 8, '#3a3630', 0.6, 2, 5);
  },
});

registerTexture('paint', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#d9a72a', 0.1);
    g.clearRect(R.rr(0, 16) | 0, R.rr(0, 16) | 0, 2, 1);
    g.clearRect(R.rr(0, 16) | 0, R.rr(0, 16) | 0, 1, 2);
    g.clearRect(R.rr(0, 16) | 0, R.rr(0, 16) | 0, 2, 2);
  },
  photo: 'small',
});

registerTexture('steel', {
  w: 32,
  h: 32,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#5a5e64', 0.12);
    g.fillStyle = '#7a7f88';
    for (let i = 0; i < 4; i++) g.fillRect(0, R.rr(0, 32) | 0, 32, 1);
    blotch(g, R, w, h, 6, '#6a3a1a', 0.4, 2, 5);
  },
  photos: ['blue_metal_plate'],
  photo: (c) => c.fromPhoto('blue_metal_plate', { filter: 'saturate(.2) brightness(1.05)' }),
});

registerTexture('lamp', { w: 8, h: 8, draw: (g, w, h, R) => grain(g, R, 0, 0, w, h, '#ffe2a8', 0.03), photo: 'none' });

for (const n of ['01', '02', '03']) {
  registerTexture(`num${n}`, {
    w: 32,
    h: 32,
    wrap: false,
    draw(g, _w, _h, R) {
      g.font = 'bold 26px "Courier New",monospace';
      g.textAlign = 'center';
      g.fillStyle = '#e8e2d0';
      g.fillText(n, 16, 26);
      for (let i = 0; i < 40; i++) g.clearRect(R.rr(0, 32) | 0, R.rr(0, 32) | 0, 1, 1);
    },
    photo: 'small',
  });
}

registerTexture('winRow', {
  w: 16,
  h: 8,
  wrap: false,
  draw(g) {
    g.fillStyle = '#2a2420';
    g.fillRect(0, 0, 16, 8);
    g.fillStyle = '#ffb45a';
    g.fillRect(1, 1, 6, 6);
    g.fillRect(9, 1, 6, 6);
    g.fillStyle = '#c47a30';
    g.fillRect(1, 5, 6, 2);
  },
});

registerTexture('door', {
  w: 16,
  h: 32,
  wrap: false,
  draw(g, _w, _h, R) {
    grain(g, R, 0, 0, 16, 32, '#3d5a47', 0.06);
    g.fillStyle = '#26362c';
    g.fillRect(0, 0, 16, 1);
    g.fillRect(0, 0, 1, 32);
    g.fillRect(15, 0, 1, 32);
    g.fillStyle = '#c8c0a8';
    g.fillRect(12, 16, 2, 2);
  },
  photos: ['blue_metal_plate'],
  photo: (c) =>
    c.fromPhoto('blue_metal_plate', {
      w: 256,
      h: 512,
      tile: 256,
      filter: 'hue-rotate(-70deg) saturate(.6) brightness(.8)',
      over: (g, w, h) => {
        g.fillStyle = '#d8d0b8';
        g.fillRect(w * 0.75, h * 0.5, 12, 12);
      },
    }),
});

registerTexture('exit', {
  w: 32,
  h: 16,
  wrap: false,
  draw(g) {
    g.fillStyle = '#0f5a2a';
    g.fillRect(0, 0, 32, 16);
    g.fillStyle = '#d8ffd8';
    g.font = 'bold 9px "Courier New",monospace';
    g.textAlign = 'center';
    g.fillText('EXIT', 16, 12);
  },
});

registerTexture('fence', {
  w: 32,
  h: 32,
  posterize: false,
  draw(g) {
    g.fillStyle = '#b8b2a6';
    for (let i = 0; i < 32; i++) {
      g.fillRect(i, i, 1, 1);
      g.fillRect((i + 16) % 32, i, 1, 1);
      g.fillRect(31 - i, i, 1, 1);
      g.fillRect((47 - i) % 32, i, 1, 1);
    }
  },
  photo: 'none',
});

registerTexture('hut', {
  w: 32,
  h: 32,
  draw(g, _w, _h, R) {
    for (let x = 0; x < 32; x++)
      for (let y = 0; y < 32; y++) {
        g.fillStyle = col(hex('#d8d2c2'), (0.82 + 0.18 * Math.sin((x / 32) * Math.PI * 8)) * R.rr(0.95, 1.05));
        g.fillRect(x, y, 1, 1);
      }
    streaks(g, R, 32, 0, 6, 20, 0.35);
  },
  photos: ['worn_corrugated_iron'],
  photo: (c) => c.fromPhoto('worn_corrugated_iron', { filter: 'brightness(1.4) saturate(.5)' }),
});

registerTexture('hutWin', {
  w: 16,
  h: 16,
  wrap: false,
  draw(g) {
    g.fillStyle = '#20262c';
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#cfe6ff';
    g.fillRect(1, 1, 14, 9);
    g.fillStyle = '#8fb0d0';
    g.fillRect(1, 7, 14, 3);
    g.fillStyle = '#20262c';
    g.fillRect(7, 1, 2, 9);
    g.fillStyle = '#4a3a2a';
    g.fillRect(3, 6, 4, 2);
  },
});

// ----- props -----
registerTexture('tank', {
  w: 64,
  h: 32,
  draw(g, _w, _h, R) {
    grain(g, R, 0, 0, 64, 32, '#d8d4c8', 0.05);
    g.fillStyle = '#2f5a8a';
    g.fillRect(0, 13, 64, 5);
    streaks(g, R, 64, 0, 16, 20, 0.45);
    stencil(g, 'DIESEL', 18, 11, 8, '#2a2a2a');
    stencil(g, 'NO SMOKING', 14, 28, 6, '#a02020');
  },
  photos: ['rusty_painted_metal'],
  photo: (c) =>
    c.fromPhoto('rusty_painted_metal', {
      w: 1024,
      h: 512,
      filter: 'saturate(.1) brightness(1.6)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(40,80,140,.85)';
        g.fillRect(0, h * 0.4, w, h * 0.15);
        stencilText(g, ['DIESEL', 'NO SMOKING · NO NAKED FLAME'], w * 0.3, h * 0.33, [60, 26], 'rgba(30,30,30,.85)');
      },
    }),
});

registerTexture('yellow', {
  w: 16,
  h: 16,
  draw(g, w, h, R) {
    grain(g, R, 0, 0, w, h, '#e0a82a', 0.08);
    blotch(g, R, w, h, 4, '#3a2a10', 0.5, 1, 4);
  },
  photos: ['rusty_metal'],
  photo: (c) => c.fromPhoto('rusty_metal', { filter: 'hue-rotate(12deg) saturate(1.15) brightness(1.15)' }),
});

registerTexture('crate', {
  w: 32,
  h: 32,
  draw(g, _w, _h, R) {
    grain(g, R, 0, 0, 32, 32, '#a67c4e', 0.09);
    g.fillStyle = '#6a4628';
    g.fillRect(0, 0, 32, 3);
    g.fillRect(0, 29, 32, 3);
    g.fillRect(0, 0, 3, 32);
    g.fillRect(29, 0, 3, 32);
    for (let i = 3; i < 27; i++) g.fillRect(i, i, 3, 3);
    g.fillStyle = 'rgba(30,20,10,.5)';
    g.fillRect(8, 12, 12, 1);
    stencil(g, 'FRAGILE', 5, 22, 6, 'rgba(40,24,12,.7)');
  },
  photos: ['brown_planks_05'],
  photo: (c) =>
    c.fromPhoto('brown_planks_05', {
      filter: 'sepia(.7) saturate(1.5) brightness(.85)',
      over: (g, w, h) => {
        g.globalCompositeOperation = 'multiply';
        g.fillStyle = '#8a6a4a';
        const b = w * 0.1;
        g.fillRect(0, 0, w, b);
        g.fillRect(0, h - b, w, b);
        g.fillRect(0, 0, b, h);
        g.fillRect(w - b, 0, b, h);
        g.save();
        g.translate(w / 2, h / 2);
        g.rotate(Math.PI / 4);
        g.fillRect(-w * 0.66, -b / 2, w * 1.32, b);
        g.restore();
        g.globalCompositeOperation = 'source-over';
        stencilText(g, ['FRAGILE'], w * 0.3, h * 0.72, [34], 'rgba(40,24,12,.75)');
      },
    }),
});

registerTexture('pallet', {
  w: 32,
  h: 16,
  draw(g, _w, _h, R) {
    g.fillStyle = '#2a2018';
    g.fillRect(0, 0, 32, 16);
    for (let x = 0; x < 32; x += 8) grain(g, R, x, 0, 6, 16, '#b08a5a', 0.1);
    grain(g, R, 0, 6, 32, 4, '#9a7448', 0.1);
  },
  photos: ['brown_planks_05'],
  photo: (c) => c.fromPhoto('brown_planks_05', { filter: 'sepia(.5) saturate(1.3) brightness(.95)', w: 512, h: 256, tile: 256 }),
});

registerTexture('barrel', {
  w: 32,
  h: 32,
  draw(g, _w, _h, R) {
    grain(g, R, 0, 0, 32, 32, '#d4d4d4', 0.06);
    g.fillStyle = '#3a3a3a';
    g.fillRect(0, 5, 32, 2);
    g.fillRect(0, 25, 32, 2);
    blotch(g, R, 32, 32, 8, '#6a3a1a', 0.55, 2, 6);
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.fillRect(10, 12, 12, 8);
    g.fillStyle = '#b02020';
    g.fillRect(14, 13, 4, 6);
  },
  photos: ['rusty_painted_metal'],
  photo: (c) =>
    c.fromPhoto('rusty_painted_metal', {
      filter: 'saturate(.15) brightness(1.45)',
      over: (g, w, h) => {
        g.fillStyle = 'rgba(40,40,40,.85)';
        g.fillRect(0, h * 0.17, w, h * 0.05);
        g.fillRect(0, h * 0.78, w, h * 0.05);
      },
    }),
});

registerTexture('barrier', {
  w: 32,
  h: 16,
  draw(g, _w, _h, R) {
    grain(g, R, 0, 0, 32, 16, '#a9a49b', 0.08);
    for (let x = 0; x < 32; x++) {
      g.fillStyle = (x >> 2) % 2 ? '#c8352a' : '#eeeae0';
      g.fillRect(x, 2, 1, 3);
    }
    blotch(g, R, 32, 16, 6, '#4a443c', 0.4, 1, 4);
  },
  photos: ['concrete'],
  photo: (c) =>
    c.fromPhoto('concrete', {
      w: 512,
      h: 256,
      tile: 256,
      over: (g, w, h) => {
        for (let x = 0; x < w; x += 64) {
          g.fillStyle = (x / 64) % 2 ? 'rgba(200,52,40,.85)' : 'rgba(238,234,224,.85)';
          g.fillRect(x, h * 0.12, 64, h * 0.2);
        }
        dirtBottom(g, w, h, 0.6, 0.5);
      },
    }),
});

// ----- shipping containers -----
const CONTAINER_SPECS: [string, string][] = [['#a6402f', 'MSKU 402118'], ['#2f5a8a', 'TGHU 773045'], ['#3d7a4a', 'CAIU 118302'], ['#c9772f', 'HLXU 650921'], ['#2f6a6a', 'SEGU 290455'], ['#6a4a7a', 'TRLU 884210']];
const CONTAINER_LOOK: [string, string][] = [['box_profile_metal_sheet', 'saturate(.9) brightness(.92)'], ['container_side', 'hue-rotate(95deg) saturate(.9) brightness(.85)'], ['container_side', 'brightness(.85)'], ['box_profile_metal_sheet', 'hue-rotate(22deg) saturate(1.1) brightness(1.15)'], ['container_side', 'hue-rotate(48deg) saturate(.8) brightness(.78)'], ['box_profile_metal_sheet', 'hue-rotate(-70deg) saturate(.55) brightness(.9)']];

function containerBase(base: string, label: string) {
  return (g: CanvasRenderingContext2D, _w: number, _h: number, R: Rand) => {
    const b = hex(base);
    for (let x = 0; x < 128; x++) {
      const rib = Math.sin((x / 128) * Math.PI * 40);
      const k = 0.74 + 0.2 * rib + (rib > 0.92 ? 0.14 : 0);
      for (let y = 0; y < 64; y++) {
        g.fillStyle = col(b, k * R.rr(0.93, 1.06));
        g.fillRect(x, y, 1, 1);
      }
    }
    g.fillStyle = col(b, 0.5);
    g.fillRect(0, 0, 128, 3);
    g.fillRect(0, 59, 128, 5);
    g.fillRect(0, 0, 3, 64);
    g.fillRect(125, 0, 3, 64);
    g.fillStyle = col(b, 1.3);
    g.fillRect(0, 3, 128, 1);
    streaks(g, R, 128, 3, 34, 34, 0.55);
    blotch(g, R, 128, 64, 8, '#000000', 0.2, 3, 9);
    for (let y = 42; y < 59; y++) {
      g.fillStyle = `rgba(28,20,14,${((y - 42) / 17) * 0.55})`;
      g.fillRect(0, y, 128, 1);
    }
    stencil(g, label, 8, 14, 8, 'rgba(240,236,226,.92)');
    stencil(g, '22G1   MGW 30480', 8, 22, 6, 'rgba(240,236,226,.8)');
  };
}

/** Drawn container photo when the Poly Haven photos are missing (prototype containerPhoto). */
function containerDrawn(c: PhotoCtx, base: string, label: string) {
  const W = 512;
  const H = 256;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const b = hex(base);
  for (let x = 0; x < W; x++) {
    const ph = ((x / W) * 20) % 1;
    const k = 0.7 + 0.22 * Math.sin(ph * Math.PI * 2) + (ph > 0.18 && ph < 0.3 ? 0.14 : 0);
    g.fillStyle = col(b, k);
    g.fillRect(x, 0, 1, H);
  }
  g.fillStyle = col(b, 0.48);
  g.fillRect(0, 0, W, 12);
  g.fillRect(0, H - 18, W, 18);
  g.fillRect(0, 0, 12, H);
  g.fillRect(W - 12, 0, 12, H);
  g.fillStyle = col(b, 1.3);
  g.fillRect(0, 12, W, 3);
  drips(g, c, W, 14, 46, 130, 0.65);
  dirtBottom(g, W, H, 0.55, 0.6);
  g.fillStyle = 'rgba(240,236,226,.92)';
  g.font = 'bold 30px "Courier New",monospace';
  g.fillText(label, 32, 54);
  g.font = 'bold 15px "Courier New",monospace';
  g.fillText('22G1    MAX GROSS 30,480 KG', 32, 78);
  g.fillText('TARE 2,220 KG   CU.CAP 33.2 M3', 32, 96);
  return c.photoify(cv, { noise: 0.9 });
}

CONTAINER_SPECS.forEach(([color, label], i) => {
  const [photo, filter] = CONTAINER_LOOK[i]!;
  registerTexture(`container${i}`, {
    w: 128,
    h: 64,
    draw: containerBase(color, label),
    photos: [photo],
    photo: (c) =>
      c.fromPhoto(photo, {
        w: 1024,
        h: 436,
        tile: 436,
        filter,
        over: (g, w, h) => {
          g.fillStyle = 'rgba(0,0,0,.45)';
          g.fillRect(0, 0, w, 14);
          g.fillRect(0, h - 22, w, 22);
          g.fillRect(0, 0, 14, h);
          g.fillRect(w - 14, 0, 14, h);
          drips(g, c, w, 16, 60, 170);
          dirtBottom(g, w, h);
          stencilText(g, [label, '22G1    MAX GROSS 30,480 KG', 'TARE 2,220 KG   CU.CAP 33.2 M3'], 52, 78, [44, 20, 20]);
        },
      }),
    fallback: (c) => containerDrawn(c, color, label),
  });
});

// ----- skies (1024x512 dome, the lo-fi one drawn at 256x128 and scaled) -----
registerTexture('skyNight', {
  w: 1024,
  h: 512,
  draw(g, _w, _h, R) {
    g.scale(4, 4);
    const lg = g.createLinearGradient(0, 0, 0, 128);
    for (const [o, c] of [[0, '#04050c'], [0.42, '#0e1226'], [0.5, '#1c2240'], [0.53, '#141a30'], [1, '#0a0c16']] as const) lg.addColorStop(o, c);
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 420; i++) {
      g.fillStyle = `rgba(230,235,255,${R.rr(0.2, 0.8)})`;
      g.fillRect((R.rr(0, 1024) | 0) / 4, (R.rr(0, 230) | 0) / 4, 0.25, 0.25);
    }
    g.fillStyle = 'rgba(180,200,255,.18)';
    g.beginPath();
    g.arc(70, 30, 12, 0, 7);
    g.fill();
    g.fillStyle = '#e8ecf8';
    g.beginPath();
    g.arc(70, 30, 5, 0, 7);
    g.fill();
    for (let i = 0; i < 12; i++) {
      g.fillStyle = 'rgba(30,36,64,.7)';
      const x = R.rr(0, 256);
      const y = R.rr(30, 60);
      g.fillRect(x, y, R.rr(20, 60), 2);
      g.fillRect(x - 256, y, 40, 2);
    }
  },
  photo: 'sky',
});

registerTexture('skyGrey', {
  w: 256,
  h: 128,
  draw(g, _w, _h, R) {
    const lg = g.createLinearGradient(0, 0, 0, 128);
    for (const [o, c] of [[0, '#5d636c'], [0.45, '#959aa1'], [0.5, '#aeb2b6'], [0.53, '#a2a6aa'], [1, '#8a8e93']] as const) lg.addColorStop(o, c);
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 40; i++) {
      const x = R.rr(0, 256);
      const y = R.rr(8, 60);
      const w = R.rr(20, 70);
      const h = R.rr(3, 8);
      for (const ox of [0, -256]) {
        g.fillStyle = `rgba(${R.rnd() > 0.5 ? '200,204,210' : '80,86,94'},${R.rr(0.15, 0.35)})`;
        g.fillRect(x + ox, y, w, h);
      }
    }
  },
  photo: 'sky',
});

registerTexture('skyDusk', {
  w: 256,
  h: 128,
  draw(g, _w, _h, R) {
    const lg = g.createLinearGradient(0, 0, 0, 128);
    for (const [o, c] of [[0, '#1b1540'], [0.28, '#4a2a63'], [0.42, '#b2506a'], [0.5, '#ff9a52'], [0.53, '#e07a4c'], [1, '#5b3346']] as const) lg.addColorStop(o, c);
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = 'rgba(255,210,140,.35)';
    g.beginPath();
    g.arc(190, 58, 18, 0, 7);
    g.fill();
    g.fillStyle = '#ffd690';
    g.beginPath();
    g.arc(190, 58, 9, 0, 7);
    g.fill();
    for (let i = 0; i < 22; i++) {
      g.fillStyle = `rgba(110,48,88,${R.rr(0.5, 0.85)})`;
      const x = R.rr(0, 256);
      const y = R.rr(34, 60);
      g.fillRect(x, y, R.rr(20, 80), R.rr(1, 3) | 0);
      g.fillRect(x - 256, y, 60, 2);
    }
  },
  photo: 'sky',
});

export const YARD_PHOTOS = PH;
