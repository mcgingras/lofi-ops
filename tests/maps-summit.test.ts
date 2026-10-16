/**
 * Summit (Black Ops 1): layout checks against docs/maps/summit-reference.md (the BO1 overhead at
 * 4.5 px per metre), spawns and objectives on solid ground, reachability through the real movement
 * code (flood fill), closed bounds (or a fall to the death off the cliffs), scripted walks and the
 * map's signature jumps (Tower, Gondola), every mode building a room on it, and landmark sightlines.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import modesFeature, { registerModeRules } from '../src/server/features/modes/index';
import { NavGrid } from '../src/server/features/bots/nav';
import { Lobby } from '../src/server/lobby';
import { Store } from '../src/server/store';
import { MOVE, PLAYER, TICK_DT } from '../src/shared/constants';
import { getMapData, MAP_BY_ID } from '../src/shared/defs/maps';
import { MODES } from '../src/shared/defs/modes';
import { Buttons } from '../src/shared/input';
import type { Vec3 } from '../src/shared/math';
import { createMoveState, stepMove, type MoveState } from '../src/shared/movement';
import { SUMMIT_BOUNDS, SUMMIT_LEVELS, SUMMIT_OUTLINE, SUMMIT_TOWER } from '../src/shared/maps/summit';
import { buildCollisionWorld, type SpawnPoint } from '../src/shared/maps/types';
import { floodFill, walkRoute, type Reach } from './maps-bo-nav';

const map = getMapData('summit');
const world = buildCollisionWorld(map);
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const eye = PLAYER.eye;
const DT = 1 / 60;
const allSpawns = (): SpawnPoint[] => [...map.spawns.teams[0], ...map.spawns.teams[1], ...map.spawns.ffa, ...Object.values(map.modeSpawns ?? {}).flatMap((s) => Object.values(s).flat())];
let reachCache: Reach | null = null;
const reach = () => (reachCache ??= floodFill(world, [map.spawns.teams[0][0]!]));
const yawTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));

/** Run towards (tx, tz) with `buttons`, jumping once when `jumpAt(s)` first holds; stop after `secs` or once landed past the jump. */
function runJump(s: MoveState, tx: number, tz: number, jumpAt: (s: MoveState) => boolean, secs = 3): MoveState {
  let jumped = false;
  for (let t = 0; t < secs * 60; t++) {
    const j = !jumped && s.onGround && jumpAt(s);
    if (j) jumped = true;
    stepMove(world, s, Buttons.FORWARD | Buttons.SPRINT | (j ? Buttons.JUMP : 0), yawTo(s.x, s.z, tx, tz), DT);
    if (jumped && s.onGround && t > 10 && Math.hypot(tx - s.x, tz - s.z) < 0.6) break;
  }
  for (let t = 0; t < 60 && !s.onGround; t++) stepMove(world, s, 0, 0, DT);
  return s;
}

describe('summit registry', () => {
  it('is registered as a medium Black Ops map for every mode', () => {
    const def = MAP_BY_ID.get('summit')!;
    expect(def.inspiredBy).toMatch(/Black Ops/);
    expect(def.inspiredBy).toMatch(/Summit/);
    expect(def.size).toBe('medium');
    // Zombies is only on maps with a Zombies layer (src/shared/maps/zombies/).
    for (const m of MODES) if (m.id !== 'zombies') expect(def.modes).toContain(m.id);
    expect(map.times.map((t) => t.id)).toEqual(['day', 'dusk']);
  });
});

