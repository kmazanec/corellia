---
type: adr
title: "ADR-038: minted subagents wear a domain-expert persona, selected by one shared deterministic core"
description: Every minted subagent gets only a generic factory-role framing plus a per-family craft skill; add a third layer — an expert domain persona (the language's idiom embodied) selected from the goal alone by a single pure selector, so the same lens reaches every mint site without new plumbing.
tags: [adr, library, brain, engine, persona, subagent, skills]
timestamp: 2026-06-25T23:05:00-05:00
---

# ADR-038: minted subagents wear a domain-expert persona, selected by one shared deterministic core

**Status:** Accepted · **Date:** 2026-06-25 · **Stretch:** no · **Contract:** no
**Supersedes:** none · **Superseded by:** none · **Extends:** ADR-022

## Context

Every subagent the factory mints is shaped by exactly two layers today:

1. a **generic factory-role framing** — `systemPrompt(role, goalType)` in
   `src/brains/llm.ts` returns *"You are a {decision-maker|artifact
   producer|judge|artifact repairer} in the Corellia factory … Never
   hallucinate."*; and
2. a **per-family craft skill** — the markdown family file loaded by
   `loadFamilySkill` (ADR-022), injected at decide/produce/judge time and into
   the tool-using leaf's step-loop harness context message in `runStepLoop`
   (`src/engine/engine.ts`).

What is **absent** is any *domain-expert* lens. The family skills are keyed by
the factory's **workflow stage** (build, comprehend, author, critique, …), not
by the **language or domain** of the work. So a goal that writes Go and a goal
that writes Rust are reasoned about with the same generic voice plus the same
stage skill. Nothing makes the producer or judge reason *as a Go expert about Go*
or *as a security reviewer about an auth path*.

Keith maintains a set of high-quality "expert panel" personas outside the repo
(`~/dev/dotmaz/agents/*.md` — e.g. a Go panel, a Rust panel, a TypeScript panel,
a security panel). These are exactly the idiom/craft lenses the factory's
code-writing and judging steps should wear. But they (a) live outside the repo,
which violates the one rule in `CLAUDE.md` (*everything durable lives in this
repo*), and (b) are named after people, which couples the factory to
individuals rather than the domain it actually depends on.

## Decision

Add a **third layer — a domain-expert persona** — selected by **one shared,
pure, deterministic, LLM-free core** that every subagent mint site routes
through.

1. **Personas are in-repo markdown, generically named.** The dotmaz panels are
   cloned to `src/library/personas/<domain>-expert.md` (`go-expert`,
   `rust-expert`, `typescript-expert`, `react-expert`, `node-expert`,
   `python-expert`, `ruby-expert`, `swift-expert`, `devops-expert`,
   `security-expert`, `design-expert`, `pedagogy-expert`). The frontmatter
   records `name` (the generic key), `domain`, and `source` (provenance — which
   panel it was cloned from). The embodied-expert body is kept verbatim: the
   expertise *is* the value. This is the same "reviewable markdown, loaded into
   the harness" choice ADR-022 made for skills, applied to personas — hence
   **Extends: ADR-022**.

2. **One selector is the shared core.** `selectPersonas(goal)` in
   `src/library/personas.ts` maps a goal's `scope` (file extensions, path hints)
   and `type` (work-kind hints) to an ordered, de-duplicated set of persona keys.
   It is pure and deterministic — no LLM, unit-testable from `goal → keys`. The
   ordering contract is **base language first, then framework/domain overlays,
   then work-derived personas**, so a `.tsx` goal wears `typescript-expert` then
   `react-expert` (matching how the panels describe themselves: "the React lens
   layers on top of the base TypeScript panel"). No signal → `[]` → the caller
   appends nothing and behaviour is byte-identical to before this layer.

3. **The persona is derived from the goal, not threaded through `BrainContext`.**
   The brain already receives the full `Goal` in every role method, so
   `systemPrompt` computes the persona itself via `renderPersonaBlock(goal)`.
   This deliberately avoids adding a `persona` field to `BrainContext` and
   wiring it through the ~15 context-construction sites in the engine — the
   selection logic stays in exactly one place, and every brain role
   (decide/produce/judge/repair) and the step-loop leaf pick it up for free.

4. **Persona augments; it never overrides.** The rendered block is appended after
   the factory-role framing (brain roles) or after the family-skill block
   (step-loop leaf), and its own preamble states it shapes *how* to reason but
   never overrides the goal, the family skill, or the factory's rules.

## Consequences

- The factory now produces and judges code with the language's idiom embodied,
  not a generic voice — the lens the dotmaz panels were written to provide.
- The persona layer is **additive and lenient**: a missing persona file, or a
  goal with no matching domain, falls back cleanly to the prior behaviour; the
  loader never throws (mirrors `loadFamilySkill`).
- **Not constitution-enforced (for now).** Unlike family skills (whose presence
  the constitution lint requires per type), persona coverage is advisory: a goal
  with no matching persona is legitimate, not a lint gap. The selector's own
  unit tests assert every key it can emit resolves to a real file; if persona
  coverage later needs to be a hard requirement, that is a follow-on decision.
- **Selection signal is `scope` + `type` only.** The families are workflow-stage,
  not language, so they cannot carry the domain signal; `scope` extensions are
  the honest primary signal for "what language is this." Goals with empty scope
  and a non-domain type wear no persona — acceptable, since the lens has nothing
  to bite on.

## Alternatives considered

- **Thread `persona` through `BrainContext` like `ctx.skill`.** Rejected: it
  spreads the (single) selection decision across every context-construction site
  and risks a site that forgets it. Deriving from the goal keeps the core in one
  function.
- **Make personas a family-skill variant keyed by language.** Rejected: families
  are the factory's stage taxonomy; overloading them with language would conflate
  two orthogonal axes (what stage of work vs what language the work is in).
- **A new goal-type per expert.** Rejected by the same granularity rule as
  ADR-034 — a persona is context a goal wears, not a kind of work that earns
  type status.
