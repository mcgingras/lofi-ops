/**
 * The Mystery Box and the wonder weapons over the real server and sockets:
 *
 * - STREAK raises the box canister (state push), FIRE throws it; the enemy sees the canister
 *   (`s.mb`), hears the call ("killstreaks.called"), and sees the box come down; the owner holds
 *   USE at it, the lid opens and the roll is in the snapshot, the offer starts after the cycle,
 *   a fresh USE puts the wonder weapon in their hands (their snapshot's weapons say so), and the
 *   box flies off and leaves the snapshots.
 * - A Ray Gun shot from a client: the enemy sees the bolt in flight, everyone gets the splash
 *   effect and the killfeed names the Ray Gun; a Thundergun blast launches the enemy, whose own
 *   snapshot carries the knock for its prediction.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { configureRoomBots } from '../src/server/features/bots/api';
import { grant } from '../src/server/features/killstreaks/state';
import { makeWeapon, type PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { PLAYER } from '../src/shared/constants';
import { KS_ENTITY } from '../src/shared/defs/killstreaks';
import { BOX_CYCLE_SEC, BOX_PHASE, MYSTERY_BOX, MYSTERY_BOX_ENTITY } from '../src/shared/defs/mystery-box';
import type { KillstreakStateMsg } from '../src/shared/defs/perks-streaks-protocol';
import { isWonderWeapon } from '../src/shared/defs/weapons';
import { WONDER_ENTITY, type WonderFx } from '../src/shared/defs/wonder';
import { Buttons } from '../src/shared/input';
import { createMoveState } from '../src/shared/movement';
import { FakeClient, sleep } from './fake-client';

const place = (p: PlayerState, x: number, z: number, yaw = 0) => {
  p.move = { ...createMoveState(x, 0, z), onGround: true };
  p.yaw = yaw;
};

describe('Mystery Box and wonder weapons over the wire', () => {
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

  async function pair() {
    const room = server.lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, private: true, countdownSec: 0, botFill: 0 });
    configureRoomBots(room, { fill: false });
    const { client: a, me: A } = await join(room, 'Owner');
    const { client: b, me: B } = await join(room, 'Enemy');
    if (B.team === A.team) {
      B.team = A.team === 0 ? 1 : 0;
      room.spawn(B);
    }
    return { room, a, A, b, B };
  }

  it('throw the marker, watch it come down, open it, take the wonder weapon, see it fly away', async () => {
    const { room, a, A, b, B } = await pair();
    place(A, 0, 26, 0);
    place(B, 14, -20);
    grant(room, A, 'mystery_box');
    let buttons = 0;
    let yaw = 0;
    let pitch = 0.3;
    const pa = setInterval(() => a.input(buttons, yaw, pitch, 2, A.slot), 30);
    const pb = setInterval(() => b.input(0, 0, 0, 2), 30);
    const st = (m: { data: unknown }) => m.data as KillstreakStateMsg;
    const tap = async (bits: number) => {
      buttons = bits;
      await sleep(90);
      buttons = 0;
      await sleep(80);
    };
    try {
      await sleep(150);
      await tap(Buttons.STREAK);
      const up = await a.waitFor('feat', (m) => m.id === 'killstreaks.state' && st(m).marker?.id === 'mystery_box', 3000);
      expect(up).toBeDefined();
      await sleep(700); // the gun goes down: FIRE throws, it never shoots
      await tap(Buttons.FIRE);
      const called = await b.waitFor('feat', (m) => m.id === 'killstreaks.called' && (m.data as { id: string }).id === 'mystery_box', 3000);
      expect((called.data as { owner: string }).owner).toBe(A.id);
      // The enemy sees the box's canister, then the box itself.
      await b.waitFor('snap', (s) => s.ents.some((e) => e.kind === KS_ENTITY.marker && e.s?.mb === 1), 3000);
      const coming = await b.waitFor('snap', (s) => s.ents.some((e) => e.kind === MYSTERY_BOX_ENTITY && e.owner === A.id), 6000);
      const boxSnap = coming.ents.find((e) => e.kind === MYSTERY_BOX_ENTITY)!;
      expect(boxSnap.s?.ph).toBe(BOX_PHASE.call);
      const tl = boxSnap.s!.tl as number;
      expect(tl - (boxSnap.s!.t0 as number)).toBeCloseTo(MYSTERY_BOX.descendAt + MYSTERY_BOX.descendSec, 2);
      await a.waitFor('snap', (s) => s.ents.some((e) => e.id === boxSnap.id && e.s?.ph === BOX_PHASE.idle), 8000);
      // Walk up (teleport) and hold USE.
      place(A, boxSnap.x - 1.2, boxSnap.z, -Math.PI / 2);
      yaw = -Math.PI / 2;
      pitch = 0;
      buttons = Buttons.USE;
      const opened = await a.waitFor('snap', (s) => s.ents.some((e) => e.id === boxSnap.id && e.s?.ph === BOX_PHASE.open), 3000);
      const roll = opened.ents.find((e) => e.id === boxSnap.id)!.s!.w as string;
      expect(isWonderWeapon(roll)).toBe(true);
      // The enemy sees the same roll and cycle timing.
      const seen = await b.waitFor('snap', (s) => s.ents.some((e) => e.id === boxSnap.id && e.s?.ph === BOX_PHASE.open), 3000);
      expect(seen.ents.find((e) => e.id === boxSnap.id)!.s!.w).toBe(roll);
      buttons = 0;
      await sleep(BOX_CYCLE_SEC * 1000 + 200);
      await a.waitFor('snap', (s) => s.ents.some((e) => e.id === boxSnap.id && e.s?.ph === BOX_PHASE.offer), 3000);
      await tap(Buttons.USE);
      const mine = await a.waitFor('snap', (s) => !!s.me && s.me.weapons.some((w) => w.id === roll), 3000);
      expect(mine.me!.weapons[mine.me!.slot]!.id).toBe(roll);
      await a.waitFor('snap', (s) => s.ents.some((e) => e.id === boxSnap.id && e.s?.ph === BOX_PHASE.leave && e.s?.tk === 1), 3000);
      await b.waitFor('snap', (s) => s.ents.some((e) => e.kind === MYSTERY_BOX_ENTITY) === false && s.time > tl + 1, (MYSTERY_BOX.closeSec + MYSTERY_BOX.leaveSec) * 1000 + 3000);
    } finally {
      clearInterval(pa);
      clearInterval(pb);
      room.close();
    }
  }, 40000);

  it('Ray Gun bolt seen in flight with its splash and killfeed; a Thundergun launch reaches the victim\'s snapshot', async () => {
    const { room, a, A, b, B } = await pair();
    room.modifiers.add('regenDelayMultiplier', () => 1000, 'test.noregen');
    place(A, -10, 20, -Math.PI / 2);
    place(B, 10, 20);
    const arm = (id: string) => {
      const w = makeWeapon({ weapon: id, attachments: [], camo: 'none' }, id);
      A.weapons[0] = w;
      A.slot = 0;
      A.swapEnd = 0;
    };
    arm('raygun');
    const pa = setInterval(() => a.input(0, -Math.PI / 2, 0, 2, 0), 30);
    const pb = setInterval(() => b.input(0, 0, 0, 2), 30);
    try {
      await sleep(300);
      const eye: [number, number, number] = [A.move.x, A.move.y + PLAYER.eye, A.move.z];
      const to = { x: B.move.x, y: B.move.y + 1.1, z: B.move.z };
      const d = [to.x - eye[0], to.y - eye[1], to.z - eye[2]];
      const l = Math.hypot(d[0]!, d[1]!, d[2]!);
      const spawnsBefore = b.all('spawned').length;
      a.send({ t: 'fire', seq: a.seq, time: room.time, origin: eye, dir: [d[0]! / l, d[1]! / l, d[2]! / l], shot: 1 });

      await b.waitFor('snap', (s) => s.ents.some((e) => e.kind === WONDER_ENTITY.bolt && e.owner === A.id), 3000);
      const fx = await b.waitFor('feat', (m) => m.id === 'weapons.wonderFx' && (m.data as WonderFx).k === 'splash', 3000);
      expect((fx.data as WonderFx & { p: string }).p).toBe(A.id);
      await a.waitFor('feat', (m) => m.id === 'weapons.wonderFx' && (m.data as WonderFx).k === 'splash', 3000);
      const kf = await a.waitFor('killfeed', (k) => k.victim === B.id, 3000);
      expect(kf.weapon).toBe('raygun');
      expect(kf.attacker).toBe(A.id);

      // Thundergun: wait for B to respawn, put them in front, blast.
      await b.waitFor('spawned', (m) => b.all('spawned').indexOf(m) >= spawnsBefore, 8000);
      await sleep(200);
      place(B, 1, 20); // 11 m: hurt and launched, not killed
      arm('thundergun');
      await sleep(100);
      const eye2: [number, number, number] = [A.move.x, A.move.y + PLAYER.eye, A.move.z];
      a.send({ t: 'fire', seq: a.seq, time: room.time, origin: eye2, dir: [1, 0, 0], shot: 2 });
      await b.waitFor('feat', (m) => m.id === 'weapons.wonderFx' && (m.data as WonderFx).k === 'blast', 3000);
      const knocked = await b.waitFor('snap', (s) => !!s.me && s.me.alive && s.me.move.knock > 0, 3000);
      expect(knocked.me!.move.vx).toBeGreaterThan(5);
    } finally {
      clearInterval(pa);
      clearInterval(pb);
      room.close();
    }
  }, 30000);
});
