/**
 * Secondary launchers (China Lake, RPG-7, M72 LAW, Strela-3, Stinger), rules level on a Yard room
 * stepped tick by tick: the defs, unlocks and store; the China Lake's arc, pump and one bounce;
 * rockets' seeded drift; the arming distance (duds and impact damage); splash with the self hit;
 * lock-on (air killstreaks only, the timing, friendly and ground targets refused); a homing missile
 * catching a moving aircraft; shoot-down rewards (score, XP line, the owner told) and bullets on
 * the UAV; the supply chopper shot down; Scavenger leaving launchers alone; Pack-a-Punch effects;
 * and bots (air streaks, never point blank, rockets at clusters). Anything random is seeded.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { callKillstreak } from '../src/server/features/killstreaks/api';
import { ksRoom } from '../src/server/features/killstreaks/world';
import { cratesOf } from '../src/server/features/killstreaks/streaks/package';
import { resupply } from '../src/server/features/perks/scavenger';
import { Brain } from '../src/server/features/bots/brain';
import { chooseBotLoadout } from '../src/server/features/bots/loadout';
import { BOT_DIFFICULTY_BY_ID } from '../src/shared/defs/bots';
import weapons from '../src/server/features/weapons/index';
import { launch, lockOf, spawnProj, type Proj } from '../src/server/features/weapons/launchers/index';
import { airTargetFor, clusteredWith, launcherAim, launcherBotPlan } from '../src/server/features/weapons/launchers/bots';
import { makeWeapon, type PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { PLAYER, TICK_DT } from '../src/shared/constants';
import { KS_ENTITY } from '../src/shared/defs/killstreaks';
import { clusterDirs, driftAngles, inLockCone, isArmed, LAUNCHER_ENTITY, LAUNCHER_IDS, LAUNCHERS, leadPoint, lobPitch, lockProgress, steerToward, turnDir } from '../src/shared/defs/launchers';
import { isPackable, packDef, PAP_WEAPONS, papEffect, papEffectText, papName } from '../src/shared/defs/pack-a-punch';
import { effectiveWeapon } from '../src/shared/defs/attachments';
import { keyOf, storeCatalog } from '../src/shared/defs/store';
import { isUnlocked, unlockTable } from '../src/shared/defs/unlocks';
import { LOADOUT_WEAPONS, WEAPON_BY_ID } from '../src/shared/defs/weapons';
import { newProfile } from '../src/shared/profile';
import { rng, viewDir, type Vec3 } from '../src/shared/math';
import { aim, bot, place, rig, steps, until, type Rig } from './perks-streaks.helpers';
import { withSeed } from './bots-sim';

let r: Rig | undefined;
afterEach(() => {
  r?.close();
  r = undefined;
});
const setup = () => (r = rig({}, [weapons])).room;

const eye = (p: PlayerState): Vec3 => ({ x: p.move.x, y: p.move.y + PLAYER.eye, z: p.move.z });
/** Put launcher `id` in hand (slot 1), ready to fire; `pap` packs it. */
function arm(p: PlayerState, id: string, pap = false): void {
  const w = makeWeapon({ weapon: id, attachments: [], camo: 'none' }, id);
  if (pap) {
    // Inside a Pack-a-Punch window (the buff reverts guns packed outside one).
    (p.ext.killstreaks ??= { count: 0, earnedLife: [], ready: [], selected: 0, armed: null, control: null }).papUntil = 1e9;
    w.def = packDef(w.def);
    w.pap = true;
    w.mag = w.def.magazine;
    w.reserve = w.def.reserve;
  }
  w.credit = 2;
  p.weapons[1] = w;
  p.slot = 1;
  p.swapEnd = 0;
  p.reloadEnd = 0;
}
/** Fire the held weapon at a point (or along a direction). */
function shoot(room: Room, p: PlayerState, at: Vec3 | null, dir?: Vec3, shot = 1) {
  const w = p.weapons[p.slot]!;
  w.credit = 2;
  w.lastShot = -99;
  p.swapEnd = 0;
  const e = eye(p);
  const d = dir ?? { x: at!.x - e.x, y: at!.y - e.y, z: at!.z - e.z };
  const l = Math.hypot(d.x, d.y, d.z);
  return room.fire(p, { dir: { x: d.x / l, y: d.y / l, z: d.z / l }, shot });
}
const projs = (room: Room) => room.entities.byKind(LAUNCHER_ENTITY);
const dataOf = (room: Room) => projs(room).map((e) => e.data as Proj);
function deaths(room: Room) {
  const out: { victim: PlayerState; attacker: PlayerState | null; weapon: string; means: string }[] = [];
  room.bus.on('death', (e) => out.push({ victim: e.victim, attacker: e.attacker, weapon: e.weapon, means: e.means }));
  return out;
}
function damages(room: Room) {
  const out: { victim: PlayerState; amount: number; weapon: string; means: string }[] = [];
  room.bus.on('damage', (e) => out.push({ victim: e.victim, amount: e.amount, weapon: e.weapon, means: e.means }));
  return out;
}
/** Every feature message the room sends. */
function feats(room: Room) {
  const out: { to: PlayerState | null; id: string; data: unknown }[] = [];
  const orig = room.sendFeature.bind(room);
  room.sendFeature = ((to: PlayerState | null, id: string, data: unknown) => {
    out.push({ to, id, data });
    return orig(to as PlayerState, id as never, data as never);
  }) as typeof room.sendFeature;
  return out;
}
/** The bots used as targets and shooters stand still and never act on their own. */
function still(p: PlayerState): PlayerState {
  p.brain = { think: (_r, self) => ({ buttons: 0, yaw: self.yaw, pitch: self.pitch, weaponSlot: self.slot }) };
  return p;
}
const clearLine = (room: Room, a: Vec3, b: Vec3) => room.world.lineOfSight(a, b, 'bullets');
/** Look along `d` (sets yaw / pitch for the lock and the bots). */
function face(p: PlayerState, d: Vec3) {
  p.yaw = Math.atan2(-d.x, -d.z);
  p.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
}
const toward = (a: Vec3, b: Vec3) => {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const l = Math.hypot(d.x, d.y, d.z);
  return { x: d.x / l, y: d.y / l, z: d.z / l };
};
/** An enemy air streak for `owner` (UAV by default), returning its entity. */
function aircraft(room: Room, owner: PlayerState, id = 'uav') {
  owner.ext.killstreaks!.ready.push(id);
  const res = callKillstreak(room, owner, id, { target: { x: 0, y: 0, z: 0 } });
  expect(res.ok, JSON.stringify(res)).toBe(true);
  const kind = id === 'uav' ? KS_ENTITY.uav : id === 'counter_uav' ? KS_ENTITY.counterUav : id === 'attack_helicopter' ? KS_ENTITY.heli : KS_ENTITY.gunner;
  return room.entities.byKind(kind).at(-1)!;
}

