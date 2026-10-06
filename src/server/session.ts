/**
 * A connected client (one websocket). Holds the profile, the room it's in and its player there.
 * Bots have no session.
 */
import type { WebSocket } from 'ws';
import type { Profile } from '../shared/profile';
import { encodeMsg, type FeatureId, type FeatureMessages, type ServerMsg } from '../shared/protocol';
import type { PlayerState } from './player';
import type { Room } from './room';

/** Above this many buffered bytes, snapshots are skipped for this client (it's congested). */
const CONGESTED_BYTES = 256 * 1024;

export class Session {
  room: Room | null = null;
  player: PlayerState | null = null;
  /** Free-form per-connection feature state (menus, pending purchases...). */
  readonly ext: Record<string, unknown> = {};

  constructor(
    readonly id: string,
    readonly ws: WebSocket | null,
    public profile: Profile,
    readonly token: string,
  ) {}

  get open(): boolean {
    return !!this.ws && this.ws.readyState === 1;
  }

  get congested(): boolean {
    return !!this.ws && this.ws.bufferedAmount > CONGESTED_BYTES;
  }

  send(msg: ServerMsg): void {
    if (!this.open) return;
    this.ws!.send(encodeMsg(msg));
  }

  /** Push a namespaced feature message (client handles it with `onFeature(id, fn)`). */
  sendFeature<K extends FeatureId>(id: K, data: FeatureMessages[K]): void {
    this.send({ t: 'feat', id, data });
  }

  close(code = 1000, reason = ''): void {
    if (this.open) this.ws!.close(code, reason);
  }
}
