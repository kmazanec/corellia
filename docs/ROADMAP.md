# Roadmap — Corellia

**Status:** agreed · **Updated:** 2026-06-11
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

Iteration 3 added **hands**: tool-using leaves in sandboxed worktrees,
executing checks, real usage accounting with a hard ceiling, and a live
red→green convergence run at $0.07 (555 tests). Measured against the PRD's
success bar: **the factory thinks and acts, but doesn't yet have eyes** —
it knows nothing about codebases it didn't create.

## The iteration arc

Each iteration is a shippable state; each unblocks the next. Iterations get
their gate brief + specs just-in-time, when they're next (the JIT rule
applied to planning itself).

### Iteration 3 — Hands: agentic leaf execution *(shipped — PR #3)*

Leaves become real tool-using loops in sandboxed worktrees. Decisions
locked in ADR-014–018.

*Done:* the live convergence run passed first try — a sonnet-class leaf
built a module test-first in a tree worktree, the declared test ran red then
green, and the report printed real totals ($0.0658). Scope-violation
refusals are pinned by the scripted convergence suite. Outcomes + debts in
the build notes.

### Iteration 4 — Eyes: brownfield comprehension *(built — PR open)*

Decisions locked in ADR-019/020/021 (event-projected artifacts with
SHA-anchored freshness; hybrid impact graph — deterministic scanner +
semantic dives; coverage as a policy table). Four categories ship:
architecture, stack, conventions, test-scaffold. Specs in
[iterations/04-eyes/](./iterations/04-eyes/) (F-41..F-46, assembly-owned
integration pre-applied).

*Done:* scripted convergence green (gate→maps-as-deps, impact-before-write,
drift→refresh, phantom-pointer caught). Live mapping PARTIAL: every category
validated live at least once on corellia, never 5/5 in one run; cats run
blocked cleanly with byte-identical teardown (the hygiene half proven).
The reliability gap is named harness debt carried to iteration 5
(structured-output emission). Evidence + the cross-iteration transcript bug
it exposed: build notes.

### Iteration 5 — Taste: the library at full strength *(built — PR open)*

Decisions locked in ADR-022/023/024 (markdown family skill files;
explore-then-emit structured emission; golden capture as events); full 19
types with evolve thin; tier models re-bound to cost-optimized picks
(ADR-005 amendment). Specs in [iterations/05-taste/](./iterations/05-taste/)
(F-51..F-57).

*Done:* scripted convergence green (prd→arch→contract→implement with real
two-phase emit, terraced scan, intent dial, skills in every harness). Live
retest honest result: best 4/5 at ~$2/run (baseline: 3/5 at $2-6); four
real machinery bugs found and fixed by the runs; the 5/5 residual is
exploration discipline at cheap tiers — named debt with named levers in the
build notes.

### Iteration 6 — The loop closes: self-hosting

Decisions locked in ADR-025/026/027 (PR-opening as brokered tools with
engine-held credentials; hosted front door — webhook ingress + dev REPL,
container-ready, Brief contract frozen per ADR-008's named trigger;
improvement loop v1 — listener mints, the improvement goal routes, under a
standing envelope) plus the PRD §4 amendment (hosted single-operator
operation in scope; multi-tenant stays out). Seven features ship: the
PR-opening boundary (branch → push → PR with proof artifacts + `learned`);
the daemonized front door; improvement loop v1 (blockers → factory-repo
PRs, AC-21); run economics (provider pinning for cache affinity +
duplicate-call refusal — the carried A7/A8 levers); the debt sweep (leaf
tournament, dangerous-grant lint, integration-judge capture, read-only
learn mode); container packaging (Dockerfile + compose; deployment
deferred); and assembly — the factory builds a real feature on its own
repo (AC-2) and on cats (AC-3), with eyes-on-cats retested as an explicit
early checkpoint. Specs in [iterations/06-loop/](./iterations/06-loop/)
(F-61..F-67).

*Done when:* the PRD's Desired Outcome — both halves.

### Iteration 7 — Layered conventions: the factory honours how each repo wants its code

Decision locked in ADR-028 (layered conventions). The factory writes code into
repos — its own and foreign — but cannot yet honour the conventions that govern
how that code should read. Conventions resolve in three layers: global factory
taste in the skills plus a new shared preamble every code-writing family
inherits; repo-specific, harness-agnostic conventions read from the target
repo's `AGENTS.md`/`CLAUDE.md` (the factory acting as any coding harness would);
and on conflict, the host repo wins. Two features: the shared skill preamble
(global layer; "comments are timeless" moves into it, read by the factory at
runtime rather than only by an outer harness), and the host-conventions reader
(locate/parse/slice the host file, inject the relevant slice as data-to-weigh
with host-overrides-global precedence). Specs in
[iterations/07-conventions/](./iterations/07-conventions/) (F-68, F-69).

A sibling structural thread — **comprehension must recurse** (`map-repo`/
`deep-dive-region` are wrongly `leafOnly`, recorded in the build notes from the
AC-2 eyes-on-cats result) — is a candidate to ride this iteration or stand as its
own; that scope call is open.

*Done when:* a code-writing goal's context carries the factory's global
conventions and the relevant slice of the host repo's convention file, with host
overriding global on conflict.

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
