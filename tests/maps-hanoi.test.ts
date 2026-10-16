/**
 * Hanoi (Black Ops, night): layout checks against the reference in docs/maps/hanoi-reference.md
 * (the BO1 minimap, 1 px = 0.2 m, origin at minimap px 250, 255), spawns and objectives on solid
 * ground, reachability (flood fill through the real movement code), closed bounds, scripted walks
 * through the buildings and up every stair, the single night preset, every mode building on it,
 * the bots' nav graph and the signature sightlines.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import economyFeature from '../src/server/features/economy/index';
import modesFeature, { registerModeRules } from '../src/server/features/modes/index';
import { NavGrid } from '../src/server/features/bots/nav';
import { Lobby } from '../src/server/lobby';
import { Store } from '../src/server/store';
import { MOVE, PLAYER, TICK_DT } from '../src/shared/constants';
import { getMapData, MAP_BY_ID, mapsForMode } from '../src/shared/defs/maps';
import { MODES } from '../src/shared/defs/modes';
import { Buttons } from '../src/shared/input';
import type { Vec3 } from '../src/shared/math';
import { createMoveState, stepMove } from '../src/shared/movement';
import { CELL_BLOCK, cellBlockPoint, HANOI_OUTLINE, insideOutline } from '../src/shared/maps/hanoi';
import { buildCollisionWorld, type MapData, type SpawnPoint } from '../src/shared/maps/types';
import { floodFill, walkRoute, type Reach } from './maps-bo-nav';

const ROOT = resolve(import.meta.dirname, '..');
const map = getMapData('hanoi');
const world = buildCollisionWorld(map);
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const eye = PLAYER.eye;
/** Minimap px -> metres (the reference's scale and origin). */
const mm = (px: number, pz: number): [number, number] => [(px - 250) * 0.2, (pz - 255) * 0.2];
/** Top of whatever is under (x, z) below `fromY`. */
const floorAt = (x: number, z: number, fromY = 30) => world.groundBelow(x, z, fromY, 40);
const allSpawns = (m: MapData): SpawnPoint[] => [...m.spawns.teams[0], ...m.spawns.teams[1], ...m.spawns.ffa, ...Object.values(m.modeSpawns ?? {}).flatMap((set) => Object.values(set).flat())];
const C = (u: number, y: number, w: number) => cellBlockPoint(u, y, w);

let reachCache: Reach | null = null;
const reach = () => (reachCache ??= floodFill(world, [map.spawns.teams[0][0]!]));