describe('launcher defs, unlocks, store', () => {
  it('five secondary launchers with blasts, rounds and projectile flags', () => {
    expect(LAUNCHER_IDS.sort()).toEqual(['china_lake', 'm72law', 'rpg', 'stinger', 'strela']);
    for (const id of LAUNCHER_IDS) {
      const d = WEAPON_BY_ID.get(id)!;
      expect(d.class, id).toBe('launcher');
      expect(d.slot, id).toBe('secondary');
      expect(d.projectile, id).toBe(true);
      expect(d.ammoNoun, id).toBeTruthy();
      expect(d.attachments, id).toEqual([]);
      expect(LOADOUT_WEAPONS.includes(d), id).toBe(true);
      expect(d.damage.near, id).toBe(LAUNCHERS[id]!.blast.max);
    }
    expect(WEAPON_BY_ID.get('china_lake')).toMatchObject({ magazine: 2, mode: 'pump' });
    expect(WEAPON_BY_ID.get('rpg')).toMatchObject({ magazine: 1, reserve: 2 });
    // The LAW is the light one: quicker up and faster rocket, smaller blast than the RPG.
    expect(WEAPON_BY_ID.get('m72law')!.swapMs!).toBeLessThan(WEAPON_BY_ID.get('rpg')!.swapMs!);
    expect(LAUNCHERS.m72law!.speed).toBeGreaterThan(LAUNCHERS.rpg!.speed);
    expect(LAUNCHERS.m72law!.blast.radius).toBeLessThan(LAUNCHERS.rpg!.blast.radius);
    // The Stinger locks faster, carries fewer.
    expect(LAUNCHERS.stinger!.lock!.sec).toBeLessThan(LAUNCHERS.strela!.lock!.sec);
    expect(WEAPON_BY_ID.get('stinger')!.reserve).toBeLessThan(WEAPON_BY_ID.get('strela')!.reserve);
  });

  it('unlock levels spread over progression and every launcher is sold', () => {
    const levels = LAUNCHER_IDS.map((id) => WEAPON_BY_ID.get(id)!.unlockLevel).sort((a, b) => a - b);
    expect(new Set(levels).size).toBe(5);
    expect(levels[0]).toBeGreaterThan(1);
    expect(levels.at(-1)).toBeLessThanOrEqual(50);
    const table = unlockTable();
    const cat = storeCatalog();
    for (const id of LAUNCHER_IDS) {
      const d = WEAPON_BY_ID.get(id)!;
      expect(table.some((u) => u.kind === 'weapon' && u.id === id && u.level === d.unlockLevel), id).toBe(true);
      const item = cat.find((i) => i.key === keyOf.weapon(id));
      expect(item?.price, id).toBe(d.price);
      expect(item!.price, id).toBeGreaterThan(0);
      const p = newProfile('t', 't');
      p.level = d.unlockLevel - 1;
      expect(isUnlocked(p, 'weapon', id), id).toBe(false);
      p.level = d.unlockLevel;
      expect(isUnlocked(p, 'weapon', id), id).toBe(true);
    }
  });

  it('Pack-a-Punch rows: names, one distinct effect each, packed magazines', () => {
    expect(papName('china_lake')).toBe('China Beach');
    expect(papName('rpg')).toBe('Rocket Propelled Grievance');
    expect(papName('m72law')).toBe('M72 Anarchy');
    expect(papName('strela')).toBe('Strela-3 Upgraded');
    expect(papName('stinger')).toBe('Killer Bee');
    const kinds = LAUNCHER_IDS.map((id) => papEffect(id)!.kind);
    expect(new Set(kinds).size).toBe(5);
    for (const id of LAUNCHER_IDS) {
      expect(isPackable(id), id).toBe(true);
      expect(papEffectText(id).length, id).toBeGreaterThan(5);
      expect(PAP_WEAPONS[id], id).toBeDefined();
    }
    expect(packDef(effectiveWeapon(WEAPON_BY_ID.get('china_lake')!)).magazine).toBe(4);
    expect(packDef(effectiveWeapon(WEAPON_BY_ID.get('strela')!)).magazine).toBe(1);
  });

  it('bots sometimes carry launchers in their classes', () => {
    const r0 = rng(7);
    let n = 0;
    for (let i = 0; i < 400; i++) if (LAUNCHER_IDS.includes(chooseBotLoadout(0.6, r0).secondary.weapon)) n++;
    expect(n).toBeGreaterThan(20);
    expect(n).toBeLessThan(200);
  });
});

