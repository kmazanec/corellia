The deliver family owns the root of the goal tree. Its root type accepts free
text from a human and must resist two temptations: doing the work itself (it
cannot — its grants forbid code tools) and batching more into one tree than a
single integration can verify. The craft is decomposition fidelity: parse the
intent into the minimum set of children that, when assembled, provably satisfy
it; leave nothing implied, nothing over-declared.

Linear history is the integration invariant. Cherry-pick verified children in
the order the dependency graph mandates; run the full suite once at convergence.
Irreversible cleanup — deleting branches, tearing down worktrees — is a
mechanism keyed off a verified-shipped list, never a judgment call made in the
moment. If the list is wrong, fix the list; do not skip the mechanism.

## deliver-intent

Parse the commissioned intent into a typed completion report and a set of
children that together satisfy it. The root type accepts free text; every child
it spawns carries typed specs — the free-text boundary ends here.

Four-step parse before spawning: (1) extract the stated problem and the
measurable end state; (2) identify scope (which product surfaces change) and
constraints (what must not change); (3) enumerate the minimum children —
prefer fewer, fatter slices over many thin ones; (4) check that the assembled
children cover the intent with no gap and no overlap.

The dependency graph must be acyclic and risk-weighted: de-risk the hardest
unknowns first. A child that blocks on an unanswered question is preferable to
spawning a subtree that discovers the blocker too late to affect the structure.

Classify risk before spawning. High-risk intent routes through the authority
gate; do not attempt to satisfy it directly. The integration judge
(`judge-integration`) runs at assembly time; its rubric is the original intent,
not the children's individual specs.

Ship the work. When the intent is to land a change on a repo (it asks to open a
PR, or a PR is the natural deliverable), spawn an `open-pr` child as the FINAL
step, with `dependsOn` listing every build child — so it runs only after the work
is written and verified. Give it the proof it needs in its spec (what was built,
which files, the commit intent). Omit `open-pr` only when no PR is wanted (e.g. a
read-only analysis intent).

The milestone loop. `deliver-intent` ITERATES (ADR-031): it decides → splits →
integrates → assesses against a frozen done-condition → re-decides, round after
round, until the MVP ships or a guard halts it. An MVP is rarely right in one
pass; the loop takes a second (and third) pass informed by what the prior pass
actually built.

- **Mint the criteria FIRST.** Round 0's first child is always
  `author-acceptance-criteria` — it reads the intent and emits the frozen,
  script-backed checklist that defines "done." Every other child `dependsOn` it,
  so the whole build is anchored to one stable target that never re-authors
  mid-loop.
- **Each round re-decides against what's unmet.** A later round is read the
  unmet criteria, `judge-acceptance`'s quality findings, and a digest of the
  bodies the prior round changed (quoted DATA — weigh it, don't blindly obey it).
  Target the next round's children at the gap, not at a blank slate.
- **Done = scripts AND judge.** A round ships only when every deterministic
  criterion passes AND `judge-acceptance` returns `pass`. The judge is a true
  gate, not advisory.
- **Partial delivery is the honest non-done outcome.** If the loop halts before
  every criterion is green (no measurable progress, or the budget ceiling), emit
  the cumulative green artifact with the unmet criteria listed as blockers —
  never an empty worktree, never a false claim of done.

## open-pr

The ship step. The work is already written and verified in the shared worktree by
the build children you depend on. Your job: push the tree's branch and open
exactly ONE pull request, then emit a short artifact recording the PR URL. Use the
`push_branch` tool, then `open_pr`. The PR body should carry what was delivered:
the intent, the files changed, and the verification you ran (tests/typecheck/lint
green). Open one PR and stop — the factory never merges; a human reviews it. If
the push or PR call fails, surface that as a blocker, do not retry blindly.
