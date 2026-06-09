# Corellia — Design

A software factory for the entire product-development process. Named for the
Star Wars manufacturing world. This document specifies the high-level design: a
**foundation layer** (the coordination model every other layer is built on),
then four layers on top of it — the product-development process, brownfield
comprehension, the runtime shape, and human-team collaboration. The concrete
goal-type library is the one piece left for a later document.

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
| **Output contract** | the typed artifact the goal must emit |
| **Memory access** | its type-memory namespace + project/global access |
| **Tool grant** | the exact tools a goal of this type may use |
| **Eval** | the check its output must pass |
| **Default tier** | the model it runs on by default, plus its escalation rule |

The library of goal-types is the factory's source of truth. A goal-type is
defined once and reused wherever it is spawned — this is what DRY means here.
`critique` is one type whether it critiques a layout or a function.

## The single operation

Every harness performs the same recursive operation on the goal it receives:

> **receive** a goal → **decide**: satisfy it directly, or split it? → if split,
> produce **sub-goals with a dependency structure**, spawn child harnesses on
> them, and **integrate** their results → **emit** the goal's output artifact.

This one operation, applied recursively, *is* the entire factory. The only
thing that changes between harnesses is the goal-type bound to the work.

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

## Roles are emergent

There is no org chart. No "designer," "QA," or "manager" object exists. There
is one library of goal-types and one recursive operation. What a human calls
"the design phase" is just the region of the goal tree where design-typed goals
were spawned. The organization is emergent from the work, not imposed on it —
the OUTLINE's "dark factory": no roles to light up, only operations running.

## The three evals

One eval per moment of the recursive operation. They are three distinct failure
modes; none is redundant. The eval system has the same recursive shape as the
work system.

| Eval | Guards | Kind |
| --- | --- | --- |
| **Split eval** | was the decomposition sound and complete, with the right dependency structure? | judge (contextual) |
| **Goal-type eval** | does a leaf's output meet its typed I/O contract? | mostly deterministic (tests, types, lint) |
| **Integration eval** | does the assembled result satisfy the *original* parent goal? | judge (contextual) |

