/**
 * Launchers (owner: weapons feature): the secondary-slot launcher class. BO1's China Lake, RPG-7,
 * M72 LAW and Strela-3, and MW2's Stinger. Their `WeaponDef`s live in weapons.ts (class `launcher`,
 * slot `secondary`, `projectile: true`); this file holds what the projectiles do, tuned for
 * 100-health players, and the pure maths the server flies them with (the client reuses some for
 * its HUD and the bots for their aim).
 *
 * Kinds:
 * - `grenade` (China Lake): an arcing grenade. The first time it touches the world it bounces once;
 *   it goes off on the next touch, on its fuse, or at once on a player. A grenade whose first touch
 *   comes before it armed is a dud: it rattles about and fizzles.
 * - `rocket` (RPG-7, M72 LAW): flies nearly straight with a seeded drift (the RPG wanders more) and
 *   explodes on whatever it touches once armed; a slight drop over its life.
 * - `missile` (Strela-3, Stinger): air-only lock-on. Hold ADS on an enemy air killstreak inside the
 *   lock cone for `lock.sec` and the next shot homes in on it. Without a lock it flies dumb, with a
 *   small warhead, against anything.
 *
 * Safety (BO1 / MW2): nothing arms before `armDistance` metres of flight. A projectile that touches
 * something before that is a dud: on a player it does `impactDamage` (`means: 'impact'`) and stops,
 * on the world it drops without exploding. Splash hurts the shooter (core `radiusDamage`, `hitSelf`).
 *
 * Shooting down air killstreaks (the killstreaks feature's destructible hardware): a rocket or
 * missile touching an aircraft's hit sphere deals `airDamage` (x the shooter's
 * `killstreakDamageDealt`, Hardened Pro). A UAV / Counter-UAV (700 hp) falls to one rocket or
 * missile, an Attack Helicopter (1500) or a Chopper Gunner (2000) to two.
 */
import type { BlastProfile } from './equipment';

export type LauncherKind = 'grenade' | 'rocket' | 'missile';

export interface LauncherTuning {
  kind: LauncherKind;
  /** Launch speed (m/s). */
  speed: number;
  /** Downward pull (m/s²). Rockets barely drop; grenades arc. */
  gravity: number;
  /** Metres flown before it can explode. */
  armDistance: number;
  /** A dud hitting a player (`means: 'impact'`). */
  impactDamage: number;
  /** The explosion (core `radiusDamage`, BO1 rules: distance to the feet, linear falloff, cover). */
  blast: BlastProfile;
  /** A direct hit on an air killstreak's hit sphere (killstreak hit points). */
  airDamage: number;
  /** Seconds before it self-destructs (an armed one explodes where it is; an unarmed one fizzles). */
  life: number;
  /** Seeded wander off the launch line: amplitude (degrees) and rate (Hz). */
  drift?: { deg: number; hz: number };
  /** Grenades: bounce energy kept and the fuse from launch (s). */
  restitution?: number;
  fuse?: number;
  /** Missiles: the lock-on and the homing. */
  lock?: LockTuning;
}

export interface LockTuning {
  /** ADS on the target this long to lock (s). */
  sec: number;
  /** Half-angle of the lock cone around the view (degrees). */
  coneDeg: number;
  /** Farthest target (m). */
  range: number;
  /** Seconds the target may slip out of the cone (or behind cover) before the lock resets. */
  grace: number;
  /** How fast a homing missile turns (rad/s). */
  turnRate: number;
  /** Least ADS (0..1) that holds the lock. */
  ads: number;
}

