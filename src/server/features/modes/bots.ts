/**
 * Objective hooks for bots (owner: modes; consumer: the bots feature). Pull-based so the bots
 * brain needs nothing registered: each think (or every few hundred ms) ask
 *
 *   import { objectivesFor, bestObjective } from '../modes/bots';
 *   const goal = bestObjective(room, self);          // null in TDM/FFA/wager modes
 *   if (goal && Math.random() < skill.objectivePlay) { navigate to goal.pos; if inside goal.radius
 *     and goal.holdUse, hold Buttons.USE (plant/defuse); if goal.stay, keep standing in the zone }
 *
 * Kinds:
 *   capture  stand in the zone until it's yours (DOM flag, neutral HQ)      stay
 *   destroy  stand in the enemy HQ zone until it's destroyed                stay
 *   defend   hang around a zone/site your team holds (patrol inside radius)
 *   pickup   walk over it (S&D dropped bomb, attackers only)
 *   plant    S&D carrier: go to the site and hold USE (plantSec)          holdUse, stay
 *   defuse   S&D defender: go to the planted bomb and hold USE (defuseSec) holdUse, stay
 *   escort   S&D attacker without the bomb: move with the carrier
 *   collect  Kill Confirmed tag: walk over it (enemy tag = confirm, own = deny)
 *
 * `priority` is 0..1 (how urgent for this player right now); `objectivesFor` is sorted by it.
 * A bots feature that exposes its own goal registry can wrap these; nothing here depends on it.
 */
import type { Vec3 } from '../../../shared/math';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { controllerOf } from './common';

export type BotObjectiveKind = 'capture' | 'destroy' | 'defend' | 'pickup' | 'plant' | 'defuse' | 'escort' | 'collect';

export interface BotObjective {
  kind: BotObjectiveKind;
  /** Objective id ('A', 'B', 'HQ', 'bomb', 'tag:12'). */
  id: string;
  pos: Vec3;
  /** Zone radius (m); for pickups the pickup radius. */
  radius: number;
  priority: number;
  /** Hold Buttons.USE while inside the radius (plant/defuse). */
  holdUse?: boolean;
  /** Stay inside the radius until it completes (captures, plants, defuses). */
  stay?: boolean;
}

/** True when the room runs an objective mode with bot hooks. */
export const hasObjectives = (room: Room): boolean => controllerOf(room) !== null;

/** Objectives for `p` (best first). Empty for modes without objectives. */
export function objectivesFor(room: Room, p: PlayerState): BotObjective[] {
  const c = controllerOf(room);
  if (!c || room.phase !== 'playing' || !p.alive) return [];
  return c.objectives(p).sort((a, b) => b.priority - a.priority);
}

/**
 * The single objective `p` should go for: highest priority, ties broken by distance (a nearby
 * objective of slightly lower priority beats a far one).
 */
export function bestObjective(room: Room, p: PlayerState): BotObjective | null {
  const list = objectivesFor(room, p);
  let best: BotObjective | null = null;
  let bestScore = -Infinity;
  for (const o of list) {
    const d = Math.hypot(o.pos.x - p.move.x, o.pos.z - p.move.z);
    const s = o.priority * 100 - d * 0.5;
    if (s > bestScore) {
      bestScore = s;
      best = o;
    }
  }
  return best;
}
