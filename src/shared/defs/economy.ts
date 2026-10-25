/**
 * CoD Points economy (owner: economy feature): earning rules, prices, ante tiers, payouts and the
 * wager modes. Kept free of runtime imports from modes.ts (modes.ts imports WAGER_MODES from here).
 *
 * BO1 model: you earn CoD Points (CP) every match from your performance and from challenges, and
 * spend them on weapons/attachments (once your level unlocks them), camos, reticles and emblem
 * backgrounds, or stake them on wager matches. Bots never earn or cost CP.
 */
import type { ModeDef } from './modes';
import './wager-weapons';

/** CoD Points awarded at the end of a normal (non-wager) match. */
export const CP_REWARDS = {
  /** Flat amount for finishing a match (scaled by the share of the match you played). */
  matchComplete: 100,
  /** Extra for being on the winning side / winning FFA. */
  win: 100,
  /** Per point of match score (score 2500 => 250 CP at 0.1). */
  perScore: 0.1,
  /** FFA podium bonus for 1st/2nd/3rd (team modes: none). */
  podium: [75, 50, 25] as readonly number[],
  /** Best kill streak bonuses: [streak, CP] (highest that applies). */
  streak: [[5, 50], [10, 100], [15, 200]] as readonly (readonly [number, number])[],
  /** Never award less than this to someone who played (keeps the grind moving). */
  minimum: 25,
  /** Cap per match so an endless match can't print money. */
  maximum: 2000,
};

/** CoD Points a player starts with. */
export const STARTING_COD_POINTS = 1000;

/** Default prices by item kind if a def has no explicit price. */
export const DEFAULT_PRICES = { weapon: 1500, attachment: 1000, camo: 500, perk: 1500, killstreak: 1500, emblem: 250, reticle: 250 };

export interface CpLine {
  label: string;
  cp: number;
}

export interface CpInput {
  score: number;
  won: boolean;
  /** 1-based placement (FFA podium bonus when `teams` is false). */
  place?: number;
  teams?: boolean;
  bestStreak?: number;
  /** Seconds this player played and the match length (scales the completion bonus). */
  timePlayed?: number;
  durationSec?: number;
}

/** Per-line CoD Points for one finished match (non-wager). Lines with 0 CP are dropped. */
export function codPointsBreakdown(r: CpInput): { lines: CpLine[]; total: number } {
  const lines: CpLine[] = [];
  const share = r.durationSec && r.durationSec > 0 && r.timePlayed !== undefined ? Math.max(0, Math.min(1, r.timePlayed / r.durationSec)) : 1;
  lines.push({ label: 'Match complete', cp: Math.round(CP_REWARDS.matchComplete * share) });
  lines.push({ label: 'Score', cp: Math.round(Math.max(0, r.score) * CP_REWARDS.perScore) });
  if (r.won) lines.push({ label: 'Victory', cp: CP_REWARDS.win });
  if (r.teams === false && r.place !== undefined && r.place >= 1 && r.place <= CP_REWARDS.podium.length) lines.push({ label: `Top 3 (#${r.place})`, cp: CP_REWARDS.podium[r.place - 1]! });
  let streakCp = 0;
  for (const [n, cp] of CP_REWARDS.streak) if ((r.bestStreak ?? 0) >= n) streakCp = cp;
  if (streakCp) lines.push({ label: `${r.bestStreak} kill streak`, cp: streakCp });
  let total = lines.reduce((s, l) => s + l.cp, 0);
  if (total < CP_REWARDS.minimum) {
    lines.push({ label: 'Participation', cp: CP_REWARDS.minimum - total });
    total = CP_REWARDS.minimum;
  }
  if (total > CP_REWARDS.maximum) {
    lines.push({ label: 'Match cap', cp: CP_REWARDS.maximum - total });
    total = CP_REWARDS.maximum;
  }
  return { lines: lines.filter((l) => l.cp !== 0), total };
}

/** CoD Points for one finished match (non-wager). */
export function codPointsForMatch(r: CpInput): number {
  return codPointsBreakdown(r).total;
}

// ---------------------------------------------------------------------------------------------
// Wagers
// ---------------------------------------------------------------------------------------------

