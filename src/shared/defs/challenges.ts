/**
 * Challenges (owner: progression feature). Career, per game mode, per weapon (kills, headshots,
 * attachment kills, weapon class), per killstreak, and Pro perk challenges. Completing a tier awards
 * XP (and CoD Points for career / mode / class / killstreak challenges, as BO1 did). Progress lives
 * in `profile.challengeProgress[id]` (a number for the metric) and survives prestige.
 *
 * Most of the list is generated from the other registries (WEAPONS, ATTACHMENTS, KILLSTREAKS,
 * PERKS, MODES) so it grows as those owners fill their defs in. Other areas add their own:
 *
 *   - `registerChallenges(defs)` adds or replaces by id (call it from your feature's server setup
 *     AND client index so both sides see them), or
 *   - push an array / factory into `CHALLENGE_SOURCES` (folded lazily on first lookup), or
 *   - export `PERK_PRO_CHALLENGES: ChallengeDef[]` from defs/perks.ts: it is picked up
 *     automatically (looked up by name, so this file compiles without it) and replaces the
 *     generic Pro challenge of the same id.
 *
 * Metrics the progression server feeds (see docs/features/progression.md for the full list):
 * kills, headshots, assists, wins, matches, score, top3, mvp, longshots, pointblank, hipfire,
 * firstblood, revenge, comeback, buzzkill, multi2, multi3, killstreak (max), streak_earned and
 * `obj.<kind>` for mode objectives. Others may report any metric via the `progression.metric` event.
 */
import { MODES } from './modes';
import { KILLSTREAKS } from './killstreaks';
import * as perkDefs from './perks';
import { PERKS } from './perks';
import { ATTACHMENT_BY_ID } from './attachments';
import { WEAPONS, type WeaponClass } from './weapons';

/**
 * What a challenge counts. Core-tracked metrics come from match stats; features may add their own
 * metric strings (e.g. 'dom_captures') and increment them themselves.
 */
export type ChallengeMetric = 'kills' | 'headshots' | 'assists' | 'wins' | 'matches' | 'score' | 'killstreak' | 'longshots' | (string & {});

export type ChallengeCategory = 'career' | 'mode' | 'weapon' | 'killstreak' | 'perk';

export interface ChallengeDef {
  id: string;
  name: string;
  /** Description; `{n}` is replaced by the goal of the tier being shown. */
  description?: string;
  /** Only counts in this mode. */
  mode?: string;
  /** Only counts with this weapon (or killstreak id, for kills by killstreaks). */
  weapon?: string;
  metric: ChallengeMetric;
  /** Goal of the first tier. */
  goal: number;
  /** Goals for successive tiers (includes the first). */
  tiers?: number[];
  /** XP per tier (unless `xpTiers` gives each tier its own). */
  xp: number;
  codPoints?: number;

  // ---- progression extensions (all optional) ----
  category?: ChallengeCategory;
  /** Only counts with a weapon of this class. */
  weaponClass?: WeaponClass | (string & {});
  /** Only counts while this attachment is on the weapon used. */
  attachment?: string;
  /** Only counts with this perk equipped. */
  perk?: string;
  /** Only counts for this killstreak (streak_earned). */
  killstreak?: string;
  /** Only counts kills by this means ('melee', 'explosive', 'killstreak'...). */
  means?: string;
  /** 'sum' (default) adds each report; 'max' keeps the best single value (e.g. longest streak). */
  aggregate?: 'sum' | 'max';
  xpTiers?: number[];
  cpTiers?: number[];
  /** Unlock id granted when the first tier completes (e.g. 'pro:lightweight'). */
  grants?: string;
}

// ---------------------------------------------------------------------------------------------
// Pure progress rules
// ---------------------------------------------------------------------------------------------

export const tierGoals = (c: ChallengeDef): number[] => (c.tiers && c.tiers.length ? c.tiers : [c.goal]);

/** Tiers complete at `progress`. */
export function tiersDone(c: ChallengeDef, progress: number): number {
  let n = 0;
  for (const g of tierGoals(c)) {
    if (progress >= g) n++;
    else break;
  }
  return n;
}

export const tierXp = (c: ChallengeDef, i: number) => c.xpTiers?.[i] ?? c.xp;
export const tierCp = (c: ChallengeDef, i: number) => c.cpTiers?.[i] ?? c.codPoints ?? 0;

