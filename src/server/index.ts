/**
 * Server entry. `npm run dev` runs it under tsx watch (Vite serves the client and proxies /ws);
 * `npm start` runs it with --prod, serving the built client from dist/client on the same port.
 */
import { resolve } from 'node:path';
import { startServer } from './app';

const prod = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';

const server = await startServer({
  staticDir: prod ? resolve(import.meta.dirname, '../../dist/client') : null,
  dbPath: process.env.LOFI_DB ?? 'data/lofi.db',
});

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
