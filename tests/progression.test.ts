import { afterEach, describe, expect, it } from 'vitest';
import progression from '../src/server/features/progression/index';
import { enterPrestige } from '../src/server/features/progression/rules';
import { Lobby } from '../src/server/lobby';
import type { PlayerState } from '../src/server/player';
import type { Room, RoomOptions } from '../src/server/room';
import { Session } from '../src/server/session';
import { Store } from '../src/server/store';
import { ATTACHMENT_BY_ID } from '../src/shared/defs/attachments';
import {
  advanceChallenge,
  CHALLENGE_SOURCES,
  challengeById,
  challengeList,
  challengeMatches,
  describeChallenge,
  MODE_CHALLENGE_TEMPLATES,
  progressMetric,
  registerChallenges,
  tierName,
  tiersDone,
  type ChallengeDef,
} from '../src/shared/defs/challenges';
import { DEFAULT_TARGET_PLAYERS } from '../src/shared/defs/bots';
import { MODES } from '../src/shared/defs/modes';
import { PERKS } from '../src/shared/defs/perks';
import {
  addXp,
  levelForXp,
  levelProgress,
  MAX_LEVEL,
  MAX_PRESTIGE,
  matchSummaryFor,
  objectiveXp,
  progressionExt,
  rankFor,
  XP_SOURCES,
  XP_TABLE,
  xpToNext,
  type MatchXpSummary,
} from '../src/shared/defs/progression';
import {
  classForSelection,
  classSlots,
  computeUnlockIds,
  gateLoadout,
  isUnlocked,
  syncUnlocks,
  UNLOCK_LEVEL_OVERRIDES,
  UNLOCK_RULES,
  unlocksAtLevel,
  unlockTable,
  usableClassCount,
} from '../src/shared/defs/unlocks';
import { WEAPONS } from '../src/shared/defs/weapons';
import { TICK_DT } from '../src/shared/constants';
import { cloneLoadout, DEFAULT_LOADOUTS } from '../src/shared/loadout';
import { createMoveState } from '../src/shared/movement';
import { newProfile, type Profile } from '../src/shared/profile';

const atLevel = (level: number, prestige = 0): Profile => {
  const p = newProfile('p1', 'Tester');
  p.xp = XP_TABLE[level]!;
  p.level = level;
  p.prestige = prestige;
  return p;
};

afterEach(() => {
  for (const k of Object.keys(UNLOCK_LEVEL_OVERRIDES)) delete UNLOCK_LEVEL_OVERRIDES[k];
  UNLOCK_RULES.length = 0;
});

describe('XP math', () => {
  it('follows the 800 + 1050 (L-1) curve to 1,274,000 at level 50', () => {
    expect(xpToNext(1)).toBe(800);
    expect(xpToNext(2)).toBe(1850);
    expect(xpToNext(49)).toBe(800 + 1050 * 48);
    expect(xpToNext(50)).toBe(0);
    for (let l = 2; l <= MAX_LEVEL; l++) expect(XP_TABLE[l]! - XP_TABLE[l - 1]!).toBe(xpToNext(l - 1));
    expect(XP_TABLE[MAX_LEVEL]).toBe(1274000);
    expect(levelForXp(XP_TABLE[10]! - 1)).toBe(9);
    expect(levelForXp(XP_TABLE[10]!)).toBe(10);
    expect(levelProgress(400)).toBeCloseTo(0.5);
    expect(levelProgress(XP_TABLE[MAX_LEVEL]!)).toBe(1);
  });

  it('addXp gains several levels at once and clamps at 50', () => {
    const p = newProfile('a', 'A');
    expect(addXp(p, XP_TABLE[4]!)).toEqual([2, 3, 4]);
    expect(addXp(p, 0)).toEqual([]);
    expect(addXp(p, -50)).toEqual([]);
    addXp(p, 1e9);
    expect(p.level).toBe(MAX_LEVEL);
    expect(p.xp).toBe(XP_TABLE[MAX_LEVEL]);
  });

  it('maps levels to BO1-style ranks', () => {
    expect(rankFor(1)).toMatchObject({ title: 'Private', step: 1 });
    expect(rankFor(6)).toMatchObject({ title: 'Private First Class', step: 3 });
    expect(rankFor(50).title).toBe('Commander');
    expect(rankFor(99).title).toBe('Commander');
  });

  it('objective XP: table, aliases, per-event override, generic fallback', () => {
    expect(objectiveXp('capture')).toBe(200);
    expect(objectiveXp('bomb_plant')).toBe(500);
    expect(objectiveXp('capture', { xp: 0 })).toBe(0);
    expect(objectiveXp('capture', { xp: 75 })).toBe(75);
    expect(objectiveXp('something_new')).toBe(XP_SOURCES.objective);
  });
});

