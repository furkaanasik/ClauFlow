# Plan: Docker Distribution

## Summary
Package ClauFlow's core (Express/SQLite) and gui (Next.js) services into multi-arch Docker images published to GHCR on every `v*.*.*` tag, plus a root `docker-compose.yml` so users can run the full stack with `docker compose up` and no Node install.

## User Story
As a user who wants to run ClauFlow,
I want to type `docker compose up`,
So that the full stack starts without installing Node.js, pnpm, or any dev tooling.

## Problem → Solution
Currently requires Node 24 + npm + pnpm installed locally → Docker images on GHCR, `docker compose up` starts everything.

## Metadata
- **Complexity**: Medium
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 7

---

## UX Design

### Before
```
user installs Node 24, npm, pnpm
cd core && npm ci && npm run build
cd gui && pnpm install && pnpm build
cd core && npm start  (port 3001)
cd gui && pnpm start  (port 3000)
```

### After
```
docker compose up
# → core running on :3001
# → gui  running on :3000
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Install | Node + npm + pnpm required | Docker only | |
| Start | 2 terminals, 2 commands | 1 command | |
| Data | core/data/ on host | named volume `clauflow_data` | SQLite persisted |
| Upgrade | pull + rebuild | `docker compose pull && up` | |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `core/src/index.ts` | 1-30 | PORT/HOST env vars, startup |
| P0 | `core/src/services/taskService.ts` | 27-37 | DATA_DIR = `process.cwd()/data` → must be volume |
| P0 | `gui/src/lib/api.ts` | 1-5 | NEXT_PUBLIC_API_BASE default |
| P0 | `gui/src/hooks/useAgentSocket.ts` | 13 | NEXT_PUBLIC_WS_URL default |
| P0 | `.github/workflows/release.yml` | all | Existing v*.*.* trigger pattern to mirror |
| P1 | `.github/workflows/ci.yml` | all | node 24 + pnpm 9 convention |
| P1 | `gui/next.config.ts` | all | Needs `output: 'standalone'` added |
| P1 | `core/package.json` | all | `npm start` = `node dist/index.js` |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| GH Actions multi-arch | docker/build-push-action docs | Use `platforms: linux/amd64,linux/arm64` with QEMU |
| Next.js standalone | nextjs.org/docs/deployment | `output: 'standalone'` copies only used node_modules |
| GHCR auth | docs.github.com | Login with `${{ secrets.GITHUB_TOKEN }}`, registry `ghcr.io` |

---

## Patterns to Mirror

### WORKFLOW_TRIGGER
```yaml
# SOURCE: .github/workflows/release.yml:3-5
on:
  push:
    tags:
      - "v*.*.*"
```

### WORKFLOW_CHECKOUT
```yaml
# SOURCE: .github/workflows/ci.yml:18-19
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: 24
```

### WORKFLOW_PNPM
```yaml
# SOURCE: .github/workflows/ci.yml:28-30
- uses: pnpm/action-setup@v4
  with:
    version: 9
```

### CORE_ENV_VARS
```typescript
// SOURCE: core/src/index.ts:18-19
const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "127.0.0.1";
```
In container HOST must be `0.0.0.0` — set via ENV in Dockerfile or compose.

### DATA_DIR_PATTERN
```typescript
// SOURCE: core/src/services/taskService.ts:27-28
const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "tasks.db");
```
`cwd` in container = `/app` (WORKDIR). Volume must mount at `/app/data`.

### GUI_ENV_DEFAULTS
```typescript
// SOURCE: gui/src/lib/api.ts:3-4
const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001/api";
// SOURCE: gui/src/hooks/useAgentSocket.ts:13
url ?? process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001/ws";
```
Defaults work for `docker compose up` on localhost since core is exposed on host:3001.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `gui/next.config.ts` | UPDATE | Add `output: 'standalone'` for efficient Docker image |
| `core/Dockerfile` | CREATE | Multi-stage: tsc build → alpine runner |
| `gui/Dockerfile` | CREATE | Multi-stage: pnpm build (standalone) → alpine runner |
| `docker-compose.yml` | CREATE | Root compose: core + gui, volume, port mapping |
| `.github/workflows/docker.yml` | CREATE | Multi-arch build+push on v*.*.* |
| `core/.dockerignore` | CREATE | Exclude node_modules, data, dist from context |
| `gui/.dockerignore` | CREATE | Exclude node_modules, .next from context |

## NOT Building
- Helm chart / Kubernetes manifests
- docker-compose.override.yml for dev mode
- Hot-reload / volume-mounted source in compose
- Pushing on every commit to master (tags only)
- Separate staging/prod images

---

## Step-by-Step Tasks

### Task 1: Add `output: 'standalone'` to GUI next config
- **ACTION**: Update `gui/next.config.ts`
- **IMPLEMENT**:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
};

export default nextConfig;
```
- **MIRROR**: N/A — simple config addition
- **IMPORTS**: None
- **GOTCHA**: `standalone` copies only referenced node_modules. The runner stage uses `server.js` not `next start`. Do not use `pnpm start` in the Dockerfile runner stage.
- **VALIDATE**: `cd gui && pnpm build` → `.next/standalone/` directory created

