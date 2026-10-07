/**
 * Regression: after a match ends and the room rotates to another map, the client builds a fresh
 * MatchNet. Input seqs used to restart at 0 while the server kept the player's lastSeq, so every
 * movement command was dropped and the player was stuck in place for the new match.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { MatchNet, type Net } from '../src/client/net';
import { Buttons } from '../src/shared/input';
import { createMoveState } from '../src/shared/movement';
import type { ServerMessages, ServerMsgOf } from '../src/shared/protocol';
import { FakeClient, sleep } from './fake-client';

let server: GameServer;
beforeAll(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
});
afterAll(async () => {
  await server.close();
});

function adapterFor(client: FakeClient): Net {
  return {
    on: <K extends keyof ServerMessages>(t: K, fn: (m: ServerMsgOf<K>) => void) => {
      const h = (data: Buffer) => {
        const m = JSON.parse(data.toString()) as { t: string };
        if (m.t === t) fn(m as unknown as ServerMsgOf<K>);
      };
      client.ws.on('message', h);
      return () => client.ws.off('message', h);
    },
    send: (m: Parameters<FakeClient['send']>[0]) => client.send(m),
  } as unknown as Net;
}

/** Run forward for `ms`, sending input like the browser does. */
async function run(mn: MatchNet, ms: number, yaw: number) {
  let last = performance.now();
  const t0 = last;
  while (performance.now() - t0 < ms) {
    await sleep(14);
    const now = performance.now();
    mn.input(Buttons.FORWARD, yaw, 0, 0, (now - last) / 1000);
    mn.flush();
    last = now;
  }
  mn.flush(true);
}

it('movement still works after the room rotates to a new map', async () => {
  const room = server.lobby.createRoom({ mode: 'ffa', map: 'yard', closeWhenEmpty: true, countdownSec: 0, postMatchSec: 0.5, botFill: 0 });
  const { client } = await FakeClient.connect(server.url, 'Mover');
  try {
    client.send({ t: 'joinRoom', roomId: room.id });
    const joined1 = await client.waitFor('joined');
    const adapter = adapterFor(client);

    // Match 1: move around so the server's lastSeq climbs well above zero.
    const mn1 = new MatchNet(adapter, joined1);
    const s1 = await client.waitFor('spawned');
    mn1.predictor.reset({ ...createMoveState(s1.x, s1.y, s1.z), onGround: true });
    await run(mn1, 3000, s1.yaw);
    await client.waitFor('snap', (s) => s.ack >= mn1.seq, 3000);
    const seqAfterMatch1 = mn1.seq;
    expect(seqAfterMatch1).toBeGreaterThan(120);
    mn1.dispose();

    // End it; the room rotates to a different map and re-sends `joined`.
    room.endMatch('score');
    const joined2 = await client.waitFor('joined', (m) => m.map !== joined1.map, 5000);
    const mn2 = new MatchNet(adapter, joined2);
    // waitFor also matches messages already received, so skip match 1's spawn explicitly.
    const s2 = await client.waitFor('spawned', (m) => m !== s1, 5000);
    mn2.predictor.reset({ ...createMoveState(s2.x, s2.y, s2.z), onGround: true });
    await client.waitFor('snap', (s) => s.phase === 'playing' && !!s.me?.alive, 5000);

    // Match 2: the new MatchNet carries on from the old seq, so the server applies its input.
    await run(mn2, 1200, s2.yaw);
    await sleep(300);
    const latest = client.last('snap')!;
    const moved = Math.hypot(latest.me!.move.x - s2.x, latest.me!.move.z - s2.z);
    expect(moved).toBeGreaterThan(2);
    expect(mn2.seq).toBeGreaterThan(seqAfterMatch1);
    mn2.dispose();
  } finally {
    client.close();
  }
}, 20000);
