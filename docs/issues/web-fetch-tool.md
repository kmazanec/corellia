---
type: issue
title: No web-search/web-fetch tool backs the research grants
description: research-external and investigate declare web access in their grants, but no ToolImpl exists for web search or fetch, so external research cannot actually run.
tags: [engine, broker, tool, research, web]
timestamp: 2026-07-07
status: open
kind: bug
severity: high
---

# No web-search/web-fetch tool backs the research grants

## Problem
`research-external` ("web search/fetch; docs") and `investigate` are specified in
GOAL-TYPES.md with web access, and the improvement loop's core skill —
"generalize, don't cache: fetch current docs for the pinned version before writing
client code" — presupposes the factory can fetch. No ToolImpl provides web search
or fetch (src/engine/tools.ts has none; `run_command` has a network *denylist*,
not a research surface). Any goal that needs current library docs, an external
API's shape, or a cited external finding is structurally unable to get them: the
type's contract promises a capability the broker cannot deliver.

## Evidence
- capability-scout sweep (2026-07-07): "MISSING: web search/fetch — no tool backs
  research-external/investigate's web grant" (src/engine/tools.ts).
- GOAL-TYPES.md learn table: `research-external` grant "web search/fetch; docs".
- Related but distinct issues: external-asset-acquisition.md (binary assets into
  the worktree), ground-fact-external-knowledge.md (grounded knowledge artifacts).
  This issue is the missing *tool primitive* both of those would build on.

## Proposed direction
Two broker tools, granted only to the research/diagnose families: `web_fetch(url)`
(GET, size/time-capped, text-extracted, https-only, with a domain allowlist or at
minimum the same denylist discipline as run_command, results carrying the fetched
URL + retrieved-at for citation) and optionally `web_search(query)` behind a
pluggable provider (env-configured; absent key ⇒ tool not offered, so the type
degrades to fetch-only rather than failing). Findings stay
provisional-with-sources per the existing contract; no memory writes from the
tool itself.

## Acceptance hint
A live `research-external` goal answers a question that requires fetching a real
page (e.g. current version + one API fact of a named library), returns a finding
whose claims carry fetched-URL citations, and the broker log shows the fetch ran
under the grant — while a build-family goal attempting `web_fetch` is refused by
the broker.