### Task 2: Create `core/.dockerignore`
- **ACTION**: CREATE `core/.dockerignore`
- **IMPLEMENT**:
```
node_modules
dist
data
*.db
.env*
```
- **MIRROR**: Standard Node.js dockerignore
- **GOTCHA**: Excluding `data/` keeps SQLite off image; it lives in a volume
- **VALIDATE**: File exists, `data` and `node_modules` listed

### Task 3: Create `gui/.dockerignore`
- **ACTION**: CREATE `gui/.dockerignore`
- **IMPLEMENT**:
```
node_modules
.next
.env*
```
- **MIRROR**: Standard Next.js dockerignore
- **VALIDATE**: File exists

### Task 4: Create `core/Dockerfile`
- **ACTION**: CREATE `core/Dockerfile`
- **IMPLEMENT**:
```dockerfile
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/index.js"]
```
- **MIRROR**: CORE_ENV_VARS pattern — HOST must be 0.0.0.0
- **GOTCHA**: `HOST=127.0.0.1` (default) makes server unreachable inside container. `npm ci --omit=dev` skips tsx/typescript/types. `data/` directory is NOT in image — Docker volume handles it.
- **VALIDATE**: `docker build ./core -t clauflow-core:local` succeeds; `docker run --rm -e HOST=0.0.0.0 -p 3001:3001 clauflow-core:local` starts without error

### Task 5: Create `gui/Dockerfile`
- **ACTION**: CREATE `gui/Dockerfile`
- **IMPLEMENT**:
```dockerfile
FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_BASE=http://localhost:3001/api
ARG NEXT_PUBLIC_WS_URL=ws://localhost:3001/ws
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
RUN pnpm build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```
- **MIRROR**: WORKFLOW_PNPM — pnpm 9 via corepack; GUI_ENV_DEFAULTS for build args
- **GOTCHA**: `NEXT_PUBLIC_*` vars are baked at build time, not runtime — ARG must be set before `pnpm build`. Standalone runner uses `node server.js` not `pnpm start`. `public/` must be copied separately alongside standalone.
- **VALIDATE**: `docker build ./gui -t clauflow-gui:local` succeeds; `.next/standalone/` exists at build stage

### Task 6: Create `docker-compose.yml` at root
- **ACTION**: CREATE `docker-compose.yml`
- **IMPLEMENT**:
```yaml
services:
  core:
    build:
      context: ./core
    image: ghcr.io/furkaanasik/clauflow/core:latest
    ports:
      - "3001:3001"
    volumes:
      - clauflow_data:/app/data
    environment:
      HOST: "0.0.0.0"
      PORT: "3001"
    restart: unless-stopped

  gui:
    build:
      context: ./gui
      args:
        NEXT_PUBLIC_API_BASE: "http://localhost:3001/api"
        NEXT_PUBLIC_WS_URL: "ws://localhost:3001/ws"
    image: ghcr.io/furkaanasik/clauflow/gui:latest
    ports:
      - "3000:3000"
    depends_on:
      - core
    environment:
      PORT: "3000"
    restart: unless-stopped

volumes:
  clauflow_data:
```
- **MIRROR**: DATA_DIR_PATTERN — volume mounts at `/app/data` matching `process.cwd()/data`
- **GOTCHA**: `NEXT_PUBLIC_*` in compose `environment:` have NO effect (baked at build). Only `build.args` matters. Defaults point to localhost:3001 which works because core is exposed on host port 3001.
- **VALIDATE**: `docker compose config` shows both services; `docker compose build` completes

