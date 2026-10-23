/**
 * Pack-a-Punch over the real server and sockets: a client can't call it without the streak (the
 * RPC answers not_ready and nothing changes); with it, STREAK starts the upgrade, both players get
 * `killstreaks.pap`, the owner's snapshot then carries the packed gun (camo `pap`, the bigger
 * magazine, refilled), the enemy sees the camo on the owner's gun, and `killstreaks.packed` names it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { configureRoomBots } from '../src/server/features/bots/api';
import { grant } from '../src/server/features/killstreaks/state';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { PACK_A_PUNCH, PAP_CAMO, PAP_ID } from '../src/shared/defs/pack-a-punch';
import { WEAPON_BY_ID } from '../src/shared/defs/weapons';
import { Buttons } from '../src/shared/input';
import { createMoveState } from '../src/shared/movement';
import { FakeClient, sleep } from './fake-client';

const place = (p: PlayerState, x: number, z: number) => {
  p.move = { ...createMoveState(x, 0, z), onGround: true };
};

describe('Pack-a-Punch over the wire', () => {
  let server: GameServer;
  const clients: FakeClient[] = [];
  beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
  });
  afterAll(async () => {
    for (const c of clients) c.close();
    await server.close();
  });

  async function join(room: Room, name: string) {
    const { client, welcome } = await FakeClient.connect(server.url, name);
    clients.push(client);
    client.send({ t: 'joinRoom', roomId: room.id });
    await client.waitFor('joined');
    await client.waitFor('snap', (s) => s.phase === 'playing' && !!s.me?.alive, 6000);
    return { client, me: room.players.get(welcome.sessionId)! };
  }

  it('no streak, no upgrade; STREAK packs the gun in hand and everyone sees it', async () => {
    const room = server.lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, private: true, countdownSec: 0, botFill: 0 });
    configureRoomBots(room, { fill: false });
    const { client: a, me: A } = await join(room, 'Packer');
    const { client: b, me: B } = await join(room, 'Watcher');
    if (B.team === A.team) {
      B.team = A.team === 0 ? 1 : 0;
      room.spawn(B);
    }
    place(A, -10, 20);
    place(B, 10, 20);
    let buttons = 0;
    const pa = setInterval(() => a.input(buttons, 0, 0, 2, A.slot), 30);
    const pb = setInterval(() => b.input(0, 0, 0, 2), 30);
    try {
      // A client asking for it without having earned it gets nothing.
      a.send({ t: 'rpc', id: 'killstreaks.call', data: { id: PAP_ID }, rid: 7 });
      const res = await a.waitFor('rpcResult', (m) => m.rid === 7, 3000);
      expect(res.data).toEqual({ ok: false, reason: 'not_ready' });
      expect(A.weapons[0]!.pap).toBeFalsy();

      grant(room, A, PAP_ID);
      const held = A.weapons[A.slot]!;
      const id = held.def.base.id;
      await sleep(150);
      buttons = Buttons.STREAK;
      await sleep(90);
      buttons = 0;
      const started = await b.waitFor('feat', (m) => m.id === 'killstreaks.pap', 3000);
      expect(started.data).toMatchObject({ p: A.id, w: id, dur: PACK_A_PUNCH.durationSec });
      await a.waitFor('feat', (m) => m.id === 'killstreaks.pap', 3000);
      const packed = await a.waitFor('feat', (m) => m.id === 'killstreaks.packed', 3000);
      expect((packed.data as { name: string }).name).toBe(held.def.name);
      const mine = await a.waitFor('snap', (s) => s.me?.weapons[A.slot]?.camo === PAP_CAMO, 3000);
      const w = mine.me!.weapons[A.slot]!;
      expect(w.mag).toBeGreaterThan(WEAPON_BY_ID.get(id)!.magazine);
      expect(w.reserve).toBeGreaterThan(WEAPON_BY_ID.get(id)!.reserve);
      const seen = await b.waitFor('snap', (s) => s.players.some((p) => p.id === A.id && p.c === PAP_CAMO), 3000);
      expect(seen.players.find((p) => p.id === A.id)!.w).toBe(id);
    } finally {
      clearInterval(pa);
      clearInterval(pb);
      room.close();
    }
  }, 30000);
});
