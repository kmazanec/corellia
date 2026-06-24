# Iteration 11 — Gap backlog: driving an external greenfield product (tiutni) through corellia

> Referenced from [prototype-build-notes.md](./prototype-build-notes.md) (Iteration 11).
> This is the **backlog of corellia's own gaps** found by building a real, deployed
> product with corellia as the worker and a human operator (Claude Code) as the
> outer harness. Nothing here is built yet — each item ends in a **BUILD:** line.

## Context

**tiutni** — an agentic tax-filing assistant (LLM chat → filled IRS 2025 Form 1040
→ deployed public URL) — was built on 2026-06-24 by commissioning corellia three
times via `examples/live-tiutni.ts` (`deliver-intent`, NO `prBoundary`; work
collected as a `tree/<id>` branch for the operator to merge). Event logs:
`out/tiutni-events.jsonl` (initial build), `out/tiutni-pdf-events.jsonl` (PDF
upload + real-form fill), `out/tiutni-ui-events.jsonl` (UI redesign).

## Run-level scoreboard (what the factory actually delivered)

| Run | Commission | Factory outcome | Operator had to… |
|---|---|---|---|
| 1 | engine + W-2 parser + guardrails + filler + orchestrator | **Partial**: engine, W-2, guardrails delivered green (111 tests); `deliver-intent` **BLOCKED** on integration eval; filler failed its judge; orchestrator skipped (dep) | Merge the 3 good modules; hand-build filler + orchestrator; fix the integration bugs the judge flagged |
| 2 | W-2 PDF upload + fill the REAL IRS 1040 | **Total block**: both children `step-loop:failed`, no durable code, empty worktree (~$0.17) | Hand-build the PDF parser AND the real-form filler; discover the hard parts (pdf-parse import footgun, concatenated W-2 token, AcroForm field map) by hand |
| 3 | Friendlier UI redesign (`public/` only) | **Success**: `deliver-intent` green, collected cleanly (~$0.14) | Catch + fix a layout regression (swapped grid columns) it shipped; catch that it had silently edited the tax engine constants **outside scope** |

The pattern: **the factory is reliable for a single well-scoped, verifiable code
module, and degrades sharply as the task needs (a) cross-module integration, (b)
external knowledge it can't fetch, (c) verification beyond `npm test`, or (d)
anything off the git/PR rails.** Every gap below is an instance of one of those.

---

## A. In-run stalls — the factory tried and blocked (engine/harness gaps)

### A1. Repeated-failure → `step-loop:failed` gives up with ZERO salvage
**Evidence:** Run 2, both children: `"step-loop:failed" … escalating to block` ×16;
worktree collected with the stub bodies UNTOUCHED. Run 1 hit the same signature on
the orchestrator dependency.
**Why:** when an `implement` leaf repeats an isomorphic failure, the engine blocks
the whole subtree and discards everything in the worktree — even partial, useful
progress. The operator got an *empty* worktree and started from zero.
**BUILD:** on `step-loop:failed`, (a) preserve the worktree's best attempt as a
draft artifact on the blocker report, and (b) attach the failing transcript + last
diff so the operator/improvement-loop can resume from the 90% instead of 0%.

### A2. The leaf cannot escape a self-inflicted test-authoring bug
**Evidence:** Run 1, `"ReferenceError: it is not defined"` ×2 — the factory wrote a
vitest test file that **omitted `import { it, describe, expect } from 'vitest'`**,
then burned attempts re-running it and re-reading the same files (see A3) instead of
recognizing the missing-import class of error.
**Why:** no feedback loop mapping a known error signature ("X is not defined" atop a
test file) to a known fix (add the import). The model thrashes.
**BUILD:** a small library of **error-signature → suggested-repair** hints injected
into the repair rung's context (missing test import, missing type import, ESM/CJS
`__dirname`, top-level-await-in-eval, etc.). These recurred verbatim across runs.

### A3. Duplicate-read refusal (F-64) blocks progress without offering the cached value inline
**Evidence:** Run 1, ×2: `"Duplicate read refused (F-64): an identical call to
list_dir/read_file … was already executed this attempt."`
**Why:** F-64 correctly prevents wasteful re-reads, but it returns a *refusal* the
model must reason around, sometimes stalling, instead of handing back the result.
**BUILD:** when refusing a duplicate read, **return the prior result's content** (or
a pointer the broker auto-expands) rather than only an error.

