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

/** Means of death that never get a killcam (no killer to watch; the Tactical Nuke's blast neither, as in MW2). */
export const NO_DEATHCAM_MEANS: ReadonlySet<string> = new Set(['fall', 'world', 'suicide', 'nuke']);

/** Streak weapons whose kill is shown from above (strikes, falling crates). Valkyrie kills ride the rocket (`cam.track`). */
export const TOP_DOWN_STREAKS: ReadonlySet<string> = new Set(['napalm', 'rolling_thunder', 'mortar', 'care_package']);

/**
 * A camera path for the killcam (the Valkyrie rocket's flight: BO1 replays the killer's view, which
 * rode the rocket): `t0` room time, `p` = [ms since t0, x, y, z (cm)] per point, the last one the blast.
 */
export interface CamTrack {
  t0: number;
  p: number[][];
}

/** Pack a path (room time, metres) for the wire. */
export function packTrack(points: readonly { t: number; x: number; y: number; z: number }[]): CamTrack {
  const t0 = points[0]?.t ?? 0;
  return { t0: Math.round(t0 * 1000) / 1000, p: points.map((q) => [Math.round((q.t - t0) * 1000), Math.round(q.x * 100), Math.round(q.y * 100), Math.round(q.z * 100)]) };
}

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
  /** Shots: [ms since t0, player index, end x, y, z (cm), 1 if it hit a player, then x, y, z (cm) per wall point]. */
  s: number[][];
  /** Gear table (see gearKey): the weapons held in the clip. */
  w?: string[];
  /** Gear changes: [ms since t0, player index, index into `w`] (each player's first row is what they held at the start). */
  g?: number[][];
  /** Frost changes (Winter's Howl): [ms since t0, player index, frost %]. */
  x?: number[][];
  /** Team per player index at the kill (-1 = none / FFA). */
  tm?: number[];
  /** Projectile string table (kinds and sub-kinds). */
  pk?: string[];
  /** Projectiles: [entity id, kind (index into `pk`), owner (player index, -1 none), sub-kind (index into `pk`)]. */
  pj?: number[][];
  /** Projectile positions: [ms since t0, entity id, x, y, z (cm)]. */
  pe?: number[][];
}

/** The weapon a replayed player holds: `weaponId|camo|attachment,attachment` ('' when empty-handed). */
export function gearKey(weapon: string, camo = 'none', attachments: readonly string[] = []): string {
  return weapon ? `${weapon}|${camo || 'none'}|${attachments.join(',')}` : '';
}

/** Inverse of gearKey (null when empty-handed). */
export function parseGear(key: string | undefined): { weapon: string; camo: string; attachments: string[] } | null {
  if (!key) return null;
  const [weapon = '', camo = 'none', att = ''] = key.split('|');
  return weapon ? { weapon, camo: camo || 'none', attachments: att ? att.split(',') : [] } : null;
}

export interface DeathcamShot {
  t: number;
  id: string;
  end: [number, number, number];
  hit: boolean;
  /** Walls the bullet went through: entry and exit point of each (puffs on both sides). */
  pen?: [number, number, number][];
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
  /** Streak view: camera position, or `top` for a top-down view over the victim; `track` = ride this path (Valkyrie rocket). */
  cam?: { x: number; y: number; z: number; top: boolean; track?: CamTrack };
  /** The weapon in the killer's hands (viewmodel), when it is a gun. */
  vm?: { weapon: string; attachments: string[]; camo: string; suppressed: boolean };
  clip: PackedClip | null;
}

const cm = (v: number) => Math.round(v * 100);
const mr = (v: number) => Math.round(v * 1000);

/**
 * Quantise and delta-code frames (and shots) for the wire. Gear and frost go as changes, projectiles
 * as a table plus positions; `teams` tags each player with their team at the kill.
 */
