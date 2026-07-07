# Process-pollution fixture (process-clean grep)

Before a tree's diff reaches a foreign product repo, the process-clean gate
(`scanDiffForProcessLanguage`) scans the added lines for factory-internal
vocabulary — goal-id branch refs (`tree/…`), worktree paths, and factory
process language (`improve-factory`, `corellia`, `docs/iterations`, …). None of
that belongs in a human product's committed code.

- The **clean** diff adds ordinary product code with no factory vocabulary, so
  the gate **passes**.
- The **polluted** twin is the same change with a leaked goal-id branch ref and
  a factory-process comment carried into a code comment — the kind of leak an
  LLM author emits when it narrates its own plan inside the artifact. The gate
  **fails**, listing each offending line.

The fixtures are real unified diffs (`git diff` format) so the test drives the
gate exactly as the push path does. The two differ only by the two polluted
lines.

- `change.clean.diff` — a product change with no factory vocabulary.
- `change.polluted.diff` — the same change plus a `tree/…` ref and a
  factory-process comment.
