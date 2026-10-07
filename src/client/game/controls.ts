/**
 * Local input: pointer lock, mouse look, keyboard and mouse buttons -> the `Buttons` bitmask.
 * Key bindings are in `KEYMAP` (frontend may make them configurable). Edge presses are queued and
 * read once with `consume(action)`.
 *
 * Dev only: `?devlook=1` (dev server builds) replaces pointer lock with drag-to-look so automated
 * browsers can drive a match: clicking the canvas "locks", dragging looks, a click without a drag
 * fires one tap, Esc "unlocks", and key/click taps are held for at least DEVLOOK_MIN_HOLD_MS so a
 * synthetic press that releases instantly still reaches a frame. `window.__lofi.input` adds
 * scripted helpers: `hold(action | 'fire' | 'ads', ms)`, `look(dYaw, dPitch)`, `state()`.
 */
import { Buttons } from '../../shared/input';
import { clamp } from '../../shared/math';
import { settings } from '../settings';
import { sfx } from './audio';

export type Action = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'crouch' | 'sprint' | 'reload' | 'use' | 'melee' | 'lethal' | 'tactical' | 'streak' | 'prone' | 'weapon1' | 'weapon2' | 'scores';

/** event.code -> action. */
export const KEYMAP: Record<string, Action> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'jump',
  KeyC: 'crouch',
  ControlLeft: 'crouch',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyR: 'reload',
  KeyF: 'use',
  KeyV: 'melee',
  KeyE: 'melee',
  KeyG: 'lethal',
  KeyQ: 'tactical',
  Digit4: 'streak',
  KeyZ: 'prone',
  Digit1: 'weapon1',
  Digit2: 'weapon2',
  Tab: 'scores',
};

const HELD_BITS: Partial<Record<Action, number>> = {
  forward: Buttons.FORWARD,
  back: Buttons.BACK,
  left: Buttons.LEFT,
  right: Buttons.RIGHT,
  jump: Buttons.JUMP,
  sprint: Buttons.SPRINT,
  reload: Buttons.RELOAD,
  use: Buttons.USE,
  melee: Buttons.MELEE,
  lethal: Buttons.LETHAL,
  tactical: Buttons.TACTICAL,
  streak: Buttons.STREAK,
  prone: Buttons.PRONE,
};

const DEVLOOK_MIN_HOLD_MS = 120;

/** `?devlook=1` on a dev build (see the file comment). */
export function devlookEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    const q = new URLSearchParams(location.search);
    const v = q.get('devlook');
    return v !== null && v !== '0';
  } catch {
    return false;
  }
}

export class Controls {
  yaw = 0;
  pitch = 0;
  locked = false;
  fire = false;
  ads = false;
  private held = new Set<Action>();
  private pressed = new Set<Action>();
  private crouchToggled = false;
  private wheel = 0;
  private lockFns = new Set<(locked: boolean) => void>();
  private offs: (() => void)[] = [];
  /** Extra look multiplier (ADS sensitivity, scopes). */
  lookScale = 1;
  enabled = true;
  /** Drag-to-look instead of pointer lock (dev only, `?devlook=1`). */
  readonly devlook = devlookEnabled();
  private dragging = false;
  private dragMoved = 0;
  private holdUntil = new Map<Action | 'fire' | 'ads', number>();

