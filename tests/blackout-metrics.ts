/**
 * Bot behaviour metrics over a Blackout match (scripts/blackout-sim.ts and tests/blackout-bots.test.ts):
 * how ground bot-time is spent (idle, stuck, standing still, per goal kind) and deaths by cause.
 * Call `sample()` after every room step; it samples each bot every 0.5 s.
 */
import { BlackoutBrain } from '../src/server/features/blackout/brain';
import { bx } from '../src/server/features/blackout/state';
import type { BlackoutHarness } from './blackout-harness';

/** Goal kinds that mean "nothing to do" (the old brain's random roam point). */
const AIMLESS = new Set(['roam']);
/** Goal kinds where standing still is the point. */
const HOLDING = new Set(['camp', 'hold', 'heal']);

export interface SimReport {
  samples: number;
  idle: number;
  stuck: number;
  still: number;
  kinds: Record<string, number>;
  causes: Record<string, number>;
}

export function simMetrics(h: BlackoutHarness, every = 0.5, window = 2) {
  const causes: Record<string, number> = {};
  h.room.bus.on('death', (e) => {
    const k = e.means === 'storm' ? 'circle' : e.weapon === 'knife' ? 'knife' : 'gun';
    causes[k] = (causes[k] ?? 0) + 1;
  });
  const trail = new Map<string, { x: number; z: number; t: number }[]>();
  const kinds: Record<string, number> = {};
  let next = 0;
  let samples = 0;
  let idle = 0;
  let stuck = 0;
  let still = 0;
  return {
    sample(): void {
      const now = h.room.time;
      if (now < next || h.room.phase !== 'playing') return;
      next = now + every;
      for (const p of h.room.players.values()) {
        if (!p.isBot || !p.alive || bx(p).stage !== 'ground' || !(p.brain instanceof BlackoutBrain)) {
          trail.delete(p.id);
          continue;
        }
        const b = p.brain;
        const tr = trail.get(p.id) ?? [];
        tr.push({ x: p.move.x, z: p.move.z, t: now });
        // Keep the samples of the last `window` seconds (with slack: room time is a float sum).
        while (tr.length > 1 && tr[1]!.t <= now - window + 0.01) tr.shift();
        trail.set(p.id, tr);
        if (now - tr[0]!.t < window - 0.25) continue; // not long enough on the ground yet
        samples++;
        const g = b.goal;
        const kind = g?.kind ?? 'none';
        kinds[kind] = (kinds[kind] ?? 0) + 1;
        const fighting = !!b.target || now - p.lastFireTime < 1.5;
        const healing = bx(p).healUntil !== null;
        const moved = Math.hypot(p.move.x - tr[0]!.x, p.move.z - tr[0]!.z);
        if (!g || AIMLESS.has(kind)) idle++;
        if (fighting || healing) continue;
        const far = !!g && Math.hypot(g.x - p.move.x, g.z - p.move.z) > 2 && !HOLDING.has(kind);
        if (moved < 0.75) {
          if (far) stuck++;
          if (!g || !HOLDING.has(kind)) still++;
        }
      }
    },
    report(): SimReport {
      const k: Record<string, number> = {};
      for (const [n, v] of Object.entries(kinds)) k[n] = v / Math.max(1, samples);
      return { samples, idle: idle / Math.max(1, samples), stuck: stuck / Math.max(1, samples), still: still / Math.max(1, samples), kinds: k, causes };
    },
  };
}
