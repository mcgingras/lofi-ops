/**
 * Zombies through the real server and real sockets: one click solo (`zombies.solo` starts its own
 * lobby), the state push (round 1, 500 points, the M1911), the round-start event, zombies in the
 * roster on team 1, points for a shot over the wire (+10 / +60 popups), a wall-buy by holding USE,
 * and game over with the results (`results.ext.zombies.round`); solo's default bot partner.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { zombiesGameOf } from '../src/server/features/zombies/index';
import { survivorOf, undeadOf } from '../src/server/features/zombies/state';
import { eyeHeight } from '../src/shared/movement';
import type { ZombiesEventPayload, ZombiesStatePayload } from '../src/shared/defs/zombies';
import { Buttons } from '../src/shared/input';
import { createMoveState } from '../src/shared/movement';
import { FakeClient, sleep } from './fake-client';

const feat = <T>(c: FakeClient, id: string, pred: (d: T) => boolean = () => true, timeoutMs = 10000) =>
  c.waitFor('feat', (m) => m.id === id && pred(m.data as T), timeoutMs).then(
    (m) => m.data as T,
    (err: Error) => {
      throw new Error(`${err.message}: ${id} (${pred.toString().slice(0, 120)})`);
    },
  );

describe('Zombies over real sockets', () => {
  let server: GameServer;
  const clients: FakeClient[] = [];
  beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
  });
  afterAll(async () => {
    for (const c of clients) c.close();
    await server.close();
  });

  it('solo in one click: rounds, points over the wire, a wall-buy, game over and results', async () => {
    const { client: a, welcome } = await FakeClient.connect(server.url, 'Solo');
    clients.push(a);
    a.send({ t: 'rpc', id: 'zombies.solo', data: { map: 'nuketown', allies: 0 }, rid: 1 });
    const res = await a.waitFor('rpcResult', (m) => m.rid === 1);
    expect(res.ok).toBe(true);
    const roomId = (res.data as { roomId: string }).roomId;
    a.send({ t: 'joinRoom', roomId });
    const joined = await a.waitFor('joined');
    expect(joined.mode).toBe('zombies');
    expect(joined.map).toBe('nuketown');
    // The lobby counts down on its own and the game starts.
    const st = await feat<ZombiesStatePayload>(a, 'zombies.state', (s) => s.players.length === 1 && s.phase !== 'over', 20000);
    expect(st.players[0]!.points).toBe(500);
    const spawned = await a.waitFor('spawned', () => true, 20000);
    expect(spawned).toBeTruthy();
    const room = server.lobby.get(roomId)!;
    const g = zombiesGameOf(room)!;
    const me = room.players.get(welcome.sessionId)!;
    expect(me.weapons.map((w) => w.def.base.id)).toEqual(['m1911']);
    room.modifiers.add('damageTaken', (v) => (v === me ? 0 : undefined), 'test.god');
    g.phaseEndsAt = room.time;
    const rs = await feat<ZombiesEventPayload>(a, 'zombies.event', (e) => e.kind === 'round_start');
    expect(rs.round).toBe(1);
    await a.waitFor('roster', (r) => r.players.some((p) => p.bot && p.team === 1), 10000);

    // A zombie right in front of me: shoot it over the wire (+10 a hit, then the kill).
    g.queue = 0;
    for (const z of g.aliveUndead()) room.kill(z, null, { weapon: 'nuke', means: 'explosive' });
    expect(g.spawnOne('zombie')).toBe(true);
    const z = g.aliveUndead().at(-1)!;
    g.horde.frozen = true;
    z.move = { ...createMoveState(me.move.x, me.move.y, me.move.z - 3), onGround: true };
    z.health = z.maxHealth = 1000;
    const eye = { x: me.move.x, y: me.move.y + eyeHeight(me.move), z: me.move.z };
    const aim = { x: 0, y: (z.move.y + 1.2 - eye.y) / 3, z: -1 };
    const l = Math.hypot(aim.x, aim.y, aim.z);
    await sleep(300);
    const seq = a.input(0, 0, Math.atan2(aim.y, 1), 3);
    a.send({ t: 'fire', seq, time: room.time, origin: [eye.x, eye.y, eye.z], dir: [aim.x / l, aim.y / l, aim.z / l], shot: 1 });
    const pop = await feat<ZombiesEventPayload>(a, 'zombies.event', (e) => e.kind === 'points' && e.amount === 10);
    expect(pop.player).toBe(welcome.sessionId);
    expect(z.health).toBeLessThan(1000);
    z.health = 1;
    await sleep(200);
    const seq2 = a.input(0, 0, Math.atan2(aim.y, 1), 3);
    a.send({ t: 'fire', seq: seq2, time: room.time, origin: [eye.x, eye.y, eye.z], dir: [aim.x / l, aim.y / l, aim.z / l], shot: 2 });
    const kill = await feat<ZombiesEventPayload>(a, 'zombies.event', (e) => e.kind === 'points' && (e.amount ?? 0) >= 50);
    expect([50, 60, 100]).toContain(kill.amount);
    expect(survivorOf(me)!.kills).toBe(1);
    expect(undeadOf(z)).not.toBeNull();
    g.horde.frozen = false;

    // Hold USE at the Olympia's chalk.
    survivorOf(me)!.points = 1000;
    const wall = g.buy.walls.find((w) => w.spot.weapon === 'olympia')!;
    const f = { x: -Math.sin(wall.spot.yaw), z: -Math.cos(wall.spot.yaw) };
    me.move = { ...createMoveState(wall.spot.x + f.x, wall.spot.y, wall.spot.z + f.z), onGround: true };
    for (let i = 0; i < 12; i++) {
      a.input(Buttons.USE, wall.spot.yaw + Math.PI, 0, 3);
      await sleep(30);
    }
    const buy = await feat<ZombiesEventPayload>(a, 'zombies.event', (e) => e.kind === 'buy');
    expect(buy.id).toBe('olympia');
    expect(me.weapons.map((w) => w.def.base.id)).toContain('olympia');
    const st2 = await feat<ZombiesStatePayload>(a, 'zombies.state', (s) => s.players[0]!.points === 500 && s.players[0]!.kills === 1);
    expect(st2.round).toBeGreaterThanOrEqual(1);

    // Down without Quick Revive: game over, then the results.
    room.modifiers.add('damageTaken', () => undefined, 'test.god');
    room.damage({ victim: me, attacker: z.alive ? z : (g.spawnOne('zombie'), g.aliveUndead()[0]!), amount: 500, weapon: 'zombie', part: 'torso', means: 'melee', from: null, distance: 1 });
    const over = await feat<ZombiesEventPayload>(a, 'zombies.event', (e) => e.kind === 'game_over');
    expect(over.round).toBe(g.survived);
    const end = await a.waitFor('matchEnd', () => true, 15000);
    const ext = end.results.ext.zombies as { round: number; players: { id: string; kills: number }[] };
    expect(ext.round).toBe(g.survived);
    expect(ext.players[0]).toMatchObject({ id: welcome.sessionId, kills: 1 });
    expect(end.results.players.every((p) => !p.bot)).toBe(true);
    const prof = await a.waitFor('profile', () => true, 5000);
    expect(prof.profile.stats['zombies.bestRound']).toBe(g.survived);
  }, 60000);

  it('solo plays with a bot partner by default: two survivors in the state, the ally flagged', async () => {
    const { client: a, welcome } = await FakeClient.connect(server.url, 'Duo');
    clients.push(a);
    a.send({ t: 'rpc', id: 'zombies.solo', data: { map: 'nuketown' }, rid: 2 });
    const res = await a.waitFor('rpcResult', (m) => m.rid === 2);
    expect(res.ok).toBe(true);
    a.send({ t: 'joinRoom', roomId: (res.data as { roomId: string }).roomId });
    await a.waitFor('joined');
    const st = await feat<ZombiesStatePayload>(a, 'zombies.state', (s) => s.players.length === 2, 20000);
    const ally = st.players.find((p) => p.id !== welcome.sessionId)!;
    expect(ally.bot).toBe(true);
    expect(ally.points).toBe(500);
    expect(st.solo).toBe(false);
    expect(st.players.find((p) => p.id === welcome.sessionId)!.bot).toBeUndefined();
  }, 30000);
});
