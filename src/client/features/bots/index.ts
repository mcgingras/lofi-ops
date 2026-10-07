/**
 * Client side of the "bots" feature (auto-imported by main.ts).
 *
 *   - `botsClient`: typed helpers over the bots.* RPCs for the frontend's lobby UI
 *     (get / setSettings / playWithBots) and the latest `bots.status` push.
 *   - Screen `bots.setup` + main-menu item `bots.play` ("Play with Bots"): pick mode, map,
 *     difficulty preset or every custom knob, bot count and variance, then start a private match
 *     that fills with bots at once. The frontend may replace this screen or drop the menu item
 *     (`menuItems.delete('bots.play')`) if its own lobby offers the same.
 *   - HUD widget `bots.wait`: in a quick-play room still waiting for humans, "BOTS JOIN IN 12".
 */
import { BOT_DIFFICULTIES, BOT_SKILL_RANGES, DEFAULT_TARGET_PLAYERS, skillFor, type BotSkill, type BotsState, type LobbyBotSettings, type PlayWithBotsReq } from '../../../shared/defs/bots';
import { mapsForMode, MAP_BY_ID } from '../../../shared/defs/maps';
import { MODES } from '../../../shared/defs/modes';
import { blink, HUD_COLORS, txt, unit } from '../../hud/draw';
import { h } from '../../menus/dom';
import { net } from '../../net';
import { onFeature, registerHudWidget, registerMenuItem, registerScreen } from '../../registry';
import { back, navigate } from '../../router';
import { currentMatch } from '../../state';

let status: BotsState | null = null;
const listeners = new Set<(s: BotsState) => void>();

onFeature('bots.status', (s) => {
  status = s;
  for (const fn of listeners) fn(s);
});
net.on('joined', () => {
  status = null;
});

export const botsClient = {
  /** Latest `bots.status` push for the room we're in (null until the first one). */
  get status(): BotsState | null {
    return status;
  },
  onStatus(fn: (s: BotsState) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get(roomId?: string): Promise<BotsState> {
    return net.rpc('bots.get', roomId ? { roomId } : {});
  },
  /** Host of a private room only (rejects with 'not_host' / 'not_allowed' otherwise). */
  setSettings(settings: Partial<LobbyBotSettings>, roomId?: string): Promise<BotsState> {
    return net.rpc('bots.setSettings', roomId ? { roomId, settings } : { settings });
  },
  /** Create a private bot match and go to it. */
  async playWithBots(req: PlayWithBotsReq): Promise<string> {
    const { roomId } = await net.rpc('bots.playWithBots', req);
    navigate('match', { room: roomId });
    return roomId;
  },
};

// ---------------------------------------------------------------------------------------------
// "Play with Bots" setup screen
// ---------------------------------------------------------------------------------------------

const KNOB_LABELS: Record<keyof BotSkill, [string, (v: number) => string]> = {
  reactionMs: ['Reaction time', (v) => `${Math.round(v)} ms`],
  aimErrorDeg: ['Aim error', (v) => `${v.toFixed(1)}°`],
  turnSpeedDeg: ['Turn speed', (v) => `${Math.round(v)}°/s`],
  headshotBias: ['Headshots', (v) => `${Math.round(v * 100)}%`],
  fovDeg: ['Field of view', (v) => `${Math.round(v)}°`],
  hearingRange: ['Hearing', (v) => `${Math.round(v)} m`],
  strafe: ['Strafing', (v) => `${Math.round(v * 100)}%`],
  burstControl: ['Burst control', (v) => `${Math.round(v * 100)}%`],
  objectivePlay: ['Objective play', (v) => `${Math.round(v * 100)}%`],
  streakUse: ['Streak use', (v) => `${Math.round(v * 100)}%`],
  aggression: ['Aggression', (v) => `${Math.round(v * 100)}%`],
};

const STORE_KEY = 'lofi.bots.setup';

interface SetupState {
  mode: string;
  map: string;
  settings: LobbyBotSettings;
}

function loadSetup(): SetupState {
  const fallback: SetupState = { mode: 'tdm', map: '', settings: { fill: true, targetPlayers: DEFAULT_TARGET_PLAYERS.tdm ?? 12, difficulty: 'regular', variance: 0.15 } };
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<SetupState> | null;
    if (!raw || typeof raw !== 'object') return fallback;
    return { mode: typeof raw.mode === 'string' ? raw.mode : fallback.mode, map: typeof raw.map === 'string' ? raw.map : '', settings: { ...fallback.settings, ...(raw.settings ?? {}) } };
  } catch {
    return fallback;
  }
}

