/**
 * Launch (Black Ops 1): layout checks against the traced reference (docs/maps/launch-reference.md,
 * the BO1 overhead at 3.57 px/m), spawns, objectives, reachability through the real movement code,
 * closed bounds, scripted walks over every level (the flame trench, the deck, the stair towers, the
 * track and its missile car, Control, the Centrifuge catwalk, the stairs roof), the signature
 * sightlines, and every mode building and running on the map with bots.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import botsFeature from '../src/server/features/bots/index';
import { NavGrid } from '../src/server/features/bots/nav';
import modesFeature, { registerModeRules } from '../src/server/features/modes/index';
import { Lobby } from '../src/server/lobby';
import { Store } from '../src/server/store';
import { MOVE, PLAYER, TICK_DT } from '../src/shared/constants';
import { getMapData, MAP_BY_ID } from '../src/shared/defs/maps';
import { MODES } from '../src/shared/defs/modes';
import { Buttons } from '../src/shared/input';
import type { Vec3 } from '../src/shared/math';
import { createMoveState, stepMove } from '../src/shared/movement';
import { insideOutline, LAUNCH_LEVELS as L, LAUNCH_OUTLINE } from '../src/shared/maps/launch';
import { buildCollisionWorld, type MapData, type SpawnPoint } from '../src/shared/maps/types';
import { floodFill, walkRoute, type Reach } from './maps-bo-nav';

const ROOT = resolve(import.meta.dirname, '..');
const map = getMapData('launch');
const world = buildCollisionWorld(map);
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const RX = -0.45;
const X = (u: number) => RX + u;
const eye = PLAYER.eye;

const allSpawns = (m: MapData): SpawnPoint[] => [...m.spawns.teams[0], ...m.spawns.teams[1], ...m.spawns.ffa, ...Object.values(m.modeSpawns ?? {}).flatMap((set) => Object.values(set).flat())];

let reachCache: Reach | null = null;
const reach = () => (reachCache ??= floodFill(world, [map.spawns.teams[0][0]!]));
const floor = (x: number, z: number, from: number) => world.groundBelow(x, z, from, 8);

/** Distance from (x, z) to the outline polygon's edges. */
function edgeDist(x: number, z: number): number {
  let d = Infinity;
  const P = LAUNCH_OUTLINE;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [ax, az] = P[j]!;
    const [bx, bz] = P[i]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    d = Math.min(d, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return d;
}

describe('launch: registry, materials, textures', () => {
  it('is registered as a large Black Ops map with every mode', () => {
    const def = MAP_BY_ID.get('launch')!;
    expect(def.inspiredBy).toMatch(/Black Ops \(2010\), Launch/);
    expect(def.size).toBe('large');
    for (const mode of MODES) expect(def.modes).toContain(mode.id);
  });

  it('every material texture has a client recipe, the recipes only use photos that exist', () => {
    const recipes = ['launch.ts', 'bo-common.ts', 'yard.ts', 'rust.ts', 'scrapyard.ts', 'nuketown.ts', 'core.ts'].map((f) => readFileSync(resolve(ROOT, 'src/client/render/recipes', f), 'utf8'));
    const ids = new Set(recipes.flatMap((src) => [...src.matchAll(/registerTexture\(\s*['`]([^'`$]+)['`]/g)].map((m) => m[1]!)));
    const prefixes = recipes.flatMap((src) => [...src.matchAll(/registerTexture\(\s*`([^`$]+)\$\{/g)].map((m) => m[1]!));
    for (const [name, mat] of Object.entries(map.materials)) {
      if (mat.texture === 'none') continue;
      expect(ids.has(mat.texture) || prefixes.some((p) => mat.texture.startsWith(p)), `material ${name} -> ${mat.texture}`).toBe(true);
    }
    for (const t of map.times) expect(ids.has(t.sky), t.sky).toBe(true);
    const src = recipes[0]!;
    for (const p of new Set([...src.matchAll(/fromPhoto\('([^']+)'/g)].map((m) => m[1]!))) expect(existsSync(resolve(ROOT, 'assets/textures', `${p}.jpg`)), p).toBe(true);
    // Every referenced material exists.
    for (const b of map.brushes) expect(map.materials[b.mat], b.mat).toBeTruthy();
    for (const d of map.decals) expect(map.materials[d.mat], d.mat).toBeTruthy();
  });

  it('has the two time presets (day, evening) and a sane size for the bake', () => {
    expect(map.times.map((t) => t.id)).toEqual(['day', 'evening']);
    expect(map.brushes.length).toBeLessThan(1100);
    expect(map.lights.length).toBeLessThan(48);
  });
});

describe('launch: layout against the reference outline', () => {
  it('is the long 127 x 63 m band of the overhead, the pad pushed out of its north side', () => {
    const xs = LAUNCH_OUTLINE.map((p) => p[0]);
    const zs = LAUNCH_OUTLINE.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(126.75, 0);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(63.4, 0);
    // The pad block is the northernmost part and is centred on the track (x -10.9 .. 10).
    const north = LAUNCH_OUTLINE.filter((p) => p[1] < -25);
    for (const [x] of north) expect(Math.abs(x - RX)).toBeLessThan(11);
    // The checkpoints are the west and east ends, near the middle line.
    expect(insideOutline(-63, 1)).toBe(true);
    expect(insideOutline(59, 1)).toBe(true);
    expect(insideOutline(-63, 12)).toBe(false);
    expect(insideOutline(59, 12)).toBe(false);
    expect(insideOutline(-35, -20)).toBe(false); // outside the NW diagonal
    expect(insideOutline(30, -20)).toBe(false); // outside the NE diagonal
  });

  it('nothing reachable lies outside the outline (players are clipped to it)', () => {
    const r = reach();
    const outside = r.nodes.filter((n) => !insideOutline(n.x, n.z) && edgeDist(n.x, n.z) > 0.5);
    expect(outside, JSON.stringify(outside.slice(0, 5))).toEqual([]);
    // ... and the play space fills it: reachable ground near both ends, the pad and the south edge.
    for (const p of [v(-63, 0, 1), v(59, 0, 1), v(X(0), L.deck, -30), v(-15, 0, 29), v(15, 0, 22), v(-12, 0, -21), v(12, 0, -20)]) expect(r.near(p, 2.5), JSON.stringify(p)).toBe(true);
  }, 180_000); // the first walk flood (it mantles too) runs here

  it('puts the landmarks where the overhead has them, at their levels', () => {
    // Rocket on the pad centre line, gantry towers behind it (props/brushes outside the play space).
    const core = map.props.find((p) => p.kind === 'cylinder' && p.mat === 'rocket' && p.r > 1.4)!;
    expect(core.x).toBeCloseTo(RX, 1);
    expect(core.z).toBeCloseTo(-22.1, 1);
    expect(core.kind === 'cylinder' && core.y + core.len / 2).toBeGreaterThan(29);
    // The flame trench under it, the deck ring, the walkway, the stair tower balconies, the track.
    expect(floor(X(0), -18.0, 3)).toBeCloseTo(L.pit, 1);
    expect(floor(X(-8), -22.6, 2)).toBeLessThan(0); // the west ramp
    expect(floor(X(0), -30.0, 5)).toBeCloseTo(L.deck, 1);
    expect(floor(X(-8), -23.0, 5)).toBeCloseTo(L.deck, 1);
    expect(floor(X(-8.5), -14.0, 10)).toBeCloseTo(L.tower, 1);
    expect(floor(X(8.5), -14.0, 10)).toBeCloseTo(L.tower, 1);
    expect(floor(X(0), 10.0, 5)).toBeCloseTo(L.deck, 1);
    expect(floor(X(-4.1), 10.0, 5)).toBeGreaterThan(0.6); // the incline
    expect(floor(X(-4.1), 10.0, 5)).toBeLessThan(L.deck);
    expect(floor(X(0), -1.0, 8)).toBeCloseTo(L.car, 1);
    // Buildings: Control two storeys, the Centrifuge catwalk, the stairs roof, the warehouses.
    expect(floor(15.8, -5.4, 2)).toBeCloseTo(0, 1);
    expect(floor(15.8, -4.6, L.control + 1)).toBeCloseTo(L.control, 1);
    expect(floor(20, 2, 6)).toBeCloseTo(L.control, 1);
    expect(floor(-15.4, 11.2, L.catwalk + 1)).toBeCloseTo(L.catwalk, 1);
    expect(floor(-38.6, 16.6, 6)).toBeCloseTo(L.stairsRoof, 1);
    for (const [name, x, z, h] of [['Warehouse', -34, 6, 5.0], ['Offices', -44, -5.4, 3.2], ['Centrifuge', -16, 15, 6.5], ['Control', 15.8, -5.4, 6.5], ['east warehouse', 35.6, 6.4, 4.2]] as const) {
      expect(world.groundBelow(x, z, 30, 40)!, `${name} roof`).toBeGreaterThan(h);
      expect(floor(x, z, 1.0), `${name} floor`).toBeCloseTo(0, 1);
    }
    // Fuel Yard: the vertical tanks and the two big tanks on the south edge.
    const tanks = map.props.filter((p) => p.kind === 'cylinder' && p.mat === 'tank');
    expect(tanks.length).toBe(5);
    expect(tanks.filter((t) => t.kind === 'cylinder' && t.r > 2.5 && t.z > 25).length).toBe(2);
  });
});

describe('launch: spawns and objectives', () => {
  it('spawns: enough for 6v6 and FFA, standing on ground, free, inside the outline', () => {
    expect(map.spawns.teams[0].length).toBeGreaterThanOrEqual(8);
    expect(map.spawns.teams[1].length).toBeGreaterThanOrEqual(8);
    expect(map.spawns.ffa.length).toBeGreaterThanOrEqual(16);
    expect(map.modeSpawns?.sd?.attackers?.length).toBeGreaterThanOrEqual(6);
    expect(map.modeSpawns?.sd?.defenders?.length).toBeGreaterThanOrEqual(6);
    for (const s of allSpawns(map)) {
      const g = world.groundBelow(s.x, s.z, s.y + 0.2, 0.4);
      expect(g, `ground under ${JSON.stringify(s)}`).not.toBeNull();
      expect(Math.abs(g! - s.y), `spawn height ${JSON.stringify(s)}`).toBeLessThan(0.05);
      expect(world.free(s.x, g! + 0.01, s.z), `free at ${JSON.stringify(s)}`).toBe(true);
      expect(insideOutline(s.x, s.z), `inside ${JSON.stringify(s)}`).toBe(true);
    }
  });

  it('teams start at the west and east checkpoints, far apart', () => {
    const [a, b] = map.spawns.teams;
    for (const s of a) expect(s.x).toBeLessThan(-50);
    for (const s of b) expect(s.x).toBeGreaterThan(48);
    for (const set of [a, b]) for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) expect(Math.hypot(set[i]!.x - set[j]!.x, set[i]!.z - set[j]!.z)).toBeGreaterThan(1.5);
    for (const p of a) for (const q of b) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(95);
  });

  it('objectives: dom A/B/C with B under the rocket, sd A under the rocket and B at the Fuel Yard, hq points; all on the ground', () => {
    const dom = Object.fromEntries(map.objectives.dom!.map((o) => [o.id, o]));
    const sd = Object.fromEntries(map.objectives.sd!.map((o) => [o.id, o]));
    expect(Object.keys(dom)).toEqual(['A', 'B', 'C']);
    expect(Object.keys(sd)).toEqual(['A', 'B']);
    expect(map.objectives.hq!.length).toBeGreaterThanOrEqual(8);
    // B (dom) and A (sd) in the flame trench under the rocket.
    for (const o of [dom.B!, sd.A!]) {
      expect(o.y).toBeCloseTo(L.pit, 5);
      expect(Math.abs(o.x - RX)).toBeLessThan(4.5);
      expect(o.z).toBeLessThan(-15.5);
    }
    // A west (Containers), C east (Fuel Yard), mirrored south of the middle; sd B at the Fuel Yard.
    expect(dom.A!.x).toBeLessThan(-20);
    expect(dom.C!.x).toBeGreaterThan(20);
    expect(dom.A!.z).toBeGreaterThan(15);
    expect(dom.C!.z).toBeGreaterThan(15);
    expect(sd.B!.x).toBeGreaterThan(10);
    expect(sd.B!.z).toBeGreaterThan(18);
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
    expect(d(dom.A!, map.spawns.teams[0])).toBeLessThan(d(dom.A!, map.spawns.teams[1]));
    expect(d(dom.C!, map.spawns.teams[1])).toBeLessThan(d(dom.C!, map.spawns.teams[0]));
    const b0 = d(dom.B!, map.spawns.teams[0]);
    const b1 = d(dom.B!, map.spawns.teams[1]);
    expect(Math.abs(b0 - b1) / Math.max(b0, b1)).toBeLessThan(0.15);
  });
});

describe('launch: reachability and bounds', () => {
  it('everything is reachable on foot from a team 0 spawn: spawns, objectives, hotspots, every level', () => {
    const r = reach();
    for (const s of allSpawns(map)) expect(r.near(s, 0.9), `spawn ${JSON.stringify(s)}`).toBe(true);
    for (const [kind, list] of Object.entries(map.objectives)) for (const o of list) expect(r.near(o, o.radius), `${kind} ${o.id}`).toBe(true);
    for (const h of map.hotspots ?? []) expect(r.near(h, 1.5), `hotspot ${JSON.stringify(h)}`).toBe(true);
    const at = (y: number) => r.nodes.filter((n) => Math.abs(n.y - y) < 0.05).length;
    expect(at(L.pit)).toBeGreaterThan(40);
    expect(at(L.deck)).toBeGreaterThan(150);
    expect(at(L.control)).toBeGreaterThan(60);
    expect(at(L.tower)).toBeGreaterThan(8);
    expect(at(L.car)).toBeGreaterThan(8);
    expect(at(L.catwalk)).toBeGreaterThan(8);
    expect(at(L.stairsRoof)).toBeGreaterThan(20);
  });

  it('bounds are closed: no reachable spot is outside, and sprinting and jumping outwards stops at the clip', () => {
    const r = reach();
    const b = map.bounds;
    for (const n of r.nodes) {
      expect(n.x > b.min.x && n.x < b.max.x && n.z > b.min.z && n.z < b.max.z, `node ${JSON.stringify(n)}`).toBe(true);
      expect(n.y).toBeGreaterThan(MOVE.killY);
    }
    const starts = [map.spawns.teams[0][0]!, map.spawns.teams[1][0]!, ...map.spawns.ffa.filter((_, i) => i % 3 === 0)];
    for (const start of starts) {
      for (let i = 0; i < 16; i++) {
        const yaw = (i / 16) * Math.PI * 2;
        const s = { ...createMoveState(start.x, start.y, start.z), onGround: true };
        for (let t = 0; t < 20 * 60; t++) stepMove(world, s, Buttons.FORWARD | Buttons.SPRINT | (t % 40 === 0 ? Buttons.JUMP : 0), yaw, TICK_DT);
        expect(insideOutline(s.x, s.z) || edgeDist(s.x, s.z) < 0.5, `ran out at ${s.x.toFixed(1)},${s.z.toFixed(1)} from ${start.x},${start.z}`).toBe(true);
        expect(s.y).toBeGreaterThan(L.pit - 0.1);
      }
    }
  });

  it('the bots NavGrid finds a path from both team spawns to every objective and both tower balconies', () => {
    const nav = new NavGrid(map);
    const targets = [
      ...Object.entries(map.objectives).flatMap(([kind, list]) => list.map((o) => ({ name: `${kind} ${o.id}`, p: v(o.x, o.y, o.z), r: o.radius }))),
      { name: 'west balcony', p: v(X(-8.5), L.tower, -14.0), r: 1.2 },
      { name: 'east balcony', p: v(X(8.5), L.tower, -14.0), r: 1.2 },
      { name: 'control upstairs', p: v(15.6, L.control, -4.6), r: 1.2 },
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
  });
});

describe('launch: walks', () => {
  it('west spawn -> main road -> NW corridor -> down into the flame trench -> under the rocket -> up the east ramp -> NE corridor -> Control, upstairs, out on the roofs and down the outside stairs', () => {
    const r = walkRoute(world, map.spawns.teams[0][0]!, [
      v(-59, 0, 1.6), v(-50, 0, 0.6), v(-40, 0, 0), v(-29, 0, 0), v(-26, 0, -7), v(-18.6, 0, -14.6), v(-11.8, 0, -21.6), v(-10.0, 0, -22.4),
      v(-5.6, L.pit, -22.4), v(-5.6, L.pit, -18.0), v(4.6, L.pit, -18.0), v(4.6, L.pit, -22.4), v(9.5, 0, -22.4), v(11.4, 0, -21.6), v(16, 0, -14),
      v(12, 0, -10.4), v(12, 0, -8.2), v(20.9, 0, -6.6), v(21.0, 0, -8.15), v(13.4, L.control, -8.15), v(13.0, L.control, -5.0), v(17.5, L.control, -3.0),
      v(17.5, L.control, 0), v(17.5, L.control, 4.6), v(17.5, 0, 11.4), v(20.4, 0, 11.4),
    ]);
    expect(r.maxY).toBeCloseTo(L.control, 1);
    expect(r.state.y).toBeCloseTo(0, 1);
    expect(r.seconds).toBeLessThan(45);
  });

  it('main road -> up the west incline onto the track, round the missile car, onto the deck, into the west tower and up to its balcony', () => {
    const r = walkRoute(world, v(-8, 0, 9.6), [
      v(-1.9, L.deck, 9.6), v(-1.9, L.deck, 5.0), v(-3.85, 1.7, 4.4), v(-3.85, 1.7, -6.4), v(-1.5, L.deck, -6.8), v(-1.5, L.deck, -9.6), v(0.4, L.deck, -9.8), v(0.4, L.deck, -14),
      v(X(0), L.deck, -16.3), v(X(-5.9), L.deck, -16.3), v(X(-9.3), L.deck, -16.3), v(X(-9.3), L.towerLanding, -19.95), v(X(-7.5), L.towerLanding, -19.95), v(X(-7.6), L.tower, -16.3), v(X(-8.5), L.tower, -13.5),
    ]);
    expect(r.state.y).toBeCloseTo(L.tower, 1);
  });

  it('NW corner -> stairs up to the walkway behind the rocket -> across -> down the east stairs to the NE corner', () => {
    const r = walkRoute(world, v(-12.4, 0, -21.2), [v(-9.6, 0, -22.6), v(-10.1, 0, -25.8), v(-10.1, 0, -27.85), v(-5.4, L.deck, -27.85), v(X(0), L.deck, -30.0), v(4.5, L.deck, -27.85), v(9.2, 0, -27.85), v(9.2, 0, -25.6), v(9.0, 0, -22.6)]);
    expect(r.maxY).toBeCloseTo(L.deck, 1);
  });

  it('the ladder up the big missile car; the Centrifuge catwalk; the stairs roof', () => {
    const car = walkRoute(world, v(-3.85, 2.0, -7.4), [v(-0.5, L.deck, -7.2), v(-0.5, L.deck, -6.9), v(-0.5, L.car, -5.0), v(-0.5, L.car, 0)]);
    expect(car.state.y).toBeCloseTo(L.car, 1);
    const cat = walkRoute(world, v(-13.4, 0, 22.4), [v(-13.4, 0, 18.6), v(-10.1, 0, 18.6), v(-10.1, L.catwalk, 12.0), v(-15, L.catwalk, 11.3), v(-21.5, L.catwalk, 11.3)]);
    expect(cat.state.y).toBeCloseTo(L.catwalk, 1);
    const roof = walkRoute(world, v(-46, 0, 9.6), [v(-46.9, 0, 11.0), v(-47.6, 0, 12.2), v(-47.6, L.stairsRoof, 18.8), v(-43.0, L.stairsRoof, 18.8), v(-39, L.stairsRoof, 16.6)]);
    expect(roof.state.y).toBeCloseTo(L.stairsRoof, 1);
  });
});

describe('launch: sightlines', () => {
  it('the stair tower balconies look down the main road towards both spawns; the spawns cannot see each other', () => {
    expect(world.lineOfSight(v(X(-8.5), L.tower + eye, -13.4), v(-50, eye, 3))).toBe(true);
    expect(world.lineOfSight(v(X(-8.5), L.tower + eye, -13.4), v(-32, eye, 0))).toBe(true);
    expect(world.lineOfSight(v(X(8.5), L.tower + eye, -13.4), v(59, eye, -3))).toBe(true);
    expect(world.lineOfSight(v(-58, eye, 1), v(55, eye, 1))).toBe(false);
  });

  it('the trench is hidden from the road but open end to end; the deck looks down into it', () => {
    expect(world.lineOfSight(v(X(-8), L.pit + eye, -22.6), v(X(8), L.pit + eye, -22.6))).toBe(true);
    expect(world.lineOfSight(v(X(-15), eye, 0), v(X(0), L.pit + eye, -18))).toBe(false);
    expect(world.lineOfSight(v(X(-3.5), L.pit + eye, -18), v(X(-3.5), eye, -8))).toBe(false);
    expect(world.lineOfSight(v(X(-4.4), L.deck + eye, -26.5), v(X(-3.0), L.pit + 1.0, -16.0))).toBe(true);
  });

  it('the missile car top and the walkway watch the track; Control and the Centrifuge catwalk have their windows', () => {
    expect(world.lineOfSight(v(X(0), L.car + eye, 0), v(X(0), L.deck + eye, -16.3))).toBe(true);
    expect(world.lineOfSight(v(X(-4.0), L.deck + eye, -28.2), v(X(-4.0), L.deck + eye, -10))).toBe(true);
    expect(world.lineOfSight(v(12, L.control + eye, -3.6), v(X(0), L.deck + eye, -8))).toBe(true);
    expect(world.lineOfSight(v(-10.4, L.catwalk + eye, 11.0), v(-10.4, eye, 7.6))).toBe(true);
    // The rocket blocks the walkway's view straight down the track.
    expect(world.lineOfSight(v(X(0), L.deck + eye, -30), v(X(0), L.deck + eye, -14))).toBe(false);
  });
});

describe('launch: every mode builds and runs with bots', () => {
  let store: Store;
  let lobby: Lobby;
  beforeAll(() => {
    registerModeRules();
    store = new Store(':memory:');
    lobby = new Lobby({ store, features: [modesFeature, botsFeature], log: () => {}, autoTick: false });
  });
  afterAll(() => {
    lobby.shutdown();
    store.close();
  });

  for (const mode of MODES.map((m) => m.id)) {
    it(`${mode}: a bot-filled room on launch runs for 12 s, nobody leaves the map or dies to the world`, () => {
      const room = lobby.createRoom({ mode, map: 'launch', botFill: 8, closeWhenEmpty: false, persist: false, countdownSec: 0 });
      expect(room.map.id).toBe('launch');
      room.fillBots();
      const worldDeaths: string[] = [];
      room.bus.on('death', ({ victim, means }) => {
        if (means === 'world') worldDeaths.push(`${victim.name}@${victim.move.x.toFixed(1)},${victim.move.y.toFixed(1)},${victim.move.z.toFixed(1)}`);
      });
      for (let i = 0; i < Math.round(12 / TICK_DT); i++) room.step();
      expect(worldDeaths).toEqual([]);
      for (const p of room.players.values()) if (p.alive) expect(insideOutline(p.move.x, p.move.z) || edgeDist(p.move.x, p.move.z) < 0.6, `${p.name} at ${p.move.x},${p.move.z}`).toBe(true);
      room.close();
    });
  }
});
