import { describe, expect, it } from 'vitest';
import { BOT_SKILL_RANGES, DEFAULT_LOBBY_BOTS, type LobbyBotSettings } from '../src/shared/defs/bots';
import type { WeaponDef } from '../src/shared/defs/weapons';
import { WEAPON_BY_ID } from '../src/shared/defs/weapons';
import { botsToFill, clampLimits, CODE_ALPHABET, defaultBotSettings, lobbyStatusText, makeLobbyCode, normalizeCode, RANDOM_MAP, sanitizeBotSettings, scoreLimitOptions, SKILL_KEYS, tallyVote, timeLimitOptions, voteOptions } from '../src/shared/frontend/lobby';
import { attachmentSlotsFor, CATALOG, classSlotsFor, itemLock, sortKillstreaks, validateLoadout, weaponStats, type Catalog } from '../src/shared/frontend/loadout-rules';
import { PLAYLISTS, playlistMode } from '../src/shared/frontend/playlists';
import { DEFAULT_LOADOUTS } from '../src/shared/loadout';
import { newProfile } from '../src/shared/profile';

/** Deterministic rand from a list. */
const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++ % v.length]!;
};

describe('lobby codes', () => {
  it('makes 6-char codes from the unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const c = makeLobbyCode();
      expect(c).toHaveLength(6);
      for (const ch of c) expect(CODE_ALPHABET).toContain(ch);
    }
    expect(makeLobbyCode(() => 0)).toBe('AAAAAA');
    expect(makeLobbyCode(() => 0.9999)).toBe('999999');
  });

  it('normalizes typed codes and invite links', () => {
    expect(normalizeCode('abc-def')).toBe('ABCDEF');
    expect(normalizeCode(' x7k 2qp ')).toBe('X7K2QP');
    expect(normalizeCode('https://lofi.example/#/lobby?code=x7k2qp')).toBe('X7K2QP');
    expect(normalizeCode('ABCDE')).toBeNull();
    expect(normalizeCode('ABCDE0')).toBeNull(); // 0 is not in the alphabet
    expect(normalizeCode(42)).toBeNull();
  });
});

describe('map vote', () => {
  it('offers two distinct maps plus random, avoiding the current map', () => {
    const o = voteOptions(['yard', 'nuketown', 'rust', 'firing'], 'yard', seq(0, 0));
    expect(o).toHaveLength(3);
    expect(o[2]).toBe(RANDOM_MAP);
    expect(o[0]).not.toBe(o[1]);
    expect(o.slice(0, 2)).not.toContain('yard');
  });

  it('with two maps both are offered, with one map it is map + random', () => {
    expect(new Set(voteOptions(['yard', 'rust'], 'yard', seq(0.1, 0.1)).slice(0, 2))).toEqual(new Set(['yard', 'rust']));
    expect(voteOptions(['yard'], 'yard')).toEqual(['yard', RANDOM_MAP]);
    expect(voteOptions([], null)).toEqual([RANDOM_MAP]);
  });

  it('most votes wins; ties and no votes go to the earliest option; random resolves to a map', () => {
    const opts = ['nuketown', 'rust', RANDOM_MAP];
    expect(tallyVote(opts, [1, 1, 0], ['yard'])).toBe('rust');
    expect(tallyVote(opts, [0, 1], ['yard'])).toBe('nuketown');
    expect(tallyVote(opts, [], ['yard'])).toBe('nuketown');
    expect(tallyVote(opts, [2, 2, 0, 9, -1], ['yard', 'firing'], () => 0.99)).toBe('firing');
  });
});

