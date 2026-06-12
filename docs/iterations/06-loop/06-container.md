---
id: F-66
title: "Container packaging"
iteration: 06-loop
type: implement
intent: production
status: Not started
dependsOn: [F-62]
contracts: [ADR-026, ADR-012]
stack: docker
---

# Feature: Container packaging

**ID:** F-66 · **Iteration:** 06-loop · **Status:** Not started

## What this delivers (before → after)
**Before:** the daemon exists only as a local node process; nothing is
container-ready.
**After:** `docker compose up` brings up daemon + Postgres; the webhook answers
on a published port; config is environment-only.

Per ADR-026: container-ready ships this iteration; actual cloud deployment is
deliberately deferred.

## Reading brief
- ADR-026 (daemon entrypoint; Postgres substrate; deployment-deferred decision)
- ADR-012 (credentials from environment; no baked secrets)
- The F-62 daemon entrypoint (path TBD by F-62 builder — confirm before chunk 1)
- `src/substrate/pg-event-store.ts` — table creation SQL; connection-string
  constructor
- `package.json` scripts — `test`, `typecheck`, `live:eyes`, `live:hands`

## Dependencies (must exist before this starts)
F-62 (daemon entrypoint) must be shipped; this feature wraps it. No other hard
deps.

## Contracts touched
- Daemon config surface (source of truth: ADR-026, `src/contract/brief.ts`) —
  consumes `StandingEnvelope`; all config via environment, no new contract shapes
  introduced.
- ADR-012 (secrets via environment) — extended to the container surface: secrets
  arrive only via `env_file` or host environment injection, never baked into the
  image or committed.

## Acceptance criteria
1. A multi-stage Dockerfile on a slim Node base (`node:22-slim` or equivalent)
   builds the daemon; the image runs the daemon entrypoint as a non-root user;
   `git` is present in the runtime stage (worktrees need it).
