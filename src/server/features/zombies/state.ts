/**
 * Per-player Zombies state (`player.ext.zombies`) and the room events the mode emits.
 */
import type { PerkColaId, ZombieGait } from '../../../shared/defs/zombies';
import type { PlayerState, WeaponState } from '../../player';

/** A survivor (human or ally bot). */
export interface SurvivorExt {
  kind: 'survivor';
  /** Points to spend (BO1 `score`) and everything earned this game (`score_total`, starting 500 included). */
  points: number;
  total: number;
  perks: PerkColaId[];
  kills: number;
  headshots: number;
  downs: number;
  revives: number;
  /** Bled out this round: respawns at the next round start. */
  dead: boolean;
  /** Solo Quick Revive self-revive at this room time (null when not pending). */
  selfReviveAt: number | null;
  /** Weapons held when they went down (restored on revive); the pistol in hand while down. */
  downedWeapons: WeaponState[] | null;
  /** Drinking a perk: weapon lowered until this room time, and the perk it gives then. */
  drinkingUntil: number;
  pendingPerk: PerkColaId | null;
  /** USE hold progress on the current buyable and which one (entity id). */
  useHold: number;
  useTarget: number;
  /** USE must be released before the next purchase (BO1: one buy per press). */
  useLatched: boolean;
  /** Points from rebuilding boards this round (capped). */
  boardPoints: number;
}

/** A zombie or hellhound body. */
export interface UndeadExt {
  kind: 'zombie' | 'dog';
  gait: ZombieGait;
  /** Room time it spawned (failsafe) and when it last got closer to a target. */
  spawnedAt: number;
  progressAt: number;
  bestDist: number;
  /** Killed by a Nuke: no points, no drop. */
  nuked: boolean;
  /** Last hit (for the kill bonus). */
  lastPart: 'head' | 'torso' | 'legs' | null;
}

export type ZombiesExt = SurvivorExt | UndeadExt;

declare module '../../player' {
  interface PlayerExt {
    zombies?: ZombiesExt;
  }
}

declare module '../../../shared/events' {
  interface RoomEvents<P> {
    /** A round began (dog round flagged). */
    'zombies.roundStart': { round: number; dogs: boolean; count: number };
    /** A round's last zombie died. */
    'zombies.roundEnd': { round: number };
    /** A survivor bought something (`what`: wall weapon id, `ammo:<id>`, `perk:<id>`, `box`). */
    'zombies.bought': { player: P; what: string; cost: number };
    /** A power-up was grabbed. */
    'zombies.powerup': { player: P; id: string };
    /** Everyone is down: the game is over after `round` rounds. */
    'zombies.gameOver': { round: number };
  }
}

export const survivorOf = (p: PlayerState): SurvivorExt | null => (p.ext.zombies?.kind === 'survivor' ? p.ext.zombies : null);
export const undeadOf = (p: PlayerState): UndeadExt | null => (p.ext.zombies && p.ext.zombies.kind !== 'survivor' ? p.ext.zombies : null);
export const isUndead = (p: PlayerState): boolean => !!undeadOf(p);

export function newSurvivor(startPoints: number): SurvivorExt {
  return { kind: 'survivor', points: startPoints, total: startPoints, perks: [], kills: 0, headshots: 0, downs: 0, revives: 0, dead: false, selfReviveAt: null, downedWeapons: null, drinkingUntil: 0, pendingPerk: null, useHold: 0, useTarget: -1, useLatched: false, boardPoints: 0 };
}
