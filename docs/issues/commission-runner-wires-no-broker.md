---
type: issue
title: "commission:run wires a toolless Engine — leaves cannot read or write files"
description: examples/run-commission.ts builds new Engine({registry,brain,store,memory}) with no broker/sandbox, so every leaf has zero tools; the visual-runtime-verification commission stalled with a refusal because the leaf could not read source.
tags: [harness, commission, broker, sandbox, bootstrap, front-door]
timestamp: 2026-06-27
status: open
kind: bug
severity: high
---

# commission:run wires a toolless Engine — leaves cannot read or write files

## Problem
The explicit commission RUN step (`npm run commission:run -- <id>`,
`examples/run-commission.ts`) constructs the engine as:

```ts
const engine = new Engine({ registry, brain, store, memory });
```

with **no `broker` and no `sandbox`**. The broker is what dispatches
`read_file` / `write_file` / `run_script` (and the PR tools) to leaves. With it
absent, every leaf in the tree has **zero tools** — it cannot read the codebase,
cannot write a file, cannot run a script. The real front door used by
`live:self` wires all of this via `buildLiveEngine({ store, sandbox: { repoRoot,
declaredScripts, prBoundary }, knowledge, goldenCapture })`
(`src/daemon/live-engine.ts`, used at `examples/live-self.ts:211`). The example
runner skipped it.

The result: `commission:run` can only ever run trivial,
no-file-access commissions (e.g. `example-word-count`, which returns text). Any
code-writing commission is doomed before the brain makes a decision.

## Evidence
First live run of the `visual-runtime-verification` commission (2026-06-27, at
the now-working $40 per-commission ceiling). Goal tree was a single flat
`deliver-intent` node: **1 pass, 3 failures, 1 repair**, artifact `kind:'text'`,
report PASS / no blockers, total cost **~$0.015**. The text "artifact" was the
leaf explaining — correctly — that it *cannot* deliver:

> "The blocker is environmental, not capability-based. ... I have no file access.
> I cannot read `src/library/acceptance-criteria.ts` or any other file in scope.
> Producing fenced code blocks now would be fabrication, not delivery."

Events: `goal-received → risk-classified → pattern-consulted → decided(satisfy)
→ produced → 4×judge-verdict → repair-applied → emitted`. The repo was left
completely untouched. Output under `out/commission-visual-runtime-verification/`.

## Proposed direction
Make `examples/run-commission.ts` wire the engine the same way the live front
door does: replace the bare `new Engine(...)` with `buildLiveEngine({ store,
sandbox: { repoRoot: doc.repoRoot ?? process.cwd(), declaredScripts? },
goldenCapture: true })`. Carry the commission's `declaredScripts`/`repoRoot`
through to the sandbox so `run_script` works and the existing capability
pre-check is consistent with what actually runs. Decide whether `knowledge`
should be on for deliver runs (live-self leaves it off for deliver).

After the fix, re-run `visual-runtime-verification` and confirm a real subtree
spawns and writes files.

## Acceptance hint
`commission:run` on a code-writing commission gives its leaves real file/script
tools (broker present); a smoke commission that writes one file under its scope
actually writes that file to the worktree. The `visual-runtime-verification`
re-run produces code, not a refusal.

## Related
- [judge-passes-delivery-refusal](judge-passes-delivery-refusal.md) — the second,
  more serious finding from the same run: even toolless, the judge passed a
  refusal-to-deliver as a valid artifact and the report came back PASS. That hole
  is independent of this harness gap.
