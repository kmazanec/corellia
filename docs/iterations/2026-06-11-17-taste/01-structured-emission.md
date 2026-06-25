---
id: F-51
title: Two-phase structured emission
iteration: 05-taste
type: implement
intent: production
status: shipped
dependsOn: []
contracts: [ADR-023]
---

# Feature: Two-phase structured emission

**Before:** artifact-emitting leaves must package large JSON as their final
chat message — the iteration-04 live failure mode.
**After:** types declaring `outputSchema` run explore-then-emit: the loop's
artifact-kind output signals exploration-complete; one dedicated metered
step call with `BrainContext.outputSchema` set produces the artifact via
provider `response_format: json_schema`. Types without the field are
byte-identical to today.

## Reading brief
ADR-023 · the step loop + artifact branch in `src/engine/engine.ts` ·
`buildStepRequest`/`translateStepResponse` in `src/brains/llm.ts`.

## Acceptance criteria
1. Scripted: a type with outputSchema gets exactly one extra step call whose
   ctx carries the schema and whose context tail says emit-now; its text
   result becomes the artifact; usage debited/evented like any step.
2. Adapter: when ctx.outputSchema is present the wire request carries
   `response_format: {type:'json_schema', json_schema:{...strict}}`; absent →
   no response_format (pinned both ways with stubFetch).
3. learn types (map-repo, deep-dive-region) declare their artifact schemas;
   the packaging-tolerant parser remains as fallback.
4. No-outputSchema regression: existing suite untouched.
5. Budget/ceiling gates apply to the emit call (it is a step like any other).

## Build plan (approved)
- [x] Barrier consumption + engine two-phase seam (runStepLoop) + scripted
  tests (tests/engine/step-loop.test.ts: emit-call count, ctx schema, gates).
- [x] Adapter response_format translation + wire tests
  (tests/brains/llm.step.test.ts both ways).
- [x] Learn-type schemas (KnowledgeArtifact/RegionFacts JSON-Schemas beside
  the contract types, declared on the two type cards) + knowledge-e2e pin.

Trunk feature (engine.ts + llm.ts). Builders never run live scripts.

## Implementation notes

Built as planned + review repairs (strict-mode-faithful schemas incl. nullable-line pattern; schema survives the malformation re-prompt). Live: the dive and write-prd paths emit reliably through response_format.
