---
type: issue
title: "Repo registry and access grants — pick a repo and grant the factory access from the console"
description: Workers are welded to one mounted checkout, so the factory can only work on repos baked into its environment. Add a repo registry in Postgres, fed by the GitHub App's installations, and repo-agnostic workers that clone on demand and run each job with that repo's short-lived App token. Builds on github-app-identity-and-grants.
tags: [operator-console, worker, control-plane, repo-registry, github-app, github, security, adr-051]
timestamp: 2026-09-24
status: open
kind: future-work
severity: high
---

# Repo registry and access grants — pick a repo and grant the factory access from the console

## Problem

The set of repos the factory can touch is fixed when the host is provisioned,
not chosen by the operator. To point it at another repo you ssh in, clone it,
edit `.env`, and redeploy. That is the wrong shape for a factory meant to run
"updates and commands on any repo", and it is a hard blocker for operating from
anywhere but a laptop with deploy keys.

Three couplings cause it:

- **A worker is welded to one checkout.** `src/daemon/worker.ts` takes
  `CORELLIA_REPO_ROOT` (a bind-mounted host path) and builds its `Listener`
  with that single `repoRoot`. Its served repo keys come from
  `CORELLIA_WORKER_REPOS`, else the checkout's `origin` slug.
- **Repo knowledge is whatever workers report.** The console's `GET /repos`
  (`console/server/src/api/fleet-routes.ts`) is derived from registered workers'
  `repos` arrays, and `POST` commission is refused with 422 unless a live
  worker already serves `req.repo` (`commands-routes.ts:72`). There is no
  registry the operator can add to.
- **Git credentials are one process-wide env var.** `push_branch` and `open_pr`
  (`src/engine/pr-tools.ts`) read `GITHUB_TOKEN` from `process.env` at execute
  time. One token, every repo, set at deploy. `scrubEnv`
  (`src/engine/assembly.ts`) correctly keeps it out of child processes, so the
  mechanism to preserve is "token is read at the tool boundary, never in a
  transcript or child env", not the env var itself.

## Depends on

[github-app-identity-and-grants](github-app-identity-and-grants.md). That issue
supplies who the operator is (GitHub sign-in), which repos have been granted
(App installations), and the per-job credential
(`CredentialProvider.tokenFor(repo)` delivered through `WorkerLink.claim`). This
issue owns *which* granted repos the factory works on and *where* the work runs.
It is the next iteration after the App, not part of it.

## Evidence

