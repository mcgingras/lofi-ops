/**
 * The Barracks screen (`barracks`, params: tab = levels | prestige | challenges | record): every
 * level 1-50 with what it unlocks (plus attachment progress per weapon), the 15 prestige tiers with
 * their emblems and Enter Prestige, every challenge with progress bars (filter by category, mode,
 * weapon, search), and the combat record. Reads the live profile (`net.profile`); works as a page
 * or as an overlay (`openOverlay('barracks')`).
 */
import './barracks.css';
import {
  challengeList,
  challengeTotals,
  currentGoal,
  describeChallenge,
  roman,
  tierCp,
  tierGoals,
  tierName,
  tiersDone,
  tierXp,
  type ChallengeCategory,
  type ChallengeDef,
} from '../../../shared/defs/challenges';
import { KILLSTREAK_BY_ID, KILLSTREAKS } from '../../../shared/defs/killstreaks';
import { MODE_BY_ID, MODES } from '../../../shared/defs/modes';
import { canPrestige, levelProgress, MAX_LEVEL, MAX_PRESTIGE, PRESTIGE_NAMES, rankFor, readProgressionExt, XP_TABLE, xpToNext } from '../../../shared/defs/progression';
import { attachmentUnlocks, isUnlocked, PRESTIGE_CLASS_SLOTS, unlockTable, weaponKillsOf, type UnlockEntry } from '../../../shared/defs/unlocks';
import { WEAPON_BY_ID, WEAPONS } from '../../../shared/defs/weapons';
import type { Profile } from '../../../shared/profile';
import { h } from '../../menus/dom';
import { net } from '../../net';
import { registerMenuItem, registerScreen } from '../../registry';
import { back, navigate } from '../../router';
import { badgePixels, pixelCanvas, prestigeEmblemPixels, rankPixels } from './emblems';

type Tab = 'levels' | 'prestige' | 'challenges' | 'record';
const TABS: [Tab, string][] = [
  ['levels', 'Levels'],
  ['prestige', 'Prestige'],
  ['challenges', 'Challenges'],
  ['record', 'Combat Record'],
];

const CATEGORIES: [ChallengeCategory | 'all', string][] = [
  ['all', 'All'],
  ['career', 'Career'],
  ['mode', 'Modes'],
  ['weapon', 'Weapons'],
  ['killstreak', 'Streaks'],
  ['perk', 'Pro Perks'],
];

/** Filters survive leaving and re-entering the screen. */
const filters = { cat: 'all' as ChallengeCategory | 'all', mode: 'all', weapon: 'all', hideDone: false, q: '' };
const PAGE = 120;

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '-');
const ratio = (a: number, b: number) => (b > 0 ? (a / b).toFixed(2) : a > 0 ? a.toFixed(2) : '-');
const stat = (p: Profile, k: string) => p.stats[k] ?? 0;
function duration(sec: number): string {
  const m = Math.floor(sec / 60);
  const hr = Math.floor(m / 60);
  return hr > 0 ? `${hr}h ${m % 60}m` : `${m}m`;
}

