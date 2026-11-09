/**
 * The radar minimap widget with a Spy Plane up, drawn for real on a recording canvas: an enemy in
 * range gets a blip where they stand, one far beyond the minimap gets a small blip on its edge, and
 * nothing is drawn outside the square.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../src/client/features/killstreaks/radar';
import type { Match } from '../src/client/game/match';
import { HUD_COLORS as C } from '../src/client/hud/draw';
import { hudWidgets } from '../src/client/registry';
import { client } from '../src/client/state';
import { KS_ENTITY } from '../src/shared/defs/killstreaks';

interface Fill {
  style: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A 2D context that records its fills and ignores the rest. */
function recorder(): { g: CanvasRenderingContext2D; fills: Fill[] } {
  const fills: Fill[] = [];
  const state: Record<string, unknown> = { fillStyle: '' };
  const g = new Proxy(state, {
    get(t, k: string) {
      if (k === 'fillRect') return (x: number, y: number, w: number, h: number) => fills.push({ style: String(t.fillStyle), x, y, w, h });
      if (k === 'measureText') return () => ({ width: 0 });
      return k in t ? t[k] : () => {};
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  });
  return { g: g as unknown as CanvasRenderingContext2D, fills };
}

const realDocument = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => recorder().g }) };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDocument;
  client.match = null;
});

describe('radar minimap with a Spy Plane up', () => {
  it('blips the enemy in range where they stand and the far one on the edge', () => {
    const views = new Map(
      [
        { id: 'e-near', x: 10, z: 0, yaw: 0, alive: true },
        { id: 'e-far', x: 0, z: -100, yaw: 0, alive: true },
        { id: 'e-hidden', x: 5, z: 5, yaw: 0, alive: true }, // Ghost: not on the server's radar list
      ].map((v) => [v.id, v]),
    );
    const m = {
      myId: 'me',
      myTeam: 0,
      phase: 'playing',
      time: 1000,
      serverTime: 50,
      yaw: 0,
      me: { alive: true },
      isEnemy: (id: string) => id.startsWith('e-'),
      map: { map: { id: 'test', bounds: { min: { x: -120, z: -120 }, max: { x: 120, z: 120 } }, spawns: { ffa: [{ y: 0 }] }, brushes: [] } },
      renderer: { cam: { position: { x: 0, y: 0, z: 0 } } },
      remotes: { views },
      net: { predictor: { shown: () => ({ x: 0, y: 0, z: 0 }) }, lastSnap: { ents: [{ id: 1, kind: KS_ENTITY.uav, x: 0, y: 40, z: 30, yaw: 0, owner: 'me', team: 0 }], radar: ['e-near', 'e-far'], jammed: false } },
    } as unknown as Match;
    client.match = m;
    const { g, fills } = recorder();
    const H = 480; // unit 2: the radar is 112 px at (16, 80), centre (72, 136), 2.24 px per metre
    hudWidgets.get('killstreaks.radar')!.draw(g, 640, H, 1 / 60);
    const blips = fills.filter((f) => f.style === C.enemy);
    expect(blips).toHaveLength(2);
    // In range, 10 m to the right: a fresh (pulsing, 6 px) blip centred 22 px right of the centre.
    const near = blips.find((b) => b.w === 6)!;
    expect(near.x + near.w / 2).toBeCloseTo(72 + 22.4, 0);
    expect(near.y + near.h / 2).toBeCloseTo(136, 0);
    // 100 m ahead, far off the 25 m minimap: a small blip straight up, just inside the top edge.
    const far = blips.find((b) => b.w === 2)!;
    expect(far.x + far.w / 2).toBeCloseTo(72, 0);
    expect(far.y).toBeGreaterThanOrEqual(80);
    expect(far.y).toBeLessThan(90);
    // The next frame, mid-sweep: both still there (no blinking out), the pulse over.
    (m as { time: number }).time = 1000.5;
    const again = recorder();
    hudWidgets.get('killstreaks.radar')!.draw(again.g, 640, H, 1 / 60);
    expect(again.fills.filter((f) => f.style === C.enemy).map((f) => f.w).sort()).toEqual([2, 4]);
  });
});
