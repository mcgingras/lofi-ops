/**
 * maps-bo: Nuketown and Firing Range. Data rules (spawns, objectives, materials, textures), the
 * authoring kit, reachability of everything that matters (flood fill through the real movement
 * code), closed bounds, scripted walks across each map, and a few signature sightlines.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MOVE, PLAYER } from '../src/shared/constants';
import { getMapData, MAP_BY_ID } from '../src/shared/defs/maps';
import { MODES } from '../src/shared/defs/modes';
import { Buttons } from '../src/shared/input';
import type { Vec3 } from '../src/shared/math';
import { createMoveState, stepMove } from '../src/shared/movement';
import { MapKit } from '../src/shared/maps/bo-kit';
import { buildCollisionWorld, mapSolids, type MapData, type SpawnPoint } from '../src/shared/maps/types';
import { NavGrid } from '../src/server/features/bots/nav';
import { floodFill, walkRoute, type Reach } from './maps-bo-nav';

const ROOT = resolve(import.meta.dirname, '..');
const IDS = ['nuketown', 'firingrange'] as const;
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

const allSpawns = (m: MapData): SpawnPoint[] => [...m.spawns.teams[0], ...m.spawns.teams[1], ...m.spawns.ffa, ...Object.values(m.modeSpawns ?? {}).flatMap((set) => Object.values(set).flat())];

const reachCache = new Map<string, Reach>();
function reach(id: string): Reach {
  let r = reachCache.get(id);
  if (!r) {
    const m = getMapData(id);
    reachCache.set(id, (r = floodFill(buildCollisionWorld(m), [m.spawns.teams[0][0]!])));
  }
  return r;
}

/** Texture recipe ids registered by the client recipe files (templates like `fr_lane${i}` become prefixes). */
function recipeIds(): { ids: Set<string>; prefixes: string[] } {
  const dir = resolve(ROOT, 'src/client/render/recipes');
  const ids = new Set<string>();
  const prefixes: string[] = [];
  for (const f of readdirSync(dir)) {
    const src = readFileSync(resolve(dir, f), 'utf8');
    for (const m of src.matchAll(/registerTexture\(\s*['`]([^'`]+)['`]/g)) {
      const id = m[1]!;
      if (id.includes('${')) prefixes.push(id.slice(0, id.indexOf('${')));
      else ids.add(id);
    }
  }
  return { ids, prefixes };
}

describe('maps-bo registry', () => {
  it('both maps are registered with inspiredBy, sizes and every registered mode', () => {
    for (const id of IDS) {
      const def = MAP_BY_ID.get(id)!;
      expect(def, id).toBeTruthy();
      expect(def.inspiredBy).toMatch(/Black Ops/);
      for (const mode of MODES) expect(def.modes).toContain(mode.id);
    }
    expect(MAP_BY_ID.get('nuketown')!.size).toBe('small');
    expect(MAP_BY_ID.get('firingrange')!.size).toBe('medium');
  });

  it('every material texture has a client recipe, and every photo it needs is in assets/textures', () => {
    const { ids, prefixes } = recipeIds();
    for (const id of IDS) {
      const m = getMapData(id);
      for (const [name, mat] of Object.entries(m.materials)) {
        if (mat.texture === 'none') continue;
        const ok = ids.has(mat.texture) || prefixes.some((p) => mat.texture.startsWith(p));
        expect(ok, `${id}: material ${name} -> texture ${mat.texture}`).toBe(true);
      }
      for (const t of m.times) expect(ids.has(t.sky), `${id}: sky ${t.sky}`).toBe(true);
    }
    for (const f of ['nuketown.ts', 'firingrange.ts', 'bo-common.ts']) {
      const src = readFileSync(resolve(ROOT, 'src/client/render/recipes', f), 'utf8');
      const photos = new Set([...src.matchAll(/fromPhoto\('([^']+)'/g), ...src.matchAll(/c\.photo\('([^']+)'/g)].map((x) => x[1]!));
      for (const p of photos) expect(existsSync(resolve(ROOT, 'assets/textures', `${p}.jpg`)), `${f}: photo ${p}`).toBe(true);
    }
  });
});

describe('maps-bo kit', () => {
  it('walls leave door and window holes; rays pass the holes and stop on the wall', () => {
    const k = new MapKit();
    k.aabb(-10, -1, -10, 10, 0, 10, 'g');
    k.wall('x', -5, 5, 0, 0, 3, 0.2, 'w', [{ a0: -0.5, a1: 0.5, y0: 0, y1: 2.2 }, { a0: 2, a1: 4, y0: 1, y1: 2 }]);
    const world = buildCollisionWorld({ ...emptyMap(), brushes: k.brushes });
    expect(world.raycast(v(0, 1, -3), v(0, 0, 1), 6)).toBeNull();
    expect(world.raycast(v(3, 1.5, -3), v(0, 0, 1), 6)).toBeNull();
    expect(world.raycast(v(3, 0.5, -3), v(0, 0, 1), 6)!.point.z).toBeCloseTo(-0.1, 5);
    expect(world.raycast(v(-3, 1.5, -3), v(0, 0, 1), 6)!.point.z).toBeCloseTo(-0.1, 5);
    expect(world.raycast(v(0, 2.6, -3), v(0, 0, 1), 6)).not.toBeNull();
    // A player walks through the door.
    const s = { ...createMoveState(0, 0, -2), onGround: true };
    for (let i = 0; i < 60; i++) stepMove(world, s, Buttons.BACK, 0, 1 / 60);
    expect(s.z).toBeGreaterThan(1);
  });

  it('rot180 turns boxes, ramps, faces, decals and spawns half round the origin', () => {
    const k = new MapKit();
    k.with('rot180', () => {
      k.aabb(1, 0, 2, 3, 1, 5, 'm', { ramp: '+x', faceMats: { px: 'a', nz: 'b' } });
      k.wallDecal(2, 1, 'd', 4, 0, 1, Math.PI / 2);
    });
    const b = k.brushes[0]!;
    expect(b.min).toEqual({ x: -3, y: 0, z: -5 });
    expect(b.max).toEqual({ x: -1, y: 1, z: -2 });
    expect(b.ramp).toBe('-x');
    expect(b.faceMats).toEqual({ nx: 'a', pz: 'b' });
    expect(k.decals[0]!.x).toBe(-4);
    expect(k.decals[0]!.z).toBe(-1);
    expect(Math.sin(k.decals[0]!.ry!)).toBeCloseTo(-1, 6);
    const sp = k.withValue('rot180', () => k.spawn(5, 0, 2, -Math.PI / 2));
    expect(sp).toMatchObject({ x: -5, z: -2 });
    expect(sp.yaw).toBeCloseTo(Math.PI / 2, 6);
  });

  it('stairs: players climb the clip ramp, the steps stop bullets but not players', () => {
    const k = new MapKit();
    k.aabb(-10, -1, -10, 10, 0, 10, 'g');
    k.stairs(0, 0, -0.6, 4, 3, 0.6, '+x', 'wood', 10);
    k.aabb(4, 2.8, -0.6, 8, 3, 0.6, 'floor');
    const map = { ...emptyMap(), brushes: k.brushes };
    const solids = mapSolids(map);
    expect(solids.filter((s) => s.ramp && s.players && !s.bullets)).toHaveLength(1);
    expect(solids.filter((s) => !s.players && s.bullets)).toHaveLength(10);
    const r = walkRoute(buildCollisionWorld(map), v(-2, 0, 0), [v(6, 3, 0)]);
    expect(r.state.y).toBeCloseTo(3, 1);
  });

  it('groundWithHoles leaves the holes open and the rest solid', () => {
    const k = new MapKit();
    k.groundWithHoles([-10, -10, 10, 10], 0, 1, 'g', [[-2, -1, 2, 1], [5, 5, 7, 9]]);
    const world = buildCollisionWorld({ ...emptyMap(), brushes: k.brushes });
    expect(world.groundBelow(0, 0, 0.5, 2)).toBeNull();
    expect(world.groundBelow(6, 7, 0.5, 2)).toBeNull();
    expect(world.groundBelow(0, 3, 0.5, 2)).toBe(0);
    expect(world.groundBelow(-8, -8, 0.5, 2)).toBe(0);
    expect(world.groundBelow(8, 0, 0.5, 2)).toBe(0);
  });
});

for (const id of IDS) {
  describe(`maps-bo: ${id}`, () => {
    const map = getMapData(id);
    const world = buildCollisionWorld(map);

    it('spawns: enough for 6v6 and FFA, standing on ground, free, well inside the bounds', () => {
      expect(map.spawns.teams[0].length).toBeGreaterThanOrEqual(6);
      expect(map.spawns.teams[1].length).toBeGreaterThanOrEqual(6);
      expect(map.spawns.ffa.length).toBeGreaterThanOrEqual(12);
      expect(map.modeSpawns?.sd?.attackers?.length).toBeGreaterThanOrEqual(6);
      expect(map.modeSpawns?.sd?.defenders?.length).toBeGreaterThanOrEqual(6);
      for (const s of allSpawns(map)) {
        const g = world.groundBelow(s.x, s.z, s.y + 0.2, 0.4);
        expect(g, `ground under ${JSON.stringify(s)}`).not.toBeNull();
        expect(Math.abs(g! - s.y), `spawn height ${JSON.stringify(s)}`).toBeLessThan(0.05);
        expect(world.free(s.x, g! + 0.01, s.z), `free at ${JSON.stringify(s)}`).toBe(true);
        expect(s.x - map.bounds.min.x).toBeGreaterThan(1);
        expect(map.bounds.max.x - s.x).toBeGreaterThan(1);
        expect(s.z - map.bounds.min.z).toBeGreaterThan(1);
        expect(map.bounds.max.z - s.z).toBeGreaterThan(1);
      }
    });

    it('team spawns are spread apart and far from each other', () => {
      const [a, b] = map.spawns.teams;
      for (const set of [a, b]) for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) expect(Math.hypot(set[i]!.x - set[j]!.x, set[i]!.z - set[j]!.z)).toBeGreaterThan(1.5);
      for (const p of a) for (const q of b) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(40);
    });

    it('objectives: dom A/B/C, sd A/B away from the attackers, hq points; all on the ground', () => {
      expect(map.objectives.dom!.map((o) => o.id)).toEqual(['A', 'B', 'C']);
      expect(map.objectives.sd!.map((o) => o.id)).toEqual(['A', 'B']);
      expect(map.objectives.hq!.length).toBeGreaterThanOrEqual(6);
      for (const list of Object.values(map.objectives))
        for (const o of list) {
          const g = world.groundBelow(o.x, o.z, o.y + 0.2, 0.4);
          expect(g, `${o.id} ground`).not.toBeNull();
          expect(Math.abs(g! - o.y)).toBeLessThan(0.05);
          expect(o.radius).toBeGreaterThan(1);
        }
      for (const site of map.objectives.sd!) for (const s of map.modeSpawns!.sd!.attackers!) expect(Math.hypot(site.x - s.x, site.z - s.z)).toBeGreaterThan(25);
      // Domination: A by team 0, C by team 1, B in between.
      const d = (o: { x: number; z: number }, set: SpawnPoint[]) => Math.min(...set.map((s) => Math.hypot(s.x - o.x, s.z - o.z)));
      const [A, B, C] = map.objectives.dom!;
      expect(d(A!, map.spawns.teams[0])).toBeLessThan(d(A!, map.spawns.teams[1]));
      expect(d(C!, map.spawns.teams[1])).toBeLessThan(d(C!, map.spawns.teams[0]));
      const b0 = d(B!, map.spawns.teams[0]);
      const b1 = d(B!, map.spawns.teams[1]);
      expect(Math.abs(b0 - b1) / Math.max(b0, b1)).toBeLessThan(0.2);
    });

    it('everything is reachable on foot from a team 0 spawn: spawns, objectives, hotspots, upper floors', () => {
      const r = reach(id);
      for (const s of allSpawns(map)) expect(r.near(s, 0.9), `spawn ${JSON.stringify(s)}`).toBe(true);
      for (const [kind, list] of Object.entries(map.objectives)) for (const o of list) expect(r.near(o, o.radius), `${kind} ${o.id}`).toBe(true);
      for (const h of map.hotspots ?? []) expect(r.near(h, 1.5), `hotspot ${JSON.stringify(h)}`).toBe(true);
      expect(r.nodes.filter((n) => n.y > 2.5).length).toBeGreaterThan(60);
    });

    it('bounds are closed: no reachable spot is outside, and sprinting outwards stops at the clip', () => {
      const r = reach(id);
      const b = map.bounds;
      for (const n of r.nodes) {
        expect(n.x > b.min.x && n.x < b.max.x && n.z > b.min.z && n.z < b.max.z, `node ${JSON.stringify(n)}`).toBe(true);
        expect(n.y).toBeGreaterThan(MOVE.killY);
      }
      // Sprint (and keep jumping) straight out from a few starts in 16 directions for 25 s.
      for (const start of [map.spawns.teams[0][0]!, map.spawns.teams[1][0]!, map.spawns.ffa[1]!]) {
        for (let i = 0; i < 16; i++) {
          const yaw = (i / 16) * Math.PI * 2;
          const s = { ...createMoveState(start.x, start.y, start.z), onGround: true };
          for (let t = 0; t < 25 * 60; t++) stepMove(world, s, Buttons.FORWARD | Buttons.SPRINT | (t % 40 === 0 ? Buttons.JUMP : 0), yaw, 1 / 60);
          expect(s.x > b.min.x && s.x < b.max.x && s.z > b.min.z && s.z < b.max.z, `${id} ran out at ${s.x.toFixed(1)},${s.z.toFixed(1)}`).toBe(true);
          expect(s.y).toBeGreaterThan(b.min.y);
        }
      }
    });
  });
}

describe('maps-bo walks', () => {
  it('nuketown: green garden -> green back door, kitchen, living room, front door -> circle -> yellow front door, kitchen, back door -> deck -> yellow garden', () => {
    const map = getMapData('nuketown');
    const w = buildCollisionWorld(map);
    const route = [v(-30, 0, -9.1), v(-21.5, 0, -9.1), v(-19, 0, -7), v(-14, 0, -7), v(-11, 0, -8.4), v(-8.4, 0.18, -8.4), v(-3, 0, -8.4), v(-0.3, 0, -4), v(0.4, 0, 3.6), v(7, 0, 3.6), v(9, 0, -0.1), v(12.6, 0.18, -0.1), v(15, 0, -0.1), v(19, 0, -1.5), v(22.5, 0, -1.5), v(26, 0, 0.6), v(28.5, 0.25, 0.6), v(36, 0.25, 0.6), v(38.5, 0, 0.6), v(44, 0, 0.6)];
    const r = walkRoute(w, map.spawns.teams[0][2]!, route);
    // Garden to garden through both houses, at walking pace (sprinting is ~1.45x faster).
    expect(r.seconds).toBeLessThan(25);
  });

  it('nuketown: green stairs up to the study and the front bedroom, out on the balcony, down the back stairs to the patio, round the south side', () => {
    const map = getMapData('nuketown');
    const w = buildCollisionWorld(map);
    const up = walkRoute(w, v(-12, 0, -10), [v(-12.6, 0, -11.6), v(-19.4, 3, -11.6), v(-20, 3, -9.75), v(-15, 3, -9.75), v(-12, 3, -8)]);
    expect(up.state.y).toBeCloseTo(3, 1);
    const out = walkRoute(w, up.state, [v(-15, 3, -9.75), v(-21, 3, -10), v(-24.2, 3, -10), v(-23.85, 3, -7.7), v(-23.85, 0, -1.9), v(-21, 0, 6.4), v(-8, 0, 6.6), v(-4.4, 0, 11)]);
    expect(out.maxY).toBeGreaterThan(2.9);
    expect(out.state.y).toBeCloseTo(0, 1);
  });

  it('nuketown: yellow front door, stairs up, bedroom, balcony, stairs down onto the deck, round the north side through the garage', () => {
    const map = getMapData('nuketown');
    const w = buildCollisionWorld(map);
    const up = walkRoute(w, v(10.5, 0, -0.1), [v(15, 0, -0.1), v(15.5, 0, 3.07), v(16.6, 0, 3.07), v(23.4, 3, 3.07), v(23.4, 3, 1.3), v(18, 3, 1.3), v(16, 3, -1)]);
    expect(up.state.y).toBeCloseTo(3, 1);
    const out = walkRoute(w, up.state, [v(18, 3, 1.3), v(23, 3, 1.3), v(26, 3, 0), v(26, 3, -4), v(28.5, 3, -4), v(29.6, 3, -4.95), v(35.4, 0.25, -4.95), v(36, 0.25, -12), v(30, 0, -13.2), v(24.5, 0, -13), v(22, 0, -12), v(15, 0, -10), v(10, 0, -10)]);
    expect(out.maxY).toBeGreaterThan(2.9);
    expect(out.state.y).toBeCloseTo(0, 1);
  });

  it('nuketown: the porch-side upstairs window is reachable from outside (planter, pillar, porch roof)', () => {
    const map = getMapData('nuketown');
    const w = buildCollisionWorld(map);
    const s = { ...createMoveState(-6.5, 0, -2.6), onGround: true };
    for (const p of [v(-8.6, 0.85, -3.0), v(-8.35, 1.7, -3.7), v(-8.8, 2.55, -4.6), v(-9.0, 2.55, -5.7), v(-10.6, 3.0, -5.7)]) {
      for (let i = 0; i < 240; i++) {
        const d = Math.hypot(p.x - s.x, p.z - s.z);
        if (d < 0.15 && s.onGround) break;
        stepMove(w, s, (d > 0.15 ? Buttons.FORWARD : 0) | (s.onGround && p.y > s.y + 0.3 ? Buttons.JUMP : 0), Math.atan2(-(p.x - s.x), -(p.z - s.z)), 1 / 60);
      }
      for (let i = 0; i < 60 && !s.onGround; i++) stepMove(w, s, 0, 0, 1 / 60);
      expect(s.y, `hop to ${JSON.stringify(p)}`).toBeCloseTo(p.y, 1);
    }
    expect(s.x).toBeLessThan(-9.9);
  });

  it('firing range: west spawn -> booths -> cabin stairs -> catwalk -> NE tower -> east spawn', () => {
    const map = getMapData('firingrange');
    const w = buildCollisionWorld(map);
    const r = walkRoute(w, map.spawns.teams[0][2]!, [v(-20, 0, -12), v(-14, 0, -14.5), v(0, 0, -14.5), v(6.9, 0, -20.5), v(6.9, 3.2, -27.9), v(8.2, 3.2, -29.1), v(21, 3.2, -29.1), v(24, 3.2, -28.6), v(25.6, 3.2, -28.6), v(26.7, 3.1, -28.9), v(26.7, 0, -22.6), v(35, 0, -22), v(42, 0, 0)]);
    expect(r.maxY).toBeGreaterThan(3.1);
  });

  it('firing range: the trench and bunker, the cabin inside stairs, the SW tower', () => {
    const map = getMapData('firingrange');
    const w = buildCollisionWorld(map);
    const trench = walkRoute(w, map.spawns.teams[0][4]!, [v(-20, 0, 14), v(0, 0, 20.75), v(10, -1, 20.75), v(27, -1, 20.75), v(30, -1, 20.75), v(34.5, -1, 20.75), v(39, 0, 20.75), v(42, 0, 10)]);
    expect(trench.state.y).toBeCloseTo(0, 1);
    const cabin = walkRoute(w, v(1.5, 0, -18), [v(1.5, 0.3, -22.5), v(-3.15, 0.3, -21.7), v(-3.15, 3.2, -28.6), v(-1.5, 3.2, -28.6), v(2, 3.2, -26)]);
    expect(cabin.state.y).toBeCloseTo(3.2, 1);
    const tower = walkRoute(w, v(-18, 0, 27), [v(-21.6, 0, 26.85), v(-29, 4, 26.85), v(-30, 4, 28)]);
    expect(tower.state.y).toBeCloseTo(4, 1);
  });
});

describe('maps-bo bot nav: nuketown', () => {
  it('the bots NavGrid finds a path from both team spawns to every objective, hotspot and spawn, both upper floors included', () => {
    const map = getMapData('nuketown');
    const nav = new NavGrid(map);
    const targets: { name: string; p: Vec3; r: number }[] = [
      ...Object.entries(map.objectives).flatMap(([kind, list]) => list.map((o) => ({ name: `${kind} ${o.id}`, p: v(o.x, o.y, o.z), r: o.radius }))),
      ...(map.hotspots ?? []).map((h, i) => ({ name: `hotspot ${i}`, p: h, r: 1.5 })),
      ...allSpawns(map).map((s, i) => ({ name: `spawn ${i}`, p: v(s.x, s.y, s.z), r: 1.2 })),
    ];
    for (const from of [map.spawns.teams[0][0]!, map.spawns.teams[1][0]!]) {
      for (const t of targets) {
        const path = nav.path(from, t.p);
        expect(path, `${t.name} from ${from.x},${from.z}`).not.toBeNull();
        const end = path!.at(-1)!;
        expect(Math.hypot(end.x - t.p.x, end.z - t.p.z), t.name).toBeLessThan(t.r + 0.6);
        expect(Math.abs(end.y - t.p.y), t.name).toBeLessThan(0.6);
      }
    }
    // Upstairs in both houses is in the graph.
    expect(nav.cellAt(v(-13, 3, -8.6))!.y).toBeCloseTo(3, 1);
    expect(nav.cellAt(v(17, 3, 0))!.y).toBeCloseTo(3, 1);
  });
});

describe('maps-bo sightlines', () => {
  const eye = PLAYER.eye;
  it('nuketown: window to window over the truck; the bedrooms overlook the circle; the side alleys run clear; houses, bus and trailer block', () => {
    const w = buildCollisionWorld(getMapData('nuketown'));
    // The classic: green upstairs bedroom window to the yellow one, over the trailer.
    expect(w.lineOfSight(v(-10.2, 3 + eye, -5.7), v(14.2, 3 + eye, -2.8))).toBe(true);
    expect(w.lineOfSight(v(-10.2, 3 + eye, -10.1), v(14.2, 3 + eye, 1.6))).toBe(true);
    // Each front bedroom looks down into the circle.
    expect(w.lineOfSight(v(-11, 3 + eye, -10.1), v(0, eye, -4))).toBe(true);
    expect(w.lineOfSight(v(15, 3 + eye, -2.8), v(1, eye, 5.5))).toBe(true);
    // Side alleys: green south (stepping stones) and north, yellow south.
    expect(w.lineOfSight(v(-28, eye, 6.6), v(-8, eye, 6.6))).toBe(true);
    expect(w.lineOfSight(v(-36, eye, -14.2), v(-10, eye, -14.2))).toBe(true);
    expect(w.lineOfSight(v(24, eye, 5.4), v(40, eye, 5.4))).toBe(true);
    // Garden to garden is blocked by both houses; the bus and the trailer block across the circle.
    expect(w.lineOfSight(v(-37, eye, -6), v(44, eye, 0))).toBe(false);
    expect(w.lineOfSight(v(-5, eye, 4), v(0.5, eye, 4))).toBe(false);
    expect(w.lineOfSight(v(0, eye, -6), v(6, eye, -6))).toBe(false);
  });

  it('firing range: the lanes are a long sightline; the berm shields the east spawn; the bunker slit sees out', () => {
    const w = buildCollisionWorld(getMapData('firingrange'));
    expect(w.lineOfSight(v(-8, eye, 0.6), v(29, eye, 0.6))).toBe(true);
    expect(w.lineOfSight(v(-8, eye, 0.6), v(42, eye, 0.6))).toBe(false);
    expect(w.lineOfSight(v(28.3, -1 + eye, 17.2), v(28.3, 0.7, 5))).toBe(true);
    expect(w.lineOfSight(v(28.3, -1 + eye, 17.2), v(26.5, -1 + eye, 30))).toBe(false);
  });
});

function emptyMap(): MapData {
  return {
    id: 't',
    name: 't',
    bounds: { min: { x: -20, y: -5, z: -20 }, max: { x: 20, y: 20, z: 20 } },
    materials: {},
    brushes: [],
    decals: [],
    props: [],
    lights: [],
    spawns: { teams: [[], []], ffa: [] },
    objectives: {},
    times: [],
    defaultTime: '',
  };
}
