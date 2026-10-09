---
type: issue
title: "GitHub App — operator sign-in and per-repo grants for the console"
description: Replace the console's single shared bearer token and the process-wide GITHUB_TOKEN with one GitHub App per factory deployment. Operators sign in with GitHub; any account can install the public App on the repos it chooses; orgs and memberships mirror GitHub and are re-verified; the control plane mints short-lived per-repo installation tokens for jobs. This is the identity-and-credential foundation the repo registry builds on.
tags: [operator-console, control-plane, github, github-app, identity, auth, tenancy, orgs, credentials, security, caddy, adr-050, adr-051]
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

Signing in proves who you are, nothing more. What you can do comes from orgs
(below). A signed-in user who belongs to no org sees an empty console with a
"Grant access" link.

### Grants: installations

- "Grant access" in the UI links to the App's install page. The user picks an
  account or org and **selected repositories** (or all). GitHub handles who is
  allowed to install where, so org admins approve per org policy.
- The App is **public** (decided 2026-09-24): any GitHub account or org can
  install it, which is what "whoever connects can grant access" needs.
- The control plane records installations (`corellia_github_installations`:
  installation id, account, repo selection, suspended) from the setup redirect
  and the `installation` / `installation_repositories` webhooks. If webhooks
  can't reach the host, it falls back to listing installations through the App
  JWT on demand, so the factory never trusts a stale cache for an
  authorization decision.

### Orgs and users: tenancy mirrored from GitHub

Corellia gets an org layer, and every fact in it is **derived from GitHub and
re-verified**, never granted inside the factory.

- **Org** (`corellia_orgs`): one per App installation, keyed by the GitHub
  account it is installed on, either an organization or a personal account (a
  personal installation is an org of one, plus whoever GitHub lets into its
  repos). Fields: GitHub account id and login, account type, installation id,
  status (`pending` | `active` | `suspended` | `uninstalled`). Uninstalling or
  suspending the App on GitHub flips the status.
- **User** (`corellia_users`): a GitHub user who has signed in (GitHub user id,
  login). No password and no factory-side profile beyond that.
- **Membership** (`corellia_memberships`): user × org × role, with
  `verified_at`. It is a **cache of a GitHub fact**, not a grant:
  - *member*: the user can access at least one of the installation's repos,
    which is exactly what `GET /user/installations` (user token) returns;
  - *admin*: the user is an owner of the GitHub org (or is the personal account).
    Admins enable and disable repos for the org (registry issue) and approve
    things on the org's behalf.
- **Repo-level rule (the one that gates action):** a user can see a repo's
  jobs and commission or answer against it only if the org's installation covers
  the repo **and** the user can access that repo on GitHub
  (`GET /user/installations/{id}/repositories`). Org membership groups and
  scopes the console. The repo check is the authorization.
- **Jobs belong to an org.** Jobs gain `org_id` and `commissioned_by`. Every
  list, stream, and SSE channel is filtered by the caller's verified access, so
  one org never sees another's jobs, trees, or logs.

**Re-verification: "still has access" is checked, not assumed.**
- **Mutations** (commission, answer, enable or disable a repo, cancel): verify
  live with GitHub if the cached verification is older than a short window
  (about 5 minutes), and refuse if GitHub no longer agrees.
- **Reads** (dashboards, streams): served from the cached membership within a
  longer window (about 1 hour), re-verified in the background. An open SSE
  stream is closed when re-verification fails.
- **Webhooks make it immediate where GitHub sends them.** `installation`
  (deleted or suspended), `installation_repositories` (repo removed),
  `github_app_authorization` (user revoked the App), and `organization`
  (`member_removed`) invalidate the affected memberships and sessions at once.
  Without webhooks the time windows above are the bound.
- **User tokens expire.** The App's user-to-server tokens last about 8 hours,
  with refresh tokens, so the session stores the refresh token encrypted and
  refreshes on use. A failed refresh ends the session.

Permissions this adds to the manifest: Organization members (read), for the
membership webhook and the admin check. Still nothing with write access at the
org level.

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
(`CORELLIA_PUBLIC_URL`). The deploy runbook has no TLS today.

The target host (Hetzner) already runs Caddy for other apps, so the factory
does **not** bundle its own proxy. Another Caddy would fight the existing one for
ports 80/443. Instead:

- `compose.deploy.yaml` publishes the control plane on loopback only
  (`127.0.0.1:${CONSOLE_HOST_PORT}`), and likewise the daemon, so nothing is
  exposed except through the host proxy.
- The host Caddy gets one site block, e.g.
  `corellia.example.com { reverse_proxy 127.0.0.1:8090 }`, plus a DNS record. The
  control plane must keep SSE streams working behind it (no response
  buffering; Caddy's defaults are fine) and trust `X-Forwarded-*` from loopback
  only, so session cookies are `Secure` and the OAuth redirect URLs are correct.
- `docs/deploy.md` documents the "existing reverse proxy" shape as the default
  and a bundled-Caddy profile as an option for bare hosts. The bundled option is
  not needed for this host.

The existing Caddyfile's location, how Caddy runs on that host (system service
or container), and which hostname to use are unknown until someone is on the
box. Record them in the iteration when this slice is built.

### Slicing

(a) loopback-only ports, a site block in the host's existing Caddy, `CORELLIA_PUBLIC_URL`, proxy-aware cookies and redirects, and the encrypted secret store; (b) App creation via
manifest (and the env path); (c) GitHub sign-in and sessions, replacing human
use of the bearer; (c2) orgs, users, memberships, re-verification, and
per-org scoping of every read and mutation; (d) installations: install link, setup redirect,
webhooks + on-demand listing; (e) `CredentialProvider` + per-job token through
`WorkerLink` into the PR tools. After (e), the existing pinned workers already
push with App tokens, and the repo registry can build on it.

## Non-goals

- Personal access tokens as a grant mechanism. Env `GITHUB_TOKEN` stays only as
  the single-repo daemon's fallback. No PAT paste UI.
- Factory-side roles beyond admin / member, or any ACL granted inside the
  factory. GitHub access is the authorization.
- Hosts other than github.com (GHES later, same App model).
- Spend budgets of any kind (per org, per user). Deferred to a later iteration
  (decided 2026-09-24). See the activation gate under Open questions for the
  interim exposure.

## Open questions

1. **Interim exposure with no budgets.** A public App means any GitHub account
   can install it and commission jobs that spend this factory's model key.
   Recommend a minimal gate until budgets land: a new org starts `pending`, and
   a factory admin (the App's creator) flips it `active` before its jobs can be
   claimed. One switch, not a budget. Drop it if that exposure is acceptable.
2. **Who owns the App:** your personal account or an org? Org ownership survives
   any one person leaving. Recommend an org.
3. **Webhooks required or optional?** Recommend optional, with on-demand
   listing as the source of truth and webhooks only as a cache refresh, so a host
   behind NAT still works.

## Acceptance hint

On a fresh fleet deploy, from a phone: open the console's HTTPS URL, create the
GitHub App in one click, sign in with GitHub, install the App on one selected
repo of an org, commission a job against that repo, and see the PR opened by `<app>[bot]` with a token scoped to that
repo only. No PAT or PEM is typed anywhere. The App's private key appears in no
API response, event-log row, transcript, or child-process environment.
Uninstalling the App from GitHub makes the repo un-commissionable.
A second GitHub user who is a member of that org but has no access to the repo
cannot see its jobs. Removing a user from the GitHub org removes their access in
the console within the re-verification window, or immediately when the webhook
arrives.
