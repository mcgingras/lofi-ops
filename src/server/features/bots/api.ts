/**
 * The bots feature's server API for other areas (frontend lobbies, modes, economy, killstreaks).
 *
 *   import { configureRoomBots, createBotRoom, registerBotGoal } from '../bots/api';
 *
 *   // frontend: a per-game lobby (backfill happens when the match starts):
 *   const room = api.lobby.createRoom({ mode: 'tdm', autoStart: false, onEnd: 'lobby', countdownSec: 10, private: true });
 *   configureRoomBots(room, { difficulty: 'hardened', targetPlayers: 8 }, { hostId: session.id });
 *
 *   // frontend: "Play with bots" (private room, starts now, bots at once):
 *   const room = createBotRoom(api.lobby, { mode: 'tdm', difficulty: 'custom', custom: {...} }, session.id);
 *   // client: navigate('match', { room: room.id })   (or the bots.playWithBots RPC does both halves)
 */
import type { LobbyBotSettings } from '../../../shared/defs/bots';
import type { Lobby } from '../../lobby';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import type { Brain } from './brain';
import { createRoomBots, roomBots, type RoomBots, type RoomBotsOptions } from './roster';

export { registerBotGoal, registerBotStreakHandler, registerBotModeStyle, type BotGoal, type BotGoalFn, type BotModeStyle } from './hooks';
export { navFor, type NavGrid } from './nav';
export type { RoomBots } from './roster';

/**
 * Apply bot settings to a room (validated and clamped). `waitSec` replaces the matchmaking wait
 * (0 = fill as soon as a match is on); `hostId` = session id allowed to change settings over RPC;
 * `managed: false` hands the bot count back to core (`RoomOptions.botFill`).
 */
export function configureRoomBots(room: Room, settings: Partial<LobbyBotSettings>, opts: RoomBotsOptions = {}): RoomBots {
  const rb = roomBots(room) ?? createRoomBots(room, opts);
  if (opts.managed !== undefined) rb.managed = opts.managed;
  if (opts.hostId !== undefined) rb.hostId = opts.hostId;
  rb.update(settings);
  if (opts.waitSec !== undefined) rb.setWait(opts.waitSec);
  return rb;
}

/** Current bot settings + counts of a room (or undefined if the bots feature isn't loaded). */
export function getRoomBots(room: Room): RoomBots | undefined {
  return roomBots(room);
}

/** True when bots are playing in the room (economy: wagers with bots are practice only). */
export function roomHasBots(room: Room): boolean {
  return room.bots().length > 0;
}

/** The brain driving a bot (to read its target / goal, or `brain.forced = goal`), if it's ours. */
export function botBrain(room: Room, p: PlayerState): Brain | undefined {
  return roomBots(room)?.brains.get(p.id);
}

/**
 * "Play with bots": a private room that starts right away with bots filling it to the target.
 * Unknown fields in `req` are ignored; settings are validated. Throws LobbyError for unknown
 * modes/maps.
 */
export function createBotRoom(lobby: Lobby, req: { mode: string; map?: string } & Partial<LobbyBotSettings>, hostSessionId: string | null = null): Room {
  const room = lobby.createRoom({ mode: req.mode, map: req.map, private: true, autoStart: true, countdownSec: 0, onEnd: 'rotate', name: 'Bot match' });
  const { mode: _m, map: _p, ...settings } = req;
  configureRoomBots(room, { fill: true, ...settings }, { waitSec: 0, hostId: hostSessionId });
  return room;
}
