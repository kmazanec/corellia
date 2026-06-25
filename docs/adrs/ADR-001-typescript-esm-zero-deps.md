---
type: adr
title: "ADR-001: TypeScript strict ESM with zero runtime dependencies by default"
description: The factory adopts strict TypeScript ESM/NodeNext with zero runtime dependencies by default, so it is a clean exemplar of what it produces.
tags: [adr, typescript, esm, zero-dependencies, stack]
timestamp: 2026-06-10T21:16:39-05:00
---

# ADR-001: TypeScript strict ESM with zero runtime dependencies by default

**Status:** Accepted · **Date:** 2026-06-10 (decided iteration 1; recorded retroactively) · **Stretch:** no · **Contract:** no
**Supersedes:** none · **Superseded by:** none

## Context

The factory prototype needed a stack. The factory's own design demands typed
I/O contracts everywhere, deterministic checks, and artifacts a solo operator
can audit — and the codebase is itself the first self-hosting target, so it
should be a clean exemplar of what the factory produces.

## Options considered

- TypeScript, strict, ESM/NodeNext, zero runtime deps — chosen.
- TypeScript with a framework substrate (LangChain or similar) — rejected.
- Python — rejected.

## Decision

TypeScript with `strict` everywhere, ESM (`NodeNext` module resolution),
Node 22+ (native `fetch`), Vitest for tests, `tsx` for execution. **Zero
runtime dependencies by default**; a dependency enters only by an explicit
recorded decision (to date: `pg`, see ADR-004).

## Rationale

- The design's typed contracts map directly onto the type system; the contract
  barrier (ADR-002) is enforceable by the compiler.
- Framework substrates (LangChain et al.) abstract exactly the seams the
  factory needs to own: the brain call, memory injection, eval verdicts.
  Owning the ~200 lines they'd wrap is cheaper than fighting their shapes.
- Zero deps keeps the audit surface equal to the repo plus `pg` — relevant for
  a system that will eventually edit its own code.

## Tradeoffs & risks

- We re-implement small things (dotenv parsing, JSONL stores) libraries give
  for free. Accepted: each has been <50 lines.
- Node-only: the engine cannot run in other runtimes without porting. Not a
  v1 concern.

## Consequences for the build

- All source under `src/`, ESM imports with `.js` extensions, `tsconfig`
  strict; `npm test` (Vitest) and `npm run typecheck` are the repo's declared
  entry points — the same convention the factory demands of target repos
  (PRD R12).
- Adding any runtime dependency requires a new ADR or an amendment here.
