# Corellia — Design

A software factory for the entire product-development process. Named for the
Star Wars manufacturing world. This document specifies the high-level design: a
**foundation layer** (the coordination model every other layer is built on),
then five layers on top of it — the product-development process, brownfield
comprehension, the runtime shape, human-team collaboration, and the factory's
own improvement loop. The concrete goal-type library lives in `GOAL-TYPES.md`.

This is the second revision. The recursive functional architecture of the first
revision is preserved intact; it is refined with the lessons of the four-factory
comparative design sessions (`conversation/DESIGN_FINAL.md`). Nearly every
lesson landed at the **edges** of the recursion — the spawn edge, the integrate
edge, and the interfaces with the world — which is itself evidence the core
holds: the single operation never changed, only the contracts around it.

## Central theorem

> **A goal-type is a harness. One brain, many harnesses means one recursive
> operation, many goal-types.**

The OUTLINE defines a harness as four parts — context, memory, tools, evals.
Corellia binds all four (plus a model tier) to a **goal-type**. Defining a
goal-type *is* defining a harness; there is no separate harness object.

## The unit: a typed goal

Everything the factory passes around is a **goal** — a typed object with an I/O
contract. There is no other primitive. A PRD, a design, a diff, a renamed
symbol are goals of different types.

A **goal-type** declares:

| Part | Meaning |
| --- | --- |
| **Input contract** | the typed context the goal receives |
| **Output contract** | the typed artifact the goal must emit, **including its proof artifact** (a UI type emits before/after screenshots; a migration type emits a rollback plan; a backend type emits tests) |
| **Memory access** | its type-memory namespace + project/global access |
| **Tool grant** | the exact tools a goal of this type may use |
| **Eval** | the check its output must pass |
| **Default tier** | the model it runs on by default, plus its escalation rule |
| **`leaf_only`** | whether this type may spawn children at all — a guaranteed structural base case |

The library of goal-types is the factory's source of truth. A goal-type is
defined once and reused wherever it is spawned — this is what DRY means here.
`critique-code` is one type whether it critiques a parser or a payment service;
subjects that need materially different harnesses are sibling types in a
**family**, sharing contract skeletons and skills through the factory repo —
not through memory. (The library, its four locked kinds, and the
granularity/speciation rule are specified in `GOAL-TYPES.md`.)

### The handoff contract — one schema, every level, both directions

The parent→child handoff and the listener→root handoff are **the same typed
contract**. Enriching it once propagates everywhere. A goal *instance* carries,
downward:

| Field | Meaning |
| --- | --- |
| `spec` | the typed input (free text never flows down the tree — parsing happens once, at the root) |
| `intent` | `production \| spike \| characterization \| …` — inherited down the subtree unless a child overrides; modulates judges, never deterministic gates (see "The three evals") |
| `risk_class` | computed, not declared — instance risk from scope × sensitivity (see "The human enters…") |
| `scope` | the impact set — files/regions this goal may touch, from the architecture artifact |
| `budget` | `{attempts, tokens, wall_clock, tool_calls}` — **inherited and subdivided**: a parent splits its allowance among its children. Tool calls are budgeted because the agentic round-trip, not the model, dominates execution cost — a budget teaches *rhythm* (batch the edits, run once, fix all, run once); "run until green" without a budget invites the per-edit loop |
| `memories` | parent-retrieved memory, injected as pointers with **provenance labels** (`provisional \| trusted`) — a provisional memory reads as suggestion, not fact (see "Memory") |

And the child's return is not a bare artifact — it is a typed report, each
stream routed differently at the integrate edge:

| Stream | Routed to |
| --- | --- |
| **artifact + proof** | the integration eval |
| **lessons encountered** | the parent, for eval-gated promotion to memory |
| **memories used** | reinforcement writes (touch counts, outcomes) — the decay signal |
| **blocker reports** | the improvement loop (friction that is the *factory's* fault — see "The improvement loop") |
| **scope-insufficiency** | the parent — a child whose work cannot stay inside its declared scope cannot emit; the parent expands the scope (risk re-classified) or re-splits, consuming an attempt |
| **out-of-scope findings** | proposed root goals (tickets) through admission — never in-tree fixes (one exception: a live secret in touched or adjacent code interrupts a human immediately) |

This single contract is what absorbs most of the group's mechanisms without
adding components: the orchestrator, the registry walker, and the parent node
are the same operation consuming the same schema at different depths.

## The single operation

Every harness performs the same recursive operation on the goal it receives:

> **receive** a goal → **decide**: satisfy it directly, split it, or **block**?
> → if split, produce **sub-goals with a dependency structure**, spawn child
> harnesses on them, and **integrate** their results → **emit** the goal's
> typed report.

This one operation, applied recursively, *is* the entire factory. The only
thing that changes between harnesses is the goal-type bound to the work.

**Decide has three outcomes, not two.** *Satisfy* and *split* as before — plus
**block**: the goal lacks the information to proceed responsibly, so it emits a
decision brief to a human (see "The human enters…") rather than inventing. The
factory never invents. Blocking is cheap and early; it is how ambiguity bounces
at the boundary instead of burning a subtree.

**Decide consults structure memory before deriving.** A split is a function of
(goal-type, spec-shape, context) — so it can be **memoized**. Before deriving a
fresh decomposition, the node checks whether a trusted split-memo matches; a hit
is walked rather than re-derived (see "Memoized splits"). A fixed pipeline and a
runtime split were never two mechanisms — one is the cached result of the other,
consumed through the identical contract.

### A split produces a dependency structure, not a mode

There is only one way to expand a goal: split it into sub-goals. Parallelism is
not a setting the node picks — it is an emergent consequence of the **dependency
structure** among the children:

- Children with **no dependency between them** run in parallel (fan-out).
- A child that **must complete before the parent can even name the next child**
  forces sequencing — the next sub-goal is spawned only after the prior returns
  (a chain / pipeline).

Discovery work (user research, analytics, debugging) is therefore not a separate
operation or a special goal-type — it is simply the case where the next sub-goal
*cannot be named until the current one returns*. The hypothesize → observe →
repeat loop is the degenerate chain where the parent keeps appending one more
sub-goal (one more probe) until its own eval says the goal is satisfied; the
chain's length isn't fixed in advance because each step's outcome decides whether
another is needed. Its output is reduced uncertainty — a synthesized finding —
rather than an assembled artifact.

Build work runs parallel because its sub-goals are genuinely independent.
**The same split mechanism covers fan-out, pipeline, and the discovery loop
alike** — the executor just obeys the dependencies: anything whose predecessors
are satisfied runs; a child whose definition depends on a sibling's *result* is
spawned only once that result exists. The build/investigate distinction is
emergent from the dependency graph, the way roles are emergent from which types
get spawned.

### Shared shapes freeze first — the contract barrier

A shape multiple children will touch — a tagged union, a wire schema, a shared
validator, a provider interface, a design contract — is never one child's
private business. A sound split **names every shared shape among its children
and spawns a `freeze-contract` child first**; every sharer depends on it, so
the ordinary dependency machinery sequences the freeze before the fan-out. The
frozen artifact is a concrete signature carrying **every child's additive
extension together with its exhaustive consumers** (every switch / validator /
serializer that must handle all cases), so siblings build against a stable
shape and late non-exhaustiveness breaks cannot happen.

This makes wide fan-out safe *proactively* — lateral memory pull remains the
reactive backstop, but a frozen contract makes the divergence it would catch
impossible to begin with. It also converts dependencies: a child that merely
consumes a shared shape does **not** depend on the sibling that introduces it —
it depends only on the freeze. The honest test for every dependency edge:
*does this child need the sibling's implemented behavior, or just the shared
shape they both build against?* Only the former is a real edge. (Field data
from the hand-built pipeline this design generalizes: over-declared edges are
the dominant cause of needlessly serial builds, and an unnamed shared shape is
how concurrent work diverges.)

## Memoized splits — structure as a governed asset

The recursive form's three practical weaknesses are cost (every split
re-derived), reproducibility (runtime splits are nondeterministic in shape), and
variance. The fix is the **structure flywheel**: recurring split shapes,
detected in the event log, are promoted into reusable split-memos. Runtime
chaos that proves itself becomes determinism — without surrendering generality,
because the runtime split remains the universal fallback.

