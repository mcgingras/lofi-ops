/**
 * Create-a-class rules (owner: frontend): which items a profile can equip and why not, full
 * validation of an untrusted loadout (structure + unlocks + attachment slots + one perk per tier
 * + killstreaks sorted by kill count), class slot count and the menu's weapon stat bars.
 *
 * Unlock rule (permissive OR, so progression/economy can grant items however they like):
 *   an item is unlocked if `profile.unlocks` or `profile.owned` lists its id (attachments and camos
 *   also as `<weapon>:<id>`), or its own requirement is met: weapons/perks/killstreaks/equipment by
 *   level, attachments by kills with that weapon (`stats['weapon.<id>.kills']`), camos when free,
 *   or their `unlock` rule is met (level / prestige / challenge complete). Priced camos must be
 *   owned (bought in the store).
 */
import { ATTACHMENT_BY_ID, effectiveWeapon, type AttachmentDef } from '../defs/attachments';
import { CAMO_BY_ID, type CamoDef } from '../defs/camos';
import { CHALLENGES } from '../defs/challenges';
import { KILLSTREAK_BY_ID, type KillstreakDef } from '../defs/killstreaks';
import { PERK_BY_ID, type PerkDef } from '../defs/perks';
import { attachmentKillsFor } from '../defs/progression';
import { WEAPON_BY_ID, type WeaponDef } from '../defs/weapons';
import { DEFAULT_LOADOUTS, type Loadout, type WeaponLoadout } from '../loadout';
import type { Profile } from '../profile';
import { EQUIPMENT_BY_ID, type EquipmentDef } from './equipment';

export interface Catalog {
  weapons: ReadonlyMap<string, WeaponDef>;
  attachments: ReadonlyMap<string, AttachmentDef>;
  perks: ReadonlyMap<string, PerkDef>;
  killstreaks: ReadonlyMap<string, KillstreakDef>;
  camos: ReadonlyMap<string, CamoDef>;
  equipment: ReadonlyMap<string, EquipmentDef>;
}

export const CATALOG: Catalog = {
  weapons: WEAPON_BY_ID,
  attachments: ATTACHMENT_BY_ID,
  perks: PERK_BY_ID,
  killstreaks: KILLSTREAK_BY_ID,
  camos: CAMO_BY_ID,
  equipment: EQUIPMENT_BY_ID,
};

export type ItemKind = 'weapon' | 'attachment' | 'perk' | 'killstreak' | 'camo' | 'equipment';
export type UnlockProfile = Pick<Profile, 'level' | 'prestige' | 'unlocks' | 'owned' | 'stats' | 'challengeProgress'> & Partial<Pick<Profile, 'ext'>>;

export interface ItemLock {
  unlocked: boolean;
  /** Human readable requirement when locked ("Level 12", "25 kills with AK-47", "Store: 500 CP"). */
  requirement: string | null;
}

const OPEN: ItemLock = { unlocked: true, requirement: null };
const locked = (requirement: string): ItemLock => ({ unlocked: false, requirement });
const orPrice = (price: number | undefined) => (price ? ` or ${price.toLocaleString('en-US')} CP` : '');

/** Is `id` (of `kind`) available to this profile? `weapon` is needed for attachments/camos. */
export function itemLock(p: UnlockProfile, kind: ItemKind, id: string, weapon: string | null = null, cat: Catalog = CATALOG): ItemLock {
  if (kind === 'camo' && id === 'none') return OPEN;
  const has = (x: string) => p.unlocks.includes(x) || p.owned.includes(x);
  if (has(id) || (weapon && has(`${weapon}:${id}`))) return OPEN;
  switch (kind) {
    case 'weapon': {
      const d = cat.weapons.get(id);
      if (!d) return locked('Unknown');
      return p.level >= d.unlockLevel ? OPEN : locked(`Level ${d.unlockLevel}${orPrice(d.price)}`);
    }
    case 'perk': {
      const d = cat.perks.get(id);
      if (!d) return locked('Unknown');
      return p.level >= d.unlockLevel ? OPEN : locked(`Level ${d.unlockLevel}${orPrice(d.price)}`);
    }
    case 'killstreak': {
      const d = cat.killstreaks.get(id);
      if (!d) return locked('Unknown');
      return p.level >= d.unlockLevel ? OPEN : locked(`Level ${d.unlockLevel}`);
    }
    case 'equipment': {
      const d = cat.equipment.get(id);
      if (!d) return locked('Unknown');
      return p.level >= d.unlockLevel ? OPEN : locked(`Level ${d.unlockLevel}`);
    }
    case 'attachment': {
      const d = cat.attachments.get(id);
      if (!d) return locked('Unknown');
      const need = d.unlockKills ?? 0;
      const kills = weapon ? attachmentKillsFor(p, weapon) : 0;
      if (kills >= need) return OPEN;
      const wName = weapon ? (cat.weapons.get(weapon)?.name ?? weapon) : 'this weapon';
      return locked(`${need} kills with ${wName} (${kills}/${need})${orPrice(d.price)}`);
    }
    case 'camo': {
      const d = cat.camos.get(id);
      if (!d) return locked('Unknown');
      const u = d.unlock;
      if (u) {
        const miss: string[] = [];
        if (u.level !== undefined && p.level < u.level) miss.push(`Level ${u.level}`);
        if (u.prestige !== undefined && p.prestige < u.prestige) miss.push(`Prestige ${u.prestige}`);
        if (u.challenge !== undefined) {
          const ch = CHALLENGES.find((c) => c.id === u.challenge);
          const done = ch ? (p.challengeProgress[ch.id] ?? 0) >= ch.goal : false;
          if (!done) miss.push(`Challenge: ${ch?.name ?? u.challenge}`);
        }
        if (!miss.length && !d.price) return OPEN;
        if (!miss.length && d.price) return locked(`Store: ${d.price.toLocaleString('en-US')} CP`);
        return locked(miss.join(', ') + orPrice(d.price));
      }
      return d.price ? locked(`Store: ${d.price.toLocaleString('en-US')} CP`) : OPEN;
    }
  }
}

