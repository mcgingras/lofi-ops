/**
 * Weapon attachments (owner: weapons feature) and `effectiveWeapon`, which folds attachment
 * modifiers into a WeaponDef. Core combat always fights with the effective def.
 *
 * Rules (BO1): a weapon accepts only the attachments in its `WeaponDef.attachments` list, at most
 * one per attachment slot, and only ONE attachment in total unless the player has extra slots
 * (Warlord: `room.modifiers.add('attachmentSlotsOffset', (p) => hasWarlord(p) ? 1 : undefined)`;
 * the weapons feature enforces the count at spawn). `validAttachments(def, ids, max)` is the
 * pure rule the server and the loadout editor share.
 *
 * `unlockKills` is the number of kills with that weapon needed to unlock the attachment (for the
 * progression feature); `price` is the CoD Points price (economy).
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
  /** Variable zoom levels the player cycles through while scoped (first is the default). */
  zoomLevels: number[];
  /** No aiming down sights (dual wield): ADS spread = hip spread, no zoom. */
  noAds: boolean;
  /** Shows the scope overlay (variable zoom keeps it; an ACOG on a sniper removes it). */
  scope: boolean;
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
  /** One-line description for menus. */
  blurb?: string;
  /** Per-class modifier overrides (e.g. an ACOG on a sniper zooms differently). */
  byClass?: Partial<Record<WeaponDef['class'], Partial<WeaponModifiers>>>;
}

export const ATTACHMENTS: AttachmentDef[] = [
  { id: 'reddot', name: 'Red Dot Sight', slot: 'optic', blurb: 'Red dot optic with a slight zoom.', modifiers: { zoom: 1.25 }, unlockKills: 0, model: 'reddot', price: 1000 },
  { id: 'reflex', name: 'Reflex Sight', slot: 'optic', blurb: 'Open reflex sight, minimal zoom, quick to aim.', modifiers: { zoom: 1.15, adsTimeMult: 0.95 }, unlockKills: 5, model: 'reflex', price: 1000 },
  {
    id: 'acog',
    name: 'ACOG Sight',
    slot: 'optic',
    blurb: 'Magnified scope: more zoom, slower to aim.',
    modifiers: { zoom: 2.2, adsTimeMult: 1.15, adsSpreadMult: 0.8 },
    byClass: { sniper: { zoom: 2.8, scope: false, adsTimeMult: 0.85 }, pistol: { zoom: 1.8 } },
    unlockKills: 25,
    model: 'acog',
    price: 2000,
  },
  { id: 'varzoom', name: 'Variable Zoom', slot: 'optic', blurb: 'Sniper scope with three zoom levels (X or middle mouse).', modifiers: { zoom: 4.5, zoomLevels: [4.5, 7, 10] }, unlockKills: 30, model: 'varzoom', price: 1500 },
  { id: 'suppressor', name: 'Suppressor', slot: 'muzzle', blurb: 'Stays off the radar when firing. Reduced range.', modifiers: { suppressed: true, rangeMult: 0.7 }, unlockKills: 40, model: 'suppressor', price: 3000 },
  { id: 'extmag', name: 'Extended Mag', slot: 'magazine', blurb: 'More rounds per magazine.', modifiers: { magazineMult: 1.5, reserveMult: 1.25 }, unlockKills: 10, model: 'extmag', price: 1500 },
  { id: 'dualmag', name: 'Dual Mag', slot: 'magazine', blurb: 'Taped magazines: faster reloads.', modifiers: { reloadMult: 0.72 }, unlockKills: 20, model: 'dualmag', price: 1500 },
  { id: 'grip', name: 'Grip', slot: 'underbarrel', blurb: 'Foregrip: less recoil.', modifiers: { recoilMult: 0.6 }, unlockKills: 15, model: 'grip', price: 1000 },
  { id: 'gl', name: 'Grenade Launcher', slot: 'underbarrel', blurb: 'Underbarrel launcher: switch to it with 3 (or the wheel).', modifiers: { adsTimeMult: 1.1, moveMult: 0.97 }, unlockKills: 50, model: 'gl', price: 2000 },
  { id: 'rapidfire', name: 'Rapid Fire', slot: 'other', blurb: 'Higher rate of fire, more kick and spread.', modifiers: { rpmMult: 1.3, hipSpreadMult: 1.25, recoilMult: 1.2 }, unlockKills: 30, model: 'rapidfire', price: 2000 },
  { id: 'dual', name: 'Dual Wield', slot: 'other', blurb: 'A pistol in each hand: double the rounds and fire rate, no aiming.', modifiers: { magazineMult: 2, reserveMult: 2, rpmMult: 1.6, hipSpreadMult: 1.25, noAds: true, reloadMult: 1.3 }, unlockKills: 25, model: 'dual', price: 2000 },
  { id: 'speedreloader', name: 'Speed Reloader', slot: 'magazine', blurb: 'Revolver speed loader: much faster reloads.', modifiers: { reloadMult: 0.55 }, unlockKills: 20, model: 'speedreloader', price: 1000 },
];

