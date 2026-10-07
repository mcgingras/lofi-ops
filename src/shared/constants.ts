/**
 * Numbers both sides agree on. Pure data: no DOM, no Node APIs.
 * Units: metres, seconds, radians unless a name says otherwise (`...Ms` = milliseconds).
 */

/** Server simulation rate (Hz) and its fixed step. */
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
/** Snapshots per second sent to each client. */
export const SNAPSHOT_RATE = 20;
/** Ticks between snapshots. */
export const SNAPSHOT_EVERY = Math.round(TICK_RATE / SNAPSHOT_RATE);
/** Remote players are drawn this far in the past (client interpolation). */
export const INTERP_DELAY_MS = 100;
/** Hitscan rewinds targets at most this far back (lag compensation clamp). */
export const MAX_REWIND_MS = 250;
/** Hitbox history kept on the server (seconds). */
export const HISTORY_SEC = 1;
/** Client prediction: snap to the server position past this error, otherwise smooth. */
export const RECONCILE_SNAP_M = 0.5;
/** Longest dt a single input command may carry; longer ones are clamped. */
export const MAX_CMD_DT = 0.05;
/** Movement integrates in sub-steps no longer than this. */
export const MAX_SUBSTEP = 1 / 60;

/** Player body (movement collision box: square footprint, feet at y). */
export const PLAYER = {
  /** Half the footprint width (footprint 0.6 x 0.6). */
  radius: 0.3,
  height: 1.8,
  crouchHeight: 1.2,
  eye: 1.6,
  crouchEye: 1.0,
  stepHeight: 0.45,
} as const;

/** Movement feel (BO1-ish). Speeds in m/s. */
export const MOVE = {
  walk: 5.0,
  sprint: 7.2,
  /** Multiplier while crouched. */
  crouch: 0.55,
  /** Default multiplier while fully aimed down sights (weapons may not override this in v1). */
  ads: 0.6,
  jumpHeight: 1.1,
  gravity: 20,
  /** How fast ground velocity approaches the wish velocity (m/s^2). */
  accel: 70,
  /** Fraction of `accel` available in the air. */
  airControl: 0.3,
  /** Sprint needs forward input at least this strong (after normalising). */
  sprintMinForward: 0.5,
  /** Below this ADS fraction sprinting is still allowed. */
  sprintMaxAds: 0.05,
  /** Fall below this y and you die (out of the world). */
  killY: -40,
} as const;

export const HEALTH = {
  max: 100,
  /** Seconds without damage before regeneration starts. */
  regenDelay: 5,
  /** Health per second once regenerating. */
  regenRate: 40,
  /** Damage taken within this window gives an assist. */
  assistWindow: 10,
} as const;

/** Default respawn delay (seconds) for modes that respawn. */
export const RESPAWN_DELAY = 3;

/** Teams: 0 and 1 in team modes; `null` means no team (FFA). */
export type Team = 0 | 1;
export const TEAM_NAMES: readonly [string, string] = ['Spetsnaz', 'Black Ops'];

/** Default server port (`PORT` env overrides). The client connects to `/ws` on its own origin. */
export const DEFAULT_PORT = 8080;
export const WS_PATH = '/ws';
export const PROTOCOL_VERSION = 1;
