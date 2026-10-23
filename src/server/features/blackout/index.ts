/**
 * Server side of the 'blackout' feature area: Blackout, a 100-player battle royale (BO4's mode).
 * See docs/features/blackout.md and src/shared/defs/blackout.ts.
 *
 * setup(): registers the `blackout` mode rules (rules.ts / game.ts), the bots' Blackout brain
 * (brain.ts, level of detail by distance to humans) and the RPCs
 *   - `blackout.solo {}`: a private Blackout lobby that starts as soon as you join, bots filling
 *     it to 100;
 *   - `blackout.spectate {next?}`: after death, watch the killer or the next player alive.
 */
import '../../../shared/defs/blackout';
import { BLACKOUT, BLACKOUT_MODE } from '../../../shared/defs/blackout';
import type { Feature } from '../../feature';
import { RpcError } from '../../rpc';
import { registerMode } from '../../modes/index';
import { registerBotBrain } from '../bots/hooks';
import { lobbyManagerFor } from '../frontend/index';
import { createBlackoutBrain } from './brain';
import { BlackoutRules, blackoutGameOf } from './rules';

export { blackoutGameOf, BlackoutRules } from './rules';

/** Register the mode rules and the bots' brain (idempotent). Tests that build a Lobby directly call this. */
export function registerBlackout(register: (id: string, f: () => BlackoutRules) => void = registerMode): void {
  register(BLACKOUT_MODE, () => new BlackoutRules());
  registerBotBrain(BLACKOUT_MODE, createBlackoutBrain);
}

const feature: Feature = {
  id: 'blackout',
  setup(api) {
    registerBlackout(api.registerMode);

    api.rpc.handle('blackout.solo', (ctx) => {
      const m = lobbyManagerFor(api.lobby);
      if (!m) throw new RpcError('unavailable', 'lobbies are not available');
      const l = m.createPrivate(ctx.session, { mode: BLACKOUT_MODE, map: 'blackout', bots: true });
      l.bots = { ...l.bots, fill: true, targetPlayers: BLACKOUT.players };
      const room = l.room;
      room.options.postMatchSec = BLACKOUT.postMatchSec;
      // One click: start as soon as the creator is in.
      const off = room.bus.on('playerJoin', ({ player }) => {
        if (player.session !== ctx.session) return;
        off();
        room.schedule(0.05, () => {
          try {
            if (room.phase === 'lobby') m.start(room, player);
          } catch {
            /* already started */
          }
        });
      });
      return { roomId: room.id };
    });

    api.rpc.handle('blackout.spectate', (ctx, data) => {
      const room = ctx.room;
      const p = ctx.player;
      const g = room ? blackoutGameOf(room) : null;
      if (!g || !p) throw new RpcError('bad_request', 'not in a Blackout match');
      const next = !!(data && typeof data === 'object' && (data as { next?: unknown }).next);
      return { watching: g.spectate(p, next) };
    });
  },
};

export default feature;
