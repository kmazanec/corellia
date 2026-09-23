---
type: iteration
title: "Iteration 23 — Per-tree declared scripts: a daemon tree can check behavior"
description: Hand-built fix for daemon-declared-scripts. A commission's declaredScripts and declaredCaptures ride the root goal and layer over the engine's default sandbox for that tree; the daemon's defaults come from CORELLIA_DECLARED_SCRIPTS. The word-count proof target now carries an operator-owned behavioral smoke check.
tags: [iteration, daemon, acceptance-criteria, declared-scripts, milestone-loop, bootstrap]
timestamp: 2026-09-23
status: landed; live proof pending
---

# Iteration 23 — Per-tree declared scripts

## Source

[daemon-declared-scripts](../../issues/daemon-declared-scripts.md), filed by
[iteration 22](../2026-09-23-00-greenfield-criteria-grounding/index.md): the
daemon built its one live engine with `declaredScripts: {}`, so every
daemon-commissioned tree could mint only `{ file, anchor? }` criteria. A
commission's own `declaredScripts` reached only the listener's admission
pre-check, never the sandbox. This sits on the critical path of
[milestone-loop-step-7-prove-live](../../issues/milestone-loop-step-7-prove-live.md):
a step-7 "convergence" against file-existence checks would not prove the loop
delivers behavior. Hand-built per the bootstrap loop; no live model needed.

## What shipped

- **The commission's check vocabulary rides the root goal.** `Goal` gains
  root-only `declaredScripts` / `declaredCaptures`; `CommissionInput` gains
  `declaredCaptures`. The listener threads both onto the root goal it mints.
- **`src/engine/tree-sandbox.ts`** (new): `treeSandboxFor(sandbox, goal)`
  layers the goal's scripts and captures over the engine's default sandbox —
  commission wins a shared name — and validates the merged captures (ADR-042 §7)
  before any worktree opens. `root-runner.ts` resolves the sandbox through it,
  so `run_script`, the per-goal `CheckContext`, `criteriaWellFormed`, and the
  iteration-22 CHECK VOCABULARY block all see the tree's own set. The engine's
  sandbox is never mutated, so one daemon serves many commissions.
- **`src/library/declared-scripts.ts`** (new): shape validation for a
  declared-scripts map from outside the factory — plain-identifier names, one of
  the three runner forms, in-bounds file entries, no shell text. Enforced at the
  listener (authoritative) and the HTTP boundary (422).
- **Daemon defaults.** `CORELLIA_DECLARED_SCRIPTS` (JSON) sets the default set
  every daemon tree gets (`buildDeclaredScripts`, `src/daemon/config.ts`); an
  invalid value refuses the live engine at boot. The daemon passes its repo root
  to the listener so the entry-point pre-check runs for HTTP commissions too.
- **`commission:run` matches the daemon.** Its default trio (test / typecheck /
  lint / code-shape) is the engine default; a commission's scripts layer over it
  instead of replacing it.
- **The step-7 proof target gets a behavioral done-condition.**
  `commissions/example-word-count.ts` declares `smoke` →
  `commissions/checks/word-count-smoke.mjs`, an operator-owned check outside the
  commission's scope that runs the CLI over five cases. The tree can cite
  `{ script: "smoke" }`; it cannot author the check that grades it.

Deliberately not taken: exempting in-scope (not-yet-built) entry points from
the admission pre-check. A tree-authored check is a self-graded check; the
operator-owned check outside scope is the stronger done-condition.

## Verification

Focused tests: `tests/library/declared-scripts.test.ts` (validation, env
parsing), `tests/engine/tree-sandbox.test.ts` (layering, capture validation),
`tests/engine/root-runner-tree-sandbox.test.ts` (a real sandboxed root runs a
commission-declared script through its CheckContext against the worktree;
engine sandbox unchanged), `tests/listener/listener.test.ts` (threading onto
the root goal, listener-root pre-check fallback, escape rejection),
`tests/daemon/config.test.ts`, `tests/daemon/http.test.ts` (422s). Typecheck,
lint, and the full suite run before landing.

## Still open

- **Live proof** (together with iteration 22): commission
  `example-word-count` through the daemon or `commission:run`; success is a
  frozen round-0 checklist that includes `{ script: "smoke" }` and a round that
  passes it.
- The tree's scope excludes `commissions/checks/`. The file tools refuse an
  out-of-scope write, and the root emission gate blocks a tree whose diff
  touches the check. A shell call can still modify it mid-run and sway a
  round's assessment before that gate. Iteration 24 surfaces such an escape
  to the leaf and the log, but does not revert it. See
  [out-of-scope-edit-enforcement](../../issues/out-of-scope-edit-enforcement.md).