function saveSetup(s: SetupState) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* private mode: fine */
  }
}

function seg<T extends string>(opts: [T, string][], get: () => T, set: (v: T) => void): HTMLElement & { render(): void } {
  const wrap = Object.assign(h('div', { class: 'lf-seg', role: 'group' }), { render: () => {} });
  wrap.render = () =>
    wrap.replaceChildren(
      ...opts.map(([v, label]) =>
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(get() === v),
            onclick: () => {
              set(v);
              wrap.render();
            },
          },
          label,
        ),
      ),
    );
  wrap.render();
  return wrap;
}

function slider(min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string, label: string): HTMLElement & { render(): void } {
  const val = h('span', { class: 'val' });
  const input = h('input', { type: 'range', min, max, step, 'aria-label': label });
  const row = Object.assign(h('div', { class: 'lf-row' }, input, val), { render: () => {} });
  row.render = () => {
    input.value = String(get());
    val.textContent = fmt(get());
  };
  input.addEventListener('input', () => {
    set(Number(input.value));
    val.textContent = fmt(Number(input.value));
  });
  row.render();
  return row;
}

registerScreen('bots.setup', (root, params) => {
  const st = loadSetup();
  if (!MODES.some((m) => m.id === st.mode)) st.mode = 'tdm';
  const modeDef = () => MODES.find((m) => m.id === st.mode) ?? MODES[0]!;
  const status = h('div', { class: 'lf-status', role: 'status' });
  const renders: (() => void)[] = [];
  const renderAll = () => renders.forEach((r) => r());

  const modeSeg = seg(
    MODES.map((m) => [m.id, m.short] as [string, string]),
    () => st.mode,
    (v) => {
      st.mode = v;
      st.settings.targetPlayers = Math.min(modeDef().maxPlayers, DEFAULT_TARGET_PLAYERS[v] ?? modeDef().maxPlayers);
      if (!mapsForMode(v).some((m) => m.id === st.map)) st.map = '';
      renderAll();
    },
  );
  const mapWrap = h('div');
  const renderMaps = () => {
    const maps = mapsForMode(st.mode);
    mapWrap.replaceChildren(
      seg(
        [['', 'Random'] as [string, string], ...maps.map((m) => [m.id, m.name] as [string, string])],
        () => st.map,
        (v) => (st.map = v),
      ),
    );
  };
  renders.push(renderMaps, () => modeSeg.render());

  const desc = h('div', { class: 'lf-hint' });
  const diffSeg = seg(
    [...BOT_DIFFICULTIES.map((d) => [d.id, d.name] as [string, string]), ['custom', 'Custom']],
    () => st.settings.difficulty,
    (v) => {
      // Custom starts from the preset that was showing.
      if (v === 'custom' && st.settings.difficulty !== 'custom') st.settings.custom = skillFor(st.settings);
      st.settings.difficulty = v as LobbyBotSettings['difficulty'];
      renderAll();
    },
  );
  const knobs = h('div', { class: 'lf-form' });
  const knobRows = (Object.keys(BOT_SKILL_RANGES) as (keyof BotSkill)[]).map((k) => {
    const [min, max, step] = BOT_SKILL_RANGES[k];
    const [label, fmt] = KNOB_LABELS[k];
    const row = slider(
      min,
      max,
      step,
      () => (st.settings.difficulty === 'custom' && st.settings.custom ? st.settings.custom[k] : skillFor(st.settings)[k]),
      (v) => {
        if (st.settings.difficulty !== 'custom') {
          st.settings.custom = skillFor(st.settings);
          st.settings.difficulty = 'custom';
          diffSeg.render();
        }
        st.settings.custom = { ...(st.settings.custom ?? skillFor(st.settings)), [k]: v };
      },
      fmt,
      label,
    );
    knobs.append(h('label', {}, label), row);
    return row;
  });
  renders.push(() => {
    diffSeg.render();
    for (const r of knobRows) r.render();
    const d = BOT_DIFFICULTIES.find((x) => x.id === st.settings.difficulty);
    desc.textContent = d ? d.description : 'Every knob is yours. Drag any slider to tune.';
  });

  const countRow = slider(1, 18, 1, () => st.settings.targetPlayers, (v) => (st.settings.targetPlayers = Math.round(v)), (v) => `${Math.round(v)} total`, 'Players');
  const countWrap = h('div', {}, countRow);
  renders.push(() => {
    const input = countRow.querySelector('input')!;
    input.max = String(modeDef().maxPlayers);
    st.settings.targetPlayers = Math.min(st.settings.targetPlayers, modeDef().maxPlayers);
    countRow.render();
  });
  const varRow = slider(0, 1, 0.05, () => st.settings.variance, (v) => (st.settings.variance = v), (v) => `${Math.round(v * 100)}%`, 'Variance');

  const start = h('button', { class: 'lf-btn primary', type: 'button' }, 'Start match');
  start.addEventListener('click', async () => {
    saveSetup(st);
    start.setAttribute('disabled', '');
    status.textContent = 'Starting...';
    try {
      const { fill: _f, ...settings } = st.settings;
      await botsClient.playWithBots({ mode: st.mode, ...(st.map && MAP_BY_ID.has(st.map) ? { map: st.map } : {}), ...settings, fill: true, custom: st.settings.difficulty === 'custom' ? st.settings.custom : undefined });
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'could not start';
      start.removeAttribute('disabled');
    }
  });
  const backBtn = h('button', { class: 'lf-btn', type: 'button', onclick: () => back(params) }, 'Back');
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape') back(params);
  };
  addEventListener('keydown', onKey);

  const form = h(
    'div',
    { class: 'lf-form' },
    h('label', {}, 'Mode'),
    modeSeg,
    h('label', {}, 'Map'),
    mapWrap,
    h('label', {}, 'Players (you + bots)'),
    countWrap,
    h('label', {}, 'Difficulty'),
    h('div', {}, diffSeg, desc),
    h('label', {}, 'Variance'),
    varRow,
  );
  root.append(
    h(
      'div',
      { class: 'lf-page lf-bg' },
      h('h2', { class: 'lf-h2' }, 'Play with Bots'),
      h('div', { class: 'lf-panel' }, form),
      h('details', { class: 'lf-panel' }, h('summary', { class: 'lf-hint', style: 'cursor:pointer' }, 'Bot skill (every knob)'), knobs),
      h('div', { class: 'lf-row' }, start, backBtn),
      status,
    ),
  );
  renderAll();
  start.focus();
  return () => removeEventListener('keydown', onKey);
});

registerMenuItem({ id: 'bots.play', label: 'Play with Bots', hint: 'Offline-style, tunable skill', order: 25, action: () => navigate('bots.setup') });

// ---------------------------------------------------------------------------------------------
// HUD: matchmaking wait
// ---------------------------------------------------------------------------------------------

registerHudWidget(
  'bots.wait',
  (g, W, H) => {
    const m = currentMatch();
    const s = status;
    if (!m || m.loading || !s || s.fillAt === null || m.phase !== 'playing' || !s.managed || !s.settings.fill) return;
    if (s.humans >= s.target) return;
    const left = Math.max(0, Math.ceil(s.fillAt - m.serverTime));
    const u = unit(H);
    txt(g, 'WAITING FOR PLAYERS', W / 2, 30 * u, 8, HUD_COLORS.paper, 'center', u);
    txt(g, `BOTS JOIN IN ${left}`, W / 2, 40 * u, 8, blink(m.time, 1, 0.7) ? HUD_COLORS.hi : HUD_COLORS.paper, 'center', u);
  },
  62,
);
