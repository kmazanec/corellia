# Roadmap — Corellia

**Status:** agreed · **Updated:** 2026-06-10
**Sources:** [PRD.md](./PRD.md) (WHAT/WHY + acceptance criteria) ·
[ARCHITECTURE.md](./ARCHITECTURE.md) + [adrs/](./adrs/) (implementation
decisions) · [DESIGN.md](../DESIGN.md) (locked domain architecture) ·
[GOAL-TYPES.md](../GOAL-TYPES.md) (type library) ·
[prototype-build-notes.md](./prototype-build-notes.md) (build history)

## Where the prototype stands

Iterations 1–2 built and live-verified the **coordination machinery**: the
recursive engine, the three evals with the repair → escalate → block control
loop, subdivided budgets, the event log with memory as a projection, the
flywheel, risk gates, the listener, a Postgres substrate, and a
provider-agnostic live brain — 300+ tests and a real end-to-end run.

Measured against the PRD's success bar (a self-hosted PR **and** a
foreign-repo PR): **the factory thinks, but doesn't yet have hands or
eyes.** Nothing executes a test or uses a tool; the factory knows nothing
about codebases it didn't create.

## The iteration arc

Each iteration is a shippable state; each unblocks the next. Iteration 3 is
fully specified (specs in [iterations/03-hands/](./iterations/03-hands/));
4–6 stay arc-level deliberately — their right decomposition depends on what
the prior iteration teaches (the JIT rule applied to planning itself). Each
gets its gate brief + specs when it's next.

### Iteration 3 — Hands: agentic leaf execution *(specified, ready to plan)*

Leaves become real tool-using loops in sandboxed worktrees. Decisions
locked in ADR-014–018.

*Done when:* the convergence check in
[06-live-step-adapter.md](./iterations/03-hands/06-live-step-adapter.md)
passes — a live sonnet-class `implement` leaf builds a small module
test-first in a tree worktree, its declared test script actually runs red
then green, a scope-violating call is refused and visible, and the run
report prints real token + dollar totals (AC-7/8/11/12 observed live).

### Iteration 4 — Eyes: brownfield comprehension *(specified, awaiting plan approval)*

Decisions locked in ADR-019/020/021 (event-projected artifacts with
SHA-anchored freshness; hybrid impact graph — deterministic scanner +
semantic dives; coverage as a policy table). Four categories ship:
architecture, stack, conventions, test-scaffold. Specs in
[iterations/04-eyes/](./iterations/04-eyes/) (F-41..F-46, assembly-owned
integration pre-applied).

*Done when:* the scripted convergence passes (gate spawns maps as deps; a
leaf consults `impact()` through the broker before its first write; SHA
drift triggers validation+refresh), `live:eyes` maps corellia itself with
self-validating artifacts, and one operator-named foreign repo maps
read-only (early AC-3 evidence).

### Iteration 5 — Taste: the library at full strength

8 → 19 types; per-type/family skill bundles as harness content (the current
generic-prompt quality ceiling removed); the intent dial wired through
judges; golden-set capture from live runs. **Gate-brief candidates:**
skill-bundle format; golden-set schema.

*Done when:* a commissioned intent flows research → PRD → architecture →
implementation with type-appropriate harnesses, and judges cite their
rubrics.

### Iteration 6 — The loop closes: self-hosting

The PR-opening boundary (branch → push → PR with proof artifacts +
`learned`); the factory builds a real feature on its own repo (PRD AC-2)
and on a foreign repo (AC-3); improvement loop v1 (blockers → factory-repo
PRs); daemonized listener front door.

*Done when:* the PRD's Desired Outcome — both halves.

## Features index — iteration 3

