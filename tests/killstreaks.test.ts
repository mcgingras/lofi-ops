import { afterEach, describe, expect, it } from 'vitest';
import { botAutoStreaks, botCallDelay, callKillstreak, enemyStreakTargets, isDrivingStreak, readyKillstreaks, suggestTarget } from '../src/server/features/killstreaks/api';
import { onStreakPressed, throwMarker } from '../src/server/features/killstreaks/index';
import { perksOf } from '../src/server/features/perks/common';
import { ksOf, stateMsg } from '../src/server/features/killstreaks/state';
import { cratesOf, rollContents, PACKAGE } from '../src/server/features/killstreaks/streaks/package';
import { AIRSPACE } from '../src/server/features/killstreaks/streaks/heli';
import { ksRoom } from '../src/server/features/killstreaks/world';
import { CARE_PACKAGE_WEIGHTS, KILLSTREAKS, KS_ENTITY, isStreakWeapon } from '../src/shared/defs/killstreaks';
import { Buttons } from '../src/shared/input';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { aim, bot, give, gunKill, input, place, rig, steps, until, type Rig } from './perks-streaks.helpers';

let r: Rig | undefined;
afterEach(() => {
  r?.close();
  r = undefined;
});
const setup = () => (r = rig()).room;

/** A victim that stays put in the open with lots of health tracking. */
const victimAt = (room: Room, x: number, z: number, perks: string[] = []) => {
  const v = bot(room, 1, perks);
  place(v, x, z);
  return v;
};

const deathsOf = (room: Room) => {
  const out: { victim: PlayerState; attacker: PlayerState | null; weapon: string; means: string }[] = [];
  room.bus.on('death', (e) => out.push({ victim: e.victim, attacker: e.attacker, weapon: e.weapon, means: e.means }));
  return out;
};

describe('killstreak defs', () => {
  it('has the BO1 list with costs (plus MW2\'s Tactical Nuke)', () => {
    const costs = Object.fromEntries(KILLSTREAKS.map((k) => [k.id, k.kills]));
    expect(costs).toEqual({ uav: 3, rcxd: 3, counter_uav: 4, sam_turret: 4, care_package: 5, napalm: 5, sentry_gun: 6, mortar: 6, attack_helicopter: 7, valkyrie: 7, mystery_box: 5, blackbird: 8, rolling_thunder: 8, chopper_gunner: 9, glitch: 10, attack_dogs: 11, nuke: 25 });
    expect(CARE_PACKAGE_WEIGHTS.nuke).toBeUndefined();
    for (const id of Object.keys(CARE_PACKAGE_WEIGHTS)) if (id !== 'ammo') expect(costs[id], id).toBeDefined();
    expect(isStreakWeapon('napalm')).toBe(true);
    expect(isStreakWeapon('ak47')).toBe(false);
  });
});

