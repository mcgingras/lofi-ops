/**
 * Unlock table and loadout gating (owner: progression feature). Shared so the client can show
 * locks (Barracks, create-a-class) with exactly the rules the server enforces at spawn.
 *
 * Sources:
 *   - weapons / perks / killstreaks: their def's `unlockLevel` (owners: weapons, perks-streaks),
 *     unless `UNLOCK_LEVEL_OVERRIDES[id]` rebalances it from here;
 *   - attachments: `AttachmentDef.unlockKills` kills with that weapon since the last prestige;
 *   - lethal / tactical equipment: EQUIPMENT_UNLOCKS below (ids not listed are never gated);
 *   - Pro perks: completing the perk's Pro challenge (`PerkDef.pro.challenge`);
 *   - menu features (Create-a-Class, wager matches) and custom class slots: tables below;
 *   - prestige emblems: one per prestige reached.
 *
 * Other areas can veto or grant through `UNLOCK_RULES` (e.g. economy: "bought in the store").
 * Unlock ids stored in `profile.unlocks`: item ids (`famas`, `lightweight`, `uav`, `frag`),
 * `<weapon>:<attachment>`, `pro:<perk>`, `feature:<id>`, `class:<n>`, `prestige_<n>`.
 */
import { ATTACHMENT_BY_ID } from './attachments';
import { challengeComplete } from './challenges';
import { KILLSTREAK_BY_ID, KILLSTREAKS } from './killstreaks';
import { PERK_BY_ID, PERKS } from './perks';
import { MAX_PRESTIGE, prestigeEmblem, readProgressionExt } from './progression';
import { WEAPON_BY_ID, WEAPONS } from './weapons';
import { cloneLoadout, DEFAULT_LOADOUTS, type Loadout, type WeaponLoadout } from '../loadout';
import type { Profile } from '../profile';

export type UnlockKind = 'weapon' | 'attachment' | 'perk' | 'pro' | 'killstreak' | 'lethal' | 'tactical' | 'feature' | 'class' | 'emblem';

/** One row of the unlock table (Barracks levels list, level-up popups). */
export interface UnlockEntry {
  level: number;
  kind: UnlockKind;
  id: string;
  name: string;
  /** Small extra text: weapon class, perk tier, streak cost, kills needed... */
  detail?: string;
}

/** The parts of a profile the unlock rules read. */
export type UnlockProfile = Pick<Profile, 'level' | 'prestige' | 'unlocks' | 'challengeProgress' | 'ext'> & Partial<Pick<Profile, 'owned'>>;

// ---------------------------------------------------------------------------------------------
// Tables owned here
// ---------------------------------------------------------------------------------------------

/** Rebalance an item's unlock level without editing its owner's defs. */
export const UNLOCK_LEVEL_OVERRIDES: Record<string, number> = {};

export interface EquipmentUnlock {
  id: string;
  name: string;
  kind: 'lethal' | 'tactical';
  level: number;
}

/** BO1 lethal and tactical grenades. Loadout ids not in this list are not gated. */
export const EQUIPMENT_UNLOCKS: EquipmentUnlock[] = [
  { id: 'frag', name: 'Frag', kind: 'lethal', level: 1 },
  { id: 'semtex', name: 'Semtex', kind: 'lethal', level: 6 },
  { id: 'tomahawk', name: 'Tomahawk', kind: 'lethal', level: 18 },
  { id: 'concussion', name: 'Concussion', kind: 'tactical', level: 1 },
  { id: 'flash', name: 'Flashbang', kind: 'tactical', level: 3 },
  { id: 'willy_pete', name: 'Willy Pete', kind: 'tactical', level: 9 },
  { id: 'nova', name: 'Nova Gas', kind: 'tactical', level: 12 },
  { id: 'decoy', name: 'Decoy', kind: 'tactical', level: 15 },
];
const EQUIPMENT_BY_ID = new Map(EQUIPMENT_UNLOCKS.map((e) => [e.id, e]));

export interface FeatureUnlock {
  id: string;
  name: string;
  level: number;
  detail?: string;
}

/** Menu features opened by level. Ids are `feature:<id>`; check with `featureUnlocked(p, id)`. */
export const FEATURE_UNLOCKS: FeatureUnlock[] = [
  { id: 'createAClass', name: 'Create-a-Class', level: 4, detail: 'Build your own classes' },
  { id: 'wager', name: 'Wager Matches', level: 7, detail: 'Bet CoD Points' },
  { id: 'prestige', name: 'Prestige Mode', level: 50, detail: 'Enter from the Barracks' },
];
const FEATURE_BY_ID = new Map(FEATURE_UNLOCKS.map((f) => [f.id, f]));

