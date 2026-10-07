# Feature area: deploy

This branch makes the server match DESIGN.md section 10 (Fly.io, scale to zero) and adds what's needed to ship it: a Dockerfile, `fly.toml`, CI and a runbook. Nothing has been deployed and no cloud resources were created. Step-by-step instructions are in `docs/DEPLOY.md`.

## What was built

- **Env config** (`src/server/features/deploy/config.ts`):
  - `PORT` defaults to 8080.
  - The server binds `HOST`, default `0.0.0.0`.
  - The SQLite file is `DATA_DIR/lofi.db`, with `DATA_DIR` defaulting to `./data`. `LOFI_DB` still overrides it.
  - `GIT_SHA` is appended to the reported version.
- **Health** (`health.ts`): `GET /healthz` returns `{ok, rooms, players, bots, version, uptimeSec, draining}` with `cache-control: no-store`. `/api/health` is an alias. During shutdown it returns 503 with `ok: false`.
- **Graceful shutdown**:
  - `shutdown.ts` handles SIGINT/SIGTERM. It calls `server.close()` once. A second signal, or 8 s passing, forces an exit.
  - `GameServer.close()` in `app.ts`:
    1. Sets `draining`. From then on, upgrades get a 503 and every client message is ignored; `quickplay` and `joinRoom` get `error {code: 'server_restarting'}`.
    2. Pushes `core.notice` "Server restarting..." to every session.
    3. Runs `lobby.shutdown()`.
    4. Saves each live profile once.
    5. Closes sockets with code 1012 (1 s grace, then terminate).
    6. Closes the HTTP server, including keep-alive connections, then the store.
  - The socket `close` handler no longer saves to a store that is already closed.
- **Client waking UX** (`src/client/net.ts`):
  - `socketUrl(location)` is exported (`wss` on https).
  - A first handshake slower than 1.5 s switches the status to `waking`, so the menu shows "Waking server...". Fly holds the upgrade while a stopped machine boots.
  - A handshake still hanging after 15 s is closed and retried. Before this, a hung connect stayed stuck in `connecting` forever.
  - The existing backoff retry covers the 1012 close sent during a deploy.
- **Shipping**:
  - `Dockerfile`: three stages on `node:24-slim` (build, prod deps, runtime). The runtime image has no dev deps and runs `node --import tsx`. It has a Docker `HEALTHCHECK` and is about 400 MB.
  - `.dockerignore`, `fly.toml` (validated with `fly config validate`), `.github/workflows/ci.yml` and `scripts/smoke.ts`.

## Verified locally

- `docker build`, then `docker run -p 8080:8080`:
  - `/healthz` returned 200.
  - The page loaded in the browser pane, and Quick Play TDM rendered the Yard with HUD and viewmodel.
  - `scripts/smoke.ts` joined a match over the socket.
- `docker stop` logged "shut down cleanly in 16 ms" and exited 0.
- The open browser tab showed "Waking server... (retrying)". After `docker start` it reconnected with the same guest profile, read back from `/data`.
- The container, its volume and the image were removed afterwards.

## Tests

- `tests/deploy.test.ts`:
  - Unit tests for the config, the health report and the shutdown wiring (fake signal target and exit).
  - Integration tests against the real server: `/healthz` and `/api/health` counts, and that `close()` saves unsaved profile changes to a temp SQLite file, closes clients with 1012, sends the notice and empties the lobby. Joins are refused while draining.
  - A process-level test that spawns `src/server/index.ts` with `PORT=0` and `DATA_DIR=<tmp>`, joins over the socket, sends SIGTERM, and checks for exit code 0 within 10 s, a 1012 close and that `lofi.db` exists in `DATA_DIR`.
- `tests/deploy-net.client.test.ts`: `socketUrl`, and the waking, hung-handshake and reconnect-after-drain state machine with a fake WebSocket and fake timers.

## Core files touched (minimal)

- `src/server/app.ts`: `/healthz`, draining, graceful `close()`, `draining` and `health()` on `GameServer`, defaults from deploy config, and a listen error that rejects instead of hanging.
- `src/server/index.ts`: uses `resolveConfig()` and `installGracefulShutdown()`.
- `src/shared/constants.ts`: `DEFAULT_PORT` changed from 8787 to 8080.
- `vite.config.ts`: the dev proxy default changed from 8787 to 8080.
- `src/client/net.ts`: the waking timer, the connect timeout and the `socketUrl` export.
- `docs/CONTRACTS.md` (port and env line) and `README.md` (dev port).

## Integration notes for other areas

- **Everyone**: the dev server is now on **:8080**, not :8787. `npm run dev` and the Vite proxy agree, and `PORT` still overrides both.
- **Bots / frontend**: `/healthz` reports `bots` alongside `players` (connected humans). If rooms full of bots push memory, raise the Fly VM to 1 GB (`fly scale memory 1024`). On shutdown, rooms close through `room.close()`, so bots are removed with `playerLeave {reason: 'closed'}`. Don't schedule anything that outlives the room.
- **Frontend**: you may want a nicer screen for `error {code: 'server_restarting'}` and for the `core.notice` "Server restarting...". The menus already show the `waking` status from `net.onStatus`.
- **Progression / economy**: profiles are saved on shutdown, but a match in progress gets no `matchEnd`, so match XP and CP are not awarded for it. Anything you only write at `matchEnd` is lost when a deploy interrupts a match. Save immediately (`api.store.save`) for anything that must survive.
- **Persistence**: there is a single SQLite file on a single volume, so the app must stay at one machine (`fly deploy --ha=false`). Don't add a second persistence path outside `DATA_DIR`.
- **New runtime dependencies** must go in `dependencies` (the runtime image uses `npm ci --omit=dev`). Server code must not import from `src/client` or anything else outside `src/server` and `src/shared`, because the runtime image contains only those plus `dist/client`.
