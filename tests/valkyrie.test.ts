/**
 * Valkyrie Rockets (BO1 `m220_tow_mp`): the drop whose crate holds the launcher, the launcher (two
 * rockets, raise, reload, put away), the guided rocket (turn rate, boost, fuel, out of bounds,
 * impact, FIRE to detonate, shot down), owner death and disconnect, kill credit, and bots.
 * Rules-level, on a Yard room stepped tick by tick. The shared flight maths and the client's
 * rocket-cam maths are tested as pure functions at the end.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { botAutoStreaks, callKillstreak, readyKillstreaks } from '../src/server/features/killstreaks/api';
import { onStreakPressed } from '../src/server/features/killstreaks/index';
import { perksOf } from '../src/server/features/perks/common';
import { ksOf, stateMsg } from '../src/server/features/killstreaks/state';
import { cratesOf, PACKAGE } from '../src/server/features/killstreaks/streaks/package';
import { rocketTrack } from '../src/server/features/killstreaks/streaks/valkyrie';
import { ksRoom } from '../src/server/features/killstreaks/world';
import { KILLSTREAK_BY_ID, KS_ENTITY } from '../src/shared/defs/killstreaks';
import { bankRoll, clampLead, dirAngles, rocketLaunch, rocketOutOfBounds, signalWhite, steerToward, stepRocket, turnRateAt, VALKYRIE, VALKYRIE_LAUNCHER, wrapAngle } from '../src/shared/defs/valkyrie';
import { TICK_DT } from '../src/shared/constants';
import { Buttons } from '../src/shared/input';
import { viewDir, type Vec3 } from '../src/shared/math';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { followRocket, holdView, launcherPhase, predictAhead, predictRocket, rocketButtons, rocketHudInfo, rocketStateOf } from '../src/client/features/killstreaks/rocketcam-logic';
import { bot, give, input, place, rig, steps, until, type Rig } from './perks-streaks.helpers';

let r: Rig | undefined;
afterEach(() => {
  r?.close();
  r = undefined;
});
const setup = () => (r = rig()).room;

/** A player driven by input commands (as over the network), standing at x,z. */
function human(room: Room, team: 0 | 1, x: number, z: number, perks: string[] = []): PlayerState {
  const p = bot(room, team, perks);
  p.isBot = false;
  p.brain = null;
  place(p, x, z);
  return p;
}

const deathsOf = (room: Room) => {
  const out: { victim: PlayerState; attacker: PlayerState | null; weapon: string; means: string }[] = [];
  room.bus.on('death', (e) => out.push({ victim: e.victim, attacker: e.attacker, weapon: e.weapon, means: e.means }));
  return out;
};

/** Every feature message the room sends (to anyone). */
function feats(room: Room) {
  const out: { to: PlayerState | null; id: string; data: unknown }[] = [];
  const orig = room.sendFeature.bind(room);
  room.sendFeature = ((to: PlayerState | null, id: string, data: unknown) => {
    out.push({ to, id, data });
    return orig(to as PlayerState, id as never, data as never);
  }) as typeof room.sendFeature;
  return out;
}

const rocketEnt = (room: Room) => room.entities.byKind(KS_ENTITY.rocket)[0];
const angle = (a: Vec3, b: Vec3) => Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)));
const entDir = (e: { yaw: number; s?: Record<string, unknown> }) => viewDir(e.yaw, typeof e.s?.p === 'number' ? e.s.p : 0);

/** Hand `p` the launcher (as from the crate), raise it, and wait until it can fire. */
function raised(room: Room, p: PlayerState) {
  give(p, VALKYRIE_LAUNCHER);
  ksOf(p).selected = ksOf(p).ready.length - 1;
  onStreakPressed(room, p);
  expect(ksOf(p).launcher).toMatchObject({ left: 2, fired: false });
  steps(room, VALKYRIE.raiseSec + 0.05);
}

/** One FIRE press (and release) through the input stream, aiming yaw/pitch. */
function pressFire(room: Room, p: PlayerState, yaw = p.yaw, pitch = p.pitch, extra = 0) {
  input(room, p, Buttons.FIRE | extra, yaw, pitch);
  room.step();
  input(room, p, extra, yaw, pitch);
  room.step();
}

