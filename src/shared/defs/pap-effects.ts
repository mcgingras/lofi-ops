/**
 * Pack-a-Punch signature effects (owner: perks-streaks). Every packed gun gets one: a mechanic the
 * plain gun doesn't have, so each upgrade feels like a new gun rather than a bigger number. The
 * effect of a weapon is data on its `PAP_WEAPONS` row (`effect`, plus a menu one-liner
 * `effectText`); this file holds the effect kinds, their pure maths and the wire type. The server
 * applies them (killstreaks/streaks/packapunch-effects.ts), the client draws them
 * (client/features/killstreaks/packapunch-fx.ts).
 *
 * Kinds, by how they work:
 * - On a bullet's path (the `fire` event): `pierce` (through the first body into the next),
 *   `collateral` (through every body at full damage), `ricochet` (a bullet that stopped on a wall
 *   bounces once), `explosive` (a small blast where it stopped), `knockback` (close hits shove).
 * - On a hit (the `damage` event, bullets only): `burn` (damage over time, credited to the
 *   shooter; a repeat hit refreshes it), `venom` (poison that stacks: every hit adds `perHit`
 *   over `sec`, up to `maxStacks`, and restarts the clock), `mark` (outlined through walls for the shooter), `stagger` (heavy flinch), `zap`
 *   (a chance to arc to the nearest other enemy), `frost` (frozen solid if it didn't kill),
 *   `shatter` (the target takes more damage from everyone for a while).
 * - On a kill (the `death` event): `headblast` (a head kill bursts), `shockwave` (a pulse shoves
 *   and slows enemies around the body).
 * - In the def (`tweak`, so the client's prediction follows): `laser`, `akimbo`, `flechette`,
 *   `doubletap`.
 * - Extra weapon in the underbarrel slot (3 / D-pad down): `launcher` (`gl`: the grenade launcher;
 *   `masterkey`: a 4-shell underbarrel shotgun).
 * - `wonder`: light touches the wonder weapon behaviours read when the gun is packed.
 *
 * All numbers are tuned for 100-health players. Effect damage (burn, zap, headblast) is final: the
 * packed damage multiplier never scales it. Bullet damage the effects add (pierce, collateral,
 * ricochet) is bullet damage of the packed gun, so the multiplier does apply to it.
 */
import { rng, type Vec3 } from '../math';
import { WEAPON_BY_ID, type WeaponDef } from './weapons';

export type PapEffect =
  | { kind: 'explosive'; radius: number; max: number; min: number }
  | { kind: 'pierce'; bodies: number; keep: number }
  | { kind: 'collateral' }
  | { kind: 'launcher'; weapon: 'gl' | 'masterkey'; rounds: number }
  | { kind: 'burn'; damage: number; sec: number }
  | { kind: 'venom'; perHit: number; sec: number; maxStacks: number }
  | { kind: 'mark'; sec: number }
  | { kind: 'ricochet'; keep: number; range: number }
  | { kind: 'stagger'; kickDeg: number; botFlinch: number; botAimDeg: number; sec: number }
  | { kind: 'headblast'; radius: number; max: number; min: number }
  | { kind: 'zap'; chance: number; damage: number; range: number }
  | { kind: 'laser' }
  | { kind: 'akimbo' }
  | { kind: 'shockwave'; radius: number; push: number; slow: number; sec: number }
  | { kind: 'frost'; frozenSec: number }
  | { kind: 'shatter'; mult: number; sec: number }
  | { kind: 'knockback'; range: number; push: number; up: number; sec: number }
  | { kind: 'flechette' }
  | { kind: 'doubletap' }
  | { kind: 'wonder'; red?: boolean; hops?: number; radiusMult?: number; freezeAll?: boolean; shrinkR?: number; arcs?: number };

export type PapEffectKind = PapEffect['kind'];
export type PapEffectOf<K extends PapEffectKind> = Extract<PapEffect, { kind: K }>;

/** Shared timing. */
export const PAP_FX = {
  /** Burn damage lands in steps this long (s). */
  burnTick: 0.25,
  /** Ricochet: the bounce leaves the wall this far out (m), and only off walls it hit at least this steeply (cos of the angle to the normal). */
  ricochetLift: 0.02,
  /** Pierce / collateral: the most extra bodies a "collateral" bullet can go through. */
  collateralBodies: 8,
} as const;

/** Burn damage per tick (`PAP_FX.burnTick`) for a burn effect. */
export const burnPerTick = (e: PapEffectOf<'burn'>): number => (e.damage * PAP_FX.burnTick) / e.sec;

/** Venom damage per tick (`PAP_FX.burnTick`) with `stacks` doses in the target. */
export const venomPerTick = (e: PapEffectOf<'venom'>, stacks: number): number => (Math.max(0, Math.min(e.maxStacks, stacks)) * e.perHit * PAP_FX.burnTick) / e.sec;

/** How many extra bodies a path effect lets a bullet go through, and the damage kept for each (0 = none). */
export function pierceOf(e: PapEffect | null): { bodies: number; keep: number } {
  if (e?.kind === 'pierce') return { bodies: e.bodies, keep: e.keep };
  if (e?.kind === 'collateral') return { bodies: PAP_FX.collateralBodies, keep: 1 };
  return { bodies: 0, keep: 0 };
}

