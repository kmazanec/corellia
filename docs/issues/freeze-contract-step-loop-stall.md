---
type: issue
title: "freeze-contract leaf stalls with step-loop:failed, blocking the whole tree"
description: When the visual-runtime-verification commission decomposed, the freeze-contract leaf hit an isomorphic step-loop failure (signature step-loop:failed) and produced no artifact, cascading a blocker through every dependent and stopping delivery.
tags: [engine, build, step-loop, in-run-stall, isomorphic-failure, commission]
timestamp: 2026-06-27
status: open
kind: bug
severity: high
---

# freeze-contract leaf stalls with step-loop:failed, blocking the whole tree

## Problem
With the commission harness fixed (real broker/sandbox), the
`visual-runtime-verification` commission decomposed correctly and `map-repo`
succeeded — but the next leaf, `freeze-contract` (freeze the runtime
AcceptanceCheck variant, capture-engine interface, judge-visual goal type, and
constitution security rule), stalled in its step loop with an **isomorphic
failure** (signature `step-loop:failed`) and produced **no usable artifact**. That
blocker then cascaded through every dependent leaf, so the root `deliver-intent`
blocked and nothing shipped.

This is the real blocker preventing the commission from delivering. It is
adjacent to the existing in-run-stall issues
([salvage-on-repeated-failure](salvage-on-repeated-failure.md),
[error-signature-repair-hints](error-signature-repair-hints.md),
[build-leaf-context-thrash](build-leaf-context-thrash.md)) but specific to a
contract-freezing leaf making no forward progress.

## Evidence
`visual-runtime-verification` re-run (2026-06-27, broker-wired harness, $40
ceiling, spend ~$0.23). Goal tree:

```
✗ [deliver-intent] Visual/runtime verification rung
  ✓ [map-repo] Map existing acceptance-criteria, constitution, broker/assembly, ...
  ✗ [freeze-contract] Freeze interfaces: runtime AcceptanceCheck variant, ...
```

Blockers were dominated by repeated
`Isomorphic failure detected (signature: step-loop:failed) — escalating to block`
and cascaded `Blocked because a dependency failed without producing any usable
artifact`. Output under `out/commission-visual-runtime-verification/`.

## Proposed direction
Investigate why the `freeze-contract` leaf made no forward progress: is the step
loop hitting the same failing tool call repeatedly (isomorphic), is the leaf
over-scoped (freezing four contracts in one leaf), or is it the working-memory
thrash captured in build-leaf-context-thrash? Likely fixes: a salvage rung that
emits partial frozen contracts rather than zero artifact, finer decomposition of
the freeze step, or an error-signature repair hint specific to the stall.

## Acceptance hint
Re-running `visual-runtime-verification` gets past `freeze-contract` and writes
the frozen contract interfaces, OR the leaf emits a partial artifact / actionable
blocker instead of an empty isomorphic-failure block.
