/**
 * Configurable key bindings (owner: frontend). Stored in `settings.ext.frontend.binds`
 * (action -> KeyboardEvent.code) and applied to core's KEYMAP; a rebound action loses its default
 * keys (arrow-key alternates are kept). `classMenu` is the frontend's own key (in-match class
 * picker), not a core button.
 */
import { KEYMAP, type Action } from '../../game/controls';
import { keyCodeLabel } from '../../game/prompts';
import { onSettings, settings, updateSettings } from '../../settings';

declare module '../../settings' {
  interface SettingsExt {
    frontend?: { binds?: Partial<Record<BindAction, string>> };
  }
}

export type BindAction = Action | 'classMenu';

export const DEFAULT_CLASS_MENU_KEY = 'KeyB';

/** Core's defaults, snapshotted before any rebinding. */
const DEFAULT_KEYMAP: Record<string, Action> = { ...KEYMAP };

export const BINDABLE: [BindAction, string][] = [
  ['forward', 'Move forward'],
  ['back', 'Move back'],
  ['left', 'Strafe left'],
  ['right', 'Strafe right'],
  ['jump', 'Jump'],
  ['crouch', 'Crouch'],
  ['prone', 'Prone'],
  ['sprint', 'Sprint'],
  ['reload', 'Reload'],
  ['use', 'Use'],
  ['melee', 'Melee'],
  ['lethal', 'Lethal'],
  ['tactical', 'Tactical'],
  ['streak', 'Killstreak'],
  ['weapon1', 'Primary weapon'],
  ['weapon2', 'Secondary weapon'],
  ['scores', 'Scoreboard'],
  ['classMenu', 'Change class'],
];

export const binds = (): Partial<Record<BindAction, string>> => settings.ext.frontend?.binds ?? {};

/** The (primary) key for an action, as an event code. */
export function keyFor(action: BindAction): string | null {
  const b = binds()[action];
  if (action === 'classMenu') return b ?? DEFAULT_CLASS_MENU_KEY;
  if (b && KEYMAP[b] === action) return b;
  return Object.keys(KEYMAP).find((c) => KEYMAP[c] === action && !c.startsWith('Arrow')) ?? Object.keys(KEYMAP).find((c) => KEYMAP[c] === action) ?? null;
}

/** Key label for the bindings page (the same labels HUD prompts use, game/prompts.ts). */
export const keyLabel = (code: string | null): string => keyCodeLabel(code);

/** Rebuild KEYMAP from the defaults plus the saved binds. */
export function applyBinds(): void {
  for (const k of Object.keys(KEYMAP)) delete KEYMAP[k];
  Object.assign(KEYMAP, DEFAULT_KEYMAP);
  for (const [action, code] of Object.entries(binds()) as [BindAction, string][]) {
    if (!code || action === 'classMenu') continue;
    for (const c of Object.keys(KEYMAP)) if (KEYMAP[c] === action && !c.startsWith('Arrow')) delete KEYMAP[c];
    KEYMAP[code] = action;
  }
}

export function setBind(action: BindAction, code: string | null): void {
  const next = { ...binds() };
  if (code) {
    // A key does one thing: unbind it elsewhere.
    for (const [a, c] of Object.entries(next) as [BindAction, string][]) if (c === code && a !== action) delete next[a];
    next[action] = code;
  } else delete next[action];
  updateSettings({ ext: { ...settings.ext, frontend: { ...settings.ext.frontend, binds: next } } });
}

export function resetBinds(): void {
  updateSettings({ ext: { ...settings.ext, frontend: { ...settings.ext.frontend, binds: {} } } });
}

/** Which action (other than `action`) currently uses `code`. */
export function conflictFor(action: BindAction, code: string): BindAction | null {
  if (action !== 'classMenu' && keyFor('classMenu') === code) return 'classMenu';
  const a = KEYMAP[code];
  return a && a !== action ? a : null;
}

onSettings((_s, changed) => {
  if (changed.includes('ext')) applyBinds();
});
