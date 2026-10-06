/**
 * The feature plug-in contract. A feature area (perks, killstreaks, progression, economy, bots,
 * loadouts, weapons, modes...) lives in src/server/features/<area>/index.ts and default-exports a
 * `Feature`. It is listed once in features/index.ts.
 *
 *   const feature: Feature = {
 *     id: 'perks',
 *     setup(api) { api.rpc.handle('perks.list', () => ...); },        // once per server
 *     room(room) {                                                     // once per room
 *       room.modifiers.add('speedMultiplier', (p) => ..., 'perks.lightweight');
 *       room.bus.on('death', (e) => ...);
 *     },
 *   };
 *   export default feature;
 */
import type { Lobby } from './lobby';
import type { registerMode } from './modes/index';
import type { registerWeaponBehavior } from './combat';
import type { Room } from './room';
import type { RpcRegistry } from './rpc';
import type { Session } from './session';
import type { Store } from './store';

export interface ServerApi {
  lobby: Lobby;
  store: Store;
  rpc: RpcRegistry;
  /** Register mode rules by mode id (see modes/types.ts). */
  registerMode: typeof registerMode;
  /** Replace hitscan for a weapon id or class (see combat.ts). */
  registerWeaponBehavior: typeof registerWeaponBehavior;
  /** Connected sessions (in menus or in rooms). */
  sessions(): Iterable<Session>;
  log(msg: string): void;
}

export interface Feature {
  /** Area id; also the namespace for its RPC ids, feature messages, events and profile.ext key. */
  id: string;
  /** Once at server start. */
  setup?(api: ServerApi): void;
  /** For every room, right after its mode rules are set up and before the first match starts. */
  room?(room: Room): void;
}
