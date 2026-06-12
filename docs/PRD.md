# Corellia — Product Requirements Document

**Status:** locked · **Date:** 2026-06-10
**Sources:** [OUTLINE.md](../OUTLINE.md) (original requirements) · [DESIGN.md](../DESIGN.md)
(the locked domain architecture this PRD's behaviors trace to)

This PRD owns WHAT and WHY. The HOW lives in DESIGN.md (domain architecture,
locked) and docs/adrs/ (implementation decisions). It was written after
iterations 1–2 shipped — it describes the whole v1 product, including what
already exists; ROADMAP.md tracks what remains.

## 1. Problem Statement

Building software with AI agents today forces a bad choice: spend frontier-model
context on every step of every task (expensive, unscalable), or hard-code rigid
pipelines that cannot adapt to novel work (brittle, capped). Neither covers the
full product-development process — research, requirements, design,
implementation, review — and neither works safely on existing codebases the
agent didn't write. Corellia is a software factory: one recursive operation over
typed goals, where well-specified work runs on cheap models, humans appear only
at three named gaps, every action is an auditable event, and the output is
always a reviewable pull request.

## 2. Users & Stakeholders

- **The operator (v1: a single person).** Wears every human hat: commissions
  intents, answers decision briefs, triages non-commissioned findings, signs off
  pattern trust, reviews and merges PRs, and maintains the factory repo. All
  human surfaces target this one person at a terminal; team routing (ownership
  maps, per-person notification) is out of scope for v1.
- **Target-repo owners.** The people whose codebases receive factory PRs. In v1
  this is the operator again, but the factory's output discipline (PR-only,
  proof artifacts, process-clean diffs) is designed so a target repo never needs
  to know or care that a factory produced the change.

## 3. Desired Outcome

V1 succeeds when **both** of the following have happened, end to end, mostly
autonomously:

1. **Self-hosting:** a feature of Corellia itself ships via a Corellia-opened
   PR that the operator reviews and merges.
2. **Foreign brownfield:** a feature ships the same way on a repo the factory
   did not write.

Secondary measures of success: trees complete within their budgets; the
operator is interrupted only at the three named gaps (competence, authority,
physical); every run is reconstructable from the event log after the fact.

## 4. Scope

### In Scope

1. The recursive engine: typed goals, satisfy/split/block, dependency-ordered
   children, contract-children-first, DAG-parallel execution.
2. The three evals (split / goal-type / integration), the split gate, and the
   control loop: repair → tier escalation → block/human.
3. Four-dimension budgets (attempts, tokens, tool calls, wall clock) inherited
   and subdivided, plus a dollar-denominated spend ceiling per tree.
4. The event log as substrate, with memory, trace stats, and run views as
   projections.
5. Layered memory (project × type × global), spawner-mediated, with
   provenance labels, promotion, decay, and use/mention discipline.
6. The structure flywheel: split memos, provisional/trusted promotion with
   human-only trust signoff, and the lens-diverse terraced scan.
7. Risk and authority gates: computed instance risk, fail-safe denial,
   constitution lints.
8. The listener: scope-disjoint admission, park/TTL, answer/resume.
9. **Tool-using leaf execution** in sandboxed checkouts: granted tools only,
   real tool-call debiting, deterministic checks that actually execute.
10. **Brownfield comprehension**: JIT comprehension goals, typed knowledge
    artifacts with freshness metadata, a typed retrieval API, verify-on-read.
11. The full goal-type library (19 starter types) with per-type harness
    content, plus golden-set capture from live runs.
12. PR-only output with proof artifacts and a `learned` note; the factory never
    merges its own work.
13. Improvement loop v1: blocker reports become factory-repo PRs for human
    review.
14. Target repos qualify **via their own declared scripts** (test, build,
    check entry points) — the factory drives a repo only through commands the
    repo itself declares; no per-language adapters.
15. **Hosted single-operator operation** *(amended 2026-06-12, iteration 06
    gate brief)*: a daemonized listener front door with webhook-style
    ingress, container-packaged; a REPL for local development.

### Out of Scope

1. Team surfaces: ownership maps, multi-reviewer routing, Slack/issue-comment
   notification (the operator works at a terminal).
