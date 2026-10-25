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
import './pap-effects';
import type { PapEffect, PapEffectKind, PapEffectOf } from './pap-effects';
import { WEAPON_BY_ID, type WeaponDef } from './weapons';

export type { PapEffect, PapEffectKind } from './pap-effects';

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
export type PapExplosive = Omit<PapEffectOf<'explosive'>, 'kind'>;

/**
 * Per-weapon Pack-a-Punch: the upgraded name, its signature `effect` (defs/pap-effects.ts) with a
 * one-line `effectText` for menus and the toast, and anything that differs from `PACK_A_PUNCH`.
 * `tweak` is a hook for changes the numbers can't express (it gets the packed def and returns
 * overrides; the stat-only effects, laser / akimbo / flechette / double-tap, live there so the
 * client's prediction follows them).
 */
export interface PapOverride {
  name?: string;
  effect?: PapEffect;
  effectText?: string;
  damage?: number;
  mag?: number;
  reserve?: number;
  reload?: number;
  /** Cycle-rate multiplier (default: `slowRpmMult` for slow guns, else 1). */
  rpm?: number;
  tweak?: (packed: EffectiveWeapon) => Partial<WeaponDef>;
}

/**
 * Upgraded names: BO1's where the gun was in BO1 Zombies (from memory of the Pack-a-Punch list),
 * invented in the same spirit for the rest (the MW2 guns, the AK-47, the ASP). Effects: one each,
 * varied on purpose (see defs/pap-effects.ts for what each kind does).
 */
