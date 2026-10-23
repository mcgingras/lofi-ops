/**
 * Nacht der Untoten (World at War / Black Ops Zombies): layout checks against the reference in
 * docs/maps/nacht-reference.md (the CoD Wiki floor plans at 28 px per metre, origin plan px 505,
 * 420), Zombies-only registration, reachability inside the bunker (flood fill through the real
 * movement code), the doors gating each area, the windows keeping everyone in, the stairs, the
 * night preset and textures, no z-fighting left.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getMapData, MAP_BY_ID, MAPS, mapsForMode } from '../src/shared/defs/maps';
import { MODES } from '../src/shared/defs/modes';
import { CollisionWorld } from '../src/shared/collision';
import { planDepth } from '../src/shared/maps/faces';
import { NACHT, NACHT_DOORS, NACHT_WINDOWS } from '../src/shared/maps/nacht';
import { buildCollisionWorld, mapSolids } from '../src/shared/maps/types';
import { zombiesLayer } from '../src/shared/maps/zombies/index';
import type { Vec3 } from '../src/shared/math';
import { floodFill, tryWalk, walkRoute } from './maps-bo-nav';

const ROOT = resolve(import.meta.dirname, '..');
const map = getMapData('nacht');
const layer = zombiesLayer('nacht')!;
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
/** Plan px -> metres (the reference's scale and origin). */
const plan = (px: number, py: number): [number, number] => [(px - 505) / 28, (py - 420) / 28];
const start = map.spawns.teams[0][0]!;

/** A world whose doors are shut except `open` (as a room's world is before anyone buys them). */
function gated(open: string[] = []): CollisionWorld {
  const w = new CollisionWorld(mapSolids(map));
  w.gateOn = (g) => !open.includes(g.replace('door:', ''));
  return w;
}

// Points in each area.
const START = [v(3, 0, 4), v(10, 0, 5), v(-3, 0, 6), v(11, 0, 0.5)];
const HELP = [v(-7.5, 0, -6), v(-7.5, 0, 6), v(-9.5, 0, 0)];
const UP = [v(-7.5, NACHT.F2, -6), v(-7.5, NACHT.F2, 4), v(-2, NACHT.F2, 4), v(4.2, NACHT.F2, 5)];
const OUT = [v(0, 0, 16), v(20, 0, 0), v(-20, 0, -5), v(-11.6, NACHT.F2, -4)];

