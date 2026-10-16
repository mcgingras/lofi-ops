/**
 * Hooks other areas use to steer bots, without depending on how brains work inside.
 *
 *   // modes feature (e.g. in its setup or a mode's rules.setup):
 *   import { registerBotGoal } from '../bots/hooks';
 *   registerBotGoal('dom', (room, bot) => {
 *     const flag = nearestFlagNotOwnedBy(room, bot.team);
 *     return flag ? { at: flag, radius: flag.radius, hold: true, priority: 0.6, label: `capture ${flag.id}` } : null;
 *   });
 *
 *   // killstreaks feature: how a bot uses an earned streak (default: press Buttons.STREAK once)
 *   registerBotStreakHandler((room, bot, streakId) => { callStreak(room, bot, streakId); return true; });
 *
 * Goal functions are asked whenever a bot plans where to go (every couple of seconds, never during
 * a gunfight). A bot follows the goal with a probability that grows with its `objectivePlay` and
 * the goal's `priority`, so low-skill bots still wander off and hunt.
 */
import type { Vec3 } from '../../../shared/math';
import type { BotSkill } from '../../../shared/defs/bots';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';

export interface BotGoal {
  /** Where to go (feet position; y is used to pick the right floor). */
  at: Vec3;
  /** Close enough when within this many metres (default 1.5). */
  radius?: number;
  /** Stay inside the radius once there (capture, defend, plant): crouch-walk around and watch. */
  hold?: boolean;
  /** 0..1: how much it matters right now (a planted bomb: 1). Default 0.5. */
  priority?: number;
  /** Sprint there even if the bot would rather walk. */
  sprint?: boolean;
  /** Buttons to hold while inside the radius (e.g. Buttons.USE to plant/defuse). */
  holdButtons?: number;
  /** Debug label. */
  label?: string;
}

export interface BotGoalContext {
  skill: BotSkill;
  /** Room time now. */
  now: number;
}

export type BotGoalFn = (room: Room, bot: PlayerState, ctx: BotGoalContext) => BotGoal | null;

const goalFns = new Map<string, BotGoalFn[]>();

/** Register an objective goal source for a mode id ('*' = every mode). Returns an unregister function. */
export function registerBotGoal(modeId: string, fn: BotGoalFn): () => void {
  const list = goalFns.get(modeId) ?? [];
  list.push(fn);
  goalFns.set(modeId, list);
  return () => {
    const l = goalFns.get(modeId);
    if (l) l.splice(l.indexOf(fn), 1);
  };
}

/** The best goal for a bot right now (highest priority among the mode's and '*' sources). */
export function botGoalFor(room: Room, bot: PlayerState, ctx: BotGoalContext): BotGoal | null {
  let best: BotGoal | null = null;
  for (const fn of [...(goalFns.get(room.mode.id) ?? []), ...(goalFns.get('*') ?? [])]) {
    let g: BotGoal | null = null;
    try {
      g = fn(room, bot, ctx);
    } catch (err) {
      room.log(`bot goal for ${room.mode.id} failed: ${String(err)}`);
    }
    if (g && (!best || (g.priority ?? 0.5) > (best.priority ?? 0.5))) best = g;
  }
  return best;
}

/** Use an earned killstreak. Return true if handled (the bot then won't press STREAK itself). */
export type BotStreakHandler = (room: Room, bot: PlayerState, streakId: string) => boolean;
let streakHandler: BotStreakHandler | null = null;

export function registerBotStreakHandler(fn: BotStreakHandler | null): void {
  streakHandler = fn;
}

export function botStreakHandler(): BotStreakHandler | null {
  return streakHandler;
}

/** Wager / special-rules flavour of a mode, as the bots understand it. */
export interface BotModeStyle {
  /** Every bullet counts (One in the Chamber): only fire steady and well aimed. */
  conserveAmmo: boolean;
  /** Go for melee when close (OITC knife, Sticks and Stones tomahawk/ballistic knife). */
  meleeHappy: boolean;
  /** Prefer rushing (gun game, sticks). */
  rush: boolean;
  /** In a fight, never close in and back away from a target inside ~7 m (Infected's Survivors). */
  kite?: boolean;
  /** Lob the lethal (a tomahawk) at a target in sight 6-18 m away, mid-fight (Infected). */
  throwAtRange?: boolean;
}

const styles = new Map<string, BotModeStyle>([
  ['oitc', { conserveAmmo: true, meleeHappy: true, rush: false }],
  ['gungame', { conserveAmmo: false, meleeHappy: true, rush: true }],
  ['sharpshooter', { conserveAmmo: false, meleeHappy: false, rush: false }],
  ['sticks', { conserveAmmo: true, meleeHappy: true, rush: true }],
]);

/** Override or add the bots' play style for a mode id (economy/modes may call this). */
export function registerBotModeStyle(modeId: string, style: Partial<BotModeStyle>): void {
  styles.set(modeId, { ...(styles.get(modeId) ?? { conserveAmmo: false, meleeHappy: false, rush: false }), ...style });
}

export function botModeStyle(modeId: string): BotModeStyle {
  return styles.get(modeId) ?? { conserveAmmo: false, meleeHappy: false, rush: false };
}

/** Per-bot flavour on top of the mode's (a mode whose players have different roles: Infected). */
export type BotStyleFn = (room: Room, bot: PlayerState) => Partial<BotModeStyle> | null;
const styleFns = new Map<string, BotStyleFn>();

/** Register (or replace, `null` removes) the per-bot style source for a mode id. */
export function registerBotStyle(modeId: string, fn: BotStyleFn | null): void {
  if (fn) styleFns.set(modeId, fn);
  else styleFns.delete(modeId);
}

/** The style a bot plays right now: its mode's, overridden by the mode's per-bot source. */
export function botStyleFor(room: Room, bot: PlayerState): BotModeStyle {
  const base = botModeStyle(room.mode.id);
  const fn = styleFns.get(room.mode.id);
  if (!fn) return base;
  let extra: Partial<BotModeStyle> | null = null;
  try {
    extra = fn(room, bot);
  } catch (err) {
    room.log(`bot style for ${room.mode.id} failed: ${String(err)}`);
  }
  return extra ? { ...base, ...extra } : base;
}
