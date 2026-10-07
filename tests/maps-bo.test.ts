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
      expect(r.nodes.filter((n) => n.y > 3).length).toBeGreaterThan(60);
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
  it('nuketown: green backyard -> through the green house -> street -> through the yellow house -> yellow backyard', () => {
    const map = getMapData('nuketown');
    const w = buildCollisionWorld(map);
    const route = [v(-29, 0, -7.6), v(-24, 0, -7.6), v(-23, 0, -4.5), v(-20.5, 0, -4.5), v(-17.5, 0, -4), v(-14.8, 0.2, -4), v(-6, 0, -4), v(0, 0, 0), v(7, 0, 0), v(7, 0, 4), v(14.8, 0.2, 4), v(17.5, 0, 4), v(20.5, 0, 4.5), v(23, 0, 4.5), v(24, 0, 7.6), v(29, 0, 7.6), v(34.8, 0, 1)];
    const r = walkRoute(w, map.spawns.teams[0][2]!, route);
    expect(r.seconds).toBeLessThan(30);
  });

  it('nuketown: up the green house stairs to the upper floor, out to the garage, round the bus lane', () => {
    const map = getMapData('nuketown');
    const w = buildCollisionWorld(map);
    const up = walkRoute(w, v(-20.5, 0, -4.5), [v(-17, 0, -10.15), v(-23.6, 3.3, -10.15), v(-24.5, 3.3, -8), v(-20.2, 3.3, -5), v(-20.2, 3.3, -3), v(-24, 3.3, -1.6 + 1.4)]);
    expect(up.state.y).toBeCloseTo(3.3, 1);
    const down = walkRoute(w, up.state, [v(-20.2, 3.3, -3), v(-20.2, 3.3, -5), v(-24.5, 3.3, -8), v(-23.6, 3.3, -10.15), v(-17, 0, -10.15), v(-19.9, 0, -0.5), v(-19.9, 0, 2.5), v(-22.5, 0, 4.5), v(-16, 0, 4.5), v(-7, 0, 9), v(-6.2, 0, 19.5), v(-0.9, 0, 21.4), v(-0.9, 0, 6)]);
    expect(down.state.y).toBeCloseTo(0, 1);
  });

  // Firing Range: turned buildings are addressed in their own frames (same numbers as firingrange.ts).
  const frame = (ox: number, oz: number, deg: number) => {
    const c = Math.cos((deg * Math.PI) / 180);
    const s = Math.sin((deg * Math.PI) / 180);
    return (u: number, y: number, w: number) => v(ox + u * c - w * s, y, oz + u * s + w * c);
  };
  const SH = frame(-17.2, -15.0, 24);
  const OF = frame(-32.3, 3.0, -20);

  it('firing range: Road spawn -> round to the Shoot House -> through it -> crossroads -> up the Tower ladder', () => {
    const map = getMapData('firingrange');
    const w = buildCollisionWorld(map);
    const r = walkRoute(w, map.spawns.teams[0][2]!, [v(-13.6, 0, -31), v(-20, 0, -22), SH(-1.6, 0, 2.3), SH(1.2, 0, 2.3), SH(10.6, 0, 2.0), SH(10.6, 0, 3.6), SH(10.6, 0, 6.0), v(-12, 0, 5), v(-8.6, 0, 2.7), v(-5.0, 4.6, 2.7)]);
    expect(r.state.y).toBeCloseTo(4.6, 1);
    expect(r.seconds).toBeLessThan(30);
  });

  it('firing range: Shoot House stairs to the upper floor, out onto the west room roof, and back down', () => {
    const w = buildCollisionWorld(getMapData('firingrange'));
    const up = walkRoute(w, SH(1.2, 0, 2.3), [SH(1.5, 0, 0.75), SH(7.8, 3.2, 0.75), SH(7.8, 3.2, 2.6), SH(1.6, 3.2, 3.4), SH(1.6, 3.2, 6.0), SH(4.5, 3.2, 8.5)]);
    expect(up.state.y).toBeCloseTo(3.2, 1);
    const down = walkRoute(w, up.state, [SH(1.6, 3.2, 6.0), SH(1.6, 3.2, 3.4), SH(8.0, 3.2, 2.4), SH(8.0, 3.2, 0.75), SH(1.5, 0, 0.75), SH(1.2, 0, 2.3), SH(-1.6, 0, 2.3)]);
    expect(down.state.y).toBeCloseTo(0, 1);
  });

  it('firing range: the Office end to end, round the Containers and up the Bunker stairs to its roof', () => {
    const w = buildCollisionWorld(getMapData('firingrange'));
    const r = walkRoute(w, v(-29.5, 0, -5), [OF(3.15, 0, -1.2), OF(3.15, 0, 1.0), OF(4.8, 0, 5.5), OF(4.8, 0, 8.5), OF(1.6, 0, 10.0), OF(1.6, 0, 12.8), OF(3.15, 0, 18.5), OF(3.15, 0, 21.2), v(-20, 0, 25.0), v(-14.3, 0, 25.1), v(-14.3, 3.25, 31.0), v(-15.6, 3.25, 33.5)]);
    expect(r.state.y).toBeCloseTo(3.25, 1);
  });

  it('firing range: Dirt Road -> through Storage -> Range courtyard -> through the Garage -> rock path -> crossroads', () => {
    const map = getMapData('firingrange');
    const w = buildCollisionWorld(map);
    const r = walkRoute(w, map.spawns.teams[0][0]!, [v(-13, 0, -30), v(-5, 0, -21), v(3, 0, -14), v(14, 0, -11), v(18.4, 0, -7.4), v(21.6, 0, -7.4), v(21.4, 0, -4.0), v(20.5, 0, -0.5), v(19.5, 0, 2.4), v(20, 0, 5), v(30, 0, 5), v(30, 0, 16), v(27, 0, 16), v(20.5, 0, 14.0), v(16.9, 0, 14.5), v(16.9, 0, 17.5), v(14.5, 0, 17.5), v(10, 0, 15), v(3, 0, 12.5), v(-3, 0, 10), v(-11, 0, 6)]);
    expect(r.state.y).toBeCloseTo(0, 1);
    expect(r.seconds).toBeLessThan(40);
  });

  it('firing range: the crates by the covered shed climb onto its roof (the Dirt Road perch)', () => {
    const w = buildCollisionWorld(getMapData('firingrange'));
    const p = SH(19.0, 0, -3.0);
    const goal = SH(13.0, 0, -3.0);
    const s = { ...createMoveState(p.x, 0, p.z), onGround: true };
    let maxY = 0;
    for (let t = 0; t < 8 * 60; t++) {
      const yaw = Math.atan2(-(goal.x - s.x), -(goal.z - s.z));
      stepMove(w, s, Buttons.FORWARD | (t % 30 === 0 && t < 6 * 60 ? Buttons.JUMP : 0), yaw, 1 / 60);
      maxY = Math.max(maxY, s.y);
    }
    expect(maxY).toBeGreaterThan(2.7);
    expect(s.onGround).toBe(true);
    expect(s.y).toBeCloseTo(2.75, 1);
  });

  it('firing range: turned walls are closed (rays from inside each turned building stop at its walls)', () => {
    const w = buildCollisionWorld(getMapData('firingrange'));
    const B7 = frame(-12.9, 10.6, 14.5);
    const BK = frame(-22.2, 27.6, 19.8);
    for (const [f, W, D, y] of [[SH, 18, 4.6, 2.6], [OF, 6.3, 19.8, 2.6], [B7, 13.2, 6.0, 2.6], [BK, 17.1, 8.5, 2.5]] as const) {
      const c = f(W / 2, y, D / 2);
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const hit = w.raycast(c, v(Math.cos(a), 0, Math.sin(a)), 30);
        expect(hit, `ray ${i} from ${JSON.stringify(c)}`).not.toBeNull();
        expect(hit!.t).toBeLessThan(Math.hypot(W, D) / 2 + 0.6);
      }
    }
  });
});

