/**
 * Real per-game lobbies on top of core lobby.ts (owner: frontend).
 *
 * A managed lobby is a room created with `autoStart: false, onEnd: 'lobby'`, plus state kept here:
 * a 6-character code (invite links / party join), host (private lobbies; migrates when the host
 * leaves), ready flags, the map vote (matchmade: two maps + random), score/time limits and the
 * `LobbyBotSettings`. While the room is in its 'lobby' phase:
 *
 *   matchmade: waits up to `waitSec` (MATCHMAKING_WAIT_SEC = 20 s) for humans, then starts with
 *              bots. A full lobby (humans >= target) or everyone ready shortens it to a countdown.
 *   private:   the host configures and presses Start (short countdown).
 *
 * Starting: resolve the vote, apply limits (a copy of the ModeDef on `room.mode`), hand the bot
 * settings to the bots feature (room event `frontend.botSettings`, plus the `bots.setSettings` RPC
 * when the bots feature registered it), set `room.options.botFill` to the target so core backfills
 * (teams balanced by core) and keeps the count when humans come and go, then `room.startMatch()`.
 * After the results the room returns to 'lobby': bots leave and a new wait/vote begins.
 *
 * Everyone in the room gets the full `frontend.lobby` state on every change.
 */
import { skillFor, type BotSkill, type LobbyBotSettings, MATCHMAKING_WAIT_SEC } from '../../../shared/defs/bots';
import { MAP_BY_ID, mapsForMode } from '../../../shared/defs/maps';
import { MODE_BY_ID, type ModeDef } from '../../../shared/defs/modes';
import { prestigeEmblem } from '../../../shared/defs/progression';
import { botsToFill, clampLimits, defaultBotSettings, makeLobbyCode, normalizeCode, sanitizeBotSettings, tallyVote, voteCounts, voteOptions, type LobbyKind, type LobbyLimits, type LobbyState, type LobbyStatus } from '../../../shared/frontend/lobby';
import { PLAYLIST_BY_ID, PLAYLISTS, playlistMode } from '../../../shared/frontend/playlists';
import type { LobbyConfigPatch, PlaylistInfo } from '../../../shared/frontend/protocol';
import type { Profile } from '../../../shared/profile';
import type { Lobby } from '../../lobby';
import type { PlayerState } from '../../player';
import type { Room } from '../../room';
import { RpcError, type RpcRegistry } from '../../rpc';
import type { Session } from '../../session';

declare module '../../../shared/events' {
  interface RoomEvents<P> {
    /**
     * Lobby bot settings changed (`starting` = the match is about to start and core botFill was
     * just set to the target). For the bots feature: tune brains from `skill` (+ `settings.variance`).
     */
    'frontend.botSettings': { settings: LobbyBotSettings; skill: BotSkill; starting: boolean; host: P | null };
  }
}

export interface LobbyTimings {
  /** Matchmade: wait for humans before starting with bots. */
  waitSec: number;
  /** Matchmade: countdown once the lobby is full. */
  fullCountdownSec: number;
  /** Matchmade: countdown once every human is ready. */
  readyCountdownSec: number;
  /** Private: countdown after the host presses Start (with other humans / alone). */
  privateCountdownSec: number;
  soloCountdownSec: number;
  /** Frozen spawn countdown (core room option). */
  spawnCountdownSec: number;
  postMatchSec: number;
  /** A matchmaking ticket holds a slot this long (wall ms). */
  reserveMs: number;
  /** Lobby update interval (room seconds). */
  updateSec: number;
}

export const DEFAULT_TIMINGS: LobbyTimings = {
  waitSec: MATCHMAKING_WAIT_SEC,
  fullCountdownSec: 10,
  readyCountdownSec: 5,
  privateCountdownSec: 5,
  soloCountdownSec: 3,
  spawnCountdownSec: 5,
  // The final killcam takes ~5 s of this; the rest is the summary screen (scoreboard, MVP, XP).
  postMatchSec: 15,
  reserveMs: 10_000,
  updateSec: 0.25,
};

