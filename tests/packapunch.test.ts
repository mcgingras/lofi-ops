/**
 * Pack-a-Punch killstreak, rules level (a Yard TDM room stepped tick by tick): the def and the
 * packed numbers (damage, magazine and reserve, reload, cycle rate, names, wonder weapons by the
 * generic rules); calling it (the gun goes down, the upgrade lands out of view, refilled); the
 * damage multiplier through real hitscan and `damage`; already packed refused; dying before it
 * lands refunds it; a dropped packed gun stays packed for whoever takes it; a new life clears it;
 * the client can't fake it (no camo in a class, no call without the streak); bots use it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { botWants, callKillstreak } from '../src/server/features/killstreaks/api';
import killstreaks, { onStreakPressed } from '../src/server/features/killstreaks/index';
import { grant, ksOf } from '../src/server/features/killstreaks/state';
import { papTarget } from '../src/server/features/killstreaks/streaks/packapunch';
import perks from '../src/server/features/perks/index';
import pickups, { dropsOf } from '../src/server/features/pickups/index';
import { spawnDrop, swapFor } from '../src/server/features/pickups/drops';
import weapons from '../src/server/features/weapons/index';
import { killerCard } from '../src/server/features/modes/deathcam';
import { switchWeapon } from '../src/server/combat';
import { Lobby } from '../src/server/lobby';
import { makeWeapon, type PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { Store } from '../src/server/store';
import { PLAYER, TICK_DT, type Team } from '../src/shared/constants';
import { effectiveWeapon } from '../src/shared/defs/attachments';
import { KILLSTREAK_BY_ID, streakAllowedIn } from '../src/shared/defs/killstreaks';
import { isPackable, PACK_A_PUNCH, packDef, packWeaponState, papDamageMult, papDip, papName, PAP_CAMO, PAP_ID, PAP_WEAPONS } from '../src/shared/defs/pack-a-punch';
import { WEAPON_BY_ID, WEAPONS } from '../src/shared/defs/weapons';
import { cloneLoadout, DEFAULT_LOADOUTS, sanitizeLoadout, type Loadout } from '../src/shared/loadout';
import { createMoveState } from '../src/shared/movement';

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
  return lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false });
}

const loadout = (primary = 'ak47', camo = 'none'): Loadout => ({ ...cloneLoadout(DEFAULT_LOADOUTS[0]!), primary: { weapon: primary, attachments: [], camo }, perks: [], killstreaks: ['uav', 'pack_a_punch', 'attack_dogs'] });

/** A bot standing still (manual streaks), facing -z. */
function botP(room: Room, team: Team, primary = 'ak47'): PlayerState {
  const p = room.addBot({ team, loadout: loadout(primary) });
  p.brain = { think: (_r, self) => ({ buttons: 0, yaw: self.yaw, pitch: self.pitch, weaponSlot: self.slot }) };
  ksOf(p).manual = true;
  if (!p.alive) room.spawn(p);
  return p;
}
const place = (p: PlayerState, x: number, z: number, yaw = 0) => {
  p.move = { ...createMoveState(x, 0, z), onGround: true };
  p.yaw = yaw;
  p.pitch = 0;
};
const steps = (room: Room, sec: number) => {
  for (let i = 0; i < Math.round(sec / TICK_DT); i++) room.step();
};
/** Grant and call it, then step past the whole upgrade. */
function packNow(room: Room, p: PlayerState): void {
  grant(room, p, PAP_ID);
  expect(callKillstreak(room, p, PAP_ID)).toEqual({ ok: true });
  steps(room, PACK_A_PUNCH.durationSec + 0.1);
}