describe('summit layout (reference: BO1 overhead, 4.5 px per metre)', () => {
  const floorAt = (x: number, z: number, fromY = 30) => world.groundBelow(x, z, fromY, 40);

  it('is the long, narrow ridge: ~97 m north-south, ~46 m at its widest', () => {
    const xs = SUMMIT_OUTLINE.map((p) => p[0]);
    const zs = SUMMIT_OUTLINE.map((p) => p[1]);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(92);
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(102);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(42);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(50);
    // Narrow at both ends (the Barracks tip and the South Yard tail), widest across the Control building.
    const width = (z: number) => {
      const hits: number[] = [];
      for (let i = 0; i < SUMMIT_OUTLINE.length; i++) {
        const [ax, az] = SUMMIT_OUTLINE[i]!;
        const [bx, bz] = SUMMIT_OUTLINE[(i + 1) % SUMMIT_OUTLINE.length]!;
        if ((az - z) * (bz - z) < 0) hits.push(ax + ((bx - ax) * (z - az)) / (bz - az));
      }
      return Math.max(...hits) - Math.min(...hits);
    };
    expect(width(-46)).toBeLessThan(20);
    expect(width(42)).toBeLessThan(19);
    expect(width(0)).toBeGreaterThan(44);
  });

  it('has the landmark buildings where the overhead puts them (roofed, at their heights)', () => {
    const roofs: [string, number, number, number, number][] = [
      ['Control Room', -3, -6, 7.9, 8.4],
      ['Gallery', -14.7, 6, 3.5, 3.7],
      ['east block', 10.5, 6, 4.3, 4.6],
      ['Barracks (west)', -4, -44, 6.6, 6.9],
      ['Cable Car station', -5, -28, 5.1, 5.4],
      ['Comms radio room', 8, -28, 6.1, 6.4],
      ['Garage', -11, 20, 4.1, 4.4],
      ['Lab', 10.6, 22, 4.1, 4.4],
      ['Radar', -5, 31, 4.3, 4.6],
    ];
    for (const [name, x, z, lo, hi] of roofs) {
      const y = floorAt(x, z)!;
      expect(y, name).toBeGreaterThan(lo);
      expect(y, name).toBeLessThan(hi);
    }
    // The Fuel Tank in the north-east corner, ringed by walkable ground.
    expect(world.lineOfSight(v(14, 2, -45.5), v(14, 2, -34.5))).toBe(false);
    for (const [x, z] of [[14, -44.6], [18.5, -40], [10.5, -42]] as const) expect(floorAt(x, z, 1)).toBeCloseTo(0, 2);
  });

  it('drops away where the real map does: the chasm under the Bridge and Tower, the void beside the Catwalk', () => {
    expect(floorAt(-18.5, -9.5, 3)).toBeNull();
    expect(floorAt(-18.4, -14.5, 3)).toBeCloseTo(SUMMIT_LEVELS.deck, 2); // the Bridge deck
    expect(floorAt(-16.0, -14.5, 3)).toBeNull(); // beside it
    expect(floorAt(20, 0, 3)).toBeNull();
    expect(floorAt(16.6, 0, 3)).toBeCloseTo(SUMMIT_LEVELS.deck, 2);
    // The Tower stands over the chasm; the Ledge is solid ground.
    expect(floorAt((SUMMIT_TOWER.x0 + SUMMIT_TOWER.x1) / 2, (SUMMIT_TOWER.z0 + SUMMIT_TOWER.z1) / 2)).toBeCloseTo(SUMMIT_LEVELS.tower, 2);
    expect(floorAt(-19, 0, 3)).toBeCloseTo(0, 2);
  });

  it('puts the teams at the two ends and the objectives where BO1/BO7 have them', () => {
    const mean = (l: { x: number; z: number }[]) => ({ x: l.reduce((s, p) => s + p.x, 0) / l.length, z: l.reduce((s, p) => s + p.z, 0) / l.length });
    expect(mean(map.spawns.teams[0]).z).toBeLessThan(-30);
    expect(mean(map.spawns.teams[1]).z).toBeGreaterThan(35);
    const dom = Object.fromEntries(map.objectives.dom!.map((o) => [o.id, o]));
    // A in the Alley between the Cable Car station and Comms; B at the control room consoles; C on the Catwalk.
    expect(dom.A!.x).toBeGreaterThan(-1);
    expect(dom.A!.x).toBeLessThan(2);
    expect(dom.A!.z).toBeLessThan(-13);
    expect(dom.A!.z).toBeGreaterThan(-30);
    expect(Math.abs(dom.B!.x) + Math.abs(dom.B!.z)).toBeLessThan(3);
    expect(world.lineOfSight(v(dom.B!.x, 1.6, dom.B!.z), v(dom.B!.x, 1.6, -35))).toBe(false); // inside the Control building
    expect(dom.C!.x).toBeGreaterThan(14);
    // S&D sites in the southern buildings, the attackers at the north end.
    const sd = Object.fromEntries(map.objectives.sd!.map((o) => [o.id, o]));
    expect(sd.A!.x).toBeLessThan(-7);
    expect(sd.B!.x).toBeGreaterThan(6);
    for (const s of map.modeSpawns!.sd!.attackers!) expect(s.z).toBeLessThan(-30);
    for (const s of map.modeSpawns!.sd!.defenders!) expect(s.z).toBeGreaterThan(24);
  });
});

