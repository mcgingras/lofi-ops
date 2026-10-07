/**
 * Networking.
 *
 * `net` (singleton `Net`): the socket. Connects to `/ws` on this origin (wss on https), says hello
 * with the guest token from localStorage (`lofi.token`), retries with a "waking server" state while
 * a scaled-to-zero server boots, and exposes a typed message bus (`net.on('snap', fn)`), `send`,
 * `rpc(id, data)` (promise; typed by RpcMap) and the room clock (ping/pong). Namespaced feature
 * pushes (`feat`) go to the registry (`onFeature`).
 *
 * `MatchNet`: one room session's netcode. Input commands at frame rate (dt <= MAX_CMD_DT) batched
 * to <= 60 Hz, local prediction + reconciliation (netcode/predict.ts), remote interpolation
 * 100 ms behind (netcode/interp.ts), and `fire` messages carrying the interpolation time.
 */
import { MAX_CMD_DT, PROTOCOL_VERSION, WS_PATH } from '../shared/constants';
import type { InputCmd } from '../shared/input';
import { buildCollisionWorld } from '../shared/maps/types';
import { getMapData } from '../shared/defs/maps';
import { quantizeAngle } from '../shared/math';
import { createMoveState, type MoveState } from '../shared/movement';
import type { Profile } from '../shared/profile';
import type { Loadout } from '../shared/loadout';
import { decodeServerMsg, encodeMsg, type ClientMsg, type MeSnap, type RpcId, type RpcReq, type RpcRes, type ServerMessages, type ServerMsg, type ServerMsgOf } from '../shared/protocol';
import { ClockSync } from './netcode/clock';
import { SnapshotBuffer } from './netcode/interp';
import { Predictor } from './netcode/predict';
import { dispatchFeature } from './registry';

export type NetStatus = 'idle' | 'connecting' | 'waking' | 'online' | 'offline';
type Handler<K extends keyof ServerMessages> = (msg: ServerMsgOf<K>) => void;

const TOKEN_KEY = 'lofi.token';
/** A first connect slower than this shows "Waking server..." (Fly holds the request while a stopped machine boots). */
const WAKING_AFTER_MS = 1500;
/** Give up on a handshake that hangs this long and retry. */
const CONNECT_TIMEOUT_MS = 15000;
const NAME_KEY = 'lofi.name';
const nowSec = () => performance.now() / 1000;

function lsGet(k: string): string | undefined {
  try {
    return localStorage.getItem(k) ?? undefined;
  } catch {
    return undefined;
  }
}
function lsSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

/** The guest token this browser signs in with (the recovery code), if it has one yet. */
export function currentToken(): string | undefined {
  return lsGet(TOKEN_KEY);
}

/** Recovery codes are the token in groups of four, upper case: ABCD-1234-... */
export function formatRecoveryCode(token: string): string {
  return token.toUpperCase().match(/.{1,4}/g)?.join('-') ?? token.toUpperCase();
}

/** Accept a pasted code with any spacing, dashes or case; null if it can't be a code. */
export function normalizeRecoveryCode(code: string): string | null {
  const hex = code.toLowerCase().replace(/[^0-9a-f]/g, '');
  return hex.length >= 16 && hex.length <= 128 ? hex : null;
}

/** Switch this browser to another account's token; the caller reloads so the socket says hello again. */
export function adoptToken(token: string): boolean {
  lsSet(TOKEN_KEY, token);
  return lsGet(TOKEN_KEY) === token;
}

export class Net {
  status: NetStatus = 'idle';
  profile: Profile | null = null;
  sessionId = '';
  defaultLoadouts: Loadout[] = [];
  readonly clock = new ClockSync();
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<(m: ServerMsg) => void>>();
  private statusFns = new Set<(s: NetStatus) => void>();
  private rid = 0;
  private rpcs = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private attempts = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private wantOpen = false;
  private queue: ClientMsg[] = [];

  /** Open the connection (retries until online). */
  connect(): void {
    this.wantOpen = true;
    if (this.ws) return;
    this.open();
  }

  private setStatus(s: NetStatus) {
    if (s === this.status) return;
    this.status = s;
    for (const fn of this.statusFns) fn(s);
  }

  /** Status changes (menu: "Waking server..."). Called once immediately. Returns an unsubscribe. */
  onStatus(fn: (s: NetStatus) => void): () => void {
    this.statusFns.add(fn);
    fn(this.status);
    return () => this.statusFns.delete(fn);
  }

