/** Frontend lobbies and create-a-class through the real server and real sockets. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { createFrontendFeature, lobbyManagerFor } from '../src/server/features/frontend/index';
import type { LobbyState } from '../src/shared/frontend/lobby';
import type { LobbyTicket } from '../src/shared/frontend/protocol';
import type { Loadout } from '../src/shared/loadout';
import type { Profile } from '../src/shared/profile';
import { FakeClient } from './fake-client';

let rid = 1000;
/** Call an RPC and resolve with its result (rejects with the server's error text). */
async function rpc<T>(c: FakeClient, id: string, data: unknown): Promise<T> {
  const r = ++rid;
  c.send({ t: 'rpc', id, data, rid: r });
  const res = await c.waitFor('rpcResult', (m) => m.rid === r);
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
}
const lobbyState = (c: FakeClient, pred: (s: LobbyState) => boolean) => c.waitFor('feat', (m) => m.id === 'frontend.lobby' && pred(m.data as LobbyState)).then((m) => m.data as LobbyState);

describe('frontend lobbies (real server)', () => {
  let server: GameServer;
  const clients: FakeClient[] = [];
  const connect = async (name: string) => {
    const r = await FakeClient.connect(server.url, name);
    clients.push(r.client);
    return r;
  };

  beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {}, features: [createFrontendFeature({ waitSec: 1.5, soloCountdownSec: 0.5, privateCountdownSec: 0.5, spawnCountdownSec: 1 })] });
  });
  afterAll(async () => {
    for (const c of clients) c.close();
    await server.close();
  });

  it('private lobby: invite code, host-only settings, start backfills with tuned bots', async () => {
    const { client: a, welcome: wa } = await connect('Host');
    const { client: b, welcome: wb } = await connect('Friend');
    const t = await rpc<LobbyTicket>(a, 'frontend.createPrivate', { mode: 'tdm' });
    expect(t.code).toMatch(/^[A-Z2-9]{6}$/);
    a.send({ t: 'joinRoom', roomId: t.roomId });
    const ja = await a.waitFor('joined');
    expect(ja.phase).toBe('lobby');
    const s1 = await lobbyState(a, (s) => s.hostId === wa.sessionId);
    expect(s1).toMatchObject({ kind: 'private', code: t.code, mode: 'tdm', status: 'waiting' });

    // Friend joins through the invite link text.
    const t2 = await rpc<LobbyTicket>(b, 'frontend.resolveCode', { code: `http://localhost:5173/#/lobby?code=${t.code.toLowerCase()}` });
    expect(t2.roomId).toBe(t.roomId);
    b.send({ t: 'joinRoom', roomId: t2.roomId });
    await b.waitFor('joined');
    const s2 = await lobbyState(b, (s) => s.players.length === 2);
    expect(s2.players.find((p) => p.id === wb.sessionId)).toMatchObject({ host: false, bot: false, level: 1 });
    await expect(rpc(b, 'frontend.configure', { bots: { fill: false } })).rejects.toThrow(/not_host/);
    await expect(rpc(a, 'frontend.resolveCode', { code: 'ZZZZZZ' })).rejects.toThrow(/unknown_code/);

    // Host tunes the bots and limits.
    const st = await rpc<LobbyState>(a, 'frontend.configure', { limits: { scoreLimit: 20 }, bots: { difficulty: 'custom', targetPlayers: 6, custom: { reactionMs: 250, headshotBias: 0.6 } } });
    expect(st.bots.custom).toMatchObject({ reactionMs: 250, headshotBias: 0.6 });
    expect(st.botsToFill).toBe(4);
    await lobbyState(b, (s) => s.bots.difficulty === 'custom' && s.limits.scoreLimit === 20);

    // Ping report shows in the list.
    await rpc(b, 'frontend.ping', { rtt: 42.4 });

    await rpc(a, 'frontend.start', {});
    await lobbyState(a, (s) => s.countdownEndsAt !== null);
    await a.waitFor('phase', (m) => m.phase === 'countdown');
    const roster = await b.waitFor('roster', (m) => m.players.length === 6);
    expect(roster.players.filter((p) => p.bot)).toHaveLength(4);
    expect(new Set(roster.players.map((p) => p.team)).size).toBe(2);
    // Limits went out in a fresh `joined`.
    await a.waitFor('joined', (m) => m.scoreLimit === 20);
    const room = server.lobby.get(t.roomId)!;
    expect(room.mode.scoreLimit).toBe(20);
    expect(lobbyManagerFor(server.lobby)!.state(lobbyManagerFor(server.lobby)!.get(t.roomId)!).players.find((p) => p.id === wb.sessionId)!.ping).toBe(42);
    a.send({ t: 'leaveRoom' });
    b.send({ t: 'leaveRoom' });
  });

  it('quick play: waits for players, then starts with bots; the map vote is open meanwhile', async () => {
    const { client: c } = await connect('Solo');
    const t = await rpc<LobbyTicket>(c, 'frontend.matchmake', { playlist: 'ffa' });
    c.send({ t: 'joinRoom', roomId: t.roomId });
    await c.waitFor('joined', (m) => m.roomId === t.roomId);
    const s = await lobbyState(c, (x) => x.roomId === t.roomId && x.waitEndsAt !== null);
    expect(s.kind).toBe('matchmade');
    expect(s.vote!.options.length).toBeGreaterThanOrEqual(2);
    expect(s.botsToFill).toBe(7);
    await rpc(c, 'frontend.vote', { option: 0 });
    await lobbyState(c, (x) => x.roomId === t.roomId && x.vote !== null && x.vote.counts[0] === 1);
    await c.waitFor('phase', (m) => m.phase === 'countdown', 6000);
    const roster = await c.waitFor('roster', (m) => m.players.length === 8);
    expect(roster.players.filter((p) => p.bot)).toHaveLength(7);
    const pl = await rpc<{ playlists: { id: string; players: number }[] }>(c, 'frontend.playlists', {});
    expect(pl.playlists.find((p) => p.id === 'ffa')!.players).toBeGreaterThanOrEqual(1);
    c.send({ t: 'leaveRoom' });
  });

  it('create-a-class: saves validated classes and picks the next-spawn class', async () => {
    const { client: d, welcome } = await connect('Builder');
    const prof = welcome.profile;
    const cls: Loadout = {
      name: 'My Class',
      primary: { weapon: 'ak47', attachments: ['reddot', 'extmag'], camo: 'none' },
      secondary: { weapon: 'm1911', attachments: [], camo: 'none' },
      perks: ['lightweight', 'hardline', 'steady_aim'],
      killstreaks: ['uav'],
      lethal: 'frag',
      tactical: 'flash',
    };
    const res = await rpc<{ index: number; loadout: Loadout; loadouts: Loadout[]; problems: string[] }>(d, 'frontend.saveLoadout', { index: prof.loadouts.length, loadout: cls });
    expect(res.index).toBe(3);
    expect(res.loadout.perks).toEqual(['lightweight', 'steady_aim']); // one tier-1 perk
    expect(res.loadout.primary.attachments).toEqual(['reddot']); // no Warlord: one attachment
    expect(res.loadout).toMatchObject({ name: 'My Class', lethal: 'frag', tactical: 'flash' });
    expect(res.problems.length).toBe(2);
    await expect(rpc(d, 'frontend.saveLoadout', { index: 9, loadout: cls })).rejects.toThrow(/bad_index/);
    const sel = await rpc<{ selectedLoadout: number }>(d, 'frontend.selectClass', { index: 3 });
    expect(sel.selectedLoadout).toBe(3);
    const p = await rpc<Profile>(d, 'core.profile', {});
    expect(p.loadouts).toHaveLength(4);
    expect(p.selectedLoadout).toBe(3);
    expect(server.store.load(p.id)?.loadouts[3]?.name).toBe('My Class');
  });
});
