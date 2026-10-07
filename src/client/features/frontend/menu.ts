/**
 * Main menu in the CoD style (replaces the core 'menu' screen): Multiplayer (Quick Play playlists,
 * Wager, Play with Bots, Private Match, Join by code), Create a Class, Barracks, Store, Settings,
 * plus any feature `registerMenuItem` entries. Screens owned by other areas open by id
 * ('barracks', 'store', 'wager'); a placeholder shows until they exist.
 */
import { PLAYLISTS, playlistMode } from '../../../shared/frontend/playlists';
import { net, type NetStatus } from '../../net';
import { onDevelopProgress } from '../../render/textures';
import { menuItems, registerScreen } from '../../registry';
import { back, navigate } from '../../router';
import { createPrivate, joinByCode, quickPlay } from './lobby-client';
import { emblem, errText, go, h } from './ui';

const STATUS_TEXT: Record<NetStatus, string> = {
  idle: '',
  connecting: 'Connecting...',
  waking: 'Waking server... (retrying)',
  online: '',
  offline: 'Server offline. Retrying...',
};

type Panel = 'mp' | null;

registerScreen('menu', (root) => {
  const status = h('div', { class: 'lf-status', role: 'status' });
  const dev = h('div', { class: 'lf-status' });
  const profileEl = h('div', { class: 'fe-profile' });
  const sub = h('div', { class: 'fe-sub', id: 'fe-mp' });
  let panel: Panel = 'mp';
  let population: Record<string, number> = {};
  let online = net.status === 'online';
  const busy = (p: Promise<unknown>) => p.catch((err) => (status.textContent = errText(err)));

  const renderProfile = () => {
    const p = net.profile;
    profileEl.replaceChildren();
    if (!p) return;
    const name = h('button', { class: 'lf-chip', type: 'button', title: 'Change name', style: 'cursor:pointer' }, p.name);
    name.addEventListener('click', async () => {
      const n = prompt('Display name (2-16 characters)', p.name)?.trim();
      if (!n || n === p.name) return;
      try {
        await net.setName(n);
        renderProfile();
      } catch (err) {
        status.textContent = errText(err);
      }
    });
    profileEl.append(emblem(p.prestige, null, true), name, h('span', { class: 'lf-chip' }, 'Level ', h('b', {}, String(p.level))));
    if (p.prestige) profileEl.append(h('span', { class: 'lf-chip' }, 'Prestige ', h('b', {}, String(p.prestige))));
    profileEl.append(h('span', { class: 'lf-chip' }, h('b', {}, p.codPoints.toLocaleString()), ' CP'));
  };

  const codeInput = h('input', { class: 'fe-input', placeholder: 'Lobby code', maxlength: 64, 'aria-label': 'Lobby code', autocomplete: 'off', spellcheck: 'false' });
  const joinCode = () => {
    const v = codeInput.value.trim();
    if (!v) return codeInput.focus();
    void busy(joinByCode(v));
  };
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinCode();
  });

  const renderSub = () => {
    sub.hidden = panel !== 'mp';
    if (panel !== 'mp') return;
    const playlists = PLAYLISTS.map((p) => {
      const mode = playlistMode(p);
      const n = population[p.id] ?? 0;
      return h(
        'button',
        { class: 'fe-li', type: 'button', disabled: !mode || !online, title: p.description, onclick: () => void busy(quickPlay(p.id)) },
        p.name,
        h('small', {}, mode ? (n > 0 ? `${n} playing` : p.description) : 'Coming soon'),
      );
    });
    sub.replaceChildren(
      h('h3', { class: 'fe-h' }, 'Quick Play'),
      h('div', { class: 'fe-list' }, ...playlists),
      h('h3', { class: 'fe-h' }, 'More'),
      h(
        'div',
        { class: 'fe-list' },
        h('button', { class: 'fe-li', type: 'button', onclick: () => go('wager') }, 'Wager Matches', h('small', {}, 'CoD Points on the line')),
        h('button', { class: 'fe-li', type: 'button', disabled: !online, onclick: () => void busy(createPrivate({ mode: 'tdm', bots: true })) }, 'Play with Bots', h('small', {}, 'Tune bot skill, start now')),
        h('button', { class: 'fe-li', type: 'button', disabled: !online, onclick: () => void busy(createPrivate({ mode: 'tdm' })) }, 'Private Match', h('small', {}, 'Invite friends by code')),
      ),
      h('h3', { class: 'fe-h' }, 'Join a party'),
      h('div', { class: 'fe-code-row' }, codeInput, h('button', { class: 'lf-btn small', type: 'button', disabled: !online, onclick: joinCode }, 'Join')),
    );
  };

  const nav = (label: string, hint: string, action: () => void, current = false) => h('button', { class: 'fe-nav-item', type: 'button', 'aria-current': String(current), onclick: action }, label, hint ? h('small', {}, hint) : null);
  const mpBtn = nav('Multiplayer', '', () => {
    panel = panel === 'mp' ? null : 'mp';
    mpBtn.setAttribute('aria-current', String(panel === 'mp'));
    renderSub();
  }, true);
  // Feature entries this menu already has (Barracks, Store, Wager, Play with Bots, the Quick Play
  // playlists) would show up twice, the Quick Play ones bypassing matchmaking: leave them out.
  const covered = (id: string) => id.startsWith('core.') || id.startsWith('modes.') || ['bots.play', 'economy.wager', 'economy.store', 'progression.barracks'].includes(id);
  const extra = [...menuItems.values()].filter((it) => !covered(it.id)).sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  const navEl = h(
    'nav',
    { class: 'fe-nav', 'aria-label': 'Main menu' },
    mpBtn,
    nav('Create a Class', '', () => navigate('create-a-class')),
    nav('Barracks', '', () => go('barracks')),
    nav('Store', '', () => go('store')),
    ...extra.map((it) => nav(it.label, it.hint ?? '', () => it.action())),
    nav('Settings', '', () => navigate('settings')),
  );

  root.append(
    h(
      'div',
      { class: 'fe-page lf-bg' },
      h('div', { class: 'fe-top' }, h('div', {}, h('h1', { class: 'lf-title' }, 'LO-FI ', h('b', {}, 'OPS')), h('div', { class: 'lf-sub' }, 'Container yard · 2010 rules · photo grain')), profileEl),
      h('div', { class: 'fe-menu' }, navEl, sub),
      status,
      dev,
      h('div', { class: 'lf-spacer' }),
      h('div', { class: 'lf-hint' }, h('kbd', {}, 'WASD'), ' move · ', h('kbd', {}, 'Shift'), ' sprint · ', h('kbd', {}, 'C'), ' crouch · mouse fire / aim · ', h('kbd', {}, 'R'), ' reload · ', h('kbd', {}, 'Tab'), ' scores · ', h('kbd', {}, 'B'), ' change class · ', h('kbd', {}, 'Esc'), ' pause. Textures from Poly Haven (CC0).'),
    ),
  );
  renderProfile();
  renderSub();
  mpBtn.focus();

  const refreshPopulation = () => {
    if (net.status !== 'online') return;
    net
      .rpc('frontend.playlists', {})
      .then((r) => {
        population = Object.fromEntries(r.playlists.map((p) => [p.id, p.players]));
        renderSub();
      })
      .catch(() => {});
  };
  const popTimer = setInterval(refreshPopulation, 5000);
  const offs = [
    net.onStatus((s) => {
      status.textContent = STATUS_TEXT[s];
      status.classList.toggle('warn', s === 'offline' || s === 'waking');
      online = s === 'online';
      renderProfile();
      renderSub();
      if (online) refreshPopulation();
    }),
    net.on('profile', () => renderProfile()),
    net.on('welcome', () => renderProfile()),
    onDevelopProgress((d, t) => {
      dev.textContent = t > 0 && d < t ? `Developing photos ${d} / ${t}` : '';
    }),
  ];
  return () => {
    clearInterval(popTimer);
    for (const off of offs) off();
  };
});

/** Placeholder for screens other areas haven't registered yet. */
registerScreen('frontend.soon', (root, params) => {
  const what = params.what ?? 'this screen';
  const names: Record<string, string> = { barracks: 'Barracks', store: 'Store', wager: 'Wager Matches' };
  root.append(
    h(
      'div',
      { class: 'fe-page lf-bg' },
      h('h2', { class: 'lf-h2' }, names[what] ?? what),
      h('div', { class: 'lf-panel' }, h('p', { class: 'fe-small fe-dim' }, `${names[what] ?? what} is being built by another squad. Check back after the next deploy.`)),
      h('div', { class: 'fe-actions' }, h('button', { class: 'lf-btn primary', type: 'button', onclick: () => back(params) }, 'Back')),
    ),
  );
});
