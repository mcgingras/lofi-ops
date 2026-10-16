import { afterEach, describe, expect, it } from 'vitest';
import { hasPerk, isPro, perksOf } from '../src/server/features/perks/common';
import { resupply } from '../src/server/features/perks/scavenger';
import { callKillstreak } from '../src/server/features/killstreaks/api';
import { KS_ENTITY } from '../src/shared/defs/killstreaks';
import { PERK_BY_ID, PERK_PRO_CHALLENGES, PERK_TUNING as T, PERKS, perksOfTier, proChallengeFor } from '../src/shared/defs/perks';
import { Buttons } from '../src/shared/input';
import { sanitizeLoadout } from '../src/shared/loadout';
import weapons, { explode, melee } from '../src/server/features/weapons/index';
import { wext } from '../src/server/features/weapons/state';
import { EQUIPMENT_BY_ID, MELEE } from '../src/shared/defs/equipment';
import type { Loadout } from '../src/shared/loadout';
import { aim, bot, give, gunKill, loadout, place, rig, steps, until, withProfile, type Rig } from './perks-streaks.helpers';

let r: Rig | undefined;
afterEach(() => {
  r?.close();
  r = undefined;
});
const setup = () => (r = rig()).room;

describe('perk defs', () => {
  it('has the BO1 tiers with Pro challenges', () => {
    expect(perksOfTier(1).map((p) => p.id)).toEqual(['lightweight', 'flak_jacket', 'scavenger', 'ghost', 'hardline']);
    expect(perksOfTier(2).map((p) => p.id)).toEqual(['hardened', 'scout', 'steady_aim', 'sleight_of_hand', 'warlord', 'pack_rat']);
    expect(perksOfTier(3).map((p) => p.id)).toEqual(['tactical_mask', 'marathon', 'ninja', 'second_chance', 'hacker', 'tracker']);
    expect(PERK_PRO_CHALLENGES).toHaveLength(PERKS.length);
    for (const p of PERKS) {
      const ch = proChallengeFor(p.id);
      expect(ch, p.id).toBeDefined();
      expect(ch!.id).toBe(p.pro.challenge);
      expect(ch!.metric.startsWith('perks.')).toBe(true);
      expect(ch!.goal).toBeGreaterThan(0);
    }
    expect(sanitizeLoadout({ perks: ['ghost', 'warlord', 'ninja', 'bogus'] }).perks).toEqual(['ghost', 'warlord', 'ninja']);
    expect(PERK_BY_ID.get('second_chance')!.tier).toBe(3);
  });
});

