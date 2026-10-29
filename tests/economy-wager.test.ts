/**
 * Wager modes and escrow, driven room-by-room without timers (room.step()). The economy feature's
 * real setup() runs against an in-memory store; humans are Sessions over a fake socket so the
 * messages they get (rpc results, feature pushes) can be inspected.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { registerWeaponBehavior } from '../src/server/combat';
import bots from '../src/server/features/bots/index';
import { botBrain, getRoomBots } from '../src/server/features/bots/api';
import economy, { wagersFor } from '../src/server/features/economy/index';
import { dropBlade } from '../src/server/features/economy/projectiles';
import weapons from '../src/server/features/weapons/index';
import type { Feature } from '../src/server/feature';
import { gunGameLadder } from '../src/server/features/economy/modes/gungame';
import type { ServerApi } from '../src/server/feature';
import { Lobby } from '../src/server/lobby';
import { registerMode } from '../src/server/modes/index';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { RpcRegistry } from '../src/server/rpc';
import { Session } from '../src/server/session';
import { Store } from '../src/server/store';
import { PLAYER, TICK_DT } from '../src/shared/constants';
import { MATCHMAKING_WAIT_SEC } from '../src/shared/defs/bots';
import type { EconomyResultsExt } from '../src/shared/defs/economy-net';
import { BLADE_ENTITY, BOLT, BOLT_ENTITY, OITC, STICKS } from '../src/shared/defs/economy';
import { TOMAHAWK_ENTITY } from '../src/shared/defs/equipment';
import { DEFAULT_LOADOUTS } from '../src/shared/loadout';
import { Buttons } from '../src/shared/input';
import { yawTo } from '../src/shared/math';
import { createMoveState } from '../src/shared/movement';
import { decodeServerMsg, type ServerMsg } from '../src/shared/protocol';

let worlds: { lobby: Lobby; store: Store }[] = [];
afterEach(() => {
  for (const w of worlds) {
    w.lobby.shutdown();
    w.store.close();
  }
  worlds = [];
});

interface Human extends Session {
  log: ServerMsg[];
}

function world(features: Feature[] = [economy]) {
  const store = new Store(':memory:');
  const sessions: Session[] = [];
  const rpc = new RpcRegistry();
  const lobby = new Lobby({ store, features, log: () => {}, autoTick: false });
  const api: ServerApi = { lobby, store, rpc, registerMode, registerWeaponBehavior, sessions: () => sessions.values(), log: () => {} };
  for (const f of features) f.setup?.(api);
  worlds.push({ lobby, store });
  let n = 0;
  const human = (name: string, cp = 20000): Human => {
    const prof = store.authenticate(null, name).profile;
    prof.codPoints = cp;
    prof.name = name;
    const log: ServerMsg[] = [];
    const ws = { readyState: 1, bufferedAmount: 0, send: (d: string) => { const m = decodeServerMsg(d); if (m && m.t !== 'snap') log.push(m); }, close() {} } as unknown as WebSocket;
    const s = new Session(`h${++n}`, ws, prof, `token-${name}`) as Human;
    s.log = log;
    sessions.push(s);
    return s;
  };
  let rid = 0;
  const call = async (s: Session, id: string, data: unknown) => {
    const r = ++rid;
    await rpc.dispatch({ session: s, room: s.room, player: s.player }, id, data, r);
    const res = (s as Human).log.find((m) => m.t === 'rpcResult' && m.rid === r) as Extract<ServerMsg, { t: 'rpcResult' }>;
    if (!res.ok) throw new Error(res.error);
    return res.data as Record<string, unknown>;
  };
  return { store, lobby, rpc, human, call, sessions };
}

const steps = (room: Room, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) room.step();
};
const place = (p: PlayerState, x: number, z: number) => {
  p.move = { ...createMoveState(x, 0, z), onGround: true };
};
const aim = (a: PlayerState, b: PlayerState, y = 1.2) => {
  const d = { x: b.move.x - a.move.x, y: b.move.y + y - (a.move.y + PLAYER.eye), z: b.move.z - a.move.z };
  const l = Math.hypot(d.x, d.y, d.z);
  return { x: d.x / l, y: d.y / l, z: d.z / l };
};
/** a shoots b in the open, 8 m apart, until dead (or out of tries). */
function shoot(room: Room, a: PlayerState, b: PlayerState, max = 12) {
  place(a, -1, 8);
  place(b, -1, 0);
  steps(room, 0.7);
  let n = 0;
  while (b.alive && n++ < max) {
    place(a, -1, 8);
    place(b, -1, 0);
    a.move.ads = 1;
    room.fire(a, { dir: aim(a, b) });
    steps(room, 0.15);
  }
  return !b.alive;
}
const feats = (s: Human, id: string) => s.log.filter((m) => m.t === 'feat' && m.id === id).map((m) => (m as Extract<ServerMsg, { t: 'feat' }>).data as Record<string, unknown>);
const ext = (room: Room) => room.results!.ext.economy as EconomyResultsExt;

