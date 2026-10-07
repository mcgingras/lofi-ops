/**
 * Weapon drops and pickups through the real server and sockets: a kill drops the victim's gun
 * (snapshot entity with its weapon, attachments, ammo), a human holding USE next to it swaps (the
 * `me` snapshot carries the new gun and its ammo, the old one lies on the floor), the server refuses
 * from too far away, kills with a picked-up gun count for the picker's weapon stats and not for
 * the gun's previous owner, and a dry bot (real bots brain) walks to a gun and takes it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { configureRoomBots } from '../src/server/features/bots/api';
import { dropsOf, spawnDrop } from '../src/server/features/pickups/index';
import { eyeOf } from '../src/server/combat';
import { makeWeapon, type PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { skillFor, DEFAULT_LOBBY_BOTS } from '../src/shared/defs/bots';
import { PICKUP_ENTITY, type DropSnapState } from '../src/shared/defs/pickups';
import { MAX_LEVEL, XP_TABLE } from '../src/shared/defs/progression';
import { Buttons } from '../src/shared/input';
import { cloneLoadout, DEFAULT_LOADOUTS } from '../src/shared/loadout';
import { createMoveState } from '../src/shared/movement';
import { FakeClient, sleep } from './fake-client';

const place = (p: PlayerState, x: number, z: number, y = 0) => {
  p.move = { ...createMoveState(x, y, z), onGround: true };
};
const idle = (p: PlayerState) => {
  p.brain = { think: () => null };
};
const aimAt = (p: PlayerState, t: { x: number; y: number; z: number }) => {
  const e = eyeOf(p);
  const dx = t.x - e.x;
  const dy = t.y - e.y;
  const dz = t.z - e.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), dir: [dx, dy, dz].map((v) => v / Math.hypot(dx, dy, dz)) as [number, number, number] };
};
async function until(cond: () => boolean, ms = 6000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return true;
    await sleep(20);
  }
  return cond();
}
/** Hold buttons for `ms` (inputs every ~30 ms, as a client would). */
async function holdFor(c: FakeClient, buttons: number, yaw: number, pitch: number, ms: number, slot = 0) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    c.input(buttons, yaw, pitch, 2, slot);
    await sleep(30);
  }
}

