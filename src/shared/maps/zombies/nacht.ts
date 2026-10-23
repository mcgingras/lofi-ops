/**
 * Nacht der Untoten Zombies layer (World at War, re-released in Black Ops). The layout and prices
 * are the original's (docs/maps/nacht-reference.md); the perk machines and the moving box are
 * Black Ops extras (the original had no perks, no power and one fixed box in the Help room).
 *
 * Start room (zone `start`): five boarded windows, Kar98k 200 and M1A1 Carbine 600 on the walls,
 * Quick Revive where Black Ops put Mule Kick, a box spot by the spiral stairs. The "HELP" door
 * (1000) opens the Help room (`help`): two windows and the boarded cave hole, the Thompson and the
 * double-barrel (1200 each), Juggernog, the box's first spot, and the debris on the tower stairs
 * (1000). That debris, or the sofa barricade on the spiral stairs (1000), opens the top floor
 * (`upstairs`): four windows, the sawed-off double-barrel 1200, the M1897 Trench Gun 1500, the BAR
 * 1800 and the sniper cabinet's scoped Kar98k 1500, Speed Cola, Double Tap and a box spot.
 *
 * World War II guns we don't have map to the nearest of ours: Kar98k -> L96A1 (bolt-action rifle),
 * M1A1 Carbine -> M16 (semi / burst rifle), Thompson -> AK-74u (heavy, compact SMG), double-barrel
 * and sawed-off -> Olympia (double-barrel), Trench Gun -> Stakeout (pump), BAR -> AK-47 (heavy
 * automatic rifle), scoped Kar98k -> Dragunov. The MP5K and MPL are the Black Ops lineup the other
 * Zombies layers carry. No Stielhandgranate wall-buy (grenades are topped up each round).
 *
 * Zombies spawn out in the crater field, each tied to a window it comes in through, and in the cave
 * behind the Help room. Spawns and windows of a zone only work once its door is bought.
 *
 * Coordinates: +x east, +z south; yaw 0 faces north (-z), PI/2 west, -PI/2 east, PI south.
 */
import { NACHT_FIRES } from '../nacht';
import type { ZombiesLayer } from './types';

const N = 0;
const S = Math.PI;
const E = -Math.PI / 2;
const W = Math.PI / 2;
const F2 = 3.3;

