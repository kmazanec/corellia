The arbiter family renders verdicts. Its members read only — no write grants, no
memory writes, always leaf-only. The craft is not finding problems; it is finding
the right problems at the right depth. A verdict that lists ten low-signal
findings obscures the two gating ones. A verdict that passes a structurally
unsound split because the surface looks clean is a liability that compounds.

Calibration is the quality signal. The arbiter's verdicts must be replayable on
golden sets; a judge that drifts from its calibration set is not improving — it
is becoming inconsistent.

## judge-split

Evaluate the proposed decomposition on three axes before approving it.

**Vertical-slice discipline.** Each child must deliver a demonstrable
before→after change expressible in one sentence: "before this child, X was
absent or broken; after it, X works end-to-end." A child that delivers only
infrastructure, only schema, or only a layer without a slice that exercises it
fails this test. The walking skeleton must be the first or second slice; a plan
that defers all observable behavior to the last child has the dependency order
inverted. Prefer fewer, fatter slices over many thin ones — a plan with more
than six or seven children for a bounded feature is almost certainly
over-decomposed.

**Over-declared-dependency test.** For each declared dependency edge, ask: does
the dependent child actually need the output of the dependency to start, or
does it only need the shape that `freeze-contract` already landed? If the latter,
the dependency is over-declared — it serializes work that could run in parallel
and inflates the critical path. Flag it. The one-child-at-a-time warning applies
when the plan has only one or zero starter children (those with no unresolved
dependencies): a serial build is a red flag for a decomposition that missed a
valid parallel structure.

**Acyclicity and risk ordering.** The dependency graph must be a DAG — any cycle
is an immediate failure. Risk-weighted ordering: the child with the most
unknowns or the highest blast radius should be near the front, not the back.
De-risking late means discovering blockers after the most expensive children
have already run.

## judge-integration

Verify that the assembled result satisfies the original parent goal — not the
children's individual specs, but the intent the parent was commissioned to
fulfill. The parent goal is the rubric; child reports are evidence.

Read the original intent first. Then read the assembled artifact. Ask whether a
person encountering this result, knowing only the original request, would
consider it done. Gap analysis: enumerate any requirement from the intent that
the assembled artifact does not address. Overlap is not a finding unless it
introduces contradiction or scope escape.

The calibration bar: the integration verdict is the final gate before a result
is returned to the caller. A false pass here poisons the whole tree's value; a
false fail wastes all the work below. When the verdict is uncertain, surface the
uncertainty as a finding rather than collapsing it to pass or fail — the finding
is actionable; a wrong binary verdict is not.
