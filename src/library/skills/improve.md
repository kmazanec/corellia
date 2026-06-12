The improve family's shared principle is **generalize, don't cache**. Both
members do abstraction work: take the specific recurrence or failure and propose
the most general artifact that covers it. The temptation is to encode the
instance — the exact shape that recurred, the exact blocker that appeared — but
a cached instance only saves the factory from repeating the same mistake; a
generalized artifact immunizes it against the whole class.

Before proposing any artifact, ask: what is the broadest true claim this
instance supports? A split memo scoped to one goal's type is almost always too
narrow — the memo earns existence when the same structural challenge recurs
across types. A harness fix scoped to one failure's symptoms is almost always
too shallow — the fix earns a PR when the underlying gap is in the harness
itself, not in the goal's spec.

Point at sources, never snapshot them. Every artifact produced by an improve-
family goal cites the event-log entries, blocker reports, or goal IDs that
justify it. The artifact is the distillation; the sources are the evidence.
Snapshotting source content into the artifact defeats the purpose — the factory
already has the events; what it needs is the abstracted lesson.

The improvement loop never touches a product repo. Both types operate on the
factory's own substrate: the pattern store and the factory repo. Work that
would change a product repo re-routes to `promote-memory` (for project lessons)
or back to the standard make/judge/learn loop (for product changes).

## propose-pattern

Identify the recurrence cluster in the event log that justifies this goal. A
cluster is a set of goals sharing a structural shape — same type, similar spec
key signatures, similar runtime splits — that succeeded or failed in a
consistent pattern. A single outlier is not a cluster; a cluster needs at least
three corroborating instances before a memo is worth writing.

Draft the split memo at the most general shape that accurately covers the
cluster. Too narrow: the shape keys on goal IDs. Too broad: the shape covers
goals that have split differently in practice. The right level of generality is
the coarsest shape that preserves the signal.

Write the memo as `provisional` only. The pattern store's promote path to
`trusted` requires the human signoff — this type never calls it. Surface the
cluster's source event-log entries as the memo's evidence citations so the
human reviewer can verify the generalization before signing off.

## improve-factory

### Reading the event-log pointer

