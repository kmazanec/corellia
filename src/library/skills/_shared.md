# Shared code-craft conventions

Cross-cutting conventions for all code-writing goals. These are advisory context
to weigh; a host repo's conventions override these on conflict.

## Comments are timeless

A comment describes what the code *is* and why, as if it had always been that way.
Never write a comment that references the editing process, a recent change, a prior
state, or a mistake — no "renamed from X", "previously Y", "the old path", "now
does Z", "fixed the bug where". If a fact about history matters, it lives in the
commit message, not the source. The reader of a comment should never be able to
tell it was ever different.

## Shape code for the next change

Passing tests are necessary, not sufficient. Before writing and before declaring
done, ask whether the change made the next change cheaper or more expensive.

Prefer small modules with names from the domain. An orchestration file should read
like a table of contents: bind dependencies, choose the next domain operation, and
return the result. When orchestration starts carrying retry policy, budget wiring,
repair behavior, or nested branching, extract the lifecycle phase into a named
module or function.

Use extraction units that are domain verbs, not utility buckets: run split, run
recursive goal, resolve attempt failure, manage root lifecycle, evaluate artifact.
Repeated callback wiring usually wants an adapter. Long parameter lists that move
together usually want an explicit context object. Tests should move with the
ownership boundary they prove.

Treat large files, large functions, deep nesting, and repeated lambdas as evidence
that a domain boundary is missing. If code-shape evidence is injected into the
harness, weigh it before editing the pressured area; either decompose the shape or
leave a concrete finding that names the missing boundary.