2. Multi-tenant operation; the factory serves a single operator. *(Amended
   2026-06-12: hosted single-operator containerized deployment moved in
   scope — see In Scope 15. Originally: "Hosted/multi-tenant operation; the
   factory runs on the operator's machine.")*
3. Web UI dashboards (terminal projections of the event log suffice).
4. Factory-factory recursion and token-efficiency self-improvement (deferred
   by design; see DESIGN.md).
5. Dangerous tool grants: spend, deploy, infrastructure management, key
   creation, purchases, software installation.
6. Live co-editing with humans; non-git workflows.

### Deferred

1. Per-language tool adapters richer than repo-declared scripts (deferred until
   a target repo demands one).
2. Adapter-minted root goals from external signals (monitors, tickets) beyond a
   simple watched channel — the seam is specified, built later.
3. Semantic relevance retrieval for memory (substring/keyed retrieval first).
4. Full golden-set replay tooling (capture is in scope; replay harness rides
   along when judge calibration starts paying).

## 5. Requirements

Behavior-focused, technology-agnostic. Each is independently verifiable;
DESIGN.md is the authority on mechanism.

**R1 — Typed goals only.** All work enters as a typed goal with an I/O
contract; free text is parsed once at the root. Ambiguity blocks with a
decision brief; the factory never invents intent.

**R2 — One recursive operation.** Every node receives a goal, decides
satisfy/split/block, integrates children, and emits a typed report carrying
artifact + proof, lessons, memories used, blockers, and findings.

**R3 — Evals at every edge.** A split gate before decomposition; a split eval
on decomposition quality; deterministic goal-type checks at leaves; an
integration eval at the parent. Deterministic checks always run before judges.

**R4 — The control loop.** Failed evals trigger repair (judge prescribes,
cheap tier applies, same attempt), then tier escalation carrying the prior
failure, then block. Isomorphic repeat failures exit the ladder early.

**R5 — Budgets bound everything.** Every goal carries
{attempts, tokens, tool calls, wall clock} subdivided from its parent, plus a
per-tree spend ceiling (learning-phase default **$15**, operator-configurable).
Spend is measured from provider-reported usage, never estimated. Exhaustion is
an event that summons the operator — never a hang, never a silent overrun.

**R6 — Humans at three gaps only.** Competence (exhaustion/block), authority
(consequences outrun any eval — type or instance), physical. Every touchpoint
is a typed decision brief with a deadline and a declared `on_timeout`; parking
releases scope immediately and carries a TTL.

**R7 — Governed memory.** Three layers (project/type/global), spawner-mediated
injection as provenance-labeled pointers, eval-gated promotion, verify-on-read
for facts, version/pin semantics for structure, human-only trust promotion.

**R8 — Everything is an event.** One append-only log; memory, metrics, and
human views are projections; any past state is reconstructable.

**R9 — The contract is the capability.** Goals use only the tools their type
grants; ungranted calls are refused at runtime and recorded. Leaf execution
happens in an isolated checkout; a leaf's diff must lie within its declared
scope or it cannot emit.

**R10 — Checks execute.** A goal-type eval on code artifacts runs the target
repo's own declared commands and gates on their real exit status — never on
inspection of the artifact text alone.

**R11 — Brownfield by JIT comprehension.** Missing knowledge spawns
comprehension goals as dependencies (no bootstrap ceremony); knowledge
artifacts carry freshness metadata and self-validate on read; the regression
guard (existing checks + coverage signal + characterization where thin) blocks
emission on out-of-scope breakage unless the intent includes it.

**R12 — Stack-agnostic via repo scripts.** A target repo qualifies if it
declares conventional entry points (test/build/check commands); the capability
check verifies their presence at receive and bounces unqualified repos with a
stated reason before any subtree spend.

**R13 — PR-only output.** The boundary artifact is a pull request carrying the
diff, proof artifacts, and a `learned` note; diffs are process-clean (no
factory language); the factory never self-merges.

**R14 — The improvement loop terminates at a PR.** Factory friction becomes
blocker reports → improvement goals → human-reviewed factory-repo PRs.
Versioned behavior changes only by PR; the architecture is locked.

**R15 — Solo-operator surfaces.** All briefs, triage queues, and signoff
ceremonies are operable by one person at a terminal.

## 6. Acceptance Criteria

Near-executable; each maps onto a test or a checkable run observation.

**AC-1.** Given a commissioned intent on a qualifying repo, when its tree
completes successfully, then a PR exists on that repo containing the diff, the
goal-type's proof artifacts, and a `learned` note of 2–4 plain sentences — and
the factory has not merged it.

**AC-2 (v1 success, half 1).** Given Corellia's own repo as the target, when a
commissioned feature intent completes, then the resulting PR's checks run green
and the operator can merge it unmodified.

**AC-3 (v1 success, half 2).** AC-1 holds on a repo the factory did not
author.

**AC-4.** Given an intent whose parse leaves a material ambiguity, when the
root receives it, then a decision brief
({question, options, links, deadline}) is emitted and no subtree is spawned
until it resolves.

**AC-5.** Given a target repo missing its declared entry-point scripts, when
commissioned, then the intent bounces at receive with a stated reason and zero
subtree spend.

**AC-6.** Given a leaf whose actual diff includes a file outside its declared
scope, when it attempts to emit, then emission is refused and a
scope-insufficiency report returns to the parent, consuming an attempt.

**AC-7.** Given a goal whose type does not grant a tool, when the goal
attempts that tool call, then the call is refused, the refusal is recorded as
an event, and the goal's work continues (refusal is not a crash).

**AC-8.** Given an `implement` leaf on a qualifying repo, when its goal-type
eval runs, then the repo's declared check commands actually execute and the
verdict gates on their real exit status.

**AC-9.** Given a judge verdict carrying prescriptions, when repair runs, then
the prescribed edits are applied at a cheaper tier than the judge, within the
same attempt, and the recheck verdict is recorded as an event.

**AC-10.** Given two consecutive attempts whose failure signatures are
isomorphic, then the node does not start a third like-for-like attempt — it
escalates hard or blocks.

**AC-11.** Given a tree whose measured spend reaches its dollar ceiling
(default $15), then the tree halts with a decision brief; no further
provider calls are made for that tree.

**AC-12.** Given any completed run, then per-goal and per-tree token and
dollar totals derive from provider-reported usage in the event log, and the
chars-based estimate appears nowhere in accounting.

**AC-13.** Given any completed run, then every receive, decide, spawn, eval
verdict, escalation, gate, memory write, and emission appears in the
append-only log, and the memory state at any past event can be reconstructed
by replaying the log to that point.

**AC-14.** Given a spawner injecting memories, then each carries a
provisional|trusted label and is structurally quoted as data — never
interpolated into the harness's instructions.

**AC-15.** Given a root goal on a repo with no knowledge artifacts, when the
split gate runs, then comprehension goals are spawned as dependencies of the
split — and no comprehension goal is ever spawned for a region no goal
touches.

**AC-16.** Given a knowledge artifact whose recorded SHA no longer matches the
repo, when a goal reads it at a checkpoint, then a refresh is triggered before
the fact is acted on — the stale value is never silently used.

**AC-17.** Given a previously-green declared check on the target repo, when a
goal's change reddens it and the goal's intent does not include that behavior
change, then the goal cannot emit.

**AC-18.** Given a decision brief unanswered at its deadline, then its
declared `on_timeout` (deny|park|bounce) fires; a parked tree's scope
reservation is released immediately and its TTL expiry winds the tree down
through admission.

**AC-19.** Given a split-memo, then promotion to trusted occurs only through
an explicit operator signoff recorded as an event; no code path promotes
structure to trusted autonomously.

**AC-20.** Given any factory-produced diff, then a grep for goal IDs and
factory process language over code, comments, and config returns no hits.

**AC-21.** Given a blocker report filed during a run, then the run continues
past it, and the improvement loop's eventual output for it is a factory-repo
PR — never a mid-run modification of factory code.

## 7. Dependencies

1. A model-provider account and API key (provider-agnostic; any
   OpenAI-compatible endpoint).
2. Git and GitHub access sufficient to branch, push, and open PRs on target
   repos.
3. Target repos that declare conventional entry-point scripts (R12).
4. A durable store for the event log (already provisioned).
5. The operator's availability for decision briefs, triage, signoff, and PR
   review — bounded by design to the three gaps plus two standing acts.

## 8. Open Questions & Risks

1. **Lower-power-model viability for tool loops** — the existential risk of
   the "hands" milestone: can haiku/sonnet-class models drive a granted tool
   loop reliably when the harness carries the specification? De-risk first.
2. **Judge calibration cold start** — no golden sets exist yet; early judge
   verdicts run uncalibrated. Mitigation: capture from the first live runs;
   the operator's PR reviews are the initial exogenous ground truth.
3. **Sandbox/security model for executing repo scripts** — running
   model-influenced commands on the operator's machine needs an explicit
   boundary (architecture decision, pending ADR).
4. **Cost variance** — deep trees with scans and judges have a long tail; the
   $15 ceiling plus exhaustion-as-event is the containment, but expect noisy
   per-tree costs while budget seeds are tuned from traces.
5. **Comprehension quality on foreign repos** — AC-3 is the test; the JIT
   trade (first goals run slower) is accepted, but artifact quality on a messy
   repo is unproven.

## 9. Revision History

| Date | Change | Decided By |
|------|--------|------------|
| 2026-06-10 | Initial draft — extracted from OUTLINE.md + DESIGN.md; gaps locked by operator interview (solo operator; both self-hosted and foreign-repo PRs required for v1; stack-agnostic via repo scripts; $10–15 learning-phase spend cap) | Keith + PM |
