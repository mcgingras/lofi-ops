/**
 * Wire types of the progression feature (RPCs and server pushes), merged into the core protocol
 * maps so both sides are typed. Lives in shared so the client program sees the augmentation.
 */
import type { Loadout } from '../loadout';
import type { Profile } from '../profile';
import type { MatchXpSummary } from './progression';
import type { LoadoutViolation, UnlockEntry } from './unlocks';

declare module '../protocol' {
  interface RpcMap {
    /** Enter the next prestige (level 50 only, not during a live match). Returns the new profile. */
    'progression.prestige': { req: Record<string, never>; res: Profile };
    /** Pick the prestige emblem to display (null = none). */
    'progression.setEmblem': { req: { emblem: string | null }; res: { emblem: string | null } };
    /** Check a class against the caller's unlocks (create-a-class): the gated class and why. */
    'progression.checkLoadout': { req: { loadout: Loadout }; res: { loadout: Loadout; violations: LoadoutViolation[] } };
    /** The caller's last match XP summary (null before the first match). */
    'progression.lastMatch': { req: Record<string, never>; res: MatchXpSummary | null };
  }
  interface FeatureMessages {
    /** XP just earned (batched per tick): the gains plus the new totals. */
    'progression.xp': { gains: [label: string, xp: number][]; xp: number; level: number; prestige: number };
    /** Promoted to `level`, with what it unlocked. */
    'progression.levelUp': { level: number; prestige: number; rank: string; unlocks: UnlockEntry[] };
    /** Items unlocked outside level-ups (attachments by weapon kills, Pro perks by challenges). */
    'progression.unlocked': { items: UnlockEntry[] };
    /** A challenge tier completed. `name` includes the tier numeral. */
    'progression.challenge': { id: string; name: string; tier: number; tiers: number; xp: number; codPoints: number };
    /** End of match: this player's XP breakdown and challenge progress. */
    'progression.summary': MatchXpSummary;
    /** Locked items were removed from the class you spawned with. */
    'progression.locked': { violations: LoadoutViolation[] };
  }
}

export {};
