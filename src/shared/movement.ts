/**
 * Deterministic player movement. The server runs `stepMove` for every input command it applies,
 * and the client runs the very same function to predict its own player, so both land on the same
 * numbers given the same inputs, params and world. Keep it pure: no Math.random, no clocks, no
 * reading anything but its arguments.
 *
 * Feel (DESIGN.md section 4): walk 5.0, sprint 7.2, ADS x0.6, crouch, prone crawl, jump 1.1 m,
 * step 0.45 m, 30% air control, gravity, ramps. Mantling (jump at a ledge, sill or low wall) and
 * prone (with the dolphin dive) follow BO1: docs/features/movement.md.
 */
import { CollisionWorld, playerHitboxes, topAt, type Hitboxes, type Solid, type Stance } from './collision';
import { MANTLE, MAX_SUBSTEP, MOVE, PLAYER, PRONE } from './constants';
import { Buttons, has } from './input';
import type { Vec3 } from './math';

/** A mantle in progress: the body follows from -> up -> to over `dur` seconds, input ignored. */
export interface MantleState {
  /** Seconds into the climb. */
  t: number;
  /** Seconds the climb takes. */
  dur: number;
  from: Vec3;
  /** Where the climb ends (feet). For a vault `over`, in the air just past the obstacle. */
  to: Vec3;
  /** Vaulting over a thin obstacle (you drop down the far side) rather than climbing onto it. */
  over: boolean;
}

export interface MoveState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  /** Crouched, or prone (a prone body is also `crouched`, so code that only knows crouch stays low). */
  crouched: boolean;
  sprinting: boolean;
  /** Aim-down-sights fraction 0..1. */
  ads: number;
  /** Seconds since sprinting stopped (0 while sprinting); weapons use it for sprint-out delay. */
  sinceSprint: number;
  /** Jump was held last step (jumping needs a fresh press). */
  jumpHeld: boolean;
  /** Prone: lying down (or on the way down). */
  prone: boolean;
  /** Stance transition 0 (up) .. 1 (fully prone): eye height, hitboxes, the weapon coming back up. */
  proneT: number;
  /** PRONE was held last step (going prone needs a fresh press, so a refused one doesn't fire later). */
  proneHeld: boolean;
  /** Dolphin dive: seconds left (0 = not diving). */
  dive: number;
  /** A mantle in progress, or null. */
  mantle: MantleState | null;
}

/**
 * Per-player movement parameters that come from the weapon in hand and modifiers (perks).
 * The server sends the current values to the owning client in every snapshot (`me.params`), so
 * prediction uses the same numbers.
 */
export interface MoveParams {
  /** Overall speed multiplier (weapon moveMult x speedMultiplier modifiers). */
  speed: number;
  /** Seconds to go from hip to full ADS (weapon adsMs x adsMultiplier). */
  adsTime: number;
  /** Speed multiplier at full ADS. */
  adsMove: number;
  /** Sprint speed multiplier (Marathon/Lightweight-style perks can raise it). */
  sprint: number;
  /** False while sprinting is not allowed (reloading with a perk-less weapon, mounted, ...). */
  canSprint: boolean;
  /** Jump height multiplier. */
  jump: number;
  /** False to freeze movement (pre-match, dead, spectating). Gravity still applies. */
  canMove: boolean;
  /** False for bodies that borrow player movement but can't climb or lie down (RC-XD, dogs). */
  canMantle?: boolean;
  canProne?: boolean;
}

export const DEFAULT_MOVE_PARAMS: MoveParams = { speed: 1, adsTime: 0.25, adsMove: MOVE.ads, sprint: 1, canSprint: true, jump: 1, canMove: true, canMantle: true, canProne: true };

export function createMoveState(x = 0, y = 0, z = 0): MoveState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, crouched: false, sprinting: false, ads: 0, sinceSprint: 10, jumpHeld: false, prone: false, proneT: 0, proneHeld: false, dive: 0, mantle: null };
}

export const copyMoveState = (s: MoveState): MoveState => ({ ...s, mantle: s.mantle ? { ...s.mantle, from: { ...s.mantle.from }, to: { ...s.mantle.to } } : null });