describe('bot settings', () => {
  const max = 12;
  it('defaults per mode, capped by max players', () => {
    expect(defaultBotSettings({ id: 'tdm', maxPlayers: 12 }).targetPlayers).toBe(12);
    expect(defaultBotSettings({ id: 'ffa', maxPlayers: 8 })).toMatchObject({ fill: true, difficulty: 'regular', targetPlayers: 8 });
    expect(defaultBotSettings({ id: 'tdm', maxPlayers: 6 }).targetPlayers).toBe(6);
  });

  it('validates an untrusted patch: clamps target and variance, ignores junk', () => {
    const s = sanitizeBotSettings({ targetPlayers: 99, variance: 5, difficulty: 'godlike', fill: 'yes', evil: true }, DEFAULT_LOBBY_BOTS, max);
    expect(s).toEqual({ ...DEFAULT_LOBBY_BOTS, targetPlayers: 12, variance: 1, custom: undefined });
    expect(sanitizeBotSettings({ targetPlayers: -3 }, DEFAULT_LOBBY_BOTS, max).targetPlayers).toBe(1);
    expect(sanitizeBotSettings({ difficulty: 'veteran', fill: false }, DEFAULT_LOBBY_BOTS, max)).toMatchObject({ difficulty: 'veteran', fill: false });
  });

  it('custom skill fills every knob, clamped and snapped to the slider ranges', () => {
    const s = sanitizeBotSettings({ difficulty: 'custom', custom: { reactionMs: 5, aimErrorDeg: 3.33333, aggression: 2, turnSpeedDeg: 'fast' } }, DEFAULT_LOBBY_BOTS, max);
    expect(s.difficulty).toBe('custom');
    const c = s.custom!;
    for (const k of SKILL_KEYS) {
      const [min, maxV] = BOT_SKILL_RANGES[k];
      expect(c[k]).toBeGreaterThanOrEqual(min);
      expect(c[k]).toBeLessThanOrEqual(maxV);
    }
    expect(c.reactionMs).toBe(100);
    expect(c.aimErrorDeg).toBeCloseTo(3.3, 5);
    expect(c.aggression).toBe(1);
    expect(c.turnSpeedDeg).toBe(240); // junk -> previous (regular preset)
    // A later patch only touching one knob keeps the others.
    const s2 = sanitizeBotSettings({ custom: { strafe: 0.9 } }, s, max);
    expect(s2.custom).toEqual({ ...c, strafe: 0.9 });
  });

  it('bots to fill = target - humans when filling', () => {
    const s: LobbyBotSettings = { ...DEFAULT_LOBBY_BOTS, targetPlayers: 8 };
    expect(botsToFill(s, 1, 12)).toBe(7);
    expect(botsToFill(s, 9, 12)).toBe(0);
    expect(botsToFill({ ...s, targetPlayers: 20 }, 2, 12)).toBe(10);
    expect(botsToFill({ ...s, fill: false }, 1, 12)).toBe(0);
  });

  it('status line counts down to the bot backfill', () => {
    const base = { status: 'waiting' as const, kind: 'matchmade' as const, waitEndsAt: 20, countdownEndsAt: null, botsToFill: 5, hostId: null, bots: DEFAULT_LOBBY_BOTS };
    expect(lobbyStatusText(base, 7.5)).toBe('Waiting for players... starting with bots in 13s');
    expect(lobbyStatusText({ ...base, countdownEndsAt: 12 }, 7.5)).toBe('Match starting in 5s');
    expect(lobbyStatusText({ ...base, kind: 'private', waitEndsAt: null, hostId: 'a' }, 0)).toBe('Waiting for the host to start');
  });
});

describe('limits', () => {
  const tdm = { scoreLimit: 75, timeLimitSec: 600 };
  it('clamps host limits', () => {
    expect(clampLimits(tdm, { scoreLimit: 150, timeLimitSec: 99999 })).toEqual({ scoreLimit: 150, timeLimitSec: 3600 });
    expect(clampLimits(tdm, { scoreLimit: -5 })).toEqual({ scoreLimit: 0, timeLimitSec: 600 });
    expect(clampLimits(tdm, 'nope', { scoreLimit: 10, timeLimitSec: 60 })).toEqual({ scoreLimit: 10, timeLimitSec: 60 });
  });
  it('offers sensible choices incl. unlimited', () => {
    expect(scoreLimitOptions(tdm)).toEqual([38, 75, 113, 150, 0]);
    expect(timeLimitOptions(tdm).at(-1)).toBe(0);
    expect(timeLimitOptions(tdm)).toContain(600);
  });
});

describe('playlists', () => {
  it('core playlists exist and unregistered modes are unavailable', () => {
    expect(PLAYLISTS.map((p) => p.id)).toEqual(['tdm', 'ffa', 'dom', 'sd', 'hq', 'kc']);
    expect(playlistMode(PLAYLISTS[0]!)).toBe('tdm');
  });
});

// ---------------------------------------------------------------------------------------------
// Create-a-class rules with an injected catalog (so locked items exist regardless of defs).
// ---------------------------------------------------------------------------------------------

