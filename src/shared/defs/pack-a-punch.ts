/**
 * Pack-a-Punch killstreak (owner: perks-streaks): BO1 Zombies' upgrade machine as a timed,
 * self-use buff. Calling it dips your gun out of view while the machine's jingle plays; it comes
 * back up "packed", and for `TIMED_WEAPON_BUFF_SEC` (60 s) every gun you carry is packed: more
 * damage, a bigger magazine, far more reserve, a quicker reload, a faster cycle for slow guns,
 * BO1's upgraded name, and the animated purple and blue Pack-a-Punch camo that everyone sees.
 *
 * Rules (server: killstreaks/streaks/packapunch.ts):
 * - The buff belongs to the player (`KillstreakExt.papUntil`, room time), not to a weapon. The
 *   countdown runs through death: respawn inside the window and your new loadout is packed too,
 *   as is any gun you pick up or swap to while it lasts.
 * - Activation refills every carried gun to its packed magazine and reserve; a gun packed later
 *   (respawn, pickup, Mystery Box) is filled when it gets packed.
 * - When the time runs out every gun reverts (its own def and camo back) with its ammo clamped
 *   to the normal magazine and reserve; the owner hears a power-down cue and gets a toast.
 * - A gun dropped by a buffed player is never packed: it drops as the plain gun, ammo clamped.
 * - Using it again while buffed resets the countdown to the full 60 s (and refills).
 * - Not in wager matches (One in the Chamber, Gun Game... hand out exact ammo and weapons).
 *
 * Generic on purpose: every weapon gets `PACK_A_PUNCH`'s multipliers unless `PAP_WEAPONS` overrides
 * them, so weapons added later (new wonder weapons) work with no code: add a row to `PAP_WEAPONS`
 * for their upgraded name and any tuning. Damage is applied server-side as a `damageDealt`
 * multiplier keyed on the weapon id the damage is credited to (`papDamageMult`), so projectile and
 * wonder-weapon behaviours need no changes.
 *
 * The client never decides anything: it treats a weapon whose camo is `PAP_CAMO` as packed for its
 * prediction and HUD (the server only ever sets that camo together with the upgrade, and
 * `sanitizeLoadout` refuses it in a class: it is not a CAMOS entry).
 */
import { effectiveWeapon, type EffectiveWeapon } from './attachments';
import { WEAPON_BY_ID, type WeaponDef } from './weapons';

export const PAP_ID = 'pack_a_punch';
/**
 * How long a killstreak's timed weapon upgrade lasts (s): Pack-a-Punch's buff (and the Mystery
 * Box's timed wonder weapon, owned elsewhere, uses the same 60 s).
 */
export const TIMED_WEAPON_BUFF_SEC = 60;
/** The camo a packed weapon wears (client texture `camo.pap`, animated). Not a CAMOS entry: never sold, never in a class. */
export const PAP_CAMO = 'pap';

export const PACK_A_PUNCH = {
  /** The buff lasts this long from the moment the upgrade lands (s); re-using it resets it. */
  buffSec: TIMED_WEAPON_BUFF_SEC,
  /** Default damage multiplier (BO1 roughly doubles; halved toward 100-health players). */
  damageMult: 1.5,
  /** Magazine and reserve multipliers (rounded; a burst gun's magazine stays a multiple of its burst). */
  magMult: 1.5,
  reserveMult: 2.5,
  /** Reload times x this. */
  reloadMult: 0.85,
  /** Guns cycling at or below this rpm (revolvers, bolts, pumps, most wonder weapons) fire faster... */
  slowRpm: 240,
  /** ...by this. */
  slowRpmMult: 1.25,
  /** The upgrade moment: the gun is down this long (s). */
  durationSec: 1.8,
  /** The upgrade lands (stats, ammo, camo) this long after the call, with the gun out of view (s). */
  applyAt: 0.85,
  /** Viewmodel: dips out over `dipSec`, comes back up over the last `raiseSec`. */
  dipSec: 0.45,
  raiseSec: 0.5,
} as const;