export interface ManagedLobby {
  room: Room;
  code: string;
  kind: LobbyKind;
  playlist: string | null;
  /** Profile id that becomes host on joining (private). */
  creator: string | null;
  hostId: string | null;
  joinOrder: string[];
  ready: Set<string>;
  votes: Map<string, number>;
  voteOptions: string[] | null;
  limits: LobbyLimits;
  bots: LobbyBotSettings;
  waitEndsAt: number | null;
  countdownEndsAt: number | null;
  /** session id -> wall ms the reserved slot expires. */
  reservations: Map<string, number>;
  dirty: boolean;
  lastPush: number;
}

export interface ManagerDeps {
  lobby: Lobby;
  /** To hand bot settings to the bots feature's `bots.setSettings` RPC when it exists. */
  rpc?: RpcRegistry;
  rand?: () => number;
  /** Wall clock (ms) for reservations. */
  now?: () => number;
}

const botSettingsByRoom = new WeakMap<Room, LobbyBotSettings>();

/** The bot settings the frontend handed over for a room (null for rooms it doesn't manage). */
export function getLobbyBotSettings(room: Room): LobbyBotSettings | null {
  return botSettingsByRoom.get(room) ?? null;
}

const PING_KEY = 'frontend.ping';

export class LobbyManager {
  readonly lobbies = new Map<string, ManagedLobby>();
  private codes = new Map<string, string>();
  readonly t: LobbyTimings;
  private rand: () => number;
  private now: () => number;

  constructor(
    private deps: ManagerDeps,
    timings: Partial<LobbyTimings> = {},
  ) {
    this.t = { ...DEFAULT_TIMINGS, ...timings };
    this.rand = deps.rand ?? Math.random;
    this.now = deps.now ?? Date.now;
    deps.lobby.onRoomClosed((r) => this.forget(r));
  }

  // -------------------------------------------------------------------------------------------
  // Lookup
  // -------------------------------------------------------------------------------------------

  get(roomId: string): ManagedLobby | undefined {
    return this.lobbies.get(roomId);
  }

  forRoom(room: Room | null | undefined): ManagedLobby | undefined {
    return room ? this.lobbies.get(room.id) : undefined;
  }

  byCode(code: unknown): ManagedLobby | undefined {
    const c = normalizeCode(code);
    const id = c ? this.codes.get(c) : undefined;
    return id ? this.lobbies.get(id) : undefined;
  }

  private forget(room: Room) {
    const l = this.lobbies.get(room.id);
    if (!l) return;
    this.lobbies.delete(room.id);
    this.codes.delete(l.code);
  }

  // -------------------------------------------------------------------------------------------
  // Creating / finding lobbies
  // -------------------------------------------------------------------------------------------

  createLobby(opts: { kind: LobbyKind; mode: string; map?: string; playlist?: string | null; creator?: string | null; name?: string }): ManagedLobby {
    const mode = MODE_BY_ID.get(opts.mode);
    if (!mode) throw new RpcError('unknown_mode', `unknown mode: ${opts.mode}`);
    const map = opts.map && MAP_BY_ID.has(opts.map) ? opts.map : undefined;
    const room = this.deps.lobby.createRoom({
      mode: mode.id,
      map,
      name: opts.name ?? (opts.kind === 'private' ? `Private ${mode.short}` : mode.name),
      private: opts.kind === 'private',
      autoStart: false,
      onEnd: 'lobby',
      countdownSec: this.t.spawnCountdownSec,
      postMatchSec: this.t.postMatchSec,
      botFill: 0,
      closeWhenEmpty: true,
    });
    let code = makeLobbyCode(this.rand);
    for (let i = 0; this.codes.has(code) && i < 50; i++) code = makeLobbyCode(this.rand);
    const l: ManagedLobby = {
      room,
      code,
      kind: opts.kind,
      playlist: opts.playlist ?? null,
      creator: opts.creator ?? null,
      hostId: null,
      joinOrder: [],
      ready: new Set(),
      votes: new Map(),
      voteOptions: opts.kind === 'matchmade' ? voteOptions(this.mapsFor(mode.id), null, this.rand) : null,
      limits: { scoreLimit: mode.scoreLimit, timeLimitSec: mode.timeLimitSec },
      bots: defaultBotSettings(mode),
      waitEndsAt: null,
      countdownEndsAt: null,
      reservations: new Map(),
      dirty: true,
      lastPush: -1,
    };
    this.lobbies.set(room.id, l);
    this.codes.set(code, room.id);
    botSettingsByRoom.set(room, l.bots);
    this.wire(l);
    return l;
  }

