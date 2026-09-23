---
type: issue
title: "The daemon declares no scripts, so daemon trees cannot mint behavioral acceptance criteria"
description: buildEngine in daemon.ts wires the live engine with declaredScripts {}, so criteriaWellFormed rejects every { script } criterion and run_script has nothing to run — a daemon-commissioned tree can only assert file existence/anchors, never behavior ("node wc.mjs 'a b c' prints 3"). The commission's own declaredScripts reaches only the listener's pre-check.
tags: [daemon, acceptance-criteria, declared-scripts, milestone-loop, front-door]
timestamp: 2026-09-23
status: open
kind: bug
severity: medium
---

# The daemon declares no scripts

## Problem

`src/daemon/daemon.ts` builds one live engine at boot with
`sandbox.declaredScripts: {}`. Declared scripts are the only way an acceptance
criterion can check *behavior* (`{ script }` — ADR-032), the only thing
`run_script` can run, and the start scripts every capture needs (ADR-042). With
an empty set:

- `criteriaWellFormed` rejects every `{ script }` criterion ("none declared");
- no `{ capture }` can be declared, since captures reference declared scripts;
- so a daemon-commissioned milestone loop converges only against `{ file,
  anchor? }` checks — existence and substrings, never "the CLI prints 3".

A commission CAN carry `declaredScripts` (`BriefInput.declaredScripts`), but the
listener uses it only for the admission pre-check (entry points exist on disk);
it never reaches the engine's sandbox, which is fixed at daemon boot.

## Evidence

Found while diagnosing
[greenfield-criteria-grounding](greenfield-criteria-grounding.md) (iteration 22):
the proof-word-count runs went through the daemon, so their criteria leaf could
only ever have emitted file checks. The live-tail commission (runs 18-22) minted
`{ script }` criteria because it ran through `commission:run`, which declares
scripts.

## Proposed direction

(Rough.) Per-tree declared scripts: thread the commission's `declaredScripts`
(and captures) from the admitted brief into the tree's sandbox assembly, falling
back to a daemon-level default read from the target repo's configuration (e.g.
`CORELLIA_DECLARED_SCRIPTS` or the repo's own manifest). Keep the listener
pre-check as the admission gate for whatever set is chosen.

## Acceptance hint

A daemon-commissioned greenfield intent that declares a `smoke` script freezes a
`{ script: "smoke" }` criterion, and the milestone loop runs it against the
round's worktree.
