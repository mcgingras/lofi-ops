/**
 * World waypoints for the pixel HUD: a label box over a world position with its distance, pinned to
 * the screen edge when off screen. Used by objective markers (modes) and care packages (killstreaks).
 */
import * as THREE from 'three';
import { KEYMAP } from '../game/controls';
import type { Match } from '../game/match';
import { blink, box, HUD_COLORS as C, rect, textWidth, txt, unit } from './draw';

const v = new THREE.Vector3();

/** The key bound to USE, for "HOLD F" prompts. */
export const useKey = () => (Object.entries(KEYMAP).find(([, a]) => a === 'use')?.[0] ?? 'KeyF').replace(/^Key|^Digit/, '');

export interface Waypoint {
  x: number;
  y: number;
  z: number;
  label: string;
  caption?: string;
  color: string;
  /** Fill colour of the label box (default dark). */
  fill?: string;
  blink?: boolean;
  /** Hide when farther than this (m). */
  maxDist?: number;
  small?: boolean;
  /** Hide when closer than this (m): you are standing in it. */
  hideWithin?: number;
}

/** Screen boxes already drawn this frame, so later waypoints slide clear of them. */
export interface WaypointSlot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Draw a labelled world marker with its distance; off screen it is pinned to the nearest edge. */
export function drawWaypoint(m: Match, g: CanvasRenderingContext2D, W: number, H: number, k: Waypoint, placed: WaypointSlot[]): void {
  const u = unit(H);
  const cam = m.renderer.cam;
  const d = Math.hypot(k.x - cam.position.x, k.z - cam.position.z);
  if (k.maxDist !== undefined && d > k.maxDist) return;
  if (k.hideWithin !== undefined && d < k.hideWithin) return;
  // Camera space first: behind the camera, pin it to the left/right edge it is closer to.
  v.set(k.x, k.y, k.z).applyMatrix4(cam.matrixWorldInverse);
  const behind = v.z > -0.1;
  const side = v.x;
  v.set(k.x, k.y, k.z).project(cam);
  let sx = (v.x * 0.5 + 0.5) * W;
  let sy = (-v.y * 0.5 + 0.5) * H;
  if (behind) {
    sx = side < 0 ? 0 : W;
    sy = H / 2;
  }
  const size = k.small ? 6 : 8;
  const tw = Math.max(textWidth(g, k.label, size, u), 5 * u);
  const bw = tw + 4 * u;
  const bh = (size + 3) * u;
  const cap = k.small ? '' : k.caption ? `${k.caption} ${Math.round(d)}M` : `${Math.round(d)}M`;
  const cw = cap ? textWidth(g, cap, 6, u) : 0;
  const halfW = Math.max(bw, cw) / 2 + 2 * u;
  const totalH = bh + (cap ? 9 * u : 0);
  const top = 24 * u;
  const bottom = H - 40 * u;
  const off = behind || sx < halfW || sx > W - halfW || sy < top || sy > bottom;
  if (off && k.small) return;
  sx = Math.max(halfW, Math.min(W - halfW, sx));
  sy = Math.max(top, Math.min(bottom, sy));
  // Don't stack on markers already drawn: slide down until clear.
  for (let tries = 0; tries < 6; tries++) {
    const hit = placed.find((p) => Math.abs(p.x - sx) < (p.w + halfW * 2) / 2 && Math.abs(p.y - sy) < (p.h + totalH) / 2);
    if (!hit) break;
    sy = hit.y + (hit.h + totalH) / 2 + u;
  }
  placed.push({ x: sx, y: sy, w: halfW * 2, h: totalH });
  if (k.blink && !blink(m.time, 0.6, 0.4)) return;
  box(g, sx - bw / 2, sy - bh / 2, bw, bh, k.fill ?? 'rgba(10,10,10,.7)', u);
  rect(g, sx - bw / 2, sy + bh / 2, bw, u, k.color);
  txt(g, k.label, sx, sy - bh / 2 + u, size, k.color, 'center', u);
  if (cap) txt(g, cap, sx, sy + bh / 2 + 2 * u, 6, k.caption ? k.color : C.dim, 'center', u);
}