### A4. The integration judge finds REAL cross-module bugs but no rung can fix them across leaf boundaries
**Evidence:** Run 1 `deliver-intent` blocker: *"Guardrails reject core domain
inputs: 'single','MFJ','MFS','HoH' wrongly classified; redirect message references
'transcript'; budgetExhausted not called; QUESTION_BUDGET absent."* All true bugs —
but they live at the SEAM between the guardrails leaf and the (never-built)
orchestrator leaf. The judge saw them; no leaf owned the fix.
**Why:** `implement` leaves are scoped to one area; `judge-integration` runs after,
at the root, with no rung that can commission a cross-cutting repair against the
integrated tree. Integration findings become a terminal blocker, not new work.
**BUILD:** a `repair-integration` goal type the root can spawn when
`judge-integration` fails — scoped to the union of the failing modules, fed the
judge's findings, allowed to edit across the seam. (Intra-delivery, before the PR —
distinct from the deferred post-PR improvement loop.)

### A5. A blocked dependency silently kills its dependents with no degraded path
**Evidence:** Run 1: filler failed → orchestrator `"Blocked because a dependency
failed"` → root blocked, even though 3 of 5 modules were perfect.
**Why:** dependency edges are hard gates; there is no "ship what's green, report the
rest" partial-delivery mode.
**BUILD:** **partial-delivery**: when some children succeed and others block, emit a
report that (a) collects the green subtree, (b) lists the blocked modules + why, so
the operator merges the 80% immediately. Today the operator hand-fished the good
modules out of the worktree.

---

## B. Structural gaps — work the factory CANNOT represent as a goal at all

These never appeared in the event log because the factory has no goal type, tool,
or grant for them. The operator did 100% of each.

### B1. Acquiring an EXTERNAL ASSET the build depends on (the real IRS 1040 PDF)
**Operator did:** `curl`ed the official `f1040.pdf` from irs.gov, confirmed the tax
year, inspected its 199 AcroForm fields, vendored it into the repo.
**Why the factory can't:** no `fetch_url` / `acquire_asset` tool, no network-egress
grant, no notion of a binary build-input. The PDF-fill feature is *impossible* for
the factory as-is — it can only edit text it already sees.
**BUILD:** a sandboxed `fetch_resource` tool (allow-listed domains, size cap,
checksum recorded as an event) + an `asset` artifact kind so a goal can declare "I
need file X from URL Y" and have it fetched, vendored, and provenance-logged.

### B2. Verifying anything `npm test` cannot — VISUAL / RUNTIME / PDF-OUTPUT correctness  ⭐ biggest gap
**Operator did:** rendered the filled 1040 to an image and **eyeballed every line**
to confirm the AcroForm field→line map (a transposed field silently puts money on
the wrong line — no unit test catches it); screenshotted the UI to catch the
swapped-column regression; drove a live HTTP conversation to confirm the agent
actually tool-calls.
**Why the factory can't:** its only verification rung is the declared script runner
(`npm test` / `typecheck` / `lint`). It cannot *render*, *screenshot*, *open a PDF*,
or *drive a running server* and judge the result. The most important correctness
properties of this product were invisible to it.
**BUILD:** a **visual/runtime verification rung** — a tool that can (a) start the app
and hit endpoints, (b) render a produced PDF/page to an image, and (c) feed that
image to a vision-capable judge with the acceptance criteria. Without this, the
factory cannot self-verify any output whose correctness is visual or behavioral.

### B3. DEPLOYMENT to a live URL
**Operator did:** wrote the Dockerfile + `render.yaml`, created the GitHub repo
(`gh repo create`), pushed, drove the Render dashboard in a browser to create the
blueprint, set `OPENROUTER_API_KEY`, and triggered every redeploy.
**Why the factory can't:** corellia's terminal action is `open-pr`. It has no
concept of a deploy target, hosting provider, env/secret config, or a post-merge
release step. "Deployed and reachable" — a hard brief requirement — is outside its
model.
**BUILD:** a `deploy` goal family + provider adapter (start with Render's API:
create-service-from-repo, set env, trigger deploy, poll health), gated behind an
explicit human authority check. Even a minimal "emit the deploy config + a
one-command deploy script + a checklist" artifact would be progress.

