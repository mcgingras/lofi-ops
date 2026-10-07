/**
 * Screen routing over `registerScreen` (registry.ts). The main screen follows the location hash
 * (`#/settings`, `#/barracks?tab=prestige`); one overlay can sit on top (pause menu settings over
 * a running match) without unmounting the screen below.
 */
import { screens } from './registry';

let screenRoot: HTMLElement;
let overlayRoot: HTMLElement;
let current: { id: string; unmount: (() => void) | void } | null = null;
let overlay: { id: string; unmount: (() => void) | void } | null = null;
const changeFns = new Set<(id: string) => void>();

export function initRouter(screenEl: HTMLElement, overlayEl: HTMLElement, fallback = 'menu'): void {
  screenRoot = screenEl;
  overlayRoot = overlayEl;
  addEventListener('hashchange', () => route(fallback));
  route(fallback);
}

function parse(): { id: string; params: Record<string, string> } {
  const h = location.hash.replace(/^#\/?/, '');
  const [id = '', q = ''] = h.split('?');
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(q)) params[k] = v;
  return { id: decodeURIComponent(id), params };
}

function route(fallback: string) {
  let { id, params } = parse();
  if (!screens.has(id)) {
    id = fallback;
    params = {};
  }
  if (current?.id === id && !params.reload) return;
  mount(id, params);
}

function mount(id: string, params: Record<string, string>) {
  closeOverlay();
  try {
    current?.unmount?.();
  } catch (err) {
    console.error(err);
  }
  screenRoot.replaceChildren();
  screenRoot.dataset.screen = id;
  const fn = screens.get(id);
  current = { id, unmount: fn?.(screenRoot, params) };
  for (const f of changeFns) f(id);
}

/** Show a screen (updates the hash). */
export function navigate(id: string, params: Record<string, string> = {}): void {
  const q = new URLSearchParams(params).toString();
  const hash = `#/${encodeURIComponent(id)}${q ? `?${q}` : ''}`;
  if (location.hash === hash && current?.id === id) return;
  if (location.hash === hash) mount(id, params);
  else location.hash = hash;
}

export const currentScreen = () => current?.id ?? null;

/** Screen changes. Returns an unsubscribe. */
export function onScreenChange(fn: (id: string) => void): () => void {
  changeFns.add(fn);
  return () => changeFns.delete(fn);
}

/** Show a screen on top of the current one (params.overlay = '1'). */
export function openOverlay(id: string, params: Record<string, string> = {}): void {
  closeOverlay();
  const fn = screens.get(id);
  if (!fn) return;
  overlayRoot.hidden = false;
  overlayRoot.dataset.screen = id;
  overlay = { id, unmount: fn(overlayRoot, { ...params, overlay: '1' }) };
}

export function closeOverlay(): void {
  if (!overlay) return;
  try {
    overlay.unmount?.();
  } catch (err) {
    console.error(err);
  }
  overlay = null;
  overlayRoot.replaceChildren();
  overlayRoot.hidden = true;
}

export const overlayOpen = () => overlay !== null;

/** "Back" from a screen: closes the overlay if it is one, else goes to `fallback`. */
export function back(params: Record<string, string>, fallback = 'menu'): void {
  if (params.overlay === '1') closeOverlay();
  else navigate(fallback);
}
