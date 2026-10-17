/**
 * Zombies barriers and doors (server blockers.ts), on Nacht der Untoten: zombies tear the boards
 * at their window one at a time and climb in only once all six are down; survivors rebuild a board
 * a second for 10 points under the round cap; Carpenter rebuilds every window for +200 and only
 * drops on maps with barriers; doors block players, zombies and bullets until bought, opening
 * their zones' spawns and windows; each room has its own doors; the zombie AI gets through a
 * window to a survivor in the start room in bounded time.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import botsFeature from '../src/server/features/bots/index';
import perksFeature from '../src/server/features/perks/index';
import progressionFeature from '../src/server/features/progression/index';
import weaponsFeature from '../src/server/features/weapons/index';
import type { ZombiesGame } from '../src/server/features/zombies/game';
import { zombiesGameOf, ZombiesRules } from '../src/server/features/zombies/index';
import { survivorOf, undeadOf } from '../src/server/features/zombies/state';
import { Lobby } from '../src/server/lobby';
import { registerMode } from '../src/server/modes/index';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { Session } from '../src/server/session';
import { Store } from '../src/server/store';
import { TICK_DT } from '../src/shared/constants';
import { BARRIER, barrierPoints, boardReward, POINTS, PowerupCycle, ZM_ENTITY, ZOMBIES } from '../src/shared/defs/zombies';
import { Buttons } from '../src/shared/input';
import { zombiesLayer } from '../src/shared/maps/zombies/index';
import { createMoveState } from '../src/shared/movement';
import { newProfile } from '../src/shared/profile';

const stores: Store[] = [];
const lobbies: Lobby[] = [];
let seq = 0;

beforeAll(() => registerMode('zombies', () => new ZombiesRules()));
afterEach(() => {
  for (const l of lobbies.splice(0)) l.shutdown();
  for (const s of stores.splice(0)) s.close();
});

function setup(map = 'nacht'): { room: Room; g: ZombiesGame } {
  const store = new Store(':memory:');
  const lobby = new Lobby({ store, features: [weaponsFeature, perksFeature, progressionFeature, botsFeature], log: () => {}, autoTick: false });
  stores.push(store);
  lobbies.push(lobby);
  const room = lobby.createRoom({ mode: 'zombies', map, closeWhenEmpty: false });
  return { room, g: zombiesGameOf(room)! };
}
const steps = (room: Room, seconds: number, each?: () => void) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) {
    each?.();
    room.step();
  }
};
function human(room: Room, name = `H${++seq}`): PlayerState {
  const s = new Session(`s${++seq}-${name}`, null, newProfile(`p-${name}-${seq}`, name), 'tok');
  return room.addHuman(s);
}
const place = (room: Room, p: PlayerState, x: number, y: number, z: number, yaw = p.yaw) => {
  p.move = { ...createMoveState(x, y, z), onGround: true };
  p.yaw = yaw;
  void room;
};
const cmdSeq = new WeakMap<PlayerState, number>();
function hold(room: Room, p: PlayerState, buttons: number): void {
  const n = (cmdSeq.get(p) ?? p.lastSeq) + 1;
  cmdSeq.set(p, n);
  room.queueInputs(p, [{ seq: n, dt: TICK_DT, buttons, yaw: p.yaw, pitch: 0, weaponSlot: p.slot }]);
}
/** One survivor, round 1 under way, the director's own zombies cleared and stopped. */
function game(map = 'nacht') {
  const { room, g } = setup(map);
  const h = human(room);
  steps(room, 0.2);
  g.phaseEndsAt = room.time;
  steps(room, 0.1);
  expect(g.phase).toBe('active');
  g.queue = 0;
  for (const z of g.aliveUndead()) room.kill(z, null, { weapon: 'nuke', means: 'explosive' });
  // Keep the round from ending while a test runs.
  g.queue = 0;
  return { room, g, h };
}
/** A zombie at spawn `i` of the layer (it comes in through that spawn's window). */
function zombieAt(room: Room, g: ZombiesGame, i: number): PlayerState {
  const layer = zombiesLayer(room.mapId)!;
  const s = layer.zombieSpawns[i]!;
  const cands = (g as unknown as { candidates: { x: number; z: number }[] }).candidates;
  const keep = cands.slice();
  cands.length = 0;
  cands.push(keep[i]!);
  try {
    expect(g.spawnOne('zombie')).toBe(true);
  } finally {
    cands.length = 0;
    cands.push(...keep);
  }
  const z = g.aliveUndead().find((b) => Math.hypot(b.move.x - s.x, b.move.z - s.z) < 1 && g.blockers.isOutside(b.id))!;
  expect(z).toBeTruthy();
  return z;
}
const boards = (g: ZombiesGame, i: number) => g.blockers.barriers[i]!.boards;
const ent = (room: Room, kind: string) => room.entities.byKind(kind);