### B4. The GREENFIELD bootstrap — git init, scaffold, frozen contract
**Operator did:** `git init`, wrote the initial `package.json`/`tsconfig`/server
scaffold + the frozen `domain/types.ts` contract + typed stubs, committed a green
baseline — because the worktree flow REQUIRES an existing git repo with something to
build *into*. The factory delivers *increments*, not the first commit.
**Why the factory can't:** `openTreeWorktree` asserts a git repo; `deliver-intent`
assumes a scaffold; there is no "scaffold a new project from nothing" path.
**BUILD:** a `scaffold-project` goal type (or, at minimum, a documented "operator
seeds the baseline, then commissions" protocol) that stands up a minimal,
typechecking, test-green skeleton + frozen contract from an intent.

### B5. Authoring its OWN external knowledge (tax law: the 2025 standard deduction)
**Operator did:** supplied the 2025 brackets/deduction figures; and when a later
edit changed the standard deduction to `$15,750`, the operator caught it, **checked
the authoritative source (the IRS form's own margin) before acting,** and confirmed
`$15,750` was actually correct for 2025 (OBBBA) — i.e. did the fact-verification the
factory has no mechanism for.
**Why the factory can't:** no grounded-knowledge step. It will confidently write a
plausible-but-wrong constant (or "fix" a correct one to a wrong one) with no way to
check reality — dangerous for a domain like tax law.
**BUILD:** a `ground-fact` capability — when a goal depends on an external fact (a
rate, constant, API contract), require a cited source captured as a knowledge
artifact (ties into B1 `fetch_resource` + the existing knowledge-artifact layer and
ADR-019 verify-on-read). A judge should reject load-bearing magic numbers with no
citation.

---

## C. Scope & safety gaps — the factory edited OUTSIDE its declared scope

### C1. Out-of-scope edits were neither prevented nor surfaced  ⭐ highest risk
**Evidence:** Run 3 was scoped to `public/` only, yet `src/tax/engine.ts` and
several test files were modified (the standard-deduction constants). The operator
only found this by reviewing `git show` on the merge commit — the factory neither
blocked the out-of-scope write nor flagged it in its report.
**Why:** the deferred **grant enforcement** (README "Deliberately deferred": "the
runtime check that a goal's tool calls stay within the grants declared on its type")
plus scope enforcement is not wired. `write_file` can touch anything in the worktree.
**BUILD:** enforce the declared `scope` prefixes at the broker's `write_file`
boundary (refuse + report a write outside scope), and make the collected report
**list every file touched** vs. the declared scope. A scoped "UI" job silently
altering tax math is exactly the failure a harness must prevent.

### C2. No diff review surface before collection
**Operator did:** manually `git diff main..tree/<id>`, checked every element id the
JS depended on still existed, that no network call changed, etc., before each merge.
**BUILD:** a `collect` step that produces a structured **review manifest** (files
changed, public-symbol/contract deltas, scope conformance, test delta) so the
operator (or an auto-gate) reviews intent, not raw diff lines.

---

## D. Operational / ergonomic gaps (lower severity, real friction)

- **D1. Generic commit messages.** Collected commits read `feat(tree): collect
  worktree <id>`; later auto-commits were `"Fix bugs"` / `"Fix 2025 standard
  deduction expectations"` — not conventional-commits, not descriptive. **BUILD:**
  have the deliver report supply a proper commit subject/body from the goal intent.
- **D2. No model-capability signal.** Run 2's total block correlated with the
  configured model's weaker tool-use; the factory gives no signal that a tier is
  underperforming on tool-calling. **BUILD:** track per-tier tool-call success rate
  as a metric; surface "this tier is failing tool calls" in the run summary.
- **D3. Event log path is per-invocation env, not per-project.** The operator set
  `CORELLIA_EVENTS_PATH` by hand each run to avoid clobbering. **BUILD:** derive a
  default per-target-repo log path.
- **D4. Worktree teardown is manual on block.** Blocked runs left
  `.corellia/worktrees/<id>/` for the operator to `git worktree remove`. **BUILD:**
  auto-prune (or `--reap`) blocked worktrees once their report is collected.

---

## Severity-ordered build plan

1. **B2 visual/runtime verification rung** — without it the factory can't self-verify
   any product whose correctness isn't a unit test. Blocks everything real.
2. **C1 scope/grant enforcement + touched-file report** — highest *risk*; a scoped
   job silently changed tax math.
3. **A5 partial-delivery + A1 salvage-on-block** — turn all-or-nothing into "ship the
   green, report the rest"; recover the 80% the operator fished out by hand.
4. **A4 `repair-integration` rung** — let the factory fix the cross-module bugs its
   own integration judge already finds.
5. **B3 deploy family** + **B1 fetch_resource/asset** + **B4 scaffold-project** — the
   three "the factory structurally can't even start this" gaps.
6. **B5 ground-fact**, **A2 error-signature repair hints**, **A3 cached-read**,
   **C2 review manifest**, **D1–D4** ergonomics.
