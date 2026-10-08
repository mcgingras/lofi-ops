/**
 * Estate (MW2): layout checks against the reference in docs/maps/estate-reference.md (the MW2
 * minimap and the MWIII tac map, 1 m = 8.3 tac-map px), data checks (spawns, objectives, every
 * objective mode builds), walk-based checks with the real movement code (the play space is closed,
 * nobody falls out, every spawn / objective / roam point is reachable from both team spawns), the
 * bot nav reaching every objective, and the signature sightlines.
 */
import { describe, expect, it } from 'vitest';
import { NavGrid } from '../src/server/features/bots/nav';
import { PLAYER, TICK_DT } from '../src/shared/constants';
import { MAP_BY_ID, getMapData, mapsForMode } from '../src/shared/defs/maps';
import { MODES } from '../src/shared/defs/modes';
import { Buttons } from '../src/shared/input';
import { ESTATE_LEVELS, ESTATE_OUTLINE, LODGE, groundAt } from '../src/shared/maps/estate';
import { buildCollisionWorld, type MapData } from '../src/shared/maps/types';
import type { Vec3 } from '../src/shared/math';
import { createMoveState, stepMove } from '../src/shared/movement';
import { floodWalk, reaches, type WalkResult } from './maps-mw2-walk';

const map = getMapData('estate');
const world = buildCollisionWorld(map);
const L = ESTATE_LEVELS;
const all = (m: MapData) => [...m.spawns.teams[0], ...m.spawns.teams[1], ...m.spawns.ffa];

let floods: [WalkResult, WalkResult] | null = null;
const flood = () => (floods ??= [floodWalk(map, map.spawns.teams[0][0]!, 0.8, 120000), floodWalk(map, map.spawns.teams[1][0]!, 0.8, 120000)]);
let nav: NavGrid | null = null;
const grid = () => (nav ??= new NavGrid(map));

function navReaches(from: Vec3, to: Vec3): boolean {
  const path = grid().path(from, to, 200000);
  if (!path) return false;
  const end = path.at(-1)!;
  return Math.hypot(end.x - to.x, end.z - to.z) < 1.3 && Math.abs(end.y - to.y) < 0.6;
}

/** Top of whatever is under (x, z) below `fromY` (null = nothing). */
const floorAt = (x: number, z: number, fromY = 40) => world.groundBelow(x, z, fromY, 50);
const near = (o: { x: number; z: number }, list: { x: number; z: number }[]) => Math.min(...list.map((s) => Math.hypot(s.x - o.x, s.z - o.z)));
const mean = (l: { x: number; z: number }[]) => ({ x: l.reduce((s, p) => s + p.x, 0) / l.length, z: l.reduce((s, p) => s + p.z, 0) / l.length });