  private open() {
    this.setStatus(this.attempts > 0 ? 'waking' : 'connecting');
    const url = socketUrl(location);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.retry();
      return;
    }
    this.ws = ws;
    // Scale-to-zero cold start: the proxy holds the upgrade while the machine boots, so a slow
    // first handshake means "waking"; a handshake that never completes is dropped and retried.
    const wakingTimer = setTimeout(() => {
      if (this.ws === ws && this.status === 'connecting') this.setStatus('waking');
    }, WAKING_AFTER_MS);
    const connectTimer = setTimeout(() => {
      if (this.ws === ws && ws.readyState === WebSocket.CONNECTING) ws.close();
    }, CONNECT_TIMEOUT_MS);
    const clearTimers = () => {
      clearTimeout(wakingTimer);
      clearTimeout(connectTimer);
    };
    ws.addEventListener('open', clearTimers);
    ws.addEventListener('close', clearTimers);
    ws.onopen = () => ws.send(encodeMsg({ t: 'hello', token: lsGet(TOKEN_KEY), name: lsGet(NAME_KEY), version: PROTOCOL_VERSION }) as string);
    ws.onmessage = (ev) => {
      const msg = decodeServerMsg(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data as ArrayBuffer));
      if (msg) this.receive(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      for (const r of this.rpcs.values()) {
        clearTimeout(r.timer);
        r.reject(new Error('disconnected'));
      }
      this.rpcs.clear();
      const wasOnline = this.status === 'online';
      this.emit({ t: 'left', reason: 'disconnect' });
      if (wasOnline) this.attempts = 0;
      this.retry();
    };
  }

  private retry() {
    if (!this.wantOpen) {
      this.setStatus('offline');
      return;
    }
    this.attempts++;
    this.setStatus(this.attempts > 20 ? 'offline' : 'waking');
    const delay = Math.min(5000, 400 * 1.5 ** Math.min(this.attempts, 8));
    setTimeout(() => {
      if (!this.ws && this.wantOpen) this.open();
    }, delay);
  }

  private receive(msg: ServerMsg) {
    switch (msg.t) {
      case 'welcome':
        lsSet(TOKEN_KEY, msg.token);
        this.profile = msg.profile;
        this.sessionId = msg.sessionId;
        this.defaultLoadouts = msg.defaultLoadouts;
        this.attempts = 0;
        this.setStatus('online');
        for (const m of this.queue.splice(0)) this.send(m);
        if (!this.pingTimer) this.pingTimer = setInterval(() => this.ping(), 1000);
        this.ping();
        break;
      case 'profile':
        this.profile = msg.profile;
        break;
      case 'pong':
        if (msg.time > 0) this.clock.onPong(msg.t0, msg.time, nowSec());
        break;
      case 'joined':
        this.clock.reset();
        this.ping();
        break;
      case 'rpcResult': {
        const r = this.rpcs.get(msg.rid);
        if (r) {
          this.rpcs.delete(msg.rid);
          clearTimeout(r.timer);
          if (msg.ok) r.resolve(msg.data);
          else r.reject(new Error(msg.error ?? 'rpc failed'));
        }
        break;
      }
      case 'feat':
        dispatchFeature(msg.id, msg.data);
        break;
      case 'snap':
        this.clock.onSnapshot(msg.time, nowSec());
        break;
    }
    this.emit(msg);
  }

  private emit(msg: ServerMsg) {
    const set = this.handlers.get(msg.t);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(msg);
      } catch (err) {
        console.error(`[net] handler for ${msg.t}`, err);
      }
    }
  }

  /** Subscribe to a server message type. Returns an unsubscribe function. */
  on<K extends keyof ServerMessages>(t: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(t);
    if (!set) this.handlers.set(t, (set = new Set()));
    const h = fn as unknown as (m: ServerMsg) => void;
    set.add(h);
    return () => set.delete(h);
  }

  /** Send now (queued until welcome if not online yet; inputs/fires are dropped instead). */
  send(msg: ClientMsg): void {
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN && this.status === 'online') {
      ws.send(encodeMsg(msg) as string);
      return;
    }
    if (msg.t !== 'input' && msg.t !== 'fire' && msg.t !== 'ping') this.queue.push(msg);
  }

  /** Call a server RPC (`<area>.<name>`, typed by RpcMap). Rejects on error or after 10 s. */
  rpc<K extends RpcId>(id: K, data: RpcReq<K>): Promise<RpcRes<K>> {
    const rid = ++this.rid;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rpcs.delete(rid);
        reject(new Error(`rpc ${id} timed out`));
      }, 10000);
      this.rpcs.set(rid, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.send({ t: 'rpc', id, data, rid });
    });
  }

  ping(): void {
    this.send({ t: 'ping', t0: nowSec() });
  }

  /** Estimated room time now. */
  serverTime(): number {
    return this.clock.now(nowSec());
  }

  get rtt(): number {
    return this.clock.rtt;
  }

  quickplay(mode: string, map?: string): void {
    this.send({ t: 'quickplay', mode, map });
  }
  joinRoom(roomId: string): void {
    this.send({ t: 'joinRoom', roomId });
  }
  leaveRoom(): void {
    this.send({ t: 'leaveRoom' });
  }

  /** Remember a display name for the next hello and set it now. */
  async setName(name: string): Promise<void> {
    lsSet(NAME_KEY, name);
    this.profile = await this.rpc('core.setName', { name });
  }
}

