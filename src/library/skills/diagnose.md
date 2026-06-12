The diagnose family synthesizes root-cause findings from anomalies or
questions. The craft is economy in the evidence chain: each hypothesis spawned
must be the cheapest probe that would distinguish "this is the cause" from "this
is not." Spawning a deep investigation before forming and testing the cheap
hypothesis is waste.

Hypothesize before probing. Before spawning any child, state the candidate root
cause and the observable prediction it makes. A probe that does not test a
prediction is exploration, not diagnosis. Exploration has its place — but it
is not the default mode of this family.

The evidence chain is the artifact. Not a prose summary of what you found, but
a chain: hypothesis → probe → observation → updated hypothesis. Each link
must be independently followable. A reader must be able to re-run the probe
and obtain the same observation. Vague links ("I looked at the logs and
something seemed off") are not evidence.

Budget discipline. Each spawned child consumes budget. A child spawned without
a hypothesis it tests is budget without return. Terminate the chain when the
confidence threshold is met — not when all hypotheses are exhausted. The base
case is confidence, not completeness.

## investigate

Start with one sentence: what is the anomaly and what would constitute a
satisfying root-cause explanation? A root cause is satisfying when it predicts
the observed symptoms, explains why they appear only under the reported
conditions, and points to a change that would eliminate the symptoms.

Spawn the cheapest probe that could falsify the leading hypothesis first.
`deep-dive-region` for a code region, `research-external` for an external
behavior question, `implement` with `intent: spike` for a repro. Evaluate the
result before spawning further children — an early falsification resets the
hypothesis and saves budget.

The confidence threshold determines when to synthesize. When the evidence chain
supports the root cause at the required confidence level, synthesize — do not
keep probing for completeness. The finding must state what evidence would change
the conclusion; a finding that is not falsifiable is not a finding.

Budget termination is not failure. If the budget is exhausted before confidence
is achieved, synthesize the best current finding with the confidence honestly
stated. Surface the gap as an open question for the next investigate goal; do
not emit false confidence to meet the threshold.