describe('estate registry and data', () => {
  it('is registered as an MW2 map with team, FFA and objective modes', () => {
    const def = MAP_BY_ID.get('estate')!;
    expect(def).toBeDefined();
    expect(def.inspiredBy).toMatch(/Modern Warfare 2/);
    expect(def.size).toBe('large');
    for (const m of ['tdm', 'ffa']) expect(def.modes).toContain(m);
    expect(mapsForMode('tdm').some((m) => m.id === 'estate')).toBe(true);
  });

  it('every mode it lists builds: objectives exist for each objective mode', () => {
    const def = MAP_BY_ID.get('estate')!;
    for (const id of def.modes) expect(MODES.some((m) => m.id === id), id).toBe(true);
    expect(map.objectives.dom?.map((o) => o.id)).toEqual(['A', 'B', 'C']);
    expect(map.objectives.sd?.map((o) => o.id)).toEqual(['A', 'B']);
    expect(map.objectives.sdBomb).toHaveLength(1);
    expect(map.objectives.hq!.length).toBeGreaterThanOrEqual(5);
    expect(map.modeSpawns?.sd?.attackers?.length).toBeGreaterThanOrEqual(6);
    expect(map.modeSpawns?.sd?.defenders?.length).toBeGreaterThanOrEqual(6);
    for (const t of ['overcast', 'dusk']) expect(map.times.some((p) => p.id === t), t).toBe(true);
    expect(map.defaultTime).toBe('overcast');
    for (const b of map.brushes) expect(map.materials[b.mat], b.mat).toBeDefined();
    for (const d of map.decals) expect(map.materials[d.mat], d.mat).toBeDefined();
  });

  it('has enough spawns, all on solid ground, free with headroom, in bounds and inside the outline', () => {
    expect(map.spawns.teams[0].length).toBeGreaterThanOrEqual(10);
    expect(map.spawns.teams[1].length).toBeGreaterThanOrEqual(10);
    expect(map.spawns.ffa.length).toBeGreaterThanOrEqual(16);
    const b = map.bounds;
    for (const s of [...all(map), ...map.modeSpawns!.sd!.attackers!, ...map.modeSpawns!.sd!.defenders!]) {
      const g = world.groundBelow(s.x, s.z, s.y + 1, 3);
      expect(g, `ground at ${s.x},${s.z}`).not.toBeNull();
      expect(Math.abs(g! - s.y), `spawn y at ${s.x},${s.z}`).toBeLessThan(0.3);
      for (const [ox, oz] of [[0, 0], [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]] as const) expect(world.free(s.x + ox, g! + 0.2, s.z + oz), `room at ${s.x},${s.z}`).toBe(true);
      expect(s.x > b.min.x && s.x < b.max.x && s.z > b.min.z && s.z < b.max.z).toBe(true);
      expect(Number.isFinite(s.yaw)).toBe(true);
    }
  });

  it('keeps the two team spawns at opposite ends (Backwoods vs Substation), no spawn on another', () => {
    const [t0, t1] = map.spawns.teams;
    for (const a of t0) for (const c of t1) expect(Math.hypot(a.x - c.x, a.z - c.z)).toBeGreaterThan(60);
    const m0 = mean(t0);
    const m1 = mean(t1);
    expect(m0.z).toBeGreaterThan(65);
    expect(m1.z).toBeLessThan(-25);
    for (const list of [t0, t1, map.spawns.ffa])
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) expect(Math.hypot(list[i]!.x - list[j]!.x, list[i]!.z - list[j]!.z)).toBeGreaterThan(1.5);
  });

  it('no spawn faces an obstacle: walking forward for 1.2 s covers more than 2 m', () => {
    for (const s of all(map)) {
      let st = createMoveState(s.x, s.y, s.z);
      for (let i = 0; i < 72; i++) st = stepMove(world, st, Buttons.FORWARD, s.yaw, TICK_DT);
      expect(Math.hypot(st.x - s.x, st.z - s.z), `spawn ${s.x},${s.z}`).toBeGreaterThan(2);
    }
  });

  it('every objective point stands on a free floor', () => {
    for (const [kind, list] of Object.entries(map.objectives))
      for (const o of list) {
        const g = world.groundBelow(o.x, o.z, o.y + 0.5, 1.5);
        expect(g, `${kind} ${o.id} floor`).not.toBeNull();
        expect(Math.abs(g! - o.y), `${kind} ${o.id} height`).toBeLessThan(0.3);
        expect(world.free(o.x, g!, o.z), `${kind} ${o.id} free`).toBe(true);
      }
  });
});

