---
type: issue
title: "a build leaf thrashes its context — the working-memory bound evicts too aggressively, blindly, and per-whole-file, forcing perpetual re-reads"
description: A fully-fed implement leaf read 170 files across 46 evictions with 0 writes. The ADR-036 bound caps the transcript at 60K (evicts after ~6 of corellia's large files), blind-stubs ~85% of context per pass with no gist retained, and read_file always returns whole files — so a giant file alone blows the cap. The leaf loses what it read and re-reads in a sawtooth that never converges to a write.
tags: [engine, build, working-memory, eviction, context, scratchpad, read-tool, adr-036, deliver-intent]
timestamp: 2026-06-26
status: partially-fixed
kind: bug
severity: high
---

# a build leaf thrashes its context — the working-memory bound evicts too aggressively, blindly, and per-whole-file

> **Implemented (2026-06-26), pending live re-proof.** All three decided directions
> are built and unit-tested:
> 1. **Cap raised** `TRANSCRIPT_TOKEN_CAP` 60K→140K, `KEEP_RECENT_READS` 4→8
>    (`src/engine/scratchpad.ts`) — well under the mid tier's ~384K context.
> 2. **Summarize-on-evict** — optional `Brain.summarize?(text, ctx)` (low tier by
>    default) distills an evicted read into a gist stub via
>    `evictTranscriptWithSummary`; the engine wires it in `evictBoundedTranscript`
>    and debits the summary tokens. Falls back to the blind stub when absent or on
>    error (no test churn). The post-truncation emergency shed stays blind (fast).
> 3. **Ranged / large-file reads** — `read_file` gains `offset`/`limit`; a whole-file
>    read past `READ_FILE_AUTO_BOUND_LINES` (400) returns a bounded head + a paging
>    notice. Small whole-file reads stay byte-identical.
>
> Plus (ADR-041): the **explore-then-emit read-ceiling was removed** — with context
> bounded by the working-memory mechanism, the 16-read force-emit was redundant and
> was force-emitting a partial RegionFacts that failed its gate (`dive-tests-engine`,
> the dive that cascade-blocked the build in runs 15-17). A leaf now reads what the
> region needs and emits when ready.
>
> **Still to prove:** a live run showing the dives all converge AND the build leaf
> reaches `write_file` without the re-read sawtooth.

## Problem

The ADR-036 working-memory bound is meant to stop a leaf's append-only transcript
from ballooning to truncation. It does — but for a *build* leaf making a
cross-cutting change, it over-corrects into a **context-thrash** that never converges
to a write. Three compounding faults:

1. **The cap evicts too early.** `TRANSCRIPT_TOKEN_CAP = 60_000` with
   `KEEP_RECENT_READS = 4`. corellia's source files are large (engine.ts alone is
   huge), so the leaf hits the cap after **~6 reads** and starts evicting. A build
   leaf working across `src/engine` legitimately needs more than 4 files in view.
   The mid build tier (DeepSeek V4 Pro) has a ~384K context, so 60K is far more
   conservative than the truncation risk requires.

2. **Eviction is blind, not distilling.** When the cap is crossed, the oldest read's
   content is replaced by a fixed stub `[evicted: re-read the file if you need it
   again, or consult your notes]` — the content is *thrown away* and the stub
   literally invites a re-read. Each pass drops **~52K tokens (~85% of context)**.
   Nothing of the file's substance is retained unless the model voluntarily `note`d
   it first.

3. **read_file is whole-file only.** No line-range; one giant file fills the cap by
   itself, guaranteeing an immediate eviction the moment it is read.

The model's own retention mechanism — the `note` scratchpad — *exists* and the build
skill *teaches* "read, note, write", but the leaf banks only **5 notes per 170
reads**, so eviction destroys un-summarized knowledge and it is lost → re-read.

## Evidence

Run `live-self-bcc825bb` (slice C, run 16). The `implement` leaf, fully fed (23
injected dive→build memories, all upstream dives REAL, zero contamination, zero
step-loop failures):

- **71 steps, 170 reads, 46 evictions, 5 notes, 0 writes**, emitted a null artifact.
- First eviction after only **6 reads**.
- The token trace sawtooths violently — each eviction drops ~52K and the leaf reads
  back up: `63089→10958`, `66045→13352`, `90679→11873`, … 46 times.
- The sequence is a relentless `R R |EVICT| R R |EVICT|` churn.

This was the cleanest run to date — every other wall (dive-anchor hallucination,
control-token contamination, large-region step-loop) was fixed in the same session.
The context-thrash is the single remaining reason no code was written.

## Decided direction (operator, 2026-06-26)

1. **Raise the eviction cap** (and the recent-reads kept verbatim) so a build leaf
   can hold a working set of several large files without thrashing — still well under
   the model's context limit so a tool-call response is never truncated.

2. **Auto-summarize on evict** rather than blind-stub: when a read is evicted, distill
   its content into the stub (a low-tier model call by default) so the file's gist
   survives without a re-read. Falls back to the current blind stub when no summarizer
   is wired (tests) or the call fails.

3. **Chunked / ranged reads.** `read_file` gains optional line-range params
   (offset/limit); and when a file exceeds a length threshold and no range is given,
   return a bounded head plus a notice ("file is N lines; showing 1–M; call with
   offset/limit for the rest") instead of the whole file — so one giant file cannot
   blow the cap on a single read.

## Acceptance hint

A fully-fed build leaf making a cross-cutting change converges to `write_file`
without a re-read sawtooth: it holds a workable set of files in context, evicted
reads leave a usable summary behind (not a bare re-read invitation), and a single
large file is read in bounded chunks rather than all at once.
