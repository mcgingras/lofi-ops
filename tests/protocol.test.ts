import { describe, expect, it } from 'vitest';
import { Buttons } from '../src/shared/input';
import { createMoveState } from '../src/shared/movement';
import { decodeClientMsg, decodeServerMsg, encodeMsg, isInputCmd, jsonCodec, setCodec, type ClientMsg, type ServerMsg } from '../src/shared/protocol';

describe('protocol', () => {
  it('round-trips client messages', () => {
    const msgs: ClientMsg[] = [
      { t: 'hello', token: 'abc', version: 1 },
      { t: 'input', cmds: [{ seq: 1, dt: 1 / 60, buttons: Buttons.FORWARD | Buttons.SPRINT, yaw: 0.5, pitch: -0.1, weaponSlot: 0 }] },
      { t: 'fire', seq: 4, time: 12.5, origin: [1, 2, 3], dir: [0, 0, -1], shot: 9 },
      { t: 'rpc', id: 'killstreak.call', data: { id: 'uav' }, rid: 3 },
    ];
    for (const m of msgs) expect(decodeClientMsg(encodeMsg(m))).toEqual(m);
  });

  it('round-trips a snapshot', () => {
    const snap: ServerMsg = {
      t: 'snap',
      tick: 30,
      time: 0.5,
      ack: 12,
      phase: 'playing',
      me: { id: 'a', alive: true, health: 100, maxHealth: 100, move: createMoveState(1, 0, 2), params: { speed: 1, adsTime: 0.25, adsMove: 0.6, sprint: 1, canSprint: true, jump: 1, canMove: true }, slot: 0, weapons: [{ id: 'ak47', attachments: [], camo: 'none', mag: 30, reserve: 120 }], reloadEnd: 0, swapEnd: 0, respawnAt: null, streak: 0 },
      players: [{ id: 'b', x: 1, y: 0, z: 2, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, f: 17, w: 'ak47', c: 'none' }],
      ents: [],
      shots: [{ p: 'b', o: [0, 1, 0], e: [0, 1, -10], w: 'ak47', h: 1 }],
      teams: [3, 4],
      timeLeft: 100,
      radar: ['b'],
      jammed: false,
    };
    expect(decodeServerMsg(encodeMsg(snap))).toEqual(snap);
  });

  it('rejects garbage and unknown tags', () => {
    expect(decodeClientMsg('not json')).toBeNull();
    expect(decodeClientMsg('{"t":"nope"}')).toBeNull();
    expect(decodeClientMsg('[1,2]')).toBeNull();
    expect(decodeServerMsg('{"t":"hello"}')).toBeNull();
    expect(isInputCmd({ seq: 1, dt: 0.016, buttons: 0, yaw: 0, pitch: 0, weaponSlot: 0 })).toBe(true);
    expect(isInputCmd({ seq: 1, dt: 'x', buttons: 0, yaw: 0, pitch: 0, weaponSlot: 0 })).toBe(false);
  });

  it('codec is swappable', () => {
    let used = 0;
    setCodec({ encode: (m) => (used++, new TextEncoder().encode(JSON.stringify(m))), decode: jsonCodec.decode });
    const m: ClientMsg = { t: 'ping', t0: 5 };
    const wire = encodeMsg(m);
    expect(wire).toBeInstanceOf(Uint8Array);
    expect(decodeClientMsg(wire)).toEqual(m);
    expect(used).toBe(1);
    setCodec(jsonCodec);
  });
});
