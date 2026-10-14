/**
 * Highrise (docs/maps/highrise-reference.md): layout checks against the MW2 minimap outline, the
 * levels (tunnels and pits, roof, helipad, the ledges, the cranes, the south roof), spawns on solid
 * ground, walk tests with the real movement code (the play space is closed except at the open edges,
 * where falling means falling into the void), reachability of every objective and roam point on foot
 * and by the bots' nav grid, every mode building a room, and the signature sightlines.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NavGrid } from '../src/server/features/bots/nav';
import { Lobby } from '../src/server/lobby';
import { Store } from '../src/server/store';
import { MOVE, TICK_DT } from '../src/shared/constants';
import { MAP_BY_ID, getMapData } from '../src/shared/defs/maps';
import { Buttons } from '../src/shared/input';
import { HIGHRISE_AREAS, HIGHRISE_LEVELS as LV, HIGHRISE_MINIMAP, HIGHRISE_ROOF, rectsMinus } from '../src/shared/maps/highrise';
import { buildCollisionWorld } from '../src/shared/maps/types';
import type { Vec3 } from '../src/shared/math';
import { createMoveState, stepMove, type MoveState } from '../src/shared/movement';

const map = getMapData('highrise');
const world = buildCollisionWorld(map);
const eye = (x: number, y: number, z: number): Vec3 => ({ x, y: y + 1.6, z });
const chest = (x: number, y: number, z: number): Vec3 => ({ x, y: y + 1.2, z });
const allSpawns = [...map.spawns.teams[0], ...map.spawns.teams[1], ...map.spawns.ffa];
const floorAt = (x: number, z: number, fromY: number) => world.groundBelow(x, z, fromY + 0.2, 1.0);

/** MW2 minimap px -> map metres (the reference's scale and origin). */
const M = (px: number, py: number): [number, number] => [(px - HIGHRISE_MINIMAP.originPx) / HIGHRISE_MINIMAP.pxPerM, (py - HIGHRISE_MINIMAP.originPy) / HIGHRISE_MINIMAP.pxPerM];

/**
 * The playable outline at floor level, traced from the MW2 minimap (docs/maps/highrise-reference.md),
 * clockwise from the north-west corner of the elevator lobby.
 */
const OUTLINE: [number, number][] = [
  [-28.4, -65.6], [-19.9, -65.6], [-19.9, -58.7], [-4.4, -58.7], [-4.4, -45.1], [11.1, -45.1], [11.1, -37.6], [26.4, -37.6], [26.4, -31.7],
  [19.1, -31.7], [19.1, -28], [22.4, -28], [22.4, -10.9], [26.4, -10.9], [26.4, 11.2], [22.4, 11.2], [22.4, 28], [19.6, 28], [19.6, 32.8],
  [27.6, 32.8], [27.6, 39], [22.3, 39], [22.3, 49.6], [27.6, 49.6], [27.6, 59.7], [18.3, 59.7], [18.3, 49.6], [10.6, 49.6], [10.6, 55.2],
  [-19.6, 55.2], [-19.6, 52], [-12.2, 52], [-12.2, 44.5], [-7.6, 44.5], [-7.6, 36.3], [-19.6, 36.3], [-19.6, 32.8], [-19.9, 32.8], [-19.9, 28],
  [-22.3, 28], [-22.3, 11.2], [-26.3, 11.2], [-26.3, -10.9], [-22.3, -10.9], [-22.3, -28], [-19.9, -28], [-19.9, -31.7], [-28.4, -31.7],
];
function inside(x: number, z: number, tol = 0.6): boolean {
  let inPoly = false;
  let near = Infinity;
  for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
    const [xi, zi] = OUTLINE[i]!;
    const [xj, zj] = OUTLINE[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inPoly = !inPoly;
    const dx = xj - xi;
    const dz = zj - zi;
    const t = Math.max(0, Math.min(1, ((x - xi) * dx + (z - zi) * dz) / (dx * dx + dz * dz)));
    near = Math.min(near, Math.hypot(x - (xi + t * dx), z - (zi + t * dz)));
  }
  return inPoly || near < tol;
}
/** Up in the air on the west side: the cranes, the gondola and the ledge to the north building. */
const craneZone = (p: Vec3) => p.y >= LV.deck - 0.1 && p.x < -19.5;
/** Below the roof: only in the pits, the underpass and the two tunnels (with their stairs). */
const UNDER = [HIGHRISE_AREAS.northPit, HIGHRISE_AREAS.southPit, { minX: -14, maxX: -9, minZ: -8.5, maxZ: -1.3 }, { ...HIGHRISE_AREAS.northTunnel, minZ: -51 }, { ...HIGHRISE_AREAS.southTunnel, maxZ: 52 }];
const underground = (p: Vec3) => UNDER.some((r) => p.x > r.minX - 0.3 && p.x < r.maxX + 0.3 && p.z > r.minZ - 0.3 && p.z < r.maxZ + 0.3);
/** Where a fall may start: the open west and east edges (bulges, the shaft roof, the tank, the deck end), the cranes. */
const openEdge = (p: Vec3) => (Math.abs(p.z) < 11.6 && (p.x < -21.9 || p.x > 21.4)) || craneZone(p);


