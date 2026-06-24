# Prototype build notes — factory-proto

The walking-skeleton prototype of the Corellia design (DESIGN.md, GOAL-TYPES.md),
built by the factory's own process: intent → gate brief → contract barrier →
parallel features in isolated worktrees → integration by cherry-pick → grouped
six-dimension review → repair rung → full suite once. This file is the durable
record of the decisions made autonomously during the build, per the
commissioner's instruction to proceed and document.

## What was built

| Module | What it is |
| --- | --- |
| `src/contract/` | the frozen shared shapes: Goal, Decision (`satisfy\|split\|block`), Report (the return streams), Verdict with prescriptions, FactoryEvent union, Budget (incl. `toolCalls`), Brain / EventStore / MemoryView / Registry interfaces |
| `src/engine/` | the single recursive operation: split gate, split eval with re-decide, dependency scheduler (contract children first), budget subdivision + four-dimension exhaustion, the control loop (deterministic → judge → repair → escalate → block), spawner-mediated memory promotion/reinforcement |
| `src/eventlog/` | in-memory + JSONL event stores; projections: memory as a read-model (provisional→trusted after 2 successes, decay after 2 failures), trace stats, run-tree rendering |
| `src/library/` | deterministic checks (incl. `filesWithinScope` with traversal protection, `processClean`), registry, 8 starter types, constitution lint |
| `src/brains/` | `ScriptedBrain` (deterministic, fail-then-pass sequencing) and `LlmBrain` (provider-agnostic OpenAI-compatible chat completions; memories quoted as data, never instructions; retries carry prior verdicts) |
| `examples/greeting.ts` | end-to-end demo: a commissioned intent splits into freeze-contract + two implements; one implement fails its critique, the repair rung fixes it; the assembled CLI runs |

207 tests, zero runtime dependencies, linear history, demo green.

## Decisions made autonomously (with why)

1. **Engine and control loop built as one feature.** The engine↔eval seam was
   not in the frozen contract; rather than let two parallel builders invent
   incompatible halves, the plan merged them — the design's own
   contract-discipline rule applied to the build of the design.
2. **Repair is part of the attempt that produced the flaw**, not a second
   attempt. The reviewer found repair burning 2 attempts; the design treats
   repair as the *cheap* rung, so one attempt covers produce + repair + recheck.
3. **Token accounting is a heuristic** (`chars/4` of brain results) so all four
   budget dimensions gate the loop without changing the frozen `Brain`
   interface. Real token counts arrive with a real LLM adapter.
4. **A failed integration eval emits `blockers`, not a clean report.** One
   re-integration attempt remains out of scope; failing honestly is in scope.
5. **8 of 19 starter types** — the coherent end-to-end slice (deliver-intent,
   freeze-contract, implement, characterize, the three judges, promote-memory).
   The rest are data definitions away, not architecture away.
6. **Grants are stored, not runtime-enforced.** The constitution lint
   (`lintLibrary`) checks the library's invariants statically; runtime grant
   enforcement is deferred with the rest of the capability machinery.
7. **One grouped review at integration instead of per-feature reviews** — a
   budget decision the design permits the parent to make. Eight gating findings
   were caught there and repaired; the per-feature reviews would likely have
   caught the local ones earlier but not the cross-cutting budget findings.
8. **Mid-run human gates auto-resolved by design**: blocks fall back to the
   brief's `onTimeout` default unless an `onBrief` handler is provided — the
   prototype's stand-in for parking/TTL.

## Deliberately deferred (next iterations)

Split-memo flywheel + pattern pinning · terraced scan · the improvement loop ·
runtime grant enforcement · risk/authority gates · park/TTL machinery · the
listener daemon (the demo commissions directly) · live `LlmBrain` runs.

## Questions saved for the commissioner

1. Repair-attempt accounting: is "one attempt covers produce+repair+recheck"
   the model you want, or should repair have its own (cheaper) budget line?
2. Should runtime grant enforcement be the next iteration, or the flywheel?
3. `LlmBrain` first live run: which provider/baseUrl/models per tier?
4. Merge `integration/factory-proto` to `main`? The factory never self-merges.
5. Is the 8-type slice right, or expand the library next?

---

# Iteration 2 — substrate, gates, listener, flywheel, live brain

Built by the same process: gate brief (substrate + provider decisions) →
contract-v2 barrier → wave 1 fan-out (substrate-pg, risk gates, listener,
live brain) → wave 2 serialized on the engine-file overlap (flywheel + scan)
→ six-dimension review (4 gating findings) → repair rung → full suite.

## What was added

| Module | What it is |
| --- | --- |
| contract v2 | async EventStore/MemoryView (the Postgres consequence), PatternStore/SplitMemo, RiskClass/SensitivityFact, GoalTypeDef.gated/scan, BrainContext.lens/patternHint, six new event members |
| `src/substrate/` | PgEventStore + PgPatternStore (parameterized SQL, idempotent schema), InMemoryPatternStore, docker-compose; pg integration tests skip cleanly without DATABASE_URL |
| risk gates | constitution lint at Engine construction; classifyRisk over scope at entry and over actual artifact paths at emission; authority gate (type ∨ instance), fail-safe denied |
| `src/listener/` | scope-disjoint admission (overlap queues, disjoint runs concurrently), park releases the reservation immediately, TTL tick sweep (caller owns the clock), answer/resume as a checkpoint |
| flywheel + scan | specShape signatures; trusted memos walk verbatim (derivation skipped, judgment never); provisional memos arrive as hints; lens-diverse terraced scan ranked by judge-split, losers recorded as "alternatives considered" findings |
| live brain | openRouterConfig (models endpoint-verified defaults, env overrides), LlmBrain typeCatalog + strict-JSON prompts, examples/live.ts (`npm run live`) |

## Decisions made autonomously (with why)

1. **Asyncified the frozen EventStore/MemoryView** — the direct consequence of
   the human's Postgres decision; carried by the barrier with every consumer
   updated in one commit.
2. **Brief seam: the Listener owns the brief.** Review escalated the
   uncoordinated Engine-onBrief/Listener-inference seam; since neither surface
   is in `src/contract/`, this was judged an engine-internal fix, not a
   frozen-contract change: the Listener installs its handler as the engine's
   active brief authority per run and records parks synchronously. The post-hoc
   event scan survives only as a fallback for scripted test engines.
3. **'medium' risk is recorded, not gated** — prototype policy, marked as
   policy in the code; 'high' and `gated` types hit the authority gate
   (default-denied without a handler).
4. **The engine never self-trusts a pattern** — `promote(shape,'trusted')`
   exists only as the API the human ceremony calls.
5. **Decide-phase brain calls (incl. the k-candidate scan) are not budget-
   debited** — consistent with the existing decide path; recorded as a known
   gap rather than silently half-fixed.

## Blocker-report outcomes (the improvement loop, run by hand)

- Listener seam friction → confirmed by review, fixed (decision 2 above).
- "deliver-intent missing from registry" → **disproven** by review; the claim
  was a builder misreading. No action.
- Terraced-scan losers as `decided` events → confirmed; losers are now report
  findings ("alternatives considered"), exactly one `decided` per node.

## Known sharp edges (documented, not fixed)

- `classifyRisk` substring matching over-gates (`author.md` matches `auth`) —
  conservative direction, tuning pass welcome.
- `specShape` collisions could walk a wrong trusted memo; the split eval is the
  safety net (judgment never skipped).
- Decide-phase spend is unmetered (decision 5).

## Saved questions for the commissioner

1. Export `OPENROUTER_API_KEY` and run `npm run live` — the first real-brain
   run is wired and waiting; expect a small tree at haiku/sonnet-class cost.
2. The pattern-trust ceremony: `PatternStore.promote(shape, 'trusted')` exists —
   what surface should the human signoff get (CLI? PR-style review?)
3. Risk sensitivity defaults: tune now or after live-run evidence?

---

# Iteration 3 — Hands: agentic leaf execution

Built by the orchestrator running the factory's own process directly (no
workflow harness, per the operator): barrier (opus) → wave-1 fan-out (three
sonnet builders in isolated worktrees + the serial trunk chain) → per-feature
opus judges with prescriptions → sonnet repair rung → fold-back by
cherry-pick (one trivial conflict, one readUsage dedupe) → assembly (opus) →
final judge → process-clean sweep → live convergence run. 308 → 555 tests.

## What was added

| Module | What it is |
| --- | --- |
| `src/contract/tool.ts` + brain/goal/goal-type/events extensions | the barrier: tool shapes, ToolImpl table, grant→tool map, Brain.step + step protocol with incidents, Usage/Metered, spendCeilingUsd, CheckContext, 10 event members |
| `src/engine/tools.ts` + `broker.ts` | four core file tools; the one mediator — grant check, broker-owned write scope check, refusal-as-data, tool-call events |
| step loop in `src/engine/engine.ts` | engine-owned, brain pure per step; per-call budget gate; refusals debit; transcript-tail carry into priorAttempt; prefix-stable remaining-count injection |
| `src/library/script-runner.ts` + runScriptCheck | scripts-by-name (shell:false), wall-clock kill, runScriptTool ToolImpl, loggingScriptRunner, verifyEntryPoints at receive; CheckContext-consuming executing check |
| `src/engine/worktree.ts` | tree worktree lifecycle (injective ids), real-diff scope check incl. script side-effects and renames, collect/preserve |
| accounting in engine + projections | provider-reported usage on events, tokens debit from reported figures, ceiling gates at every debit site, $15 default / $25-per-1M fallback, cost-summary projection |
| `LlmBrain.step` | thin wire translation; bounded transport retries (incidents on the envelope — adapter never holds the store), one-shot malformation re-prompt, terminal classification |
| `src/engine/assembly.ts` + EngineOptions.sandbox | the composition root: worktree → broker (core + run_script) → CheckContext per goal → root-emission diff⊆scope → collect/preserve; scrubbed child env |
| `examples/live-hands.ts` | the live done-when |

## Decisions made at orchestration (with why)

1. **Engine is the sole budget debitor** — the planned broker-onDebit callback
   was dropped at dispatch: one local counter in the loop eliminates the
   double-debit class entirely. Recorded in the manifest; ToolBroker doc
   updated.
2. **Refusals debit toolCalls** — a refused call still consumed a round trip;
   debiting refusals is what prices a refusal loop out.
3. **Shared-worktree AC-6 semantics** — root-emission diff against root
   scope + per-leaf broker write checks + per-leaf artifact check. A leaf
   cannot escape its own scope through the broker; script side-effects are
   caught by the root diff. Judged honest.
4. **Adapter purity held** — retries/malformations return as incidents on the
   step envelope; the engine appends the events.
5. **F-33's closure plan was rewritten before build** (resolved Blocker 1):
   static type definitions cannot capture per-tree runtime state; CheckContext
   arrives at invocation.

## Review-rung results (the control loop, run for real)

Five opus judges, 20 findings total, every gating finding repaired by a
sonnet fixer within the iteration: F-32 FAILED first judgment (dead
transcript-tail carrier, mid-step over-spend, debit-seam doc contradiction) —
repaired and re-verified; F-35's ceiling had serial-overshoot holes at scan/
repair/step paths — closed and pinned; F-31's audit log mislabeled scope
refusals as 'ran' — broker now owns the write check; secrets-into-child-env
caught at review — scrubbed env with credential-suffix sweep, PATH-survival
pinned.

## Live convergence run (the done-when)

First try, sonnet-class model: red→green real script execution (exit 1 →
exit 0), 10 brokered tool calls (list/read/write/run), worktree created and
collected with 1 commit, **$0.0658** measured from provider-reported usage.
PRD risk #1 (can lower-tier models drive the loop) — first evidence: yes.
The scope-violation refusal half of the done-when is pinned by the scripted
convergence suite (the live model simply never violated scope).

## Known debts (recorded, not hidden)

- outputRef on script-ran events is a correlation key; full-output
  persistence lands with iteration-4 proof-artifact work.