2. `docker compose up` brings up `daemon` + `postgres` services with a named
   data volume; schema migration runs on boot (the Pg store's `CREATE TABLE IF
   NOT EXISTS` path); a healthcheck hits `GET /status` with the bearer token and
   expects HTTP 200.
3. All config is via environment: `FRONT_DOOR_TOKEN`, `DATABASE_URL`,
   `GITHUB_TOKEN`, `PORT`, and envelope settings (`ENVELOPE_BUDGET_USD`,
   `ENVELOPE_CEILING_USD`); no config files are baked into the image; secrets
   are injected via `env_file` (an `.env.example` with all required keys is
   committed; the actual `.env` file is gitignored).
4. Smoke: a trivial goal commissioned through the published webhook against a
   volume-mounted target repo returns a report; the smoke script is checked in
   at `scripts/smoke-container.ts` and its evidence (report JSON, cost line)
   is recorded in build notes.

## Testing requirements
The smoke script (`scripts/smoke-container.ts`) is operator-run, not CI. It
requires Docker running locally and the env_file populated with real tokens.
A CI-safe `docker build` lint (`docker build --check` or a `--target builder`
dry-run) is optional and may be added if the builder finds it low-friction;
name explicitly in build notes what is and is not CI-gated. The vitest suite
itself is not run inside the container (the image does not install devDependencies
in the runtime stage).

## Manual setup required
- Docker (Desktop or Engine) running locally.
- An `.env` file at project root with `FRONT_DOOR_TOKEN`, `DATABASE_URL`,
  `GITHUB_TOKEN`, and envelope vars populated.
- A volume-mounted target repo path for the smoke run (the smoke script documents
  the mount path convention).

## Build plan (approved)
- [ ] Chunk 1 — Dockerfile: multi-stage; builder stage installs all deps and
  builds (`npm ci && npm run typecheck`); runtime stage copies `dist/` + prod
  `node_modules`; adds `git`; runs as non-root; ENTRYPOINT is the daemon; satisfies
  AC 1; tests: `docker build` succeeds locally (not CI-gated); contract touchpoint:
  none.
- [ ] Chunk 2 — Compose + migrate-on-boot + healthcheck: `compose.yaml` with
  `daemon` + `postgres` services, named volume, `DATABASE_URL` wired to postgres
  service, healthcheck on `GET /status`; verify migration fires on cold start;
  satisfies AC 2; tests: `docker compose up` + `docker compose ps` manual
  verification; contract touchpoint: `FrontDoorStatus` (healthcheck endpoint shape).
- [ ] Chunk 3 — Env-only config hardening + `.env.example` + docs: confirm no
  config file is baked; add `.env.example` listing every required key; add `.env`
  to `.gitignore` if not already present; brief `docs/container.md` (operator
  runbook: build → up → smoke → down); satisfies AC 3; tests: `grep -r
  'FRONT_DOOR_TOKEN\|GITHUB_TOKEN' Dockerfile compose.yaml` finds no literal
  values; contract touchpoint: ADR-012 compliance.
- [ ] Chunk 4 — Smoke script + build notes: `scripts/smoke-container.ts`
  commissions a trivial `write-prd` goal via `POST /intents`, polls `GET /status`
  until emitted, prints the report and cost; evidence recorded in
  `docs/prototype-build-notes.md`; satisfies AC 4; tests: operator-run only;
  contract touchpoint: `POST /intents` wire shape (ADR-026).

### Test strategy
The smoke script is the primary evidence artifact. Chunks 1–3 have no
automated CI gates beyond the normal vitest suite (which tests source, not the
image). `docker build` and `docker compose up` are operator-verified per chunk.

### Contract touchpoints
ADR-012: no secret may appear in the image, the compose file, or any tracked file
other than `.env.example` (which contains only placeholder values). ADR-026: the
daemon entrypoint is the authority; the Dockerfile must not hard-code its path —
read it from `package.json` or the F-62 builder's confirmed location.

### Manual setup
Documented in chunk 3's runbook. The builder must document the target-repo volume
mount constraint honestly: scripts declared in the target repo's `package.json`
run INSIDE the container, so the target repo's toolchain (node, npm, any language
runtime) must be present in the image or in the volume mount. For v1 the constraint
is: the target repo must be a Node/TypeScript project (the image includes Node).
Document this limitation explicitly.

### Risks
- Image size: a slim base + git + node prod deps may still be large; use
  `--no-install-recommends` for apt packages and multi-stage to exclude devDeps.
- Secret hygiene in compose: `env_file:` is the safe path; `environment:` with
  literal values in `compose.yaml` is not acceptable — lint in chunk 3.
- Target repo toolchain constraint (see manual setup above) — document, don't
  silently fail.

## Implementation notes

**dist vs tsx — the image runs `tsx`.** `package.json` has no `build`/`tsc`-emit
script; `typecheck` is `tsc --noEmit`, so no `dist/` is ever produced. The
runtime stage therefore runs the daemon via tsx — `ENTRYPOINT ["node",
"node_modules/.bin/tsx", "src/daemon/daemon.ts"]` — matching the dev invocation
documented in `src/daemon/daemon.ts`. The builder stage still runs
`npm run typecheck` so the image build fails fast on type errors. The full
`node_modules` (incl. devDep `tsx` + its esbuild) is copied from the builder to
the runtime stage rather than cherry-picking tsx. If a future iteration adds a
`build` step, flip the ENTRYPOINT to `node dist/src/daemon/daemon.js` and copy
`dist/` only.

**Migrate-on-boot.** No separate migration job. `daemon.ts` calls
`store.ensureSchema()` at startup when `DATABASE_URL` is set, which runs the Pg
store's idempotent `CREATE TABLE IF NOT EXISTS corellia_events (...)` plus its
two indexes (`src/substrate/pg-event-store.ts`). In compose, the `postgres`
service's `pg_isready` healthcheck gates the daemon's `depends_on:
{ condition: service_healthy }`, so the cold-boot migration never races an
unready database.

**Healthcheck.** The daemon service healthcheck runs a tiny `node -e` `fetch`
against `GET /status` with the bearer token and exits non-zero unless the status
is exactly 200. The token is read from the container's own
`process.env.FRONT_DOOR_TOKEN` (`$$`-escaped in compose so it is not
interpolated at parse time) — never written into the file.

**Env-only config / secret hygiene (ADR-012).** All config arrives via
`env_file: [.env]` for both services; there are no `environment:` secret
literals and nothing baked into the image. `.env` is already gitignored.
`grep -r 'FRONT_DOOR_TOKEN\|GITHUB_TOKEN' Dockerfile compose.yaml` returns only
env-var-NAME references (comments + the healthcheck's `process.env` read), no
assigned values. `.env.example` carries every required key with placeholder
values only.

**Target-repo toolchain constraint (v1, documented honestly).** Scripts declared
in a target repo's `package.json` execute INSIDE this container. The image ships
Node + npm only, so v1 supports **Node/TypeScript target repos only**; other
runtimes (Python/Ruby/Go/…) require extending the image. Stated explicitly in
`docs/container.md` and `.env.example`.

**Smoke script.** `scripts/smoke-container.ts` is operator-run (not CI):
`POST /intents` a trivial `write-prd`, poll `GET /status` until the intent
leaves running/queued/parked, then best-effort read the emitted report + cost
from a host-readable JSONL log (`CORELLIA_EVENTS_PATH`) via the existing
`costSummary` projection — otherwise it points the operator at the Postgres
event store. It is covered by `npm run typecheck` (chunk 4 added `scripts` to
the tsconfig `include`). Honesty note: the shipped daemon wires a null engine,
so the smoke run proves the webhook + admission + status surface; a real
converged report requires the live-engine entrypoint (F-67).

**Validation status:** `npm run typecheck` PASS (now incl. the smoke script);
`docker build --target builder` PASSED locally (typecheck green); `docker
compose config` validated (exit 0). Full `docker compose up` + the smoke run are
operator-verified, not CI-gated.