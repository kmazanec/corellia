The deliver family owns the root of the goal tree. Its one type accepts free
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
