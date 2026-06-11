# Build plan — 03-hands

**Status:** Approved · **Approved by:** Keith (conversation, 2026-06-11) · **Iteration goal:** After this iteration, a live sonnet-class implement leaf can build a small module test-first in a tree worktree — its declared test script runs red then green, a scope-violating write is refused and visible in the transcript, and the run report prints real token and dollar totals from provider-reported usage. · **Iteration slug:** `03-hands`

## How to use this

1. A human reviews this index + the per-feature "Build plan (approved)" sections in each spec and approves it in conversation. The assistant flips Status to "Approved" and commits — the human does NOT edit this file.
2. When the human is ready, they run the build workflow: it implements + commits the frozen contracts first, then builds each feature in its own worktree (independent features concurrently, hard-dependent ones after their deps), reviews each, opens ONE MR, and records each feature's outcome back into its spec. Every artifact is scoped to the iteration slug above, so this iteration can build concurrently with others.

## Blockers

None. Both plan-time blockers were resolved by the operator at approval
(2026-06-11):

**Resolved 1 — F-33 executing-check variant: option A, extend the contract.**
The barrier freezes an executing variant of the check shape in
`src/contract/goal-type.ts`: checks receive an exec context (e.g.
`{sandboxRoot, runScript}`), so executing checks live in the declared
deterministic-check array. Rationale: a post-produce hook would split the
eval surface in two — the type's declared checks would no longer describe
what actually gates — and iteration 4's full-suite-at-root reuses this same
shape. Existing artifact-only checks remain valid (the variant is additive).

