/**
 * Perks: per-player state, Pro checks, the extra modifier keys other areas read, and the perks
 * events (owner: perks-streaks).
 *
 * Modifier keys. Each key has ONE name, declared by the feature that reads it (a key registered
 * under any other name is silently never read; tests/modifier-keys.test.ts fails on that):
 *   weapons (src/server/features/weapons/state.ts) reads, perks registers:
 *     attachmentSlotsOffset (p, loadout) sum  extra primary slots (Warlord: +1), on the loadout being spawned
 *     equipmentCountOffset  (p, kind)    sum  extra lethals / tacticals (Warlord Pro: +1 each)
 *     tacticalMultiplier    (victim)     mul  flash/concussion strength and duration (Tactical Mask: 0.35)
 *     meleeSpeedMultiplier  (p)          mul  knife cooldown / recovery (Steady Aim Pro: 0.7)
 *     holdBreathMultiplier  (p)          mul  scoped hold-breath time (Scout: 2), sent to the client
 *     blastShakeMultiplier  (p)          mul  explosion shake / ringing ears (Flak Jacket Pro: 0), sent to the client
 *     concussionMultiplier  (victim)     mul  concussion strength and duration (Flak Jacket Pro: 0.5)
 *     knockbackMultiplier   (p)          mul  Thundergun launch / shove impulse (Flak Jacket Pro: 0)
 *     frostMultiplier       (p)          mul  Winter's Howl frost gained (Flak Jacket Pro: 0.5)
 *   declared here, read by bots / killstreaks:
 *     flinchMultiplier     (p) => number     mul   view flinch when shot (Hardened Pro: 0.5).
 *     explosiveFlinchMultiplier (p) => number mul  extra flinch factor for explosive damage (Flak Jacket Pro: 0).
 *     silentFootsteps      (p) => boolean    any   no footstep sounds (Ninja). Bots' hearing reads it.
 *     hearingMultiplier    (p) => number     mul   how far this player hears footsteps (Ninja Pro: 1.8).
 *     streakTargetable     (target, kind) => boolean   any   false = killstreak AI of `kind` ignores target (Ghost Pro).
 *     killstreakDamageDealt(attacker, kind) => number   mul   bullet damage to killstreak hardware (Hardened Pro: 1.5).
 *   declared in core (src/server/modifiers.ts), read by combat:
 *     penetrationMultiplier(p) => number     mul   bullet penetration depth (Hardened: 2; shared/penetration.ts).
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
  /**
   * Set by a mode that puts players in last stand itself (`enterLastStand`, Zombies): teammates may
   * revive without Second Chance Pro, how long a revive takes (per reviver), the score a revive
   * pays (default 50), and what happens at bleed-out (default: the downer gets the kill).
   */
  revivable?: boolean;
  reviveSecFor?: (reviver: PlayerState) => number;
  reviveScore?: number;
  onBleedOut?: () => void;
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
    flinchMultiplier: (p: PlayerState) => number | undefined;
    explosiveFlinchMultiplier: (p: PlayerState) => number | undefined;
    silentFootsteps: (p: PlayerState) => boolean | undefined;
    hearingMultiplier: (p: PlayerState) => number | undefined;
    streakTargetable: (target: PlayerState, kind: string) => boolean | undefined;
    killstreakDamageDealt: (attacker: PlayerState, kind: string) => number | undefined;
  }
}

declare module '../../../shared/events' {
  interface RoomEvents<P> {
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

/** Has this perk equipped this life. (At `beforeSpawn` this is still the previous life: read the event's loadout.) */
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
