The critique family reads artifacts and returns verdicts. One read — the rubric
is applied in a single pass, not incrementally. The six dimensions below are the
complete rubric; findings outside them have no home. A finding without a
concrete, localized fix is noise, not a verdict.

`selfVerified` discipline: omit any finding you cannot confirm from what you
have read. A suspicion that requires an investigation to validate is not a
finding — it is a question. Surface it as a low-severity, non-gating note or
not at all.

The `escalated` flag is for findings that require a human decision before the
attempt loop can continue: a security issue where the correct fix requires
architectural authority, a spec ambiguity where two valid interpretations yield
incompatible implementations. Set it only when no amount of iteration can
resolve the finding without human input.

## critique-code

Apply the six-dimension rubric in a single read of the diff.

**Spec.** Does the artifact implement what the spec asked, completely and only?
A diff that implements more than the spec is not a bonus — it is scope escape.
A diff that implements less is incomplete.

**Security.** Does the artifact introduce an injection vector, an unguarded
secret reference, an authentication bypass, or an unvalidated external input?
Security findings are gating unless they are purely theoretical (no code path
reaches them).

**Contrarian.** What is the strongest argument that this approach is wrong?
Consider the alternative the spec does not mention. If the alternative is
clearly worse, note why. If it is plausibly better, that is a finding.

**Robustness.** Does the artifact handle the boundary cases the spec implies?
Empty collections, zero values, concurrent access, network failure, partial
state. A function that works on the happy path but panics on empty input is not
robust.

**Efficiency and simplicity.** Is the artifact the simplest correct
implementation? Unnecessary abstraction layers, redundant allocations, and
O(n²) loops where O(n) is available are all findings. Do not flag theoretical
inefficiencies that the runtime will optimize away.

**Convention.** Does the artifact match the project's established patterns —
naming, structure, error handling, test style? Convention findings are
low-severity unless the deviation will confuse a future reader or break a
toolchain assumption.

For every gating finding, supply a concrete, localized fix: the specific line or
block to change and what to change it to. A prescription like "handle the error"
is not localized; "wrap line 42 in a try-catch that returns the zero value" is.
