# Behavioral fixture library

Each fixture is a minimal artifact/repo plus a deliberately defective twin and a
vitest that proves the relevant DETERMINISTIC gate **flags the defective one and
passes the clean one** — the "did the produced software actually work?" floor,
one defect class at a time (see `docs/issues/behavioral-fixture-library.md`,
DESIGN.md "Deterministic before judge, always").

Every pair is distilled from a failure class the factory actually guards, and
where possible one seen in real runs (out-of-scope writes, factory-language
leaks, anchor mismatches, dead-on-arrival criteria).

| Fixture | Defect class | Deterministic gate pinned | Source of the gate | Test |
| --- | --- | --- | --- | --- |
| `runtime-capture/` | Value rendered in the wrong place (no unit test catches it) | `captureSucceeded` (`{capture}` criterion) | `src/library/checks.ts` | `tests/library/runtime-capture-fixture.test.ts` |
| `scope-escape/` | A produced file written outside the declared scope | `filesWithinScope` (diff ⊆ scope) | `src/library/checks.ts` | `tests/library/scope-escape-fixture.test.ts` |
| `process-pollution/` | Factory goal-id / process language leaked into a product diff | `scanDiffForProcessLanguage` (process-clean grep) | `src/engine/process-clean.ts` | `tests/engine/process-pollution-fixture.test.ts` |
| `anchor-mismatch/` | A `{file, anchor}` criterion whose anchor does not exist at the SHA | `sandboxFileContains` (worktree anchor check) | `src/library/checks.ts` | `tests/library/anchor-mismatch-fixture.test.ts` |
| `dead-criterion/` | A `{script}` criterion naming a raw command instead of a declared script | `criteriaWellFormed` (criteria ship gate) | `src/library/acceptance-criteria.ts` | `tests/library/dead-criterion-fixture.test.ts` |

## Note on the fourth gate

The issue's acceptance hint named a "secret-value leak" pair pinned to a
vault-ref scan. No deterministic value-shaped secret scanner exists in the repo
today — `src/library/risk.ts` classifies risk by PATH, not by value, and there
is no vault-ref/secret-value gate to pin (a secret-value judgement is judge-side,
not a deterministic floor). Rather than invent a gate to pin, this library swaps
in `dead-criterion/` → `criteriaWellFormed`, a real deterministic gate guarding a
failure class actually seen live (criteria minted with raw command lines that no
runner will accept). See the issue's Fixed addendum.