describe('summit spawns and objectives', () => {
  it('has enough spawns, each standing free on solid ground well inside the bounds and the outline', () => {
    expect(map.spawns.teams[0].length).toBeGreaterThanOrEqual(8);
    expect(map.spawns.teams[1].length).toBeGreaterThanOrEqual(8);
    expect(map.spawns.ffa.length).toBeGreaterThanOrEqual(16);
    expect(map.modeSpawns!.sd!.defenders!.length).toBeGreaterThanOrEqual(6);
    const b = map.bounds;
    for (const s of allSpawns()) {
      const g = world.groundBelow(s.x, s.z, s.y + 0.2, 0.4);
      expect(g, `ground under ${JSON.stringify(s)}`).not.toBeNull();
      expect(Math.abs(g! - s.y)).toBeLessThan(0.05);
      expect(world.free(s.x, g! + 0.01, s.z), `free at ${JSON.stringify(s)}`).toBe(true);
      expect(s.x - b.min.x > 1 && b.max.x - s.x > 1 && s.z - b.min.z > 1 && b.max.z - s.z > 1).toBe(true);
    }
    for (const set of map.spawns.teams) for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) expect(Math.hypot(set[i]!.x - set[j]!.x, set[i]!.z - set[j]!.z)).toBeGreaterThan(1.5);
    for (const p of map.spawns.teams[0]) for (const q of map.spawns.teams[1]) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(60);
  });

  it('objectives: dom A/B/C, sd A/B, hq points, all on free ground; Domination balanced between the spawns', () => {
    expect(map.objectives.dom!.map((o) => o.id)).toEqual(['A', 'B', 'C']);
    expect(map.objectives.sd!.map((o) => o.id)).toEqual(['A', 'B']);
    expect(map.objectives.hq!.length).toBeGreaterThanOrEqual(6);
    for (const list of Object.values(map.objectives))
      for (const o of list) {
        const g = world.groundBelow(o.x, o.z, o.y + 0.2, 0.4);
        expect(g, `${o.id} ground`).not.toBeNull();
        expect(Math.abs(g! - o.y)).toBeLessThan(0.05);
        expect(world.free(o.x, o.y + 0.05, o.z, PLAYER.radius), `${o.id} free`).toBe(true);
      }
    for (const site of map.objectives.sd!) for (const s of map.modeSpawns!.sd!.attackers!) expect(Math.hypot(site.x - s.x, site.z - s.z)).toBeGreaterThan(25);
    const d = (o: { x: number; z: number }, set: SpawnPoint[]) => Math.min(...set.map((s) => Math.hypot(s.x - o.x, s.z - o.z)));
    const [A, B, C] = map.objectives.dom!;
    expect(d(A!, map.spawns.teams[0])).toBeLessThan(d(A!, map.spawns.teams[1]));
    expect(d(C!, map.spawns.teams[1])).toBeLessThan(d(C!, map.spawns.teams[0]));
    const b0 = d(B!, map.spawns.teams[0]);
    const b1 = d(B!, map.spawns.teams[1]);
    expect(Math.abs(b0 - b1) / Math.max(b0, b1)).toBeLessThan(0.2);
  });
});