describe('prestige', () => {
  it('needs level 50 and stops at prestige 15', () => {
    const p = atLevel(49);
    expect(enterPrestige(p)).toEqual({ ok: false, reason: 'level' });
    const top = atLevel(50, MAX_PRESTIGE);
    expect(enterPrestige(top)).toEqual({ ok: false, reason: 'max_prestige' });
  });

  it('resets level, XP, unlocks and attachment progress; keeps CP, challenges and stats; grants the emblem', () => {
    const p = atLevel(50);
    p.codPoints = 12345;
    p.challengeProgress = { career_kills: 777 };
    p.stats = { kills: 900, deaths: 450 };
    p.unlocks = ['ak47', 'store_thing'];
    progressionExt(p).weaponKills = { ak47: 300 };
    syncUnlocks(p);
    expect(p.unlocks).toContain('feature:createAClass');
    expect(p.unlocks).toContain('store_thing');

    const res = enterPrestige(p);
    expect(res).toEqual({ ok: true, prestige: 1, emblem: 'prestige_1' });
    expect(p).toMatchObject({ prestige: 1, level: 1, xp: 0, codPoints: 12345, challengeProgress: { career_kills: 777 }, stats: { kills: 900, deaths: 450 } });
    expect(progressionExt(p).weaponKills).toEqual({});
    expect(progressionExt(p).emblem).toBe('prestige_1');
    expect(p.owned).toContain('prestige_1');
    expect(p.unlocks).toContain('prestige_1');
    expect(p.unlocks).not.toContain('feature:createAClass');
    expect(classSlots(p)).toBe(0);

    // Back to 50 and again: earlier emblems stay.
    addXp(p, 2e6);
    enterPrestige(p);
    expect(p.prestige).toBe(2);
    expect(p.unlocks).toEqual(expect.arrayContaining(['prestige_1', 'prestige_2']));
  });
});