/** Level each custom class slot opens at (needs Create-a-Class). */
export const CLASS_SLOT_LEVELS: readonly number[] = [4, 10, 20, 30, 40];
/** Prestige tiers that each add one more custom class slot. */
export const PRESTIGE_CLASS_SLOTS: readonly number[] = [2, 4, 6, 8, 10];

/**
 * Extra unlock rules from other areas. Return true to grant, false to deny, undefined for no
 * opinion; the first non-undefined answer wins. `weapon` is set for attachments.
 */
export type UnlockRule = (p: UnlockProfile, kind: UnlockKind, id: string, weapon?: string) => boolean | undefined;
export const UNLOCK_RULES: UnlockRule[] = [];

// ---------------------------------------------------------------------------------------------
// Ids and lookups
// ---------------------------------------------------------------------------------------------

export const attachmentUnlockId = (weapon: string, attachment: string) => `${weapon}:${attachment}`;
export const proUnlockId = (perk: string) => `pro:${perk}`;
export const featureUnlockId = (id: string) => `feature:${id}`;
export const classUnlockId = (n: number) => `class:${n}`;

/** Level an item unlocks at (1 for anything unknown). */
export function unlockLevelOf(kind: UnlockKind, id: string): number {
  const o = UNLOCK_LEVEL_OVERRIDES[id];
  if (typeof o === 'number') return o;
  switch (kind) {
    case 'weapon':
      return WEAPON_BY_ID.get(id)?.unlockLevel ?? 1;
    case 'perk':
      return PERK_BY_ID.get(id)?.unlockLevel ?? 1;
    case 'killstreak':
      return KILLSTREAK_BY_ID.get(id)?.unlockLevel ?? 1;
    case 'lethal':
    case 'tactical':
      return EQUIPMENT_BY_ID.get(id)?.level ?? 1;
    case 'feature':
      return FEATURE_BY_ID.get(id)?.level ?? 1;
    case 'class':
      return CLASS_SLOT_LEVELS[Number(id) - 1] ?? 1;
    default:
      return 1;
  }
}

/** Kills with `weapon` (since the last prestige) needed for an attachment. */
export const attachmentKillsNeeded = (attachment: string) => Math.max(0, ATTACHMENT_BY_ID.get(attachment)?.unlockKills ?? 0);

export const weaponKillsOf = (p: UnlockProfile, weapon: string) => readProgressionExt(p).weaponKills[weapon] ?? 0;

export const featureUnlocked = (p: UnlockProfile, id: string) => isUnlocked(p, 'feature', id);
export const hasCreateAClass = (p: UnlockProfile) => featureUnlocked(p, 'createAClass');

/** Custom class slots the player may edit (0 before Create-a-Class). */
export function classSlots(p: UnlockProfile): number {
  if (!hasCreateAClass(p)) return 0;
  return CLASS_SLOT_LEVELS.filter((l) => p.level >= l).length + PRESTIGE_CLASS_SLOTS.filter((x) => p.prestige >= x).length;
}

/** How many entries of `profile.loadouts` may be selected (defaults always count). */
export const usableClassCount = (p: UnlockProfile) => Math.max(DEFAULT_LOADOUTS.length, classSlots(p));

/** Is an item unlocked for this profile? `weapon` is required for attachments. */
export function isUnlocked(p: UnlockProfile, kind: UnlockKind, id: string, weapon?: string): boolean {
  for (const rule of UNLOCK_RULES) {
    const v = rule(p, kind, id, weapon);
    if (v !== undefined) return v;
  }
  switch (kind) {
    case 'attachment': {
      if (!weapon) return false;
      if (!isUnlocked(p, 'weapon', weapon)) return false;
      return weaponKillsOf(p, weapon) >= attachmentKillsNeeded(id);
    }
    case 'pro': {
      const perk = PERK_BY_ID.get(id);
      return !!perk && challengeComplete(p.challengeProgress, perk.pro.challenge);
    }
    case 'class':
      return classSlots(p) >= Number(id);
    case 'emblem':
      return p.unlocks.includes(id) || (/^prestige_\d+$/.test(id) && p.prestige >= Number(id.slice(9)));
    case 'lethal':
    case 'tactical':
      if (!EQUIPMENT_BY_ID.has(id)) return true;
      return p.level >= unlockLevelOf(kind, id);
    default:
      return p.level >= unlockLevelOf(kind, id);
  }
}

// ---------------------------------------------------------------------------------------------
// The table (levels 1-50)
// ---------------------------------------------------------------------------------------------

const KIND_ORDER: Record<UnlockKind, number> = { feature: 0, class: 1, weapon: 2, attachment: 3, perk: 4, pro: 5, killstreak: 6, lethal: 7, tactical: 8, emblem: 9 };
const CLASS_LABEL: Record<string, string> = { ar: 'Assault', smg: 'SMG', lmg: 'LMG', sniper: 'Sniper', shotgun: 'Shotgun', pistol: 'Pistol', launcher: 'Launcher', special: 'Special' };

