/**
 * The lobby's bot settings editor (LobbyBotSettings): fill toggle, target players, difficulty
 * preset, every BotSkill knob as a slider (editable when "Custom"; shows the preset's values
 * otherwise), and per-bot variance. Read-only for non-hosts and matchmade lobbies.
 */
import { BOT_DIFFICULTIES, BOT_DIFFICULTY_BY_ID, BOT_SKILL_RANGES, DEFAULT_LOBBY_BOTS, skillFor, type BotSkill, type LobbyBotSettings } from '../../../shared/defs/bots';
import { formatSkill, presetSkill, SKILL_KEYS, SKILL_LABELS, skillRating } from '../../../shared/frontend/lobby';
import { h, seg, slider } from './ui';

export interface BotEditor {
  el: HTMLElement;
  update(bots: LobbyBotSettings, editable: boolean, maxPlayers: number): void;
}

type Diff = LobbyBotSettings['difficulty'];

export function botEditor(onPatch: (p: Partial<LobbyBotSettings>, final: boolean) => void): BotEditor {
  let cur: LobbyBotSettings = { ...DEFAULT_LOBBY_BOTS };
  let editable = false;
  let maxPlayers = 12;

  const fill = h('input', { type: 'checkbox', 'aria-label': 'Fill empty slots with bots' });
  fill.addEventListener('change', () => {
    cur = { ...cur, fill: fill.checked };
    onPatch({ fill: fill.checked }, true);
    refresh();
  });
  const target = slider(1, 12, 1, () => cur.targetPlayers, (v, final) => {
    cur = { ...cur, targetPlayers: v };
    onPatch({ targetPlayers: v }, final);
  }, (v) => `${v} players`, 'Target players');
  const targetInput = target.querySelector('input')!;

  const diffs: [Diff, string][] = [...BOT_DIFFICULTIES.map((d) => [d.id, d.name] as [Diff, string]), ['custom', 'Custom']];
  const difficulty = seg<Diff>(diffs, () => cur.difficulty, (v) => {
    if (!editable || v === cur.difficulty) return;
    const patch: Partial<LobbyBotSettings> = { difficulty: v };
    // Custom starts from the preset you were on, so the sliders don't jump.
    if (v === 'custom') patch.custom = cur.difficulty === 'custom' && cur.custom ? cur.custom : presetSkill(cur.difficulty);
    cur = { ...cur, ...patch };
    onPatch(patch, true);
    refresh();
  }, 'Bot difficulty');
  const desc = h('div', { class: 'fe-bots-desc' });
  const ratingBar = h('i');
  const rating = h('div', { class: 'fe-skill-bar', title: 'Overall skill' }, ratingBar);
  const variance = slider(0, 1, 0.05, () => cur.variance, (v, final) => {
    cur = { ...cur, variance: v };
    onPatch({ variance: v }, final);
  }, (v) => `±${Math.round(v * 100)}%`, 'Variance');

  const skill = (): BotSkill => skillFor(cur);
  const knobs = SKILL_KEYS.map((k) => {
    const [min, max, step] = BOT_SKILL_RANGES[k];
    const s = slider(min, max, step, () => skill()[k], (v, final) => {
      const custom = { ...skill(), [k]: v };
      cur = { ...cur, difficulty: 'custom', custom };
      onPatch({ difficulty: 'custom', custom }, final);
      ratingBar.style.width = `${Math.round(skillRating(custom) * 100)}%`;
    }, (v) => formatSkill(k, v), SKILL_LABELS[k]);
    return [k, s] as const;
  });

  const el = h(
    'div',
    { class: 'fe-form' },
    h('label', {}, 'Fill with bots'),
    fill,
    h('label', {}, 'Target players'),
    target,
    h('label', {}, 'Difficulty'),
    difficulty,
    desc,
    h('label', {}, 'Skill'),
    rating,
    h('label', {}, 'Variance'),
    variance,
    h('div', { class: 'fe-divider' }),
    ...knobs.flatMap(([k, s]) => [h('label', {}, SKILL_LABELS[k]), s]),
  );

  function refresh() {
    fill.checked = cur.fill;
    fill.disabled = !editable;
    targetInput.max = String(Math.max(1, maxPlayers));
    target.update(!editable || !cur.fill);
    difficulty.update(!editable);
    const preset = cur.difficulty === 'custom' ? null : BOT_DIFFICULTY_BY_ID.get(cur.difficulty);
    desc.textContent = preset ? preset.description : 'Custom: every knob below is yours. Moving any knob switches to Custom.';
    ratingBar.style.width = `${Math.round(skillRating(skill()) * 100)}%`;
    variance.update(!editable);
    for (const [, s] of knobs) s.update(!editable);
  }

  return {
    el,
    update(bots, canEdit, max) {
      cur = { ...bots, custom: bots.custom ? { ...bots.custom } : undefined };
      editable = canEdit;
      maxPlayers = max;
      refresh();
    },
  };
}
