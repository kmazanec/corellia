---
id: F-67
title: "Assembly: the closed loop"
iteration: 06-loop
type: implement
intent: production
status: Shipped
dependsOn: [F-61, F-62, F-63, F-64, F-65, F-66]
contracts: [ADR-025, ADR-026, ADR-027]
---

# Feature: Assembly — the closed loop

**ID:** F-67 · **Iteration:** 06-loop · **Status:** Shipped

## What this delivers (before → after)
**Before:** six shipped features, unwired; the PRD's Desired Outcome unproven.
**After:** the composed factory — commission through the front door → tree → PR
on the target repo, improvement loop live — with AC-2 evidenced on corellia and
AC-3 on cats.

## Reading brief
- Every F-6x spec's implementation notes (read all six before writing a line)
- ADR-025 (brokered tools; process-clean gate; idempotence)
- ADR-026 (daemon contract; Brief freeze; SIGTERM posture)
- ADR-027 (improvement loop; standing envelope; one commission per run)
- `docs/PRD.md` §3 — Desired Outcome; AC-1, AC-2, AC-3, AC-21
- `examples/live-eyes.ts` + `examples/live-hands.ts` — live harness patterns
- `docs/prototype-build-notes.md` — iteration-05 carried debt; 4/5 cats result

## Dependencies (must exist before this starts)
F-61 (push_branch/open_pr tools), F-62 (daemon + Brief contract), F-63
(improvement loop routing + envelope), F-64 (economics), F-65 (debt sweep —
read-only roots, lint, capture), F-66 (container) must all be shipped.

## Contracts touched
- Brokered tools (source of truth: ADR-025, `src/contract/tool.ts`) — consumed;
  `push_branch`/`open_pr` wired end-to-end through the live assembly.
- Brief contract (source of truth: ADR-026, `src/contract/brief.ts`) — consumed;
  `POST /intents` is the live commission surface.
- Improvement loop (source of truth: ADR-027, `src/listener/listener.ts`) —
  consumed; seeded blocker in the scripted suite exercises the full routing path.

## Acceptance criteria
1. Scripted convergence, no network: a bare-repo origin fixture + injectable
   GitHub transport — commission → worktree → executed checks → push → PR →
   emitted report carrying `learned`; and the improvement path: a seeded blocker
   → `improve-factory` commission → factory-repo PR against a faked remote; the
   suite is green in CI.
2. Early checkpoint, before any deliver run: `live:foreign-eyes` retests cats
   under structured emission + F-64 economics; target 5/5 categories; the honest
   result — pass count and any failures — is recorded in build notes either way
   (cats blocked all five categories in iteration 04, pre-structured-emission;
   this is the de-risk gate before any deliver spend).
3. AC-2 live: a real corellia feature commissioned through the daemonized front
   door ends in a corellia PR; checks green; mergeable unmodified by the operator.
   Strange-loop hygiene pinned: the factory's primary checkout is undisturbed
   (worktree isolation); the impact graph's self-referential case is watched and
   its behavior recorded.
4. AC-3 live: the same on cats — the PR carries diff, proof artifacts, `learned`,
   and the factory has not merged it (AC-1/R13: structural, not policed).
5. The scripted convergence suite (AC 1) is green in CI; live runs are
   operator-run with evidence (PR URLs, costs, cache-hit share) in build notes.

## Testing requirements
The scripted convergence suite (`tests/integration/convergence-loop.test.ts`) is
this feature's primary CI artifact; it uses bare-repo fixtures, injectable
transport, and scripted brains — zero network. The `live:self` and `live:foreign`
harness scripts are operator-run with evidence captured in build notes. AC 2's
early checkpoint must complete and its result recorded before AC 3 or AC 4
spend is approved.

## Manual setup required
- `GITHUB_TOKEN` with `repo` scope for corellia and cats remotes.
- cats local checkout path (pass as env var or CLI arg to the live:foreign
  harness).
- Operator present for AC-2, AC-3, AC-4 live runs; daemon up via `docker compose`
  (F-66) for AC-3/AC-4.

## Build plan (approved)
- [ ] Chunk 1 — Full wiring/assembly through the front door: wire F-61's tools
  into the assembly via F-62's daemon; confirm the commission → tree → broker →
  push_branch → open_pr path compiles end-to-end with a scripted brain; no
  assertion yet — this is the integration-point prerequisite; satisfies AC 1
  precondition; tests: compilation + a single smoke test confirming no throw;
  contract touchpoint: `GRANT_TOOL_MAP` entries (ADR-025), `POST /intents`
  (ADR-026).
- [ ] Chunk 2 — Bare-remote + faked-transport convergence suite incl. improvement
  path: `tests/integration/convergence-loop.test.ts` — (a) commission → worktree
  → push → PR → report with `learned`; (b) seeded blocker → routing → envelope
  gate → `improve-factory` commission → factory-repo PR via faked transport;
  satisfies AC 1, 5; tests: the suite itself; contract touchpoint: all three ADRs.