/** What stance reads need: `crouched`, plus the prone fields when the body can lie down. */
export type StanceState = Pick<MoveState, 'crouched'> & Partial<Pick<MoveState, 'prone' | 'proneT'>>;

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Movement box height. */
export const bodyHeight = (s: StanceState) => (s.prone ? PLAYER.proneHeight : s.crouched ? PLAYER.crouchHeight : PLAYER.height);

/** Eye height above the feet, easing through the prone transition. */
export function eyeHeight(s: StanceState): number {
  const base = s.crouched ? PLAYER.crouchEye : PLAYER.eye;
  const k = smooth(Math.max(0, Math.min(1, s.proneT ?? (s.prone ? 1 : 0))));
  return base + (PLAYER.proneEye - base) * k;
}

/** The stance hitboxes and others see: lying once the transition is past half way. */
export const stanceOf = (s: StanceState): Stance => ((s.proneT ?? (s.prone ? 1 : 0)) >= 0.5 ? 'prone' : s.crouched ? 'crouch' : 'stand');

/** A body's hitboxes now (feet at its position, lying along `yaw` when prone). */
export const moveHitboxes = (s: MoveState, yaw: number): Hitboxes => playerHitboxes(s, stanceOf(s), yaw);

/** Pose fields for lag compensation and replays: position, stance and facing. */
export const movePose = (s: MoveState, yaw: number) => ({ x: s.x, y: s.y, z: s.z, crouched: s.crouched, prone: stanceOf(s) === 'prone', yaw });

/** Fully prone (the accuracy bonus, the crawl bob). */
export const fullyProne = (s: StanceState) => !!s.prone && (s.proneT ?? 1) >= 1 - PRONE.fireReady;

/**
 * The weapon is down: mid-mantle, mid-dive, or in a stance transition to or from prone. The server
 * refuses shots while this holds and the client doesn't send them.
 */
export function moveBusy(s: Pick<MoveState, 'mantle' | 'dive' | 'prone' | 'proneT'>): boolean {
  if (s.mantle || s.dive > 0) return true;
  return s.prone ? s.proneT < 1 - PRONE.fireReady : s.proneT > PRONE.fireReady;
}

const EPS = 1e-4;
const scratch: Solid[] = [];

/**
 * Advance `s` (mutated in place and returned) by one input command. `dt` is split into sub-steps
 * of at most MAX_SUBSTEP so collisions stay stable at low frame rates.
 */
export function stepMove(world: CollisionWorld, s: MoveState, buttons: number, yaw: number, dt: number, params: MoveParams = DEFAULT_MOVE_PARAMS): MoveState {
  if (!(dt > 0)) return s;
  const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP - 1e-9));
  const h = dt / n;
  for (let i = 0; i < n; i++) substep(world, s, buttons, yaw, h, params);
  return s;
}

