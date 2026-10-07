# syntax=docker/dockerfile:1
# Lo-Fi Ops: one image = built client + game server (HTTP + WebSocket + /healthz) on $PORT.
# See docs/DEPLOY.md. Local check:
#   docker build -t lofi-ops . && docker run --rm -p 8080:8080 -v lofi_data:/data lofi-ops

ARG NODE_IMAGE=node:24-slim

# 1. Build: full install (dev deps for tsc/vite), typecheck + vite build -> dist/client.
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# 2. Runtime dependencies only (ws, tsx; no vite/vitest/typescript).
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# 3. Runtime: the server runs from TypeScript source under tsx's loader (no compile step to
#    drift from dev), serving dist/client from the build stage.
FROM ${NODE_IMAGE} AS runtime
ARG GIT_SHA=""
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    GIT_SHA=${GIT_SHA}
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.base.json tsconfig.json ./
COPY src/shared ./src/shared
COPY src/server ./src/server
COPY --from=build /app/dist/client ./dist/client
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# node is PID 1 and handles SIGINT/SIGTERM itself (graceful drain, exit < 10 s).
CMD ["node", "--import", "tsx", "src/server/index.ts", "--prod"]
