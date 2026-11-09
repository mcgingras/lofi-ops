/**
 * Where a match's local clock (`Match.time`) starts.
 *
 * Features stamp that clock into state that outlives the match (a marker's throw, a knife
 * cooldown, the radar's last sweep). Every match used to start at 0, so a stamp from the last match
 * sat in this one's future until its clock caught up: the gun stayed hidden after a marker throw,
 * a Spy Plane showed no blips. The clock now never goes back: each match starts past anything the
 * last one stamped.
 */

/** Seconds a new match starts past the last one's clock (covers "busy until" stamps a little ahead of it). */
const GAP = 10;
let next = 0;

/** The time a new match's clock starts at. */
export const matchClockStart = (): number => next;

/** Note the running match's clock, so the next match starts after it. */
export function matchClockTick(time: number): void {
  next = Math.max(next, time + GAP);
}
