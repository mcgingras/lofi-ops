/**
 * Wunderwaffe DG-2: an instant bolt along the aim (45 m). The first enemy on the line (or within
 * WUNDERWAFFE.aimRadius of it, or within `splashR` of where it hits the world) dies, then the arc
 * jumps to up to `hops` more enemies, each within `hopRange` of the previous victim with a clear
 * line between them (`chainTargets`), one every `hopDelay`. Every hop is lethal and its own
 * `fire` event (killcam arcs) and `arc` effect.
 */
import { shotSeed, spreadDegrees, spreadDirection, stanceSpread } from '../../../../shared/ballistics';
import { WUNDERWAFFE, chainTargets } from '../../../../shared/defs/wonder';
import { normalize, type Vec3 } from '../../../../shared/math';
import type { WeaponBehavior } from '../../../combat';
import type { PlayerState } from '../../../player';
import type { Room } from '../../../room';
import { chest, emitFire, lineStrike, targetsOf, v3, wonderFx } from './common';

/** Who the bolt strikes first and where it ends: a body on (or next to) the line, else whoever stands at the impact. */
export function firstStrike(room: Room, p: PlayerState, o: Vec3, dir: Vec3): { victim: PlayerState | null; end: Vec3 } {
  const { victim, end } = lineStrike(room, p, o, dir, WUNDERWAFFE);
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
