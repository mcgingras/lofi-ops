/**
 * Core settings screen (`settings`): look (Photo / PS1 preset and the individual toggles),
 * render resolution, grade, FOV, sensitivity, volume, time of day, controls. Persisted by
 * settings.ts. Works as a page or as an overlay over a running match.
 */
import { lookPreset, settings, updateSettings, type Settings } from '../settings';
import { cacheClear } from '../render/idb';
import { registerScreen } from '../registry';
import { back } from '../router';
import { h } from './dom';

type Opt<T extends string> = [T, string];

function seg<K extends keyof Settings>(key: K, opts: Opt<string>[], onPick?: (v: string) => void): HTMLElement {
  const wrap = h('div', { class: 'lf-seg', role: 'group' });
  const render = () => {
    wrap.replaceChildren(
      ...opts.map(([v, label]) =>
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(settings[key] === v),
            onclick: () => {
              if (onPick) onPick(v);
              else updateSettings({ [key]: v } as Partial<Settings>);
              renderAll();
            },
          },
          label,
        ),
      ),
    );
  };
  renders.push(render);
  render();
  return wrap;
}

function range<K extends keyof Settings>(key: K, min: number, max: number, step: number, fmt: (v: number) => string): HTMLElement {
  const val = h('span', { class: 'val' });
  const input = h('input', { type: 'range', min, max, step, 'aria-label': String(key) });
  const render = () => {
    input.value = String(settings[key]);
    val.textContent = fmt(Number(settings[key]));
  };
  input.addEventListener('input', () => {
    updateSettings({ [key]: Number(input.value) } as Partial<Settings>);
    val.textContent = fmt(Number(input.value));
  });
  renders.push(render);
  render();
  return h('div', { class: 'lf-row' }, input, val);
}

function check<K extends keyof Settings>(key: K): HTMLElement {
  const input = h('input', { type: 'checkbox', 'aria-label': String(key) });
  const render = () => {
    input.checked = Boolean(settings[key]);
  };
  input.addEventListener('change', () => updateSettings({ [key]: input.checked } as Partial<Settings>));
  renders.push(render);
  render();
  return input;
}

let renders: (() => void)[] = [];
const renderAll = () => renders.forEach((r) => r());

registerScreen('settings', (root, params) => {
  renders = [];
  const cacheBtn = h('button', { class: 'lf-btn small', type: 'button' }, 'Clear photo + light cache');
  cacheBtn.addEventListener('click', async () => {
    await cacheClear();
    cacheBtn.textContent = 'Cleared (reload to re-develop)';
  });
  const row = (label: string, el: HTMLElement) => [h('label', {}, label), el];
  const form = h(
    'div',
    { class: 'lf-form' },
    ...row('Look', seg('look', [['photo', 'Photo'], ['ps1', 'PS1']], (v) => updateSettings(lookPreset(v as Settings['look'])))),
    ...row('Render res', seg('res', [['240', '240p'], ['360', '360p'], ['480', '480p'], ['720', '720p'], ['full', 'Full']])),
    ...row('Vertex snap', check('snap')),
    ...row('Texture warp', check('affine')),
    ...row('Screen dither', check('dither')),
    ...row('Grade', seg('grade', [['natural', 'Natural'], ['warm', 'Warm'], ['duotone', 'Duotone']])),
    ...row('Time of day', seg('time', [['map', 'Map'], ['night', 'Night'], ['overcast', 'Overcast'], ['dusk', 'Dusk']])),
    ...row('Field of view', range('fov', 55, 100, 1, (v) => `${v}°`)),
    ...row('Sensitivity', range('sensitivity', 0.4, 8, 0.1, (v) => v.toFixed(1))),
    ...row('ADS sensitivity', range('adsSensitivity', 0.3, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`)),
    ...row('Invert look', check('invertY')),
    ...row('Crouch toggle', check('crouchToggle')),
    ...row('Volume', range('volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)),
    ...row('Show FPS', check('showFps')),
    ...row('Cache', cacheBtn),
  );
  const done = h('button', { class: 'lf-btn primary', type: 'button', onclick: () => back(params) }, params.overlay === '1' ? 'Back to match' : 'Back');
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape') back(params);
  };
  addEventListener('keydown', onKey);
  root.append(h('div', { class: `lf-page${params.overlay === '1' ? '' : ' lf-bg'}` }, h('h2', { class: 'lf-h2' }, 'Settings'), h('div', { class: 'lf-panel' }, form), h('div', { class: 'lf-row' }, done)));
  done.focus();
  return () => removeEventListener('keydown', onKey);
});
