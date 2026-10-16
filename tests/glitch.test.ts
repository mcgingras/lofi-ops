/**
 * Glitch killstreak, rules level: it lasts 20 s; the glitched side's bots play with a degraded
 * skill (effective skill, the duel harness) and stutter, then recover; their hardware is knocked
 * out (sentry stunned, helicopter holds fire, RC-XD stalls) and they can't call streaks; their
 * radar is blacked out and jammed (a Spy Plane stops helping them); the `killstreaks.glitch`
 * state push turns the client effect on and off.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { effectiveSkill, botFrozen } from '../src/server/features/bots/impair';
import { botBrain, configureRoomBots } from '../src/server/features/bots/api';
import { FEATURES } from '../src/server/features/index';
import { Lobby } from '../src/server/lobby';
import { Store } from '../src/server/store';
import { callKillstreak } from '../src/server/features/killstreaks/api';
import { isGlitched } from '../src/server/features/killstreaks/streaks/glitch';
import { ksRoom } from '../src/server/features/killstreaks/world';
import { BOT_SKILL_RANGES, DEFAULT_LOBBY_BOTS, skillFor } from '../src/shared/defs/bots';
import { GLITCH, glitchHits, glitchSkill, glitchStrength } from '../src/shared/defs/glitch';
import { KILLSTREAK_BY_ID, KS_ENTITY } from '../src/shared/defs/killstreaks';
import { Buttons } from '../src/shared/input';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { duel } from './bots-sim';
import { bot, give, input, place, rig, steps, until, type Rig } from './perks-streaks.helpers';

let r: Rig | undefined;
afterEach(() => {
  r?.close();
  r = undefined;
});
const setup = () => (r = rig()).room;

/** Every `killstreaks.glitch` push the room sends to everyone. */
function glitchPushes(room: Room) {
  const out: { active: { owner: string; team: number | null; until: number }[] }[] = [];
  const orig = room.sendFeature.bind(room);
  room.sendFeature = ((to: PlayerState | null, id: string, data: unknown) => {
    if (id === 'killstreaks.glitch' && to === null) out.push(data as (typeof out)[number]);
    return orig(to as PlayerState, id as never, data as never);
  }) as typeof room.sendFeature;
  return out;
}

const call = (room: Room, p: PlayerState) => {
  give(p, 'glitch');
  return callKillstreak(room, p, 'glitch');
};

describe('Glitch def', () => {
  it('costs 10 kills, lasts 20 s, is an original non-targeted streak', () => {
    const def = KILLSTREAK_BY_ID.get('glitch')!;
    expect(def).toMatchObject({ kills: 10, durationSec: GLITCH.durationSec, targeting: 'none' });
    expect(GLITCH.durationSec).toBe(20);
    expect(def.unlockLevel).toBeGreaterThan(KILLSTREAK_BY_ID.get('chopper_gunner')!.unlockLevel);
    expect(def.unlockLevel).toBeLessThan(KILLSTREAK_BY_ID.get('attack_dogs')!.unlockLevel);
  });

  it('who it hits: the owner’s enemies (FFA: everyone else); the screen ramps in and out', () => {
    expect(glitchHits({ owner: 'a', team: 0 }, 'b', 1)).toBe(true);
    expect(glitchHits({ owner: 'a', team: 0 }, 'c', 0)).toBe(false);
    expect(glitchHits({ owner: 'a', team: 0 }, 'a', 0)).toBe(false);
    expect(glitchHits({ owner: 'a', team: null }, 'b', null)).toBe(true);
    expect(glitchStrength(100, 120)).toBe(0); // just started
    expect(glitchStrength(101, 120)).toBe(1);
    expect(glitchStrength(119.4, 120)).toBeCloseTo(0.5);
    expect(glitchStrength(120, 120)).toBe(0);
  });
});

