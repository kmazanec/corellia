---
type: adr
title: "ADR-045: The factory's deployment path — GHCR published images, a standalone deploy overlay, and an SSH deploy script"
description: F-66 shipped the daemon image and a local compose stack but no path from a commit to a running remote factory. This ADR fixes that path: CI builds and pushes pinned images to GHCR; a standalone compose.deploy.yaml runs a source-less host straight from a published tag; scripts/deploy.sh drives an SSH pull-drain-recreate-verify deploy with rollback; state is pinned to host volumes/mounts and secrets to a host .env (ADR-012). Kubernetes, PaaS, and host-side builds are rejected.
tags: [adr, deploy, ops, ghcr, ci, docker, compose, lifecycle, rollback, adr-012, adr-026]
timestamp: 2026-07-06T00:00:00-05:00
---

# ADR-045: The factory's deployment path

**Status:** Accepted · **Date:** 2026-07-06 · **Stretch:** no · **Contract:** no
**Relates to:** ADR-026 (hosted front door / SIGTERM preservation), ADR-012
(secrets via environment)

## Context

The factory must run **in the cloud, unattended** — a long-lived, stateful,
secret-bearing daemon operated with no human in the loop per step. F-66 delivered
the *image* and a *local* run story (`Dockerfile`, `compose.yaml`, the
`container.md` build→up→smoke→down loop), but the deployment path stopped there.
There was no `.dockerignore`, no operator scripts, no CI→registry build, no
published-image deploy to a remote host, and no documented lifecycle for the
concerns a remote deploy introduces: state persistence and backup, host secrets
provisioning, restart/upgrade/rollback, how the target repo arrives on a
source-less host, and basic observability.

"The image builds" is not "the factory is deployable." The gap is the whole path
from a merged commit to a running, restartable, upgradeable, rollback-able daemon
with its state and secrets in place. See the issue
[`deploy-the-factory-end-to-end`](../issues/deploy-the-factory-end-to-end.md).

## Decision

Complete the path with four pieces, plus a runbook ([`deploy.md`](../deploy.md)).

1. **Delivery: pinned images to GHCR.** `.github/workflows/build-image.yml` runs
   `npm test` (this is also the repo's first CI), then builds the Dockerfile
   `runtime` target with buildx + GitHub Actions layer caching and pushes to
   `ghcr.io/<owner>/corellia`. Tags: `latest` (main only), `sha-<short>` (every
   push — the immutable, pinnable ref), and semver on `v*` tags. Auth is the
   workflow's own `GITHUB_TOKEN` with `packages: write`; pull requests build to
   validate but never push. A **known-good artifact** reaches the registry; hosts
   pull it rather than rebuild.

2. **Published-image stack: a standalone `compose.deploy.yaml`.** It mirrors
   `compose.yaml` but the daemon has `image: ${CORELLIA_IMAGE}` instead of
   `build:`, so a host with no source runs the factory straight from a pinned
   GHCR tag. It is a **standalone file, not a merge overlay** — see Alternatives.

3. **Deploy: `scripts/deploy.sh`, host-agnostic over SSH.** Strict-mode bash,
   shellcheck-clean. Given `DEPLOY_HOST` and a tag it copies the compose file if
   absent, confirms the host `.env` exists, pulls the pinned image, and recreates
   the stack with `docker compose up -d` — which SIGTERMs the old daemon so it
   **preserves in-flight worktrees before exiting** (ADR-026 preserve-don't-await),
   then verifies `GET /status` returns 200 using the host-side bearer token.
   `--rollback <tag>` runs the identical flow against a prior tag.

4. **State pinned to the host; secrets in a host `.env`.** The event log lives in
   the named Docker volume `corellia-pgdata` (Postgres) — surviving container
   replacement — or a mounted JSONL file; the target repo is cloned on the host
   and bind-mounted, so its worktrees are durable there. Every secret arrives via
   compose `env_file:` from a host-side `.env` provisioned out-of-band (scp),
   never baked into the image or committed (ADR-012). Backup/restore, rotation,
   and rollback are documented in `deploy.md`.

Operators also get `package.json` targets (`docker:build|up|down|logs`,
`docker:up:dev-db`) that encode the `-f compose.yaml` selection so the Compose-v2
file-shadowing rule is never a footgun, and a `.dockerignore` that scopes the
build context (excludes `.git`, `node_modules`, `out`, `media`, `docs`, `.env*`
except `.env.example`, `.claude`, `.corellia`) so no secret or bulky artifact can
enter an image layer even under a future `COPY . .`.

## Alternatives considered

- **Kubernetes.** Overkill for a single long-lived daemon plus one Postgres. It
  buys orchestration this workload does not need and adds a control plane, a
  state-management story, and operational surface no unattended single-operator
  factory should carry. Rejected.

- **A PaaS (Fly.io / Render / Railway).** Fast to stand up, but hides the state
  story — the very thing this issue is about. The factory's memory is the event
  log plus on-disk worktrees; a platform that abstracts volumes and filesystems
  makes "where does state live, how do I back it up, does it survive a redeploy"
  harder to answer, not easier. A plain Docker host with a named volume and a
  bind-mount keeps state explicit and portable. Rejected.

- **Building on the host.** Simplest to wire (ship source, `docker compose build`
  remotely), but there is then no known-good artifact: every host builds its own
  image from whatever source it happens to have, rollback means rebuilding an old
  commit, and the host needs the full toolchain and source checkout. A pinned,
  immutable GHCR tag is the thing you deploy, roll back to, and reason about.
  Rejected in favor of registry-published images.

- **A merge overlay on `compose.yaml` (instead of a standalone deploy file).**
  The tempting DRY option. Rejected because compose merges `build:` and `image:`
  **additively** — an overlay can *add* `image:` but cannot *remove* the base
  `build:` block, so a source-less host would still attempt a build and fail. A
  standalone `compose.deploy.yaml` is unambiguous: no `build:` key exists in the
  file the remote host uses. The small duplication is worth the clarity, and the
  two files are short enough to keep in sync by inspection.

## Consequences

- **A commit is now deployable end-to-end.** Push to main → CI publishes a pinned
  image → `scripts/deploy.sh sha-<short>` runs it on any Docker host, verified by
  `/status`. Rollback is `--rollback <prior-tag>`.
- **State and secrets are explicit and portable** — a named volume, a host clone,
  a host `.env` — with documented backup/restore and rotation. No platform hides
  them.
- **Deploys never abandon in-flight work** — the recreate drains SIGTERM per
  ADR-026.
- **Two compose files to keep in sync.** `compose.yaml` (local build) and
  `compose.deploy.yaml` (published image) share everything but the daemon's
  `build:`/`image:` line. Accepted; kept short and reconciled by inspection.
- **The runtime image still carries devDeps and runs via `tsx`** (F-66's v1
  constraint, unchanged here) and **target repos still run inside the image**
  (Node/TS only in v1). Both are documented; neither is this ADR's scope.
- **Live proof is pending.** The GHCR push and the clean-host deploy are validated
  by inspection here (no CI run, no VPS in this change); the operator closes the
  loop with a real push + deploy, tracked on the issue as
  fixed-pending-live-proof.
