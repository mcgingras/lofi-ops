/**
 * BO1 Zombies wonder weapons in multiplayer (owner: weapons feature; the guns themselves are
 * `wonder: true` entries in defs/weapons.ts). Only the Mystery Box killstreak hands them out
 * (defs/mystery-box.ts); dropped ones can be picked up like any gun and despawn sooner.
 *
 * Sources: the Call of Duty Wiki pages (Ray Gun, Thundergun, Wunderwaffe DG-2, Winter's Howl,
 * Scavenger, 31-79 JGb215, Wave Gun) and the T5 script dump (plutoniummod/t5-scripts
 * `ZM/Common/maps/_zombiemode_weap_thundergun.gsc`, `_tesla.gsc`, `_freezegun.gsc`, and the Shangri-La
 * / Moon `_zombiemode_weap_shrink_ray.gsc`, `_zombiemode_weap_microwavegun.gsc`). BO1 numbers are for zombies with thousands of health; here they
 * are retuned for 100-health players: strong and fun, never a kill from across the map.
 *
 * Pure tuning and maths, shared by the server behaviours, the client effects, bots and tests.
 */
import type { Vec3 } from '../math';

export const WONDER_WEAPON_IDS = ['raygun', 'thundergun', 'wunderwaffe', 'wintershowl', 'scavenger', 'babygun', 'wavegun'] as const;
export type WonderWeaponId = (typeof WONDER_WEAPON_IDS)[number];

/**
 * Ray Gun. BO1: a projectile, 1000 on a direct hit, 1500-300 splash that also hurts its user,
 * 20 + 160, 181 rpm. Here: a slow-ish glowing bolt (dodgeable at range), a direct hit kills, the
 * splash kills within ~1.3 m of the impact and fades to a scratch at 3.2 m; you take 20% of your
 * own splash (at most 32).
 */
export const RAYGUN = {
  /** Bolt speed (m/s) and lifetime (s): 50 m/s, gone after 2.4 s (120 m). */
  speed: 50,
  life: 2.4,
  /** Bolt hit radius against bodies (m): a fat bolt, so near misses still splash. */
  radius: 0.12,
  /** Direct hit damage (kills). */
  direct: 150,
  /** Splash: `max` at the centre to `min` at `r` (linear): 100+ (a kill) within ~1.3 m. */
  splash: { r: 3.2, max: 160, min: 15 },
  /** Fraction of the splash the shooter takes from their own bolt. */
  selfScale: 0.2,
} as const;

/** Ray Gun splash damage at `d` metres from the impact (0 beyond the radius). */
export function raygunSplash(d: number): number {
  const s = RAYGUN.splash;
  if (d > s.r) return 0;
  return s.max + (s.min - s.max) * Math.max(0, d) / s.r;
}

/**
 * Thundergun. BO1 (`_zombiemode_weap_thundergun.gsc`): everything whose centroid is within 1200
 * units ahead, inside a 180-unit cylinder around the view ray and traceable from the eye is hit;
 * within 480 units (12 m) it is flung (100-200 units/s away from you, always upward) and killed,
 * further out knocked down for 15. Here: a 12 m blast in a tube that widens from 1.2 m to 2.6 m
 * across, 150 (a kill) to 6.5 m falling to 60 at 12 m, a strong launch for everyone it hits, and a
 * light shove for 15 out to 20 m. Kills off an edge within `creditSec` of the blast are the
 * shooter's (the map's kill floor or bounds would otherwise get them).
 */
export const THUNDERGUN = {
  range: 12,
  /** Tube radius at the muzzle and at `range` (m). */
  r0: 1.2,
  r1: 2.6,
  /** 150 to `killRange`, then down to 60 at `range`. */
  near: 150,
  far: 60,
  killRange: 6.5,
  /** Past the blast: a shove and 15 damage out to `knockRange` (BO1's knockdown ring). */
  knockRange: 20,
  knockDamage: 15,
  /** Launch speeds (m/s): horizontal `near` close up falling to `far` at `range`, plus `up`. */
  launch: { near: 19, far: 11, up: 7, shove: 6, shoveUp: 3 },
  /** Seconds without control after a launch (the body keeps the impulse; MoveState.knock). */
  knockSec: 1.0,
  shoveSec: 0.45,
  /** A fall / out-of-bounds death this soon after a launch is credited to the shooter. */
  creditSec: 4,
} as const;

/** Radius of a widening blast tube at `along` metres from the muzzle. */
export const tubeRadius = (along: number, range: number, r0: number, r1: number) => r0 + (r1 - r0) * Math.max(0, Math.min(1, along / range));

