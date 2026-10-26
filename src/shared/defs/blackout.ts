/**
 * Blackout (owner: blackout feature): a 100-player last-man-standing mode in the style of Black
 * Ops 4's Blackout. Everyone drops from a plane flying a random line over a big map stitched from
 * the classic maps, starts with a knife, loots guns, armour, heals, ammo and grenades from the
 * floor, and stays inside a shrinking circle. No respawns: the last one alive wins.
 *
 * Everything here is pure and shared, so the server's rules, the client's HUD and the tests agree:
 * tuning (`BLACKOUT`), the circle timeline (`buildCircles`, `circleState`), the plane's path
 * (`planePath`, `planeAt`), the drop physics parameters (`GLIDE`), loot rolls (`rollLoot`) and the
 * wire types (`blackout.state`, `blackout.placed`, `blackout.solo`). Server: src/server/features/
 * blackout/. Client: src/client/features/blackout/. See docs/features/blackout.md.
 */
import type { GlideParams } from '../movement';
import { rng } from '../math';
import { canAttach } from './attachments';
import { WEAPON_BY_ID, type WeaponClass, type WeaponDef } from './weapons';

export const BLACKOUT_MODE = 'blackout';

/** One shrink of the circle: wait (the circle holds), then shrink to `radius` over `shrink` seconds. */
export interface CirclePhaseDef {
  wait: number;
  shrink: number;
  /** Radius (m) of the circle at the end of this phase's shrink. */
  radius: number;
  /** Damage per second outside the circle while this phase runs. */
  dps: number;
}

export const BLACKOUT = {
  /** Humans + bots in a match. */
  players: 100,
  /** Results screen after the match (s). */
  postMatchSec: 15,
  plane: {
    /** Flight height above y = 0 (m). */
    altitude: 150,
    /** Ground speed (m/s): about 30 s to cross the island. */
    speed: 18,
    /** The line starts and ends this far inside the map's bounds (m). */
    inset: 20,
    /** Everyone still aboard is pushed out this long before the end of the line (s). */
    forceJumpBeforeEnd: 2,
    /** The doors open this long after the start: no jumping before (s). */
    doorsSec: 2,
  },
  /** The chute opens on its own this high above the ground (m). */
  deployHeight: 38,
  /** A manual pull (jump again in freefall) works only above this height (m). */
  minPullHeight: 8,
  /** Freefall horizontal speed is clamped to this when leaving the plane (m/s). */
  exitSpeed: 14,
  health: 100,
  /** No health regeneration: heals and armour matter (BO4 Blackout). */
  regen: false,
  armor: {
    /** Armour points per vest level (level 1-3). */
    perLevel: 50,
    /** Share of bullet / blast damage the armour takes while it lasts. */
    absorb: 0.65,
  },
  heals: {
    bandage: { heal: 25, sec: 2.5, max: 6 },
    medkit: { heal: 100, sec: 5, max: 2 },
  },
  /** Frag grenades carried at most. */
  maxFrags: 3,
  /** Circle: starts covering the whole map, shrinks in phases (~13 minutes). */
  circle: {
    phases: [
      { wait: 150, shrink: 75, radius: 210, dps: 1 },
      { wait: 90, shrink: 55, radius: 135, dps: 2 },
      { wait: 70, shrink: 45, radius: 85, dps: 4 },
      { wait: 60, shrink: 40, radius: 52, dps: 6 },
      { wait: 45, shrink: 30, radius: 30, dps: 9 },
      { wait: 40, shrink: 25, radius: 14, dps: 13 },
      { wait: 35, shrink: 25, radius: 0, dps: 20 },
    ] as readonly CirclePhaseDef[],
    /** Damage per second outside once the last circle has closed. */
    finalDps: 30,
    /** Storm damage is applied this often (s). */
    tickSec: 1,
  },
  /** Interest management: what a client hears about. */
  interest: {
    /** Players within this horizontal distance (m) of the viewer go in their snapshots (nearest first, at most `maxPlayers`). */
    playerRadius: 140,
    maxPlayers: 40,
    /** Loot and other entities within this distance (m). */
    entityRadius: 45,
    /** Entities that always go out wherever they are (the plane). */
    alwaysKinds: ['blackout_plane'] as readonly string[],
    /** Entities that never go out (Scavenger packs: nobody has perks in Blackout). */
    neverKinds: ['perks_pack'] as readonly string[],
  },
  /** Bot level of detail. */
  lod: {
    /** Bots this close to a human (m) think every tick, with real perception and hitscan. */
    nearDist: 120,
    /** Far bots re-plan this often (s). */
    farThinkSec: 0.5,
    /** Far bots "fight" each other inside this range (m), resolved statistically. */
    farFightRange: 32,
  },
  /** Loot spots get an item with this chance at match start. */
  lootChance: 0.82,
  /** Hard cap on loot entities in a room (dropped loot included; the oldest drops go first). */
  maxLoot: 1100,
} as const;

