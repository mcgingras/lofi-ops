/**
 * Thundergun: a blast of air down a widening tube (BO1's cylinder test, `inTube`). Everyone in it
 * with a clear line from the muzzle takes `thunderDamage` (a kill up close) and, if still standing,
 * is launched (`thunderLaunch` -> `applyKnock` on their MoveState: the server moves them and their
 * own prediction replays it). Out to THUNDERGUN.knockRange they are shoved for 15. A launch
 * remembers the shooter: a fall out of the map within `creditSec` is their kill (`creditEdgeKills`).
 */
import { papWonder } from '../../../../shared/defs/pack-a-punch';
import { THUNDERGUN, inTube, thunderDamage, thunderLaunch } from '../../../../shared/defs/wonder';
import type { HitPart } from '../../../../shared/collision';
import { applyKnock } from '../../../../shared/movement';
import type { WeaponBehavior } from '../../../combat';
import type { PlayerState } from '../../../player';
import type { Room } from '../../../room';
import { bodyPoints, chest, emitFire, targetsOf, v3, wonderFx, wonderOf } from './common';

export const thundergunBehavior: WeaponBehavior = {
  fire(room, player, weapon, shot) {
    const o = shot.origin;
    const dir = shot.dir;
    // Packed (Zeus Cannon): a wider tube.
    const wide = weapon.pap ? (papWonder('thundergun').radiusMult ?? 1) : 1;
    const T = { ...THUNDERGUN, r0: THUNDERGUN.r0 * wide, r1: THUNDERGUN.r1 * wide };
    const hits: { victim: PlayerState; part: HitPart; damage: number }[] = [];
    wonderFx(room, { k: 'blast', p: player.id, o: v3(o), d: v3(dir), ...(wide !== 1 ? { u: wide } : {}) });
    for (const q of targetsOf(room, player)) {
      // Any of feet / chest / head inside the tube, and a clear line to it (BO1's DamageConeTrace).
      let best: { along: number; off: number; dist: number } | null = null;
      let seen = false;
      for (const pt of bodyPoints(q)) {
        const tube = inTube(o, dir, pt, T.knockRange, T.r0, T.r1);
        if (!tube) continue;
        if (!best || tube.dist < best.dist) best = tube;
        if (!seen && room.world.lineOfSight(o, pt, 'bullets')) seen = true;
      }
      if (!best || !seen) continue;
      const c = chest(q);
      if (best.dist <= T.range) {
        const dealt = room.damage({ victim: q, attacker: player, amount: thunderDamage(best.dist), weapon: 'thundergun', part: 'torso', means: 'wonder', from: o, distance: best.dist });
        hits.push({ victim: q, part: 'torso', damage: dealt });
        if (q.alive) launch(room, q, player, thunderLaunch(o, dir, c, best.dist), T.knockSec);
        else wonderFx(room, { k: 'fling', v: q.id, x: Math.round(dir.x * 100) / 100, y: 0.5, z: Math.round(dir.z * 100) / 100 });
      } else {
        const dealt = room.damage({ victim: q, attacker: player, amount: T.knockDamage, weapon: 'thundergun', part: 'torso', means: 'wonder', from: o, distance: best.dist });
        hits.push({ victim: q, part: 'torso', damage: dealt });
        if (q.alive) {
          const l = Math.hypot(dir.x, dir.z) || 1;
          launch(room, q, player, { x: (dir.x / l) * T.launch.shove, y: T.launch.shoveUp, z: (dir.z / l) * T.launch.shove }, T.shoveSec);
        }
      }
    }
    const wall = room.world.raycast(o, dir, T.range, 'bullets');
    const t = wall ? wall.t : T.range;
    emitFire(room, player, 'thundergun', o, dir, { x: o.x + dir.x * t, y: o.y + dir.y * t, z: o.z + dir.z * t }, hits);
  },
};

/** Throw a body: the impulse goes on its MoveState (snapshotted, so its owner predicts the flight). */
export function launch(room: Room, q: PlayerState, by: PlayerState | null, impulse: { x: number; y: number; z: number }, sec: number): void {
  // Shockproof (Flak Jacket Pro) and the like: the hit lands, the body stays put.
  const k = room.modifiers.mul('knockbackMultiplier', q);
  if (!(k > 0)) return;
  applyKnock(q.move, { x: impulse.x * k, y: impulse.y * k, z: impulse.z * k }, sec);
  const w = wonderOf(q);
  w.knockBy = by?.id ?? null;
  w.knockAt = room.time;
}

/**
 * Credit falls off the map to the Thundergun: a launched player about to leave the map (core kills
 * them under the kill floor / outside the bounds next tick with no attacker) dies to the shooter
 * instead. Runs on the tick, after movement; looks a few ticks ahead so core never gets there first.
 */
export function creditEdgeKills(room: Room): void {
  if (room.phase !== 'playing') return;
  const b = room.map.bounds;
  const floor = Math.max(b.min.y, -40);
  for (const p of room.players.values()) {
    const w = p.ext.wonder;
    if (!p.alive || !w?.knockBy || room.time - w.knockAt > THUNDERGUN.creditSec) continue;
    const m = p.move;
    const ahead = 0.06;
    const nx = m.x + m.vx * ahead;
    const ny = m.y + Math.min(0, m.vy) * ahead - 0.1;
    const nz = m.z + m.vz * ahead;
    const out = ny < floor || nx < b.min.x - 1.6 || nx > b.max.x + 1.6 || nz < b.min.z - 1.6 || nz > b.max.z + 1.6;
    if (!out) continue;
    const by = room.players.get(w.knockBy) ?? null;
    w.knockBy = null;
    if (by && by !== p && room.isEnemy(by, p)) room.kill(p, by, { weapon: 'thundergun', means: 'wonder', distance: Math.hypot(by.move.x - m.x, by.move.z - m.z) });
  }
}
