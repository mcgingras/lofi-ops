/**
 * Server-side room events (DESIGN.md section 6). Core emits these on each room's bus; features
 * and mode rules subscribe in their `room(room)` hook:
 *
 *   room.bus.on('death', (e) => { ... e.victim, e.attacker ... });
 *
 * Payloads are generic in the player type `P` so this file stays pure; the server instantiates it
 * with its `PlayerState` (src/server/bus.ts `ServerEvents`). Features add their own events by
 * declaration merging (keep the type parameter name `P`):
 *
 *   declare module '../../../shared/events' {
 *     interface RoomEvents<P> { 'killstreak.called': { player: P; id: string } }
 *   }
 *
 * Feature event names are namespaced `<area>.<name>`. Payloads marked "mutable" may be changed by
 * handlers before core acts on them (handlers run in priority order, high first).
 */
import type { HitPart } from './collision';
import type { Team } from './constants';
import type { Loadout } from './loadout';
import type { Vec3 } from './math';
import type { SpawnPoint } from './maps/types';

export type DamageMeans = 'bullet' | 'melee' | 'explosive' | 'fire' | 'fall' | 'world' | 'killstreak' | 'suicide' | (string & {});

export type MatchPhase = 'lobby' | 'countdown' | 'playing' | 'ended';

export interface DamageInfo<P> {
  victim: P;
  attacker: P | null;
  amount: number;
  /** Weapon or source id ('ak47', 'frag', 'uav', 'fall'...). */
  weapon: string;
  part: HitPart | null;
  means: DamageMeans;
  /** Where the damage came from (for hit direction indicators). */
  from: Vec3 | null;
  distance: number;
}

export interface DeathEvent<P> {
  victim: P;
  attacker: P | null;
  weapon: string;
  headshot: boolean;
  distance: number;
  /** Players (not the killer) who damaged the victim within HEALTH.assistWindow. */
  assisters: P[];
  part: HitPart | null;
  means: DamageMeans;
  /** Victim's kill streak before dying. */
  victimStreak: number;
  /** Attacker's kill streak after this kill (0 when no attacker / suicide / teamkill). */
  attackerStreak: number;
}

export interface PlayerResult {
  id: string;
  profileId: string | null;
  name: string;
  team: Team | null;
  bot: boolean;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  score: number;
  bestStreak: number;
  /** 1-based placement (FFA by score; team modes by score within the match). */
  place: number;
  won: boolean;
  /** Seconds this player was in the match. */
  timePlayed: number;
}

export interface MatchResults {
  roomId: string;
  mode: string;
  map: string;
  reason: 'score' | 'time' | 'forfeit' | 'rounds' | 'aborted' | (string & {});
  /** Winning team (team modes), null on draw / FFA. */
  winnerTeam: Team | null;
  /** Winning player ids (FFA: the top player; team modes: the winning team). Empty on draw. */
  winners: string[];
  teamScores: [number, number] | null;
  players: PlayerResult[];
  durationSec: number;
  /** Feature extras (xp breakdowns, wager payouts...), namespaced by feature id. */
  ext: Record<string, unknown>;
}

export interface RoomEvents<P> {
  playerJoin: { player: P };
  playerLeave: { player: P; reason: 'disconnect' | 'left' | 'kicked' | 'closed' | (string & {}) };
  /** Mutable: `loadout` may be replaced (unlock checks, wager-mode forced loadouts). */
  beforeSpawn: { player: P; loadout: Loadout; point: SpawnPoint | null };
  spawn: { player: P; point: SpawnPoint };
  /** Mutable: change `amount` or set `cancel`. Runs before health is reduced. */
  beforeDamage: DamageInfo<P> & { cancel: boolean };
  /** After health was reduced. `health` is what's left (0 = this damage killed). */
  damage: DamageInfo<P> & { health: number };
  death: DeathEvent<P>;
  /** A shot was fired (one per trigger pull; pellets share it). */
  fire: { player: P; weapon: string; origin: Vec3; dir: Vec3; hits: { victim: P; part: HitPart; damage: number }[]; end: Vec3 };
  reload: { player: P; weapon: string; empty: boolean };
  weaponSwitch: { player: P; slot: number; weapon: string };
  /** Edge-triggered buttons per applied input command (melee, lethal, streak use...). */
  buttons: { player: P; pressed: number; released: number; buttons: number };
  objective: { kind: string; team: Team | null; player: P | null; data?: unknown };
  phase: { phase: MatchPhase; prev: MatchPhase };
  matchStart: { time: number };
  /** Emitted once; handlers may add to `results.ext` and mutate profiles. Core saves profiles after. */
  matchEnd: { results: MatchResults };
  /** Every sim tick after players and timers stepped. */
  tick: { dt: number; time: number; tick: number };
  scoreChange: { team: Team | null; player: P | null; delta: number; reason: string; teamScores: [number, number] };
}

export type RoomEventName = keyof RoomEvents<unknown>;