describe('summit reachability and bounds', () => {
  it('everything is reachable on foot from a team 0 spawn: spawns, objectives, hotspots off the Tower; the upper levels too', () => {
    const r = reach();
    for (const s of allSpawns()) expect(r.near(s, 0.9), `spawn ${JSON.stringify(s)}`).toBe(true);
    for (const [kind, list] of Object.entries(map.objectives)) for (const o of list) expect(r.near(o, o.radius), `${kind} ${o.id}`).toBe(true);
    for (const h of map.hotspots ?? []) if (h.y < SUMMIT_LEVELS.tower - 0.1) expect(r.near(h, 1.5), `hotspot ${JSON.stringify(h)}`).toBe(true);
    // Mezzanine, walkway and Gallery roof are in the walkable set.
    expect(r.nodes.filter((n) => n.y > SUMMIT_LEVELS.walkway - 0.1).length).toBeGreaterThan(60);
    // The Tower is not reachable on foot (only by the jump from the Gallery roof).
    const tw = SUMMIT_TOWER;
    expect(r.nodes.some((n) => n.x > tw.x0 && n.x < tw.x1 && n.z > tw.z0 && n.z < tw.z1 && n.y > 4)).toBe(false);
  }, 180_000); // the first walk flood (it mantles too) runs here

  it('no reachable spot is outside the bounds or the outline', () => {
    const b = map.bounds;
    for (const n of reach().nodes) {
      expect(n.x > b.min.x && n.x < b.max.x && n.z > b.min.z && n.z < b.max.z, `node ${JSON.stringify(n)}`).toBe(true);
      expect(n.y).toBeGreaterThan(MOVE.killY);
    }
  });

  it('sprinting and jumping out from the spawns never leaves the play space: the edge clip stops you, or the cliff kills you', () => {
    const b = SUMMIT_BOUNDS;
    const starts = [map.spawns.teams[0][0]!, map.spawns.teams[0][5]!, map.spawns.teams[1][0]!, map.spawns.teams[1][7]!, ...map.spawns.ffa.filter((_, i) => i % 3 === 0)];
    for (const start of starts) {
      for (let i = 0; i < 16; i++) {
        const yaw = (i / 16) * Math.PI * 2;
        const s = { ...createMoveState(start.x, start.y, start.z), onGround: true };
        let dead = false;
        for (let t = 0; t < 20 * 60 && !dead; t++) {
          stepMove(world, s, Buttons.FORWARD | Buttons.SPRINT | (t % 40 === 0 ? Buttons.JUMP : 0), yaw, DT);
          if (s.y < b.min.y) dead = true; // fell off the mountain: killed (the room kills below bounds.min.y)
          else expect(s.x > b.min.x && s.x < b.max.x && s.z > b.min.z && s.z < b.max.z, `ran out at ${s.x.toFixed(1)},${s.y.toFixed(1)},${s.z.toFixed(1)}`).toBe(true);
        }
      }
    }
  });
});

