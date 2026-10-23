/**
 * Mystery Box killstreak (owner: perks-streaks): BO1 Zombies' box as a drop that always holds a
 * wonder weapon (defs/wonder.ts). Shared timeline and maths for the server (streaks/mysterybox.ts)
 * and the client (killstreaks/mysterybox.ts).
 *
 * Reference (T5 script dump `ZM/Common/maps/_zombiemode_weapons.gsc`, Call of Duty Wiki "Mystery
 * Box"): a narrow wooden chest with two glowing "?" on the lid and a beam of light into the sky;
 * the lid rolls open 105 degrees in 0.5 s (`treasure_chest_lid_open`) while the box's music plays;
 * weapons cycle 40 times above it, waiting 0.05 s (x20), 0.1 s (x10), 0.2 s (x5), 0.3 s (x3) between
 * them, then the result floats and sinks back into the box over 12 s unless taken
 * (`timer_til_despawn`); a teddy bear sends the box flying up into the sky. Ours: the same cycle a
 * fifth quicker (~3.1 s), 10 s to take the weapon, and never a bear: the streak always pays out.
 *
 * Calling it: the Care Package marker (STREAK raises the canister, FIRE throws it); where it
 * settles a beam of light shoots up, the sky flickers, lightning strikes the spot and the box rides
 * the beam down and crashes in with a burst of light and sparks (crushing anyone under it). The
 * owner holds USE at the box to open it, then USE again takes the weapon into the hand they hold
 * (their old gun drops, like a weapon pickup). Enemies see the beam and the box but can't open it
 * or take its weapon. After a take, or a timeout, the box flies up the beam and is gone.
 */
import { WONDER_WEAPON_IDS, type WonderWeaponId } from './wonder';

export const MYSTERY_BOX_ID = 'mystery_box';
/** Entity kind of the box (`s`: see `BoxSnap`). The thrown canister is a `ks_marker` with `s.mb` = 1. */
export const MYSTERY_BOX_ENTITY = 'ks_mbox';

/** Phases (`s.ph`): falling from the sky, waiting to be opened, cycling, offering, flying away. */
export const BOX_PHASE = { call: 0, idle: 1, open: 2, offer: 3, leave: 4 } as const;
export type BoxPhase = (typeof BOX_PHASE)[keyof typeof BOX_PHASE];

export const MYSTERY_BOX = {
  /** Call-in, seconds after the canister settles: beam up, sky flicker, lightning, descent. */
  beamSec: 0.45,
  flickerAt: 0.35,
  flickerSec: 1.0,
  strikeAt: 1.35,
  descendAt: 1.55,
  descendSec: 2.4,
  /** Height the box starts its descent from (m above its landing spot). */
  dropHeight: 26,
  /** Reach to open / take (horizontal and height difference, m) and the hold to open (s). */
  reach: 1.9,
  dy: 1.8,
  openHoldSec: 0.35,
  /** Lid open (BO1: 105 degrees in 0.5 s). */
  lidSec: 0.5,
  lidAngle: (105 * Math.PI) / 180,
  /** Seconds the weapon is offered before it sinks back in (BO1: 12). */
  offerSec: 10,
  /** Height the weapon floats at above the box's base (m), and how far it sinks over the offer. */
  floatY: 1.05,
  sinkY: 0.55,
  /** After a take or a timeout: lid shuts, then the box flies up the beam. */
  closeSec: 0.45,
  leaveSec: 2.2,
  /** A box nobody opens flies away after this long (s). */
  idleSec: 60,
  /** Landing crushes players within this radius (m) and height. */
  crushR: 1.1,
  /** Box size (m): BO1's chest is long and narrow. */
  size: { w: 1.25, h: 0.55, d: 0.6 },
} as const;