**Resolved 2 — engine.ts overlap: option A, serial trunk F-32 → F-35 → F-34.**
The three engine-touching features stack on the `build/03-hands` trunk in one
shared worktree, a fresh builder agent per feature: F-32 first (the loop is
the biggest structural insertion), F-35 next (rewrites the ~11 brain-call
sites to metered returns, including the loop's new ones), F-34 last
(tree-root/emission region). F-31, F-33, F-36 build concurrently in their own
worktrees beside the chain. These `after` edges are **file-overlap scheduling
edges, not behavior dependencies** — recorded in the features table below.

**Plan patch (approval review, 2026-06-11).** A manual review of the six
plans against the roadmap/PRD/DESIGN found five reconciliation gaps the
contracts phase missed; the operator directed a rewrite. Decisions recorded:

- **F-33 rewritten to resolved Blocker 1** (CheckContext at invocation; the
  closure-factory approach is rejected — static type definitions cannot
  close over per-tree runtime state).
- **Grant→tool map frozen in the barrier:** `fs.read` ⊇ {read_file,
  list_dir, search}; `fs.write` ⊇ {write_file}; `test.run_scoped` |
  `test.run_impacted` ⊇ {run_script}; `fs.write_test_dirs` unmapped/deferred
  in v1. Grants stay capability-level (GOAL-TYPES.md vocabulary); the
  library's grant strings are not renamed.
- **`run_script` de-orphaned:** the broker's dispatch table is an injectable
  `ToolImpl[]`; F-33 exports `runScriptTool` as a ToolImpl; F-37 registers it
  at assembly. ADR-014's one-mediator rule holds for script runs.
- **Debit seam, one owner:** the engine owns the per-goal tool-budget
  counter; the broker debits via the engine-provided `onDebit` (returns
  remaining); loop gate and step injection read the same counter;
  `Goal.budget` is never mutated.
- **Adapter purity:** brains never hold the EventStore. Transport retries
  and malformation re-prompts return as `incidents` on the barrier-frozen
  step envelope; the engine appends the `transport-retry` /
  `malformation-reprompt` events.
- **Barrier compiles green (ownership de-duplicated):** the barrier commit
  includes the *mechanical* compile-true propagation — zero-usage
  `Metered` wrappers on both brains, throwing `step()` stubs, `.value`
  destructuring at all ~13 engine brain-call sites — so every feature starts
  from a green trunk. F-35 chunk 1 is re-scoped to real usage parsing;
  F-32/F-36 replace the step stubs with real implementations.
- **F-37 (assembly) added:** no feature owned composing the modules (engine
  wiring, broker construction, CheckContext supply, emission diff-check,
  the convergence tests). F-37 owns all of it, with honest hard deps on
  F-31..F-36; the `live:hands` chunk moved there from F-36.
- **Declared-scripts source stated:** the declared entry-point map is
  supplied by the commission/fixture; reading `package.json` automatically
  is iteration-4 comprehension work.

## Frozen contracts (implemented first, before any feature work)

All six contracts below are landed in a single barrier commit on `build/03-hands` before any feature worktree starts. Features that consume a contract are noted; features that must NOT import a contract beyond their scope are called out explicitly.

| Contract | Source of truth | Frozen signature (file) | Per-feature extensions | Exhaustive consumers |
|---|---|---|---|---|
| Tool contract: `ToolDef` / `ToolCall` / `ToolResult` / `ToolBroker` | ADR-014 (+ ADR-013 exact grants, ADR-016 sandbox root) | NEW `src/contract/tool.ts`, re-exported from `src/contract/index.ts` — incl. the **`ToolImpl` registration shape** (broker dispatch table is injectable `ToolImpl[]`) and the **grant→tool map** (`fs.read` ⊇ read_file/list_dir/search; `fs.write` ⊇ write_file; `test.run_scoped`\|`test.run_impacted` ⊇ run_script) | Barrier: introduces full file. F-31: wires real `ToolBroker` impl. F-32: consumes via `FakeBroker` test double; routes calls through `execute()`. F-34: consumes ONLY sandbox-root concept — must NOT import `ToolBroker`. F-36: translates `ToolDef`/`ToolCall`/`ToolResult` to/from OpenAI wire shapes. | `src/library` or `src/engine` `ToolBroker` impl (F-31): dispatch over V1 tool name set (`read_file`/`write_file`/`list_dir`/`search`/`run_script`). |
| `FactoryEvent` union — all iteration-3 additive members | ADR-003, ADR-014, ADR-015, ADR-016, ADR-017, ADR-018 | EXTEND `src/contract/events.ts` — additive only; adds `tool-call`, `step`, `script-ran`, `worktree-created`, `worktree-collected`, `worktree-preserved`, `produced`, `ceiling-reached`, `transport-retry`, `malformation-reprompt`; adds optional `usage?:Usage` to `decided`/`judge-verdict`/`repair-applied` | F-31: `tool-call`. F-32: `step`; consumes `tool-call`. F-33: `script-ran`. F-34: `worktree-created`/`worktree-collected`/`worktree-preserved`. F-35: `produced`, `ceiling-reached`, optional `usage` on three existing members. F-36: `transport-retry`, `malformation-reprompt`; emits `step` usage. | `src/eventlog/projections.ts` `traceStats()` exhaustive switch (add no-op arms for every new member). New cost/spend projection (F-35). `statusGlyph()`/`renderTree()` (verify no silent change). `jsonl-store.ts` & `memory-store.ts` (structural append — no per-member switch needed). `engine.ts` (confirm no closed switch on `e.type` today). |
| `Brain.step` + `StepOutput` / `StepTranscript` step protocol | ADR-015 (engine owns loop; brain pure per step), ADR-014, ADR-017 | EXTEND `src/contract/brain.ts` — add `step()` as fifth `Brain` method; add `StepMessage`, `StepTranscript`, `StepOutput` types (the step envelope carries `incidents: TransportIncident[]` per the adapter-purity decision); four classic methods rewritten to `Metered<...>` with the barrier ALSO shipping the mechanical compile-true propagation (zero-usage wrappers, throwing step stubs, call-site destructuring) | Barrier: introduces all step types + `Brain.step` signature. F-32: `ScriptedBrain` implements `step`; engine loop consumes it. F-36: `LlmBrain` implements `step` as OpenAI tool-calling translation. | `src/engine/engine.ts` step loop (F-32): exhaustive switch over `StepOutput.kind`. `src/brains/scripted.ts` (F-32): must implement `step`. `src/brains/llm.ts` (F-36): must implement `step`. |
| `Usage` / `Metered<T>` and the metered `Brain` return types | ADR-017, ADR-005 | EXTEND `src/contract/goal.ts` — add `Usage` and `Metered<T>`; re-export from `src/contract/index.ts`; rewrite four classic `Brain` method return types to `Metered<...>` in same commit as `Brain.step` | Barrier: introduces `Usage`, `Metered<T>`, rewrites four method signatures. F-35: owns metered call-site rewrite in `engine.ts`; records `usage` on events. F-36: produces `Usage` from OpenRouter response; attaches to `StepOutput` and four metered returns. | `src/brains/llm.ts` (F-35/F-36). `src/brains/scripted.ts` (F-35): wraps with zero/scripted `Usage`. `src/engine/engine.ts` (~11 brain-call sites, F-35). `src/contract/index.ts`: re-export `Usage`, `Metered`. |
| `Goal.spendCeilingUsd` (per-tree dollar ceiling) | ADR-017, ADR-007 | EXTEND `src/contract/goal.ts` — add optional `spendCeilingUsd?: number`; must NOT be added to `Budget` (ADR-007 froze `Budget` at exactly 4 dimensions) | Barrier: adds the field. F-35: reads ceiling in `engine.ts`, applies $15 default at root, threads to child runs, halts on `ceiling-reached`. | `src/engine/engine.ts` root run (F-35). `src/engine/budget.ts` `subdivide()` — explicitly NOT a consumer; ceiling must not be subdivided. |
| Worktree lifecycle surface (`openTreeWorktree` return shape) | ADR-016 | Engine-side, NOT a `src/contract/` type. Frozen return: `openTreeWorktree(...) => Promise<{ treeId: string; branch: string; root: string }>`. F-34 MUST NOT import `ToolBroker`. Worktrees under `<target-repo>/.claude/worktrees/<tree-id>/`, gitignored. | F-34: introduces `openTreeWorktree` + create/collect/teardown(preserve) lifecycle; emits `worktree-created`/`worktree-collected`/`worktree-preserved`; exposes `root` for a future broker. | `src/engine/engine.ts` tree-root path (**F-37**, assembly). `ToolBroker` construction bound to `root` (**F-37**). |
| Executing-check variant (resolved Blocker 1) | F-33 spec + ADR-014/ADR-016 | EXTEND `src/contract/goal-type.ts` — additive exec context on the deterministic-check shape (e.g. `CheckContext { sandboxRoot, runScript }` passed to `run`); existing artifact-only checks remain valid | Barrier: freezes the variant. F-33: implements the executing checks against it; F-37 wires the engine's two check-invocation sites to pass the real ctx. | `src/library/checks.ts` (existing checks adapt to the widened signature), `src/engine/engine.ts` check-invocation sites (F-37). |

## Features & build order

F-31..F-36 are behaviorally independent at the frozen-contract baseline.
Scheduling (resolved Blocker 2 + approval-review patch): F-31, F-33, F-36
fan out concurrently in their own worktrees once the barrier lands;
F-32 → F-35 → F-34 stack serially on the trunk (engine.ts overlap; F-34's
module itself no longer touches engine.ts but stays chain-end so its module
lands on the trunk F-37 wires). **F-37 (assembly) builds last, on the trunk,
after the concurrent features fold back — its deps are honest hard deps.**

| Feature ID | Spec | Build plan section | Stack | After (feature deps) |
|---|---|---|---|---|
| F-31 | [01-tool-broker-core.md](01-tool-broker-core.md) | "Build plan (approved)" in spec | typescript | *(contracts frozen)* |
| F-32 | [02-step-loop.md](02-step-loop.md) | "Build plan (approved)" in spec | typescript | *(contracts frozen)* |
| F-33 | [03-executed-checks.md](03-executed-checks.md) | "Build plan (approved)" in spec | typescript | *(contracts frozen)* |
| F-34 | [04-tree-worktree.md](04-tree-worktree.md) | "Build plan (approved)" in spec | typescript | F-35 *(engine.ts overlap — scheduling edge, not a behavior dep)* |
| F-35 | [05-real-accounting.md](05-real-accounting.md) | "Build plan (approved)" in spec | typescript | F-32 *(engine.ts overlap — scheduling edge, not a behavior dep)* |
| F-36 | [06-live-step-adapter.md](06-live-step-adapter.md) | "Build plan (approved)" in spec | typescript | *(contracts frozen)* |
| F-37 | [07-assembly.md](07-assembly.md) | "Build plan (approved)" in spec | typescript | F-31, F-32, F-33, F-34, F-35, F-36 *(hard deps — wires their implementations)* |

```json
{
  "iterationName": "03-hands",
  "iterationSlug": "03-hands",
  "buildBranch": "build/03-hands",
  "iterationGoal": "After this iteration, a live sonnet-class implement leaf can build a small module test-first in a tree worktree — its declared test script runs red then green, a scope-violating write is refused and visible in the transcript, and the run report prints real token and dollar totals from provider-reported usage.",
  "blockers": [],
  "resolvedDecisions": [
    "Blocker 1 (F-33 executing checks): option A — the barrier extends src/contract/goal-type.ts with an additive exec-context variant of the deterministic-check shape (e.g. CheckContext { sandboxRoot, runScript }); executing checks stay in the declared check array. Decided by Keith at plan approval, 2026-06-11.",
    "Blocker 2 (engine.ts overlap): option A — serial trunk F-32 → F-35 → F-34 in one shared worktree, fresh builder per feature; F-31/F-33/F-36 concurrent in their own worktrees. The after-edges on F-35/F-34 are file-overlap scheduling edges, not behavior deps. Decided by Keith at plan approval, 2026-06-11."
  ],
  "frozenContracts": [
    {
      "name": "Tool contract: ToolDef / ToolCall / ToolResult / ToolBroker",
      "sourceOfTruth": "docs/adrs/ADR-014-tool-interface-broker.md (+ ADR-013 exact grants, ADR-016 sandbox root)",
      "file": "src/contract/tool.ts",
      "consumers": ["F-31", "F-32", "F-34", "F-36"]
    },
    {
      "name": "FactoryEvent union — ALL iteration-3 additive members landed together",
      "sourceOfTruth": "docs/adrs/ADR-003-event-log-substrate.md + ADR-014 + ADR-015 + ADR-016 + ADR-017 + ADR-018",
      "file": "src/contract/events.ts",
      "consumers": ["F-31", "F-32", "F-33", "F-34", "F-35", "F-36"]
    },
    {
      "name": "Brain.step + StepOutput / StepTranscript step protocol",
      "sourceOfTruth": "docs/adrs/ADR-015-engine-owned-step-loop.md + ADR-014 + ADR-017",
      "file": "src/contract/brain.ts",
      "consumers": ["F-32", "F-36"]
    },
    {
      "name": "Usage / Metered<T> and the metered Brain return types",
      "sourceOfTruth": "docs/adrs/ADR-017-provider-usage-accounting.md + ADR-005",
      "file": "src/contract/goal.ts",
      "consumers": ["F-35", "F-36"]
    },
    {
      "name": "Goal.spendCeilingUsd (per-tree dollar ceiling)",
      "sourceOfTruth": "docs/adrs/ADR-017-provider-usage-accounting.md + ADR-007",
      "file": "src/contract/goal.ts",
      "consumers": ["F-35"]
    },
    {
      "name": "Worktree lifecycle surface (openTreeWorktree return shape)",
      "sourceOfTruth": "docs/adrs/ADR-016-worktree-per-tree-bare-exec.md",
      "file": "src/engine/ (engine-side, not src/contract/)",
      "consumers": ["F-34"]
    },
    {
      "name": "Executing-check variant (CheckContext on the deterministic-check shape)",
      "sourceOfTruth": "docs/iterations/03-hands/03-executed-checks.md + docs/adrs/ADR-014-tool-interface-broker.md + docs/adrs/ADR-016-worktree-per-tree-bare-exec.md (resolved Blocker 1, option A)",
      "file": "src/contract/goal-type.ts",
      "consumers": ["F-33"]
    }
  ],
  "features": [
    {
      "id": "F-31",
      "specPath": "docs/iterations/03-hands/01-tool-broker-core.md",
      "title": "Tool broker + core file tools",
      "stack": "typescript",
      "after": []
    },
    {
      "id": "F-32",
      "specPath": "docs/iterations/03-hands/02-step-loop.md",
      "title": "Engine-owned step loop",
      "stack": "typescript",
      "after": []
    },
    {
      "id": "F-33",
      "specPath": "docs/iterations/03-hands/03-executed-checks.md",
      "title": "run_script + deterministic checks that execute",
      "stack": "typescript",
      "after": []
    },
    {
      "id": "F-34",
      "specPath": "docs/iterations/03-hands/04-tree-worktree.md",
      "title": "Tree worktree lifecycle",
      "stack": "typescript",
      "after": ["F-35"],
      "afterReason": "engine.ts file-overlap scheduling edge (resolved Blocker 2), not a behavior dep"
    },
    {
      "id": "F-35",
      "specPath": "docs/iterations/03-hands/05-real-accounting.md",
      "title": "Provider-usage accounting + $15 spend ceiling",
      "stack": "typescript",
      "after": ["F-32"],
      "afterReason": "engine.ts file-overlap scheduling edge (resolved Blocker 2), not a behavior dep"
    },
    {
      "id": "F-36",
      "specPath": "docs/iterations/03-hands/06-live-step-adapter.md",
      "title": "Live step adapter + provider-failure semantics",
      "stack": "typescript",
      "after": []
    },
    {
      "id": "F-37",
      "specPath": "docs/iterations/03-hands/07-assembly.md",
      "title": "Assembly: engine wiring + convergence",
      "stack": "typescript",
      "after": ["F-31", "F-32", "F-33", "F-34", "F-35", "F-36"],
      "afterReason": "honest hard deps — wires the implementations of all six; builds last on the trunk"
    }
  ]
}
```
