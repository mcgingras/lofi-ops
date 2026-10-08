/**
 * Tactical Nuke presentation maths (pure: no DOM, no three; tested in tests/nuke.client.test.ts):
 * reading the `ks_nuke` entity, whose side it is, and per frame the countdown number, the white-out,
 * slow motion, cloud growth, camera shake and the caller's laptop pose. Timeline: shared/defs/nuke.ts.
 */
import type { Team } from '../../../shared/constants';
import { KS_ENTITY } from '../../../shared/defs/killstreaks';
import { NUKE, cloudGrowth, countdownNumber, nukeEndAt, nukePhase, nukeTimeScale, nukeWhite, shockAt, type NukePhase, type NukeTimes } from '../../../shared/defs/nuke';
import type { EntitySnap } from '../../../shared/protocol';

export interface NukeInfo {
  entity: number;
  owner: string;
  team: Team | null;
  times: NukeTimes;
  blast: { x: number; y: number; z: number };
  yaw: number;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function readNuke(e: EntitySnap): NukeInfo | null {
  if (e.kind !== KS_ENTITY.nuke || !e.s) return null;
  const { a, d, n, f, o } = e.s;
  if (!num(a) || !num(d) || !num(n) || !num(f)) return null;
  return { entity: e.id, owner: typeof o === 'string' ? o : '', team: e.team ?? null, times: { a, d, n, f }, blast: { x: e.x, y: e.y, z: e.z }, yaw: e.yaw };
}

export function findNuke(ents: readonly EntitySnap[]): NukeInfo | null {
  for (const e of ents) {
    const n = readNuke(e);
    if (n) return n;
  }
  return null;
}

export type NukeSide = 'mine' | 'friendly' | 'enemy';

export function nukeSide(info: NukeInfo, myId: string, myTeam: Team | null): NukeSide {
  if (info.owner === myId) return 'mine';
  return myTeam !== null && info.team === myTeam ? 'friendly' : 'enemy';
}

export interface NukeFrame {
  phase: NukePhase;
  /** Countdown number (10..1), 0 once it has gone off. */
  number: number;
  /** Seconds since detonation (negative before). */
  since: number;
  /** Seconds since the shockwave reached the viewer (negative before). */
  hitSince: number;
  /** 0..1 white-out for the post pass. */
  white: number;
  /** Slow motion (1 = normal). */
  timeScale: number;
  /** 0..1 mushroom cloud growth. */
  cloud: number;
  /** Camera shake amplitude (radians). */
  shake: number;
  /** The caller's laptop: 0..1 through the call-in, -1 when not on it. */
  laptop: number;
  /** Seconds past the match end (results up). */
  over: number;
}

/**
 * Everything the client shows at room time `t` for a viewer `dist` metres from the blast (the
 * shockwave reaches nearer viewers first). Past the match end the white eases back so the results
 * sit over a washed-out view of the cloud.
 */
export function nukeFrame(t: number, info: NukeInfo, dist: number): NukeFrame {
  const { times } = info;
  const since = t - times.d;
  const hitSince = t - shockAt(dist, times);
  const over = t - nukeEndAt(times);
  let white = nukeWhite(since, since >= 0 ? hitSince : null);
  if (over > 0.8) white = Math.max(0.3, 1 - (over - 0.8) / 1.5);
  let shake = 0;
  if (since >= 0 && since < 0.8) shake = Math.max(shake, 0.012 * (1 - since / 0.8));
  if (since >= 0 && hitSince > -0.3 && hitSince < 1) shake = Math.max(shake, 0.05 * (1 - Math.abs(hitSince - 0.15) / 0.9));
  const start = times.a - NUKE.laptopSec;
  const laptop = t >= start && t < times.a + 0.35 ? Math.min(1, (t - start) / (NUKE.laptopSec + 0.35)) : -1;
  return {
    phase: nukePhase(t, times),
    number: countdownNumber(t, times),
    since,
    hitSince,
    white,
    timeScale: nukeTimeScale(since),
    cloud: cloudGrowth(since),
    shake: Math.max(0, shake),
    laptop,
    over,
  };
}

/** Laptop pose through the call-in (k 0..1): how far it is raised, the lid open, the key pressed. */
export function laptopPose(k: number): { raise: number; lid: number; press: number } {
  if (k < 0) return { raise: 0, lid: 0, press: 0 };
  const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const raise = k < 0.82 ? ease(k / 0.18) : 1 - ease((k - 0.82) / 0.18);
  const lid = ease((k - 0.12) / 0.25);
  const press = k > 0.55 && k < 0.7 ? 1 - Math.abs(k - 0.625) / 0.075 : 0;
  return { raise, lid, press };
}

/** The countdown's announcer-style lines for the viewer's side. */
export function nukeLines(side: NukeSide, number: number, ownerName = ''): { head: string; line: string } {
  const head = 'TACTICAL NUKE INCOMING';
  if (number <= 3) return { head, line: number > 0 ? `IMPACT IN ${number}` : '' };
  if (side === 'mine') return { head, line: number > 7 ? 'YOU CALLED IN A TACTICAL NUKE' : 'THE GAME IS YOURS' };
  if (side === 'friendly') return { head, line: number > 7 ? `FRIENDLY TACTICAL NUKE INBOUND${ownerName ? ` (${ownerName.toUpperCase()})` : ''}` : 'FRIENDLY NUKE: HOLD ON' };
  return { head, line: number > 7 ? 'ENEMY TACTICAL NUKE INBOUND' : 'NOWHERE TO HIDE' };
}

/** The countdown second that just began between `prev` and `t` (to sound the siren once per second), or null. */
export function sirenTick(prev: number, t: number, times: Pick<NukeTimes, 'a' | 'd'>): number | null {
  if (t < times.a || t >= times.d) return null;
  const a = Math.floor(t - times.a);
  const b = prev < times.a ? -1 : Math.floor(prev - times.a);
  return a !== b ? a : null;
}