  /** A matchmade lobby for the playlist with a free slot (reserved for this session), or a new one. */
  matchmake(session: Session, playlistId: unknown): ManagedLobby {
    const pl = typeof playlistId === 'string' ? PLAYLIST_BY_ID.get(playlistId) : undefined;
    if (!pl) throw new RpcError('unknown_playlist', 'unknown playlist');
    const mode = playlistMode(pl);
    if (!mode) throw new RpcError('unavailable', `${pl.name} is coming soon`);
    const now = this.now();
    const open = [...this.lobbies.values()]
      .filter((l) => l.kind === 'matchmade' && l.playlist === pl.id && !l.room.closed && l.room.phase !== 'ended' && l.room !== session.room && this.freeSlots(l, session.id, now) > 0)
      .sort((a, b) => Number(b.room.phase === 'lobby') - Number(a.room.phase === 'lobby') || b.room.humans().length - a.room.humans().length);
    const l = open[0] ?? this.createLobby({ kind: 'matchmade', mode, playlist: pl.id });
    l.reservations.set(session.id, now + this.t.reserveMs);
    return l;
  }

  createPrivate(session: Session, req: { mode?: unknown; map?: unknown; bots?: unknown }): ManagedLobby {
    const mode = typeof req.mode === 'string' ? req.mode : 'tdm';
    if (!MODE_BY_ID.has(mode)) throw new RpcError('unknown_mode', `unknown mode: ${mode}`);
    const maps = this.mapsFor(mode);
    const map = typeof req.map === 'string' && maps.includes(req.map) ? req.map : undefined;
    const l = this.createLobby({ kind: 'private', mode, map, creator: session.profile.id, name: req.bots === true ? 'Bot match' : undefined });
    if (req.bots === true) l.bots = { ...l.bots, fill: true };
    l.reservations.set(session.id, this.now() + this.t.reserveMs);
    return l;
  }

  /** Free human slots, not counting other sessions' live reservations. */
  freeSlots(l: ManagedLobby, sessionId: string, now = this.now()): number {
    const r = l.room;
    const inRoom = new Set(r.humans().map((p) => p.session?.id));
    let reserved = 0;
    for (const [sid, exp] of l.reservations) {
      if (exp <= now || inRoom.has(sid)) l.reservations.delete(sid);
      else if (sid !== sessionId) reserved++;
    }
    return r.options.maxPlayers - r.humans().length - reserved;
  }

  playlists(): PlaylistInfo[] {
    return PLAYLISTS.map((p) => ({
      id: p.id,
      mode: playlistMode(p),
      players: [...this.lobbies.values()].filter((l) => l.playlist === p.id).reduce((n, l) => n + l.room.humans().length, 0),
    }));
  }

  mapsFor(mode: string): string[] {
    const m = mapsForMode(mode).map((d) => d.id);
    return m.length ? m : ['yard'];
  }

  // -------------------------------------------------------------------------------------------
  // Room wiring and the lobby loop
  // -------------------------------------------------------------------------------------------