function bar(frac: number, label?: string): HTMLElement {
  const fill = h('i', { style: `width:${Math.max(0, Math.min(1, frac)) * 100}%` });
  const el = h('div', { class: 'pg-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(Math.max(0, Math.min(1, frac)) * 100) }, fill);
  if (label) el.setAttribute('aria-label', label);
  return el;
}

function chip(u: UnlockEntry, locked: boolean): HTMLElement {
  return h('span', { class: `pg-u${locked ? ' locked' : ''}`, 'data-kind': u.kind, title: `${u.kind}${u.detail ? `: ${u.detail}` : ''}` }, u.name, u.detail ? h('small', {}, u.detail) : null);
}

// ---------------------------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------------------------

function levelsTab(p: Profile): HTMLElement[] {
  const byLevel = new Map<number, UnlockEntry[]>();
  for (const u of unlockTable()) {
    const l = byLevel.get(u.level);
    if (l) l.push(u);
    else byLevel.set(u.level, [u]);
  }
  const rows: HTMLElement[] = [];
  for (let L = 1; L <= MAX_LEVEL; L++) {
    const r = rankFor(L);
    const done = p.level >= L;
    const items = byLevel.get(L) ?? [];
    rows.push(
      h(
        'div',
        { class: `pg-level${done ? ' done' : ' locked'}${p.level === L ? ' current' : ''}`, 'aria-current': p.level === L ? 'step' : undefined },
        pixelCanvas(rankPixels(L), 32, r.title),
        h('div', { class: 'pg-lv' }, h('b', {}, `Level ${L}`), h('span', {}, `${r.title}${r.from === L ? '' : ` ${roman(r.step)}`}`), h('span', {}, L === 1 ? 'Start' : `${fmt(XP_TABLE[L]!)} XP`)),
        h('div', { class: 'pg-chips' }, ...(items.length ? items.map((u) => chip(u, !done)) : [h('span', { class: 'pg-empty' }, '-')])),
      ),
    );
  }
  const weapons = WEAPONS.filter((w) => w.attachments.length).map((w) => {
    const kills = weaponKillsOf(p, w.id);
    const atts = attachmentUnlocks(w.id);
    const next = atts.find((a) => a.kills > kills);
    return h(
      'div',
      { class: 'pg-weapon' },
      h('div', { class: 'pg-lv' }, h('b', {}, w.name), h('span', {}, `${fmt(kills)} kills since prestige`), next ? h('span', {}, `Next: ${next.name} at ${fmt(next.kills)}`) : h('span', {}, 'All attachments open')),
      h('div', { class: 'pg-chips' }, ...atts.map((a) => chip({ level: 0, kind: 'attachment', id: a.id, name: a.name, detail: a.kills ? `${fmt(a.kills)} kills` : 'start' }, !isUnlocked(p, 'attachment', a.id, w.id)))),
    );
  });
  return [
    h('p', { class: 'pg-note' }, 'Weapons, perks, killstreaks and equipment open by level. Attachments open with kills on each weapon. Create-a-Class at level 4, more class slots at 10, 20, 30 and 40.'),
    h('div', { class: 'pg-list' }, ...rows),
    h('h3', { class: 'pg-sec' }, 'Attachments'),
    h('div', { class: 'pg-list' }, ...(weapons.length ? weapons : [h('span', { class: 'pg-empty' }, 'No attachments yet')])),
  ];
}

function prestigeTab(p: Profile, rerender: () => void): HTMLElement[] {
  const ext = readProgressionExt(p);
  const status = h('div', { class: 'lf-status', role: 'status' });
  let armed = false;
  const eligible = canPrestige(p);
  const enter = h('button', { class: `lf-btn${eligible ? ' primary' : ''}`, type: 'button', disabled: !eligible }, eligible ? `Enter Prestige ${p.prestige + 1}` : p.prestige >= MAX_PRESTIGE ? 'Master Prestige reached' : `Reach level ${MAX_LEVEL} to prestige`);
  enter.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      enter.textContent = `Confirm: reset to level 1 as Prestige ${p.prestige + 1}`;
      status.textContent = 'Click again to confirm. This cannot be undone.';
      status.classList.add('warn');
      return;
    }
    enter.setAttribute('disabled', '');
    status.textContent = 'Entering prestige...';
    try {
      net.profile = await net.rpc('progression.prestige', {});
      rerender();
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'Could not prestige';
      enter.removeAttribute('disabled');
      armed = false;
    }
  });

  const showEmblem = async (id: string | null) => {
    try {
      const res = await net.rpc('progression.setEmblem', { emblem: id });
      const e = (p.ext.progression ??= { weaponKills: {} }) as { emblem?: string };
      if (res.emblem) e.emblem = res.emblem;
      else delete e.emblem;
      rerender();
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'Could not change emblem';
    }
  };

  const current = p.prestige > 0 ? pixelCanvas(prestigeEmblemPixels(p.prestige), 96, `Prestige ${p.prestige} emblem`) : pixelCanvas(rankPixels(p.level), 96, rankFor(p.level).title);
  const panel = h(
    'div',
    { class: 'pg-ppanel' },
    current,
    h(
      'div',
      {},
      h('h3', { class: 'lf-h2' }, p.prestige > 0 ? `Prestige ${p.prestige}: ${PRESTIGE_NAMES[p.prestige]}` : 'No prestige yet'),
      h(
        'ul',
        {},
        h('li', {}, h('b', {}, 'Resets: '), 'level and XP, weapon / perk / killstreak unlocks, attachment progress'),
        h('li', {}, h('b', {}, 'Keeps: '), 'CoD Points, challenge records, combat record, store purchases'),
        h('li', {}, h('b', {}, 'Grants: '), 'the next prestige emblem, plus an extra class slot at prestige ', PRESTIGE_CLASS_SLOTS.join(', ')),
      ),
      h('div', { class: 'lf-row' }, enter),
      status,
    ),
  );

  const cards: HTMLElement[] = [];
  for (let i = 1; i <= MAX_PRESTIGE; i++) {
    const earned = p.prestige >= i;
    const id = `prestige_${i}`;
    const shown = ext.emblem === id;
    const card = h(
      'div',
      { class: `pg-pcard${earned ? ' earned' : ' locked'}${p.prestige === i ? ' current' : ''}${shown ? ' shown' : ''}` },
      pixelCanvas(prestigeEmblemPixels(i), 72, `Prestige ${i} emblem`),
      h('b', {}, `Prestige ${i}`),
      h('span', {}, PRESTIGE_NAMES[i] ?? ''),
      h('span', {}, earned ? (p.prestige === i ? 'Current' : 'Earned') : 'Locked'),
      PRESTIGE_CLASS_SLOTS.includes(i) ? h('span', {}, '+1 class slot') : null,
    );
    if (earned) card.append(h('button', { class: 'lf-btn small', type: 'button', onclick: () => void showEmblem(shown ? null : id) }, shown ? 'Hide' : 'Display'));
    cards.push(card);
  }
  return [panel, h('h3', { class: 'pg-sec' }, 'Prestige emblems'), h('div', { class: 'pg-pgrid' }, ...cards)];
}

