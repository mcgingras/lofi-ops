/** Per-player pickup state (`player.ext.pickups`). */
import type { PlayerState } from '../../player';

export interface PickupsExt {
  /** Seconds USE has been held on `target`. */
  hold: number;
  /** Drop entity being held on, or null. */
  target: number | null;
  /** After a swap, USE must be let go before the next one (no swapping straight back). */
  needRelease: boolean;
  /** Bots: the gun it is walking to, and how long it has "held USE" on it. */
  botTarget: number | null;
  botHold: number;
}

declare module '../../player' {
  interface PlayerExt {
    pickups?: PickupsExt;
  }
}

export const pickupsOf = (p: PlayerState): PickupsExt => (p.ext.pickups ??= { hold: 0, target: null, needRelease: false, botTarget: null, botHold: 0 });
