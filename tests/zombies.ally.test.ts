/**
 * The AI ally ("partner") in solo Zombies (ally.ts): it follows within range and out of your line
 * of fire, kills zombies (heads too), revives you within a time bound on Nuketown (backing off a
 * swarm first unless you are about to bleed out), buys Juggernog when it can, is revivable by you,
 * comes back the round after bleeding out; game over only when everyone is down; the HUD state;
 * allies count toward the round size. Rooms are stepped tick by tick.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AllyBrain } from '../src/server/features/zombies/ally';
import { setZombiesAllies } from '../src/server/features/zombies/game';
import { survivorOf, undeadOf } from '../src/server/features/zombies/state';
import type { PlayerState } from '../src/server/player';
import { allyCount, allyDifficulty, ZOMBIES, ZOMBIES_ALLY, zombiesForRound } from '../src/shared/defs/zombies';
import { angleDiff } from '../src/server/features/bots/aim';
import { Buttons } from '../src/shared/input';
import { yawTo } from '../src/shared/math';
import { withSeed } from './bots-sim';
import { hold, human, place, steps, stepUntil, zmClose, zmRoom, type ZmWorld } from './zombies-helpers';

let w: ZmWorld | undefined;
afterEach(() => {
  zmClose(w);
  w = undefined;
});

/** No zombies left or queued (killed like a Nuke: no points, no requeue). */
function clearHorde(x: ZmWorld): void {
  x.g.queue = 0;
  for (const z of x.g.aliveUndead()) {
    undeadOf(z)!.nuked = true;
    x.room.kill(z, null, { weapon: 'test', means: 'world' });
  }
}

const flat = (a: PlayerState, b: PlayerState) => Math.hypot(a.move.x - b.move.x, a.move.z - b.move.z);

/** A solo game with `n` allies; round 1 under way (or the first break when `quiet`: no zombies). */
function duo(opts: { n?: number; difficulty?: string; quiet?: boolean; god?: boolean; mode?: 'casual' | 'classic' } = {}) {
  w = zmRoom('nuketown', opts.mode);
  const room = w.room;
  setZombiesAllies(room, opts.n ?? 1, opts.difficulty ?? 'regular');
  const h = human(room);
  steps(room, 0.3);
  const g = w.g;
  const allies = [...room.players.values()].filter((p) => p.isBot && survivorOf(p));
  expect(allies.length).toBe(opts.n ?? 1);
  if (opts.god !== false) room.modifiers.add('damageTaken', (v) => (v === h ? 0 : undefined), 'test.god');
  g.phaseEndsAt = room.time;
  steps(room, 0.1);
  if (opts.quiet) clearHorde(w);
  const ally = allies[0]!;
  return { room, g, h, ally, brain: ally.brain as AllyBrain, allies };
}

describe('the partner option', () => {
  it('solo asks for 0-3 allies (1 by default) at recruit / regular / veteran', () => {
    expect(allyCount(undefined)).toBe(ZOMBIES_ALLY.defaultCount);
    expect(allyCount(7)).toBe(3);
    expect(allyCount(-2)).toBe(0);
    expect(allyDifficulty('veteran')).toBe('veteran');
    expect(allyDifficulty('godlike')).toBe('regular');
    const { allies, g } = duo({ n: 3 });
    expect(allies.length).toBe(3);
    expect(new Set(allies.map((a) => a.name)).size).toBe(3);
    expect(g.survivors().length).toBe(4);
    expect(g.solo).toBe(false);
  });

  it('Classic: allies count as players for the round size (BO1 scales by players)', () => {
    const { g } = duo({ n: 1, mode: 'classic' });
    // Round 1, two survivors: BO1's 2-player count.
    expect(g.queue + g.aliveUndead().length).toBe(zombiesForRound(1, 2));
    expect(zombiesForRound(1, 2)).toBeGreaterThan(zombiesForRound(1, 1));
  });
});

