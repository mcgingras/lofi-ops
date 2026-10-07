/** Bot skill and lobby bot settings (owner: bots feature; the frontend lobby UI edits LobbyBotSettings). */
import { indexById } from './registry';

/** Every knob a bot brain reads. Presets fill all of them; "custom" lets the lobby host tune each one. */
export interface BotSkill {
  /** Delay from first seeing an enemy to starting to aim, ms. */
  reactionMs: number;
  /** Random aim error at engagement start, degrees (shrinks while tracking). */
  aimErrorDeg: number;
  /** How fast the bot turns toward a target, degrees per second. */
  turnSpeedDeg: number;
  /** 0..1 chance of aiming at the head rather than centre mass. */
  headshotBias: number;
  /** Horizontal field of view used for spotting, degrees. */
  fovDeg: number;
  /** Max distance a bot reacts to unsuppressed gunfire, metres. */
  hearingRange: number;
  /** 0..1 how much it strafes and crouch-spams in fights. */
  strafe: number;
  /** 0..1 recoil and burst control at range (1 = taps at range, sprays up close). */
  burstControl: number;
  /** 0..1 how much it goes for objectives versus hunting kills. */
  objectivePlay: number;
  /** 0..1 how promptly and sensibly it calls killstreaks. */
  streakUse: number;
  /** 0..1 aggression: pushing, flanking and chasing versus holding angles. */
  aggression: number;
}

export type BotDifficultyId = 'recruit' | 'regular' | 'hardened' | 'veteran';

export interface BotDifficultyDef {
  id: BotDifficultyId;
  name: string;
  description: string;
  skill: BotSkill;
}

export const BOT_DIFFICULTIES: BotDifficultyDef[] = [
  { id: 'recruit', name: 'Recruit', description: 'Slow to react, misses a lot. Good for learning maps.',
    skill: { reactionMs: 900, aimErrorDeg: 9, turnSpeedDeg: 140, headshotBias: 0.05, fovDeg: 90, hearingRange: 15, strafe: 0.1, burstControl: 0.2, objectivePlay: 0.3, streakUse: 0.3, aggression: 0.3 } },
  { id: 'regular', name: 'Regular', description: 'A casual public-match player.',
    skill: { reactionMs: 550, aimErrorDeg: 5, turnSpeedDeg: 240, headshotBias: 0.15, fovDeg: 110, hearingRange: 30, strafe: 0.35, burstControl: 0.5, objectivePlay: 0.5, streakUse: 0.6, aggression: 0.5 } },
  { id: 'hardened', name: 'Hardened', description: 'Quick, accurate, plays the objective.',
    skill: { reactionMs: 320, aimErrorDeg: 2.5, turnSpeedDeg: 360, headshotBias: 0.3, fovDeg: 120, hearingRange: 45, strafe: 0.6, burstControl: 0.75, objectivePlay: 0.7, streakUse: 0.85, aggression: 0.65 } },
  { id: 'veteran', name: 'Veteran', description: 'Sweaty. Pre-aims, strafes, punishes mistakes.',
    skill: { reactionMs: 180, aimErrorDeg: 1.2, turnSpeedDeg: 520, headshotBias: 0.45, fovDeg: 130, hearingRange: 60, strafe: 0.85, burstControl: 0.9, objectivePlay: 0.85, streakUse: 1, aggression: 0.8 } },
];

export const BOT_DIFFICULTY_BY_ID = indexById(BOT_DIFFICULTIES);

/** Slider ranges for the custom skill editor in the lobby (min, max, step). */
export const BOT_SKILL_RANGES: Record<keyof BotSkill, [number, number, number]> = {
  reactionMs: [100, 1500, 10], aimErrorDeg: [0, 15, 0.1], turnSpeedDeg: [60, 720, 10], headshotBias: [0, 1, 0.05],
  fovDeg: [60, 160, 5], hearingRange: [0, 80, 1], strafe: [0, 1, 0.05], burstControl: [0, 1, 0.05],
  objectivePlay: [0, 1, 0.05], streakUse: [0, 1, 0.05], aggression: [0, 1, 0.05],
};

/** What a lobby (host or playlist default) says about bots. */
export interface LobbyBotSettings {
  /** Fill empty slots with bots so the match can start without enough humans. */
  fill: boolean;
  /** Humans + bots the lobby aims for (per-mode default from DEFAULT_TARGET_PLAYERS). */
  targetPlayers: number;
  difficulty: BotDifficultyId | 'custom';
  /** Used when difficulty is 'custom'. */
  custom?: BotSkill;
  /** Spread difficulty a little per bot so they don't feel cloned (0..1). */
  variance: number;
}

export const DEFAULT_TARGET_PLAYERS: Record<string, number> = { tdm: 12, ffa: 8, dom: 12, sd: 10, hq: 12, kc: 12, oitc: 6, gungame: 8, sharpshooter: 8, sticks: 8 };

/** Matchmade lobbies wait this long for humans before backfilling with bots and starting. */
export const MATCHMAKING_WAIT_SEC = 20;

export const DEFAULT_LOBBY_BOTS: LobbyBotSettings = { fill: true, targetPlayers: 12, difficulty: 'regular', variance: 0.15 };

export function skillFor(settings: LobbyBotSettings): BotSkill {
  if (settings.difficulty === 'custom' && settings.custom) return settings.custom;
  const preset = BOT_DIFFICULTY_BY_ID.get(settings.difficulty === 'custom' ? 'regular' : settings.difficulty);
  return { ...(preset ?? BOT_DIFFICULTIES[1]).skill };
}

// ---------------------------------------------------------------------------------------------
// Wire types (CONTRACTS section 5 declaration merging), here so both sides get them.
//
//   bots.get          { roomId? }                     -> BotsState     (anyone)
//   bots.setSettings  { roomId?, settings: Partial }  -> BotsState     (host of a private room only)
//   bots.playWithBots { mode, map?, ...settings }      -> { roomId }    (creates a private room that
//                                     starts at once with bots; then navigate('match', { room }))
//   push 'bots.status' BotsState                       (to the room when settings or bot counts change)
// ---------------------------------------------------------------------------------------------

export interface BotsState {
  roomId: string;
  settings: LobbyBotSettings;
  /** The skill bots play with before per-bot variance (preset or custom). */
  skill: BotSkill;
  /** The receiving session may change settings (host of a private room). */
  editable: boolean;
  /** Effective target (settings.targetPlayers capped by the room size). */
  target: number;
  humans: number;
  bots: number;
  /** Room time when matchmaking stops waiting for humans and backfills, or null. */
  fillAt: number | null;
  /** False when this room's bot count is not managed by the bots feature (core botFill, LOFI_BOTS=off). */
  managed: boolean;
}

export interface PlayWithBotsReq extends Partial<LobbyBotSettings> {
  mode: string;
  map?: string;
}

declare module '../protocol' {
  interface RpcMap {
    'bots.get': { req: { roomId?: string }; res: BotsState };
    'bots.setSettings': { req: { roomId?: string; settings: Partial<LobbyBotSettings> }; res: BotsState };
    'bots.playWithBots': { req: PlayWithBotsReq; res: { roomId: string } };
  }
  interface FeatureMessages {
    'bots.status': BotsState;
  }
}