export function packClip(frames: readonly KillcamFrame[], shots: readonly DeathcamShot[] = [], teams?: ReadonlyMap<string, number | null>): PackedClip {
  const t0 = frames[0]?.t ?? 0;
  const ms = (t: number) => Math.round((t - t0) * 1000);
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
  const gearTable: string[] = [];
  const gearIndex = new Map<string, number>();
  const heldBy = new Map<number, number>();
  const frostBy = new Map<number, number>();
  const g: number[][] = [];
  const x: number[][] = [];
  const strs: string[] = [];
  const str = (v: string) => {
    const i = strs.indexOf(v);
    return i >= 0 ? i : strs.push(v) - 1;
  };
  const pj: number[][] = [];
  const pe: number[][] = [];
  const seen = new Set<number>();
  const f = frames.map((fr) => {
    const t = ms(fr.t);
    const row = [t];
    for (const p of fr.p) {
      const i = idx(p[0]);
      const q = [cm(p[1]), cm(p[2]), cm(p[3]), mr(p[4]), mr(p[5]), p[6], Math.round(p[7] ?? 100)];
      const prev = last.get(i) ?? [0, 0, 0, 0, 0, 0, 0];
      row.push(i, q[0]! - prev[0]!, q[1]! - prev[1]!, q[2]! - prev[2]!, q[3]! - prev[3]!, q[4]! - prev[4]!, q[5]!, q[6]! - prev[6]!);
      last.set(i, q);
      const key = p[8];
      if (key !== undefined) {
        let k = gearIndex.get(key);
        if (k === undefined) {
          k = gearTable.push(key) - 1;
          gearIndex.set(key, k);
        }
        if (heldBy.get(i) !== k) {
          heldBy.set(i, k);
          g.push([t, i, k]);
        }
      }
      const frost = Math.round(p[9] ?? 0);
      if ((frostBy.get(i) ?? 0) !== frost) {
        frostBy.set(i, frost);
        x.push([t, i, frost]);
      }
    }
    for (const e of fr.e ?? []) {
      if (!seen.has(e[0])) {
        seen.add(e[0]);
        pj.push([e[0], str(e[1]), e[2] ? idx(e[2]) : -1, str(e[6])]);
      }
      pe.push([t, e[0], cm(e[3]), cm(e[4]), cm(e[5])]);
    }
    return row;
  });
  const s = shots.map((sh) => [ms(sh.t), idx(sh.id), cm(sh.end[0]), cm(sh.end[1]), cm(sh.end[2]), sh.hit ? 1 : 0, ...(sh.pen ?? []).flatMap((p) => [cm(p[0]), cm(p[1]), cm(p[2])])]);
  const out: PackedClip = { t0, ids, f, s };
  if (gearTable.length) {
    out.w = gearTable;
    out.g = g;
  }
  if (x.length) out.x = x;
  if (teams) out.tm = ids.map((id) => teams.get(id) ?? -1);
  if (pj.length) {
    out.pk = strs;
    out.pj = pj;
    out.pe = pe;
  }
  return out;
}

/** A projectile's recorded flight (room time, metres). */
export interface ProjectileTrack {
  id: number;
  kind: string;
  /** Sub-kind (the grenade type: frag, semtex, gl...). */
  sub: string;
  owner: string | null;
  points: { t: number; x: number; y: number; z: number }[];
}

/** A clip unpacked: frames (with gear and frost filled in), shots, and the side tables. */
export interface UnpackedClip {
  frames: KillcamFrame[];
  shots: DeathcamShot[];
  /** Per player: gear changes in time order (gearKey strings). */
  gear: Map<string, { t: number; gear: string }[]>;
  /** Per player: frost changes (%). */
  frost: Map<string, { t: number; frost: number }[]>;
  /** Team at the kill (null = none / not sent). */
  teams: Map<string, number | null>;
  projectiles: ProjectileTrack[];
}

/** The latest value of a time-ordered change list at time `t` (undefined before the first). */
export function valueAt<T>(list: readonly ({ t: number } & T)[] | undefined, t: number): ({ t: number } & T) | undefined {
  let cur: ({ t: number } & T) | undefined;
  for (const x of list ?? []) {
    if (x.t > t + 1e-6) break;
    cur = x;
  }
  return cur;
}

