/**
 * Zombies (owner: zombies): BO1-style round-based co-op survival. Data and pure maths shared by the
 * server rules (src/server/features/zombies/) and the client (src/client/features/zombies/).
 *
 * Sources (see docs/features/zombies.md for the full list):
 * - T5 script dump, plutoniummod/t5-scripts `ZM/Common/maps/`:
 *   `_zombiemode.gsc` (`set_zombie_var` defaults, `ai_calculate_health`, `round_spawning`,
 *   `default_max_zombie_func`, `round_think` spawn delay and move speed, `zombie_speed_up`,
 *   `level.zombie_ai_limit = 24`, `solo_revive_time = 10.0`),
 *   `_zombiemode_spawner.gsc` (`set_run_speed`: walk <= 35 < run <= 70 < sprint),
 *   `_zombiemode_score.gsc` (`player_add_points`, `player_add_points_kill_bonus`, penalties),
 *   `_zombiemode_powerups.gsc` (`watch_for_drop`, `powerup_drop`, `get_next_powerup`, timeouts,
 *   the Nuke's 400), `_zombiemode_perks.gsc` (prices, solo Quick Revive 500 and three lives),
 *   `_zombiemode_weapons.gsc` (box joker / teddy bear chances, 950), `_zombiemode_ai_dogs.gsc`
 *   (dog rounds, counts, health, spawn waits, last dog drops Max Ammo).
 * - Call of Duty Wiki (MediaWiki API): "Points (Zombies)" (+10 hit, 60 torso, 50 limb, 100 head,
 *   130 melee kill, revive = 5% of the downed player's points), "Juggernog" (100 -> 250 health:
 *   zombies down you on the 5th hit), "Quick Revive" (1500 / 500 solo, three solo self-revives,
 *   revives twice as fast), "Mystery Box", "Hellhound", "Max Ammo", "Insta-Kill", "Nuke",
 *   "Double Points".
 */
import type { Loadout } from '../loadout';
import type { Vec3 } from '../math';
import { LOADOUT_WEAPONS, WEAPON_BY_ID } from './weapons';
import { WONDER_WEAPON_IDS } from './wonder';

export const ZOMBIES_MODE = 'zombies';
/** Team 0: the survivors (players). Team 1: zombies and hellhounds. */
export const ZOMBIES_TEAMS = { players: 0, zombies: 1 } as const;
export const ZOMBIES_TEAM_NAMES: readonly [string, string] = ['Survivors', 'Zombies'];

// ---------------------------------------------------------------------------------------------
// Tuning (BO1 numbers unless a comment says otherwise)
// ---------------------------------------------------------------------------------------------

export const ZOMBIES = {
  /** `zombie_score_start_<n>p` (mp/zombiemode.csv: 500 for every player count). */
  startPoints: 500,
  /** `level.zombie_ai_limit`: zombies alive at once; the rest wait in the queue. */
  maxAlive: 24,
  /** `zombie_max_ai`, `zombie_ai_per_player`. */
  maxAi: 24,
  aiPerPlayer: 6,
  /** `zombie_health_start`, `zombie_health_increase` (rounds 2-9), `zombie_health_increase_multiplier` (10+). */
  healthStart: 150,
  healthIncrease: 100,
  healthMultiplier: 0.1,
  /** `zombie_spawn_delay` 2.0, x0.95 after every round while above 0.08. */
  spawnDelayStart: 2.0,
  spawnDelayDecay: 0.95,
  spawnDelayMin: 0.08,
  /** `zombie_move_speed_multiplier`: round x 8 gives the base speed roll. */
  moveSpeedMultiplier: 8,
  /** `set_run_speed`: rand(base, base + 35); <= 35 walk, <= 70 run, else sprint. */
  moveSpeedRange: 35,
  walkMax: 35,
  runMax: 70,
  /** Seconds before round 1's zombies start coming (BO1 shows the chalk "1" first). */
  firstRoundDelay: 4,
  /**
   * `zombie_between_round_time` is 10 s in BO1; ours is shorter ("short breaks between rounds"):
   * the round-end stinger, the chalk flashing, then the next round.
   */
  betweenRoundSec: 8,
  /** Zombie swipe: `player_damage_override` 50 per hit (2 hits down you, 5 with Juggernog). */
  swipeDamage: 50,
  /** Swipe wind-up (the arm comes down) and the gap between swipes. */
  swipeWindup: 0.45,
  swipeEvery: 1.1,
  /** Reach of a swipe (horizontal, from body centre to body centre) and the height tolerance. */
  swipeReach: 1.25,
  swipeDy: 1.2,
  /** Hellhound bite (`self.meleeDamage = 40` in _zombiemode_ai_dogs.gsc). */
  dogBite: 40,
  dogBiteEvery: 0.9,
  dogReach: 1.35,
  /** Player health (core 100) and Juggernog's (wiki: 250, down on the 5th zombie hit). */
  jugHealth: 250,
  /** `penalty_downed` 5% of your points when you go down, given to whoever revives you (wiki). */
  downedPenalty: 0.05,
  /** `penalty_no_revive`: everyone else loses 10% when a teammate bleeds out. */
  noRevivePenalty: 0.1,
  /** Co-op bleed-out (BO1 last stand 30 s), revive hold (3 s; Quick Revive halves it). */
  bleedOutSec: 30,
  reviveSec: 3,
  reviveRadius: 1.6,
  /** Solo Quick Revive: revived after `solo_revive_time` 10 s; the machine sells at most 3 lives. */
  soloReviveSec: 10,
  soloReviveLives: 3,
  /** After the last player is down: "GAME OVER" before the results (and longer than the final killcam window). */
  gameOverSec: 8.5,
  /** A zombie that could not reach anyone for this long is quietly respawned elsewhere (`round_spawn_failsafe`). */
  failsafeSec: 30,
  /** Corpses stay this long before the body is reused for a new zombie. */
  corpseSec: 2.5,
  /** Lethal grenades: BO1 starts you with 2 frags and tops you up each round (max 4). */
  startGrenades: 2,
  maxGrenades: 4,
} as const;

