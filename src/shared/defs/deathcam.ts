/**
 * Per-death killcam ("deathcam", owner: modes), shared by server and client: timing, the wire
 * payload (`modes.deathcam`, sent only to the victim) and the compact clip encoding.
 *
 * Timeline (room time, kill at `at`): the victim sees the death view for `beatSec`, then the clip
 * plays at 1x from the killer's eyes, ending `postSec` after the kill. The server sends the clip
 * `postSec` after the kill (so it can include what happened right after) and cuts it so it ends
 * by the victim's respawn: the killcam never makes a respawn later. No respawn (S&D, an HQ that
 * still stands) gets the full `maxSec`.
 *
 * Wire encoding: the 20 Hz pose frames are quantised (cm, milliradians, health %) and delta coded
 * per player, so a 4 s clip of ~6 nearby players is a few KB of JSON instead of tens.
 */
import type { KillcamFrame } from './modestate';

export const DEATHCAM = {
  /** Seconds of the death view before the replay starts. */
  beatSec: 1,
  /** Longest clip (seconds of replay). */
  maxSec: 4,
  /** Replay after the kill (seconds), when there is room for it. */
  postSec: 0.5,
  /** Shorter than this and there is no replay (the killer card still shows). */
  minSec: 1,
  /** Players further than this from both the killer and the victim at the kill are left out. */
  nearM: 40,
  /** At most this many players in a clip (killer and victim always included). */
  maxPlayers: 10,
} as const;
export type DeathcamTuning = { [K in keyof typeof DEATHCAM]: number };

/** Clip window in room time, or null when there's no room for a replay before the respawn. */
export function deathcamWindow(at: number, respawnAt: number | null, t: DeathcamTuning = DEATHCAM): { from: number; to: number } | null {
  const room = respawnAt === null ? t.maxSec : Math.min(t.maxSec, respawnAt - at - t.beatSec);
  if (!(room >= t.minSec)) return null;
  const post = Math.min(t.postSec, room * 0.25);
  return { from: at - (room - post), to: at + post };
}

/** Means of death that never get a killcam (no killer to watch). */
export const NO_DEATHCAM_MEANS: ReadonlySet<string> = new Set(['fall', 'world', 'suicide']);

/** Streak weapons whose kill is shown from above (strikes, falling crates). */
export const TOP_DOWN_STREAKS: ReadonlySet<string> = new Set(['napalm', 'rolling_thunder', 'mortar', 'care_package', 'valkyrie']);

/** Killer card: who killed you and with what (BO1 playercard + weapon). */
export interface KillerCard {
  name: string;
  bot: boolean;
  level: number;
  prestige: number;
  /** Weapon (or streak) id the kill was credited to. */
  weapon: string;
  /** Attachments on that weapon, if the killer was holding it. */
  attachments: string[];
  /** Killer's health when the kill happened (0 if they died in the trade). */
  health: number;
  maxHealth: number;
  /** Killer's streak after this kill. */
  streak: number;
}

/** A clip in the compact wire form (see packClip). */
export interface PackedClip {
  /** Room time of the first frame. */
  t0: number;
  ids: string[];
  /** Per frame: [ms since t0, then per player: index, dx, dy, dz (cm), dyaw, dpitch (mrad), flags, dhp]. */
  f: number[][];
  /** Shots: [ms since t0, player index, end x, y, z (cm), 1 if it hit a player]. */
  s: number[][];
}

export interface DeathcamShot {
  t: number;
  id: string;
  end: [number, number, number];
  hit: boolean;
}

export interface DeathcamPayload {
  killer: string;
  victim: string;
  weapon: string;
  means: string;
  headshot: boolean;
  /** Room time of the kill. */
  at: number;
  /** Room time the replay starts (after the death view). */
  playAt: number;
  respawnAt: number | null;
  card: KillerCard;
  /**
   * How to watch it: 'eyes' = the killer's first-person view with their weapon; 'streak' = from
   * the killstreak (`cam`); 'none' = no replay, only the killer card.
   */
  view: 'eyes' | 'streak' | 'none';
  /** Streak view: camera position, or `top` for a top-down view over the victim. */
  cam?: { x: number; y: number; z: number; top: boolean };
  /** The weapon in the killer's hands (viewmodel), when it is a gun. */
  vm?: { weapon: string; attachments: string[]; camo: string; suppressed: boolean };
  clip: PackedClip | null;
}

const cm = (v: number) => Math.round(v * 100);
const mr = (v: number) => Math.round(v * 1000);

/** Quantise and delta-code frames (and shots) for the wire. */
export function packClip(frames: readonly KillcamFrame[], shots: readonly DeathcamShot[] = []): PackedClip {
  const t0 = frames[0]?.t ?? 0;
  const ids: string[] = [];
  const index = new Map<string, number>();
  const last = new Map<number, number[]>();
  const idx = (id: string) => {
    let i = index.get(id);
    if (i === undefined) {
      i = ids.length;
      ids.push(id);
      index.set(id, i);
    }
    return i;
  };
  const f = frames.map((fr) => {
    const row = [Math.round((fr.t - t0) * 1000)];
    for (const p of fr.p) {
      const i = idx(p[0]);
      const q = [cm(p[1]), cm(p[2]), cm(p[3]), mr(p[4]), mr(p[5]), p[6], Math.round(p[7] ?? 100)];
      const prev = last.get(i) ?? [0, 0, 0, 0, 0, 0, 0];
      row.push(i, q[0]! - prev[0]!, q[1]! - prev[1]!, q[2]! - prev[2]!, q[3]! - prev[3]!, q[4]! - prev[4]!, q[5]!, q[6]! - prev[6]!);
      last.set(i, q);
    }
    return row;
  });
  const s = shots.map((x) => [Math.round((x.t - t0) * 1000), idx(x.id), cm(x.end[0]), cm(x.end[1]), cm(x.end[2]), x.hit ? 1 : 0]);
  return { t0, ids, f, s };
}

/** Inverse of packClip (to cm / mrad precision). */
export function unpackClip(c: PackedClip): { frames: KillcamFrame[]; shots: DeathcamShot[] } {
  const acc = new Map<number, number[]>();
  const frames = c.f.map((row) => {
    const p: KillcamFrame['p'] = [];
    for (let k = 1; k + 7 < row.length; k += 8) {
      const i = row[k]!;
      const prev = acc.get(i) ?? [0, 0, 0, 0, 0, 0, 0];
      const q = [prev[0]! + row[k + 1]!, prev[1]! + row[k + 2]!, prev[2]! + row[k + 3]!, prev[3]! + row[k + 4]!, prev[4]! + row[k + 5]!, row[k + 6]!, prev[6]! + row[k + 7]!];
      acc.set(i, q);
      p.push([c.ids[i] ?? '?', q[0]! / 100, q[1]! / 100, q[2]! / 100, q[3]! / 1000, q[4]! / 1000, q[5]!, q[6]!]);
    }
    return { t: c.t0 + row[0]! / 1000, p };
  });
  const shots = c.s.map((s) => ({ t: c.t0 + s[0]! / 1000, id: c.ids[s[1]!] ?? '?', end: [s[2]! / 100, s[3]! / 100, s[4]! / 100] as [number, number, number], hit: s[5] === 1 }));
  return { frames, shots };
}
