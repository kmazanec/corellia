---
id: F-32
title: Engine-owned step loop
iteration: 03-hands
type: implement
intent: production
status: not-started
dependsOn: []
contracts: [ADR-015, ADR-014, ADR-007]
---

# Feature: Engine-owned step loop

**ID:** F-32 · **Iteration:** 03-hands · **Status:** Not started

## What this delivers (before → after)

**Before:** a leaf's `produce` is one brain call returning text; no goal can
act, observe, and act again.
**After:** a tool-granted leaf runs the engine's step loop — brain called
pure-per-step, returning tool-call requests or a final artifact; the engine
gates every step on remaining budget, routes calls through the broker,
injects "N tool calls remaining" into each step, and logs every step — a
scripted leaf builds a file across multiple steps and halts cleanly at
exhaustion.

## How it fits the roadmap

The heart of "Hands" (ADR-015). Builds against the frozen `Brain.step` and
broker signatures — no hard dependency on F-31's implementation (tests use a
fake broker; integration with the real one happens at convergence).

## Reading brief

`docs/adrs/ADR-015` (the decision and its rationale) · `docs/adrs/ADR-006`
(repair-within-attempt — the loop nests inside an attempt) ·
`src/contract/brain.ts` post-barrier · the attempt loop in
`src/engine/engine.ts` (the insertion point) · DESIGN.md § "The control
loop".

## Requirements traced (from the PRD)

R2, R9 · AC-7 (refusals surfaced into the transcript), AC-13 (every step an
event), and the loop half of AC-8.

## Dependencies (must exist before this starts)

None — can start as soon as the iteration's contracts are frozen.
(Build-scheduling note: touches `src/engine/engine.ts`, which F-34 and F-35
also touch — see the roadmap's overlap note.)

## Unblocks (what waits on this)

Nothing hard-waits; F-36's live demo exercises this loop at convergence.

## Contracts touched

`Brain.step` + step/transcript shapes (source of truth: ADR-015) — consumed,
not defined. Tool shapes (ADR-014) — consumed.

## Acceptance criteria (product behavior)

1. Given a `ScriptedBrain` scripted as [write_file, run-of-two-calls,
   artifact], when an implement leaf runs, then the artifact emits after
   exactly the scripted steps, each step and tool result is in the event
   log, and `toolCalls` reflects every executed call.
2. Given a `toolCalls` budget smaller than the scripted sequence, then the
   loop halts at exhaustion as an event (no further brain calls), and the
   attempt fails into the existing control loop — never a hang.
3. Given a refused tool call mid-loop, then the refusal is appended to the
   transcript and the next step's brain call sees it (refusal is data the
   model can react to).
4. Every step's context includes the remaining tool-call count.
5. Non-tool-granted types are unaffected: their produce path is unchanged
   and no step events appear.

## Testing requirements

Scripted-brain loop tests: multi-step success, exhaustion mid-loop, refusal
recovery, artifact-first (zero tool calls), interaction with
repair-within-attempt (a failed loop attempt escalates carrying the
transcript tail). No live API usage.

## Manual setup required

None.

## Build plan (approved)

### Chunks

- [ ] **Tool-granted predicate + non-tool-granted regression guard (AC-5 first)**: Delivers a pure predicate that decides whether a goal-type runs the step loop, plus a pinned regression proving every existing leaf/non-leaf path is byte-identical when the type is not tool-granted (no step events appear). Satisfies AC-5. Test target: `tests/engine/step-loop.test.ts` — describe block 'non-tool-granted types unaffected': run the existing leaf-satisfy and deterministic-fail goals, assert NO 'step' / tool events in store.types() and report equals the pre-F-32 behavior. Run ONLY this file: `npx vitest run tests/engine/step-loop.test.ts`. Also re-run the existing tests/engine/engine.test.ts as the unchanged-path guard. Contract: `GoalTypeDef.grants` (consumed) — the predicate is `grants.length > 0` (or the barrier-frozen tool-granted flag if the barrier introduced one); no new field introduced by F-32.

- [ ] **ScriptedBrain.step + transcript shape consumption**: Delivers the production ScriptedBrain (src/brains/scripted.ts) implementing the frozen `Brain.step`, returning a scripted sequence of {tool-call requests | final artifact} keyed by goal title/type, so a leaf can be scripted as [write_file, run-of-two-calls, artifact]. Satisfies AC-1. Test target: `tests/brains/scripted.test.ts` (extend) — 'step returns scripted tool-call requests then a final artifact'; assert ordering, last-element-repeat clamping, and loud error on missing key. Run ONLY: `npx vitest run tests/brains/scripted.test.ts`. Contract: `Brain.step` (consumed) + `ToolCall`/`ToolResult` (consumed) — ScriptedBrain implements the frozen interface, it does not define it.