export interface AnteTier {
  id: 'practice' | 'low' | 'mid' | 'high';
  name: string;
  ante: number;
  description: string;
}

/** BO1 ante tiers. Practice is free, bots only, and pays nothing. */
export const ANTE_TIERS: AnteTier[] = [
  { id: 'practice', name: 'Practice', ante: 0, description: 'Against bots. Nothing at stake, nothing paid.' },
  { id: 'low', name: 'Low Roller', ante: 10, description: 'Ten CoD Points. Learn the modes.' },
  { id: 'mid', name: 'Big Spender', ante: 1000, description: 'A thousand on the line.' },
  { id: 'high', name: 'High Roller', ante: 10000, description: 'Ten thousand. Top three only.' },
];

export const ANTES = ANTE_TIERS.map((t) => t.ante);

/** Fewest humans for real stakes; below this a wager runs as practice (bots fill, nobody pays). */
export const WAGER_MIN_HUMANS = 2;

/**
 * Share of the pot paid to 1st/2nd/3rd, by how many places are paid. Places paid =
 * min(3, humans - 1), so at least one staked player always loses their ante.
 */
export const PAYOUT_SPLITS: Record<number, readonly number[]> = {
  1: [1],
  2: [0.65, 0.35],
  3: [0.5, 0.3, 0.2],
};

export const paidPlaces = (humans: number) => Math.max(0, Math.min(3, humans - 1));

/**
 * Payout amounts for the pot. `staked` = humans who paid an ante at the start; `present` = how many
 * of them are still in at the end (leavers forfeit and cannot place). Rounding remainder goes to
 * 1st. Returns amounts for ranked present humans (index 0 = best placed human).
 */
export function wagerPayouts(pot: number, staked: number, present: number): number[] {
  const k = Math.min(paidPlaces(staked), present);
  if (k <= 0 || pot <= 0) return [];
  const shares = PAYOUT_SPLITS[paidPlaces(staked)]!.slice(0, k);
  const sum = shares.reduce((a, b) => a + b, 0);
  const out = shares.map((s) => Math.floor((pot * s) / sum));
  out[0]! += pot - out.reduce((a, b) => a + b, 0);
  return out;
}

const wager = (payouts = PAYOUT_SPLITS[3]!) => ({ ante: 1000, payouts: [...payouts] });

/** Wager modes. Rules: src/server/features/economy/modes/*.ts, registered from the feature setup. */
export const WAGER_MODES: ModeDef[] = [
  {
    id: 'oitc',
    name: 'One in the Chamber',
    short: 'OITC',
    description: 'A pistol with one bullet and three lives. Every shot kills; every kill refills the chamber. Knife when you are dry.',
    teams: false,
    scoreLimit: 0,
    timeLimitSec: 600,
    respawn: true,
    wager: wager(),
    playlist: 'wager',
    maxPlayers: 6,
  },
  {
    id: 'gungame',
    name: 'Gun Game',
    short: 'GUN',
    description: 'Every kill moves you to the next gun. A knife kill sets the victim back one. First through the ladder wins.',
    teams: false,
    scoreLimit: 0,
    timeLimitSec: 600,
    respawn: true,
    wager: wager(),
    playlist: 'wager',
    maxPlayers: 8,
  },
  {
    id: 'sharpshooter',
    name: 'Sharpshooter',
    short: 'SHARP',
    description: 'Everyone carries the same random gun, swapped every 45 seconds. Kill streaks stack perks and a score multiplier.',
    teams: false,
    scoreLimit: 0,
    timeLimitSec: 480,
    respawn: true,
    wager: wager(),
    playlist: 'wager',
    maxPlayers: 8,
  },
  {
    id: 'sticks',
    name: 'Sticks and Stones',
    short: 'S&S',
    description: 'Crossbow, ballistic knife and tomahawks. A tomahawk kill bankrupts the victim.',
    teams: false,
    scoreLimit: 0,
    timeLimitSec: 600,
    respawn: true,
    wager: wager(),
    playlist: 'wager',
    maxPlayers: 8,
  },
];

export const isWagerMode = (id: string) => WAGER_MODES.some((m) => m.id === id);

