// `npm run dev`: the game server (tsx watch, restarts on change) and the Vite client dev server
// together. Vite proxies /ws to the server. Ctrl+C stops both.
import { spawn } from 'node:child_process';

const procs = [
  ['server', 'npx', ['tsx', 'watch', '--clear-screen=false', 'src/server/index.ts']],
  ['client', 'npx', ['vite']],
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: 'inherit', env: process.env });
  p.on('exit', (code) => {
    console.log(`[dev] ${name} exited (${code})`);
    shutdown(code ?? 0);
  });
  return p;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) if (p.exitCode === null) p.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
