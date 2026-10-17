/**
 * Server side of the 'zombies' feature area (owner: zombies): BO1-style round-based co-op survival.
 * See docs/features/zombies.md.
 *
 * setup(): registers the `zombies` mode rules (rules.ts) and the RPCs
 *   - `zombies.solo {map?, allies?, allyDifficulty?}`: a private Zombies lobby that starts on its own
 *     as soon as you join (one click to play), with AI partners (ally.ts; 1 by default, 0-3);
 *   - `zombies.coop {map?}`: a private Zombies lobby with a code to share (the host starts it).
 * Both go through the frontend's lobby manager, so "back to lobby", invites and the map picker work.
 */
import { MAP_BY_ID } from '../../../shared/defs/maps';
import '../../../shared/defs/zombies';
import type { Feature } from '../../feature';
import { RpcError, type RpcContext } from '../../rpc';
import { lobbyManagerFor } from '../frontend/index';
import { setZombiesAllies } from './game';
import { ZombiesRules } from './rules';

export { zombiesGameOf, ZombiesRules } from './rules';

const feature: Feature = {
  id: 'zombies',
  setup(api) {
    api.registerMode('zombies', () => new ZombiesRules());

    const lobby = (ctx: RpcContext, data: unknown, solo: boolean) => {
      const m = lobbyManagerFor(api.lobby);
      if (!m) throw new RpcError('unavailable', 'lobbies are not available');
      const req = (data && typeof data === 'object' ? data : {}) as { map?: unknown; allies?: unknown; allyDifficulty?: unknown };
      const map = typeof req.map === 'string' && MAP_BY_ID.get(req.map)?.modes.includes('zombies') ? req.map : undefined;
      const l = m.createPrivate(ctx.session, { mode: 'zombies', map });
      if (solo) {
        setZombiesAllies(l.room, req.allies, req.allyDifficulty);
        // One click: start as soon as the creator is in (the frontend's solo countdown).
        const room = l.room;
        const off = room.bus.on('playerJoin', ({ player }) => {
          if (player.session !== ctx.session) return;
          off();
          room.schedule(0.05, () => {
            try {
              if (room.phase === 'lobby') m.start(room, player);
            } catch {
              /* someone else is host, or it already started */
            }
          });
        });
      }
      return { roomId: l.room.id, code: l.code };
    };
    api.rpc.handle('zombies.solo', (ctx, data) => lobby(ctx, data, true));
    api.rpc.handle('zombies.coop', (ctx, data) => lobby(ctx, data, false));
  },
};

export default feature;