describe('earning', () => {
  it('earns at the cost, keeps earned streaks across deaths, resets the count', () => {
    const room = setup();
    const a = bot(room, 0, [], ['uav', 'counter_uav', 'care_package']);
    for (let i = 0; i < 3; i++) gunKill(room, a, bot(room, 1));
    expect(readyKillstreaks(a)).toEqual(['uav']);
    gunKill(room, a, bot(room, 1));
    expect(readyKillstreaks(a)).toEqual(['uav', 'counter_uav']);
    gunKill(room, bot(room, 1), a);
    expect(ksOf(a).count).toBe(0);
    expect(readyKillstreaks(a)).toEqual(['uav', 'counter_uav']);
    room.spawn(a);
    for (let i = 0; i < 3; i++) gunKill(room, a, bot(room, 1));
    expect(readyKillstreaks(a)).toEqual(['uav', 'counter_uav', 'uav']);
    const msg = stateMsg(room, a);
    expect(msg.chosen.map((c) => c.cost)).toEqual([3, 4, 5]);
    expect(msg.count).toBe(3);
  });

  it('killstreak kills do not count toward the next streak', () => {
    const room = setup();
    const a = bot(room, 0, [], ['uav']);
    room.kill(bot(room, 1), a, { weapon: 'napalm', means: 'killstreak' });
    room.kill(bot(room, 1), a, { weapon: 'attack_dogs', means: 'killstreak' });
    expect(ksOf(a).count).toBe(0);
    expect(a.stats.kills).toBe(2);
  });

  it('a match start clears everything', () => {
    const room = setup();
    const a = bot(room, 0, [], ['uav']);
    give(a, 'uav');
    expect(callKillstreak(room, a, 'uav').ok).toBe(true);
    give(a, 'napalm');
    room.endMatch('forfeit');
    room.startMatch();
    expect(readyKillstreaks(a)).toEqual([]);
    expect(room.entities.byKind(KS_ENTITY.uav)).toHaveLength(0);
    expect(ksRoom(room).actives).toHaveLength(0);
  });

  it('refuses streaks that are not ready, while dead, or out of phase', () => {
    const room = setup();
    const a = bot(room, 0);
    expect(callKillstreak(room, a, 'uav')).toEqual({ ok: false, reason: 'not_ready' });
    give(a, 'uav');
    gunKill(room, bot(room, 1), a);
    expect(callKillstreak(room, a, 'uav')).toEqual({ ok: false, reason: 'dead' });
    expect(callKillstreak(room, a, 'bogus')).toEqual({ ok: false, reason: 'unknown' });
  });
});

describe('radar streaks', () => {
  it('Spy Plane shows enemies to the team for 30 s and can be shot down', () => {
    const room = setup();
    const a = bot(room, 0);
    const mate = bot(room, 0);
    const e = bot(room, 1);
    give(a, 'uav');
    callKillstreak(room, a, 'uav');
    expect(room.radarFor(mate)).toEqual([e.id]);
    expect(room.radarFor(e)).toEqual([]);
    const plane = room.entities.byKind(KS_ENTITY.uav)[0]!;
    expect(plane.y).toBeGreaterThan(30);
    steps(room, 10);
    expect(room.radarFor(a)).toEqual([e.id]);
    // Shoot it down (bot gunfire: any `fire` event passing through it).
    const ctx = ksRoom(room);
    const ended: boolean[] = [];
    room.bus.on('killstreaks.ended', (x) => ended.push(x.destroyed));
    ctx.hurtEntity(plane.id, 10000, e);
    steps(room, 0.1);
    expect(room.entities.byKind(KS_ENTITY.uav)).toHaveLength(0);
    expect(ended).toEqual([true]);
    expect(room.radarFor(a)).toEqual([]);
    expect(e.stats.score).toBeGreaterThan(0);
  });

  it('Spy Plane runs out', () => {
    const room = setup();
    const a = bot(room, 0);
    bot(room, 1);
    give(a, 'uav');
    callKillstreak(room, a, 'uav');
    steps(room, 30.5);
    expect(room.radarFor(a)).toEqual([]);
    expect(room.entities.byKind(KS_ENTITY.uav)).toHaveLength(0);
  });

  it('Counter-Spy Plane jams only the enemy', () => {
    const room = setup();
    const a = bot(room, 0);
    const mate = bot(room, 0);
    const e = bot(room, 1);
    give(a, 'counter_uav');
    callKillstreak(room, a, 'counter_uav');
    expect(room.modifiers.any('radarJammed', e)).toBe(true);
    expect(room.modifiers.any('radarJammed', mate)).toBeUndefined();
    expect(room.modifiers.any('radarJammed', a)).toBeUndefined();
  });

  it('Blackbird reveals enemies and cannot be shot down', () => {
    const room = setup();
    const a = bot(room, 0);
    const e = bot(room, 1);
    give(a, 'blackbird');
    callKillstreak(room, a, 'blackbird');
    expect(room.radarFor(a)).toEqual([e.id]);
    const bb = room.entities.byKind(KS_ENTITY.blackbird)[0]!;
    expect(ksRoom(room).hp.has(bb.id)).toBe(false);
  });
});

