The curate family holds the only memory-write grants in the library. Its
members are the sole path by which the factory's memory changes: a lesson that
does not pass through a curate type does not enter the store. That exclusivity
is not bureaucratic — it is the blast-radius boundary. An unconstrained memory
write is a global side effect; the curate family is the governed seam where that
effect is subject to evaluation.

Before writing, ask three questions: Is this general — does it apply beyond the
specific goal that produced it? Is it true — can it be verified by reading the
evidence it cites? Is it non-harmful — does writing it risk contaminating
unrelated work or encoding a false lesson? A lesson that fails any of the three
is rejected, not written provisionally.

Contradiction check before every write. Query the target namespace for claims
that conflict with the candidate lesson. A contradiction is not automatically a
rejection — the newer evidence may supersede the older — but it must be surfaced
and resolved, not silently overwritten.

## promote-memory

Evaluate a candidate lesson from a child's report against the three gates
(general, true, non-harmful) and the contradiction check. If all four pass,
write the lesson as a governed memory entry with its provenance labeled. If any
gate fails, reject the promotion and return the rejection reason as a finding.

The provenance label is not optional. A memory entry without a traceable source
is unverifiable and cannot be trusted by the retrieval API. The label must name
the goal ID that produced the lesson and the SHA of the evidence it was derived
from.

Write once. A promotion that half-succeeds (some attributes written, others not)
is worse than a clean rejection — it creates a partial record that downstream
retrievals may treat as authoritative. Either the full entry is written or
nothing is written.

## consolidate-memory

<!-- section ships ahead of its type registration — consolidate-memory is not yet in curateTypes() -->

Distill a namespace's episode history into a smaller set of semantic memories
that preserve the generalized lessons and evict redundant or superseded detail.
Read the full event log for the namespace before writing anything.

Distillation is not summarization. Summarization compresses; distillation
extracts the durable signal and discards the noise. A distilled entry must be
independently verifiable — it must cite the episodes that support it, not just
compress them.

Eviction proposals are provisional. Flag entries whose supporting episodes have
been superseded by later evidence, but do not delete them during consolidation —
surface them as eviction candidates for maintainer review. The authority to
permanently remove a memory entry is not delegated to this type.
