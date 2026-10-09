/**
 * In-match class picker (screen 'class-picker', shown as an overlay): press the class key (B by
 * default, rebindable) any time in a match, or on the death screen (controller: Y while dead).
 * The pick applies at the next spawn (server: `frontend.selectClass`). A HUD hint shows the key
 * while dead.
 */
import { KILLSTREAK_BY_ID } from '../../../shared/defs/killstreaks';
import { classSlotsFor } from '../../../shared/frontend/loadout-rules';
import { PERK_BY_ID } from '../../../shared/defs/perks';
import { WEAPON_BY_ID } from '../../../shared/defs/weapons';
import type { Loadout } from '../../../shared/loadout';
import { gamepad, PAD, PadEdges } from '../../game/gamepad';
import { promptKey, registerPromptKey } from '../../game/prompts';
import { HUD_COLORS, txt, unit } from '../../hud/draw';
import { net } from '../../net';
import { deathcamPlaying } from '../modes/deathcam';
import { registerHudWidget, registerScreen } from '../../registry';
import { closeOverlay, currentScreen, openOverlay, overlayOpen } from '../../router';
import { currentMatch } from '../../state';
import { keyFor } from './keybinds';

registerPromptKey('classMenu', () => keyFor('classMenu'));
import { errText, h } from './ui';

/** Class chosen this life (shown on the death screen until the next spawn). */
let pending: string | null = null;
net.on('spawned', () => (pending = null));

const wName = (id: string) => WEAPON_BY_ID.get(id)?.name ?? id;
export function loadoutSummary(l: Loadout): string {
  const atts = l.primary.attachments.length ? ` +${l.primary.attachments.length}` : '';
  return `${wName(l.primary.weapon)}${atts} · ${wName(l.secondary.weapon)} · ${l.perks.map((p) => PERK_BY_ID.get(p)?.name ?? p).join(', ') || 'no perks'} · ${l.killstreaks.map((k) => KILLSTREAK_BY_ID.get(k)?.kills ?? '?').join('/') || 'no streaks'}`;
}

const overlayId = () => (overlayOpen() ? (document.getElementById('overlay')?.dataset.screen ?? null) : null);

registerScreen('class-picker', (root) => {
  const p = net.profile;
  const status = h('div', { class: 'lf-status' });
  const close = () => {
    closeOverlay();
    currentMatch()?.controls.requestLock();
  };
  // Only classes the spawn honours (progression's usable count).
  const items = (p?.loadouts ?? []).slice(0, p ? classSlotsFor(p) : 0).map((l, i) =>
    h(
      'button',
      {
        class: 'fe-li',
        type: 'button',
        'aria-pressed': String(i === p?.selectedLoadout),
        onclick: async () => {
          try {
            const r = await net.rpc('frontend.selectClass', { index: i });
            if (net.profile) net.profile.selectedLoadout = r.selectedLoadout;
            pending = l.name;
            close();
          } catch (err) {
            status.textContent = errText(err);
          }
        },
      },
      h('span', {}, `${i + 1}. ${l.name}`),
      h('small', {}, loadoutSummary(l)),
    ),
  );
  const onKey = (e: KeyboardEvent) => {
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= items.length) {
      e.preventDefault();
      items[n - 1]!.click();
    }
  };
  addEventListener('keydown', onKey);
  root.append(
    h(
      'div',
      { class: 'fe-page fe-picker-overlay' },
      h('h2', { class: 'lf-h2' }, 'Choose class'),
      h('p', { class: 'fe-small fe-dim' }, 'Takes effect on your next spawn.'),
      h('div', { class: 'fe-list' }, ...items),
      status,
      h('div', { class: 'fe-actions' }, h('button', { class: 'lf-btn', type: 'button', 'data-pad-back': '', onclick: close }, 'Cancel')),
    ),
  );
  (items[p?.selectedLoadout ?? 0] as HTMLElement | undefined)?.focus();
  return () => removeEventListener('keydown', onKey);
});

// The class key toggles the picker during a match (not in the lobby phase: the lobby has its own).
addEventListener('keydown', (e) => {
  if (e.repeat || e.code !== keyFor('classMenu')) return;
  const m = currentMatch();
  if (!m || currentScreen() !== 'match' || m.phase === 'lobby') return;
  const ov = overlayId();
  if (ov === 'class-picker') {
    e.preventDefault();
    closeOverlay();
    m.controls.requestLock();
  } else if (ov === null) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    m.controls.releaseLock();
    openOverlay('class-picker');
  }
});

// Controller: Y on the death screen opens the picker (Y is weapon switch while alive).
const padEdges = new PadEdges();
gamepad.onFrame((s) => {
  const pressed = padEdges.update(s);
  if (!pressed.has(PAD.Y)) return;
  const m = currentMatch();
  if (!m || currentScreen() !== 'match' || m.phase !== 'playing' || m.alive || !m.death || deathcamPlaying() || overlayId() !== null) return;
  m.controls.releaseLock();
  openOverlay('class-picker');
});

registerHudWidget(
  'frontend.classHint',
  (g, W, H) => {
    const m = currentMatch();
    if (!m || m.alive || !m.death || m.phase !== 'playing' || deathcamPlaying()) return;
    const u = unit(H);
    const y = Math.round(H * 0.68);
    txt(g, `PRESS ${promptKey('classMenu')} TO CHANGE CLASS`, W / 2, y, 8, HUD_COLORS.paper, 'center', u);
    if (pending) txt(g, `NEXT SPAWN: ${pending.toUpperCase()}`, W / 2, y + 10 * u, 8, HUD_COLORS.hi, 'center', u);
  },
  81,
);
