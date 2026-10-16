/**
 * The CoD Points store (owner: economy): reticles, emblem backgrounds, the item catalog built from
 * every def registry, and the pure purchase/ownership rules. Pure so the client can show lock
 * states with the same rules the server enforces (the server is the only one that spends).
 *
 * Ownership keys in `profile.owned`:
 *   weapon.<id>   att.<weaponId>.<attachmentId>   camo.<id>   reticle.<id>   emblem.<id>
 * Starter items (everything in DEFAULT_LOADOUTS, `none` camo, the default reticle and emblem
 * background, and any def priced 0) are free and need no purchase.
 *
 * BO1 model: weapons unlock by level and are then bought; attachments are bought per weapon once
 * that weapon is usable (some also need weapon kills); camos/reticles/backgrounds have a level or
 * prestige gate and a price.
 */
import { ATTACHMENT_BY_ID, ATTACHMENTS } from './attachments';
import { CAMO_BY_ID, CAMOS } from './camos';
import { CHALLENGE_BY_ID } from './challenges';
import { DEFAULT_PRICES } from './economy';
import { attachmentKillsFor } from './progression';
import { indexById } from './registry';
import { WAGER_ONLY_WEAPONS } from './wager-weapons';
import { WEAPON_BY_ID, WEAPONS } from './weapons';
import { cloneLoadout, DEFAULT_LOADOUTS, type Loadout, type WeaponLoadout } from '../loadout';
import type { Profile } from '../profile';

// ---------------------------------------------------------------------------------------------
// Cosmetics
// ---------------------------------------------------------------------------------------------

export type ReticleShape = 'dot' | 'circle' | 'cross' | 'chevron' | 'tri' | 'smiley' | 'skull' | 'diamond';

export interface ReticleDef {
  id: string;
  name: string;
  shape: ReticleShape;
  /** 0xRRGGBB */
  color: number;
  price: number;
  unlockLevel: number;
  unlockPrestige?: number;
}

export const RETICLES: ReticleDef[] = [
  { id: 'dot', name: 'Red Dot', shape: 'dot', color: 0xff3a2a, price: 0, unlockLevel: 1 },
  { id: 'circle', name: 'Circle Dot', shape: 'circle', color: 0xff3a2a, price: 250, unlockLevel: 3 },
  { id: 'cross', name: 'Crosshair', shape: 'cross', color: 0x50ff60, price: 250, unlockLevel: 7 },
  { id: 'chevron', name: 'Chevron', shape: 'chevron', color: 0xffb030, price: 500, unlockLevel: 13 },
  { id: 'tri', name: 'Triangle', shape: 'tri', color: 0x40d0ff, price: 500, unlockLevel: 19 },
  { id: 'diamond', name: 'Diamond', shape: 'diamond', color: 0xff60d0, price: 750, unlockLevel: 25 },
  { id: 'smiley', name: 'Smiley', shape: 'smiley', color: 0xffe040, price: 1000, unlockLevel: 33 },
  { id: 'skull', name: 'Skull', shape: 'skull', color: 0xf0f0f0, price: 2500, unlockLevel: 40, unlockPrestige: 1 },
];
export const RETICLE_BY_ID = indexById(RETICLES);
export const DEFAULT_RETICLE = 'dot';

export type EmblemPattern = 'solid' | 'stripes' | 'checker' | 'burst' | 'camo' | 'flag' | 'hazard' | 'gold';

export interface EmblemBackgroundDef {
  id: string;
  name: string;
  pattern: EmblemPattern;
  /** Palette 0xRRGGBB (base first). */
  colors: number[];
  price: number;
  unlockLevel: number;
  unlockPrestige?: number;
}

export const EMBLEM_BACKGROUNDS: EmblemBackgroundDef[] = [
  { id: 'plain', name: 'Field Grey', pattern: 'solid', colors: [0x3a3d36], price: 0, unlockLevel: 1 },
  { id: 'olive_stripes', name: 'Olive Drab', pattern: 'stripes', colors: [0x4b5532, 0x353c22], price: 250, unlockLevel: 2 },
  { id: 'checker', name: 'Checkpoint', pattern: 'checker', colors: [0x202020, 0xd8d0b8], price: 250, unlockLevel: 5 },
  { id: 'hazard', name: 'Hazard', pattern: 'hazard', colors: [0xe0b020, 0x181818], price: 500, unlockLevel: 10 },
  { id: 'burst_red', name: 'Red Burst', pattern: 'burst', colors: [0x7a1a12, 0xd04020], price: 500, unlockLevel: 16 },
  { id: 'woodland_bg', name: 'Woodland', pattern: 'camo', colors: [0x56653a, 0x2f3b22, 0x6e5a3a], price: 750, unlockLevel: 22 },
  { id: 'flag', name: 'Tricolour', pattern: 'flag', colors: [0x1d3c78, 0xe8e4d8, 0xa8201a], price: 1000, unlockLevel: 30 },
  { id: 'gold_bg', name: 'Gilded', pattern: 'gold', colors: [0xb08420, 0xffe08a], price: 10000, unlockLevel: 45, unlockPrestige: 1 },
];
export const EMBLEM_BACKGROUND_BY_ID = indexById(EMBLEM_BACKGROUNDS);
export const DEFAULT_EMBLEM_BACKGROUND = 'plain';

