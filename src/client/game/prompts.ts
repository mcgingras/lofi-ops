/**
 * Input prompts for the HUD: one place that turns an action into its label for the current input
 * device ("HOLD F" vs "HOLD [X]", "[4] NAPALM" vs "[↑] NAPALM").
 *
 * - `actionGlyph(action, device?)`: the bare key or button name ('F', '4', 'X', '↑', 'RT').
 * - `promptKey(action, { brackets }?)`: what a prompt shows. The pad always gets `[X]`; the
 *   keyboard gets the bare key, or `[F]` with `brackets: true` (for prompts that bracket keys).
 * - Keyboard labels follow KEYMAP (so rebinding updates prompts). Feature-owned keys that aren't in
 *   KEYMAP register a lookup with `registerPromptKey(action, () => code)`.
 */
import { KEYMAP, type Action } from './controls';
import { inputDevice } from './gamepad';
import type { InputDevice } from './pad';

export type PromptAction = Action | 'fire' | 'ads' | 'skip' | 'classMenu' | 'pause' | 'confirm' | 'cancel' | 'zoom';

/** Xbox-style glyphs for the standard mapping (BO1/MW2 console layout). */
export const PAD_GLYPHS: Record<PromptAction, string> = {
  forward: 'LS',
  back: 'LS',
  left: 'LS',
  right: 'LS',
  jump: 'A',
  crouch: 'B',
  prone: 'B',
  sprint: 'L3',
  reload: 'X',
  use: 'X',
  skip: 'X',
  melee: 'R3',
  lethal: 'RB',
  tactical: 'LB',
  streak: '↑',
  streakNext: '→',
  streakPrev: '←',
  weapon1: 'Y',
  weapon2: 'Y',
  weaponNext: 'Y',
  weapon3: '↓',
  equipment: '↓',
  zoom: '↓',
  scores: 'BACK',
  fire: 'RT',
  ads: 'LT',
  pause: 'START',
  classMenu: 'Y',
  confirm: 'A',
  cancel: 'B',
};

/** Keyboard fallbacks for prompt actions that aren't KEYMAP actions. */
const KEY_DEFAULTS: Partial<Record<PromptAction, string>> = {
  fire: 'Mouse1',
  ads: 'Mouse2',
  pause: 'Escape',
  confirm: 'Enter',
  cancel: 'Escape',
  zoom: 'KeyX',
  streakNext: 'Digit5',
  weaponNext: 'Wheel',
  equipment: 'Digit3',
};
const keyLookups = new Map<PromptAction, () => string | null>();

/** Keyboard code for a feature-owned prompt action (class menu key, killcam skip...). */
export function registerPromptKey(action: PromptAction, fn: () => string | null): void {
  keyLookups.set(action, fn);
}

/** event.code -> short label ('KeyF' -> 'F', 'Digit4' -> '4', 'ShiftLeft' -> 'L Shift'). */
export function keyCodeLabel(code: string | null): string {
  if (!code) return '-';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const names: Record<string, string> = { Space: 'Space', ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', AltLeft: 'L Alt', AltRight: 'R Alt', Tab: 'Tab', CapsLock: 'Caps', Backquote: '`', Enter: 'Enter', Escape: 'Esc', Mouse1: 'LMB', Mouse2: 'RMB', Wheel: 'Wheel', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  return names[code] ?? code.replace(/^Numpad/, 'Num ');
}

/** First KEYMAP key for an action (letters/digits before arrows). */
function keymapCode(action: Action): string | null {
  const codes = Object.keys(KEYMAP).filter((c) => KEYMAP[c] === action);
  return codes.find((c) => !c.startsWith('Arrow')) ?? codes[0] ?? null;
}

function keyCode(action: PromptAction): string | null {
  const custom = keyLookups.get(action);
  if (custom) return custom();
  if (action === 'skip') return keymapCode('use');
  return keymapCode(action as Action) ?? KEY_DEFAULTS[action] ?? null;
}

/** The bare key/button name for an action on a device (default: the last-used device). */
export function actionGlyph(action: PromptAction, device: InputDevice = inputDevice()): string {
  if (device === 'pad') return PAD_GLYPHS[action];
  return keyCodeLabel(keyCode(action)).toUpperCase();
}

/** A prompt's key label: `[X]` on the pad; `F` (or `[F]` with brackets) on the keyboard. */
export function promptKey(action: PromptAction, opts: { brackets?: boolean; device?: InputDevice } = {}): string {
  const device = opts.device ?? inputDevice();
  const g = actionGlyph(action, device);
  return device === 'pad' || opts.brackets ? `[${g}]` : g;
}