describe('tier 1', () => {
  it('Lightweight: faster; Pro: no fall damage', () => {
    const room = setup();
    const a = bot(room, 0, ['lightweight']);
    const b = bot(room, 1);
    expect(room.modifiers.mul('speedMultiplier', a)).toBeCloseTo(T.lightweightSpeed);
    expect(room.modifiers.mul('speedMultiplier', b)).toBe(1);
    const fall = (p: typeof a) => room.damage({ victim: p, attacker: null, amount: 30, weapon: 'fall', part: null, means: 'fall', from: null, distance: 0 });
    expect(fall(a)).toBe(30);
    perksOf(a).allPro = true;
    expect(fall(a)).toBe(0);
  });

  it('Flak Jacket: explosives x0.65; Pro: immune to fire', () => {
    const room = setup();
    const a = bot(room, 0, ['flak_jacket']);
    const hit = (means: string) => {
      a.health = 100;
      return room.damage({ victim: a, attacker: null, amount: 40, weapon: 'frag', part: null, means, from: null, distance: 0 });
    };
    expect(hit('explosive')).toBeCloseTo(40 * T.flakExplosive);
    expect(hit('bullet')).toBe(40);
    expect(hit('fire')).toBe(40);
    perksOf(a).allPro = true;
    expect(hit('fire')).toBe(0);
  });

  it('Scavenger: victims drop packs only enemies with Scavenger pick up', () => {
    const room = setup();
    const a = bot(room, 0, ['scavenger']);
    const plain = bot(room, 0);
    const v = bot(room, 1);
    place(a, -1, 12);
    place(plain, -1, 0.5);
    place(v, -1, 0);
    a.weapons[0]!.reserve = 0;
    plain.weapons[0]!.reserve = 0;
    gunKill(room, plain, v);
    const packs = room.entities.byKind(KS_ENTITY.scavenger);
    expect(packs).toHaveLength(1);
    steps(room, 0.3);
    expect(plain.weapons[0]!.reserve).toBe(0); // no Scavenger: walks right over it
    expect(room.entities.byKind(KS_ENTITY.scavenger)).toHaveLength(1);
    place(a, -1, 0.3);
    steps(room, 0.2);
    expect(room.entities.byKind(KS_ENTITY.scavenger)).toHaveLength(0);
    expect(a.weapons[0]!.reserve).toBe(a.weapons[0]!.def.magazine * T.scavengerMags);
  });

  it('Scavenger packs expire', () => {
    const room = setup();
    const v = bot(room, 1);
    gunKill(room, bot(room, 0), v);
    expect(room.entities.byKind(KS_ENTITY.scavenger)).toHaveLength(1);
    steps(room, T.scavengerPackLife + 0.5);
    expect(room.entities.byKind(KS_ENTITY.scavenger)).toHaveLength(0);
  });

  it('Scavenger Pro: extra mags at spawn and grenade resupply event', () => {
    const room = setup();
    const a = bot(room, 0, ['scavenger']);
    perksOf(a).allPro = true;
    room.spawn(a);
    const w = a.weapons[0]!;
    expect(w.reserve).toBe(w.def.reserve + w.def.magazine * T.scavengerProMags);
    const events: number[] = [];
    room.bus.on('perks.resupply', (e) => events.push(e.lethal));
    w.reserve = 0;
    resupply(room, a);
    expect(events).toEqual([1]);
    expect(w.reserve).toBe(w.def.magazine);
  });

  it('Ghost: hidden from an enemy Spy Plane unless firing a loud gun', () => {
    const room = setup();
    const owner = bot(room, 0, [], ['uav']);
    const ghost = bot(room, 1, ['ghost']);
    const plain = bot(room, 1);
    give(owner, 'uav');
    expect(room.radarFor(owner)).toEqual([]);
    expect(callKillstreak(room, owner, 'uav').ok).toBe(true);
    expect(room.radarFor(owner)).toEqual([plain.id]);
    ghost.lastFireTime = room.time;
    ghost.lastFireSuppressed = false;
    expect(room.radarFor(owner).sort()).toEqual([ghost.id, plain.id].sort());
    ghost.lastFireSuppressed = true;
    expect(room.radarFor(owner)).toEqual([plain.id]);
  });

  it('Ghost Pro: sentry guns ignore you', () => {
    const room = setup();
    const owner = bot(room, 0, [], ['sentry_gun']);
    const ghost = bot(room, 1, ['ghost']);
    perksOf(ghost).allPro = true;
    place(owner, -1, 8);
    owner.yaw = 0;
    place(ghost, -1, 0);
    give(owner, 'sentry_gun');
    expect(callKillstreak(room, owner, 'sentry_gun').ok).toBe(true);
    steps(room, 3);
    expect(ghost.health).toBe(100);
  });

  it('Hardline: killstreaks need one less kill', () => {
    const room = setup();
    const a = bot(room, 0, ['hardline'], ['uav']);
    const b = bot(room, 0, [], ['uav']);
    expect(room.modifiers.sum('streakCostOffset', a)).toBe(-1);
    for (let i = 0; i < 2; i++) {
      gunKill(room, a, bot(room, 1));
      gunKill(room, b, bot(room, 1));
    }
    expect(a.ext.killstreaks!.ready).toEqual(['uav']);
    expect(b.ext.killstreaks!.ready).toEqual([]);
  });
});

