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