- [ ] **Engine step loop happy path: multi-step build → artifact, every step & result logged**: Delivers runAttemptLoop, for a tool-granted type, running the loop: builds the transcript, calls brain.step, routes each returned ToolCall through the broker, appends each ToolResult to the transcript, logs a step event + each tool event, and on a final-artifact step rejoins the existing deterministic/judge/emit path. A scripted leaf builds a file across multiple steps; artifact emits after exactly the scripted steps. Satisfies AC-1 and AC-13 (loop half). Test target: `tests/engine/step-loop.test.ts` — 'multi-step success': scripted [write_file, run(2 calls), artifact] against a FakeBroker; assert report.artifact matches, step events == scripted step count, each tool result present in the log, executed tool calls all logged. Also 'artifact-first (zero tool calls)': a step that returns the artifact immediately emits no tool events. Run ONLY: `npx vitest run tests/engine/step-loop.test.ts`. Contract: `FactoryEvent` step/tool members (consumed) + `ToolBroker.execute` (consumed via a FakeBroker test double).

- [ ] **Budget gate + remaining-count injection (AC-2 exhaustion, AC-4 injection)**: Delivers the loop's `while` condition gating on remaining toolCalls before each step; the engine injects the remaining tool-call count into each step's context; on exhaustion it logs a budget-exhausted event and fails the attempt into the existing control loop (runBlock/exhaustedBrief) with no further brain calls and no hang. Debit ownership is resolved to the broker (ADR-014) with the engine reading the remaining count — exactly one debit per call. Satisfies AC-2 and AC-4. Test target: `tests/engine/step-loop.test.ts` — 'exhaustion mid-loop': toolCalls budget < scripted sequence; assert loop halts at exhaustion as a budget-exhausted event, brain.step call count stops at the gate (no extra call), the attempt fails into the control loop, and the run returns (never hangs — wrap in a vitest timeout). 'remaining count injected': spy/inspect the ctx passed to brain.step and assert it carries the remaining toolCalls each step. Run ONLY: `npx vitest run tests/engine/step-loop.test.ts`. Contract: `Budget.toolCalls` (consumed, ADR-007) + `ToolBroker.execute` debit semantics (consumed, ADR-014).

- [ ] **Refusal-as-data: broker refusal appended to transcript, next step sees it**: Delivers when the broker returns a refusal (ToolResult ok:false with a reason — not an exception), the engine appends it to the transcript exactly like a successful result, logs the tool refusal event, and the next brain.step call's transcript includes the refusal so the model can react. Satisfies AC-3 and AC-7. Test target: `tests/engine/step-loop.test.ts` — 'refusal recovery': FakeBroker refuses the first call (ok:false, reason); scripted brain then emits an artifact; assert the refusal appears in the logged tool events AND in the transcript handed to the subsequent brain.step (inspect captured ctx), and the run completes via the recovered path. Run ONLY: `npx vitest run tests/engine/step-loop.test.ts`. Contract: `ToolResult` (consumed) — refusal is `{callId, ok:false, output/reason}`; `FactoryEvent` tool-refusal member (consumed).

- [ ] **Failed-loop attempt escalates carrying the transcript tail (repair-within-attempt interaction)**: Delivers a loop attempt that ends in failure (hard step failure per ADR-018 layer 3, or a final artifact that fails deterministic/judge) feeds the existing handleFailure control loop, carrying the transcript tail as part of the failure context so the next attempt/repair sees what the loop did. Satisfies AC-2 and AC-13 (loop half). Test target: `tests/engine/step-loop.test.ts` — 'failed loop attempt escalates carrying transcript tail': scripted loop produces an artifact that fails a deterministic check; assert the existing repair/escalate path fires (tier-escalated or repair-applied event) and the priorAttempt/transcript context carries the loop tail. Run ONLY: `npx vitest run tests/engine/step-loop.test.ts`. Contract: `BrainContext.priorAttempt` (consumed) — reused as the carrier for the failed-loop tail; no new field unless the barrier froze one.

### Test strategy

Pure unit/integration tests at the engine seam with a fake broker and the scripted brain — ADR-015 makes the loop deterministically testable with zero API calls, and the spec explicitly bans live API usage. One new file `tests/engine/step-loop.test.ts` holds the loop tests (multi-step success, artifact-first, exhaustion, refusal recovery, failed-loop-escalates) plus the AC-5 non-tool-granted regression; `tests/brains/scripted.test.ts` is extended for `ScriptedBrain.step`. A small FakeBroker test double (implementing the frozen `ToolBroker.execute`, returning scripted ok/refusal results and debiting toolCalls) lives in `tests/engine/stubs.ts` alongside the existing stubs so it never imports F-31's real broker (the spec mandates fake-broker isolation; real-broker integration happens at convergence). The architecture-named risks the tests must pin: (1) no-hang under exhaustion — every loop test runs under a vitest timeout; (2) exactly-one-debit-per-call — assert remaining toolCalls after N calls equals budget−N, catching double-debit between engine and broker; (3) byte-identical non-tool-granted path — re-run the whole existing engine.test.ts unchanged. Gate: per-chunk run the named file only, then ONE `npm run typecheck` + full `npm test` at feature end.