  private wire(l: ManagedLobby) {
    const r = l.room;
    r.bus.on('playerJoin', ({ player }) => {
      if (player.isBot) return;
      l.joinOrder = l.joinOrder.filter((id) => id !== player.id);
      l.joinOrder.push(player.id);
      if (player.session) l.reservations.delete(player.session.id);
      if (l.kind === 'private') {
        if (l.creator && player.profile?.id === l.creator) {
          l.hostId = player.id;
          l.creator = null;
        } else if (!l.hostId || !r.players.has(l.hostId)) l.hostId = player.id;
      }
      this.push(l);
    });
    r.bus.on('playerLeave', ({ player }) => {
      if (player.isBot) return;
      l.joinOrder = l.joinOrder.filter((id) => id !== player.id);
      l.ready.delete(player.id);
      l.votes.delete(player.id);
      if (l.hostId === player.id) l.hostId = l.kind === 'private' ? (l.joinOrder.find((id) => r.players.has(id)) ?? null) : null;
      l.dirty = true;
    });
    r.bus.on('phase', ({ phase }) => {
      if (phase === 'lobby') this.resetForLobby(l);
      else {
        l.waitEndsAt = null;
        l.countdownEndsAt = null;
      }
      l.dirty = true;
    });
    r.every(this.t.updateSec, () => this.update(l));
  }

  /** Back from a match: bots leave, ready/vote reset, a new wait begins. */
  private resetForLobby(l: ManagedLobby) {
    const r = l.room;
    r.options.botFill = 0;
    for (const b of r.bots()) r.removePlayer(b.id, 'kicked');
    l.ready.clear();
    l.votes.clear();
    l.waitEndsAt = null;
    l.countdownEndsAt = null;
    if (l.kind === 'matchmade') l.voteOptions = voteOptions(this.mapsFor(r.mode.id), r.mapId, this.rand);
  }

  /** One lobby tick (every `updateSec` of room time). Public for tests. */
  update(l: ManagedLobby): void {
    const r = l.room;
    if (r.closed) return;
    const now = r.time;
    if (r.phase === 'lobby') {
      const humans = r.humans().length;
      if (humans === 0) {
        if (l.waitEndsAt !== null || l.countdownEndsAt !== null) l.dirty = true;
        l.waitEndsAt = null;
        l.countdownEndsAt = null;
      } else if (l.kind === 'matchmade') {
        if (l.waitEndsAt === null) {
          l.waitEndsAt = now + this.t.waitSec;
          l.dirty = true;
        }
        let cd = l.countdownEndsAt;
        const min = (a: number | null, b: number) => (a === null ? b : Math.min(a, b));
        if (humans >= Math.min(l.bots.targetPlayers, r.options.maxPlayers)) cd = min(cd, now + this.t.fullCountdownSec);
        if (this.allReady(l)) cd = min(cd, now + this.t.readyCountdownSec);
        if (cd !== l.countdownEndsAt) {
          l.countdownEndsAt = cd;
          l.dirty = true;
        }
        if (now + 1e-6 >= l.waitEndsAt || (l.countdownEndsAt !== null && now + 1e-6 >= l.countdownEndsAt)) this.startNow(l);
      } else if (l.countdownEndsAt !== null && now + 1e-6 >= l.countdownEndsAt) {
        this.startNow(l);
      }
    }
    if (l.dirty || (r.phase === 'lobby' && now - l.lastPush >= 2)) this.push(l);
  }

  allReady(l: ManagedLobby): boolean {
    const humans = l.room.humans();
    return humans.length > 0 && humans.every((p) => l.ready.has(p.id));
  }

  /** Start the match now: vote, limits, bots, go. */
  startNow(l: ManagedLobby): void {
    const r = l.room;
    if (r.closed || r.phase !== 'lobby' || r.humans().length === 0) return;
    l.waitEndsAt = null;
    l.countdownEndsAt = null;
    const limitsChanged = this.applyLimits(l);
    let mapChanged = false;
    if (l.kind === 'matchmade' && l.voteOptions) {
      const map = tallyVote(l.voteOptions, l.votes.values(), this.mapsFor(r.mode.id), this.rand);
      if (map !== r.mapId && MAP_BY_ID.has(map)) {
        r.setMap(map);
        mapChanged = true;
      }
    }
    // Clients read the limits from `joined`: re-send it if they changed and setMap didn't.
    if (limitsChanged && !mapChanged) for (const p of r.humans()) p.session?.send(r.joinedMsg(p));
    l.votes.clear();
    l.voteOptions = null;
    l.ready.clear();
    this.handBots(l, true);
    r.startMatch();
    this.push(l);
  }

