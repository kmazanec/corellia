---
type: adr
title: "ADR-012: Secrets reach the factory only through the environment"
description: Secrets reach the factory through the environment via a gitignored .env and a zero-dep loader, with the real environment always winning — vault references, never values, in artifacts.
tags: [adr, secrets, environment, dotenv, security]
timestamp: 2026-06-10T21:16:39-05:00
---

# ADR-012: Secrets reach the factory only through the environment

**Status:** Accepted · **Date:** 2026-06-10 (decided iteration 2; recorded retroactively) · **Stretch:** no · **Contract:** no
**Supersedes:** none · **Superseded by:** none

## Context

The live brain and the Postgres substrate introduced the first real secrets
(API key, DB password). The design's rule: vault references, never values, in
any artifact or memory.

## Options considered

- `.env` file (gitignored) + zero-dep loader, real environment always wins —
  chosen.
- `dotenv` package — rejected (ADR-001: 20 lines replaces it).
- Secrets manager integration — premature for a solo-operator local v1.

## Decision

A zero-dependency `loadDotEnv` (`src/env.ts`) parses `.env` (quotes stripped,
`export` prefix tolerated) and **never overrides** variables already present
in the real environment. `.env` is gitignored; `.env.example` documents every
variable (`OPENROUTER_API_KEY`, `CORELLIA_MODEL_*`, `DATABASE_URL`,
`POSTGRES_PASSWORD`) with required/optional status. Test setup loads it via
Vitest `setupFiles`; entry points call it explicitly. Compose uses
`${POSTGRES_PASSWORD:-corellia}` so the file works with or without overrides.

Key values never appear in logs, events, memories, or artifacts — events may
reference *that* a credential was used, never the value.

## Rationale

Real-env-wins is the property that makes the loader safe in CI and under
process managers (explicit environment beats checked-in-adjacent files).
One documented example file is the entire onboarding story for a new machine.

## Tradeoffs & risks

- A `.env` on disk is plaintext; acceptable for a solo operator's machine,
  revisit if the factory ever runs hosted (out of scope, PRD).
- Nothing currently *scans* outbound artifacts for leaked values — the
  secret-reference scan named in DESIGN.md's deterministic gate is future
  check-library work.

## Consequences for the build

- **Source of truth:** `src/env.ts`, `.env.example`, `tests/setup-env.ts`.
- Every new secret gets a `.env.example` line in the same change that
  introduces it. No secret ever gains a default value in code.
