/**
 * Rust layout checks against the reference (docs/maps/rust-reference.md): play-area size, the
 * walkable heights of the tower decks, pipeline, derrick and container roofs, the places you can walk
 * under, the sightlines that make the tower top the power position, and the bots' nav grid reaching
 * every objective and roam point (tower top included) from both team spawns.
 */
import { describe, expect, it } from 'vitest';
import { NavGrid } from '../src/server/features/bots/nav';
import { getMapData } from '../src/shared/defs/maps';
import { RUST_DECKS, RUST_PLAY } from '../src/shared/maps/rust';
import { buildCollisionWorld } from '../src/shared/maps/types';

const map = getMapData('rust');
const world = buildCollisionWorld(map);
const floorAt = (x: number, z: number, fromY: number) => world.groundBelow(x, z, fromY + 0.2, 1.0);

describe('rust layout (reference: MW2 minimap + MWIII tac map)', () => {
  it('is the tiny square: about 48.6 x 49.6 m of play space, bounds 1.8 m outside it', () => {
    expect(RUST_PLAY.maxX - RUST_PLAY.minX).toBeCloseTo(48.6, 1);
    expect(RUST_PLAY.maxZ - RUST_PLAY.minZ).toBeCloseTo(49.6, 1);
    expect(map.bounds.min.x).toBeCloseTo(RUST_PLAY.minX - 1.8, 5);
    expect(map.bounds.max.z).toBeCloseTo(RUST_PLAY.maxZ + 1.8, 5);
  });

  it('has walkable floors at the reference heights', () => {
    const at: [string, number, number, number][] = [
      ['tower top', -1.5, 2.6, RUST_DECKS.top],
      ['tower mid deck (west wing)', -5.6, -1.2, RUST_DECKS.mid],
      ['tower mid deck (north)', 5.6, -6.0, RUST_DECKS.mid],
      ['raised platform', 0.2, 4.0, RUST_DECKS.raised],
      ['pipe branch', -12, -8.9, RUST_DECKS.mid],
      ['pipeline south run', -23, 14, RUST_DECKS.derrick],
      ['derrick platform', -17, 12.4, RUST_DECKS.derrick],
      ['fuel-tank skid', -13.2, -2.3, RUST_DECKS.tank],
      ['blue containers', -12.6, -15.4, RUST_DECKS.containers],
    ];
    for (const [name, x, z, y] of at) {
      const g = floorAt(x, z, y);
      expect(g, name).not.toBeNull();
      expect(g!, name).toBeCloseTo(y, 1);
      expect(world.free(x, g!, z), `${name} free`).toBe(true);
    }
  });

  it('lets you walk under the pipe branch, the chute near the tower and through the tower maze', () => {
    for (const [name, x, z] of [
      ['under the pipe branch', -12, -8.9],
      ['under the chute', 6.0, 1.9],
      ['west passage', -3.8, -1.0],
      ['north tunnel', -1.5, -4.6],
      ['ladder well', 3.1, 0.0],
      ['north-east room (S&D B)', 5.6, -6.3],
      ['derrick tunnel', -19.1, 20.4],
      ['covered passage', 19.0, -1.4],
    ] as const) {
      expect(world.free(x, 0.01, z), name).toBe(true);
      expect(floorAt(x, z, 0), name).toBeCloseTo(0, 2);
    }
  });

  it('the tower top sees both spawn areas; the maze under the decks is hidden from it', () => {
    const eye = (x: number, y: number, z: number) => ({ x, y: y + 1.6, z });
    // Standing at the rails of the top deck (its corners), as players do.
    const tops = [[-3.8, -1.0], [0.8, 3.9], [-3.8, 3.9], [0.8, 0.4], [0.8, -3.0], [-2.6, -3.0]].map(([x, z]) => eye(x!, RUST_DECKS.top, z!));
    const topEye = tops[1]!;
    const chest = (s: { x: number; y: number; z: number }) => ({ x: s.x, y: s.y + 1.2, z: s.z });
    const seen = (list: { x: number; y: number; z: number }[]) => list.filter((s) => tops.some((e) => world.lineOfSight(e, chest(s)))).length;
    expect(seen(map.spawns.teams[0])).toBeGreaterThanOrEqual(8);
    expect(seen(map.spawns.teams[1])).toBeGreaterThanOrEqual(5);
    // About half the open ground (chest height, 2 m grid) is in view from the top.
    let vis = 0;
    let tot = 0;
    for (let x = -23; x <= 23; x += 2)
      for (let z = -23; z <= 24; z += 2) {
        tot++;
        if (tops.some((e) => world.lineOfSight(e, { x, y: 1.2, z }))) vis++;
      }
    expect(vis / tot).toBeGreaterThan(0.45);
    // From inside the north tunnel you cannot see the tower top.
    expect(world.lineOfSight(eye(-1.5, 0, -4.6), topEye)).toBe(false);
  });

  it('bot nav reaches every objective and roam point, tower top included, from both team spawns', () => {
    const nav = new NavGrid(map);
    const targets = [...Object.values(map.objectives).flat(), ...(map.hotspots ?? [])];
    expect(targets.some((t) => t.y === RUST_DECKS.top)).toBe(true);
    for (const from of [map.spawns.teams[0][0]!, map.spawns.teams[1][0]!]) {
      for (const t of targets) {
        const path = nav.path(from, t);
        expect(path, `path ${from.x},${from.z} -> ${t.x},${t.y},${t.z}`).not.toBeNull();
        const end = path!.at(-1)!;
        expect(Math.hypot(end.x - t.x, end.z - t.z), `end near ${t.x},${t.z}`).toBeLessThan(1.2);
        expect(Math.abs(end.y - t.y), `end height ${t.x},${t.y},${t.z}`).toBeLessThan(0.6);
        expect(end.core).toBe(true);
      }
    }
  });
});
