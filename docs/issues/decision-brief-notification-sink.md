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

---

> **Fixed (2026-07-07, branch `issue/notify-observe`; pending live proof).** A
> `NotificationSink` (`src/eventlog/notification-sink.ts`) implements the existing
> `EventSink` seam and drops into `buildSinks()` beside `OtlpSink`/`StdoutSink`,
> env-gated by `CORELLIA_NOTIFY_WEBHOOK` (+ optional `CORELLIA_NOTIFY_HEADERS`
> JSON, the same lenient parse as `CORELLIA_OTLP_HEADERS`). It POSTs one compact
> JSON payload per curated event and ignores everything else. The curated set:
> `blocked` (question, options, absolute deadline, `onTimeout`, resolution, and
> the `/intents/<id>/answer` route), `parked` (question + `ttlMs`-derived
> deadline + answer route), `resumed` (answer), `pr-opened` (url + branch), and
> tree terminals — `emitted` **at a tree root only** → `tree-done`/`tree-failed`
> (with blockers), and `partial-delivered` → `tree-partial` (blocked modules).
>
> Fail-open exactly like the OTLP sink: fire-and-forget under a short timeout
> (default 5 s, `AbortController`), every error caught and logged at most once per
> burst, never throws into the fan-out; **no retry** (observability never blocks
> durability). `fetch` is injected for tests.
>
> **Judgment calls (owned per the brief):**
> - *Which events are "brief emitted" / "tree done".* The listener emits both
>   `blocked` (with a `resolution`) and `parked` for a brief; both are notified —
>   `blocked` is the ask, `parked` the safe-default suspension. Tree terminal =
>   `emitted` filtered to ROOT goals only (roots tracked from `goal-received`
>   where `goal.parentId === null`, mirroring how `OtlpSink` learns parenthood),
>   because `emitted` fires for every child on the way up; a child emit is not an
>   operator terminal. `partial-delivered` is the third terminal.
> - *`pr-opened` is notified unconditionally* — it is fired by a granted leaf, so
>   its `goalId` is a leaf, not the root; it is inherently a tree-level happy
>   moment carrying `treeId`/`branch`/`url`, so root-filtering it would drop it.
> - *Payload schema:* a flat, transport-neutral object with a ready-to-render
>   `text` one-liner plus structured fields (Slack/ntfy/Discord/email bridges all
>   accept an incoming webhook). *Retry:* none — one timeout-capped attempt.
> - *Header parse* refactored `parseOtlpHeaders` into a shared `parseJsonHeaders`
>   reused by both sinks (DRY per `_shared.md`).
>
> Unit-proven at the sink seam (`tests/eventlog/notification-sink.test.ts`, 13
> tests): brief -> payload with question/options/deadline/answer-route; park;
> resume; pr-opened; irrelevant events -> no call; tree-done/failed root-only
> (child emit -> no call); tree-partial; header passthrough; fail-open on network
> error and non-ok status; log-once-per-burst + re-arm. buildSinks selection
> proven in `tests/daemon/config-sinks.test.ts` (unset -> not built; set -> built;
> malformed headers tolerated; all three sinks together). Documented in
> docs/observability.md and docs/deploy.md beside the OTLP vars. A live run whose
> block/PR/terminal actually reaches a webhook is the confirming proof.
