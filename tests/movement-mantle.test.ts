/**
 * Mantling (docs/features/movement.md): jump at a ledge to climb onto it, at a thin sill or wall to
 * vault over it; never too high, never onto or over invisible clips; deterministic for prediction.
 */
import { describe, expect, it } from 'vitest';
import { MANTLE, MAX_SUBSTEP, MOVE, PLAYER, TICK_DT } from '../src/shared/constants';
import { Buttons } from '../src/shared/input';
import { copyMoveState, createMoveState, moveBusy, stepMove, type MoveState } from '../src/shared/movement';
import { Predictor } from '../src/client/netcode/predict';
import type { InputCmd } from '../src/shared/input';
import { flatWorld, solid } from './helpers';

const F = Buttons.FORWARD;
const J = Buttons.JUMP;

function grounded(x = 0, z = 0, y = 0): MoveState {
  const s = createMoveState(x, y, z);
  s.onGround = true;
  return s;
}

function run(world: ReturnType<typeof flatWorld>, s: MoveState, seconds: number, buttons: number, yaw = 0) {
  for (let t = 0; t < seconds - 1e-9; t += TICK_DT) stepMove(world, s, buttons, yaw, TICK_DT);
  return s;
}

/** Walk up to whatever is ahead, then press jump (held) with forward. */
function walkAndJump(world: ReturnType<typeof flatWorld>, s = grounded(), holdSec = 1.5) {
  run(world, s, 0.6, F);
  stepMove(world, s, F | J, 0, TICK_DT);
  const started = !!s.mantle;
  run(world, s, holdSec, 0);
  return { s, started };
}

/** A crate 1.0 m tall and 1.2 m deep, its near face 1.5 m ahead (-z). */
const crate = (h = 1.0) => solid({ x: -0.6, y: 0, z: -2.7 }, { x: 0.6, y: h, z: -1.5 });

/** A 0.2 m wall at z = -1.5 with a window: sill to 1.0 m, opening 1.2 m wide up to 2.2 m. */
function windowWall(sill = 1.0, top = 2.2, extra: Partial<Parameters<typeof solid>[2]> = {}) {
  const z0 = -1.7;
  const z1 = -1.5;
  return [
    solid({ x: -0.6, y: 0, z: z0 }, { x: 0.6, y: sill, z: z1 }, extra),
    solid({ x: -0.6, y: top, z: z0 }, { x: 0.6, y: 3, z: z1 }, extra),
    solid({ x: -5, y: 0, z: z0 }, { x: -0.6, y: 3, z: z1 }, extra),
    solid({ x: 0.6, y: 0, z: z0 }, { x: 5, y: 3, z: z1 }, extra),
  ];
}

