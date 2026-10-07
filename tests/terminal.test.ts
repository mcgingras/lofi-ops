/**
 * Terminal (full-map rebuild, docs/maps/terminal-reference.md): layout checks against the reference
 * overhead, plus bot-nav reachability. The generic spawn / objective / walk checks for every MW2
 * map live in maps-mw2.test.ts; these pin what makes Terminal Terminal: the two levels, the routes
 * between them, the walk-through plane with its three exits, and the signature sightlines.
 */
import { describe, expect, it } from 'vitest';
import { NavGrid } from '../src/server/features/bots/nav';
import { MAP_BY_ID, getMapData } from '../src/shared/defs/maps';
import { TERMINAL_LEVELS } from '../src/shared/maps/terminal';
import { buildCollisionWorld } from '../src/shared/maps/types';
import type { Vec3 } from '../src/shared/math';
import { floodWalk } from './maps-mw2-walk';

const map = getMapData('terminal');
const world = buildCollisionWorld(map);
const U = TERMINAL_LEVELS.upper;
const C = TERMINAL_LEVELS.cabin;
const eye = (x: number, y: number, z: number): Vec3 => ({ x, y: y + 1.6, z });

let grid: NavGrid | null = null;
const nav = () => (grid ??= new NavGrid(map));

describe('terminal: registry and footprint', () => {
  it('is the full map, not a compact section', () => {
    const def = MAP_BY_ID.get('terminal')!;
    expect(def.inspiredBy).toMatch(/Terminal \(Call of Duty: Modern Warfare 2, 2009\)/);
    expect(def.inspiredBy).not.toMatch(/compact/);
    expect(def.size).toBe('large');
    const b = map.bounds;
    // Reference overhead: about 115 x 79 m of play space.
    expect(b.max.x - b.min.x).toBeGreaterThan(110);
    expect(b.max.z - b.min.z).toBeGreaterThan(75);
  });

  it('keeps the brush count sensible for the bake and the client', () => {
    expect(map.brushes.length).toBeLessThan(900);
    expect(map.lights.length).toBeLessThan(48);
  });
});

describe('terminal: levels', () => {
  const floor = (x: number, z: number, from: number) => world.groundBelow(x, z, from, 6);

  it('Security, Shopping, Bookstore, Dining, the Upper Lounge and the Hallway are on the concourse', () => {
    for (const [name, x, z] of [['Security', -48.5, 5], ['atrium', -22, 25], ['Bookstore', -7.4, 2.4], ['Dining', -10, -31.5], ['Burger Town', -25.5, -16.5], ['Upper Lounge', 9.5, -19], ['Hallway', 2.4, 6], ['Makeup Store', -6, 33.6]] as const) {
      expect(floor(x, z, U + 1), name).toBeCloseTo(U, 1);
    }
  });

  it('the Lower Lounge, Maintenance and the apron are on the ground; the cabin and the Maintenance roof are up', () => {
    for (const [name, x, z] of [['Lower Lounge', 31, -25], ['Maintenance', 9, -8], ['apron', 30, 4], ['NE strip', 47, -28]] as const) expect(floor(x, z, 2), name).toBeCloseTo(0, 1);
    expect(floor(37, 14.05, C + 1)).toBeCloseTo(C, 1);
    expect(floor(14, -8, TERMINAL_LEVELS.maintenanceRoof + 1)).toBeCloseTo(TERMINAL_LEVELS.maintenanceRoof, 1);
    // Under the jet bridge and under the wings there is headroom on the apron.
    expect(world.free(13, 0, 20.2)).toBe(true);
    expect(world.free(38, 0, 8.5)).toBe(true);
    expect(world.free(38, 0, 19.5)).toBe(true);
  });

  it('the two shop blocks are solid and the Bookstore passage runs between them', () => {
    expect(world.lineOfSight(eye(-20, U, -14), eye(3, U, -14))).toBe(false);
    expect(world.lineOfSight(eye(-20, U, 12), eye(3, U, 12))).toBe(false);
    // Straight through the Bookstore doors, west to east.
    expect(world.lineOfSight(eye(-18, U, 1.8), eye(3, U, 1.8))).toBe(true);
  });
});

/**
 * The play space outline from the reference overhead (docs/maps/terminal-reference.md), clockwise
 * from Burger Town's north-west corner: concourse, Lower Lounge, the NE strip, the apron with its
 * cut south-east corner, back along the Hallway, the Makeup Store and the Shopping lobe to Security.
 */