describe('summit walks', () => {
  it('north spawn -> Alley (A) -> into Control -> the consoles (B) -> out the south doors -> Courtyard -> South Yard spawn', () => {
    const r = walkRoute(world, map.spawns.teams[0][2]!, [
      v(-0.2, 0, -31), v(-0.2, 0, -26.8), v(0.3, 0, -19.6), v(0.3, 0, -12), v(4, 0, -11.2), v(4, 0, -7.8), v(-1.6, 0, -7.8), v(-1.6, 0, -4.2), v(-3.6, 0, -4.2), v(-3.6, 0, -1.0), v(0, 0, -1.0),
      v(-5.4, 0, -1.2), v(-5.4, 0, 6.5), v(-6, 0, 8.6), v(-6, 0, 10.8), v(-1.4, 0, 12.4), v(-3, 0, 19.6), v(0.8, 0, 21.6), v(5.6, 0, 26.8), v(5.8, 0, 31),
      v(5.2, 0, 35.6), v(6.6, 0, 37.6),
    ]);
    expect(r.state.y).toBeCloseTo(0, 1);
    expect(r.seconds).toBeLessThan(22);
  });

  it('the west side: plaza -> west passage -> over the Bridge -> the Cliffside path -> the Ledge -> through the Gallery -> the Garage', () => {
    const r = walkRoute(world, v(-10.4, 0, -37.6), [
      v(-10.4, 0, -35.2), v(-13.6, 0, -30), v(-13.6, 0, -21.5), v(-16.2, 0, -18.6), v(-21.4, SUMMIT_LEVELS.deck, -10.6), v(-23.2, 0, -5), v(-22.8, 0, 0), v(-19, 0, 0), v(-16.9, 0, 0),
      v(-14.7, 0, 0), v(-14.7, 0, 8.8), v(-14.6, 0, 10.6), v(-11, 0, 11.4), v(-11, 0, 13.4), v(-11, 0, 18.8),
    ]);
    expect(r.state.y).toBeCloseTo(0, 1);
  });

  it('the Cliffside path runs on round the Ledge to the passage south of Control', () => {
    const r = walkRoute(world, v(-22.8, 0, 0), [v(-23.2, 0, 4.4), v(-21.6, 0, 8.2), v(-18.4, 0, 11.2), v(-15.2, 0, 11.2)]);
    expect(r.state.y).toBeCloseTo(0, 1);
  });

  it('the east side: north yard -> along the Catwalk (C) -> the passage -> the Lab (B site)', () => {
    const r = walkRoute(world, v(14.4, 0, -12), [v(15.2, SUMMIT_LEVELS.deck, -9), v(17.4, SUMMIT_LEVELS.deck, -8), v(17.4, SUMMIT_LEVELS.deck, 4.0), v(15.6, SUMMIT_LEVELS.deck, 8.6), v(14.8, 0, 12), v(12, 0, 17), v(9, 0, 17.6), v(9, 0, 19.4), v(10.6, 0, 21.4)]);
    expect(r.state.y).toBeCloseTo(0, 1);
  });

  it('through the Control building east to west: Catwalk door -> east block -> control room -> Gallery', () => {
    const r = walkRoute(world, v(15.6, SUMMIT_LEVELS.deck, -5), [v(12.6, 0, -5), v(10.5, 0, -2), v(10.5, 0, 1.6), v(8.4, 0, 1), v(4.6, 0, 1), v(4.6, 0, -4.5), v(-11.6, 0, -4.5), v(-11.6, 0, 0), v(-14.7, 0, 0)]);
    expect(r.state.x).toBeLessThan(-14);
  });

  it('control room stairs -> mezzanine -> walkway -> out of the west window onto the Gallery roof -> the jump onto the Tower', () => {
    const W = SUMMIT_LEVELS.walkway;
    const up = walkRoute(world, v(6.6, 0, -4.4), [v(6.4, 0, -5.8), v(-0.5, W, -5.8), v(-0.5, W, -7.8), v(-12.0, W, -7.8), v(-14.6, W, -7.8), v(-15.9, W, -8.6)]);
    expect(up.state.y).toBeCloseTo(W, 1);
    const tw = SUMMIT_TOWER;
    const s = runJump(up.state, tw.x0 + 0.8, -9.2, (p) => p.x < -15.95);
    expect(s.y).toBeCloseTo(SUMMIT_LEVELS.tower, 1);
    expect(s.x).toBeLessThan(tw.x1);
    expect(s.x).toBeGreaterThan(tw.x0);
    // And back down onto the Gallery roof.
    const back = runJump(s, -15.2, -8.6, (p) => p.x > -17.4);
    expect(back.y).toBeCloseTo(W, 1);
  });

  it('the walkway stairs (rising north) reach the west walkway', () => {
    const W = SUMMIT_LEVELS.walkway;
    const r = walkRoute(world, v(-8.6, 0, 8.4), [v(-10.15, 0, 8.4), v(-10.15, W, 1.0), v(-11.8, W, 1.0), v(-11.8, W, 8)]);
    expect(r.state.y).toBeCloseTo(W, 1);
  });

  it('the ramp at the north end of the Bridge jumps you into the Gondola', () => {
    const s = { ...createMoveState(-16.6, 0, -18.95), onGround: true };
    const g = runJump(s, -23.1, -21.3, (p) => p.x < -18.05, 3);
    expect(g.y).toBeCloseTo(SUMMIT_LEVELS.gondola, 1);
    expect(g.x).toBeLessThan(-21.6);
    expect(g.z).toBeLessThan(-20.1);
    // Jump too early off the ramp and the cliff takes you.
    const early = runJump({ ...createMoveState(-16.6, 0, -18.95), onGround: true }, -23.1, -21.3, (p) => p.x < -17.6, 2);
    expect(early.y).toBeLessThan(SUMMIT_BOUNDS.min.y);
  });
});