describe('following', () => {
  it('stays within 6-15 m of you as you move around Nuketown, mostly out of your line of fire', () => {
    withSeed(11, () => {
      const { room, h, ally } = duo({ quiet: true });
      const route: [number, number, number][] = [
        [-1.5, -11.5, Math.PI],
        [-8, -2, Math.PI / 2],
        [6, 6, 0],
        [18, -4, -Math.PI / 2],
        [0, 8, Math.PI],
      ];
      let ok = 0;
      let lane = 0;
      let samples = 0;
      for (const [x, z, yaw] of route) {
        place(room, h, x, z, yaw);
        steps(room, 7, () => hold(room, h, 0, yaw));
        // Settled: sample the next 3 s.
        for (let i = 0; i < 6; i++) {
          steps(room, 0.5, () => hold(room, h, 0, yaw));
          samples++;
          const d = flat(ally, h);
          if (d <= ZOMBIES_ALLY.followMax + 1 && d >= 2.5) ok++;
          if (d < ZOMBIES_ALLY.fireLaneRange && Math.abs(angleDiff(yawTo(h.move, ally.move), h.yaw)) < ZOMBIES_ALLY.fireLaneHalf) lane++;
        }
      }
      expect(ok / samples).toBeGreaterThanOrEqual(0.9);
      expect(lane / samples).toBeLessThanOrEqual(0.15);
    });
  });
});

describe('fighting', () => {
  it('kills zombies on its own (headshots too) and earns its own points', () => {
    withSeed(5, () => {
      const { room, g, ally, h } = duo({ difficulty: 'veteran' });
      void h;
      const s = survivorOf(ally)!;
      // The ally fights with a wall gun it would have bought.
      g.buy.giveWeapon(ally, 'mp5k');
      steps(room, 90);
      expect(s.kills).toBeGreaterThanOrEqual(4);
      expect(s.headshots).toBeGreaterThanOrEqual(1);
      expect(s.total).toBeGreaterThan(ZOMBIES.startPoints + 200);
    });
  });
});

describe('reviving', () => {
  it('revives you within a time bound when you go down (and says so)', () => {
    withSeed(3, () => {
      const { room, g, h, ally, brain } = duo({ quiet: true, god: false });
      const callouts: string[] = [];
      room.bus.on('tick', () => {});
      const origEvent = g.event.bind(g);
      g.event = (e, to) => {
        if (e.kind === 'callout' && e.text) callouts.push(e.text);
        origEvent(e, to);
      };
      place(room, h, -8, -2, 0);
      steps(room, 4, () => hold(room, h, 0));
      g.goDown(h, null, 'zombie', 'melee');
      expect(g.isDown(h)).toBe(true);
      const t = stepUntil(room, 15, () => !g.isDown(h), () => hold(room, h, 0));
      expect(t).not.toBeNull();
      // Walk over (up to 15 m) and the 3 s hold.
      expect(t!).toBeLessThan(12);
      expect(survivorOf(ally)!.revives).toBe(1);
      expect(brain.stats.revives).toBeGreaterThanOrEqual(1);
      expect(callouts.some((c) => c.includes('REVIVING YOU'))).toBe(true);
      expect(g.phase).not.toBe('over');
    });
  });

  it('backs off a swarm before reviving, unless you are about to bleed out', () => {
    withSeed(4, () => {
      const { room, g, h, ally, brain } = duo({ quiet: true, god: false, difficulty: 'recruit' });
      place(room, h, -8, -2, 0);
      place(room, ally, -6, -2, 0);
      g.goDown(h, null, 'zombie', 'melee');
      // Three zombies around the downed player, held still.
      g.horde.frozen = true;
      for (let i = 0; i < 3; i++) {
        expect(g.spawnOne('zombie')).toBe(true);
        const z = g.aliveUndead().at(-1)!;
        place(room, z, -8 + Math.cos(i * 2) * 1.5, -2 + Math.sin(i * 2) * 1.5);
        z.health = z.maxHealth = 1e6;
      }
      steps(room, 0.5, () => hold(room, h, 0));
      // Not reviving yet: backing off (or clearing them first), USE not held.
      expect(['retreat', 'fight']).toContain(brain.mode);
      expect(ally.buttons & Buttons.USE).toBe(0);
      expect(g.isDown(h)).toBe(true);
      // Overwhelmed (zombies on top of it): it backs away.
      for (const z of g.aliveUndead()) place(room, z, ally.move.x + (Math.random() - 0.5), ally.move.z + (Math.random() - 0.5));
      steps(room, 0.2, () => hold(room, h, 0));
      expect(brain.mode).toBe('retreat');
      // Bleeding out soon: it goes in anyway.
      const ls = h.ext.perks!.lastStand!;
      ls.until = room.time + ZOMBIES_ALLY.tuning.recruit.reviveUrgentSec - 1;
      steps(room, 0.5, () => hold(room, h, 0));
      expect(brain.mode).toBe('revive');
    });
  });

  it('you can revive the ally with the co-op prompt (hold USE next to it)', () => {
    const { room, g, h, ally } = duo({ quiet: true });
    place(room, ally, -4, -10, 0);
    place(room, h, -4.8, -10, 0);
    g.goDown(ally, null, 'zombie', 'melee');
    expect(g.isDown(ally)).toBe(true);
    // The HUD sees it down, revivable, with its revive progress.
    const info = () => g.state().players.find((p) => p.id === ally.id)!;
    expect(info()).toMatchObject({ down: true, bot: true, selfRevive: false });
    steps(room, 1, () => {
      place(room, h, -4.8, -10, 0);
      hold(room, h, Buttons.USE);
    });
    expect(info().revive).toBeGreaterThan(0.2);
    steps(room, ZOMBIES.reviveSec, () => {
      place(room, h, -4.8, -10, 0);
      hold(room, h, Buttons.USE);
    });
    expect(g.isDown(ally)).toBe(false);
    expect(survivorOf(h)!.revives).toBe(1);
  });
});

