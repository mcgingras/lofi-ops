/**
 * A map's Zombies layer (owner: zombies): everything the mode places on top of the map's own data,
 * kept in one file per map (`src/shared/maps/zombies/<map id>.ts`) instead of edits scattered
 * through the map files. Positions are world metres; `y` is the floor under the item.
 *
 * `tests/zombies.layers.test.ts` checks every layer: wall-buys sit on a wall with standing room in
 * front, box spots and perk machines stand on reachable floor, zombie spawns are reachable nav
 * cells, and barriers sit in openings.
 */
import type { SpawnPoint } from '../types';
import type { PerkColaId } from '../../defs/zombies';

export interface ZombiesWallBuy {
  weapon: string;
  /** Default: WALL_PRICES[weapon]. */
  price?: number;
  /** On the wall face; `yaw` faces out of the wall (the way a player reading it looks is yaw + PI). */
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface ZombiesItemSpot {
  x: number;
  y: number;
  z: number;
  /** Facing (game yaw: 0 looks down -z): the side a player uses it from is in front. */
  yaw: number;
}

export interface ZombiesPerkSpot extends ZombiesItemSpot {
  perk: PerkColaId;
}

export interface ZombiesBarrier {
  /** Centre of the opening at the floor; `yaw` faces into the play area. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Opening width and height (m). */
  w: number;
  h: number;
}

export interface ZombiesLayer {
  map: string;
  /** Time preset id (night / dusk). */
  time: string;
  /** Where the survivors start (default: the map's FFA spawns nearest the first box spot). */
  playerSpawns?: SpawnPoint[];
  wallBuys: ZombiesWallBuy[];
  /** Mystery Box spots; the first is where it starts. */
  boxSpots: ZombiesItemSpot[];
  perks: ZombiesPerkSpot[];
  /** Out-of-the-way places zombies climb out of (edges of the map, behind buildings). */
  zombieSpawns: { x: number; y: number; z: number }[];
  /** Optional boarded windows. */
  barriers?: ZombiesBarrier[];
}
