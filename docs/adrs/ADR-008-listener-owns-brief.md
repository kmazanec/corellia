# ADR-008: The Listener owns the decision-brief seam

**Status:** Accepted · **Date:** 2026-06-10 (decided iteration 2 review escalation; recorded retroactively) · **Stretch:** no · **Contract:** no
**Supersedes:** none · **Superseded by:** none

## Context

Iteration 2 built the Engine's `onBrief` handler and the Listener's
park/TTL/resume machinery in parallel; review escalated that the two halves
were uncoordinated — the Listener inferred parks from post-hoc event scans
while the Engine resolved briefs on its own, two authorities over one human
seam.

## Options considered

- The Listener installs itself as the engine's single brief authority per
  run — chosen.
- The Engine owns briefs; the Listener only observes events — rejected: the
  Listener owns scope reservations, and park-releases-scope-immediately needs
  the brief authority and the reservation owner to be the same actor.
- Freeze a Brief interface into `src/contract/` — rejected for now: neither
  surface is consumed by parallel builders yet; freezing prematurely is
  contract creep. Revisit when a second brief surface (CLI/daemon) exists.

## Decision

Exactly one brief authority exists per run. When a Listener manages the run,
it installs its handler as the Engine's brief authority and records parks
synchronously (scope released at park time, TTL owned by the Listener's tick).
The Engine's `onTimeout` defaults remain the fallback for engine-only runs
(tests, direct demos); the post-hoc event scan survives only for scripted test
engines.

## Rationale

A human seam with two authorities can double-fire or drop a brief — the
worst place in the system for a race. Single-authority-per-run is the
smallest rule that closes it, and keeping it out of the frozen contract until
a second consumer exists follows the freeze-when-shared rule rather than
freeze-by-reflex.

## Tradeoffs & risks

- The seam is a convention, not a type — a future surface could wire a second
  authority by mistake. The promotion path is named: when the daemonized
  listener or a CLI brief surface lands (iteration 6 arc), freeze the Brief
  contract then.

## Consequences for the build

- **Source of truth:** `src/listener/listener.ts` (authority installation,
  park/TTL), engine brief fallback in `src/engine/engine.ts`.
- Any new run-owner (daemon, replay harness) must install exactly one brief
  authority before spawning the tree.
