---
type: adr
title: "ADR-020: impact() runs on a deterministic import-edge scan; dives add semantics"
description: The impact() query runs on a deterministic import-edge scanner as its fact layer, with LLM dives adding semantics, so edges stay verify-on-read.
tags: [adr, impact, import-graph, deterministic, comprehension]
timestamp: 2026-06-11T14:22:39-05:00
---

# ADR-020: impact() runs on a deterministic import-edge scan; dives add semantics

**Status:** Accepted · **Date:** 2026-06-11 · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none

## Context

`impact(files)` is iteration 04's load-bearing query — the split gate,
scope-disjoint admission, and the regression guard's impacted-slice all
consume it. The tension: precision wants language tooling (the per-language
adapter treadmill the PRD deferred); pure-LLM mapping is flexible but a
model's claimed dependency edge has no cheap recheck — it would make a
*fact* outcome-only-validatable, violating the epistemic rule.

## Options considered

- **Hybrid: deterministic scanner as the fact layer + LLM dives for
  semantics** — chosen (operator decision at the gate brief).
- LLM-built graph only — rejected: no verify-on-read for edges; the split
  gate's "mechanical" coverage check would rest on unverifiable claims.
- TypeScript compiler API for TS repos — rejected for v1: starts the
  per-language adapter work the PRD explicitly deferred; revisit per repo
  demand.

## Decision

A zero-dependency **import-edge scanner** extracts file-level dependency
edges by heuristic text patterns (ES/TS `import`/`export from`/`require`,
plus generic patterns for common languages), producing an
`ImportGraph { edges, scannedAtSha }`. `impact(files)` = reverse reachability
over the graph plus test-file association (naming conventions + test-file
imports). The graph is **verifiable-on-read by construction**: re-scan and
compare — staleness detection is mechanical (ADR-019's checkpoint rule).

`deep-dive-region` layers **semantic** facts (runtime coupling, conventions,
"how guarded is this") on top as separately-anchored claims; they enrich
judgment but the mechanical coverage check and impacted-slice never depend
on an unverifiable edge.

## Rationale

Facts get a fact-grade mechanism; judgment gets a judge. Heuristic edges are
incomplete (dynamic imports, DI, string-built paths) but incomplete-and-
verifiable beats complete-and-unverifiable for a gate input — and the
regression guard's backstop (the full suite at root) bounds the cost of a
missed edge.

## Tradeoffs & risks

- False negatives on dynamic/indirect dependencies: accepted; the dive layer
  and the root full-suite run are the named backstops.
- Heuristics over text can false-positive (imports in comments/strings):
  acceptable in the conservative direction (over-inclusion widens the
  impacted slice, never narrows it).

## Consequences for the build

- **Source of truth:** scanner + `impact()` in `src/library/` (engine-side
  frozen surface, not `src/contract/`); the architecture-category artifact's
  self-validation is spot edge queries against a fresh scan.
- Retrieval tools (`find_symbol`, `find_exemplar`, `conventions_for`,
  `stack_versions`, `impact`) are ToolImpls over these functions, registered
  at assembly under the `retrieval.api` grant (additive `GRANT_TOOL_MAP`
  entries).