// ---------------------------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------------------------

export type StoreKind = 'weapon' | 'attachment' | 'camo' | 'reticle' | 'emblem';

export interface StoreUnlock {
  level?: number;
  prestige?: number;
  /** Kills with `weapon` (attachments). */
  weaponKills?: number;
  challenge?: string;
}

export interface StoreItem {
  /** Ownership key (see the header). */
  key: string;
  kind: StoreKind;
  /** Def id (attachment id for attachments). */
  id: string;
  /** Attachments: the weapon it is bought for. */
  weapon?: string;
  name: string;
  price: number;
  unlock: StoreUnlock;
  /** Usable without buying (starter item or price 0); unlock gates still apply. */
  free: boolean;
  /** Part of a default class: always usable, even when its unlock gate (e.g. weapon kills) is closed. */
  starter?: boolean;
}

export const keyOf = {
  weapon: (id: string) => `weapon.${id}`,
  attachment: (weapon: string, att: string) => `att.${weapon}.${att}`,
  camo: (id: string) => `camo.${id}`,
  reticle: (id: string) => `reticle.${id}`,
  emblem: (id: string) => `emblem.${id}`,
};

/** Items every profile can use without buying them. */
export function starterKeys(): Set<string> {
  const s = new Set<string>([keyOf.camo('none'), keyOf.reticle(DEFAULT_RETICLE), keyOf.emblem(DEFAULT_EMBLEM_BACKGROUND)]);
  for (const l of DEFAULT_LOADOUTS)
    for (const w of [l.primary, l.secondary]) {
      s.add(keyOf.weapon(w.weapon));
      for (const a of w.attachments) s.add(keyOf.attachment(w.weapon, a));
    }
  return s;
}

let cache: { n: number; items: StoreItem[]; byKey: Map<string, StoreItem> } | null = null;

/** Every buyable item (rebuilt when another module registers more weapons/attachments). */
export function storeCatalog(): StoreItem[] {
  const n = WEAPONS.length * 1000 + ATTACHMENTS.length;
  if (cache && cache.n === n) return cache.items;
  const free = starterKeys();
  const items: StoreItem[] = [];
  for (const w of WEAPONS) {
    // Only classable guns: the knife (melee) and the underbarrel GL are WeaponDefs too, never sold.
    // Mystery Box wonder weapons are never sold either.
    if (WAGER_ONLY_WEAPONS.has(w.id) || w.wonder || (w.slot !== 'primary' && w.slot !== 'secondary')) continue;
    const key = keyOf.weapon(w.id);
    const price = w.price ?? DEFAULT_PRICES.weapon;
    items.push({ key, kind: 'weapon', id: w.id, name: w.name, price, unlock: { level: w.unlockLevel }, starter: free.has(key), free: free.has(key) || price === 0 });
    for (const aid of w.attachments) {
      const a = ATTACHMENT_BY_ID.get(aid);
      if (!a) continue;
      const akey = keyOf.attachment(w.id, aid);
      const aprice = a.price ?? DEFAULT_PRICES.attachment;
      items.push({ key: akey, kind: 'attachment', id: aid, weapon: w.id, name: `${a.name} (${w.name})`, price: aprice, unlock: a.unlockKills ? { weaponKills: a.unlockKills } : {}, starter: free.has(akey), free: free.has(akey) || aprice === 0 });
    }
  }
  for (const c of CAMOS) {
    const key = keyOf.camo(c.id);
    const price = c.price ?? DEFAULT_PRICES.camo;
    items.push({ key, kind: 'camo', id: c.id, name: c.name, price, unlock: { ...c.unlock }, starter: free.has(key), free: free.has(key) || price === 0 });
  }
  for (const r of RETICLES) {
    const key = keyOf.reticle(r.id);
    items.push({ key, kind: 'reticle', id: r.id, name: r.name, price: r.price, unlock: { level: r.unlockLevel, prestige: r.unlockPrestige }, starter: free.has(key), free: free.has(key) || r.price === 0 });
  }
  for (const e of EMBLEM_BACKGROUNDS) {
    const key = keyOf.emblem(e.id);
    items.push({ key, kind: 'emblem', id: e.id, name: e.name, price: e.price, unlock: { level: e.unlockLevel, prestige: e.unlockPrestige }, starter: free.has(key), free: free.has(key) || e.price === 0 });
  }
  cache = { n, items, byKey: new Map(items.map((i) => [i.key, i])) };
  return items;
}

export function storeItem(key: string): StoreItem | undefined {
  storeCatalog();
  return cache!.byKey.get(key);
}

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

