/**
 * Warlord through the real server and real sockets, every feature loaded: create-a-class saves two
 * attachments, the spawn keeps both (the `spawned` loadout, the snapshot the viewmodel is built
 * from, and the server's PlayerState), a class without Warlord keeps only the first, a mid-match
 * class change uses the new class's perks, and Warlord Pro carries an extra lethal and tactical.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { PERK_PRO_CHALLENGES } from '../src/shared/defs/perks';
import { XP_TABLE } from '../src/shared/defs/progression';
import type { Loadout } from '../src/shared/loadout';
import type { ServerMsgOf } from '../src/shared/protocol';
import { FakeClient } from './fake-client';

let rid = 7000;
async function rpc<T>(c: FakeClient, id: string, data: unknown): Promise<T> {
  const r = ++rid;
  c.send({ t: 'rpc', id, data, rid: r });
  const res = await c.waitFor('rpcResult', (m) => m.rid === r);
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
}

type Equip = { lethal: string | null; lethalN: number; tactical: string | null; tacticalN: number };

describe('Warlord (real server)', () => {
  let server: GameServer;
  const clients: FakeClient[] = [];
  beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
  });
  afterAll(async () => {
    for (const c of clients) c.close();
    await server.close();
  });

  it('two attachments with Warlord, one without, Pro grenades, mid-match class changes', async () => {
    const { client: c, welcome } = await FakeClient.connect(server.url, 'Warlord');
    clients.push(c);
    const prof = [...server.sessions.values()].find((s) => s.id === welcome.sessionId)!.profile;
    prof.level = 20;
    prof.xp = XP_TABLE[20]!;
    prof.stats['weapon.ak47.kills'] = 100;
    prof.owned.push('att.ak47.reddot', 'att.ak47.extmag');

    const cls = (name: string, perks: string[]): Loadout => ({
      name,
      primary: { weapon: 'ak47', attachments: ['reddot', 'extmag'], camo: 'none' },
      secondary: { weapon: 'm1911', attachments: [], camo: 'none' },
      perks,
      killstreaks: ['uav'],
      lethal: 'frag',
      tactical: 'flashbang',
    });
    type Saved = { loadout: Loadout; problems: string[] };
    const withW = await rpc<Saved>(c, 'frontend.saveLoadout', { index: 3, loadout: cls('Warlord', ['lightweight', 'warlord']) });
    expect(withW.problems).toEqual([]);
    expect(withW.loadout.primary.attachments).toEqual(['reddot', 'extmag']);
    const without = await rpc<Saved>(c, 'frontend.saveLoadout', { index: 4, loadout: cls('Plain', ['lightweight', 'steady_aim']) });
    expect(without.loadout.primary.attachments).toEqual(['reddot']); // create-a-class already allows one
    // Reopening the class shows what was saved.
    const reopened = await rpc<{ loadouts: Loadout[] }>(c, 'core.profile', {});
    expect(reopened.loadouts[3]!.primary.attachments).toEqual(['reddot', 'extmag']);

    // From here on, wait only for messages that arrive after `mark()`.
    let from = 0;
    const mark = () => (from = c.msgs.length);
    const after = <T>(m: T) => c.msgs.indexOf(m as never) >= from;
    const nextSpawn = () => c.waitFor('spawned', after, 8000);
    const nextEquip = () => c.waitFor('feat', (m) => after(m) && m.id === 'weapons.equip').then((m) => m.data as Equip);
    const snapWith = (atts: string[]) => c.waitFor('snap', (s) => after(s) && JSON.stringify(s.me?.weapons[0]?.attachments) === JSON.stringify(atts), 4000);

    await rpc(c, 'frontend.selectClass', { index: 3 });
    mark();
    c.send({ t: 'quickplay', mode: 'tdm', map: 'yard' });
    const joined = await c.waitFor('joined');
    let sp: ServerMsgOf<'spawned'> = await nextSpawn();
    expect(sp.loadout.perks).toEqual(['lightweight', 'warlord']);
    expect(sp.loadout.primary.attachments).toEqual(['reddot', 'extmag']);
    let snap = await snapWith(['reddot', 'extmag']);
    expect(snap.me!.weapons[0]!.mag).toBe(45); // extended mag: 30 x 1.5
    expect(await nextEquip()).toMatchObject({ lethal: 'frag', lethalN: 1, tactical: 'flashbang', tacticalN: 2 });
    const room = server.lobby.get(joined.roomId)!;
    const me = room.players.get(welcome.sessionId)!;
    expect(me.weapons[0]!.def.attachmentIds).toEqual(['reddot', 'extmag']);

    // Mid-match switch to a class without Warlord (two attachments forced into the profile, as an
    // old save might have): the next life keeps only the first.
    prof.loadouts[4]!.primary.attachments = ['reddot', 'extmag'];
    await rpc(c, 'frontend.selectClass', { index: 4 });
    mark();
    room.spawn(me);
    sp = await nextSpawn();
    expect(sp.loadout.perks).toEqual(['lightweight', 'steady_aim']);
    expect(sp.loadout.primary.attachments).toEqual(['reddot']);
    snap = await snapWith(['reddot']);
    expect(snap.me!.weapons[0]!.mag).toBe(30);
    expect(me.weapons[0]!.def.attachmentIds).toEqual(['reddot']);

    // Back to Warlord, now with Warlord Pro: both attachments and a grenade of each kind extra.
    const ch = PERK_PRO_CHALLENGES.find((x) => x.id === 'warlord_pro')!;
    prof.challengeProgress[ch.id] = ch.goal;
    await rpc(c, 'frontend.selectClass', { index: 3 });
    mark();
    room.spawn(me);
    sp = await nextSpawn();
    expect(sp.loadout.primary.attachments).toEqual(['reddot', 'extmag']);
    await snapWith(['reddot', 'extmag']);
    expect(await nextEquip()).toMatchObject({ lethal: 'frag', lethalN: 2, tactical: 'flashbang', tacticalN: 3 });
    expect(me.weapons[0]!.def.attachmentIds).toEqual(['reddot', 'extmag']);
    c.send({ t: 'leaveRoom' });
  });
});
