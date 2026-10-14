/**
 * Afghan (MW2): layout checks against the reference (docs/maps/afghan-reference.md: the MW2 minimap at
 * 6.3 px/m on its 1024 px upscale, and the MWIII tac maps), spawns and objectives, walk-based checks with
 * the real movement code (closed play space, every spawn/objective/roam point reachable from both team
 * spawns), the landmark structures (plane, wing, Cave, Bunkers, overlook, Walkway), signature
 * sightlines, and every mode the map lists building and running with bots.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import botsFeature from '../src/server/features/bots/index';
import { NavGrid } from '../src/server/features/bots/nav';
import modesFeature, { registerModeRules } from '../src/server/features/modes/index';
import { controllerOf } from '../src/server/features/modes/common';
import { Lobby } from '../src/server/lobby';
import { Store } from '../src/server/store';
import { PLAYER, TICK_DT } from '../src/shared/constants';
import { MAP_BY_ID, getMapData, mapsForMode } from '../src/shared/defs/maps';
import { Buttons } from '../src/shared/input';
import { AFGHAN_BOUNDS, AFGHAN_LEVELS, AFGHAN_PLAY } from '../src/shared/maps/afghan';
import { buildCollisionWorld, type SpawnPoint } from '../src/shared/maps/types';
import type { Vec3 } from '../src/shared/math';
import { createMoveState, stepMove } from '../src/shared/movement';
import { floodWalk, reaches, type WalkResult } from './maps-mw2-walk';

const map = getMapData('afghan');
const world = buildCollisionWorld(map);
const L = AFGHAN_LEVELS;
const all = (): SpawnPoint[] => [...map.spawns.teams[0], ...map.spawns.teams[1], ...map.spawns.ffa, ...map.modeSpawns!.sd!.attackers!, ...map.modeSpawns!.sd!.defenders!];
/** Top of whatever is under (x, z) at or below `fromY`. */
const floorAt = (x: number, z: number, fromY: number) => world.groundBelow(x, z, fromY + 0.2, 40);
const eye = (x: number, y: number, z: number): Vec3 => ({ x, y: y + PLAYER.eye, z });
const see = (a: Vec3, b: Vec3) => world.lineOfSight(a, b);

let floods: [WalkResult, WalkResult] | null = null;
const flood = () => (floods ??= [floodWalk(map, map.spawns.teams[0][0]!, 0.8, 90000), floodWalk(map, map.spawns.teams[1][0]!, 0.8, 90000)]);

describe('afghan registry', () => {
  it('is registered as a large MW2 map with TDM/FFA and the objective modes', () => {
    const def = MAP_BY_ID.get('afghan')!;
    expect(def.inspiredBy).toMatch(/Modern Warfare 2/);
    expect(def.size).toBe('large');
    for (const m of ['tdm', 'ffa']) expect(def.modes).toContain(m);
    expect(mapsForMode('tdm').some((m) => m.id === 'afghan')).toBe(true);
  });
});