describe('One in the Chamber', () => {
  it('one bullet, one-shot kills, +1 bullet per kill, three lives then out; last standing wins', () => {
    const { lobby } = world();
    const room = lobby.createRoom({ mode: 'oitc', map: 'yard', closeWhenEmpty: false });
    const a = room.addBot({ name: 'A' });
    const b = room.addBot({ name: 'B' });
    const c = room.addBot({ name: 'C' });
    steps(room, 0.5);
    expect(a.weapons.length).toBe(1);
    expect(a.weapons[0]!.def.base.id).toBe(OITC.weapon);
    expect([a.weapons[0]!.mag, a.weapons[0]!.reserve]).toEqual([1, 0]);

    expect(shoot(room, a, b, 1)).toBe(true); // a single bullet kills
    expect(a.weapons[0]!.mag).toBe(1); // spent one, got one back
    expect(b.ext.wager?.lives).toBe(2);
    for (let i = 0; i < 2; i++) {
      steps(room, 2.2);
      expect(b.alive).toBe(true);
      expect(shoot(room, a, b, 1)).toBe(true);
    }
    expect(b.ext.wager?.out).toBe(true);
    steps(room, 4);
    expect(b.alive).toBe(false);
    expect(room.phase).toBe('playing');
    for (let i = 0; i < 3; i++) {
      if (i) steps(room, 2.2);
      expect(shoot(room, a, c, 1)).toBe(true);
    }
    expect(room.phase).toBe('ended');
    expect(room.results!.players.map((r) => r.name)).toEqual(['A', 'C', 'B']);
    expect(room.results!.winners).toEqual([a.id]);
  });

  it('a dry pistol still has the knife', () => {
    const { lobby } = world();
    const room = lobby.createRoom({ mode: 'oitc', map: 'yard', closeWhenEmpty: false });
    const a = room.addBot({ name: 'A' });
    const b = room.addBot({ name: 'B' });
    steps(room, 0.5);
    place(a, -1, 1.5);
    place(b, -1, 0);
    a.yaw = yawTo(a.move, b.move);
    room.bus.emit('buttons', { player: a, pressed: Buttons.MELEE, released: 0, buttons: Buttons.MELEE });
    expect(b.alive).toBe(false);
    expect(a.weapons[0]!.mag).toBe(2);
  });
});

describe('Gun Game', () => {
  it('promotes on kills, demotes on knife deaths, wins on the last rung', () => {
    const { lobby } = world();
    const room = lobby.createRoom({ mode: 'gungame', map: 'yard', closeWhenEmpty: false });
    const ladder = gunGameLadder();
    const a = room.addBot({ name: 'A' });
    const b = room.addBot({ name: 'B' });
    steps(room, 0.5);
    expect(a.weapons.map((w) => w.def.base.id)).toEqual([ladder[0]]);
    expect(shoot(room, a, b)).toBe(true);
    expect(a.ext.wager?.gunLevel).toBe(1);
    expect(a.weapons[0]!.def.base.id).toBe(ladder[1]);

    steps(room, 3.2);
    place(b, -1, 1.5);
    place(a, -1, 0);
    b.yaw = yawTo(b.move, a.move);
    room.bus.emit('buttons', { player: b, pressed: Buttons.MELEE, released: 0, buttons: Buttons.MELEE });
    expect(a.alive).toBe(false);
    expect(a.ext.wager?.gunLevel).toBe(0);
    expect(b.ext.wager?.gunLevel).toBe(0); // a knife kill doesn't promote

    b.ext.wager!.gunLevel = ladder.length - 1;
    steps(room, 3.2);
    room.kill(a, b, { weapon: ladder.at(-1)!, means: 'bullet' });
    expect(room.phase).toBe('ended');
    expect(room.results!.players[0]!.id).toBe(b.id);
  });
});

describe('Sharpshooter', () => {
  it('everyone shares one gun that rotates; streaks multiply score', () => {
    const { lobby } = world();
    const room = lobby.createRoom({ mode: 'sharpshooter', map: 'yard', closeWhenEmpty: false });
    const ps = [room.addBot({ name: 'A' }), room.addBot({ name: 'B' }), room.addBot({ name: 'C' })];
    steps(room, 0.5);
    const first = ps[0]!.weapons[0]!.def.base.id;
    expect(new Set(ps.map((p) => p.weapons[0]!.def.base.id))).toEqual(new Set([first]));
    steps(room, 45.5);
    const second = ps[0]!.weapons[0]!.def.base.id;
    expect(second).not.toBe(first);
    expect(new Set(ps.map((p) => p.weapons[0]!.def.base.id))).toEqual(new Set([second]));

    const [a, b, c] = ps as [PlayerState, PlayerState, PlayerState];
    const before = a.stats.score;
    room.kill(b, a, { weapon: second, means: 'bullet' });
    room.kill(c, a, { weapon: second, means: 'bullet' });
    expect(a.stats.score - before).toBe(50 + 100); // x1 then x2
    expect(room.modifiers.mul('reloadMultiplier', a)).toBe(0.5);
  });
});

