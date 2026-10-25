/**
 * Blackout bot behaviour: a goal at all times, no standing about or walking into walls, nobody
 * left to the circle. Players said the bots "fart around with no objective"; the old brain spent
 * about half its ground time on a random roam point and 14 % stuck (scripts/blackout-sim.ts).
 * Seeded: Math.random is replaced for the run (the drop, the far fights and the brains use it).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/shared/constants';
import { rng } from '../src/shared/math';
import { BlackoutBrain, kitOf } from '../src/server/features/blackout/brain';
import { bx } from '../src/server/features/blackout/state';
import { blackoutRoom, type BlackoutHarness } from './blackout-harness';
import { simMetrics } from './blackout-metrics';

let h: BlackoutHarness | null = null;
const realRandom = Math.random;
afterEach(() => {
  h?.close();
  h = null;
  Math.random = realRandom;
});

const brainOf = (p: { brain: unknown }) => p.brain as BlackoutBrain;

/** Put bots on the ground at points (alive, landed). */
function land(hh: BlackoutHarness, at: (i: number) => { x: number; y: number; z: number }) {
  [...hh.room.players.values()].forEach((p, i) => {
    const a = at(i);
    bx(p).stage = 'ground';
    bx(p).landedAt = hh.room.time - 10;
    p.move.x = a.x;
    p.move.y = a.y;
    p.move.z = a.z;
    p.move.vx = p.move.vz = p.move.vy = 0;
    p.move.onGround = true;
  });
}

describe('blackout bots: a whole match', () => {
  it('always have a goal, rarely stand still or get stuck, and the circle kills almost nobody', () => {
    Math.random = rng(7 * 7919 + 13);
    h = blackoutRoom({ seed: 7 });
    h.room.options.onEnd = 'close';
    const m = simMetrics(h);
    for (let i = 0; i < 900 * TICK_RATE && h.room.phase === 'playing'; i++) {
      h.room.step();
      m.sample();
    }
    const r = m.report();
    expect(r.samples).toBeGreaterThan(10000);
    expect(r.idle, 'share of bot-time without a goal').toBeLessThan(0.05);
    expect(r.stuck, 'share of bot-time stuck').toBeLessThan(0.04);
    expect(r.still, 'share of bot-time standing still without reason').toBeLessThan(0.08);
    expect(r.causes.circle ?? 0, 'circle deaths').toBeLessThanOrEqual(5);
    expect(h.game.winner).not.toBeNull();
  }, 240_000);
});

describe('blackout bots: the goal stack', () => {
  it('an unarmed bot goes for a gun; a hurt bot with bandages heals first', () => {
    Math.random = rng(3);
    h = blackoutRoom({ players: 4, seed: 61 });
    const { room } = h;
    for (let i = 0; i < 3 * TICK_RATE; i++) room.step();
    land(h, (i) => ({ x: -150 + i * 3, y: 0, z: -195 }));
    const [a, b] = [...room.players.values()];
    bx(b!).bandages = 3;
    b!.health = 40;
    for (let i = 0; i < 2 * TICK_RATE; i++) room.step();
    expect(kitOf(a!).armed).toBe(false);
    expect(['loot', 'circle']).toContain(brainOf(a!).goal?.kind);
    // The hurt one healed (a bandage started), unless someone shot it meanwhile.
    expect(bx(b!).bandages < 3 || brainOf(b!).goal?.kind === 'heal').toBe(true);
  }, 60_000);

  it('commits to a goal: no switching between goals of the same priority every think', () => {
    Math.random = rng(5);
    h = blackoutRoom({ players: 12, seed: 62 });
    const { room } = h;
    for (let i = 0; i < 3 * TICK_RATE; i++) room.step();
    land(h, (i) => ({ x: -120 + (i % 4) * 30, y: 0, z: -40 + Math.floor(i / 4) * 30 }));
    const bots = [...room.players.values()];
    const changes = new Map<string, number>();
    const last = new Map<string, string>();
    for (let i = 0; i < 40 * TICK_RATE; i++) {
      room.step();
      for (const p of bots) {
        if (!p.alive) continue;
        const g = brainOf(p).goal;
        const key = g ? `${g.kind}@${Math.round(g.x)},${Math.round(g.z)}` : 'none';
        if (last.get(p.id) !== key) changes.set(p.id, (changes.get(p.id) ?? 0) + 1);
        last.set(p.id, key);
      }
    }
    // 40 s at a think every 0.5 s is 80 chances to dither: committed bots change a handful of times
    // (most 7-15; the busiest bot sits at 19-21 across seeds, and moves with the loot table).
    for (const [id, n] of changes) expect(n, id).toBeLessThanOrEqual(22);
  }, 60_000);

  it('bots outside the safe zone walk into it along routes (out of a town and across open ground)', () => {
    Math.random = rng(9);
    h = blackoutRoom({ players: 8, seed: 63 });
    const { room, game } = h;
    for (let i = 0; i < 3 * TICK_RATE; i++) room.step();
    // In Hanoi's streets; the zone is round Launch.
    land(h, (i) => ({ x: 150 + (i % 4) * 4, y: 0, z: 40 + Math.floor(i / 4) * 4 }));
    for (let i = 0; i < game.circles.length; i++) game.circles[i] = { x: 0, z: 10, r: 45 };
    for (let i = 0; i < 60 * TICK_RATE; i++) room.step();
    const alive = [...room.players.values()].filter((p) => p.alive);
    const inside = alive.filter((p) => Math.hypot(p.move.x, p.move.z - 10) < 45);
    expect(inside.length).toBeGreaterThanOrEqual(Math.ceil(alive.length * 0.75));
  }, 60_000);

  it('gives up a goal it cannot reach and picks another', () => {
    Math.random = rng(11);
    h = blackoutRoom({ players: 2, seed: 64 });
    const { room } = h;
    for (let i = 0; i < 3 * TICK_RATE; i++) room.step();
    land(h, (i) => ({ x: -100 + i * 5, y: 0, z: -20 }));
    const p = [...room.players.values()][0]!;
    const b = brainOf(p);
    // A spot in the sea, beyond the shore walls: no route (a circle goal, so nothing outranks it).
    b.goal = { kind: 'circle', x: 300, y: 0, z: 300, since: room.time, until: room.time + 60 };
    (b as unknown as { needRoute: boolean }).needRoute = true;
    (b as unknown as { path: null }).path = null;
    for (let i = 0; i < 2 * TICK_RATE; i++) room.step();
    expect(b.goal).not.toBeNull();
    expect(Math.hypot(b.goal!.x - 300, b.goal!.z - 300)).toBeGreaterThan(10);
    expect(b.stats.noRoute).toBeGreaterThan(0);
  }, 60_000);
});
