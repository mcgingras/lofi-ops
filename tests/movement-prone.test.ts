/**
 * Prone (docs/features/movement.md): the BO1 stance numbers, headroom, the leg room check, the
 * dolphin dive, and the lying hitboxes.
 */
import { describe, expect, it } from 'vitest';
import { spreadDegrees, stanceSpread } from '../src/shared/ballistics';
import { playerHitboxes, rayHitboxes } from '../src/shared/collision';
import { MOVE, PLAYER, PRONE, TICK_DT } from '../src/shared/constants';
import { Buttons } from '../src/shared/input';
import { viewDir } from '../src/shared/math';
import { bodyHeight, createMoveState, eyeHeight, moveBusy, stanceOf, stepMove, type MoveState } from '../src/shared/movement';
import { flatWorld, solid } from './helpers';

const F = Buttons.FORWARD;
const P = Buttons.PRONE;
const C = Buttons.CROUCH;

function grounded(x = 0, z = 0): MoveState {
  const s = createMoveState(x, 0, z);
  s.onGround = true;
  return s;
}

function run(world: ReturnType<typeof flatWorld>, s: MoveState, seconds: number, buttons: number, yaw = 0) {
  for (let t = 0; t < seconds - 1e-9; t += TICK_DT) stepMove(world, s, buttons, yaw, TICK_DT);
  return s;
}

describe('prone', () => {
  it('lies down over ~0.8 s: eye 0.4 m, body 0.55 m; the weapon is down until nearly there', () => {
    const w = flatWorld();
    const s = grounded();
    stepMove(w, s, P, 0, TICK_DT);
    expect(s.prone).toBe(true);
    expect(s.crouched).toBe(true);
    expect(bodyHeight(s)).toBe(PLAYER.proneHeight);
    expect(moveBusy(s)).toBe(true);
    run(w, s, PRONE.downSec * 0.5, P);
    expect(s.proneT).toBeGreaterThan(0.4);
    expect(s.proneT).toBeLessThan(0.65);
    expect(eyeHeight(s)).toBeGreaterThan(PLAYER.proneEye);
    run(w, s, PRONE.downSec * 0.6, P);
    expect(s.proneT).toBe(1);
    expect(eyeHeight(s)).toBeCloseTo(PLAYER.proneEye, 6);
    expect(PLAYER.proneEye).toBeGreaterThanOrEqual(0.35);
    expect(PLAYER.proneEye).toBeLessThanOrEqual(0.45);
    expect(PLAYER.proneHeight).toBeGreaterThanOrEqual(0.5);
    expect(PLAYER.proneHeight).toBeLessThanOrEqual(0.6);
    expect(moveBusy(s)).toBe(false);
    expect(stanceOf(s)).toBe('prone');
  });

  it(`crawls at ${MOVE.prone * 100}% of walk speed, never sprints`, () => {
    const w = flatWorld();
    const s = grounded();
    run(w, s, 1, P);
    run(w, s, 1, P | F | Buttons.SPRINT);
    expect(s.sprinting).toBe(false);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(MOVE.walk * MOVE.prone, 5);
    expect(MOVE.prone).toBeGreaterThanOrEqual(0.25);
    expect(MOVE.prone).toBeLessThanOrEqual(0.3);
  });

  it('jump from prone stands up instead of jumping; standing takes longer than going down', () => {
    const w = flatWorld();
    const s = run(w, grounded(), 1, P);
    stepMove(w, s, P | Buttons.JUMP, 0, TICK_DT);
    expect(s.prone).toBe(false);
    expect(s.crouched).toBe(false);
    expect(s.vy).toBe(0);
    expect(s.onGround).toBe(true);
    // Getting up: ~1 s, slower than going down.
    expect(PRONE.upSec).toBeGreaterThan(PRONE.downSec);
    run(w, s, PRONE.upSec * 0.5, 0);
    expect(s.proneT).toBeGreaterThan(0.3);
    run(w, s, PRONE.upSec * 0.6, 0);
    expect(s.proneT).toBe(0);
    expect(eyeHeight(s)).toBeCloseTo(PLAYER.eye, 6);
  });

  it('crouch from prone goes to crouch; releasing prone stands; going prone needs a fresh press', () => {
    const w = flatWorld();
    const s = run(w, grounded(), 1, P);
    run(w, s, 1, C);
    expect(s.prone).toBe(false);
    expect(s.crouched).toBe(true);
    expect(s.proneT).toBe(0);
    expect(PRONE.toCrouchSec).toBeLessThan(PRONE.upSec);
    const t = run(w, grounded(), 1, P);
    run(w, t, 1, 0);
    expect(t.crouched).toBe(false);
    expect(t.prone).toBe(false);
    // Held through a refusal (no room), it doesn't drop you later when there is room.
    const s2 = grounded();
    s2.proneHeld = true;
    run(w, s2, 0.5, P);
    expect(s2.prone).toBe(false);
  });

  it('standing up needs headroom: stays prone under low cover, crouches where only a crouch fits', () => {
    const low = flatWorld([solid({ x: -3, y: 0.7, z: -3 }, { x: 3, y: 1, z: 3 })]);
    const s = run(low, grounded(), 1, P);
    expect(s.prone).toBe(true);
    run(low, s, 1, 0);
    expect(s.prone).toBe(true);
    stepMove(low, s, Buttons.JUMP, 0, TICK_DT);
    expect(s.prone).toBe(true);
    const mid = flatWorld([solid({ x: -3, y: 1.4, z: -3 }, { x: 3, y: 2, z: 3 })]);
    const t = run(mid, grounded(), 1, P);
    run(mid, t, 1, 0);
    expect(t.prone).toBe(false);
    expect(t.crouched).toBe(true);
    // ...and crawls out from under a 0.7 m gap the standing body can't enter.
    const u = run(low, grounded(0, 3.5), 1, P);
    run(low, u, 2, F | P);
    expect(u.z).toBeLessThan(1);
  });

  it("can't go prone without room for the legs (a wall right behind)", () => {
    const w = flatWorld([solid({ x: -3, y: 0, z: 0.7 }, { x: 3, y: 2, z: 1 })]);
    const s = run(w, grounded(), 0.5, P);
    expect(s.prone).toBe(false);
    // Facing the wall the legs go the other way: fine.
    const t = run(w, grounded(), 0.5, P, Math.PI);
    expect(t.prone).toBe(true);
    // Crawling backwards, the legs stop at the wall.
    const u = run(w, grounded(0, -2.5), 1, P);
    expect(u.prone).toBe(true);
    run(w, u, 3, Buttons.BACK | P);
    expect(u.z + PRONE.length).toBeLessThan(0.75);
  });

  it('dolphin dive: prone pressed while sprinting launches you forward and lands you prone', () => {
    const w = flatWorld();
    const s = run(w, grounded(), 1, F | Buttons.SPRINT);
    expect(s.sprinting).toBe(true);
    const z0 = s.z;
    stepMove(w, s, F | Buttons.SPRINT | P, 0, TICK_DT);
    expect(s.dive).toBeGreaterThan(0);
    expect(s.prone).toBe(true);
    expect(s.onGround).toBe(false);
    expect(moveBusy(s)).toBe(true);
    run(w, s, 1.2, F | P);
    expect(z0 - s.z).toBeGreaterThan(3);
    expect(s.prone).toBe(true);
    expect(s.proneT).toBe(1);
    expect(s.dive).toBe(0);
    expect(moveBusy(s)).toBe(false);
  });

  it('accuracy: tighter spread fully prone', () => {
    const w = flatWorld();
    const s = run(w, grounded(), 1.5, P);
    const def = { spread: { hip: 4, ads: 0.5, move: 2 } };
    const stand = spreadDegrees(def, 0, false, stanceSpread(grounded()));
    const prone = spreadDegrees(def, 0, false, stanceSpread(s));
    expect(prone).toBeCloseTo(stand * PRONE.spread, 6);
    expect(PRONE.spread).toBeLessThan(1);
  });
});