describe('mantle', () => {
  it('climbs onto a crate: jump + forward against a 1 m ledge ends standing on top', () => {
    const world = flatWorld([crate()]);
    const { s, started } = walkAndJump(world);
    expect(started).toBe(true);
    expect(s.mantle).toBeNull();
    expect(s.onGround).toBe(true);
    expect(s.y).toBeCloseTo(1.0, 3);
    expect(s.z).toBeLessThan(-1.5 - PLAYER.radius + 0.01); // the whole footprint is on the crate
    expect(s.z).toBeGreaterThan(-2.7);
    expect(s.crouched).toBe(false);
  });

  it('takes a short climb (BO1-ish timing) and the weapon is down meanwhile', () => {
    const world = flatWorld([crate()]);
    const s = grounded();
    run(world, s, 0.6, F);
    stepMove(world, s, F | J, 0, TICK_DT);
    expect(s.mantle).not.toBeNull();
    const dur = s.mantle!.dur;
    expect(dur).toBeGreaterThan(0.45);
    expect(dur).toBeLessThan(1.0);
    expect(moveBusy(s)).toBe(true);
    // Rises before it moves forward: halfway through it's still over its start, partly up.
    const z0 = s.mantle!.from.z;
    run(world, s, dur * 0.3, 0);
    expect(s.z).toBeCloseTo(z0, 6);
    expect(s.y).toBeGreaterThan(0.1);
    run(world, s, dur, 0);
    expect(s.mantle).toBeNull();
    expect(moveBusy(s)).toBe(false);
  });

  it('vaults through a window: over the sill, out the far side, down to the floor', () => {
    const world = flatWorld(windowWall());
    const { s, started } = walkAndJump(world, grounded(), 2);
    expect(started).toBe(true);
    expect(s.z).toBeLessThan(-1.7 - PLAYER.radius); // past the wall
    expect(s.onGround).toBe(true);
    expect(s.y).toBeCloseTo(0, 3);
  });

  it("fits a Nuketown-sized window (1.2 m opening over a 0.95 m sill)", () => {
    const world = flatWorld(windowWall(0.95, 2.15));
    const { s, started } = walkAndJump(world, grounded(), 2);
    expect(started).toBe(true);
    expect(s.z).toBeLessThan(-1.7 - PLAYER.radius);
  });

  it('a window with a desk right behind it: climbs onto the sill instead of vaulting', () => {
    const desk = solid({ x: -1, y: 0, z: -2.6 }, { x: 1, y: 1.1, z: -1.7 });
    const { s, started } = walkAndJump(flatWorld([...windowWall(), desk]), grounded(), 2);
    expect(started).toBe(true);
    expect(s.y).toBeGreaterThan(0.99); // on the sill (or the desk), not on the floor beyond
    expect(s.z).toBeLessThan(-1.4);
  });

  it('a window lower than the climb clearance is not climbable', () => {
    const world = flatWorld(windowWall(1.0, 1.0 + MANTLE.clearance - 0.1));
    const { s, started } = walkAndJump(world);
    expect(started).toBe(false);
    expect(s.z).toBeGreaterThan(-1.5);
  });

  it('vaults a low wall (thin) rather than standing on it; climbs onto a deep one', () => {
    const thin = flatWorld([solid({ x: -3, y: 0, z: -1.8 }, { x: 3, y: 1.2, z: -1.5 })]);
    const a = walkAndJump(thin, grounded(), 2).s;
    expect(a.z).toBeLessThan(-1.8 - PLAYER.radius);
    expect(a.y).toBeCloseTo(0, 3);
    const deep = flatWorld([solid({ x: -3, y: 0, z: -4 }, { x: 3, y: 1.2, z: -1.5 })]);
    const b = walkAndJump(deep).s;
    expect(b.y).toBeCloseTo(1.2, 3);
    expect(b.z).toBeLessThan(-1.5);
  });

  it(`can't mantle higher than ${MANTLE.maxHeight} m: a plain jump instead`, () => {
    const world = flatWorld([crate(MANTLE.maxHeight + 0.15)]);
    const { s, started } = walkAndJump(world);
    expect(started).toBe(false);
    expect(s.z).toBeGreaterThan(-1.5);
    expect(s.y).toBeCloseTo(0, 3);
    // The highest allowed ledge works.
    const ok = walkAndJump(flatWorld([crate(MANTLE.maxHeight - 0.02)]));
    expect(ok.started).toBe(true);
    expect(ok.s.y).toBeCloseTo(MANTLE.maxHeight - 0.02, 3);
  });

  it('a step-high ledge is just walked onto (no mantle), and a mantle needs forward input', () => {
    const low = flatWorld([crate(PLAYER.stepHeight - 0.05)]);
    const s = grounded();
    run(low, s, 0.6, F);
    stepMove(low, s, F | J, 0, TICK_DT);
    expect(s.mantle).toBeNull();
    const world = flatWorld([crate()]);
    const t = grounded();
    run(world, t, 0.6, F);
    stepMove(world, t, J, 0, TICK_DT);
    expect(t.mantle).toBeNull();
    expect(t.vy).toBeGreaterThan(0); // jumped
  });

  it('never onto or over invisible clips: a perimeter clip on a low wall, or a clip by itself', () => {
    const wall = solid({ x: -3, y: 0, z: -1.8 }, { x: 3, y: 1.0, z: -1.5 });
    const perimeter = solid({ x: -3, y: 1.0, z: -1.8 }, { x: 3, y: 12, z: -1.5 }, { bullets: false, sight: false, clip: true, tag: 'perimeter' });
    const a = walkAndJump(flatWorld([wall, perimeter]), grounded(), 2);
    expect(a.started).toBe(false);
    expect(a.s.z).toBeGreaterThan(-1.5);
    // A perimeter clip that only comes up to mantle height is still not climbed.
    const lowPerimeter = solid({ x: -3, y: 0, z: -1.8 }, { x: 3, y: 1.2, z: -1.5 }, { bullets: false, sight: false, clip: true, tag: 'perimeter' });
    expect(walkAndJump(flatWorld([lowPerimeter]), grounded(), 2).started).toBe(false);
    // Nor any invisible player clip (they mark where players can't go).
    const clip = solid({ x: -3, y: 0, z: -1.8 }, { x: 3, y: 1.2, z: -1.5 }, { bullets: false, sight: false, clip: true });
    expect(walkAndJump(flatWorld([clip]), grounded(), 2).started).toBe(false);
    // A drawn, see-through railing (players only, but visible) is vaulted.
    const rail = solid({ x: -3, y: 0, z: -1.8 }, { x: 3, y: 1.0, z: -1.6 }, { bullets: false, sight: false });
    expect(walkAndJump(flatWorld([rail]), grounded(), 2).started).toBe(true);
  });

  it('needs headroom: no climb onto a ledge under a low ceiling', () => {
    const world = flatWorld([crate(), solid({ x: -3, y: 1.0 + MANTLE.clearance - 0.2, z: -3 }, { x: 3, y: 3, z: -1.4 })]);
    const { started } = walkAndJump(world);
    expect(started).toBe(false);
  });

  it('can catch a ledge in the air with jump held, but no higher than the floor-based limit', () => {
    // A 1.3 m ledge: jump first (away from it), drift in, catch it.
    const world = flatWorld([crate(1.3)]);
    const s = grounded(0, -0.6);
    stepMove(world, s, J, 0, TICK_DT);
    expect(s.mantle).toBeNull();
    run(world, s, 0.6, F | J);
    expect(s.y).toBeCloseTo(1.3, 3);
    // A ledge out of reach from the floor stays out of reach from a jump.
    const high = flatWorld([crate(MANTLE.maxHeight + 0.3)]);
    const h = grounded(0, -0.6);
    stepMove(high, h, J, 0, TICK_DT);
    run(high, h, 1.2, F | J);
    expect(h.y).toBeLessThan(0.01);
  });

  it('is deterministic: a replay from a mid-mantle copy lands on the same state (prediction)', () => {
    const world = flatWorld([crate(), ...windowWall().map((b) => ({ ...b, min: { ...b.min, x: b.min.x + 8 }, max: { ...b.max, x: b.max.x + 8 } }))]);
    const script: { b: number; yaw: number; dt: number }[] = [];
    for (let i = 0; i < 40; i++) script.push({ b: F, yaw: 0, dt: 1 / 60 });
    script.push({ b: F | J, yaw: 0, dt: 1 / 60 });
    for (let i = 0; i < 80; i++) script.push({ b: i % 7 === 0 ? F | J : F, yaw: 0.01 * i, dt: 1 / 50 + (i % 3) * 0.004 });
    const a = grounded();
    let mid: MoveState | null = null;
    script.forEach((c, i) => {
      stepMove(world, a, c.b, c.yaw, c.dt);
      if (i === 45) {
        expect(a.mantle).not.toBeNull();
        mid = copyMoveState(a);
      }
    });
    const b = mid! as MoveState;
    for (const c of script.slice(46)) stepMove(world, b, c.b, c.yaw, c.dt);
    expect(b).toEqual(a);
    // copyMoveState is deep: stepping the copy never moves the original's mantle.
    const c0 = grounded();
    run(world, c0, 0.6, F);
    stepMove(world, c0, F | J, 0, TICK_DT);
    const c1 = copyMoveState(c0);
    stepMove(world, c1, F, 0, 0.1);
    expect(c0.mantle!.t).toBeLessThan(c1.mantle!.t);
  });

  it('server and client prediction agree through a mantle (Predictor replay of unacked inputs)', () => {
    const world = flatWorld([crate()]);
    const server = grounded();
    const pred = new Predictor(world);
    pred.reset(server);
    const cmds: InputCmd[] = [];
    for (let i = 1; i <= 120; i++) cmds.push({ seq: i, dt: 1 / 60, buttons: i === 40 ? F | J : i < 40 ? F : 0, yaw: 0, pitch: 0, weaponSlot: 0 });
    for (const c of cmds) pred.apply(c);
    // The server is 30 commands behind when its snapshot arrives (mid-mantle).
    for (const c of cmds.slice(0, 50)) stepMove(world, server, c.buttons, c.yaw, c.dt);
    expect(server.mantle).not.toBeNull();
    const corr = pred.reconcile(50, copyMoveState(server), pred.params);
    expect(corr).toBeLessThan(1e-9);
    for (const c of cmds.slice(50)) stepMove(world, server, c.buttons, c.yaw, c.dt);
    expect(pred.state).toEqual(server);
    expect(server.y).toBeCloseTo(1, 3);
  });

  it('sub-stepping: one long command and many short ones give the same climb', () => {
    const world = flatWorld([crate()]);
    const a = grounded();
    const b = grounded();
    run(world, a, 0.6, F);
    run(world, b, 0.6, F);
    stepMove(world, a, F | J, 0, MAX_SUBSTEP);
    stepMove(world, b, F | J, 0, MAX_SUBSTEP);
    stepMove(world, a, F, 0, 0.05);
    for (let i = 0; i < 3; i++) stepMove(world, b, F, 0, 0.05 / 3);
    expect(a.y).toBeCloseTo(b.y, 9);
    expect(a.mantle!.t).toBeCloseTo(b.mantle!.t, 9);
    void MOVE;
  });
});