describe('Glitch: duration and state push', () => {
  it('lasts 20 s, pushes the running list on and off, glitches only the enemy side', () => {
    const room = setup();
    const a = bot(room, 0);
    const mate = bot(room, 0);
    const e = bot(room, 1);
    const pushes = glitchPushes(room);
    const t0 = room.time;
    expect(call(room, a).ok).toBe(true);
    const ctx = ksRoom(room);
    expect(isGlitched(ctx, e)).toBe(true);
    expect(isGlitched(ctx, mate)).toBe(false);
    expect(isGlitched(ctx, a)).toBe(false);
    expect(pushes.at(-1)!.active).toEqual([{ owner: a.id, team: 0, until: t0 + 20 }]);
    steps(room, 19.5);
    expect(isGlitched(ctx, e)).toBe(true);
    steps(room, 0.6);
    expect(isGlitched(ctx, e)).toBe(false);
    expect(pushes.at(-1)!.active).toEqual([]);
    expect(pushes).toHaveLength(2);
  });
});

describe('Glitch vs bots', () => {
  it('degrades the glitched bots’ skill (reaction, aim error, turn, view, hearing) and restores it after', () => {
    const room = setup();
    const a = bot(room, 0);
    const e = bot(room, 1);
    const mate = bot(room, 0);
    const base = skillFor(DEFAULT_LOBBY_BOTS);
    expect(effectiveSkill(room, e, base)).toBe(base);
    call(room, a);
    const g = effectiveSkill(room, e, base);
    expect(g).toEqual(glitchSkill(base, BOT_SKILL_RANGES));
    expect(g.reactionMs).toBeGreaterThan(base.reactionMs * 2);
    expect(g.aimErrorDeg).toBeGreaterThan(base.aimErrorDeg * 2);
    expect(g.turnSpeedDeg).toBeLessThan(base.turnSpeedDeg * 0.6);
    expect(g.fovDeg).toBeLessThan(base.fovDeg);
    expect(g.hearingRange).toBeLessThan(base.hearingRange * 0.5);
    for (const [k, [lo, hi]] of Object.entries(BOT_SKILL_RANGES)) {
      expect(g[k as keyof typeof g], k).toBeGreaterThanOrEqual(lo);
      expect(g[k as keyof typeof g], k).toBeLessThanOrEqual(hi);
    }
    expect(effectiveSkill(room, mate, base)).toBe(base); // the caller's side is untouched
    steps(room, GLITCH.durationSec + 0.1);
    expect(effectiveSkill(room, e, base)).toBe(base);
  });

  it('glitched bots stutter: frozen now and then, standing still with no fire', () => {
    // With the bots feature, so the bot has a real brain.
    const store = new Store(':memory:');
    const lobby = new Lobby({ store, features: FEATURES, log: () => {}, autoTick: false });
    r = { room: null as never, lobby, store, close: () => (lobby.shutdown(), store.close()) };
    const room = lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, private: true });
    configureRoomBots(room, { fill: false }, { waitSec: 0 });
    const a = bot(room, 0);
    const e = room.addBot({ team: 1 });
    if (!e.alive) room.spawn(e);
    expect(botBrain(room, e)).toBeDefined();
    call(room, a);
    let frozenTicks = 0;
    let frozenWithInput = 0;
    let ticks = 0;
    for (let i = 0; i < 60 * 15; i++) {
      room.step();
      ticks++;
      if (botFrozen(room, e)) {
        frozenTicks++;
        const out = e.brain!.think(room, e, 1 / 60);
        if (out && out.buttons !== 0) frozenWithInput++;
      }
    }
    const share = frozenTicks / ticks;
    expect(share).toBeGreaterThan(0.08);
    expect(share).toBeLessThan(0.4);
    expect(frozenWithInput).toBe(0);
    steps(room, 6);
    expect(botFrozen(room, e)).toBe(false);
  });

  it('duel harness: a glitched bot notices later, hits less and kills less, at every difficulty', () => {
    const keepGlitched = (room: Room, shooter: PlayerState, target: PlayerState) => {
      room.bus.on('tick', () => {
        if (!target.alive || isGlitched(ksRoom(room), shooter)) return;
        give(target, 'glitch');
        callKillstreak(room, target, 'glitch');
      });
    };
    for (const difficulty of ['regular', 'veteran'] as const) {
      const opts = { difficulty, distance: 25, strafe: false, trials: 14, seed: 11 };
      const clean = duel(opts);
      const glitched = duel({ ...opts, setup: keepGlitched });
      expect(glitched.firstShot, difficulty).toBeGreaterThan(clean.firstShot + 0.25);
      expect(glitched.hitAll, difficulty).toBeLessThan(clean.hitAll * 0.75);
      expect(glitched.killRate, difficulty).toBeLessThanOrEqual(clean.killRate);
    }
  });

  it('bots on the glitched side lose their radar knowledge', () => {
    const room = setup();
    const a = bot(room, 0);
    const e = bot(room, 1, [], ['uav']);
    give(e, 'uav');
    expect(callKillstreak(room, e, 'uav').ok).toBe(true);
    expect(room.radarFor(e)).toContain(a.id);
    call(room, a);
    expect(room.radarFor(e)).toEqual([]);
    expect(room.modifiers.any('radarJammed', e)).toBe(true);
    expect(room.modifiers.any('radarJammed', a)).toBeUndefined();
  });
});

