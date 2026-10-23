/**
 * Per-weapon camo challenges (owner: economy): the MW2 collection's unlock rules, shared by the
 * store (gun page, Camos tab), Create-a-Class, the save / setCamo RPCs, the spawn check and the
 * progression tracker's unlock popups. Pure.
 *
 * MW2 model: a camo from the collection is open on a gun once the player's career record with that
 * gun meets its `weaponChallenge` (kills and/or headshots: `stats['weapon.<id>.kills']`,
 * `stats['weapon.<id>.headshots']`, kept by the progression tracker). Unlocked camos are free and
 * stay unlocked (the record is never reset). Only primary weapons take MW2 camos.
 */
import { CAMO_BY_ID, MW2_CAMOS, type CamoDef } from './camos';
import { WEAPON_BY_ID, type WeaponDef } from './weapons';

type StatsLike = { stats?: Record<string, number> };

/** Career kills with a weapon (the combat record). */
export const weaponKillCount = (p: StatsLike, weapon: string) => p.stats?.[`weapon.${weapon}.kills`] ?? 0;
/** Career headshot kills with a weapon (the combat record). */
export const weaponHeadshotCount = (p: StatsLike, weapon: string) => p.stats?.[`weapon.${weapon}.headshots`] ?? 0;

export const isWeaponChallengeCamo = (def: CamoDef | undefined): boolean => !!def?.weaponChallenge;

/** Can this camo go on this gun at all? MW2 camos: classable primaries only (as in MW2). */
export function camoFitsWeapon(def: CamoDef, weapon: WeaponDef | undefined): boolean {
  if (!def.weaponChallenge) return true;
  return !!weapon && weapon.slot === 'primary' && !weapon.wonder;
}

export interface WeaponCamoProgress {
  camo: CamoDef;
  weapon: string;
  /** Kills with the gun so far / needed (need 0 = no kill requirement). */
  kills: { have: number; need: number };
  /** Headshots with the gun so far / needed (need 0 = no headshot requirement). */
  headshots: { have: number; need: number };
  /** The camo fits the gun (MW2 camos: primaries only). */
  fits: boolean;
  unlocked: boolean;
  /** 0..1 towards the unlock (the slowest requirement). */
  fraction: number;
  /** "18/25 AK-47 headshots" (requirements still open), "Unlocked", "Primary weapons only". */
  progress: string;
  /** "Expert I · 5 headshots" / "Free". */
  challenge: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One camo's challenge state for one gun, or null if the camo isn't a per-weapon challenge camo. */
export function weaponCamoProgress(p: StatsLike, camoId: string, weaponId: string, weapons: ReadonlyMap<string, WeaponDef> = WEAPON_BY_ID): WeaponCamoProgress | null {
  const camo = CAMO_BY_ID.get(camoId);
  return camo ? challengeProgress(p, camo, weaponId, weapons) : null;
}

/** `weaponCamoProgress` for a def in hand (null if it has no `weaponChallenge`). */
export function challengeProgress(p: StatsLike, camo: CamoDef, weaponId: string, weapons: ReadonlyMap<string, WeaponDef> = WEAPON_BY_ID): WeaponCamoProgress | null {
  if (!camo.weaponChallenge) return null;
  const ch = camo.weaponChallenge;
  const wdef = weapons.get(weaponId);
  const wName = wdef?.name ?? weaponId;
  const fits = camoFitsWeapon(camo, wdef);
  const kills = { have: weaponKillCount(p, weaponId), need: ch.kills ?? 0 };
  const headshots = { have: weaponHeadshotCount(p, weaponId), need: ch.headshots ?? 0 };
  const open = kills.have >= kills.need && headshots.have >= headshots.need;
  const parts: number[] = [];
  if (kills.need) parts.push(Math.min(1, kills.have / kills.need));
  if (headshots.need) parts.push(Math.min(1, headshots.have / headshots.need));
  const fraction = parts.length ? Math.min(...parts) : 1;
  const missing: string[] = [];
  if (kills.have < kills.need) missing.push(`${kills.have}/${kills.need} ${wName} kills`);
  if (headshots.have < headshots.need) missing.push(`${headshots.have}/${headshots.need} ${wName} headshots`);
  const needs = [kills.need ? plural(kills.need, 'kill') : '', headshots.need ? plural(headshots.need, 'headshot') : ''].filter(Boolean).join(' + ');
  return {
    camo,
    weapon: weaponId,
    kills,
    headshots,
    fits,
    unlocked: fits && open,
    fraction: fits ? fraction : 0,
    progress: !fits ? 'Primary weapons only' : open ? 'Unlocked' : missing.join(', '),
    challenge: needs ? [ch.title, needs].filter(Boolean).join(' · ') : 'Free',
  };
}

/** Is a per-weapon challenge camo open on this gun? (False for camos that aren't challenge camos.) */
export const weaponCamoUnlocked = (p: StatsLike, camoId: string, weaponId: string) => weaponCamoProgress(p, camoId, weaponId)?.unlocked ?? false;

/** Every MW2 camo's state for one gun, in MW2's order. */
export function mw2CamoProgress(p: StatsLike, weaponId: string, weapons?: ReadonlyMap<string, WeaponDef>): WeaponCamoProgress[] {
  return MW2_CAMOS.map((c) => weaponCamoProgress(p, c.id, weaponId, weapons)!);
}

/** MW2 camos a kill moves over their threshold (for the "new unlock" popup): before/after counts. */
export function mw2CamosUnlockedBetween(weaponId: string, before: { kills: number; headshots: number }, after: { kills: number; headshots: number }): CamoDef[] {
  const w = WEAPON_BY_ID.get(weaponId);
  const open = (c: CamoDef, n: { kills: number; headshots: number }) => n.kills >= (c.weaponChallenge!.kills ?? 0) && n.headshots >= (c.weaponChallenge!.headshots ?? 0);
  return MW2_CAMOS.filter((c) => camoFitsWeapon(c, w) && (c.weaponChallenge!.kills || c.weaponChallenge!.headshots) && !open(c, before) && open(c, after));
}
