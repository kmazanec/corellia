---
type: adr
title: "ADR-034: file-issue and author-iteration-record do not earn existence as new goal types"
description: The granularity rule denies file-issue and author-iteration-record type status because both share all four harness dimensions with existing author-family types. The mechanisms distribute across brokered scoped writes, engine integration steps, and improve-factory content.
tags: [adr, goal-types, granularity-rule, brokered-tools, engine, okf, issues, iterations]
timestamp: 2026-06-25T18:00:00-05:00
---

# ADR-034: file-issue and author-iteration-record do not earn existence as new goal types

**Status:** Accepted · **Date:** 2026-06-25 · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none

## Context

Three open issues — [factory-manages-issues], [factory-authors-iterations], and
[factory-okf-discipline] — ask the factory to participate natively in its own
OKF doc discipline: file issues when it defers work, create iteration records
when it delivers, delete issues on issue-sourced delivery, and enforce OKF
conformance as a linted property. Each issue's "Proposed direction" floats the
question: *is this a new goal type, or is it an engine step, a brokered
capability, or factory-repo content?*

The granularity rule in GOAL-TYPES.md is the arbiter:

> **A type earns existence exactly when its harness differs materially** —
> tool grant, eval, contract shape, or tier. Two candidates sharing all harness
> dimensions are one type with different specs.

Two candidate types are on the table:

- **`file-issue`** (hypothetical make/author): a goal that reads its context and
  writes a conformant `docs/issues/<slug>.md` when it surfaces deferred work.
- **`author-iteration-record`** (hypothetical make/author): a goal that creates
  `docs/iterations/YYYY-MM-DD-HH-slug/index.md`, appends to the iterations
  catalog, and writes a `docs/log.md` line on delivery.

The question is whether the granularity rule grants either one existence as a
distinct goal type, or whether the mechanisms they imply belong elsewhere in the
factory's architecture — brokered tools, engine integration steps, or
improve-factory deliverables.

[factory-manages-issues]: ../issues/factory-manages-issues.md
[factory-authors-iterations]: ../issues/factory-authors-iterations.md
[factory-okf-discipline]: ../issues/factory-okf-discipline.md

## Decision

Neither `file-issue` nor `author-iteration-record` earns existence as a new
goal type. Under the granularity rule, both share all four harness dimensions
(grant, eval, contract shape, tier) with existing author-family members, so
each is "one type with a different spec" — and the spec in both cases is not a
goal-type spec at all but a mechanism spec for a different architectural layer.

The mechanisms distribute across three layers:

1. **Issue filing is a brokered scoped write capability** — a new brokered tool
   (`file_issue`) available to any goal whose grant includes it, scoped to
   `docs/issues/`, analogous to `push_branch` / `open_pr` (ADR-025).
2. **Issue deletion and iteration-record creation are engine integration
   steps** — deterministic post-delivery mechanics in the `deliver-intent`
   lifecycle, alongside cherry-pick and PR emission, not delegated goals.
3. **OKF conformance lint and routing rule are improve-factory content** — a
   factory-repo script + a constitution-level rule, landed via an
   `improve-factory` PR, not a runtime goal-type behavior.

## Alternatives Considered

### (A) New make/author goal types: `file-issue` and `author-iteration-record`

**Explored.** Each candidate would get its own `GoalTypeDef` — grant, eval,
contract shape, tier, family membership. `file-issue` would be a
`make`/`author` leaf: input is a finding/blocker context, output is a
conformant issue file, grant is doc read/write + retrieval API, eval is a
deterministic OKF-frontmatter check (no judge), tier is sonnet.
`author-iteration-record` would be a `make`/`author` leaf: input is a delivery
report + iteration slug, output is an iteration dir + catalog row + log line,
grant is doc read/write + retrieval API, eval is deterministic OKF-frontmatter
check, tier is sonnet.

**Rejected under the granularity rule.** The rule's test is whether the
candidate's harness *differs materially* from every existing type. Mapping the
four dimensions:

| Dimension | `file-issue` | Closest existing type | Match? |
|---|---|---|---|
| grant | doc read/write + retrieval API | `write-prd` | identical |
| eval | deterministic conformance check, no judge | `author-acceptance-criteria` | identical |
| contract shape | leaf, artifact-emitting (two-phase, ADR-023) | `write-prd` / `author-acceptance-criteria` | identical |
| tier | sonnet | `write-prd` | identical |

| Dimension | `author-iteration-record` | Closest existing type | Match? |
|---|---|---|---|
| grant | doc read/write + retrieval API | `write-prd` | identical |
| eval | deterministic OKF-frontmatter check, no judge | `author-acceptance-criteria` | identical |
| contract shape | leaf, artifact-emitting | `write-prd` | identical |
| tier | sonnet | `write-prd` | identical |