/**
 * The maps-mw2 walk flood (tests/maps-mw2-walk.ts: walking and running jumps towards the 8
 * neighbouring cells, with the real movement code), recording where each fall started, so falls can
 * be checked against the open edges. Highrise has edges you can fall off; the shared flood only
 * reports where the faller ended up.
 */
interface Fall {
  from: Vec3;
  to: Vec3;
}
interface Walk {
  nodes: Vec3[];
  escapes: Vec3[];
  falls: Fall[];
}
function settle(s: MoveState): boolean {
  for (let t = 0; t < 3 && !s.onGround; t += TICK_DT) {
    stepMove(world, s, 0, 0, TICK_DT);
    if (s.y < MOVE.killY) return false;
  }
  return s.onGround;
}
function walkFlood(start: Vec3, cell = 0.8, maxNodes = 40000): Walk {
  const b = map.bounds;
  const key = (p: Vec3) => `${Math.round(p.x / cell)},${Math.round(p.z / cell)},${Math.round(p.y / 0.6)}`;
  const first = { x: start.x, y: world.groundBelow(start.x, start.z, start.y + 1, 3)!, z: start.z };
  const seen = new Set([key(first)]);
  const out: Walk = { nodes: [first], escapes: [], falls: [] };
  const visit = (s: MoveState) => {
    const p = { x: s.x, y: s.y, z: s.z };
    if (p.x < b.min.x || p.x > b.max.x || p.z < b.min.z || p.z > b.max.z) return void out.escapes.push(p);
    if (seen.has(key(p))) return;
    seen.add(key(p));
    out.nodes.push(p);
  };
  const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
  for (let i = 0; i < out.nodes.length && out.nodes.length < maxNodes; i++) {
    const n = out.nodes[i]!;
    const cx = Math.round(n.x / cell);
    const cz = Math.round(n.z / cell);
    for (const [dx, dz] of DIRS) {
      const tx = (cx + dx) * cell;
      const tz = (cz + dz) * cell;
      const dist = Math.hypot(tx - n.x, tz - n.z);
      const yaw = Math.atan2(-(tx - n.x), -(tz - n.z));
      const s = { ...createMoveState(n.x, n.y, n.z), onGround: true };
      for (let t = 0; t < dist / MOVE.walk; t += TICK_DT) stepMove(world, s, Buttons.FORWARD, yaw, TICK_DT);
      const moved = Math.hypot(s.x - n.x, s.z - n.z);
      if (!settle(s)) {
        out.falls.push({ from: n, to: { x: s.x, y: s.y, z: s.z } });
        continue;
      }
      visit(s);
      if (moved > dist * 0.6) continue;
      const j = { ...createMoveState(n.x, n.y, n.z), onGround: true };
      for (let t = 0; t < 0.1; t += TICK_DT) stepMove(world, j, Buttons.BACK, yaw, TICK_DT);
      settle(j);
      for (let t = 0; t < 0.12; t += TICK_DT) stepMove(world, j, Buttons.FORWARD, yaw, TICK_DT);
      stepMove(world, j, Buttons.FORWARD | Buttons.JUMP, yaw, TICK_DT);
      for (let t = 0; t < 0.5; t += TICK_DT) stepMove(world, j, Buttons.FORWARD, yaw, TICK_DT);
      if (!settle(j)) {
        out.falls.push({ from: n, to: { x: j.x, y: j.y, z: j.z } });
        continue;
      }
      visit(j);
    }
  }
  return out;
}

