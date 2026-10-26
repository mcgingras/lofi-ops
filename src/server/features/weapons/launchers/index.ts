/**
 * Server side of the secondary launchers (weapons feature; tuning in shared/defs/launchers.ts):
 * the China Lake, RPG-7, M72 LAW, Strela-3 and Stinger. One `WeaponBehavior` per id (`launch`),
 * and per room the projectiles (`flight.ts`), the lock-on (`lock.ts`) and Rocket Propelled
 * Grievance's burning ground. Bots: `bots.ts`.
 *
 * Like the underbarrel `gl`, a launcher shot replaces hitscan and emits no core `fire` event
 * (killstreak hardware is hit by the projectile itself, never by a phantom bullet line).
 */
import { LAUNCHER_IDS } from '../../../../shared/defs/launchers';
import type { WeaponBehavior } from '../../../combat';
import type { Room } from '../../../room';
import { clearFires, launch, updateFires, updateProjs } from './flight';
import { resetLock, updateLocks } from './lock';

export { launch, spawnProj, explode, type Proj } from './flight';
export { lockOf, takeLock, lockable, enemyAircraft, lockSecFor, type LockState } from './lock';
export { launcherBotPlan, airTargetFor, launcherAim, type LauncherBotPlan } from './bots';

const BEHAVIOR: WeaponBehavior = {
  fire(room, player, weapon, shot) {
    launch(room, player, weapon, shot);
  },
};

/** One behaviour per launcher id (idempotent). */
export function registerLauncherBehaviors(register: (id: string, b: WeaponBehavior) => void): void {
  for (const id of LAUNCHER_IDS) register(id, BEHAVIOR);
}

/** Per room: projectiles, locks, burning ground. */
export function wireLaunchers(room: Room): void {
  room.bus.on('tick', ({ dt }) => {
    if (room.phase !== 'playing') return;
    updateLocks(room);
    updateProjs(room, dt);
    updateFires(room);
  });
  room.bus.on('death', ({ victim }) => resetLock(room, victim));
  room.bus.on('spawn', ({ player }) => resetLock(room, player));
  room.bus.on('matchStart', () => clearFires(room));
}
