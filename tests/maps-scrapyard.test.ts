/**
 * Scrapyard (MW2): layout checks against the reference in docs/maps/scrapyard-reference.md (the
 * MW2 minimap, 1 m = 9.5 px), the bot nav reaching every objective and upper level, and the
 * signature sightlines and routes. The generic map checks (spawns, walk flood, bounds) are in
 * maps-mw2.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { NavGrid } from '../src/server/features/bots/nav';
import { PLAYER } from '../src/shared/constants';
import { getMapData } from '../src/shared/defs/maps';
import { SCRAPYARD_LEVELS } from '../src/shared/maps/scrapyard';
import { buildCollisionWorld } from '../src/shared/maps/types';
import type { Vec3 } from '../src/shared/math';

const map = getMapData('scrapyard');
const world = buildCollisionWorld(map);
let nav: NavGrid | null = null;
const grid = () => (nav ??= new NavGrid(map));

/** Does the nav graph get from `from` to a cell standing at `to` (same floor, within 1.2 m)? */
function navReaches(from: Vec3, to: Vec3): boolean {
  const g = grid();
  const path = g.path(from, to);
  if (!path) return false;
  const end = path.at(-1)!;
  return Math.hypot(end.x - to.x, end.z - to.z) < 1.2 && Math.abs(end.y - to.y) < 0.6;
}

/** Top of whatever is under (x, z) below `fromY` (null = nothing). */
const floorAt = (x: number, z: number, fromY = 30) => world.groundBelow(x, z, fromY, 40);

describe('scrapyard layout (reference: MW2 minimap)', () => {
  it('is the small 51 x 80 m yard, running north-south', () => {
    const b = map.bounds;
    expect(b.max.x - b.min.x).toBeGreaterThan(50);
    expect(b.max.x - b.min.x).toBeLessThan(58);
    expect(b.max.z - b.min.z).toBeGreaterThan(85);
    expect(b.max.z - b.min.z).toBeLessThan(95);
  });

  it('has the four side buildings where the minimap puts them (roofed)', () => {
    // Red Warehouse (north, two storeys), Blue Warehouse (south), Storage (west), Forklift (east).
    const roofs: [string, number, number, number][] = [
      ['red warehouse', 2, -44, 6],
      ['red warehouse wing', -4.6, -36, 6],
      ['blue warehouse', 2, 34, 7],
      ['storage', -20, -6, 4],
      ['forklift', 19.5, -8, 4.4],
      ['shed', 19.4, -23.7, 2.9],
    ];
    for (const [name, x, z, h] of roofs) expect(floorAt(x, z), name).toBeGreaterThan(h);
    // The fuselages: cabin floors one step up, roofs at fuselageRoof.
    for (const [x, z] of [[-4, 6], [-1, -6.6], [7.5, -21], [-2.2, -22], [7.3, 2], [7.8, 13]] as const) {
      expect(floorAt(x, z, 3), `cabin ${x},${z}`).toBeCloseTo(SCRAPYARD_LEVELS.fuselage, 1);
      expect(floorAt(x, z), `roof ${x},${z}`).toBeCloseTo(SCRAPYARD_LEVELS.fuselageRoof, 1);
    }
  });

  it('puts the teams in the diagonal corners like MW2 (north-west vs south)', () => {
    const mean = (l: { x: number; z: number }[]) => ({ x: l.reduce((s, p) => s + p.x, 0) / l.length, z: l.reduce((s, p) => s + p.z, 0) / l.length });
    const t0 = mean(map.spawns.teams[0]);
    const t1 = mean(map.spawns.teams[1]);
    expect(t0.x).toBeLessThan(-10);
    expect(t0.z).toBeLessThan(-28);
    expect(t1.z).toBeGreaterThan(28);
    // Domination: A by the Red Warehouse, B in Storage, C by the burning truck.
    const dom = Object.fromEntries(map.objectives.dom!.map((o) => [o.id, o]));
    expect(dom.A!.z).toBeLessThan(-28);
    expect(dom.B!.x).toBeLessThan(-15);
    expect(dom.C!.x).toBeGreaterThan(15);
    // S&D: A in Storage, B at the gas tanks; attackers start by the shed (north-east).
    const sd = Object.fromEntries(map.objectives.sd!.map((o) => [o.id, o]));
    expect(sd.A!.x).toBeLessThan(-15);
    expect(sd.B!.z).toBeGreaterThan(15);
    for (const s of map.modeSpawns!.sd!.attackers!) expect(s.z).toBeLessThan(-28);
    for (const s of map.modeSpawns!.sd!.defenders!) expect(s.z).toBeGreaterThan(28);
  });

  it('keeps the warehouse-to-warehouse sniper line and the open east lane', () => {
    const eye = PLAYER.eye;
    // Blue Warehouse catwalk window -> Red Warehouse upstairs window, over the fuselages (~68 m).
    expect(world.lineOfSight({ x: 6.8, y: SCRAPYARD_LEVELS.catwalk + eye, z: 29.3 }, { x: 5.6, y: SCRAPYARD_LEVELS.office + eye, z: -39.8 })).toBe(true);
    // The fuselages block that line at standing height on the ground.
    expect(world.lineOfSight({ x: 2.2, y: eye, z: 27 }, { x: 2.2, y: eye, z: -33 })).toBe(false);
    // East lane: from the shed corner to the gas tanks.
    expect(world.lineOfSight({ x: 12.6, y: eye, z: -28 }, { x: 12.6, y: eye, z: 21 })).toBe(true);
    // West lane: along the low wall from Storage's porch past the truck to the south-west yard.
    expect(world.lineOfSight({ x: -11.5, y: eye, z: -8 }, { x: -11.5, y: eye, z: 20 })).toBe(true);
  });

  it('spawns for S&D roles stand free on the ground', () => {
    for (const s of [...map.modeSpawns!.sd!.attackers!, ...map.modeSpawns!.sd!.defenders!]) {
      const g = world.groundBelow(s.x, s.z, s.y + 1, 3);
      expect(g, `${s.x},${s.z}`).not.toBeNull();
      expect(Math.abs(g! - s.y)).toBeLessThan(0.3);
      expect(world.free(s.x, g! + 0.05, s.z), `${s.x},${s.z}`).toBe(true);
    }
  });
});