describe('Sticks and Stones', () => {
  const sticksRoom = () => {
    const w = world([economy, weapons]);
    const room = w.lobby.createRoom({ mode: 'sticks', map: 'yard', closeWhenEmpty: false });
    return { ...w, room };
  };
  /** Bot driven by a fixed command each tick (buttons held as given). */
  const drive = (p: PlayerState, cmd: () => { buttons?: number; slot?: number }) => {
    p.brain = { think: () => ({ buttons: cmd().buttons ?? 0, yaw: p.yaw, pitch: p.pitch, weaponSlot: cmd().slot ?? p.slot }) };
  };
  const look = (p: PlayerState, d: { x: number; y: number; z: number }) => {
    p.yaw = Math.atan2(-d.x, -d.z);
    p.pitch = Math.asin(d.y);
  };
  const ammo = (p: PlayerState) => p.weapons.map((w) => [w.def.base.id, w.mag, w.reserve]);
  /** A direction from (x, 1.5, z) that meets a wall 3-10 m away, with the hit point. */
  function findWall(room: Room, x: number, z: number) {
    const o = { x, y: 1.5, z };
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const d = { x: Math.sin(a), y: 0, z: Math.cos(a) };
      const hit = room.world.raycast(o, d, 10, 'bullets');
      if (hit && hit.t > 3 && Math.abs(hit.normal.y) < 0.1) return { d, t: hit.t, at: { x: o.x + d.x * hit.t, y: 1.5, z: o.z + d.z * hit.t } };
    }
    return null;
  }

  it('loadout: 6 bolts, 2 blades, one tomahawk, no tacticals; kills give no ammo', () => {
    const { room } = sticksRoom();
    const a = room.addBot({ name: 'A', loadout: { ...DEFAULT_LOADOUTS[0]!, lethal: 'frag', tactical: 'flashbang' } });
    const b = room.addBot({ name: 'B' });
    steps(room, 0.5);
    expect(ammo(a)).toEqual([['crossbow', 1, 5], ['ballistic_knife', 1, 1]]);
    expect(a.weapons.reduce((n, w) => n + w.mag + w.reserve, 0)).toBe(8);
    expect(a.ext.weapons).toMatchObject({ lethal: 'tomahawk', lethalN: 1, tactical: null, tacticalN: 0 });
    room.kill(b, a, { weapon: 'crossbow', means: 'impact' });
    expect(ammo(a)).toEqual([['crossbow', 1, 5], ['ballistic_knife', 1, 1]]);
    expect(a.stats.score).toBe(100);
  });

  it('other wager modes carry no class grenades', () => {
    const w = world([economy, weapons]);
    const room = w.lobby.createRoom({ mode: 'oitc', map: 'yard', closeWhenEmpty: false });
    const a = room.addBot({ name: 'A' });
    steps(room, 0.5);
    expect(a.ext.weapons).toMatchObject({ lethal: null, lethalN: 0, tactical: null, tacticalN: 0 });
  });

  it('a crossbow bolt sticks to a player, beeps for the fuse, then kills them and anyone close', () => {
    const { room } = sticksRoom();
    const a = room.addBot({ name: 'A' });
    const b = room.addBot({ name: 'B' });
    const c = room.addBot({ name: 'C' });
    steps(room, 0.7);
    place(a, -1, 10);
    place(b, -1, 0);
    place(c, 1, 0);
    a.move.ads = 1;
    expect(room.fire(a, { dir: aim(a, b) }).ok).toBe(true);
    expect(room.entities.byKind(BOLT_ENTITY).length).toBe(1);
    expect(b.health).toBe(100); // travel time
    let stuck = false;
    for (let i = 0; i < 30 && !stuck; i++) {
      room.step();
      stuck = room.entities.byKind(BOLT_ENTITY)[0]?.s?.p === b.id;
    }
    expect(stuck).toBe(true);
    expect(b.alive).toBe(true);
    expect(b.health).toBe(100 - BOLT.impact);
    // The bolt rides along with B.
    place(b, -1, -1);
    place(c, 1, -1);
    steps(room, 0.2);
    const bolt = room.entities.byKind(BOLT_ENTITY)[0]!;
    expect(Math.hypot(bolt.x - b.move.x, bolt.z - b.move.z)).toBeLessThan(0.6);
    const deaths: { victim: string; weapon: string; attacker: string | null }[] = [];
    room.bus.on('death', (e) => deaths.push({ victim: e.victim.name, weapon: e.weapon, attacker: e.attacker?.name ?? null }));
    steps(room, BOLT.fuseSec);
    expect(b.alive).toBe(false);
    expect(c.alive).toBe(false); // 2 m away: splash
    expect(deaths).toEqual(expect.arrayContaining([{ victim: 'B', weapon: 'crossbow', attacker: 'A' }, { victim: 'C', weapon: 'crossbow', attacker: 'A' }]));
    expect(a.alive).toBe(true);
    expect(a.stats.score).toBe(200);
    expect(room.entities.byKind(BOLT_ENTITY).length).toBe(0);
  });

  it('a bolt into the ground sticks there and kills whoever is near when it goes off', () => {
    const { room } = sticksRoom();
    const a = room.addBot({ name: 'A' });
    const b = room.addBot({ name: 'B' });
    steps(room, 0.7);
    place(a, -1, 10);
    place(b, -1, 0);
    // Aim at the floor a metre short of B.
    const e = { x: a.move.x, y: a.move.y + PLAYER.eye, z: a.move.z };
    const tgt = { x: -1, y: 0, z: 1 };
    const len = Math.hypot(tgt.x - e.x, tgt.y - e.y, tgt.z - e.z);
    expect(room.fire(a, { dir: { x: (tgt.x - e.x) / len, y: (tgt.y - e.y) / len, z: (tgt.z - e.z) / len } }).ok).toBe(true);
    steps(room, 0.4);
    const bolt = room.entities.byKind(BOLT_ENTITY)[0]!;
    expect(bolt.s).toMatchObject({ k: 1 });
    expect(bolt.s?.p).toBeUndefined();
    expect(bolt.y).toBeLessThan(0.3);
    expect(b.alive).toBe(true);
    expect(b.health).toBe(100);
    steps(room, BOLT.fuseSec);
    expect(b.alive).toBe(false);
  });

  it('the ballistic knife fires a blade with travel time and drop that kills in one hit and lands at the body', () => {
    const { room } = sticksRoom();
    const a = room.addBot({ name: 'A' });
    const b = room.addBot({ name: 'B' });
    steps(room, 0.7);
    a.slot = 1;
    steps(room, 0.5);
    place(a, -1, 8);
    place(b, -1, 0);
    // Aim at the head: the arc drops it into the body.
    expect(room.fire(a, { dir: aim(a, b, 1.6) }).ok).toBe(true);
    const blade = room.entities.byKind(BLADE_ENTITY)[0]!;
    expect(blade).toBeTruthy();
    const y0 = blade.y;
    expect(b.alive).toBe(true);
    room.step();
    room.step();
    expect(b.alive).toBe(true); // still in flight
    steps(room, 0.5);
    expect(b.alive).toBe(false);
    expect(blade.y).toBeLessThan(y0);
    expect(blade.s).toMatchObject({ k: 2 });
    expect(Math.hypot(blade.x - b.move.x, blade.z - b.move.z)).toBeLessThan(0.1);
    expect(a.stats.score).toBe(100);
    // Spent one: 0 + 1 spare (reloading into the chamber).
    const bk = a.weapons[1]!;
    expect(bk.mag + bk.reserve).toBe(1);
  });

  it('a blade sticks in a wall and anyone with a ballistic knife can pick it back up, up to 2', () => {
    const { room } = sticksRoom();
    const a = room.addBot({ name: 'A' });
    const c = room.addBot({ name: 'C' });
    steps(room, 0.7);
    place(a, -1, 0);
    place(c, -20, -20);
    const wall = findWall(room, -1, 0);
    expect(wall).not.toBeNull();
    a.slot = 1;
    steps(room, 0.5);
    place(a, -1, 0);
    const dir = { x: wall!.d.x, y: 0.03, z: wall!.d.z };
    const l = Math.hypot(dir.x, dir.y, dir.z);
    expect(room.fire(a, { dir: { x: dir.x / l, y: dir.y / l, z: dir.z / l } }).ok).toBe(true);
    steps(room, 0.8);
    const blades = room.entities.byKind(BLADE_ENTITY);
    expect(blades.length).toBe(1);
    expect(blades[0]!.s).toMatchObject({ k: 1 });
    expect(Math.hypot(blades[0]!.x - wall!.at.x, blades[0]!.z - wall!.at.z)).toBeLessThan(0.5);
    const total = (p: PlayerState) => p.weapons[1]!.mag + p.weapons[1]!.reserve;
    expect(total(a)).toBe(1);
    // C has a full knife: walking past doesn't take it.
    const near = { x: blades[0]!.x - wall!.d.x * 0.45, z: blades[0]!.z - wall!.d.z * 0.45 };
    place(c, near.x, near.z);
    steps(room, 0.2);
    expect(room.entities.byKind(BLADE_ENTITY).length).toBe(1);
    // C fires its own blade away, then picks A's up.
    c.weapons[1]!.mag = 0;
    place(c, near.x, near.z);
    steps(room, 0.1);
    expect(room.entities.byKind(BLADE_ENTITY).length).toBe(0);
    expect(total(c)).toBe(2);
    expect(c.weapons[1]!.mag).toBe(1);
    // A walks over a dropped one.
    dropBlade(room, { x: 3, y: 0.05, z: 3 }, c.id);
    place(c, -20, -20);
    place(a, 3, 3);
    steps(room, 0.1);
    expect(total(a)).toBe(2);
    expect(room.entities.byKind(BLADE_ENTITY).length).toBe(0);
  });

  it('USE picks up a blade from further than walking over it', () => {
    const { room } = sticksRoom();
    const a = room.addBot({ name: 'A' });
    steps(room, 0.7);
    a.weapons[1]!.reserve = 0;
    place(a, 0, 0);
    dropBlade(room, { x: 1.5, y: 0.05, z: 0 }, a.id);
    steps(room, 0.2);
    expect(room.entities.byKind(BLADE_ENTITY).length).toBe(1);
    drive(a, () => ({ buttons: Buttons.USE }));
    steps(room, 0.1);
    expect(room.entities.byKind(BLADE_ENTITY).length).toBe(0);
    expect(a.weapons[1]!.reserve).toBe(1);
  });

  it('tomahawk: raised on press, held as long as the button is down, thrown on release; a kill bankrupts', () => {
    const { room } = sticksRoom();
    const a = room.addBot({ name: 'A' });
    const b = room.addBot({ name: 'B' });
    steps(room, 0.5);
    room.kill(a, b, { weapon: 'crossbow', means: 'impact' });
    expect(b.stats.score).toBe(100);
    steps(room, 3.2);
    place(a, -1, 6);
    place(b, -1, 0);
    let held = true;
    drive(a, () => ({ buttons: held ? Buttons.LETHAL : 0 }));
    look(a, aim(a, b, 1.3));
    room.step();
    expect(a.ext.weapons?.lethalN).toBe(0);
    expect(a.ext.weapons?.throwing).not.toBeNull();
    steps(room, 2);
    expect(room.entities.byKind(TOMAHAWK_ENTITY).length).toBe(0); // still up in the hand
    expect(a.ext.weapons?.throwing).not.toBeNull();
    held = false;
    room.step();
    room.step();
    expect(room.entities.byKind(TOMAHAWK_ENTITY).length).toBe(1);
    const bankrupts: unknown[] = [];
    room.bus.on('death', (e) => bankrupts.push(e.weapon));
    for (let i = 0; i < 60 && b.alive; i++) {
      place(b, -1, 0);
      room.step();
    }
    expect(b.alive).toBe(false);
    expect(bankrupts).toEqual(['tomahawk']);
    expect(b.stats.score).toBe(0);
    expect(a.stats.score).toBe(STICKS.tomahawkScore);
    // It lands and A walks over it to get it back.
    steps(room, 2);
    const hawk = room.entities.byKind(TOMAHAWK_ENTITY)[0]!;
    expect(hawk.s).toMatchObject({ k: 1 });
    place(a, hawk.x, hawk.z);
    a.move.y = Math.max(0, hawk.y - 0.1);
    steps(room, 0.1);
    expect(room.entities.byKind(TOMAHAWK_ENTITY).length).toBe(0);
    expect(a.ext.weapons?.lethalN).toBe(1);
  });

  it('suicide by your own bolt bankrupts you; melee scores 25', () => {
    const { room } = sticksRoom();
    const a = room.addBot({ name: 'A' });
    const b = room.addBot({ name: 'B' });
    steps(room, 0.5);
    room.kill(b, a, { weapon: 'knife', means: 'melee' });
    expect(a.stats.score).toBe(STICKS.meleeScore);
    room.addPlayerScore(a, 300, 'test');
    room.kill(a, a, { weapon: 'crossbow', means: 'explosive' });
    expect(a.stats.score).toBe(0);
  });
});

