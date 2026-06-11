---
id: F-35
title: Provider-usage accounting + spend ceiling
iteration: 03-hands
type: implement
intent: production
status: not-started
dependsOn: []
contracts: [ADR-017, ADR-003]
---

# Feature: Provider-usage accounting + the $15 ceiling

**ID:** F-35 · **Iteration:** 03-hands · **Status:** Not started

## What this delivers (before → after)

**Before:** token budgets debit a chars/4 guess; decide-phase calls are
unmetered; dollar cost is unknown until the provider dashboard says so.
**After:** every brain call's event carries provider-reported usage (tokens
+ cost where reported), all debits derive from it, decide/scan calls are
metered like any other, and a tree halts with a decision brief when measured
spend reaches its dollar ceiling (default $15) — plus a per-tree cost
summary projection.

## How it fits the roadmap

Makes the budget system's authority real before the tool loop multiplies
call volume (ADR-017). Closes the decide-phase metering gap recorded in
iteration 2.

## Reading brief

`docs/adrs/ADR-017` (the decision) · `docs/adrs/ADR-007` (the four
dimensions this rides on) · `src/brains/llm.ts` (where usage is read) ·
budget debit sites in `src/engine/engine.ts` ·
`src/eventlog/projections.ts` (where the cost projection lands).

## Requirements traced (from the PRD)

R5 · AC-11, AC-12.

## Dependencies (must exist before this starts)

