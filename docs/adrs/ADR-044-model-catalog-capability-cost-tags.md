---
type: adr
title: "ADR-044: A capability/cost-tagged model catalog replaces the hardwired three-tier model env vars"
description: The brain hardwired one model per Tier from three env vars (CORELLIA_MODEL_LOW/_MID/_HIGH), so it could not pick a model by capability — a vision-needing screenshot judge and a cheap text leaf both got the band's single model regardless of fit. A capability/cost-tagged catalog (src/brains/model-catalog.ts) plus a deterministic resolveModel(tier, needs) picks the cheapest model in the demanded band that satisfies a call's needs (vision, context, tool-calling), falling upward when the band cannot. Tier stays the abstract capability-demand band; the catalog decides the concrete model. Per-model endpoint overrides let local models join. A per-tier tool-call signal in the trace surfaces a band whose model is failing tool calls.
tags: [adr, brain, model-catalog, tier, cost, capability, vision, local-models, signal, additive, adr-005, adr-042]
timestamp: 2026-07-06T18:15:00-05:00
---

# ADR-044: A capability/cost-tagged model catalog replaces the hardwired three-tier model env vars

**Status:** Accepted · **Date:** 2026-07-06 · **Stretch:** no · **Contract:** yes
**Relates to:** ADR-005 (per-tier provider routing), ADR-017 (measured spend, never estimated),
ADR-042 (runtime/visual verification — the vision consumer), issue D2 (no model-capability signal)

## Context

The live brain mapped each `Tier` (`low | mid | high`) to exactly one model id,
read from three env vars — `CORELLIA_MODEL_LOW/_MID/_HIGH` — with hardwired
defaults (`deepseek-v4-flash` / `deepseek-v4-pro` / `glm-5.2`). Every call at a
tier got that tier's one model. `src/brains/llm.ts` looked up
`config.modelByTier[ctx.tier]` at each of its five brain methods and its step
loop; `src/brains/openrouter.ts` built the map from env.

This cannot express capability. The motivating example: GLM-5.2 is a strong,
cheap model but has **no image input**; a `screenshot-ui` acceptance criterion
(ADR-042) must be judged by a **vision-capable** model. Under the three-slot
scheme the only way to get vision into the high band was to swap the whole band's
model — losing GLM everywhere to serve one image judge — or to give up and judge
blind. Symmetrically, an expensive vision model at a band is pure waste on the
overwhelming majority of calls that never touch an image. The tier is the right
*abstraction* (a capability-demand band the control loop escalates along); the
defect is that a band resolved to a model by an arbitrary slot rather than by what
the call actually needs and what each model actually offers.

A second, related gap (issue D2): when a band's model is weak at tool-calling, a
run can total-block with nothing surfacing *why*. There was no per-tier signal
connecting "this band keeps failing tool calls" to "re-tag or replace its model."

## Decision

**1. Keep `Tier` in the contract untouched.** Goal-types, events, the escalation
ladder, and the event-parser keep speaking `low | mid | high`. Tier remains the
abstract capability-demand band; a new registry decides which concrete model
serves a band for a given call. No schema churn.

**2. A capability/cost-tagged catalog — `src/brains/model-catalog.ts`.** A
`ModelSpec` tags each model with `capability` (1–10), input/output cost per Mtok,
`context`, `vision`, `toolCalling` reliability, and optional `endpoint` (a
per-model baseUrl/apiKeyEnv override — this is what lets a **local** model join),
`provider` pin (the ADR-005 shape), and `requestTimeoutMs`. **The cost/capability
/context numbers are catalog METADATA — approximate, for ranking only, never
billing truth** (measured spend still comes from provider usage accounting, ADR-017).
A `DEFAULT_CATALOG` of ten OpenRouter-reachable models spans the cost/capability
spectrum, including the three prior defaults.

