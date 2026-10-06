import { afterEach, describe, expect, it } from 'vitest';
import type { Feature } from '../src/server/feature';
import { Lobby } from '../src/server/lobby';
import type { PlayerState } from '../src/server/player';
import type { Room, RoomOptions } from '../src/server/room';
import { Session } from '../src/server/session';
import { Store } from '../src/server/store';
import { PLAYER, TICK_DT } from '../src/shared/constants';
import { createMoveState } from '../src/shared/movement';
import { viewDir } from '../src/shared/math';
import { Buttons } from '../src/shared/input';

let store: Store | undefined;
let lobby: Lobby | undefined;

function setup(opts: Partial<RoomOptions> = {}, features: Feature[] = []): Room {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features, log: () => {}, autoTick: false });
  return lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, ...opts });
}

afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = undefined;
  store = undefined;
});

const place = (p: PlayerState, x: number, z: number) => {
  p.move = { ...createMoveState(x, 0, z), onGround: true };
};
const steps = (room: Room, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) room.step();
};
/** Aim from a's eye at b's chest. */
const aim = (a: PlayerState, b: PlayerState, y = 1.2) => {
  const d = { x: b.move.x - a.move.x, y: b.move.y + y - (a.move.y + PLAYER.eye), z: b.move.z - a.move.z };
  const l = Math.hypot(d.x, d.y, d.z);
  return { x: d.x / l, y: d.y / l, z: d.z / l };
};

/** Two bots on opposite teams, 8 m apart in the open, shooter ADS'd. */
function duel(room: Room) {
  const a = room.addBot({ name: 'A', team: 0 });
  const b = room.addBot({ name: 'B', team: 1 });
  steps(room, 0.5);
  place(a, -1, 8);
  place(b, -1, 0);
  // The shooter holds ADS (tight spread).
  a.brain = { think: () => ({ buttons: Buttons.ADS, yaw: 0, pitch: 0, weaponSlot: 0 }) };
  steps(room, 0.5);
  return { a, b };
}

function shootUntilDead(room: Room, a: PlayerState, b: PlayerState, max = 20) {
  let shots = 0;
  while (b.alive && shots < max) {
    a.move.ads = 1;
    room.fire(a, { dir: aim(a, b) });
    shots++;
    steps(room, 0.12);
  }
  return shots;
}

