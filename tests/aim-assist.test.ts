/**
 * Controller aim assist as a pure function (src/client/game/aim-assist.ts): view angles, stick
 * input, targets and dt in; adjusted angles out. Off for mouse/keyboard, slowdown only over
 * visible enemies, never through walls, rotation capped, no snap, quick decay.
 */
import { describe, expect, it } from 'vitest';
import { AIM_ASSIST, aimAssist, newAimState, targetWeight, type AimInput, type AimTarget } from '../src/client/game/aim-assist';
import { CollisionWorld, type Solid } from '../src/shared/collision';
import { yawTo, type Vec3 } from '../src/shared/math';

const DEG = Math.PI / 180;
const EYE: Vec3 = { x: 0, y: 1.6, z: 0 };
const open = () => true;

/** An enemy standing `dist` m straight ahead (yaw 0 looks down -z). */
const ahead = (dist: number, over: Partial<AimTarget> = {}): AimTarget => ({ id: 'e', x: 0, y: 0, z: -dist, vx: 0, vz: 0, crouched: false, alive: true, enemy: true, ...over });

function input(over: Partial<AimInput> = {}): AimInput {
  return {
    device: 'pad',
    strength: 'light',
    allowed: true,
    yaw: 0,
    pitch: 0,
    look: { yaw: 0.01, pitch: 0 },
    move: 0,
    eye: EYE,
    vel: { x: 0, z: 0 },
    targets: [ahead(10)],
    los: open,
    dt: 1 / 60,
    ...over,
  };
}

/** A pitch that puts the crosshair on the chest of a target `dist` m ahead. */
const chestPitch = (dist: number) => Math.atan2(1.2 - EYE.y, dist);

