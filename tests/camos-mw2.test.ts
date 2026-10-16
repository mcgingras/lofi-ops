/**
 * The MW2 camo collection: defs (MW2's eight camos and Expert I-VI headshot ladder, recipes), the
 * per-weapon unlock rule at its thresholds, Create-a-Class validation and the save / setCamo RPCs,
 * the spawn check, the store's gun-page data, per-weapon headshot stats and the unlock popup, and
 * bot camos.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { registerWeaponBehavior } from '../src/server/combat';
import { chooseBotLoadout, pickBotCamo } from '../src/server/features/bots/loadout';
import economy from '../src/server/features/economy/index';
import frontend from '../src/server/features/frontend/index';
import progression from '../src/server/features/progression/index';
import type { Feature, ServerApi } from '../src/server/feature';
import { Lobby } from '../src/server/lobby';
import { registerMode } from '../src/server/modes/index';
import type { PlayerState } from '../src/server/player';
import type { Room } from '../src/server/room';
import { RpcRegistry } from '../src/server/rpc';
import { Session } from '../src/server/session';
import { Store } from '../src/server/store';
import { TICK_DT } from '../src/shared/constants';
import { camoFitsWeapon, challengeProgress, mw2CamoProgress, mw2CamosUnlockedBetween, weaponCamoProgress, weaponCamoUnlocked } from '../src/shared/defs/camo-unlocks';
import { CAMO_BY_ID, camoName, CAMOS, GLOBAL_CAMOS, MW2_CAMOS, type CamoDef } from '../src/shared/defs/camos';
import { canUseCamo, enforceLoadout, keyOf, purchase, storeCatalog, storeItem } from '../src/shared/defs/store';
import { WEAPON_BY_ID } from '../src/shared/defs/weapons';
import { itemLock, validateLoadout } from '../src/shared/frontend/loadout-rules';
import { mw2CamoCountLabel, mw2CamoSummary, storeGun, storeGunGroups } from '../src/shared/frontend/store-browse';
import { cloneLoadout, DEFAULT_LOADOUTS, sanitizeLoadout, type Loadout } from '../src/shared/loadout';
import { newProfile, type Profile } from '../src/shared/profile';
import { decodeServerMsg, type ServerMsg } from '../src/shared/protocol';

const PATTERNS = ['erdl', 'splinter', 'marpat', 'tigerstripe', 'fall'];
/** MW2 (CoD Wiki, "Call of Duty: Modern Warfare 2 Challenges", Expert I-VI; Desert/Arctic default). */
const MW2_LADDER: [string, string, number][] = [
  ['mw2_desert', 'Desert', 0],
  ['mw2_arctic', 'Arctic', 0],
  ['mw2_woodland', 'Woodland', 5],
  ['mw2_digital', 'Digital', 15],
  ['mw2_urban', 'Urban', 30],
  ['mw2_blue_tiger', 'Blue Tiger', 75],
  ['mw2_red_tiger', 'Red Tiger', 150],
  ['mw2_fall', 'Fall', 250],
];

const profileWith = (stats: Record<string, number> = {}, level = 10): Profile => {
  const p = newProfile('p1', 'Tester');
  p.level = level;
  Object.assign(p.stats, stats);
  return p;
};
const hs = (weapon: string, n: number) => ({ [`weapon.${weapon}.headshots`]: n });

