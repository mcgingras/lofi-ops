/**
 * Nuketown Zombies layer (a nod to BO2's Nuketown Zombies, on our BO1 Nuketown). Survivors start in
 * the turning circle; the box starts by the Welcome sign. Quick Revive stands on the green front
 * lawn, Juggernog in the green garage, Double Tap in the yellow garage, Speed Cola on the yellow
 * deck. Wall guns: Olympia in the green garage (the cheap one by the start), MPL and AK-74u inside
 * the green house, MP5K inside the yellow house, M16 in the yellow garage, Stakeout on the yellow
 * deck. Zombies climb out of the backyards, the side yards and the end of the street.
 *
 * Coordinates: +x east, +z south; yaw 0 faces north (-z), PI/2 west, -PI/2 east, PI south.
 * Spots were snapped with scripts/zm-place.ts and checked with scripts/zm-layout.ts.
 */
import type { ZombiesLayer } from './types';

const N = 0;
const S = Math.PI;
const E = -Math.PI / 2;
const W = Math.PI / 2;

export const NUKETOWN_ZOMBIES: ZombiesLayer = {
  map: 'nuketown',
  time: 'dusk',
  // The north end of the turning circle, by the box, looking down the street.
  playerSpawns: [
    { x: -1.5, y: 0, z: -11.5, yaw: S },
    { x: 1.5, y: 0, z: -11, yaw: S },
    { x: -4.5, y: 0, z: -11, yaw: S },
    { x: 6.5, y: 0, z: -11.5, yaw: S },
  ],
  wallBuys: [
    { weapon: 'olympia', x: -15.75, y: 0, z: 3.73, yaw: N },
    { weapon: 'mpl', x: -13.25, y: 0, z: -12.13, yaw: S },
    { weapon: 'ak74u', x: -22.93, y: 0, z: -10.75, yaw: E },
    { weapon: 'mp5k', x: 23.25, y: 0, z: 3.63, yaw: N },
    { weapon: 'm16a4', x: 17.75, y: 0, z: -13.63, yaw: S },
    { weapon: 'stakeout', x: 27.22, y: 0.25, z: -3.75, yaw: E },
  ],
  boxSpots: [
    { x: 1.75, y: 0, z: -14.25, yaw: S },
    { x: -32.25, y: 0, z: -6.25, yaw: E },
    { x: 38.25, y: 0, z: -4.25, yaw: W },
    { x: 1.75, y: 0, z: 11.75, yaw: N },
  ],
  perks: [
    { perk: 'revive', x: -6.25, y: 0, z: -6.25, yaw: E },
    { perk: 'jugg', x: -13.75, y: 0, z: -2.38, yaw: S },
    { perk: 'doubletap', x: 19.75, y: 0, z: -6.02, yaw: N },
    { perk: 'speed', x: 27.62, y: 0.25, z: 1.75, yaw: E },
  ],
  zombieSpawns: [
    { x: -37.75, y: 0, z: -8.25 },
    { x: -36.25, y: 0, z: 7.75 },
    { x: -40.25, y: 0, z: 1.75 },
    { x: -29.75, y: 0, z: -16.25 },
    { x: -26.75, y: 0, z: 8.25 },
    { x: -20.25, y: 0, z: -16.25 },
    { x: -15.25, y: 0, z: 8.25 },
    { x: -8.25, y: 0, z: -20.25 },
    { x: -3.25, y: 0, z: -20.25 },
    { x: 9.75, y: 0, z: -20.25 },
    { x: 19.75, y: 0, z: -16.75 },
    { x: 34.75, y: 0.3, z: -15.25 },
    { x: 44.75, y: 0, z: -5.25 },
    { x: 45.75, y: 0, z: 2.75 },
    { x: 41.75, y: 0, z: 6.25 },
    { x: 29.75, y: 0, z: 6.25 },
    { x: 17.75, y: 0, z: 6.25 },
    { x: -0.25, y: 0, z: 16.75 },
  ],
};