/** Inverse of packClip (to cm / mrad precision). */
export function unpackClip(c: PackedClip): UnpackedClip {
  const acc = new Map<number, number[]>();
  const at = (ms: number) => c.t0 + ms / 1000;
  const frames = c.f.map((row) => {
    const p: KillcamFrame['p'] = [];
    for (let k = 1; k + 7 < row.length; k += 8) {
      const i = row[k]!;
      const prev = acc.get(i) ?? [0, 0, 0, 0, 0, 0, 0];
      const q = [prev[0]! + row[k + 1]!, prev[1]! + row[k + 2]!, prev[2]! + row[k + 3]!, prev[3]! + row[k + 4]!, prev[4]! + row[k + 5]!, row[k + 6]!, prev[6]! + row[k + 7]!];
      acc.set(i, q);
      p.push([c.ids[i] ?? '?', q[0]! / 100, q[1]! / 100, q[2]! / 100, q[3]! / 1000, q[4]! / 1000, q[5]!, q[6]!]);
    }
    return { t: at(row[0]!), p } as KillcamFrame;
  });
  const shots = c.s.map((s) => {
    const shot: DeathcamShot = { t: at(s[0]!), id: c.ids[s[1]!] ?? '?', end: [s[2]! / 100, s[3]! / 100, s[4]! / 100], hit: s[5] === 1 };
    const pen: [number, number, number][] = [];
    for (let k = 6; k + 2 < s.length; k += 3) pen.push([s[k]! / 100, s[k + 1]! / 100, s[k + 2]! / 100]);
    if (pen.length) shot.pen = pen;
    return shot;
  });
  const gear = new Map<string, { t: number; gear: string }[]>();
  for (const [t, i, k] of c.g ?? []) {
    const id = c.ids[i!] ?? '?';
    const list = gear.get(id) ?? [];
    list.push({ t: at(t!), gear: c.w?.[k!] ?? '' });
    gear.set(id, list);
  }
  const frost = new Map<string, { t: number; frost: number }[]>();
  for (const [t, i, v] of c.x ?? []) {
    const id = c.ids[i!] ?? '?';
    const list = frost.get(id) ?? [];
    list.push({ t: at(t!), frost: v! });
    frost.set(id, list);
  }
  const teams = new Map<string, number | null>();
  c.ids.forEach((id, i) => {
    const tm = c.tm?.[i];
    teams.set(id, tm === undefined || tm < 0 ? null : tm);
  });
  const projectiles: ProjectileTrack[] = (c.pj ?? []).map(([id, k, o, sub]) => ({ id: id!, kind: c.pk?.[k!] ?? '', sub: c.pk?.[sub!] ?? '', owner: o! >= 0 ? (c.ids[o!] ?? null) : null, points: [] }));
  const byId = new Map(projectiles.map((p) => [p.id, p]));
  const frameAt = new Map(c.f.map((row, i) => [row[0]!, frames[i]!]));
  for (const [t, id, x, y, z] of c.pe ?? []) {
    const pr = byId.get(id!);
    if (!pr) continue;
    const pt = { t: at(t!), x: x! / 100, y: y! / 100, z: z! / 100 };
    pr.points.push(pt);
    const fr = frameAt.get(t!);
    if (fr) (fr.e ??= []).push([pr.id, pr.kind, pr.owner ?? '', pt.x, pt.y, pt.z, pr.sub]);
  }
  // Fill the frames' own gear and frost fields from the change lists.
  for (const fr of frames)
    for (const p of fr.p) {
      const held = valueAt(gear.get(p[0]), fr.t);
      if (held) p[8] = held.gear;
      const fz = valueAt(frost.get(p[0]), fr.t);
      if (fz && fz.frost) p[9] = fz.frost;
    }
  return { frames, shots, gear, frost, teams, projectiles };
}