describe('Valkyrie Rockets: the drop', () => {
  it('is a 7-kill supply drop (BO1 m220_tow_drop_mp) announced as a Care Package; its crate holds the launcher', () => {
    expect(KILLSTREAK_BY_ID.get('valkyrie')).toMatchObject({ kills: 7, targeting: 'marker' });
    const room = setup();
    const a = human(room, 0, -1, 12);
    const sent = feats(room);
    give(a, 'valkyrie');
    expect(callKillstreak(room, a, 'valkyrie', { target: { x: -1, y: 0, z: 2 } }).ok).toBe(true);
    expect(readyKillstreaks(a)).toEqual([]);
    expect(sent.find((m) => m.id === 'killstreaks.called')?.data).toMatchObject({ id: 'care_package', owner: a.id });
    expect(until(room, () => cratesOf(ksRoom(room)).some((c) => c.landed), 15)).toBeLessThan(15);
    const crate = cratesOf(ksRoom(room))[0]!;
    expect(crate).toMatchObject({ contents: 'valkyrie', fixed: true });
    place(a, crate.ent.x + 0.5, crate.ent.z);
    expect(until(room, () => (input(room, a, Buttons.USE), readyKillstreaks(a).includes(VALKYRIE_LAUNCHER)), 2)).toBeLessThan(PACKAGE.owner + 0.2);
  });

  it('Hardline Pro cannot reroll the launcher crate; a Care Package that rolled the Valkyrie holds the launcher too', () => {
    const room = setup();
    const a = human(room, 0, -1, 10, ['hardline']);
    perksOf(a).allPro = true;
    give(a, 'valkyrie');
    callKillstreak(room, a, 'valkyrie', { target: { x: -1, y: 0, z: 0 } });
    until(room, () => cratesOf(ksRoom(room)).some((c) => c.landed), 15);
    const crate = cratesOf(ksRoom(room))[0]!;
    place(a, crate.ent.x + 0.5, crate.ent.z);
    input(room, a, Buttons.USE);
    room.step();
    expect(crate.contents).toBe('valkyrie');
    // A random Care Package that holds the Valkyrie: the same launcher (BO1's supplydrop_mp rolls m220_tow_mp).
    crate.fixed = false;
    crate.rerolled = true;
    for (let i = 0; i < 60 && !readyKillstreaks(a).includes(VALKYRIE_LAUNCHER); i++) {
      input(room, a, Buttons.USE);
      room.step();
    }
    expect(readyKillstreaks(a)).toContain(VALKYRIE_LAUNCHER);
  });
});