- [ ] Chunk 3 — `live:foreign-eyes` early checkpoint harness: `examples/live-foreign-eyes.ts`
  runs cats comprehension under structured emission + economics (reuses F-64 cost
  projection); prints per-category pass/fail; operator runs before any deliver
  spend; result recorded in `docs/prototype-build-notes.md`; satisfies AC 2;
  tests: operator-run only; contract touchpoint: none.
- [ ] Chunk 4 — `live:self` deliver harness (corellia): `examples/live-self.ts`
  — commission a real corellia feature through the daemon; watch strange-loop
  isolation; record PR URL, cost, cache-hit share in build notes; satisfies AC 3;
  tests: operator-run only; contract touchpoint: ADR-025 (process-clean gate on
  own diff), ADR-026 (daemon live).
- [ ] Chunk 5 — `live:foreign` deliver harness (cats) + evidence + build notes:
  `examples/live-foreign.ts` — commission a cats feature; record PR URL, proof
  artifacts, `learned`, cost; confirm factory has not merged it; update
  `docs/prototype-build-notes.md` with full evidence for AC-4, AC-5; satisfies
  AC 4, 5; tests: operator-run only; contract touchpoint: ADR-027 (improvement
  commission if blockers present).

### Test strategy
Chunk 2's scripted suite is the CI gate — it must run without network, without
real GitHub, and without real LLM calls. Live chunks (3–5) are gated on the
operator's presence and recorded via build notes. AC 2's checkpoint (chunk 3)
is a hard stop before chunks 4–5: if cats blocks again, root-cause before
spending on the deliver runs.

### Contract touchpoints
All three ADRs are consumed here. No new contract shapes are introduced — this
feature assembles, it does not extend. If a seam is missing or an interface
doesn't fit, the fix belongs in the originating feature's implementation notes,
not here.

### Manual setup
Daemon up via `docker compose up` (F-66) for live runs. Both GITHUB_TOKEN and the
cats checkout path must be set before chunk 4 or chunk 5.

### Risks
- **Strange loop** (corellia building corellia): nested worktrees under the running
  factory's own repo; no scripted analogue exists; this is live-only evidence.
  Watch closely: the primary checkout must remain on `main` and undisturbed; the
  factory's `.claude/worktrees/` path must be excluded from the tree's scope.
  Record the exact isolation behavior in build notes.
