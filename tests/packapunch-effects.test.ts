/**
 * Pack-a-Punch signature effects, rules level (a Yard TDM room stepped tick by tick, bots as the
 * shooters, so every effect is shown working for bots too): the data (every packed gun has an
 * effect and a one-liner; the toast line), then one test per effect kind through real hitscan:
 * piercing hits two in a line, collateral through three, burn ticks and its kill credit, the
 * ricochet path, marking (radar / visibility), the exploding headshot, the seeded chain zap, frost on
 * hit, the shatter damage boost, the knockback impulse, stagger on bots, the shockwave, the stat-only
 * effects in the def (laser, dual wield, flechettes, double-tap), the launcher and shotgun ammo, the
 * wonder weapon touches, and the killfeed's packed name.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { callKillstreak } from '../src/server/features/killstreaks/api';
import killstreaks from '../src/server/features/killstreaks/index';
import { grant, ksOf } from '../src/server/features/killstreaks/state';
import { papBurning, papMarked, papShatter, setPapRng } from '../src/server/features/killstreaks/streaks/packapunch-effects';
import { endPapBuff } from '../src/server/features/killstreaks/streaks/packapunch';
import perks from '../src/server/features/perks/index';
import pickups from '../src/server/features/pickups/index';
import weapons from '../src/server/features/weapons/index';
import { frostOf } from '../src/server/features/weapons/wonder/index';
import { switchWeapon } from '../src/server/combat';
import { Lobby } from '../src/server/lobby';
import { makeWeapon, type PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { Store } from '../src/server/store';
import { PLAYER, TICK_DT, type Team } from '../src/shared/constants';
import { effectiveWeapon } from '../src/shared/defs/attachments';
import { isPackable, PACK_A_PUNCH, packDef, papEffect, papEffectOf, papEffectText, papName, papToastLine, PAP_ID, PAP_WEAPONS } from '../src/shared/defs/pack-a-punch';
import { burnPerTick, knockImpulse, MASTERKEY_ID, PAP_FX, pierceOf, reflect } from '../src/shared/defs/pap-effects';
import { WEAPON_BY_ID, WEAPONS } from '../src/shared/defs/weapons';
import { WONDER_ENTITY } from '../src/shared/defs/wonder';
import { cloneLoadout, DEFAULT_LOADOUTS, type Loadout } from '../src/shared/loadout';
import { normalize, type Vec3 } from '../src/shared/math';
import { createMoveState } from '../src/shared/movement';
import type { ServerMsg } from '../src/shared/protocol';

let store: Store | undefined;
let lobby: Lobby | undefined;
afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = undefined;
  store = undefined;
});

function setup(): Room {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: [weapons, perks, killstreaks, pickups], log: () => {}, autoTick: false });
  const room = lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false });
  room.modifiers.add('regenDelayMultiplier', () => 1000, 'test.noregen');
  return room;
}

const loadout = (primary: string): Loadout => ({ ...cloneLoadout(DEFAULT_LOADOUTS[0]!), primary: { weapon: primary, attachments: [], camo: 'none' }, perks: [], killstreaks: ['uav', 'pack_a_punch', 'attack_dogs'] });

/** A bot standing still (manual streaks). */
function bot(room: Room, team: Team, primary = 'ak47'): PlayerState {
  const p = room.addBot({ team, loadout: loadout(primary) });
  p.brain = { think: (_r, self) => ({ buttons: 0, yaw: self.yaw, pitch: self.pitch, weaponSlot: self.slot }) };
  ksOf(p).manual = true;
  if (!p.alive) room.spawn(p);
  return p;
}
const place = (p: PlayerState, x: number, z: number, y = 0) => {
  p.move = { ...createMoveState(x, y, z), onGround: true };
  p.yaw = 0;
  p.pitch = 0;
};
const steps = (room: Room, sec: number) => {
  for (let i = 0; i < Math.round(sec / TICK_DT); i++) room.step();
};
function packNow(room: Room, p: PlayerState): void {
  grant(room, p, PAP_ID);
  expect(callKillstreak(room, p, PAP_ID)).toEqual({ ok: true });
  steps(room, PACK_A_PUNCH.durationSec + 0.1);
  expect(p.weapons[p.slot]!.pap).toBe(true);
}
/** Fire `a`'s gun in hand from where it stands at a point (aimed, so the seeded spread is tiny). */
function shootAt(room: Room, a: PlayerState, at: Vec3, shot = 1): void {
  a.move.ads = 1;
  a.swapEnd = 0;
  a.reloadEnd = 0;
  const w = a.weapons[a.slot]!;
  w.credit = 2;
  w.burstCount = 0;
  w.lastShot = -99;
  const eye = { x: a.move.x, y: a.move.y + PLAYER.eye, z: a.move.z };
  const r = room.fire(a, { dir: normalize({ x: at.x - eye.x, y: at.y - eye.y, z: at.z - eye.z }), shot });
  expect(r.ok, JSON.stringify(r)).toBe(true);
}
const chestOf = (p: PlayerState): Vec3 => ({ x: p.move.x, y: p.move.y + 1.2, z: p.move.z });
const headOf = (p: PlayerState): Vec3 => ({ x: p.move.x, y: p.move.y + 1.68, z: p.move.z });

