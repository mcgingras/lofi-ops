/**
 * Light controller aim assist (pure; unit-tested in tests/aim-assist.test.ts). Client side only:
 * it changes the local view angles, which go out in the normal input commands, so the server
 * needs nothing.
 *
 * - Controller only: with the mouse/keyboard as the last-used device it returns the input
 *   untouched, so mouse players get nothing from it.
 * - Slowdown: stick look is slowed by `slow` (Light 25%, Standard 35%) while the crosshair is over
 *   a visible enemy, fading out across a small cone around the body. The body's own angular size
 *   plus a cone of `atan(margin / distance)` (clamped) means the zone scales with distance and
 *   target size.
 * - Rotational: while you are moving (left stick past `minMove`) and an enemy is under/near the
 *   crosshair, the view follows a fraction of the target's angular motion relative to you
 *   (its strafe plus yours). Capped (`rotCap` rad/s), eased in and decaying fast when the
 *   conditions end. It never pulls towards the target: a target that isn't moving relative to you
 *   gets no rotation at all, so there is no snap or magnetism.
 * - No ADS snap (the "nothing crazy" brief).
 * - Targets: alive enemies only, within `maxDist`, with a clear line of sight (`los`, the world's
 *   sight raycast) to the chest or head. Nothing through walls, nothing for teammates or the dead.
 */
import type { Vec3 } from '../../shared/math';
import type { InputDevice } from './pad';

export type AimStrength = 'off' | 'light' | 'standard';

export interface AimTuning {
  /** Look slowdown at full strength (0.28 = 28% slower). */
  slow: number;
  /** Fraction of the target's relative angular velocity followed. */
  rot: number;
  /** Rotational assist cap (rad/s). */
  rotCap: number;
}

export const AIM_ASSIST: Record<Exclude<AimStrength, 'off'>, AimTuning> & {
  maxDist: number;
  radius: number;
  margin: number;
  minConeDeg: number;
  maxConeDeg: number;
  minMove: number;
  attack: number;
  decay: number;
  adsSnap: number;
} = {
  light: { slow: 0.25, rot: 0.25, rotCap: 0.12 },
  standard: { slow: 0.35, rot: 0.4, rotCap: 0.22 },
  /** Metres. */
  maxDist: 60,
  /** Body half-width used for "over the hitbox" (torso box half-size). */
  radius: 0.3,
  /** Cone outside the body: atan(margin / distance), clamped. */
  margin: 0.45,
  minConeDeg: 0.8,
  maxConeDeg: 6,
  /** Left stick magnitude that counts as "moving" for the rotational part. */
  minMove: 0.3,
  /** Easing rates (1/s): towards a stronger rotation / back to none. */
  attack: 10,
  decay: 25,
  /** ADS snap strength: none, by design. */
  adsSnap: 0,
};

export interface AimTarget {
  id: string;
  /** Feet position. */
  x: number;
  y: number;
  z: number;
  /** Velocity (m/s). */
  vx: number;
  vy?: number;
  vz: number;
  crouched: boolean;
  /** Lying down: a low target (the head and shoulders at the feet position, the body behind). */
  prone?: boolean;
  /** Facing (where a prone body's legs trail from). */
  yaw?: number;
  alive: boolean;
  enemy: boolean;
}

/** Height of the body column the assist works on. */
const targetHeight = (t: Pick<AimTarget, 'crouched' | 'prone'>) => (t.prone ? 0.5 : t.crouched ? 1.2 : 1.8);

export interface AimInput {
  device: InputDevice;
  strength: AimStrength;
  /** Lobby rule (private lobbies can turn it off). */
  allowed: boolean;
  /** Current aim (with recoil). */
  yaw: number;
  pitch: number;
  /** Stick look delta this frame (radians), from the pad mapper. */
  look: { yaw: number; pitch: number };
  /** Left stick magnitude 0..1. */
  move: number;
  eye: Vec3;
  /** Own velocity (m/s). */
  vel: { x: number; y?: number; z: number };
  targets: readonly AimTarget[];
  /** Clear line of sight between two points (walls, smoke...). */
  los: (from: Vec3, to: Vec3) => boolean;
  dt: number;
}

export interface AimState {
  /** Smoothed rotational assist (rad/s). */
  rotYaw: number;
  rotPitch: number;
}

export interface AimResult {
  yaw: number;
  pitch: number;
  /** Look multiplier applied (1 = no slowdown). */
  slow: number;
  /** Rotation added this frame (radians). */
  rotYaw: number;
  rotPitch: number;
  /** Rotational assist speed now (rad/s). */
  rotRate: number;
  /** Target under the assist, or null. */
  target: string | null;
  /** 0..1 how "on" the target the crosshair is (1 = over the body). */
  weight: number;
}

export const newAimState = (): AimState => ({ rotYaw: 0, rotPitch: 0 });

const DEG = Math.PI / 180;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (t: number) => t * t * (3 - 2 * t);

