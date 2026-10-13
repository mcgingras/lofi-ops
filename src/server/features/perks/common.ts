/**
 * Perks: per-player state, Pro checks, the extra modifier keys other areas read, and the perks
 * events (owner: perks-streaks).
 *
 * Extra modifier keys (read them with `room.modifiers.mul/sum/any`, default = no perk):
 *   attachmentSlots      (p) => number     mul   primary attachment slots (Warlord: 2; base 1). Weapons reads it.
 *   lethalCountOffset    (p) => number     sum   extra lethals (Warlord Pro: +1). Weapons reads it.
 *   tacticalCountOffset  (p) => number     sum   extra tacticals (Warlord Pro: +1).
 *   penetrationMultiplier(p) => number     mul   bullet penetration (Hardened: 2).
 *   flinchMultiplier     (p) => number     mul   view flinch when shot (Hardened Pro: 0.5).
 *   holdBreathMultiplier (p) => number     mul   scoped hold-breath time (Scout: 2).
 *   meleeSpeedMultiplier (p) => number     mul   knife time (Steady Aim Pro: 0.7).
 *   stunDurationMultiplier(p) => number    mul   flash/concussion/gas duration (Tactical Mask: 0.35).
 *   grenadeFuseReset     (p) => boolean    any   thrown-back grenades get a fresh fuse (Flak Jacket Pro).
 *   silentFootsteps      (p) => boolean    any   no footstep sounds (Ninja). Bots' hearing should read it.
 *   hearingMultiplier    (p) => number     mul   how far this player hears footsteps (Ninja Pro: 1.8).
 *   streakTargetable     (target, kind) => boolean   any   false = killstreak AI of `kind` ignores target (Ghost Pro).
 *   killstreakDamageDealt(attacker, kind) => number   mul   bullet damage to killstreak hardware (Hardened Pro: 1.5).
 */
import type { Team } from '../../../shared/constants';
import { PERK_BY_ID, PERK_PRO_CHALLENGES, proChallengeFor } from '../../../shared/defs/perks';
import type { Profile } from '../../../shared/profile';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';

export interface LastStand {
  until: number;
  attacker: PlayerState | null;
  weapon: string;
  means: string;
  reviveBy: string | null;
  revive: number;
  /** Weapon slot in hand when they went down: a revive puts it back (BO1 `previousPrimary`). */
  prevSlot: number;
}

export interface PerksExt {
  /** Sprint stamina left (seconds) and whether the player ran dry (must regain `sprintRestart`). */
  sprintLeft: number;
  exhausted: boolean;
  lastSprintAt: number;
  lastReloadAt: number;
  /** Metres sprinted with Marathon not yet written to the profile. */
  marathonM: number;
  lastStand: LastStand | null;
  /** Last tactical that hit this player (Tactical Mask Pro reveals them to the thrower). */
  stunnedBy: string | null;
  stunnedUntil: number;
  /** Set by the bots feature (or tests) to give a player every Pro perk regardless of challenges. */
  allPro?: boolean;
}

declare module '../../player' {
  interface PlayerExt {
    perks?: PerksExt;
  }
}

declare module '../../modifiers' {
  interface ModifierMap {
    attachmentSlots: (p: PlayerState) => number | undefined;
    lethalCountOffset: (p: PlayerState) => number | undefined;
    tacticalCountOffset: (p: PlayerState) => number | undefined;
    penetrationMultiplier: (p: PlayerState) => number | undefined;
    flinchMultiplier: (p: PlayerState) => number | undefined;
    holdBreathMultiplier: (p: PlayerState) => number | undefined;
    meleeSpeedMultiplier: (p: PlayerState) => number | undefined;
    stunDurationMultiplier: (p: PlayerState) => number | undefined;
    grenadeFuseReset: (p: PlayerState) => boolean | undefined;
    silentFootsteps: (p: PlayerState) => boolean | undefined;
    hearingMultiplier: (p: PlayerState) => number | undefined;
    streakTargetable: (target: PlayerState, kind: string) => boolean | undefined;
    killstreakDamageDealt: (attacker: PlayerState, kind: string) => number | undefined;
  }
}

declare module '../../../shared/events' {
  interface RoomEvents<P> {
    /** Emit from tactical grenades (weapons area): `victim` was flashed/stunned/gassed by `attacker`. */
    'perks.stunned': { victim: P; attacker: P | null; kind: 'flash' | 'concussion' | 'gas' | (string & {}); duration: number };
    /** A Scavenger pack was picked up: refill this many lethals/tacticals (Scavenger Pro). Weapons listens. */
    'perks.resupply': { player: P; lethal: number; tactical: number };
    /** Second Chance: `player` went down into last stand. */
    'perks.lastStand': { player: P; attacker: P | null };
    'perks.revived': { player: P; by: P };
    /** A Pro challenge advanced (progression may show it). */
    'perks.progress': { player: P; challenge: string; metric: string; amount: number; total: number };
  }
}

export const perksOf = (p: PlayerState): PerksExt =>
  (p.ext.perks ??= { sprintLeft: 5, exhausted: false, lastSprintAt: -999, lastReloadAt: -999, marathonM: 0, lastStand: null, stunnedBy: null, stunnedUntil: 0 });

/** Has this perk equipped this life. */
export const hasPerk = (p: PlayerState, id: string): boolean => !!p.loadout?.perks.includes(id);

/** The profile has unlocked the Pro version (challenge complete, or unlocked outright). */
export function proUnlocked(profile: Profile | null | undefined, perkId: string): boolean {
  if (!profile) return false;
  const ch = proChallengeFor(perkId);
  if (!ch) return false;
  return profile.unlocks.includes(ch.id) || (profile.challengeProgress[ch.id] ?? 0) >= ch.goal;
}

/** Has this perk equipped and its Pro version active. */
export const isPro = (p: PlayerState, id: string): boolean => hasPerk(p, id) && (!!p.ext.perks?.allPro || proUnlocked(p.profile, id));

/** Every perk id whose Pro the profile has. */
export const proPerks = (profile: Profile | null | undefined): string[] => [...PERK_BY_ID.keys()].filter((id) => proUnlocked(profile, id));

export const inLastStand = (p: PlayerState): boolean => !!p.ext.perks?.lastStand;

/** Advance a Pro challenge for a human (writes profile.challengeProgress, emits `perks.progress`). */
export function progress(room: Room, p: PlayerState, challengeId: string, amount = 1): void {
  const prof = p.profile;
  if (!prof || p.isBot || amount <= 0 || room.phase !== 'playing') return;
  const ch = PERK_PRO_CHALLENGES.find((c) => c.id === challengeId);
  if (!ch) return;
  const before = prof.challengeProgress[ch.id] ?? 0;
  const total = before + amount;
  prof.challengeProgress[ch.id] = total;
  room.bus.emit('perks.progress', { player: p, challenge: ch.id, metric: ch.metric, amount, total });
  if (before < ch.goal && total >= ch.goal) room.sendFeature(p, 'perks.notice', { text: `${ch.name} unlocked` });
}

/** Team-or-player key for "same side" checks in FFA and team modes. */
export const sideOf = (p: PlayerState): Team | string => (p.team === null ? p.id : p.team);
