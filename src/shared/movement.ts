/**
 * Deterministic player movement. The server runs `stepMove` for every input command it applies,
 * and the client runs the very same function to predict its own player, so both land on the same
 * numbers given the same inputs, params and world. Keep it pure: no Math.random, no clocks, no
 * reading anything but its arguments.
 *
 * Feel (DESIGN.md section 4): walk 5.0, sprint 7.2, ADS x0.6, crouch, jump 1.1 m, step 0.45 m,
 * 30% air control, gravity, ramps.
 */
import { CollisionWorld, topAt, type Solid } from './collision';
import { MAX_SUBSTEP, MOVE, PLAYER } from './constants';
import { Buttons, has } from './input';

export interface MoveState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  crouched: boolean;
  sprinting: boolean;
  /** Aim-down-sights fraction 0..1. */
  ads: number;
  /** Seconds since sprinting stopped (0 while sprinting); weapons use it for sprint-out delay. */
  sinceSprint: number;
  /** Jump was held last step (jumping needs a fresh press). */
  jumpHeld: boolean;
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
}

export const DEFAULT_MOVE_PARAMS: MoveParams = { speed: 1, adsTime: 0.25, adsMove: MOVE.ads, sprint: 1, canSprint: true, jump: 1, canMove: true };

export function createMoveState(x = 0, y = 0, z = 0): MoveState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, crouched: false, sprinting: false, ads: 0, sinceSprint: 10, jumpHeld: false };
}

export const copyMoveState = (s: MoveState): MoveState => ({ ...s });

export const bodyHeight = (s: Pick<MoveState, 'crouched'>) => (s.crouched ? PLAYER.crouchHeight : PLAYER.height);
export const eyeHeight = (s: Pick<MoveState, 'crouched'>) => (s.crouched ? PLAYER.crouchEye : PLAYER.eye);

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

  // Crouch: instant down; standing up needs headroom.
  const wantCrouch = move && (has(buttons, Buttons.CROUCH) || has(buttons, Buttons.PRONE));
  if (wantCrouch && !s.crouched) s.crouched = true;
  else if (!wantCrouch && s.crouched && world.free(s.x, s.y, s.z, r, PLAYER.height)) s.crouched = false;

  // ADS and sprint (ADS cancels sprint).
  const adsHeld = move && has(buttons, Buttons.ADS);
  const sprint = move && p.canSprint && has(buttons, Buttons.SPRINT) && !adsHeld && f >= MOVE.sprintMinForward && !s.crouched && s.ads <= MOVE.sprintMaxAds && (s.onGround || s.sprinting);
  s.sprinting = sprint;
  s.sinceSprint = sprint ? 0 : s.sinceSprint + h;
  const adsTarget = adsHeld && !sprint ? 1 : 0;
  const adsRate = h / Math.max(0.01, p.adsTime);
  if (adsTarget > s.ads) s.ads = Math.min(1, s.ads + adsRate);
  else if (adsTarget < s.ads) s.ads = Math.max(0, s.ads - adsRate * 1.5);

  // Wish velocity.
  let speed = (sprint ? MOVE.sprint * p.sprint : MOVE.walk) * p.speed;
  if (s.crouched) speed *= MOVE.crouch;
  speed *= 1 + (p.adsMove - 1) * s.ads;
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const wx = (-sy * f + cy * side) * speed;
  const wz = (-cy * f - sy * side) * speed;

  // Accelerate towards it (full on the ground, 30% in the air and only with input).
  const hasInput = f !== 0 || side !== 0;
  if (s.onGround || hasInput) {
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
  const jumpDown = move && has(buttons, Buttons.JUMP);
  let jumped = false;
  if (jumpDown && !s.jumpHeld && s.onGround) {
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

  // Horizontal, one axis at a time, stepping up small ledges and ramps.
  moveAxis(world, s, 'x', s.vx * h, height, wasGround);
  moveAxis(world, s, 'z', s.vz * h, height, wasGround);

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

function moveAxis(world: CollisionWorld, s: MoveState, axis: 'x' | 'z', delta: number, height: number, grounded: boolean) {
  if (delta === 0) return;
  const r = PLAYER.radius;
  const ox = s.x;
  const oz = s.z;
  const nx = axis === 'x' ? ox + delta : ox;
  const nz = axis === 'z' ? oz + delta : oz;
  const startHits = world.overlapping(ox, s.y, oz, r, height, [] as Solid[]);
  const hits = world.overlapping(nx, s.y, nz, r, height, [] as Solid[]).filter((b) => !startHits.includes(b));
  if (hits.length === 0) {
    s.x = nx;
    s.z = nz;
    return;
  }
  // Step up: everything in the way is low enough and there's room above it.
  if (grounded) {
    let lift = 0;
    for (const b of hits) lift = Math.max(lift, topAt(b, nx - r, nx + r, nz - r, nz + r) - s.y);
    if (lift > 0 && lift <= PLAYER.stepHeight + EPS && world.overlapping(nx, s.y + lift + EPS, nz, r, height, [] as Solid[]).filter((b) => !startHits.includes(b)).length === 0) {
      s.x = nx;
      s.z = nz;
      s.y += lift + EPS;
      return;
    }
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
}
