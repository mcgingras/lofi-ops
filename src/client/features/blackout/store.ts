/**
 * Client state for Blackout: the latest `blackout.state` (alive count, circle seed, plane line,
 * your drop stage, armour, heals), your placement once out, pick-up notes, and the circle rebuilt
 * from the seed (pure shared maths, so it matches the server's).
 */
import { buildCircles, circleState, type BlackoutPlacedPayload, type BlackoutStatePayload, type Circle, type CircleState } from '../../../shared/defs/blackout';
import type { Match } from '../../game/match';
import { onFeature } from '../../registry';

export const bo = {
  state: null as BlackoutStatePayload | null,
  placed: null as BlackoutPlacedPayload | null,
  placedAt: 0,
  notes: [] as { text: string; t: number }[],
  circles: [] as Circle[],
  seed: -1,
  roomId: '',
};

export const isBlackout = (m: Match | null | undefined): m is Match => !!m && m.joined.mode === 'blackout';

onFeature('blackout.state', (d) => {
  bo.state = d;
  if (d.seed !== bo.seed) {
    bo.seed = d.seed;
    bo.circles = buildCircles(d.seed, d.start);
  }
  // A new match (stage back aboard, no place): forget the old placement.
  if (d.place === null && bo.placed) bo.placed = null;
});
onFeature('blackout.placed', (d) => {
  bo.placed = d;
  bo.placedAt = performance.now() / 1000;
});
onFeature('blackout.picked', (d) => {
  bo.notes.push({ text: d.text, t: performance.now() / 1000 });
  if (bo.notes.length > 4) bo.notes.shift();
});

/** The circle now (room time), or null before the drop. */
export function circleNow(m: Match): CircleState | null {
  const s = bo.state;
  if (!s || s.t0 < 0 || !bo.circles.length) return null;
  return circleState(bo.circles, m.serverTime - s.t0);
}

/** Forget everything when a match session ends. */
export function resetBlackout(roomId: string): void {
  if (bo.roomId === roomId) return;
  bo.roomId = roomId;
  bo.state = null;
  bo.placed = null;
  bo.notes = [];
  bo.circles = [];
  bo.seed = -1;
}
