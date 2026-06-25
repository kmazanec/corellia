---
type: adr
title: "ADR-016: Sandbox = one worktree per tree; declared scripts run as bare processes"
description: The sandbox is one git worktree per tree and only repo-declared entry-point scripts execute, running as bare processes rather than containers in v1.
tags: [adr, sandbox, worktree, execution, isolation]
timestamp: 2026-06-12T12:42:27-05:00
---

# ADR-016: Sandbox = one worktree per tree; declared scripts run as bare processes

**Status:** Accepted · **Date:** 2026-06-10 · **Stretch:** no · **Contract:** no
**Supersedes:** none · **Superseded by:** none

## Context

Leaf execution writes real files and runs real commands. DESIGN.md fixes the
isolation unit ("each tree works in isolation — its own worktree/branch");
the PRD fixes what may execute (repo-declared entry-point scripts only,
R12). Remaining: isolation granularity within a tree, and whether script
execution is containerized. Operator decision at the iteration-3 gate brief.

## Options considered

- **Worktree per tree, bare process execution** — chosen.
- Worktree per leaf — rejected for v1: per-leaf merge machinery now, for
  isolation that scope-disjointness already provides; revisit if traces show
  sibling write collisions.
- Containerized script runs — rejected for v1: Docker in every leaf's hot
  path and in every target repo's requirements, to defend a solo operator
  against repos they own. Disproportionate today; the broker seam is where a
  container would slot in later without contract change.

## Decision

Each tree gets one git worktree on its own branch under the target repo's
`.corellia/worktrees/<tree-id>/` (gitignored), created at tree start and torn
down after its work is collected into the PR branch. Within the tree, leaves
share the worktree: the split's scope-disjointness keeps writers off each
other's files, and the broker enforces every write path against the
requesting goal's scope (ADR-014). `run_script` executes only the repo's
declared entry points, as bare processes, with the tree worktree as cwd.
The factory's process never executes arbitrary command strings composed by a
model — script *names* from the declared set, never shell text.

## Rationale

This is the design's stated isolation unit, the same convention the
operator's own tooling uses, and the same posture under which corellia built
itself for two iterations. Scripts-by-name closes the command-injection
class without a container: the model chooses *which* declared script, never
*what* runs.

## Tradeoffs & risks

- A malicious or compromised target repo's own scripts run with the
  operator's privileges. Accepted knowingly for v1 (operator owns all target
  repos; same trust as running `npm test` by hand). Containerization is the
  named upgrade path if foreign-repo trust ever weakens.
- Concurrent leaves share one process environment (ports, tmp files).
  Scope-disjointness doesn't cover runtime resources; the v1 mitigation is
  the existing serialization of overlapping scopes, and `run_script`
  collisions surface as ordinary check failures.

## Consequences for the build

- Worktree lifecycle (create / branch / collect / teardown) is engine-side
  tree machinery; the broker binds to the worktree root and refuses any path
  escaping it (reusing the `filesWithinScope` normalization).
- The capability check (PRD AC-5) verifies declared entry points exist
  before any tree is spawned.
- Script runs record command, exit status, and captured output as events —
  the raw material for proof artifacts.
