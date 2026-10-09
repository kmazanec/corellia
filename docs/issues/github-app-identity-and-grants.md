---
type: issue
title: "GitHub App — operator sign-in and per-repo grants for the console"
description: Replace the console's single shared bearer token and the process-wide GITHUB_TOKEN with one GitHub App per factory deployment. Operators sign in with GitHub; anyone allowed can install the App on the repos they choose; the control plane mints short-lived per-repo installation tokens for jobs. This is the identity-and-credential foundation the repo registry builds on.
tags: [operator-console, control-plane, github, github-app, identity, auth, credentials, security, adr-050, adr-051]
timestamp: 2026-09-24
status: open
kind: future-work
severity: high
---

# GitHub App — operator sign-in and per-repo grants for the console

## Problem

Two things in the factory stand in for identity, and neither scales past one
person:

- **Console auth is one shared secret.** `console/server/src/api/auth.ts` checks
  every request against `FRONT_DOOR_TOKEN`. Whoever holds it is "the operator".
  The file already names itself "the single seam where a real identity provider
  plugs in later".
- **Git access is one person's token.** `push_branch` / `open_pr`
  (`src/engine/pr-tools.ts`) read a process-wide `GITHUB_TOKEN`, so every job
  acts as whoever pasted it, on every repo it can reach.

The intent: **whoever connects can grant the factory access to whatever repos
they choose**, and the factory acts with exactly that access. That is a GitHub
App's job. GitHub owns who may grant what, scopes access per repo, and issues
short-lived tokens. Hand-rolling it with stored PATs would keep the factory tied
to one person and leave long-lived secrets in its database.

## Evidence

- `console/server/src/api/auth.ts` (single bearer, the planned identity seam).
- `src/engine/pr-tools.ts` (`process.env['GITHUB_TOKEN']` at execute time).
- [repo-registry-and-access-grants](repo-registry-and-access-grants.md) needs a
  per-repo credential and a notion of "who granted this". It depends on this issue.

## Proposed direction

> A loose shape for the planning pass. It will mint an ADR (identity and
> credential model) and amend ADR-050/051.

### One App per factory deployment, created from the console

The factory registers its own App through GitHub's **App manifest flow**: on
first run the console shows "Create GitHub App", posts a manifest (name,
permissions, callback and setup URLs, webhook URL), and GitHub redirects back
with a code the control plane exchanges for the App id, client id/secret,
webhook secret, and private key. No hand-copying a PEM from a phone. Those
secrets are stored in Postgres encrypted under a host-held key
(`CORELLIA_SECRET_KEY` in the host `.env`, ADR-012: the database never holds the
key that decrypts it). Hand-provisioning via env (`GITHUB_APP_ID`,
`GITHUB_APP_PRIVATE_KEY`, …) stays supported for infrastructure-as-code hosts.

Requested permissions, minimal: Contents read/write, Pull requests read/write,
Metadata read, Checks read (to see CI on the PRs it opens). Nothing at the org
level.

### Sign-in: GitHub is the identity provider

The console's login is "Sign in with GitHub" (the App's user authorization
flow). The control plane keeps a server-side session (httpOnly cookie), not the
user token in the browser. `bearerAuth` stays for machine clients (webhook front
door, scripts) alongside the session middleware. It is no longer how a human
gets in.

**Admission is explicit.** Signing in with GitHub must not mean "anyone on
GitHub can spend this factory's model budget". An allowlist decides who gets
in: `CORELLIA_ALLOWED_GITHUB_ORGS` / `CORELLIA_ALLOWED_GITHUB_USERS`, plus the
App creator as the first admin. Everyone else is refused after OAuth, before a
session exists.

### Grants: installations

- "Grant access" in the UI links to the App's install page. The user picks an
  account or org and **selected repositories** (or all). GitHub handles who is
  allowed to install where, so org admins approve per org policy.
- The App is created **public** only if users outside the creator's account must
  install it. Otherwise private. That is a setup choice in the manifest, recorded
  in the ADR.
- The control plane records installations (`corellia_github_installations`:
  installation id, account, repo selection, suspended) from the setup redirect
  and the `installation` / `installation_repositories` webhooks. If webhooks
  can't reach the host, it falls back to listing installations through the App
  JWT on demand, so the factory never trusts a stale cache for an
  authorization decision.

### Authorization: delegated to GitHub

A signed-in user can see and commission a repo only if **both** the App's
installation covers it **and** the user can access it on GitHub. That is exactly
what `GET /user/installations/{id}/repositories` with the user's token returns.
The factory adds no ACL of its own. A user losing repo access on GitHub loses it
in the console at the next check.

### Credentials for jobs

`CredentialProvider.tokenFor(repo)` mints an **installation access token scoped
to that one repository** (the token request names the repo), about an hour of
life, and caches it until near expiry. `WorkerLink.claim` returns it with the job
(contract change). The PR tools take it as a per-job credential instead of
`process.env`, keep the `GIT_ASKPASS` delivery and `scrubEnv` guarantees, and
refresh it near expiry on long jobs. Commits and PRs are authored by
`<app-name>[bot]`. The event log records the requesting user as the job's
commissioner. `GITHUB_TOKEN` in the env remains as a deprecated fallback for the
single-repo daemon.

### Prerequisite: a reachable HTTPS control plane

The OAuth callback and install setup URL are browser redirects. Webhooks must be
reachable from GitHub. Both need the console at a stable HTTPS origin
(`CORELLIA_PUBLIC_URL`). The deploy runbook has no TLS today. A Caddy sidecar in
the `fleet` profile (automatic certificates for a hostname pointed at the box)
is the small fix, and it belongs in this iteration's first slice, since nothing
else here works without it.

### Slicing

(a) TLS + `CORELLIA_PUBLIC_URL` + encrypted secret store; (b) App creation via
manifest (and the env path); (c) GitHub sign-in, sessions, allowlist, replacing
human use of the bearer; (d) installations: install link, setup redirect,
webhooks + on-demand listing; (e) `CredentialProvider` + per-job token through
`WorkerLink` into the PR tools. After (e), the existing pinned workers already
push with App tokens, and the repo registry can build on it.

## Non-goals

- Personal access tokens as a grant mechanism. Env `GITHUB_TOKEN` stays only as
  the single-repo daemon's fallback. No PAT paste UI.
- Factory-side roles beyond admin / member. GitHub repo access is the
  authorization.
- Hosts other than github.com (GHES later, same App model).
- Per-user or per-installation spend budgets. Worth doing next, since more
  people means more spend, but a separate issue.

## Open questions

1. **Public or private App?** If "whoever connects" means people in your own
   orgs, a private App owned by the org works and is safer. If it includes
   outside accounts, it must be public, and the admission allowlist is the main
   guard on spend.
2. **Who owns the App:** your personal account or an org? Org ownership survives
   any one person leaving. Recommend an org.
3. **Webhooks required or optional?** Recommend optional, with on-demand
   listing as the source of truth and webhooks only as a cache refresh, so a host
   behind NAT still works.

## Acceptance hint

On a fresh fleet deploy, from a phone: open the console's HTTPS URL, create the
GitHub App in one click, sign in with GitHub (an account outside the allowlist
is refused), install the App on one selected repo, commission a job against
that repo, and see the PR opened by `<app>[bot]` with a token scoped to that
repo only. No PAT or PEM is typed anywhere. The App's private key appears in no
API response, event-log row, transcript, or child-process environment.
Uninstalling the App from GitHub makes the repo un-commissionable.