/** Drop physics per stage (sent to the client in `me.params.glide`, so prediction matches). */
export const GLIDE: Record<'plane' | 'freefall' | 'chute', GlideParams> = {
  plane: { gravity: 0, terminal: 0, speed: 0, accel: 0, brake: 0 },
  freefall: { gravity: 22, terminal: 44, speed: 16, accel: 10, brake: 0 },
  chute: { gravity: 14, terminal: 6, speed: 11, accel: 9, brake: 45 },
};

/** Where a player is in the drop. */
export type DropStage = 'plane' | 'freefall' | 'chute' | 'ground';

// ---------------------------------------------------------------------------------------------
// The circle
// ---------------------------------------------------------------------------------------------

export interface Circle {
  x: number;
  z: number;
  r: number;
}

/**
 * Circles for a match: `[0]` the starting circle (covering the map), `[k]` the circle after phase
 * k's shrink. Each next circle lies wholly inside the previous one; its centre is random (seeded),
 * and `accept(x, z)` (optional) can veto centres (e.g. over water). Pure and deterministic.
 */
export function buildCircles(seed: number, start: Circle, phases: readonly CirclePhaseDef[] = BLACKOUT.circle.phases, accept?: (x: number, z: number) => boolean): Circle[] {
  const r = rng(seed ^ 0x5bd1e995);
  const out: Circle[] = [{ ...start }];
  for (const ph of phases) {
    const prev = out[out.length - 1]!;
    const room = Math.max(0, prev.r - ph.radius);
    let best: Circle = { x: prev.x, z: prev.z, r: ph.radius };
    for (let tries = 0; tries < 24; tries++) {
      const a = r() * Math.PI * 2;
      // sqrt: uniform over the disc of allowed centres, kept a little off its rim.
      const d = Math.sqrt(r()) * room * 0.92;
      const c = { x: prev.x + Math.cos(a) * d, z: prev.z + Math.sin(a) * d, r: ph.radius };
      best = c;
      if (!accept || accept(c.x, c.z)) break;
    }
    out.push(best);
  }
  return out;
}

/** Start / end room times (relative to the match start) of each phase's wait and shrink. */
export function phaseTimes(phases: readonly CirclePhaseDef[] = BLACKOUT.circle.phases): { waitStart: number; shrinkStart: number; shrinkEnd: number }[] {
  let t = 0;
  return phases.map((p) => {
    const waitStart = t;
    const shrinkStart = t + p.wait;
    const shrinkEnd = shrinkStart + p.shrink;
    t = shrinkEnd;
    return { waitStart, shrinkStart, shrinkEnd };
  });
}

/** Seconds from the start until the last circle has closed. */
export const circlesTotalSec = (phases: readonly CirclePhaseDef[] = BLACKOUT.circle.phases) => phases.reduce((n, p) => n + p.wait + p.shrink, 0);

