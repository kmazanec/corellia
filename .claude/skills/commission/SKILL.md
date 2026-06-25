---
name: commission
description: The interactive human→Corellia front door. Interview a human about an intent and produce a reviewed CommissionInput artifact (commissions/<id>.ts) that the factory consumes — without running it. Use when the user wants to commission Corellia to build, deliver, or improve something; turn an idea or feature into a factory goal; or author/scope a commission for the factory. Produces the artifact only; running it is a separate explicit step (npm run commission:run).
---

# Commission — the human→Corellia front door

## What this is

Corellia consumes **goals**, not prose. The factory's front door is
`listener.commission(input)`, and `input` is a typed `CommissionInput`
(`src/contract/brief.ts:23`). This skill is the *interactive* step that turns a
human's intent into that artifact — the role a Slack bot or web chat will play
once Corellia is deployed. Today it is a coding-harness slash command.

**The artifact is the contract, not the conversation.** Your job ends when a
reviewed `commissions/<id>.ts` exists on disk. **You do not run it.** Running is a
separate, deliberate step (`npm run commission:run -- <id>`) gated by human review
— this is what keeps *plan* and *build* decoupled.

Reason in the factory's own terms throughout — `GOAL-TYPES.md`, the constitution
(`src/library/constitution.ts`), `DESIGN.md`. You are producing the kind of input
the factory itself would want, not a harness-flavored approximation.

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

## The interview — gather, in the factory's vocabulary

Ask only what you need; infer sensible defaults and state them. Cover:

1. **Intent (the `spec.description`)** — what should exist when this is done?
   Behavior, not implementation. This is the free text the deliver-intent skill
   parses. Push for a crisp, testable description.
2. **Scope (`scope[]`)** — which path prefixes does this intent *own*? Be tight:
   scope is an admission lock (overlapping intents queue) and a blast-radius
   bound. Prefer `src/foo/` over the whole repo.
3. **Constraints (`spec.constraints[]`)** — hard rules: "open a PR when done",
   "must not touch X", test-first, etc. For a self-build (`live:self`-style) target,
   include the **strange-loop hygiene** constraints (primary checkout undisturbed,
   work confined to declared scope, no factory-internal language in the diff).
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
`docs/prototype-build-notes.md` (Iteration 12) for why this exists.
