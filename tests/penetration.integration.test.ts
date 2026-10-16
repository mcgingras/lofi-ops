/**
 * Bullet penetration through the real server and sockets, on a real map: a player kills a bot
 * through the wall of a Nuketown house (`sidingW`, 25 cm of wood siding) with an AK-47. The shots
 * are lag compensated (`fire` with the client's view time); hits and the killfeed carry `pen`, the
 * snapshot's shot carries the wall's entry and exit points, and a bot standing there never fires
 * back through the wall.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { makeWeapon } from '../src/server/player';
import { WEAPON_BY_ID } from '../src/shared/defs/weapons';
import { Buttons } from '../src/shared/input';
import { yawTo } from '../src/shared/math';
import { createMoveState } from '../src/shared/movement';
import { PLAYER } from '../src/shared/constants';
import { FakeClient, sleep } from './fake-client';

/** Either side of Nuketown's house wall brush 140 (`sidingW`, 25 cm thick, x = -19.8 .. -19.55). */
const INSIDE = { x: -22.675, y: 0, z: -0.375 };
const OUTSIDE = { x: -16.675, y: 0, z: -0.375 };
const WALL_SOURCE = 140;

let server: GameServer;
const clients: FakeClient[] = [];
let rid = 0;

beforeAll(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
});
afterAll(async () => {
  for (const c of clients) c.close();
  await server.close();
});

describe('penetration over the wire (Nuketown)', () => {
  it('a player kills a bot through a house wall: reduced damage, pen on the hits and the killfeed, wall points in the snapshot', async () => {
    const { client: a, welcome } = await FakeClient.connect(server.url, 'Wallbanger');
    clients.push(a);
    a.send({ t: 'rpc', id: 'bots.playWithBots', data: { mode: 'tdm', map: 'nuketown', difficulty: 'recruit', targetPlayers: 2 }, rid: ++rid });
    const made = await a.waitFor('rpcResult', (m) => m.rid === rid);
    expect(made.ok).toBe(true);
    const roomId = (made.data as { roomId: string }).roomId;
    a.send({ t: 'joinRoom', roomId });
    const joined = await a.waitFor('joined');
    expect(joined.map).toBe('nuketown');
    const room = server.lobby.get(roomId)!;
    const wall = room.world.solids.find((s) => s.source === WALL_SOURCE)!;
    expect({ mat: wall.mat, bullets: wall.bullets, thick: Math.round((wall.max.x - wall.min.x) * 100) }).toEqual({ mat: 'sidingW', bullets: true, thick: 25 });

    const shooter = room.players.get(welcome.sessionId)!;
    const enemyBot = () => [...room.players.values()].find((p) => p.isBot && p.alive && room.isEnemy(shooter, p));
    await a.waitFor('snap', () => !!enemyBot() && shooter.alive, 8000);
    const bot = enemyBot()!;
    // Every bot idles (nobody else shoots); the enemy stands outside the house, the player inside.
    for (const p of room.players.values()) if (p.isBot) p.brain = { think: () => null };
    bot.move = { ...createMoveState(OUTSIDE.x, OUTSIDE.y, OUTSIDE.z), onGround: true };
    bot.yaw = yawTo(OUTSIDE, INSIDE);
    shooter.move = { ...createMoveState(INSIDE.x, INSIDE.y, INSIDE.z), onGround: true };
    shooter.weapons[0] = makeWeapon({ weapon: 'ak47', attachments: [], camo: 'none' }, 'ak47');
    shooter.slot = 0;
    shooter.reloadEnd = 0;
    const botFired = { n: 0 };
    room.bus.on('fire', (e) => e.player === bot && botFired.n++);
    const walls: number[][] = [];
    room.bus.on('fire', (e) => e.player === shooter && e.hits.length > 0 && walls.push((e.walls ?? []).map((v) => Math.round(v.x * 100) / 100)));
    const dealt: { amount: number; penetrated: boolean }[] = [];
    room.bus.on('damage', (e) => e.victim === bot && e.attacker === shooter && dealt.push({ amount: e.amount, penetrated: !!e.penetrated }));

    const eye = { x: INSIDE.x, y: PLAYER.eye, z: INSIDE.z };
    const chest = { x: OUTSIDE.x, y: 1.15, z: OUTSIDE.z };
    const d = { x: chest.x - eye.x, y: chest.y - eye.y, z: chest.z - eye.z };
    const l = Math.hypot(d.x, d.y, d.z);
    const dir: [number, number, number] = [d.x / l, d.y / l, d.z / l];
    const yaw = yawTo(INSIDE, OUTSIDE);
    const pitch = Math.asin(dir[1]);
    // Aim down sights while the lag-compensation history fills with the new positions.
    for (let i = 0; i < 12; i++) {
      a.input(Buttons.ADS, yaw, pitch);
      bot.move = { ...createMoveState(OUTSIDE.x, OUTSIDE.y, OUTSIDE.z), onGround: true };
      await sleep(50);
    }
    await a.waitFor('snap', (s) => s.ack >= a.seq && (s.me?.move.ads ?? 0) >= 1);

    let shot = 0;
    for (let i = 0; i < 30 && bot.alive; i++) {
      const seq = a.input(Buttons.ADS | Buttons.FIRE, yaw, pitch);
      const viewTime = (a.last('snap')?.time ?? room.time) - 0.1;
      a.send({ t: 'fire', seq, time: viewTime, origin: [eye.x, eye.y, eye.z], dir, shot: ++shot });
      await sleep(140);
    }

    const feed = await a.waitFor('killfeed', (k) => k.victim === bot.id);
    expect(feed).toMatchObject({ attacker: welcome.sessionId, weapon: 'ak47', means: 'bullet', pen: true });
    const hits = a.all('hit').filter((h) => h.victim === bot.id);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.every((h) => h.pen === true)).toBe(true);
    expect(hits.at(-1)!.kill).toBe(true);
    // Every hit came through the wall at about half an AK round.
    const near = WEAPON_BY_ID.get('ak47')!.damage.near;
    expect(dealt.length).toBe(hits.length);
    for (const h of dealt) {
      expect(h.penetrated).toBe(true);
      expect(h.amount).toBeGreaterThanOrEqual(near * 0.5 - 1e-6);
      expect(h.amount).toBeLessThan(near * 0.6);
    }
    expect(botFired.n).toBe(0);
    // The shots carry the wall's entry and exit (impact puffs on both sides, the killcam's replay).
    expect(walls.length).toBe(hits.length);
    for (const w of walls) expect(w).toEqual([Math.round(wall.min.x * 100) / 100, Math.round(wall.max.x * 100) / 100]);
  });
});
