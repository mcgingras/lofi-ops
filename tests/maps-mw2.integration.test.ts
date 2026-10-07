/**
 * maps-mw2 through the server: a human joins a bot-filled lobby on each MW2 map over a real socket
 * and walks; bot-filled rooms run for a while on every map with simple roaming brains, and nobody
 * leaves the play space or dies to the world. (Real bot AI is the bots area's; these brains only
 * exercise the maps.)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { Lobby } from '../src/server/lobby';
import type { BotBrain, PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { Store } from '../src/server/store';
import { TICK_DT } from '../src/shared/constants';
import { getMapData } from '../src/shared/defs/maps';
import { Buttons } from '../src/shared/input';
import { FakeClient, sleep } from './fake-client';

const MW2 = ['rust', 'scrapyard', 'terminal'] as const;

/** Walks from roam point to roam point; jumps when stuck, picks another point when stuck long. */
function roamBrain(seed: number): BotBrain {
  let target = seed;
  let stuck = 0;
  let lx = Number.NaN;
  let lz = Number.NaN;
  return {
    think(room: Room, self: PlayerState, dt: number) {
      const hs = room.map.hotspots ?? [];
      if (!hs.length || !self.alive) return null;
      const t = hs[target % hs.length]!;
      const dx = t.x - self.move.x;
      const dz = t.z - self.move.z;
      if (Math.hypot(dx, dz) < 1.5) target += 1 + (seed % 3);
      const moved = Math.hypot(self.move.x - lx, self.move.z - lz);
      stuck = moved < 0.02 ? stuck + dt : 0;
      if (stuck > 1.5) {
        target += 1;
        stuck = 0;
      }
      lx = self.move.x;
      lz = self.move.z;
      const yaw = Math.atan2(-dx, -dz) + (stuck > 0.6 ? 0.9 : 0);
      return { buttons: Buttons.FORWARD | Buttons.SPRINT | (stuck > 0.3 ? Buttons.JUMP : 0), yaw, pitch: 0, weaponSlot: 0 };
    },
  };
}

describe('maps-mw2 on the real server', () => {
  let server: GameServer;
  const clients: FakeClient[] = [];

  beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
  });
  afterAll(async () => {
    for (const c of clients) c.close();
    await server.close();
  });

  for (const id of MW2) {
    it(`${id}: a human joins a bot-filled lobby, spawns, walks; bots roam without leaving the map`, async () => {
      const room = server.lobby.createRoom({ mode: 'tdm', map: id, botFill: 6 });
      const worldDeaths: string[] = [];
      room.bus.on('death', ({ victim, weapon }) => {
        if (weapon === 'world') worldDeaths.push(victim.name);
      });
      const { client } = await FakeClient.connect(server.url, `Walker-${id}`);
      clients.push(client);
      client.send({ t: 'joinRoom', roomId: room.id });
      const joined = await client.waitFor('joined');
      expect(joined.map).toBe(id);
      const spawned = await client.waitFor('spawned');
      expect(room.players.size).toBe(6);
      expect(room.bots().length).toBe(5);
      room.bots().forEach((b, i) => (b.brain = roamBrain(i)));

      const map = getMapData(id);
      const spawnPts = [...map.spawns.teams[0], ...map.spawns.teams[1], ...map.spawns.ffa];
      expect(spawnPts.some((s) => Math.hypot(s.x - spawned.x, s.z - spawned.z) < 0.01)).toBe(true);

      // Walk forward (towards the map centre) for ~1.2 s.
      let seq = 0;
      for (let i = 0; i < 24; i++) {
        seq = client.input(Buttons.FORWARD, spawned.yaw, 0);
        await sleep(50);
      }
      const snap = await client.waitFor('snap', (s) => s.ack >= seq);
      expect(snap.me).toBeTruthy();
      const me = snap.me!;
      expect(Math.hypot(me.move.x - spawned.x, me.move.z - spawned.z)).toBeGreaterThan(2);
      expect(snap.players.length).toBe(6);

      const b = map.bounds;
      for (const p of room.players.values()) {
        expect(p.move.x).toBeGreaterThan(b.min.x);
        expect(p.move.x).toBeLessThan(b.max.x);
        expect(p.move.z).toBeGreaterThan(b.min.z);
        expect(p.move.z).toBeLessThan(b.max.z);
      }
      expect(worldDeaths).toEqual([]);
      client.send({ t: 'leaveRoom' });
      await client.waitFor('left');
    });
  }
});

describe('maps-mw2 bot-filled rooms (simulated)', () => {
  let store: Store;
  let lobby: Lobby;
  beforeAll(() => {
    store = new Store(':memory:');
    lobby = new Lobby({ store, features: [], log: () => {}, autoTick: false });
  });
  afterAll(() => {
    lobby.shutdown();
    store.close();
  });

  for (const id of MW2)
    for (const mode of ['tdm', 'ffa'] as const) {
      it(`${id} ${mode}: a full room of roaming bots for 45 s stays in the map`, () => {
        const room = lobby.createRoom({ mode, map: id, botFill: 10, closeWhenEmpty: false, persist: false });
        room.fillBots();
        expect(room.bots().length).toBe(Math.min(10, room.mode.maxPlayers));
        room.bots().forEach((b, i) => (b.brain = roamBrain(i * 7)));
        const worldDeaths: string[] = [];
        room.bus.on('death', ({ victim, weapon }) => {
          if (weapon === 'world') worldDeaths.push(`${victim.name}@${victim.move.x.toFixed(1)},${victim.move.y.toFixed(1)},${victim.move.z.toFixed(1)}`);
        });
        const start = new Map(room.bots().map((b) => [b.id, { x: b.move.x, z: b.move.z }]));
        let maxTravel = 0;
        for (let i = 0; i < Math.round(45 / TICK_DT); i++) {
          room.step();
          if (i % 60 === 0)
            for (const b of room.bots()) {
              const s = start.get(b.id)!;
              maxTravel = Math.max(maxTravel, Math.hypot(b.move.x - s.x, b.move.z - s.z));
            }
        }
        expect(worldDeaths).toEqual([]);
        expect(maxTravel).toBeGreaterThan(10);
        for (const b of room.bots()) expect(b.alive).toBe(true);
        room.close();
      });
    }
});
