/**
 * Server side of the 'bots' feature area (owner: bots). See docs/features/bots.md.
 *
 * Every room gets a RoomBots controller (roster.ts) that applies its LobbyBotSettings: backfill
 * to the target at match start (quick-play rooms wait MATCHMAKING_WAIT_SEC for humans first),
 * replace leavers, retire bots as humans join, brains (brain.ts) on a nav grid built from the
 * map (nav.ts). RPCs: bots.get, bots.setSettings (private-room host), bots.playWithBots.
 *
 * Server API for other areas (import from '../bots/api'):
 *   configureRoomBots(room, settings, { waitSec?, hostId?, managed? })   frontend lobbies
 *   createBotRoom(lobby, { mode, map?, ...settings }, hostSessionId?)    "Play with bots"
 *   registerBotGoal(modeId, fn)                                          modes: objective play
 *   registerBotStreakHandler(fn), registerBotModeStyle(modeId, style)    killstreaks / economy
 */
import { MODE_BY_ID } from '../../../shared/defs/modes';
import type { BotsState } from '../../../shared/defs/bots';
import type { Feature, ServerApi } from '../../feature';
import { LobbyError } from '../../lobby';
import type { Room } from '../../room';
import { RpcError, type RpcContext } from '../../rpc';
import { createBotRoom } from './api';
import { createRoomBots, roomBots } from './roster';

let api: ServerApi | null = null;

function roomFor(ctx: RpcContext, data: unknown): Room {
  const roomId = (data as { roomId?: unknown } | null)?.roomId;
  if (roomId !== undefined && typeof roomId !== 'string') throw new RpcError('bad_request', 'roomId must be a string');
  const room = roomId ? api?.lobby.get(roomId) : ctx.room;
  if (!room || room.closed) throw new RpcError('unknown_room', 'no such room');
  return room;
}

function stateFor(room: Room, ctx: RpcContext): BotsState {
  const rb = roomBots(room);
  if (!rb) throw new RpcError('unavailable', 'bots not active in this room');
  return rb.state(ctx.session.id);
}

const feature: Feature = {
  id: 'bots',
  setup(serverApi) {
    api = serverApi;
    serverApi.rpc.handle('bots.get', (ctx, data) => stateFor(roomFor(ctx, data), ctx));

    serverApi.rpc.handle('bots.setSettings', (ctx, data) => {
      const room = roomFor(ctx, data);
      const rb = roomBots(room);
      if (!rb) throw new RpcError('unavailable', 'bots not active in this room');
      if (!room.options.private) throw new RpcError('not_allowed', 'matchmade rooms use playlist bot settings');
      if (!rb.canEdit(ctx.session.id)) throw new RpcError('not_host', 'only the host can change bot settings');
      const settings = (data as { settings?: unknown } | null)?.settings;
      if (!settings || typeof settings !== 'object') throw new RpcError('bad_request', 'settings required');
      rb.update(settings);
      return rb.state(ctx.session.id);
    });

    serverApi.rpc.handle('bots.playWithBots', (ctx, data) => {
      const req = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
      if (typeof req.mode !== 'string' || !MODE_BY_ID.has(req.mode)) throw new RpcError('bad_request', 'unknown mode');
      if (req.map !== undefined && typeof req.map !== 'string') throw new RpcError('bad_request', 'map must be a string');
      try {
        const room = createBotRoom(serverApi.lobby, { ...req, mode: req.mode, map: req.map as string | undefined }, ctx.session.id);
        return { roomId: room.id };
      } catch (err) {
        if (err instanceof LobbyError) throw new RpcError(err.code, err.message);
        throw err;
      }
    });
  },
  room(room) {
    createRoomBots(room);
  },
};

export default feature;
