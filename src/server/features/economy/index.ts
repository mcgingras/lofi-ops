/**
 * Server side of the 'economy' feature area (owner: economy). See docs/features/economy.md.
 *
 *   setup: store RPCs (economy.state/buy/equip/setCamo), wager RPCs (economy.wagerQueue/
 *          wagerList/wagerStart), the four wager modes, the crossbow behaviour, the escrow sweeper.
 *   room:  CP at match end, `economy.grant`, spawn-time ownership checks, wager escrow + HUD.
 */
import { WAGER_ONLY_WEAPONS } from '../../../shared/defs/wager-weapons';
import type { Feature, ServerApi } from '../../feature';
import type { Room } from '../../room';
import { RpcError } from '../../rpc';
import { wireEarning } from './earn';
import { gunGameRules } from './modes/gungame';
import { oitcRules } from './modes/oitc';
import { sharpshooterRules } from './modes/sharpshooter';
import { crossbowBehavior, sticksRules } from './modes/sticks';
import { enforceClasses, registerShopRpcs } from './shop';
import './types';
import { WagerManager } from './wager';

/** One manager per server (keyed by its store; tests run several servers in one process). */
const managers = new WeakMap<object, WagerManager>();
let latest: WagerManager | null = null;
const managerFor = (room: Room) => (room.deps.store ? (managers.get(room.deps.store) ?? null) : latest);

/** The wager manager for a room's server (null before setup). Other areas may call `setWagerAnte`. */
export const wagersFor = (room: Room) => managerFor(room);

/** Wager settings for a room (bots feature: backfill difficulty/skill for wager lobbies). */
export function wagerRoomInfo(room: Room) {
  const s = managerFor(room)?.states.get(room.id);
  return s && s.room === room ? { ante: s.ante, practice: s.practice, bots: s.bots, target: s.target } : null;
}

const feature: Feature = {
  id: 'economy',
  setup(api: ServerApi) {
    const m = new WagerManager(api);
    managers.set(api.store, m);
    latest = m;
    m.start();
    registerShopRpcs(api);
    api.rpc.handle('economy.wagerQueue', (ctx, data) => {
      if (ctx.room && ctx.room.phase === 'playing' && m.states.get(ctx.room.id)?.active) throw new RpcError('busy', 'finish your wager first');
      return m.queue(ctx.session, (data ?? {}) as Record<string, unknown>);
    });
    api.rpc.handle('economy.wagerList', () => ({ rooms: m.list() }));
    api.rpc.handle('economy.wagerStart', (ctx) => ({ ok: m.requestStart(ctx.session) }));
    api.registerMode('oitc', oitcRules);
    api.registerMode('gungame', gunGameRules);
    api.registerMode('sharpshooter', () => sharpshooterRules());
    api.registerMode('sticks', sticksRules);
    // Only our own crossbow def gets our bolt behaviour (a weapons-area crossbow brings its own).
    if (WAGER_ONLY_WEAPONS.has('crossbow')) api.registerWeaponBehavior('crossbow', crossbowBehavior);
  },
  room(room) {
    wireEarning(room);
    enforceClasses(room);
    managerFor(room)?.attach(room);
  },
};

export default feature;
