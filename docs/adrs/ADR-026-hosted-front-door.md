# ADR-026: Hosted front door — daemonized listener, webhook ingress, frozen Brief

**Status:** Accepted · **Date:** 2026-06-12 · **Stretch:** no · **Contract:** yes
**Supersedes:** amends ADR-008's deferral · **Superseded by:** none

## Context

The Listener is a clockless library class — no process, no ingress; only
tests and the live scripts drive it. ADR-008 deferred freezing the Brief
contract "until a second brief surface exists (iteration 6 arc)". Gate-brief
decision (2026-06-12): the factory is a **hosted single-operator
application** — containerized, in the cloud most of the time (PRD §4
amended; multi-tenant and team surfaces stay out). Ingress must serve the
four channels (commissioned intents, signals, merge events, blocker reports)
and the park/answer flow is two-way.

## Options considered

- **Local-only daemon (127.0.0.1)** — rejected: contradicts the hosted
  product direction.
- **Watched file queue** — rejected: park/answer and status become
  file-polling contortions.
- **stdin REPL only** — insufficient alone (terminal-bound, single-client);
  kept as the local-development surface.
- **Webhook-style HTTP ingress + dev REPL** — chosen.

## Decision

A daemon entrypoint wraps the Listener. Ingress is `node:http` (zero-dep):
`POST /intents` commissions, `POST /intents/:id/answer` answers a park,
`GET /status` projects `listener.status()`; every request requires a bearer
token from the environment (ADR-012) — no token, no daemon. The daemon owns
the clock (periodic `tick()`) and the signal handling: SIGTERM finishes or
preserves the in-flight tree (`preserveTree`, never mid-collect teardown)
and exits clean. A REPL mode drives the same listener in-process for local
development. The **Brief contract freezes** into `src/contract/` —
commission input, park (question + TTL + deadline), and answer become typed
contract shapes consumed by listener, daemon, and REPL alike (ADR-008's
single-brief-authority rule unchanged). Substrate: Postgres when
`DATABASE_URL` is set (a container's filesystem is ephemeral), JSONL
otherwise. Container-ready ships this iteration (Dockerfile + compose);
actual cloud deployment is deliberately deferred.

## Tradeoffs & risks

- An authenticated HTTP surface is attack surface; v1 mitigations are the
  bearer token, no TLS termination in-process (the host's proxy owns TLS),
  and no mutating endpoint beyond commission/answer.
- The REPL and webhook share one listener instance — exactly one brief
  authority, preserved by construction.

## Consequences for the build

- Barrier: the Brief contract shapes in `src/contract/`.
- F-62 builds daemon + ingress + REPL; F-66 containerizes it; F-67 drives
  the live evidence through it.
