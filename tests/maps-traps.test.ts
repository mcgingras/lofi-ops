/**
 * No pits: every spot a player can walk, jump or drop into must have a way back to the spawn.
 * Playtests found slots between terrain pieces (Afghan, Jungle, Highrise) and a walled pocket
 * (Estate) you could fall into but never leave. This floods each map with the real movement
 * code, keeping the directed moves, and fails on any node with no path back.
 */
import { describe, expect, it } from 'vitest';
import { MOVE, TICK_DT } from '../src/shared/constants';
import { getMapData, MAPS } from '../src/shared/defs/maps';
import { Buttons } from '../src/shared/input';
import { buildCollisionWorld } from '../src/shared/maps/types';
import { BLACKOUT_TOWNS, townRect } from '../src/shared/maps/blackout';
import { createMoveState, stepMove, type MoveState } from '../src/shared/movement';

const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;

/**
 * A map too big to flood whole (Blackout, 512 m) is flooded region by region: `region` limits the
 * flood, and anything that leaves it counts as a way back (the open ground around each region is
 * flooded on its own).
 */
type Region = { x0: number; z0: number; x1: number; z1: number; seed: { x: number; y: number; z: number } };

function traps(id: string, region?: Region): { x: number; y: number; z: number }[] {
  const map = getMapData(id);
  const world = buildCollisionWorld(map);
  const cell = 0.8;
  const key = (x: number, y: number, z: number) => `${Math.round(x / cell)},${Math.round(z / cell)},${Math.round(y / 0.6)}`;
  const settle = (s: MoveState) => {
    for (let t = 0; t < 3 && !s.onGround; t += TICK_DT) {
      stepMove(world, s, 0, 0, TICK_DT);
      if (s.y < MOVE.killY) return false;
    }
    return s.onGround;
  };
  const s0 = region?.seed ?? map.spawns.teams[0][0] ?? map.spawns.ffa[0]!;
  const outside = (p: { x: number; z: number }) => !!region && (p.x < region.x0 || p.x > region.x1 || p.z < region.z0 || p.z > region.z1);
  const g = world.groundBelow(s0.x, s0.z, s0.y + 1, 3)!;
  const pos = new Map<string, { x: number; y: number; z: number }>();
  const rev = new Map<string, string[]>();
  const k0 = key(s0.x, g, s0.z);
  pos.set(k0, { x: s0.x, y: g, z: s0.z });
  const queue = [k0];
  const add = (from: string, s: MoveState) => {
    const k = key(s.x, s.y, s.z);
    if (!rev.has(k)) rev.set(k, []);
    rev.get(k)!.push(from);
    if (!pos.has(k)) {
      pos.set(k, { x: s.x, y: s.y, z: s.z });
      queue.push(k);
    }
  };
  for (let i = 0; i < queue.length && queue.length < 60000; i++) {
    const from = queue[i]!;
    const n = pos.get(from)!;
    if (outside(n)) continue;
    const cx = Math.round(n.x / cell);
    const cz = Math.round(n.z / cell);
    for (const [dx, dz] of DIRS) {
      const tx = (cx + dx) * cell;
      const tz = (cz + dz) * cell;
      const dist = Math.hypot(tx - n.x, tz - n.z);
      const yaw = Math.atan2(-(tx - n.x), -(tz - n.z));
      const s = { ...createMoveState(n.x, n.y, n.z), onGround: true };
      for (let t = 0; t < dist / MOVE.walk; t += TICK_DT) stepMove(world, s, Buttons.FORWARD, yaw, TICK_DT);
      const moved = Math.hypot(s.x - n.x, s.z - n.z);
      if (settle(s)) add(from, s);
      if (moved > dist * 0.6) continue;
      // Blocked: a running jump.
      const j = { ...createMoveState(n.x, n.y, n.z), onGround: true };
      for (let t = 0; t < 0.1; t += TICK_DT) stepMove(world, j, Buttons.BACK, yaw, TICK_DT);
      settle(j);
      for (let t = 0; t < 0.12; t += TICK_DT) stepMove(world, j, Buttons.FORWARD, yaw, TICK_DT);
      stepMove(world, j, Buttons.FORWARD | Buttons.JUMP, yaw, TICK_DT);
      for (let t = 0; t < 0.5; t += TICK_DT) stepMove(world, j, Buttons.FORWARD, yaw, TICK_DT);
      if (settle(j)) add(from, j);
    }
  }
  const exits = [...pos.entries()].filter(([, p]) => outside(p)).map(([k]) => k);
  const back = new Set([k0, ...exits]);
  const stack = [k0, ...exits];
  while (stack.length) for (const p of rev.get(stack.pop()!) ?? []) if (!back.has(p)) (back.add(p), stack.push(p));
  return [...pos.entries()].filter(([k]) => !back.has(k)).map(([, p]) => p);
}

describe('maps: no pits you can fall into but not leave', () => {
  for (const m of MAPS.filter((d) => d.size !== 'huge')) {
    it(`${m.id} has no traps`, () => {
      const t = traps(m.id).map((p) => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`);
      expect(t, `trap spots on ${m.id}`).toEqual([]);
    }, 240_000);
  }
});

/** Blackout: every town with 12 m of open ground around it, then patches of the open ground. */
function blackoutRegions(): { name: string; region: Region }[] {
  const map = getMapData('blackout');
  const world = buildCollisionWorld(map);
  const out: { name: string; region: Region }[] = [];
  for (const t of BLACKOUT_TOWNS) {
    const r = townRect(t);
    // Seed on the open ground just outside the town's south-west corner.
    const seed = { x: r.x0 - 6, y: world.groundBelow(r.x0 - 6, r.z0 - 6, 20, 30) ?? 0, z: r.z0 - 6 };
    out.push({ name: t.name, region: { x0: r.x0 - 12, z0: r.z0 - 12, x1: r.x1 + 12, z1: r.z1 + 12, seed } });
  }
  for (const [x, z] of [[-60, -200], [90, -60], [-100, 100], [100, 120], [-230, -60], [230, -40]] as const) {
    out.push({ name: `open ground ${x},${z}`, region: { x0: x - 40, z0: z - 40, x1: x + 40, z1: z + 40, seed: { x, y: world.groundBelow(x, z, 20, 30) ?? 0, z } } });
  }
  return out;
}

describe('maps: Blackout (flooded by region)', () => {
  for (const { name, region } of blackoutRegions()) {
    it(`blackout ${name} has no traps`, () => {
      const t = traps('blackout', region).map((p) => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`);
      expect(t, `trap spots in ${name}`).toEqual([]);
    }, 240_000);
  }
});