### Task 7: Create `.github/workflows/docker.yml`
- **ACTION**: CREATE `.github/workflows/docker.yml`
- **IMPLEMENT**:
```yaml
name: Docker

on:
  push:
    tags:
      - "v*.*.*"

jobs:
  build-push:
    name: Build & push multi-arch images
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Docker metadata (core)
        id: meta-core
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/furkaanasik/clauflow/core
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest

      - name: Build and push core
        uses: docker/build-push-action@v6
        with:
          context: ./core
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta-core.outputs.tags }}
          labels: ${{ steps.meta-core.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Docker metadata (gui)
        id: meta-gui
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/furkaanasik/clauflow/gui
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest

      - name: Build and push gui
        uses: docker/build-push-action@v6
        with:
          context: ./gui
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta-gui.outputs.tags }}
          labels: ${{ steps.meta-gui.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```
- **MIRROR**: WORKFLOW_TRIGGER (v*.*.* pattern from release.yml); `packages: write` for GHCR
- **GOTCHA**: `GITHUB_TOKEN` has `packages: write` permission automatically on GHCR for the same repo owner. QEMU must be set up before Buildx for arm64 emulation. GHA cache (`type=gha`) speeds up repeat builds significantly.
- **VALIDATE**: Workflow appears in GitHub Actions tab after push; triggers on a `v*.*.*` tag

---

## Testing Strategy

### Unit Tests
No unit tests — this is infra/config only.

### Edge Cases Checklist
- [ ] `docker compose up` on a machine with no Node → both services start
- [ ] Data persists after `docker compose restart core` (SQLite volume)
- [ ] `docker compose pull && docker compose up` after new release → updated images used
- [ ] ARM64 image runs on Apple Silicon / Raspberry Pi

---

## Validation Commands

### Static Analysis
```bash
# Typecheck gui after next.config.ts change
cd gui && pnpm typecheck
```
EXPECT: Zero type errors

### Docker build (local smoke test)
```bash
docker build ./core -t clauflow-core:local
docker build ./gui -t clauflow-gui:local
```
EXPECT: Both images build without error

### Compose smoke test
```bash
docker compose build
docker compose up -d
curl http://localhost:3001/health
curl http://localhost:3000
docker compose down
```
EXPECT: `/health` returns `{"ok":true,...}`; GUI responds 200

### Verify volume persistence
```bash
docker compose up -d
# create a project via UI or API
docker compose restart core
# project still exists → SQLite volume working
docker compose down -v   # cleanup
```

### Manual Validation
- [ ] `docker compose up` starts both services
- [ ] GUI loads at http://localhost:3000
- [ ] Core health at http://localhost:3001/health returns `{"ok":true}`
- [ ] Create a project/task via GUI → persists after `docker compose restart core`
- [ ] WebSocket agent logs stream in UI during task execution

---

## Acceptance Criteria
- [ ] `docker compose up` starts core + gui with no Node install
- [ ] Multi-arch images (amd64 + arm64) pushed to GHCR on `v*.*.*` tag
- [ ] SQLite data persists in named Docker volume across restarts
- [ ] GUI typecheck passes after next.config.ts change
- [ ] No regressions in CI (existing workflows unaffected)

## Completion Checklist
- [ ] `gui/next.config.ts` has `output: 'standalone'`
- [ ] `core/Dockerfile` multi-stage, HOST=0.0.0.0
- [ ] `gui/Dockerfile` multi-stage, pnpm via corepack, standalone runner
- [ ] `docker-compose.yml` at root with named volume
- [ ] `.github/workflows/docker.yml` with QEMU + Buildx + GHCR push
- [ ] `core/.dockerignore` and `gui/.dockerignore` exclude node_modules/data
- [ ] `docker compose build` succeeds locally

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ARM64 build slow in CI | High | Low (just time) | GHA cache + QEMU emulation; acceptable for release-only workflow |
| `output: standalone` breaks existing dev | Low | Medium | Only affects build output; `pnpm dev` unaffected |
| Claude CLI not in container | Certain | N/A | By design — executor runs claude CLI on host, not in Docker |
| NEXT_PUBLIC vars baked at wrong values | Medium | High | docker-compose.yml sets build args explicitly; documented in README |

## Notes
- Claude CLI (`claude`) is invoked by the executor on the **host** filesystem, not inside the container. Docker does not need claude CLI installed. The container just runs the Express API and Next.js app.
- The GUI `NEXT_PUBLIC_API_BASE` defaults to `http://localhost:3001/api` which works for docker compose on localhost. Remote deployments need `--build-arg NEXT_PUBLIC_API_BASE=https://api.example.com` at build time.
- Images tagged as `ghcr.io/furkaanasik/clauflow/core` and `ghcr.io/furkaanasik/clauflow/gui` (two separate images, not a monorepo image).