### The boundary rule: facts decay, structure versions

> **A fact is verifiable-on-read against an external source of truth (the repo,
> the lockfile, the running system). Structure is validatable only by outcome —
> there is nothing to check it against except its track record.**

Things with a cheap external check can decay and refresh organically:
verify-on-read catches a stale fact at the moment of trust. A bad split-memo
has no ground truth to re-check against; the only evidence is downstream eval
results, which arrive late and noisily. So structure must change
**deliberately**:

- Split-memos are **type memory with version/pin semantics**, not organic
  decay. Each project pins the memo versions it trusts; an upgrade rolls out
  per-project, deliberately. A replayed goal binds the same shape it bound the
  first time.
- The same rule explains the rest of the architecture: repo-agnostic harness
  lessons ("always fetch fresh docs") are also outcome-only-validatable — and
  they route to *versioned code* (factory-repo PRs, see "The improvement
  loop"). Verifiable-on-read → memory with decay; outcome-only → versioned
  artifact. One rule, applied consistently.

### Hybrid promotion authority

Promotion splits by trust level, placing the human at exactly the transition no
eval can underwrite:

1. **Autonomous to provisional.** Recurrence detected in the event log →
   eval-gated promotion to *provisional*. A provisional memo is consulted as a
   **suggestion** — the split eval still runs fresh judgment against it.
2. **Human signoff to trusted.** Promotion to *trusted/pinned-default* — walked
   verbatim, fresh derivation skipped — requires a one-time human signoff per
   pattern: an instance of the authority gap, because trusting structure is an
   act no eval can underwrite (see "The human enters…"). This is where the
   blast radius jumps from "one suggestion" to "the shape of every matching
   subtree," and no outcome statistic catches a bad mutation before it ships.
3. **Demotion is deliberate too** — divergence in golden-set replay or a
   failure cluster in the traces flags a memo for review; it is demoted by
   decision, not silent decay.

The flywheel's signoff is itself an event (`promoted-to-trusted,
signed_off_by`), so pattern provenance is a query.

### No memo? Novel shapes run a tournament — the terraced scan

The split is the tree's highest-leverage decision, and for a **novel
spec-shape** — no memo match, low pattern confidence — the design should not
bet the subtree on a single draw. Borrowing the parallel terraced scan from
Hofstadter's Copycat: the node generates **k candidate splits at a cheap
tier**, `judge-split` ranks the candidates against one another, and only the
winner is deepened — spawned at full fidelity. Candidates **compete**;
commitment rises as confidence rises; exploration cost stratifies by
uncertainty, like every other cost in the design.

The scan is a **per-goal-type policy, not a structural change**: k and the
novelty trigger are type-level settings tuned from traces — a type whose
single-draw splits rarely fail keeps k=1; a type with high split-eval failure
on novel shapes earns a wider scan. A winning scanned split that recurs is
flywheel input like any other: tournament chaos that proves itself becomes a
memoized pattern.

Candidates are **lens-diverse, not k identical draws** — an architect's cut, a
reuse-maximizing cut, a contrarian's cut — because diversity catches failure
modes redundancy cannot. And when the scan isn't justified, the same lenses
fold into the single pass as a checklist: cheap multi-lens beats expensive
mono-lens.

Nor is the scan split-specific: it applies to any **single-draw, high-leverage
decision**. `design-arch` runs the same tournament by default — k candidate
architectures generated at a cheap tier, ranked by `critique-doc`, the winner
deepened at full tier — and the losing candidates become the ADR's
"alternatives considered": the proof artifact falls out of the scan for free,
recording alternatives that were actually explored rather than retrofitted.

## Roles are emergent

There is no org chart. No "designer," "QA," or "manager" object exists. There
is one library of goal-types and one recursive operation. What a human calls
"the design phase" is just the region of the goal tree where design-typed goals
were spawned. The organization is emergent from the work, not imposed on it —
the OUTLINE's "dark factory": no roles to light up, only operations running.

## The three evals — plus a gate before the split

One eval per moment of the recursive operation. They are three distinct failure
modes; none is redundant. The eval system has the same recursive shape as the
work system.

| Eval | Guards | Kind |
| --- | --- | --- |
| **Split eval** | was the decomposition sound and complete, with the right dependency structure? | judge (contextual) |
| **Goal-type eval** | does a leaf's output meet its typed I/O contract? | mostly deterministic (tests, types, lint) |
| **Integration eval** | does the assembled result satisfy the *original* parent goal? | judge (contextual) |

The **split eval** is the highest-leverage check — a bad split poisons the whole
subtree before any work happens beneath it. It judges three things: whether the
decomposition is sound/complete; whether the node got the **dependency
structure right** — did it serialize work that was actually independent
(wasting wall-clock — the dominant cause is an over-declared edge against a
contract's author), or parallelize work that was actually dependent (spawning
blind sub-goals that needed a sibling's result)?; and **contract discipline** —
is every shared shape among the children named and frozen first (see "Shared
shapes freeze first"), with extensions and exhaustive consumers pre-committed?
An unnamed shared shape is a latent integration failure.

**The split gate precedes it.** Before a node spends a subtree, it passes a
cheap pre-check: *do we have enough information to decompose?* — a mechanical
coverage query against the knowledge artifacts (exists? fresh at this SHA?
relevant to this goal?). Failure splits two ways. **Discoverable** — the
missing knowledge is in the world (the codebase, the docs): the node spawns JIT
comprehension goals *as dependencies* and splits once they return.
**Undiscoverable** — the missing information exists only in a human's head
(ambiguous intent; a backend repo asked to grow a frontend with no conventions
to mimic): the node **blocks** with a decision brief. The factory never invents
— but it also never asks a human for what it can go find. And it asks in
**batch**: the gate does a foresight pass over the children it is about to
spawn, harvests every *foreseeable* ambiguity across them, and emits **one
batched decision brief** before the fan-out — mid-tree briefs are reserved for
the genuinely unforeseeable. A dripped question is usually an avoidable
question; an interrupt that was foreseeable at the gate is a gate failure. The
gate is "can I responsibly split?"; the split eval is "was the split good?".
Spend a cheap check before spending a subtree.

The split eval also underwrites **termination**, via two base cases tied to that
dependency structure:

- **Independent sub-goals shrink the goal** — each is a strictly smaller piece
  of the whole, so a fan-out tree bottoms out at atomic leaves; depth is finite
  without a separate depth cap. (`leaf_only` types make the floor structural.)
- **A dependent chain does not shrink the goal** — it accumulates confidence
  rather than carving off pieces, so it is bounded by the **budget** instead.

The **integration eval** catches the "all parts pass, the whole is broken"
failure.

### Eval economics — cost stratifies by tree position

- **Deterministic before judge, always.** Compile, lint, typecheck, the repo's
  own CI, secret-reference scans run first; the judge is spent only on what a
  linter cannot reject. Anything a linter *can* enforce belongs in the
  deterministic gate, not in a prompt.
- **Impacted slice at the leaves, full suite at the root.** A leaf's goal-type
  eval runs only the tests its scope impacts (`impact(files)` against the
  architecture artifact); the root integration eval runs everything once. Eval
  cost stratifies by position in the tree exactly as model tier does.
- **The intent dial.** The goal's `intent` field modulates judge strictness —
  a `spike` is graded on "does it answer the question," not mimicry; a
  `characterization` goal is graded on fidelity of capture. **Hard invariant:
  intent modulates judges, never deterministic gates.** Intent is orthogonal to
  risk — a spike touching auth is relaxed-judge but still gated.
- **Judges are calibrated by replay.** Each goal-type carries its own eval set:
  historical pairs pinned at the repo SHA they shipped against, replayed to show
  where decomposition or judgment diverged from the human result. This is the
  eval of the evaluators — the split and integration judges have a calibration
  story, not just vibes. (The event log makes replays bind the memory state
  they originally saw — see "The event log.")

**The justification regress terminates outside the system.** Judges are
calibrated by golden sets; golden sets are curated from merged PRs, production
outcomes, and human verdicts — **exogenous ground truth, never another eval**.
There is no eval-of-eval-of-eval: the regress is cut where the factory meets
the world.

Split and integration evals are contextual judgments (LLM-as-judge harnesses);
goal-type evals are deterministic wherever possible.

### The parent verifies; the child claims

Authoritative verdicts are rendered at the **parent's integrate edge**. A
child's "done" is a claim until the parent's eval says otherwise, and it is the
parent that re-spawns a failed child at a higher tier. The parent *may*
delegate judging to an eval-typed child (`critique` is already a goal-type) —
delegation is just a split, so heavyweight judging inherits the full machinery
(tiers, escalation, compounding eval-type memory) while trivial judging stays
cheap. Deterministic checks are objective wherever they run; a child's
self-checks are an inner loop, never the verdict.

Where the library offers one, the delegated judge carries a **different lens or
skill bundle than the maker** — a second taste on the artifact, not the maker's
own perspective re-applied. A judge that shares the builder's harness shares
its blind spots.

### Scope is enforced, not declared

A deterministic **`diff ⊆ scope`** check runs at emission: the child's actual
diff must lie within its declared scope. Violation means the child cannot emit
— it returns a scope-insufficiency report, and the parent expands the scope
(re-running `classify_risk` on the wider scope) or re-splits, consuming an
attempt. `classify_risk` also re-runs on the **actual** diff at emission,
catching sensitivity the declared scope misjudged. This check turns two norms
into mechanisms: instance-risk gating cannot be bypassed by scope escape, and
findings-become-tickets is structural — the only way out-of-scope knowledge
leaves a node is through the findings stream.

## The control loop: eval → tier → human

One mechanism ties cost, quality, and human involvement together. An eval result
selects the next resource:

- **pass** → emit the report upward.
- **fail** → **repair first**: a judge verdict carries **prescriptions** —
  concrete, localized fix instructions for each gating finding — and a
  cheap-tier fixer applies exactly those edits. The expensive model judges; the
  cheap model types. (The fixer is not a new type — it is `implement` with a
  prescription as its spec.)
- **repair insufficient** — no prescription was possible, or the fix didn't
  hold — → **escalate**: retry at a higher model tier, carrying the failed
  attempt. The goal-type sets the default tier; failure bumps it.
- **finding flagged `escalated`** — the fix needs a frozen-contract change or a
  re-architecture, not a localized edit — → straight to **block**: that
  decision is the human's, not a bigger model's.
- **budget exhausted** → summon the **human** (last resort).

The eval is therefore not only a quality gate — it drives the resource decision.
Performance measurement and model selection collapse into this one loop:
performance *is* the eval result, and the eval result *is* what selects the
model.

**Retries see their failures — the factory is not a sphex wasp.** Attempt
N+1's contract includes attempt N's artifact and eval verdict — and the verdict
is *executable*, not merely visible: its prescriptions are what the repair rung
applies; a re-split is a
**perturbation of the failed split**, informed by what the split eval rejected,
never an independent roll. And the loop watches itself repeat: if an attempt's
failure signature is **isomorphic to the previous one**, the ladder isn't
working — the node jumps out early (escalates hard, or blocks with a decision
brief) instead of climbing rung by mechanical rung. The budget is the
mechanical exit; noticing the loop is the intelligent one.

**The loop's policies are instrumented, not decreed.** Whether a goal-type's
tier ladder pays for itself — or should collapse to direct human escalation —
is read off the traces, per type. After a stronger model decomposes a gnarly
goal, its children default back down to their type's default tier
(escalate-then-descend); whether descent is safe per type is likewise read off
the traces.

### Termination: the subdivided budget

Each goal receives a **budget** — `{attempts, tokens, wall_clock, tool_calls}`
— inherited from its parent and **subdivided among its children**. A retry-at-higher-tier
consumes attempts; a re-split consumes attempts; everything consumes tokens.
Attempts bound thrashing at each level; subdivision bounds **total tree
spend** — a wide fan-out cannot multiply costs past what its root was granted.
Exhaustion is an **event**, never a hang: it summons the human with a decision
brief. The two structural base cases (shrinking splits; chains bounded by
budget) do the rest.

## The human enters at three named gaps — all rare, all fail-safe

The factory is **mostly autonomous**. The human is an exception handler, not a
participant. There are exactly three entry points, each closing a different gap:

| Gap | Trigger | Path |
| --- | --- | --- |
| **Competence** | budget exhausted across rising tiers, or a block (insufficient information) | escalation to human (last resort) |
| **Authority** | an act whose consequences outrun any eval — by **type** (spend, deploy, delete, sign, **trust-a-pattern**) *or* by **instance** (`classify_risk`: this goal's scope touches migrations, auth, secrets-adjacent files, compliance surfaces — sensitivity read from project knowledge) | mandatory gate before the act, regardless of confidence |
| **Physical** | an act no agent can perform (speak aloud, tap a real device, sign) | human-as-tool (invoked mid-task, like web-search) |

> **The authority gap is one principle: an act whose consequences outrun what
> any eval can underwrite.** Irreversible external acts (spend, deploy, delete,
> sign) are instances. So is **promoting a split-memo to trusted** — structure
> has no verify-on-read, so no eval can underwrite trusting it (see "Memoized
> splits"). One definition, one human act: sign before the consequence.

Type-level gates alone miss instance risk: `modify-code` touching `auth.py` is
not the same goal as `modify-code` touching a README. Risk is computed at split
time from the goal's scope crossed with sensitivity facts in project knowledge;
the gate fires on type **or** instance — and risk is **re-checked at emission
against the actual diff** (see "Scope is enforced, not declared"), so the gate
cannot be bypassed by scope escape. Risk decides *where the human sits*, never
whether work runs concurrently.

**Every human touchpoint is a decision brief, and every brief has a deadline.**
A brief is typed — `{question, options, links, deadline}` — never a transcript.
**Gate briefs teach; mid-tree briefs are lean.** A batched gate brief carries
teaching fields — the relevant finding with its confidence, what each option
buys and costs *here*, a recommendation — because the human is already sitting
down and a better-taught decision is a better decision. The unforeseeable
mid-tree brief stays minimal for fast turnaround. And every boundary handoff
carries a **`learned`** field — two to four plain sentences of what building
this taught — so the human leaves smarter than they arrived.
**`on_timeout` is a required field** of every human touchpoint a goal-type
declares — `deny | park | bounce` — and a type that omits it fails validation:
the schema, not discipline, guarantees a safe default exists. **Parking
releases the tree's scope reservation immediately** — an unanswered human never
starves overlapping trees — **and carries a TTL**: resume re-acquires scope and
treats re-entry as an ordinary checkpoint (pull-based re-verification makes it
safe with no new machinery); past the TTL the tree winds down and its goal
bounces back through admission. No hung trees, no zombie trees, no leaked
reservations: "mostly autonomous" is a liveness property, not just a ratio.

**Earned autonomy.** Risk thresholds are tuned per goal-type from trace history
— a type with a long clean record needs the gate less often. More agent
capability shrinks the physical gap; better models shrink the competence gap;
earned trust shrinks the authority gap — and the traces are the mechanism by
which trust is earned.

**Counting honestly:** beyond the three in-run gaps, the design contains
exactly two standing human acts — **admission** (triage of non-commissioned
root goals: prioritization upstream of the factory, not factory operation) and
the **pattern-trust signoff** (one-time per pattern, an instance of the
authority gap). Both bounded, both enumerated; the gaps stay three.

## Memory: layered project × type × global, spawner-mediated

The recursive operation is pure; state lives outside it. Three retrievable
layers, mirroring instance / class / universe. Retrieval is anchored by the
artifact and the goal — not by who asks (there are no roles to ask).

| Layer | Holds | Lifetime | Analogy |
| --- | --- | --- | --- |
| **Project** | facts/decisions about *this* artifact (this repo uses Postgres; we rejected SSR here) — including the typed knowledge artifacts (see "Brownfield") | dies with the project | instance state |
| **Type** | how *this operation* is done well, accrued across every project the type ran in — including split-memos (versioned, not decayed) | compounds forever | class knowledge |
| **Global** | org-wide conventions, user preferences, house style | persistent | ambient universe |

**Type memory is the compounding asset** — the layer where the factory gets
better over time. A `critique` type that has run 10,000 times holds critique
wisdom no single project could teach.

### Spawner-mediated: parents inject, children report, parents promote

Children do not touch the store. The memory interface lives entirely at the
spawn and integrate edges, which keeps the recursive operation pure:

- **Read — inject, don't look up.** The spawner retrieves the memories relevant
  to the child's goal and injects them as context (**pointers, not bodies**). A
  leaf builder doesn't need a memory tool; it needs the right memories in its
  prompt. Types that genuinely need mid-task retrieval (the JIT deep-dive) get a
  `search_memory` **tool grant** — the existing mechanism, no special case.
  Injected memories carry their **provenance label** (`provisional | trusted`):
  a provisional memory reads as a suggestion to weigh, a trusted one as a fact
  to rely on — trust state means something at read time, not only at write
  time.
- **Write — report, don't record.** Children return *lessons encountered* and
  *memories used*. The parent promotes lessons (eval-gated, provisional) and
  writes reinforcement for the memories actually used — touch counts, outcomes.
  Decay gets a **causal** signal (this memory was used and the goal failed),
  not a correlational one.

### The memory contract

- **Every memory carries metadata**: created-at, repo SHA and factory version at
  write time, utility counters (uses, confirmations, failures).
- **Verify-on-read**: memory is a shortcut; the world is the source of truth. A
  fact is re-checked cheaply before a goal acts on it; failure triggers a
  targeted refresh, never a silent wrong answer. (Structure is the exception —
  it has no read-time check, which is exactly why it versions. See "Memoized
  splits.")
- **Provisional → trusted**: new memories enter provisional; repeated successful
  use hardens them. (For structure, hardening requires the human signoff.)
- **Use/mention discipline**: injected memories are **quoted data, never
  directives** — provenance-labeled, attributed to their source, and
  structurally segregated from the harness's own instructions. A memory is
  evidence the spawner *mentions*; it is never an instruction the child
  *obeys*. This boundary is what makes memory poisoning a data-quality
  problem rather than a prompt-injection problem.
- **Contradiction-check on write**: a new memory is checked for conflict with
  existing ones; conflicts escalate to resolution rather than silently
  coexisting.
- **Eviction**: failure-correlated memories decay out; staleness decays; the
  store must be able to forget. **Consolidation** — episodic → semantic
  distillation, "dreaming" — is itself a scheduled goal-type: the factory runs
  maintenance goals on its own memory through the same machinery as everything
  else.
- **Eval-gated promotion**: writing to type/global memory is itself a goal-type
  with its own eval ("is this general, true, and non-harmful beyond this
  project?"). A bad promotion is a caught eval failure, not silent poison.

### Where state lives — the three-way split

| State | Lives in |
| --- | --- |
| Factory **code** — prompts, skills, tool scripts, goal-type definitions, eval sets | the **factory repo**, versioned, human-reviewed |
| **Memory** — all three layers | an **independent store** (neither the factory repo nor any product repo), as a projection of the event log |
| The **product repo** | receives exactly one thing from the factory: a reviewable pull request |

Knowledge updates therefore need no PR — the store lives outside the product
repo and the factory writes it directly (through the governed contract above).
Ten engineers' factories never strew artifacts into products.

## The event log — the substrate under everything

The first revision had "traces." The second revision commits to the stronger
form: **everything the factory does is an event in one append-only log, and
every other view of the factory is a projection of it.**

> Every receive, decide, split, spawn, eval verdict, escalation, gate, override,
> memory write, promotion, and emission is an event. **Memory is a read-model
> projection of this log.**

What this one commitment buys:

- **Provenance for free.** Every memory is traceable to the event that wrote it;
  every pattern to the signoff that trusted it; every override to
  `{overridden_by, reason}`.
- **Serialized writes for free.** The log append is the serialization point —
  the precondition for contradiction-check-on-write, with no extra machinery.
- **Point-in-time reconstruction.** A golden-set replay rebinds not just the
  repo at its pinned SHA but the *memory store as it was* — replays see what the
  original run saw. Reproducibility of runtime splits becomes: deterministic
  where memoized, fully replayable where not.
- **Forgetting with an audit trail.** Eviction and decay are themselves events:
  the *projection* forgets; the log remembers.
- **Human surfaces are projections too** — **Live Run** (what's happening now),
  **PR View** (why this diff exists, stage by stage), **Event Inspector**
  (failure forensics as a query, not archaeology). Trust = replayable history.

One substrate serves every feedback reader: **escalation tuning** (a type that
escalates too often is mis-tiered), **split diagnosis** (failures clustering
under one parent mean its split eval was too lenient), **memory decay**
(reinforcement and failure attribution), **earned autonomy** (gate thresholds),
and **the flywheel** (recurrence detection). A goal-type's quality is its eval
pass-rate and escalation-rate across the log — no separate performance-review
mechanism. The dark factory needs no lights, but it needs instruments.

The projection machinery — log, projector, queryable read models — is
load-bearing v1 infrastructure, built first, not bolted on.

## Tools: per goal-type grant

Each goal-type declares the exact tools it may use, as part of its contract. A
goal can only touch tools its type grants — the contract *is* the capability.
You can read a type and know its blast radius. Dangerous tools (spend, deploy,
delete, create-key) live only on a few narrow, heavily-eval'd types — and those
types are exactly the ones that carry the mandatory authority gate. "Ask a
human on Slack" is itself just a tool grant; it emits a decision brief with a
deadline like every other human touchpoint.

## The product-development process: the root goal

The recursion needs a root. Corellia's primary mode is **commissioned**: a human
places an order — a **product intent** (a brief) — and that intent becomes the
root goal. Everything the OUTLINE calls "PM work" — user research, PRD
authoring, analytics inspection, stakeholder interviews — are **goal-types
spawned by decomposing the intent**, not a separate subsystem.

So "the entire product process" is not a second machine bolted onto the coding
machine. It is the **top of the same tree**: `research-users`, `write-PRD`,
`inspect-analytics`, `design-system` are goal-types near the root;
`implement-fn`, `rename-symbol` are goal-types near the leaves. Same operation,
same evals, same memory, same event log — top to bottom.

### The root's receive is the intake

There is no orchestrator component. What the group built as an intake pipeline
is, here, the **root goal-type's contract**, enforced by existing mechanisms:

- **Parse to typed spec.** The intent is parsed once into typed form
  (`{entities, acceptance_criteria, targets, touched_surfaces}`); free text
  never flows down the tree. Parse ambiguity → **block** (decision brief,
  deadline, timeout → bounce). Ambiguity bounces at the boundary, not in the
  token furnace.
- **Reject early — the capability check is mechanical.** Required
  languages/tools from the spec vs. the tech-stack artifact; a goal outside the
  factory's capability envelope bounces at receive with a reason, not after a
  burned subtree. (At first contact there is no tech-stack artifact yet — the
  check spawns its own cheap probe, reads the lockfiles, then bounces fast: it
  goes and looks before it rejects.)
- **Coverage check.** The split gate's query against the knowledge artifacts:
  fresh and relevant for this spec? Stale-and-relevant categories spawn targeted
  refresh goals as dependencies; missing-and-relevant categories spawn
  comprehension goals the same way — discovery is just-in-time (see
  "Brownfield comprehension").
- **Classify.** Memo lookup (does a trusted split-memo match this spec shape?)
  × `classify_risk` — two orthogonal lookups that decide the shape of the
  subtree and where the human sits.
- **No code tools.** The root type's tool grant excludes them — "the
  orchestrator never generates code" is a property of a contract, not a rule
  about a component.

One honest downgrade against the group's design: their orchestrator was a fixed
pipeline, *structurally incapable* of open-ended behavior; Corellia's root is a
full recursive node, bounded by **budget**. A weaker class of guarantee,
accepted deliberately — it is the price of the uniform recursion, and the
budget makes it an auditable price.

### Admission: the factory never approves its own work queue

For a **commissioned intent, the commission is the admission** — a human chose
to file it. The discipline applies to the two *non-commissioned* sources of
root goals:

- **Factory-minted findings** (out-of-scope discoveries returned up the tree)
  become *proposed* root goals that pass **human triage** before any tree is
  spawned. Findings become tickets, not fixes; a CVE in an untouched dependency
  is a high-priority ticket; only a live secret interrupts immediately.
  (Blocker-spawned *improvement* goals are the one carve-out — auto-admitted
  inside the improvement loop's standing budget envelope; see "The improvement
  loop.")
- **The autonomous seam.** An **`event → root-goal` adapter** can synthesize an
  intent from a signal (a monitor, a Slack mention, a ticket) and feed the
  *same* tree below — autonomy is a new way to *create* a root goal, not a new
  way to execute one. Adapter-minted roots pass the same triage until trust is
  earned. Specified as a seam now; built later.

## Brownfield comprehension

The first time the factory touches an existing codebase it cannot split anything
— it doesn't yet know what's there. Comprehension is the **precondition that
makes splitting possible** on brownfield. It is not a new mechanism: it is the
**discovery loop** (the dependent chain — probe → learn → decide the next probe
→ repeat until confident) pointed at a codebase, writing findings to **project
memory** that every later building goal reads.

### The knowledge artifacts — typed, fresh, queryable

Comprehension's output is not prose. It is a set of **per-category typed
artifacts**, each carrying `{generated_at_sha, confidence, provisional|trusted,
pointers}` — **pointers, not bodies** (the conventions artifact points at
exemplar PRs; the design-system artifact points at token files). Categories,
roughly: architecture graph, tech stack (from lockfiles, validated against the
build), conventions (exemplar pointers + rules a linter can't enforce —
everything a linter *can* enforce goes in the deterministic gate instead),
design system, dependency/versioning policy, test scaffold (must run green
before promotion — then it *is* the deterministic gate, not documentation of
one), and a credentials/secrets inventory (vault *references* only, never
values — input to `classify_risk` and the deterministic gate, not retrievable
knowledge).

Consumption is a **typed retrieval API**, not context dumps — `find_symbol`,
`find_exemplar(pattern)`, `impact(files)`, `conventions_for(surface)`,
`stack_versions()` — so context cost is paid per touched region, never per goal
re-learning the repo. The typed artifacts are also what make the **split gate
computable**: "do I have enough context?" is a coverage query, not a feeling.

### Discovery is just-in-time — there is no bootstrap

There is no setup flow, no bootstrap ceremony, no entry-point distinction.
Comprehension is **pulled into existence by the split gate**: a node that lacks
the knowledge to decompose spawns JIT comprehension goals *as dependencies* and
splits once they return. The first root against an unknown repo cannot split
without a map, so "map enough to split this intent" becomes its first dependent
child; a leaf that will change a region deep-dives *that region only*, as a
dependency, before changing it — findings injected by the spawner like any
other memory. Knowledge accretes exactly where work lands; a region no goal
touches is never mapped; no comprehension is ever speculative.

This is the epistemic rule applied honestly: comprehension artifacts are
**facts** — verifiable-on-read (a spot query, a scaffold that runs green, a
lockfile checked against the build). Facts never needed a human to underwrite
them; verify-on-read is their trust mechanism. A bootstrap signoff would
compensate for a weakness this design doesn't have.

The cost, taken knowingly: **first goals on a new repo run slower** — they
carry the comprehension debt a bootstrap would have prepaid. That is the JIT
trade.

### Freshness: verify on read; refresh on merge as an optimization

**Pull is the correctness mechanism.** Facts are verified on read (the artifact
carries enough to check itself against the SHA); a failed verification triggers
a fresh JIT deep-dive. Staleness is a caught condition, never a silent wrong
answer.

**Push is a warmth optimization.** Every merge to a product repo's main —
author-agnostic: factory PR, human dev, dependency bot — is a signal into the
listener: *the code changed, refresh your priors.* The minted refresh goal
targets only **already-built** artifacts whose drift signals fire (a lockfile
diff wakes the deps artifact; merged UI PRs wake the design system; the
architecture graph is cheap enough to re-index every merge — which matters,
because admission-time scope scheduling queries `impact()` against it).
Artifacts that don't exist are never refreshed — they are built on demand, when
a goal needs them, never speculatively.

### The regression guard

Brownfield's gravest risk is **regression** — satisfying the new goal while
silently breaking behavior the goal never mentioned. The integration eval only
checks the *parent goal*; regression is breakage *outside* the goal's scope, so
it needs its own guard, layered from existing machinery:

1. **Existing checks as a mandatory gate** — the repo's test/check suite (the
   impacted slice per leaf; the full suite once at root integration). A goal
   cannot emit if it reddens a previously-green check.
2. **Coverage signal** — the JIT deep-dive reports not just *how it works* but
   *how guarded it is*; coverage becomes a knowledge fact.
3. **Characterization where thin** — a thinly-covered touched region spawns a
   `characterization` goal ("pin current observable behavior as a baseline") as
   a **dependency of the change goal**; the net must exist before the change can
   be named, so it sequences automatically.

A change that reddens either gate cannot emit — **unless the goal's `intent`
explicitly includes that behavior change**, in which case the intended change
updates the baseline rather than failing against it. The intent field of the
contract is what the guard reads; brownfield safety falls out of
split-with-dependencies, no special case.

## Runtime shape and human-team collaboration

### Two timescales: a persistent listener over bounded trees

- **The listener (persistent, singular)** — the factory's front door. Always
  on, never halts. Its input channels: **human-commissioned intents**,
  **external signals** (via the `event → root-goal` adapter), **merge events**
  (→ refresh goals), and **blocker reports** (→ improvement goals). It performs
  one tiny operation: *input arrives → mint a root-goal → spawn its tree.* It
  does not decompose or reason; it only turns inputs into roots.
- **A tree (per input, bounded)** — each root-goal is the top of one isolated,
  bounded, turn-based tree, worked to completion and handed back at the
  boundary.

"Continually operating" and "turn-based" are both true, at different altitudes.

### Concurrency: scope-disjointness, not decree

Many trees run concurrently across repos, freely. **Within one repo, admission
schedules by scope**: trees whose impact sets (from `impact()` against the
architecture graph) are disjoint may run concurrently; overlapping scopes
serialize. The merge-conflict failure class is thereby named and bounded rather
than wished away. The degenerate v1 of this rule is serial-per-repo — correct,
cheap, and replaced by the scope rule when the knowledge artifacts are good
enough to trust the impact query. Within a tree, the executor is DAG-parallel
as ever; risk class decides where the human sits, not whether work runs
concurrently.

### Branches coordinate through shared state, by pull — checkpoint consistency

Pure trees communicate only vertically. Real product work needs **lateral**
coordination — a sibling's discovery, a human's mid-flight merge. The substrate
is shared project memory; the mechanism is **pull**:

> Every goal **re-reads the facts it depends on at each decide / split /
> integrate checkpoint**. A changed fact forces re-decision.

This is the brownfield verify-on-read, widened — one mechanism absorbing
brownfield staleness (the *code* moved), lateral awareness (a *sibling* wrote),
and reactive adaptation (a *human or signal* landed a change).

This is also Corellia's **named consistency model**: one authoritative store
(a projection of one log, serialized at the append), live reads, and **bounded
staleness — every reader is at most one checkpoint interval stale, and never
silently wrong at a moment of trust** (verify-on-read fires at decide / split /
integrate; within a leaf's execution, the staleness window is the price of
no-interrupts, paid knowingly). The memory
sync question is closed, not open: adaptation happens **at decision boundaries,
not instantaneously** — deliberately, because instantaneous preemption is what
makes systems hard to reason about. Work that needs tighter responsiveness is a
signal to *decompose into smaller goals* (more checkpoints), not to add
interrupts.

### Humans operate beside the factory

Humans never live-co-edit the factory's workspace. Each tree works in isolation
(its own worktree/branch) and reconciles at the **boundary**. Humans collaborate
three ways — commission, answer mid-tree (escalations and human-as-tool, always
decision briefs with deadlines), and review/merge at the boundary — never a
live shared edit.

**The boundary handoff is a PR, and the factory never self-merges.** The dark
lane — low-risk work running agent-only end to end — still terminates at a PR a
human can audit: *dark means no mid-flight intervention, not no review.* The
PR carries the goal-type's **proof artifact** (screenshots, tests, rollback
plan) and its PR-View projection (why this diff exists, stage by stage). Review
routes by an **ownership map** to the owners of the touched surfaces — the buck
stops with that product's head. **Pushback protocol:** the factory may object
once, with reasons; then it complies; overrides are logged into the event store
(`overridden_by, reason`). Rejection reasons feed learning **only when stated**
— the factory never reverse-engineers an unstated rationale.

The artifact itself is **process-clean**: no goal IDs, plan references, or
factory process language in code, comments, or config — a deterministic,
grep-able gate item on every code-emitting type. The code outlives the process
that produced it; "never pollutes the product repo" extends down to the comment
level. Process talk belongs only in specs, commit messages, and the PR body —
and the PR carries the `learned` note alongside its proof artifacts.

## The improvement loop — working ON the factory

Working *in* the factory makes a product's work better; working *on* the
factory makes the factory itself better. These are **two loops with different
artifacts, different reviewers, and different blast radii** — and the
distinction is the epistemic boundary rule again: lessons about doing the job
are memory; defects in the harness itself (prompts, tool scripts, skills —
factory **code**) are versioned artifacts needing review.

- **Blockers spin out; they never block.** When a node hits friction that is
  the *factory's* fault — a stale skill, a wrong API client, a prompt that
  fights its tools — it files a **blocker report** in its return and keeps
  working. **The factory never modifies its code mid-run.**
- **The invariant, stated precisely.** Strictly, the factory *does* modify
  itself mid-run: memory writes are the designed lateral-coordination channel,
  and injected type memory is effectively prompt text. The precise invariant:
  **versioned behavior** (prompts, skills, types, evals) changes only by
  human-reviewed PR, never mid-run; **memory** changes only through the
  governed write path (eval-gated, provisional, contradiction-checked,
  provenance-labeled at read). The memory-governance machinery carries real
  safety weight here, and is named as such rather than hidden behind a slogan.
- **The improvement loop is more goal-types**, rooted on blocker reports (plus
  stated rejection reasons that implicate the harness rather than the work),
  minted by the listener, running beside product work inside a **standing
  budget envelope** — the loop can never starve product work. The envelope is
  also what justifies its admission carve-out: improvement goals auto-admit (no
  human triage) because they consume only factory resources within a fixed
  allowance and terminate at a human-reviewed PR anyway; product findings, by
  contrast, spend roadmap attention, so they pass triage. Its job is
  **abstraction**: take the specific failure and propose the most general fix
  that covers it. **Generalize, don't cache** — "fetch current docs for the
  pinned version before writing client code," never "paste this doc text into
  the prompt." Point at sources; don't snapshot them.
- **Output routes by generality.** A repo-specific lesson belongs in that
  repo's project memory — not a factory change at all. Only repo-agnostic
  improvements become **PRs to the factory repo** — prompts, skills, scripts,
  eval sets, *new* goal-types — reviewed by **factory maintainers**, a separate
  competency (possibly the same person at small scale, but a separate *role*)
  from product maintainers.
- **The architecture is locked.** Improvement PRs may refine harnesses and add
  goal-types within the existing structure; they may not restructure the
  factory. Structural change is a human design decision, never an
  improvement-loop output. No factory-factory in v1: the loop terminates at a
  human-reviewed PR — which is also how the improver itself is evaluated and
  improved.
- **The invariants are enforced by the factory's own deterministic gate.** The
  factory repo's CI is a **constitution check**: no goal-type may grant
  merge-to-main on a product repo, self-approval, or an untyped human exit; no
  deterministic-gate declaration may take `intent` as an input; every human
  touchpoint must declare `on_timeout`. An improvement PR that violates the
  constitution is rejected by a linter before a maintainer ever reads it —
  deterministic-before-judge, applied to the factory itself.

## How this satisfies the hard requirements

| OUTLINE requirement | Satisfied by |
| --- | --- |
| Build on brownfield projects | JIT recursive comprehension (no bootstrap) + typed knowledge artifacts + project memory anchored to the codebase |
| Organize roles in the build | emergent roles — a library of goal-types, no imposed org chart |
| Evals on handoffs between roles | the split gate + the three evals (split / goal-type / integration), calibrated by replay |
| Defined inputs and outputs | every goal-type is a typed I/O contract; one handoff schema at every level, both directions |
| Simpler/cheaper models per role | type-default tier with escalation — cost stratifies by position in the tree, for evals as well as models |
| Mostly autonomous, human rare | humans only at the three named gaps, all rare, all fail-safe (decision briefs, timeout → safe default) |
| Reproducible & auditable | the event log: memoized splits replay identically; runtime splits replay from history; memory reconstructs at any point in time |

## Foundation decisions — summary

| Decision | Resolution |
| --- | --- |
| Work unit & expansion | recursive goal-spawning — typed goals, one recursive operation |
| Expansion shape | one split mechanism; parallel vs sequential emergent from the children's dependency structure; **shared shapes freeze first** — a `freeze-contract` child every sharer depends on, extensions + exhaustive consumers pre-committed |
| Decide outcomes | satisfy \| split \| **block** — the factory never invents; ambiguity bounces early via decision brief |
| Structure reuse | **memoized splits**: split-memos as versioned type memory; autonomous → provisional, **human signoff → trusted**; pinned per project; novel shapes run a **terraced scan** — k cheap **lens-diverse** candidate splits compete, `judge-split` ranks, the winner is deepened (per-type policy) |
| Facts vs structure | the epistemic rule: verifiable-on-read → memory with decay; outcome-only-validatable → versioned artifact |
| Handoff contract | one schema every level, both directions — down: spec/intent/risk/scope/budget/memories; up: artifact/proof/lessons/memories-used/blockers/findings |
| Intent | a typed contract field, inherited down the subtree; modulates judges, **never** deterministic gates; orthogonal to risk |
| Eval contract | split gate (pre, with batched ambiguity harvest) + split (decomposition + dependency honesty + contract discipline) + goal-type + integration; deterministic before judge; impacted slice at leaves, full suite at root; judges calibrated by pinned-SHA replay against exogenous ground truth (merged PRs, production, human verdicts — never another eval); **verdicts rendered at the parent's integrate edge** (delegable to eval-typed children — the child only ever claims) |
| Scope enforcement | deterministic `diff ⊆ scope` at emission + risk re-check on the actual diff; escape bounces to the parent (expand scope or re-split, consuming an attempt) — findings-become-tickets is structural, not normative |
| Cost / quality / human | one control loop: eval → **repair** (the judge prescribes, a cheap fixer applies) → tier escalation → human last-resort; `escalated` findings skip straight to block; retries carry the prior failure (re-splits are perturbations); isomorphic failures jump out early; ladder policies instrumented per type, not decreed |
| Termination | shrinking splits + `leaf_only` floors; chains bounded by the **subdivided budget**; exhaustion is an event, not a hang |
| Risk | computed per instance (`classify_risk` over scope × sensitivity) layered on type-level gates; re-checked at emission on the actual diff; earned autonomy tuned from traces |
| Human paths (all rare) | competence (escalation/block), authority (**consequences outrun any eval** — type ∨ instance gates, incl. pattern-trust), physical (human-as-tool); every touchpoint a decision brief with **required `on_timeout`** (deny \| park \| bounce); park releases scope + TTL; plus two standing acts: admission, pattern-trust signoff; gate briefs batched and teaching, mid-tree briefs lean; every boundary handoff carries `learned` |
| Roles | emergent — no org chart, only a library of goal-types |
| Memory | layered project × type × global; **spawner-mediated** (parents inject pointers, children report, parents promote); injection carries provenance labels (provisional \| trusted); reinforcement from memories-used |
| Memory governance | eval-gated promotion + provisional/trusted + use/mention discipline (memories are quoted data, never directives) + contradiction-check on write + decay/eviction + consolidation as a scheduled goal-type |
| Memory substrate | an **independent store**, realized as a **projection of the event log**; consistency model: checkpoint consistency (bounded staleness, never silent) |
| Substrate under feedback | the **event log** — everything is an event; memory, metrics, UI surfaces, and replay are projections of it |
| Tools | per goal-type grant — the contract is the capability; human-on-Slack is a tool grant with a deadline |
| Intake | the root goal-type's contract: parse once to typed spec, reject early (mechanical capability check), coverage-gate, classify (memo × risk); root grants no code tools |
| Admission | commission *is* admission for intents; factory-minted findings and adapter-minted roots pass human triage — the factory never approves its own work queue (one bounded carve-out: improvement goals auto-admit inside their budget envelope) |
| Scope discipline | findings become tickets, not fixes; exception: a live secret interrupts immediately |
| Brownfield comprehension | **just-in-time only — no bootstrap, no setup flow**: the split gate spawns comprehension goals as dependencies; typed per-category knowledge artifacts (pointers, freshness metadata) + typed retrieval API; verify-on-read is correctness, merge-triggered refresh of already-built artifacts is warmth |
| Regression guard | existing checks as gate + coverage signal + JIT characterization where thin; the goal's `intent` decides baseline-update vs failure |
| Runtime shape | persistent listener (intents, signals, merges, blockers → root-goals) over many concurrent, bounded, isolated trees |
| Concurrency | scope-disjoint trees run concurrently per repo; overlapping scopes serialize (degenerate v1: serial-per-repo); DAG-parallel within a tree |
| Human collaboration | beside, turn-based: commission, answer mid-tree, review/merge at the boundary; never live co-edit |
| Output discipline | PR only, never self-merge; proof artifacts + `learned` in the output contract; **process-clean artifacts** (no goal IDs or factory language in code/comments — deterministic gate); ownership-map review routing; object-once pushback with logged overrides |
| Branch coordination | shared state read by pull at checkpoints — adapts at decision boundaries, not instantaneously |
| The two loops | working IN (memory, per-repo) vs working ON (improvement PRs to the factory repo, human-reviewed); blockers spin out; standing budget envelope; constitution check in factory CI; precise invariant: code by PR, memory by governed write; **the architecture is locked**; no factory-factory in v1 |
| State placement | factory code in the factory repo; memory in the independent store; product repos receive exactly one thing — a PR |
| Goal-type library | four locked kinds (make / learn / judge / evolve = eval-shape classes, each a lint-time grant ceiling); families share skeletons + skills in code, never memory; exact static grants per type, scope as the only runtime narrowing; types speciate when traces bifurcate — see `GOAL-TYPES.md` |
| Unification | a goal-type **is** a harness |

## Deliberately deferred (documented, defensible)

- **Token-efficiency self-improvement** — analyzing the log for churn is a real
  gain, deliberately unpursued in v1; the bar is PR acceptance, and the event
  data needed already accrues, so the loop can be added without re-architecture.
- **Factory-factory recursion** — scoped out; revisit only after the
  human-reviewed improvement loop proves itself.
- **Projection implementation** — whether the memory read-model is graph-shaped,
  a wiki, or a keyed table is deferred until relationship queries earn the
  complexity; the event-log contract is fixed, the projection is swappable.