/** The game socket on this page's own origin: `wss://` on https, `ws://` otherwise; never a fixed host. */
export function socketUrl(loc: { protocol: string; host: string }): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}${WS_PATH}`;
}

export const net = new Net();

// ---------------------------------------------------------------------------------------------
// One room session
// ---------------------------------------------------------------------------------------------

export class MatchNet {
  readonly world;
  readonly predictor;
  readonly interp = new SnapshotBuffer();
  /** Latest authoritative state of the local player. */
  me: MeSnap | null = null;
  lastSnap: ServerMsgOf<'snap'> | null = null;
  seq = 0;
  private outbox: InputCmd[] = [];
  private lastSend = 0;
  private offs: (() => void)[] = [];

  constructor(
    private net: Net,
    readonly joined: ServerMsgOf<'joined'>,
  ) {
    this.world = buildCollisionWorld(getMapData(joined.map));
    this.predictor = new Predictor(this.world);
    this.offs.push(
      net.on('snap', (m) => this.onSnap(m)),
      net.on('spawned', (m) => {
        const s: MoveState = { ...createMoveState(m.x, m.y, m.z), onGround: true };
        this.predictor.reset(s);
      }),
    );
  }

  get id(): string {
    return this.joined.you;
  }

  private onSnap(m: ServerMsgOf<'snap'>) {
    this.lastSnap = m;
    this.interp.push(m.time, m.players, nowSec());
    const me = m.me;
    this.me = me;
    if (me) this.predictor.reconcile(m.ack, me.move, me.params, me.alive);
  }

  /**
   * Record this frame's input: predicted at once, sent with the next batch. Long frames are
   * split into commands of at most MAX_CMD_DT. Returns the last seq.
   */
  input(buttons: number, yaw: number, pitch: number, weaponSlot: number, dt: number): number {
    const alive = this.me?.alive ?? false;
    let left = Math.min(dt, 0.25);
    const qy = quantizeAngle(yaw);
    const qp = quantizeAngle(pitch);
    while (left > 1e-5) {
      const d = Math.min(MAX_CMD_DT, left);
      left -= d;
      const cmd: InputCmd = { seq: ++this.seq, dt: d, buttons, yaw: qy, pitch: qp, weaponSlot };
      this.predictor.apply(cmd, alive);
      this.outbox.push(cmd);
    }
    return this.seq;
  }

  /** Send the batch if a 60 Hz slot has passed (or it is getting big). Call every frame. */
  flush(force = false): void {
    if (!this.outbox.length) return;
    const now = nowSec();
    if (!force && now - this.lastSend < 1 / 60 && this.outbox.length < 32) return;
    this.lastSend = now;
    while (this.outbox.length) this.net.send({ t: 'input', cmds: this.outbox.splice(0, 64) });
  }

  /** Room time remote players are drawn at now. */
  renderTime(): number {
    return this.interp.renderTime(nowSec());
  }

  /** Send a trigger pull (call after `input` for this frame, so `seq` covers it). */
  fire(origin: [number, number, number], dir: [number, number, number], shot: number): void {
    this.flush(true);
    this.net.send({ t: 'fire', seq: this.seq, time: this.renderTime(), origin, dir, shot });
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs = [];
  }
}
