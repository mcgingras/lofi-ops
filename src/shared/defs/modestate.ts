/**
 * Wire types of the modes feature (owner: modes): the objective state the server pushes to each
 * player (`modes.state`, team-relative: the bomb carrier only goes to attackers), announcer
 * events (`modes.event`), the final killcam clip (`modes.killcam`), the per-death killcam
 * (`modes.deathcam`, payload in deathcam.ts) and the end-of-match summary
 * that rides in `MatchResults.ext.modes`. Entity kinds for world props are listed in ENTITY_KINDS.
 */
import type { Team } from '../constants';
import type { DeathcamPayload } from './deathcam';
import type { InfectedStatePayload } from './infected';

export const MODE_ENTITY = {
  flag: 'modes.flag',
  bomb: 'modes.bomb',
  hq: 'modes.hq',
  tag: 'modes.tag',
} as const;

/** A capture zone (DOM flag or HQ). `cap` 0..1 towards `capTeam`. */
export interface ZoneState {
  id: string;
  x: number;
  y: number;
  z: number;
  r: number;
  owner: Team | null;
  cap: number;
  capTeam: Team | null;
  contested: boolean;
}

export type SdPhase = 'prep' | 'live' | 'planted' | 'post';
export type BombState = 'carried' | 'dropped' | 'planted' | 'exploded' | 'defused';

export interface SdStatePayload {
  round: number;
  attackers: Team;
  phase: SdPhase;
  /** Room time the phase ends (prep/live/planted = bomb timer/post). */
  endsAt: number;
  bomb: { state: BombState; x: number; y: number; z: number; site: string | null; carrier: string | null };
  sites: { id: string; x: number; y: number; z: number; r: number }[];
  /** Living players per team. */
  alive: [number, number];
  /** True once sides have switched. */
  switched: boolean;
  lastRound: { winner: Team; reason: SdRoundReason } | null;
}

export type SdRoundReason = 'eliminated' | 'time' | 'detonated' | 'defused';

export interface HqStatePayload {
  state: 'waiting' | 'neutral' | 'held';
  zone: ZoneState | null;
  /** Room time the HQ moves/expires (neutral, held) or comes online (waiting). */
  endsAt: number | null;
}

/** What the recipient is doing right now (progress bars). */
export interface ActionState {
  kind: 'plant' | 'defuse' | 'capture' | 'neutralize' | 'destroy';
  /** Target label ('A', 'HQ'...). */
  target: string;
  progress: number;
  /** Progress per second at the moment (the HUD extrapolates between pushes). */
  rate: number;
}

export interface ModeStatePayload {
  mode: string;
  /** Room time this state was built (for extrapolating progress). */
  time: number;
  flags?: ZoneState[];
  sd?: SdStatePayload;
  hq?: HqStatePayload;
  kc?: { confirmed: [number, number]; denied: [number, number] };
  infected?: InfectedStatePayload;
  me?: ActionState | null;
}

/**
 * Announcer / feed events. The client words them relative to the viewer's team, e.g.
 * dom.capture team 0 -> "A CAPTURED" for team 0 and "ENEMY CAPTURED A" for team 1.
 */
export type ModeEventKind =
  | 'dom.capture'
  | 'dom.neutralize'
  | 'dom.defend'
  | 'sd.round_start'
  | 'sd.pickup'
  | 'sd.drop'
  | 'sd.plant'
  | 'sd.defuse'
  | 'sd.explode'
  | 'sd.round_end'
  | 'sd.halftime'
  | 'sd.last_alive'
  | 'hq.online'
  | 'hq.capture'
  | 'hq.destroy'
  | 'hq.expire'
  | 'hq.move'
  | 'hq.defend'
  | 'kc.confirm'
  | 'kc.deny'
  // Infected: `player` = who it happened to / who did it (see eventLine in client/features/modes/text.ts).
  | 'infected.countdown'
  | 'infected.first'
  | 'infected.infect'
  | 'infected.survive'
  | 'infected.last_alive'
  | 'infected.outlast'
  | 'infected.final_stand';

export interface ModeEventPayload {
  kind: ModeEventKind;
  team: Team | null;
  /** Player who did it (null for timers). */
  player: string | null;
  /** Objective id ('A', 'B', 'HQ'). */
  obj?: string;
  /** Extra: round winner reason, points... */
  reason?: string;
  points?: number;
}

/** Replay frame: every player's pose at a room time. `f` = PlayerFlags bits, `hp` = health % (0..100). */
export interface KillcamFrame {
  t: number;
  p: [id: string, x: number, y: number, z: number, yaw: number, pitch: number, f: number, hp?: number][];
}

export interface KillcamPayload {
  killer: string;
  victim: string;
  weapon: string;
  headshot: boolean;
  /** Room time of the kill. */
  at: number;
  frames: KillcamFrame[];
}

export interface XpLine {
  label: string;
  amount: number;
}

export interface PlayerSummary {
  /** Objective stats: captures, defends, plants, defuses, confirms, denies, destroys... */
  stats: Record<string, number>;
  xp: XpLine[];
  xpTotal: number;
}

/** `MatchResults.ext.modes`. */
export interface MatchSummaryExt {
  mvp: string | null;
  /** Keyed by player id (room-local, matches PlayerResult.id). */
  players: Record<string, PlayerSummary>;
  /** S&D rounds played. */
  rounds?: number;
  /** Where the XP numbers came from: 'progression' if that feature provided them, else 'modes'. */
  xpSource: 'progression' | 'modes';
}

declare module '../protocol' {
  interface FeatureMessages {
    'modes.state': ModeStatePayload;
    'modes.event': ModeEventPayload;
    'modes.killcam': KillcamPayload;
    /** Per-death killcam, to the victim only (see defs/deathcam.ts). */
    'modes.deathcam': DeathcamPayload;
  }
}
