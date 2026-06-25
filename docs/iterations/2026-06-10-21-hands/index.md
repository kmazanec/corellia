---
type: iteration
title: "Iteration 03 — Hands: agentic leaf execution"
description: A live sonnet-class implement leaf builds a small module test-first in a tree worktree, with scope-enforced tools and real provider-reported token/dollar accounting.
tags: [iteration, hands, tool-broker, step-loop, worktree, accounting, spend-ceiling]
timestamp: 2026-06-10
status: shipped
---

# Iteration 03 — Hands: agentic leaf execution

**Date:** 2026-06-10 · **Status:** Shipped

This iteration gave the factory hands: an engine-owned step loop drives a brain
through a scope-enforced tool broker (read/write/list/search/run_script) inside a
per-tree git worktree. Declared test scripts execute (red then green), a
scope-violating write is refused and visible in the transcript, deterministic
checks can execute against the sandbox, and run reports print real token and
dollar totals parsed from provider-reported usage, with a $15 per-tree spend
ceiling.

## Features
- [01-tool-broker-core](01-tool-broker-core.md) — Tool broker + core file tools (read/write/list/search), grant-gated.
- [02-step-loop](02-step-loop.md) — Engine-owned step loop driving the brain's `step()` protocol.
- [03-executed-checks](03-executed-checks.md) — `run_script` tool + deterministic checks that execute against the sandbox.
- [04-tree-worktree](04-tree-worktree.md) — Tree worktree lifecycle (create / collect / preserve).
- [05-real-accounting](05-real-accounting.md) — Provider-usage accounting + the $15 per-tree spend ceiling.
- [06-live-step-adapter](06-live-step-adapter.md) — Live step adapter (OpenAI tool-calling) + provider-failure semantics.
- [07-assembly](07-assembly.md) — Assembly: engine wiring, CheckContext supply, convergence checks.

## ADRs produced
ADR-014 (tool interface / broker), ADR-015 (engine-owned step loop), ADR-016
(worktree-per-tree bare exec), ADR-017 (provider-usage accounting), ADR-018.

## Build plan
[BUILD-PLAN-03-hands](BUILD-PLAN-03-hands.md)

## Build notes (folded from prototype-build-notes.md)

Built by the orchestrator running the factory's own process directly (no
workflow harness, per the operator): barrier (opus) → wave-1 fan-out (three
sonnet builders in isolated worktrees + the serial trunk chain) → per-feature
opus judges with prescriptions → sonnet repair rung → fold-back by
cherry-pick (one trivial conflict, one readUsage dedupe) → assembly (opus) →
final judge → process-clean sweep → live convergence run. 308 → 555 tests.

### What was added

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

### Decisions made at orchestration (with why)

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

### Review-rung results (the control loop, run for real)

Five opus judges, 20 findings total, every gating finding repaired by a
sonnet fixer within the iteration: F-32 FAILED first judgment (dead
transcript-tail carrier, mid-step over-spend, debit-seam doc contradiction) —
repaired and re-verified; F-35's ceiling had serial-overshoot holes at scan/
repair/step paths — closed and pinned; F-31's audit log mislabeled scope
refusals as 'ran' — broker now owns the write check; secrets-into-child-env
caught at review — scrubbed env with credential-suffix sweep, PATH-survival
pinned.

### Live convergence run (the done-when)

First try, sonnet-class model: red→green real script execution (exit 1 →
exit 0), 10 brokered tool calls (list/read/write/run), worktree created and
collected with 1 commit, **$0.0658** measured from provider-reported usage.
PRD risk #1 (can lower-tier models drive the loop) — first evidence: yes.
The scope-violation refusal half of the done-when is pinned by the scripted
convergence suite (the live model simply never violated scope).

### Known debts (recorded, not hidden)

- outputRef on script-ran events is a correlation key; full-output
  persistence lands with iteration-4 proof-artifact work.
- `fs.write_test_dirs` unmapped in v1 (characterize's write path).
- Engine.run is single-tree-per-instance (documented in code).
- Symlink containment is lexical, per ADR-016's trust posture.
