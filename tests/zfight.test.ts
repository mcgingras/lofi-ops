/**
 * Z-fighting: the coplanar-overlap detector (shared maps/faces.ts) on small hand-made maps, and on
 * every real map the depth plan the renderer uses must leave no visible fight unsettled.
 * `npx tsx scripts/zfight.ts -v --map=<id>` lists the pairs.
 */
import { describe, expect, it } from 'vitest';
import { getMapData, MAPS } from '../src/shared/defs/maps';
import { faceKey, findDepthFights, mapFaces, planDepth, winner, type DepthFight } from '../src/shared/maps/faces';
import { box, flatDecal, type MapData, mapSolids } from '../src/shared/maps/types';

function mini(o: Partial<MapData>): MapData {
  return {
    id: 'mini',
    name: 'Mini',
    bounds: { min: { x: -50, y: -5, z: -50 }, max: { x: 50, y: 20, z: 50 } },
    materials: { a: { texture: 'a' }, b: { texture: 'b' }, b2: { texture: 'b' }, cut: { texture: 'c', side: 'double' }, paint: { texture: 'p' }, clip: { texture: 'none' } },
    brushes: [],
    decals: [],
    props: [],
    lights: [],
    spawns: { teams: [[], []], ffa: [] },
    objectives: {},
    times: [],
    defaultTime: 'x',
    ...o,
  };
}

const names = (map: MapData, f: DepthFight) => [f.a, f.b].map((x) => faceKey(x.src)).sort();

describe('depth fight detector', () => {
  it('finds a floor strip flush with the slab it lies on, and the strip wins', () => {
    const map = mini({ brushes: [box(20, 1, 20, 'a', 0, -1, 0), box(2, 0.2, 10, 'b', 0, -0.2, 0)] });
    const fights = findDepthFights(map, mapFaces(map));
    const top = fights.find((f) => f.kind === 'coplanar' && names(map, f).join() === 'b0.py,b1.py')!;
    expect(top).toBeDefined();
    expect(top.area).toBeCloseTo(20, 6);
    expect(top.buried).toBe(false);
    expect(faceKey(winner(top).src)).toBe('b1.py');
    // The strip's bottom sits inside the slab: a fight nobody can see.
    expect(fights.filter((f) => !f.buried).map((f) => names(map, f).join())).toEqual(['b0.py,b1.py']);
  });

  it('ignores faces that only touch along an edge, and parallel faces further apart than NEAR_GAP', () => {
    const map = mini({ brushes: [box(2, 2, 2, 'a', 0, 0, 0), box(2, 2, 2, 'b', 2, 0, 0), box(2, 2, 2, 'b', 0, 0, 2.05)] });
    expect(findDepthFights(map, mapFaces(map))).toEqual([]);
  });

  it('reports near-parallel faces (a few mm apart) and lets the front one win', () => {
    const map = mini({ brushes: [box(4, 3, 0.2, 'a', 0, 0, 0), box(1, 1, 0.2, 'b', 0, 1, 0.005)] });
    const f = findDepthFights(map, mapFaces(map)).find((x) => x.kind === 'near' && names(map, x).join() === 'b0.pz,b1.pz')!;
    expect(f).toBeDefined();
    expect(Math.abs(f.gap)).toBeCloseTo(0.005, 6);
    expect(faceKey(winner(f).src)).toBe('b1.pz');
  });

  it('handles rotated boxes and decals', () => {
    const map = mini({
      brushes: [box(20, 1, 20, 'a', 0, -1, 0), box(2, 1, 4, 'b', 3, 0, 0, { ry: Math.PI / 4 }), box(2, 1, 4, 'b', 3, 0, 0, { ry: Math.PI / 4, hide: ['ny'] })],
      decals: [flatDecal(3, 3, 'paint', -3, 0, 0, { ry: 0.3 })],
    });
    const fights = findDepthFights(map, mapFaces(map)).filter((f) => !f.buried);
    // The duplicate rotated box fights face for face (5 shared faces: the second hides its bottom).
    expect(fights.filter((f) => names(map, f)[0]!.startsWith('b1.') && names(map, f)[1]!.startsWith('b2.')).length).toBe(5);
    const d = fights.find((f) => names(map, f).includes('d0'))!;
    expect(d.kind).toBe('coplanar');
    expect(d.area).toBeCloseTo(9, 6);
    expect(faceKey(winner(d).src)).toBe('d0');
  });

  it('a double-sided face lying on an opaque one fights from behind ("opposed")', () => {
    const map = mini({ brushes: [box(20, 1, 20, 'a', 0, -1, 0), box(3, 1, 0.1, 'cut', 0, 0, 0)] });
    const f = findDepthFights(map, mapFaces(map)).find((x) => x.kind === 'opposed')!;
    expect(names(map, f)).toEqual(['b0.py', 'b1.ny']);
    expect(faceKey(winner(f).src)).toBe('b0.py');
  });
});

