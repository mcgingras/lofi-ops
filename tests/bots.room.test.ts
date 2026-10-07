/** Bots through real rooms (rules level: Lobby + room.step(), no sockets). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import botsFeature from '../src/server/features/bots/index';
import { botBrain, configureRoomBots, createBotRoom, getRoomBots, registerBotGoal } from '../src/server/features/bots/api';
import { botStreakSkill } from '../src/server/features/killstreaks/skill';
import { Lobby } from '../src/server/lobby';
import { makeWeapon, type PlayerState } from '../src/server/player';
import type { Room, RoomOptions } from '../src/server/room';
import { Session } from '../src/server/session';
import { Store } from '../src/server/store';
import { TICK_DT } from '../src/shared/constants';
import { BOT_DIFFICULTY_BY_ID, MATCHMAKING_WAIT_SEC, type BotSkill } from '../src/shared/defs/bots';
import { buildCollisionWorld } from '../src/shared/maps/types';
import { createMoveState } from '../src/shared/movement';
import { newProfile } from '../src/shared/profile';
import { stairsMap } from './bots-fixtures';

let store: Store | undefined;
let lobby: Lobby | undefined;
let sessionSeq = 0;

function setupLobby(): Lobby {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: [botsFeature], log: () => {}, autoTick: false });
  return lobby;
}

function room(opts: Partial<RoomOptions> = {}): Room {
  return (lobby ?? setupLobby()).createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, ...opts });
}

function human(r: Room, name = `Human${++sessionSeq}`): PlayerState {
  const s = new Session(`s${sessionSeq}-${name}`, null, newProfile(`p-${name}`, name), 'tok');
  return r.addHuman(s);
}

const steps = (r: Room, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) r.step();
};
const teamSizes = (r: Room) => [0, 1].map((t) => [...r.players.values()].filter((p) => p.team === t).length);
const preset = (id: string): BotSkill => ({ ...BOT_DIFFICULTY_BY_ID.get(id as 'regular')!.skill });

afterEach(() => {
  vi.restoreAllMocks();
  lobby?.shutdown();
  store?.close();
  lobby = undefined;
  store = undefined;
});

describe('bots: navigation in a room', () => {
  it('walks from one end of the Yard to the other around obstacles', () => {
    const r = room({ private: true });
    configureRoomBots(r, { fill: false }, { waitSec: 0 });
    const bot = r.addBot({ name: 'Walker', team: 0 });
    steps(r, 0.2);
    bot.move = { ...createMoveState(-14, 0, -22), onGround: true };
    const brain = botBrain(r, bot)!;
    brain.forced = { at: { x: 9, y: 0, z: 25 }, radius: 1 };
    let t = 0;
    while (t < 30 && Math.hypot(bot.move.x - 9, bot.move.z - 25) > 1.5) {
      steps(r, 0.5);
      t += 0.5;
    }
    expect(Math.hypot(bot.move.x - 9, bot.move.z - 25)).toBeLessThan(1.5);
    expect(t).toBeLessThan(20);
    expect(bot.alive).toBe(true);
  });

  it('climbs stairs to a platform and a ramp to a deck', () => {
    const r = room({ private: true, mode: 'ffa' });
    const map = stairsMap();
    r.map = map;
    r.world = buildCollisionWorld(map);
    configureRoomBots(r, { fill: false }, { waitSec: 0 });
    const bot = r.addBot({ name: 'Climber' });
    steps(r, 0.2);
    bot.move = { ...createMoveState(0, 0, -12), onGround: true };
    const brain = botBrain(r, bot)!;
    brain.forced = { at: { x: 12, y: 2.4, z: -11 }, radius: 0.8 };
    let t = 0;
    while (t < 25 && !(bot.move.y > 2.3 && bot.move.x > 8.5)) {
      steps(r, 0.25);
      t += 0.25;
    }
    expect(bot.move.y).toBeCloseTo(2.4, 1);
    expect(bot.move.x).toBeGreaterThan(8.5);

    brain.forced = { at: { x: -10.5, y: 1.5, z: -5 }, radius: 0.8 };
    brain.path = null;
    t = 0;
    while (t < 30 && !(bot.move.y > 1.4 && bot.move.z < -2.5 && bot.move.x < -7)) {
      steps(r, 0.25);
      t += 0.25;
    }
    expect(bot.move.y).toBeCloseTo(1.5, 1);
  });
});

describe('bots: combat', () => {
  it('bots find each other, fight and get kills', () => {
    const r = room({ private: true });
    const deaths: string[] = [];
    r.bus.on('death', (e) => deaths.push(`${e.attacker?.name}>${e.victim.name}`));
    configureRoomBots(r, { targetPlayers: 4, difficulty: 'veteran', variance: 0 }, { waitSec: 0 });
    expect(r.bots().length).toBe(4);
    expect(teamSizes(r)).toEqual([2, 2]);
    steps(r, 60);
    expect(deaths.length).toBeGreaterThanOrEqual(2);
    expect(r.teamScores[0] + r.teamScores[1]).toBeGreaterThanOrEqual(2);
  });

  it('accuracy scales with difficulty (hit rate against a still target at 14-20 m)', () => {
    const rate = (id: string) => {
      // Same bot loadout, rolls and timing jitter for every difficulty: only the skill differs.
      let mr = 12345;
      const spy = vi.spyOn(Math, 'random').mockImplementation(() => (mr = (mr * 48271) % 2147483647) / 2147483647);
      setupLobby();
      const r = room({ private: true });
      configureRoomBots(r, { fill: false, difficulty: id as 'regular', variance: 0 }, { waitSec: 0 });
      const shooter = r.addBot({ name: 'Shooter', team: 0 });
      const dummy = r.addBot({ name: 'Dummy', team: 1 });
      dummy.brain = { think: () => null };
      r.bus.on('beforeDamage', (e) => {
        if (e.victim === dummy) e.cancel = true;
      });
      let shots = 0;
      let hits = 0;
      r.bus.on('fire', (e) => {
        if (e.player !== shooter) return;
        shots++;
        if (e.hits.some((h) => h.victim === dummy)) hits++;
      });
      const brain = botBrain(r, shooter)!;
      let seed = 1;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let round = 0; round < 24; round++) {
        shooter.move = { ...createMoveState(-12, 0, -23.5), onGround: true };
        dummy.move = { ...createMoveState(2 + rnd() * 6, 0, -24.5 + rnd() * 2), onGround: true };
        shooter.weapons.forEach((w) => {
          w.mag = w.def.magazine;
          w.reserve = w.def.reserve;
        });
        brain.target = null;
        brain.aim.yaw = -Math.PI / 2 + (rnd() - 0.5) * 0.6;
        steps(r, 2.5);
      }
      lobby!.shutdown();
      store!.close();
      lobby = undefined;
      store = undefined;
      spy.mockRestore();
      return { shots, hits, rate: hits / Math.max(1, shots) };
    };
    const recruit = rate('recruit');
    const regular = rate('regular');
    const veteran = rate('veteran');
    expect(recruit.shots).toBeGreaterThan(20);
    expect(veteran.shots).toBeGreaterThan(20);
    expect(regular.rate).toBeGreaterThan(recruit.rate);
    expect(veteran.rate).toBeGreaterThan(regular.rate);
    expect(veteran.rate).toBeGreaterThan(recruit.rate * 2);
    expect(veteran.rate).toBeGreaterThan(0.5);
  });

  it('hears unsuppressed gunfire within hearingRange and turns to it', () => {
    const r = room({ private: true });
    configureRoomBots(r, { fill: false, difficulty: 'custom', custom: { ...preset('regular'), hearingRange: 30 }, variance: 0 }, { waitSec: 0 });
    const listener = r.addBot({ name: 'Ears', team: 0 });
    const deaf = r.addBot({ name: 'Far', team: 0 });
    const shooter = r.addBot({ name: 'Loud', team: 1 });
    shooter.brain = { think: () => null };
    steps(r, 0.5);
    listener.move = { ...createMoveState(0, 0, 0), onGround: true };
    deaf.move = { ...createMoveState(-20, 0, -22), onGround: true };
    shooter.move = { ...createMoveState(0, 0, 20), onGround: true };
    // A fixed, unsuppressed hitscan rifle: the random bot class may roll a suppressor.
    shooter.weapons = [makeWeapon({ weapon: 'ak47', attachments: [], camo: '' }, 'ak47')];
    shooter.slot = 0;
    shooter.swapEnd = 0;
    shooter.reloadEnd = 0;
    expect(r.fire(shooter, { dir: { x: 0, y: 0, z: -1 } }).ok).toBe(true);
    expect(botBrain(r, listener)!.heard).not.toBeNull();
    expect(botBrain(r, deaf)!.heard).toBeNull();
  });
});

describe('bots: lobby backfill and replacement', () => {
  it('backfills to the target when the match starts, teams balanced', () => {
    const r = room({ private: true, autoStart: false, onEnd: 'lobby', countdownSec: 2 });
    const h = human(r);
    configureRoomBots(r, { targetPlayers: 6, difficulty: 'hardened' });
    expect(r.bots().length).toBe(0);
    r.startMatch();
    expect(r.phase).toBe('countdown');
    expect(r.players.size).toBe(6);
    expect(r.bots().length).toBe(5);
    expect(teamSizes(r)).toEqual([3, 3]);
    expect(r.bots().every((b) => b.alive && b.brain)).toBe(true);
    expect(new Set(r.bots().map((b) => b.name)).size).toBe(5);
    expect(h.alive).toBe(true);
    steps(r, 2.2);
    expect(r.phase).toBe('playing');
    expect(r.players.size).toBe(6);
  });

  it('replaces a leaving human with a bot on the same team', () => {
    const r = room({ private: true, autoStart: false, countdownSec: 0 });
    const a = human(r);
    const b = human(r);
    configureRoomBots(r, { targetPlayers: 6 });
    r.startMatch();
    expect(r.players.size).toBe(6);
    const team = b.team;
    const before = teamSizes(r);
    r.removePlayer(b.id, 'left');
    expect(r.players.size).toBe(6);
    expect(teamSizes(r)).toEqual(before);
    const newest = r.bots().at(-1)!;
    expect(newest.team).toBe(team);
    expect(newest.alive).toBe(true);
    expect(a.alive).toBe(true);
  });

  it('a human joining mid-match takes a bot slot at that bot`s next death', () => {
    const r = room({ private: true, autoStart: false, countdownSec: 0 });
    human(r);
    configureRoomBots(r, { targetPlayers: 4 });
    r.startMatch();
    expect(r.bots().length).toBe(3);
    const late = human(r, 'Late');
    // Nobody removed yet: the bot plays on until it dies.
    expect(r.players.size).toBe(5);
    const rb = getRoomBots(r)!;
    expect(rb.retiring.size).toBe(1);
    const victim = r.players.get([...rb.retiring][0]!)!;
    expect(victim.isBot).toBe(true);
    expect(victim.team).toBe(late.team);
    steps(r, 1);
    expect(r.players.has(victim.id)).toBe(true);
    r.kill(victim, null, { weapon: 'world', means: 'world' });
    expect(victim.respawnAt).toBeNull();
    steps(r, 2);
    expect(r.players.has(victim.id)).toBe(false);
    expect(r.players.size).toBe(4);
    expect(teamSizes(r)).toEqual([2, 2]);
  });

  it('quick-play rooms wait for humans, then start with bots', () => {
    const r = room({ autoStart: true });
    human(r);
    expect(r.phase).toBe('playing');
    const rb = getRoomBots(r)!;
    expect(rb.fillAt).toBeCloseTo(MATCHMAKING_WAIT_SEC, 0);
    steps(r, MATCHMAKING_WAIT_SEC - 1);
    expect(r.bots().length).toBe(0);
    steps(r, 1.5);
    expect(rb.fillAt).toBeNull();
    expect(r.players.size).toBe(12);
    expect(teamSizes(r)).toEqual([6, 6]);
  });

  it('"Play with bots" starts at once, private, with the chosen difficulty', () => {
    setupLobby();
    const r = createBotRoom(lobby!, { mode: 'ffa', map: 'yard', difficulty: 'recruit', targetPlayers: 5, variance: 0 }, 'host-1');
    expect(r.options.private).toBe(true);
    expect(r.phase).toBe('playing');
    expect(r.bots().length).toBe(5);
    const skill = botBrain(r, r.bots()[0]!)!.skill;
    expect(skill).toEqual(preset('recruit'));
  });

  it('custom skill is applied to every bot, live, and fill off removes bots', () => {
    const r = room({ private: true, autoStart: false, countdownSec: 0 });
    human(r);
    configureRoomBots(r, { targetPlayers: 4, variance: 0 });
    r.startMatch();
    const custom: BotSkill = { ...preset('regular'), reactionMs: 123, aimErrorDeg: 0.7, headshotBias: 0.9, aggression: 0.1 };
    configureRoomBots(r, { difficulty: 'custom', custom });
    for (const b of r.bots()) expect(botBrain(r, b)!.skill).toEqual(custom);
    // With variance each bot differs a little but stays near the custom values.
    configureRoomBots(r, { variance: 0.3 });
    const reactions = r.bots().map((b) => botBrain(r, b)!.skill.reactionMs);
    const turns = r.bots().map((b) => botBrain(r, b)!.skill.turnSpeedDeg);
    expect(new Set(turns).size).toBeGreaterThan(1);
    for (const x of reactions) expect(Math.abs(x - 123)).toBeLessThanOrEqual(0.3 * 0.35 * 1400 + 1e-6);
    // Fill off: bots retire (dead ones at once, live ones at their next death).
    configureRoomBots(r, { fill: false });
    for (const b of [...r.bots()]) r.kill(b, null, { weapon: 'world', means: 'world' });
    steps(r, 2);
    expect(r.bots().length).toBe(0);
  });

  it('lobby skill settings reach the killstreak skill (streakUse), live', () => {
    const r = room({ private: true, autoStart: false, countdownSec: 0 });
    human(r);
    configureRoomBots(r, { targetPlayers: 4, difficulty: 'recruit', variance: 0 });
    r.startMatch();
    expect(r.bots().length).toBeGreaterThan(0);
    for (const b of r.bots()) expect(botStreakSkill(b)).toBe(preset('recruit').streakUse);
    configureRoomBots(r, { difficulty: 'custom', custom: { ...preset('regular'), streakUse: 0.95 } });
    for (const b of r.bots()) expect(botStreakSkill(b)).toBe(0.95);
  });

  it('bots leave when the room goes back to the lobby and come back at the next start', () => {
    const r = room({ private: true, autoStart: false, countdownSec: 0, onEnd: 'lobby', postMatchSec: 1 });
    human(r);
    configureRoomBots(r, { targetPlayers: 4 });
    r.startMatch();
    expect(r.bots().length).toBe(3);
    r.endMatch('forfeit');
    expect(r.results?.ext.bots).toMatchObject({ bots: 3, humans: 1, practice: false });
    steps(r, 1.2);
    expect(r.phase).toBe('lobby');
    expect(r.bots().length).toBe(0);
    r.startMatch();
    expect(r.bots().length).toBe(3);
  });
});

describe('bots: objective goals hook', () => {
  it('bots with objectivePlay 1 head for a registered mode goal and hold it', () => {
    const off = registerBotGoal('tdm', () => ({ at: { x: 12, y: 0, z: -4 }, radius: 2, hold: true, priority: 1 }));
    try {
      const r = room({ private: true });
      configureRoomBots(r, { fill: false, difficulty: 'custom', custom: { ...preset('regular'), objectivePlay: 1 }, variance: 0 }, { waitSec: 0 });
      const bot = r.addBot({ name: 'Capper', team: 0 });
      steps(r, 0.2);
      bot.move = { ...createMoveState(-14, 0, -20), onGround: true };
      steps(r, 15);
      expect(Math.hypot(bot.move.x - 12, bot.move.z + 4)).toBeLessThan(3);
      steps(r, 4);
      expect(Math.hypot(bot.move.x - 12, bot.move.z + 4)).toBeLessThan(3);
    } finally {
      off();
    }
  });
});