describe('unlock gating', () => {
  it('builds a sorted 1-50 table with Create-a-Class and class slots', () => {
    const t = unlockTable();
    for (let i = 1; i < t.length; i++) expect(t[i]!.level).toBeGreaterThanOrEqual(t[i - 1]!.level);
    expect(unlocksAtLevel(4).map((u) => u.id)).toEqual(expect.arrayContaining(['feature:createAClass', 'class:1']));
    expect(t.some((u) => u.id === 'ak47' && u.kind === 'weapon')).toBe(true);
    expect(t.some((u) => u.kind === 'lethal')).toBe(true);
  });

  it('gates perks, killstreaks and equipment by level with reasons', () => {
    UNLOCK_LEVEL_OVERRIDES.hardline = 8;
    UNLOCK_LEVEL_OVERRIDES.uav = 3;
    const lo = { ...cloneLoadout(DEFAULT_LOADOUTS[1]!), lethal: 'semtex', tactical: 'mystery_gadget' };
    const low = gateLoadout(atLevel(2), lo);
    expect(low.loadout.perks).toEqual(['steady_aim']);
    expect(low.loadout.killstreaks).toEqual([]);
    expect(low.loadout.lethal).toBeNull();
    expect(low.loadout.tactical).toBe('mystery_gadget'); // unknown ids are not ours to gate
    expect(low.violations.map((v) => `${v.kind}:${v.id}:${v.reason}`)).toEqual(['perk:hardline:Requires level 8', 'killstreak:uav:Requires level 3', 'lethal:semtex:Requires level 6']);
    const high = gateLoadout(atLevel(8), lo);
    expect(high.violations).toEqual([]);
    expect(high.loadout.perks).toEqual(['hardline', 'steady_aim']);
  });

  it('gates attachments by kills with that weapon since prestige', () => {
    const reddot = ATTACHMENT_BY_ID.get('reddot')!;
    const old = reddot.unlockKills;
    reddot.unlockKills = 10;
    try {
      const p = atLevel(10);
      const lo = cloneLoadout(DEFAULT_LOADOUTS[1]!); // AK-47 with red dot
      progressionExt(p).weaponKills.ak47 = 9;
      const g = gateLoadout(p, lo);
      expect(g.loadout.primary.attachments).toEqual([]);
      expect(g.violations[0]).toMatchObject({ kind: 'attachment', id: 'reddot', reason: 'Requires 10 AK-47 kills' });
      progressionExt(p).weaponKills.ak47 = 10;
      expect(gateLoadout(p, lo).loadout.primary.attachments).toEqual(['reddot']);
      expect(computeUnlockIds(p)).toContain('ak47:reddot');
    } finally {
      reddot.unlockKills = old;
    }
  });

  it('replaces a locked weapon (and records it) and honours UNLOCK_RULES', () => {
    UNLOCK_LEVEL_OVERRIDES.ak47 = 5;
    const p = atLevel(1);
    const g = gateLoadout(p, cloneLoadout(DEFAULT_LOADOUTS[1]!));
    expect(g.violations[0]).toMatchObject({ kind: 'weapon', id: 'ak47' });
    expect(g.loadout.primary.attachments).toEqual([]);
    UNLOCK_RULES.push((_p, kind, id) => (kind === 'weapon' && id === 'ak47' ? true : undefined));
    expect(isUnlocked(p, 'weapon', 'ak47')).toBe(true);
  });

  it('uses default classes until Create-a-Class, then custom slots at 4/10/20/30/40 (+prestige)', () => {
    const p = atLevel(3);
    p.loadouts[0] = { ...cloneLoadout(DEFAULT_LOADOUTS[0]!), name: 'Mine' };
    expect(classSlots(p)).toBe(0);
    expect(classForSelection(p, 0).name).toBe(DEFAULT_LOADOUTS[0]!.name);
    expect(classForSelection(p, 4).name).toBe(DEFAULT_LOADOUTS[1]!.name);
    const q = atLevel(4);
    q.loadouts[0] = { ...cloneLoadout(DEFAULT_LOADOUTS[0]!), name: 'Mine' };
    expect(classSlots(q)).toBe(1);
    expect(classForSelection(q, 0).name).toBe('Mine');
    expect(classSlots(atLevel(20))).toBe(3);
    expect(classSlots(atLevel(40))).toBe(5);
    expect(classSlots(atLevel(40, 4))).toBe(7);
    expect(usableClassCount(atLevel(4))).toBe(DEFAULT_LOADOUTS.length);
  });

  it('syncUnlocks keeps foreign ids and drops stale progression ids', () => {
    const p = atLevel(1);
    p.unlocks = ['feature:createAClass', 'camo_tiger'];
    const added = syncUnlocks(p);
    expect(p.unlocks).not.toContain('feature:createAClass');
    expect(p.unlocks).toContain('camo_tiger');
    expect(added).toContain('ak47');
  });

  it('pro perks unlock from their challenge', () => {
    const perk = PERKS[0]!;
    const p = atLevel(1);
    expect(isUnlocked(p, 'pro', perk.id)).toBe(false);
    p.challengeProgress[perk.pro.challenge] = 9999;
    expect(isUnlocked(p, 'pro', perk.id)).toBe(true);
    expect(computeUnlockIds(p)).toContain(`pro:${perk.id}`);
  });
});