describe('Pack-a-Punch defs and numbers', () => {
  it('is a 6-kill self-use streak at level 15, off in wager matches', () => {
    const d = KILLSTREAK_BY_ID.get(PAP_ID)!;
    expect(d).toMatchObject({ name: 'Pack-a-Punch', kills: 6, unlockLevel: 15, targeting: 'none', icon: 'ks_pap' });
    expect(streakAllowedIn(d, { playlist: 'wager' })).toBe(false);
    expect(streakAllowedIn(d, {})).toBe(true);
  });

  it('BO1 upgraded names, and a fallback for weapons nobody named yet', () => {
    expect(papName('m16')).toBe('Skullpiercer');
    expect(papName('ak74u')).toBe('AK74fu2');
    expect(papName('mp5k')).toBe('MP115 Kollider');
    expect(papName('python')).toBe('Cobra');
    expect(papName('olympia')).toBe('Hades');
    expect(papName('spas12')).toBe('SPAZ-24');
    expect(papName('m1911')).toBe('Mustang & Sally');
    expect(papName('raygun')).toBe("Porter's X2 Ray Gun");
    expect(papName('thundergun')).toBe('Zeus Cannon');
    expect(papName('wunderwaffe')).toBe('Wunderwaffe DG-3 JZ');
    expect(papName('wintershowl')).toBe("Winter's Fury");
    expect(papName('not_a_gun_yet')).toBe('not_a_gun_yet Upgraded');
    // Every packable weapon in the game has a name of its own.
    for (const w of WEAPONS) if (isPackable(w.id)) expect(PAP_WEAPONS[w.id]?.name, w.id).toBeTruthy();
    // Never the knife, the underbarrel launcher; always the wonder weapons.
    expect(isPackable('knife')).toBe(false);
    expect(isPackable('gl')).toBe(false);
    expect(isPackable('raygun')).toBe(true);
  });

  it('bigger magazine, much more reserve, quicker reload, faster cycle only for slow guns', () => {
    const ak = effectiveWeapon(WEAPON_BY_ID.get('ak47')!);
    const p = packDef(ak);
    expect(p.name).toBe("Reznov's Revenge");
    expect(p.magazine).toBe(Math.round(ak.magazine * PACK_A_PUNCH.magMult));
    expect(p.reserve).toBe(Math.round(ak.reserve * PACK_A_PUNCH.reserveMult));
    expect(p.reloadMs).toBeCloseTo(ak.reloadMs * PACK_A_PUNCH.reloadMult);
    expect(p.rpm).toBe(ak.rpm);
    expect(p.damage).toEqual(ak.damage); // damage is the server's multiplier, never baked in
    // A burst rifle keeps whole bursts in the magazine.
    expect(packDef(effectiveWeapon(WEAPON_BY_ID.get('m16')!)).magazine % 3).toBe(0);
    // The revolver: 12 rounds (BO1's Cobra) and a faster cycle.
    const py = effectiveWeapon(WEAPON_BY_ID.get('python')!);
    expect(packDef(py).magazine).toBe(12);
    expect(packDef(py).rpm).toBeCloseTo(py.rpm * PACK_A_PUNCH.slowRpmMult);
    // Attachments are kept (an extended mag packs from the bigger magazine).
    const ext = effectiveWeapon(WEAPON_BY_ID.get('ak47')!, ['extmag']);
    expect(packDef(ext).magazine).toBe(Math.round(ext.magazine * PACK_A_PUNCH.magMult));
    // Damage multipliers stay within reason for 100-health players.
    for (const w of WEAPONS) if (isPackable(w.id)) expect(papDamageMult(w.id)).toBeGreaterThanOrEqual(1.25), expect(papDamageMult(w.id)).toBeLessThanOrEqual(2);
  });

  it('wonder weapons by the generic rules: BO1 magazines where given, everyone else by the multipliers', () => {
    expect(packDef(effectiveWeapon(WEAPON_BY_ID.get('raygun')!)).magazine).toBe(40);
    expect(packDef(effectiveWeapon(WEAPON_BY_ID.get('thundergun')!)).magazine).toBe(4);
    expect(packDef(effectiveWeapon(WEAPON_BY_ID.get('wunderwaffe')!)).magazine).toBe(6);
    const wh = effectiveWeapon(WEAPON_BY_ID.get('wintershowl')!);
    expect(packDef(wh).magazine).toBe(Math.round(wh.magazine * PACK_A_PUNCH.magMult));
  });

  it('packing a weapon instance fills it, sets the camo, and never packs twice', () => {
    const w = makeWeapon({ weapon: 'mp5k', attachments: [], camo: 'tiger' }, 'mp5k');
    w.mag = 3;
    w.reserve = 0;
    expect(packWeaponState(w)).toBe(true);
    expect(w).toMatchObject({ pap: true, camo: PAP_CAMO, mag: w.def.magazine, reserve: w.def.reserve });
    const mag = w.def.magazine;
    expect(packWeaponState(w)).toBe(false);
    expect(w.def.magazine).toBe(mag);
    expect(packWeaponState(makeWeapon({ weapon: 'knife', attachments: [], camo: 'none' }, 'knife'))).toBe(false);
  });

  it('the viewmodel dips out, stays out while it is packed, and comes back', () => {
    expect(papDip(0)).toBe(0);
    expect(papDip(PACK_A_PUNCH.applyAt)).toBe(1);
    expect(papDip(PACK_A_PUNCH.durationSec - 0.01)).toBeLessThan(0.1);
    expect(papDip(PACK_A_PUNCH.durationSec)).toBe(0);
  });
});

