---
type: issue
title: "Milestone loop step 8 — depth-capped slice-nesting"
description: Turn on iterative slice-children at depth < 1 with the shared $15 ceiling as the bound; gated to come AFTER step 7 proves the flat loop.
tags: [milestone-loop, engine]
timestamp: 2026-06-25
status: open
kind: future-work
severity: medium
---

# Milestone loop step 8 — depth-capped slice-nesting

## Problem
Slice-nesting (a milestone round spawning `iterative:true` feature-slice children,
each looping against a subset of the frozen criteria while the root keeps the
cross-cutting/integration criteria) is shaped in the spec but **turned off**. It is
the final build step and is explicitly gated to land only AFTER the flat root-loop
is proven live (step 7).

## Evidence
docs/iterations/2026-06-24-03-milestone-loop/spec.md §4.5, §6, and §8 build sequence step 8 (UNBUILT). The
spec is explicit: "Lands as build-sequence step 8, a distinct late step AFTER the
flat root-loop is proven via live:self (step 7). Not interleaved."

## Proposed direction
Enable `iterative:true` slice children at `depth < 1` (engine-enforced depth cap of
1: root + one slice layer; a slice may not spawn iterative children). Confirm the
shared $15 `TreeState` ceiling bounds the root × slice round product
(`checkCeiling` at the top of each round and each nested child). Prove via
`live:self` on a cleanly-partitionable intent.

## Acceptance hint
A cleanly-partitionable intent commissioned via `live:self` spawns depth-1 iterative
slice children that converge under the shared $15 ceiling, with the root owning the
integration criteria — proven only after step 7 has passed.