describe('Pack-a-Punch effect data', () => {
  it('every packable gun has a signature effect and a menu one-liner; the toast line names both', () => {
    for (const w of WEAPONS) {
      if (!isPackable(w.id)) continue;
      expect(papEffect(w.id), w.id).toBeTruthy();
      expect(papEffectText(w.id).length, w.id).toBeGreaterThan(3);
    }
    expect(papToastLine('ak47')).toBe("Reznov's Revenge: incendiary rounds");
    expect(papEffectOf('m1911', 'explosive')).toMatchObject({ radius: 3, max: 30, min: 10 });
    // Varied on purpose: no single kind on more than a handful of guns (burn has three: the AK-47,
    // the Olympia's dragon's breath and the SAW's incendiary rounds).
    const kinds = new Map<string, number>();
    for (const row of Object.values(PAP_WEAPONS)) if (row.effect && row.effect.kind !== 'wonder') kinds.set(row.effect.kind, (kinds.get(row.effect.kind) ?? 0) + 1);
    expect(Math.max(...kinds.values())).toBeLessThanOrEqual(3);
    expect([...kinds.values()].filter((n) => n > 2)).toHaveLength(1);
    expect(kinds.size).toBeGreaterThanOrEqual(16);
  });

  it('pure maths: reflect, the knockback falloff, burn per tick, pierce specs', () => {
    expect(reflect({ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 })).toEqual({ x: -1, y: 0, z: 0 });
    const r = reflect(normalize({ x: 1, y: 0, z: 1 }), { x: -1, y: 0, z: 0 });
    expect(r.x).toBeCloseTo(-Math.SQRT1_2);
    expect(r.z).toBeCloseTo(Math.SQRT1_2);
    const kb = papEffectOf('spas12', 'knockback')!;
    expect(knockImpulse(kb, { x: 1, y: 0, z: 0 }, 0)!.x).toBeCloseTo(kb.push);
    expect(knockImpulse(kb, { x: 1, y: 0, z: 0 }, kb.range / 2)!.x).toBeCloseTo(kb.push / 2);
    expect(knockImpulse(kb, { x: 1, y: 0, z: 0 }, kb.range + 1)).toBeNull();
    const burn = papEffectOf('ak47', 'burn')!;
    expect(burnPerTick(burn) * (burn.sec / PAP_FX.burnTick)).toBeCloseTo(15);
    expect(pierceOf(papEffect('intervention')).keep).toBe(1);
    expect(pierceOf(papEffect('m16')).bodies).toBe(1);
    expect(pierceOf(papEffect('ak47')).bodies).toBe(0);
  });

  it('stat-only effects live in the packed def: laser, dual wield, flechettes, double-tap', () => {
    const laser = packDef(effectiveWeapon(WEAPON_BY_ID.get('ak74u')!));
    expect(laser.spread.hip).toBe(laser.spread.ads);
    expect(laser.recoil.vertical).toBe(0);
    expect(laser.recoil.horizontal).toBe(0);
    expect(laser.recoil.recovery).toBeGreaterThan(0);
    const mpl = effectiveWeapon(WEAPON_BY_ID.get('mpl')!);
    const dual = packDef(mpl);
    expect(dual.magazine).toBe(mpl.magazine * 2);
    expect(dual.rpm).toBeCloseTo(mpl.rpm * 1.6);
    const so = effectiveWeapon(WEAPON_BY_ID.get('stakeout')!);
    const raid = packDef(so);
    expect(raid.spread.hip).toBeLessThan(so.spread.hip * 0.5);
    expect(raid.damage.farRange).toBeGreaterThan(so.damage.farRange * 2);
    const asp = packDef(effectiveWeapon(WEAPON_BY_ID.get('asp')!));
    expect(asp).toMatchObject({ mode: 'burst', burst: 2 });
    expect(asp.magazine % 2).toBe(0);
    expect(packDef(effectiveWeapon(WEAPON_BY_ID.get('m16')!)).penetration).toBe('large');
  });
});

