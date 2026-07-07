---
type: iteration
title: "Iteration 21 — The cloud-ready wave: deploy path, model catalog, tree deadline, observability, and the resilience rungs"
description: One orchestrated wave (nine hand-built features on parallel worktree branches, reviewed and folded into feat/cloud-ready) closing the highest-leverage gaps between the factory and unattended cloud operation — package/ship/run the daemon anywhere, pick models by capability and cost, stop wall-clock starvation, watch a run live, export traces, and stop the four run-killing failure modes (integration-seam blocks, null-dive cascades, empty-artifact blocks, all-or-nothing roots).
tags: [iteration, factory, deploy, model-catalog, wall-clock, observability, partial-delivery, repair-integration, bootstrap]
timestamp: 2026-07-06
status: merged to main; live proofs pending
---

# Iteration 21 — The cloud-ready wave

## Source

Operator directive (2026-07-06): pick the highest-leverage open issues whose
decisions are clear, and make Corellia ready to run in the cloud, accept goals,
and accomplish them autonomously — plus rework model-tier selection into a
many-model, capability/cost-tagged scheme. Built as one orchestrated wave:
nine features on parallel worktree branches under `.claude/worktrees/`, each
reviewed (one gating review finding, fixed before merge) and folded into
**`feat/cloud-ready`** with linear history. Main untouched; the branch awaits
operator review before merging.

## What shipped (15 commits, ADR-044…048)

1. **Deploy the factory end-to-end** (ADR-045; issue `deploy-the-factory-end-to-end`).
   `.dockerignore`; `docker:*` operator scripts; the repo's first CI
   (`.github/workflows/build-image.yml`: test job gating buildx → GHCR with
   `latest`/`sha-<short>`/semver tags); standalone published-image
   `compose.deploy.yaml` (deliberately not a merge overlay — compose cannot
   remove a base `build:`); `scripts/deploy.sh` (SSH pull → SIGTERM drain →
   recreate → verify `/status`, `--rollback <tag>`); `docs/deploy.md` runbook
   (state placement/backup, host secrets, target-repo landing, observability).
2. **Model catalog** (ADR-044; issues `model-capability-signal`, operator ask).
   `src/brains/model-catalog.ts`: ~10 models tagged capability/cost/context/
   vision/tool-calling, optional per-model endpoint (local models — Ollama
   example in `.env.example`) and provider pin. `resolveModel(tier, needs)`
   filters by needs, bands by capability, picks cheapest satisfying, falls
   upward never down. Tier stays the contract's demand band; explicit
   `CORELLIA_MODEL_*` pins stay authoritative (the wave's one gating review
   finding — cheapest-in-band was silently overriding operator pins);
   `CORELLIA_MODELS_JSON` extends/patches. Per-tier tool-call-failure signal in
   `renderReplay`/trace flags a tier whose model fails tool calls.
3. **Wall-clock is one tree-wide deadline** (ADR-046; issue
   `comprehension-region-wallclock-exhaustion`, starvation half — three runs of
   evidence called it the top blocker to a commission shipping end-to-end).
   `wallClockMs` no longer subdivides; the root fixes one deadline on the shared
   `TreeState` beside the dollar ceiling, the attempt loop checks that single
   deadline, and the comprehension-only floor carve-out is deleted. Per-leaf
   starvation in wide fan-outs is impossible by construction.
4. **`corellia logs` CLI + EventSink fan-out** (issue
   `observability-pluggable-tracing`, parts 1+2). `scripts/corellia.ts`
   dispatcher; `logs [path]` replay over shared `src/eventlog/render.ts`;
   `--follow` live tail (offset-tracked incremental JSONL reads, partial-line
   carry, fs.watch + polling fallback, rotation reset). `EventSink` beside the
   store contract; `SinkFanoutStore` decorator (append first, sinks best-effort);
   stdout ndjson sink behind `CORELLIA_SINK_STDOUT`.
