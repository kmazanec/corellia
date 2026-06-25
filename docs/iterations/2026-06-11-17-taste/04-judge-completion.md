---
id: F-54
title: critique-doc, critique-ui, intent dial, verdict detail
iteration: 05-taste
type: implement
intent: production
status: shipped
dependsOn: []
contracts: [ADR-022]
---

# Feature: Judge family completion + the intent dial

**After:** critique-doc (defensibility probe: empty-tradeoffs = undecided;
upstream-contract conformance) and critique-ui v1 (judges UI artifacts/
screenshots-by-pointer + design-system pointers; NO browser grant yet —
deferred, noted) registered with critique-family skills (six-dimension
rubric ported at full depth); the **intent dial** wired: judge harnesses
read goal.intent and modulate the bar (spike = answers-the-question;
characterization = fidelity-of-capture; production = mimicry bar) — pinned
by scripted tests showing the same artifact passing as spike and gating as
production; **hard invariant test:** intent NEVER reaches deterministic
checks (lint + test). Verdict prescriptions gain field-level detail (shape
mismatches name missing fields) across knowledge-checks + judges.

Files: critique family module + skills + knowledge-checks detail pass.
No engine, no contract.

## Build plan (approved)
- [x] critique-doc + critique-ui cards/skills/checks + scripted tests.
- [x] Intent dial through judge harness content + invariant tests.
- [x] Field-level verdict detail (knowledge-checks + judge rubric outputs).

## Implementation notes

Built clean; the integration judge caught the iteration's gating find: the '## The intent dial' sections were orphaned by the rubric enricher (judges told to apply bars they never saw — the arbiter's invariants-survive-spike protection lost). Fixed + pinned with real-skill assertions.