/**
 * Is `p` inside a blast tube from `origin` along unit `dir`? (BO1's cylinder test: ahead of the
 * shooter, within `range`, and within the tube's radius of the view ray.) Returns how far along the
 * ray it is and how far off it, or null.
 */
export function inTube(origin: Vec3, dir: Vec3, p: Vec3, range: number, r0: number, r1: number): { along: number; off: number; dist: number } | null {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  const dz = p.z - origin.z;
  const along = dx * dir.x + dy * dir.y + dz * dir.z;
  if (along < 0 || along > range) return null;
  const off = Math.hypot(dx - dir.x * along, dy - dir.y * along, dz - dir.z * along);
  if (off > tubeRadius(along, range, r0, r1)) return null;
  return { along, off, dist: Math.hypot(dx, dy, dz) };
}

/** Thundergun damage at `d` metres (inside its range). */
export function thunderDamage(d: number): number {
  const t = THUNDERGUN;
  if (d <= t.killRange) return t.near;
  if (d >= t.range) return t.far;
  return t.near + (t.far - t.near) * ((d - t.killRange) / (t.range - t.killRange));
}

/**
 * The launch impulse for a body at `p` hit `d` metres away by a blast from `origin` along `dir`:
 * away from the shooter blended with the blast direction (BO1 adds the push away from the ray),
 * always upward, stronger up close.
 */
export function thunderLaunch(origin: Vec3, dir: Vec3, p: Vec3, d: number, range: number = THUNDERGUN.range): Vec3 {
  const t = THUNDERGUN.launch;
  let ax = p.x - origin.x;
  let az = p.z - origin.z;
  const al = Math.hypot(ax, az) || 1;
  ax = ax / al + dir.x;
  az = az / al + dir.z;
  const l = Math.hypot(ax, az) || 1;
  const k = Math.max(0, Math.min(1, d / range));
  const speed = t.near + (t.far - t.near) * k;
  return { x: (ax / l) * speed, y: t.up * (1.15 - 0.3 * k), z: (az / l) * speed };
}

/**
 * Wunderwaffe DG-2. BO1 (`_zombiemode_weap_tesla.gsc`): the bolt kills what it hits, then arcs to
 * enemies within 300 units of the last one (less 20 per arc), at most 5 arcs / 10 kills, with a
 * network frame between arcs. Here: lethal to the target and up to 2 more enemies, each within
 * 6 m of the previous one and in its line of sight; a bolt that hits the ground or a wall arcs to
 * an enemy within 2.5 m of the impact. Instant along a 45 m line (no cross-map kills).
 */
export const WUNDERWAFFE = {
  range: 45,
  damage: 200,
  /** Arcs after the first victim. */
  hops: 2,
  hopRange: 6,
  /** A world hit arcs to an enemy this close to the impact. */
  splashR: 2.5,
  /** Seconds between arcs (the bolt visibly jumps). */
  hopDelay: 0.12,
  /** Aim forgiveness: a body this close to the bolt's line counts as hit (m). */
  aimRadius: 0.35,
} as const;

/**
 * Pick the chain after `first`: repeatedly the nearest unvisited candidate within `range` of the
 * previous victim that `los(from, to)` allows, up to `hops`. Pure (positions are chest points).
 */
export function chainTargets<T extends { at: Vec3 }>(first: T, candidates: readonly T[], hops: number, range: number, los: (a: Vec3, b: Vec3) => boolean): T[] {
  const out: T[] = [];
  const used = new Set<T>([first]);
  let from = first;
  for (let i = 0; i < hops; i++) {
    let best: T | null = null;
    let bd = Infinity;
    for (const c of candidates) {
      if (used.has(c)) continue;
      const d = Math.hypot(c.at.x - from.at.x, c.at.y - from.at.y, c.at.z - from.at.z);
      if (d > range || d >= bd || !los(from.at, c.at)) continue;
      best = c;
      bd = d;
    }
    if (!best) break;
    out.push(best);
    used.add(best);
    from = best;
  }
  return out;
}

/**
 * Winter's Howl. BO1 (`_zombiemode_weap_freezegun.gsc`): a 600-unit cone (120-unit cylinder),
 * 1000 to 500 damage by distance; slowed zombies freeze and a frozen one shatters. Here: a wide
 * frost blast out to 19 m. Frost stacks: one blast inside 7 m freezes solid, out to 19 m it adds
 * 0.5 (two blasts freeze at any range). Frost takes the fight out of you as it builds: slower legs
 * and turning, a slower trigger (x1 to x0.35) and wilder spread (x1 to x3); frozen solid you cannot
 * move, turn, fire, aim down sights, throw or knife (bots stop dead). The next blast shatters a
 * frozen player (a kill). Frozen holds 2.5 s, then frost thaws at 0.5/s (from 1.5 s after the last
 * blast). Each blast also bites for 25.
 *
 * Plain numbers (no derived fields) so a generic upgrade (damage or magazine multiplier) can scale
 * the table: `damage` / `shatterDamage` are the damage, frost and reach are the behaviour.
 */