- `fs.write_test_dirs` unmapped in v1 (characterize's write path).
- Engine.run is single-tree-per-instance (documented in code).
- Symlink containment is lexical, per ADR-016's trust posture.

---

# Iteration 4 — Eyes: brownfield comprehension

Built by the same direct process as iteration 3: barrier (opus) → five
concurrent builders (four worktrees + the coverage gate on the trunk) →
five opus judges → sonnet repair rung → clean fold-back (17 cherry-picks,
zero conflicts) → assembly (opus) → final judge → live runs. 555 → 826
tests.

## What was added

| Module | What it is |
| --- | --- |
| `src/contract/knowledge.ts` + 3 event members | KnowledgeArtifact/RegionFacts/DiveFact (pointers-not-bodies, SHA-anchored), knowledge-written/facts-written/checked |
| `src/eventlog` projectKnowledge + `src/library/knowledge.ts` | the knowledge view (latest per repo×category with freshness) + evented write helpers |
| `src/library/imports.ts` | zero-dep import-edge scanner + impact() (reverse reachability + test association); verifiable-by-rescan |
| `src/library/retrieval.ts` | find_symbol / find_exemplar / conventions_for / stack_versions / impact as functions + read-only ToolImpls under retrieval.api |
| `src/library/starter-types.ts` + `knowledge-checks.ts` | map-repo (4 categories) + deep-dive-region with executing per-category self-validation |
| `src/library/coverage.ts` + engine gate seam | the ADR-021 policy table; misses spawn comprehension children as dependencies; split-checkpoint verify-on-read (integrate checkpoint honestly deferred) |
| assembly + `live:eyes` | retrieval tools in the broker, knowledge wiring, scripted convergence, the live mapping demo with full foreign-repo teardown |

## Review-rung results

Five judges, ~20 findings. F-45 FAILED outright: its builder left a
load-bearing parameter uncommitted (committed HEAD didn't typecheck),
injected children bypassed the split guards, and a docstring claimed
checkpoint coverage that didn't exist — all repaired, the deferral now
stated truthfully. F-42's judge caught a silent source-dropping skip list.
F-41's judge caught a pg test that would crash under a real DATABASE_URL.

## The live runs — honest results (≈$21 of evidence)

**Scripted convergence: PASSED** (zero network) — gate spawns maps as
dependencies with proven sequencing, a leaf consults impact() through the
broker before its first write, SHA drift triggers validation + refresh, a
phantom pointer is caught by the real scan, worktrees collect.

**Live mapping: PARTIAL, high variance.** Across five corellia runs every
category validated live at least once (architecture once at 23 pointers;
stack + conventions once; an excellent 8-anchored-fact dive once) but never
5/5 in a single run; the cats run blocked all five. Every failure was
bounded and blocked cleanly; corellia and cats were left byte-identical
after every run (verified externally for cats, including exclude-file
reversion).

**The big catch:** the live runs exposed a cross-iteration bug all prior
judges and 800+ scripted tests missed — **the step transcript never carried
the goal.** Scripted brains don't read prompts, so the missing harness
message was structurally invisible to the entire scripted suite;
iteration 3's live demo had only succeeded because its task was
discoverable from the fixture repo itself. Fixed in the engine
(prefix-stable harness message: title, type, spec, memories-as-quoted-data)
and pinned.

## Trace-driven amendments made during the live phase

1. Packaging tolerance: models wrap artifact JSON in fences (the adapter
   parses them into files artifacts); one shared extractArtifactPayload now
   serves the gate AND persistence (the persist path's separate strict
   parser silently dropped valid artifacts — found live).
2. map-repo default tier haiku → sonnet (GOAL-TYPES table updated with the
   evidence citation): haiku first attempts burned shared budgets before
   the sonnet retry started.
3. Exploration economy + message protocol stated in the live harness specs.

## Carried debt (named, for iteration 5)

- **One-shot JSON emission of large artifacts over a long tool transcript
  is structurally brittle** at sonnet tier — the protocol-statement prompt
  did not fix it. The right fix is provider-native structured outputs
  (response_format/json_schema) for learn-type emission in the adapter —
  exactly iteration 5's harness-quality scope.
- Verdict details for shape mismatches should name the missing fields
  (repair-quality).
- Retry attempts re-explore from scratch (priorAttempt carries the verdict,
  not the knowledge gathered) — expensive on real repos; a
  carried-exploration design is iteration-5 material.
- Prompt caching not yet exploited via OpenRouter (cache_control
  breakpoints) — the transcript-heavy runs would benefit most.
- live-eyes' default dive region 'src' is wrong for non-src layouts (cats).
- Integrate-checkpoint verify-on-read deferred (split checkpoint full).

---

# Iteration 5 — Taste: the library at full strength

Same direct process, three waves (barrier → F-51∥F-52 → fold → F-53∥F-54∥
F-55∥F-56 → fold → F-57). 826 → 1076 tests. The library stands at all 19
GOAL-TYPES types with markdown family skills; the lint gate is binding in
`npm test`.

## What was added

Two-phase structured emission (explore-then-emit via provider response_format
— ADR-023); the skill loader + six→ten family files with the dotmaz seed
content ported (ADR-022); write-prd / design-arch / research-external /
investigate; critique-doc / critique-ui + the intent dial through judge
rubrics (hard invariant pinned: intent never reaches deterministic checks);
the evolve family thin with dangerous-grant proofs; carried exploration
across attempts; golden capture as events (ADR-024); cached-token surfacing;
cost-optimized tier models (deepseek-v4-flash/pro + kimi-k2.6, ADR-005
amendment) at ~7-25x lower unit price, smoke-proven.

## Review-rung highlight

The integration judge caught the iteration's defining find: F-54's
intent-dial bars lived in a `## The intent dial` section that F-56's rubric
enricher never extracted — judges were told to "apply the bar the intent
demands" without ever seeing the bars, and the arbiter's
invariants-survive-spike protection was silently lost. A synthetic-family
test had masked it. Fixed with real-skill assertions. Lesson: integration
tests must use the real artifacts, not synthetic stand-ins, when the
artifact IS the product.

## The live retest — honest results (~$13 this iteration)

live:hands on the new tiers: PASS at $0.024 (2.6x cheaper than the original
sonnet run), golden candidate captured. live:eyes across four runs: best
**4/5** (architecture+stack+conventions+dive) at ~$1.8-2.4/run vs the
iteration-04 baseline (best 3/5 at $2-6); every category passed at least
twice; never 5/5 in one pass. The runs caught and fixed four real machinery
bugs no scripted test could see:

1. **npm-script execution** — package.json script values were executed as
   node file paths (fixtures had masked it); `npm-script:` entries now spawn
   the package manager, args-array, shell-free.
2. **Worktrees lacked the toolchain** — fresh tree worktrees couldn't run a
   real repo's declared scripts; the lifecycle now links the repo root's
   node_modules in.
3. **The dependency link tripped the scope check** — a node_modules symlink
   evades a `node_modules/` gitignore rule (a link is not a directory), and
   the untracked listing didn't respect gitignore at all
   (`--exclude-standard` added; the lifecycle's own link never counts as
   work).
4. **Re-run collisions** — tree ids derive from goal ids; a worktree
   preserved by a failed earlier run collided with the next run's identical
   id. Live goal ids now carry a per-run nonce.

## Carried debt (named, for iteration 6 prep)

- **Exploration discipline at cheap tiers** is the residual 5/5 blocker:
  models over-explore real repos (token/toolCall exhaustion) with run-to-run
  variance; emission itself is now reliable (structured outputs). Levers:
  per-category budget shapes, harder economy enforcement in the loop (e.g.
  duplicate-call refusal), or tier policy per category.
- **Cache-hit share reads 0.0%** despite stable prefixes — likely OpenRouter
  provider-routing breaking cache affinity; investigate provider pinning
  (~5-10x cost lever on transcript-heavy runs).
- design-arch's own artifact-level tournament (leaf scan) is an unbuilt
  engine seam.
- Dangerous-grant regexes live in tests; promote into the constitution lint.
- Integration-judge verdicts are excluded from golden capture (pinned as
  intentional; wire when the integration site emits judge-verdict events).

---

# Iteration 6 — F-66 container packaging

Container-ready packaging for the front-door daemon (ADR-026: container ships
this iteration; cloud deployment deferred). Four chunks, no `src/` changes.

## What was added

| File | What it is |
| --- | --- |
| `Dockerfile` | multi-stage on `node:22-slim`; builder runs `npm ci` + `npm run typecheck`; runtime adds `git`, runs non-root (uid 1001 `corellia`), copies full `node_modules` from builder (tsx is the runtime runner) |
| `compose.yaml` | `daemon` + `postgres` services, named volume `corellia-pgdata`, `DATABASE_URL` wired to the `postgres` service via `env_file`, `pg_isready` gate + daemon `GET /status` bearer-token healthcheck (HTTP 200) |
| `.env.example` (extended) | new `CONTAINER DEPLOYMENT (F-66)` section — every required key, placeholder values only |
| `docs/container.md` | operator runbook: build → up → smoke → down; migrate-on-boot; target-repo toolchain constraint |
| `scripts/smoke-container.ts` | operator-run smoke: `POST /intents` a trivial `write-prd`, poll `GET /status` until emitted, print report + cost |
| `tsconfig.json` (1 line) | added `scripts` to `include` so the smoke script is covered by `npm run typecheck` |

## Decisions (with why)

1. **Image runs `tsx`, not compiled `dist/`.** `package.json` has no
   `build`/`tsc`-emit script (`typecheck` is `tsc --noEmit`); there is no
   `dist/` to run. ENTRYPOINT is `node node_modules/.bin/tsx src/daemon/daemon.ts`,
   matching the dev invocation documented in `daemon.ts`. A future `build` step
   flips this to `node dist/src/daemon/daemon.js`.
2. **Migrate-on-cold-boot is the daemon's own path, not a separate migration
   job.** `daemon.ts` calls `store.ensureSchema()` when `DATABASE_URL` is set;
   that runs the Pg store's `CREATE TABLE IF NOT EXISTS corellia_events` +
   indexes (`src/substrate/pg-event-store.ts`). The `postgres` `pg_isready`
   healthcheck gates the daemon's `depends_on` so the migration never races an
   unready DB.
3. **Secrets via `env_file` only (ADR-012).** No `environment:` literals in
   compose, nothing baked into the image. The healthcheck reads the token from
   the container's own `process.env.FRONT_DOOR_TOKEN` (`$$`-escaped so compose
   doesn't interpolate it). `grep -r 'FRONT_DOOR_TOKEN\|GITHUB_TOKEN' Dockerfile
   compose.yaml` finds only env-var-NAME references, no assigned values.
4. **Target-repo toolchain constraint (v1):** target-repo scripts run INSIDE
   the container; the image ships Node only, so v1 supports Node/TypeScript
   target repos only. Documented in the runbook, not silently failed.

## Evidence (operator to fill — placeholders)

`docker build` / `docker compose up` are operator-verified (NOT CI-gated).

- [x] `docker build --target builder` (chunk 1): **PASSED** — typecheck green,
  ~2.8 s (run during build, pre-socket-reset).
- [x] `docker compose config`: **validated, exit 0** (with a throwaway
  placeholder `.env`).
- [ ] `docker compose build` (full runtime stage): _operator to run_ — paste
  result here.
- [ ] `docker compose up -d` + `docker compose ps`: _operator to run_ — both
  services `healthy`? paste here.
- [ ] `GET /status` 200 with bearer token: _operator to paste_ the
  `curl -w '%{http_code}'` line.
- [ ] Schema migration on cold boot: _operator to paste_
  `\dt corellia_events` after first `up`.
- [ ] `npx tsx scripts/smoke-container.ts`: _operator to paste_ the
  `[smoke] PASS` line, the printed report JSON, and the `cost:` line.

> Honesty note: the shipped daemon wires a NULL engine (`daemon.ts`) that
> rejects every run, so against the shipped image the smoke run proves the
> webhook + admission + status surface; a real converged report+cost requires
> the live-engine entrypoint (F-67).

## What is / isn't CI-gated

- **CI-gated:** `npm run typecheck` (now covers `scripts/smoke-container.ts`),
  `npm run lint`, `vitest run`. These test source, not the image.
- **NOT CI-gated (operator-verified):** `docker build`, `docker compose up`,
  `scripts/smoke-container.ts`. The vitest suite is never run inside the
  container (runtime stage carries no test deps).

---

# Iteration 06 — Assembly: the closed loop (F-67)

Built by the autonomous agent on 2026-06-12. This section records the F-67
assembly decisions, live evidence placeholders, and the convergence-loop
suite's CI gate status.

## What was assembled

| Artifact | What it is |
|---|---|
| `tests/integration/convergence-loop.test.ts` | Primary CI gate. 12 tests covering path A (commission→push→PR→report) and path B (blocker→improve-factory→bare-repo PR). Zero network, zero real LLMs. |
| `src/daemon/live-engine.ts` | Production seam: `buildLiveEngine()` replaces the null stub for live commissions. Wires LlmBrain + knowledge + prBoundary end-to-end. |
| `examples/live-foreign-eyes.ts` | AC-2 checkpoint (operator-run). |
| `examples/live-self.ts` | AC-3 strange-loop deliver (operator-run). |
| `examples/live-foreign.ts` | AC-4 cats deliver (operator-run). |

## Implementation decisions

1. **buildNullEngine() left in daemon.ts.** The existing null stub was not
   replaced in daemon.ts because `docker compose up` + the smoke script use
   the daemon entrypoint directly and must not require OPENROUTER_API_KEY at
   container start time. Instead, `src/daemon/live-engine.ts` exports
   `buildLiveEngine()` which live harness scripts and a future live daemon
   entrypoint import. This is the seam documented in F-62's implementation
   notes.

2. **Strange-loop hygiene documented, not enforced mechanically.** The
   live:self harness includes pre-run and post-run hygiene checks (primary
   branch clean, worktree list, .git/info/exclude verification). The
   mechanical isolation is provided by the worktree model itself: the factory
   opens a tree/<treeId> worktree under .claude/worktrees/ which is gitignored,
   and the primary checkout is on `main`/`build/06-loop` and never touched by
   the build engine. The process-clean gate (AC-20) additionally blocks any
   diff containing factory-internal content before push.

3. **Convergence suite: process-clean gate test uses `build-plan` pattern.**
   The test suite verifies the gate fires on factory vocabulary by using
   `build-plan` (a known PROCESS_CLEAN_PATTERNS entry). The `improve-factory`
   pattern is also in PROCESS_CLEAN_PATTERNS, which means improvement-loop
   test content must be process-clean (no `## improve-factory` headings in
   test worktree files). The path B end-to-end test uses `eval-harness.md`
   with process-clean content.

4. **Scripted vs live engine for convergence suite.** The convergence suite
   (chunk 2) uses a ScriptedEngine that appends events and returns scripted
   reports — it does NOT use buildLiveEngine(). This is by design: the suite
   is the CI gate and must be zero-network. The live engine path is exercised
   only by the operator-run harness scripts (chunks 3-5).

## Live evidence (operator to fill)

### AC-2: live:foreign-eyes early checkpoint result

**Date:** 2026-06-12 · **Target:** cats (/Users/keith/dev/gauntlet/cats) · **Run nonce:** a87862f4

| Category | Result |
|---|---|
| architecture | FAIL — `step-loop:exhausted` (isomorphic → block) |
| stack | FAIL — tokens budget exhausted |
| conventions | FAIL — `step-loop:exhausted` (isomorphic → block) |
| test-scaffold | FAIL — `step-loop:exhausted` (isomorphic → block) |
| dive:src | FAIL — `step-loop:exhausted` (isomorphic → block) |

**0/5 categories passed.** Cost: **$1.2897** · Cache-hit share: **49.0%** (F-64
pinning fired — up from 0.0% in iteration 04) · prompt 1,779,558 / completion
14,101 tokens · 0 knowledge artifacts written.

**Decision:** ✗ Root-cause first — deliver spend NOT approved. The gate did its
job: it blocked AC-2/AC-3 spend against a comprehension layer that cannot yet
comprehend cats.

#### Root cause (confident)

A **budget-shape mismatch**, not a code defect — the iteration-5 carried debt
("models over-explore real repos; token/toolCall exhaustion") that iteration 6
named but only half-addressed.

- The harness sets `toolCalls: 20` per category (`examples/live-foreign-eyes.ts`
  `DEFAULT_BUDGET`). The step loop seeds `remainingToolCalls = budget.toolCalls`
  and returns `exhausted` at 0 (`engine.ts:1869`, `:1935`). On a real repo of
  cats's size, 20 `list_dir`/`search`/`read_file` calls is not enough to map
  `src/` **and** emit an artifact — the model exhausts exploration before it
  produces. Every category fails with the identical `step-loop:exhausted`
  signature → isomorphic-failure block.
- **F-64 worked, but on the cost axis, not the discipline axis.** Cache-hit
  share 0% → 49% and the duplicate-guard prevented wasted re-reads. The model
  isn't being wasteful — it's under-provisioned. F-64 never claimed to grant
  more exploration budget.
- **Not a tier problem.** `map-repo`/`deep-dive-region` run
  `tier: { default: 'mid', ladder: ['mid','high'] }` — they already escalate to
  high on retry. "Isomorphic failure" means high failed identically to mid: a
  stronger model with the same 20-call ceiling still can't finish. The ceiling,
  not the model, is the wall.

#### The fix is an iteration-7 brief (the unbuilt iter-5 lever)

The remaining lever from iter-5's debt list: **per-category budget shapes** (and
possibly a breadth-first index pass before the expensive read pass). This is a
real design question, not a one-line bump — see the options recorded in the
session and the next roadmap iteration.

#### Re-run after warn-only fix (2026-06-12, nonce 82d4c557): 1/5, failure mode shifted

After making the toolCalls budget warn-only (commit ef4bdd9) and raising the
comprehension budgets (toolCalls 20→200, tokens 500k→2M), the retest went 0/5 →
**1/5** and — more importantly — **the failure signature changed**, which is the
real signal:

