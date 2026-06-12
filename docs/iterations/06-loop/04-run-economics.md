---
id: F-64
title: "Run economics: provider pinning + duplicate-call refusal"
iteration: 06-loop
type: implement
intent: production
status: Not started
dependsOn: []
contracts: [ADR-005, ADR-017]
---

# Feature: Run economics: provider pinning + duplicate-call refusal

**ID:** F-64 · **Iteration:** 06-loop · **Status:** Not started

## What this delivers (before → after)
**Before:** cache-hit share reads 0.0% on every live run (OpenRouter provider
routing breaks prefix-cache affinity); cheap-tier models re-issue identical
tool calls on long runs — carried debt from A7/A8.
**After:** provider-pinned requests make caching fire and byte-identical
re-reads are refused in-loop — the two named levers landed before the most
transcript-heavy runs yet.

## Reading brief
- `src/brains/llm.ts` — `buildStepRequest` (~:241), `readUsage` (~:103),
  `StepRequest` wire type, `cachedPromptTokens` extraction
- `src/brains/openrouter.ts` — wire shape; where `provider` field lands on the
  request body
- `src/engine/engine.ts` — per-call seam in the step loop (~:1809); the
  `for (const call of stepOutput.calls)` block where the duplicate guard slots in
- `src/eventlog/projections.ts` — `costSummary` (~:274); `cachedPromptTokens`
  accumulation; cache-hit share computation
- Iteration-05 build-notes debt entries (A7/A8 items)

## Dependencies (must exist before this starts)
None — can start as soon as the iteration's contracts are frozen.

## Contracts touched
- `StepRequest` (source of truth: ADR-005, `src/brains/llm.ts`) — adds
  optional `provider?: { order: string[]; allow_fallbacks: boolean }`; absent
  config → field absent (wire-compatible with providers that ignore it).
- Tool-call event (source of truth: ADR-017, `src/contract/events.ts`) —
  `outcome: 'ran' | 'refused'` already exists; duplicate-refused calls use
  `'refused'` with a reason naming the earlier result; NOT debited from
  `toolCalls` budget counter.
- `costSummary` projection (`src/eventlog/projections.ts`) — adds cache-hit
  share (cachedPromptTokens / promptTokens) to the per-run summary output.

## Acceptance criteria
1. `StepRequest` carries `provider` (order + `allow_fallbacks`) from per-tier
   binding config; absent config → field absent (wire-compatible).
2. Scripted test shows the field serialized correctly per tier. Live evidence
   bar (operator-run, recorded in build notes): `cachedPromptTokens > 0` on a
   transcript-heavy run.
3. A tool call byte-identical (name + canonicalized args) to an earlier call in
   the same attempt is refused with a reason naming the earlier result; NOT
   debited from `toolCalls`; tool-call event `outcome: 'refused'`.
4. Refusal applies to read-only tools only (`fs.read` / retrieval grants);
   `run_script` repeats are always allowed (red → green requires them); a
   re-read AFTER an intervening `write_file` to the same path is allowed.
5. `costSummary` reports cache-hit share per run.

## Testing requirements
- Unit tests for `buildStepRequest` per tier: field present when config set,
  absent when not.
- Step-loop duplicate-guard units: AC 3 (byte-identical refused), AC 4
  (`run_script` allowed; write-invalidation allows subsequent re-read).
- `costSummary` projection test: `cachedPromptTokens` accumulates correctly;
  cache-hit share computed.

## Manual setup required
None — provider pinning config is per-tier in the engine's tier-binding config;
no external credentials beyond the existing `OPENROUTER_API_KEY`.

## Build plan (approved)
- [ ] Chunk 1 — Provider field + tier-binding plumb: add optional `provider`
  to `StepRequest`; thread per-tier config through `buildStepRequest`; absent
  config → omit field; satisfies AC 1, 2; tests:
  `tests/brains/llm.provider.test.ts` (per-tier serialization); contract
  touchpoint: `StepRequest` barrier shape.
- [ ] Chunk 2 — Duplicate guard at the `engine.ts` per-call seam: maintain a
  per-attempt set of `(name, canonicalizedArgs)` keys; byte-identical read-only
  call → `'refused'` result with reason, no `toolCalls` debit, event emitted;
  `run_script` always passes through; `write_file` to path X invalidates the
  re-read guard for X; satisfies AC 3, 4; tests:
  `tests/engine/duplicate-guard.test.ts`; contract touchpoint: tool-call event
  `outcome` field (uses existing `'refused'` variant, no schema change).
- [ ] Chunk 3 — Cache share in cost summary + tests: accumulate
  `cachedPromptTokens` in `costSummary`; compute share = cached / prompt;
  include in summary output; satisfies AC 5; tests:
  `tests/eventlog/cost-summary.test.ts`; contract touchpoint: none (additive
  projection output field).

### Test strategy
All three chunks are unit-testable without network. The provider-field tests
use the existing `stubFetch` pattern from `llm.step.test.ts` (both field-
present and field-absent). The duplicate-guard tests exercise the key edges in
AC 4 (run_script pass-through, write-invalidation). The cost-summary test
seeds an event sequence with `cachedPromptTokens` on some steps and asserts
the computed share.

### Contract touchpoints
`StepRequest` is a frozen barrier shape shared with the OpenRouter adapter;
the `provider` field must be additive (absent = no change to existing wire).
The tool-call event's `outcome: 'refused'` variant is reused, not extended —
no `FactoryEvent` schema change required for the duplicate guard.

### Manual setup
None.

### Risks
- `allow_fallbacks: false` trades availability for cache affinity; this must be
  per-tier config (not a global flag) so high-tier runs can opt in without
  affecting low-tier retry behavior.
- Over-eager refusal harming legitimate exploration: guard is byte-identical
  + read-only only; the write-invalidation rule handles the common re-read-
  after-edit case; builder must test the edge cases in AC 4 explicitly.

## Implementation notes

**Chunk 1 — per-tier provider config source:**
`LlmBrainConfig.providerByTier` (a `Partial<Record<Tier, {order: string[]; allow_fallbacks: boolean}>>`)
is the source of truth. In `LlmBrain.step()`, `this.config.providerByTier?.[ctx.tier]` is resolved
at the start of the method and passed to `buildStepRequest` as the optional 5th argument. When the
entry is absent, `buildStepRequest` receives `undefined` and omits the field entirely from the wire
body. The same resolved value is threaded to the malformation re-prompt call so both calls carry the
same provider pinning. `openrouter.ts` does not yet populate `providerByTier`; an operator adds it
to the returned config to activate pinning on a per-tier basis.

**Chunk 2 — canonicalization rule for args:**
`stableJsonStringify(args)` — recursive alphabetical key sort before JSON serialization, array
order preserved. The duplicate guard key is `"${name}\0${stableJsonStringify(args)}"` (NUL separator
is unambiguous between name and args). Two calls that are semantically identical but whose LLM-emitted
key order differs will produce the same key and be correctly deduplicated.

**Chunk 3 — write-invalidation mechanism:**
After a successful `write_file` execution, `invalidateReadGuardForPath(seenCalls, writtenPath)` removes
all guard set entries for every read-only tool using the written path as the `path`, `filePath`, or
`query` arg. This is O(readOnlyTools × candidateArgKeys) = O(constant) per write and handles the
typical `read_file({path}) → write_file({path}) → read_file({path})` edit cycle. Only the specific
path is invalidated; unrelated paths remain guarded. The invalidation fires only on `result.ok` writes
so a refused write (scope violation, grant missing) does not spuriously clear the guard.