describe('tier 2', () => {
  it('Hardened: bullets penetrate twice as deep; Pro: more damage to killstreaks and less flinch', () => {
    const room = setup();
    const a = bot(room, 0, ['hardened']);
    expect(room.modifiers.registered().filter((e) => e.id.startsWith('perks.hardened')).map((e) => e.key)).toEqual(['penetrationMultiplier', 'killstreakDamageDealt', 'flinchMultiplier']);
    expect(room.modifiers.mul('penetrationMultiplier', a)).toBe(T.hardenedPenetration);
    expect(room.modifiers.mul('penetrationMultiplier', bot(room, 0))).toBe(1);
    expect(room.modifiers.mul('killstreakDamageDealt', a, 'ks_heli')).toBe(1);
    perksOf(a).allPro = true;
    expect(room.modifiers.mul('killstreakDamageDealt', a, 'ks_heli')).toBe(T.hardenedProStreakDamage);
    expect(room.modifiers.mul('flinchMultiplier', a)).toBe(T.hardenedProFlinch);
  });

  it('Scout: hold breath longer (sent to the client with the equipment); Pro: faster weapon swap', () => {
    const room = (r = rig({}, [weapons])).room;
    const a = bot(room, 0, ['scout']);
    const b = bot(room, 0);
    expect(room.modifiers.mul('holdBreathMultiplier', a)).toBe(T.scoutHoldBreath);
    const sent: { to: string; breath?: number }[] = [];
    room.sendFeature = ((to: { id: string } | null, id: string, data: { breath?: number }) => {
      if (id === 'weapons.equip' && to) sent.push({ to: to.id, breath: data.breath });
    }) as typeof room.sendFeature;
    room.spawn(a);
    room.spawn(b);
    expect(sent).toEqual([{ to: a.id, breath: T.scoutHoldBreath }, { to: b.id, breath: 1 }]);
    expect(room.modifiers.mul('swapMultiplier', a)).toBe(1);
    perksOf(a).allPro = true;
    expect(room.modifiers.mul('swapMultiplier', a)).toBe(T.scoutProSwap);
  });

  it('Steady Aim: tighter hip fire only; Pro: faster sprint-out and knife', () => {
    const room = setup();
    const a = bot(room, 0, ['steady_aim']);
    a.move.ads = 0;
    expect(room.modifiers.mul('spreadMultiplier', a)).toBe(T.steadyAimHipSpread);
    a.move.ads = 1;
    expect(room.modifiers.mul('spreadMultiplier', a)).toBe(1);
    perksOf(a).allPro = true;
    expect(room.modifiers.mul('sprintOutMultiplier', a)).toBe(T.steadyAimProSprintOut);
    expect(room.modifiers.mul('meleeSpeedMultiplier', a)).toBe(T.steadyAimProMelee);
  });

  it('Steady Aim Pro: the knife recovers faster (weapons reads meleeSpeedMultiplier)', () => {
    const room = (r = rig({}, [weapons])).room;
    const a = bot(room, 0, ['steady_aim']);
    const b = bot(room, 0, ['steady_aim']);
    perksOf(b).allPro = true;
    room.phase = 'playing';
    melee(room, a);
    melee(room, b);
    expect(a.ext.weapons!.meleeReady - room.time).toBeCloseTo(MELEE.cooldownSec, 5);
    expect(b.ext.weapons!.meleeReady - room.time).toBeCloseTo(MELEE.cooldownSec * T.steadyAimProMelee, 5);
  });

  it('Sleight of Hand: reloads in half the time; Pro: faster ADS', () => {
    const room = setup();
    const a = bot(room, 0, ['sleight_of_hand']);
    const w = a.weapons[0]!;
    w.mag = 1;
    a.swapEnd = 0;
    room.bus.emit('buttons', { player: a, pressed: 0, released: 0, buttons: 0 });
    a.brain = { think: () => ({ buttons: Buttons.RELOAD, yaw: 0, pitch: 0, weaponSlot: 0 }) };
    room.step();
    const dur = a.reloadEnd - room.time;
    expect(dur).toBeCloseTo((w.def.reloadMs / 1000) * T.sleightReload, 1);
    perksOf(a).allPro = true;
    expect(room.modifiers.mul('adsMultiplier', a)).toBe(T.sleightProAds);
  });

  it('Warlord: two primary attachments at spawn (secondary still one); Pro: an extra lethal and tactical', () => {
    const room = (r = rig({}, [weapons])).room;
    const cls = (perksList: string[]): Loadout => ({ ...loadout(perksList), primary: { weapon: 'ak47', attachments: ['reddot', 'extmag'], camo: 'none' }, secondary: { weapon: 'm1911', attachments: ['suppressor', 'extmag'], camo: 'none' } });
    // First spawn: `p.loadout` is still null at beforeSpawn, so the perk must be read from the class.
    const a = room.addBot({ team: 0, loadout: cls(['warlord']) });
    const b = room.addBot({ team: 0, loadout: cls([]) });
    room.spawn(a);
    room.spawn(b);
    expect(a.weapons[0]!.def.attachmentIds).toEqual(['reddot', 'extmag']);
    expect(a.weapons[1]!.def.attachmentIds).toEqual(['suppressor']);
    expect(b.weapons[0]!.def.attachmentIds).toEqual(['reddot']);
    expect(wext(a)).toMatchObject({ lethalN: 1, tacticalN: 2 });
    perksOf(a).allPro = true;
    room.spawn(a);
    expect(wext(a)).toMatchObject({ lethal: 'frag', lethalN: 2, tactical: 'flashbang', tacticalN: 3 });
    // Class changes between lives use the NEW class's perks for the trim, both ways.
    a.nextLoadout = cls([]);
    room.spawn(a);
    expect(a.weapons[0]!.def.attachmentIds).toEqual(['reddot']);
    expect(wext(a)).toMatchObject({ lethalN: 1, tacticalN: 2 });
    b.nextLoadout = cls(['warlord']);
    room.spawn(b);
    expect(b.weapons[0]!.def.attachmentIds).toEqual(['reddot', 'extmag']);
  });

  it('Scavenger Pro: a pack refills grenades up to the carry cap (weapons listens to perks.resupply)', () => {
    const room = (r = rig({}, [weapons])).room;
    const a = bot(room, 0, ['scavenger', 'warlord']);
    perksOf(a).allPro = true;
    room.spawn(a);
    const x = wext(a);
    expect(x).toMatchObject({ lethalN: 2, tacticalN: 3 });
    x.lethalN = 0;
    x.tacticalN = 2;
    resupply(room, a);
    expect(x).toMatchObject({ lethalN: 1, tacticalN: 3 });
    resupply(room, a);
    expect(x).toMatchObject({ lethalN: 2, tacticalN: 3 });
  });
});