describe('hanoi registry and time of day', () => {
  it('is registered as a medium Black Ops map with every mode, and shows up in the vote pool', () => {
    const def = MAP_BY_ID.get('hanoi')!;
    expect(def).toBeTruthy();
    expect(def.inspiredBy).toMatch(/Black Ops/);
    expect(def.inspiredBy).toMatch(/Hanoi/);
    expect(def.size).toBe('medium');
    // Zombies is only on maps with a Zombies layer (src/shared/maps/zombies/).
    for (const mode of MODES) if (mode.id !== 'zombies') expect(def.modes).toContain(mode.id);
    for (const mode of ['tdm', 'ffa', 'dom', 'sd', 'hq']) expect(mapsForMode(mode).map((m) => m.id)).toContain('hanoi');
  });

  it('has a single night preset, and every time-of-day setting resolves to it', () => {
    expect(map.times).toHaveLength(1);
    const t = map.times[0]!;
    expect(t.id).toBe('night');
    expect(map.defaultTime).toBe('night');
    // The client's rule (game/match.ts): a setting the map doesn't have falls back to defaultTime.
    const resolveTime = (setting: string) => (setting !== 'map' && map.times.some((x) => x.id === setting) ? setting : map.defaultTime);
    for (const s of ['map', 'night', 'overcast', 'dusk', 'noon', 'day']) expect(resolveTime(s)).toBe('night');
    // Moody but readable: dark fog and sky, but a real moon and ambient, and every light group lit.
    expect(Math.max(...t.fog)).toBeLessThan(0.3);
    expect(Math.min(...t.amb)).toBeGreaterThan(0.2);
    expect(Math.max(...t.sun)).toBeGreaterThan(0.3);
    const groups = new Set(map.lights.map((l) => l.group));
    for (const g of groups) expect(t.lights[g], `light group ${g}`).toBeGreaterThan(0.5);
    expect(map.lights.length).toBeGreaterThan(60);
  });

  it('every material texture has a client recipe, and every photo it needs is in assets/textures', () => {
    const src = readFileSync(resolve(ROOT, 'src/client/render/recipes/hanoi.ts'), 'utf8');
    const ids = new Set<string>();
    for (const f of readdirSync(resolve(ROOT, 'src/client/render/recipes'))) {
      for (const m of readFileSync(resolve(ROOT, 'src/client/render/recipes', f), 'utf8').matchAll(/registerTexture\(\s*'([^']+)'/g)) ids.add(m[1]!);
    }
    for (const [name, mat] of Object.entries(map.materials)) if (mat.texture !== 'none') expect(ids.has(mat.texture), `material ${name} -> ${mat.texture}`).toBe(true);
    expect(ids.has(map.times[0]!.sky)).toBe(true);
    for (const p of new Set([...src.matchAll(/fromPhoto\('([^']+)'/g)].map((x) => x[1]!))) expect(existsSync(resolve(ROOT, 'assets/textures', `${p}.jpg`)), p).toBe(true);
  });
});

describe('hanoi layout (reference: BO1 minimap)', () => {
  it('is the 88 x 88 m medium map with the street west, the prison east and the alley leaving south-east', () => {
    const xs = HANOI_OUTLINE.map((p) => p[0]);
    const zs = HANOI_OUTLINE.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(84);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(92);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(84);
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(92);
    // Shoelace area: the playable floor of a medium map (about 5,000 m^2).
    let a = 0;
    for (let i = 0; i < HANOI_OUTLINE.length; i++) {
      const [x0, z0] = HANOI_OUTLINE[i]!;
      const [x1, z1] = HANOI_OUTLINE[(i + 1) % HANOI_OUTLINE.length]!;
      a += x0 * z1 - x1 * z0;
    }
    expect(Math.abs(a) / 2).toBeGreaterThan(4200);
    expect(Math.abs(a) / 2).toBeLessThan(6000);
    // Outline corners where the minimap has them (traced at px precision, so within a metre).
    for (const [px, pz, inside] of [[60, 60, false], [470, 60, false], [40, 400, false], [460, 450, true], [100, 120, true], [300, 100, true], [410, 300, true], [150, 380, false]] as const) {
      const [x, z] = mm(px, pz);
      expect(insideOutline(x, z), `minimap px ${px},${pz}`).toBe(inside);
    }
  });

  it('has the buildings where the minimap shows roofs, and open ground where it shows yards', () => {
    const roofs: [string, number, number, number][] = [
      ['north block', ...mm(172, 124), 3.8],
      ['theatre west wing', ...mm(152, 220), 3.8],
      ['theatre projector room', ...mm(200, 232), 3.8],
      ['guardhouse', ...mm(237, 272), 6.6],
      ['hall', ...mm(240, 328), 3.8],
      ['hall west wing', ...mm(176, 290), 3.8],
      ['hall south room', ...mm(255, 370), 3.8],
      ['barracks', ...mm(343, 300), 6.6],
      ['east house', ...mm(409, 335), 6.6],
      ['villa', ...mm(66, 213), 7.0],
      ['huts', ...mm(289, 265), 2.6],
    ];
    for (const [name, x, z, h] of roofs) expect(floorAt(x, z), name).toBeGreaterThanOrEqual(h - 0.01);
    // The Cell Block, turned 45 degrees from (250, 110) to (361, 243) on the minimap.
    const [ax, az] = mm(250, 118);
    const [bx, bz] = mm(350, 234);
    const nw = C(1, 0, 0);
    const se = C(CELL_BLOCK.length - 1, 0, 0);
    expect(Math.hypot(nw.x - ax, nw.z - az)).toBeLessThan(2.5);
    expect(Math.hypot(se.x - bx, se.z - bz)).toBeLessThan(2.5);
    for (const u of [4, 12, 18]) expect(floorAt(C(u, 0, 0).x, C(u, 0, 0).z), `cell block u ${u}`).toBeGreaterThan(3.8);
    expect(floorAt(C(26, 0, 0).x, C(26, 0, 0).z)).toBeGreaterThan(6.6);
    // Open ground: the street, the North Lane, the Gallows courtyard, the Plaza, the Yard, the Well, the South Lane, the alley.
    for (const [name, px, pz] of [['street', 90, 160], ['north lane', 200, 92], ['gallows yard', 205, 150], ['plaza', 330, 110], ['yard', 270, 240], ['well', 400, 270], ['south lane', 330, 370], ['alley', 430, 440], ['B yard', 225, 300]] as const) {
      const [x, z] = mm(px, pz);
      expect(floorAt(x, z, 20), name).toBeCloseTo(0, 1);
    }
    // Landmarks: the gallows platform, the well, the gate lintel over the open gate passage.
    expect(floorAt(-8, -15.6, 2.5)).toBeCloseTo(1.5, 1);
    expect(floorAt(27.8, 0.8, 2.5)).toBeCloseTo(0.9, 1);
    expect(floorAt(-22.2, -20.5, 3.0)).toBeCloseTo(0, 1);
    expect(floorAt(-22.2, -20.5)).toBeGreaterThan(5);
  });

  it('puts the NVA in the street and the SOG at the Well and the alley, with the flags in the original order', () => {
    const mean = (l: { x: number; z: number }[]) => ({ x: l.reduce((s, p) => s + p.x, 0) / l.length, z: l.reduce((s, p) => s + p.z, 0) / l.length });
    const t0 = mean(map.spawns.teams[0]);
    const t1 = mean(map.spawns.teams[1]);
    expect(t0.x).toBeLessThan(-20);
    expect(t0.z).toBeLessThan(-20);
    expect(t1.x).toBeGreaterThan(25);
    for (const s of map.spawns.teams[0]) expect(insideOutline(s.x, s.z) && (s.x < -22 || s.z < -29)).toBe(true);
    const dom = Object.fromEntries(map.objectives.dom!.map((o) => [o.id, o]));
    // A in the Gallows courtyard (north), B south of it between the Guardhouse and the Hall, C at the well.
    expect(dom.A!.z).toBeLessThan(-15);
    expect(dom.A!.x).toBeGreaterThan(-17);
    expect(dom.A!.x).toBeLessThan(0);
    expect(dom.B!.z).toBeGreaterThan(6.8);
    expect(dom.B!.z).toBeLessThan(11.6);
    expect(Math.abs(dom.B!.x - dom.A!.x)).toBeLessThan(6);
    expect(Math.hypot(dom.C!.x - 27.8, dom.C!.z - 0.8)).toBeLessThan(4);
    // S&D: A in the re-education room, B in the Hall.
    const sd = Object.fromEntries(map.objectives.sd!.map((o) => [o.id, o]));
    expect(sd.A!.x).toBeGreaterThan(-17.4);
    expect(sd.A!.x).toBeLessThan(-0.2);
    expect(sd.A!.z).toBeGreaterThan(-8.4);
    expect(sd.A!.z).toBeLessThan(-0.8);
    expect(sd.B!.z).toBeGreaterThan(12);
    expect(sd.B!.z).toBeLessThan(17.2);
    for (const site of map.objectives.sd!) expect(floorAt(site.x, site.z), `site ${site.id} is indoors`).toBeGreaterThan(3.5);
  });
});

describe('hanoi spawns and objectives', () => {
  it('spawns: enough for 6v6 and FFA, standing on ground, free, inside the outline', () => {
    expect(map.spawns.teams[0].length).toBeGreaterThanOrEqual(8);
    expect(map.spawns.teams[1].length).toBeGreaterThanOrEqual(8);
    expect(map.spawns.ffa.length).toBeGreaterThanOrEqual(14);
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
    const d = (o: { x: number; z: number }, set: SpawnPoint[]) => Math.min(...set.map((s) => Math.hypot(s.x - o.x, s.z - o.z)));
    const [A, B, Cf] = map.objectives.dom!;
    expect(d(A!, map.spawns.teams[0])).toBeLessThan(d(A!, map.spawns.teams[1]));
    expect(d(Cf!, map.spawns.teams[1])).toBeLessThan(d(Cf!, map.spawns.teams[0]));
    const b0 = d(B!, map.spawns.teams[0]);
    const b1 = d(B!, map.spawns.teams[1]);
    expect(Math.abs(b0 - b1) / Math.max(b0, b1)).toBeLessThan(0.2);
  });
});

describe('hanoi play space', () => {
  it('everything is reachable on foot from an NVA spawn: spawns, objectives, hotspots, every upper floor', () => {
    const r = reach();
    for (const s of allSpawns(map)) expect(r.near(s, 0.9), `spawn ${JSON.stringify(s)}`).toBe(true);
    for (const [kind, list] of Object.entries(map.objectives)) for (const o of list) expect(r.near(o, o.radius), `${kind} ${o.id}`).toBe(true);
    for (const h of map.hotspots ?? []) expect(r.near(h, 1.5), `hotspot ${JSON.stringify(h)}`).toBe(true);
    // Upper floors: the Guardhouse, the Barracks, the East House (balcony), the Cell Block guard end, the wall walk, the gallows.
    for (const [name, p] of [['guardhouse', v(-2.6, 3.2, 3.4)], ['barracks', v(18.7, 3.2, 9)], ['east house', v(31.4, 3.2, 16)], ['balcony', v(28.5, 3.1, 15.0)], ['cell block upstairs', C(27, 3.2, -1)], ['wall walk', v(30, 3.2, -7.2)], ['gallows', v(-8, 1.5, -16.8)]] as const) expect(r.near(p, 0.9), name).toBe(true);
    expect(r.nodes.filter((n) => n.y > 2.5).length).toBeGreaterThan(80);
  }, 180_000); // the first walk flood (it mantles too) runs here

  it('bounds are closed: no reachable spot is outside, and sprint-jumping outwards stops at the walls', () => {
    const r = reach();
    const b = map.bounds;
    for (const n of r.nodes) {
      expect(insideOutline(n.x, n.z), `node ${JSON.stringify(n)}`).toBe(true);
      expect(n.y).toBeGreaterThan(MOVE.killY);
    }
    for (const start of [map.spawns.teams[0][0]!, map.spawns.teams[0][7]!, map.spawns.teams[1][0]!, map.spawns.teams[1][5]!, map.spawns.ffa[7]!, map.spawns.ffa[13]!]) {
      for (let i = 0; i < 16; i++) {
        const yaw = (i / 16) * Math.PI * 2;
        const s = { ...createMoveState(start.x, start.y, start.z), onGround: true };
        for (let t = 0; t < 20 * 60; t++) stepMove(world, s, Buttons.FORWARD | Buttons.SPRINT | (t % 40 === 0 ? Buttons.JUMP : 0), yaw, 1 / 60);
        expect(s.x > b.min.x && s.x < b.max.x && s.z > b.min.z && s.z < b.max.z, `ran out at ${s.x.toFixed(1)},${s.z.toFixed(1)}`).toBe(true);
        expect(insideOutline(s.x, s.z), `outside the outline at ${s.x.toFixed(1)},${s.z.toFixed(1)}`).toBe(true);
        expect(s.y).toBeGreaterThan(-0.5);
        expect(s.y, `on a roof at ${s.x.toFixed(1)},${s.y.toFixed(1)},${s.z.toFixed(1)}`).toBeLessThan(4.4);
      }
    }
  });
});

describe('hanoi walks', () => {
  it('street -> gate -> gallows (up and down) -> re-education room -> Yard -> B -> Hall -> alley -> South Lane -> SOG spawn', () => {
    const route = [
      v(-24, 0, -20.5), v(-20, 0, -20.5), v(-15.4, 0, -19.6), v(-15.4, 0, -15.4), v(-12.0, 1.5, -15.4), v(-8.0, 1.5, -16.8), v(-12.0, 1.5, -15.4), v(-15.4, 0, -15.4),
      v(-7.0, 0, -12.0), v(-7.0, 0.36, -10.0), v(-7.0, 0, -7.4), v(-1.2, 0, -7.0), v(-1.2, 0, -4.6), v(1.5, 0, -4.6), v(2.8, 0, 2.0), v(2.2, 0, 8.2), v(-4.6, 0, 9.2),
      v(-6.0, 0, 10.6), v(-6.0, 0, 13.5), v(11.8, 0, 13.5), v(11.8, 0, 14.6), v(14.5, 0, 14.6), v(14.5, 0, 21), v(25, 0, 21), v(30, 0, 29), v(36, 0, 36),
    ];
    const r = walkRoute(world, map.spawns.teams[0][6]!, route);
    expect(r.maxY).toBeGreaterThan(1.4);
    expect(r.seconds).toBeLessThan(60);
  });

  it('North Lane -> through the North Block -> Domination A; and the passage past the Cell Block into the Yard', () => {
    const a = walkRoute(world, v(-17.6, 0, -33), [v(-13.7, 0, -31), v(-13.7, 0, -27.5), v(-13.7, 0, -26.3), v(-11.4, 0, -26.3), v(-11.4, 0, -22), v(-7.6, 0, -20.8)]);
    expect(a.state.y).toBeCloseTo(0, 1);
    const b = walkRoute(world, v(-12, 0, -33), [v(-6, 0, -28), v(-6, 0, -24), v(4, 0, -12), v(8, 0, -7)]);
    expect(b.state.y).toBeCloseTo(0, 1);
  });

  it('through the Cell Block corridor and up its inside stairs to the guard room over the Well', () => {
    const r = walkRoute(world, v(8, 0, -7), [C(16, 0, 4.0), C(16, 0, 1.2), C(20.4, 0, 0.3), C(21.8, 0, 0.3), C(21.8, 0, 1.7), C(28.7, 3.2, 1.7), C(28.7, 3.2, -1)]);
    expect(r.state.y).toBeCloseTo(3.2, 1);
    // And from the NE door into the corridor, out the NW end.
    const s = walkRoute(world, C(8, 0, -4.4), [C(8, 0, -2.0), C(8, 0, 1.2), C(1.2, 0, 1.0), C(-1.2, 0, 1.0)]);
    expect(s.state.y).toBeCloseTo(0, 1);
  });

  it('up the Guardhouse stairs, the Barracks stairs, the East House ladder and the Well stairs onto the wall', () => {
    const g = walkRoute(world, v(2.4, 0, 8.0), [v(0.9, 0, 7.4), v(0.9, 3.2, 1.0), v(-0.6, 3.2, 0.9), v(-2.6, 3.2, 3.4)]);
    expect(g.state.y).toBeCloseTo(3.2, 1);
    const b = walkRoute(world, v(14.0, 0, 18.3), [v(14.6, 0, 18.3), v(19.6, 3.2, 18.3), v(20.2, 3.2, 18.6), v(20.2, 3.2, 16.6), v(18.7, 3.2, 9)]);
    expect(b.state.y).toBeCloseTo(3.2, 1);
    const e = walkRoute(world, v(25.4, 0, 16.85), [v(26.0, 0, 16.85), v(28.4, 3.1, 16.85), v(28.4, 3.1, 15.6), v(30.4, 3.2, 15.6), v(31.4, 3.2, 16)]);
    expect(e.state.y).toBeCloseTo(3.2, 1);
    const w = walkRoute(world, v(23.8, 0, 0.2), [v(23.8, 0, -0.8), v(23.8, 3.2, -7.4), v(24.0, 3.2, -8.4), v(25.6, 3.2, -7.2), v(31.0, 3.2, -7.2)]);
    expect(w.state.y).toBeCloseTo(3.2, 1);
  });

  it('the Plaza -> through the arched gate -> the Well', () => {
    const r = walkRoute(world, v(12, 0, -29), [v(16, 0, -22), v(19.8, 0, -11.5), v(27.5, 0, -9.6), v(27.5, 0, -5), v(27.5, 0, -3)]);
    expect(r.state.y).toBeCloseTo(0, 1);
  });
});

describe('hanoi modes', () => {
  let store: Store;
  let lobby: Lobby;
  beforeAll(() => {
    registerModeRules();
    store = new Store(':memory:');
    lobby = new Lobby({ store, features: [modesFeature, economyFeature], log: () => {}, autoTick: false });
  });
  afterAll(() => {
    lobby.shutdown();
    store.close();
  });

  for (const mode of MODES) {
    it(`${mode.id}: a bot-filled room builds on Hanoi and everyone spawns inside the map`, () => {
      const room = lobby.createRoom({ mode: mode.id, map: 'hanoi', botFill: 8, closeWhenEmpty: false, persist: false });
      room.fillBots();
      for (let i = 0; i < Math.round(3 / TICK_DT); i++) room.step();
      expect(room.map.id).toBe('hanoi');
      expect(room.bots().length).toBeGreaterThan(1);
      for (const p of room.players.values()) {
        if (!p.alive) continue;
        expect(insideOutline(p.move.x, p.move.z), `${p.name} at ${p.move.x.toFixed(1)},${p.move.z.toFixed(1)}`).toBe(true);
        expect(p.move.y).toBeGreaterThan(-0.5);
      }
      room.close();
    });
  }
});

describe('hanoi bot nav', () => {
  it('the bots NavGrid finds a path from both team spawns to every objective and hotspot, upper floors included', () => {
    const nav = new NavGrid(map);
    const targets: { name: string; p: Vec3; r: number }[] = [
      ...Object.entries(map.objectives).flatMap(([kind, list]) => list.map((o) => ({ name: `${kind} ${o.id}`, p: v(o.x, o.y, o.z), r: o.radius }))),
      ...(map.hotspots ?? []).map((h, i) => ({ name: `hotspot ${i}`, p: h, r: 1.5 })),
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

describe('hanoi sightlines', () => {
  it('the street runs clear end to end; the gate looks across the Gallows courtyard; the Hall is one long room', () => {
    expect(world.lineOfSight(v(-30, eye, -41), v(-30, eye, -14))).toBe(true);
    expect(world.lineOfSight(v(-21, eye, -20.5), v(-1, eye, -20))).toBe(true);
    expect(world.lineOfSight(v(-11, eye, 13.2), v(12, eye, 13.2))).toBe(true);
    // The North Lane into the Plaza along the north wall.
    expect(world.lineOfSight(v(-18, eye, -35), v(25, eye, -36))).toBe(true);
  });

  it('the high windows: the guard room over the Well, the Barracks over the Yard, the Guardhouse over B', () => {
    expect(world.lineOfSight(C(29.4, 3.2 + eye, 0), v(28, eye, 4.5))).toBe(true);
    expect(world.lineOfSight(v(16.7, 3.2 + eye, 12), v(4, eye, 9))).toBe(true);
    expect(world.lineOfSight(v(-2.6, 3.2 + eye, 6.2), v(-4.6, eye, 9.6))).toBe(true);
  });

  it('the prison blocks the views across it', () => {
    // Street to the Yard through the theatre; the Plaza to the Yard through the Cell Block; the street to the Well.
    expect(world.lineOfSight(v(-30, eye, -6), v(5, eye, -6))).toBe(false);
    expect(world.lineOfSight(v(10, eye, -32), v(-4, eye, -12))).toBe(false);
    expect(world.lineOfSight(v(-30, eye, -20), v(28, eye, 2))).toBe(false);
    // The Hall separates B from the South Lane.
    expect(world.lineOfSight(v(-4.6, eye, 9.2), v(8, eye, 22))).toBe(false);
  });
});