| ID | Feature | Spec | Before → After (one line) | Depends on (hard) |
|----|---------|------|---------------------------|--------------------|
| F-31 | Tool broker + core tools | [01](./iterations/03-hands/01-tool-broker-core.md) | grants inert → enforced at one mediating point | — |
| F-32 | Engine-owned step loop | [02](./iterations/03-hands/02-step-loop.md) | one-shot text leaves → bounded think/act/observe loop | — |
| F-33 | run_script + executed checks | [03](./iterations/03-hands/03-executed-checks.md) | checks inspect strings → checks gate on real exit status | — |
| F-34 | Tree worktree lifecycle | [04](./iterations/03-hands/04-tree-worktree.md) | in-memory artifacts → isolated branch with real diffs | — |
| F-35 | Usage accounting + ceiling | [05](./iterations/03-hands/05-real-accounting.md) | chars/4 guess → provider-reported usage, $15 halt | — |
| F-36 | Live step adapter | [06](./iterations/03-hands/06-live-step-adapter.md) | one-shot completions → live model drives the loop | — |
| F-37 | Assembly: engine wiring + convergence | [07](./iterations/03-hands/07-assembly.md) | six unwired modules → the composed engine + the done-when checks | F-31..F-36 (hard) |

**One hard node** — F-31..F-36 build against the frozen barrier with zero
hard edges among them; F-37 (assembly) genuinely consumes all six
implementations and builds last. **Scheduling (per the approved plan):**
F-31/F-33/F-36 fan out in worktrees; F-32 → F-35 → F-34 serialize on the
trunk (`engine.ts` overlap); F-37 closes on the trunk after fold-back.

## Cross-cutting contracts — iteration 3's barrier

What the plan stage freezes (concrete signatures), consistent with the cited
ADRs, before any feature work:

| Contract | Source of truth | Introduced by | Consumed by |
|----------|-----------------|---------------|-------------|
| Tool shapes (`ToolDef`/`ToolCall`/`ToolResult`) + `ToolBroker` | ADR-014 | barrier | F-31..F-34, F-36 |
| `Brain.step` + step/transcript protocol | ADR-015 | barrier | F-32, F-36 |
| Usage fields on brain-call events; tool/retry/lifecycle event members | ADR-017, ADR-018, ADR-003 | barrier | F-31, F-35, F-36 |
| Tree spend ceiling on the root contract | ADR-017 | barrier | F-35 |
| Sandbox-root binding of the broker | ADR-016, ADR-014 | barrier | F-31, F-34 |

## Risk-weighted ordering

1. **Can lower-power models drive the loop?** (PRD risk #1, existential for
   the whole tier thesis.) De-risked by iteration 3's convergence check —
   the earliest possible live evidence. If sonnet-class fails it, the
   fallback is tier policy (default leaves up a tier), not architecture.
2. **Executing model-influenced commands safely** (PRD risk #3) — contained
   by ADR-016's scripts-by-name posture; the riskiest code path lands while
   the operator is watching closest.
3. **Comprehension quality on foreign repos** (PRD risk #5) — deliberately
   *after* hands: comprehension artifacts are consumed by tools, so the tool
   layer must exist to validate them.
4. **Judge calibration cold start** (PRD risk #2) — golden-set capture in
   iteration 5; the operator's PR reviews are the exogenous ground truth
   until then.

## Ride-along items (small, any iteration)

Pattern-trust ceremony CLI · risk-sensitivity segment matching ·
pgvector/relevance retrieval · decision-brief notification surface · replay
harness over the event log. (Decide-phase metering graduated into F-35.)

## Why this order

Hands before eyes: comprehension artifacts are consumed by tools. Both
before library expansion: per-type skills are only testable against real
execution. Self-hosting last: it is the integration test of the whole
design, and the strange loop's first closure.

## Non-goals and deferred

Mirror the PRD §4 (out of scope: team surfaces, hosted operation,
dashboards, factory-factory, dangerous grants; deferred: per-language
adapters, signal-minted roots, semantic retrieval, full replay tooling).

## Sources of truth

PRD: WHAT/WHY + acceptance criteria. DESIGN.md: locked domain architecture.
ARCHITECTURE.md + ADRs: implementation decisions (contracts cite ADRs, never
restate them). GOAL-TYPES.md: the type library. This file: the arc, the
features index, and what "done" means per iteration — updated as iterations
ship. STATUS.md: the rolling re-entry point.
