---
type: adr
title: "ADR-035: OKF doc conformance and finding-routing are factory-enforced rules"
description: A deterministic docs lint hard-fails any docs/ markdown missing a non-empty type (and malformed reserved files), wired into the lint gate; a constitution-level routing rule directs findings to ADR/issue/iteration/log. Structure is enforced; semantics are guided.
tags: [adr, okf, docs, constitution, lint, routing, improve-factory]
timestamp: 2026-06-25T18:30:00-05:00
---

# ADR-035: OKF doc conformance and finding-routing are factory-enforced rules

**Status:** Accepted · **Date:** 2026-06-25 · **Stretch:** no · **Contract:** yes
**Supersedes:** none · **Superseded by:** none

> **Provenance.** This ADR was intended to be authored by the design-first
> `live:self` run (intent `live-self-8ac028ee`) as its second design child (`a2`),
> alongside [ADR-034](ADR-034-issue-and-iteration-records-not-new-goal-types.md).
> That leaf terminally blocked on an empty artifact (see
> [issue: design-arch-empty-artifact-block](../issues/design-arch-empty-artifact-block.md));
> ADR-034 (`a1`) converged and was salvaged. This ADR is the hand-built completion
> of that design, written to ADR-034's own "improve-factory deliverables"
> specification so the design the run set out to produce is whole. Per the
> bootstrap discipline in `CLAUDE.md`, the stuck point was recorded as an issue
> first, then the stuck part hand-built on `main`.

## Context

The issue [factory-okf-discipline](../issues/factory-okf-discipline.md) asks that
the OKF doc model the repo adopted (every doc carries a `type`; reserved
`index.md` / `log.md` carry their OKF meanings; issues are ephemeral, iterations
are dated, ADRs are durable — see [docs/index.md](../index.md)) become a property
the factory **enforces and maintains**, not merely a convention the human and the
harness skills uphold. Without enforcement the bundle rots: a doc lands without a
`type`, an issue without a `severity`, a finding gets written as an ADR where an
issue belonged.

[ADR-034](ADR-034-issue-and-iteration-records-not-new-goal-types.md) already
decided that the *mechanisms* of issue/iteration participation are not new goal
types — they are brokered tools, engine integration steps, and improve-factory
content. This ADR settles the remaining half of `factory-okf-discipline`: the
conformance check and the routing rule. The question is **what is mechanically
enforced versus what is advisory guidance**, and where each lives.

## Decision

OKF doc discipline is enforced in two tiers, both landed as `improve-factory`
content (a factory-repo PR), never as runtime goal-type behavior:

1. **Conformance is mechanically enforced by a deterministic docs lint** wired
   into the same gate as `npm run lint`. It **hard-fails** on missing core
   requirements and **warns** on the rest — matching the OKF spec's own
   permissiveness (reject only on missing core; treat other constraints as soft
   guidance).

2. **Finding-routing is a constitution-level rule that guides, but does not
   mechanically gate.** It is a readable statement of where each kind of finding
   belongs (durable decision → ADR; unplanned work → issue; build narrative →
   iteration record; one-line completed-work summary → log), consulted by any
   goal that reads the constitution. The conformance lint catches *structural*
   defects; the routing rule guides *semantic* placement, which is not
   mechanically decidable without exactly the policy-laden classifier the factory
   declines to own elsewhere (ADR-027, ADR-034).

The split is deliberate: **structure is enforced; semantics are guided.**

## Alternatives Considered

### (A) Mechanically enforce routing too (a "is this finding in the right home?" gate)

**Rejected.** Deciding whether a given finding "should have been an issue rather
than an ADR" is a semantic judgment with no deterministic check — it is the same
generality-classification problem ADR-027 refused to automate ("a bogus
classifier deciding generality is worse than no classifier") and ADR-034 cited
for why issue-filing is model-initiated, not engine policy. A gate that guesses
routing would block correct work on a misclassification more often than it would
catch a real misroute. Routing stays advisory.

### (B) Enforce everything hard (fail on any missing recommended field)

**Rejected.** OKF v0.1 requires exactly one thing of every concept — a non-empty
`type` — and explicitly says consumers should "treat other constraints as soft
guidance and reject bundles only for missing core requirements." Hard-failing on a
missing `description` or `tags` would diverge from the spec and make the lint a
nuisance that ordinary edits trip over. The issue's own acceptance hint says
"enforce `type` hard, treat the rest as warnings." We follow that.

### (C) A runtime goal type that audits the docs bundle

**Rejected** — consistent with ADR-034. A docs-conformance audit shares its
harness with no existing type only superficially; mechanically it is a
deterministic lint over files, which is `improve-factory`/CI content, not a
goal with intent, a tool loop, and an eval. Wrapping a lint in a goal type buys
nothing and inflates the library (the granularity rule's failure mode).

## Rationale

The constitution already lints type *definitions* (grant ceilings, judge
invariants, the iterative-trait invariants) deterministically in CI. Extending
the same principle to *docs* is the natural move: an OKF doc lint is to `docs/`
what the constitution lint is to the type library — a deterministic property the
factory enforces about its own repo, in the same gate. `dangerousGrant` does not
need a goal type to be enforced; neither does "every doc has a `type`."

Routing, by contrast, is irreducibly a judgment. Making it a *statement* in the
constitution (the home of the factory's machine-readable rules) means any goal
that consults the constitution inherits the guidance, and a human reviewer has a
single canonical place to point at — without pretending a classifier can decide
it.

## Tradeoffs & Risks

- **The routing rule is advisory, not enforced.** A goal can still write an ADR
  where an issue belongs; the lint will not catch it (it is structurally a valid
  ADR). This is the intended permissiveness — mechanical routing would be worse
  (alternative A). The backstop is human review and the cheap reversibility of
  the artifacts (an issue is one file; a misfiled ADR can be superseded).

- **Structural conformance ≠ quality.** The lint checks that an issue has
  `kind` / `severity` / `status`, not that its Problem is concrete or its
  Evidence is cited — exactly as ADR-034 noted for the `file_issue` tool. Quality
  is the calling goal's concern; over-engineering a quality eval for a
  side-channel artifact is the granularity inflation the design avoids.

- **Lint drift.** As the OKF spec evolves (it is v0.1), the lint's notion of
  "reserved file structure" may lag. Mitigated by keeping the hard checks minimal
  (`type` present; reserved-filename basic shape) and the rest as warnings, so a
  spec revision rarely turns into a hard CI break.

## Consequences for the Build

- **One new lint** — `scripts/lint-docs.ts` (or an extension of
  `scripts/lint-library.ts`) — wired into the `npm run lint` gate. Hard-fails on:
  any `docs/**/*.md` (non-reserved) missing a non-empty `type`; a reserved
  `index.md` / `log.md` that violates basic OKF structure; an `issues/` doc
  missing `kind` / `severity` / `status`. Warns on missing recommended fields
  (`title`, `description`, `tags`, `timestamp`).
- **One routing-rule statement** in `src/library/constitution.ts` — a
  machine-readable declaration (advisory, like the existing documented
  invariants) of the finding-routing rule, readable by any goal that consults the
  constitution. It is guidance, not a runtime check.
- **No new goal type, no contract change to `GoalTypeDef`.** Both deliverables are
  factory-repo artifacts landed via an `improve-factory` PR. Together with
  ADR-034's brokered `file_issue` tool and engine integration steps, this
  completes the design for making the OKF discipline a property the factory
  enforces, not just follows.
