/**
 * BO1-style wager results: a card in the end-of-match summary (IN THE MONEY / OUT OF THE MONEY,
 * where you placed among everyone, bots included, the CP won or lost and the new balance, then the
 * final placings with the money cut line), and the sound (sounds.ts) when the payout arrives.
 */
import type { EconomyResultsExt } from '../../../shared/defs/economy-net';
import { sfx } from '../../game/audio';
import './sounds';
import { h } from '../../menus/dom';
import { net } from '../../net';
import { onFeature, registerSummaryCard } from '../../registry';
import { cp } from './store-screen';

/** The last payout push (it carries the settled balance). */
let lastPayout: { total: number; codPoints: number } | null = null;
onFeature('economy.award', (d) => {
  if (d.reason !== 'payout') return;
  lastPayout = { total: d.total, codPoints: d.codPoints };
  sfx.play(d.total > 0 ? 'economy.cash' : 'economy.bust', { volume: 0.9 });
});

registerSummaryCard(
  'economy.wager',
  (results, myId) => {
    const w = (results.ext.economy as EconomyResultsExt | undefined)?.wager;
    if (!w) return null;
    if (w.practice) return h('div', { class: 'lfm-card ec-result' }, h('div', { class: 'lfm-label' }, 'Wager'), h('div', { class: 'ec-result-title' }, 'PRACTICE'), h('div', { class: 'ec-dim' }, 'Nothing at stake, nothing paid'));
    const mine = w.lines.find((l) => l.id === myId);
    const line = (k: string, v: string, cls = '') => h('div', { class: `ec-result-line ${cls}` }, h('span', {}, k), h('b', {}, v));
    const signed = (n: number) => `${n >= 0 ? '+' : '-'}${cp(Math.abs(n))}`;
    const paid = w.payouts.length;
    const balance = lastPayout?.codPoints ?? net.profile?.codPoints;
    const head = mine
      ? [
          h('div', { class: `ec-result-title ${mine.payout > 0 ? 'in' : 'out'}` }, mine.payout > 0 ? 'IN THE MONEY' : 'OUT OF THE MONEY'),
          line('Placed', `#${mine.rank} of ${w.entrants}`),
          line('Ante', `-${cp(mine.ante)}`),
          line('Payout', cp(mine.payout)),
          line(mine.net >= 0 ? 'Won' : 'Lost', signed(mine.net)),
          balance !== undefined ? line('New balance', cp(balance)) : null,
        ]
      : [h('div', { class: 'ec-result-title' }, 'NOT STAKED')];
    const placings = w.placings.flatMap((p, i) => [
      i === paid && paid > 0 ? h('div', { class: 'ec-dim' }, 'OUT OF THE MONEY') : null,
      h(
        'div',
        { class: `ec-result-line${p.id === myId ? ' me' : ''}${i === paid ? ' cut' : ''}${p.bot ? ' bot' : ''}`, title: p.bot && p.payout > 0 ? 'A bot\'s share goes back to the house' : undefined },
        h('span', {}, `#${p.rank} ${p.bot ? '[BOT] ' : ''}${p.name}`),
        h('b', {}, p.payout > 0 ? cp(p.payout) : '-'),
      ),
    ]);
    return h(
      'div',
      { class: 'lfm-card ec-result', role: 'group', 'aria-label': 'Wager results' },
      h('div', { class: 'lfm-label' }, `Wager · pot ${cp(w.pot)}`),
      ...head,
      h('div', { class: 'ec-dim' }, `IN THE MONEY: top ${paid} of ${w.entrants}${w.house > 0 ? ` · ${cp(w.house)} back to the house` : ''}`),
      ...placings,
      w.forfeits.length ? h('div', { class: 'ec-dim' }, `Forfeited: ${w.forfeits.join(', ')}`) : null,
    );
  },
  -10,
);
