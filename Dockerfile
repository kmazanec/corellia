# syntax=docker/dockerfile:1
# ──────────────────────────────────────────────────────────────────────────────
# Corellia daemon — multi-stage image
#
# Build notes (F-66):
#   This project has no `build` / `tsc` emit step in package.json; `npm run
#   typecheck` runs `tsc --noEmit` (type-check only, no dist/ output). Therefore
#   the runtime stage runs the daemon via `tsx`, NOT from a compiled dist/.
#   This is consistent with the development invocation documented in daemon.ts:
#     npx tsx src/daemon/daemon.ts
#   The builder stage still runs `npm run typecheck` so the image build fails
#   fast on type errors.
#
#   If a future iteration adds a real `build` script that emits dist/, switch
#   the ENTRYPOINT to `node dist/src/daemon/daemon.js` and copy `dist/` only.
#
# node_modules strategy:
#   tsx is a devDependency but IS the runtime runner. Rather than cherry-pick
#   tsx + esbuild out of devDeps, we copy the full node_modules from the builder
#   stage. The runtime image therefore contains devDeps; this is acceptable for
#   v1. If image size becomes a concern, promote tsx to dependencies or add a
#   tsc emit step and switch to node.
#
# Runtime note:
#   `git` is installed in the runtime stage because the engine creates and
#   operates git worktrees inside the mounted target repo.
#
# Target-repo toolchain constraint (v1 limitation — documented per spec):
#   Scripts declared in a target repo's package.json are executed INSIDE this
#   container. The image includes Node + npm, so only Node/TypeScript target
#   repos are supported in v1. Target repos that require Python, Ruby, Go, or
#   any other runtime will fail when their declared scripts are run. Document
#   this to operators and mount a suitably-tooled image for other stacks.
# ──────────────────────────────────────────────────────────────────────────────

# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Copy manifests first for layer-cache efficiency.
COPY package.json package-lock.json ./

# Install ALL dependencies (devDeps needed for tsx + tsc typecheck).
RUN npm ci

# Copy source and config.
COPY tsconfig.json ./
COPY src/ ./src/

# Type-check only (no emit — the project has no tsc build step).
# This gate catches type errors at image-build time.
RUN npm run typecheck

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

# git is required: the engine creates and operates git worktrees in target repos.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package.json for npm scripts availability at runtime.
COPY package.json package-lock.json ./

# Bring the full node_modules from the builder (includes tsx which is the
# runtime runner — it is a devDep but required at runtime).
COPY --from=builder /app/node_modules ./node_modules

# Copy source (tsx runs it directly — no dist/ exists).
COPY --from=builder /app/src/ ./src/
COPY tsconfig.json ./

# Run as a non-root user.
RUN groupadd --gid 1001 corellia \
    && useradd --uid 1001 --gid corellia --shell /bin/bash --create-home corellia

# Ensure the out/ dir exists for JSONL fallback (writable by the app user).
RUN mkdir -p /app/out && chown -R corellia:corellia /app/out

USER corellia

# The daemon listens on 8080 by default (FRONT_DOOR_PORT overrides).
EXPOSE 8080

ENTRYPOINT ["node", "node_modules/.bin/tsx", "src/daemon/daemon.ts"]