describe('strikes', () => {
  it('Napalm burns the target line; kills go to the caller and do not feed streaks', () => {
    const room = setup();
    const a = bot(room, 0, [], ['uav']);
    place(a, -10, 20);
    const v = victimAt(room, -1, 0);
    const deaths = deathsOf(room);
    give(a, 'napalm');
    expect(callKillstreak(room, a, 'napalm', { target: { x: -1, y: 0, z: 0 }, yaw: 0 }).ok).toBe(true);
    expect(room.entities.byKind(KS_ENTITY.jet)).toHaveLength(1);
    expect(until(room, () => !v.alive, 8)).toBeLessThan(8);
    expect(deaths[0]).toMatchObject({ victim: v, attacker: a, weapon: 'napalm', means: 'killstreak' });
    expect(ksOf(a).count).toBe(0);
    expect(room.entities.byKind(KS_ENTITY.fire).length).toBeGreaterThan(0);
  });

  it('Napalm ground fire burns; Flak Jacket Pro is immune', () => {
    const room = setup();
    const a = bot(room, 0);
    place(a, -10, 20);
    give(a, 'napalm');
    callKillstreak(room, a, 'napalm', { target: { x: -1, y: 0, z: 0 }, yaw: 0 });
    until(room, () => room.entities.byKind(KS_ENTITY.fire).length === 3, 8);
    const walker = victimAt(room, -1, 0.5);
    const flak = victimAt(room, -1, -0.5, ['flak_jacket']);
    perksOf(flak).allPro = true;
    steps(room, 1.6);
    expect(walker.health).toBeLessThan(100);
    expect(flak.health).toBe(100);
  });

  it('Rolling Thunder carpet-bombs the line', () => {
    const room = setup();
    const a = bot(room, 0);
    place(a, -10, 20);
    const v1 = victimAt(room, -1, 0);
    const v2 = victimAt(room, -1, -10);
    give(a, 'rolling_thunder');
    expect(callKillstreak(room, a, 'rolling_thunder', { target: { x: -1, y: 0, z: -5 }, yaw: 0 }).ok).toBe(true);
    until(room, () => !v1.alive && !v2.alive, 10);
    expect(v1.alive || v2.alive).toBe(false);
  });

  it('Mortar Team marks three spots and shells them after a warning', () => {
    const room = setup();
    const a = bot(room, 0);
    place(a, -10, 20);
    const v = victimAt(room, -1, 0);
    give(a, 'mortar');
    expect(callKillstreak(room, a, 'mortar', { targets: [{ x: -1, y: 0, z: 0 }, { x: 10, y: 0, z: -10 }, { x: -12, y: 0, z: -6 }] }).ok).toBe(true);
    expect(room.entities.byKind(KS_ENTITY.mortarMark)).toHaveLength(3);
    steps(room, 2);
    expect(v.alive).toBe(true); // time to run
    expect(until(room, () => !v.alive, 3)).toBeLessThan(3);
    steps(room, 3);
    expect(room.entities.byKind(KS_ENTITY.mortarMark)).toHaveLength(0);
  });

  it('the Care Package raises its marker with STREAK and throws it with FIRE (the drop follows the canister)', () => {
    const room = setup();
    const a = bot(room, 0);
    place(a, -1, 12);
    a.yaw = 0;
    a.pitch = -0.3;
    give(a, 'care_package');
    onStreakPressed(room, a);
    expect(ksOf(a).marker?.id).toBe('care_package');
    expect(ksOf(a).armed).toBeNull(); // no crosshair designator any more
    steps(room, 0.1);
    expect(a.swapEnd).toBeGreaterThan(room.time); // weapon down while the canister is up
    throwMarker(room, a);
    expect(ksOf(a).marker).toBeNull();
    expect(readyKillstreaks(a)).toEqual([]);
    expect(room.entities.byKind(KS_ENTITY.marker)).toHaveLength(1);
    expect(until(room, () => room.entities.byKind(KS_ENTITY.dropHeli).length === 1, 9)).toBeLessThan(9);
  });

  it('map streaks never fall back to the crosshair', () => {
    const room = setup();
    const a = bot(room, 0);
    place(a, -1, 12);
    a.pitch = -0.5;
    give(a, 'napalm');
    expect(callKillstreak(room, a, 'napalm')).toEqual({ ok: false, reason: 'no_target' });
    expect(readyKillstreaks(a)).toEqual(['napalm']);
  });
});

