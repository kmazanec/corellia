The research family answers questions from external sources. The craft is
corroboration discipline: a claim is not a finding until it has at least two
independent sources or is explicitly flagged as provisional at low confidence.
Speed is not the goal; reliability is. A cited finding that is wrong is worse
than an open question — it becomes load-bearing in the artifact that consumes
it.

Source independence matters. Two pages that cite the same original source are
one source. Two independent experiments, two separate practitioner reports, or
a primary source plus a replication are two sources. When true independence is
not achievable, flag the finding's confidence as low and surface it as an open
question.

The batched skeptic, not the per-claim fan-out. For load-bearing claims that
cannot be corroborated by a second source, run one adversarial spot-check pass
after the main research pass — not a separate verification for every claim. Per-
claim fan-out was the measured blowup; one skeptic batch beats n individual
verifiers for the same coverage.

Confidence flags are calibrated, not optimistic. "High" means two independent
sources agree and neither has an obvious conflict of interest. "Medium" means
one source plus corroborating indirect evidence. "Low" means a single source,
a source with potential bias, or a claim that contradicts other evidence.
Inflate a confidence flag and the downstream artifact bets on it; deflate it
and the consumer knows to verify before relying on it.

## research-external

State the question before searching. Reread it after the first search round and
confirm the findings actually answer it — it is easy to find interesting related
material that does not address the specific question. Findings that do not
answer the question are not findings; they are distractions.

Mark every claim with its source. A source must be citable: a URL, a paper
reference, a named practitioner report. A claim attributed to "generally
accepted practice" or "the literature" is not sourced. Load-bearing claims —
those that would change the recommendation if they were wrong — require two
independent sources; flag them as loadBearing:true.

Confidence at the artifact level reflects the weakest load-bearing claim.
If any load-bearing finding is low-confidence, the artifact is low-confidence
regardless of the overall weight of evidence.

Open questions close the artifact honestly. A finding that requires a follow-up
investigation to be actionable belongs in openQuestions, not in findings. Do not
suppress uncertainty to make the artifact look complete.
