/**
 * Perks (owner: perks-streaks feature). BO1 three tiers, each with a Pro version unlocked by a
 * challenge (`PERK_PRO_CHALLENGES`, folded into CHALLENGES by the progression feature).
 *
 * The numbers every side agrees on live in `PERK_TUNING` so the server rules, the client HUD and
 * tests read the same values.
 */
import type { ChallengeDef } from './challenges';
import { indexById } from './registry';

export interface PerkDef {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  description: string;
  /** Pro version: what it adds and the challenge that unlocks it. */
  pro: { description: string; challenge: string };
  unlockLevel: number;
  /** HUD/menu icon id. */
  icon?: string;
  price?: number;
}

export const PERKS: PerkDef[] = [
  // Tier 1
  { id: 'lightweight', name: 'Lightweight', tier: 1, description: 'Move faster.', pro: { description: 'No falling damage.', challenge: 'lightweight_pro' }, unlockLevel: 1, icon: 'perk_lightweight', price: 2000 },
  { id: 'flak_jacket', name: 'Flak Jacket', tier: 1, description: 'Reduced explosive damage.', pro: { description: "Shockproof: explosions don't shake, stun or knock you back; immune to fire; concussions halved.", challenge: 'flak_jacket_pro' }, unlockLevel: 1, icon: 'perk_flak', price: 2000 },
  { id: 'scavenger', name: 'Scavenger', tier: 1, description: 'Pick up ammo from fallen enemies.', pro: { description: 'Start with extra mags. Resupply lethal and tactical grenades.', challenge: 'scavenger_pro' }, unlockLevel: 4, icon: 'perk_scavenger', price: 2000 },
  { id: 'ghost', name: 'Ghost', tier: 1, description: 'Undetectable by the Spy Plane and Blackbird.', pro: { description: 'Not targeted by air support or sentry guns. No red name when targeted.', challenge: 'ghost_pro' }, unlockLevel: 6, icon: 'perk_ghost', price: 2000 },
  { id: 'hardline', name: 'Hardline', tier: 1, description: 'Killstreaks require 1 less kill.', pro: { description: 'Change the contents of a Care Package by pressing USE.', challenge: 'hardline_pro' }, unlockLevel: 1, icon: 'perk_hardline', price: 2000 },
  // Tier 2
  { id: 'hardened', name: 'Hardened', tier: 2, description: 'Bullets penetrate deeper.', pro: { description: 'More damage to killstreaks. Reduced flinch when shot.', challenge: 'hardened_pro' }, unlockLevel: 1, icon: 'perk_hardened', price: 2000 },
  { id: 'scout', name: 'Scout', tier: 2, description: 'Hold breath longer when scoped.', pro: { description: 'Switch weapons faster.', challenge: 'scout_pro' }, unlockLevel: 9, icon: 'perk_scout', price: 2000 },
  { id: 'steady_aim', name: 'Steady Aim', tier: 2, description: 'Increased hip fire accuracy.', pro: { description: 'Faster recovery from sprinting. Faster knifing.', challenge: 'steady_aim_pro' }, unlockLevel: 1, icon: 'perk_steady', price: 2000 },
  { id: 'sleight_of_hand', name: 'Sleight of Hand', tier: 2, description: 'Faster reloading.', pro: { description: 'Faster aiming down sights.', challenge: 'sleight_of_hand_pro' }, unlockLevel: 1, icon: 'perk_sleight', price: 2000 },
  { id: 'warlord', name: 'Warlord', tier: 2, description: 'Two attachments on your primary weapon.', pro: { description: 'One extra lethal and one extra tactical grenade.', challenge: 'warlord_pro' }, unlockLevel: 12, icon: 'perk_warlord', price: 2000 },
  { id: 'pack_rat', name: 'Pack Rat', tier: 2, description: 'Pick up guns with a tap, switch weapons faster, and picked-up guns wear your camo.', pro: { description: 'Picked-up guns come with a full magazine and full ammo.', challenge: 'pack_rat_pro' }, unlockLevel: 10, icon: 'perk_packrat', price: 2000 },
  // Tier 3
  { id: 'tactical_mask', name: 'Tactical Mask', tier: 3, description: 'Reduced effect of flashbangs, concussions and Nova Gas.', pro: { description: 'Enemies hit by your flash or concussion show on your minimap.', challenge: 'tactical_mask_pro' }, unlockLevel: 1, icon: 'perk_mask', price: 2000 },
  { id: 'marathon', name: 'Marathon', tier: 3, description: 'Sprint for twice as long.', pro: { description: 'Unlimited sprint. Mantle faster.', challenge: 'marathon_pro' }, unlockLevel: 1, icon: 'perk_marathon', price: 2000 },
  { id: 'ninja', name: 'Ninja', tier: 3, description: 'Silent footsteps.', pro: { description: 'Enemy footsteps are louder to you.', challenge: 'ninja_pro' }, unlockLevel: 15, icon: 'perk_ninja', price: 2000 },
  { id: 'second_chance', name: 'Second Chance', tier: 3, description: 'Pull out your pistol before dying.', pro: { description: 'Last stand lasts longer and teammates can revive you.', challenge: 'second_chance_pro' }, unlockLevel: 18, icon: 'perk_second', price: 2000 },
  { id: 'hacker', name: 'Hacker', tier: 3, description: 'Detect enemy equipment and killstreak hardware.', pro: { description: 'Hack enemy sentries, SAMs and Care Packages (booby trap).', challenge: 'hacker_pro' }, unlockLevel: 21, icon: 'perk_hacker', price: 2000 },
  { id: 'tracker', name: 'Tracker', tier: 3, description: 'See the glowing footprints of nearby enemies for a few seconds.', pro: { description: 'Also see the footprints of enemies near your teammates.', challenge: 'tracker_pro' }, unlockLevel: 24, icon: 'perk_tracker', price: 2000 },
];

