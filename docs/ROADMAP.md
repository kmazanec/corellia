# Roadmap — Corellia

**Status:** agreed · **Source:** [DESIGN.md](../DESIGN.md) · [GOAL-TYPES.md](../GOAL-TYPES.md) ·
[prototype-build-notes.md](./prototype-build-notes.md)

## Where the prototype stands

Iterations 1–2 built and live-verified the **coordination machinery**: the
recursive engine (decide / split / block, dependency scheduling, contract
children first), the three evals with the repair → escalate → block control
loop, four-dimension subdivided budgets, the event log with memory as a
projection, the flywheel (provisional memos, trusted-walk, lens-diverse
terraced scan), risk gates with the constitution enforced at construction,
the listener with scope-disjoint admission and park/TTL, a Postgres
substrate, and a provider-agnostic live brain — 300+ tests, and a real
end-to-end run against live models.

Measured against the design's purpose — *ship real software on real repos* —
the honest gap: **the factory thinks, but it doesn't yet have hands or
eyes.** Leaves emit artifacts as one-shot text; nothing executes tests or
uses a tool, and the factory knows nothing about codebases it didn't create.

## The iteration arc

Each iteration is a shippable state; each unblocks the next.

### Iteration 3 — Hands: agentic leaf execution

Leaf goals (`implement`, `characterize`, `freeze-contract`) become real
tool-using loops in sandboxed worktrees.

- A **tool broker**: leaves call granted tools only (fs read/write within
  scope, run-impacted-tests, search); ungranted calls are refused — "the
  contract is the capability" becomes true at runtime.
- The `toolCalls` budget debited per real call; the batching rhythm
  (write → run once → fix all → run once) enforced by budget, not prompt
  hope.
- Deterministic checks that **execute**: compile the artifact, run its
  tests — replacing string inspection.
- Brain tool-calling support in `LlmBrain` (or an agentic leaf harness
  looping tool calls until the chunk is done).

*Done when:* an `implement` leaf builds a small module test-first in a
sandbox, its checks run for real, and a scope-violating tool call is refused
and surfaced.

### Iteration 4 — Eyes: brownfield comprehension

The learn kind, made real, so the factory can work on code it didn't write.

- `map-repo` (per-category) and `deep-dive-region` goal types producing
  SHA-stamped, self-validating knowledge artifacts (pointers, not bodies).
- The typed retrieval API as granted tools: `find_symbol`,
  `find_exemplar`, `impact`, `conventions_for`, `stack_versions`.
- Verify-on-read: stale facts trigger a fresh dive, never a silent wrong
  answer. JIT only — no bootstrap ceremony.
- The split gate's coverage check becomes mechanical (spawn comprehension
  children for missing knowledge).

*Done when:* pointed at an existing repo (natural target: corellia itself),
the factory maps what it needs, splits sensibly, and a leaf consults
`impact()` before touching code.

### Iteration 5 — Taste: the library at full strength

- Expand the library 8 → 19 types (write-prd, design-arch,
  research-external, investigate, the remaining judges, the evolve family).
- **Per-type/family skill bundles** as harness prompts — the seed content
  GOAL-TYPES.md names (interview structure, ADR format, six-dimension
  rubric, vertical-slice discipline). Generic prompts are the current
  quality ceiling; this removes it.
- The intent dial wired through judges (spike/characterization bars).
- Golden-set capture from live runs — judge calibration data starts
  accruing.

*Done when:* a commissioned intent flows research → PRD → architecture →
implementation with type-appropriate harnesses, and judges cite their
rubrics.

### Iteration 6 — The loop closes: self-hosting

- The factory builds a real feature **on its own repo**, end to end,
  output: a PR a human reviews. The integration test of everything above.
- Improvement loop v1: blocker reports → improvement goals → a
  factory-repo PR, human-reviewed; generalize-don't-cache; the
  architecture stays locked.
- Daemonized listener: a persistent front door (start with
  GitHub-issues-as-intents or a watched directory).

*Done when:* a corellia feature ships via a corellia-opened PR, and a
blocker report from that run lands as a reviewable improvement PR.

## Ride-along items (small, any iteration)

- Pattern-trust ceremony CLI (`patterns list / promote`) — the human
  signoff surface for the flywheel.
- Risk-sensitivity tuning (segment-boundary matching; the
  `author.md`-matches-`auth` sharp edge).
- pgvector / sqlite-vec relevance retrieval for memory (replacing
  substring match).
- Decision-brief notification surface (terminal → Slack/issue comment).
- Replay harness over the event log (golden-set replay, point-in-time
  memory reconstruction).
- Decide-phase budget metering (the scan's k candidates are currently
  unmetered — documented gap).

## Why this order

Hands before eyes: comprehension artifacts are *consumed by tools*, so the
tool layer comes first. Both before library expansion: per-type skills are
only testable against real execution. Self-hosting last because it is not a
feature — it is the integration test of the whole design, and the strange
loop's first closure.

## Sources of truth

Architecture: DESIGN.md (locked; changes are human design decisions).
Type library: GOAL-TYPES.md. Build history + decisions: prototype-build-notes.md.
This file: the arc and what "done" means per iteration — updated as
iterations ship.
