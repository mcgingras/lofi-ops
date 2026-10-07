/**
 * Wager modes and escrow, driven room-by-room without timers (room.step()). The economy feature's
 * real setup() runs against an in-memory store; humans are Sessions over a fake socket so the
 * messages they get (rpc results, feature pushes) can be inspected.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { registerWeaponBehavior } from '../src/server/combat';
import economy, { wagersFor } from '../src/server/features/economy/index';
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
import { OITC } from '../src/shared/defs/economy';
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

function world() {
  const store = new Store(':memory:');
  const sessions: Session[] = [];
  const rpc = new RpcRegistry();
  const lobby = new Lobby({ store, features: [economy], log: () => {}, autoTick: false });
  const api: ServerApi = { lobby, store, rpc, registerMode, registerWeaponBehavior, sessions: () => sessions.values(), log: () => {} };
  economy.setup!(api);
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
  it('crossbow + ballistic knife; bolts kill on contact; a tomahawk kill bankrupts', () => {
    const { lobby } = world();
    const room = lobby.createRoom({ mode: 'sticks', map: 'yard', closeWhenEmpty: false });
    const a = room.addBot({ name: 'A' });
    const b = room.addBot({ name: 'B' });
    steps(room, 0.5);
    expect(a.weapons.map((w) => w.def.base.id)).toEqual(['crossbow', 'ballistic_knife']);

    // B scores first so there is something to lose.
    room.kill(a, b, { weapon: 'crossbow', means: 'bullet' });
    expect(b.stats.score).toBe(100);
    steps(room, 3.2);

    // Crossbow bolt, direct hit.
    place(a, -1, 8);
    place(b, -1, 0);
    steps(room, 0.7);
    place(a, -1, 8);
    place(b, -1, 0);
    a.move.ads = 1;
    expect(room.fire(a, { dir: aim(a, b) }).ok).toBe(true);
    expect(room.entities.byKind('bolt').length).toBe(1);
    steps(room, 0.3);
    expect(b.alive).toBe(false);
    steps(room, 3.2);

    // Tomahawk.
    place(a, -1, 6);
    place(b, -1, 0);
    steps(room, 0.2);
    const d = aim(a, b, 1.0);
    a.yaw = yawTo(a.move, b.move);
    a.pitch = Math.asin(d.y);
    expect(a.ext.wager?.tomahawks).toBe(1);
    room.bus.emit('buttons', { player: a, pressed: Buttons.LETHAL, released: 0, buttons: Buttons.LETHAL });
    expect(a.ext.wager?.tomahawks).toBe(0);
    for (let i = 0; i < 60 && b.alive; i++) {
      place(b, -1, 0);
      room.step();
    }
    expect(b.alive).toBe(false);
    expect(b.stats.score).toBe(0);
    expect(a.stats.score).toBe(100 + 150);
  });
});

describe('wager escrow and payouts', () => {
  async function stakedRoom(names: string[], ante = 1000) {
    const w = world();
    const hs = names.map((n) => w.human(n));
    let roomId = '';
    for (const h of hs) {
      const r = await w.call(h, 'economy.wagerQueue', { mode: 'oitc', ante, bots: { fill: false } });
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
  it('a lone human waits for players, then plays practice against tuned bots for free', async () => {
    const w = world();
    const a = w.human('A');
    const r = await w.call(a, 'economy.wagerQueue', { mode: 'oitc', ante: 1000, bots: { fill: true, difficulty: 'veteran', variance: 0 } });
    expect(r.practice).toBe(false);
    w.lobby.join(a, r.roomId as string);
    const room = w.lobby.get(r.roomId as string)!;
    steps(room, MATCHMAKING_WAIT_SEC - 1);
    expect(room.phase).toBe('lobby');
    expect(feats(a, 'economy.wager').at(-1)?.startsIn).toBeGreaterThan(0);
    steps(room, 1.5);
    expect(room.phase).toBe('countdown');
    expect(room.players.size).toBe(6);
    const bot = room.bots()[0]!;
    expect(bot.ext.wager?.skill?.reactionMs).toBe(180); // veteran, no variance
    expect(a.profile.codPoints).toBe(20000);
    steps(room, 5.2);
    room.endMatch('time');
    expect(ext(room).wager).toMatchObject({ practice: true, pot: 0 });
    expect(a.profile.codPoints).toBe(20000);
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
