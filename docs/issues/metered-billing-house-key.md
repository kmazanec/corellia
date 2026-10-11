---
type: issue
title: "Metered billing — orgs run on the factory's own model key and are billed for usage"
description: As an alternative to bringing their own model API key, let an org run on the factory's house key and be billed for the measured spend. Captured as intent only; it follows org-model-api-keys and the budgets iteration.
tags: [operator-console, control-plane, billing, tenancy, orgs, cost]
timestamp: 2026-10-11
status: open
kind: idea
severity: low
---

# Metered billing — orgs run on the factory's own model key and are billed for usage

## Problem

[org-model-api-keys](org-model-api-keys.md) makes every outside org bring its own
model key, or be hand-granted the house key for free. That is enough to admit
orgs safely, but some orgs will want "just run it and bill us" rather than
managing a provider account. Offering that means charging for house-key usage.

## Evidence

- Raised by the operator while speccing org API keys (2026-10-11), explicitly as
  a separate, later feature.
- The factory already measures real dollar spend per tree from provider usage
  accounting (ADR-017), and the org-keys issue tags that spend with `org_id` and
  `key_source`. The metering source exists. Pricing, payment, and limits do not.

## Proposed direction

Rough, not a plan:

- A billing provider (Stripe is the obvious default) with a customer per org and
  usage-based metering. Report house-key spend per job as usage, with a markup
  set by the factory admin.
- A payment method on file becomes the third way an org gets a key: org key, or
  admin grant, or **billed house key**.
- Hard dependency on the budgets iteration: billed usage needs per-org caps so a
  runaway job or a stolen session cannot rack up an unbounded bill.
- Invoices, receipts, and plan tiers stay on the billing provider's side, not in
  the factory.

## Acceptance hint

An org with no key of its own adds a payment method, commissions a job, and sees
the job's metered cost appear on its billing-provider usage at the agreed rate.
An org over its cap is stopped by the budget, not by a surprise invoice.
