/**
 * Core match screen (`match`, params: mode, map?, room?): joins (quick play or a room id), then
 * runs a `Match` on the shared renderer. DOM only for the states around play: finding a match,
 * "click to deploy" (pointer lock needs a click), the Esc pause menu, errors.
 */
import { Match } from '../game/match';
import { net } from '../net';
import { registerScreen } from '../registry';
import { navigate, openOverlay, overlayOpen } from '../router';
import { client } from '../state';
import { h } from './dom';

registerScreen('match', (root, params) => {
  const renderer = client.renderer;
  if (!renderer) {
    navigate('menu');
    return;
  }
  const mode = params.mode ?? 'tdm';
  let match: Match | null = null;
  let started = false;
  let everLocked = false;
  const center = h('div', { class: 'lf-center' });
  root.append(center);

  const show = (...nodes: (Node | string)[]) => center.replaceChildren(...nodes);
  const banner = (text: string) => h('div', { class: 'lf-banner' }, text);
  const btn = (label: string, fn: () => void, primary = false) => h('button', { class: `lf-btn interactive${primary ? ' primary' : ''}`, type: 'button', onclick: fn }, label);

  const update = () => {
    if (!match) return;
    center.classList.remove('lf-pause');
    if (match.controls.locked || overlayOpen()) return show();
    if (!everLocked) return show(banner(match.loading ? `${match.loading}...` : 'Click to deploy'));
    center.classList.add('lf-pause');
    show(
      h('h2', { class: 'lf-h2' }, 'Paused'),
      h('div', { class: 'lf-col interactive' }, btn('Resume', () => match?.controls.requestLock(), true), btn('Settings', () => openOverlay('settings')), btn('Leave match', () => navigate('menu'))),
      h('div', { class: 'lf-hint' }, 'The match keeps going while paused.'),
    );
  };

  const start = () => {
    if (started) return;
    started = true;
    show(banner(params.room ? 'Joining...' : `Finding ${mode.toUpperCase()} match...`));
    if (params.room) net.joinRoom(params.room);
    else net.quickplay(mode, params.map);
  };

  const offs = [
    net.onStatus((s) => {
      if (s === 'online') start();
      else if (!match) show(banner(s === 'waking' ? 'Waking server...' : 'Connecting...'));
    }),
    net.on('joined', (m) => {
      if (match) return;
      match = new Match(renderer, m);
      offs.push(
        match.controls.onLock((locked) => {
          if (locked) everLocked = true;
          update();
        }),
      );
      update();
      const poll = setInterval(() => {
        if (!match || everLocked) return clearInterval(poll);
        update();
      }, 250);
    }),
    net.on('left', (m) => {
      if (m.reason === 'disconnect') {
        match?.dispose();
        match = null;
        started = false;
        show(banner('Connection lost. Reconnecting...'), btn('Back to menu', () => navigate('menu')));
        return;
      }
      navigate('menu');
    }),
    net.on('error', (m) => {
      if (match) return;
      show(banner(`Could not join: ${m.message}`), btn('Back to menu', () => navigate('menu'), true));
    }),
  ];

  // Settings overlay closing should bring back the pause menu.
  const obs = new MutationObserver(() => update());
  const overlayEl = document.getElementById('overlay');
  if (overlayEl) obs.observe(overlayEl, { attributes: true, attributeFilter: ['hidden'] });

  return () => {
    obs.disconnect();
    for (const off of offs) off();
    if (match) match.leave();
    match = null;
  };
});
