/**
 * Zombies menus: the main menu entry ("Zombies"), the `zombies` screen (solo in one click, a private
 * co-op lobby with a code, matchmade co-op, join by code, map pick, your best round) and the
 * game-over results that take the place of the match summary in a Zombies match.
 */
import { MAP_BY_ID, mapsForMode } from '../../../shared/defs/maps';
import { ALLY_DIFFICULTIES, allyCount, allyDifficulty, ZOMBIES_ALLY, type AllyDifficulty } from '../../../shared/defs/zombies';
import type { MatchResults } from '../../../shared/events';
import type { Match } from '../../game/match';
import { h } from '../../menus/dom';
import { net } from '../../net';
import { registerMatchHook, registerMenuItem, registerScreen, screens, type ScreenMount } from '../../registry';
import { back, closeOverlay, navigate } from '../../router';
import { currentMatch } from '../../state';
import { isZombiesMatch } from './store';
import './zombies.css';

const MAP_KEY = 'lofi.zombies.map';
const ALLY_KEY = 'lofi.zombies.allies';

/** Solo's AI partners (count 0-3, difficulty), remembered per browser. */
function savedAllies(): { count: number; difficulty: AllyDifficulty } {
  try {
    const v = JSON.parse(localStorage.getItem(ALLY_KEY) ?? 'null') as { count?: unknown; difficulty?: unknown } | null;
    if (v) return { count: allyCount(v.count), difficulty: allyDifficulty(v.difficulty) };
  } catch {
    /* private mode, bad JSON */
  }
  return { count: ZOMBIES_ALLY.defaultCount, difficulty: ZOMBIES_ALLY.defaultDifficulty };
}

function savedMap(): string {
  try {
    const v = localStorage.getItem(MAP_KEY);
    if (v && mapsForMode('zombies').some((m) => m.id === v)) return v;
  } catch {
    /* private mode */
  }
  return 'nuketown';
}

registerMenuItem({ id: 'zombies.play', label: 'Zombies', hint: 'Solo / Co-op', order: 15, action: () => navigate('zombies') });

