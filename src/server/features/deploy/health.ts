/**
 * GET /healthz (and the legacy alias /api/health). Fly's health check and the uptime of a
 * scaled-to-zero machine both hit it, so it is cheap: counts only, no DB access.
 */

export interface HealthReport {
  ok: boolean;
  /** Open rooms. */
  rooms: number;
  /** Connected humans (sessions past hello), in a room or in the menus. */
  players: number;
  /** Bots across all rooms. */
  bots: number;
  version: string;
  uptimeSec: number;
  /** True once a shutdown started: new joins are refused. */
  draining: boolean;
}

interface RoomLike {
  closed: boolean;
  bots(): readonly unknown[];
}

export interface HealthSource {
  rooms: ReadonlyMap<string, RoomLike>;
  sessions: number;
  version: string;
  startedAt: number;
  draining: boolean;
  now?: number;
}

export function healthReport(src: HealthSource): HealthReport {
  let rooms = 0;
  let bots = 0;
  for (const r of src.rooms.values()) {
    if (r.closed) continue;
    rooms++;
    bots += r.bots().length;
  }
  const now = src.now ?? Date.now();
  return {
    ok: !src.draining,
    rooms,
    players: src.sessions,
    bots,
    version: src.version,
    uptimeSec: Math.max(0, Math.round((now - src.startedAt) / 1000)),
    draining: src.draining,
  };
}

/** Paths that answer with the health report. */
export const HEALTH_PATHS: ReadonlySet<string> = new Set(['/healthz', '/api/health']);
