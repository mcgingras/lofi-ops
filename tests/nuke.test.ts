/**
 * Tactical Nuke (MW2, 25 kills) rules on a room driven tick by tick: cost and Hardline, the
 * killstreak-kill counting option, countdown timing, the shockwave, the match end and its winner in
 * TDM / FFA / S&D, the caller dying or leaving, frozen scores, wagers and bots, plus the full
 * match-end flow (progression XP and challenges, modes summary without killcams, CoD Points).
 */
import { afterEach, describe, expect, it } from 'vitest';
import economy from '../src/server/features/economy/index';
import killstreaks from '../src/server/features/killstreaks/index';
import { botAutoStreaks, callKillstreak, readyKillstreaks } from '../src/server/features/killstreaks/api';
import { ksOf, stateMsg } from '../src/server/features/killstreaks/state';
import { nukeOf, nukeResults } from '../src/server/features/killstreaks/streaks/nuke';
import { ksRoom } from '../src/server/features/killstreaks/world';
import modes, { registerModeRules } from '../src/server/features/modes/index';
import perks from '../src/server/features/perks/index';
import progression from '../src/server/features/progression/index';
import type { Feature } from '../src/server/feature';
import { Lobby } from '../src/server/lobby';
import type { PlayerState } from '../src/server/player';
import type { Room, RoomOptions } from '../src/server/room';
import { Store } from '../src/server/store';
import { CHALLENGE_BY_ID } from '../src/shared/defs/challenges';
import { NO_DEATHCAM_MEANS } from '../src/shared/defs/deathcam';
import { KILLSTREAK_BY_ID, KS_ENTITY, streakCost } from '../src/shared/defs/killstreaks';
import { NUKE, nukeEndAt, shockAt } from '../src/shared/defs/nuke';
import { matchSummaryFor } from '../src/shared/defs/progression';
import type { MatchResults } from '../src/shared/events';
import { validateLoadout } from '../src/shared/frontend/loadout-rules';
import { newProfile } from '../src/shared/profile';
import { bot, give, gunKill, place, steps, until, withProfile } from './perks-streaks.helpers';

registerModeRules();

let lobby: Lobby | null = null;
let store: Store | null = null;
afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = null;
  store = null;
});

function makeRoom(opts: Partial<RoomOptions> = {}, features: Feature[] = [perks, killstreaks]): Room {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features, log: () => {}, autoTick: false });
  return lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, postMatchSec: 30, ...opts });
}

/** Call the nuke for `p` (granted) and return the running instance. */
function callNukeFor(room: Room, p: PlayerState) {
  give(p, 'nuke');
  const res = callKillstreak(room, p, 'nuke');
  expect(res).toEqual({ ok: true });
  return nukeOf(ksRoom(room))!;
}

const deaths = (room: Room) => {
  const out: { victim: string; attacker: string | null; weapon: string; means: string; at: number }[] = [];
  room.bus.on('death', (e) => out.push({ victim: e.victim.id, attacker: e.attacker?.id ?? null, weapon: e.weapon, means: e.means, at: room.time }));
  return out;
};

const matchEnd = (room: Room) => {
  const box: { results: MatchResults | null; at: number } = { results: null, at: -1 };
  room.bus.on(
    'matchEnd',
    ({ results }) => {
      box.results = results;
      box.at = room.time;
    },
    { priority: -100 },
  );
  return box;
};

describe('Tactical Nuke def and cost', () => {
  it('costs 25, 24 with Hardline, counts streak kills, is off in wagers and unlocks at level 25', () => {
    const def = KILLSTREAK_BY_ID.get('nuke')!;
    expect(def).toMatchObject({ name: 'Tactical Nuke', kills: 25, countsStreakKills: true, noWager: true, targeting: 'none' });
    expect(streakCost(def, 0)).toBe(25);
    expect(streakCost(def, -1)).toBe(24);
    expect(def.unlockLevel).toBe(25);
    const room = makeRoom();
    const plain = bot(room, 0, [], ['uav', 'attack_dogs', 'nuke']);
    const hard = bot(room, 0, ['hardline'], ['uav', 'attack_dogs', 'nuke']);
    expect(stateMsg(room, plain).chosen).toEqual([
      { id: 'uav', cost: 3 },
      { id: 'attack_dogs', cost: 11 },
      { id: 'nuke', cost: 25 },
    ]);
    expect(stateMsg(room, hard).chosen.at(-1)).toEqual({ id: 'nuke', cost: 24 });
  });

  it("the Create-a-Class rules accept it as the 25-kill third streak (once it's unlocked)", () => {
    const prof = newProfile('p1', 'Nuker');
    prof.level = 50;
    const src = { ...prof.loadouts[0]!, killstreaks: ['uav', 'attack_dogs', 'nuke'] };
    const res = validateLoadout(prof, src);
    expect(res.loadout.killstreaks).toEqual(['uav', 'attack_dogs', 'nuke']);
    expect(res.problems).toEqual([]);
    const low = newProfile('p2', 'Recruit');
    expect(validateLoadout(low, src).loadout.killstreaks).not.toContain('nuke');
  });

  it('adds the earned / kills / called challenges', () => {
    expect(CHALLENGE_BY_ID.get('ks_nuke_earned')).toBeTruthy();
    expect(CHALLENGE_BY_ID.get('ks_nuke_kills')).toBeTruthy();
    expect(CHALLENGE_BY_ID.get('ks_nuke_called')).toMatchObject({ metric: 'streak_called', killstreak: 'nuke' });
    expect(NO_DEATHCAM_MEANS.has('nuke')).toBe(true);
  });
});

