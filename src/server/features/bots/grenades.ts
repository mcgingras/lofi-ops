/**
 * Bots' lethal grenades (pure, unit-tested): when to throw one, where it should land and how far
 * off the bot's arm is. Bots throw only after a fight, at the spot they last saw an enemy (to flush
 * them out of cover), never while trading shots. A BO1-strength frag kills inside 5 m, so the
 * tuning keeps them from spamming the player: a cooldown of 16-30 s, at most about a third of the
 * chances taken, a landing scatter of 3-6 m by skill, never at a spot so close the thrower would be
 * in the blast, and Recruit bots don't throw lethals at all.
 *
 * BO1's Combat Training bots (`maps/mp/gametypes/_bot.gsc` in the T5 dump): grenades are allowed
 * on every difficulty but Easy (`sv_botAllowGrenades` 0 there, 1 on Normal / Hard / Fu), with the
 * engine's `sv_botMinGrenadeTime` / `sv_botMaxGrenadeTime` (1.5-4 s) for the throw itself; the
 * decision of when to throw lives in the engine, so the frequency here is our own.
 */
import type { BotSkill } from '../../../shared/defs/bots';
import { EQUIPMENT_BY_ID, killRadius, NADE_PHYSICS } from '../../../shared/defs/equipment';

export const BOT_GRENADE = {
  /** Seconds after a spawn before the first throw. */
  spawnDelay: 6,
  /** Seconds after losing sight of the enemy the bot may throw (not instantly, not stale). */
  minAge: 0.6,
  maxAge: 3,
  /** Throw distance window (m); the near edge is the lethal's kill radius plus `safety`. */
  maxDist: 22,
  safety: 3,
  /** Teammates within this of the landing spot cancel the throw (m). */
  friendlyClear: 6,
  /** Chance to take a chance (checked every `retrySec`): base + aggression * per. */
  chanceBase: 0.08,
  chancePerAggression: 0.22,
  retrySec: 1.5,
  /** Cooldown after a throw: base + random * spread - aggression * fast (s). */
  cooldownBase: 22,
  cooldownSpread: 8,
  cooldownAggression: 6,
  /**
   * Landing scatter (m) = base + aimErrorDeg * perDeg: regular ~5.8 m, hardened ~4.1, veteran
   * ~3.1. Against the frag's 5.2 m kill radius a regular bot's grenade at a spot you stand still
   * on misses the kill about a fifth of the time, and you rarely stand still.
   */
  scatterBase: 2.5,
  scatterPerDeg: 0.5,
} as const;

/** Does a bot of this skill throw lethals? (BO1: not on Easy; here: Recruit-level aim, 8 degrees of error or more.) */
export function throwsLethals(skill: Pick<BotSkill, 'aimErrorDeg'>): boolean {
  return skill.aimErrorDeg < 8;
}

/** The closest a bot throws its lethal (so it is never inside its own blast). */
export function minThrowDistance(lethal: string | null | undefined): number {
  const def = lethal ? EQUIPMENT_BY_ID.get(lethal) : undefined;
  return Math.max(7, (def ? killRadius(def) : 0) + BOT_GRENADE.safety);
}

/** Chance a bot takes one throwing opportunity (0..1). */
export function grenadeChance(skill: Pick<BotSkill, 'aggression'>): number {
  return Math.min(0.5, BOT_GRENADE.chanceBase + skill.aggression * BOT_GRENADE.chancePerAggression);
}

/** Seconds until the next throw may happen after one (`r` in [0, 1)). */
export function grenadeCooldown(skill: Pick<BotSkill, 'aggression'>, r: number): number {
  return BOT_GRENADE.cooldownBase + r * BOT_GRENADE.cooldownSpread - skill.aggression * BOT_GRENADE.cooldownAggression;
}

/** Radius (m) the landing spot may be off by. */
export function grenadeScatter(skill: Pick<BotSkill, 'aimErrorDeg'>): number {
  return BOT_GRENADE.scatterBase + Math.max(0, skill.aimErrorDeg) * BOT_GRENADE.scatterPerDeg;
}

/** Where the bot actually aims: the target spot moved by up to `grenadeScatter` (uniform over the disc). */
export function grenadeAimPoint<T extends { x: number; y: number; z: number }>(at: T, skill: Pick<BotSkill, 'aimErrorDeg'>, rnd: () => number): T {
  const r = grenadeScatter(skill) * Math.sqrt(rnd());
  const a = rnd() * Math.PI * 2;
  return { ...at, x: at.x + Math.cos(a) * r, z: at.z + Math.sin(a) * r };
}

/**
 * Pitch (radians, up positive) that drops a thrown `equip` on a spot `flat` metres away and `dy`
 * below (negative) or above the hand, on the low arc, judged as the first bounce plus a little
 * roll. Throws use the server's `throwVelocity` (aim lifted by `loft`) and NADE_PHYSICS gravity.
 */
export function grenadePitch(equip: string, flat: number, dy: number): number {
  const def = EQUIPMENT_BY_ID.get(equip);
  const speed = def?.speed ?? 16;
  const loft = def?.loft ?? 0.2;
  const g = NADE_PHYSICS.gravity;
  // A frag rolls on after its first bounce: aim the first bounce a little short.
  const want = Math.max(1, flat * 0.85);
  const reach = (p: number): number => {
    const dx = Math.cos(p);
    const ly = Math.sin(p) + loft;
    const l = Math.hypot(dx, ly) || 1;
    const vh = (dx / l) * speed;
    const vy = (ly / l) * speed;
    // y(t) = vy t - g t^2 / 2 = dy  ->  the later root.
    const disc = vy * vy - 2 * g * dy;
    if (disc < 0) return 0;
    return (vh * (vy + Math.sqrt(disc))) / g;
  };
  let lo = -0.6;
  let hi = 0.6;
  if (reach(hi) <= want) return hi;
  if (reach(lo) >= want) return lo;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (reach(mid) < want) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
