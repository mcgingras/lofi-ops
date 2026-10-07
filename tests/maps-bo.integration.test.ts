/**
 * maps-bo through the real server: players quick-play onto Nuketown and Firing Range, spawn on the
 * map's team/FFA spawns, run around with real input over sockets and stay inside the bounds.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { getMapData } from '../src/shared/defs/maps';
import { Buttons } from '../src/shared/input';
import { FakeClient, sleep } from './fake-client';

describe('maps-bo on the real server', () => {
  let server: GameServer;
  const clients: FakeClient[] = [];

  beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
  });
  afterAll(async () => {
    for (const c of clients) c.close();
    await server.close();
  });

  for (const [mode, mapId] of [['tdm', 'nuketown'], ['ffa', 'firingrange'], ['tdm', 'firingrange']] as const) {
    it(`${mode} on ${mapId}: join, spawn on a map spawn, sprint about, stay in bounds`, async () => {
      const map = getMapData(mapId);
      const { client: a, welcome } = await FakeClient.connect(server.url, `Runner-${mapId}`);
      clients.push(a);
      a.send({ t: 'quickplay', mode, map: mapId });
      const joined = await a.waitFor('joined', (j) => j.map === mapId);
      expect(joined.mode).toBe(mode);
      const room = server.lobby.get(joined.roomId)!;
      expect(room.map.id).toBe(mapId);
      expect(room.map.objectives.dom).toHaveLength(3);

      const spawned = await a.waitFor('spawned');
      const pool = mode === 'ffa' ? map.spawns.ffa : map.spawns.teams[joined.team ?? 0];
      expect(pool.some((s) => Math.hypot(s.x - spawned.x, s.z - spawned.z) < 0.01 && Math.abs(s.y - spawned.y) < 0.05)).toBe(true);

      // Sprint forward for a while, turning now and then; the server moves us through the map.
      const me = room.players.get(welcome.sessionId)!;
      const start = { x: me.move.x, z: me.move.z };
      let yaw = spawned.yaw;
      let farthest = 0;
      for (let i = 0; i < 60; i++) {
        if (i % 8 === 7) yaw += 2.1;
        a.input(Buttons.FORWARD | Buttons.SPRINT, yaw, 0, 3);
        await sleep(30);
        farthest = Math.max(farthest, Math.hypot(me.move.x - start.x, me.move.z - start.z));
      }
      await a.waitFor('snap', (s) => s.ack >= a.seq);
      expect(farthest).toBeGreaterThan(1.5);
      expect(me.alive).toBe(true);
      const b = map.bounds;
      expect(me.move.x > b.min.x && me.move.x < b.max.x && me.move.z > b.min.z && me.move.z < b.max.z).toBe(true);
      a.send({ t: 'leaveRoom' });
    });
  }
});
