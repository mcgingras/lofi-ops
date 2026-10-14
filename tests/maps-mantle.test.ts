/**
 * Mantling on the real maps (docs/features/movement.md): the open window frames are climbed
 * through, and a walk flood that mantles everything it can still never leaves the bounds. Every
 * map's own walk and escape tests flood with mantling too (tests/maps-mw2-walk.ts and the maps'
 * copies press jump into whatever blocks them).
 */
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/shared/constants';
import { getMapData } from '../src/shared/defs/maps';
import { Buttons } from '../src/shared/input';
import { buildCollisionWorld } from '../src/shared/maps/types';
import { createMoveState, stepMove } from '../src/shared/movement';
import { floodWalk } from './maps-mw2-walk';

/** Stand at (x, z) facing `yaw`, walk up to whatever is ahead, press jump; where do we end up? */
function mantleFrom(mapId: string, x: number, z: number, yaw: number) {
  const world = buildCollisionWorld(getMapData(mapId));
  const g = world.groundBelow(x, z, 3, 6)!;
  const s = { ...createMoveState(x, g, z), onGround: true };
  for (let t = 0; t < 0.8; t += TICK_DT) stepMove(world, s, Buttons.FORWARD, yaw, TICK_DT);
  let mantled = false;
  for (let t = 0; t < 0.1; t += TICK_DT) {
    stepMove(world, s, Buttons.FORWARD | Buttons.JUMP, yaw, TICK_DT);
    mantled ||= !!s.mantle;
  }
  for (let t = 0; t < 2.5; t += TICK_DT) stepMove(world, s, 0, yaw, TICK_DT);
  return { s, mantled };
}

describe('mantling through the maps\' windows', () => {
  it('Highrise: from the roof through an office window into the north building hall', () => {
    // The hall's front wall runs along x at z -31.85; window x -7.5..-2.0, sill 1.0.
    const { s, mantled } = mantleFrom('highrise', -4.7, -30.0, 0);
    expect(mantled).toBe(true);
    expect(s.z).toBeLessThan(-32.2);
    expect(s.y).toBeCloseTo(0, 1);
  });

  it('Highrise: and back out again', () => {
    const { s, mantled } = mantleFrom('highrise', -4.7, -33.6, Math.PI);
    expect(mantled).toBe(true);
    expect(s.z).toBeGreaterThan(-31.5);
  });

  it('Nuketown: in through a ground-floor front window of the green house', () => {
    // Front wall along z at x about -9.7; window z -11.4..-9.6, sill 0.95, opening 1.2 m.
    const { s, mantled } = mantleFrom('nuketown', -8.4, -10.5, Math.PI / 2);
    expect(mantled).toBe(true);
    expect(s.x).toBeLessThan(-10.2);
  });
});

describe('a flood that mantles never leaves the bounds', () => {
  for (const id of ['yard', 'hijacked'] as const) {
    it(`${id}`, () => {
      const map = getMapData(id);
      for (const start of [map.spawns.teams[0][0]!, map.spawns.teams[1][0]!]) {
        const res = floodWalk(map, start, 0.8, 60000);
        expect(res.mantles.length).toBeGreaterThan(10);
        expect(res.escapes, `escaped at ${JSON.stringify(res.escapes.slice(0, 3))}`).toHaveLength(0);
      }
    }, 120_000);
  }
});