describe('nacht: registry and look', () => {
  it('is a small Zombies-only map: the Zombies picker lists it, no other mode does', () => {
    const def = MAP_BY_ID.get('nacht')!;
    expect(def.inspiredBy).toMatch(/World at War/);
    expect(def.inspiredBy).toMatch(/Nacht der Untoten/);
    expect(def.size).toBe('small');
    expect(def.modes).toEqual(['zombies']);
    expect(mapsForMode('zombies').map((m) => m.id)).toContain('nacht');
    for (const mode of MODES) if (mode.id !== 'zombies') expect(mapsForMode(mode.id).map((m) => m.id), mode.id).not.toContain('nacht');
    expect(MAPS.filter((m) => m.modes.includes('tdm')).map((m) => m.id)).not.toContain('nacht');
  });

  it('a single cold night: blue moon, fog, firelight and lamps', () => {
    expect(map.times).toHaveLength(1);
    const t = map.times[0]!;
    expect(t.id).toBe('night');
    expect(layer.time).toBe('night');
    // Moonlight is blue, the fog closes in.
    expect(t.sun[2]).toBeGreaterThan(t.sun[0]);
    expect(t.fogFar).toBeLessThan(80);
    const groups = new Set(map.lights.map((l) => l.group));
    expect(groups).toEqual(new Set(['lamp', 'fire']));
    for (const g of groups) expect(t.lights[g]).toBeGreaterThan(0.5);
    const fire = map.lights.filter((l) => l.group === 'fire');
    expect(fire.length).toBeGreaterThanOrEqual(8);
    for (const l of fire) expect(l.color[0]).toBeGreaterThan(l.color[2] * 2);
    expect(layer.fires!.length).toBeGreaterThanOrEqual(8);
  });

  it('every material texture has a client recipe, and every photo it needs is in assets/textures', () => {
    const src = readFileSync(resolve(ROOT, 'src/client/render/recipes/nacht.ts'), 'utf8');
    const ids = new Set<string>();
    for (const f of readdirSync(resolve(ROOT, 'src/client/render/recipes'))) for (const m of readFileSync(resolve(ROOT, 'src/client/render/recipes', f), 'utf8').matchAll(/registerTexture\(\s*'([^']+)'/g)) ids.add(m[1]!);
    for (const m of src.matchAll(/\['(nd_[A-Za-z]+)'/g)) ids.add(m[1]!);
    for (const [name, mat] of Object.entries(map.materials)) if (mat.texture !== 'none') expect(ids.has(mat.texture), `material ${name} -> ${mat.texture}`).toBe(true);
    expect(ids.has(map.times[0]!.sky)).toBe(true);
    for (const p of new Set([...src.matchAll(/fromPhoto\('([^']+)'/g)].map((x) => x[1]!))) expect(existsSync(resolve(ROOT, 'assets/textures', `${p}.jpg`)), p).toBe(true);
  });

  it('no z-fighting left after the depth plan', () => {
    const p = planDepth(map);
    expect(p.unresolved).toEqual([]);
  });
});

describe('nacht: layout against the floor plans', () => {
  it('the wall lines sit where the plan draws them (28 px / m)', () => {
    const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.15);
    near(NACHT.xWest, plan(205, 0)[0]);
    near(NACHT.xMid, plan(370, 0)[0]);
    near(NACHT.xUpEast, plan(647, 0)[0]);
    near(NACHT.xNotch, plan(735, 0)[0]);
    near(NACHT.xEast, plan(850, 0)[0]);
    near(NACHT.zNorth, plan(0, 170)[1]);
    near(NACHT.zStart, plan(0, 393)[1]);
    near(NACHT.zUpSouth, plan(0, 600)[1]);
    near(NACHT.zSouth, plan(0, 665)[1]);
    // Start room about 17 x 10 m, Help room about 6 x 18 m.
    expect(NACHT.xEast - NACHT.xMid).toBeCloseTo(17.1, 0);
    expect(NACHT.zSouth - NACHT.zStart).toBeCloseTo(9.8, 0);
    expect(NACHT.xMid - NACHT.xWest).toBeCloseTo(5.9, 0);
  });

  it('windows: five in the start room, two and the cave in the Help room, four upstairs', () => {
    const zones = layer.barriers!.map((b) => b.zone ?? 'start');
    expect(zones.filter((z) => z === 'start')).toHaveLength(5);
    expect(zones.filter((z) => z === 'help')).toHaveLength(3);
    expect(zones.filter((z) => z === 'upstairs')).toHaveLength(4);
    expect(layer.barriers!.length).toBe(NACHT_WINDOWS.length);
    expect(layer.barriers!.filter((b) => b.y > 1).length).toBe(4);
  });

  it('three doors at 1000: the HELP door, the sofa on the spiral stairs, the tower debris', () => {
    expect(layer.doors!.map((d) => [d.id, d.cost, d.zones])).toEqual([
      ['help', 1000, ['help']],
      ['stairs', 1000, ['upstairs']],
      ['tower', 1000, ['upstairs']],
    ]);
    expect(layer.doors!.find((d) => d.id === 'help')!.label).toBe('HELP');
    for (const d of layer.doors!) {
      const g = map.brushes.filter((b) => b.gate === `door:${d.id}`);
      expect(g, d.id).toHaveLength(1);
      expect(g[0]!.noRender).toBe(true);
      const b = NACHT_DOORS[d.id as keyof typeof NACHT_DOORS];
      expect(Math.hypot(d.x - b.x, d.z - b.z), d.id).toBeLessThan(0.05);
    }
  });

  it('wall weapons at the original prices (Kar98k 200, Carbine 600, Thompson / double-barrels 1200, Trench Gun 1500, BAR 1800, sniper cabinet 1500)', () => {
    const price = (i: number) => layer.wallBuys[i]!.price;
    expect([price(0), price(1), price(2), price(3), price(5), price(6), price(7), price(8)]).toEqual([200, 600, 1200, 1200, 1200, 1500, 1800, 1500]);
    // Kar98k and Carbine in the start room; Thompson and double-barrel in the Help room; four upstairs.
    expect(layer.wallBuys.slice(0, 2).every((w) => w.y === 0 && w.x > NACHT.xMid)).toBe(true);
    expect(layer.wallBuys.slice(2, 5).every((w) => w.y === 0 && w.x <= NACHT.xMid)).toBe(true);
    expect(layer.wallBuys.slice(5).every((w) => w.y > 3)).toBe(true);
    // The box starts in the Help room (the original's only spot).
    expect(layer.boxSpots[0]!.x).toBeLessThan(NACHT.xMid);
    expect(layer.dogs).toBe(false);
  });
});

describe('nacht: reachability, doors and windows', () => {
  it('with every door open the whole bunker is reachable from the start room, and nothing outside is', () => {
    const r = floodFill(buildCollisionWorld(map), [start]);
    for (const p of [...START, ...HELP, ...UP]) expect(r.near(p, 1.0), `${p.x},${p.y},${p.z}`).toBe(true);
    for (const p of OUT) expect(r.near(p, 1.5), `outside ${p.x},${p.y},${p.z}`).toBe(false);
  });

  it('doors gate the areas: shut, only the start room; the HELP door opens the Help room; either stair door opens upstairs', () => {
    const shut = floodFill(gated(), [start]);
    for (const p of START) expect(shut.near(p, 1.0), `${p.x},${p.y},${p.z}`).toBe(true);
    for (const p of [...HELP, ...UP]) expect(shut.near(p, 1.0), `${p.x},${p.y},${p.z}`).toBe(false);
    const help = floodFill(gated(['help']), [start]);
    for (const p of HELP) expect(help.near(p, 1.0), `help ${p.x},${p.z}`).toBe(true);
    for (const p of UP) expect(help.near(p, 1.0)).toBe(false);
    const stairs = floodFill(gated(['stairs']), [start]);
    for (const p of UP) expect(stairs.near(p, 1.0), `${p.x},${p.y},${p.z}`).toBe(true);
    for (const p of HELP) expect(stairs.near(p, 1.0)).toBe(false);
    // The tower debris is behind the Help room: help + tower opens upstairs too.
    const tower = floodFill(gated(['help', 'tower']), [start], 0.4);
    for (const p of UP) expect(tower.near(p, 1.0), `tower ${p.x},${p.y},${p.z}`).toBe(true);
  });

  it('a shut door stops a walk and bullets; open, you walk through', () => {
    expect(tryWalk(gated(), v(-3.5, 0, 1.55), -6.5, 1.55)).toBeNull();
    expect(gated().lineOfSight(v(-3.5, 1.2, 1.55), v(-6.5, 1.2, 1.55), 'bullets')).toBe(false);
    expect(tryWalk(gated(['help']), v(-3.5, 0, 1.55), -6.5, 1.55)).not.toBeNull();
    expect(gated(['help']).lineOfSight(v(-3.5, 1.2, 1.55), v(-6.5, 1.2, 1.55), 'bullets')).toBe(true);
  });

  it('nobody walks or jumps out of a window, but you can shoot through one', () => {
    const w = buildCollisionWorld(map);
    for (const win of layer.barriers!) {
      const f = { x: -Math.sin(win.yaw), z: -Math.cos(win.yaw) };
      const inside = v(win.x + f.x * 1.2, win.y, win.z + f.z * 1.2);
      const out = { x: win.x - f.x * 1.5, z: win.z - f.z * 1.5 };
      expect(tryWalk(w, inside, out.x, out.z, 0.6), `walk out ${win.x},${win.z}`).toBeNull();
      const eye = v(inside.x, win.y + 1.5, inside.z);
      const target = v(out.x, win.y + (win.sill ?? 0.9) + 0.5, out.z);
      expect(w.lineOfSight(eye, target, 'bullets'), `shoot out ${win.x},${win.z}`).toBe(true);
    }
  });

  it('the stairs climb: spiral stairs from the start room, the tower stairs from the Help room, the outside stairs to the balcony', () => {
    const w = buildCollisionWorld(map);
    const spiral = walkRoute(w, v(-1.8, 0, 0), [v(-0.4, 0, -0.15), v(3.6, 2.1, -0.15), v(4.25, 2.1, 0.4), v(4.25, NACHT.F2, 3.0), v(2, NACHT.F2, 5)]);
    expect(spiral.state.y).toBeCloseTo(NACHT.F2, 1);
    const tower = walkRoute(w, v(-9.5, 0, 8.0), [v(-11.5, 0, 8.3), v(-11.5, NACHT.F2, 3.6), v(-9.5, NACHT.F2, 3.0)]);
    expect(tower.state.y).toBeCloseTo(NACHT.F2, 1);
    const outside = walkRoute(w, v(7, 0, -2.2), [v(4.8, 0, -2.05), v(-0.9, NACHT.F2, -2.05), v(-3.6, NACHT.F2, -2.05)]);
    expect(outside.state.y).toBeCloseTo(NACHT.F2, 1);
    // The west mound up to the top-floor windows.
    const mound = walkRoute(w, v(-25, 0, -6), [v(-14.8, NACHT.F2, -6), v(-11.6, NACHT.F2, -6), v(-11.6, NACHT.F2, -0.2)]);
    expect(mound.state.y).toBeCloseTo(NACHT.F2, 1);
  });

  it('each window has a standing spot on both sides, on the right floor', () => {
    const w = buildCollisionWorld(map);
    for (const b of layer.barriers!) {
      const f = { x: -Math.sin(b.yaw), z: -Math.cos(b.yaw) };
      for (const [k, y] of [[0.8, b.y], [-0.8, b.outY ?? b.y]] as const) {
        const p = v(b.x + f.x * k, y, b.z + f.z * k);
        const g = w.groundBelow(p.x, p.z, y + 0.5, 1.5);
        expect(g, `${b.x},${b.z} ${k}`).not.toBeNull();
        expect(Math.abs(g! - y), `${b.x},${b.z} ${k}`).toBeLessThan(0.3);
        expect(w.free(p.x, g! + 0.05, p.z), `${b.x},${b.z} ${k}`).toBe(true);
      }
    }
  });
});