describe('wager escrow and payouts', () => {
  async function stakedRoom(names: string[], ante = 1000, mode = 'oitc') {
    const w = world(mode === 'sticks' ? [economy, weapons] : [economy]);
    const hs = names.map((n) => w.human(n));
    let roomId = '';
    for (const h of hs) {
      const r = await w.call(h, 'economy.wagerQueue', { mode, ante, bots: { fill: false } });
      roomId ||= r.roomId as string;
      expect(r.roomId).toBe(roomId);
      w.lobby.join(h, roomId);
    }
    const room = w.lobby.get(roomId)!;
    expect(room.phase).toBe('lobby');
    expect((await w.call(hs[0]!, 'economy.wagerStart', {})).ok).toBe(true);
    steps(room, 0.5);
    expect(room.phase).toBe('countdown');
    return { ...w, hs, room, P: (h: Session) => room.players.get(h.id)! };
  }

  it('escrows antes at the start and pays the pot to the winner', async () => {
    const { hs, room, P } = await stakedRoom(['A', 'B']);
    const [a, b] = hs as [Human, Human];
    expect(a.profile.codPoints).toBe(19000);
    expect((a.profile.ext.economy as { escrow: { amount: number } }).escrow.amount).toBe(1000);
    steps(room, 5.2);
    expect(room.phase).toBe('playing');
    for (let i = 0; i < 3; i++) {
      steps(room, 2.2);
      room.kill(P(b), P(a), { weapon: 'm1911', means: 'bullet' });
    }
    expect(room.phase).toBe('ended');
    const w = ext(room).wager!;
    expect(w).toMatchObject({ ante: 1000, pot: 2000, practice: false, staked: 2 });
    expect(w.lines.map((l) => [l.name, l.payout, l.net])).toEqual([['A', 2000, 1000], ['B', 0, -1000]]);
    expect(a.profile.codPoints).toBe(21000);
    expect(b.profile.codPoints).toBe(19000);
    expect((a.profile.ext.economy as { escrow: unknown }).escrow).toBeNull();
    expect(feats(a, 'economy.award').at(-1)).toMatchObject({ reason: 'payout', total: 1000 });
    const hud = feats(a, 'economy.wager').at(-1)!;
    expect(hud).toMatchObject({ mode: 'oitc', ante: 1000 });
  });

  it('Sticks and Stones: a tomahawk bankrupts the leader and the pot follows the reduced score', async () => {
    const { hs, room, P } = await stakedRoom(['A', 'B'], 1000, 'sticks');
    const [a, b] = hs as [Human, Human];
    steps(room, 5.2);
    expect(room.phase).toBe('playing');
    room.addPlayerScore(P(a), 300, 'test');
    room.addPlayerScore(P(b), 100, 'test');
    room.kill(P(a), P(b), { weapon: 'tomahawk', means: 'thrown' });
    expect(P(a).stats.score).toBe(0);
    expect(P(b).stats.score).toBe(100 + STICKS.tomahawkScore);
    expect(feats(a, 'economy.bankrupt').at(-1)).toEqual({ victim: P(a).id, attacker: P(b).id, lost: 300 });
    expect(feats(b, 'economy.bankrupt').length).toBe(1);
    room.endMatch('time');
    const w = ext(room).wager!;
    expect(w.lines.map((l) => [l.name, l.payout])).toEqual([['B', 2000], ['A', 0]]);
    expect(b.profile.codPoints).toBe(21000);
  });

  it('refunds a player who disconnects during the countdown; voids and refunds everyone when too few remain', async () => {
    const { hs, room, lobby } = await stakedRoom(['A', 'B', 'C']);
    const [a, b, c] = hs as [Human, Human, Human];
    expect(c.profile.codPoints).toBe(19000);
    lobby.leave(c, 'disconnect');
    expect(c.profile.codPoints).toBe(20000);
    expect(wagersFor(room)!.states.get(room.id)!.pot).toBe(2000);
    steps(room, 5.2);
    expect(room.phase).toBe('playing');
    lobby.leave(a, 'disconnect'); // forfeit... which leaves one staked player: void
    expect(a.profile.codPoints).toBe(20000);
    expect(b.profile.codPoints).toBe(20000);
    expect(wagersFor(room)!.states.get(room.id)!.practice).toBe(true);
  });

  it('a mid-match leaver forfeits the ante to the pot', async () => {
    const { hs, room, lobby, P } = await stakedRoom(['A', 'B', 'C']);
    const [a, b, c] = hs as [Human, Human, Human];
    steps(room, 5.2);
    lobby.leave(c, 'left');
    expect(c.profile.codPoints).toBe(19000);
    for (let i = 0; i < 3; i++) {
      steps(room, 2.2);
      room.kill(P(a), P(b), { weapon: 'm1911', means: 'bullet' });
    }
    expect(room.phase).toBe('ended');
    const w = ext(room).wager!;
    expect(w.pot).toBe(3000);
    expect(w.forfeits).toEqual(['C']);
    expect(w.lines.map((l) => [l.name, l.payout])).toEqual([['B', 1950], ['A', 1050]]);
    expect(b.profile.codPoints).toBe(19000 + 1950);
    expect(c.profile.codPoints).toBe(19000);
  });

  it('refunds every stake when the room closes mid-match (server shutdown)', async () => {
    const { hs, room, lobby } = await stakedRoom(['A', 'B']);
    steps(room, 5.2);
    lobby.shutdown();
    expect(room.closed).toBe(true);
    for (const h of hs) expect(h.profile.codPoints).toBe(20000);
  });

  it('kicks a player who can no longer cover the ante; a lone staker plays practice, refunded', async () => {
    const w = world();
    const a = w.human('A');
    const b = w.human('B');
    const r = await w.call(a, 'economy.wagerQueue', { mode: 'gungame', ante: 10000, bots: { fill: false } });
    await w.call(b, 'economy.wagerQueue', { mode: 'gungame', ante: 10000, bots: { fill: false } });
    w.lobby.join(a, r.roomId as string);
    w.lobby.join(b, r.roomId as string);
    b.profile.codPoints = 50; // spent it in the store meanwhile
    await w.call(a, 'economy.wagerStart', {});
    const room = w.lobby.get(r.roomId as string)!;
    steps(room, 0.5);
    expect(room.players.has(b.id)).toBe(false);
    expect(a.profile.codPoints).toBe(20000);
    expect(wagersFor(room)!.states.get(room.id)!.practice).toBe(true);
  });

  it('refuses antes you cannot cover and unknown tiers', async () => {
    const w = world();
    const a = w.human('A', 500);
    await expect(w.call(a, 'economy.wagerQueue', { mode: 'oitc', ante: 1000 })).rejects.toThrow(/funds/);
    await expect(w.call(a, 'economy.wagerQueue', { mode: 'oitc', ante: 5 })).rejects.toThrow(/bad_request/);
    await expect(w.call(a, 'economy.wagerQueue', { mode: 'tdm', ante: 10 })).rejects.toThrow(/bad_request/);
  });

  it('refunds a stale escrow whose match is gone', () => {
    const w = world();
    const a = w.human('A', 100);
    a.profile.ext.economy = { escrow: { roomId: 'gone', match: 1, amount: 1000, mode: 'oitc', at: 0 } };
    const room = w.lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false });
    wagersFor(room)!.sweep();
    expect(a.profile.codPoints).toBe(1100);
    expect((a.profile.ext.economy as { escrow: unknown }).escrow).toBeNull();
    expect(feats(a, 'economy.award').at(-1)).toMatchObject({ reason: 'refund', total: 1000 });
  });
});

