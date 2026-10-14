/**
 * Carry-to-place for the Sentry Gun and the SAM Turret (owner: perks-streaks), after BO1's
 * `maps/mp/_turret_killstreak.gsc` (T5 script dump, plutoniummod/t5-scripts):
 *
 * - Calling either streak spawns the turret in your hands (`startCarryTurret`: `CarryTurret(turret,
 *   (40,0,0))`, 40 units = 1 m in front of you) with your weapon away (`_disableWeapon`). Every
 *   50 ms the engine's `canPlayerPlaceTurret` puts it on the floor in front of you and says whether
 *   it can go there; the model turns yellow when it can and red when it can't
 *   (`modelGoodPlacement` / `modelBadPlacement`; trigger_hurt, minefields and
 *   `no_turret_placement` volumes are bad too).
 * - FIRE (`attackButtonPressed`) places it where the preview shows and facing your way; the
 *   killstreak button (`actionSlotFourButtonPressed`) puts a turret that was never placed away and
 *   gives the streak back, as does dying or last stand with it in hand.
 * - The owner can pick a placed turret up again (a `trigger_radius_use` claimed by the owner,
 *   "Press USE to pick up"): it is back in their hands and its 90 s lifespan pauses while carried
 *   (`watchTurretLifespan` only counts while `!carried`). A hacked turret can't be picked up.
 *
 * This file is the placement rule both sides run: the client draws the green / red preview with it
 * every frame from its predicted feet and aim, and the server validates the spot with it when FIRE
 * or USE places the turret (and moves the carried turret others see with it every tick).
 */
import type { CollisionWorld } from '../collision';
import { viewDir, type Vec3 } from '../math';
import { roofLimit, type DropMap } from './care-marker';

export const TURRET_PLACE = {
  /** How far in front of the carrier's feet the turret goes (BO1 `CarryTurret` offset 40 units). */
  ahead: 1.1,
  /** The turret's footprint (radius) and height: that much room must be free where it stands. */
  radius: 0.38,
  height: 1.1,
  /** Floor it may stand on: at most this far above / below the carrier's feet. */
  up: 0.6,
  down: 1.0,
  /** Too steep: the floor under the footprint's edges may differ by at most this (m). */
  maxTilt: 0.2,
  /** Keep it this far inside the map bounds. */
  edge: 1,
  /** Carrier's chest height above the feet, for the "nothing between you and it" check. */
  chest: 1.1,
  /** Walking with a turret in hand (no sprint, weapon away). */
  moveScale: 0.75,
  /** Pick a placed turret back up: horizontal reach and height difference (m). */
  pickupReach: 1.4,
  pickupDy: 1.5,
} as const;

export type PlaceReason = 'ok' | 'bounds' | 'nofloor' | 'blocked' | 'solid' | 'steep' | 'roof';

export interface TurretSpot {
  x: number;
  y: number;
  z: number;
  /** Facing (game yaw): the carrier's. */
  yaw: number;
  valid: boolean;
  reason: PlaceReason;
}

/** HUD words for why a spot is no good. */
export const PLACE_REASON_TEXT: Record<PlaceReason, string> = {
  ok: '',
  bounds: 'OUT OF MAP',
  nofloor: 'NO FLOOR',
  blocked: 'BLOCKED',
  solid: 'NO ROOM',
  steep: 'TOO STEEP',
  roof: 'CAN’T REACH',
};

/**
 * Where a turret carried by someone standing at `feet` and facing `yaw` goes down, and whether it
 * can: inside the map, on a floor within a step of the feet, nothing between the carrier and it, flat
 * enough across its footprint, with room for it, and not on a roof higher than anyone can climb
 * (the Care Package's limit: the highest spawn + 4.5 m). Pure: the client preview and the server's
 * check call exactly this.
 */
export function turretPlacement(world: CollisionWorld, map: DropMap, feet: Vec3, yaw: number): TurretSpot {
  const T = TURRET_PLACE;
  const d = viewDir(yaw, 0);
  const x = feet.x + d.x * T.ahead;
  const z = feet.z + d.z * T.ahead;
  const spot = (y: number, reason: PlaceReason): TurretSpot => ({ x, y, z, yaw, valid: reason === 'ok', reason });
  const b = map.bounds;
  if (x < b.min.x + T.edge || x > b.max.x - T.edge || z < b.min.z + T.edge || z > b.max.z - T.edge) return spot(feet.y, 'bounds');
  const from = feet.y + T.up;
  const span = T.up + T.down;
  const y = world.groundBelow(x, z, from, span, 0.05);
  if (y === null) return spot(feet.y, 'nofloor');
  const chest = { x: feet.x, y: feet.y + T.chest, z: feet.z };
  if (!world.lineOfSight(chest, { x, y: y + T.height * 0.6, z }, 'players')) return spot(y, 'blocked');
  const r = T.radius * 0.9;
  let lo = y;
  let hi = y;
  for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r]] as const) {
    const g = world.groundBelow(x + ox, z + oz, y + T.maxTilt, T.maxTilt * 2, 0.02);
    if (g === null) return spot(y, 'steep');
    lo = Math.min(lo, g);
    hi = Math.max(hi, g);
  }
  if (hi - lo > T.maxTilt) return spot(y, 'steep');
  if (world.overlapping(x, y + 0.04, z, T.radius, T.height - 0.04).length) return spot(y, 'solid');
  if (y > roofLimit(map)) return spot(y, 'roof');
  return spot(y, 'ok');
}
