---
type: issue
title: Daemon REPL is built and tested but never wired into the entrypoint
description: startRepl exists with tests and a comment in daemon.ts promising "REPL mode (when enabled)", but nothing enables it — a dead surface that should be wired behind a flag or deleted.
tags: [daemon, repl, front-door, dead-code]
timestamp: 2026-07-07
status: open
kind: idea
severity: low
---

# Daemon REPL is built and tested but never wired into the entrypoint

## Problem
`src/daemon/repl.ts` implements a stdin readline REPL (commission / answer /
status) sharing the same Listener as the HTTP front door, exercised by
tests/integration/front-door.test.ts and tests/daemon/repl.test.ts — but
`daemon.ts` never imports it despite its comment saying "REPL mode (when
enabled)". Operators commission via curl even when sitting at a local terminal;
meanwhile the surface rots untested-in-anger. Either wiring it or deleting it is
fine; the current half-state is the only wrong answer.

## Evidence
- runtime-scout sweep (2026-07-07): "startRepl is exercised only by tests and is
  NOT imported/wired into daemon.ts."

## Proposed direction
Wire it behind an explicit opt-in (`CORELLIA_REPL=1` and/or a `--repl` flag, only
when stdin is a TTY), sharing the already-constructed Listener; it must never
block daemon startup or interfere with headless/container runs (containers keep
it off by default). If on reflection the local-dev flow is fully served by
commission:run + logs --follow, delete repl.ts and its tests instead.

## Acceptance hint
`CORELLIA_REPL=1 npm run daemon` (local TTY) accepts commission/answer/status at
the prompt against the live Listener, while the container/headless path is
byte-for-byte unchanged — or the REPL is gone.

---

> **Fixed (2026-07-07, branch `issue/small-fixes`; pending live proof).** WIRED,
> not deleted. `daemon.ts` now imports `maybeStartRepl` and calls it once the
> HTTP server is listening, sharing the already-constructed Listener (ADR-008: one
> brief authority). Two new functions in `src/daemon/repl.ts`:
> - `replEnabled({ env, stdinIsTTY })` — the opt-in gate: true ONLY when
>   `CORELLIA_REPL === '1'` AND stdin is a TTY. A container/CI/piped run (stdin not
>   a TTY) keeps the REPL off even with the flag set, so the headless path is
>   byte-for-byte unchanged. Default off.
> - `maybeStartRepl(opts)` — starts the REPL iff the gate passes, wrapped so a
>   start failure is logged and swallowed: a broken REPL can never throw into — or
>   block — daemon startup, and the HTTP front door stays up regardless. Returns
>   the readline Interface (held by the daemon for SIGTERM close) or undefined.
>
> The daemon holds the REPL handle only to `repl.close()` it on SIGTERM; on the
> default headless path the handle is undefined and nothing touches stdin.
>
> **Judgment call — wire, not remove.** The task directed wiring over deletion;
> the local-dev flow (commission/answer/status at a prompt against the live
> Listener) is genuinely served by the REPL, and the double gate makes it
> zero-cost for headless/container runs. The env var name `CORELLIA_REPL=1`
> matches the issue's proposed opt-in; no `--repl` flag was added (the env var is
> the single, sufficient switch and matches the acceptance hint's invocation).
>
> Tested at the daemon seam (`tests/daemon/repl-gate.test.ts`): the gate truth
> table (flag+TTY only; flag-unset, no-TTY, and non-"1" values all off), the
> headless default returning undefined, and a flag+TTY start driving a `status`
> command against the SAME injected Listener then closing cleanly. The existing
> `tests/daemon/repl.test.ts` (piped commission/answer/status + single-authority
> invariant) is unchanged and still green. A live `CORELLIA_REPL=1 npm run daemon`
> at a terminal is the confirming proof.