// ---------------------------------------------------------------------------------------------
// Wager mode data (the server rules and the client HUD both read these)
// ---------------------------------------------------------------------------------------------

export const OITC = { lives: 3, weapon: 'm1911', killScore: 50, surviveScore: 10 };

/**
 * Gun Game ladder by intent (BO1 order: pistols, shotguns, SMGs, ARs, snipers, LMGs, specials).
 * Ids the weapons area hasn't shipped are skipped at runtime (`gunGameLadder`). The MW2 additions
 * (M16A4, ACR, Intervention) sit next to their BO1 cousins and bring the shipped ladder to BO1's 20.
 * The HK21 shipped later with the other LMGs; it is left off so the ladder stays at 20 rungs with
 * the RPK as its one LMG.
 */
export const GUN_GAME_LADDER_INTENT = [
  'm1911', 'python', 'cz75', 'olympia', 'spas12', 'mp5k', 'ak74u', 'mac11', 'm16', 'm16a4', 'famas', 'galil', 'commando', 'aug', 'acr', 'ak47', 'rpk', 'dragunov', 'intervention', 'l96a1', 'crossbow', 'ballistic_knife',
];
export const GUN_GAME = { killScore: 100, demoteOnMelee: true, demoteOnSuicide: true };

export const SHARPSHOOTER = {
  rotateSec: 45,
  killScore: 50,
  /** Weapon classes eligible for the rotation. */
  classes: ['ar', 'smg', 'lmg', 'sniper', 'shotgun', 'pistol', 'machinepistol'] as readonly string[],
  /**
   * Streak bonuses (BO1-style "perks and multiplier"): at `streak` kills in a life you get the perk
   * effect and the score multiplier. Highest reached applies.
   */
  bonuses: [
    { streak: 2, name: 'Sleight of Hand', multiplier: 2 },
    { streak: 3, name: 'Steady Aim', multiplier: 2 },
    { streak: 4, name: 'Lightweight', multiplier: 3 },
    { streak: 6, name: 'Marathon', multiplier: 4 },
  ] as readonly { streak: number; name: string; multiplier: number }[],
};

/**
 * Sticks and Stones (BO1 wager). Points from BO1: crossbow / ballistic knife shot / any other
 * kill 100, knife (melee) 25, tomahawk 10 plus the victim is bankrupted (score to 0). Any suicide
 * (your own bolt, falling off the map) bankrupts yourself. Everyone gets the crossbow (6 bolts),
 * the ballistic knife (2 blades) and one tomahawk; no scavenging and no ammo for kills, so you
 * pick your blades and tomahawk back up.
 */
export const STICKS = { primary: 'crossbow', secondary: 'ballistic_knife', lethal: 'tomahawk', killScore: 100, meleeScore: 25, tomahawkScore: 10 };

/**
 * Crossbow explosive bolt (BO1: 50 direct impact, sticks, beeps, then 200-75 in a 4 m radius, and
 * whoever it is stuck to always dies). The fuse length isn't documented on the wiki; 1.5 s matches
 * the "brief moment of beeping" in BO1 footage.
 */
export const BOLT = { speed: 60, gravity: 4, impact: 50, fuseSec: 1.5, radius: 4, max: 200, min: 75, lifeSec: 4 };

/**
 * Ballistic knife blade (BO1: a slow parabolic arc, flat 250 damage = one hit anywhere). Fired
 * blades stay where they land (stuck in a wall, on the floor, or at the victim's body) and anyone
 * holding a ballistic knife picks them up by walking over them or pressing USE (BO2's
 * `_ballistic_knife.gsc` has no owner check), up to the gun's full load.
 */
export const BLADE = { speed: 32, gravity: 9, damage: 250, lifeSec: 4, pickupSec: 60, walkRadius: 1.0, useRadius: 2.0 };

/** Entity kinds for the wager projectiles (economy server simulates, economy client renders). */
export const BOLT_ENTITY = 'economy.bolt';
export const BLADE_ENTITY = 'economy.blade';

/** Melee in every wager mode: one-hit knife. */
export const WAGER_MELEE = { range: 2.2, cooldownSec: 0.7, minDot: 0.55 };