export const PERK_BY_ID = indexById(PERKS);

export const perksOfTier = (tier: 1 | 2 | 3) => PERKS.filter((p) => p.tier === tier);

/** Numbers the perk rules use (server) and the HUD shows (client). */
export const PERK_TUNING = {
  lightweightSpeed: 1.07,
  /** Damage taken from `explosive` means with Flak Jacket. */
  flakExplosive: 0.65,
  /**
   * Flak Jacket Pro, "Shockproof": explosions don't rattle you. Blast screen shake and ringing ears
   * x0, explosive flinch x0, knockback (Thundergun) x0, concussion x0.5, Winter's Howl frost x0.5.
   * Fire damage x0 (BO1's Pro).
   */
  shockproofShake: 0,
  shockproofFlinch: 0,
  shockproofKnockback: 0,
  shockproofConcussion: 0.5,
  shockproofFrost: 0.5,
  /** Scavenger packs: seconds on the ground, pickup radius (m), mags of reserve refilled per weapon. */
  scavengerPackLife: 20,
  scavengerRadius: 1.4,
  scavengerMags: 1,
  /** Scavenger Pro: extra mags of reserve at spawn. */
  scavengerProMags: 2,
  /** Hardened: bullet penetration depth (BO1 `perk_bulletPenetrationMultiplier`; shared/penetration.ts). */
  hardenedPenetration: 2,
  /** Hardened Pro: bullet damage to killstreak hardware, and flinch. */
  hardenedProStreakDamage: 1.5,
  hardenedProFlinch: 0.5,
  scoutHoldBreath: 2,
  scoutProSwap: 0.5,
  steadyAimHipSpread: 0.65,
  steadyAimProSprintOut: 0.5,
  steadyAimProMelee: 0.7,
  sleightReload: 0.5,
  sleightProAds: 0.5,
  /** Warlord: primary attachment slots in total (base 1). Shared by create-a-class and the spawn trim. */
  warlordAttachments: 2,
  /** Tactical Mask: flash/concussion strength on you (their duration scales with it). */
  maskStun: 0.35,
  /** Sprint stamina in seconds (everyone), Marathon multiplier, regain per second, seconds needed to restart. */
  sprintSec: 5,
  marathonMult: 2,
  sprintRegen: 1,
  sprintRestart: 1.2,
  /** Ninja Pro: enemy footstep volume for the listener. */
  ninjaProFootsteps: 1.8,
  /** Second Chance: seconds in last stand (Pro), health while down, move speed, revive time (Pro). */
  lastStandSec: 10,
  lastStandProSec: 15,
  lastStandHealth: 30,
  lastStandSpeed: 0.3,
  reviveSec: 2,
  reviveRadius: 1.8,
  /** Hacker Pro: seconds holding USE next to enemy hardware to hack it. */
  hackSec: 2,
  hackRadius: 2.2,
} as const;

