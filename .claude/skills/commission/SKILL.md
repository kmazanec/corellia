---
name: commission
description: The interactive human→Corellia front door. Interview a human about an intent and produce a reviewed CommissionInput artifact (commissions/<id>.ts) that the factory consumes — without running it. Use when the user wants to commission Corellia to build, deliver, or improve something; turn an idea or feature into a factory goal; or author/scope a commission for the factory. Produces the artifact only; running it is a separate explicit step (npm run commission:run).
---

# Commission — the human→Corellia front door

## What this is

Corellia consumes **goals**, not prose, and certainly not implementation plans.
The factory's front door is `listener.commission(input)`, and `input` is a typed
`CommissionInput` (`src/contract/brief.ts:23`). This skill is the *interactive*
step that turns a human's intent into that artifact — the role a Slack bot or web
chat will play once Corellia is deployed. Today it is a coding-harness slash
command.

**The artifact is the contract, not the conversation.** Your job ends when a
reviewed `commissions/<id>.ts` exists on disk. **You do not run it.** Running is a
separate, deliberate step (`npm run commission:run -- <id>`) gated by human review
— this is what keeps *plan* and *build* decoupled.

Reason in the factory's own terms throughout — `GOAL-TYPES.md`, the constitution
(`src/library/constitution.ts`), `DESIGN.md`. You are producing the kind of input
the factory itself would want, not a harness-flavored approximation.

## The cardinal rule: a goal, never a design

**You produce a requirements doc, not an implementation plan.** State the GOAL —
what must be true when it is done — and let the factory decide HOW. By design
(`DESIGN.md`), the factory's entire job is to *receive a goal → decide → split →
build → integrate*; "free text never flows down the tree — parsing happens once,
at the root." A commission that pre-specifies the implementation does the
factory's job for it, badly: it cannot be cleanly decomposed, and it collapses the
factory into a transcription engine.

The `spec.description` is a **goal and its done-condition**, in the language of
*outcomes and observable behavior*. It must NOT contain:

- file paths or module names (`src/library/acceptance-criteria.ts`)
- function/type/symbol names or signatures (`extend the AcceptanceCheck union`,
  `add a runtime case to criterionToCheck`)
- a step-by-step build plan, an architecture, or a "LOCKED DESIGN" section
- choices of library, data structure, or wiring (`use Playwright`, `wire into the
  broker dispatch table the same way run_script is`)