function substep(world: CollisionWorld, s: MoveState, buttons: number, yaw: number, h: number, p: MoveParams) {
  const r = PLAYER.radius;
  const move = p.canMove;
  const jumpDown = move && has(buttons, Buttons.JUMP);
  const proneDown = move && has(buttons, Buttons.PRONE);
  const adsHeld = move && has(buttons, Buttons.ADS);

  // A mantle in progress owns the body until it ends.
  if (s.mantle) {
    stepMantle(s, h, adsHeld, p);
    s.jumpHeld = jumpDown;
    s.proneHeld = proneDown;
    return;
  }

  // Wish direction from keys, relative to yaw (yaw 0 faces -z).
  let f = 0;
  let side = 0;
  if (move) {
    if (has(buttons, Buttons.FORWARD)) f += 1;
    if (has(buttons, Buttons.BACK)) f -= 1;
    if (has(buttons, Buttons.RIGHT)) side += 1;
    if (has(buttons, Buttons.LEFT)) side -= 1;
  }
  const wl = Math.hypot(f, side);
  if (wl > 1) {
    f /= wl;
    side /= wl;
  }

  // Stance. Prone: a fresh PRONE press lies down (on the ground, with room for the legs) or, while
  // sprinting, dives; letting go stands up, or crouches where only a crouch fits, or stays down
  // under low cover. Crouch: instant down; standing up needs headroom.
  const canProne = p.canProne !== false;
  const wantCrouch = move && (has(buttons, Buttons.CROUCH) || (proneDown && !s.prone));
  const jumpPress = jumpDown && !s.jumpHeld;
  if (s.dive > 0) s.dive = Math.max(0, s.dive - h);
  if (canProne && proneDown && !s.proneHeld && !s.prone) {
    if (s.sprinting && s.onGround) startDive(s, yaw);
    else if (s.onGround && legsClear(world, s.x, s.y, s.z, yaw)) {
      s.prone = true;
      s.crouched = true;
    }
  } else if (s.prone && s.dive <= 0 && (!proneDown || jumpPress)) {
    // Up: jump stands (it never jumps from prone); crouch held, or no room to stand, crouches.
    if ((jumpPress || !wantCrouch) && world.free(s.x, s.y, s.z, r, PLAYER.height)) {
      s.prone = false;
      s.crouched = false;
    } else if (world.free(s.x, s.y, s.z, r, PLAYER.crouchHeight)) {
      s.prone = false;
      s.crouched = true;
    }
  }
  s.proneHeld = proneDown;
  if (!s.prone) {
    if (wantCrouch && !s.crouched) s.crouched = true;
    else if (!wantCrouch && s.crouched && world.free(s.x, s.y, s.z, r, PLAYER.height)) s.crouched = false;
  }
  const proneRate = s.prone ? 1 / PRONE.downSec : 1 / (s.crouched ? PRONE.toCrouchSec : PRONE.upSec);
  if (s.prone) s.proneT = Math.min(1, s.proneT + proneRate * h);
  else s.proneT = Math.max(0, s.proneT - proneRate * h);
  const lowStance = s.prone || s.proneT > 0;

  // ADS and sprint (ADS cancels sprint; no sprint from a low stance or mid-dive).
  const sprint = move && p.canSprint && has(buttons, Buttons.SPRINT) && !adsHeld && f >= MOVE.sprintMinForward && !s.crouched && !lowStance && s.dive <= 0 && s.ads <= MOVE.sprintMaxAds && (s.onGround || s.sprinting);
  s.sprinting = sprint;
  s.sinceSprint = sprint ? 0 : s.sinceSprint + h;
  updateAds(s, adsHeld && !sprint, h, p);

  // Mantle: jump (a fresh press, or held while airborne) facing a ledge you can't step onto.
  if (jumpDown && f > 0 && p.canMantle !== false && !s.prone && s.proneT <= 0 && s.dive <= 0 && (jumpPress || !s.onGround)) {
    const plan = findMantle(world, s, yaw);
    if (plan) {
      startMantle(s, plan);
      s.jumpHeld = jumpDown;
      return;
    }
  }

  // Wish velocity.
  let speed = (sprint ? MOVE.sprint * p.sprint : MOVE.walk) * p.speed;
  if (lowStance) speed *= MOVE.prone;
  else if (s.crouched) speed *= MOVE.crouch;
  speed *= 1 + (p.adsMove - 1) * s.ads;
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const wx = (-sy * f + cy * side) * speed;
  const wz = (-cy * f - sy * side) * speed;

  // Accelerate towards it (full on the ground, 30% in the air and only with input). A dive keeps
  // its momentum: no control in the air, a slide along the ground.
  const hasInput = f !== 0 || side !== 0;
  if (s.dive > 0) {
    if (s.onGround) {
      const v = Math.hypot(s.vx, s.vz);
      const k = v > 1e-6 ? Math.max(0, v - PRONE.diveSlide * h) / v : 0;
      s.vx *= k;
      s.vz *= k;
    }
  } else if (s.onGround || hasInput) {
    const accel = MOVE.accel * (s.onGround ? 1 : MOVE.airControl) * h;
    const dvx = wx - s.vx;
    const dvz = wz - s.vz;
    const dl = Math.hypot(dvx, dvz);
    if (dl <= accel) {
      s.vx = wx;
      s.vz = wz;
    } else {
      s.vx += (dvx / dl) * accel;
      s.vz += (dvz / dl) * accel;
    }
  }

  // Jump (fresh press, on the ground; a crouched jump stands up first if it can).
  let jumped = false;
  if (jumpPress && s.onGround && !lowStance && s.dive <= 0) {
    if (s.crouched && world.free(s.x, s.y, s.z, r, PLAYER.height)) s.crouched = false;
    if (!s.crouched) {
      s.vy = Math.sqrt(2 * MOVE.gravity * MOVE.jumpHeight * p.jump);
      s.onGround = false;
      jumped = true;
    }
  }
  s.jumpHeld = jumpDown;

  const height = bodyHeight(s);
  const wasGround = s.onGround;
  const legsYaw = s.prone ? yaw : null;

  // Horizontal, one axis at a time, stepping up small ledges and ramps.
  moveAxis(world, s, 'x', s.vx * h, height, wasGround, legsYaw);
  moveAxis(world, s, 'z', s.vz * h, height, wasGround, legsYaw);

  // Vertical.
  if (!s.onGround || jumped) s.vy -= MOVE.gravity * h;
  else s.vy = 0;
  if (s.vy !== 0) {
    const startHits = world.overlapping(s.x, s.y, s.z, r, height, [] as Solid[]);
    const ny = s.y + s.vy * h;
    const hits = world.overlapping(s.x, ny, s.z, r, height, scratch).filter((b) => !startHits.includes(b));
    if (hits.length === 0) {
      s.y = ny;
      s.onGround = false;
    } else if (s.vy < 0) {
      let top = -Infinity;
      for (const b of hits) top = Math.max(top, topAt(b, s.x - r, s.x + r, s.z - r, s.z + r));
      s.y = Math.max(ny, top);
      s.vy = 0;
      s.onGround = true;
    } else {
      let bottom = Infinity;
      for (const b of hits) bottom = Math.min(bottom, b.min.y);
      s.y = Math.min(ny, bottom - height - EPS);
      s.vy = 0;
    }
  }

  // Ground snap: stay glued walking down ramps and steps; detect walking off a ledge.
  if (s.onGround && !jumped) {
    const g = world.groundBelow(s.x, s.z, s.y + EPS, PLAYER.stepHeight, r);
    if (g === null) {
      s.onGround = false;
    } else if (g < s.y) {
      s.y = g;
    }
  } else if (!s.onGround && s.vy <= 0) {
    const g = world.groundBelow(s.x, s.z, s.y + EPS, EPS * 4, r);
    if (g !== null) {
      s.y = Math.max(s.y, g);
      s.onGround = true;
      s.vy = 0;
    }
  }
}