| Category | Before | After |
|---|---|---|
| architecture | step-loop:exhausted | **tokens budget exhausted** (hit the 2M backstop) |
| stack | tokens exhausted | **tokens budget exhausted** |
| conventions | step-loop:exhausted | **step-loop:failed** (emit threw / returned tool-calls) |
| test-scaffold | step-loop:exhausted | **step-loop:failed** |
| dive:src | step-loop:exhausted | **PASS** ✓ |

Run cost $5.91, 8.38M prompt tokens, cache-hit 50.6%, 0 artifacts written.

**What this proves:**
- The warn-only fix worked: **no category hit the toolCalls wall.** The tool-call
  ceiling is no longer the blocker.
- The real problem is now exposed and it is **comprehension strategy, not budget
  shape**: the broad whole-repo `map-repo` goals (architecture, stack) explore so
  much they exhaust even a 2M-token budget without ever converging to an emit;
  the narrower ones reach emit but the structured-output emit call fails
  (`step-loop:failed` = the two-phase emit returned tool-calls or threw, at
  `engine.ts:2119` / `:2085`) — likely the model cannot emit a clean structured
  artifact after an 8M-token exploration transcript.
- **The scoped `deep-dive:src` goal PASSED.** Scope is the differentiator: a
  region-bounded goal converges; a whole-repo goal does not. This is the design
  signal for iteration 7.

**Root cause is STRUCTURAL, not a budget or strategy tweak — and it is a design
defect, not an implementation bug.**

`map-repo` is `leafOnly: true` (`src/library/types/comprehend.ts:41`), and so is
`deep-dive-region` (`:80`). The engine enforces leaf-only structurally: leafOnly
types skip the decide/split path entirely and go straight to the attempt loop
(`engine.ts:631`), and a leafOnly type that returns a split decision is a hard
error (`:701`). So a comprehension goal **cannot decompose** — it must swallow
its entire job in one node's context.

This directly contradicts the factory's central law: *any goal too big for one
node splits.* Comprehension is the one family whose work scales with repo size,
and it is the one family hard-coded never to recurse. "Comprehend the architecture
of cats" is not a leaf-sized job on any non-trivial repo — yet it is forced into
a single leaf. The result is exactly what we saw: the whole-repo `map-repo` goals
exhaust (2M tokens, no convergence), and `deep-dive:src` passed only because
cats's `src` happened to fit one node — on a larger subsystem it would exhaust
identically. Scope didn't *help*; the bounded node simply stayed under the leaf
ceiling that the unbounded ones blew through.

DESIGN.md §"Discovery is just-in-time" already says comprehension is *pulled by
the split gate* — "map enough to split THIS intent," "a region no goal touches is
never mapped," "no comprehension is ever speculative." The whole-repo eyes
checkpoint violates this on its own terms (it comprehends speculatively, with no
intent to bound it). But the deeper fix is not just "scope the checkpoint" — even
a scoped comprehension goal can exceed one leaf on a large subsystem. **The fix is
to make comprehension obey the recursion law: a comprehension goal that finds its
region too large to comprehend in one node must SPLIT** — fan out child
comprehension goals over sub-regions and integrate their artifacts — the same
satisfy/split/block decision every other node makes. `leafOnly: true` on the
comprehend family is the bug.

