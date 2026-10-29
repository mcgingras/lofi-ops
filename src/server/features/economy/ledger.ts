/**
 * The CoD Points ledger: every change to `profile.codPoints` made by the economy goes through
 * here so `profile.ext.economy` keeps totals, a short history and the wager escrow.
 */
import { WAGER_HISTORY } from '../../../shared/defs/economy';
import type { EconomyState, EconomyTxn, WagerRecord } from '../../../shared/defs/economy-net';
import { DEFAULT_EMBLEM_BACKGROUND, DEFAULT_RETICLE } from '../../../shared/defs/store';
import { bumpStat, type Profile } from '../../../shared/profile';
import type { EconomyExt } from './types';

const HISTORY = 30;

/** The profile's economy state (created with defaults on first use). */
export function econ(profile: Profile): EconomyExt {
  const cur = profile.ext.economy as Partial<EconomyExt> | undefined;
  const e: EconomyExt = {
    earned: num(cur?.earned),
    spent: num(cur?.spent),
    wagerWon: num(cur?.wagerWon),
    wagerLost: num(cur?.wagerLost),
    escrow: cur?.escrow && typeof cur.escrow === 'object' ? cur.escrow : null,
    history: Array.isArray(cur?.history) ? cur.history : [],
    equipped: {
      reticle: typeof cur?.equipped?.reticle === 'string' ? cur.equipped.reticle : DEFAULT_RETICLE,
      emblem: typeof cur?.equipped?.emblem === 'string' ? cur.equipped.emblem : DEFAULT_EMBLEM_BACKGROUND,
    },
    lastMatch: cur?.lastMatch ?? null,
    wagerHistory: Array.isArray(cur?.wagerHistory) ? cur.wagerHistory : [],
  };
  // Normalise in place (keeps the object identity other references hold).
  profile.ext.economy = Object.assign(cur ?? {}, e);
  return profile.ext.economy as EconomyExt;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function log(e: EconomyExt, kind: EconomyTxn['kind'], cp: number, label: string) {
  e.history.unshift({ at: Date.now(), cp, kind, label });
  if (e.history.length > HISTORY) e.history.length = HISTORY;
}

/** Add CP (earned, refunded or paid out). Non-positive amounts are ignored. */
export function credit(profile: Profile, cp: number, kind: EconomyTxn['kind'], label: string): number {
  const n = Math.floor(cp);
  if (!(n > 0)) return 0;
  const e = econ(profile);
  profile.codPoints += n;
  if (kind === 'match' || kind === 'challenge' || kind === 'grant') {
    e.earned += n;
    bumpStat(profile, 'codPointsEarned', n);
  }
  log(e, kind, n, label);
  return n;
}

/** Take CP (purchase, ante). Returns false (and changes nothing) when the balance is short. */
export function debit(profile: Profile, cp: number, kind: EconomyTxn['kind'], label: string): boolean {
  const n = Math.floor(cp);
  if (!(n >= 0)) return false;
  if (profile.codPoints < n) return false;
  const e = econ(profile);
  profile.codPoints -= n;
  if (kind === 'purchase') {
    e.spent += n;
    bumpStat(profile, 'codPointsSpent', n);
  }
  if (n > 0) log(e, kind, -n, label);
  return true;
}

/** Record a purchase that `purchase()` (shared rules) already applied to the balance. */
export function recordPurchase(profile: Profile, cp: number, label: string) {
  const e = econ(profile);
  e.spent += cp;
  bumpStat(profile, 'codPointsSpent', cp);
  if (cp > 0) log(e, 'purchase', -cp, label);
}

/** Add a settled wager to the profile's record (newest first). */
export function recordWager(profile: Profile, rec: WagerRecord): void {
  const e = econ(profile);
  e.wagerHistory.unshift(rec);
  if (e.wagerHistory.length > WAGER_HISTORY) e.wagerHistory.length = WAGER_HISTORY;
}

export function stateOf(profile: Profile): EconomyState {
  const e = econ(profile);
  return {
    codPoints: profile.codPoints,
    owned: [...profile.owned],
    equipped: { ...e.equipped },
    earned: e.earned,
    spent: e.spent,
    wagerWon: e.wagerWon,
    wagerLost: e.wagerLost,
    escrow: e.escrow ? { ...e.escrow } : null,
    history: e.history.slice(0, HISTORY),
    lastMatch: e.lastMatch,
    wagerHistory: e.wagerHistory.slice(0, WAGER_HISTORY),
  };
}
