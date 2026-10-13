/**
 * What the HUD says about the gun in your hands (pure, so it can be tested without a canvas).
 *
 * BO1 rules: "RELOAD" only when a reload can actually happen (there is reserve to load from and
 * the magazine isn't full). Mag and reserve both empty: "NO AMMO". A low mag with nothing in
 * reserve is shown as "LOW AMMO" (no key prompt, no flashing), except on single-load weapons
 * (crossbow, ballistic knife, Olympia), where one round in the chamber is simply full.
 */

export type AmmoHint = 'reloading' | 'reload' | 'low' | 'no-ammo' | null;

export interface AmmoState {
  magazine: number;
  mag: number;
  reserve: number;
  reloading: boolean;
}

/** The mag is low enough that BO1 would prompt (a quarter of the magazine or less). */
export const lowMag = (magazine: number, mag: number): boolean => mag <= Math.ceil(magazine * 0.25);

/** A reload would load something (the server's `startReload` refuses otherwise). */
export const canReload = (a: Pick<AmmoState, 'magazine' | 'mag' | 'reserve'>): boolean => a.reserve > 0 && a.mag < a.magazine;

export function ammoHint(a: AmmoState): AmmoHint {
  if (a.reloading) return 'reloading';
  if (a.mag <= 0 && a.reserve <= 0) return 'no-ammo';
  if (!lowMag(a.magazine, a.mag)) return null;
  if (canReload(a)) return 'reload';
  return a.magazine > 2 && a.mag > 0 ? 'low' : null;
}

/** The big mag number turns to the warning colour only when there's something to do about it. */
export const ammoWarn = (a: AmmoState): boolean => {
  const h = ammoHint(a);
  return h === 'reload' || h === 'no-ammo' || h === 'low';
};