const ak = WEAPON_BY_ID.get('ak47')!;
// price: 0 so fixtures lock by level/kills only (the real AK-47 has a CP price since the weapons merge).
const gun = (id: string, extra: Partial<WeaponDef>): WeaponDef => ({ ...ak, id, name: id.toUpperCase(), price: 0, ...extra });
const testCatalog: Catalog = {
  ...CATALOG,
  weapons: new Map<string, WeaponDef>([
    ['ak47', ak],
    ['m1911', WEAPON_BY_ID.get('m1911')!],
    ['l96', gun('l96', { class: 'sniper', unlockLevel: 20, attachments: ['acog'] })],
    ['famas', gun('famas', { unlockLevel: 1, attachments: ['reddot', 'acog', 'extmag', 'suppressor'] })],
  ]),
  attachments: new Map([
    ['reddot', { id: 'reddot', name: 'Red Dot', slot: 'optic' as const, modifiers: {}, unlockKills: 0 }],
    ['acog', { id: 'acog', name: 'ACOG', slot: 'optic' as const, modifiers: { zoom: 2 }, unlockKills: 30 }],
    ['extmag', { id: 'extmag', name: 'Ext Mag', slot: 'magazine' as const, modifiers: {}, unlockKills: 0 }],
    ['suppressor', { id: 'suppressor', name: 'Suppressor', slot: 'muzzle' as const, modifiers: { suppressed: true }, unlockKills: 0 }],
  ]),
  perks: new Map([
    ['lightweight', { id: 'lightweight', name: 'Lightweight', tier: 1 as const, description: '', pro: { description: '', challenge: '' }, unlockLevel: 1 }],
    ['hardline', { id: 'hardline', name: 'Hardline', tier: 1 as const, description: '', pro: { description: '', challenge: '' }, unlockLevel: 1 }],
    ['warlord', { id: 'warlord', name: 'Warlord', tier: 2 as const, description: '', pro: { description: '', challenge: '' }, unlockLevel: 1 }],
    ['ninja', { id: 'ninja', name: 'Ninja', tier: 3 as const, description: '', pro: { description: '', challenge: '' }, unlockLevel: 30 }],
  ]),
  killstreaks: new Map([
    ['dogs', { id: 'dogs', name: 'Attack Dogs', kills: 11, description: '', unlockLevel: 1, kind: 'called' as const }],
    ['uav', { id: 'uav', name: 'Spy Plane', kills: 3, description: '', unlockLevel: 1, kind: 'called' as const }],
    ['rcxd', { id: 'rcxd', name: 'RC-XD', kills: 3, description: '', unlockLevel: 1, kind: 'controlled' as const }],
    ['napalm', { id: 'napalm', name: 'Napalm', kills: 5, description: '', unlockLevel: 1, kind: 'called' as const }],
    ['heli', { id: 'heli', name: 'Attack Helicopter', kills: 7, description: '', unlockLevel: 40, kind: 'called' as const }],
  ]),
  camos: new Map([
    ['none', { id: 'none', name: 'None', price: 0, recipe: null }],
    ['tiger', { id: 'tiger', name: 'Tiger', price: 500, recipe: {} }],
    ['gold', { id: 'gold', name: 'Gold', unlock: { level: 45 }, recipe: {} }],
  ]),
};