export const ATTACHMENT_BY_ID = indexById(ATTACHMENTS);

/** BO1: one attachment per weapon (Warlord adds one). */
export const BASE_ATTACHMENT_SLOTS = 1;

/**
 * The attachments from `ids` that `def` really takes: known, on the weapon's list, unique, one per
 * attachment slot, at most `max` in total (in the order given).
 */
export function validAttachments(def: Pick<WeaponDef, 'attachments'>, ids: readonly string[], max = Infinity): string[] {
  const used: string[] = [];
  const slots = new Set<AttachmentSlot>();
  for (const id of ids) {
    if (used.length >= max) break;
    const a = ATTACHMENT_BY_ID.get(id);
    if (!a || !def.attachments.includes(id) || slots.has(a.slot) || used.includes(id)) continue;
    slots.add(a.slot);
    used.push(id);
  }
  return used;
}

/** Can `id` go on `def` next to `others` (slot clash and count)? */
export function canAttach(def: Pick<WeaponDef, 'attachments'>, id: string, others: readonly string[] = [], max = BASE_ATTACHMENT_SLOTS): boolean {
  const a = ATTACHMENT_BY_ID.get(id);
  if (!a || !def.attachments.includes(id)) return false;
  const rest = validAttachments(def, others.filter((o) => o !== id));
  if (rest.length + 1 > max) return false;
  return !rest.some((o) => ATTACHMENT_BY_ID.get(o)!.slot === a.slot);
}

/** Effective weapon stats with attachments applied. Unknown or disallowed ids are ignored. */
export interface EffectiveWeapon extends WeaponDef {
  base: WeaponDef;
  attachmentIds: string[];
  suppressed: boolean;
  /** Variable zoom levels (empty unless the optic has them). */
  zoomLevels: number[];
  /** True when ADS is disabled (dual wield). */
  noAds: boolean;
}

const MULTS = ['damageMult', 'rangeMult', 'hipSpreadMult', 'adsSpreadMult', 'adsTimeMult', 'reloadMult', 'magazineMult', 'reserveMult', 'moveMult', 'recoilMult', 'rpmMult'] as const;

export function effectiveWeapon(def: WeaponDef, attachmentIds: readonly string[] = []): EffectiveWeapon {
  const m: WeaponModifiers = { damageMult: 1, rangeMult: 1, hipSpreadMult: 1, adsSpreadMult: 1, adsTimeMult: 1, reloadMult: 1, magazineMult: 1, reserveMult: 1, moveMult: 1, recoilMult: 1, rpmMult: 1, zoom: def.zoom ?? 1.15, suppressed: false, zoomLevels: [], noAds: false, scope: !!def.scope };
  const used = validAttachments(def, attachmentIds);
  for (const id of used) {
    const a = ATTACHMENT_BY_ID.get(id)!;
    for (const x of [a.modifiers, a.byClass?.[def.class]]) {
      if (!x) continue;
      for (const k of MULTS) if (x[k] !== undefined) m[k] *= x[k];
      if (x.zoom !== undefined) m.zoom = x.zoom;
      if (x.suppressed) m.suppressed = true;
      if (x.zoomLevels) m.zoomLevels = [...x.zoomLevels];
      if (x.noAds) m.noAds = true;
      if (x.scope !== undefined) m.scope = x.scope;
    }
  }
  const hip = def.spread.hip * m.hipSpreadMult;
  const range = def.range ?? 200;
  return {
    ...def,
    base: def,
    attachmentIds: used,
    suppressed: m.suppressed,
    zoomLevels: m.zoomLevels,
    noAds: m.noAds,
    damage: { near: def.damage.near * m.damageMult, far: def.damage.far * m.damageMult, nearRange: def.damage.nearRange * m.rangeMult, farRange: def.damage.farRange * m.rangeMult },
    rpm: def.rpm * m.rpmMult,
    magazine: Math.round(def.magazine * m.magazineMult),
    reserve: Math.round(def.reserve * m.reserveMult),
    reloadMs: def.reloadMs * m.reloadMult,
    reloadEmptyMs: def.reloadEmptyMs * m.reloadMult,
    ...(def.shellReload ? { shellReload: { ...def.shellReload, perShellMs: def.shellReload.perShellMs * m.reloadMult } } : {}),
    adsMs: def.adsMs * m.adsTimeMult,
    moveMult: def.moveMult * m.moveMult,
    spread: { hip, ads: m.noAds ? hip : def.spread.ads * m.adsSpreadMult, move: def.spread.move },
    recoil: { vertical: def.recoil.vertical * m.recoilMult, horizontal: def.recoil.horizontal * m.recoilMult, recovery: def.recoil.recovery },
    zoom: m.noAds ? 1 : m.zoom,
    scope: m.scope,
    ...(m.rangeMult !== 1 ? { range: range * Math.max(0.5, m.rangeMult) } : {}),
  };
}
