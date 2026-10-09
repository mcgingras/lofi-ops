/** CoD-style spawn scoring (src/server/features/modes/spawns.ts) through a real room. */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import botsFeature from '../src/server/features/bots/index';
import modesFeature, { registerModeRules } from '../src/server/features/modes/index';
import { scoreSpawns, spawnCandidates, trackSpawns } from '../src/server/features/modes/spawns';
import { Lobby } from '../src/server/lobby';
import type { Room } from '../src/server/room';
import { Store } from '../src/server/store';
import { box, buildCollisionWorld, type MapData } from '../src/shared/maps/types';
import { createMoveState } from '../src/shared/movement';

let store: Store | undefined;
let lobby: Lobby | undefined;

beforeAll(() => registerModeRules());
afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = undefined;
  store = undefined;
});

/** 60 x 30 m yard split by a tall wall with a gap; spawns on both sides of the wall and far away. */
function wallMap(): MapData {
  const sp = (x: number, z: number, yaw = 0) => ({ x, y: 0, z, yaw });
  return {
    id: 'test_spawns',
    name: 'Test Spawns',
    bounds: { min: { x: -30, y: -2, z: -15 }, max: { x: 30, y: 12, z: 15 } },
    materials: { ground: { texture: 'ground' }, wall: { texture: 'steel' } },
    brushes: [
      { min: { x: -31, y: -1, z: -16 }, max: { x: 31, y: 0, z: 16 }, mat: 'ground' },
      box(62, 4, 0.5, 'wall', 0, 0, -15.25),
      box(62, 4, 0.5, 'wall', 0, 0, 15.25),
      box(0.5, 4, 32, 'wall', -30.25, 0, 0),
      box(0.5, 4, 32, 'wall', 30.25, 0, 0),
      // A wall at x = 0 from z -15 to 10 (gap at the north end).
      { min: { x: -0.25, y: 0, z: -15 }, max: { x: 0.25, y: 5, z: 10 }, mat: 'wall' },
    ],
    decals: [],
    props: [],
    lights: [],
    spawns: { teams: [[sp(-25, -10), sp(-25, 0)], [sp(25, -10), sp(25, 0)]], ffa: [sp(-25, -10), sp(25, -10), sp(-12, -12), sp(12, -12)] },
    objectives: {},
    times: [{ id: 'day', name: 'Day', clock: '12:00', sky: 'skyGrey', skyRot: 0, sunDir: { x: 0, y: 1, z: 0 }, sun: [1, 1, 1], amb: [0.5, 0.5, 0.5], fog: [0.5, 0.5, 0.5], fogNear: 10, fogFar: 100, unlit: [1, 1, 1], lights: {}, glow: 0 }],
    defaultTime: 'day',
  };
}

function setup(mode = 'tdm'): Room {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: [botsFeature, modesFeature], log: () => {}, autoTick: false });
  const r = lobby.createRoom({ mode, map: 'yard', closeWhenEmpty: false, private: true, autoStart: true });
  const m = wallMap();
  r.map = m;
  r.world = buildCollisionWorld(m);
  trackSpawns(r);
  return r;
}

describe('spawns: scoring', () => {
  it('never picks a point an enemy can see when a hidden one exists', () => {
    const r = setup();
    const me = r.addBot({ name: 'Me', team: 0 });
    const foe = r.addBot({ name: 'Foe', team: 1 });
    // The enemy stands west of the wall, looking at both west spawns; the east spawns are hidden by the wall.
    foe.move = { ...createMoveState(-12, 0, -5), onGround: true };
    foe.yaw = Math.PI / 2;
    const pool = [...r.map.spawns.teams[0], ...r.map.spawns.teams[1]];
    for (let i = 0; i < 20; i++) {
      const picks = spawnCandidates(scoreSpawns(r, me, pool));
      expect(picks.length).toBeGreaterThan(0);
      for (const p of picks) expect(p.x).toBeGreaterThan(0);
    }
  });

  it('rules out points next to an enemy and points with recent deaths', () => {
    const r = setup();
    const me = r.addBot({ name: 'Me', team: 0 });
    const foe = r.addBot({ name: 'Foe', team: 1 });
    // Standing on an east point (the west ones are behind the wall).
    foe.move = { ...createMoveState(24, 0, -8), onGround: true };
    const scored = scoreSpawns(r, me, [...r.map.spawns.teams[0], ...r.map.spawns.teams[1]]);
    expect(scored.find((s) => s.pt.x === 25 && s.pt.z === -10)!.unsafe).toBe(true);
    expect(spawnCandidates(scored).every((p) => p.x < 0)).toBe(true);
    // Recent deaths count against a point.
    foe.move = { ...createMoveState(-25, 0, 12), onGround: true };
    const before = scoreSpawns(r, me, r.map.spawns.teams[1]).find((s) => s.pt.z === 0)!.score;
    const victim = r.addBot({ name: 'Victim', team: 0 });
    victim.move = { ...createMoveState(25, 0, 1), onGround: true };
    r.kill(victim, null, { weapon: 'world', means: 'world' });
    const after = scoreSpawns(r, me, r.map.spawns.teams[1]).find((s) => s.pt.z === 0)!.score;
    expect(after).toBeLessThan(before - 5);
  });

  it('FFA spawns far from everyone', () => {
    const r = setup('ffa');
    const me = r.addBot({ name: 'Me' });
    const a = r.addBot({ name: 'A' });
    a.move = { ...createMoveState(-20, 0, 12), onGround: true };
    const picks = spawnCandidates(scoreSpawns(r, me, r.map.spawns.ffa));
    for (const p of picks) expect(Math.hypot(p.x + 20, p.z - 12)).toBeGreaterThan(25);
  });
});