function updateAds(s: MoveState, want: boolean, h: number, p: MoveParams) {
  const adsTarget = want ? 1 : 0;
  const adsRate = h / Math.max(0.01, p.adsTime);
  if (adsTarget > s.ads) s.ads = Math.min(1, s.ads + adsRate);
  else if (adsTarget < s.ads) s.ads = Math.max(0, s.ads - adsRate * 1.5);
}

function moveAxis(world: CollisionWorld, s: MoveState, axis: 'x' | 'z', delta: number, height: number, grounded: boolean, legsYaw: number | null) {
  if (delta === 0) return;
  const r = PLAYER.radius;
  const ox = s.x;
  const oz = s.z;
  const nx = axis === 'x' ? ox + delta : ox;
  const nz = axis === 'z' ? oz + delta : oz;
  const startHits = world.overlapping(ox, s.y, oz, r, height, [] as Solid[]);
  const hits = world.overlapping(nx, s.y, nz, r, height, [] as Solid[]).filter((b) => !startHits.includes(b));
  // A prone body's legs trail behind it: they stop at walls too (crawling backwards into one).
  let legsNow: Set<Solid> | undefined;
  const legsOk = (x: number, y: number, z: number) => legsYaw === null || legsClear(world, x, y, z, legsYaw, (legsNow ??= legSolids(world, ox, s.y, oz, legsYaw)));
  if (hits.length === 0 && legsOk(nx, s.y, nz)) {
    s.x = nx;
    s.z = nz;
    return;
  }
  // Step up: everything in the way is low enough and there's room above it.
  if (grounded && hits.length > 0) {
    let lift = 0;
    for (const b of hits) lift = Math.max(lift, topAt(b, nx - r, nx + r, nz - r, nz + r) - s.y);
    if (lift > 0 && lift <= PLAYER.stepHeight + EPS && world.overlapping(nx, s.y + lift + EPS, nz, r, height, [] as Solid[]).filter((b) => !startHits.includes(b)).length === 0 && legsOk(nx, s.y + lift + EPS, nz)) {
      s.x = nx;
      s.z = nz;
      s.y += lift + EPS;
      return;
    }
  }
  if (hits.length === 0) {
    // Only the legs are in the way: stay put on this axis.
    if (axis === 'x') s.vx = 0;
    else s.vz = 0;
    return;
  }
  // Blocked: stop flush against the nearest face.
  let pos = axis === 'x' ? nx : nz;
  for (const b of hits) {
    if (delta > 0) pos = Math.min(pos, (axis === 'x' ? b.min.x : b.min.z) - r - EPS);
    else pos = Math.max(pos, (axis === 'x' ? b.max.x : b.max.z) + r + EPS);
  }
  const o = axis === 'x' ? ox : oz;
  if (delta > 0) pos = Math.max(o, pos);
  else pos = Math.min(o, pos);
  if (axis === 'x') {
    s.x = pos;
    s.vx = 0;
  } else {
    s.z = pos;
    s.vz = 0;
  }
  if (!legsOk(s.x, s.y, s.z)) {
    if (axis === 'x') s.x = ox;
    else s.z = oz;
  }
}

