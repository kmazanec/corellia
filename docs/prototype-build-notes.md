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
