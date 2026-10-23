/**
 * Zombies difficulty: Casual (the default) and Classic (BO1). The tuning table's numbers, then real
 * rooms: round health and size (solo and with AI partners), M1911 shots to kill a zombie bot in
 * Casual rounds 1-3, swipes to down you, hellhound rounds, bleed-out, the state / results label,
 * and the RPCs carrying the choice to the server.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { setZombiesAllies, zombiesDifficultyOf, type ZombiesGame } from '../src/server/features/zombies/game';
import { zombiesGameOf } from '../src/server/features/zombies/index';
import { survivorOf, undeadOf } from '../src/server/features/zombies/state';
import { eyeHeight } from '../src/shared/movement';
import { DOGS, dogHealth, dogHealthAt, dogsForRound, dogsForRoundAt, swipesToDown, ZOMBIES, ZOMBIES_DIFFICULTY, zombieBulletDamage, zombieHeadCenter, zombieHealth, zombieHealthFor, zombiePose, zombiesDifficulty, zombiesForRound, zombiesForRoundAt, type ZombiesDifficulty } from '../src/shared/defs/zombies';
import { FakeClient } from './fake-client';
import { arm, human, place, startRound, steps, stepUntil, zmClose, zmRoom, type ZmWorld } from './zombies-helpers';

let w: ZmWorld | undefined;
afterEach(() => {
  zmClose(w);
  w = undefined;
});

const ROUNDS = Array.from({ length: 14 }, (_, i) => i + 1);

describe('the tuning table', () => {
  it('zombie health: Casual 100 ... 900 for rounds 1-8, then BO1 from round 9; Classic is BO1', () => {
    expect(ROUNDS.slice(0, 8).map((r) => zombieHealthFor(r, 'casual'))).toEqual([100, 140, 220, 330, 450, 600, 750, 900]);
    expect(zombieHealthFor(9, 'casual')).toBe(950);
    expect(zombieHealthFor(10, 'casual')).toBe(1045);
    for (const r of [9, 10, 11, 15, 30]) expect(zombieHealthFor(r, 'casual')).toBe(zombieHealth(r));
    // The curve only climbs (it joins BO1 without a step back).
    for (const r of ROUNDS.slice(1)) expect(zombieHealthFor(r, 'casual')).toBeGreaterThan(zombieHealthFor(r - 1, 'casual'));
    expect(ROUNDS.map((r) => zombieHealthFor(r, 'classic'))).toEqual(ROUNDS.map(zombieHealth));
    expect(zombieHealthFor(1, 'classic')).toBe(150);
  });

  it('round size: Casual x0.6 to round 5, ramping to BO1 by 12; partners never count in Casual, always in Classic', () => {
    // Solo (with or without partners in Casual).
    expect(ROUNDS.map((r) => zombiesForRoundAt(r, 1, 0, 'casual'))).toEqual([4, 5, 8, 11, 14, 18, 20, 22, 24, 29, 32, 36, 39, 41]);
    for (const r of ROUNDS) {
      expect(zombiesForRoundAt(r, 1, 1, 'casual'), `r${r}`).toBe(zombiesForRoundAt(r, 1, 0, 'casual'));
      expect(zombiesForRoundAt(r, 1, 3, 'casual'), `r${r}`).toBe(zombiesForRoundAt(r, 1, 0, 'casual'));
      if (r <= 5) expect(zombiesForRoundAt(r, 1, 0, 'casual')).toBe(Math.round(zombiesForRound(r, 1) * 0.6));
      if (r >= 12) expect(zombiesForRoundAt(r, 1, 0, 'casual')).toBe(zombiesForRound(r, 1));
      // Classic: BO1, partners count as players.
      expect(zombiesForRoundAt(r, 1, 0, 'classic')).toBe(zombiesForRound(r, 1));
      expect(zombiesForRoundAt(r, 1, 1, 'classic')).toBe(zombiesForRound(r, 2));
      expect(zombiesForRoundAt(r, 2, 2, 'classic')).toBe(zombiesForRound(r, 4));
      // Fewer in Casual until it joins.
      expect(zombiesForRoundAt(r, 1, 1, 'casual')).toBeLessThanOrEqual(zombiesForRoundAt(r, 1, 1, 'classic'));
    }
    // Four humans in Casual: round 1 is 6 (BO1 10).
    expect(zombiesForRoundAt(1, 4, 0, 'casual')).toBe(6);
    expect(zombiesForRoundAt(1, 4, 0, 'classic')).toBe(10);
  });

  it('swipes: Casual 34 every 1.3 s (3 hits, 8 with Juggernog), Classic 50 every 1.1 s (2, 5); bleed-out 45 / 30 s', () => {
    expect(swipesToDown(100, 'casual')).toBe(3);
    expect(swipesToDown(ZOMBIES.jugHealth, 'casual')).toBe(8);
    expect(swipesToDown(100, 'classic')).toBe(2);
    expect(swipesToDown(ZOMBIES.jugHealth, 'classic')).toBe(5);
    expect(ZOMBIES_DIFFICULTY.casual.swipeEvery).toBe(1.3);
    expect(ZOMBIES_DIFFICULTY.classic.swipeEvery).toBe(ZOMBIES.swipeEvery);
    expect(ZOMBIES_DIFFICULTY.casual.bleedOutSec).toBe(45);
    expect(ZOMBIES_DIFFICULTY.classic.bleedOutSec).toBe(30);
  });

  it('M1911 in Casual: 40 x1.0, head x3.5 = 140, body x1.25 = 50; Classic keeps x0.5; other guns unchanged', () => {
    expect(zombieBulletDamage('m1911', 'head', 'casual')).toBeCloseTo(140, 6);
    expect(zombieBulletDamage('m1911', 'torso', 'casual')).toBeCloseTo(50, 6);
    expect(zombieBulletDamage('m1911', 'head', 'classic')).toBeCloseTo(70, 6);
    expect(zombieBulletDamage('m1911', 'torso', 'classic')).toBeCloseTo(25, 6);
    for (const id of ['mp5k', 'ak74u', 'm16a4', 'mpl', 'olympia', 'raygun']) for (const part of ['head', 'torso'] as const) expect(zombieBulletDamage(id, part, 'casual'), id).toBe(zombieBulletDamage(id, part, 'classic'));
    const shots = (id: string, part: 'head' | 'torso', r: number, d: ZombiesDifficulty) => Math.ceil(zombieHealthFor(r, d) / zombieBulletDamage(id, part, d) - 1e-9);
    // MP5K / AK-74u, rounds 1-5 (body / head): Casual 1/1 2/1 3/1 4/1 5/2, Classic 2/1 3/1 4/1 5/2 6/2.
    for (const id of ['mp5k', 'ak74u']) {
      expect([1, 2, 3, 4, 5].map((r) => `${shots(id, 'torso', r, 'casual')}/${shots(id, 'head', r, 'casual')}`), id).toEqual(['1/1', '2/1', '3/1', '4/1', '5/2']);
      expect([1, 2, 3, 4, 5].map((r) => `${shots(id, 'torso', r, 'classic')}/${shots(id, 'head', r, 'classic')}`), id).toEqual(['2/1', '3/1', '4/1', '5/2', '6/2']);
    }
  });

  it('hellhounds: Casual x0.6 dogs (humans only) at x0.75 health; Classic BO1', () => {
    expect([1, 2, 3, 4].map((n) => dogsForRoundAt(n, 1, 1, 'casual'))).toEqual([4, 4, 5, 5]);
    expect([1, 2, 3, 4].map((n) => dogsForRoundAt(n, 1, 1, 'classic'))).toEqual([1, 2, 3, 4].map((n) => dogsForRound(n, 2)));
    expect([1, 2, 3, 4].map((n) => dogHealthAt(n, 'casual'))).toEqual([300, 675, 975, 1200]);
    expect([1, 2, 3, 4].map((n) => dogHealthAt(n, 'classic'))).toEqual([1, 2, 3, 4].map(dogHealth));
  });

  it('unknown or missing difficulty means Casual', () => {
    expect(zombiesDifficulty(undefined)).toBe('casual');
    expect(zombiesDifficulty('nightmare')).toBe('casual');
    expect(zombiesDifficulty('classic')).toBe('classic');
  });
});

/** No zombies left or queued (nuked: not the failsafe, which re-queues them). */
function clear(g: ZombiesGame): void {
  g.queue = 0;
  for (const z of g.aliveUndead()) {
    undeadOf(z)!.nuked = true;
    g.room.kill(z, null, { weapon: 'test', means: 'world' });
  }
}

