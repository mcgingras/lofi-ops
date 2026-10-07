/**
 * Deploy area: env config, /healthz, graceful shutdown (unit), the same through the real server
 * over sockets, and the real process entry (src/server/index.ts) answering /healthz and exiting
 * cleanly on SIGTERM with its SQLite file under DATA_DIR.
 */
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type GameServer } from '../src/server/app';
import { formatVersion, healthReport, installGracefulShutdown, resolveConfig, resolveDbPath, resolvePort } from '../src/server/features/deploy/index';
import { Store } from '../src/server/store';
import { FakeClient, sleep } from './fake-client';

const ROOT = resolve(import.meta.dirname, '..');

describe('deploy config', () => {
  it('PORT defaults to 8080 and accepts a valid override', () => {
    expect(resolvePort({})).toBe(8080);
    expect(resolvePort({ PORT: '' })).toBe(8080);
    expect(resolvePort({ PORT: '3000' })).toBe(3000);
    expect(resolvePort({ PORT: '0' })).toBe(0);
    expect(resolvePort({ PORT: 'abc' })).toBe(8080);
    expect(resolvePort({ PORT: '70000' })).toBe(8080);
  });

  it('SQLite lives under DATA_DIR unless LOFI_DB overrides it', () => {
    expect(resolveDbPath({})).toBe(join('./data', 'lofi.db'));
    expect(resolveDbPath({ DATA_DIR: '/data' })).toBe('/data/lofi.db');
    expect(resolveDbPath({ DATA_DIR: '/data', LOFI_DB: '/tmp/x.db' })).toBe('/tmp/x.db');
    expect(resolveDbPath({ LOFI_DB: ':memory:' })).toBe(':memory:');
  });

  it('binds 0.0.0.0 and detects prod from --prod or NODE_ENV', () => {
    const dev = resolveConfig({}, ['node', 'index.ts']);
    expect(dev).toMatchObject({ host: '0.0.0.0', port: 8080, prod: false, dataDir: './data' });
    expect(resolveConfig({}, ['node', 'index.ts', '--prod']).prod).toBe(true);
    expect(resolveConfig({ NODE_ENV: 'production', HOST: '127.0.0.1' }, []).host).toBe('127.0.0.1');
    expect(resolveConfig({ NODE_ENV: 'production' }, []).prod).toBe(true);
  });

  it('formats the version with an optional short sha', () => {
    expect(formatVersion('0.1.0')).toBe('0.1.0');
    expect(formatVersion('0.1.0', '1a2b3c4d5e6f')).toBe('0.1.0+1a2b3c4');
    expect(formatVersion('0.1.0', '  ')).toBe('0.1.0');
  });
});

describe('health report', () => {
  const room = (bots: number, closed = false) => ({ closed, bots: () => new Array(bots).fill(0) });

  it('counts open rooms, sessions and bots', () => {
    const rooms = new Map([
      ['a', room(3)],
      ['b', room(0)],
      ['c', room(5, true)],
    ]);
    const r = healthReport({ rooms, sessions: 4, version: '1.0.0', startedAt: 1000, draining: false, now: 6400 });
    expect(r).toEqual({ ok: true, rooms: 2, players: 4, bots: 3, version: '1.0.0', uptimeSec: 5, draining: false });
  });

  it('is not ok while draining', () => {
    const r = healthReport({ rooms: new Map(), sessions: 0, version: 'x', startedAt: 0, draining: true, now: 0 });
    expect(r.ok).toBe(false);
    expect(r.draining).toBe(true);
  });
});

describe('graceful shutdown wiring', () => {
  it('closes once on a signal and exits 0', async () => {
    const target = new EventEmitter();
    const codes: number[] = [];
    let closes = 0;
    const sd = installGracefulShutdown({ close: async () => void closes++ }, { target, exit: (c) => codes.push(c), log: () => {} });
    target.emit('SIGTERM');
    await sleep(10);
    expect(closes).toBe(1);
    expect(codes).toEqual([0]);
    sd.dispose();
    expect(target.listenerCount('SIGINT')).toBe(0);
    expect(target.listenerCount('SIGTERM')).toBe(0);
  });

  it('a second signal forces exit(1); a hung close hits the deadline', async () => {
    const target = new EventEmitter();
    const codes: number[] = [];
    const sd = installGracefulShutdown({ close: () => new Promise<void>(() => {}) }, { target, exit: (c) => codes.push(c), log: () => {}, timeoutMs: 50 });
    target.emit('SIGINT');
    target.emit('SIGINT');
    expect(codes).toEqual([1]);
    await sleep(80);
    expect(codes).toEqual([1, 1]);
    sd.dispose();
  });

  it('a failing close exits 1', async () => {
    const codes: number[] = [];
    const sd = installGracefulShutdown({ close: async () => Promise.reject(new Error('boom')) }, { target: new EventEmitter(), exit: (c) => codes.push(c), log: () => {} });
    await sd.shutdown('test');
    expect(codes).toEqual([1]);
    sd.dispose();
  });
});

