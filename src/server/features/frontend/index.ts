/**
 * Server side of the 'frontend' feature (owner: frontend): playlists and matchmaking, private
 * lobbies with codes and a host, map vote, ready/start, bot backfill hand-off (manager.ts), and
 * create-a-class saving with validation (loadouts.ts). RPC ids and pushes: shared/frontend/protocol.ts.
 */
import '../../../shared/frontend/protocol';
import type { Feature } from '../../feature';
import type { Lobby } from '../../lobby';
import { RpcError } from '../../rpc';
import { registerLoadoutRpcs, trimSpawnLoadout } from './loadouts';
import { LobbyManager, type LobbyTimings } from './manager';

export { getLobbyBotSettings, LobbyManager, DEFAULT_TIMINGS, type LobbyTimings, type ManagedLobby } from './manager';

const managers = new WeakMap<Lobby, LobbyManager>();

/** The lobby manager of a running server (tests, other features). */
export function lobbyManagerFor(lobby: Lobby): LobbyManager | undefined {
  return managers.get(lobby);
}

const ticket = (l: { room: { id: string }; code: string }) => ({ roomId: l.room.id, code: l.code });

/** The feature with custom lobby timings (tests use short waits). */
export function createFrontendFeature(timings: Partial<LobbyTimings> = {}): Feature {
  return {
    id: 'frontend',
    setup(api) {
      const m = new LobbyManager({ lobby: api.lobby, rpc: api.rpc }, timings);
      managers.set(api.lobby, m);
      const obj = (d: unknown) => (d && typeof d === 'object' ? (d as Record<string, unknown>) : {});

      api.rpc.handle('frontend.playlists', () => ({ playlists: m.playlists() }));
      api.rpc.handle('frontend.matchmake', (ctx, data) => ticket(m.matchmake(ctx.session, obj(data).playlist)));
      api.rpc.handle('frontend.createPrivate', (ctx, data) => ticket(m.createPrivate(ctx.session, obj(data))));
      api.rpc.handle('frontend.resolveCode', (_ctx, data) => {
        const l = m.byCode(obj(data).code);
        if (!l || l.room.closed) throw new RpcError('unknown_code', 'no lobby with that code');
        if (l.room.isFull) throw new RpcError('room_full', 'that lobby is full');
        return ticket(l);
      });
      api.rpc.handle('frontend.state', (ctx) => {
        const l = m.forRoom(ctx.room);
        return l ? m.state(l) : null;
      });
      api.rpc.handle('frontend.vote', (ctx, data) => {
        m.vote(ctx.room, ctx.player, obj(data).option);
        return { ok: true as const };
      });
      api.rpc.handle('frontend.ready', (ctx, data) => {
        m.setReady(ctx.room, ctx.player, obj(data).ready);
        return { ok: true as const };
      });
      api.rpc.handle('frontend.configure', (ctx, data) => m.configure(ctx.room, ctx.player, data));
      api.rpc.handle('frontend.start', (ctx) => {
        m.start(ctx.room, ctx.player);
        return { ok: true as const };
      });
      api.rpc.handle('frontend.ping', (ctx, data) => {
        m.setPing(ctx.session, obj(data).rtt);
        return { ok: true as const };
      });
      registerLoadoutRpcs(api);
    },
    room(room) {
      // Warlord-aware attachment cap and one perk per tier, whatever path the loadout came from.
      room.bus.on('beforeSpawn', (e) => {
        if (!e.player.isBot) trimSpawnLoadout(e.loadout);
      }, { priority: 100 });
    },
  };
}

const feature: Feature = createFrontendFeature();
export default feature;