describe('aim assist', () => {
  it('does nothing for mouse/keyboard, when off, or when the lobby disallows it', () => {
    for (const over of [{ device: 'kbm' as const }, { strength: 'off' as const }, { allowed: false }]) {
      const st = newAimState();
      st.rotYaw = 0.1;
      const r = aimAssist(input({ pitch: chestPitch(10), move: 1, targets: [ahead(10, { vx: 5 })], ...over }), st);
      expect(r.slow).toBe(1);
      expect(r.yaw).toBeCloseTo(0.01);
      expect(r.rotYaw).toBe(0);
      expect(r.target).toBeNull();
      expect(st.rotYaw).toBe(0);
    }
  });

  it('slows the stick only over or near a visible, alive enemy', () => {
    const over = aimAssist(input({ pitch: chestPitch(10) }), newAimState());
    expect(over.target).toBe('e');
    expect(over.slow).toBeCloseTo(1 - AIM_ASSIST.light.slow);
    expect(over.yaw).toBeCloseTo(0.01 * (1 - AIM_ASSIST.light.slow));
    expect(AIM_ASSIST.light.slow).toBeGreaterThanOrEqual(0.25);
    expect(AIM_ASSIST.standard.slow).toBeLessThanOrEqual(0.35);
    // Far off to the side: nothing.
    expect(aimAssist(input({ yaw: 20 * DEG, pitch: chestPitch(10) }), newAimState()).slow).toBe(1);
    // Teammates and the dead: nothing.
    expect(aimAssist(input({ pitch: chestPitch(10), targets: [ahead(10, { enemy: false })] }), newAimState()).slow).toBe(1);
    expect(aimAssist(input({ pitch: chestPitch(10), targets: [ahead(10, { alive: false })] }), newAimState()).slow).toBe(1);
    // Beyond the max distance: nothing.
    expect(aimAssist(input({ targets: [ahead(AIM_ASSIST.maxDist + 5)] }), newAimState()).slow).toBe(1);
    // Standard is a little stronger.
    expect(aimAssist(input({ strength: 'standard', pitch: chestPitch(10) }), newAimState()).slow).toBeCloseTo(1 - AIM_ASSIST.standard.slow);
  });

  it('the cone scales with distance and fades at its edge', () => {
    const t = { x: 0, y: 0, z: -5, crouched: false };
    // 4 degrees off a target 5 m away is inside the zone; off one 40 m away it is not.
    expect(targetWeight(EYE, 4 * DEG, chestPitch(5), t).w).toBeGreaterThan(0);
    expect(targetWeight(EYE, 4 * DEG, chestPitch(40), { ...t, z: -40 }).w).toBe(0);
    // Partial weight between the body edge and the cone edge.
    const near = targetWeight(EYE, 0, chestPitch(10), { ...t, z: -10 }).w;
    const edge = targetWeight(EYE, Math.atan(0.3 / 10) + 1.2 * DEG, chestPitch(10), { ...t, z: -10 }).w;
    expect(near).toBe(1);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
    // A crouched target is shorter: aiming at a standing head height misses it.
    const headPitch = Math.atan2(1.75 - EYE.y, 10);
    expect(targetWeight(EYE, 0, headPitch, { ...t, z: -10 }).w).toBe(1);
    expect(targetWeight(EYE, 0, headPitch + 3 * DEG, { ...t, z: -10, crouched: true }).w).toBe(0);
  });

  it('never assists through walls (world sight raycast)', () => {
    const wall: Solid = { min: { x: -3, y: 0, z: -6 }, max: { x: 3, y: 4, z: -5.5 }, players: true, bullets: true, sight: true, source: 0, mat: 'wall' };
    const world = new CollisionWorld([wall]);
    const los = (a: Vec3, b: Vec3) => world.lineOfSight(a, b, 'sight');
    const blocked = aimAssist(input({ pitch: chestPitch(10), los, move: 1, targets: [ahead(10, { vx: 5 })] }), newAimState());
    expect(blocked.slow).toBe(1);
    expect(blocked.rotYaw).toBe(0);
    expect(blocked.target).toBeNull();
    // Same wall, target in front of it: assisted.
    expect(aimAssist(input({ pitch: chestPitch(4), los, targets: [ahead(4)] }), newAimState()).slow).toBeLessThan(1);
    // A see-through fence (sight: false) doesn't block.
    const fence = new CollisionWorld([{ ...wall, sight: false }]);
    expect(aimAssist(input({ pitch: chestPitch(10), los: (a, b) => fence.lineOfSight(a, b, 'sight') }), newAimState()).slow).toBeLessThan(1);
  });

  it('rotational assist follows a strafing target while you move, and only then', () => {
    // Enemy 10 m ahead strafing to my right (+x): its bearing turns right, so yaw decreases.
    const st = newAimState();
    let r = aimAssist(input({ look: { yaw: 0, pitch: 0 }, pitch: chestPitch(10), move: 1, targets: [ahead(10, { vx: 5 })] }), st);
    for (let i = 0; i < 30; i++) r = aimAssist(input({ look: { yaw: 0, pitch: 0 }, pitch: chestPitch(10), move: 1, targets: [ahead(10, { vx: 5 })] }), st);
    expect(r.rotYaw).toBeLessThan(0);
    // Not moving: no rotation (slowdown only).
    const still = aimAssist(input({ look: { yaw: 0, pitch: 0 }, pitch: chestPitch(10), move: 0, targets: [ahead(10, { vx: 5 })] }), newAimState());
    expect(still.rotYaw).toBe(0);
    // My own strafe counts too: I strafe left (-x) past a still target -> same direction.
    const st2 = newAimState();
    let r2 = r;
    for (let i = 0; i < 30; i++) r2 = aimAssist(input({ look: { yaw: 0, pitch: 0 }, pitch: chestPitch(10), move: 1, vel: { x: -5, z: 0 } }), st2);
    expect(r2.rotYaw).toBeLessThan(0);
  });

  it('rotation is capped and eased: never a snap', () => {
    const st = newAimState();
    const fast = ahead(3, { vx: 40 }); // absurd relative speed up close
    let maxStep = 0;
    let r = aimAssist(input({ look: { yaw: 0, pitch: 0 }, pitch: chestPitch(3), move: 1, targets: [fast] }), st);
    const first = Math.abs(r.rotYaw);
    for (let i = 0; i < 120; i++) {
      r = aimAssist(input({ look: { yaw: 0, pitch: 0 }, pitch: chestPitch(3), move: 1, targets: [fast] }), st);
      maxStep = Math.max(maxStep, Math.hypot(r.rotYaw, r.rotPitch));
      expect(r.rotRate).toBeLessThanOrEqual(AIM_ASSIST.light.rotCap + 1e-9);
    }
    expect(maxStep).toBeLessThanOrEqual(AIM_ASSIST.light.rotCap / 60 + 1e-9);
    // Eased in: the first frame is well under the cap.
    expect(first).toBeLessThan((AIM_ASSIST.light.rotCap / 60) * 0.3);
    expect(AIM_ASSIST.standard.rotCap).toBeLessThan(0.3);
  });

  it('no pull towards a target that is not moving relative to you (no snap, no magnetism)', () => {
    // Crosshair a little off a still target, both still, stick untouched but moving on the left
    // stick into a wall (no velocity): the aim must not move at all.
    const st = newAimState();
    const t = ahead(8);
    let yaw = 1.5 * DEG;
    let pitch = chestPitch(8);
    for (let i = 0; i < 120; i++) {
      const r = aimAssist(input({ yaw, pitch, look: { yaw: 0, pitch: 0 }, move: 1, targets: [t] }), st);
      yaw = r.yaw;
      pitch = r.pitch;
    }
    expect(yaw).toBeCloseTo(1.5 * DEG, 10);
    expect(pitch).toBeCloseTo(chestPitch(8), 10);
    // And no ADS snap exists.
    expect(AIM_ASSIST.adsSnap).toBe(0);
  });

  it('decays fast once the target is gone', () => {
    const st = newAimState();
    const go = (targets: AimTarget[]) => aimAssist(input({ look: { yaw: 0, pitch: 0 }, pitch: chestPitch(10), move: 1, targets }), st);
    for (let i = 0; i < 60; i++) go([ahead(10, { vx: 6 })]);
    const before = st.rotYaw;
    expect(Math.abs(before)).toBeGreaterThan(0.01);
    for (let i = 0; i < 9; i++) go([]); // 0.15 s
    expect(Math.abs(st.rotYaw)).toBeLessThan(Math.abs(before) * 0.05);
    for (let i = 0; i < 30; i++) go([]);
    expect(st.rotYaw).toBe(0);
  });

  it('picks the visible target over a hidden nearer one', () => {
    const hidden = { ...ahead(6), id: 'hidden' };
    const seen = { ...ahead(12), id: 'seen', x: 0.2 };
    const los = (_a: Vec3, b: Vec3) => b.z < -10;
    const r = aimAssist(input({ pitch: chestPitch(9), targets: [hidden, seen], los }), newAimState());
    expect(r.target).toBe('seen');
    void yawTo;
  });
});