describe('estate layout (reference: MW2 minimap / MWIII tac map)', () => {
  it('spans the medium-large outline: about 160 m east-west and 170 m north-south', () => {
    const xs = ESTATE_OUTLINE.map((p) => p[0]);
    const zs = ESTATE_OUTLINE.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(150);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(170);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(160);
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(180);
    // The bounds contain the outline with slack.
    expect(Math.min(...xs)).toBeGreaterThan(map.bounds.min.x + 2);
    expect(Math.max(...xs)).toBeLessThan(map.bounds.max.x - 2);
    expect(Math.min(...zs)).toBeGreaterThan(map.bounds.min.z + 2);
    expect(Math.max(...zs)).toBeLessThan(map.bounds.max.z - 2);
  });

  it('climbs from the Substation (north) to the Lodge on the hill (south)', () => {
    expect(groundAt(-30, -40)).toBe(L.field);
    expect(groundAt(-34, 60)).toBe(L.garden);
    expect(groundAt(0, 45)).toBe(L.main);
    expect(groundAt(-30, 10)).toBeGreaterThan(0);
    expect(groundAt(-30, 10)).toBeLessThan(L.garden);
    expect(groundAt(40, 26)).toBe(L.plateau);
  });

  it('has the landmark buildings where the overhead puts them (roofed)', () => {
    const roofs: [string, number, number, number][] = [
      ['lodge body', -14, 50, 15.5],
      ['lodge great room', -17, 34, 15.5],
      ['workshop', -55, -8, L.workshopRoof - 0.1],
      ['substation building', -9.5, -43, L.substationRoof - 0.1],
      ['garage', -4, -6, L.garageRoof - 0.1],
      ['boathouse', 40.5, 26.5, L.boathouseRoof],
      ['shed', -22, 75, L.garden + 2.7],
    ];
    for (const [name, x, z, h] of roofs) expect(floorAt(x, z), name).toBeGreaterThan(h);
    // The Lodge's three levels stack at the same spot.
    expect(floorAt(-14, 53, L.garden + 1)).toBeCloseTo(L.garden, 1);
    expect(floorAt(-14, 53, L.main + 1)).toBeCloseTo(L.main, 1);
    expect(floorAt(-14, 53, L.upper + 1)).toBeCloseTo(L.upper, 1);
    // The Greenhouse is see-through: sight crosses it, players don't.
    expect(world.lineOfSight({ x: -55, y: L.garden + 1.6, z: 50 }, { x: -36, y: L.garden + 1.6, z: 50 })).toBe(true);
    expect(world.free(-42.2, L.garden + 0.1, 45)).toBe(false);
    // Footprints: the Lodge between the Greenhouse and the front yard.
    expect(LODGE.x0).toBeGreaterThan(-30);
    expect(LODGE.x1).toBeLessThan(0);
  });

  it('puts the objectives where the overhead does', () => {
    const dom = Object.fromEntries(map.objectives.dom!.map((o) => [o.id, o]));
    const [t0, t1] = map.spawns.teams;
    // A: gravel courtyard behind the Lodge (team 0 side); B: the Garage; C: the Workshop.
    expect(near(dom.A!, t0)).toBeLessThan(near(dom.A!, t1));
    expect(near(dom.C!, t1)).toBeLessThan(near(dom.C!, t0));
    expect(dom.B!.x).toBeGreaterThan(-10);
    expect(dom.B!.x).toBeLessThan(4);
    expect(dom.C!.x).toBeLessThan(-49);
    // B and C are indoors (a roof overhead).
    for (const o of [dom.B!, dom.C!]) expect(floorAt(o.x, o.z), o.id).toBeGreaterThan(3);
    // S&D: A inside the Lodge (main floor), B by the Boathouse; both on the defenders' (south) side.
    const sd = Object.fromEntries(map.objectives.sd!.map((o) => [o.id, o]));
    expect(sd.A!.y).toBe(L.main);
    expect(sd.A!.x > LODGE.x0 && sd.A!.x < LODGE.x1 && sd.A!.z > LODGE.z0 && sd.A!.z < LODGE.z1).toBe(true);
    expect(sd.B!.x).toBeGreaterThan(25);
    for (const s of map.objectives.sd!) {
      expect(s.team).toBe(0);
      expect(near(s, map.modeSpawns!.sd!.defenders!)).toBeLessThan(near(s, map.modeSpawns!.sd!.attackers!));
      expect(near(s, t0)).toBeLessThan(near(s, t1));
    }
    for (const s of map.modeSpawns!.sd!.attackers!) expect(s.z).toBeLessThan(-25);
    for (const s of map.modeSpawns!.sd!.defenders!) expect(s.z).toBeGreaterThan(65);
  });

  it('keeps the signature sightlines and cover', () => {
    const eye = PLAYER.eye;
    // The great room's bay window looks down over the Waterfall terraces.
    expect(world.lineOfSight({ x: -17, y: L.main + eye, z: 30.5 }, { x: -28, y: groundAt(-28, 12) + 1, z: 12 })).toBe(true);
    // The wraparound balcony sees the Boathouse roof (and the outcrop screens its door).
    expect(world.lineOfSight({ x: -1.2, y: L.upper + eye, z: 59 }, { x: 40, y: L.boathouseRoof + 1, z: 30 })).toBe(true);
    expect(world.lineOfSight({ x: -1.4, y: L.upper + eye, z: 46 }, { x: 33, y: L.boathouse + 1, z: 26 })).toBe(false);
    // The Workshop's upper window watches the Substation yard.
    expect(world.lineOfSight({ x: -53, y: L.loft + eye, z: -17.5 }, { x: -35, y: 1.5, z: -36 })).toBe(true);
    // The big rock blocks the Garage from the Substation at standing height.
    expect(world.lineOfSight({ x: -18, y: eye, z: -32 }, { x: -18, y: eye, z: -8 })).toBe(false);
    // The outcrop in front of the Lodge hides the Boathouse plateau from the Main Road.
    expect(world.lineOfSight({ x: 7, y: groundAt(7, 18) + eye, z: 18 }, { x: 34, y: L.plateau + eye, z: 18 })).toBe(false);
    // Down the driveway from the gate to the Garage.
    expect(world.lineOfSight({ x: 7, y: eye, z: -50 }, { x: 7, y: eye, z: -2 })).toBe(true);
  });
});