describe('care package', () => {
  const dropAndLand = (room: Room, owner: PlayerState, at = { x: -1, y: 0, z: 0 }) => {
    give(owner, 'care_package');
    expect(callKillstreak(room, owner, 'care_package', { target: at }).ok).toBe(true);
    expect(until(room, () => cratesOf(ksRoom(room)).some((c) => c.landed), 15)).toBeLessThan(15);
    return cratesOf(ksRoom(room))[0]!;
  };

  it('drops a crate; the owner takes it with USE and gets the streak', () => {
    const room = setup();
    const a = bot(room, 0);
    place(a, -1, 10);
    const crate = dropAndLand(room, a);
    expect(room.entities.byKind(KS_ENTITY.dropHeli).length).toBeLessThanOrEqual(1);
    crate.contents = 'attack_helicopter';
    place(a, crate.ent.x + 0.5, crate.ent.z);
    a.brain = { think: () => ({ buttons: Buttons.USE, yaw: 0, pitch: 0, weaponSlot: 0 }) };
    const t = until(room, () => readyKillstreaks(a).includes('attack_helicopter'), 2);
    expect(t).toBeLessThan(PACKAGE.owner + 0.2);
    expect(room.entities.byKind(KS_ENTITY.crate)).toHaveLength(0);
  });

  it('enemies need longer; ammo refills', () => {
    const room = setup();
    const a = bot(room, 0);
    const e = bot(room, 1);
    place(a, -1, 10);
    const crate = dropAndLand(room, a);
    crate.contents = 'ammo';
    e.weapons[0]!.reserve = 0;
    place(e, crate.ent.x + 0.5, crate.ent.z);
    e.brain = { think: () => ({ buttons: Buttons.USE, yaw: 0, pitch: 0, weaponSlot: 0 }) };
    steps(room, PACKAGE.owner + 0.5);
    expect(room.entities.byKind(KS_ENTITY.crate)).toHaveLength(1);
    steps(room, PACKAGE.enemy);
    expect(room.entities.byKind(KS_ENTITY.crate)).toHaveLength(0);
    expect(e.weapons[0]!.reserve).toBe(e.weapons[0]!.def.reserve);
  });

  it('crushes whoever it lands on', () => {
    const room = setup();
    const a = bot(room, 0);
    place(a, -1, 10);
    const v = victimAt(room, -1, 0);
    dropAndLand(room, a);
    expect(v.alive).toBe(false);
  });

  it('Hardline Pro rerolls the contents once with USE', () => {
    const room = setup();
    const a = bot(room, 0, ['hardline']);
    perksOf(a).allPro = true;
    place(a, -1, 10);
    const crate = dropAndLand(room, a);
    crate.contents = 'uav';
    place(a, crate.ent.x + 0.5, crate.ent.z);
    room.bus.emit('buttons', { player: a, pressed: Buttons.USE, released: 0, buttons: Buttons.USE });
    expect(crate.contents).not.toBe('uav');
    expect(crate.rerolled).toBe(true);
    const second = crate.contents;
    room.bus.emit('buttons', { player: a, pressed: Buttons.USE, released: 0, buttons: Buttons.USE });
    expect(crate.contents).toBe(second);
  });

  it('Hacker Pro booby-traps an enemy crate', () => {
    const room = setup();
    const a = bot(room, 0);
    const hacker = bot(room, 1, ['hacker']);
    perksOf(hacker).allPro = true;
    place(a, -1, 10);
    const crate = dropAndLand(room, a);
    place(hacker, crate.ent.x + 0.5, crate.ent.z);
    hacker.brain = { think: () => ({ buttons: Buttons.USE, yaw: 0, pitch: 0, weaponSlot: 0 }) };
    until(room, () => crate.trap !== null, 3);
    expect(crate.trap).toBe(hacker);
    hacker.brain = null;
    place(hacker, 15, -20);
    const deaths = deathsOf(room);
    place(a, crate.ent.x - 0.5, crate.ent.z);
    a.brain = { think: () => ({ buttons: Buttons.USE, yaw: 0, pitch: 0, weaponSlot: 0 }) };
    until(room, () => !a.alive, 2);
    expect(deaths[0]).toMatchObject({ victim: a, attacker: hacker, weapon: 'care_package' });
  });

  it('rolls weighted contents, never itself', () => {
    const seen = new Set<string>();
    let i = 0;
    for (let k = 0; k < 400; k++) seen.add(rollContents(() => ((i = (i * 9301 + 49297) % 233280) / 233280)));
    expect(seen.has('care_package')).toBe(false);
    expect(seen.size).toBeGreaterThan(6);
    expect(rollContents(() => 0, 'ammo')).not.toBe('ammo');
  });
});

