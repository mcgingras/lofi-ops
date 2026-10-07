/**
 * Settings (replaces the core 'settings' screen): tabs for Video (look preset, resolution, PS1
 * toggles, grade, time of day, FOV), Controls (sensitivity, ADS sensitivity, invert, crouch
 * toggle), Key bindings (rebind any action, incl. the class menu key) and Audio. Same persisted
 * settings as core (settings.ts); works as a page or as an overlay over a match.
 */
import { sfx } from '../../game/audio';
import { cacheClear } from '../../render/idb';
import { registerScreen } from '../../registry';
import { back } from '../../router';
import { lookPreset, settings, updateSettings, type Settings } from '../../settings';
import { BINDABLE, conflictFor, keyFor, keyLabel, resetBinds, setBind, type BindAction } from './keybinds';
import { h, seg, slider } from './ui';

type Tab = 'video' | 'controls' | 'keys' | 'audio';
let lastTab: Tab = 'video';

registerScreen('settings', (root, params) => {
  const updates: (() => void)[] = [];
  const refresh = () => updates.forEach((u) => u());
  const segOf = <K extends keyof Settings>(key: K, opts: [string, string][], onPick?: (v: string) => void) => {
    const s = seg(opts, () => String(settings[key]), (v) => {
      if (onPick) onPick(v);
      else updateSettings({ [key]: v } as Partial<Settings>);
      refresh();
    }, String(key));
    updates.push(() => s.update());
    return s;
  };
  const rangeOf = <K extends keyof Settings>(key: K, min: number, max: number, step: number, fmt: (v: number) => string) => {
    const s = slider(min, max, step, () => Number(settings[key]), (v) => updateSettings({ [key]: v } as Partial<Settings>), fmt, String(key));
    updates.push(() => s.update());
    return s;
  };
  const checkOf = <K extends keyof Settings>(key: K) => {
    const input = h('input', { type: 'checkbox', 'aria-label': String(key) });
    input.addEventListener('change', () => updateSettings({ [key]: input.checked } as Partial<Settings>));
    updates.push(() => (input.checked = Boolean(settings[key])));
    return input;
  };
  const row = (label: string, el: HTMLElement) => [h('label', {}, label), el];

  const cacheBtn = h('button', { class: 'lf-btn small', type: 'button' }, 'Clear photo + light cache');
  cacheBtn.addEventListener('click', async () => {
    await cacheClear();
    cacheBtn.textContent = 'Cleared (reload to re-develop)';
  });

  const video = h(
    'div',
    { class: 'fe-form' },
    ...row('Look', segOf('look', [['photo', 'Photo'], ['ps1', 'PS1']], (v) => updateSettings(lookPreset(v as Settings['look'])))),
    ...row('Render res', segOf('res', [['240', '240p'], ['360', '360p'], ['480', '480p'], ['720', '720p'], ['full', 'Full']])),
    ...row('Field of view', rangeOf('fov', 55, 100, 1, (v) => `${v}°`)),
    ...row('Vertex snap', checkOf('snap')),
    ...row('Texture warp', checkOf('affine')),
    ...row('Screen dither', checkOf('dither')),
    ...row('Grade', segOf('grade', [['natural', 'Natural'], ['warm', 'Warm'], ['duotone', 'Duotone']])),
    ...row('Time of day', segOf('time', [['map', 'Map'], ['night', 'Night'], ['overcast', 'Overcast'], ['dusk', 'Dusk']])),
    ...row('Show FPS', checkOf('showFps')),
    ...row('Cache', cacheBtn),
  );

  const controls = h(
    'div',
    { class: 'fe-form' },
    ...row('Sensitivity', rangeOf('sensitivity', 0.4, 8, 0.1, (v) => v.toFixed(1))),
    ...row('ADS sensitivity', rangeOf('adsSensitivity', 0.3, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`)),
    ...row('Invert look', checkOf('invertY')),
    ...row('Crouch toggle', checkOf('crouchToggle')),
  );

  // Key bindings: click, then press a key (Esc cancels, Backspace clears).
  let listening: { action: BindAction; btn: HTMLButtonElement } | null = null;
  const keyNote = h('div', { class: 'lf-status' });
  const keyRows: [BindAction, HTMLButtonElement][] = BINDABLE.map(([a]) => {
    const btn = h('button', { class: 'fe-key', type: 'button', 'aria-label': `Rebind ${a}` });
    btn.addEventListener('click', () => {
      if (listening) listening.btn.classList.remove('listening');
      listening = { action: a, btn };
      btn.classList.add('listening');
      btn.textContent = 'Press a key';
      keyNote.textContent = 'Esc cancels · Backspace clears';
    });
    return [a, btn];
  });
  const renderKeys = () => {
    for (const [a, btn] of keyRows) if (listening?.action !== a) btn.textContent = keyLabel(keyFor(a));
  };
  updates.push(renderKeys);
  const keys = h(
    'div',
    { class: 'fe-form' },
    ...BINDABLE.flatMap(([a, label], i) => row(label, keyRows[i]![1])),
    h('div', { class: 'fe-divider' }),
    h('span', { class: 'lab' }, 'Defaults'),
    h('button', { class: 'lf-btn small', type: 'button', onclick: () => (resetBinds(), refresh(), (keyNote.textContent = 'Bindings reset')) }, 'Reset all'),
  );
  const onKey = (e: KeyboardEvent) => {
    if (listening) {
      e.preventDefault();
      e.stopPropagation();
      const { action, btn } = listening;
      listening = null;
      btn.classList.remove('listening');
      if (e.code === 'Escape') keyNote.textContent = '';
      else if (e.code === 'Backspace') {
        setBind(action, null);
        keyNote.textContent = 'Back to default';
      } else {
        const clash = conflictFor(action, e.code);
        setBind(action, e.code);
        keyNote.textContent = clash ? `${keyLabel(e.code)} moved from ${BINDABLE.find(([x]) => x === clash)?.[1] ?? clash}` : '';
      }
      refresh();
      return;
    }
    if (e.code === 'Escape') back(params);
  };
  addEventListener('keydown', onKey, true);

  const audio = h(
    'div',
    { class: 'fe-form' },
    ...row('Master volume', rangeOf('volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)),
    ...row('Test', h('button', { class: 'lf-btn small', type: 'button', onclick: () => sfx.play('shot', { volume: 0.6 }) }, 'Play a shot')),
  );

  const panes: Record<Tab, HTMLElement> = { video, controls, keys: h('div', {}, keys, keyNote), audio };
  const labels: [Tab, string][] = [['video', 'Video'], ['controls', 'Controls'], ['keys', 'Key bindings'], ['audio', 'Audio']];
  const tabBtns = labels.map(([t, l]) => h('button', { class: 'fe-tab', type: 'button', role: 'tab', onclick: () => select(t) }, l));
  const panel = h('div', { class: 'lf-panel', role: 'tabpanel' });
  const select = (t: Tab) => {
    lastTab = t;
    labels.forEach(([x], i) => tabBtns[i]!.setAttribute('aria-selected', String(x === t)));
    panel.replaceChildren(panes[t]);
  };
  const done = h('button', { class: 'lf-btn primary', type: 'button', onclick: () => back(params) }, params.overlay === '1' ? 'Back to match' : 'Back');
  root.append(h('div', { class: `fe-page${params.overlay === '1' ? '' : ' lf-bg'}` }, h('h2', { class: 'lf-h2' }, 'Settings'), h('div', {}, h('div', { class: 'fe-tabs', role: 'tablist' }, ...tabBtns), panel), h('div', { class: 'fe-actions' }, done)));
  select(params.tab === 'keys' || params.tab === 'audio' || params.tab === 'controls' || params.tab === 'video' ? params.tab : lastTab);
  refresh();
  done.focus();
  return () => removeEventListener('keydown', onKey, true);
});
