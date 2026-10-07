/** Bots wired to other areas: mode objectives (modes) and per-game lobbies (frontend). */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import botsFeature from '../src/server/features/bots/index';
import { botBrain, getRoomBots } from '../src/server/features/bots/api';
import { goalFromObjective } from '../src/server/features/bots/objectives';
import { createFrontendFeature, LobbyManager } from '../src/server/features/frontend/index';
import modesFeature, { registerModeRules } from '../src/server/features/modes/index';
import { controllerOf } from '../src/server/features/modes/common';
import type { DomRules } from '../src/server/features/modes/dom';
import { Lobby } from '../src/server/lobby';
import type { Room } from '../src/server/room';
import { Session } from '../src/server/session';
import { Store } from '../src/server/store';
import { TICK_DT } from '../src/shared/constants';
import { BOT_DIFFICULTY_BY_ID, MATCHMAKING_WAIT_SEC } from '../src/shared/defs/bots';
import { Buttons } from '../src/shared/input';
import { newProfile } from '../src/shared/profile';

let store: Store | undefined;
let lobby: Lobby | undefined;
let sid = 0;

beforeAll(() => registerModeRules());

afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = undefined;
  store = undefined;
});

const steps = (room: Room, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) room.step();
};
const session = (name = `P${++sid}`) => new Session(`s${++sid}`, null, newProfile(`prof-${sid}`, name), `tok${sid}`);

describe('bots <- modes objectives', () => {
  it('maps a modes objective to a bot goal (stay -> hold, holdUse -> USE)', () => {
    const g = goalFromObjective({ kind: 'plant', id: 'A', pos: { x: 1, y: 2, z: 3 }, radius: 2, priority: 0.9, holdUse: true, stay: true });
    expect(g).toMatchObject({ at: { x: 1, y: 2, z: 3 }, radius: 2, hold: true, priority: 0.9, holdButtons: Buttons.USE, sprint: true });
    const c = goalFromObjective({ kind: 'collect', id: 'tag:1', pos: { x: 0, y: 0, z: 0 }, radius: 1, priority: 0.4 });
    expect(c.hold).toBe(false);
    expect(c.holdButtons).toBe(0);
  });

  it('a bot with objectivePlay 1 captures a Domination flag on its own', () => {
    store = new Store(':memory:');
    lobby = new Lobby({ store, features: [modesFeature, botsFeature], log: () => {}, autoTick: false });
    const room = lobby.createRoom({ mode: 'dom', map: 'yard', private: true, closeWhenEmpty: false, onEnd: 'close', countdownSec: 0 });
    const rb = getRoomBots(room)!;
    rb.managed = false;
    rb.update({ fill: false, difficulty: 'custom', custom: { ...BOT_DIFFICULTY_BY_ID.get('regular')!.skill, objectivePlay: 1 }, variance: 0 });
    room.addBot({ name: 'Capper', team: 0 });
    const rules = controllerOf(room) as DomRules;
    let t = 0;
    while (t < 60 && !rules.flags.some((f) => f.zone.owner === 0)) {
      steps(room, 1);
      t += 1;
    }
    expect(rules.flags.some((f) => f.zone.owner === 0)).toBe(true);
  });
});

describe('bots <- frontend lobbies', () => {
  function setup() {
    store = new Store(':memory:');
    lobby = new Lobby({ store, features: [createFrontendFeature(), botsFeature], log: () => {}, autoTick: false });
    const m = new LobbyManager({ lobby, rand: () => 0 });
    return { lobby, m };
  }

  it('a matchmade lobby starts with core backfill; the bots feature adds brains and takes the skill, not the count', () => {
    const { lobby, m } = setup();
    const a = session();
    const l = m.matchmake(a, 'tdm');
    l.bots = { ...l.bots, difficulty: 'veteran' };
    lobby.join(a, l.room.id);
    steps(l.room, MATCHMAKING_WAIT_SEC + 1);
    const room = l.room;
    expect(room.phase).not.toBe('lobby');
    const target = Math.min(l.bots.targetPlayers, room.options.maxPlayers);
    expect(room.players.size).toBe(target);
    const rb = getRoomBots(room)!;
    expect(rb.managed).toBe(false);
    expect(rb.settings.difficulty).toBe('veteran');
    for (const b of room.bots()) expect(botBrain(room, b)).toBeDefined();
    // A second human joins mid-match: core trims one bot; the bots feature must not retire another.
    lobby.join(session(), room.id);
    steps(room, 8);
    expect(room.players.size).toBe(target);
    expect(rb.retiring.size).toBe(0);
  });

  it('a lobby with bots switched off starts without bots', () => {
    const { lobby, m } = setup();
    const a = session();
    const l = m.createLobby({ kind: 'private', mode: 'tdm', creator: a.id });
    lobby.join(a, l.room.id);
    l.bots = { ...l.bots, fill: false };
    m.startNow(l);
    steps(l.room, 3);
    expect(l.room.phase).not.toBe('lobby');
    expect(l.room.bots().length).toBe(0);
  });
});