describe('room', () => {
  it('starts playing with spawned players on balanced teams', () => {
    const room = setup();
    const ps = [room.addBot(), room.addBot(), room.addBot(), room.addBot()];
    expect(room.phase).toBe('playing');
    expect(ps.filter((p) => p.team === 0).length).toBe(2);
    expect(ps.every((p) => p.alive)).toBe(true);
  });

  it('kills in 3 body shots with the AK, credits the kill and team score, respawns', () => {
    const room = setup();
    const { a, b } = duel(room);
    const deaths: string[] = [];
    room.bus.on('death', (e) => deaths.push(`${e.attacker?.name}>${e.victim.name}:${e.weapon}`));
    const shots = shootUntilDead(room, a, b);
    expect(shots).toBe(3);
    expect(deaths).toEqual(['A>B:ak47']);
    expect(a.stats.kills).toBe(1);
    expect(b.stats.deaths).toBe(1);
    expect(room.teamScores).toEqual([1, 0]);
    expect(a.stats.score).toBe(100);
    expect(b.respawnAt).not.toBeNull();
    steps(room, 3.1);
    expect(b.alive).toBe(true);
    expect(b.health).toBe(100);
  });

  it('consults damage modifiers and beforeDamage', () => {
    const room = setup();
    const { a, b } = duel(room);
    room.modifiers.add('damageTaken', (v) => (v === b ? 0.5 : 1), 'test.half');
    expect(shootUntilDead(room, a, b)).toBe(5);
    const r2 = setup();
    const d2 = duel(r2);
    r2.bus.on('beforeDamage', (e) => {
      e.cancel = true;
    });
    r2.fire(d2.a, { dir: aim(d2.a, d2.b) });
    expect(d2.b.health).toBe(100);
  });

  it('speed modifier changes movement params', () => {
    const room = setup();
    const { a } = duel(room);
    room.modifiers.add('speedMultiplier', () => 1.1, 'test.fast');
    a.brain = { think: () => ({ buttons: 1, yaw: 0, pitch: 0, weaponSlot: 0 }) };
    a.move.ads = 0;
    steps(room, 1);
    expect(Math.hypot(a.move.vx, a.move.vz)).toBeCloseTo(5 * 0.95 * 1.1, 3);
  });

  it('regenerates health after 5 s without damage', () => {
    const room = setup();
    const { a, b } = duel(room);
    room.fire(a, { dir: aim(a, b) });
    expect(b.health).toBe(60);
    steps(room, 4.5);
    expect(b.health).toBe(60);
    steps(room, 1.6);
    expect(b.health).toBe(100);
  });

  it('lag compensation: a shot at where the target was 100 ms ago hits; beyond 250 ms it misses', () => {
    const room = setup();
    const { a, b } = duel(room);
    // Target strafes +x at 5 m/s via its brain.
    b.brain = { think: () => ({ buttons: 8, yaw: 0, pitch: 0, weaponSlot: 0 }) };
    steps(room, 0.5);
    const viewTime = room.time - 0.1;
    const past = room.history.poseAt(b.id, viewTime)!;
    expect(b.move.x - past.x).toBeGreaterThan(0.4);
    const dir = aim(a, { ...b, move: { ...b.move, x: past.x, y: past.y, z: past.z } } as PlayerState);
    room.fire(a, { dir, time: viewTime });
    expect(b.health).toBe(60);
    // Aiming where it was 600 ms ago: clamped to 250 ms, so it misses.
    a.move.ads = 1;
    steps(room, 0.12);
    const old = room.history.poseAt(b.id, room.time - 0.6)!;
    const hp = b.health;
    room.fire(a, { dir: aim(a, { ...b, move: { ...b.move, x: old.x, y: old.y, z: old.z } } as PlayerState), time: room.time - 0.6 });
    expect(b.health).toBe(hp);
  });

  it('walls stop bullets', () => {
    const room = setup();
    const { a, b } = duel(room);
    place(a, 3, 16); // container at (3, 12) between them
    place(b, 3, 8);
    steps(room, 0.5);
    a.move.ads = 1;
    room.fire(a, { dir: aim(a, b) });
    expect(b.health).toBe(100);
  });

  it('rejects firing faster than the weapon rate and while sprinting', () => {
    const room = setup();
    const { a, b } = duel(room);
    expect(room.fire(a, { dir: aim(a, b) }).ok).toBe(true);
    expect(room.fire(a, { dir: aim(a, b) }).ok).toBe(false);
    steps(room, 0.5);
    a.move.sprinting = true;
    expect(room.fire(a, { dir: aim(a, b) })).toEqual({ ok: false, reason: 'sprinting' });
  });

  it('reloads after emptying the magazine', () => {
    const room = setup();
    const { a } = duel(room);
    const w = a.weapons[0]!;
    w.mag = 1;
    room.fire(a, { dir: viewDir(0, 0.3) });
    expect(w.mag).toBe(0);
    expect(a.reloadEnd).toBeGreaterThan(room.time);
    steps(room, 3.4);
    expect(w.mag).toBe(30);
    expect(w.reserve).toBe(90);
  });

  it('ends at the score limit with results, saves profiles via matchEnd', () => {
    const room = setup({ onEnd: 'close' });
    const { a, b } = duel(room);
    let results = null as null | { winnerTeam: number | null };
    room.bus.on('matchEnd', (e) => (results = e.results));
    room.teamScores = [74, 0];
    shootUntilDead(room, a, b);
    expect(room.phase).toBe('ended');
    expect(results!.winnerTeam).toBe(0);
    expect(room.results!.reason).toBe('score');
    expect(room.results!.players.find((p) => p.id === a.id)!.won).toBe(true);
  });

  it('ends on the time limit; FFA ranks by score', () => {
    const room = setup({ mode: 'ffa', onEnd: 'lobby' });
    const a = room.addBot();
    const b = room.addBot();
    expect(a.team).toBeNull();
    a.stats.score = 300;
    b.stats.score = 100;
    steps(room, 600.1);
    expect(room.phase).toBe('ended');
    expect(room.results!.reason).toBe('time');
    expect(room.results!.winners).toEqual([a.id]);
    steps(room, 10.1);
    expect(room.phase).toBe('lobby');
  });

  it('rotates to a new match after the results', () => {
    const room = setup({ postMatchSec: 1 });
    room.addBot();
    room.endMatch('forfeit');
    steps(room, 1.1);
    expect(room.phase).toBe('playing');
    expect(room.teamScores).toEqual([0, 0]);
  });

  it('setMode swaps rules without leaving the old handlers behind', () => {
    const room = setup({ autoStart: false });
    expect(room.phase).toBe('lobby');
    room.setMode('ffa');
    room.setMode('tdm');
    room.startMatch();
    const { a, b } = duel(room);
    shootUntilDead(room, a, b);
    expect(room.teamScores).toEqual([1, 0]);
    expect(a.stats.score).toBe(100);
  });

  it('runs feature hooks and bot fill', () => {
    const seen: string[] = [];
    const feature: Feature = { id: 'probe', room: (r) => r.bus.on('playerJoin', (e) => seen.push(e.player.name)) };
    const room = setup({ botFill: 4 }, [feature]);
    room.fillBots();
    expect(room.players.size).toBe(4);
    expect(seen.length).toBe(4);
  });

  it('lobby: quick play joins an existing open room, sessions get profiles saved on leave', () => {
    setup();
    const st = store!;
    const lb = lobby!;
    const { profile, token } = st.authenticate(null, 'Alice');
    const s = new Session('s1', null, profile, token);
    const r1 = lb.quickPlay(s, { mode: 'ffa' });
    const other = new Session('s2', null, st.authenticate(null, 'Bob').profile, 'x');
    const r2 = lb.quickPlay(other, { mode: 'ffa' });
    expect(r2).toBe(r1);
    expect(r1.humans().length).toBe(2);
    s.profile.codPoints = 4242;
    lb.leave(s);
    expect(st.load(profile.id)!.codPoints).toBe(4242);
  });
});

describe('store', () => {
  it('creates guests, finds them by token and round-trips JSON fields', () => {
    const st = new Store(':memory:');
    const { profile, token, created } = st.authenticate(undefined, 'Zed');
    expect(created).toBe(true);
    profile.xp = 1234;
    profile.challengeProgress.tdm_kills = 7;
    profile.stats.kills = 3;
    profile.owned.push('camo_tiger');
    profile.ext.progression = { seen: [1, 2] };
    st.save(profile);
    const again = st.authenticate(token);
    expect(again.created).toBe(false);
    expect(again.profile).toMatchObject({ id: profile.id, name: 'Zed', xp: 1234, challengeProgress: { tdm_kills: 7 }, stats: { kills: 3 }, ext: { progression: { seen: [1, 2] } } });
    expect(again.profile.owned).toContain('camo_tiger');
    expect(st.authenticate('unknown-token-unknown-token').created).toBe(true);
    st.close();
  });
});