/** Is there a walk node within `r` (xz) and `dy` (height) of the point? (as maps-mw2-walk `reaches`) */
const reaches = (res: Walk, p: Vec3, r = 1.2, dy = 0.7) => res.nodes.some((n) => Math.abs(n.y - p.y) <= dy && Math.hypot(n.x - p.x, n.z - p.z) <= r);

let floods: [Walk, Walk] | null = null;
const flood = () => (floods ??= [walkFlood(map.spawns.teams[0][0]!), walkFlood(map.spawns.teams[1][0]!)]);
let grid: NavGrid | null = null;
const nav = () => (grid ??= new NavGrid(map));

describe('highrise: registry and the reference footprint', () => {
  it('is registered as a medium MW2 map with the objective modes', () => {
    const def = MAP_BY_ID.get('highrise')!;
    expect(def.inspiredBy).toMatch(/Highrise \(Call of Duty: Modern Warfare 2, 2009\)/);
    expect(def.size).toBe('medium');
    for (const m of ['tdm', 'ffa', 'dom', 'sd', 'hq']) expect(def.modes).toContain(m);
  });

  it('has the minimap proportions: a 44.7 x 56 m rooftop, 125 m from the lobby to the reception wing', () => {
    const R = HIGHRISE_ROOF;
    expect(R.maxX - R.minX).toBeCloseTo(44.7, 1);
    expect(R.maxZ - R.minZ).toBeCloseTo(56, 1);
    expect(R.bulgeMaxZ - R.bulgeMinZ).toBeCloseTo(22.1, 1);
    // The rooftop corners measured on the minimap (px) land on the outline.
    for (const [px, py] of [[175, 172], [342.5, 172], [175, 382], [342.5, 382], [160, 236], [357.5, 319]] as const) {
      const [x, z] = M(px, py);
      expect(inside(x, z, 0.4), `${px},${py}`).toBe(true);
    }
    const nb = HIGHRISE_AREAS.northBuilding;
    const sb = HIGHRISE_AREAS.southBuilding;
    expect(sb.maxZ - nb.minZ).toBeGreaterThan(124);
    expect(sb.maxZ - nb.minZ).toBeLessThan(127);
    // Spawn to spawn (lobby to reception) is a real crossing: over 100 m.
    const [t0, t1] = map.spawns.teams;
    expect(Math.hypot(t0[0]!.x - t1[0]!.x, t0[0]!.z - t1[0]!.z)).toBeGreaterThan(100);
  });

  it('keeps the brush and light counts sensible for the bake', () => {
    expect(map.brushes.length).toBeLessThan(900);
    expect(map.lights.length).toBeLessThan(48);
  });

  it('rectsMinus decomposes floors without overlaps', () => {
    const rs = rectsMinus([{ x0: 0, z0: 0, x1: 10, z1: 10 }], [{ x0: 2, z0: 2, x1: 4, z1: 8 }]);
    const area = rs.reduce((a, r) => a + (r.x1 - r.x0) * (r.z1 - r.z0), 0);
    expect(area).toBeCloseTo(100 - 12, 6);
  });
});

