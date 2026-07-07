# Anchor-mismatch fixture ({file, anchor} criterion)

An acceptance criterion of the form `{ file, anchor }` asserts that a named file
in the round's worktree contains an anchor string. The deterministic check
(`sandboxFileContains`) reads the file at the current SHA and passes only if the
anchor is literally present — a judge-independent boolean.

Both variants carry the SAME criterion: the file `docs/api.md` must contain the
anchor `## Authentication`.

- Against the **true-anchor** file — whose heading really is `## Authentication`
  — the criterion **passes**.
- Against the **defective** file — whose heading was reworded to
  `## Auth` while the criterion still names the old anchor — the criterion
  **fails**. This is the anchor-mismatch failure seen live: a criterion pinned to
  an anchor that does not exist at the SHA can never pass, whatever a judge
  thinks the section "means".

The test writes each variant into a temp worktree and runs the real check with a
`sandboxRoot`, exactly as the milestone loop assesses `{file}` criteria against
the worktree (ADR-031 §4.3).

- `anchor.txt` — the criterion's `{ file, anchor }` pair under test.
- `api.true-anchor.md` — a doc whose heading matches the anchor.
- `api.defect.md` — the same doc with the heading reworded so the anchor is gone.
