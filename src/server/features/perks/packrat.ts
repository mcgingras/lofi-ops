/**
 * Pack Rat (tier 2; numbers in shared/defs/pack-rat.ts):
 *
 * - `pickupHoldMultiplier` 0: the weapon pickups feature swaps on a tap of USE (humans and bots);
 * - `swapMultiplier` x0.6 on every weapon switch;
 * - on `pickups.swapped`: the gun in hand comes up in 30% of its raise time and wears the camo the
 *   player equipped for that slot (a slot without camo keeps the gun's own); Pro tops it up to a
 *   full magazine and full reserve.
 *
 * Pack Rat Pro challenge: kills with a gun picked up off the ground.
 */
import { PACK_RAT } from '../../../shared/defs/pack-rat';
import type { PlayerState, WeaponState } from '../../player';
import type { Room } from '../../room';
import { hasPerk, isPro, progress } from './common';

declare module '../../modifiers' {
  interface ModifierMap {
    /** Multiplier on the USE hold needed to swap for a dropped gun (Pack Rat: 0 = a tap). Weapon pickups read it. */
    pickupHoldMultiplier: (p: PlayerState) => number | undefined;
  }
}

/** Guns that came off the ground (for the Pro challenge). */
const picked = new WeakSet<WeaponState>();

export function setupPackRat(room: Room): void {
  room.modifiers.add('pickupHoldMultiplier', (p) => (hasPerk(p, 'pack_rat') ? PACK_RAT.holdMul : undefined), 'perks.pack_rat');
  room.modifiers.add('swapMultiplier', (p) => (hasPerk(p, 'pack_rat') ? PACK_RAT.swapMul : undefined), 'perks.pack_rat_swap');
  room.bus.on('pickups.swapped', ({ player, slot }) => {
    const w = player.weapons[slot];
    if (!w) return;
    picked.add(w);
    if (!hasPerk(player, 'pack_rat')) return;
    const mine = slot === 0 ? player.loadout?.primary : slot === 1 ? player.loadout?.secondary : undefined;
    if (mine?.camo && mine.camo !== 'none') w.camo = mine.camo;
    if (isPro(player, 'pack_rat')) {
      w.mag = w.def.magazine;
      w.reserve = Math.max(w.reserve, w.def.reserve);
    }
    if (slot === player.slot) player.swapEnd = room.time + ((w.def.swapMs ?? 500) / 1000) * PACK_RAT.pickupRaise;
  });
  room.bus.on('death', ({ victim, attacker, weapon }) => {
    if (!attacker || attacker === victim || !hasPerk(attacker, 'pack_rat') || !room.isEnemy(attacker, victim)) return;
    if (attacker.weapons.some((w) => picked.has(w) && w.def.base.id === weapon)) progress(room, attacker, 'pack_rat_pro');
  });
}