export const NACHT_ZOMBIES: ZombiesLayer = {
  map: 'nacht',
  time: 'night',
  dogs: false,
  // The start room, round the pillars.
  playerSpawns: [
    { x: 2.2, y: 0, z: 2.9, yaw: S },
    { x: 4.6, y: 0, z: 4.4, yaw: S },
    { x: 0.0, y: 0, z: 5.6, yaw: W },
    { x: 3.6, y: 0, z: 6.0, yaw: N },
  ],
  wallBuys: [
    { weapon: 'l96a1', price: 200, x: 0.0, y: 0, z: 8.6, yaw: N },
    { weapon: 'm16', price: 600, x: 6.8, y: 0, z: 6.2, yaw: N },
    { weapon: 'ak74u', price: 1200, x: -10.5, y: 0, z: -7.4, yaw: E },
    { weapon: 'olympia', price: 1200, x: -6.9, y: 0, z: -8.7, yaw: S },
    { weapon: 'mp5k', x: -5.0, y: 0, z: -7.4, yaw: W },
    { weapon: 'olympia', price: 1200, x: -4.0, y: F2, z: -0.8, yaw: S },
    { weapon: 'stakeout', price: 1500, x: -10.5, y: F2, z: -5.6, yaw: E },
    { weapon: 'ak47', price: 1800, x: -9.6, y: F2, z: 6.2, yaw: N },
    { weapon: 'dragunov', price: 1500, x: -7.75, y: F2, z: -3.0, yaw: E },
    { weapon: 'mpl', x: 3.4, y: F2, z: 6.2, yaw: N },
  ],
  boxSpots: [
    { x: -6.2, y: 0, z: 7.9, yaw: N },
    { x: -3.4, y: 0, z: -0.35, yaw: S },
    { x: -0.4, y: F2, z: 5.85, yaw: N },
  ],
  perks: [
    { perk: 'revive', x: 8.9, y: 0, z: 8.15, yaw: N },
    { perk: 'jugg', x: -10.05, y: 0, z: -2.6, yaw: E },
    { perk: 'doubletap', x: -5.45, y: F2, z: -8.0, yaw: W },
    { perk: 'speed', x: -3.8, y: F2, z: 5.75, yaw: N },
  ],
  barriers: [
    { x: -3.2, y: 0, z: 8.8, yaw: N, w: 1.4, h: 1.3 },
    { x: 3.6, y: 0, z: 8.8, yaw: N, w: 1.4, h: 1.3 },
    { x: 10.0, y: 0, z: 8.8, yaw: N, w: 1.4, h: 1.3 },
    { x: 12.3, y: 0, z: 1.6, yaw: W, w: 1.4, h: 1.3 },
    { x: 7.6, y: 0, z: -1.0, yaw: S, w: 1.4, h: 1.3 },
    { x: -8.8, y: 0, z: -8.9, yaw: S, w: 1.4, h: 1.3, zone: 'help' },
    { x: -4.8, y: 0, z: -4.6, yaw: W, w: 1.4, h: 1.3, zone: 'help' },
    { x: -10.7, y: 0, z: 2.6, yaw: E, w: 1.4, h: 1.8, sill: 0.35, zone: 'help' },
    { x: -10.7, y: F2, z: -7.5, yaw: E, w: 1.3, h: 1.3, zone: 'upstairs' },
    { x: -10.7, y: F2, z: -0.2, yaw: E, w: 1.3, h: 1.3, zone: 'upstairs' },
    { x: -4.8, y: F2, z: -2.05, yaw: W, w: 1.2, h: 1.3, zone: 'upstairs' },
    { x: -2.4, y: F2, z: -1.0, yaw: S, w: 1.2, h: 1.3, zone: 'upstairs' },
  ],
  doors: [
    { id: 'help', cost: 1000, x: -4.8, y: 0, z: 1.55, yaw: E, w: 2.3, h: 2.4, kind: 'door', zones: ['help'], label: 'HELP' },
    { id: 'stairs', cost: 1000, x: -0.6, y: 0, z: -0.1, yaw: S, w: 1.5, h: 2.4, kind: 'furniture', zones: ['upstairs'] },
    { id: 'tower', cost: 1000, x: -10.7, y: 0, z: 7.9, yaw: E, w: 1.4, h: 2.4, kind: 'debris', zones: ['upstairs'] },
  ],
  zombieSpawns: [
    // Start room windows: the field south, east and north.
    { x: -4.0, y: 0, z: 20.0, barrier: 0 },
    { x: -11.0, y: 0, z: 17.0, barrier: 0 },
    { x: 4.0, y: 0, z: 21.0, barrier: 1 },
    { x: 9.0, y: 0, z: 18.0, barrier: 1 },
    { x: 14.0, y: 0, z: 20.0, barrier: 2 },
    { x: 21.0, y: 0, z: 12.0, barrier: 2 },
    { x: 22.0, y: 0, z: 6.0, barrier: 3 },
    { x: 21.0, y: 0, z: -1.0, barrier: 3 },
    { x: 6.0, y: 0, z: -12.0, barrier: 4 },
    { x: 14.0, y: 0, z: -9.0, barrier: 4 },
    // Help room windows and the cave.
    { x: -14.0, y: 0, z: -17.0, zone: 'help', barrier: 5 },
    { x: -3.0, y: 0, z: -18.0, zone: 'help', barrier: 5 },
    { x: 2.0, y: 0, z: -11.0, zone: 'help', barrier: 6 },
    { x: -1.0, y: 0, z: -14.0, zone: 'help', barrier: 6 },
    { x: -12.8, y: 0, z: 1.2, zone: 'help', barrier: 7 },
    { x: -12.9, y: 0, z: 3.0, zone: 'help', barrier: 7 },
    // Upstairs: up the west mound, and up the outside stairs to the balcony.
    { x: -28.0, y: 0, z: -8.0, zone: 'upstairs', barrier: 8 },
    { x: -26.0, y: 0, z: -14.0, zone: 'upstairs', barrier: 8 },
    { x: -28.0, y: 0, z: -2.0, zone: 'upstairs', barrier: 9 },
    { x: -30.0, y: 0, z: 4.0, zone: 'upstairs', barrier: 9 },
    { x: 12.0, y: 0, z: -7.0, zone: 'upstairs', barrier: 10 },
    { x: 6.0, y: 0, z: -9.0, zone: 'upstairs', barrier: 10 },
    { x: 16.0, y: 0, z: -4.0, zone: 'upstairs', barrier: 11 },
    { x: 2.0, y: 0, z: -8.0, zone: 'upstairs', barrier: 11 },
  ],
  fires: NACHT_FIRES,
};
