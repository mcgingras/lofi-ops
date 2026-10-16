/**
 * Firing Range Zombies layer, in the evening: survivors start west of the tower crossroads with the
 * box. Guns hang on the north building by the crossroads (Olympia), the Showers (MP5K), the Garage
 * (AK-74u and Stakeout) and the Range house (M16); Quick Revive waits at the Showers, Juggernog in
 * the Garage yard, Speed Cola on the Range and Double Tap by the south containers. Zombies come out
 * of the jungle edges, the north road and the south fields.
 *
 * Coordinates: +x east, +z south; yaw 0 faces north (-z), PI/2 west, -PI/2 east, PI south.
 * Spots were snapped with scripts/zm-place.ts and checked with scripts/zm-layout.ts.
 */
import type { ZombiesLayer } from './types';

const N = 0;
const S = Math.PI;
const E = -Math.PI / 2;
const W = Math.PI / 2;

export const FIRINGRANGE_ZOMBIES: ZombiesLayer = {
  map: 'firingrange',
  time: 'evening',
  playerSpawns: [
    { x: -10.25, y: 0, z: 0.75, yaw: S },
    { x: -15.25, y: 0, z: 1.25, yaw: S },
    { x: -9.25, y: 0, z: 8.75, yaw: N },
    { x: -20, y: 0, z: 7, yaw: E },
  ],
  wallBuys: [
    { weapon: 'olympia', x: 5.25, y: 0, z: -10.77, yaw: N },
    { weapon: 'mp5k', x: -28.75, y: 0, z: -24.67, yaw: N },
    { weapon: 'ak74u', x: 22.25, y: 0, z: 12.72, yaw: S },
    { weapon: 'stakeout', x: 18.75, y: 0, z: 12.72, yaw: S },
    { weapon: 'm16a4', x: 23.98, y: 0, z: -7.25, yaw: W },
  ],
  boxSpots: [
    { x: -12.25, y: 0, z: 4.75, yaw: E },
    { x: 20.75, y: 0, z: -0.25, yaw: W },
    { x: -25.75, y: 0, z: 7.75, yaw: E },
    { x: -13.25, y: 0, z: -37.25, yaw: S },
  ],
  perks: [
    { perk: 'revive', x: -27.75, y: 0, z: -23.98, yaw: S },
    { perk: 'jugg', x: 19.25, y: 0, z: 11.98, yaw: N },
    { perk: 'speed', x: 28.62, y: 0, z: 19.25, yaw: E },
    { perk: 'doubletap', x: 9.75, y: 0, z: 29.78, yaw: N },
  ],
  zombieSpawns: [
    { x: -36.25, y: 0, z: -15.25 },
    { x: -38.25, y: 0, z: 10.25 },
    { x: -19.75, y: 0, z: 36.75 },
    { x: 2.25, y: 0, z: 41.25 },
    { x: 34.75, y: 0, z: 3.75 },
    { x: 35.75, y: 0, z: 29.75 },
    { x: -13.25, y: 0, z: -44.25 },
    { x: -35.25, y: 0, z: -30.25 },
    { x: -29.75, y: 0, z: 23.75 },
    { x: 8.25, y: 0, z: -16.25 },
    { x: -17.25, y: 0, z: -37.75 },
  ],
};