describe('highrise: levels and landmarks', () => {
  it('has walkable floors at the reference heights', () => {
    const at: [string, number, number, number][] = [
      ['rooftop', 10, 15, LV.roof],
      ['B lane over the underpass', -11, -4.8, LV.roof],
      ['Orange Pit floor', -14.5, -19, LV.tunnel],
      ['Red Pit floor', -14.5, 8, LV.tunnel],
      ['underpass', -11.5, -5, LV.tunnel],
      ['north tunnel', -11.15, -35, LV.tunnel],
      ['south tunnel', -10.8, 35, LV.tunnel],
      ['helipad deck', 8, -1.6, LV.deck],
      ['upper ledge (north walkway roof)', -6, -29.9, LV.deck],
      ['front ledge (south walkway roof)', 6, 30.2, LV.ledgeS],
      ['elevator shaft roof', -24.5, -1, LV.elevator],
      ['south building roof', 0, 42, LV.southRoof],
      ['propane shack roof', 16, -23.2, LV.shack],
      ['green shack roof', 6.2, 21, LV.shack],
      ['north lobby', -24.2, -55, LV.roof],
      ['Actibase offices', -0.8, 44.6, LV.roof],
    ];
    for (const [name, x, z, y] of at) {
      const g = floorAt(x, z, y);
      expect(g, name).not.toBeNull();
      expect(g!, name).toBeCloseTo(y, 1);
      expect(world.free(x, g! + 0.01, z), `${name} free`).toBe(true);
    }
  });

  it('the Mi-8 stands on the helipad and you can walk through the Mechanical Room under it', () => {
    const heli = map.props.filter((p) => p.kind === 'cylinder' && p.mat === 'heli');
    expect(heli.length).toBeGreaterThanOrEqual(2);
    for (const p of heli) expect(p.y).toBeGreaterThan(LV.deck);
    // Under the deck: the room, open at its west end towards the B lane.
    expect(world.free(8.4, 0.01, 0.8)).toBe(true);
    expect(world.lineOfSight(eye(-1.5, 0, 0.8), eye(12, 0, 0.8))).toBe(true);
  });

  it('the Pit is sunken behind walls higher than a jump, and its two sections meet under the B lane', () => {
    // Standing in the B lane you cannot step or jump into the pit over the wall; the stairs do it.
    const wallTop = world.groundBelow(-5.65, -15, 3, 4)!;
    expect(wallTop).toBeGreaterThan(1.1);
    expect(world.lineOfSight(chest(-11.5, LV.tunnel, -10), chest(-11.5, LV.tunnel, 3))).toBe(true);
    expect(world.free(-11.5, LV.tunnel + 0.01, -5)).toBe(true);
    // Headroom under the B lane slab: a standing player fits, the slab is right above.
    expect(world.groundBelow(-11.5, -5, 0.5, 1)).toBeCloseTo(0, 2);
  });

  it('the cranes are walkable along their jibs out over the void', () => {
    const crane = map.brushes.filter((b) => b.tag === 'crane');
    expect(crane.length).toBeGreaterThan(30);
    const tops = new Set(crane.map((b) => b.max.y));
    expect([...tops].sort()).toEqual([LV.jibA, LV.jibC]);
    // Out on jib A there is nothing under you.
    const h = map.hotspots!.find((p) => p.y === LV.jibA)!;
    expect(world.groundBelow(h.x, h.z, h.y + 0.1, 0.2)).toBeCloseTo(LV.jibA, 1);
    expect(world.groundBelow(h.x, h.z, h.y - 0.4, 60)).toBeNull();
  });
});