**Iteration-7 brief (structural):**
1. Remove `leafOnly` from the comprehend family; let `map-repo`/`deep-dive` take
   the decide path and split when their region is too large for one node
   (integrate children's artifacts at the parent edge, like any non-leaf type).
2. Comprehension must be *scoped by a region argument* and *pulled by the split
   gate* per DESIGN's JIT rule — not commissioned speculatively over a whole repo.
3. Rewrite `live:foreign-eyes` to test the design as written: commission a real
   scoped intent against cats, let the split gate pull JIT comprehension of only
   the relevant regions (which may themselves recurse), and assert success.
4. (Lower priority) harden the two-phase emit so a long transcript still yields a
   valid structured artifact — but this is a symptom; fixing the recursion makes
   transcripts short enough that it may not bite.

The lever is NOT "bigger budgets" — 2M tokens still exhausted. It is restoring
recursion to the one family that was wrongly denied it.

**Decision:** AC-2 NOT passed (1/5) → deliver spend (AC-3/AC-4) blocked. This is
an iteration-7 structural fix (comprehension must recurse), not a budget tweak.

### AC-3: live:self (corellia delivers to itself)

> Run `npm run live:self` with OPENROUTER_API_KEY, GITHUB_TOKEN, CORELLIA_FEATURE,
> CORELLIA_SCOPE set. Must be gated on AC-2 passing first.
> Paste the evidence template output below.

```
PLACEHOLDER — operator to fill after running live:self
```

### AC-4: live:foreign (cats deliver)

> Run `npm run live:foreign` with OPENROUTER_API_KEY, GITHUB_TOKEN, CATS_REPO_PATH,
> CATS_FEATURE, CATS_SCOPE set. Must be gated on AC-3 succeeding.
> Paste the evidence template output below.

```
PLACEHOLDER — operator to fill after running live:foreign
```

## CI gate status

| Gate | Status |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npx vitest run` | PASS — 1335 passed / 21 skipped / 0 failed |
| `tests/integration/convergence-loop.test.ts` (12 tests) | PASS — zero network confirmed |


---

# Iteration 06 — convergence summary (the loop closes)

**Build branch:** `build/06-loop` · linear by construction (every feature stacked
on the frozen barrier; no merge commits). Built orchestrated-manually (the
build workflow's outline, run by hand with Sonnet-class builders, one Opus
reviewer, and an adversarial skeptic on the high-severity finding). 37 commits
on top of the barrier.

## Feature roster — all Shipped

| ID | Feature | Outcome |
|---|---|---|
| barrier | Frozen contracts | brief.ts, GRANT_TOOL_MAP push/pr, 3 event members, StepRequest.provider — green on the barrier alone |
| F-61 | PR-opening boundary tools | push_branch/open_pr; GIT_ASKPASS token (0700 tmpfile, deleted in finally, never in argv/output/events); process-clean gate; idempotence |
| F-62 | Daemonized front door | node:http daemon, bearer auth, REPL, SIGTERM→preserveTree, substrate select |
| F-63 | Improvement loop v1 | mint-on-complete, blocker-routed, StandingEnvelope admission (never starves product), runaway guard; harness asserts the REAL improve.md |
| F-64 | Run economics | provider pinning, duplicate-call refusal (read-only only, write-invalidated), cache-hit share in costSummary |
| F-65 | Debt sweep | A9 leaf tournament, A10 dangerous-grant lint, A11 integration-judge capture, A12 read-only learn roots (no worktree) |
| F-66 | Container packaging | multi-stage Dockerfile (tsx runtime, non-root, git present), compose.yaml, env-only config, smoke script |
| F-67 | Assembly: the closed loop | live-engine wiring, scripted convergence suite (12 tests, zero network — the CI gate), live harnesses (authored, operator-run) |

## Final gate status

| Gate | Status |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npx vitest run` | PASS — **1345 passed / 21 skipped / 0 failed** |
| `tests/integration/convergence-loop.test.ts` (12) | PASS — zero network |

## Reconciliation + review record (what the orchestration caught beyond green tests)

1. **F-62 daemon-spawn defect (orchestrator, at wave-1 fold):** SIGTERM tests
   spawned `npx` (ENOENT on the child's PATH) with a cwd hardcoded to the
   deleted f62 build worktree — both would have failed permanently post-fold;
   the builders had dismissed them as "flake." Fixed to spawn
   `process.execPath` + tsx CLI from a path resolved via `import.meta.url`.
2. **F-65 self-caught:** its A12 no-worktree learn path was too aggressive and
   regressed `convergence-eyes`; the builder re-guarded script-granting learn
   goals back into the sandbox.
3. **Opus review — 2 gating + 4 non-gating findings, all fixed:**
   - GATING: process-clean gate blocked the improvement loop's own PRs (the
     gate rejects factory vocabulary that self-improvement PRs necessarily
     contain). Fixed: target-aware gate.
   - GATING: null-engine daemon couldn't deliver "through the daemonized front
     door" (AC-3). Fixed: env-guarded live engine in daemon.ts
     (`OPENROUTER_API_KEY` present → live, else null stub for keyless smoke).
   - NON-GATING: HTTP input validation at POST /intents (422 on bad
     scope/budget); two-compose-file shadowing (explicit `-f` flag documented).
4. **Adversarial skeptic re-check on the high-severity fix — found a real hole:**
   the target-aware gate keyed on `goal.type === 'improve-factory'` as a *proxy*
   for "targets the factory's own repo." That proxy is not enforced: on the
   `live:foreign` + improvement-loop path, one engine has `repoRoot = cats`, so
   an improve-factory tree could push factory vocabulary onto a foreign cats PR
   with the gate wrongly narrowed. **Re-fixed:** the gate now narrows only when
   the real push target `repoSlug === factoryRepoSlug` (configured at assembly
   time; set by live:self, unset by live:foreign and the daemon unless
   `FACTORY_REPO_SLUG` is set). The leak path is regression-pinned.

## What remains operator-run (live evidence, not CI)

The scripted convergence suite is the CI gate and is green. The live harnesses
are authored but NOT run by the build (they cost real spend and need a human +
real `GITHUB_TOKEN`/`OPENROUTER_API_KEY`):
- `npm run live:foreign-eyes` — cats comprehension early checkpoint (target 5/5;
  honest record either way) — the de-risk gate **before** any deliver spend.
- `npm run live:self` — AC-2: a real corellia feature through the daemon to a
  corellia PR (strange-loop isolation watched).
- `npm run live:foreign` — AC-3: the same on cats.
Evidence placeholders for these are in the F-66/F-67 sections above; fill PR
URLs, costs, and cache-hit share after the live runs.

## Carried notes for next iteration

- A thin live-daemon entrypoint that calls `buildLiveEngine()` at startup exists
  via the env guard in `daemon.ts`; the container still defaults to the null
  stub when keyless.
- Two compose files coexist (`docker-compose.yml` dev-DB helper vs `compose.yaml`
  full stack); documented with explicit `-f`, not renamed (README/ADR-004
  reference the old name).

---

# Iteration 08 — Recursion (ADR-029): the strange loop proves its own thesis

**Date:** 2026-06-20 · **Approach:** commissioned through the factory's own front
door (`live:self`), per the self-hosting principle — corellia building the fix
that lets corellia comprehend corellia.

## What the self-build runs surfaced (7 fixes, all on main, all green)

The attempt to self-build ADR-029 drove the factory progressively deeper, one
real defect per run. Each was invisible to the scripted convergence suite (which
uses a deterministic brain that never emits malformed JSON, never picks a flaky
model, and never triggers a real multi-region coverage fan-out):

| Run | Reached | Blocker | Fix |
|---|---|---|---|
| 1 | engine split | brain split child missing `dependsOn` → `[...child.dependsOn]` crash | `539334a` parse-seam normalization |
| 2 | decide | unparseable decision threw uncaught → killed whole tree | `50e28f6` decide → block on parse failure |
| 3 | decide | decide/judge used `json_object` (valid JSON, any shape) | `5a71054` schema-constrain output + real-error re-ask + fence-tolerant parse |
| 4 | decide | **`qwen/qwen3-235b-a22b` broken on OpenRouter** (ECONNRESET / returns `{`) | `235d34e` high tier → `claude-sonnet-4` + transport retry on decide/judge |
| 5 | coverage gate | legitimate 12-child fan-out > `attempts:5` harness budget | `af0cf47` live:self budget → 20/3M/300 |
| 6 | coverage gate | injected comprehension shares pushed sum to 1.8 > 1 | `157e1a4` renormalize budgetShares after injection |
| 7 | **comprehension (real work)** | `map-repo`/`deep-dive` exhausted token budgets — **the ADR-029 wall** | hand-implement (below) |

**Key lesson (run 4):** I burned three commits theorizing about output *shape*
before probing the raw wire response, which revealed the true cause was a flaky
*model*. Capture the evidence before theorizing.

## Run 7 — the wall is the result ($0.73, 1.87M prompt tokens, 75% cache)

The factory cleared every structural gate and did genuine comprehension work,
then blocked on exactly the signature ADR-029 was written to fix (from the
iteration-06 AC-2 root-cause): `map-repo: architecture` and
`deep-dive: src/engine/engine.ts` **exhausted their token budgets** trying to
comprehend the engine in a single un-splittable node — because the comprehend
family is still `leafOnly: true`, the very flag ADR-029 removes. The integration
eval confirmed no implementation landed ("leafOnly still true and no integration
merge logic"). No code was written; the run died in comprehension, before the
implementation step.

**The strange loop empirically proved its own thesis: comprehension must recurse
— demonstrated by comprehension failing because it cannot.** The factory cannot
bootstrap past this particular fix via `live:self`, by construction. No budget
bump escapes it (the iter-06 notes already proved 2M tokens exhaust; this run
burned 1.87M and died identically).

## Decision: hand-implement ADR-029 on main, then prove via live:self

Since the fix is the precondition for the factory self-building it, ADR-029 is
implemented directly on `main` (interactive/cleanup work per the branch rules),
offline-verified. `live:self` is then re-run on a SIMPLE feature to prove the
now-recursing factory can self-build — the AC-2 proof, decoupled from the
bootstrap paradox.

## ADR-029 implemented on main (92a00b7)

Hand-implemented (the factory can't bootstrap past its own missing recursion),
built in an isolated worktree by a Sonnet builder, reviewed and cherry-picked
onto main linearly. Three parts:

1. **comprehend.ts** — `leafOnly: false` on `map-repo` and `deep-dive-region`;
   harness prompts teach the split criterion (partition a too-large region into
   disjoint sub-regions covering the parent, each a child of the same type) and
   the integrate contract.
2. **engine.ts INTEGRATE + src/library/comprehend-merge.ts** — a structured
   merge replaces the generic `\n`-join for the comprehend family: child
   `KnowledgeArtifact`s merge into one (union pointers, min confidence,
   provisional, parent HEAD SHA); child `RegionFacts` merge into one (union
   anchored facts). The merged artifact is gated by the type's own
   `mapRepoCheck`/`diveAnchorCheck` and persisted via the same
   knowledge-written / knowledge-facts-written path a leaf uses. Gate failure
   blocks the split honestly; no valid child → graceful empty fallback.
3. **tests/engine/comprehend-recursion.test.ts** — proves both merges pass their
   gate and land exactly one parent knowledge event, plus the no-valid-child
   fallback.

Gates green on main: typecheck, lint, engine+brain+library suites (1109 passed).

**Open (Part 4, deferred):** `examples/live-foreign-eyes.ts` rewrite to a scoped
JIT intent (ADR-029 Decision 4) was out of the implementation scope. The AC-2
proof is the next step: re-run `live:self` on a SIMPLE feature to show the
now-recursing factory can self-build — decoupled from the bootstrap paradox.

## AC-2 proof runs after ADR-029 landed — recursion WORKS, but comprehension over-fires

Two `live:self` runs commissioning a TRIVIAL feature (a pure `formatDuration`
util in a brand-new empty `src/util/`) after ADR-029 landed. Budget raised to
80/5M/600 for the second to take budget arithmetic off the critical path.

**The success signal (recursion works):**
- A comprehension goal PASSED: `✓ [deep-dive-region] src/library/types/comprehend.ts`.
- Comprehension goals now SPLIT — the tree shows a `map-repo` for `conventions`
  with a nested `Map root /…` child. That nesting is ADR-029's recursion firing:
  a comprehension parent fanning out comprehension children, which `leafOnly`
  forbade before. The core thesis is validated end-to-end.

**The real problem exposed (architectural, not budget):** the run drowned in
~16 comprehension goals (map-repo ×6, deep-dive ×10) for a feature that touches
only a new isolated file and needs essentially NO comprehension. The coverage
gate demanded whole-repo maps (architecture, conventions) and deep-dives of
unrelated regions (`src/engine/engine.ts`, `knowledge-schemas.ts`). This
violates DESIGN.md's own JIT rule — "a region no goal touches is never mapped;
no comprehension is ever speculative." Cost ~$0.79, 1.88M prompt tokens, no PR.

This is exactly **ADR-029 Decision 2 + Decision 4** — scoped, split-gate-pulled
JIT comprehension and the `live-foreign-eyes`/commission rewrite — which were
NOT in the implemented scope (only the recursion mechanism, Decisions 1+3, was).
The mechanism recurses correctly; the layer that decides WHAT to comprehend
over-fires.

**Secondary decision-maker failure modes surfaced (good model, claude-sonnet-4):**
- `split decision missing children array` — model returned `{kind:"split"}` with
  no `children`. parseDecision throws → decide-fallback blocks. Candidate: tolerate
  (a childless split is a satisfy/block, not a hard error).
- A decide call emitted conversational prose ("Please provide the Codebase Summary
  Report…") instead of a decision — the comprehension decide prompt under-constrains
  output; the schema-constraint that fixed deliver-intent decide may not cover the
  comprehension decide path identically.
- Deep nesting still floors child attempts to 1 (`Fan-out of 7 > 1`) even at
  80 root attempts — subdivide's floor compounds with depth. Noted, not chased
  (budget is off the critical path by direction).

**Status:** ADR-029's recursion MECHANISM is proven working and landed. The next
real problem is comprehension SCOPING (over-firing / speculative whole-repo
comprehension), which is the unbuilt half of the ADR (Decisions 2+4) — a real
design iteration, not a knob.

# Iteration 09 — Comprehension scoping (ADR-029 Decisions 2 + 4)

Built on `main` (hand-build, per the bootstrap contract: commissioning this
through `live:self` would drown in the very over-firing it fixes). The recursion
MECHANISM (iteration 08, Decisions 1+3) was proven; this iteration builds the
layer that decides WHAT to comprehend.

## Root cause of the over-firing (iteration-08 proof runs: ~16 comprehension goals
## for a trivial new-util feature)

Two structural sources in the coverage policy table + the gate wiring:

1. **Whole-repo `architecture`+`stack` on every root split** (`coverage.ts`
   ROOT_SPLIT row). Any non-leaf make goal demanded the whole-repo maps
   unconditionally — no notion of "this intent is trivial / greenfield". A new
   isolated util triggered two whole-repo `map-repo` goals.
2. **Region dives for every UNIONED child scope** (`engine.ts` runCoverageGate).
   Every proposed make-leaf child's scope was unioned into the coverage goal,
   then a `deep-dive-region` miss was minted per uncovered scope entry — incl.
   regions a child was merely CREATING fresh. This was the ×10 dives of
   unrelated regions.

## The fix — relevance-bounded table (ADR-029 Decision 2)

Kept the deterministic, brain-free coverage table (ADR-021); made its DEMANDS
relevance-bounded by a new existence signal:

- `CoverageGoal.existsByRegion?: Record<string, boolean>` (pure data; absent ⇒
  treat-as-existing, so the whole pre-existing test corpus is byte-identical).
- **Greenfield root split:** a root split whose scope is non-empty and points
  ENTIRELY at new/untracked regions no longer pulls `architecture`+`stack`
  (`requiredCategories = []`). A scope-less whole-repo intent still does.
- **Region dives:** only EXISTING regions are dived; a region being created
  fresh is skipped.
- **Existence-filtered union (design fork, decided with the operator):** code-leaf
  make types are `leafOnly` → they go straight to `satisfy` and NEVER run their
  own coverage gate, so the PARENT is the only place their region dives can be
  pulled. So the child-scope union was KEPT (removing it wholesale would mean an
  existing-region feature never gets that region comprehended) but is now
  bounded by `existsByRegion`: union child scopes, dive only the EXISTING ones.
- Existence is an injectable seam on the knowledge wiring
  (`EngineOptions.knowledge.regionExists`), real `existsSync`-backed impl in
  `assembleKnowledgeWiring`, deterministic injection in tests. The engine keeps
  a private `regionExistsInTree` fallback for when the hook is absent.

## ADR-029 Decision 4 + robustness items

3. **`examples/live-foreign-eyes.ts` rewritten** to commission ONE real scoped
   intent against cats and let the split gate pull JIT comprehension, instead of
   speculatively commissioning four whole-repo `map-repo` categories. Asserts
   TWO things: the intent converges (no blockers) AND comprehension is scoped
   (map-repo + deep-dive count ≤ `COMPREHENSION_BUDGET`, default 6). Read-only:
   no prBoundary, so it cannot push or open a PR.
4. **`parseDecision` tolerates a childless split** (`src/brains/llm.ts`): a
   `{"kind":"split"}` with no/empty `children` now degrades to `satisfy` (handle
   as a leaf) instead of throwing → blocking the whole node. (iteration-08
   live:self failure mode.)
5. **Comprehension decide schema-constraint — VERIFIED ALREADY COVERED, no code.**
   There is exactly one decide path (`brain.decide`); it already passes
   `DECISION_SCHEMA` in json_schema mode and blocks-on-unparseable in the catch.
   The "conversational prose instead of a decision" mode the iteration-08 notes
   flagged is guarded for ALL decide calls, comprehension included. To be
   re-confirmed in the live proof run rather than re-coded.

## Tests + gate

- `tests/library/coverage.test.ts`: greenfield root split (no whole-repo demand),
  mixed/existing root split (still demands), new region (no dive), existing
  region (dive required), mixed dive, backward-compat (absent existsByRegion).
- `tests/brains/llm.test.ts`: childless split → satisfy; empty-children → satisfy.
- Two pre-existing tests updated to the new contract (NOT loosened): the
  convergence-eyes root-gate missing-set and the gates.test region-dive injection
  now turn on `regionExists` (the convergence fixture's `src/` really exists; the
  gates fake-repo injects existence). Both still assert the dive fires for an
  existing scoped region.
- `npm test`: **1403 passed, 21 skipped, lint clean.**

## Status — NOT YET PROVEN LIVE

The scoping fix is built, typechecked, and unit-proven. The AC-2 RE-PROOF is the
remaining step and is OPERATOR-RUN (needs OPENROUTER_API_KEY + GITHUB_TOKEN +
real spend, cannot run from the dev harness):

  - `live:self` on the trivial `formatDuration`-in-new-`src/util/` feature →
    expect a PR this time, with comprehension goal count near zero (was ~16).
  - `live:foreign-eyes` (rewritten) on cats → expect convergence + scoped
    comprehension (≤ 6).

Record the honest result here when run. Tune the `live:self` proving budget down
(currently 80/5M/600) once scoping is proven to reduce the goal count.

## AC-2 proof run #1 — live:foreign-eyes on cats (2026-06-23)

**SCOPING FIXED — but a budget/fan-out bug now blocks convergence.** This is the
bootstrap loop working: the factory got further (over-firing gone), then stalled
on the next limit down.

| Check | Result |
|---|---|
| Comprehension goals | **3** (2 map-repo + 1 deep-dive) — was ~16 |
| Scoping (≤ 6) | **PASS** ✓ |
| Convergence | **FAIL** — split structural validation |

Run nonce 551fd00a · cost $0.2212 · 92.8% cache-hit · intent = "add a doc comment
to the main entry-point file", scope `src/`.

**Why 3 and not ~0:** the intent scope `src/` EXISTS in cats and the feature
touches existing code, so the gate correctly pulls architecture + conventions
maps + one `src` dive. That is correct JIT comprehension, not over-firing — the
relevance bound is doing exactly its job. (The near-zero case is the
`formatDuration`-in-new-`src/util/` feature, where the scope is greenfield.)

**The new blocker (NOT a scoping bug — a pre-existing budget defect my fix
exposed by getting deeper into the tree):**

```
Split structural validation failed: Fan-out of 4 children exceeds parent
attempt budget of 1
Goal "Deep-dive region src" exhausted its toolCalls budget
Isomorphic failure detected (signature: step-loop:failed) — escalating to block
```

Root cause traced to its floor (not the gate, as first theorized):
`subdivide()` floors every child's attempts to `max(1, floor(parent.attempts ×
share))` (`budget.ts:15`). The root commissions `attempts: 5`; one level down a
~0.1–0.4 share floors attempts to **1**; from then on `validateSplit`'s fan-out
guard `children.length > budget.attempts` (`engine.ts:3265`) rejects ANY split
of ≥2 children at that depth. The failing "Fan-out of 4 > 1" is a FLOORED node
(the conventions-map's nested `characterize`, or a re-decided sub-node), not the
root. This is exactly the iteration-08 deferred defect ("subdivide floors child
attempts to 1 under depth", build-notes ~L845) — my scoping fix didn't cause it,
it REVEALED it by letting the tree recurse deeper than the over-firing runs ever
got.

This is an **ADR-007 issue.** ADR-007 chose `children.length ≤ attempts` as the
fan-out guard, but its real purpose was floor-affordability (don't let many
tiny-share children sum past the parent via the `Math.max(1,…)` floor), NOT
"decomposition is thrashing." `attempts` is the scarcest, fastest-flooring
dimension, so gating split WIDTH on it forbids legal decomposition at depth.
Each child runs on its OWN subdivided budget (`engine.ts:2819,2838`) — a parent
does not spend N attempts to fan out N children — so the coupling is wrong.
Fix (next hand-build): decouple the fan-out width guard from `attempts`; gate
width on floor-affordability in a dimension that funds work, preserving ADR-007's
"a fan-out cannot multiply costs past its root grant." Recorded as an ADR-007
amendment.

**A secondary real find:** the `deep-dive-region src` child exhausted its
toolCalls budget at depth — the same subdivide-floor family. Lower priority than
the fan-out guard.

**Decision:** AC-2 still RED on convergence (scoping PROVEN). Fix the
fan-out-vs-attempts coupling (ADR-007 amendment) before any deliver spend
(live:self). Scoping half of iteration 09 is proven; the budget half is the next
hand-build.

(Note: the harness reported exit 0 though the script prints FAILED and calls
`process.exit(1)` — the buffered stdout head was also lost. Cosmetic; the
substance above is from the script's own result summary.)

## Budget softening — ADR-030 (soft budgets until proven)

Operator directive after AC-2 proof run #1: *stop being hard with budgets and
bounds — they aren't based on anything real yet, and they're blocking the one
thing we need to prove (that the factory can build).* This is the same call the
codebase already made for `toolCalls` (warn-only since 2026-06-12), now
generalized.

ADR-030 changes (hand-built on main, the fixes that actually unblocked the live
run):
1. **Fan-out cap removed** — `validateSplit` no longer rejects `children.length
   > attempts` (and no longer takes a budget param). Width was keyed to the
   scarcest, fastest-flooring dimension; it forbade legal decomposition at depth.
2. **`subdivide` inherits `attempts`** instead of flooring to `max(1, floor(×
   share))` — each child keeps the full retry count at any depth.
   tokens/toolCalls/wallClock still subdivide for cost tracking.
3. **Kept hard:** dollar ceiling + wall-clock (real cost). **Kept as honest loop
   terminators (NOT softened this pass):** attempt/token exhaustion — a goal that
   burns its retries genuinely didn't converge → blocks → routes to the listener,
   which is real signal. Re-arm any of these the first time a trace shows it
   blocking legitimate work.

Tests: budget.test + gates.test block-behavior assertions REWRITTEN to the new
contract (wide splits accepted; deep nodes keep attempts; injection past the old
cap proceeds) rather than kept opt-in — per the operator's "delete the
block-behavior assertions, we don't believe in these bounds yet" call. Removed
dead code from the earlier existence-signal iteration (the engine's duplicate
`regionExistsInTree` + its fs imports; the wiring's `regionExists` hook is the
single source). 1403 green, lint clean.

**Next:** re-run `live:foreign-eyes` — the fan-out/floor blocker is gone, so the
scoped intent should now converge. Then `live:self` for the AC-3 PR proof.

## AC-2 proof run #2 (post-ADR-030) — WEDGED on an LLM transport hang (not a budget issue)

Re-ran `live:foreign-eyes` on cats after ADR-030 to retest convergence. The run
did NOT complete: it hung for ~37 minutes with **0% CPU, state sleeping, one
ESTABLISHED TCP socket to OpenRouter (:443 via Cloudflare), zero flushed output**.
Killed it (spending nothing, unrecoverable; in-memory event log died with it).

**Diagnosis (transport, NOT ADR-030):** `LlmBrain`'s fetch calls
(`src/brains/llm.ts:635` and `:961`) pass no `AbortController`/`signal` — there is
**no client-side request timeout.** The retry/backoff logic (incl. the explicit
`AbortError`/'timeout' handling at ~973) only fires when a request *fails*; a
request that *hangs* (server accepts the connection but never responds — exactly
what we saw) never throws, so it never retries. It waits forever. ADR-030's
wall-clock backstop didn't bite because the deadline is checked BETWEEN attempts,
not mid-`fetch` — the process was blocked inside one fetch that never returned.

This is consistent with the standing debug lesson (transport issues masquerade as
logic bugs; probe the wire). The budget softening is fine — this run never got far
enough to test convergence; it wedged on the network.

**Next hand-build (before any more live spend):** add a per-request timeout to
`LlmBrain` — wrap each fetch in an `AbortController` with a sane deadline
(injectable, like `sleepFn`), so a hung request aborts and routes through the
existing retry/backoff instead of blocking the whole run. THEN re-run
`live:foreign-eyes`. `live:self` stays deferred until AC-2 actually converges.

## AC-2 proof run #3 (post timeout fix) — no hang, recursion deeper than ever, now token-starved

Re-ran `live:foreign-eyes` on cats with BOTH ADR-030 (soft fan-out/attempts) and
the per-request timeout. Result: **the fixes worked, and the next bound bit.**

What worked (real progress):
- **No hang** — completed in minutes, $0.15 (timeout fix held).
- **Recursion went DEEPER than any prior run:** `deep-dive-region src` split into a
  nested `deep-dive-region src/utils`; `map-repo conventions` PASSED (✓) and spawned
  a `propose-pattern` child that also passed. ADR-029 recursion firing as designed.
- **Scoping held:** 4 comprehension goals (`✓ scoped ≤ 6`). No fan-out blocker.

The new blocker (the honest one we predicted):
```
Goal "Map repo: architecture" exhausted its tokens budget
Goal "Walking skeleton deep-dive on src/utils" exhausted its tokens budget
```
Convergence failed because two comprehension goals ran out of **tokens** — the
dimension ADR-030 deliberately LEFT as a hard block ("honest loop terminator").
Now a real trace shows it blocking LEGITIMATE work, which is ADR-030's own
re-arm/loosen trigger.

Root cause is the SAME flooring pathology we fixed for attempts, still present for
tokens: `subdivide` divides `tokens` by share, so a comprehension child gets a
FRACTION of the root grant, and a deeper child (`src/utils`) gets a
fraction-of-a-fraction → starves at depth. The root commissioned 2M tokens but
`map-repo architecture` only saw its share.

**Next hand-build:** stop subdividing tokens the way we stopped subdividing
attempts — tokens should be a tracked/reported soft signal bounded by the real $
ceiling, not a per-node hard wall that floors to nothing at depth. (Decide with
operator: inherit tokens like attempts, or keep proportional tracking but make
token exhaustion warn-only / not-blocking.) THEN re-run. Cost so far across 3 AC-2
runs: ~$0.59 total.

## AC-2 proof run #4 — toolCalls is the last divided dimension; recursion-depth smell appears

Re-ran with attempts+tokens inherited. No hang, no fan-out block, no token
starvation. Scoping held (6 goals, at the ≤6 boundary). Convergence still failed:
```
Goal "Map repository structure" exhausted its toolCalls budget
Goal "Map repo: conventions" exhausted its toolCalls budget
"What is the directory and file listing of the src directory? I need ... to plan the mapping."
```

Two findings:

1. **toolCalls flooring — the same pathology, third dimension.** `subdivide` still
   divides toolCalls by share, so deep comprehension children starve before they
   can even run a directory listing (one block is literally the brain asking for
   an `ls` of src it couldn't afford to run). attempts and tokens are inherited
   now; toolCalls is the last divided dimension. Fix: inherit toolCalls too (it is
   already warn-only via enforceToolCallBudget=false in production, but the live
   harness/sandbox path still hard-floors the subdivided count). Cost $0.09.

2. **Recursion-depth / redundancy smell (flag, don't chase blindly):** the tree is
   getting DEEPER and more redundant, not converging — a `map-repo` spawned a
   `deep-dive` that spawned ANOTHER `map-repo` ("Explore repository to discover
   architecture" → "Map repository structure"). Comprehension is re-deriving
   comprehension. Once toolCalls stops starving it, watch whether it converges or
   keeps splitting comprehension-into-comprehension. If the latter, the next real
   issue is comprehension's decide prompt (when to SATISFY vs keep splitting), not
   another budget knob.

Cost across 4 AC-2 runs: ~$0.68 total.

## Investigation between runs #4 and #5 — the decide path was deciding BLIND

Per operator direction, investigated the run-#4 recursion smell (a `map-repo`
splitting into a `deep-dive` that split into another `map-repo`) before spending
on run #5. Root cause found, and it is NOT a budget issue:

**The decide path injected no family skill and no split criterion.** When the
brain decides satisfy-vs-split, it received only a generic "you are a
decision-maker" system prompt + goal context + memories + the type catalog. The
"split only when the region is too large; partition into same-category
sub-regions" guidance lived ONLY in a code comment in `comprehend.ts` — never
sent to the model. And `loadFamilySkill` was wired into the produce (step-loop)
and judge paths but NOT the decide path. So the brain over-split comprehension
because nothing told it not to — the same disease as the original over-firing,
one layer in (we fixed how many comprehension goals get MINTED; this is how
readily each one SPLITS).

Fix (skill injection into decide, for ALL families — the principled seam, not a
comprehend special-case):
- `BrainContext.skill?` (contract) — optional family-skill guidance for the
  decide call.
- Engine `decideSkillBlock(goalType)` builds preamble+section (same shape the
  step path uses) and populates `baseCtx.skill` before `brain.decide`.
- `LlmBrain.decide` injects a `FAMILY SKILL` block into the decide message.
- `comprehend.md` gains explicit satisfy-vs-split guidance: DEFAULT TO SATISFY;
  split only a genuinely too-large region; children must be the SAME
  comprehension type, disjoint, covering the parent. (This preamble is what the
  decide call now sees.)

Now every family decides WITH its craft guidance, not blind. Tests: decide
injects ctx.skill / omits when absent; 1407 green, lint clean. Ready for run #5.

## AC-2 proof run #5 — BREAKTHROUGH: comprehension fully converges; only the implement leaf fails

The decide-skill fix worked. Tree:
```
✗ deliver-intent
  ✓ map-repo: architecture           ← PASSED
  ✓ map-repo: conventions            ← PASSED
  ✓ deep-dive-region: src            ← PASSED (the run-#4 nested map→dive→map cascade is GONE)
  ✓ map-repo: Identify the main entry-point file in src/   ← PASSED
  ✗ implement: Add doc comment block to entry-point file   ← the ONLY failure
```

**The entire comprehension layer converged** — 4 scoped goals, all passed, 3
knowledge artifacts written. No over-firing, no over-splitting, no starvation, no
hang. This is the comprehension half of the factory (everything iteration 09 was
about) working END-TO-END on a real foreign repo for the first time. We went from
"can't comprehend anything / drowns in 16 speculative goals" to "comprehends a
real repo cleanly in 4 scoped goals."

**Remaining failure (isolated, downstream of comprehension):** the `implement`
leaf explored but did not actually write the doc comment, so the integration eval
correctly failed ("No documentation comment block added to main entry-point
file") and the leaf burned its attempts. This is NOT comprehension, budget, or
transport — it's the deliver/implement leaf either (a) not making the edit, (b)
writing it outside declared scope / where the gate can't see it, or (c) emitting
without writing. Cost $0.69 (comprehension did real work this time).

**Next:** root-cause the implement leaf — read the deliver/implement harness +
the integration eval to see whether the brain wrote nothing, wrote out of scope,
or emitted-without-writing. This is the last gap between AC-2 and convergence.
Cost across 5 AC-2 runs: ~$1.37 total.

## AC-2 run #6 — TRACE PAID OFF: map-repo can't obtain the HEAD SHA, thrashes to token death

Persisted the event log (CORELLIA_EVENTS_PATH) + replayed via scripts/trace.ts.
The trace made the root cause unmistakable. `map-repo: architecture` spent **45
steps** almost entirely failing to obtain the HEAD SHA its artifact requires
(`generatedAtSha`):

- `run_script "git rev-parse HEAD"` → REFUSED (not in the declared script set).
- `read_file .git/HEAD` → ENOTDIR (the sandbox is a WORKTREE; `.git` is a FILE
  pointing to the real gitdir, not a directory).
- `.git/refs/heads/main`, `.git/worktrees`, the real gitdir → REFUSED (outside
  the sandbox root) or ENOTDIR.
- Dozens of duplicate-read refusals (F-64) as it retried the same dead paths.

It burned the full (now-inherited) 2M token budget thrashing against the sandbox
boundary, then emitted and hit `budget-exhausted: tokens`. (Run #5's architecture
map happened to succeed — this SHA-fetch is UNRELIABLE; sometimes the model gives
up and emits with a placeholder SHA, sometimes it thrashes to death. Run #5 even
showed `generatedAtSha=worktree`/`unknown` — placeholder SHAs, a related symptom.)

**Root cause (engine/tooling gap, NOT prompt):** the factory REQUIRES comprehension
artifacts to carry the current HEAD SHA, but gives the comprehension leaf NO
reliable, sanctioned way to read it — `git rev-parse` isn't declared, and the
worktree's `.git` indirection + sandbox scoping block every direct read. The
engine ALREADY computes `gitHeadSha(repoRoot)` for the coverage gate; it should
hand that SHA to the comprehension leaf (inject into goal spec/context) so the
brain never fetches it. Candidate: populate `spec.generatedAtSha` (or a context
field) for map-repo / deep-dive-region goals from the engine's gitHeadSha.

Also confirmed by trace: comprehension OVER-EXPLORES (45 steps, dozens of
list_dir/read_file) vs the skill's "4-6 representative reads" — partly downstream
of the SHA thrash, but the economy bound isn't being honored. Lower priority than
the SHA gap.

Cost run #6: $1.41 (the thrash is expensive). Cumulative across 6 runs: ~$2.78.

## AC-2 run #7 — head_sha works; remaining failures are BEHAVIORAL (over-explore / block-without-trying)

head_sha fixed the SHA thrash: `map-repo: architecture` PASSED with a real SHA
(9ed64ff7), and the dive called `head_sha → ran` cleanly — no more `.git`
flailing. That structural gap is closed. Cost $0.44.

But two NEW failure modes, both behavioral (the brain not following the skill),
surfaced via the trace:

1. **`map-repo: conventions` decided `block` immediately** — zero tool calls. It
   emitted a brief: "Cannot access the repo at <cats>. Please provide the root
   listing + package.json + a source file + a test file." The repo IS accessible
   (architecture mapped it fine in the same run). The brain gave up at the decide
   step and asked the HUMAN for files instead of using list_dir/read_file. This is
   the "comprehension decide emits a please-provide-files block instead of doing
   the work" mode (related to what iteration-08 notes flagged; the decide-skill
   injection did not prevent it here).

2. **`deep-dive-region src` exhausted wallClockMs** (a REAL backstop, not an
   arbitrary count) — it over-explored: dozens of read_file/list_dir on cats (a
   Python repo, src/cats/main.py), well past the skill's "4-6 representative
   reads, depth over breadth." Same over-exploration the run-#6 architecture map
   showed, now hitting wall-clock instead of (inherited) tokens.

These are NOT structural/budget/transport gaps — they're the comprehension brain
not honoring its own craft (use tools; bound exploration; don't block-and-ask).
Inflection point: the next lever is prompt/behavior discipline (and possibly
model tier), not another engine knob. Worth a step-back with the operator before
more spend. Cumulative across 7 runs: ~$3.22.

## AC-2 run #8 — PASSED. Full convergence on a real foreign repo. 🎉

The skill hardening worked, AT MID TIER (no model bump). Tree — every goal green:
```
✓ deliver-intent
  ✓ map-repo: architecture
  ✓ map-repo: conventions            ← used tools (no more block-and-ask)
  ✓ deep-dive-region: src            ← stayed under the read ceiling (no wall-clock death)
  ✓ map-repo: Identify the entry-point file
  ✓ implement: Add documentation comment block   ← THE IMPLEMENT LEAF RAN AND WROTE IT
```

`convergence: ✓ (no blockers)` · `AC-2 CHECKPOINT: PASSED` · $0.59 · 80% cache.

A scoped intent went END-TO-END on a real foreign repo for the first time:
comprehend (4 scoped goals, all passed, 3 artifacts written with real SHAs) →
identify target file → implement → integration eval passed. The implement leaf —
which had never succeeded — delivered once comprehension stopped starving it and
the behavioral fixes landed.

**AC-2 is PROVEN.** Iteration 09 (comprehension scoping, ADR-029 Dec 2+4) +
ADR-030 (soft budgets) + the transport timeout + decide-skill injection +
head_sha tool + comprehend behavior hardening together took the factory from
"drowns in 16 speculative comprehension goals, never converges" to "converges a
real scoped intent on a foreign repo." AC-2 was the blocker on AC-3/AC-4
(deliver-to-self / deliver-to-foreign); those are now unblocked.

Total live spend across 8 AC-2 runs this session: ~$3.81. Every run bought a
real fix (see the run-by-run sections above).

**Next:** AC-2 being green, `live:self` (AC-3: factory delivers to its OWN repo,
opens a real PR) is now approved to attempt.

# AC-3 (live:self — corellia delivers to its OWN repo) — first attempts

## AC-3 run #1 — did NOT converge; block-without-trying recurred on the bigger repo

Commissioned the greenfield `formatDuration` util (src/util/, tests/util/) so
comprehension would be near-zero and the deliver+PR path was isolated. Result:
no PR; blocked. $0.17. Findings (saved for later — several are reusable beyond AC-3):

### FINDING 1 (safety, low-sev): strange-loop hygiene check has a FALSE POSITIVE
live:self printed "Primary clean after run: NO — investigate!" but the primary
checkout was CLEAN of factory changes — the only `git status` output was the
pre-existing untracked `media/video.zip` (present since session start). The
script's check treats ANY `git status` output (incl. pre-existing untracked
files) as "dirty". Risk: alarm fatigue masks a REAL disturbance. Fix later: the
check should compare against a baseline (pre-run `git status`) or ignore
untracked paths it didn't create, so "NO" means a genuine factory-caused change.
Branch stayed `main`; worktree was left uncollected (expected for a blocked, not
shipped, run — isolated under gitignored .corellia/worktrees/).

### FINDING 2 (behavioral, the real blocker): block-without-trying RECURRED at mid tier
`map-repo: architecture` `decided: block` with ZERO tool calls (trace confirms no
tool-call events), fabricating a justification: "I attempted to list the repo
root but received no output. Is the repo mounted?" It did NOT attempt list_dir —
it blocked at the decide step and invented a reason. This is the SAME mode the
run-#7 conventions failure showed and that comprehend.md hardening fixed on cats
(run #8). It recurred here on corellia — a LARGER, denser repo. So:
  - The prompt hardening reduced but did not ELIMINATE block-without-trying; it
    is model-judgment variance at `mid` tier, worse on a harder repo.
  - This is now real evidence for the deferred TIER BUMP: comprehension is the
    load-bearing family and blocks-without-trying under load. Candidate: default
    map-repo/deep-dive-region to `high` (was deferred in favor of testing the
    prompt alone — the prompt alone is insufficient on a dense repo).
  - Possible engine-side hardening: a comprehension goal that emits a `block`
    brief WITHOUT having made a single tool call is almost always
    block-without-effort — the engine could reject such a block (treat as "must
    try first") rather than letting it bounce. Worth considering vs. prompt-only.

### FINDING 3 (eval, medium): integration judged a comprehension artifact as the deliverable
Second blocker: "artifact contains only project conventions metadata instead of
deliverable code." With the architecture map blocked, the deliver leaf's
dependency failed; the integration eval still ran and judged a CONVENTIONS
artifact where the formatDuration module was expected. Two sub-issues to probe
later: (a) why did integration run / judge at all when a child dependency
blocked? (b) the merged/eval artifact was a knowledge artifact, not code — the
deliver assembly may be picking up the wrong child artifact when the code leaf
never produced one.

### Variance note
Run #8 (cats): all comprehension passed. AC-3 #1 (corellia): architecture
blocked. Same code, different repo + a fresh roll → different outcome. The
remaining failures are non-deterministic LLM behavior, not deterministic bugs.
The levers are tier + (optional) engine-side block-without-effort rejection.

Cumulative live spend this session (8 AC-2 + 1 AC-3): ~$3.98.

### ROOT CAUSE FOUND (not tier — operator was right to push): sandbox path contradiction

Traced via the persisted log (compared the PASSED conventions goal vs the BLOCKED
architecture goal — SAME repo, SAME run, SAME tier, so tier is definitively not
the differentiator). The conventions goal's first tool call:
```
tool-call: list_dir → ran
tool-call: list_dir → refused — list_dir: path "/Users/keith/dev/gauntlet/corellia" is outside the sandbox root
```
The brain's instinct is to list the `repoRoot` it was handed in the spec
(`/Users/keith/dev/gauntlet/corellia`) — but the file tools are bound to the
WORKTREE sandbox, which REFUSES that absolute path as "outside the sandbox root".
conventions happened to also issue a relative `list_dir` and recovered;
architecture tried the absolute path, got refused, and (weak-judgment path)
concluded "repo unreachable" and blocked with a fabricated "received no output".

So the "block-without-trying" was NOT model weakness — it was the engine handing
the brain an absolute repoRoot its own sandboxed tools forbid. A tier bump would
only improve the odds of the lucky relative-path guess; it would not remove the
contradiction. (This retro-explains the cats variance too: smaller repo, fewer
chances to fixate on the absolute path.)

**Fixes (both landed, 1411 green):**
1. (cause) Step harness now states the sandbox-path contract for in-sandbox goals:
   "your file tools operate on a sandboxed copy mounted at the sandbox root — use
   RELATIVE paths; the absolute repoRoot in the spec is reference-only and is NOT
   tool-readable; do not conclude the repo is missing if an absolute path is
   refused." (src/engine/engine.ts step harness.)
2. (backstop) A comprehend-family `block` at the top-level decide (before any tool
   runs) is coerced to `satisfy` — a comprehension goal cannot legitimately know
   it is blocked before probing the sandbox. Real blockers still surface from the
   attempt loop after actual tool use. Non-comprehend (deliver/build) blocks are
   untouched.

### FINDING 4 (tooling, low-sev): orphaned worktree from a blocked run pollutes vitest
The blocked AC-3 run left .corellia/worktrees/live-self-…/ uncollected (expected —
collection is keyed off a verified-shipped list). But vitest globbed its copy of
the test files and ran them twice. Torn down manually here. Fix later: either
collect/prune worktrees on a blocked run too, or add .corellia/worktrees to the
vitest exclude so leftover trees never pollute a local test run.

FINDING 1 (false-positive hygiene check) and the tier question remain open but
de-prioritized: tier was a red herring; the path contract was the real cause.

## AC-3 run #2 — sandbox-path fix WORKED; next layer is a conventions-pointer contract mismatch

The sandbox-path fix landed cleanly. Trace of `map-repo: conventions` (the goal
that blocked-without-trying in run #1) shows the fix working:
- ZERO "outside the sandbox root" refusals — every list_dir/read_file `→ ran`.
- `decided: satisfy` and actually probed the repo with relative paths.
- The fabricated "repo unreachable" block is GONE.

It now fails for a real, different reason — the deterministic gate:
```
deterministic: FAIL — knowledge:map-repo: Conventions exemplar pointer(s) not found: src/library/skills/
tier: mid → high
deterministic: FAIL — knowledge:map-repo: Conventions exemplar pointer(s) not found: src/contract
(exhausted attempts)
```

### FINDING 5 (contract mismatch + misleading error): conventions pointers at DIRECTORIES
`conventionsCheck` (knowledge-checks.ts:428-435) validates each exemplar pointer
with `readFile(join(root, pointer.path))` — i.e. it requires a readable FILE. The
brain pointed at DIRECTORIES (`src/library/skills/`, `src/contract`) — reasonable
"these dirs exemplify our conventions" pointers. `readFile` on a dir throws EISDIR
→ caught → reported as "not found". TWO problems:
  1. The error message is MISLEADING: the path is NOT missing, it's a directory.
     This is why the brain couldn't self-correct across mid→high attempts — it was
     told "not found" for a path it could see exists, so it thrashed and exhausted.
  2. Contract ambiguity: comprehend.md says "point at exemplar FILES", but the
     brain naturally points at dirs, and the gate only accepts files.

Design choice (for the operator) — which side is wrong?:
  (a) Gate too strict: accept a pointer whose path EXISTS (file OR directory) —
      use stat() not readFile(); a directory exemplar ("see src/contract/* for the
      type-definition conventions") is legitimate. Also fix the misleading message
      (distinguish missing vs directory). Most forgiving; matches what the brain
      produces.
  (b) Brain wrong: harden comprehend.md to point ONLY at specific files (e.g.
      src/contract/goal.ts:1), never directories — keep the gate file-strict but
      fix the message so a dir pointer says "must be a file, not a directory" so
      the brain can self-correct.
  (c) Both: accept existing paths (file or dir) AND fix the message AND nudge the
      skill toward files. Belt-and-suspenders.

### FINDING 3 recurs: integration eval judged the comprehension artifact as the deliverable
Same as run #1: "Artifact is architectural overview, not the requested utility
module." With conventions blocked, the deliver leaf's dependency failed, yet the
integration eval still ran and judged a knowledge artifact where code was
expected. Still worth probing: why does integration judge at all when a child
dependency blocked, and is it picking up the wrong child artifact?

Hygiene false-positive (FINDING 1) recurred (media/video.zip); primary actually
clean, branch main. Worktree live-self-3fa1e189 left uncollected (blocked run).
Cost run #2: $0.61. Cumulative this session: ~$5.20.

## AC-3 run #3 (correct model z-ai/glm-5.2 + engine fixes) — deepest yet: tests PASS, source leaf fails on scope gate + no declared scripts

With the model wiring fixed (high tier = z-ai/glm-5.2, not the silently-wrong
claude-sonnet-4) and the sandbox-path/block-coercion/conventions-pointer fixes in,
this is the furthest AC-3 has reached. Tree:
```
◌ deliver-intent (attempt 1)
  ✓ map-repo: architecture
  ✓ map-repo: conventions
  ✓ implement: Write comprehensive tests for formatDuration   ← a TEST leaf PASSED
  ◌ implement: Implement formatDuration utility function
✗ deliver-intent (retry)
  ✗ implement: ...test-first... exhausted attempts
```
Comprehension converged cleanly (no block-without-trying, no SHA thrash) and an
implement leaf delivered passing tests. Cost $2.13. No PR. Two gaps, both from the
trace:

### FINDING 6 (env gap): live:self declares NO scripts, so the brain can't self-verify
The intent says "keep typecheck, lint, and the full test suite green", and the
implement leaf correctly tried to run them — but live-self.ts passes
`declaredScripts: {}`, so every `run_script test|typecheck|lint` is REFUSED ("not
in the declared set"). The brain can't confirm its work is green, so it re-reads /
re-searches / retries to exhaustion. Same class as the head_sha gap: the factory
asks for verification it doesn't grant the tool for. Fix: declare corellia's own
scripts (test/typecheck/lint from package.json) in the live:self sandbox so a
self-build can verify itself.

### FINDING 7 — INVESTIGATED, NOT A BUG (corrected). Scope enforcement worked correctly.
Initially read as a scope/parse bug; the event log disproves it. `isInScope` is
correct (`src/util/format-duration.ts` ∈ `['src/util/']` → true, unit-confirmed).
The refused `write_file` to `src/util/format-duration.ts` came from the leaf scoped
`['tests/util/']` (the "write tests" leaf) — it over-reached and tried to write the
SOURCE file; the tool correctly refused it as out of scope (that leaf's in-scope
`tests/util/` writes succeeded; it passed). The "ts, ts" `files-within-scope`
failure was a DOWNSTREAM symptom: the separate source leaf, unable to self-verify
(finding 6), thrashed and emitted a malformed final artifact using markdown
language-tag fences (```ts) which `parseFileBlocks` read as path="ts". No
scope/parse fix needed — fixing finding 6 (let the leaf verify) removes the thrash
that produced the malformed artifact. (If language-tag fences recur after that,
harden parseFileBlocks then — but not before evidence shows it still bites.)

Model note: z-ai/glm-5.2 behaved well on the comprehension + decide paths — no
block-without-trying recurrence this run. The remaining failures are NOT model
quality; they're the two gaps above. Cumulative AC-3 spend: ~$5.0.

## AC-3 run #4 (declared scripts) — finding 6 FIXED; finding 7 is REAL after all (fence parser)

The declared-scripts fix worked: the implement leaf wrote the files AND verified
them — `run_script typecheck → exit 0`, `run_script lint → exit 0` (both green).
The code is correct. But at emit it STILL failed:
```
step 6: typecheck → 0
step 7: lint → 0          ← code written + verified green
step 8: artifact
deterministic: FAIL — files-within-scope: File(s) outside declared scope: typescript, typescript
```

So finding 7 IS a real, recurring bug (my run-#3 "not a bug" call was wrong — that
run's thrash masked it). The leaf emits its final artifact as markdown fences
tagged with the LANGUAGE (```ts last run, ```typescript this run), and
`parseFileBlocks` (llm.ts) reads the fence-line token as the file PATH → path
becomes "typescript"/"ts" → files-within-scope rejects it. It bites every time the
leaf emits fenced code with a language tag. The work is done and green; only the
artifact SERIALIZATION corrupts the path.

Fix: parseFileBlocks must not treat a bare language tag as a path (a path has a
'/' or a '.'); + the produce prompt should say the fence line is the full relative
path, never a language like ```ts. (This is the fix proposed at run #3 and
deferred — the evidence now justifies it.)

Incidental: this run's `npm test` output showed a PRE-EXISTING flaky test —
`tests/library/script-runner.test.ts > runs an npm-script:<name> entry` timed out
at 5s (the self-build ran the full suite as part of verifying). Separate finding;
not caused by this work. Bump its timeout or make it deterministic.

Cost $0.34. Cumulative AC-3 ~$5.3.

## Fixes for AC-3 run #4 findings (fence parsing + targeted test execution)

**Fence parsing (the real blocker — confirmed recurring).** The brain emits its
final artifact as language-tagged markdown fences (```ts, ```typescript); the
parser read that token as the file PATH. Fixed both sides:
- parseFileBlocks now only accepts a path-like fence token (has a '/' or '.'); a
  bare language tag is ignored, so a slip can't corrupt the artifact's path.
- The produce + repair prompts now state the fence line MUST be the full relative
  path, with a concrete example, never a language tag.
- Tests: language-tag fence → not a files artifact; path-like fence parsed even
  when a language-tag fence precedes it.

**Targeted test execution (operator directive: don't force the whole suite).**
run_script now takes an optional validated `target`:
- ScriptRunner.run(name, target?, timeLimitMs?) — the target is validated
  (relative in-repo path/pattern; no abs, no '..', no shell metacharacters) and
  appended to the operator-declared command (npm gets `-- <target>`), so the
  factory runs a subset in the project's OWN runner without any freeform-shell
  hole. The declared command fixes the runner (any language/paradigm); only the
  target is the model's input.
- run_script tool + loggingScriptRunner thread `target` through; build.md tells
  the brain to use run_script(test, target=...) for targeted runs and reserve the
  full `test` for final confirmation.
- Tests: validated target forwarded + echoed; invalid targets refused with no
  spawn; validateScriptTarget unit cases.

Note: the run-#4 trace also showed a pre-existing flaky test (script-runner
npm-script entry, 5s timeout) — it passed comfortably (511ms) after the
positional-arg fixes in this change; watch it but no action taken.

1418 tests green, lint clean. Next: re-run AC-3 — the code already builds + verifies
green; the artifact should now serialize with correct paths and open the PR.

## AC-3 run #5 — CONVERGED. The strange loop closes: corellia delivers a verified feature to itself. 🎉

Tree — every node green, ZERO blockers:
```
✓ deliver-intent
  ✓ map-repo: architecture
  ✓ map-repo: conventions
  ✓ implement: format-duration test-first (src/util/format-duration.ts + tests/util/format-duration.test.ts)
```
`Blockers: none`. The factory built formatDuration, wrote its tests, verified them
green (typecheck/lint/targeted tests), and emitted a CLEAN artifact — the fence fix
worked, the deliver leaf converged. $0.25, 84% cache. **First end-to-end delivery
of a feature to corellia's own repo.** Strange-loop hygiene intact: worktree
COLLECTED + torn down (only happens on success), primary clean (the post-check's
"NO" is the pre-existing media/video.zip false-positive), branch still main.

This is the seven-run AC-3 arc paying off — each run bought one fix: soft budgets,
transport timeout, decide-skill, head_sha, sandbox-path truth, block-coercion,
conventions-pointer, the correct prescribed model (z-ai/glm-5.2 vs the silent
claude-sonnet-4), declared scripts, fence parsing, targeted tests.

### Remaining gap (NOT a bug): the deliver SUCCESS path doesn't push/open a PR
`No PR opened` — and the trace shows push_branch / open_pr were NEVER ATTEMPTED
(not refused). Per live-self.ts's own note, PR-opening is wired to the IMPROVEMENT
loop (fires on blockers), not the happy-path deliver. A deliver that converges with
no blockers collects the verified worktree but has no "now ship it" step. So AC-3's
build half is PROVEN; the literal "opens a PR" half needs the deliver success path
to push the collected branch + open_pr. Candidate: on a converged deliver with a
prBoundary configured, push the collected worktree branch and open one PR.

Cumulative AC-3 spend: ~$5.6.

## NEXT (recorded for a future iteration): multi-branch / multi-tree PARALLEL build + aggregation

Today the engine uses ONE shared worktree per tree (ADR-016): every leaf writes to
the same branch tree/<id>, collected together at root success → one branch → one
PR. Serial aggregation is trivially handled.

NOT yet built — genuinely-concurrent leaves in SEPARATE worktrees, folded back to a
single base branch the PR opens from (the kmaz-build-iteration pattern: concurrent
features each get a worktree, cherry-picked back onto the trunk). This needs real
engine concurrency: per-leaf worktrees, a cherry-pick/merge aggregation edge before
emit, and conflict handling. The split mechanism + dependency scheduler already
model "independent children run in parallel" (DESIGN.md), so the gap is the
execution substrate (one worktree → many) + the fold-back edge, not the planning.
This is the next major iteration after AC-3's ship step.

## AC-3 ship step — `open-pr` leaf (brain-driven, per operator choice)

deliver-intent is a non-leaf splitter with no code/PR grants, so shipping is its
own step. Added an `open-pr` leaf type (kind make, leafOnly, family deliver,
grants repo.branch + repo.pr). The deliver root spawns it LAST, dependsOn every
build child; its job is push_branch → open_pr (one PR, left open — the factory
never merges), recorded in deliver.md. Brain-orchestrated (keeps the tool model),
not an engine side-effect.

Aggregation today is trivial: ONE shared worktree per tree (ADR-016), so all
children land on one branch and open-pr pushes that single branch. (Multi-tree
parallel build + fold-back is the recorded next iteration.)

Tests: open-pr contract (make/leaf/deliver, repo.branch+repo.pr, no fs.write);
type count 19→20 across starter-types + skills-wiring. 1418+ green, lint clean.
Next: re-run live:self — expect the brain to spawn open-pr and actually open a PR.

## AC-3 run #6 — PROVEN. The factory builds AND SHIPS a feature to its own repo. 🎉

Tree all-green, zero blockers, and the ship step fired:
```
✓ deliver-intent
  ✓ map-repo: architecture
  ✓ map-repo: conventions
  ✓ implement: format-duration test-first and verify suite
  ✓ open-pr: Open PR for format-duration utility
```
Verified from the event log: push_branch → ran, open_pr → ran, pr-opened →
**https://github.com/kmazanec/corellia/pull/6** (branch tree/live-self-c88f1b01-…).
The deliver root spawned the new open-pr leaf, which pushed the collected branch
and opened ONE real PR, left open for human review. $0.39, 84.7% cache.

Strange-loop hygiene intact: worktree COLLECTED + torn down (success-only),
primary clean (post-check "NO" = the pre-existing media/video.zip false-positive),
branch still main. The factory operated on its own repo without disturbing the
primary checkout.

**AC-3 is PROVEN end-to-end: corellia comprehends its own codebase, builds a
feature test-first, verifies it green (typecheck/lint/targeted tests), and opens a
real PR — autonomously.** This was the named blocker on AC-3/AC-4 since iteration
06; AC-4 (deliver-to-foreign) is now unblocked.

Total AC-3 arc: 6 live runs, ~$6.0, each buying a real fix (soft budgets, transport
timeout, decide-skill, head_sha, sandbox-path truth, block-coercion,
conventions-pointer, correct prescribed model, declared scripts, fence parsing,
targeted tests, and the open-pr ship step). Every fix landed on main with tests.

# Iteration 10 — AC-4: deliver-to-foreign (cats). Harness/engine readiness findings.

With AC-3 proven, AC-4 (the PRD's second Desired-Outcome half — a feature ships on
a repo the factory did NOT write) is unblocked. Target: **cats**
(`/Users/keith/dev/gauntlet/cats`). Before any live run, reading `examples/live-foreign.ts`
against the proven `live:self` harness and inspecting the cats repo surfaced FOUR
load-bearing readiness gaps. Recording them here (bootstrap loop: record the stuck
point before hand-building) — these are real engine/harness fixes, not config tweaks.

**FINDING A — the PR boundary is GitHub-only; cats' `origin` is GitLab.** cats'
`origin` remote is `ssh://git@labs.gauntletai.com:22022/keithmazanec/cats.git` — a
self-hosted **GitLab** instance (confirmed: `/api/v4/version` → 401, `sign_in`
redirect). `deriveRepoSlug`/`extractRepoSlug` only match `github.com` URLs → return
`null` for cats' origin, so `live:foreign` exits at the slug-derivation guard before
doing anything. And `open_pr` POSTs to `api.github.com` regardless. *Unblock:* cats
also has a **`github` mirror remote** → `git@github.com:kmazanec/cats.git` (Keith's
own repo, push access). AC-4 opens a real PR against that GitHub mirror — the
supported path. The harness must derive the slug from the `github` remote, not
`origin`.

**FINDING B — `push_branch` hard-codes `remote = 'origin'`** (`pr-tools.ts`). For
cats the PR-target remote is `github`, not `origin` (origin is GitLab). Pushing to
origin would push to the wrong host. *Fix:* thread an optional `remote` through
`prBoundary` → `pushBranchTool` (default `'origin'`, preserving every existing
caller); the harness sets it to `github` for cats.

**FINDING C — `deriveRepoSlug` reads only `origin`.** Add an optional remote-name
param (default `origin`) so the harness can read the slug from cats' `github`
remote. (`getOriginUrl` inside `push_branch` similarly assumes origin, but it is
only used for the process-clean diff label + the `branch-pushed` event's `remote`
field; the actual push target is the new `remote` param. Left as-is for now —
not load-bearing for the push itself.)

**FINDING D — the declared-script scheme is Node/npm-only; it cannot express a
Python verify command.** `createScriptRunner` accepts exactly two declared-entry
forms: `npm-script:<name>` (→ `npm run <name>`) or a repo-relative **node** script
file (run with `process.execPath`). cats has no `package.json`; its checks are
`uv run pytest` / `uv run ruff check .` / `uv run mypy` (via a Makefile with
`test`/`lint`/`typecheck` targets). Neither declared form fits — so the cats deliver
leaf would have NO way to verify its own work, which is exactly the AC-3 failure
mode (finding 6: "let the leaf verify"). This violates the PRD's stated
"stack-agnostic via repo scripts" requirement. *Fix:* add a third declared-entry
form — **`make:<target>`** — that spawns `make <target>` (+ the validated model
`target` appended), keeping the operator-fixes-the-command / model-supplies-only-the-
target security invariant and staying stack-agnostic (any repo with a Makefile).
cats declares `test → make:test`, `lint → make:lint`, `typecheck → make:typecheck`.

Plan: implement B+C+D (small, tested engine changes), rewrite `live:foreign` to use
the github mirror + cats' make-scripts + AC-3-style budget headroom, gate green,
then run the first live AC-4 proof — expecting, like the AC-3 arc, that each run
buys one more real fix.

## AC-4 run #1 — comprehension SCOPED + green; implement leaf starved by a non-verifiable env. 3 findings.

First live deliver to cats (`format_usd` helper). Intent id `live-foreign-7db58678`,
$1.075, 91.7% cache. Tree:
```
✗ deliver-intent
  ✓ map-repo: architecture
  ✓ map-repo: conventions
  ✓ deep-dive-region: src/cats/agents/common
  ✓ deep-dive-region: tests/unit
  ✗ implement: format_usd  (exhausted tokens budget — never wrote/pushed)
```

**What the readiness fixes PROVED (all green):** github-mirror slug derivation
(`kmazanec/cats` from the `github` remote — the origin-only path would have died at
startup); scoped comprehension held on a foreign repo — the coverage gate minted
exactly 2 `deep-dive-region` goals bounded to the two touched dirs
(`src/cats/agents/common`, `tests/unit`), NOT speculative whole-repo maps
(iteration-09 scoping carries to foreign repos); the `make:` declared-script form
spawned `make` for real (23 `script-ran` events).

**Why the implement leaf failed:** it burned its whole token budget thrashing
(130 read_file, 8 write_file, 46 run_script, 23 make invocations) and never reached
push/PR. Token shape is the tell: 6.8M prompt / 57K completion at 91.7% cache — lots
of looping, almost no production. Root cause from the event log's `run_script` reason
text — THREE compounding findings, each a real fix this run buys:

**FINDING 1 (deepest) — a fresh worktree's `.venv` lacks the test/dev deps, so the
verify command can NEVER go green.** Every `make test` failed identically:
```
uv run pytest
Creating virtual environment at: .venv
Installed 80 packages in 98ms
error: Failed to spawn: `pytest`
  Caused by: No such file or directory (os error 2)
make: *** [test] Error 2
```
The factory's worktree is a SEPARATE checkout (`.corellia/worktrees/…`) without
cats' synced `.venv`. `uv run pytest` auto-creates a venv with the RUNTIME deps
only — cats' `pytest`/`ruff`/`mypy` live in `[project.optional-dependencies]`, which
a plain `uv run` does not install. cats' Makefile assumes the dev env is already
synced (`make sync` / `make dev` bootstrap). In a fresh worktree it is not, so
`pytest` isn't on PATH → exit 2 every time. This is the AC-4 analogue of AC-3's
"let the leaf verify" (finding 6), one layer deeper: the verify command must be
RUNNABLE in the sandbox worktree — a per-stack bootstrap (`uv sync --all-extras`)
must run before the first verify, or the leaf is structurally unable to self-verify
and will thrash to budget exhaustion. *Candidate fixes:* (a) declare the verify
command to include the sync, e.g. `make:dev-test` where a target does
`uv sync --all-extras && uv run pytest`; or (b) the engine pre-syncs a worktree once
on creation via an operator-declared bootstrap command. (b) is the general,
stack-agnostic fix (npm repos need `npm ci` in a fresh worktree too — corellia's
own self-build dodged this only because it shares one worktree per tree and node
resolves from the repo root).

**FINDING 2 — declared the wrong test target; `make test` needs a DB and can't go
green here anyway.** Even WITH deps, `make test` = `uv run pytest` runs the FULL
suite, whose integration tests need Postgres+Redis (`make dev` = `compose-up +
migrate`) — 90 ERRORs, exit 1, regardless of the leaf's code. The DB-free target is
`make test-unit` (`uv run pytest tests/unit` → 848 passed, exit 0 at baseline, once
deps are synced). The harness should declare `test → make:test-unit` (and ALSO
declare `test-unit`, since the leaf correctly tried it — "Script test-unit is not in
the declared set"). General lesson: the declared verify target must be the
narrowest one that is green at baseline in the sandbox (no external services).

**FINDING 3 — `make:<target>` cannot forward the model's `target`; it appends it as
a second make GOAL.** `make test tests/unit/test_format_usd.py` ran `uv run pytest`
(whole suite, target IGNORED) and then tried to build `tests/unit/...` as a second
goal. npm's `--` forwards the target into the runner; make has no equivalent —
positional args become goals, not recipe args. So the AC-3 targeting win (run ONE
file) silently does not work through `make:`. *Candidate:* either drop target-append
for the `make:` form (document it as whole-target-only) or support a make-variable
convention (`make <target> TARGET=<path>` and recipes that read `$(TARGET)`); the
former is simpler and honest. Note: my unit test for `make:` target-forwarding
masked this — it added a catch-all `%:` rule to absorb the extra goal, which cats'
real Makefile does not have. The test should assert the realistic behavior.

**Hygiene:** worktree was PRESERVED (not collected) — correct, since the deliver
failed (collection is success-only). cats' primary checkout left clean. The
improvement loop is disabled for this run (no standing envelope), but the report
correctly routed the 3 blockers to an improve commission id (would have fired with
an envelope). No PR — as expected, the leaf never reached the open-pr step.

Net: the AC-4 harness path is sound end-to-end UP TO verify; the gap is that the
sandbox worktree is not a verifiable environment for a fresh Python checkout. Fix
the worktree-bootstrap (finding 1) + declared target (finding 2) and re-run.

### Fixes for run #1 (worktree .venv link + DB-free test target)

- **worktree.ts:** `openTreeWorktree` now symlinks the repo root's `.venv` into a
  fresh worktree, exactly as it already did `node_modules` (generalized to a small
  loop). Verified directly: a cats worktree with the symlinked `.venv` runs
  `uv run pytest tests/unit` → 848 passed, exit 0. This is the general,
  stack-agnostic shape (per-stack dep dir shared from the root), not a cats special
  case. Test added.
- **live-foreign.ts:** declared `test → make:test-unit` (+ a `test-unit` entry)
  instead of `make:test`, so verify hits the DB-free unit suite that is green at
  baseline. typecheck/lint unchanged.
- **make: target honesty:** split the masking unit test into the catch-all and
  no-catch-all cases — `make:` targeting is whole-target-only (finding 3),
  documented, not relied upon.

## AC-4 run #2 — new failure, caught instantly: decide-root split rejected for a missing budgetShare. 1 fix.

Re-ran. This time it failed at the FIRST decide call (9 events, $0, 0 tokens — never
spawned a child), with a DIFFERENT blocker:
```
Decision-maker could not produce a valid decision:
  split child "impl-helper" missing numeric "budgetShare"
```
The deliver-intent root's `decide` proposed a real split (children `impl-helper`,
etc., each with valid localId/type/title), but one child omitted `budgetShare`.
`parseDecision`/`normalizeChild` THREW on the missing number → the decide-fallback
blocked the whole root. This is the SAME lesson as the iteration-08 empty-children
softening, one field deeper, and exactly the `parseDecision`-strictness item
STATUS.md flagged as next. The run #1 fixes (`.venv` link, test-unit) are correct
but never got exercised — the root blocked before any worktree work.

**Fix (brains/llm.ts):** `budgetShare` has a natural default like the list fields —
a child with a valid localId/type but no share is TERSE, not malformed. `normalizeChild`
now marks a missing/non-positive share as NaN instead of throwing; `parseDecision`
fills NaN shares via `fillBudgetShares` (mean of the present shares; even `1/n` if
none). `localId`/`type` remain required (a child missing those is still rejected at
the seam — that test still holds). The engine already renormalizes shares to sum ≤ 1
downstream, so any positive number is safe. Tests: omitted-share filled from the
mean; all-omitted → even split. 1430 green, lint clean. Re-run.

## AC-4 run #3 — budgetShare fix worked; now blocked on the REAL iteration-09 gap: the gate demands a whole-repo map for a tiny brownfield add. (DECISION NEEDED)

$0.40, 77.8% cache. The decide root now split cleanly into `implement` (0.75) +
`open-pr` (0.25) — the budgetShare fix is proven. But the implement child's coverage
gate then minted comprehension that could not finish:
```
gate-checked missing: [architecture, conventions,
  architecture:src/cats/agents/common, architecture:tests/unit, ...]
→ map-repo: architecture   ✗ EXHAUSTED wallClockMs (70 tool-calls, mid→high escalate)
  map-repo: conventions    ✗ (50 calls)
  deep-dive-region: src/cats/agents/common  ✓
  deep-dive-region: tests/unit              ✗
Isomorphic failure (signature: step-loop:failed) ×2 → block
"format_usd helper not present in artifact" (never implemented)
```

**Root cause — the unsolved core of iteration-09 (ADR-029 Dec 2), now exposed on a
big repo.** The coverage gate (`src/library/coverage.ts`) requires a code-emitting
leaf to have `architecture + conventions` (WHOLE-REPO maps) PLUS region dives. The
ADR-029 Dec-2 refinement only SKIPS the whole-repo maps when the scope is entirely
NEW (greenfield: every `existsByRegion` false). cats' scope
(`src/cats/agents/common/`, `tests/unit/`) is two EXISTING dirs — a brownfield add —
so the carve-out does not apply and the gate demands the whole-repo
`architecture`/`conventions` maps. Mapping cats' 259-file architecture cannot finish
in its subdivided wall-clock slice (1.8M / 14 ≈ 2.1 min), so `map-repo: architecture`
times out. (Run #1 happened to mint ONLY region dives — the gate/brain shape is
non-deterministic; run #3 over-fired with the whole-repo maps.)

Two distinct sub-problems, EITHER of which unblocks AC-4:
1. **The gate over-demands.** A pure helper added to an existing dir should need a
   region dive of THAT dir, not a whole-repo architecture/conventions map (DESIGN.md
   JIT rule: "a region no goal touches is never mapped"). The Dec-2 carve-out should
   extend from "greenfield only" to "a SCOPED brownfield add whose touched regions
   are all dived needs no whole-repo map" — i.e. region dives SUFFICE for a
   tightly-scoped feature; whole-repo maps are for whole-repo / unscoped intents.
2. **When demanded, the whole-repo map didn't recurse.** `map-repo: architecture`
   chose `satisfy` (one leaf) over splitting into sub-region maps, so it tried to fit
   259 files into one budget and timed out. The recursion mechanism exists (iter-08,
   not leafOnly) but the brain didn't invoke it; the decide prompt / split criterion
   for a too-large map needs to actually fire on a big repo.

This is the locked coverage policy (ADR-021/ADR-029), so it is a DESIGN decision, not
a reflexive patch — surfacing to the operator before changing it. The AC-4 HARNESS is
otherwise proven sound: github-mirror PR path, scoped region dives, `.venv` worktree
link, DB-free test target, and the decide-split all work; the one remaining blocker is
this comprehension-scope policy.

Hygiene each run: worktree PRESERVED on failure, cats primary clean, no PR. Orphaned
worktrees from prior foreign-eyes sessions are accumulating under cats'
`.corellia/worktrees` and `.claude/worktrees` — unrelated debt to sweep separately.

### Fixes for run #3 (coverage carve-out + map-repo recursion)

ADR-029 Decision 2 amended (see the ADR): a code-emitting leaf with non-empty scope
pulls region dives of its touched regions ONLY, no whole-repo architecture/conventions
map; scope-less leaves still pull whole-repo maps; characterize unchanged. Implemented
as `isScopedCodeLeaf` in `coverage.ts`. Companion: `comprehend.md` sharpened so a
whole-repo `map-repo` over a many-subsystem repo splits up front. 1434 green.

## AC-4 run #4 — tree went green + a PR opened, BUT the PR is SPURIOUS. AC-4 NOT yet proven. 3 ordering/correctness bugs.

The carve-out worked: the implement leaf pulled ONLY the 2 region dives (no whole-repo
maps), comprehension was fast, the helper was written and `make:test-unit` passed
green. The tree printed all-green and `open-pr` reported a PR:
**https://github.com/kmazanec/cats/pull/1** — and for a moment this looked like AC-4
proven. **It is not.** Inspecting the PR:
- The PR diff contains TWO unrelated files (`docker-compose.yml`,
  `docker-compose.prod.yml`) — NOT `format_usd`. The helper is **not on the branch**.
- The factory's work is real but **UNCOMMITTED**: `format_usd.py`,
  `test_format_usd.py`, and the `__init__.py` edit sit in the worktree as `??`/`M`,
  never committed, never pushed.

Three distinct bugs, traced from the event log + the live worktree:

**BUG A (critical — ordering).** `open-pr` is a tree leaf that runs INSIDE `_run`,
so it pushes the branch and opens the PR BEFORE the engine's root-emission step
commits the work. `collectTree` (which commits the worktree diff) only runs in the
post-`_run` `finally`, and ONLY on success. So at the moment `open_pr` pushed, the
feature was not committed — the branch carried only whatever was already committed at
branch-cut. The PR is opened against work that does not exist yet. `open-pr` must run
only AFTER the work is committed (collect must precede push/PR, not follow it).

**BUG B (the `.venv` scope leak — what actually blocked this run).** The root-emission
`diffWithinScope` saw the `.venv` SYMLINK I added in run #1 as a changed path outside
declared scope → downgraded the would-be success to
`Scope insufficiency: ... .venv` → `preserveTree` (no commit) instead of
`collectTree`. So even the happy path could not commit. The worktree must EXCLUDE
`.venv`/`node_modules` from git (like it already excludes `.corellia/worktrees` via
`.git/info/exclude`) so the dependency symlinks never enter the tree diff.

**BUG C (base divergence — why the PR shows compose files).** The tree branch was cut
from cats' LOCAL HEAD (`9ed64ff`), which is 2 infra commits AHEAD of the GitHub mirror's
`main` (local-only `fix(infra): ...compose...` commits). `open_pr`'s diff is branch vs
github `main`, so it shows those 2 pre-existing commits. The branch should be cut from
(or the PR diffed against) the REMOTE PR-base tip, not whatever the local checkout
happens to be ahead by. (Lower priority than A/B but it pollutes any foreign PR whose
local checkout is ahead of its push remote.)

Also: `branch-pushed` fired ~16× (open-pr retried the push repeatedly) — a symptom of
A, worth a look once A is fixed.

Honest status: the AC-4 PIPELINE runs end-to-end (scoped comprehension, write,
green verify, push, PR-open all fire) but the DELIVERABLE is wrong — the PR neither
contains the feature nor excludes unrelated work. Fix B (unblocks commit), then A
(commit-before-PR ordering), then C (remote-base branch), and re-run. The spurious
cats PR #1 must be closed.

### Fixes for run #4 bugs A + B (open-pr commits the work; .venv excluded)

- **Bug B (worktree.ts):** `.venv` joins `node_modules` in two places — the
  `.git/info/exclude` written at worktree creation (so `collectTree`'s
  `git add --all` never stages the symlink) AND the `diffWithinScope` drop-filter
  (so the scope check never flags it). `ensureGitignored` now writes a list
  (`EXCLUDE_PATTERNS`). Tests: a non-gitignored `.venv` symlink no longer trips
  the scope diff.
- **Bug A (pr-tools.ts):** `push_branch` now commits the worktree's uncommitted
  work onto the branch HEAD (`commitWorktreeWork`: `git add --all` respecting the
  exclude, then commit if dirty) BEFORE the process-clean gate + push. So the
  branch — and the PR — carry the feature even though `collectTree` runs only
  after the open-pr leaf. `collectTree`'s later commit is a no-op (nothing staged).
  Test: an uncommitted worktree file is committed + appears on the pushed branch.

1436 green, lint clean.

**Bug C (remote-base divergence) — still open, environmental this run.** cats' LOCAL
main was 2 infra commits ahead of the GitHub MIRROR's main (pushed to the GitLab
origin, never to the mirror), so the tree branch — cut from local HEAD — carried
those 2 commits into the PR diff. The principled factory fix is to cut the tree
branch from (or diff the PR against) the PUSH REMOTE's base tip, not whatever the
local checkout is ahead by; recorded as a follow-up. For the immediate re-run, the
mirror is synced so local main == github main and the branch point is clean.

## AC-4 run #5 — Bugs A/B did NOT recur; blocked one layer earlier on comprehend over-explore (a deep-dive of a 4-FILE region exhausts attempts without ever emitting). New single blocker.

$1.01, 73.9% cache, 1436 tests green at launch. Pre-run prep done: cats GitHub
mirror synced (pushed the 2 local infra commits so local main == github main ==
`9ed64ff`, removing Bug C's environmental divergence), spurious PR #1 resolved
(it auto-marked MERGED when the sync made its branch tip an ancestor of main — it
carries no feature code; mirror has no `format_usd`, open-PR list empty).

**The run-#4 fixes held.** No spurious PR, no `.venv` scope leak, no
commit-before-push failure — the run never reached push/PR because comprehension
blocked first. So Bugs A and B are not refuted; they simply weren't exercised.

**New, single blocker — comprehend over-explore on a TINY region.** The deliver
root split cleanly (`judge-split` PASS → `split (2 children)`: dive
`src/cats/agents/common`, dive `tests/unit`, then implement + open-pr). The
scoped-brownfield carve-out (run #3 fix) worked: it pulled ONLY the 2 region
dives, no whole-repo architecture/conventions map. The `tests/unit` dive emitted
fine (✓). But the `src/cats/agents/common` dive — a region of **4 files / 49
LOC** (`__init__.py`, `cost.py`, 2 `.pyc`) — `decided: satisfy` correctly, then
ran **49 tool-calls across 6+ steps** (head_sha, list_dir, read_file ×N,
find_symbol ×N, search, read_file …) in a read-loop, **never emitted a knowledge
artifact, never reached a verdict**, and exhausted its `attempts` budget →
BLOCKED. With the dependency dead, `implement` was skipped, `format_usd` was
never written, and `judge-integration` FAILed ("No format_usd helper… present").

This is the **comprehend over-explore / never-emit** failure — the same class
STATUS.md flagged ("comprehend.md hardened with a 6–8 read ceiling then emit")
but it is clearly still not firing reliably: a 49-LOC directory cannot need 49
tool-calls, and the sibling `tests/unit` dive emitted on the first pass, so the
behavior is non-deterministic per region. Root cause is NOT region size (run #3's
problem) and NOT the coverage gate (run #3's carve-out is working) — it is the
comprehend leaf's step loop not converging to an emit on a small region.

Candidate fixes (to investigate before patching):
1. **Hard emit-forcing ceiling in the engine, not just the skill prose.** The
   6–8 read ceiling lives in `comprehend.md` (advisory); the leaf ignored it for
   49 calls. A structural cap — after N read-class tool-calls with no emit, the
   step loop forces the emit/synthesize step (or fails fast with a useful signal)
   — would make this deterministic regardless of what the model decides. Touch
   points: the comprehend step loop in `src/engine/engine.ts`, the family harness
   in `src/library/types/comprehend.ts` / `comprehend.md`.
2. **Tie the read ceiling to region size.** A 4-file region should get a tiny
   read budget; the ceiling could scale to `min(files, cap)` so a small region
   is forced to emit almost immediately.

**Store-pollution note (not a product bug, but it muddies reports):** the run's
report listed ~30 blockers, but only the last 4 (`improve-live-foreign-e77649c8`)
are from THIS run; the rest (`improve-live-self-*`, `format-duration`,
`ADR-029…`) are from PRIOR runs persisted in the shared store (`buildStore()`
honors `CORELLIA_EVENTS_PATH`/`DATABASE_URL`, and `out/events.jsonl` is appended
across runs). The blocker list and the trace tree both mix runs. For a clean
single-run signal, point the harness at a fresh events path per run (or filter
the report to the current `intentId`). The trace above was read by `--goal`
filtering to this run's region ids.

Hygiene: worktree PRESERVED on failure
(`.corellia/worktrees/live-foreign-e77649c8-5641f798`), cats primary clean, no PR.
Orphaned foreign-eyes/live-foreign worktrees continue to accumulate under cats'
`.corellia/worktrees` — unrelated debt to sweep. Next: fix the comprehend
over-explore (candidate 1 — a structural emit-forcing cap) and re-run #6.

### Fix for run #5 (structural comprehend read ceiling)

`runStepLoop` (src/engine/engine.ts) now counts read-class tool-calls for the
comprehend family ONLY and, once they cross a hard ceiling (16, well above the
6–8 comprehend.md asks), appends a "stop reading, emit now" instruction so the
step produces the exploration-complete artifact (two-phase emit then yields the
final structured artifact). A forced-emit step that still returns tool-calls
fails the attempt fast with a useful signal instead of read-looping to
attempt-exhaustion. deliver/implement leaves untouched. Tests: a read-looping
comprehend leaf is forced to emit at the ceiling; a 25-read implement leaf is
NOT cut off. 1438 green, lint clean. (commit `3d8b1c3`)

## AC-4 run #6 — read-ceiling fix WORKS (comprehension now emits); exposed the real next layer: the gate mints a whole-repo `architecture` map for a SCOPED feature, and a 16-read map of a 259-file repo emits an artifact that FAILS anchor validation.

$0.54, 54.6% cache, fresh event log (`out/ac4-run6.jsonl`, `CORELLIA_EVENTS_PATH`
per-run — clean single-run signal, no prior-run blocker bleed). 1438 green at
launch.

**The fix did its job.** Run #5's pathology (a small dive read-loops to
attempt-exhaustion emitting NOTHING) is GONE. This run, `Map repo: stack` ✓
emitted and passed, and `Map repo: architecture` reached `step 7/8: artifact` on
EVERY attempt — the read ceiling forced the two-phase emit after ~16 reads. So
comprehension now reliably produces an artifact.

**Two distinct things changed/surfaced:**

1. **The brain split into WHOLE-REPO maps, not scoped region dives (run #3
   sub-problem #1, still unfixed — and the dominant blocker now).** The deliver
   root's `decide` chose `split (3 children)` with `map-architecture` +
   `map-stack` + implement children directly; `gate-checked: missing
   [architecture, stack]`. The run-#3 `isScopedCodeLeaf` carve-out (region dives
   only, no whole-repo map) is on the *implement leaf's* coverage gate — but here
   the ROOT's own split minted the whole-repo maps as siblings before the implement
   leaf's gate ran, so the carve-out never got a say. This is the non-determinism
   the run-#3 note called out: the brain's split shape, not just the gate, decides
   whether whole-repo maps appear. For a tightly-scoped helper, a whole-repo
   architecture map is exactly the speculative comprehension DESIGN's JIT rule
   forbids. **This is the real fix needed** (see below).

2. **A 16-read whole-repo map of a 259-file repo emits an INVALID artifact.** The
   forced emit fires after ~16 reads, but that is too little to map a 259-file
   architecture faithfully: the emitted artifact's claimed pointers
   (`src/cats/messaging/envelopes.py`, …) FAILED the deterministic anchor gate
   (`knowledge:map-repo: No claimed architecture pointer matches any node in the
   fresh scan`) — the model named plausible files it hadn't actually confirmed.
   Each attempt: ~7 read steps → forced emit → gate FAIL → re-attempt → attempts
   exhausted. So the flat ceiling of 16 is right for a bounded region dive but
   wrong for a `map-repo` over a large repo: a whole-repo map must either (a) NOT
   be minted for a scoped feature (fix #1), or (b) SPLIT into sub-region maps so
   each child maps a bounded slice within its own read ceiling (run #3
   sub-problem #2, the recursion that didn't fire), or (c) scale the read ceiling
   with map breadth. (a) is the principled fix; (b)/(c) only matter for genuinely
   whole-repo intents.

**Conclusion — the next fix is #1, not a ceiling tweak.** The comprehend
emit-forcing is now sound. The remaining AC-4 blocker is that a scoped brownfield
helper is still pulling whole-repo `architecture`/`stack` maps it does not need.
The fix must ensure a tightly-scoped deliver intent's split pulls region dives of
the touched regions only — extending the run-#3 carve-out from the implement
leaf's gate to the ROOT's split decision (or making the split decide-prompt mint
region dives, not whole-repo maps, when the intent scope is narrow). Touch points:
the split/coverage interaction in `src/engine/engine.ts` (~2638 gate, the split
eval), `src/library/coverage.ts` (`isScopedCodeLeaf`), and the deliver decide
prompt that proposes the children. Then re-run #7.

Hygiene: worktree PRESERVED on failure
(`.corellia/worktrees/live-foreign-e1002e6f-*`), cats primary clean, no PR.