function challengeMatchesFilter(c: ChallengeDef, progress: number): boolean {
  if (filters.cat !== 'all' && (c.category ?? 'career') !== filters.cat) return false;
  if (filters.mode !== 'all' && c.mode !== filters.mode) return false;
  if (filters.weapon !== 'all') {
    const f = filters.weapon;
    const classMatch = !!c.weaponClass && !c.weapon && WEAPON_BY_ID.get(f)?.class === c.weaponClass;
    if (c.weapon !== f && c.killstreak !== f && !classMatch) return false;
  }
  if (filters.hideDone && tiersDone(c, progress) >= tierGoals(c).length) return false;
  if (filters.q) {
    const q = filters.q.toLowerCase();
    if (!c.name.toLowerCase().includes(q) && !(c.description ?? '').toLowerCase().includes(q)) return false;
  }
  return true;
}

function challengeRow(c: ChallengeDef, progress: number): HTMLElement {
  const goals = tierGoals(c);
  const done = tiersDone(c, progress);
  const complete = done >= goals.length;
  const idx = Math.min(done, goals.length - 1);
  const goal = currentGoal(c, progress);
  const tags = [c.mode ? (MODE_BY_ID.get(c.mode)?.short ?? c.mode) : null, c.weapon ? (WEAPON_BY_ID.get(c.weapon)?.name ?? KILLSTREAK_BY_ID.get(c.weapon)?.name ?? c.weapon) : null, goals.length > 1 ? `Tier ${roman(Math.min(done + 1, goals.length))} of ${goals.length}` : null].filter(Boolean).join(' · ');
  const cp = tierCp(c, idx);
  const reward = complete ? 'Complete' : `+${fmt(tierXp(c, idx))} XP${cp ? ` +${fmt(cp)} CP` : ''}`;
  return h(
    'div',
    { class: `pg-ch${complete ? ' complete' : ''}` },
    h('div', {}, h('h4', {}, tierName(c, idx)), h('p', {}, describeChallenge(c, idx)), tags ? h('span', { class: 'pg-tag' }, tags) : null),
    h('div', { class: 'pg-prog' }, h('div', { class: 'row' }, h('b', {}, `${fmt(Math.min(progress, goal))} / ${fmt(goal)}`), h('span', {}, reward)), bar(complete ? 1 : progress / goal, `${c.name} progress`)),
  );
}