describe('earning the nuke', () => {
  it('25 kills in a row earn it; killstreak kills count toward it but not toward BO1 streaks', () => {
    const room = makeRoom();
    const a = bot(room, 0, [], ['uav', 'attack_dogs', 'nuke']);
    for (let i = 0; i < 20; i++) gunKill(room, a, bot(room, 1));
    for (let i = 0; i < 4; i++) room.kill(bot(room, 1), a, { weapon: 'attack_dogs', means: 'killstreak' });
    expect(readyKillstreaks(a)).not.toContain('nuke');
    expect(ksOf(a).count).toBe(20);
    expect(ksOf(a).countAll).toBe(24);
    room.kill(bot(room, 1), a, { weapon: 'napalm', means: 'killstreak' });
    expect(readyKillstreaks(a).filter((id) => id === 'nuke')).toEqual(['nuke']);
    expect(stateMsg(room, a).countAll).toBe(25);
    // Dying resets both counts.
    gunKill(room, bot(room, 1), a);
    expect(ksOf(a)).toMatchObject({ count: 0, countAll: 0 });
  });

  it('Hardline earns it at 24', () => {
    const room = makeRoom();
    const a = bot(room, 0, ['hardline'], ['nuke']);
    for (let i = 0; i < 23; i++) gunKill(room, a, bot(room, 1));
    expect(readyKillstreaks(a)).toEqual([]);
    gunKill(room, a, bot(room, 1));
    expect(readyKillstreaks(a)).toEqual(['nuke']);
  });

  it('is not earnable or callable in a wager match', () => {
    const room = makeRoom({ mode: 'oitc' });
    const a = bot(room, null as never, [], ['uav', 'nuke']);
    for (let i = 0; i < 30; i++) {
      const v = bot(room, null as never);
      gunKill(room, a, v);
      room.removePlayer(v.id);
    }
    expect(readyKillstreaks(a)).not.toContain('nuke');
    expect(stateMsg(room, a).chosen.map((c) => c.id)).toEqual(['uav']);
    give(a, 'nuke');
    expect(callKillstreak(room, a, 'nuke')).toEqual({ ok: false, reason: 'disabled' });
    expect(room.endLock).toBeNull();
  });
});

