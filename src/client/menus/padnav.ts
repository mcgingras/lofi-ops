/**
 * Controller navigation for the DOM menus (main menu, lobby, create-a-class, settings, store,
 * barracks, the in-match class picker, pause menu and post-match summary). No menu is rewritten:
 * a focus ring moves over whatever focusable elements the visible screen (or the overlay on top)
 * has, by spatial navigation.
 *
 * - D-pad / left stick: move focus to the nearest element in that direction (held: repeats).
 *   On a slider, left/right change the value; on a <select>, left/right pick the option when
 *   there is nothing to move to on that side (so a select next to a button can still be left).
 * - A: activate (click; checkbox toggles; <select> steps to the next option).
 * - B: back. Clicks a visible `[data-pad-back]` element if the screen has one, otherwise sends the
 *   Escape key the screens already listen for. Paused in a match: resume.
 * - LB / RB: previous / next tab (`[role=tab]`).
 * - Start: resume from the pause menu.
 * - In a match screen with nothing to focus (the "deploy" banner), any button engages the game
 *   (virtual lock, see Controls), so a controller player never needs the mouse.
 *
 * Idle while a match has the input (engaged and no overlay): the match controls own the pad then.
 */
import { currentScreen, overlayOpen } from '../router';
import { client } from '../state';
import { gamepad, inputDevice, onDeviceChange, PAD, setInputDevice } from '../game/gamepad';
import { padActive, type PadSnapshot } from '../game/pad';

type Dir = 'up' | 'down' | 'left' | 'right';

const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), input:not([type=hidden]):not([disabled]), a[href], textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const REPEAT_DELAY = 0.38;
const REPEAT_EVERY = 0.11;
const STICK = 0.55;

const nowSec = () => performance.now() / 1000;
let held: { dir: Dir; next: number } | null = null;