describe('Pack-a-Punch in a room', () => {
  it('calling it takes the gun down, packs it out of view at applyAt, refilled, then brings it back', () => {
    const room = setup();
    const a = botP(room, 0);
    place(a, 0, 20);
    const w = a.weapons[0]!;
    const base = { mag: w.def.magazine, reserve: w.def.reserve };
    w.mag = 2;
    w.reserve = 10;
    grant(room, a, PAP_ID);
    const called: string[] = [];
    room.bus.on('killstreaks.packed', (e) => called.push(`${e.player.id}:${e.weapon}:${e.name}`));
    expect(callKillstreak(room, a, PAP_ID)).toEqual({ ok: true });
    expect(ksOf(a).ready).not.toContain(PAP_ID);
    // The gun is down: no firing, the slot is locked.
    expect(room.fire(a, { dir: { x: 0, y: 0, z: -1 } })).toEqual({ ok: false, reason: 'switching' });
    expect(a.slotLock?.slot).toBe(0);
    steps(room, PACK_A_PUNCH.applyAt - 0.1);
    expect(w.pap).toBeFalsy();
    steps(room, 0.2);
    expect(w.pap).toBe(true);
    expect(called).toEqual([`${a.id}:ak47:Reznov's Revenge`]);
    expect(w.camo).toBe(PAP_CAMO);
    expect(w.mag).toBe(Math.round(base.mag * PACK_A_PUNCH.magMult));
    expect(w.reserve).toBe(Math.round(base.reserve * PACK_A_PUNCH.reserveMult));
    // Everyone sees the camo on the world model (the snapshot's camo of the gun in hand).
    expect((room as unknown as { playerSnap(p: PlayerState): { c: string } }).playerSnap(a).c).toBe(PAP_CAMO);
    expect(room.fire(a, { dir: { x: 0, y: 0, z: -1 } }).ok).toBe(false);
    steps(room, PACK_A_PUNCH.durationSec - PACK_A_PUNCH.applyAt);
    expect(room.fire(a, { dir: { x: 0, y: 0, z: -1 } })).toEqual({ ok: true });
  });

  it('the STREAK button calls it like any other self-use streak', () => {
    const room = setup();
    const a = botP(room, 0);
    grant(room, a, PAP_ID);
    onStreakPressed(room, a);
    steps(room, PACK_A_PUNCH.durationSec);
    expect(a.weapons[0]!.pap).toBe(true);
  });

  it('packed damage: x1.5 through real hitscan, never on your own splash or killstreak kills', () => {
    const room = setup();
    room.modifiers.add('regenDelayMultiplier', () => 1000, 'test.noregen');
    const a = botP(room, 0);
    const v = botP(room, 1);
    place(a, -10, 20);
    place(v, 10, 20);
    a.move.ads = 1; // aimed: the seeded spread is tiny
    const dir = { x: 1, y: (v.move.y + 1.2 - (a.move.y + PLAYER.eye)) / 20, z: 0 };
    const n = Math.hypot(dir.x, dir.y, dir.z);
    const shot = () => {
      place(a, -10, 20);
      place(v, 10, 20);
      a.move.ads = 1;
      a.swapEnd = 0;
      a.weapons[0]!.credit = 2;
      v.health = 100;
      expect(room.fire(a, { dir: { x: dir.x / n, y: dir.y / n, z: dir.z / n }, shot: 1 }).ok).toBe(true);
      return 100 - v.health;
    };
    const plain = shot();
    expect(plain).toBeGreaterThan(0);
    packNow(room, a);
    const packed = shot();
    expect(packed).toBeCloseTo(Math.min(100, plain * papDamageMult('ak47')), 5);
    // `damage` keyed on the weapon credited: a carried packed gun's id multiplies, others don't.
    v.health = 100;
    expect(room.damage({ victim: v, attacker: a, amount: 20, weapon: 'ak47', part: 'torso', means: 'bullet', from: null, distance: 5 })).toBeCloseTo(30);
    v.health = 100;
    expect(room.damage({ victim: v, attacker: a, amount: 20, weapon: 'm1911', part: 'torso', means: 'bullet', from: null, distance: 5 })).toBeCloseTo(20);
    v.health = 100;
    expect(room.damage({ victim: v, attacker: a, amount: 20, weapon: 'ak47', part: 'torso', means: 'killstreak', from: null, distance: 5 })).toBeCloseTo(20);
    a.health = 100;
    expect(room.damage({ victim: a, attacker: a, amount: 20, weapon: 'ak47', part: 'torso', means: 'explosive', from: null, distance: 1 })).toBeCloseTo(20);
  });

  it("Cobra's explosive tips: a packed Python's round bursts where it stops (a little on top of the hit)", () => {
    const room = setup();
    room.modifiers.add('regenDelayMultiplier', () => 1000, 'test.noregen');
    const a = botP(room, 0);
    const v = botP(room, 1);
    a.weapons[1] = makeWeapon({ weapon: 'python', attachments: [], camo: 'none' }, 'python');
    switchWeapon(room, a, 1);
    const shot = () => {
      place(a, -10, 20);
      place(v, 10, 20);
      a.move.ads = 1;
      a.swapEnd = 0;
      a.weapons[1]!.credit = 2;
      v.health = 100;
      const dir = { x: 1, y: (1.2 - PLAYER.eye) / 20, z: 0 };
      const n = Math.hypot(dir.x, dir.y, dir.z);
      expect(room.fire(a, { dir: { x: dir.x / n, y: dir.y / n, z: dir.z / n }, shot: 1 }).ok).toBe(true);
      return 100 - v.health;
    };
    const plain = shot();
    expect(plain).toBeGreaterThan(0);
    packNow(room, a);
    expect(a.weapons[1]!.def.name).toBe('Cobra');
    const packed = shot();
    expect(packed).toBeGreaterThan(plain * papDamageMult('python') + 1);
    expect(packed).toBeLessThan(100); // modest: still not a one-shot body kill at 20 m
  });

  it('wonder weapons pack too, and their own damage gets the multiplier (no behaviour changes)', () => {
    const room = setup();
    const a = botP(room, 0);
    const v = botP(room, 1);
    a.weapons[0] = makeWeapon({ weapon: 'raygun', attachments: [], camo: 'none' }, 'raygun');
    packNow(room, a);
    expect(a.weapons[0]!.def.name).toBe("Porter's X2 Ray Gun");
    expect(a.weapons[0]!.mag).toBe(40);
    v.health = 100;
    expect(room.damage({ victim: v, attacker: a, amount: 40, weapon: 'raygun', part: 'torso', means: 'explosive', from: null, distance: 3 })).toBeCloseTo(60);
  });

  it('already packed: refused and the streak is kept (the other gun can still take it)', () => {
    const room = setup();
    const a = botP(room, 0);
    packNow(room, a);
    grant(room, a, PAP_ID);
    expect(callKillstreak(room, a, PAP_ID)).toEqual({ ok: false, reason: 'already_packed' });
    expect(ksOf(a).ready).toContain(PAP_ID);
    // Switching to the pistol and back keeps the primary packed (it belongs to the weapon).
    switchWeapon(room, a, 1);
    expect(papTarget(a)).toBe(a.weapons[1]);
    a.swapEnd = 0;
    expect(callKillstreak(room, a, PAP_ID)).toEqual({ ok: true });
    steps(room, PACK_A_PUNCH.durationSec);
    expect(a.weapons[1]!.def.name).toBe('Mustang & Sally');
    expect(a.weapons[0]!.pap).toBe(true);
  });

  it('dying before it lands gives the streak back; a new life starts with unpacked guns', () => {
    const room = setup();
    const a = botP(room, 0);
    const k = botP(room, 1);
    grant(room, a, PAP_ID);
    callKillstreak(room, a, PAP_ID);
    steps(room, 0.3);
    room.damage({ victim: a, attacker: k, amount: 500, weapon: 'ak47', part: 'torso', means: 'bullet', from: null, distance: 5 });
    steps(room, 0.1);
    expect(a.alive).toBe(false);
    expect(ksOf(a).ready).toContain(PAP_ID);
    room.spawn(a);
    packNow(room, a);
    expect(a.weapons[0]!.pap).toBe(true);
    room.damage({ victim: a, attacker: k, amount: 500, weapon: 'ak47', part: 'torso', means: 'bullet', from: null, distance: 5 });
    room.spawn(a);
    expect(a.weapons.some((w) => w.pap || w.camo === PAP_CAMO)).toBe(false);
    expect(a.weapons[0]!.def.name).toBe('AK-47');
  });

  it('a dropped packed gun stays packed, and whoever takes it gets the upgrade (with the ammo left in it)', () => {
    const room = setup();
    const a = botP(room, 0, 'ak47');
    const b = botP(room, 0, 'mp5k');
    packNow(room, a);
    const w = a.weapons[0]!;
    w.mag = 33;
    w.reserve = 200;
    const drop = spawnDrop(room, w, { x: 0, y: 0, z: 20 }, { x: 0, y: 0, z: 0 }, a, null, 'swap')!;
    expect(drop.data.pap).toBe(true);
    expect(drop.s.c).toBe(PAP_CAMO);
    drop.data.landed = true;
    swapFor(room, b, drop, 0);
    const got = b.weapons[0]!;
    expect(got.pap).toBe(true);
    expect(got.def.name).toBe("Reznov's Revenge");
    expect(got.def.magazine).toBe(w.def.magazine);
    expect({ mag: got.mag, reserve: got.reserve }).toEqual({ mag: 33, reserve: 200 });
    // B's own MP5K went down unpacked.
    expect(dropsOf(room).find((d) => d.data.weapon === 'mp5k')?.data.pap).toBeUndefined();
    // And the damage goes with it.
    const v = botP(room, 1);
    v.health = 100;
    expect(room.damage({ victim: v, attacker: b, amount: 20, weapon: 'ak47', part: 'torso', means: 'bullet', from: null, distance: 5 })).toBeCloseTo(30);
    // The killcam card names the upgraded gun.
    expect(killerCard(b, 'ak47').pap).toBe(true);
    expect(killerCard(a, 'm1911').pap).toBeUndefined();
  });

  it('the server is authoritative: the camo is not a class camo, and no call without the streak', () => {
    const room = setup();
    expect(sanitizeLoadout(loadout('ak47', PAP_CAMO)).primary.camo).toBe('none');
    const a = room.addBot({ team: 0, loadout: loadout('ak47', PAP_CAMO) });
    ksOf(a).manual = true;
    if (!a.alive) room.spawn(a);
    expect(a.weapons[0]!.camo).toBe('none');
    expect(a.weapons[0]!.pap).toBeFalsy();
    expect(a.weapons[0]!.def.magazine).toBe(WEAPON_BY_ID.get('ak47')!.magazine);
    // A forged camo on the server-side state alone gives nothing (the flag is what counts).
    a.weapons[0]!.camo = PAP_CAMO;
    const v = botP(room, 1);
    v.health = 100;
    expect(room.damage({ victim: v, attacker: a, amount: 20, weapon: 'ak47', part: 'torso', means: 'bullet', from: null, distance: 5 })).toBeCloseTo(20);
    expect(callKillstreak(room, a, PAP_ID)).toEqual({ ok: false, reason: 'not_ready' });
  });

  it('bots use it on their own, never on a gun already packed', () => {
    const room = setup();
    const b = botP(room, 0);
    ksOf(b).manual = false;
    ksOf(b).botStreakUse = 1;
    ksOf(b).botNextCall = 0;
    grant(room, b, PAP_ID);
    steps(room, 2 + PACK_A_PUNCH.durationSec);
    expect(b.weapons[b.slot]!.pap).toBe(true);
    grant(room, b, PAP_ID);
    expect(botWants(room, b, PAP_ID, 1)).toBe(false);
    expect(botWants(room, b, PAP_ID, 0.1)).toBe(false);
  });
});
