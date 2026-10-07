/** Pure helpers of the per-death killcam playback: timeline, camera aim and the killer card text. */
import type { KillerCard } from '../../../shared/defs/deathcam';
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

/** Eye height of a replayed pose (crouch flag). */
export const eyeOf = (p: Pose, crouchBit: number) => (p.f & crouchBit ? 1.0 : 1.6);

/** Killer card lines: rank, weapon with attachments, health. */
export function cardLines(card: KillerCard, names: { weapon: (id: string) => string; attachment: (id: string) => string; rank: (level: number) => string }): { rank: string; weapon: string; attachments: string; health: string; healthFrac: number } {
  const rank = card.prestige > 0 ? `PRESTIGE ${card.prestige} · LV ${card.level}` : `${names.rank(card.level)} · LV ${card.level}`;
  const frac = card.maxHealth > 0 ? Math.max(0, Math.min(1, card.health / card.maxHealth)) : 0;
  return {
    rank: rank.toUpperCase(),
    weapon: names.weapon(card.weapon).toUpperCase(),
    attachments: card.attachments.map((a) => names.attachment(a).toUpperCase()).join(' + '),
    health: card.health > 0 ? `${Math.round(frac * 100)}% HEALTH` : 'DEAD',
    healthFrac: frac,
  };
}