describe('Glitch vs hardware and streaks', () => {
  it('stuns the glitched side’s sentry (no fire, s.st) for the duration, then it works again', () => {
    const room = setup();
    const owner = bot(room, 1);
    place(owner, -1, 10);
    owner.yaw = 0;
    const v = bot(room, 0);
    place(v, -1, -2);
    v.health = v.maxHealth = 1e6;
    give(owner, 'sentry_gun');
    expect(callKillstreak(room, owner, 'sentry_gun').ok).toBe(true);
    const caller = bot(room, 0);
    place(caller, 15, 15);
    call(room, caller);
    const sentry = room.entities.byKind(KS_ENTITY.sentry)[0]!;
    steps(room, 5);
    expect(sentry.s?.st).toBe(1);
    expect(v.health).toBe(1e6);
    steps(room, GLITCH.durationSec);
    expect(sentry.s?.st).toBe(0);
    expect(until(room, () => v.health < 1e6, 4)).toBeLessThan(4);
  });

  it('the glitched side’s helicopter holds fire; their RC-XD stalls; they can’t call streaks', () => {
    const room = setup();
    const owner = bot(room, 1);
    place(owner, 20, 20);
    const caller = bot(room, 0);
    place(caller, -1, 0);
    caller.health = caller.maxHealth = 1e6;
    call(room, caller);
    give(owner, 'attack_helicopter');
    expect(callKillstreak(room, owner, 'attack_helicopter')).toEqual({ ok: false, reason: 'glitched' });
    // Already up before the glitch: it keeps flying but holds fire.
    steps(room, GLITCH.durationSec + 0.1);
    expect(callKillstreak(room, owner, 'attack_helicopter').ok).toBe(true);
    const heli = room.entities.byKind(KS_ENTITY.heli)[0]!;
    let hits = 0;
    room.bus.on('damage', (d) => {
      if (d.victim === caller && d.weapon === 'attack_helicopter') hits++;
    });
    expect(until(room, () => hits > 0, 20)).toBeLessThan(20); // it does shoot when not glitched
    give(caller, 'glitch');
    expect(callKillstreak(room, caller, 'glitch').ok).toBe(true);
    steps(room, 0.2);
    hits = 0;
    steps(room, 8);
    expect(hits).toBe(0);
    expect(heli.s?.st).toBe(1);
    expect(room.entities.get(heli.id)).toBeDefined();
  });

  it('an RC-XD driven by a glitched player stalls and won’t detonate', () => {
    const room = setup();
    const driver = bot(room, 1);
    driver.isBot = false;
    driver.brain = null;
    place(driver, 0, 10);
    give(driver, 'rcxd');
    expect(callKillstreak(room, driver, 'rcxd').ok).toBe(true);
    const car = room.entities.byKind(KS_ENTITY.rcxd)[0]!;
    const caller = bot(room, 0);
    place(caller, 20, 20);
    call(room, caller);
    const start = { x: car.x, z: car.z };
    for (let i = 0; i < 60; i++) {
      input(room, driver, Buttons.FORWARD, driver.yaw);
      room.step();
    }
    expect(Math.hypot(car.x - start.x, car.z - start.z)).toBeLessThan(0.05);
    input(room, driver, Buttons.FIRE);
    room.step();
    input(room, driver, 0);
    room.step();
    expect(room.entities.get(car.id)).toBeDefined();
  });
});