function visible(el: HTMLElement): boolean {
  if (el.closest('[hidden]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}

/** The menu layer that has the controller now, or null (the match owns it). */
function activeRoot(): HTMLElement | null {
  const ov = document.getElementById('overlay');
  if (overlayOpen() && ov && !ov.hidden) return ov;
  const m = client.match;
  if (m && currentScreen() === 'match' && m.controls.locked) return null;
  return document.getElementById('screen');
}

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
}

function focus(el: HTMLElement): void {
  try {
    (el as HTMLElement & { focus(o?: { preventScroll?: boolean; focusVisible?: boolean }): void }).focus({ preventScroll: true, focusVisible: true });
  } catch {
    el.focus();
  }
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

function current(root: HTMLElement): HTMLElement | null {
  const a = document.activeElement as HTMLElement | null;
  return a && a !== document.body && root.contains(a) && visible(a) ? a : null;
}

function focusDefault(root: HTMLElement): boolean {
  const els = focusables(root);
  const pick = els.find((e) => e.matches('.primary, [aria-current="true"], [aria-selected="true"][role=tab]') && e.tagName === 'BUTTON') ?? els.find((e) => e.tagName === 'BUTTON') ?? els[0];
  if (!pick) return false;
  focus(pick);
  return true;
}

/** Nearest focusable from `from` in `dir` (centre-to-edge distance, sideways offset weighted). */
export function nearest(from: DOMRect, dir: Dir, cands: { el: HTMLElement; r: DOMRect }[]): HTMLElement | null {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const { el, r } of cands) {
    const ex = r.left + r.width / 2;
    const ey = r.top + r.height / 2;
    let gapP: number;
    let gapO: number;
    let ok: boolean;
    if (dir === 'down' || dir === 'up') {
      ok = dir === 'down' ? ey > cy + 1 && r.bottom > from.bottom - 1 : ey < cy - 1 && r.top < from.top + 1;
      gapP = dir === 'down' ? Math.max(0, r.top - from.bottom) : Math.max(0, from.top - r.bottom);
      gapO = Math.max(0, r.left - from.right, from.left - r.right);
    } else {
      ok = dir === 'right' ? ex > cx + 1 && r.right > from.right - 1 : ex < cx - 1 && r.left < from.left + 1;
      gapP = dir === 'right' ? Math.max(0, r.left - from.right) : Math.max(0, from.left - r.right);
      gapO = Math.max(0, r.top - from.bottom, from.top - r.bottom);
    }
    if (!ok) continue;
    const align = dir === 'down' || dir === 'up' ? Math.abs(ex - cx) : Math.abs(ey - cy);
    const score = gapP + gapO * 3 + align * 0.15;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function fire(el: HTMLElement, type: 'input' | 'change'): void {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

function stepRange(el: HTMLInputElement, sign: number): void {
  const step = Number(el.step) || 1;
  const min = el.min === '' ? 0 : Number(el.min);
  const max = el.max === '' ? 100 : Number(el.max);
  const v = Math.max(min, Math.min(max, Number(el.value) + sign * step));
  const decimals = (String(step).split('.')[1] ?? '').length;
  el.value = v.toFixed(decimals);
  fire(el, 'input');
  fire(el, 'change');
}

function stepSelect(el: HTMLSelectElement, sign: number): void {
  const n = el.options.length;
  if (!n) return;
  let i = el.selectedIndex;
  for (let k = 0; k < n; k++) {
    i = (i + sign + n) % n;
    if (!el.options[i]!.disabled) break;
  }
  if (i === el.selectedIndex) return;
  el.selectedIndex = i;
  fire(el, 'input');
  fire(el, 'change');
}

function move(root: HTMLElement, dir: Dir): void {
  const cur = current(root);
  if (!cur) {
    focusDefault(root);
    return;
  }
  const sideways = dir === 'left' || dir === 'right';
  const sign = dir === 'right' ? 1 : -1;
  if (sideways && cur instanceof HTMLInputElement && cur.type === 'range') return stepRange(cur, sign);
  const cands = focusables(root)
    .filter((e) => e !== cur)
    .map((el) => ({ el, r: el.getBoundingClientRect() }));
  const next = nearest(cur.getBoundingClientRect(), dir, cands);
  if (next) focus(next);
  else if (sideways && cur instanceof HTMLSelectElement) stepSelect(cur, sign);
}

function activate(root: HTMLElement): void {
  const cur = current(root);
  if (!cur) {
    focusDefault(root);
    return;
  }
  if (cur instanceof HTMLSelectElement) return stepSelect(cur, 1);
  if (cur instanceof HTMLInputElement && (cur.type === 'range' || cur.type === 'text' || cur.type === 'number')) return;
  cur.click();
}

function paused(): boolean {
  const m = client.match;
  return !!m && currentScreen() === 'match' && !m.controls.locked && !overlayOpen();
}

function resume(): void {
  setInputDevice('pad');
  client.match?.controls.requestLock();
}

function backOut(root: HTMLElement): void {
  if (paused() && focusables(root).length) return resume();
  const backEl = [...root.querySelectorAll<HTMLElement>('[data-pad-back]')].find(visible);
  if (backEl) return backEl.click();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', key: 'Escape', bubbles: true }));
}

function switchTab(root: HTMLElement, sign: number): void {
  const tabs = [...root.querySelectorAll<HTMLElement>('[role=tab]')].filter(visible);
  if (tabs.length < 2) return;
  const i = Math.max(0, tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true'));
  const next = tabs[(i + sign + tabs.length) % tabs.length]!;
  next.click();
  focus(next);
}

function dirOf(s: PadSnapshot): Dir | null {
  const b = (i: number) => (s.buttons[i] ?? 0) >= 0.5;
  if (b(PAD.UP)) return 'up';
  if (b(PAD.DOWN)) return 'down';
  if (b(PAD.LEFT)) return 'left';
  if (b(PAD.RIGHT)) return 'right';
  const x = s.axes[0] ?? 0;
  const y = s.axes[1] ?? 0;
  if (Math.hypot(x, y) < STICK) return null;
  return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
}

function frame(s: PadSnapshot | null, prev: PadSnapshot | null): void {
  if (!s) {
    held = null;
    return;
  }
  const root = activeRoot();
  if (!root) {
    held = null;
    return;
  }
  const pressed = (i: number) => (s.buttons[i] ?? 0) >= 0.5 && (prev?.buttons[i] ?? 0) < 0.5;
  const anyPress = s.buttons.some((_, i) => i !== PAD.HOME && pressed(i));

  // Match screen with nothing to pick (the deploy banner): any pad input engages.
  const m = client.match;
  if (m && currentScreen() === 'match' && !overlayOpen() && !focusables(root).length) {
    if (anyPress || (padActive(s) && (!prev || !padActive(prev)))) resume();
    held = null;
    return;
  }

  if (inputDevice() === 'pad' && !current(root) && (anyPress || dirOf(s))) {
    // First touch on a screen: just show where the focus is.
    focusDefault(root);
    held = { dir: dirOf(s) ?? 'down', next: nowSec() + REPEAT_DELAY };
    return;
  }

  const dir = dirOf(s);
  const t = nowSec();
  if (dir) {
    if (!held || held.dir !== dir) {
      move(root, dir);
      held = { dir, next: t + REPEAT_DELAY };
    } else if (t >= held.next) {
      move(root, dir);
      held.next = t + REPEAT_EVERY;
    }
  } else held = null;

  if (pressed(PAD.A)) activate(root);
  if (pressed(PAD.B)) backOut(root);
  if (pressed(PAD.START) && paused()) resume();
  if (pressed(PAD.LB)) switchTab(root, -1);
  if (pressed(PAD.RB)) switchTab(root, 1);
}

if (typeof window !== 'undefined') {
  gamepad.onFrame(frame);
  // Coming back to the pad on a screen: show the focus ring on the default control.
  onDeviceChange((d) => {
    if (d !== 'pad') return;
    const root = activeRoot();
    if (root && !current(root)) focusDefault(root);
  });
}