export interface CircleState {
  /** Phase index (0-based) running now; `phases.length` once the last circle has closed. */
  phase: number;
  stage: 'wait' | 'shrink' | 'closed';
  /** The safe zone now. */
  cur: Circle;
  /** Where it is going (null once closed). */
  next: Circle | null;
  /** Seconds since the start when this stage ends (null once closed). */
  endsAt: number | null;
  /** Damage per second outside the circle now. */
  dps: number;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** The circle at `t` seconds after the match start. */
export function circleState(circles: readonly Circle[], t: number, phases: readonly CirclePhaseDef[] = BLACKOUT.circle.phases, finalDps: number = BLACKOUT.circle.finalDps): CircleState {
  const times = phaseTimes(phases);
  for (let i = 0; i < phases.length; i++) {
    const tm = times[i]!;
    const from = circles[i]!;
    const to = circles[i + 1]!;
    if (t < tm.shrinkStart) return { phase: i, stage: 'wait', cur: { ...from }, next: { ...to }, endsAt: tm.shrinkStart, dps: phases[i]!.dps };
    if (t < tm.shrinkEnd) {
      const k = (t - tm.shrinkStart) / Math.max(1e-6, tm.shrinkEnd - tm.shrinkStart);
      return { phase: i, stage: 'shrink', cur: { x: lerp(from.x, to.x, k), z: lerp(from.z, to.z, k), r: lerp(from.r, to.r, k) }, next: { ...to }, endsAt: tm.shrinkEnd, dps: phases[i]!.dps };
    }
  }
  const last = circles[phases.length]!;
  return { phase: phases.length, stage: 'closed', cur: { ...last }, next: null, endsAt: null, dps: finalDps };
}

export const insideCircle = (c: Circle, x: number, z: number) => Math.hypot(x - c.x, z - c.z) <= c.r;

/** Distance (m) from a point to the circle's edge, positive outside. */
export const outsideBy = (c: Circle, x: number, z: number) => Math.hypot(x - c.x, z - c.z) - c.r;

// ---------------------------------------------------------------------------------------------
// The plane
// ---------------------------------------------------------------------------------------------

export interface PlanePath {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
  speed: number;
  /** Seconds to fly the whole line. */
  duration: number;
}

/**
 * A random straight line across the map (seeded): it enters on one side and leaves on the opposite
 * one, passing within a third of the half-size of the centre so that every part of the map is in
 * reach of a glide.
 */
export function planePath(seed: number, bounds: { min: { x: number; z: number }; max: { x: number; z: number } }, tune: { altitude: number; speed: number; inset: number } = BLACKOUT.plane): PlanePath {
  const r = rng(seed ^ 0x27d4eb2d);
  const cx = (bounds.min.x + bounds.max.x) / 2;
  const cz = (bounds.min.z + bounds.max.z) / 2;
  const hx = (bounds.max.x - bounds.min.x) / 2 - tune.inset;
  const hz = (bounds.max.z - bounds.min.z) / 2 - tune.inset;
  const a = r() * Math.PI * 2;
  const off = (r() * 2 - 1) * Math.min(hx, hz) * 0.33;
  // Direction of flight and the perpendicular offset of the line from the centre.
  const dx = Math.cos(a);
  const dz = Math.sin(a);
  const px = cx - dz * off;
  const pz = cz + dx * off;
  // Clip the infinite line to the inset box.
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const [o, d, lo, hi] of [[px, dx, cx - hx, cx + hx], [pz, dz, cz - hz, cz + hz]] as const) {
    if (Math.abs(d) < 1e-9) continue;
    const ta = (lo - o) / d;
    const tb = (hi - o) / d;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
  }
  const x0 = px + dx * t0;
  const z0 = pz + dz * t0;
  const x1 = px + dx * t1;
  const z1 = pz + dz * t1;
  const len = Math.hypot(x1 - x0, z1 - z0);
  return { x0, z0, x1, z1, y: tune.altitude, speed: tune.speed, duration: len / tune.speed };
}

/** The plane's position and heading `t` seconds into its flight (clamped to the line). */
export function planeAt(p: PlanePath, t: number): { x: number; y: number; z: number; yaw: number; vx: number; vz: number; k: number } {
  const k = Math.max(0, Math.min(1, t / Math.max(1e-6, p.duration)));
  const dx = (p.x1 - p.x0) / Math.max(1e-6, Math.hypot(p.x1 - p.x0, p.z1 - p.z0));
  const dz = (p.z1 - p.z0) / Math.max(1e-6, Math.hypot(p.x1 - p.x0, p.z1 - p.z0));
  return { x: lerp(p.x0, p.x1, k), y: p.y, z: lerp(p.z0, p.z1, k), yaw: Math.atan2(-dx, -dz), vx: dx * p.speed, vz: dz * p.speed, k };
}

/** Seconds into the flight when the plane is nearest to (x, z). */
export function planeTimeNearest(p: PlanePath, x: number, z: number): number {
  const lx = p.x1 - p.x0;
  const lz = p.z1 - p.z0;
  const l2 = Math.max(1e-6, lx * lx + lz * lz);
  const k = Math.max(0, Math.min(1, ((x - p.x0) * lx + (z - p.z0) * lz) / l2));
  return k * p.duration;
}