Both candidates share all four harness dimensions with existing author-family
types. The rule's verdict is unambiguous: "two candidates sharing all harness
dimensions are one type with different specs." A type that shares its grant,
eval, contract shape, and tier with `write-prd` is `write-prd` with a different
spec — but `write-prd`'s spec is "produce a numbered, behavior-focused PRD," not
"produce an issue file." The spec difference does not arise from a *harness*
difference; it arises from a *content* difference, and content differences are
exactly what the granularity rule refuses to promote to type status. The rule
exists to prevent the library from speciating on output format rather than on
harness mechanics.

The constitution lints reinforce this: a new `make`/`author` type with
`fs.read` + `fs.write` + `retrieval.api` grants passes every lint trivially
(no dangerous grants, no memory writes, no judge-kind violations) — the lints
cannot distinguish it from `write-prd` because structurally it *is* `write-prd`.
A type the constitution cannot distinguish from an existing type is not a new
type; it is a redundancy the lints cannot catch but the granularity rule exists
to prevent.

### (B) Engine integration steps in `deliver-intent` for both issue filing and iteration records

**Explored.** The `deliver-intent` output contract already says "integrated
product increment as PR(s) + typed completion report." The engine already
performs integration mechanics — cherry-pick, PR emission (ADR-025), per-round
commits (ADR-032) — that are not delegated to child goals but executed by the
engine around the goal tree. Issue filing and iteration-record creation could
join this set: on delivery, the engine creates the iteration record, writes the
log line, and deletes the originating issue.

**Partially accepted.** Issue *deletion* and iteration-record *creation* are
lifecycle actions tied to the delivery moment — they fire exactly once, on
successful delivery, and their correctness is a property of the delivery, not of
a child goal's judgment. These are engine integration steps. But issue *filing*
is not a delivery-lifecycle action: it happens *during* a run, when any goal at
any depth surfaces deferred work — not just at the `deliver-intent` root, and
not just on delivery. Making issue filing an engine step would require the
engine to intercept every goal's report for deferred-work findings and file
issues on its behalf, which is exactly the kind of policy-laden routing the
engine should not own (ADR-027's rationale: "a bogus classifier deciding
generality is worse than no classifier" — the same applies to deciding whether
a finding is "deferred work worth an issue"). Issue filing must be a capability
the goal itself invokes, not an engine policy.

### (C) Brokered scoped write capabilities for issue filing, engine steps for lifecycle actions

**Accepted for issue filing; engine steps accepted for lifecycle.** A brokered
write capability scoped to `docs/issues/` mirrors the established ADR-025
pattern: `push_branch` and `open_pr` are brokered tools behind
`repo.branch` / `repo.pr` grants, executed in the engine process, available to
any goal whose type grants them. A `file_issue` tool behind a `docs.issues.write`
grant follows the same architecture: the model decides *when* to file an issue
and supplies the content; the broker enforces scope (`docs/issues/` only) and
records the event. No new goal type is needed — the capability is available to
any existing type that surfaces deferred work, most naturally `investigate`,
`deliver-intent` (via its report), or any `make` goal that hits an
out-of-scope blocker.

Issue deletion and iteration-record creation are not brokered tools because
they are not model-initiated: they fire deterministically on successful
delivery, with no model judgment involved. They are engine integration steps in
the `deliver-intent` lifecycle.

### (D) improve-factory content for OKF conformance lint and routing rule

**Accepted.** The OKF conformance check (every `docs/**/*.md` has a non-empty
`type`; reserved `index.md` / `log.md` structure is intact; issues carry
`kind` / `severity` / `status`) is a deterministic lint — factory-repo code
that runs in the same gate as `npm run lint`. The routing rule (durable design
decision → ADR; unplanned work → issue; build narrative → iteration record;
one-line completed-work summary → log) is a constitution-level statement that
guides the model's behavior without runtime enforcement. Both are
factory-repo artifacts landed via an `improve-factory` PR, not runtime
goal-type behavior. The constitution lint in `src/library/constitution.ts` is
the right home for the routing rule as a checkable statement; the lint script
extends `scripts/lint-library.ts` or a sibling `scripts/lint-docs.ts`.

This is consistent with the existing architecture: the constitution lints
type *definitions* (grant ceilings, judge invariants, iterative-trait
invariants); an OKF doc lint extends the same principle to *docs*, in the same
CI gate. It is not a goal type — it is a property the factory enforces about
its own repo, the same way `dangerousGrant` is.

## Rationale