export type ProfileLike = Pick<Profile, 'level' | 'prestige' | 'codPoints' | 'owned' | 'stats' | 'challengeProgress'> & Partial<Pick<Profile, 'ext'>>;

export type LockReason = 'unknown' | 'owned' | 'level' | 'prestige' | 'weapon' | 'kills' | 'challenge' | 'funds';

export const owns = (p: Pick<Profile, 'owned'>, item: StoreItem) => item.free || p.owned.includes(item.key);

/** Why the item's unlock gate is closed, or null when it is open (ownership/funds not considered). */
export function gateReason(p: ProfileLike, item: StoreItem): Exclude<LockReason, 'owned' | 'funds' | 'unknown'> | null {
  const u = item.unlock;
  if (u.prestige !== undefined && p.prestige < u.prestige) return 'prestige';
  // A prestige-gated item is open to anyone at that prestige; level gates apply on top otherwise.
  if (u.level !== undefined && p.level < u.level && !(u.prestige !== undefined && p.prestige > u.prestige)) return 'level';
  if (item.kind === 'attachment' && item.weapon) {
    const w = storeItem(keyOf.weapon(item.weapon));
    if (!w || !owns(p, w) || gateReason(p, w)) return 'weapon';
    if (u.weaponKills && attachmentKillsFor(p, item.weapon) < u.weaponKills) return 'kills';
  }
  if (u.challenge) {
    const c = CHALLENGE_BY_ID.get(u.challenge);
    if (!c || (p.challengeProgress[u.challenge] ?? 0) < c.goal) return 'challenge';
  }
  return null;
}

/** Why `key` can't be bought right now, or null if it can. */
export function lockReason(p: ProfileLike, key: string): LockReason | null {
  const item = storeItem(key);
  if (!item) return 'unknown';
  if (owns(p, item)) return 'owned';
  const gate = gateReason(p, item);
  if (gate) return gate;
  if (p.codPoints < item.price) return 'funds';
  return null;
}

export const LOCK_TEXT: Record<LockReason, string> = {
  unknown: 'Not for sale',
  owned: 'Owned',
  level: 'Level locked',
  prestige: 'Prestige locked',
  weapon: 'Buy the weapon first',
  kills: 'Needs more kills with this weapon',
  challenge: 'Complete the challenge',
  funds: 'Not enough CoD Points',
};

/** Usable in a class / equippable: owned (or free) and the unlock gate is open. */
export function canUse(p: ProfileLike, key: string): boolean {
  const item = storeItem(key);
  if (!item) return false;
  if (item.starter) return true;
  return owns(p, item) && !gateReason(p, item);
}

export type PurchaseResult = { ok: true; item: StoreItem; codPoints: number } | { ok: false; reason: LockReason };

/** Buy `key`: checks gates and funds at the moment of spending, then mutates the profile. */
export function purchase(p: ProfileLike, key: string): PurchaseResult {
  const reason = lockReason(p, key);
  if (reason) return { ok: false, reason };
  const item = storeItem(key)!;
  p.codPoints -= item.price;
  p.owned.push(item.key);
  return { ok: true, item, codPoints: p.codPoints };
}

/**
 * A copy of `loadout` with everything the profile can't use replaced: weapons fall back to the
 * starter weapon for that slot, attachments are dropped, camos become 'none'. Wager-only weapons
 * are never allowed in a custom class. `changed` lists what was removed (ownership keys).
 */
export function enforceLoadout(p: ProfileLike, loadout: Loadout): { loadout: Loadout; changed: string[] } {
  const out = cloneLoadout(loadout);
  const changed: string[] = [];
  const fallback = DEFAULT_LOADOUTS[0]!;
  const fix = (w: WeaponLoadout, fb: WeaponLoadout): WeaponLoadout => {
    const weapon = w.weapon;
    if (!WEAPON_BY_ID.has(weapon) || WAGER_ONLY_WEAPONS.has(weapon) || WEAPON_BY_ID.get(weapon)!.wonder || !canUse(p, keyOf.weapon(weapon))) {
      changed.push(keyOf.weapon(weapon));
      return { weapon: fb.weapon, attachments: fb.attachments.filter((a) => canUse(p, keyOf.attachment(fb.weapon, a))), camo: canUse(p, keyOf.camo(w.camo)) ? w.camo : 'none' };
    }
    const attachments = w.attachments.filter((a) => {
      const ok = canUse(p, keyOf.attachment(weapon, a));
      if (!ok) changed.push(keyOf.attachment(weapon, a));
      return ok;
    });
    let camo = w.camo;
    if (!CAMO_BY_ID.has(camo) || !canUse(p, keyOf.camo(camo))) {
      changed.push(keyOf.camo(camo));
      camo = 'none';
    }
    return { weapon, attachments, camo };
  };
  out.primary = fix(out.primary, fallback.primary);
  out.secondary = fix(out.secondary, fallback.secondary);
  return { loadout: out, changed };
}
