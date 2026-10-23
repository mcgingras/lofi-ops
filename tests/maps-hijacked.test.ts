/**
 * Hijacked (BO2): layout checks against the reference in docs/maps/hijacked-reference.md (the BO2
 * minimap traced at 1 px = 0.19 m), spawns, objectives, reachability through the real movement
 * code, the sea (walking never leaves the yacht; jumping the railing drops you in the sea, which
 * kills), scripted routes through both cabins and below deck, bot nav, and the signature sightlines.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NavGrid } from '../src/server/features/bots/nav';
import { MOVE, PLAYER } from '../src/shared/constants';
import { getMapData, MAP_BY_ID } from '../src/shared/defs/maps';
import { MODES } from '../src/shared/defs/modes';
import { Buttons } from '../src/shared/input';
import type { Vec3 } from '../src/shared/math';
import { createMoveState, stepMove } from '../src/shared/movement';
import { HIJACKED_LEVELS as LV, hullHalfWidth } from '../src/shared/maps/hijacked';
import { buildCollisionWorld, type MapData, type SpawnPoint } from '../src/shared/maps/types';
import { floodFill, walkRoute, type Reach } from './maps-bo-nav';

const ROOT = resolve(import.meta.dirname, '..');
const map = getMapData('hijacked');
const world = buildCollisionWorld(map);
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const eye = PLAYER.eye;
const allSpawns = (m: MapData): SpawnPoint[] => [...m.spawns.teams[0], ...m.spawns.teams[1], ...m.spawns.ffa, ...Object.values(m.modeSpawns ?? {}).flatMap((set) => Object.values(set).flat())];
const floorAt = (x: number, z: number, fromY = 30) => world.groundBelow(x, z, fromY, 40);

/**
 * On the yacht: the player box over the hull outline (railing tops included: a 1 m glass railing can
 * be jumped onto, as in BO2) or on the port catwalk, above the engine room floor.
 */
const reachW = (z: number) => Math.max(hullHalfWidth(z - 0.3), hullHalfWidth(z), hullHalfWidth(z + 0.3));
const onBoard = (x: number, y: number, z: number) => y > LV.lower - 0.15 && (Math.abs(x) <= reachW(z) + 0.4 || (x >= -10.45 && x <= -8.0 && z >= -10.85 && z <= 11.25));

let reachMemo: Reach | null = null;
const reach = () => (reachMemo ??= floodFill(world, [map.spawns.teams[0][0]!]));

