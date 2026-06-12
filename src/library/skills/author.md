The author family turns intent and evidence into durable, behavior-focused
specifications and design records. Two temptations to resist: writing solutions
when specifications are asked for, and writing solutions that you already know
rather than deriving them from the evidence. The artifact is a decision record,
not a transcript of your preferences.

Four pillars before writing anything: understand the problem (what goes wrong
without this?), the users (who are they and what do they actually do?), the
intended outcome (what measurable state changes?), and the constraints (what
must not change?). Do not ask what research can answer. Ask only what requires
human judgment to resolve.

Teach before asking. When a question requires the stakeholder to understand a
tradeoff first, state the tradeoff in one sentence before posing the question.
A question without context produces an answer without weight.

Revision history is never silent. Every revision must note what changed and
why. An artifact that looks identical to its predecessor but differs in one
criterion is a source of confusion; surface the delta explicitly.

## write-prd

Conduct the senior-PM interview before writing. The four-pillar structure:
(1) problem — what breaks or is missing without this feature? state it in one
sentence before probing further; (2) intent — what does success look like
measurably? not "users can do X" but "X-rate improves from Y to Z"; (3) scope
— what is explicitly in, explicitly out, explicitly deferred? the deferred list
prevents scope creep at the next revision; (4) constraints — what must not
change in order for adjacent features to keep working?

Question discipline: do not ask what the spec, the research findings, or the
existing code can answer. Batch questions per round; never ask more than three
at once. Each question must carry the decision it unlocks — a question whose
answer does not change the artifact is not worth asking.

Acceptance criteria are Given/When/Then near-executable scenarios. "Given [a
state of the world] When [an actor does something] Then [the system behaves
measurably]." Every criterion must be independently testable. Vague criteria
("the system responds quickly") are not acceptable — convert them to measurable
thresholds or flag them as open questions.

Every requirement traces to the intent or a research finding. A requirement
without provenance is an assumption; surface it as an open question, not a
requirement. Number requirements; acceptance criteria reference requirement IDs.

## design-arch

Run the terraced scan before writing the decision. For a novel spec-shape the
default is k=3 candidate architectures at a cheap tier, ranked by critique-doc,
with the winner deepened. Lenses: architect's cut (cleanliness, separability),
reuse-maximizing cut (what already exists that can be extended?), contrarian's
cut (what is the conventional wisdom here and why might it be wrong?). The
losing candidates become the ADR's "alternatives considered" — they must be
genuinely explored, not retrofitted.

ADR format: context (the problem and the constraints, concisely), options
(the candidates with their tradeoffs), decision (the chosen option, one
sentence), rationale (why this option and not the others — the tradeoff is the
tell; an empty rationale means the decision was not actually made), tradeoffs
(what this decision makes harder), consequences for the build (what the
implementing types must treat as invariants).

Mark shared-shape decisions with Contract:yes. A decision flagged Contract:yes
must be resolved before any sibling fan-out; it becomes a freeze-contract input.
Supersede never edit — when a decision is reversed, write a new ADR that
supersedes the old one; never mutate an existing ADR's decision section.

Security and non-functional rounds are mandatory. Before declaring the design
complete: (1) ask "what is the blast radius of a failure in this component?"
(2) ask "what is the latency and throughput budget, and does this design fit it?"
A design that skips these rounds is incomplete regardless of functional coverage.

CTO-defensibility bar: for every decision, be able to answer "why this way and
not the obvious alternative?" in one sentence. An empty tradeoffs section means
the decision was not actually made.
