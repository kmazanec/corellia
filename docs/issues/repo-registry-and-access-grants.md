---
type: issue
title: "Repo registry and access grants — pick a repo and grant the factory access from the console"
description: Workers are welded to one mounted checkout and one process-wide GITHUB_TOKEN, so the factory can only work on repos baked into its environment. Add a repo registry in Postgres, per-repo credentials granted from the console UI, and repo-agnostic workers that clone on demand and receive a short-lived token per job.
tags: [operator-console, worker, control-plane, repo-registry, credentials, github, security, adr-051]
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

A `corellia_repos` table the control plane owns: `slug` (`owner/name`, the key
jobs already use), `default_branch`, `status` (`pending` | `ready` | `error` |
`disabled`), `grant_id`, `last_synced_at`, `last_error`, an optional per-repo
spend ceiling, and the detected stack summary. `GET /repos` returns the
registry joined with worker liveness, so a registered repo with zero live
workers still shows (and says why it cannot run).

Console API: `POST /repos` (register by slug), `PATCH /repos/:slug` (ceiling,
disable), `DELETE /repos/:slug` (disable, purge, drop the grant),
`POST /repos/:slug/sync`. Commission validates against the registry, not worker
self-reports.

### 2. Grants (credentials)

Two grant mechanisms behind one interface, `CredentialProvider.tokenFor(repo)`
returning `{ token, expiresAt }`:

- **v1: fine-grained PAT, pasted in the UI.** Works with no public callback URL
  and from a phone today. Stored in Postgres encrypted with AES-256-GCM under a
  host-held key (`CORELLIA_SECRET_KEY` in the host `.env`, per ADR-012: the
  database never holds the key that decrypts it). Never returned by any API,
  never written to the event log, shown only as `…last4` and its validated
  scopes. Validation on save: call GitHub with it, confirm access to the repo
  and that it can push branches and open PRs; reject a token that can also push
  the default branch if the repo has branch protection that would be bypassed
  (warn, not block).
- **Later: GitHub App.** The operator installs the app on chosen repos from the
  UI (install redirect), the control plane mints per-repo **installation
  tokens** (about 1 hour) on demand. Needs a public HTTPS control plane, so it
  waits on TLS and a stable hostname; strictly better (per-repo scope, no
  long-lived secret, revocation in GitHub) and should be the default once
  possible.

The registry never stores which mechanism is "better"; a repo's grant is just a
`grant` row with `kind: 'pat' | 'app-installation'`.

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

### 4. Delivering the token to the engine

Extend `WorkerLink.claim` to return `{ job, credential: { token, expiresAt } }`
(WorkerLink is a contract; this is a contract change and wants an ADR). The
worker holds the token in memory for the job and passes it to the PR tools
through an explicit per-job credential argument rather than `process.env`. Keep
the existing `GIT_ASKPASS` mechanism and the scrub guarantees; refresh the token
at tool-call time if it is within a few minutes of expiry (matters for App
tokens on long jobs). `GITHUB_TOKEN` in the env remains as a deprecated global
fallback for the single-repo daemon so existing deploys keep working.

### 5. Safety rails

- **Allowlist only.** A repo is workable only if registered and `ready`; no job
  can name an arbitrary slug, and the PR tools refuse any remote not equal to
  the registered repo's origin.
- **Never the default branch.** The factory pushes job branches and opens PRs;
  `push_branch` refuses the registered default branch regardless of what the
  token allows.
- **Disable and revoke are first-class.** Disabling a repo stops claims
  immediately, lets in-flight jobs preserve their worktrees (ADR-026), and
  optionally purges the clone and deletes the grant.
- **Audit events.** `repo-registered`, `repo-grant-rotated`, `repo-disabled`
  land in the event log with actor and slug, never a secret. The secret-value
  diff gate ([secret-value-diff-gate](secret-value-diff-gate.md)) stays the
  backstop against a token leaking into a commit.
- **Auth.** The console's bearer is a single shared `FRONT_DOOR_TOKEN`. That is
  acceptable for one operator, but it now gates credential entry, so the issue
  notes it as the next thing to harden (per-operator tokens or login) and does
  not solve it here.

### 6. UI

A Repos view in the console (phone-friendly, since that is the motivating use):
list with status chip, last sync, live workers, spend; "Add repo" (slug +
token paste, validate and show what the token can do); per-repo detail (rotate
grant, set ceiling, sync, disable/remove). The commission form's repo field
becomes a picker over `ready` repos.

### Slicing (dependency order)

(a) registry table + API + commission validated against it, still served by
today's pinned workers, so nothing breaks; (b) encrypted grant store +
`CredentialProvider` + PAT validation; (c) WorkerLink `claim` returns the
credential, PR tools take a per-job credential; (d) repo-agnostic workers with
managed clones and the slug-keyed event log; (e) the Repos view; (f) GitHub App
provider behind the same interface.

## Non-goals

- Non-GitHub hosts (GitLab, Bitbucket). The provider interface leaves room; v1
  is GitHub.
- Non-Node target repos. The image ships Node only and target scripts run inside
  it (`.env.example`, "v1 CONSTRAINT"). Registration should detect the stack and
  show an unsupported-stack warning rather than fail late in a job.
- Multi-tenant isolation. One operator, one trust domain; per-operator access
  control is separate follow-on work.
- Letting a job run against a repo in a different org than its grant.

## Open questions

1. **PAT first or App first?** Recommend PAT first (works without TLS/public URL,
   unblocks phone-only setup), App second behind the same interface.
2. **Clone location for multiple workers on one host.** A shared volume means
   concurrent `git fetch` on one clone; recommend a bare mirror per repo with
   per-job worktrees off it and a per-repo fetch lock.
3. **Does the single-repo daemon (`src/daemon/daemon.ts`) get the registry?**
   Recommend no: the registry is a fleet/control-plane feature; the daemon keeps
   its env-pinned repo.
4. **Per-repo secrets for the target's own scripts** (env a repo's tests need).
   Out of scope here; likely its own issue once grants exist.

## Acceptance hint

From a phone browser on a freshly deployed fleet, with no ssh and no `.env` edit
after the first deploy, an operator can: add `owner/some-repo` and paste a
fine-grained token in the console; see it go `ready` with the token's validated
access; commission a job against it; watch a worker clone it and the job open a
PR on a job branch (never the default branch); then disable the repo and see
claims stop. At no point does the token appear in any API response, event-log
row, worker transcript, or child-process environment.
