/**
 * The game server: HTTP (static client in prod, /healthz + /api/health, /api/rooms) + WebSocket
 * on /ws. `startServer` is what index.ts runs and what integration tests start in-process.
 * `close()` is the graceful shutdown (DESIGN.md section 10): refuse new joins, save every
 * profile, close sockets with 1012 so clients retry ("Waking server..."), then stop.
 */
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { PROTOCOL_VERSION, WS_PATH } from '../shared/constants';
import { DEFAULT_LOADOUTS } from '../shared/loadout';
import { decodeClientMsg, isInputCmd, isNum, isStr, isVec3Tuple, type ClientMsg } from '../shared/protocol';
import { registerWeaponBehavior } from './combat';
import type { Feature, ServerApi } from './feature';
import { appVersion, HEALTH_PATHS, healthReport, resolveDbPath, resolvePort, type HealthReport } from './features/deploy/index';
import { FEATURES } from './features/index';
import { Lobby, LobbyError } from './lobby';
import { registerMode } from './modes/index';
import type { RoomOptions } from './room';
import { RpcError, RpcRegistry } from './rpc';
import { Session } from './session';
import { cleanName, Store } from './store';

export interface ServerOptions {
  /** 0 = random free port. Default PORT env or 8080. */
  port?: number;
  /** Bind address. Default 0.0.0.0 (all interfaces; required on Fly). */
  host?: string;
  /** SQLite path; ':memory:' for tests. Default LOFI_DB env, else DATA_DIR/lofi.db (DATA_DIR default ./data). */
  dbPath?: string;
  /** Reported by /healthz. Default package.json version (+GIT_SHA). */
  version?: string;
  /** Directory of the built client to serve (prod). null = don't serve files. */
  staticDir?: string | null;
  /** Feature list (default: all of features/index.ts). */
  features?: Feature[];
  /** Run room tick loops on timers (default true). */
  autoTick?: boolean;
  /** Options merged into quick-play rooms (tests: botFill 0, countdownSec 0...). */
  quickPlayDefaults?: Partial<RoomOptions>;
  log?: (msg: string) => void;
}

export interface GameServer {
  port: number;
  url: string;
  lobby: Lobby;
  store: Store;
  rpc: RpcRegistry;
  api: ServerApi;
  sessions: Map<string, Session>;
  /** True once close() started: upgrades get 503, joins are refused. */
  readonly draining: boolean;
  health(): HealthReport;
  /** Graceful shutdown: stop joins, save profiles, close sockets (1012), stop listening. */
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

const HELLO_TIMEOUT_MS = 10_000;
/** How long close() waits for clients to finish the close handshake before terminating them. */
const SOCKET_CLOSE_GRACE_MS = 1000;

export async function startServer(opts: ServerOptions = {}): Promise<GameServer> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const store = new Store(opts.dbPath ?? resolveDbPath(process.env));
  const version = opts.version ?? appVersion();
  const startedAt = Date.now();
  let draining = false;
  let storeClosed = false;
  let closing: Promise<void> = Promise.resolve();
  const features = opts.features ?? FEATURES;
  const rpc = new RpcRegistry();
  const sessions = new Map<string, Session>();
  const lobby = new Lobby({ store, features, log, autoTick: opts.autoTick ?? true, quickPlayDefaults: opts.quickPlayDefaults });
  const api: ServerApi = { lobby, store, rpc, registerMode, registerWeaponBehavior, sessions: () => sessions.values(), log };

