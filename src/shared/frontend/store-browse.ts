/**
 * Store browsing model (owner: frontend; pure, no DOM): the store's guns grouped by class, each with
 * its own attachments, ownership counts and lock state, the way BO1's store lists them (pick a gun,
 * then see its attachments). The screen (`src/client/features/economy/store-screen.ts`) only draws
 * what this returns.
 *
 * Nothing here decides prices or rules: items come from economy's `storeCatalog()` and every lock
 * state from its `owns` / `gateReason` / `lockReason`, the same rules the server applies in
 * `economy.buy`.
 */
import { ATTACHMENT_BY_ID, type AttachmentDef, type AttachmentSlot } from '../defs/attachments';
import { attachmentKillsFor } from '../defs/progression';
import { gateReason, lockReason, owns, storeCatalog, type LockReason, type ProfileLike, type StoreItem } from '../defs/store';
import { WEAPON_BY_ID, type WeaponClass, type WeaponDef } from '../defs/weapons';

export type GunGroupId = 'ar' | 'smg' | 'lmg' | 'sniper' | 'shotgun' | 'pistol' | 'special';

/** Store gun groups in BO1 order. Launchers and specials share the last group. */
export const GUN_GROUPS: { id: GunGroupId; label: string; classes: WeaponClass[] }[] = [
  { id: 'ar', label: 'Assault Rifles', classes: ['ar'] },
  { id: 'smg', label: 'SMGs', classes: ['smg'] },
  { id: 'lmg', label: 'LMGs', classes: ['lmg'] },
  { id: 'sniper', label: 'Snipers', classes: ['sniper'] },
  { id: 'shotgun', label: 'Shotguns', classes: ['shotgun'] },
  { id: 'pistol', label: 'Pistols', classes: ['pistol'] },
  { id: 'special', label: 'Launchers / Specials', classes: ['launcher', 'special'] },
];

export const groupOfClass = (c: WeaponClass): GunGroupId => GUN_GROUPS.find((g) => g.classes.includes(c))?.id ?? 'special';

/**
 * What the player can do with an item right now:
 * - `owned`: bought or free (starter / price 0). `usable` says whether its gate is also open
 *   (an item bought before a prestige can be gated again by level).
 * - `buy`: gate open and affordable.
 * - `funds`: gate open, not enough CoD Points.
 * - `locked`: gate closed (level, prestige, weapon not owned, weapon kills, challenge).
 */
export type BrowseState = 'owned' | 'buy' | 'funds' | 'locked';

export interface BrowseItem {
  item: StoreItem;
  state: BrowseState;
  owned: boolean;
  /** Owned (or free) and its gate is open: usable in Create-a-Class. */
  usable: boolean;
  /** `lockReason` from the store rules (null = can buy now). */
  lock: LockReason | null;
  /** What still stands in the way ("Level 14", "40 kills with AK-47 (12/40)", "Buy the AK-47 first"), or null. */
  requirement: string | null;
}

export interface BrowseAttachment extends BrowseItem {
  id: string;
  name: string;
  slot: AttachmentSlot | null;
  blurb: string;
  /** Weapon-kill gate: kills so far and kills needed (need 0 = no kill gate). */
  kills: { have: number; need: number };
}

export interface BrowseGun extends BrowseItem {
  id: string;
  name: string;
  weaponClass: WeaponClass;
  group: GunGroupId;
  model: string;
  blurb: string;
  unlockLevel: number;
  attachments: BrowseAttachment[];
  attachmentsOwned: number;
}

export interface BrowseGroup {
  id: GunGroupId;
  label: string;
  guns: BrowseGun[];
}

const fmt = (n: number) => `${Math.round(n).toLocaleString('en-US')} CP`;

function gateText(p: ProfileLike, item: StoreItem, weaponName: string): string | null {
  const gate = gateReason(p, item);
  switch (gate) {
    case null:
      return null;
    case 'level':
      return `Level ${item.unlock.level}`;
    case 'prestige':
      return `Prestige ${item.unlock.prestige}`;
    case 'weapon':
      return `Buy the ${weaponName} first`;
    case 'kills': {
      const need = item.unlock.weaponKills ?? 0;
      const have = Math.min(need, attachmentKillsFor(p, item.weapon ?? ''));
      return `${need} kills with ${weaponName} (${have}/${need})`;
    }
    case 'challenge':
      return 'Complete the challenge';
  }
}

function browseItem(p: ProfileLike | null, item: StoreItem, weaponName: string): BrowseItem {
  if (!p) return { item, state: 'locked', owned: false, usable: false, lock: 'unknown', requirement: 'Offline' };
  const owned = owns(p, item);
  const gate = gateText(p, item, weaponName);
  const lock = lockReason(p, item.key);
  // Starter items are always usable (a default class may carry a kill-gated attachment).
  const usable = owned && (!!item.starter || gate === null);
  let state: BrowseState;
  if (owned) state = 'owned';
  else if (gate) state = 'locked';
  else state = lock === 'funds' ? 'funds' : lock === null ? 'buy' : 'locked';
  const requirement = usable ? null : owned ? gate : (gate ?? (state === 'funds' ? `Need ${fmt(item.price - p.codPoints)} more` : null));
  return { item, state, owned, usable, lock, requirement };
}