/** A room at `difficulty` with one human, `allies` partners, round 1 under way. */
function game(difficulty: ZombiesDifficulty | undefined, allies = 0) {
  w = zmRoom('nuketown', difficulty);
  setZombiesAllies(w.room, allies, 'regular');
  const h = human(w.room);
  startRound(w);
  return { room: w.room, g: w.g, h };
}

describe('a real room', () => {
  it('defaults to Casual and says so in the state', () => {
    const { g } = game(undefined);
    expect(g.difficulty).toBe('casual');
    expect(g.state().difficulty).toBe('casual');
  });

  for (const d of ['casual', 'classic'] as const) {
    for (const allies of [0, 1, 3]) {
      it(`${d}, solo with ${allies} partner(s): round sizes and health for rounds 1-3`, () => {
        const { room, g } = game(d, allies);
        expect(g.survivors().length).toBe(1 + allies);
        for (const r of [1, 2, 3]) {
          if (r > 1) {
            clear(g);
            g.nextDog = 99;
            steps(room, 0.2);
            g.phaseEndsAt = room.time;
            steps(room, 0.1);
          }
          expect(g.round).toBe(r);
          expect(g.queue + g.aliveUndead().length, `${d} r${r}`).toBe(zombiesForRoundAt(r, 1, allies, d));
          expect(g.spawnOne('zombie')).toBe(true);
          expect(g.aliveUndead().at(-1)!.maxHealth).toBe(zombieHealthFor(r, d));
        }
      });
    }
  }

  it('Casual: partners do not grow the round (Classic: they do)', () => {
    const casual = game('casual', 1).g;
    expect(casual.queue + casual.aliveUndead().length).toBe(4);
    zmClose(w);
    const classic = game('classic', 1).g;
    expect(classic.queue + classic.aliveUndead().length).toBe(zombiesForRound(1, 2));
  });

  /** Fire the M1911 at a zombie bot at `r`'s health until it dies; returns the shots. */
  function m1911Shots(d: ZombiesDifficulty, r: number, part: 'head' | 'torso'): number {
    const { room, g, h } = game(d);
    clear(g);
    g.round = r;
    expect(g.spawnOne('zombie')).toBe(true);
    const z = g.aliveUndead().at(-1)!;
    g.horde.frozen = true;
    room.modifiers.add('spreadMultiplier', () => 0, 'test.nospread');
    place(room, h, 8, 22, 0);
    place(room, z, 8, 14, 0);
    z.yaw = Math.PI;
    expect(z.health).toBe(zombieHealthFor(r, d));
    arm(room, h, 'm1911');
    const at = part === 'head' ? zombieHeadCenter(zombiePose(0, 1.3)) : { x: 0, y: 1.2, z: 0 };
    // Zombie facing the shooter: body frame right = -world x, ahead = +world z.
    const target = { x: z.move.x - at.x, y: z.move.y + at.y, z: z.move.z + at.z };
    let n = 0;
    while (z.alive && n < 20) {
      const eye = { x: h.move.x, y: h.move.y + eyeHeight(h.move), z: h.move.z };
      const dv = { x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z };
      const l = Math.hypot(dv.x, dv.y, dv.z);
      for (const wpn of h.weapons) {
        wpn.credit = 2;
        wpn.mag = 8;
      }
      expect(room.fire(h, { dir: { x: dv.x / l, y: dv.y / l, z: dv.z / l }, origin: eye, shot: 100 + n }).ok).toBe(true);
      n++;
    }
    zmClose(w);
    w = undefined;
    return n;
  }

  it('Casual M1911 vs a zombie bot: round 1 head 1 / body 2, round 2 head 1 / body 3, round 3 head 2 / body 5', () => {
    const got = [1, 2, 3].map((r) => `${m1911Shots('casual', r, 'head')}/${m1911Shots('casual', r, 'torso')}`);
    expect(got).toEqual(['1/2', '1/3', '2/5']);
  });

  it('Classic M1911 is unchanged: round 1 head 3 / body 6', () => {
    expect(m1911Shots('classic', 1, 'head')).toBe(3);
    expect(m1911Shots('classic', 1, 'torso')).toBe(6);
  });

  /** A zombie swiping a survivor (with Quick Revive, so the down is a down): swipes and seconds until down. */
  function swipesUntilDown(d: ZombiesDifficulty, jug = false): { swipes: number; gaps: number[] } {
    const { room, g, h } = game(d);
    clear(g);
    steps(room, 3);
    survivorOf(h)!.perks.push('revive');
    if (jug) g.givePerk(h, 'jugg');
    h.health = h.maxHealth;
    place(room, h, 8, 14.9, 0);
    expect(g.spawnOne('zombie')).toBe(true);
    const z = g.aliveUndead().at(-1)!;
    place(room, z, 8, 14, 0);
    // Out of the ground already.
    const ext = z.ext.zombies as { spawnedAt: number };
    ext.spawnedAt = room.time - 10;
    const at: number[] = [];
    room.bus.on('damage', (e) => {
      if (e.victim === h && e.attacker === z) at.push(room.time);
    });
    room.bus.on('beforeDamage', (e) => {
      if (e.victim === h && e.attacker === z && e.amount >= h.health) at.push(room.time);
    }, { priority: 100 });
    const t = stepUntil(room, 30, () => g.isDown(h), () => place(room, z, 8, 14, 0));
    expect(t, `${d} never went down`).not.toBeNull();
    const gaps = at.slice(1).map((v, i) => v - at[i]!);
    return { swipes: at.length, gaps };
  }

  it('Casual: three swipes down you (eight with Juggernog), 1.3 s apart; Classic: two (five), 1.1 s apart', () => {
    const c = swipesUntilDown('casual');
    expect(c.swipes).toBe(3);
    for (const gap of c.gaps) expect(gap).toBeCloseTo(1.3, 1);
    expect(swipesUntilDown('casual', true).swipes).toBe(8);
    const b = swipesUntilDown('classic');
    expect(b.swipes).toBe(2);
    for (const gap of b.gaps) expect(gap).toBeCloseTo(1.1, 1);
    expect(swipesUntilDown('classic', true).swipes).toBe(5);
  });

  it('hellhound rounds: Casual 4 dogs at 300 for solo with a partner, Classic 12 at 400', () => {
    for (const [d, count, hp] of [['casual', 4, 300], ['classic', 12, 400]] as const) {
      const { room, g, h } = game(d, 1);
      h.maxHealth = h.health = 1e9;
      clear(g);
      g.nextDog = 2;
      steps(room, 0.2);
      g.phaseEndsAt = room.time;
      steps(room, 0.1);
      expect(g.dogRound).toBe(true);
      expect(g.queue, d).toBe(count);
      expect(g.spawnOne('dog')).toBe(true);
      expect(g.aliveUndead().at(-1)!.maxHealth).toBe(hp);
      steps(room, DOGS.introSec + 1);
      zmClose(w);
      w = undefined;
    }
  });

  it('co-op bleed-out: 45 s in Casual, 30 s in Classic', () => {
    for (const [d, sec] of [['casual', 45], ['classic', 30]] as const) {
      const { room, g, h } = game(d);
      const b = human(room);
      clear(g);
      g.phase = 'break';
      g.phaseEndsAt = room.time + 1000;
      steps(room, 0.2);
      expect(b.alive).toBe(true);
      g.goDown(h, null, 'test', 'melee');
      const ls = h.ext.perks!.lastStand!;
      expect(ls.until - room.time).toBeCloseTo(sec, 1);
      zmClose(w);
      w = undefined;
    }
  });

  it('results carry the difficulty (the results screen shows it)', () => {
    const { g } = game('classic');
    expect(g.results('score').ext.zombies).toMatchObject({ difficulty: 'classic' });
    expect(g.state().difficulty).toBe('classic');
  });
});