  constructor(private canvas: HTMLElement) {
    const on = <K extends keyof WindowEventMap>(t: K, fn: (e: WindowEventMap[K]) => void, target: Window | Document | HTMLElement = window) => {
      target.addEventListener(t, fn as EventListener);
      this.offs.push(() => target.removeEventListener(t, fn as EventListener));
    };
    on('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a || !this.enabled) return;
      if (a === 'scores' || a === 'jump' || e.code.startsWith('Arrow') || (a === 'crouch' && e.ctrlKey)) e.preventDefault();
      if (e.repeat) return;
      if (!this.held.has(a)) this.pressed.add(a);
      this.held.add(a);
      if (a === 'crouch') this.crouchToggled = !this.crouchToggled;
      if (a === 'sprint') this.crouchToggled = false;
    });
    on('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.release(a);
    });
    if (this.devlook) {
      on('keydown', (e) => {
        if (e.code === 'Escape' && this.locked) this.setDevLocked(false);
        const a = KEYMAP[e.code];
        if (a && !e.repeat) this.holdUntil.set(a, performance.now() + DEVLOOK_MIN_HOLD_MS);
      });
      this.installDevHelpers();
    }
    on('blur', () => this.releaseAll());
    on('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      if (this.devlook) {
        if (!this.dragging) return;
        this.dragMoved += Math.abs(e.movementX) + Math.abs(e.movementY);
      }
      this.look(e.movementX, e.movementY);
    });
    on('mousedown', (e) => {
      sfx.unlock();
      if (!this.locked) {
        if (e.target === this.canvas && e.button === 0) this.requestLock();
        return;
      }
      if (this.devlook && e.button === 0) {
        // Drag looks; a click without a drag fires a tap on mouseup.
        this.dragging = true;
        this.dragMoved = 0;
        return;
      }
      if (e.button === 0) this.fire = true;
      if (e.button === 2) this.ads = true;
      if (this.devlook && e.button === 2) this.holdUntil.set('ads', performance.now() + DEVLOOK_MIN_HOLD_MS);
    });
    on('mouseup', (e) => {
      if (this.devlook && e.button === 0) {
        if (this.dragging && this.dragMoved < 6) this.hold('fire', DEVLOOK_MIN_HOLD_MS);
        this.dragging = false;
        return;
      }
      if (e.button === 0) this.release('fire');
      if (e.button === 2) this.release('ads');
    });
    on('wheel', (e) => {
      if (this.locked) this.wheel += Math.sign(e.deltaY);
    });
    on('contextmenu', (e) => {
      if (this.locked || e.target === this.canvas) e.preventDefault();
    });
    const lockChange = () => {
      if (this.devlook) return;
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.releaseAll();
      for (const fn of this.lockFns) fn(this.locked);
    };
    document.addEventListener('pointerlockchange', lockChange);
    this.offs.push(() => document.removeEventListener('pointerlockchange', lockChange));
  }

  /** Mouse-look by a pixel delta (pointer lock movement, or a dev drag). */
  private look(dx: number, dy: number): void {
    const k = (settings.sensitivity / 1000) * this.lookScale;
    this.yaw -= dx * k;
    this.pitch = clamp(this.pitch - dy * k * (settings.invertY ? -1 : 1), -1.5, 1.5);
  }

  /** Let go of a held action/trigger, honouring a dev minimum hold. */
  private release(a: Action | 'fire' | 'ads'): void {
    const until = this.holdUntil.get(a) ?? 0;
    const left = until - performance.now();
    if (left > 0) {
      setTimeout(() => this.release(a), left + 1);
      return;
    }
    this.holdUntil.delete(a);
    if (a === 'fire') this.fire = false;
    else if (a === 'ads') this.ads = false;
    else this.held.delete(a);
  }

  /** Hold an action (or the trigger / ADS) for `ms`, then release it. */
  private hold(a: Action | 'fire' | 'ads', ms: number): void {
    if (a === 'fire') this.fire = true;
    else if (a === 'ads') this.ads = true;
    else {
      if (!this.held.has(a)) this.pressed.add(a);
      this.held.add(a);
      if (a === 'crouch') this.crouchToggled = !this.crouchToggled;
    }
    this.holdUntil.set(a, performance.now() + ms);
    setTimeout(() => this.release(a), ms + 1);
  }

  private setDevLocked(locked: boolean): void {
    if (this.locked === locked) return;
    this.locked = locked;
    if (!locked) this.releaseAll();
    for (const fn of this.lockFns) fn(locked);
  }

  /** `window.__lofi.input` for scripted browsers (devlook only). */
  private installDevHelpers(): void {
    const w = window as unknown as { __lofi?: Record<string, unknown> };
    w.__lofi = w.__lofi ?? {};
    w.__lofi.input = {
      lock: () => this.setDevLocked(true),
      unlock: () => this.setDevLocked(false),
      hold: (a: Action | 'fire' | 'ads', ms = 200) => this.hold(a, ms),
      look: (dYaw: number, dPitch = 0) => {
        this.yaw += dYaw;
        this.pitch = clamp(this.pitch + dPitch, -1.5, 1.5);
      },
      state: () => ({ locked: this.locked, yaw: this.yaw, pitch: this.pitch, held: [...this.held], fire: this.fire, ads: this.ads }),
    };
    this.offs.push(() => {
      if (w.__lofi) delete w.__lofi.input;
    });
  }

  requestLock(): void {
    sfx.unlock();
    if (this.devlook) {
      this.setDevLocked(true);
      return;
    }
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      /* not allowed now */
    }
  }

  releaseLock(): void {
    if (this.devlook) return this.setDevLocked(false);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  onLock(fn: (locked: boolean) => void): () => void {
    this.lockFns.add(fn);
    return () => this.lockFns.delete(fn);
  }

  private releaseAll() {
    this.held.clear();
    this.holdUntil.clear();
    this.fire = false;
    this.ads = false;
    this.dragging = false;
  }

  isHeld(a: Action): boolean {
    return this.held.has(a);
  }

  /** True once per press. */
  consume(a: Action): boolean {
    const had = this.pressed.has(a);
    this.pressed.delete(a);
    return had;
  }

  /** Mouse wheel steps since the last call. */
  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Buttons bitmask for this frame's input command. */
  buttons(): number {
    let b = 0;
    if (!this.enabled) return 0;
    for (const a of this.held) b |= HELD_BITS[a] ?? 0;
    const crouch = settings.crouchToggle ? this.crouchToggled : this.held.has('crouch');
    if (crouch) b |= Buttons.CROUCH;
    if (this.ads) b |= Buttons.ADS;
    if (this.fire) b |= Buttons.FIRE;
    return b;
  }

  /** Clear queued presses (on spawn). */
  clearPresses(): void {
    this.pressed.clear();
    this.wheel = 0;
    this.crouchToggled = false;
  }

  dispose(): void {
    this.releaseLock();
    for (const off of this.offs) off();
    this.offs = [];
    this.lockFns.clear();
  }
}