describe('practice wagers and bot backfill', () => {
  it('a lone human waits for players, then stakes against bots the tier picks (not the lobby)', async () => {
    const w = world();
    const a = w.human('A');
    const r = await w.call(a, 'economy.wagerQueue', { mode: 'oitc', ante: 1000, bots: { fill: true, difficulty: 'recruit', variance: 0 } });
    expect(r.practice).toBe(false);
    w.lobby.join(a, r.roomId as string);
    const room = w.lobby.get(r.roomId as string)!;
    steps(room, MATCHMAKING_WAIT_SEC - 1);
    expect(room.phase).toBe('lobby');
    expect(feats(a, 'economy.wager').at(-1)).toMatchObject({ pot: 6000, entrants: 6, practice: false, bots: { opponents: 'Regular / Hardened' } });
    expect(feats(a, 'economy.wager').at(-1)?.startsIn).toBeGreaterThan(0);
    steps(room, 1.5);
    expect(room.phase).toBe('countdown');
    expect(room.players.size).toBe(6);
    // Big Spender: regular / hardened bots, the harder one first; the asked-for recruits are ignored.
    expect(room.bots().map((b) => b.ext.wager?.difficulty)).toEqual(['hardened', 'regular', 'hardened', 'regular', 'hardened']);
    expect(room.bots()[0]!.ext.wager?.skill?.reactionMs).toBe(320);
    expect(a.profile.codPoints).toBe(19000);
    expect(wagersFor(room)!.states.get(room.id)).toMatchObject({ practice: false, pot: 6000, entrantsAtStart: 6, stakedAtStart: 1 });
  });

  it('the practice tier starts right away with bots and never touches CP', async () => {
    const w = world();
    const a = w.human('A', 0);
    const r = await w.call(a, 'economy.wagerQueue', { mode: 'sticks', ante: 0, bots: { difficulty: 'recruit', targetPlayers: 4 } });
    expect(r.practice).toBe(true);
    w.lobby.join(a, r.roomId as string);
    const room = w.lobby.get(r.roomId as string)!;
    steps(room, 3.5);
    expect(room.phase).toBe('countdown');
    expect(room.players.size).toBe(4);
    expect(room.bots().every((b) => b.ext.wager?.skill !== undefined)).toBe(true);
    expect(a.profile.codPoints).toBe(0);
  });
});

