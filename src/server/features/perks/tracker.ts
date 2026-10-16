/**
 * Tracker (tier 3; numbers and the wire format in shared/defs/tracker.ts): every `sampleSec` each
 * living Tracker player gets the fresh footprints of enemies within `radius` of them (Pro: or of a
 * living teammate), no line of sight needed, nearest first, at most `maxPerMsg`, quantised. Only
 * the Tracker player is sent them. An enemy leaves a print once they moved `stepM` on the ground
 * since their last one for this tracker. Ninja Pro leaves none (`trackerVisible` false).
 *
 * Tracker Pro challenge: killing an enemy whose prints you were sent in the last `proKillWindow` s.
 */
import { packTracks, TRACKER, type Footprint } from '../../../shared/defs/tracker';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { hasPerk, isPro, progress } from './common';

declare module '../../modifiers' {
  interface ModifierMap {
    /** Does `target` leave footprints `viewer`'s Tracker can see? false = hidden (Ninja Pro). Any false wins. */
    trackerVisible: (target: PlayerState, viewer: PlayerState) => boolean | undefined;
  }
}

/** Per tracker: where each enemy left their last print, and when we last sent one of theirs. */
interface TrackerState {
  last: Map<string, { x: number; z: number }>;
  sent: Map<string, number>;
}

const states = new WeakMap<PlayerState, TrackerState>();
const stateOf = (p: PlayerState): TrackerState => {
  let s = states.get(p);
  if (!s) states.set(p, (s = { last: new Map(), sent: new Map() }));
  return s;
};

/** The prints `viewer` gets this sample (mutates their per-enemy last positions). Exported for tests. */
export function sampleTracks(room: Room, viewer: PlayerState): Footprint[] {
  if (!viewer.alive || !hasPerk(viewer, 'tracker')) return [];
  const st = stateOf(viewer);
  const pro = isPro(viewer, 'tracker');
  const anchors = [viewer];
  if (pro && viewer.team !== null) for (const q of room.players.values()) if (q !== viewer && q.alive && q.team === viewer.team) anchors.push(q);
  const r2 = TRACKER.radius * TRACKER.radius;
  const found: { p: PlayerState; d: number }[] = [];
  for (const q of room.players.values()) {
    if (!q.alive || !room.isEnemy(viewer, q)) {
      st.last.delete(q.id);
      continue;
    }
    let near = Infinity;
    for (const a of anchors) near = Math.min(near, (a.move.x - q.move.x) ** 2 + (a.move.z - q.move.z) ** 2);
    if (near > r2) continue;
    if (!q.move.onGround || room.modifiers.any('trackerVisible', q, viewer) === false) continue;
    const prev = st.last.get(q.id);
    if (prev && Math.hypot(q.move.x - prev.x, q.move.z - prev.z) < TRACKER.stepM) continue;
    found.push({ p: q, d: (viewer.move.x - q.move.x) ** 2 + (viewer.move.z - q.move.z) ** 2 });
  }
  found.sort((a, b) => a.d - b.d);
  const out: Footprint[] = [];
  for (const { p: q } of found.slice(0, TRACKER.maxPerMsg)) {
    const prev = st.last.get(q.id);
    // Facing the way they walked (their velocity, else from the last print, else their view).
    const vx = q.move.vx;
    const vz = q.move.vz;
    const yaw = Math.hypot(vx, vz) > 0.3 ? Math.atan2(-vx, -vz) : prev ? Math.atan2(-(q.move.x - prev.x), -(q.move.z - prev.z)) : q.yaw;
    out.push({ x: q.move.x, y: q.move.y, z: q.move.z, yaw });
    st.last.set(q.id, { x: q.move.x, z: q.move.z });
    st.sent.set(q.id, room.time);
  }
  return out;
}

export function setupTracker(room: Room): void {
  // Ninja Pro: no footprints.
  room.modifiers.add('trackerVisible', (target) => (isPro(target, 'ninja') ? false : undefined), 'perks.ninja_pro_tracks');
  room.every(TRACKER.sampleSec, () => {
    if (room.phase !== 'playing') return;
    for (const p of room.players.values()) {
      if (!p.session || !hasPerk(p, 'tracker')) continue;
      const prints = sampleTracks(room, p);
      if (prints.length) room.sendFeature(p, 'perks.tracks', packTracks(prints));
    }
  });
  room.bus.on('spawn', ({ player }) => states.delete(player));
  room.bus.on('death', ({ victim, attacker }) => {
    if (!attacker || attacker === victim || !hasPerk(attacker, 'tracker') || !room.isEnemy(attacker, victim)) return;
    const at = states.get(attacker)?.sent.get(victim.id);
    if (at !== undefined && room.time - at <= TRACKER.proKillWindow) progress(room, attacker, 'tracker_pro');
  });
}