**3. `resolveModel(tier, needs, catalog)` — deterministic.** It (a) filters the
catalog to models satisfying every present `ModelNeeds` (`vision`, `minContext`,
`minToolCalling`); (b) bands each survivor by capability on FIXED thresholds
(1–3 → low, 4–6 → mid, 7–10 → high — a model's band is a property of the model,
not of the current catalog, so bands don't shift as entries are added); (c)
starting at the demanded tier and walking UPWARD, returns the CHEAPEST satisfying
model in the first non-empty band; (d) **never falls downward** — a `high` demand
is never served by a lower band — and throws when nothing from the demanded band
up satisfies, rather than silently degrading. Ties break by higher capability then
id, so resolution is fully deterministic.

**4. `needs` flows through `BrainContext`.** `ModelNeeds` lives in the contract
(`src/contract/goal.ts`) beside `Tier`; `BrainContext.needs` is optional and
default-absent. The brain resolves `(ctx.tier, ctx.needs)` per call. The vision
consumer is ADR-042's `screenshot-ui` judge: a judge whose subject includes an
image sets `needs.vision = true` and lands on a vision-capable model regardless of
band. **Deviation from the brief, recorded:** the seam is fully plumbed and tested
(a `judge` call with `needs.vision` resolves to the vision model), but the
engine-side flip that *sets* `needs.vision` on the screenshot-judge call is left
to the ADR-042 capture-judge path — threading vision-detection through the whole
integration/round judge chain is a larger, separate change, and the safe, minimal
move here is to land the resolution surface with its first consumer ready, not to
refactor the judge dispatch. Until then every call resolves with empty needs,
which reproduces prior banded behaviour exactly.

**5. Env override surface (`openrouter.ts` builds the catalog).**
`CORELLIA_MODELS_JSON` (inline JSON array or a path to a JSON file) merges into the
default catalog **by id** — a partial entry patches a default's fields; a new id is
appended with conservative defaults for omitted fields (so `{id, endpoint}` alone
is a usable local model). Backward compat: `CORELLIA_MODEL_LOW/_MID/_HIGH` still
work — each PINS its band's preferred model id, adding a bare conservatively-tagged
entry if the id is unknown. The band pins also populate `modelByTier`, which the
engine's golden-candidate provenance sites still read to name the resolved model on
events. `modelByTier`-only configs (no catalog) resolve through a synthetic
single-entry-per-band catalog, so tier-only behaviour is byte-identical.

**6. Per-tier tool-call signal (covers issue D2).** A `toolCallSignal` projection
(`src/eventlog/projections.ts`) folds per-tier `step`, `malformation-reprompt`,
`transport-retry`, `tool-call` ran/refused, and `tier-escalated` counts, and
`scripts/trace.ts` prints them, **flagging a tier whose malformed-tool-call rate
crosses 20%** ("this tier is failing tool calls — consider re-tagging its model").
Attribution is honest about what the events support: no event stamps a model id on
a step, so a goal's tier is reconstructed by replaying `tier-escalated` /
`judge-verdict` anchors, unobservable goals bucket as `unknown`, and the
tier→model mapping is reported alongside as the only bridge from a flagged tier to
a concrete model to re-tag.

## Options considered

### A. Capability/cost-tagged catalog + deterministic resolver — chosen
Expresses the real axes (capability, cost, vision, context, tool-calling) the
operator reasons about, keeps `Tier` as the stable escalation abstraction, and
makes the per-call model a deterministic function of demand and needs. Local
models and alternate providers join by data, not code.

### B. Replace the `Tier` type across events with a full model/capability descriptor — rejected
Threading a capability descriptor through goal-types, events, the parser, and the
escalation ladder is broad schema churn for no payoff the catalog doesn't already
deliver: the control loop still needs an ordinal band to escalate along, and that
band is exactly `Tier`. The catalog gives capability-aware selection *without*
disturbing the one abstraction the loop depends on.

### C. Pure per-goal-type model pinning — rejected
Pin a model per goal-type instead of per band. This hardcodes choices the factory
should reason about: it carries no cost or capability information, cannot pick the
cheapest model that clears a bar, cannot fall back on a need it can't meet, and
multiplies config surface by the number of goal-types. The catalog reasons; a pin
only remembers.

## Consequences

- **Contract:** `src/contract/goal.ts` gains `ModelNeeds`; `src/contract/brain.ts`
  `BrainContext` gains optional `needs`. `Tier` is unchanged.
- **Brain:** new `src/brains/model-catalog.ts` (`ModelSpec`, `ModelNeeds`,
  `resolveModel`, `bandForCapability`, `assembleCatalog`, `DEFAULT_CATALOG`).
  `src/brains/llm.ts` resolves `(tier, needs) → ResolvedModel` at every model
  lookup and reads baseUrl/apiKey/provider/timeout from it at both fetch sites;
  `LlmBrainConfig` gains `catalog?`, keeps `modelByTier` as legacy pins.
  `src/brains/openrouter.ts` builds the catalog and pins from env.
- **Signal:** `src/eventlog/projections.ts` gains `toolCallSignal`; `scripts/trace.ts`
  prints and flags it. Covers issue D2.
- **Behaviour change — default (no-pin) model per band.** With no
  `CORELLIA_MODEL_<BAND>` pin, a band now resolves to its CHEAPEST satisfying
  catalog default, which for low/mid is a cheaper qwen entry than the prior
  deepseek defaults (high stays `glm-5.2`). A pin restores an exact model. This is
  intended: the catalog optimises cost within a band by construction. Documented
  in `.env.example`; the two default-model tests were updated to the new
  resolutions.
- **Local models are now first-class:** a `CORELLIA_MODELS_JSON` entry with
  `endpoint.baseUrl: http://localhost:11434/v1` (Ollama) routes to a local
  endpoint with no code change.

## Tradeoffs & risks

- **Catalog metadata drifts from reality.** Costs and capabilities are hand-curated
  approximations and will age. They only affect *ranking within a band*, never
  billing (ADR-017) or correctness; the per-tier tool-call signal is the feedback
  loop that says when a band's model needs re-tagging. The banding is fixed
  thresholds, so a mis-tagged `capability` is the only way a model lands in the
  wrong band — a bounded, inspectable failure.
- **Upward-only fallback can throw.** A demand the catalog genuinely cannot meet
  (e.g. `high` + vision with no high-band vision model) throws rather than
  silently serving a weaker or blind model. This is the safe direction — a visible
  configuration error beats an invisible wrong model — and the fix is a one-line
  catalog addition.
- **Tier attribution in the signal is reconstructed, not stamped.** Because no
  event carries the model id or the tier on a step, the signal replays anchors and
  buckets the unobservable as `unknown`. It is a directional health signal, not an
  exact ledger; the reported tier→model mapping is what makes it actionable.