export const LAUNCHERS: Record<string, LauncherTuning> = {
  // BO1 China Lake: a pump-action grenade launcher, two in the tube, loaded one at a time.
  china_lake: {
    kind: 'grenade',
    speed: 34,
    gravity: 12,
    armDistance: 8,
    impactDamage: 45,
    blast: { radius: 5.5, max: 175, min: 40 },
    airDamage: 400,
    life: 6,
    restitution: 0.45,
    fuse: 2.4,
  },
  // BO1 / MW2 RPG-7: the big warhead, unguided, wanders a little on its way.
  rpg: {
    kind: 'rocket',
    speed: 36,
    gravity: 1,
    armDistance: 10,
    impactDamage: 50,
    blast: { radius: 6.5, max: 300, min: 70 },
    airDamage: 1000,
    life: 4,
    drift: { deg: 1.6, hz: 1.3 },
  },
  // BO1 M72 LAW: lighter and quicker than the RPG, a faster and straighter rocket, a smaller blast.
  m72law: {
    kind: 'rocket',
    speed: 55,
    gravity: 0.5,
    armDistance: 10,
    impactDamage: 40,
    blast: { radius: 4.5, max: 220, min: 55 },
    airDamage: 800,
    life: 3.5,
    drift: { deg: 0.45, hz: 0.9 },
  },
  // BO1 Strela-3: air-only lock-on, homing missile; a weak dumb-fire warhead on the ground.
  strela: {
    kind: 'missile',
    speed: 42,
    gravity: 1,
    armDistance: 10,
    impactDamage: 50,
    blast: { radius: 3.5, max: 130, min: 30 },
    airDamage: 1100,
    life: 6,
    lock: { sec: 1.6, coneDeg: 7, range: 170, grace: 0.4, turnRate: 2.6, ads: 0.75 },
  },
  // MW2 Stinger: the same air-only lock-on, a quicker lock and a faster, tighter-turning missile,
  // but one spare instead of two.
  stinger: {
    kind: 'missile',
    speed: 50,
    gravity: 1,
    armDistance: 10,
    impactDamage: 50,
    blast: { radius: 3, max: 120, min: 30 },
    airDamage: 1100,
    life: 5,
    lock: { sec: 1.1, coneDeg: 6, range: 180, grace: 0.35, turnRate: 3.1, ads: 0.75 },
  },
};

export const LAUNCHER_IDS = Object.keys(LAUNCHERS);

/** Is this weapon id one of the secondary launchers (not the underbarrel `gl`)? */
export const isLauncher = (id: string | null | undefined): boolean => !!id && id in LAUNCHERS;
/** Does it lock on (Strela-3, Stinger)? */
export const isLockOn = (id: string | null | undefined): boolean => !!id && !!LAUNCHERS[id]?.lock;

/**
 * Entity kind of a launcher projectile in flight: `s.w` weapon id, `s.u` 1 when Pack-a-Punched,
 * `s.h` 1 while homing on a lock, `s.d` 1 for a dud (falling, never explodes), `s.c` 1 for a China
 * Beach cluster bomblet. The yaw follows the velocity; `s.p` is its pitch.
 */
export const LAUNCHER_ENTITY = 'weapons.rocket';

/** Bots: where launchers make sense (m). Never under `min` (their own blast), seldom past `max`. */
export const LAUNCHER_BOT = {
  china_lake: { min: 10, max: 38 },
  rpg: { min: 14, max: 70 },
  m72law: { min: 12, max: 80 },
  strela: { min: 14, max: 60 },
  stinger: { min: 14, max: 60 },
} as Record<string, { min: number; max: number }>;

// ---------------------------------------------------------------------------------------------
// Pure maths
// ---------------------------------------------------------------------------------------------

export interface V3 {
  x: number;
  y: number;
  z: number;
}

const DEG = Math.PI / 180;

/** Has a projectile that flew `traveled` metres armed? */
export const isArmed = (id: string, traveled: number): boolean => traveled >= (LAUNCHERS[id]?.armDistance ?? 0);

/**
 * The drift of a rocket `t` seconds into its flight: yaw / pitch offsets (radians) off the launch
 * line. A wobble at `hz` plus a slow pull to one side picked by the seed (0..1 values `a`, `b`),
 * both growing in over the first half second (it leaves the tube on the line you aimed).
 */
export function driftAngles(drift: { deg: number; hz: number } | undefined, t: number, a: number, b: number): { yaw: number; pitch: number } {
  if (!drift || t <= 0) return { yaw: 0, pitch: 0 };
  const grow = Math.min(1, t / 0.5);
  const amp = drift.deg * DEG * grow;
  const w = Math.PI * 2 * drift.hz * t;
  const side = a < 0.5 ? -1 : 1;
  const pull = Math.min(1, t / 1.5);
  return { yaw: amp * (0.55 * Math.sin(w + a * 6.283) + 0.45 * side * pull), pitch: amp * 0.5 * (0.6 * Math.sin(w * 0.7 + b * 6.283) + 0.4 * (b - 0.5) * 2 * pull) };
}

/** `d` (unit) turned by yaw / pitch offsets (radians), about world up and the local right axis. */
export function turnDir(d: V3, yaw: number, pitch: number): V3 {
  const h = Math.hypot(d.x, d.z);
  const curYaw = Math.atan2(-d.x, -d.z);
  const curPitch = Math.atan2(d.y, h);
  const y2 = curYaw + yaw;
  const p2 = Math.max(-1.55, Math.min(1.55, curPitch + pitch));
  const c = Math.cos(p2);
  return { x: -Math.sin(y2) * c, y: Math.sin(p2), z: -Math.cos(y2) * c };
}

