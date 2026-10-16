/**
 * Wunderwaffe DG-2: an instant bolt along the aim (45 m). The first enemy on the line (or within
 * WUNDERWAFFE.aimRadius of it, or within `splashR` of where it hits the world) dies, then the arc
 * jumps to up to `hops` more enemies, each within `hopRange` of the previous victim with a clear
 * line between them (`chainTargets`), one every `hopDelay`. Every hop is lethal and its own
 * `fire` event (killcam arcs) and `arc` effect.
 */
import { rayHitboxes } from '../../../../shared/collision';
import { shotSeed, spreadDegrees, spreadDirection, stanceSpread } from '../../../../shared/ballistics';
import { WUNDERWAFFE, chainTargets } from '../../../../shared/defs/wonder';
import { normalize, type Vec3 } from '../../../../shared/math';
import { moveHitboxes } from '../../../../shared/movement';
import type { WeaponBehavior } from '../../../combat';
import type { PlayerState } from '../../../player';
import type { Room } from '../../../room';
import { chest, emitFire, targetsOf, v3, wonderFx } from './common';

/** Distance from point `p` to the segment origin + dir * [0, len]. */
function offRay(o: Vec3, dir: Vec3, len: number, p: Vec3): { along: number; off: number } {
  const dx = p.x - o.x;
  const dy = p.y - o.y;
  const dz = p.z - o.z;
  const along = Math.max(0, Math.min(len, dx * dir.x + dy * dir.y + dz * dir.z));
  return { along, off: Math.hypot(dx - dir.x * along, dy - dir.y * along, dz - dir.z * along) };
}

/** Who the bolt strikes first and where it ends: a body on (or next to) the line, else whoever stands at the impact. */
export function firstStrike(room: Room, p: PlayerState, o: Vec3, dir: Vec3): { victim: PlayerState | null; end: Vec3 } {
  const W = WUNDERWAFFE;
  const wall = room.world.raycast(o, dir, W.range, 'bullets');
  let maxT = wall ? wall.t : W.range;
  let victim: PlayerState | null = null;
  const enemies = targetsOf(room, p);
  for (const q of enemies) {
    const h = rayHitboxes(o, dir, moveHitboxes(q.move, q.yaw), maxT);
    if (h) {
      maxT = h.t;
      victim = q;
    }
  }
  if (!victim) {
    // Forgiving aim: the nearest body whose chest is right beside the line, in sight.
    let best = Infinity;
    for (const q of enemies) {
      const c = chest(q);
      const r = offRay(o, dir, maxT, c);
      if (r.off <= W.aimRadius && r.along < best && room.world.lineOfSight(o, c, 'bullets')) {
        best = r.along;
        victim = q;
      }
    }
  }
  if (victim) return { victim, end: chest(victim) };
  const end = { x: o.x + dir.x * maxT, y: o.y + dir.y * maxT, z: o.z + dir.z * maxT };
  if (wall) {
    // It struck the ground or a wall: it arcs to someone standing right there.
    const back = { x: end.x - dir.x * 0.1, y: end.y - dir.y * 0.1, z: end.z - dir.z * 0.1 };
    let bd: number = W.splashR;
    for (const q of enemies) {
      const c = chest(q);
      const d = Math.min(Math.hypot(c.x - back.x, c.y - back.y, c.z - back.z), Math.hypot(q.move.x - back.x, q.move.y + 0.3 - back.y, q.move.z - back.z));
      if (d <= bd && room.world.lineOfSight(back, c, 'bullets')) {
        bd = d;
        victim = q;
      }
    }
  }
  return { victim, end };
}

function zap(room: Room, p: PlayerState, victim: PlayerState, from: Vec3, hop: number): void {
  const to = chest(victim);
  wonderFx(room, { k: 'arc', p: p.id, o: v3(from), e: v3(to), hop, hit: true });
  const dir = normalize({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z });
  const dealt = room.damage({ victim, attacker: p, amount: WUNDERWAFFE.damage, weapon: 'wunderwaffe', part: 'torso', means: 'wonder', from, distance: Math.hypot(p.move.x - victim.move.x, p.move.z - victim.move.z) });
  emitFire(room, p, 'wunderwaffe', from, dir, to, [{ victim, part: 'torso', damage: dealt }]);
}

export const wunderwaffeBehavior: WeaponBehavior = {
  fire(room, player, weapon, shot) {
    const moving = Math.hypot(player.move.vx, player.move.vz) > 0.5;
    const spread = spreadDegrees(weapon.def, player.move.ads, moving, room.modifiers.mul('spreadMultiplier', player) * stanceSpread(player.move));
    const dir = spreadDirection(shot.dir, spread, shotSeed(player.seed, shot.shot, 0));
    const o = shot.origin;
    const { victim, end } = firstStrike(room, player, o, dir);
    if (!victim) {
      wonderFx(room, { k: 'arc', p: player.id, o: v3(o), e: v3(end), hop: 0, hit: false });
      emitFire(room, player, 'wunderwaffe', o, dir, end);
      return;
    }
    // Plan the chain now (who stands near whom at the strike), deliver it hop by hop.
    const cands = targetsOf(room, player).map((q) => ({ q, at: chest(q) }));
    const first = cands.find((c) => c.q === victim) ?? { q: victim, at: chest(victim) };
    const chain = chainTargets(first, cands, WUNDERWAFFE.hops, WUNDERWAFFE.hopRange, (a, b) => room.world.lineOfSight(a, b, 'bullets'));
    zap(room, player, victim, o, 0);
    let prev = first.at;
    chain.forEach((c, i) => {
      const from = prev;
      prev = c.at;
      room.schedule(WUNDERWAFFE.hopDelay * (i + 1), () => {
        if (room.phase !== 'playing' || !c.q.alive || !room.players.has(c.q.id) || !room.canDamage(player, c.q)) return;
        zap(room, player, c.q, from, i + 1);
      });
    });
  },
};
