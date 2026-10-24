/**
 * Blackout reachability: every town and the open ground between them can be walked into from the
 * drop zone. Players said "can't go into some regions": Terminal's and Scrapyard's out-of-bounds
 * clips stood as invisible walls in the open, Nacht's bunker had no way in from the field (its
 * windows are player clips in Zombies), and stairs crossing a town's cut were dropped. This floods
 * the island with the bots' own navigation (shared/maps grids, src/server/features/blackout/nav.ts):
 * the coarse open-ground grid from under the plane's line, each town's 0.5 m grid from the open
 * ground round it, and compares each town with its source map.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getMapData } from '../src/shared/defs/maps';
import { planePath } from '../src/shared/defs/blackout';
import { rng } from '../src/shared/math';
import { BLACKOUT_TOWNS, townRect } from '../src/shared/maps/blackout';
import { freeAt, groundAt, NavGrid, NAV_CELL } from '../src/server/features/bots/nav';
import { IslandNav } from '../src/server/features/blackout/nav';

const map = getMapData('blackout');
let nav: IslandNav;

beforeAll(() => {
  nav = new IslandNav(map);
  while (nav.warm());
}, 120_000);

describe('blackout reachability: no invisible walls', () => {
  it('has no tall invisible clips inside the island and no gated doors', () => {
    const walls = map.brushes.filter((b) => b.noRender && b.tag !== 'perimeter' && (b.players ?? b.collide ?? true) && !(b.bullets ?? b.collide ?? true) && b.max.y - Math.max(0, b.min.y) > 5);
    expect(walls.map((b) => `${b.tag ?? '-'} ${b.min.x.toFixed(0)},${b.min.z.toFixed(0)}`)).toEqual([]);
    expect(map.brushes.filter((b) => b.gate).length).toBe(0);
  });
});

describe('blackout reachability: the open ground', () => {
  it('the ground under every plane line connects to the whole open ground, every hill top included', () => {
    const g = nav.ground;
    // From the drop zone: points under the plane's line (seeded lines) stand on walkable ground.
    for (const seed of [1, 7, 42, 99]) {
      const pl = planePath(seed, map.bounds);
      let ok = 0;
      let n = 0;
      for (let k = 0.1; k <= 0.9; k += 0.1) {
        const x = pl.x0 + (pl.x1 - pl.x0) * k;
        const z = pl.z0 + (pl.z1 - pl.z0) * k;
        if (nav.townAt(x, z, 0) >= 0) continue;
        n++;
        // Walkable ground within 10 m of the point (it may be a rock or a tree).
        let found = false;
        for (let dx = -10; dx <= 10 && !found; dx += 2) for (let dz = -10; dz <= 10 && !found; dz += 2) found = g.walkable(g.idx(x + dx, z + dz));
        if (found) ok++;
      }
      expect(ok, `seed ${seed}`).toBe(n);
    }
    // The connected open ground covers most of the area between the towns (rocks, their tops and
    // the space round trunks are the rest), and every free spot at ground level belongs to it: no
    // pocket of open ground is walled off.
    let open = 0;
    let walk = 0;
    const pockets: string[] = [];
    for (let k = 0; k < g.N * g.N; k++) {
      const c = g.centre(k);
      if (Math.abs(c.x) > 240 || Math.abs(c.z) > 240 || nav.townAt(c.x, c.z, 2) >= 0) continue;
      open++;
      if (g.walkable(k)) walk++;
      else {
        const h = groundAt(nav.world, c.x, c.z, 12, 14, 0.75);
        if (h !== null && h < 0.1 && freeAt(nav.world, c.x, h + 0.003, c.z, 0.75, 1.8)) pockets.push(`${c.x},${c.z}`);
      }
    }
    expect(walk / open).toBeGreaterThan(0.8);
    expect(pockets).toEqual([]);
    // Hill tops (hotspots on the open ground above y = 1) can be walked up to.
    const tops = (map.hotspots ?? []).filter((h) => h.y > 1 && nav.townAt(h.x, h.z, 4) < 0);
    expect(tops.length).toBeGreaterThan(15);
    for (const h of tops) expect(g.walkable(g.idx(h.x, h.z)), `hill at ${h.x.toFixed(0)},${h.z.toFixed(0)}`).toBe(true);
  });
});

describe('blackout reachability: every town', () => {
  for (const [i, t] of BLACKOUT_TOWNS.entries()) {
    it(`${t.name}: entered on foot from the open ground; its ground floors all reachable; nothing its source map reaches is lost`, () => {
      const tn = nav.town(i);
      const r = townRect(t);
      // Ways in: portals on the open ground round the town that the coarse grid reaches.
      const ways = tn.portals.filter((k) => nav.ground.walkable(nav.ground.idx(tn.x[k]!, tn.z[k]!)));
      expect(ways.length, 'portals on the open ground').toBeGreaterThan(20);
      // Ground-level floor inside the town: reachable from outside and back.
      let ground = 0;
      let reached = 0;
      for (let k = 0; k < tn.n; k++) {
        const x = tn.x[k]!;
        const z = tn.z[k]!;
        if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1 || tn.y[k]! > 0.6) continue;
        ground++;
        if (tn.core[k]) reached++;
      }
      expect(reached / ground, `${ground - reached} ground cells cut off`).toBeGreaterThan(0.99);
      // Everything the source map's own spawns can walk to inside the cut is reachable here (a few
      // m2 of ledges and a roof of Firing Range only reached by jumps outside the cut aside).
      const src = new NavGrid(getMapData(t.map));
      const c = t.cut;
      const ox = t.at.x - (c.x0 + c.x1) / 2;
      const oz = t.at.z - (c.z0 + c.z1) / 2;
      let lost = 0;
      for (const sc of src.coreCells) {
        if (sc.x < c.x0 + 1 || sc.x > c.x1 - 1 || sc.z < c.z0 + 1 || sc.z > c.z1 - 1) continue;
        const k = tn.cellAt({ x: sc.x + ox, y: sc.y + 0.05, z: sc.z + oz });
        if (k < 0 || !tn.core[k] || Math.abs(tn.y[k]! - sc.y) > 0.5) lost++;
      }
      expect(lost * NAV_CELL * NAV_CELL, 'm2 lost').toBeLessThan(60);
    }, 60_000);
  }
});

describe('blackout reachability: routes', () => {
  it('finds a way between any two reachable places on the island (seeded)', () => {
    const r = rng(11);
    const pick = () => {
      for (;;) {
        const x = (r() * 2 - 1) * 240;
        const z = (r() * 2 - 1) * 240;
        const t = nav.townAt(x, z, 0);
        if (t >= 0) {
          const tn = nav.town(t);
          const k = Math.floor(r() * tn.n);
          if (tn.core[k]) return { x: tn.x[k]!, y: tn.y[k]!, z: tn.z[k]! };
          continue;
        }
        const k = nav.ground.idx(x, z);
        if (nav.ground.walkable(k)) return { x, y: nav.ground.h[k]!, z };
      }
    };
    let fails = 0;
    for (let i = 0; i < 150; i++) if (!nav.route(pick(), pick())) fails++;
    expect(fails).toBe(0);
  });

  it('fits the memory budget: under 48 MB of grids for the whole island', () => {
    expect(nav.built).toBe(BLACKOUT_TOWNS.length);
    expect(nav.bytes / 1e6).toBeLessThan(48);
  });
});