  registerCoreRpcs(rpc, store);
  for (const f of features) {
    try {
      f.setup?.(api);
    } catch (err) {
      log(`feature ${f.id} setup failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    }
  }

  const staticDir = opts.staticDir ? resolve(opts.staticDir) : null;
  const health = (): HealthReport => healthReport({ rooms: lobby.rooms, sessions: sessions.size, version, startedAt, draining });
  const http = createServer((req, res) => handleHttp(req, res, lobby, staticDir, health));
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  http.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== WS_PATH) {
      socket.destroy();
      return;
    }
    if (draining) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 2\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws));
  });

  function onConnection(ws: WebSocket) {
    let session: Session | null = null;
    const helloTimer = setTimeout(() => {
      if (!session) ws.close(4000, 'hello timeout');
    }, HELLO_TIMEOUT_MS);
    ws.on('message', (data, isBinary) => {
      const msg = decodeClientMsg(isBinary ? new Uint8Array(data as Buffer) : (data as Buffer).toString());
      if (!msg) return;
      if (draining) {
        if (session && (msg.t === 'quickplay' || msg.t === 'joinRoom')) session.send({ t: 'error', code: 'server_restarting', message: 'server is restarting' });
        return;
      }
      if (!session) {
        if (msg.t !== 'hello') return;
        clearTimeout(helloTimer);
        const auth = store.authenticate(isStr(msg.token, 128) ? msg.token : null, cleanName(msg.name));
        const { token } = auth;
        // One in-memory profile per account: a second tab with the same token shares the live
        // object, so saves from either connection never overwrite the other's progress or CP.
        let profile = auth.profile;
        for (const other of sessions.values()) if (other.profile.id === profile.id) profile = other.profile;
        session = new Session(randomUUID().slice(0, 12), ws, profile, token);
        sessions.set(session.id, session);
        session.send({ t: 'welcome', sessionId: session.id, token, profile, version: PROTOCOL_VERSION, defaultLoadouts: DEFAULT_LOADOUTS });
        return;
      }
      try {
        handleMessage(session, msg);
      } catch (err) {
        if (err instanceof LobbyError) session.send({ t: 'error', code: err.code, message: err.message });
        else {
          log(`message ${msg.t} failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
          session.send({ t: 'error', code: 'internal', message: 'internal error' });
        }
      }
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (!session) return;
      lobby.leave(session, 'disconnect');
      if (!storeClosed) store.save(session.profile);
      sessions.delete(session.id);
    });
    ws.on('error', () => ws.terminate());
  }

  function handleMessage(s: Session, msg: ClientMsg) {
    const room = s.room;
    const player = s.player;
    switch (msg.t) {
      case 'hello':
        return;
      case 'ping':
        if (isNum(msg.t0)) s.send({ t: 'pong', t0: msg.t0, time: room?.time ?? 0 });
        return;
      case 'quickplay':
        if (!isStr(msg.mode, 32) || (msg.map !== undefined && !isStr(msg.map, 32))) return;
        lobby.quickPlay(s, { mode: msg.mode, map: msg.map });
        return;
      case 'joinRoom':
        if (!isStr(msg.roomId, 64)) return;
        lobby.join(s, msg.roomId);
        return;
      case 'leaveRoom':
        lobby.leave(s, 'left');
        s.send({ t: 'left', reason: 'left' });
        return;
      case 'listRooms':
        s.send({ t: 'rooms', rooms: lobby.list({ mode: isStr(msg.mode, 32) ? msg.mode : undefined }) });
        return;
      case 'input':
        if (!room || !player || !Array.isArray(msg.cmds) || msg.cmds.length > 64) return;
        room.queueInputs(player, msg.cmds.filter(isInputCmd));
        return;
      case 'fire':
        if (!room || !player) return;
        if (!isNum(msg.seq) || !isNum(msg.time) || !isNum(msg.shot) || !isVec3Tuple(msg.origin) || !isVec3Tuple(msg.dir)) return;
        if (player.pendingFires.length < 32) player.pendingFires.push({ seq: msg.seq, time: msg.time, origin: msg.origin, dir: msg.dir, shot: msg.shot, receivedAt: room.time });
        return;
      case 'selectLoadout':
        if (!isNum(msg.index) || msg.index < 0 || msg.index >= s.profile.loadouts.length) return;
        s.profile.selectedLoadout = Math.floor(msg.index);
        return;
      case 'rpc':
        if (!isStr(msg.id, 64)) return;
        void rpc.dispatch({ session: s, room, player }, msg.id, msg.data, isNum(msg.rid) ? msg.rid : undefined);
        return;
    }
  }

  const listenPort = opts.port ?? resolvePort(process.env);
  await new Promise<void>((res, rej) => {
    http.once('error', rej);
    http.listen(listenPort, opts.host ?? '0.0.0.0', () => {
      http.off('error', rej);
      res();
    });
  });
  const addr = http.address();
  const port = typeof addr === 'object' && addr ? addr.port : listenPort;
  log(`[server] listening on :${port}${staticDir ? ` (serving ${staticDir})` : ''}`);

  return {
    port,
    url: `ws://127.0.0.1:${port}${WS_PATH}`,
    lobby,
    store,
    rpc,
    api,
    sessions,
    get draining() {
      return draining;
    },
    health,
    async close() {
      if (draining) return closing;
      draining = true;
      closing = (async () => {
        for (const s of sessions.values()) s.sendFeature('core.notice', { text: 'Server restarting...' });
        lobby.shutdown();
        const saved = new Set<string>();
        for (const s of sessions.values()) {
          if (saved.has(s.profile.id)) continue;
          saved.add(s.profile.id);
          try {
            store.save(s.profile);
          } catch (err) {
            log(`[server] saving profile ${s.profile.id} failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        // 1012 = service restart: the browser client treats it as a drop and retries (waking).
        const clients = [...wss.clients];
        await Promise.race([
          Promise.all(
            clients.map(
              (c) =>
                new Promise<void>((res) => {
                  if (c.readyState === c.CLOSED) return res();
                  c.once('close', () => res());
                  c.close(1012, 'server restarting');
                }),
            ),
          ),
          new Promise<void>((res) => setTimeout(res, SOCKET_CLOSE_GRACE_MS).unref()),
        ]);
        for (const c of wss.clients) c.terminate();
        await new Promise<void>((res) => wss.close(() => res()));
        http.closeAllConnections();
        await new Promise<void>((res) => http.close(() => res()));
        storeClosed = true;
        store.close();
        log(`[server] closed (${saved.size} profiles saved)`);
      })();
      return closing;
    },
  };
}

function registerCoreRpcs(rpc: RpcRegistry, store: Store) {
  rpc.handle('core.profile', (ctx) => ctx.session.profile);
  rpc.handle('core.setName', (ctx, data) => {
    const name = cleanName((data as { name?: unknown } | null)?.name);
    if (!name) throw new RpcError('bad_name', 'name must be 2-16 letters/numbers');
    ctx.session.profile.name = name;
    if (ctx.player) ctx.player.name = name;
    store.save(ctx.session.profile);
    ctx.room?.broadcastRoster();
    return ctx.session.profile;
  });
}

function handleHttp(req: IncomingMessage, res: ServerResponse, lobby: Lobby, staticDir: string | null, health: () => HealthReport) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (HEALTH_PATHS.has(url.pathname)) {
    const report = health();
    return json(res, report, report.ok ? 200 : 503, { 'cache-control': 'no-store' });
  }
  if (url.pathname === '/api/rooms') return json(res, { rooms: lobby.list({ mode: url.searchParams.get('mode') ?? undefined }) });
  if (!staticDir || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(404).end('not found');
    return;
  }
  let file = normalize(join(staticDir, decodeURIComponent(url.pathname)));
  if (!file.startsWith(staticDir)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    const index = join(file, 'index.html');
    file = existsSync(index) ? index : join(staticDir, 'index.html'); // SPA fallback
  }
  if (!existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600' });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

function json(res: ServerResponse, body: unknown, status = 200, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body));
}
