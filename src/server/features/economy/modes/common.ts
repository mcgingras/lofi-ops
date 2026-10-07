/**
 * Shared pieces of the wager modes: forced weapons, the one-hit knife, projectile stepping
 * (tomahawks, crossbow bolts), FFA placement by a custom ranking, and the per-player HUD push.
 */
import { playerHitboxes, rayHitboxes } from '../../../../shared/collision';
import { WAGER_MELEE } from '../../../../shared/defs/economy';
import type { WagerModeHud } from '../../../../shared/defs/economy-net';
import { WEAPON_BY_ID } from '../../../../shared/defs/weapons';
import type { MatchResults } from '../../../../shared/events';
import type { WeaponLoadout } from '../../../../shared/loadout';
import { viewDir, type Vec3 } from '../../../../shared/math';
import { eyeOf } from '../../../combat';
import type { Entity } from '../../../entities';
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

export interface Projectile {
  vel: Vec3;
  gravity: number;
  owner: string;
  born: number;
  life: number;
  /** Stuck in the world (crossbow bolt fuse running). */
  stuckAt?: number;
}

/**
 * Advance a projectile entity one tick. Returns what it hit (a player, the world) or null.
 * The entity's `data` must be a Projectile.
 */
export function stepProjectile(room: Room, e: Entity, dt: number): { player: PlayerState; part: 'head' | 'torso' | 'legs'; at: Vec3 } | { world: Vec3 } | null {
  const pr = e.data as Projectile;
  if (pr.stuckAt !== undefined) return null;
  pr.vel.y -= pr.gravity * dt;
  const from = { x: e.x, y: e.y, z: e.z };
  const step = { x: pr.vel.x * dt, y: pr.vel.y * dt, z: pr.vel.z * dt };
  const L = Math.hypot(step.x, step.y, step.z);
  if (L < 1e-6) return null;
  const dir = { x: step.x / L, y: step.y / L, z: step.z / L };
  const wall = room.world.raycast(from, dir, L, 'bullets');
  let maxT = wall ? wall.t : L;
  let victim: PlayerState | null = null;
  let part: 'head' | 'torso' | 'legs' = 'torso';
  const owner = room.players.get(pr.owner);
  for (const q of room.players.values()) {
    if (!q.alive || q.id === pr.owner) continue;
    if (owner && !room.canDamage(owner, q)) continue;
    const hit = rayHitboxes(from, dir, playerHitboxes(q.move, q.move.crouched), maxT);
    if (hit) {
      maxT = hit.t;
      victim = q;
      part = hit.part;
    }
  }
  // Stop just short of a wall so a stuck bolt's blast isn't inside the brush.
  const t = victim ? maxT : Math.max(0, maxT - (wall ? 0.06 : 0));
  const at = { x: from.x + dir.x * t, y: from.y + dir.y * t, z: from.z + dir.z * t };
  e.x = at.x;
  e.y = at.y;
  e.z = at.z;
  e.yaw = Math.atan2(-pr.vel.x, -pr.vel.z);
  if (victim) return { player: victim, part, at };
  if (wall) return { world: at };
  const b = room.map.bounds;
  if (at.y < b.min.y - 5 || room.time - pr.born > pr.life) return { world: at };
  return null;
}

/** Launch velocity from a player's eye along their aim. */
export function throwFrom(p: PlayerState, speed: number, loft = 0): { origin: Vec3; vel: Vec3 } {
  const eye = eyeOf(p);
  const d = viewDir(p.yaw, p.pitch);
  return { origin: { x: eye.x + d.x * 0.4, y: eye.y + d.y * 0.4 - 0.05, z: eye.z + d.z * 0.4 }, vel: { x: d.x * speed, y: d.y * speed + loft, z: d.z * speed } };
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
