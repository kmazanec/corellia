---
type: iteration
title: "Iteration 12 — The missing human→commission front door (the `commission` skill)"
description: Capture the interactive human→Corellia intent→CommissionInput step as a reviewed, versionable artifact — decoupling plan from build — and prove it end to end with a small dogfood that also reproduces the milestone-loop block.
tags: [iteration, commission, front-door, commission-input, skill, dogfood, milestone-loop-repro, plan-build-decoupling]
timestamp: 2026-06-24
status: shipped
---

# Iteration 12 — The missing human→commission front door (the `commission` skill)

**Date:** 2026-06-24 · **Status:** Shipped (commission skill + front door proven)

**Stuck point (recorded per the bootstrap discipline, CLAUDE.md):** Keith asked
corellia a design question ("should the root goal loop?"), and the work was carried
by a *harness-orchestrated* design panel and a hand-written flat `SPEC.md` + ADRs.
That is the harness acting as the planner — the exact dependency the bootstrap loop
is meant to retire. The signal: **the factory has no front door for a *human* to
turn an intent into the artifact the factory consumes.** `commission()`
(`listener.ts`, contract `CommissionInput` in `src/contract/brief.ts:23`) eats a
typed artifact; nothing produces that artifact *with* a human. The interactive
intent→commission step lived only in an operator's head + a hand-edited
`examples/live-*.ts`.

**Why it matters:** the human→commission interface is a permanent architectural
role (today a coding-harness slash command; later a Slack/web chat front-end). The
durable contract is the *artifact* (`CommissionInput`), not the chat. Capturing it
as a reviewed, versionable artifact decouples *plan* from *build* — the same
separation a hosted front door would have.

**Built (the corellia way, on main — interactive build work):**
- `.claude/skills/commission/SKILL.md` — the interactive front door. Interviews in
  the factory's own vocabulary (intent, scope prefixes, budget envelope + `$`
  ceiling, `production|spike|characterization`, constraints incl. strange-loop
  hygiene), then writes a `CommissionInput` artifact to `commissions/<id>.ts`.
  **Plans only — does not run** (decoupled; a review gate sits between plan and
  build).
- `examples/run-commission.ts` (`npm run commission:run`) — the separate, explicit
  runner: loads a `commissions/<id>.ts` artifact and feeds it through the real
  front door (`listener.commission()`), not a hand-built root goal.
- `commissions/README.md` + `commissions/example-word-count.ts` — the proven small
  dogfood target (mirrors `examples/live.ts`'s word-count spec) so the artifact
  shape is validated on a small goal before the milestone-loop feature.

**Forward-compat note:** the v1 artifact uses the *proven* deliver-intent spec
convention `{ description, scope?, constraints? }`. Acceptance-criteria-in-spec —
the milestone-loop done-condition (ADR-031/032, `docs/milestone-loop-SPEC.md`) — is
the bridge added when that feature lands; the skill is shaped to grow into it, not
ahead of the engine.

**Dogfood run (2026-06-24) — front door PROVEN; a milestone-loop repro fell out.**
`npm run commission:run -- example-word-count` ran the reviewed artifact through the
real front door end to end:
- **Plumbing ✅** — artifact loaded + validated, ceiling note surfaced, went through
  `listener.commission()` (not a hand-built goal), `deliver-intent` split into
  `implement` + `open-pr`, both children passed, events logged (24), artifact
  written. The skill→artifact→front-door→factory→disk path is validated. This was
  the dogfood's goal.
- **Integration gate ✅ working as designed** — the root `deliver-intent`
  **BLOCKED** at `judge-integration`: the `implement` step produced **two
  conflicting contents for the same `wc.mjs`** (one literal-string-only, one
  file-path-first + stdin-on-no-arg), and the judge refused to ship a contradiction
  rather than guessing. (The file that reached disk passes all three spec smoke
  tests by luck of its fallback, but its *primary* contract is file-path-first,
  diverging from "accepts a single string argument" — the judge caught a real
  spec-divergence, not a phantom.)
- **A live milestone-loop repro 🎯** — this is the SAME class of terminal
  integration block that stopped tiutni Run 1 (`gaps-from-tiutni.md`), now in a
  ~$0.20, single-file, repeatable form. Today `deliver-intent` blocks here; the
  milestone loop (ADR-031/032) is exactly the fix — on this block, re-decide
  another round informed by the conflict and converge, instead of terminally
  blocking. **`commissions/example-word-count.ts` is now the minimal test case for
  the milestone-loop feature: it should flip from BLOCK to converged-PASS once the
  loop lands.**

Next: graduate the skill to producing the milestone-loop commission; and when that
feature is built, re-run this commission as the convergence proof.