// ---------------------------------------------------------------------------------------------
// Prone
// ---------------------------------------------------------------------------------------------

/** Leg sample points behind the eye (distance back along the facing) and their half width. */
const LEG_SAMPLES = [0.55, 0.95, 1.35] as const;
const LEG_R = 0.2;
/** Legs only meet walls: boxes from step height up (ramps and steps pass under them). */
const LEG_Y0 = PLAYER.stepHeight;
const LEG_H = 0.25;

function legBoxes(x: number, z: number, yaw: number): [number, number][] {
  const bx = Math.sin(yaw);
  const bz = Math.cos(yaw);
  return LEG_SAMPLES.map((a) => [x + bx * a, z + bz * a]);
}

/** Solids the legs touch now (so a body already lying against one isn't stuck to it). */
function legSolids(world: CollisionWorld, x: number, y: number, z: number, yaw: number): Set<Solid> {
  const out = new Set<Solid>();
  for (const [lx, lz] of legBoxes(x, z, yaw)) for (const b of world.overlapping(lx, y + LEG_Y0, lz, LEG_R, LEG_H, [] as Solid[])) if (!b.ramp) out.add(b);
  return out;
}

/** Room for the legs of a body lying at (x, y, z) facing `yaw` (ignoring solids in `except`). */
export function legsClear(world: CollisionWorld, x: number, y: number, z: number, yaw: number, except?: Set<Solid>): boolean {
  for (const [lx, lz] of legBoxes(x, z, yaw)) for (const b of world.overlapping(lx, y + LEG_Y0, lz, LEG_R, LEG_H, [] as Solid[])) if (!b.ramp && !except?.has(b)) return false;
  return true;
}

function startDive(s: MoveState, yaw: number) {
  const v = Math.hypot(s.vx, s.vz);
  const dx = v > 0.5 ? s.vx / v : -Math.sin(yaw);
  const dz = v > 0.5 ? s.vz / v : -Math.cos(yaw);
  s.prone = true;
  s.crouched = true;
  s.proneT = Math.max(s.proneT, 0.3);
  s.dive = PRONE.diveSec;
  s.sprinting = false;
  s.vx = dx * PRONE.diveSpeed;
  s.vz = dz * PRONE.diveSpeed;
  s.vy = PRONE.diveUp;
  s.onGround = false;
}