describe('launcher maths', () => {
  it('drift: none at launch, small, seeded, the RPG wanders more than the LAW', () => {
    expect(driftAngles(LAUNCHERS.rpg!.drift, 0, 0.3, 0.7)).toEqual({ yaw: 0, pitch: 0 });
    const a = driftAngles(LAUNCHERS.rpg!.drift, 1.2, 0.3, 0.7);
    expect(driftAngles(LAUNCHERS.rpg!.drift, 1.2, 0.3, 0.7)).toEqual(a);
    let rpg = 0;
    let law = 0;
    for (let t = 0; t < 3; t += 0.1) {
      rpg = Math.max(rpg, Math.abs(driftAngles(LAUNCHERS.rpg!.drift, t, 0.3, 0.7).yaw));
      law = Math.max(law, Math.abs(driftAngles(LAUNCHERS.m72law!.drift, t, 0.3, 0.7).yaw));
    }
    expect(rpg).toBeLessThan((2 * Math.PI) / 180);
    expect(law).toBeLessThan(rpg);
    const d = turnDir({ x: 0, y: 0, z: -1 }, 0.1, 0);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1);
    expect(d.x).toBeLessThan(0); // yaw + turns left (toward -x) looking down -z
  });

  it('arming, lock cone and progress, steering, lead, lob', () => {
    expect(isArmed('rpg', 9.9)).toBe(false);
    expect(isArmed('rpg', 10)).toBe(true);
    expect(isArmed('china_lake', 8)).toBe(true);
    const e = { x: 0, y: 0, z: 0 };
    expect(inLockCone(e, { x: 0, y: 0, z: -1 }, { x: 0, y: 5, z: -100 }, 7, 170)).toBe(true);
    expect(inLockCone(e, { x: 0, y: 0, z: -1 }, { x: 30, y: 0, z: -100 }, 7, 170)).toBe(false);
    expect(inLockCone(e, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: -200 }, 7, 170)).toBe(false);
    expect(lockProgress(10, 10.8, 1.6)).toBeCloseTo(0.5);
    expect(lockProgress(10, 13, 1.6)).toBe(1);
    const v = steerToward({ x: 0, y: 0, z: -40 }, e, { x: 100, y: 0, z: 0 }, 0.1);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(40);
    expect(Math.atan2(v.x, -v.z)).toBeCloseTo(0.1);
    expect(leadPoint(e, 40, { x: 0, y: 0, z: -40 }, { x: 10, y: 0, z: 0 }).x).toBeCloseTo(10);
    const p = lobPitch(34, 12, 25, 0)!;
    // The lob lands where asked: flat range of the arc at that pitch.
    const range = (34 * 34 * Math.sin(2 * p)) / 12;
    expect(range).toBeCloseTo(25, 0);
    expect(lobPitch(34, 12, 500, 0)).toBeNull();
    expect(clusterDirs(5, 0.2)).toHaveLength(5);
  });
});

