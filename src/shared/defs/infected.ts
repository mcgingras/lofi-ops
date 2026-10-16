/**
 * Infected (MW3 party mode, owner: modes): data shared by the server rules
 * (src/server/features/modes/infected.ts), the bots' goals and the HUD.
 *
 * Teams are fixed by role: team 0 = Survivors, team 1 = Infected. Everybody starts a Survivor;
 * `firstSec` after the start one random player becomes the First Infected. Every Survivor who dies
 * (killed by an Infected or any other way) comes back Infected. Survivors win if one of them is
 * still alive at the time limit; the Infected win when nobody is left to infect.
 */
import type { Loadout } from '../loadout';

export const INFECTED_TEAMS = { survivors: 0, infected: 1 } as const;
export const INFECTED_TEAM_NAMES: readonly [string, string] = ['Survivors', 'Infected'];

export type InfectedRole = 'survivor' | 'infected';

export const INFECTED = {
  /** Seconds after the start until the First Infected is picked (MW3: nine). */
  firstSec: 9,
  /** When every Infected has left: seconds until a new First Infected is picked. */
  repickSec: 4,
  /** Players needed before anyone is infected (one alone would be the whole match). */
  minPlayers: 2,
  /** Every living Survivor scores `survivePoints` this often (survival over time). */
  surviveEverySec: 30,
  /** MW3: each Survivor gets 50 ("Survivor") whenever another Survivor is infected. */
  survivePoints: 50,
  /**
   * Damage the First Infected takes while they are the only Infected ("body armor", like the
   * Juggernaut suit MW3's Striker-vs-Jugg First Infected wore): one player against everyone.
   */
  firstArmor: 0.5,
  /** Infected movement on top of their perks (MW3's Juiced-like boost). */
  infectedSpeed: 1.04,
  /** Survivors start with this many times the normal reserve (Scavenger Pro-like spare mags). */
  survivorReserveMul: 2,
  /** The last Survivor's radar shows every Infected; Infected see the last Survivor in sweeps. */
  sweepEverySec: 30,
  sweepSec: 3,
  /** Infected spawns: hard rules from spawns.ts, and preferably no further than this from a Survivor. */
  spawnFar: 28,
} as const;

/** Player score (XP breakdown) per action. Kills and assists use the normal values. */
export const INFECTED_XP = {
  infect: 100,
  survive: 50,
  lastAlive: 100,
  outlast: 200,
  finalStand: 500,
} as const;

const w = (weapon: string, attachments: string[] = []) => ({ weapon, attachments, camo: 'none' });

/**
 * Survivors (MW3: a shotgun and a pistol, Scavenger and friends). BO1 flavour: SPAS-12 and M1911,
 * Scavenger and Steady Aim, double reserve at spawn. No grenades or streaks.
 */
export const SURVIVOR_LOADOUT: Loadout = { name: 'Survivor', primary: w('spas12'), secondary: w('m1911'), perks: ['scavenger', 'steady_aim'], killstreaks: [], lethal: null, tactical: null };

/**
 * Infected (MW3: tactical knife and throwing knife, Extreme Conditioning, Lightweight/Marathon):
 * the knife in hand (melee lunge, one-hit kill) and one retrievable tomahawk, Lightweight and
 * Marathon plus the mode's speed boost. The primary/secondary here only satisfy the loadout shape;
 * the spawn hands the player the knife alone (`INFECTED_WEAPON`).
 */
export const INFECTED_LOADOUT: Loadout = { name: 'Infected', primary: w('spas12'), secondary: w('m1911'), perks: ['lightweight', 'marathon'], killstreaks: [], lethal: 'tomahawk', tactical: null };
export const INFECTED_WEAPON = 'knife';

/**
 * The First Infected keeps the Survivor guns (MW3: the current Survivor loadout plus the throwing
 * knife and the Infected perks) until a second player is infected, then drops to the knife.
 */
export const FIRST_INFECTED_LOADOUT: Loadout = { ...SURVIVOR_LOADOUT, name: 'First Infected', perks: ['lightweight', 'marathon'], lethal: 'tomahawk' };

/** The last Survivor's bonus weapon (replaces the pistol): an RPK with an extended magazine. */
export const LAST_SURVIVOR_WEAPON = w('rpk', ['extmag']);

/** `modes.state` payload for Infected (to each human). */
export interface InfectedStatePayload {
  /** Your role. */
  role: InfectedRole;
  /** Survivors / Infected in the room right now. */
  survivors: number;
  infected: number;
  /** Room time the First Infected will be picked (countdown), or null once picked / not yet. */
  pickAt: number | null;
  /** Waiting for a second player before anyone can be infected. */
  waiting: boolean;
  /** Player id of the current First Infected (null once a second player was infected). */
  first: string | null;
  /** Player id of the last Survivor (null unless exactly one is left). */
  last: string | null;
  /** The last Survivor is being swept onto the Infected's radar until this room time. */
  sweepUntil: number | null;
}
