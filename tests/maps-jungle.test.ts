/**
 * Jungle (BO1): the layout against the reference trace (docs/maps/jungle-reference.md: the BO1
 * overhead, 0.27 m per pixel), spawns and objectives, reachability through the real movement
 * code, closed bounds, scripted walks along the River, over the Bridge and up the Lookout, every
 * mode building on the map, and the signature sightlines.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NavGrid } from '../src/server/features/bots/nav';
import modesFeature, { registerModeRules } from '../src/server/features/modes/index';
import { controllerOf } from '../src/server/features/modes/common';
import type { DomRules } from '../src/server/features/modes/dom';
import type { SdRules } from '../src/server/features/modes/sd';
import { Lobby } from '../src/server/lobby';
import { Store } from '../src/server/store';
import { MOVE, PLAYER, TICK_DT } from '../src/shared/constants';
import { getMapData, MAP_BY_ID } from '../src/shared/defs/maps';
import { MODES } from '../src/shared/defs/modes';
import { Buttons } from '../src/shared/input';
import type { Vec3 } from '../src/shared/math';
import { createMoveState, stepMove } from '../src/shared/movement';
import { JUNGLE_LEVELS as L, JUNGLE_OUTLINE, JUNGLE_PLAN, jungleGroundLevel, px, pz } from '../src/shared/maps/jungle';
import { buildCollisionWorld, type MapData, type SpawnPoint } from '../src/shared/maps/types';
import { floodFill, walkRoute, type Reach } from './maps-bo-nav';

const ROOT = resolve(import.meta.dirname, '..');
const map = getMapData('jungle');
const world = buildCollisionWorld(map);
const eye = PLAYER.eye;
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
/** A point given in overhead pixels at height y. */
const P = (a: number, b: number, y = 0): Vec3 => v(px(a), y, pz(b));
const top = (a: number, b: number, from = 30) => world.groundBelow(px(a), pz(b), from, 40);

const allSpawns = (m: MapData): SpawnPoint[] => [...m.spawns.teams[0], ...m.spawns.teams[1], ...m.spawns.ffa, ...Object.values(m.modeSpawns ?? {}).flatMap((set) => Object.values(set).flat())];

/** A turned frame of the map (same numbers as jungle.ts). */
const frame = (oa: number, ob: number, th: number) => {
  const c = Math.cos(th);
  const s = Math.sin(th);
  return (u: number, y: number, w: number) => v(px(oa) + u * c - w * s, y, pz(ob) + u * s + w * c);
};