// ---------------------------------------------------------------------------------------------
// Placement and XP
// ---------------------------------------------------------------------------------------------

/** XP for a finishing place (progression `objective` event `blackout.placement`). */
export function placementXp(place: number): number {
  if (place <= 1) return 1500;
  if (place <= 5) return 600;
  if (place <= 10) return 400;
  if (place <= 25) return 200;
  if (place <= 50) return 100;
  return 50;
}

/** "#23 of 100" */
export const placeText = (place: number, of: number) => `#${place} OF ${of}`;

// ---------------------------------------------------------------------------------------------
// Loot
// ---------------------------------------------------------------------------------------------

export type Rarity = 'common' | 'rare' | 'legendary';
export const RARITY_COLOR: Record<Rarity, number> = { common: 0xd8d8d8, rare: 0x4f9cff, legendary: 0xffb020 };
export const RARITY_ATTACHMENTS: Record<Rarity, number> = { common: 0, rare: 1, legendary: 2 };

/** Ammo types (one per weapon class family). */
export type AmmoType = 'pistol' | 'smg' | 'rifle' | 'sniper' | 'shotgun';
export const AMMO_OF_CLASS: Record<WeaponClass, AmmoType | null> = { ar: 'rifle', lmg: 'rifle', smg: 'smg', sniper: 'sniper', shotgun: 'shotgun', pistol: 'pistol', machinepistol: 'pistol', launcher: null, special: null };
/** Rounds in an ammo box of each type. */
export const AMMO_BOX: Record<AmmoType, number> = { pistol: 24, smg: 60, rifle: 60, sniper: 10, shotgun: 12 };
export const AMMO_NAMES: Record<AmmoType, string> = { pistol: 'PISTOL AMMO', smg: 'SMG AMMO', rifle: 'RIFLE AMMO', sniper: 'SNIPER AMMO', shotgun: 'SHELLS' };

/** A loot item on the floor (not weapons: those are `pickups_weapon` drops). */
export type LootItem = { k: 'ammo'; t: AmmoType } | { k: 'armor'; l: 1 | 2 | 3 } | { k: 'bandage' } | { k: 'medkit' } | { k: 'frag' };

/** Entity kind of a non-weapon loot item. `s = { k, t?, l? }` (LootItem). */
export const LOOT_ENTITY = 'blackout_loot';
/** Entity kind of the plane (`s = { t0 }` path start time; the path comes in `blackout.state`). */
export const PLANE_ENTITY = 'blackout_plane';

/** Weapons that can lie on the floor, by rarity weight (launchers, the knife and wonder weapons excluded). */
export const LOOT_WEAPONS: readonly string[] = ['m16', 'famas', 'ak47', 'commando', 'galil', 'aug', 'acr', 'm16a4', 'mp5k', 'ak74u', 'mpl', 'rpk', 'l96a1', 'dragunov', 'intervention', 'olympia', 'stakeout', 'spas12', 'm1911', 'python', 'asp', 'm60', 'stoner63', 'hk21', 'rpd', 'm249', 'mg4', 'deagle', 'makarov', 'usp', 'mp5', 'ump45', 'vector', 'p90', 'spectre', 'uzi'];
/** The very rare wonder weapon spawn (a legendary roll can turn into it). */
export const LOOT_WONDER = 'raygun';
export const WONDER_CHANCE = 0.03;

export type LootRoll = { weapon: string; rarity: Rarity; attachments: string[] } | { item: LootItem };

/** Item table weights (a roll first picks weapon vs item). */
const ITEM_WEIGHTS: [LootItem, number][] = [
  [{ k: 'ammo', t: 'rifle' }, 7],
  [{ k: 'ammo', t: 'smg' }, 6],
  [{ k: 'ammo', t: 'pistol' }, 4],
  [{ k: 'ammo', t: 'shotgun' }, 3],
  [{ k: 'ammo', t: 'sniper' }, 2],
  [{ k: 'armor', l: 1 }, 5],
  [{ k: 'armor', l: 2 }, 2.5],
  [{ k: 'armor', l: 3 }, 0.8],
  [{ k: 'bandage' }, 6],
  [{ k: 'medkit' }, 2],
  [{ k: 'frag' }, 3],
];