describe('wager lobbies with the bots feature loaded', () => {
  it('backfilled bots get brains at the lobby skill, and economy alone owns the bot count', async () => {
    const w = world([economy, bots]);
    const a = w.human('A');
    const r = await w.call(a, 'economy.wagerQueue', { mode: 'oitc', ante: 0, bots: { fill: true, difficulty: 'hardened', variance: 0.3, targetPlayers: 5 } });
    w.lobby.join(a, r.roomId as string);
    const room = w.lobby.get(r.roomId as string)!;
    expect(getRoomBots(room)?.managed).toBe(false);
    steps(room, 4);
    expect(room.phase).toBe('countdown');
    expect(room.players.size).toBe(5);
    for (const b of room.bots()) {
      const brain = botBrain(room, b);
      expect(brain).toBeDefined();
      expect(b.brain).toBe(brain);
      expect(brain!.skill).toEqual(b.ext.wager!.skill);
    }
    steps(room, 8);
    expect(room.phase).toBe('playing');
    expect(room.players.size).toBe(5); // the bots feature didn't add or retire any
  });

  it('with bot fill off, the bots feature adds nobody', async () => {
    const w = world([economy, bots]);
    const hs = [w.human('A'), w.human('B')];
    let roomId = '';
    for (const h of hs) {
      const r = await w.call(h, 'economy.wagerQueue', { mode: 'gungame', ante: 10, bots: { fill: false } });
      roomId ||= r.roomId as string;
      w.lobby.join(h, roomId);
    }
    const room = w.lobby.get(roomId)!;
    expect((await w.call(hs[0]!, 'economy.wagerStart', {})).ok).toBe(true);
    steps(room, 8);
    expect(room.phase).toBe('playing');
    expect(room.bots().length).toBe(0);
  });
});

