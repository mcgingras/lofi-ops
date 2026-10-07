/**
 * Server entry. `npm run dev` runs it under tsx watch (Vite serves the client and proxies /ws);
 * `npm start` (and the Docker image) runs it with --prod, serving the built client from
 * dist/client on the same port. Env: PORT (8080), HOST (0.0.0.0), DATA_DIR (./data) or LOFI_DB.
 * SIGINT/SIGTERM drain gracefully (features/deploy/shutdown.ts).
 */
import { resolve } from 'node:path';
import { startServer } from './app';
import { installGracefulShutdown, resolveConfig } from './features/deploy/index';

const config = resolveConfig();

const server = await startServer({
  port: config.port,
  host: config.host,
  staticDir: config.prod ? resolve(import.meta.dirname, '../../dist/client') : null,
  dbPath: config.dbPath,
});
console.log(`[server] data: ${config.dbPath}`);

installGracefulShutdown(server);
