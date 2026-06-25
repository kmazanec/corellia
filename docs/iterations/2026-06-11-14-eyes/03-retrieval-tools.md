---
id: F-43
title: Typed retrieval API as granted tools
iteration: 04-eyes
type: implement
intent: production
status: shipped
dependsOn: []
contracts: [ADR-020, ADR-014]
---

# Feature: The typed retrieval API as granted tools

**ID:** F-43 · **Iteration:** 04-eyes · **Status:** Shipped (build/04-eyes)

## What this delivers (before → after)

**Before:** a goal that needs repo knowledge re-reads the repo raw; context
cost is paid per goal, and nothing mediates retrieval.
**After:** five retrieval functions — `find_symbol`, `find_exemplar`,
`conventions_for`, `stack_versions`, `impact` — exist as library functions
AND as read-only ToolImpls registered under the `retrieval.api` grant, so
leaves consult knowledge through the broker like any other capability.

## Reading brief

`docs/adrs/ADR-020` · `src/engine/tools.ts` (ToolImpl idiom from the file
tools) · `src/contract/tool.ts` (`GRANT_TOOL_MAP` — the barrier adds the
retrieval entries) · DESIGN.md § "The knowledge artifacts — typed, fresh,
queryable".

## Requirements traced (from the PRD)

R11 (typed retrieval API) · AC-15's "a leaf consults impact() before
touching code".

## Dependencies / contracts

No hard deps: builds against F-42's frozen surface (`scanImports`/`impact`)
with fixture graphs in tests; real integration at F-46. Consumes
`projectKnowledge` (F-41) the same way — via its frozen projection signature.

## Acceptance criteria

1. `find_symbol(name)`: returns definition-site candidates as
   `path:line`-prefixed text (definition-pattern grep: `function|class|
   const|interface|type|def|func` forms), bounded count, deterministic
   ordering.
2. `find_exemplar(pattern)`: returns pointer(s) from the conventions
   artifact matching the pattern, falling back to a content search; absent
   artifact → honest "no conventions artifact" result, never an invented
   answer.
3. `conventions_for(surface)`: returns the conventions-artifact pointers +
   rules for the named surface; absent/stale artifact states so.
4. `stack_versions()`: parses the repo's manifest/lockfile (package.json +
   lockfile v1; generic fallback listing manifest files) into name→version
   text.
5. `impact(files)`: wraps F-42 over a current scan (or injected graph),
   returning impacted files + test files.
6. Each function has a ToolImpl twin whose `execute` is read-only; all five
   are refused by the broker for a type granting none of `fs.read`/
   `retrieval.api` (grant-map test), and granted under `retrieval.api`.

## Build plan (approved)

- [x] **Library functions** — `src/library/retrieval.ts`: the five
  functions, knowledge-projection-aware (2/3 read artifacts; 1/4/5 read the
  repo/scan), all returning transcript-friendly text + structured form.
  Tests: `tests/library/retrieval.test.ts` (fixture repo + synthetic
  artifacts/graph; ACs 1–5).
- [x] **ToolImpls + grant wiring** — `retrievalTools(deps)` returning the
  five ToolImpls (mirror `runScriptTool`'s shape); broker-level tests for
  grant refusal/allow using the barrier's extended `GRANT_TOOL_MAP`
  (`tests/engine/broker.test.ts` extend; AC-6).

### Test strategy

Unit tests over fixtures and synthetic projections; broker tests reuse the
existing refusal idiom. No engine imports (assembly registers the tools at
F-46). No network. Per-chunk named files; one typecheck + full suite at end.

## Implementation notes

Built as planned plus hardening (posix-stable impact keys, symbol-cap/default-export/arrow pins, regex fallback). RetrievalDeps is fully structural; assembly wires scanImports + the knowledge projection.