describe('turrets', () => {
  it('Sentry Gun shoots enemies it sees (bots like players) and is destroyed by gunfire', () => {
    const room = setup();
    const a = bot(room, 0);
    place(a, -1, 10);
    a.yaw = 0;
    const v = victimAt(room, -1, -2);
    give(a, 'sentry_gun');
    expect(callKillstreak(room, a, 'sentry_gun').ok).toBe(true);
    // A bot's turret goes down in front of it, facing the enemy it knows of.
    const sentry = room.entities.byKind(KS_ENTITY.sentry)[0]!;
    expect(Math.hypot(sentry.x - -1, sentry.z - 8.5)).toBeLessThan(0.1);
    const deaths = deathsOf(room);
    expect(until(room, () => !v.alive, 4)).toBeLessThan(4);
    expect(deaths[0]).toMatchObject({ attacker: a, weapon: 'sentry_gun' });
    // An enemy shoots it to pieces.
    const e = bot(room, 1);
    place(e, -1, -4);
    e.health = e.maxHealth = 1e6;
    e.brain = { think: () => ({ buttons: Buttons.ADS, yaw: 0, pitch: 0, weaponSlot: 0 }) };
    let shots = 0;
    while (room.entities.get(sentry.id) && shots < 200) {
      e.move.ads = 1;
      e.weapons[0]!.mag = 30;
      room.fire(e, { dir: aim(e, { x: sentry.x, y: sentry.y, z: sentry.z }, 0.7) });
      steps(room, 0.11);
      shots++;
    }
    expect(room.entities.get(sentry.id)).toBeUndefined();
    expect(shots).toBeLessThan(200);
  });

  it('Sentry Gun expires', () => {
    const room = setup();
    const a = bot(room, 0);
    give(a, 'sentry_gun');
    callKillstreak(room, a, 'sentry_gun');
    steps(room, 60.5);
    expect(room.entities.byKind(KS_ENTITY.sentry)).toHaveLength(0);
  });

  it('SAM Turret shoots down enemy aircraft', () => {
    const room = setup();
    const a = bot(room, 0);
    const e = bot(room, 1);
    give(a, 'sam_turret');
    give(e, 'uav');
    expect(callKillstreak(room, e, 'uav').ok).toBe(true);
    expect(callKillstreak(room, a, 'sam_turret').ok).toBe(true);
    const destroyed: string[] = [];
    room.bus.on('killstreaks.destroyed', (x) => destroyed.push(x.id));
    expect(until(room, () => room.entities.byKind(KS_ENTITY.uav).length === 0, 8)).toBeLessThan(8);
    expect(destroyed).toContain('uav');
  });
});

