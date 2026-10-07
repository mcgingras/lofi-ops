/**
 * Type extensions of the modes feature: per-player objective tallies (`player.ext.modes`) and
 * the room events it adds. Rules also emit the core `objective` event for every action
 * (`kind` = a ModeEventKind such as 'dom.capture', 'sd.plant', 'kc.confirm').
 */
import type { Team } from '../../../shared/constants';
import type { SdRoundReason } from '../../../shared/defs/modestate';

export interface ModePlayerExt {
  /** Objective counters: captures, defends, plants, defuses, confirms, denies, destroys... */
  stats: Record<string, number>;
  /** Player score this match by reason ('kill', 'capture', 'plant'...). */
  xp: Record<string, number>;
}

declare module '../../player' {
  interface PlayerExt {
    modes?: ModePlayerExt;
  }
}

declare module '../../../shared/events' {
  interface RoomEvents<P> {
    /** S&D: a round's prep began (players respawned, bomb handed out). */
    'modes.roundStart': { round: number; attackers: Team; carrier: P | null };
    /** S&D: a round was decided. */
    'modes.roundEnd': { round: number; winner: Team; reason: SdRoundReason };
  }
}

export {};
