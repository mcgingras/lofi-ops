/** Store browsing model (src/shared/frontend/store-browse.ts): guns by class, attachments per gun, counts, lock states. */
import { describe, expect, it } from 'vitest';
import { ATTACHMENT_BY_ID } from '../src/shared/defs/attachments';
import { keyOf, purchase, storeCatalog, type StoreItem } from '../src/shared/defs/store';
import { WEAPON_BY_ID, type WeaponDef } from '../src/shared/defs/weapons';
import { attachmentCountLabel, filterGunGroups, GUN_GROUPS, gunPageFocusKey, storeGun, storeGunGroups, type BrowseGun } from '../src/shared/frontend/store-browse';
import { newProfile, type Profile } from '../src/shared/profile';

const profile = (o: Partial<Profile> = {}): Profile => Object.assign(newProfile('p1', 'Tester'), o);
const allGuns = (groups: ReturnType<typeof storeGunGroups>): BrowseGun[] => groups.flatMap((g) => g.guns);

describe('store gun groups', () => {
  const p = profile({ level: 1, codPoints: 0 });
  const groups = storeGunGroups(p);
  const guns = allGuns(groups);
  const catalog = storeCatalog();

  it('lists every weapon the store sells exactly once, under its class group, in BO1 group order', () => {
    const sold = catalog.filter((i) => i.kind === 'weapon').map((i) => i.id);
    expect(guns.map((g) => g.id).sort()).toEqual([...sold].sort());
    expect(new Set(guns.map((g) => g.id)).size).toBe(guns.length);
    const order = GUN_GROUPS.map((g) => g.id);
    const seen = groups.map((g) => order.indexOf(g.id));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    for (const g of groups) {
      expect(g.guns.length).toBeGreaterThan(0);
      const classes = GUN_GROUPS.find((x) => x.id === g.id)!.classes;
      for (const gun of g.guns) expect(classes).toContain(WEAPON_BY_ID.get(gun.id)!.class);
    }
    expect(groups.map((g) => g.label)).toEqual(['Assault Rifles', 'SMGs', 'LMGs', 'Snipers', 'Shotguns', 'Pistols', 'Machine Pistols']);
  });

  it('orders guns by unlock level within a group', () => {
    for (const g of groups) {
      const lv = g.guns.map((x) => x.unlockLevel);
      expect(lv).toEqual([...lv].sort((a, b) => a - b));
    }
  });

  it('puts every attachment under exactly the gun it is sold for, and nowhere else', () => {
    const attItems = catalog.filter((i) => i.kind === 'attachment');
    expect(attItems.length).toBeGreaterThan(0);
    for (const it of attItems) {
      const holders = guns.filter((g) => g.attachments.some((a) => a.item.key === it.key));
      expect(holders.map((g) => g.id)).toEqual([it.weapon]);
    }
    const listed = guns.reduce((n, g) => n + g.attachments.length, 0);
    expect(listed).toBe(attItems.length);
    for (const gun of guns) {
      // Same ids, same order as the weapon def (unknown attachment ids are not sold).
      const def = WEAPON_BY_ID.get(gun.id)!;
      expect(gun.attachments.map((a) => a.id)).toEqual(def.attachments.filter((a) => ATTACHMENT_BY_ID.has(a)));
      for (const a of gun.attachments) expect(a.item.weapon).toBe(gun.id);
    }
  });

  it('carries attachment names, descriptions and prices from the defs', () => {
    const ak = storeGun(p, 'ak47')!;
    const supp = ak.attachments.find((a) => a.id === 'suppressor')!;
    expect(supp.name).toBe('Suppressor');
    expect(supp.blurb).toBe(ATTACHMENT_BY_ID.get('suppressor')!.blurb);
    expect(supp.item.price).toBe(ATTACHMENT_BY_ID.get('suppressor')!.price);
    expect(supp.slot).toBe('muzzle');
    expect(supp.kills.need).toBe(ATTACHMENT_BY_ID.get('suppressor')!.unlockKills);
  });
});

