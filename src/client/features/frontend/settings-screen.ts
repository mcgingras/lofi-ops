/**
 * Settings (replaces the core 'settings' screen): tabs for Graphics (Retro strength preset with
 * an Advanced panel for its knobs, grade, time of day, FOV), Controls (sensitivity, ADS sensitivity, invert, crouch
 * toggle), Key bindings (rebind any action, incl. the class menu key) and Audio. Same persisted
 * settings as core (settings.ts); works as a page or as an overlay over a match.
 */
import { sfx } from '../../game/audio';
import { cacheClear } from '../../render/idb';
import { adoptToken, currentToken, formatRecoveryCode, net, normalizeRecoveryCode } from '../../net';
import { registerScreen } from '../../registry';
import { back } from '../../router';
import { knobPatch, presetSettings, RETRO_BLURBS, RETRO_LABELS, RETRO_RANGES, type RetroKnobs, type RetroPreset } from '../../render/retro';
import { settings, updateSettings, type Settings } from '../../settings';
import { BINDABLE, conflictFor, keyFor, keyLabel, resetBinds, setBind, type BindAction } from './keybinds';
import { h, seg, slider } from './ui';

type Tab = 'video' | 'controls' | 'keys' | 'audio' | 'account';
let lastTab: Tab = 'video';
let advancedOpen = false;

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

  // Retro strength: presets set the knobs; Advanced edits single knobs (the preset then reads Custom).
  const knob = <K extends keyof RetroKnobs>(key: K, v: RetroKnobs[K]) => {
    updateSettings(knobPatch(settings, { [key]: v } as Partial<RetroKnobs>));
    refresh();
  };
  const knobSeg = <K extends keyof RetroKnobs>(key: K, opts: [RetroKnobs[K] & string, string][]) => {
    const s = seg(opts, () => settings[key] as RetroKnobs[K] & string, (v) => knob(key, v), String(key));
    updates.push(() => s.update());
    return s;
  };
  // Sliders that re-develop textures apply on release; the cheap ones apply while dragging.
  const knobRange = <K extends 'ditherStrength' | 'vertexSnap' | 'affineWarp' | 'fogScale'>(key: K, fmt: (v: number) => string, onRelease = false) => {
    const r = RETRO_RANGES[key];
    const s = slider(r.min, r.max, r.step, () => settings[key], (v, final) => {
      if (final || !onRelease) knob(key, v);
    }, fmt, String(key));
    updates.push(() => s.update());
    return s;
  };
  const presetSeg = seg(
    (['off', 'subtle', 'classic', 'ps1'] as RetroPreset[]).map((id) => [id, RETRO_LABELS[id]] as [RetroPreset, string]),
    () => settings.retro as RetroPreset,
    (id) => {
      updateSettings(presetSettings(id));
      refresh();
    },
    'Retro strength',
  );
  updates.push(() => presetSeg.update());
  const blurb = h('p', { class: 'fe-help', 'aria-live': 'polite' });
  updates.push(() => (blurb.textContent = `${RETRO_LABELS[settings.retro]}: ${RETRO_BLURBS[settings.retro]}`));
  const advToggle = h('input', { type: 'checkbox', 'aria-label': 'Show advanced retro settings' });
  const advanced: HTMLElement[] = [
    ...row('Render res', knobSeg('res', [['240', '240p'], ['360', '360p'], ['480', '480p'], ['720', '720p'], ['full', 'Full']])),
    ...row('Palette', knobSeg('palette', [['full', 'Full'], ['32', '32 col'], ['16', '16 col'], ['15bit', '15-bit']])),
    ...row('Dither', knobSeg('ditherType', [['pattern', 'Crosshatch'], ['bayer', 'Bayer'], ['none', 'None']])),
    ...row('Dither strength', knobRange('ditherStrength', (v) => `${Math.round(v * 100)}%`, true)),
    ...row('Vertex snap', knobRange('vertexSnap', (v) => (v ? `${v} px` : 'Off'))),
    ...row('Texture warp', knobRange('affineWarp', (v) => (v ? `${Math.round(v * 100)}%` : 'Off'))),
    ...row('Fog distance', knobRange('fogScale', (v) => `${v.toFixed(2)}×`)),
    ...row('Texture filter', knobSeg('texFilter', [['pixel', 'Pixel'], ['pixel-mip', 'Pixel + mips'], ['smooth', 'Smooth']])),
    ...row('Textures', segOf('look', [['photo', 'Photo'], ['ps1', 'Drawn']])),
  ];
  const showAdvanced = () => {
    advToggle.checked = advancedOpen;
    for (const el of advanced) el.hidden = !advancedOpen;
  };
  advToggle.addEventListener('change', () => {
    advancedOpen = advToggle.checked;
    showAdvanced();
  });
  showAdvanced();

  const video = h(
    'div',
    { class: 'fe-form' },
    ...row('Retro strength', presetSeg),
    h('span', {}),
    blurb,
    ...row('Advanced', advToggle),
    ...advanced,
    ...row('Field of view', rangeOf('fov', 55, 100, 1, (v) => `${v}°`)),
    ...row('Grade', segOf('grade', [['map', 'Map'], ['natural', 'Natural'], ['warm', 'Warm'], ['duotone', 'Duotone']])),
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
    ...row('Test', h('button', { class: 'lf-btn small', type: 'button', onclick: () => (sfx.unlock(), sfx.gunshot('m16')) }, 'Play a shot')),
  );

  const panes: Record<Tab, HTMLElement> = { video, controls, keys: h('div', {}, keys, keyNote), audio, account: accountPane() };
  const labels: [Tab, string][] = [['video', 'Graphics'], ['controls', 'Controls'], ['keys', 'Key bindings'], ['audio', 'Audio'], ['account', 'Account']];
  const tabBtns = labels.map(([t, l]) => h('button', { class: 'fe-tab', type: 'button', role: 'tab', onclick: () => select(t) }, l));
  const panel = h('div', { class: 'lf-panel', role: 'tabpanel' });
  const select = (t: Tab) => {
    lastTab = t;
    labels.forEach(([x], i) => tabBtns[i]!.setAttribute('aria-selected', String(x === t)));
    panel.replaceChildren(panes[t]);
  };
  const done = h('button', { class: 'lf-btn primary', type: 'button', onclick: () => back(params) }, params.overlay === '1' ? 'Back to match' : 'Back');
  root.append(h('div', { class: `fe-page${params.overlay === '1' ? '' : ' lf-bg'}` }, h('h2', { class: 'lf-h2' }, 'Settings'), h('div', {}, h('div', { class: 'fe-tabs', role: 'tablist' }, ...tabBtns), panel), h('div', { class: 'fe-actions' }, done)));
  select(params.tab === 'keys' || params.tab === 'audio' || params.tab === 'controls' || params.tab === 'video' || params.tab === 'account' ? params.tab : lastTab);
  refresh();
  done.focus();
  return () => removeEventListener('keydown', onKey, true);
});