/** Is `target` within `coneDeg` of the view `look` (unit) from `eye`, and within `range`? */
export function inLockCone(eye: V3, look: V3, target: V3, coneDeg: number, range: number): boolean {
  const dx = target.x - eye.x;
  const dy = target.y - eye.y;
  const dz = target.z - eye.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6 || d > range) return false;
  const cos = (dx * look.x + dy * look.y + dz * look.z) / d;
  return cos >= Math.cos(coneDeg * DEG);
}

/** Seconds to lock with this launcher (a packed Strela locks in half the time). */
export function lockSecOf(id: string, lockMult = 1): number {
  return (LAUNCHERS[id]?.lock?.sec ?? 0) * lockMult;
}

/** Lock progress 0..1 at room time `now` for a lock that started at `since`. */
export const lockProgress = (since: number, now: number, sec: number): number => (sec <= 0 ? 1 : Math.max(0, Math.min(1, (now - since) / sec)));

/**
 * Where to steer at a target moving at `tv` from a missile at `pos` flying at `speed`: the target's
 * position `t` seconds ahead, `t` being the straight-line time to it now (capped at 3 s).
 */
export function leadPoint(pos: V3, speed: number, target: V3, tv: V3): V3 {
  const d = Math.hypot(target.x - pos.x, target.y - pos.y, target.z - pos.z);
  const t = Math.min(3, d / Math.max(1, speed));
  return { x: target.x + tv.x * t, y: target.y + tv.y * t, z: target.z + tv.z * t };
}

/** Velocity `vel` turned toward `aim` (from `pos`) by at most `maxTurn` radians, speed kept. */
export function steerToward(vel: V3, pos: V3, aim: V3, maxTurn: number): V3 {
  const speed = Math.hypot(vel.x, vel.y, vel.z) || 1;
  const d = { x: vel.x / speed, y: vel.y / speed, z: vel.z / speed };
  const tx = aim.x - pos.x;
  const ty = aim.y - pos.y;
  const tz = aim.z - pos.z;
  const tl = Math.hypot(tx, ty, tz);
  if (tl < 1e-6) return { ...vel };
  const t = { x: tx / tl, y: ty / tl, z: tz / tl };
  const cos = Math.max(-1, Math.min(1, d.x * t.x + d.y * t.y + d.z * t.z));
  const ang = Math.acos(cos);
  if (ang <= maxTurn || ang < 1e-6) return { x: t.x * speed, y: t.y * speed, z: t.z * speed };
  // Slerp d -> t by maxTurn.
  const s = Math.sin(ang);
  const k1 = Math.sin(ang - maxTurn) / s;
  const k2 = Math.sin(maxTurn) / s;
  const n = { x: d.x * k1 + t.x * k2, y: d.y * k1 + t.y * k2, z: d.z * k1 + t.z * k2 };
  const nl = Math.hypot(n.x, n.y, n.z) || 1;
  return { x: (n.x / nl) * speed, y: (n.y / nl) * speed, z: (n.z / nl) * speed };
}

/**
 * The launch pitch (radians) that lobs a projectile at `speed` under `gravity` to a point `flat`
 * metres away and `dy` metres up: the low arc, or null out of reach. Bots aim the China Lake by it.
 */
export function lobPitch(speed: number, gravity: number, flat: number, dy: number): number | null {
  if (gravity <= 0) return Math.atan2(dy, flat);
  const v2 = speed * speed;
  const disc = v2 * v2 - gravity * (gravity * flat * flat + 2 * dy * v2);
  if (disc < 0) return null;
  return Math.atan((v2 - Math.sqrt(disc)) / (gravity * Math.max(0.01, flat)));
}

/** Directions of a China Beach cluster's bomblets: evenly round, thrown up and out (seeded spin `a` 0..1). */
export function clusterDirs(n: number, a: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + a * Math.PI * 2;
    const c = Math.cos(0.9);
    out.push({ x: Math.cos(ang) * c, y: Math.sin(0.9), z: Math.sin(ang) * c });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Wire
// ---------------------------------------------------------------------------------------------

declare module '../protocol' {
  interface FeatureMessages {
    /**
     * Your lock-on launcher's lock (Strela-3, Stinger), sent when it changes: `e` the air
     * killstreak entity being locked (null: none), `t` the room time the lock started, `sec` the
     * seconds it takes, `locked` once it holds (the next shot homes in). The HUD draws the box and
     * plays the seeking / locked tones.
     */
    'weapons.lock': { e: number | null; t: number; sec: number; locked: boolean };
  }
}