describe('MW2 camo defs', () => {
  it('are MW2’s eight camos, in order, with the Expert headshot ladder', () => {
    expect(MW2_CAMOS.map((c) => [c.id, c.name, c.weaponChallenge?.headshots ?? 0])).toEqual(MW2_LADDER);
    expect(MW2_CAMOS.map((c) => c.weaponChallenge?.title ?? null)).toEqual([null, null, 'Expert I', 'Expert II', 'Expert III', 'Expert IV', 'Expert V', 'Expert VI']);
    for (const c of MW2_CAMOS) {
      expect(c.collection).toBe('mw2');
      expect(c.weaponChallenge?.kills ?? 0).toBe(0); // MW2's camos are headshot challenges (kills unlock attachments)
      expect(CAMO_BY_ID.get(c.id)).toBe(c);
      expect(CAMOS).toContain(c);
    }
  });

  it('every MW2 camo has a procedural recipe with an MW2 pattern and a palette', () => {
    for (const c of MW2_CAMOS) {
      expect(c.recipe, c.id).not.toBeNull();
      expect(PATTERNS, c.id).toContain(c.recipe!.pattern);
      expect(c.recipe!.colors!.length, c.id).toBeGreaterThanOrEqual(3);
      expect(c.recipe!.photo, c.id).toMatch(/^[a-z_]+$/);
    }
    const byId = Object.fromEntries(MW2_CAMOS.map((c) => [c.id, c.recipe!.pattern]));
    expect(byId).toEqual({ mw2_desert: 'erdl', mw2_arctic: 'splinter', mw2_woodland: 'erdl', mw2_digital: 'marpat', mw2_urban: 'erdl', mw2_blue_tiger: 'tigerstripe', mw2_red_tiger: 'tigerstripe', mw2_fall: 'fall' });
  });

  it('stay distinct from the global camos with the same names', () => {
    for (const name of ['Woodland', 'Desert', 'Digital', 'Red Tiger']) {
      const global = GLOBAL_CAMOS.find((c) => c.name === name)!;
      const mw2 = MW2_CAMOS.find((c) => c.name === name)!;
      expect(global.id).not.toBe(mw2.id);
      expect(camoName(mw2)).toBe(`${name} (MW2)`);
      expect(camoName(global)).toBe(name);
      expect(mw2.recipe!.pattern).not.toBe(global.recipe!.pattern);
    }
    expect(GLOBAL_CAMOS.some((c) => c.collection)).toBe(false);
  });

  it('are not sold: not in the store catalog, a purchase is refused', () => {
    const p = profileWith({}, 60);
    p.codPoints = 1e6;
    expect(storeCatalog().some((i) => i.id.startsWith('mw2_'))).toBe(false);
    expect(storeItem(keyOf.camo('mw2_fall'))).toBeUndefined();
    expect(purchase(p, keyOf.camo('mw2_fall'))).toEqual({ ok: false, reason: 'unknown' });
    expect(p.codPoints).toBe(1e6);
  });
});

