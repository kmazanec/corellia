---
type: issue
title: Knowledge self-validation covers 4/7 categories — credentials among the unchecked
description: design-system, deps, and credentials knowledge artifacts pass through promotion unchecked; the credentials inventory feeds classify_risk, so an unvalidated artifact weakens the risk gate.
tags: [engine, knowledge, verify-on-read, classify-risk, comprehend]
timestamp: 2026-07-07
status: open
kind: bug
severity: medium
---

# Knowledge self-validation covers 4/7 categories — credentials among the unchecked

## Problem
The knowledge artifacts' trust mechanism is per-category self-validation ("spot
queries pass, scaffold runs green, versions match the build" — GOAL-TYPES.md,
map-repo). Only 4 of 7 categories actually validate; design-system, deps, and
credentials pass through promotion unchecked (src/library/knowledge-checks.ts:528-564).
The credentials/secrets inventory is the sharpest edge: it is a named input to
`classify_risk` and the deterministic gate, so an unvalidated (hallucinated or
stale) credentials artifact silently weakens the instance-risk gating that decides
where the human sits.

## Evidence
- capability-scout sweep (2026-07-07): "Knowledge self-validation only 4/7
  categories — design-system/deps/credentials pass through unchecked
  (knowledge-checks.ts:528-564); the credentials inventory feeding classify_risk
  isn't validated."
- DESIGN.md "The knowledge artifacts — typed, fresh, queryable" (credentials:
  vault references only, never values).

## Proposed direction
Add the three missing validators, cheapest-honest per category: deps — parse the
lockfile(s) fresh and diff against the artifact's claims (same machinery the
stack category already uses); credentials — every entry is a reference (pattern
check: no value-shaped strings), each referenced file/env-var location actually
exists at the SHA, and a secret-value scan proves the artifact itself carries
none; design-system — pointer liveness (every token/exemplar pointer resolves at
the SHA). Failure at promotion means the artifact stays provisional/unpromoted,
same as the categories that already validate.

## Acceptance hint
All 7 categories run a real self-validation at promotion; a test feeds each of
the three new validators a deliberately broken artifact (dangling pointer, stale
dep claim, value-shaped credential) and sees it rejected.

---

> **Fixed (2026-07-07, branch `issue/knowledge-hardening`).** The three unchecked
> categories now self-validate at promotion with the same failure semantics as the
> four that already did (a failing artifact stays provisional/unpromoted). The
> `mapRepoCheck` dispatcher's `default` arm — which used to pass design-system /
> deps / credentials through with `ok: true` — is now a total-switch guard that
> returns `ok: false` (unreachable for a well-typed `KnowledgeCategory`, so a
> future category added to the union fails loudly instead of slipping through
> unchecked). All in `src/library/knowledge-checks.ts`, wired into the dispatcher
> and into `categoryCheck` in `src/engine/assembly.ts`.
>
> **deps** (`depsCheck`) — resolves versions FRESH at the SHA, lockfile-first
> (`package-lock.json` v1 resolved versions, falling back to `package.json`
> ranges), mirroring the precedence `retrieval.ts` `stackVersions` uses. It diffs
> the artifact's `version:<name>@<version>` note claims against the resolved set
> with the same range-tolerant comparison `stackCheck` uses. Because it parses the
> lockfile first, it catches a stale claim that satisfies the declared *range* but
> not the *resolved* version — a gap `stackCheck` (package.json-only) cannot see. A
> claim naming a package absent from the resolved set cannot contradict and is
> skipped; no manifest at all is a soft pass.
>
> **credentials** (`credentialsCheck`) — three guarantees: (1) reference-only —
> no pointer note, pointer path, or the summary may carry a value-shaped secret
> (high-signal patterns: provider-prefixed keys, AWS/GitHub/Slack/Google tokens,
> JWTs, PEM private-key blocks, `secret = <value>` assignments); (2) every
> reference resolves at the SHA — a SNAKE_CASE pointer path is treated as an
> env-var reference and must be grounded in the repo's env manifests
> (`.env*` / compose files), any other path must exist on disk; (3) the artifact
> carries no secret value (the same value scan). Env-var names and file paths are
> deliberately NOT flagged as values — distinguishing a reference from a value is
> the check's whole job. This is the sharpest edge: the credentials inventory
> feeds `classify_risk`, so an unvalidated artifact silently weakened the risk
> gate.
>
> **design-system** (`designSystemCheck`) — pointer liveness: every token/exemplar
> pointer must resolve at the SHA (`stat`, so a directory exemplar is legitimate,
> same reasoning as `conventionsCheck`). A dangling pointer means a stale artifact.
>
> **Judgment calls.** (a) The env-var liveness scan is bounded to a fixed set of
> likely env-declaration files (`.env*`, compose manifests) rather than a repo-wide
> grep — cheapest-honest, deterministic across large trees; an env var grounded
> nowhere in those manifests is treated as ungrounded. (b) The secret patterns are
> high-signal by design (provider prefixes, structural shapes) to avoid false
> positives on ordinary reference text; a novel bespoke secret format could slip
> the value scan, but the reference-existence check still bounds hallucinated
> inventory entries. (c) deps reuses the `version:` note convention rather than
> inventing a new claim format, so an artifact can carry both stack and deps claims
> in one vocabulary.
>
> **Tests** (`tests/library/knowledge-checks.test.ts`, 104 pass): each new
> validator gets a deliberately-broken artifact and a clean twin — a stale dep
> claim (incl. the range-satisfies-but-resolved-differs case), a value-shaped
> credential (note / summary / assignment), a dangling file and an ungrounded
> env-var reference, and a dangling design-system pointer — plus wrong-category,
> no-false-positive, and dispatcher-routing cases. Existing knowledge tests stay
> green.
>
> **Gate:** `npx tsc --noEmit` clean; `npm run lint` clean; targeted vitest green
> (`knowledge-checks` 104/104; `knowledge-e2e` + `knowledge-memory` 22/22;
> `tests/library/` + `assembly` 729/729).
