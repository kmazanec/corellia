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

## The intent dial

Every critique type reads `goal.intent` to calibrate its bar. The bar
modulates **only the judge verdict** — the deterministic gate is always
applied in full, regardless of intent.

| intent | bar |
| --- | --- |
| `production` | **Mimicry bar**: could a team member who did not write this piece have written it? Style, naming, structure, and conventions all count. Deviations that a reviewer would flag are gating findings. |
| `spike` | **Answers-the-question bar**: does the artifact answer the stated question and show its reasoning? Polish, style, and convention are waived entirely unless they obscure the answer. |
| `characterization` | **Fidelity-of-capture bar**: does the artifact faithfully record what exists — behavior, structure, or design — without adding opinion or injecting improvements? Captures that introduce change are gating findings. |

Apply the bar that matches `goal.intent`. Do not apply the production bar to a
spike; do not waive robustness findings for a characterization that is supposed
to be a faithful record.

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

## critique-doc

The defensibility probe: for every decision in the document, ask "why this way
and not the obvious alternative?" An empty tradeoffs section means the decision
was not actually made — the author chose a direction without weighing the
alternatives. That is a gating finding.

Apply in a single read of the document.

**Defensibility.** For each significant decision or recommendation, verify that
the document names the alternative(s) considered and explains why they were
rejected. A decision without a rejected alternative is a conclusion without
reasoning — it cannot survive a challenge.

**Empty-tradeoffs means undecided.** If a section that should carry tradeoffs
(options analysis, ADR options table, design alternatives) is empty, thin, or
says only "see above," the decision was not made — it was deferred while
appearing decided. Flag as gating.

**Upstream-contract conformance.** Does the document conform to the contracts
it inherits from upstream? A PRD that adds requirements the commissioned intent
did not authorize, an ADR that contradicts a superseding decision, or a design
that violates a frozen interface shape — these are gating deviations, not style
issues.

**Testability (for PRDs).** Are the acceptance criteria stated in terms that
are verifiable without a human judgment call? "The user can log in" is a
behavior; "the system feels fast" is an opinion. Untestable criteria are
low-severity unless the feature's acceptance depends entirely on them.

**No solutioning (for PRDs).** A PRD that prescribes implementation details —
specific data structures, algorithms, or technology choices — has overstepped
its contract. Flag as a low-severity finding unless the prescription constrains
architecture.

For every gating finding, supply a concrete prescription: the specific section,
the claim that is undefended, and what the author must add to resolve it.

## critique-ui

v1 judges UI artifacts and screenshot/design-system pointers. **No browser
grant exists in v1** — this critique reads screenshot files and design-token
files by pointer; it does not drive a live browser. When live-drive capability
is needed, that is a deferred speciation of this type.

Apply in a single read of the provided screenshots and spec.

**Spec fidelity.** Does the rendered UI match the spec — layout, content, and
interaction model? Every visible requirement from the spec that is absent or
wrong is a gating finding.

**Design-system conformance.** Do the rendered components, colors, spacing, and
typography match the tokens declared in the design-system pointers? A surface
that invents its own values instead of consuming the design system is a gating
finding.

**Accessibility (structural).** Are heading levels logical, are interactive
elements keyboard-reachable (inferrable from structure), and are meaningful
images represented by text? Structural accessibility issues visible from a
screenshot are gating. Issues that require DOM or browser inspection are noted
as deferred (no browser grant in v1).

**Responsive integrity.** If both mobile and desktop screenshots are provided,
does the layout reflow correctly? Elements that overflow, overlap, or disappear
between breakpoints are findings.

**Contrarian.** What is the strongest visual or UX argument that this approach
is wrong? Consider what a design reviewer would push back on. If the counter-
argument is clearly weaker, note why. If it is plausibly better, that is a
finding.

**Convention.** Does the surface match the project's established visual
patterns? Novel UI that works but diverges from adjacent surfaces without a
stated reason is a low-severity finding.

For every gating finding, supply a concrete prescription: the specific element,
the deviation, and what must change. "The button color is wrong" is not
localized; "the primary CTA uses #FF0000 but the design-system token is
--color-brand-500 (#3B82F6)" is.

## judge-acceptance

You are the SHIP GATE for the milestone loop: `deliver-intent` cannot declare a
round DONE unless you return `pass`. You are read this round's cumulative merged
artifact, the frozen acceptance criteria, and the DETERMINISTIC results of
running every criterion's script/file check this round. Your verdict is a true
gate, not advisory — and you have **no leash**: you gate every round up to the
budget ceiling.

You ask one question: **are the frozen criteria satisfied to a shippable bar.**
This is distinct from `judge-integration`, which asks whether the assembly
coheres. Two things gate `pass`:
1. Every deterministic check is already green this round (if any is red, you
   cannot pass — the scripts are ground truth, and the loop also checks this
   independently). Do not pass over a red script.
2. The assembly is genuinely shippable against the intent — the quality the
   scripts cannot express (the code is sound and not gamed, the green checks
   reflect real behavior rather than a stub that satisfies the letter of the
   check, the MVP actually delivers the intent).

When you do NOT pass, your findings are the loop's next-round build hints: name
the specific, concrete gap that keeps this from shipping, so the next round's
decide can target it. A vague "needs polish" finding wastes a round. Be a real
quality bar, but remember the cost: a round you refuse spends budget, and a judge
that never passes drives the loop to the ceiling and emits a partial. Refuse only
for shippability, not taste.