describe('per-weapon unlock rule', () => {
  it('opens each camo at its headshot threshold with that gun, not one below', () => {
    for (const [id, , need] of MW2_LADDER) {
      if (need) expect(weaponCamoUnlocked(profileWith(hs('acr', need - 1)), id, 'acr'), `${id} @${need - 1}`).toBe(false);
      expect(weaponCamoUnlocked(profileWith(hs('acr', need)), id, 'acr'), `${id} @${need}`).toBe(true);
    }
  });

  it('counts only that gun: headshots with another gun don’t help', () => {
    const p = profileWith({ ...hs('ak47', 300), 'weapon.acr.kills': 999 });
    expect(weaponCamoUnlocked(p, 'mw2_fall', 'ak47')).toBe(true);
    expect(weaponCamoUnlocked(p, 'mw2_woodland', 'acr')).toBe(false);
    expect(weaponCamoUnlocked(p, 'mw2_desert', 'acr')).toBe(true);
  });

  it('shows progress text and fraction ("18/25 ...")', () => {
    const pr = weaponCamoProgress(profileWith(hs('m16a4', 22)), 'mw2_urban', 'm16a4')!;
    expect(pr).toMatchObject({ unlocked: false, fits: true, headshots: { have: 22, need: 30 }, progress: '22/30 M16A4 headshots', challenge: 'Expert III · 30 headshots' });
    expect(pr.fraction).toBeCloseTo(22 / 30);
    expect(weaponCamoProgress(profileWith(), 'mw2_arctic', 'm16a4')).toMatchObject({ unlocked: true, progress: 'Unlocked', challenge: 'Free', fraction: 1 });
    expect(weaponCamoProgress(profileWith(), 'woodland', 'm16a4')).toBeNull(); // a global camo
  });

  it('supports kill + headshot challenges (both must be met)', () => {
    const def: CamoDef = { id: 'test_combo', name: 'Combo', collection: 'mw2', weaponChallenge: { kills: 25, headshots: 10 }, recipe: null };
    const at = (k: number, h: number) => challengeProgress(profileWith({ 'weapon.ak47.kills': k, 'weapon.ak47.headshots': h }), def, 'ak47')!;
    expect(at(24, 10).unlocked).toBe(false);
    expect(at(25, 9).unlocked).toBe(false);
    expect(at(25, 10).unlocked).toBe(true);
    expect(at(18, 4)).toMatchObject({ progress: '18/25 AK-47 kills, 4/10 AK-47 headshots', challenge: '25 kills + 10 headshots' });
    expect(at(18, 4).fraction).toBeCloseTo(0.4); // the slower requirement
  });

  it('fits primaries only (MW2: no camos on secondaries)', () => {
    const wood = CAMO_BY_ID.get('mw2_woodland')!;
    expect(camoFitsWeapon(wood, WEAPON_BY_ID.get('acr'))).toBe(true);
    expect(camoFitsWeapon(wood, WEAPON_BY_ID.get('m1911'))).toBe(false);
    expect(camoFitsWeapon(CAMO_BY_ID.get('tiger')!, WEAPON_BY_ID.get('m1911'))).toBe(true);
    const p = profileWith(hs('m1911', 500));
    expect(weaponCamoProgress(p, 'mw2_desert', 'm1911')).toMatchObject({ fits: false, unlocked: false, progress: 'Primary weapons only' });
    expect(mw2CamosUnlockedBetween('m1911', { kills: 0, headshots: 0 }, { kills: 1, headshots: 5 })).toEqual([]);
  });

  it('lists what a kill opens (for the unlock popup)', () => {
    expect(mw2CamosUnlockedBetween('ak47', { kills: 9, headshots: 4 }, { kills: 10, headshots: 5 }).map((c) => c.id)).toEqual(['mw2_woodland']);
    expect(mw2CamosUnlockedBetween('ak47', { kills: 9, headshots: 5 }, { kills: 10, headshots: 5 })).toEqual([]);
  });

  it('canUseCamo: MW2 camos by the gun’s challenge, global ones by ownership', () => {
    const p = profileWith(hs('ak47', 15), 40);
    expect(canUseCamo(p, 'mw2_digital', 'ak47')).toBe(true);
    expect(canUseCamo(p, 'mw2_urban', 'ak47')).toBe(false);
    expect(canUseCamo(p, 'mw2_digital', 'famas')).toBe(false);
    expect(canUseCamo(p, 'mw2_desert', 'm1911')).toBe(false);
    expect(canUseCamo(p, 'none', 'm1911')).toBe(true);
    expect(canUseCamo(p, 'tiger', 'ak47')).toBe(false);
    p.owned.push(keyOf.camo('tiger'));
    expect(canUseCamo(p, 'tiger', 'm1911')).toBe(true);
    expect(canUseCamo(p, 'nope', 'ak47')).toBe(false);
  });
});

describe('Create-a-Class and the spawn check', () => {
  const classWith = (primaryCamo: string, secondaryCamo = 'none', primary = 'ak47'): Loadout => {
    const l = cloneLoadout(DEFAULT_LOADOUTS[0]!);
    l.primary = { weapon: primary, attachments: [], camo: primaryCamo };
    l.secondary = { ...l.secondary, camo: secondaryCamo };
    return l;
  };

  it('itemLock shows the gun’s progress on locked MW2 camos', () => {
    const p = profileWith(hs('ak47', 3));
    expect(itemLock(p, 'camo', 'mw2_woodland', 'ak47')).toEqual({ unlocked: false, requirement: '3/5 AK-47 headshots' });
    expect(itemLock(p, 'camo', 'mw2_desert', 'ak47').unlocked).toBe(true);
    expect(itemLock(p, 'camo', 'mw2_desert', 'm1911')).toEqual({ unlocked: false, requirement: 'Primary weapons only' });
    // A grant in profile.unlocks doesn't bypass the challenge (only the record counts).
    p.unlocks.push('mw2_woodland', 'ak47:mw2_woodland');
    expect(itemLock(p, 'camo', 'mw2_woodland', 'ak47').unlocked).toBe(false);
  });

  it('validateLoadout rejects locked MW2 camos and accepts unlocked ones', () => {
    const p = profileWith(hs('ak47', 4));
    let v = validateLoadout(p, classWith('mw2_woodland'));
    expect(v.loadout.primary.camo).toBe('none');
    expect(v.problems).toEqual(['Woodland (MW2) camo is locked (4/5 AK-47 headshots)']);
    p.stats['weapon.ak47.headshots'] = 5;
    v = validateLoadout(p, classWith('mw2_woodland'));
    expect(v.loadout.primary.camo).toBe('mw2_woodland');
    expect(v.problems).toEqual([]);
    v = validateLoadout(p, classWith('mw2_desert', 'mw2_arctic'));
    expect(v.loadout.primary.camo).toBe('mw2_desert');
    expect(v.loadout.secondary.camo).toBe('none');
    expect(v.problems).toEqual(['Arctic (MW2) camo is locked (Primary weapons only)']);
  });

  it('enforceLoadout (spawn) strips locked MW2 camos and keeps unlocked ones', () => {
    const p = profileWith(hs('ak47', 150));
    let r = enforceLoadout(p, classWith('mw2_red_tiger', 'mw2_desert'));
    expect(r.loadout.primary.camo).toBe('mw2_red_tiger');
    expect(r.loadout.secondary.camo).toBe('none');
    expect(r.changed).toEqual([keyOf.camo('mw2_desert')]);
    r = enforceLoadout(p, classWith('mw2_fall'));
    expect(r.loadout.primary.camo).toBe('none');
    expect(r.changed).toEqual([keyOf.camo('mw2_fall')]);
  });

  it('sanitizeLoadout keeps MW2 camo ids (structure only)', () => {
    expect(sanitizeLoadout(classWith('mw2_fall')).primary.camo).toBe('mw2_fall');
  });
});