describe('create-a-class validation', () => {
  const prof = () => newProfile('p1', 'Tester');

  it('reports unlock requirements', () => {
    const p = prof();
    expect(itemLock(p, 'weapon', 'l96', null, testCatalog)).toEqual({ unlocked: false, requirement: 'Level 20' });
    expect(itemLock({ ...p, level: 20 }, 'weapon', 'l96', null, testCatalog).unlocked).toBe(true);
    expect(itemLock(p, 'attachment', 'acog', 'famas', testCatalog).requirement).toBe('30 kills with FAMAS (0/30)');
    expect(itemLock({ ...p, stats: { 'weapon.famas.kills': 30 } }, 'attachment', 'acog', 'famas', testCatalog).unlocked).toBe(true);
    expect(itemLock(p, 'camo', 'tiger', 'ak47', testCatalog).requirement).toBe('Store: 500 CP');
    expect(itemLock({ ...p, owned: ['none', 'tiger'] }, 'camo', 'tiger', 'ak47', testCatalog).unlocked).toBe(true);
    expect(itemLock(p, 'camo', 'gold', 'ak47', testCatalog).requirement).toBe('Level 45');
    // Explicit grants from other features always unlock.
    expect(itemLock({ ...p, unlocks: ['l96'] }, 'weapon', 'l96', null, testCatalog).unlocked).toBe(true);
    expect(itemLock({ ...p, unlocks: ['famas:acog'] }, 'attachment', 'acog', 'famas', testCatalog).unlocked).toBe(true);
  });

  it('accepts a valid class untouched (killstreaks sorted by kills)', () => {
    const input = { name: 'Rusher', primary: { weapon: 'famas', attachments: ['reddot'], camo: 'none' }, secondary: { weapon: 'm1911', attachments: [], camo: 'none' }, perks: ['lightweight'], killstreaks: ['dogs', 'napalm', 'uav'], lethal: 'semtex', tactical: 'flashbang' };
    const { loadout, problems } = validateLoadout(prof(), input, DEFAULT_LOADOUTS[0], testCatalog);
    expect(problems).toEqual([]);
    expect(loadout.killstreaks).toEqual(['uav', 'napalm', 'dogs']);
    expect(loadout.primary).toEqual({ weapon: 'famas', attachments: ['reddot'], camo: 'none' });
    expect(loadout.lethal).toBe('semtex');
  });

  it('replaces locked picks and enforces slots, tiers and limits', () => {
    const input = {
      name: '<b>x</b>',
      primary: { weapon: 'l96', attachments: ['acog'], camo: 'tiger' },
      secondary: { weapon: 'ak47', attachments: [], camo: 'none' },
      perks: ['lightweight', 'hardline', 'ninja'],
      killstreaks: ['uav', 'rcxd', 'napalm', 'dogs', 'heli'],
      lethal: 'flashbang', // a tactical, not a lethal
      tactical: 'nope',
    };
    const { loadout, problems } = validateLoadout(prof(), input, DEFAULT_LOADOUTS[0], testCatalog);
    expect(loadout.primary.weapon).toBe('ak47'); // L96 locked -> fallback
    expect(loadout.primary.camo).toBe('none'); // tiger not owned
    expect(loadout.secondary.weapon).toBe('m1911'); // AK is not a secondary
    expect(loadout.perks).toEqual(['lightweight']); // hardline: same tier, ninja: locked
    expect(loadout.killstreaks).toEqual(['rcxd', 'uav', 'napalm']); // heli locked, 4th dropped, ties by id
    expect(loadout.lethal).toBeNull();
    expect(loadout.tactical).toBeNull();
    expect(loadout.name).toBe('bx/b');
    expect(problems.join(' | ')).toMatch(/L96 is locked \(Level 20\)/);
    expect(problems.join(' | ')).toMatch(/only one tier 1 perk/);
    expect(problems.join(' | ')).toMatch(/Ninja is locked/);
  });

  it('one attachment without Warlord, two with it, one per attachment slot type', () => {
    const base = { primary: { weapon: 'famas', attachments: ['reddot', 'extmag', 'suppressor'], camo: 'none' }, secondary: { weapon: 'm1911', attachments: [] } };
    expect(validateLoadout(prof(), { ...base, perks: [] }, undefined, testCatalog).loadout.primary.attachments).toEqual(['reddot']);
    expect(validateLoadout(prof(), { ...base, perks: ['warlord'] }, undefined, testCatalog).loadout.primary.attachments).toEqual(['reddot', 'extmag']);
    const twoOptics = validateLoadout(prof(), { ...base, primary: { weapon: 'famas', attachments: ['reddot', 'acog'] }, perks: ['warlord'] }, undefined, { ...testCatalog });
    expect(twoOptics.loadout.primary.attachments).toEqual(['reddot']);
    expect(attachmentSlotsFor(['warlord'], testCatalog)).toBe(2);
    expect(attachmentSlotsFor(['lightweight'], testCatalog)).toBe(1);
  });

  it('default loadouts keep their lethal and tactical (ids match the weapons equipment defs)', () => {
    for (const d of DEFAULT_LOADOUTS) {
      const { loadout } = validateLoadout(prof(), d, DEFAULT_LOADOUTS[0]);
      expect(loadout.lethal).toBe(d.lethal);
      expect(loadout.tactical).toBe(d.tactical);
    }
    expect(CATALOG.equipment.get('flashbang')?.kind).toBe('tactical');
  });

  it('garbage in, default-shaped loadout out', () => {
    const { loadout } = validateLoadout(prof(), 'garbage');
    expect(loadout.primary.weapon).toBe(DEFAULT_LOADOUTS[0]!.primary.weapon);
    expect(loadout.secondary.weapon).toBe(DEFAULT_LOADOUTS[0]!.secondary.weapon);
    expect(loadout.killstreaks).toEqual([]);
  });

  it('class slots grow with prestige; killstreak sort; stat bars in range', () => {
    expect(classSlotsFor({ prestige: 0 })).toBe(5);
    expect(classSlotsFor({ prestige: 3 })).toBe(8);
    expect(classSlotsFor({ prestige: 15 })).toBe(10);
    expect(sortKillstreaks(['dogs', 'rcxd', 'uav', 'bogus'], testCatalog)).toEqual(['rcxd', 'uav', 'dogs']);
    const s = weaponStats(ak);
    for (const v of Object.values(s)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(weaponStats(WEAPON_BY_ID.get('m1911')!).mobility).toBeGreaterThan(s.mobility);
  });
});