describe('hijacked registry and textures', () => {
  it('is registered as a small Black Ops II map with every mode', () => {
    const def = MAP_BY_ID.get('hijacked')!;
    expect(def.inspiredBy).toMatch(/Black Ops II/);
    expect(def.size).toBe('small');
    // Zombies is only on maps with a Zombies layer (src/shared/maps/zombies/); Blackout has its own map.
    for (const mode of MODES) if (mode.id !== 'zombies' && mode.id !== 'blackout') expect(def.modes).toContain(mode.id);
  });

  it('every material and sky has a client recipe, and every photo they need is in assets/textures', () => {
    const dir = resolve(ROOT, 'src/client/render/recipes');
    const ids = new Set<string>();
    for (const f of ['hijacked.ts', 'bo-common.ts', 'nuketown.ts', 'yard.ts', 'core.ts']) for (const m of readFileSync(resolve(dir, f), 'utf8').matchAll(/registerTexture\(\s*'([^']+)'/g)) ids.add(m[1]!);
    for (const [name, mat] of Object.entries(map.materials)) if (mat.texture !== 'none') expect(ids.has(mat.texture), `${name} -> ${mat.texture}`).toBe(true);
    for (const t of map.times) expect(ids.has(t.sky), t.sky).toBe(true);
    expect(map.times.map((t) => t.id)).toEqual(['day', 'sunset']);
    const src = readFileSync(resolve(dir, 'hijacked.ts'), 'utf8');
    for (const m of src.matchAll(/fromPhoto\('([^']+)'/g)) expect(existsSync(resolve(ROOT, 'assets/textures', `${m[1]}.jpg`)), m[1]).toBe(true);
  });
});

describe('hijacked layout (reference: BO2 minimap, 0.19 m/px)', () => {
  it('is the 83 m x 16 m yacht, bow north, with open sea round it', () => {
    // Deck from the bow tip to the transom, beam 16.2 m amidships.
    expect(floorAt(0, -40.5)).toBeCloseTo(LV.forepeak, 1);
    expect(floorAt(0, 40.6)).toBeCloseTo(LV.deck, 1);
    expect(floorAt(0, 42.0)).toBeNull();
    expect(floorAt(0, -42.2)).toBeNull();
    expect(floorAt(7.6, 0, 0.5)).toBeCloseTo(0, 1);
    expect(floorAt(8.6, 18)).toBeNull();
    // Nothing to stand on over the sea anywhere round the hull (the catwalk is the one ledge outside it).
    for (let z = -41; z <= 41; z += 1) {
      const w = hullHalfWidth(z);
      for (const s of [-1, 1]) {
        if (s < 0 && z > -11.5 && z < 12) continue;
        expect(floorAt(s * (reachW(z) + 0.7), z), `outside the hull at ${z}`).toBeNull();
      }
    }
  });

  it('follows the traced hull outline (half width at the minimap rows, within 0.35 m)', () => {
    const rows: [number, number][] = [[30, 14.5], [50, 25.5], [70, 33.5], [90, 39.5], [110, 42.5], [235, 42.5], [360, 42.5], [395, 36.5], [420, 31.5], [440, 21.5]];
    for (const [my, halfPx] of rows) {
      const z = (my - 235) * 0.19;
      expect(Math.abs(hullHalfWidth(z) - halfPx * 0.19), `row ${my}`).toBeLessThan(0.35);
      // The walkable deck reaches the outline (to within a band step and the railing).
      expect(floorAt(hullHalfWidth(z) - 0.5, z), `deck at row ${my}`).not.toBeNull();
    }
  });

  it('has the two cabins, two storeys each, where the minimap puts them', () => {
    // Bow Cabin x -5.4..5.4, z -20..-7.6; Stern Cabin x -5.6..5.6, z 6.4..17.4 (upper to 14.4).
    for (const [x, z] of [[0, -14], [-3, -18], [3, -9], [0, 10], [-3, 8], [3, 13]] as const) {
      expect(floorAt(x, z, 4.0), `upper floor at ${x},${z}`).toBeCloseTo(LV.upper, 1);
      expect(floorAt(x, z), `roof at ${x},${z}`).toBeGreaterThan(5.9);
    }
    // The stern terrace is open to the sky; walkways down both sides of both cabins stay open.
    expect(floorAt(0, 17.5)).toBeCloseTo(LV.upper, 1);
    for (const z of [-18, -12, 9, 15]) for (const x of [-6.8, 6.8]) expect(floorAt(x, z), `walkway ${x},${z}`).toBeCloseTo(0, 1);
  });

  it('central deck: shower block on the centreline, hot tub bay on port, cabana bar on starboard, the catwalk outside', () => {
    expect(floorAt(-0.6, -0.6, 5)).toBeCloseTo(2.5, 1); // (under the roof clip that keeps mantles off it)
    expect(floorAt(-7.0, -6.0)).toBeCloseTo(3.0, 1);
    expect(floorAt(-7.0, 3.0)).toBeCloseTo(3.0, 1);
    expect(floorAt(-6.2, -2.1)).toBeCloseTo(0.6, 1);
    expect(floorAt(6.2, -0.5)).toBeGreaterThan(2.6);
    expect(floorAt(6.2, -0.5, 2.0)).toBeCloseTo(0, 1);
    expect(floorAt(-9.3, 0)).toBeCloseTo(0, 1);
    expect(floorAt(-9.3, -12)).toBeNull();
    // Below deck: the passage floor under the middle, solid hull outside it.
    expect(floorAt(-4.6, 0, -0.5)).toBeCloseTo(LV.lower, 1);
    expect(floorAt(1.6, 12, -0.5)).toBeCloseTo(LV.lower, 1);
    expect(world.free(5.0, LV.lower + 0.01, 0)).toBe(false);
  });

  it('bow and stern decks: raised forepeak, the tenders, the sunken pool and the stern hot tub', () => {
    expect(floorAt(0, -36)).toBeCloseTo(LV.forepeak, 1);
    expect(floorAt(0, -31)).toBeCloseTo(0, 1);
    expect(floorAt(-5, -28)).toBeGreaterThan(1.3);
    expect(floorAt(5, -28)).toBeGreaterThan(1.3);
    expect(floorAt(-0.3, 34)).toBeCloseTo(-1.2, 1);
    expect(floorAt(-0.3, 28.2)).toBeCloseTo(0.5, 1);
  });
});

describe('hijacked spawns and objectives', () => {
  it('spawns: enough for 6v6 and FFA, standing on the ground, free, inside the bounds', () => {
    expect(map.spawns.teams[0].length).toBeGreaterThanOrEqual(8);
    expect(map.spawns.teams[1].length).toBeGreaterThanOrEqual(8);
    expect(map.spawns.ffa.length).toBeGreaterThanOrEqual(12);
    expect(map.modeSpawns!.sd!.attackers!.length).toBeGreaterThanOrEqual(6);
    expect(map.modeSpawns!.sd!.defenders!.length).toBeGreaterThanOrEqual(6);
    for (const s of allSpawns(map)) {
      const g = world.groundBelow(s.x, s.z, s.y + 0.2, 0.4);
      expect(g, `ground under ${JSON.stringify(s)}`).not.toBeNull();
      expect(Math.abs(g! - s.y)).toBeLessThan(0.05);
      expect(world.free(s.x, g! + 0.01, s.z), `free at ${JSON.stringify(s)}`).toBe(true);
      expect(onBoard(s.x, s.y, s.z), `on board ${JSON.stringify(s)}`).toBe(true);
    }
  });

  it('teams start at opposite ends: team 0 on the bow, team 1 on the stern, spread out', () => {
    const [a, b] = map.spawns.teams;
    for (const s of a) expect(s.z).toBeLessThan(-22);
    for (const s of b) expect(s.z).toBeGreaterThan(22);
    for (const set of [a, b]) for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) expect(Math.hypot(set[i]!.x - set[j]!.x, set[i]!.z - set[j]!.z)).toBeGreaterThan(1.5);
    for (const p of a) for (const q of b) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(40);
  });

  it('objectives: dom A bow / B middle / C stern, S&D sites on the central deck and in the Stern Cabin, HQ everywhere', () => {
    const dom = Object.fromEntries(map.objectives.dom!.map((o) => [o.id, o]));
    expect(Object.keys(dom)).toEqual(['A', 'B', 'C']);
    expect(dom.A!.z).toBeLessThan(-20);
    expect(Math.abs(dom.B!.z)).toBeLessThan(4);
    expect(dom.C!.z).toBeGreaterThan(20);
    const sd = Object.fromEntries(map.objectives.sd!.map((o) => [o.id, o]));
    expect(sd.A!.x).toBeGreaterThan(1.5);
    expect(Math.abs(sd.A!.z)).toBeLessThan(6.4);
    expect(sd.B!.z).toBeGreaterThan(6.4);
    expect(sd.B!.z).toBeLessThan(17.4);
    for (const site of map.objectives.sd!) for (const s of map.modeSpawns!.sd!.attackers!) expect(Math.hypot(site.x - s.x, site.z - s.z)).toBeGreaterThan(25);
    for (const s of map.modeSpawns!.sd!.defenders!) expect(s.z).toBeGreaterThan(14);
    const hqY = new Set(map.objectives.hq!.map((o) => o.y));
    expect(hqY.has(LV.lower) && hqY.has(LV.upper) && hqY.has(0)).toBe(true);
    for (const list of Object.values(map.objectives))
      for (const o of list) {
        const g = world.groundBelow(o.x, o.z, o.y + 0.2, 0.4);
        expect(g, `${o.id} ground`).not.toBeNull();
        expect(Math.abs(g! - o.y)).toBeLessThan(0.05);
      }
    // Domination B is as far from one team's spawns as from the other's.
    const d = (o: { x: number; z: number }, set: SpawnPoint[]) => Math.min(...set.map((s) => Math.hypot(s.x - o.x, s.z - o.z)));
    const b0 = d(dom.B!, map.spawns.teams[0]);
    const b1 = d(dom.B!, map.spawns.teams[1]);
    expect(Math.abs(b0 - b1) / Math.max(b0, b1)).toBeLessThan(0.2);
  });

  it('every objective mode builds its data', () => {
    for (const kind of ['dom', 'sd', 'hq']) expect(map.objectives[kind]!.length).toBeGreaterThan(1);
    expect(map.objectives.sd!.every((o) => o.team === 1)).toBe(true);
  });
});

describe('hijacked reachability and the sea', () => {
  it('everything is reachable on foot from a bow spawn: spawns, objectives, hotspots, both upper floors, below deck', () => {
    const r = reach();
    for (const s of allSpawns(map)) expect(r.near(s, 0.9), `spawn ${JSON.stringify(s)}`).toBe(true);
    for (const [kind, list] of Object.entries(map.objectives)) for (const o of list) expect(r.near(o, o.radius), `${kind} ${o.id}`).toBe(true);
    for (const h of map.hotspots ?? []) expect(r.near(h, 1.5), `hotspot ${JSON.stringify(h)}`).toBe(true);
    expect(r.nodes.filter((n) => n.y > 2.5 && n.z < 0).length).toBeGreaterThan(40);
    expect(r.nodes.filter((n) => n.y > 2.5 && n.z > 0).length).toBeGreaterThan(40);
    expect(r.nodes.filter((n) => n.y < -3).length).toBeGreaterThan(60);
  }, 180_000); // the first walk flood (it mantles too) runs here

  it('nothing reachable on foot is off the yacht or out of bounds', () => {
    const b = map.bounds;
    for (const n of reach().nodes) {
      expect(onBoard(n.x, n.y, n.z), `node ${JSON.stringify(n)}`).toBe(true);
      expect(n.x > b.min.x && n.x < b.max.x && n.z > b.min.z && n.z < b.max.z && n.y > b.min.y).toBe(true);
    }
  });

  it('walking (sprinting) outwards from spawns never leaves the yacht: the railings stop you', () => {
    for (const start of [map.spawns.teams[0][3]!, map.spawns.teams[1][2]!, map.spawns.ffa[2]!, map.spawns.ffa[4]!, map.spawns.ffa[14]!]) {
      for (let i = 0; i < 16; i++) {
        const yaw = (i / 16) * Math.PI * 2;
        const s = { ...createMoveState(start.x, start.y, start.z), onGround: true };
        for (let t = 0; t < 20 * 60; t++) stepMove(world, s, Buttons.FORWARD | Buttons.SPRINT, yaw, 1 / 60);
        expect(onBoard(s.x, s.y, s.z), `walked off at ${s.x.toFixed(1)},${s.y.toFixed(1)},${s.z.toFixed(1)} (yaw ${i})`).toBe(true);
      }
    }
  });

  it('jumping the railing drops you into the sea and the kill height; you never stand outside the yacht', () => {
    const b = map.bounds;
    let overboard = 0;
    for (const start of [map.spawns.teams[0][3]!, map.spawns.teams[1][2]!, map.spawns.ffa[2]!, map.spawns.ffa[14]!]) {
      for (let i = 0; i < 16; i++) {
        const yaw = (i / 16) * Math.PI * 2;
        const s = { ...createMoveState(start.x, start.y, start.z), onGround: true };
        for (let t = 0; t < 25 * 60 && s.y > b.min.y; t++) {
          stepMove(world, s, Buttons.FORWARD | Buttons.SPRINT | (t % 40 === 0 ? Buttons.JUMP : 0), yaw, 1 / 60);
          if (s.onGround) expect(onBoard(s.x, s.y, s.z), `standing off the yacht at ${s.x.toFixed(1)},${s.z.toFixed(1)}`).toBe(true);
          // While alive the player stays inside the horizontal bounds (the server kills 2 m past them).
          expect(s.x > b.min.x && s.x < b.max.x && s.z > b.min.z && s.z < b.max.z).toBe(true);
        }
        if (s.y <= b.min.y) overboard++;
        else expect(onBoard(s.x, s.y, s.z)).toBe(true);
      }
    }
    // Some of those runs do clear the railing (the railing is jumpable, as in BO2).
    expect(overboard).toBeGreaterThan(0);
    expect(b.min.y).toBeGreaterThan(MOVE.killY);
    expect(b.min.y).toBeLessThan(LV.lower);
  });

  it('a jump over the starboard railing hits the water and the kill height within 1.5 s', () => {
    const s = { ...createMoveState(7.2, 0, -14), onGround: true };
    let t = 0;
    for (; t < 3 * 60 && s.y > map.bounds.min.y; t++) stepMove(world, s, Buttons.FORWARD | (t < 20 ? Buttons.JUMP : 0), -Math.PI / 2, 1 / 60);
    expect(s.y).toBeLessThanOrEqual(map.bounds.min.y);
    expect(t / 60).toBeLessThan(1.5);
    expect(s.x).toBeGreaterThan(8.1);
  });
});

describe('hijacked routes', () => {
  it('bow spawn -> Bow Cabin front door -> dining -> lane -> the chute -> container bay -> engine room -> stern stairwell -> lobby -> stern deck', () => {
    const r = walkRoute(world, map.spawns.teams[0][5]!, [
      v(-2.4, 0, -23), v(-2.4, 0, -20.6), v(-2.4, 0, -18.9), v(-2.4, 0, -16.2), v(-2.4, 0, -14.6), v(-4.45, 0, -14.7), v(-4.45, LV.lower, -7.2),
      v(-4.3, LV.lower, -6.2), v(-4.3, LV.lower, 5.0), v(-4.4, LV.lower, 6.1), v(-4.65, LV.lower, 8.4), v(-4.65, 0, 15.6), v(0, 0, 16.2), v(0, 0, 18.5), v(0, 0, 25.0),
    ]);
    expect(r.state.y).toBeCloseTo(0, 1);
    expect(r.seconds).toBeLessThan(25);
  });

  it('Bow Cabin: exterior stair to the bridge, office, stairs down through the galley, out the back', () => {
    const r = walkRoute(world, v(-0.5, 0, -22.4), [v(0.0, 0, -20.8), v(4.3, LV.upper, -20.8), v(4.45, LV.upper, -19.2), v(0, LV.upper, -17.0), v(0, LV.upper, -14.6), v(4.5, LV.upper, -15.1), v(4.5, LV.upper, -14.0), v(4.5, 0, -8.6), v(3.4, 0, -8.6), v(1.55, 0, -8.4), v(1.55, 0, -6.0)]);
    expect(r.maxY).toBeGreaterThan(3.1);
    expect(r.state.y).toBeCloseTo(0, 1);
  });

  it('Stern Cabin: terrace stairs up, the stateroom, stairs down into the lounge, out the fore door to the showers', () => {
    const r = walkRoute(world, v(4.5, 0, 25.0), [v(4.5, 0, 24.0), v(4.5, LV.upper, 19.6), v(2.35, LV.upper, 16.0), v(2.35, LV.upper, 13.0), v(4.7, LV.upper, 12.0), v(4.7, LV.upper, 11.3), v(4.7, 0, 7.0), v(3.0, 0, 7.4), v(-1.8, 0, 7.4), v(-1.8, 0, 5.0), v(-1.0, 0, 3.6)]);
    expect(r.maxY).toBeGreaterThan(3.1);
    expect(r.state.y).toBeCloseTo(0, 1);
  });

  it('the flanks: port walkway -> emergency catwalk round the hot tub bay; starboard walkway through the cabana behind the bar', () => {
    const port = walkRoute(world, v(-6.8, 0, -16), [v(-7.0, 0, -10.2), v(-9.25, 0, -9.5), v(-9.25, 0, 10.0), v(-7.0, 0, 11.0), v(-6.8, 0, 20.0)]);
    expect(port.state.y).toBeCloseTo(0, 1);
    const stbd = walkRoute(world, v(6.8, 0, -16), [v(6.6, 0, -7.0), v(6.4, 0, -5.0), v(6.2, 0, 0), v(6.4, 0, 4.8), v(6.8, 0, 8.0), v(6.8, 0, 20.0)]);
    expect(stbd.state.y).toBeCloseTo(0, 1);
  });

  it('bot nav: paths from both team spawns to every objective, hotspot and spawn, decks above and below included', () => {
    const nav = new NavGrid(map);
    const targets = [
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

describe('hijacked sightlines', () => {
  it('the upper windows overlook the middle; the shower block hides a man behind it; the cabins split the ship', () => {
    // Bow office window over the hot tub bay and the starboard courtyard.
    expect(world.lineOfSight(v(1.0, LV.upper + eye, -8.2), v(-5.6, eye, -2.0))).toBe(true);
    expect(world.lineOfSight(v(1.0, LV.upper + eye, -8.2), v(2.4, eye, 1.0))).toBe(true);
    // Stateroom window back at the bow office window, over the shower block.
    expect(world.lineOfSight(v(0.5, LV.upper + eye, 6.9), v(1.0, LV.upper + eye, -8.1))).toBe(true);
    // ...but a standing man right behind the showers is out of sight from either window.
    expect(world.lineOfSight(v(-0.6, LV.upper + eye, -8.2), v(-0.6, eye, 4.0))).toBe(false);
    expect(world.lineOfSight(v(-0.6, LV.upper + eye, 6.8), v(-0.6, eye, -5.4))).toBe(false);
    // Bow to stern along the centreline is blocked by both cabins.
    expect(world.lineOfSight(v(0, eye, -30), v(0, eye, 30))).toBe(false);
  });

  it('flanks: the walkways run clear past the cabins, the hot tub bay closes the port deck, the catwalk runs its length', () => {
    expect(world.lineOfSight(v(6.8, eye, -22), v(6.8, eye, -7.8))).toBe(true);
    expect(world.lineOfSight(v(-6.8, eye, 7.0), v(-6.8, eye, 22))).toBe(true);
    expect(world.lineOfSight(v(-7.0, eye, -9.0), v(-7.0, eye, 6.0))).toBe(false);
    expect(world.lineOfSight(v(-9.3, eye, -10.5), v(-9.3, eye, 11.0))).toBe(true);
    // The starboard walkway runs on through the cabana behind the bar; its end walls hide the courtyard.
    expect(world.lineOfSight(v(7.0, eye, -12), v(7.0, eye, 12))).toBe(true);
    expect(world.lineOfSight(v(7.0, eye, -12), v(2.5, eye, 2))).toBe(false);
  });

  it('below deck: the bulkheads break the passage into the container bay, engine room and generator room', () => {
    expect(world.lineOfSight(v(-2.0, LV.lower + eye, -9), v(-2.0, LV.lower + eye, 0))).toBe(false);
    expect(world.lineOfSight(v(-4.3, LV.lower + eye, -5.5), v(-4.3, LV.lower + eye, 5.5))).toBe(true);
    expect(world.lineOfSight(v(-4.3, LV.lower + eye, 0), v(1.2, LV.lower + eye, 0))).toBe(true);
  });
});