describe('Valkyrie Rockets: the launcher', () => {
  it('STREAK raises it with two rockets (weapon down, no sprint); FIRE before it is up does nothing; the state goes to the client', () => {
    const room = setup();
    const a = human(room, 0, -1, 14);
    give(a, VALKYRIE_LAUNCHER);
    onStreakPressed(room, a);
    expect(ksOf(a).launcher).toMatchObject({ left: 2, fired: false });
    expect(stateMsg(room, a).launcher).toMatchObject({ left: 2, fired: false });
    expect(room.modifiers.any('canSprint', a)).toBe(false);
    pressFire(room, a, 0, 0.2);
    expect(rocketEnt(room)).toBeUndefined();
    steps(room, 0.2);
    expect(a.swapEnd).toBeGreaterThan(room.time); // the gun is down
    expect(room.entities.byKind(KS_ENTITY.launcher)).toHaveLength(1); // others see it on the shoulder
  });

  it('putting it away before the first shot keeps the streak (STREAK, a weapon switch or a grenade)', () => {
    const room = setup();
    const a = human(room, 0, -1, 14);
    raised(room, a);
    onStreakPressed(room, a);
    expect(ksOf(a).launcher).toBeNull();
    expect(readyKillstreaks(a)).toEqual([VALKYRIE_LAUNCHER]);
    steps(room, 0.1);
    expect(room.entities.byKind(KS_ENTITY.launcher)).toHaveLength(0);
    onStreakPressed(room, a);
    expect(ksOf(a).launcher).not.toBeNull();
    input(room, a, 0, a.yaw, a.pitch, 1); // weapon switch
    room.step();
    expect(ksOf(a).launcher).toBeNull();
    expect(readyKillstreaks(a)).toEqual([VALKYRIE_LAUNCHER]);
    onStreakPressed(room, a);
    input(room, a, Buttons.LETHAL, a.yaw, a.pitch, 1);
    room.step();
    expect(ksOf(a).launcher).toBeNull();
    expect(readyKillstreaks(a)).toEqual([VALKYRIE_LAUNCHER]);
  });

  it('FIRE launches from the eye along the aim: the streak is used, everyone hears it is inbound, the view rides the rocket', () => {
    const room = setup();
    const a = human(room, 0, -1, 14);
    const sent = feats(room);
    raised(room, a);
    pressFire(room, a, 0, 0.2);
    const e = rocketEnt(room)!;
    expect(e).toBeDefined();
    expect(e.owner).toBe(a.id);
    expect(angle(entDir(e), viewDir(0, 0.2))).toBeLessThan(0.05);
    expect(Math.hypot(e.x - a.move.x, e.z - a.move.z)).toBeLessThan(2);
    expect(readyKillstreaks(a)).toEqual([]);
    expect(ksOf(a).launcher).toMatchObject({ left: 1, fired: true });
    expect(ksOf(a).control).toMatchObject({ id: 'valkyrie', entity: e.id });
    expect(sent.filter((m) => m.id === 'killstreaks.called').map((m) => m.data)).toEqual([{ id: 'valkyrie', owner: a.id, team: a.team }]);
    // The body stands still while steering.
    expect(room.modifiers.mul('speedMultiplier', a)).toBe(0);
  });

  it('after the first rocket: 1 s on the blast, back in the body, a 3 s reload, then the second; after it the launcher is gone', () => {
    const room = setup();
    const a = human(room, 0, -1, 14);
    raised(room, a);
    pressFire(room, a, 0, 0.1);
    steps(room, 0.3);
    pressFire(room, a, 0, 0.1); // detonate
    expect(rocketEnt(room)).toBeUndefined();
    expect(ksOf(a).control?.hold).toBeDefined();
    steps(room, VALKYRIE.holdSec + 0.05);
    expect(ksOf(a).control).toBeNull();
    const l = ksOf(a).launcher!;
    expect(l.left).toBe(1);
    expect(l.ready - room.time).toBeGreaterThan(VALKYRIE.reloadSec - 0.2);
    pressFire(room, a, 0, 0.1);
    expect(rocketEnt(room)).toBeUndefined(); // still reloading
    steps(room, VALKYRIE.reloadSec);
    pressFire(room, a, 0, 0.1);
    expect(rocketEnt(room)).toBeDefined();
    expect(ksOf(a).launcher!.left).toBe(0);
    steps(room, 0.2);
    pressFire(room, a, 0, 0.1);
    steps(room, VALKYRIE.holdSec + 0.1);
    expect(ksOf(a).launcher).toBeNull();
    expect(ksOf(a).control).toBeNull();
    expect(room.entities.byKind(KS_ENTITY.launcher)).toHaveLength(0);
  });

  it('switching weapons after the first shot loses the spare rocket (BO1); nothing switches while steering', () => {
    const room = setup();
    const a = human(room, 0, -1, 14);
    raised(room, a);
    pressFire(room, a, 0, 0.1);
    input(room, a, 0, 0, 0.1, 1); // weapon switch while the view rides the rocket: ignored
    room.step();
    expect(ksOf(a).launcher).not.toBeNull();
    pressFire(room, a, 0, 0.1);
    steps(room, VALKYRIE.holdSec + 0.1);
    expect(ksOf(a).launcher?.left).toBe(1);
    input(room, a, 0, 0, 0.1, 0); // back to the primary
    room.step();
    input(room, a, 0, 0, 0.1, 1);
    room.step();
    expect(ksOf(a).launcher).toBeNull();
    expect(readyKillstreaks(a)).toEqual([]);
  });
});