- `docs/issues/operator-console-ui.md` requirement 8 ("a repo registry beyond
  what workers report") is the still-open remainder of that issue.
- `docs/deploy.md` §6 and §9: the target repo is cloned on the host by hand and
  mounted at `/workspace`; every worker shares that one mount.
- ADR-051 already names "the repo registry" as a control-plane responsibility
  (Roles) but no iteration has built it.

## Proposed direction

> A loose shape for a planning pass to confirm or reject, not a committed plan.

### 1. Registry (control plane, Postgres)

Installing the App grants *access*. Enabling a repo in the registry is the
separate, deliberate step that says "the factory works here". An org might
install on fifty repos and enable three.

A `corellia_repos` table the control plane owns: `slug` (`owner/name`, the key
jobs already use), `org_id` (the App issue's org, i.e. the installation), `enabled_by` (GitHub user, an org admin), `default_branch`,
`status` (`pending` | `ready` | `error` | `disabled` | `revoked`),
`last_synced_at`, `last_error`, an optional per-repo spend ceiling, and the
detected stack summary. A repo can only be enabled by an admin of its org, and
only if the org's installation currently covers it.
When the installation drops the repo (uninstall, deselect, suspend), the row
goes `revoked` and claims stop. `GET /repos` returns the registry joined with
worker liveness, scoped to the caller's org and filtered to the repos they can
access on GitHub.

Console API: `GET /repos/available` (granted but not enabled, per user),
`POST /repos` (enable), `PATCH /repos/:slug` (ceiling, disable),
`DELETE /repos/:slug` (disable and purge the clone), `POST /repos/:slug/sync`.
Commission validates against the registry, not worker self-reports.

### 2. Grants

Owned by [github-app-identity-and-grants](github-app-identity-and-grants.md):
installations, the user-visible repo set, and per-repo installation tokens.
This issue only consumes them.

### 3. Repo-agnostic workers

- Workers drop the welded `CORELLIA_REPO_ROOT`. A managed workspace root
  (`CORELLIA_WORKSPACE_ROOT`, a named volume, default `/var/lib/corellia`)
  holds one clone per repo at `<root>/repos/<owner>/<name>`.
- `claim` stops filtering on a fixed `repos` array. A worker serves `*` (any
  registered, `ready` repo) or an optional allowlist; the claim query joins the
  registry so a disabled repo is never claimed.
- On claim the worker ensures the clone (`git clone` on first use, `git fetch`
  after), builds the per-job `Listener`/sandbox with that path as `repoRoot`,
  and runs as today in its own worktree. Worktree-per-tree (ADR-016),
  preserve-on-SIGTERM (ADR-026), and parked-job affinity (ADR-051) are
  unchanged; affinity now also implies "the worker with that clone".
- Event-log namespacing: `buildStore` namespaces by the basename of
  `CORELLIA_REPO_ROOT`, which collides for `a/widgets` and `b/widgets`. Key by
  the full slug.

### 4. Credentials per job

Already delivered by the App issue: `claim` returns a repo-scoped installation
token, and the PR tools take it per job. The new piece here is that the worker
also uses that token for its own `git clone` / `git fetch` of the managed clone,
through the same `GIT_ASKPASS` path, so no long-lived credential sits on the
worker.

### 5. Safety rails

- **Allowlist only.** A repo is workable only if registered and `ready`; no job
  can name an arbitrary slug, and the PR tools refuse any remote not equal to
  the registered repo's origin.
- **Never the default branch.** The factory pushes job branches and opens PRs;
  `push_branch` refuses the registered default branch regardless of what the
  token allows.
- **Disable and revoke are first-class.** Disabling a repo in the console, or
  the installation losing it on GitHub, stops claims immediately and lets
  in-flight jobs preserve their worktrees (ADR-026). An in-flight job's token
  stops refreshing, so it cannot keep pushing past revocation. Purging the clone
  is optional.
- **Audit events.** `repo-enabled`, `repo-disabled`, `repo-revoked`
  land in the event log with actor and slug, never a secret. The secret-value
  diff gate ([secret-value-diff-gate](secret-value-diff-gate.md)) stays the
  backstop against a token leaking into a commit.

### 6. UI

A Repos view in the console (phone-friendly, since that is the motivating use):
list with status chip, last sync, live workers, spend; "Add repo" picks from
the repos the user's installations grant (with a "Grant more on GitHub" link to
the App's install page); per-repo detail (set ceiling, sync, disable/remove). The commission form's repo field
becomes a picker over `ready` repos.

### Slicing (dependency order, after the App iteration)

(a) registry table + enable/disable API + commission validated against it,
still served by today's pinned workers, so nothing breaks; (b) revocation sync
from installation changes; (c) repo-agnostic workers with managed clones,
token-authenticated fetch, and the slug-keyed event log; (d) the Repos view and
the commission picker.

## Non-goals

- Non-GitHub hosts (GitLab, Bitbucket). The provider interface leaves room; v1
  is GitHub.
- Non-Node target repos. The image ships Node only and target scripts run inside
  it (`.env.example`, "v1 CONSTRAINT"). Registration should detect the stack and
  show an unsupported-stack warning rather than fail late in a job.
- Grant mechanics (installations, tokens, sign-in). The App issue owns them.
- Isolation between users' jobs on the worker side. Workers are one trust
  domain. Visibility is per user (GitHub's access); execution is shared.

## Open questions

1. **Clone location for multiple workers on one host.** A shared volume means
   concurrent `git fetch` on one clone; recommend a bare mirror per repo with
   per-job worktrees off it and a per-repo fetch lock.
2. **Does the single-repo daemon (`src/daemon/daemon.ts`) get the registry?**
   Recommend no: the registry is a fleet/control-plane feature; the daemon keeps
   its env-pinned repo.
3. **Per-repo secrets for the target's own scripts** (env a repo's tests need).
   Out of scope here; likely its own issue once grants exist.

## Acceptance hint

From a phone browser on a fleet that already has the GitHub App, with no ssh and
no `.env` edit: a signed-in user installs the App on a new repo, sees it under
"available", enables it, and commissions a job against it. A worker that has
never seen the repo clones it with the job's installation token and opens a PR
on a job branch, never the default branch. Removing the repo from the
installation on GitHub flips it to `revoked` and claims stop. A second user
without GitHub access to that repo never sees it in the console.
