---
id: F-42
title: Import-edge scanner + impact()
iteration: 04-eyes
type: implement
intent: production
status: not-started
dependsOn: []
contracts: [ADR-020]
---

# Feature: Import-edge scanner + impact()

**ID:** F-42 · **Iteration:** 04-eyes · **Status:** Not started

## What this delivers (before → after)

**Before:** "what does touching this file affect?" is unanswerable;
impacted-slice testing and scope scheduling run blind.
**After:** a zero-dependency scanner extracts file-level import edges by
heuristic text patterns into `ImportGraph {edges, scannedAtSha}`;
`impact(files)` returns the reverse-reachability closure plus associated
test files; the graph is verifiable-on-read by re-scan.

## Reading brief

`docs/adrs/ADR-020` (the decision and its accepted incompleteness) ·
`src/library/script-runner.ts` (zero-dep library module idiom) · DESIGN.md
§ "The knowledge artifacts".

## Requirements traced (from the PRD)

R11 · AC-15's "splits sensibly" substrate · the regression guard's
impacted-slice input (AC-17, future).

## Dependencies / contracts

None hard. The module's exported surface is frozen by the manifest (the
retrieval and gate features build against it): `scanImports(root, opts?) =>
ImportGraph`, `impact(graph, files) => { files, testFiles }`.

## Acceptance criteria

1. Given a fixture tree with ES/TS imports (`import x from './a.js'`,
   `export … from`, `require('./b')`, dynamic `import('./c')`), then edges
   resolve to repo-relative file paths, including index-file and
   extension-inference resolution (`./a` → `a.ts`/`a/index.ts`).
2. Given files in Python/Go/Ruby fixture form, then the generic patterns
   produce edges (best-effort, conservative-over-inclusive).
3. Given `impact(graph, [f])`, then the result is the transitive set of
   files that (directly or transitively) import `f`, plus test files
   associated by naming convention (`f.test.ts`, `tests/**` importing `f`).
4. Imports inside comments/strings may false-positive (accepted direction)
   but never false-negative a plain static import — pinned by fixtures.
5. Re-scanning an unchanged tree yields an identical graph
   (`scannedAtSha`-stable determinism); scanning after an edit yields the
   changed edge set — the verify-on-read mechanism.
6. Scanner skips `node_modules`, `.git`, binary files; bounded file-size
   guard; never throws on weird encodings.

## Build plan (approved)

- [ ] **Pattern extraction + path resolution** — `src/library/imports.ts`:
  per-language regex table (named const, auditable), repo-relative
  resolution with extension/index inference, exclusion rules. Tests:
  `tests/library/imports.test.ts` over tmp fixture trees (AC-1/2/4/6).
- [ ] **Graph + impact()** — reverse adjacency, transitive closure
  (cycle-safe), test-file association heuristics. Tests: same file
  (AC-3, cycles, self-import, unknown file → empty).
- [ ] **Determinism + drift** — stable ordering, `scannedAtSha` from git
  HEAD (plumbing optional: accept injected sha), identical-rescan pin
  (AC-5).

### Test strategy

Pure unit tests on tmp fixture trees, zero network, zero deps. The regex
table is the risk concentration: the fixture set IS the spec of what we
claim to parse — keep it explicit and extensible. Per-chunk named file; one
typecheck + full suite at end.
