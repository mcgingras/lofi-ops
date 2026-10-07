/**
 * Local input: pointer lock, mouse look, keyboard and mouse buttons -> the `Buttons` bitmask.
 * Key bindings are in `KEYMAP` (frontend may make them configurable). Edge presses are queued and
 * read once with `consume(action)`.
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
      if (a) this.held.delete(a);
    });
    on('blur', () => this.releaseAll());
    on('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      const k = (settings.sensitivity / 1000) * this.lookScale;
      this.yaw -= e.movementX * k;
      this.pitch = clamp(this.pitch - e.movementY * k * (settings.invertY ? -1 : 1), -1.5, 1.5);
    });
    on('mousedown', (e) => {
      sfx.unlock();
      if (!this.locked) {
        if (e.target === this.canvas && e.button === 0) this.requestLock();
        return;
      }
      if (e.button === 0) this.fire = true;
      if (e.button === 2) this.ads = true;
    });
    on('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.ads = false;
    });
    on('wheel', (e) => {
      if (this.locked) this.wheel += Math.sign(e.deltaY);
    });
    on('contextmenu', (e) => {
      if (this.locked || e.target === this.canvas) e.preventDefault();
    });
    const lockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.releaseAll();
      for (const fn of this.lockFns) fn(this.locked);
    };
    document.addEventListener('pointerlockchange', lockChange);
    this.offs.push(() => document.removeEventListener('pointerlockchange', lockChange));
  }

  requestLock(): void {
    sfx.unlock();
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      /* not allowed now */
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  onLock(fn: (locked: boolean) => void): () => void {
    this.lockFns.add(fn);
    return () => this.lockFns.delete(fn);
  }

  private releaseAll() {
    this.held.clear();
    this.fire = false;
    this.ads = false;
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
