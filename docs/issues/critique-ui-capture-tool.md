---
type: issue
title: critique-ui has no built-in capture tool — run_capture is a grant with no implementation
description: The run_capture grant string has no ToolImpl; UI proof works only if the target repo ships its own screenshot script, so critique-ui and the screenshot-judge path are not self-sufficient.
tags: [engine, broker, tool, critique-ui, capture, vision]
timestamp: 2026-07-07
status: open
kind: future-work
severity: medium
---

# critique-ui has no built-in capture tool — run_capture is a grant with no implementation

## Problem
GOAL-TYPES.md gives `critique-ui` "drive browser; screenshot" and `implement`'s
proof includes before/after screenshots for UI surfaces. In code, `run_capture`
exists only as a grant string — there is no ToolImpl behind it; captures delegate
to a repo-declared start/screenshot script (src/engine/capture-runner.ts:120-144).
A product repo that ships no such script (most repos; every greenfield project)
leaves UI goals with no way to produce their own proof artifact, and the ADR-042
visual-verification path has nothing to feed the vision judge.

## Evidence
- capability-scout sweep (2026-07-07): "run_capture is a grant string with NO
  ToolImpl" (src/engine/tools.ts, src/engine/capture-runner.ts:120-144).
- GOAL-TYPES.md judge table (critique-ui grant) and implement proof row.
- Related: vision-needs-wiring.md (the judge call site doesn't set needs.vision).

## Proposed direction
A built-in fallback capture ToolImpl: start the repo's declared serve command (or
a static file server for plain HTML), drive a headless browser to a URL/route,
save a PNG into the worktree's proof area. Playwright is the obvious engine; keep
it an optional dependency resolved at runtime so the factory core stays
dependency-light and the tool is simply not offered when the engine is absent
(same degrade pattern as other env-gated capability). Repo-declared capture
scripts keep precedence — the built-in is the floor, not the override.

## Acceptance hint
Against a fixture repo with a trivial web page and no capture script of its own,
a critique-ui (or implement-with-UI-scope) goal produces a real screenshot proof
artifact via the built-in tool, and the capture-runner tests cover both the
repo-script and built-in paths.
