/**
 * Radar minimap rules (pure, unit-tested): how a Spy Plane's sweeps turn into blips, and where a
 * blip beyond the minimap's square is drawn.
 */

/** Seconds between Spy Plane sweeps. */
export const SWEEP_SEC = 1;
/** A blip lasts this long after its sweep: past the next one, so blips never blink out between sweeps. */
export const PING_SEC = SWEEP_SEC * 1.25;
/** A fresh blip pulses larger for this long (the sweep reads as a beat). */
export const PULSE_SEC = 0.15;

export interface Ping {
  x: number;
  z: number;
  t: number;
}

/**
 * The Spy Plane's blips at `now`. When a sweep is due (the first one as soon as the plane is up),
 * every enemy on the radar is pinned where they stand and the last sweep's blips go; between
 * sweeps they hold, and once the plane is gone they run out.
 */
export function sweepPings(pings: readonly Ping[], lastSweep: number, now: number, up: boolean, enemies: Iterable<{ x: number; z: number }>): { pings: Ping[]; lastSweep: number } {
  if (up && now - lastSweep >= SWEEP_SEC) {
    const fresh: Ping[] = [];
    for (const e of enemies) fresh.push({ x: e.x, z: e.z, t: now });
    return { pings: fresh, lastSweep: now };
  }
  return { pings: pings.filter((p) => now - p.t < PING_SEC), lastSweep };
}

/**
 * A point (from the radar's centre) beyond the square of half-size `half` is pulled back on to its
 * edge, towards the centre: an enemy past the minimap still shows which way they are. `out` says
 * it was pulled in.
 */
export function clampToRadar(dx: number, dy: number, half: number): { x: number; y: number; out: boolean } {
  const far = Math.max(Math.abs(dx), Math.abs(dy));
  if (far <= half) return { x: dx, y: dy, out: false };
  const k = half / far;
  return { x: dx * k, y: dy * k, out: true };
}