describe('store gun page data', () => {
  it('lists the MW2 camos with this gun’s progress on primaries, none on secondaries', () => {
    const p = profileWith(hs('ak47', 12));
    const gun = storeGun(p, 'ak47')!;
    expect(gun.mw2Camos.map((c) => c.camo.id)).toEqual(MW2_LADDER.map((x) => x[0]));
    expect(gun.mw2Camos.map((c) => c.unlocked)).toEqual([true, true, true, false, false, false, false, false]);
    expect(gun.mw2CamosUnlocked).toBe(3);
    expect(mw2CamoCountLabel(gun)).toBe('3/8 MW2 camos');
    const digital = gun.mw2Camos[3]!;
    expect(digital.progress).toBe('12/15 AK-47 headshots');
    expect(digital.fraction).toBeCloseTo(0.8);
    expect(storeGun(p, 'm1911')!.mw2Camos).toEqual([]);
    expect(mw2CamoCountLabel(storeGun(p, 'm1911')!)).toBe('');
    // Offline: every challenge at zero.
    expect(storeGun(null, 'ak47')!.mw2Camos.map((c) => c.headshots.have)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(mw2CamoProgress(p, 'ak47')).toEqual(gun.mw2Camos);
  });

  it('the Camos tab summary counts unlocked guns and points at the closest locked one', () => {
    const p = profileWith({ ...hs('ak47', 12), ...hs('famas', 14) });
    const s = mw2CamoSummary(storeGunGroups(p));
    const primaries = storeGunGroups(p).flatMap((g) => g.guns).filter((g) => WEAPON_BY_ID.get(g.id)!.slot === 'primary').length;
    expect(s.map((x) => x.camo.id)).toEqual(MW2_LADDER.map((x) => x[0]));
    expect(s[0]).toMatchObject({ guns: primaries, unlocked: primaries, closest: null, challenge: 'Free' });
    expect(s[2]).toMatchObject({ unlocked: 2, challenge: 'Expert I · 5 headshots' });
    expect(s[3]!.unlocked).toBe(0);
    expect(s[3]!.closest).toMatchObject({ weapon: 'famas', progress: '14/15 FAMAS headshots' });
  });
});

// ---------------------------------------------------------------------------------------------
// Server: RPCs, spawn, stats
// ---------------------------------------------------------------------------------------------

let worlds: { lobby: Lobby; store: Store }[] = [];
afterEach(() => {
  for (const w of worlds) {
    w.lobby.shutdown();
    w.store.close();
  }
  worlds = [];
});

function world(features: Feature[]) {
  const store = new Store(':memory:');
  const sessions: Session[] = [];
  const rpc = new RpcRegistry();
  const lobby = new Lobby({ store, features, log: () => {}, autoTick: false });
  const api: ServerApi = { lobby, store, rpc, registerMode, registerWeaponBehavior, sessions: () => sessions.values(), log: () => {} };
  for (const f of features) f.setup?.(api);
  worlds.push({ lobby, store });
  const log: ServerMsg[] = [];
  const human = (name: string, level = 10) => {
    const prof = store.authenticate(null, name).profile;
    prof.level = level;
    const ws = { readyState: 1, bufferedAmount: 0, send: (d: string) => { const m = decodeServerMsg(d); if (m && m.t !== 'snap') log.push(m); }, close() {} } as unknown as WebSocket;
    const s = new Session(`h-${name}`, ws, prof, `token-${name}`);
    sessions.push(s);
    return s;
  };
  let rid = 0;
  const call = async (s: Session, id: string, data: unknown) => {
    const r = ++rid;
    await rpc.dispatch({ session: s, room: s.room, player: s.player }, id, data, r);
    const res = log.find((m) => m.t === 'rpcResult' && m.rid === r) as Extract<ServerMsg, { t: 'rpcResult' }>;
    if (!res.ok) throw new Error(res.error);
    return res.data as Record<string, unknown>;
  };
  return { lobby, human, call };
}

describe('save RPCs and spawn', () => {
  it('frontend.saveLoadout rejects locked MW2 camos and accepts unlocked ones', async () => {
    const w = world([economy, frontend]);
    const a = w.human('A');
    const cls = (camo: string, secondaryCamo = 'none') => ({ ...cloneLoadout(DEFAULT_LOADOUTS[0]!), primary: { weapon: 'ak47', attachments: [], camo }, secondary: { weapon: 'm1911', attachments: [], camo: secondaryCamo } });
    let res = await w.call(a, 'frontend.saveLoadout', { index: 0, loadout: cls('mw2_woodland') });
    expect((res.loadout as Loadout).primary.camo).toBe('none');
    expect(res.problems).toEqual(['Woodland (MW2) camo is locked (0/5 AK-47 headshots)']);
    res = await w.call(a, 'frontend.saveLoadout', { index: 0, loadout: cls('mw2_desert', 'mw2_desert') });
    expect((res.loadout as Loadout).primary.camo).toBe('mw2_desert');
    expect((res.loadout as Loadout).secondary.camo).toBe('none');
    a.profile.stats['weapon.ak47.headshots'] = 5;
    res = await w.call(a, 'frontend.saveLoadout', { index: 0, loadout: cls('mw2_woodland') });
    expect(res.problems).toEqual([]);
    expect(a.profile.loadouts[0]!.primary.camo).toBe('mw2_woodland');
  });

  it('economy.setCamo checks the slot’s gun', async () => {
    const w = world([economy]);
    const a = w.human('B');
    a.profile.stats['weapon.ak47.headshots'] = 5;
    await expect(w.call(a, 'economy.setCamo', { loadout: 0, slot: 'primary', camo: 'mw2_digital' })).rejects.toThrow(/5\/15 AK-47 headshots/);
    await expect(w.call(a, 'economy.setCamo', { loadout: 0, slot: 'secondary', camo: 'mw2_desert' })).rejects.toThrow(/Primary weapons only/);
    await w.call(a, 'economy.setCamo', { loadout: 0, slot: 'primary', camo: 'mw2_woodland' });
    expect(a.profile.loadouts[0]!.primary.camo).toBe('mw2_woodland');
    a.profile.stats['weapon.ak47.headshots'] = 15;
    await w.call(a, 'economy.setCamo', { loadout: 0, slot: 'primary', camo: 'mw2_digital' });
    expect(a.profile.loadouts[0]!.primary.camo).toBe('mw2_digital');
  });

  it('the spawn check keeps an unlocked MW2 camo on the gun and strips a locked one', () => {
    const w = world([economy]);
    const a = w.human('C');
    a.profile.stats['weapon.ak47.headshots'] = 150;
    a.profile.loadouts[0]!.primary.camo = 'mw2_red_tiger';
    a.profile.loadouts[0]!.secondary.camo = 'mw2_arctic';
    const room = w.lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false });
    w.lobby.join(a, room.id);
    const p = room.players.get(a.id)!;
    expect(p.loadout!.primary.camo).toBe('mw2_red_tiger');
    expect(p.weapons[0]!.camo).toBe('mw2_red_tiger');
    expect(p.loadout!.secondary.camo).toBe('none');

    const b = w.human('D');
    b.profile.stats['weapon.ak47.headshots'] = 249;
    b.profile.loadouts[0]!.primary.camo = 'mw2_fall';
    w.lobby.join(b, room.id);
    expect(room.players.get(b.id)!.weapons[0]!.camo).toBe('none');
  });
});

