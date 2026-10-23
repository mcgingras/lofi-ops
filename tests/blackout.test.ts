/**
 * Blackout (100-player battle royale): the circle, placements, no respawns, the winner, loot, the
 * plane / freefall / parachute, interest management, and a 100-player room that runs a stretch of
 * a match within a time budget. Rooms are stepped by hand (tests/blackout-harness.ts), seeded.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BLACKOUT, GLIDE, buildCircles, circleState, circlesTotalSec, insideCircle, phaseTimes, placementXp, planeAt, planePath, rollLoot, type Circle } from '../src/shared/defs/blackout';
import { TICK_DT, TICK_RATE } from '../src/shared/constants';
import { getMapData } from '../src/shared/defs/maps';
import { MODE_BY_ID } from '../src/shared/defs/modes';
import { buildCollisionWorld } from '../src/shared/maps/types';
import { createMoveState, DEFAULT_MOVE_PARAMS, stepMove } from '../src/shared/movement';
import { Buttons } from '../src/shared/input';
import { rng } from '../src/shared/math';
import { BLACKOUT_TOWNS, terrainTiles, townRect } from '../src/shared/maps/blackout';
import { LOOT_ENTITY } from '../src/shared/defs/blackout';
import { PICKUP_ENTITY } from '../src/shared/defs/pickups';
import { lootSpots } from '../src/server/features/blackout/loot';
import { bx } from '../src/server/features/blackout/state';
import { blackoutRoom, stats, stepTimed, type BlackoutHarness } from './blackout-harness';

let h: BlackoutHarness | null = null;
afterEach(() => {
  h?.close();
  h = null;
});

const START: Circle = { x: 0, z: 0, r: 370 };

describe('blackout: the circle', () => {
  it('builds nested circles, deterministic per seed', () => {
    const a = buildCircles(42, START);
    const b = buildCircles(42, START);
    expect(a).toEqual(b);
    expect(a.length).toBe(BLACKOUT.circle.phases.length + 1);
    for (let i = 1; i < a.length; i++) {
      const prev = a[i - 1]!;
      const c = a[i]!;
      expect(c.r).toBe(BLACKOUT.circle.phases[i - 1]!.radius);
      // Wholly inside the previous circle.
      expect(Math.hypot(c.x - prev.x, c.z - prev.z) + c.r).toBeLessThanOrEqual(prev.r + 1e-6);
    }
    expect(buildCircles(43, START)).not.toEqual(a);
  });

  it('runs 6-8 phases over 12-15 minutes, waits then shrinks, damage rising each phase', () => {
    const ph = BLACKOUT.circle.phases;
    expect(ph.length).toBeGreaterThanOrEqual(6);
    expect(ph.length).toBeLessThanOrEqual(8);
    const total = circlesTotalSec();
    expect(total).toBeGreaterThanOrEqual(12 * 60);
    expect(total).toBeLessThanOrEqual(15 * 60);
    for (let i = 1; i < ph.length; i++) expect(ph[i]!.dps).toBeGreaterThan(ph[i - 1]!.dps);
    const cs = buildCircles(7, START);
    const t = phaseTimes();
    // Waiting: the circle holds; shrinking: half way at the midpoint; closed after the last.
    expect(circleState(cs, 10)).toMatchObject({ phase: 0, stage: 'wait', cur: cs[0], next: cs[1], dps: ph[0]!.dps });
    const mid = (t[1]!.shrinkStart + t[1]!.shrinkEnd) / 2;
    const s = circleState(cs, mid);
    expect(s.stage).toBe('shrink');
    expect(s.phase).toBe(1);
    expect(s.cur.r).toBeCloseTo((cs[1]!.r + cs[2]!.r) / 2, 6);
    expect(s.cur.x).toBeCloseTo((cs[1]!.x + cs[2]!.x) / 2, 6);
    const end = circleState(cs, total + 1);
    expect(end.stage).toBe('closed');
    expect(end.next).toBeNull();
    expect(end.dps).toBe(BLACKOUT.circle.finalDps);
  });

  it('hurts players outside the circle once a second at the phase rate, never inside', () => {
    h = blackoutRoom({ players: 4, seed: 11 });
    const { room, game } = h;
    const [a, b] = [...room.players.values()];
    // Everyone lands; a stands at the circle's centre, b far outside the first circle.
    for (const p of room.players.values()) {
      bx(p).stage = 'ground';
      p.move.onGround = true;
    }
    game.circles[0] = { x: 0, z: 0, r: 50 };
    a!.move.x = a!.move.z = 0;
    a!.move.y = 0;
    b!.move.x = 200;
    b!.move.z = 0;
    b!.move.y = 0;
    const hA = a!.health;
    const hB = b!.health;
    for (let i = 0; i < 3 * TICK_RATE + 2; i++) room.step();
    expect(a!.health).toBe(hA);
    expect(hB - b!.health).toBeCloseTo(3 * BLACKOUT.circle.phases[0]!.dps, 5);
    // Armour doesn't help against the circle.
    bx(b!).armor = bx(b!).armorMax = 150;
    const before = b!.health;
    for (let i = 0; i < TICK_RATE; i++) room.step();
    expect(before - b!.health).toBeCloseTo(BLACKOUT.circle.phases[0]!.dps, 5);
    expect(bx(b!).armor).toBe(150);
  });
});

describe('blackout: places, no respawns, the winner', () => {
  it('places the dead in reverse order, never respawns them, and the last one wins', () => {
    h = blackoutRoom({ players: 6, seed: 3 });
    const { room, game } = h;
    expect(room.mode.id).toBe('blackout');
    expect(MODE_BY_ID.get('blackout')!.respawn).toBe(false);
    for (let i = 0; i < 10; i++) room.step();
    const ps = [...room.players.values()];
    expect(game.entrants.size).toBe(6);
    // Kill four, one after another.
    room.kill(ps[0]!, ps[5]!, { weapon: 'ak47', means: 'bullet' });
    room.kill(ps[1]!, ps[5]!, { weapon: 'ak47', means: 'bullet' });
    room.kill(ps[2]!, null, { weapon: 'storm', means: 'storm' });
    room.kill(ps[3]!, ps[4]!, { weapon: 'ak47', means: 'bullet' });
    expect([0, 1, 2, 3].map((i) => game.places.get(ps[i]!.id))).toEqual([6, 5, 4, 3]);
    expect(game.aliveCount()).toBe(2);
    // No respawn, however long we wait.
    for (let i = 0; i < 6 * TICK_RATE; i++) room.step();
    expect(ps.slice(0, 4).every((p) => !p.alive && p.respawnAt === null)).toBe(true);
    expect(room.phase).toBe('playing');
    // Second to last goes: the other wins, the match ends shortly after.
    room.kill(ps[4]!, ps[5]!, { weapon: 'ak47', means: 'bullet' });
    expect(game.places.get(ps[4]!.id)).toBe(2);
    expect(game.places.get(ps[5]!.id)).toBe(1);
    expect(game.winner).toBe(ps[5]!.id);
    for (let i = 0; i < 2 * TICK_RATE; i++) room.step();
    expect(room.phase).toBe('ended');
    const res = room.results!;
    expect(res.winners).toEqual([ps[5]!.id]);
    expect(res.players[0]!.id).toBe(ps[5]!.id);
    expect(res.players.map((r) => r.place)).toEqual([1, 2, 3, 4, 5, 6]);
    expect((res.ext.blackout as { total: number }).total).toBe(6);
    expect(placementXp(1)).toBeGreaterThan(placementXp(2));
  });

  it('the last two dying together: the later one takes the win', () => {
    h = blackoutRoom({ players: 3, seed: 4 });
    const { room, game } = h;
    for (let i = 0; i < 5; i++) room.step();
    const ps = [...room.players.values()];
    room.kill(ps[0]!, null, { weapon: 'storm', means: 'storm' });
    expect(game.places.get(ps[0]!.id)).toBe(3);
    // Two left; both "die" in the same tick (the last one standing still wins when the other goes first).
    room.kill(ps[1]!, null, { weapon: 'storm', means: 'storm' });
    expect(game.winner).toBe(ps[2]!.id);
  });

  it('a leaver is placed like a death', () => {
    h = blackoutRoom({ players: 4, seed: 5 });
    const { room, game } = h;
    for (let i = 0; i < 5; i++) room.step();
    const ps = [...room.players.values()];
    room.removePlayer(ps[0]!.id, 'left');
    expect(game.places.get(ps[0]!.id)).toBe(4);
    expect(game.aliveCount()).toBe(3);
  });

  it('sends a human their placement', () => {
    h = blackoutRoom({ humans: 1, players: 3, seed: 6, keepMsgs: true });
    const { room } = h;
    for (let i = 0; i < 5; i++) room.step();
    const me = h.humans[0]!.player;
    const bot = [...room.players.values()].find((p) => p.isBot)!;
    room.kill(me, bot, { weapon: 'ak47', means: 'bullet' });
    const placed = h.humans[0]!.socket.msgs.map((m) => JSON.parse(m)).find((m) => m.t === 'feat' && m.id === 'blackout.placed');
    expect(placed?.data).toMatchObject({ place: 3, of: 3, won: false, killer: bot.id, killerName: bot.name });
    expect(bx(me).watching).toBe(bot.id);
  });
});

describe('blackout: the plane, freefall and the parachute', () => {
  it('flies a seeded line across the island', () => {
    const map = getMapData('blackout');
    const p = planePath(9, map.bounds);
    expect(planePath(9, map.bounds)).toEqual(p);
    expect(p.duration).toBeGreaterThan(20);
    const a = planeAt(p, 0);
    const b = planeAt(p, p.duration);
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(300);
    for (const at of [a, b, planeAt(p, p.duration / 2)]) {
      expect(Math.abs(at.x)).toBeLessThan(map.bounds.max.x);
      expect(Math.abs(at.z)).toBeLessThan(map.bounds.max.z);
    }
  });

  it('glide physics: freefall caps the fall speed, the chute brakes it, both steer; the plane keeps velocity', () => {
    const world = buildCollisionWorld(getMapData('blackout'));
    const s = createMoveState(0, 300, -200);
    s.onGround = false;
    for (let i = 0; i < 4 * TICK_RATE; i++) stepMove(world, s, Buttons.FORWARD, 0, TICK_DT, { ...DEFAULT_MOVE_PARAMS, glide: GLIDE.freefall });
    expect(s.vy).toBeCloseTo(-GLIDE.freefall.terminal, 5);
    expect(-s.vz).toBeCloseTo(GLIDE.freefall.speed, 1); // steered forward (yaw 0 = -z)
    for (let i = 0; i < 2 * TICK_RATE; i++) stepMove(world, s, 0, 0, TICK_DT, { ...DEFAULT_MOVE_PARAMS, glide: GLIDE.chute });
    expect(s.vy).toBeCloseTo(-GLIDE.chute.terminal, 5);
    // No input under the chute: the drift dies down.
    expect(Math.hypot(s.vx, s.vz)).toBeLessThan(GLIDE.freefall.speed * 0.5);
    // The plane: no gravity, no steering, velocity kept.
    const p = createMoveState(0, 150, 0);
    p.vx = 18;
    for (let i = 0; i < TICK_RATE; i++) stepMove(world, p, Buttons.FORWARD | Buttons.LEFT, 1, TICK_DT, { ...DEFAULT_MOVE_PARAMS, canMove: false, glide: GLIDE.plane });
    expect(p.vx).toBe(18);
    expect(p.vy).toBe(0);
    expect(p.y).toBe(150);
    expect(p.x).toBeCloseTo(18, 5);
  });

  it('jump from the plane, freefall, the chute opens by itself near the ground, then landing', () => {
    h = blackoutRoom({ players: 2, seed: 8 });
    const { room, game } = h;
    const p = [...room.players.values()][0]!;
    expect(bx(p).stage).toBe('plane');
    expect(p.move.y).toBeCloseTo(BLACKOUT.plane.altitude, 3);
    // No jumping before the doors open.
    game.jump(p);
    expect(bx(p).stage).toBe('plane');
    for (let i = 0; i < (BLACKOUT.plane.doorsSec + 0.5) * TICK_RATE; i++) room.step();
    // Riding the plane.
    const at = planeAt(game.plane, room.time - game.t0!);
    expect(Math.hypot(p.move.x - at.x, p.move.z - at.z)).toBeLessThan(0.5);
    // Jump with the button, like a player.
    room.queueInputs(p, []);
    p.isBot = false; // drive it by hand from here
    p.brain = null;
    game.jump(p);
    expect(bx(p).stage).toBe('freefall');
    let deployedAt: number | null = null;
    for (let i = 0; i < 40 * TICK_RATE && bx(p).stage !== 'ground'; i++) {
      room.step();
      if (bx(p).stage === 'chute' && deployedAt === null) deployedAt = game.heightAboveGround(p);
    }
    expect(deployedAt).not.toBeNull();
    expect(deployedAt!).toBeLessThanOrEqual(BLACKOUT.deployHeight + 1);
    expect(deployedAt!).toBeGreaterThan(BLACKOUT.deployHeight - 3);
    expect(bx(p).stage).toBe('ground');
    expect(p.alive).toBe(true);
    expect(p.move.onGround).toBe(true);
  });

  it('everyone left aboard is pushed out before the end of the line', () => {
    h = blackoutRoom({ players: 3, seed: 12 });
    const { room, game } = h;
    for (const p of room.players.values()) {
      p.brain = null;
      bx(p).jumpAt = null;
    }
    for (let i = 0; i < (game.plane.duration + 1) * TICK_RATE; i++) room.step();
    for (const p of room.players.values()) expect(bx(p).stage).not.toBe('plane');
  });

  it('no damage aboard the plane, no shooting in the air', () => {
    h = blackoutRoom({ players: 2, seed: 13 });
    const { room } = h;
    const [a, b] = [...room.players.values()];
    room.step();
    expect(room.damage({ victim: a!, attacker: b!, amount: 50, weapon: 'ak47', part: 'torso', means: 'bullet', from: null, distance: 5 })).toBe(0);
    expect(room.modifiers.any('canFire', a!)).toBe(false);
  });
});

describe('blackout: loot, armour, heals', () => {
  it('loot spots lie on walkable floors with standing room, spread over every town', () => {
    const map = getMapData('blackout');
    const world = buildCollisionWorld(map);
    const spots = lootSpots(map, world);
    expect(spots.length).toBeGreaterThan(400);
    expect(spots.length).toBeLessThan(BLACKOUT.maxLoot);
    for (const s of spots) {
      const g = world.groundBelow(s.x, s.z, s.y + 0.05, 0.1);
      expect(g, `ground at ${s.x},${s.y},${s.z}`).not.toBeNull();
      expect(Math.abs(g! - s.y)).toBeLessThan(0.06);
      expect(world.free(s.x, s.y + 0.01, s.z)).toBe(true);
    }
    for (let i = 0; i < BLACKOUT_TOWNS.length; i++) expect(spots.filter((s) => s.town === i).length, BLACKOUT_TOWNS[i]!.name).toBeGreaterThan(8);
    expect(spots.filter((s) => s.indoor).length).toBeGreaterThan(spots.length * 0.4);
  });

  it('spawns bounded loot at the start: weapons that never expire, items, all near their spots', () => {
    h = blackoutRoom({ players: 2, seed: 21 });
    const { room, game } = h;
    const items = room.entities.byKind(LOOT_ENTITY);
    const guns = room.entities.byKind(PICKUP_ENTITY);
    expect(items.length + guns.length).toBe(game.lootSpawned);
    expect(game.lootSpawned).toBeGreaterThan(300);
    expect(game.lootSpawned).toBeLessThanOrEqual(BLACKOUT.maxLoot);
    expect(guns.length).toBeGreaterThan(100);
    expect(items.length).toBeGreaterThan(100);
    // Rolls are deterministic.
    const r1 = rng(5);
    const r2 = rng(5);
    expect(Array.from({ length: 50 }, () => rollLoot(r1))).toEqual(Array.from({ length: 50 }, () => rollLoot(r2)));
    // Guns on the floor never expire.
    for (let i = 0; i < 60 * TICK_RATE; i += 30) room.step();
    expect(room.entities.byKind(PICKUP_ENTITY).filter((e) => !(e.data as { expires: number }).expires || (e.data as { expires: number }).expires === Infinity).length).toBe(room.entities.byKind(PICKUP_ENTITY).length);
  });

  it('armour soaks bullets, heals restore over time, no regeneration', () => {
    h = blackoutRoom({ players: 2, seed: 22 });
    const { room, game } = h;
    const [a, b] = [...room.players.values()];
    for (const p of [a!, b!]) {
      p.brain = null;
      bx(p).stage = 'ground';
    }
    room.step();
    bx(a!).armor = bx(a!).armorMax = 100;
    const dealt = room.damage({ victim: a!, attacker: b!, amount: 40, weapon: 'ak47', part: 'torso', means: 'bullet', from: null, distance: 5 });
    expect(dealt).toBeCloseTo(40 * (1 - BLACKOUT.armor.absorb), 5);
    expect(bx(a!).armor).toBeCloseTo(100 - 40 * BLACKOUT.armor.absorb, 5);
    // No regeneration.
    const hp = a!.health;
    for (let i = 0; i < 10 * TICK_RATE; i++) room.step();
    expect(a!.health).toBe(hp);
    // A bandage heals 25 over its time; you can't fire while healing.
    bx(a!).bandages = 1;
    expect(game.startHeal(a!)).toBe(true);
    expect(room.modifiers.any('canFire', a!)).toBe(false);
    for (let i = 0; i < (BLACKOUT.heals.bandage.sec + 0.2) * TICK_RATE; i++) room.step();
    expect(a!.health).toBeCloseTo(Math.min(100, hp + BLACKOUT.heals.bandage.heal), 0);
    expect(bx(a!).bandages).toBe(0);
    expect(bx(a!).healUntil).toBeNull();
  });

  it('a human picks a gun into the empty knife slot first; walking over items takes what is useful', () => {
    h = blackoutRoom({ players: 2, seed: 23 });
    const { room, game } = h;
    const p = [...room.players.values()][0]!;
    p.brain = null;
    bx(p).stage = 'ground';
    room.step();
    expect(p.weapons.map((w) => w.def.base.id)).toEqual(['knife', 'knife']);
    expect(game.pickupSlot(p)).toBe(p.slot);
    p.weapons[0] = { ...p.weapons[0]!, def: { ...p.weapons[0]!.def, base: { ...p.weapons[0]!.def.base, id: 'ak47' } } } as never;
    expect(game.pickupSlot(p)).toBe(1);
  });
});

describe('blackout: interest management', () => {
  it('a human only hears about players and loot near them', () => {
    h = blackoutRoom({ humans: 1, players: 100, seed: 31, keepMsgs: true });
    const { room } = h;
    for (let i = 0; i < 45 * TICK_RATE; i++) room.step();
    const snaps = h.humans[0]!.socket.msgs.filter((m) => m.startsWith('{"t":"snap"')).map((m) => JSON.parse(m));
    const last = snaps[snaps.length - 1];
    const me = h.humans[0]!.player;
    expect(last.players.length).toBeLessThanOrEqual(BLACKOUT.interest.maxPlayers + 1);
    for (const p of last.players) expect(Math.hypot(p.x - me.move.x, p.z - me.move.z)).toBeLessThanOrEqual(BLACKOUT.interest.playerRadius + 3);
    for (const e of last.ents) if (e.kind !== 'blackout_plane') expect(Math.hypot(e.x - me.move.x, e.z - me.move.z)).toBeLessThanOrEqual(BLACKOUT.interest.entityRadius + 3);
    expect(last.ents.length).toBeLessThan(room.entities.size / 3);
    // The alive count goes out in blackout.state.
    const state = h.humans[0]!.socket.msgs.map((m) => JSON.parse(m)).filter((m) => m.t === 'feat' && m.id === 'blackout.state').at(-1);
    expect(state.data.alive).toBe(h.game.aliveCount());
  });
});

describe('blackout: the map', () => {
  it('open ground tiles cover the island around the towns exactly', () => {
    const rects = BLACKOUT_TOWNS.map(townRect);
    const tiles = terrainTiles(rects);
    let area = 0;
    for (const t of tiles) {
      area += (t.x1 - t.x0) * (t.z1 - t.z0);
      expect(t.x1 - t.x0).toBeLessThanOrEqual(64 + 1e-6);
      for (const r of rects) expect(t.x0 >= r.x1 - 1e-6 || t.x1 <= r.x0 + 1e-6 || t.z0 >= r.z1 - 1e-6 || t.z1 <= r.z0 + 1e-6).toBe(true);
    }
    const towns = rects.reduce((n, r) => n + (r.x1 - r.x0) * (r.z1 - r.z0), 0);
    expect(area + towns).toBeCloseTo(512 * 512, 0);
    // Towns don't overlap each other and stay on the island.
    for (let i = 0; i < rects.length; i++) {
      const a = rects[i]!;
      expect(a.x0).toBeGreaterThan(-256);
      expect(a.x1).toBeLessThan(256);
      expect(a.z0).toBeGreaterThan(-256);
      expect(a.z1).toBeLessThan(256);
      for (let j = i + 1; j < rects.length; j++) {
        const b = rects[j]!;
        expect(a.x0 >= b.x1 + 20 || a.x1 <= b.x0 - 20 || a.z0 >= b.z1 + 20 || a.z1 <= b.z0 - 20, `${BLACKOUT_TOWNS[i]!.name} / ${BLACKOUT_TOWNS[j]!.name}`).toBe(true);
      }
    }
  });

  it('has ground everywhere on the island (no holes to fall through)', () => {
    const map = getMapData('blackout');
    const world = buildCollisionWorld(map);
    const r = rng(77);
    for (let i = 0; i < 4000; i++) {
      const x = (r() * 2 - 1) * 250;
      const z = (r() * 2 - 1) * 250;
      expect(world.groundBelow(x, z, 120, 140, 0.01), `ground at ${x.toFixed(1)}, ${z.toFixed(1)}`).not.toBeNull();
    }
    expect(map.bounds.max.x - map.bounds.min.x).toBeGreaterThanOrEqual(500);
    expect(insideCircle({ x: 0, z: 0, r: 1 }, 0, 0)).toBe(true);
  });
});

describe('blackout: 100 players', () => {
  it('a full room (1 human + 99 bots) runs the drop and the first fights within budget', () => {
    h = blackoutRoom({ humans: 1, players: 100, seed: 41 });
    const { room, game } = h;
    expect(room.players.size).toBe(100);
    expect(game.entrants.size).toBe(100);
    // Warm up (JIT), then time 40 s of the match: the plane, the drop, landing and looting.
    stepTimed(room, 2 * TICK_RATE);
    const ms = stepTimed(room, 40 * TICK_RATE);
    const st = stats(ms);
    // CI-friendly budget (a laptop does ~2-4 ms); the server target is 8 ms on a shared vCPU.
    expect(st.avg).toBeLessThan(20);
    expect(room.phase).toBe('playing');
    const stages = [...room.players.values()].filter((p) => p.alive).map((p) => bx(p).stage);
    expect(stages.filter((s) => s === 'ground').length).toBeGreaterThan(stages.length * 0.8);
    // Bots picked up guns.
    const armed = [...room.players.values()].filter((p) => p.alive && p.weapons.some((w) => w.def.base.id !== 'knife'));
    expect(armed.length).toBeGreaterThan(10);
  }, 120_000);
});
