/**
 * Wonder weapon HUD bits: frost creeping in from the screen edges while you are frosted (Winter's
 * Howl; heavier and crusted when frozen solid, "FROZEN") with your look slowed to match the
 * server's slow (frozen: no turning at all), a chill when frost lands; "STUCK" and a red pulse
 * when a Scavenger bolt is in you; a pink edge, "SHRUNK" and the countdown while the Baby Gun has
 * you (your shots squeak); a red heat edge while the Wave Gun swells you; and small killfeed
 * icons for the seven guns.
 */
import { frostSlow, WAVE_GUN, WONDER_ENTITY } from '../../../../shared/defs/wonder';
import { sfx } from '../../../game/audio';
import type { Match } from '../../../game/match';
import { rect, txt, unit } from '../../../hud/draw';
import { registerHudWidget, registerKillfeedIcon, registerMatchHook } from '../../../registry';
import { currentMatch } from '../../../state';

/** The status effect entity of `kind` riding me (its `s`), or null. */
export function myEffect(m: Match, kind: string): Record<string, unknown> | null {
  for (const e of m.net.lastSnap?.ents ?? []) if (e.kind === kind && e.s?.p === m.myId) return e.s;
  return null;
}

/** My frost right now (0..1) from the frost entity that follows me. */
export function myFrost(m: Match): number {
  for (const e of m.net.lastSnap?.ents ?? []) if (e.kind === WONDER_ENTITY.frost && e.s?.p === m.myId) return typeof e.s.f === 'number' ? e.s.f : 0;
  return 0;
}

let shown = 0;
let lastFrost = 0;
let triggerWas = false;

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
    // Shrunk: my own shots come out as squeaks too.
    const trig = m.controls.triggerHeld;
    if (trig && !triggerWas && m.alive && myEffect(m, WONDER_ENTITY.shrunk)) sfx.play('weapons.wonder.squeak', { volume: 0.8 });
    triggerWas = trig;
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

/** A dithered coloured edge `reach` deep (fraction of the short side), strength 0..1. */
function edge(g: CanvasRenderingContext2D, W: number, H: number, u: number, reach: number, k: number, colors: readonly string[]): void {
  const cell = 3 * u;
  const depth = Math.min(W, H) * reach;
  const cols = Math.ceil(W / cell);
  const rows = Math.ceil(H / cell);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = cx * cell;
      const y = cy * cell;
      const e = Math.min(x, y, W - x, H - y);
      if (e > depth) continue;
      const level = (1 - e / depth) * k;
      if (level * 16 <= BAYER[(cy % 4) * 4 + (cx % 4)]!) continue;
      rect(g, x, y, cell, cell, colors[(cx + cy) % colors.length]!);
    }
  }
}

registerHudWidget(
  'weapons.wonderStatus',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || !m.alive) return;
    const u = unit(H);
    const now = m.serverTime;
    const stuck = myEffect(m, WONDER_ENTITY.scav);
    if (stuck && stuck.k === 1) {
      const pulse = Math.floor(now * 8) % 2 === 0;
      edge(g, W, H, u, 0.14, pulse ? 0.9 : 0.5, ['#ff3a2a', '#a01810']);
      txt(g, 'STUCK!', W / 2, H * 0.3, 10, pulse ? '#ff5a3a' : '#ffd0b0', 'center', u);
    }
    const shrunk = myEffect(m, WONDER_ENTITY.shrunk);
    if (shrunk) {
      edge(g, W, H, u, 0.1, 0.6, ['#ff6ae0', '#a03a90']);
      const left = Math.max(0, (typeof shrunk.u === 'number' ? shrunk.u : now) - now);
      txt(g, `SHRUNK ${left.toFixed(1)}`, W / 2, H * 0.3, 7, '#ff9aec', 'center', u);
    }
    const swell = myEffect(m, WONDER_ENTITY.swell);
    if (swell) {
      const t = typeof swell.t === 'number' ? swell.t : now;
      const k = Math.max(0, Math.min(1, 1 - (t - now) / WAVE_GUN.wave.swellSec));
      edge(g, W, H, u, 0.12 + 0.3 * k, 0.5 + 0.5 * k, ['#ff7a3a', '#b02018']);
    }
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
registerKillfeedIcon('scavenger', icon((g, x, y, u) => {
  rect(g, x, y + u, 12 * u, 2 * u, '#2e3328');
  rect(g, x + 4 * u, y - u, 5 * u, 2 * u, '#2e3328');
  rect(g, x, y + u, u, 2 * u, '#ff3a2a');
  rect(g, x + 9 * u, y + 3 * u, 3 * u, 2 * u, '#2e3328');
}));
registerKillfeedIcon('babygun', icon((g, x, y, u) => {
  rect(g, x + 3 * u, y + u, 8 * u, 3 * u, '#d8ccaa');
  rect(g, x + 5 * u, y - u, 4 * u, 2 * u, '#ff6ae0');
  rect(g, x, y, 3 * u, 5 * u, '#c8783a');
  rect(g, x + 8 * u, y + 4 * u, 2 * u, 3 * u, '#d8ccaa');
}));
registerKillfeedIcon('wavegun', icon((g, x, y, u) => {
  rect(g, x + 2 * u, y, 6 * u, 2 * u, '#2a3646');
  rect(g, x + 2 * u, y + 3 * u, 6 * u, 2 * u, '#2a3646');
  rect(g, x, y, 2 * u, 5 * u, '#4ab4ff');
  rect(g, x + 7 * u, y + 2 * u, 2 * u, 4 * u, '#2a3646');
  rect(g, x + 10 * u, y + 2 * u, 2 * u, 4 * u, '#2a3646');
}));