describe('countdown and detonation', () => {
  it('laptop, then a 10 s countdown; nobody dies before it goes off; the shockwave kills nearest first; the match ends at +5.5 s', () => {
    const room = makeRoom();
    const owner = bot(room, 0, [], ['nuke']);
    const mate = bot(room, 0);
    const foes = [bot(room, 1), bot(room, 1), bot(room, 1)];
    place(owner, 0, 0);
    place(mate, 4, 4);
    foes.forEach((f, i) => place(f, -10 + i * 10, -8));
    const log = deaths(room);
    const end = matchEnd(room);
    const t0 = room.time;
    const nuke = callNukeFor(room, owner);
    expect(room.endLock).toBe('nuke');
    const ent = room.entities.byKind(KS_ENTITY.nuke)[0]!;
    expect(ent.s).toMatchObject({ a: expect.closeTo(t0 + NUKE.laptopSec, 2), d: expect.closeTo(t0 + NUKE.laptopSec + 10, 2), o: owner.id });
    expect(ent.owner).toBeUndefined();
    // Blast point well off the map.
    const b = room.map.bounds;
    expect(ent.x < b.min.x || ent.x > b.max.x || ent.z < b.min.z || ent.z > b.max.z).toBe(true);
    // Everyone alive right up to detonation.
    steps(room, nuke.times.d - room.time - 0.05);
    expect(log).toEqual([]);
    expect([owner, mate, ...foes].every((p) => p.alive)).toBe(true);
    // Through the shockwave: everybody dies, credited to the owner, nearest to the blast first.
    steps(room, NUKE.shockDelaySec + NUKE.shockSpreadSec + 0.2);
    expect([owner, mate, ...foes].every((p) => !p.alive)).toBe(true);
    expect(log.map((d) => d.weapon)).toEqual(Array(5).fill('nuke'));
    expect(log.every((d) => d.attacker === owner.id && d.means === 'nuke')).toBe(true);
    expect(log[0]!.at).toBeGreaterThanOrEqual(nuke.times.d + NUKE.shockDelaySec - 0.02);
    const dist = (id: string) => {
      const p = room.players.get(id)!;
      return Math.hypot(p.move.x - nuke.blast.x, p.move.z - nuke.blast.z);
    };
    for (let i = 1; i < log.length; i++) expect(dist(log[i]!.victim)).toBeGreaterThanOrEqual(dist(log[i - 1]!.victim) - 1e-6);
    for (const d of log) expect(d.at).toBeGreaterThanOrEqual(shockAt(dist(d.victim), nuke.times) - 0.02);
    // Three enemy kills for the caller; the caller and the team mate die too, not as kills.
    expect(owner.stats.kills).toBe(3);
    // Nobody respawns during the aftermath; the match ends at d + 5.5 s with the reason 'nuke'.
    expect(end.results).toBeNull();
    steps(room, nukeEndAt(nuke.times) - room.time + 0.05);
    expect([owner, mate, ...foes].every((p) => !p.alive)).toBe(true);
    expect(room.phase).toBe('ended');
    expect(end.results!.reason).toBe('nuke');
    expect(end.at).toBeGreaterThanOrEqual(nukeEndAt(nuke.times) - 1e-6);
    expect(end.at).toBeLessThan(nukeEndAt(nuke.times) + 0.05);
  });

  it('slow motion: movement slows after detonation and sprint is off', () => {
    const room = makeRoom();
    const owner = bot(room, 0, [], ['nuke']);
    place(owner, 0, 0);
    const nuke = callNukeFor(room, owner);
    expect(room.modifiers.mul('speedMultiplier', owner)).toBe(1);
    steps(room, nuke.times.d - room.time + 1);
    expect(room.modifiers.mul('speedMultiplier', owner)).toBeCloseTo(NUKE.slowmoSpeed, 2);
    expect(room.modifiers.any('canSprint', owner)).toBe(false);
  });

  it('other killstreaks blow up at detonation', () => {
    const room = makeRoom();
    const owner = bot(room, 0, [], ['nuke']);
    const foe = bot(room, 1);
    give(foe, 'uav');
    expect(callKillstreak(room, foe, 'uav').ok).toBe(true);
    expect(room.entities.byKind(KS_ENTITY.uav).length).toBe(1);
    const nuke = callNukeFor(room, owner);
    steps(room, nuke.times.d - room.time + 0.1);
    expect(room.entities.byKind(KS_ENTITY.uav).length).toBe(0);
  });

  it('a second nuke cannot be called while one is inbound', () => {
    const room = makeRoom();
    const a = bot(room, 0);
    const b = bot(room, 1);
    callNukeFor(room, a);
    give(b, 'nuke');
    expect(callKillstreak(room, b, 'nuke')).toEqual({ ok: false, reason: 'nuke_active' });
    expect(readyKillstreaks(b)).toEqual(['nuke']);
  });
});

