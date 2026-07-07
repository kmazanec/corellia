# Scope-escape fixture (diff ⊆ scope)

A goal declares an impact set — the files and regions it may touch — and the
factory enforces `diff ⊆ scope` at emission: an artifact that writes a file
outside the declared scope is rejected deterministically, before any judge.

- The **clean** artifact writes only files under the declared scope prefix, so
  `filesWithinScope` **passes**.
- The **defective** twin writes one extra file outside the scope prefix — the
  kind of out-of-scope write seen in real runs when a leaf edits a neighbouring
  module it was never granted. `filesWithinScope` **fails**, naming the escaping
  path.

The two artifacts differ by exactly one file, so the test isolates the escape.
Both artifacts are plain JSON descriptions of a produced file set (path +
content); the test loads them and runs the real `filesWithinScope` check.

- `scope.json` — the declared scope prefixes for the goal under test.
- `artifact.clean.json` — a file set fully within scope.
- `artifact.defect.json` — the same set plus one path that escapes the scope.