/**
 * Account tab: this browser's recovery code (the guest token, shown in groups) with Show/Copy, and
 * "Use a recovery code" to move to an existing account on this device. The server checks a code
 * with POST /api/recover before we switch, so a typo never lands you on a fresh empty account.
 */
function accountPane(): HTMLElement {
  const token = currentToken();
  const code = token ? formatRecoveryCode(token) : null;
  const masked = code ? code.replace(/[0-9A-F]/g, '•').slice(0, -4) + code.slice(-4) : 'Not signed in yet';
  const codeEl = h('code', { class: 'fe-code', 'aria-live': 'polite' }, masked);
  let shown = false;
  const showBtn = h('button', { class: 'lf-btn small', type: 'button' }, 'Show');
  showBtn.addEventListener('click', () => {
    if (!code) return;
    shown = !shown;
    codeEl.textContent = shown ? code : masked;
    showBtn.textContent = shown ? 'Hide' : 'Show';
  });
  const copyNote = h('span', { class: 'lf-status' });
  const copyBtn = h('button', { class: 'lf-btn small', type: 'button' }, 'Copy');
  copyBtn.addEventListener('click', async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      copyNote.textContent = 'Copied. Keep it somewhere safe, like a password manager.';
    } catch {
      shown = true;
      codeEl.textContent = code;
      showBtn.textContent = 'Hide';
      const range = document.createRange();
      range.selectNodeContents(codeEl);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      copyNote.textContent = 'Copy blocked by the browser. The code is selected: press Ctrl+C or Cmd+C.';
    }
  });
  if (!code) [showBtn, copyBtn].forEach((b) => (b.disabled = true));

  const input = h('input', { id: 'recover-code', class: 'fe-input', type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'XXXX-XXXX-XXXX-…', 'aria-label': 'Recovery code' });
  const checkBtn = h('button', { class: 'lf-btn small', type: 'button' }, 'Check code');
  const result = h('div', { class: 'lf-status', role: 'status' });
  const switchBtn = h('button', { class: 'lf-btn primary', type: 'button', hidden: true }, 'Switch to this account');
  let pending: string | null = null;
  const check = async () => {
    switchBtn.hidden = true;
    pending = null;
    const norm = normalizeRecoveryCode(input.value);
    if (!norm) {
      result.textContent = "That doesn't look like a recovery code. It's 48 letters and numbers, usually in groups of four.";
      return;
    }
    if (norm === token) {
      result.textContent = "That's the account you're already on.";
      return;
    }
    checkBtn.disabled = true;
    result.textContent = 'Checking…';
    try {
      const res = await fetch('/api/recover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: norm }) });
      const body = (await res.json()) as { ok: boolean; name?: string; level?: number; prestige?: number; error?: string };
      if (!body.ok) {
        result.textContent = body.error ?? 'No account uses that code.';
        return;
      }
      pending = norm;
      const pres = body.prestige ? ` · Prestige ${body.prestige}` : '';
      result.textContent = `Found ${body.name} · Level ${body.level}${pres}. Switching leaves this browser's current account (${net.profile?.name ?? 'guest'}) reachable only with its own code, so copy it first if you want to keep it.`;
      switchBtn.hidden = false;
    } catch {
      result.textContent = "Couldn't reach the server. Check your connection and try again.";
    } finally {
      checkBtn.disabled = false;
    }
  };
  checkBtn.addEventListener('click', check);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') check();
  });
  switchBtn.addEventListener('click', () => {
    if (!pending) return;
    if (!adoptToken(pending)) {
      result.textContent = "This browser won't save the code (private mode?). Try a normal window.";
      return;
    }
    result.textContent = 'Switching…';
    location.hash = '#/';
    location.reload();
  });

  return h(
    'div',
    { class: 'fe-form fe-account' },
    h('label', {}, 'Your recovery code'),
    h('div', { class: 'fe-code-row' }, codeEl, showBtn, copyBtn),
    h('span', {}),
    h('p', { class: 'fe-help' }, 'Your stats, unlocks, classes and CoD Points belong to this code. Save it: it is the only way back to this account if you clear your browser data, and the way to play as yourself on another device. Anyone with the code can use your account.'),
    h('span', {}),
    copyNote,
    h('div', { class: 'fe-divider' }),
    h('label', { for: 'recover-code' }, 'Use a recovery code'),
    h('div', { class: 'fe-code-row' }, input, checkBtn),
    h('span', {}),
    result,
    h('span', {}),
    switchBtn,
  );
}