export const WINTERS_HOWL = {
  range: 19,
  /** Cone radius at the nozzle and at `range` (m): wide and forgiving. */
  r0: 0.9,
  r1: 3.0,
  damage: 25,
  /** Frost added: `frostNear` inside `nearRange` (freezes solid), falling to `frostFar` at `range`. */
  frostNear: 1,
  frostFar: 0.5,
  nearRange: 7,
  /** Frost thaws at `thaw` per second once `thawDelay` has passed since the last blast. */
  thawDelay: 1.5,
  thaw: 0.5,
  /** Frozen solid (frost >= 1) holds at least this long before thawing starts. */
  frozenSec: 2.5,
  /** Movement and turn multipliers: partial frost scales toward `slow`; frozen solid is `frozen`. */
  slow: { speed: 0.5, turn: 0.4 },
  frozen: { speed: 0, turn: 0 },
  /** Partial frost on the trigger: fire rate toward x`fireRate`, spread toward x`spread`. */
  suppress: { fireRate: 0.35, spread: 3 },
  shatterDamage: 400,
} as const;

/** Frost a Winter's Howl blast adds at `d` metres (0 beyond its range). */
export function frostAdded(d: number): number {
  const w = WINTERS_HOWL;
  if (d > w.range) return 0;
  if (d <= w.nearRange) return w.frostNear;
  return w.frostNear + (w.frostFar - w.frostNear) * ((d - w.nearRange) / (w.range - w.nearRange));
}

/** Movement / turn multipliers for a frost amount 0..1 (1 = frozen solid). */
export function frostSlow(frost: number): { speed: number; turn: number } {
  const w = WINTERS_HOWL;
  if (frost <= 0) return { speed: 1, turn: 1 };
  if (frost >= 1) return { ...w.frozen };
  return { speed: 1 - (1 - w.slow.speed) * frost, turn: 1 - (1 - w.slow.turn) * frost };
}

/**
 * What frost does to the trigger: fire rate and spread multipliers, and whether the hands work at
 * all (frozen solid: no fire, ADS, throw or knife).
 */
export function frostSuppress(frost: number): { fireRate: number; spread: number; hands: boolean } {
  const s = WINTERS_HOWL.suppress;
  if (frost >= 1) return { fireRate: s.fireRate, spread: s.spread, hands: false };
  const f = Math.max(0, frost);
  return { fireRate: 1 - (1 - s.fireRate) * f, spread: 1 + (s.spread - 1) * f, hands: true };
}

/** Blasts it takes to freeze someone solid at `d` metres (from no frost; Infinity out of range). */
export function blastsToFreeze(d: number, frostMultiplier = 1): number {
  const per = frostAdded(d) * frostMultiplier;
  return per > 0 ? Math.ceil(1 / per - 1e-9) : Infinity;
}

/**
 * Scavenger. BO1 (Call of the Dead): a bolt-action explosive sniper, 2 rounds a magazine; its bolt
 * sticks in whatever it hits and blows up a moment later with a huge blast. Here: a fast bolt
 * (140 m/s, a little drop) that dies after 0.5 s (70 m: no kills across the map). It sticks to
 * the world or a body (40 on impact) and goes off 1 s later: a direct-hit stick always kills whoever
 * carries it, and the blast (BO1 radius damage through core `radiusDamage`) kills inside ~4.5 m and
 * wounds out to 6.5 m, the shooter included.
 */
export const SCAVENGER = {
  speed: 140,
  gravity: 2.5,
  /** Seconds a bolt flies before it fizzles (speed x life = its reach). */
  life: 0.5,
  /** Body hit forgiveness around the bolt (m). */
  radius: 0.06,
  impact: 40,
  fuseSec: 1.0,
  /** Blast: radius (m), damage at the centre and at the edge (linear, BO1 radius damage). */
  blast: { r: 6.5, max: 250, min: 40 },
  /** Whoever the bolt is stuck in takes this on detonation (a kill through anything). */
  stuckDamage: 1000,
} as const;

/** Scavenger blast damage at `d` metres before exposure (0 beyond the radius). */
export function scavengerBlast(d: number): number {
  const b = SCAVENGER.blast;
  if (d > b.r) return 0;
  return b.max + (b.min - b.max) * Math.max(0, d) / b.r;
}

