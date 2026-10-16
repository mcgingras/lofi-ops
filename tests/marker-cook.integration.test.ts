/**
 * Over the real server and sockets: the Care Package marker (STREAK raises it, FIRE throws it; the
 * canister flies, settles and smokes in both teams' snapshots, then the crate comes down on it),
 * the frag cook ack naming the input command that pulled the pin, and respawning on the primary
 * (after dying on the secondary, and after a class change) with a client that follows the
 * `frameSlot` rule on the snapshots it has.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { configureRoomBots } from '../src/server/features/bots/api';
import { grant } from '../src/server/features/killstreaks/state';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { EQUIPMENT_BY_ID } from '../src/shared/defs/equipment';
import { KS_ENTITY } from '../src/shared/defs/killstreaks';
import { MAX_LEVEL, XP_TABLE } from '../src/shared/defs/progression';
import { Buttons } from '../src/shared/input';
import { cloneLoadout, DEFAULT_LOADOUTS } from '../src/shared/loadout';
import { createMoveState } from '../src/shared/movement';
import { frameSlot, SPAWN_SLOT } from '../src/client/game/slots';
import { FakeClient, sleep } from './fake-client';

const place = (p: PlayerState, x: number, z: number, y = 0) => {
  p.move = { ...createMoveState(x, y, z), onGround: true };
};

/** Keep a client sending input like a game does (every 30 ms), with buttons and slot from callbacks. */
function pump(c: FakeClient, o: { buttons?: () => number; slot?: () => number; yaw?: number; pitch?: number }) {
  const t = setInterval(() => c.input(o.buttons?.() ?? 0, o.yaw ?? 0, o.pitch ?? 0, 2, o.slot?.() ?? 0), 30);
  return () => clearInterval(t);
}

