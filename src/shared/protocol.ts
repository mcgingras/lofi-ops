/**
 * Every client <-> server message, plus the codec. Messages are objects with a `t` tag.
 *
 * Core messages are listed in `ClientMessages` / `ServerMessages`. Features do NOT add core message
 * types; they use two namespaced channels instead, typed by declaration merging:
 *
 *   - client -> server RPC:  { t: 'rpc', id: 'killstreak.call', data, rid? }
 *       typed by `RpcMap` ('<area>.<name>': { req; res }). With `rid`, the server answers
 *       { t: 'rpcResult', rid, ok, data | error }.
 *   - server -> client push: { t: 'feat', id: 'killstreak.earned', data }
 *       typed by `FeatureMessages` ('<area>.<name>': payload).
 *
 *   declare module '../../../shared/protocol' {
 *     interface RpcMap { 'killstreak.call': { req: { id: string }; res: { ok: boolean } } }
 *     interface FeatureMessages { 'killstreak.earned': { id: string } }
 *   }
 *
 * The codec is JSON for v1 behind `Codec`, so it can be swapped for a binary one later without
 * touching call sites (`setCodec`).
 */
import type { Team } from './constants';
import type { MatchPhase, MatchResults } from './events';
import type { InputCmd } from './input';
import type { MoveParams, MoveState } from './movement';
import type { Profile } from './profile';
import type { Loadout } from './loadout';

export type { InputCmd } from './input';

// ---------------------------------------------------------------------------------------------
// Feature channels (extend by declaration merging)
// ---------------------------------------------------------------------------------------------

/** Client -> server RPCs: id -> { req, res }. Core ones are prefixed `core.`. */
export interface RpcMap {
  /** Returns the caller's profile. */
  'core.profile': { req: Record<string, never>; res: Profile };
  /** Change display name (2-16 chars). Returns the profile. */
  'core.setName': { req: { name: string }; res: Profile };
}

/** Server -> client pushes: id -> payload. */
export interface FeatureMessages {
  /** A short toast for the HUD. */
  'core.notice': { text: string };
}

export type RpcId = keyof RpcMap & string;
export type RpcReq<K extends RpcId> = RpcMap[K] extends { req: infer R } ? R : never;
export type RpcRes<K extends RpcId> = RpcMap[K] extends { res: infer R } ? R : never;
export type FeatureId = keyof FeatureMessages & string;

// ---------------------------------------------------------------------------------------------
// Snapshot pieces
// ---------------------------------------------------------------------------------------------

/** Bit flags in PlayerSnap.f. */
export const PlayerFlags = {
  ALIVE: 1,
  CROUCH: 2,
  SPRINT: 4,
  ADS: 8,
  GROUND: 16,
  RELOADING: 32,
  FIRING: 64,
  SWITCHING: 128,
} as const;

/** Another player as everyone sees them (positions rounded to mm). */
export interface PlayerSnap {
  id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  /** PlayerFlags bits. */
  f: number;
  /** Weapon in hand. */
  w: string;
  /** Camo of the weapon in hand. */
  c: string;
}

export interface WeaponSnap {
  id: string;
  attachments: string[];
  camo: string;
  mag: number;
  reserve: number;
}

/** The recipient's own authoritative state (prediction + HUD). */
export interface MeSnap {
  id: string;
  alive: boolean;
  health: number;
  maxHealth: number;
  move: MoveState;
  params: MoveParams;
  slot: number;
  weapons: WeaponSnap[];
  /** Room time the current reload / weapon switch completes (0 = none). */
  reloadEnd: number;
  swapEnd: number;
  /** Room time of the next respawn when dead (null when alive or no respawn). */
  respawnAt: number | null;
  streak: number;
}

/** Feature-owned world entities (killstreaks, dogs, care packages, objectives with state). */
export interface EntitySnap {
  id: number;
  kind: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  owner?: string;
  team?: Team | null;
  /** Small free-form state for the client renderer. */
  s?: Record<string, number | string | boolean>;
}

/** A shot others should see (tracer / muzzle flash). */
export interface ShotSnap {
  /** Shooter id. */
  p: string;
  o: [number, number, number];
  e: [number, number, number];
  w: string;
  /** 1 if it hit a player. */
  h?: 1;
}

export interface RosterEntry {
  id: string;
  name: string;
  team: Team | null;
  bot: boolean;
  level: number;
  prestige: number;
}

export interface ScoreEntry {
  id: string;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  headshots: number;
  streak: number;
}

export interface RoomSummary {
  id: string;
  mode: string;
  map: string;
  phase: MatchPhase;
  players: number;
  humans: number;
  maxPlayers: number;
  private: boolean;
  name: string;
}

// ---------------------------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------------------------

export interface FireMsgBody {
  /** Input seq the shot was fired at (server applies inputs up to it first). */
  seq: number;
  /** Room time the client was viewing others at (interpolation time). Rewind is clamped. */
  time: number;
  origin: [number, number, number];
  /** Aim direction before spread (unit). Server applies spread deterministically (ballistics.ts). */
  dir: [number, number, number];
  /** Per-shot counter used for the spread seed (client increments per trigger pull). */
  shot: number;
}