/** Everything that unlocks by level, sorted by level. Rebuilt per call (defs may be overridden). */
export function unlockTable(): UnlockEntry[] {
  const t: UnlockEntry[] = [];
  for (const f of FEATURE_UNLOCKS) t.push({ level: f.level, kind: 'feature', id: featureUnlockId(f.id), name: f.name, detail: f.detail });
  CLASS_SLOT_LEVELS.forEach((level, i) => t.push({ level, kind: 'class', id: classUnlockId(i + 1), name: `Custom Class ${i + 1}`, detail: 'Create-a-Class slot' }));
  for (const w of WEAPONS) t.push({ level: unlockLevelOf('weapon', w.id), kind: 'weapon', id: w.id, name: w.name, detail: CLASS_LABEL[w.class] ?? w.class });
  for (const k of PERKS) t.push({ level: unlockLevelOf('perk', k.id), kind: 'perk', id: k.id, name: k.name, detail: `Perk ${k.tier}` });
  for (const k of KILLSTREAKS) t.push({ level: unlockLevelOf('killstreak', k.id), kind: 'killstreak', id: k.id, name: k.name, detail: `${k.kills} kills` });
  for (const e of EQUIPMENT_UNLOCKS) t.push({ level: e.level, kind: e.kind, id: e.id, name: e.name, detail: e.kind === 'lethal' ? 'Lethal' : 'Tactical' });
  return t.sort((a, b) => a.level - b.level || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name));
}

export const unlocksAtLevel = (level: number) => unlockTable().filter((u) => u.level === level);

/** Entries that open when going from `from` to `to` (exclusive, inclusive). */
export const unlocksBetween = (from: number, to: number) => unlockTable().filter((u) => u.level > from && u.level <= to);

/** Attachment unlocks for a weapon, in kill order. */
export function attachmentUnlocks(weapon: string): { id: string; name: string; kills: number }[] {
  const w = WEAPON_BY_ID.get(weapon);
  if (!w) return [];
  return w.attachments
    .map((a) => ({ id: a, name: ATTACHMENT_BY_ID.get(a)?.name ?? a, kills: attachmentKillsNeeded(a) }))
    .sort((a, b) => a.kills - b.kills);
}

/** Attachments that open when a weapon's kill count goes from `before` to `after`. */
export function attachmentsUnlockedBetween(weapon: string, before: number, after: number): UnlockEntry[] {
  const w = WEAPON_BY_ID.get(weapon);
  if (!w) return [];
  return attachmentUnlocks(weapon)
    .filter((a) => a.kills > before && a.kills <= after)
    .map((a) => ({ level: 0, kind: 'attachment' as const, id: attachmentUnlockId(weapon, a.id), name: `${w.name} ${a.name}`, detail: `${a.kills} kills` }));
}

// ---------------------------------------------------------------------------------------------
// profile.unlocks bookkeeping
// ---------------------------------------------------------------------------------------------

/** Every unlock id progression manages (anything else in profile.unlocks is left alone). */
function managedIds(): Set<string> {
  const s = new Set<string>();
  for (const u of unlockTable()) s.add(u.id);
  for (const w of WEAPONS) for (const a of w.attachments) s.add(attachmentUnlockId(w.id, a));
  for (const p of PERKS) s.add(proUnlockId(p.id));
  for (let i = 1; i <= CLASS_SLOT_LEVELS.length + PRESTIGE_CLASS_SLOTS.length; i++) s.add(classUnlockId(i));
  for (let i = 1; i <= MAX_PRESTIGE; i++) s.add(prestigeEmblem(i));
  return s;
}

/** The unlock ids this profile has earned through progression right now. */
export function computeUnlockIds(p: UnlockProfile): string[] {
  const out: string[] = [];
  for (const u of unlockTable()) {
    if (u.kind === 'feature' ? isUnlocked(p, 'feature', u.id.slice(8)) : u.kind === 'class' ? false : isUnlocked(p, u.kind, u.id)) out.push(u.id);
  }
  const slots = classSlots(p);
  for (let i = 1; i <= slots; i++) out.push(classUnlockId(i));
  for (const w of WEAPONS) for (const a of w.attachments) if (isUnlocked(p, 'attachment', a, w.id)) out.push(attachmentUnlockId(w.id, a));
  for (const k of PERKS) if (isUnlocked(p, 'pro', k.id)) out.push(proUnlockId(k.id));
  for (let i = 1; i <= Math.min(p.prestige, MAX_PRESTIGE); i++) out.push(prestigeEmblem(i));
  return out;
}

