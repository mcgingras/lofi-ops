/**
 * WAGER lobby screen (`wager`): pick a wager mode and an ante tier, tune the bots that backfill
 * empty slots, then queue (`economy.wagerQueue`) and jump into the room's match screen, where the
 * lobby phase shows players, the pot and the start countdown (HUD widget economy.wager).
 */
import { BOT_DIFFICULTIES, BOT_SKILL_RANGES, DEFAULT_TARGET_PLAYERS, MATCHMAKING_WAIT_SEC, skillFor, type BotSkill } from '../../../shared/defs/bots';
import { ANTE_TIERS, PAYOUT_SPLITS, WAGER_MODES } from '../../../shared/defs/economy';
import type { WagerBotRequest, WagerRoomSummary } from '../../../shared/defs/economy-net';
import { h } from '../../menus/dom';
import { net } from '../../net';
import { registerScreen } from '../../registry';
import { back, navigate } from '../../router';
import { cp } from './store-screen';

const SKILL_LABELS: Record<keyof BotSkill, string> = {
  reactionMs: 'Reaction (ms)',
  aimErrorDeg: 'Aim error (deg)',
  turnSpeedDeg: 'Turn speed (deg/s)',
  headshotBias: 'Headshots',
  fovDeg: 'Field of view',
  hearingRange: 'Hearing (m)',
  strafe: 'Strafing',
  burstControl: 'Burst control',
  objectivePlay: 'Objective play',
  streakUse: 'Streak use',
  aggression: 'Aggression',
  weaponPickup: 'Weapon pickups',
};

interface Prefs {
  mode: string;
  ante: number;
  bots: Required<Omit<WagerBotRequest, 'custom' | 'targetPlayers'>> & { custom: BotSkill; target: Record<string, number> };
}

const KEY = 'lofi.economy.wager';
function loadPrefs(): Prefs {
  const base: Prefs = { mode: 'oitc', ante: 0, bots: { fill: true, difficulty: 'regular', variance: 0.15, custom: skillFor({ fill: true, targetPlayers: 8, difficulty: 'regular', variance: 0 }), target: {} } };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Prefs> | null;
    if (raw && typeof raw === 'object') return { ...base, ...raw, bots: { ...base.bots, ...(raw.bots ?? {}), custom: { ...base.bots.custom, ...(raw.bots?.custom ?? {}) } } };
  } catch {
    /* private mode / blocked storage: defaults */
  }
  return base;
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