describe('afghan layout (reference: MW2 minimap + MWIII tac map)', () => {
  it('matches the minimap outline: about 134 x 139 m, bounds 2 m outside it', () => {
    const xs = AFGHAN_PLAY.map((p) => p[0]);
    const zs = AFGHAN_PLAY.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(133.6, 0);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(139.3, 0);
    expect(map.bounds.min.x).toBeCloseTo(Math.min(...xs) - 2, 1);
    expect(map.bounds.max.z).toBeCloseTo(Math.max(...zs) + 2, 1);
    expect(map.bounds.max.x).toBeCloseTo(AFGHAN_BOUNDS.maxX, 5);
  });

  it('has walkable floors at the reference heights', () => {
    const at: [string, number, number, number][] = [
      ['Batteries plateau', -55, -2, L.plateau],
      ['overlook', -28.4, -12.5, L.plateau],
      ['the Rocks (OpFor spawn)', -27, -62, L.rocks],
      ['north path', -45, -49.5, L.rocks],
      ['Poppy Fields', 16, -47, L.poppy],
      ['centre Bunker floor', 11.8, -31.4, L.bunker],
      ['east Bunker floor', 34.2, -17.2, L.eastBunker],
      ['Cave', 0, 29, L.cave],
      ['Cliffs', -30, 28, L.cliffs],
      ['Walkway south leg', -30, 43.4, L.walkway],
      ['Walkway west leg (halfway down)', -41.6, 24, 5.0],
      ['Walkway east ramp', -10, 43.4, 2.6],
      ['ledge above the Cave mouth', 3, 9.4, L.ledge],
      ['tail section floor', -11.6, -14.5, L.plane],
      ['middle section floor', 0.6, -16, L.plane],
      ['cockpit floor', 17.6, -7.4, L.plane],
      ['middle section roof', 6.6, -16, L.planeRoof],
      ['basin by the plane', 6, -9, L.basin],
      ['Canyon spawn', 48, 40, L.basin],
      ['south pocket', 1.8, 47.4, L.basin],
    ];
    for (const [name, x, z, y] of at) {
      const g = floorAt(x, z, y);
      expect(g, name).not.toBeNull();
      expect(g!, name).toBeCloseTo(y, 1);
      expect(world.free(x, g! + 0.02, z), `${name} free`).toBe(true);
    }
  });

  it('puts the landmarks where the minimap does', () => {
    // The plane: tail (fin standing) west, middle section, cockpit east; the pieces are apart.
    expect(floorAt(-17.2, -14.5, 20)!).toBeGreaterThan(9.5); // fin top
    expect(world.free(-4.6, 0.05, -14.5)).toBe(true); // gap between tail and middle
    expect(world.free(10.4, 0.05, -12)).toBe(true); // gap between middle and cockpit
    // Rock masses: the central rock, the NW pair, the SW rock, the cave mountain stand tall.
    for (const [name, x, z] of [['central rock', -9, -38], ['R1', -41, -41], ['R2', -38, -24], ['R4', -24, 4], ['cave mountain', 20, 26], ['NE rock', 24, -32]] as const) {
      expect(floorAt(x, z, 40)!, name).toBeGreaterThan(8);
      expect(world.free(x, (floorAt(x, z, 40) ?? 0) - 3, z), `${name} solid`).toBe(false);
    }
    // The Cave: roofed (ceiling over the floor) with three open mouths.
    for (const [x, z] of [[0, 29], [-3, 16], [2, 33]] as const) {
      const up = world.raycast({ x, y: L.cave + 1, z }, { x: 0, y: 1, z: 0 }, 10, 'sight');
      expect(up, `cave roof at ${x},${z}`).not.toBeNull();
      expect(up!.t).toBeLessThan(5.5);
    }
    for (const [name, x, z] of [['north mouth', -1, 12.4], ['west mouth', -11, 26], ['south mouth', -1.5, 37.8]] as const) {
      const g = floorAt(x, z, 4)!;
      expect(world.free(x, g + 0.05, z), name).toBe(true);
    }
  });

  it('runs the wing from the middle section up onto the ledge above the Cave mouth', () => {
    let prev = 0;
    for (let z = -13.2; z <= 6.8; z += 1) {
      const g = floorAt(3, z, 7)!;
      expect(g, `wing at z ${z}`).toBeGreaterThan(prev - 0.01);
      expect(g - prev, `wing step at z ${z}`).toBeLessThan(PLAYER.stepHeight);
      prev = g;
    }
    expect(prev).toBeGreaterThan(L.ledge - 0.6);
    // You can walk under the high end of the wing but not the low end.
    expect(world.free(3, 0.05, 2)).toBe(true);
    expect(world.free(3, 0.05, -12)).toBe(false);
  });

  it('makes the overlook a one-way drop above the tail, and the plateau a cliff over the basin', () => {
    expect(floorAt(-28.4, -12.5, 7)! - floorAt(-25, -12.5, 7)!).toBeGreaterThan(5.4);
    // No ramp or step climbs back: everything within 2 m below the edge is far below the plateau.
    for (let z = -14.5; z <= -10.5; z += 1) expect(floorAt(-25.4, z, 6.5)!, `below the edge at z ${z}`).toBeLessThan(1);
  });

  it('puts the teams at the Rocks (north-west) and the Canyon (south-east) like MW2/MWIII', () => {
    const mean = (l: SpawnPoint[]) => ({ x: l.reduce((s, p) => s + p.x, 0) / l.length, z: l.reduce((s, p) => s + p.z, 0) / l.length });
    const t0 = mean(map.spawns.teams[0]);
    const t1 = mean(map.spawns.teams[1]);
    expect(t0.x).toBeLessThan(-18);
    expect(t0.z).toBeLessThan(-50);
    expect(t1.x).toBeGreaterThan(40);
    expect(t1.z).toBeGreaterThan(30);
    for (const s of map.spawns.teams[0]) expect(s.y).toBeCloseTo(L.rocks, 1);
  });
});

