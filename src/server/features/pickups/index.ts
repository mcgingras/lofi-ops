/**
 * Server side of the 'pickups' feature: weapon drops and pickups as in BO1 / MW2. See
 * docs/features/pickups.md and src/shared/defs/pickups.ts.
 *
 *   death       the gun in the victim's hands drops at the body (mag, reserve, attachments, camo)
 *   tick        drops fall and land, despawn after PICKUP.lifeSec, at most PICKUP.maxPerRoom;
 *               humans holding USE on a gun in reach for PICKUP.holdSec swap for it (validated:
 *               alive, playing, reach, line of sight, not the same weapon, USE not claimed by a
 *               crate / plant / defuse / revive / streak through the `useClaimed` modifier);
 *               walking over a copy of a carried gun takes its ammo; bots pick guns up when dry
 *   roundStart  S&D: last round's guns vanish
 *
 * Events: `pickups.dropped`, `pickups.swapped`, `pickups.ammo` (drops.ts). Wager matches: no drops.
 */
import { pickDropTarget, PICKUP } from '../../../shared/defs/pickups';
import { Buttons } from '../../../shared/input';
import { eyeOf } from '../../combat';
import type { Feature } from '../../feature';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { updateBotPickups, wireBotGoal } from './bots';
import { carriesWeapon, dropOnDeath, dropsEnabled, dropsOf, onTopOf, swapBlocker, swapFor, takeAmmo, updateDrops } from './drops';
import { pickupsOf } from './state';

export { dropsOf, spawnDrop, swapBlocker, swapFor, takeAmmo, dropOnDeath, GL_SLOT, type DropData, type DropEntity } from './drops';
export { ammoNeed, botPickupSkill, chooseDrop } from './bots';
export { pickupsOf } from './state';

/** The gun a human holding USE would swap for right now (also what the client prompt shows). */
export function useTarget(room: Room, p: PlayerState) {
  const eye = eyeOf(p);
  return pickDropTarget(p.move, eye.y, p.yaw, p.pitch, dropsOf(room), (d) => d.data.landed && !carriesWeapon(p, d.data.weapon) && room.world.lineOfSight(eye, { x: d.x, y: d.y + 0.1, z: d.z }, 'players'));
}

function updateHumanUse(room: Room, p: PlayerState, dt: number): void {
  const st = pickupsOf(p);
  const holding = (p.buttons & Buttons.USE) !== 0;
  if (!holding) st.needRelease = false;
  if (!holding || st.needRelease || !p.alive) {
    st.hold = 0;
    st.target = null;
    return;
  }
  // USE went to a crate / objective / revive / streak: that hold never turns into a swap afterwards.
  if (room.modifiers.any('useClaimed', p) === true) {
    st.hold = 0;
    st.target = null;
    st.needRelease = true;
    return;
  }
  const target = useTarget(room, p);
  if (!target || swapBlocker(room, p, target) !== null) {
    st.hold = 0;
    st.target = null;
    return;
  }
  if (st.target !== target.id) {
    st.target = target.id;
    st.hold = 0;
  }
  st.hold += dt;
  if (st.hold + 1e-6 >= PICKUP.holdSec) {
    swapFor(room, p, target);
    st.hold = 0;
    st.target = null;
    st.needRelease = true;
  }
}

function updateWalkOver(room: Room): void {
  const drops = dropsOf(room).filter((d) => d.data.landed);
  if (!drops.length) return;
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    for (const d of drops) {
      if (!room.entities.get(d.id) || !carriesWeapon(p, d.data.weapon) || !onTopOf(p, d)) continue;
      takeAmmo(room, p, d);
    }
  }
}

const feature: Feature = {
  id: 'pickups',
  setup() {
    wireBotGoal();
  },
  room(room) {
    wireBotGoal();
    room.bus.on('death', ({ victim }) => {
      if (room.phase === 'playing' && dropsEnabled(room)) dropOnDeath(room, victim);
    });
    room.bus.on('spawn', ({ player }) => {
      const st = pickupsOf(player);
      st.hold = 0;
      st.target = null;
      st.botTarget = null;
      st.botHold = 0;
      st.needRelease = (player.buttons & Buttons.USE) !== 0;
    });
    // S&D: a new round starts clean.
    room.bus.on('modes.roundStart', () => {
      for (const d of dropsOf(room)) room.entities.remove(d.id);
    });
    room.bus.on('tick', ({ dt, tick }) => {
      if (room.phase !== 'playing') return;
      updateDrops(room, dt);
      if (!dropsEnabled(room)) return;
      for (const p of room.players.values()) if (!p.isBot) updateHumanUse(room, p, dt);
      if (tick % 6 === 0) updateWalkOver(room);
      updateBotPickups(room, dt);
    });
  },
};

export default feature;
