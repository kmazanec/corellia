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