describe('helicopters', () => {
  it('Attack Helicopter hunts enemies, can be shot down, leaves when time is up', () => {
    const room = setup();
    const a = bot(room, 0);
    place(a, 20, 20);
    give(a, 'attack_helicopter');
    expect(callKillstreak(room, a, 'attack_helicopter').ok).toBe(true);
    const v = victimAt(room, -1, 0);
    const deaths = deathsOf(room);
    expect(until(room, () => !v.alive, 20)).toBeLessThan(20);
    expect(deaths[0]).toMatchObject({ attacker: a, weapon: 'attack_helicopter', means: 'killstreak' });
    expect(enemyStreakTargets(room, bot(room, 1)).some((t) => t.air && t.streak === 'attack_helicopter')).toBe(true);
    steps(room, 70);
    expect(room.entities.byKind(KS_ENTITY.heli)).toHaveLength(0);
  });

  it('airspace is limited', () => {
    const room = setup();
    const a = bot(room, 0);
    for (let i = 0; i < AIRSPACE + 1; i++) give(a, 'attack_helicopter');
    for (let i = 0; i < AIRSPACE; i++) expect(callKillstreak(room, a, 'attack_helicopter').ok).toBe(true);
    expect(callKillstreak(room, a, 'attack_helicopter')).toEqual({ ok: false, reason: 'airspace_full' });
  });

  it('Chopper Gunner: the caller aims and fires explosive rounds; their death ends it', () => {
    const room = setup();
    const a = bot(room, 0);
    a.isBot = false; // drive it like a human: yaw/pitch + FIRE
    place(a, 20, 20);
    const v = victimAt(room, -1, 0);
    give(a, 'chopper_gunner');
    expect(callKillstreak(room, a, 'chopper_gunner').ok).toBe(true);
    expect(isDrivingStreak(a)).toBe(true);
    const gunner = room.entities.byKind(KS_ENTITY.gunner)[0]!;
    a.brain = null;
    const deaths = deathsOf(room);
    for (let i = 0; i < 240 && v.alive; i++) {
      const g = { x: gunner.x, y: gunner.y - 1.5, z: gunner.z };
      const d = { x: v.move.x - g.x, y: v.move.y + 0.2 - g.y, z: v.move.z - g.z };
      const l = Math.hypot(d.x, d.y, d.z);
      input(room, a, Buttons.FIRE, Math.atan2(-d.x, -d.z), Math.asin(d.y / l));
      room.step();
    }
    expect(v.alive).toBe(false);
    expect(deaths[0]).toMatchObject({ attacker: a, weapon: 'chopper_gunner' });
    expect(a.swapEnd).toBeGreaterThan(room.time); // can't shoot their own gun meanwhile
    expect(room.modifiers.mul('speedMultiplier', a)).toBe(0);
    gunKill(room, bot(room, 1), a);
    steps(room, 0.1);
    expect(isDrivingStreak(a)).toBe(false);
    expect(room.entities.byKind(KS_ENTITY.gunner)).toHaveLength(0);
  });

  it('a bot works its Chopper Gunner on its own', () => {
    const room = setup();
    const a = bot(room, 0);
    ksOf(a).botStreakUse = 1;
    place(a, 20, 20);
    const v = victimAt(room, -1, 0);
    give(a, 'chopper_gunner');
    callKillstreak(room, a, 'chopper_gunner');
    expect(until(room, () => !v.alive, 20)).toBeLessThan(20);
  });
});

