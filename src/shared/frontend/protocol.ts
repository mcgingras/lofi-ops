/**
 * Frontend RPCs and pushes (owner: frontend), typed by declaration merging into shared/protocol.
 *
 * Lobby flow: the client asks for a room (`frontend.matchmake`, `frontend.createPrivate`,
 * `frontend.resolveCode`), then joins it with the core `joinRoom` message (the match screen does
 * that: `navigate('match', { room })`). While the room is in its 'lobby' phase the server pushes
 * `frontend.lobby` (full state) to everyone in it on every change.
 */
import type { LobbyBotSettings } from '../defs/bots';
import type { Loadout } from '../loadout';
import type { LobbyLimits, LobbyState } from './lobby';

export interface PlaylistInfo {
  id: string;
  /** Mode it plays now (null = not available yet). */
  mode: string | null;
  /** Humans in matchmade lobbies/matches of this playlist. */
  players: number;
}

export interface LobbyTicket {
  roomId: string;
  code: string;
}

export interface LobbyConfigPatch {
  mode?: string;
  map?: string;
  limits?: Partial<LobbyLimits>;
  bots?: Partial<LobbyBotSettings>;
  /** Allow controller aim assist (default true). */
  aimAssist?: boolean;
}

declare module '../protocol' {
  interface RpcMap {
    /** Playlists with live population. */
    'frontend.playlists': { req: Record<string, never>; res: { playlists: PlaylistInfo[] } };
    /** Find (or open) a matchmade lobby for a playlist; then join `roomId`. */
    'frontend.matchmake': { req: { playlist: string }; res: LobbyTicket };
    /** Open a private lobby (the caller becomes host when they join). `bots`: the Play with Bots lobby. */
    'frontend.createPrivate': { req: { mode?: string; map?: string; bots?: boolean }; res: LobbyTicket };
    /** Lobby code (or invite URL) -> room. */
    'frontend.resolveCode': { req: { code: string }; res: LobbyTicket };
    /** The caller's current lobby state (null when not in a frontend lobby). */
    'frontend.state': { req: Record<string, never>; res: LobbyState | null };
    /** Map vote (matchmade): option index. */
    'frontend.vote': { req: { option: number }; res: { ok: true } };
    'frontend.ready': { req: { ready: boolean }; res: { ok: true } };
    /** Host only (private): mode, map, score/time limits, bot settings. */
    'frontend.configure': { req: LobbyConfigPatch; res: LobbyState };
    /** Host only (private): start the countdown. */
    'frontend.start': { req: Record<string, never>; res: { ok: true } };
    /** Report the client's measured round trip (ms) for the lobby player list. */
    'frontend.ping': { req: { rtt: number }; res: { ok: true } };
    /** Save a create-a-class slot (validated; locked picks are replaced). index = loadouts.length appends. */
    'frontend.saveLoadout': { req: { index: number; loadout: Loadout }; res: { index: number; loadout: Loadout; loadouts: Loadout[]; problems: string[] } };
    /** Pick the class for the next spawn (also saved to the profile). */
    'frontend.selectClass': { req: { index: number }; res: { selectedLoadout: number } };
  }
  interface FeatureMessages {
    /** Full lobby state, on every change while in a frontend lobby. */
    'frontend.lobby': LobbyState;
  }
}
export {};