describe('challenges', () => {
  it('generates a rich, unique set from the registries', () => {
    const list = challengeList();
    expect(new Set(list.map((c) => c.id)).size).toBe(list.length);
    for (const m of MODES) {
      expect(challengeById(`${m.id}_wins`)?.mode).toBe(m.id);
      expect(challengeById(`${m.id}_kills`)).toBeTruthy();
    }
    for (const id of Object.keys(DEFAULT_TARGET_PLAYERS)) expect(MODE_CHALLENGE_TEMPLATES[id]?.length, id).toBeGreaterThan(0);
    for (const w of WEAPONS) {
      expect(challengeById(`w_${w.id}_kills`)?.weapon).toBe(w.id);
      expect(challengeById(`w_${w.id}_headshots`)).toBeTruthy();
      for (const a of w.attachments) expect(challengeById(`w_${w.id}_${a}`)?.attachment).toBe(a);
    }
    for (const p of PERKS) expect(challengeById(p.pro.challenge)?.grants).toBe(`pro:${p.id}`);
    for (const c of list) {
      const tiers = c.tiers ?? [c.goal];
      for (let i = 1; i < tiers.length; i++) expect(tiers[i]!, c.id).toBeGreaterThan(tiers[i - 1]!);
      if (c.xpTiers) expect(c.xpTiers.length, c.id).toBe(tiers.length);
      expect(c.description, c.id).toBeTruthy();
    }
    expect(list.length).toBeGreaterThan(40);
  });

  it('advances tiers, pays each tier once, and keeps the best for max metrics', () => {
    const prog: Record<string, number> = {};
    const kills = challengeById('career_kills')!;
    const a = advanceChallenge(prog, kills, 99)!;
    expect(a.completed).toEqual([]);
    const b = advanceChallenge(prog, kills, 450)!;
    expect(b.completed).toEqual([0, 1]);
    expect(b.xp).toBe(500 + 1500);
    expect(b.codPoints).toBe(100 + 250);
    expect(tiersDone(kills, prog.career_kills!)).toBe(2);
    expect(advanceChallenge(prog, kills, 0)).toBeNull();
    const streak = challengeById('career_streak')!;
    advanceChallenge(prog, streak, 7);
    expect(advanceChallenge(prog, streak, 3)).toBeNull();
    expect(prog.career_streak).toBe(7);
    expect(tierName(kills, 2)).toBe('Killer III');
    expect(describeChallenge(kills, 1)).toBe('Get 500 kills.');
  });

  it('filters by mode, weapon, attachment, perk and means', () => {
    const c: ChallengeDef = { id: 'x', name: 'X', metric: 'kills', goal: 1, xp: 1, mode: 'tdm', weapon: 'ak47', attachment: 'reddot', perk: 'lightweight', means: 'bullet' };
    const ok = { mode: 'tdm', weapon: 'ak47', attachments: ['reddot'], perks: ['lightweight'], means: 'bullet' };
    expect(challengeMatches(c, ok)).toBe(true);
    expect(challengeMatches(c, { ...ok, mode: 'ffa' })).toBe(false);
    expect(challengeMatches(c, { ...ok, weapon: 'm1911' })).toBe(false);
    expect(challengeMatches(c, { ...ok, attachments: [] })).toBe(false);
    expect(challengeMatches(c, { ...ok, perks: [] })).toBe(false);
    expect(challengeMatches(c, { ...ok, means: 'melee' })).toBe(false);
    const prog: Record<string, number> = {};
    const adv = progressMetric(prog, 'kills', 1, { mode: 'tdm', weapon: 'ak47', weaponClass: 'ar', attachments: [], perks: [], means: 'bullet' });
    const ids = adv.map((x) => x.def.id);
    expect(ids).toEqual(expect.arrayContaining(['career_kills', 'tdm_kills', 'w_ak47_kills', 'class_ar_kills']));
    expect(ids).not.toContain('ffa_kills');
    expect(ids).not.toContain('career_melee');
  });

  it('accepts challenges from other areas (register / CHALLENGE_SOURCES)', () => {
    registerChallenges([{ id: 'test_reg', name: 'Reg', metric: 'test_metric', goal: 2, xp: 10 }]);
    CHALLENGE_SOURCES.push(() => [{ id: 'test_src', name: 'Src', metric: 'test_metric', goal: 1, xp: 5 }]);
    const prog: Record<string, number> = {};
    expect(progressMetric(prog, 'test_metric', 1, {}).map((a) => a.def.id).sort()).toEqual(['test_reg', 'test_src']);
    registerChallenges([{ id: 'test_reg', name: 'Reg 2', metric: 'test_metric', goal: 5, xp: 10 }]);
    expect(challengeById('test_reg')!.name).toBe('Reg 2');
  });
});