/** Goal of the tier being worked on (the last goal once all are done). */
export function currentGoal(c: ChallengeDef, progress: number): number {
  const g = tierGoals(c);
  return g[Math.min(tiersDone(c, progress), g.length - 1)]!;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const roman = (n: number) => ROMAN[n - 1] ?? String(n);

/** "Headhunter III" for tier index 2 of a multi-tier challenge, else the plain name. */
export function tierName(c: ChallengeDef, tierIndex: number): string {
  return tierGoals(c).length > 1 ? `${c.name} ${roman(tierIndex + 1)}` : c.name;
}

/** Description for a tier (index clamped), `{n}` filled in. */
export function describeChallenge(c: ChallengeDef, tierIndex: number): string {
  const g = tierGoals(c);
  const n = g[Math.max(0, Math.min(g.length - 1, tierIndex))]!;
  return (c.description ?? `${c.metric}: {n}`).replace(/\{n\}/g, n.toLocaleString('en-US'));
}

/** What the server knows about the action being reported, for challenge filters. */
export interface MetricContext {
  mode?: string;
  weapon?: string;
  weaponClass?: string;
  attachments?: readonly string[];
  perks?: readonly string[];
  killstreak?: string;
  means?: string;
}

export function challengeMatches(c: ChallengeDef, ctx: MetricContext): boolean {
  if (c.mode && c.mode !== ctx.mode) return false;
  if (c.weapon && c.weapon !== ctx.weapon) return false;
  if (c.weaponClass && c.weaponClass !== ctx.weaponClass) return false;
  if (c.attachment && !ctx.attachments?.includes(c.attachment)) return false;
  if (c.perk && !ctx.perks?.includes(c.perk)) return false;
  if (c.killstreak && c.killstreak !== ctx.killstreak) return false;
  if (c.means && c.means !== ctx.means) return false;
  return true;
}

export interface ChallengeAdvance {
  def: ChallengeDef;
  before: number;
  after: number;
  /** Tier indices (0-based) completed by this advance. */
  completed: number[];
  xp: number;
  codPoints: number;
}

/** Apply `amount` of a challenge's metric to a progress map in place. Null if nothing changed. */
export function advanceChallenge(progress: Record<string, number>, def: ChallengeDef, amount: number): ChallengeAdvance | null {
  if (!(amount > 0) || !Number.isFinite(amount)) return null;
  const before = progress[def.id] ?? 0;
  const after = def.aggregate === 'max' ? Math.max(before, amount) : before + amount;
  if (after === before) return null;
  progress[def.id] = after;
  const t0 = tiersDone(def, before);
  const t1 = tiersDone(def, after);
  const completed: number[] = [];
  let xp = 0;
  let codPoints = 0;
  for (let i = t0; i < t1; i++) {
    completed.push(i);
    xp += tierXp(def, i);
    codPoints += tierCp(def, i);
  }
  return { def, before, after, completed, xp, codPoints };
}

/** Report a metric: advances every matching challenge. */
export function progressMetric(progress: Record<string, number>, metric: string, amount: number, ctx: MetricContext): ChallengeAdvance[] {
  const out: ChallengeAdvance[] = [];
  for (const def of challengesForMetric(metric)) {
    if (!challengeMatches(def, ctx)) continue;
    const a = advanceChallenge(progress, def, amount);
    if (a) out.push(a);
  }
  return out;
}

/** Tiers complete / total over every challenge. */
export function challengeTotals(progress: Record<string, number>): { done: number; total: number; challengesDone: number; challenges: number } {
  let done = 0;
  let total = 0;
  let challengesDone = 0;
  const list = challengeList();
  for (const c of list) {
    const n = tierGoals(c).length;
    const d = tiersDone(c, progress[c.id] ?? 0);
    total += n;
    done += d;
    if (d >= n) challengesDone++;
  }
  return { done, total, challengesDone, challenges: list.length };
}

/** Whether the first tier of a challenge is complete. */
export const challengeComplete = (progress: Record<string, number>, id: string) => {
  const c = challengeById(id);
  return !!c && tiersDone(c, progress[id] ?? 0) > 0;
};

// ---------------------------------------------------------------------------------------------
// Authoring helpers
// ---------------------------------------------------------------------------------------------

type Ladder = { tiers: number[]; xp: number[]; cp?: number[] };

function make(id: string, name: string, description: string, metric: string, l: Ladder, extra: Partial<ChallengeDef> = {}): ChallengeDef {
  return {
    id,
    name,
    description,
    metric,
    goal: l.tiers[0]!,
    ...(l.tiers.length > 1 ? { tiers: l.tiers } : {}),
    xp: l.xp[0]!,
    ...(l.xp.length > 1 ? { xpTiers: l.xp } : {}),
    ...(l.cp ? { codPoints: l.cp[0]!, ...(l.cp.length > 1 ? { cpTiers: l.cp } : {}) } : {}),
    ...extra,
  };
}

const L = (tiers: number[], xp: number[], cp?: number[]): Ladder => ({ tiers, xp, cp });

const CLASS_NAMES: Record<string, string> = {
  ar: 'Assault Rifle',
  smg: 'Submachine Gun',
  lmg: 'Light Machine Gun',
  sniper: 'Sniper Rifle',
  shotgun: 'Shotgun',
  pistol: 'Pistol',
  launcher: 'Launcher',
  special: 'Special',
};

/** Killstreaks that never kill anyone directly: no "kills with" challenge for them. */
const NON_LETHAL_STREAKS = new Set(['uav', 'spy_plane', 'counter_uav', 'cuav', 'counteruav', 'blackbird', 'sr71', 'care_package', 'carepackage', 'supply_drop', 'sam', 'sam_turret', 'glitch']);

// ---------------------------------------------------------------------------------------------
// Career
// ---------------------------------------------------------------------------------------------

function careerChallenges(): ChallengeDef[] {
  const c = (id: string, name: string, desc: string, metric: string, l: Ladder, extra: Partial<ChallengeDef> = {}) => make(`career_${id}`, name, desc, metric, l, { category: 'career', ...extra });
  return [
    c('kills', 'Killer', 'Get {n} kills.', 'kills', L([100, 500, 1000, 2500, 5000, 10000], [500, 1500, 3000, 6000, 10000, 20000], [100, 250, 500, 1000, 2000, 4000])),
    c('headshots', 'Headhunter', 'Get {n} headshots.', 'headshots', L([25, 100, 250, 500, 1000], [500, 1500, 3000, 6000, 12000], [100, 250, 500, 1000, 2000])),
    c('assists', 'Wingman', 'Get {n} assists.', 'assists', L([25, 100, 500, 1000], [500, 1500, 4000, 8000], [50, 150, 400, 800])),
    c('wins', 'Winner', 'Win {n} matches.', 'wins', L([10, 50, 100, 250, 500], [1000, 2500, 5000, 10000, 20000], [250, 500, 1000, 2000, 4000])),
    c('matches', 'Veteran', 'Play {n} matches to the end.', 'matches', L([10, 50, 250, 500], [500, 2000, 6000, 12000], [100, 250, 750, 1500])),
    c('mvp', 'MVP', 'Finish {n} team matches at the top of the scoreboard.', 'mvp', L([5, 25, 100], [1000, 3000, 8000], [200, 500, 1500])),
    c('longshots', 'Long Distance', 'Get {n} long shot kills (35 m or more).', 'longshots', L([10, 50, 150, 500], [500, 1500, 3000, 6000], [50, 150, 300, 600])),
    c('pointblank', 'Point Blank', 'Get {n} kills from 3 m or closer.', 'pointblank', L([10, 50, 250], [500, 1500, 4000], [50, 150, 400])),
    c('hipfire', 'Hip Shot', 'Get {n} kills without aiming down sights.', 'hipfire', L([25, 100, 500], [500, 1500, 5000], [50, 150, 500])),
    c('firstblood', 'First Blood', 'Get first blood in a match (x{n}).', 'firstblood', L([1, 10, 50], [500, 2000, 5000], [50, 200, 500])),
    c('revenge', 'Revenge', 'Kill {n} enemies who just killed you.', 'revenge', L([5, 25, 100], [500, 1500, 4000], [50, 150, 400])),
    c('comeback', 'Comeback', 'Get a kill after dying 3 times in a row, {n} times.', 'comeback', L([5, 25, 100], [500, 1500, 4000], [50, 150, 400])),
    c('buzzkill', 'Buzzkill', 'End {n} enemy killstreaks of 3 or more.', 'buzzkill', L([5, 25, 100], [500, 1500, 4000], [50, 150, 400])),
    c('double', 'Double Kill', 'Get {n} double kills.', 'multi2', L([5, 25, 100], [500, 1500, 4000], [50, 150, 400])),
    c('triple', 'Triple Kill', 'Get triple kills or better (x{n}).', 'multi3', L([1, 10, 50], [1000, 3000, 6000], [100, 300, 600])),
    c('streak', 'Bloodthirsty', 'Get a {n} kill streak.', 'killstreak', L([5, 10, 15, 20, 25], [500, 1500, 3000, 6000, 10000], [50, 150, 300, 600, 1000]), { aggregate: 'max' }),
    c('streaks_earned', 'Rewarded', 'Earn {n} killstreak rewards.', 'streak_earned', L([5, 25, 100, 250], [500, 1500, 4000, 8000], [50, 150, 400, 800])),
    c('streak_kills', 'Air Support', 'Get {n} kills with killstreaks.', 'kills', L([10, 50, 250], [500, 1500, 5000], [50, 150, 500]), { means: 'killstreak' }),
    c('melee', 'Backstabber', 'Get {n} melee kills.', 'kills', L([10, 50, 250], [500, 1500, 5000], [50, 150, 500]), { means: 'melee' }),
    c('explosive', 'Demolitions', 'Get {n} explosive kills.', 'kills', L([10, 50, 250], [500, 1500, 5000], [50, 150, 500]), { means: 'explosive' }),
    c('score', 'Career Man', 'Score {n} points in matches.', 'score', L([10000, 50000, 250000, 1000000], [1000, 3000, 8000, 20000], [100, 300, 800, 2000])),
  ];
}

// ---------------------------------------------------------------------------------------------
// Per game mode (generated for every mode in MODES; objective templates per mode id)
// ---------------------------------------------------------------------------------------------

interface ModeTemplate {
  key: string;
  name: string;
  /** `{mode}` = mode name, `{n}` = goal. */
  desc: string;
  metric: string;
  ladder: Ladder;
  extra?: Partial<ChallengeDef>;
}

/** Objective / mode-specific challenges by mode id (TDM, FFA, DOM, S&D, HQ, KC and the wagers). */
export const MODE_CHALLENGE_TEMPLATES: Record<string, ModeTemplate[]> = {
  tdm: [
    { key: 'headshots', name: 'TDM Headhunter', desc: 'Get {n} headshots in {mode}.', metric: 'headshots', ladder: L([50, 250, 1000], [1000, 3000, 8000], [100, 300, 800]) },
    { key: 'streak', name: 'TDM Rampage', desc: 'Get a {n} kill streak in {mode}.', metric: 'killstreak', ladder: L([7, 11, 15], [1000, 2500, 5000], [100, 250, 500]), extra: { aggregate: 'max' } },
  ],
  ffa: [
    { key: 'headshots', name: 'Lone Headhunter', desc: 'Get {n} headshots in {mode}.', metric: 'headshots', ladder: L([50, 250, 1000], [1000, 3000, 8000], [100, 300, 800]) },
    { key: 'streak', name: 'Lone Wolf', desc: 'Get a {n} kill streak in {mode}.', metric: 'killstreak', ladder: L([5, 10, 15], [1000, 2500, 5000], [100, 250, 500]), extra: { aggregate: 'max' } },
  ],
  dom: [
    { key: 'captures', name: 'Flag Runner', desc: 'Capture {n} flags in {mode}.', metric: 'obj.capture', ladder: L([10, 50, 250, 1000], [1000, 2500, 6000, 15000], [100, 250, 600, 1500]) },
    { key: 'defends', name: 'Flag Defender', desc: 'Kill {n} enemies near a flag your team holds.', metric: 'obj.defend', ladder: L([10, 50, 250, 1000], [1000, 2500, 6000, 15000], [100, 250, 600, 1500]) },
    { key: 'neutralize', name: 'Neutralizer', desc: 'Neutralize {n} enemy flags in {mode}.', metric: 'obj.neutralize', ladder: L([10, 50, 250], [1000, 2500, 6000], [100, 250, 600]) },
  ],
  sd: [
    { key: 'plants', name: 'Bomber', desc: 'Plant the bomb {n} times in {mode}.', metric: 'obj.plant', ladder: L([5, 25, 100], [1500, 4000, 10000], [150, 400, 1000]) },
    { key: 'defuses', name: 'Defuser', desc: 'Defuse the bomb {n} times in {mode}.', metric: 'obj.defuse', ladder: L([5, 25, 100], [1500, 4000, 10000], [150, 400, 1000]) },
    { key: 'carrier', name: 'Interceptor', desc: 'Kill {n} bomb carriers, planters or defusers.', metric: 'obj.carrier_kill', ladder: L([10, 50, 150], [1000, 3000, 6000], [100, 300, 600]) },
    { key: 'last_alive', name: 'Last Man Standing', desc: 'Be the last one alive on your team {n} times.', metric: 'obj.last_alive', ladder: L([5, 25, 100], [1000, 3000, 6000], [100, 300, 600]) },
  ],
  hq: [
    { key: 'captures', name: 'Headquarters Taker', desc: 'Capture {n} headquarters.', metric: 'obj.hq_capture', ladder: L([10, 50, 250], [1000, 3000, 8000], [100, 300, 800]) },
    { key: 'destroys', name: 'Wrecking Crew', desc: 'Destroy {n} enemy headquarters.', metric: 'obj.hq_destroy', ladder: L([10, 50, 250], [1000, 3000, 8000], [100, 300, 800]) },
    { key: 'defends', name: 'HQ Guard', desc: 'Kill {n} enemies while defending your headquarters.', metric: 'obj.hq_defend', ladder: L([25, 100, 500], [1000, 3000, 8000], [100, 300, 800]) },
  ],
  kc: [
    { key: 'confirms', name: 'Confirmed', desc: 'Confirm {n} kills by picking up enemy tags.', metric: 'obj.confirm', ladder: L([25, 100, 500, 1000], [1000, 2500, 6000, 12000], [100, 250, 600, 1200]) },
    { key: 'denies', name: 'Denied', desc: 'Deny {n} kills by picking up friendly tags.', metric: 'obj.deny', ladder: L([25, 100, 500], [1000, 2500, 6000], [100, 250, 600]) },
  ],
  oitc: [
    { key: 'survive', name: 'Survivor', desc: 'Outlast enemies {n} times in {mode}.', metric: 'obj.survive', ladder: L([5, 25, 100], [1000, 3000, 6000], [100, 300, 600]) },
    { key: 'melee', name: 'Pistol Whipped', desc: 'Get {n} melee kills in {mode}.', metric: 'kills', ladder: L([10, 50, 150], [1000, 2500, 5000], [100, 250, 500]), extra: { means: 'melee' } },
  ],
  gungame: [
    { key: 'promote', name: 'Moving Up', desc: 'Get promoted {n} times in {mode}.', metric: 'obj.promote', ladder: L([50, 250, 1000], [1000, 3000, 8000], [100, 300, 800]) },
    { key: 'humiliate', name: 'Humiliation', desc: 'Set back {n} enemies with melee kills in {mode}.', metric: 'obj.humiliate', ladder: L([5, 25, 100], [1000, 3000, 6000], [100, 300, 600]) },
  ],
  sharpshooter: [
    { key: 'headshots', name: 'Sharp Eye', desc: 'Get {n} headshots in {mode}.', metric: 'headshots', ladder: L([25, 100, 500], [1000, 3000, 8000], [100, 300, 800]) },
    { key: 'streak', name: 'Dead Eye', desc: 'Get a {n} kill streak in {mode}.', metric: 'killstreak', ladder: L([5, 10], [1500, 4000], [150, 400]), extra: { aggregate: 'max' } },
  ],
  sticks: [
    { key: 'bankrupt', name: 'Bankrupter', desc: 'Bankrupt {n} enemies in {mode}.', metric: 'obj.bankrupt', ladder: L([5, 25, 100], [1000, 3000, 6000], [100, 300, 600]) },
    { key: 'melee', name: 'Sticks and Stones', desc: 'Get {n} melee kills in {mode}.', metric: 'kills', ladder: L([10, 50, 150], [1000, 2500, 5000], [100, 250, 500]), extra: { means: 'melee' } },
  ],
};

function modeChallenges(): ChallengeDef[] {
  const out: ChallengeDef[] = [];
  for (const m of MODES) {
    const sub = (s: string) => s.replace(/\{mode\}/g, m.name);
    const x = (key: string, name: string, desc: string, metric: string, l: Ladder, extra: Partial<ChallengeDef> = {}) => out.push(make(`${m.id}_${key}`, name, sub(desc), metric, l, { category: 'mode', mode: m.id, ...extra }));
    const wager = !!m.wager || m.playlist === 'wager';
    x('wins', `${m.short} Victor`, wager ? 'Finish 1st in {n} {mode} matches.' : 'Win {n} {mode} matches.', 'wins', L([5, 25, 100, 250], [1000, 2500, 5000, 10000], [250, 500, 1000, 2000]));
    x('kills', `${m.short} Killer`, 'Get {n} kills in {mode}.', 'kills', L([50, 250, 1000, 2500], [500, 1500, 3000, 6000], [100, 250, 500, 1000]));
    x('matches', `${m.short} Regular`, 'Play {n} {mode} matches to the end.', 'matches', L([10, 50, 200], [500, 1500, 4000], [50, 150, 400]));
    if (m.teams) x('mvp', `${m.short} MVP`, 'Top the scoreboard in {n} {mode} matches.', 'mvp', L([5, 25, 100], [1000, 3000, 6000], [100, 300, 600]));
    else x('top3', wager ? 'In the Money' : `${m.short} Podium`, 'Finish in the top 3 of {n} {mode} matches.', 'top3', L([5, 25, 100], [1000, 3000, 6000], [150, 400, 1000]));
    for (const t of MODE_CHALLENGE_TEMPLATES[m.id] ?? []) x(t.key, t.name, t.desc, t.metric, t.ladder, t.extra);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Per weapon, per weapon class, per killstreak, Pro perks
// ---------------------------------------------------------------------------------------------

function weaponChallenges(): ChallengeDef[] {
  const out: ChallengeDef[] = [];
  const classes = new Set<string>();
  for (const w of WEAPONS) {
    classes.add(w.class);
    const base = { category: 'weapon' as const, weapon: w.id };
    out.push(make(`w_${w.id}_kills`, `${w.name} Marksman`, `Get {n} kills with the ${w.name}.`, 'kills', L([25, 100, 250, 500, 1000], [250, 500, 1000, 2500, 5000]), base));
    out.push(make(`w_${w.id}_headshots`, `${w.name} Headhunter`, `Get {n} headshots with the ${w.name}.`, 'headshots', L([10, 50, 150, 300], [500, 1000, 2500, 5000]), base));
    for (const a of w.attachments) {
      const att = ATTACHMENT_BY_ID.get(a);
      if (!att) continue;
      out.push(make(`w_${w.id}_${a}`, `${w.name} ${att.name}`, `Get {n} kills with the ${w.name} using the ${att.name}.`, 'kills', L([25, 100], [500, 1500]), { ...base, attachment: a }));
    }
  }
  for (const cls of classes) {
    const name = CLASS_NAMES[cls] ?? cls;
    out.push(make(`class_${cls}_kills`, `${name} Expert`, `Get {n} kills with ${name.toLowerCase()}s.`, 'kills', L([100, 500, 1000, 2500], [1000, 2500, 5000, 10000], [100, 250, 500, 1000]), { category: 'weapon', weaponClass: cls }));
  }
  return out;
}

function killstreakChallenges(): ChallengeDef[] {
  const out: ChallengeDef[] = [];
  for (const k of KILLSTREAKS) {
    out.push(make(`ks_${k.id}_earned`, `${k.name} Earned`, `Earn the ${k.name} {n} times.`, 'streak_earned', L([5, 25, 100], [500, 1500, 3000], [50, 150, 300]), { category: 'killstreak', killstreak: k.id }));
    if (!NON_LETHAL_STREAKS.has(k.id)) out.push(make(`ks_${k.id}_kills`, `${k.name} Kills`, `Get {n} kills with the ${k.name}.`, 'kills', L([10, 50, 150], [500, 1500, 3000], [50, 150, 300]), { category: 'killstreak', weapon: k.id }));
  }
  // Calling a Tactical Nuke (the killstreaks feature reports `streak_called` for every call).
  if (KILLSTREAKS.some((k) => k.id === 'nuke')) out.push(make('ks_nuke_called', 'End Game', 'Call in a Tactical Nuke {n} times.', 'streak_called', L([1, 5, 10], [5000, 10000, 25000], [500, 1000, 2500]), { category: 'killstreak', killstreak: 'nuke' }));
  return out;
}

/** A generic Pro challenge for every perk (the perks owner can replace each via PERK_PRO_CHALLENGES). */
function perkProChallenges(): ChallengeDef[] {
  return PERKS.map((p) =>
    make(p.pro.challenge, `${p.name} Pro`, `Get {n} kills with ${p.name} equipped. Unlocks ${p.name} Pro: ${p.pro.description}`, 'kills', L([50], [1500]), { category: 'perk', perk: p.id, grants: `pro:${p.id}` }),
  );
}

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

function buildOwn(): ChallengeDef[] {
  return [...careerChallenges(), ...modeChallenges(), ...weaponChallenges(), ...killstreakChallenges(), ...perkProChallenges()];
}

export const CHALLENGES: ChallengeDef[] = [];
const byId = new Map<string, ChallengeDef>();
export const CHALLENGE_BY_ID: ReadonlyMap<string, ChallengeDef> = byId;
let metricIndex: Map<string, ChallengeDef[]> | null = null;

for (const d of buildOwn()) {
  if (byId.has(d.id)) throw new Error(`duplicate challenge id: ${d.id}`);
  byId.set(d.id, d);
  CHALLENGES.push(d);
}

const isChallengeDef = (v: unknown): v is ChallengeDef => {
  const c = v as Partial<ChallengeDef> | null;
  return !!c && typeof c === 'object' && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.metric === 'string' && typeof c.goal === 'number' && typeof c.xp === 'number';
};

/** Add challenges; an existing id is replaced in place (keeps its position in the list). */
export function registerChallenges(defs: readonly ChallengeDef[]): void {
  for (const d of defs) {
    if (!isChallengeDef(d)) continue;
    const old = byId.get(d.id);
    byId.set(d.id, d);
    if (old) CHALLENGES[CHALLENGES.indexOf(old)] = d;
    else CHALLENGES.push(d);
  }
  metricIndex = null;
}

/** Other areas push arrays or factories here; folded in on the next lookup. */
export const CHALLENGE_SOURCES: (readonly ChallengeDef[] | (() => readonly ChallengeDef[]))[] = [];
let sourcesFolded = 0;
let perkFolded = false;
const PERK_PRO_KEY = 'PERK_PRO_CHALLENGES';

/**
 * PERK_PRO_CHALLENGES are owned by the perks feature (it counts their `perks.*` metrics and writes
 * challengeProgress itself), so progression only fills in the bookkeeping fields it reads:
 * category, the perk id, and the `pro:<perk>` unlock it grants.
 */
function withPerkProFields(d: ChallengeDef): ChallengeDef {
  const perk = PERKS.find((p) => p.pro.challenge === d.id);
  if (!perk) return d;
  return { ...d, category: d.category ?? 'perk', perk: d.perk ?? perk.id, grants: d.grants ?? `pro:${perk.id}` };
}

function ensureFolded(): void {
  if (!perkFolded) {
    try {
      // Looked up by a computed name so this compiles (and bundles) whether or not perks.ts exports it.
      const extra = (perkDefs as unknown as Record<string, unknown>)[PERK_PRO_KEY];
      perkFolded = true;
      if (Array.isArray(extra)) registerChallenges(extra.filter(isChallengeDef).map(withPerkProFields));
    } catch {
      // perks.ts still initialising (import cycle): try again on the next lookup.
    }
  }
  while (sourcesFolded < CHALLENGE_SOURCES.length) {
    const s = CHALLENGE_SOURCES[sourcesFolded++]!;
    try {
      registerChallenges(typeof s === 'function' ? s() : s);
    } catch (err) {
      console.error('[challenges] source failed', err);
    }
  }
}

/** Every challenge (with optional sources folded in). Prefer this over CHALLENGES. */
export function challengeList(): readonly ChallengeDef[] {
  ensureFolded();
  return CHALLENGES;
}

export function challengeById(id: string): ChallengeDef | undefined {
  ensureFolded();
  return byId.get(id);
}

/** Challenges counting a metric. */
export function challengesForMetric(metric: string): readonly ChallengeDef[] {
  ensureFolded();
  if (!metricIndex) {
    metricIndex = new Map();
    for (const c of CHALLENGES) {
      const l = metricIndex.get(c.metric);
      if (l) l.push(c);
      else metricIndex.set(c.metric, [c]);
    }
  }
  return metricIndex.get(metric) ?? [];
}
