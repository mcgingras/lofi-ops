/**
 * The game server: HTTP (static client in prod, /api/health, /api/rooms) + WebSocket on /ws.
 * `startServer` is what index.ts runs and what integration tests start in-process.
 */
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { DEFAULT_PORT, PROTOCOL_VERSION, WS_PATH } from '../shared/constants';
import { DEFAULT_LOADOUTS } from '../shared/loadout';
import { decodeClientMsg, isInputCmd, isNum, isStr, isVec3Tuple, type ClientMsg } from '../shared/protocol';
import { registerWeaponBehavior } from './combat';
import type { Feature, ServerApi } from './feature';
import { FEATURES } from './features/index';
import { Lobby, LobbyError } from './lobby';
import { registerMode } from './modes/index';
import type { RoomOptions } from './room';
import { RpcError, RpcRegistry } from './rpc';
import { Session } from './session';
import { cleanName, Store } from './store';

export interface ServerOptions {
  /** 0 = random free port. Default PORT env or 8787. */
  port?: number;
  host?: string;
  /** SQLite path; ':memory:' for tests. Default data/lofi.db. */
  dbPath?: string;
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

export async function startServer(opts: ServerOptions = {}): Promise<GameServer> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const store = new Store(opts.dbPath ?? 'data/lofi.db');
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
  const http = createServer((req, res) => handleHttp(req, res, lobby, staticDir));
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  http.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== WS_PATH) {
      socket.destroy();
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
      store.save(session.profile);
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

  await new Promise<void>((res) => http.listen(opts.port ?? Number(process.env.PORT ?? DEFAULT_PORT), opts.host ?? '0.0.0.0', res));
  const addr = http.address();
  const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? DEFAULT_PORT);
  log(`[server] listening on :${port}${staticDir ? ` (serving ${staticDir})` : ''}`);

  return {
    port,
    url: `ws://127.0.0.1:${port}${WS_PATH}`,
    lobby,
    store,
    rpc,
    api,
    sessions,
    async close() {
      lobby.shutdown();
      for (const s of sessions.values()) store.save(s.profile);
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((res) => wss.close(() => res()));
      await new Promise<void>((res) => http.close(() => res()));
      store.close();
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

function handleHttp(req: IncomingMessage, res: ServerResponse, lobby: Lobby, staticDir: string | null) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/api/health') return json(res, { ok: true, rooms: lobby.rooms.size });
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

function json(res: ServerResponse, body: unknown) {
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}