// ---------------------------------------------------------------------------------------------
// Rules through a real room (no sockets)
// ---------------------------------------------------------------------------------------------

let store: Store | undefined;
let lobby: Lobby | undefined;

afterEach(() => {
  lobby?.shutdown();
  store?.close();
  lobby = undefined;
  store = undefined;
});

function setup(opts: Partial<RoomOptions> = {}): Room {
  store = new Store(':memory:');
  lobby = new Lobby({ store, features: [progression], log: () => {}, autoTick: false });
  return lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false, ...opts });
}

const steps = (room: Room, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) room.step();
};

function human(room: Room, profile = newProfile('prof-h', 'Human')): PlayerState {
  const s = new Session('sess-h', null, profile, 'tok');
  return room.addHuman(s);
}

function killWith(room: Room, a: PlayerState, b: PlayerState, extra: { part?: 'head' | 'torso'; distance?: number; weapon?: string; means?: string } = {}) {
  room.damage({ victim: b, attacker: a, amount: 500, weapon: extra.weapon ?? 'ak47', part: extra.part ?? 'torso', means: extra.means ?? 'bullet', from: null, distance: extra.distance ?? 10 });
}

describe('progression in a room', () => {
  it('awards kill XP, medals, challenge progress, weapon stats and a match summary', () => {
    const room = setup();
    const h = human(room);
    const bot = room.addBot({ name: 'Bot', team: h.team === 0 ? 1 : 0 });
    steps(room, 0.5);
    expect(h.alive && bot.alive).toBe(true);
    const prof = h.profile!;
    killWith(room, h, bot, { part: 'head', distance: 40 });
    // kill 100 + first blood 100 + headshot 50 + longshot 50, plus the "First Blood I" challenge (500)
    expect(prof.xp).toBe(300 + 500);
    expect(prof.challengeProgress.career_firstblood).toBe(1);
    expect(prof.challengeProgress.career_kills).toBe(1);
    expect(prof.challengeProgress.career_headshots).toBe(1);
    expect(prof.challengeProgress.w_ak47_kills).toBe(1);
    expect(prof.challengeProgress.career_longshots).toBe(1);
    expect(prof.stats['weapon.ak47.kills']).toBe(1);
    expect(progressionExt(prof).weaponKills.ak47).toBe(1);

    steps(room, 3.5); // bot respawns
    expect(bot.alive).toBe(true);
    killWith(room, h, bot);
    expect(h.ext.progression!.lines.get('kill')!.count).toBe(2);
    expect(h.ext.progression!.lines.get('firstblood')!.count).toBe(1);

    room.endMatch('score');
    const s = matchSummaryFor(room.results, h.id) as MatchXpSummary;
    expect(s).toBeTruthy();
    expect(s.lines.find((l) => l.key === 'kill')).toMatchObject({ count: 2, xp: 200 });
    expect(s.total).toBe(prof.xp);
    expect(s.xpBefore).toBe(0);
    expect(s.challenges.some((c) => c.id === 'career_kills' && c.after === 2)).toBe(true);
    expect(progressionExt(prof).lastMatch?.total).toBe(s.total);
    expect(matchSummaryFor(room.results, bot.id)).toBeNull();
  });

  it('levels up mid-match, completes challenge tiers for XP and CoD Points', () => {
    const room = setup();
    const profile = newProfile('prof-l', 'Leveler');
    profile.xp = 790;
    profile.challengeProgress.career_kills = 99;
    const h = human(room, profile);
    const bot = room.addBot({ team: h.team === 0 ? 1 : 0 });
    steps(room, 0.5);
    const levels: number[] = [];
    const completes: string[] = [];
    room.bus.on('progression.levelUp', (e) => levels.push(e.level));
    room.bus.on('progression.challengeComplete', (e) => completes.push(`${e.id}:${e.tier}`));
    const cp = profile.codPoints;
    killWith(room, h, bot);
    expect(levels).toEqual([2]);
    expect(profile.level).toBe(2);
    expect(completes).toContain('career_kills:1');
    expect(profile.codPoints).toBe(cp + 100 + (challengeById('career_firstblood')!.codPoints ?? 0));
    expect(h.ext.progression!.lines.get('challenge')!.xp).toBeGreaterThanOrEqual(500);
  });

  it('gates the spawn loadout server-side', () => {
    UNLOCK_LEVEL_OVERRIDES.hardline = 8;
    const room = setup();
    const profile = newProfile('prof-g', 'Gated');
    profile.selectedLoadout = 1; // Rifleman: hardline + steady aim
    const h = human(room, profile);
    steps(room, 0.2);
    expect(h.loadout!.perks).toEqual(['steady_aim']);
  });

  it('objective events give XP and count objective metrics', () => {
    const room = setup();
    const h = human(room);
    steps(room, 0.2);
    room.bus.emit('objective', { kind: 'flag_capture', team: h.team, player: h, data: undefined });
    expect(h.profile!.xp).toBe(200);
    expect(h.profile!.stats['obj.capture']).toBe(1);
    expect(h.ext.progression!.lines.get('obj.capture')!.label).toBe('CAPTURE');
    room.bus.emit('progression.xp', { player: h, amount: 25, label: 'SPY PLANE ASSIST' });
    expect(h.profile!.xp).toBe(225);
  });

  it('earns nothing in rooms that do not persist, and bots never earn', () => {
    const room = setup({ persist: false });
    const h = human(room);
    const bot = room.addBot({ team: h.team === 0 ? 1 : 0 });
    steps(room, 0.5);
    killWith(room, h, bot);
    killWith(room, bot, h);
    expect(h.profile!.xp).toBe(0);
    room.endMatch('score');
    expect(matchSummaryFor(room.results, h.id)).toBeNull();
  });

  it('tracks killstreaks earned from the loadout (with streakCostOffset)', () => {
    const room = setup();
    const profile = newProfile('prof-k', 'Streaker');
    const h = human(room, profile);
    const bots = [room.addBot({ team: h.team === 0 ? 1 : 0 }), room.addBot({ team: h.team === 0 ? 1 : 0 }), room.addBot({ team: h.team === 0 ? 1 : 0 })];
    steps(room, 0.5);
    for (const b of bots) {
      b.move = { ...createMoveState(b.move.x, b.move.y, b.move.z), onGround: true };
      killWith(room, h, b);
    }
    expect(profile.challengeProgress.ks_uav_earned).toBe(1);
    expect(profile.challengeProgress.career_streak).toBe(3);
    expect(profile.challengeProgress.career_triple).toBe(1);
  });
});
