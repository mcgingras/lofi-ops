# Deploying Lo-Fi Ops (Fly.io)

One Fly machine runs one Node process. It serves the built client, the WebSocket (`/ws`) and the HTTP API (`/healthz`, `/api/rooms`) on port 8080. Profiles live in SQLite on a Fly volume mounted at `/data`. The machine stops when nobody is connected and starts again on the next request (scale to zero). DESIGN.md section 10 explains why.

| file | what it does |
|---|---|
| `Dockerfile` | multi-stage build on `node:24-slim`: stage 1 installs everything and runs `npm run build`; stage 2 installs production deps only (`ws`, `tsx`, `three`); the runtime stage copies `src/server`, `src/shared`, `dist/client` and runs `node --import tsx src/server/index.ts --prod`. |
| `.dockerignore` | keeps `.git`, `node_modules`, `dist`, `data`, `reference` and `.claude` out of the build context. |
| `fly.toml` | app `lofi-ops` (a placeholder), region `dfw`, `shared-cpu-1x` with 512 MB, volume `lofi_data` mounted at `/data`, health check on `/healthz`, scale to zero. |
| `.github/workflows/ci.yml` | typecheck, test and build on every push and PR, then builds the Docker image, runs `scripts/smoke.ts` against it and checks that it stops cleanly. |
| `scripts/smoke.ts` | checks `/healthz`, loads the page, and has a headless socket join a TDM match. Point it at any URL. |

## Runtime contract

| env | default | meaning |
|---|---|---|
| `PORT` | `8080` | listen port |
| `HOST` | `0.0.0.0` | bind address |
| `DATA_DIR` | `./data` (`/data` in the image) | the SQLite file is `DATA_DIR/lofi.db` |
| `LOFI_DB` | unset | explicit SQLite path; overrides `DATA_DIR` |
| `NODE_ENV` | `production` in the image | together with `--prod`, serves `dist/client` |
| `GIT_SHA` | build arg | appended to the version that `/healthz` reports |

- `GET /healthz` (alias `/api/health`) returns `200 {ok, rooms, players, bots, version, uptimeSec, draining}`. It returns 503 with `ok: false` while the server is shutting down.
- On SIGINT or SIGTERM the server drains. It refuses new sockets (503) and new joins, sends players a "Server restarting..." notice, closes rooms and saves every profile. It then closes sockets with code 1012 and exits, normally in well under a second. If draining takes more than 8 s, the process exits anyway. Fly sends `kill_signal = "SIGINT"` and waits `kill_timeout = "10s"`.
- The client builds the socket URL from `location` (`wss://` on https). If the first handshake takes longer than 1.5 s, the client shows "Waking server..." (a stopped machine is booting behind Fly's proxy). It drops a handshake that hangs for 15 s and reconnects with backoff after any drop, including a deploy.

## Local check (no Fly needed)

```sh
docker build --build-arg GIT_SHA=$(git rev-parse --short HEAD) -t lofi-ops .
docker run --rm --name lofi -p 8080:8080 -v lofi_data:/data lofi-ops
# in another shell:
curl -s localhost:8080/healthz                # {"ok":true,"rooms":0,...}
npx tsx scripts/smoke.ts http://127.0.0.1:8080
open http://localhost:8080                    # play
docker stop lofi                              # logs "shut down cleanly in N ms"; exit code 0
```

Without Docker: `npm run build && npm start` (same port and env).

## First deploy

Do this only after the owner has confirmed the app name. Fly app names are global, so `lofi-ops` may already be taken. If you pick another name, change `app` in `fly.toml`.

```sh
fly auth whoami                                   # logged in?
fly apps create lofi-ops                          # or your confirmed name
fly volumes create lofi_data --region dfw --size 1 --app lofi-ops   # 1 GB is plenty for SQLite
fly deploy --ha=false                             # one machine: the volume can attach to only one
fly status
curl -s https://lofi-ops.fly.dev/healthz
npx tsx scripts/smoke.ts https://lofi-ops.fly.dev
```

Notes:
- `--ha=false` keeps a single machine. The profile database is a file on one volume, so a second machine would have its own empty database. If one was created anyway, run `fly scale count 1`.
- The `[[vm]]` section asks for `shared-cpu-1x` with 512 MB. If rooms full of bots run hot, go to 1 GB with `fly scale memory 1024`.
- Custom domain (optional): `fly certs add play.example.com`, then point a CNAME at `lofi-ops.fly.dev`. Cloudflare can proxy it. Leave WebSockets enabled.

## Redeploy

```sh
npm run typecheck && npm test && npm run build    # CI runs the same
fly deploy --build-arg GIT_SHA=$(git rev-parse --short HEAD)
curl -s https://lofi-ops.fly.dev/healthz          # check "version"
```

A deploy replaces the machine. Players in a match see "Server restarting...", their profiles are saved, and their clients reconnect on their own once the new machine is up. Any match in progress is lost, so deploy when the server is quiet: `curl .../healthz` shows `players`.

## Operations

```sh
fly logs                                  # server log ("[server] ..." lines)
fly ssh console -C "ls -la /data"         # the SQLite file (lofi.db, plus -wal/-shm while running)
fly volumes snapshots list <volume-id>    # Fly snapshots volumes daily
fly machine stop / start                  # manual control; auto stop/start normally handles it
```

Backup by hand: `fly ssh sftp get /data/lofi.db ./lofi-backup.db` (run it while the server is idle, or stop the machine first).

Cold start: the first visitor after an idle stop waits a few seconds while the machine boots. The menu shows "Waking server... (retrying)" until the socket connects. To always have a machine warm, set `min_machines_running = 1` in `fly.toml`. That costs money even when nobody plays.
