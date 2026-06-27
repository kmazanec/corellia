---
type: adr
title: "ADR-041: bound a leaf's CONTEXT, not its read COUNT — raise the working-memory cap, summarize on evict, read in ranges, and remove the explore read-ceiling"
description: A leaf's read-loop was bounded two ways that fought each other — a working-memory eviction (ADR-036) that blind-stubbed reads, and an explore-then-emit read-COUNT ceiling (ADR-039) that force-emitted after ~16 reads. The first thrashed (evict→re-read sawtooth); the second truncated legitimate comprehension into a failing partial emit. Both are symptoms of bounding the wrong thing. Bound CONTEXT SIZE well (bigger cap, distilling eviction, ranged reads) and the read-count ceiling becomes unnecessary and harmful — remove it.
tags: [adr, engine, working-memory, eviction, explore-then-emit, read-tool, context, adr-036, adr-039]
timestamp: 2026-06-26T19:30:00-05:00
---

# ADR-041: bound a leaf's CONTEXT, not its read COUNT

**Status:** Accepted · **Date:** 2026-06-26 · **Stretch:** no · **Contract:** yes
**Supersedes:** the EXPLORE_READ_CEILING force-emit half of ADR-039 ·
**Relates to:** ADR-036 (working-memory bound), ADR-023 (two-phase emit)

## Context

A leaf's step-loop reads files into an append-only transcript. Unbounded, that
transcript balloons until the model's response truncates. The factory had grown
**two** bounds against this, aimed at different leaf shapes, and they fought:

1. **ADR-036 working-memory eviction** (all leaves): at a 60K-token cap, stub the
   oldest reads. The stub was *blind* — it threw the content away and told the model
   to "re-read if you need it."
2. **ADR-039 explore-then-emit read-ceiling** (outputSchema + no write grant): after
   16 read-class calls, FORCE the structured emit.

Both are bounding a **proxy** for context size — eviction bounds tokens (correct
target, wrong method), the ceiling bounds *read count* (wrong target entirely). Run
`live-self-bcc825bb` (slice C) made both failures concrete and expensive:

- The build leaf (no ceiling — it has a write grant) **thrashed**: 60K evicts after
  ~6 of corellia's large files; each blind eviction dropped ~85% of context; the leaf
  re-read what it lost in a sawtooth — **170 reads, 46 evictions, 0 writes**.
- The `tests/engine` dive (an explore-then-emit leaf) hit the **16-read ceiling**,
  was force-emitted from a *partial* reading of a 33-file region, and the partial
  `RegionFacts` failed its dive-anchor gate → `step-loop:failed` → null artifact →
  cascade-blocked every dependent (runs 15, 16, 17 — deterministic, not flaky).

The same root insight resolves both: **bound the context, not the count.** If
context stays bounded no matter how much is read, the read-loop can never balloon to
truncation — so neither the blind stub nor the read-count cutoff is needed.

## Decision

Bound context size *well*, and delete the read-count ceiling.

1. **Raise the working-memory cap** (ADR-036). `TRANSCRIPT_TOKEN_CAP` 60K→140K,
   `KEEP_RECENT_READS` 4→8. The mid build tier (DeepSeek V4 Pro) has ~384K context;
   140K keeps ample truncation headroom while letting a cross-cutting change hold a
   real working set in view rather than evicting after a handful of files.

2. **Summarize on evict, don't blind-stub.** A new optional `Brain.summarize(text,
   ctx)` (low tier by default) distills an evicted read into a gist; the stub carries
   that gist so the leaf keeps orientation without re-reading. The engine wires it in
   `evictBoundedTranscript` and debits the summary tokens; it falls back to the blind
   stub when no summarizer is present or the call fails (eviction never fails a step).
   The post-truncation *emergency* shed stays blind (it must be fast).

3. **Read in ranges.** `read_file` gains `offset`/`limit`; a whole-file read past
   `READ_FILE_AUTO_BOUND_LINES` (400) returns a bounded head plus a paging notice, so
   one giant file cannot fill the cap on a single read. Small whole-file reads stay
   byte-identical.

4. **Remove the EXPLORE_READ_CEILING force-emit.** With (1)–(3), an explore-then-emit
   leaf's reading is bounded *in context* by the working-memory mechanism, so the
   read-count cutoff is redundant — and it was doing active harm (forcing a partial
   emit that failed). A leaf now reads as many files as the region needs and emits
   when it is ready. True non-termination is still backstopped by the warn-only
   tool-call cap (50× budget), the tokens/dollar/wall-clock bounds, and the
   malform-recovery forced emit — none of which truncate a legitimately-reading leaf.

The read-economy *teaching* (`_explore-economy.md`) stays, reframed honestly: read
what the region requires, prefer the few files that decide the artifact, and `note`
to stay calibrated — guidance scaled to the region, not a fixed count.

## Alternatives Considered

### (A) Keep the ceiling but raise it (e.g. 16→40)

**Rejected — it just moves the arbitrary line.** A region needs the reads it needs;
any fixed number force-emits a region one file larger than the guess. The bound that
actually matters (context size) is already enforced by the working-memory mechanism,
so a read-count number is both redundant and a recurring source of premature partial
emits. Remove it, don't retune it.

### (B) Keep blind eviction, just raise the cap

**Rejected — blind eviction still thrashes, just later.** A build leaf working across
a large subsystem will still cross any cap; when it does, a blind stub discards the
substance and forces a re-read. Summarize-on-evict makes eviction *non-destructive*,
which is what stops the sawtooth — the cap raise alone does not.

### (C) Cap build-leaf reads too (give it the explore ceiling)

**Rejected (again) — this is ADR-040's rejected alternative (A) restated.** A build
leaf legitimately read-write-rereads; capping its reads forces it to guess. The fix
is to bound its context and feed it the dive facts, not to cap its reading.

## Consequences for the Build

- **`src/engine/scratchpad.ts`**: cap 60K→140K, keepRecent 4→8;
  `summarizedEvictionStub` + `evictTranscriptWithSummary`.
- **`src/contract/brain.ts`**: optional `Brain.summarize?`.
- **`src/brains/llm.ts`**: `summarize` on the low tier.
- **`src/engine/engine.ts`**: `evictBoundedTranscript` wiring; remove the
  `EXPLORE_READ_CEILING` force-emit (the malform-recovery forced-emit path stays).
- **`src/engine/tools.ts`**: `read_file` `offset`/`limit` + large-file auto-bound.
- **`src/library/skills/_explore-economy.md`**: reframed as relevance guidance.
- **Tests**: ranged-read cases; summarize tier + fallback; the explore-then-emit
  tests now assert a leaf reads past 16 and converges on its own (no cutoff).