/** Small explosive rounds (Cobra's explosive tips, Mustang & Sally): a blast where the bullet stops. */
export interface PapExplosive {
  radius: number;
  /** Damage at the centre and at the edge, before the upgrade's damage multiplier. */
  max: number;
  min: number;
}

/**
 * Per-weapon Pack-a-Punch: the upgraded name and anything that differs from `PACK_A_PUNCH`. `tweak`
 * is a hook for changes the numbers can't express (it gets the packed def and returns overrides).
 */
export interface PapOverride {
  name?: string;
  damage?: number;
  mag?: number;
  reserve?: number;
  reload?: number;
  /** Cycle-rate multiplier (default: `slowRpmMult` for slow guns, else 1). */
  rpm?: number;
  explosive?: PapExplosive;
  tweak?: (packed: EffectiveWeapon) => Partial<WeaponDef>;
}

/**
 * Upgraded names: BO1's where the gun was in BO1 Zombies (from memory of the Pack-a-Punch list),
 * invented in the same spirit for the rest (the MW2 guns, the AK-47, the ASP).
 */
export const PAP_WEAPONS: Record<string, PapOverride> = {
  // Assault rifles
  m16: { name: 'Skullpiercer' },
  famas: { name: 'G16-GL35' },
  ak47: { name: "Reznov's Revenge" },
  commando: { name: 'Predator' },
  galil: { name: 'Lamentation' },
  aug: { name: 'AUG-50M3' },
  acr: { name: 'ACR Annihilator' },
  m16a4: { name: 'Skullsplitter' },
  // SMGs
  mp5k: { name: 'MP115 Kollider' },
  ak74u: { name: 'AK74fu2' },
  mpl: { name: 'MPL-LF' },
  // LMG
  rpk: { name: 'R115 Resonator' },
  // Snipers
  l96a1: { name: 'Iceburg' },
  dragunov: { name: 'D115 Disassembler' },
  intervention: { name: 'Divine Intervention' },
  // Shotguns
  olympia: { name: 'Hades', mag: 1 },
  stakeout: { name: 'Raid' },
  spas12: { name: 'SPAZ-24' },
  // Pistols: BO1's Mustang & Sally fire small grenades, the Cobra explosive tips. Both modest here.
  m1911: { name: 'Mustang & Sally', damage: 1.25, explosive: { radius: 3, max: 30, min: 10 } },
  python: { name: 'Cobra', damage: 1.4, mag: 2, explosive: { radius: 2.5, max: 18, min: 6 } },
  asp: { name: 'Basilisk' },
  // Wonder weapons (BO1's upgraded magazines: X2 40, Zeus Cannon 4, DG-3 JZ 6).
  raygun: { name: "Porter's X2 Ray Gun", mag: 2, reserve: 3 },
  thundergun: { name: 'Zeus Cannon', mag: 2, reserve: 2 },
  wunderwaffe: { name: 'Wunderwaffe DG-3 JZ', mag: 2, reserve: 2 },
  wintershowl: { name: "Winter's Fury" },
  // Wonder weapons another branch adds (names ready for when their ids land).
  scavenger: { name: 'Hyena Infra-Dead' },
  babygun: { name: 'Fractalizer' },
  wavegun: { name: 'Max Wave Gun' },
};

/** The upgraded name of a weapon (fallback: "<name> Upgraded"). */
export function papName(id: string): string {
  return PAP_WEAPONS[id]?.name ?? `${WEAPON_BY_ID.get(id)?.name ?? id} Upgraded`;
}

/** Can this weapon be packed? Guns and wonder weapons; never the knife, the underbarrel launcher or wager specials. */
export function isPackable(id: string): boolean {
  const def = WEAPON_BY_ID.get(id);
  if (!def || def.slot === 'melee' || def.slot === 'attachment') return false;
  return def.class !== 'special' || !!def.wonder;
}

/** The damage multiplier a packed weapon deals. */
export const papDamageMult = (id: string): number => PAP_WEAPONS[id]?.damage ?? PACK_A_PUNCH.damageMult;

/** Explosive rounds of a packed weapon, if it has them. */
export const papExplosive = (id: string): PapExplosive | null => PAP_WEAPONS[id]?.explosive ?? null;