describe('maps-bo sightlines', () => {
  const eye = PLAYER.eye;
  it('nuketown: the street is a clear lane end to end; the upstairs front windows see each other; the houses block', () => {
    const w = buildCollisionWorld(getMapData('nuketown'));
    expect(w.lineOfSight(v(0, eye, 23.5), v(0, eye, -23.5))).toBe(true);
    expect(w.lineOfSight(v(-16.6, 3.3 + eye, -8), v(16.6, 3.3 + eye, 8))).toBe(true);
    expect(w.lineOfSight(v(-34, eye, -4), v(34, eye, 4))).toBe(false);
    // The bus blocks the view down its west side lane from the east side of the street.
    expect(w.lineOfSight(v(-6.5, eye, 12), v(0, eye, 12))).toBe(false);
  });

  it('firing range: the tower watches the crossroads, the hill splits the map, the Office hall and the Range lanes are open', () => {
    const w = buildCollisionWorld(getMapData('firingrange'));
    expect(w.lineOfSight(v(-4.7, 4.6 + eye, 2.7), v(-20, eye, 8))).toBe(true);
    expect(w.lineOfSight(v(-12, eye, -29), v(22, eye, 16))).toBe(false);
    const c = Math.cos((-20 * Math.PI) / 180);
    const s = Math.sin((-20 * Math.PI) / 180);
    const of = (u: number, y: number, wv: number) => v(-32.3 + u * c - wv * s, y, 3 + u * s + wv * c);
    expect(w.lineOfSight(of(3.15, eye, 0.6), of(3.15, eye, 19.2))).toBe(true);
    expect(w.lineOfSight(v(31, eye, 20), v(55, 1.2, 19))).toBe(true);
    expect(w.lineOfSight(v(-11, 3.25 + eye, 32.5), v(-8, eye, 26))).toBe(true);
    // The Dirt Road from the covered shed roof down to Storage.
    const sh = (u: number, y: number, wv: number) => v(-17.2 + u * Math.cos(0.4189) - wv * Math.sin(0.4189), y, -15 + u * Math.sin(0.4189) + wv * Math.cos(0.4189));
    expect(w.lineOfSight(sh(13, 2.75 + eye, -3), v(17, eye, -11.5))).toBe(true);
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
