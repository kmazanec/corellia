---
type: issue
title: Expert persona layer for minted subagents
description: Clone the dotmaz expert coding agents into the factory under generic names and inject the right persona wherever the engine mints a subagent, via shared generic selection logic.
tags: [library, engine, brain, persona, subagent]
timestamp: 2026-06-25
status: open
kind: idea
severity: medium
---

# Expert persona layer for minted subagents

## Problem
Every subagent the factory mints — decision-maker, artifact producer, judge,
artifact repairer (`src/brains/llm.ts:911` `systemPrompt`), plus comprehension
and review children spawned in `src/engine/engine.ts` — wears the same generic
system prompt: *"You are a {role} in the Corellia factory … Never hallucinate."*
The only specialization is the family skill (`loadFamilySkill`) and the shared
preamble. There is no language/domain-expert persona shaping how a TypeScript,
Rust, Go, Python, or security goal is judged or produced.

Keith maintains a set of high-quality "expert panel" coding agents in
`~/dev/dotmaz/agents/` (matt-pocock for TS, rob-pike for Go, sandi-metz for
Ruby, niko-matsakis for Rust, raymond-hettinger for Python, troy-hunt for
security, etc. — 12 of them, each a 90–160-line persona). These are exactly the
craft/idiom lenses the factory's code-writing and judging steps should be wearing,
but they live outside the repo and the factory can't read them. Result: the
factory produces and reviews code with a generic voice instead of the
"judged by the people whose names are the language's idiom" lens these personas
provide.

## Evidence
- `src/brains/llm.ts:911-917` — `systemPrompt()`: the sole persona is a static,
  role+goal-type string. All four LLM entry points (`decide` ~960, artifact
  producer ~1029, judge ~1070, repairer ~1118) call it.
- `src/library/skills.ts` — the existing per-family skill loader is the natural
  sibling for a persona loader (same `SKILLS_DIR` pattern, same caching shape).
- `src/engine/engine.ts:2113`, `:2863`, `:1921` — other sites that load a family
  skill while assembling a child/judge goal; persona selection must reach these
  too, not just the brain.
- The source personas: `~/dev/dotmaz/agents/*.md` (12 files, OKF-style
  frontmatter with `name` + a long `description`, then a `# Persona` body). They
  must be **cloned into the repo** (the factory may not depend on a path outside
  it — see `CLAUDE.md`: everything durable lives in this repo).

## Proposed direction
Rough, not committed — leave room for the builder:

1. **Clone with generic names.** Copy the dotmaz agents into a repo location
   (candidate: `src/library/personas/<domain>-expert.md`) renamed to the domain,
   not the person: `sandi-metz → ruby-expert`, `matt-pocock → typescript-expert`,
   `rob-pike → go-expert`, `niko-matsakis → rust-expert`,
   `raymond-hettinger → python-expert`, `paul-hudson → swift-expert`,
   `dan-abramov → react-expert`, `ryan-dahl → node-expert`,
   `kelsey-hightower → devops-expert`, `troy-hunt → security-expert`,
   `paula-scher → design-expert`, `benjamin-bloom → pedagogy-expert`. Keep the
   panel content; strip harness-specific framing.
2. **One generic selection function — the shared core.** A single
   `selectPersona(goal)`-style resolver that every subagent minter calls, so the
   decision logic lives in exactly one place. It maps a goal's signal
   (scope file extensions, language/domain tags, goal type/family) → zero or
   more persona files, deterministically and cheaply (no LLM). Layering rule
   from the personas themselves (base TS panel + framework panel on top) should
   be expressible — e.g. a React goal gets typescript-expert + react-expert.
3. **Persona loader** mirroring `src/library/skills.ts` (`loadPersona`,
   cached, lenient-on-missing).
4. **Inject at every mint site.** Thread the selected persona text into
   `systemPrompt()` (or the prompt assembly) for decide / produce / judge /
   repair, and into the engine's child/judge assembly sites. The persona augments
   — does not replace — the factory-role framing and the family skill.
5. **Constitution awareness.** Decide whether persona coverage is lint-checked
   (like family skills) or purely advisory; capture the choice in an ADR if it
   becomes a design decision.

## Acceptance hint
- The 12 personas exist in-repo under generic domain names, with no remaining
  dependency on `~/dev/dotmaz/agents/`.
- A single shared selection function is the only place that decides which
  persona(s) a minted subagent wears; all subagent mint sites (brain's four
  roles + engine child/judge assembly) route through it.
- A goal whose scope is TypeScript provably carries the typescript-expert persona
  in its assembled system prompt (and a React goal additionally carries
  react-expert); a goal with no matching domain falls back cleanly to today's
  generic prompt.
- Selection is deterministic and LLM-free (unit-testable from goal → persona set).