const OUTLINE: [number, number][] = [
  [-30, -28], [-24.4, -28], [-24.4, -33.75], [-16.9, -33.75], [-16.9, -35], [-1.6, -35], [-1.6, -37.8], [34.9, -37.8], [34.9, -32.2],
  [42.4, -32.2], [42.4, -36.6], [54.9, -36.6], [54.9, -21], [57.7, -21], [57.7, 18.1], [45, 28.4], [5.2, 28.4], [5.2, 36.6], [-11.9, 36.6],
  [-11.9, 40], [-20, 40], [-30.6, 30], [-30.6, 28.4], [-34.4, 28.4], [-34.4, 26], [-42.2, 26], [-42.2, 16.6], [-50.9, 16.6], [-50.9, 9.1],
  [-56.9, 9.1], [-56.9, -0.6], [-50.9, -0.6], [-50.9, -7.8], [-30, -7.8],
];
function insideOutline(x: number, z: number, tol = 0.6): boolean {
  let inside = false;
  let near = Infinity;
  for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
    const [xi, zi] = OUTLINE[i]!;
    const [xj, zj] = OUTLINE[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    const dx = xj - xi;
    const dz = zj - zi;
    const t = Math.max(0, Math.min(1, ((x - xi) * dx + (z - zi) * dz) / (dx * dx + dz * dz)));
    near = Math.min(near, Math.hypot(x - (xi + t * dx), z - (zi + t * dz)));
  }
  return inside || near < tol;
}

describe('terminal: the play space matches the reference outline', () => {
  it('walking (and jumping) from either spawn never leaves the outline', () => {
    for (const start of [map.spawns.teams[0][0]!, map.spawns.teams[1][0]!]) {
      const res = floodWalk(map, start);
      const out = res.nodes.filter((n) => !insideOutline(n.x, n.z));
      expect(out, `outside at ${JSON.stringify(out.slice(0, 3))}`).toHaveLength(0);
      // ...and it covers both levels and the cabin.
      expect(res.nodes.some((n) => Math.abs(n.y - U) < 0.1 && n.x < -50)).toBe(true);
      expect(res.nodes.some((n) => Math.abs(n.y - C) < 0.1 && n.x > 40)).toBe(true);
      expect(res.nodes.some((n) => n.y < 0.1 && n.x > 50 && n.z < -25)).toBe(true);
    }
  });

  it('every spawn, objective and roam point is inside the outline', () => {
    const pts = [...map.spawns.teams[0], ...map.spawns.teams[1], ...map.spawns.ffa, ...Object.values(map.objectives).flat(), ...(map.hotspots ?? [])];
    for (const p of pts) expect(insideOutline(p.x, p.z, 0), `${p.x},${p.z}`).toBe(true);
  });
});

describe('terminal: sightlines', () => {
  it('the Hallway windows look over the apron (and the apron shoots back in)', () => {
    expect(world.lineOfSight(eye(2.5, U, 6), eye(25, 0, 4))).toBe(true);
    expect(world.lineOfSight(eye(30, 0, -2), eye(2.5, U, 1))).toBe(true);
  });

  it('the customer service desk sees all the way to the plane entrance', () => {
    expect(world.lineOfSight(eye(-29.2, U, 18.6), eye(6.5, U, 19.5))).toBe(true);
  });

  it('the snack bar watches the top of the escalators', () => {
    expect(world.lineOfSight({ x: 24, y: 1.2, z: -28.8 }, eye(12, U, -27))).toBe(true);
  });

  it('the Maintenance roof overlooks the apron and the plane', () => {
    expect(world.lineOfSight(eye(20, TERMINAL_LEVELS.maintenanceRoof, -4.5), eye(30, 0, 10))).toBe(true);
  });

  it('the cabin is covered: nothing sees in through the roof', () => {
    expect(world.lineOfSight({ x: 37, y: 20, z: 14.05 }, eye(37, C, 14.05))).toBe(false);
  });
});

