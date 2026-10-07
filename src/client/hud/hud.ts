/**
 * The pixel HUD: every registered widget (registry.ts `registerHudWidget`) draws in order onto
 * the low-res HUD canvas, which the post pass composites over the frame.
 */
import { hudDrawList } from '../registry';
import './widgets';

export function drawHud(g: CanvasRenderingContext2D, w: number, h: number, dt: number): void {
  for (const draw of hudDrawList()) {
    g.save();
    try {
      draw(g, w, h, dt);
    } catch (err) {
      console.error('[hud]', err);
    }
    g.restore();
  }
}