describe('Pack-a-Punch effects in play', () => {
  it('piercing (Skullpiercer): one bullet hits two bodies in a line; plain it stops on the first', () => {
    const room = setup();
    const a = bot(room, 0, 'm16');
    const v1 = bot(room, 1);
    const v2 = bot(room, 1);
    const line = () => {
      place(a, -10, 20);
      place(v1, 0, 20);
      place(v2, 6, 20);
      v1.health = v2.health = 100;
    };
    line();
    shootAt(room, a, chestOf(v1));
    expect(v1.health).toBeLessThan(100);
    expect(v2.health).toBe(100);
    packNow(room, a);
    line();
    shootAt(room, a, chestOf(v1), 2);
    const d1 = 100 - v1.health;
    const d2 = 100 - v2.health;
    expect(d1).toBeGreaterThan(0);
    expect(d2).toBeCloseTo(d1 * papEffectOf('m16', 'pierce')!.keep, 1);
  });

  it('collateral (Divine Intervention): every body in the line at full damage', () => {
    const room = setup();
    const a = bot(room, 0, 'intervention');
    const vs = [bot(room, 1), bot(room, 1), bot(room, 1)];
    packNow(room, a);
    place(a, -12, 20);
    vs.forEach((v, i) => {
      place(v, -2 + i * 4, 20);
      v.health = 1000; // see the damage, not the kill
    });
    // Level at head height, so every body is hit in the same place.
    shootAt(room, a, { x: 100, y: PLAYER.eye, z: 20 });
    const dealt = vs.map((v) => 1000 - v.health);
    expect(dealt[0]).toBeGreaterThan(50);
    for (const d of dealt) expect(d).toBeCloseTo(dealt[0]!, 0);
  });

  it("burn (Reznov's Revenge): 15 over 2 s after a hit, refreshed by the next, and a burn kill is the shooter's", () => {
    const room = setup();
    const a = bot(room, 0, 'ak47');
    const v = bot(room, 1);
    packNow(room, a);
    place(a, -10, 20);
    place(v, 10, 20);
    v.health = 1000;
    shootAt(room, a, chestOf(v));
    const afterHit = v.health;
    expect(papBurning(room, v)).toBe(true);
    steps(room, 2.2);
    expect(afterHit - v.health).toBeCloseTo(15, 3);
    expect(papBurning(room, v)).toBe(false);
    // Refresh: a hit at 1 s keeps it burning to 3 s, never stacking past one burn at a time.
    shootAt(room, a, chestOf(v), 2);
    steps(room, 1);
    shootAt(room, a, chestOf(v), 3);
    const at = v.health;
    steps(room, 2.2);
    expect(at - v.health).toBeCloseTo(15, 0);
    // A burn kill: credited to the shooter with the packed gun (means fire).
    const deaths: { attacker: string | null; weapon: string; means: string }[] = [];
    room.bus.on('death', (e) => deaths.push({ attacker: e.attacker?.id ?? null, weapon: e.weapon, means: e.means }));
    v.health = 1000;
    shootAt(room, a, chestOf(v), 4);
    v.health = 3;
    const kills = a.stats.kills;
    steps(room, 1);
    expect(v.alive).toBe(false);
    expect(deaths).toEqual([{ attacker: a.id, weapon: 'ak47', means: 'fire' }]);
    expect(a.stats.kills).toBe(kills + 1);
  });

  it('ricochet (Lamentation): a bullet that hits a wall bounces once and hits for half', () => {
    const room = setup();
    const a = bot(room, 0, 'galil');
    const v = bot(room, 1);
    packNow(room, a);
    // Find a wall in the Yard to bounce off and stand the target on the reflected line.
    const from = { x: -10, y: 0, z: 20 };
    let plan: { aim: Vec3; target: Vec3 } | null = null;
    for (let i = 0; i < 72 && !plan; i++) {
      const yaw = (i / 72) * Math.PI * 2;
      const eye = { x: from.x, y: PLAYER.eye, z: from.z };
      const d = { x: Math.cos(yaw), y: -0.02, z: Math.sin(yaw) };
      const hit = room.world.raycast(eye, normalize(d), 25, 'bullets');
      if (!hit || hit.t < 4 || Math.abs(hit.normal.y) > 0.1) continue;
      const r = normalize(reflect(normalize(d), hit.normal));
      const target = { x: hit.point.x + r.x * 5, y: hit.point.y + r.y * 5, z: hit.point.z + r.z * 5 };
      const g = room.world.groundBelow(target.x, target.z, target.y + 0.5, 3);
      if (g === null || Math.abs(g) > 0.05 || !room.world.lineOfSight(hit.point, { x: target.x, y: target.y, z: target.z }, 'bullets')) continue;
      if (room.world.raycast(hit.point, r, 6, 'bullets')) continue;
      if (!room.world.free(target.x, 0, target.z)) continue;
      plan = { aim: hit.point, target: { x: target.x, y: target.y - 1.2, z: target.z } };
    }
    expect(plan).toBeTruthy();
    place(a, from.x, from.z);
    place(v, plan!.target.x, plan!.target.z);
    v.health = 1000;
    const ricos: { a: number[]; b: number[]; hit: boolean }[] = [];
    const send = room.sendFeature.bind(room);
    room.sendFeature = ((to, id, data) => {
      if (id === 'killstreaks.papFx' && (data as { k: string }).k === 'rico') ricos.push(data as never);
      send(to, id, data);
    }) as typeof room.sendFeature;
    shootAt(room, a, plan!.aim);
    expect(ricos).toHaveLength(1);
    expect(ricos[0]!.hit).toBe(true);
    const def = a.weapons[0]!.def;
    const dealt = 1000 - v.health;
    expect(dealt).toBeGreaterThan(0);
    // Half of a packed body hit at that distance (and never more than half a head shot).
    expect(dealt).toBeLessThanOrEqual(def.damage.near * def.multipliers.head * 1.5 * 0.5 + 1e-6);
  });

  it('marking (Predator): a hit target is visible to the shooter (radar, outline) for 5 s, only to them', () => {
    const room = setup();
    const a = bot(room, 0, 'commando');
    const mate = bot(room, 0);
    const v = bot(room, 1);
    packNow(room, a);
    place(a, -10, 20);
    place(mate, -10, 24);
    place(v, 10, 20);
    v.health = 1000;
    expect(papMarked(room, a, v)).toBe(false);
    shootAt(room, a, chestOf(v));
    expect(papMarked(room, a, v)).toBe(true);
    expect(papMarked(room, mate, v)).toBe(false);
    expect(room.modifiers.any('radarVisible', v, a)).toBe(true);
    steps(room, 4.8);
    expect(papMarked(room, a, v)).toBe(true);
    steps(room, 0.4);
    expect(papMarked(room, a, v)).toBe(false);
    // A mark doesn't outlive the target's life.
    shootAt(room, a, chestOf(v), 2);
    room.kill(v, a, { weapon: 'ak47', means: 'bullet' });
    room.spawn(v);
    expect(papMarked(room, a, v)).toBe(false);
  });

  it('exploding headshots (Skullsplitter): a head kill bursts and hurts the enemy beside them', () => {
    const room = setup();
    const a = bot(room, 0, 'm16a4');
    const v = bot(room, 1);
    const near = bot(room, 1);
    const far = bot(room, 1);
    packNow(room, a);
    place(a, -10, 20);
    place(v, 10, 20);
    place(near, 10, 21.5);
    place(far, 10, 28);
    v.health = 1;
    near.health = far.health = 100;
    const hits: { victim: string; weapon: string; means: string }[] = [];
    room.bus.on('damage', (e) => hits.push({ victim: e.victim.id, weapon: e.weapon, means: e.means }));
    shootAt(room, a, headOf(v));
    expect(v.alive).toBe(false);
    expect(near.health).toBeLessThan(100);
    expect(far.health).toBe(100);
    expect(hits).toContainEqual({ victim: near.id, weapon: 'm16a4', means: 'explosive' });
    // A body kill doesn't burst.
    place(v, 10, 20);
    room.spawn(v);
    place(v, 10, 20);
    v.health = 1;
    near.health = 100;
    shootAt(room, a, { x: 10, y: 0.9, z: 20 }, 2);
    expect(v.alive).toBe(false);
    expect(near.health).toBe(100);
  });

  it('chain zap (MP115 Kollider): a seeded roll arcs 15 to the nearest other enemy within 4 m', () => {
    const room = setup();
    const a = bot(room, 0, 'mp5k');
    const v = bot(room, 1);
    const n = bot(room, 1);
    const out = bot(room, 1);
    packNow(room, a);
    place(a, -10, 20);
    place(v, 10, 20);
    place(n, 10, 23);
    place(out, 10, 30);
    v.health = n.health = out.health = 1000;
    setPapRng(room, () => 0.99); // a miss
    shootAt(room, a, chestOf(v));
    expect(v.health).toBeLessThan(1000);
    expect(n.health).toBe(1000);
    setPapRng(room, () => 0.1); // under 25%: zap
    shootAt(room, a, chestOf(v), 2);
    expect(n.health).toBeCloseTo(1000 - 15, 5); // effect damage is final (no packed multiplier)
    expect(out.health).toBe(1000);
  });

  it('frost rounds (Iceburg): a hit that does not kill freezes solid, then it thaws', () => {
    const room = setup();
    const a = bot(room, 0, 'l96a1');
    const v = bot(room, 1);
    packNow(room, a);
    place(a, -10, 20);
    place(v, 10, 20);
    v.health = 1000;
    shootAt(room, a, chestOf(v));
    expect(frostOf(v)).toBe(1);
    expect(room.modifiers.any('canFire', v)).toBe(false);
    const fz = papEffectOf('l96a1', 'frost')!.frozenSec;
    steps(room, fz + 0.1);
    expect(frostOf(v)).toBeLessThan(1);
    expect(room.modifiers.any('canFire', v)).not.toBe(false);
  });

  it('shatter rounds (D115 Disassembler): +25% damage from everyone for 4 s', () => {
    const room = setup();
    const a = bot(room, 0, 'dragunov');
    const other = bot(room, 0);
    const v = bot(room, 1);
    packNow(room, a);
    place(a, -10, 20);
    place(v, 10, 20);
    v.health = 1000;
    shootAt(room, a, chestOf(v));
    expect(papShatter(room, v)).toBe(1.25);
    let h = v.health;
    room.damage({ victim: v, attacker: other, amount: 20, weapon: 'mp5k', part: 'torso', means: 'bullet', from: null, distance: 5 });
    expect(h - v.health).toBeCloseTo(25);
    steps(room, 4.1);
    h = v.health;
    room.damage({ victim: v, attacker: other, amount: 20, weapon: 'mp5k', part: 'torso', means: 'bullet', from: null, distance: 5 });
    expect(h - v.health).toBeCloseTo(20);
  });

  it('knockback (SPAZ-24): a close hit shoves the target back along the shot; far ones are not shoved', () => {
    const room = setup();
    const a = bot(room, 0, 'spas12');
    const v = bot(room, 1);
    packNow(room, a);
    place(a, -10, 20);
    place(v, -7, 20);
    v.health = 1000;
    shootAt(room, a, chestOf(v));
    expect(v.move.knock).toBeGreaterThan(0);
    expect(v.move.vx).toBeGreaterThan(2);
    place(v, 0, 20);
    v.health = 1000;
    shootAt(room, a, chestOf(v), 2);
    expect(v.move.knock).toBe(0);
  });

  it('stagger (ACR Annihilator): bots flinch harder and aim worse for a moment', () => {
    const room = setup();
    const a = bot(room, 0, 'acr');
    const v = bot(room, 1);
    packNow(room, a);
    place(a, -10, 20);
    place(v, 10, 20);
    v.health = 1000;
    expect(room.modifiers.mul('flinchMultiplier', v)).toBe(1);
    shootAt(room, a, chestOf(v));
    const s = papEffectOf('acr', 'stagger')!;
    expect(room.modifiers.mul('flinchMultiplier', v)).toBe(s.botFlinch);
    expect(room.modifiers.sum('botSkillOffset', v, 'aimErrorDeg')).toBe(s.botAimDeg);
    steps(room, s.sec + 0.05);
    expect(room.modifiers.mul('flinchMultiplier', v)).toBe(1);
  });

  it('shockwave (R115 Resonator): a kill shoves and slows enemies within 3 m of the body', () => {
    const room = setup();
    const a = bot(room, 0, 'rpk');
    const v = bot(room, 1);
    const near = bot(room, 1);
    packNow(room, a);
    place(a, -10, 20);
    place(v, 10, 20);
    place(near, 11.5, 21);
    v.health = 1;
    shootAt(room, a, chestOf(v));
    expect(v.alive).toBe(false);
    expect(near.move.knock).toBeGreaterThan(0);
    expect(near.move.vx).toBeGreaterThan(0);
    expect(room.modifiers.mul('speedMultiplier', near)).toBeLessThan(1);
    steps(room, 1.6);
    expect(room.modifiers.mul('speedMultiplier', near)).toBeCloseTo(1);
  });

  it('dual wield (MPL-LF): no sights while it is in hand', () => {
    const room = setup();
    const a = bot(room, 0, 'mpl');
    expect(room.modifiers.any('canAds', a)).not.toBe(false);
    packNow(room, a);
    expect(room.modifiers.any('canAds', a)).toBe(false);
    switchWeapon(room, a, 1);
    expect(room.modifiers.any('canAds', a)).not.toBe(false);
  });

  it('launchers: the G16-GL35 gets 3 grenades, the AUG-50M3 a 4-shell Masterkey, both gone when the buff ends', () => {
    const room = setup();
    const f = bot(room, 0, 'famas');
    packNow(room, f);
    const gl = f.weapons[2]!;
    expect(gl.def.base.id).toBe('gl');
    expect(gl.mag + gl.reserve).toBe(3);
    const g = bot(room, 0, 'aug');
    const v = bot(room, 1);
    packNow(room, g);
    const mk = g.weapons[2]!;
    expect(mk.def.base.id).toBe(MASTERKEY_ID);
    expect(mk.def.name).toBe('Masterkey');
    expect([mk.mag, mk.reserve]).toEqual([4, 0]);
    // It fires as a shotgun from the underbarrel slot.
    switchWeapon(room, g, 2);
    place(g, -10, 20);
    place(v, -6, 20);
    v.health = 1000;
    shootAt(room, g, chestOf(v));
    expect(mk.mag).toBe(3);
    expect(v.health).toBeLessThan(1000);
    // Buff over: the extras are taken back (and the gun in hand goes back to the primary).
    endPapBuff(room, g);
    endPapBuff(room, f);
    expect(g.weapons).toHaveLength(2);
    expect(f.weapons).toHaveLength(2);
    expect(g.slot).toBe(0);
  });

  it('the killfeed names the packed gun', () => {
    const room = setup();
    const a = bot(room, 0, 'ak47');
    const v = bot(room, 1);
    const feed: Extract<ServerMsg, { t: 'killfeed' }>[] = [];
    const bc = room.broadcast.bind(room);
    room.broadcast = ((msg: ServerMsg, except?: PlayerState) => {
      if (msg.t === 'killfeed') feed.push(msg);
      bc(msg, except);
    }) as typeof room.broadcast;
    room.kill(v, a, { weapon: 'ak47', means: 'bullet' });
    expect(feed[0]!.pap).toBeUndefined();
    room.spawn(v);
    packNow(room, a);
    room.kill(v, a, { weapon: 'ak47', means: 'bullet' });
    expect(feed[1]!.pap).toBe(true);
    expect(papName(feed[1]!.weapon)).toBe("Reznov's Revenge");
  });
});

