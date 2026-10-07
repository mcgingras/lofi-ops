/**
 * The tactical map through the real server and sockets: a player presses STREAK with Napalm (on
 * Nuketown) and the Mortar Team (on Terminal) ready, gets the map state, cancels once (streak kept),
 * sends targets chosen on the map with `killstreaks.mapTarget`, and sees the strikes land there.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { grant, ksOf } from '../src/server/features/killstreaks/state';
import type { KillstreakFx, KillstreakStateMsg } from '../src/shared/defs/perks-streaks-protocol';
import { KS_ENTITY } from '../src/shared/defs/killstreaks';
import { strikeFootprint } from '../src/shared/defs/tactical-map';
import { Buttons } from '../src/shared/input';
import type { ServerMsgOf } from '../src/shared/protocol';
import { FakeClient, sleep } from './fake-client';

describe('tactical map over the wire', () => {
  let server: GameServer;
  const clients: FakeClient[] = [];
  let rid = 500;

  beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
  });
  afterAll(async () => {
    for (const c of clients) c.close();
    await server.close();
  });

  async function join(map: string) {
    const { client, welcome } = await FakeClient.connect(server.url, `Radio ${map}`);
    clients.push(client);
    client.send({ t: 'quickplay', mode: 'tdm', map });
    const joined = await client.waitFor('joined');
    const room = server.lobby.get(joined.roomId)!;
    const me = room.players.get(welcome.sessionId)!;
    const t0 = Date.now();
    while (!me.alive && Date.now() - t0 < 5000) await sleep(20);
    expect(me.alive).toBe(true);
    // No bots calling streaks into the picture.
    for (const p of room.players.values()) if (p.isBot) ksOf(p).manual = true;
    return { client, room, me };
  }

  async function rpc<T>(c: FakeClient, id: string, data: unknown): Promise<T> {
    const n = ++rid;
    c.send({ t: 'rpc', id, data, rid: n } as never);
    const res = await c.waitFor('rpcResult', (m) => m.rid === n);
    expect(res.ok).toBe(true);
    return res.data as T;
  }

  /** Messages of type `t` matching `pred` received after index `from` (polls until `n` or timeout). */
  async function since<K extends 'feat' | 'snap'>(c: FakeClient, from: number, t: K, pred: (m: ServerMsgOf<K>) => boolean, n = 1, timeoutMs = 9000): Promise<ServerMsgOf<K>[]> {
    const t0 = Date.now();
    for (;;) {
      const got = c.msgs.slice(from).filter((m) => m.t === t && pred(m as never)) as unknown as ServerMsgOf<K>[];
      if (got.length >= n) return got;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${n} ${t}`);
      await sleep(20);
    }
  }
  const featOf = (id: string) => (m: ServerMsgOf<'feat'>) => m.id === id;

  /** Press STREAK through the input stream and wait for the map to be up. */
  async function openMap(c: FakeClient, id: string): Promise<KillstreakStateMsg> {
    const from = c.msgs.length;
    c.input(Buttons.STREAK, 0, 0, 2);
    await sleep(50);
    c.input(0, 0, 0, 2);
    const [st] = await since(c, from, 'feat', (m) => m.id === 'killstreaks.state' && (m.data as KillstreakStateMsg).map?.id === id);
    return st!.data as KillstreakStateMsg;
  }

  it('Napalm on Nuketown: map up, cancel keeps it, then burns the chosen line', async () => {
    const { client: a, room, me } = await join('nuketown');
    grant(room, me, 'napalm');
    const st = await openMap(a, 'napalm');
    expect(st.map!.until).toBeGreaterThan(room.time);
    expect(room.entities.byKind(KS_ENTITY.radio).some((e) => e.owner === me.id)).toBe(true);
    // The old crosshair call is refused for map streaks.
    expect(await rpc(a, 'killstreaks.call', { id: 'napalm' })).toEqual({ ok: false, reason: 'use_map' });

    // Cancel: the radio goes down, the streak stays ready.
    let from = a.msgs.length;
    expect(await rpc(a, 'killstreaks.mapCancel', {})).toEqual({ ok: true });
    const [closed] = await since(a, from, 'feat', (m) => m.id === 'killstreaks.state' && (m.data as KillstreakStateMsg).map === null);
    expect((closed!.data as KillstreakStateMsg).ready).toEqual(['napalm']);
    await sleep(600); // the map RPC rate limit refills

    await openMap(a, 'napalm');
    // Bad requests are refused and change nothing.
    expect(await rpc(a, 'killstreaks.mapTarget', { id: 'napalm', points: [[0, 500]], yaw: 0 })).toEqual({ ok: false, reason: 'out_of_bounds' });
    expect(await rpc(a, 'killstreaks.mapTarget', { id: 'napalm', points: [[0, 0], [1, 1]], yaw: 0 })).toEqual({ ok: false, reason: 'count' });
    // Across the cul-de-sac, running east (yaw -PI/2 = +x).
    const at: [number, number] = [2, -1];
    const yaw = -Math.PI / 2;
    from = a.msgs.length;
    expect(await rpc(a, 'killstreaks.mapTarget', { id: 'napalm', points: [at], yaw })).toEqual({ ok: true });
    const [called] = await since(a, from, 'feat', featOf('killstreaks.called'));
    expect(called!.data).toMatchObject({ id: 'napalm', owner: me.id });
    const [jet] = await since(a, from, 'snap', (s) => s.ents.some((e) => e.kind === KS_ENTITY.jet));
    expect(jet!.ents.find((e) => e.kind === KS_ENTITY.jet)!.yaw).toBeCloseTo(yaw, 2);
    // Three canisters land on the footprint drawn on the map.
    const want = strikeFootprint('napalm', [{ x: at[0], z: at[1] }], yaw);
    const booms = (await since(a, from, 'feat', (f) => f.id === 'killstreaks.fx' && (f.data as KillstreakFx).kind === 'napalm', 3)).map((f) => f.data as KillstreakFx);
    const got = booms.map((b) => [Math.round(b.x), Math.round(b.z)]).sort((p, q) => p[0]! - q[0]!);
    expect(got).toEqual(want.map((c) => [Math.round(c.x), Math.round(c.z)]).sort((p, q) => p[0]! - q[0]!));
    expect(ksOf(me).ready).toEqual([]);
    expect(room.entities.byKind(KS_ENTITY.radio).some((e) => e.owner === me.id)).toBe(false);
  });

  it('Mortar Team on Terminal: three chosen spots get marked and shelled', async () => {
    const { client: a, room, me } = await join('terminal');
    grant(room, me, 'mortar');
    await openMap(a, 'mortar');
    const spots: [number, number][] = [
      [-30, 10],
      [0, 0],
      [25, -12],
    ];
    const from = a.msgs.length;
    expect(await rpc(a, 'killstreaks.mapTarget', { id: 'mortar', points: spots })).toEqual({ ok: true });
    const [marked] = await since(a, from, 'snap', (s) => s.ents.filter((e) => e.kind === KS_ENTITY.mortarMark).length === 3);
    const marks = marked!.ents.filter((e) => e.kind === KS_ENTITY.mortarMark).map((e) => [e.x, e.z]);
    expect(marks).toEqual(spots);
    // Two rounds per spot, each within the spread of its spot.
    const booms = (await since(a, from, 'feat', (f) => f.id === 'killstreaks.fx' && ['boom', 'bigboom'].includes((f.data as KillstreakFx).kind), 6)).map((f) => f.data as KillstreakFx);
    const perSpot = spots.map((s) => booms.filter((b) => Math.hypot(b.x - s[0], b.z - s[1]) < 2.5).length);
    expect(perSpot).toEqual([2, 2, 2]);
  });
});
