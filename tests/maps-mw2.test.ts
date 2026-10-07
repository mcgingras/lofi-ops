/**
 * maps-mw2: Rust, Scrapyard and Terminal. Data checks (spawns, objectives, materials, registry) and
 * walk-based checks with the real movement code (every objective and roam point reachable from
 * both team spawns, the play space closed, no falling out of the world).
 */
import { describe, expect, it } from 'vitest';
import { MAP_BY_ID, getMapData, mapsForMode } from '../src/shared/defs/maps';
import { buildCollisionWorld, type MapData } from '../src/shared/maps/types';
import { floodWalk, reaches, type WalkResult } from './maps-mw2-walk';

const MW2 = ['rust', 'scrapyard', 'terminal'] as const;

const all = (m: MapData) => [...m.spawns.teams[0], ...m.spawns.teams[1], ...m.spawns.ffa];

const floods = new Map<string, [WalkResult, WalkResult]>();
function flood(id: string): [WalkResult, WalkResult] {
  let f = floods.get(id);
  if (!f) {
    const m = getMapData(id);
    floods.set(id, (f = [floodWalk(m, m.spawns.teams[0][0]!), floodWalk(m, m.spawns.teams[1][0]!)]));
  }
  return f;
}

describe('maps-mw2 registry', () => {
  it('registers each map with inspiredBy, size and TDM/FFA', () => {
    for (const id of MW2) {
      const def = MAP_BY_ID.get(id)!;
      expect(def, id).toBeDefined();
      expect(def.inspiredBy).toMatch(/Modern Warfare 2/);
      expect(def.modes).toContain('tdm');
      expect(def.modes).toContain('ffa');
      expect(mapsForMode('tdm').some((m) => m.id === id)).toBe(true);
    }
  });
});

for (const id of MW2) {
  describe(`map ${id}`, () => {
    const map = getMapData(id);
    const world = buildCollisionWorld(map);

    it('has enough spawns, all free with headroom and facing into the map', () => {
      expect(map.spawns.teams[0].length).toBeGreaterThanOrEqual(8);
      expect(map.spawns.teams[1].length).toBeGreaterThanOrEqual(8);
      expect(map.spawns.ffa.length).toBeGreaterThanOrEqual(12);
      for (const s of all(map)) {
        const g = world.groundBelow(s.x, s.z, s.y + 1, 3);
        expect(g, `ground at ${s.x},${s.z}`).not.toBeNull();
        expect(Math.abs(g! - s.y), `spawn y at ${s.x},${s.z}`).toBeLessThan(0.5);
        // Free with a little elbow room and headroom.
        for (const [ox, oz] of [[0, 0], [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]] as const) expect(world.free(s.x + ox, g! + 0.2, s.z + oz), `room at ${s.x},${s.z}`).toBe(true);
        expect(Number.isFinite(s.yaw)).toBe(true);
      }
    });

    it('keeps team spawns apart and no two spawns on top of each other', () => {
      const [t0, t1] = map.spawns.teams;
      for (const a of t0) for (const b of t1) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(20);
      const pts = all(map);
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i]!;
          const b = pts[j]!;
          if (a === b) continue;
          const sameList = (map.spawns.ffa.includes(a) && map.spawns.ffa.includes(b)) || t0.includes(a) && t0.includes(b) || t1.includes(a) && t1.includes(b);
          if (sameList) expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.x},${a.z} vs ${b.x},${b.z}`).toBeGreaterThan(1.5);
        }
    });

    it('has Domination A/B/C, S&D sites with a bomb spawn, and HQ points', () => {
      expect(map.objectives.dom?.map((o) => o.id)).toEqual(['A', 'B', 'C']);
      const sd = map.objectives.sd!;
      expect(sd.map((o) => o.id)).toEqual(['A', 'B']);
      for (const s of sd) expect(s.team).toBe(1);
      expect(map.objectives.sdBomb).toHaveLength(1);
      expect(map.objectives.hq!.length).toBeGreaterThanOrEqual(4);
      // Each S&D site is closer to the defenders (team 1) than to the attackers (team 0).
      const near = (o: { x: number; z: number }, list: { x: number; z: number }[]) => Math.min(...list.map((s) => Math.hypot(s.x - o.x, s.z - o.z)));
      for (const s of sd) expect(near(s, map.spawns.teams[1])).toBeLessThan(near(s, map.spawns.teams[0]));
      // Dom A sits on team 0's side, C on team 1's.
      const [a, , c] = map.objectives.dom!;
      expect(near(a!, map.spawns.teams[0])).toBeLessThan(near(a!, map.spawns.teams[1]));
      expect(near(c!, map.spawns.teams[1])).toBeLessThan(near(c!, map.spawns.teams[0]));
    });

    it('every objective point stands on a free floor', () => {
      for (const list of Object.values(map.objectives))
        for (const o of list) {
          const g = world.groundBelow(o.x, o.z, o.y + 0.5, 1.5);
          expect(g, `${o.id} floor`).not.toBeNull();
          expect(world.free(o.x, g!, o.z), `${o.id} free`).toBe(true);
        }
    });

    it('has a default time preset, lights and bot roam points', () => {
      expect(map.times.length).toBeGreaterThanOrEqual(2);
      expect(map.times.some((t) => t.id === map.defaultTime)).toBe(true);
      expect(map.lights.length).toBeGreaterThan(3);
      expect(map.hotspots!.length).toBeGreaterThanOrEqual(6);
    });

    it('walk test: the play space is closed and nobody falls out of the world', () => {
      for (const res of flood(id)) {
        expect(res.nodes.length).toBeGreaterThan(500);
        expect(res.escapes, `escaped at ${JSON.stringify(res.escapes.slice(0, 3))}`).toHaveLength(0);
        expect(res.falls, `fell at ${JSON.stringify(res.falls.slice(0, 3))}`).toHaveLength(0);
      }
    });

    it('walk test: every spawn, objective and roam point is reachable from both team spawns', () => {
      for (const res of flood(id)) {
        for (const s of all(map)) expect(reaches(res, s), `spawn ${s.x},${s.z}`).toBe(true);
        for (const [kind, list] of Object.entries(map.objectives)) for (const o of list) expect(reaches(res, o, Math.max(1.2, o.radius * 0.8)), `${kind} ${o.id}`).toBe(true);
        for (const h of map.hotspots ?? []) expect(reaches(res, h), `hotspot ${h.x},${h.y},${h.z}`).toBe(true);
      }
    });
  });
}