describe('China Lake', () => {
  it('arcs, bounces once off the floor, then bursts on the next touch', () => {
    const room = setup();
    const a = still(bot(room, 0));
    place(a, -14, 20);
    arm(a, 'china_lake');
    // Lobbed at the floor 14 m out (the bots' lob): armed by then.
    a.move.ads = 1;
    expect(shoot(room, a, launcherAim('china_lake', eye(a), { x: 0, y: 0, z: 20 })).ok).toBe(true);
    const n = dataOf(room)[0]!;
    expect(n.w).toBe('china_lake');
    const booms = feats(room);
    let maxY = -Infinity;
    let bounced = -1;
    for (let i = 0; i < 300 && projs(room).length; i++) {
      room.step();
      maxY = Math.max(maxY, n.pos.y);
      if (n.bounced && bounced < 0) bounced = i;
    }
    expect(bounced).toBeGreaterThan(0); // the first touch bounced
    expect(projs(room)).toHaveLength(0);
    expect(booms.some((f) => f.id === 'weapons.boom' && (f.data as { e: string }).e === 'china_lake')).toBe(true);
    // An arc: it came down (the floor is at 0).
    expect(maxY).toBeGreaterThan(0.5);
  });

  it('a grenade that touches the floor before arming is a dud: no blast', () => {
    const room = setup();
    const a = still(bot(room, 0));
    place(a, -14, 20);
    arm(a, 'china_lake');
    const booms = feats(room);
    expect(shoot(room, a, { x: -11, y: 0, z: 20 }).ok).toBe(true); // 3 m ahead, straight down
    expect(until(room, () => dataOf(room)[0]?.dud === true, 2)).toBeLessThan(2);
    steps(room, 3);
    expect(booms.some((f) => f.id === 'weapons.boom')).toBe(false);
  });

  it('pump action: the second grenade waits for the pump; reloads one at a time', () => {
    const room = setup();
    const a = still(bot(room, 0));
    place(a, -14, 20);
    arm(a, 'china_lake');
    const w = a.weapons[1]!;
    w.credit = 1;
    w.lastShot = -99;
    expect(room.fire(a, { dir: viewDir(-Math.PI / 2, 0.3), shot: 1 }).ok).toBe(true);
    const second = room.fire(a, { dir: viewDir(-Math.PI / 2, 0.3), shot: 2 });
    expect(second.ok).toBe(false);
    steps(room, 60 / 55 + 0.05);
    expect(room.fire(a, { dir: viewDir(-Math.PI / 2, 0.3), shot: 3 }).ok).toBe(true);
    // Empty: the auto reload loads grenades one by one (shell reload).
    expect(w.mag).toBe(0);
    steps(room, 0.1);
    expect(a.reloadEnd).toBeGreaterThan(0);
    const sr = WEAPON_BY_ID.get('china_lake')!.shellReload!;
    steps(room, (sr.startMs + sr.perShellMs) / 1000 + 0.05);
    expect(w.mag).toBe(1);
    steps(room, sr.perShellMs / 1000);
    expect(w.mag).toBe(2);
  });
});

describe('rockets: arming, splash, self hit', () => {
  it('under 10 m an RPG is a dud: impact damage only, no blast', () => {
    const room = setup();
    const a = still(bot(room, 0));
    const v = still(bot(room, 1));
    place(a, -10, 20);
    place(v, -5, 20);
    arm(a, 'rpg');
    const dmg = damages(room);
    const booms = feats(room);
    expect(shoot(room, a, { x: v.move.x, y: v.move.y + 1.1, z: v.move.z }).ok).toBe(true);
    steps(room, 1);
    expect(v.alive).toBe(true);
    expect(dmg.filter((d) => d.victim === v)).toEqual([expect.objectContaining({ amount: LAUNCHERS.rpg!.impactDamage, means: 'impact', weapon: 'rpg' })]);
    expect(booms.some((f) => f.id === 'weapons.boom')).toBe(false);
  });

  it('armed, a direct hit kills and the splash reaches a neighbour', () => {
    const room = setup();
    const a = still(bot(room, 0));
    const v = still(bot(room, 1));
    const n = still(bot(room, 1));
    place(a, -14, 20);
    place(v, 6, 20);
    place(n, 6, 23); // 3 m from the impact: inside the RPG's kill radius
    expect(clearLine(room, eye(a), eye(v))).toBe(true);
    arm(a, 'rpg');
    const dead = deaths(room);
    expect(shoot(room, a, { x: v.move.x, y: v.move.y + 1.1, z: v.move.z }).ok).toBe(true);
    expect(until(room, () => projs(room).length === 0, 2)).toBeLessThan(2);
    expect(dead.map((d) => d.victim)).toEqual(expect.arrayContaining([v, n]));
    expect(dead.every((d) => d.weapon === 'rpg' && d.attacker === a && d.means === 'explosive')).toBe(true);
    expect(a.alive).toBe(true);
  });

  it('splash hurts the shooter: a blast at your feet after arming', () => {
    const room = setup();
    const a = still(bot(room, 0));
    place(a, -10, 20);
    const dmg = damages(room);
    // A rocket that has flown its arming distance comes down next to its owner.
    const e = spawnProj(room, a, 'm72law', { x: -12, y: 1, z: 20 }, { x: 1, y: -0.6, z: 0 }, { seed: 1 });
    (e.data as Proj).traveled = 30;
    steps(room, 0.5);
    const self = dmg.filter((d) => d.victim === a);
    expect(self.length).toBe(1);
    expect(self[0]).toMatchObject({ weapon: 'm72law', means: 'explosive' });
    expect(self[0]!.amount).toBeGreaterThan(30);
  });

  it('seeded drift: the same shot flies the same path; the RPG lands off the aim line a little', () => {
    const paths: Vec3[][] = [];
    for (let k = 0; k < 2; k++) {
      const room = setup();
      const a = still(bot(room, 0));
      place(a, -14, 20);
      arm(a, 'rpg');
      a.move.ads = 1;
      expect(shoot(room, a, null, { x: 1, y: 0.05, z: 0 }, 77).ok).toBe(true);
      const n = dataOf(room)[0]!;
      const pts: Vec3[] = [];
      for (let i = 0; i < 30; i++) {
        room.step();
        pts.push({ ...n.pos });
      }
      paths.push(pts);
      r!.close();
      r = undefined;
    }
    expect(paths[0]).toEqual(paths[1]);
    const end = paths[0]!.at(-1)!;
    expect(Math.abs(end.z - 20)).toBeGreaterThan(0.005);
    expect(Math.abs(end.z - 20)).toBeLessThan(1.2);
  });
});

