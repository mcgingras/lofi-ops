/**
 * Weapons through the real server and sockets: equipment push at spawn, knife on the MELEE
 * button (killfeed 'knife'), a frag thrown on the LETHAL button that shows up as a snapshot
 * entity and explodes for everyone, and a Stakeout picked through the profile loadout.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { NADE_ENTITY } from '../src/shared/defs/equipment';
import { Buttons } from '../src/shared/input';
import { createMoveState } from '../src/shared/movement';
import { FakeClient, sleep } from './fake-client';

type Feat = { t: 'feat'; id: string; data: unknown };

describe('weapons over real sockets', () => {
  let server: GameServer;
  const clients: FakeClient[] = [];

  beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
  });
  afterAll(async () => {
    for (const c of clients) c.close();
    await server.close();
  });

  it('knife kill, frag throw and explosion, shell reload', async () => {
    const { client: a, welcome: wa } = await FakeClient.connect(server.url, 'Knifer');
    const { client: b, welcome: wb } = await FakeClient.connect(server.url, 'Victim');
    clients.push(a, b);
    a.send({ t: 'quickplay', mode: 'tdm', map: 'yard' });
    const ja = await a.waitFor('joined');
    b.send({ t: 'quickplay', mode: 'tdm', map: 'yard' });
    await b.waitFor('joined');
    await a.waitFor('snap', (s) => s.players.length === 2);

    // Equipment for this life arrives as a feature push (default class: frag + flashbang).
    const equip = (await a.waitFor('feat', (m) => m.id === 'weapons.equip')) as Feat;
    expect(equip.data).toMatchObject({ lethal: 'frag', lethalN: 1, tactical: 'flashbang', tacticalN: 2 });

    const room = server.lobby.get(ja.roomId)!;
    const knifer = room.players.get(wa.sessionId)!;
    const victim = room.players.get(wb.sessionId)!;
    knifer.move = { ...createMoveState(-1, 0, 1.6), onGround: true };
    victim.move = { ...createMoveState(-1, 0, 0), onGround: true };
    for (let i = 0; i < 4; i++) {
      a.input(0, 0, 0);
      b.input(0, 0, 0);
      await sleep(30);
    }

    // V: knife.
    a.input(Buttons.MELEE, 0, 0, 2);
    a.input(0, 0, 0, 2);
    const feed = await b.waitFor('killfeed', (k) => k.victim === wb.sessionId);
    expect(feed).toMatchObject({ attacker: wa.sessionId, weapon: 'knife', means: 'melee' });
    const swing = (await b.waitFor('feat', (m) => m.id === 'weapons.melee')) as Feat;
    expect(swing.data).toEqual({ p: wa.sessionId, hit: true });

    // G: frag. Tap it (no cook); it leaves the hand, flies as a snapshot entity, then explodes.
    await sleep(1000); // knife recovery / cooldown
    a.input(Buttons.LETHAL, 0, 0.3, 2);
    a.input(0, 0, 0.3, 2);
    const withNade = await a.waitFor('snap', (s) => s.ents.some((e) => e.kind === NADE_ENTITY && e.s?.e === 'frag'), 3000);
    expect(withNade.ents.find((e) => e.kind === NADE_ENTITY)!.owner).toBe(wa.sessionId);
    const thrown = (await b.waitFor('feat', (m) => m.id === 'weapons.throw')) as Feat;
    expect(thrown.data).toEqual({ p: wa.sessionId, e: 'frag' });
    const boom = (await b.waitFor('feat', (m) => m.id === 'weapons.boom', 5000)) as Feat;
    expect((boom.data as { e: string }).e).toBe('frag');
    const after = (await a.waitFor('feat', (m) => m.id === 'weapons.equip' && (m.data as { lethalN: number }).lethalN === 0)) as Feat;
    expect(after.data).toMatchObject({ lethalN: 0 });
    // Keep inputs flowing so the server keeps simulating us normally.
    a.input(0, 0, 0, 2);

    // A Stakeout from the profile loadout: shell-by-shell reload over the wire.
    const prof = server.sessions.get(wa.sessionId)!.profile;
    prof.loadouts[prof.selectedLoadout]!.primary = { weapon: 'stakeout', attachments: ['grip'], camo: 'none' };
    // The economy's spawn-time class check only lets owned, unlocked items through.
    prof.level = 50;
    prof.owned.push('weapon.stakeout', 'att.stakeout.grip');
    prof.stats['weapon.stakeout.kills'] = 100;
    room.spawn(knifer);
    const sp = await a.waitFor('spawned', (m) => m.loadout.primary.weapon === 'stakeout');
    expect(sp.loadout.primary.attachments).toEqual(['grip']);
    knifer.weapons[0]!.mag = 1;
    await sleep(500); // raise
    const seq = a.input(Buttons.RELOAD, 0, 0, 2);
    a.input(0, 0, 0, 1);
    const reloading = await a.waitFor('snap', (s) => s.ack >= seq && s.me!.reloadEnd > 0);
    const startMag = reloading.me!.weapons[0]!.mag;
    expect(startMag).toBe(1);
    for (let i = 0; i < 30; i++) {
      a.input(0, 0, 0, 2);
      await sleep(50);
    }
    const mid = a.last('snap')!;
    expect(mid.me!.weapons[0]!.mag).toBeGreaterThan(1);
  });
});