describe('terminal: bot navigation', () => {
  it('builds a nav grid with a large reachable core on both levels', () => {
    const g = nav();
    // Roofs and the sealed space around the building also make cells; the walkable core is what
    // counts (about 5000 m2 of floor, 0.25 m2 per cell).
    expect(g.coreCells.length * 0.25).toBeGreaterThan(4500);
    expect(g.buildMs).toBeLessThan(5000);
    expect(g.coreCells.some((c) => Math.abs(c.y - U) < 0.1)).toBe(true);
    expect(g.coreCells.some((c) => Math.abs(c.y - C) < 0.1)).toBe(true);
  });

  it('paths from both team spawns to every objective point and roam point', () => {
    const g = nav();
    const targets: Vec3[] = [...Object.values(map.objectives).flat(), ...(map.hotspots ?? [])];
    for (const start of [map.spawns.teams[0][0]!, map.spawns.teams[1][0]!]) {
      for (const t of targets) {
        const p = g.path(start, t);
        expect(p, `${start.x},${start.z} -> ${t.x},${t.y},${t.z}`).not.toBeNull();
        const end = p!.at(-1)!;
        expect(Math.hypot(end.x - t.x, end.z - t.z), `${t.x},${t.z}`).toBeLessThan(1.5);
        expect(Math.abs(end.y - t.y), `${t.x},${t.z} level`).toBeLessThan(0.8);
      }
    }
  });

  it('reaches the cabin through each of its three exits (front bridge, side slide, aft airstair)', () => {
    const g = nav();
    const cabin = { x: 37, y: C, z: 14.05 };
    // From the bridge cab, from the foot of the slide and from the foot of the aft stairs.
    for (const from of [{ x: 20, y: C, z: 19 }, { x: 27.9, y: 0, z: 5.4 }, { x: 55.2, y: 0, z: 14.05 }]) {
      const p = g.path(from, cabin);
      expect(p, `${from.x},${from.z}`).not.toBeNull();
      expect(p!.at(-1)!.y).toBeCloseTo(C, 1);
    }
  });

  it('climbs between the levels on foot: escalators, Maintenance stairs and the jet bridge stairs', () => {
    const g = nav();
    for (const [from, to] of [
      [{ x: 22, y: 0, z: -27.3 }, { x: 10, y: U, z: -27.3 }], // escalators
      [{ x: 24, y: 0, z: -2.4 }, { x: 14, y: U, z: -6 }], // Maintenance outside stairs -> roof
      [{ x: 17.5, y: 0, z: 22.6 }, { x: 6.5, y: U, z: 22.6 }], // apron stairs -> jet bridge root
    ] as const) {
      const p = g.path(from, to);
      expect(p, `${from.x},${from.z} -> ${to.x},${to.z}`).not.toBeNull();
      expect(p!.at(-1)!.y).toBeCloseTo(to.y, 1);
      // Climbed by walking (no jump links straight up a wall).
      let prev = g.cellAt(from)!;
      for (const c of p!) {
        expect(c.y - prev.y).toBeLessThan(1.1);
        prev = c;
      }
    }
  });
});

describe('terminal: spawns and objectives follow the original', () => {
  it('team 0 spawns behind Security (west), team 1 in the Lower Lounge (north-east)', () => {
    for (const s of map.spawns.teams[0]) {
      expect(s.x).toBeLessThan(-45);
      expect(s.y).toBeCloseTo(U, 1);
    }
    for (const s of map.spawns.teams[1]) {
      expect(s.x).toBeGreaterThan(20);
      expect(s.z).toBeLessThan(-14.4);
      expect(s.y).toBeCloseTo(0, 1);
    }
  });

  it('Domination: A in Shopping, B in the Hallway, C in Dining; S&D: A in the plane, B in the Upper Lounge', () => {
    const [a, b, c] = map.objectives.dom!;
    expect(a!.z).toBeGreaterThan(18);
    expect(b!.x).toBeGreaterThan(-1);
    expect(b!.x).toBeLessThan(5.2);
    expect(c!.z).toBeLessThan(-28);
    const [sa, sb] = map.objectives.sd!;
    expect(sa!.y).toBeCloseTo(C, 1);
    expect(sa!.x).toBeGreaterThan(17.7);
    expect(sb!.y).toBeCloseTo(U, 1);
    expect(map.modeSpawns?.sd?.attackers?.length).toBeGreaterThanOrEqual(6);
    expect(map.modeSpawns?.sd?.defenders?.length).toBeGreaterThanOrEqual(6);
    for (const s of map.modeSpawns!.sd!.attackers!) expect(s.x).toBeLessThan(-45);
    for (const s of map.modeSpawns!.sd!.defenders!) expect(s.x).toBeGreaterThan(20);
  });
});