describe('weapon pickups over the wire', () => {
  let server: GameServer;
  const clients: FakeClient[] = [];

  beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
  });
  afterAll(async () => {
    for (const c of clients) c.close();
    await server.close();
  });

  async function join(room: Room, name: string, primary = 'ak47') {
    const { client, welcome } = await FakeClient.connect(server.url, name);
    clients.push(client);
    client.send({ t: 'joinRoom', roomId: room.id });
    await client.waitFor('joined');
    const me = room.players.get(welcome.sessionId)!;
    me.profile!.xp = XP_TABLE[MAX_LEVEL]!;
    me.profile!.level = MAX_LEVEL;
    me.profile!.loadouts[0] = { ...cloneLoadout(DEFAULT_LOADOUTS[0]!), primary: { weapon: primary, attachments: [], camo: 'none' } };
    me.profile!.selectedLoadout = 0;
    room.spawn(me);
    return { client, me };
  }

  it('drop on death, swap with USE (server checks reach), picked-up kills count for the picker', async () => {
    const room = server.lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, private: true });
    configureRoomBots(room, { fill: false });
    const { client: a, me: A } = await join(room, 'Picker');
    const { me: B } = await join(room, 'Owner', 'famas');
    const enemyOfA = A.team === 0 ? 1 : 0;
    if (B.team === A.team) B.team = enemyOfA;
    room.spawn(B);
    expect(B.weapons[0]!.def.base.id).toBe('famas');
    B.weapons[0] = makeWeapon({ weapon: 'famas', attachments: ['reddot'], camo: 'none' }, 'famas'); // (red dot is kill-locked for a new profile)
    B.weapons[0]!.mag = 11;
    B.weapons[0]!.reserve = 44;

    // B dies at (-1, 4): the FAMAS (red dot, 11 + 44) drops and shows up in A's snapshots.
    place(B, -1, 4);
    room.kill(B, null, { weapon: 'world', means: 'world' });
    const snap = await a.waitFor('snap', (s) => s.ents.some((e) => e.kind === PICKUP_ENTITY && (e.s as unknown as DropSnapState).l === true), 5000);
    const ent = snap.ents.find((e) => e.kind === PICKUP_ENTITY)!;
    expect(ent.s).toMatchObject({ w: 'famas', a: 'reddot', m: 11, r: 44, l: true, o: B.id });

    // Too far: holding USE does nothing.
    place(A, -1, 4 + 3);
    let aim = aimAt(A, ent);
    await holdFor(a, Buttons.USE, aim.yaw, aim.pitch, 400);
    expect(A.weapons[0]!.def.base.id).toBe('ak47');
    await holdFor(a, 0, aim.yaw, aim.pitch, 100);

    // In reach: hold USE and the guns change hands.
    place(A, -1, 4 + 1.1);
    aim = aimAt(A, ent);
    const before = a.msgs.length;
    await holdFor(a, Buttons.USE, aim.yaw, aim.pitch, 500);
    const swapped = await a.waitFor('feat', (m) => m.id === 'pickups.swapped');
    expect(swapped.data).toEqual({ taken: 'famas', dropped: 'ak47', slot: 0 });
    const after = await a.waitFor('snap', (s) => a.msgs.indexOf(s) > before && s.me?.weapons[0]?.id === 'famas');
    expect(after.me!.weapons[0]).toMatchObject({ id: 'famas', attachments: ['reddot'], mag: 11, reserve: 44 });
    expect(after.ents.some((e) => e.kind === PICKUP_ENTITY && (e.s as unknown as DropSnapState).w === 'ak47' && (e.s as unknown as DropSnapState).o === A.id)).toBe(true);
    await holdFor(a, 0, aim.yaw, aim.pitch, 100);

    // A kills an idle bot with B's old FAMAS: A's FAMAS stats count it, B's don't.
    const bot = room.addBot({ name: 'Target', team: enemyOfA });
    idle(bot);
    if (!bot.alive) room.spawn(bot);
    place(bot, -1, 1.5);
    await sleep(700); // the FAMAS is up (swap time); the bot's new spot is in the hitbox history
    bot.health = 1;
    const shot = aimAt(A, { x: -1, y: 1.3, z: 1.5 });
    a.input(0, shot.yaw, shot.pitch, 2);
    const e = eyeOf(A);
    a.send({ t: 'fire', seq: a.seq, time: room.time, origin: [e.x, e.y, e.z], dir: shot.dir, shot: 1 });
    expect(await until(() => !bot.alive, 3000)).toBe(true);
    expect(A.profile!.stats['weapon.famas.kills']).toBe(1);
    expect(B.profile!.stats['weapon.famas.kills'] ?? 0).toBe(0);
    room.close();
  });

  it('a dry bot walks to a gun on the floor and takes it', async () => {
    const room = server.lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, private: true });
    configureRoomBots(room, { fill: false, difficulty: 'custom', variance: 0, custom: { ...skillFor(DEFAULT_LOBBY_BOTS), weaponPickup: 1, objectivePlay: 1 } });
    const bot = room.addBot({ name: 'Scrounger', team: 0 });
    if (!bot.alive) room.spawn(bot);
    expect(bot.brain).toBeTruthy();
    place(bot, -1, 9);
    for (const w of bot.weapons) w.mag = w.reserve = 0;
    const gun = makeWeapon({ weapon: 'famas', attachments: [], camo: 'none' }, 'famas');
    spawnDrop(room, gun, { x: -1, y: 0, z: 3 }, { x: 0, y: 0, z: 0 }, null, null, 'death');
    expect(await until(() => bot.weapons.some((w) => w.def.base.id === 'famas'), 12000)).toBe(true);
    expect(dropsOf(room).some((d) => d.data.weapon === 'famas')).toBe(false);
    room.close();
  });
});