describe('lock-on: air killstreaks only', () => {
  it('locks an enemy UAV after lock.sec of ADS; never a friendly one, a player or ground hardware', () => {
    const room = setup();
    const a = still(bot(room, 0));
    const enemy = still(bot(room, 1));
    const mate = still(bot(room, 0));
    place(a, 0, 20);
    place(enemy, 10, 20);
    arm(a, 'strela');
    a.move.ads = 1;
    const uav = aircraft(room, enemy);
    const sec = LAUNCHERS.strela!.lock!.sec;
    const track = () => face(a, toward(eye(a), { x: uav.x, y: uav.y, z: uav.z }));
    const msgs = feats(room);
    // Keep the UAV in the middle of the view for the lock time.
    let t = 0;
    while (t < sec - 0.1) {
      track();
      a.move.ads = 1;
      room.step();
      t += TICK_DT;
    }
    expect(lockOf(a).e).toBe(uav.id);
    expect(lockOf(a).locked).toBe(false);
    for (let i = 0; i < 9; i++) {
      track();
      a.move.ads = 1;
      room.step();
    }
    expect(lockOf(a).locked).toBe(true);
    // (The bot gets no message; a human would: see below.)
    expect(msgs.filter((m) => m.id === 'weapons.lock')).toHaveLength(0);

    // A friendly UAV: never.
    const b = still(bot(room, 1));
    place(b, 0, 18);
    arm(b, 'stinger');
    const mine = aircraft(room, enemy, 'counter_uav');
    for (let i = 0; i < 120; i++) {
      face(b, toward(eye(b), { x: mine.x, y: mine.y, z: mine.z }));
      b.move.ads = 1;
      room.step();
    }
    expect(lockOf(b).e).toBeNull();
    // A player in the cone: never.
    for (let i = 0; i < 120; i++) {
      face(b, toward(eye(b), eye(mate)));
      b.move.ads = 1;
      room.step();
    }
    expect(lockOf(b).e).toBeNull();
  });

  it('no ADS, no lock; the Stinger locks faster than the Strela; a human hears the lock', () => {
    const room = setup();
    const a = still(bot(room, 0));
    a.isBot = false;
    const enemy = still(bot(room, 1));
    place(a, 0, 20);
    arm(a, 'stinger');
    const uav = aircraft(room, enemy);
    const msgs = feats(room);
    for (let i = 0; i < 60; i++) {
      face(a, toward(eye(a), { x: uav.x, y: uav.y, z: uav.z }));
      a.move.ads = 0;
      room.step();
    }
    expect(lockOf(a).e).toBeNull();
    const t = until(room, () => {
      face(a, toward(eye(a), { x: uav.x, y: uav.y, z: uav.z }));
      a.move.ads = 1;
      return lockOf(a).locked;
    }, 4);
    expect(t).toBeGreaterThanOrEqual(LAUNCHERS.stinger!.lock!.sec - 0.05);
    expect(t).toBeLessThan(LAUNCHERS.stinger!.lock!.sec + 0.15);
    expect(t).toBeLessThan(LAUNCHERS.strela!.lock!.sec);
    const lockMsgs = msgs.filter((m) => m.id === 'weapons.lock' && m.to === a).map((m) => m.data as { e: number | null; locked: boolean });
    expect(lockMsgs[0]).toMatchObject({ e: uav.id, locked: false });
    expect(lockMsgs.at(-1)).toMatchObject({ e: uav.id, locked: true });
  });
});

