import { describe, expect, it } from 'vitest';
import { CollisionWorld, playerHitboxes, rayAABB, rayHitboxes, type Solid } from '../src/shared/collision';
import type { Vec3 } from '../src/shared/math';
import { PLAYER } from '../src/shared/constants';
import { getMapData, MAPS } from '../src/shared/defs/maps';
import { buildCollisionWorld } from '../src/shared/maps/types';
import { flatWorld, solid } from './helpers';

describe('collision world', () => {
  it('raycasts the nearest box with the right normal', () => {
    const w = flatWorld([solid({ x: -1, y: 0, z: -11 }, { x: 1, y: 3, z: -10 }), solid({ x: -1, y: 0, z: -21 }, { x: 1, y: 3, z: -20 })]);
    const hit = w.raycast({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: -1 }, 100)!;
    expect(hit.t).toBeCloseTo(10, 6);
    expect(hit.normal).toEqual({ x: 0, y: 0, z: 1 });
    expect(w.raycast({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: -1 }, 5)).toBeNull();
    const down = w.raycast({ x: 50, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 100)!;
    expect(down.t).toBeCloseTo(5, 6);
    expect(down.normal.y).toBe(1);
  });

  it('raycasts ramps on the slope', () => {
    const w = new CollisionWorld([solid({ x: 0, y: 0, z: -1 }, { x: 4, y: 2, z: 1 }, { ramp: '+x' })]);
    // Straight down at x=2: slope height 1.
    const hit = w.raycast({ x: 2, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 100)!;
    expect(hit.t).toBeCloseTo(4, 5);
    expect(hit.normal.y).toBeGreaterThan(0.8);
    // Horizontal ray at y=1.5 from -x passes over the low part, hits the slope at x=3.
    const side = w.raycast({ x: -5, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, 100)!;
    expect(side.point.x).toBeCloseTo(3, 5);
  });

  it('respects bullet/sight masks (fences)', () => {
    const w = flatWorld([solid({ x: -5, y: 0, z: -5.1 }, { x: 5, y: 3, z: -5 }, { bullets: false, sight: false })]);
    expect(w.raycast({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 20, 'bullets')).toBeNull();
    expect(w.raycast({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 20, 'players')!.t).toBeCloseTo(5, 5);
    expect(w.lineOfSight({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -10 })).toBe(true);
  });

  it('the ray grid finds the same first hit as testing every solid (every map, random rays)', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const def of MAPS) {
      const world = buildCollisionWorld(getMapData(def.id));
      const b = getMapData(def.id).bounds;
      const single = new Map<Solid, CollisionWorld>();
      const brute = (o: Vec3, d: Vec3, maxT: number, mask: 'bullets' | 'sight') => {
        let best = maxT;
        let hit = false;
        for (const s of world.solids) {
          if (!s[mask]) continue;
          let t: number | undefined;
          if (s.ramp) {
            let w = single.get(s);
            if (!w) single.set(s, (w = new CollisionWorld([s])));
            t = w.raycast(o, d, best, mask)?.t;
          } else t = rayAABB(o, d, s.min, s.max, best)?.t;
          if (t !== undefined && t <= best) {
            best = t;
            hit = true;
          }
        }
        return hit ? best : null;
      };
      for (let i = 0; i < 300; i++) {
        const o = { x: b.min.x + rnd() * (b.max.x - b.min.x), y: rnd() * 8, z: b.min.z + rnd() * (b.max.z - b.min.z) };
        const a = rnd() * Math.PI * 2;
        const e = (rnd() - 0.3) * 1.2;
        const d = { x: Math.cos(a) * Math.cos(e), y: Math.sin(e), z: Math.sin(a) * Math.cos(e) };
        const mask = i % 2 ? 'bullets' : 'sight';
        const got = world.raycast(o, d, 120, mask)?.t ?? null;
        const want = brute(o, d, 120, mask);
        if (want === null) expect(got, `${def.id} ray ${i}`).toBeNull();
        else expect(got, `${def.id} ray ${i}`).toBeCloseTo(want, 9);
      }
    }
  });

  it('hitboxes: head above torso above legs; crouch is lower', () => {
    const hb = playerHitboxes({ x: 0, y: 0, z: 0 }, false);
    expect(hb.head.max.y).toBeCloseTo(PLAYER.height);
    expect(hb.legs.min.y).toBe(0);
    const o = { x: 0, y: 1.7, z: 10 };
    expect(rayHitboxes(o, { x: 0, y: 0, z: -1 }, hb)!.part).toBe('head');
    expect(rayHitboxes({ ...o, y: 1.2 }, { x: 0, y: 0, z: -1 }, hb)!.part).toBe('torso');
    expect(rayHitboxes({ ...o, y: 0.4 }, { x: 0, y: 0, z: -1 }, hb)!.part).toBe('legs');
    expect(rayHitboxes({ ...o, x: 1 }, { x: 0, y: 0, z: -1 }, hb)).toBeNull();
    const crouched = playerHitboxes({ x: 0, y: 0, z: 0 }, true);
    expect(rayHitboxes(o, { x: 0, y: 0, z: -1 }, crouched)).toBeNull();
    expect(rayHitboxes({ ...o, y: 1.1 }, { x: 0, y: 0, z: -1 }, crouched)!.part).toBe('head');
  });
});

describe('maps', () => {
  for (const def of MAPS) {
    it(`${def.id}: every spawn is on the ground, free and inside bounds`, () => {
      const map = getMapData(def.id);
      const world = buildCollisionWorld(map);
      const all = [...map.spawns.teams[0], ...map.spawns.teams[1], ...map.spawns.ffa];
      expect(map.spawns.teams[0].length).toBeGreaterThan(0);
      expect(map.spawns.teams[1].length).toBeGreaterThan(0);
      expect(map.spawns.ffa.length).toBeGreaterThan(0);
      for (const s of all) {
        const g = world.groundBelow(s.x, s.z, s.y + 1, 3);
        expect(g, `ground under ${JSON.stringify(s)}`).not.toBeNull();
        expect(world.free(s.x, g!, s.z), `free at ${JSON.stringify(s)}`).toBe(true);
        expect(s.x).toBeGreaterThan(map.bounds.min.x);
        expect(s.x).toBeLessThan(map.bounds.max.x);
        expect(s.z).toBeGreaterThan(map.bounds.min.z);
        expect(s.z).toBeLessThan(map.bounds.max.z);
      }
    });
    it(`${def.id}: every material reference exists`, () => {
      const map = getMapData(def.id);
      const mats = new Set(Object.keys(map.materials));
      for (const b of map.brushes) if (!b.noRender) expect(mats.has(b.mat), b.mat).toBe(true);
      for (const d of map.decals) expect(mats.has(d.mat), d.mat).toBe(true);
      for (const p of map.props) if (p.kind === 'cylinder') expect(mats.has(p.mat), p.mat).toBe(true);
      expect(map.times.some((t) => t.id === map.defaultTime)).toBe(true);
    });
  }

  it('yard: the warehouse wall stops bullets, the fence does not', () => {
    const world = buildCollisionWorld(getMapData('yard'));
    const toWarehouse = world.raycast({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 }, 100)!;
    expect(toWarehouse.point.z).toBeCloseTo(-26, 3);
    expect(world.raycast({ x: 20, y: 1.6, z: 0 }, { x: 1, y: 0, z: 0 }, 30)).toBeNull();
  });
});
