/**
 * Runtime configuration from the environment (DESIGN.md section 10). Pure apart from
 * `readPackageVersion`, so it is unit-tested with plain env objects.
 *
 *   PORT       listen port (default 8080)
 *   HOST       bind address (default 0.0.0.0)
 *   DATA_DIR   persistent data directory (default ./data); the SQLite file is DATA_DIR/lofi.db
 *   LOFI_DB    explicit SQLite path (overrides DATA_DIR; ':memory:' works)
 *   GIT_SHA    optional build id appended to the reported version (Docker build arg)
 *   NODE_ENV=production or --prod: serve the built client from dist/client
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_PORT } from '../../../shared/constants';

export const DEFAULT_HOST = '0.0.0.0';
export const DEFAULT_DATA_DIR = './data';
export const DB_FILE = 'lofi.db';

export type Env = Record<string, string | undefined>;

export interface RuntimeConfig {
  port: number;
  host: string;
  dataDir: string;
  dbPath: string;
  prod: boolean;
}

/** PORT env as a valid TCP port, else the default (8080). `0` is allowed (random port). */
export function resolvePort(env: Env): number {
  const raw = env.PORT?.trim();
  if (!raw) return DEFAULT_PORT;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : DEFAULT_PORT;
}

export function resolveDataDir(env: Env): string {
  return env.DATA_DIR?.trim() || DEFAULT_DATA_DIR;
}

/** LOFI_DB wins (tests, one-off paths); otherwise DATA_DIR/lofi.db. */
export function resolveDbPath(env: Env): string {
  const explicit = env.LOFI_DB?.trim();
  if (explicit) return explicit;
  return join(resolveDataDir(env), DB_FILE);
}

export function resolveConfig(env: Env = process.env, argv: readonly string[] = process.argv): RuntimeConfig {
  return {
    port: resolvePort(env),
    host: env.HOST?.trim() || DEFAULT_HOST,
    dataDir: resolveDataDir(env),
    dbPath: resolveDbPath(env),
    prod: argv.includes('--prod') || env.NODE_ENV === 'production',
  };
}

/** `<package.json version>[+<sha7>]`, e.g. `0.1.0+1a2b3c4`. */
export function formatVersion(pkgVersion: string, sha?: string): string {
  const s = sha?.trim().slice(0, 7);
  return s ? `${pkgVersion}+${s}` : pkgVersion;
}

let cachedVersion: string | null = null;

/** The app version reported by /healthz (package.json next to the repo root, plus GIT_SHA). */
export function appVersion(env: Env = process.env): string {
  if (cachedVersion !== null) return cachedVersion;
  let pkg = '0.0.0';
  try {
    const file = resolve(import.meta.dirname, '../../../../package.json');
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown };
    if (typeof parsed.version === 'string') pkg = parsed.version;
  } catch {
    /* no package.json at runtime: keep 0.0.0 */
  }
  cachedVersion = formatVersion(pkg, env.GIT_SHA);
  return cachedVersion;
}