The granularity rule is the keystone. Its purpose is to prevent the goal-type
library from speciating on *what a goal produces* rather than on *how a goal is
harnessed*. A goal that writes an issue file and a goal that writes a PRD are
harnessed identically: same tools (doc read/write + retrieval), same eval shape
(deterministic conformance, no judge), same contract (leaf, artifact-emitting),
same tier (sonnet). The rule says: that is one type. The library already has
that type — `write-prd` — and `write-prd`'s spec is about PRDs, not issues. But
the *mechanism* for filing an issue is not "run `write-prd` with a different
prompt"; it is "call a brokered write tool scoped to `docs/issues/` from
whatever goal surfaced the deferred work." The mechanism's home is the tool
layer, not the type layer.

The lifecycle actions (delete issue, create iteration record) are even clearer:
they are not goal-shaped at all. A goal takes intent and produces an artifact
through a tool loop with eval. Issue deletion takes a delivery result and
performs a deterministic filesystem action — no intent to parse, no tool loop,
no eval, no judge. Wrapping it in a goal type would give it a grant, an eval,
and a tier it does not need, all identical to existing types, purely to satisfy
the type-definition schema. That is the granularity rule's exact failure mode:
inflating the type library with structural duplicates whose only difference is
the spec they carry.

The ADR-025 precedent is dispositive for the brokered tool. `push_branch` and
`open_pr` are not goal types; they are brokered tools behind grants, executed
in the engine process, available to `open-pr` (and `improve-factory`). Issue
filing is structurally identical: a scoped write the model initiates, the broker
enforces. The only difference is the scope (`docs/issues/` vs the git remote),
and scope is already the runtime narrowing dimension (ADR-013: "the only
runtime narrowing is scope").

## Tradeoffs & Risks

- **Issue-filing quality depends on the calling goal, not a dedicated type.**
  Without a `file-issue` type, there is no dedicated eval that checks whether
  an issue's Problem/Evidence/Acceptance-hint are substantive. The OKF
  conformance lint checks *structure* (frontmatter present, fields non-empty)
  but not *quality* (is the problem concrete? is the evidence cited?). This is
  accepted: the calling goal (e.g., `investigate`, `deliver-intent`) already
  carries quality evals for its primary output; the issue is a side-channel
  artifact, and over-engineering a dedicated quality eval for a side-channel
  output is exactly the granularity inflation the rule prevents. If traces show
  factory-filed issues are consistently low-quality, the improvement loop can
  propose a `file-issue` type with evidence — the rule is data-driven, not
  decree.

- **Engine integration steps are not independently testable as goal types.**
  Issue deletion and iteration-record creation live in the engine's delivery
  path, tested via integration tests rather than via the goal-type eval
  harness. This is the same posture as cherry-pick and PR emission: they are
  engine mechanics, not goal outputs, and they are tested as engine mechanics.

- **The routing rule is advisory, not mechanically enforced.** The
  constitution-level routing rule guides the model ("durable design decision →
  ADR; unplanned work → issue") but does not *prevent* a goal from writing an
  ADR where an issue belongs. The OKF conformance lint catches structural
  violations (missing `type`, malformed reserved files) but not semantic
  misrouting. This is the intended permissiveness (the issue's own acceptance
  hint says "enforce `type` hard, treat the rest as warnings").

- **Blast radius of the `file_issue` tool is bounded by scope, not by a type
  ceiling.** A goal granted `docs.issues.write` can write any file under
  `docs/issues/`. The broker's scope check enforces the path constraint; the
  dangerous-grant lint does not fire (no `merge|approve|deploy|spend` match).
  The risk is that a model files a misleading or duplicate issue — low blast
  radius (issues are ephemeral backlog items, not code), and the OKF
  conformance lint catches structural defects. No credential or irreversible
  external action is involved, unlike `open_pr`.

## Consequences for the Build

- **No new goal types.** `GOAL-TYPES.md` is unchanged. The author family
  remains `write-prd`, `author-acceptance-criteria`, `design-arch`. The
  deliberately-deferred list is unchanged.
- **One new brokered tool** (`file_issue`) + one new grant (`docs.issues.write`)
  in `GRANT_TOOL_MAP` (`src/contract/tool.ts`). The tool's `ToolImpl` is
  registered in assembly; the broker enforces scope to `docs/issues/`.
- **Two new engine integration steps** in the `deliver-intent` lifecycle:
  iteration-record creation (on any successful delivery) and issue deletion (on
  issue-sourced delivery only). These are engine code, not goal-type code.
- **One new lint script** (`scripts/lint-docs.ts` or extension of
  `scripts/lint-library.ts`) + one routing-rule statement in
  `src/library/constitution.ts`, landed via an `improve-factory` PR.
- **One issue-to-commission parsing path**: a reader that parses an OKF issue
  file into the seed of a `CommissionInput`, available to the commission front
  door. This is engine/listener code, not a goal type.

## Security and Non-Functional Rounds

**Blast radius.** The `file_issue` tool writes to `docs/issues/` only —
ephemeral backlog markdown, not code, not credentials, not the product repo.
The broker's scope check enforces the path prefix; a goal cannot use it to
write outside `docs/issues/`. Issue deletion is irreversible (file removal) but
fires only on verified successful delivery of an issue-sourced commission,
gated by provenance (`// from docs/issues/<slug>.md` in the commission
artifact). Iteration-record creation writes to `docs/iterations/` and
`docs/log.md` — append-only, idempotent, no overwrite of existing entries. None
of these mechanisms touch credentials, the git remote, or the product worktree
beyond the factory repo's own `docs/` tree.

**Latency and throughput.** All four mechanisms are filesystem operations
(mkdir, write, delete, append) within the factory repo. No network calls, no
LLM invocations, no script executions. Cost is negligible relative to the
LLM-driven goal work that surrounds them. The `file_issue` tool adds one tool
call to the calling goal's step loop; the engine integration steps add
constant-time filesystem ops to the delivery path. No throughput concern.

## Contract-Level Specifications

Each mechanism is specified at the contract level — input, output, grants,
eval, tier, leaf_only, scope — without implementation. Mechanisms (a) and (d)
are brokered-tool / engine touch-points; mechanism (b) and (c) are engine
integration steps; the OKF lint and routing rule are improve-factory
deliverables.

### (a) Brokered issue-filing write capability

**Classification:** brokered tool (engine touch-point), not a goal type.

| Field | Value |
|---|---|
| **input** | `{ slug: string, title: string, description: string, problem: string, evidence: string, proposedDirection: string, acceptanceHint: string, kind: "bug" \| "idea" \| "future-work", severity: "high" \| "medium" \| "low", tags: string[] }` |
| **output** | `ToolResult` — `{ ok: true, output: "docs/issues/<slug>.md" }` on success; `{ ok: false, output: "<reason>" }` on scope violation, duplicate slug, or malformed frontmatter |
| **grants** | `docs.issues.write` — a new grant in `GRANT_TOOL_MAP` (`src/contract/tool.ts`). Available to any goal type whose `grants` array includes it. Initially granted to `investigate` and `deliver-intent` (the types most likely to surface deferred work); extensible to others by improvement PR. |
| **eval** | deterministic: the tool validates OKF frontmatter (required fields present and non-empty: `type`, `title`, `description`, `tags`, `timestamp`, `status`, `kind`, `severity`) before writing; refuses if a file at the slug path already exists (no silent overwrite). No judge. |
| **tier** | N/A — the tool is not a goal; it executes in the engine process at the calling goal's tier. |
| **leaf_only** | N/A — the tool is available to any goal, leaf or non-leaf. |
| **scope constraints** | write path must match `docs/issues/<slug>.md`; the broker's scope check enforces the `docs/issues/` prefix. The tool also updates `docs/issues/index.md` (append a catalog row) — this is within the same scope prefix. |

### (b) Engine integration step: iteration-record creation and catalog/log maintenance

**Classification:** engine integration step (engine touch-point), not a goal type.

| Field | Value |
|---|---|
| **input** | the delivery `Report` (goal title, intent slug, ADRs produced, commit SHAs) + the tree's worktree root + the current timestamp |
| **output** | `docs/iterations/YYYY-MM-DD-HH-<slug>/index.md` (OKF `type: iteration`, with run evidence folded in); a new row appended to `docs/iterations/index.md`; a new line appended to `docs/log.md` referencing the iteration and any ADRs |
| **grants** | none — this is engine code, not a brokered tool. The engine has direct filesystem access to the factory repo's `docs/` tree (it already writes `collectTree` commits and PRs). No model invocation; no `GoalTypeDef` involved. |
| **eval** | deterministic: the step asserts (1) the iteration dir was created with a conformant `index.md` (OKF `type: iteration` frontmatter present), (2) the catalog row was appended (idempotent — refuses to duplicate an existing row for the same slug), (3) the log line was appended (idempotent — refuses to duplicate). If any assertion fails, the delivery report carries a warning but the delivery itself is not reversed (the PR is the deliverable; the iteration record is bookkeeping). |
| **tier** | N/A — engine code, no model invocation. |
| **leaf_only** | N/A — engine lifecycle step, not a goal. |
| **scope constraints** | writes to `docs/iterations/<slug>/index.md`, `docs/iterations/index.md`, and `docs/log.md` only. All writes are append-only and idempotent. The slug is derived from the delivery's intent title (kebab-cased) + timestamp (hour granularity). |

### (c) Engine integration step: issue deletion on issue-sourced delivery

**Classification:** engine integration step (engine touch-point), not a goal type.

| Field | Value |
|---|---|
| **input** | the delivery `Report` + the commission artifact's source-issue annotation (`// from docs/issues/<slug>.md`, parsed from the commission file) |
| **output** | deletion of `docs/issues/<slug>.md` + removal of its row from `docs/issues/index.md` |
| **grants** | none — engine code, direct filesystem access. |
| **eval** | deterministic pre-conditions, all must hold or the step is a no-op: (1) the commission artifact contains a `// from docs/issues/<slug>.md` annotation (provenance), (2) the delivery report is not a partial/blocked delivery (issue deletion fires only on successful delivery — DONE or the PR was opened green), (3) the issue file exists at the annotated path. If any pre-condition fails, the step logs a warning and does nothing — it never deletes a file it cannot prove is the source issue. Post-deletion: assert the file is gone and the catalog row is removed; if the catalog update fails, log a warning (the file deletion is the authoritative close; a stale catalog row is a lint-caught inconsistency, not a delivery failure). |
| **tier** | N/A — engine code, no model invocation. |
| **leaf_only** | N/A — engine lifecycle step, not a goal. |
| **scope constraints** | deletes only the file at the provenance-annotated path under `docs/issues/`. Cannot delete arbitrary files — the path comes from the commission artifact's own annotation, not from model input. |

### (d) Issue-to-commission parsing path

**Classification:** engine/listener code (engine touch-point), not a goal type. This is the in-code equivalent of the `commission` skill's "from an existing issue" mode (`CLAUDE.md` / `.claude/skills/commission/SKILL.md`), callable by the listener when an issue-sourced commission is admitted.

| Field | Value |
|---|---|
| **input** | a `docs/issues/<slug>.md` file path (OKF `type: issue` with frontmatter + Problem / Evidence / Proposed direction / Acceptance hint sections) |
| **output** | a partial `CommissionInput` seed: `title` from the issue's `title` frontmatter; `spec.description` from the issue's Problem + Proposed direction sections; `spec.constraints` seeded from the Acceptance hint; `scope` left empty (the commission front door interviews for scope — the issue does not own it); `id` derived from the slug; `budget` left to the front door to size. The annotation `// from docs/issues/<slug>.md` is set on the commission artifact so mechanism (c) can close the loop. |
| **grants** | none — this is listener/engine code that reads a file and produces a typed object. It runs in the listener process (ADR-026), not in a goal's tool loop. |
| **eval** | deterministic: the parser validates that the file has OKF `type: issue` frontmatter with the required fields (`title`, `kind`, `severity`, `status`) before producing the seed. If the file is malformed, the commission is rejected at receive with zero subtree spend (same posture as `declaredScripts` capability-check failure). |
| **tier** | N/A — listener/engine code, no model invocation. |
| **leaf_only** | N/A — listener path, not a goal. |
| **scope constraints** | reads from `docs/issues/` only; produces a `CommissionInput` seed that the front door's interview completes. Does not itself commission — the listener calls `listener.commission(input)` with the completed seed, same as any other commission path. |

### Improve-factory deliverables (not engine touch-points)

The following are factory-repo artifacts landed via an `improve-factory` PR.
They are not runtime mechanisms and do not have goal-type contract fields.

1. **OKF conformance lint** (`scripts/lint-docs.ts` or extension of `scripts/lint-library.ts`):
   - Input: the `docs/` tree.
   - Output: a list of violations (missing `type` on any `docs/**/*.md`; reserved `index.md` / `log.md` structural violations; issues missing `kind` / `severity` / `status`).
   - Wired into the `npm run lint` gate alongside the existing constitution lints.
   - Enforcement: hard-fail on missing core fields (`type`); warning on optional fields (matching the issue's stated permissiveness).

2. **Routing rule statement** in `src/library/constitution.ts`:
   - A machine-readable statement of the finding-routing rule: durable design decision → ADR; unplanned/undone work → issue; how-the-build-unfolded → iteration record; one-line completed-work summary → log.
   - This is a declaration (advisory, like the existing comment-documented invariants), not a runtime check — it guides the model's behavior and is readable by any goal that consults the constitution.
   - The OKF conformance lint is the structural enforcement; the routing rule is the semantic guidance. Together they make the doc discipline a property the factory enforces, not just follows.