describe('tier 3', () => {
  it('Tactical Mask: weaker, shorter flashes and concussions; Pro: enemies you stun show on your radar', () => {
    const room = (r = rig({}, [weapons])).room;
    const a = bot(room, 0, ['tactical_mask']);
    const v = bot(room, 1);
    const plain = bot(room, 0);
    expect(room.modifiers.mul('tacticalMultiplier', a)).toBe(T.maskStun);
    // A concussion between the masked player and a plain one, both facing it.
    place(a, -2, 0);
    place(plain, 2, 0);
    a.yaw = -Math.PI / 2;
    plain.yaw = Math.PI / 2;
    const hits = new Map<string, { amount: number; duration: number }>();
    room.bus.on('weapons.tactical', (e) => void hits.set(e.victim.id, { amount: e.amount, duration: e.duration }));
    explode(room, { x: 0, y: 1.2, z: 0 }, EQUIPMENT_BY_ID.get('concussion')!, v.id);
    expect(hits.get(a.id)!.amount).toBeCloseTo(hits.get(plain.id)!.amount * T.maskStun, 5);
    expect(hits.get(a.id)!.duration).toBeLessThan(hits.get(plain.id)!.duration);
    hits.clear();
    room.bus.emit('weapons.tactical', { player: a, victim: v, equipment: 'flashbang', amount: 1, duration: 3 });
    expect(room.radarFor(a)).toEqual([]);
    perksOf(a).allPro = true;
    expect(room.radarFor(a)).toEqual([v.id]);
    steps(room, 3.2);
    expect(room.radarFor(a)).toEqual([]);
  });

  it('Marathon: sprint stamina doubles; Pro: unlimited', () => {
    const room = setup();
    const plain = bot(room, 0);
    const mara = bot(room, 0, ['marathon']);
    const pro = bot(room, 0, ['marathon']);
    perksOf(pro).allPro = true;
    room.spawn(pro);
    let x = -20;
    for (const p of [plain, mara, pro]) {
      place(p, x, -10);
      x += 12;
      p.brain = { think: () => ({ buttons: Buttons.FORWARD | Buttons.SPRINT, yaw: Math.PI / 2, pitch: 0, weaponSlot: 0 }) };
    }
    // The sprint flag follows input and stamina (not speed), so running into a wall doesn't matter.
    let t = 0;
    let plainStop = -1;
    let maraStop = -1;
    let proStop = -1;
    while (t < 13) {
      room.step();
      t += 1 / 60;
      if (plainStop < 0 && !plain.move.sprinting && t > 0.5) plainStop = t;
      if (maraStop < 0 && !mara.move.sprinting && t > 0.5) maraStop = t;
      if (proStop < 0 && !pro.move.sprinting && t > 0.5) proStop = t;
    }
    expect(proStop).toBe(-1);
    expect(plainStop).toBeGreaterThan(T.sprintSec - 0.3);
    expect(plainStop).toBeLessThan(T.sprintSec + 0.5);
    expect(maraStop).toBeGreaterThan(T.sprintSec * T.marathonMult - 0.3);
    expect(room.modifiers.any('canSprint', pro)).toBeUndefined();
    expect(perksOf(plain).exhausted || perksOf(plain).sprintLeft < T.sprintSec).toBe(true);
  });

  it('Ninja: silent footsteps (public list); Pro: hears more', () => {
    const room = setup();
    const a = bot(room, 0, ['ninja']);
    expect(room.modifiers.any('silentFootsteps', a)).toBe(true);
    expect(room.modifiers.mul('hearingMultiplier', a)).toBe(1);
    perksOf(a).allPro = true;
    expect(room.modifiers.mul('hearingMultiplier', a)).toBe(T.ninjaProFootsteps);
  });

  it('Second Chance: last stand with the pistol, then death credited to the downer', () => {
    const room = setup();
    const a = bot(room, 0);
    const v = bot(room, 1, ['second_chance']);
    place(a, -1, 8);
    place(v, -1, 0);
    steps(room, 0.5);
    const deaths: { victim: string; attacker: string | null }[] = [];
    room.bus.on('death', (e) => deaths.push({ victim: e.victim.id, attacker: e.attacker?.id ?? null }));
    room.damage({ victim: v, attacker: a, amount: 150, weapon: 'ak47', part: 'torso', means: 'bullet', from: null, distance: 8 });
    expect(v.alive).toBe(true);
    expect(v.health).toBe(T.lastStandHealth);
    expect(perksOf(v).lastStand).not.toBeNull();
    expect(v.slot).toBe(1);
    expect(room.modifiers.mul('speedMultiplier', v)).toBeCloseTo(T.lastStandSpeed);
    expect(room.modifiers.any('canSprint', v)).toBe(false);
    steps(room, T.lastStandSec + 0.1);
    expect(v.alive).toBe(false);
    expect(deaths).toEqual([{ victim: v.id, attacker: a.id }]);
    expect(a.stats.kills).toBe(1);
  });

  it('Second Chance: headshots and explosives kill outright; damage in last stand finishes', () => {
    const room = setup();
    const a = bot(room, 0);
    const v = bot(room, 1, ['second_chance']);
    room.damage({ victim: v, attacker: a, amount: 150, weapon: 'ak47', part: 'head', means: 'bullet', from: null, distance: 8 });
    expect(v.alive).toBe(false);
    room.spawn(v);
    room.damage({ victim: v, attacker: a, amount: 150, weapon: 'frag', part: null, means: 'explosive', from: null, distance: 2 });
    expect(v.alive).toBe(false);
    room.spawn(v);
    room.damage({ victim: v, attacker: a, amount: 150, weapon: 'ak47', part: 'torso', means: 'bullet', from: null, distance: 8 });
    expect(v.alive).toBe(true);
    room.damage({ victim: v, attacker: a, amount: 40, weapon: 'ak47', part: 'torso', means: 'bullet', from: null, distance: 8 });
    expect(v.alive).toBe(false);
  });

  it('Second Chance Pro: a teammate holding USE revives', () => {
    const room = setup();
    const a = bot(room, 0);
    const v = bot(room, 1, ['second_chance']);
    const mate = bot(room, 1);
    perksOf(v).allPro = true;
    place(v, -1, 0);
    place(mate, -1, 1);
    room.damage({ victim: v, attacker: a, amount: 150, weapon: 'ak47', part: 'torso', means: 'bullet', from: null, distance: 8 });
    expect(perksOf(v).lastStand!.until - room.time).toBeCloseTo(T.lastStandProSec, 1);
    mate.brain = { think: () => ({ buttons: Buttons.USE, yaw: 0, pitch: 0, weaponSlot: 0 }) };
    steps(room, T.reviveSec + 0.2);
    expect(perksOf(v).lastStand).toBeNull();
    expect(v.alive).toBe(true);
    expect(v.health).toBeGreaterThan(T.lastStandHealth);
  });

  it('Hacker Pro: hacks an enemy sentry by holding USE next to it', () => {
    const room = setup();
    const owner = bot(room, 0, [], ['sentry_gun']);
    const hacker = bot(room, 1, ['hacker']);
    perksOf(hacker).allPro = true;
    place(owner, 10, -20);
    owner.yaw = Math.PI; // facing +z, away
    give(owner, 'sentry_gun');
    expect(callKillstreak(room, owner, 'sentry_gun').ok).toBe(true);
    const sentry = room.entities.byKind(KS_ENTITY.sentry)[0]!;
    // Approach from behind with USE held (the sentry would shoot an enemy it sees; give it no time).
    place(hacker, sentry.x, sentry.z - 1.2);
    hacker.brain = { think: () => ({ buttons: Buttons.USE, yaw: 0, pitch: 0, weaponSlot: 0 }) };
    hacker.health = 10000;
    hacker.maxHealth = 10000;
    expect(until(room, () => sentry.owner === hacker.id, T.hackSec + 1)).toBeLessThan(T.hackSec + 0.5);
    expect(sentry.team).toBe(1);
  });
});

