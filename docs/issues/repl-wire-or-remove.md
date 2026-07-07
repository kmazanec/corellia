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
