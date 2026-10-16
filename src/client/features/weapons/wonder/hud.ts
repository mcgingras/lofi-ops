/**
 * Wonder weapon HUD bits: frost creeping in from the screen edges while you are frosted (Winter's
 * Howl; heavier and crusted when frozen solid) with your look slowed to match the server's slow,
 * a chill when frost lands, and small killfeed icons for the four guns.
 */
import { frostSlow, WONDER_ENTITY } from '../../../../shared/defs/wonder';
import { sfx } from '../../../game/audio';
import type { Match } from '../../../game/match';
import { rect, txt, unit } from '../../../hud/draw';
import { registerHudWidget, registerKillfeedIcon, registerMatchHook } from '../../../registry';
import { currentMatch } from '../../../state';

/** My frost right now (0..1) from the frost entity that follows me. */
export function myFrost(m: Match): number {
  for (const e of m.net.lastSnap?.ents ?? []) if (e.kind === WONDER_ENTITY.frost && e.s?.p === m.myId) return typeof e.s.f === 'number' ? e.s.f : 0;
  return 0;
}

let shown = 0;
let lastFrost = 0;

registerMatchHook('weapons.wonderHud', {
  start() {
    shown = 0;
    lastFrost = 0;
  },
  frame(m, dt) {
    const f = m.alive ? myFrost(m) : 0;
    if (f > lastFrost + 0.05) sfx.play('weapons.wonder.chill', { volume: 0.9 });
    lastFrost = f;
    shown += (f - shown) * Math.min(1, dt * 8);
    if (f > 0) m.controls.lookScale *= frostSlow(f).turn;
  },
});

// Ordered 4x4 Bayer thresholds: the frost grows in with the look's crosshatch.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

registerHudWidget(
  'weapons.frost',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || shown < 0.02) return;
    const u = unit(H);
    const cell = 2 * u;
    const reach = Math.min(W, H) * (0.12 + 0.3 * shown);
    const cols = Math.ceil(W / cell);
    const rows = Math.ceil(H / cell);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const x = cx * cell;
        const y = cy * cell;
        const edge = Math.min(x, y, W - x, H - y);
        if (edge > reach) continue;
        // Denser toward the edge, with a frosty noise so the line isn't straight.
        const n = ((cx * 73856093) ^ (cy * 19349663)) >>> 0;
        const k = 1 - edge / reach + ((n % 100) / 100 - 0.5) * 0.35;
        const level = Math.max(0, Math.min(1, k * (0.6 + 0.6 * shown)));
        if (level * 16 <= BAYER[(cy % 4) * 4 + (cx % 4)]!) continue;
        rect(g, x, y, cell, cell, level > 0.75 ? '#f2fbff' : n % 3 === 0 ? '#bfe6f8' : '#8cc8e8');
      }
    }
    if (shown >= 0.95) txt(g, 'FROZEN', W / 2, H * 0.3, 8, '#bfe6f8', 'center', u);
  },
  12,
);

// Killfeed icons (10 x 5 pixel units): body colour plus the gun's tell-tale part.
const icon = (draw: (g: CanvasRenderingContext2D, x: number, y: number, u: number) => void) => (g: CanvasRenderingContext2D, x: number, y: number, u: number) => {
  const w = 12 * u;
  draw(g, x - w, y + u, u);
  return w;
};
registerKillfeedIcon('raygun', icon((g, x, y, u) => {
  rect(g, x + 3 * u, y + u, 6 * u, 3 * u, '#a8402a');
  rect(g, x + 4 * u, y, 4 * u, u, '#5cff4a');
  rect(g, x, y, 3 * u, 5 * u, '#d8dee6');
  rect(g, x + 7 * u, y + 4 * u, 2 * u, 3 * u, '#7a2a1c');
}));
registerKillfeedIcon('thundergun', icon((g, x, y, u) => {
  rect(g, x + 2 * u, y + u, 10 * u, 4 * u, '#4e5650');
  rect(g, x, y, 2 * u, 6 * u, '#c8783a');
  rect(g, x + 5 * u, y + u, u, 4 * u, '#c8783a');
  rect(g, x + 9 * u, y + 5 * u, 2 * u, 2 * u, '#7a5030');
}));
registerKillfeedIcon('wunderwaffe', icon((g, x, y, u) => {
  rect(g, x + 2 * u, y + 2 * u, 10 * u, 2 * u, '#c8783a');
  for (const b of [4, 6, 8]) rect(g, x + b * u, y, u, 2 * u, '#bff2ff');
  rect(g, x, y + 2 * u, 2 * u, u, '#9ae8ff');
  rect(g, x + 9 * u, y + 4 * u, 3 * u, 2 * u, '#7a5030');
}));
registerKillfeedIcon('wintershowl', icon((g, x, y, u) => {
  rect(g, x + 4 * u, y + u, 8 * u, 3 * u, '#d8dee6');
  rect(g, x, y, 4 * u, 5 * u, '#9cc4dc');
  rect(g, x + 5 * u, y + 4 * u, 4 * u, u, '#7ad8ff');
  rect(g, x + 9 * u, y + 4 * u, 2 * u, 3 * u, '#3a4048');
}));