function challengesTab(p: Profile, rerenderBody: () => void): HTMLElement[] {
  const list = challengeList();
  const progress = p.challengeProgress;
  const totals = challengeTotals(progress);

  const cat = h('div', { class: 'lf-seg', role: 'group', 'aria-label': 'Category' });
  for (const [id, label] of CATEGORIES) {
    cat.append(
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(filters.cat === id),
          onclick: () => {
            filters.cat = id;
            rerenderBody();
          },
        },
        label,
      ),
    );
  }
  const modeIds = [...new Set(list.map((c) => c.mode).filter((m): m is string => !!m))];
  const modeSel = h('select', { 'aria-label': 'Mode' }, h('option', { value: 'all' }, 'All modes'), ...modeIds.map((m) => h('option', { value: m }, MODE_BY_ID.get(m)?.name ?? m)));
  modeSel.value = filters.mode;
  modeSel.addEventListener('change', () => {
    filters.mode = modeSel.value;
    rerenderBody();
  });
  const weaponSel = h(
    'select',
    { 'aria-label': 'Weapon' },
    h('option', { value: 'all' }, 'All weapons'),
    ...WEAPONS.map((w) => h('option', { value: w.id }, w.name)),
    ...KILLSTREAKS.map((k) => h('option', { value: k.id }, `${k.name} (streak)`)),
  );
  weaponSel.value = filters.weapon;
  weaponSel.addEventListener('change', () => {
    filters.weapon = weaponSel.value;
    rerenderBody();
  });
  const hide = h('input', { type: 'checkbox' });
  hide.checked = filters.hideDone;
  hide.addEventListener('change', () => {
    filters.hideDone = hide.checked;
    rerenderBody();
  });
  const search = h('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search challenges' });
  search.value = filters.q;
  let t: ReturnType<typeof setTimeout> | null = null;
  search.addEventListener('input', () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      filters.q = search.value.trim();
      rerenderBody();
      document.querySelector<HTMLInputElement>('.pg-filters input[type=search]')?.focus();
    }, 200);
  });

  const shown = list.filter((c) => challengeMatchesFilter(c, progress[c.id] ?? 0));
  // Closest to completion first, finished ones last.
  const order = (c: ChallengeDef) => {
    const pr = progress[c.id] ?? 0;
    if (tiersDone(c, pr) >= tierGoals(c).length) return 2;
    return 1 - Math.min(1, pr / currentGoal(c, pr));
  };
  shown.sort((a, b) => order(a) - order(b));
  const listEl = h('div', { class: 'pg-list' });
  let count = 0;
  const more = h('button', { class: 'lf-btn small pg-more', type: 'button' }, 'Show more');
  const page = () => {
    for (const c of shown.slice(count, count + PAGE)) listEl.append(challengeRow(c, progress[c.id] ?? 0));
    count = Math.min(shown.length, count + PAGE);
    more.hidden = count >= shown.length;
  };
  more.addEventListener('click', page);
  page();

  return [
    h('p', { class: 'pg-note' }, `${fmt(totals.done)} of ${fmt(totals.total)} tiers complete · ${fmt(totals.challengesDone)} of ${fmt(totals.challenges)} challenges finished. Challenges carry over through prestige.`),
    h('div', { class: 'pg-filters' }, cat, modeSel, weaponSel, search, h('label', {}, hide, 'Hide complete'), h('span', {}, `${shown.length} shown`)),
    shown.length ? listEl : h('span', { class: 'pg-empty' }, 'Nothing matches these filters'),
    more,
  ];
}

