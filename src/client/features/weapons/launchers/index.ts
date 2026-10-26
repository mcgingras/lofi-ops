/**
 * Client side of the secondary launchers (weapons feature; rules in shared/defs/launchers.ts,
 * server in server/features/weapons/launchers/): the five models (first and third person, dropped,
 * Create-a-Class), the projectiles and shot looks, and the HUD (lock-on box and tones, launcher
 * crosshairs, killfeed icons). Sounds are registered from ../sounds.ts (the sound tests see them);
 * explosions go through ../equipment.ts `boom` (sized by the launcher's blast).
 */
import './models';
import './fx';
import './hud';

export { LAUNCHER_GUNS } from './models';
export { lockState, seekInterval } from './hud';
