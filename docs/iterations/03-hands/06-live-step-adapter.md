---
id: F-36
title: Live step adapter + failure semantics
iteration: 03-hands
type: implement
intent: production
status: not-started
dependsOn: []
contracts: [ADR-015, ADR-018, ADR-005]
---

# Feature: Live step adapter + provider-failure semantics

**ID:** F-36 · **Iteration:** 03-hands · **Status:** Not started

## What this delivers (before → after)

**Before:** `LlmBrain` does one-shot completions; a live model cannot drive
tools; transport errors are ad hoc.
**After:** `LlmBrain` implements the step protocol as a thin translation to
OpenAI-compatible tool-calling (no internal looping — ADR-015), with
ADR-018's three-layer failure semantics: bounded transport retries with
backoff, one corrective re-prompt on malformed output, terminal errors
blocking with a brief. A live model can drive a leaf through the loop.

## How it fits the roadmap

The bridge from scripted correctness to live capability — and the carrier of
the iteration's existential risk test (PRD risk #1: can lower-power models
drive the loop?). Its own acceptance is adapter behavior; the full live
end-to-end is the **iteration convergence check**, not this feature's
private bar.

## Reading brief

`docs/adrs/ADR-015` (protocol, no-internal-looping rule) ·
`docs/adrs/ADR-018` (the failure table) · `docs/adrs/ADR-005` ·
`src/brains/llm.ts` + `src/brains/openrouter.ts` (the code being extended).

## Requirements traced (from the PRD)

R2 via the live path · AC-12 (usage arrives through this adapter) · risk #1
(de-risk evidence: a sonnet-class model completes the convergence demo).

## Dependencies (must exist before this starts)

None — translates the frozen step protocol; tests mock the wire. The live
convergence demo consumes F-31..F-35's implemented behavior, which is why it
runs at convergence rather than inside this feature.

## Unblocks (what waits on this)

The iteration convergence check (below).

## Contracts touched

`Brain.step` (ADR-015) — implemented. Retry/malformation events (ADR-018) —
emitted.

## Acceptance criteria (product behavior)

1. Given a wire response with tool calls, then they translate to step
   results with ids preserved; given a content-only response, it parses as
   the artifact path of the step protocol.
2. Given two consecutive 429/5xx responses then a success (mocked), then the
   step succeeds, exactly the retries occurred with backoff, each is an
   event, and no attempt was consumed.
3. Given retries exhausted, then the step fails into the attempt ladder
   carrying the transport error.
4. Given one malformed tool-call payload, then one corrective re-prompt
   (carrying the parse error) is sent and debited; a second consecutive
   malformation fails the step.
5. Given a 401/invalid-model response, then no retries occur and the goal
   blocks with a decision brief naming the terminal cause.
6. The transcript sent each step is prefix-stable (byte-identical history)
   so provider prompt caching can engage.

## Testing requirements

Mocked-fetch wire tests for every ADR-018 row plus translation fidelity and
prefix stability. Live usage only via the convergence demo (below), behind
`OPENROUTER_API_KEY`.

## Iteration convergence check (the iteration's done-when, runs after all features land)

