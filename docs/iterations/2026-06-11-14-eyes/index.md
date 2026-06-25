---
type: iteration
title: "Iteration 04 — Eyes: repo comprehension and impact-aware splitting"
description: Pointed at an existing repo, the factory maps what it needs just-in-time, splits against fresh SHA-anchored knowledge, and a leaf consults impact() through the broker before touching code.
tags: [iteration, eyes, knowledge, import-scanner, impact, retrieval, coverage-gate]
timestamp: 2026-06-11
status: shipped
---

# Iteration 04 — Eyes: repo comprehension and impact-aware splitting

**Date:** 2026-06-11 · **Status:** Shipped

This iteration gave the factory eyes on a codebase. Knowledge artifacts are
event-projected and SHA-anchored for verify-on-read freshness, a deterministic
import scanner yields an impact graph the retrieval API exposes as granted tools,
and a per-kind coverage gate triggers just-in-time comprehension spawning. Proven
scripted on fixtures, live on corellia itself, and read-only on one real foreign
repo (cats).

## Features
- [01-knowledge-store](01-knowledge-store.md) — Knowledge store + event projection (SHA-anchored freshness).
- [02-import-scanner](02-import-scanner.md) — Import-edge scanner + `impact()`.
- [03-retrieval-tools](03-retrieval-tools.md) — The typed retrieval API exposed as granted tools.
- [04-learn-types](04-learn-types.md) — `map-repo` + `deep-dive-region` goal types.
- [05-coverage-gate](05-coverage-gate.md) — Mechanical coverage gate + JIT comprehension spawning.
- [06-assembly-eyes](06-assembly-eyes.md) — Assembly: eyes wired + the convergence checks.

## ADRs produced
ADR-019 (knowledge artifacts event-projected, SHA-anchored freshness), ADR-020
(hybrid impact graph: deterministic scanner = facts, dives = semantics), ADR-021
(coverage as a per-kind policy table).

## Build plan
[BUILD-PLAN-04-eyes](BUILD-PLAN-04-eyes.md)

## Build notes (folded from prototype-build-notes.md)

Built by the same direct process as iteration 3: barrier (opus) → five
concurrent builders (four worktrees + the coverage gate on the trunk) →
five opus judges → sonnet repair rung → clean fold-back (17 cherry-picks,
zero conflicts) → assembly (opus) → final judge → live runs. 555 → 826
tests.

### What was added

| Module | What it is |
| --- | --- |
| `src/contract/knowledge.ts` + 3 event members | KnowledgeArtifact/RegionFacts/DiveFact (pointers-not-bodies, SHA-anchored), knowledge-written/facts-written/checked |
| `src/eventlog` projectKnowledge + `src/library/knowledge.ts` | the knowledge view (latest per repo×category with freshness) + evented write helpers |
| `src/library/imports.ts` | zero-dep import-edge scanner + impact() (reverse reachability + test association); verifiable-by-rescan |
| `src/library/retrieval.ts` | find_symbol / find_exemplar / conventions_for / stack_versions / impact as functions + read-only ToolImpls under retrieval.api |
| `src/library/starter-types.ts` + `knowledge-checks.ts` | map-repo (4 categories) + deep-dive-region with executing per-category self-validation |
| `src/library/coverage.ts` + engine gate seam | the ADR-021 policy table; misses spawn comprehension children as dependencies; split-checkpoint verify-on-read (integrate checkpoint honestly deferred) |
| assembly + `live:eyes` | retrieval tools in the broker, knowledge wiring, scripted convergence, the live mapping demo with full foreign-repo teardown |

### Review-rung results

Five judges, ~20 findings. F-45 FAILED outright: its builder left a
load-bearing parameter uncommitted (committed HEAD didn't typecheck),
injected children bypassed the split guards, and a docstring claimed
checkpoint coverage that didn't exist — all repaired, the deferral now
stated truthfully. F-42's judge caught a silent source-dropping skip list.
F-41's judge caught a pg test that would crash under a real DATABASE_URL.

### The live runs — honest results (≈$21 of evidence)

**Scripted convergence: PASSED** (zero network) — gate spawns maps as
dependencies with proven sequencing, a leaf consults impact() through the
broker before its first write, SHA drift triggers validation + refresh, a
phantom pointer is caught by the real scan, worktrees collect.

**Live mapping: PARTIAL, high variance.** Across five corellia runs every
category validated live at least once (architecture once at 23 pointers;
stack + conventions once; an excellent 8-anchored-fact dive once) but never
5/5 in a single run; the cats run blocked all five. Every failure was
bounded and blocked cleanly; corellia and cats were left byte-identical
after every run (verified externally for cats, including exclude-file
reversion).

**The big catch:** the live runs exposed a cross-iteration bug all prior
judges and 800+ scripted tests missed — **the step transcript never carried
the goal.** Scripted brains don't read prompts, so the missing harness
message was structurally invisible to the entire scripted suite;
iteration 3's live demo had only succeeded because its task was
discoverable from the fixture repo itself. Fixed in the engine
(prefix-stable harness message: title, type, spec, memories-as-quoted-data)
and pinned.

### Trace-driven amendments made during the live phase

1. Packaging tolerance: models wrap artifact JSON in fences (the adapter
   parses them into files artifacts); one shared extractArtifactPayload now
   serves the gate AND persistence (the persist path's separate strict
   parser silently dropped valid artifacts — found live).
2. map-repo default tier haiku → sonnet (GOAL-TYPES table updated with the
   evidence citation): haiku first attempts burned shared budgets before
   the sonnet retry started.
3. Exploration economy + message protocol stated in the live harness specs.

### Carried debt (named, for iteration 5)

- **One-shot JSON emission of large artifacts over a long tool transcript
  is structurally brittle** at sonnet tier — the protocol-statement prompt
  did not fix it. The right fix is provider-native structured outputs
  (response_format/json_schema) for learn-type emission in the adapter —
  exactly iteration 5's harness-quality scope.
- Verdict details for shape mismatches should name the missing fields
  (repair-quality).
- Retry attempts re-explore from scratch (priorAttempt carries the verdict,
  not the knowledge gathered) — expensive on real repos; a
  carried-exploration design is iteration-5 material.
- Prompt caching not yet exploited via OpenRouter (cache_control
  breakpoints) — the transcript-heavy runs would benefit most.
- live-eyes' default dive region 'src' is wrong for non-src layouts (cats).
- Integrate-checkpoint verify-on-read deferred (split checkpoint full).