/** Extra primary attachment slots from perks (Warlord). Perk defs may carry `attachmentSlots`. */
export function attachmentSlotsFor(perks: readonly string[], cat: Catalog = CATALOG): number {
  let n = 1;
  for (const id of perks) {
    const d = cat.perks.get(id) as (PerkDef & { attachmentSlots?: number }) | undefined;
    if (!d) continue;
    n += typeof d.attachmentSlots === 'number' ? d.attachmentSlots : id === 'warlord' ? 1 : 0;
  }
  return Math.max(1, Math.min(2, n));
}

/** Killstreak ids sorted by kills needed (then id), unknown ids dropped. */
export function sortKillstreaks(ids: readonly string[], cat: Catalog = CATALOG): string[] {
  return [...new Set(ids)].filter((id) => cat.killstreaks.has(id)).sort((a, b) => cat.killstreaks.get(a)!.kills - cat.killstreaks.get(b)!.kills || a.localeCompare(b));
}

export const BASE_CLASS_SLOTS = 5;
export const MAX_CLASS_SLOTS = 10;

/** Custom class slots: 5, plus one per prestige (max 10). */
export const classSlotsFor = (p: Pick<Profile, 'prestige'>) => Math.min(MAX_CLASS_SLOTS, BASE_CLASS_SLOTS + Math.max(0, p.prestige));

export interface LoadoutValidation {
  loadout: Loadout;
  /** What was changed and why (empty = accepted as sent). */
  problems: string[];
}

const cleanName = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 24);
  return s.length ? s : null;
};

