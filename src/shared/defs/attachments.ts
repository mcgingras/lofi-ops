/**
 * Weapon attachments (owner: weapons feature) and `effectiveWeapon`, which folds attachment
 * modifiers into a WeaponDef. Core combat always fights with the effective def.
 */
import { indexById } from './registry';
import type { WeaponDef } from './weapons';

/** Everything an attachment may change. Multipliers default to 1, adds to 0. */
export interface WeaponModifiers {
  damageMult: number;
  rangeMult: number;
  hipSpreadMult: number;
  adsSpreadMult: number;
  adsTimeMult: number;
  reloadMult: number;
  magazineMult: number;
  reserveMult: number;
  moveMult: number;
  recoilMult: number;
  rpmMult: number;
  /** Replaces the weapon's ADS zoom. */
  zoom: number;
  /** Suppressed: no radar ping on fire, quieter. */
  suppressed: boolean;
}

export type AttachmentSlot = 'optic' | 'muzzle' | 'underbarrel' | 'magazine' | 'other';

export interface AttachmentDef {
  id: string;
  name: string;
  slot: AttachmentSlot;
  modifiers: Partial<WeaponModifiers>;
  /** Kills with the weapon needed to unlock (per weapon). */
  unlockKills?: number;
  /** Model piece id for the viewmodel. */
  model?: string;
  /** CoD Points price. */
  price?: number;
}

export const ATTACHMENTS: AttachmentDef[] = [
  { id: 'reddot', name: 'Red Dot Sight', slot: 'optic', modifiers: { zoom: 1.2 }, unlockKills: 0, model: 'reddot', price: 1000 },
  { id: 'extmag', name: 'Extended Mag', slot: 'magazine', modifiers: { magazineMult: 1.5 }, unlockKills: 0, model: 'extmag', price: 2000 },
];

export const ATTACHMENT_BY_ID = indexById(ATTACHMENTS);

/** Effective weapon stats with attachments applied. Unknown or disallowed ids are ignored. */
export interface EffectiveWeapon extends WeaponDef {
  base: WeaponDef;
  attachmentIds: string[];
  suppressed: boolean;
}

export function effectiveWeapon(def: WeaponDef, attachmentIds: readonly string[] = []): EffectiveWeapon {
  const m: WeaponModifiers = { damageMult: 1, rangeMult: 1, hipSpreadMult: 1, adsSpreadMult: 1, adsTimeMult: 1, reloadMult: 1, magazineMult: 1, reserveMult: 1, moveMult: 1, recoilMult: 1, rpmMult: 1, zoom: def.zoom ?? 1.15, suppressed: false };
  const used: string[] = [];
  const slots = new Set<AttachmentSlot>();
  for (const id of attachmentIds) {
    const a = ATTACHMENT_BY_ID.get(id);
    if (!a || !def.attachments.includes(id) || slots.has(a.slot)) continue;
    slots.add(a.slot);
    used.push(id);
    const x = a.modifiers;
    for (const k of ['damageMult', 'rangeMult', 'hipSpreadMult', 'adsSpreadMult', 'adsTimeMult', 'reloadMult', 'magazineMult', 'reserveMult', 'moveMult', 'recoilMult', 'rpmMult'] as const) {
      if (x[k] !== undefined) m[k] *= x[k];
    }
    if (x.zoom !== undefined) m.zoom = x.zoom;
    if (x.suppressed) m.suppressed = true;
  }
  return {
    ...def,
    base: def,
    attachmentIds: used,
    suppressed: m.suppressed,
    damage: { near: def.damage.near * m.damageMult, far: def.damage.far * m.damageMult, nearRange: def.damage.nearRange * m.rangeMult, farRange: def.damage.farRange * m.rangeMult },
    rpm: def.rpm * m.rpmMult,
    magazine: Math.round(def.magazine * m.magazineMult),
    reserve: Math.round(def.reserve * m.reserveMult),
    reloadMs: def.reloadMs * m.reloadMult,
    reloadEmptyMs: def.reloadEmptyMs * m.reloadMult,
    adsMs: def.adsMs * m.adsTimeMult,
    moveMult: def.moveMult * m.moveMult,
    spread: { hip: def.spread.hip * m.hipSpreadMult, ads: def.spread.ads * m.adsSpreadMult, move: def.spread.move },
    recoil: { vertical: def.recoil.vertical * m.recoilMult, horizontal: def.recoil.horizontal * m.recoilMult, recovery: def.recoil.recovery },
    zoom: m.zoom,
  };
}