describe('afghan spawns and objectives', () => {
  it('has enough spawns, all on free ground with headroom, inside the bounds', () => {
    expect(map.spawns.teams[0].length).toBeGreaterThanOrEqual(8);
    expect(map.spawns.teams[1].length).toBeGreaterThanOrEqual(8);
    expect(map.spawns.ffa.length).toBeGreaterThanOrEqual(16);
    const b = map.bounds;
    for (const s of all()) {
      const g = world.groundBelow(s.x, s.z, s.y + 1, 3);
      expect(g, `ground at ${s.x},${s.z}`).not.toBeNull();
      expect(Math.abs(g! - s.y), `spawn y at ${s.x},${s.z}`).toBeLessThan(0.3);
      for (const [ox, oz] of [[0, 0], [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]] as const) expect(world.free(s.x + ox, g! + 0.2, s.z + oz), `room at ${s.x},${s.z}`).toBe(true);
      expect(s.x > b.min.x && s.x < b.max.x && s.z > b.min.z && s.z < b.max.z).toBe(true);
      expect(Number.isFinite(s.yaw)).toBe(true);
      // Never on a roof or a rock: the highest walkable floor is the plateau.
      expect(s.y, `spawn height at ${s.x},${s.z}`).toBeLessThan(L.plateau + 0.3);
    }
  });

  it('keeps team spawns far apart and no two spawns of a list on top of each other', () => {
    const [t0, t1] = map.spawns.teams;
    for (const a of t0) for (const b of t1) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(60);
    for (const list of [t0, t1, map.spawns.ffa, map.modeSpawns!.sd!.defenders!])
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) expect(Math.hypot(list[i]!.x - list[j]!.x, list[i]!.z - list[j]!.z)).toBeGreaterThan(1.5);
  });

  it('no spawn faces an obstacle: walking forward for 1.2 s covers more than 2 m', () => {
    for (const s of all()) {
      let st = createMoveState(s.x, s.y, s.z);
      for (let i = 0; i < 72; i++) st = stepMove(world, st, Buttons.FORWARD, s.yaw, TICK_DT);
      expect(Math.hypot(st.x - s.x, st.z - s.z), `spawn ${s.x},${s.z}`).toBeGreaterThan(2);
    }
  });

  it('has Domination A/B/C, S&D sites with a bomb spawn and role spawns, and five HQ points', () => {
    const dom = map.objectives.dom!;
    expect(dom.map((o) => o.id)).toEqual(['A', 'B', 'C']);
    const near = (o: { x: number; z: number }, list: { x: number; z: number }[]) => Math.min(...list.map((s) => Math.hypot(s.x - o.x, s.z - o.z)));
    // A by the Batteries (team 0's side), B at the plane (MW2's centre flag), C in the Canyon (team 1's side).
    expect(near(dom[0]!, map.spawns.teams[0])).toBeLessThan(near(dom[0]!, map.spawns.teams[1]));
    expect(near(dom[2]!, map.spawns.teams[1])).toBeLessThan(near(dom[2]!, map.spawns.teams[0]));
    expect(Math.hypot(dom[1]!.x - 4, dom[1]!.z + 12)).toBeLessThan(10);
    expect(dom[0]!.y).toBeCloseTo(L.plateau, 1);
    // S&D (MWIII): A at the plane, B in the south pocket; the defenders (team 1) are closer to both.
    const sd = map.objectives.sd!;
    expect(sd.map((o) => o.id)).toEqual(['A', 'B']);
    for (const s of sd) expect(s.team).toBe(1);
    const { attackers, defenders } = map.modeSpawns!.sd!;
    for (const s of sd) expect(near(s, defenders!)).toBeLessThan(near(s, attackers!));
    for (const s of attackers!) expect(s.z).toBeLessThan(-50);
    expect(map.objectives.sdBomb).toHaveLength(1);
    expect(map.objectives.hq!.map((o) => o.id)).toEqual(['batteries', 'plane', 'eastBunker', 'poppy', 'cave']);
  });

  it('every objective point stands on a free floor', () => {
    for (const [kind, list] of Object.entries(map.objectives))
      for (const o of list) {
        const g = world.groundBelow(o.x, o.z, o.y + 0.5, 1.5);
        expect(g, `${kind} ${o.id} floor`).not.toBeNull();
        expect(world.free(o.x, g! + 0.05, o.z, PLAYER.radius), `${kind} ${o.id} free`).toBe(true);
      }
  });

  it('has two time presets (bright day, dusty sunset), lights and roam points', () => {
    expect(map.times.map((t) => t.id)).toEqual(['day', 'dusk']);
    expect(map.defaultTime).toBe('day');
    for (const t of map.times) expect(t.fogFar).toBeGreaterThan(150);
    expect(map.lights.length).toBeGreaterThan(8);
    expect(map.hotspots!.length).toBeGreaterThanOrEqual(12);
  });
});

