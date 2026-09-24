# syntax=docker/dockerfile:1
# ──────────────────────────────────────────────────────────────────────────────
# Corellia control plane — the operator console's server plus its built SPA
# (ADR-050, ADR-051). Build from the REPO ROOT, since the server imports the
# factory's contract and projections:
#
#   docker build -f console/Dockerfile -t corellia-console .
#
# Like the factory image, it runs TypeScript through tsx (no emit step); tsx is
# a runtime dependency of the server workspace, so the runtime stage installs
# only that workspace's production dependencies. It needs no git and no target
# repo: the control plane only reads the shared Postgres and writes job rows.
#
# Runtime: FRONT_DOOR_TOKEN and DATABASE_URL (see console/server/src/main.ts);
# listens on CONSOLE_PORT (default 8090) and serves the SPA at /.
# ──────────────────────────────────────────────────────────────────────────────

# ── Stage 1: dependencies (root + both console workspaces) ────────────────────
FROM node:22-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY console/server/package.json ./console/server/
COPY console/web/package.json ./console/web/
RUN npm ci

# ── Stage 2: typecheck the server, build the SPA ──────────────────────────────
FROM deps AS build

COPY tsconfig.json ./
COPY src/ ./src/
COPY console/ ./console/

RUN npx tsc --noEmit -p console/server/tsconfig.build.json \
    && npm run build -w @corellia/console-web

# ── Stage 3: production dependencies of the server only ──────────────────────
FROM node:22-slim AS prod-deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY console/server/package.json ./console/server/
COPY console/web/package.json ./console/web/
RUN npm ci --omit=dev --workspace @corellia/console-server --include-workspace-root

# ── Stage 4: runtime ──────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json /app/tsconfig.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/src/ ./src/
COPY --from=build /app/console/server/ ./console/server/
COPY --from=build /app/console/web/dist/ ./console/web/dist/

RUN groupadd --gid 1001 corellia \
    && useradd --uid 1001 --gid corellia --shell /bin/bash --create-home corellia
USER corellia

EXPOSE 8090

ENTRYPOINT ["node", "node_modules/.bin/tsx", "console/server/src/main.ts"]