describe('server: /healthz and graceful close (real sockets)', () => {
  let server: GameServer | null = null;
  let dir: string | null = null;
  afterEach(async () => {
    await server?.close();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('GET /healthz and /api/health report rooms, players and version', async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {}, version: '9.9.9-test', quickPlayDefaults: { botFill: 0 } });
    const base = `http://127.0.0.1:${server.port}`;
    let res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ ok: true, rooms: 0, players: 0, version: '9.9.9-test', draining: false });

    const { client } = await FakeClient.connect(server.url, 'Healthy');
    client.send({ t: 'quickplay', mode: 'tdm', map: 'yard' });
    await client.waitFor('joined');
    res = await fetch(`${base}/api/health`);
    expect(await res.json()).toMatchObject({ ok: true, rooms: 1, players: 1, version: '9.9.9-test' });
    const head = await fetch(`${base}/healthz`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    client.close();
  });

  it('close() stops joins, saves profiles, closes sockets with 1012 and finishes fast', async () => {
    dir = mkdtempSync(join(tmpdir(), 'lofi-deploy-'));
    const dbPath = join(dir, 'lofi.db');
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath, staticDir: null, log: () => {}, quickPlayDefaults: { botFill: 0 } });
    const s = server;
    const { client: a, welcome } = await FakeClient.connect(s.url, 'Saver');
    const { client: b } = await FakeClient.connect(s.url, 'Lurker');
    a.send({ t: 'quickplay', mode: 'tdm', map: 'yard' });
    await a.waitFor('joined');

    // Unsaved in-memory progress that only the shutdown path persists.
    const live = [...s.sessions.values()].find((x) => x.profile.id === welcome.profile.id)!;
    live.profile.codPoints = 4242;
    live.profile.stats.kills = 17;

    const codes = new Map<FakeClient, number>();
    for (const c of [a, b]) c.ws.on('close', (code) => codes.set(c, code));

    const t0 = Date.now();
    const closing = s.close();
    expect(s.draining).toBe(true);
    expect(s.health()).toMatchObject({ ok: false, draining: true });
    await closing;
    server = null;
    expect(Date.now() - t0).toBeLessThan(3000);
    await sleep(20);
    expect(codes.get(a)).toBe(1012);
    expect(codes.get(b)).toBe(1012);
    expect(a.all('feat').some((m) => m.id === 'core.notice')).toBe(true);
    expect(s.lobby.rooms.size).toBe(0);

    const store = new Store(dbPath);
    const saved = store.load(welcome.profile.id);
    store.close();
    expect(saved?.codPoints).toBe(4242);
    expect(saved?.stats.kills).toBe(17);
  });

  it('refuses new joins while draining', async () => {
    server = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', staticDir: null, log: () => {}, quickPlayDefaults: { botFill: 0 } });
    const s = server;
    const { client } = await FakeClient.connect(s.url, 'Late');
    // Hold the close handshake open long enough to observe the quickplay refusal.
    const closing = s.close();
    client.send({ t: 'quickplay', mode: 'tdm' });
    await closing;
    server = null;
    expect(client.all('joined')).toHaveLength(0);
    expect(s.lobby.rooms.size).toBe(0);
  });
});

describe('process entry (src/server/index.ts)', () => {
  it('serves /healthz on PORT with DATA_DIR and exits 0 on SIGTERM within 10 s', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lofi-proc-'));
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: dir, NODE_ENV: 'test' };
      delete env.LOFI_DB;
      const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      child.stderr.on('data', (d: Buffer) => (out += d.toString()));
      const exited = new Promise<number | null>((res) => child.on('exit', (code) => res(code)));

      const port = await new Promise<number>((res, rej) => {
        const timer = setTimeout(() => rej(new Error(`server did not start:\n${out}`)), 15000);
        const check = () => {
          const m = /listening on :(\d+)/.exec(out);
          if (m) {
            clearTimeout(timer);
            res(Number(m[1]));
          }
        };
        child.stdout.on('data', check);
        check();
      });
      const health = (await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()) as Record<string, unknown>;
      expect(health).toMatchObject({ ok: true, rooms: 0, players: 0 });
      expect(typeof health.version).toBe('string');

      const { client } = await FakeClient.connect(`ws://127.0.0.1:${port}/ws`, 'Proc');
      client.send({ t: 'quickplay', mode: 'tdm', map: 'yard' });
      await client.waitFor('joined');
      const closed = new Promise<number>((res) => client.ws.on('close', (code) => res(code)));

      const t0 = Date.now();
      child.kill('SIGTERM');
      const code = await exited;
      expect(code).toBe(0);
      expect(Date.now() - t0).toBeLessThan(10000);
      expect(await closed).toBe(1012);
      expect(existsSync(join(dir, 'lofi.db'))).toBe(true);
      expect(out).toContain('shut down cleanly');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
