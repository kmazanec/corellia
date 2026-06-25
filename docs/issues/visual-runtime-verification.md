---
type: issue
title: "B2. Verifying anything npm test cannot — VISUAL / RUNTIME / PDF-OUTPUT correctness"
description: The factory's only verification rung is the declared script runner; it cannot render, screenshot, open a PDF, or drive a running server and judge the result.
tags: [structural, verification, vision]
timestamp: 2026-06-25
status: open
kind: future-work
severity: high
---

# B2. Verifying anything npm test cannot — VISUAL / RUNTIME / PDF-OUTPUT correctness

## Problem
The factory's only verification rung is the declared script runner (`npm test` /
`typecheck` / `lint`). It cannot *render*, *screenshot*, *open a PDF*, or *drive a
running server* and judge the result. The most important correctness properties of
this product were invisible to it. (Marked ⭐ biggest gap in the source.)

## Evidence
Operator did: rendered the filled 1040 to an image and eyeballed every line to
confirm the AcroForm field→line map (a transposed field silently puts money on the
wrong line — no unit test catches it); screenshotted the UI to catch a
swapped-column regression; drove a live HTTP conversation to confirm the agent
actually tool-calls. Source: `docs/gaps-from-tiutni.md` §B2.

## Proposed direction
A **visual/runtime verification rung** — a tool that can (a) start the app and hit
endpoints, (b) render a produced PDF/page to an image, and (c) feed that image to a
vision-capable judge with the acceptance criteria.

## Acceptance hint
A goal can verify a visual/behavioral acceptance criterion: the rung starts the app
or renders the output, captures an image, and a vision judge gates on it — no human
eyeball required.