The **split eval** is the highest-leverage check — a bad split poisons the whole
subtree before any work happens beneath it. It judges two things: whether the
decomposition is sound/complete, and whether the node got the **dependency
structure right** — did it serialize work that was actually independent (wasting
wall-clock), or parallelize work that was actually dependent (spawning blind
sub-goals that needed a sibling's result)? Both are dependency errors.

It also underwrites **termination**, via two base cases tied to that dependency
structure:

- **Independent sub-goals shrink the goal** — each is a strictly smaller piece
  of the whole, so a fan-out tree bottoms out at atomic leaves; depth is finite
  without a separate depth cap.
- **A dependent chain does not shrink the goal** — it accumulates confidence
  rather than carving off pieces, so it is bounded by the **attempts budget**
  instead. (This is why attempts-as-budget was the right base case: it is the
  termination guarantee for exactly the case where shrinking doesn't apply.)

The **integration eval** catches the "all parts pass, the whole is broken"
failure.

Split and integration evals are contextual judgments (LLM-as-judge harnesses);
goal-type evals are often deterministic.

## The control loop: eval → tier → human

One mechanism ties cost, quality, and human involvement together. An eval result
selects the next resource:

- **pass** → emit the artifact upward.
- **fail** → **escalate**: retry at a higher model tier. The goal-type sets the
  default tier; failure bumps it. (Type default + escalation.)
- **attempts exhausted** → summon the **human** (last resort).

The eval is therefore not only a quality gate — it drives the resource decision.
Performance measurement and model selection collapse into this one loop:
performance *is* the eval result, and the eval result *is* what selects the
model.

### Termination: the attempts budget

Each goal gets **N attempts**. A retry-at-higher-tier consumes an attempt; a
re-split consumes an attempt. When attempts are exhausted, the human is
summoned. Termination has two base cases tied to the dependency structure of a
split (see "The three evals"): **independent sub-goals shrink the goal**, so a
fan-out tree bottoms out at atomic leaves without a separate depth cap; a
**dependent chain is bounded by the attempts budget**, since it accumulates
confidence rather than carving off pieces. Attempts also bound thrashing at each
level in both cases. (A token/cost cap may be layered on later as an operational
safeguard; the conceptual base case is the auditable integer.)

## The human enters at three named gaps — all rare by design

The factory is **mostly autonomous**. The human is an exception handler, not a
participant. There are exactly three entry points, each closing a different gap,
each rare:

| Gap | Trigger | Path |
| --- | --- | --- |
| **Competence** | attempts exhausted across rising tiers | escalation to human (last resort) |
| **Authority** | a high-stakes / irreversible goal-type is reached | mandatory typed gate (before the act, regardless of confidence) |
| **Physical** | an act no agent can perform (speak aloud, tap a real device, sign) | human-as-tool (invoked mid-task, like web-search) |

More agent capability shrinks the physical gap; better models shrink the
competence gap; earned trust shrinks the authority gap.

## Memory: layered project × type × global

The recursive operation is pure; state lives outside it, in an explicit memory
substrate. Three retrievable layers, mirroring instance / class / universe. A
goal queries all three by relevance, anchored by the artifact it operates on
(not by who it is — there are no roles to ask).

| Layer | Holds | Lifetime | Analogy |
| --- | --- | --- | --- |
| **Project** | facts/decisions about *this* artifact (this repo uses Postgres; we rejected SSR here) | dies with the project | instance state |
| **Type** | how *this operation* is done well, accrued across every project the type ran in | compounds forever | class knowledge |
| **Global** | org-wide conventions, user preferences, house style | persistent | ambient universe |

**Type memory is the compounding asset** — the layer where the factory gets
better over time. A `critique` type that has run 10,000 times holds critique
wisdom no single project could teach. Project memory is what makes brownfield
work: comprehension goals write codebase facts here; later goals read them.

### Memory writes are eval-gated, with decay/quarantine

Project memory is scoped, disposable, low-stakes — written autonomously. Type
and global memory are shared mutable state across all work forever; a bad write
silently poisons every future goal of that type. They are governed:

1. **Eval-gated promotion** — writing to type/global memory is itself a
   goal-type with its own eval ("is this general, true, and non-harmful beyond
   this project?"). A bad promotion is a caught eval failure, not silent poison.
2. **Provisional → trusted** — a newly promoted memory enters a *provisional*
   state and hardens into trusted truth only after it is used successfully N
   times.
3. **Decay** — memories that correlate with downstream eval failures decay out.
   The store is self-correcting: bad writes are evicted by their own track
   record.

## Traces / attribution — the substrate under every feedback loop

Decay, escalation tuning, and split-quality diagnosis are the same underlying
capability: linking a downstream eval result back to what produced it.

> **Every goal emits a trace** — what it received, which memories / tier / split
> it used, and what eval verdict it got. Traces are queryable.

This one substrate serves three readers:

- **Escalation tuning** — a goal-type that escalates too often is mis-tiered;
  fix its default.
- **Split diagnosis** — failures clustering under one parent mean its split eval
  was too lenient.
- **Memory decay** — memories correlating with failures are evicted.

It also answers "how do you measure performance?": a goal-type's quality is its
eval pass-rate and escalation-rate across traces. No separate performance-review
mechanism — the work emits its own metrics. The dark factory needs no lights,
but it needs instruments.

## Tools: per goal-type grant

Each goal-type declares the exact tools it may use, as part of its contract. A
goal can only touch tools its type grants — the contract *is* the capability.
You can read a type and know its blast radius. Dangerous tools (spend, deploy,
delete, create-key) live only on a few narrow, heavily-eval'd types.

Those few types that wield **irreversible/external** tools are exactly the
high-stakes types that carry the **mandatory human gate** (the authority gap
above). The irreversible act surfaces a human because the *type* is gated — not
as a separate tool-level rule. Almost nothing else is gated, preserving
autonomy.

## The product-development process: the root goal

The recursion needs a root. Corellia's primary mode is **commissioned**: a human
places an order — a **product intent** (a brief) — and that intent becomes the
root goal. Everything the OUTLINE calls "PM work" — user research, PRD authoring,
analytics inspection, stakeholder interviews — are **goal-types spawned by
decomposing the intent**, not a separate subsystem.

So "the entire product process" is not a second machine bolted onto the coding
machine. It is the **top of the same tree**: `research-users`, `write-PRD`,
`inspect-analytics`, `design-system` are goal-types near the root;
`implement-fn`, `rename-symbol` are goal-types near the leaves. Same operation,
same three evals, same layered memory, same trace substrate — top to bottom.

### Autonomous-capable, by a clean seam

The architecture is designed around commissioned intents but does not preclude
autonomy. An **`event → root-goal` adapter** can synthesize an intent from a
signal (a Datadog monitor, a Slack mention, a new Jira ticket) and feed it to the
*same* tree below. Nothing under the root changes — autonomy is a new way to
*create* a root goal, not a new way to *execute* one. This is the payoff of
making the root a typed goal like any other: a standing objective ("keep churn
below 5%") becomes a source of root goals without a second factory. Specified as
a seam now; built later.

## Brownfield comprehension

The first time the factory touches an existing codebase it cannot split anything
— it doesn't yet know what's there. Comprehension is the **precondition that
makes splitting possible** on brownfield. It is not a new mechanism: it is the
**discovery loop** (the dependent chain — probe → learn → decide the next probe
→ repeat until confident) pointed at a codebase, writing findings to **project
memory** that every later building goal reads.

### Tiered: shallow map, then JIT deep-dive

Two comprehension granularities, paid for where they earn their cost:

- **Shallow map (once, up front)** — structure, stack, entry points,
  conventions, seams. Cheap. Gives the *root* enough context to split sensibly.
- **JIT deep-dive (per goal, on demand)** — a goal that will touch a region does
  a deep comprehension of *that region only*, before changing it. Deep
  understanding is paid for exactly where work lands, never for regions no goal
  touches.

Both write to project memory; project memory accumulates both granularities over
the build.

### Project memory describes a moving target

Comprehension facts and *building* changes both write project memory, so a fact
("auth is session-based in `auth.py`") can be made false by a sibling goal that
refactors it. This is the **decay** problem, sharpened: facts can go stale
*within a single tree's lifetime*.

Resolution reuses existing machinery: project-memory facts are **versioned
against codebase state**, and a goal-type eval **re-verifies a fact it depends on
cheaply before trusting it** (the fact carries enough to check itself). A failed
re-verification triggers a fresh JIT deep-dive. Staleness becomes a caught eval
condition, never a silent wrong answer.

### The regression guard

Brownfield's gravest risk is **regression** — satisfying the new goal while
silently breaking existing behavior the goal never mentioned. The integration
eval only checks the *parent goal*; a regression is breakage *outside* the goal's
scope, so it needs its own guard. Greenfield has nothing to break; brownfield
does.

The guard is layered, and composes from machinery already in the foundation:

1. **Existing checks as a mandatory gate** — the codebase's existing test/check
   suite runs on any code-touching goal. A goal cannot emit its artifact if it
   reddens a previously-green check.
2. **Coverage signal** — the JIT deep-dive of a region reports not just *how it
   works* but *how guarded it is*. Coverage becomes a project-memory fact.
3. **Characterization where thin** — where the coverage signal shows a touched
   region is thinly covered, a **characterization goal-type** ("pin this
   region's current observable behavior as a baseline") is spawned as a
   **dependency of the change goal** — the net must exist before the change can
   be named, so it sequences automatically via the dependency mechanism.

A change that reddens either the existing checks or its fresh characterization
baseline cannot emit — **unless the goal explicitly intends that behavior
change**, in which case the intended change updates the baseline rather than
failing against it. This is why the regression check reads the goal's intent from
its I/O contract. Brownfield safety falls out of split-with-dependencies; no
special case.

## Runtime shape and human-team collaboration

### Two timescales: a persistent listener over bounded trees

The factory is not a one-shot tree that runs and halts. It runs at two
timescales:

- **The listener (persistent, singular)** — the factory's front door. Always on,
  never halts. It has two input channels — **human-commissioned intents** and
  **external signals** (via the `event → root-goal` adapter) — and performs one
  tiny operation: *input arrives → mint a root-goal → spawn its tree.* It does
  not decompose or reason about the work; it only turns inputs into root-goals.
- **A tree (per input, bounded)** — each root-goal is the top of one isolated,
  bounded, turn-based tree, worked to completion and handed back at the boundary.

"Continually operating" and "turn-based" are both true, at different altitudes:
the factory as a whole runs forever; any given unit of work is a bounded
isolated tree. **Many trees run concurrently** — several intents in flight, each
its own tree.

### Humans operate beside the factory

Humans never live-co-edit the factory's workspace. Each tree works in **isolation**
(its own worktree/branch) and reconciles with human work at the **boundary**
(review / merge). Humans collaborate three ways, all already specified, none a
live shared edit:

- **Commission** — file an intent (a root-goal input to the listener).
- **Answer mid-tree** — respond to an *escalation* (competence gap) or a
  *human-as-tool* query (physical gap). The human is a resource the tree reaches
  out to, then resumes — not a co-author.
- **Review / merge at the boundary** — the turn-based handoff, including the
  mandatory *gates* (authority gap).

Because every tree is isolated and reconciles at merge, humans and the factory
working on the same product never collide on a live edit — only parallel
isolated work converging at review.

### Branches coordinate through shared state, by pull

Pure trees communicate only vertically (parent ↔ child). Real product work needs
**lateral** coordination — a sibling branch's discovery, or a human's mid-flight
update, must be able to reach a branch that didn't know to wait for it. The
substrate already exists: **project memory** is the shared state branches read
and write. The only missing piece is *noticing a change* — solved by **pull, not
push**:

> Every goal **re-reads the project-memory facts it depends on at each
> decide / split / integrate checkpoint**. A changed fact forces re-decision.

This adds **no new primitive** — it is the brownfield staleness check, widened.
The same "re-verify a depended-on fact before trusting it" now absorbs three
phenomena that looked unrelated:

| Phenomenon | What changed the fact |
| --- | --- |
| Brownfield staleness | the *code* moved under it |
| Lateral awareness | a *sibling branch* rewrote it |
| Reactive adaptation | a *human / external signal* landed a change in shared state |

**Chosen limitation:** adaptation is *lazy* — a branch deep in a long leaf
notices a change only at its next checkpoint, not instantaneously. This is
deliberate: instantaneous preemption is what makes systems hard to reason about.
Corellia **adapts at decision boundaries, not instantaneously**; checkpoint
frequency sets responsiveness. Work that needs tighter responsiveness is a signal
to *decompose into smaller goals* (more checkpoints), not to add interrupts.

## How this satisfies the hard requirements

| OUTLINE requirement | Satisfied by |
| --- | --- |
| Build on brownfield projects | recursive comprehension front-end + project memory anchored to the codebase |
| Organize roles in the build | emergent roles — a library of goal-types, no imposed org chart |
| Evals on handoffs between roles | the three evals (split / goal-type / integration) |
| Defined inputs and outputs | every goal-type is a typed I/O contract |
| Simpler/cheaper models per role | type-default tier with escalation — cost stratifies by position in the tree |
| Mostly autonomous, human rare | humans only at the three named gaps, all rare by design |

## Foundation decisions — summary

| Decision | Resolution |
| --- | --- |
| Work unit & expansion | recursive goal-spawning — typed goals, one recursive operation |
| Expansion shape | one split mechanism; parallel vs sequential is emergent from the children's dependency structure |
| Product process | commissioned-primary (intent = root goal); autonomous-capable via an event → root-goal seam |
| Eval contract | split + goal-type + integration |
| Cost / quality / human | one control loop: eval → tier escalation → human last-resort |
| Termination | two base cases: independent splits shrink the goal; dependent chains are bounded by the attempts budget |
| Human paths (all rare) | competence (escalation), authority (typed gates), physical (human-as-tool) |
| Roles | emergent — no org chart, only a library of goal-types |
| Memory | layered: project (instance) × type (class) × global (universe) |
| Memory writes | eval-gated promotion + provisional/decay/quarantine |
| Substrate under feedback | traces / attribution — performance read off the trace |
| Tools | per goal-type grant — the contract is the capability |
| Brownfield comprehension | tiered: shallow map up front + JIT deep-dive per touched region; facts versioned, re-verified on use |
| Regression guard | existing checks as gate + coverage signal + JIT characterization where thin; intended changes update the baseline |
| Runtime shape | persistent listener (intents + signals → root-goals) over many concurrent, bounded, isolated trees |
| Human collaboration | beside, turn-based: commission, answer mid-tree, review/merge at the boundary; never live co-edit |
| Branch coordination | shared state (project memory) read by pull — re-verify depended-on facts at each checkpoint; adapts at decision boundaries, not instantaneously |
| Unification | a goal-type **is** a harness |

## Not yet specified (later layers)

- **Goal-type library** — the concrete starter set of goal-types and their
  contracts.
