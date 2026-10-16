/**
 * Infected (MW3) rules, room by room (Lobby + room.step(), no sockets): the First Infected pick
 * and countdown, conversion on any Survivor death, loadouts per role (and the First Infected's
 * bonus going away after the second infection), the last Survivor's bonus, both win conditions,
 * disconnects, scoring/XP and the frontend listing.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import modesFeature, { registerModeRules } from '../src/server/features/modes/index';
import perksFeature from '../src/server/features/perks/index';
import progressionFeature from '../src/server/features/progression/index';
import weaponsFeature from '../src/server/features/weapons/index';
import { controllerOf } from '../src/server/features/modes/common';
import type { InfectedRules } from '../src/server/features/modes/infected';
import { Lobby } from '../src/server/lobby';
import type { PlayerState } from '../src/server/player';
import type { Room, RoomOptions } from '../src/server/room';
import { moveParamsFor } from '../src/server/sim';
import { Session } from '../src/server/session';
import { Store } from '../src/server/store';
import { TICK_DT } from '../src/shared/constants';
import { CHALLENGES } from '../src/shared/defs/challenges';
import { INFECTED, INFECTED_XP } from '../src/shared/defs/infected';
import { MAPS, mapsForMode } from '../src/shared/defs/maps';
import { DEFAULT_TARGET_PLAYERS } from '../src/shared/defs/bots';
import { MODE_BY_ID, MODES } from '../src/shared/defs/modes';
import type { ModeEventPayload } from '../src/shared/defs/modestate';
import type { MatchResults } from '../src/shared/events';
import { PLAYLIST_BY_ID, playlistMode } from '../src/shared/frontend/playlists';
import { newProfile } from '../src/shared/profile';

let store: Store | undefined;
let lobby: Lobby | undefined;
let seq = 0;

beforeAll(() => registerModeRules());

function setup(opts: Partial<RoomOptions> = {}): { room: Room; rules: InfectedRules } {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: [weaponsFeature, perksFeature, progressionFeature, modesFeature], log: () => {}, autoTick: false });
  const room = lobby.createRoom({ mode: 'infected', map: 'yard', closeWhenEmpty: false, ...opts });
  return { room, rules: controllerOf(room) as unknown as InfectedRules };
}

afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = undefined;
  store = undefined;
});

const steps = (room: Room, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) room.step();
};
const idle = (p: PlayerState) => {
  p.brain = { think: (_r, self) => ({ buttons: 0, yaw: self.yaw, pitch: 0, weaponSlot: 0 }) };
  return p;
};
const bots = (room: Room, n: number) => Array.from({ length: n }, (_, i) => idle(room.addBot({ name: `B${i}` })));
function human(room: Room, name = `H${++seq}`): PlayerState {
  const s = new Session(`s${++seq}-${name}`, null, newProfile(`p-${name}-${seq}`, name), 'tok');
  return room.addHuman(s);
}
const events = (room: Room) => {
  const log: ModeEventPayload[] = [];
  const orig = room.sendFeature.bind(room);
  room.sendFeature = ((to, id, data) => {
    if (id === 'modes.event') log.push(data as ModeEventPayload);
    orig(to, id, data);
  }) as Room['sendFeature'];
  return log;
};
const weaponIds = (p: PlayerState) => p.weapons.map((w) => w.def.base.id);
const knife = (room: Room, a: PlayerState, v: PlayerState) => room.kill(v, a, { weapon: 'knife', means: 'melee', part: 'torso' });
/** Skip to the First Infected pick. */
const pick = (room: Room, rules: InfectedRules) => {
  rules.pickAt = room.time;
  room.step();
  const first = [...room.players.values()].find((p) => rules.roleOf(p) === 'infected');
  expect(first).toBeDefined();
  return first!;
};

