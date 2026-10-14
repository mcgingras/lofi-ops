/**
 * Valkyrie Rockets over the real server and sockets: STREAK raises the launcher (state push, the
 * enemy sees it on the shoulder), FIRE launches (the view's `control` arrives, both clients get the
 * rocket in their snapshots, the enemy is told it is inbound), the rocket turns with the input's
 * aim, ADS boosts it, FIRE detonates it (the camera holds on the blast), then the launcher reloads
 * and the second rocket goes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { configureRoomBots } from '../src/server/features/bots/api';
import { grant } from '../src/server/features/killstreaks/state';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { KS_ENTITY } from '../src/shared/defs/killstreaks';
import type { KillstreakStateMsg } from '../src/shared/defs/perks-streaks-protocol';
import { VALKYRIE, VALKYRIE_LAUNCHER } from '../src/shared/defs/valkyrie';
import { Buttons } from '../src/shared/input';
import { createMoveState } from '../src/shared/movement';
import { FakeClient, sleep } from './fake-client';

const place = (p: PlayerState, x: number, z: number, y = 0) => {
  p.move = { ...createMoveState(x, y, z), onGround: true };
};

describe('Valkyrie Rockets over the wire', () => {
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

  it('raise, launch, steer, boost, detonate, reload, second rocket', async () => {
    const room = server.lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, private: true, countdownSec: 0, botFill: 0 });
    configureRoomBots(room, { fill: false });
    const { client: a, me: A } = await join(room, 'Pilot');
    const { client: b, me: B } = await join(room, 'Enemy');
    if (B.team === A.team) {
      B.team = A.team === 0 ? 1 : 0;
      room.spawn(B);
    }
    place(A, -1, 20);
    place(B, 12, -20);
    grant(room, A, VALKYRIE_LAUNCHER);
    let buttons = 0;
    let yaw = 0;
    let pitch = 0.25;
    const pa = setInterval(() => a.input(buttons, yaw, pitch, 2), 30);
    const pb = setInterval(() => b.input(0, 0, 0, 2), 30);
    const st = (m: { data: unknown }) => m.data as KillstreakStateMsg;
    const tap = async (bits: number) => {
      buttons = bits;
      await sleep(90);
      buttons = 0;
      await sleep(60);
    };
    try {
      await sleep(150);
      const n0 = a.all('feat').length;
      await tap(Buttons.STREAK);
      const up = await a.waitFor('feat', (m) => m.id === 'killstreaks.state' && !!st(m).launcher, 3000);
      expect(st(up).launcher).toMatchObject({ left: 2, fired: false });
      expect(a.all('feat').length).toBeGreaterThan(n0);
      // The enemy sees it on the shoulder.
      const seen = await b.waitFor('snap', (s) => s.ents.some((e) => e.kind === KS_ENTITY.launcher && e.owner === A.id), 3000);
      expect(seen).toBeDefined();
      await sleep(VALKYRIE.raiseSec * 1000 + 100);
      await tap(Buttons.FIRE);
      const flying = await a.waitFor('feat', (m) => m.id === 'killstreaks.state' && st(m).control?.id === 'valkyrie', 3000);
      const rocketId = st(flying).control!.entity;
      const inbound = await b.waitFor('feat', (m) => m.id === 'killstreaks.called' && (m.data as { id: string }).id === 'valkyrie', 3000);
      expect((inbound.data as { owner: string }).owner).toBe(A.id);
      await b.waitFor('snap', (s) => s.ents.some((e) => e.id === rocketId && e.kind === KS_ENTITY.rocket), 3000);
      const first = await a.waitFor('snap', (s) => s.ents.some((e) => e.id === rocketId), 3000);
      const yaw0 = first.ents.find((e) => e.id === rocketId)!.yaw;
      // Steer left: the rocket's heading follows the aim.
      yaw = 0.9;
      await sleep(400);
      const turned = a.last('snap')!.ents.find((e) => e.id === rocketId)!;
      expect(turned.yaw - yaw0).toBeGreaterThan(0.2);
      expect(turned.yaw - yaw0).toBeLessThan(VALKYRIE.turnRate * 0.6);
      // Boost (ADS).
      buttons = Buttons.ADS;
      const boosted = await a.waitFor('snap', (s) => s.ents.some((e) => e.id === rocketId && e.s?.b === 1), 2000);
      expect(boosted).toBeDefined();
      buttons = 0;
      await sleep(80);
      // FIRE detonates: the camera holds on the blast, then the launcher reloads.
      await tap(Buttons.FIRE);
      const hold = await a.waitFor('feat', (m) => m.id === 'killstreaks.state' && !!st(m).control?.hold, 3000);
      expect(st(hold).control!.hold!.until).toBeGreaterThan(0);
      const back = await a.waitFor('feat', (m) => m.id === 'killstreaks.state' && !st(m).control && st(m).launcher?.left === 1, 3000);
      expect(st(back).launcher!.ready).toBeGreaterThan(room.time);
      await sleep(VALKYRIE.reloadSec * 1000 + 150);
      await tap(Buttons.FIRE);
      const second = await a.waitFor('feat', (m) => m.id === 'killstreaks.state' && st(m).control?.id === 'valkyrie' && st(m).control!.entity !== rocketId, 3000);
      expect(st(second).launcher?.left).toBe(0);
      expect(A.ext.killstreaks?.ready).toEqual([]);
    } finally {
      clearInterval(pa);
      clearInterval(pb);
      room.close();
    }
  }, 40000);
});