describe('Valkyrie Rockets: flight', () => {
  it('turns toward the aim no faster than its turn rate', () => {
    const room = setup();
    const a = human(room, 0, -1, 14);
    raised(room, a);
    pressFire(room, a, 0, 0.3);
    let prev = entDir(rocketEnt(room)!);
    const want = viewDir(Math.PI / 2, 0.3); // 90 degrees to the left
    let maxStep = 0;
    for (let i = 0; i < 20; i++) {
      input(room, a, 0, Math.PI / 2, 0.3);
      room.step();
      const e = rocketEnt(room);
      if (!e) break;
      const d = entDir(e);
      maxStep = Math.max(maxStep, angle(prev, d));
      prev = d;
    }
    expect(maxStep).toBeGreaterThan(VALKYRIE.turnRate * TICK_DT * 0.5);
    expect(maxStep).toBeLessThanOrEqual(VALKYRIE.turnRate * TICK_DT * 1.05 + 0.002);
    expect(angle(prev, want)).toBeGreaterThan(0.5); // a third of a second can't swing it round
  });

  it('boost: held, it ramps to three times cruise speed; let go, back down; it must be let go once after the launch', () => {
    const room = setup();
    const a = human(room, 0, -1, 14);
    raised(room, a);
    // Launched with the boost bit already held: no boost until it is let go (BO1).
    input(room, a, Buttons.FIRE | Buttons.ADS, 0, 0.7);
    room.step();
    for (let i = 0; i < 12; i++) {
      input(room, a, Buttons.ADS, 0, 0.7);
      room.step();
    }
    expect(rocketEnt(room)!.s?.b).toBe(0);
    expect(rocketEnt(room)!.s?.v).toBeCloseTo(VALKYRIE.speed, 0);
    input(room, a, 0, 0, 0.7);
    room.step();
    const fuel0 = rocketEnt(room)!.s!.f as number;
    for (let i = 0; i < 60; i++) {
      input(room, a, Buttons.ADS, 0, 0.7);
      room.step();
    }
    const e = rocketEnt(room)!;
    expect(e.s?.b).toBe(1);
    expect(e.s?.v).toBeCloseTo(VALKYRIE.boostSpeed, 0);
    expect(fuel0 - (e.s!.f as number)).toBeCloseTo(VALKYRIE.boostBurn, 0); // 1 s boosted burns 2 s of fuel
    for (let i = 0; i < 60; i++) {
      input(room, a, 0, 0, 0.7);
      room.step();
    }
    expect(rocketEnt(room)?.s?.v).toBeCloseTo(VALKYRIE.speed, 0);
  });

  it('turns slower at boost speed (sideways acceleration cap)', () => {
    expect(turnRateAt(VALKYRIE.speed)).toBeLessThanOrEqual(VALKYRIE.turnRate);
    expect(turnRateAt(VALKYRIE.speed)).toBeGreaterThan(0.9);
    expect(turnRateAt(VALKYRIE.boostSpeed)).toBeCloseTo(VALKYRIE.maxSteerAccel / VALKYRIE.boostSpeed, 6);
  });

  it('flies 15 s unboosted, 7.5 s boosted (pure flight steps)', () => {
    const fly = (boost: boolean) => {
      let s = rocketLaunch({ x: 0, y: 0, z: 0 }, 0, 0);
      let t = 0;
      while (s.fuel > 0) {
        s = stepRocket(s, null, boost, TICK_DT);
        t += TICK_DT;
      }
      return { t, s };
    };
    expect(fly(false).t).toBeCloseTo(VALKYRIE.fuel, 1);
    expect(fly(true).t).toBeCloseTo(VALKYRIE.fuel / VALKYRIE.boostBurn, 1);
    expect(fly(true).s.speed).toBeCloseTo(VALKYRIE.boostSpeed, 5);
    // Nobody steering: dead straight, no gravity.
    const s = fly(false).s;
    expect(s.dir).toEqual(viewDir(0, 0));
    expect(s.pos.y).toBeCloseTo(0, 6);
  });

  it('blows up on impact: the blast kills (credited to the owner, weapon valkyrie), the rocket is gone', () => {
    const room = setup();
    const a = human(room, 0, -1, 14);
    const v = bot(room, 1);
    place(v, -1, 2);
    const deaths = deathsOf(room);
    raised(room, a);
    pressFire(room, a, 0, -0.2); // down into the ground in front of the victim
    expect(until(room, () => !rocketEnt(room), 3)).toBeLessThan(3);
    expect(v.alive).toBe(false);
    expect(deaths[0]).toMatchObject({ victim: v, attacker: a, weapon: 'valkyrie', means: 'killstreak' });
    expect(ksOf(a).count).toBe(0); // streak kills don't feed streaks
  });

  it('FIRE detonates it in the air; the blast is 7.5 m', () => {
    const room = setup();
    const a = human(room, 0, -1, 18);
    const near = bot(room, 1);
    const far = bot(room, 1);
    raised(room, a);
    pressFire(room, a, 0, 0);
    steps(room, 0.5);
    const e = rocketEnt(room)!;
    place(near, e.x + 0.5, e.z - VALKYRIE.blast.r * 0.4, e.y - 1.1);
    place(far, e.x + 0.5, e.z - VALKYRIE.blast.r * 2, e.y - 1.1);
    pressFire(room, a, 0, 0);
    expect(rocketEnt(room)).toBeUndefined();
    expect(near.alive).toBe(false);
    expect(far.alive).toBe(true);
  });

  it('the rocket is hardware: a bullet shoots it down (it detonates) and the shooter scores', () => {
    const room = setup();
    const a = human(room, 0, -1, 14);
    const s = bot(room, 1);
    place(s, 8, 6);
    raised(room, a);
    pressFire(room, a, 0, 0.25);
    steps(room, 0.3);
    const e = rocketEnt(room)!;
    const o = { x: s.move.x, y: s.move.y + 1.6, z: s.move.z };
    const d = { x: e.x - o.x, y: e.y - o.y, z: e.z - o.z };
    const l = Math.hypot(d.x, d.y, d.z);
    const before = s.stats.score;
    ksRoom(room).onFire(s, 'ak47', o, { x: d.x / l, y: d.y / l, z: d.z / l }, { x: e.x + d.x, y: e.y + d.y, z: e.z + d.z });
    expect(rocketEnt(room)).toBeUndefined();
    expect(s.stats.score).toBeGreaterThan(before);
  });

  it('out of the play area: it detonates after 2 s, the feed fading to white', () => {
    const room = setup();
    const a = human(room, 0, -1, 14);
    raised(room, a);
    pressFire(room, a, 0, 1.4); // nearly straight up, boosting
    let whiteSeen = 0;
    const t = until(
      room,
      () => {
        input(room, a, Buttons.ADS, 0, 1.4);
        const e = rocketEnt(room);
        if (e && typeof e.s?.w === 'number') whiteSeen = Math.max(whiteSeen, e.s.w);
        return !e;
      },
      12,
    );
    expect(t).toBeLessThan(12);
    expect(whiteSeen).toBeGreaterThan(0.8);
    const track = rocketTrack(room, a.id)!;
    expect(track.points.at(-1)!.y).toBeGreaterThan(ksRoom(room).groundY + VALKYRIE.maxHeight - 1);
  });

  it('brings an enemy aircraft down in one hit', () => {
    const room = setup();
    const a = human(room, 0, -1, 14, ['ghost']);
    perksOf(a).allPro = true; // the helicopter doesn't see Ghost Pro
    const e = bot(room, 1);
    give(e, 'attack_helicopter');
    expect(callKillstreak(room, e, 'attack_helicopter', { target: { x: -1, y: 0, z: 0 } }).ok).toBe(true);
    steps(room, 4);
    const heli = room.entities.byKind(KS_ENTITY.heli)[0]!;
    raised(room, a);
    const aimAt = (t: { x: number; y: number; z: number }) => {
      const r = rocketEnt(room);
      const from = r ?? { x: a.move.x, y: a.move.y + 1.6, z: a.move.z };
      return dirAngles({ x: t.x - from.x, y: t.y - 0.5 - from.y, z: t.z - from.z });
    };
    const first = aimAt(heli);
    pressFire(room, a, first.yaw, first.pitch);
    const destroyed: string[] = [];
    room.bus.on('killstreaks.destroyed', (d) => destroyed.push(d.kind));
    for (let i = 0; i < 60 * 8 && rocketEnt(room); i++) {
      const h = room.entities.get(heli.id);
      if (!h) break;
      const w = aimAt(h);
      input(room, a, 0, w.yaw, w.pitch);
      room.step();
    }
    expect(destroyed).toContain(KS_ENTITY.heli);
  });
});

