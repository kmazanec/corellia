---
type: issue
title: "B3. DEPLOYMENT to a live URL"
description: The factory's terminal action is open-pr; it has no deploy target, hosting provider, env/secret config, or post-merge release step.
tags: [structural, deploy]
timestamp: 2026-06-25
status: open
kind: future-work
severity: medium
---

# B3. DEPLOYMENT to a live URL

## Problem
Corellia's terminal action is `open-pr`. It has no concept of a deploy target,
hosting provider, env/secret config, or a post-merge release step. "Deployed and
reachable" — a hard brief requirement — is outside its model.

## Evidence
Operator did: wrote the Dockerfile + `render.yaml`, created the GitHub repo
(`gh repo create`), pushed, drove the Render dashboard in a browser to create the
blueprint, set `OPENROUTER_API_KEY`, and triggered every redeploy. Source:
the gap-audit iteration (docs/iterations/2026-06-24-01-gap-audit-tiutni/index.md).

## Proposed direction
A `deploy` goal family + provider adapter (start with Render's API:
create-service-from-repo, set env, trigger deploy, poll health), gated behind an
explicit human authority check. Even a minimal "emit the deploy config + a
one-command deploy script + a checklist" artifact would be progress.

## Acceptance hint
A `deploy` goal (behind a human authority gate) takes a merged repo to a reachable
live URL via a provider adapter — or, minimally, emits a deploy config + one-command
script + checklist.
