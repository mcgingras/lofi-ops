/**
 * Rooms registry and matchmaking. v1 is quick play (join an open public room for a mode, or
 * create one). The frontend feature builds real per-game lobbies on top of this API:
 *
 *   const room = api.lobby.createRoom({ mode: 'tdm', map: 'yard', autoStart: false, onEnd: 'lobby', botFill: 8, countdownSec: 10 });
 *   api.lobby.join(session, room.id);
 *   room.setMap('nuketown'); room.startMatch();
 */
import { MODE_BY_ID } from '../shared/defs/modes';
import { MAP_BY_ID } from '../shared/defs/maps';
import type { RoomSummary } from '../shared/protocol';
import type { Feature } from './feature';
import { Room, type RoomOptions } from './room';
import type { Session } from './session';
import type { Store } from './store';

export class LobbyError extends Error {
  constructor(
    readonly code: 'unknown_mode' | 'unknown_map' | 'unknown_room' | 'room_full' | 'room_closed',
    message: string = code,
  ) {
    super(message);
  }
}

export interface LobbyDeps {
  store: Store | null;
  features: readonly Feature[];
  log: (msg: string) => void;
  autoTick: boolean;
  /** Defaults merged into every quick-play room's options. */
  quickPlayDefaults?: Partial<RoomOptions>;
}

type RoomListener = (room: Room) => void;

export class Lobby {
  readonly rooms = new Map<string, Room>();
  private created: RoomListener[] = [];
  private closed: RoomListener[] = [];

  constructor(private deps: LobbyDeps) {}

  /** Create a room (any options). Fires `onRoomCreated` listeners. */
  createRoom(opts: RoomOptions): Room {
    if (!MODE_BY_ID.has(opts.mode)) throw new LobbyError('unknown_mode', `unknown mode: ${opts.mode}`);
    if (opts.map && !MAP_BY_ID.has(opts.map)) throw new LobbyError('unknown_map', `unknown map: ${opts.map}`);
    if (opts.id && this.rooms.has(opts.id)) throw new Error(`room id taken: ${opts.id}`);
    const room = new Room(opts, {
      store: this.deps.store,
      features: this.deps.features,
      log: this.deps.log,
      autoTick: this.deps.autoTick,
      onClose: (r) => {
        this.rooms.delete(r.id);
        for (const fn of this.closed) fn(r);
      },
    });
    this.rooms.set(room.id, room);
    for (const fn of this.created) fn(room);
    return room;
  }

  /** Join the fullest open public room for the mode (and map, if given), or create one. */
  quickPlay(session: Session, req: { mode: string; map?: string }): Room {
    if (!MODE_BY_ID.has(req.mode)) throw new LobbyError('unknown_mode', `unknown mode: ${req.mode}`);
    if (req.map && !MAP_BY_ID.has(req.map)) throw new LobbyError('unknown_map', `unknown map: ${req.map}`);
    const open = [...this.rooms.values()]
      .filter((r) => !r.closed && !r.options.private && r.mode.id === req.mode && (!req.map || r.mapId === req.map) && r.phase !== 'ended' && !r.isFull && r !== session.room)
      .sort((a, b) => b.humans().length - a.humans().length);
    const room = open[0] ?? this.createRoom({ ...this.deps.quickPlayDefaults, mode: req.mode, map: req.map });
    this.joinRoom(session, room);
    return room;
  }

  /** Join a room by id. */
  join(session: Session, roomId: string): Room {
    const room = this.rooms.get(roomId);
    if (!room) throw new LobbyError('unknown_room');
    this.joinRoom(session, room);
    return room;
  }

  private joinRoom(session: Session, room: Room) {
    if (room.closed) throw new LobbyError('room_closed');
    if (room.isFull) throw new LobbyError('room_full');
    if (session.room === room) return;
    if (session.room) this.leave(session, 'left');
    room.addHuman(session);
  }

  leave(session: Session, reason: 'left' | 'disconnect' = 'left'): void {
    const room = session.room;
    if (room && session.player) room.removePlayer(session.player.id, reason);
    session.room = null;
    session.player = null;
  }

  list(filter: { mode?: string; includePrivate?: boolean } = {}): RoomSummary[] {
    return [...this.rooms.values()].filter((r) => !r.closed && (filter.includePrivate || !r.options.private) && (!filter.mode || r.mode.id === filter.mode)).map((r) => r.summary());
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  onRoomCreated(fn: RoomListener): () => void {
    this.created.push(fn);
    return () => (this.created = this.created.filter((f) => f !== fn));
  }

  onRoomClosed(fn: RoomListener): () => void {
    this.closed.push(fn);
    return () => (this.closed = this.closed.filter((f) => f !== fn));
  }

  shutdown(): void {
    for (const r of [...this.rooms.values()]) r.close();
  }
}