describe('homing and shooting down', () => {
  it('a locked missile catches an orbiting UAV and shoots it down: score, XP, the owner told', () => {
    const room = setup();
    const a = still(bot(room, 0));
    const enemy = still(bot(room, 1));
    place(a, 0, 20);
    arm(a, 'strela');
    const uav = aircraft(room, enemy);
    const xp: { player: PlayerState; amount: number; label: string }[] = [];
    room.bus.on('progression.xp', (e) => xp.push(e));
    const destroyed: string[] = [];
    room.bus.on('killstreaks.destroyed', (e) => destroyed.push(e.id));
    const msgs = feats(room);
    expect(until(room, () => {
      face(a, toward(eye(a), { x: uav.x, y: uav.y, z: uav.z }));
      a.move.ads = 1;
      return lockOf(a).locked;
    }, 4)).toBeLessThan(4);
    const score = a.stats.score;
    const from = { x: uav.x, z: uav.z };
    expect(shoot(room, a, { x: uav.x, y: uav.y, z: uav.z }).ok).toBe(true);
    const m = dataOf(room)[0]!;
    expect(m.target).toBe(uav.id);
    expect(until(room, () => !room.entities.get(uav.id), 8)).toBeLessThan(8);
    // It had moved on its orbit meanwhile: the missile turned to follow it.
    expect(Math.hypot(uav.x - from.x, uav.z - from.z)).toBeGreaterThan(3);
    expect(destroyed).toEqual(['uav']);
    expect(a.stats.score - score).toBe(100);
    expect(xp).toEqual([expect.objectContaining({ player: a, amount: 100, label: 'SPY PLANE DESTROYED' })]);
    const shotDown = msgs.find((x) => x.id === 'killstreaks.shotDown')?.data;
    expect(shotDown).toMatchObject({ id: 'uav', name: 'Spy Plane', owner: enemy.id, by: a.id, xp: 100 });
    const ended = msgs.find((x) => x.id === 'killstreaks.ended')?.data;
    expect(ended).toMatchObject({ id: 'uav', destroyed: true, by: a.id });
  });

  it('an attack helicopter takes two missiles; a dumb RPG hit counts for one', () => {
    const room = setup();
    const a = still(bot(room, 0));
    const enemy = still(bot(room, 1));
    place(a, 0, 20);
    const heli = aircraft(room, enemy, 'attack_helicopter');
    const hp = ksRoom(room).hp.get(heli.id)!;
    expect(hp.hp).toBe(1500);
    // An armed RPG meeting it (launched just inside its hit sphere: it can't miss).
    const e = spawnProj(room, a, 'rpg', { x: heli.x, y: heli.y, z: heli.z + 1 }, { x: 0, y: 0, z: -1 }, { seed: 3 });
    (e.data as Proj).traveled = 20;
    room.step();
    expect(hp.hp).toBe(1500 - LAUNCHERS.rpg!.airDamage);
    expect(room.entities.get(heli.id)).toBeDefined();
  });

  it('bullets damage the UAV and the helicopter too (BO1)', () => {
    const room = setup();
    const a = still(bot(room, 0));
    const enemy = still(bot(room, 1));
    place(a, 0, 20);
    const uav = aircraft(room, enemy);
    const hp = ksRoom(room).hp.get(uav.id)!;
    const before = hp.hp;
    ksRoom(room).onFire(a, 'ak47', eye(a), toward(eye(a), { x: uav.x, y: uav.y, z: uav.z }), { x: uav.x, y: uav.y, z: uav.z });
    expect(hp.hp).toBeLessThan(before);
  });

  it('the Care Package chopper can be shot down; its crate falls where it was', () => {
    const room = setup();
    const a = still(bot(room, 0));
    const enemy = still(bot(room, 1));
    place(a, 0, 20);
    enemy.ext.killstreaks!.ready.push('care_package');
    expect(callKillstreak(room, enemy, 'care_package', { target: { x: 10, y: 0, z: 10 } }).ok).toBe(true);
    const heli = room.entities.byKind(KS_ENTITY.dropHeli)[0]!;
    expect(ksRoom(room).hp.get(heli.id)?.air).toBe(true);
    const shotDown: unknown[] = [];
    room.bus.on('killstreaks.destroyed', (e) => shotDown.push(e.kind));
    ksRoom(room).hurtEntity(heli.id, 5000, a);
    expect(shotDown).toEqual([KS_ENTITY.dropHeli]);
    expect(room.entities.get(heli.id)).toBeUndefined();
    expect(cratesOf(ksRoom(room))).toHaveLength(1);
  });
});

describe('perks', () => {
  it('Scavenger packs refill guns but not launchers (BO1)', () => {
    const room = setup();
    const a = still(bot(room, 0));
    arm(a, 'rpg');
    a.weapons[1]!.reserve = 0;
    a.weapons[0]!.reserve = 0;
    resupply(room, a);
    expect(a.weapons[0]!.reserve).toBeGreaterThan(0);
    expect(a.weapons[1]!.reserve).toBe(0);
  });
});

