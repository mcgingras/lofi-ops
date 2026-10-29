/**
 * End-of-match summary screen (`modes.summary`, shown as an overlay over the ended match after
 * the final killcam): result banner, MVP card, final scoreboard with objective stats, this
 * player's XP breakdown, and Continue / Leave. It closes itself when the room moves on (next
 * match, or back to the lobby phase); Leave goes to the frontend's `lobby` screen if one is
 * registered, else the main menu.
 */
import type { Match } from '../../game/match';
import { h } from '../../menus/dom';
import { registerMatchHook, registerScreen, screens, summaryCards } from '../../registry';
import { closeOverlay, navigate, openOverlay, overlayOpen } from '../../router';
import { currentMatch } from '../../state';
import './modes.css';
import { modes } from './store';
import { buildSummaryView, ordinal, STAT_COLUMNS, type SummaryRow, type SummaryView } from './summary-data';

export const SUMMARY_SCREEN = 'modes.summary';
let open = false;

function table(view: SummaryView, rows: SummaryRow[], heading: HTMLElement | null): HTMLElement {
  const head = h('tr', {}, h('th', { class: 'lfm-name' }, 'Player'), h('th', {}, 'Score'), h('th', {}, 'K'), h('th', {}, 'D'), h('th', {}, 'A'), ...view.statKeys.map((k) => h('th', {}, STAT_COLUMNS[k] ?? k)));
  const body = rows.map((r) =>
    h(
      'tr',
      { class: `${r.me ? 'lfm-me' : ''}${r.mvp ? ' lfm-mvp-row' : ''}` },
      h('td', { class: 'lfm-name' }, r.bot ? h('span', { class: 'lfm-tag' }, 'BOT') : null, r.name, r.mvp ? h('span', { class: 'lfm-tag lfm-tag-hi' }, 'MVP') : null),
      h('td', {}, String(r.score)),
      h('td', {}, String(r.kills)),
      h('td', {}, String(r.deaths)),
      h('td', {}, String(r.assists)),
      ...view.statKeys.map((k) => h('td', {}, String(r.stats[k] ?? 0))),
    ),
  );
  return h('div', { class: 'lfm-table-wrap' }, heading, h('table', { class: 'lfm-table' }, h('thead', {}, head), h('tbody', {}, ...body)));
}

