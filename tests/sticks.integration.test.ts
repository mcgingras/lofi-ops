/**
 * Sticks and Stones over the real server and sockets: the forced loadout in the `me` snapshot
 * (6 bolts, 2 blades, a tomahawk), a ballistic knife blade fired into a wall showing up stuck in
 * snapshots and coming back by walking over it (`economy.blade`), a crossbow bolt stuck to a bot
 * (snapshot `s.p`) that kills it on the fuse (killfeed `crossbow`), and a tomahawk held up with
 * LETHAL (nothing thrown while held), thrown on release, bankrupting its victim (`economy.bankrupt`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { eyeOf } from '../src/server/combat';
import { configureRoomBots } from '../src/server/features/bots/api';
import type { PlayerState } from '../src/server/player';
import { BLADE_ENTITY, BOLT_ENTITY } from '../src/shared/defs/economy';
import { TOMAHAWK_ENTITY } from '../src/shared/defs/equipment';
import { Buttons } from '../src/shared/input';
import { createMoveState } from '../src/shared/movement';
import { FakeClient, sleep } from './fake-client';

const place = (p: PlayerState, x: number, z: number, y = 0) => {
  p.move = { ...createMoveState(x, y, z), onGround: true };
};
const aimAt = (p: PlayerState, t: { x: number; y: number; z: number }) => {
  const e = eyeOf(p);
  const dx = t.x - e.x;
  const dy = t.y - e.y;
  const dz = t.z - e.z;
  const l = Math.hypot(dx, dy, dz);
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), dir: [dx / l, dy / l, dz / l] as [number, number, number] };
};
async function until(cond: () => boolean, ms = 6000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return true;
    await sleep(20);
  }
  return cond();
}
async function holdFor(c: FakeClient, buttons: number, yaw: number, pitch: number, ms: number, slot = 0) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    c.input(buttons, yaw, pitch, 2, slot);
    await sleep(30);
  }
}

describe('Sticks and Stones over the wire', () => {
  let server: GameServer;
  const clients: FakeClient[] = [];
  beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
  });
  afterAll(async () => {
    for (const c of clients) c.close();
    await server.close();
  });

  it('blades come back from walls, bolts stick and blow, a held tomahawk flies on release and bankrupts', async () => {
    const room = server.lobby.createRoom({ mode: 'sticks', map: 'yard', closeWhenEmpty: false, private: true, countdownSec: 0, botFill: 0 });
    configureRoomBots(room, { fill: false });
    const { client: c, welcome } = await FakeClient.connect(server.url, 'Stoner');
    clients.push(c);
    c.send({ t: 'joinRoom', roomId: room.id });
    await c.waitFor('joined');
    const snap0 = await c.waitFor('snap', (s) => s.phase === 'playing' && !!s.me?.alive, 6000);
    expect(snap0.me!.weapons.map((w) => [w.id, w.mag, w.reserve])).toEqual([
      ['crossbow', 1, 5],
      ['ballistic_knife', 1, 1],
    ]);
    const me = room.players.get(welcome.sessionId)!;
    expect(me.ext.weapons).toMatchObject({ lethal: 'tomahawk', lethalN: 1, tactical: null });

    // --- Ballistic knife blade into a wall, then walk over it.
    place(me, -1, 0);
    const o = eyeOf(me);
    let wall: { d: { x: number; z: number }; t: number } | null = null;
    for (let i = 0; i < 32 && !wall; i++) {
      const a = (i / 32) * Math.PI * 2;
      const d = { x: Math.sin(a), y: 0, z: Math.cos(a) };
      const hit = room.world.raycast(o, d, 9, 'bullets');
      if (hit && hit.t > 3 && Math.abs(hit.normal.y) < 0.1) wall = { d, t: hit.t };
    }
    expect(wall).not.toBeNull();
    const target = { x: o.x + wall!.d.x * wall!.t, y: o.y, z: o.z + wall!.d.z * wall!.t };
    let aim = aimAt(me, target);
    await holdFor(c, 0, aim.yaw, aim.pitch, 500, 1); // switch to the knife
    place(me, -1, 0);
    c.input(0, aim.yaw, aim.pitch, 2, 1);
    c.send({ t: 'fire', seq: c.seq, time: room.time, origin: [o.x, o.y, o.z], dir: aim.dir, shot: 1 });
    const stuck = await c.waitFor('snap', (s) => s.ents.some((e) => e.kind === BLADE_ENTITY && e.s?.k === 1), 4000);
    const blade = stuck.ents.find((e) => e.kind === BLADE_ENTITY)!;
    await c.waitFor('snap', (s) => (s.me?.weapons[1]?.mag ?? 0) + (s.me?.weapons[1]?.reserve ?? 0) === 1, 3000);
    place(me, blade.x - wall!.d.x * 0.5, blade.z - wall!.d.z * 0.5);
    const got = await c.waitFor('feat', (m) => m.id === 'economy.blade', 3000);
    expect(got.data).toEqual({ total: 2 });
    await c.waitFor('snap', (s) => !s.ents.some((e) => e.kind === BLADE_ENTITY), 3000);

    // --- Crossbow bolt sticks to an idle bot and kills it on the fuse.
    const bot = room.addBot({ name: 'Target' });
    bot.brain = { think: () => null };
    if (!bot.alive) room.spawn(bot);
    place(me, -1, 9);
    place(bot, -1, 0);
    aim = aimAt(me, { x: -1, y: 1.2, z: 0 });
    await holdFor(c, 0, aim.yaw, aim.pitch, 700, 0); // back to the crossbow, raised
    place(me, -1, 9);
    place(bot, -1, 0);
    const e = eyeOf(me);
    c.input(0, aim.yaw, aim.pitch, 2, 0);
    c.send({ t: 'fire', seq: c.seq, time: room.time, origin: [e.x, e.y, e.z], dir: aim.dir, shot: 2 });
    await c.waitFor('snap', (s) => s.ents.some((x) => x.kind === BOLT_ENTITY && x.s?.p === bot.id), 3000);
    expect(bot.alive).toBe(true);
    const feed = await c.waitFor('killfeed', (k) => k.victim === bot.id, 4000);
    expect(feed.weapon).toBe('crossbow');
    expect(feed.attacker).toBe(me.id);

    // --- Tomahawk: held up while LETHAL is down, thrown on release, bankrupts.
    await until(() => bot.alive, 6000);
    bot.brain = { think: () => null };
    room.addPlayerScore(bot, 300, 'test');
    place(me, -1, 6);
    place(bot, -1, 0);
    aim = aimAt(me, { x: -1, y: 1.3, z: 0 });
    await holdFor(c, Buttons.LETHAL, aim.yaw, aim.pitch, 900, 0);
    expect(me.ext.weapons?.throwing).not.toBeNull();
    expect(room.entities.byKind(TOMAHAWK_ENTITY).length).toBe(0);
    place(bot, -1, 0);
    await holdFor(c, 0, aim.yaw, aim.pitch, 100, 0);
    await c.waitFor('snap', (s) => s.ents.some((x) => x.kind === TOMAHAWK_ENTITY), 2000);
    const br = await c.waitFor('feat', (m) => m.id === 'economy.bankrupt', 3000);
    expect(br.data).toEqual({ victim: bot.id, attacker: me.id, lost: 300 });
    expect(bot.stats.score).toBe(0);
    room.close();
  }, 30000);
});