/** `d` reflected off a surface with unit normal `n`. */
export function reflect(d: Vec3, n: Vec3): Vec3 {
  const k = 2 * (d.x * n.x + d.y * n.y + d.z * n.z);
  return { x: d.x - k * n.x, y: d.y - k * n.y, z: d.z - k * n.z };
}

/**
 * Knockback impulse for a close shotgun hit: horizontal along the shot, scaled down linearly with
 * distance to nothing at `range`, plus a little lift. Null past the range.
 */
export function knockImpulse(e: PapEffectOf<'knockback'>, dir: Vec3, distance: number): Vec3 | null {
  if (distance >= e.range) return null;
  const k = 1 - Math.max(0, distance) / e.range;
  const l = Math.hypot(dir.x, dir.z) || 1;
  return { x: (dir.x / l) * e.push * k, y: e.up * k, z: (dir.z / l) * e.push * k };
}

/** Shockwave impulse: away from the body, full inside a third of the radius, falling to half at the edge. */
export function pulseImpulse(e: PapEffectOf<'shockwave'>, center: Vec3, at: Vec3): Vec3 | null {
  const dx = at.x - center.x;
  const dz = at.z - center.z;
  const d = Math.hypot(dx, dz);
  if (d > e.radius) return null;
  const k = d < e.radius / 3 ? 1 : 1 - 0.5 * ((d - e.radius / 3) / (e.radius * (2 / 3)));
  const ux = d > 1e-3 ? dx / d : 1;
  const uz = d > 1e-3 ? dz / d : 0;
  return { x: ux * e.push * k, y: 2.2 * k, z: uz * e.push * k };
}

/** A seeded roll source for chance effects (the chain zap): deterministic per seed. */
export const papRoller = (seed: number): (() => number) => rng(seed);

/** The underbarrel shotgun of the AUG-50M3 (BO1's Masterkey): 4 shells, no spares. Never in a class or the store. */
export const MASTERKEY_ID = 'masterkey';
export const MASTERKEY: WeaponDef = {
  id: MASTERKEY_ID,
  name: 'Masterkey',
  class: 'shotgun',
  slot: 'attachment',
  blurb: 'Underbarrel pump shotgun on the AUG-50M3. Four shells.',
  damage: { near: 20, far: 6, nearRange: 5, farRange: 12 },
  multipliers: { head: 1, torso: 1, limb: 1 },
  rpm: 80,
  mode: 'pump',
  pellets: 8,
  magazine: 4,
  reserve: 0,
  reloadMs: 2300,
  reloadEmptyMs: 2900,
  adsMs: 280,
  sprintOutMs: 250,
  moveMult: 0.95,
  spread: { hip: 6, ads: 4.5, move: 1 },
  recoil: { vertical: 4, horizontal: 1, recovery: 9 },
  unlockLevel: 99,
  attachments: [],
  model: 'stakeout',
  range: 35,
  swapMs: 350,
};
// Known by id (makeWeapon, the client's `Match.weapon()`, the killfeed name), but not a WEAPONS
// entry: no menu, store, challenge or bot loadout ever lists it.
if (!WEAPON_BY_ID.has(MASTERKEY_ID)) (WEAPON_BY_ID as Map<string, WeaponDef>).set(MASTERKEY_ID, MASTERKEY);

const r2 = (v: number) => Math.round(v * 100) / 100;
export const papV3 = (v: Vec3): [number, number, number] => [r2(v.x), r2(v.y), r2(v.z)];

/**
 * Effect pushes (`killstreaks.papFx`). Statuses carry the room time they end (`until`); the client
 * keeps the latest per player and kind.
 * - `burn` (everyone): `v` is on fire (flames on the body; the victim's screen edge glows orange).
 * - `venom` (everyone): `v` is poisoned with `n` doses (green bubbles; the victim's screen edge pulses green).
 * - `shatter` (everyone): `v`'s armour is broken (cracks on the body; the victim's screen cracks).
 * - `mark` (the shooter only): `v` is outlined through walls for you.
 * - `stagger` (the victim only): your aim kicks by `p` / `y` degrees.
 * - `pierce` (everyone): a bullet of `p` went on through bodies at `pts` (flattened xyz).
 * - `rico` (everyone): a bullet of `p` bounced off a wall at `a` and flew to `b`, hitting someone or not.
 * - `pulse` (everyone): a shockwave of radius `r` at a body.
 * - `knock` (everyone): `v` was shoved by a shotgun blast.
 * - `freeze` (everyone): `v` was frozen solid by a frost round.
 * - `headblast` (everyone): a head kill burst at x, y, z (radius `r`).
 */
export type PapFx =
  | { k: 'burn'; v: string; by: string; until: number }
  | { k: 'venom'; v: string; by: string; until: number; n: number }
  | { k: 'shatter'; v: string; by: string; until: number }
  | { k: 'mark'; v: string; until: number }
  | { k: 'stagger'; v: string; p: number; y: number }
  | { k: 'pierce'; p: string; pts: number[] }
  | { k: 'rico'; p: string; a: [number, number, number]; b: [number, number, number]; hit: boolean }
  | { k: 'pulse'; p: string; x: number; y: number; z: number; r: number }
  | { k: 'knock'; v: string; x: number; y: number; z: number }
  | { k: 'freeze'; v: string; x: number; y: number; z: number }
  | { k: 'headblast'; p: string; x: number; y: number; z: number; r: number };

declare module '../protocol' {
  interface FeatureMessages {
    /** A Pack-a-Punch signature effect (see `PapFx`). */
    'killstreaks.papFx': PapFx;
  }
}
