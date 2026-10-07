/**
 * Core main menu (screen `menu`): title, profile line, the registered menu items (quick play TDM /
 * FFA, settings, plus anything features add with `registerMenuItem`), connection and photo
 * developing status. The frontend feature may replace the whole screen with registerScreen('menu').
 */
import { net, type NetStatus } from '../net';
import { onDevelopProgress } from '../render/textures';
import { menuItems, registerMenuItem, registerScreen } from '../registry';
import { navigate } from '../router';
import { h } from './dom';

registerMenuItem({ id: 'core.tdm', label: 'Quick Play', hint: 'Team Deathmatch', order: 10, primary: true, action: () => navigate('match', { mode: 'tdm' }) });
registerMenuItem({ id: 'core.ffa', label: 'Quick Play', hint: 'Free-for-all', order: 20, action: () => navigate('match', { mode: 'ffa' }) });
registerMenuItem({ id: 'core.settings', label: 'Settings', order: 90, action: () => navigate('settings') });

const STATUS_TEXT: Record<NetStatus, string> = {
  idle: '',
  connecting: 'Connecting...',
  waking: 'Waking server... (retrying)',
  online: '',
  offline: 'Server offline. Retrying...',
};

registerScreen('menu', (root) => {
  const profileLine = h('div', { class: 'lf-row' });
  const status = h('div', { class: 'lf-status', role: 'status' });
  const dev = h('div', { class: 'lf-status' });
  const items = [...menuItems.values()].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  const buttons = items.map((it) => h('button', { class: `lf-btn${it.primary ? ' primary' : ''}`, type: 'button', onclick: () => it.action() }, it.label, it.hint ? h('small', {}, it.hint) : null));

  const renderProfile = () => {
    const p = net.profile;
    profileLine.replaceChildren();
    if (!p) return;
    const name = h('button', { class: 'lf-chip', type: 'button', title: 'Change name', style: 'cursor:pointer' }, p.name);
    name.addEventListener('click', async () => {
      const n = prompt('Display name (2-16 characters)', p.name)?.trim();
      if (!n || n === p.name) return;
      try {
        await net.setName(n);
        renderProfile();
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : 'could not rename';
      }
    });
    profileLine.append(name, h('span', { class: 'lf-chip' }, 'Level ', h('b', {}, String(p.level))));
    if (p.prestige) profileLine.append(h('span', { class: 'lf-chip' }, 'Prestige ', h('b', {}, String(p.prestige))));
    profileLine.append(h('span', { class: 'lf-chip' }, h('b', {}, p.codPoints.toLocaleString()), ' CP'));
  };

  root.append(
    h(
      'div',
      { class: 'lf-page lf-bg' },
      h('div', {}, h('h1', { class: 'lf-title' }, 'LO-FI ', h('b', {}, 'OPS')), h('div', { class: 'lf-sub' }, 'Container yard · 2010 rules · photo grain')),
      profileLine,
      h('nav', { class: 'lf-col', 'aria-label': 'Main menu' }, ...buttons),
      status,
      dev,
      h('div', { class: 'lf-spacer' }),
      h(
        'div',
        { class: 'lf-hint' },
        'Click to lock aim · ',
        h('kbd', {}, 'WASD'),
        ' move · ',
        h('kbd', {}, 'Shift'),
        ' sprint · ',
        h('kbd', {}, 'C'),
        ' crouch · ',
        h('kbd', {}, 'Space'),
        ' jump · mouse fire / aim · ',
        h('kbd', {}, 'R'),
        ' reload · ',
        h('kbd', {}, '1'),
        h('kbd', {}, '2'),
        ' weapons · ',
        h('kbd', {}, 'Tab'),
        ' scores · ',
        h('kbd', {}, 'Esc'),
        ' pause. Textures from Poly Haven (CC0).',
      ),
    ),
  );
  (buttons[0] as HTMLElement | undefined)?.focus();

  const offStatus = net.onStatus((s) => {
    status.textContent = STATUS_TEXT[s];
    status.classList.toggle('warn', s === 'offline' || s === 'waking');
    for (const b of buttons) b.toggleAttribute('disabled', s !== 'online');
    renderProfile();
  });
  const offProfile = net.on('profile', () => renderProfile());
  const offWelcome = net.on('welcome', () => renderProfile());
  const offDev = onDevelopProgress((d, t) => {
    dev.textContent = t > 0 && d < t ? `Developing photos ${d} / ${t}` : '';
  });
  return () => {
    offStatus();
    offProfile();
    offWelcome();
    offDev();
  };
});