function pick<T>(r: () => number, list: readonly [T, number][]): T {
  const total = list.reduce((n, [, w]) => n + w, 0);
  let x = r() * total;
  for (const [v, w] of list) {
    x -= w;
    if (x <= 0) return v;
  }
  return list[list.length - 1]![0];
}

export function rollRarity(r: () => number): Rarity {
  return pick<Rarity>(r, [['common', 60], ['rare', 30], ['legendary', 10]]);
}

/** Attachments for a weapon at a rarity (seeded): the first N the weapon accepts after a shuffle, never two optics. */
export function rollAttachments(def: WeaponDef, rarity: Rarity, r: () => number): string[] {
  const n = RARITY_ATTACHMENTS[rarity];
  if (!n || !def.attachments.length) return [];
  const pool = def.attachments.filter((a) => a !== 'gl' && a !== 'dual' && a !== 'akimbo');
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const out: string[] = [];
  for (const a of pool) {
    if (out.length >= n) break;
    if (canAttach(def, a, out, n)) out.push(a);
  }
  return out;
}

/** One loot spot's item: 45 % a weapon (with rarity), else an item. Deterministic for a given `r`. */
export function rollLoot(r: () => number): LootRoll {
  if (r() < 0.45) {
    const rarity = rollRarity(r);
    if (rarity === 'legendary' && r() < WONDER_CHANCE / 0.1) return { weapon: LOOT_WONDER, rarity, attachments: [] };
    const id = LOOT_WEAPONS[Math.floor(r() * LOOT_WEAPONS.length)]!;
    const def = WEAPON_BY_ID.get(id);
    return { weapon: id, rarity, attachments: def ? rollAttachments(def, rarity, r) : [] };
  }
  return { item: pick(r, ITEM_WEIGHTS) };
}

/** HUD / prompt name of an item. */
export function lootName(it: LootItem): string {
  switch (it.k) {
    case 'ammo':
      return AMMO_NAMES[it.t];
    case 'armor':
      return `ARMOR LV${it.l}`;
    case 'bandage':
      return 'BANDAGE';
    case 'medkit':
      return 'MED KIT';
    case 'frag':
      return 'FRAG';
  }
}

/** Rarity of a loot weapon from its attachment count (the `pickups_weapon` entity carries no rarity of its own). */
export const rarityOf = (attachments: number, weapon?: string): Rarity => (weapon === LOOT_WONDER || attachments >= 2 ? 'legendary' : attachments === 1 ? 'rare' : 'common');

// ---------------------------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------------------------

/** `blackout.state`: to each human, every 0.5 s and on change. */
export interface BlackoutStatePayload {
  /** Players still alive. */
  alive: number;
  /** Players who started. */
  total: number;
  /** Room time the match (and the circle timeline) started. */
  t0: number;
  /** Circle seed: the client rebuilds the circles with `buildCircles(seed, start)`. */
  seed: number;
  start: Circle;
  plane: PlanePath;
  /** Your stage in the drop. */
  stage: DropStage;
  armor: number;
  armorMax: number;
  bandages: number;
  medkits: number;
  /** Healing: room time it finishes (null = not healing). */
  healUntil: number | null;
  /** Your kills this match. */
  kills: number;
  /** Your place once you are out (or won). */
  place: number | null;
  /** Player id you are spectating (after death), or null. */
  watching: string | null;
}

/** `blackout.placed`: to a human when they are out or have won. */
export interface BlackoutPlacedPayload {
  place: number;
  of: number;
  kills: number;
  /** Seconds survived from the drop. */
  survived: number;
  killer: string | null;
  killerName: string | null;
  won: boolean;
  xp: number;
}

/** Results ext (`results.ext.blackout`): places by player id and the winner. */
export interface BlackoutResultsExt {
  places: Record<string, number>;
  winner: string | null;
  total: number;
}

declare module '../protocol' {
  interface FeatureMessages {
    'blackout.state': BlackoutStatePayload;
    'blackout.placed': BlackoutPlacedPayload;
    /** A pick-up note for the HUD ("+ ARMOR LV2"). */
    'blackout.picked': { text: string };
  }
  interface RpcMap {
    /** A private Blackout lobby that starts as soon as you join, bots filling it to 100. */
    'blackout.solo': { req: Record<string, never>; res: { roomId: string } };
    /** After death: watch someone else (next alive player after `after`, or the killer when omitted). */
    'blackout.spectate': { req: { next?: boolean }; res: { watching: string | null } };
  }
}