/** The cycle-rate multiplier of a packed weapon. */
export function papRpmMult(def: Pick<WeaponDef, 'id' | 'rpm'>): number {
  const o = PAP_WEAPONS[def.id]?.rpm;
  if (o !== undefined) return o;
  return def.rpm <= PACK_A_PUNCH.slowRpm ? PACK_A_PUNCH.slowRpmMult : 1;
}

/**
 * The packed version of an effective weapon (attachments already applied): name, magazine,
 * reserve, reload and cycle rate. Damage is not baked in (the server applies `papDamageMult` to
 * whatever the weapon deals, hitscan or not). Idempotent on the base def: packing twice packs once.
 */
export function packDef(def: EffectiveWeapon): EffectiveWeapon {
  const id = def.base.id;
  const o = PAP_WEAPONS[id] ?? {};
  const P = PACK_A_PUNCH;
  const burst = def.mode === 'burst' ? Math.max(1, def.burst ?? 3) : 1;
  const magazine = Math.max(def.magazine, Math.round((def.magazine * (o.mag ?? P.magMult)) / burst) * burst);
  const reserve = Math.max(def.reserve, Math.round(def.reserve * (o.reserve ?? P.reserveMult)));
  const rl = o.reload ?? P.reloadMult;
  const packed: EffectiveWeapon = {
    ...def,
    name: papName(id),
    magazine,
    reserve,
    reloadMs: def.reloadMs * rl,
    reloadEmptyMs: def.reloadEmptyMs * rl,
    ...(def.shellReload ? { shellReload: { ...def.shellReload, perShellMs: def.shellReload.perShellMs * rl } } : {}),
    rpm: def.rpm * papRpmMult(def.base),
  };
  return o.tweak ? { ...packed, ...o.tweak(packed) } : packed;
}

/** What a weapon instance needs for `packWeaponState` (the server's WeaponState fits). */
export interface PackableState {
  def: EffectiveWeapon;
  camo: string;
  mag: number;
  reserve: number;
  pap?: boolean;
  /** The camo it wore before it was packed (given back when it reverts). */
  papCamo?: string;
}

/**
 * Pack a weapon instance in place: packed def, Pack-a-Punch camo, a full magazine and reserve.
 * Returns false (and changes nothing) if it is already packed or can't be.
 */
export function packWeaponState(w: PackableState): boolean {
  if (w.pap || !isPackable(w.def.base.id)) return false;
  w.def = packDef(w.def);
  w.papCamo = w.camo;
  w.camo = PAP_CAMO;
  w.pap = true;
  w.mag = w.def.magazine;
  w.reserve = w.def.reserve;
  return true;
}

/** Fill a packed weapon to its packed magazine and reserve. */
export function refillPacked(w: PackableState): void {
  if (!w.pap) return;
  w.mag = w.def.magazine;
  w.reserve = w.def.reserve;
}

/** The plain def of a (packed) weapon: its base with its attachments, nothing packed. */
export const unpackedDef = (def: EffectiveWeapon): EffectiveWeapon => effectiveWeapon(def.base, def.attachmentIds);

/**
 * Revert a packed weapon in place: its own def and camo back, ammo clamped to the normal magazine
 * and reserve. Returns false if it wasn't packed.
 */
export function unpackWeaponState(w: PackableState): boolean {
  if (!w.pap) return false;
  w.def = unpackedDef(w.def);
  w.camo = w.papCamo ?? 'none';
  w.mag = Math.min(w.mag, w.def.magazine);
  w.reserve = Math.min(w.reserve, w.def.reserve);
  delete w.pap;
  delete w.papCamo;
  return true;
}

/** Viewmodel dip (0 = in hand, 1 = fully out of view) `t` seconds into the upgrade. */
export function papDip(t: number): number {
  const P = PACK_A_PUNCH;
  if (t <= 0 || t >= P.durationSec) return 0;
  const ease = (k: number) => k * k * (3 - 2 * k);
  if (t < P.dipSec) return ease(t / P.dipSec);
  const up = P.durationSec - P.raiseSec;
  if (t > up) return ease(1 - (t - up) / P.raiseSec);
  return 1;
}