export interface ClientMessages {
  hello: { token?: string; name?: string; version: number };
  quickplay: { mode: string; map?: string };
  joinRoom: { roomId: string };
  leaveRoom: Record<never, never>;
  listRooms: { mode?: string };
  input: { cmds: InputCmd[] };
  fire: FireMsgBody;
  /** Pick a class (index into profile.loadouts) for the next spawn. */
  selectLoadout: { index: number };
  rpc: { id: string; data: unknown; rid?: number };
  ping: { t0: number };
}

export interface ServerMessages {
  welcome: { sessionId: string; token: string; profile: Profile; version: number; defaultLoadouts: Loadout[] };
  joined: { roomId: string; you: string; mode: string; map: string; team: Team | null; phase: MatchPhase; tickRate: number; snapshotRate: number; time: number; timeLimit: number; scoreLimit: number };
  left: { reason: string };
  rooms: { rooms: RoomSummary[] };
  roster: { players: RosterEntry[] };
  snap: {
    tick: number;
    time: number;
    /** Last input seq applied for the recipient. */
    ack: number;
    phase: MatchPhase;
    me: MeSnap | null;
    players: PlayerSnap[];
    ents: EntitySnap[];
    shots: ShotSnap[];
    teams: [number, number] | null;
    /** Seconds left (null = no limit / not playing). */
    timeLeft: number | null;
    /** Enemy ids visible on the recipient's minimap (red dots). */
    radar: string[];
    /** True when the recipient's radar is jammed. */
    jammed: boolean;
  };
  killfeed: { attacker: string | null; victim: string; weapon: string; headshot: boolean; means: string; attackerTeam: Team | null; victimTeam: Team | null };
  /** To the shooter: hitmarker. */
  hit: { victim: string; part: string; damage: number; kill: boolean };
  /** To the victim: damage direction. */
  hurt: { attacker: string | null; amount: number; from: [number, number, number] | null; health: number };
  /** To the victim. */
  died: { attacker: string | null; weapon: string; respawnAt: number | null };
  spawned: { x: number; y: number; z: number; yaw: number; loadout: Loadout };
  score: { teams: [number, number] | null; players: ScoreEntry[] };
  phase: { phase: MatchPhase; time: number; endsAt: number | null };
  matchEnd: { results: MatchResults };
  profile: { profile: Profile };
  feat: { id: string; data: unknown };
  rpcResult: { rid: number; ok: boolean; data?: unknown; error?: string };
  pong: { t0: number; time: number };
  error: { code: string; message: string };
}

type Tagged<M> = { [K in keyof M]: { t: K } & M[K] }[keyof M];
export type ClientMsg = Tagged<ClientMessages>;
export type ServerMsg = Tagged<ServerMessages>;
export type ClientMsgOf<K extends keyof ClientMessages> = { t: K } & ClientMessages[K];
export type ServerMsgOf<K extends keyof ServerMessages> = { t: K } & ServerMessages[K];

// ---------------------------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------------------------

export type WireData = string | Uint8Array;

export interface Codec {
  encode(msg: ClientMsg | ServerMsg): WireData;
  decode(data: WireData): unknown;
}

export const jsonCodec: Codec = {
  encode: (msg) => JSON.stringify(msg),
  decode: (data) => JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)) as unknown,
};

let codec: Codec = jsonCodec;
/** Swap the codec (both sides must agree). */
export const setCodec = (c: Codec) => {
  codec = c;
};
export const encodeMsg = (msg: ClientMsg | ServerMsg): WireData => codec.encode(msg);

const CLIENT_TYPES = new Set<string>(['hello', 'quickplay', 'joinRoom', 'leaveRoom', 'listRooms', 'input', 'fire', 'selectLoadout', 'rpc', 'ping']);
const SERVER_TYPES = new Set<string>(['welcome', 'joined', 'left', 'rooms', 'roster', 'snap', 'killfeed', 'hit', 'hurt', 'died', 'spawned', 'score', 'phase', 'matchEnd', 'profile', 'feat', 'rpcResult', 'pong', 'error']);

function decodeTagged(data: WireData, types: Set<string>): { t: string } | null {
  let v: unknown;
  try {
    v = codec.decode(data);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || typeof (v as { t?: unknown }).t !== 'string' || !types.has((v as { t: string }).t)) return null;
  return v as { t: string };
}

/**
 * Decode a client message. Checks only the tag; handlers must validate fields (it is untrusted).
 * Returns null for garbage.
 */
export const decodeClientMsg = (data: WireData) => decodeTagged(data, CLIENT_TYPES) as ClientMsg | null;
export const decodeServerMsg = (data: WireData) => decodeTagged(data, SERVER_TYPES) as ServerMsg | null;

/** Round to millimetres for the wire. */
export const q3 = (v: number) => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------------------------
// Validation helpers for untrusted input (server side)
// ---------------------------------------------------------------------------------------------

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isStr = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length <= max;
export const isVec3Tuple = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(isNum);

export function isInputCmd(v: unknown): v is InputCmd {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return isNum(c.seq) && isNum(c.dt) && isNum(c.buttons) && isNum(c.yaw) && isNum(c.pitch) && isNum(c.weaponSlot);
}
