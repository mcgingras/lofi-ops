/** Pure helpers of the per-death killcam playback: timeline, camera aim and the killer card text. */
import { papName } from '../../../shared/defs/pack-a-punch';
import { PLAYER } from '../../../shared/constants';
import type { CamTrack, KillerCard } from '../../../shared/defs/deathcam';
import type { Pose } from './killcam-math';

export interface DeathcamClock {
  /** 'beat' = still on the death view, 'play' = replaying, 'done' = over (or cut by the respawn). */
  state: 'beat' | 'play' | 'done';
  /** Clip (room) time being shown. */
  t: number;
  /** Seconds of replay left (the KILLCAM timer). */
  left: number;
}

/**
 * Where the replay is at room time `now`. Anchored to room time, not to when the clip arrived, so
 * a late clip starts part-way and the replay always ends by the respawn.
 */
export function deathcamClock(playAt: number, respawnAt: number | null, from: number, to: number, now: number): DeathcamClock {
  const end = respawnAt === null ? to : Math.min(to, from + (respawnAt - playAt));
  if (now < playAt) return { state: 'beat', t: from, left: Math.max(0, end - from) };
  const t = from + (now - playAt);
  if (t >= end) return { state: 'done', t: end, left: 0 };
  return { state: 'play', t, left: end - t };
}

/** KILLCAM timer text, BO1 style: "0:01.4". */
export function killcamTimer(left: number): string {
  const tenths = Math.max(0, Math.ceil(left * 10));
  const s = Math.floor(tenths / 10);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${tenths % 10}`;
}

/** Camera yaw/pitch looking from `a` to `b` (yaw 0 looks down -z, like `viewDir`). */
export function aimAt(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): { yaw: number; pitch: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/**
 * Riding a camera track (the Valkyrie rocket) at room time `t`: the position between the two
 * points around `t`, looking along the flight. Before the first point: there, looking the first
 * way. After the last (the blast): pulled back `back` m along the last heading and up, looking at it.
 */
export function trackPose(track: CamTrack, t: number, back = 4): { x: number; y: number; z: number; yaw: number; pitch: number; done: boolean } {
  const pts = track.p.map((q) => ({ t: track.t0 + q[0]! / 1000, x: q[1]! / 100, y: q[2]! / 100, z: q[3]! / 100 }));
  const n = pts.length;
  if (!n) return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, done: true };
  const heading = (i: number) => {
    const a = pts[Math.max(0, Math.min(n - 2, i))]!;
    const b = pts[Math.max(1, Math.min(n - 1, i + 1))] ?? a;
    return aimAt(a, b);
  };
  const last = pts[n - 1]!;
  if (n === 1 || t >= last.t) {
    const h = heading(n - 2);
    const d = { x: -Math.sin(h.yaw) * Math.cos(h.pitch), y: Math.sin(h.pitch), z: -Math.cos(h.yaw) * Math.cos(h.pitch) };
    const from = { x: last.x - d.x * back, y: last.y - d.y * back + 1.2, z: last.z - d.z * back };
    return { ...from, ...aimAt(from, last), done: true };
  }
  let i = 0;
  while (i < n - 2 && pts[i + 1]!.t <= t) i++;
  const a = pts[i]!;
  const b = pts[i + 1]!;
  const k = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 1;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, ...heading(i), done: false };
}

/** Eye height of a replayed pose (crouch / prone flags). */
export const eyeOf = (p: Pose, crouchBit: number, proneBit = 0) => (p.f & proneBit ? PLAYER.proneEye : p.f & crouchBit ? PLAYER.crouchEye : PLAYER.eye);

/** Killer card lines: rank, weapon with attachments, health. */
export function cardLines(card: KillerCard, names: { weapon: (id: string) => string; attachment: (id: string) => string; rank: (level: number) => string }): { rank: string; weapon: string; attachments: string; health: string; healthFrac: number } {
  const rank = card.prestige > 0 ? `PRESTIGE ${card.prestige} · LV ${card.level}` : `${names.rank(card.level)} · LV ${card.level}`;
  const frac = card.maxHealth > 0 ? Math.max(0, Math.min(1, card.health / card.maxHealth)) : 0;
  return {
    rank: rank.toUpperCase(),
    // A Pack-a-Punched gun shows its upgraded name (Skullpiercer, not M16).
    weapon: (card.pap ? papName(card.weapon) : names.weapon(card.weapon)).toUpperCase(),
    attachments: card.attachments.map((a) => names.attachment(a).toUpperCase()).join(' + '),
    health: card.health > 0 ? `${Math.round(frac * 100)}% HEALTH` : 'DEAD',
    healthFrac: frac,
  };
}