// ---------------------------------------------------------------------------------------------
// Mantle
// ---------------------------------------------------------------------------------------------

interface MantlePlan {
  to: Vec3;
  over: boolean;
  /** Crouched at the end (no room to stand there). */
  crouch: boolean;
}

/**
 * Entry/exit distances of a footprint centre moving from (x, z) along unit (dx, dz) into the box
 * grown by `r` in xz (touching faces don't count), or null if it never enters within `len`.
 */
function sweepBox(x: number, z: number, dx: number, dz: number, len: number, b: Solid, r: number): [number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const [o, d, lo, hi] of [[x, dx, b.min.x - r + EPS, b.max.x + r - EPS], [z, dz, b.min.z - r + EPS, b.max.z + r - EPS]] as const) {
    if (Math.abs(d) < 1e-12) {
      if (o <= lo || o >= hi) return null;
      continue;
    }
    let a = (lo - o) / d;
    let c = (hi - o) / d;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
  }
  if (t0 >= t1 || t1 <= 0 || t0 > len) return null;
  return [Math.max(0, t0), t1];
}

/** Is the path of a footprint from (x, z) to (tx, tz) free between heights y0 and y0 + h? */
function sweepFree(world: CollisionWorld, x: number, z: number, tx: number, tz: number, y0: number, h: number): boolean {
  const r = PLAYER.radius;
  const len = Math.hypot(tx - x, tz - z);
  const dx = len > 1e-9 ? (tx - x) / len : 0;
  const dz = len > 1e-9 ? (tz - z) / len : 0;
  for (const b of world.near(Math.min(x, tx) - r, Math.max(x, tx) + r, Math.min(z, tz) - r, Math.max(z, tz) + r, [] as Solid[])) {
    if (b.min.y >= y0 + h - EPS || b.max.y <= y0 + EPS) continue;
    if (b.ramp && topAt(b, Math.min(x, tx) - r, Math.max(x, tx) + r, Math.min(z, tz) - r, Math.max(z, tz) + r) <= y0 + EPS) continue;
    if (sweepBox(x, z, dx, dz, len, b, r)) return false;
  }
  return true;
}

/** Tags of brushes nothing may be climbed onto or over (bounds, out-of-bounds roofs). */
const NO_MANTLE_TAGS = new Set(['perimeter', 'roof', 'clip', 'glass']);

/**
 * Can the body climb something ahead? Looks along the facing for an obstacle within reach whose top
 * is above step height and at most MANTLE.maxHeight above the floor, with room to rise in place and
 * to move over it (MANTLE.clearance), then either a ledge to stand on (deep obstacles: crates,
 * walls you can stand on) or open space just past it (thin ones: window sills, low walls, rails).
 * Invisible player clips are never climbed (they mark where players must not go).
 */