/**
 * The Pro unlock challenge for each perk (ChallengeDef shape; the progression feature folds these
 * into CHALLENGES). Metrics are `perks.<what>` strings the perks feature counts itself, writing
 * `profile.challengeProgress[<challenge id>]`; a perk is Pro once that reaches `goal`.
 */
export const PERK_PRO_CHALLENGES: ChallengeDef[] = [
  { id: 'lightweight_pro', name: 'Lightweight Pro', description: 'Kill 50 enemies within 3 seconds of sprinting with Lightweight.', metric: 'perks.lightweight_sprint_kills', goal: 50, xp: 2500, codPoints: 0 },
  { id: 'flak_jacket_pro', name: 'Flak Jacket Pro', description: 'Survive 25 explosions with Flak Jacket.', metric: 'perks.flak_survived', goal: 25, xp: 2500 },
  { id: 'scavenger_pro', name: 'Scavenger Pro', description: 'Resupply 50 times from Scavenger packs.', metric: 'perks.scavenger_pickups', goal: 50, xp: 2500 },
  { id: 'ghost_pro', name: 'Ghost Pro', description: 'Kill 30 enemies while an enemy Spy Plane or Blackbird is up, with Ghost.', metric: 'perks.ghost_kills', goal: 30, xp: 2500 },
  { id: 'hardline_pro', name: 'Hardline Pro', description: 'Earn 30 killstreaks with Hardline.', metric: 'perks.hardline_streaks', goal: 30, xp: 2500 },
  { id: 'hardened_pro', name: 'Hardened Pro', description: 'Get 10 kills through walls with Hardened.', metric: 'perks.hardened_pen_kills', goal: 10, xp: 2500 },
  { id: 'scout_pro', name: 'Scout Pro', description: 'Get 30 headshot kills with Scout.', metric: 'perks.scout_headshots', goal: 30, xp: 2500 },
  { id: 'steady_aim_pro', name: 'Steady Aim Pro', description: 'Get 75 hip fire kills with Steady Aim.', metric: 'perks.steady_hip_kills', goal: 75, xp: 2500 },
  { id: 'sleight_of_hand_pro', name: 'Sleight of Hand Pro', description: 'Kill 50 enemies within 5 seconds of reloading, with Sleight of Hand.', metric: 'perks.sleight_reload_kills', goal: 50, xp: 2500 },
  { id: 'warlord_pro', name: 'Warlord Pro', description: 'Get 50 kills with a two-attachment primary, with Warlord.', metric: 'perks.warlord_kills', goal: 50, xp: 2500 },
  { id: 'tactical_mask_pro', name: 'Tactical Mask Pro', description: 'Get 100 kills with Tactical Mask.', metric: 'perks.mask_kills', goal: 100, xp: 2500 },
  { id: 'marathon_pro', name: 'Marathon Pro', description: 'Sprint 20 km with Marathon.', metric: 'perks.marathon_sprint_m', goal: 20000, xp: 2500 },
  { id: 'ninja_pro', name: 'Ninja Pro', description: 'Kill 50 enemies from behind with Ninja.', metric: 'perks.ninja_back_kills', goal: 50, xp: 2500 },
  { id: 'second_chance_pro', name: 'Second Chance Pro', description: 'Kill 10 enemies while in last stand.', metric: 'perks.last_stand_kills', goal: 10, xp: 2500 },
  { id: 'pack_rat_pro', name: 'Pack Rat Pro', description: 'Get 25 kills with guns picked up off the ground, with Pack Rat.', metric: 'perks.packrat_pickup_kills', goal: 25, xp: 2500 },
  { id: 'tracker_pro', name: 'Tracker Pro', description: 'Kill 30 enemies whose footprints you were following, with Tracker.', metric: 'perks.tracker_kills', goal: 30, xp: 2500 },
  { id: 'hacker_pro', name: 'Hacker Pro', description: 'Destroy 15 enemy killstreaks or pieces of equipment with Hacker.', metric: 'perks.hacker_destroyed', goal: 15, xp: 2500 },
];

export const PERK_PRO_CHALLENGE_BY_ID = indexById(PERK_PRO_CHALLENGES);

/** The Pro challenge for a perk id. */
export const proChallengeFor = (perkId: string) => PERK_PRO_CHALLENGE_BY_ID.get(PERK_BY_ID.get(perkId)?.pro.challenge ?? '');
