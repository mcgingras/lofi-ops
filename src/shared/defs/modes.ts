/**
 * Game modes (owner: modes feature; wager modes come from economy.ts, owner: economy).
 * Rules live on the server in src/server/features/modes/<id>.ts, registered by id from the modes
 * feature's setup (tdm/ffa are also registered by core in src/server/modes as a fallback).
 *
 * `MODE_TUNING` holds every number the objective rules use (capture times, bomb timer, XP...) so
 * the client HUD can show the same progress bars and timers, and so they are tunable in one place.
 */
import { WAGER_MODES } from './economy';
import { INFECTED_TEAM_NAMES } from './infected';
import { ZOMBIES_TEAM_NAMES, ZOMBIES_XP } from './zombies';
import { indexById } from './registry';

export interface ModeDef {
  id: string;
  name: string;
  /** Short HUD label. */
  short: string;
  description: string;
  teams: boolean;
  /** Team score (team modes) or player score (FFA-style) that ends the match. 0 = none. */
  scoreLimit: number;
  /** 0 = no time limit. */
  timeLimitSec: number;
  respawn: boolean;
  /** Wager matches: ante in CoD Points and payouts for 1st/2nd/3rd (economy feature). */
  wager?: { ante: number; payouts: number[] };
  /** Which playlist menu it shows under. */
  playlist: 'core' | 'objective' | 'wager' | 'hardcore' | 'party';
  /** Max players per match (bots included). */
  maxPlayers: number;
  /** Rounds-based modes (S&D): rounds to win. */
  rounds?: number;
  /** MapData.objectives key the mode needs ('dom', 'sd', 'hq'); maps without one get derived points. */
  objectives?: string;
  /**
   * The rules decide who is on which team (Infected: Survivors / Infected by role), so lobby and
   * bot team balancing must leave teams alone.
   */
  teamsByRules?: boolean;
  /** Team names for HUD and summary (default: the factions in TEAM_NAMES). */
  teamNames?: readonly [string, string];
  /**
   * Flat XP per kill / headshot instead of the usual kill XP (progression): no medals, streak
   * bonuses or weapon/attachment progress either (Zombies: hordes of AI enemies).
   */
  killXp?: { kill: number; headshot: number };
}

export const CORE_MODES: ModeDef[] = [
  { id: 'tdm', name: 'Team Deathmatch', short: 'TDM', description: 'Two teams. First to the kill limit wins.', teams: true, scoreLimit: 75, timeLimitSec: 600, respawn: true, playlist: 'core', maxPlayers: 12 },
  { id: 'ffa', name: 'Free-for-All', short: 'FFA', description: 'Everyone for themselves. First to 30 kills.', teams: false, scoreLimit: 30, timeLimitSec: 600, respawn: true, playlist: 'core', maxPlayers: 8 },
  { id: 'dom', name: 'Domination', short: 'DOM', description: 'Capture and hold flags A, B and C. Held flags score every 5 seconds.', teams: true, scoreLimit: 200, timeLimitSec: 600, respawn: true, playlist: 'objective', maxPlayers: 12, objectives: 'dom' },
  { id: 'sd', name: 'Search and Destroy', short: 'S&D', description: 'One life. Attackers plant the bomb, defenders stop them. First to 4 rounds; sides switch at halftime.', teams: true, scoreLimit: 4, timeLimitSec: 0, respawn: false, playlist: 'objective', maxPlayers: 10, rounds: 4, objectives: 'sd' },
  { id: 'hq', name: 'Headquarters', short: 'HQ', description: 'Capture the HQ and hold it. Defenders do not respawn while it stands.', teams: true, scoreLimit: 250, timeLimitSec: 600, respawn: true, playlist: 'objective', maxPlayers: 12, objectives: 'hq' },
  { id: 'kc', name: 'Kill Confirmed', short: 'KC', description: 'Kills drop dog tags. Grab enemy tags to score, grab your own to deny.', teams: true, scoreLimit: 65, timeLimitSec: 600, respawn: true, playlist: 'objective', maxPlayers: 12 },
  {
    id: 'infected',
    name: 'Infected',
    short: 'INF',
    description: 'One player starts Infected. Every Survivor who dies joins them. Survive until time runs out.',
    teams: true,
    scoreLimit: 0,
    timeLimitSec: 600,
    respawn: true,
    playlist: 'party',
    maxPlayers: 12,
    teamsByRules: true,
    teamNames: INFECTED_TEAM_NAMES,
  },
  {
    // Round-based co-op survival (BO1 Zombies); rules in src/server/features/zombies/.
    id: 'zombies',
    name: 'Zombies',
    short: 'ZOM',
    description: 'Survive endless rounds of the undead. Earn points, buy guns off the walls, roll the Mystery Box and drink Perk-a-Colas.',
    teams: true,
    scoreLimit: 0,
    timeLimitSec: 0,
    respawn: false,
    playlist: 'party',
    maxPlayers: 4,
    teamsByRules: true,
    teamNames: ZOMBIES_TEAM_NAMES,
    killXp: { kill: ZOMBIES_XP.kill, headshot: ZOMBIES_XP.headshot },
  },
];