function render(root: HTMLElement, m: Match, params: Record<string, string>): () => void {
  const results = modes.results ?? m.results;
  if (!results) {
    root.append(h('div', { class: 'lf-page' }, h('div', { class: 'lf-banner' }, 'No results')));
    return () => {};
  }
  const view = buildSummaryView(results, m.myId, m.myTeam);
  const titleCls = view.title === 'VICTORY' ? 'lfm-win' : view.title === 'DEFEAT' ? 'lfm-lose' : '';
  let sub = `${view.modeName} · ${view.mapName} · ${view.reason}`;
  if (view.rounds !== undefined) sub += ` · ${view.rounds} ${view.rounds === 1 ? 'round' : 'rounds'}`;
  const scoreLine = view.teams
    ? h('div', { class: 'lfm-score' }, ...view.teams.flatMap((t, i) => [i ? h('span', { class: 'lfm-dash' }, '-') : null, h('span', { class: t.mine ? 'lfm-friend' : 'lfm-enemy' }, `${t.name.toUpperCase()} ${t.score}`)]))
    : view.me
      ? h('div', { class: 'lfm-score' }, h('span', { class: 'lfm-friend' }, `${ordinal(view.me.place)} OF ${view.rows.length}`))
      : null;

  const mvp = view.mvp
    ? h(
        'div',
        { class: 'lfm-card lfm-mvp' },
        h('div', { class: 'lfm-label' }, 'MVP'),
        h('div', { class: 'lfm-mvp-name' }, view.mvp.name),
        h('div', { class: 'lfm-mvp-stats' }, `${view.mvp.score} PTS · ${view.mvp.kills}-${view.mvp.deaths}`, ...view.statKeys.filter((k) => (view.mvp!.stats[k] ?? 0) > 0).map((k) => ` · ${view.mvp!.stats[k]} ${STAT_COLUMNS[k]}`)),
      )
    : null;

  const xp = h(
    'div',
    { class: 'lfm-card lfm-xp' },
    h('div', { class: 'lfm-label' }, 'XP earned'),
    ...view.xp.map((l) => h('div', { class: 'lfm-xp-line' }, h('span', {}, l.label), h('b', {}, `+${l.amount.toLocaleString()}`))),
    h('div', { class: 'lfm-xp-line lfm-xp-total' }, h('span', {}, 'Total'), h('b', {}, `+${view.xpTotal.toLocaleString()}`)),
  );

  // Other areas' cards (the economy's wager results); a throwing card is skipped, not fatal.
  const extra = [...summaryCards.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ card }) => {
      try {
        return card(results, m.myId);
      } catch (err) {
        console.error('[summary card]', err);
        return null;
      }
    });

  const tables = view.teams
    ? view.teams.map((t) => table(view, t.rows, h('div', { class: `lfm-team ${t.mine ? 'lfm-friend' : 'lfm-enemy'}` }, `${t.name.toUpperCase()} · ${t.score}`)))
    : [table(view, view.rows, null)];

  const countdown = h('div', { class: 'lf-hint' });
  const leaveTarget = screens.has('lobby') ? 'lobby' : 'menu';
  const cont = h('button', { class: 'lf-btn primary', type: 'button', 'data-pad-back': '', onclick: () => (params.overlay === '1' ? closeOverlay() : navigate('menu')) }, 'Continue');
  const leave = h('button', { class: 'lf-btn', type: 'button', onclick: () => navigate(leaveTarget) }, leaveTarget === 'lobby' ? 'Back to lobby' : 'Leave match');

  root.append(
    h(
      'div',
      { class: 'lf-page lfm-summary', role: 'dialog', 'aria-label': 'Match summary' },
      h('div', { class: 'lfm-head' }, h('h1', { class: `lfm-title ${titleCls}` }, view.title), h('div', { class: 'lf-sub' }, sub), scoreLine),
      h('div', { class: 'lfm-grid' }, h('div', { class: 'lfm-tables' }, ...tables), h('div', { class: 'lfm-side' }, ...extra, mvp, xp)),
      h('div', { class: 'lf-row' }, cont, leave, countdown),
    ),
  );
  cont.focus();
  const tick = setInterval(() => {
    const mm = currentMatch();
    if (mm && mm.phase === 'ended' && mm.phaseEndsAt !== null) countdown.textContent = `Next up in ${Math.max(0, Math.ceil(mm.phaseEndsAt - mm.serverTime))}`;
    else countdown.textContent = '';
  }, 250);
  return () => clearInterval(tick);
}

registerScreen(SUMMARY_SCREEN, (root, params) => {
  const m = currentMatch();
  if (!m) {
    navigate('menu');
    return;
  }
  open = true;
  const off = render(root, m, params);
  return () => {
    open = false;
    off();
  };
});

/** True while the summary overlay is up. */
export const summaryOpen = () => open;

registerMatchHook('modes.summary', {
  start: () => () => {
    if (open) closeOverlay();
  },
  frame(m) {
    if (m.phase === 'ended') {
      // After the killcam (or straight away when there is none), once per match.
      const waiting = !!modes.killcam && !modes.killcamDone;
      if (!modes.summaryShown && (modes.results || m.results) && !waiting && !overlayOpen()) {
        modes.summaryShown = true;
        if (!modes.results) modes.results = m.results;
        m.controls.releaseLock();
        openOverlay(SUMMARY_SCREEN);
      }
    } else if (open) closeOverlay();
  },
});
