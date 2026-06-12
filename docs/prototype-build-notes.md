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