registerScreen('zombies', (root, params) => {
  let map = savedMap();
  const status = h('div', { class: 'lf-status', role: 'status' });
  const maps = h('div', { class: 'fe-list' });
  const busy = async (p: Promise<{ roomId: string }>) => {
    status.textContent = 'Opening the doors...';
    try {
      const t = await p;
      navigate('match', { room: t.roomId });
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
    }
  };
  const renderMaps = () => {
    maps.replaceChildren(
      ...mapsForMode('zombies').map((d) =>
        h(
          'button',
          {
            class: 'fe-li',
            type: 'button',
            'aria-pressed': String(d.id === map),
            onclick: () => {
              map = d.id;
              try {
                localStorage.setItem(MAP_KEY, map);
              } catch {
                /* ignore */
              }
              renderMaps();
            },
          },
          d.name,
          h('small', {}, d.size === 'small' ? 'Tight' : d.size === 'medium' ? 'Open' : 'Big'),
        ),
      ),
    );
  };
  renderMaps();
  const code = h('input', { class: 'fe-input', placeholder: 'Lobby code', maxlength: 64, 'aria-label': 'Lobby code', autocomplete: 'off', spellcheck: 'false' });
  const join = () => {
    const v = code.value.trim();
    if (v) void busy(net.rpc('frontend.resolveCode', { code: v }));
  };
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join();
  });
  const prof = net.profile;
  const best = prof?.stats['zombies.bestRound'] ?? 0;
  const kills = prof?.stats['mode.zombies.kills'] ?? 0;
  // Play with a bot partner: on by default in solo (1), 0-3 allies, and how good they are.
  const allies = savedAllies();
  const saveAllies = () => {
    try {
      localStorage.setItem(ALLY_KEY, JSON.stringify(allies));
    } catch {
      /* ignore */
    }
  };
  const partner = h('div', { class: 'zm-partner' });
  const renderPartner = () => {
    const seg = <T extends string | number>(label: string, opts: readonly T[], cur: T, name: (v: T) => string, set: (v: T) => void) =>
      h('div', { class: 'zm-seg', role: 'group', 'aria-label': label }, ...opts.map((o) => h('button', { class: 'zm-seg-b', type: 'button', 'aria-pressed': String(o === cur), onclick: () => { set(o); saveAllies(); renderPartner(); } }, name(o))));
    partner.replaceChildren(
      h('label', { class: 'zm-check' },
        h('input', { type: 'checkbox', checked: allies.count > 0, 'aria-label': 'Play with a bot partner', onchange: (e: Event) => { allies.count = (e.target as HTMLInputElement).checked ? Math.max(1, allies.count) : 0; saveAllies(); renderPartner(); } }),
        h('span', {}, 'Play with a bot partner'),
      ),
      ...(allies.count > 0
        ? [
            h('div', { class: 'zm-row' }, h('small', {}, 'Partners'), seg('Partners', [1, 2, 3] as const, allies.count as 1 | 2 | 3, (n) => String(n), (n) => (allies.count = n))),
            h('div', { class: 'zm-row' }, h('small', {}, 'Skill'), seg('Partner skill', ALLY_DIFFICULTIES, allies.difficulty, (d) => d[0]!.toUpperCase() + d.slice(1), (d) => (allies.difficulty = d))),
            h('p', { class: 'fe-small' }, 'They follow you, shoot zombies, revive you, buy with their own points and need reviving too.'),
          ]
        : []),
    );
  };
  renderPartner();
  const solo = h('button', { class: 'lf-btn primary zm-big', type: 'button', onclick: () => void busy(net.rpc('zombies.solo', { map, allies: allies.count, allyDifficulty: allies.difficulty })) }, 'Solo');
  root.append(
    h(
      'div',
      { class: 'fe-page lf-bg zm-page' },
      h('div', { class: 'fe-top' }, h('div', {}, h('h1', { class: 'lf-title zm-title' }, 'ZOMBIES'), h('div', { class: 'lf-sub' }, 'Round-based survival · BO1 rules · solo or 2-4 co-op'))),
      h(
        'div',
        { class: 'zm-grid' },
        h(
          'div',
          { class: 'fe-sub' },
          h('h3', { class: 'fe-h' }, 'Play'),
          solo,
          partner,
          h('div', { class: 'fe-list' },
            h('button', { class: 'fe-li', type: 'button', onclick: () => void busy(net.rpc('zombies.coop', { map })) }, 'Co-op lobby', h('small', {}, 'Invite friends by code')),
            h('button', { class: 'fe-li', type: 'button', onclick: () => void busy(net.rpc('frontend.matchmake', { playlist: 'zombies' })) }, 'Find a co-op game', h('small', {}, 'Matchmade, 2-4 players')),
          ),
          h('h3', { class: 'fe-h' }, 'Join a party'),
          h('div', { class: 'fe-code-row' }, code, h('button', { class: 'lf-btn small', type: 'button', onclick: join }, 'Join')),
        ),
        h('div', { class: 'fe-sub' }, h('h3', { class: 'fe-h' }, 'Map'), maps, h('h3', { class: 'fe-h' }, 'Record'), h('p', { class: 'fe-small' }, best ? `Best: round ${best} · ${kills.toLocaleString()} zombies killed` : 'No games yet. Start with the M1911 and 500 points.')),
      ),
      h(
        'div',
        { class: 'fe-sub zm-howto' },
        h('h3', { class: 'fe-h' }, 'How it works'),
        h('p', { class: 'fe-small' }, 'Hits pay 10, kills 60 (100 for a headshot, 130 with the knife). Hold USE at the chalk on the walls to buy guns or ammo, at a Perk-a-Cola for Juggernog, Speed Cola, Double Tap or Quick Revive, and at the Mystery Box (950) for a random gun. Watch out for the teddy bear. Every few rounds the hellhounds come.'),
      ),
      h('div', { class: 'fe-actions' }, h('button', { class: 'lf-btn', type: 'button', 'data-pad-back': '', onclick: () => back(params) }, 'Back'), status),
    ),
  );
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') back(params);
  };
  addEventListener('keydown', onKey);
  solo.focus();
  return () => removeEventListener('keydown', onKey);
});

// ---------------------------------------------------------------------------------------------
// Game over results (the summary overlay in a Zombies match)
// ---------------------------------------------------------------------------------------------

