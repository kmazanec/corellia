# Corellia — Goal-Type Library

Companion to `DESIGN.md`, which defines the architecture; this document defines
the **starter set of goal-types** — the factory's instruction set. Four
decisions shape it:

1. **Four locked kinds** — `make / learn / judge / evolve` — are architecture
   (human-locked); types are instances, addable by the improvement loop.
2. **The granularity rule** — a type exists iff its harness differs materially;
   types speciate when traces bifurcate.
3. **Families with exact grants** — static per-type tool grants; families share
   contract skeletons and skills through the factory repo, never through memory.
4. **Full-stack thin** — nineteen types covering intent → PR end to end, one or
   two per family, deepened where traces demand it.
5. **Seeded, not blank** — the hand-built kmaz pipeline is this design's working
   prototype; its hardened skills are imported as the starter skill bundles
   (see "Seed harness content").

## The four kinds — the locked frame

A goal's report always centers on one of four things, and the four differ in
**what their eval can even be**. Since the eval is the keystone of a harness,
kinds are equivalence classes of eval shape — and each kind carries a
characteristic worst-case blast radius, which sets the **grant ceiling** the
constitution lints every member type against.

| Kind | A goal of this kind centers on | Eval shape | Grant ceiling (lint-time) | Blast radius |
| --- | --- | --- | --- | --- |
| **make** | an artifact that changes the product | deterministic gate → judge | read + write inside the worktree, within scope; never deploy/spend/merge | the product worktree |
| **learn** | a finding that changes what the factory knows | question answered; proposed facts verifiable-on-read | read-only on the world; *proposes* facts, never writes memory (spawner-mediated) | project memory, via parent promotion |
| **judge** | a verdict on another goal's output | **calibration only** — golden-set replay; no per-instance ground truth exists | strictly read-only; no write tools of any kind; `leaf_only: true` always | none — a verdict has no side effects |
| **evolve** | a change to the factory's own substrate | promotion eval / maintainer review — downstream health, not instance output | governed memory-store writes, or a factory-repo PR; never a product repo | type/global memory; the factory repo |

`learn` and `evolve` are the deliberate pair: **learn is the factory learning
about the world; evolve is the factory changing itself.**

Judges are always leaves: decomposing a large judgment is the *parent's* job
(spawn several narrow critiques), not the judge's — a judge that splits is a
judge whose verdict launders sub-verdicts nobody calibrated.

## Families — code-level compounding, memory-level cleanliness

A **family** is a code-reuse mechanism in the factory repo, *not* a memory
layer: a shared contract skeleton plus shared skills that member types include.
The compounding story splits along the epistemic rule:

- **Subject-specific operational lessons** compound in each type's own clean
  memory namespace (`critique-code` wisdom never dilutes `critique-ui`'s
  reinforcement signals).
