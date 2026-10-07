/**
 * The per-game lobby (screen 'lobby').
 *
 * As an overlay over the match screen (opened by lobby-client.ts while the room is in its lobby
 * phase): player list (level, prestige emblem slot, ping, host/ready), mode + map, map vote
 * (matchmade), countdown / "starting with bots in Ns", host controls in private lobbies (mode,
 * map, score/time limits, bot settings), invite link + code, ready, class pick, leave.
 *
 * As a page (`#/lobby?code=XXXXXX`, the invite link): resolves the code and joins.
 */
import { MAP_BY_ID, mapsForMode } from '../../../shared/defs/maps';
import { MODE_BY_ID, MODES } from '../../../shared/defs/modes';
import type { LobbyBotSettings } from '../../../shared/defs/bots';
import { lobbyStatusText, RANDOM_MAP, scoreLimitOptions, timeLimitOptions, type LobbyState } from '../../../shared/frontend/lobby';
import type { LobbyConfigPatch } from '../../../shared/frontend/protocol';
import { net } from '../../net';
import { registerScreen } from '../../registry';
import { navigate } from '../../router';
import { botEditor } from './bot-settings';
import { inviteUrl, joinByCode, lobbyNow, lobbyState, onLobby, whenOnline } from './lobby-client';
import { copyText, debounce, emblem, errText, fmtTime, h } from './ui';

const mapName = (id: string) => (id === RANDOM_MAP ? 'Random' : (MAP_BY_ID.get(id)?.name ?? id));
const modeName = (id: string) => MODE_BY_ID.get(id)?.name ?? id.toUpperCase();

registerScreen('lobby', (root, params) => {
  if (params.overlay !== '1') return joinPage(root, params);
  return lobbyOverlay(root);
});

function joinPage(root: HTMLElement, params: Record<string, string>) {
  const msg = h('div', { class: 'lf-banner' }, params.code ? `Joining lobby ${params.code.toUpperCase()}...` : 'No lobby code');
  const backBtn = h('button', { class: 'lf-btn', type: 'button', onclick: () => navigate('menu') }, 'Back to menu');
  root.append(h('div', { class: 'fe-page lf-bg' }, h('div', { class: 'lf-center' }, msg, backBtn)));
  let alive = true;
  if (params.code) {
    void whenOnline()
      .then(() => (alive ? joinByCode(params.code!) : undefined))
      .catch((err) => {
        if (alive) msg.textContent = `Could not join: ${errText(err)}`;
      });
  }
  return () => {
    alive = false;
  };
}

