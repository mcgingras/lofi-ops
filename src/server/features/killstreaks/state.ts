/** Per-player killstreak ladder: counting kills, earning (Hardline-aware), the ready list, pushes. */
import { KILLSTREAK_BY_ID, isStreakWeapon, streakAllowedIn, streakCost } from '../../../shared/defs/killstreaks';
import type { KillstreakStateMsg } from '../../../shared/defs/perks-streaks-protocol';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import type { KillstreakExt } from './events';

export const ksOf = (p: PlayerState): KillstreakExt => (p.ext.killstreaks ??= { count: 0, countAll: 0, earnedLife: [], ready: [], selected: 0, armed: null, map: null, control: null, marker: null, launcher: null });

/** The player's three picks (from the loadout in use; next loadout if not spawned yet). */
export const chosenStreaks = (p: PlayerState): string[] => (p.loadout ?? p.nextLoadout)?.killstreaks.filter((id) => KILLSTREAK_BY_ID.has(id)).slice(0, 3) ?? [];

/** Kills `p` needs for `id` right now (Hardline via the `streakCostOffset` modifier). Infinity when it can't be had here (the nuke in a wager). */
export function costFor(room: Room, p: PlayerState, id: string): number {
  const def = KILLSTREAK_BY_ID.get(id);
  if (!def || !streakAllowedIn(def, room.mode)) return Infinity;
  return streakCost(def, room.modifiers.sum('streakCostOffset', p));
}

/** The kills this life that count toward `id`: streak kills too for streaks that say so (the Tactical Nuke). */
export function killsToward(ks: KillstreakExt, id: string): number {
  return KILLSTREAK_BY_ID.get(id)?.countsStreakKills ? (ks.countAll ?? ks.count) : ks.count;
}

const dirty = new WeakMap<Room, Set<PlayerState>>();
export function markDirty(room: Room, p: PlayerState): void {
  let s = dirty.get(room);
  if (!s) dirty.set(room, (s = new Set()));
  s.add(p);
}

export function stateMsg(room: Room, p: PlayerState): KillstreakStateMsg {
  const ks = ksOf(p);
  const chosen = chosenStreaks(p)
    .map((id) => ({ id, cost: costFor(room, p, id) }))
    .filter((c) => Number.isFinite(c.cost))
    .sort((a, b) => a.cost - b.cost);
  ks.selected = Math.max(0, Math.min(ks.selected, ks.ready.length - 1));
  return {
    chosen,
    count: ks.count,
    countAll: ks.countAll ?? ks.count,
    ready: [...ks.ready],
    selected: ks.selected,
    armed: ks.armed ? { id: ks.armed.id, marks: ks.armed.marks.map((m) => [m.x, m.y, m.z] as [number, number, number]), need: ks.armed.need, until: ks.armed.until } : null,
    map: ks.map ? { id: ks.map.id, until: ks.map.until } : null,
    marker: ks.marker ? { id: ks.marker.id } : null,
    launcher: ks.launcher ? { left: ks.launcher.left, ready: ks.launcher.ready, fired: ks.launcher.fired } : null,
    control: ks.control ? { ...ks.control, ...(ks.control.hold ? { hold: { ...ks.control.hold } } : {}) } : null,
  };
}

/** Send changed ladders (once per tick). */
export function flushState(room: Room): void {
  const s = dirty.get(room);
  if (!s || !s.size) return;
  for (const p of s) if (p.session && room.players.get(p.id) === p) room.sendFeature(p, 'killstreaks.state', stateMsg(room, p));
  s.clear();
}

/** Give a ready streak (earned, or from a Care Package). */
export function grant(room: Room, p: PlayerState, id: string): void {
  const ks = ksOf(p);
  ks.ready.push(id);
  ks.selected = ks.ready.length - 1;
  markDirty(room, p);
}

/**
 * A death: the killer's counts go up, the victim's reset. Kills by killstreaks only go into
 * `countAll` (BO1: they don't count toward streaks; streaks with `countsStreakKills` read
 * `countAll`). Returns newly earned ids.
 */
export function onKill(room: Room, attacker: PlayerState | null, victim: PlayerState, weapon: string): string[] {
  const vks = ksOf(victim);
  vks.count = 0;
  vks.countAll = 0;
  vks.earnedLife = [];
  markDirty(room, victim);
  if (!attacker || attacker === victim || !room.isEnemy(attacker, victim)) return [];
  const ks = ksOf(attacker);
  ks.countAll = (ks.countAll ?? ks.count) + 1;
  if (!isStreakWeapon(weapon)) ks.count += 1;
  markDirty(room, attacker);
  const earned: string[] = [];
  for (const id of chosenStreaks(attacker)) {
    if (ks.earnedLife.includes(id)) continue;
    if (killsToward(ks, id) >= costFor(room, attacker, id)) {
      ks.earnedLife.push(id);
      grant(room, attacker, id);
      earned.push(id);
    }
  }
  return earned;
}

export function resetPlayer(room: Room, p: PlayerState): void {
  const ks = ksOf(p);
  ks.count = 0;
  ks.countAll = 0;
  ks.earnedLife = [];
  ks.ready = [];
  ks.selected = 0;
  ks.armed = null;
  ks.marker = null;
  ks.launcher = null;
  if (ks.map) room.entities.remove(ks.map.entity);
  ks.map = null;
  ks.control = null;
  ks.botNextCall = undefined;
  markDirty(room, p);
}