None — usage fields land in the barrier's event changes. Touches
`src/engine/engine.ts` (see the roadmap's overlap note).

## Unblocks (what waits on this)

Nothing hard-waits; F-36's live run is where reported-cost figures first
appear for real.

## Contracts touched

Usage fields on brain-call events; the tree spend ceiling's home in
the root contract (source of truth: ADR-017) — consumed from the barrier.

## Acceptance criteria (product behavior)

1. Given a brain response carrying usage, then the corresponding event
   records prompt/completion tokens (and cost when reported), and the
   `tokens` debit equals the reported figure — the chars/4 path is absent
   from accounting code.
2. Given a scripted run, then a cost-summary projection reports per-goal and
   per-tree token totals derived solely from event usage fields.
3. Given a tree whose accumulated reported cost reaches its ceiling, then
   the tree halts with a decision brief and no subsequent brain call events
   exist for that tree.
4. Given a decide-phase call (including terraced-scan candidates), then its
   usage is recorded and debited identically to produce/judge calls.
5. Given an endpoint reporting tokens but not cost, then the tree still
   enforces a conservative bound (documented fallback policy) rather than
   running uncapped.

## Testing requirements

Scripted-brain tests with synthetic usage payloads: debit equality, ceiling
halt (including the one-in-flight-call overshoot case documented in
ADR-017), decide-phase metering, the no-cost-reported fallback, projection
totals. No live API usage.

## Manual setup required

None.

## Build plan (approved)

### Chunks (in order)

- [ ] **Real usage parsing in both brains (the barrier owns the freeze)** — Re-scoped at approval review (2026-06-11): the **barrier commit** introduces `Usage`/`Metered<T>`, rewrites the four Brain return types, and performs the *mechanical* compile-true propagation (zero-usage wrappers on ScriptedBrain/LlmBrain, `.value` destructuring at every engine call site) so every feature starts from a green trunk. This chunk replaces the placeholders with the real thing: LlmBrain reads provider `usage` (prompt_tokens/completion_tokens, cost when reported) from the response instead of returning the zero-usage wrapper; ScriptedBrain accepts per-response synthetic usage for tests. Satisfies: AC-1 (partial: usage is now read from the response). Tests: tests/brains/llm.test.ts (assert callCompletions surfaces usage from a stubbed fetch response carrying a usage block; assert missing usage → costUsd undefined). tests/brains/scripted.test.ts (assert scripted synthetic usage is returned alongside value). Run: npx vitest run tests/brains/llm.test.ts tests/brains/scripted.test.ts. Contracts: consumes src/contract/brain.ts as frozen by the barrier; this chunk introduces no contract change.

- [ ] **Record usage on brain-call events and debit tokens from reported figures** — Delivers: Engine destructures Metered results at every brain-call site; the `decided`/`judge-verdict`/`repair-applied`/new `produced` events carry usage; the `tokens` debit uses reported promptTokens+completionTokens; the chars/4 estimate is deleted from accounting code (may survive only as a pre-call subdivision-sizing estimate per ADR-017, clearly out of the debit path). Satisfies: AC-1. Tests: tests/engine/engine.test.ts (scripted run with synthetic usage → assert events carry usage and `tokens` debit equals reported sum; assert no chars/4 / JSON.stringify(...).length/4 in accounting path). tests/engine/budget.test.ts (debit-equality unit). Run: npx vitest run tests/engine/engine.test.ts tests/engine/budget.test.ts. Contracts: src/contract/events.ts (extends decided/judge-verdict/repair-applied with usage; introduces `produced`).

- [ ] **Meter decide-phase and terraced-scan candidate calls identically** — Delivers: All decide() call sites (initial, re-decide, terraced-scan k-candidates at engine.ts ~517, fallback ~576) record usage and debit tokens exactly as produce/judge do — closing the ADR-007 decide-phase metering gap. Satisfies: AC-4. Tests: tests/engine/engine.test.ts (scripted split + terraced-scan run; assert every decide/scan call produced a usage-bearing event and contributed to the token debit). tests/engine/flywheel.test.ts (scan path still passes). Run: npx vitest run tests/engine/engine.test.ts tests/engine/flywheel.test.ts. Contracts: none (consumes events.ts usage fields frozen in prior chunk).

- [ ] **Per-tree $15 dollar ceiling with decision-brief halt** — Delivers: Goal gains optional spendCeilingUsd (default $15 at root); engine maintains a tree-scoped accumulator of reported costUsd across the recursive run; when accumulated cost reaches the ceiling the tree halts via runBlock with a decision brief and a `ceiling-reached` event, and NO further brain-call events are appended for that tree (one-in-flight overshoot accepted per ADR-017). Satisfies: AC-3. Tests: tests/engine/engine.test.ts (scripted run with synthetic costUsd payloads summing past $15 → assert tree halts with decision brief; assert zero brain-call events after the halt for that tree; assert the documented one-call overshoot case from ADR-017). Run: npx vitest run tests/engine/engine.test.ts. Contracts: src/contract/goal.ts (extends Goal with spendCeilingUsd); src/contract/events.ts (introduces ceiling-reached).

- [ ] **No-cost-reported conservative fallback bound** — Delivers: When an endpoint reports tokens but not cost (costUsd undefined), the tree enforces a documented conservative bound (token-only ceiling derived from the ceiling + a fixed worst-case price constant) rather than running uncapped; the fallback policy is documented in code and in the spec's implementation notes. Satisfies: AC-5. Tests: tests/engine/engine.test.ts (scripted run with usage payloads carrying tokens but no costUsd → assert the tree still halts via the conservative token-only bound, not uncapped). Run: npx vitest run tests/engine/engine.test.ts. Contracts: none (consumes Usage.costUsd optionality frozen in chunk 1).

- [ ] **Cost-summary projection: per-goal and per-tree token/cost totals** — Delivers: A new pure projection in src/eventlog/projections.ts folds the usage-bearing events into per-goal and per-tree token totals (and dollar totals where cost reported), derived solely from event usage fields; the exhaustive switch handles the new event members. Satisfies: AC-2. Tests: tests/eventlog/projections.test.ts (synthetic event log with usage → assert per-goal and per-tree totals match the summed usage fields and nothing else). Run: npx vitest run tests/eventlog/projections.test.ts. Contracts: src/contract/events.ts (consumes usage fields + produced/ceiling-reached members; ADR-003 exhaustive-switch discipline).

### Test strategy

All tests are scripted-brain (no live API), per the spec's explicit testing requirements. Mix: (1) brain-unit tests in tests/brains/llm.test.ts via a stubbed fetchImpl returning synthetic OpenAI/OpenRouter-shaped responses with a `usage` block (and one without cost) — proves usage is parsed, not discarded; (2) brain-unit in tests/brains/scripted.test.ts proving the ScriptedBrain can emit synthetic usage; (3) engine integration tests in tests/engine/engine.test.ts driving full scripted runs to prove debit-equality (AC-1), decide-phase metering (AC-4), the ceiling halt incl. the ADR-017 one-call-overshoot case (AC-3), and the no-cost fallback (AC-5); (4) projection-unit in tests/eventlog/projections.test.ts proving totals derive solely from usage fields (AC-2); (5) a budget-unit in tests/engine/budget.test.ts for the debit arithmetic. Architecture-named risk demanded by ADR-003: the cost projection must be an exhaustive switch over FactoryEvent — the typecheck gate (npm run typecheck / tsc --noEmit) is itself a test that adding the new event members breaks compilation until handled. One repo typecheck + full `vitest run` gate at feature end. No on-device/deployed-URL tests — this is a single-process library feature.

### Contract touchpoints

1. **src/contract/brain.ts (Brain interface)** — extends: Add `export interface Usage { promptTokens: number; completionTokens: number; costUsd?: number }` and `export interface Metered<T> { value: T; usage: Usage }`. Change the four Brain methods to return the wrapped form: `decide(...): Promise<Metered<Decision>>`, `produce(...): Promise<Metered<Artifact>>`, `judge(...): Promise<Metered<Verdict>>`, `repair(...): Promise<Metered<Artifact>>`. Consumers that must stay exhaustive/compile: src/brains/llm.ts (LlmBrain), src/brains/scripted.ts (ScriptedBrain), any OpenRouter brain, and every brain-call site in src/engine/engine.ts (decide x4 incl. scan+fallback, produce, judge x2, repair). costUsd optional = the AC-5 fallback signal.

2. **src/contract/goal.ts (Goal interface)** — extends: Add OPTIONAL `spendCeilingUsd?: number` to `interface Goal` (root-only semantics; default $15 applied by the engine at the root when absent). MUST NOT be added to `interface Budget` — ADR-007 froze Budget as exactly {attempts,tokens,toolCalls,wallClockMs} and mandates the ceiling rides on top of, not replacing, the four dimensions. Consumers: src/engine/engine.ts (reads ceiling, threads to child runs); subdivide() in src/engine/budget.ts is unaffected (ceiling is tree-global, not subdivided).

3. **src/contract/events.ts (FactoryEvent union)** — extends: Add an OPTIONAL `usage?: Usage` field (import Usage from goal/brain) to the brain-call event members: `decided`, `judge-verdict`, `repair-applied`. Add a NEW member for produce usage since none exists today: `| { type: 'produced'; at: number; goalId: string; usage: Usage }` (or attach usage to an existing produce-adjacent append — builder picks the minimal site, but it MUST be an event per ADR-003). Add `| { type: 'ceiling-reached'; at: number; goalId: string; spentUsd: number; ceilingUsd: number }` for the halt (AC-3). ADR-003 requires the projection switch to break compilation until the new member is handled — projections.ts traceStats/new cost projection must stay exhaustive.

### Manual setup

None.

### Risks

- **CONTRACT MISMATCH WITH PLANNING BRIEF:** the orchestration prompt told me 'this feature touches no shared contract — skip contract/ADR reading,' but the spec front-matter declares `contracts: [ADR-017, ADR-003]` and the 'Contracts touched' section names usage fields on brain-call events and the tree ceiling in the root contract. This feature DOES touch three frozen contracts (brain.ts, events.ts, goal.ts). I read ADR-017/007/003 and the contract files to pin signatures. The plan must NOT be built as a contract-free feature; the three touchpoints above must be frozen in the iteration's contract reconciliation before any builder starts.

- **ADR-007 BUDGET IMMUTABILITY:** Budget is a frozen four-dimension contract and ADR-007 explicitly says the dollar ceiling rides 'on top of, not replacing' it. A builder's natural instinct to add tokens-as-dollars or a 5th Budget field would violate the locked ADR. The ceiling MUST live on Goal (spendCeilingUsd), not Budget. Flagged as the single most likely build-time violation.

- **USAGE-TO-EVENT WIRING IS THE WHOLE FEATURE AND IT'S THE RISKIEST CHUNK:** today LlmBrain.callCompletions returns a bare string and the Brain interface returns bare values — usage is discarded at the source. Every AC depends on the Metered<T> propagation landing cleanly through ~8 engine call sites plus 2-3 brain implementations. If Metered<T> is mis-shaped, the whole feature stalls. Chunk 1 is the keystone; build and prove it before anything else.

- **NO `produced` EVENT EXISTS TODAY:** there is no produce-completion event in the FactoryEvent union (only decided/judge-verdict/repair-applied are brain-call events). AC-1 requires produce usage to be recorded as an event (ADR-003 forbids side-channel state). The builder must add a new event member, which means an exhaustive-switch break in projections — intended, but easy to mis-handle.

- **TREE-SCOPED ACCUMULATOR vs PER-CALL run():** the engine recurses via this.run(childGoal) with subdivided per-child budgets; there is no existing tree object or shared mutable spend state. The dollar accumulator is tree-global, not subdivided, so it needs new engine instance/run-scoped state threaded through recursion. This is genuinely new plumbing the spec underspecifies (it says 'tree halts' without saying how the tree is identified across recursive runs). Risk of double-counting or per-goal-resetting the accumulator.

- **AC-3 'no subsequent brain call events exist for that tree' vs ADR-017's accepted one-call overshoot:** these are in tension. The test must encode the overshoot as the documented exception (a call already in-flight when the ceiling trips may complete), or AC-3 as literally written is untestable for concurrent branches. Plan routes around this by testing the serial case strictly and the overshoot case as the named ADR-017 exception.

- **AC-5 FALLBACK IS UNDERSPECIFIED:** 'a conservative bound (documented fallback policy)' names no formula. The builder must pick and document a token-only worst-case price constant; the spec gives no number, so the test asserts behavior (tree halts) not an exact dollar figure. Flagged so the reviewer doesn't expect a spec-pinned constant.

- **SPEC CITES src/brains/openrouter — there is a tests/brains/openrouter.test.ts; an OpenRouter-specific brain or config may exist that also implements Brain and must be updated for the Metered<T> change.** Not read during planning (out of the narrow read scope); builder must grep for all Brain implementors before changing the interface, or the typecheck gate will catch the missed implementor.

## Implementation notes (filled in by the building agent)

> Owned by the builder, not the planner. Starts empty.