describe('highrise: spawns', () => {
  it('has enough spawns, all on solid ground, free, inside bounds and inside the outline', () => {
    expect(map.spawns.teams[0].length).toBeGreaterThanOrEqual(8);
    expect(map.spawns.teams[1].length).toBeGreaterThanOrEqual(8);
    expect(map.spawns.ffa.length).toBeGreaterThanOrEqual(12);
    const b = map.bounds;
    for (const s of allSpawns) {
      const g = world.groundBelow(s.x, s.z, s.y + 1, 3);
      expect(g, `ground at ${s.x},${s.z}`).not.toBeNull();
      expect(Math.abs(g! - s.y), `spawn y at ${s.x},${s.z}`).toBeLessThan(0.05);
      for (const [ox, oz] of [[0, 0], [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]] as const) expect(world.free(s.x + ox, g! + 0.2, s.z + oz), `room at ${s.x},${s.z}`).toBe(true);
      expect(s.x > b.min.x && s.x < b.max.x && s.z > b.min.z && s.z < b.max.z).toBe(true);
      expect(inside(s.x, s.z, 0), `${s.x},${s.z}`).toBe(true);
    }
  });

  it('team 1 spawns in the north building (elevator lobby), team 0 in the south building (reception wing)', () => {
    for (const s of map.spawns.teams[1]) expect(s.z).toBeLessThan(HIGHRISE_AREAS.northBuilding.maxZ);
    for (const s of map.spawns.teams[0]) expect(s.z).toBeGreaterThan(HIGHRISE_AREAS.southBuilding.minZ);
    expect(map.spawns.teams[1].filter((s) => s.x < -20).length).toBeGreaterThanOrEqual(6);
    expect(map.spawns.teams[0].filter((s) => s.x > 18.3 && s.z > 49.6).length).toBeGreaterThanOrEqual(4);
    for (const a of map.spawns.teams[0]) for (const c of map.spawns.teams[1]) expect(Math.hypot(a.x - c.x, a.z - c.z)).toBeGreaterThan(60);
  });

  it('no spawn faces an obstacle: walking forward for 1.2 s covers more than 2 m', () => {
    for (const s of allSpawns) {
      let st = createMoveState(s.x, s.y, s.z);
      for (let i = 0; i < 72; i++) st = stepMove(world, st, Buttons.FORWARD, s.yaw, TICK_DT);
      expect(Math.hypot(st.x - s.x, st.z - s.z), `spawn ${s.x},${s.z}`).toBeGreaterThan(2);
    }
  });
});

describe('highrise: walking and jumping from the spawns', () => {
  it('never leaves the bounds, and stays inside the minimap outline (or up on the cranes)', () => {
    for (const res of flood()) {
      expect(res.nodes.length).toBeGreaterThan(8000);
      expect(res.escapes, `escaped at ${JSON.stringify(res.escapes.slice(0, 3))}`).toHaveLength(0);
      const out = res.nodes.filter((n) => !(n.y < -1 ? underground(n) : inside(n.x, n.z) || craneZone(n)));
      expect(out, `outside at ${JSON.stringify(out.slice(0, 3))}`).toHaveLength(0);
    }
  }, 180_000); // the first walk flood (it mantles too) runs here

  it('falls only happen off the open edges, into the void (never through a floor)', () => {
    for (const res of flood()) {
      // There are open edges (the bulges, the cranes): you can fall...
      expect(res.falls.length).toBeGreaterThan(50);
      // ...but only off the open edges, never through a floor or over a parapet.
      const bad = res.falls.filter((f) => !openEdge(f.from));
      expect(bad, `fell from ${JSON.stringify(bad.slice(0, 3))}`).toHaveLength(0);
      for (const f of res.falls) expect(f.to.y).toBeLessThan(map.bounds.min.y);
      // A fall from the rooftop kills: the bounds floor is above the setback drawn below.
      expect(map.bounds.min.y).toBeGreaterThan(-8);
      expect(map.bounds.min.y).toBeLessThan(LV.tunnel - 1.8);
    }
  });

  it('reaches every spawn, objective and roam point from both team spawns, the high spots included', () => {
    for (const res of flood()) {
      for (const s of allSpawns) expect(reaches(res, s), `spawn ${s.x},${s.z}`).toBe(true);
      for (const [kind, list] of Object.entries(map.objectives)) for (const o of list) expect(reaches(res, o, Math.max(1.2, o.radius * 0.8)), `${kind} ${o.id}`).toBe(true);
      for (const h of map.hotspots ?? []) expect(reaches(res, h), `hotspot ${h.x},${h.y},${h.z}`).toBe(true);
      for (const y of [LV.tunnel, LV.deck, LV.ledgeS, LV.elevator, LV.jibA, LV.jibC, LV.southRoof]) expect(res.nodes.some((n) => Math.abs(n.y - y) < 0.05), `level ${y}`).toBe(true);
    }
  });
});