describe('earning and the store through the feature', () => {
  it('awards performance CP to humans at the end of a normal match', () => {
    const w = world();
    const a = w.human('A', 0);
    const room = w.lobby.createRoom({ mode: 'ffa', map: 'yard', closeWhenEmpty: false });
    w.lobby.join(a, room.id);
    const bot = room.addBot({ name: 'Bot' });
    steps(room, 0.5);
    room.kill(bot, room.players.get(a.id)!, { weapon: 'ak47', means: 'bullet' });
    steps(room, 1);
    room.endMatch('time');
    const award = ext(room).awards[a.id]!;
    expect(award.total).toBeGreaterThan(100);
    expect(a.profile.codPoints).toBe(award.total);
    expect(ext(room).awards[bot.id]).toBeUndefined();
    expect(feats(a, 'economy.award').at(-1)).toMatchObject({ reason: 'match', total: award.total });
  });

  it('economy.grant credits humans (challenges) and ignores bots', () => {
    const w = world();
    const a = w.human('A', 0);
    const room = w.lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false });
    w.lobby.join(a, room.id);
    const bot = room.addBot();
    room.bus.emit('economy.grant', { player: room.players.get(a.id)!, amount: 250, reason: 'Challenge: Team Player', kind: 'challenge' });
    room.bus.emit('economy.grant', { player: bot, amount: 250, reason: 'nope' });
    expect(a.profile.codPoints).toBe(250);
  });

  it('buys through RPC, equips, sets a camo, and strips locked items at spawn', async () => {
    const w = world();
    const a = w.human('A', 1200);
    a.profile.level = 12;
    await expect(w.call(a, 'economy.buy', { item: 'camo.gold' })).rejects.toThrow(/level/);
    const res = await w.call(a, 'economy.buy', { item: 'camo.tiger' });
    expect(res).toMatchObject({ codPoints: 200, item: 'camo.tiger' });
    await expect(w.call(a, 'economy.buy', { item: 'camo.tiger' })).rejects.toThrow(/owned/);
    await w.call(a, 'economy.setCamo', { loadout: 0, slot: 'primary', camo: 'tiger' });
    await expect(w.call(a, 'economy.setCamo', { loadout: 0, slot: 'primary', camo: 'woodland' })).rejects.toThrow(/locked/);
    expect(a.profile.loadouts[0]!.primary.camo).toBe('tiger');
    await expect(w.call(a, 'economy.equip', { kind: 'reticle', id: 'skull' })).rejects.toThrow(/locked/);
    expect(await w.call(a, 'economy.equip', { kind: 'reticle', id: 'dot' })).toMatchObject({ equipped: { reticle: 'dot' } });
    const st = await w.call(a, 'economy.state', {});
    expect(st.codPoints).toBe(200);
    expect((st.history as unknown[]).length).toBe(1);

    // A camo the player doesn't own is stripped at spawn.
    a.profile.loadouts[0]!.secondary.camo = 'gold';
    const room = w.lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false });
    w.lobby.join(a, room.id);
    const p = room.players.get(a.id)!;
    expect(p.loadout!.primary.camo).toBe('tiger');
    expect(p.loadout!.secondary.camo).toBe('none');
    expect(p.weapons[0]!.camo).toBe('tiger');
  });
});
