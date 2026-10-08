/**
 * Settings -> Audio -> Sound test: every registered sound id, grouped, each with Play (through the
 * real engine and mix, as a local sound at its in-game volume; guns as your own gunshot) and a Flag
 * toggle; "Copy flagged list" copies the flagged ids so players can tell us exactly which sounds are
 * bad. Flags are remembered in this browser.
 */
import { sfx } from '../../game/audio';
import { gunOf, inGameVolume, soundTestGroups } from './sound-test-data';
import { h } from './ui';

const FLAGS_KEY = 'lofi.soundtest.flags';

function loadFlags(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(FLAGS_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveFlags(flags: Set<string>): void {
  try {
    localStorage.setItem(FLAGS_KEY, JSON.stringify([...flags].sort()));
  } catch {
    /* private mode: flags last for this visit only */
  }
}

/** Play one id exactly as the game does (after making sure its recordings are loaded). */
export async function playAsInGame(id: string): Promise<void> {
  sfx.unlock();
  await sfx.ensureLoaded(id);
  const gun = gunOf(id);
  if (gun) sfx.gunshot(gun.weapon, undefined, gun.suppressed);
  else sfx.play(id, { volume: inGameVolume(id) ?? 0.7 });
}

export function soundTestPane(): HTMLElement {
  const flags = loadFlags();
  const status = h('span', { class: 'lf-status', role: 'status' });
  const count = h('span', { class: 'lf-status' });
  const showCount = () => (count.textContent = flags.size ? `${flags.size} flagged` : 'Nothing flagged');
  showCount();
  const copyBtn = h('button', { class: 'lf-btn small', type: 'button' }, 'Copy flagged list');
  copyBtn.addEventListener('click', async () => {
    const text = [...flags].sort().join('\n');
    if (!text) {
      status.textContent = 'Flag the sounds that sound wrong first.';
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = `Copied ${flags.size} id${flags.size === 1 ? '' : 's'}.`;
    } catch {
      status.textContent = `Copy blocked by the browser. Flagged: ${text.replace(/\n/g, ', ')}`;
    }
  });
  const clearBtn = h('button', { class: 'lf-btn small', type: 'button' }, 'Clear flags');

  const toggles: [string, HTMLButtonElement][] = [];
  const groups = soundTestGroups(sfx.registeredIds()).map((g) =>
    h(
      'div',
      { class: 'fe-st-group' },
      h('div', { class: 'fe-st-title' }, g.title),
      ...g.rows.map((r) => {
        const play = h('button', { class: 'lf-btn small', type: 'button', 'aria-label': `Play ${r.id}` }, 'Play');
        play.addEventListener('click', () => void playAsInGame(r.id));
        const flag = h('button', { class: 'fe-st-flag', type: 'button', 'aria-pressed': String(flags.has(r.id)), 'aria-label': `Flag ${r.id}` }, 'Flag');
        flag.addEventListener('click', () => {
          if (flags.has(r.id)) flags.delete(r.id);
          else flags.add(r.id);
          flag.setAttribute('aria-pressed', String(flags.has(r.id)));
          saveFlags(flags);
          showCount();
        });
        toggles.push([r.id, flag]);
        return h('div', { class: 'fe-st-row' }, play, h('span', { class: 'fe-st-label', title: r.label }, r.label), flag);
      }),
    ),
  );
  clearBtn.addEventListener('click', () => {
    flags.clear();
    saveFlags(flags);
    for (const [, b] of toggles) b.setAttribute('aria-pressed', 'false');
    showCount();
    status.textContent = '';
  });

  return h(
    'div',
    { class: 'fe-st' },
    h('div', { class: 'fe-st-head' }, h('span', { class: 'lab' }, 'Sound test'), count, copyBtn, clearBtn),
    h('p', { class: 'fe-help' }, 'Plays each sound the way the game does. Flag the ones that sound wrong, then copy the list and send it to us.'),
    status,
    h('div', { class: 'fe-st-list' }, ...groups),
  );
}
