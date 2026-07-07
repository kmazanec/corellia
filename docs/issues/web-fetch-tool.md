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

---

> **Fixed (2026-07-07, branch `issue/web-fetch`; pending live proof).** The
> research grants now have a tool primitive behind them. `web_fetch(url)` is a
> broker-mediated ToolImpl: an https-only GET, size-capped (2MB), time-capped
> (20s via AbortController), redirect-limited (5 hops, each hop's host re-vetted),
> that extracts readable text from HTML, passes text/JSON/XML through, refuses
> binaries (external-asset-acquisition's job), and returns a citation header
> carrying the final URL + retrievedAt so a finding's claims carry sources. Its
> tool description instructs the model on that citation discipline. `web_search(query)`
> is behind a pluggable, env-configured provider (`WEB_SEARCH_URL`, a generic
> `{query}` JSON-endpoint template); when no provider is configured the tool is
> simply not registered, so a research goal degrades to fetch-only rather than
> erroring.
>
> **SSRF hygiene** mirrors run_command's "no network to the inside" floor: the
> target host is refused if it is loopback, an RFC-1918 private range, link-local
> (incl. the 169.254.169.254 cloud-metadata endpoint), CGNAT, unspecified, or the
> IPv6 equivalents (ULA, v4-mapped) — checked both as a URL IP-literal AND after
> DNS resolution (every A/AAAA record), closing the DNS-rebind hole. A redirect
> cannot pivot inward: each hop is re-vetted. `WEB_FETCH_BLOCK_HOSTS` lets an
> operator ADD refusals; it can never open a hole in the private-network floor.
>
> **Grant wiring:** `GRANT_TOOL_MAP` maps `web_fetch → web.fetch` and
> `web_search → web.search`. Only `research-external` holds those grants in the
> starter library (`investigate` gets web access by spawning `research-external`
> children, not directly — its grants are unchanged). The tools are registered in
> both the sandboxed broker (for `research-external` leaves spawned under
> `investigate`) AND the read-only learn broker (for `research-external` as a
> root); the broker's grant check — not registration — is what confines the
> capability, so a build-family goal calling `web_fetch` is refused before any
> request. The constitution lint is unaffected (`web.fetch`/`web.search` trip no
> ceiling) and still passes.
>
> **Judgment calls (owned per the task):**
> 1. *Registered broadly, confined by grant.* The web tools are registered in
>    every broker rather than gated by a per-type registration flag, because the
>    broker's exact-grant check is the real boundary (the same posture as
>    `file_issue`). Registering them where an ungranted type can see them does not
>    grant them — proven by the broker refusal test.
> 2. *`investigate` grants left unchanged.* GOAL-TYPES.md gives `investigate` only
>    `spawn` for its probes; it reaches the web through `research-external`
>    children, not a direct grant. I did not add `web.fetch` to `investigate` —
>    that would contradict its contract.
> 3. *web_search shipped, but provider-gated.* A clean zero-dependency path exists
>    (a generic JSON `SEARCH_URL` template over the same fetch path), so
>    `web_search` is included — but only offered when configured, degrading to
>    fetch-only otherwise, exactly as the issue's "absent key ⇒ tool not offered"
>    direction requires.
> 4. *Redirects followed manually.* `redirect: 'manual'` so each hop's host is
>    re-resolved and re-vetted; the platform's automatic redirect following would
>    bypass the per-hop SSRF check.
>
> **Mechanism:** `src/engine/web-tools.ts` (transport, caps, redirect-following
> `performFetch`, the two ToolImpl factories, `webTools()` registration helper),
> `src/engine/web-security.ts` (SSRF denylist, host resolver, URL vetting),
> `src/engine/web-extract.ts` (content-type classification + HTML→text).
> Grant map in `src/contract/tool.ts`; assembly wiring in `src/engine/assembly.ts`
> (both `openSandboxAssembly` and `openLearnAssembly`). Unit-proven with an
> injected transport + host resolver (never the live network) in
> `tests/engine/web-tools.test.ts` (30 tests: happy path, caps, https-only, SSRF
> refusals incl. DNS-resolved-private and redirect-into-private, binary refusal,
> extraction, search gating) and `tests/engine/web-tools-broker.test.ts` (grant
> refusal for build types, grant success for research-external); assembly
> registration proven in `tests/engine/assembly.test.ts`. A live `research-external`
> run fetching a real page and citing it is the confirming proof.
