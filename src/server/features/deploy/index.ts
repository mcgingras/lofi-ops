/**
 * Deploy area (owner: deploy). Not a room Feature (it is not listed in features/index.ts): these
 * are the process-level helpers app.ts and index.ts use to match DESIGN.md section 10 (Fly.io):
 * env config (PORT/HOST/DATA_DIR/LOFI_DB), the /healthz report and graceful shutdown.
 * See docs/DEPLOY.md and docs/features/deploy.md.
 */
export { appVersion, DB_FILE, DEFAULT_DATA_DIR, DEFAULT_HOST, formatVersion, resolveConfig, resolveDataDir, resolveDbPath, resolvePort, type Env, type RuntimeConfig } from './config';
export { HEALTH_PATHS, healthReport, type HealthReport, type HealthSource } from './health';
export { installGracefulShutdown, SHUTDOWN_TIMEOUT_MS, type Closable, type ShutdownOptions } from './shutdown';