describe('Valkyrie Rockets: the owner', () => {
  it('dying mid-flight: the rocket flies on dead straight and still kills for them; the spare is lost', () => {
    const room = setup();
    const a = human(room, 0, -1, 14);
    const deaths = deathsOf(room);
    raised(room, a);
    pressFire(room, a, 0, -0.08);
    steps(room, 0.1);
    const dir0 = entDir(rocketEnt(room)!);
    room.kill(a, bot(room, 1), { weapon: 'ak47', means: 'bullet' });
    expect(a.respawnAt).toBeNull(); // held while the rocket flies
    expect(ksOf(a).launcher).toBeNull();
    expect(ksOf(a).control).toBeNull();
    const v = bot(room, 1);
    const e = rocketEnt(room)!;
    place(v, e.x + dir0.x * 6, e.z + dir0.z * 6);
    for (let i = 0; i < 20; i++) {
      input(room, a, 0, 1.2, 0.5); // a dead player's look doesn't steer it
      room.step();
    }
    const e2 = rocketEnt(room);
    if (e2) expect(angle(entDir(e2), dir0)).toBeLessThan(1e-3);
    expect(until(room, () => !rocketEnt(room), 4)).toBeLessThan(4);
    expect(deaths.some((d) => d.victim === v && d.attacker === a && d.weapon === 'valkyrie')).toBe(true);
    // The respawn waited for the rocket: 2 s after it went off.
    expect(a.respawnAt).toBeGreaterThanOrEqual(room.time + 2 - 0.01);
    steps(room, 0.1);
    expect(ksRoom(room).activeOf(a, 'valkyrie')).toHaveLength(0);
  });

  it('leaving the room detonates a rocket in the air', () => {
    const room = setup();
    const a = human(room, 0, -1, 14);
    raised(room, a);
    pressFire(room, a, 0, 0.3);
    steps(room, 0.3);
    const fx: string[] = [];
    const sent = feats(room);
    room.removePlayer(a.id);
    for (const m of sent) if (m.id === 'killstreaks.fx') fx.push((m.data as { kind: string }).kind);
    expect(rocketEnt(room)).toBeUndefined();
    expect(fx).toContain('bigboom');
  });
});

