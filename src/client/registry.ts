/**
 * Client extension points (DESIGN.md section 6). Feature folders in src/client/features/<area>/
 * register screens, HUD widgets and handlers for namespaced server pushes here. The client stage
 * wires these into main.ts (routing), hud/ (drawing) and net.ts (dispatch).
 */
import type { FeatureId, FeatureMessages } from '../shared/protocol';

/** A full-screen menu/page. `mount` renders into `root` and returns an unmount function. */
export type ScreenMount = (root: HTMLElement, params: Record<string, string>) => (() => void) | void;

/** Draws onto the pixel HUD canvas (render resolution) every frame. */
export type HudDraw = (g: CanvasRenderingContext2D, w: number, h: number, dt: number) => void;

export const screens = new Map<string, ScreenMount>();
export const hudWidgets = new Map<string, { draw: HudDraw; order: number }>();
const featureHandlers = new Map<string, Set<(data: unknown) => void>>();

export function registerScreen(id: string, mount: ScreenMount): void {
  screens.set(id, mount);
}

/** Lower `order` draws first. */
export function registerHudWidget(id: string, draw: HudDraw, order = 0): void {
  hudWidgets.set(id, { draw, order });
}

/** Handle `{ t: 'feat', id, data }` pushes. Returns an unsubscribe function. */
export function onFeature<K extends FeatureId>(id: K, fn: (data: FeatureMessages[K]) => void): () => void {
  let set = featureHandlers.get(id);
  if (!set) featureHandlers.set(id, (set = new Set()));
  const h = fn as (data: unknown) => void;
  set.add(h);
  return () => set.delete(h);
}

/** Called by net.ts for every `feat` message. */
export function dispatchFeature(id: string, data: unknown): void {
  const set = featureHandlers.get(id);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(data);
    } catch (err) {
      console.error(`[feature ${id}]`, err);
    }
  }
}