describe('prone hitboxes', () => {
  const feet = { x: 0, y: 0, z: 0 };

  it('lie along the facing: low head at the eye, torso and legs behind', () => {
    const hb = playerHitboxes(feet, 'prone', 0);
    expect(hb.head.max.y).toBeLessThan(0.5);
    // Facing -z (yaw 0): the legs trail towards +z.
    expect(hb.legs.max.z).toBeGreaterThan(1.4);
    expect(hb.head.min.z).toBeLessThan(0);
    // A shot at standing chest height passes over; one along the ground at the head hits it.
    const over = rayHitboxes({ x: 0, y: 1.2, z: -10 }, { x: 0, y: 0, z: 1 }, hb);
    expect(over).toBeNull();
    const head = rayHitboxes({ x: 0, y: 0.35, z: -10 }, { x: 0, y: 0, z: 1 }, hb);
    expect(head?.part).toBe('head');
    // From the side: behind the eye the legs, a little behind the torso, ahead of the head nothing.
    const side = (z: number, y = 0.15) => rayHitboxes({ x: -10, y, z }, { x: 1, y: 0, z: 0 }, hb)?.part ?? null;
    expect(side(1.2)).toBe('legs');
    expect(side(0.5)).toBe('torso');
    expect(side(-0.6)).toBeNull();
    expect(side(1.9)).toBeNull();
  });

  it('turn with the body (exact, not the bounding box)', () => {
    const yaw = Math.PI / 4; // facing (-0.71, -0.71): legs towards +x +z
    const hb = playerHitboxes(feet, 'prone', yaw);
    const back = viewDir(yaw + Math.PI, 0); // towards the legs
    const at = (k: number) => ({ x: back.x * k, z: back.z * k });
    const down = { x: 0, y: -1, z: 0 };
    const leg = at(1.2);
    expect(rayHitboxes({ x: leg.x, y: 5, z: leg.z }, down, hb)?.part).toBe('legs');
    // A point inside the world AABB of the legs but off the turned body: missed.
    const off = { x: leg.x + 0.3, z: leg.z - 0.3 };
    expect(off.x).toBeLessThan(hb.legs.max.x);
    expect(rayHitboxes({ x: off.x, y: 5, z: off.z }, down, hb)).toBeNull();
  });

  it('the standing and crouched boxes are unchanged (booleans still work)', () => {
    expect(playerHitboxes(feet, false)).toEqual(playerHitboxes(feet, 'stand'));
    expect(playerHitboxes(feet, true)).toEqual(playerHitboxes(feet, 'crouch'));
    expect(playerHitboxes(feet, true).head.max.y).toBeCloseTo(PLAYER.crouchHeight, 6);
  });
});