export const MODES: ModeDef[] = [...CORE_MODES, ...WAGER_MODES];

export const MODE_BY_ID = indexById(MODES);

/** Objective modes the modes feature implements (ids). */
export const OBJECTIVE_MODE_IDS = ['dom', 'sd', 'hq', 'kc'] as const;

/** Team names of a mode for HUDs (Infected: Survivors / Infected), else the factions. */
export const teamNamesFor = (mode: ModeDef | undefined, fallback: readonly [string, string]): readonly [string, string] => mode?.teamNames ?? fallback;

/** Player score (XP) awarded for each action. Kills/assists use XP_SOURCES (progression). */
export const MODE_XP = {
  capture: 200,
  neutralize: 100,
  defend: 100,
  assault: 50,
  plant: 300,
  defuse: 300,
  sdRoundWin: 0,
  hqCapture: 200,
  hqDestroy: 200,
  hqDefend: 100,
  confirm: 150,
  deny: 100,
} as const;

export const MODE_TUNING = {
  /** Team modes: first spawns (within this many seconds of the start) use the team's own spawns. */
  spawn: { initialSec: 4, enemyNear: 10, sightRange: 32, candidates: 4 },
  dom: {
    /** Seconds for one player to capture a neutral flag. */
    captureSec: 10,
    /** Seconds for one player to neutralise an enemy flag (then it must be captured). */
    neutralizeSec: 5,
    /** Extra rate per additional capturer, and the cap on the multiplier. */
    crowdBonus: 0.5,
    maxRate: 2,
    /** Seconds for partial progress to fade when the flag is left alone. */
    decaySec: 8,
    /** Every `tickSec` each held flag gives its owner `pointsPerFlag`. */
    tickSec: 5,
    pointsPerFlag: 1,
    /** Vertical reach of a flag zone (m). */
    height: 2.5,
    /** A kill counts as a defend within this many radii of a flag you own. */
    defendRadii: 2.5,
  },
  sd: {
    roundsToWin: 4,
    /** Sides switch after this many rounds. */
    halftimeAfter: 3,
    prepSec: 5,
    roundSec: 150,
    bombSec: 45,
    plantSec: 5,
    defuseSec: 7.5,
    postSec: 5,
    pickupRadius: 1.5,
    defuseReach: 2,
    explosionRadius: 10,
    explosionDamage: 400,
  },
  hq: {
    /** First HQ comes online this long after the start; later ones after `relocateSec`. */
    firstSec: 5,
    relocateSec: 5,
    captureSec: 10,
    destroySec: 10,
    crowdBonus: 0.5,
    maxRate: 2,
    decaySec: 8,
    /** An unclaimed HQ moves after this long; a held one is retired after `holdSec`. */
    idleSec: 60,
    holdSec: 60,
    /** Owners score this many points every second while holding. */
    pointsPerSec: 1,
    height: 2.5,
    /** Dead defenders come back this long after the HQ falls or expires. */
    releaseRespawnSec: 1.5,
    respawnSec: 3,
    defendRadii: 2.5,
  },
  kc: {
    pickupRadius: 1.3,
    /** Tags vanish after this long; at most `maxTags` lie around (oldest go first). */
    tagLifeSec: 60,
    maxTags: 40,
  },
} as const;
