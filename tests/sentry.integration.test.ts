/**
 * Sentry Gun carry-to-place over the real server and sockets: STREAK brings the turret up (state
 * push `carry`, the enemy sees it in front of the carrier with `s.c`), STREAK again puts it away and
 * keeps the streak, STREAK + FIRE puts it down where the shared placement rule says (the client's
 * preview), USE picks it back up and FIRE puts it down again; a sentry tracking the enemy shows it
 * in its snapshot state (`s.t`) before any damage lands.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { configureRoomBots } from '../src/server/features/bots/api';
import { grant } from '../src/server/features/killstreaks/state';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { KS_ENTITY } from '../src/shared/defs/killstreaks';
import type { KillstreakStateMsg } from '../src/shared/defs/perks-streaks-protocol';
import { SENTRY } from '../src/shared/defs/sentry';
import { turretPlacement } from '../src/shared/defs/turret-place';
import { Buttons } from '../src/shared/input';
import { quantizeAngle } from '../src/shared/math';
import { createMoveState } from '../src/shared/movement';
import { FakeClient, sleep } from './fake-client';

const place = (p: PlayerState, x: number, z: number, y = 0) => {
  p.move = { ...createMoveState(x, y, z), onGround: true };
};

describe('Sentry Gun over the wire', () => {
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

  it('carry, cancel, place where the preview says, pick up, place again, track', async () => {
    const room = server.lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, private: true, countdownSec: 0, botFill: 0 });
    configureRoomBots(room, { fill: false });
    const { client: a, me: A } = await join(room, 'Gunner');
    const { client: b, me: B } = await join(room, 'Enemy');
    if (B.team === A.team) {
      B.team = A.team === 0 ? 1 : 0;
      room.spawn(B);
    }
    place(A, -1, 20);
    place(B, 22, -20);
    B.health = B.maxHealth = 1e6;
    grant(room, A, 'sentry_gun');
    let buttons = 0;
    const yaw = 0.3;
    const pa = setInterval(() => a.input(buttons, yaw, 0, 2), 30);
    const pb = setInterval(() => b.input(0, 0, 0, 2), 30);
    const st = (m: { data: unknown }) => m.data as KillstreakStateMsg;
    const tap = async (bits: number) => {
      buttons = bits;
      await sleep(90);
      buttons = 0;
      await sleep(80);
    };
    const since = (c: FakeClient) => c.all('feat').length;
    try {
      await sleep(150);
      let n = since(a);
      await tap(Buttons.STREAK);
      await a.waitFor('feat', (m) => m.id === 'killstreaks.state' && !!st(m).carry, 3000);
      expect(a.all('feat').length).toBeGreaterThan(n);
      // The enemy sees it in the carrier's hands (on the floor in front of them).
      const seen = await b.waitFor('snap', (s) => s.ents.some((e) => e.kind === KS_ENTITY.sentry && e.owner === A.id && e.s?.c === 1), 3000);
      expect(seen).toBeDefined();
      // STREAK again: away, streak kept.
      n = a.all('feat').length;
      await tap(Buttons.STREAK);
      const away = await a.waitFor('feat', (m) => a.all('feat').indexOf(m) >= n && m.id === 'killstreaks.state' && !st(m).carry, 3000);
      expect(st(away).ready).toContain('sentry_gun');
      // Up again and put it down with FIRE.
      await tap(Buttons.STREAK);
      await a.waitFor('feat', (m) => m.id === 'killstreaks.state' && !!st(m).carry && !st(m).carry!.moved, 3000);
      await sleep(100);
      const preview = turretPlacement(room.world, room.map, A.move, quantizeAngle(yaw));
      expect(preview.valid).toBe(true);
      n = a.all('feat').length;
      await tap(Buttons.FIRE);
      const placed = await a.waitFor('feat', (m) => a.all('feat').indexOf(m) >= n && m.id === 'killstreaks.state' && !st(m).carry, 3000);
      expect(st(placed).ready).not.toContain('sentry_gun');
      const snap = await b.waitFor('snap', (s) => s.ents.some((e) => e.kind === KS_ENTITY.sentry && e.owner === A.id && e.s?.c !== 1), 3000);
      const ent = snap.ents.find((e) => e.kind === KS_ENTITY.sentry && e.owner === A.id)!;
      expect(Math.hypot(ent.x - preview.x, ent.z - preview.z)).toBeLessThan(0.05);
      expect(ent.s?.b).toBeCloseTo(preview.yaw, 2);
      // USE beside it picks it up; FIRE puts it down again.
      n = a.all('feat').length;
      await tap(Buttons.USE);
      const moved = await a.waitFor('feat', (m) => a.all('feat').indexOf(m) >= n && m.id === 'killstreaks.state' && !!st(m).carry?.moved, 3000);
      expect(st(moved).carry).toEqual({ id: 'sentry_gun', moved: true });
      n = a.all('feat').length;
      await tap(Buttons.FIRE);
      await a.waitFor('feat', (m) => a.all('feat').indexOf(m) >= n && m.id === 'killstreaks.state' && !st(m).carry, 3000);
      // The enemy walks into its arc: it tracks them (s.t) before the first bullet.
      const t = room.entities.byKind(KS_ENTITY.sentry)[0]!;
      await sleep(SENTRY.armSec * 1000 + 100);
      const d = 8;
      place(B, t.x - Math.sin(yaw) * d, t.z - Math.cos(yaw) * d);
      const tracked = await b.waitFor('snap', (s) => s.ents.some((e) => e.id === t.id && e.s?.t === B.id), 3000);
      expect(tracked).toBeDefined();
      const hp = B.health;
      expect(hp).toBe(B.maxHealth);
      await b.waitFor('snap', (s) => s.ents.some((e) => e.id === t.id && e.s?.a === 1), 3000);
      await sleep(1500);
      expect(B.health).toBeLessThan(hp);
    } finally {
      clearInterval(pa);
      clearInterval(pb);
    }
  }, 20000);
});
