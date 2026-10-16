/**
 * Client side of the 'zombies' feature area (owner: zombies). See docs/features/zombies.md.
 *
 * - store.ts: `zombies.state` / `zombies.event`, banners, point popups, stingers;
 * - hud.ts: the round tally, points, perks, power-up timers, prompts, downs, game over, core wraps;
 * - props.ts: wall-buys, Perk-a-Cola machines, the Mystery Box, box spots, power-ups;
 * - look.ts: zombie soldiers (and hellhounds), their animation and groans;
 * - sounds.ts: every Zombies sound (synthesized, original);
 * - screen.ts: the menu entry, the Zombies screen and the game-over results.
 * Here: the atmosphere (the map's Zombies time preset: dusk or night; hellhound rounds draw the fog
 * in close and turn it a burning orange).
 */
import type { TimePreset } from '../../../shared/maps/types';
import { zombiesLayer } from '../../../shared/maps/zombies/index';
import { registerMatchHook } from '../../registry';
import { applyTimeUniforms } from '../../render/mapbuilder';
import './sounds';
import './store';
import './props';
import './look';
import './hud';
import './screen';
import { isZombiesMatch, zm } from './store';

const DOG_FOG: [number, number, number] = [0.62, 0.2, 0.08];
let dogK = 0;
let applied = -1;
let base: TimePreset | null = null;

const mix = (a: number, b: number, k: number) => a + (b - a) * k;

function tinted(T: TimePreset, k: number): TimePreset {
  return {
    ...T,
    fog: [mix(T.fog[0], DOG_FOG[0], k * 0.85), mix(T.fog[1], DOG_FOG[1], k * 0.85), mix(T.fog[2], DOG_FOG[2], k * 0.85)],
    fogNear: mix(T.fogNear, 6, k),
    fogFar: mix(T.fogFar, Math.min(T.fogFar, 60), k),
    amb: [mix(T.amb[0], T.amb[0] * 1.25, k), mix(T.amb[1], T.amb[1] * 0.7, k), mix(T.amb[2], T.amb[2] * 0.6, k)],
  };
}

registerMatchHook('zombies.atmosphere', {
  start(m) {
    dogK = 0;
    applied = -1;
    base = null;
    if (!isZombiesMatch(m) || !m.map) return;
    const layer = zombiesLayer(m.joined.map);
    if (layer && m.map.map.times.some((t) => t.id === layer.time) && m.map.time.id !== layer.time) void m.setTime(layer.time);
    return () => {
      if (base) applyTimeUniforms(base);
      base = null;
    };
  },
  frame(m, dt) {
    if (!isZombiesMatch(m) || !m.map) return;
    const st = zm.state;
    const want = st && st.dogRound && (st.phase === 'active' || st.phase === 'over') ? 1 : 0;
    dogK += (want - dogK) * Math.min(1, dt * 0.8);
    if (Math.abs(dogK - want) < 0.005) dogK = want;
    const T = m.map.time;
    if (base?.id !== T.id) {
      base = T;
      applied = -1;
    }
    if (Math.abs(dogK - applied) > 0.01 || (dogK === 0 && applied > 0)) {
      applied = dogK;
      applyTimeUniforms(dogK > 0 ? tinted(T, dogK) : T);
    }
  },
});