describe('buying', () => {
  it('buys Juggernog when it can afford it', () => {
    withSeed(8, () => {
      const { room, g, h, ally } = duo({ quiet: true });
      // Stand near the Juggernog machine; the ally has a gun and points to spare.
      place(room, h, -10, -4, 0);
      g.buy.giveWeapon(ally, 'mp5k');
      survivorOf(ally)!.points = 3000;
      const t = stepUntil(room, 40, () => survivorOf(ally)!.perks.includes('jugg'), () => hold(room, h, 0));
      expect(t).not.toBeNull();
      expect(ally.maxHealth).toBe(ZOMBIES.jugHealth);
      expect(survivorOf(ally)!.points).toBe(500);
    });
  });

  it('buys a wall gun when it has only the pistol and can afford an SMG', () => {
    withSeed(9, () => {
      const { room, g, h, ally } = duo({ quiet: true });
      place(room, h, -6, -10, Math.PI);
      survivorOf(ally)!.points = 1400;
      const t = stepUntil(room, 40, () => ally.weapons.length === 2, () => hold(room, h, 0));
      expect(t).not.toBeNull();
      expect(['mpl', 'ak74u', 'mp5k', 'm16a4', 'stakeout']).toContain(ally.weapons[1]!.def.base.id);
      void g;
    });
  });
});

describe('game over with allies', () => {
  it('you down with the ally up: the game goes on; the ally down with you up: goes on; both down: over', () => {
    const { room, g, h, ally } = duo({ quiet: true });
    g.goDown(h, null, 'zombie', 'melee');
    steps(room, 0.2, () => hold(room, h, 0));
    expect(g.phase).not.toBe('over');
    // The ally revives (or we do it here) and goes down itself.
    if (g.isDown(h)) h.ext.perks!.lastStand!.revive = 0;
    g.goDown(ally, null, 'zombie', 'melee');
    steps(room, 0.2, () => hold(room, h, 0));
    expect(g.phase).toBe('over');
  });

  it('the ally down while you are up: no game over; it bleeds out and is back next round', () => {
    const { room, g, h, ally } = duo();
    // Mid-round (zombies held still), you far from the ally.
    g.horde.frozen = true;
    place(room, h, 10, 10, 0);
    place(room, ally, -20, -10, 0);
    g.goDown(ally, null, 'zombie', 'melee');
    steps(room, 0.5, () => hold(room, h, 0));
    expect(g.phase).toBe('active');
    const before = survivorOf(h)!.points;
    ally.ext.perks!.lastStand!.until = room.time;
    steps(room, 0.2, () => hold(room, h, 0));
    expect(ally.alive).toBe(false);
    expect(survivorOf(ally)!.dead).toBe(true);
    expect(g.phase).toBe('active');
    // BO1 `penalty_no_revive`: the players up lose 10%.
    expect(survivorOf(h)!.points).toBe(before - 50);
    // The round ends: the break brings it back.
    clearHorde(w!);
    const t = stepUntil(room, 12, () => ally.alive, () => hold(room, h, 0));
    expect(t).not.toBeNull();
    expect(g.isDown(ally)).toBe(false);
  });
});

describe('HUD data', () => {
  it('the state carries the ally: name via roster, points, perks, down state and revive progress', () => {
    const { g, ally } = duo({ quiet: true });
    survivorOf(ally)!.perks.push('jugg');
    const st = g.state();
    const a = st.players.find((p) => p.id === ally.id)!;
    expect(a).toMatchObject({ bot: true, points: 500, perks: ['jugg'], down: false, revive: 0 });
    expect(st.players.filter((p) => !p.bot).length).toBe(1);
  });
});
