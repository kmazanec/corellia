---
type: issue
title: "Org model API keys — each org brings its own key, or is allowed to use the house key"
description: Every job today spends the factory's one OPENROUTER_API_KEY, read from the worker's environment when the engine is built at startup. With a public GitHub App, outside orgs would spend that key. Let an org admin install the org's own model API key in the console, encrypted at rest; jobs run on that key, and an org without one runs only if a factory admin has allowed it the house key.
tags: [operator-console, control-plane, worker, brain, provider, credentials, security, tenancy, orgs]
timestamp: 2026-10-11
status: open
kind: future-work
severity: high
---

# Org model API keys — each org brings its own key, or is allowed to use the house key

## Problem

The public GitHub App ([github-app-identity-and-grants](github-app-identity-and-grants.md))
lets any GitHub account install the factory and, with write access on a repo,
commission jobs. Every one of those jobs spends **the factory operator's** model
key, and there are no budgets yet (deferred). The near-term answer is not
billing: let each org **bring its own key**, so an outside org's work is paid by
that org.

## Evidence

- `src/daemon/engine-selection.ts:60` reads `process.env['OPENROUTER_API_KEY']`
  once and builds the live engine. The worker calls `selectEngine` once at
  startup (`src/daemon/worker.ts`), so one key serves every job that worker
  ever claims.
- `src/brains/openrouter.ts:26` and `src/brains/anthropic-provider.ts:83`
  already take an injectable `env` map, which is the seam a per-job key fits
  through.
- `src/brains/llm.ts:1081` reads a catalog model's `endpoint.apiKeyEnv` straight
  from `process.env`. That bypasses an injected key and has to change.
- `scrubEnv` (`src/engine/assembly.ts`) already strips `OPENROUTER_*` and
  `ANTHROPIC_API_KEY` from child processes. A per-job key must keep that
  guarantee.

## Proposed direction

> A loose shape for the planning pass. Depends on the App issue's orgs and its
> encrypted secret store and per-job credential delivery.

### Keys are org settings, set by org admins

- An org admin (GitHub org owner, per the App issue) installs a key in the
  console's org settings: provider (`openrouter` in v1; `anthropic` as the
  optional direct-route key the factory already supports), the key, an optional
  label.
- Stored with the App issue's secret store: AES-256-GCM under the host-held
  `CORELLIA_SECRET_KEY`, never returned by any API, shown only as `…last4`,
  provider, who set it, and when.
- Validated on save with one cheap provider call (for OpenRouter, the key-info
  endpoint), so a bad key fails in settings rather than mid-job.
- Rotate means replace. Remove means the org falls back to the rules below.
  Neither touches jobs already running, which keep the key they were claimed with.

### Which key a job runs on

Resolved at **claim**, recorded on the job (`key_source: 'org' | 'house'`, plus
the key's id, never its value):

1. The org has a key → the org's key.
2. No org key, and a factory admin has granted this org the house key → the
   house key (`OPENROUTER_API_KEY` in the host `.env`, as today).
3. Otherwise the job is **not claimable**. The console says why ("add a model
   API key in org settings") at commission time instead of queueing a job that
   can never run.

This replaces the App issue's interim `pending`/`active` activation gate: the only
thing a factory admin approves is use of the house key.

### Per-job engine construction

- `WorkerLink.claim` returns the resolved model credentials alongside the GitHub
  token, as one per-job credential bundle (same contract change the App issue
  makes, extended).
- The worker builds the brain for each job from an `env`-shaped map holding the
  job's keys (the existing `openrouter.ts` / `anthropic-provider.ts` seam)
  instead of once at startup from `process.env`. The engine, store, and pattern
  store stay per worker. Only the brain becomes per job.
- `llm.ts` resolves `endpoint.apiKeyEnv` from that injected map, not
  `process.env`.
- Keys live in worker memory for the job and are dropped when it finishes. They
  never reach the event log, a transcript, or a child process (`scrubEnv`
  already covers the names; a test asserts it for the per-job path).
- Provider failure on an org key (invalid, out of credit) blocks the job with an
  operator-facing reason naming the org's key, distinct from the factory's own
  provider failures (ADR-018), and never silently retries on the house key.

### Spend visibility (not budgets)

The factory already measures real spend per tree from provider usage (ADR-017).
Tag it with `org_id` and `key_source` so the console can show an org its spend,
and the factory admin can see house-key spend by org. That is reporting only.
Limits come with metered billing.

## Non-goals

- Billing, metering for invoices, or charging orgs for house-key use:
  [metered-billing-house-key](metered-billing-house-key.md).
- Spend budgets or caps. They belong to
  [metered-billing-house-key](metered-billing-house-key.md).
- Per-user keys. Keys are per org.
- Custom model catalogs per org. An org's key runs the factory's catalog
  (ADR-044); per-org catalog overrides are a later idea.

## Open questions

1. **Sequencing.** It depends on the App iteration's orgs and secret store and
   is independent of the repo registry. Recommend building it right after the
   App iteration and before the registry: it is small, and it is what makes
   outside orgs safe to admit.
2. ~~Should the house key be off by default for new orgs?~~ **Decided
   2026-10-11: off by default.** The factory admin's own org is granted it at App
   creation; every other org brings a key or is granted the house key
   explicitly, so nobody can spend the operator's account by accident.

## Acceptance hint

An outside org installs the App, its admin adds an OpenRouter key in org
settings (a bad key is rejected on save), and a user with write access
commissions a job. The job runs on that org's key: the provider dashboard shows
the usage on their key and none on the house key, and the console shows the
job's spend under that org. An org with no key and no house-key grant cannot
queue a job and is told why. The key value appears in no API response, event-log
row, transcript, or child-process environment.