describe('driven streaks', () => {
  it('RC-XD drives with the movement keys and detonates on FIRE', () => {
    const room = setup();
    const a = bot(room, 0);
    a.isBot = false;
    a.brain = null;
    place(a, -1, 12);
    a.yaw = 0;
    give(a, 'rcxd');
    expect(callKillstreak(room, a, 'rcxd').ok).toBe(true);
    const car = room.entities.byKind(KS_ENTITY.rcxd)[0]!;
    const z0 = car.z;
    for (let i = 0; i < 60; i++) {
      input(room, a, Buttons.FORWARD, 0, 0);
      room.step();
    }
    expect(car.z).toBeLessThan(z0 - 4); // drove toward -z
    expect(Math.abs(a.move.z - 12)).toBeLessThan(0.1); // the body stayed
    const v = victimAt(room, -1, car.z - 2);
    const deaths = deathsOf(room);
    input(room, a, Buttons.FORWARD | Buttons.FIRE, 0, 0);
    room.step();
    steps(room, 0.1);
    expect(v.alive).toBe(false);
    expect(deaths[0]).toMatchObject({ attacker: a, weapon: 'rcxd' });
    expect(isDrivingStreak(a)).toBe(false);
  });

  it('RC-XD shot by an enemy is destroyed harmlessly', () => {
    const room = setup();
    const a = bot(room, 0);
    place(a, -1, 12);
    give(a, 'rcxd');
    callKillstreak(room, a, 'rcxd');
    const car = room.entities.byKind(KS_ENTITY.rcxd)[0]!;
    const e = bot(room, 1);
    ksRoom(room).hurtEntity(car.id, 100, e);
    steps(room, 0.1);
    expect(room.entities.byKind(KS_ENTITY.rcxd)).toHaveLength(0);
    expect(a.alive).toBe(true);
  });

  it('a bot drives its RC-XD to the enemy and blows it up', () => {
    const room = setup();
    const a = bot(room, 0);
    place(a, -1, 12);
    const v = victimAt(room, -1, 0);
    give(a, 'rcxd');
    callKillstreak(room, a, 'rcxd');
    expect(until(room, () => !v.alive, 10)).toBeLessThan(10);
  });

  it('Attack Dogs hunt down an enemy', () => {
    const room = setup();
    const a = bot(room, 0);
    give(a, 'attack_dogs');
    expect(callKillstreak(room, a, 'attack_dogs').ok).toBe(true);
    const v = victimAt(room, -1, 0, ['ghost']);
    perksOf(v).allPro = true; // Ghost Pro doesn't fool dogs
    const deaths = deathsOf(room);
    expect(until(room, () => !v.alive, 30)).toBeLessThan(30);
    expect(deaths[0]).toMatchObject({ attacker: a, weapon: 'attack_dogs' });
    expect(room.entities.byKind(KS_ENTITY.dog).length).toBeGreaterThan(0);
    expect(room.entities.byKind(KS_ENTITY.dog).length).toBeLessThanOrEqual(3);
  });
});

describe('bots', () => {
  it('call earned streaks automatically, sooner with more skill', () => {
    expect(botCallDelay(1)).toBeLessThan(3);
    const room = setup();
    const a = bot(room, 0, [], ['uav']);
    ksOf(a).manual = false;
    ksOf(a).botStreakUse = 1;
    bot(room, 1);
    for (let i = 0; i < 3; i++) gunKill(room, a, bot(room, 1));
    expect(readyKillstreaks(a)).toEqual(['uav']);
    expect(until(room, () => room.entities.byKind(KS_ENTITY.uav).length > 0, 4)).toBeLessThan(4);
    expect(readyKillstreaks(a)).toEqual([]);
  });

  it('suggest targets near enemies and skilled bots hold a SAM for enemy air', () => {
    const room = setup();
    const a = bot(room, 0);
    const e = victimAt(room, 10, -10);
    const s = suggestTarget(room, a, 'mortar', 1);
    expect(s.targets).toHaveLength(3);
    expect(Math.hypot(s.target!.x - e.move.x, s.target!.z - e.move.z)).toBeLessThan(2);
    give(a, 'sam_turret');
    ksOf(a).botStreakUse = 1;
    ksOf(a).manual = false;
    ksOf(a).botNextCall = 0;
    botAutoStreaks(room, a);
    expect(readyKillstreaks(a)).toEqual(['sam_turret']);
  });
});