describe('estate walk tests', () => {
  it('the play space is closed and nobody falls out of the world', () => {
    for (const res of flood()) {
      expect(res.nodes.length).toBeGreaterThan(3000);
      expect(res.escapes, `escaped at ${JSON.stringify(res.escapes.slice(0, 3))}`).toHaveLength(0);
      expect(res.falls, `fell at ${JSON.stringify(res.falls.slice(0, 3))}`).toHaveLength(0);
    }
  });

  it('every walk node stays inside the outline', () => {
    const inside = (x: number, z: number) => {
      let c = false;
      for (let i = 0, j = ESTATE_OUTLINE.length - 1; i < ESTATE_OUTLINE.length; j = i++) {
        const [xi, zi] = ESTATE_OUTLINE[i]!;
        const [xj, zj] = ESTATE_OUTLINE[j]!;
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
      }
      return c;
    };
    for (const res of flood()) {
      const out = res.nodes.filter((n) => !inside(n.x, n.z) && !inside(n.x + 0.5, n.z) && !inside(n.x - 0.5, n.z) && !inside(n.x, n.z + 0.5) && !inside(n.x, n.z - 0.5));
      expect(out, JSON.stringify(out.slice(0, 3))).toHaveLength(0);
    }
  });

  it('every spawn, objective and roam point is reachable from both team spawns', () => {
    for (const res of flood()) {
      for (const s of all(map)) expect(reaches(res, s), `spawn ${s.x},${s.z}`).toBe(true);
      for (const [kind, list] of Object.entries(map.objectives)) for (const o of list) expect(reaches(res, o, Math.max(1.2, o.radius * 0.8)), `${kind} ${o.id}`).toBe(true);
      for (const h of map.hotspots ?? []) expect(reaches(res, h), `hotspot ${h.x},${h.y},${h.z}`).toBe(true);
    }
  });

  it('reaches every level: Lodge floors, balcony, roofs, lofts, plateau, pylon', () => {
    const [res] = flood();
    const spots: [string, Vec3][] = [
      ['basement', { x: -14, y: L.garden, z: 54 }],
      ['great room', { x: -16, y: L.main, z: 35 }],
      ['loft', { x: -16, y: L.upper, z: 43 }],
      ['rear balcony', { x: -6, y: L.upper, z: 58.3 }],
      ['east balcony', { x: -1.6, y: L.upper, z: 48 }],
      ['west deck', { x: -28, y: L.main, z: 46 }],
      ['workshop loft', { x: -55, y: L.loft, z: 0 }],
      ['workshop roof', { x: -55, y: L.workshopRoof, z: -8 }],
      ['substation roof', { x: -9.5, y: L.substationRoof, z: -43 }],
      ['garage roof', { x: -4, y: L.garageRoof, z: -6 }],
      ['big rock', { x: -18, y: L.bigRock, z: -22 }],
      ['boathouse', { x: 40.5, y: L.boathouse, z: 24 }],
      ['outcrop', { x: 17, y: L.outcrop, z: 22 }],
      ['pylon', { x: -30, y: L.pylon, z: -75 }],
    ];
    for (const [name, p] of spots) expect(reaches(res, p), name).toBe(true);
  });
});

describe('estate bot nav', () => {
  it('reaches every objective from both team spawns', () => {
    for (const from of [map.spawns.teams[0][0]!, map.spawns.teams[1][0]!])
      for (const [kind, list] of Object.entries(map.objectives)) for (const o of list) expect(navReaches(from, o), `${kind} ${o.id} from ${from.x},${from.z}`).toBe(true);
  });
});
