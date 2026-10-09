/**
 * The shared gamepad module (browser side). Everything that reads a controller goes through here:
 * the match controls, menu focus navigation, the killstreak tactical map and the killcam skip.
 *
 * - `gamepad.snapshot()`: the active pad as a `PadSnapshot` (polled at most once per ~2 ms), or
 *   null. The active pad is the last one that did something (standard mapping preferred).
 * - `gamepad.onFrame(fn)`: called once per animation frame with this and last frame's snapshot
 *   (edge detection for menus). `PadEdges` does the same for code that polls on its own.
 * - Last-used device: `inputDevice()` ('kbm' | 'pad'), `onDeviceChange(fn)`; any pad input
 *   switches to 'pad', keys/clicks/wheel/real mouse travel switch back. `<body data-input>`
 *   follows it (CSS focus ring).
 * - `rumble(kind, amount)`: subtle vibration through `vibrationActuator` when available, only
 *   while the pad is the last-used device and the setting is on; fails silently elsewhere.
 * - `noteUsePrompt()` / `usePromptActive()`: HUD code calls the first while a "HOLD [X]" prompt is
 *   drawn, so X becomes tap-to-reload / hold-to-use there (see PadMapper).
 *
 * Tests can swap the source with `setPadSource(() => [...])`.
 */
import { settings } from '../settings';
import { MOUSE_SWITCH_PX, nextDevice, PAD, padActive, type DeviceEvent, type InputDevice, type PadSnapshot } from './pad';

type PadSource = () => readonly (Gamepad | null)[];

const browser = typeof window !== 'undefined' && typeof navigator !== 'undefined';
let source: PadSource = () => {
  try {
    return browser && typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
  } catch {
    return [];
  }
};

let device: InputDevice = 'kbm';
const deviceFns = new Set<(d: InputDevice) => void>();
let activeIndex = -1;
let cached: { at: number; snap: PadSnapshot | null; pad: Gamepad | null } = { at: -1, snap: null, pad: null };
const frameFns = new Set<(s: PadSnapshot | null, prev: PadSnapshot | null) => void>();
let lastFrame: PadSnapshot | null = null;
let usePromptAt = -1;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Replace where pads come from (tests, scripted browsers). Returns a restore function. */
export function setPadSource(fn: PadSource): () => void {
  const prev = source;
  source = fn;
  cached.at = -1;
  activeIndex = -1;
  return () => {
    source = prev;
    cached.at = -1;
    activeIndex = -1;
  };
}

export function snapshotOf(gp: Gamepad): PadSnapshot {
  return {
    id: gp.id,
    buttons: Array.from(gp.buttons, (b) => Math.max(b.value || 0, b.pressed ? 1 : 0)),
    axes: Array.from(gp.axes, (a) => (Number.isFinite(a) ? a : 0)),
  };
}

function read(): { snap: PadSnapshot | null; pad: Gamepad | null } {
  const t = now();
  if (cached.at >= 0 && t - cached.at < 2) return cached;
  const pads = source();
  const live: Gamepad[] = [];
  for (const p of pads) if (p && p.connected !== false) live.push(p);
  let pick: Gamepad | null = null;
  const snaps = new Map<Gamepad, PadSnapshot>();
  for (const p of live) {
    const s = snapshotOf(p);
    snaps.set(p, s);
    if (padActive(s)) {
      // The pad that is doing something becomes the active one.
      if (!pick || (pick.mapping !== 'standard' && p.mapping === 'standard')) pick = p;
    }
  }
  if (pick) activeIndex = pick.index;
  else pick = live.find((p) => p.index === activeIndex) ?? live.find((p) => p.mapping === 'standard') ?? live[0] ?? null;
  const snap = pick ? snaps.get(pick)! : null;
  cached = { at: t, snap, pad: pick };
  if (snap && padActive(snap)) setDevice({ kind: 'pad' });
  return cached;
}

export const gamepad = {
  /** The active pad now, or null. */
  snapshot(): PadSnapshot | null {
    return read().snap;
  },
  connected(): boolean {
    return read().pad !== null;
  },
  /** Per-animation-frame listener with this and last frame's snapshot. Returns an unsubscribe. */
  onFrame(fn: (s: PadSnapshot | null, prev: PadSnapshot | null) => void): () => void {
    frameFns.add(fn);
    return () => frameFns.delete(fn);
  },
};

/** Edge detection for code that polls the pad itself (tactical map, killcam skip). */
export class PadEdges {
  private prev: number[] | null = null;
  /** Treat what is held now as already down (call when a screen opens). */
  prime(s: PadSnapshot | null = gamepad.snapshot()): void {
    this.prev = s ? s.buttons.slice() : [];
  }
  /** Buttons that went down since the last call. */
  update(s: PadSnapshot | null = gamepad.snapshot()): Set<number> {
    const out = new Set<number>();
    if (!s) {
      this.prev = [];
      return out;
    }
    const prev = this.prev ?? s.buttons;
    for (let i = 0; i < s.buttons.length; i++) if ((s.buttons[i] ?? 0) >= 0.5 && (prev[i] ?? 0) < 0.5) out.add(i);
    this.prev = s.buttons.slice();
    return out;
  }
}