describe('Pack-a-Punch wonder weapon touches', () => {
  function packWonder(room: Room, p: PlayerState, id: string) {
    p.weapons[0] = makeWeapon({ weapon: id, attachments: [], camo: 'none' }, id);
    switchWeapon(room, p, 0);
    packNow(room, p);
  }

  it("Porter's X2 Ray Gun fires red bolts", () => {
    const room = setup();
    const a = bot(room, 0);
    packWonder(room, a, 'raygun');
    place(a, -10, 20);
    shootAt(room, a, { x: 10, y: 1.2, z: 20 });
    expect(room.entities.byKind(WONDER_ENTITY.bolt)[0]?.s?.u).toBe(1);
  });

  it("Winter's Fury freezes solid with one blast at the end of its range", () => {
    const room = setup();
    const a = bot(room, 0);
    const v = bot(room, 1);
    packWonder(room, a, 'wintershowl');
    place(a, -10, 20);
    place(v, -3, 20);
    v.health = 1000;
    shootAt(room, a, chestOf(v));
    expect(frostOf(v)).toBe(1);
  });

  it('Wunderwaffe DG-3 JZ arcs through 4 more enemies', () => {
    const room = setup();
    const a = bot(room, 0);
    const vs = [0, 1, 2, 3, 4].map(() => bot(room, 1));
    packWonder(room, a, 'wunderwaffe');
    place(a, -10, 20);
    vs.forEach((v, i) => place(v, 4 + i * 2.5, 20 + (i % 2)));
    shootAt(room, a, chestOf(vs[0]!));
    steps(room, 1.5);
    expect(vs.filter((v) => !v.alive).length).toBe(5);
  });
});