### Contract touchpoints

**Brain.step (src/contract/brain.ts)** — Consumes: `Brain.step(goal: Goal, transcript: <frozen Transcript/Message[] shape>, ctx: BrainContext): Promise<StepResult>` where `StepResult = { kind: 'tool-calls'; calls: ToolCall[] } | { kind: 'artifact'; artifact: Artifact }`. F-32 does NOT introduce this — the iteration-3 contract barrier freezes the exact signature (ADR-015 line 65, 'decide/judge/repair unchanged'); F-32 calls it and ScriptedBrain implements it. The build MUST treat the barrier's frozen signature as authoritative; if absent at build start, F-32 is BLOCKED, not improvised.

**Tool shapes (src/contract/ e.g. src/contract/tool.ts, ADR-014)** — Consumes: `ToolDef { name; description; parameters: JSONSchema }`; `ToolCall { id; name; args }`; `ToolResult { callId; ok: boolean; output }` (refusal = ok:false with stated reason, never an exception); `ToolBroker.execute(goal: Goal, call: ToolCall): Promise<ToolResult>` (checks exact grant + scope, debits toolCalls, appends a tool event, then runs). Frozen by the contract barrier per ADR-014; F-32 consumes via a FakeBroker in tests.

**FactoryEvent union (src/contract/events.ts)** — Consumes: New union members frozen by the barrier: a step event (one per brain.step iteration, e.g. `{ type:'step'; at; goalId; ... }`) and tool call/refusal events (e.g. `{ type:'tool-call'... }` / `{ type:'tool-refusal'... }`) per ADR-014 'Tool events join the FactoryEvent union'. F-32 emits the step event from the engine loop and asserts on all of them; the barrier owns adding the members (ADR-003 exhaustive-switch discipline). MemoryEventStore stub already accepts any FactoryEvent.

### Risks

1. **BLOCKING PREREQUISITE / spec-vs-task conflict**: F-32's spec declares `dependsOn:[]` and the planning task said 'touches no shared contract — skip contract reading', but the spec, ADR-014 and ADR-015 all show F-32 CONSUMES contracts (`Brain.step`, `ToolDef`/`ToolCall`/`ToolResult`/`ToolBroker`, step+tool FactoryEvents) that DO NOT EXIST in the tree today (src/contract/brain.ts has only decide/produce/judge/repair; no tool.ts; no tool/step events). ADR-015 line 65 states these are frozen by the 'iteration-3 contract barrier' at plan time — a separate prerequisite the build runs FIRST. F-32 must build against those frozen signatures; if the barrier hasn't run, F-32 is blocked, not improvised. The 'no contract to read' instruction was wrong for this feature.

2. **Double-debit of toolCalls**: ADR-014 says `ToolBroker.execute` debits toolCalls; the engine's existing runAttemptLoop also calls `consumeN(budget,'toolCalls',...)` for deterministic checks. The loop must NOT debit per step itself if the broker already does — pick exactly one owner (broker per ADR-014) and have the engine only READ remaining for its while-gate. Tests must assert remaining == budget−N after N executed calls.

3. **Two ScriptedBrain implementations exist**: production src/brains/scripted.ts (title/type-keyed, the spec's 'ScriptedBrain') and a queue-based test double in tests/engine/stubs.ts. AC-1 references the production one; the test-double also needs a step shim. Don't conflate them — the spec's [write_file, run-of-two-calls, artifact] script targets the production ScriptedBrain.Script.step.

4. **AC-1 phrasing 'run-of-two-calls' is ambiguous**: is one step allowed to return TWO ToolCalls (batching, which ADR-015 explicitly supports) or are these two sequential steps? The frozen `StepResult.calls` being an array implies batching; the test should assert a single step returning two ToolCalls both get brokered and both logged. Flag for the builder to confirm against the barrier-frozen shape.

5. **Exact step-context-injection mechanism is unspecified**: 'N tool calls remaining' could be a new BrainContext field or a synthesized transcript message. ADR-015 calls it 'mechanical scaffolding'; the simplest is a transcript system/tool message, avoiding a new BrainContext field the barrier may not have frozen. Builder must match whatever the barrier froze rather than inventing a field.

6. **Build-scheduling overlap**: F-34 and F-35 also touch src/engine/engine.ts (spec line 49-50). F-32's loop insertion in runAttemptLoop must be a localized, mergeable change (a guarded branch at the produce call), not a refactor of the attempt loop, to avoid converge conflicts.

7. **'never a hang' (AC-2) is only meaningfully testable with a timeout assertion**: without it an infinite loop passes a content check. Every loop test must run under an explicit vitest timeout.

## Implementation notes (filled in by the building agent)

> Owned by the builder, not the planner. Starts empty.