/** Movement speeds (m/s) per BO1 run cycle. Player walk is 5.0 m/s, sprint 7.2. */
export const ZOMBIE_SPEED = { walk: 1.35, run: 3.1, sprint: 4.7, dog: 6.6 } as const;
export type ZombieGait = 'walk' | 'run' | 'sprint';

// ---------------------------------------------------------------------------------------------
// Round formulas
// ---------------------------------------------------------------------------------------------

/** `ai_calculate_health(round)`: 150, +100 a round up to round 9, then +10% (truncated) a round. */
export function zombieHealth(round: number): number {
  let h: number = ZOMBIES.healthStart;
  for (let i = 2; i <= round; i++) {
    if (i >= 10) h += Math.trunc(h * ZOMBIES.healthMultiplier);
    else h = Math.trunc(h + ZOMBIES.healthIncrease);
  }
  return h;
}

/**
 * Zombies in a round (`round_spawning` + `default_max_zombie_func`): 24 plus extra per player,
 * scaled by round / 5 (and by round x 0.15 from round 10), then rounds 1-5 take 25/30/50/70/90%.
 */
export function zombiesForRound(round: number, players: number): number {
  let max: number = ZOMBIES.maxAi;
  let multiplier = round / 5;
  if (multiplier < 1) multiplier = 1;
  if (round >= 10) multiplier *= round * 0.15;
  const n = Math.max(1, players);
  if (n === 1) max += Math.trunc(0.5 * ZOMBIES.aiPerPlayer * multiplier);
  else max += Math.trunc((n - 1) * ZOMBIES.aiPerPlayer * multiplier);
  if (round <= 1) return Math.trunc(max * 0.25);
  if (round < 3) return Math.trunc(max * 0.3);
  if (round < 4) return Math.trunc(max * 0.5);
  if (round < 5) return Math.trunc(max * 0.7);
  if (round < 6) return Math.trunc(max * 0.9);
  return max;
}

/** Seconds between zombie spawns in a round: 2.0, x0.95 after each round while above 0.08 (`round_think`). */
export function spawnDelay(round: number): number {
  let t: number = ZOMBIES.spawnDelayStart;
  for (let i = 1; i < round; i++) {
    if (t > ZOMBIES.spawnDelayMin) t *= ZOMBIES.spawnDelayDecay;
    else if (t < ZOMBIES.spawnDelayMin) t = ZOMBIES.spawnDelayMin;
  }
  return t;
}

/** `level.zombie_move_speed` in a round: 1 in round 1, then (round - 1) x 8 (set at the end of the previous round). */
export function moveSpeedBase(round: number): number {
  return round <= 1 ? 1 : (round - 1) * ZOMBIES.moveSpeedMultiplier;
}

/** `set_run_speed`: a roll in [base, base + 35) decides the gait. `rnd` in [0, 1). */
export function rollGait(round: number, rnd: number): ZombieGait {
  const base = moveSpeedBase(round);
  const roll = base + Math.floor(rnd * ZOMBIES.moveSpeedRange);
  if (roll <= ZOMBIES.walkMax) return 'walk';
  if (roll <= ZOMBIES.runMax) return 'run';
  return 'sprint';
}

