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
}

export interface KillstreakExt {
  /** Kills toward streaks this life (kills by killstreaks excluded). */
  count: number;
  /** Streak ids already earned this life (each once per life). */
  earnedLife: string[];
  /** Earned, waiting to be called (oldest first; persists across deaths until match end). */
  ready: string[];
  selected: number;
  armed: KsArmed | null;
  control: KsControl | null;
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
    /** A piece of killstreak hardware (entity `kind`) was destroyed by `by`. */
    'killstreaks.destroyed': { owner: P | null; id: string; kind: string; by: P | null };
  }
}

export {};
