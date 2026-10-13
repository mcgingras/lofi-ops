/**
 * A player in a room (human or bot): authoritative movement, health, weapons, match stats.
 * Features keep their own per-player state in `player.ext` (typed by merging `PlayerExt`):
 *
 *   declare module '../../player' { interface PlayerExt { killstreaks?: { earned: string[] } } }
 *   player.ext.killstreaks ??= { earned: [] };
 */
import type { Team } from '../shared/constants';
import { HEALTH } from '../shared/constants';
import { effectiveWeapon, type EffectiveWeapon } from '../shared/defs/attachments';
import { WEAPON_BY_ID } from '../shared/defs/weapons';
import type { InputCmd } from '../shared/input';
import type { Loadout, WeaponLoadout } from '../shared/loadout';
import { createMoveState, type MoveState } from '../shared/movement';
import type { Profile } from '../shared/profile';
import type { FireMsgBody } from '../shared/protocol';
import { hashString } from '../shared/math';
import type { Room } from './room';
import type { Session } from './session';

/** Merge fields into this from features (all optional). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PlayerExt {}

export interface WeaponState {
  def: EffectiveWeapon;
  camo: string;
  mag: number;
  reserve: number;
  /** Shot-rate token bucket (shots available, refills at the weapon's rate). */
  credit: number;
  creditTime: number;
  /** Shots fired in the current burst (burst weapons). */
  burstCount: number;
  lastShot: number;
}

export interface MatchStats {
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  headshots: number;
  streak: number;
  bestStreak: number;
}

/** What a bot does each tick. Owner: bots feature. Return null to idle. */
export interface BotBrain {
  think(room: Room, self: PlayerState, dt: number): Omit<InputCmd, 'seq' | 'dt'> | null;
}

export interface DamageRecord {
  attacker: PlayerState;
  amount: number;
  time: number;
}

export interface PlayerState {
  /** Room-unique id (session id for humans, `bot-N` for bots). */
  id: string;
  name: string;
  isBot: boolean;
  session: Session | null;
  /** Persistent profile (humans). Mutate freely on the server; core saves it. */
  profile: Profile | null;
  team: Team | null;

  alive: boolean;
  health: number;
  maxHealth: number;
  lastDamageTime: number;
  damageLog: DamageRecord[];

  move: MoveState;
  yaw: number;
  pitch: number;
  buttons: number;
  inputQueue: InputCmd[];
  /** Shots received, waiting until their input seq has been applied. */
  pendingFires: (FireMsgBody & { receivedAt: number })[];
  lastSeq: number;
  lastInputTime: number;
  /** Seconds of input the client may still send ahead of real time (speed-hack guard). */
  timeBudget: number;

  /** Loadout in use this life, and the one picked for the next spawn (bots / no profile). */
  loadout: Loadout | null;
  nextLoadout: Loadout | null;
  weapons: WeaponState[];
  slot: number;
  /**
   * The server put `slot` in the player's hands itself (spawn: the primary; last stand: the pistol;
   * revive: the gun from before). Commands asking for another slot were sent before the client
   * knew, so they are ignored until one asks for this slot or `until` (room time) passes.
   */
  slotLock: { slot: number; until: number } | null;
  swapEnd: number;
  reloadEnd: number;
  /** Last time this player fired (radar ping), and whether that weapon was suppressed. */
  lastFireTime: number;
  lastFireSuppressed: boolean;

  stats: MatchStats;
  joinTime: number;
  spawnTime: number;
  diedAt: number;
  respawnAt: number | null;
  /** Seed for deterministic spread (client knows it: hash of the player id). */
  seed: number;
  brain: BotBrain | null;
  ext: PlayerExt;
}

export const emptyStats = (): MatchStats => ({ kills: 0, deaths: 0, assists: 0, score: 0, headshots: 0, streak: 0, bestStreak: 0 });

export function createPlayer(id: string, name: string, opts: { session?: Session | null; profile?: Profile | null; isBot?: boolean; team?: Team | null; time?: number } = {}): PlayerState {
  return {
    id,
    name,
    isBot: opts.isBot ?? false,
    session: opts.session ?? null,
    profile: opts.profile ?? null,
    team: opts.team ?? null,
    alive: false,
    health: 0,
    maxHealth: HEALTH.max,
    lastDamageTime: -999,
    damageLog: [],
    move: createMoveState(),
    yaw: 0,
    pitch: 0,
    buttons: 0,
    inputQueue: [],
    pendingFires: [],
    lastSeq: 0,
    lastInputTime: opts.time ?? 0,
    timeBudget: 0.1,
    loadout: null,
    nextLoadout: null,
    weapons: [],
    slot: 0,
    slotLock: null,
    swapEnd: 0,
    reloadEnd: 0,
    lastFireTime: -999,
    lastFireSuppressed: false,
    stats: emptyStats(),
    joinTime: opts.time ?? 0,
    spawnTime: 0,
    diedAt: -999,
    respawnAt: null,
    seed: hashString(id),
    brain: null,
    ext: {},
  };
}

/** Fresh weapon state from a loadout slot (falls back to the AK-47 / M1911 seeds). */
export function makeWeapon(w: WeaponLoadout, fallback: string): WeaponState {
  const base = WEAPON_BY_ID.get(w.weapon) ?? WEAPON_BY_ID.get(fallback)!;
  const def = effectiveWeapon(base, w.attachments);
  return { def, camo: w.camo, mag: def.magazine, reserve: def.reserve, credit: 1, creditTime: 0, burstCount: 0, lastShot: -999 };
}

export const currentWeapon = (p: PlayerState): WeaponState | undefined => p.weapons[p.slot];