describe('Valkyrie Rockets: bots', () => {
  it('a bot fires the launcher and the feature flies its rockets into an enemy', () => {
    const room = setup();
    const b = bot(room, 0);
    place(b, -1, 16);
    const v = bot(room, 1);
    place(v, -1, 0);
    const deaths = deathsOf(room);
    give(b, VALKYRIE_LAUNCHER);
    expect(callKillstreak(room, b, VALKYRIE_LAUNCHER).ok).toBe(true);
    expect(until(room, () => !v.alive, 12)).toBeLessThan(12);
    expect(deaths.find((d) => d.victim === v)).toMatchObject({ attacker: b, weapon: 'valkyrie' });
  });

  it('automatic use: the drop comes to the bot, it takes the crate on landing, raises the launcher and uses both rockets', () => {
    const room = setup();
    const b = bot(room, 0);
    ksOf(b).manual = false;
    ksOf(b).botStreakUse = 1;
    place(b, -1, 16);
    const v = bot(room, 1);
    place(v, -1, 0);
    give(b, 'valkyrie');
    const sent = feats(room);
    const rockets = new Set<number>();
    const t = until(
      room,
      () => {
        if (b.alive && room.phase === 'playing' && room.time % 0.25 < TICK_DT) botAutoStreaks(room, b);
        for (const e of room.entities.byKind(KS_ENTITY.rocket)) rockets.add(e.id);
        if (!v.alive) room.spawn(v), place(v, -1, 0);
        return rockets.size >= 2 && !rocketEnt(room);
      },
      40,
    );
    expect(t).toBeLessThan(40);
    const called = sent.filter((m) => m.id === 'killstreaks.called').map((m) => (m.data as { id: string }).id);
    expect(called).toEqual(['care_package', 'valkyrie']);
    steps(room, VALKYRIE.holdSec + 0.1);
    expect(ksOf(b).launcher).toBeNull();
  });
});

