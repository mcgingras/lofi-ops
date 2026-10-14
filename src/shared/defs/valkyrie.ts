/**
 * Valkyrie Rockets (owner: perks-streaks), BO1's TV-guided missile (`m220_tow_mp`,
 * `maps/mp/_tvguidedmissile.gsc` and `maps/mp/_killstreak_weapons.gsc` in the T5 script dump; the
 * Call of Duty Wiki "Valkyrie Rockets" page for the weapon numbers):
 *
 * - The 7-kill streak is an air drop (`m220_tow_drop_mp`, `useKillstreakWeaponDrop`): you throw a
 *   supply drop marker and the Chinook drops a crate holding the launcher (`registerCrateType(
 *   "m220_tow_drop_mp", "killstreak", "m220_tow_mp", ...)`). A random Care Package can hold the
 *   launcher too. Taking the crate gives the launcher (`VALKYRIE_LAUNCHER` in the ready list).
 * - The launcher is a carried weapon (`useCarriedKillstreakWeapon`): one rocket loaded plus one
 *   spare (wiki: start ammo 1 + 1, 3 s reload). Firing launches a rocket and links your view to it
 *   (`LinkGuidedMissileCamera`) under the `tow_overlay` reticle and a grainy `tow_filter_overlay`;
 *   you steer it with look input, boost it, or detonate it with FIRE; it explodes on whatever it
 *   hits (7.5 m, 400 to 100 damage). Unboosted it flies 15 s, boosted 5 s.
 * - The first shot uses the streak (`removeUsedKillstreak`, the "inbound" team message and the
 *   `kls_tv_enemy` announcer line for the enemy); putting the launcher away before that keeps the
 *   streak; switching weapons after it, or dying, loses the spare rocket.
 * - Your body stays where it stood and can be killed. Dying does not blow the rocket up
 *   (`watchOwnerDeath` only detonates when you change teams): it flies on dead straight. Leaving
 *   the play area or climbing past `scr_guidedMissileMaxHeight` (4000 units) fuzzes the feed
 *   ("LOSING SIGNAL", fading to white) and detonates the rocket after 2 s (`outOfBoundsTime`);
 *   coming back fades the picture in over 1 s. Any hit over 5 damage destroys it (SAM Turrets lock
 *   on to it: `Target_Set`). After it explodes the camera holds there, white, for 1 s
 *   (`UnlinkCameraFromRocket`, `tow_filter_overlay_no_signal`), then you are back in your body.
 *
 * The flight maths here is pure and shared: the server flies the rocket with it and the client
 * predicts its own rocket with it (rocket cam), so the camera turns the frame you steer.
 */
import { clamp, viewDir, type AABB, type Vec3 } from '../math';

/** The ready-list id of the launcher itself (from the Valkyrie drop's crate or a Care Package). */
export const VALKYRIE_LAUNCHER = 'valkyrie_launcher';

export const VALKYRIE = {
  /** Rockets per launcher: one loaded, one spare (wiki: start ammo 1 + 1). */
  rockets: 2,
  /** Seconds to bring the launcher up before it can fire. */
  raiseSec: 0.6,
  /** Reload between the rockets (wiki: 3 s), from the moment you are back in your body. */
  reloadSec: 3,
  /** Cruise speed (m/s): slow, "requiring a significant amount of time to reach the altitude of Spy Planes". */
  speed: 14,
  /** Boosted speed (m/s) and how fast the motor gets there (m/s²). */
  boostSpeed: 32,
  accel: 45,
  /** Turn rate toward where you steer (rad/s): sluggish next to an RC-XD. Boosted it turns a little slower. */
  turnRate: 1.35,
  boostTurnRate: 1.05,
  /** How far the view may lead the rocket (rad): the client keeps your aim inside this cone round its nose. */
  lead: 0.45,
  /** Fuel (s): 15 s unboosted; boosting burns it three times as fast (5 s boosted, the wiki). */
  fuel: 15,
  boostBurn: 3,
  /** Out of the play area (map bounds plus this) or this far above the ground: the feed fades, then it blows. */
  boundsPad: 6,
  maxHeight: 100,
  outOfBoundsSec: 2,
  fadeInSec: 1,
  /** Blast (wiki: 7.5 m, 400 at the centre, 100 at the edge; Flak Jacket survives past ~2.85 m). */
  blast: { r: 7.5, max: 400, min: 100 },
  /** Any hit over 5 damage destroys it (`MissileDamageWatcher`). */
  hp: 5,
  /** Rocket body radius for hitting players and aircraft (m), and its hit sphere for bullets. */
  radius: 0.25,
  hitRadius: 0.6,
  /** Camera holds on the explosion this long (s), white, before you are back in your body. */
  holdSec: 1,
  /** Launch point: this far in front of the eye along the aim (pulled back inside walls). */
  muzzle: 0.7,
  /** Bots: aim time before they fire, and steering error at skill 0 (rad). */
  botAimSec: 0.8,
  botError: 0.3,
} as const;

/** One rocket in flight: position, unit direction, speed (m/s), fuel left (s), boosted. */
export interface RocketState {
  pos: Vec3;
  dir: Vec3;
  speed: number;
  fuel: number;
  boost: boolean;
}

