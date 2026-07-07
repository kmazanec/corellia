---
type: issue
title: Decision briefs are poll-only — no outbound notification reaches a human
description: A blocked or parked tree waits for someone to poll GET /status; no sink pushes briefs, PR-opened, or tree-done events to a human channel, so "mostly autonomous" stalls on unwatched terminals.
tags: [eventlog, daemon, observability, human-gate, notification]
timestamp: 2026-07-07
status: open
kind: future-work
severity: high
---

# Decision briefs are poll-only — no outbound notification reaches a human

## Problem
DESIGN.md's human contract is push-shaped: "every human touchpoint is a decision
brief with a deadline" and "'ask a human on Slack' is itself just a tool grant."
Today a brief becomes a `blocked`/`parked` event in the log and nothing else — the
human must poll `GET /status` to discover a question exists, then answer via
`POST /intents/:id/answer`. The deadline/TTL machinery is real (daemon `tick()` +
listener park map), so unanswered briefs park safely — but every park that could
have been a five-minute answer is wall-clock and momentum lost. The same silence
covers the run's happy endings: no signal on pr-opened or tree-done either. For
unattended cloud operation this is the difference between an operator who can walk
away and one who babysits a terminal.

## Evidence
- runtime-scout sweep (2026-07-07): grep confirms no Slack/webhook/email/push
  delivery anywhere; briefs discoverable only via GET /status
  (src/daemon/http-server.ts); park/TTL mechanics in src/listener/listener.ts.
- DESIGN.md "The human enters at three named gaps" and "Tools: per goal-type
  grant" (human-on-Slack as a tool grant).

## Proposed direction
A `NotificationSink` implementing the existing `EventSink` seam (drops in beside
OtlpSink/StdoutSink in `buildSinks()`, src/daemon/config.ts) that POSTs a compact
JSON payload to a configured webhook URL (`CORELLIA_NOTIFY_WEBHOOK` + optional
headers) on a small curated event set: brief emitted (with question, options,
deadline, answer endpoint), parked, resumed, pr-opened, tree done/failed. Webhook
first because it is transport-neutral (Slack, ntfy, Discord, email bridges all
speak it); template/channel niceties can come later. Fail-open like every sink —
notification failure never touches durability.

## Acceptance hint
With the env var set, blocking a live tree produces a webhook delivery containing
the brief's question and deadline within seconds, and the PR-opened event for a
finished tree arrives the same way; with the env var unset, behavior is unchanged.