describe('afghan walks (real movement code)', () => {
  it('the play space is closed and nobody falls out of the world', () => {
    for (const res of flood()) {
      expect(res.nodes.length).toBeGreaterThan(5000);
      expect(res.escapes, `escaped at ${JSON.stringify(res.escapes.slice(0, 3))}`).toHaveLength(0);
      expect(res.falls, `fell at ${JSON.stringify(res.falls.slice(0, 3))}`).toHaveLength(0);
    }
  }, 180_000); // the first walk flood (it mantles too) runs here

  it('every spawn, objective and roam point is reachable from both team spawns', () => {
    for (const res of flood()) {
      for (const s of all()) expect(reaches(res, s), `spawn ${s.x},${s.z}`).toBe(true);
      for (const [kind, list] of Object.entries(map.objectives)) for (const o of list) expect(reaches(res, o, Math.max(1.2, o.radius * 0.8)), `${kind} ${o.id}`).toBe(true);
      for (const h of map.hotspots ?? []) expect(reaches(res, h), `hotspot ${h.x},${h.y},${h.z}`).toBe(true);
    }
  });

  it('never stands on the rock masses or the canyon walls', () => {
    const b = map.bounds;
    for (const res of flood())
      for (const n of res.nodes) {
        expect(n.y, `node ${n.x},${n.y},${n.z}`).toBeLessThan(11);
        expect(n.x > b.min.x && n.x < b.max.x && n.z > b.min.z && n.z < b.max.z).toBe(true);
      }
  });
});