describe('scrapyard bot nav', () => {
  const starts = [map.spawns.teams[0][0]!, map.spawns.teams[1][0]!];

  it('reaches every objective from both team spawns', () => {
    for (const from of starts)
      for (const [kind, list] of Object.entries(map.objectives))
        for (const o of list) expect(navReaches(from, o), `${kind} ${o.id} from ${from.x},${from.z}`).toBe(true);
  });

  it('reaches every roam point, upper floors included (stairs, crates, the wing ramp)', () => {
    for (const from of starts) for (const h of map.hotspots!) expect(navReaches(from, h), `hotspot ${h.x},${h.y},${h.z}`).toBe(true);
  });

  it('walks through the fuselages on their cabin floors', () => {
    const g = grid();
    // Through the north tube end to end.
    const path = g.path({ x: 7.55, y: 0, z: -29 }, { x: 7.55, y: 0, z: -13.5 })!;
    expect(path).not.toBeNull();
    expect(path.some((c) => c.z > -26 && c.z < -17 && Math.abs(c.y - SCRAPYARD_LEVELS.fuselage) < 0.05)).toBe(true);
    // Into the long fuselage through its west door.
    expect(navReaches({ x: -8, y: 0, z: 2.6 }, { x: -4, y: SCRAPYARD_LEVELS.fuselage, z: 2.6 })).toBe(true);
  });

  it('S&D attackers reach both sites and defenders reach the catwalk', () => {
    const a = map.modeSpawns!.sd!.attackers![0]!;
    const d = map.modeSpawns!.sd!.defenders![0]!;
    for (const s of map.objectives.sd!) expect(navReaches(a, s), `site ${s.id}`).toBe(true);
    expect(navReaches(d, { x: 2, y: SCRAPYARD_LEVELS.catwalk, z: 29.7 })).toBe(true);
  });
});
