---
type: issue
title: Type and global memory layers are never written — the compounding asset doesn't compound
description: Every memory writer hardcodes layer:'project' and retrieval ignores scope, so cross-project type wisdom (DESIGN's compounding asset) never accumulates.
tags: [engine, memory, layers, promote-memory]
timestamp: 2026-07-07
status: open
kind: future-work
severity: medium
---

# Type and global memory layers are never written — the compounding asset doesn't compound

## Problem
DESIGN.md's memory model is three layers — project / type / global — with type
memory named "the compounding asset — the layer where the factory gets better
over time." In code the layer union exists, but every write path hardcodes
`layer:'project'` and retrieval doesn't scope by layer. A `critique-code` lesson
learned in one repo is invisible to the next repo; ten projects teach the factory
nothing durable. The `promote-memory` type's whole point — eval-gated promotion
with the "general, true, non-harmful beyond this project?" question — is
unreachable because there is nowhere general to promote *to*.

## Evidence
- capability-scout sweep (2026-07-07): "type/global in the union but no writer
  produces them (all hardcode layer:'project'); retrieval ignores scope."
- DESIGN.md "Memory: layered project × type × global, spawner-mediated".

## Proposed direction
Make layer a real routing decision at the promote edge: `promote-memory` decides
project vs type (vs global) from its existing generality eval, writes the chosen
layer, and spawner retrieval unions the layers relevant to the child (project of
the repo at hand + the goal-type's namespace + global), with provenance labels
intact. Note the store is keyed per-project today (per-project event-log path) —
type/global memory needs a home that outlives one project's log; deciding that
home (a shared store path/DB beside the per-project logs) is part of this work
and worth a short ADR.

## Acceptance hint
A lesson promoted with type-level generality in project A is retrieved and
injected (provenance-labeled) for a same-type goal in project B, shown in a test
across two stores/logs — and nothing about project-layer behavior regresses.
