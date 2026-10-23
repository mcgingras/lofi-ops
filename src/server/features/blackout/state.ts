/** Per-player Blackout state (`player.ext.blackout`). */
import type { DropStage } from '../../../shared/defs/blackout';
import type { PlayerState } from '../../player';

export interface BlackoutExt {
  stage: DropStage;
  /** Armour points left and the vest's capacity (level x perLevel). */
  armor: number;
  armorMax: number;
  bandages: number;
  medkits: number;
  /** Healing: room time it ends, HP per second, null = not healing. */
  healUntil: number | null;
  healRate: number;
  /** Finishing place once out (or 1 for the winner). */
  place: number | null;
  /** Room time they left the plane / landed. */
  jumpedAt: number | null;
  landedAt: number | null;
  /** Who killed them (spectating starts there). */
  killer: string | null;
  /** The player they are watching after death. */
  watching: string | null;
  /** Bots: when to leave the plane (room time) and where they want to land. */
  jumpAt: number | null;
  dropTo: { x: number; z: number } | null;
}

declare module '../../player' {
  interface PlayerExt {
    blackout?: BlackoutExt;
  }
}

export const freshExt = (): BlackoutExt => ({ stage: 'ground', armor: 0, armorMax: 0, bandages: 0, medkits: 0, healUntil: null, healRate: 0, place: null, jumpedAt: null, landedAt: null, killer: null, watching: null, jumpAt: null, dropTo: null });

export const bx = (p: PlayerState): BlackoutExt => (p.ext.blackout ??= freshExt());
