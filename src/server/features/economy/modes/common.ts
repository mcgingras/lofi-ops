/**
 * Shared pieces of the wager modes: forced weapons, the one-hit knife, FFA placement by a custom
 * ranking, and the per-player HUD push. (The crossbow bolt and ballistic knife blade live in
 * `../projectiles.ts`; the tomahawk is a weapons-feature lethal.)
 */
import { WAGER_MELEE } from '../../../../shared/defs/economy';
import type { WagerModeHud } from '../../../../shared/defs/economy-net';
import { WEAPON_BY_ID } from '../../../../shared/defs/weapons';
import type { MatchResults } from '../../../../shared/events';
import type { WeaponLoadout } from '../../../../shared/loadout';
import { viewDir } from '../../../../shared/math';
import { eyeOf } from '../../../combat';
import { standardResults, type ModeRules } from '../../../modes/index';
import { makeWeapon, type PlayerState } from '../../../player';
import type { Room } from '../../../room';
import type { WagerPlayerExt } from '../types';

/** Mode rules plus what the wager manager needs: live ranking and the per-player HUD. */
export interface WagerRules extends ModeRules {
  /** Players best first (drives placement, payouts and the "in the money" HUD). */
  rank(room: Room): PlayerState[];
  hud(room: Room, p: PlayerState): WagerModeHud;
}

export const isWagerRules = (r: ModeRules): r is WagerRules => typeof (r as Partial<WagerRules>).rank === 'function';

export const wx = (p: PlayerState): WagerPlayerExt => (p.ext.wager ??= {});

/** Replace a player's weapons right now (slot 0 raised). Unknown ids fall back to the M1911. */
export function giveWeapons(room: Room, p: PlayerState, weapons: (string | WeaponLoadout)[], ammo?: { mag?: number; reserve?: number }): void {
  p.weapons = weapons.map((w) => {
    const wl = typeof w === 'string' ? { weapon: w, attachments: [], camo: 'none' } : w;
    const ws = makeWeapon(wl, 'm1911');
    if (ammo?.mag !== undefined) ws.mag = Math.min(ammo.mag, ws.def.magazine);
    if (ammo?.reserve !== undefined) ws.reserve = ammo.reserve;
    return ws;
  });
  p.slot = 0;
  p.reloadEnd = 0;
  const swap = p.weapons[0]?.def.swapMs ?? 500;
  p.swapEnd = room.time + Math.min(0.6, swap / 1000);
}

export const weaponName = (id: string | undefined | null) => (id ? (WEAPON_BY_ID.get(id)?.name ?? id) : '');

/** Push this player's mode HUD (no-op for bots). */
export function pushHud(room: Room, rules: WagerRules, p: PlayerState): void {
  if (p.session) room.sendFeature(p, 'economy.mode', rules.hud(room, p));
}

export function pushHudAll(room: Room, rules: WagerRules): void {
  for (const p of room.humans()) pushHud(room, rules, p);
}

/**
 * The wager knife: the nearest enemy in a short cone in front, in line of sight, dies. Returns the
 * victim. Idempotent with any other melee implementation (a dead victim can't die twice).
 */
export function wagerMelee(room: Room, p: PlayerState): PlayerState | null {
  if (room.phase !== 'playing' || !p.alive) return null;
  const st = wx(p);
  if (room.time - (st.lastMelee ?? -99) < WAGER_MELEE.cooldownSec) return null;
  st.lastMelee = room.time;
  const eye = eyeOf(p);
  const fwd = viewDir(p.yaw, 0);
  let best: PlayerState | null = null;
  let bestD = Infinity;
  for (const q of room.players.values()) {
    if (q === p || !q.alive || !room.canDamage(p, q)) continue;
    const chest = { x: q.move.x, y: q.move.y + 1.1, z: q.move.z };
    const dx = chest.x - eye.x;
    const dz = chest.z - eye.z;
    const d = Math.hypot(dx, dz);
    if (d > WAGER_MELEE.range || Math.abs(chest.y - eye.y) > 1.6) continue;
    const dot = d < 0.3 ? 1 : (dx * fwd.x + dz * fwd.z) / d;
    if (dot < WAGER_MELEE.minDot) continue;
    if (!room.world.lineOfSight(eye, chest, 'bullets')) continue;
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  if (!best) return null;
  room.damage({ victim: best, attacker: p, amount: 1000, weapon: 'knife', part: 'torso', means: 'melee', from: eye, distance: bestD });
  return best;
}

/** Standard results re-ordered by the mode's ranking (place 1 = winner). */
export function rankedResults(room: Room, reason: MatchResults['reason'], order: PlayerState[]): MatchResults {
  const res = standardResults(room, reason);
  const pos = new Map(order.map((p, i) => [p.id, i]));
  res.players.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  res.players.forEach((r, i) => {
    r.place = i + 1;
    r.won = i === 0;
  });
  res.winners = res.players.length ? [res.players[0]!.id] : [];
  return res;
}

/** By score, then kills, then fewer deaths. */
export const byScore = (a: PlayerState, b: PlayerState) => b.stats.score - a.stats.score || b.stats.kills - a.stats.kills || a.stats.deaths - b.stats.deaths;