/**
 * 31-79 JGb215 (the Baby Gun). BO1 (Shangri-La): shrinks zombies, which squeak and can be kicked
 * to death, and grow back after a while. Here: an instant shrink beam out to 30 m (a body within
 * 0.45 m of the line counts, and anyone within 1.6 m of where it lands is caught too). Shrunk for
 * 6 s: you are drawn tiny, run x1.45, squeak, and your guns do a tenth of their damage; any hit on
 * you kills (bullets have to hit the tiny body: the legs box), and an enemy who walks into you
 * kicks you to death. A second Baby Gun shot on a shrunk player kills them.
 */
export const BABY_GUN = {
  range: 30,
  aimRadius: 0.45,
  splashR: 1.6,
  shrinkSec: 6,
  /** Shrunk: movement x`speed`, damage dealt x`damageDealt`, drawn at `scale`. */
  speed: 1.45,
  damageDealt: 0.1,
  scale: 0.45,
  /** An enemy this close (m, horizontal; `kickDy` height) kicks a shrunk player to death. */
  kickR: 0.75,
  kickDy: 1.0,
  /** What "any hit kills" deals. */
  killDamage: 2000,
} as const;

/**
 * Wave Gun (Zap Guns). BO1 (Moon): the dual-wield Zap Guns fire quick electric bolts; aiming down
 * sights snaps them together into the Wave Gun, a slow microwave shot that makes zombies swell
 * and burst. Here: hip fire alternates zap bolts from each pistol at 300 rpm, instant out to 35 m,
 * 34 each (three kill) and a small arc for 20 to one enemy within 2.5 m of the victim. Aimed, the
 * same trigger fires the Wave Gun at x0.2 the rate (60 rpm): out to 50 m, a body within 0.5 m of
 * the line swells for 0.7 s (slowed to x0.3, hands taken) and pops (a kill).
 */
export const WAVE_GUN = {
  zap: { range: 35, damage: 34, aimRadius: 0.25, arcR: 2.5, arcDamage: 20 },
  wave: { range: 50, aimRadius: 0.5, swellSec: 0.7, damage: 300, fireRate: 0.2, slow: 0.3 },
  /** ADS above this counts as aimed (the guns are together). */
  adsAt: 0.5,
} as const;

/**
 * Entity kinds: a Ray Gun bolt in flight; the frost on a player (`s.p` id, `s.f` amount); a
 * Scavenger bolt (`s.k` 1 once stuck, `s.p` the player it is stuck in, `s.f` room time it goes off,
 * `s.pt` pitch); a shrunk player (`s.p` id, `s.u` room time they grow back); a swelling player
 * (`s.p` id, `s.t` room time they pop).
 */
export const WONDER_ENTITY = { bolt: 'weapons.raybolt', frost: 'weapons.frost', scav: 'weapons.scavbolt', shrunk: 'weapons.shrunk', swell: 'weapons.swell' } as const;

/** Dropped wonder weapons despawn this soon (s; other guns: PICKUP.lifeSec). */
export const WONDER_DROP_LIFE_SEC = 20;

/**
 * One-shot effects for everyone (`weapons.wonderFx`): the Ray Gun's splash, the Thundergun's
 * blast, a lightning arc (one per hop), a frost blast and a shatter, the Scavenger's explosion, the
 * Baby Gun's beam and a kick, a zap bolt (`s` = which pistol: 0 right, 1 left), the Wave Gun's
 * beam and a pop. `p` = shooter id. `u` = a Pack-a-Punched look: the X2's splash is red, the Zeus
 * Cannon's blast and the Hyena's explosion scale by it.
 */
export type WonderFx =
  | { k: 'splash'; p: string; x: number; y: number; z: number; u?: 1 }
  | { k: 'blast'; p: string; o: [number, number, number]; d: [number, number, number]; u?: number }
  | { k: 'arc'; p: string; o: [number, number, number]; e: [number, number, number]; hop: number; hit: boolean }
  | { k: 'frost'; p: string; o: [number, number, number]; d: [number, number, number] }
  | { k: 'shatter'; p: string; v: string; x: number; y: number; z: number }
  | { k: 'fling'; v: string; x: number; y: number; z: number }
  | { k: 'boom'; p: string; x: number; y: number; z: number; u?: number }
  | { k: 'shrink'; p: string; o: [number, number, number]; e: [number, number, number]; hit: boolean }
  | { k: 'kick'; p: string | null; v: string; x: number; y: number; z: number }
  | { k: 'zap'; p: string; o: [number, number, number]; e: [number, number, number]; hit: boolean; s: number }
  | { k: 'wave'; p: string; o: [number, number, number]; e: [number, number, number]; hit: boolean }
  | { k: 'pop'; p: string | null; v: string; x: number; y: number; z: number };

declare module '../protocol' {
  interface FeatureMessages {
    /** A wonder weapon effect everyone draws (see `WonderFx`). */
    'weapons.wonderFx': WonderFx;
  }
}