describe('Pack-a-Punch launchers', () => {
  it('China Beach: four in the tube, the grenade bursts into bomblets', () => {
    const room = setup();
    const a = still(bot(room, 0));
    place(a, -14, 20);
    arm(a, 'china_lake', true);
    expect(a.weapons[1]!.mag).toBe(4);
    const booms = feats(room);
    const e = spawnProj(room, a, 'china_lake', { x: 0, y: 0.5, z: 20 }, { x: 0, y: -1, z: 0 }, { packed: true, seed: 5 });
    (e.data as Proj).traveled = 20;
    (e.data as Proj).bounced = true;
    steps(room, 0.2);
    expect(projs(room).filter((x) => x.s?.c === 1)).toHaveLength(5);
    steps(room, 2);
    expect(booms.filter((f) => f.id === 'weapons.boom' && (f.data as { e: string }).e === 'china_lake.bomblet').length).toBe(5);
  });

  it('Rocket Propelled Grievance: the blast leaves burning ground that hurts (fire)', () => {
    const room = setup();
    const a = still(bot(room, 0));
    const v = still(bot(room, 1));
    place(a, -14, 20);
    place(v, -14, 12);
    arm(a, 'rpg', true);
    const dmg = damages(room);
    const e = spawnProj(room, a, 'rpg', { x: 6, y: 1, z: 20 }, { x: 0, y: -1, z: 0 }, { packed: true, seed: 2 });
    (e.data as Proj).traveled = 20;
    steps(room, 0.2);
    expect(room.entities.byKind(KS_ENTITY.fire)).toHaveLength(1);
    v.health = v.maxHealth = 10000;
    place(v, 6, 20);
    steps(room, 1);
    expect(dmg.some((d) => d.victim === v && d.means === 'fire' && d.weapon === 'rpg')).toBe(true);
    steps(room, 5);
    expect(room.entities.byKind(KS_ENTITY.fire)).toHaveLength(0);
  });

  it('M72 Anarchy: an armed rocket bursts beside an enemy it passes', () => {
    const room = setup();
    const a = still(bot(room, 0));
    const v = still(bot(room, 1));
    place(a, -14, 20);
    place(v, 4, 21.8); // 1.8 m off the line
    arm(a, 'm72law', true);
    const dead = deaths(room);
    a.move.ads = 1;
    expect(shoot(room, a, null, { x: 1, y: 0, z: 0 }, 9).ok).toBe(true);
    steps(room, 1);
    expect(dead.map((d) => d.victim)).toContain(v);
    // A plain LAW down the same line flies past.
    const v2 = still(bot(room, 1));
    place(v2, 4, 21.8);
    arm(a, 'm72law');
    const before = dead.length;
    expect(shoot(room, a, null, { x: 1, y: 0, z: 0 }, 9).ok).toBe(true);
    steps(room, 1);
    expect(dead.slice(before).map((d) => d.victim)).not.toContain(v2);
  });

  it('Strela-3 Upgraded: half the lock time and two homing missiles per shot', () => {
    const room = setup();
    const a = still(bot(room, 0));
    const enemy = still(bot(room, 1));
    place(a, 0, 20);
    arm(a, 'strela', true);
    const uav = aircraft(room, enemy);
    const t = until(room, () => {
      face(a, toward(eye(a), { x: uav.x, y: uav.y, z: uav.z }));
      a.move.ads = 1;
      return lockOf(a).locked;
    }, 4);
    expect(t).toBeLessThan(LAUNCHERS.strela!.lock!.sec * 0.5 + 0.15);
    expect(shoot(room, a, { x: uav.x, y: uav.y, z: uav.z }).ok).toBe(true);
    expect(dataOf(room).filter((n) => n.target === uav.id)).toHaveLength(2);
  });

  it('Killer Bee: a hit bursts into flak that hurts the other aircraft nearby', () => {
    const room = setup();
    const a = still(bot(room, 0));
    const enemy = still(bot(room, 1));
    place(a, 0, 20);
    const uav = aircraft(room, enemy);
    const cuav = aircraft(room, enemy, 'counter_uav');
    // Park the counter-UAV next to the UAV (both hold still).
    const ctx = ksRoom(room);
    for (const act of ctx.actives) act.update = () => true;
    const hpC = ctx.hp.get(cuav.id)!;
    cuav.x = uav.x + 6;
    cuav.y = uav.y;
    cuav.z = uav.z;
    const e = spawnProj(room, a, 'stinger', { x: uav.x, y: uav.y, z: uav.z + 1 }, { x: 0, y: 0, z: -1 }, { packed: true, seed: 4 });
    (e.data as Proj).traveled = 50;
    room.step();
    room.step();
    expect(room.entities.get(uav.id)).toBeUndefined();
    expect(hpC.hp).toBeLessThan(hpC.max);
  });
});

