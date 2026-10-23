/**
 * Final killcam over the real server and sockets: a TDM match that ends on a shot kill sends both
 * players the clip with the killer, the weapon (card, viewmodel and the gun in the killer's hands
 * in the frames), the killer's shots, and the post-match held for it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import type { Room } from '../src/server/room';
import { PLAYER } from '../src/shared/constants';
import { parseGear, unpackClip } from '../src/shared/defs/deathcam';
import { finalKillcamSeconds, type FinalKillcamPayload } from '../src/shared/defs/killcam';
import { Buttons } from '../src/shared/input';
import { createMoveState } from '../src/shared/movement';
import { FakeClient, sleep } from './fake-client';

let server: GameServer;
let open: FakeClient[] = [];
const botsEnv = process.env.LOFI_BOTS;

beforeAll(async () => {
  process.env.LOFI_BOTS = 'off';
  server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {} });
});
afterEach(() => {
  for (const c of open) c.close();
  open = [];
});
afterAll(async () => {
  await server.close();
  if (botsEnv === undefined) delete process.env.LOFI_BOTS;
  else process.env.LOFI_BOTS = botsEnv;
});

async function join(room: Room, name: string) {
  const { client, welcome } = await FakeClient.connect(server.url, name);
  open.push(client);
  client.send({ t: 'joinRoom', roomId: room.id });
  const joined = await client.waitFor('joined');
  return { client, id: welcome.sessionId, joined };
}
const place = (p: { move: ReturnType<typeof createMoveState> }, x: number, z: number) => {
  p.move = { ...createMoveState(x, 0, z), onGround: true };
};
function dirTo(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): [number, number, number] {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const l = Math.hypot(d.x, d.y, d.z);
  return [d.x / l, d.y / l, d.z / l];
}

describe('final killcam over real sockets', () => {
  it('TDM ends on a kill: everyone gets the clip with the killer, their weapon and their shots', async () => {
    const room = server.lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: true, onEnd: 'close', postMatchSec: 8 });
    const a = await join(room, 'Shooter');
    const b = await join(room, 'Target');
    expect(a.joined.team).not.toBe(b.joined.team);
    await a.client.waitFor('snap', (s) => s.players.length === 2);
    const pa = room.players.get(a.id)!;
    const pb = room.players.get(b.id)!;
    // Some recording before the kill.
    await sleep(1200);
    place(pa, -1, 8);
    place(pb, -1, 0);
    for (let i = 0; i < 12; i++) {
      a.client.input(Buttons.ADS, 0, 0);
      await sleep(50);
    }
    await a.client.waitFor('snap', (s) => s.ack >= a.client.seq && (s.me?.move.ads ?? 0) >= 1);
    room.teamScores[pa.team!] = room.mode.scoreLimit - 1;
    const eye = { x: -1, y: PLAYER.eye, z: 8 };
    let shot = 0;
    for (let i = 0; i < 12 && pb.alive && room.phase === 'playing'; i++) {
      const dir = dirTo(eye, { x: -1, y: 1.15, z: 0 });
      const seq = a.client.input(Buttons.ADS | Buttons.FIRE, 0, Math.asin(dir[1]), 1);
      a.client.send({ t: 'fire', seq, time: room.time - 0.1, origin: [eye.x, eye.y, eye.z], dir, shot: ++shot });
      await sleep(150);
    }
    const weapon = pa.weapons[pa.slot]!.def.base.id;
    for (const c of [a.client, b.client]) {
      const msg = await c.waitFor('feat', (m) => m.id === 'modes.killcam', 8000);
      const k = msg.data as FinalKillcamPayload;
      expect(k).toMatchObject({ killer: a.id, victim: b.id, weapon, means: 'bullet', view: 'eyes', vname: 'Target' });
      expect(k.card.name).toBe('Shooter');
      expect(k.vm?.weapon).toBe(weapon);
      const clip = unpackClip(k.clip);
      expect(clip.frames.length).toBeGreaterThan(20);
      expect(parseGear(clip.gear.get(a.id)!.at(-1)!.gear)?.weapon).toBe(weapon);
      const mine = clip.shots.filter((s) => s.id === a.id);
      expect(mine.length).toBeGreaterThanOrEqual(1);
      expect(mine.some((s) => s.hit)).toBe(true);
      // The post-match waits for it.
      expect(k.endsAt).not.toBeNull();
      expect(k.endsAt! - k.at).toBeGreaterThan(8 + finalKillcamSeconds(k.clip.t0, k.to, k.at) - 0.5);
      const end = await c.waitFor('matchEnd');
      expect(end.results.reason).toBe('score');
    }
    expect(room.phase).toBe('ended');
  }, 20000);
});