/** Structural + unlock validation of an untrusted loadout. Locked/invalid picks fall back. */
export function validateLoadout(p: UnlockProfile, input: unknown, fallback: Loadout = DEFAULT_LOADOUTS[0]!, cat: Catalog = CATALOG): LoadoutValidation {
  const problems: string[] = [];
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 16) : []);

  // Perks first: they decide the attachment slots.
  const perks: string[] = [];
  const tiers = new Set<number>();
  for (const id of [...new Set(ids(src.perks))]) {
    const d = cat.perks.get(id);
    if (!d) {
      problems.push(`unknown perk ${id}`);
      continue;
    }
    const l = itemLock(p, 'perk', id, null, cat);
    if (!l.unlocked) {
      problems.push(`${d.name} is locked (${l.requirement})`);
      continue;
    }
    if (tiers.has(d.tier)) {
      problems.push(`only one tier ${d.tier} perk`);
      continue;
    }
    tiers.add(d.tier);
    perks.push(id);
  }
  perks.sort((a, b) => cat.perks.get(a)!.tier - cat.perks.get(b)!.tier);

  const weapon = (v: unknown, slot: 'primary' | 'secondary', fb: WeaponLoadout, slots: number): WeaponLoadout => {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    let id = typeof o.weapon === 'string' ? o.weapon : fb.weapon;
    const d = cat.weapons.get(id);
    if (!d || d.slot !== slot) {
      problems.push(`${slot}: ${id} is not a ${slot} weapon`);
      id = fb.weapon;
    } else {
      const l = itemLock(p, 'weapon', id, null, cat);
      if (!l.unlocked) {
        problems.push(`${d.name} is locked (${l.requirement})`);
        id = fb.weapon;
      }
    }
    const def = cat.weapons.get(id);
    const atts: string[] = [];
    const used = new Set<string>();
    if (def && id === o.weapon) {
      for (const a of [...new Set(ids(o.attachments))]) {
        const ad = cat.attachments.get(a);
        if (!ad || !def.attachments.includes(a)) {
          problems.push(`${def.name} can't take ${a}`);
          continue;
        }
        const l = itemLock(p, 'attachment', a, id, cat);
        if (!l.unlocked) {
          problems.push(`${ad.name} is locked (${l.requirement})`);
          continue;
        }
        if (used.has(ad.slot)) {
          problems.push(`one ${ad.slot} attachment only`);
          continue;
        }
        if (atts.length >= slots) {
          problems.push(slots > 1 ? `max ${slots} attachments` : 'one attachment (Warlord allows two)');
          continue;
        }
        used.add(ad.slot);
        atts.push(a);
      }
    } else if (def && id === fb.weapon) {
      atts.push(...fb.attachments.filter((a) => def.attachments.includes(a)).slice(0, slots));
    }
    let camo = typeof o.camo === 'string' ? o.camo : 'none';
    if (camo !== 'none') {
      const cd = cat.camos.get(camo);
      const l = cd ? itemLock(p, 'camo', camo, id, cat) : locked('Unknown');
      if (!cd || !l.unlocked) {
        problems.push(cd ? `${cd.name} camo is locked (${l.requirement})` : `unknown camo ${camo}`);
        camo = 'none';
      }
    }
    return { weapon: id, attachments: atts, camo };
  };

  const primary = weapon(src.primary, 'primary', fallback.primary, attachmentSlotsFor(perks, cat));
  const secondary = weapon(src.secondary, 'secondary', fallback.secondary, 1);

  const streaks: string[] = [];
  for (const id of [...new Set(ids(src.killstreaks))]) {
    const d = cat.killstreaks.get(id);
    if (!d) {
      problems.push(`unknown killstreak ${id}`);
      continue;
    }
    const l = itemLock(p, 'killstreak', id, null, cat);
    if (!l.unlocked) {
      problems.push(`${d.name} is locked (${l.requirement})`);
      continue;
    }
    if (streaks.length >= 3) {
      problems.push('three killstreaks max');
      continue;
    }
    streaks.push(id);
  }

  const equip = (v: unknown, kind: 'lethal' | 'tactical'): string | null => {
    if (v === null || v === undefined) return null;
    const d = typeof v === 'string' ? cat.equipment.get(v) : undefined;
    if (!d || d.kind !== kind) {
      problems.push(`unknown ${kind} ${String(v)}`);
      return null;
    }
    const l = itemLock(p, 'equipment', d.id, null, cat);
    if (!l.unlocked) {
      problems.push(`${d.name} is locked (${l.requirement})`);
      return null;
    }
    return d.id;
  };

  return {
    loadout: {
      name: cleanName(src.name) ?? fallback.name,
      primary,
      secondary,
      perks,
      killstreaks: sortKillstreaks(streaks, cat),
      lethal: equip(src.lethal, 'lethal'),
      tactical: equip(src.tactical, 'tactical'),
    },
    problems,
  };
}

// ---------------------------------------------------------------------------------------------
// Stat bars
// ---------------------------------------------------------------------------------------------

export interface WeaponStats {
  damage: number;
  range: number;
  fireRate: number;
  accuracy: number;
  mobility: number;
}

export const STAT_LABELS: Record<keyof WeaponStats, string> = { damage: 'Damage', range: 'Range', fireRate: 'Fire rate', accuracy: 'Accuracy', mobility: 'Mobility' };

const c01 = (v: number) => Math.max(0, Math.min(1, v));

/** 0..100 bars for the create-a-class menu (with attachments applied). */
export function weaponStats(def: WeaponDef, attachments: readonly string[] = []): WeaponStats {
  const w = effectiveWeapon(def, attachments);
  const perShot = w.damage.near * (w.pellets ?? 1);
  const damage = c01(perShot / 100);
  const range = c01(w.damage.farRange / 80) * 0.8 + c01((w.range ?? 200) / 400) * 0.2;
  const rpm = w.mode === 'burst' ? w.rpm * 0.7 : w.rpm;
  const fireRate = c01(rpm / 1000);
  const accuracy = c01(1 - c01(w.recoil.vertical / 3) * 0.55 - c01(w.spread.hip / 8) * 0.3 - c01(w.spread.ads / 1.5) * 0.15);
  const mobility = c01((w.moveMult - 0.8) / 0.22) * 0.6 + c01(1 - (w.adsMs - 100) / 450) * 0.4;
  const pct = (v: number) => Math.round(v * 100);
  return { damage: pct(damage), range: pct(range), fireRate: pct(fireRate), accuracy: pct(accuracy), mobility: pct(mobility) };
}