describe('highrise: objectives follow the original', () => {
  it('has Domination A/B/C, S&D sites with a bomb spawn, and the five HQ points', () => {
    expect(map.objectives.dom?.map((o) => o.id)).toEqual(['A', 'B', 'C']);
    const sd = map.objectives.sd!;
    expect(sd.map((o) => o.id)).toEqual(['A', 'B']);
    for (const s of sd) expect(s.team).toBe(1);
    expect(map.objectives.sdBomb).toHaveLength(1);
    expect(map.objectives.hq!.length).toBe(5);
    expect(map.modeSpawns?.sd?.attackers?.length).toBeGreaterThanOrEqual(8);
    expect(map.modeSpawns?.sd?.defenders?.length).toBeGreaterThanOrEqual(8);
    for (const list of Object.values(map.objectives))
      for (const o of list) {
        const g = world.groundBelow(o.x, o.z, o.y + 0.5, 1.5);
        expect(g, `${o.id} floor`).not.toBeNull();
        expect(world.free(o.x, g!, o.z), `${o.id} free`).toBe(true);
      }
  });

  it('Domination: one flag in each office and B in the lane between the Pit and the Helipad', () => {
    const [a, b, c] = map.objectives.dom!;
    expect(a!.z).toBeGreaterThan(HIGHRISE_AREAS.southBuilding.minZ);
    expect(c!.z).toBeLessThan(HIGHRISE_AREAS.northBuilding.maxZ);
    expect(b!.x).toBeGreaterThan(HIGHRISE_AREAS.southPit.maxX);
    expect(b!.x).toBeLessThan(HIGHRISE_AREAS.mechRoom.minX);
    expect(Math.abs(b!.z)).toBeLessThan(6);
  });

  it('S&D: both bomb sites on the rooftop, attackers in the south building', () => {
    for (const s of map.objectives.sd!) {
      expect(s.y).toBe(0);
      expect(inside(s.x, s.z, 0)).toBe(true);
      expect(s.z).toBeGreaterThan(HIGHRISE_ROOF.minZ);
      expect(s.z).toBeLessThan(HIGHRISE_ROOF.maxZ);
    }
    for (const s of map.modeSpawns!.sd!.attackers!) expect(s.z).toBeGreaterThan(30);
    for (const s of map.modeSpawns!.sd!.defenders!) expect(s.z).toBeLessThan(-30);
  });
});