- **Cross-subject general wisdom** ("compare against acceptance criteria before
  style") is general harness guidance — outcome-only-validatable — so it climbs
  into the **family skill** via the improvement loop's route-by-generality:
  versioned code, human-reviewed, inherited by every member type.

Grants are **exact and static per type** — lintable, blast radius readable off
the definition, evals writable against a fixed capability set. The kind ceiling
constrains them at PR time, not at runtime; the only runtime narrowing is
**scope**, which the design already enforces (`diff ⊆ scope`). Capability is
static (the type); reach is dynamic (the instance).

## The granularity rule

> **A type earns existence exactly when its harness differs materially** —
> tool grant, eval, contract shape, or tier. Two candidates sharing all harness
> dimensions are one type with different specs.

And its data-driven converse: **a type speciates when its traces bifurcate** —
when eval pass-rates or escalation rates cluster into two distinct populations,
one harness is demonstrably serving two kinds of work badly, and the
improvement loop proposes the split (a new sibling in the family, inheriting
the skeleton). The library starts coarse and splits on evidence, the same way
runtime splits harden into patterns.

## The type-definition schema

One fully worked exemplar — `implement`, the workhorse. Every other card below
compresses this same shape.

```yaml
type: implement
kind: make
family: build
core: false                            # core types cannot be removed by improvement PRs
leaf_only: false
# types are factory code: they ride the factory repo's version

input:
  spec: typed-spec                     # never free text below the root
  scope: impact-set                    # files/regions this goal may touch
  intent: production | spike | …       # inherited; modulates the judge below
  memories: pointers                   # provenance-labeled, spawner-injected

output:
  artifact: diff                       # within scope — enforced at emission
  report:                              # the standard return streams
    lessons: []
    memories_used: []
    blockers: []
    findings: []

proof:
  - impacted-slice tests green (impact(files) selects the slice)
  - tests added for new behavior
  - UI surfaces: before/after screenshots (mobile + desktop)

tools:                                 # exact, static — lintable
  - fs.read, fs.write                  # worktree only
  - test.run_impacted
  - knowledge.find_symbol, knowledge.find_exemplar
  - knowledge.impact, knowledge.conventions_for, knowledge.stack_versions
  # never: deploy, spend, merge, memory.write

memory:
  namespace: implement
  reads: [project, type, global]       # retrieved and injected by the spawner

eval:
  deterministic:                       # always first; intent may never relax
    - compile, lint, typecheck
    - impacted test slice green
    - diff ⊆ scope
    - vault-ref scan (no secret values)
    - process-reference grep (no goal IDs or factory language in code/comments)
  judge: critique-code                 # delegated; intent modulates the bar
  calibration: golden pairs pinned at the SHA they shipped against

tier:
  default: sonnet
  escalation: opus                     # then human, via the control loop

human:
  touchpoints: none                    # competence-gap escalation only
  # any declared touchpoint MUST carry on_timeout: deny | park | bounce
```

## The starter set — nineteen types, ten families

### make — six types

| Type (family) | Input → output | Proof | Grant (summary) | Eval | Tier | leaf_only |
| --- | --- | --- | --- | --- | --- | --- |
| **`deliver-intent`** (deliver) · **core** | commissioned intent (the *only* type that accepts free text) → integrated product increment as PR(s) + typed completion report | PR-View projection; full suite green at root | retrieval API, `classify_risk`, spawn — **no code tools**: the root literally cannot satisfy directly; the grant enforces it | `judge-integration` against the parsed intent | opus → human | no |
| **`write-prd`** (author) | typed intent + injected research findings → numbered, behavior-focused PRD | every requirement traceable to intent or a finding | doc read/write in workspace; retrieval API | schema/completeness lints → `critique-doc` (testability, no solutioning) | sonnet → opus | yes |
| **`design-arch`** (author) | PRD slice + knowledge artifacts → design/ADR set | each decision lists alternatives considered + the requirement it serves — the scan's losing candidates, explored rather than retrofitted | doc read/write; retrieval API | **terraced scan by default**: k candidate architectures at a cheap tier, `critique-doc` ranks, winner deepened at full tier; then coverage lints (every requirement addressed) → `critique-doc` | opus → human | yes |
| **`implement`** (build) | spec + scope + memories → diff within scope | impacted slice green; tests for new behavior; screenshots for UI | see exemplar above | deterministic gate → `critique-code` | sonnet → opus | no |
| **`freeze-contract`** (build) | reconciled shared-shape spec (signature + every sibling's additive extension + exhaustive consumers) → the landed minimum-viable shape, committed **before any sibling fan-out** | scoped contract tests green; the diff contains **no feature behavior** — shapes and their exhaustive consumers only | fs read/write (worktree); scoped test runner | deterministic (scoped tests green; no-feature-behavior check; every consumer exhaustive over every case) → `critique-code` | opus → human | yes |
| **`characterize`** (build) | thinly-covered region + coverage facts → baseline tests pinning current behavior (`intent: characterization`, fixed) | new tests run green against *unmodified* code; zero production-code diff (its scope is test dirs) | fs read; test-dir write; test runner | deterministic (green on untouched code) → `critique-code` judged on capture fidelity, not mimicry | sonnet → opus | yes |

### learn — four types

| Type (family) | Input → output | Proof | Grant (summary) | Eval | Tier | leaf_only |
| --- | --- | --- | --- | --- | --- | --- |
| **`map-repo`** (comprehend) | repo + category (`architecture \| stack \| conventions \| design-system \| deps \| test-scaffold \| credentials`) → that category's knowledge artifact `{generated_at_sha, confidence, status, pointers}` | per-category self-validation: spot queries pass, scaffold runs green, versions match the build | read-only repo; sandboxed run rights for validation | deterministic self-validation | sonnet → opus *(bumped from haiku → sonnet on live traces, 2026-06-11)* | yes |
| **`deep-dive-region`** (comprehend) | region + question ("how does auth work / how guarded is it") → region facts (provisional) + coverage signal | every fact carries file:line anchors at SHA — self-checkable on read | read-only repo; retrieval API | facts verifiable-on-read; question answered | sonnet → opus | yes |
| **`research-external`** (research) | question + context → cited finding; proposed facts marked provisional | every claim carries a source; key claims spot-checked | web search/fetch; docs | sources present → optional adversarial spot-check (judge delegation) | sonnet → opus | yes |
| **`investigate`** (diagnose) | anomaly/question + access pointers → synthesized root-cause finding with evidence chain | the evidence chain itself — each hypothesis, probe, observation as events | spawn (its probes are children: `deep-dive-region`, `research-external`, `implement` with `intent: spike` for repros) | confidence threshold met; chain bounded by budget (the dependent-chain base case) | sonnet → opus | no |

`map-repo` is also the refresh type: merge-triggered refresh mints `map-repo`
goals for drift-fired categories. There is no separate bootstrap type —
discovery is just-in-time, and the split gate spawns these as dependencies.

### judge — five types

| Type (family) | Input → output | Grant (summary) | Calibration | Tier | leaf_only |
| --- | --- | --- | --- | --- | --- |
| **`judge-split`** (arbiter) · **core** | parent goal + proposed children + dependency structure (+ split-memo if consulted) → verdict `{sound, complete, dependency-correct}` + rationale | read-only: retrieval API | golden replays — where decomposition diverged from the human PR | sonnet → opus | yes |
| **`judge-integration`** (arbiter) · **core** | original parent goal + assembled result + children reports → verdict + rationale | read-only: worktree, retrieval API | golden replays at pinned SHA | sonnet → opus | yes |
| **`critique-code`** (critique) | diff + spec + convention/exemplar pointers → verdict + findings (the mimicry bar: *could a team member have written this?*) | read code; `find_symbol`, `find_exemplar` | code golden sets | sonnet → opus | yes |
| **`critique-ui`** (critique) | running UI / screenshots + spec + design-system pointers → verdict + findings | drive browser; screenshot; read token files | UI golden sets | sonnet → opus | yes |
| **`critique-doc`** (critique) | PRD/ADR + upstream contract → verdict + findings | read docs; retrieval API | doc golden sets | sonnet → opus | yes |

The split and integration evals are themselves library types — that is what
"the parent may delegate judging" requires. `intent` modulates every critique's
bar (a spike is judged on "does it answer the question"); it never touches the
deterministic gates, which live on the *judged* type, not the judge.

`judge-split` also referees the **terraced scan** (see DESIGN.md, "Memoized
splits"): for a novel spec-shape, k cheap candidate splits compete and
`judge-split` ranks them against one another before the winner is deepened —
a per-type policy, with k and the novelty trigger tuned from traces.
`critique-doc` referees the same tournament for `design-arch`, where the
losing candidates become the ADR's "alternatives considered" — the proof
artifact falls out of the scan for free.

### evolve — four types

| Type (family) | Input → output | Grant (summary) | Eval | Tier | leaf_only |
| --- | --- | --- | --- | --- | --- |
| **`promote-memory`** (curate) | candidate lesson from a child's report + target layer → governed memory write (provisional) or rejection | memory-store write — the curate family holds the only memory-write grants in the library | "general, true, non-harmful beyond this project?" + contradiction-check | sonnet → opus | yes |
| **`consolidate-memory`** (curate, scheduled) | a namespace + its event history → distilled semantic memories; eviction proposals ("dreaming") | memory-store write; event-log read | distillations verifiable against the episodes they summarize | sonnet → opus | yes |
| **`propose-pattern`** (improve) | recurrence cluster from the event log (same spec-shape, similar runtime splits) → split-memo draft, **provisional** | event-log read; pattern-store write (provisional only — **trusted requires the human signoff**: the authority gap) | the split eval run against the memo's history of shapes | opus → human | yes |
| **`improve-factory`** (improve) | blocker reports + stated rejection reasons implicating the harness → **factory-repo PR** (prompts, skills, scripts, eval sets, new type definitions), routed by generality | factory-repo branch + PR; spawn (may investigate, draft, test); repo-specific lessons re-route to `promote-memory` | constitution lint (deterministic) → factory-maintainer review (the human gate) | opus → human | no |

The `improve` family's shared skill is **generalize, don't cache** — both
members do abstraction work: take the specific recurrence or failure and
propose the most general artifact that covers it. `improve-factory` runs inside
the standing budget envelope; both terminate at a governed promotion or a
human-reviewed PR — the improvement loop never touches a product repo.

## Tier map

| Tier | Types | Why |
| --- | --- | --- |
| **haiku** | `map-repo` | mechanical extraction with deterministic self-validation |
| **sonnet** | `write-prd`, `implement`, `characterize`, `deep-dive-region`, `research-external`, `investigate`, all five judges, `promote-memory`, `consolidate-memory` | the working tier; escalation to opus on eval failure |
| **opus** | `deliver-intent`, `design-arch`, `freeze-contract`, `propose-pattern`, `improve-factory` | the five places a bad output poisons everything beneath or after it: the root split, the design, the shared shape, the structure, the harness |

The assignment rule, position-free: *does this step require weighing
alternatives?* → opus. *Is it specified well enough that the answer is
determined?* → sonnet. *Is there nothing to decide?* → haiku. When unsure,
pick the lower tier unless a wrong answer is expensive and hard to reverse.
The corollary that matters: **specification quality, not stakes, picks the
tier** — a high-stakes goal with a detailed approved plan runs sonnet because
the spec carries it; the same goal under-specified runs opus, because someone
must weigh the alternatives.

Defaults, not decrees: ladder policies are instrumented per type — traces
showing a type's escalations always rescue (or never do) re-tier it.

## Constitution lints for the library

The factory repo's CI enforces these deterministically on every type
definition, existing or proposed by an improvement PR:

1. Every type declares exactly **one kind**; its grant ⊆ the kind's ceiling.
2. **judge** types: no write tools, no memory writes, `leaf_only: true`.
3. Memory-store write grants exist **only** in the curate family.
4. No type grants merge-to-main on a product repo, self-approval, or an
   untyped human exit.
5. Deterministic-gate declarations take no `intent` input.
6. Every declared human touchpoint carries `on_timeout: deny | park | bounce`.
7. **Core types** (`deliver-intent`, `judge-split`, `judge-integration`) cannot
   be removed or have their kind changed by improvement PRs; their prompts,
   skills, and eval sets may be refined.
8. Free text is accepted only by `deliver-intent`'s input contract.

## Seed harness content — imported field data

The library is not seeded from scratch. The hand-built kmaz pipeline
(`~/dev/dotmaz`) is this design's working prototype — a fixed DAG of typed
stages hardened by real builds — and its skills are the starter **skill
bundles** for the types below: imported as versioned factory code (family
skills), never as memory, and refined thereafter by the improvement loop.

| Type | Seed content (from the kmaz pipeline) |
| --- | --- |
| `write-prd` | the senior-PM interview: four pillars (problem / intent / scope / constraints), question rounds, teach-before-ask, "don't ask what research can answer," Given/When/Then near-executable acceptance criteria, revision-history-never-silent-changes |
| `design-arch` | the ADR format (context / options / decision / rationale / tradeoffs / consequences-for-the-build), `Contract: yes` flagging, supersede-never-edit, "the tradeoff is the tell," the mandatory security and non-functional rounds, the CTO-defensibility bar |
| `judge-split` | vertical-slice discipline (the one-sentence before→after test; no layer/infra/schema features; the walking skeleton as the first slice; fewer-fatter), the over-declared-dependency test ("implemented behavior, or just the frozen shape?"), the ≤1-starters serial-build warning, acyclicity, risk-weighted ordering (de-risk early) |
| `implement` | chunk structure (build-and-test slices ending in one tickable item, each naming its impacted test targets), the batched rhythm (write → run once → fix all → run once; ~1–2 runs and one commit per chunk), contract-drift-as-report-never-fork, the timeless-comment grep |
| `freeze-contract` | the contract barrier itself: land every shape with every extension and exhaustive consumer, scoped tests only, no feature behavior |
| `critique-code` | the six-dimension single-read rubric (spec / security / contrarian / robustness / efficiency-and-simplicity / convention), `selfVerified` discipline (omit what you can't confirm), a concrete localized fix per gating finding, the `escalated` flag |
| `critique-doc` | the defensibility probe ("why this way and not the obvious alternative?"); an empty tradeoffs section means the decision wasn't actually made |
| `research-external` | inline self-corroboration (≥2 independent sources for load-bearing claims), ONE batched skeptic for the unverified remainder (per-claim verifier fan-out was the measured blowup), confidence flags, load-bearing marking |
| `deliver-intent` (integration) | linear history by cherry-pick with `git log --merges` proof, the full suite once at convergence, deterministic teardown keyed off verified-shipped lists — irreversible cleanup is mechanism, never agent diligence |

## Deliberately deferred types

Added by the improvement loop (within the kinds) or by human design when traces
or demand justify them:

- **`design-ui`** (make/author) — visual design as a first-class type; v1 lets
  `implement` + `critique-ui` carry UI work.
- **`research-users`, `interview-stakeholder`, `inspect-analytics`**
  (learn/research) — the deeper PM layer; `research-external` + human-as-tool
  cover v1's thin top.
- **`migrate-data`** (make/build) — the migration type with its mandatory
  rollback-plan proof and instance-risk gate; until then, migrations route
  through `implement` and gate on instance risk.
- **`release`/`deploy`** (make) — irreversible external acts; deferred until
  the earned-autonomy machinery has trace history to stand on.
- A **spike type** is deliberately *not* deferred — it is not a type at all.
  Spike-ness is an `intent` value on existing types; the group's "spike ticket
  class" dissolves into the intent dial.