/** How close the aim (yaw, pitch from eye) is to a target: 1 over the body, fading to 0 at the cone edge. */
export function targetWeight(eye: Vec3, yaw: number, pitch: number, t: Pick<AimTarget, 'x' | 'y' | 'z' | 'crouched' | 'prone'>): { w: number; dist: number; aimY: number } {
  const dx = t.x - eye.x;
  const dz = t.z - eye.z;
  const D = Math.hypot(dx, dz);
  if (D < 0.5) return { w: 0, dist: D, aimY: t.y + 1 };
  const h = targetHeight(t);
  const y0 = t.y + h * 0.15;
  const y1 = t.y + h;
  const yawT = Math.atan2(-dx, -dz);
  const p0 = Math.atan2(y0 - eye.y, D);
  const p1 = Math.atan2(y1 - eye.y, D);
  const halfW = Math.atan(AIM_ASSIST.radius / D);
  const ox = Math.max(0, Math.abs(wrap(yaw - yawT)) * Math.cos(pitch) - halfW);
  const oy = pitch < p0 ? p0 - pitch : pitch > p1 ? pitch - p1 : 0;
  const off = Math.hypot(ox, oy);
  const cone = Math.min(AIM_ASSIST.maxConeDeg * DEG, Math.max(AIM_ASSIST.minConeDeg * DEG, Math.atan(AIM_ASSIST.margin / D)));
  const w = off >= cone ? 0 : smooth(1 - off / cone);
  // The point the crosshair is nearest to on the body (for pitch-rate maths).
  const aimY = Math.max(y0, Math.min(y1, eye.y + Math.tan(pitch) * D));
  return { w, dist: D, aimY };
}

/** Adjusted view angles for this frame. Mutates `state` (rotational easing). */
export function aimAssist(inp: AimInput, state: AimState): AimResult {
  const plain = (): AimResult => ({ yaw: inp.yaw + inp.look.yaw, pitch: inp.pitch + inp.look.pitch, slow: 1, rotYaw: 0, rotPitch: 0, rotRate: 0, target: null, weight: 0 });
  if (inp.device !== 'pad' || inp.strength === 'off' || !inp.allowed || !(inp.dt > 0)) {
    state.rotYaw = state.rotPitch = 0;
    return plain();
  }
  const tune = AIM_ASSIST[inp.strength];
  const { eye } = inp;

  // Best visible enemy near the crosshair.
  let best: { t: AimTarget; w: number; dist: number; aimY: number } | null = null;
  for (const t of inp.targets) {
    if (!t.alive || !t.enemy) continue;
    const dist = Math.hypot(t.x - eye.x, t.z - eye.z);
    if (dist > AIM_ASSIST.maxDist) continue;
    const tw = targetWeight(eye, inp.yaw, inp.pitch, t);
    if (tw.w <= 0) continue;
    if (best && (tw.w < best.w || (tw.w === best.w && tw.dist >= best.dist))) continue;
    const h = targetHeight(t);
    const chest = { x: t.x, y: t.y + h * 0.65, z: t.z };
    const head = { x: t.x, y: t.y + h * 0.93, z: t.z };
    if (!inp.los(eye, chest) && !inp.los(eye, head)) continue;
    best = { t, w: tw.w, dist: tw.dist, aimY: tw.aimY };
  }

  const w = best?.w ?? 0;
  const slow = 1 - tune.slow * w;

  // Rotational: follow the target's angular motion relative to me while I move.
  let wantYaw = 0;
  let wantPitch = 0;
  if (best && inp.move >= AIM_ASSIST.minMove) {
    const t = best.t;
    const dx = t.x - eye.x;
    const dz = t.z - eye.z;
    const dy = best.aimY - eye.y;
    const rvx = t.vx - inp.vel.x;
    const rvz = t.vz - inp.vel.z;
    const rvy = (t.vy ?? 0) - (inp.vel.y ?? 0);
    const D2 = Math.max(0.25, dx * dx + dz * dz);
    const D = Math.sqrt(D2);
    const yawRate = (dz * rvx - dx * rvz) / D2;
    const dD = (dx * rvx + dz * rvz) / D;
    const pitchRate = (D * rvy - dy * dD) / (D2 + dy * dy);
    wantYaw = yawRate * tune.rot * w;
    wantPitch = pitchRate * tune.rot * w;
    const mag = Math.hypot(wantYaw, wantPitch);
    if (mag > tune.rotCap) {
      wantYaw *= tune.rotCap / mag;
      wantPitch *= tune.rotCap / mag;
    }
  }
  const ease = (cur: number, want: number) => {
    const rate = Math.abs(want) > Math.abs(cur) && Math.sign(want) === Math.sign(cur || want) ? AIM_ASSIST.attack : AIM_ASSIST.decay;
    return cur + (want - cur) * (1 - Math.exp(-rate * inp.dt));
  };
  state.rotYaw = ease(state.rotYaw, wantYaw);
  state.rotPitch = ease(state.rotPitch, wantPitch);
  // Belt and braces: never more than the cap, whatever the easing did.
  const m = Math.hypot(state.rotYaw, state.rotPitch);
  if (m > tune.rotCap) {
    state.rotYaw *= tune.rotCap / m;
    state.rotPitch *= tune.rotCap / m;
  }
  if (Math.abs(state.rotYaw) < 1e-5) state.rotYaw = 0;
  if (Math.abs(state.rotPitch) < 1e-5) state.rotPitch = 0;
  const rotYaw = state.rotYaw * inp.dt;
  const rotPitch = state.rotPitch * inp.dt;
  return {
    yaw: inp.yaw + inp.look.yaw * slow + rotYaw,
    pitch: inp.pitch + inp.look.pitch * slow + rotPitch,
    slow,
    rotYaw,
    rotPitch,
    rotRate: Math.hypot(state.rotYaw, state.rotPitch),
    target: best?.t.id ?? null,
    weight: w,
  };
}