describe('per-weapon headshot stats and the unlock popup', () => {
  let store: Store | undefined;
  let lobby: Lobby | undefined;
  afterEach(() => {
    lobby?.shutdown();
    store?.close();
  });

  it('records kills and headshots per weapon; the 5th AK-47 headshot pops "AK-47 Woodland (MW2)"', () => {
    store = new Store(':memory:');
    lobby = new Lobby({ store, features: [progression], log: () => {}, autoTick: false });
    const room: Room = lobby.createRoom({ mode: 'tdm', map: 'yard', closeWhenEmpty: false });
    const prof = newProfile('prof-h', 'Human');
    prof.stats['weapon.ak47.headshots'] = 3;
    const h: PlayerState = room.addHuman(new Session('sess-h', null, prof, 'tok'));
    const bot = room.addBot({ name: 'Bot', team: h.team === 0 ? 1 : 0 });
    const pushed: { id: string; data: unknown }[] = [];
    const orig = room.sendFeature.bind(room);
    room.sendFeature = ((to: PlayerState | null, id: string, data: unknown) => {
      if (to === h) pushed.push({ id, data });
      return orig(to as PlayerState, id as never, data as never);
    }) as typeof room.sendFeature;
    const steps = (s: number) => {
      for (let i = 0; i < Math.round(s / TICK_DT); i++) room.step();
    };
    const kill = (part: 'head' | 'torso', weapon = 'ak47') => {
      steps(3.5);
      expect(bot.alive).toBe(true);
      room.damage({ victim: bot, attacker: h, amount: 500, weapon, part, means: 'bullet', from: null, distance: 10 });
    };
    steps(0.5);
    kill('torso');
    expect(prof.stats['weapon.ak47.kills']).toBe(1);
    expect(prof.stats['weapon.ak47.headshots']).toBe(3);
    kill('head');
    expect(prof.stats['weapon.ak47.headshots']).toBe(4);
    const camoPops = () => pushed.filter((m) => m.id === 'progression.unlocked').flatMap((m) => (m.data as { items: { id: string; name: string }[] }).items).filter((i) => i.id.startsWith('camo:'));
    expect(camoPops()).toEqual([]);
    kill('head');
    expect(prof.stats['weapon.ak47.headshots']).toBe(5);
    expect(camoPops()).toEqual([expect.objectContaining({ id: 'camo:ak47:mw2_woodland', name: 'AK-47 Woodland (MW2)', detail: 'Expert I' })]);
    expect(weaponCamoUnlocked(prof, 'mw2_woodland', 'ak47')).toBe(true);
    // Another gun keeps its own count.
    kill('head', 'famas');
    expect(prof.stats['weapon.famas.headshots']).toBe(1);
    expect(prof.stats['weapon.ak47.headshots']).toBe(5);
    expect(camoPops()).toHaveLength(1);
  });
});