describe('round 3 over the wire', () => {
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

  function newRoom(): Room {
    const room = server.lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, private: true, countdownSec: 0, botFill: 0 });
    configureRoomBots(room, { fill: false });
    return room;
  }

  it('Care Package: hold the marker, throw it with FIRE, both teams see the canister smoke, the crate lands on it', async () => {
    const room = newRoom();
    const { client: a, me: A } = await join(room, 'Thrower');
    const { client: b, me: B } = await join(room, 'Enemy');
    if (B.team === A.team) {
      B.team = A.team === 0 ? 1 : 0;
      room.spawn(B);
    }
    place(A, -1, 20);
    place(B, 10, -15);
    grant(room, A, 'care_package');
    let buttons = 0;
    const yaw = 0.79;
    const stopA = pump(a, { buttons: () => buttons, yaw });
    const stopB = pump(b, {});
    try {
      await sleep(150);
      buttons = Buttons.STREAK;
      const held = await a.waitFor('feat', (m) => m.id === 'killstreaks.state' && !!(m.data as { marker?: unknown }).marker, 3000);
      expect((held.data as { marker: { id: string } }).marker.id).toBe('care_package');
      buttons = 0;
      await sleep(150);
      buttons = Buttons.FIRE;
      // In flight, then lying and smoking, seen by the enemy too.
      const flying = await b.waitFor('snap', (s) => s.ents.some((e) => e.kind === KS_ENTITY.marker), 3000);
      expect(flying.ents.find((e) => e.kind === KS_ENTITY.marker)!.owner).toBe(A.id);
      buttons = 0;
      const settled = await b.waitFor('snap', (s) => s.ents.some((e) => e.kind === KS_ENTITY.marker && e.s?.k === 1), 6000);
      const can = settled.ents.find((e) => e.kind === KS_ENTITY.marker)!;
      expect(typeof can.s?.sm).toBe('number');
      await a.waitFor('snap', (s) => s.ents.some((e) => e.kind === KS_ENTITY.marker && e.s?.k === 1), 3000);
      expect(A.ext.killstreaks?.ready).toEqual([]);
      const landed = await a.waitFor('snap', (s) => s.ents.some((e) => e.kind === KS_ENTITY.crate && e.s?.l === true), 20000);
      const crate = landed.ents.find((e) => e.kind === KS_ENTITY.crate)!;
      expect(Math.hypot(crate.x - can.x, crate.z - can.z)).toBeLessThan(0.05);
    } finally {
      stopA();
      stopB();
      room.close();
    }
  }, 40000);

  it('frag cook: the server acks the command that pulled the pin', async () => {
    const room = newRoom();
    const { client: a, me: A } = await join(room, 'Cook');
    place(A, -1, 20);
    expect(A.ext.weapons?.lethal).toBe('frag');
    await sleep(100);
    const first = a.input(Buttons.LETHAL, 0, 0, 1);
    const stop = pump(a, { buttons: () => Buttons.LETHAL });
    try {
      const ack = await a.waitFor('feat', (m) => m.id === 'weapons.cook', 3000);
      expect(ack.data).toEqual({ e: 'frag', seq: first, fuse: EQUIPMENT_BY_ID.get('frag')!.fuse });
    } finally {
      stop();
      room.close();
    }
  }, 20000);

  it('respawns on the primary after dying on the secondary, and after a class change', async () => {
    const room = newRoom();
    const { client: a, me: A } = await join(room, 'Respawner');
    place(A, -1, 20);
    // The client's slot rule on the snapshots it has (stale between `spawned` and the next snap).
    let cur = 0;
    let want = 0;
    let seenSpawns = a.all('spawned').length;
    const stop = pump(a, {
      slot: () => {
        // Match: 'spawned' resets the slot; `alive` comes from the last snapshot (stale for a moment).
        if (a.all('spawned').length > seenSpawns) {
          seenSpawns = a.all('spawned').length;
          cur = SPAWN_SLOT;
        }
        const alive = !!a.last('snap')?.me?.alive;
        cur = frameSlot({ slot: cur, want, alive, playing: true, weapons: 2 }).slot;
        want = cur;
        return cur;
      },
    });
    const switches: { t: number; slot: number }[] = [];
    room.bus.on('weaponSwitch', ({ player, slot }) => {
      if (player === A) switches.push({ t: room.time, slot });
    });
    const lifeOnSecondaryThenDie = async () => {
      want = 1;
      await a.waitFor('snap', (s) => s.me?.slot === 1 && !!s.me.alive, 3000);
      room.kill(A, null, { weapon: 'world', means: 'world' });
      await a.waitFor('snap', (s) => !s.me?.alive, 3000);
    };
    try {
      await lifeOnSecondaryThenDie();
      const n = a.all('spawned').length;
      const sp = await a.waitFor('spawned', () => a.all('spawned').length > n, 8000);
      const at = room.time;
      await sleep(700);
      expect(A.slot).toBe(0);
      expect(a.last('snap')!.me!.slot).toBe(0);
      expect(switches.filter((s) => s.t >= at)).toEqual([]);
      expect(sp.loadout.primary.weapon).toBe(A.weapons[0]!.def.base.id);

      // Class change while dead: the new class's primary in hand (a levelled profile, so the
      // second class slot and the MP5K are unlocked).
      A.profile!.xp = XP_TABLE[MAX_LEVEL]!;
      A.profile!.level = MAX_LEVEL;
      A.profile!.loadouts[1] = { ...cloneLoadout(DEFAULT_LOADOUTS[0]!), primary: { weapon: 'mp5k', attachments: [], camo: 'none' } };
      await lifeOnSecondaryThenDie();
      a.send({ t: 'selectLoadout', index: 1 });
      const n2 = a.all('spawned').length;
      await a.waitFor('spawned', () => a.all('spawned').length > n2, 8000);
      const at2 = room.time;
      await sleep(700);
      expect(A.weapons[0]!.def.base.id).toBe('mp5k');
      expect(A.slot).toBe(0);
      expect(switches.filter((s) => s.t >= at2)).toEqual([]);
    } finally {
      stop();
      room.close();
    }
  }, 40000);
});