describe('Infected: the start', () => {
  it('everyone starts a Survivor; one random player becomes the First Infected after the countdown', () => {
    const { room, rules } = setup();
    rules.rng = () => 0.6;
    const ps = bots(room, 5);
    const log = events(room);
    room.step();
    expect(ps.every((p) => p.team === 0 && rules.roleOf(p) === 'survivor')).toBe(true);
    const st = rules.state(ps[0]!).infected!;
    expect(st.pickAt).toBeCloseTo(room.matchStartTime + INFECTED.firstSec, 3);
    expect(st).toMatchObject({ role: 'survivor', survivors: 5, infected: 0, first: null });
    steps(room, INFECTED.firstSec - 1);
    expect(rules.started).toBe(false);
    steps(room, 1.1);
    expect(rules.started).toBe(true);
    const infected = ps.filter((p) => rules.roleOf(p) === 'infected');
    expect(infected).toHaveLength(1);
    // rng 0.6 of 5 living players -> index 3.
    expect(infected[0]).toBe(ps[3]);
    expect(infected[0]!.team).toBe(1);
    expect(infected[0]!.alive).toBe(true);
    expect(ps.filter((p) => p.team === 0)).toHaveLength(4);
    expect(log.find((e) => e.kind === 'infected.first')).toMatchObject({ player: ps[3]!.id, team: 1 });
    expect(rules.state(ps[0]!).infected).toMatchObject({ survivors: 4, infected: 1, first: ps[3]!.id, pickAt: null });
    expect(room.teamScores).toEqual([4, 1]);
  });

  it('waits for a second player before anyone is infected', () => {
    const { room, rules } = setup();
    const solo = idle(room.addBot({ name: 'Solo' }));
    steps(room, INFECTED.firstSec + 2);
    expect(rules.started).toBe(false);
    expect(rules.state(solo).infected!.waiting).toBe(true);
    idle(room.addBot({ name: 'Second' }));
    steps(room, 1.1);
    expect(rules.started).toBe(true);
    expect(rules.counts()).toEqual({ survivors: 1, infected: 1 });
  });
});

describe('Infected: conversion', () => {
  it('a Survivor killed by an Infected, or dying any other way, comes back Infected; deaths before the pick do not', () => {
    const { room, rules } = setup();
    const ps = bots(room, 4);
    room.step();
    // Before the pick: a fall just respawns a Survivor.
    room.kill(ps[0]!, null, { weapon: 'world', means: 'fall' });
    expect(rules.roleOf(ps[0]!)).toBe('survivor');
    steps(room, 3.2);
    expect(ps[0]!.alive).toBe(true);
    const first = pick(room, rules);
    const [v1, v2] = ps.filter((p) => p !== first);
    const log = events(room);
    knife(room, first, v1!);
    expect(rules.roleOf(v1!)).toBe('infected');
    expect(v1!.team).toBe(1);
    expect(log.find((e) => e.kind === 'infected.infect')).toMatchObject({ player: first.id, reason: v1!.id });
    steps(room, 3.2);
    expect(v1!.alive).toBe(true);
    expect(weaponIds(v1!)).toEqual(['knife']);
    // Out of bounds / fall: still infected (MW3: a Survivor who dies any way joins the Infected).
    room.kill(v2!, null, { weapon: 'world', means: 'world' });
    expect(rules.roleOf(v2!)).toBe('infected');
    // An Infected killed by a Survivor stays Infected.
    const last = ps.find((p) => rules.roleOf(p) === 'survivor')!;
    room.kill(v1!, last, { weapon: 'spas12', means: 'bullet', part: 'torso' });
    expect(rules.roleOf(v1!)).toBe('infected');
    expect(last.stats.kills).toBe(1);
  });
});

describe('Infected: loadouts', () => {
  it('Survivors: SPAS-12 + M1911, Scavenger + Steady Aim, double reserve, no grenades', () => {
    const { room, rules } = setup();
    const [a] = bots(room, 3);
    room.step();
    expect(rules.roleOf(a!)).toBe('survivor');
    expect(weaponIds(a!)).toEqual(['spas12', 'm1911']);
    expect(a!.weapons[0]!.reserve).toBe(a!.weapons[0]!.def.reserve * INFECTED.survivorReserveMul);
    expect(a!.loadout?.perks).toEqual(['scavenger', 'steady_aim']);
    expect(a!.loadout?.lethal).toBeNull();
    expect(a!.loadout?.killstreaks).toEqual([]);
  });

  it('Infected: knife and tomahawk, Lightweight + Marathon and faster; the First Infected keeps the guns until a second infection', () => {
    const { room, rules } = setup();
    const ps = bots(room, 4);
    room.step();
    const survivorSpeed = moveParamsFor(room, ps[0]!).speed;
    const first = pick(room, rules);
    // First Infected: Survivor guns + tomahawk + Infected perks, in place.
    expect(weaponIds(first)).toEqual(['spas12', 'm1911']);
    expect(first.loadout?.lethal).toBe('tomahawk');
    expect(first.ext.weapons?.lethal).toBe('tomahawk');
    expect(first.ext.weapons?.lethalN).toBe(1);
    expect(first.loadout?.perks).toEqual(['lightweight', 'marathon']);
    // Respawning keeps the bonus while they are the only Infected.
    room.kill(first, null, { weapon: 'world', means: 'fall' });
    steps(room, 3.2);
    expect(weaponIds(first)).toEqual(['spas12', 'm1911']);
    // Second infection: the bonus goes, the knife comes out (now, in place).
    const v = ps.find((p) => p !== first)!;
    room.kill(v, first, { weapon: 'spas12', means: 'bullet', part: 'torso' });
    expect(rules.firstId).toBeNull();
    expect(weaponIds(first)).toEqual(['knife']);
    expect(first.slot).toBe(0);
    steps(room, 3.2);
    for (const p of [first, v]) {
      expect(weaponIds(p)).toEqual(['knife']);
      expect(p.loadout?.lethal).toBe('tomahawk');
      expect(p.ext.weapons?.lethal).toBe('tomahawk');
      expect(p.loadout?.perks).toEqual(['lightweight', 'marathon']);
      // Knife moveMult 1 vs the SPAS-12's 0.95, Lightweight 1.07, the mode's boost on top.
      expect(moveParamsFor(room, p).speed).toBeGreaterThan(survivorSpeed * 1.15);
    }
  });
});

