/**
 * The Yard's Zombies layer, at night: survivors start among the containers in the middle with the
 * box; the walls around the yard carry the guns (the warehouse to the north, the shed to the west,
 * the container wall to the south) and the Perk-a-Colas stand against them. Zombies come over the
 * walls from every side.
 *
 * Coordinates: +x east, +z south; yaw 0 faces north (-z), PI/2 west, -PI/2 east, PI south.
 * Spots were snapped with scripts/zm-place.ts and checked with scripts/zm-layout.ts.
 */
import type { ZombiesLayer } from './types';

const N = 0;
const S = Math.PI;
const E = -Math.PI / 2;
const W = Math.PI / 2;

export const YARD_ZOMBIES: ZombiesLayer = {
  map: 'yard',
  time: 'night',
  playerSpawns: [
    { x: 6, y: 0, z: -2, yaw: W },
    { x: 10, y: 0, z: 8, yaw: N },
    { x: -8, y: 0, z: 10, yaw: N },
    { x: -14, y: 0, z: -4, yaw: E },
  ],
  wallBuys: [
    { weapon: 'olympia', x: -27.98, y: 0, z: 9.75, yaw: E },
    { weapon: 'mpl', x: -27.98, y: 0, z: -10.25, yaw: E },
    { weapon: 'mp5k', x: -15.25, y: 0, z: -25.98, yaw: S },
    { weapon: 'ak74u', x: 14.75, y: 0, z: -25.98, yaw: S },
    { weapon: 'm16a4', x: 9.75, y: 0, z: 29.76, yaw: N },
    { weapon: 'stakeout', x: -10.25, y: 0, z: 29.76, yaw: N },
  ],
  boxSpots: [
    { x: -0.25, y: 0, z: 3.75, yaw: N },
    { x: -12.25, y: 0, z: -6.25, yaw: E },
    { x: 11.75, y: 0, z: 11.75, yaw: W },
    { x: -10.25, y: 0, z: 11.75, yaw: E },
  ],
  perks: [
    { perk: 'revive', x: 2.75, y: 0, z: 29.36, yaw: N },
    { perk: 'jugg', x: -6.25, y: 0, z: -25.58, yaw: S },
    { perk: 'speed', x: 7.75, y: 0, z: -25.58, yaw: S },
    { perk: 'doubletap', x: -27.58, y: 0, z: 0.75, yaw: E },
  ],
  zombieSpawns: [
    { x: -26.25, y: 0, z: -24.25 },
    { x: 25.75, y: 0, z: -24.25 },
    { x: -26.25, y: 0, z: 28.75 },
    { x: 25.75, y: 0, z: 28.75 },
    { x: -0.25, y: 0, z: -25.25 },
    { x: 25.75, y: 0, z: -0.25 },
    { x: -27.25, y: 0, z: -0.25 },
    { x: -0.25, y: 0, z: 29.25 },
    { x: 14.75, y: 0, z: 29.25 },
    { x: -15.25, y: 0, z: -25.25 },
    { x: 25.75, y: 0, z: 14.75 },
    { x: -26.25, y: 0, z: 17.75 },
    { x: 14.75, y: 0, z: -25.25 },
  ],
};