describe('bots and launchers', () => {
  it('a bot with a Strela shoots down an enemy UAV (switch, ADS, lock, fire)', () => {
    withSeed(11, () => {
      const room = setup();
      const b = bot(room, 0);
      const enemy = still(bot(room, 1));
      place(enemy, 25, -20);
      place(b, 0, 20);
      arm(b, 'strela');
      b.slot = 0;
      const brain = new Brain({ ...BOT_DIFFICULTY_BY_ID.get('veteran')!.skill }, { fights: [] }, rng(3));
      brain.onSpawn(b, room.time, room);
      b.brain = brain;
      const uav = aircraft(room, enemy);
      expect(until(room, () => !room.entities.get(uav.id), 25)).toBeLessThan(25);
      expect(brain.airShots).toBeGreaterThanOrEqual(1);
    });
  });

  it('airTargetFor: lock-on takes planes, dumb rockets only helicopters in reach, never the China Lake', () => {
    const room = setup();
    const a = still(bot(room, 0));
    const enemy = still(bot(room, 1));
    place(a, 0, 20);
    aircraft(room, enemy);
    expect(airTargetFor(room, a, 'strela', eye(a))).not.toBeNull();
    expect(airTargetFor(room, a, 'rpg', eye(a))).toBeNull();
    expect(airTargetFor(room, a, 'china_lake', eye(a))).toBeNull();
    aircraft(room, enemy, 'attack_helicopter');
    const h = airTargetFor(room, a, 'rpg', eye(a));
    expect(h === null || room.entities.get(h.id)?.kind === KS_ENTITY.heli).toBe(true);
  });

  it('never point blank; rockets for clustered or camping targets at range; feet and lobs', () => {
    const room = setup();
    const a = still(bot(room, 0));
    const v = still(bot(room, 1));
    const v2 = still(bot(room, 1));
    place(a, -14, 20);
    place(v, -9, 20);
    place(v2, 20, -20);
    arm(a, 'rpg');
    const e = eye(a);
    expect(launcherBotPlan(room, a, 'rpg', v, 5, e, v.move)).toBe('switch');
    a.weapons[0]!.mag = a.weapons[0]!.reserve = 0;
    expect(launcherBotPlan(room, a, 'rpg', v, 5, e, v.move)).toBe('hold');
    a.weapons[0]!.mag = 30;
    // A lone runner at 22 m: not worth it; with a friend beside it: fire.
    place(v, 8, 20);
    v.move.vx = 5;
    expect(clusteredWith(room, a, v)).toBe(0);
    expect(launcherBotPlan(room, a, 'rpg', v, 22, e, v.move)).toBe('switch');
    place(v2, 8, 22);
    expect(clusteredWith(room, a, v)).toBe(1);
    expect(launcherBotPlan(room, a, 'rpg', v, 22, e, v.move)).toBe('fire');
    // Rockets go at the feet; the China Lake goes up.
    const feet = { x: 8, y: 0, z: 20 };
    expect(launcherAim('rpg', e, feet).y).toBeLessThan(e.y);
    expect(launcherAim('china_lake', e, feet).y).toBeGreaterThan(e.y);
  });

  it('a bot holding an RPG never fires at an enemy 5 m away (it switches to the rifle)', () => {
    withSeed(5, () => {
      const room = setup();
      const b = bot(room, 0);
      const v = still(bot(room, 1));
      place(b, -10, 20);
      place(v, -5, 20);
      b.yaw = -Math.PI / 2;
      arm(b, 'rpg');
      const brain = new Brain({ ...BOT_DIFFICULTY_BY_ID.get('veteran')!.skill }, { fights: [] }, rng(9));
      brain.onSpawn(b, room.time, room);
      b.brain = brain;
      b.slot = 1;
      (brain as unknown as { slotWanted: number }).slotWanted = 1;
      const seen = new Set<number>();
      for (let i = 0; i < 180; i++) {
        room.step();
        for (const p of projs(room)) seen.add(p.id);
      }
      expect(seen.size).toBe(0);
    });
  });
});

describe('launch helper', () => {
  it('the lock is taken by the shot and starts over', () => {
    const room = setup();
    const a = still(bot(room, 0));
    const enemy = still(bot(room, 1));
    place(a, 0, 20);
    arm(a, 'stinger');
    const uav = aircraft(room, enemy);
    until(room, () => {
      face(a, toward(eye(a), { x: uav.x, y: uav.y, z: uav.z }));
      a.move.ads = 1;
      return lockOf(a).locked;
    }, 4);
    const out = launch(room, a, a.weapons[1]!, { origin: eye(a), dir: toward(eye(a), { x: uav.x, y: uav.y, z: uav.z }), shot: 1 });
    expect((out[0]!.data as Proj).target).toBe(uav.id);
    expect(out[0]!.s?.h).toBe(1);
    expect(lockOf(a).locked).toBe(false);
    void aim;
  });
});