`npm run live:hands`: a live sonnet-class `implement` leaf, in a tree
worktree on a fixture repo, builds a small module test-first — its declared
test script actually runs (red, then green after the model's fix), one
deliberately scope-violating write is refused and visible in the transcript,
and the run report prints real token + dollar totals from event usage.
That single run is AC-7/8/12 observed live, and PRD risk #1's first
evidence.

## Manual setup required

`OPENROUTER_API_KEY` in `.env` for the convergence demo (already present on
the operator's machine).

## Implementation notes (filled in by the building agent)

> Owned by the builder, not the planner. Starts empty.

## Build plan (approved)

- [ ] **Request shaping: transcript -> OpenAI tool-calling wire body (pure, deterministic)** — Delivers a pure function that turns (StepTranscript, ToolDef[], model) into the chat-completions request body with a tools[] array and messages[] mirroring the transcript — the byte-identical prefix that makes AC-6 satisfiable. No network yet. Satisfies AC-6 (prefix stability). Test target: tests/brains/llm.step.test.ts — describe('step request shaping'). Contract touchpoint: Brain.step (consumes StepTranscript + ToolDef wire shapes; no new contract introduced).

- [ ] **Response parsing + translation fidelity: tool_calls vs content -> StepOutput with ids preserved** — Delivers step() returning {kind:'tool-calls', calls, usage} when the wire response has tool_calls (ids preserved 1:1), and {kind:'artifact', ...} when it is content-only (reusing parseFileBlocks for the artifact path). Usage fields are read off the response (ADR-017). This is the happy-path translation, no failure handling yet. Satisfies AC-1 (tool calls translate with ids preserved; content-only parses as the artifact path) and AC-12 (usage arrives through this adapter). Test target: tests/brains/llm.step.test.ts — describe('step translation'). Contract touchpoint: Brain.step (consumes ToolCall/ToolResult ids, Usage fields per ADR-017).

- [ ] **Transport layer: bounded retry + backoff/jitter on 429/5xx/timeout, incidents on the envelope, no usage debit** — Delivers a retry wrapper around the step fetch: 429/5xx/timeout retried up to a small cap (~3) with exponential backoff + jitter via an injectable sleep seam; on eventual success the step proceeds; on exhaustion it fails into the attempt ladder carrying the transport error. No usage debited for retried-away calls. **Purity decision (approval review, 2026-06-11): the adapter does NOT hold the EventStore** — each retry is recorded as an incident on the barrier-frozen step-result envelope (`incidents: TransportIncident[]`), and the ENGINE appends the corresponding `transport-retry` events (ADR-015's purity stays intact: the brain reports, the engine records). Satisfies AC-2 (two 429/5xx then success: step succeeds, exactly N retries with backoff, each surfaced as an incident, no attempt consumed) and AC-3 (retries exhausted -> step fails into attempt ladder carrying transport error). Test target: tests/brains/llm.step.test.ts — describe('step transport retries') asserts the incidents on the returned envelope; the engine-side event append is covered by F-32's loop tests with an incident-bearing scripted step. Contract touchpoint: consumes the barrier-frozen `incidents` field on the step envelope + the `transport-retry` event member (ADR-018).

- [ ] **Protocol layer: one corrective re-prompt on malformed tool-call output, debited; second malformation fails the step** — Delivers: when the model returns an unparseable/unknown-tool/bad-shape tool call, step() issues exactly one corrective re-prompt carrying the parse error (generalizing the existing callJson two-fetch re-ask), debits usage, and on a second consecutive malformation fails the step. The malformation/re-prompt is recorded as an **incident on the step envelope** (same purity decision as the transport chunk: the engine appends the `malformation-reprompt` event). Satisfies AC-4 (one malformed payload -> one corrective re-prompt carrying the parse error, debited; second consecutive malformation fails the step). Test target: tests/brains/llm.step.test.ts — describe('step malformation') asserts the incident on the envelope. Contract touchpoint: consumes the barrier-frozen `incidents` field + `malformation-reprompt` event member (ADR-018).

- [ ] **Terminal classification: 401/403/invalid-model + unknown -> blocker-grade failure, zero retries, named cause** — Delivers a small named classification table (retryable vs terminal, unknown defaults terminal per ADR-018) that, on a terminal response, performs NO retries and returns a blocker-grade failure naming the terminal cause for the engine to surface as a decision brief. Satisfies AC-5 (401/invalid-model: no retries, goal blocks with a decision brief naming the terminal cause). Test target: tests/brains/llm.step.test.ts — describe('step terminal errors'). Contract touchpoint: none (classification table is internal; returns the frozen failure shape the engine reads).

- [ ] ~~Convergence wiring: npm run live:hands~~ **MOVED to F-37 (approval review, 2026-06-11)** — the live convergence script consumes the assembled engine (worktree + broker + tools + checks + accounting), and assembly is F-37's deliverable; a script that assumes an assembly no feature produces was the gap. F-36 ends at a fully wire-tested adapter.

### Test strategy

All correctness is proven by mocked-fetch unit tests in tests/brains/llm.step.test.ts using the existing stubFetch pattern (fetchImpl injection, status/body sequences) — one test per ADR-018 row plus translation fidelity and prefix stability. Backoff is tested with an injected fake clock/sleep (assert delays requested with jitter bounds, never real wall-clock). Terminal classification is tested via a small table-driven test. The convergence demo (npm run live:hands) is a SEPARATE deployed/live check behind OPENROUTER_API_KEY that exercises F-31..F-35's real implementations end-to-end; it is the ITERATION's done-when, explicitly NOT this feature's private acceptance bar, and must not gate F-36's unit suite. Run JUST `npx vitest run tests/brains/llm.step.test.ts` per chunk; one repo-wide `npm run typecheck` gate at feature end. No live API calls in any test in the suite.

### Contract touchpoints

- **Brain.step (ADR-015, iteration-3 contract barrier)** — Action: consumes. Signature: `step(goal: Goal, transcript: StepTranscript, tools: ToolDef[], ctx: BrainContext): Promise<StepOutput>` — where StepOutput is the frozen union `{ kind: 'tool-calls'; calls: ToolCall[]; usage: Usage } | { kind: 'artifact'; artifact: Artifact; usage: Usage }`; ToolCall = {id,name,args} and ToolResult = {callId,ok,output} per ADR-014; StepTranscript is the ordered message/tool-call/tool-result history. F-36 IMPLEMENTS this method on LlmBrain; it does NOT define the signature — the signature is frozen by the iteration barrier and consumed identically by F-32's engine loop.

- **Brain interface (src/contract/brain.ts, ADR-005)** — Action: extends. Signature: Brain gains `step(...)` as a fifth method alongside decide/produce/judge/repair — barrier-frozen, additive, optional-or-required per the iteration plan. LlmBrain must satisfy it; ScriptedBrain (F-32's concern) satisfies it separately. decide/judge/repair/produce signatures UNCHANGED.

- **FactoryEvent (src/contract/events.ts, ADR-018 + ADR-017)** — Action: consumes (indirectly). Signature: Barrier adds (not by F-36): a transport-retry event member, a malformation/re-prompt event member, Usage fields {promptTokens, completionTokens, costUsd?} on brain-call/step events, and an `incidents: TransportIncident[]` field on the step-result envelope. Per the approval-review purity decision, F-36 does NOT touch the EventStore: it returns incidents on the envelope and the ENGINE appends the events. If the barrier has not frozen the incidents field and the two members, F-36 cannot satisfy AC-2/AC-4 — flagged as the top risk.

- **ToolDef / ToolCall / ToolResult (src/contract/, ADR-014)** — Action: consumes. Signature: ToolDef {name, description, parameters: JSONSchema}; ToolCall {id, name, args}; ToolResult {callId, ok, output}. F-36 translates these to/from the OpenAI tools[] / tool_calls[] / role:'tool' wire shapes, preserving ids. Consumed only.

### Manual setup

- OPENROUTER_API_KEY in .env for the convergence demo (npm run live:hands) — spec states it is already present on the operator's machine. Not needed for any unit test.
- A small fixture repo (or fixture path) for the live:hands convergence demo: a tree worktree on a repo with a declared test script the model can run red-then-green. The spec assumes this exists for the convergence check; if absent, the operator/iteration-convergence step must provide it.

### Risks

- **Barrier-frozen contract members do not yet exist:** dependsOn:[] is misleading: F-36 HARD-needs the barrier-frozen Brain.step signature + StepTranscript/StepOutput/Usage shapes and the ADR-018 retry/malformation + ADR-017 usage event members — NONE of which exist in src/contract/ today (verified: brain.ts has only 4 methods; events.ts has no retry/malform/usage members). If the iteration plan does not freeze these in the contract barrier before F-36 builds, this feature is blocked. This is the single largest risk and must be resolved at barrier-reconciliation time, not discovered mid-build.

- **Prefix stability (AC-6) is subtle and easy to break:** AC-6 (prefix stability) is the subtlest criterion and is easy to break accidentally: any nondeterminism in transcript serialization (object key ordering in args JSON, injected timestamps, a Date.now in a header, set/map iteration order) silently defeats provider prompt caching. The test asserts byte-identical history prefix across two consecutive steps — but a passing test on the mock does not guarantee the real wire body is prefix-stable unless serialization is a single pure function. Mitigate by routing ALL transcript->messages construction through one deterministic function and snapshot-testing its output.

- **Terminal classification table must be explicit:** ADR-018 says unknown status codes default to TERMINAL (conservative), but the spec's AC-5 only names 401/invalid-model. The classification table must be explicit about the full partition (retryable: 429,5xx,timeout; terminal: 401,403,invalid-model,unknown) or AC-3 (exhaustion) and AC-5 (terminal) become ambiguous. Pin the table as the source of truth; do not scatter inline status checks (ADR-018 explicitly requires 'a small named table, not inline conditionals').

- **Backoff must be injectable; tests must not sleep real time:** Backoff spends real wall-clock; tests must NOT sleep. The sleep/clock must be an injectable seam (e.g. an optional sleepFn on LlmBrainConfig defaulting to setTimeout-promise) or retry tests run slow and flaky. AC-2 asserts 'exactly the retries occurred with backoff' — provable only if the test can observe requested delays without elapsing them.

- **Attempt consumption is an engine-side concern, not testable here:** AC-4 'debited' and AC-2 'no attempt was consumed' are engine-side accounting concerns (token debit, attempt ladder) but are asserted as adapter behavior here. The adapter can only EMIT usage on its events and SIGNAL failure class; whether an attempt is consumed is the engine's (F-32) reading of that signal. The adapter's testable contract is: retries emit retry-events with no usage; malformation re-prompt emits with usage; terminal returns a blocker-grade failure. The 'attempt consumed / not consumed' half is verified at convergence against F-32, not in this feature's unit suite — call this out so the builder does not try to test engine accounting through the adapter.

- **Convergence demo is iteration-level, not feature-level:** The convergence demo (live:hands) depends on F-31..F-35 being implemented AND on a live OPENROUTER_API_KEY and a real sonnet-class model actually driving the loop (PRD risk #1). It is non-deterministic, costs money, and is the ITERATION's bar, not F-36's. Do not let its red/green block merging F-36's unit-green adapter.