describe('bots', () => {
  const seq = (vals: number[]) => {
    let i = 0;
    return () => vals[i++ % vals.length]!;
  };

  it('wear MW2 camos they could have earned, on primaries only', () => {
    const acr = WEAPON_BY_ID.get('acr');
    // rnd 0.9 skips the "no camo" roll; then the pretend record, then the pick.
    expect(pickBotCamo(acr, 0, seq([0.9, 0.99, 0.99, 0.99]))).toBe('mw2_arctic'); // skill 0: only the free ones
    expect(pickBotCamo(acr, 1, seq([0.9, 0.99, 0.99, 0.99]))).toBe('mw2_fall');
    expect(pickBotCamo(acr, 1, seq([0.1]))).toBe('none');
    expect(pickBotCamo(WEAPON_BY_ID.get('m1911'), 1, seq([0.9, 0.99, 0.99, 0.99]))).toBe('none');
    let r = 7;
    const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const l = chooseBotLoadout(0.8, rnd);
      seen.add(l.primary.camo);
      expect(l.secondary.camo).toBe('none');
      if (l.primary.camo !== 'none') expect(CAMO_BY_ID.get(l.primary.camo)!.collection).toBe('mw2');
    }
    expect(seen.has('none')).toBe(true);
    expect([...seen].filter((c) => c.startsWith('mw2_')).length).toBeGreaterThanOrEqual(5);
  });
});