  /** room.mode = the ModeDef with this lobby's limits. Returns whether they differ from the def. */
  private applyLimits(l: ManagedLobby): boolean {
    const r = l.room;
    const base = MODE_BY_ID.get(r.mode.id) ?? r.mode;
    const same = base.scoreLimit === l.limits.scoreLimit && base.timeLimitSec === l.limits.timeLimitSec;
    const before = r.mode;
    r.mode = same ? base : ({ ...base, scoreLimit: l.limits.scoreLimit, timeLimitSec: l.limits.timeLimitSec } satisfies ModeDef);
    return before.scoreLimit !== r.mode.scoreLimit || before.timeLimitSec !== r.mode.timeLimitSec || !same;
  }

  /**
   * Hand the bot settings over: remembered for `getLobbyBotSettings(room)`, emitted as the room
   * event `frontend.botSettings`, sent to the bots feature's `bots.setSettings` RPC if it exists,
   * and (when starting) core backfill via `room.options.botFill`.
   */
  handBots(l: ManagedLobby, starting: boolean): void {
    const r = l.room;
    const s = l.bots;
    botSettingsByRoom.set(r, s);
    const host = (l.hostId ? r.players.get(l.hostId) : undefined) ?? r.humans()[0] ?? null;
    r.bus.emit('frontend.botSettings', { settings: s, skill: skillFor(s), starting, host });
    const rpc = this.deps.rpc;
    if (rpc?.has('bots.setSettings') && host?.session) void rpc.dispatch({ session: host.session, room: r, player: host }, 'bots.setSettings', { roomId: r.id, settings: { ...s, custom: s.custom ? { ...s.custom } : undefined } });
    if (starting) {
      r.options.botFill = s.fill ? Math.min(s.targetPlayers, r.options.maxPlayers) : 0;
      r.fillBots();
    }
  }

  // -------------------------------------------------------------------------------------------
  // Player actions (validated; called from RPCs)
  // -------------------------------------------------------------------------------------------

  private need(room: Room | null, player: PlayerState | null): { l: ManagedLobby; player: PlayerState } {
    const l = this.forRoom(room);
    if (!l || !player) throw new RpcError('not_in_lobby', 'not in a lobby');
    return { l, player };
  }

  private needHost(room: Room | null, player: PlayerState | null): ManagedLobby {
    const { l, player: p } = this.need(room, player);
    if (l.kind !== 'private') throw new RpcError('not_private', 'only private lobbies have a host');
    if (l.hostId !== p.id) throw new RpcError('not_host', 'only the host can do that');
    if (l.room.phase !== 'lobby') throw new RpcError('in_match', 'the match has started');
    return l;
  }

  vote(room: Room | null, player: PlayerState | null, option: unknown): void {
    const { l, player: p } = this.need(room, player);
    if (!l.voteOptions || l.room.phase !== 'lobby') throw new RpcError('no_vote', 'no map vote open');
    if (typeof option !== 'number' || !Number.isInteger(option) || option < 0 || option >= l.voteOptions.length) throw new RpcError('bad_request', 'bad option');
    l.votes.set(p.id, option);
    this.push(l);
  }

  setReady(room: Room | null, player: PlayerState | null, ready: unknown): void {
    const { l, player: p } = this.need(room, player);
    if (ready === true) l.ready.add(p.id);
    else l.ready.delete(p.id);
    this.push(l);
  }

