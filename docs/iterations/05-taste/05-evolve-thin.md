---
id: F-55
title: Evolve family, thin
iteration: 05-taste
type: implement
intent: production
status: shipped
dependsOn: []
contracts: [ADR-022]
---

# Feature: Evolve family registrations (thin)

**After:** consolidate-memory, propose-pattern, improve-factory registered
per their GOAL-TYPES cards — exact grants (curate holds the only
memory-write grants; propose-pattern writes provisional-only patterns;
improve-factory may NOT merge anything), kind ceilings linted, minimal
harness sections (the generalize-don't-cache skill line), scripted
registration/lint/grant-refusal tests. Deep harness content + the actual
improvement loop are iteration 6 (recorded on each card). The constitution
lints prove the dangerous-grant invariants: no self-approval, no
merge-to-main grant, provisional-only pattern writes.

Files: evolve family module + skills file. No engine, no contract.

## Build plan (approved)
- [x] Three registrations + skills + lints + grant tests (incl. negative:
  improve-factory refused write_file on a product repo path; propose-pattern
  cannot promote to trusted).

## Implementation notes

Built per rows; opus→human represented honestly (human is an authority gate, not a tier). Dangerous-grant invariants proven by tests; promoting them into the constitution lint is named iteration-6 work.
