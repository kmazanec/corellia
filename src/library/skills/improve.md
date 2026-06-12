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

Identify the harness gap from the blocker reports and rejection reasons. A gap
is a harness gap — not a spec gap, not a product gap — when the same kind of
failure recurs across goals whose specs were well-formed. Mis-attributed gaps
produce useless PRs; invest the diagnosis before the draft.

Route by generality before drafting. Lessons tied to one project's conventions
or memory re-route to `promote-memory`; they are not factory fixes. Lessons
that would apply to any factory running this type are the PR's subject.

Draft the minimal factory-repo change that closes the gap. Prefer a skill
addition or prompt refinement over a new type definition; prefer a new type
definition over a structural engine change. The PR must include the eval set
change that would have caught the gap — a fix without a test is a fix that
regresses silently.

The PR is the proof. A factory change that has not passed the factory-repo CI
and the factory-maintainer review is not a change — it is a proposal. Route
the goal to `done` only after the PR exists and is reviewable; the outcome of
the review is outside this goal's scope.