describe('the choice reaches the server', () => {
  let server: GameServer;
  const clients: FakeClient[] = [];
  beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
  });
  afterAll(async () => {
    for (const c of clients) c.close();
    await server.close();
  });

  const call = async (id: string, data: unknown, rid: number) => {
    const { client } = await FakeClient.connect(server.url, `P${rid}`);
    clients.push(client);
    client.send({ t: 'rpc', id, data, rid } as never);
    const res = await client.waitFor('rpcResult', (m) => m.rid === rid);
    expect(res.ok).toBe(true);
    return server.lobby.get((res.data as { roomId: string }).roomId)!;
  };

  it('zombies.solo and zombies.coop take the difficulty; Casual when not given', async () => {
    const solo = await call('zombies.solo', { map: 'nuketown', allies: 0, difficulty: 'classic' }, 1);
    expect(zombiesDifficultyOf(solo)).toBe('classic');
    expect(zombiesGameOf(solo)!.difficulty).toBe('classic');
    const coop = await call('zombies.coop', { map: 'nuketown', difficulty: 'classic' }, 2);
    expect(zombiesGameOf(coop)!.difficulty).toBe('classic');
    const plain = await call('zombies.coop', { map: 'nuketown' }, 3);
    expect(zombiesGameOf(plain)!.difficulty).toBe('casual');
    const casual = await call('zombies.solo', { map: 'nuketown', difficulty: 'casual' }, 4);
    expect(zombiesGameOf(casual)!.difficulty).toBe('casual');
  });
});