function recordTab(p: Profile): HTMLElement[] {
  const s = (k: string) => stat(p, k);
  const kills = s('kills');
  const deaths = s('deaths');
  const tile = (value: string, label: string) => h('div', { class: 'pg-tile' }, h('b', {}, value), h('span', {}, label));
  const tiles = h(
    'div',
    { class: 'pg-tiles' },
    tile(fmt(kills), 'Kills'),
    tile(fmt(deaths), 'Deaths'),
    tile(ratio(kills, deaths), 'K/D ratio'),
    tile(fmt(s('assists')), 'Assists'),
    tile(fmt(s('headshots')), `Headshots (${pct(s('headshots'), kills)})`),
    tile(pct(s('hits'), s('shots')), 'Accuracy'),
    tile(fmt(s('wins')), 'Wins'),
    tile(fmt(s('losses')), 'Losses'),
    tile(ratio(s('wins'), s('losses')), 'W/L ratio'),
    tile(fmt(s('matches')), 'Matches'),
    tile(duration(s('timePlayed')), 'Time played'),
    tile(fmt(s('bestStreak')), 'Best streak'),
    tile(fmt(s('score')), 'Score'),
    tile(s('timePlayed') > 0 ? fmt((s('score') / s('timePlayed')) * 60) : '-', 'Score / min'),
    tile(fmt(s('longshots')), 'Longshots'),
    tile(fmt(s('firstBloods')), 'First bloods'),
    tile(fmt(s('revenges')), 'Revenges'),
    tile(fmt(s('doubleKills')), 'Double kills'),
    tile(fmt(s('tripleKills')), 'Triple kills'),
    tile(fmt(s('meleeKills')), 'Melee kills'),
    tile(fmt(s('streaksEarned')), 'Streaks earned'),
  );

  const weaponIds = new Set(WEAPONS.map((w) => w.id));
  for (const k of Object.keys(p.stats)) {
    const m = /^weapon\.([^.]+)\.kills$/.exec(k);
    if (m) weaponIds.add(m[1]!);
  }
  const weaponRows = [...weaponIds]
    .map((id) => ({ id, kills: s(`weapon.${id}.kills`) }))
    .sort((a, b) => b.kills - a.kills)
    .map(({ id, kills: k }) =>
      h(
        'tr',
        { class: k ? '' : 'zero' },
        h('td', {}, WEAPON_BY_ID.get(id)?.name ?? id),
        h('td', {}, fmt(k)),
        h('td', {}, fmt(s(`weapon.${id}.headshots`))),
        h('td', {}, pct(s(`weapon.${id}.headshots`), k)),
        h('td', {}, pct(s(`weapon.${id}.hits`), s(`weapon.${id}.shots`))),
        h('td', {}, fmt(weaponKillsOf(p, id))),
      ),
    );

  const modeIds = new Set(MODES.map((m) => m.id));
  for (const k of Object.keys(p.stats)) {
    const m = /^mode\.([^.]+)\.matches$/.exec(k);
    if (m) modeIds.add(m[1]!);
  }
  const modeRows = [...modeIds].map((id) => {
    const g = (k: string) => s(`mode.${id}.${k}`);
    return h(
      'tr',
      { class: g('matches') ? '' : 'zero' },
      h('td', {}, MODE_BY_ID.get(id)?.name ?? id),
      h('td', {}, fmt(g('matches'))),
      h('td', {}, fmt(g('wins'))),
      h('td', {}, fmt(g('losses'))),
      h('td', {}, ratio(g('wins'), g('losses'))),
      h('td', {}, fmt(g('kills'))),
      h('td', {}, ratio(g('kills'), g('deaths'))),
      h('td', {}, fmt(g('score'))),
      h('td', {}, duration(g('timePlayed'))),
      h('td', {}, fmt(g('bestStreak'))),
    );
  });
  const table = (head: string[], rows: HTMLElement[]) => h('div', { class: 'pg-tablewrap' }, h('table', { class: 'pg-table' }, h('thead', {}, h('tr', {}, ...head.map((x) => h('th', { scope: 'col' }, x)))), h('tbody', {}, ...rows)));
  return [
    tiles,
    h('h3', { class: 'pg-sec' }, 'Weapons'),
    table(['Weapon', 'Kills', 'Headshots', 'HS %', 'Accuracy', 'Since prestige'], weaponRows),
    h('h3', { class: 'pg-sec' }, 'Game modes'),
    table(['Mode', 'Matches', 'Wins', 'Losses', 'W/L', 'Kills', 'K/D', 'Score', 'Time', 'Best streak'], modeRows),
  ];
}

