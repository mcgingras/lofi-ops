/**
 * Graceful shutdown for the server process (DESIGN.md section 10). Fly sends SIGINT (our
 * fly.toml sets kill_signal) and waits kill_timeout seconds; Docker sends SIGTERM. Either way:
 * stop new joins, save every profile, close sockets, exit well inside 10 s. A second signal or
 * the hard deadline forces the exit.
 */

export interface Closable {
  close(): Promise<void>;
}

export interface ShutdownOptions {
  /** Hard deadline before `exit(1)` (default 8000 ms, under Fly's 10 s kill timeout). */
  timeoutMs?: number;
  signals?: readonly NodeJS.Signals[];
  log?: (msg: string) => void;
  exit?: (code: number) => void;
  /** Where to listen for signals (default `process`; tests pass an EventEmitter). */
  target?: Pick<NodeJS.EventEmitter, 'on' | 'off'>;
}

export const SHUTDOWN_TIMEOUT_MS = 8000;

/**
 * Wire signal handlers that run `server.close()` once. Returns `{ shutdown, dispose }`:
 * `shutdown(reason)` triggers the same path programmatically, `dispose()` removes the handlers.
 */
export function installGracefulShutdown(server: Closable, opts: ShutdownOptions = {}) {
  const timeoutMs = opts.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;
  const signals = opts.signals ?? (['SIGINT', 'SIGTERM'] as const);
  const log = opts.log ?? ((m: string) => console.log(m));
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const target = opts.target ?? process;
  let running: Promise<void> | null = null;

  function shutdown(reason: string): Promise<void> {
    if (running) {
      log(`[server] ${reason} again: forcing exit`);
      exit(1);
      return running;
    }
    log(`[server] ${reason}: draining (saving profiles, closing sockets)`);
    const started = Date.now();
    const deadline = setTimeout(() => {
      log(`[server] shutdown exceeded ${timeoutMs} ms: forcing exit`);
      exit(1);
    }, timeoutMs);
    deadline.unref?.();
    running = server.close().then(
      () => {
        clearTimeout(deadline);
        log(`[server] shut down cleanly in ${Date.now() - started} ms`);
        exit(0);
      },
      (err: unknown) => {
        clearTimeout(deadline);
        log(`[server] shutdown failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        exit(1);
      },
    );
    return running;
  }

  const handlers = signals.map((sig) => {
    const fn = () => void shutdown(sig);
    target.on(sig, fn);
    return [sig, fn] as const;
  });

  return {
    shutdown,
    dispose() {
      for (const [sig, fn] of handlers) target.off(sig, fn);
    },
  };
}
