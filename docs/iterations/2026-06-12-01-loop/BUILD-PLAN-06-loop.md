---
type: reference
title: "Build plan — The loop closes: self-hosting"
description: Status: Approved · Approved by: Keith (conversation, 2026-06-12) · Iteration goal: the PRD's Desired Outcome, both halves — a Corellia feature ships via a Corel
tags: [iteration, build-plan]
timestamp: 2026-06-12
---
# Build plan — The loop closes: self-hosting

**Status:** Approved · **Approved by:** Keith (conversation, 2026-06-12) · **Iteration goal:** the PRD's Desired Outcome, both halves — a Corellia feature ships via a Corellia-opened PR (AC-2) and the same holds on cats (AC-3), through a hosted front door, with the improvement loop live (AC-21). · **Iteration slug:** `06-loop`

Planned by the orchestrator directly (workflow referenced, not run). Gate-brief
decisions locked 2026-06-12: ADR-025 (PR-opening as brokered tools,
engine-held credentials), ADR-026 (hosted front door — webhook + REPL,
container-ready, Brief frozen per ADR-008's named trigger), ADR-027
(improvement loop v1 — listener mints, the goal routes, standing envelope),
and the PRD §4 amendment (hosted single-operator operation in scope;
multi-tenant stays out). Scope dial: full sweep — the A7/A8 economics levers
and the A9/A10/A11/A12 debts ride along. AC-3 target: cats, with the eyes
retest as an explicit early checkpoint.

## How to use this

1. A human reviews this index + the per-feature "Build plan (approved)"
   sections in each spec and approves it in conversation. The assistant flips
   Status to "Approved" and commits — the human does not edit this file.
2. When ready, run the build workflow: it implements + commits the frozen
   contracts first on `build/06-loop`, builds features dependency-ordered,
   reviews, opens ONE MR, and records each feature's outcome into its spec.
   Every artifact is scoped to the slug, so this iteration can build
   concurrently with others.

## Blockers

- None.

## Frozen contracts (one barrier commit on `build/06-loop`)

| Contract | Source of truth | Frozen signature (file) | Consumers |
|---|---|---|---|
| Brief contract | ADR-026 / ADR-008 | NEW `src/contract/brief.ts`: `CommissionInput` moved verbatim from `src/listener/listener.ts`; `ParkedBrief { intentId: string; question: string; deadline: number }`; `FrontDoorStatus { running: string[]; queued: string[]; parked: ParkedBrief[] }`; `StandingEnvelope { budget: Budget; spendCeilingUsd: number }` | F-62 (daemon/REPL), F-63 (envelope semantics), F-67 (harness) |
| Boundary tool grants | ADR-025 | EXTEND `src/contract/tool.ts` `GRANT_TOOL_MAP`: `push_branch: ['repo.branch']`, `open_pr: ['repo.pr']`; rename `improve-factory` card grants `factory-repo.*` → `repo.*` (`src/library/types/improve.ts` + `tests/library/evolve-grants.test.ts`) | F-61 (implements), F-63, F-67 |
| Event members | ADR-003 / ADR-025 / ADR-027 | EXTEND `src/contract/events.ts`: `branch-pushed { at; goalId; treeId; branch; remote }` · `pr-opened { at; goalId; treeId; branch; url }` · `blocker-routed { at; goalId; blocker; commissionId }`. Exhaustive consumers: `src/eventlog/projections.ts` `traceStats` (~:139), `costSummary` (~:274), `projectKnowledge` (~:403) | F-61, F-63, F-67 (F-65/A11 emits the *existing* `judge-verdict` member — no new member) |
| Provider routing field | ADR-005 / ADR-017 lineage | EXTEND `src/brains/llm.ts` `StepRequest`: `provider?: { order: string[]; allow_fallbacks: boolean }`, plumbed from per-tier bindings | F-64 (introduces), F-67 |
| Read-only learn rule | ADR-016 boundary | BEHAVIOR at `src/engine/engine.ts` `run()` sandbox branch (~:334) and the collect/preserve `finally` (~:390): a learn-kind ROOT goal opens no worktree and registers no write-granting tools; pinned by byte-identical-repo tests | F-65 (introduces), F-67 |

**Barrier compiles green** (standing rule): the barrier is type moves,
additive union members + their three switch arms, inert `GRANT_TOOL_MAP`
entries (no `ToolImpl` registered until F-61), and one optional wire field —
no behavior change; the full suite passes on the barrier commit alone.

## Features & build order

| Feature | Spec | After (scheduling) |
|---|---|---|
| F-61 PR-opening boundary tools | [01](01-pr-boundary.md) | *(barrier)* — trunk (worktree.ts/broker/assembly) |
| F-62 Daemonized front door + frozen Brief | [02](02-front-door.md) | *(barrier)* — worktree, concurrent (listener/daemon area) |
| F-64 Run economics | [04](04-run-economics.md) | F-61 *(trunk serial — engine.ts overlap, not a hard dep)* |
| F-65 Debt sweep | [05](05-debt-sweep.md) | F-64 *(trunk serial — engine.ts overlap, not a hard dep)* |
| F-63 Improvement loop v1 | [03](03-improvement-loop.md) | F-61 (hard: drives push/PR tools); builds after F-62 fold *(listener.ts overlap)* |
| F-66 Container packaging | [06](06-container.md) | F-62 (hard: containerizes the daemon) |
| F-67 Assembly: the closed loop | [07](07-assembly-loop.md) | F-61..F-66 *(hard)* |

Waves: barrier → wave 1: F-61 (trunk) ∥ F-62 (worktree) → trunk serial
F-64 → F-65 (engine.ts overlap) → fold F-62 → wave 2: F-63 (trunk) ∥ F-66
(worktree, docker files — no src/ overlap) → fold F-66 → F-67 closes on the
trunk. Builders sonnet-class, one reviewer opus, per the build workflow's
defaults.

```json
{
  "iterationName": "The loop closes: self-hosting",
  "iterationSlug": "06-loop",
  "buildBranch": "build/06-loop",
  "iterationGoal": "Both halves of the PRD's Desired Outcome: a Corellia feature ships via a Corellia-opened PR (AC-2) and the same holds on cats (AC-3), through a hosted front door, with improvement loop v1 live (AC-21).",
  "blockers": [],
  "frozenContracts": [
    {
      "name": "Brief contract",
      "sourceOfTruth": "ADR-026 / ADR-008",
      "signature": "NEW src/contract/brief.ts: CommissionInput (moved verbatim from src/listener/listener.ts); ParkedBrief { intentId: string; question: string; deadline: number }; FrontDoorStatus { running: string[]; queued: string[]; parked: ParkedBrief[] }; StandingEnvelope { budget: Budget; spendCeilingUsd: number }",
      "extensions": [],
      "exhaustiveConsumers": ["src/listener/listener.ts"]
    },
    {
      "name": "Boundary tool grants",
      "sourceOfTruth": "ADR-025",
      "signature": "EXTEND src/contract/tool.ts GRANT_TOOL_MAP: push_branch: ['repo.branch'], open_pr: ['repo.pr']",
      "extensions": ["F-61: ToolImpls registered in assembly", "barrier: improve-factory grants renamed factory-repo.* -> repo.*"],
      "exhaustiveConsumers": ["src/library/types/improve.ts", "tests/library/evolve-grants.test.ts"]
    },
    {
      "name": "Event members",
      "sourceOfTruth": "ADR-003 / ADR-025 / ADR-027",
      "signature": "EXTEND src/contract/events.ts: branch-pushed { at; goalId; treeId; branch; remote } | pr-opened { at; goalId; treeId; branch; url } | blocker-routed { at; goalId; blocker; commissionId }",
      "extensions": ["F-61 emits branch-pushed/pr-opened", "F-63 emits blocker-routed"],
      "exhaustiveConsumers": ["src/eventlog/projections.ts:traceStats", "src/eventlog/projections.ts:costSummary", "src/eventlog/projections.ts:projectKnowledge"]
    },
    {
      "name": "Provider routing field",
      "sourceOfTruth": "ADR-005 / ADR-017 lineage",
      "signature": "EXTEND src/brains/llm.ts StepRequest: provider?: { order: string[]; allow_fallbacks: boolean }",
      "extensions": ["F-64: plumbed from per-tier bindings"],
      "exhaustiveConsumers": ["src/brains/llm.ts:buildStepRequest"]
    },
    {
      "name": "Read-only learn rule",
      "sourceOfTruth": "ADR-016 boundary",
      "signature": "BEHAVIOR: learn-kind root goals open no worktree and register no write-granting tools (src/engine/engine.ts run() sandbox branch + collect/preserve finally)",
      "extensions": ["F-65: implements and pins byte-identical-repo tests"],
      "exhaustiveConsumers": ["src/engine/engine.ts", "src/engine/assembly.ts"]
    }
  ],
  "features": [
    { "id": "F-61", "specPath": "docs/iterations/06-loop/01-pr-boundary.md", "title": "PR-opening boundary tools", "stack": "typescript", "after": [] },
    { "id": "F-62", "specPath": "docs/iterations/06-loop/02-front-door.md", "title": "Daemonized front door + frozen Brief", "stack": "typescript", "after": [] },
    { "id": "F-63", "specPath": "docs/iterations/06-loop/03-improvement-loop.md", "title": "Improvement loop v1", "stack": "typescript", "after": ["F-61"] },
    { "id": "F-64", "specPath": "docs/iterations/06-loop/04-run-economics.md", "title": "Run economics: provider pinning + duplicate-call refusal", "stack": "typescript", "after": [] },
    { "id": "F-65", "specPath": "docs/iterations/06-loop/05-debt-sweep.md", "title": "Debt sweep: tournament, lint, capture, read-only", "stack": "typescript", "after": [] },
    { "id": "F-66", "specPath": "docs/iterations/06-loop/06-container.md", "title": "Container packaging", "stack": "docker", "after": ["F-62"] },
    { "id": "F-67", "specPath": "docs/iterations/06-loop/07-assembly-loop.md", "title": "Assembly: the closed loop", "stack": "typescript", "after": ["F-61", "F-62", "F-63", "F-64", "F-65", "F-66"] }
  ]
}
```

## Standing decisions carried forward

Zero runtime dependencies (`node:http` for ingress, global `fetch` for
GitHub REST). Process-clean code and test labels — now also a deterministic
push-time gate (ADR-025). Live demos are operator-run evidence, never CI
gates. Prompt-content tests assert against the real skill artifacts, never
synthetic stand-ins (the iteration-05 lesson). The factory never self-merges
— structural: no merge tool exists.

## Reconciliation self-review (five points)

1. **Cross-feature contradictions:** F-61's `open_pr` idempotence reads
   prior `pr-opened` events — F-67's faked GitHub transport must append the
   same members (named in both specs). The envelope type lives in the Brief
   contract (barrier); F-62 passes it through as daemon config, F-63 owns
   its semantics — one owner each, no overlap.
2. **Decision propagation:** the `factory-repo.*` → `repo.*` grant rename is
   a barrier item with both consumers named (`improve.ts`, evolve-grants
   tests); ADR-025 records the rationale.
3. **Orphaned work:** F-65/A11 emits the *existing* `judge-verdict` member at
   the integration site — consumed by the existing `goldenCandidates`
   projection under ADR-024's filter; nothing new is left unconsumed.
4. **Barrier compiles standalone:** type move + re-export, additive union
   members + three switch arms, inert grant-map entries (no ToolImpl until
   F-61), one optional wire field. No behavior change; suite green.
5. **Assembly ownership:** F-67 owns wiring, the convergence suite, and all
   live harnesses. Named soft spot: the strange loop (corellia building
   corellia) has no scripted analogue — live-only evidence, operator
   watching; recorded as such in F-67's risks rather than papered over.

## The live evidence (the iteration's headline)

Order is deliberate: F-64's economics land before any deliver run; the
eyes-on-cats retest (target 5/5; honest record either way) is the early
checkpoint before the expensive runs; then AC-2 — a real Corellia feature
through the front door to a green, mergeable PR — and AC-3 on cats (AC-1
verbatim: diff + proof + `learned`, unmerged). Improvement loop evidence:
the scripted path is gating; a live blocker→factory-PR pass is recorded if
one occurs. PR URLs, costs, and cache-hit share go in the build notes.