describe('barriers: boards, tearing, climbing in', () => {
  it('every window starts with six boards, as zm_barrier entities', () => {
    const { room, g } = game();
    const layer = zombiesLayer('nacht')!;
    expect(g.blockers.barriers).toHaveLength(layer.barriers!.length);
    expect(ent(room, ZM_ENTITY.barrier)).toHaveLength(layer.barriers!.length);
    for (const e of ent(room, ZM_ENTITY.barrier)) expect(e.s?.b).toBe(BARRIER.boards);
  });

  it('a zombie walks to its window, pulls a board every 1-2 s, and stays outside until the last one is down', () => {
    const { room, g, h } = game();
    h.maxHealth = h.health = 1e9;
    place(room, h, 4, 0, 4);
    const z = zombieAt(room, g, 0); // the S1 window, south wall of the start room
    const b = g.blockers.barriers[0]!;
    const { outside } = barrierPoints(b.spec);
    const pulls: number[] = [];
    let last = boards(g, 0);
    let inside = -1;
    steps(room, 40, () => {
      hold(room, h, 0);
      if (boards(g, 0) < last) pulls.push(room.time);
      last = boards(g, 0);
      // South of the wall line is outside.
      if (z.alive && boards(g, 0) > 0) expect(z.move.z, `boards ${boards(g, 0)}`).toBeGreaterThan(b.spec.z);
      if (inside < 0 && !g.blockers.isOutside(z.id) && z.move.z < b.spec.z - 0.4) inside = room.time;
    });
    expect(pulls).toHaveLength(BARRIER.boards);
    for (let i = 1; i < pulls.length; i++) {
      const gap = pulls[i]! - pulls[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(1.0);
      expect(gap).toBeLessThanOrEqual(2.0);
    }
    // It reached the window first (spawned 11 m out).
    expect(Math.hypot(outside.x - (z.move.x), outside.z - z.move.z)).toBeGreaterThan(-1);
    expect(inside).toBeGreaterThan(pulls.at(-1)!);
    expect(inside - pulls.at(-1)!).toBeLessThan(BARRIER.climbSec + 2);
  });

  it('survivors rebuild a board a second for 10 points, up to the round cap (min(50 x round, 500))', () => {
    expect(boardReward(0, 1)).toEqual({ total: 10, pay: 10 });
    expect(boardReward(40, 1)).toEqual({ total: 50, pay: 0 });
    expect(boardReward(490, 20)).toEqual({ total: 500, pay: 0 });
    expect(boardReward(480, 20)).toEqual({ total: 490, pay: 10 });
    expect(BARRIER.capPerRound(3)).toBe(150);
    expect(BARRIER.capPerRound(14)).toBe(500);
    const { room, g, h } = game();
    const b = g.blockers.barriers[0]!;
    g.blockers['setBoards'](b, 0);
    const { inside } = barrierPoints(b.spec);
    place(room, h, inside.x, inside.y, inside.z, 0);
    const p0 = survivorOf(h)!.points;
    steps(room, 3.05, () => hold(room, h, Buttons.USE));
    expect(boards(g, 0)).toBe(3);
    expect(survivorOf(h)!.points - p0).toBe(30);
    // Round 1: the fifth board pays nothing (the total reaches the 50 cap), the sixth neither.
    steps(room, 3.0, () => hold(room, h, Buttons.USE));
    expect(boards(g, 0)).toBe(6);
    expect(survivorOf(h)!.points - p0).toBe(40);
    expect(survivorOf(h)!.boardPoints).toBe(60);
    // Full: holding does nothing more.
    steps(room, 1.5, () => hold(room, h, Buttons.USE));
    expect(survivorOf(h)!.boardPoints).toBe(60);
    // A new round resets the running total.
    g.blockers['setBoards'](b, 4);
    g.round = 4;
    g['startRound'](5);
    g.queue = 0;
    expect(survivorOf(h)!.boardPoints).toBe(0);
    steps(room, 2.05, () => hold(room, h, Buttons.USE));
    expect(survivorOf(h)!.points - p0).toBe(60);
  });

  it('rebuilding needs you inside, in reach; it does not work from the outside or from across the room', () => {
    const { room, g, h } = game();
    const b = g.blockers.barriers[0]!;
    g.blockers['setBoards'](b, 2);
    place(room, h, b.spec.x + 4, 0, b.spec.z - 4);
    steps(room, 2.05, () => hold(room, h, Buttons.USE));
    expect(boards(g, 0)).toBe(2);
  });

  it('Carpenter: every board back up and +200 each; in the drop cycle only on maps with barriers, and only with 5+ broken windows', () => {
    const { room, g, h } = game();
    expect(g.powerups.cycle.ids).toContain('carpenter');
    for (const b of g.blockers.barriers.slice(0, 6)) g.blockers['setBoards'](b, 0);
    g.blockers['setBoards'](g.blockers.barriers[6]!, 3);
    expect(g.brokenWindows()).toBe(6);
    const cyc = new PowerupCycle(['carpenter']);
    expect(cyc.pick({ brokenWindows: 4 })).toBe('full_ammo');
    expect(cyc.pick({ brokenWindows: 5 })).toBe('carpenter');
    const p0 = survivorOf(h)!.points;
    g.powerups.grab('carpenter', h, h.move);
    for (const b of g.blockers.barriers) expect(b.boards).toBe(BARRIER.boards);
    for (const e of ent(room, ZM_ENTITY.barrier)) expect(e.s?.b).toBe(BARRIER.boards);
    expect(survivorOf(h)!.points - p0).toBe(POINTS.carpenter);
    const other = game('nuketown');
    expect(other.g.powerups.cycle.ids).not.toContain('carpenter');
    expect(other.g.brokenWindows()).toBe(0);
  });

  it('a zombie at the window swipes a survivor standing right inside it', () => {
    const { room, g, h } = game();
    let swipes = 0;
    room.bus.on('beforeDamage', (ev) => {
      if (ev.victim === h && ev.attacker && undeadOf(ev.attacker) && ev.means === 'melee') {
        swipes++;
        ev.cancel = true;
      }
    }, { priority: 500 });
    const b = g.blockers.barriers[0]!;
    const { inside } = barrierPoints(b.spec);
    place(room, h, inside.x, 0, inside.z, 0);
    zombieAt(room, g, 0);
    steps(room, 14, () => hold(room, h, 0));
    expect(swipes).toBeGreaterThan(0);
  });
});

describe('doors and debris', () => {
  it('block players before purchase; hold USE to buy for 1000; the gap opens and its zone wakes', () => {
    const { room, g, h } = game();
    const help = g.blockers.doors.find((d) => d.spec.id === 'help')!;
    expect(ent(room, ZM_ENTITY.door)).toHaveLength(3);
    // Walk west into the HELP door: stopped at the wall.
    place(room, h, -3.4, 0, 1.55, Math.PI / 2);
    steps(room, 1.5, () => hold(room, h, Buttons.FORWARD));
    expect(h.move.x).toBeGreaterThan(-4.5);
    expect(room.world.lineOfSight({ x: -3.4, y: 1.2, z: 1.55 }, { x: -6.5, y: 1.2, z: 1.55 }, 'bullets')).toBe(false);
    // Not enough points: nothing happens.
    survivorOf(h)!.points = 900;
    steps(room, 0.5, () => hold(room, h, Buttons.USE));
    steps(room, 0.1, () => hold(room, h, 0));
    expect(help.open).toBe(false);
    expect(survivorOf(h)!.points).toBe(900);
    survivorOf(h)!.points = 1500;
    let bought = '';
    room.bus.on('zombies.bought', (e) => (bought = e.what));
    steps(room, 0.5, () => hold(room, h, Buttons.USE));
    expect(help.open).toBe(true);
    expect(bought).toBe('door:help');
    expect(survivorOf(h)!.points).toBe(500);
    expect(g.blockers.openZones.has('help')).toBe(true);
    expect(g.blockers.openZones.has('upstairs')).toBe(false);
    expect(ent(room, ZM_ENTITY.door).find((e) => e.id === help.ent!.id)!.s?.o).toBeTypeOf('number');
    // Now walk through.
    steps(room, 0.1, () => hold(room, h, 0));
    steps(room, 2, () => hold(room, h, Buttons.FORWARD));
    expect(h.move.x).toBeLessThan(-5.5);
  });

  it('zombie spawns and windows behind a door only work once it is bought', () => {
    const { room, g } = game();
    const layer = zombiesLayer('nacht')!;
    const active = () => layer.zombieSpawns.filter((s) => g.blockers.spawnActive(s)).map((s) => s.zone ?? 'start');
    expect(new Set(active())).toEqual(new Set(['start']));
    // Spawned zombies only ever pick live spawns.
    g.round = 3;
    for (let i = 0; i < 20; i++) g.spawnOne('zombie');
    for (const z of g.aliveUndead()) {
      const s = layer.zombieSpawns.find((c) => Math.hypot(c.x - z.move.x, c.z - z.move.z) < 1)!;
      expect(s.zone ?? 'start').toBe('start');
    }
    g.blockers.open(g.blockers.doors.find((d) => d.spec.id === 'help')!);
    expect(new Set(active())).toEqual(new Set(['start', 'help']));
    g.blockers.open(g.blockers.doors.find((d) => d.spec.id === 'stairs')!);
    expect(new Set(active())).toEqual(new Set(['start', 'help', 'upstairs']));
    void room;
  });

  it('each room has its own doors: buying one in a room leaves another room on the map shut', () => {
    const a = game();
    const b = game();
    expect(a.room.world).not.toBe(b.room.world);
    a.g.blockers.open(a.g.blockers.doors[0]!);
    const at = { x: -4.8, y: 1.2, z: 1.55 };
    const pass = (r: Room) => r.world.lineOfSight({ ...at, x: -3.5 }, { ...at, x: -6.5 }, 'bullets');
    expect(pass(a.room)).toBe(true);
    expect(pass(b.room)).toBe(false);
  });

  it('the zombie path search goes round shut doors', () => {
    const { g } = game();
    const help = g.blockers.doors.find((d) => d.spec.id === 'help')!;
    expect(help.cells.size).toBeGreaterThan(0);
    const c = g.horde.nav.cells[[...help.cells][0]!]!;
    expect(g.blockers.cellCost(c)).toBeGreaterThan(100);
    g.blockers.open(help);
    expect(g.blockers.cellCost(c)).toBe(1);
  });
});

describe('zombie AI through a barrier', () => {
  it('reaches a survivor in the start room through a window within 30 s (runners)', () => {
    const { room, g, h } = game();
    h.maxHealth = h.health = 1e9;
    place(room, h, 3, 0, 4);
    g.round = 6;
    for (const i of [0, 2, 4, 6, 8]) zombieAt(room, g, i);
    for (const z of g.aliveUndead()) undeadOf(z)!.gait = 'run';
    expect(Math.min(...g.aliveUndead().map((z) => Math.hypot(z.move.x - h.move.x, z.move.z - h.move.z)))).toBeGreaterThan(9);
    let reached = -1;
    const t0 = room.time;
    steps(room, 30, () => {
      hold(room, h, 0);
      if (reached < 0 && g.aliveUndead().some((z) => !g.blockers.isOutside(z.id) && Math.hypot(z.move.x - h.move.x, z.move.z - h.move.z) <= ZOMBIES.swipeReach + 0.2)) reached = room.time - t0;
    });
    expect(reached).toBeGreaterThan(0);
    expect(reached).toBeLessThan(30);
    // Boards came down on the way.
    expect(g.blockers.barriers.slice(0, 5).some((b) => b.boards < BARRIER.boards)).toBe(true);
  });
});