export const PAP_WEAPONS: Record<string, PapOverride> = {
  // Assault rifles
  m16: { name: 'Skullpiercer', effect: { kind: 'pierce', bodies: 1, keep: 0.8 }, effectText: 'piercing rounds', tweak: () => ({ penetration: 'large' }) },
  famas: { name: 'G16-GL35', effect: { kind: 'launcher', weapon: 'gl', rounds: 3 }, effectText: 'underbarrel grenade launcher' },
  ak47: { name: "Reznov's Revenge", effect: { kind: 'burn', damage: 15, sec: 2 }, effectText: 'incendiary rounds' },
  commando: { name: 'Predator', effect: { kind: 'mark', sec: 5 }, effectText: 'marks targets through walls' },
  galil: { name: 'Lamentation', effect: { kind: 'ricochet', keep: 0.5, range: 40 }, effectText: 'ricochet rounds' },
  aug: { name: 'AUG-50M3', effect: { kind: 'launcher', weapon: 'masterkey', rounds: 4 }, effectText: 'underbarrel shotgun' },
  acr: { name: 'ACR Annihilator', effect: { kind: 'stagger', kickDeg: 2.6, botFlinch: 3.5, botAimDeg: 3, sec: 0.6 }, effectText: 'staggering rounds' },
  m16a4: { name: 'Skullsplitter', effect: { kind: 'headblast', radius: 3, max: 50, min: 15 }, effectText: 'exploding headshots' },
  // SMGs
  mp5k: { name: 'MP115 Kollider', effect: { kind: 'zap', chance: 0.25, damage: 15, range: 4 }, effectText: 'chain zap' },
  ak74u: {
    name: 'AK74fu2',
    effect: { kind: 'laser' },
    effectText: 'laser: no hipfire spread, no recoil',
    tweak: (d) => ({ spread: { hip: d.spread.ads, ads: d.spread.ads, move: 0 }, recoil: { vertical: 0, horizontal: 0, recovery: d.recoil.recovery } }),
  },
  mpl: {
    name: 'MPL-LF',
    effect: { kind: 'akimbo' },
    effectText: 'dual wield',
    damage: 1.25,
    mag: 2,
    rpm: 1.6,
    tweak: (d) => ({ spread: { hip: d.spread.hip * 1.2, ads: d.spread.hip * 1.2, move: d.spread.move } }),
  },
  // Iconic SMGs: BO1's names for the Spectre (Phantom) and the Uzi (Uncle Gal), invented ones for
  // the CoD4 / MW2 guns. Effect kinds no other SMG uses, none past two guns: the two new kinds
  // (vampire, adrenaline) and the ones only one gun had (frost, venom, flechette, collateral).
  mp5: { name: 'Sub-Zero', effect: { kind: 'frost', frozenSec: 0.8, chance: 0.25 }, effectText: 'cryo rounds: a hit can freeze' },
  ump45: { name: 'Black Widow', effect: { kind: 'venom', perHit: 7, sec: 2.5, maxStacks: 3 }, effectText: 'venom: heavy poison that stacks' },
  vector: { name: 'Nosferatu', effect: { kind: 'vampire', heal: 5 }, effectText: 'vampire rounds: every hit heals you' },
  p90: {
    name: 'Porcupine',
    effect: { kind: 'flechette' },
    effectText: 'flechettes: tighter spread, twice the reach',
    // Darts that keep their punch: the falloff starts and ends twice as far out.
    tweak: (d) => ({ spread: { hip: d.spread.hip * 0.7, ads: d.spread.ads * 0.6, move: d.spread.move * 0.7 }, damage: { ...d.damage, nearRange: d.damage.nearRange * 2, farRange: d.damage.farRange * 2 } }),
  },
  spectre: { name: 'Phantom', effect: { kind: 'collateral' }, effectText: 'phantom rounds: through every body' },
  uzi: { name: 'Uncle Gal', effect: { kind: 'adrenaline', speed: 1.15, sec: 3 }, effectText: 'adrenaline: kills refill the mag and speed you up' },
  // LMG
  rpk: { name: 'R115 Resonator', effect: { kind: 'shockwave', radius: 3, push: 6, slow: 0.6, sec: 1.5 }, effectText: 'kills release a shockwave' },
  // Early-CoD LMGs: BO1's names where the gun was packable in BO1 Zombies (HK21, plus the
  // Mutilator and Deathbringer as asked), invented ones for the CoD4 / MW2 guns.
  m60: { name: 'Mutilator', effect: { kind: 'stagger', kickDeg: 3.4, botFlinch: 4.5, botAimDeg: 4, sec: 0.8 }, effectText: 'suppressing fire: heavy stagger' },
  stoner63: { name: 'Stoner63 Deathbringer', effect: { kind: 'mark', sec: 5 }, effectText: 'marks targets through walls' },
  hk21: { name: 'H115 Oscillator', effect: { kind: 'zap', chance: 0.2, damage: 15, range: 5 }, effectText: 'chain zap' },
  rpd: { name: 'R.I.P.D.', effect: { kind: 'pierce', bodies: 2, keep: 0.75 }, effectText: 'piercing rounds: through two bodies' },
  m249: { name: 'Scorched Earth Weapon', effect: { kind: 'burn', damage: 12, sec: 2.5 }, effectText: 'incendiary rounds' },
  mg4: { name: 'Thunderclap', effect: { kind: 'shockwave', radius: 4, push: 5, slow: 0.5, sec: 2 }, effectText: 'kills release a wide shockwave' },
  // Snipers
  l96a1: { name: 'Iceburg', effect: { kind: 'frost', frozenSec: 1 }, effectText: 'frost rounds' },
  dragunov: { name: 'D115 Disassembler', effect: { kind: 'shatter', mult: 1.25, sec: 4 }, effectText: 'shatter rounds: +25% damage taken' },
  intervention: { name: 'Divine Intervention', effect: { kind: 'collateral' }, effectText: 'collateral: through every body' },
  // Shotguns
  olympia: { name: 'Hades', mag: 1, effect: { kind: 'burn', damage: 15, sec: 2 }, effectText: "dragon's breath" },
  stakeout: {
    name: 'Raid',
    effect: { kind: 'flechette' },
    effectText: 'flechettes: tight spread, long reach',
    tweak: (d) => ({
      spread: { hip: d.spread.hip * 0.4, ads: d.spread.ads * 0.38, move: d.spread.move * 0.6 },
      damage: { ...d.damage, nearRange: d.damage.nearRange * 2.2, farRange: d.damage.farRange * 2.2 },
      range: (d.range ?? 40) * 1.75,
    }),
  },
  spas12: { name: 'SPAZ-24', effect: { kind: 'knockback', range: 8, push: 8, up: 2.5, sec: 0.35 }, effectText: 'knockback' },
  // Pistols: BO1's Mustang & Sally fire small grenades, the Cobra explosive tips. Both modest here.
  m1911: { name: 'Mustang & Sally', damage: 1.25, effect: { kind: 'explosive', radius: 3, max: 30, min: 10 }, effectText: 'explosive rounds' },
  python: { name: 'Cobra', damage: 1.4, mag: 2, effect: { kind: 'explosive', radius: 2.5, max: 18, min: 6 }, effectText: 'explosive tips' },
  asp: {
    name: 'Basilisk',
    effect: { kind: 'doubletap' },
    effectText: 'double-tap',
    // Two rounds per pull, fast; the magazine keeps whole pairs.
    tweak: (d) => ({ mode: 'burst', burst: 2, burstDelayMs: 140, rpm: Math.max(d.rpm, 1100), magazine: d.magazine + (d.magazine % 2) }),
  },
  // Early-CoD pistols (invented names). The Desert Hawk's damage stays at x1.35 so a packed
  // headshot (94.5) is still not a one-shot.
  deagle: { name: 'Desert Hawk', damage: 1.35, effect: { kind: 'knockback', range: 14, push: 7, up: 2, sec: 0.3 }, effectText: 'knockback rounds' },
  makarov: {
    name: 'Dvoynik',
    effect: { kind: 'doubletap' },
    effectText: 'double-tap',
    tweak: (d) => ({ mode: 'burst', burst: 2, burstDelayMs: 150, rpm: Math.max(d.rpm, 1100), magazine: d.magazine + (d.magazine % 2) }),
  },
  usp: { name: 'Peacekeeper .45', effect: { kind: 'shatter', mult: 1.2, sec: 3 }, effectText: 'sundering rounds: +20% damage taken' },
  // Machine pistols: one distinct effect each (kinds no more than two other guns share). The CZ75
  // keeps BO1's packed name; the rest are new. The G18 goes akimbo like the MPL-LF (MW2's famous
  // pair) without the faster cycle: it already fires fastest.
  g18: {
    name: 'G115 Generator',
    effect: { kind: 'akimbo' },
    effectText: 'dual wield',
    damage: 1.25,
    mag: 2,
    tweak: (d) => ({ spread: { hip: d.spread.hip * 1.2, ads: d.spread.hip * 1.2, move: d.spread.move } }),
  },
  skorpion: { name: 'Scorpion Venom', effect: { kind: 'venom', perHit: 4, sec: 3, maxStacks: 5 }, effectText: 'venom: every hit adds poison' },
  cz75auto: { name: 'Calamity Jane', effect: { kind: 'ricochet', keep: 0.6, range: 30 }, effectText: 'ricochet rounds' },
  tmp: {
    name: 'Tempest',
    effect: { kind: 'laser' },
    effectText: 'laser: hipfire as tight as aimed, no recoil',
    tweak: (d) => ({ spread: { hip: d.spread.ads, ads: d.spread.ads, move: 0 }, recoil: { ...d.recoil, vertical: 0, horizontal: 0, drift: 0 } }),
  },
  mp9: { name: 'Nightstalker', effect: { kind: 'headblast', radius: 2.5, max: 35, min: 10 }, effectText: 'exploding headshots' },
  // Wonder weapons (BO1's upgraded magazines: X2 40, Zeus Cannon 4, DG-3 JZ 6).
  raygun: { name: "Porter's X2 Ray Gun", mag: 2, reserve: 3, effect: { kind: 'wonder', red: true }, effectText: 'red bolts' },
  thundergun: { name: 'Zeus Cannon', mag: 2, reserve: 2, effect: { kind: 'wonder', radiusMult: 1.5 }, effectText: 'a wider blast' },
  wunderwaffe: { name: 'Wunderwaffe DG-3 JZ', mag: 2, reserve: 2, effect: { kind: 'wonder', hops: 4 }, effectText: '4 arcs' },
  wintershowl: { name: "Winter's Fury", effect: { kind: 'wonder', freezeAll: true }, effectText: 'one blast freezes solid' },
  scavenger: { name: 'Hyena Infra-Dead', effect: { kind: 'wonder', radiusMult: 1.4 }, effectText: 'a bigger blast' },
  babygun: { name: 'Fractalizer', effect: { kind: 'wonder', shrinkR: 3 }, effectText: 'shrinks everyone near the hit' },
  wavegun: { name: 'Max Wave Gun', effect: { kind: 'wonder', arcs: 3 }, effectText: 'zaps arc to 3' },
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

/** The signature effect of a packed weapon (null for a weapon without a row). */
export const papEffect = (id: string): PapEffect | null => PAP_WEAPONS[id]?.effect ?? null;

/** A packed weapon's effect if it is of kind `kind`. */
export function papEffectOf<K extends PapEffectKind>(id: string, kind: K): PapEffectOf<K> | null {
  const e = PAP_WEAPONS[id]?.effect;
  return e && e.kind === kind ? (e as PapEffectOf<K>) : null;
}

/** The menu / toast one-liner of a packed weapon's effect ('' when none). */
export const papEffectText = (id: string): string => PAP_WEAPONS[id]?.effectText ?? '';

/** The toast line: "Reznov's Revenge: incendiary rounds" (just the name without an effect). */
export function papToastLine(id: string): string {
  const t = papEffectText(id);
  return t ? `${papName(id)}: ${t}` : papName(id);
}

/** Explosive rounds of a packed weapon, if it has them (the `explosive` effect). */
export function papExplosive(id: string): PapExplosive | null {
  const e = papEffectOf(id, 'explosive');
  return e ? { radius: e.radius, max: e.max, min: e.min } : null;
}

/** The wonder weapon touches of a packed wonder weapon (`{}` when it has none). */
export const papWonder = (id: string): Omit<PapEffectOf<'wonder'>, 'kind'> => papEffectOf(id, 'wonder') ?? {};

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