// ---------------------------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------------------------

registerScreen('barracks', (root, params) => {
  let tab: Tab = TABS.some(([id]) => id === params.tab) ? (params.tab as Tab) : 'levels';
  const head = h('header', { class: 'pg-head' });
  const tabs = h('div', { class: 'lf-seg', role: 'tablist', 'aria-label': 'Barracks' });
  const body = h('section', { class: 'pg-body', role: 'tabpanel' });
  const done = h('button', { class: 'lf-btn primary', type: 'button', onclick: () => back(params) }, params.overlay === '1' ? 'Back to match' : 'Back');

  const renderHead = () => {
    const p = net.profile;
    head.replaceChildren();
    if (!p) return;
    const r = rankFor(p.level);
    const into = p.level >= MAX_LEVEL ? 0 : p.xp - XP_TABLE[p.level]!;
    const need = xpToNext(p.level);
    head.append(
      pixelCanvas(badgePixels(p.level, p.prestige), 64, p.prestige ? `Prestige ${p.prestige}` : r.title),
      h(
        'div',
        { class: 'pg-who' },
        h('div', { class: 'pg-name' }, p.name),
        h('div', { class: 'pg-rank' }, 'Level ', h('b', {}, String(p.level)), ` · ${r.title}`, p.prestige ? h('span', {}, ' · Prestige ', h('b', {}, String(p.prestige))) : null),
        h('div', { class: 'pg-xp', role: 'progressbar', 'aria-label': 'Level progress', 'aria-valuenow': Math.round(levelProgress(p.xp) * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: `width:${levelProgress(p.xp) * 100}%` })),
        h('div', { class: 'pg-xpnum' }, need ? `${fmt(into)} / ${fmt(need)} XP to level ${p.level + 1} · ${fmt(p.xp)} total` : `Max level · ${fmt(p.xp)} XP`),
      ),
      h('span', { class: 'lf-chip' }, h('b', {}, fmt(p.codPoints)), ' CP'),
    );
  };

  const renderTabs = () => {
    tabs.replaceChildren(
      ...TABS.map(([id, label]) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            'aria-selected': String(tab === id),
            'aria-pressed': String(tab === id),
            onclick: () => {
              tab = id;
              if (params.overlay !== '1') history.replaceState(null, '', `#/barracks?tab=${id}`);
              renderTabs();
              renderBody();
            },
          },
          label,
        ),
      ),
    );
  };

  const renderBody = () => {
    const p = net.profile;
    if (!p) {
      body.replaceChildren(h('div', { class: 'lf-status' }, 'Connecting...'));
      return;
    }
    const content = tab === 'levels' ? levelsTab(p) : tab === 'prestige' ? prestigeTab(p, renderAll) : tab === 'challenges' ? challengesTab(p, renderBody) : recordTab(p);
    body.replaceChildren(...content);
  };

  const renderAll = () => {
    renderHead();
    renderTabs();
    renderBody();
  };

  root.append(h('div', { class: `lf-page pg-page${params.overlay === '1' ? '' : ' lf-bg'}` }, h('div', { class: 'pg-top' }, h('h2', { class: 'lf-h2' }, 'Barracks'), done), head, tabs, body));
  renderAll();

  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape') back(params);
  };
  addEventListener('keydown', onKey);
  const offs = [net.on('profile', renderAll), net.on('welcome', renderAll)];
  return () => {
    removeEventListener('keydown', onKey);
    for (const off of offs) off();
  };
});

registerMenuItem({
  id: 'progression.barracks',
  label: 'Barracks',
  order: 40,
  get hint() {
    const p = net.profile;
    return p ? `Level ${p.level}${p.prestige ? ` · P${p.prestige}` : ''}` : 'Levels, challenges, record';
  },
  action: () => navigate('barracks'),
});
