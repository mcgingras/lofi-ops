import { describe, expect, it } from 'vitest';
import { MOVE, PLAYER, TICK_DT } from '../src/shared/constants';
import { Buttons } from '../src/shared/input';
import { buildCollisionWorld } from '../src/shared/maps/types';
import { getMapData } from '../src/shared/defs/maps';
import { copyMoveState, createMoveState, stepMove, type MoveState } from '../src/shared/movement';
import { flatWorld, solid } from './helpers';

const F = Buttons.FORWARD;

function grounded(x = 0, z = 0): MoveState {
  const s = createMoveState(x, 0, z);
  s.onGround = true;
  return s;
}

function run(world = flatWorld(), s = grounded(), seconds = 1, buttons = F, yaw = 0, dt = TICK_DT) {
  for (let t = 0; t < seconds - 1e-9; t += dt) stepMove(world, s, buttons, yaw, dt);
  return s;
}

describe('movement', () => {
  it('is deterministic: same inputs give identical state', () => {
    const world = buildCollisionWorld(getMapData('yard'));
    const script: { b: number; yaw: number; dt: number }[] = [];
    let seed = 7;
    const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 600; i++) script.push({ b: Math.floor(r() * 512), yaw: r() * 6.28, dt: 1 / 30 + r() * 0.02 });
    const a = createMoveState(0, 0, 4);
    const b = createMoveState(0, 0, 4);
    for (const c of script) stepMove(world, a, c.b, c.yaw, c.dt);
    for (const c of script) stepMove(world, b, c.b, c.yaw, c.dt);
    expect(a).toEqual(b);
    // A copy taken midway and replayed lands on the same state too (reconciliation replay).
    const c = createMoveState(0, 0, 4);
    let mid: MoveState | null = null;
    script.forEach((cmd, i) => {
      stepMove(world, c, cmd.b, cmd.yaw, cmd.dt);
      if (i === 299) mid = copyMoveState(c);
    });
    const replay = mid! as MoveState;
    for (const cmd of script.slice(300)) stepMove(world, replay, cmd.b, cmd.yaw, cmd.dt);
    expect(replay).toEqual(c);
  });

  it('walks at 5 m/s and sprints at 7.2 m/s facing -z at yaw 0', () => {
    const w = run(flatWorld(), grounded(), 2, F);
    expect(w.vz).toBeCloseTo(-MOVE.walk, 5);
    expect(w.x).toBeCloseTo(0, 6);
    const s = run(flatWorld(), grounded(), 2, F | Buttons.SPRINT);
    expect(s.sprinting).toBe(true);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(MOVE.sprint, 5);
  });

  it('ADS slows to 60% and cancels sprint', () => {
    const s = run(flatWorld(), grounded(), 2, F | Buttons.SPRINT | Buttons.ADS);
    expect(s.sprinting).toBe(false);
    expect(s.ads).toBe(1);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(MOVE.walk * MOVE.ads, 5);
  });

  it('jumps about 1.1 m', () => {
    const world = flatWorld();
    const s = grounded();
    let top = 0;
    stepMove(world, s, Buttons.JUMP, 0, TICK_DT);
    for (let i = 0; i < 120; i++) {
      stepMove(world, s, Buttons.JUMP, 0, TICK_DT);
      top = Math.max(top, s.y);
    }
    expect(top).toBeGreaterThan(1.0);
    expect(top).toBeLessThan(1.15);
    expect(s.onGround).toBe(true);
    expect(s.y).toBeCloseTo(0, 6);
  });

  it('is blocked by walls', () => {
    const wall = solid({ x: -5, y: 0, z: -3 }, { x: 5, y: 3, z: -2 });
    const s = run(flatWorld([wall]), grounded(), 2, F);
    expect(s.z).toBeGreaterThanOrEqual(-2 + PLAYER.radius - 1e-3);
    expect(s.z).toBeLessThan(-2 + PLAYER.radius + 0.01);
  });

  it('steps up ledges up to 0.45 m but not higher', () => {
    const low = solid({ x: -5, y: 0, z: -10 }, { x: 5, y: 0.4, z: -2 });
    const s = run(flatWorld([low]), grounded(), 1.5, F);
    expect(s.y).toBeCloseTo(0.4, 2);
    expect(s.z).toBeLessThan(-3);
    const high = solid({ x: -5, y: 0, z: -10 }, { x: 5, y: 0.6, z: -2 });
    const t = run(flatWorld([high]), grounded(), 1.5, F);
    expect(t.y).toBeCloseTo(0, 6);
    expect(t.z).toBeGreaterThan(-2);
  });

  it('walks up and down a ramp', () => {
    // Rises 2 m over 6 m going -z, then a platform.
    const ramp = solid({ x: -2, y: 0, z: -8 }, { x: 2, y: 2, z: -2 }, { ramp: '-z' });
    const deck = solid({ x: -2, y: 0, z: -14 }, { x: 2, y: 2, z: -8 });
    const world = flatWorld([ramp, deck]);
    const s = run(world, grounded(), 2.5, F);
    expect(s.z).toBeLessThan(-9);
    expect(s.y).toBeCloseTo(2, 3);
    const back = run(world, s, 2.5, Buttons.BACK);
    expect(back.z).toBeGreaterThan(-1);
    expect(back.y).toBeCloseTo(0, 3);
    expect(back.onGround).toBe(true);
  });

  it('crouches and cannot stand up under a low ceiling', () => {
    const ceiling = solid({ x: -5, y: 1.5, z: -10 }, { x: 5, y: 2, z: -2 });
    const world = flatWorld([ceiling]);
    const s = grounded();
    run(world, s, 1, F | Buttons.CROUCH);
    expect(s.crouched).toBe(true);
    expect(s.z).toBeLessThan(-2);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(MOVE.walk * MOVE.crouch, 4);
    run(world, s, 0.2, 0);
    expect(s.crouched).toBe(true);
  });

  it('falls off ledges with gravity', () => {
    const world = flatWorld([solid({ x: -5, y: 0, z: -5 }, { x: 5, y: 3, z: 5 })]);
    const s = createMoveState(0, 3, 4.5);
    s.onGround = true;
    run(world, s, 1, Buttons.BACK);
    expect(s.z).toBeGreaterThan(5.3);
    expect(s.y).toBeCloseTo(0, 6);
  });
});
