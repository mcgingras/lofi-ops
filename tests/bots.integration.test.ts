/** Bots through the real server and sockets: Play with bots, bots.* RPCs, bots moving and fighting. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import type { BotsState } from '../src/shared/defs/bots';
import { FakeClient } from './fake-client';

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

async function rpc<T>(c: FakeClient, id: string, data: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  const r = ++rid;
  c.send({ t: 'rpc', id, data, rid: r });
  const res = await c.waitFor('rpcResult', (m) => m.rid === r);
  return res as { ok: boolean; data?: T; error?: string };
}

describe('bots over the wire', () => {
  it('Play with bots: a private room fills with bots that move and fight; host-only settings', async () => {
    const { client: host, welcome } = await FakeClient.connect(server.url, 'Host');
    clients.push(host);
    const made = await rpc<{ roomId: string }>(host, 'bots.playWithBots', { mode: 'tdm', map: 'yard', difficulty: 'veteran', targetPlayers: 4 });
    expect(made.ok).toBe(true);
    const roomId = made.data!.roomId;
    host.send({ t: 'joinRoom', roomId });
    const joined = await host.waitFor('joined');
    expect(joined.roomId).toBe(roomId);
    expect(joined.phase).toBe('playing');

    // A human took a bot's place: 1 human + bots = 4 (one bot retires at its next death).
    const roster = await host.waitFor('roster', (m) => m.players.some((p) => p.id === welcome.sessionId));
    expect(roster.players.filter((p) => p.bot).length).toBeGreaterThanOrEqual(3);
    const status = await host.waitFor('feat', (m) => m.id === 'bots.status');
    expect((status.data as BotsState).settings.difficulty).toBe('veteran');

    const got = await rpc<BotsState>(host, 'bots.get', {});
    expect(got.ok).toBe(true);
    expect(got.data).toMatchObject({ roomId, editable: true, target: 4, humans: 1, managed: true });
    expect(got.data!.settings.difficulty).toBe('veteran');

    // Bots move (positions change between snapshots).
    const first = await host.waitFor('snap', (s) => s.players.length >= 4);
    const later = await host.waitFor('snap', (s) => s.time > first.time + 2, 6000);
    const botIds = roster.players.filter((p) => p.bot).map((p) => p.id);
    const moved = botIds.filter((id) => {
      const a = first.players.find((p) => p.id === id);
      const b = later.players.find((p) => p.id === id);
      return a && b && Math.hypot(a.x - b.x, a.z - b.z) > 1;
    });
    expect(moved.length).toBeGreaterThanOrEqual(2);

    // A second human may look but not touch.
    const { client: guest } = await FakeClient.connect(server.url, 'Guest');
    clients.push(guest);
    guest.send({ t: 'joinRoom', roomId });
    await guest.waitFor('joined');
    const denied = await rpc<BotsState>(guest, 'bots.setSettings', { settings: { difficulty: 'recruit' } });
    expect(denied.ok).toBe(false);
    expect(denied.error).toMatch(/not_host/);
    const view = await rpc<BotsState>(guest, 'bots.get', { roomId });
    expect(view.data!.editable).toBe(false);

    // The host raises the target: more bots join at once.
    const set = await rpc<BotsState>(host, 'bots.setSettings', { settings: { targetPlayers: 8, difficulty: 'custom', custom: { reactionMs: 200, aimErrorDeg: 1 } } });
    expect(set.ok).toBe(true);
    expect(set.data!.settings.custom).toMatchObject({ reactionMs: 200, aimErrorDeg: 1 });
    await host.waitFor('roster', (m) => m.players.length === 8, 3000);
    const room = server.lobby.get(roomId)!;
    expect(room.bots().length).toBe(6);

    // Bots fight: someone dies within a while (bots vs bots or vs the idle humans).
    await host.waitFor('killfeed', () => true, 15000);
  }, 30000);

  it('bad requests are refused', async () => {
    const { client } = await FakeClient.connect(server.url, 'Nobody');
    clients.push(client);
    expect((await rpc(client, 'bots.playWithBots', { mode: 'nope' })).ok).toBe(false);
    expect((await rpc(client, 'bots.get', {})).error).toMatch(/unknown_room/);
    client.send({ t: 'quickplay', mode: 'ffa', map: 'yard' });
    await client.waitFor('joined');
    // Matchmade rooms use playlist settings.
    const res = await rpc(client, 'bots.setSettings', { settings: { difficulty: 'veteran' } });
    expect(res.error).toMatch(/not_allowed/);
    const st = await rpc<BotsState>(client, 'bots.get', {});
    expect(st.data!.fillAt).not.toBeNull();
  });
});