function browseAttachment(p: ProfileLike | null, item: StoreItem, gun: WeaponDef): BrowseAttachment {
  const def: AttachmentDef | undefined = ATTACHMENT_BY_ID.get(item.id);
  const need = item.unlock.weaponKills ?? 0;
  return {
    ...browseItem(p, item, gun.name),
    id: item.id,
    name: def?.name ?? item.id,
    slot: def?.slot ?? null,
    blurb: def?.blurb ?? '',
    kills: { have: p ? attachmentKillsFor(p, gun.id) : 0, need },
  };
}

/**
 * Every gun the store sells, with its attachments, grouped by class (empty groups left out).
 * Guns are ordered by unlock level within a group (catalog order breaks ties); attachments keep
 * the weapon's own order. `profile` null (offline) shows everything locked.
 */
export function storeGunGroups(profile: ProfileLike | null, catalog: readonly StoreItem[] = storeCatalog(), weapons: ReadonlyMap<string, WeaponDef> = WEAPON_BY_ID): BrowseGroup[] {
  const attsByGun = new Map<string, StoreItem[]>();
  for (const it of catalog) {
    if (it.kind !== 'attachment' || !it.weapon) continue;
    let list = attsByGun.get(it.weapon);
    if (!list) attsByGun.set(it.weapon, (list = []));
    list.push(it);
  }
  const guns: BrowseGun[] = [];
  for (const it of catalog) {
    if (it.kind !== 'weapon') continue;
    const def = weapons.get(it.id);
    if (!def) continue;
    const attachments = (attsByGun.get(it.id) ?? []).map((a) => browseAttachment(profile, a, def));
    guns.push({
      ...browseItem(profile, it, def.name),
      id: def.id,
      name: def.name,
      weaponClass: def.class,
      group: groupOfClass(def.class),
      model: def.model,
      blurb: def.blurb ?? '',
      unlockLevel: def.unlockLevel,
      attachments,
      attachmentsOwned: attachments.filter((a) => a.owned).length,
    });
  }
  return GUN_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    guns: guns
      .map((gun, i) => ({ gun, i }))
      .filter(({ gun }) => gun.group === g.id)
      .sort((a, b) => a.gun.unlockLevel - b.gun.unlockLevel || a.i - b.i)
      .map(({ gun }) => gun),
  })).filter((g) => g.guns.length > 0);
}

/** One gun's page model, or null if the store doesn't sell it. */
export function storeGun(profile: ProfileLike | null, weaponId: string, catalog?: readonly StoreItem[], weapons?: ReadonlyMap<string, WeaponDef>): BrowseGun | null {
  for (const g of storeGunGroups(profile, catalog, weapons)) for (const gun of g.guns) if (gun.id === weaponId) return gun;
  return null;
}

export const groupLabel = (id: GunGroupId) => GUN_GROUPS.find((g) => g.id === id)?.label ?? id;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const startsWord = (text: string, q: string) => norm(text).startsWith(q) || text.split(/[^A-Za-z0-9]+/).some((w) => norm(w).startsWith(q));

/**
 * Quick search: keeps guns whose name, a word of the name, or id starts with the query (case,
 * spaces and punctuation ignored, so "ak47" and "47" find the AK-47 and "interv" the Intervention),
 * or all of a group when the query starts its name or class ("sniper", "smg", "assault").
 * Groups left empty are dropped.
 */
export function filterGunGroups(groups: readonly BrowseGroup[], query: string): BrowseGroup[] {
  const q = norm(query);
  if (!q) return [...groups];
  const out: BrowseGroup[] = [];
  for (const g of groups) {
    const groupHit = startsWord(g.label, q) || norm(g.id).startsWith(q) || GUN_GROUPS.find((x) => x.id === g.id)!.classes.some((c) => norm(c).startsWith(q));
    const guns = groupHit ? g.guns : g.guns.filter((gun) => startsWord(gun.name, q) || norm(gun.id).startsWith(q));
    if (guns.length) out.push({ ...g, guns });
  }
  return out;
}

/** "3/6 attachments owned" (or "No attachments"). */
export function attachmentCountLabel(gun: Pick<BrowseGun, 'attachments' | 'attachmentsOwned'>): string {
  return gun.attachments.length ? `${gun.attachmentsOwned}/${gun.attachments.length} attachments owned` : 'No attachments';
}

/**
 * Which control a gun page focuses first (controller): the gun's Buy button if it can be bought,
 * else the first attachment that can be bought, else the first attachment, else the gun.
 * Returns the store item key the screen tags its buttons with.
 */
export function gunPageFocusKey(gun: BrowseGun): string {
  if (gun.state === 'buy') return gun.item.key;
  return (gun.attachments.find((a) => a.state === 'buy') ?? gun.attachments[0] ?? gun).item.key;
}