registerScreen('wager', (root, params) => {
  const prefs = loadPrefs();
  if (!WAGER_MODES.some((m) => m.id === prefs.mode)) prefs.mode = 'oitc';
  if (!ANTE_TIERS.some((t) => t.ante === prefs.ante)) prefs.ante = 0;
  let lobbies: WagerRoomSummary[] = [];
  let busy = false;

  const balance = h('span', { class: 'lf-chip ec-balance' });
  const modes = h('div', { class: 'ec-modes', role: 'radiogroup', 'aria-label': 'Wager mode' });
  const antes = h('div', { class: 'ec-antes', role: 'radiogroup', 'aria-label': 'Ante' });
  const payoutInfo = h('div', { class: 'lf-hint' });
  const bots = h('div', { class: 'lf-panel lf-form ec-bots' });
  const status = h('div', { class: 'lf-status', role: 'status', 'aria-live': 'polite' });
  const findBtn = h('button', { class: 'lf-btn primary ec-find', type: 'button', onclick: () => void find(prefs.mode, prefs.ante) }, 'Find match');
  const list = h('div', { class: 'ec-lobbies' });

  const mode = () => WAGER_MODES.find((m) => m.id === prefs.mode)!;
  const target = () => prefs.bots.target[prefs.mode] ?? DEFAULT_TARGET_PLAYERS[prefs.mode] ?? mode().maxPlayers;

  const render = () => {
    const p = net.profile;
    const cpNow = p?.codPoints ?? 0;
    balance.replaceChildren(h('b', {}, cp(cpNow)));
    modes.replaceChildren(
      ...WAGER_MODES.map((m) =>
        h(
          'button',
          { class: 'ec-mode', type: 'button', role: 'radio', 'aria-checked': String(m.id === prefs.mode), onclick: () => ((prefs.mode = m.id), savePrefs(prefs), render()) },
          h('b', {}, m.name),
          h('span', {}, m.description),
          h('small', {}, `${m.maxPlayers} players · ${Math.round(m.timeLimitSec / 60)} min`),
        ),
      ),
    );
    antes.replaceChildren(
      ...ANTE_TIERS.map((t) => {
        const short = t.ante > 0 && cpNow < t.ante;
        return h(
          'button',
          { class: 'ec-ante', type: 'button', role: 'radio', 'aria-checked': String(t.ante === prefs.ante), disabled: short, title: short ? 'Not enough CoD Points' : t.description, onclick: () => ((prefs.ante = t.ante), savePrefs(prefs), render()) },
          h('b', {}, t.name),
          h('span', {}, t.ante ? cp(t.ante) : 'Free'),
          h('small', {}, t.description),
        );
      }),
    );
    if (prefs.ante > cpNow) prefs.ante = 0;
    const split = PAYOUT_SPLITS[3]!.map((s) => `${Math.round(s * 100)}%`).join(' / ');
    payoutInfo.textContent = prefs.ante
      ? `Ante goes into escrow when the match starts. Top 3 split the pot ${split} (fewer players, fewer places). Leave before the start: refunded. Quit mid-match: you forfeit. Bots never stake: with fewer than 2 players it's a free practice match.`
      : 'Practice: you against bots, nothing at stake, nothing paid.';
    renderBots();
    findBtn.toggleAttribute('disabled', busy || net.status !== 'online');
    renderList();
  };

  const renderBots = () => {
    const b = prefs.bots;
    const row = (label: string, ctl: Node) => [h('label', {}, label), ctl];
    const fill = h('input', { type: 'checkbox', checked: b.fill, 'aria-label': 'Fill empty slots with bots', onchange: (e) => ((b.fill = (e.target as HTMLInputElement).checked), savePrefs(prefs), render()) });
    const diff = h(
      'div',
      { class: 'lf-seg' },
      ...[...BOT_DIFFICULTIES.map((d) => ({ id: d.id as string, name: d.name, title: d.description })), { id: 'custom', name: 'Custom', title: 'Tune every knob' }].map((d) =>
        h('button', { type: 'button', 'aria-pressed': String(b.difficulty === d.id), title: d.title, onclick: () => ((b.difficulty = d.id as Prefs['bots']['difficulty']), savePrefs(prefs), render()) }, d.name),
      ),
    );
    const slider = (min: number, max: number, step: number, value: number, set: (v: number) => void, fmt: (v: number) => string = (v) => String(v)) => {
      const val = h('span', { class: 'val' }, fmt(value));
      const input = h('input', { type: 'range', min, max, step, value, oninput: (e) => { const v = Number((e.target as HTMLInputElement).value); set(v); val.textContent = fmt(v); savePrefs(prefs); } });
      return h('div', { class: 'lf-row' }, input, val);
    };
    const nodes: Node[] = [
      ...row('Bot backfill', h('div', { class: 'lf-row' }, fill, h('span', { class: 'ec-dim' }, `Starts with bots after ${MATCHMAKING_WAIT_SEC}s if the lobby isn't full`))),
      ...row('Players', slider(2, mode().maxPlayers, 1, Math.min(target(), mode().maxPlayers), (v) => (prefs.bots.target[prefs.mode] = v))),
      ...row('Difficulty', diff),
      ...row('Variance', slider(0, 1, 0.05, b.variance, (v) => (b.variance = v), (v) => `${Math.round(v * 100)}%`)),
    ];
    if (b.difficulty === 'custom')
      for (const k of Object.keys(BOT_SKILL_RANGES) as (keyof BotSkill)[]) {
        const [lo, hi, step] = BOT_SKILL_RANGES[k];
        nodes.push(...row(SKILL_LABELS[k], slider(lo, hi, step, b.custom[k], (v) => (b.custom[k] = v), (v) => (hi <= 1 ? `${Math.round(v * 100)}%` : String(Math.round(v * 10) / 10)))));
      }
    bots.replaceChildren(h('h3', { class: 'lf-h2 ec-span' }, 'Bots'), ...nodes);
    bots.toggleAttribute('data-off', !b.fill);
  };

  const renderList = () => {
    const open = lobbies.filter((l) => l.phase === 'lobby');
    list.replaceChildren(
      h('h3', { class: 'lf-h2' }, 'Open wager lobbies'),
      ...(open.length
        ? open.map((l) => {
            const m = WAGER_MODES.find((x) => x.id === l.mode);
            const afford = (net.profile?.codPoints ?? 0) >= l.ante;
            return h(
              'div',
              { class: 'ec-lobby' },
              h('span', {}, `${m?.name ?? l.mode} · ${cp(l.ante)} · ${l.humans}/${l.target}${l.startsIn !== null ? ` · starts in ${Math.ceil(l.startsIn)}s` : ''}`),
              h('button', { class: 'lf-btn small', type: 'button', disabled: !afford, onclick: () => void find(l.mode, l.ante) }, 'Join'),
            );
          })
        : [h('div', { class: 'ec-dim' }, 'None right now. Find a match to open one.')]),
    );
  };

  const find = async (modeId: string, ante: number) => {
    if (busy) return;
    busy = true;
    render();
    status.textContent = 'Finding a wager lobby...';
    try {
      const b = prefs.bots;
      const req: WagerBotRequest = { fill: b.fill, difficulty: b.difficulty, variance: b.variance, targetPlayers: prefs.bots.target[modeId] ?? DEFAULT_TARGET_PLAYERS[modeId] };
      if (b.difficulty === 'custom') req.custom = b.custom;
      const res = await net.rpc('economy.wagerQueue', { mode: modeId, ante, bots: req });
      navigate('match', { mode: modeId, room: res.roomId });
    } catch (err) {
      status.textContent = err instanceof Error ? err.message.replace(/^\w+: /, '') : 'Could not queue';
      busy = false;
      render();
    }
  };

  const refresh = async () => {
    if (net.status !== 'online') return;
    try {
      lobbies = (await net.rpc('economy.wagerList', {})).rooms;
      renderList();
    } catch {
      /* server without the economy feature: no list */
    }
  };

  root.append(
    h(
      'div',
      { class: 'lf-page lf-bg ec-page' },
      h('div', { class: 'lf-row ec-head' }, h('button', { class: 'lf-btn small', type: 'button', onclick: () => back(params) }, 'Back'), h('h2', { class: 'lf-h2' }, 'Wager match'), h('div', { class: 'lf-spacer' }), balance),
      h('div', { class: 'ec-section' }, h('h3', { class: 'lf-h2' }, 'Mode'), modes),
      h('div', { class: 'ec-section' }, h('h3', { class: 'lf-h2' }, 'Ante'), antes, payoutInfo),
      bots,
      h('div', { class: 'lf-row' }, findBtn, status),
      list,
    ),
  );
  render();
  void refresh();
  const timer = setInterval(() => void refresh(), 3000);
  const offs = [net.on('profile', () => render()), net.onStatus(() => (render(), void refresh()))];
  return () => {
    clearInterval(timer);
    offs.forEach((f) => f());
  };
});
