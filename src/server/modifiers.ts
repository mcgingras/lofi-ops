/**
 * Per-room, per-player modifier registry that core consults (perks, killstreaks, wager rules...).
 *
 *   const off = room.modifiers.add('speedMultiplier', (p) => (hasPerk(p, 'lightweight') ? 1.07 : 1), 'perks.lightweight');
 *
 * Combination rules by key:
 *   - `...Multiplier`, `damageTaken`, `damageDealt`: product of all results (undefined counts as 1)
 *   - `...Offset`: sum (undefined counts as 0)
 *   - boolean keys (`radarVisible`, `radarJammed`): any `false` wins, else any `true`, else undefined
 *
 * Add new keys from a feature by declaration merging:
 *   declare module '../../modifiers' { interface ModifierMap { myMultiplier: (p: PlayerState) => number | undefined } }
 */
import type { DamageInfo } from '../shared/events';
import type { PlayerState } from './player';

export interface ModifierMap {
  /** Movement speed (Lightweight). */
  speedMultiplier: (p: PlayerState) => number | undefined;
  /** Sprint speed on top of speedMultiplier. */
  sprintMultiplier: (p: PlayerState) => number | undefined;
  /** Damage this victim takes (Flak Jacket, hardcore...). */
  damageTaken: (victim: PlayerState, info: DamageInfo<PlayerState>) => number | undefined;
  /** Damage this attacker deals (Stopping Power, Hardened...). */
  damageDealt: (attacker: PlayerState, info: DamageInfo<PlayerState>) => number | undefined;
  /** Reload time (Sleight of Hand: 0.5). */
  reloadMultiplier: (p: PlayerState) => number | undefined;
  /** Time to ADS. */
  adsMultiplier: (p: PlayerState) => number | undefined;
  /** Weapon switch time. */
  swapMultiplier: (p: PlayerState) => number | undefined;
  /** Sprint-out delay before firing (Steady Aim Pro). */
  sprintOutMultiplier: (p: PlayerState) => number | undefined;
  /** Bullet spread (Steady Aim: hip fire 0.65). */
  spreadMultiplier: (p: PlayerState) => number | undefined;
  /** Delay before health regen starts. */
  regenDelayMultiplier: (p: PlayerState) => number | undefined;
  /** Max health (hardcore 0.3). Applied at spawn. */
  maxHealthMultiplier: (p: PlayerState) => number | undefined;
  /** Kills needed for killstreaks (Hardline: -1). */
  streakCostOffset: (p: PlayerState) => number | undefined;
  /**
   * Is `target` on `viewer`'s minimap? true = show (UAV), false = hide (Ghost vs UAV), undefined =
   * no opinion. If every handler is undefined, core shows targets that fired an unsuppressed
   * weapon in the last 1.5 s.
   */
  radarVisible: (target: PlayerState, viewer: PlayerState) => boolean | undefined;
  /** Is `viewer`'s minimap jammed (Counter-Spy Plane)? */
  radarJammed: (viewer: PlayerState) => boolean | undefined;
}

export type ModifierKey = keyof ModifierMap;
type Fn = (...args: never[]) => unknown;

interface Entry {
  id: string;
  fn: Fn;
  owner: unknown;
}

let anon = 0;

export class ModifierRegistry {
  private map = new Map<string, Entry[]>();
  private owner: unknown = null;

  /** Register a modifier. Returns a remover. Re-adding the same `id` for a key replaces it. */
  add<K extends ModifierKey>(key: K, fn: ModifierMap[K], id = `anon${++anon}`): () => void {
    const list = (this.map.get(key) ?? []).filter((e) => e.id !== id);
    const entry: Entry = { id, fn: fn as unknown as Fn, owner: this.owner };
    list.push(entry);
    this.map.set(key, list);
    return () => this.remove(key, id);
  }

  remove(key: ModifierKey, id: string): void {
    const list = this.map.get(key);
    if (list)
      this.map.set(
        key,
        list.filter((e) => e.id !== id),
      );
  }

  private results<K extends ModifierKey>(key: K, args: Parameters<ModifierMap[K]>): unknown[] {
    const list = this.map.get(key);
    if (!list || list.length === 0) return [];
    const out: unknown[] = [];
    for (const e of list) {
      try {
        out.push((e.fn as (...a: unknown[]) => unknown)(...(args as unknown[])));
      } catch (err) {
        console.error(`[modifiers] ${key}/${e.id} failed`, err);
      }
    }
    return out;
  }

  /** Product of numeric results (1 if none). */
  mul<K extends ModifierKey>(key: K, ...args: Parameters<ModifierMap[K]>): number {
    let v = 1;
    for (const r of this.results(key, args)) if (typeof r === 'number' && Number.isFinite(r)) v *= r;
    return v;
  }

  /** Sum of numeric results (0 if none). */
  sum<K extends ModifierKey>(key: K, ...args: Parameters<ModifierMap[K]>): number {
    let v = 0;
    for (const r of this.results(key, args)) if (typeof r === 'number' && Number.isFinite(r)) v += r;
    return v;
  }

  /** Boolean vote: false if any false, true if any true, otherwise undefined. */
  any<K extends ModifierKey>(key: K, ...args: Parameters<ModifierMap[K]>): boolean | undefined {
    let v: boolean | undefined;
    for (const r of this.results(key, args)) {
      if (r === false) return false;
      if (r === true) v = true;
    }
    return v;
  }

  /** Modifiers added while `fn` runs are tagged with `owner` (removable with `offOwner`). */
  withOwner<T>(owner: unknown, fn: () => T): T {
    const prev = this.owner;
    this.owner = owner;
    try {
      return fn();
    } finally {
      this.owner = prev;
    }
  }

  offOwner(owner: unknown): void {
    for (const [k, list] of this.map)
      this.map.set(
        k,
        list.filter((e) => e.owner !== owner),
      );
  }

  clear(): void {
    this.map.clear();
  }
}