This commission carries an `eventLogPointer` (the originating run's goalId) and
a `blockers` array in its spec. **Read the event log before anything else**:
query `store.list({ goalId: eventLogPointer })` to retrieve the full event
sequence for the originating run. The blocker strings are the reported symptoms;
the event log is the causal evidence. A blocker you cannot trace to a specific
event sequence is a symptom you cannot fix responsibly.

Scan for:
- `decided` events: what did the brain decide, and why did the decision produce
  a blocker rather than a useful output?
- `step` events: which tool calls preceded the blocker? Were tools refusing,
  returning wrong data, or missing entirely?
- `judge-verdict` events: did the eval reject output for reasons the harness
  could have prevented?
- `tool-call` events with `outcome: 'refused'`: are there missing grants, or
  wrong tool invocations that the harness should have guided away from?

A complete event-log read takes one `event-log.read` tool call. Do not skip it.

### Generality routing — the most important decision in this goal

After reading the event log, make the generality judgment **before drafting
anything**. This is a binary decision with two mutually exclusive routes:

**Route A — repo-specific lesson → memory write (no PR)**

A lesson is repo-specific when:
- The blocker is caused by something true only for this project (its
  conventions, its tech stack, its team decisions).
- Fixing the factory would break it for other repos.
- The lesson is "always do X for this repo" — not "always do X for every repo
  of this type."

For repo-specific lessons: write the lesson to project memory via
`promote-memory`. Do NOT open a branch or PR. Route the goal to `done` once the
memory write is recorded in the event log as `memory-written`. Return a report
stating the lesson and the memory pointer.

**Route B — repo-agnostic fix → branch + PR on the factory repo**

A lesson is repo-agnostic when:
- The same failure would occur on any repo running this goal type.
- The root cause is in the harness itself: a prompt gap, a skill gap, a missing
  tool, a wrong eval, a broken script, or a missing goal-type.
- Fixing it would benefit every factory user, not just this project.

For repo-agnostic fixes: proceed to the PR discipline section below.

**When uncertain about generality**: if the evidence is ambiguous (some signals
point to repo-specific, others to general), escalate to a higher model tier
(the tier ladder on this card allows escalation). Do not guess. An
incorrectly-routed PR contaminates the factory for every user; an
incorrectly-routed memory write is recoverable.

**This decision is enforced by test** — harness tests assert that repo-specific
signals route to memory writes and repo-agnostic signals route to PRs. If you
cannot explain which route you chose and why, you have not made the decision.

### PR discipline — what may change, what may not

**The architecture is locked.** Improvement PRs may:
- Refine or extend prompts and harness instructions.
- Add to or improve skills (`.md` files in `src/library/skills/`).
- Add or fix scripts and eval sets.
- Add **new** goal-type definitions within the existing four locked kinds
  (`make`, `learn`, `judge`, `evolve`).
- Add or fix TypeScript type definitions in `src/contract/` and `src/library/`.

Improvement PRs may NOT:
- Change the recursive architecture (listener, engine, broker, event-log
  contract, projection machinery).
- Remove or restructure goal kinds.
- Grant `merge-to-main`, `self-approval`, or any grant that bypasses the
  human-review gate.
- Grant `push_branch` or `open_pr` to a `make`-kind type (only `evolve`-kind
  `improve-factory` holds these grants — structural, not policed by runtime).
- Add untyped human exits (every `onTimeout` must be `deny | park | bounce`).

These constraints are enforced by the factory repo's CI constitution check.
Attempting a prohibited change will fail CI. If you believe a structural change
is genuinely needed, your job is to file a clearly-articulated ADR in the PR
body for the factory maintainer — **not** to make the structural change in the PR.

A PR that violates PR discipline is worse than no PR: it contaminates the
reviewable surface for the maintainer. Draft narrowly; explain generously.

### Drafting the minimal factory-repo change

The minimal PR is the one that closes the gap without introducing new gaps.
Order of preference (cheapest fix wins):
1. A skill addition or refinement (`src/library/skills/improve.md` or a
   sibling file). Skill text is the harness's natural language instruction
   layer — most harness gaps are skill gaps.
2. A prompt or goal-type card update (`src/library/types/*.ts`). Change the
   harness spec or tier ladder only when the skill cannot carry the fix.
3. A new type definition (a new `GoalTypeDef` entry). Only when the gap is
   "this operation has no type and keeps being misrouted to an existing one."
4. A script or eval-set addition. Only when the gap is "this check cannot be
   expressed as a type card or skill."

**The PR must include the eval set change that would have caught the gap** — a
fix without a regression test is a fix that regresses silently. The eval set
is the proof that the fix is complete.

### Opening the PR via push_branch and open_pr

Use `push_branch` first to push the branch. Then use `open_pr` to open the PR.

`open_pr` is idempotent — a second call for the same tree refuses and returns
the existing URL. Call it once; do not retry if the first call succeeded.

The PR body must carry:
- **What changed**: one paragraph stating the harness gap, the fix, and why it
  is the minimal change.
- **Why it is repo-agnostic**: the evidence from the event log that the failure
  would occur on any repo running this type.
- **Proof**: the eval set entry or test that would have caught the gap, now
  included in the PR.
- **Event-log evidence**: the goalId(s) and event types that justify the fix.
  Cite the originatingGoalId from the spec.
- **`learned` note**: two to four sentences of what building this taught, in
  plain prose. This is the boundary handoff contract field.

### Runaway-loop guard

This goal type must NEVER report blockers in its own output that re-trigger
the improvement-commission mint path. Specifically:
- Do not set `blockers` in the emitted report unless the goal genuinely could
  not proceed (e.g., `push_branch` failed and the operator must fix the token).
- Operational failures (missing GITHUB_TOKEN, no network) go into `blockers`
  so the operator sees them — but they do not indicate a harness gap.
- Architectural disagreements or uncertainty about the fix belong in the PR body
  for the maintainer, not in `blockers`.

The listener's runaway-loop guard (checked by test) ensures that an improvement
run that does emit blockers does NOT re-mint a second improvement commission.
But do not rely on that guard — emit blockers only when there is a genuine
operational barrier that the operator must resolve.

### Completing the goal

Route to `done` only when:
- **Route A (memory write)**: the `memory-written` event is in the event log.
- **Route B (PR)**: the PR exists and is reviewable (the `pr-opened` event is
  in the event log). The outcome of the review is outside this goal's scope.

Do not mark `done` prematurely. A half-drafted PR with no eval-set change is
not a complete improvement; it is a proposal that will be rejected by the
maintainer and require a second improvement run to fix.