describe('afghan sightlines', () => {
  it('the overlook, the centre Bunker window, the cockpit and the Cave mouth all watch the plane', () => {
    const plane = { x: 3.6, y: 1.4, z: -12.6 };
    expect(see(eye(-27.2, L.plateau, -12.5), plane)).toBe(true); // overlook
    expect(see(eye(12.4, L.bunker, -30.2), { x: 10, y: 1.2, z: -12 })).toBe(true); // centre Bunker slit
    expect(see(eye(-1, L.cave, 13.2), { x: -11, y: 1.2, z: -9.6 })).toBe(true); // Cave north mouth -> tail
    expect(see(eye(3, L.ledge, 8), { x: 10.4, y: 1.2, z: -9.4 })).toBe(true); // ledge -> Dom B
    // The cockpit windscreen looks east at the Canyon and the east Bunker.
    expect(see(eye(19.6, L.plane, -7.4), { x: 44, y: 3.0, z: 20 })).toBe(true);
    expect(see(eye(19.6, L.plane, -7.4), { x: 31.6, y: 3.3, z: -18 })).toBe(true);
  });

  it('the east Bunker looks down the Canyon; the rock masses block the cross-map lines', () => {
    expect(see(eye(37.6, L.eastBunker, -4.8), { x: 46, y: 1.2, z: 38 })).toBe(true);
    // The central rock hides the Rocks spawn from the Poppy Fields and the plane from the north path.
    expect(see(eye(-27, L.rocks, -60), { x: 16, y: L.poppy + 1.2, z: -40 })).toBe(false);
    expect(see(eye(-10, 3.8, -49.5), { x: 3.6, y: 1.4, z: -12.6 })).toBe(false);
    // The cave mountain hides the Canyon spawn from the Cliffs and the pocket from the plane.
    expect(see(eye(-25, L.cliffs, 30), { x: 48, y: 1.2, z: 40 })).toBe(false);
    expect(see(eye(3.6, L.plane, -17), { x: 6, y: 1.2, z: 54 })).toBe(false);
    // Long open lane down the Canyon from the plinth to the spawn bay.
    expect(see(eye(36, 1.9, -1), { x: 49, y: 1.2, z: 44 })).toBe(true);
  });
});

describe('afghan bot nav', () => {
  it('reaches every objective and the upper levels from both team spawns', () => {
    const nav = new NavGrid(map);
    const objectives = Object.values(map.objectives).flat();
    const targets: Vec3[] = [...objectives, ...(map.hotspots ?? [])];
    for (const from of [map.spawns.teams[0][0]!, map.spawns.teams[1][0]!])
      for (const t of targets) {
        // Objectives within the default A* budget; the far roam points (the overlook from the Canyon
        // is a 120 m detour round the cliffs) get a bigger one.
        const path = nav.path(from, t, objectives.includes(t as never) ? undefined : 120000);
        expect(path, `path ${from.x},${from.z} -> ${t.x},${t.y},${t.z}`).not.toBeNull();
        const end = path!.at(-1)!;
        expect(Math.hypot(end.x - t.x, end.z - t.z), `end near ${t.x},${t.z}`).toBeLessThan(1.5);
        expect(Math.abs(end.y - t.y), `end height ${t.x},${t.y},${t.z}`).toBeLessThan(0.7);
      }
  });
});

describe('afghan modes', () => {
  let store: Store | undefined;
  let lobby: Lobby | undefined;
  beforeAll(() => registerModeRules());
  afterEach(() => {
    lobby?.shutdown();
    store?.close();
    lobby = store = undefined;
  });

  it('builds every mode it lists and bots play 20 s of each without dying to the world', () => {
    const modes = MAP_BY_ID.get('afghan')!.modes;
    expect(modes.length).toBeGreaterThanOrEqual(2);
    for (const mode of modes) {
      store = new Store(':memory:');
      lobby = new Lobby({ store, features: [modesFeature, botsFeature], log: () => {}, autoTick: false });
      const room = lobby.createRoom({ mode, map: 'afghan', botFill: 8, closeWhenEmpty: false, persist: false, countdownSec: 0 });
      room.fillBots();
      expect(room.bots().length, mode).toBeGreaterThan(1);
      if (['dom', 'sd', 'hq', 'kc'].includes(mode)) expect(controllerOf(room), mode).toBeTruthy();
      const worldDeaths: string[] = [];
      room.bus.on('death', ({ victim, weapon }) => {
        if (weapon === 'world') worldDeaths.push(`${victim.name}@${victim.move.x.toFixed(1)},${victim.move.y.toFixed(1)},${victim.move.z.toFixed(1)}`);
      });
      for (let i = 0; i < Math.round(20 / TICK_DT); i++) room.step();
      expect(worldDeaths, mode).toEqual([]);
      const b = map.bounds;
      for (const p of room.players.values()) expect(p.move.x > b.min.x && p.move.x < b.max.x && p.move.z > b.min.z && p.move.z < b.max.z, mode).toBe(true);
      lobby.shutdown();
      store.close();
      lobby = store = undefined;
    }
  });
});