describe('Pro challenges', () => {
  it('count into profile.challengeProgress and unlock Pro at the goal', () => {
    const room = setup();
    const a = withProfile(bot(room, 0, ['hardened']));
    const ch = proChallengeFor('hardened')!;
    a.profile!.challengeProgress[ch.id] = ch.goal - 1;
    expect(isPro(a, 'hardened')).toBe(false);
    const seen: string[] = [];
    room.bus.on('perks.progress', (e) => seen.push(e.challenge));
    gunKill(room, a, bot(room, 1));
    expect(seen).toEqual([ch.id]);
    expect(a.profile!.challengeProgress[ch.id]).toBe(ch.goal);
    expect(isPro(a, 'hardened')).toBe(true);
    expect(hasPerk(a, 'hardened')).toBe(true);
  });

  it('Warlord Pro counts kills with a primary that really spawned with two attachments', () => {
    const room = (r = rig({}, [weapons])).room;
    const two: Loadout = { ...loadout(['warlord']), primary: { weapon: 'ak47', attachments: ['reddot', 'extmag'], camo: 'none' } };
    const a = withProfile(room.addBot({ team: 0, loadout: two }));
    const one = withProfile(room.addBot({ team: 0, loadout: { ...two, primary: { ...two.primary, attachments: ['reddot'] } } }));
    room.spawn(a);
    room.spawn(one);
    expect(a.weapons[0]!.def.attachmentIds).toHaveLength(2);
    gunKill(room, a, bot(room, 1));
    gunKill(room, one, bot(room, 1));
    expect(a.profile!.challengeProgress['warlord_pro']).toBe(1);
    expect(one.profile!.challengeProgress['warlord_pro'] ?? 0).toBe(0);
  });

  it('ninja kills from behind, steady aim hip kills, hardline streaks', () => {
    const room = setup();
    const a = withProfile(bot(room, 0, ['ninja', 'steady_aim', 'hardline'], ['uav']));
    const v = bot(room, 1);
    place(a, -1, 8);
    place(v, -1, 0);
    v.yaw = 0; // looking toward -z: a (at +z) is behind
    a.move.ads = 0;
    gunKill(room, a, v);
    const prog = a.profile!.challengeProgress;
    expect(prog['ninja_pro']).toBe(1);
    expect(prog['steady_aim_pro']).toBe(1);
    gunKill(room, a, bot(room, 1));
    expect(prog['hardline_pro']).toBe(1);
  });

  it('a real aimed kill path works with perks loaded', () => {
    const room = setup();
    const a = bot(room, 0, ['steady_aim']);
    const b = bot(room, 1);
    place(a, -1, 8);
    place(b, -1, 0);
    a.brain = { think: () => ({ buttons: Buttons.ADS, yaw: 0, pitch: 0, weaponSlot: 0 }) };
    steps(room, 0.6);
    for (let i = 0; i < 20 && b.alive; i++) {
      a.move.ads = 1;
      room.fire(a, { dir: aim(a, b.move) });
      steps(room, 0.15);
    }
    expect(b.alive).toBe(false);
  });
});