function findMantle(world: CollisionWorld, s: MoveState, yaw: number): MantlePlan | null {
  const r = PLAYER.radius;
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);
  const floor = s.onGround ? s.y : (world.groundBelow(s.x, s.z, s.y + EPS, 60) ?? s.y);
  const lo = s.y + (s.onGround ? PLAYER.stepHeight : 0.05);
  const hi = floor + MANTLE.maxHeight;
  if (hi <= lo) return null;
  const far = MANTLE.reach + 2 * r + MANTLE.thin + 0.1;
  const cands: { T: number; d0: number; d1: number }[] = [];
  const near = world.near(Math.min(s.x, s.x + dx * far) - r, Math.max(s.x, s.x + dx * far) + r, Math.min(s.z, s.z + dz * far) - r, Math.max(s.z, s.z + dz * far) + r, [] as Solid[]);
  for (const b of near) {
    const T = b.max.y;
    if (T <= lo + EPS || T > hi + EPS || b.min.y >= T - EPS) continue;
    if (b.clip || (b.tag && NO_MANTLE_TAGS.has(b.tag))) continue;
    const hit = sweepBox(s.x, s.z, dx, dz, far, b, r);
    if (!hit || hit[0] > MANTLE.reach) continue;
    // The obstacle has to be in the way at body height (not something we already stand over).
    if (b.min.y >= s.y + bodyHeight(s)) continue;
    cands.push({ T, d0: hit[0], d1: hit[1] });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => a.T - b.T || a.d0 - b.d0);
  for (const c of cands) {
    const y0 = c.T + 0.01;
    // Room to rise in place, up past the ledge with clearance above it.
    if (!world.free(s.x, s.y + EPS, s.z, r, y0 + MANTLE.clearance - s.y - EPS)) continue;
    const depth = c.d1 - c.d0 - 2 * r;
    const over = depth <= MANTLE.thin;
    const k = over ? c.d1 + 0.02 : c.d0 + 2 * r + 0.02;
    const tx = s.x + dx * k;
    const tz = s.z + dz * k;
    if (!sweepFree(world, s.x, s.z, tx, tz, y0, MANTLE.clearance)) continue;
    if (over) {
      if (!world.free(tx, y0, tz, r, PLAYER.crouchHeight)) continue;
      return { to: { x: tx, y: y0, z: tz }, over: true, crouch: !world.free(tx, y0, tz, r, PLAYER.height) };
    }
    const g = world.groundBelow(tx, tz, y0, 0.05, r);
    if (g === null) continue;
    const stand = world.free(tx, g + EPS, tz, r, PLAYER.height);
    if (!stand && !world.free(tx, g + EPS, tz, r, PLAYER.crouchHeight)) continue;
    return { to: { x: tx, y: g, z: tz }, over: false, crouch: !stand };
  }
  return null;
}

function startMantle(s: MoveState, plan: MantlePlan) {
  const rise = Math.max(0, plan.to.y - s.y);
  const fwd = Math.hypot(plan.to.x - s.x, plan.to.z - s.z);
  s.mantle = { t: 0, dur: MANTLE.baseSec + MANTLE.perRise * rise + MANTLE.perForward * fwd, from: { x: s.x, y: s.y, z: s.z }, to: { ...plan.to }, over: plan.over };
  s.crouched = plan.crouch;
  s.sprinting = false;
  s.vx = s.vy = s.vz = 0;
  s.onGround = false;
}

/**
 * One substep of a mantle: rise straight up to the ledge's height, then move across onto it (or
 * over it). The path was checked free when the mantle started, so no collision runs here.
 */
function stepMantle(s: MoveState, h: number, adsHeld: boolean, p: MoveParams) {
  const m = s.mantle!;
  m.t = Math.min(m.dur, m.t + h);
  const e = smooth(m.t / m.dur);
  const peak = Math.max(m.from.y, m.to.y);
  const rise = peak - m.from.y;
  const fwd = Math.hypot(m.to.x - m.from.x, m.to.z - m.from.z);
  // A little more time on the rise than its length alone would give (hands on the ledge first).
  const riseW = rise * 1.3;
  const d = e * (riseW + fwd);
  if (d <= riseW && riseW > 0) {
    s.x = m.from.x;
    s.z = m.from.z;
    s.y = m.from.y + rise * (d / riseW);
  } else {
    const u = fwd > 0 ? Math.min(1, (d - riseW) / fwd) : 1;
    s.x = m.from.x + (m.to.x - m.from.x) * u;
    s.z = m.from.z + (m.to.z - m.from.z) * u;
    s.y = peak + (m.to.y - peak) * u;
  }
  s.sprinting = false;
  s.sinceSprint += h;
  updateAds(s, adsHeld, h, p);
  if (m.t < m.dur) return;
  s.x = m.to.x;
  s.y = m.to.y;
  s.z = m.to.z;
  s.mantle = null;
  s.vy = 0;
  if (m.over) {
    const l = Math.max(1e-6, fwd);
    s.vx = ((m.to.x - m.from.x) / l) * MANTLE.overExit;
    s.vz = ((m.to.z - m.from.z) / l) * MANTLE.overExit;
    s.onGround = false;
  } else {
    s.vx = s.vz = 0;
    s.onGround = true;
  }
}