function lobbyOverlay(root: HTMLElement) {
  const meId = () => net.sessionId;
  const title = h('h2', { class: 'fe-title-big' });
  const kindTag = h('span', { class: 'fe-tag hi' });
  const status = h('div', { class: 'fe-status', role: 'status', 'aria-live': 'polite' });
  const err = h('div', { class: 'lf-status warn' });
  const codeEl = h('b', {});
  const copyBtn = h('button', { class: 'lf-btn small', type: 'button' }, 'Copy invite link');
  const playersHead = h('h3', { class: 'fe-h' });
  const players = h('div', { class: 'fe-players' });
  const voteBox = h('div', {});
  const settingsBox = h('div', { class: 'fe-form' });
  const botsHead = h('h3', { class: 'fe-h' }, 'Bots');
  const readyBtn = h('button', { class: 'lf-btn', type: 'button' }, 'Ready');
  const startBtn = h('button', { class: 'lf-btn primary', type: 'button' }, 'Start match');
  const classSel = h('select', { 'aria-label': 'Class' });
  const leaveBtn = h('button', { class: 'lf-btn', type: 'button', onclick: () => navigate('menu') }, 'Leave lobby');
  let st: LobbyState | null = lobbyState();

  const show = (e: unknown) => {
    err.textContent = errText(e);
    setTimeout(() => (err.textContent = ''), 4000);
  };
  const configure = (patch: LobbyConfigPatch) => net.rpc('frontend.configure', patch).catch(show);
  const configureSoon = debounce(configure, 150);

  // Bot editor (host edits; everyone else sees the numbers).
  const bots = botEditor((p: Partial<LobbyBotSettings>, final) => (final ? void configure({ bots: p }) : configureSoon({ bots: p })));

  // Host match settings.
  const modeSel = h('select', { 'aria-label': 'Mode' });
  const mapSel = h('select', { 'aria-label': 'Map' });
  const scoreSel = h('select', { 'aria-label': 'Score limit' });
  const timeSel = h('select', { 'aria-label': 'Time limit' });
  modeSel.addEventListener('change', () => void configure({ mode: modeSel.value }));
  mapSel.addEventListener('change', () => void configure({ map: mapSel.value }));
  scoreSel.addEventListener('change', () => void configure({ limits: { scoreLimit: Number(scoreSel.value) } }));
  timeSel.addEventListener('change', () => void configure({ limits: { timeLimitSec: Number(timeSel.value) } }));
  settingsBox.append(h('label', {}, 'Mode'), modeSel, h('label', {}, 'Map'), mapSel, h('label', {}, 'Score limit'), scoreSel, h('label', {}, 'Time limit'), timeSel);

  const fillSelect = (sel: HTMLSelectElement, opts: [string, string][], value: string, disabled: boolean) => {
    const key = opts.map((o) => o.join('=')).join('|');
    if (sel.dataset.key !== key) {
      sel.replaceChildren(...opts.map(([v, l]) => h('option', { value: v }, l)));
      sel.dataset.key = key;
    }
    if (document.activeElement !== sel) sel.value = value;
    sel.disabled = disabled;
  };

  readyBtn.addEventListener('click', () => {
    const me = st?.players.find((p) => p.id === meId());
    void net.rpc('frontend.ready', { ready: !me?.ready }).catch(show);
  });
  startBtn.addEventListener('click', () => void net.rpc('frontend.start', {}).catch(show));
  copyBtn.addEventListener('click', async () => {
    if (!st) return;
    const ok = await copyText(inviteUrl(st.code));
    copyBtn.textContent = ok ? 'Copied!' : inviteUrl(st.code);
    setTimeout(() => (copyBtn.textContent = 'Copy invite link'), 2000);
  });
  classSel.addEventListener('change', () => {
    const index = Number(classSel.value);
    void net
      .rpc('frontend.selectClass', { index })
      .then((r) => {
        if (net.profile) net.profile.selectedLoadout = r.selectedLoadout;
      })
      .catch(show);
  });

  const renderClasses = () => {
    const p = net.profile;
    if (!p) return;
    fillSelect(classSel, p.loadouts.map((l, i) => [String(i), l.name]), String(p.selectedLoadout), false);
  };

  const renderPlayers = (s: LobbyState) => {
    const humans = s.players.filter((p) => !p.bot).length;
    playersHead.textContent = `Players ${s.players.length}/${s.maxPlayers}${s.status === 'waiting' || s.status === 'countdown' ? ` · ${humans} human${humans === 1 ? '' : 's'}` : ''}`;
    const sorted = [...s.players].sort((a, b) => (a.team ?? 0) - (b.team ?? 0) || Number(a.bot) - Number(b.bot));
    const rows = sorted.map((p) =>
      h(
        'div',
        { class: `fe-player${p.team !== null ? ` t${p.team}` : ''}${p.id === meId() ? ' me' : ''}` },
        emblem(p.prestige, p.emblem),
        h('span', { class: 'lvl' }, p.bot ? 'BOT' : `LV${p.level}`),
        h('span', { class: 'name', title: p.name }, p.name),
        h('span', { class: 'tags' }, p.host ? h('span', { class: 'fe-tag hi' }, 'Host') : null, p.ready ? h('span', { class: 'fe-tag ok' }, 'Ready') : null),
        h('span', { class: 'ping' }, p.bot ? '-' : p.ping === null ? '?' : `${p.ping}ms`),
      ),
    );
    if (s.phase === 'lobby') {
      for (let i = 0; i < s.botsToFill; i++) rows.push(h('div', { class: 'fe-player ghost' }, emblem(0), h('span', { class: 'lvl' }, 'BOT'), h('span', { class: 'name' }, 'Bot (joins at start)'), h('span', { class: 'tags' }), h('span', { class: 'ping' }, '-')));
    }
    players.replaceChildren(...rows);
  };

  const renderVote = (s: LobbyState) => {
    if (!s.vote) {
      voteBox.replaceChildren();
      return;
    }
    const mine = s.vote.votes[meId()];
    voteBox.replaceChildren(
      h('h3', { class: 'fe-h' }, 'Vote for the next map'),
      h(
        'div',
        { class: 'fe-vote' },
        ...s.vote.options.map((m, i) =>
          h(
            'button',
            { class: 'fe-vote-opt', type: 'button', 'aria-pressed': String(mine === i), onclick: () => void net.rpc('frontend.vote', { option: i }).catch(show) },
            h('span', {}, mapName(m)),
            h('span', { class: 'count' }, String(s.vote!.counts[i] ?? 0)),
          ),
        ),
      ),
    );
  };

  const render = () => {
    const s = st;
    if (!s) {
      title.textContent = 'Lobby';
      status.textContent = 'Connecting to lobby...';
      return;
    }
    const isHost = s.hostId === meId();
    const canEdit = s.kind === 'private' && isHost && s.phase === 'lobby';
    title.replaceChildren(h('b', {}, modeName(s.mode)), ` · ${mapName(s.map)}`);
    kindTag.textContent = s.kind === 'private' ? (isHost ? 'Private · You are host' : 'Private match') : 'Quick Play';
    codeEl.textContent = s.code;
    renderPlayers(s);
    renderVote(s);
    settingsBox.hidden = s.kind !== 'private';
    if (s.kind === 'private') {
      const modes = MODES.filter((m) => m.playlist !== 'wager' || m.id === s.mode);
      fillSelect(modeSel, modes.map((m) => [m.id, m.name]), s.mode, !canEdit);
      const maps = mapsForMode(s.mode).map((m) => m.id);
      fillSelect(mapSel, (maps.length ? maps : [s.map]).map((m) => [m, mapName(m)]), s.map, !canEdit);
      const mode = MODE_BY_ID.get(s.mode);
      const scores = mode ? [...new Set([...scoreLimitOptions(mode), s.limits.scoreLimit])] : [s.limits.scoreLimit];
      fillSelect(scoreSel, scores.map((v) => [String(v), v === 0 ? 'Unlimited' : String(v)]), String(s.limits.scoreLimit), !canEdit);
      const times = mode ? [...new Set([...timeLimitOptions(mode), s.limits.timeLimitSec])] : [s.limits.timeLimitSec];
      fillSelect(timeSel, times.map((v) => [String(v), fmtTime(v)]), String(s.limits.timeLimitSec), !canEdit);
    }
    botsHead.textContent = s.kind === 'private' ? (canEdit ? 'Bots · host controls' : 'Bots · set by host') : 'Bots · playlist default';
    bots.update(s.bots, canEdit, s.maxPlayers);
    const me = s.players.find((p) => p.id === meId());
    readyBtn.textContent = me?.ready ? 'Ready ✓' : 'Ready';
    readyBtn.setAttribute('aria-pressed', String(!!me?.ready));
    readyBtn.hidden = s.kind === 'private' && isHost;
    startBtn.hidden = !(s.kind === 'private' && isHost);
    startBtn.toggleAttribute('disabled', s.countdownEndsAt !== null || s.phase !== 'lobby');
    renderClasses();
    tick();
  };

  const tick = () => {
    if (!st) return;
    status.textContent = lobbyStatusText(st, lobbyNow());
  };

  root.append(
    h(
      'div',
      { class: 'fe-page', 'aria-label': 'Lobby' },
      h(
        'div',
        { class: 'fe-top' },
        h('div', {}, title, h('div', { class: 'fe-actions', style: 'margin-top:6px' }, kindTag, status)),
        h('div', { class: 'fe-actions' }, h('span', { class: 'lf-chip' }, 'Code ', codeEl), copyBtn),
      ),
      h(
        'div',
        { class: 'fe-lobby' },
        h('section', { class: 'fe-panel' }, playersHead, players),
        h('section', { class: 'fe-panel' }, voteBox, settingsBox, h('div', { style: 'height:10px' }), botsHead, bots.el),
      ),
      err,
      h('div', { class: 'fe-actions' }, startBtn, readyBtn, h('span', { class: 'fe-small fe-dim' }, 'Class'), classSel, h('span', { class: 'lf-spacer' }), leaveBtn),
      h('div', { class: 'lf-hint' }, 'Share the code or invite link: friends join with Multiplayer › Join a party. Empty slots fill with bots when the match starts.'),
    ),
  );
  render();
  if (!st) void net.rpc('frontend.state', {}).then((s) => s && ((st = s), render())).catch(() => {});

  const timer = setInterval(tick, 250);
  const pingTimer = setInterval(() => {
    if (net.rtt > 0) void net.rpc('frontend.ping', { rtt: Math.round(net.rtt * 1000) }).catch(() => {});
  }, 3000);
  if (net.rtt > 0) void net.rpc('frontend.ping', { rtt: Math.round(net.rtt * 1000) }).catch(() => {});
  const offs = [
    onLobby((s) => {
      st = s;
      render();
    }),
    net.on('profile', renderClasses),
  ];
  return () => {
    clearInterval(timer);
    clearInterval(pingTimer);
    for (const off of offs) off();
  };
}