interface ZombiesExt {
  round: number;
  map: string;
  players: { id: string; name: string; bot: boolean; kills: number; headshots: number; downs: number; revives: number; points: number }[];
}

function renderResults(root: HTMLElement, m: Match, results: MatchResults, params: Record<string, string>): () => void {
  const ext = results.ext.zombies as ZombiesExt | undefined;
  const round = ext?.round ?? 1;
  const xp = results.ext.progression as Record<string, { total?: number; lines?: { label: string; xp: number }[] }> | undefined;
  const mine = xp?.[m.myId];
  const rows = (ext?.players ?? []).map((p) =>
    h('tr', { class: p.id === m.myId ? 'lfm-me' : '' }, h('td', { class: 'lfm-name' }, p.bot ? h('span', { class: 'lfm-tag' }, 'BOT') : null, p.name), h('td', {}, p.points.toLocaleString()), h('td', {}, String(p.kills)), h('td', {}, String(p.headshots)), h('td', {}, String(p.downs)), h('td', {}, String(p.revives))),
  );
  const cont = h('button', { class: 'lf-btn primary', type: 'button', 'data-pad-back': '', onclick: () => (params.overlay === '1' ? closeOverlay() : navigate('menu')) }, 'Continue');
  const leave = h('button', { class: 'lf-btn', type: 'button', onclick: () => navigate(screens.has('lobby') ? 'lobby' : 'menu') }, screens.has('lobby') ? 'Back to lobby' : 'Leave');
  const menu = h('button', { class: 'lf-btn', type: 'button', onclick: () => navigate('zombies') }, 'Zombies menu');
  root.append(
    h(
      'div',
      { class: 'lf-page lfm-summary zm-over', role: 'dialog', 'aria-label': 'Game over' },
      h('div', { class: 'lfm-head' }, h('h1', { class: 'lfm-title zm-title' }, 'GAME OVER'), h('div', { class: 'lf-sub' }, `${MAP_BY_ID.get(ext?.map ?? results.map)?.name ?? results.map} · Zombies`), h('div', { class: 'lfm-score zm-survived' }, `YOU SURVIVED ${round} ROUND${round === 1 ? '' : 'S'}`)),
      h(
        'div',
        { class: 'lfm-grid' },
        h('div', { class: 'lfm-tables' }, h('div', { class: 'lfm-table-wrap' }, h('table', { class: 'lfm-table' }, h('thead', {}, h('tr', {}, h('th', { class: 'lfm-name' }, 'Player'), h('th', {}, 'Points'), h('th', {}, 'Kills'), h('th', {}, 'Headshots'), h('th', {}, 'Downs'), h('th', {}, 'Revives'))), h('tbody', {}, ...rows)))),
        h('div', { class: 'lfm-side' }, h('div', { class: 'lfm-card lfm-xp' }, h('div', { class: 'lfm-label' }, 'XP earned'), ...(mine?.lines ?? []).map((l) => h('div', { class: 'lfm-xp-line' }, h('span', {}, l.label), h('b', {}, `+${l.xp.toLocaleString()}`))), h('div', { class: 'lfm-xp-line lfm-xp-total' }, h('span', {}, 'Total'), h('b', {}, `+${(mine?.total ?? 0).toLocaleString()}`)))),
      ),
      h('div', { class: 'lf-row' }, cont, leave, menu),
    ),
  );
  cont.focus();
  return () => {};
}

let wrapped = false;
let resultsOpen = false;
registerMatchHook('zombies.screens', {
  start() {
    if (!wrapped) {
      wrapped = true;
      const orig = screens.get('modes.summary');
      const mount: ScreenMount = (root, params) => {
        const m = currentMatch();
        const res = m?.results;
        if (m && isZombiesMatch(m) && res && res.mode === 'zombies') {
          resultsOpen = true;
          const off = renderResults(root, m, res, params);
          return () => {
            resultsOpen = false;
            off();
          };
        }
        return orig?.(root, params);
      };
      registerScreen('modes.summary', mount);
    }
    return () => {
      if (resultsOpen) closeOverlay();
    };
  },
  frame(m) {
    // The room moved on (back to the lobby, a new game): the results go.
    if (resultsOpen && m.phase !== 'ended') closeOverlay();
  },
});
