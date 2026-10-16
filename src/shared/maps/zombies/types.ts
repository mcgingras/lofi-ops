/**
 * A map's Zombies layer (owner: zombies): everything the mode places on top of the map's own data,
 * kept in one file per map (`src/shared/maps/zombies/<map id>.ts`) instead of edits scattered
 * through the map files. Positions are world metres; `y` is the floor under the item.
 *
 * `tests/zombies.layers.test.ts` checks every layer: wall-buys sit on a wall with standing room in
 * front, box spots and perk machines stand on reachable floor, zombie spawns are reachable nav
 * cells, barriers sit in openings, doors close their gaps.
 *
 * Zones (optional, for maps with doors): `start` is always open; a door lists the zones buying it
 * opens. Zombie spawns and barriers with a `zone` only work once that zone is open (BO1
 * `zone_init` / `enable_zone`). Without zones every spawn and barrier is live from round 1.
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
  /** Centre of the opening on the wall line, at the inside floor; `yaw` faces into the play area. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Opening width and height (m), from the sill up. */
  w: number;
  h: number;
  /** Sill height above `y` (default 0.9: a window). The opening itself is a players-only clip in the map. */
  sill?: number;
  /** Floor height on the outside (default `y`). */
  outY?: number;
  /** Half the wall's depth plus room to stand: inside / outside stand points this far from the wall line (default 0.75). */
  reach?: number;
  zone?: string;
}

/** A buyable door or debris pile: blocks everyone until bought (the map's brushes with `gate: 'door:<id>'`). */
export interface ZombiesDoor {
  id: string;
  cost: number;
  /** Centre of the gap at its floor; `yaw` is the way its front (the side the prompt reads from first) faces. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Gap width and height (m). */
  w: number;
  h: number;
  /** Look: a debris pile, a barricade of furniture (sofa, cabinets), or a door. */
  kind: 'debris' | 'furniture' | 'door';
  /** Zones opened when bought. */
  zones: string[];
  /** Chalk on a door (Nacht's "HELP"). */
  label?: string;
}

/** A zombie spawn. `barrier`: the window (index into `barriers`) it comes in through, outside first. */
export interface ZombiesSpawn {
  x: number;
  y: number;
  z: number;
  zone?: string;
  barrier?: number;
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
  /** Out-of-the-way places zombies climb out of (edges of the map, behind buildings, outside windows). */
  zombieSpawns: ZombiesSpawn[];
  /** Optional boarded windows (BO1 barriers: six boards; zombies tear them down and climb in). */
  barriers?: ZombiesBarrier[];
  /** Optional buyable doors / debris. */
  doors?: ZombiesDoor[];
  /** Hellhound rounds (default true; Nacht der Untoten had none). */
  dogs?: boolean;
  /** Fires burning around the map (flames and smoke drawn by the client). */
  fires?: { x: number; y: number; z: number; size?: number }[];
}