describe('summit modes', () => {
  let store: Store | undefined;
  let lobby: Lobby | undefined;
  beforeAll(() => registerModeRules());
  afterEach(() => {
    lobby?.shutdown();
    store?.close();
    lobby = undefined;
    store = undefined;
  });

  it('every registered mode builds a room on Summit and runs', () => {
    for (const m of MODES) {
      store = new Store(':memory:');
      lobby = new Lobby({ store, features: [modesFeature], log: () => {}, autoTick: false });
      const room = lobby.createRoom({ mode: m.id, map: 'summit', closeWhenEmpty: false, countdownSec: 0 });
      expect(room.map.id).toBe('summit');
      for (let i = 0; i < Math.round(1 / TICK_DT); i++) room.step();
      lobby.shutdown();
      store.close();
      lobby = undefined;
      store = undefined;
    }
  });
});

describe('summit bot nav', () => {
  it('the bots NavGrid paths from both spawns to every objective and to the mezzanine', () => {
    const nav = new NavGrid(map);
    for (const from of [map.spawns.teams[0][0]!, map.spawns.teams[1][0]!]) {
      for (const [kind, list] of Object.entries(map.objectives))
        for (const o of list) {
          const path = nav.path(from, o);
          expect(path, `${kind} ${o.id}`).not.toBeNull();
          const end = path!.at(-1)!;
          expect(Math.hypot(end.x - o.x, end.z - o.z), `${kind} ${o.id}`).toBeLessThan(o.radius + 0.6);
        }
      const up = nav.path(from, v(-4, SUMMIT_LEVELS.walkway, -8));
      expect(up).not.toBeNull();
      expect(Math.abs(up!.at(-1)!.y - SUMMIT_LEVELS.walkway)).toBeLessThan(0.6);
    }
  });
});

describe('summit sightlines', () => {
  const W = SUMMIT_LEVELS.walkway;
  it('the Tower watches the Bridge, the north yard and the Gondola; the Gallery looks out over the valley', () => {
    const tw = SUMMIT_TOWER;
    const top = v(tw.x0 + 0.4, SUMMIT_LEVELS.tower + eye, (tw.z0 + tw.z1) / 2);
    expect(world.lineOfSight(top, v(-21.4, eye, -11))).toBe(true);
    expect(world.lineOfSight(top, v(-8, eye, -11.5))).toBe(true);
    expect(world.lineOfSight(top, v(-21.6, 1.5, -21.3))).toBe(true);
    // Gallery window over the Ledge to the cliff edge, and down the Gallery end to end.
    expect(world.lineOfSight(v(-14.6, eye, 0), v(-24.6, eye, 0.5))).toBe(true);
    expect(world.lineOfSight(v(-14.7, eye, -9), v(-14.7, eye, 9))).toBe(true);
  });

  it('the Catwalk runs clear end to end; the mezzanine overlooks the consoles; the ridge is broken up by buildings', () => {
    expect(world.lineOfSight(v(17.2, eye, -9.6), v(17.2, eye, 8.8))).toBe(true);
    expect(world.lineOfSight(v(-6, W + eye, -7.4), v(0, eye + 0.2, -0.9))).toBe(true);
    expect(world.lineOfSight(v(-11.9, W + eye, 4), v(2, eye, -1.5))).toBe(true);
    // North plaza to the Courtyard: the Control building blocks; plaza to the South Yard likewise.
    expect(world.lineOfSight(v(0, eye, -35), v(0, eye, 20))).toBe(false);
    expect(world.lineOfSight(v(4, eye, -35), v(6, eye, 40))).toBe(false);
    // B's lane out to the cliff: the control room's west door lines up with the Gallery's.
    expect(world.lineOfSight(v(0, eye, -0.9), v(-24.6, eye, -0.4))).toBe(true);
    // The Alley runs straight from the plaza to the Control building's north face.
    expect(world.lineOfSight(v(-0.2, eye, -31), v(-0.2, eye, -10))).toBe(true);
  });
});
