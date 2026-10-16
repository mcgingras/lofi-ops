/**
 * Data for Settings -> Audio -> Sound test (no DOM, unit-tested): every registered sound id grouped
 * by category, labelled `id: file, file (author)`, and the volume the game plays it at.
 */
import { SFX_CREDITS } from '../../../shared/defs/sfx-credits';
import { SFX_BINDINGS } from '../../../shared/defs/sfx-recipes';

export interface SoundRow {
  id: string;
  label: string;
}
export interface SoundGroup {
  title: string;
  rows: SoundRow[];
}

const GROUPS: [string, (id: string) => boolean][] = [
  ['Guns', (id) => id === 'shot' || id.startsWith('shot.')],
  ['Weapon handling and equipment', (id) => id.startsWith('weapons.') || id === 'click' || id === 'reload'],
  ['Footsteps', (id) => id === 'step' || id.startsWith('step.')],
  ['Player and UI', (id) => id === 'tick' || id === 'thud'],
  ['Killstreaks', (id) => id.startsWith('ks_')],
  ['Modes', (id) => id.startsWith('modes.')],
];

/**
 * The volume each id's call site passes in game (local sounds as you hear them; world sounds as
 * heard from about 4 m, the panner's reference distance). Gunshots go through `sfx.gunshot`
 * (your own gun) instead; footsteps play at a walking step's volume (see `inGameVolume`).
 */
export const IN_GAME_VOLUME: Record<string, number> = {
  shot: 0.9,
  'shot.distant': 1.2,
  tick: 0.35,
  thud: 0.6,
  click: 0.5,
  reload: 1,
  'weapons.bolt': 0.7,
  'weapons.pump': 0.7,
  'weapons.shell': 0.6,
  'weapons.magout': 0.6,
  'weapons.magin': 0.7,
  'weapons.magout.pistol': 0.6,
  'weapons.magin.pistol': 0.7,
  'weapons.charge': 0.55,
  'weapons.break': 0.7,
  'weapons.breakclose': 0.7,
  'weapons.knife': 0.7,
  'weapons.stab': 0.8,
  'weapons.pin': 0.5,
  'weapons.bounce': 0.5,
  'weapons.boom': 1.6,
  'weapons.flashbang': 1.2,
  'weapons.ring': 0.6,
  'weapons.beep': 0.7,
  'weapons.thump': 1,
  'weapons.cook': 0.45,
  ks_ready: 0.6,
  ks_call: 0.5,
  ks_alarm: 0.5,
  ks_boom: 2.2,
  ks_bigboom: 2.6,
  ks_whistle: 1.4,
  ks_jet: 2.2,
  ks_rotor: 1.2,
  ks_prop: 0.8,
  ks_bark: 1.4,
  ks_bite: 1.2,
  ks_launch: 1.8,
  ks_sentry: 1.2,
  ks_gunner: 1.4,
  ks_static: 0.25,
  ks_mark: 0.4,
  ks_confirm: 0.45,
  ks_buzz: 0.7,
  ks_fire: 0.8,
  ks_smoke: 0.9,
  ks_glitch: 0.6,
  'modes.good': 0.55,
  'modes.bad': 0.55,
  'modes.horn': 0.55,
  'modes.alarm': 0.55,
  'modes.pickup': 0.55,
  'modes.beep': 0.6,
  'modes.boom': 1,
};

/** The volume to play an id at in the sound test; undefined only for an id the table doesn't know. */
export function inGameVolume(id: string): number | undefined {
  if (id === 'step' || id.startsWith('step.')) return 0.5;
  return IN_GAME_VOLUME[id];
}

/** `shot.ak47.sup` -> { weapon: 'ak47', suppressed: true }; null for ids that are not a gun voice. */
export function gunOf(id: string): { weapon: string; suppressed: boolean } | null {
  if (id === 'shot' || id === 'shot.distant') return null;
  const m = /^shot\.(.+?)(\.sup)?$/.exec(id);
  return m ? { weapon: m[1]!, suppressed: !!m[2] } : null;
}

/** `id: file, file (author), file (author)`: consecutive files from one author share the credit. */
export function soundLabel(id: string): string {
  const b = SFX_BINDINGS[id];
  if (!b) return `${id}: synthesized (Lo-Fi Ops)`;
  const parts: string[] = [];
  let run: string[] = [];
  let author = '';
  const flush = () => run.length && parts.push(`${run.join(', ')} (${author})`);
  for (const f of b.files) {
    const a = SFX_CREDITS[f]?.author ?? 'unknown';
    if (a !== author) {
      flush();
      run = [];
      author = a;
    }
    run.push(f);
  }
  flush();
  return `${id}: ${parts.join(', ')}`;
}

/** Every id, grouped by category in a fixed order (ids sorted within a group; leftovers under Other). */
export function soundTestGroups(ids: string[]): SoundGroup[] {
  const left = new Set(ids);
  const out: SoundGroup[] = [];
  for (const [title, test] of GROUPS) {
    const mine = [...left].filter(test).sort();
    mine.forEach((id) => left.delete(id));
    if (mine.length) out.push({ title, rows: mine.map((id) => ({ id, label: soundLabel(id) })) });
  }
  if (left.size) out.push({ title: 'Other', rows: [...left].sort().map((id) => ({ id, label: soundLabel(id) })) });
  return out;
}