describe('winner and match end', () => {
  it('TDM: the caller’s team wins even when behind; scores freeze once it is called', () => {
    const room = makeRoom();
    const owner = bot(room, 0);
    const foes = [bot(room, 1), bot(room, 1)];
    room.addTeamScore(1, 40, 'kill');
    const end = matchEnd(room);
    const nuke = callNukeFor(room, owner);
    // Kills during the countdown count as kills but add no score (and can't reach the limit).
    gunKill(room, foes[0]!, owner);
    room.addTeamScore(1, 100, 'kill');
    expect(room.teamScores).toEqual([0, 40]);
    expect(room.phase).toBe('playing');
    steps(room, nukeEndAt(nuke.times) - room.time + 0.1);
    const res = end.results!;
    expect(res.reason).toBe('nuke');
    expect(res.winnerTeam).toBe(0);
    expect(res.winners).toEqual([owner.id]);
    expect(res.players.find((r) => r.id === owner.id)!.won).toBe(true);
    expect(res.players.filter((r) => r.team === 1).every((r) => !r.won)).toBe(true);
  });

  it('FFA: the caller wins and is placed first', () => {
    const room = makeRoom({ mode: 'ffa' });
    const owner = bot(room, null as never);
    const top = bot(room, null as never);
    const other = bot(room, null as never);
    top.stats.score = 900;
    other.stats.score = 300;
    const end = matchEnd(room);
    const nuke = callNukeFor(room, owner);
    steps(room, nukeEndAt(nuke.times) - room.time + 0.1);
    const res = end.results!;
    expect(res.winners).toEqual([owner.id]);
    expect(res.winnerTeam).toBeNull();
    expect(res.players.map((r) => [r.id, r.place, r.won])).toEqual([
      [owner.id, 1, true],
      [top.id, 2, false],
      [other.id, 3, false],
    ]);
  });

  it('S&D: the match ends on the nuke (not the round)', () => {
    const room = makeRoom({ mode: 'sd' });
    const owner = bot(room, 0);
    bot(room, 1);
    bot(room, 1);
    const end = matchEnd(room);
    const nuke = callNukeFor(room, owner);
    steps(room, nukeEndAt(nuke.times) - room.time + 0.1);
    expect(end.results!.reason).toBe('nuke');
    expect(end.results!.winnerTeam).toBe(0);
    expect(room.phase).toBe('ended');
  });

  it('still goes off when the caller dies during the countdown', () => {
    const room = makeRoom();
    const owner = bot(room, 0);
    const foe = bot(room, 1);
    const end = matchEnd(room);
    const nuke = callNukeFor(room, owner);
    steps(room, 3);
    gunKill(room, foe, owner);
    expect(owner.alive).toBe(false);
    steps(room, nukeEndAt(nuke.times) - room.time + 0.1);
    expect(foe.alive).toBe(false);
    expect(end.results!.reason).toBe('nuke');
    expect(end.results!.winnerTeam).toBe(0);
  });

  it('still goes off when the caller leaves the room', () => {
    const room = makeRoom();
    const owner = bot(room, 0);
    const mate = bot(room, 0);
    const foe = bot(room, 1);
    const log = deaths(room);
    const end = matchEnd(room);
    const nuke = callNukeFor(room, owner);
    room.removePlayer(owner.id, 'left');
    expect(room.entities.byKind(KS_ENTITY.nuke).length).toBe(1);
    steps(room, nukeEndAt(nuke.times) - room.time + 0.1);
    expect(log.map((d) => d.attacker)).toEqual([owner.id, owner.id]);
    expect(end.results!.winnerTeam).toBe(0);
    expect(end.results!.winners).toEqual([mate.id]);
    void foe;
  });

  it('nukeResults keeps the mode’s own results apart from the winner', () => {
    const room = makeRoom();
    const owner = bot(room, 1);
    const res = nukeResults(room, owner);
    expect(res.reason).toBe('nuke');
    expect(res.winnerTeam).toBe(1);
  });
});

describe('bots', () => {
  it('a bot that earns the nuke calls it through the bot streak API', () => {
    const room = makeRoom();
    const a = bot(room, 0, [], ['uav', 'attack_dogs', 'nuke']);
    ksOf(a).manual = false;
    ksOf(a).botStreakUse = 1;
    for (let i = 0; i < 25; i++) gunKill(room, a, bot(room, 1));
    expect(readyKillstreaks(a)).toContain('nuke');
    const took = until(room, () => !!nukeOf(ksRoom(room)), 10);
    expect(took).toBeLessThan(10);
    expect(nukeOf(ksRoom(room))!.owner).toBe(a);
    void botAutoStreaks;
  });
});

describe('through the normal match-end flow', () => {
  it('XP line and challenge for calling it, no killcams, the modes summary and CoD Points', () => {
    const room = makeRoom({}, [perks, killstreaks, progression, economy, modes]);
    const owner = withProfile(bot(room, 0));
    const foe = withProfile(bot(room, 1));
    const sent: string[] = [];
    // A fake session on each so feature pushes are visible.
    for (const p of [owner, foe]) {
      (p as { session: unknown }).session = { id: p.id, open: true, congested: false, send: () => {}, sendFeature: (id: string) => sent.push(id), profile: p.profile, room, player: p };
    }
    const end = matchEnd(room);
    // A kill shortly before the end would normally make a final killcam.
    gunKill(room, owner, bot(room, 1));
    const nuke = callNukeFor(room, owner);
    steps(room, nukeEndAt(nuke.times) - room.time + 0.1);
    const res = end.results!;
    expect(res.reason).toBe('nuke');
    const xp = matchSummaryFor(res, owner.id)!;
    expect(xp.lines.some((l) => l.label === 'TACTICAL NUKE' && l.xp === NUKE.xp)).toBe(true);
    expect(owner.profile!.challengeProgress['ks_nuke_called']).toBe(1);
    expect(res.ext.modes).toBeTruthy();
    expect(res.ext.economy).toBeTruthy();
    expect(sent).not.toContain('modes.killcam');
    expect(sent).not.toContain('modes.deathcam');
    expect(res.players.find((r) => r.id === owner.id)!.won).toBe(true);
    void foe;
  });
});
