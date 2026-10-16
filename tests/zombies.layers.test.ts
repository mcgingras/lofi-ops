/**
 * Every map's Zombies layer (src/shared/maps/zombies/): survivor spawns and zombie spawns on free,
 * reachable ground; wall-buys on a tall wall with standing room in front; box spots and perk
 * machines on free floor, reachable; known weapons and perks; a time preset the map has.
 */
import { describe, expect, it } from 'vitest';
import { navFor } from '../src/server/features/bots/nav';
import { PLAYER } from '../src/shared/constants';
import { getMapData, mapsForMode } from '../src/shared/defs/maps';
import { WEAPON_BY_ID } from '../src/shared/defs/weapons';
import { PERK_COLA_BY_ID, WALL_PRICES } from '../src/shared/defs/zombies';
import { buildCollisionWorld } from '../src/shared/maps/types';
import { ZOMBIES_LAYERS } from '../src/shared/maps/zombies/index';

const dir = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

describe('Zombies layers', () => {
  it('cover exactly the maps that list the mode', () => {
    expect(Object.keys(ZOMBIES_LAYERS).sort()).toEqual(mapsForMode('zombies').map((m) => m.id).sort());
  });

  for (const [id, layer] of Object.entries(ZOMBIES_LAYERS)) {
    describe(id, () => {
      const map = getMapData(id);
      const world = buildCollisionWorld(map);
      const nav = navFor(map);
      const reachable = (p: { x: number; y: number; z: number }) => {
        const c = nav.cellAt(p, true);
        return !!c && c.core && Math.hypot(c.x - p.x, c.z - p.z) < 1.2 && Math.abs(c.y - p.y) < 0.6;
      };

      it('has a time preset the map has, and enough of everything', () => {
        expect(layer.map).toBe(id);
        expect(map.times.map((t) => t.id)).toContain(layer.time);
        expect(layer.wallBuys.length).toBeGreaterThanOrEqual(4);
        expect(layer.boxSpots.length).toBeGreaterThanOrEqual(3);
        expect(new Set(layer.perks.map((p) => p.perk))).toEqual(new Set(['jugg', 'speed', 'doubletap', 'revive']));
        expect(layer.zombieSpawns.length).toBeGreaterThanOrEqual(8);
      });

      it('survivor and zombie spawns stand on free, reachable ground', () => {
        for (const s of [...(layer.playerSpawns ?? []), ...layer.zombieSpawns]) {
          const g = world.groundBelow(s.x, s.z, s.y + 0.5, 1.5);
          expect(g, `${s.x},${s.z}`).not.toBeNull();
          expect(Math.abs(g! - s.y), `${s.x},${s.z}`).toBeLessThan(0.3);
          expect(world.free(s.x, g! + 0.05, s.z, PLAYER.radius, PLAYER.height), `${s.x},${s.z}`).toBe(true);
          expect(reachable({ x: s.x, y: g!, z: s.z }), `${s.x},${s.z}`).toBe(true);
        }
      });

      it('wall-buys sit on a tall wall, with reachable standing room in front', () => {
        for (const w of layer.wallBuys) {
          expect(WEAPON_BY_ID.has(w.weapon), w.weapon).toBe(true);
          expect(w.price ?? WALL_PRICES[w.weapon], w.weapon).toBeGreaterThan(0);
          const f = dir(w.yaw);
          // A ray from 1 m in front, back toward the chalk, hits a wall within ~1 m, 2 m+ tall.
          const from = { x: w.x + f.x, y: w.y + 1.4, z: w.z + f.z };
          const hit = world.raycast(from, { x: -f.x, y: 0, z: -f.z }, 1.3, 'bullets');
          expect(hit, w.weapon).not.toBeNull();
          expect(hit!.solid.max.y - w.y, w.weapon).toBeGreaterThan(2);
          expect(world.free(from.x, w.y + 0.05, from.z, PLAYER.radius, PLAYER.height), w.weapon).toBe(true);
          expect(reachable({ x: from.x, y: w.y, z: from.z }), w.weapon).toBe(true);
        }
      });

      it('box spots and perk machines stand on free floor with reachable room in front', () => {
        for (const s of [...layer.boxSpots, ...layer.perks]) {
          const name = 'perk' in s ? String((s as { perk: string }).perk) : 'box';
          if ('perk' in s) expect(PERK_COLA_BY_ID.has((s as { perk: 'jugg' }).perk)).toBe(true);
          const g = world.groundBelow(s.x, s.z, s.y + 0.5, 1.5, 0.2);
          expect(g, `${name} ${s.x},${s.z}`).not.toBeNull();
          expect(Math.abs(g! - s.y), name).toBeLessThan(0.3);
          expect(world.free(s.x, g! + 0.05, s.z, 0.25, 1.6), `${name} ${s.x},${s.z}`).toBe(true);
          const f = dir(s.yaw);
          const front = { x: s.x + f.x * 1.2, y: g!, z: s.z + f.z * 1.2 };
          expect(world.free(front.x, front.y + 0.05, front.z, PLAYER.radius, PLAYER.height), `${name} front ${front.x},${front.z}`).toBe(true);
          expect(reachable(front), `${name} front ${front.x},${front.z}`).toBe(true);
        }
      });
    });
  }
});
