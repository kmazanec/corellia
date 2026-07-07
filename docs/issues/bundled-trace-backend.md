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