/** Bring `profile.unlocks` in line with progression (keeps foreign ids). Returns ids added. */
export function syncUnlocks(p: UnlockProfile): string[] {
  const managed = managedIds();
  const now = new Set(computeUnlockIds(p));
  const kept = p.unlocks.filter((u) => !managed.has(u) || now.has(u));
  const have = new Set(kept);
  const added: string[] = [];
  for (const u of now) {
    if (!have.has(u)) {
      kept.push(u);
      added.push(u);
    }
  }
  p.unlocks.splice(0, p.unlocks.length, ...kept);
  return added;
}

// ---------------------------------------------------------------------------------------------
// Loadout gating (server: beforeSpawn; client: create-a-class locks)
// ---------------------------------------------------------------------------------------------

export interface LoadoutViolation {
  kind: UnlockKind;
  id: string;
  /** Human readable: "Requires level 14", "Requires 50 AK-47 kills". */
  reason: string;
}

export function lockReason(kind: UnlockKind, id: string, weapon?: string): string {
  if (kind === 'attachment' && weapon) return `Requires ${attachmentKillsNeeded(id)} ${WEAPON_BY_ID.get(weapon)?.name ?? weapon} kills`;
  if (kind === 'pro') {
    const perk = PERK_BY_ID.get(id);
    return `Complete the ${perk?.name ?? id} Pro challenge`;
  }
  if (kind === 'class') return `Requires level ${unlockLevelOf('class', id)}`;
  return `Requires level ${unlockLevelOf(kind, id)}`;
}

function fallbackWeapon(p: UnlockProfile, slot: 'primary' | 'secondary'): WeaponLoadout {
  const def = DEFAULT_LOADOUTS[0]![slot];
  if (isUnlocked(p, 'weapon', def.weapon)) return { weapon: def.weapon, attachments: [], camo: 'none' };
  const any = WEAPONS.filter((w) => w.slot === slot && isUnlocked(p, 'weapon', w.id)).sort((a, b) => a.unlockLevel - b.unlockLevel)[0];
  return { weapon: any?.id ?? def.weapon, attachments: [], camo: 'none' };
}

/**
 * Strip or replace everything in a loadout the profile hasn't unlocked: locked weapons fall back to
 * the default class's (or the first unlocked) weapon, locked attachments / perks / killstreaks are
 * dropped, locked equipment becomes null. Pure; returns a new loadout.
 */
export function gateLoadout(p: UnlockProfile, input: Loadout): { loadout: Loadout; violations: LoadoutViolation[] } {
  const l = cloneLoadout(input);
  const violations: LoadoutViolation[] = [];
  const deny = (kind: UnlockKind, id: string, weapon?: string) => violations.push({ kind, id, reason: lockReason(kind, id, weapon) });
  for (const slot of ['primary', 'secondary'] as const) {
    const w = l[slot];
    if (!isUnlocked(p, 'weapon', w.weapon)) {
      deny('weapon', w.weapon);
      l[slot] = { ...fallbackWeapon(p, slot), camo: w.camo };
      continue;
    }
    w.attachments = w.attachments.filter((a) => {
      const ok = isUnlocked(p, 'attachment', a, w.weapon);
      if (!ok) deny('attachment', a, w.weapon);
      return ok;
    });
  }
  l.perks = l.perks.filter((id) => {
    const ok = isUnlocked(p, 'perk', id);
    if (!ok) deny('perk', id);
    return ok;
  });
  l.killstreaks = l.killstreaks.filter((id) => {
    const ok = isUnlocked(p, 'killstreak', id);
    if (!ok) deny('killstreak', id);
    return ok;
  });
  if (l.lethal && !isUnlocked(p, 'lethal', l.lethal)) {
    deny('lethal', l.lethal);
    l.lethal = null;
  }
  if (l.tactical && !isUnlocked(p, 'tactical', l.tactical)) {
    deny('tactical', l.tactical);
    l.tactical = null;
  }
  return { loadout: l, violations };
}

/**
 * The class a profile actually gets for `index`: a default class (by index) until Create-a-Class
 * opens; afterwards the profile's own class if the slot is usable, else the first one. Not gated
 * yet: run `gateLoadout` on the result.
 */
export function classForSelection(p: UnlockProfile & Pick<Profile, 'loadouts'>, index: number): Loadout {
  const defaults = DEFAULT_LOADOUTS;
  const i = Math.max(0, Math.floor(index));
  if (!hasCreateAClass(p)) return cloneLoadout(defaults[i % defaults.length]!);
  const usable = Math.min(usableClassCount(p), p.loadouts.length);
  return cloneLoadout(p.loadouts[i < usable ? i : 0] ?? defaults[0]!);
}