5. **OTLP trace exporter** (same issue, vendor-adapter half). Dependency-free
   OTLP/HTTP JSON exporter (`otlp-sink.ts` + pure `otlp-encoding.ts`):
   goal tree → spans (deterministic ids from goal ids), batched fire-and-forget
   POSTs, flush-with-incomplete-marker, env-gated on `CORELLIA_OTLP_ENDPOINT`.
   Reaches Grafana Tempo / Honeycomb / Datadog with zero SDKs. LangSmith
   adapter remains open (documented mapping).
6. **Repair rung at the integrate edge** (ADR-047; issue
   `repair-integration-rung`). A failed `judge-integration` with actionable
   findings spawns ONE `implement` child scoped to the union of the failing
   children's scopes, fed the findings verbatim, then re-judges once; escalated
   findings still skip to block. Reused `implement` per DESIGN ("the fixer is
   not a new type") — the issue's sketch of a new goal type was deliberately
   not taken.
7. **Structural floor for null dives** (issue
   `dive-anchor-hallucination-blocks-region`, final open half). The ADR-037
   fatal-dependency block now classifies: a null **learn**-dep (comprehension
   dive) no longer hard-blocks its dependent — the builder proceeds on a
   mechanical floor (file list + sizes + regex-grade exported symbols, capped
   at 300 with explicit truncation note) injected as labeled provisional
   memories; a null **make**-dep still hard-blocks. The cascade was narrowed,
   not weakened.
8. **Ship-what's-green partial delivery** (ADR-048; issue
   `partial-delivery-on-blocked-dependency`, downstream half; also the
   degraded-delivery half of `design-arch-empty-artifact-block`). At root
   collection, a tree with real green work whose only blockers are child-module
   blocks collects the green subtree (PR path) with the blocked modules
   enumerated in the report/commit body and a `partial-delivered` event. A
   root-level judge failure still gates; an all-blocked tree preserves as
   before.
9. **Empty-artifact diagnosis** (issue `design-arch-empty-artifact-block`,
   diagnosis half). `produce()` classifies a non-delivery (truncated / refusal /
   parse-drop / empty-response), re-asks the same model once, falls back to the
   mid band (catalog/pin-aware), and if still empty tags the artifact with
   `emptyDiagnosis` — the deterministic gate names the stable cause (raw sample
   kept out of the failure signature so isomorphism detection still works) and
   the block brief carries cause + sample.
10. **Ergonomics batch** (five issues): duplicate reads return the cached
    result inline; per-target-repo default event-log path; conservative
    worktree reaper (merged+clean only by default, dirty always preserved,
    `CORELLIA_REAP_WORKTREES=1` widens to clean-unmerged) with a
    `worktree-reaped` event; descriptive conventional collect commits derived
    mechanically from the goal tree; `files-touched` event enumerating every
    changed file vs declared scope at collection.

## Verification

Full `npm test` on the merged branch: 2156 tests — green except the known
git-heavy scripted tests (`convergence*`, `pr-boundary`) timing out only under
full-parallel suite load; each passes in isolation (filed as
[test-suite-parallel-load-timeouts](../../issues/test-suite-parallel-load-timeouts.md)).
Typecheck, constitution lint, and docs lint clean throughout; every branch was
reviewed before folding (one gating finding: catalog pin precedence — fixed).

## Still open / operator steps

- **Live proofs**: every issue touched is `fixed-pending-live-proof` — the
  proving runs (a commission through the daemon, the CI→GHCR push, a clean-host
  deploy on the VPS, an OTLP trace into a real collector) are operator steps.
- **Vision needs**: the catalog resolves `needs.vision`, but the ADR-042
  screenshot-judge call site does not yet set it (recorded in ADR-044).
- **Not attempted** (need operator input or are gated): `operator-console-ui`,
  `deployment-to-live-url` (goal family), `greenfield-bootstrap`,
  `semantic-retrieval-vector-store`, `external-asset-acquisition`,
  `ground-fact-external-knowledge`, milestone steps 7 (live proof) and 8
  (gated on 7), `collect-review-manifest` (extends files-touched; next).
