/** Test fixtures for the bots feature: a small map with stairs, a ramp and a jump-up ledge. */
import { box, type MapData } from '../src/shared/maps/types';

/**
 * 30 x 30 m walled yard. A staircase (6 treads of 0.4 m) climbs along +x to a 2.4 m platform in
 * the north-east; a ramp climbs along -z to a 1.5 m deck in the south-west; a 0.8 m barrier wall
 * crosses the middle with a single gap; a 0.9 m crate sits in the south-east (jump-up only).
 */
export function stairsMap(): MapData {
  const brushes = [
    { min: { x: -16, y: -1, z: -16 }, max: { x: 16, y: 0, z: 16 }, mat: 'ground' },
    // Walls.
    box(32, 4, 0.5, 'wall', 0, 0, -15.25),
    box(32, 4, 0.5, 'wall', 0, 0, 15.25),
    box(0.5, 4, 32, 'wall', -15.25, 0, 0),
    box(0.5, 4, 32, 'wall', 15.25, 0, 0),
    // Platform 2.4 m high at x 8..14, z -14..-8.
    { min: { x: 8, y: 0, z: -14 }, max: { x: 14, y: 2.4, z: -8 }, mat: 'wall' },
    // Stairs up to it along +x: treads 0.5 m deep, rising 0.4 m, x 5..8, z -12..-10.
    ...[1, 2, 3, 4, 5].map((k) => ({ min: { x: 5.5 + (k - 1) * 0.5, y: 0, z: -12 }, max: { x: 6 + (k - 1) * 0.5, y: k * 0.4, z: -10 }, mat: 'wall' })),
    // Ramp along -z rising to a 1.5 m deck: ramp z 4..-2 (high end at z=-2... deck beyond it).
    { min: { x: -12, y: 0, z: -2 }, max: { x: -9, y: 1.5, z: 4 }, mat: 'wall', ramp: '-z' as const },
    { min: { x: -14, y: 0, z: -8 }, max: { x: -7, y: 1.5, z: -2 }, mat: 'wall' },
    // Barrier wall across the middle (z = 6) with a gap at x 2..4.
    { min: { x: -15, y: 0, z: 5.7 }, max: { x: 2, y: 0.8, z: 6.3 }, mat: 'wall' },
    { min: { x: 4, y: 0, z: 5.7 }, max: { x: 15, y: 0.8, z: 6.3 }, mat: 'wall' },
    // A tall pillar in the way of the straight line between the spawns.
    { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 4, z: 1 }, mat: 'wall' },
    // Crate (jump up only).
    { min: { x: 9, y: 0, z: 9 }, max: { x: 11, y: 0.9, z: 11 }, mat: 'wall' },
  ];
  const sp = (x: number, z: number, yaw = 0) => ({ x, y: 0, z, yaw });
  return {
    id: 'test_stairs',
    name: 'Test Stairs',
    bounds: { min: { x: -15, y: -2, z: -15 }, max: { x: 15, y: 12, z: 15 } },
    materials: { ground: { texture: 'ground' }, wall: { texture: 'steel' } },
    brushes,
    decals: [],
    props: [],
    lights: [],
    spawns: { teams: [[sp(0, -12)], [sp(0, 12, Math.PI)]], ffa: [sp(0, -12), sp(0, 12, Math.PI)] },
    objectives: {},
    times: [{ id: 'day', name: 'Day', clock: '12:00', sky: 'skyGrey', skyRot: 0, sunDir: { x: 0, y: 1, z: 0 }, sun: [1, 1, 1], amb: [0.5, 0.5, 0.5], fog: [0.5, 0.5, 0.5], fogNear: 10, fogFar: 100, unlit: [1, 1, 1], lights: {}, glow: 0 }],
    defaultTime: 'day',
  };
}