describe('highrise: sightlines', () => {
  it('the south roof overlooks most of the rooftop', () => {
    const tops = [eye(-5, LV.southRoof, 33.6), eye(5, LV.southRoof, 33.6), eye(15, LV.southRoof, 33.6)];
    let vis = 0;
    let tot = 0;
    for (let x = -20; x <= 20; x += 2)
      for (let z = -26; z <= 26; z += 2) {
        if (floorAt(x, z, 0) === null || Math.abs(floorAt(x, z, 0)!) > 0.05 || !world.free(x, 0.01, z)) continue;
        tot++;
        if (tops.some((e) => world.lineOfSight(e, chest(x, 0, z)))) vis++;
      }
    expect(vis / tot).toBeGreaterThan(0.6);
  });

  it('the upper ledge watches the north half of the roof and the helipad deck', () => {
    const e = eye(-6, LV.deck, -29.6);
    expect(world.lineOfSight(e, chest(10, LV.deck, -1.6))).toBe(true);
    expect(world.lineOfSight(e, chest(13.8, 0, -13.6))).toBe(true);
    expect(world.lineOfSight(e, chest(-1.8, 0, 1))).toBe(true);
  });

  it('building to building: the north hall windows see the south walkway across the roof', () => {
    expect(world.lineOfSight(eye(-8.7, 0, -33), eye(-4.6, 0, 30))).toBe(true);
  });

  it('the Pit floor is hidden from the open roof; the tunnels from everything above', () => {
    expect(world.lineOfSight(eye(5, 0, -15), chest(-11, LV.tunnel, -15))).toBe(false);
    expect(world.lineOfSight(eye(10, LV.deck, 0), chest(-12, LV.tunnel, 10))).toBe(false);
    expect(world.lineOfSight(eye(-11, 0, -35), chest(-11.15, LV.tunnel, -35))).toBe(false);
    expect(world.lineOfSight(eye(-10.8, 0, 35), chest(-10.8, LV.tunnel, 35))).toBe(false);
  });

  it('the Actibase flag sits behind walls and cubicles, out of sight of the roof', () => {
    const a = map.objectives.dom![0]!;
    for (const p of [eye(0, 0, 10), eye(10, 0, 20), eye(-10, 0, 25), eye(5, LV.deck, 0)]) expect(world.lineOfSight(p, chest(a.x, 0, a.z))).toBe(false);
  });
});

describe('highrise: bots', () => {
  it('the nav grid paths from both team spawns to every objective and roam point, the high spots included', () => {
    const g = nav();
    expect(g.buildMs).toBeLessThan(5000);
    const targets: Vec3[] = [...Object.values(map.objectives).flat(), ...(map.hotspots ?? [])];
    for (const t of [LV.deck, LV.southRoof, LV.jibC]) expect(targets.some((p) => p.y === t)).toBe(true);
    for (const start of [map.spawns.teams[0][0]!, map.spawns.teams[1][0]!])
      for (const t of targets) {
        const p = g.path(start, t);
        expect(p, `${start.x},${start.z} -> ${t.x},${t.y},${t.z}`).not.toBeNull();
        const end = p!.at(-1)!;
        expect(Math.hypot(end.x - t.x, end.z - t.z), `${t.x},${t.z}`).toBeLessThan(1.2);
        expect(Math.abs(end.y - t.y), `${t.x},${t.y},${t.z} level`).toBeLessThan(0.6);
      }
  });

  it('no nav link drops a bot off an open edge (every drop lands on a floor)', () => {
    const g = nav();
    for (const c of g.cells)
      for (const e of c.edges) {
        const to = g.cells[e.to]!;
        expect(to.y, `${c.x},${c.y},${c.z} -> ${to.x},${to.y},${to.z}`).toBeGreaterThan(map.bounds.min.y);
      }
  });
});

describe('highrise: every mode builds a room', () => {
  let store: Store;
  let lobby: Lobby;
  beforeAll(() => {
    store = new Store(':memory:');
    lobby = new Lobby({ store, features: [], log: () => {}, autoTick: false });
  });
  afterAll(() => {
    lobby.shutdown();
    store.close();
  });

  it('creates and runs a bot-filled room in each supported mode', () => {
    for (const mode of MAP_BY_ID.get('highrise')!.modes) {
      const room = lobby.createRoom({ mode, map: 'highrise', botFill: 6, closeWhenEmpty: false, persist: false });
      room.fillBots();
      for (let i = 0; i < 120; i++) room.step();
      expect(room.map.id, mode).toBe('highrise');
      for (const b of room.bots()) expect(Number.isFinite(b.move.x), mode).toBe(true);
      room.close();
    }
  });
});
