/** Killstreak per-player state and room events (owner: perks-streaks). */
import type { Vec3 } from '../../../shared/math';

export interface KsArmed {
  id: string;
  marks: Vec3[];
  need: number;
  until: number;
}

export interface KsControl {
  id: string;
  entity: number;
  until: number;
  /** Valkyrie: the rocket blew up; the camera holds on the blast at x,y,z until room time `until`. */
  hold?: { until: number; x: number; y: number; z: number };
}

/** The Valkyrie launcher in hand (STREAK raised it; FIRE launches a rocket). */
export interface KsLauncher {
  /** Rockets left in it (2, then 1). */
  left: number;
  /** Room time it can fire (raised, or reloaded after the first rocket). */
  ready: number;
  /** The first rocket went: the streak is used, and putting it away loses the rest. */
  fired: boolean;
  /** Bots: room time they fire (aiming). */
  aimAt: number | null;
}

/** Holding the Care Package marker canister (STREAK raised it; FIRE throws it). */
export interface KsMarker {
  id: string;
  since: number;
}

/** The tactical map is up (radio raised) for `id`. */
export interface KsMapMode {
  id: string;
  until: number;
  /** The `ks_radio` entity others see. */
  entity: number;
}

export interface KillstreakExt {
  /** Kills toward streaks this life (kills by killstreaks excluded). */
  count: number;
  /** Every kill this life, killstreak kills included (streaks with `countsStreakKills`: the Tactical Nuke). */
  countAll?: number;
  /** Streak ids already earned this life (each once per life). */
  earnedLife: string[];
  /** Earned, waiting to be called (oldest first; persists across deaths until match end). */
  ready: string[];
  selected: number;
  armed: KsArmed | null;
  control: KsControl | null;
  /** The Care Package marker canister is in hand (weapon down) until thrown or put away. */
  marker?: KsMarker | null;
  /** The Valkyrie launcher is in hand (weapon down) until both rockets are used or it is put away. */
  launcher?: KsLauncher | null;
  /** Tactical map open (humans; bots pick targets server-side). */
  map?: KsMapMode | null;
  /** Rate limit for map RPCs. */
  mapRpc?: { tokens: number; at: number };
  /** Bots: 0..1 skill for calling streaks (BotSkill.streakUse). Set by the bots feature; default from its ext or 0.6. */
  botStreakUse?: number;
  /** Bots: true = the bots brain calls streaks itself through the API (no automatic use). */
  manual?: boolean;
  /** Bots: room time the automatic policy may call the next streak. */
  botNextCall?: number;
}

declare module '../../player' {
  interface PlayerExt {
    killstreaks?: KillstreakExt;
  }
}

declare module '../../../shared/events' {
  interface RoomEvents<P> {
    /** `player` earned killstreak `id` (Hardline-aware). */
    'killstreaks.earned': { player: P; id: string };
    /** `player` called in `id`. */
    'killstreaks.called': { player: P; id: string };
    /** A killstreak finished (`destroyed` when shot down / killed, `by` who did it). */
    'killstreaks.ended': { player: P | null; id: string; destroyed: boolean; by: P | null };
    /** The Tactical Nuke called by `player` went off (everyone dies over the next seconds, then the match ends). */
    'killstreaks.nuke': { player: P; phase: 'detonated' };
    /** A Care Package marker settled: the crate comes down at x,y,z (`valid` false: moved off the canister, `reason` why). */
    'killstreaks.marker': { player: P; x: number; y: number; z: number; valid: boolean; reason: string };
    /** A piece of killstreak hardware (entity `kind`) was destroyed by `by`. */
    'killstreaks.destroyed': { owner: P | null; id: string; kind: string; by: P | null };
  }
}

export {};