describe('Valkyrie flight maths (shared)', () => {
  it('steerToward turns by at most the step and lands on the target when close', () => {
    const cur = viewDir(0, 0);
    const want = viewDir(1, 0);
    const s = steerToward(cur, want, 0.1);
    expect(angle(cur, s)).toBeCloseTo(0.1, 6);
    expect(angle(s, want)).toBeCloseTo(0.9, 6);
    expect(steerToward(cur, viewDir(0.05, 0), 0.1)).toEqual(viewDir(0.05, 0));
    // Straight behind still turns (no NaN).
    const back = steerToward(cur, { x: 0, y: 0, z: 1 }, 0.2);
    expect(angle(cur, back)).toBeCloseTo(0.2, 6);
  });

  it('clampLead keeps the aim within the lead cone of the nose', () => {
    const nose = viewDir(0.5, 0.1);
    const c = clampLead(nose, 0.5 + 2, 0.1 - 1);
    expect(wrapAngle(c.yaw - 0.5)).toBeCloseTo(VALKYRIE.lead, 6);
    expect(c.pitch).toBeCloseTo(0.1 - VALKYRIE.lead, 6);
    const inside = clampLead(nose, 0.6, 0.05);
    expect(inside.yaw).toBeCloseTo(0.6, 6);
    expect(inside.pitch).toBeCloseTo(0.05, 6);
    // Across the +-PI seam.
    const seam = clampLead(viewDir(Math.PI - 0.05, 0), -Math.PI + 0.05, 0);
    expect(Math.abs(wrapAngle(seam.yaw - (-Math.PI + 0.05)))).toBeLessThan(1e-9);
  });

  it('banks into turns up to 35 degrees, level when straight', () => {
    let r = 0;
    for (let i = 0; i < 120; i++) r = bankRoll(r, VALKYRIE.turnRate * 2, 1 / 60);
    expect(r).toBeCloseTo(VALKYRIE.maxRoll, 2);
    for (let i = 0; i < 240; i++) r = bankRoll(r, 0, 1 / 60);
    expect(Math.abs(r)).toBeLessThan(0.01);
    expect(bankRoll(0, -1, 1)).toBeLessThan(0);
  });

  it('out of bounds past the map edge or above the height limit; the no-signal white ramps', () => {
    const b = { min: { x: -10, y: -1, z: -10 }, max: { x: 10, y: 20, z: 10 } };
    expect(rocketOutOfBounds({ x: 0, y: 5, z: 0 }, b, 0)).toBe(false);
    expect(rocketOutOfBounds({ x: 10 + VALKYRIE.boundsPad + 0.1, y: 5, z: 0 }, b, 0)).toBe(true);
    expect(rocketOutOfBounds({ x: 0, y: VALKYRIE.maxHeight + 0.1, z: 0 }, b, 0)).toBe(true);
    expect(signalWhite(VALKYRIE.outOfBoundsSec / 2, null)).toBeCloseTo(0.5);
    expect(signalWhite(null, VALKYRIE.fadeInSec / 2, 0.8)).toBeCloseTo(0.4);
    expect(signalWhite(null, null)).toBe(0);
  });
});