describe('depth plan', () => {
  it('drops hidden duplicates instead of offsetting them, and levels the rest', () => {
    const map = mini({
      brushes: [
        box(20, 1, 20, 'a', 0, -1, 0),
        // A wall and a second wall overlapping its end: the end cap lies inside the long side.
        box(10, 3, 0.25, 'b', 0, 0, 0),
        box(0.25, 3, 6, 'b2', 4.875, 0, 2.875),
        // Trim flush on the wall (another material): must stay visible, so it gets a level.
        box(0.2, 3, 0.25, 'a', -2, 0, 0),
        // Lattice panel standing on the floor: its bottom lies on the ground.
        box(3, 1, 0.1, 'cut', 0, 0, 5),
      ],
    });
    const plan = planDepth(map);
    expect(plan.unresolved).toEqual([]);
    expect(plan.drop.has('b4.ny')).toBe(true);
    // The walls' ends lie inside each other's sides (same look): b2's -z end in b1's -z side, b1's
    // +x end in b2's +x side.
    expect(plan.drop.has('b2.nz')).toBe(true);
    expect(plan.drop.has('b1.px')).toBe(true);
    expect(plan.level.get('b1.nz') ?? 0).toBe(0);
    expect(plan.level.get('b3.pz')).toBeGreaterThan(plan.level.get('b1.pz') ?? 0);
    expect(plan.level.get('b3.nz')).toBeGreaterThan(plan.level.get('b1.nz') ?? 0);
  });

  it('stacks flush decals by draw order and keeps them one level over their surface', () => {
    const map = mini({
      brushes: [box(40, 1, 40, 'a', 0, -1, 0)],
      decals: [flatDecal(10, 10, 'paint', 0, 0.01, 0), flatDecal(10, 10, 'b', 1, 0.0102, 0, { ry: 0.4 }), flatDecal(10, 10, 'paint', 2, 0.0104, 0, { ry: 0.8 }), flatDecal(4, 4, 'b', 0, 3, 0)],
    });
    const plan = planDepth(map);
    expect(plan.unresolved).toEqual([]);
    expect([...plan.flush.entries()].sort()).toEqual([['d0', 0], ['d1', 1], ['d2', 2]]);
    for (const k of ['d0', 'd1', 'd2']) expect(plan.level.get(k)).toBe(1);
    // A decal floating in the air is not flush.
    expect(plan.flush.has('d3')).toBe(false);
  });

  it('never touches the map: collision solids are identical before and after planning', () => {
    for (const def of MAPS) {
      const map = getMapData(def.id);
      const before = JSON.stringify(mapSolids(map));
      const data = JSON.stringify([map.brushes, map.decals, map.props]);
      planDepth(map);
      expect(JSON.stringify(mapSolids(map))).toBe(before);
      expect(JSON.stringify([map.brushes, map.decals, map.props])).toBe(data);
    }
  });

  for (const def of MAPS) {
    it(`${def.id}: every visible fight has a stable winner`, () => {
      const map = getMapData(def.id);
      const plan = planDepth(map);
      const visible = plan.fights.filter((f) => !f.buried);
      expect(visible.length).toBeGreaterThan(0);
      expect(plan.unresolved.map((f) => `${f.kind} ${faceKey(f.a.src)} / ${faceKey(f.b.src)}`)).toEqual([]);
      // Offsets stay small: a handful of levels (each is 2 depth steps, see mapbuilder depthOffset).
      expect(plan.maxLevel).toBeLessThanOrEqual(6);
    });
  }
});
