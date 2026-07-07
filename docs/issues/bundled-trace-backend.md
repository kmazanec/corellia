---
type: issue
title: Bundle a local trace backend so OTLP has a zero-config graphical view
description: The OTLP exporter works but points at nothing by default; bundling Jaeger (or an OTel collector) in compose gives a free graphical run view today.
tags: [observability, otlp, compose, deploy, ui]
timestamp: 2026-07-07
status: open
kind: idea
severity: low
---

# Bundle a local trace backend so OTLP has a zero-config graphical view

## Problem
The OTLP sink (src/eventlog/otlp-sink.ts) exports real traces, and
docs/observability.md documents Honeycomb/Tempo/Jaeger endpoints — but nothing in
the repo stands a backend up, so the one existing path to a *graphical* view of a
run requires manual infrastructure. Until the first-party operator console exists
(operator-console-ui.md), a bundled trace backend is the cheapest possible visual
surface: a trace waterfall of every goal, attempt, and judge verdict, for one
compose service and one env var.

## Evidence
- runtime-scout sweep (2026-07-07): "the OTLP exporter is the ONE existing path to
  a graphical view of a run; it's just not bundled."

## Proposed direction
An optional compose profile (e.g. `--profile observe`) adding a Jaeger all-in-one
service, with `CORELLIA_OTLP_ENDPOINT` pre-pointed at it, plus a paragraph in
docs/observability.md and docs/deploy.md ("watch a run: open :16686"). Keep it a
profile so default local/prod deploys stay two containers.

## Acceptance hint
`docker compose --profile observe up` then a live run yields a browsable trace of
the goal tree in Jaeger with zero further configuration.

---

> **Fixed (2026-07-07, branch `issue/notify-observe`; pending live proof).** An
> optional `observe` compose profile in `compose.yaml` adds a Jaeger all-in-one
> service (`jaegertracing/all-in-one`, `COLLECTOR_OTLP_ENABLED=true`), exposing
> the UI on `:16686` and the OTLP/HTTP receiver on `:4318`. Because it is behind a
> profile, a plain `docker compose up` stays exactly two containers
> (daemon + postgres) — default deploys are unchanged. The daemon carries
> `CORELLIA_OTLP_ENDPOINT: ${CORELLIA_OTLP_ENDPOINT:-}` (empty default, so the
> OTLP sink is off unless opted in); the watch command sets it to the bundled
> backend:
>
> ```bash
> CORELLIA_OTLP_ENDPOINT=http://jaeger:4318 docker compose --profile observe up
> # open http://localhost:16686
> ```
>
> **Judgment call (owned per the brief): the profile ships ONLY in `compose.yaml`,
> NOT in `compose.deploy.yaml`.** The deploy stack is the standalone production
> file that pulls a pinned GHCR image onto a remote host; bundling an
> unauthenticated all-in-one trace UI there would expose it in production. A
> production operator points `CORELLIA_OTLP_ENDPOINT` (via `.env`) at a real,
> durable backend (Honeycomb, Grafana Tempo, an OTel collector) — already
> documented in docs/observability.md. `compose.deploy.yaml`’s header now records
> this. Jaeger all-in-one is in-memory only (a restart drops traces): a live-watch
> surface, not durable storage — noted in the compose comment and the docs.
>
> **Deviation from the sketch:** the endpoint default is EMPTY rather than
> pre-pointed at `jaeger` on the base service. Pre-pointing would turn the OTLP
> sink ON for a plain `docker compose up` (buffering spans, one DNS-failure
> warning), a behavior change the issue explicitly forbids ("default deploys stay
> unchanged"). Instead the endpoint is set on the profile’s invocation line — one
> env var, still zero standing config.
>
> Validated with `docker compose config`: default services are `postgres`,
> `daemon`; `--profile observe` adds `jaeger` with the OTLP receiver enabled and
> the UI port published. The "watch a run: open :16686" paragraph is in both
> docs/observability.md and docs/deploy.md. A live run rendering as a Jaeger trace
> waterfall is the confirming proof.
