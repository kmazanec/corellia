# ADR-025: PR-opening is brokered tools; credentials stay engine-side

**Status:** Accepted · **Date:** 2026-06-12 · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none

## Context

A tree ends at a local `tree/<id>` branch (ADR-016) — no push, no PR exists
anywhere in `src/`. AC-1/R13 require the boundary artifact: a PR carrying
the diff, proof artifacts, and `learned`. `improve-factory`'s card already
declares `factory-repo.branch` / `factory-repo.pr` grants, but they are
unmapped strings. PRD §4 bans dangerous grants; ADR-016's posture keeps the
riskiest operations away from model-influenced child processes (the env
scrubber strips `GH_TOKEN` from every spawn). Gate-brief decision
(2026-06-12): the model drives the boundary; it must never hold credentials.

## Options considered

- **Engine-side automatic boundary** (engine pushes after collect) —
  rejected: takes timing and PR content out of the model's hands; the
  boundary becomes invisible to type design.
- **Operator-run script** — rejected: breaks "mostly autonomously"; the PR
  *is* the factory's output.
- **Brokered tools, engine-held credentials** — chosen.

## Decision

Two `ToolImpl`s, `push_branch` and `open_pr`, behind grants generalized to
`repo.branch` / `repo.pr` (the broker is already bound to the tree's repo
root per ADR-016 — "factory-repo" named the binding, not the capability;
`improve-factory`'s card is updated). The model decides when to call and
supplies title/body/`learned`; the implementations run **in the engine
process**: the token (`GITHUB_TOKEN`) is read from the engine's environment
at execute time (ADR-012), GitHub is reached via REST over global `fetch`
(zero-dep), and the child-process scrubber is untouched. The transcript
never contains a credential. Deterministic gates live inside the tools:
the process-clean check (AC-20) runs over the diff before any push and
refuses with offending lines; `open_pr` is idempotent — one PR per tree,
a second call refuses. No merge/approve/close tool exists in any form
(R13: the factory never self-merges — structural, not policed). Two
additive event members: `branch-pushed` and `pr-opened` (ADR-003:
exhaustive switches extended).

## Tradeoffs & risks

- "Grant" now gates an outward-facing engine-held capability, not just a
  sandboxed primitive; the constitution lint (dangerous-grant rule) is the
  guard against these grants spreading to types that shouldn't hold them.
- A model can open an embarrassing PR early; it cannot open a second, and
  the PR is reviewable by construction.

## Consequences for the build

- Barrier: `GRANT_TOOL_MAP` entries + two event members frozen.
- F-61 implements the tools and gates; F-63/F-67 consume them.