describe('Infected: last one standing', () => {
  it('the last Survivor gets an RPK, full ammo and a radar of the Infected; the Infected get a sweep of them', () => {
    const { room, rules } = setup();
    const ps = bots(room, 3);
    room.step();
    const first = pick(room, rules);
    const [a, b] = ps.filter((p) => p !== first) as [PlayerState, PlayerState];
    const log = events(room);
    knife(room, first, a);
    expect(rules.lastId).toBe(b.id);
    expect(weaponIds(b)).toEqual(['spas12', 'rpk']);
    expect(b.weapons[1]!.def.attachmentIds).toContain('extmag');
    expect(log.find((e) => e.kind === 'infected.last_alive')).toMatchObject({ player: b.id });
    expect(rules.state(b).infected!.last).toBe(b.id);
    // The last Survivor sees every living Infected on radar.
    steps(room, 3.2);
    expect(room.radarFor(b).sort()).toEqual([first.id, a.id].sort());
    // The Infected see the last Survivor during a sweep only.
    expect(room.radarFor(first)).not.toContain(b.id);
    steps(room, rules.sweepNext - room.time + 0.2);
    expect(room.radarFor(first)).toContain(b.id);
    steps(room, INFECTED.sweepSec + 0.2);
    expect(room.radarFor(first)).not.toContain(b.id);
  });
});

describe('Infected: winning', () => {
  it('the Infected win when no Survivor is left', () => {
    const { room, rules } = setup();
    const ps = bots(room, 3);
    room.step();
    const first = pick(room, rules);
    let results: MatchResults | null = null;
    room.bus.on('matchEnd', (e) => (results = e.results));
    for (const v of ps.filter((p) => p !== first)) knife(room, first, v);
    expect(room.phase).toBe('ended');
    const r = results as unknown as MatchResults;
    expect(r.reason).toBe('score');
    expect(r.winnerTeam).toBe(1);
    expect(r.teamScores).toEqual([0, 3]);
    expect(r.players.every((p) => p.won)).toBe(true);
  });

  it('the Survivors win at the time limit; survivors alive get OUTLASTED, a lone last one FINAL STAND, and XP for both', () => {
    const { room, rules } = setup();
    const h = human(room, 'Hero');
    const others = bots(room, 2);
    idle(h);
    room.step();
    rules.rng = () => 0.99; // the last living player (a bot) starts infected
    const first = pick(room, rules);
    expect(first).not.toBe(h);
    const other = others.find((p) => p !== first)!;
    knife(room, first, other);
    expect(rules.lastId).toBe(h.id);
    const log = events(room);
    let results: MatchResults | null = null;
    room.bus.on('matchEnd', (e) => (results = e.results));
    steps(room, room.mode.timeLimitSec + 1);
    const r = results as unknown as MatchResults;
    expect(r.reason).toBe('time');
    expect(r.winnerTeam).toBe(0);
    expect(r.winners).toEqual([h.id]);
    expect(log.some((e) => e.kind === 'infected.outlast' && e.player === h.id)).toBe(true);
    expect(log.some((e) => e.kind === 'infected.final_stand' && e.player === h.id)).toBe(true);
    // Survival over time: every 30 s alive, plus one when the other Survivor was infected.
    const surv = log.filter((e) => e.kind === 'infected.survive' && e.player === h.id).length;
    expect(surv).toBeGreaterThanOrEqual(Math.floor(room.mode.timeLimitSec / INFECTED.surviveEverySec) - 1);
    expect(h.ext.modes?.xp.survive).toBeGreaterThan(0);
    expect(h.ext.modes?.xp.finalStand).toBe(INFECTED_XP.finalStand);
    // Progression saw the objectives (XP lines and the challenge metric).
    const lines = h.ext.progression?.lines;
    expect(lines?.get('obj.final_stand')?.xp).toBeGreaterThan(0);
    expect(lines?.get('obj.outlast')?.xp).toBeGreaterThan(0);
    expect(lines?.get('obj.survive')?.xp).toBeGreaterThan(0);
    expect(h.profile!.challengeProgress['infected_last_stand']).toBe(1);
  });

  it('infecting earns score and XP, and counts for Patient Zero', () => {
    const { room, rules } = setup();
    const h = idle(human(room, 'Zero'));
    const vs = bots(room, 3);
    room.step();
    rules.makeFirst(h);
    for (const v of vs.slice(0, 2)) knife(room, h, v);
    expect(h.ext.modes?.stats.infections).toBe(2);
    expect(h.ext.modes?.xp.infect).toBe(2 * INFECTED_XP.infect);
    expect(h.ext.progression?.lines.get('obj.infect')?.count).toBe(2);
    expect(h.profile!.challengeProgress['infected_infect']).toBe(2);
    expect(CHALLENGES.find((c) => c.id === 'infected_infect')?.goal).toBe(10);
  });
});