  configure(room: Room | null, player: PlayerState | null, patch: unknown): LobbyState {
    const l = this.needHost(room, player);
    const r = l.room;
    const src = (patch && typeof patch === 'object' ? patch : {}) as LobbyConfigPatch & Record<string, unknown>;
    if (src.mode !== undefined) {
      const def = typeof src.mode === 'string' ? MODE_BY_ID.get(src.mode) : undefined;
      if (!def) throw new RpcError('unknown_mode', 'unknown mode');
      if (def.id !== r.mode.id) {
        r.setMode(def.id);
        r.options.maxPlayers = def.maxPlayers;
        l.limits = { scoreLimit: def.scoreLimit, timeLimitSec: def.timeLimitSec };
        l.bots = { ...l.bots, targetPlayers: defaultBotSettings(def).targetPlayers };
        const maps = this.mapsFor(def.id);
        if (!maps.includes(r.mapId) && MAP_BY_ID.has(maps[0]!)) r.setMap(maps[0]!);
      }
    }
    if (src.map !== undefined) {
      if (typeof src.map !== 'string' || !MAP_BY_ID.has(src.map) || !this.mapsFor(r.mode.id).includes(src.map)) throw new RpcError('unknown_map', 'map not available for this mode');
      if (src.map !== r.mapId) r.setMap(src.map);
    }
    if (src.limits !== undefined) l.limits = clampLimits(MODE_BY_ID.get(r.mode.id) ?? r.mode, src.limits, l.limits);
    if (src.bots !== undefined || src.mode !== undefined) {
      l.bots = sanitizeBotSettings(src.bots ?? {}, l.bots, r.options.maxPlayers);
      this.handBots(l, false);
    }
    this.push(l);
    return this.state(l);
  }

  start(room: Room | null, player: PlayerState | null): void {
    const l = this.needHost(room, player);
    if (l.countdownEndsAt !== null) return;
    const humans = l.room.humans().length;
    l.countdownEndsAt = l.room.time + (humans <= 1 ? this.t.soloCountdownSec : this.t.privateCountdownSec);
    this.push(l);
  }

  setPing(session: Session, rtt: unknown): void {
    if (typeof rtt !== 'number' || !Number.isFinite(rtt)) throw new RpcError('bad_request', 'rtt required');
    session.ext[PING_KEY] = Math.max(0, Math.min(9999, Math.round(rtt)));
  }

  // -------------------------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------------------------

  state(l: ManagedLobby): LobbyState {
    const r = l.room;
    const humans = r.humans().length;
    const status: LobbyStatus = r.phase === 'lobby' ? (l.countdownEndsAt !== null ? 'countdown' : 'waiting') : r.phase === 'ended' ? 'results' : 'inMatch';
    const votes: Record<string, number> = {};
    for (const [k, v] of l.votes) votes[k] = v;
    return {
      roomId: r.id,
      code: l.code,
      kind: l.kind,
      playlist: l.playlist,
      mode: r.mode.id,
      map: r.mapId,
      phase: r.phase,
      status,
      hostId: l.hostId,
      players: [...r.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        level: p.profile?.level ?? 1,
        prestige: p.profile?.prestige ?? 0,
        emblem: emblemOf(p.profile),
        ping: p.session ? ((p.session.ext[PING_KEY] as number | undefined) ?? null) : null,
        ready: l.ready.has(p.id),
        host: p.id === l.hostId,
        bot: p.isBot,
        team: p.team,
      })),
      maxPlayers: r.options.maxPlayers,
      limits: { ...l.limits },
      bots: { ...l.bots, custom: l.bots.custom ? { ...l.bots.custom } : undefined },
      botsToFill: r.phase === 'lobby' ? botsToFill(l.bots, humans, r.options.maxPlayers) : r.bots().length,
      vote: l.voteOptions ? { options: [...l.voteOptions], counts: voteCounts(l.voteOptions, l.votes.values()), votes } : null,
      waitEndsAt: l.waitEndsAt,
      countdownEndsAt: l.countdownEndsAt,
      time: r.time,
    };
  }

  push(l: ManagedLobby): void {
    const r = l.room;
    l.dirty = false;
    l.lastPush = r.time;
    if (r.closed) return;
    const s = this.state(l);
    for (const p of r.humans()) p.session?.sendFeature('frontend.lobby', s);
  }
}

function emblemOf(profile: Profile | null | undefined): string | null {
  if (!profile) return null;
  const ext = profile.ext.progression as { emblem?: unknown } | undefined;
  if (ext && typeof ext.emblem === 'string') return ext.emblem;
  return profile.prestige > 0 ? prestigeEmblem(profile.prestige) : null;
}