describe('rocket cam maths (client)', () => {
  const ent = (st: ReturnType<typeof rocketLaunch>) => {
    const a = dirAngles(st.dir);
    return { x: st.pos.x, y: st.pos.y, z: st.pos.z, yaw: a.yaw, s: { p: a.pitch, v: st.speed, f: st.fuel, b: st.boost ? 1 : 0 } };
  };

  it('reads the server rocket from its snapshot entity', () => {
    const st = rocketLaunch({ x: 1, y: 2, z: 3 }, 0.4, 0.2);
    const back = rocketStateOf(ent(st));
    expect(back.pos).toEqual(st.pos);
    expect(angle(back.dir, st.dir)).toBeLessThan(1e-9);
    expect(back.speed).toBe(st.speed);
    expect(back.boost).toBe(false);
  });

  it('predicts exactly what the server steps would do with the same aim', () => {
    let server = rocketLaunch({ x: 0, y: 1, z: 0 }, 0, 0.1);
    const want = viewDir(0.8, 0.3);
    const pred = predictRocket(server, want, true, 0.25, TICK_DT);
    for (let t = 0; t < 0.25 - 1e-9; t += TICK_DT) server = stepRocket(server, want, true, TICK_DT);
    expect(pred.pos.x).toBeCloseTo(server.pos.x, 6);
    expect(pred.pos.z).toBeCloseTo(server.pos.z, 6);
    expect(angle(pred.dir, server.dir)).toBeLessThan(1e-6);
  });

  it('predicts ahead by the snapshot age plus half a round trip, capped', () => {
    expect(predictAhead(10.1, 10, 0.08)).toBeCloseTo(0.14);
    expect(predictAhead(10, 10.05, 0)).toBe(0);
    expect(predictAhead(12, 10, 0.5)).toBe(0.35);
  });

  it('follows smoothly, cuts to a new rocket, and holds back from the blast looking at it', () => {
    const a = { pos: { x: 0, y: 0, z: 0 }, dir: viewDir(0, 0) };
    const b = { pos: { x: 1, y: 0, z: 0 }, dir: viewDir(0.5, 0) };
    const f = followRocket(a, b, 1 / 60);
    expect(f.pos.x).toBeGreaterThan(0);
    expect(f.pos.x).toBeLessThan(1);
    expect(angle(f.dir, a.dir)).toBeGreaterThan(0);
    expect(angle(f.dir, a.dir)).toBeLessThan(0.5);
    expect(followRocket(a, { ...b, pos: { x: 50, y: 0, z: 0 } }, 1 / 60).pos.x).toBe(50);
    expect(followRocket(null, b, 1 / 60)).toEqual(b);
    const h = holdView({ x: 0, y: 0, z: -10 }, viewDir(0, 0));
    expect(h.pos.z).toBeGreaterThan(-10);
    expect(h.pos.y).toBeGreaterThan(0);
    expect(angle(h.dir, { x: 0, y: -h.pos.y, z: -10 - h.pos.z })).toBeLessThan(0.3);
  });

  it('while steering, tactical (Q / LB) or ADS goes out as the boost bit; grenades and the knife are dropped', () => {
    const F = Buttons.FIRE;
    expect(rocketButtons(Buttons.TACTICAL | F, true)).toBe(Buttons.ADS | F);
    expect(rocketButtons(Buttons.ADS, true)).toBe(Buttons.ADS);
    expect(rocketButtons(Buttons.LETHAL | Buttons.MELEE | Buttons.FORWARD, true)).toBe(Buttons.FORWARD);
    expect(rocketButtons(Buttons.TACTICAL | Buttons.LETHAL, false)).toBe(Buttons.TACTICAL | Buttons.LETHAL);
  });

  it('launcher phases and the overlay readouts', () => {
    expect(launcherPhase({ left: 2, ready: 10.3, fired: false }, 10, false)).toMatchObject({ phase: 'raising' });
    expect(launcherPhase({ left: 1, ready: 11.5, fired: true }, 10, false)).toEqual({ phase: 'reloading', k: 0.5 });
    expect(launcherPhase({ left: 1, ready: 9, fired: true }, 10, false).phase).toBe('ready');
    expect(launcherPhase({ left: 1, ready: 9, fired: true }, 10, true).phase).toBe('flying');
    expect(launcherPhase({ left: 0, ready: 9, fired: true }, 10, false).phase).toBe('empty');
    expect(rocketHudInfo({ f: 7.5, b: 1, w: 0.4 }, 1)).toEqual({ fuel: 0.5, boost: true, white: 0.4, rocket: 1 });
    expect(rocketHudInfo({}, 0).rocket).toBe(2);
  });
});