// -------------------------------------------------------------------------------------------
// Last-used device
// -------------------------------------------------------------------------------------------

export const inputDevice = (): InputDevice => device;

export function onDeviceChange(fn: (d: InputDevice) => void): () => void {
  deviceFns.add(fn);
  return () => deviceFns.delete(fn);
}

function setDevice(e: DeviceEvent): void {
  const next = nextDevice(device, e);
  if (next === device) return;
  device = next;
  if (browser && document.body) document.body.dataset.input = device;
  for (const fn of deviceFns) fn(device);
}

/** Force the device (tests, scripted browsers). */
export function setInputDevice(d: InputDevice): void {
  setDevice(d === 'pad' ? { kind: 'pad' } : { kind: 'key' });
}

if (browser) {
  let travel = 0;
  let travelAt = 0;
  addEventListener('keydown', () => setDevice({ kind: 'key' }), true);
  addEventListener('mousedown', () => setDevice({ kind: 'mouseButton' }), true);
  addEventListener('wheel', () => setDevice({ kind: 'wheel' }), { capture: true, passive: true });
  addEventListener(
    'mousemove',
    (e) => {
      if (device === 'kbm') return;
      const t = now();
      if (t - travelAt > 250) travel = 0;
      travelAt = t;
      travel += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (travel >= MOUSE_SWITCH_PX) setDevice({ kind: 'mouseMove', dist: travel });
    },
    true,
  );
  addEventListener('gamepadconnected', () => (cached.at = -1));
  addEventListener('gamepaddisconnected', () => {
    cached.at = -1;
    activeIndex = -1;
  });
  const tick = () => {
    requestAnimationFrame(tick);
    if (!frameFns.size && device === 'kbm' && !gamepad.connected()) return;
    const s = gamepad.snapshot();
    const prev = lastFrame;
    lastFrame = s;
    for (const fn of frameFns) {
      try {
        fn(s, prev);
      } catch (err) {
        console.error('[gamepad]', err);
      }
    }
  };
  requestAnimationFrame(tick);
  queueMicrotask(() => {
    if (document.body) document.body.dataset.input = device;
  });
}

// -------------------------------------------------------------------------------------------
// USE prompt context
// -------------------------------------------------------------------------------------------

/** A HUD widget is showing a "HOLD [use]" prompt this frame. */
export function noteUsePrompt(): void {
  usePromptAt = now();
}

/** Was a USE prompt drawn in the last few frames? */
export const usePromptActive = (): boolean => usePromptAt >= 0 && now() - usePromptAt < 150;

// -------------------------------------------------------------------------------------------
// Vibration
// -------------------------------------------------------------------------------------------

export type RumbleKind = 'fire' | 'hit' | 'explosion';
const RUMBLE: Record<RumbleKind, { ms: number; strong: number; weak: number; gap: number }> = {
  fire: { ms: 45, strong: 0, weak: 0.22, gap: 0.05 },
  hit: { ms: 140, strong: 0.35, weak: 0.25, gap: 0.08 },
  explosion: { ms: 320, strong: 0.6, weak: 0.4, gap: 0.15 },
};
const lastRumble: Record<RumbleKind, number> = { fire: -1, hit: -1, explosion: -1 };

interface Actuator {
  playEffect?: (type: string, params: Record<string, number>) => Promise<unknown>;
}

/** Subtle rumble (`amount` 0..1 scales it). Silent unless the pad is in use and vibration is on. */
export function rumble(kind: RumbleKind, amount = 1): void {
  if (!settings.padVibration || device !== 'pad' || !(amount > 0)) return;
  const r = RUMBLE[kind];
  const t = now() / 1000;
  if (t - lastRumble[kind] < r.gap) return;
  lastRumble[kind] = t;
  try {
    const act = (read().pad as (Gamepad & { vibrationActuator?: Actuator | null }) | null)?.vibrationActuator;
    if (!act || typeof act.playEffect !== 'function') return;
    const k = Math.min(1, amount);
    const p = act.playEffect('dual-rumble', { startDelay: 0, duration: r.ms, strongMagnitude: r.strong * k, weakMagnitude: r.weak * k });
    void p?.catch?.(() => {});
  } catch {
    /* unsupported: ignore */
  }
}

/** Is a standard-mapping button down in a snapshot? */
export const padDown = (s: PadSnapshot | null, b: number) => !!s && (s.buttons[b] ?? 0) >= 0.5;
export { PAD };