/** A rocket leaving the launcher: from the eye along the aim, at cruise speed with a full tank. */
export function rocketLaunch(eye: Vec3, yaw: number, pitch: number, muzzle: number = VALKYRIE.muzzle): RocketState {
  const dir = viewDir(yaw, clamp(pitch, -1.5, 1.5));
  return { pos: { x: eye.x + dir.x * muzzle, y: eye.y + dir.y * muzzle, z: eye.z + dir.z * muzzle }, dir, speed: VALKYRIE.speed, fuel: VALKYRIE.fuel, boost: false };
}

/** Turn unit vector `cur` toward `want` by at most `maxAngle` radians (returns a unit vector). */
export function steerToward(cur: Vec3, want: Vec3, maxAngle: number): Vec3 {
  const wl = Math.hypot(want.x, want.y, want.z) || 1;
  const w = { x: want.x / wl, y: want.y / wl, z: want.z / wl };
  const dot = clamp(cur.x * w.x + cur.y * w.y + cur.z * w.z, -1, 1);
  const ang = Math.acos(dot);
  if (ang <= maxAngle || ang < 1e-6) return w;
  // Slerp by maxAngle along the great circle (falls back to any perpendicular when opposite).
  let px = w.x - cur.x * dot;
  let py = w.y - cur.y * dot;
  let pz = w.z - cur.z * dot;
  let pl = Math.hypot(px, py, pz);
  if (pl < 1e-6) {
    // Exactly behind: turn up (or sideways when pointing straight up/down).
    const up = Math.abs(cur.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const d2 = up.x * cur.x + up.y * cur.y + up.z * cur.z;
    px = up.x - cur.x * d2;
    py = up.y - cur.y * d2;
    pz = up.z - cur.z * d2;
    pl = Math.hypot(px, py, pz);
  }
  const c = Math.cos(maxAngle);
  const s = Math.sin(maxAngle);
  const v = { x: cur.x * c + (px / pl) * s, y: cur.y * c + (py / pl) * s, z: cur.z * c + (pz / pl) * s };
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

/**
 * One step of flight. `want` = where it is steered (unit-ish; null = nobody steering: dead
 * straight, as when its owner died). `boost` engages the boost (it stays on: BO1 has no brake).
 * Speed eases toward cruise or boost speed; fuel burns three times as fast boosted. Returns a new
 * state (the input is not changed). Collision is the caller's job (it knows the world).
 */
export function stepRocket(s: RocketState, want: Vec3 | null, boost: boolean, dt: number): RocketState {
  const boosted = s.boost || boost;
  const dir = want ? steerToward(s.dir, want, (boosted ? VALKYRIE.boostTurnRate : VALKYRIE.turnRate) * dt) : s.dir;
  const target = boosted ? VALKYRIE.boostSpeed : VALKYRIE.speed;
  const speed = s.speed < target ? Math.min(target, s.speed + VALKYRIE.accel * dt) : Math.max(target, s.speed - VALKYRIE.accel * dt);
  const step = ((s.speed + speed) / 2) * dt;
  return {
    pos: { x: s.pos.x + dir.x * step, y: s.pos.y + dir.y * step, z: s.pos.z + dir.z * step },
    dir,
    speed,
    fuel: s.fuel - dt * (boosted ? VALKYRIE.boostBurn : 1),
    boost: boosted,
  };
}

/** Yaw and pitch of a direction, any length (game convention: yaw 0 looks down -z, pitch up positive). */
export function dirAngles(d: Vec3): { yaw: number; pitch: number } {
  return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
}

/** Wrap an angle to (-PI, PI]. */
export const wrapAngle = (a: number) => {
  const w = ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return w === -Math.PI ? Math.PI : w;
};

/**
 * Keep the steering aim (view yaw/pitch) within `lead` radians of the rocket's nose, so mouse or
 * stick input past what the rocket can turn doesn't pile up: the client clamps its look to this
 * every frame while steering, and the camera shows the rocket's own heading.
 */
export function clampLead(dir: Vec3, yaw: number, pitch: number, lead: number = VALKYRIE.lead): { yaw: number; pitch: number } {
  const n = dirAngles(dir);
  const dy = clamp(wrapAngle(yaw - n.yaw), -lead, lead);
  const p = clamp(clamp(pitch - n.pitch, -lead, lead) + n.pitch, -1.5, 1.5);
  return { yaw: n.yaw + dy, pitch: p };
}

/**
 * Outside the play area: past the map bounds (plus `boundsPad`) or higher than `maxHeight` above
 * the ground level. BO1 checked its playable-area mesh and `scr_guidedMissileMaxHeight`.
 */
export function rocketOutOfBounds(pos: Vec3, bounds: AABB, groundY: number): boolean {
  const pad = VALKYRIE.boundsPad;
  return pos.x < bounds.min.x - pad || pos.x > bounds.max.x + pad || pos.z < bounds.min.z - pad || pos.z > bounds.max.z + pad || pos.y > groundY + VALKYRIE.maxHeight || pos.y < bounds.min.y - 4;
}

/**
 * The "no signal" white of the feed (0..1): rising over `outOfBoundsSec` while out of bounds
 * (`outFor` seconds so far), falling over `fadeInSec` after coming back (`backFor` seconds ago
 * from `from`, the white it had).
 */
export function signalWhite(outFor: number | null, backFor: number | null, from = 1): number {
  if (outFor !== null) return clamp(outFor / VALKYRIE.outOfBoundsSec, 0, 1);
  if (backFor !== null) return clamp(from * (1 - backFor / VALKYRIE.fadeInSec), 0, 1);
  return 0;
}
