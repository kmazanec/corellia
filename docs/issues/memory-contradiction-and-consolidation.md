---
type: issue
title: Memory governance gaps — no contradiction-check on write, no consolidation runtime
description: The memory contract's contradiction-check-on-write is unimplemented and consolidate-memory is a type definition with no runtime path, so conflicting memories coexist silently and the store never distills or dreams.
tags: [engine, memory, governance, consolidation]
timestamp: 2026-07-07
status: open
kind: future-work
severity: low
---

# Memory governance gaps — no contradiction-check on write, no consolidation runtime

## Problem
Two clauses of DESIGN.md's memory contract have no mechanism behind them. (1)
"Contradiction-check on write: a new memory is checked for conflict with existing
ones; conflicts escalate to resolution rather than silently coexisting" — today
nothing compares an incoming lesson against the namespace it lands in. (2)
"Consolidation — episodic → semantic distillation, 'dreaming' — is itself a
scheduled goal-type" — `consolidate-memory` is defined in the library but no
runtime path ever spawns it, so namespaces only ever grow noisier. Low severity
while stores are small; both gaps compound with store size.

## Evidence
- capability-scout sweep (2026-07-07): "MISSING: consolidate-memory runtime
  (type defined, no op), contradiction-check on write, verify-on-read for lesson
  memories."
- DESIGN.md "The memory contract".

## Proposed direction
Contradiction-check first (it guards write quality): at the promote edge, compare
the candidate against same-namespace memories (cheap lexical/embedding screen,
judge only on suspicion) and route conflicts to resolution instead of appending.
Consolidation second, once any namespace is big enough to matter: a scheduled
mint (listener tick or operator command) of `consolidate-memory` over the noisiest
namespace, with eviction proposals gated like any other promotion.

## Acceptance hint
Writing a lesson that directly contradicts an existing trusted memory produces a
conflict event/resolution path, not two coexisting opposites; and a
`consolidate-memory` goal can actually be spawned and produce distillations
against a real namespace.