- **cats comprehension quality**: the AC 2 early checkpoint exists precisely
  because cats blocked all five categories in iteration 04. Do not skip it.
  A bad retest result is recorded honestly and root-caused — it does not
  block the corellia live run (AC 3, which targets the factory's own repo).
- **Live cost**: F-64 economics land first (hard dep); the operator approves each
  live run's expected budget from the economics output before authorizing spend.
- **Improvement loop hot path**: the scripted suite's seeded-blocker path exercises
  the full loop but with a faked transport; first real improvement PR is a
  live-only event — record it in build notes if it fires during a live run.

## Implementation notes

### Live engine wiring — daemonized front door now delivers (AC-3)

`src/daemon/daemon.ts` wires `buildLiveEngine()` behind an env guard so the
containerized daemon delivers real commissions when keyed, while preserving the
keyless `docker compose up` smoke/healthcheck path (F-66).

**Env-guard behavior (implemented in `selectEngine()`):**
- `OPENROUTER_API_KEY` **present** → `buildLiveEngine()` is constructed with
  `store` (the daemon's substrate-selected store), `sandbox.repoRoot`
  (CORELLIA_REPO_ROOT, default cwd), and `repoSlug` derived via `deriveRepoSlug()`.
  The daemon logs: `[daemon] engine: live engine — commissions will be processed via OpenRouter`.
  AC-3 is satisfied: POSTing to the containerized daemon commissions a real tree.
- `OPENROUTER_API_KEY` **absent** → `buildNullEngine()` (stub that rejects every
  run). The daemon logs: `[daemon] engine: null engine — commissions will be rejected;
  set OPENROUTER_API_KEY to enable delivery`. The HTTP surface (healthcheck, /status)
  remains fully operational — no crash on cold boot without a key.

**Startup log behavior:** the selected engine mode is always logged at startup so
operators can confirm which path is active without inspecting env vars directly.

**Wire path (live mode):**
- `LlmBrain` via `openRouterConfig()` (OPENROUTER_API_KEY required at runtime).
- `starterTypes()` with `rebindKnowledgeScan()` for learn-goal architecture checks.
- `SandboxConfig.prBoundary` with `repoSlug` (from `deriveRepoSlug()`) when a
  GitHub remote is detected; omitted (no push_branch/open_pr) if no remote.
- `goldenCapture: true` for all live runs (ADR-024).
- The daemon's substrate-selected store (`buildStore()`) is shared between the
  Listener and the Engine — one event log for the whole process.

The improvement loop uses `buildStandingEnvelope()` from `src/daemon/config.ts`.
Operator-run harness scripts (`examples/live-*.ts`) continue to call
`buildLiveEngine()` directly and do not go through the daemon process.

### Process-clean gate: corrected target detection (security fix, post-review)

Commit 7a00439 introduced the target-aware gate but keyed the narrowing decision
on `goal.type === 'improve-factory'` — a proxy that is not enforced at runtime.
The concrete hole: `live-foreign.ts` builds an engine with `repoRoot = catsRoot`
and an `improve-factory` goal tree running on it would pass factory vocabulary
through the gate onto a foreign cats PR.

**Corrected approach (`PushBranchDeps.factoryRepoSlug`):**

The narrowing decision is now keyed on `repoSlug === factoryRepoSlug`:
- `repoSlug` (already in `PushBranchDeps`): the GitHub `owner/repo` slug of the
  push's declared PR target. Set at assembly time from `prBoundary.repoSlug`.
- `factoryRepoSlug` (new field): the `owner/repo` slug of the factory's own repo.
  Set only where the target genuinely IS the factory's own repo:
  - `examples/live-self.ts`: sets both to the corellia slug (derived from origin).
  - `examples/live-foreign.ts`: leaves `factoryRepoSlug` unset → full gate.
  - `src/daemon/daemon.ts`: reads `FACTORY_REPO_SLUG` env var; unset = full gate.

An improve-factory goal bound to a foreign engine (cats) still receives the full
gate because `repoSlug` (`acme/cats`) never equals `factoryRepoSlug` (unset or
`acme/corellia`). The security invariant is structural, not conventional.

The `goalid`/`treeid` patterns remain in `FOREIGN_REPO_ONLY_PATTERNS` (not
ALWAYS_DANGEROUS) because they would match TypeScript type names (GoalId, TreeId)
in factory source. On foreign pushes the full set catches them. On factory-own-repo
pushes only ALWAYS_DANGEROUS applies and factory type names are permitted. With
the corrected target detection, this placement is sound.

### Convergence suite fixtures (chunk 2)

`tests/integration/convergence-loop.test.ts` uses:
- `InMemoryEventStore` — real event log, no I/O.
- `ScriptedEngine` — returns Map-keyed reports; appends goal-received + emitted events.
- `makeTempRepo()` / `makeBareRepo()` / `makeWorktree()` — local git fixture; all
  git operations target absolute temp paths under `os.tmpdir()`. Zero network.
- `stubFetchTransport(prUrl)` — records calls, returns canned 201; never calls
  global fetch. Network isolation is structural (no URL starting with https:// or
  git@… is ever used in the git fixture helpers).
- `withToken()` / `afterEach(cleanups)` — env var pinning and cleanup.

Process-clean note: the path B end-to-end test uses `eval-harness.md` content
(not `test-skill.md` with `## improve-factory`) because `improve-factory` is in
`PROCESS_CLEAN_PATTERNS` and the gate correctly blocks it.

### Strange-loop isolation mechanism (live:self)

`examples/live-self.ts` documents and verifies the isolation:
1. Pre-run: `git status --porcelain` on the primary checkout must be clean (or
   operator warned). `git branch --show-current` records the branch.
2. The factory opens a worktree under `<corelliaRoot>/.claude/worktrees/<treeId>/`
   (gitignored via `.git/info/exclude`). The primary checkout's working tree is
   never modified.
3. `write_file` calls in the worktree are scoped to the declared feature scope;
   the scope gate (`diffWithinScope`) catches any out-of-scope writes before emit.
4. The process-clean gate (`scanDiffForProcessLanguage`) blocks any diff containing
   factory vocabulary (`corellia`, `improve-factory`, `tree/`, `build-plan`, etc.)
   before the branch is pushed. The gate is target-aware: it narrows to
   ALWAYS_DANGEROUS_PATTERNS (run-specific identifiers only) when the push's
   declared `repoSlug` equals the configured `factoryRepoSlug` — i.e., when the
   target genuinely IS the factory's own repo. `live:self` sets both to the
   corellia slug; `live:foreign` leaves `factoryRepoSlug` unset so the full gate
   applies. The daemon reads `FACTORY_REPO_SLUG` from the environment (unset =
   full gate for all pushes — safe default).
5. Post-run: `git status --porcelain` must still be clean; `git worktree list` shows
   only the primary checkout (the engine collects or preserves the tree worktree
   on completion, leaving no dangling worktree).

The primary checkout's branch is recorded before and after the run. Any divergence
is flagged as an isolation violation (should be impossible by construction).