/** BO1's waits between the 40 weapon changes, a fifth quicker. The last change shows the result. */
export const BOX_CYCLE_WAITS: readonly number[] = [...Array(20).fill(0.04), ...Array(10).fill(0.08), ...Array(5).fill(0.16), ...Array(3).fill(0.24)].map((w) => Math.round(w * 1000) / 1000);
/** Seconds from the lid starting to open to the result showing. */
export const BOX_CYCLE_SEC = MYSTERY_BOX.lidSec * 0.4 + BOX_CYCLE_WAITS.reduce((s, w) => s + w, 0);

/** Which weapon change is showing `t` seconds after the lid started opening (0..38; 38 = the result). */
export function cycleStepAt(t: number): number {
  let acc = MYSTERY_BOX.lidSec * 0.4;
  if (t < acc) return 0;
  for (let i = 0; i < BOX_CYCLE_WAITS.length; i++) {
    acc += BOX_CYCLE_WAITS[i]!;
    if (t < acc) return i + 1;
  }
  return BOX_CYCLE_WAITS.length;
}

/** Room time of each weapon change (ticks), from the lid opening at `openAt`. */
export function cycleTimes(openAt: number): number[] {
  const out: number[] = [];
  let acc = openAt + MYSTERY_BOX.lidSec * 0.4;
  for (const w of BOX_CYCLE_WAITS) {
    acc += w;
    out.push(acc);
  }
  return out;
}

/** Models that flash past during the cycle: the seven wonder weapons and a handful of ordinary guns. */
export const BOX_CYCLE_MODELS = ['raygun', 'ak47', 'thundergun', 'olympia', 'wunderwaffe', 'python', 'wintershowl', 'spas12', 'scavenger', 'rpk', 'babygun', 'l96a1', 'wavegun', 'mpl', 'galil'] as const;

/** Tiny deterministic generator so the client's cycle matches between viewers. */
export function seeded(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** The model shown at cycle step `i` (the last step shows `result`). */
export function cycleModel(seed: number, i: number, result: string): string {
  if (i >= BOX_CYCLE_WAITS.length) return result;
  const r = seeded(seed + i * 7919);
  r();
  return BOX_CYCLE_MODELS[Math.floor(r() * BOX_CYCLE_MODELS.length) % BOX_CYCLE_MODELS.length]!;
}

/** Roll the box: a wonder weapon the taker doesn't already carry (always one: they carry at most two). */
export function rollWonder(carried: readonly string[], rand: () => number = Math.random): WonderWeaponId {
  const pool = WONDER_WEAPON_IDS.filter((id) => !carried.includes(id));
  const list = pool.length ? pool : [...WONDER_WEAPON_IDS];
  return list[Math.floor(rand() * list.length) % list.length]!;
}

/**
 * Entity `s` of the box. Times are room times (the client animates from `serverTime`): `t0` the
 * call-in started (beam), `tl` it lands, `to` the lid opened, `tw` the result shows, `te` the offer
 * ends, `tx` it starts leaving. `w` the rolled weapon (set at opening), `sd` the cycle seed, `o` the
 * owner id, `tk` 1 once the weapon was taken.
 */
export interface BoxSnap {
  ph: BoxPhase;
  t0: number;
  tl: number;
  to?: number;
  tw?: number;
  te?: number;
  tx?: number;
  w?: string;
  sd: number;
  o: string;
  tk?: number;
}

/** Height of the box above its landing spot at room time `now` (descending on the beam, flying away). */
export function boxHeight(s: Pick<BoxSnap, 't0' | 'tl' | 'tx'>, now: number): number {
  const B = MYSTERY_BOX;
  if (s.tx !== undefined && now >= s.tx + B.closeSec) {
    const k = Math.min(1, (now - s.tx - B.closeSec) / B.leaveSec);
    return B.dropHeight * 1.4 * k * k;
  }
  const start = s.t0 + B.descendAt;
  if (now < start) return B.dropHeight;
  if (now >= s.tl) return 0;
  const k = (now - start) / Math.max(0.01, s.tl - start);
  // Eases in, then drops the last stretch fast: it crashes in.
  return B.dropHeight * (1 - (k < 0.75 ? 0.6 * (k / 0.75) : 0.6 + 0.4 * ((k - 0.75) / 0.25) ** 2));
}