- enumerated sub-tasks that are really a decomposition (that is the factory's job)

If you catch yourself writing *how*, stop and rewrite it as *what must be true*.
A good test: every sentence of the description should still be correct if the
factory chose a completely different implementation. Examples:

- ❌ "Add a `runtime` variant to the `AcceptanceCheck` union in
  `acceptance-criteria.ts`, extend its parser/type-guards, and wire a Playwright
  capture engine into the broker."
- ✅ "The factory can verify an acceptance criterion that the script runner
  cannot — e.g. that a produced PDF shows a value on the right line — by capturing
  the rendered output and judging it, with no human eyeball. Done when a fixture
  demonstrates the check passing on correct output and failing on a deliberately
  broken one."

The human owns the WHAT and the done-condition. The factory owns the HOW. If the
human keeps reaching for implementation detail, redirect: "what would be
*observably true* if this worked?" — and capture that instead.

## Right-size the goal: one verifiable outcome, not a roadmap

`deliver-intent` decomposes into "the minimum set of children one integration can
verify" (`deliver.md`). A commission must be a **single coherent outcome** at that
size, not a multi-feature program of work. If the goal, stated as outcomes, has
several independent done-conditions that don't share one integration — that is a
**roadmap, not a commission**. Split it into a sequence of slice-sized
commissions, each independently verifiable, and say so to the human rather than
packing an iteration's worth of work into one `deliver-intent`. When in doubt,
smaller: a goal the factory can actually finish and ship beats a complete one it
chokes on.

## The target shape (do not invent fields)

`CommissionInput` is frozen (ADR-026). Produce exactly this — no more, no less:

```ts
interface CommissionInput {
  id: string;            // stable kebab id; used to park/resume/sweep
  title: string;         // human one-liner
  spec: unknown;         // per goal-type; for deliver-intent: { description, scope?, constraints? }
  scope: string[];       // path prefixes this intent OWNS (admission checks prefix-overlap)
  budget: Budget;        // { attempts, tokens, toolCalls, wallClockMs }
  intent?: Intent;       // 'production' | 'spike' | 'characterization'  (default 'production')
  declaredScripts?: DeclaredScripts;  // optional capability pre-check
  repoRoot?: string;     // required iff declaredScripts present
}
```

The **dollar ceiling** is NOT on `CommissionInput` — it is applied at the root
goal (`Goal.spendCeilingUsd`, default `$15` via `DEFAULT_SPEND_CEILING_USD`,
`engine.ts:56`). The runner sets it from a `ceilingUsd` field you record alongside
the commission (see the template). The ceiling is the **primary budget bound**;
treat it as the real envelope.

## Three ways in

This skill accepts intent from three sources. Pick by what the user gives you:

1. **From nothing** — the user just wants to commission something. Run the full
   interview below.
2. **From a free-text intent** — the user hands you a description/idea. Use it as
   the starting point; interview only to fill the gaps (scope, constraints, budget).
3. **From an existing issue** — the user points you at a
   [`docs/issues/<slug>.md`](../../docs/issues/index.md) (or asks to "commission
   issue X"). **Read the issue file**, but **distill it to the goal — do not copy
   it.** Issues often carry a `Proposed direction` full of implementation detail
   (files, functions, design); that is *diagnosis*, not the commission. Take the
   issue's `Problem` and `Acceptance hint` and restate them as a goal + a
   done-condition in outcome language (see "The cardinal rule"); let the
   `Proposed direction` inform your understanding but keep it OUT of the
   `spec.description`. Its `tags` hint at scope. Then interview ONLY for what the
   issue doesn't pin down — usually the `scope[]` prefixes and the budget/ceiling,
   sometimes a sharper done-condition. If the issue is really several outcomes,
   it is a roadmap — say so and split it (see "Right-size the goal").

   **On issue lifecycle:** issues are *ephemeral* — destroyed once implemented. You
   are producing a plan, not building, so **do NOT delete the issue now.** Instead,
   note in the commission artifact (a comment) which issue it came from
   (`// from docs/issues/<slug>.md`), and tell the user that once the commission is
   run and the work lands as an iteration/ADR/code, the issue should be deleted (the
   build step or a follow-up closes the loop). Capture → plan → build → delete.

## The interview — gather, in the factory's vocabulary

Ask only what you need; infer sensible defaults and state them. Cover:

1. **Intent (the `spec.description`)** — what should be TRUE when this is done?
   Outcomes and observable behavior, never implementation (see "The cardinal
   rule"). This is the free text the deliver-intent skill parses at the root. Push
   for a crisp, testable done-condition; strip every file/function/library/step
   detail. If the user supplies a detailed design, distill it back up to the goal
   it serves — the design is *their* thinking about how, which the factory will
   redo; keep only the *what*.
2. **Scope (`scope[]`)** — which path prefixes does this intent *own*? Be tight:
   scope is an admission lock (overlapping intents queue) and a blast-radius
   bound. Prefer `src/foo/` over the whole repo.
3. **Constraints (`spec.constraints[]`)** — hard *rules and invariants*, never a
   build plan in disguise. Legitimate constraints bound the solution space without
   choosing the solution: "open a PR when done", "must not change the public API",
   "must not touch X", "all existing tests stay green", test-first. For a
   self-build (`live:self`-style) target, include the **strange-loop hygiene**
   constraints (primary checkout undisturbed, work confined to declared scope, no
   factory-internal language in the diff). For implementation work, include
   code-shape constraints by default: preserve small domain-named modules, keep
   orchestration thin, move focused tests with ownership boundaries, and use
   `npm run code-shape -- <scope...>` as review evidence for broad scopes.
   A constraint that names a file, function, library, or ordered build step is
   implementation leaking in through the back door — move it back into the goal as
   an outcome, or drop it. "Preserve the deterministic floor" is a constraint;
   "edit criteriaWellFormed to accept the runtime case" is a build step — cut it.
4. **Intent dial (`intent`)** — `production` (full judge strictness, the default),
   `spike` (exploratory), or `characterization` (capture current behavior).
5. **Budget** — translate the human's appetite into `{ attempts, tokens,
   toolCalls, wallClockMs }` AND a `ceilingUsd`, reasoning from *this* job, not a
   canned tier. The **`ceilingUsd` is the real bound** — set it as the most you'd
   let this run spend before you'd want it killed, with headroom; the counts are
   runaway backstops. There are no reference envelopes: size each field to the
   intent's actual shape (how many leaves, how much reading, how long a hard change
   plausibly takes) and **state your reasoning** so the human can check it. Note
   that real spend runs far under the ceiling (proven self-build/foreign runs have
   landed at $0.13–$0.59 against multi-dollar ceilings); the ceiling is a backstop,
   not an estimate. When you genuinely have no signal, ask rather than reach for a
   default tier.
6. **declaredScripts** (optional) — if the commission promises specific script
   entry points (build/test/run commands), declare them so the listener
   capability-checks them at receive (missing entries bounce with zero spend).

If the intent is ambiguous in a way that changes the artifact, **ask** — do not
guess the scope or the done-condition. A vague commission is the failure mode this
front door exists to prevent.

## Produce the artifact

Write `commissions/<id>.ts` from the template in `commissions/README.md`. It is a
plain TS module that `export default`s a `{ commission: CommissionInput; ceilingUsd:
number; repoRoot?: string }`. Pick a kebab `id` that doubles as the filename stem.

Then **stop and present it for review**: show the human the artifact path and a
short summary (intent, scope, ceiling, budget, constraints). Tell them the explicit
run command — `npm run commission:run -- <id>` — and that you will not run it for
them. Decoupled by design.

## What you must NOT do

- **Do not run the factory.** No `engine.run`, no `listener.commission`, no
  `live:*` invocation. Produce-and-stop.
- **Do not specify implementation.** No file paths, function/type names,
  libraries, architectures, "LOCKED DESIGN" sections, or ordered build steps in
  `description` or `constraints`. State the goal and done-condition; the factory
  decides how. This is the cardinal rule — re-read the section above if tempted.
- **Do not pack a roadmap into one commission.** If the goal has several
  independent done-conditions, split it into slice-sized commissions and tell the
  human. One verifiable outcome per `deliver-intent`.
- **Do not add fields to `CommissionInput`** or invent a `spec` shape other than
  the proven `{ description, scope?, constraints? }` deliver-intent convention.
- **Do not widen scope to "the whole repo"** to be safe — that defeats the
  admission lock and the blast-radius bound. Scope tightly; ask if unsure.
- **Do not bake acceptance-criteria structure into `spec`** yet — that is the
  milestone-loop bridge (ADR-031/032), added when the engine grows the
  `iterative` trait. For now, criteria live as prose in `description`/`constraints`.

## Bootstrap status

This skill is the bootstrap-phase implementation of a permanent role. When Corellia
is deployed, the same human→commission interface becomes a hosted front end; the
`CommissionInput` artifact it produces is unchanged. See
`docs/iterations/2026-06-24-02-commission-frontdoor/index.md` for why this exists.