describe('Infected: disconnects', () => {
  it('all Infected leave: a new First Infected is picked after a short countdown', () => {
    const { room, rules } = setup();
    const ps = bots(room, 4);
    room.step();
    const first = pick(room, rules);
    const log = events(room);
    room.removePlayer(first.id, 'disconnect');
    expect(rules.started).toBe(false);
    expect(rules.counts()).toEqual({ survivors: 3, infected: 0 });
    expect(log.some((e) => e.kind === 'infected.countdown')).toBe(true);
    expect(room.phase).toBe('playing');
    steps(room, INFECTED.repickSec + 0.2);
    expect(rules.started).toBe(true);
    const next = ps.filter((p) => p !== first && rules.roleOf(p) === 'infected');
    expect(next).toHaveLength(1);
    expect(rules.firstId).toBe(next[0]!.id);
    expect(weaponIds(next[0]!)).toEqual(['spas12', 'm1911']);
  });

  it('down to one Infected after a leave: that one is the First Infected again', () => {
    const { room, rules } = setup();
    const ps = bots(room, 4);
    room.step();
    const first = pick(room, rules);
    const v = ps.find((p) => p !== first)!;
    knife(room, first, v);
    steps(room, 3.2);
    expect(weaponIds(v)).toEqual(['knife']);
    room.removePlayer(first.id, 'disconnect');
    expect(rules.firstId).toBe(v.id);
    expect(weaponIds(v)).toEqual(['spas12', 'm1911']);
    expect(v.ext.weapons?.lethal).toBe('tomahawk');
  });

  it('the last Survivor leaving ends it for the Infected; late joiners join the Infected', () => {
    const { room, rules } = setup();
    const ps = bots(room, 3);
    room.step();
    const first = pick(room, rules);
    const late = idle(room.addBot({ name: 'Late' }));
    expect(rules.roleOf(late)).toBe('infected');
    expect(late.team).toBe(1);
    const survivors = ps.filter((p) => p !== first);
    knife(room, first, survivors[0]!);
    room.removePlayer(survivors[1]!.id, 'disconnect');
    expect(room.phase).toBe('ended');
    expect(room.results?.winnerTeam).toBe(1);
  });
});

describe('Infected: spawns', () => {
  it('Infected respawn away from Survivors (never within 12 m)', () => {
    const { room, rules } = setup();
    const ps = bots(room, 6);
    room.step();
    const first = pick(room, rules);
    for (let i = 0; i < 6; i++) {
      room.kill(first, null, { weapon: 'world', means: 'fall' });
      steps(room, 3.1);
      expect(first.alive).toBe(true);
      for (const s of ps.filter((p) => p.alive && rules.roleOf(p) === 'survivor')) expect(Math.hypot(s.move.x - first.move.x, s.move.z - first.move.z)).toBeGreaterThan(10);
    }
  });
});

describe('Infected: listing', () => {
  it('is a registered mode with a Quick Play playlist, bot fill, challenges, and every map with TDM/FFA spawns', () => {
    const def = MODE_BY_ID.get('infected')!;
    expect(def).toMatchObject({ teams: true, respawn: true, teamsByRules: true, timeLimitSec: 600 });
    expect(def.teamNames).toEqual(['Survivors', 'Infected']);
    expect(playlistMode(PLAYLIST_BY_ID.get('infected')!)).toBe('infected');
    // The private lobby lists every non-wager mode.
    expect(MODES.filter((m) => m.playlist !== 'wager').map((m) => m.id)).toContain('infected');
    expect(DEFAULT_TARGET_PLAYERS.infected).toBe(12);
    const withSpawns = MAPS.filter((m) => m.modes.includes('tdm') || m.modes.includes('ffa')).map((m) => m.id);
    expect(mapsForMode('infected').map((m) => m.id).sort()).toEqual(withSpawns.sort());
    expect(CHALLENGES.map((c) => c.id)).toEqual(expect.arrayContaining(['infected_infect', 'infected_last_stand', 'infected_outlast', 'infected_wins']));
  });
});
