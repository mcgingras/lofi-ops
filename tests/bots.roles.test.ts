/** Bot roles, lanes and team spreading (src/server/features/bots/roles.ts). */
import { describe, expect, it } from 'vitest';
import { chasersNear, crowdPenalty, laneOf, mapAxis, PathUsage, pickLane, rollRole, type BotRole, type GoalClaim } from '../src/server/features/bots/roles';
import { NavGrid } from '../src/server/features/bots/nav';
import { BOT_DIFFICULTY_BY_ID } from '../src/shared/defs/bots';
import { getMapData } from '../src/shared/defs/maps';
import { rng } from '../src/shared/math';

const regular = { ...BOT_DIFFICULTY_BY_ID.get('regular')!.skill };

describe('bots: roles', () => {
  it('rolls a mix of roles; campers are rare; objective players only in objective modes', () => {
    const r = rng(4);
    const count = (obj: boolean) => {
      const n: Record<BotRole, number> = { lane: 0, flanker: 0, hunter: 0, objective: 0, camper: 0 };
      for (let i = 0; i < 2000; i++) n[rollRole(regular, obj, r)]++;
      return n;
    };
    const tdm = count(false);
    expect(tdm.objective).toBe(0);
    expect(tdm.camper / 2000).toBeLessThan(0.08);
    expect(tdm.camper).toBeGreaterThan(0);
    for (const k of ['lane', 'flanker', 'hunter'] as const) expect(tdm[k] / 2000).toBeGreaterThan(0.15);
    expect(count(true).objective / 2000).toBeGreaterThan(0.2);
  });

  it('spreads lanes: least used first, pairs at most, flankers on the outside', () => {
    const r = rng(8);
    for (let i = 0; i < 200; i++) {
      expect(pickLane('lane', [2, 0, 2], r, 0)).toBe(1);
      expect(pickLane('flanker', [0, 0, 3], r)).toBe(0);
      // A pair joins a lane with exactly one teammate, never a third.
      const l = pickLane('lane', [1, 2, 2], r, 1);
      expect(l).toBe(0);
    }
    // A team of six fills the three lanes two by two.
    const counts: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 6; i++) counts[pickLane('lane', counts, r, 0)]++;
    expect(counts).toEqual([2, 2, 2]);
  });

  it('lanes cover a real map across the spawn axis', () => {
    const map = getMapData('nuketown');
    const axis = mapAxis(map);
    const nav = new NavGrid(map);
    const n = [0, 0, 0];
    for (const c of nav.coreCells) n[laneOf(axis, c)]++;
    for (const k of n) expect(k / nav.coreCells.length).toBeGreaterThan(0.1);
  });

  it('teammates` goals and chases count against the same spot; enemies` don`t', () => {
    const claims = new Map<string, GoalClaim>([
      ['a', { team: 0, at: { x: 0, y: 0, z: 0 }, kind: 'chase', role: 'hunter', lane: 1, t: 0 }],
      ['b', { team: 0, at: { x: 1, y: 0, z: 1 }, kind: 'heard', role: 'lane', lane: 1, t: 0 }],
      ['c', { team: 1, at: { x: 0, y: 0, z: 0 }, kind: 'chase', role: 'lane', lane: 1, t: 0 }],
    ]);
    expect(crowdPenalty(claims, 0, { x: 0, y: 0, z: 0 }, 'me', 1)).toBeGreaterThan(crowdPenalty(claims, 0, { x: 30, y: 0, z: 0 }, 'me', 1));
    expect(crowdPenalty(claims, 0, { x: 30, y: 0, z: 0 }, 'me', 1)).toBe(0);
    expect(chasersNear(claims, 0, { x: 0, y: 0, z: 0 }, 'me', 1)).toBe(2);
    expect(chasersNear(claims, 1, { x: 0, y: 0, z: 0 }, 'me', 1)).toBe(1);
  });

  it('path usage makes A* route around a lane a teammate already walks', () => {
    const map = getMapData('nuketown');
    const nav = new NavGrid(map);
    const from = nav.random(rng(1))!;
    let to = nav.random(rng(2))!;
    for (let s = 3; Math.hypot(to.x - from.x, to.z - from.z) < 40; s++) to = nav.random(rng(s))!;
    const first = nav.path(from, to)!;
    expect(first).not.toBeNull();
    const usage = new PathUsage(map);
    usage.set('mate', 0, first);
    const second = nav.path(from, to, undefined, { cost: (c) => 1 + Math.min(3, usage.usage(0, c.x, c.z)) * 0.35 })!;
    const tiles = (p: typeof first) => new Set(p.map((c) => usage.tile(c.x, c.z)));
    const a = tiles(first);
    const shared = [...tiles(second)].filter((t) => a.has(t)).length;
    expect(shared).toBeLessThan(a.size);
    usage.clear('mate');
    expect(usage.usage(0, first[3]!.x, first[3]!.z)).toBe(0);
  });
});