/** Chance of each gait in a round (exact, for tests and the HUD). */
export function gaitOdds(round: number): Record<ZombieGait, number> {
  const out: Record<ZombieGait, number> = { walk: 0, run: 0, sprint: 0 };
  for (let k = 0; k < ZOMBIES.moveSpeedRange; k++) out[rollGait(round, (k + 0.5) / ZOMBIES.moveSpeedRange)] += 1 / ZOMBIES.moveSpeedRange;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Hellhound (dog) rounds (_zombiemode_ai_dogs.gsc)
// ---------------------------------------------------------------------------------------------

export const DOGS = {
  /** First dog round: randomintrange(5, 8) = 5..7; then + randomintrange(4, 6) = 4..5 rounds. */
  firstMin: 5,
  firstMax: 7,
  gapMin: 4,
  gapMax: 5,
  /** Dogs: players x 6 in the first two dog rounds, players x 8 after. */
  perPlayerEarly: 6,
  perPlayerLate: 8,
  /** At most 2 alive per living player. */
  alivePerPlayer: 2,
  /** `dog_health_increase`: 400, 900, 1300, then 1600. */
  health: [400, 900, 1300, 1600] as readonly number[],
  /** `waiting_for_next_dog_spawn`: 3 / 2.5 / 2 / 1.5 s by dog round, minus count / max. */
  waits: [3, 2.5, 2, 1.5] as readonly number[],
  /** BO1 waits 7 s (lightning, the announcer) before the first dog. */
  introSec: 7,
} as const;

/** The first dog round for a uniform roll `rnd` in [0, 1). */
export const firstDogRound = (rnd: number): number => DOGS.firstMin + Math.floor(rnd * (DOGS.firstMax - DOGS.firstMin + 1));
/** The dog round after `round`. */
export const nextDogRound = (round: number, rnd: number): number => round + DOGS.gapMin + Math.floor(rnd * (DOGS.gapMax - DOGS.gapMin + 1));
/** Dogs in the `dogRound`-th dog round (1-based). */
export const dogsForRound = (dogRound: number, players: number): number => Math.max(1, players) * (dogRound < 3 ? DOGS.perPlayerEarly : DOGS.perPlayerLate);
export const dogHealth = (dogRound: number): number => DOGS.health[Math.min(DOGS.health.length, Math.max(1, dogRound)) - 1]!;
export const dogSpawnWait = (dogRound: number, count: number, max: number): number => DOGS.waits[Math.min(DOGS.waits.length, Math.max(1, dogRound)) - 1]! - count / Math.max(1, max);

// ---------------------------------------------------------------------------------------------
// Points (_zombiemode_score.gsc)
// ---------------------------------------------------------------------------------------------

export const POINTS = {
  /** `zombie_score_damage_normal` / `_light`: a non-lethal hit. */
  hit: 10,
  /** `zombie_score_kill_<n>player`. */
  kill: 50,
  /** `zombie_score_bonus_*`: head 50, neck 20, torso 10, melee 80 (limbs: none). */
  head: 50,
  torso: 10,
  melee: 80,
  nuke: 400,
  carpenter: 200,
  board: 10,
} as const;

export type ZombieHitPart = 'head' | 'torso' | 'legs' | null;

/** Points for a kill (`player_add_points('death')`): 50 + the bonus for where/how it died. */
export function killPoints(part: ZombieHitPart, means: string): number {
  if (means === 'melee') return POINTS.kill + POINTS.melee;
  if (means !== 'bullet') return POINTS.kill;
  if (part === 'head') return POINTS.kill + POINTS.head;
  if (part === 'torso') return POINTS.kill + POINTS.torso;
  return POINTS.kill;
}

/** `round_up_score(points, 5)` then the Double Points multiplier (`zombie_point_scalar`). */
export function scaledPoints(points: number, doubled: boolean): number {
  const r = Math.ceil(points / 5) * 5;
  return doubled ? r * 2 : r;
}

/** `round_up_to_ten`. */
export const roundUpToTen = (v: number): number => Math.ceil(v / 10) * 10;

/** Points lost when going down (`penalty_downed`), rounded up to ten. */
export const downedLoss = (points: number): number => Math.min(points, roundUpToTen(Math.trunc(points * ZOMBIES.downedPenalty)));

// ---------------------------------------------------------------------------------------------
// Power-ups (_zombiemode_powerups.gsc)
// ---------------------------------------------------------------------------------------------

export type PowerupId = 'full_ammo' | 'insta_kill' | 'double_points' | 'nuke' | 'carpenter';

export interface PowerupDef {
  id: PowerupId;
  name: string;
  /** Glow / banner colour. */
  color: string;
  /** Lasting effect (s), or 0 for an instant one. */
  durationSec: number;
}

export const POWERUPS: readonly PowerupDef[] = [
  { id: 'full_ammo', name: 'Max Ammo', color: '#7cff6a', durationSec: 0 },
  { id: 'insta_kill', name: 'Insta-Kill', color: '#ff5a4a', durationSec: 30 },
  { id: 'double_points', name: 'Double Points', color: '#ffd84a', durationSec: 30 },
  { id: 'nuke', name: 'Kaboom!', color: '#ffb04a', durationSec: 0 },
  { id: 'carpenter', name: 'Carpenter', color: '#c8a070', durationSec: 0 },
];
export const POWERUP_BY_ID = new Map(POWERUPS.map((p) => [p.id, p]));

export const POWERUP_RULES = {
  /** `zombie_powerup_drop_max_per_round`. */
  maxPerRound: 4,
  /** `rand_drop = randomint(100); if (rand_drop > 2)` needs the score flag: 3% drop at random. */
  randomChance: 3,
  /** `zombie_powerup_drop_increment` 2000, x1.14 every time the score threshold is crossed. */
  increment: 2000,
  incrementGrowth: 1.14,
  /** On the ground: solid for 15 s, then it blinks (40 hide/show steps) and is gone. */
  solidSec: 15,
  blinkSec: 11,
  /** Grab radius (BO1's trigger is 64 units across). */
  grabRadius: 1.3,
  /** Carpenter needs at least this many destroyed windows. */
  carpenterMinWindows: 5,
  /** Nuke: zombies die staggered over randomfloatrange(0.1, 0.7) s each, after a 0.5 s flash. */
  nukeDelay: 0.5,
  nukeStaggerMin: 0.1,
  nukeStaggerMax: 0.7,
} as const;

/** The power-up drop flag's score threshold (`watch_for_drop`). */
export interface DropTracker {
  increment: number;
  threshold: number;
  flag: boolean;
  dropsThisRound: number;
}

export function newDropTracker(players: number): DropTracker {
  return { increment: POWERUP_RULES.increment, threshold: Math.max(1, players) * ZOMBIES.startPoints + POWERUP_RULES.increment, flag: false, dropsThisRound: 0 };
}

/** Every 0.5 s: past the threshold the next kill drops, and the threshold moves on. */
export function updateDropTracker(t: DropTracker, totalScore: number): void {
  if (totalScore > t.threshold) {
    t.increment *= POWERUP_RULES.incrementGrowth;
    t.threshold = totalScore + t.increment;
    t.flag = true;
  }
}

/** Does this kill drop a power-up? `rnd` in [0, 1). Consumes the flag and counts the drop. */
export function rollDrop(t: DropTracker, rnd: number): boolean {
  if (t.dropsThisRound >= POWERUP_RULES.maxPerRound) return false;
  const roll = Math.floor(rnd * 100);
  if (roll > POWERUP_RULES.randomChance - 1 && !t.flag) return false;
  t.flag = false;
  t.dropsThisRound++;
  return true;
}

/** BO1's shuffled power-up cycle (`get_next_powerup` / `randomize_powerups`) with its skip rules. */
export class PowerupCycle {
  private list: PowerupId[];
  private i = 0;
  constructor(
    readonly ids: readonly PowerupId[],
    private rnd: () => number = Math.random,
  ) {
    this.list = shuffle([...ids], rnd);
  }
  private next(): PowerupId {
    const p = this.list[this.i]!;
    this.i++;
    if (this.i >= this.list.length) {
      this.i = 0;
      this.list = shuffle(this.list, this.rnd);
    }
    return p;
  }
  /** The next valid power-up (`get_valid_powerup`): Carpenter only with enough broken windows. */
  pick(ctx: { brokenWindows: number }): PowerupId {
    for (let guard = 0; guard < this.list.length * 2 + 2; guard++) {
      const p = this.next();
      if (p === 'carpenter' && ctx.brokenWindows < POWERUP_RULES.carpenterMinWindows) continue;
      return p;
    }
    return 'full_ammo';
  }
}

function shuffle<T>(a: T[], rnd: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ---------------------------------------------------------------------------------------------
// Perk-a-Colas (_zombiemode_perks.gsc)
// ---------------------------------------------------------------------------------------------

export type PerkColaId = 'jugg' | 'speed' | 'doubletap' | 'revive';

export interface PerkColaDef {
  id: PerkColaId;
  name: string;
  short: string;
  price: number;
  /** Quick Revive solo price. */
  soloPrice?: number;
  /** Machine glow / logo colour and the HUD icon colour. */
  color: string;
  blurb: string;
}

export const PERK_COLAS: readonly PerkColaDef[] = [
  { id: 'jugg', name: 'Juggernog', short: 'JUG', price: 2500, color: '#e0402a', blurb: 'More health: 5 hits to go down' },
  { id: 'speed', name: 'Speed Cola', short: 'SPD', price: 3000, color: '#3ac85a', blurb: 'Reload twice as fast' },
  { id: 'doubletap', name: 'Double Tap Root Beer', short: 'DBL', price: 2000, color: '#f0a020', blurb: 'Fire 33% faster' },
  { id: 'revive', name: 'Quick Revive', short: 'REV', price: 1500, soloPrice: 500, color: '#4aa8ff', blurb: 'Revive faster; solo: revive yourself' },
];
export const PERK_COLA_BY_ID = new Map(PERK_COLAS.map((p) => [p.id, p]));

export const PERK_EFFECTS = {
  /** Speed Cola (`specialty_fastreload`): reloads x0.5. */
  speedReload: 0.5,
  /** Double Tap (`specialty_rof`, `perk_weapRateMultiplier` 0.75): 1 / 0.75 = x1.33 fire rate. */
  doubleTapRate: 1 / 0.75,
  /** Quick Revive: revive teammates in half the time. */
  reviveSpeed: 0.5,
  /** Drinking: the bottle comes up, you drink, the gun comes back (BO1 ~3 s). */
  drinkSec: 2.6,
} as const;

export const perkPrice = (id: PerkColaId, solo: boolean): number => {
  const d = PERK_COLA_BY_ID.get(id)!;
  return solo && d.soloPrice !== undefined ? d.soloPrice : d.price;
};

// ---------------------------------------------------------------------------------------------
// Wall-buys and the Mystery Box (_zombiemode_weapons.gsc)
// ---------------------------------------------------------------------------------------------

/**
 * Wall weapon prices (BO1 Kino der Toten tiers, mapped onto the guns we have: no M14 or PM63 here,
 * so the M16 and the MPL take their places). Ammo costs half the weapon (BO1 `ammo_cost`).
 */
export const WALL_PRICES: Record<string, number> = {
  olympia: 500,
  mp5k: 1000,
  mpl: 1000,
  ak74u: 1200,
  m16a4: 1200,
  stakeout: 1500,
  asp: 500,
  commando: 1400,
};
export const ammoPrice = (price: number): number => Math.round(price / 2);

export const BOX = {
  cost: 950,
  /** `timer_til_despawn`: an untaken weapon sinks back over 12 s. */
  offerSec: 12,
  /** Teddy bear: the box flies off, then lands at another spot after this long. */
  moveSec: 6,
  /** Hold to open (BO1: press), reach (m). */
  reach: 1.9,
  dy: 1.8,
} as const;

/** The teddy bear chance (`treasure_chest_weapon_spawn`): `accessed` uses since the last move. Returns true for a teddy. */
export function teddyRoll(accessed: number, moves: number, rnd: number): boolean {
  const random = Math.floor(rnd * 100);
  if (accessed < 4) return false;
  let chance = accessed + 20;
  if (moves === 0 && accessed >= 8) chance = 100;
  if (accessed >= 4 && accessed < 8) chance = random < 15 ? 100 : -1;
  if (moves > 0) {
    if (accessed >= 8 && accessed < 13) chance = random < 30 ? 100 : -1;
    if (accessed >= 13) chance = random < 50 ? 100 : -1;
  }
  return chance > random;
}

/** Box weights: every classable gun 1 (not the starting M1911), the Ray Gun rarer, other wonder weapons rarer still. */
export const BOX_WEIGHTS = { gun: 1, raygun: 0.6, wonder: 0.3 } as const;

export function boxPool(): { id: string; weight: number }[] {
  const out: { id: string; weight: number }[] = [];
  for (const w of LOADOUT_WEAPONS) if (w.id !== 'm1911') out.push({ id: w.id, weight: BOX_WEIGHTS.gun });
  for (const id of WONDER_WEAPON_IDS) if (WEAPON_BY_ID.has(id)) out.push({ id, weight: id === 'raygun' ? BOX_WEIGHTS.raygun : BOX_WEIGHTS.wonder });
  return out;
}

/** Roll a box weapon the player doesn't carry (`treasure_chest_ChooseWeightedRandomWeapon`). */
export function rollBoxWeapon(carried: readonly string[], rnd: number, pool = boxPool()): string {
  const list = pool.filter((p) => !carried.includes(p.id));
  const use = list.length ? list : pool;
  const total = use.reduce((s, p) => s + p.weight, 0);
  let r = rnd * total;
  for (const p of use) {
    r -= p.weight;
    if (r < 0) return p.id;
  }
  return use[use.length - 1]!.id;
}

// ---------------------------------------------------------------------------------------------
// Damage against zombies
// ---------------------------------------------------------------------------------------------

/**
 * Our guns are tuned for 100-health players; BO1's zombie weapon files hit much harder (and the
 * M1911 is weak: "six shots and a knife" in round 1). Multipliers on damage dealt to zombies and
 * hellhounds by class, with per-weapon overrides. The knife already does BO1's 150.
 */
export const ZOMBIE_DAMAGE = {
  byClass: { ar: 2.6, smg: 2.5, lmg: 2.6, sniper: 4, shotgun: 3, pistol: 2.2, launcher: 3, special: 6 } as Record<string, number>,
  byWeapon: { m1911: 0.5, raygun: 6, thundergun: 40, wunderwaffe: 40, wintershowl: 30, gl: 3 } as Record<string, number>,
  explosive: 2.5,
} as const;

export function zombieDamageMult(weapon: string, means: string): number {
  if (means === 'melee') return 1;
  const w = WEAPON_BY_ID.get(weapon);
  const byW = ZOMBIE_DAMAGE.byWeapon[weapon];
  if (byW !== undefined) return byW;
  if (w) return ZOMBIE_DAMAGE.byClass[w.class] ?? 2.5;
  return means === 'explosive' ? ZOMBIE_DAMAGE.explosive : 1;
}

/**
 * Hit-part multipliers against zombies (BO1's `_zm` weapon files, as the Call of Duty Wiki lists
 * them per weapon: "Upgraded Weapons/Black Ops", `regmultiplier`). Our guns carry multiplayer
 * multipliers (heads x1.4, shotguns x1) which made a headshot on a zombie barely count; BO1
 * Zombies hits the head x3-x10. `head` and `torso` replace the weapon's own (`torso` only where
 * BO1 lists a chest multiplier above 1); limbs keep theirs.
 *   ARs and SMGs (M16, Famas, Commando, Galil, AUG, AK-74u, MP5K, MPL, Spectre...) head x4;
 *   RPK / HK21 x3; M1911 x3.5, chest x1.25; CZ75 x3.5; Python head and chest x1.5;
 *   Dragunov x10, chest x1.5; L96A1 x10; shotguns none (N/A); the wonder weapons none.
 */
export const ZOMBIE_PARTS = {
  byClass: {
    ar: { head: 4 },
    smg: { head: 4 },
    lmg: { head: 3 },
    sniper: { head: 10 },
    pistol: { head: 3.5 },
    shotgun: { head: 1 },
    launcher: { head: 1 },
    special: { head: 1 },
  } as Record<string, { head: number; torso?: number }>,
  byWeapon: {
    m1911: { head: 3.5, torso: 1.25 },
    python: { head: 1.5, torso: 1.5 },
    dragunov: { head: 10, torso: 1.5 },
    rpk: { head: 3 },
  } as Record<string, { head: number; torso?: number }>,
} as const;

/**
 * Factor on a gun's damage against a zombie for the part it hit: BO1's zombie multiplier over the
 * weapon's own (which `fire()` already applied). 1 for anything but bullets.
 */
export function zombiePartMult(weapon: string, part: 'head' | 'torso' | 'legs' | null | undefined, means: string): number {
  if (means !== 'bullet' || !part || part === 'legs') return 1;
  const w = WEAPON_BY_ID.get(weapon);
  if (!w) return 1;
  const zm = ZOMBIE_PARTS.byWeapon[weapon] ?? ZOMBIE_PARTS.byClass[w.class];
  if (!zm) return 1;
  const own = part === 'head' ? w.multipliers.head : w.multipliers.torso;
  const want = part === 'head' ? zm.head : (zm.torso ?? own);
  return own > 0 ? want / own : 1;
}

/** Damage one bullet of `weapon` does to a zombie at point blank on `part` (tests, docs). */
export function zombieBulletDamage(weapon: string, part: 'head' | 'torso' | 'legs'): number {
  const w = WEAPON_BY_ID.get(weapon);
  if (!w) return 0;
  const own = part === 'head' ? w.multipliers.head : part === 'torso' ? w.multipliers.torso : w.multipliers.limb;
  return w.damage.near * own * zombieDamageMult(weapon, 'bullet') * zombiePartMult(weapon, part, 'bullet');
}

// ---------------------------------------------------------------------------------------------
// The zombie's pose (client look.ts) kept inside its hitboxes
// ---------------------------------------------------------------------------------------------

/**
 * Hitboxes are the standing player's (`playerHitboxes`: the head is a 0.3 m box on top of the
 * feet, 1.44-1.8 m). The old shamble leaned the whole soldier up to 0.37 rad about the feet, which
 * drew the head 0.3-0.65 m in front of its hitbox: aimed at the drawn head from anywhere but dead
 * ahead, a shot passed beside the head box (a miss or a torso hit). The pose now leans about the
 * hips, a little, with the head nodding and lolling, so the drawn head stays inside the head box
 * at every speed and phase (tests/zombies.headshots.test.ts).
 *
 * Soldier geometry (src/client/render/models/soldier.ts): hips at 0.96, the neck pivot at 1.58,
 * the head box centred 0.19 above it and 0.01 forward.
 */
export const ZOMBIE_POSE = {
  hip: 0.96,
  neck: 1.58,
  headUp: 0.19,
  headFwd: 0.01,
  /** Forward lean (rad): base + per m/s, capped. */
  leanBase: 0.05,
  leanPerMs: 0.01,
  leanMax: 0.09,
  /** Side-to-side lurch (rad) and the head's loll (rad) and nod (rad, + = chin down). */
  lurch: 0.04,
  headRoll: 0.18,
  headNod: 0.12,
  /** Climbing out of the ground: seconds, and the part of it spent crouched (the server crouches the body). */
  riseSec: 1.1,
  riseCrouchSec: 0.55,
  /** How far below the ground the climb starts (on top of the crouch). */
  riseDrop: 0.9,
} as const;

export interface ZombiePoseAngles {
  /** Body lean forward (rad, about the hips) and roll (rad, + leans to its left). */
  lean: number;
  roll: number;
  /** Head nod (rad, + = chin down) and roll (rad). */
  nod: number;
  headRoll: number;
}

/** The shamble at `speed` m/s and walk-cycle `phase` (radians). */
export function zombiePose(speed: number, phase: number): ZombiePoseAngles {
  const P = ZOMBIE_POSE;
  return {
    lean: Math.min(P.leanMax, P.leanBase + speed * P.leanPerMs),
    roll: Math.sin(phase) * P.lurch,
    nod: P.headNod,
    headRoll: Math.sin(phase * 0.5) * P.headRoll,
  };
}

/**
 * Centre of the drawn head relative to the feet, in the body's frame: `x` to its right, `y` up,
 * `z` ahead (Three.js Euler XYZ, as look.ts sets it: the body turns about the hips, the head about
 * the neck).
 */
export function zombieHeadCenter(a: ZombiePoseAngles): { x: number; y: number; z: number } {
  const P = ZOMBIE_POSE;
  // Head frame: nod about x, then roll about z (Euler XYZ applies z first, then x).
  let x = 0;
  let y: number = P.headUp;
  let z: number = P.headFwd;
  [x, y] = [x * Math.cos(a.headRoll) - y * Math.sin(a.headRoll), x * Math.sin(a.headRoll) + y * Math.cos(a.headRoll)];
  [y, z] = [y * Math.cos(a.nod) - z * Math.sin(a.nod), y * Math.sin(a.nod) + z * Math.cos(a.nod)];
  // Body frame, relative to the hip pivot.
  y += P.neck - P.hip;
  [x, y] = [x * Math.cos(a.roll) - y * Math.sin(a.roll), x * Math.sin(a.roll) + y * Math.cos(a.roll)];
  [y, z] = [y * Math.cos(a.lean) - z * Math.sin(a.lean), y * Math.sin(a.lean) + z * Math.cos(a.lean)];
  // Model space faces +z with +x on its left (the soldier is turned by yaw + PI): report x as "right".
  return { x: -x, y: y + P.hip, z };
}

/** The old shamble (before the fix), for the test that shows why head shots missed. */
export function legacyZombieHeadCenter(speed: number): { x: number; y: number; z: number } {
  const lean = 0.12 + Math.min(0.25, speed * 0.04);
  // Lean about the feet, head tilted back 0.2.
  const y0 = ZOMBIE_POSE.neck + 0.19 * Math.cos(-0.2);
  const z0 = 0.01 + 0.19 * Math.sin(-0.2);
  return { x: 0, y: y0 * Math.cos(lean) - z0 * Math.sin(lean), z: y0 * Math.sin(lean) + z0 * Math.cos(lean) };
}

// ---------------------------------------------------------------------------------------------
// Loadout, XP
// ---------------------------------------------------------------------------------------------

/**
 * Spawn loadout. `primary` only satisfies the loadout shape (sanitizeLoadout wants a primary
 * weapon there); the spawn hands the player the M1911 alone with 8 + 32 rounds (`STARTING_WEAPON`).
 */
export const ZOMBIES_LOADOUT: Loadout = { name: 'Survivor', primary: { weapon: 'mp5k', attachments: [], camo: 'none' }, secondary: { weapon: 'm1911', attachments: [], camo: 'none' }, perks: [], killstreaks: [], lethal: 'frag', tactical: null };
export const STARTING_WEAPON = { weapon: 'm1911', mag: 8, reserve: 32 } as const;

/** XP: a zombie kill is worth far less than a player kill, rounds survived pay. */
export const ZOMBIES_XP = {
  kill: 10,
  headshot: 5,
  /** Objective `zombies.round` per round survived: base + per round number. */
  roundBase: 50,
  roundPer: 10,
  revive: 50,
} as const;
export const roundXp = (round: number): number => ZOMBIES_XP.roundBase + ZOMBIES_XP.roundPer * round;

// ---------------------------------------------------------------------------------------------
// Entities and wire types
// ---------------------------------------------------------------------------------------------

export const ZM_ENTITY = {
  /** A wall-buy: `s = { w: weapon id, p: price, a: ammo price }`, yaw = the way the chalk faces. */
  wall: 'zm_wall',
  /** A Perk-a-Cola machine: `s = { k: perk id, p: price, off?: 1 once sold out }`. */
  perk: 'zm_perk',
  /** The Mystery Box: the killstreak box's `BoxSnap` (`ks_mbox` renderer), plus `c` = cost, `ty` = 1 teddy. */
  box: 'zm_box',
  /** A spot the box can move to (a faint chalk mark): `s = {}`. */
  boxSpot: 'zm_boxspot',
  /** A power-up on the ground: `s = { k: id, t0: dropped at, te: gone at }`. */
  powerup: 'zm_powerup',
  /** A boarded window: `s = { b: boards up (0..6), w, h }`, yaw = facing inside. */
  barrier: 'zm_barrier',
} as const;

export const BARRIER = {
  boards: 6,
  /** A zombie tears a board off every this many seconds while at the window. */
  tearSec: 1.1,
  /** Holding USE rebuilds a board every this many seconds. */
  rebuildSec: 0.75,
  /** Rebuild reach. */
  reach: 1.8,
  /** BO1: board points per round capped at min(50 x round, 500). */
  capPerRound: (round: number) => Math.min(50 * round, 500),
} as const;

export type ZombiesPhase = 'pre' | 'active' | 'break' | 'over';

export interface ZombiesPlayerInfo {
  id: string;
  points: number;
  perks: PerkColaId[];
  down: boolean;
  /** Room time the bleed-out (or the solo self-revive) ends. */
  downUntil: number | null;
  selfRevive: boolean;
  revive: number;
  dead: boolean;
  kills: number;
  headshots: number;
  downs: number;
  revives: number;
  /** Solo Quick Revive lives left (shown on the machine). */
  drinking?: number;
}

/** `zombies.state`, pushed to every human on change (and every second). */
export interface ZombiesStatePayload {
  round: number;
  phase: ZombiesPhase;
  /** Room time the current phase changes (break end, first round), or null. */
  phaseEndsAt: number | null;
  dogRound: boolean;
  /** Zombies (or dogs) left this round, alive + queued. */
  left: number;
  solo: boolean;
  players: ZombiesPlayerInfo[];
  /** Room time Insta-Kill / Double Points run out (0 = off). */
  insta: number;
  double: number;
  /** Ids of hellhound bodies (the client draws them as dogs). */
  dogs: string[];
  /** Quick Revive solo purchases left. */
  soloLives: number;
  /** Highest round reached at game over (null while playing). */
  survived: number | null;
}

export type ZombiesEventKind = 'round_start' | 'round_end' | 'dog_round' | 'powerup' | 'perk' | 'buy' | 'ammo' | 'box' | 'teddy' | 'box_move' | 'down' | 'revived' | 'bleedout' | 'game_over' | 'points' | 'nope' | 'board';

/** `zombies.event`: announcer lines, point popups, stingers. */
export interface ZombiesEventPayload {
  kind: ZombiesEventKind;
  /** Player id the event is about (buys, downs, points). */
  player?: string;
  text?: string;
  /** Points delta for `points` popups. */
  amount?: number;
  round?: number;
  id?: string;
  at?: Vec3;
}

declare module '../protocol' {
  interface FeatureMessages {
    'zombies.state': ZombiesStatePayload;
    'zombies.event': ZombiesEventPayload;
  }
  interface RpcMap {
    'zombies.solo': { req: { map?: string }; res: { roomId: string; code: string } };
    'zombies.coop': { req: { map?: string }; res: { roomId: string; code: string } };
  }
}