describe('ownership, counts and lock states', () => {
  it('a fresh profile owns the starter guns and the default AK-47 red dot', () => {
    const p = profile({ level: 1, codPoints: 0 });
    const ak = storeGun(p, 'ak47')!;
    expect(ak.owned).toBe(true);
    expect(ak.state).toBe('owned');
    expect(ak.attachmentsOwned).toBe(1);
    expect(ak.attachments.find((a) => a.id === 'reddot')!.owned).toBe(true);
    expect(attachmentCountLabel(ak)).toBe(`1/${ak.attachments.length} attachments owned`);
    const m16 = storeGun(p, 'm16')!;
    expect(m16.owned).toBe(true);
    expect(m16.attachmentsOwned).toBe(0);
  });

  it('counts bought attachments per gun only (same attachment on another gun is not owned)', () => {
    const p = profile({ level: 1, codPoints: 0, owned: [keyOf.attachment('m16', 'extmag'), keyOf.attachment('m16', 'grip'), keyOf.attachment('mp5k', 'extmag')] });
    const m16 = storeGun(p, 'm16')!;
    expect(m16.attachmentsOwned).toBe(1); // the M16 has no grip slot, so that key is ignored
    expect(m16.attachments.filter((a) => a.owned).map((a) => a.id)).toEqual(['extmag']);
    expect(storeGun(p, 'famas')!.attachments.find((a) => a.id === 'extmag')!.owned).toBe(false);
    expect(storeGun(p, 'mp5k')!.attachmentsOwned).toBe(1);
  });

  it('follows a real purchase: owned flips and the count goes up', () => {
    const p = profile({ level: 10, codPoints: 10_000, stats: { 'weapon.m16.kills': 100 } });
    const before = storeGun(p, 'm16')!;
    const ext = before.attachments.find((a) => a.id === 'extmag')!;
    expect(ext.state).toBe('buy');
    expect(purchase(p, ext.item.key).ok).toBe(true);
    const after = storeGun(p, 'm16')!;
    expect(after.attachmentsOwned).toBe(before.attachmentsOwned + 1);
    expect(after.attachments.find((a) => a.id === 'extmag')!.state).toBe('owned');
  });

  it('level-locks guns, then asks for funds, then lets you buy', () => {
    const low = storeGun(profile({ level: 1, codPoints: 99_999 }), 'commando')!;
    expect(low.state).toBe('locked');
    expect(low.lock).toBe('level');
    expect(low.requirement).toBe('Level 14');
    const broke = storeGun(profile({ level: 14, codPoints: 100 }), 'commando')!;
    expect(broke.state).toBe('funds');
    expect(broke.requirement).toBe(`Need ${(broke.item.price - 100).toLocaleString('en-US')} CP more`);
    const rich = storeGun(profile({ level: 14, codPoints: 99_999 }), 'commando')!;
    expect(rich.state).toBe('buy');
    expect(rich.requirement).toBeNull();
  });

  it('attachments of an unowned gun say to buy the gun first; kill gates show progress', () => {
    const p = profile({ level: 14, codPoints: 99_999, stats: { 'weapon.ak47.kills': 12 } });
    const commando = storeGun(p, 'commando')!;
    for (const a of commando.attachments) {
      expect(a.state).toBe('locked');
      expect(a.lock).toBe('weapon');
      expect(a.requirement).toBe('Buy the Commando first');
    }
    const supp = storeGun(p, 'ak47')!.attachments.find((a) => a.id === 'suppressor')!;
    expect(supp.state).toBe('locked');
    expect(supp.lock).toBe('kills');
    expect(supp.requirement).toBe('40 kills with AK-47 (12/40)');
    expect(supp.kills).toEqual({ have: 12, need: 40 });
    const ext = storeGun(p, 'ak47')!.attachments.find((a) => a.id === 'extmag')!;
    expect(ext.state).toBe('buy');
  });

  it('an item bought before a prestige stays owned but is not usable until its level comes back', () => {
    const p = profile({ level: 2, prestige: 1, codPoints: 0, owned: [keyOf.weapon('commando')] });
    const c = storeGun(p, 'commando')!;
    expect(c.owned).toBe(true);
    expect(c.state).toBe('owned');
    expect(c.usable).toBe(false);
    expect(c.requirement).toBe('Level 14');
  });

  it('offline (no profile): everything locked, nothing owned', () => {
    const guns = allGuns(storeGunGroups(null));
    expect(guns.length).toBeGreaterThan(0);
    for (const g of guns) {
      expect(g.owned).toBe(false);
      expect(g.attachmentsOwned).toBe(0);
      expect(g.state).toBe('locked');
    }
  });

  it('works with an injected catalog (a gun with no attachments says so)', () => {
    const def: WeaponDef = { ...WEAPON_BY_ID.get('olympia')!, id: 'zz', name: 'ZZ Gun', attachments: [] };
    const cat: StoreItem[] = [{ key: 'weapon.zz', kind: 'weapon', id: 'zz', name: 'ZZ Gun', price: 0, unlock: { level: 1 }, free: true }];
    const groups = storeGunGroups(profile(), cat, new Map([['zz', def]]));
    expect(groups.map((g) => g.id)).toEqual(['shotgun']);
    expect(attachmentCountLabel(groups[0]!.guns[0]!)).toBe('No attachments');
  });
});

describe('search and focus', () => {
  const groups = storeGunGroups(profile({ level: 1 }));

  it('filters guns by name ignoring case and punctuation, keeps groups that match by name', () => {
    expect(allGuns(filterGunGroups(groups, 'ak47')).map((g) => g.id)).toEqual(['ak47']);
    expect(allGuns(filterGunGroups(groups, 'AK')).map((g) => g.id).sort()).toEqual(['ak47', 'ak74u']);
    expect(allGuns(filterGunGroups(groups, '47')).map((g) => g.id)).toEqual(['ak47']);
    expect(filterGunGroups(groups, 'assault').map((g) => g.id)).toEqual(['ar']);
    expect(filterGunGroups(groups, 'interv').flatMap((g) => g.guns.map((x) => x.name))).toEqual(['Intervention']);
    const snipers = filterGunGroups(groups, 'sniper');
    expect(snipers.map((g) => g.id)).toEqual(['sniper']);
    expect(snipers[0]!.guns.length).toBe(groups.find((g) => g.id === 'sniper')!.guns.length);
    expect(filterGunGroups(groups, '')).toEqual(groups);
    expect(filterGunGroups(groups, '   ')).toEqual(groups);
    expect(filterGunGroups(groups, 'nothing-like-this')).toEqual([]);
  });

  it('focuses the gun Buy first, else the first buyable attachment, else the first attachment', () => {
    const buyGun = storeGun(profile({ level: 14, codPoints: 99_999 }), 'commando')!;
    expect(gunPageFocusKey(buyGun)).toBe(keyOf.weapon('commando'));
    const ak = storeGun(profile({ level: 1, codPoints: 99_999, stats: { 'weapon.ak47.kills': 6 } }), 'ak47')!;
    expect(gunPageFocusKey(ak)).toBe(keyOf.attachment('ak47', 'reflex')); // ext mag needs 10 kills, red dot is owned
    const broke = storeGun(profile({ level: 1, codPoints: 0 }), 'ak47')!;
    expect(gunPageFocusKey(broke)).toBe(broke.attachments[0]!.item.key);
    const olympia = storeGun(profile(), 'olympia')!;
    expect(gunPageFocusKey(olympia)).toBe(keyOf.weapon('olympia'));
  });
});