function inside(poly: [number, number][], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

let reachCache: Reach | null = null;
const reach = () => (reachCache ??= floodFill(world, [map.spawns.teams[0][0]!]));

describe('jungle: registry and textures', () => {
  it('is registered as a medium Black Ops map with every mode', () => {
    const def = MAP_BY_ID.get('jungle')!;
    expect(def).toBeTruthy();
    expect(def.inspiredBy).toMatch(/Black Ops/);
    expect(def.size).toBe('medium');
    for (const mode of MODES) expect(def.modes).toContain(mode.id);
  });

  it('every material has a client recipe (and every photo it develops is in assets/textures)', () => {
    const dir = resolve(ROOT, 'src/client/render/recipes');
    const ids = new Set<string>();
    for (const f of readdirSync(dir)) for (const m of readFileSync(resolve(dir, f), 'utf8').matchAll(/registerTexture\(\s*['`]([^'`$]+)['`]/g)) ids.add(m[1]!);
    for (const [name, mat] of Object.entries(map.materials)) if (mat.texture !== 'none') expect(ids.has(mat.texture), `${name} -> ${mat.texture}`).toBe(true);
    for (const t of map.times) expect(ids.has(t.sky), t.sky).toBe(true);
    const src = readFileSync(resolve(dir, 'jungle.ts'), 'utf8');
    for (const m of [...src.matchAll(/fromPhoto\('([^']+)'/g), ...src.matchAll(/c\.photo\('([^']+)'/g)]) expect(existsSync(resolve(ROOT, 'assets/textures', `${m[1]}.jpg`)), m[1]).toBe(true);
  });

  it('has the humid day and misty morning presets', () => {
    expect(map.times.map((t) => t.id)).toEqual(['day', 'morning']);
    expect(map.defaultTime).toBe('day');
    const [day, mist] = map.times;
    expect(mist!.fogFar).toBeLessThan(day!.fogFar / 1.5);
  });
});

describe('jungle: layout against the reference trace', () => {
  it('is the 0.27 m/px overhead: about 114 x 95 m of play space, wider east-west', () => {
    const xs = JUNGLE_OUTLINE.map((p) => p[0]);
    const zs = JUNGLE_OUTLINE.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const d = Math.max(...zs) - Math.min(...zs);
    expect(w).toBeGreaterThan(108);
    expect(w).toBeLessThan(120);
    expect(d).toBeGreaterThan(88);
    expect(d).toBeLessThan(100);
    const b = map.bounds;
    for (const [x, z] of JUNGLE_OUTLINE) expect(x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z).toBe(true);
  });

  it('clips everything outside the traced outline and leaves the open ground inside it walkable', () => {
    let outside = 0;
    for (let i = 0; i < JUNGLE_OUTLINE.length; i++) {
      const [ax, az] = JUNGLE_OUTLINE[i]!;
      const [bx, bz] = JUNGLE_OUTLINE[(i + 1) % JUNGLE_OUTLINE.length]!;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 3) continue;
      // 1.5 m outward from the edge's middle (clockwise on the overhead: outward is (dz, -dx)).
      const x = (ax + bx) / 2 + ((bz - az) / len) * 1.5;
      const z = (az + bz) / 2 - ((bx - ax) / len) * 1.5;
      if (inside(JUNGLE_OUTLINE, x, z)) continue;
      outside++;
      expect(world.free(x, jungleGroundLevel(x, z) + 0.02, z), `outside ${x.toFixed(1)},${z.toFixed(1)}`).toBe(false);
    }
    expect(outside).toBeGreaterThan(40);
    // Open ground in each area (from the overhead).
    for (const [name, a, b] of [['ruins yard', 70, 320], ['north lane', 220, 135], ['base', 330, 110], ['east spawn', 424, 212], ['village', 295, 330], ['river valley', 280, 240], ['spawn hut path', 370, 280]] as const) {
      const p = P(a, b);
      const g = world.groundBelow(p.x, p.z, 1, 3);
      expect(g, name).not.toBeNull();
      expect(world.free(p.x, g! + 0.02, p.z), name).toBe(true);
    }
  });

  it('puts the landmarks where the overhead has them', () => {
    // The central cliff (C3) is the highest thing on the map; the Lookout (C4) is flat-topped at 6 m.
    expect(top(250, 292)!).toBeGreaterThan(10);
    expect(top(355, 228)!).toBeCloseTo(L.lookout, 2);
    expect(top(375, 240)!).toBeCloseTo(L.lookout, 2);
    // The rock outcrops (the overhead's holes) are solid and too tall to jump onto.
    for (const r of JUNGLE_PLAN.rocks) {
      const cx = r.poly.reduce((s, p) => s + p[0], 0) / r.poly.length;
      const cz = r.poly.reduce((s, p) => s + p[1], 0) / r.poly.length;
      expect(top(cx, cz)!, r.name).toBeGreaterThan(2.3);
    }
    // The creek runs west to east: bed at the centreline from the waterfall pool to the east edge.
    for (const [a, b] of JUNGLE_PLAN.creek.slice(0, -1)) expect(top(a, b, 0.5), `creek ${a},${b}`).toBeLessThan(-0.3);
    // The Bridge: the stilt house floor, the walkway and the deck at 3.6 m over the creek, the red hut at 2.2.
    const [d0, d1] = JUNGLE_PLAN.bridge.deck;
    const mid = [(d0![0] + d1![0]) / 2, (d0![1] + d1![1]) / 2] as const;
    expect(top(mid[0], mid[1])!).toBeCloseTo(L.bridge, 2);
    expect(world.groundBelow(px(mid[0]), pz(mid[1]), L.bridge - 0.5, 10)!).toBeLessThan(0);
    const H = JUNGLE_PLAN.bridge.house;
    const house = frame(H.o[0], H.o[1], H.th)(3.5, 0, 2);
    expect(world.groundBelow(house.x, house.z, L.bridge + 0.5, 2)!).toBeCloseTo(L.bridge, 2);
    const R = JUNGLE_PLAN.redHut;
    const red = frame(R.o[0], R.o[1], R.th)(2.9, 0, 3.5);
    expect(world.groundBelow(red.x, red.z, L.redHut + 0.5, 2)!).toBeCloseTo(L.redHut, 2);
    // The Ruins platform, the Base compound's sandbags stop bullets.
    expect(top(108, 345, 2)!).toBeCloseTo(L.temple, 2);
    expect(world.raycast(P(352, 118, 0.8), v(0, 0, -1), 6, 'bullets')).not.toBeNull();
    // Areas in their quarters: Ruins west, east spawn east, Village south, Base north-east, Lookout east of centre.
    const mean = (l: { x: number; z: number }[]) => ({ x: l.reduce((s, p) => s + p.x, 0) / l.length, z: l.reduce((s, p) => s + p.z, 0) / l.length });
    expect(mean(map.spawns.teams[0]).x).toBeLessThan(-35);
    expect(mean(map.spawns.teams[1]).x).toBeGreaterThan(38);
    expect(px(355)).toBeGreaterThan(20);
    expect(pz(118)).toBeLessThan(-25);
  });
});

describe('jungle: spawns and objectives', () => {
  it('spawns: enough for 6v6 and FFA, on the ground, free, well inside the bounds', () => {
    expect(map.spawns.teams[0].length).toBeGreaterThanOrEqual(8);
    expect(map.spawns.teams[1].length).toBeGreaterThanOrEqual(8);
    expect(map.spawns.ffa.length).toBeGreaterThanOrEqual(16);
    expect(map.modeSpawns?.sd?.attackers?.length).toBeGreaterThanOrEqual(6);
    expect(map.modeSpawns?.sd?.defenders?.length).toBeGreaterThanOrEqual(6);
    for (const s of allSpawns(map)) {
      const g = world.groundBelow(s.x, s.z, s.y + 0.2, 0.4);
      expect(g, `ground under ${JSON.stringify(s)}`).not.toBeNull();
      expect(Math.abs(g! - s.y), `height ${JSON.stringify(s)}`).toBeLessThan(0.05);
      expect(world.free(s.x, g! + 0.01, s.z), `free at ${JSON.stringify(s)}`).toBe(true);
      expect(inside(JUNGLE_OUTLINE, s.x, s.z), `in the outline ${JSON.stringify(s)}`).toBe(true);
    }
  });

  it('team spawns: Ruins (west) against the foxholes (east), spread out, ~90 m apart', () => {
    const [a, b] = map.spawns.teams;
    for (const set of [a, b]) for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) expect(Math.hypot(set[i]!.x - set[j]!.x, set[i]!.z - set[j]!.z)).toBeGreaterThan(1.5);
    for (const p of a) for (const q of b) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(70);
  });

  it('objectives: dom A (Ruins) / B (under the Bridge) / C (Base), sd A (Village) / B (Base), hq rotation; all on the ground', () => {
    expect(map.objectives.dom!.map((o) => o.id)).toEqual(['A', 'B', 'C']);
    expect(map.objectives.sd!.map((o) => o.id)).toEqual(['A', 'B']);
    expect(map.objectives.hq!.length).toBeGreaterThanOrEqual(6);
    for (const list of Object.values(map.objectives))
      for (const o of list) {
        const g = world.groundBelow(o.x, o.z, o.y + 0.2, 0.4);
        expect(g, `${o.id} ground`).not.toBeNull();
        expect(Math.abs(g! - o.y), o.id).toBeLessThan(0.05);
      }
    const d = (o: { x: number; z: number }, set: SpawnPoint[]) => Math.min(...set.map((s) => Math.hypot(s.x - o.x, s.z - o.z)));
    const [A, B, C] = map.objectives.dom!;
    expect(d(A!, map.spawns.teams[0])).toBeLessThan(d(A!, map.spawns.teams[1]));
    expect(d(C!, map.spawns.teams[1])).toBeLessThan(d(C!, map.spawns.teams[0]));
    const b0 = d(B!, map.spawns.teams[0]);
    const b1 = d(B!, map.spawns.teams[1]);
    expect(Math.abs(b0 - b1) / Math.max(b0, b1)).toBeLessThan(0.2);
    for (const site of map.objectives.sd!) for (const s of map.modeSpawns!.sd!.attackers!) expect(Math.hypot(site.x - s.x, site.z - s.z)).toBeGreaterThan(40);
    // S&D: A in the Village (south), B at the Base (north-east), both nearer the defenders.
    const [sa, sb] = map.objectives.sd!;
    expect(sa!.z).toBeGreaterThan(20);
    expect(sb!.z).toBeLessThan(-20);
    for (const site of [sa!, sb!]) expect(d(site, map.modeSpawns!.sd!.defenders!)).toBeLessThan(d(site, map.modeSpawns!.sd!.attackers!));
  });
});

describe('jungle: reachability and bounds', () => {
  it('every spawn, objective and roam point is reachable on foot, the Bridge and the Lookout included', () => {
    const r = reach();
    for (const s of allSpawns(map)) expect(r.near(s, 0.9), `spawn ${JSON.stringify(s)}`).toBe(true);
    for (const [kind, list] of Object.entries(map.objectives)) for (const o of list) expect(r.near(o, o.radius), `${kind} ${o.id}`).toBe(true);
    for (const h of map.hotspots ?? []) expect(r.near(h, 1.5), `hotspot ${JSON.stringify(h)}`).toBe(true);
    expect(r.nodes.filter((n) => Math.abs(n.y - L.bridge) < 0.3).length).toBeGreaterThan(20);
    expect(r.nodes.filter((n) => Math.abs(n.y - L.lookout) < 0.3).length).toBeGreaterThan(40);
    expect(r.nodes.filter((n) => n.y < -1).length).toBeGreaterThan(40);
  }, 180_000); // the first walk flood (it mantles too) runs here

  it('bounds are closed: nothing reachable outside, and sprinting and jumping outwards stops at the clip', () => {
    const r = reach();
    const b = map.bounds;
    for (const n of r.nodes) {
      expect(inside(JUNGLE_OUTLINE, n.x, n.z) || Math.hypot(n.x, n.z) < 0, `node ${JSON.stringify(n)}`).toBe(true);
      expect(n.y).toBeGreaterThan(MOVE.killY);
    }
    for (const start of [map.spawns.teams[0][0]!, map.spawns.teams[1][0]!, map.spawns.ffa[8]!, map.spawns.ffa[17]!]) {
      for (let i = 0; i < 16; i++) {
        const yaw = (i / 16) * Math.PI * 2;
        const s = { ...createMoveState(start.x, start.y, start.z), onGround: true };
        for (let t = 0; t < 25 * 60; t++) stepMove(world, s, Buttons.FORWARD | Buttons.SPRINT | (t % 40 === 0 ? Buttons.JUMP : 0), yaw, 1 / 60);
        expect(s.x > b.min.x && s.x < b.max.x && s.z > b.min.z && s.z < b.max.z, `ran out at ${s.x.toFixed(1)},${s.z.toFixed(1)}`).toBe(true);
        expect(inside(JUNGLE_OUTLINE, s.x, s.z), `left the outline at ${s.x.toFixed(1)},${s.z.toFixed(1)}`).toBe(true);
        expect(s.y).toBeGreaterThan(b.min.y);
      }
    }
  });

  it('the bots NavGrid paths from both team spawns to every objective', () => {
    const nav = new NavGrid(map);
    for (const from of [map.spawns.teams[0][0]!, map.spawns.teams[1][0]!])
      for (const [kind, list] of Object.entries(map.objectives))
        for (const o of list) {
          const path = nav.path(from, v(o.x, o.y, o.z));
          expect(path, `${kind} ${o.id} from ${from.x},${from.z}`).not.toBeNull();
          const end = path!.at(-1)!;
          expect(Math.hypot(end.x - o.x, end.z - o.z), `${kind} ${o.id}`).toBeLessThan(o.radius + 0.6);
        }
  });
});

describe('jungle: walks', () => {
  it('the River: Ruins spawn, into the creek by the waterfall pool, east under the Bridge and past the Lookout to the foxholes', () => {
    const route = [P(80, 275), P(92, 255), ...JUNGLE_PLAN.creek.slice(2, -2).map(([a, b]) => P(a, b, jungleGroundLevel(px(a), pz(b)))), P(430, 236)];
    const r = walkRoute(world, map.spawns.teams[0][3]!, route.map((p) => ({ ...p, y: Math.max(p.y, L.bed) })).map((p, i, all) => (i === all.length - 1 ? { ...p, y: 0 } : p)), true);
    expect(r.state.y).toBeCloseTo(0, 1);
    // ~100 m of river sprinted in well under 25 s.
    expect(r.seconds).toBeLessThan(25);
  });

  it('the Bridge: up the stilt house stairs, through the house, over the deck, down the cliff path to the red hut and its stairs', () => {
    const H = JUNGLE_PLAN.bridge.house;
    const F = frame(H.o[0], H.o[1], H.th);
    const B = L.bridge;
    const up = walkRoute(world, F(1.1, 0, 12.4), [F(1.1, 0, 11.6), F(1.1, B, H.d + 0.5), F(1.1, B, 2.0), F(6.4, B, 2.0), F(7.8, B, 2.0)]);
    expect(up.state.y).toBeCloseTo(B, 1);
    const [w0, w1] = JUNGLE_PLAN.bridge.walk;
    const [d0, d1] = JUNGLE_PLAN.bridge.deck;
    const [, p1, p2] = JUNGLE_PLAN.bridge.path;
    const over = walkRoute(world, up.state, [P(w0![0], w0![1], B), P(w1![0], w1![1], B), P(d0![0], d0![1], B), P(d1![0], d1![1], B), P(p1![0], p1![1], (B + L.redHut) / 2 + 0.3), P(p2![0], p2![1], L.redHut)]);
    expect(Math.abs(over.state.y - L.redHut)).toBeLessThan(0.15);
    const R = JUNGLE_PLAN.redHut;
    const RF = frame(R.o[0], R.o[1], R.th);
    const down = walkRoute(world, over.state, [RF(-0.8, L.redHut, 3.0), RF(-0.8, L.redHut, R.d - 0.3), RF(-0.8, 0, R.d + 5.6), RF(-0.8, 0, R.d + 7.5)]);
    expect(down.state.y).toBeCloseTo(0, 1);
    // ... and into the hut through its west door.
    const into = walkRoute(world, RF(-0.8, L.redHut, 5.4), [RF(1.4, L.redHut, 5.4), RF(2.8, L.redHut, 3.5)]);
    expect(into.state.y).toBeCloseTo(L.redHut, 1);
  });

  it('the Lookout: the one ledge path up its north-west face to the flat top', () => {
    const route = JUNGLE_PLAN.ledge.map(([a, b, h]) => P(a, b, h));
    const r = walkRoute(world, P(300, 256), [...route, P(358, 215, L.lookout), P(375, 240, L.lookout)]);
    expect(r.state.y).toBeCloseTo(L.lookout, 1);
    // Every other face is a sheer drop: walking off the east side lands on the ground 6 m below.
    const off = walkRoute(world, r.state, [P(425, 232, 0)]);
    expect(off.state.y).toBeLessThan(0.1);
  });

  it('the Ruins: up the temple stairs under the arch onto the platform, and into the roofless ruin by the creek', () => {
    const r = walkRoute(world, P(123, 300), [P(123, 312), P(123, 322, L.temple), P(135, 326, L.temple)]);
    expect(r.state.y).toBeCloseTo(L.temple, 1);
    const ruin = walkRoute(world, P(124, 282), [P(118, 281), P(111, 279)]);
    expect(ruin.state.y).toBeCloseTo(0, 1);
  });

  it('the Village: through the longhouse doors end to end', () => {
    const F = frame(225, 333, 27 * (Math.PI / 180));
    const r = walkRoute(world, F(2.0, 0, -1.2), [F(2.0, 0.4, 1.2), F(4.0, 0.4, 4.0), F(4.0, 0.4, 8.6), F(2.4, 0.4, 9.2), F(2.4, 0, 10.8)]);
    expect(r.state.y).toBeLessThan(0.5);
  });
});

describe('jungle: sightlines', () => {
  it('the Lookout watches the east spawn and the River below it; the Bridge looks down into the valley', () => {
    expect(world.lineOfSight(P(385, 236, L.lookout + eye), P(440, 245, eye))).toBe(true);
    expect(world.lineOfSight(P(386, 240, L.lookout + eye), P(413, 244, L.bed + eye))).toBe(true);
    const [d0, d1] = JUNGLE_PLAN.bridge.deck;
    expect(world.lineOfSight(P((d0![0] + d1![0]) / 2, (d0![1] + d1![1]) / 2, L.bridge + eye), P(278, 252, L.bed + eye))).toBe(true);
  });

  it('the Ruins platform looks down the stairs to the creek; the central cliff splits the north lane from the Village; spawn to spawn is blocked', () => {
    expect(world.lineOfSight(P(123, 325, L.temple + eye), P(123, 263, L.bed + eye))).toBe(true);
    expect(world.lineOfSight(P(246, 145, eye), P(245, 360, eye))).toBe(false);
    expect(world.lineOfSight(P(75, 320, eye), P(430, 240, eye))).toBe(false);
  });

  it('foliage never stops bullets or sight (cut-out cards and canopies only), rock does', () => {
    for (const b of map.brushes) if (['bush', 'fern', 'foliage', 'foliageDark', 'net', 'frondTop', 'frondSide'].includes(b.mat)) expect(b.collide, b.mat).toBe(false);
    expect(world.raycast(P(150, 232, 1.2), v(0, 0, 1), 12, 'bullets')).not.toBeNull();
  });
});

describe('jungle: every mode builds on the map', () => {
  let store: Store;
  let lobby: Lobby;
  beforeAll(() => {
    registerModeRules();
    store = new Store(':memory:');
    lobby = new Lobby({ store, features: [modesFeature], log: () => {}, autoTick: false });
  });
  afterAll(() => {
    lobby.shutdown();
    store.close();
  });

  for (const mode of MAP_BY_ID.get('jungle')!.modes) {
    it(`${mode}: a room on Jungle starts, spawns bots on the map and runs`, () => {
      const room = lobby.createRoom({ mode, map: 'jungle', closeWhenEmpty: false, persist: false, countdownSec: 0 });
      const a = room.mode.teams ? room.addBot({ team: 0 }) : room.addBot();
      const b = room.mode.teams ? room.addBot({ team: 1 }) : room.addBot();
      for (let i = 0; i < Math.round(2 / TICK_DT); i++) room.step();
      for (const p of [a, b]) {
        if (!p.alive) continue;
        expect(inside(JUNGLE_OUTLINE, p.move.x, p.move.z), `${mode} ${p.name} at ${p.move.x},${p.move.z}`).toBe(true);
      }
      if (mode === 'dom') expect((controllerOf(room) as DomRules).flags).toHaveLength(3);
      if (mode === 'sd') expect((controllerOf(room) as SdRules).sites.map((s) => s.id)).toEqual(['A', 'B']);
      room.close();
    });
  }
});
